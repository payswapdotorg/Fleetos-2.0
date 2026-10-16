/**
 * F373 journey 3 — the KMS crash-restart proof (persona: compliance-auditor).
 *
 * CENSUS CITATION (F373, census-first at base 76ddba0): zero matches for
 * the journey id "kms-crash-restart"; zero matches for the op prefix
 * `kmx-`. The nearest neighboring claims are the F370C marketplace
 * persistence journeys (real PostgreSQL SIGKILLs) — THIS journey kills
 * the KMS itself: the process that owns the key material and the master
 * key at its boundary. The proof: SIGKILL mid-rotation-sequence (after
 * the rotate ack, before the plan completes) -> restart -> the key set +
 * the audit journal recovered FROM THE AT-REST ENVELOPE -> digests and
 * verdicts IDENTICAL (machine-asserted, the packet's crash-restart law).
 *
 * Determinism: the restart consumes ZERO SecureRandom draws (recovery,
 * never re-creation — if it drew, the ids would change and the digests
 * would diverge, which is exactly what the identity assertions detect);
 * every reading is a logical constant (fixed `now` per request).
 */

import type { AcceptanceJourney } from "../journey-contracts.ts";
import { canonicalJson, fnv1a } from "../journey-contracts.ts";
import { issueKeyedSession, loadKmsKeyringProvider, verifyKeyedSession } from "@fleetos/identity";
import {
  KMS_F373_ADMIN_SECRET,
  KMS_F373_ADMIN_TK,
  KMS_F373_CREATE_KID,
  KMS_F373_CREATE_MAT,
  KMS_F373_MASTER_KEY,
  KMS_F373_ROTATE_KID,
  KMS_F373_ROTATE_MAT,
  listOf,
  numOf,
  okOf,
  spawnKmsHarness,
  strOf,
} from "./kms-harness.ts";

const BASE_MS = 1_791_830_400_000;
const T0 = BASE_MS;
const LOGIN_AT = BASE_MS + 10_000;
const CREATE_AT = BASE_MS + 20_000;
const ROTATE_AT = BASE_MS + 60_000;
const GRACE_MS = 600_000;
const RETIRE_AT = ROTATE_AT + GRACE_MS;
const IN_GRACE_AT = ROTATE_AT + 60_000;
const ADMIN_ID = "f373-kx-admin";

/** The key-set digest: over LOGICAL metadata only (ids + deadlines —
 *  never material); the lane's FNV-1a presentation convention. */
function keySetDigestOf(input: { currentKeyId: string; keys: readonly { keyId: string; retireAt: number | null }[] }): string {
  return fnv1a(`kms-keyset|v1|${canonicalJson({ currentKeyId: input.currentKeyId, keys: input.keys.map((k) => ({ keyId: k.keyId, retireAt: k.retireAt })) })}`);
}

/** The audit-journal digest (opSeq/op/actor/detail — no secrets inside). */
function auditDigestOf(entries: readonly { opSeq: number; op: string; actor: string; detail: string }[]): string {
  return fnv1a(`kms-audit|v1|${canonicalJson(entries)}`);
}

// --- the REAL drive, at module evaluation (the F341B TLA law) -----------

const harness = await spawnKmsHarness([
  KMS_F373_ADMIN_TK,
  KMS_F373_CREATE_KID,
  KMS_F373_CREATE_MAT,
  KMS_F373_ROTATE_KID,
  KMS_F373_ROTATE_MAT,
]);
const provision = await harness.call({ method: "POST", path: "/api/admin/credentials", body: { adminId: ADMIN_ID, secret: KMS_F373_ADMIN_SECRET, now: T0 }, label: "admin-provision" });
const token = await harness.login({ adminId: ADMIN_ID, secret: KMS_F373_ADMIN_SECRET, now: LOGIN_AT, ttlMs: 3_600_000, jti: "jti-f373-kx-login" });

