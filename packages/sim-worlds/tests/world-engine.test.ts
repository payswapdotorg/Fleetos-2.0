/**
 * @fleetos/sim-worlds — world engine tests (F260A).
 *
 * Determinism (same seed -> byte-identical journals), rate-driven step
 * transitions within seeded bounds, observation/health/maintenance event
 * shapes, pure-fold replay, checkpoint resume == full run, journal
 * verification + tamper, and tenant fail-closed refusals.
 */

import { describe, expect, it } from "vitest";
import {
  advanceWorldSteps,
  applyWorldEvent,
  checkpointWorldRun,
  foldWorldEvents,
  genesisWorldState,
  resumeWorldRun,
  runWorld,
  verifyWorldJournal,
} from "../src/world-engine.js";
import type { WorldEngineState, WorldEvent } from "../src/world-engine.js";
import type { FaultScenario } from "../src/fault-injection.js";
import { baseWorld, serializeState } from "./helpers.js";

function ok(r: ReturnType<typeof runWorld>): { state: WorldEngineState; events: WorldEvent[] } {
  if (!r.ok) throw new Error(`engine refused: ${String(r.reason)}`);
  return { state: r.state, events: [...r.events] };
}

describe("determinism — same world + seed => byte-identical journals", () => {
  it("replays identical journals at several lengths", () => {
    for (const steps of [1, 7, 50]) {
      const a = ok(runWorld(baseWorld(), steps));
      const b = ok(runWorld(baseWorld(), steps));
      expect(JSON.stringify(b.events)).toBe(JSON.stringify(a.events));
      expect(serializeState(b.state)).toBe(serializeState(a.state));
    }
  });

  it("a different seed produces a different journal", () => {
    const a = ok(runWorld(baseWorld(), 30));
    const b = ok(runWorld(baseWorld({ seed: "seed-beta" }), 30));
    expect(JSON.stringify(b.events)).not.toBe(JSON.stringify(a.events));
  });

  it("resumed runs are byte-identical to the full run (multiple split points)", () => {
    const full = ok(runWorld(baseWorld(), 12));
    for (const [first, second] of [[5, 7], [3, 9], [11, 1]] as const) {
      const part1 = ok(runWorld(baseWorld(), first));
      const part2 = ok(advanceWorldSteps(baseWorld(), part1.state, second));
      expect(JSON.stringify(part2.events)).toBe(JSON.stringify(full.events.slice(part1.events.length)));
      expect(serializeState(part2.state)).toBe(serializeState(full.state));
    }
  });
});

describe("the journal law — pure fold + checkpoint", () => {
  it("folding the emitted events reproduces the engine state byte-identically", () => {
    const run = ok(runWorld(baseWorld(), 15));
    const refolded = foldWorldEvents(baseWorld(), run.events);
    expect(serializeState(refolded)).toBe(serializeState(run.state));
  });

  it("checkpoint + suffix events resume to the same state (no replay)", () => {
    const full = ok(runWorld(baseWorld(), 10));
    const part = ok(runWorld(baseWorld(), 4));
    const cp = checkpointWorldRun(part.state);
    const suffix = full.events.filter((e) => e.seq > cp.foldedSeq);
    const resumed = resumeWorldRun(cp, suffix);
    expect(serializeState(resumed)).toBe(serializeState(full.state));
    expect(resumeWorldRun(cp, []).seq).toBe(part.state.seq);
  });

  it("applyWorldEvent ignores out-of-order seq (append-only)", () => {
    const run = ok(runWorld(baseWorld(), 3));
    const stale = run.events[0]!;
    const before = serializeState(run.state);
    const after = applyWorldEvent(run.state, stale);
    expect(serializeState(after)).toBe(before);
  });
});

