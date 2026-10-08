/**
 * F260B — replay-harness tests: deterministic step-by-step replay through the
 * REAL reference model, checkpoint resume at any seq, digests, tenant
 * fail-closed, the ModelPort seam.
 */
import { describe, it, expect } from "vitest";
import type { ModelPort, ProjectionResult } from "@fleetos/predictive";
import { checkpointWorld } from "@fleetos/world-model";
import { replayJournal, resumeReplay, isReplayRun } from "../src/replay-harness.ts";
import {
  INVOCATION,
  OTHER_TENANT,
  TENANT,
  standardJournal,
  steepCase,
} from "./benchmark-fixtures.ts";

function replayStandard() {
  return replayJournal({ tenant: TENANT, entityId: "e1", journal: standardJournal(), invocation: INVOCATION });
}

describe("replayJournal: deterministic step-by-step replay", () => {
  it("replays every journal seq in order with the REAL reference model", () => {
    const res = replayStandard();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.run.steps.map((s) => s.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(res.run.portName).toBe("reference.twin.linear-drift");
    expect(res.run.portModelVersion).toBe(INVOCATION.modelVersion);
    expect(res.run.journalLength).toBe(6);
    expect(res.run.fromSeq).toBe(1);
    expect(res.run.toSeq).toBe(6);
    expect(res.run.journalHeadDigest).toBe(standardJournal()[5]?.digest);
  });

  it("collects per-step predictions with the model's own provenance + uncertainty", () => {
    const res = replayStandard();
    if (!res.ok) return;
    for (const step of res.run.steps) {
      if (step.seq === 1) {
        // Registration-only prefix: no observations yet — honest rejection.
        expect(step.outcome.ok).toBe(false);
        if (!step.outcome.ok) expect(step.outcome.rejected).toBe("empty-history");
        continue;
      }
      expect(step.outcome.ok).toBe(true);
      if (step.outcome.ok) {
        expect(step.outcome.prediction.advisory).toBe(true);
        expect(step.outcome.prediction.points.length).toBe(3);
        expect(step.inputDigest).toBe(step.outcome.prediction.provenance.inputDigest);
        for (const p of step.outcome.prediction.points) {
          expect(p.bounds.lower).toBeLessThanOrEqual(p.bounds.upper);
          expect(p.confidenceBps).toBeGreaterThanOrEqual(0);
          expect(p.confidenceBps).toBeLessThanOrEqual(10000);
        }
      }
    }
    // The linear series (10,20,30) projects 40/50/60 at the journal head.
    const head = res.run.steps[5];
    expect(head?.outcome.ok).toBe(true);
    if (head?.outcome.ok) {
      expect(head.outcome.prediction.points.map((p) => p.value)).toEqual([40, 50, 60]);
      expect(head.outcome.prediction.points.map((p) => p.atMs)).toEqual([701_000, 702_000, 703_000]);
    }
  });

  it("records per-step observation counts + last-observed times (staleness inputs)", () => {
    const res = replayStandard();
    if (!res.ok) return;
    expect(res.run.steps.map((s) => s.observationCount)).toEqual([0, 1, 2, 3, 3, 3]);
    expect(res.run.steps[4]?.lastObservedAtMs).toBe(3000);
    expect(res.run.steps[4]?.atMs).toBe(40_000);
  });

  it("re-replay is byte-identical (same replayDigest)", () => {
    const a = replayStandard();
    const b = replayStandard();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    if (a.ok && b.ok) expect(a.run.replayDigest).toBe(b.run.replayDigest);
  });

  it("different journals produce different replay digests", () => {
    const a = replayStandard();
    const b = replayJournal({ tenant: TENANT, entityId: "e3", journal: steepCase().journal, invocation: INVOCATION });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.run.replayDigest).not.toBe(b.run.replayDigest);
  });

  it("is tenant fail-closed and validates the invocation", () => {
    expect(replayJournal({ tenant: { tenantId: "" }, entityId: "e1", journal: standardJournal(), invocation: INVOCATION }))
      .toMatchObject({ ok: false, rejected: "missing-tenant" });
    expect(replayJournal({ tenant: TENANT, entityId: "", journal: standardJournal(), invocation: INVOCATION }))
      .toMatchObject({ ok: false, rejected: "missing-entity" });
    expect(replayJournal({ tenant: TENANT, entityId: "e1", journal: standardJournal(), invocation: { ...INVOCATION, metric: "" } }))
      .toMatchObject({ ok: false, rejected: "invalid-invocation" });
    const tampered = standardJournal().map((e, i) => (i === 3 ? { ...e, digest: "badbad" } : e));
    expect(replayJournal({ tenant: TENANT, entityId: "e1", journal: tampered, invocation: INVOCATION }))
      .toMatchObject({ ok: false, rejected: "journal-invalid" });
  });

  it("fails closed when the port version differs from the pinned model (seam check)", () => {
    const stub: ModelPort = {
      name: "stub.port",
      modelVersion: "stub-9.9.9",
      project: () => ({ ok: false, rejected: "invalid-horizon", detail: "stub" }),
      runCounterfactual: () => ({ ok: false, rejected: "invalid-horizon", detail: "stub" }),
    };
    expect(replayJournal({ tenant: TENANT, entityId: "e1", journal: standardJournal(), invocation: INVOCATION, port: stub }))
      .toMatchObject({ ok: false, rejected: "model-version-mismatch" });
  });

  it("drives predictions through a caller-supplied ModelPort (REAL seam)", () => {
    const stub: ModelPort = {
      name: "stub.port",
      modelVersion: INVOCATION.modelVersion,
      project: (input, horizon): ProjectionResult => ({
        ok: true,
        prediction: {
          kind: "PREDICTION",
          advisory: true,
          tenant: input.tenant,
          asset: input.asset,
          metric: input.metric,
          originMs: input.asOfMs,
          horizon,
          points: [{ step: 1, atMs: input.asOfMs + horizon.stepMs, value: 1, bounds: { lower: 0, upper: 2 }, confidenceBps: 9000 }],
          provenance: { modelVersion: INVOCATION.modelVersion, method: "reference.linear-drift", observationRefs: input.observations.map((o) => o.observationRef), inputDigest: "stub-digest" },
        },
      }),
      runCounterfactual: () => ({ ok: false, rejected: "invalid-horizon", detail: "stub" }),
    };
    const res = replayJournal({ tenant: TENANT, entityId: "e1", journal: standardJournal(), invocation: INVOCATION, port: stub });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.run.portName).toBe("stub.port");
    for (const step of res.run.steps) {
      expect(step.outcome.ok).toBe(true);
      if (step.outcome.ok) expect(step.outcome.prediction.points.length).toBe(1);
    }
  });
});

