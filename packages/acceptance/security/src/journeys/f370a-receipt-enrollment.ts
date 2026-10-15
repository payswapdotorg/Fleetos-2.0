/**
 * F370A journey 4 — the authenticated marketplace receipt/enrollment
 * composition (persona: remediation-engineer).
 *
 * CENSUS CITATION (F370A, census-first with grep proof at base c6fec46):
 * zero matches for the journey id "authenticated-marketplace-receipt-enrollment"
 * across packages/; zero matches for the composed surface
 * (`authenticatedRecordReceipt` / `authenticatedOpenEnrollment` /
 * `authenticatedCompleteEnrollment`) anywhere in packages/ at the base
 * tree; the op-family prefix `ama-` appears in NO acceptance corpus as a
 * step/op id. The nearest neighboring claims: the F361A field journeys
 * `marketplace-receipt-enrollment` / `marketplace-receipt-discrepancy`
 * (the UNAUTHENTICATED receipt state machines) and the commerce corpus's
 * `marketplace-transaction-spine` (the unauthenticated E2E chain).
 * NEITHER drives the receipt→enrollment chain through the AUTHENTICATION
 * BOUNDARY — THIS lane's angle.
 *
 * The engineer drives the REAL F361A public APIs through the F370A
 * composition (packages/identity marketplace-authenticated.ts over the
 * REAL ReceiptEnrollmentDirectory + AssetDirectory +
 * InMemoryAssetRepository — ONE registry, never a second asset truth):
 *   - the happy chain: recordReceipt -> verifyReceipt -> openEnrollment
 *     -> completeEnrollment (candidate -> enrolled);
 *   - >=1 REFUSAL at every gate position: an unauthenticated record
 *     (UNAUTHENTICATED — and the store records NOTHING: getReceipt is
 *     null), an expired verify (SESSION_EXPIRED), a scope-missing open
 *     (SCOPE_MISSING — a receipt-only session), a foreign-tenant open
 *     (TENANT_MISMATCH), an unauthenticated complete (UNAUTHENTICATED).
 *
 * Determinism: pure fixture data, no wall clock; the journey never reads
 * the run anchor — anchor-invariant by construction.
 */

