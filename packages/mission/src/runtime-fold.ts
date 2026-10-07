/**
 * @fleetos/mission — the runtime fold logic (law A10).
 *
 * The machinery behind every runtime operation:
 * - `missionViewOf` folds the committed journal into the mission view
 *   (the state function is a PURE fold — replaying the journal
 *   reproduces the state exactly).
 * - `chainMissionEntries` chains a batch of events onto the committed
 *   journal as one contiguous, verifiable chain segment (each digest
 *   covers its predecessor).
 * - `buildIssuanceEvents` builds the stage-started + work-order-issued
 *   events for every READY stage whose guards pass (guard failures
 *   produce guard-rejected events; the stage stays pending).
 * - `buildResumeEvents` re-submits work orders for the IN-FLIGHT
 *   (running) stages only, with the SAME deterministic idempotency key
 *   — the port dedupes, so nothing is executed twice.
 * - `applyJournalEntries` is THE atomic boundary: journal entries (+
 *   optional mission-record write) and one outbox event PER entry are
 *   staged in the SAME kernel TransactionalSession and committed
 *   together. Any failure rolls back — no journal residue, no outbox
 *   residue (the A14 dual-write law, machine-tested).
 *
 * Determinism laws: pure functions, `now` always an explicit input, no
 * Date.now/Math.random/timers/network.
 */

import type { TenantContext, TenantId } from "@fleetos/kernel";
import { fail, ok, type Result } from "./result.js";
import { isStageReady, type ValidatedMissionDefinition } from "./definition.js";
import {
  entryDigest,
  foldMission,
  JOURNAL_COLLECTION,
  type MissionJournal,
  type MissionJournalEntry,
  type MissionJournalEvent,
  type MissionView,
} from "./journal.js";
import { asMissionId, workOrderIdempotencyKey } from "./ids.js";
import type {
  CommandSubmitPort,
  GuardEvaluator,
  MissionRuntimeRejection,
} from "./runtime-contracts.js";
import type { InMemoryMissionOutbox, MissionStore } from "./outbox.js";

/** The mission-record collection inside the per-tenant committed store. */
export const DEFINITION_COLLECTION = "mission-definitions";

/**
 * The current mission view: folds the committed journal over the stored
 * (validated) mission definition. Cross-tenant or unknown missions fail
 * closed with mission-not-found.
 */
export function missionViewOf(
  store: MissionStore,
  journal: MissionJournal,
  ctx: TenantContext,
  missionId: string,
): Result<
  {
    readonly view: MissionView;
    readonly validated: ValidatedMissionDefinition;
  },
  MissionRuntimeRejection
> {
  const record = store.get(ctx.tenantId, DEFINITION_COLLECTION, missionId);
  if (record === null || record === undefined) {
    return fail("mission-not-found");
  }
  const validated = record as ValidatedMissionDefinition;
  const entries = journal.committedEntries(ctx, missionId);
  return ok({ view: foldMission(validated, entries), validated });
}

/**
 * Chains a list of events onto the committed journal: seqs continue the
 * committed sequence and each digest covers its predecessor — the whole
 * operation is one contiguous, verifiable chain segment.
 */
export function chainMissionEntries(
  journal: MissionJournal,
  ctx: TenantContext,
  missionId: string,
  events: ReadonlyArray<MissionJournalEvent>,
  now: number,
): ReadonlyArray<MissionJournalEntry> {
  const committed = journal.committedEntries(ctx, missionId);
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
export function buildIssuanceEvents(input: {
  readonly ctx: TenantContext;
  readonly missionId: string;
  readonly view: MissionView;
  readonly validated: ValidatedMissionDefinition;
  readonly now: number;
  readonly guards: GuardEvaluator;
  readonly commandSubmit: CommandSubmitPort;
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
        !input.guards.evaluate({
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
    const submit = input.commandSubmit.submit({
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
 * Builds the resume events: the mission-resumed event (carrying the last
 * recorded checkpoint) plus a work-order RE-SUBMISSION for every
 * IN-FLIGHT (running) stage with the SAME idempotency key — the port
 * dedupes, so nothing is executed twice. Completed stages are never
 * re-issued.
 */
export function buildResumeEvents(input: {
  readonly ctx: TenantContext;
  readonly missionId: string;
  readonly view: MissionView;
  readonly now: number;
  readonly commandSubmit: CommandSubmitPort;
}): Result<ReadonlyArray<MissionJournalEvent>, MissionRuntimeRejection> {
  const events: MissionJournalEvent[] = [
    {
      kind: "mission-resumed",
      checkpointId: input.view.lastCheckpoint?.checkpointId,
      stageId: input.view.lastCheckpoint?.stageId,
    },
  ];
  for (const stage of input.view.stages) {
    if (stage.state !== "running") continue;
    const key = workOrderIdempotencyKey(input.missionId, stage.stageId);
    const submit = input.commandSubmit.submit({
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
  return ok(events);
}

/**
 * THE atomic boundary: journal entries (+ optional mission-record write)
 * and one outbox event PER entry are staged in the SAME session and
 * committed together. Any failure rolls back — no journal residue, no
 * outbox residue (A14, machine-tested).
 */
export function applyJournalEntries(input: {
  readonly ctx: TenantContext;
  readonly missionId: string;
  readonly entries: ReadonlyArray<MissionJournalEntry>;
  readonly definitionRecord?: ValidatedMissionDefinition;
  readonly now: number;
  readonly store: MissionStore;
  readonly outbox: InMemoryMissionOutbox;
}): Result<void, MissionRuntimeRejection> {
  if (input.entries.length === 0) return ok(undefined);
  const session = input.store.openSession({ ctx: input.ctx, now: input.now });
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
    const published = input.outbox.publish({
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
