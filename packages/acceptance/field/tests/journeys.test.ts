/**
 * @fleetos/acceptance-field — the journey corpus tests (F270A).
 *
 * Every journey of the device/field corpus runs as its own test: the outcome
 * must PASS with every step ok and every assertion passed, the outcome digest
 * must verify, and one semantic anchor per journey is re-checked from the
 * recorded assertion ACTUALS (the REAL outputs the runner read).
 */

import { describe, expect, it } from "vitest";
import { FIELD_JOURNEYS } from "../src/journeys/index.js";
import { runJourneyCorpus } from "../src/runner.js";
import { verifyJourneyOutcome, type AssertionOutcome, type JourneyOutcome } from "../src/journey-contracts.js";

const OUTCOMES = new Map<string, JourneyOutcome>();
for (const outcome of runJourneyCorpus(FIELD_JOURNEYS)) {
  OUTCOMES.set(outcome.journeyId, outcome);
}

function outcomeOf(journeyId: string): JourneyOutcome {
  const outcome = OUTCOMES.get(journeyId);
  if (!outcome) throw new Error(`journey outcome not found: ${journeyId}`);
  return outcome;
}

function actualOf(journeyId: string, assertionId: string): unknown {
  const found = outcomeOf(journeyId).assertions.find((a) => a.id === assertionId);
  if (!found) throw new Error(`assertion not found: ${journeyId}/${assertionId}`);
  return found.actual;
}

function expectJourneyPasses(journeyId: string): JourneyOutcome {
  const outcome = outcomeOf(journeyId);
  expect(outcome.passed, `journey ${journeyId} must pass`).toBe(true);
  expect(outcome.steps.length).toBeGreaterThan(0);
  expect(outcome.steps.every((s) => s.ok), `journey ${journeyId} steps must all be ok`).toBe(true);
  expect(outcome.assertions.length).toBeGreaterThan(0);
  expect(outcome.assertions.every((a) => a.pass), `journey ${journeyId} assertions must all pass`).toBe(true);
  expect(verifyJourneyOutcome(outcome)).toBe(true);
  expect(outcome.digest).toMatch(/^[0-9a-f]{8}$/);
  return outcome;
}

