/**
 * F373 journey 1 — the KMS rotation lifecycle across the process boundary
 * (persona: site-reliability-engineer).
 *
 * CENSUS CITATION (F373, census-first at base 76ddba0): zero matches for
 * the journey id "kms-rotation" and the op prefix family `kmr-` anywhere
 * in packages/ at the base tree; zero matches for `loadKmsKeyringProvider`
 * / `KmsKeyringInput` / `FLEETOS_KMS` / the `kms` provider source label.
 * The nearest neighboring claim is the F370B `security.keyring-rotation`
 * family — the IN-PROCESS pure rotation over a fixture snapshot; THIS
 * journey drives the SAME F370B laws across a REAL separate-process KMS
 * (material served over the authenticated API, rotation through that
 * API, the refusal ladder over the process boundary) — the recorded
 * standing qualification "the keyring file/env providers are
 * configuration-class (real KMS the recorded follow-up)" closed here.
 *
 * The operator proves the KMS rotation discipline end to end against the
 * REAL service spawned as a REAL child process (the kms-harness law): the
 * journaled admin bootstrap, the login, the first-key create draw through
 * the injected fixed stream, the adapter snapshot load over the
 * authenticated API, `issueKeyedSession` under the CURRENT key, the
 * rotation through the API (the REAL F370B kernel inside the service),
 * the verify-grace window to KEY_RETIRED, and the refusal ladder — every
 * reading a logical constant (no ports/paths/material in any fact).
 */

import type { AcceptanceJourney } from "../journey-contracts.ts";
import { loadKmsKeyringProvider } from "@fleetos/identity";
import { issueKeyedSession, verifyKeyedSession } from "@fleetos/identity";
import {
  KMS_F373_ADMIN_SECRET,
  KMS_F373_CREATE_KID,
  KMS_F373_CREATE_MAT,
  KMS_F373_MASTER_KEY,
  KMS_F373_ROTATE_KID,
  KMS_F373_ROTATE_MAT,
  KMS_F373_ADMIN_TK,
  listOf,
  numOf,
  refusalReasonOf,
  okOf,
  spawnKmsHarness,
  strOf,
  swapKeyedTokenKeyId,
  tamperToken,
} from "./kms-harness.ts";

const BASE_MS = 1_791_830_400_000;
const T0 = BASE_MS;
const LOGIN_AT = BASE_MS + 10_000;
const CREATE_AT = BASE_MS + 20_000;
const ROTATE_AT = BASE_MS + 60_000;
const GRACE_MS = 600_000;
const RETIRE_AT = ROTATE_AT + GRACE_MS;
const ADMIN_ID = "f373-kr-admin";
const LOGIN_JTI = "jti-f373-kr-login";

// --- the REAL drive, at module evaluation (the F341B TLA law; the
// constants below are the journey's frozen facts — flat module scope so
// the sync steps can record them; the OS reaps the temp dir on teardown
// if the drive fails loud, the F370C harness convention) ---------------

const harness = await spawnKmsHarness([
  KMS_F373_ADMIN_TK,
  KMS_F373_CREATE_KID,
  KMS_F373_CREATE_MAT,
  KMS_F373_ROTATE_KID,
  KMS_F373_ROTATE_MAT,
]);
const provision = await harness.call({ method: "POST", path: "/api/admin/credentials", body: { adminId: ADMIN_ID, secret: KMS_F373_ADMIN_SECRET, now: T0 }, label: "admin-provision" });
const token = await harness.login({ adminId: ADMIN_ID, secret: KMS_F373_ADMIN_SECRET, now: LOGIN_AT, ttlMs: 3_600_000, jti: LOGIN_JTI });
const create = await harness.call({ method: "POST", path: "/api/keys/create", body: { now: CREATE_AT }, token, label: "key-create" });
const current1 = await harness.call({ method: "GET", path: `/api/keys/current?now=${CREATE_AT}`, token, label: "current" });
const list1 = await harness.call({ method: "GET", path: `/api/keys?now=${CREATE_AT}`, token, label: "list" });
const servedK1 = await harness.call({ method: "POST", path: "/api/keys/resolve", body: { keyId: KMS_F373_CREATE_KID, now: CREATE_AT }, token, label: "resolve-material" });

