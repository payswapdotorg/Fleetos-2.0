/**
 * F373 journey 2 — the KMS trust boundary (persona: security-analyst).
 *
 * CENSUS CITATION (F373, census-first at base 76ddba0): zero matches for
 * the journey id "kms-boundary"; zero matches for the op prefix `kmb-`.
 * The nearest neighboring claims are the F370A signed-session family and
 * the F370C marketplace boundary (the F370A gate's refusals at the
 * HTTP boundary over the keyring fixture) — THIS journey drives the KMS's
 * OWN authentication boundary (the fka1 admin session plane + the admin
 * credential digest) and the AT-REST law: the on-disk KMS state contains
 * NO plaintext key material (machine-scanned), and the no-leak law holds
 * at the network boundary (key material is served ONLY over the
 * authenticated resolve channel — grep-asserted over every captured
 * response).
 */

import type { AcceptanceJourney } from "../journey-contracts.ts";
import { loadKmsKeyringProvider } from "@fleetos/identity";
import {
  KMS_F373_ADMIN_SECRET,
  KMS_F373_ADMIN_TK,
  KMS_F373_CREATE_KID,
  KMS_F373_CREATE_MAT,
  KMS_F373_MASTER_KEY,
  okOf,
  refusalReasonOf,
  spawnKmsHarness,
  strOf,
  tamperToken,
} from "./kms-harness.ts";

const BASE_MS = 1_791_830_400_000;
const T0 = BASE_MS;
const LOGIN_AT = BASE_MS + 10_000;
const CREATE_AT = BASE_MS + 20_000;
const ADMIN_ID = "f373-kb-admin";
const LANE_SECRETS = [KMS_F373_MASTER_KEY, KMS_F373_ADMIN_SECRET, KMS_F373_ADMIN_TK, KMS_F373_CREATE_MAT];

// --- the REAL drive, at module evaluation (the F341B TLA law) -----------

const harness = await spawnKmsHarness([KMS_F373_ADMIN_TK, KMS_F373_CREATE_KID, KMS_F373_CREATE_MAT]);
const health = await harness.call({ method: "GET", path: "/api/health", label: "health" });

// The unauthenticated/garbage/tampered/expired family at the auth plane.
const unauth = await harness.call({ method: "GET", path: `/api/keys/current?now=${LOGIN_AT}`, label: "unauth-current" });
await harness.call({ method: "POST", path: "/api/admin/credentials", body: { adminId: ADMIN_ID, secret: KMS_F373_ADMIN_SECRET, now: T0 }, label: "admin-provision" });
const duplicateProvision = await harness.call({ method: "POST", path: "/api/admin/credentials", body: { adminId: ADMIN_ID, secret: KMS_F373_ADMIN_SECRET, now: T0 }, label: "admin-provision-duplicate" });
const token = await harness.login({ adminId: ADMIN_ID, secret: KMS_F373_ADMIN_SECRET, now: LOGIN_AT, ttlMs: 3_600_000, jti: "jti-f373-kb-login" });
const shortLived = await harness.login({ adminId: ADMIN_ID, secret: KMS_F373_ADMIN_SECRET, now: LOGIN_AT, ttlMs: 1_000, jti: "jti-f373-kb-short" });

const tamperedCall = await harness.call({ method: "GET", path: `/api/keys?now=${LOGIN_AT}`, token: tamperToken(token), label: "tampered-admin-token" });
const expiredCall = await harness.call({ method: "GET", path: `/api/keys?now=${LOGIN_AT + 2_000}`, token: shortLived, label: "expired-admin-session" });
const garbageCall = await harness.call({ method: "GET", path: `/api/keys?now=${LOGIN_AT}`, token: "garbage-not-a-token", label: "garbage-admin-token" });

// The login refusal family — byte-identical (enumeration-resistant).
const loginUnknownAdmin = await harness.call({ method: "POST", path: "/api/session", body: { adminId: "ghost-admin", secret: "whatever-wrong", now: LOGIN_AT, ttlMs: 60_000 }, label: "login-unknown-admin" });
const loginWrongSecret = await harness.call({ method: "POST", path: "/api/session", body: { adminId: ADMIN_ID, secret: "wrong-secret", now: LOGIN_AT, ttlMs: 60_000 }, label: "login-wrong-secret" });
const loginNoTtl = await harness.call({ method: "POST", path: "/api/session", body: { adminId: ADMIN_ID, secret: KMS_F373_ADMIN_SECRET, now: LOGIN_AT }, label: "login-no-ttl" });
const loginRefusalsByteIdentical = JSON.stringify(loginUnknownAdmin.json) === JSON.stringify(loginWrongSecret.json) && JSON.stringify(loginWrongSecret.json) === JSON.stringify(loginNoTtl.json);

