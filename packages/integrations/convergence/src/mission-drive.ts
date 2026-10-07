/**
 * @fleetos/convergence — `driveMission`, the deterministic drive helper for
 * the composed mission stack (F231).
 *
 * Submits a mission on a composed stack, then pumps the command queue at
 * explicit logical times (ticks): each tick drains everything due, runs the
 * scenario's scripted outcome for every claimed work order (complete →
 * queue.complete + runtime.completeStage; fail → queue.fail with the
 * deterministic retry ladder, dead-letter → runtime.failStage so the mission
 * journal records the failure atomically), records the transitions in the
 * execution ledger, and writes a per-tick run-log entry through the KERNEL
 * UnitOfWork session (kernel driver + kernel outbox in the same atomic
 * boundary). The final state exposes the journal, the folded mission view,
 * the queue records, the ledger chain and the outbox events — the inputs the
 * composition tests assert consistency over.
 *
 * Determinism laws: pure with respect to the stack + scenario, `now` always
 * an explicit input, no Date.now/Math.random/timers/network.
 */

import type { OutboxEvent, TenantContext } from "@fleetos/kernel";
import type { CommandRecord, LedgerEntry } from "@fleetos/control-plane";
import type {
  MissionDefinition,
  MissionJournalEntry,
  MissionView,
} from "@fleetos/mission";
import type { MissionStack } from "./mission-assembly.js";

// ---------------------------------------------------------------------------
// Scenario + result contracts
// ---------------------------------------------------------------------------

/** One scripted executor outcome for a single work-order attempt. */
export type ScenarioOutcome =
  | { readonly kind: "complete" }
  | { readonly kind: "fail"; readonly reason: string };

export interface MissionScenario {
  readonly ctx: TenantContext;
  readonly definition: MissionDefinition;
  readonly missionId: string;
  /** Logical time the mission is created + started (work orders issued). */
  readonly startsAt: number;
  /** Ascending logical times at which the queue is drained + executed. */
  readonly ticks: ReadonlyArray<number>;
  /** Per stage, the scripted outcome of each attempt IN ORDER. */
  readonly stageOutcomes: Readonly<Record<string, ReadonlyArray<ScenarioOutcome>>>;
}

/** A run-log record written through the kernel UnitOfWork at each tick. */
export interface KernelRunLogEntry {
  readonly missionId: string;
  readonly tick: number;
  readonly claimed: number;
}

export interface MissionDriveState {
  readonly missionId: string;
  readonly view: MissionView;
  readonly journal: ReadonlyArray<MissionJournalEntry>;
  readonly commands: ReadonlyArray<CommandRecord>;
  readonly ledger: ReadonlyArray<LedgerEntry>;
  readonly outboxEvents: ReadonlyArray<OutboxEvent>;
  readonly kernelRunLog: ReadonlyArray<KernelRunLogEntry>;
  readonly kernelOutboxEvents: ReadonlyArray<OutboxEvent>;
}

export type DriveOutcome =
  | { readonly ok: true; readonly state: MissionDriveState }
  | { readonly ok: false; readonly failedAt: string; readonly reason: string };

// ---------------------------------------------------------------------------
// The drive
// ---------------------------------------------------------------------------

interface WorkOrderPayload {
  readonly missionId?: string;
  readonly stageId?: string;
}

