/**
 * @fleetos/adcos — Wave 5 adapter health tests (F250A).
 *
 * Covers: the circuit state machine (closed -> open -> half-open ->
 * closed / reopened) driven by logical time + observed failures; the
 * health rollup (healthy / degraded / unavailable + reason codes, honest
 * no-observations, integer-bps failure math, windowing); digest tamper.
 */

import { describe, it, expect } from "vitest";
import {
  circuitDispatchDecision,
  defaultAdapterCircuitConfig,
  defaultAdapterHealthConfig,
  emptyAdapterCircuit,
  evaluateAdapterCircuit,
  foldAdapterCircuit,
  foldAdapterCircuitAll,
  rollupAdapterHealth,
  sessionSummaryFromClasses,
  verifyAdapterHealthReport,
  type AdapterCircuitStatus,
} from "./health.js";

const NOW = 1_727_000_000_000;
const TENANT_A = "tnt_acme";
const CFG = defaultAdapterCircuitConfig(); // threshold 3, cooldown 60s

describe("adcos health: circuit state machine", () => {
  it("stays closed below the failure threshold", () => {
    let s = emptyAdapterCircuit();
    s = foldAdapterCircuit(s, { ok: false, at: NOW }, CFG);
    s = foldAdapterCircuit(s, { ok: false, at: NOW + 1 }, CFG);
    expect(s.state).toBe("closed");
    expect(s.consecutiveFailures).toBe(2);
  });

  it("opens on the Nth consecutive failure (recorded at logical time)", () => {
    let s = emptyAdapterCircuit();
    s = foldAdapterCircuit(s, { ok: false, at: NOW }, CFG);
    s = foldAdapterCircuit(s, { ok: false, at: NOW + 1 }, CFG);
    s = foldAdapterCircuit(s, { ok: false, at: NOW + 2 }, CFG);
    expect(s.state).toBe("open");
    expect(s.openedAt).toBe(NOW + 2);
    expect(s.lastTransitionAt).toBe(NOW + 2);
  });

  it("a success closes it and resets the failure count", () => {
    let s = emptyAdapterCircuit();
    s = foldAdapterCircuitAll([{ ok: false, at: NOW }, { ok: false, at: NOW + 1 }], CFG);
    s = foldAdapterCircuit(s, { ok: true, at: NOW + 2 }, CFG);
    expect(s.state).toBe("closed");
    expect(s.consecutiveFailures).toBe(0);
  });

  it("open stays open during cooldown; half-opens after it (logical time)", () => {
    let s = emptyAdapterCircuit();
    s = foldAdapterCircuitAll([{ ok: false, at: NOW }, { ok: false, at: NOW + 1 }, { ok: false, at: NOW + 2 }], CFG);
    expect(evaluateAdapterCircuit(s, NOW + 3, CFG).state).toBe("open"); // within cooldown
    const half = evaluateAdapterCircuit(s, NOW + 2 + 60_000, CFG);
    expect(half.state).toBe("half-open");
    // probe succeeds -> closed
    const closed = foldAdapterCircuit(half, { ok: true, at: NOW + 2 + 61_000 }, CFG);
    expect(closed.state).toBe("closed");
  });

  it("a failed half-open probe reopens the circuit", () => {
    let s = emptyAdapterCircuit();
    s = foldAdapterCircuitAll([{ ok: false, at: NOW }, { ok: false, at: NOW + 1 }, { ok: false, at: NOW + 2 }], CFG);
    const half = evaluateAdapterCircuit(s, NOW + 2 + CFG.cooldownMs, CFG);
    const reopened = foldAdapterCircuit(half, { ok: false, at: NOW + 2 + CFG.cooldownMs + 1 }, CFG);
    expect(reopened.state).toBe("open");
    expect(reopened.openedAt).toBe(NOW + 2 + CFG.cooldownMs + 1);
  });

  it("dispatch decision is fail-closed while open, allowed while closed/half-open", () => {
    const closed: AdapterCircuitStatus = { state: "closed", consecutiveFailures: 0, consecutiveSuccesses: 1, openedAt: null, lastTransitionAt: null };
    expect(circuitDispatchDecision(closed).ok).toBe(true);
    const open: AdapterCircuitStatus = { ...closed, state: "open", openedAt: NOW };
    expect(circuitDispatchDecision(open)).toMatchObject({ ok: false, reason: "circuit-open" });
  });
});