// The key-plane refusals.
const create = await harness.call({ method: "POST", path: "/api/keys/create", body: { now: CREATE_AT }, token, label: "key-create" });
const duplicateCreate = await harness.call({ method: "POST", path: "/api/keys/create", body: { now: CREATE_AT }, token, label: "key-create-duplicate" });
const ghostResolve = await harness.call({ method: "POST", path: "/api/keys/resolve", body: { keyId: "ghost-k9", now: CREATE_AT }, token, label: "resolve-ghost" });
// THE MATERIAL CHANNEL: the authenticated resolve — the only call whose
// response carries key material, by design (consumed by the adapter).
await harness.call({ method: "POST", path: "/api/keys/resolve", body: { keyId: KMS_F373_CREATE_KID, now: CREATE_AT }, token, label: "resolve-material" });

// The adapter with a GARBAGE token: the authenticated API refuses the load
// — a fixed-string verdict, never the response body.
const adapterRefused = await loadKmsKeyringProvider({ baseUrl: harness.baseUrl(), token: "garbage-not-a-token", now: CREATE_AT });
const adapterRefusedClean = !LANE_SECRETS.some((s) => JSON.stringify(adapterRefused).includes(s));

// The at-rest scan: the state file + the audit journal, machine-scanned
// for every lane secret; and the positive side — the envelope EXISTS.
const stateText = harness.stateFileText();
const auditText = harness.auditFileText();
const stateFileClean = !LANE_SECRETS.some((s) => stateText.includes(s));
const auditFileClean = !LANE_SECRETS.some((s) => auditText.includes(s));
const stateFileJson = JSON.parse(stateText) as { keys?: { wrapped?: string }[]; adminTokenKey?: string };
const hasWrappedEnvelope = typeof stateFileJson["adminTokenKey"] === "string" && (stateFileJson["adminTokenKey"]?.length ?? 0) > 0 && (stateFileJson["keys"]?.[0]?.wrapped?.length ?? 0) > 0;

// The no-leak law at the network boundary: every captured response body
// EXCEPT the material channel (the authenticated resolve — the only place
// material is ever served, by design) scanned for every lane secret.
const materialChannelCalls = harness.calls.filter((c) => c.label === "resolve-material");
const nonMaterialCalls = harness.calls.filter((c) => c.label !== "resolve-material");
const responsesClean = !nonMaterialCalls.some((c) => LANE_SECRETS.some((s) => c.bodyText.includes(s)));
const materialChannelOnly = materialChannelCalls.length === 1 && materialChannelCalls[0]!.bodyText.includes(KMS_F373_CREATE_MAT) && !nonMaterialCalls.some((c) => c.bodyText.includes(KMS_F373_CREATE_MAT));

const auditJournal = await harness.call({ method: "GET", path: `/api/audit?now=${CREATE_AT}`, token, label: "audit" });
const auditEntries = (auditJournal.json["entries"] ?? []) as { opSeq: number; op: string }[];
const auditNoSecrets = !LANE_SECRETS.some((s) => auditText.includes(s) || JSON.stringify(auditEntries).includes(s));
harness.dispose();

