/**
 * @fleetos/acceptance-security — shared F300B journey composition (Wave 10
 * lane B). Deterministic composition helpers for the four Wave-10 journeys:
 * every record is built through a REAL package function (no hand-forged
 * domain state), over the fixture-world's fixed logical universe.
 *
 * File-law note: this module exists so each journey file stays under the
 * 400-line budget while composing FULL real chains (action protocol,
 * mission records, the HostSurface slice).
 */

import { advanceActionState, emitAuditTrail, initPlanLifecycle, advancePlanLifecycle, proposeAction, stepIdempotencyKey } from "@fleetos/actions";
import type { ActionPlan, ActionRecord } from "@fleetos/actions";
import { appendEvidence, buildCompleteChain } from "@fleetos/evidence";
import type { EvidenceChainEntry } from "@fleetos/evidence";
import { appendExecutionLedger, ackCommand, completeCommand, createCommandQueue, submitCommand } from "@fleetos/execution";
import type { ExecutionLedgerEntry } from "@fleetos/execution";
import { evaluateCapability, evaluateRulesOrdered, issueGrant } from "@fleetos/policy";
import type { Capability } from "@fleetos/policy";
import { makeReferenceModelPort } from "@fleetos/predictive";
import { proposeRemediationRecord } from "@fleetos/security";
import type { SecurityFinding } from "@fleetos/security";
import type { SafetyIntelSlice } from "@fleetos/experience-safety-intel";
import { assembleContext } from "@fleetos/world-context";
import {
  ANALYST_CTX,
  EXECUTE_CAPABILITY,
  NOW_MS,
  NOW_ISO,
  OPERATOR_CTX,
  READ_CAPABILITY,
  STALENESS_THRESHOLDS,
  TENANT,
  isoOfEpochMs,
  pumpTwinState,
  tenantPolicy,
} from "./fixture-world.ts";

// ---------------------------------------------------------------------------
// Shared exports
// ---------------------------------------------------------------------------

export function appendLed(ledger: readonly ExecutionLedgerEntry[], input: Parameters<typeof appendExecutionLedger>[1]): readonly ExecutionLedgerEntry[] {
  const result = appendExecutionLedger(ledger, input);
  if (!result.ok) throw new Error(`ledger append refused: ${result.reason}`);
  return result.ledger;
}

/** A medium-risk capability NO tenant rule matches — the denial path. */
export const UNMATCHED_CAPABILITY: Capability = {
  id: "fleetos.asset.export-report",
  category: "read",
  risk: "medium",
  requiredAuthority: [],
  tenantScope: "single",
  resourceScope: { assetIds: ["pump-7"] },
  sideEffects: [],
  idempotency: { supported: true, keyShape: ["tenantId", "capabilityId"] },
  verification: { kind: "domain.read" },
  inputs: ["assetId"],
  outputs: ["report"],
  description: "Export an asset report (no matching tenant rule)",
  version: "1.0.0",
};

// ---------------------------------------------------------------------------
// guardian-e2e: the full A4 action chain (times 500..3000, domain.read)

export function e2eActionChain(intentId: string, nonce: string, queueKey: string): ActionRecord {
  const policy = tenantPolicy();
  const decision = evaluateCapability(policy, READ_CAPABILITY, ANALYST_CTX(READ_CAPABILITY));
  let action: ActionRecord = proposeAction({
    intentId,
    tenant: TENANT,
    capability: READ_CAPABILITY,
    idempotencyKey: { tenantId: TENANT.tenantId, capabilityId: READ_CAPABILITY.id, nonce },
    inputs: { assetId: "pump-7" },
    proposedAt: isoOfEpochMs(NOW_MS),
    proposedBy: "operator-ada",
  });
  const steps: readonly [ActionRecord["state"], Parameters<typeof advanceActionState>[2]][] = [
    ["authorized", { at: isoOfEpochMs(NOW_MS + 500), authorization: decision, tenantId: TENANT.tenantId }],
    ["confirmed", { at: isoOfEpochMs(NOW_MS + 1_000), confirmedBy: "operator-ada", tenantId: TENANT.tenantId }],
    ["dispatched", { at: isoOfEpochMs(NOW_MS + 1_500), dispatchReceipt: queueKey, tenantId: TENANT.tenantId }],
    ["executing", { at: isoOfEpochMs(NOW_MS + 1_800), tenantId: TENANT.tenantId }],
    ["executed", { at: isoOfEpochMs(NOW_MS + 2_000), executionResult: { succeeded: true, outputs: { state: "ok" }, executedAt: isoOfEpochMs(NOW_MS + 2_000) }, tenantId: TENANT.tenantId }],
    ["verified", { at: isoOfEpochMs(NOW_MS + 2_500), verificationRecord: { verified: true, verifierKind: "domain.read" as const, verifiedAt: isoOfEpochMs(NOW_MS + 2_500), proofRef: "ev-verification-e2e" }, tenantId: TENANT.tenantId }],
    ["recorded", { at: isoOfEpochMs(NOW_MS + 3_000), evidenceRef: "ev-intake-e2e-1", tenantId: TENANT.tenantId }],
  ];
  for (const [target, ctx] of steps) {
    const result = advanceActionState(action, target, ctx);
    if (!result.ok) throw new Error(`advance to ${target} refused: ${result.reason}`);
    action = result.record;
  }
  return action;
}

