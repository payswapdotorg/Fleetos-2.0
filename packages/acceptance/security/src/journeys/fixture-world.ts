/**
 * @fleetos/acceptance-security — shared deterministic fixture world (F270B).
 *
 * ONE fixed logical universe every journey starts from: one tenant
 * ("acme-ops"), one rival tenant ("globex-rival"), a fixed logical epoch,
 * real Capability/Policy/Guardian fixtures, a linear twin observation series
 * and world journals built through the REAL `nextWorldEntry`.
 *
 * Determinism: every value is a fixed constant or pure function of one. No
 * Date.now(), no Math.random(), no wall-clock — `isoOfEpochMs` converts a
 * logical epoch ms to an ISO string with pure integer arithmetic.
 */

import type { AuthorityKind, Capability, GuardianContext, Policy } from "@fleetos/policy";
import type { WorldEvent, WorldJournalEntry } from "@fleetos/world-model";
import { nextWorldEntry } from "@fleetos/world-model";
import type { AdmittedFinding, SecurityFinding } from "@fleetos/security";

// ---------------------------------------------------------------------------
// Tenants + logical time
// ---------------------------------------------------------------------------

export const TENANT = { tenantId: "acme-ops" } as const;
export const FOREIGN_TENANT = { tenantId: "globex-rival" } as const;

/** Fixed logical epoch base — 2026-10-12T18:40:00.000Z in epoch ms. */
export const BASE_MS = 1_791_830_400_000;
/** Fixed logical "now" used by every journey read model (18:50:00Z). */
export const NOW_MS = BASE_MS + 600_000;
/** ISO string of the logical "now" (for `computedAt`-style string fields). */
export const NOW_ISO = "2026-10-12T18:50:00.000Z";
/** Staleness thresholds shared by journeys (fresh < 10s <= stale-ish < 60s). */
export const STALENESS_THRESHOLDS = { freshWithinMs: 10_000, staleWithinMs: 60_000 } as const;

/** Pure civil-from-days (Howard Hinnant's algorithm) — integer math only. */
function civilFromDays(z: number): { readonly y: number; readonly m: number; readonly d: number } {
  const zz = z + 719468;
  const era = Math.floor(zz / 146097);
  const doe = zz - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return { y: m <= 2 ? y + 1 : y, m, d };
}

/** Deterministic epoch-ms -> ISO-8601 UTC string (pure integer arithmetic). */
export function isoOfEpochMs(ms: number): string {
  const days = Math.floor(ms / 86_400_000);
  const rem = ms - days * 86_400_000;
  const { y, m, d } = civilFromDays(days);
  const hh = Math.floor(rem / 3_600_000);
  const mi = Math.floor((rem - hh * 3_600_000) / 60_000);
  // F300B fix: the seconds field was previously computed WITHOUT the
  // /1000 division (a latent defect — sub-minute offsets rendered as
  // malformed "18:50:500.000Z"-style strings). Surfaced by the F300B
  // mission-replay journey, which re-parses emittedAt timestamps.
  const ss = Math.floor((rem - hh * 3_600_000 - mi * 60_000) / 1_000);
  const msec = rem - hh * 3_600_000 - mi * 60_000 - ss * 1_000;
  const p2 = (n: number): string => String(n).padStart(2, "0");
  return `${String(y).padStart(4, "0")}-${p2(m)}-${p2(d)}T${p2(hh)}:${p2(mi)}:${p2(ss)}.${String(msec).padStart(3, "0")}Z`;
}

// ---------------------------------------------------------------------------
// Capabilities (law A15 vocabulary — full Capability shapes)
// ---------------------------------------------------------------------------

export const READ_CAPABILITY: Capability = {
  id: "fleetos.asset.read-state",
  category: "read",
  risk: "low",
  requiredAuthority: [],
  tenantScope: "single",
  resourceScope: { assetIds: ["pump-7"] },
  sideEffects: [],
  idempotency: { supported: true, keyShape: ["tenantId", "capabilityId"] },
  verification: { kind: "domain.read" },
  inputs: ["assetId"],
  outputs: ["state"],
  description: "Read asset operational state",
  version: "1.0.0",
};

export const EXECUTE_CAPABILITY: Capability = {
  id: "fleetos.device.execute-command",
  category: "execute.device",
  risk: "high",
  requiredAuthority: ["asset.owner", "human.approval"],
  tenantScope: "single",
  resourceScope: { assetIds: ["pump-7"] },
  sideEffects: [{ kind: "device.command", target: "pump-7", reversible: false, description: "command dispatch" }],
  idempotency: { supported: true, keyShape: ["tenantId", "capabilityId", "nonce"] },
  verification: { kind: "device.ack", timeoutMs: 30_000 },
  inputs: ["assetId", "command"],
  outputs: ["ack"],
  description: "Execute a device command (high risk, approval required)",
  version: "1.2.0",
};

export const IRREVERSIBLE_CAPABILITY: Capability = {
  id: "fleetos.asset.decommission",
  category: "mutate.asset",
  risk: "irreversible",
  requiredAuthority: ["tenant.operator"],
  tenantScope: "single",
  resourceScope: { assetIds: ["pump-7"] },
  sideEffects: [{ kind: "domain.write", target: "pump-7", reversible: false, description: "decommission" }],
  idempotency: { supported: false, keyShape: [] },
  verification: { kind: "evidence.hash" },
  inputs: ["assetId"],
  outputs: ["decommissionRecord"],
  description: "Decommission an asset (irreversible)",
  version: "1.0.0",
};

