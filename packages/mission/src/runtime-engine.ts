/**
 * @fleetos/mission — the durable mission runtime engine (law A10).
 *
 * `MissionRuntime`: the mission state machine. Missions survive any
 * process lifetime — the durable truth is the append-only JOURNAL
 * (event-sourced); the mission state is a pure fold over it. Every
 * runtime operation is ONE atomic boundary (kernel TransactionalSession
 * TYPE implemented by the mission store's session): the journal
 * entries, the mission record and the outbox events are staged in the
 * SAME session and become durable at the SAME commit — a rolled-back
 * operation leaves NO journal entry and NO outbox event (the A14
 * dual-write law, machine-tested).
 *
 * Work-order issuance: a stage's execution intent is emitted as a
 * command envelope (kind "work-order") through the CommandSubmitPort
 * TYPE SEAM — mission must NOT runtime-import @fleetos/control-plane;
 * the TL composes the control-plane queue behind this port. The
 * idempotency key is deterministic (`wo:{missionId}:{stageId}`), so a
 * resume re-submission is deduped at the port: never re-executed.
 *
 * Resume semantics: a suspended mission resumes from the last recorded
 * checkpoint; completed stages are NEVER re-executed and their work
 * orders are NEVER re-issued — only incomplete (running) stages get a
 * re-submission with the SAME idempotency key.
 *
 * The chaining/issuance/commit machinery lives in `runtime-fold.ts`;
 * the TYPE seams and the rejection vocabulary live in
 * `runtime-contracts.ts`.
 *
 * Determinism laws: pure functions, `now` always an explicit input, no
 * Date.now/Math.random/timers/network.
 */

import type { TenantContext } from "@fleetos/kernel";
import { fail, ok, type Result } from "./result.js";
import { validateMissionDefinition } from "./definition.js";
import {
  foldMission,
  MissionJournal,
  type MissionJournalEntry,
  type MissionJournalEvent,
  type MissionView,
} from "./journal.js";
import type { InMemoryMissionOutbox, MissionStore } from "./outbox.js";
import {
  ALLOW_ALL_GUARDS,
  type CommandSubmitPort,
  type GuardEvaluator,
  type MissionOpResult,
  type MissionRuntimeRejection,
} from "./runtime-contracts.js";
import {
  applyJournalEntries,
  buildIssuanceEvents,
  buildResumeEvents,
  chainMissionEntries,
  DEFINITION_COLLECTION,
  missionViewOf,
} from "./runtime-fold.js";

// ---------------------------------------------------------------------------
// MissionRuntime
// ---------------------------------------------------------------------------

export class MissionRuntime {
  private readonly store: MissionStore;
  private readonly outbox: InMemoryMissionOutbox;
  private readonly commandSubmit: CommandSubmitPort;
  private readonly guards: GuardEvaluator;
  private readonly missionJournal: MissionJournal;
  private readonly missionCounters = new Map<string, number>();

  constructor(input: {
    readonly store: MissionStore;
    readonly outbox: InMemoryMissionOutbox;
    readonly commandSubmit: CommandSubmitPort;
    readonly guards?: GuardEvaluator;
  }) {
    this.store = input.store;
    this.outbox = input.outbox;
    this.commandSubmit = input.commandSubmit;
    this.guards = input.guards ?? ALLOW_ALL_GUARDS;
    this.missionJournal = new MissionJournal(input.store);
  }

  // --- create ---