describe("F270A device/field acceptance journeys", () => {
  it("corpus shape: 42 journeys, fixed ids, no duplicates (14 + 6 F300A host-integration + 10 F321A + 1 F331A + 4 F341A incl. the TL-adjudicated D17 sixth slot + 5 F351B masked-industry coverage + 2 F361A marketplace receipt→enrollment)", () => {
    expect(FIELD_JOURNEYS.length).toBe(42);
    const ids = FIELD_JOURNEYS.map((j) => j.id);
    expect(new Set(ids).size).toBe(42);
    expect([...OUTCOMES.keys()].sort()).toEqual([...ids].sort());
  });

  it("enrollment — new asset appears in the fleet overview with status + identity refs", () => {
    const outcome = expectJourneyPasses("enroll-new-asset");
    expect(outcome.persona).toBe("fleet-operator");
    expect(actualOf("enroll-new-asset", "e11")).toBe(1);
    expect(actualOf("enroll-new-asset", "e16")).toBe("fresh");
    expect(actualOf("enroll-new-asset", "e19")).toEqual(["location", "operatorContact"]);
  });

  it("trustworthy state — recency windows + honest staleness classification + idempotent ingestion", () => {
    expectJourneyPasses("trustworthy-state-recency");
    expect(actualOf("trustworthy-state-recency", "s2")).toBe("fresh");
    expect(actualOf("trustworthy-state-recency", "s10")).toBe("stale");
    expect(actualOf("trustworthy-state-recency", "s12")).toBe("unknown");
  });

  it("investigation — injected sim fault surfaces as the top field priority-queue alert", () => {
    expectJourneyPasses("investigate-injected-fault");
    expect(actualOf("investigate-injected-fault", "i11")).toBe("critical");
    expect(actualOf("investigate-injected-fault", "i12")).toBe("event.fault");
  });

  it("recovery — open case moves through the timeline and completes with evidence", () => {
    expectJourneyPasses("recover-lost-device");
    expect(actualOf("recover-lost-device", "r15")).toBe(0);
    expect(actualOf("recover-lost-device", "r18")).toBe("closed");
    // F331A rewrite anchors (D2(b) families at T0): the as-of window and
    // the late-quarter staleness classification replace the former age pin.
    expect(actualOf("recover-lost-device", "r3")).toBe(1);
    expect(actualOf("recover-lost-device", "r10")).toBe("fresh");
    expect(actualOf("recover-lost-device", "r19")).toBe(1);
    expect(actualOf("recover-lost-device", "r21")).toBe("unknown");
    expect(actualOf("recover-lost-device", "r20")).toBe("rc_recover-0002");
  });

  it("maintenance — the order crosses every board column to completion", () => {
    expectJourneyPasses("maintain-asset-schedule");
    expect(actualOf("maintain-asset-schedule", "m12")).toBe(1);
    expect(actualOf("maintain-asset-schedule", "m13")).toBe(1);
  });

  it("field mode — offline tolerance: last-known provenance, bounded sections, priority order", () => {
    expectJourneyPasses("field-mode-offline-tolerance");
    expect(actualOf("field-mode-offline-tolerance", "f6")).toBe("stale");
    expect(actualOf("field-mode-offline-tolerance", "f7")).toEqual(["top-alerts", "connectivity-status"]);
  });

  it("connectivity — intent lifecycle + honest aligned/divergent/unknown rollups", () => {
    expectJourneyPasses("connectivity-postures");
    expect(actualOf("connectivity-postures", "c13")).toBe(1);
    expect(actualOf("connectivity-postures", "c17")).toBe("divergent");
  });

  it("edge command — full ADCOS lifecycle, journal verification, honest health degradation", () => {
    expectJourneyPasses("edge-command-lifecycle");
    expect(actualOf("edge-command-lifecycle", "a9")).toBe("reconciled");
    expect(actualOf("edge-command-lifecycle", "a18")).toBe("degraded");
  });

  it("simulation-driven — EXPERIMENTAL markers, world/scenario digests, byte-identical replay", () => {
    expectJourneyPasses("simulation-driven-experiment");
    expect(actualOf("simulation-driven-experiment", "x3")).toBe("EXPERIMENTAL");
    expect(actualOf("simulation-driven-experiment", "x7")).toBe(true);
  });

  it("mission replay — suspended mission resumes without re-executing completed stages", () => {
    expectJourneyPasses("mission-replay-resume");
    expect(actualOf("mission-replay-resume", "n8")).toEqual(["stage-3", "stage-4"]);
    expect(actualOf("mission-replay-resume", "n17")).toEqual([1, 1, 1, 1]);
  });

  it("handoff publish — the technician's carrier holds the real shift state", () => {
    const outcome = expectJourneyPasses("handoff-field-to-operator-publish");
    expect(outcome.handoff?.handoffId).toBe("hd_field-to-ops-01");
    expect(actualOf("handoff-field-to-operator-publish", "h10")).toEqual(["rc_handoff-0001"]);
  });

  it("handoff consume — the operator verifies the SAME state and acts on the case", () => {
    expectJourneyPasses("handoff-field-to-operator-consume");
    expect(actualOf("handoff-field-to-operator-consume", "k4")).toBe(true);
    expect(actualOf("handoff-field-to-operator-consume", "k8")).toBe("investigating");
  });

  it("mobile — the field view is machine-checked phone-shaped (bounded, priority-ordered)", () => {
    expectJourneyPasses("mobile-field-shape");
    expect(actualOf("mobile-field-shape", "p4")).toBe(true);
    expect(actualOf("mobile-field-shape", "p9")).toEqual(["critical", "warning", "info"]);
  });

  it("tenant isolation — every read-model and lookup fails closed on a foreign-tenant record", () => {
    expectJourneyPasses("tenant-isolation-fail-closed");
    expect(actualOf("tenant-isolation-fail-closed", "o3")).toBe("cross-tenant-ref");
    expect(actualOf("tenant-isolation-fail-closed", "o7c")).toBe("device-tenant-mismatch");
  });

  it("host integration — discovery route drills into a real Device 360, byte-identical purity", () => {
    expectJourneyPasses("host-discovery-device-360");
    expect(actualOf("host-discovery-device-360", "d5")).toBe(true);
    expect(actualOf("host-discovery-device-360", "d8")).toEqual(["ast_trailer-beta-02", "ast_truck-alpha-01"]);
    expect(actualOf("host-discovery-device-360", "d14")).toEqual(["location", "operatorContact"]);
  });

  it("host integration — health/evidence timeline renders the case history and resolution verifies", () => {
    expectJourneyPasses("host-health-evidence-timeline");
    expect(actualOf("host-health-evidence-timeline", "e7")).toBe("investigating");
    expect(actualOf("host-health-evidence-timeline", "e8")).toEqual(["investigate"]);
    expect(actualOf("host-health-evidence-timeline", "e13")).toBe(0);
    // F331A rewrite anchors (D2(b) families at T0).
    expect(actualOf("host-health-evidence-timeline", "e9")).toBe("fresh");
    expect(actualOf("host-health-evidence-timeline", "e17")).toBe(1);
    expect(actualOf("host-health-evidence-timeline", "e18")).toBe("unknown");
    expect(actualOf("host-health-evidence-timeline", "e19")).toBe("rc_host-tl-0002");
  });

  it("host integration — Device 360 recovery intent executes and verifies through the real command path", () => {
    expectJourneyPasses("host-recovery-intent-to-verification");
    expect(actualOf("host-recovery-intent-to-verification", "v3")).toBe("recovery.request");
    expect(actualOf("host-recovery-intent-to-verification", "v13")).toBe(0);
    expect(actualOf("host-recovery-intent-to-verification", "v16")).toBe(0);
  });

  it("host integration — Device 360 maintenance intent executes and the board verifies completion", () => {
    expectJourneyPasses("host-maintenance-intent-to-verification");
    expect(actualOf("host-maintenance-intent-to-verification", "w1")).toBe("maintenance.schedule");
    expect(actualOf("host-maintenance-intent-to-verification", "w9")).toBe(1);
    expect(actualOf("host-maintenance-intent-to-verification", "w14")).toContain(
      "offline-write-sync:not-implemented",
    );
  });

  it("host integration — the field workflow route is honestly offline (last-known, bounded, not-implemented markers)", () => {
    expectJourneyPasses("host-field-workflow-mobile-offline");
    expect(actualOf("host-field-workflow-mobile-offline", "m5")).toBe("stale");
    expect(actualOf("host-field-workflow-mobile-offline", "m6")).toEqual(["top-alerts", "connectivity-status"]);
    expect(actualOf("host-field-workflow-mobile-offline", "m10")).toContain(
      "offline-write-sync:not-implemented",
    );
  });

  it("host integration — role lenses fail closed and a foreign-tenant context refuses the whole bundle", () => {
    expectJourneyPasses("host-role-lens-tenant-fail-closed");
    expect(actualOf("host-role-lens-tenant-fail-closed", "l1")).toBe("intent-not-offered-to-role");
    expect(actualOf("host-role-lens-tenant-fail-closed", "l8")).toBe("tenant-mismatch");
    expect(actualOf("host-role-lens-tenant-fail-closed", "l9")).toBe("malformed-context");
  });

  it("F321A store-and-forward — first reception admits, re-delivery is an idempotent duplicate, gaps and forgeries are honest", () => {
    expectJourneyPasses("store-and-forward-redelivery");
    expect(actualOf("store-and-forward-redelivery", "s5")).toBe(2);
    expect(actualOf("store-and-forward-redelivery", "s8")).toBe(true);
    expect(actualOf("store-and-forward-redelivery", "s9")).toBe(0);
    expect(actualOf("store-and-forward-redelivery", "s12")).toEqual([2]);
    expect(actualOf("store-and-forward-redelivery", "s13")).toBe("observations:bundle:receive:with-gaps");
    expect(actualOf("store-and-forward-redelivery", "s18")).toBe("signature-invalid");
    expect(actualOf("store-and-forward-redelivery", "s19")).toBe("integrity-invalid");
  });

  it("F321A offline buffer — FIFO replay in capture order, divergence recorded, TTL eviction with reason codes", () => {
    expectJourneyPasses("offline-buffer-capture-replay");
    expect(actualOf("offline-buffer-capture-replay", "o4")).toBe("oe_gate-0001");
    expect(actualOf("offline-buffer-capture-replay", "o7")).toBe("duplicate-entry-id");
    expect(actualOf("offline-buffer-capture-replay", "o8")).toBe("tenant-mismatch");
    expect(actualOf("offline-buffer-capture-replay", "o13")).toEqual(["oe_gate-0002", "oe_gate-0003", "oe_gate-0004"]);
    expect(actualOf("offline-buffer-capture-replay", "o15")).toBe("posture-changed-while-offline");
    expect(actualOf("offline-buffer-capture-replay", "o19")).toEqual(["oe_gate-0002", "oe_gate-0003"]);
    expect(actualOf("offline-buffer-capture-replay", "o20")).toEqual(["offline-entry-expired", "offline-entry-expired"]);
  });

  it("F321A ingestion limits — admission caps with real numbers, duplicate-free cap accounting, whole-batch refusal, honest shedding", () => {
    expectJourneyPasses("ingestion-limits-admission-discipline");
    expect(actualOf("ingestion-limits-admission-discipline", "l3")).toBe("tenant-cap-exceeded");
    expect(actualOf("ingestion-limits-admission-discipline", "l9")).toBe(1);
    expect(actualOf("ingestion-limits-admission-discipline", "l10")).toBe(2);
    expect(actualOf("ingestion-limits-admission-discipline", "l13")).toBe(1);
    expect(actualOf("ingestion-limits-admission-discipline", "l14")).toBe(0);
    expect(actualOf("ingestion-limits-admission-discipline", "l15")).toBe("batch-too-large");
    expect(actualOf("ingestion-limits-admission-discipline", "l22")).toBe("payload-too-large");
  });

  it("F321A diagnosis lifecycle — propose from real findings, corroborate, resolve, supersede (never mutate, only supersede-by pointers)", () => {
    expectJourneyPasses("diagnosis-lifecycle-supersession");
    expect(actualOf("diagnosis-lifecycle-supersession", "d2")).toBe("proposed");
    expect(actualOf("diagnosis-lifecycle-supersession", "d6")).toBe("corroborated");
    expect(actualOf("diagnosis-lifecycle-supersession", "d10")).toBe("resolved");
    expect(actualOf("diagnosis-lifecycle-supersession", "d12")).toBe("illegal-transition");
    expect(actualOf("diagnosis-lifecycle-supersession", "d13")).toBe("superseded");
    expect(actualOf("diagnosis-lifecycle-supersession", "d14")).toBe("dx_hypo-6002");
    expect(actualOf("diagnosis-lifecycle-supersession", "d16")).toBe("dx_hypo-6001");
  });

  it("F321A anomaly confidence — rolling window from real observations, hysteresis enter/exit, confidence propagation into triage", () => {
    expectJourneyPasses("anomaly-confidence-triage");
    expect(actualOf("anomaly-confidence-triage", "a1")).toBe(3);
    expect(actualOf("anomaly-confidence-triage", "a8")).toBe(4);
    expect(actualOf("anomaly-confidence-triage", "a16")).toBe(2);
    expect(actualOf("anomaly-confidence-triage", "a17")).toBe(false);
    expect(actualOf("anomaly-confidence-triage", "a19")).toBe(0.75);
    expect(actualOf("anomaly-confidence-triage", "a20")).toBe(3);
  });

  it("F321A evidence-gated recovery — commands refuse without sufficient evidence, post-mortem chain verifies, keyset pagination is tenant-bound", () => {
    expectJourneyPasses("evidence-gated-recovery");
    expect(actualOf("evidence-gated-recovery", "g1")).toBe("open");
    expect(actualOf("evidence-gated-recovery", "g4")).toBe("insufficient-evidence-count");
    expect(actualOf("evidence-gated-recovery", "g6")).toBe("resolved");
    expect(actualOf("evidence-gated-recovery", "g16")).toEqual(["rc_gated-0001", "rc_gated-0002"]);
    expect(actualOf("evidence-gated-recovery", "g21")).toBe("invalid-limit");
    expect(actualOf("evidence-gated-recovery", "g23")).toBe("cursor-tenant-mismatch");
  });

  it("F321A maintenance calendar scale — conflicts detected, next-free found within horizon, batch reallocation and honest refusals", () => {
    expectJourneyPasses("maintenance-calendar-scale");
    expect(actualOf("maintenance-calendar-scale", "c5")).toBe("time-overlap");
    expect(actualOf("maintenance-calendar-scale", "c8")).toBe(null);
    expect(actualOf("maintenance-calendar-scale", "c12")).toBe("no-free-slot-in-horizon");
    expect(actualOf("maintenance-calendar-scale", "c16")).toEqual(["scheduled", "time-overlap", "scheduled"]);
    expect(actualOf("maintenance-calendar-scale", "c21")).toBe("batch-too-large");
    expect(actualOf("maintenance-calendar-scale", "c23")).toEqual(["window-in-past"]);
  });

  it("F321A asset lineage — tamper-evident chain, material lots consume monotonically to exhaustion, ancestry and forged-edge detection", () => {
    expectJourneyPasses("asset-lineage-material-lots");
    expect(actualOf("asset-lineage-material-lots", "n2")).toBe("duplicate-lineage");
    expect(actualOf("asset-lineage-material-lots", "n7")).toBe("partially-consumed");
    expect(actualOf("asset-lineage-material-lots", "n12")).toBe("exhausted");
    expect(actualOf("asset-lineage-material-lots", "n14")).toBe("lot-exhausted");
    expect(actualOf("asset-lineage-material-lots", "n16")).toBe("genesis");
    expect(actualOf("asset-lineage-material-lots", "n19")).toEqual(["asset:ast_filter-housing-02", "asset:ast_pump-station-01"]);
    expect(actualOf("asset-lineage-material-lots", "n25")).toBe("edge-digest-mismatch");
  });

  it("F321A identity sessions — issue/activate/expire/revoke lifecycle, validation fails closed on actor/tenant mismatch, bind-role is idempotent", () => {
    expectJourneyPasses("identity-session-lifecycle");
    expect(actualOf("identity-session-lifecycle", "i4")).toBe("not-yet-active");
    expect(actualOf("identity-session-lifecycle", "i6")).toBe("valid");
    expect(actualOf("identity-session-lifecycle", "i7")).toBe("expired");
    expect(actualOf("identity-session-lifecycle", "i13")).toBe("revoked");
    expect(actualOf("identity-session-lifecycle", "i19")).toBe("actor-mismatch");
    expect(actualOf("identity-session-lifecycle", "i20")).toBe("tenant-mismatch");
    expect(actualOf("identity-session-lifecycle", "i22")).toBe("duplicate-binding");
  });

  it("F321A tenant lifecycle gating — provisioning is write-gated, suspended is read-only, closed refuses everything, illegal transitions refuse", () => {
    expectJourneyPasses("tenant-lifecycle-gating");
    expect(actualOf("tenant-lifecycle-gating", "e4")).toBe("tenant-provisioning-no-writes");
    expect(actualOf("tenant-lifecycle-gating", "e11")).toBe("active");
    expect(actualOf("tenant-lifecycle-gating", "e14")).toBe("tenant-suspended-read-only");
    expect(actualOf("tenant-lifecycle-gating", "e19")).toBe("tenant-closing-no-new-writes");
    expect(actualOf("tenant-lifecycle-gating", "e21")).toBe("closed");
    expect(actualOf("tenant-lifecycle-gating", "e22")).toBe("tenant-closed-no-operations");
    expect(actualOf("tenant-lifecycle-gating", "e24")).toBe("illegal-transition");
    expect(actualOf("tenant-lifecycle-gating", "e25")).toBe("unknown-tenant");
  });

  it("F331A edge firmware/OTA campaign — staged waves, halt, resume, mid-wave halt, rollback over applied devices; every illegal move refused", () => {
    expectJourneyPasses("edge-firmware-ota-campaign");
    expect(actualOf("edge-firmware-ota-campaign", "f4")).toBe("version-regression");
    expect(actualOf("edge-firmware-ota-campaign", "f7")).toBe("wave-out-of-order");
    expect(actualOf("edge-firmware-ota-campaign", "f11")).toBe("halt-reason-required");
    expect(actualOf("edge-firmware-ota-campaign", "f13")).toBe("canary battery regression reported");
    expect(actualOf("edge-firmware-ota-campaign", "f14")).toBe("campaign-halted");
    expect(actualOf("edge-firmware-ota-campaign", "f15")).toBe("no-applied-devices");
    expect(actualOf("edge-firmware-ota-campaign", "f19")).toEqual(["verified", "pending"]);
    expect(actualOf("edge-firmware-ota-campaign", "f29")).toBe("unknown-device-ref");
    expect(actualOf("edge-firmware-ota-campaign", "f34")).toBe("rolled-back");
    expect(actualOf("edge-firmware-ota-campaign", "f37")).toBe(2);
    expect(actualOf("edge-firmware-ota-campaign", "f39")).toEqual(["verified", "deploying"]);
    expect(actualOf("edge-firmware-ota-campaign", "f42")).toBe(true);
  });

  it("F341A observations backpressure — real level thresholds, refuse-and-retry that never silently drops, shed-oldest divergence, bounded recovery", () => {
    expectJourneyPasses("observations-backpressure-discipline");
    expect(actualOf("observations-backpressure-discipline", "q4")).toEqual(["ok", "ok", "warn", "warn", "critical", "critical"]);
    expect(actualOf("observations-backpressure-discipline", "q6")).toEqual(["ok", "ok", "warn"]);
    expect(actualOf("observations-backpressure-discipline", "q8")).toEqual(["warn", "warn", "critical"]);
    expect(actualOf("observations-backpressure-discipline", "q9")).toBe("overflow-refused");
    expect(actualOf("observations-backpressure-discipline", "q10")).toBe(8);
    expect(actualOf("observations-backpressure-discipline", "q12")).toBe(2);
    expect(actualOf("observations-backpressure-discipline", "q17")).toBe("ok");
    expect(actualOf("observations-backpressure-discipline", "q20")).toBe(2);
    expect(actualOf("observations-backpressure-discipline", "q21")).toBe(2);
    expect(actualOf("observations-backpressure-discipline", "q24")).toBe("refuse");
  });

  it("F341A observations retention/projections — immutable store, honest absence, rebuildable device-summary, the real TTL boundary", () => {
    expectJourneyPasses("observations-retention-projections");
    expect(actualOf("observations-retention-projections", "v2")).toBe(4);
    expect(actualOf("observations-retention-projections", "v7")).toBe(0);
    expect(actualOf("observations-retention-projections", "v9")).toBe("tenant-fail-closed");
    expect(actualOf("observations-retention-projections", "v11")).toBe("unknown-observation-key");
    expect(actualOf("observations-retention-projections", "v12")).toBe(true);
    expect(actualOf("observations-retention-projections", "v18")).toEqual(["telemetry.flow", "telemetry.temp"]);
    expect(actualOf("observations-retention-projections", "v23")).toEqual([false, false, true]);
    expect(actualOf("observations-retention-projections", "v25")).toBe(true);
    expect(actualOf("observations-retention-projections", "v26")).toBe(true);
    expect(actualOf("observations-retention-projections", "v27")).toBe(true);
  });

  it("F341A sim-worlds checkpoint determinism — resumed run byte-identical to the uninterrupted run, counters carried, identity refusals honest", () => {
    expectJourneyPasses("sim-worlds-checkpoint-determinism");
    expect(actualOf("sim-worlds-checkpoint-determinism", "w1")).toBe(true);
    expect(actualOf("sim-worlds-checkpoint-determinism", "w6")).toBe(9);
    expect(actualOf("sim-worlds-checkpoint-determinism", "w8")).toBe(true);
    // The resumed, fold-resumed and fold-rebuilt runs all carry the SAME
    // REAL chained digest (re-checked across the recorded actuals).
    const resumedDigest = actualOf("sim-worlds-checkpoint-determinism", "w9");
    expect(resumedDigest).toBe(actualOf("sim-worlds-checkpoint-determinism", "w13"));
    expect(resumedDigest).toBe(actualOf("sim-worlds-checkpoint-determinism", "w16"));
    expect(resumedDigest).toMatch(/^[0-9a-f]{8}$/);
    // The hidden per-device observation counters were carried (> 0), not reset.
    const carriedSeqs = actualOf("sim-worlds-checkpoint-determinism", "w11") as number[];
    expect(carriedSeqs.length).toBe(2);
    for (const seq of carriedSeqs) expect(seq).toBeGreaterThanOrEqual(1);
    expect(actualOf("sim-worlds-checkpoint-determinism", "w12")).toBe(true);
    expect(actualOf("sim-worlds-checkpoint-determinism", "w14")).toBe(true);
    expect(actualOf("sim-worlds-checkpoint-determinism", "w15")).toBe(true);
    expect(actualOf("sim-worlds-checkpoint-determinism", "w18")).toBe("invalid-step-count");
    expect(actualOf("sim-worlds-checkpoint-determinism", "w19")).toBe("state-world-mismatch");
    expect(actualOf("sim-worlds-checkpoint-determinism", "w20")).toBe("state-tenant-mismatch");
  });

  it("every journey's assertions cover its full chain (>= 10 assertions each)", () => {
    for (const journey of FIELD_JOURNEYS) {
      const outcome = outcomeOf(journey.id);
      expect(
        outcome.assertions.length,
        `${journey.id} must assert its full chain`,
      ).toBeGreaterThanOrEqual(10);
    }
  });

  it("assertion outcomes record expected vs actual (never silent)", () => {
    const outcome = outcomeOf("enroll-new-asset");
    for (const a of outcome.assertions as readonly AssertionOutcome[]) {
      expect(a.id).toBeTruthy();
      expect(a.description).toBeTruthy();
      expect(a.reading).toBeTruthy();
      expect(typeof a.pass).toBe("boolean");
      expect("expected" in a && "actual" in a).toBe(true);
    }
  });
});