describe("adcos health: rollup", () => {
  const cleanSessions = sessionSummaryFromClasses(["fresh", "fresh", "stale"]);

  it("healthy when outcomes succeed, sessions fresh, postures connected", () => {
    const r = rollupAdapterHealth({
      tenantId: TENANT_A, now: NOW,
      commandOutcomes: [{ ok: true, at: NOW - 10 }, { ok: true, at: NOW - 20 }],
      sessionSummary: sessionSummaryFromClasses(["fresh"]),
      postureSignals: ["connected"],
    }, emptyAdapterCircuit());
    expect(r.status).toBe("healthy");
    expect(r.reasons).toEqual([]);
    expect(r.commandStats).toEqual({ total: 2, failures: 0, failureBps: 0 });
  });

  it("no observations at all is degraded + no-observations (never healthy)", () => {
    const r = rollupAdapterHealth({
      tenantId: TENANT_A, now: NOW,
      commandOutcomes: [],
      sessionSummary: sessionSummaryFromClasses([]),
      postureSignals: [],
    }, emptyAdapterCircuit());
    expect(r.status).toBe("degraded");
    expect(r.reasons).toContain("no-observations");
  });

  it("failure ratio drives degraded then unavailable (integer bps)", () => {
    const outcomes = [
      { ok: true, at: NOW - 1 },
      { ok: false, at: NOW - 2 },
      { ok: false, at: NOW - 3 },
      { ok: false, at: NOW - 4 },
      { ok: false, at: NOW - 5 },
    ]; // 4/5 failures = 8000 bps
    const cfg = defaultAdapterHealthConfig();
    const r = rollupAdapterHealth({
      tenantId: TENANT_A, now: NOW, commandOutcomes: outcomes,
      sessionSummary: cleanSessions, postureSignals: ["connected"],
    }, emptyAdapterCircuit(), cfg);
    expect(r.commandStats).toEqual({ total: 5, failures: 4, failureBps: 8_000 });
    expect(r.status).toBe("unavailable");
    expect(r.reasons).toContain("failure-ratio-unavailable");

    const mild = rollupAdapterHealth({
      tenantId: TENANT_A, now: NOW,
      commandOutcomes: [{ ok: true, at: NOW - 1 }, { ok: false, at: NOW - 2 }, { ok: true, at: NOW - 3 }, { ok: true, at: NOW - 4 }],
      sessionSummary: cleanSessions, postureSignals: ["connected"],
    }, emptyAdapterCircuit(), cfg);
    expect(mild.status).toBe("degraded"); // 2500 bps >= 2000 degraded threshold
    expect(mild.reasons).toContain("failure-ratio-degraded");
  });

  it("outcomes older than the window are ignored (logical windowing)", () => {
    const r = rollupAdapterHealth({
      tenantId: TENANT_A, now: NOW,
      commandOutcomes: [{ ok: false, at: NOW - 400_000 }, { ok: false, at: NOW - 500_000 }],
      sessionSummary: cleanSessions, postureSignals: ["connected"],
    }, emptyAdapterCircuit());
    expect(r.commandStats.total).toBe(0); // both outside the 300s window
    expect(r.status).not.toBe("unavailable");
  });

  it("open circuit forces unavailable; half-open is degraded", () => {
    const openCircuit = foldAdapterCircuitAll(
      [{ ok: false, at: NOW - 3 }, { ok: false, at: NOW - 2 }, { ok: false, at: NOW - 1 }],
      CFG,
    );
    const r = rollupAdapterHealth({
      tenantId: TENANT_A, now: NOW,
      commandOutcomes: [{ ok: true, at: NOW - 1 }],
      sessionSummary: cleanSessions, postureSignals: ["connected"],
    }, openCircuit);
    expect(r.status).toBe("unavailable");
    expect(r.reasons).toContain("circuit-open");

    const half = evaluateAdapterCircuit(openCircuit, NOW - 1 + CFG.cooldownMs, CFG);
    const r2 = rollupAdapterHealth({
      tenantId: TENANT_A, now: NOW,
      commandOutcomes: [{ ok: true, at: NOW - 1 }],
      sessionSummary: cleanSessions, postureSignals: ["connected"],
    }, half);
    expect(r2.status).toBe("degraded");
    expect(r2.reasons).toContain("circuit-half-open");
  });

  it("expired/stale sessions and degraded/offline postures degrade (honest)", () => {
    const r = rollupAdapterHealth({
      tenantId: TENANT_A, now: NOW,
      commandOutcomes: [{ ok: true, at: NOW - 1 }],
      sessionSummary: sessionSummaryFromClasses(["fresh", "expired", "stale", "revoked"]),
      postureSignals: ["connected", "offline"],
    }, emptyAdapterCircuit());
    expect(r.status).toBe("degraded");
    expect(r.reasons).toContain("sessions-expired");
    expect(r.reasons).toContain("sessions-stale");
    expect(r.reasons).toContain("posture-offline");

    const degradedPosture = rollupAdapterHealth({
      tenantId: TENANT_A, now: NOW,
      commandOutcomes: [{ ok: true, at: NOW - 1 }],
      sessionSummary: cleanSessions, postureSignals: ["degraded"],
    }, emptyAdapterCircuit());
    expect(degradedPosture.reasons).toContain("posture-degraded");
  });

  it("digest verifies and detects tampering", () => {
    const r = rollupAdapterHealth({
      tenantId: TENANT_A, now: NOW,
      commandOutcomes: [{ ok: true, at: NOW - 1 }],
      sessionSummary: cleanSessions, postureSignals: ["connected"],
    }, emptyAdapterCircuit());
    expect(verifyAdapterHealthReport(r)).toBe(true);
    expect(verifyAdapterHealthReport({ ...r, status: "healthy" as const })).toBe(false);
    expect(verifyAdapterHealthReport({ ...r, commandStats: { total: 9, failures: 0, failureBps: 0 } })).toBe(false);
  });

  it("sessionSummaryFromClasses counts active vs terminal states", () => {
    expect(sessionSummaryFromClasses(["fresh", "stale", "expired", "revoked"])).toEqual({
      active: 2, fresh: 1, stale: 1, expired: 1, revoked: 1,
    });
  });

  it("audit ref is tenant-scoped and deterministic", () => {
    const input = {
      tenantId: TENANT_A, now: NOW,
      commandOutcomes: [{ ok: true, at: NOW - 1 }],
      sessionSummary: sessionSummaryFromClasses(["fresh"]), postureSignals: ["connected"] as const,
    };
    const a = rollupAdapterHealth(input, emptyAdapterCircuit());
    const b = rollupAdapterHealth(input, emptyAdapterCircuit());
    expect(a.audit).toEqual(b.audit);
    expect(a.audit.tenant).toBe(TENANT_A);
    expect(a.audit.intent).toBe("adcos:health:healthy");
  });
});
