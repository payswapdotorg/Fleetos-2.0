/**
 * host-surface test fixtures (F300B) — ONE deterministic logical universe
 * composed through the lane's REAL public builders: findings +
 * remediation records, policy + capabilities + grants, an authorized plan
 * joined to a driven command queue, a full A4 action chain with its
 * execution ledger and audit trail, a verified evidence chain, a REAL
 * reference-twin prediction and a REAL assembled world context.
 *
 * Determinism: fixed logical epoch constants only; every record is built by
 * a REAL package function (no hand-forged domain state).
 */

import {
  advanceActionState,
  emitAuditTrail,
  initPlanLifecycle,
  advancePlanLifecycle,
  proposeAction,
  stepIdempotencyKey,
} from "@fleetos/actions";
import type {
  ActionPlan,
  ActionRecord,
  PlanLifecycleRecord,
} from "@fleetos/actions";
import {
  appendExecutionLedger,
  ackCommand,
  completeCommand,
  createCommandQueue,
  submitCommand,
} from "@fleetos/execution";
import type {
  CommandQueueState,
  ExecutionLedgerEntry,
} from "@fleetos/execution";
import {
  appendEvidence,
  buildArtifact,
  buildCompleteChain,
} from "@fleetos/evidence";
import type {
  EvidenceChainEntry,
  EvidenceMetadata,
  TraceabilityChain,
} from "@fleetos/evidence";
import {
  evaluateCapability,
  evaluateRulesOrdered,
  issueGrant,
} from "@fleetos/policy";
import type {
  Capability,
  GrantRecord,
  GuardianContext,
  OrderedRuleEvaluation,
  Policy,
} from "@fleetos/policy";
import { makeReferenceModelPort } from "@fleetos/predictive";
import type { Prediction } from "@fleetos/predictive";
import { proposeRemediationRecord } from "@fleetos/security";
import type { RemediationProposalRecord, SecurityFinding } from "@fleetos/security";
import { assembleContext } from "@fleetos/world-context";
import type { AssembledContext } from "@fleetos/world-context";
import type { SafetyIntelSlice } from "../src/host/view-models.ts";
import type { HostTenantContext } from "../src/host/contract.ts";

// ---------------------------------------------------------------------------
// Logical constants
// ---------------------------------------------------------------------------

export const TENANT_ID = "acme-ops";
export const FOREIGN_TENANT_ID = "globex-rival";
export const BASE_MS = 1_791_830_400_000;
export const NOW_MS = BASE_MS + 600_000;
export const THRESHOLDS = { freshWithinMs: 10_000, staleWithinMs: 60_000 } as const;

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
function iso(ms: number): string {
  const days = Math.floor(ms / 86_400_000);
  const rem = ms - days * 86_400_000;
  const { y, m, d } = civilFromDays(days);
  const hh = Math.floor(rem / 3_600_000);
  const mi = Math.floor((rem - hh * 3_600_000) / 60_000);
  const ss = Math.floor((rem - hh * 3_600_000 - mi * 60_000) / 1_000);
  const msec = rem - hh * 3_600_000 - mi * 60_000 - ss * 1_000;
  const p2 = (n: number): string => String(n).padStart(2, "0");
  return `${String(y).padStart(4, "0")}-${p2(m)}-${p2(d)}T${p2(hh)}:${p2(mi)}:${p2(ss)}.${String(msec).padStart(3, "0")}Z`;
}

