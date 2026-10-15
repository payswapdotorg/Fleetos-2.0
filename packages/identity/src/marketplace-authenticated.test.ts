/**
 * F370A authenticated-composition tests — the REAL Wave-17 public APIs
 * driven behind the gate: gate refusals as data (never swallowing the
 * domain), and the domain kernels' own results returned VERBATIM.
 */

import { describe, expect, it } from "vitest";
import {
  AssetDirectory,
  InMemoryAssetRepository,
  ReceiptEnrollmentDirectory,
} from "@fleetos/assets";
import type { MarketplaceOrderApprovalRequest, Policy, PolicyRule } from "@fleetos/policy";
import { issueSignedSession, type SessionSigningKey } from "./session.js";
import {
  authenticatedAcknowledgeProviderOrder,
  authenticatedCaptureMarketplaceOffer,
  authenticatedCompareMarketplaceOffers,
  authenticatedCompleteEnrollment,
  authenticatedDraftEquipmentMarketplaceOrder,
  authenticatedEvaluateMarketplaceOrderApproval,
  authenticatedOpenEnrollment,
  authenticatedPlaceEquipmentMarketplaceOrder,
  authenticatedRecordReceipt,
  authenticatedSubmitEquipmentRequest,
  authenticatedVerifyReceipt,
} from "./marketplace-authenticated.js";
import type { AuthenticatedMarketplaceCall } from "./marketplace-authenticated.js";

const KEY: SessionSigningKey = { algorithm: "HMAC-SHA256", secretHex: "0011223344556677889900aabbccddeeff00112233445566778899aabbccddee" };
const ACTOR = "act_operator-ama-01";
const TENANT = "acme-ops";
const FOREIGN_TENANT = "globex-rival";
const T0 = 1_791_830_400_000;
const NOW = T0 + 1_000;

function callWith(token: string | null): AuthenticatedMarketplaceCall {
  return { token, key: KEY, now: NOW };
}

function session(overrides: Partial<Parameters<typeof issueSignedSession>[0]> = {}): string {
  const r = issueSignedSession({
    actorId: ACTOR,
    tenantId: TENANT,
    scopes: [
      "marketplace.request",
      "marketplace.offer",
      "marketplace.comparison",
      "marketplace.order",
      "marketplace.order.ack",
      "marketplace.receipt",
      "marketplace.enrollment",
      "marketplace.approval",
    ],
    issuedAt: T0,
    expiresAt: T0 + 3_600_000,
    key: KEY,
    ...overrides,
  });
  if (!r.ok) throw new Error("fixture issuance failed");
  return r.token;
}

const SESSION = session();
const TENANT_SCOPE = { tenantId: TENANT };

// ---------------------------------------------------------------------------
// F361C request / offer / comparison / order / ack
// ---------------------------------------------------------------------------

