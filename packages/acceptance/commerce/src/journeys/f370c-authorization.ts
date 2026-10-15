/**
 * @fleetos/acceptance-commerce — the F370C authorization journey (Wave 18
 * lane C): every F370A gate refusal reason surfaced at the HTTP boundary
 * of the REAL deployment service, plus the F370B keyring/revocation
 * surfaces and the two-layer law.
 *
 * The boundary stack under test: verify credential (F370A) → issue signed
 * session (F370B keyring) → authenticate per request (the F370B keyring +
 * revocation stack) → authorize per action (the F370A gate, inside the
 * composed verbs) → delegate. The refusals, each asserted as data:
 *   UNAUTHENTICATED  — no token; a TAMPERED payload (string surgery); an
 *                      UNKNOWN key id (envelope surgery); a RETIRED-key
 *                      token (the stale holder after rotation, minted
 *                      through the REAL F370B keyring APIs in the
 *                      driver); a REVOKED jti — and the revocation
 *                      SURVIVES the crash-restart (the F370B persistence
 *                      seam closed at the server boundary);
 *   SESSION_EXPIRED  — a short-lived session presented past its window;
 *   TENANT_MISMATCH  — a foreign-tenant session naming the acme scope;
 *   SCOPE_MISSING    — a request-only session at the offer verb;
 *   MALFORMED        — a malformed action tenant scope;
 *   NOT_FOUND        — an id-addressed resource of the caller's absent
 *                      scope (fail-closed: indistinguishable from
 *                      absence);
 *   the two-layer law — the gate AUTHORIZES the approval verb and the
 *                      GUARDIAN still refuses the over-limit order (the
 *                      decision is evaluated data, never a transport
 *                      failure);
 *   the verify-grace window — the same retired key's token presented
 *                      BEFORE its retire-at still authorizes (the F370B
 *                      inclusive-grace law, live at the boundary).
 *
 * CENSUS CITATION: the journey id `marketplace-boundary-authorization` is
 * NEW at base b6747b3; the F370A/F370B surfaces are composed through the
 * service's HTTP boundary — the in-process batteries (F370A ama-*, F370B
 * kr-/rev-/sr-) are never re-claimed.
 */

import type { AcceptanceJourney } from "../journey-contracts.js";

const T0 = 1_774_000_000_000;
const DAY = 86_400_000;
const ALL_SCOPES = [
  "marketplace.request", "marketplace.offer", "marketplace.comparison", "marketplace.order",
  "marketplace.order.ack", "marketplace.receipt", "marketplace.enrollment", "marketplace.approval",
];

