/**
 * @fleetos/sim-worlds — scenario fault injection (F260A).
 *
 * A `FaultScenario` scripts deterministic operational faults against a
 * fleet world: an asset fails at step k (regardless of rate draws), a
 * link is forced down for a window [fromStep, untilStep), or a
 * maintenance action due at step k is skipped. Faults are applied by
 * the world engine at exactly-addressed logical steps — never by
 * ambient chance — so a scenario is fully reproducible.
 *
 * Laws:
 *  - scenario digest (FNV-1a convention) + verify — tamper-evident;
 *  - tenant fail-closed: world + scenario must carry the SAME tenant,
 *    the SAME worldId — cross-tenant or cross-world application is
 *    REFUSED (fail-closed, reason-coded);
 *  - validation is deterministic: faults must be sorted
 *    (atStep, kind, target) — unsorted input is refused;
 *  - pure deterministic TS; logical `now` everywhere.
 */

import { canonicalJson, fnv1a32 } from "./determinism.js";
import type { FleetWorld } from "./world-definition.js";

/** Scripted fault kinds. */
export type FaultKind = "asset-failure" | "link-outage" | "maintenance-skip";

export interface AssetFailureFault {
  readonly kind: "asset-failure";
  readonly assetId: string;
  /** The asset fails at exactly this logical step (≥ 0). */
  readonly atStep: number;
}

export interface LinkOutageFault {
  readonly kind: "link-outage";
  readonly linkId: string;
  /** Forced-down window: steps in [fromStep, untilStep). */
  readonly fromStep: number;
  readonly untilStep: number;
}

export interface MaintenanceSkipFault {
  readonly kind: "maintenance-skip";
  readonly assetId: string;
  /** The maintenance-started due at this step for this asset is skipped
   * (the pending service remains for the next window). */
  readonly atStep: number;
}

export type ScenarioFault = AssetFailureFault | LinkOutageFault | MaintenanceSkipFault;

export interface FaultScenario {
  readonly scenarioId: string;
  readonly worldId: string;
  readonly tenantId: string;
  readonly description: string;
  /** Sorted by (atStep, kind, target id) — validation refuses unsorted. */
  readonly faults: readonly ScenarioFault[];
}

// ---------------------------------------------------------------------------
// Digest — FNV-1a over canonical JSON of the scenario.
// ---------------------------------------------------------------------------

export function scenarioDigest(scenario: FaultScenario): string {
  return `scenario_${fnv1a32(["fault-scenario", canonicalJson(scenario)])}`;
}

export function verifyScenarioDigest(scenario: FaultScenario, digest: string): boolean {
  return scenarioDigest(scenario) === digest;
}

// ---------------------------------------------------------------------------
// Validation — fail-closed, world-aware, reason-coded.
// ---------------------------------------------------------------------------

export type ScenarioValidationCode =
  | "missing-scenario-id"
  | "missing-tenant"
  | "world-id-mismatch"
  | "tenant-mismatch"
  | "invalid-world"
  | "unknown-asset"
  | "unknown-link"
  | "invalid-step"
  | "invalid-outage-window"
  | "non-deterministic-fault-order"
  | "duplicate-fault";

export interface ScenarioValidationIssue {
  readonly code: ScenarioValidationCode;
  readonly ref: string;
  readonly detail?: string;
}

export type ScenarioValidation =
  | { readonly ok: true; readonly digest: string }
  | { readonly ok: false; readonly issues: ReadonlyArray<ScenarioValidationIssue> };

/** Validate a scenario against the world it claims to fault.
 * Cross-tenant or cross-world application is REFUSED here — the engine
 * re-checks before every application (fail-closed, defense in depth). */
export function validateFaultScenario(scenario: FaultScenario, world: FleetWorld): ScenarioValidation {
  const issues: ScenarioValidationIssue[] = [];
  const push = (code: ScenarioValidationCode, ref: string, detail?: string): void => {
    issues.push({ code, ref, detail });
  };

  if (!scenario.scenarioId || typeof scenario.scenarioId !== "string") push("missing-scenario-id", "scenario");
  if (!scenario.tenantId || typeof scenario.tenantId !== "string") push("missing-tenant", "scenario");
  if (scenario.worldId !== world.worldId) push("world-id-mismatch", scenario.worldId, world.worldId);
  if (scenario.tenantId !== world.tenantId) push("tenant-mismatch", scenario.tenantId, world.tenantId);

  const assetIds = new Set(world.assets.map((a) => a.assetId));
  const linkIds = new Set(world.links.map((l) => l.linkId));
  const seen = new Set<string>();
  let prevKey = "";
  for (const f of scenario.faults) {
    const target = f.kind === "link-outage" ? f.linkId : f.assetId;
    const key = `${String(f.kind === "asset-failure" || f.kind === "maintenance-skip" ? f.atStep : f.fromStep)}|${f.kind}|${target}`;
    if (seen.has(key)) push("duplicate-fault", target);
    seen.add(key);
    if (key <= prevKey) push("non-deterministic-fault-order", key);
    prevKey = key;

    if (f.kind === "link-outage") {
      if (!linkIds.has(f.linkId)) push("unknown-link", f.linkId);
      if (
        !Number.isInteger(f.fromStep) || !Number.isInteger(f.untilStep) ||
        f.fromStep < 0 || f.untilStep <= f.fromStep
      ) {
        push("invalid-outage-window", f.linkId);
      }
    } else {
      if (!assetIds.has(f.assetId)) push("unknown-asset", f.assetId);
      if (!Number.isInteger(f.atStep) || f.atStep < 0) push("invalid-step", f.assetId);
    }
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, digest: scenarioDigest(scenario) };
}

// ---------------------------------------------------------------------------
// Runtime lookup helpers for the engine — pure, tenant-checked.
// ---------------------------------------------------------------------------

export type ScenarioApplicationRefusal =
  | "scenario-world-mismatch"
  | "scenario-tenant-mismatch";

/** Fail-closed gate the engine consults before applying any fault:
 * cross-tenant or cross-world scenarios refuse the WHOLE application. */
export function scenarioAppliesTo(
  scenario: FaultScenario,
  world: FleetWorld,
): { readonly ok: true } | { readonly ok: false; readonly reason: ScenarioApplicationRefusal } {
  if (scenario.worldId !== world.worldId) {
    return { ok: false, reason: "scenario-world-mismatch" };
  }
  if (scenario.tenantId !== world.tenantId) {
    return { ok: false, reason: "scenario-tenant-mismatch" };
  }
  return { ok: true };
}

/** All asset-failure faults firing at `step` (order-preserved). */
export function assetFailuresAt(scenario: FaultScenario, step: number): readonly AssetFailureFault[] {
  return scenario.faults.filter(
    (f): f is AssetFailureFault => f.kind === "asset-failure" && f.atStep === step,
  );
}

/** True when `step` falls inside a link's forced-outage window. */
export function linkForcedDownAt(scenario: FaultScenario, linkId: string, step: number): boolean {
  return scenario.faults.some(
    (f) => f.kind === "link-outage" && f.linkId === linkId && step >= f.fromStep && step < f.untilStep,
  );
}

/** True when the maintenance-started due at `step` for this asset is skipped. */
export function maintenanceSkippedAt(scenario: FaultScenario, assetId: string, step: number): boolean {
  return scenario.faults.some(
    (f) => f.kind === "maintenance-skip" && f.assetId === assetId && f.atStep === step,
  );
}