describe("F370A authenticated composition — F361C surfaces behind the gate", () => {
  it("AUTHORIZES + submits the equipment request through the REAL kernel", () => {
    const r = authenticatedSubmitEquipmentRequest(callWith(SESSION), TENANT_SCOPE, {
      requestId: "mreq-ama-1",
      naturalKey: "site-hq|laptops|q4",
      sku: "LT-5540",
      quantity: 5,
      requiredBy: "2026-11-01",
      at: NOW,
    }, []);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.authorization.actorId).toBe(ACTOR);
      expect(r.authorization.action).toBe("request");
      expect(r.result.ok).toBe(true);
      if (r.result.ok) {
        expect(r.result.request.status).toBe("submitted");
        expect(r.result.duplicate).toBe(false);
      }
    }
  });

  it("REFUSAL at the gate: an unauthenticated submit never reaches the kernel", () => {
    const r = authenticatedSubmitEquipmentRequest(callWith(null), TENANT_SCOPE, {
      requestId: "mreq-ama-x",
      naturalKey: "site-hq|laptops|q4-x",
      sku: "LT-5540",
      quantity: 5,
      requiredBy: "2026-11-01",
      at: NOW,
    }, []);
    expect(r).toMatchObject({ ok: false, refusedBy: "gate" });
    if (!r.ok && r.refusedBy === "gate") {
      expect(r.refusal.reason).toBe("UNAUTHENTICATED");
      expect(r.refusal.action).toBe("request");
    }
  });

  it("REFUSAL at the gate: an expired session refuses SESSION_EXPIRED at the offer verb", () => {
    const expired = session({ issuedAt: T0 - 10_000, expiresAt: T0 - 1_000 });
    const r = authenticatedCaptureMarketplaceOffer(callWith(expired), TENANT_SCOPE, {
      offerId: "moff-ama-1",
      supplierId: "sup-beta",
      sku: "LT-5540",
      quantity: 5,
      unitCostMinor: 9_500_00,
      totalCostMinor: 5 * 9_500_00,
      currency: "GHS",
      taxMinor: 1_000,
      feesMinor: 500,
      deliveryEstimateDays: 3,
      condition: "new",
      warrantyMonths: 12,
      validFrom: T0,
      validUntil: T0 + 86_400_000,
      source: { kind: "manual-catalogue-export", reference: "exp-2026-10-ama" },
      capturedAt: NOW,
    });
    expect(r).toMatchObject({ ok: false, refusedBy: "gate" });
    if (!r.ok && r.refusedBy === "gate") expect(r.refusal.reason).toBe("SESSION_EXPIRED");
  });

  it("REFUSAL at the gate: a foreign-tenant session refuses TENANT_MISMATCH on the home scope", () => {
    const foreign = session({ tenantId: FOREIGN_TENANT });
    const r = authenticatedCaptureMarketplaceOffer(callWith(foreign), TENANT_SCOPE, {
      offerId: "moff-ama-1",
      supplierId: "sup-beta",
      sku: "LT-5540",
      quantity: 5,
      unitCostMinor: 9_500_00,
      totalCostMinor: 5 * 9_500_00,
      currency: "GHS",
      taxMinor: 0,
      feesMinor: 0,
      deliveryEstimateDays: 3,
      condition: "new",
      warrantyMonths: 12,
      validFrom: T0,
      validUntil: T0 + 86_400_000,
      source: { kind: "manual-catalogue-export", reference: "exp-2026-10-ama" },
      capturedAt: NOW,
    });
    expect(r).toMatchObject({ ok: false, refusedBy: "gate" });
    if (!r.ok && r.refusedBy === "gate") expect(r.refusal.reason).toBe("TENANT_MISMATCH");
  });

  it("REFUSAL at the gate: a session without marketplace.order refuses SCOPE_MISSING", () => {
    const noOrderScope = session({ scopes: ["marketplace.request"] });
    const r = authenticatedDraftEquipmentMarketplaceOrder(callWith(noOrderScope), TENANT_SCOPE, {
      orderId: "mord-ama-1",
      requestId: "mreq-ama-1",
      offerId: "moff-ama-1",
      supplierId: "sup-beta",
      sku: "LT-5540",
      quantity: 5,
      unitCostMinor: 9_500_00,
      totalCostMinor: 5 * 9_500_00,
      currency: "GHS",
    });
    expect(r).toMatchObject({ ok: false, refusedBy: "gate" });
    if (!r.ok && r.refusedBy === "gate") expect(r.refusal.reason).toBe("SCOPE_MISSING");
  });

  it("AUTHORIZES the offer capture + comparison through the REAL kernels", () => {
    const offerInput = {
      offerId: "moff-ama-1",
      supplierId: "sup-beta",
      sku: "LT-5540",
      quantity: 5,
      unitCostMinor: 9_500_00,
      totalCostMinor: 5 * 9_500_00,
      currency: "GHS",
      taxMinor: 0,
      feesMinor: 0,
      deliveryEstimateDays: 3,
      condition: "new" as const,
      warrantyMonths: 12,
      validFrom: T0,
      validUntil: T0 + 86_400_000,
      source: { kind: "manual-catalogue-export" as const, reference: "exp-2026-10-ama" },
      capturedAt: NOW,
    };
    const captured = authenticatedCaptureMarketplaceOffer(callWith(SESSION), TENANT_SCOPE, offerInput);
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;
    expect(captured.result.ok).toBe(true);

    const comparison = authenticatedCompareMarketplaceOffers(
      callWith(SESSION),
      { tenant: TENANT_SCOPE, sku: "LT-5540", currency: "GHS", acceptableConditions: ["new"] },
      captured.result.ok ? [captured.result.offer] : [],
      [{ supplierId: "sup-beta", tenant: TENANT_SCOPE, status: "verified" as const, expiresAt: T0 + 86_400_000 }],
      { at: NOW },
    );
    expect(comparison.ok).toBe(true);
    if (comparison.ok && comparison.result.ok) {
      expect(comparison.result.eligibleCount).toBe(1);
      expect(comparison.result.ranked).toHaveLength(1);
    }
  });

  it("AUTHORIZES the order chain (draft -> place -> provider ack) through the REAL kernels", () => {
    const draft = authenticatedDraftEquipmentMarketplaceOrder(callWith(SESSION), TENANT_SCOPE, {
      orderId: "mord-ama-1",
      requestId: "mreq-ama-1",
      offerId: "moff-ama-1",
      supplierId: "sup-beta",
      sku: "LT-5540",
      quantity: 5,
      unitCostMinor: 9_500_00,
      totalCostMinor: 5 * 9_500_00,
      currency: "GHS",
    });
    expect(draft.ok).toBe(true);
    if (!draft.ok || !draft.result.ok) return;
    const placed = authenticatedPlaceEquipmentMarketplaceOrder(callWith(SESSION), draft.result.order, NOW + 100);
    expect(placed.ok).toBe(true);
    if (!placed.ok || !placed.result.ok) return;
    expect(placed.result.order.status).toBe("placed");
    const acked = authenticatedAcknowledgeProviderOrder(callWith(SESSION), placed.result.order, {
      providerEventId: "pev-sup-beta-1",
      evidence: { evidenceId: "mpe-ack-ama-1", tenantId: TENANT },
      channel: "manual-email-confirmation",
      acknowledgedAt: NOW + 200,
    });
    expect(acked.ok).toBe(true);
    if (acked.ok && acked.result.ok) expect(acked.result.order.status).toBe("acknowledged");
  });

  it("the DOMAIN refusal propagates VERBATIM (the gate never swallows the kernel's own law)", () => {
    const r = authenticatedDraftEquipmentMarketplaceOrder(callWith(SESSION), TENANT_SCOPE, {
      orderId: "mord-ama-bad",
      requestId: "mreq-ama-1",
      offerId: "moff-ama-1",
      supplierId: "sup-beta",
      sku: "LT-5540",
      quantity: 5,
      unitCostMinor: 9_500_00,
      totalCostMinor: 999, // quantity x unit mismatch — the kernel's exact money law
      currency: "GHS",
    });
    expect(r).toMatchObject({ ok: false, refusedBy: "domain" });
    if (!r.ok && r.refusedBy === "domain") {
      expect(r.domainRefusal).toMatchObject({ ok: false, reasonCode: "TOTAL_MISMATCH" });
    }
  });

  it("REFUSAL at the gate: an unauthenticated provider ack refuses UNAUTHENTICATED", () => {
    const draft = authenticatedDraftEquipmentMarketplaceOrder(callWith(SESSION), TENANT_SCOPE, {
      orderId: "mord-ama-2",
      requestId: "mreq-ama-1",
      offerId: "moff-ama-1",
      supplierId: "sup-beta",
      sku: "LT-5540",
      quantity: 5,
      unitCostMinor: 9_500_00,
      totalCostMinor: 5 * 9_500_00,
      currency: "GHS",
    });
    if (!draft.ok || !draft.result.ok) throw new Error("fixture");
    const placed = authenticatedPlaceEquipmentMarketplaceOrder(callWith(SESSION), draft.result.order, NOW + 100);
    if (!placed.ok || !placed.result.ok) throw new Error("fixture");
    const r = authenticatedAcknowledgeProviderOrder(callWith(null), placed.result.order, {
      providerEventId: "pev-sup-beta-2",
      evidence: { evidenceId: "mpe-ack-ama-2", tenantId: TENANT },
      channel: "manual-email-confirmation",
      acknowledgedAt: NOW + 200,
    });
    expect(r).toMatchObject({ ok: false, refusedBy: "gate" });
    if (!r.ok && r.refusedBy === "gate") {
      expect(r.refusal.reason).toBe("UNAUTHENTICATED");
      expect(r.refusal.action).toBe("ack");
    }
  });
});

