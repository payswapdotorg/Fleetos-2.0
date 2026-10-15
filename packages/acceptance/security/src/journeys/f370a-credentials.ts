/**
 * F370A journey 1 — authenticated marketplace credentials (persona:
 * security-analyst).
 *
 * CENSUS CITATION (F370A, census-first with grep proof at base c6fec46):
 * zero matches for the journey id "authenticated-marketplace-credentials"
 * across packages/ (the only repo-wide hit: the f370a packet prose); zero
 * matches for `issueCredential` / `verifyCredential` / `scryptSync` /
 * `timingSafeEqual` anywhere in packages/ at the base tree; the op-family
 * prefix `cre-` appears in NO acceptance corpus (grep logs in
 * docs/evidence/F370A/report.md §2). The nearest neighboring claims are
 * the F361B `marketplace-order-approval-discipline` (the Guardian
 * approval CONTRACT) and `marketplace-evidence-dedup-discipline`
 * (provider-EVENT dedup) — neither exercises the CREDENTIAL boundary
 * (salted scrypt issuance + timing-safe verification + enumeration
 * resistance), which is THIS lane's angle.
 *
 * The analyst proves the F370A credential discipline over the REAL
 * public entry points (packages/identity):
 *   - issueCredential — the frozen record over the frozen scrypt
 *     parameters, deterministic, plaintext NEVER stored;
 *   - verifyCredential — timing-safe comparison with the SINGLE
 *     refusal code INVALID_CREDENTIAL;
 *   - ENUMERATION RESISTANCE machine-asserted: unknown-actor,
 *     malformed-record and wrong-secret refusals are byte-identical
 *     verdicts (all burn the same scrypt work over the labelled dummy
 *     salt — the timing shape matches too).
 *
 * Determinism: pure fixture data, no wall clock, no randomness; the
 * journey never reads the run anchor — anchor-invariant by construction
 * (the census row's citation). The scrypt work happens ONCE at module
 * scope; the steps record the frozen results.
 */

import type { AcceptanceJourney } from "../journey-contracts.ts";
import {
  CREDENTIAL_SCRYPT_PARAMETERS,
  issueCredential,
  verifyCredential,
} from "@fleetos/identity";
import type { CredentialRecord } from "@fleetos/identity";

const ACTOR = "act_operator-ama-01";
const TENANT = "acme-ops";
const SECRET = "correct horse battery staple f370a";
const SALT_A = "0f1e2d3c4b5a69788796a5b4c3d2e1f0";
const SALT_B = "f0e1d2c3b4a5968778695a4b3c2d1e0f";
const WRONG_SECRET = "wrong horse battery staple";

// Deterministic module-scope evaluation over the REAL public APIs.
const issued = issueCredential({
  credentialId: "cred-ama-journey-1",
  actorId: ACTOR,
  tenantId: TENANT,
  kind: "human",
  secret: SECRET,
  saltHex: SALT_A,
});
if (!issued.ok) throw new Error("journey fixture: credential issuance failed");
const reissued = issueCredential({
  credentialId: "cred-ama-journey-1",
  actorId: ACTOR,
  tenantId: TENANT,
  kind: "human",
  secret: SECRET,
  saltHex: SALT_A,
});
if (!reissued.ok) throw new Error("journey fixture: re-issuance failed");
const otherPrincipal = issueCredential({
  credentialId: "cred-ama-journey-2",
  actorId: "act_rival-ops-02",
  tenantId: "globex-rival",
  kind: "human",
  secret: "a-completely-different-secret",
  saltHex: SALT_B,
});
if (!otherPrincipal.ok) throw new Error("journey fixture: rival issuance failed");

const verifiedOk = verifyCredential({ presentedSecret: SECRET, record: issued.record });
const wrongSecret = verifyCredential({ presentedSecret: WRONG_SECRET, record: issued.record });
const unknownActor = verifyCredential({ presentedSecret: WRONG_SECRET, record: null });
const malformedRecord: CredentialRecord = { ...issued.record, digestHex: "deadbeef" };
const malformed = verifyCredential({ presentedSecret: SECRET, record: malformedRecord });
const emptyPresentation = verifyCredential({ presentedSecret: "", record: null });
const foreignRecord = verifyCredential({ presentedSecret: SECRET, record: otherPrincipal.record });

