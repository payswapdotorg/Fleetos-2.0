/**
 * F370C manual smoke proof — drives the REAL service over HTTP:
 * provision → login → the full F362 spine shape → digest → SIGKILL →
 * restart → digest identical → dump → SIGKILL → restore-boot → digest
 * identical. Run from the repo root:
 *   node --experimental-transform-types --no-warnings \
 *        --import ./infrastructure/fleetos-marketplace/runtime.mjs \
 *        infrastructure/fleetos-marketplace/proof-smoke.mjs
 */
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
const SERVICE = path.join(REPO_ROOT, "infrastructure/fleetos-marketplace/service.ts");
const RUNTIME = path.join(REPO_ROOT, "infrastructure/fleetos-marketplace/runtime.mjs");
const KEYRING = JSON.stringify({
  currentKeyId: "mps-k2",
  keys: [
    { keyId: "mps-k1", algorithm: "HMAC-SHA256", secretHex: "1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff", retireAt: 1774000005000 },
    { keyId: "mps-k2", algorithm: "HMAC-SHA256", secretHex: "ffffeeee1111ddddccccbbbbaaaa999988887777666655554444333322221111", retireAt: null },
  ],
});
const T0 = 1774000000000;
const dataDir = mkdtempSync(path.join(tmpdir(), "mps-smoke-"));

function boot(extraArgs = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      "--experimental-transform-types", "--no-warnings", "--import", RUNTIME, SERVICE,
      ...extraArgs,
    ], {
      cwd: REPO_ROOT,
      env: { ...process.env, FLEETOS_MARKETPLACE_PORT: "0", FLEETOS_MARKETPLACE_DATA: dataDir, FLEETOS_SESSION_KEYRING_JSON: KEYRING },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    child.stdout.on("data", (d) => {
      stdout += String(d);
      const m = stdout.match(/listening on :(\d+)/);
      if (m !== null) resolve({ child, port: Number(m[1]) });
    });
    child.stderr.on("data", (d) => process.stderr.write(`[svc] ${d}`));
    child.on("exit", (code) => reject(new Error(`service exited early (${code}): ${stdout}`)));
    setTimeout(() => reject(new Error(`service boot timeout: ${stdout}`)), 30000);
  });
}

const kill9 = (child) => new Promise((resolve) => {
  child.on("exit", () => resolve());
  child.kill("SIGKILL");
});

async function call(port, method, route, body, token) {
  const res = await fetch(`http://127.0.0.1:${port}${route}`, {
    method,
    headers: { "content-type": "application/json", ...(token !== undefined ? { authorization: `Bearer ${token}` } : {}) },
    ...(method === "POST" ? { body: JSON.stringify(body ?? {}) } : {}),
  });
  return { status: res.status, json: await res.json() };
}

async function waitHealthy(port) {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (r.ok) return await r.json();
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("service never became healthy");
}

const { child, port } = await boot();
await waitHealthy(port);
console.log("boot OK, port", port);

const provision = await call(port, "POST", "/api/auth/credentials", { credentialId: "cred-mps-01", actorId: "act_operator-mps-01", tenantId: "acme", kind: "human", secret: "smoke-secret-1" });
console.log("provision:", provision.status, provision.json.ok);
const login = await call(port, "POST", "/api/auth/login", { credentialId: "cred-mps-01", secret: "smoke-secret-1", scopes: ["marketplace.request", "marketplace.offer", "marketplace.comparison", "marketplace.order", "marketplace.order.ack", "marketplace.receipt", "marketplace.enrollment", "marketplace.approval"], ttlMs: 3600000, jti: "jti-mps-smoke-001", now: T0 });
console.log("login:", login.status, login.json.ok, login.json.keyId);
const token = login.json.token;