// ---------------------------------------------------------------------------
// F361A receipt / enrollment
// ---------------------------------------------------------------------------

function directory(): ReceiptEnrollmentDirectory {
  return new ReceiptEnrollmentDirectory(new AssetDirectory(new InMemoryAssetRepository()));
}

const RECEIPT_INPUT = {
  tenantId: TENANT,
  evidenceRef: "rcpt-ama-1",
  siteId: "site-hq",
  supplierOrderRef: "mord-ama-1",
  serial: "SN-AMA-0001",
  assetTag: "TAG-AMA-0001",
  conditionOnArrival: "new" as const,
  warrantyRef: "wr-ama-1",
  capturedAt: T0,
  recordedAt: NOW,
};

describe("F370A authenticated composition — F361A surfaces behind the gate", () => {
  it("AUTHORIZES the receipt chain (record -> verify -> open -> complete) through the REAL directory", () => {
    const dir = directory();
    const recorded = authenticatedRecordReceipt(callWith(SESSION), dir, RECEIPT_INPUT);
    expect(recorded.ok).toBe(true);
    if (recorded.ok && recorded.result.ok) {
      expect(recorded.result.evidence.state).toBe("recorded");
      expect(recorded.result.duplicate).toBe(false);
    }
    const verified = authenticatedVerifyReceipt(callWith(SESSION), dir, {
      tenantId: TENANT,
      evidenceRef: "rcpt-ama-1",
      expectation: { supplierOrderRef: "mord-ama-1", expectedSerial: "SN-AMA-0001", expectedAssetTag: "TAG-AMA-0001", expectedCondition: "new" },
      decidedAt: NOW + 300,
    });
    expect(verified.ok).toBe(true);
    if (verified.ok && verified.result.ok) expect(verified.result.evidence.state).toBe("verified");
    const opened = authenticatedOpenEnrollment(callWith(SESSION), dir, {
      tenantId: TENANT,
      evidenceRef: "rcpt-ama-1",
      assetId: "ast_ama-0001",
      displayName: "LT-5540 laptop (authenticated)",
      kind: "other" as const,
      at: NOW + 400,
      actor: ACTOR,
    });
    expect(opened.ok).toBe(true);
    if (opened.ok && opened.result.ok) {
      expect(opened.result.enrollment.state).toBe("candidate");
    }
    const completed = authenticatedCompleteEnrollment(callWith(SESSION), dir, {
      tenantId: TENANT,
      serial: "SN-AMA-0001",
      at: NOW + 500,
      actor: ACTOR,
    });
    expect(completed.ok).toBe(true);
    if (completed.ok && completed.result.ok) {
      expect(completed.result.enrollment.state).toBe("enrolled");
    }
  });

  it("REFUSAL at the gate: an unauthenticated receipt record refuses UNAUTHENTICATED and records NOTHING", () => {
    const dir = directory();
    const r = authenticatedRecordReceipt(callWith(null), dir, RECEIPT_INPUT);
    expect(r).toMatchObject({ ok: false, refusedBy: "gate" });
    if (!r.ok && r.refusedBy === "gate") expect(r.refusal.reason).toBe("UNAUTHENTICATED");
    expect(dir.getReceipt(TENANT, "rcpt-ama-1")).toBeNull();
  });

  it("REFUSAL at the gate: a scope-missing session refuses enrollment (SCOPE_MISSING)", () => {
    const dir = directory();
    const recorded = authenticatedRecordReceipt(callWith(SESSION), dir, RECEIPT_INPUT);
    if (!recorded.ok) throw new Error("fixture");
    const verified = authenticatedVerifyReceipt(callWith(SESSION), dir, {
      tenantId: TENANT,
      evidenceRef: "rcpt-ama-1",
      expectation: { supplierOrderRef: "mord-ama-1", expectedSerial: "SN-AMA-0001", expectedAssetTag: "TAG-AMA-0001", expectedCondition: "new" },
      decidedAt: NOW + 300,
    });
    if (!verified.ok) throw new Error("fixture");
    const noEnrollScope = session({ scopes: ["marketplace.receipt"] });
    const r = authenticatedOpenEnrollment(callWith(noEnrollScope), dir, {
      tenantId: TENANT,
      evidenceRef: "rcpt-ama-1",
      assetId: "ast_ama-0002",
      displayName: "LT-5540 laptop (scope-missing attempt)",
      kind: "other",
      at: NOW + 400,
      actor: ACTOR,
    });
    expect(r).toMatchObject({ ok: false, refusedBy: "gate" });
    if (!r.ok && r.refusedBy === "gate") expect(r.refusal.reason).toBe("SCOPE_MISSING");
  });

  it("REFUSAL at the gate: a foreign-tenant session refuses the enrollment verb with TENANT_MISMATCH", () => {
    const dir = directory();
    const foreign = session({ tenantId: FOREIGN_TENANT, scopes: ["marketplace.enrollment"] });
    const r = authenticatedOpenEnrollment(callWith(foreign), dir, {
      tenantId: TENANT,
      evidenceRef: "rcpt-ama-1",
      assetId: "ast_ama-0003",
      displayName: "LT-5540 laptop (foreign attempt)",
      kind: "other",
      at: NOW + 400,
      actor: ACTOR,
    });
    expect(r).toMatchObject({ ok: false, refusedBy: "gate" });
    if (!r.ok && r.refusedBy === "gate") expect(r.refusal.reason).toBe("TENANT_MISMATCH");
  });
});

