/**
 * F361B marketplace Guardian approval contract tests (packages/policy).
 *
 * Frozen law: MARKETPLACE-MVP-FREEZE.md §3.6 — limit checks
 * (amount/category/policy references), approval vs refusal with reason
 * codes, advisory recommendations NEVER self-authorize, and composition of
 * the EXISTING Guardian (evaluateCapability) with zero new authority truth.
 */

import { describe, it, expect } from "vitest";
import { evaluateCapability } from "../src/guardian.ts";
import {
  MARKETPLACE_ORDER_CAPABILITY_ID,
  MARKETPLACE_PILOT_TRANSACTION_KINDS,
  assertAdvisoryNeverAuthorizes,
  evaluateMarketplaceOrderApproval,
  marketplaceOrderCapability,
} from "../src/marketplace-approval.ts";
import type {
  MarketplaceAdvisoryRecommendation,
  MarketplaceApprovalLimits,
  MarketplaceOrderApprovalRequest,
  MarketplacePolicyRef,
} from "../src/marketplace-approval.ts";
import type { Policy, PolicyRule } from "../src/policy.ts";
import type { TenantScopeLike } from "../src/capability.ts";

const TENANT: TenantScopeLike = { tenantId: "acme-ops" };
const FOREIGN_TENANT: TenantScopeLike = { tenantId: "globex-rival" };

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

const allowHighRiskRule: PolicyRule = {
  id: "rule.require_human_approval_for_high_risk",
  description: "high-risk execution requires human approval",
  riskFloor: "medium",
  riskCeiling: "high",
  requiredAuthority: ["human.approval"],
  tenantScope: "single",
  verdict: "REQUIRE_APPROVAL",
  priority: 20,
};

function basePolicy(tenantId = TENANT.tenantId, rules: readonly PolicyRule[] = [allowHighRiskRule]): Policy {
  return { id: "pol-1", version: "1.0.0", tenantId, rules, defaultVerdict: "BLOCK", failClosed: true };
}

function baseRequest(overrides: Partial<MarketplaceOrderApprovalRequest> = {}): MarketplaceOrderApprovalRequest {
  return {
    requestId: "req-001",
    tenant: TENANT,
    actor: { actorId: "operator-1", authority: ["tenant.operator", "human.approval"], isAutonomous: false },
    order: {
      orderId: "order-100",
      category: "laptops",
      transactionKind: "purchase",
      units: 5,
      amount: { total: 9_500, currency: "GHS" },
      supplierRef: { supplierId: "sup-7", verificationRef: "verify-sup-7-2026" },
      offerSnapshotRef: "mpe-offer-order-100",
    },
    limits: LIMITS,
    policyRefs: POLICY_REFS,
    ...overrides,
  };
}

describe("F361B marketplace order approval — the approval path", () => {
  it("approves a within-limits purchase order with reason approve.within_limits", () => {
    const approval = evaluateMarketplaceOrderApproval(basePolicy(), baseRequest());
    expect(approval.decision).toBe("approve");
    expect(approval.reasonCode).toBe("approve.within_limits");
    expect(approval.tenantId).toBe("acme-ops");
    expect(approval.orderId).toBe("order-100");
    expect(approval.requestId).toBe("req-001");
  });

  it("the authority trace names the EXISTING Guardian as the only source", () => {
    const approval = evaluateMarketplaceOrderApproval(basePolicy(), baseRequest());
    expect(approval.authorityTrace.source).toBe("guardian.evaluateCapability");
    expect(approval.authorityTrace.capabilityId).toBe(MARKETPLACE_ORDER_CAPABILITY_ID);
    expect(approval.authorityTrace.guardianDecisionDigest).toBe(approval.guardianDecision.decisionDigest);
  });

  it("the composed Guardian decision matches a direct evaluateCapability call (no new authority truth)", () => {
    const request = baseRequest();
    const policy = basePolicy();
    const approval = evaluateMarketplaceOrderApproval(policy, request);
    const direct = evaluateCapability(
      policy,
      marketplaceOrderCapability(request.order),
      {
        tenant: request.tenant,
        capability: marketplaceOrderCapability(request.order),
        actor: { actorId: request.actor.actorId, authority: request.actor.authority, isAutonomous: request.actor.isAutonomous },
        degraded: false,
      },
    );
    expect(approval.guardianDecision.verdict).toBe(direct.verdict);
    expect(approval.guardianDecision.reasonCode).toBe(direct.reasonCode);
    expect(approval.guardianDecision.decisionDigest).toBe(direct.decisionDigest);
  });

  it("all eight limit checks are always evaluated and reported in canonical order", () => {
    const approval = evaluateMarketplaceOrderApproval(basePolicy(), baseRequest());
    expect(approval.limitFindings.map((f) => f.check)).toEqual([
      "check.transaction_kind_in_scope",
      "check.currency_is_pilot",
      "check.amount_within_ceiling",
      "check.category_allowed",
      "check.units_within_max",
      "check.policy_references_present",
      "check.supplier_verification_ref_present",
      "check.offer_snapshot_evidence_present",
    ]);
    expect(approval.limitFindings.every((f) => f.passed)).toBe(true);
  });

  it("deterministic: identical request => byte-identical approval (id + digest)", () => {
    const a = evaluateMarketplaceOrderApproval(basePolicy(), baseRequest());
    const b = evaluateMarketplaceOrderApproval(basePolicy(), baseRequest());
    expect(a).toEqual(b);
    expect(a.approvalId).toBe(b.approvalId);
    expect(a.approvalDigest).toBe(b.approvalDigest);
    expect(a.approvalId).toMatch(/^mpa-/);
  });

  it("guardian WARN passes through as approve.guardian_warned", () => {
    const warnRule: PolicyRule = { ...allowHighRiskRule, verdict: "WARN" };
    const approval = evaluateMarketplaceOrderApproval(basePolicy(TENANT.tenantId, [warnRule]), baseRequest());
    expect(approval.decision).toBe("approve");
    expect(approval.reasonCode).toBe("approve.guardian_warned");
  });
});