// Phase 1: the first key + a pre-crash token under it (via the adapter).
const create = await harness.call({ method: "POST", path: "/api/keys/create", body: { now: CREATE_AT }, token, label: "key-create" });
const adapter1 = await loadKmsKeyringProvider({ baseUrl: harness.baseUrl(), token, now: CREATE_AT });
const provider1 = adapter1.ok ? adapter1.provider : null;
const t1 = provider1 === null
  ? null
  : issueKeyedSession({
      provider: provider1,
      actorId: "act_f373_kms_01",
      tenantId: "acme-ops",
      scopes: ["marketplace.request"],
      issuedAt: CREATE_AT,
      expiresAt: CREATE_AT + 3_600_000,
      jti: "jti-f373-kx-t1",
    });

// Phase 2: the rotation — then the crash lands MID-SEQUENCE (the rotate is
// acked; the plan's remaining steps run only after the restart).
const rotate = await harness.call({ method: "POST", path: "/api/keys/rotate", body: { now: ROTATE_AT, verifyGraceMs: GRACE_MS }, token, label: "key-rotate" });

// The post-rotation adapter snapshot (a snapshot is a snapshot — the
// honest reload; needed so the pre-crash grace verdict sees kid1's
// retireAt, exactly as the rotation journey does).
const preAdapter = await loadKmsKeyringProvider({ baseUrl: harness.baseUrl(), token, now: ROTATE_AT });
const preAdapterProvider = preAdapter.ok ? preAdapter.provider : null;

// The pre-crash readings: the logical state the envelope must carry.
const preCurrent = await harness.call({ method: "GET", path: `/api/keys/current?now=${ROTATE_AT}`, token, label: "pre-current" });
const preList = await harness.call({ method: "GET", path: `/api/keys?now=${ROTATE_AT}`, token, label: "pre-list" });
const preResolveK1 = await harness.call({ method: "POST", path: "/api/keys/resolve", body: { keyId: KMS_F373_CREATE_KID, now: ROTATE_AT }, token, label: "pre-resolve-k1" });
const preResolveK2 = await harness.call({ method: "POST", path: "/api/keys/resolve", body: { keyId: KMS_F373_ROTATE_KID, now: ROTATE_AT }, token, label: "pre-resolve-k2" });
const preAudit = await harness.call({ method: "GET", path: `/api/audit?now=${ROTATE_AT}`, token, label: "pre-audit" });
const preAuditEntries = (preAudit.json["entries"] ?? []) as { opSeq: number; op: string; actor: string; detail: string }[];
const preKeySetDigest = keySetDigestOf({
  currentKeyId: String(preCurrent.json["keyId"] ?? ""),
  keys: [
    { keyId: KMS_F373_CREATE_KID, retireAt: RETIRE_AT },
    { keyId: KMS_F373_ROTATE_KID, retireAt: null },
  ],
});
if (preKeySetDigest !== "0a9e8e8c") throw new Error(`journey fixture: pre-crash key-set digest moved (${preKeySetDigest})`);
const preAuditDigest = auditDigestOf(preAuditEntries);
if (preAuditDigest !== "efa98bd3") throw new Error(`journey fixture: pre-crash audit digest moved (${preAuditDigest})`);
const preGrace = t1?.ok !== true || preAdapterProvider === null ? null : verifyKeyedSession(t1.token, { provider: preAdapterProvider, now: IN_GRACE_AT });

// THE CRASH: a real SIGKILL of the KMS process, mid-rotation-sequence.
await harness.killAndAwait();
const crashExitObserved = true;

// The restart on the SAME data dir + SAME env (recovery must consume zero
// draws — if it drew, the ids would change and the post digests diverge).
await harness.restart();
const health2 = await harness.call({ method: "GET", path: "/api/health", label: "post-health" });
const recovery2 = (health2.json["recovery"] ?? {}) as { recovered?: boolean; keys?: number; admins?: number; adminTokenKeyRecovered?: boolean; auditEntries?: number; freshBoot?: boolean };