describe("journal verification + tamper-evidence", () => {
  it("verifies a full run clean", () => {
    const run = ok(runWorld(baseWorld(), 15));
    expect(verifyWorldJournal(baseWorld(), run.events)).toEqual({ ok: true });
  });

  it("rejects a seq gap (out-of-order)", () => {
    const run = ok(runWorld(baseWorld(), 5));
    const dropped = run.events.filter((e) => e.seq !== 3);
    const v = verifyWorldJournal(baseWorld(), dropped);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.failures[0]).toMatchObject({ reason: "seq-out-of-order" });
  });

  it("rejects a tampered event field (digest chain broken)", () => {
    const run = ok(runWorld(baseWorld(), 5));
    const events = run.events.map((e) =>
      e.kind === "observation-emitted" ? { ...e, value: e.value + 999 } : e,
    );
    const v = verifyWorldJournal(baseWorld(), events);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.failures.some((f) => f.reason === "digest-chain-broken" || f.reason === "step-regression")).toBe(true);
  });

  it("emits exactly one step-advanced per step with strictly increasing seq", () => {
    const run = ok(runWorld(baseWorld(), 9));
    const markers = run.events.filter((e) => e.kind === "step-advanced");
    expect(markers).toHaveLength(9);
    run.events.forEach((e, i) => expect(e.seq).toBe(i + 1));
  });
});

describe("rate-driven step transitions (seeded bounds)", () => {
  it("a 10000 bps failure rate fails the asset at step 1 and it stays failed without maintenance", () => {
    const w = baseWorld({
      assets: [
        { assetId: "asset-alpha", assetClass: "pump", failureRateBps: 10_000 },
        { assetId: "asset-beta", assetClass: "vehicle", failureRateBps: 1 },
      ],
      maintenancePolicies: [],
    });
    const run = ok(runWorld(w, 6));
    const failures = run.events.filter((e) => e.kind === "asset-failed");
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ assetId: "asset-alpha", cause: "rate", step: 1 });
    expect(run.state.assets.get("asset-alpha")).toMatchObject({ operational: false, posture: "down" });
  });

  it("posture trajectory: critical on failure, down after downAfterSteps", () => {
    const w = baseWorld({
      assets: [
        { assetId: "asset-alpha", assetClass: "pump", failureRateBps: 10_000 },
        { assetId: "asset-beta", assetClass: "vehicle", failureRateBps: 1 },
      ],
      maintenancePolicies: [],
    });
    const run = ok(runWorld(w, 6));
    const postures = run.events
      .filter((e) => e.kind === "posture-changed" && e.assetId === "asset-alpha")
      .map((e) => (e as { to: string }).to);
    expect(postures).toEqual(["critical", "down"]);
  });

  it("links: 10000 bps uptime never drops; 3000 bps transitions within bounds", () => {
    const stable = ok(runWorld(baseWorld({ links: [{ linkId: "link-a1-b1", endpoints: ["dev-alpha-1", "dev-beta-1"], uptimeBps: 10_000 }] }), 20));
    expect(stable.events.filter((e) => e.kind === "link-down").length).toBe(0);

    const flaky = ok(runWorld(baseWorld({ links: [{ linkId: "link-a1-b1", endpoints: ["dev-alpha-1", "dev-beta-1"], uptimeBps: 3_000 }] }), 60));
    const downs = flaky.events.filter((e) => e.kind === "link-down").length;
    expect(downs).toBeGreaterThanOrEqual(1);
    expect(downs).toBeLessThanOrEqual(60);
  });

  it("fail + repair cycles recur while the rate stays 10000 bps (bounds)", () => {
    const w = baseWorld({
      assets: [
        { assetId: "asset-alpha", assetClass: "pump", failureRateBps: 10_000 },
        { assetId: "asset-beta", assetClass: "vehicle", failureRateBps: 1 },
      ],
      maintenancePolicies: [{
        policyId: "pol-alpha", assetId: "asset-alpha", windowEverySteps: 5,
        windowLengthSteps: 2, serviceLevel: "expedited", mtbfSteps: 100,
      }],
    });
    const run = ok(runWorld(w, 20));
    const failures = run.events.filter((e) => e.kind === "asset-failed").length;
    const repairs = run.events.filter((e) => e.kind === "maintenance-completed").length;
    expect(failures).toBeGreaterThanOrEqual(3);
    expect(repairs).toBeGreaterThanOrEqual(2);
  });
});