export const F370C_AUTHORIZATION_JOURNEYS: readonly AcceptanceJourney[] = [
  {
    id: "marketplace-boundary-authorization",
    persona: "operations-manager",
    capability: "marketplace-boundary-authorization",
    goal: "Surface every F370A gate refusal reason at the deployment service's HTTP boundary — unauthenticated (no token, tampered, unknown key, retired key, revoked), expired, cross-tenant, wrong-scope, malformed — plus the two-layer law (the gate authorizes, the Guardian still refuses) and the crash-persistent revocation.",
    steps: [
      { stepId: "s1", kind: "mps-boot", factKey: "boot" },
      { stepId: "s2", kind: "mps-provision", factKey: "acmeOperator", credentialId: "cred-mps-a-01", actorId: "act_operator-mps-01", tenantId: "acme", secret: "pilot-boundary-secret-01" },
      { stepId: "s3", kind: "mps-provision", factKey: "globexOperator", credentialId: "cred-mps-g-01", actorId: "act_operator-mps-g01", tenantId: "globex", secret: "pilot-boundary-secret-02" },
      { stepId: "s3b", kind: "mps-provision", factKey: "acmeAuditor", credentialId: "cred-mps-a-02", actorId: "act_auditor-mps-01", tenantId: "acme", secret: "pilot-boundary-secret-03" },
      { stepId: "s4", kind: "mps-login", factKey: "full", sessionKey: "full", credentialId: "cred-mps-a-01", secret: "pilot-boundary-secret-01", scopes: ALL_SCOPES, ttlMs: 90 * DAY, jti: "jti-mps-a-001", now: T0 + 100 },
      { stepId: "s4b", kind: "mps-login", factKey: "auditor", sessionKey: "auditor", credentialId: "cred-mps-a-02", secret: "pilot-boundary-secret-03", scopes: ALL_SCOPES, ttlMs: 90 * DAY, jti: "jti-mps-a-005", now: T0 + 150 },
      { stepId: "s5", kind: "mps-login", factKey: "requestOnly", sessionKey: "requestOnly", credentialId: "cred-mps-a-01", secret: "pilot-boundary-secret-01", scopes: ["marketplace.request"], ttlMs: 90 * DAY, jti: "jti-mps-a-002", now: T0 + 200 },
      { stepId: "s6", kind: "mps-login", factKey: "shortLived", sessionKey: "shortLived", credentialId: "cred-mps-a-01", secret: "pilot-boundary-secret-01", scopes: ALL_SCOPES, ttlMs: 1_000, jti: "jti-mps-a-003", now: T0 + 300 },
      { stepId: "s7", kind: "mps-login", factKey: "foreign", sessionKey: "foreign", credentialId: "cred-mps-g-01", secret: "pilot-boundary-secret-02", scopes: ALL_SCOPES, ttlMs: 90 * DAY, jti: "jti-mps-g-001", now: T0 + 400 },
      { stepId: "s8", kind: "mps-token-surgery", factKey: "tampered", sessionKey: "tampered", sourceSessionKey: "full", mode: "tamper-payload" },
      { stepId: "s9", kind: "mps-token-surgery", factKey: "unknownKey", sessionKey: "unknownKey", sourceSessionKey: "full", mode: "unknown-key-id" },
      { stepId: "s10", kind: "mps-mint-keyed-token", factKey: "staleHolder", sessionKey: "staleHolder", keyId: "mps-fix-k1", actorId: "act_operator-mps-01", tenantId: "acme", scopes: ["marketplace.request"], issuedAt: T0, expiresAt: T0 + 90 * DAY, jti: "jti-mps-stale-001" },
      { stepId: "s11", kind: "mps-request-submit", factKey: "noToken", sessionKey: null, tenantId: "acme", requestId: "req-mps-b-001", naturalKey: "acme:boundary:check:1", sku: "LT-5540", quantity: 1, requiredBy: "2026-12-31", at: T0 + 1_000, now: T0 + 1_000 },
      { stepId: "s12", kind: "mps-request-submit", factKey: "tampered", sessionKey: "tampered", tenantId: "acme", requestId: "req-mps-b-002", naturalKey: "acme:boundary:check:2", sku: "LT-5540", quantity: 1, requiredBy: "2026-12-31", at: T0 + 1_100, now: T0 + 1_100 },
      { stepId: "s13", kind: "mps-request-submit", factKey: "unknownKey", sessionKey: "unknownKey", tenantId: "acme", requestId: "req-mps-b-003", naturalKey: "acme:boundary:check:3", sku: "LT-5540", quantity: 1, requiredBy: "2026-12-31", at: T0 + 1_200, now: T0 + 1_200 },
      { stepId: "s14", kind: "mps-request-submit", factKey: "retiredKey", sessionKey: "staleHolder", tenantId: "acme", requestId: "req-mps-b-004", naturalKey: "acme:boundary:check:4", sku: "LT-5540", quantity: 1, requiredBy: "2026-12-31", at: T0 + 11 * DAY, now: T0 + 11 * DAY },
      { stepId: "s15", kind: "mps-request-submit", factKey: "graceWindow", sessionKey: "staleHolder", tenantId: "acme", requestId: "req-mps-b-005", naturalKey: "acme:boundary:check:5", sku: "LT-5540", quantity: 1, requiredBy: "2026-12-31", at: T0 + 5 * DAY, now: T0 + 5 * DAY },
      { stepId: "s16", kind: "mps-request-submit", factKey: "expired", sessionKey: "shortLived", tenantId: "acme", requestId: "req-mps-b-006", naturalKey: "acme:boundary:check:6", sku: "LT-5540", quantity: 1, requiredBy: "2026-12-31", at: T0 + 2_000, now: T0 + 2_000 },
      { stepId: "s17", kind: "mps-request-submit", factKey: "happyPath", sessionKey: "full", tenantId: "acme", requestId: "req-mps-b-007", naturalKey: "acme:boundary:check:7", sku: "LT-5540", quantity: 1, requiredBy: "2026-12-31", at: T0 + 2_100, now: T0 + 2_100 },
      { stepId: "s18", kind: "mps-offer-capture", factKey: "wrongScope", sessionKey: "requestOnly", tenantId: "acme", now: T0 + 2_200, offer: { offerId: "off-mps-b-001", supplierId: "sup-alpha", sku: "LT-5540", quantity: 1, unitCostMinor: 1_350_000, totalCostMinor: 1_350_000, currency: "GHS", taxMinor: 0, feesMinor: 0, deliveryEstimateDays: 3, condition: "new", warrantyMonths: 12, validFrom: T0 + 1_000, validUntil: T0 + 10 * DAY, sourceKind: "operator-entered", sourceReference: "boundary-check", capturedAt: T0 + 2_200 } },
      { stepId: "s19", kind: "mps-offer-capture", factKey: "foreignTenant", sessionKey: "foreign", tenantId: "acme", now: T0 + 2_300, offer: { offerId: "off-mps-b-002", supplierId: "sup-alpha", sku: "LT-5540", quantity: 1, unitCostMinor: 1_350_000, totalCostMinor: 1_350_000, currency: "GHS", taxMinor: 0, feesMinor: 0, deliveryEstimateDays: 3, condition: "new", warrantyMonths: 12, validFrom: T0 + 1_000, validUntil: T0 + 10 * DAY, sourceKind: "operator-entered", sourceReference: "boundary-check-foreign", capturedAt: T0 + 2_300 } },
      { stepId: "s20", kind: "mps-request-submit", factKey: "malformedTenant", sessionKey: "full", tenantId: "acme!!bad tenant", requestId: "req-mps-b-008", naturalKey: "acme:boundary:check:8", sku: "LT-5540", quantity: 1, requiredBy: "2026-12-31", at: T0 + 2_400, now: T0 + 2_400 },
      { stepId: "s21", kind: "mps-request-transition", factKey: "unknownRequest", sessionKey: "full", tenantId: "acme", requestId: "req-mps-DOES-NOT-EXIST", command: { type: "resolve", at: T0 + 2_500 }, now: T0 + 2_500 },
      { stepId: "s22", kind: "mps-approval", factKey: "overLimit", sessionKey: "full", tenantId: "acme", requestId: "appr-mps-b-001", orderId: "ord-mps-b-001", category: "laptops", transactionKind: "purchase", units: 5, amountTotal: 9_000_000, currency: "GHS", supplierId: "sup-alpha", verificationRef: "verify-mps-alpha-2026", offerSnapshotFromEvidence: false, actorAuthority: ["human.approval"], actorAutonomous: false, at: T0 + 3_000, now: T0 + 3_000 },
      { stepId: "s23", kind: "mps-approval", factKey: "inLimits", sessionKey: "full", tenantId: "acme", requestId: "appr-mps-b-002", orderId: "ord-mps-b-002", category: "laptops", transactionKind: "purchase", units: 5, amountTotal: 6_750_000, currency: "GHS", supplierId: "sup-alpha", verificationRef: "verify-mps-alpha-2026", offerSnapshotFromEvidence: false, actorAuthority: ["human.approval"], actorAutonomous: false, at: T0 + 3_100, now: T0 + 3_100 },
      { stepId: "s24", kind: "mps-revoke", factKey: "revokeFull", sessionKey: "full", mode: "jti", now: T0 + 4_000 },
      { stepId: "s25", kind: "mps-request-submit", factKey: "revoked", sessionKey: "full", tenantId: "acme", requestId: "req-mps-b-009", naturalKey: "acme:boundary:check:9", sku: "LT-5540", quantity: 1, requiredBy: "2026-12-31", at: T0 + 4_100, now: T0 + 4_100 },
      { stepId: "s26", kind: "mps-restart", factKey: "crash", mode: "kill", at: T0 + 5_000 },
      { stepId: "s27", kind: "mps-request-submit", factKey: "revokedAfterRestart", sessionKey: "full", tenantId: "acme", requestId: "req-mps-b-010", naturalKey: "acme:boundary:check:10", sku: "LT-5540", quantity: 1, requiredBy: "2026-12-31", at: T0 + 5_100, now: T0 + 5_100 },
      { stepId: "s28", kind: "mps-login", factKey: "secondSession", sessionKey: "secondSession", credentialId: "cred-mps-a-01", secret: "pilot-boundary-secret-01", scopes: ALL_SCOPES, ttlMs: 90 * DAY, jti: "jti-mps-a-004", now: T0 + 5_200 },
      { stepId: "s29", kind: "mps-revoke", factKey: "actorSweep", sessionKey: "secondSession", mode: "actor", now: T0 + 5_300 },
      { stepId: "s30", kind: "mps-request-submit", factKey: "swept", sessionKey: "secondSession", tenantId: "acme", requestId: "req-mps-b-011", naturalKey: "acme:boundary:check:11", sku: "LT-5540", quantity: 1, requiredBy: "2026-12-31", at: T0 + 5_400, now: T0 + 5_400 },
      { stepId: "s31", kind: "mps-state", factKey: "audit", sessionKey: "auditor", tenantId: "acme", family: "audit", now: T0 + 6_000 },
      { stepId: "s32", kind: "mps-shutdown", factKey: "shutdown" },
    ],
    assertions: [
      { id: "mps-a1", description: "the service booted", fact: "mps.boot.boot.ok", op: "eq", expected: true },
      { id: "mps-a2", description: "both tenants' credentials provisioned (the enumeration-resistant directory)", fact: "mps.provision.globexOperator.ok", op: "eq", expected: true },
      { id: "mps-a3", description: "the full-scope login issued under the current key", fact: "mps.login.full.ok", op: "eq", expected: true },
      { id: "mps-a4", description: "the request-only login carries exactly one scope", fact: "mps.login.requestOnly.scopeCount", op: "eq", expected: 1 },
      { id: "mps-a5", description: "UNAUTHENTICATED: no token presented (401)", fact: "mps.request.noToken.reason", op: "eq", expected: "UNAUTHENTICATED" },
      { id: "mps-a6", description: "the no-token refusal carried HTTP 401", fact: "mps.request.noToken.httpStatus", op: "eq", expected: 401 },
      { id: "mps-a7", description: "UNAUTHENTICATED: the tampered payload collapsed (never SIGNATURE_INVALID at the boundary)", fact: "mps.request.tampered.reason", op: "eq", expected: "UNAUTHENTICATED" },
      { id: "mps-a8", description: "UNAUTHENTICATED: the swapped key id (KEY_UNKNOWN collapsed)", fact: "mps.request.unknownKey.reason", op: "eq", expected: "UNAUTHENTICATED" },
      { id: "mps-a9", description: "UNAUTHENTICATED: the retired-key token past its retire-at (KEY_RETIRED collapsed)", fact: "mps.request.retiredKey.reason", op: "eq", expected: "UNAUTHENTICATED" },
      { id: "mps-a10", description: "the SAME retired-key token INSIDE its verify-grace window still authorizes (the F370B inclusive-grace law, live at the boundary)", fact: "mps.request.graceWindow.ok", op: "eq", expected: true },
      { id: "mps-a11", description: "SESSION_EXPIRED: the short-lived session past its window", fact: "mps.request.expired.reason", op: "eq", expected: "SESSION_EXPIRED" },
      { id: "mps-a12", description: "the happy path still submits (the boundary is not fail-everything)", fact: "mps.request.happyPath.ok", op: "eq", expected: true },
      { id: "mps-a13", description: "SCOPE_MISSING: the request-only session at the offer verb (403)", fact: "mps.offer.wrongScope.reason", op: "eq", expected: "SCOPE_MISSING" },
      { id: "mps-a14", description: "TENANT_MISMATCH: the foreign-tenant session naming the acme scope", fact: "mps.offer.foreignTenant.reason", op: "eq", expected: "TENANT_MISMATCH" },
      { id: "mps-a15", description: "MALFORMED: the malformed action tenant scope (400)", fact: "mps.request.malformedTenant.reason", op: "eq", expected: "MALFORMED" },
      { id: "mps-a16", description: "the malformed refusal carried HTTP 400", fact: "mps.request.malformedTenant.httpStatus", op: "eq", expected: 400 },
      { id: "mps-a17", description: "NOT_FOUND: an id-addressed resource absent from the caller's scope (fail-closed, indistinguishable from absence)", fact: "mps.requestT.unknownRequest.reason", op: "eq", expected: "NOT_FOUND" },
      { id: "mps-a18", description: "THE TWO-LAYER LAW: the gate AUTHORIZED the approval verb (ok operation)", fact: "mps.approval.overLimit.ok", op: "eq", expected: true },
      { id: "mps-a19", description: "THE TWO-LAYER LAW: the GUARDIAN still refused the over-limit order (evaluated data)", fact: "mps.approval.overLimit.decision", op: "eq", expected: "refuse" },
      { id: "mps-a20", description: "the over-limit refusal carried the limit reason code", fact: "mps.approval.overLimit.reasonCode", op: "eq", expected: "refuse.amount_over_limit" },
      { id: "mps-a21", description: "the in-limits approval decided approve (the positive control)", fact: "mps.approval.inLimits.decision", op: "eq", expected: "approve" },
      { id: "mps-a22", description: "the jti revocation succeeded", fact: "mps.revoke.revokeFull.ok", op: "eq", expected: true },
      { id: "mps-a23", description: "UNAUTHENTICATED: the revoked token refused (REVOKED collapsed)", fact: "mps.request.revoked.reason", op: "eq", expected: "UNAUTHENTICATED" },
      { id: "mps-a24", description: "the crash-restart replayed exactly one revocation (the F370B persistence seam closed)", fact: "mps.restart.crash.revocationsReplayed", op: "eq", expected: 1 },
      { id: "mps-a25", description: "the revoked token is STILL refused after the restart", fact: "mps.request.revokedAfterRestart.reason", op: "eq", expected: "UNAUTHENTICATED" },
      { id: "mps-a26", description: "the actor sweep revoked the second session's actor", fact: "mps.revoke.actorSweep.ok", op: "eq", expected: true },
      { id: "mps-a27", description: "UNAUTHENTICATED: the swept session refused", fact: "mps.request.swept.reason", op: "eq", expected: "UNAUTHENTICATED" },
      { id: "mps-a28", description: "the audit journal recorded the refusals (the boundary discipline as data)", fact: "mps.state.audit.count", op: "gte", expected: 15 },
      { id: "mps-a29", description: "the audit read itself required the ALL-EIGHT-scope operator view (the auditor session held it)", fact: "mps.state.audit.ok", op: "eq", expected: true },
      { id: "mps-a30", description: "the auditor (a different actor) was untouched by the operator sweep", fact: "mps.login.auditor.ok", op: "eq", expected: true },
    ],
  },
];