const req = await call(port, "POST", "/api/marketplace/requests", { tenantId: "acme", now: T0 + 1000, requestId: "req-mps-001", naturalKey: "acme:lt-5540:2026-q4:smoke", sku: "LT-5540", quantity: 5, requiredBy: "2026-12-31", at: T0 + 1000 }, token);
console.log("request:", req.status, req.json.ok, req.json.result?.request?.status, req.json.result?.request?.requestId);
const badLogin = await call(port, "POST", "/api/auth/login", { credentialId: "cred-mps-01", secret: "WRONG", now: T0 + 1100 });
console.log("bad login:", badLogin.status, badLogin.json.refusal?.reason);
const noToken = await call(port, "POST", "/api/marketplace/requests", { tenantId: "acme", now: T0 + 1200, requestId: "req-x", naturalKey: "nk-x", sku: "S", quantity: 1, requiredBy: "2026-12-31" });
console.log("no token:", noToken.status, noToken.json.refusal?.reason);
const offer = await call(port, "POST", "/api/marketplace/offers", { tenantId: "acme", now: T0 + 2000, offer: { offerId: "off-mps-a", supplierId: "sup-alpha", sku: "LT-5540", quantity: 5, unitCostMinor: 1350000, totalCostMinor: 6750000, currency: "GHS", taxMinor: 0, feesMinor: 0, deliveryEstimateDays: 3, condition: "new", warrantyMonths: 12, validFrom: T0 + 1500, validUntil: T0 + 86400000, source: { kind: "operator-entered", reference: "smoke-ref-1" }, capturedAt: T0 + 2000 } }, token);
console.log("offer:", offer.status, offer.json.ok, offer.json.result?.offer?.offerId);
const transition = async (type, at, extra = {}) => call(port, "POST", "/api/marketplace/request-transitions", { tenantId: "acme", now: at, requestId: "req-mps-001", command: { type, at, ...extra } }, token);
console.log("resolve:", (await transition("resolve", T0 + 3000)).json.result?.next?.status);
console.log("close:", (await transition("close_offer_window", T0 + 3100)).json.result?.next?.status);
console.log("compare-phase:", (await transition("compare", T0 + 3200)).json.result?.next?.status);

const compare = await call(port, "POST", "/api/marketplace/comparisons", { tenantId: "acme", now: T0 + 3300, at: T0 + 3300, demand: { sku: "LT-5540", currency: "GHS", acceptableConditions: ["new"] }, supplierVerifications: [{ supplierId: "sup-alpha", tenant: { tenantId: "acme" }, status: "verified", expiresAt: T0 + 7776000000 }] }, token);
console.log("comparison:", compare.status, compare.json.ok, compare.json.result?.eligibleCount, compare.json.result?.ranked?.[0]?.quoteId);

const evidence = await call(port, "POST", "/api/marketplace/evidence", { tenantId: "acme", now: T0 + 3400, recordedAt: "2026-10-15T00:00:00.000Z", input: { tenantId: "acme", providerEventId: "exp-mps-001", kind: "marketplace.offer-snapshot", subjectRef: "off-mps-a", source: { system: "manual-catalogue-import", reference: "exp-1", retrievedVia: "manual" }, capturedAt: "2026-10-14T00:00:00.000Z", artifacts: [{ artifactId: "art-1", sha256: "a".repeat(64), bytes: 10, mediaType: "application/json", description: "snapshot" }] } }, token);
console.log("evidence:", evidence.status, evidence.json.ok, evidence.json.result?.record?.evidenceId);

const approval = await call(port, "POST", "/api/marketplace/approvals", { tenantId: "acme", now: T0 + 3500, requestId: "appr-mps-001", actorAuthority: ["human.approval"], actorAutonomous: false, order: { orderId: "ord-mps-001", category: "laptops", transactionKind: "purchase", units: 5, amount: { total: 6750000, currency: "GHS" }, supplierRef: { supplierId: "sup-alpha", verificationRef: "exp-mps-001" }, offerSnapshotRef: evidence.json.result?.record?.evidenceId }, limits: { amountCeiling: { purchase: 8000000, "repair-service": 5000000, rental: 0, lease: 0 }, currency: "GHS", allowedCategories: ["laptops", "printers"], maxUnitsPerOrder: 10, requiredPolicyKinds: ["procurement", "budget"] }, policyRefs: [{ policyKind: "procurement", policyId: "pol-1", version: "1.0.0" }, { policyKind: "budget", policyId: "pol-2", version: "1.0.0" }], policy: { id: "pol-smoke", version: "1.0.0", tenantId: "acme", rules: [{ id: "rule.1", description: "high risk needs human approval", riskFloor: "medium", riskCeiling: "high", requiredAuthority: ["human.approval"], tenantScope: "single", verdict: "REQUIRE_APPROVAL", priority: 20 }], defaultVerdict: "BLOCK", failClosed: true } }, token);
console.log("approval:", approval.status, approval.json.ok, approval.json.result?.decision, approval.json.result?.reasonCode);

