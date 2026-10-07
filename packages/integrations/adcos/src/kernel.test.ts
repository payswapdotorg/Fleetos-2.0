import { describe, it, expect } from "vitest";
import {
  AuditedAdcosProvider,
  expireCommandToken,
  HealthCheckCache,
  issueCommandToken,
  verifyCommandToken,
  verifyToken,
  type CommandToken,
} from "./kernel.js";
import { ReferenceAdcosProvider } from "./adcos.js";

const NOW = 1_727_000_000_000;
const TENANT_A = "tnt_acme";
const TENANT_B = "tnt_other";
const DEV1 = "dev_truck-001";
const TOKEN_ID = "tok_abcdef0123456789";

function verifiedToken(tenant: string = TENANT_A, exp: number = NOW + 3600_000): CommandToken {
  const issued = issueCommandToken({ id: TOKEN_ID, tenantId: tenant, actor: "act_a", issuedAt: NOW, expiresAt: exp });
  return verifyCommandToken(issued, NOW + 1);
}

function makeProvider(): AuditedAdcosProvider {
  const base = new ReferenceAdcosProvider({
    knownDevices: [DEV1, "dev_sensor-002"],
    health: "healthy",
  });
  const devicesByTenant = new Map<string, Set<string>>([
    [TENANT_A, new Set([DEV1, "dev_sensor-002"])],
    [TENANT_B, new Set(["dev_other-001"])],
  ]);
  return new AuditedAdcosProvider(base, devicesByTenant);
}

describe("adcos kernel: CommandToken lifecycle", () => {
  it("issueCommandToken creates a token in the issued state", () => {
    const t = issueCommandToken({ id: TOKEN_ID, tenantId: TENANT_A, actor: "act_a", issuedAt: NOW, expiresAt: NOW + 1000 });
    expect(t.state).toBe("issued");
    expect(t.verifiedAt).toBeNull();
  });

  it("verifyCommandToken transitions issued -> verified", () => {
    const t = issueCommandToken({ id: TOKEN_ID, tenantId: TENANT_A, actor: "act_a", issuedAt: NOW, expiresAt: NOW + 1000 });
    const v = verifyCommandToken(t, NOW + 1);
    expect(v.state).toBe("verified");
    expect(v.verifiedAt).toBe(NOW + 1);
  });

  it("verifyCommandToken is idempotent on already-verified tokens", () => {
    const t = issueCommandToken({ id: TOKEN_ID, tenantId: TENANT_A, actor: "act_a", issuedAt: NOW, expiresAt: NOW + 1000 });
    const v1 = verifyCommandToken(t, NOW + 1);
    const v2 = verifyCommandToken(v1, NOW + 2);
    expect(v2.state).toBe("verified");
    expect(v2.verifiedAt).toBe(NOW + 1); // unchanged
  });

  it("expireCommandToken transitions to expired", () => {
    const t = issueCommandToken({ id: TOKEN_ID, tenantId: TENANT_A, actor: "act_a", issuedAt: NOW, expiresAt: NOW + 1000 });
    const v = verifyCommandToken(t, NOW + 1);
    const e = expireCommandToken(v);
    expect(e.state).toBe("expired");
  });

  it("expireCommandToken is idempotent on already-expired tokens", () => {
    const t = issueCommandToken({ id: TOKEN_ID, tenantId: TENANT_A, actor: "act_a", issuedAt: NOW, expiresAt: NOW + 1000 });
    const v = verifyCommandToken(t, NOW + 1);
    const e1 = expireCommandToken(v);
    const e2 = expireCommandToken(e1);
    expect(e2.state).toBe("expired");
  });
});

