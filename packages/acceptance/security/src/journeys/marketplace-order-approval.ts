/**
 * F361B journey 1 — marketplace order approval discipline (persona:
 * tenant-operator).
 *
 * CENSUS CITATION (F361B, census-first with grep proof at base cefd588):
 * zero matches for "marketplace-order-approval-discipline" /
 * "approval-discipline" / "order-approval" across packages/acceptance/**
 * and packages/{policy,actions,evidence,security}/src (grep logs in
 * docs/evidence/F361B/report.md §2). The nearest existing claims are the
 * commerce corpus's "marketplace-transaction-flow" (Worker C's
 * request→offer→order chain) and the field corpus's
 * "procurement-order-authorization" — neither exercises the Guardian
 * approval CONTRACT (limit checks + reason codes + advisory
 * non-authorization) that is THIS lane's angle.
 *
 * The operator proves the F360 §3.6 approval discipline end-to-end over
 * the REAL public entry points:
 *   - proposeMarketplaceOrderAction (packages/actions) — the consequential
 *     order enters the EXISTING A4 protocol in `proposed`;
 *   - evaluateMarketplaceOrderApproval (packages/policy) — the Guardian
 *     approval contract composing the EXISTING evaluateCapability (the
 *     SOLE authority), with ALL eight limit checks evaluated and reported;
 *   - authorizeMarketplaceOrderAction / rejectMarketplaceOrderAction
 *     (packages/actions) — the approval applied through the EXISTING
 *     advanceActionState; a refused approval NEVER authorizes, and the
 *     refusal leaves the auditable `rejected` trail;
 *   - assertAdvisoryNeverAuthorizes (packages/policy) — the advisory law
 *     as a REAL public API: an approve-flavored advisory attached to an
 *     over-limit request changes NOTHING (verdict, reason, digest);
 *   - cross-tenant refusal — the foreign tenant's policy NEVER approves
 *     and a foreign approval NEVER authorizes the home record.
 *
 * Determinism: pure fixture data, no wall clock (fixed ISO logical times),
 * no randomness, no network; the journey never reads the run anchor —
 * anchor-invariant by construction (the census row's citation).
 */

import type { AcceptanceJourney } from "../journey-contracts.ts";
import {
  assertAdvisoryNeverAuthorizes,
  evaluateMarketplaceOrderApproval,
  MARKETPLACE_ORDER_CAPABILITY_ID,
} from "@fleetos/policy";
import type {
  MarketplaceAdvisoryRecommendation,
  MarketplaceApprovalLimits,
  MarketplaceOrderApprovalRequest,
  MarketplacePolicyRef,
} from "@fleetos/policy";
import type { Policy, PolicyRule } from "@fleetos/policy";
import {
  authorizeMarketplaceOrderAction,
  proposeMarketplaceOrderAction,
  rejectMarketplaceOrderAction,
} from "@fleetos/actions";
import { TENANT, FOREIGN_TENANT } from "./fixture-world.ts";

const AT = "2026-10-12T18:45:00.000Z";

const LIMITS: MarketplaceApprovalLimits = {
  amountCeiling: { purchase: 15_000, "repair-service": 5_000, rental: 0, lease: 0 },
  currency: "GHS",
  allowedCategories: ["laptops", "printers"],
  maxUnitsPerOrder: 10,
  requiredPolicyKinds: ["procurement", "budget"],
};

const POLICY_REFS: readonly MarketplacePolicyRef[] = [
  { policyKind: "procurement", policyId: "pol-proc-1", version: "1.0.0" },
  { policyKind: "budget", policyId: "pol-budget-2", version: "2.1.0" },
];

const RULE: PolicyRule = {
  id: "rule.require_human_approval_for_high_risk",
  description: "high-risk execution requires human approval",
  riskFloor: "medium",
  riskCeiling: "high",
  requiredAuthority: ["human.approval"],
  tenantScope: "single",
  verdict: "REQUIRE_APPROVAL",
  priority: 20,
};

const POLICY: Policy = { id: "pol-1", version: "1.0.0", tenantId: TENANT.tenantId, rules: [RULE], defaultVerdict: "BLOCK", failClosed: true };
const FOREIGN_POLICY: Policy = { ...POLICY, tenantId: FOREIGN_TENANT.tenantId };