console.log("select:", (await transition("select", T0 + 3600, { offerId: "off-mps-a" })).json.result?.next?.status);
console.log("request_approval:", (await transition("request_approval", T0 + 3700)).json.result?.next?.status);
console.log("approve:", (await transition("approve", T0 + 3800)).json.result?.next?.status);
console.log("order-cmd:", (await transition("order", T0 + 3900)).json.result?.next?.status);

const draft = await call(port, "POST", "/api/marketplace/orders", { tenantId: "acme", now: T0 + 4000, order: { orderId: "ord-mps-001", requestId: "req-mps-001", offerId: "off-mps-a", supplierId: "sup-alpha", sku: "LT-5540", quantity: 5, unitCostMinor: 1350000, totalCostMinor: 6750000, currency: "GHS" } }, token);
console.log("draft:", draft.status, draft.json.ok, draft.json.result?.order?.status);
const place = await call(port, "POST", "/api/marketplace/order-places", { tenantId: "acme", now: T0 + 4100, orderId: "ord-mps-001", at: T0 + 4100 }, token);
console.log("place:", place.status, place.json.ok, place.json.result?.order?.status);

const ackEvidence = await call(port, "POST", "/api/marketplace/evidence", { tenantId: "acme", now: T0 + 4200, recordedAt: "2026-10-15T00:00:01.000Z", input: { tenantId: "acme", providerEventId: "inv-mps-001", kind: "marketplace.provider-ack", subjectRef: "ord-mps-001", source: { system: "provider-portal-export", reference: "inv-1", retrievedVia: "export" }, capturedAt: "2026-10-14T00:00:01.000Z", artifacts: [{ artifactId: "art-2", sha256: "b".repeat(64), bytes: 12, mediaType: "application/json", description: "invoice" }] } }, token);
console.log("ack evidence:", ackEvidence.status, ackEvidence.json.ok, ackEvidence.json.result?.record?.evidenceId);
const ack = await call(port, "POST", "/api/marketplace/order-acks", { tenantId: "acme", now: T0 + 4300, orderId: "ord-mps-001", ack: { providerEventId: "prov-ack-mps-001", evidence: { evidenceId: ackEvidence.json.result?.record?.evidenceId, tenantId: "acme" }, channel: "manual-invoice-reference", acknowledgedAt: T0 + 4300 } }, token);
console.log("ack:", ack.status, ack.json.ok, ack.json.result?.order?.status, "dup:", ack.json.result?.duplicate);
const ack2 = await call(port, "POST", "/api/marketplace/order-acks", { tenantId: "acme", now: T0 + 4400, orderId: "ord-mps-001", ack: { providerEventId: "prov-ack-mps-001", evidence: { evidenceId: "other", tenantId: "acme" }, channel: "manual-portal-export", acknowledgedAt: T0 + 4400 } }, token);
console.log("ack replay:", ack2.status, ack2.json.ok, "dup:", ack2.json.result?.duplicate);