describe("observation emission — shapes compatible with the lane's inputs", () => {
  it("emits jittered streams with observedAt = step × timeUnitMs and monotonic seq", () => {
    const run = ok(runWorld(baseWorld(), 12));
    const obs = run.events.filter((e): e is Extract<WorldEvent, { kind: "observation-emitted" }> => e.kind === "observation-emitted");
    expect(obs.length).toBeGreaterThan(5);
    const perDevice = new Map<string, number>();
    for (const o of obs) {
      expect(o.observedAt).toBe(o.step * 1_000);
      expect(o.tenantId).toBe("tenant-a");
      if (o.streamKind === "temperature") expect(o.value).toBeGreaterThanOrEqual(38);
      if (o.streamKind === "temperature") expect(o.value).toBeLessThanOrEqual(42);
      if (o.streamKind === "pressure") {
        expect(o.value).toBeGreaterThanOrEqual(95);
        expect(o.value).toBeLessThanOrEqual(105);
      }
      const prev = perDevice.get(o.deviceId) ?? 0;
      expect(o.observationSeq).toBe(prev + 1);
      perDevice.set(o.deviceId, o.observationSeq);
    }
  });

  it("honors emitEverySteps and suppresses observations while the device is down", () => {
    const run = ok(runWorld(baseWorld(), 12));
    const obs = run.events.filter((e): e is Extract<WorldEvent, { kind: "observation-emitted" }> => e.kind === "observation-emitted");
    for (const o of obs) {
      if (o.deviceId === "dev-beta-1") expect(o.step % 2).toBe(0);
    }
    // dev-alpha-1 is under service at steps 6-7 (preventive) — no observations.
    expect(obs.some((o) => o.deviceId === "dev-alpha-1" && (o.step === 6 || o.step === 7))).toBe(false);
  });

  it("a 10000 bps dropout rate keeps the device down with no observations and a degraded posture", () => {
    const w = baseWorld({
      devices: [
        { deviceId: "dev-alpha-1", assetId: "asset-alpha", dropoutBps: 10_000, emitEverySteps: 1, streams: [{ kind: "temperature", unit: "C", baseValue: 40, jitterMinOffset: -2, jitterMaxOffset: 2 }] },
        { deviceId: "dev-beta-1", assetId: "asset-beta", dropoutBps: 1, emitEverySteps: 2, streams: [{ kind: "pressure", unit: "kPa", baseValue: 100, jitterMinOffset: -5, jitterMaxOffset: 5 }] },
      ],
      maintenancePolicies: [],
    });
    const run = ok(runWorld(w, 5));
    const alphaObs = run.events.filter((e) => e.kind === "observation-emitted" && (e as { deviceId: string }).deviceId === "dev-alpha-1");
    expect(alphaObs).toHaveLength(0);
    const down = run.events.filter((e) => e.kind === "device-down");
    expect(down.length).toBeGreaterThanOrEqual(1);
    expect(down[0]).toMatchObject({ deviceId: "dev-alpha-1", cause: "dropout" });
    expect(run.state.assets.get("asset-alpha")?.posture).toBe("degraded");
    expect(run.state.devices.get("dev-alpha-1")?.up).toBe(false);
  });
});