describe("F361B marketplace order approval — refusal reason codes", () => {
  it("REFUSAL: amount over ceiling refuses with refuse.amount_over_limit", () => {
    const request = baseRequest({ order: { ...baseRequest().order, amount: { total: 42_000, currency: "GHS" } } });
    const approval = evaluateMarketplaceOrderApproval(basePolicy(), request);
    expect(approval.decision).toBe("refuse");
    expect(approval.reasonCode).toBe("refuse.amount_over_limit");
    const amountCheck = approval.limitFindings.find((f) => f.check === "check.amount_within_ceiling");
    expect(amountCheck?.passed).toBe(false);
    expect(amountCheck?.observed).toBe("42000");
    expect(amountCheck?.limit).toBe("15000");
  });

  it("REFUSAL: currency outside the pilot currency refuses with refuse.currency_not_pilot", () => {
    const request = baseRequest({ order: { ...baseRequest().order, amount: { total: 100, currency: "USD" } } });
    const approval = evaluateMarketplaceOrderApproval(basePolicy(), request);
    expect(approval.decision).toBe("refuse");
    expect(approval.reasonCode).toBe("refuse.currency_not_pilot");
  });

  it("REFUSAL: category outside the frozen pilot categories refuses with refuse.category_not_allowed", () => {
    const request = baseRequest({ order: { ...baseRequest().order, category: "printers" }, limits: { ...LIMITS, allowedCategories: ["laptops"] } });
    const approval = evaluateMarketplaceOrderApproval(basePolicy(), request);
    expect(approval.decision).toBe("refuse");
    expect(approval.reasonCode).toBe("refuse.category_not_allowed");
  });

  it("REFUSAL: units over max refuses with refuse.units_over_limit", () => {
    const request = baseRequest({ order: { ...baseRequest().order, units: 11 } });
    const approval = evaluateMarketplaceOrderApproval(basePolicy(), request);
    expect(approval.decision).toBe("refuse");
    expect(approval.reasonCode).toBe("refuse.units_over_limit");
  });

  it("REFUSAL: missing policy references refuse with refuse.missing_policy_reference", () => {
    const request = baseRequest({ policyRefs: [{ policyKind: "procurement", policyId: "pol-proc-1", version: "1.0.0" }] });
    const approval = evaluateMarketplaceOrderApproval(basePolicy(), request);
    expect(approval.decision).toBe("refuse");
    expect(approval.reasonCode).toBe("refuse.missing_policy_reference");
    const policyCheck = approval.limitFindings.find((f) => f.check === "check.policy_references_present");
    expect(policyCheck?.observed).toBe("procurement");
    expect(policyCheck?.limit).toBe("budget|procurement");
  });

  it("REFUSAL: empty policy references refuse (no silent default)", () => {
    const request = baseRequest({ policyRefs: [] });
    const approval = evaluateMarketplaceOrderApproval(basePolicy(), request);
    expect(approval.decision).toBe("refuse");
    expect(approval.reasonCode).toBe("refuse.missing_policy_reference");
  });

  it("REFUSAL: missing supplier verification reference refuses with refuse.missing_supplier_verification_ref", () => {
    const request = baseRequest({ order: { ...baseRequest().order, supplierRef: { supplierId: "sup-7", verificationRef: "" } } });
    const approval = evaluateMarketplaceOrderApproval(basePolicy(), request);
    expect(approval.decision).toBe("refuse");
    expect(approval.reasonCode).toBe("refuse.missing_supplier_verification_ref");
  });

  it("REFUSAL: missing offer-snapshot evidence reference refuses with refuse.missing_offer_snapshot_evidence", () => {
    const request = baseRequest({ order: { ...baseRequest().order, offerSnapshotRef: "" } });
    const approval = evaluateMarketplaceOrderApproval(basePolicy(), request);
    expect(approval.decision).toBe("refuse");
    expect(approval.reasonCode).toBe("refuse.missing_offer_snapshot_evidence");
  });

  it("REFUSAL: rental and lease are typed follow-on states that ALWAYS refuse (kind_not_in_pilot_scope)", () => {
    for (const kind of ["rental", "lease"] as const) {
      const request = baseRequest({ order: { ...baseRequest().order, transactionKind: kind } });
      const approval = evaluateMarketplaceOrderApproval(basePolicy(), request);
      expect(approval.decision).toBe("refuse");
      expect(approval.reasonCode).toBe("refuse.kind_not_in_pilot_scope");
    }
    expect(MARKETPLACE_PILOT_TRANSACTION_KINDS).toEqual(["purchase", "repair-service"]);
  });

  it("REFUSAL: cross-tenant policy mirrors the Guardian block as refuse.cross_tenant", () => {
    const approval = evaluateMarketplaceOrderApproval(
      basePolicy(FOREIGN_TENANT.tenantId),
      baseRequest(),
    );
    expect(approval.decision).toBe("refuse");
    expect(approval.reasonCode).toBe("refuse.cross_tenant");
    expect(approval.guardianDecision.reasonCode).toBe("block.cross_tenant");
  });

  it("REFUSAL: autonomous actor without human.approval refuses with refuse.self_authorization", () => {
    const request = baseRequest({
      actor: { actorId: "agent-9", authority: ["guardian.autonomous"], isAutonomous: true },
    });
    const approval = evaluateMarketplaceOrderApproval(basePolicy(), request);
    expect(approval.decision).toBe("refuse");
    expect(approval.reasonCode).toBe("refuse.self_authorization");
    expect(approval.guardianDecision.reasonCode).toBe("block.self_authorization");
  });

  it("REFUSAL: actor lacking human.approval under REQUIRE_APPROVAL refuses with refuse.actor_missing_human_approval", () => {
    // A rule that matches on engineer authority but still demands approval —
    // the Guardian answers REQUIRE_APPROVAL and the requesting actor lacks
    // the human.approval AuthorityKind, so the request cannot self-satisfy.
    const engineerApprovalRule: PolicyRule = {
      id: "rule.require_mission_owner_for_work",
      description: "engineer-flagged consequential work still requires approval",
      riskFloor: "medium",
      riskCeiling: "high",
      requiredAuthority: ["tenant.engineer"],
      tenantScope: "single",
      verdict: "REQUIRE_APPROVAL",
      priority: 20,
    };
    const request = baseRequest({
      actor: { actorId: "engineer-3", authority: ["tenant.engineer"], isAutonomous: false },
    });
    const approval = evaluateMarketplaceOrderApproval(basePolicy(TENANT.tenantId, [engineerApprovalRule]), request);
    expect(approval.decision).toBe("refuse");
    expect(approval.reasonCode).toBe("refuse.actor_missing_human_approval");
    expect(approval.guardianDecision.verdict).toBe("REQUIRE_APPROVAL");
  });

  it("REFUSAL: degraded context refuses through the Guardian (fail-closed, no soft path)", () => {
    const request = baseRequest({ degraded: true });
    const approval = evaluateMarketplaceOrderApproval(basePolicy(), request);
    expect(approval.decision).toBe("refuse");
    expect(approval.reasonCode).toBe("refuse.guardian_refused");
    expect(approval.guardianDecision.reasonCode).toBe("block.policy_fail_closed");
  });

  it("every limit check runs even when the Guardian already refused (full audit trail)", () => {
    const request = baseRequest({
      order: { ...baseRequest().order, amount: { total: 99_999, currency: "EUR" } },
    });
    const approval = evaluateMarketplaceOrderApproval(basePolicy(FOREIGN_TENANT.tenantId), request);
    expect(approval.decision).toBe("refuse");
    expect(approval.reasonCode).toBe("refuse.cross_tenant");
    expect(approval.limitFindings.length).toBe(8);
    expect(approval.limitFindings.filter((f) => !f.passed).map((f) => f.check)).toEqual([
      "check.currency_is_pilot",
      "check.amount_within_ceiling",
    ]);
  });
});

