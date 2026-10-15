/**
 * F370A journey 3 — the authenticated marketplace request/offer/order
 * composition (persona: tenant-operator).
 *
 * CENSUS CITATION (F370A, census-first with grep proof at base c6fec46):
 * zero matches for the journey id "authenticated-marketplace-request-order"
 * across packages/; zero matches for the composition surface
 * (`authenticatedSubmitEquipmentRequest` / `authorizeMarketplaceAction` /
 * `AuthenticatedMarketplaceResult`) anywhere in packages/ at the base tree;
 * the op-family prefix `ama-` appears in NO acceptance corpus as a step/op
 * id (the only `ama` strings at base are commerce-corpus ACTOR fixture
 * names — a different namespace, recorded in the report). The nearest
 * neighboring claims: the F361B approval/evidence journeys (the approval
 * contract + provider-event dedup — the UNAUTHENTICATED surfaces) and the
 * commerce corpus's `marketplace-transaction-spine` (the unauthenticated
 * E2E chain). NEITHER drives the marketplace spine through the
 * AUTHENTICATION BOUNDARY — gate verdicts at every verb — THIS lane's
 * angle.
 *
 * The operator drives the REAL Wave-17 public APIs through the F370A
 * composition (packages/identity marketplace-authenticated.ts — the gate
 * authenticates + authorizes, then delegates to the EXISTING kernels
 * VERBATIM):
 *   - the happy chain: submitEquipmentRequest -> captureMarketplaceOffer
 *     -> compareMarketplaceOffers -> draftEquipmentMarketplaceOrder ->
 *     the place transition -> acknowledgeProviderOrder;
 *   - >=1 REFUSAL at EVERY gate reason: UNAUTHENTICATED (no token, twice:
 *     request + ack), SESSION_EXPIRED (offer), TENANT_MISMATCH (offer),
 *     SCOPE_MISSING (offer), MALFORMED (a malformed action tenant scope);
 *   - the DOMAIN refusal law: the kernel's own TOTAL_MISMATCH money law
 *     propagates VERBATIM (the gate never swallows domain refusals).
 *
 * Determinism: pure fixture data, no wall clock; the journey never reads
 * the run anchor — anchor-invariant by construction.
 */

import type { AcceptanceJourney } from "../journey-contracts.ts";
import {
  authenticatedAcknowledgeProviderOrder,
  authenticatedCaptureMarketplaceOffer,
  authenticatedCompareMarketplaceOffers,
  authenticatedDraftEquipmentMarketplaceOrder,
  authenticatedPlaceEquipmentMarketplaceOrder,
  authenticatedSubmitEquipmentRequest,
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
const TENANT_SCOPE = { tenantId: TENANT };

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
    ],
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
const REQUEST_ONLY = session({ scopes: ["marketplace.request"] });
const EXPIRED = session({ issuedAt: T0 - 10_000, expiresAt: T0 - 1_000 });
const FOREIGN = session({ actorId: "act_rival-ops-02", tenantId: FOREIGN_TENANT });

const REQUEST_INPUT = {
  requestId: "mreq-ama-j3",
  naturalKey: "site-hq|laptops|q4",
  sku: "LT-5540",
  quantity: 5,
  requiredBy: "2026-11-01",
  at: NOW,
};
const OFFER_INPUT = {
  offerId: "moff-ama-j3",
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
  source: { kind: "manual-catalogue-export" as const, reference: "exp-2026-10-ama-j3" },
  capturedAt: NOW,
};
const ORDER_INPUT = {
  orderId: "mord-ama-j3",
  requestId: "mreq-ama-j3",
  offerId: "moff-ama-j3",
  supplierId: "sup-beta",
  sku: "LT-5540",
  quantity: 5,
  unitCostMinor: 9_500_00,
  totalCostMinor: 5 * 9_500_00,
  currency: "GHS",
};
const ACK_INPUT = {
  providerEventId: "pev-sup-beta-j3",
  evidence: { evidenceId: "mpe-ack-ama-j3", tenantId: TENANT },
  channel: "manual-email-confirmation" as const,
  acknowledgedAt: NOW + 200,
};

