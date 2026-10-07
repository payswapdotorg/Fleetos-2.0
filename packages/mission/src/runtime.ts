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
 * Module map (split under the max-lines lint budget; public surface
 * unchanged):
 * - `runtime-contracts.ts` — the CommandSubmitPort / GuardEvaluator
 *   TYPE seams, the rejection vocabulary, the operation result.
 * - `runtime-fold.ts` — the fold logic: journal chaining, ready-stage
 *   work-order issuance, resume re-issuance, the atomic commit
 *   boundary.
 * - `runtime-engine.ts` — `MissionRuntime`, the mission state machine.
 *
 * This file remains the `./runtime` subpath entry: it re-exports
 * exactly the symbols the runtime has always published — nothing more,
 * nothing less.
 *
 * Determinism laws: pure functions, `now` always an explicit input, no
 * Date.now/Math.random/timers/network.
 */

export { MissionRuntime } from "./runtime-engine.js";
export {
  ALLOW_ALL_GUARDS,
  type CommandSubmitAck,
  type CommandSubmitPort,
  type GuardEvaluator,
  type MissionOpResult,
  type MissionRuntimeRejection,
} from "./runtime-contracts.js";