describe("maintenance — windows + MTBF scheduling + service levels", () => {
  it("MTBF preventive: due at mtbfSteps, started at the window, completed after repairSteps", () => {
    const run = ok(runWorld(baseWorld(), 12));
    const pol = run.events.filter((e) => "policyId" in e && e.policyId === "pol-alpha");
    expect(pol.map((e) => e.kind)).toEqual(["maintenance-due", "maintenance-started", "maintenance-completed"]);
    expect(pol[0]).toMatchObject({ step: 6, maintenanceKind: "preventive", scheduledForStep: 6 });
    expect(pol[1]).toMatchObject({ step: 6, maintenanceKind: "preventive", repairSteps: 2 });
    expect(pol[2]).toMatchObject({ step: 8, maintenanceKind: "preventive" });
  });

  it("preventive service puts the asset out of service (device down, degraded posture)", () => {
    const run = ok(runWorld(baseWorld(), 12));
    const downs = run.events.filter((e) => e.kind === "device-down" && (e as { deviceId: string }).deviceId === "dev-alpha-1");
    expect(downs[0]).toMatchObject({ cause: "service", step: 6 });
    const ups = run.events.filter((e) => e.kind === "device-up" && (e as { deviceId: string }).deviceId === "dev-alpha-1");
    expect(ups[0]).toMatchObject({ cause: "service-completed", step: 8 });
    const postures = run.events.filter((e) => e.kind === "posture-changed" && (e as { assetId: string }).assetId === "asset-alpha");
    expect(postures).toEqual([
      expect.objectContaining({ from: "healthy", to: "degraded", step: 6 }),
      expect.objectContaining({ from: "degraded", to: "healthy", step: 10 }),
    ]);
  });

  it("the service level decides steps-to-repair (expedited = 1 step)", () => {
    const w = baseWorld({
      maintenancePolicies: [{
        policyId: "pol-alpha", assetId: "asset-alpha", windowEverySteps: 5,
        windowLengthSteps: 2, serviceLevel: "expedited", mtbfSteps: 6,
      }],
    });
    const run = ok(runWorld(w, 8));
    const started = run.events.find((e) => e.kind === "maintenance-started");
    const completed = run.events.find((e) => e.kind === "maintenance-completed");
    expect(started).toMatchObject({ step: 6, repairSteps: 1 });
    expect(completed).toMatchObject({ step: 7 });
  });

  it("a failing asset is repaired at the next window (corrective lifecycle)", () => {
    const scenario: FaultScenario = {
      scenarioId: "scen-fail-2", worldId: "world-test", tenantId: "tenant-a",
      description: "asset-alpha fails at step 2",
      faults: [{ kind: "asset-failure", assetId: "asset-alpha", atStep: 2 }],
    };
    const run = ok(runWorld(baseWorld(), 10, scenario));
    const seq = run.events
      .filter((e) => e.kind === "asset-failed" || e.kind === "maintenance-due" || e.kind === "maintenance-started" || e.kind === "maintenance-completed")
      .map((e) => ({ kind: e.kind, step: e.step }));
    expect(seq).toEqual([
      { kind: "asset-failed", step: 2 },
      { kind: "maintenance-due", step: 2 },
      { kind: "maintenance-started", step: 5 },
      { kind: "maintenance-completed", step: 7 },
    ]);
    const due = run.events.find((e) => e.kind === "maintenance-due");
    expect(due).toMatchObject({ maintenanceKind: "corrective", scheduledForStep: 5 });
    expect(run.state.assets.get("asset-alpha")).toMatchObject({ operational: true, posture: "healthy" });
  });
});

describe("fail-closed engine entries", () => {
  it("refuses an invalid world", () => {
    const r = runWorld(baseWorld({ assets: [] }), 5);
    expect(r).toMatchObject({ ok: false, reason: "invalid-world" });
  });

  it("refuses negative or non-integer step counts", () => {
    expect(runWorld(baseWorld(), -1)).toMatchObject({ ok: false, reason: "invalid-step-count" });
    expect(runWorld(baseWorld(), 1.5)).toMatchObject({ ok: false, reason: "invalid-step-count" });
  });

  it("refuses a state from a different world or tenant", () => {
    const foreign = genesisWorldState(baseWorld({ worldId: "world-other" }));
    const r1 = advanceWorldSteps(baseWorld(), foreign, 3);
    expect(r1).toMatchObject({ ok: false, reason: "state-world-mismatch" });
    const foreignTenant = genesisWorldState(baseWorld({ tenantId: "tenant-b" }));
    const r2 = advanceWorldSteps(baseWorld(), foreignTenant, 3);
    expect(r2).toMatchObject({ ok: false, reason: "state-tenant-mismatch" });
  });

  it("refuses a cross-tenant scenario (fail-closed)", () => {
    const scenario: FaultScenario = {
      scenarioId: "scen-cross", worldId: "world-test", tenantId: "tenant-b",
      description: "cross-tenant", faults: [],
    };
    const r = runWorld(baseWorld(), 5, scenario);
    expect(r).toMatchObject({ ok: false, reason: "scenario-tenant-mismatch" });
  });
});