export const authenticatedMarketplaceCredentialsJourney: AcceptanceJourney = {
  journeyId: "security.authenticated-marketplace-credentials",
  persona: "security-analyst",
  capabilities: ["credential-verification"],
  goal: "Prove the real credential discipline: frozen scrypt issuance, timing-safe verification, and enumeration-resistant refusals over the identity boundary",
  steps: [
    {
      stepId: "cre-issue",
      kind: "intake",
      description: "issueCredential derives the frozen record: salted scrypt digest over the deterministic parameters, plaintext never stored",
      packages: ["@fleetos/identity"],
      operations: ["issueCredential"],
      run: (ctx) => {
        ctx.record("cre.issue.ok", issued.ok);
        ctx.record("cre.issue.credentialId", issued.record.credentialId);
        ctx.record("cre.issue.actorId", issued.record.actorId);
        ctx.record("cre.issue.tenantId", issued.record.tenantId);
        ctx.record("cre.issue.kind", issued.record.kind);
        ctx.record("cre.issue.digestHexLength", issued.record.digestHex.length);
        ctx.record("cre.issue.digestIsHex", /^[0-9a-f]{64}$/.test(issued.record.digestHex));
        ctx.record("cre.issue.saltHexLength", issued.record.saltHex.length);
        ctx.record("cre.issue.paramCostN", issued.record.params.costN);
        ctx.record("cre.issue.paramR", issued.record.params.blockSizeR);
        ctx.record("cre.issue.paramP", issued.record.params.parallelizationP);
        ctx.record("cre.issue.paramKeylen", issued.record.params.keylenBytes);
        ctx.record("cre.issue.deterministic", issued.record.digestHex === reissued.record.digestHex);
        ctx.record("cre.issue.plaintextNeverStored", !JSON.stringify(issued.record).includes(SECRET));
        ctx.record("cre.issue.frozenParams", issued.record.params.costN === CREDENTIAL_SCRYPT_PARAMETERS.costN
          && issued.record.params.blockSizeR === CREDENTIAL_SCRYPT_PARAMETERS.blockSizeR
          && issued.record.params.parallelizationP === CREDENTIAL_SCRYPT_PARAMETERS.parallelizationP
          && issued.record.params.keylenBytes === CREDENTIAL_SCRYPT_PARAMETERS.keylenBytes);
      },
    },
    {
      stepId: "cre-verify-ok",
      kind: "view-read",
      description: "verifyCredential accepts the correct secret and returns the actor/tenant binding, never the plaintext",
      packages: ["@fleetos/identity"],
      operations: ["verifyCredential"],
      run: (ctx) => {
        ctx.record("cre.verify.ok", verifiedOk.ok);
        ctx.record("cre.verify.actorId", verifiedOk.ok ? verifiedOk.actorId : "refused");
        ctx.record("cre.verify.tenantId", verifiedOk.ok ? verifiedOk.tenantId : "refused");
      },
    },
    {
      stepId: "cre-verify-refusals",
      kind: "negative-check",
      description: "REFUSALS: wrong secret, unknown actor, malformed record, empty presentation and a foreign record all refuse with the ONE code; the verdicts are byte-identical (enumeration resistance)",
      packages: ["@fleetos/identity"],
      operations: ["verifyCredential"],
      run: (ctx) => {
        ctx.record("cre.refusal.wrongSecret", wrongSecret.ok ? "accepted" : wrongSecret.reason);
        ctx.record("cre.refusal.unknownActor", unknownActor.ok ? "accepted" : unknownActor.reason);
        ctx.record("cre.refusal.malformedRecord", malformed.ok ? "accepted" : malformed.reason);
        ctx.record("cre.refusal.emptyPresentation", emptyPresentation.ok ? "accepted" : emptyPresentation.reason);
        ctx.record("cre.refusal.foreignRecord", foreignRecord.ok ? "accepted" : foreignRecord.reason);
        ctx.record("cre.refusal.unknownEqualsWrong", JSON.stringify(unknownActor) === JSON.stringify(wrongSecret));
        ctx.record("cre.refusal.malformedEqualsWrong", JSON.stringify(malformed) === JSON.stringify(wrongSecret));
        ctx.record("cre.refusal.singleReasonVocabulary",
          [wrongSecret, unknownActor, malformed, emptyPresentation, foreignRecord]
            .every((r) => !r.ok && r.reason === "INVALID_CREDENTIAL"));
      },
    },
  ],
  assertions: [
    { assertionId: "cre-1", description: "The credential issues over the frozen record", path: "cre.issue.ok", expected: true },
    { assertionId: "cre-2", description: "The record carries the credential id", path: "cre.issue.credentialId", expected: "cred-ama-journey-1" },
    { assertionId: "cre-3", description: "The record binds the actor", path: "cre.issue.actorId", expected: ACTOR },
    { assertionId: "cre-4", description: "The record binds the tenant", path: "cre.issue.tenantId", expected: TENANT },
    { assertionId: "cre-5", description: "The record carries the actor kind", path: "cre.issue.kind", expected: "human" },
    { assertionId: "cre-6", description: "The digest is 64 hex chars (sha-256-length scrypt output)", path: "cre.issue.digestHexLength", expected: 64 },
    { assertionId: "cre-7", description: "The digest is machine-hex", path: "cre.issue.digestIsHex", expected: true },
    { assertionId: "cre-8", description: "The salt is carried at the 16-byte floor", path: "cre.issue.saltHexLength", expected: 32 },
    { assertionId: "cre-9", description: "The scrypt cost parameter is frozen at N=16384 (the OWASP floor)", path: "cre.issue.paramCostN", expected: 16384 },
    { assertionId: "cre-10", description: "The scrypt block size is frozen at r=8", path: "cre.issue.paramR", expected: 8 },
    { assertionId: "cre-11", description: "The scrypt parallelization is frozen at p=1", path: "cre.issue.paramP", expected: 1 },
    { assertionId: "cre-12", description: "The scrypt key length is frozen at 32 bytes", path: "cre.issue.paramKeylen", expected: 32 },
    { assertionId: "cre-13", description: "Deterministic: re-issuance derives the identical digest", path: "cre.issue.deterministic", expected: true },
    { assertionId: "cre-14", description: "The plaintext secret NEVER appears in the stored record", path: "cre.issue.plaintextNeverStored", expected: true },
    { assertionId: "cre-15", description: "The record carries exactly the frozen parameter set", path: "cre.issue.frozenParams", expected: true },
    { assertionId: "cre-16", description: "The correct secret verifies", path: "cre.verify.ok", expected: true },
    { assertionId: "cre-17", description: "Verification returns the actor binding", path: "cre.verify.actorId", expected: ACTOR },
    { assertionId: "cre-18", description: "Verification returns the tenant binding", path: "cre.verify.tenantId", expected: TENANT },
    { assertionId: "cre-19", description: "REFUSAL: a wrong secret refuses INVALID_CREDENTIAL", path: "cre.refusal.wrongSecret", expected: "INVALID_CREDENTIAL" },
    { assertionId: "cre-20", description: "REFUSAL: an unknown actor refuses INVALID_CREDENTIAL (no enumeration)", path: "cre.refusal.unknownActor", expected: "INVALID_CREDENTIAL" },
    { assertionId: "cre-21", description: "REFUSAL: a malformed record refuses INVALID_CREDENTIAL", path: "cre.refusal.malformedRecord", expected: "INVALID_CREDENTIAL" },
    { assertionId: "cre-22", description: "REFUSAL: an empty presentation refuses INVALID_CREDENTIAL", path: "cre.refusal.emptyPresentation", expected: "INVALID_CREDENTIAL" },
    { assertionId: "cre-23", description: "REFUSAL: the right secret against a foreign record refuses (credential isolation)", path: "cre.refusal.foreignRecord", expected: "INVALID_CREDENTIAL" },
    { assertionId: "cre-24", description: "ENUMERATION RESISTANCE: the unknown-actor verdict is byte-identical to the wrong-secret verdict", path: "cre.refusal.unknownEqualsWrong", expected: true },
    { assertionId: "cre-25", description: "ENUMERATION RESISTANCE: the malformed-record verdict is byte-identical too", path: "cre.refusal.malformedEqualsWrong", expected: true },
    { assertionId: "cre-26", description: "The refusal vocabulary is exactly ONE machine-stable code", path: "cre.refusal.singleReasonVocabulary", expected: true },
  ],
};