// Deterministic module-scope evaluation over the REAL composed APIs.
const submitted = authenticatedSubmitEquipmentRequest(CALL(SESSION), TENANT_SCOPE, REQUEST_INPUT, []);
const existingRequests = submitted.ok && submitted.result.ok ? [submitted.result.request] : [];
const submittedAgain = authenticatedSubmitEquipmentRequest(CALL(SESSION), TENANT_SCOPE, REQUEST_INPUT, existingRequests);
const unauthenticatedSubmit = authenticatedSubmitEquipmentRequest(CALL(null), TENANT_SCOPE, { ...REQUEST_INPUT, requestId: "mreq-ama-j3-x" }, []);
const expiredSubmit = authenticatedSubmitEquipmentRequest(CALL(EXPIRED), TENANT_SCOPE, { ...REQUEST_INPUT, requestId: "mreq-ama-j3-e" }, []);
const malformedSubmit = authenticatedSubmitEquipmentRequest(CALL(SESSION), { tenantId: "bad tenant!" }, REQUEST_INPUT, []);

const captured = authenticatedCaptureMarketplaceOffer(CALL(SESSION), TENANT_SCOPE, OFFER_INPUT);
const scopeMissingCapture = authenticatedCaptureMarketplaceOffer(CALL(REQUEST_ONLY), TENANT_SCOPE, { ...OFFER_INPUT, offerId: "moff-ama-j3-s" });
const tenantMismatchCapture = authenticatedCaptureMarketplaceOffer(CALL(FOREIGN), TENANT_SCOPE, { ...OFFER_INPUT, offerId: "moff-ama-j3-t" });

const comparison = authenticatedCompareMarketplaceOffers(
  CALL(SESSION),
  { tenant: TENANT_SCOPE, sku: "LT-5540", currency: "GHS", acceptableConditions: ["new"] },
  captured.ok && captured.result.ok ? [captured.result.offer] : [],
  [{ supplierId: "sup-beta", tenant: TENANT_SCOPE, status: "verified" as const, expiresAt: T0 + 86_400_000 }],
  { at: NOW },
);

const drafted = authenticatedDraftEquipmentMarketplaceOrder(CALL(SESSION), TENANT_SCOPE, ORDER_INPUT);
const placed = drafted.ok && drafted.result.ok
  ? authenticatedPlaceEquipmentMarketplaceOrder(CALL(SESSION), drafted.result.order, NOW + 100)
  : null;
const acked = placed !== null && placed.ok && placed.result.ok
  ? authenticatedAcknowledgeProviderOrder(CALL(SESSION), placed.result.order, ACK_INPUT)
  : null;
const unauthenticatedAck = placed !== null && placed.ok && placed.result.ok
  ? authenticatedAcknowledgeProviderOrder(CALL(null), placed.result.order, { ...ACK_INPUT, providerEventId: "pev-sup-beta-j3-x" })
  : null;

const domainRefusal = authenticatedDraftEquipmentMarketplaceOrder(CALL(SESSION), TENANT_SCOPE, {
  ...ORDER_INPUT,
  orderId: "mord-ama-j3-bad",
  totalCostMinor: 999,
});

function gateReason(r: { readonly ok: boolean; readonly refusedBy?: string; readonly refusal?: { readonly reason: string } }): string {
  if (r.ok) return "authorized";
  return r.refusedBy === "gate" && r.refusal !== undefined ? r.refusal.reason : `domain:${JSON.stringify(r)}`;
}