import type { AcceptanceJourney } from "../journey-contracts.ts";
import { AssetDirectory, InMemoryAssetRepository, ReceiptEnrollmentDirectory } from "@fleetos/assets";
import {
  authenticatedCompleteEnrollment,
  authenticatedOpenEnrollment,
  authenticatedRecordReceipt,
  authenticatedVerifyReceipt,
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
    scopes: ["marketplace.receipt", "marketplace.enrollment"],
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
const RECEIPT_ONLY = session({ scopes: ["marketplace.receipt"] });
const EXPIRED = session({ issuedAt: T0 - 10_000, expiresAt: T0 - 1_000 });
const FOREIGN = session({ actorId: "act_rival-ops-02", tenantId: FOREIGN_TENANT, scopes: ["marketplace.enrollment"] });

const RECEIPT_INPUT = {
  tenantId: TENANT,
  evidenceRef: "rcpt-ama-j4",
  siteId: "site-hq",
  supplierOrderRef: "mord-ama-j3",
  serial: "SN-AMA-J4-0001",
  assetTag: "TAG-AMA-J4-0001",
  conditionOnArrival: "new" as const,
  warrantyRef: "wr-ama-j4",
  capturedAt: T0,
  recordedAt: NOW,
};
const EXPECTATION = {
  supplierOrderRef: "mord-ama-j3",
  expectedSerial: "SN-AMA-J4-0001",
  expectedAssetTag: "TAG-AMA-J4-0001",
  expectedCondition: "new" as const,
};

// Deterministic module-scope evaluation over the REAL composed APIs —
// ONE directory over ONE registry (the F361A wiring, verbatim).
const dir = new ReceiptEnrollmentDirectory(new AssetDirectory(new InMemoryAssetRepository()));

const recorded = authenticatedRecordReceipt(CALL(SESSION), dir, RECEIPT_INPUT);
const unauthenticatedRecord = authenticatedRecordReceipt(CALL(null), dir, { ...RECEIPT_INPUT, evidenceRef: "rcpt-ama-j4-x" });
const storeAfterUnauthenticated = dir.getReceipt(TENANT, "rcpt-ama-j4-x");

const verified = authenticatedVerifyReceipt(CALL(SESSION), dir, {
  tenantId: TENANT,
  evidenceRef: "rcpt-ama-j4",
  expectation: EXPECTATION,
  decidedAt: NOW + 300,
});
const expiredVerify = authenticatedVerifyReceipt(CALL(EXPIRED), dir, {
  tenantId: TENANT,
  evidenceRef: "rcpt-ama-j4",
  expectation: EXPECTATION,
  decidedAt: NOW + 300,
});

const opened = authenticatedOpenEnrollment(CALL(SESSION), dir, {
  tenantId: TENANT,
  evidenceRef: "rcpt-ama-j4",
  assetId: "ast_ama-j4-0001",
  displayName: "LT-5540 laptop (authenticated enrollment)",
  kind: "other" as const,
  at: NOW + 400,
  actor: ACTOR,
});
const scopeMissingOpen = authenticatedOpenEnrollment(CALL(RECEIPT_ONLY), dir, {
  tenantId: TENANT,
  evidenceRef: "rcpt-ama-j4",
  assetId: "ast_ama-j4-0002",
  displayName: "LT-5540 laptop (scope-missing attempt)",
  kind: "other" as const,
  at: NOW + 400,
  actor: ACTOR,
});
const foreignOpen = authenticatedOpenEnrollment(CALL(FOREIGN), dir, {
  tenantId: TENANT,
  evidenceRef: "rcpt-ama-j4",
  assetId: "ast_ama-j4-0003",
  displayName: "LT-5540 laptop (foreign attempt)",
  kind: "other" as const,
  at: NOW + 400,
  actor: ACTOR,
});

const completed = authenticatedCompleteEnrollment(CALL(SESSION), dir, {
  tenantId: TENANT,
  serial: "SN-AMA-J4-0001",
  at: NOW + 500,
  actor: ACTOR,
});
const unauthenticatedComplete = authenticatedCompleteEnrollment(CALL(null), dir, {
  tenantId: TENANT,
  serial: "SN-AMA-J4-0001",
  at: NOW + 600,
  actor: ACTOR,
});

function gateReason(r: { readonly ok: boolean; readonly refusedBy?: string; readonly refusal?: { readonly reason: string } }): string {
  if (r.ok) return "authorized";
  return r.refusedBy === "gate" && r.refusal !== undefined ? r.refusal.reason : "domain";
}

export const authenticatedMarketplaceReceiptEnrollmentJourney: AcceptanceJourney = {
  journeyId: "security.authenticated-marketplace-receipt-enrollment",
  persona: "remediation-engineer",
  capabilities: ["authenticated-marketplace-access"],
  goal: "Prove the authenticated receipt-to-enrollment composition: the F361A chain gated end-to-end with refusals at every gate position",
  steps: [
    {
      stepId: "ama-receipt-chain",
      kind: "intake",
      description: "The authorized chain: recordReceipt -> verifyReceipt -> openEnrollment -> completeEnrollment over the REAL directory + registry",
      packages: ["@fleetos/identity", "@fleetos/assets"],
      operations: ["issueSignedSession", "authorizeMarketplaceAction", "authenticatedRecordReceipt", "recordReceipt", "authenticatedVerifyReceipt", "verifyReceipt", "authenticatedOpenEnrollment", "openEnrollment", "authenticatedCompleteEnrollment", "completeEnrollment"],
      run: (ctx) => {
        ctx.record("ama.receipt.recordOk", recorded.ok);
        ctx.record("ama.receipt.recordState", recorded.ok && recorded.result.ok ? recorded.result.evidence.state : "refused");
        ctx.record("ama.receipt.recordActor", recorded.ok ? recorded.authorization.actorId : "refused");
        ctx.record("ama.receipt.verifyState", verified.ok && verified.result.ok ? verified.result.evidence.state : "refused");
        ctx.record("ama.receipt.verifyAction", verified.ok ? verified.authorization.action : "refused");
        ctx.record("ama.receipt.verifyScope", verified.ok ? verified.authorization.scope : "refused");
        ctx.record("ama.enroll.openState", opened.ok && opened.result.ok ? opened.result.enrollment.state : "refused");
        ctx.record("ama.enroll.openDuplicate", opened.ok && opened.result.ok ? opened.result.duplicate : null);
        ctx.record("ama.enroll.enrollmentId", opened.ok && opened.result.ok ? opened.result.enrollment.enrollmentId : "refused");
        ctx.record("ama.enroll.completeState", completed.ok && completed.result.ok ? completed.result.enrollment.state : "refused");
        ctx.record("ama.enroll.completeAction", completed.ok ? completed.authorization.action : "refused");
        ctx.record("ama.enroll.completeScope", completed.ok ? completed.authorization.scope : "refused");
      },
    },
    {
      stepId: "ama-receipt-gate-refusals",
      kind: "negative-check",
      description: "REFUSALS at the receipt gate: an unauthenticated record refuses UNAUTHENTICATED and the store records NOTHING; an expired verify refuses SESSION_EXPIRED",
      packages: ["@fleetos/identity", "@fleetos/assets"],
      operations: ["authorizeMarketplaceAction", "authenticatedRecordReceipt", "authenticatedVerifyReceipt"],
      run: (ctx) => {
        ctx.record("ama.receipt.unauthenticatedRecord", gateReason(unauthenticatedRecord));
        ctx.record("ama.receipt.storeUntouched", storeAfterUnauthenticated === null);
        ctx.record("ama.receipt.expiredVerify", gateReason(expiredVerify));
      },
    },
    {
      stepId: "ama-enrollment-gate-refusals",
      kind: "negative-check",
      description: "REFUSALS at the enrollment gate: a receipt-only session => SCOPE_MISSING; a foreign-tenant session => TENANT_MISMATCH; an unauthenticated complete => UNAUTHENTICATED",
      packages: ["@fleetos/identity", "@fleetos/assets"],
      operations: ["authorizeMarketplaceAction", "authenticatedOpenEnrollment", "authenticatedCompleteEnrollment"],
      run: (ctx) => {
        ctx.record("ama.enroll.scopeMissing", gateReason(scopeMissingOpen));
        ctx.record("ama.enroll.tenantMismatch", gateReason(foreignOpen));
        ctx.record("ama.enroll.unauthenticatedComplete", gateReason(unauthenticatedComplete));
        ctx.record("ama.enroll.completedBeforeRefusals", completed.ok && completed.result.ok ? completed.result.enrollment.state : "refused");
      },
    },
  ],
  assertions: [
    { assertionId: "amr-1", description: "The authorized receipt records through the gate", path: "ama.receipt.recordOk", expected: true },
    { assertionId: "amr-2", description: "The receipt starts in the recorded state (the REAL state machine)", path: "ama.receipt.recordState", expected: "recorded" },
    { assertionId: "amr-3", description: "The record authorization names the actor", path: "ama.receipt.recordActor", expected: ACTOR },
    { assertionId: "amr-4", description: "The receipt verifies to verified against the expectation", path: "ama.receipt.verifyState", expected: "verified" },
    { assertionId: "amr-5", description: "The verify authorization names the receipt verb", path: "ama.receipt.verifyAction", expected: "receipt" },
    { assertionId: "amr-6", description: "The verify authorization names the receipt scope", path: "ama.receipt.verifyScope", expected: "marketplace.receipt" },
    { assertionId: "amr-7", description: "The enrollment opens in candidate over the REAL registry", path: "ama.enroll.openState", expected: "candidate" },
    { assertionId: "amr-8", description: "The first open is not a duplicate", path: "ama.enroll.openDuplicate", expected: false },
    { assertionId: "amr-9", description: "The enrollment id is the tenant+serial idempotency key (the F361A law)", path: "ama.enroll.enrollmentId", expected: "enr_acme-ops_SN-AMA-J4-0001" },
    { assertionId: "amr-10", description: "The enrollment completes to enrolled", path: "ama.enroll.completeState", expected: "enrolled" },
    { assertionId: "amr-11", description: "The complete authorization names the enrollment verb", path: "ama.enroll.completeAction", expected: "enrollment" },
    { assertionId: "amr-12", description: "The complete authorization names the enrollment scope", path: "ama.enroll.completeScope", expected: "marketplace.enrollment" },
    { assertionId: "amr-13", description: "REFUSAL: an unauthenticated record => UNAUTHENTICATED", path: "ama.receipt.unauthenticatedRecord", expected: "UNAUTHENTICATED" },
    { assertionId: "amr-14", description: "The refused record left the store EMPTY (nothing recorded unauthenticated)", path: "ama.receipt.storeUntouched", expected: true },
    { assertionId: "amr-15", description: "REFUSAL: an expired session at verify => SESSION_EXPIRED", path: "ama.receipt.expiredVerify", expected: "SESSION_EXPIRED" },
    { assertionId: "amr-16", description: "REFUSAL: a receipt-only session at enrollment => SCOPE_MISSING", path: "ama.enroll.scopeMissing", expected: "SCOPE_MISSING" },
    { assertionId: "amr-17", description: "REFUSAL: a foreign-tenant session at enrollment => TENANT_MISMATCH", path: "ama.enroll.tenantMismatch", expected: "TENANT_MISMATCH" },
    { assertionId: "amr-18", description: "REFUSAL: an unauthenticated complete => UNAUTHENTICATED", path: "ama.enroll.unauthenticatedComplete", expected: "UNAUTHENTICATED" },
    { assertionId: "amr-19", description: "The chain's enrolled state survives the refusal attempts (the refusals changed nothing)", path: "ama.enroll.completedBeforeRefusals", expected: "enrolled" },
  ],
};