export function hostCtx(over: Partial<HostTenantContext> = {}): HostTenantContext {
  return {
    tenantId: TENANT_ID,
    actorId: "operator-ada",
    sessionId: "session-1",
    establishedAt: NOW_MS - 30_000,
    scope: "tenant",
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Policy + capabilities + grants (REAL builders)
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

export function tenantPolicy(tenantId: string = TENANT_ID): Policy {
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

export function operatorCtx(capability: Capability): GuardianContext {
  return {
    tenant: { tenantId: TENANT_ID },
    capability,
    actor: { actorId: "operator-ada", authority: ["tenant.operator", "human.approval", "asset.owner"], isAutonomous: false },
    degraded: false,
  };
}

export function grants(): readonly GrantRecord[] {
  const result = issueGrant([], {
    grantId: "grant-execute-1",
    tenantId: TENANT_ID,
    capabilityId: EXECUTE_CAPABILITY.id,
    granteeActorId: "operator-ada",
    grantedByActorId: "tenant-admin",
    grantedAt: NOW_MS - 60_000,
    expiresAt: NOW_MS + 3_600_000,
  });
  if (!result.ok) throw new Error(`grant refused: ${result.reason}`);
  return result.grants;
}

// ---------------------------------------------------------------------------
// Findings + remediation (REAL intake-shaped records)
// ---------------------------------------------------------------------------

export function findings(tenantId: string = TENANT_ID): readonly SecurityFinding[] {
  return [
    {
      findingId: "finding-weak-cred-1",
      tenantId,
      kind: "auth.weak_credential",
      severity: "high",
      confidence: "confirmed",
      detectedAt: iso(NOW_MS - 120_000),
      assetIds: ["pump-7"],
      description: "Weak operator credential on pump-7 control plane",
      evidenceRefs: ["ev-intake-1"],
      findingDigest: "a1b2c3d4",
    },
    {
      findingId: "finding-open-ingress-1",
      tenantId,
      kind: "network.open_ingress",
      severity: "medium",
      confidence: "probable",
      detectedAt: iso(NOW_MS - 90_000),
      assetIds: ["pump-7"],
      description: "Open ingress on the maintenance network",
      evidenceRefs: ["ev-intake-2"],
      findingDigest: "b2c3d4e5",
    },
  ];
}

export function remediations(tenantId: string = TENANT_ID): readonly RemediationProposalRecord[] {
  const result = proposeRemediationRecord({
    proposalId: "prop-rotate-1",
    tenantId,
    findingIds: ["finding-weak-cred-1"],
    remediationKind: "rotate_credential",
    at: NOW_MS - 60_000,
  });
  if (!result.ok) throw new Error(`remediation refused: ${result.reason}`);
  return [result.record];
}

// ---------------------------------------------------------------------------
// Plan + lifecycle + queue (REAL plan pipeline + queue)
// ---------------------------------------------------------------------------

export const PLAN: ActionPlan = {
  planId: "plan-isolate-1",
  tenant: { tenantId: TENANT_ID },
  steps: [
    {
      stepId: "step-1",
      capability: EXECUTE_CAPABILITY,
      inputs: { assetId: "pump-7", command: "isolate" },
      idempotencyNonce: "nonce-1",
    },
  ],
};

export function lifecycle(): PlanLifecycleRecord {
  const init = initPlanLifecycle(PLAN, 1);
  if (!init.ok) throw new Error(`lifecycle init refused: ${init.reason}`);
  const advanced = advancePlanLifecycle(init.record, "authorized", {
    tenantId: TENANT_ID,
    actorId: "operator-ada",
    at: NOW_MS + 1_000,
  });
  if (!advanced.ok) throw new Error(`lifecycle advance refused: ${advanced.reason}`);
  return advanced.record;
}

export function queue(): CommandQueueState {
  const created = createCommandQueue(TENANT_ID);
  if (!created.ok) throw new Error("queue creation refused");
  let state = created.state;
  const key = stepIdempotencyKey(PLAN.planId, "step-1", "nonce-1");
  const submitted = submitCommand(state, {
    idempotencyKey: key,
    capabilityId: EXECUTE_CAPABILITY.id,
    payloadInputs: { assetId: "pump-7", command: "isolate" },
    at: NOW_MS + 2_000,
    tenantId: TENANT_ID,
    authorizationDigest: "digest-allow-1",
    verdict: "ALLOW",
  });
  if (!submitted.ok) throw new Error("submit refused");
  state = submitted.state;
  const acked = ackCommand(state, key, NOW_MS + 3_000, TENANT_ID);
  if (!acked.ok) throw new Error("ack refused");
  state = acked.state;
  const completed = completeCommand(state, key, { ack: true }, NOW_MS + 4_000, TENANT_ID);
  if (!completed.ok) throw new Error("complete refused");
  return completed.state;
}

// ---------------------------------------------------------------------------
// Execution ledger (REAL append-only chain)
// ---------------------------------------------------------------------------

export function ledger(): readonly ExecutionLedgerEntry[] {
  const key = stepIdempotencyKey(PLAN.planId, "step-1", "nonce-1");
  const appends = [
    { tenantId: TENANT_ID, idempotencyKey: key, kind: "submitted" as const, at: NOW_MS + 2_000, detail: "" },
    { tenantId: TENANT_ID, idempotencyKey: key, kind: "acked" as const, at: NOW_MS + 3_000, detail: "" },
    { tenantId: TENANT_ID, idempotencyKey: key, kind: "completed" as const, at: NOW_MS + 4_000, detail: "ack=true" },
  ];
  let chain: readonly ExecutionLedgerEntry[] = [];
  for (const input of appends) {
    const result = appendExecutionLedger(chain, input);
    if (!result.ok) throw new Error(`ledger append refused: ${result.reason}`);
    chain = result.ledger;
  }
  return chain;
}

// ---------------------------------------------------------------------------
// The action chain + evaluation + trace (REAL A4 protocol)
// ---------------------------------------------------------------------------

const INTENT_ID = "intent-isolate-pump-7";

export function actionRecord(): ActionRecord {
  const decision = evaluateCapability(tenantPolicy(), EXECUTE_CAPABILITY, operatorCtx(EXECUTE_CAPABILITY));
  let record = proposeAction({
    intentId: INTENT_ID,
    tenant: { tenantId: TENANT_ID },
    capability: EXECUTE_CAPABILITY,
    idempotencyKey: { tenantId: TENANT_ID, capabilityId: EXECUTE_CAPABILITY.id, nonce: "nonce-1" },
    inputs: { assetId: "pump-7", command: "isolate" },
    proposedAt: iso(NOW_MS),
    proposedBy: "engineer-raj",
  });
  const steps: readonly [ActionRecord["state"], Parameters<typeof advanceActionState>[2]][] = [
    ["authorized", { at: iso(NOW_MS + 1_000), authorization: decision, tenantId: TENANT_ID }],
    ["confirmed", { at: iso(NOW_MS + 2_000), confirmedBy: "operator-ada", tenantId: TENANT_ID }],
    ["dispatched", { at: iso(NOW_MS + 3_000), dispatchReceipt: stepIdempotencyKey(PLAN.planId, "step-1", "nonce-1"), tenantId: TENANT_ID }],
    ["executing", { at: iso(NOW_MS + 3_500), tenantId: TENANT_ID }],
    ["executed", { at: iso(NOW_MS + 4_000), executionResult: { succeeded: true, outputs: { ack: true }, executedAt: iso(NOW_MS + 4_000) }, tenantId: TENANT_ID }],
    ["verified", { at: iso(NOW_MS + 5_000), verificationRecord: { verified: true, verifierKind: "device.ack" as const, verifiedAt: iso(NOW_MS + 5_000), proofRef: "ev-verification-1" }, tenantId: TENANT_ID }],
    ["recorded", { at: iso(NOW_MS + 6_000), evidenceRef: "ev-act-1", tenantId: TENANT_ID }],
  ];
  for (const [target, ctx] of steps) {
    const result = advanceActionState(record, target, ctx);
    if (!result.ok) throw new Error(`advance to ${target} refused: ${result.reason}`);
    record = result.record;
  }
  return record;
}

export function evaluation(): OrderedRuleEvaluation {
  const result = evaluateRulesOrdered(tenantPolicy(), EXECUTE_CAPABILITY, operatorCtx(EXECUTE_CAPABILITY));
  if (!result.ok) throw new Error(`ordered evaluation refused: ${result.reason}`);
  return result.evaluation;
}

export function trace(): TraceabilityChain {
  return buildCompleteChain({
    tenantId: TENANT_ID,
    actorId: "engineer-raj",
    intentRef: INTENT_ID,
    authorizationRef: "digest-auth-1",
    executionRef: stepIdempotencyKey(PLAN.planId, "step-1", "nonce-1"),
    verificationRef: "ev-verification-1",
    capabilityId: EXECUTE_CAPABILITY.id,
    capabilityVersion: EXECUTE_CAPABILITY.version,
    recordedAt: iso(NOW_MS + 6_000),
  });
}

export function auditEvents(): ReturnType<typeof emitAuditTrail> {
  return emitAuditTrail(actionRecord(), "engineer-raj");
}

// ---------------------------------------------------------------------------
// Evidence chain + records (REAL append + content-addressed artifacts)
// ---------------------------------------------------------------------------

export function evidenceChain(): readonly EvidenceChainEntry[] {
  let chain: readonly EvidenceChainEntry[] = [];
  for (const [evidenceId, at] of [
    ["ev-act-1", NOW_MS + 6_000],
    ["ev-verification-1", NOW_MS + 5_000],
  ] as const) {
    const result = appendEvidence(chain, { evidenceId, tenantId: TENANT_ID, recordedAt: iso(at) });
    chain = result;
  }
  return chain;
}

export function evidenceRecords(): readonly EvidenceMetadata[] {
  const artifact = buildArtifact(
    "art-act-1",
    new TextEncoder().encode("action evidence for intent-isolate-pump-7"),
    "application/json",
    "action evidence",
  );
  return [
    {
      evidenceId: "ev-act-1",
      tenantId: TENANT_ID,
      actor: { actorId: "engineer-raj", isAutonomous: false },
      intentRef: INTENT_ID,
      authorizationRef: "digest-auth-1",
      executionRef: stepIdempotencyKey(PLAN.planId, "step-1", "nonce-1"),
      verificationRef: "ev-verification-1",
      capability: { capabilityId: EXECUTE_CAPABILITY.id, version: EXECUTE_CAPABILITY.version },
      artifacts: [artifact],
      recordedAt: iso(NOW_MS + 6_000),
    },
    {
      evidenceId: "ev-verification-1",
      tenantId: TENANT_ID,
      actor: { actorId: "device-ack", isAutonomous: true },
      intentRef: INTENT_ID,
      authorizationRef: "digest-auth-1",
      executionRef: stepIdempotencyKey(PLAN.planId, "step-1", "nonce-1"),
      verificationRef: "ev-verification-1",
      capability: { capabilityId: EXECUTE_CAPABILITY.id, version: EXECUTE_CAPABILITY.version },
      artifacts: [],
      recordedAt: iso(NOW_MS + 5_000),
    },
  ];
}

// ---------------------------------------------------------------------------
// Predictive + world context (REAL model port + assembly)
// ---------------------------------------------------------------------------

export function prediction(): Prediction {
  const port = makeReferenceModelPort();
  const result = port.project(
    {
      tenant: { tenantId: TENANT_ID },
      asset: { assetId: "pump-7" },
      metric: "vibration",
      observations: [
        { observationRef: "obs-pump-7-1", atMs: BASE_MS + 1_000, value: 10 },
        { observationRef: "obs-pump-7-2", atMs: BASE_MS + 2_000, value: 20 },
        { observationRef: "obs-pump-7-3", atMs: BASE_MS + 3_000, value: 30 },
      ],
      asOfMs: BASE_MS + 3_000,
    },
    { steps: 3, stepMs: 1_000 },
  );
  if (!result.ok) throw new Error(`projection rejected: ${result.rejected}`);
  return result.prediction;
}

export function worldContext(): AssembledContext {
  const result = assembleContext({
    focus: {
      tenant: { tenantId: TENANT_ID },
      entities: [
        {
          entityId: "pump-7",
          entityType: "asset",
          tenantId: TENANT_ID,
          fields: { temperature: 41 },
          lastObservationRef: "obs-pump-7-3",
          lastObservedAtMs: NOW_MS - 5_000,
        },
      ],
      purpose: "operational-monitoring",
    },
    computedAt: iso(NOW_MS),
  });
  if (!result.ok) throw new Error(`context assembly refused: ${result.rejected}`);
  return result.context;
}

// ---------------------------------------------------------------------------
// The composed slice
// ---------------------------------------------------------------------------

export function fullSlice(): SafetyIntelSlice {
  return {
    nowMs: NOW_MS,
    stalenessThresholds: THRESHOLDS,
    findings: findings(),
    remediations: remediations(),
    policy: tenantPolicy(),
    capabilities: [READ_CAPABILITY, EXECUTE_CAPABILITY],
    grants: grants(),
    actorAuthority: ["tenant.operator", "human.approval", "asset.owner"],
    plan: PLAN,
    lifecycle: lifecycle(),
    queue: queue(),
    ledger: ledger(),
    actionAuditEvents: auditEvents(),
    action: actionRecord(),
    evaluation: evaluation(),
    trace: trace(),
    evidenceChain: evidenceChain(),
    evidenceRecords: evidenceRecords(),
    predictions: [prediction()],
    worldContexts: [worldContext()],
  };
}
