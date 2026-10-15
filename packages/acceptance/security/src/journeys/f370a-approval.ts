/**
 * F370A journey 5 — the authenticated marketplace Guardian approval
 * composition (persona: compliance-auditor).
 *
 * CENSUS CITATION (F370A, census-first with grep proof at base c6fec46):
 * zero matches for the journey id "authenticated-marketplace-approval"
 * across packages/; zero matches for the composed surface
 * (`authenticatedEvaluateMarketplaceOrderApproval`) anywhere in
 * packages/ at the base tree; the op-family prefix `ama-` appears in NO
 * acceptance corpus as a step/op id. The nearest neighboring claim is
 * the F361B `marketplace-order-approval-discipline` journey — the SAME
 * Guardian approval contract, but driven UNAUTHENTICATED (the actor
 * convention). THIS journey drives it through the AUTHENTICATION
 * BOUNDARY — and machine-proves the two-layer law: the GATE authorizes
 * the caller, the GUARDIAN still decides the order (authorization is
 * never approval).
 *
 * The auditor drives the REAL F361B public API through the F370A
 * composition (packages/identity marketplace-authenticated.ts over the
 * EXISTING evaluateMarketplaceOrderApproval — zero new authority truth):
 *   - the authorized, in-limits order approves with the authority trace
 *     source guardian.evaluateCapability (the SOLE authority);
 *   - the two-layer law: an over-limit order is GATE-AUTHORIZED (the
 *     caller may ask) yet GUARDIAN-REFUSED (refuse.amount_over_limit —
 *     the decision is data, never an exception);
 *   - >=1 refusal at every remaining gate reason: UNAUTHENTICATED,
 *     SESSION_EXPIRED, SCOPE_MISSING, TENANT_MISMATCH.
 *
 * Determinism: pure fixture data, no wall clock; the journey never reads
 * the run anchor — anchor-invariant by construction.
 */

import type { AcceptanceJourney } from "../journey-contracts.ts";
import type { MarketplaceOrderApprovalRequest, Policy, PolicyRule } from "@fleetos/policy";
import {
  authenticatedEvaluateMarketplaceOrderApproval,
  issueSignedSession,
} from "@fleetos/identity";
import type { AuthenticatedMarketplaceCall, SessionSigningKey } from "@fleetos/identity";

const KEY: SessionSigningKey = {
  algorithm: "HMAC-SHA256",
  secretHex: "0011223344556677889900aabbccddeeff00112233445566778899aabbccddee",
};
const ACTOR = "act_operator-ama-01";
const TENANT = "acme-ops";
const FOREIGN_TENANT = "globex-rival";
const T0 = 1_791_830_400_000;
const NOW = T0 + 1_000;

function session(overrides: Partial<Parameters<typeof issueSignedSession>[0]> = {}): string {
  const r = issueSignedSession({
    actorId: ACTOR,
    tenantId: TENANT,
    scopes: ["marketplace.approval"],
    issuedAt: T0,
    expiresAt: T0 + 3_600_000,
    key: KEY,
    ...overrides,
  });
  if (!r.ok) throw new Error("journey fixture: session issuance failed");
  return r.token;
}

const CALL = (token: string | null): AuthenticatedMarketplaceCall => ({ token, key: KEY, now: NOW });
const SESSION = session();
const NO_APPROVAL_SCOPE = session({ scopes: ["marketplace.request"] });
const EXPIRED = session({ issuedAt: T0 - 10_000, expiresAt: T0 - 1_000 });

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
  id: "pol-ama-j5",
  version: "1.0.0",
  tenantId: TENANT,
  rules: [RULE],
  defaultVerdict: "BLOCK",
  failClosed: true,
};