  createMission(input: {
    readonly ctx: TenantContext;
    readonly definition: Parameters<typeof validateMissionDefinition>[0]["definition"];
    readonly missionId?: string;
    readonly now: number;
    readonly knownGuards?: ReadonlySet<string>;
  }): Result<MissionOpResult, MissionRuntimeRejection> {
    if (!Number.isFinite(input.now) || input.now <= 0) {
      return fail("invalid-input");
    }
    const validated = validateMissionDefinition({
      definition: input.definition,
      knownGuards: input.knownGuards,
    });
    if (!validated.ok) return fail("invalid-definition");
    const tenantKey = String(input.ctx.tenantId);
    let missionId = input.missionId;
    if (missionId === undefined) {
      const counter = (this.missionCounters.get(tenantKey) ?? 0) + 1;
      this.missionCounters.set(tenantKey, counter);
      missionId = `msn_${String(counter).padStart(10, "0")}`;
    }
    if (
      this.store.get(input.ctx.tenantId, DEFINITION_COLLECTION, missionId) !== null
    ) {
      return fail("mission-exists");
    }
    const entries = chainMissionEntries(this.missionJournal, input.ctx, missionId, [
      { kind: "mission-created", reason: validated.value.definition.id },
    ], input.now);
    const applied = applyJournalEntries({
      ctx: input.ctx,
      missionId,
      entries,
      definitionRecord: validated.value,
      now: input.now,
      store: this.store,
      outbox: this.outbox,
    });
    if (!applied.ok) return applied;
    return this.viewResult(input.ctx, missionId, false);
  }

  // --- start ---

  startMission(input: {
    readonly ctx: TenantContext;
    readonly missionId: string;
    readonly now: number;
  }): Result<MissionOpResult, MissionRuntimeRejection> {
    const current = missionViewOf(this.store, this.missionJournal, input.ctx, input.missionId);
    if (!current.ok) return current;
    const { view, validated } = current.value;
    if (view.state === "running") {
      return this.viewResult(input.ctx, input.missionId, true);
    }
    if (view.state !== "pending") return fail("illegal-transition");

    const events: MissionJournalEvent[] = [{ kind: "mission-started" }];
    const issuance = buildIssuanceEvents({
      ctx: input.ctx,
      missionId: input.missionId,
      view,
      validated,
      now: input.now,
      guards: this.guards,
      commandSubmit: this.commandSubmit,
    });
    if (!issuance.ok) return fail(issuance.reason);
    events.push(...issuance.value);

    const entries = chainMissionEntries(this.missionJournal, input.ctx, input.missionId, events, input.now);
    const applied = applyJournalEntries({
      ctx: input.ctx,
      missionId: input.missionId,
      entries,
      now: input.now,
      store: this.store,
      outbox: this.outbox,
    });
    if (!applied.ok) return applied;
    return this.viewResult(input.ctx, input.missionId, false);
  }

  // --- checkpoints ---

  recordCheckpoint(input: {
    readonly ctx: TenantContext;
    readonly missionId: string;
    readonly stageId: string;
    readonly checkpointId: string;
    readonly now: number;
  }): Result<MissionOpResult, MissionRuntimeRejection> {
    if (input.checkpointId === "") return fail("invalid-input");
    const current = missionViewOf(this.store, this.missionJournal, input.ctx, input.missionId);
    if (!current.ok) return current;
    const { view } = current.value;
    const stage = view.stages.find((s) => s.stageId === input.stageId);
    if (!stage) return fail("unknown-stage");
    if (view.state !== "running") return fail("illegal-transition");
    if (stage.state !== "running") return fail("stage-not-running");
    if (stage.checkpoints.some((c) => c.checkpointId === input.checkpointId)) {
      return this.viewResult(input.ctx, input.missionId, true);
    }
    const entries = chainMissionEntries(
      this.missionJournal,
      input.ctx,
      input.missionId,
      [
        {
          kind: "checkpoint-recorded",
          stageId: input.stageId,
          checkpointId: input.checkpointId,
        },
      ],
      input.now,
    );
    const applied = applyJournalEntries({
      ctx: input.ctx,
      missionId: input.missionId,
      entries,
      now: input.now,
      store: this.store,
      outbox: this.outbox,
    });
    if (!applied.ok) return applied;
    return this.viewResult(input.ctx, input.missionId, false);
  }

  // --- stage completion / failure ---