// ---------------------------------------------------------------------------
// mission-replay: the mission's ledger + journal records

const MISSION_QUEUE_KEY = "mission-replay-command-1";

export function missionLedger(): readonly ExecutionLedgerEntry[] {
  let ledger: readonly ExecutionLedgerEntry[] = [];
  ledger = appendLed(ledger, { tenantId: TENANT.tenantId, idempotencyKey: MISSION_QUEUE_KEY, kind: "submitted", at: NOW_MS + 1_000, detail: "" });
  ledger = appendLed(ledger, { tenantId: TENANT.tenantId, idempotencyKey: MISSION_QUEUE_KEY, kind: "acked", at: NOW_MS + 2_000, detail: "" });
  ledger = appendLed(ledger, { tenantId: TENANT.tenantId, idempotencyKey: MISSION_QUEUE_KEY, kind: "completed", at: NOW_MS + 3_000, detail: "ack=true" });
  return ledger;
}

export function missionQueueKey(): string {
  return MISSION_QUEUE_KEY;
}

export function missionAction(): ActionRecord {
  const policy = tenantPolicy();
  const decision = evaluateCapability(policy, EXECUTE_CAPABILITY, OPERATOR_CTX(EXECUTE_CAPABILITY));
  let record = proposeAction({
    intentId: "intent-mission-replay-1",
    tenant: TENANT,
    capability: EXECUTE_CAPABILITY,
    idempotencyKey: { tenantId: TENANT.tenantId, capabilityId: EXECUTE_CAPABILITY.id, nonce: "replay-1" },
    inputs: { assetId: "pump-7", command: "isolate" },
    proposedAt: isoOfEpochMs(NOW_MS),
    proposedBy: "engineer-raj",
  });
  const steps: readonly [ActionRecord["state"], Parameters<typeof advanceActionState>[2]][] = [
    ["authorized", { at: isoOfEpochMs(NOW_MS + 500), authorization: decision, tenantId: TENANT.tenantId }],
    ["confirmed", { at: isoOfEpochMs(NOW_MS + 900), confirmedBy: "operator-ada", tenantId: TENANT.tenantId }],
    ["dispatched", { at: isoOfEpochMs(NOW_MS + 1_100), dispatchReceipt: MISSION_QUEUE_KEY, tenantId: TENANT.tenantId }],
    ["executing", { at: isoOfEpochMs(NOW_MS + 1_500), tenantId: TENANT.tenantId }],
    ["executed", { at: isoOfEpochMs(NOW_MS + 3_000), executionResult: { succeeded: true, outputs: { ack: true }, executedAt: isoOfEpochMs(NOW_MS + 3_000) }, tenantId: TENANT.tenantId }],
    ["verified", { at: isoOfEpochMs(NOW_MS + 3_400), verificationRecord: { verified: true, verifierKind: "device.ack" as const, verifiedAt: isoOfEpochMs(NOW_MS + 3_400), proofRef: "ev-verification-replay" }, tenantId: TENANT.tenantId }],
    ["recorded", { at: isoOfEpochMs(NOW_MS + 3_800), evidenceRef: "ev-replay-1", tenantId: TENANT.tenantId }],
  ];
  for (const [target, ctx] of steps) {
    const result = advanceActionState(record, target, ctx);
    if (!result.ok) throw new Error(`advance to ${target} refused: ${result.reason}`);
    record = result.record;
  }
  return record;
}

// ---------------------------------------------------------------------------
// host-surface: the composed slice over REAL read-models