// ---------------------------------------------------------------------------
// Policy + Guardian contexts
// ---------------------------------------------------------------------------

/** The tenant policy every Guardian journey evaluates against. */
export function tenantPolicy(tenantId: string = TENANT.tenantId): Policy {
  return {
    id: "policy-acme-ops",
    version: "7",
    tenantId,
    rules: [
      {
        id: "rule.allow_low_risk_read",
        description: "Low-risk reads are allowed",
        riskFloor: "low",
        riskCeiling: "low",
        requiredAuthority: [],
        tenantScope: "any",
        verdict: "ALLOW",
        priority: 100,
      },
      {
        id: "rule.block_irreversible_without_operator",
        description: "Irreversible actions blocked without operator authority",
        riskFloor: "irreversible",
        riskCeiling: "irreversible",
        requiredAuthority: ["tenant.operator"],
        tenantScope: "single",
        verdict: "BLOCK",
        priority: 90,
      },
      {
        id: "rule.require_human_approval_for_high_risk",
        description: "High-risk execution requires human approval",
        riskFloor: "high",
        riskCeiling: "severe",
        requiredAuthority: ["human.approval"],
        tenantScope: "single",
        verdict: "REQUIRE_APPROVAL",
        priority: 80,
      },
    ],
    defaultVerdict: "BLOCK",
    failClosed: true,
  };
}

function contextFor(
  tenantId: string,
  capability: Capability,
  actorId: string,
  authority: readonly AuthorityKind[],
  isAutonomous: boolean,
): GuardianContext {
  return {
    tenant: { tenantId },
    capability,
    actor: { actorId, authority, isAutonomous },
    degraded: false,
  };
}

export const ANALYST_CTX = (capability: Capability): GuardianContext =>
  contextFor(TENANT.tenantId, capability, "analyst-kim", ["tenant.engineer"], false);

export const OPERATOR_CTX = (capability: Capability): GuardianContext =>
  contextFor(TENANT.tenantId, capability, "operator-ada", ["tenant.operator", "human.approval", "asset.owner"], false);

export const AUTONOMOUS_AGENT_CTX = (capability: Capability): GuardianContext =>
  contextFor(TENANT.tenantId, capability, "agent-fleetos-01", ["guardian.autonomous"], true);

export const AUTONOMOUS_WITH_APPROVAL_CTX = (capability: Capability): GuardianContext =>
  contextFor(TENANT.tenantId, capability, "agent-fleetos-01", ["guardian.autonomous", "human.approval", "asset.owner"], true);

// ---------------------------------------------------------------------------
// Twin observation series + world journals (REAL nextWorldEntry chains)
// ---------------------------------------------------------------------------

/** Linear vibration series for pump-7 — drift 0.01/ms, step values 40/50/60. */
export const PUMP_OBSERVATIONS = [
  { observationRef: "obs-pump-7-1", atMs: BASE_MS + 1_000, value: 10 },
  { observationRef: "obs-pump-7-2", atMs: BASE_MS + 2_000, value: 20 },
  { observationRef: "obs-pump-7-3", atMs: BASE_MS + 3_000, value: 30 },
] as const;

/** Twin state input for the reference model (authoritative-shaped input). */
export function pumpTwinState() {
  return {
    tenant: TENANT,
    asset: { assetId: "pump-7" },
    metric: "vibration",
    observations: PUMP_OBSERVATIONS.map((o) => ({ ...o })),
    asOfMs: BASE_MS + 3_000,
  };
}

function observationEvent(entityId: string, ref: string, atMs: number, value: number): WorldEvent {
  return { kind: "observation-recorded", entityId, entityType: "asset", observationRef: ref, observedAtMs: atMs, value };
}

/** Build a digest-chained world journal through the REAL nextWorldEntry. */
export function buildJournal(
  tenantId: string,
  specs: readonly { readonly atMs: number; readonly event: WorldEvent }[],
): WorldJournalEntry[] {
  const entries: WorldJournalEntry[] = [];
  for (const spec of specs) {
    entries.push(nextWorldEntry({ tenantId, existing: entries, event: spec.event, atMs: spec.atMs }));
  }
  return entries;
}

/** Pump-7 journal: register + three observations (linear series). */
export function pumpJournal(): WorldJournalEntry[] {
  return buildJournal(TENANT.tenantId, [
    { atMs: BASE_MS + 1_000, event: { kind: "entity-registered", entityId: "pump-7", entityType: "asset" } },
    ...PUMP_OBSERVATIONS.map((o) => ({
      atMs: o.atMs,
      event: observationEvent("pump-7", o.observationRef, o.atMs, o.value),
    })),
  ]);
}

// ---------------------------------------------------------------------------
// Finding mapping — AdmittedFinding (intake output) -> SecurityFinding
// ---------------------------------------------------------------------------

/** Map a REAL intake-admitted finding onto the domain SecurityFinding shape. */
export function findingRecord(f: AdmittedFinding): SecurityFinding {
  return {
    findingId: f.findingId,
    tenantId: f.tenantId,
    kind: f.kind,
    severity: f.severity,
    confidence: f.confidence,
    detectedAt: isoOfEpochMs(f.detectedAt),
    assetIds: [...f.assetIds],
    description: f.description,
    evidenceRefs: [...f.evidenceRefs],
    findingDigest: f.fingerprint,
  };
}