  completeStage(input: {
    readonly ctx: TenantContext;
    readonly missionId: string;
    readonly stageId: string;
    readonly now: number;
  }): Result<MissionOpResult, MissionRuntimeRejection> {
    const current = missionViewOf(this.store, this.missionJournal, input.ctx, input.missionId);
    if (!current.ok) return current;
    const { view, validated } = current.value;
    const stage = view.stages.find((s) => s.stageId === input.stageId);
    if (!stage) return fail("unknown-stage");
    if (stage.state === "completed") {
      return this.viewResult(input.ctx, input.missionId, true);
    }
    if (stage.state !== "running") return fail("stage-not-running");
    if (view.state !== "running") return fail("illegal-transition");

    const events: MissionJournalEvent[] = [
      { kind: "stage-completed", stageId: input.stageId },
    ];

    // Fold over (committed + events so far) to determine the newly ready
    // stages after this completion.
    const committed = this.missionJournal.committedEntries(input.ctx, input.missionId);
    const folded = foldMission(validated, [
      ...committed,
      ...chainMissionEntries(this.missionJournal, input.ctx, input.missionId, events, input.now),
    ]);
    const issuance = buildIssuanceEvents({
      ctx: input.ctx,
      missionId: input.missionId,
      view: folded,
      validated,
      now: input.now,
      guards: this.guards,
      commandSubmit: this.commandSubmit,
    });
    if (!issuance.ok) return fail(issuance.reason);
    events.push(...issuance.value);

    // Mission completion: every stage completed?
    const afterFold = foldMission(validated, [
      ...committed,
      ...chainMissionEntries(this.missionJournal, input.ctx, input.missionId, events, input.now),
    ]);
    if (
      afterFold.state === "running" &&
      afterFold.stages.every((s) => s.state === "completed")
    ) {
      events.push({ kind: "mission-completed" });
    }

    const entries = chainMissionEntries(this.missionJournal, input.ctx, input.missionId, events, input.now);
    const applied = applyJournalEntries({
      ctx: input.ctx,
      missionId: input.missionId,
      entries,
      now: input.now,
      store: this.store,
      outbox: this.outbox,
    });
    if (!applied.ok) return applied;
    return this.viewResult(input.ctx, input.missionId, false);
  }

  failStage(input: {
    readonly ctx: TenantContext;
    readonly missionId: string;
    readonly stageId: string;
    readonly reason: string;
    readonly now: number;
  }): Result<MissionOpResult, MissionRuntimeRejection> {
    if (input.reason === "") return fail("invalid-input");
    const current = missionViewOf(this.store, this.missionJournal, input.ctx, input.missionId);
    if (!current.ok) return current;
    const { view } = current.value;
    const stage = view.stages.find((s) => s.stageId === input.stageId);
    if (!stage) return fail("unknown-stage");
    if (stage.state !== "running") return fail("stage-not-running");
    if (view.state !== "running") return fail("illegal-transition");
    const entries = chainMissionEntries(
      this.missionJournal,
      input.ctx,
      input.missionId,
      [
        { kind: "stage-failed", stageId: input.stageId, reason: input.reason },
        { kind: "mission-failed", reason: input.reason },
      ],
      input.now,
    );
    const applied = applyJournalEntries({
      ctx: input.ctx,
      missionId: input.missionId,
      entries,
      now: input.now,
      store: this.store,
      outbox: this.outbox,
    });
    if (!applied.ok) return applied;
    return this.viewResult(input.ctx, input.missionId, false);
  }

  // --- suspend / resume ---

  suspendMission(input: {
    readonly ctx: TenantContext;
    readonly missionId: string;
    readonly reason?: string;
    readonly now: number;
  }): Result<MissionOpResult, MissionRuntimeRejection> {
    const current = missionViewOf(this.store, this.missionJournal, input.ctx, input.missionId);
    if (!current.ok) return current;
    const { view } = current.value;
    if (view.state === "suspended") {
      return this.viewResult(input.ctx, input.missionId, true);
    }
    if (view.state !== "running") return fail("illegal-transition");
    const entries = chainMissionEntries(
      this.missionJournal,
      input.ctx,
      input.missionId,
      [{ kind: "mission-suspended", reason: input.reason }],
      input.now,
    );
    const applied = applyJournalEntries({
      ctx: input.ctx,
      missionId: input.missionId,
      entries,
      now: input.now,
      store: this.store,
      outbox: this.outbox,
    });
    if (!applied.ok) return applied;
    return this.viewResult(input.ctx, input.missionId, false);
  }

