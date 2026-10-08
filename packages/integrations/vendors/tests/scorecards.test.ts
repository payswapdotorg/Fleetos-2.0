/**
 * @fleetos/external-vendors — Wave 5 scorecards tests.
 *
 * Themes: metric ingestion with honest quarantine; KPI rollup aggregation
 * determinism (integer bps, weighted, floored); exclusion honesty (every
 * quarantined metric listed with its reason); trend classification;
 * digests + verify; revocation propagation; tenant fail-closed.
 */
import { describe, expect, it } from "vitest";
import {
  applyRevocationToMetrics,
  importCatalogBatch,
  ingestVendorMetrics,
  openVendorCatalog,
  openVerificationRegistry,
  revokeVerification,
  rollupVendorScorecards,
  verifyCapability,
  verifyScorecardDigest,
  type ExternalCatalogEntry,
  type MetricDraft,
  type TenantScope,
  type VendorCatalog,
  type VendorMetricRecord,
  type VerificationRegistry,
} from "../src/index.js";

const TENANT: TenantScope = { tenantId: "acme" };
const SOURCE = "vendor-hub";

function entry(externalId: string, capabilities = ["cold-chain"]): ExternalCatalogEntry {
  return { externalId, vendorExternalId: `vendor-${externalId}`, displayName: `Vendor ${externalId}`, capabilities, logicalTime: 10 };
}

function setup(): { catalog: VendorCatalog; registry: VerificationRegistry } {
  const opened = openVendorCatalog(TENANT, SOURCE);
  const registry = openVerificationRegistry(TENANT);
  if (!opened.ok || !registry.ok) throw new Error("setup failed");
  const imported = importCatalogBatch(opened.catalog, [entry("v-1"), entry("v-2")], 100);
  if (!imported.ok) throw new Error("import failed");
  return { catalog: imported.catalog, registry: registry.registry };
}

function verifiedSetup(): { catalog: VendorCatalog; registry: VerificationRegistry } {
  const base = setup();
  const verified = verifyCapability(base.catalog, base.registry, {
    tenant: TENANT,
    externalId: "v-1",
    capability: "cold-chain",
    evidence: { evidenceId: "ev-1", tenantId: "acme" },
    verifiedAt: 100,
    expiresAt: 100000,
  });
  if (!verified.ok) throw new Error("verify failed");
  return { catalog: verified.catalog, registry: verified.registry };
}

function draft(overrides: Partial<MetricDraft> = {}): MetricDraft {
  return {
    tenant: TENANT,
    metricId: "m-1",
    vendorExternalId: "v-1",
    metric: "on-time-delivery",
    window: "w-1",
    valueBps: 9000,
    weightBps: 10000,
    dependsOnCapability: null,
    ingestedAt: 200,
    ...overrides,
  };
}

