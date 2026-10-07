/**
 * @fleetos/control-tower — public entry.
 *
 * The FleetOS Control Tower (F241, Wave 4 TL lane): THE sanctioned
 * application-composition site for the Wave 4 experience lanes
 * (ARCHITECTURE-LOCK: FleetOS Experience → Control Plane → Domain Kernel —
 * this package is the top of that stack).
 *
 *   - `./tower-assembly`     — `assembleControlTower`: the tenant-scoped
 *     cockpit over the three lanes' REAL read-model outputs, global
 *     rollups, typed drill-down refs, the deterministic cross-lane
 *     attention queue, one tower-level FNV-1a digest + verify.
 *   - `./command-registry`   — the universal command surface: a typed
 *     registry over the lanes' CommandDraft shapes, submission through the
 *     REAL control-plane queue via the `queueAsSubmitPort` seam
 *     (ceilings-not-authorizations, dead-letter visibility).
 *   - `./search`             — universal deterministic ranked token search
 *     over the tower's read-models producing typed refs.
 *   - `./mission-replay-view`— the "replay important missions" surface:
 *     chain-verified mission journals + the folded snapshot with
 *     checkpoint/resume visibility.
 *
 * Pure deterministic TypeScript. All composed packages are consumed through
 * their public entry points only — never deep paths. Tenant fail-closed
 * everywhere; logical `now` inputs everywhere.
 */

export * from "./tower-assembly.js";
export * from "./command-registry.js";
export * from "./search.js";
export * from "./mission-replay-view.js";
export type { TowerLane } from "./tower-core.js";
export { TOWER_SCHEMA_VERSION } from "./tower-core.js";