const receipt = await call(port, "POST", "/api/marketplace/receipts", { tenantId: "acme", now: T0 + 5000, receipt: { evidenceRef: "rcpt-mps-001", tenantId: "acme", siteId: "site-accra-east", supplierOrderRef: "ord-mps-001", serial: "SN-MPS-0001", assetTag: "TAG-MPS-0001", conditionOnArrival: "new", warrantyRef: "wrty-mps-0001", capturedAt: T0 + 4900, recordedAt: T0 + 5000 } }, token);
console.log("receipt:", receipt.status, receipt.json.ok, receipt.json.result?.evidence?.state);
const verify = await call(port, "POST", "/api/marketplace/receipt-verifications", { tenantId: "acme", now: T0 + 5100, evidenceRef: "rcpt-mps-001", decidedAt: T0 + 5100, expectation: { supplierOrderRef: "ord-mps-001", expectedSerial: "SN-MPS-0001", expectedAssetTag: "TAG-MPS-0001", expectedCondition: "new" } }, token);
console.log("verify:", verify.status, verify.json.ok, verify.json.result?.evidence?.state);
const open = await call(port, "POST", "/api/marketplace/enrollments", { tenantId: "acme", now: T0 + 5200, enrollment: { evidenceRef: "rcpt-mps-001", assetId: "ast_mps_0001", displayName: "LT-5540 laptop (smoke)", kind: "other", deviceId: "dev-mps-0001", at: T0 + 5200 } }, token);
console.log("enroll open:", open.status, open.json.ok, open.json.result?.enrollment?.state);
const complete = await call(port, "POST", "/api/marketplace/enrollment-completions", { tenantId: "acme", now: T0 + 5300, serial: "SN-MPS-0001", at: T0 + 5300 }, token);
console.log("enroll complete:", complete.status, complete.json.ok, complete.json.result?.enrollment?.state, "twin:", complete.json.result?.twinLinked);

const digest1 = await call(port, "GET", "/api/digest");
console.log("digest total:", digest1.json.digests.total, "counts:", JSON.stringify(digest1.json.counts));

// === SIGKILL crash + restart ===
await kill9(child);
const boot2 = await boot();
await waitHealthy(boot2.port);
console.log("restarted after SIGKILL, port", boot2.port, "verify:", JSON.stringify((await waitHealthy(boot2.port)).verify));
const digest2 = await call(boot2.port, "GET", "/api/digest");
console.log("digest after restart identical:", digest2.json.digests.total === digest1.json.digests.total);
const stateAfter = await call(boot2.port, "GET", `/api/marketplace/state?family=enrollments&tenantId=acme&now=${T0 + 6000}`, undefined, token);
console.log("enrollments survived:", stateAfter.json.result?.count, stateAfter.json.result?.records?.[0]?.state);
const reqAfter = await call(boot2.port, "GET", `/api/marketplace/state?family=requests&tenantId=acme&now=${T0 + 6100}`, undefined, token);
console.log("request survived:", reqAfter.json.result?.records?.[0]?.status);

// === backup + restore ===
const backup = await call(boot2.port, "GET", `/api/admin/backup?now=${T0 + 7000}`);
console.log("backup:", backup.status, backup.json.ok, "envelope total:", backup.json.envelope.digests.total);
const dumpFile = path.join(dataDir, "smoke-backup.json");
writeFileSync(dumpFile, backup.json.dump);
await kill9(boot2.child);
const boot3 = await boot(["--restore", dumpFile, "--at", String(T0 + 8000)]);
await waitHealthy(boot3.port);
console.log("restore boot OK");
const digest3 = await call(boot3.port, "GET", "/api/digest");
const same = digest3.json.digests.total === digest1.json.digests.total;
console.log("digest after restore identical:", same);
const loginAfter = await call(boot3.port, "POST", "/api/auth/login", { credentialId: "cred-mps-01", secret: "smoke-secret-1", scopes: ["marketplace.request"], ttlMs: 3600000, jti: "jti-mps-smoke-002", now: T0 + 8100 });
console.log("login after restore (credential survived):", loginAfter.status, loginAfter.json.ok);
const digest4 = await call(boot3.port, "GET", "/api/digest");
console.log("audit grew by login:", digest4.json.counts.audit === digest3.json.counts.audit + 1);

await kill9(boot3.child);
rmSync(dataDir, { recursive: true, force: true });
console.log(same ? "SMOKE PROOF: PASS" : "SMOKE PROOF: FAIL");
process.exit(same ? 0 : 1);