const HOST_PLAN: ActionPlan = {
  planId: "plan-host-1",
  tenant: TENANT,
  steps: [
    { stepId: "step-1", capability: EXECUTE_CAPABILITY, inputs: { assetId: "pump-7" }, idempotencyNonce: "host-1" },
  ],
};

export const HOST_CTX = {
  tenantId: TENANT.tenantId,
  actorId: "operator-ada",
  sessionId: "session-host-1",
  establishedAt: NOW_MS - 30_000,
  scope: "tenant" as const,
};

export function hostJourneySlice(): SafetyIntelSlice {
  const policy = tenantPolicy();
  const decision = evaluateCapability(policy, EXECUTE_CAPABILITY, OPERATOR_CTX(EXECUTE_CAPABILITY));
  const ordered = evaluateRulesOrdered(policy, EXECUTE_CAPABILITY, OPERATOR_CTX(EXECUTE_CAPABILITY));
  if (!ordered.ok) throw new Error("ordered evaluation refused");

  let action = proposeAction({
    intentId: "intent-host-surface-1",
    tenant: TENANT,
    capability: EXECUTE_CAPABILITY,
    idempotencyKey: { tenantId: TENANT.tenantId, capabilityId: EXECUTE_CAPABILITY.id, nonce: "host-1" },
    inputs: { assetId: "pump-7", command: "isolate" },
    proposedAt: isoOfEpochMs(NOW_MS),
    proposedBy: "engineer-raj",
  });
  const steps: readonly [ActionRecord["state"], Parameters<typeof advanceActionState>[2]][] = [
    ["authorized", { at: isoOfEpochMs(NOW_MS + 1_000), authorization: decision, tenantId: TENANT.tenantId }],
    ["confirmed", { at: isoOfEpochMs(NOW_MS + 2_000), confirmedBy: "operator-ada", tenantId: TENANT.tenantId }],
    ["dispatched", { at: isoOfEpochMs(NOW_MS + 3_000), dispatchReceipt: stepIdempotencyKey(HOST_PLAN.planId, "step-1", "host-1"), tenantId: TENANT.tenantId }],
    ["executing", { at: isoOfEpochMs(NOW_MS + 3_500), tenantId: TENANT.tenantId }],
    ["executed", { at: isoOfEpochMs(NOW_MS + 4_000), executionResult: { succeeded: true, outputs: { ack: true }, executedAt: isoOfEpochMs(NOW_MS + 4_000) }, tenantId: TENANT.tenantId }],
    ["verified", { at: isoOfEpochMs(NOW_MS + 5_000), verificationRecord: { verified: true, verifierKind: "device.ack" as const, verifiedAt: isoOfEpochMs(NOW_MS + 5_000), proofRef: "ev-host-verification" }, tenantId: TENANT.tenantId }],
    ["recorded", { at: isoOfEpochMs(NOW_MS + 6_000), evidenceRef: "ev-host-act", tenantId: TENANT.tenantId }],
  ];
  for (const [target, ctx] of steps) {
    const result = advanceActionState(action, target, ctx);
    if (!result.ok) throw new Error(`advance to ${target} refused: ${result.reason}`);
    action = result.record;
  }

  const grant = issueGrant([], {
    grantId: "grant-host-1",
    tenantId: TENANT.tenantId,
    capabilityId: EXECUTE_CAPABILITY.id,
    granteeActorId: "operator-ada",
    grantedByActorId: "tenant-admin",
    grantedAt: NOW_MS - 60_000,
    expiresAt: NOW_MS + 3_600_000,
  });
  if (!grant.ok) throw new Error(`grant refused: ${grant.reason}`);

  const lifecycle = initPlanLifecycle(HOST_PLAN, 1);
  if (!lifecycle.ok) throw new Error("lifecycle init refused");
  const authorizedLifecycle = advancePlanLifecycle(lifecycle.record, "authorized", {
    tenantId: TENANT.tenantId,
    actorId: "operator-ada",
    at: NOW_MS + 1_000,
  });
  if (!authorizedLifecycle.ok) throw new Error("lifecycle advance refused");

  const queue = createCommandQueue(TENANT.tenantId);
  if (!queue.ok) throw new Error("queue creation refused");
  let state = queue.state;
  const key = stepIdempotencyKey(HOST_PLAN.planId, "step-1", "host-1");
  const submitted = submitCommand(state, {
    idempotencyKey: key,
    capabilityId: EXECUTE_CAPABILITY.id,
    payloadInputs: { assetId: "pump-7" },
    at: NOW_MS + 2_000,
    tenantId: TENANT.tenantId,
    authorizationDigest: "digest-host-allow",
    verdict: "ALLOW",
  });
  if (!submitted.ok) throw new Error("submit refused");
  state = submitted.state;
  const acked = ackCommand(state, key, NOW_MS + 3_000, TENANT.tenantId);
  if (!acked.ok) throw new Error("ack refused");
  state = acked.state;
  const completed = completeCommand(state, key, { ack: true }, NOW_MS + 4_000, TENANT.tenantId);
  if (!completed.ok) throw new Error("complete refused");

  let ledger: readonly ExecutionLedgerEntry[] = [];
  ledger = appendLed(ledger, { tenantId: TENANT.tenantId, idempotencyKey: key, kind: "submitted", at: NOW_MS + 2_000, detail: "" });
  ledger = appendLed(ledger, { tenantId: TENANT.tenantId, idempotencyKey: key, kind: "acked", at: NOW_MS + 3_000, detail: "" });
  ledger = appendLed(ledger, { tenantId: TENANT.tenantId, idempotencyKey: key, kind: "completed", at: NOW_MS + 4_000, detail: "ack=true" });

  let evidenceChain: readonly EvidenceChainEntry[] = appendEvidence([], { evidenceId: "ev-host-act", tenantId: TENANT.tenantId, recordedAt: isoOfEpochMs(NOW_MS + 6_000) });
  evidenceChain = appendEvidence(evidenceChain, { evidenceId: "ev-host-verification", tenantId: TENANT.tenantId, recordedAt: isoOfEpochMs(NOW_MS + 5_000) });

  const remediation = proposeRemediationRecord({
    proposalId: "prop-host-1",
    tenantId: TENANT.tenantId,
    findingIds: ["finding-host-1"],
    remediationKind: "rotate_credential",
    at: NOW_MS - 60_000,
  });
  if (!remediation.ok) throw new Error("remediation proposal refused");

  const finding: SecurityFinding = {
    findingId: "finding-host-1",
    tenantId: TENANT.tenantId,
    kind: "auth.weak_credential",
    severity: "high",
    confidence: "confirmed",
    detectedAt: isoOfEpochMs(NOW_MS - 120_000),
    assetIds: ["pump-7"],
    description: "Weak operator credential on pump-7 control plane",
    evidenceRefs: ["ev-host-act"],
    findingDigest: "c3d4e5f6",
  };

  const port = makeReferenceModelPort();
  const twin = port.project(pumpTwinState(), { steps: 3, stepMs: 1_000 });
  if (!twin.ok) throw new Error(`projection rejected: ${twin.rejected}`);

  const context = assembleContext({
    focus: {
      tenant: TENANT,
      entities: [
        {
          entityId: "pump-7",
          entityType: "asset",
          tenantId: TENANT.tenantId,
          fields: { temperature: 41 },
          lastObservationRef: "obs-pump-7-3",
          lastObservedAtMs: NOW_MS - 5_000,
        },
      ],
      purpose: "operational-monitoring",
    },
    computedAt: NOW_ISO,
  });
  if (!context.ok) throw new Error(`assembly refused: ${context.rejected}`);

  return {
    nowMs: NOW_MS,
    stalenessThresholds: STALENESS_THRESHOLDS,
    findings: [finding],
    remediations: [remediation.record],
    policy,
    capabilities: [READ_CAPABILITY, EXECUTE_CAPABILITY],
    grants: grant.grants,
    actorAuthority: ["tenant.operator", "human.approval", "asset.owner"],
    plan: HOST_PLAN,
    lifecycle: authorizedLifecycle.record,
    queue: completed.state,
    ledger,
    action,
    evaluation: ordered.evaluation,
    trace: buildCompleteChain({
      tenantId: TENANT.tenantId,
      actorId: "engineer-raj",
      intentRef: "intent-host-surface-1",
      authorizationRef: decision.decisionDigest,
      executionRef: key,
      verificationRef: "ev-host-verification",
      capabilityId: EXECUTE_CAPABILITY.id,
      capabilityVersion: EXECUTE_CAPABILITY.version,
      recordedAt: isoOfEpochMs(NOW_MS + 6_000),
    }),
    evidenceChain,
    evidenceRecords: [],
    predictions: [twin.prediction],
    worldContexts: [context.context],
  };
}

/** The emission trail of the e2e action chain (REAL emitAuditTrail). */
export function e2eAuditEvents(intentId: string, nonce: string, queueKey: string) {
  return emitAuditTrail(e2eActionChain(intentId, nonce, queueKey), "operator-ada");
}