export const authenticatedMarketplaceRequestOrderJourney: AcceptanceJourney = {
  journeyId: "security.authenticated-marketplace-request-order",
  persona: "tenant-operator",
  capabilities: ["authenticated-marketplace-access", "session-authorization"],
  goal: "Prove the authenticated marketplace composition: the request/offer/comparison/order/ack verbs gated end-to-end with a refusal at every gate reason",
  steps: [
    {
      stepId: "ama-request-happy",
      kind: "intake",
      description: "An authorized session submits the equipment request through the REAL kernel; a replay returns the ORIGINAL (idempotency law, unchanged)",
      packages: ["@fleetos/identity", "@fleetos/procurement"],
      operations: ["issueSignedSession", "authorizeMarketplaceAction", "authenticatedSubmitEquipmentRequest", "submitEquipmentRequest"],
      run: (ctx) => {
        ctx.record("ama.request.ok", submitted.ok);
        ctx.record("ama.request.status", submitted.ok && submitted.result.ok ? submitted.result.request.status : "refused");
        ctx.record("ama.request.duplicate", submitted.ok && submitted.result.ok ? submitted.result.duplicate : null);
        ctx.record("ama.request.actor", submitted.ok ? submitted.authorization.actorId : "refused");
        ctx.record("ama.request.action", submitted.ok ? submitted.authorization.action : "refused");
        ctx.record("ama.request.scope", submitted.ok ? submitted.authorization.scope : "refused");
        ctx.record("ama.request.replayDuplicate", submittedAgain.ok && submittedAgain.result.ok ? submittedAgain.result.duplicate : null);
        ctx.record("ama.request.replayStatus", submittedAgain.ok && submittedAgain.result.ok ? submittedAgain.result.request.status : "refused");
      },
    },
    {
      stepId: "ama-request-gate-refusals",
      kind: "negative-check",
      description: "REFUSALS at the request gate: no token => UNAUTHENTICATED; expired session => SESSION_EXPIRED; malformed tenant scope => MALFORMED",
      packages: ["@fleetos/identity"],
      operations: ["authorizeMarketplaceAction", "authenticatedSubmitEquipmentRequest"],
      run: (ctx) => {
        ctx.record("ama.request.unauthenticated", gateReason(unauthenticatedSubmit));
        ctx.record("ama.request.expired", gateReason(expiredSubmit));
        ctx.record("ama.request.malformedScope", gateReason(malformedSubmit));
      },
    },
    {
      stepId: "ama-offer-comparison-happy",
      kind: "evidence",
      description: "Authorized offer capture + the explainable comparison over the REAL kernels (the verified supplier passes the hard-constraint gate)",
      packages: ["@fleetos/identity", "@fleetos/procurement"],
      operations: ["authorizeMarketplaceAction", "authenticatedCaptureMarketplaceOffer", "captureMarketplaceOffer", "authenticatedCompareMarketplaceOffers", "compareMarketplaceOffers"],
      run: (ctx) => {
        ctx.record("ama.offer.ok", captured.ok);
        ctx.record("ama.offer.offerId", captured.ok && captured.result.ok ? captured.result.offer.offerId : "refused");
        ctx.record("ama.offer.freshnessVerdict", captured.ok && captured.result.ok ? "fresh" : "refused");
        ctx.record("ama.comparison.ok", comparison.ok);
        ctx.record("ama.comparison.eligible", comparison.ok && comparison.result.ok ? comparison.result.eligibleCount : -1);
        ctx.record("ama.comparison.rankedCount", comparison.ok && comparison.result.ok ? comparison.result.ranked.length : -1);
        ctx.record("ama.comparison.rationaleCount", comparison.ok && comparison.result.ok ? comparison.result.rationales.length : -1);
      },
    },
    {
      stepId: "ama-offer-gate-refusals",
      kind: "negative-check",
      description: "REFUSALS at the offer gate: a session without the offer scope => SCOPE_MISSING; a foreign-tenant session => TENANT_MISMATCH",
      packages: ["@fleetos/identity"],
      operations: ["authorizeMarketplaceAction", "authenticatedCaptureMarketplaceOffer"],
      run: (ctx) => {
        ctx.record("ama.offer.scopeMissing", gateReason(scopeMissingCapture));
        ctx.record("ama.offer.tenantMismatch", gateReason(tenantMismatchCapture));
      },
    },
    {
      stepId: "ama-order-ack-happy",
      kind: "plan",
      description: "The authorized order chain: draft -> place -> the manual provider-ack seam, all through the REAL kernels behind the gate",
      packages: ["@fleetos/identity", "@fleetos/procurement"],
      operations: ["authorizeMarketplaceAction", "authenticatedDraftEquipmentMarketplaceOrder", "draftEquipmentMarketplaceOrder", "authenticatedPlaceEquipmentMarketplaceOrder", "transitionEquipmentMarketplaceOrder", "authenticatedAcknowledgeProviderOrder", "acknowledgeProviderOrder"],
      run: (ctx) => {
        ctx.record("ama.order.draftOk", drafted.ok);
        ctx.record("ama.order.draftStatus", drafted.ok && drafted.result.ok ? drafted.result.order.status : "refused");
        ctx.record("ama.order.placedStatus", placed !== null && placed.ok && placed.result.ok ? placed.result.order.status : "refused");
        ctx.record("ama.ack.ok", acked !== null && acked.ok);
        ctx.record("ama.ack.status", acked !== null && acked.ok && acked.result.ok ? acked.result.order.status : "refused");
        ctx.record("ama.ack.actor", acked !== null && acked.ok ? acked.authorization.actorId : "refused");
        ctx.record("ama.ack.action", acked !== null && acked.ok ? acked.authorization.action : "refused");
        ctx.record("ama.ack.scope", acked !== null && acked.ok ? acked.authorization.scope : "refused");
      },
    },
    {
      stepId: "ama-order-domain-and-auth-refusals",
      kind: "negative-check",
      description: "REFUSALS: the kernel's own TOTAL_MISMATCH money law propagates VERBATIM (refusedBy domain, the gate never swallows it); an unauthenticated ack => UNAUTHENTICATED",
      packages: ["@fleetos/identity", "@fleetos/procurement"],
      operations: ["authenticatedDraftEquipmentMarketplaceOrder", "authorizeMarketplaceAction", "authenticatedAcknowledgeProviderOrder"],
      run: (ctx) => {
        ctx.record("ama.order.domainRefusedBy", domainRefusal.ok ? "authorized" : domainRefusal.refusedBy);
        ctx.record("ama.order.domainReasonCode", !domainRefusal.ok && domainRefusal.refusedBy === "domain" ? domainRefusal.domainRefusal.ok ? "ok" : domainRefusal.domainRefusal.reasonCode : "none");
        ctx.record("ama.ack.unauthenticated", unauthenticatedAck !== null ? gateReason(unauthenticatedAck) : "missing-fixture");
      },
    },
  ],
  assertions: [
    { assertionId: "ama-1", description: "The authorized request submits through the gate", path: "ama.request.ok", expected: true },
    { assertionId: "ama-2", description: "The request reaches the submitted state via the REAL kernel", path: "ama.request.status", expected: "submitted" },
    { assertionId: "ama-3", description: "The first submission is not a duplicate", path: "ama.request.duplicate", expected: false },
    { assertionId: "ama-4", description: "The gate authorizes the session's actor", path: "ama.request.actor", expected: ACTOR },
    { assertionId: "ama-5", description: "The gate names the request verb", path: "ama.request.action", expected: "request" },
    { assertionId: "ama-6", description: "The gate names the request scope", path: "ama.request.scope", expected: "marketplace.request" },
    { assertionId: "ama-7", description: "A replay returns the ORIGINAL (the idempotency law, unchanged behind the gate)", path: "ama.request.replayDuplicate", expected: true },
    { assertionId: "ama-8", description: "The replayed request keeps its submitted status", path: "ama.request.replayStatus", expected: "submitted" },
    { assertionId: "ama-9", description: "REFUSAL: no token => UNAUTHENTICATED at the request gate", path: "ama.request.unauthenticated", expected: "UNAUTHENTICATED" },
    { assertionId: "ama-10", description: "REFUSAL: an expired session => SESSION_EXPIRED at the request gate", path: "ama.request.expired", expected: "SESSION_EXPIRED" },
    { assertionId: "ama-11", description: "REFUSAL: a malformed action tenant scope => MALFORMED at the request gate", path: "ama.request.malformedScope", expected: "MALFORMED" },
    { assertionId: "ama-12", description: "The authorized offer captures through the gate", path: "ama.offer.ok", expected: true },
    { assertionId: "ama-13", description: "The captured offer keeps its id (verbatim kernel result)", path: "ama.offer.offerId", expected: "moff-ama-j3" },
    { assertionId: "ama-14", description: "The offer is inside its validity window at capture (freshness law)", path: "ama.offer.freshnessVerdict", expected: "fresh" },
    { assertionId: "ama-15", description: "The authorized comparison runs through the REAL comparison kernel", path: "ama.comparison.ok", expected: true },
    { assertionId: "ama-16", description: "The verified supplier's offer is eligible (the hard-constraint gate)", path: "ama.comparison.eligible", expected: 1 },
    { assertionId: "ama-17", description: "Exactly one ranked offer (the EXISTING compareQuotes ranking)", path: "ama.comparison.rankedCount", expected: 1 },
    { assertionId: "ama-18", description: "The comparison explains every offer (the rationale law)", path: "ama.comparison.rationaleCount", expected: 1 },
    { assertionId: "ama-19", description: "REFUSAL: a session without marketplace.offer => SCOPE_MISSING at the offer gate", path: "ama.offer.scopeMissing", expected: "SCOPE_MISSING" },
    { assertionId: "ama-20", description: "REFUSAL: a foreign-tenant session => TENANT_MISMATCH at the offer gate", path: "ama.offer.tenantMismatch", expected: "TENANT_MISMATCH" },
    { assertionId: "ama-21", description: "The authorized order drafts through the gate", path: "ama.order.draftOk", expected: true },
    { assertionId: "ama-22", description: "The drafted order starts in draft (the REAL §3.4 machine)", path: "ama.order.draftStatus", expected: "draft" },
    { assertionId: "ama-23", description: "The placed order reaches placed through the place transition", path: "ama.order.placedStatus", expected: "placed" },
    { assertionId: "ama-24", description: "The manual provider-ack seam acknowledges behind the gate", path: "ama.ack.ok", expected: true },
    { assertionId: "ama-25", description: "The acknowledged order reaches acknowledged", path: "ama.ack.status", expected: "acknowledged" },
    { assertionId: "ama-26", description: "The ack authorization names the actor", path: "ama.ack.actor", expected: ACTOR },
    { assertionId: "ama-27", description: "The ack authorization names the ack verb", path: "ama.ack.action", expected: "ack" },
    { assertionId: "ama-28", description: "The ack authorization names the ack scope", path: "ama.ack.scope", expected: "marketplace.order.ack" },
    { assertionId: "ama-29", description: "The kernel's own money-law refusal is a DOMAIN refusal (never swallowed by the gate)", path: "ama.order.domainRefusedBy", expected: "domain" },
    { assertionId: "ama-30", description: "The domain refusal carries the kernel's verbatim reason code TOTAL_MISMATCH", path: "ama.order.domainReasonCode", expected: "TOTAL_MISMATCH" },
    { assertionId: "ama-31", description: "REFUSAL: an unauthenticated provider ack => UNAUTHENTICATED", path: "ama.ack.unauthenticated", expected: "UNAUTHENTICATED" },
  ],
};
