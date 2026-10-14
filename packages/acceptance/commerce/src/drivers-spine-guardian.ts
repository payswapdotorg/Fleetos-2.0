/**
 * @fleetos/acceptance-commerce — the F362 transaction-spine step drivers,
 * part 1 (the F361B segment).
 *
 * Interprets the spn-* evidence/approval steps against the REAL public
 * entry points of `@fleetos/evidence` + `@fleetos/policy` (the F361B lane
 * surfaces, driven from the commerce corpus for the first time — the
 * composition site this journey binds):
 *   - InMemoryMarketplaceEvidenceStore.recordEvidence / readEvidence /
 *     findByProviderEvent (packages/evidence, marketplace-evidence.ts) —
 *     the retained frozen OFFER SNAPSHOT (the approval's
 *     offerSnapshotRef) and the retained PROVIDER-ACK reference, with
 *     duplicate provider events returning the ORIGINAL record (never a
 *     second conclusion) and future-dated captures refused as untrusted
 *     (mission §6);
 *   - evaluateMarketplaceOrderApproval + assertAdvisoryNeverAuthorizes
 *     (packages/policy, marketplace-approval.ts) — the Guardian approval
 *     contract composing the EXISTING evaluateCapability (the SOLE
 *     authority), with ALL eight limit checks evaluated and reported and
 *     the advisory law machine-asserted (advisory-never-authorizes).
 *
 * The policy/limits/policyRef fixtures are CALLER-SUPPLIED journey data
 * (fixture-labelled, honestly recorded in docs/evidence/F362/report.md —
 * never a live-policy claim; the F361B security-journey convention).
 *
 * The store + last-record-per-kind population lives in a WeakMap keyed by
 * JourneyState — a fresh world per run keeps every run pure and
 * deterministic. Refusal results are honest facts carrying the domain
 * reason codes.
 */

import type { FactValue } from "./journey-contracts.js";
import type { SpineEvidenceKind, SpineEvidenceStep, SpineGuardianApprovalStep } from "./journey-contracts-f362.js";
import type { JourneyState } from "./journey-world.js";
import { OTHER_TENANT, logPush } from "./journey-world.js";
import {
  InMemoryMarketplaceEvidenceStore,
  buildArtifact,
  utf8Bytes,
  type MarketplaceEvidenceRecord,
  type MarketplaceEvidenceRecordOutcome,
} from "@fleetos/evidence";
import {
  assertAdvisoryNeverAuthorizes,
  evaluateMarketplaceOrderApproval,
  type MarketplaceApprovalLimits,
  type MarketplaceOrderApproval,
  type MarketplaceOrderApprovalRequest,
  type MarketplacePolicyRef,
  type Policy,
  type PolicyRule,
} from "@fleetos/policy";

export type DriverFacts = Record<string, FactValue>;

interface SpineGuardianSeam {
  readonly store: InMemoryMarketplaceEvidenceStore;
  lastByKind: Map<SpineEvidenceKind, MarketplaceEvidenceRecord>;
}

const seams = new WeakMap<JourneyState, SpineGuardianSeam>();

function seamFor(state: JourneyState): SpineGuardianSeam {
  let seam = seams.get(state);
  if (seam === undefined) {
    seam = { store: new InMemoryMarketplaceEvidenceStore(), lastByKind: new Map() };
    seams.set(state, seam);
  }
  return seam;
}

// ---------------------------------------------------------------------------
// The caller-supplied approval fixtures (journey data, fixture-labelled —
// the F361B security-journey convention; single-tenant, fail-closed).
// ---------------------------------------------------------------------------