function orderRequest(amount: number): MarketplaceOrderApprovalRequest {
  return {
    requestId: "req-j1",
    tenant: TENANT,
    actor: { actorId: "operator-1", authority: ["tenant.operator", "human.approval"], isAutonomous: false },
    order: {
      orderId: "order-100",
      category: "laptops",
      transactionKind: "purchase",
      units: 5,
      amount: { total: amount, currency: "GHS" },
      supplierRef: { supplierId: "sup-7", verificationRef: "verify-sup-7-2026" },
      offerSnapshotRef: "mpe-offer-order-100",
    },
    limits: LIMITS,
    policyRefs: POLICY_REFS,
  };
}

const IN_LIMITS_REQUEST = orderRequest(9_500);
const OVER_LIMIT_REQUEST = orderRequest(42_000);
const ADVISORY: MarketplaceAdvisoryRecommendation = {
  source: "predictive.model/supplier-score",
  recommendation: "approve",
  rationale: "advisory suggests the order is routine",
};

// Deterministic module-scope evaluation over the REAL public APIs (pure
// functions; every value below is a frozen deterministic fact).
const proposed = proposeMarketplaceOrderAction(IN_LIMITS_REQUEST, AT);
const approval = evaluateMarketplaceOrderApproval(POLICY, IN_LIMITS_REQUEST);
const approvalAgain = evaluateMarketplaceOrderApproval(POLICY, IN_LIMITS_REQUEST);
const authorized = authorizeMarketplaceOrderAction(proposed.record, approval, { at: AT, tenantId: TENANT.tenantId });

const overLimitApproval = evaluateMarketplaceOrderApproval(POLICY, OVER_LIMIT_REQUEST);
const overLimitProposed = proposeMarketplaceOrderAction(OVER_LIMIT_REQUEST, AT);
const overLimitAuthorize = authorizeMarketplaceOrderAction(overLimitProposed.record, overLimitApproval, { at: AT, tenantId: TENANT.tenantId });
const overLimitRejected = rejectMarketplaceOrderAction(overLimitProposed.record, overLimitApproval, { at: AT, tenantId: TENANT.tenantId });

const advisoryCheck = assertAdvisoryNeverAuthorizes(POLICY, OVER_LIMIT_REQUEST, ADVISORY);
const advisoryKeys = Object.keys(ADVISORY).sort();

const crossTenantApproval = evaluateMarketplaceOrderApproval(FOREIGN_POLICY, IN_LIMITS_REQUEST);
const foreignOwnRequest: MarketplaceOrderApprovalRequest = { ...IN_LIMITS_REQUEST, tenant: FOREIGN_TENANT, requestId: "req-j1-foreign" };
const foreignOwnApproval = evaluateMarketplaceOrderApproval(FOREIGN_POLICY, foreignOwnRequest);
const foreignAuthorize = authorizeMarketplaceOrderAction(proposed.record, foreignOwnApproval, { at: AT, tenantId: TENANT.tenantId });