  /**
   * Resume a suspended mission: the mission returns to running and the
   * stages that were IN-FLIGHT (state "running") get their work order
   * RE-SUBMITTED with the SAME idempotency key — the port dedupes, so
   * nothing is executed twice. Completed stages are never re-issued.
   */
  resumeMission(input: {
    readonly ctx: TenantContext;
    readonly missionId: string;
    readonly now: number;
  }): Result<MissionOpResult, MissionRuntimeRejection> {
    const current = missionViewOf(this.store, this.missionJournal, input.ctx, input.missionId);
    if (!current.ok) return current;
    const { view } = current.value;
    if (view.state !== "suspended") {
      if (view.state === "pending" || view.state === "running") {
        return fail("not-suspended");
      }
      return fail("illegal-transition");
    }
    const issuance = buildResumeEvents({
      ctx: input.ctx,
      missionId: input.missionId,
      view,
      now: input.now,
      commandSubmit: this.commandSubmit,
    });
    if (!issuance.ok) return fail(issuance.reason);
    const entries = chainMissionEntries(this.missionJournal, input.ctx, input.missionId, issuance.value, input.now);
    const applied = applyJournalEntries({
      ctx: input.ctx,
      missionId: input.missionId,
      entries,
      now: input.now,
      store: this.store,
      outbox: this.outbox,
    });
    if (!applied.ok) return applied;
    return this.viewResult(input.ctx, input.missionId, false);
  }

  // --- cancel ---

  cancelMission(input: {
    readonly ctx: TenantContext;
    readonly missionId: string;
    readonly reason?: string;
    readonly now: number;
  }): Result<MissionOpResult, MissionRuntimeRejection> {
    const current = missionViewOf(this.store, this.missionJournal, input.ctx, input.missionId);
    if (!current.ok) return current;
    const { view } = current.value;
    if (view.state === "cancelled") {
      return this.viewResult(input.ctx, input.missionId, true);
    }
    if (view.state === "completed" || view.state === "failed") {
      return fail("illegal-transition");
    }
    const entries = chainMissionEntries(
      this.missionJournal,
      input.ctx,
      input.missionId,
      [{ kind: "mission-cancelled", reason: input.reason }],
      input.now,
    );
    const applied = applyJournalEntries({
      ctx: input.ctx,
      missionId: input.missionId,
      entries,
      now: input.now,
      store: this.store,
      outbox: this.outbox,
    });
    if (!applied.ok) return applied;
    return this.viewResult(input.ctx, input.missionId, false);
  }

  // --- reads ---

  missionView(
    ctx: TenantContext,
    missionId: string,
  ): Result<MissionView, MissionRuntimeRejection> {
    const current = missionViewOf(this.store, this.missionJournal, ctx, missionId);
    if (!current.ok) return current;
    return ok(current.value.view);
  }

  journalEntries(
    ctx: TenantContext,
    missionId: string,
  ): Result<ReadonlyArray<MissionJournalEntry>, MissionRuntimeRejection> {
    const current = missionViewOf(this.store, this.missionJournal, ctx, missionId);
    if (!current.ok) return current;
    return ok(this.missionJournal.committedEntries(ctx, missionId));
  }

  journal(): MissionJournal {
    return this.missionJournal;
  }

  // --- internals ---

  private viewResult(
    ctx: TenantContext,
    missionId: string,
    duplicate: boolean,
  ): Result<MissionOpResult, MissionRuntimeRejection> {
    const current = missionViewOf(this.store, this.missionJournal, ctx, missionId);
    if (!current.ok) return current;
    return ok({ view: current.value.view, duplicate });
  }
}