function approvalRequest(total: number, tenantId: string): MarketplaceOrderApprovalRequest {
  return {
    requestId: "mreq-ama-j5",
    tenant: { tenantId },
    actor: { actorId: ACTOR, authority: ["tenant.operator", "human.approval"], isAutonomous: false },
    order: {
      orderId: "mord-ama-j5",
      category: "laptops",
      transactionKind: "purchase",
      units: 5,
      amount: { total, currency: "GHS" },
      supplierRef: { supplierId: "sup-beta", verificationRef: "mver-ama-beta" },
      offerSnapshotRef: "mpe-offer-ama-j5",
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

// Deterministic module-scope evaluation over the REAL composed API.
const approved = authenticatedEvaluateMarketplaceOrderApproval(CALL(SESSION), POLICY, approvalRequest(9_500, TENANT));
const overLimit = authenticatedEvaluateMarketplaceOrderApproval(CALL(SESSION), POLICY, approvalRequest(42_000, TENANT));
const unauthenticated = authenticatedEvaluateMarketplaceOrderApproval(CALL(null), POLICY, approvalRequest(9_500, TENANT));
const expiredApproval = authenticatedEvaluateMarketplaceOrderApproval(CALL(EXPIRED), POLICY, approvalRequest(9_500, TENANT));
const scopeMissing = authenticatedEvaluateMarketplaceOrderApproval(CALL(NO_APPROVAL_SCOPE), POLICY, approvalRequest(9_500, TENANT));
const tenantMismatch = authenticatedEvaluateMarketplaceOrderApproval(CALL(SESSION), POLICY, approvalRequest(9_500, FOREIGN_TENANT));

function gateReason(r: { readonly ok: boolean; readonly refusedBy?: string; readonly refusal?: { readonly reason: string } }): string {
  if (r.ok) return "authorized";
  return r.refusedBy === "gate" && r.refusal !== undefined ? r.refusal.reason : "domain";
}

export const authenticatedMarketplaceApprovalJourney: AcceptanceJourney = {
  journeyId: "security.authenticated-marketplace-approval",
  persona: "compliance-auditor",
  capabilities: ["authenticated-marketplace-access", "guardian-e2e-authorization"],
  goal: "Prove the authenticated Guardian-approval composition: the gate authorizes the caller, the Guardian still decides — authorization is never approval",
  steps: [
    {
      stepId: "ama-approval-authorized",
      kind: "guardian-decision",
      description: "An authorized, in-limits approval request approves through the REAL Guardian contract (the SOLE authority, unchanged)",
      packages: ["@fleetos/identity", "@fleetos/policy"],
      operations: ["issueSignedSession", "authorizeMarketplaceAction", "authenticatedEvaluateMarketplaceOrderApproval", "evaluateMarketplaceOrderApproval"],
      run: (ctx) => {
        ctx.record("ama.approval.ok", approved.ok);
        ctx.record("ama.approval.decision", approved.ok ? approved.result.decision : "refused");
        ctx.record("ama.approval.reasonCode", approved.ok ? approved.result.reasonCode : "refused");
        ctx.record("ama.approval.authoritySource", approved.ok ? approved.result.authorityTrace.source : "refused");
        ctx.record("ama.approval.limitChecks", approved.ok ? approved.result.limitFindings.length : -1);
        ctx.record("ama.approval.allLimitsPassed", approved.ok ? approved.result.limitFindings.every((f) => f.passed) : false);
        ctx.record("ama.approval.actor", approved.ok ? approved.authorization.actorId : "refused");
        ctx.record("ama.approval.action", approved.ok ? approved.authorization.action : "refused");
        ctx.record("ama.approval.scope", approved.ok ? approved.authorization.scope : "refused");
      },
    },
    {
      stepId: "ama-approval-two-layer-law",
      kind: "guardian-decision",
      description: "The TWO-LAYER law: the over-limit order is GATE-AUTHORIZED (the caller may ask) yet GUARDIAN-REFUSED (refuse.amount_over_limit — data, never an exception)",
      packages: ["@fleetos/identity", "@fleetos/policy"],
      operations: ["authorizeMarketplaceAction", "authenticatedEvaluateMarketplaceOrderApproval", "evaluateMarketplaceOrderApproval"],
      run: (ctx) => {
        ctx.record("ama.overLimit.gateAuthorized", overLimit.ok);
        ctx.record("ama.overLimit.decision", overLimit.ok ? overLimit.result.decision : "refused");
        ctx.record("ama.overLimit.reasonCode", overLimit.ok ? overLimit.result.reasonCode : "refused");
        ctx.record("ama.overLimit.authoritySource", overLimit.ok ? overLimit.result.authorityTrace.source : "refused");
        ctx.record("ama.overLimit.amountCheckPassed", overLimit.ok
          ? overLimit.result.limitFindings.find((f) => f.check === "check.amount_within_ceiling")?.passed === true
          : false);
        ctx.record("ama.overLimit.amountObserved", overLimit.ok
          ? overLimit.result.limitFindings.find((f) => f.check === "check.amount_within_ceiling")?.observed ?? "missing"
          : "refused");
      },
    },
    {
      stepId: "ama-approval-gate-refusals",
      kind: "negative-check",
      description: "REFUSALS at the approval gate: no token => UNAUTHENTICATED; expired => SESSION_EXPIRED; scope-missing => SCOPE_MISSING; a foreign-tenant request => TENANT_MISMATCH",
      packages: ["@fleetos/identity"],
      operations: ["authorizeMarketplaceAction", "authenticatedEvaluateMarketplaceOrderApproval"],
      run: (ctx) => {
        ctx.record("ama.approval.unauthenticated", gateReason(unauthenticated));
        ctx.record("ama.approval.expired", gateReason(expiredApproval));
        ctx.record("ama.approval.scopeMissing", gateReason(scopeMissing));
        ctx.record("ama.approval.tenantMismatch", gateReason(tenantMismatch));
      },
    },
  ],
  assertions: [
    { assertionId: "amp-1", description: "The authorized approval request succeeds through the gate", path: "ama.approval.ok", expected: true },
    { assertionId: "amp-2", description: "The in-limits order approves (the REAL contract, unchanged)", path: "ama.approval.decision", expected: "approve" },
    { assertionId: "amp-3", description: "The approval reason is approve.within_limits", path: "ama.approval.reasonCode", expected: "approve.within_limits" },
    { assertionId: "amp-4", description: "The ONLY authority source is still the existing Guardian", path: "ama.approval.authoritySource", expected: "guardian.evaluateCapability" },
    { assertionId: "amp-5", description: "All eight limit checks are evaluated (the F361B law, unchanged)", path: "ama.approval.limitChecks", expected: 8 },
    { assertionId: "amp-6", description: "Every limit check passes for the in-limits order", path: "ama.approval.allLimitsPassed", expected: true },
    { assertionId: "amp-7", description: "The gate authorization names the actor", path: "ama.approval.actor", expected: ACTOR },
    { assertionId: "amp-8", description: "The gate authorization names the approval verb", path: "ama.approval.action", expected: "approval" },
    { assertionId: "amp-9", description: "The gate authorization names the approval scope", path: "ama.approval.scope", expected: "marketplace.approval" },
    { assertionId: "amp-10", description: "TWO-LAYER LAW: the over-limit request is gate-AUTHORIZED (the caller may ask)", path: "ama.overLimit.gateAuthorized", expected: true },
    { assertionId: "amp-11", description: "TWO-LAYER LAW: the Guardian still REFUSES the over-limit order", path: "ama.overLimit.decision", expected: "refuse" },
    { assertionId: "amp-12", description: "The Guardian refusal reason is refuse.amount_over_limit (the F361B vocabulary, unchanged)", path: "ama.overLimit.reasonCode", expected: "refuse.amount_over_limit" },
    { assertionId: "amp-13", description: "The refusal still carries the Guardian authority trace (auditable)", path: "ama.overLimit.authoritySource", expected: "guardian.evaluateCapability" },
    { assertionId: "amp-14", description: "The amount ceiling check fails machine-visibly", path: "ama.overLimit.amountCheckPassed", expected: false },
    { assertionId: "amp-15", description: "The observed amount is machine-reported (42000 vs the 15000 ceiling)", path: "ama.overLimit.amountObserved", expected: "42000" },
    { assertionId: "amp-16", description: "REFUSAL: no token at the approval gate => UNAUTHENTICATED", path: "ama.approval.unauthenticated", expected: "UNAUTHENTICATED" },
    { assertionId: "amp-17", description: "REFUSAL: an expired session at the approval gate => SESSION_EXPIRED", path: "ama.approval.expired", expected: "SESSION_EXPIRED" },
    { assertionId: "amp-18", description: "REFUSAL: a session without marketplace.approval => SCOPE_MISSING", path: "ama.approval.scopeMissing", expected: "SCOPE_MISSING" },
    { assertionId: "amp-19", description: "REFUSAL: a foreign-tenant approval request => TENANT_MISMATCH", path: "ama.approval.tenantMismatch", expected: "TENANT_MISMATCH" },
  ],
};