const APPROVAL_RULES: readonly PolicyRule[] = [
  {
    // Tier 1 (the F361B fixture verbatim): an actor holding human.approval
    // still passes through REQUIRE_APPROVAL — the marketplace layer then
    // recognizes the human.approval AuthorityKind (vocabulary reuse).
    id: "rule.require_human_approval_for_high_risk",
    description: "high-risk execution requires human approval",
    riskFloor: "medium",
    riskCeiling: "high",
    requiredAuthority: ["human.approval"],
    tenantScope: "single",
    verdict: "REQUIRE_APPROVAL",
    priority: 20,
  },
  {
    // Tier 2 (the F361B unit-battery pattern): an operator-flagged
    // consequential order STILL requires approval — the Guardian answers
    // REQUIRE_APPROVAL for an operator without human.approval, and the
    // marketplace layer then refuses refuse.actor_missing_human_approval
    // (an advisory-tier actor can never self-satisfy the approval path).
    id: "rule.require_mission_owner_for_work",
    description: "operator-flagged consequential orders still require approval",
    riskFloor: "medium",
    riskCeiling: "high",
    requiredAuthority: ["tenant.operator"],
    tenantScope: "single",
    verdict: "REQUIRE_APPROVAL",
    priority: 10,
  },
];

const APPROVAL_POLICY: Policy = {
  id: "pol-spine-01",
  version: "1.0.0",
  tenantId: "acme",
  rules: APPROVAL_RULES,
  defaultVerdict: "BLOCK",
  failClosed: true,
};

const APPROVAL_LIMITS: MarketplaceApprovalLimits = {
  amountCeiling: { purchase: 8_000_000, "repair-service": 5_000_000, rental: 0, lease: 0 },
  currency: "GHS",
  allowedCategories: ["laptops", "printers"],
  maxUnitsPerOrder: 10,
  requiredPolicyKinds: ["procurement", "budget"],
};

const APPROVAL_POLICY_REFS: readonly MarketplacePolicyRef[] = [
  { policyKind: "procurement", policyId: "pol-proc-spine-1", version: "1.0.0" },
  { policyKind: "budget", policyId: "pol-budget-spine-1", version: "1.1.0" },
];

function approvalRequest(step: SpineGuardianApprovalStep, offerSnapshotRef: string): MarketplaceOrderApprovalRequest {
  return {
    requestId: `spn-approval-${step.mode}`,
    tenant: { tenantId: "acme" },
    actor: {
      actorId: step.actorId,
      authority: step.actorAuthority as MarketplaceOrderApprovalRequest["actor"]["authority"],
      isAutonomous: step.actorAutonomous,
    },
    order: {
      orderId: step.orderId,
      category: step.category,
      transactionKind: step.transactionKind,
      units: step.units,
      amount: { total: step.amountTotal, currency: step.currency },
      supplierRef: { supplierId: step.supplierId, verificationRef: step.verificationRef },
      offerSnapshotRef,
    },
    limits: APPROVAL_LIMITS,
    policyRefs: APPROVAL_POLICY_REFS,
  };
}

function approvalFacts(prefix: string, request: MarketplaceOrderApprovalRequest, approval: MarketplaceOrderApproval, again: MarketplaceOrderApproval): DriverFacts {
  const amountCheck = approval.limitFindings.find((f) => f.check === "check.amount_within_ceiling");
  return {
    [`${prefix}.ok`]: true,
    [`${prefix}.reasonCode`]: null,
    [`${prefix}.decision`]: approval.decision,
    [`${prefix}.reason`]: approval.reasonCode,
    [`${prefix}.authoritySource`]: approval.authorityTrace.source,
    [`${prefix}.guardianVerdict`]: approval.guardianDecision.verdict,
    [`${prefix}.guardianReason`]: approval.guardianDecision.reasonCode,
    [`${prefix}.limitCheckCount`]: approval.limitFindings.length,
    [`${prefix}.allLimitsPassed`]: approval.limitFindings.every((f) => f.passed),
    [`${prefix}.amountCheckPassed`]: amountCheck === undefined ? null : amountCheck.passed,
    [`${prefix}.amountObserved`]: amountCheck === undefined ? null : amountCheck.observed,
    [`${prefix}.amountLimit`]: amountCheck === undefined ? null : amountCheck.limit,
    [`${prefix}.offerSnapshotRef`]: request.order.offerSnapshotRef,
    [`${prefix}.verificationRef`]: request.order.supplierRef.verificationRef,
    [`${prefix}.supplierId`]: request.order.supplierRef.supplierId,
    [`${prefix}.orderId`]: approval.orderId,
    [`${prefix}.idPrefix`]: approval.approvalId.slice(0, 4),
    [`${prefix}.digestStable`]: approval.approvalDigest === again.approvalDigest && approval.approvalId === again.approvalId,
  };
}