describe("scorecards — ingestion with honest quarantine", () => {
  it("admits healthy metrics and quarantines unknown-vendor metrics with VENDOR_UNKNOWN", () => {
    const { catalog, registry } = setup();
    const result = ingestVendorMetrics([], catalog, registry, [draft(), draft({ metricId: "m-2", vendorExternalId: "ghost" })]);
    expect(result).toMatchObject({ ok: true, admitted: ["m-1"], quarantined: ["m-2"] });
    if (!result.ok) return;
    expect(result.metrics[1]?.quarantine).toEqual({ reasonCode: "VENDOR_UNKNOWN" });
  });

  it("quarantines capability-dependent metrics when the capability is not verified (CAPABILITY_NOT_VERIFIED)", () => {
    const { catalog, registry } = setup();
    const result = ingestVendorMetrics([], catalog, registry, [draft({ dependsOnCapability: "cold-chain" })]);
    expect(result).toMatchObject({ ok: true, quarantined: ["m-1"] });
    if (!result.ok) return;
    expect(result.metrics[0]?.quarantine).toEqual({ reasonCode: "CAPABILITY_NOT_VERIFIED" });
  });

  it("admits capability-dependent metrics once the capability is verified", () => {
    const { catalog, registry } = verifiedSetup();
    const result = ingestVendorMetrics([], catalog, registry, [draft({ dependsOnCapability: "cold-chain" })]);
    expect(result).toMatchObject({ ok: true, admitted: ["m-1"], quarantined: [] });
  });

  it("refuses structural failures atomically with typed codes (nothing ingested)", () => {
    const { catalog, registry } = setup();
    expect(ingestVendorMetrics([], catalog, registry, [])).toMatchObject({ ok: false, reasonCode: "EMPTY_BATCH" });
    expect(ingestVendorMetrics([], catalog, registry, [draft({ valueBps: 10001 })])).toMatchObject({ ok: false, reasonCode: "VALUE_BPS_OUT_OF_RANGE" });
    expect(ingestVendorMetrics([], catalog, registry, [draft({ weightBps: 0 })])).toMatchObject({ ok: false, reasonCode: "WEIGHT_BPS_OUT_OF_RANGE" });
    expect(ingestVendorMetrics([], catalog, registry, [draft({ metricId: " " })])).toMatchObject({ ok: false, reasonCode: "METRIC_ID_EMPTY" });
  });

  it("dedupes identical metric ids and refuses conflicting content (METRIC_ID_CONFLICT)", () => {
    const { catalog, registry } = setup();
    const first = ingestVendorMetrics([], catalog, registry, [draft()]);
    if (!first.ok) return;
    expect(ingestVendorMetrics(first.metrics, catalog, registry, [draft()])).toMatchObject({ ok: true, duplicatesSkipped: ["m-1"] });
    expect(ingestVendorMetrics(first.metrics, catalog, registry, [draft({ valueBps: 100 })])).toMatchObject({ ok: false, reasonCode: "METRIC_ID_CONFLICT" });
  });

  it("refuses cross-tenant drafts (TENANT_MISMATCH, nothing ingested)", () => {
    const { catalog, registry } = setup();
    const result = ingestVendorMetrics([], catalog, registry, [draft({ tenant: { tenantId: "other" } })]);
    expect(result).toMatchObject({ ok: false, reasonCode: "TENANT_MISMATCH" });
  });
});

