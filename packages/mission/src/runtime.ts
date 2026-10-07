/**
 * @fleetos/mission — the durable mission runtime (law A10).
 *
 * Missions survive any process lifetime: the durable truth is the
 * append-only JOURNAL (event-sourced); the mission state is a pure fold
 * over it. Every runtime operation is ONE atomic boundary (kernel
 * TransactionalSession TYPE implemented by the mission store's session):
 * the journal entries, the mission record and the outbox events are
 * staged in the SAME session and become durable at the SAME commit — a
 * rolled-back operation leaves NO journal entry and NO outbox event
 * (the A14 dual-write law, machine-tested).
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
 * Determinism laws: pure functions, `now` always an explicit input, no
 * Date.now/Math.random/timers/network.
 */

import type { TenantContext, TenantId } from "@fleetos/kernel";
import { fail, ok, type Result } from "./result.js";
import type { GuardRef, ValidatedMissionDefinition } from "./definition.js";
import { isStageReady, validateMissionDefinition } from "./definition.js";
import {
  entryDigest,
  foldMission,
  MissionJournal,
  JOURNAL_COLLECTION,
  type MissionJournalEntry,
  type MissionJournalEvent,
  type MissionView,
} from "./journal.js";
import { asMissionId, workOrderIdempotencyKey } from "./ids.js";
import type {
  InMemoryMissionOutbox,
  MissionStore,
} from "./outbox.js";

// ---------------------------------------------------------------------------
// The type seams (composition by the TL).
// ---------------------------------------------------------------------------

export interface CommandSubmitAck {
  readonly commandId: string;
  /** True when the receiving queue deduped the idempotency key (no re-execution). */
  readonly duplicate: boolean;
}

/**
 * The control-plane command queue CONTRACT as a type seam — structurally
 * satisfied by the control-plane `CommandQueue.submit` (compile-pinned in
 * the control-plane test suite). Mission never imports control-plane at
 * runtime; the TL binds the concrete queue here.
 */
export interface CommandSubmitPort {
  submit(input: {
    readonly ctx: TenantContext;
    readonly command: {
      readonly kind: string;
      readonly payload: unknown;
      readonly idempotencyKey: string;
      readonly issuedAt: number;
    };
  }): Result<CommandSubmitAck, string>;
}

export interface GuardEvaluator {
  evaluate(input: {
    readonly ctx: TenantContext;
    readonly missionId: string;
    readonly stageId: string;
    readonly guard: GuardRef;
  }): boolean;
}

export const ALLOW_ALL_GUARDS: GuardEvaluator = {
  evaluate: () => true,
};

// ---------------------------------------------------------------------------
// Rejections + results
// ---------------------------------------------------------------------------

export type MissionRuntimeRejection =
  | "invalid-input"
  | "invalid-definition"
  | "mission-not-found" // includes cross-tenant access (fail closed)
  | "mission-exists"
  | "illegal-transition"
  | "not-suspended"
  | "unknown-stage"
  | "stage-not-running"
  | "guard-rejected"
  | "command-submit-rejected"
  | "outbox-rejected"
  | "commit-failed";

export interface MissionOpResult {
  readonly view: MissionView;
  readonly duplicate: boolean;
}