export async function runSpineGuardianStep(
  step: SpineEvidenceStep | SpineGuardianApprovalStep,
  state: JourneyState,
): Promise<DriverFacts> {
  const seam = seamFor(state);
  switch (step.kind) {
    case "spn-evidence-retain": {
      const input = {
        tenantId: state.tenant.tenantId,
        providerEventId: step.providerEventId,
        kind: step.evidenceKind === "offer-snapshot" ? ("marketplace.offer-snapshot" as const) : ("marketplace.provider-ack" as const),
        subjectRef: step.subjectRef,
        source: { system: step.sourceSystem, reference: step.sourceReference, retrievedVia: step.retrievedVia },
        capturedAt: step.capturedAtIso,
        artifacts: [
          buildArtifact(
            step.artifactId,
            utf8Bytes(step.artifactJson),
            "application/json",
            step.artifactDescription,
          ),
        ],
      };
      const outcome: MarketplaceEvidenceRecordOutcome = await seam.store.recordEvidence(
        { tenantId: state.tenant.tenantId },
        input,
        step.recordedAtIso,
      );
      const prefix = `spn.evidence.${step.factKey}`;
      if (!outcome.ok) {
        logPush(state, "spn.log", `evidence:${step.evidenceKind}:${step.providerEventId}:refused:${outcome.reason}`);
        return {
          [`${prefix}.ok`]: false,
          [`${prefix}.reasonCode`]: outcome.reason,
          [`${prefix}.duplicate`]: false,
          [`${prefix}.storeSize`]: seam.store.size(),
        };
      }
      const divergentFlag = outcome.duplicate ? outcome.divergent : false;
      if (!outcome.duplicate) seam.lastByKind.set(step.evidenceKind, outcome.record);
      logPush(
        state,
        "spn.log",
        `evidence:${step.evidenceKind}:${step.providerEventId}:${outcome.duplicate ? (outcome.divergent ? "duplicate-divergent" : "duplicate") : "retained"}:${outcome.record.evidenceId}`,
      );
      return {
        [`${prefix}.ok`]: true,
        [`${prefix}.reasonCode`]: null,
        [`${prefix}.duplicate`]: outcome.duplicate,
        [`${prefix}.divergent`]: divergentFlag,
        [`${prefix}.evidenceId`]: outcome.record.evidenceId,
        [`${prefix}.kind`]: outcome.record.kind,
        [`${prefix}.subjectRef`]: outcome.record.subjectRef,
        [`${prefix}.sourceReference`]: outcome.record.source.reference,
        [`${prefix}.providerEventId`]: outcome.record.providerEventId,
        [`${prefix}.capturedAt`]: outcome.record.capturedAt,
        [`${prefix}.storeSize`]: seam.store.size(),
      };
    }
    case "spn-evidence-read": {
      const caller = (step.callerTenant ?? "own") === "own" ? state.tenant : OTHER_TENANT;
      const record = seam.lastByKind.get(step.evidenceKind) ?? null;
      const found = record === null ? null : await seam.store.readEvidence({ tenantId: caller.tenantId }, record.evidenceId);
      const byEvent = record === null ? null : await seam.store.findByProviderEvent({ tenantId: caller.tenantId }, record.providerEventId);
      logPush(state, "spn.log", `evidence-read:${step.callerTenant ?? "own"}:${step.evidenceKind}:${found?.evidenceId ?? "null"}`);
      return {
        [`spn.evidenceRead.${step.factKey}.found`]: found !== null,
        [`spn.evidenceRead.${step.factKey}.evidenceId`]: found?.evidenceId ?? null,
        [`spn.evidenceRead.${step.factKey}.sourceReference`]: found?.source.reference ?? null,
        [`spn.evidenceRead.${step.factKey}.findByEvent`]: byEvent?.evidenceId ?? null,
      };
    }
    case "spn-guardian-approval": {
      const prefix = `spn.approval.${step.factKey}`;
      const snapshot = seam.lastByKind.get("offer-snapshot") ?? null;
      const offerSnapshotRef = step.offerSnapshotFromEvidence
        ? (snapshot?.evidenceId ?? "")
        : "fixture-snapshot-ref";
      const request = approvalRequest(step, offerSnapshotRef);
      if (step.mode === "advisory") {
        // The advisory law as a REAL public API, over the request exactly as
        // given (in-limits + an approve-flavored advisory): the decision is
        // byte-identical with and without the advisory. Then the over-limit
        // variant WITH the advisory: the advisory cannot rescue the refusal.
        const advisory = {
          source: step.advisorySource ?? "predictive.model/supplier-score",
          recommendation: step.advisoryRecommendation ?? "approve",
          rationale: step.advisoryRationale ?? "",
        };
        const law = assertAdvisoryNeverAuthorizes(APPROVAL_POLICY, request, advisory);
        const overLimit = approvalRequest(
          { ...step, mode: "over-limit", amountTotal: 9_000_000, factKey: step.factKey },
          offerSnapshotRef,
        );
        const overLimitWithAdvisory = evaluateMarketplaceOrderApproval(APPROVAL_POLICY, { ...overLimit, advisory });
        const overLimitWithout = evaluateMarketplaceOrderApproval(APPROVAL_POLICY, overLimit);
        logPush(state, "spn.log", `approval:advisory:${law.holds ? "law-holds" : "BROKEN"}:${law.withAdvisory.decision}`);
        logPush(state, "spn.log", `approval:advisory-over-limit:${overLimitWithAdvisory.decision}:${overLimitWithAdvisory.reasonCode}`);
        return {
          [`${prefix}.ok`]: true,
          [`${prefix}.reasonCode`]: null,
          [`${prefix}.lawHolds`]: law.holds,
          [`${prefix}.withDecision`]: law.withAdvisory.decision,
          [`${prefix}.withReason`]: law.withAdvisory.reasonCode,
          [`${prefix}.digestIdentical`]: law.withAdvisory.approvalDigest === law.withoutAdvisory.approvalDigest,
          [`${prefix}.idIdentical`]: law.withAdvisory.approvalId === law.withoutAdvisory.approvalId,
          [`${prefix}.overLimitWithAdvisoryDecision`]: overLimitWithAdvisory.decision,
          [`${prefix}.overLimitWithAdvisoryReason`]: overLimitWithAdvisory.reasonCode,
          [`${prefix}.overLimitDigestIdentical`]: overLimitWithAdvisory.approvalDigest === overLimitWithout.approvalDigest,
          [`${prefix}.offerSnapshotRef`]: offerSnapshotRef,
        };
      }
      const approval = evaluateMarketplaceOrderApproval(APPROVAL_POLICY, request);
      const again = evaluateMarketplaceOrderApproval(APPROVAL_POLICY, request);
      if (step.mode === "in-limits") {
        logPush(state, "spn.log", `approval:${step.mode}:${approval.decision}:${approval.reasonCode}:${offerSnapshotRef}`);
      } else {
        logPush(state, "spn.log", `approval:${step.mode}:${approval.decision}:${approval.reasonCode}`);
      }
      return approvalFacts(prefix, request, approval, again);
    }
  }
}
