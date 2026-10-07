/**
 * @fleetos/adcos — Wave 3 edge-grade adapter tests (F230A).
 *
 * Covers:
 *   - Typed error taxonomy: transient vs permanent classification per code
 *   - Retry policy: backoff computation, shouldRetry decision
 *   - Boundary normalization: success + failure both produce digests
 *   - Edge adapter end-to-end: transient retries succeed; permanent short-circuits
 *   - Edge adapter: max-attempts exhausted -> final failure audit
 *   - Edge health report: never exaggerates (mirrors base)
 *   - Tenant isolation: commands are tenant-scoped via the base provider
 */

import { describe, it, expect } from "vitest";
import {
  buildEdgeHealthReport,
  classifyAdcosError,
  computeBackoffMs,
  defaultRetryPolicy,
  EdgeAdcosAdapter,
  normalizeFailure,
  normalizeSuccess,
  shouldRetry,
  type EdgeAdcosRetryPolicy,
} from "./edge-adapter.js";
import { ReferenceAdcosProvider, type AdcosCommand, type AdcosResult } from "./adcos.js";

const NOW = 1_727_000_000_000;
const TENANT_A = "tnt_acme";
const DEVICE_1 = "dev_truck-001";

// A test double for the base provider that fails N times then succeeds.
class ScriptedProvider extends ReferenceAdcosProvider {
  private attempt = 0;
  constructor(
    private readonly script: ReadonlyArray<"ok" | "provider-unavailable" | "rate-limited" | "device-not-found" | "command-unsupported">,
  ) {
    super({ knownDevices: [DEVICE_1], health: "healthy" });
  }
  override async sendCommand(command: AdcosCommand): Promise<AdcosResult> {
    const idx = Math.min(this.attempt, this.script.length - 1);
    const op = this.script[idx]!;
    this.attempt++;
    if (op === "ok") return super.sendCommand(command);
    return { ok: false, reason: op, degraded: op === "provider-unavailable" || op === "rate-limited" };
  }
}

const noSleep = async () => {}; // deterministic — no real timers

// ---------------------------------------------------------------------------
// Typed error taxonomy
// ---------------------------------------------------------------------------