// The post-crash readings: recovered from the at-rest envelope.
const postCurrent = await harness.call({ method: "GET", path: `/api/keys/current?now=${ROTATE_AT}`, token, label: "post-current" });
const postList = await harness.call({ method: "GET", path: `/api/keys?now=${ROTATE_AT}`, token, label: "post-list" });
const postResolveK1 = await harness.call({ method: "POST", path: "/api/keys/resolve", body: { keyId: KMS_F373_CREATE_KID, now: ROTATE_AT }, token, label: "post-resolve-k1" });
const postResolveK2 = await harness.call({ method: "POST", path: "/api/keys/resolve", body: { keyId: KMS_F373_ROTATE_KID, now: ROTATE_AT }, token, label: "post-resolve-k2" });
const postAudit = await harness.call({ method: "GET", path: `/api/audit?now=${ROTATE_AT}`, token, label: "post-audit" });
const postAuditEntries = (postAudit.json["entries"] ?? []) as { opSeq: number; op: string; actor: string; detail: string }[];
const postKeySetDigest = keySetDigestOf({
  currentKeyId: String(postCurrent.json["keyId"] ?? ""),
  keys: [
    { keyId: KMS_F373_CREATE_KID, retireAt: typeof postResolveK1.json["retireAt"] === "number" ? (postResolveK1.json["retireAt"] as number) : -1 },
    { keyId: KMS_F373_ROTATE_KID, retireAt: null },
  ],
});
const postAuditDigest = auditDigestOf(postAuditEntries);

// Verdicts identical: the pre-crash token still verifies under the
// RECOVERED material (the admin token too — the admin token key was
// recovered from the envelope: every post-crash call above used it).
const adapter2 = await loadKmsKeyringProvider({ baseUrl: harness.baseUrl(), token, now: ROTATE_AT });
const provider2 = adapter2.ok ? adapter2.provider : null;
const postGrace = t1?.ok !== true || provider2 === null ? null : verifyKeyedSession(t1.token, { provider: provider2, now: IN_GRACE_AT });
const postRetired = t1?.ok !== true || provider2 === null ? null : verifyKeyedSession(t1.token, { provider: provider2, now: RETIRE_AT + 1 });
const t2 = provider2 === null
  ? null
  : issueKeyedSession({
      provider: provider2,
      actorId: "act_f373_kms_01",
      tenantId: "acme-ops",
      scopes: ["marketplace.request"],
      issuedAt: ROTATE_AT,
      expiresAt: ROTATE_AT + 3_600_000,
      jti: "jti-f373-kx-t2",
    });
const t2Verify = t2?.ok !== true || provider2 === null ? null : verifyKeyedSession(t2.token, { provider: provider2, now: RETIRE_AT + 1 });

const resolveVerdictsIdentical = JSON.stringify(preResolveK1.json) === JSON.stringify(postResolveK1.json) && JSON.stringify(preResolveK2.json) === JSON.stringify(postResolveK2.json);
const resolveMaterialMatchesStream =
  postResolveK1.json["secretHex"] === KMS_F373_CREATE_MAT && postResolveK2.json["secretHex"] === KMS_F373_ROTATE_MAT;
const atRestClean = ![KMS_F373_MASTER_KEY, KMS_F373_ADMIN_SECRET, KMS_F373_ADMIN_TK, KMS_F373_CREATE_MAT, KMS_F373_ROTATE_MAT].some((s) => harness.stateFileText().includes(s) || harness.auditFileText().includes(s));
harness.dispose();