export const marketplaceOrderApprovalJourney: AcceptanceJourney = {
  journeyId: "security.marketplace-order-approval-discipline",
  persona: "tenant-operator",
  capabilities: ["guardian-e2e-authorization", "action-plans"],
  goal: "Prove the marketplace Guardian approval discipline: limit checks, reason-coded refusal, advisory non-authorization, and the A4 protocol trail",
  steps: [
    {
      stepId: "propose-order-action",
      kind: "plan",
      description: "The consequential marketplace order enters the EXISTING action protocol in the proposed state",
      packages: ["@fleetos/actions", "@fleetos/policy"],
      operations: ["proposeMarketplaceOrderAction", "marketplaceOrderCapability"],
      run: (ctx) => {
        ctx.record("propose.state", proposed.record.state);
        ctx.record("propose.intentId", proposed.record.intent.intentId);
        ctx.record("propose.capabilityId", proposed.capability.id);
        ctx.record("propose.capabilityCategory", proposed.capability.category);
        ctx.record("propose.capabilityRisk", proposed.capability.risk);
        ctx.record("propose.idempotencyNonce", proposed.record.intent.idempotencyKey.nonce);
        ctx.record("propose.inputsOrderId", (proposed.record.intent.inputs as Record<string, unknown>)["orderId"]);
        ctx.record("propose.inputsPolicyRefs", (proposed.record.intent.inputs as Record<string, unknown>)["policyRefs"]);
      },
    },
    {
      stepId: "guardian-approval-in-limits",
      kind: "guardian-decision",
      description: "The Guardian approval contract approves a within-limits order, composing the EXISTING evaluateCapability as the sole authority",
      packages: ["@fleetos/policy"],
      operations: ["evaluateMarketplaceOrderApproval", "evaluateCapability", "marketplaceOrderCapability"],
      run: (ctx) => {
        ctx.record("approval.decision", approval.decision);
        ctx.record("approval.reasonCode", approval.reasonCode);
        ctx.record("approval.authoritySource", approval.authorityTrace.source);
        ctx.record("approval.authorityCapabilityId", approval.authorityTrace.capabilityId);
        ctx.record("approval.guardianVerdict", approval.guardianDecision.verdict);
        ctx.record("approval.guardianReason", approval.guardianDecision.reasonCode);
        ctx.record("approval.guardianDigestMatchesTrace", approval.guardianDecision.decisionDigest === approval.authorityTrace.guardianDecisionDigest);
        ctx.record("approval.limitCheckCount", approval.limitFindings.length);
        ctx.record("approval.allLimitsPassed", approval.limitFindings.every((f) => f.passed));
        ctx.record("approval.digestStable", approval.approvalDigest === approvalAgain.approvalDigest && approval.approvalId === approvalAgain.approvalId);
        ctx.record("approval.idPrefix", approval.approvalId.slice(0, 4));
      },
    },
    {
      stepId: "authorize-approved-order",
      kind: "plan",
      description: "The approved order advances to authorized through the EXISTING advanceActionState, carrying the Guardian decision",
      packages: ["@fleetos/actions", "@fleetos/policy"],
      operations: ["authorizeMarketplaceOrderAction", "advanceActionState"],
      run: (ctx) => {
        ctx.record("authorize.ok", authorized.ok);
        ctx.record("authorize.state", authorized.ok ? authorized.record.state : "unauthorized");
        ctx.record("authorize.guardianDigestCarried", authorized.ok
          ? authorized.record.authorization?.decisionDigest === approval.guardianDecision.decisionDigest
          : false);
        ctx.record("authorize.transitionTrail", authorized.ok ? authorized.record.stateHistory.map((t) => `${t.from}->${t.to}`) : []);
      },
    },
    {
      stepId: "refuse-over-limit",
      kind: "negative-check",
      description: "REFUSAL: an over-limit order is refused with reason refuse.amount_over_limit and NEVER authorizes; the rejection leaves the auditable terminal trail",
      packages: ["@fleetos/policy", "@fleetos/actions"],
      operations: ["evaluateMarketplaceOrderApproval", "authorizeMarketplaceOrderAction", "rejectMarketplaceOrderAction"],
      run: (ctx) => {
        ctx.record("overLimit.decision", overLimitApproval.decision);
        ctx.record("overLimit.reasonCode", overLimitApproval.reasonCode);
        ctx.record("overLimit.amountCheckPassed", overLimitApproval.limitFindings.find((f) => f.check === "check.amount_within_ceiling")?.passed);
        ctx.record("overLimit.amountObserved", overLimitApproval.limitFindings.find((f) => f.check === "check.amount_within_ceiling")?.observed);
        ctx.record("overLimit.amountLimit", overLimitApproval.limitFindings.find((f) => f.check === "check.amount_within_ceiling")?.limit);
        ctx.record("overLimit.authorizeOk", overLimitAuthorize.ok);
        ctx.record("overLimit.authorizeRefusalReason", overLimitAuthorize.ok ? "none" : overLimitAuthorize.reason);
        ctx.record("overLimit.stateAfterAuthorizeAttempt", overLimitProposed.record.state);
        ctx.record("overLimit.rejectedOk", overLimitRejected.ok);
        ctx.record("overLimit.rejectedState", overLimitRejected.ok ? overLimitRejected.record.state : "not-rejected");
      },
    },
    {
      stepId: "advisory-never-authorizes",
      kind: "guardian-decision",
      description: "The advisory law as a REAL public API: an approve-flavored advisory changes NOTHING — verdict, reason and digest stay byte-identical",
      packages: ["@fleetos/policy"],
      operations: ["assertAdvisoryNeverAuthorizes", "evaluateMarketplaceOrderApproval"],
      run: (ctx) => {
        ctx.record("advisory.lawHolds", advisoryCheck.holds);
        ctx.record("advisory.withDecision", advisoryCheck.withAdvisory.decision);
        ctx.record("advisory.withReason", advisoryCheck.withAdvisory.reasonCode);
        ctx.record("advisory.digestIdentical", advisoryCheck.withAdvisory.approvalDigest === advisoryCheck.withoutAdvisory.approvalDigest);
        ctx.record("advisory.idIdentical", advisoryCheck.withAdvisory.approvalId === advisoryCheck.withoutAdvisory.approvalId);
        ctx.record("advisory.hasNoAuthorityField", !advisoryKeys.includes("authority") && !advisoryKeys.includes("authorizedBy"));
        ctx.record("advisory.keys", advisoryKeys);
      },
    },
    {
      stepId: "refuse-cross-tenant",
      kind: "negative-check",
      description: "REFUSAL: the foreign tenant's policy NEVER approves the home order, and a foreign-tenant approval NEVER authorizes the home record",
      packages: ["@fleetos/policy", "@fleetos/actions"],
      operations: ["evaluateMarketplaceOrderApproval", "authorizeMarketplaceOrderAction"],
      run: (ctx) => {
        ctx.record("crossTenant.decision", crossTenantApproval.decision);
        ctx.record("crossTenant.reasonCode", crossTenantApproval.reasonCode);
        ctx.record("crossTenant.guardianReason", crossTenantApproval.guardianDecision.reasonCode);
        ctx.record("crossTenant.foreignOwnApprovalTenant", foreignOwnApproval.tenantId);
        ctx.record("crossTenant.foreignOwnDecision", foreignOwnApproval.decision);
        ctx.record("crossTenant.authorizeOk", foreignAuthorize.ok);
        ctx.record("crossTenant.authorizeRefusalReason", foreignAuthorize.ok ? "none" : foreignAuthorize.reason);
        ctx.record("crossTenant.stateAfterForeignAttempt", proposed.record.state);
      },
    },
  ],
  assertions: [
    { assertionId: "ap-1", description: "The proposed order enters the A4 protocol in the proposed state", path: "propose.state", expected: "proposed" },
    { assertionId: "ap-2", description: "The intent id derives from the request id", path: "propose.intentId", expected: "intent-req-j1" },
    { assertionId: "ap-3", description: "The canonical marketplace capability id", path: "propose.capabilityId", expected: MARKETPLACE_ORDER_CAPABILITY_ID },
    { assertionId: "ap-4", description: "The capability category is execute.commerce", path: "propose.capabilityCategory", expected: "execute.commerce" },
    { assertionId: "ap-5", description: "Every marketplace order is consequential (high risk)", path: "propose.capabilityRisk", expected: "high" },
    { assertionId: "ap-6", description: "The idempotency nonce is the order id (marketplace natural key)", path: "propose.idempotencyNonce", expected: "order-100" },
    { assertionId: "ap-7", description: "The order material is carried as intent inputs", path: "propose.inputsOrderId", expected: "order-100" },
    { assertionId: "ap-8", description: "Policy references are carried sorted and machine-stable", path: "propose.inputsPolicyRefs", expected: ["budget:pol-budget-2:2.1.0", "procurement:pol-proc-1:1.0.0"] },
    { assertionId: "ap-9", description: "A within-limits order is approved", path: "approval.decision", expected: "approve" },
    { assertionId: "ap-10", description: "The approval reason is approve.within_limits", path: "approval.reasonCode", expected: "approve.within_limits" },
    { assertionId: "ap-11", description: "The ONLY authority source is the existing Guardian", path: "approval.authoritySource", expected: "guardian.evaluateCapability" },
    { assertionId: "ap-12", description: "The authority trace names the marketplace capability", path: "approval.authorityCapabilityId", expected: "cap.marketplace.order" },
    { assertionId: "ap-13", description: "The composed Guardian verdict flows through verbatim", path: "approval.guardianVerdict", expected: "REQUIRE_APPROVAL" },
    { assertionId: "ap-14", description: "The composed Guardian reason code flows through verbatim", path: "approval.guardianReason", expected: "require_approval.high_risk" },
    { assertionId: "ap-15", description: "The trace digest equals the Guardian decision digest", path: "approval.guardianDigestMatchesTrace", expected: true },
    { assertionId: "ap-16", description: "All eight limit checks are evaluated", path: "approval.limitCheckCount", expected: 8 },
    { assertionId: "ap-17", description: "Every limit check passes for the in-limits order", path: "approval.allLimitsPassed", expected: true },
    { assertionId: "ap-18", description: "Deterministic: rerun approval is byte-identical", path: "approval.digestStable", expected: true },
    { assertionId: "ap-19", description: "Approval ids carry the mpa- prefix", path: "approval.idPrefix", expected: "mpa-" },
    { assertionId: "ap-20", description: "The approved order authorizes through the existing protocol", path: "authorize.ok", expected: true },
    { assertionId: "ap-21", description: "The authorized record reaches the authorized state", path: "authorize.state", expected: "authorized" },
    { assertionId: "ap-22", description: "The Guardian decision digest is carried on the record", path: "authorize.guardianDigestCarried", expected: true },
    { assertionId: "ap-23", description: "The A4 transition trail is proposed->authorized", path: "authorize.transitionTrail", expected: ["proposed->authorized"] },
    { assertionId: "ap-24", description: "REFUSAL: the over-limit order is refused", path: "overLimit.decision", expected: "refuse" },
    { assertionId: "ap-25", description: "REFUSAL reason: refuse.amount_over_limit", path: "overLimit.reasonCode", expected: "refuse.amount_over_limit" },
    { assertionId: "ap-26", description: "The amount check fails with observed 42000 vs ceiling 15000", path: "overLimit.amountCheckPassed", expected: false },
    { assertionId: "ap-27", description: "The observed amount is machine-reported", path: "overLimit.amountObserved", expected: "42000" },
    { assertionId: "ap-28", description: "The ceiling is machine-reported", path: "overLimit.amountLimit", expected: "15000" },
    { assertionId: "ap-29", description: "REFUSAL: a refused approval NEVER authorizes", path: "overLimit.authorizeOk", expected: false },
    { assertionId: "ap-30", description: "The authorization refusal reason is the A4 execute-without-authorization law", path: "overLimit.authorizeRefusalReason", expected: "refused.execute_without_authorization" },
    { assertionId: "ap-31", description: "The record stays proposed after the refused authorization attempt", path: "overLimit.stateAfterAuthorizeAttempt", expected: "proposed" },
    { assertionId: "ap-32", description: "The refusal leaves the auditable rejected terminal state", path: "overLimit.rejectedOk", expected: true },
    { assertionId: "ap-33", description: "The rejected record's state is rejected", path: "overLimit.rejectedState", expected: "rejected" },
    { assertionId: "ap-34", description: "The advisory law holds: decisions are advisory-independent", path: "advisory.lawHolds", expected: true },
    { assertionId: "ap-35", description: "The advisory CANNOT rescue the over-limit refusal", path: "advisory.withDecision", expected: "refuse" },
    { assertionId: "ap-36", description: "The refusal reason is unchanged with the advisory attached", path: "advisory.withReason", expected: "refuse.amount_over_limit" },
    { assertionId: "ap-37", description: "The digest is byte-identical with and without the advisory", path: "advisory.digestIdentical", expected: true },
    { assertionId: "ap-38", description: "The approval id is byte-identical with and without the advisory", path: "advisory.idIdentical", expected: true },
    { assertionId: "ap-39", description: "The advisory type exposes NO authority surface at all", path: "advisory.hasNoAuthorityField", expected: true },
    { assertionId: "ap-40", description: "The advisory's only fields are input data (rationale/recommendation/source)", path: "advisory.keys", expected: ["rationale", "recommendation", "source"] },
    { assertionId: "ap-41", description: "REFUSAL: the foreign policy refuses the home order", path: "crossTenant.decision", expected: "refuse" },
    { assertionId: "ap-42", description: "REFUSAL reason: refuse.cross_tenant", path: "crossTenant.reasonCode", expected: "refuse.cross_tenant" },
    { assertionId: "ap-43", description: "The Guardian's own cross_tenant block is preserved verbatim", path: "crossTenant.guardianReason", expected: "block.cross_tenant" },
    { assertionId: "ap-44", description: "The foreign tenant's own request approves under its own policy", path: "crossTenant.foreignOwnDecision", expected: "approve" },
    { assertionId: "ap-45", description: "The foreign approval belongs to the foreign tenant", path: "crossTenant.foreignOwnApprovalTenant", expected: "globex-rival" },
    { assertionId: "ap-46", description: "REFUSAL: the foreign approval NEVER authorizes the home record", path: "crossTenant.authorizeOk", expected: false },
    { assertionId: "ap-47", description: "The refusal reason is the existing tenant-mismatch law", path: "crossTenant.authorizeRefusalReason", expected: "refused.tenant_mismatch" },
    { assertionId: "ap-48", description: "The home record stays proposed after the foreign attempt", path: "crossTenant.stateAfterForeignAttempt", expected: "proposed" },
  ],
};
