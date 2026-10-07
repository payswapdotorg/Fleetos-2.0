/**
 * @fleetos/convergence — public entry (F231, Wave 3 TL lane).
 *
 * The Intelligence/application CONVERGENCE package: the one sanctioned
 * composition site where the real implementations of the Control Plane
 * (command bus), the Application Services (durable mission runtime), the
 * Fleet Domain Kernel (transactional session / outbox / UnitOfWork) and
 * the Intelligence Plane (world model + world context + predictive ModelPort
 * + model gateway + agent organizations) are wired together.
 *
 * Assemblies:
 *   - `assembleMissionStack` + `driveMission` — the durable mission stack
 *     (mission runtime + command queue via `queueAsSubmitPort` + execution
 *     ledger + kernel driver/outbox/UnitOfWork).
 *   - `assembleModelStack` — budget-gated model selection with provider
 *     fallback and org reason-code propagation (BudgetCheckPort ←
 *     checkAgentBudget).
 *   - `assembleAdvisoryLoop` — world-context assembly → predictive ModelPort
 *     reference adapter → advisory predictions with provenance (the advisory
 *     law is structural in the output type).
 *
 * Pure deterministic TypeScript. Imports ONLY from the public entry points
 * of the composed packages. No Date.now, no Math.random, no timers, no
 * network, no new runtime dependencies.
 */

export {
  assembleMissionStack,
  type MissionKernelComposition,
  type MissionStack,
  type MissionStackOptions,
} from "./mission-assembly.js";
export {
  driveMission,
  type DriveOutcome,
  type KernelRunLogEntry,
  type MissionDriveState,
  type MissionScenario,
  type ScenarioOutcome,
} from "./mission-drive.js";
export {
  assembleModelStack,
  type BudgetRefusedCandidate,
  type ModelStack,
  type ModelStackOptions,
  type ModelStackRequest,
  type ModelStackSelection,
} from "./model-stack-assembly.js";
export {
  assembleAdvisoryLoop,
  DEFAULT_ADVISORY_STALENESS,
  isAdvisoryLoopOutput,
  type AdvisoryLoop,
  type AdvisoryLoopOptions,
  type AdvisoryLoopOutput,
  type AdvisoryLoopRequest,
  type AdvisoryLoopResult,
  type AdvisoryRejection,
} from "./advisory-assembly.js";