export const kmsBoundaryJourney: AcceptanceJourney = {
  journeyId: "security.kms-boundary",
  persona: "security-analyst",
  capabilities: ["kms-key-management"],
  goal: "Prove the KMS trust boundary: unauthenticated/tampered/expired access refused with frozen codes, the at-rest envelope carries NO plaintext key material, and material is served only over the authenticated channel",
  steps: [
    {
      stepId: "kmb-boot-and-health",
      kind: "intake",
      description: "The REAL KMS service boots and reports its bindings + recovery as data (no secrets, no port)",
      packages: ["@fleetos/identity"],
      operations: ["fleetos-kms service (GET /api/health)"],
      run: (ctx) => {
        ctx.record("kmb.health.ok", okOf(health));
        ctx.record("kmb.health.randomBinding", (health.json["bindings"] as { random?: string } | undefined)?.random ?? "unknown");
        ctx.record("kmb.health.freshBoot", ((health.json["recovery"] as { freshBoot?: boolean } | undefined)?.freshBoot ?? false) && ((health.json["recovery"] as { keys?: number } | undefined)?.keys === 0));
      },
    },
    {
      stepId: "kmb-auth-refusals",
      kind: "negative-check",
      description: "REFUSALS: no token => UNAUTHENTICATED; a tampered admin token => SIGNATURE_INVALID; an expired session => SESSION_EXPIRED; garbage => UNAUTHENTICATED — frozen reason codes, verdicts-as-data",
      packages: ["@fleetos/identity"],
      operations: ["fleetos-kms service (GET /api/keys, GET /api/keys/current)"],
      run: (ctx) => {
        ctx.record("kmb.unauth", refusalReasonOf(unauth) || "accepted");
        ctx.record("kmb.tampered", refusalReasonOf(tamperedCall) || "accepted");
        ctx.record("kmb.expired", refusalReasonOf(expiredCall) || "accepted");
        ctx.record("kmb.garbage", refusalReasonOf(garbageCall) || "accepted");
      },
    },
    {
      stepId: "kmb-credential-plane",
      kind: "negative-check",
      description: "REFUSALS: unknown admin / wrong secret / malformed login are byte-identical (enumeration-resistant); a duplicate admin provision refuses ADMIN_EXISTS",
      packages: ["@fleetos/identity"],
      operations: ["fleetos-kms service (POST /api/admin/credentials, POST /api/session)"],
      run: (ctx) => {
        ctx.record("kmb.login.refusal", refusalReasonOf(loginUnknownAdmin) || "accepted");
        ctx.record("kmb.login.byteIdentical", loginRefusalsByteIdentical);
        ctx.record("kmb.provision.duplicate", refusalReasonOf(duplicateProvision) || "accepted");
      },
    },
    {
      stepId: "kmb-key-plane-refusals",
      kind: "negative-check",
      description: "REFUSALS: a duplicate create refuses KEY_EXISTS; the ghost id refuses KEY_UNKNOWN at the API boundary",
      packages: ["@fleetos/identity"],
      operations: ["fleetos-kms service (POST /api/keys/create, POST /api/keys/resolve)"],
      run: (ctx) => {
        ctx.record("kmb.create.ok", okOf(create));
        ctx.record("kmb.create.keyId", strOf(create.json, "keyId"));
        ctx.record("kmb.create.duplicate", refusalReasonOf(duplicateCreate) || "accepted");
        ctx.record("kmb.resolve.ghost", refusalReasonOf(ghostResolve) || "accepted");
      },
    },
    {
      stepId: "kmb-adapter-refusal",
      kind: "negative-check",
      description: "The keyring adapter with a garbage token: the authenticated API refuses the load — a fixed-string verdict, never the response body",
      packages: ["@fleetos/identity"],
      operations: ["loadKmsKeyringProvider"],
      run: (ctx) => {
        ctx.record("kmb.adapter.refusedOk", !adapterRefused.ok);
        ctx.record("kmb.adapter.refusedReason", adapterRefused.ok ? "loaded" : adapterRefused.reason);
        ctx.record("kmb.adapter.refusedClean", adapterRefusedClean);
      },
    },
    {
      stepId: "kmb-at-rest-scan",
      kind: "evidence",
      description: "THE AT-REST LAW (machine-scanned): the on-disk state file and audit journal contain NO plaintext key material (master key, admin secret, admin token key, drawn material) — and the wrapped envelope EXISTS (the positive side)",
      packages: ["@fleetos/identity"],
      operations: ["kms-harness (state/audit file scan)"],
      run: (ctx) => {
        ctx.record("kmb.atrest.stateFileClean", stateFileClean);
        ctx.record("kmb.atrest.auditFileClean", auditFileClean);
        ctx.record("kmb.atrest.hasWrappedEnvelope", hasWrappedEnvelope);
        ctx.record("kmb.audit.noSecrets", auditNoSecrets);
        ctx.record("kmb.audit.ops", auditEntries.map((e) => e.op));
      },
    },
    {
      stepId: "kmb-network-noleak",
      kind: "negative-check",
      description: "The no-leak law at the network boundary: every captured response EXCEPT the material channel (the authenticated resolve) is free of every lane secret; exactly ONE material-channel call exists",
      packages: ["@fleetos/identity"],
      operations: ["kms-harness (captured-response scan)"],
      run: (ctx) => {
        ctx.record("kmb.noleak.responsesClean", responsesClean);
        ctx.record("kmb.noleak.materialChannelOnly", materialChannelOnly);
        ctx.record("kmb.noleak.materialCalls", materialChannelCalls.length);
      },
    },
  ],
  assertions: [
    { assertionId: "kmb-1", description: "The service is healthy", path: "kmb.health.ok", expected: true },
    { assertionId: "kmb-2", description: "The health endpoint reports the deterministic-stream binding (plainly labelled)", path: "kmb.health.randomBinding", expected: "deterministic-stream" },
    { assertionId: "kmb-3", description: "The recovery report says fresh boot (no keys yet, health called first)", path: "kmb.health.freshBoot", expected: true },
    { assertionId: "kmb-4", description: "REFUSAL: an unauthenticated call refuses UNAUTHENTICATED", path: "kmb.unauth", expected: "UNAUTHENTICATED" },
    { assertionId: "kmb-5", description: "REFUSAL: a tampered admin token refuses SIGNATURE_INVALID", path: "kmb.tampered", expected: "SIGNATURE_INVALID" },
    { assertionId: "kmb-6", description: "REFUSAL: an expired admin session refuses SESSION_EXPIRED", path: "kmb.expired", expected: "SESSION_EXPIRED" },
    { assertionId: "kmb-7", description: "REFUSAL: a garbage Bearer token refuses UNAUTHENTICATED", path: "kmb.garbage", expected: "UNAUTHENTICATED" },
    { assertionId: "kmb-8", description: "REFUSAL: the login refusal family (unknown admin / wrong secret / malformed) is one frozen code", path: "kmb.login.refusal", expected: "ADMIN_CREDENTIAL_INVALID" },
    { assertionId: "kmb-9", description: "The login refusals are byte-identical (enumeration-resistant)", path: "kmb.login.byteIdentical", expected: true },
    { assertionId: "kmb-10", description: "REFUSAL: a duplicate admin provision refuses ADMIN_EXISTS", path: "kmb.provision.duplicate", expected: "ADMIN_EXISTS" },
    { assertionId: "kmb-11", description: "The create succeeds (once)", path: "kmb.create.ok", expected: true },
    { assertionId: "kmb-12", description: "The create draw is the fixed stream id", path: "kmb.create.keyId", expected: KMS_F373_CREATE_KID },
    { assertionId: "kmb-13", description: "REFUSAL: a duplicate create refuses KEY_EXISTS", path: "kmb.create.duplicate", expected: "KEY_EXISTS" },
    { assertionId: "kmb-14", description: "REFUSAL: the ghost id refuses KEY_UNKNOWN at the API boundary", path: "kmb.resolve.ghost", expected: "KEY_UNKNOWN" },
    { assertionId: "kmb-15", description: "The adapter load with a garbage token is refused", path: "kmb.adapter.refusedOk", expected: true },
    { assertionId: "kmb-16", description: "The adapter refusal is the fixed malformed verdict", path: "kmb.adapter.refusedReason", expected: "malformed" },
    { assertionId: "kmb-17", description: "The adapter refusal carries no lane secret (never echoes the body)", path: "kmb.adapter.refusedClean", expected: true },
    { assertionId: "kmb-18", description: "AT-REST: the state file contains NO plaintext key material (machine-scanned)", path: "kmb.atrest.stateFileClean", expected: true },
    { assertionId: "kmb-19", description: "AT-REST: the audit journal contains NO plaintext key material (machine-scanned)", path: "kmb.atrest.auditFileClean", expected: true },
    { assertionId: "kmb-20", description: "AT-REST: the wrapped envelope EXISTS (non-empty wrapped slots — the positive side)", path: "kmb.atrest.hasWrappedEnvelope", expected: true },
    { assertionId: "kmb-21", description: "The journal carries no secrets", path: "kmb.audit.noSecrets", expected: true },
    { assertionId: "kmb-22", description: "The journal records the three ops in order", path: "kmb.audit.ops", expected: ["kms.admin-token-key", "kms.admin-provision", "kms.key-create"] },
    { assertionId: "kmb-23", description: "NO-LEAK at the network boundary: every non-material response is free of every lane secret", path: "kmb.noleak.responsesClean", expected: true },
    { assertionId: "kmb-24", description: "The material channel is exactly the authenticated resolve (one call, the only body carrying material)", path: "kmb.noleak.materialChannelOnly", expected: true },
    { assertionId: "kmb-25", description: "Exactly one material-channel call was captured", path: "kmb.noleak.materialCalls", expected: 1 },
  ],
};
