/**
 * F251 convergence tests — the per-tenant convergence verdict (all four
 * classes over the two REAL reconciliation surfaces), the pure-proposal
 * repair queue (never executed), the projections-never-feed-back structural
 * law, fail-closed tenancy, digest verify + tamper, determinism.
 */

import { describe, expect, it } from "vitest";
import {
  computeReconciliationDiff,
  resolveReconciliation,
  type ReconcileRecord,
} from "@fleetos/adcos";
import { reconcileProjectionSet } from "@fleetos/aurum";
import {
  assembleConvergenceView,
  convergenceVerdictOf,
  verifyConvergenceDigest,
  type AdapterProjectionEntry,
  type ConvergenceInput,
  type ConvergenceSourceCounts,
  type DomainAuthoritativeRecord,
} from "../src/convergence.js";
import { AURUM_SOURCE, NOW, TENANT, TENANT_B, appliedAurumStore, aurumDelta, snapshotsOf } from "./helpers.js";

// ---------------------------------------------------------------------------
// Fixtures — the two REAL reconciliation surfaces.
// ---------------------------------------------------------------------------

function adcosRecords(pairs: readonly { readonly id: string; readonly digest: string }[], tenant: string = TENANT): ReconcileRecord[] {
  return pairs.map((p) => ({ id: p.id, digest: p.digest, tenantId: tenant }));
}

/** In-sync both sides: the same record on the adapter AND the twin. */
function convergedInput(): ConvergenceInput {
  const store = appliedAurumStore(TENANT, [aurumDelta("ext-001", 100)]);
  return {
    tenantId: TENANT,
    now: NOW,
    adcos: {
      adapterRecords: adcosRecords([{ id: "r-1", digest: "digest-a" }]),
      twinRecords: [{ id: "r-1", digest: "digest-a" }],
    },
    aurum: { store, snapshots: snapshotsOf(store), source: AURUM_SOURCE },
  };
}

function countsOf(adcos: { inSync: number; adapterAhead: number; twinAhead: number; conflict: number }, aurum: { matched: number; externalOnly: number; localOnly: number; divergent: number }): ConvergenceSourceCounts {
  return { adcos, aurum };
}