describe("scorecards — rollup aggregation determinism + exclusion honesty", () => {
  function metrics(): readonly VendorMetricRecord[] {
    const { catalog, registry } = verifiedSetup();
    const result = ingestVendorMetrics([], catalog, registry, [
      draft({ metricId: "m-1", window: "w-2", valueBps: 8000, weightBps: 7500 }),
      draft({ metricId: "m-2", window: "w-2", valueBps: 9000, weightBps: 2500 }),
      draft({ metricId: "m-3", window: "w-2", dependsOnCapability: "hazmat" }), // v-1 quarantined: capability not verified
      draft({ metricId: "m-4", window: "w-1", valueBps: 6000 }),
      draft({ metricId: "m-5", window: "w-2", vendorExternalId: "v-2", valueBps: 5000 }),
    ]);
    if (!result.ok) throw new Error("ingest failed");
    return result.metrics;
  }

  it("computes the weighted mean in integer bps, floored (8250 for 8000@75%/9000@25%)", () => {
    const result = rollupVendorScorecards(metrics(), { tenant: TENANT, currentWindow: "w-2", previousWindow: "w-1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const v1 = result.rollups.find((r) => r.vendorExternalId === "v-1");
    expect(v1?.aggregatedBps).toBe(8250);
    expect(Number.isInteger(v1?.aggregatedBps)).toBe(true);
  });

  it("excludes quarantined metrics HONESTLY: listed with reason, counts account for every metric", () => {
    const result = rollupVendorScorecards(metrics(), { tenant: TENANT, currentWindow: "w-2", previousWindow: "w-1" });
    if (!result.ok) return;
    const v1 = result.rollups.find((r) => r.vendorExternalId === "v-1");
    expect(v1?.includedCount).toBe(2);
    expect(v1?.excludedCount).toBe(1);
    expect(v1?.exclusions).toEqual([{ metricId: "m-3", reasonCode: "CAPABILITY_NOT_VERIFIED" }]);
    expect((v1?.includedCount ?? 0) + (v1?.excludedCount ?? 0)).toBe(3);
  });

  it("classifies the trend against the previous window (improving/declining/stable/null)", () => {
    const result = rollupVendorScorecards(metrics(), { tenant: TENANT, currentWindow: "w-2", previousWindow: "w-1" });
    if (!result.ok) return;
    const v1 = result.rollups.find((r) => r.vendorExternalId === "v-1");
    expect(v1?.trend).toBe("improving"); // 8250 > 6000
    const reversed = rollupVendorScorecards(metrics(), { tenant: TENANT, currentWindow: "w-1", previousWindow: "w-2" });
    if (!reversed.ok) return;
    expect(reversed.rollups.find((r) => r.vendorExternalId === "v-1")?.trend).toBe("declining");
    const v2 = result.rollups.find((r) => r.vendorExternalId === "v-2");
    expect(v2?.trend).toBeNull(); // no prior-window history
  });

  it("is input-order independent and produces verifiable digests", () => {
    const a = rollupVendorScorecards(metrics(), { tenant: TENANT, currentWindow: "w-2", previousWindow: "w-1" });
    const b = rollupVendorScorecards([...metrics()].reverse(), { tenant: TENANT, currentWindow: "w-2", previousWindow: "w-1" });
    if (!a.ok || !b.ok) return;
    expect(a.rollups).toEqual(b.rollups);
    for (const rollup of a.rollups) expect(verifyScorecardDigest(rollup)).toBe(true);
    const tampered = { ...a.rollups[0]!, aggregatedBps: 9999 };
    expect(verifyScorecardDigest(tampered)).toBe(false);
  });

  it("refuses rollups over cross-tenant metrics (TENANT_MISMATCH — no partial rollups)", () => {
    const foreign = rollupVendorScorecards([...metrics()], { tenant: { tenantId: "other" }, currentWindow: "w-2", previousWindow: "w-1" });
    expect(foreign).toMatchObject({ ok: false, reasonCode: "TENANT_MISMATCH" });
    expect(rollupVendorScorecards(metrics(), { tenant: TENANT, currentWindow: "w-2", previousWindow: "w-2" })).toMatchObject({ ok: false, reasonCode: "WINDOW_EMPTY" });
  });
});

describe("scorecards — revocation propagation", () => {
  it("quarantines dependent metrics on revocation, leaves others untouched (no partial application)", () => {
    const { catalog, registry } = verifiedSetup();
    const ingested = ingestVendorMetrics([], catalog, registry, [
      draft({ metricId: "m-1", dependsOnCapability: "cold-chain" }),
      draft({ metricId: "m-2" }),
      draft({ metricId: "m-3", vendorExternalId: "v-2" }),
    ]);
    if (!ingested.ok) throw new Error("ingest failed");
    const revoked = revokeVerification(catalog, registry, { tenant: TENANT, externalId: "v-1", capability: "cold-chain", reason: "audit-finding" }, 500);
    if (!revoked.ok) return;
    const propagated = applyRevocationToMetrics(ingested.metrics, revoked.notice);
    expect(propagated).toMatchObject({ ok: true, affected: ["m-1"] });
    if (!propagated.ok) return;
    expect(propagated.metrics[0]?.quarantine).toEqual({ reasonCode: "CAPABILITY_REVOKED" });
    expect(propagated.metrics[1]?.quarantine).toBeNull();
    expect(propagated.metrics[2]?.quarantine).toBeNull();
    // The propagated metrics then roll up with the honest exclusion.
    const rollup = rollupVendorScorecards(propagated.metrics, { tenant: TENANT, currentWindow: "w-1", previousWindow: "w-0" });
    expect(rollup.ok).toBe(true);
    if (!rollup.ok) return;
    expect(rollup.rollups.find((r) => r.vendorExternalId === "v-1")?.exclusions).toEqual([{ metricId: "m-1", reasonCode: "CAPABILITY_REVOKED" }]);
  });

  it("never touches other tenants' metrics during propagation", () => {
    const { catalog, registry } = verifiedSetup();
    const ingested = ingestVendorMetrics([], catalog, registry, [draft({ metricId: "m-1", dependsOnCapability: "cold-chain" })]);
    if (!ingested.ok) return;
    const revoked = revokeVerification(catalog, registry, { tenant: TENANT, externalId: "v-1", capability: "cold-chain", reason: "audit" }, 500);
    if (!revoked.ok) return;
    const foreignMetrics: VendorMetricRecord = { ...ingested.metrics[0]!, tenant: { tenantId: "other" } };
    const propagated = applyRevocationToMetrics([foreignMetrics], revoked.notice);
    expect(propagated).toMatchObject({ ok: true, affected: [] });
    if (!propagated.ok) return;
    expect(propagated.metrics[0]?.quarantine).toBeNull();
  });
});