describe("adcos edge-adapter: typed error taxonomy", () => {
  it("provider-unavailable is transient + retryable", () => {
    const e = classifyAdcosError("provider-unavailable");
    expect(e.class).toBe("transient");
    expect(e.retryable).toBe(true);
    expect(e.message).toContain("unavailable");
  });

  it("rate-limited is transient + retryable", () => {
    const e = classifyAdcosError("rate-limited");
    expect(e.class).toBe("transient");
    expect(e.retryable).toBe(true);
  });

  it("device-not-found is permanent + not-retryable", () => {
    const e = classifyAdcosError("device-not-found");
    expect(e.class).toBe("permanent");
    expect(e.retryable).toBe(false);
  });

  it("command-unsupported is permanent + not-retryable", () => {
    const e = classifyAdcosError("command-unsupported");
    expect(e.class).toBe("permanent");
    expect(e.retryable).toBe(false);
  });

  it("missing-tenant-id is permanent + not-retryable", () => {
    const e = classifyAdcosError("missing-tenant-id");
    expect(e.class).toBe("permanent");
    expect(e.retryable).toBe(false);
  });

  it("missing-device-id is permanent + not-retryable", () => {
    const e = classifyAdcosError("missing-device-id");
    expect(e.class).toBe("permanent");
    expect(e.retryable).toBe(false);
  });

  it("unknown-error is conservatively transient (retry to learn more)", () => {
    const e = classifyAdcosError("unknown-error");
    expect(e.class).toBe("transient");
    expect(e.retryable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Retry policy: backoff computation + shouldRetry decision
// ---------------------------------------------------------------------------

describe("adcos edge-adapter: retry policy", () => {
  it("default policy: maxAttempts=3, baseDelayMs=100, maxDelayMs=5000, backoffFactor=2", () => {
    const p = defaultRetryPolicy();
    expect(p.maxAttempts).toBe(3);
    expect(p.baseDelayMs).toBe(100);
    expect(p.maxDelayMs).toBe(5_000);
    expect(p.backoffFactor).toBe(2);
  });

  it("computeBackoffMs: exponential growth (100, 200, 400)", () => {
    const p: EdgeAdcosRetryPolicy = { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 5_000, backoffFactor: 2 };
    expect(computeBackoffMs(p, 1)).toBe(100);
    expect(computeBackoffMs(p, 2)).toBe(200);
    expect(computeBackoffMs(p, 3)).toBe(400);
  });

  it("computeBackoffMs: caps at maxDelayMs", () => {
    const p: EdgeAdcosRetryPolicy = { maxAttempts: 5, baseDelayMs: 1000, maxDelayMs: 5_000, backoffFactor: 2 };
    expect(computeBackoffMs(p, 1)).toBe(1_000);
    expect(computeBackoffMs(p, 5)).toBe(5_000); // 1000 * 2^4 = 16000 -> capped
  });

  it("computeBackoffMs: attempt < 1 returns 0", () => {
    const p = defaultRetryPolicy();
    expect(computeBackoffMs(p, 0)).toBe(0);
  });

  it("shouldRetry: transient under maxAttempts -> true", () => {
    const p = defaultRetryPolicy();
    const e = classifyAdcosError("rate-limited");
    expect(shouldRetry(p, 1, e)).toBe(true);
    expect(shouldRetry(p, 2, e)).toBe(true);
  });

  it("shouldRetry: transient at maxAttempts -> false", () => {
    const p = defaultRetryPolicy(); // maxAttempts=3
    const e = classifyAdcosError("rate-limited");
    expect(shouldRetry(p, 3, e)).toBe(false);
  });

  it("shouldRetry: permanent -> always false", () => {
    const p = defaultRetryPolicy();
    const e = classifyAdcosError("device-not-found");
    expect(shouldRetry(p, 1, e)).toBe(false);
    expect(shouldRetry(p, 2, e)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Boundary normalization
// ---------------------------------------------------------------------------

describe("adcos edge-adapter: boundary normalization", () => {
  it("normalizeSuccess: produces digest + degraded flag", () => {
    const cmd: AdcosCommand = { tenantId: TENANT_A, deviceId: DEVICE_1, kind: "ping" };
    const r = normalizeSuccess(cmd, { ok: true, result: { acknowledged: true, kind: "ping" }, requestId: "req_1" });
    expect(r.ok).toBe(true);
    expect(r.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(r.degraded).toBe(false);
    expect(r.normalized.acknowledged).toBe(true);
  });

  it("normalizeSuccess: degraded flag is preserved from upstream", () => {
    const cmd: AdcosCommand = { tenantId: TENANT_A, deviceId: DEVICE_1, kind: "ping" };
    const r = normalizeSuccess(cmd, { ok: true, result: { acknowledged: true, degraded: true, kind: "ping" }, requestId: "req_1" });
    expect(r.degraded).toBe(true);
    expect(r.normalized.degraded).toBe(true);
  });

  it("normalizeFailure: produces typed error + digest", () => {
    const cmd: AdcosCommand = { tenantId: TENANT_A, deviceId: DEVICE_1, kind: "ping" };
    const r = normalizeFailure(cmd, { ok: false, reason: "rate-limited", degraded: true });
    expect(r.ok).toBe(false);
    expect(r.error.class).toBe("transient");
    expect(r.error.retryable).toBe(true);
    expect(r.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("digests are deterministic for identical inputs", () => {
    const cmd: AdcosCommand = { tenantId: TENANT_A, deviceId: DEVICE_1, kind: "ping" };
    const r1 = normalizeSuccess(cmd, { ok: true, result: { acknowledged: true, kind: "ping" }, requestId: "req_1" });
    const r2 = normalizeSuccess(cmd, { ok: true, result: { acknowledged: true, kind: "ping" }, requestId: "req_1" });
    expect(r1.ok && r2.ok && r1.digest).toBe(r2.digest);
  });

  it("digests differ for different inputs (requestId change)", () => {
    const cmd: AdcosCommand = { tenantId: TENANT_A, deviceId: DEVICE_1, kind: "ping" };
    const r1 = normalizeSuccess(cmd, { ok: true, result: {}, requestId: "req_1" });
    const r2 = normalizeSuccess(cmd, { ok: true, result: {}, requestId: "req_2" });
    expect(r1.ok && r2.ok && r1.digest).not.toBe(r2.digest);
  });
});

// ---------------------------------------------------------------------------
// EdgeAdcosAdapter — end-to-end retry behavior
// ---------------------------------------------------------------------------

describe("adcos edge-adapter: retry behavior", () => {
  it("succeeds on first attempt (no retries)", async () => {
    const provider = new ScriptedProvider(["ok"]);
    const adapter = new EdgeAdcosAdapter(provider);
    const r = await adapter.sendCommand(
      { tenantId: TENANT_A, deviceId: DEVICE_1, kind: "ping" },
      { now: NOW, sleep: noSleep },
    );
    expect(r.finalResult.ok).toBe(true);
    expect(r.attempts).toHaveLength(1);
    expect(r.attempts[0]!.ok).toBe(true);
    expect(r.attempts[0]!.backoffMs).toBe(0);
    expect(r.audit.intent).toBe("adcos:edge:send:ok");
  });

  it("retries transient failure then succeeds on attempt 2", async () => {
    const provider = new ScriptedProvider(["provider-unavailable", "ok"]);
    const adapter = new EdgeAdcosAdapter(provider);
    const r = await adapter.sendCommand(
      { tenantId: TENANT_A, deviceId: DEVICE_1, kind: "ping" },
      { now: NOW, sleep: noSleep },
    );
    expect(r.finalResult.ok).toBe(true);
    expect(r.attempts).toHaveLength(2);
    expect(r.attempts[0]!.ok).toBe(false);
    expect(r.attempts[0]!.code).toBe("provider-unavailable");
    expect(r.attempts[0]!.backoffMs).toBe(100); // attempt 1 -> 100ms backoff
    expect(r.attempts[1]!.ok).toBe(true);
  });

  it("rate-limited is retried (transient)", async () => {
    const provider = new ScriptedProvider(["rate-limited", "ok"]);
    const adapter = new EdgeAdcosAdapter(provider);
    const r = await adapter.sendCommand(
      { tenantId: TENANT_A, deviceId: DEVICE_1, kind: "ping" },
      { now: NOW, sleep: noSleep },
    );
    expect(r.finalResult.ok).toBe(true);
    expect(r.attempts).toHaveLength(2);
  });

  it("permanent failure (device-not-found) short-circuits — no retry", async () => {
    const provider = new ScriptedProvider(["device-not-found", "ok"]);
    const adapter = new EdgeAdcosAdapter(provider);
    const r = await adapter.sendCommand(
      { tenantId: TENANT_A, deviceId: DEVICE_1, kind: "ping" },
      { now: NOW, sleep: noSleep },
    );
    expect(r.finalResult.ok).toBe(false);
    if (!r.finalResult.ok) {
      expect(r.finalResult.error.code).toBe("device-not-found");
      expect(r.finalResult.error.class).toBe("permanent");
    }
    expect(r.attempts).toHaveLength(1); // never retried
    expect(r.audit.intent).toContain("device-not-found");
  });

  it("max-attempts exhausted on persistent transient -> final failure audit", async () => {
    const provider = new ScriptedProvider(["provider-unavailable", "provider-unavailable", "provider-unavailable"]);
    const adapter = new EdgeAdcosAdapter(provider);
    const r = await adapter.sendCommand(
      { tenantId: TENANT_A, deviceId: DEVICE_1, kind: "ping" },
      { now: NOW, sleep: noSleep },
    );
    expect(r.finalResult.ok).toBe(false);
    if (!r.finalResult.ok) {
      expect(r.finalResult.error.code).toBe("provider-unavailable");
    }
    expect(r.attempts).toHaveLength(3); // maxAttempts=3
    expect(r.audit.intent).toContain("provider-unavailable");
  });

  it("audit digest is stable for identical call sequences (deterministic)", async () => {
    const provider1 = new ScriptedProvider(["rate-limited", "ok"]);
    const provider2 = new ScriptedProvider(["rate-limited", "ok"]);
    const adapter1 = new EdgeAdcosAdapter(provider1);
    const adapter2 = new EdgeAdcosAdapter(provider2);
    const cmd: AdcosCommand = { tenantId: TENANT_A, deviceId: DEVICE_1, kind: "ping" };
    const r1 = await adapter1.sendCommand(cmd, { now: NOW, sleep: noSleep });
    const r2 = await adapter2.sendCommand(cmd, { now: NOW, sleep: noSleep });
    expect(r1.audit.digest).toBe(r2.audit.digest);
  });

  it("custom retry policy respected (maxAttempts=1 = no retries)", async () => {
    const provider = new ScriptedProvider(["rate-limited", "ok"]);
    const adapter = new EdgeAdcosAdapter(provider);
    const r = await adapter.sendCommand(
      { tenantId: TENANT_A, deviceId: DEVICE_1, kind: "ping" },
      {
        now: NOW,
        sleep: noSleep,
        policy: { maxAttempts: 1, baseDelayMs: 100, maxDelayMs: 5_000, backoffFactor: 2 },
      },
    );
    expect(r.finalResult.ok).toBe(false); // first attempt failed; no retry
    expect(r.attempts).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Edge health report — never exaggerates
// ---------------------------------------------------------------------------

describe("adcos edge-adapter: edge health report", () => {
  it("healthy base -> healthy edge", () => {
    const r = buildEdgeHealthReport(TENANT_A, DEVICE_1, "healthy", NOW);
    expect(r.edgePosture).toBe("healthy");
    expect(r.audit.intent).toBe("adcos:edge:health:healthy");
  });

  it("degraded base -> degraded edge (no exaggeration)", () => {
    const r = buildEdgeHealthReport(TENANT_A, DEVICE_1, "degraded", NOW);
    expect(r.edgePosture).toBe("degraded");
  });

  it("unavailable base -> unavailable edge (no exaggeration)", () => {
    const r = buildEdgeHealthReport(TENANT_A, DEVICE_1, "unavailable", NOW);
    expect(r.edgePosture).toBe("unavailable");
  });

  it("audit digest is stable for identical inputs", () => {
    const r1 = buildEdgeHealthReport(TENANT_A, DEVICE_1, "degraded", NOW);
    const r2 = buildEdgeHealthReport(TENANT_A, DEVICE_1, "degraded", NOW);
    expect(r1.audit.digest).toBe(r2.audit.digest);
  });

  it("tenant isolation: report is tenant-scoped (audit.tenant matches input)", () => {
    const r = buildEdgeHealthReport(TENANT_A, DEVICE_1, "healthy", NOW);
    expect(r.audit.tenant).toBe(TENANT_A);
    const r2 = buildEdgeHealthReport("tnt_other", DEVICE_1, "healthy", NOW);
    expect(r2.audit.tenant).toBe("tnt_other");
    expect(r.audit.digest).not.toBe(r2.audit.digest);
  });
});