// ---------------------------------------------------------------------------
// F361B Guardian approval
// ---------------------------------------------------------------------------

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

const POLICY: Policy = {
  id: "pol-ama-1",
  version: "1.0.0",
  tenantId: TENANT,
  rules: [RULE],
  defaultVerdict: "BLOCK",
  failClosed: true,
};

function approvalRequest(tenantId: string): MarketplaceOrderApprovalRequest {
  return {
    requestId: "mreq-ama-appr-1",
    tenant: { tenantId },
    actor: { actorId: ACTOR, authority: ["tenant.operator", "human.approval"], isAutonomous: false },
    order: {
      orderId: "mord-ama-1",
      category: "laptops",
      transactionKind: "purchase",
      units: 5,
      amount: { total: 9_500, currency: "GHS" },
      supplierRef: { supplierId: "sup-beta", verificationRef: "mver-ama-beta" },
      offerSnapshotRef: "mpe-offer-ama-1",
    },
    limits: {
      amountCeiling: { purchase: 15_000, "repair-service": 5_000, rental: 0, lease: 0 },
      currency: "GHS",
      allowedCategories: ["laptops", "printers"],
      maxUnitsPerOrder: 10,
      requiredPolicyKinds: ["procurement", "budget"],
    },
    policyRefs: [
      { policyKind: "procurement", policyId: "pol-proc-1", version: "1.0.0" },
      { policyKind: "budget", policyId: "pol-budget-2", version: "2.1.0" },
    ],
  };
}

