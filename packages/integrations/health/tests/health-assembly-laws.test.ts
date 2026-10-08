/**
 * F251 health-assembly law tests — fail-closed tenancy (missing tenant,
 * tenant mismatch, lane refusal codes surfaced verbatim, tampered evidence)
 * and byte-identical determinism + digest verify/tamper.
 *
 * Split from health-assembly.test.ts (file-size law <= 400 lines).
 */

import { describe, expect, it } from "vitest";
import {
  assembleIntegrationHealth,
  verifyIntegrationHealthDigest,
  type IntegrationHealthState,
} from "../src/health-assembly.js";
import {
  apifyJournalWithJob,
  appliedAurumStore,
  arenaRequest,
  AURUM_SOURCE,
  healthyState,
  NOW,
  TENANT_B,
  vendorsSlice,
} from "./helpers.js";

describe("assembleIntegrationHealth — fail-closed tenancy (no partial assembly)", () => {
  it("missing tenant refuses", () => {
    const base = healthyState();
    const result = assembleIntegrationHealth({ ...base, tenantId: "" }, { now: NOW });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refused).toBe("missing-tenant");
  });

  it("invalid now refuses", () => {
    const result = assembleIntegrationHealth(healthyState(), { now: 0 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refused).toBe("invalid-now");
  });

  it("a foreign-tenant connectivity record refuses the WHOLE assembly (the lane would silently filter)", () => {
    const base = healthyState();
    const state: IntegrationHealthState = {
      ...base,
      connectivity: {
        ...base.connectivity,
        records: [
          ...base.connectivity.records,
          { tenantId: TENANT_B, deviceId: "dev_other", state: "online", observedAt: NOW - 1 },
        ],
      },
    };
    const result = assembleIntegrationHealth(state, { now: NOW });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refused).toBe("tenant-mismatch");
    expect(result.detail).toContain("connectivity.record:dev_other");
  });

  it("foreign-tenant aurum store / apify journal / vendors catalog / arena request each refuse", () => {
    for (const mutate of [
      (base: IntegrationHealthState): IntegrationHealthState => ({
        ...base,
        aurum: { store: appliedAurumStore(TENANT_B), snapshots: [], source: AURUM_SOURCE },
      }),
      (base: IntegrationHealthState): IntegrationHealthState => ({
        ...base,
        apify: { journal: apifyJournalWithJob(TENANT_B) },
      }),
      (base: IntegrationHealthState): IntegrationHealthState => ({
        ...base,
        vendors: vendorsSlice({ tenant: TENANT_B }).slice,
      }),
      (base: IntegrationHealthState): IntegrationHealthState => ({
        ...base,
        arena: { requests: [arenaRequest(TENANT_B)] },
      }),
    ] as const) {
      const state = mutate(healthyState());
      const result = assembleIntegrationHealth(state, { now: NOW });
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.refused).toBe("tenant-mismatch");
    }
  });

  it("lane refusals surface the lane code verbatim (aurum SOURCE_MISMATCH, learning no-evaluations)", () => {
    const base = healthyState();
    const sourceMismatch = assembleIntegrationHealth(
      { ...base, aurum: { ...base.aurum, source: "other-source" } },
      { now: NOW },
    );
    expect(sourceMismatch.ok).toBe(false);
    if (sourceMismatch.ok) return;
    expect(sourceMismatch.refused).toBe("aurum-refused");
    expect(sourceMismatch.laneCode).toBe("SOURCE_MISMATCH");

    const noEvaluations = assembleIntegrationHealth(
      { ...base, learning: { evaluations: [] } },
      { now: NOW },
    );
    expect(noEvaluations.ok).toBe(false);
    if (noEvaluations.ok) return;
    expect(noEvaluations.refused).toBe("learning-refused");
    expect(noEvaluations.laneCode).toBe("no-evaluations");
  });

  it("a broken apify run-journal chain refuses the assembly (tampered evidence)", () => {
    const base = healthyState();
    const events = base.apify.journal.events.map((entry, i) => (i === 1 ? { ...entry, digest: "tampered" } : entry));
    const state: IntegrationHealthState = {
      ...base,
      apify: { journal: { ...base.apify.journal, events } },
    };
    const result = assembleIntegrationHealth(state, { now: NOW });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refused).toBe("apify-refused");
    expect(result.laneCode).toBe("JOURNAL_CHAIN_BROKEN");
  });
});

describe("assembleIntegrationHealth — determinism + digests", () => {
  it("byte-identical for identical inputs (including the digest)", () => {
    const first = assembleIntegrationHealth(healthyState(), { now: NOW });
    const second = assembleIntegrationHealth(healthyState(), { now: NOW });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(JSON.stringify(first.view)).toBe(JSON.stringify(second.view));
  });

  it("input order-independence: reversed signals/snapshots/requests/outcomes yield the same digest", () => {
    const base = healthyState();
    const direct = assembleIntegrationHealth(base, { now: NOW });
    const reordered = assembleIntegrationHealth(
      {
        ...base,
        adcos: { ...base.adcos, postureSignals: [...base.adcos.postureSignals].reverse(), commandOutcomes: [...base.adcos.commandOutcomes].reverse() },
        aurum: { ...base.aurum, snapshots: [...base.aurum.snapshots].reverse() },
        arena: { ...base.arena, requests: [...base.arena.requests].reverse() },
      },
      { now: NOW },
    );
    expect(direct.ok && reordered.ok).toBe(true);
    if (!direct.ok || !reordered.ok) return;
    expect(reordered.view.digest).toBe(direct.view.digest);
  });

  it("tampering a presented section field fails digest verification", () => {
    const result = assembleIntegrationHealth(healthyState(), { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const tampered = {
      ...result.view,
      adcos: { ...result.view.adcos, status: "unavailable" as const },
    };
    expect(verifyIntegrationHealthDigest(tampered)).toBe(false);
  });

  it("tampering the top-level digest fails verification; section digests are chained", () => {
    const result = assembleIntegrationHealth(healthyState(), { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(verifyIntegrationHealthDigest({ ...result.view, digest: "health_deadbeef" })).toBe(false);
    expect(verifyIntegrationHealthDigest({ ...result.view, rollup: { ...result.view.rollup, status: "critical" } })).toBe(false);
  });
});