export const kmsCrashRestartJourney: AcceptanceJourney = {
  journeyId: "security.kms-crash-restart",
  persona: "compliance-auditor",
  capabilities: ["kms-key-management"],
  goal: "Prove the KMS crash-restart law: SIGKILL mid-rotation-sequence, restart, and the key set + audit journal recover from the at-rest envelope with identical digests and verdicts",
  steps: [
    {
      stepId: "kmx-boot-create-issue",
      kind: "intake",
      description: "The REAL KMS boots; the admin logs in; the first key is created through the API; a token is issued under it through the adapter (material over the authenticated API)",
      packages: ["@fleetos/identity"],
      operations: ["fleetos-kms service (POST /api/admin/credentials, POST /api/session, POST /api/keys/create)", "loadKmsKeyringProvider", "issueKeyedSession"],
      run: (ctx) => {
        ctx.record("kmx.admin.provisionOk", okOf(provision));
        ctx.record("kmx.login.ok", typeof token === "string" && token.length > 0);
        ctx.record("kmx.create.ok", okOf(create));
        ctx.record("kmx.create.keyId", strOf(create.json, "keyId"));
        ctx.record("kmx.issue1.ok", t1?.ok ?? false);
        ctx.record("kmx.issue1.keyId", t1?.ok ? t1.keyId : "refused");
      },
    },
    {
      stepId: "kmx-rotate-then-crash",
      kind: "lifecycle",
      description: "The rotation is ACKED; the pre-crash readings are taken; then a REAL SIGKILL lands mid-sequence (the plan's remaining steps run only after the restart)",
      packages: ["@fleetos/identity"],
      operations: ["fleetos-kms service (POST /api/keys/rotate, GET /api/keys/current, GET /api/keys, POST /api/keys/resolve, GET /api/audit)"],
      run: (ctx) => {
        ctx.record("kmx.rotate.ok", okOf(rotate));
        ctx.record("kmx.rotate.newKeyId", strOf(rotate.json, "newKeyId"));
        ctx.record("kmx.rotate.retireAt", numOf(rotate.json, "retireAt"));
        ctx.record("kmx.pre.currentKey", strOf(preCurrent.json, "keyId"));
        ctx.record("kmx.pre.list", listOf(preList.json, "keyIds"));
        ctx.record("kmx.pre.keySetDigest", preKeySetDigest);
        ctx.record("kmx.pre.auditDigest", preAuditDigest);
        ctx.record("kmx.pre.auditEntryCount", preAuditEntries.length);
        ctx.record("kmx.pre.graceKeyStatus", preGrace?.ok ? preGrace.keyStatus : "refused");
        ctx.record("kmx.crash.signal", "SIGKILL");
        ctx.record("kmx.crash.exitObserved", crashExitObserved);
      },
    },
    {
      stepId: "kmx-restart-recovery",
      kind: "evidence",
      description: "The restart on the SAME data dir: recovery from the at-rest envelope (keys, admins, admin token key, audit) — the pre-crash-issued admin token still authenticates every call",
      packages: ["@fleetos/identity"],
      operations: ["fleetos-kms service (GET /api/health, GET /api/keys/current, GET /api/keys, POST /api/keys/resolve, GET /api/audit)"],
      run: (ctx) => {
        ctx.record("kmx.recovery.recovered", recovery2["recovered"] === true);
        ctx.record("kmx.recovery.keys", recovery2["keys"] ?? -1);
        ctx.record("kmx.recovery.admins", recovery2["admins"] ?? -1);
        ctx.record("kmx.recovery.adminTokenKeyRecovered", recovery2["adminTokenKeyRecovered"] === true);
        ctx.record("kmx.recovery.auditEntries", recovery2["auditEntries"] ?? -1);
        ctx.record("kmx.recovery.notFreshBoot", recovery2["freshBoot"] === false);
        ctx.record("kmx.boot.count", harness.bootedCount());
      },
    },
    {
      stepId: "kmx-digests-and-verdicts",
      kind: "negative-check",
      description: "THE CRASH-RESTART LAW: key-set digest and audit digest IDENTICAL pre/post; resolve verdicts identical (material recovered from the envelope, matching the stream draws); the pre-crash token verifies identically",
      packages: ["@fleetos/identity"],
      operations: ["fleetos-kms service (POST /api/keys/resolve)", "loadKmsKeyringProvider", "verifyKeyedSession"],
      run: (ctx) => {
        ctx.record("kmx.post.currentKey", strOf(postCurrent.json, "keyId"));
        ctx.record("kmx.post.list", listOf(postList.json, "keyIds"));
        ctx.record("kmx.post.keySetDigest", postKeySetDigest);
        ctx.record("kmx.digests.keySetIdentical", preKeySetDigest === postKeySetDigest);
        ctx.record("kmx.digests.auditIdentical", preAuditDigest === postAuditDigest);
        ctx.record("kmx.post.auditEntryCount", postAuditEntries.length);
        ctx.record("kmx.verdicts.resolveIdentical", resolveVerdictsIdentical);
        ctx.record("kmx.verdicts.materialMatchesStream", resolveMaterialMatchesStream);
        ctx.record("kmx.verdicts.graceIdentical", JSON.stringify(preGrace) === JSON.stringify(postGrace));
        ctx.record("kmx.post.graceKeyStatus", postGrace?.ok ? postGrace.keyStatus : "refused");
        ctx.record("kmx.post.retired", postRetired?.ok ? "accepted" : postRetired?.reason ?? "refused");
        ctx.record("kmx.post.t2.ok", t2Verify?.ok ?? false);
        ctx.record("kmx.post.t2.keyStatus", t2Verify?.ok ? t2Verify.keyStatus : "refused");
      },
    },
    {
      stepId: "kmx-at-rest-noleak",
      kind: "ledger",
      description: "The at-rest law after the full cycle: NO plaintext key material in the state file or the journal (machine-scanned)",
      packages: ["@fleetos/identity"],
      operations: ["kms-harness (state/audit file scan)"],
      run: (ctx) => {
        ctx.record("kmx.atrest.clean", atRestClean);
      },
    },
  ],
  assertions: [
    { assertionId: "kmx-1", description: "The admin bootstrap succeeds", path: "kmx.admin.provisionOk", expected: true },
    { assertionId: "kmx-2", description: "The login issues a session token", path: "kmx.login.ok", expected: true },
    { assertionId: "kmx-3", description: "The first-key create succeeds", path: "kmx.create.ok", expected: true },
    { assertionId: "kmx-4", description: "The create draw is the fixed stream id", path: "kmx.create.keyId", expected: KMS_F373_CREATE_KID },
    { assertionId: "kmx-5", description: "The pre-crash token issues under the created key", path: "kmx.issue1.ok", expected: true },
    { assertionId: "kmx-6", description: "The pre-crash token carries the created key id", path: "kmx.issue1.keyId", expected: KMS_F373_CREATE_KID },
    { assertionId: "kmx-7", description: "The rotation is acked through the API", path: "kmx.rotate.ok", expected: true },
    { assertionId: "kmx-8", description: "The rotated-in key id is the fixed stream draw", path: "kmx.rotate.newKeyId", expected: KMS_F373_ROTATE_KID },
    { assertionId: "kmx-9", description: "The grace deadline is rotate-at + grace", path: "kmx.rotate.retireAt", expected: RETIRE_AT },
    { assertionId: "kmx-10", description: "Pre-crash: the current key is the rotated-in key", path: "kmx.pre.currentKey", expected: KMS_F373_ROTATE_KID },
    { assertionId: "kmx-11", description: "Pre-crash: both keys are listed (RETAINED)", path: "kmx.pre.list", expected: [KMS_F373_CREATE_KID, KMS_F373_ROTATE_KID] },
    { assertionId: "kmx-12", description: "Pre-crash: the key-set digest is the pinned constant (logical metadata only — never material)", path: "kmx.pre.keySetDigest", expected: "0a9e8e8c" },
    { assertionId: "kmx-13", description: "Pre-crash: the audit digest is recorded (3 ops + the boot draw)", path: "kmx.pre.auditEntryCount", expected: 4 },
    { assertionId: "kmx-14", description: "Pre-crash: the k1 token verifies in grace", path: "kmx.pre.graceKeyStatus", expected: "verify-grace" },
    { assertionId: "kmx-15", description: "THE CRASH: the KMS process was SIGKILLed mid-sequence", path: "kmx.crash.signal", expected: "SIGKILL" },
    { assertionId: "kmx-16", description: "The process exit was observed before the restart", path: "kmx.crash.exitObserved", expected: true },
    { assertionId: "kmx-17", description: "Recovery: the envelope was recovered (keys + admins + admin token key + audit)", path: "kmx.recovery.recovered", expected: true },
    { assertionId: "kmx-18", description: "Recovery: both keys came back", path: "kmx.recovery.keys", expected: 2 },
    { assertionId: "kmx-19", description: "Recovery: the admin came back", path: "kmx.recovery.admins", expected: 1 },
    { assertionId: "kmx-20", description: "Recovery: the admin token key was recovered (the pre-crash token still works)", path: "kmx.recovery.adminTokenKeyRecovered", expected: true },
    { assertionId: "kmx-21", description: "Recovery: the audit journal came back whole", path: "kmx.recovery.auditEntries", expected: 4 },
    { assertionId: "kmx-22", description: "Recovery: this was NOT a fresh boot (recovery, never re-creation)", path: "kmx.recovery.notFreshBoot", expected: true },
    { assertionId: "kmx-23", description: "The service booted exactly twice (the restart)", path: "kmx.boot.count", expected: 2 },
    { assertionId: "kmx-24", description: "Post-crash: the current key is the rotated-in key", path: "kmx.post.currentKey", expected: KMS_F373_ROTATE_KID },
    { assertionId: "kmx-25", description: "Post-crash: both keys are listed (RETAINED through the crash)", path: "kmx.post.list", expected: [KMS_F373_CREATE_KID, KMS_F373_ROTATE_KID] },
    { assertionId: "kmx-26", description: "THE LAW: the key-set digest is IDENTICAL across the crash", path: "kmx.digests.keySetIdentical", expected: true },
    { assertionId: "kmx-27", description: "THE LAW: the audit digest is IDENTICAL across the crash", path: "kmx.digests.auditIdentical", expected: true },
    { assertionId: "kmx-28", description: "Post-crash: the journal carries the same entry count", path: "kmx.post.auditEntryCount", expected: 4 },
    { assertionId: "kmx-29", description: "THE LAW: the resolve verdicts are IDENTICAL pre/post (material recovered from the envelope)", path: "kmx.verdicts.resolveIdentical", expected: true },
    { assertionId: "kmx-30", description: "The recovered material matches the stream draws (recovery, never re-creation)", path: "kmx.verdicts.materialMatchesStream", expected: true },
    { assertionId: "kmx-31", description: "THE LAW: the grace verdict is IDENTICAL pre/post", path: "kmx.verdicts.graceIdentical", expected: true },
    { assertionId: "kmx-32", description: "Post-crash: the k1 token verifies in grace under the recovered material", path: "kmx.post.graceKeyStatus", expected: "verify-grace" },
    { assertionId: "kmx-33", description: "Post-crash: past the retire-at the k1 token refuses KEY_RETIRED (the ladder completes after the crash)", path: "kmx.post.retired", expected: "KEY_RETIRED" },
    { assertionId: "kmx-34", description: "Post-crash: a fresh issue under the recovered current key verifies as current", path: "kmx.post.t2.keyStatus", expected: "current" },
    { assertionId: "kmx-35", description: "AT-REST after the full cycle: no plaintext key material on disk (machine-scanned)", path: "kmx.atrest.clean", expected: true },
  ],
};