export function driveMission(
  stack: MissionStack,
  scenario: MissionScenario,
): DriveOutcome {
  const { ctx, missionId } = scenario;
  const ledgered = new Set<string>();
  const attempts = new Map<string, number>();
  const runLog: KernelRunLogEntry[] = [];

  const created = stack.runtime.createMission({
    ctx,
    definition: scenario.definition,
    missionId,
    now: scenario.startsAt,
  });
  if (!created.ok) return driveFail("createMission", created.reason);
  const started = stack.runtime.startMission({ ctx, missionId, now: scenario.startsAt });
  if (!started.ok) return driveFail("startMission", started.reason);
  ledgerSubmissions(stack, ctx, ledgered, scenario.startsAt);

  for (const tick of scenario.ticks) {
    const claimed = stack.queue.drain({ ctx, now: tick });
    for (const record of claimed) {
      const commandId = String(record.envelope.id);
      const ledged = stack.ledger.append({
        ctx,
        commandId,
        kind: "acknowledged",
        attempt: record.attempts,
        at: tick,
      });
      if (!ledged.ok) return driveFail("ledger.acknowledged", ledged.reason);
      const payload = record.envelope.payload as WorkOrderPayload;
      const stageId = typeof payload?.stageId === "string" ? payload.stageId : null;
      if (stageId === null) continue; // not a mission work order — left executing
      const outcome = nextOutcome(scenario, attempts, stageId);
      if (outcome.kind === "complete") {
        const completed = stack.queue.complete({
          ctx,
          commandId,
          result: { stageId, tick },
          now: tick,
        });
        if (!completed.ok) return driveFail("queue.complete", completed.reason);
        const ledgedDone = stack.ledger.append({
          ctx,
          commandId,
          kind: "completed",
          attempt: record.attempts,
          at: tick,
        });
        if (!ledgedDone.ok) return driveFail("ledger.completed", ledgedDone.reason);
        const stageDone = stack.runtime.completeStage({ ctx, missionId, stageId, now: tick });
        if (!stageDone.ok) return driveFail("completeStage", stageDone.reason);
      } else {
        const failed = stack.queue.fail({ ctx, commandId, reason: outcome.reason, now: tick });
        if (!failed.ok) return driveFail("queue.fail", failed.reason);
        const ledgedFail = stack.ledger.append({
          ctx,
          commandId,
          kind: "attempt-failed",
          attempt: record.attempts,
          at: tick,
          reason: outcome.reason,
        });
        if (!ledgedFail.ok) return driveFail("ledger.attempt-failed", ledgedFail.reason);
        if (failed.value.state === "dead-lettered") {
          // The dead-letter is the atomic mission-side record: stage-failed +
          // mission-failed are appended in ONE session commit (no dual-write
          // gap — law A14).
          const ledgedDl = stack.ledger.append({
            ctx,
            commandId,
            kind: "dead-lettered",
            attempt: record.attempts,
            at: tick,
            reason: failed.value.reason,
          });
          if (!ledgedDl.ok) return driveFail("ledger.dead-lettered", ledgedDl.reason);
          const stageFailed = stack.runtime.failStage({
            ctx,
            missionId,
            stageId,
            reason: failed.value.reason,
            now: tick,
          });
          if (!stageFailed.ok) return driveFail("failStage", stageFailed.reason);
        } else {
          const ledgedRetry = stack.ledger.append({
            ctx,
            commandId,
            kind: "retry-scheduled",
            attempt: record.attempts,
            at: tick,
          });
          if (!ledgedRetry.ok) return driveFail("ledger.retry-scheduled", ledgedRetry.reason);
        }
      }
      ledgerSubmissions(stack, ctx, ledgered, tick);
    }
    // Kernel UnitOfWork boundary: run-log write + kernel outbox event in the
    // SAME kernel transaction (the composition's application-level write).
    const kernelTick = recordKernelTick(stack, ctx, missionId, tick, claimed.length);
    if (!kernelTick.ok) return driveFail("kernel-unit-of-work", kernelTick.reason);
    runLog.push(kernelTick.entry);
  }

  const view = stack.runtime.missionView(ctx, missionId);
  if (!view.ok) return driveFail("missionView", view.reason);
  const journal = stack.runtime.journalEntries(ctx, missionId);
  if (!journal.ok) return driveFail("journalEntries", journal.reason);
  return {
    ok: true,
    state: {
      missionId,
      view: view.value,
      journal: journal.value,
      commands: stack.queue.listByTenant(ctx),
      ledger: stack.ledger.entriesFor(ctx),
      outboxEvents: stack.outbox.eventsFor(ctx),
      kernelRunLog: runLog,
      kernelOutboxEvents: stack.kernel.outbox.pending({ ctx, now: Number.MAX_SAFE_INTEGER }),
    },
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function nextOutcome(
  scenario: MissionScenario,
  attempts: Map<string, number>,
  stageId: string,
): ScenarioOutcome {
  const n = (attempts.get(stageId) ?? 0) + 1;
  attempts.set(stageId, n);
  const scripted = scenario.stageOutcomes[stageId]?.[n - 1];
  if (scripted === undefined) {
    // Honest deterministic default: an unscripted attempt fails loudly.
    return { kind: "fail", reason: "outcome-not-scripted" };
  }
  return scripted;
}

/** Ledger `submitted` entries for commands not yet recorded as submitted. */
function ledgerSubmissions(
  stack: MissionStack,
  ctx: TenantContext,
  ledgered: Set<string>,
  now: number,
): void {
  for (const record of stack.queue.listByTenant(ctx)) {
    const id = String(record.envelope.id);
    if (ledgered.has(id)) continue;
    ledgered.add(id);
    stack.ledger.append({
      ctx,
      commandId: id,
      kind: "submitted",
      attempt: 0,
      at: record.envelope.submittedAt || now,
    });
  }
}

function recordKernelTick(
  stack: MissionStack,
  ctx: TenantContext,
  missionId: string,
  tick: number,
  claimed: number,
): { readonly ok: true; readonly entry: KernelRunLogEntry } | { readonly ok: false; readonly reason: string } {
  const entry: KernelRunLogEntry = { missionId, tick, claimed };
  const opened = stack.kernel.unitOfWork.open(ctx);
  if (!opened.ok) return { ok: false, reason: String(opened.reason) };
  const unit = opened.value;
  const staged = unit.execute((session) =>
    session.stage((stage) => {
      stage.put("mission-run-log", `${missionId}@${tick}`, { ...entry });
    }),
  );
  if (!staged.ok) return { ok: false, reason: String(staged.reason) };
  const published = unit.publish({
    type: "mission.run-log",
    payload: { ...entry },
    idempotencyKey: `runlog::${String(ctx.tenantId)}::${missionId}@${tick}`,
    occurredAt: tick,
    causationId: missionId,
    correlationId: missionId,
  });
  if (!published.ok) return { ok: false, reason: String(published.reason) };
  const committed = unit.commit();
  if (!committed.ok) return { ok: false, reason: String(committed.reason) };
  return { ok: true, entry };
}

function driveFail(failedAt: string, reason: unknown): DriveOutcome {
  return { ok: false, failedAt, reason: String(reason) };
}
