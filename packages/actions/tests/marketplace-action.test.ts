/**
 * F361B marketplace-order action composition tests (packages/actions).
 *
 * Frozen law: MARKETPLACE-MVP-FREEZE.md §3.6 — the approval contract
 * composed onto the EXISTING consequential-action protocol. A refused
 * approval NEVER authorizes; a foreign tenant NEVER advances; the
 * protocol's own state-machine laws are untouched (composed, not
 * duplicated).
 */

import { describe, it, expect } from "vitest";
import { evaluateMarketplaceOrderApproval } from "@fleetos/policy/marketplace-approval";
import type {
  MarketplaceApprovalLimits,
  MarketplaceOrderApprovalRequest,
  MarketplacePolicyRef,
} from "@fleetos/policy/marketplace-approval";
import type { Policy, PolicyRule } from "@fleetos/policy/policy";
import type { TenantScopeLike } from "@fleetos/policy/capability";
import { authorizeMarketplaceOrderAction, proposeMarketplaceOrderAction, rejectMarketplaceOrderAction } from "../src/marketplace-action.ts";
import { advanceActionState } from "../src/index.ts";

const TENANT: TenantScopeLike = { tenantId: "acme-ops" };
const FOREIGN_TENANT: TenantScopeLike = { tenantId: "globex-rival" };
const AT = "2026-10-14T09:00:00.000Z";

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

const POLICY: Policy = { id: "pol-1", version: "1.0.0", tenantId: TENANT.tenantId, rules: [allowHighRiskRule], defaultVerdict: "BLOCK", failClosed: true };

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

describe("F361B marketplace action — propose (the existing protocol entry)", () => {
  it("proposeMarketplaceOrderAction produces a proposed-state record through proposeAction", () => {
    const { record, capability } = proposeMarketplaceOrderAction(baseRequest(), AT);
    expect(record.state).toBe("proposed");
    expect(record.intent.intentId).toBe("intent-req-001");
    expect(record.intent.tenant.tenantId).toBe("acme-ops");
    expect(record.intent.proposedBy).toBe("operator-1");
    expect(record.intent.proposedAt).toBe(AT);
    expect(capability.id).toBe("cap.marketplace.order");
    expect(record.stateHistory).toEqual([]);
  });

  it("the intent carries the marketplace order material as inputs (machine-stable)", () => {
    const { record } = proposeMarketplaceOrderAction(baseRequest(), AT);
    expect(record.intent.inputs).toEqual({
      requestId: "req-001",
      orderId: "order-100",
      category: "laptops",
      transactionKind: "purchase",
      units: 5,
      amountTotal: 9_500,
      currency: "GHS",
      supplierId: "sup-7",
      supplierVerificationRef: "verify-sup-7-2026",
      offerSnapshotRef: "mpe-offer-order-100",
      policyRefs: ["budget:pol-budget-2:2.1.0", "procurement:pol-proc-1:1.0.0"],
    });
  });

  it("the idempotency key is the marketplace natural key (tenant|capability|order)", () => {
    const { record } = proposeMarketplaceOrderAction(baseRequest(), AT);
    expect(record.intent.idempotencyKey).toEqual({
      tenantId: "acme-ops",
      capabilityId: "cap.marketplace.order",
      nonce: "order-100",
    });
  });

  it("deterministic: same request => byte-identical record", () => {
    const a = proposeMarketplaceOrderAction(baseRequest(), AT);
    const b = proposeMarketplaceOrderAction(baseRequest(), AT);
    expect(a.record).toEqual(b.record);
  });
});

describe("F361B marketplace action — authorize (approval applied through the existing machine)", () => {
  it("an approved order advances to authorized carrying the Guardian decision", () => {
    const request = baseRequest();
    const { record } = proposeMarketplaceOrderAction(request, AT);
    const approval = evaluateMarketplaceOrderApproval(POLICY, request);
    expect(approval.decision).toBe("approve");
    const result = authorizeMarketplaceOrderAction(record, approval, { at: AT, tenantId: TENANT.tenantId });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.record.state).toBe("authorized");
      expect(result.record.authorization?.verdict).toBe("REQUIRE_APPROVAL");
      expect(result.record.authorization?.decisionDigest).toBe(approval.guardianDecision.decisionDigest);
      expect(result.record.stateHistory).toHaveLength(1);
      expect(result.record.stateHistory[0]?.from).toBe("proposed");
      expect(result.record.stateHistory[0]?.to).toBe("authorized");
    }
  });

  it("REFUSAL: a refused approval NEVER authorizes (execute_without_authorization)", () => {
    const request = baseRequest({ order: { ...baseRequest().order, amount: { total: 42_000, currency: "GHS" } } });
    const { record } = proposeMarketplaceOrderAction(request, AT);
    const approval = evaluateMarketplaceOrderApproval(POLICY, request);
    expect(approval.decision).toBe("refuse");
    expect(approval.reasonCode).toBe("refuse.amount_over_limit");
    const result = authorizeMarketplaceOrderAction(record, approval, { at: AT, tenantId: TENANT.tenantId });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("refused.execute_without_authorization");
    expect(record.state).toBe("proposed");
  });

  it("REFUSAL: a foreign-tenant approval never authorizes the record (tenant_mismatch)", () => {
    const request = baseRequest();
    const { record } = proposeMarketplaceOrderAction(request, AT);
    // An approval genuinely ADJUDICATED for the rival tenant (own policy,
    // own tenant context, approved there) — applied to acme's record it
    // must fail closed on tenant mismatch before any verdict is read.
    const foreignRequest = baseRequest({ tenant: FOREIGN_TENANT });
    const foreignPolicy: Policy = { ...POLICY, tenantId: FOREIGN_TENANT.tenantId };
    const foreignApproval = evaluateMarketplaceOrderApproval(foreignPolicy, foreignRequest);
    expect(foreignApproval.tenantId).toBe("globex-rival");
    expect(foreignApproval.decision).toBe("approve");
    const result = authorizeMarketplaceOrderAction(record, foreignApproval, { at: AT, tenantId: TENANT.tenantId });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("refused.tenant_mismatch");
    expect(record.state).toBe("proposed");
  });

  it("REFUSAL: a foreign caller never authorizes (the existing advanceActionState tenant law)", () => {
    const request = baseRequest();
    const { record } = proposeMarketplaceOrderAction(request, AT);
    const approval = evaluateMarketplaceOrderApproval(POLICY, request);
    const result = authorizeMarketplaceOrderAction(record, approval, { at: AT, tenantId: FOREIGN_TENANT.tenantId });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("refused.tenant_mismatch");
  });

  it("a blocked Guardian decision inside an approved outcome still cannot authorize (defense in depth)", () => {
    const request = baseRequest();
    const { record } = proposeMarketplaceOrderAction(request, AT);
    const approval = evaluateMarketplaceOrderApproval(POLICY, request);
    // A forged "approve" wrapper around a BLOCK GuardianDecision — the
    // EXISTING advanceActionState refuses BLOCK authorizations.
    const forged = { ...approval, decision: "approve" as const, guardianDecision: { ...approval.guardianDecision, verdict: "BLOCK" as const } };
    const result = authorizeMarketplaceOrderAction(record, forged, { at: AT, tenantId: TENANT.tenantId });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("refused.execute_without_authorization");
  });
});