describe("assembleConvergenceView — the four verdicts (fixed classification ladder)", () => {
  it("in-sync on both surfaces → converged (no repair proposals, empty queue)", () => {
    const result = assembleConvergenceView(convergedInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.verdict).toBe("converged");
    expect(result.view.repairQueue).toEqual([]);
    expect(result.view.sources.adcos.outcome).toBe("in-sync");
    expect(result.view.sources.aurum.classification).toBe("in-sync");
  });

  it("adcos twin-ahead → adapter-lagging (the projection is behind the twin)", () => {
    const base = convergedInput();
    const result = assembleConvergenceView({
      ...base,
      adcos: { adapterRecords: [], twinRecords: [{ id: "r-1", digest: "digest-a" }] },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.verdict).toBe("adapter-lagging");
    expect(result.view.counts.adcos.twinAhead).toBe(1);
    expect(result.view.repairQueue.map((p) => [p.source, p.externalId, p.action, p.reasonCode])).toEqual([
      ["adcos", "r-1", "adopt-twin", "twin-ahead"],
    ]);
  });

  it("aurum external-only → adapter-lagging; aurum local-only → truth-lagging (lane vocabulary verbatim)", () => {
    const base = convergedInput();
    const external = assembleConvergenceView({
      ...base,
      aurum: {
        store: base.aurum.store,
        snapshots: [
          ...snapshotsOf(base.aurum.store),
          { externalId: "ext-new", payload: { status: "new" }, logicalTime: 200 },
        ],
        source: AURUM_SOURCE,
      },
    });
    expect(external.ok).toBe(true);
    if (!external.ok) return;
    expect(external.view.verdict).toBe("adapter-lagging");
    expect(external.view.repairQueue.map((p) => [p.source, p.action, p.reasonCode])).toEqual([
      ["aurum", "fetch-external", "EXTERNAL_AHEAD"],
    ]);

    const local = assembleConvergenceView({
      ...base,
      aurum: { store: base.aurum.store, snapshots: [], source: AURUM_SOURCE },
    });
    expect(local.ok).toBe(true);
    if (!local.ok) return;
    expect(local.view.verdict).toBe("truth-lagging");
    expect(local.view.repairQueue.map((p) => [p.source, p.action, p.reasonCode])).toEqual([
      ["aurum", "purge-local", "LOCAL_AHEAD"],
    ]);
  });

  it("adcos adapter-ahead → truth-lagging (the twin is behind the adapter observation)", () => {
    const base = convergedInput();
    const result = assembleConvergenceView({
      ...base,
      adcos: { adapterRecords: adcosRecords([{ id: "r-1", digest: "digest-a" }]), twinRecords: [] },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.verdict).toBe("truth-lagging");
    expect(result.view.counts.adcos.adapterAhead).toBe(1);
    expect(result.view.repairQueue.map((p) => [p.source, p.externalId, p.action, p.reasonCode])).toEqual([
      ["adcos", "r-1", "drop-adapter", "adapter-ahead"],
    ]);
  });

  it("conflict / divergence / both-directions-lagging → diverged", () => {
    const base = convergedInput();
    // adcos conflict: same id, different digests.
    const conflict = assembleConvergenceView({
      ...base,
      adcos: {
        adapterRecords: adcosRecords([{ id: "r-1", digest: "digest-a" }]),
        twinRecords: [{ id: "r-1", digest: "digest-B" }],
      },
    });
    expect(conflict.ok).toBe(true);
    if (!conflict.ok) return;
    expect(conflict.view.verdict).toBe("diverged");
    expect(conflict.view.sources.adcos.outcome).toBe("conflict");
    expect(conflict.view.repairQueue.map((p) => [p.source, p.externalId, p.action, p.reasonCode])).toEqual([
      ["adcos", "r-1", "adopt-twin", "conflict"],
    ]);

    // aurum divergent: same external id, different payload.
    const divergent = assembleConvergenceView({
      ...base,
      aurum: {
        store: base.aurum.store,
        snapshots: [{ externalId: "ext-001", payload: { status: "DIFFERENT" }, logicalTime: 100 }],
        source: AURUM_SOURCE,
      },
    });
    expect(divergent.ok).toBe(true);
    if (!divergent.ok) return;
    expect(divergent.view.verdict).toBe("diverged");
    expect(divergent.view.repairQueue.map((p) => [p.source, p.action, p.reasonCode])).toEqual([
      ["aurum", "manual-review", "DIVERGED"],
    ]);

    // both directions lagging on the adcos surface.
    const both = assembleConvergenceView({
      ...base,
      adcos: {
        adapterRecords: adcosRecords([{ id: "r-1", digest: "digest-a" }]),
        twinRecords: [{ id: "r-2", digest: "digest-b" }],
      },
    });
    expect(both.ok).toBe(true);
    if (!both.ok) return;
    expect(both.view.verdict).toBe("diverged");
  });

  it("counts + source digests equal the DIRECT lane calls verbatim", () => {
    const input = convergedInput();
    const result = assembleConvergenceView(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const directDiff = computeReconciliationDiff({
      tenantId: TENANT,
      now: NOW,
      adapterRecords: input.adcos.adapterRecords,
      twinRecords: input.adcos.twinRecords,
    });
    expect(directDiff.ok).toBe(true);
    if (!directDiff.ok) return;
    expect(result.view.counts.adcos).toEqual(directDiff.diff.counts);
    expect(result.view.sources.adcos.digest).toBe(directDiff.diff.digest);
    expect(result.view.sources.adcos.outcome).toBe(directDiff.diff.outcome);

    const directAurum = reconcileProjectionSet(input.aurum.store, input.aurum.snapshots, AURUM_SOURCE, NOW);
    expect(directAurum.ok).toBe(true);
    if (!directAurum.ok) return;
    expect(result.view.counts.aurum).toEqual({
      matched: directAurum.report.matchedIds.length,
      externalOnly: directAurum.report.externalOnly.length,
      localOnly: directAurum.report.localOnly.length,
      divergent: directAurum.report.divergent.length,
    });
    expect(result.view.sources.aurum.digest).toBe(directAurum.report.digest);
  });
});

describe("assembleConvergenceView — repair proposals are PURE (never executed)", () => {
  it("every proposal is inert data: kind marker + composition-never-executes note + lane vocabulary", () => {
    const base = convergedInput();
    const result = assembleConvergenceView({
      ...base,
      adcos: {
        adapterRecords: adcosRecords([{ id: "r-1", digest: "digest-a" }]),
        twinRecords: [{ id: "r-1", digest: "digest-B" }, { id: "r-2", digest: "digest-b" }],
      },
      aurum: {
        store: base.aurum.store,
        snapshots: [{ externalId: "ext-001", payload: { status: "DIFFERENT" }, logicalTime: 100 }],
        source: AURUM_SOURCE,
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.repairQueue.length).toBeGreaterThan(0);
    for (const proposal of result.view.repairQueue) {
      expect(proposal.kind).toBe("convergence-repair-proposal");
      expect(proposal.note).toBe("composition-never-executes");
      expect(["adopt-twin", "drop-adapter", "fetch-external", "purge-local", "manual-review"]).toContain(proposal.action);
      expect(proposal.source === "adcos" || proposal.source === "aurum").toBe(true);
    }
  });

  it("the adcos plan actions carry the LANE's resolution plan verbatim (adopt-twin/drop-adapter)", () => {
    const adapterRecords = adcosRecords([{ id: "r-1", digest: "digest-a" }, { id: "r-3", digest: "digest-c" }]);
    const twinRecords = [{ id: "r-1", digest: "digest-a" }, { id: "r-2", digest: "digest-b" }];
    const base = convergedInput();
    const result = assembleConvergenceView({
      ...base,
      adcos: { adapterRecords, twinRecords },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const directDiff = computeReconciliationDiff({ tenantId: TENANT, now: NOW, adapterRecords, twinRecords });
    expect(directDiff.ok).toBe(true);
    if (!directDiff.ok) return;
    const directPlan = resolveReconciliation(directDiff.diff);
    expect(directPlan.actions.filter((a) => a.action !== "none").length).toBe(2);
    expect(result.view.repairQueue.filter((p) => p.source === "adcos").map((p) => [p.externalId, p.action])).toEqual(
      directPlan.actions.filter((a) => a.action !== "none").map((a) => [a.id, a.action]),
    );
  });

  it("STRUCTURAL LAW: an adapter projection entry can NEVER feed back as a domain-authoritative record", () => {
    const result = assembleConvergenceView(convergedInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const projection: AdapterProjectionEntry = {
      id: "ext-001",
      adapterDigest: "some-adapter-digest",
      source: "aurum",
    };
    // The authority brand is module-private: a projection entry (no brand,
    // no authoritative digest field) is not assignable to authority.
    // @ts-expect-error — AdapterProjectionEntry is missing [authoritativeBrand] + digest
    const authoritative: DomainAuthoritativeRecord = projection;
    expect((authoritative as unknown as Record<string, unknown>).id).toBe("ext-001");
    expect(Object.keys(projection)).not.toContain("digest"); // adapterDigest ≠ authoritative digest
  });
});

describe("assembleConvergenceView — fail-closed tenancy + refusals", () => {
  it("missing tenant and invalid now refuse", () => {
    const base = convergedInput();
    expect(assembleConvergenceView({ ...base, tenantId: "" }).ok).toBe(false);
    expect(assembleConvergenceView({ ...base, now: 0 }).ok).toBe(false);
  });

  it("a foreign-tenant aurum store or adcos adapter record refuses (no partial view)", () => {
    const base = convergedInput();
    const foreignStore = assembleConvergenceView({
      ...base,
      aurum: { store: appliedAurumStore(TENANT_B), snapshots: [], source: AURUM_SOURCE },
    });
    expect(foreignStore.ok).toBe(false);
    if (foreignStore.ok) return;
    expect(foreignStore.refused).toBe("tenant-mismatch");

    const foreignRecord = assembleConvergenceView({
      ...base,
      adcos: {
        adapterRecords: adcosRecords([{ id: "r-1", digest: "digest-a" }], TENANT_B),
        twinRecords: [{ id: "r-1", digest: "digest-a" }],
      },
    });
    expect(foreignRecord.ok).toBe(false);
    if (foreignRecord.ok) return;
    expect(foreignRecord.refused).toBe("tenant-mismatch");
  });

  it("lane refusals surface the lane code verbatim (aurum SOURCE_MISMATCH)", () => {
    const base = convergedInput();
    const result = assembleConvergenceView({ ...base, aurum: { ...base.aurum, source: "wrong-source" } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refused).toBe("aurum-refused");
    expect(result.laneCode).toBe("SOURCE_MISMATCH");
  });
});

describe("assembleConvergenceView — determinism + digests", () => {
  it("byte-identical for identical inputs; input order-independence (reversed records → same digest)", () => {
    const first = assembleConvergenceView(convergedInput());
    const second = assembleConvergenceView(convergedInput());
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(JSON.stringify(first.view)).toBe(JSON.stringify(second.view));

    const base = convergedInput();
    const reordered = assembleConvergenceView({
      ...base,
      adcos: {
        adapterRecords: [...base.adcos.adapterRecords].reverse(),
        twinRecords: [...base.adcos.twinRecords].reverse(),
      },
      aurum: { ...base.aurum, snapshots: [...base.aurum.snapshots].reverse() },
    });
    expect(reordered.ok).toBe(true);
    if (!reordered.ok) return;
    expect(reordered.view.digest).toBe(first.view.digest);
  });

  it("digest verify + tamper (verdict and counts are covered by the digest)", () => {
    const result = assembleConvergenceView(convergedInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(verifyConvergenceDigest(result.view)).toBe(true);
    expect(verifyConvergenceDigest({ ...result.view, verdict: "diverged" })).toBe(false);
    expect(verifyConvergenceDigest({ ...result.view, digest: "health_deadbeef" })).toBe(false);
    const tamperedCounts = {
      ...result.view,
      counts: { ...result.view.counts, adcos: { ...result.view.counts.adcos, inSync: 99 } },
    };
    expect(verifyConvergenceDigest(tamperedCounts)).toBe(false);
  });

  it("tampering the repair queue fails the digest (proposals are tamper-evident too)", () => {
    const base = convergedInput();
    const result = assembleConvergenceView({
      ...base,
      adcos: { adapterRecords: [], twinRecords: [{ id: "r-1", digest: "digest-a" }] },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.repairQueue.length).toBe(1);
    const tampered = {
      ...result.view,
      repairQueue: result.view.repairQueue.map((p) => ({ ...p, action: "drop-adapter" as const })),
    };
    expect(verifyConvergenceDigest(tampered)).toBe(false);
  });
});

describe("convergenceVerdictOf — the fixed ladder over counts alone", () => {
  it("all four classes + the both-directions diverged rule", () => {
    expect(convergenceVerdictOf(countsOf({ inSync: 2, adapterAhead: 0, twinAhead: 0, conflict: 0 }, { matched: 2, externalOnly: 0, localOnly: 0, divergent: 0 }))).toBe("converged");
    expect(convergenceVerdictOf(countsOf({ inSync: 1, adapterAhead: 0, twinAhead: 1, conflict: 0 }, { matched: 1, externalOnly: 0, localOnly: 0, divergent: 0 }))).toBe("adapter-lagging");
    expect(convergenceVerdictOf(countsOf({ inSync: 1, adapterAhead: 0, twinAhead: 0, conflict: 0 }, { matched: 1, externalOnly: 1, localOnly: 0, divergent: 0 }))).toBe("adapter-lagging");
    expect(convergenceVerdictOf(countsOf({ inSync: 1, adapterAhead: 1, twinAhead: 0, conflict: 0 }, { matched: 1, externalOnly: 0, localOnly: 0, divergent: 0 }))).toBe("truth-lagging");
    expect(convergenceVerdictOf(countsOf({ inSync: 1, adapterAhead: 0, twinAhead: 0, conflict: 0 }, { matched: 1, externalOnly: 0, localOnly: 1, divergent: 0 }))).toBe("truth-lagging");
    expect(convergenceVerdictOf(countsOf({ inSync: 0, adapterAhead: 0, twinAhead: 0, conflict: 1 }, { matched: 1, externalOnly: 0, localOnly: 0, divergent: 0 }))).toBe("diverged");
    expect(convergenceVerdictOf(countsOf({ inSync: 1, adapterAhead: 0, twinAhead: 0, conflict: 0 }, { matched: 0, externalOnly: 0, localOnly: 0, divergent: 1 }))).toBe("diverged");
    expect(convergenceVerdictOf(countsOf({ inSync: 0, adapterAhead: 1, twinAhead: 1, conflict: 0 }, { matched: 1, externalOnly: 0, localOnly: 0, divergent: 0 }))).toBe("diverged");
    expect(convergenceVerdictOf(countsOf({ inSync: 0, adapterAhead: 0, twinAhead: 0, conflict: 0 }, { matched: 0, externalOnly: 1, localOnly: 1, divergent: 0 }))).toBe("diverged");
  });
});