describe("adcos kernel: verifyToken (token validation)", () => {
  it("rejects an issued (not-verified) token with token-not-verified", () => {
    const t = issueCommandToken({ id: TOKEN_ID, tenantId: TENANT_A, actor: "act_a", issuedAt: NOW, expiresAt: NOW + 1000 });
    const r = verifyToken(t, NOW + 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("token-not-verified");
  });

  it("rejects an expired token with token-expired", () => {
    const t = issueCommandToken({ id: TOKEN_ID, tenantId: TENANT_A, actor: "act_a", issuedAt: NOW, expiresAt: NOW + 1000 });
    const v = verifyCommandToken(t, NOW + 1);
    const e = expireCommandToken(v);
    const r = verifyToken(e, NOW + 2);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("token-expired");
  });

  it("rejects a verified token past its expiresAt with token-expired", () => {
    const t = issueCommandToken({ id: TOKEN_ID, tenantId: TENANT_A, actor: "act_a", issuedAt: NOW, expiresAt: NOW + 1000 });
    const v = verifyCommandToken(t, NOW + 1);
    const r = verifyToken(v, NOW + 2000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("token-expired");
  });

  it("accepts a verified token within its expiresAt", () => {
    const t = issueCommandToken({ id: TOKEN_ID, tenantId: TENANT_A, actor: "act_a", issuedAt: NOW, expiresAt: NOW + 1000 });
    const v = verifyCommandToken(t, NOW + 1);
    const r = verifyToken(v, NOW + 500);
    expect(r.ok).toBe(true);
  });
});

describe("adcos kernel: AuditedAdcosProvider audit emission", () => {
  it("sends a command successfully and emits audit", async () => {
    const provider = makeProvider();
    const r = await provider.sendCommand({
      tenantId: TENANT_A,
      deviceId: DEV1,
      kind: "ping",
      token: verifiedToken(),
      actor: "act_a",
      at: NOW,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.audit.intent).toBe("adcos:ping:ok");
      expect(r.audit.tenant).toBe(TENANT_A);
      expect(r.audit.digest.length).toBe(64);
    }
  });

  it("rejects with token-tenant-mismatch when token tenant != command tenant", async () => {
    const provider = makeProvider();
    const r = await provider.sendCommand({
      tenantId: TENANT_A,
      deviceId: DEV1,
      kind: "ping",
      token: verifiedToken(TENANT_B),
      actor: "act_a",
      at: NOW,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("token-tenant-mismatch");
  });

  it("rejects with token-not-verified-equivalent when token is unverified", async () => {
    const provider = makeProvider();
    const r = await provider.sendCommand({
      tenantId: TENANT_A,
      deviceId: DEV1,
      kind: "ping",
      token: issueCommandToken({ id: TOKEN_ID, tenantId: TENANT_A, actor: "act_a", issuedAt: NOW, expiresAt: NOW + 1000 }),
      actor: "act_a",
      at: NOW,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unknown-error");
  });

  it("rejects with token-expired-equivalent when token is past expiresAt", async () => {
    const provider = makeProvider();
    const r = await provider.sendCommand({
      tenantId: TENANT_A,
      deviceId: DEV1,
      kind: "ping",
      token: verifiedToken(TENANT_A, NOW - 1000), // already expired
      actor: "act_a",
      at: NOW,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unknown-error");
  });
});

describe("adcos kernel: tenant fail-closed device visibility", () => {
  it("rejects with device-not-found when device is not registered for the tenant", async () => {
    const provider = makeProvider();
    // DEV1 is registered for TENANT_A but not TENANT_B.
    const r = await provider.sendCommand({
      tenantId: TENANT_B,
      deviceId: DEV1,
      kind: "ping",
      token: verifiedToken(TENANT_B),
      actor: "act_a",
      at: NOW,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("device-not-found");
  });

  it("accepts the device when registered for the correct tenant", async () => {
    const provider = makeProvider();
    const r = await provider.sendCommand({
      tenantId: TENANT_A,
      deviceId: DEV1,
      kind: "ping",
      token: verifiedToken(TENANT_A),
      actor: "act_a",
      at: NOW,
    });
    expect(r.ok).toBe(true);
  });
});

describe("adcos kernel: HealthCheckCache TTL behavior", () => {
  it("returns cached health within TTL and fromCache=true", async () => {
    const base = new ReferenceAdcosProvider({ health: "healthy" });
    const cache = new HealthCheckCache(1000);
    const first = await cache.healthCheck(base, TENANT_A, NOW);
    expect(first.fromCache).toBe(false);
    expect(first.health).toBe("healthy");
    expect(first.audit.intent).toBe("adcos:health:healthy");

    const second = await cache.healthCheck(base, TENANT_A, NOW + 500);
    expect(second.fromCache).toBe(true);
    expect(second.audit.intent).toBe("adcos:health:cached:healthy");
  });

  it("re-queries after TTL expires (fromCache=false)", async () => {
    const base = new ReferenceAdcosProvider({ health: "degraded" });
    const cache = new HealthCheckCache(1000);
    await cache.healthCheck(base, TENANT_A, NOW);
    const after = await cache.healthCheck(base, TENANT_A, NOW + 2000);
    expect(after.fromCache).toBe(false);
    expect(after.health).toBe("degraded");
  });

  it("invalidate() forces a re-query on the next call", async () => {
    const base = new ReferenceAdcosProvider({ health: "healthy" });
    const cache = new HealthCheckCache(1000);
    await cache.healthCheck(base, TENANT_A, NOW);
    cache.invalidate(TENANT_A);
    const after = await cache.healthCheck(base, TENANT_A, NOW + 100);
    expect(after.fromCache).toBe(false);
  });

  it("audit digest for cached vs fresh differs (intent includes 'cached' marker)", async () => {
    const base = new ReferenceAdcosProvider({ health: "healthy" });
    const cache = new HealthCheckCache(1000);
    const fresh = await cache.healthCheck(base, TENANT_A, NOW);
    const cached = await cache.healthCheck(base, TENANT_A, NOW + 100);
    expect(fresh.audit.digest).not.toBe(cached.audit.digest);
  });
});