describe("F361B marketplace action — reject (the auditable refusal trail)", () => {
  it("a refused approval advances the record to the rejected terminal state", () => {
    const request = baseRequest({ order: { ...baseRequest().order, amount: { total: 42_000, currency: "GHS" } } });
    const { record } = proposeMarketplaceOrderAction(request, AT);
    const approval = evaluateMarketplaceOrderApproval(POLICY, request);
    const result = rejectMarketplaceOrderAction(record, approval, { at: AT, tenantId: TENANT.tenantId });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.record.state).toBe("rejected");
      expect(result.record.stateHistory[0]?.to).toBe("rejected");
    }
    const after = advanceActionState(result.ok ? result.record : record, "authorized", { at: AT, tenantId: TENANT.tenantId });
    expect(after.ok).toBe(false);
  });

  it("REFUSAL: an approved order is never silently rejected through the refusal path", () => {
    const request = baseRequest();
    const { record } = proposeMarketplaceOrderAction(request, AT);
    const approval = evaluateMarketplaceOrderApproval(POLICY, request);
    const result = rejectMarketplaceOrderAction(record, approval, { at: AT, tenantId: TENANT.tenantId });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("refused.no_op_transition");
    expect(record.state).toBe("proposed");
  });

  it("REFUSAL: a foreign tenant cannot reject the order either (tenant_mismatch)", () => {
    const request = baseRequest();
    const { record } = proposeMarketplaceOrderAction(request, AT);
    // A refused approval that belongs to the RIVAL tenant — its tenant
    // mismatch fails closed before the refusal path is even entered.
    const foreignRequest = baseRequest({
      tenant: FOREIGN_TENANT,
      order: { ...baseRequest().order, amount: { total: 42_000, currency: "GHS" } },
    });
    const foreignPolicy: Policy = { ...POLICY, tenantId: FOREIGN_TENANT.tenantId };
    const foreignRefusal = evaluateMarketplaceOrderApproval(foreignPolicy, foreignRequest);
    expect(foreignRefusal.tenantId).toBe("globex-rival");
    expect(foreignRefusal.decision).toBe("refuse");
    const result = rejectMarketplaceOrderAction(record, foreignRefusal, { at: AT, tenantId: TENANT.tenantId });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("refused.tenant_mismatch");
    expect(record.state).toBe("proposed");
  });
});

describe("F361B marketplace action — the full A4 trail (composed, no new protocol truth)", () => {
  it("an approved marketplace order can walk the EXISTING protocol to confirmed/dispatched", () => {
    const request = baseRequest();
    let { record } = proposeMarketplaceOrderAction(request, AT);
    const approval = evaluateMarketplaceOrderApproval(POLICY, request);

    const auth = authorizeMarketplaceOrderAction(record, approval, { at: AT, tenantId: TENANT.tenantId });
    expect(auth.ok).toBe(true);
    if (auth.ok) record = auth.record;

    const confirmed = advanceActionState(record, "confirmed", { at: AT, tenantId: TENANT.tenantId, confirmedBy: "operator-1" });
    expect(confirmed.ok).toBe(true);
    if (confirmed.ok) record = confirmed.record;

    const dispatched = advanceActionState(record, "dispatched", { at: AT, tenantId: TENANT.tenantId, dispatchReceipt: "dispatch-order-100" });
    expect(dispatched.ok).toBe(true);
    if (dispatched.ok) record = dispatched.record;

    expect(record.state).toBe("dispatched");
    expect(record.stateHistory.map((t) => t.to)).toEqual(["authorized", "confirmed", "dispatched"]);
  });
});