describe("F370A authenticated composition — the F361B Guardian approval behind the gate", () => {
  it("AUTHORIZES the approval evaluation through the REAL Guardian contract", () => {
    const r = authenticatedEvaluateMarketplaceOrderApproval(callWith(SESSION), POLICY, approvalRequest(TENANT));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.authorization.action).toBe("approval");
      expect(r.result.decision).toBe("approve");
      expect(r.result.reasonCode).toBe("approve.within_limits");
      expect(r.result.authorityTrace.source).toBe("guardian.evaluateCapability");
    }
  });

  it("REFUSAL at the gate: an unauthenticated approval evaluation refuses UNAUTHENTICATED", () => {
    const r = authenticatedEvaluateMarketplaceOrderApproval(callWith(null), POLICY, approvalRequest(TENANT));
    expect(r).toMatchObject({ ok: false, refusedBy: "gate" });
    if (!r.ok && r.refusedBy === "gate") {
      expect(r.refusal.reason).toBe("UNAUTHENTICATED");
      expect(r.refusal.action).toBe("approval");
    }
  });

  it("REFUSAL at the gate: an expired session refuses the approval verb with SESSION_EXPIRED", () => {
    const expired = session({ issuedAt: T0 - 10_000, expiresAt: T0 - 1_000 });
    const r = authenticatedEvaluateMarketplaceOrderApproval(callWith(expired), POLICY, approvalRequest(TENANT));
    expect(r).toMatchObject({ ok: false, refusedBy: "gate" });
    if (!r.ok && r.refusedBy === "gate") expect(r.refusal.reason).toBe("SESSION_EXPIRED");
  });
});
