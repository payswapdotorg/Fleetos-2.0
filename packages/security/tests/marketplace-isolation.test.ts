/**
 * F361B security laws — tenant isolation over the NEW marketplace contract
 * surfaces (packages/security).
 *
 * Frozen law: MARKETPLACE-MVP-FREEZE.md §3.6 + §4 — "tenant isolation at
 * domain boundaries (fail-closed reads)" for the marketplace approval
 * contract (packages/policy + packages/actions) and the evidence-retention
 * contract (packages/evidence).
 *
 * These are TESTS of other lane-owned contract surfaces (law: the security
 * package owns the fail-closed VERIFICATION, never the marketplace truth).
 * The package's runtime surface stays dependency-free — the cross-package
 * imports below are devDependencies used ONLY by this test file.
 *
 * Machine-checked laws (all fail-closed, all deterministic):
 *   1. a foreign tenant's policy can never approve an order (approval
 *      refuse + Guardian cross_tenant block);
 *   2. a foreign tenant's approval can never authorize another tenant's
 *      action record (refused.tenant_mismatch);
 *   3. a foreign tenant can never read another tenant's evidence (null,
 *      indistinguishable from absence);
 *   4. a foreign tenant can never write into another tenant's evidence
 *      scope (refused.tenant_mismatch, store unchanged);
 *   5. provider-event dedup never crosses tenants (no cross-tenant
 *      identity leak);
 *   6. an advisory recommendation can never close any of these refusals
 *      (the F360 §3.6 advisory law).
 */

import { describe, it, expect } from "vitest";
import { evaluateMarketplaceOrderApproval, assertAdvisoryNeverAuthorizes } from "@fleetos/policy/marketplace-approval";
import type {
  MarketplaceAdvisoryRecommendation,
  MarketplaceApprovalLimits,
  MarketplaceOrderApprovalRequest,
  MarketplacePolicyRef,
} from "@fleetos/policy/marketplace-approval";
import type { Policy, PolicyRule } from "@fleetos/policy/policy";
import type { TenantScopeLike } from "@fleetos/policy/capability";
import { authorizeMarketplaceOrderAction, proposeMarketplaceOrderAction } from "@fleetos/actions/marketplace-action";
import { InMemoryMarketplaceEvidenceStore } from "@fleetos/evidence/marketplace-evidence";
import type { MarketplaceEvidenceInput } from "@fleetos/evidence/marketplace-evidence";
import { buildArtifact, utf8Bytes } from "@fleetos/evidence";

const TENANT: TenantScopeLike = { tenantId: "acme-ops" };
const FOREIGN: TenantScopeLike = { tenantId: "globex-rival" };
const AT = "2026-10-14T10:00:00.000Z";

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

function policyOf(tenantId: string): Policy {
  return { id: "pol-1", version: "1.0.0", tenantId, rules: [RULE], defaultVerdict: "BLOCK", failClosed: true };
}