describe("resumeReplay: checkpoint resume at any journal seq", () => {
  it("picks up identically at EVERY seq boundary (byte-identical suffix steps)", () => {
    const full = replayStandard();
    expect(full.ok).toBe(true);
    if (!full.ok) return;
    const journal = standardJournal();
    for (let k = 0; k <= journal.length; k += 1) {
      const cp = checkpointWorld(journal, k);
      expect(cp.ok).toBe(true);
      if (!cp.ok) return;
      const resumed = resumeReplay({
        checkpoint: cp.checkpoint, suffix: journal.slice(k), tenant: TENANT,
        entityId: "e1", invocation: INVOCATION,
      });
      expect(resumed.ok).toBe(true);
      if (!resumed.ok) continue;
      expect(JSON.stringify(resumed.run.steps)).toBe(JSON.stringify(full.run.steps.slice(k)));
      expect(resumed.run.journalLength).toBe(full.run.journalLength);
      expect(resumed.run.journalHeadDigest).toBe(full.run.journalHeadDigest);
    }
  });

  it("rejects a suffix that does not link to the checkpoint (replay-state-error)", () => {
    const journal = standardJournal();
    const cp = checkpointWorld(journal, 3);
    expect(cp.ok).toBe(true);
    if (!cp.ok) return;
    const mismatched = resumeReplay({
      checkpoint: cp.checkpoint, suffix: journal.slice(2), tenant: TENANT,
      entityId: "e1", invocation: INVOCATION,
    });
    expect(mismatched).toMatchObject({ ok: false, rejected: "replay-state-error" });
  });

  it("is tenant fail-closed (checkpoint of another tenant rejected)", () => {
    const foreign = [...standardJournal()];
    const cp = checkpointWorld(foreign, 3);
    expect(cp.ok).toBe(true);
    if (!cp.ok) return;
    expect(resumeReplay({ checkpoint: cp.checkpoint, suffix: foreign.slice(3), tenant: OTHER_TENANT, entityId: "e1", invocation: INVOCATION }))
      .toMatchObject({ ok: false, rejected: "missing-tenant" });
  });
});

describe("ReplayRun: EXPERIMENTAL marker + runtime guard", () => {
  it("carries kind REPLAY + machine-carried experimental marker + advisory note", () => {
    const res = replayStandard();
    if (!res.ok) return;
    expect(res.run.kind).toBe("REPLAY");
    expect(res.run.experimental).toBe(true);
    expect(res.run.advisoryNote).toContain("NEVER OPERATIONAL TRUTH");
  });

  it("isReplayRun verifies the marker and rejects stripped/foreign copies", () => {
    const res = replayStandard();
    if (!res.ok) return;
    expect(isReplayRun(res.run)).toBe(true);
    expect(isReplayRun(JSON.parse(JSON.stringify(res.run)))).toBe(true);
    expect(isReplayRun({ ...res.run, experimental: false })).toBe(false);
    expect(isReplayRun({ kind: "EXPERIMENTAL" })).toBe(false);
    expect(isReplayRun(null)).toBe(false);
  });

  it("A11 compile-pin: a ReplayRun is not assignable to authoritative shapes", () => {
    const res = replayStandard();
    if (!res.ok) return;
    // @ts-expect-error — a replay is not a world journal entry (authoritative state)
    const _badJournal: { seq: number; digest: string; prevDigest: string | null } = res.run;
    // @ts-expect-error — a replay is not an OBSERVED value
    const _badObserved: { kind: "OBSERVED" } = res.run;
    void _badJournal; void _badObserved;
  });
});