// The adapter snapshot over the authenticated API (the real transport).
const adapter1 = await loadKmsKeyringProvider({ baseUrl: harness.baseUrl(), token, now: CREATE_AT });
const provider1 = adapter1.ok ? adapter1.provider : null;
const t1 = provider1 === null
  ? null
  : issueKeyedSession({
      provider: provider1,
      actorId: "act_f373_kms_01",
      tenantId: "acme-ops",
      scopes: ["marketplace.request", "marketplace.order"],
      issuedAt: CREATE_AT,
      expiresAt: CREATE_AT + 3_600_000,
      jti: "jti-f373-kr-t1",
    });
const adapterMaterial = provider1?.resolveKeyMaterial(KMS_F373_CREATE_KID) ?? null;
const adapterMaterialMatchesService = adapterMaterial !== null &&
  typeof servedK1.json["secretHex"] === "string" &&
  adapterMaterial.secretHex === servedK1.json["secretHex"];
const adapterMaterialMatchesStream = adapterMaterial !== null && adapterMaterial.secretHex === KMS_F373_CREATE_MAT;

const rotate = await harness.call({ method: "POST", path: "/api/keys/rotate", body: { now: ROTATE_AT, verifyGraceMs: GRACE_MS }, token, label: "key-rotate" });
const list2 = await harness.call({ method: "GET", path: `/api/keys?now=${ROTATE_AT}`, token, label: "list" });

// The honest adapter RELOAD after rotation (a snapshot is a snapshot).
const adapter2 = await loadKmsKeyringProvider({ baseUrl: harness.baseUrl(), token, now: ROTATE_AT });
const provider2 = adapter2.ok ? adapter2.provider : null;
const k1PostRotate = provider2?.resolveKeyMaterial(KMS_F373_CREATE_KID) ?? null;

const t2 = provider2 === null
  ? null
  : issueKeyedSession({
      provider: provider2,
      actorId: "act_f373_kms_01",
      tenantId: "acme-ops",
      scopes: ["marketplace.request"],
      issuedAt: ROTATE_AT,
      expiresAt: ROTATE_AT + 3_600_000,
      jti: "jti-f373-kr-t2",
    });

// The F370B ladder, now across the process boundary.
const grace = t1?.ok !== true || provider2 === null ? null : verifyKeyedSession(t1.token, { provider: provider2, now: RETIRE_AT - 1 });
const boundary = t1?.ok !== true || provider2 === null ? null : verifyKeyedSession(t1.token, { provider: provider2, now: RETIRE_AT });
const retired = t1?.ok !== true || provider2 === null ? null : verifyKeyedSession(t1.token, { provider: provider2, now: RETIRE_AT + 1 });
const t2Verify = t2?.ok !== true || provider2 === null ? null : verifyKeyedSession(t2.token, { provider: provider2, now: RETIRE_AT + 1 });

// The refusals: at the API boundary and through the keyed-token surgery.
const ghostResolve = await harness.call({ method: "POST", path: "/api/keys/resolve", body: { keyId: "ghost-k9", now: ROTATE_AT }, token, label: "resolve-ghost" });
const swapped = t1?.ok !== true || provider2 === null ? null : verifyKeyedSession(swapKeyedTokenKeyId(t1.token, KMS_F373_ROTATE_KID), { provider: provider2, now: ROTATE_AT });
const tampered = t1?.ok !== true || provider2 === null ? null : verifyKeyedSession(tamperToken(t1.token), { provider: provider2, now: ROTATE_AT });
const malformedReasons = t1 === null
  ? []
  : ["", "not-a-token", "fss1.aa.bb", "fsk1", "fsk1..aa.bb", "fsk2.aa.bb", "fsk1.bad kid.aa.bb"].map((candidate) => {
      const r = verifyKeyedSession(candidate, { provider: provider2!, now: ROTATE_AT });
      return r.ok ? "accepted" : r.reason;
    });
const nullToken = provider2 === null ? null : verifyKeyedSession(null, { provider: provider2, now: ROTATE_AT });

const audit = await harness.call({ method: "GET", path: `/api/audit?now=${ROTATE_AT}`, token, label: "audit" });
const auditEntries = (audit.json["entries"] ?? []) as { opSeq: number; op: string; actor: string; detail: string }[];