const DEFINITION_COLLECTION = "mission-definitions";

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
    const entries = this.chainEntries(input.ctx, missionId, [
      { kind: "mission-created", reason: validated.value.definition.id },
    ], input.now);
    const applied = this.applyEntries({
      ctx: input.ctx,
      missionId,
      entries,
      definitionRecord: validated.value,
      now: input.now,
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
    const current = this.viewOf(input.ctx, input.missionId);
    if (!current.ok) return current;
    const { view, validated } = current.value;
    if (view.state === "running") {
      return this.viewResult(input.ctx, input.missionId, true);
    }
    if (view.state !== "pending") return fail("illegal-transition");

    const events: MissionJournalEvent[] = [{ kind: "mission-started" }];
    const issuance = this.buildIssuanceEvents({
      ctx: input.ctx,
      missionId: input.missionId,
      view,
      validated,
      now: input.now,
    });
    if (!issuance.ok) return fail(issuance.reason);
    events.push(...issuance.value);

    const entries = this.chainEntries(input.ctx, input.missionId, events, input.now);
    const applied = this.applyEntries({
      ctx: input.ctx,
      missionId: input.missionId,
      entries,
      now: input.now,
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
    const current = this.viewOf(input.ctx, input.missionId);
    if (!current.ok) return current;
    const { view } = current.value;
    const stage = view.stages.find((s) => s.stageId === input.stageId);
    if (!stage) return fail("unknown-stage");
    if (view.state !== "running") return fail("illegal-transition");
    if (stage.state !== "running") return fail("stage-not-running");
    if (stage.checkpoints.some((c) => c.checkpointId === input.checkpointId)) {
      return this.viewResult(input.ctx, input.missionId, true);
    }
    const entries = this.chainEntries(
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
    const applied = this.applyEntries({
      ctx: input.ctx,
      missionId: input.missionId,
      entries,
      now: input.now,
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
    const current = this.viewOf(input.ctx, input.missionId);
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
      ...this.chainEntries(input.ctx, input.missionId, events, input.now),
    ]);
    const issuance = this.buildIssuanceEvents({
      ctx: input.ctx,
      missionId: input.missionId,
      view: folded,
      validated,
      now: input.now,
    });
    if (!issuance.ok) return fail(issuance.reason);
    events.push(...issuance.value);

    // Mission completion: every stage completed?
    const afterFold = foldMission(validated, [
      ...committed,
      ...this.chainEntries(input.ctx, input.missionId, events, input.now),
    ]);
    if (
      afterFold.state === "running" &&
      afterFold.stages.every((s) => s.state === "completed")
    ) {
      events.push({ kind: "mission-completed" });
    }

    const entries = this.chainEntries(input.ctx, input.missionId, events, input.now);
    const applied = this.applyEntries({
      ctx: input.ctx,
      missionId: input.missionId,
      entries,
      now: input.now,
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
    const current = this.viewOf(input.ctx, input.missionId);
    if (!current.ok) return current;
    const { view } = current.value;
    const stage = view.stages.find((s) => s.stageId === input.stageId);
    if (!stage) return fail("unknown-stage");
    if (stage.state !== "running") return fail("stage-not-running");
    if (view.state !== "running") return fail("illegal-transition");
    const entries = this.chainEntries(
      input.ctx,
      input.missionId,
      [
        { kind: "stage-failed", stageId: input.stageId, reason: input.reason },
        { kind: "mission-failed", reason: input.reason },
      ],
      input.now,
    );
    const applied = this.applyEntries({
      ctx: input.ctx,
      missionId: input.missionId,
      entries,
      now: input.now,
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
    const current = this.viewOf(input.ctx, input.missionId);
    if (!current.ok) return current;
    const { view } = current.value;
    if (view.state === "suspended") {
      return this.viewResult(input.ctx, input.missionId, true);
    }
    if (view.state !== "running") return fail("illegal-transition");
    const entries = this.chainEntries(
      input.ctx,
      input.missionId,
      [{ kind: "mission-suspended", reason: input.reason }],
      input.now,
    );
    const applied = this.applyEntries({
      ctx: input.ctx,
      missionId: input.missionId,
      entries,
      now: input.now,
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
    const current = this.viewOf(input.ctx, input.missionId);
    if (!current.ok) return current;
    const { view } = current.value;
    if (view.state !== "suspended") {
      if (view.state === "pending" || view.state === "running") {
        return fail("not-suspended");
      }
      return fail("illegal-transition");
    }
    const events: MissionJournalEvent[] = [
      {
        kind: "mission-resumed",
        checkpointId: view.lastCheckpoint?.checkpointId,
        stageId: view.lastCheckpoint?.stageId,
      },
    ];
    // Re-submit work orders for the in-flight (running) stages only.
    for (const stage of view.stages) {
      if (stage.state !== "running") continue;
      const key = workOrderIdempotencyKey(input.missionId, stage.stageId);
      const submit = this.commandSubmit.submit({
        ctx: input.ctx,
        command: {
          kind: "work-order",
          payload: {
            missionId: input.missionId,
            stageId: stage.stageId,
            resumed: true,
          },
          idempotencyKey: key,
          issuedAt: input.now,
        },
      });
      if (!submit.ok) return fail("command-submit-rejected");
      events.push({
        kind: "work-order-issued",
        stageId: stage.stageId,
        commandId: submit.value.commandId,
        idempotencyKey: key,
        attempt: stage.workOrders.length + 1,
        duplicate: submit.value.duplicate,
      });
    }
    const entries = this.chainEntries(input.ctx, input.missionId, events, input.now);
    const applied = this.applyEntries({
      ctx: input.ctx,
      missionId: input.missionId,
      entries,
      now: input.now,
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
    const current = this.viewOf(input.ctx, input.missionId);
    if (!current.ok) return current;
    const { view } = current.value;
    if (view.state === "cancelled") {
      return this.viewResult(input.ctx, input.missionId, true);
    }
    if (view.state === "completed" || view.state === "failed") {
      return fail("illegal-transition");
    }
    const entries = this.chainEntries(
      input.ctx,
      input.missionId,
      [{ kind: "mission-cancelled", reason: input.reason }],
      input.now,
    );
    const applied = this.applyEntries({
      ctx: input.ctx,
      missionId: input.missionId,
      entries,
      now: input.now,
    });
    if (!applied.ok) return applied;
    return this.viewResult(input.ctx, input.missionId, false);
  }

  // --- reads ---

  missionView(
    ctx: TenantContext,
    missionId: string,
  ): Result<MissionView, MissionRuntimeRejection> {
    const current = this.viewOf(ctx, missionId);
    if (!current.ok) return current;
    return ok(current.value.view);
  }

  journalEntries(
    ctx: TenantContext,
    missionId: string,
  ): Result<ReadonlyArray<MissionJournalEntry>, MissionRuntimeRejection> {
    const current = this.viewOf(ctx, missionId);
    if (!current.ok) return current;
    return ok(this.missionJournal.committedEntries(ctx, missionId));
  }

  journal(): MissionJournal {
    return this.missionJournal;
  }

  // --- internals ---

  /**
   * Chains a list of events onto the committed journal: seqs continue the
   * committed sequence and each digest covers its predecessor — the whole
   * operation is one contiguous, verifiable chain segment.
   */
  private chainEntries(
    ctx: TenantContext,
    missionId: string,
    events: ReadonlyArray<MissionJournalEvent>,
    now: number,
  ): ReadonlyArray<MissionJournalEntry> {
    const committed = this.missionJournal.committedEntries(ctx, missionId);
    let prevDigest: string | null =
      committed.length > 0 ? committed[committed.length - 1]?.digest ?? null : null;
    let seq = committed.length;
    const entries: MissionJournalEntry[] = [];
    for (const event of events) {
      seq += 1;
      const base = {
        seq,
        tenantId: ctx.tenantId as TenantId,
        missionId: asMissionId(missionId),
        event,
        at: now,
      };
      const digest = entryDigest(prevDigest, base);
      entries.push({ ...base, digest, prevDigest });
      prevDigest = digest;
    }
    return entries;
  }

  /**
   * Builds stage-started + work-order-issued EVENTS for every READY stage
   * whose guards pass. Guard failures produce guard-rejected events (the
   * stage stays pending; a later issuance retries it).
   */
  private buildIssuanceEvents(input: {
    readonly ctx: TenantContext;
    readonly missionId: string;
    readonly view: MissionView;
    readonly validated: ValidatedMissionDefinition;
    readonly now: number;
  }): Result<ReadonlyArray<MissionJournalEvent>, MissionRuntimeRejection> {
    const completed = new Set(
      input.view.stages
        .filter((s) => s.state === "completed")
        .map((s) => s.stageId),
    );
    const started = new Set(
      input.view.stages.filter((s) => s.state !== "pending").map((s) => s.stageId),
    );
    const events: MissionJournalEvent[] = [];
    for (const stage of input.validated.definition.stages) {
      if (
        !isStageReady({
          validated: input.validated,
          stageId: stage.id,
          completedStages: completed,
          startedStages: started,
        })
      ) {
        continue;
      }
      const guards = stage.guards ?? [];
      const rejected = guards.find(
        (guard) =>
          !this.guards.evaluate({
            ctx: input.ctx,
            missionId: input.missionId,
            stageId: stage.id,
            guard,
          }),
      );
      if (rejected) {
        events.push({
          kind: "guard-rejected",
          stageId: stage.id,
          reason: `${rejected.kind}:${rejected.ref}`,
        });
        continue;
      }
      const key = workOrderIdempotencyKey(input.missionId, stage.id);
      const submit = this.commandSubmit.submit({
        ctx: input.ctx,
        command: {
          kind: "work-order",
          payload: {
            missionId: input.missionId,
            stageId: stage.id,
            definitionId: input.validated.definition.id,
          },
          idempotencyKey: key,
          issuedAt: input.now,
        },
      });
      if (!submit.ok) return fail("command-submit-rejected");
      events.push({ kind: "stage-started", stageId: stage.id });
      events.push({
        kind: "work-order-issued",
        stageId: stage.id,
        commandId: submit.value.commandId,
        idempotencyKey: key,
        attempt: 1,
        duplicate: submit.value.duplicate,
      });
    }
    return ok(events);
  }

  /**
   * THE atomic boundary: journal entries (+ optional mission-record write)
   * and one outbox event PER entry are staged in the SAME session and
   * committed together. Any failure rolls back — no journal residue, no
   * outbox residue (A14, machine-tested).
   */
  private applyEntries(input: {
    readonly ctx: TenantContext;
    readonly missionId: string;
    readonly entries: ReadonlyArray<MissionJournalEntry>;
    readonly definitionRecord?: ValidatedMissionDefinition;
    readonly now: number;
  }): Result<void, MissionRuntimeRejection> {
    if (input.entries.length === 0) return ok(undefined);
    const session = this.store.openSession({ ctx: input.ctx, now: input.now });
    const begin = session.begin();
    if (!begin.ok) return fail("commit-failed");
    const staged = session.stage((stage) => {
      for (const entry of input.entries) {
        stage.put(
          JOURNAL_COLLECTION,
          `${input.missionId}#${String(entry.seq)}`,
          entry,
        );
      }
      if (input.definitionRecord) {
        stage.put(DEFINITION_COLLECTION, input.missionId, input.definitionRecord);
      }
    });
    if (!staged.ok) {
      session.rollback();
      return fail("commit-failed");
    }
    for (const entry of input.entries) {
      const published = this.outbox.publish({
        session,
        event: {
          type: `mission.${entry.event.kind}`,
          payload: {
            missionId: input.missionId,
            seq: entry.seq,
            event: entry.event,
            digest: entry.digest,
          },
          idempotencyKey: `mj::${String(input.ctx.tenantId)}::${input.missionId}::${entry.seq}`,
          occurredAt: entry.at,
          causationId: input.missionId,
          correlationId: input.missionId,
        },
      });
      if (!published.ok) {
        session.rollback();
        return fail("outbox-rejected");
      }
    }
    const commit = session.commit();
    if (!commit.ok) return fail("commit-failed");
    return ok(undefined);
  }

  private viewOf(
    ctx: TenantContext,
    missionId: string,
  ): Result<
    {
      readonly view: MissionView;
      readonly validated: ValidatedMissionDefinition;
    },
    MissionRuntimeRejection
  > {
    const record = this.store.get(ctx.tenantId, DEFINITION_COLLECTION, missionId);
    if (record === null || record === undefined) {
      return fail("mission-not-found");
    }
    const validated = record as ValidatedMissionDefinition;
    const entries = this.missionJournal.committedEntries(ctx, missionId);
    return ok({ view: foldMission(validated, entries), validated });
  }

  private viewResult(
    ctx: TenantContext,
    missionId: string,
    duplicate: boolean,
  ): Result<MissionOpResult, MissionRuntimeRejection> {
    const current = this.viewOf(ctx, missionId);
    if (!current.ok) return current;
    return ok({ view: current.value.view, duplicate });
  }
}