function request(tenant: TenantScopeLike, amount = 9_500): MarketplaceOrderApprovalRequest {
  return {
    requestId: "req-iso-1",
    tenant,
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

function evidenceInput(tenantId: string): MarketplaceEvidenceInput {
  return {
    tenantId,
    providerEventId: "prov-event-offer-1",
    kind: "marketplace.offer-snapshot",
    subjectRef: "order-100",
    source: { system: "manual-catalogue-import", reference: "catalogue-2026-10.ods", retrievedVia: "manual" },
    capturedAt: "2026-10-14T09:30:00.000Z",
    artifacts: [buildArtifact("art-iso", utf8Bytes(JSON.stringify({ offerId: "offer-1", tenantId })), "application/json", "offer snapshot")],
  };
}

describe("F361B tenant isolation — the marketplace approval surface", () => {
  it("REFUSAL: a foreign tenant's policy NEVER approves another tenant's order", () => {
    const approval = evaluateMarketplaceOrderApproval(policyOf(FOREIGN.tenantId), request(TENANT));
    expect(approval.decision).toBe("refuse");
    expect(approval.reasonCode).toBe("refuse.cross_tenant");
    expect(approval.guardianDecision.reasonCode).toBe("block.cross_tenant");
  });

  it("REFUSAL: a foreign-tenant approval NEVER authorizes the home tenant's action record", () => {
    const { record } = proposeMarketplaceOrderAction(request(TENANT), AT);
    const foreignApproval = evaluateMarketplaceOrderApproval(policyOf(FOREIGN.tenantId), request(FOREIGN));
    expect(foreignApproval.tenantId).toBe(FOREIGN.tenantId);
    expect(foreignApproval.decision).toBe("approve");
    const result = authorizeMarketplaceOrderAction(record, foreignApproval, { at: AT, tenantId: TENANT.tenantId });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("refused.tenant_mismatch");
    expect(record.state).toBe("proposed");
  });

  it("REFUSAL: a foreign caller NEVER authorizes the home tenant's action record", () => {
    const { record } = proposeMarketplaceOrderAction(request(TENANT), AT);
    const approval = evaluateMarketplaceOrderApproval(policyOf(TENANT.tenantId), request(TENANT));
    expect(approval.decision).toBe("approve");
    const result = authorizeMarketplaceOrderAction(record, approval, { at: AT, tenantId: FOREIGN.tenantId });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("refused.tenant_mismatch");
    expect(record.state).toBe("proposed");
  });

  it("the home tenant's own policy DOES approve (the isolation is not over-blocking)", () => {
    const approval = evaluateMarketplaceOrderApproval(policyOf(TENANT.tenantId), request(TENANT));
    expect(approval.decision).toBe("approve");
    expect(approval.reasonCode).toBe("approve.within_limits");
    expect(approval.tenantId).toBe(TENANT.tenantId);
  });
});

describe("F361B tenant isolation — the evidence-retention surface", () => {
  it("REFUSAL: foreign-tenant evidence reads fail closed (null/empty, indistinguishable from absence)", async () => {
    const store = new InMemoryMarketplaceEvidenceStore();
    const recorded = await store.recordEvidence(TENANT, evidenceInput(TENANT.tenantId), AT);
    if (!recorded.ok) throw new Error("record failed");
    expect(await store.readEvidence(FOREIGN, recorded.record.evidenceId)).toBeNull();
    expect(await store.findByProviderEvent(FOREIGN, "prov-event-offer-1")).toBeNull();
    expect(await store.listBySubject(FOREIGN, "order-100")).toEqual([]);
  });

  it("REFUSAL: a foreign-tenant evidence write is refused and the store is unchanged", async () => {
    const store = new InMemoryMarketplaceEvidenceStore();
    const outcome = await store.recordEvidence(FOREIGN, evidenceInput(TENANT.tenantId), AT);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("refused.tenant_mismatch");
    expect(store.size()).toBe(0);
  });

  it("provider-event dedup never crosses tenants (same event id, two tenants, two records)", async () => {
    const store = new InMemoryMarketplaceEvidenceStore();
    const mine = await store.recordEvidence(TENANT, evidenceInput(TENANT.tenantId), AT);
    const theirs = await store.recordEvidence(FOREIGN, evidenceInput(FOREIGN.tenantId), AT);
    expect(mine.ok && !mine.duplicate).toBe(true);
    expect(theirs.ok && !theirs.duplicate).toBe(true);
    if (mine.ok && theirs.ok) {
      expect(mine.record.evidenceId).not.toBe(theirs.record.evidenceId);
      expect(await store.findByProviderEvent(TENANT, "prov-event-offer-1")).not.toBeNull();
      expect(await store.findByProviderEvent(FOREIGN, "prov-event-offer-1")).not.toBeNull();
    }
  });
});

describe("F361B tenant isolation — the advisory law crosses nothing", () => {
  const ADVISORY: MarketplaceAdvisoryRecommendation = {
    source: "predictive.model/supplier-score",
    recommendation: "approve",
    rationale: "advisory suggests the cross-tenant order is routine",
  };

  it("an approve-flavored advisory NEVER rescues the cross-tenant refusal", () => {
    const check = assertAdvisoryNeverAuthorizes(policyOf(FOREIGN.tenantId), request(TENANT), ADVISORY);
    expect(check.holds).toBe(true);
    expect(check.withAdvisory.decision).toBe("refuse");
    expect(check.withAdvisory.reasonCode).toBe("refuse.cross_tenant");
  });

  it("an approve-flavored advisory NEVER rescues an over-limit refusal", () => {
    const check = assertAdvisoryNeverAuthorizes(policyOf(TENANT.tenantId), request(TENANT, 42_000), ADVISORY);
    expect(check.holds).toBe(true);
    expect(check.withAdvisory.decision).toBe("refuse");
    expect(check.withAdvisory.reasonCode).toBe("refuse.amount_over_limit");
  });
});