// The no-leak scan over every verdict this journey produced.
const secrets = [KMS_F373_MASTER_KEY, KMS_F373_ADMIN_SECRET, KMS_F373_ADMIN_TK, KMS_F373_CREATE_MAT, KMS_F373_ROTATE_MAT];
const verdictsClean = secrets.every((s) => !JSON.stringify([grace, boundary, retired, t2Verify, swapped, tampered, nullToken]).includes(s));
const auditClean = secrets.every((s) => !JSON.stringify(auditEntries).includes(s));
harness.dispose();

export const kmsRotationJourney: AcceptanceJourney = {
  journeyId: "security.kms-rotation",
  persona: "site-reliability-engineer",
  capabilities: ["kms-key-management"],
  goal: "Prove the KMS rotation discipline across the process boundary: create through the API, issue under the current key with material fetched over the authenticated API, rotate, verify-grace to KEY_RETIRED, with the refusal ladder",
  steps: [
    {
      stepId: "kmr-boot-provision-login",
      kind: "intake",
      description: "The REAL KMS service boots (fresh envelope, journaled admin bootstrap) and the admin logs in for an HMAC session token with expiry",
      packages: ["@fleetos/identity"],
      operations: ["fleetos-kms service (POST /api/admin/credentials, POST /api/session)"],
      run: (ctx) => {
        ctx.record("kmr.admin.provisionOk", okOf(provision));
        ctx.record("kmr.login.ok", typeof token === "string" && token.length > 0);
      },
    },
    {
      stepId: "kmr-create-and-adapter",
      kind: "intake",
      description: "The first-key create draw through the injected stream; the adapter loads the snapshot over the authenticated API; issueKeyedSession binds the KMS-served current key id into the fsk1 envelope",
      packages: ["@fleetos/identity"],
      operations: ["fleetos-kms service (POST /api/keys/create, GET /api/keys/current, GET /api/keys, POST /api/keys/resolve)", "loadKmsKeyringProvider", "issueKeyedSession"],
      run: (ctx) => {
        ctx.record("kmr.create.ok", okOf(create));
        ctx.record("kmr.create.keyId", strOf(create.json, "keyId"));
        ctx.record("kmr.current.postCreate", strOf(current1.json, "keyId"));
        ctx.record("kmr.list.postCreate", listOf(list1.json, "keyIds"));
        ctx.record("kmr.adapter1.source", provider1?.source ?? "refused");
        ctx.record("kmr.adapter1.currentKey", provider1?.currentKeyId() ?? "refused");
        ctx.record("kmr.issue1.ok", t1?.ok ?? false);
        ctx.record("kmr.issue1.keyId", t1?.ok ? t1.keyId : "refused");
        ctx.record("kmr.issue1.partCount", t1?.ok ? t1.token.split(".").length : 0);
        ctx.record("kmr.issue1.materialFromKms", adapterMaterialMatchesService && adapterMaterialMatchesStream);
      },
    },
    {
      stepId: "kmr-rotate",
      kind: "lifecycle",
      description: "The rotation through the API: the REAL F370B kernel inside the service — new key drawn (id then material), the old key gets its verify-grace deadline and is RETAINED; the adapter is honestly RELOADED (a snapshot is a snapshot)",
      packages: ["@fleetos/identity"],
      operations: ["fleetos-kms service (POST /api/keys/rotate, GET /api/keys)", "loadKmsKeyringProvider"],
      run: (ctx) => {
        ctx.record("kmr.rotate.ok", okOf(rotate));
        ctx.record("kmr.rotate.newKeyId", strOf(rotate.json, "newKeyId"));
        ctx.record("kmr.rotate.rotatedOutKeyId", strOf(rotate.json, "rotatedOutKeyId"));
        ctx.record("kmr.rotate.retireAt", numOf(rotate.json, "retireAt"));
        ctx.record("kmr.list.postRotate", listOf(list2.json, "keyIds"));
        ctx.record("kmr.adapter2.currentKey", provider2?.currentKeyId() ?? "refused");
        ctx.record("kmr.adapter2.k1RetireAt", k1PostRotate?.retireAt ?? "refused");
        ctx.record("kmr.t2.ok", t2?.ok ?? false);
        ctx.record("kmr.t2.keyId", t2?.ok ? t2.keyId : "refused");
      },
    },
    {
      stepId: "kmr-grace-and-retirement",
      kind: "negative-check",
      description: "The F370B ladder across the boundary: the k1 token verifies in grace, at the inclusive boundary, then refuses KEY_RETIRED; the k2 token stays current",
      packages: ["@fleetos/identity"],
      operations: ["verifyKeyedSession"],
      run: (ctx) => {
        ctx.record("kmr.t1.graceOk", grace?.ok ?? false);
        ctx.record("kmr.t1.graceKeyStatus", grace?.ok ? grace.keyStatus : "refused");
        ctx.record("kmr.t1.boundaryInclusive", boundary?.ok ?? false);
        ctx.record("kmr.t1.retired", retired?.ok ? "accepted" : retired?.reason ?? "refused");
        ctx.record("kmr.t2.verifyKeyStatus", t2Verify?.ok ? t2Verify.keyStatus : "refused");
      },
    },
    {
      stepId: "kmr-refusals",
      kind: "negative-check",
      description: "REFUSALS: the ghost id at the API boundary (KEY_UNKNOWN); the known-id substitution and the tampered signature (SIGNATURE_INVALID); the malformed family (MALFORMED_TOKEN) — verify never throws",
      packages: ["@fleetos/identity"],
      operations: ["fleetos-kms service (POST /api/keys/resolve)", "verifyKeyedSession"],
      run: (ctx) => {
        ctx.record("kmr.ghostResolve", refusalReasonOf(ghostResolve) || "accepted");
        ctx.record("kmr.swappedKeyId", swapped?.ok ? "accepted" : swapped?.reason ?? "refused");
        ctx.record("kmr.tampered", tampered?.ok ? "accepted" : tampered?.reason ?? "refused");
        ctx.record("kmr.malformed.allOneReason", malformedReasons.every((r) => r === "MALFORMED_TOKEN"));
        ctx.record("kmr.malformed.nullToken", nullToken?.ok ? "accepted" : nullToken?.reason ?? "refused");
      },
    },
    {
      stepId: "kmr-audit-and-noleak",
      kind: "ledger",
      description: "The append-only journal (who/what/when-as-op-seq; no secrets) and the no-leak law over every verdict this journey produced",
      packages: ["@fleetos/identity"],
      operations: ["fleetos-kms service (GET /api/audit)"],
      run: (ctx) => {
        ctx.record("kmr.audit.ops", auditEntries.map((e) => e.op));
        ctx.record("kmr.audit.opSeqs", auditEntries.map((e) => e.opSeq));
        ctx.record("kmr.audit.noSecrets", auditClean);
        ctx.record("kmr.noleak.verdictsClean", verdictsClean);
      },
    },
  ],
  assertions: [
    { assertionId: "kmr-1", description: "The admin bootstrap succeeds (journaled)", path: "kmr.admin.provisionOk", expected: true },
    { assertionId: "kmr-2", description: "The login issues a session token", path: "kmr.login.ok", expected: true },
    { assertionId: "kmr-3", description: "The first-key create succeeds through the API", path: "kmr.create.ok", expected: true },
    { assertionId: "kmr-4", description: "The create draw is the fixed stream id (deterministic under injection)", path: "kmr.create.keyId", expected: KMS_F373_CREATE_KID },
    { assertionId: "kmr-5", description: "The current key is the created key", path: "kmr.current.postCreate", expected: KMS_F373_CREATE_KID },
    { assertionId: "kmr-6", description: "The key list carries exactly the created key", path: "kmr.list.postCreate", expected: [KMS_F373_CREATE_KID] },
    { assertionId: "kmr-7", description: "The adapter is plainly labelled kms-sourced", path: "kmr.adapter1.source", expected: "kms" },
    { assertionId: "kmr-8", description: "The adapter's current key is the KMS's current key", path: "kmr.adapter1.currentKey", expected: KMS_F373_CREATE_KID },
    { assertionId: "kmr-9", description: "The session issues under the current key", path: "kmr.issue1.ok", expected: true },
    { assertionId: "kmr-10", description: "The keyed token carries the KMS's current key id", path: "kmr.issue1.keyId", expected: KMS_F373_CREATE_KID },
    { assertionId: "kmr-11", description: "The keyed token is the four-part fsk1 envelope", path: "kmr.issue1.partCount", expected: 4 },
    { assertionId: "kmr-12", description: "The adapter-served material equals the service resolve AND the stream draw (served only over the authenticated channel)", path: "kmr.issue1.materialFromKms", expected: true },
    { assertionId: "kmr-13", description: "The rotation succeeds through the API", path: "kmr.rotate.ok", expected: true },
    { assertionId: "kmr-14", description: "The new key id is the fixed stream draw", path: "kmr.rotate.newKeyId", expected: KMS_F373_ROTATE_KID },
    { assertionId: "kmr-15", description: "The rotated-out key is the created key", path: "kmr.rotate.rotatedOutKeyId", expected: KMS_F373_CREATE_KID },
    { assertionId: "kmr-16", description: "The old key's verify-grace deadline is rotate-at + grace", path: "kmr.rotate.retireAt", expected: RETIRE_AT },
    { assertionId: "kmr-17", description: "The retired key is RETAINED in the KMS (KEY_RETIRED never decays into KEY_UNKNOWN)", path: "kmr.list.postRotate", expected: [KMS_F373_CREATE_KID, KMS_F373_ROTATE_KID] },
    { assertionId: "kmr-18", description: "The reloaded adapter's current key is the rotated-in key", path: "kmr.adapter2.currentKey", expected: KMS_F373_ROTATE_KID },
    { assertionId: "kmr-19", description: "The reloaded adapter serves the old key's grace deadline", path: "kmr.adapter2.k1RetireAt", expected: RETIRE_AT },
    { assertionId: "kmr-20", description: "Post-rotation issuance binds the new current key id", path: "kmr.t2.keyId", expected: KMS_F373_ROTATE_KID },
    { assertionId: "kmr-21", description: "The k1 token still verifies inside the grace window", path: "kmr.t1.graceOk", expected: true },
    { assertionId: "kmr-22", description: "The grace verdict names verify-grace", path: "kmr.t1.graceKeyStatus", expected: "verify-grace" },
    { assertionId: "kmr-23", description: "The retire-at boundary instant still verifies (inclusive grace)", path: "kmr.t1.boundaryInclusive", expected: true },
    { assertionId: "kmr-24", description: "REFUSAL: past the retire-at the k1 token refuses KEY_RETIRED", path: "kmr.t1.retired", expected: "KEY_RETIRED" },
    { assertionId: "kmr-25", description: "The k2 token verifies past the old key's retirement as current", path: "kmr.t2.verifyKeyStatus", expected: "current" },
    { assertionId: "kmr-26", description: "REFUSAL at the API boundary: the ghost id refuses KEY_UNKNOWN", path: "kmr.ghostResolve", expected: "KEY_UNKNOWN" },
    { assertionId: "kmr-27", description: "REFUSAL: the known-id substitution (kid2 carried, kid1 signature) refuses SIGNATURE_INVALID", path: "kmr.swappedKeyId", expected: "SIGNATURE_INVALID" },
    { assertionId: "kmr-28", description: "REFUSAL: the tampered signature refuses SIGNATURE_INVALID", path: "kmr.tampered", expected: "SIGNATURE_INVALID" },
    { assertionId: "kmr-29", description: "REFUSALS: the malformed family is uniformly MALFORMED_TOKEN", path: "kmr.malformed.allOneReason", expected: true },
    { assertionId: "kmr-30", description: "A null token is a typed refusal, never a throw", path: "kmr.malformed.nullToken", expected: "MALFORMED_TOKEN" },
    { assertionId: "kmr-31", description: "The journal records the four ops in order (who/what/when-as-op-seq)", path: "kmr.audit.ops", expected: ["kms.admin-token-key", "kms.admin-provision", "kms.key-create", "kms.key-rotate"] },
    { assertionId: "kmr-32", description: "The op sequence is contiguous from 1", path: "kmr.audit.opSeqs", expected: [1, 2, 3, 4] },
    { assertionId: "kmr-33", description: "The journal carries no secrets", path: "kmr.audit.noSecrets", expected: true },
    { assertionId: "kmr-34", description: "NO-LEAK: no verdict carries any lane secret (master key, admin secret, draws)", path: "kmr.noleak.verdictsClean", expected: true },
  ],
};