describe("F361B marketplace order approval — advisory NEVER self-authorizes", () => {
  const APPROVE_ADVISORY: MarketplaceAdvisoryRecommendation = {
    source: "predictive.model/supplier-score",
    recommendation: "approve",
    rationale: "model suggests the order is routine",
  };

  it("the advisory type exposes NO authority surface (input data only)", () => {
    const advisory = APPROVE_ADVISORY as unknown as Record<string, unknown>;
    expect(Object.keys(advisory).sort()).toEqual(["rationale", "recommendation", "source"]);
    expect("authority" in advisory).toBe(false);
    expect("authorizedBy" in advisory).toBe(false);
  });

  it("assertAdvisoryNeverAuthorizes holds: with/without are byte-identical", () => {
    const check = assertAdvisoryNeverAuthorizes(basePolicy(), baseRequest(), APPROVE_ADVISORY);
    expect(check.holds).toBe(true);
    expect(check.withAdvisory.decision).toBe(check.withoutAdvisory.decision);
    expect(check.withAdvisory.reasonCode).toBe(check.withoutAdvisory.reasonCode);
    expect(check.withAdvisory.approvalDigest).toBe(check.withoutAdvisory.approvalDigest);
    expect(check.withAdvisory.approvalId).toBe(check.withoutAdvisory.approvalId);
  });

  it("an approve-flavored advisory CANNOT rescue an over-limit order (still refused, identical digest)", () => {
    const overLimit = baseRequest({ order: { ...baseRequest().order, amount: { total: 42_000, currency: "GHS" } } });
    const check = assertAdvisoryNeverAuthorizes(basePolicy(), overLimit, APPROVE_ADVISORY);
    expect(check.holds).toBe(true);
    expect(check.withAdvisory.decision).toBe("refuse");
    expect(check.withAdvisory.reasonCode).toBe("refuse.amount_over_limit");
  });

  it("an approve-flavored advisory CANNOT rescue an autonomous self-authorization attempt", () => {
    const autonomous = baseRequest({
      actor: { actorId: "agent-9", authority: ["guardian.autonomous"], isAutonomous: true },
    });
    const check = assertAdvisoryNeverAuthorizes(basePolicy(), autonomous, APPROVE_ADVISORY);
    expect(check.holds).toBe(true);
    expect(check.withAdvisory.decision).toBe("refuse");
    expect(check.withAdvisory.reasonCode).toBe("refuse.self_authorization");
  });

  it("a refuse-flavored advisory cannot veto an in-limits order either (zero advisory influence)", () => {
    const refuseAdvisory: MarketplaceAdvisoryRecommendation = {
      source: "predictive.model/supplier-score",
      recommendation: "refuse",
      rationale: "model suggests caution",
    };
    const check = assertAdvisoryNeverAuthorizes(basePolicy(), baseRequest(), refuseAdvisory);
    expect(check.holds).toBe(true);
    expect(check.withAdvisory.decision).toBe("approve");
    expect(check.withAdvisory.reasonCode).toBe("approve.within_limits");
  });
});

describe("F361B marketplace order approval — the canonical capability", () => {
  it("marketplaceOrderCapability emits the law-A15 vocabulary shape", () => {
    const capability = marketplaceOrderCapability(baseRequest().order);
    expect(capability.id).toBe(MARKETPLACE_ORDER_CAPABILITY_ID);
    expect(capability.category).toBe("execute.commerce");
    expect(capability.risk).toBe("high");
    expect(capability.tenantScope).toBe("single");
    expect(capability.verification.kind).toBe("external.receipt");
    expect(capability.idempotency.keyShape).toEqual(["tenantId", "orderId"]);
    expect(capability.resourceScope.vendorIds).toEqual(["sup-7"]);
    expect(capability.version).toBe("1.0.0");
  });

  it("the money boundary is encoded in the capability description (order+invoice-record; manual settlement only)", () => {
    const capability = marketplaceOrderCapability(baseRequest().order);
    expect(capability.description).toContain("purchase + repair-service");
    expect(capability.sideEffects[0]?.description).toContain("manual settlement only");
    expect(capability.sideEffects[0]?.reversible).toBe(false);
  });
});
