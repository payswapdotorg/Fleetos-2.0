/**
 * F240A asset-views tests — fleet overview + asset detail read-models.
 *
 * Themes: card ordering + rollups + counters; posture/severity/connectivity/
 * recency rollups incl. the honest unknowns; redaction proofs (names visible,
 * values + non-scalar structures PROVEN absent from serialized output);
 * determinism (byte-identical, input-order independent) + digest tamper
 * detection; tenant fail-closed with exact refusals (no partial state).
 */

import { describe, expect, it } from "vitest";
import {
  assembleAssetDetail,
  assembleFleetOverview,
  verifyAssetDetailDigest,
  verifyFleetOverviewDigest,
} from "../src/asset-views.js";
import { REDACTED_VALUE } from "../src/redaction.js";
import { makeReversedState, makeState, NOW } from "./helpers.js";

const OPTIONS = { now: NOW };

function overview() {
  const result = assembleFleetOverview(makeState(), OPTIONS);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("unreachable");
  return result.view;
}

function cardOf(view: ReturnType<typeof overview>, assetId: string) {
  const card = view.cards.find((c) => c.assetId === assetId);
  expect(card).toBeDefined();
  return card!;
}

describe("assembleFleetOverview — rollups + ordering", () => {
  it("emits one card per asset in deterministic assetId order", () => {
    const view = overview();
    expect(view.cards.map((c) => c.assetId)).toEqual([
      "ast_bulldozer",
      "ast_handheld01",
      "ast_sensor09",
    ]);
  });

  it("counts lifecycle states and devices fleet-wide", () => {
    const view = overview();
    expect(view.counters).toEqual({
      assets: 3,
      active: 2,
      admitted: 1,
      retired: 0,
      devices: 4,
      fresh: 1,
      stale: 1,
      unknown: 2,
    });
  });

  it("rolls health posture per asset from findings (critical wins)", () => {
    const view = overview();
    expect(cardOf(view, "ast_bulldozer").posture).toBe("critical");
    expect(cardOf(view, "ast_bulldozer").severityCounts).toEqual({
      critical: 1,
      warning: 1,
      info: 0,
    });
    expect(cardOf(view, "ast_handheld01").posture).toBe("warning");
    expect(cardOf(view, "ast_sensor09").posture).toBe("warning");
  });

  it("rolls honest connectivity postures per asset (stale online -> degraded, absent -> unknown)", () => {
    const view = overview();
    expect(cardOf(view, "ast_bulldozer").connectivity).toEqual({
      online: 1,
      degraded: 0,
      offline: 0,
      unknown: 0,
    });
    expect(cardOf(view, "ast_handheld01").connectivity).toEqual({
      online: 0,
      degraded: 1,
      offline: 0,
      unknown: 0,
    });
    expect(cardOf(view, "ast_sensor09").connectivity).toEqual({
      online: 0,
      degraded: 0,
      offline: 1,
      unknown: 1,
    });
  });

  it("classifies observation recency fresh/stale/unknown per device and stamps the card", () => {
    const view = overview();
    expect(cardOf(view, "ast_bulldozer").recency).toEqual({
      fresh: 1,
      stale: 0,
      unknown: 0,
    });
    expect(cardOf(view, "ast_bulldozer").lastObservedAt).toBe(NOW - 10_000);
    expect(cardOf(view, "ast_bulldozer").lastObservedStaleness).toBe("fresh");
    expect(cardOf(view, "ast_handheld01").lastObservedStaleness).toBe("stale");
    // never-observed device + beyond-window device both classify unknown
    expect(cardOf(view, "ast_sensor09").recency).toEqual({
      fresh: 0,
      stale: 0,
      unknown: 2,
    });
    expect(cardOf(view, "ast_sensor09").lastObservedStaleness).toBe("unknown");
  });

  it("bounds the attribute excerpt to attributeLimit sorted keys", () => {
    const view = assembleFleetOverview(makeState(), { now: NOW, attributeLimit: 2 });
    expect(view.ok).toBe(true);
    if (!view.ok) return;
    const attrs = cardOf(view.view, "ast_bulldozer").attributes;
    expect(Object.keys(attrs).sort()).toEqual(["engineTemp", "fuelLevel"]);
  });
});

describe("assembleFleetOverview — redaction proofs", () => {
  it("redacts operatorContact + location in overview cards: names visible, values absent", () => {
    const serialized = JSON.stringify(overview());
    const card = cardOf(overview(), "ast_bulldozer");
    expect(card.redactedFields).toEqual(["location", "operatorContact"]);
    expect(card.attributes.operatorContact).toBe(REDACTED_VALUE);
    expect(card.attributes.location).toBe(REDACTED_VALUE);
    expect(serialized).not.toContain("+15550100");
    expect(serialized).not.toContain("site-A");
  });

  it("never surfaces non-scalar attribute structures", () => {
    const serialized = JSON.stringify(overview());
    expect(serialized).not.toContain("nestedConfig");
    expect(serialized).not.toContain("never-leak");
  });

  it("honors caller-supplied rules over the defaults", () => {
    const result = assembleFleetOverview(makeState(), {
      now: NOW,
      rules: [{ purpose: "fleet-overview", redactFields: ["engineTemp"] }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const card = cardOf(result.view, "ast_bulldozer");
    expect(card.redactedFields).toEqual(["engineTemp"]);
    expect(card.attributes.engineTemp).toBe(REDACTED_VALUE);
    expect(card.attributes.location).toBe("site-A");
  });
});

describe("assembleFleetOverview — determinism + digests", () => {
  it("is byte-identical across assemblies and independent of input record order", () => {
    const a = JSON.stringify(assembleFleetOverview(makeState(), OPTIONS));
    const b = JSON.stringify(assembleFleetOverview(makeState(), OPTIONS));
    const reversed = JSON.stringify(assembleFleetOverview(makeReversedState(), OPTIONS));
    expect(a).toBe(b);
    expect(a).toBe(reversed);
  });

  it("verifies its digest and detects tampering with any card field", () => {
    const view = overview();
    expect(verifyFleetOverviewDigest(view)).toBe(true);
    const tampered = {
      ...view,
      cards: view.cards.map((c) =>
        c.assetId === "ast_bulldozer" ? { ...c, posture: "clear" as const } : c,
      ),
    };
    expect(verifyFleetOverviewDigest(tampered)).toBe(false);
    const tamperedCounter = { ...view, counters: { ...view.counters, active: 99 } };
    expect(verifyFleetOverviewDigest(tamperedCounter)).toBe(false);
  });
});

describe("assembleFleetOverview — tenant fail-closed (exact refusals)", () => {
  it("refuses an empty tenant with missing-tenant", () => {
    const state = makeState();
    state.tenantId = "";
    const result = assembleFleetOverview(state, OPTIONS);
    expect(result).toEqual({
      ok: false,
      rejected: "missing-tenant",
      detail: "state slice tenant identifier is empty",
    });
  });

  it("refuses a malformed tenant id with malformed-tenant-id", () => {
    const state = makeState();
    state.tenantId = "tenant-1";
    const result = assembleFleetOverview(state, OPTIONS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejected).toBe("malformed-tenant-id");
  });

  it("refuses a cross-tenant asset naming the offender (no partial state)", () => {
    const state = makeState();
    state.assets[0]!.tenantId = "tnt_other99";
    const result = assembleFleetOverview(state, OPTIONS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejected).toBe("cross-tenant-ref");
    expect(result.detail).toContain("ast_bulldozer");
    expect(result.detail).toContain("tnt_other99");
  });

  it("refuses a cross-tenant connectivity record naming the offender device", () => {
    const state = makeState();
    state.connectivity[0]!.tenantId = "tnt_other99";
    const result = assembleFleetOverview(state, OPTIONS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejected).toBe("cross-tenant-ref");
    expect(result.detail).toContain("dev_bulldoz7");
  });

  it("refuses a finding for a device outside the tenant directory (tenant not provable)", () => {
    const state = makeState();
    state.findings[0]!.deviceId = "dev_ghost99";
    const result = assembleFleetOverview(state, OPTIONS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejected).toBe("unknown-device-ref");
    expect(result.detail).toContain("dev_ghost99");
  });

  it("refuses a device referencing an unknown asset", () => {
    const state = makeState();
    state.devices[0]!.assetId = "ast_ghost99" as never;
    const result = assembleFleetOverview(state, OPTIONS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejected).toBe("unknown-asset-ref");
    expect(result.detail).toContain("ast_ghost99");
  });

  it("refuses a twin for an unknown device and duplicate asset identities", () => {
    const twinState = makeState();
    twinState.twins = [...twinState.twins, twinState.twins[0]!];
    const twinResult = assembleFleetOverview(twinState, OPTIONS);
    expect(twinResult.ok).toBe(false);
    if (!twinResult.ok) {
      expect(twinResult.rejected).toBe("duplicate-ref");
    }
    const dupState = makeState();
    dupState.assets = [...dupState.assets, dupState.assets[0]!];
    const dupResult = assembleFleetOverview(dupState, OPTIONS);
    expect(dupResult.ok).toBe(false);
    if (!dupResult.ok) {
      expect(dupResult.rejected).toBe("duplicate-ref");
    }
  });

  it("refuses a non-positive logical now with invalid-now", () => {
    const result = assembleFleetOverview(makeState(), { now: 0 });
    expect(result).toEqual({
      ok: false,
      rejected: "invalid-now",
      detail: expect.stringContaining("logical now"),
    });
  });

  it("refuses malformed recency thresholds with invalid-thresholds", () => {
    const result = assembleFleetOverview(makeState(), {
      now: NOW,
      thresholds: { freshWithinMs: -1, staleWithinMs: 10 },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejected).toBe("invalid-thresholds");
  });
});

describe("assembleAssetDetail — detail sheets", () => {
  it("projects identity refs, observation recency, twin provenance and posture", () => {
    const result = assembleAssetDetail(makeState(), { now: NOW, assetId: "ast_bulldozer" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const detail = result.view;
    expect(detail.displayName).toBe("Bulldozer 7");
    expect(detail.devices).toHaveLength(1);
    const sheet = detail.devices[0]!;
    expect(sheet.deviceId).toBe("dev_bulldoz7");
    expect(sheet.serial).toBe("SN-BD-7");
    expect(sheet.connectivity).toBe("online");
    expect(sheet.lastObservedAt).toBe(NOW - 10_000);
    expect(sheet.staleness).toBe("fresh");
    expect(sheet.revisionCount).toBe(1);
    expect(sheet.lastSeq).toBe(41);
    expect(sheet.observationCount).toBe(2);
    expect(sheet.lastObservationKind).toBe("telemetry.ok");
    expect(detail.posture).toBe("critical");
    expect(detail.findings.map((f) => f.code)).toEqual([
      "engine.overheat.fault",
      "engine.temp.warn",
    ]);
  });

  it("redacts operatorContact but keeps location for asset-detail purpose", () => {
    const result = assembleAssetDetail(makeState(), { now: NOW, assetId: "ast_bulldozer" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const serialized = JSON.stringify(result.view);
    expect(result.view.redactedFields).toEqual(["operatorContact"]);
    expect(serialized).not.toContain("+15550100");
    expect(serialized).toContain("site-A");
  });

  it("refuses an unknown asset id fail-closed (no partial sheet)", () => {
    const result = assembleAssetDetail(makeState(), { now: NOW, assetId: "ast_ghost99" });
    expect(result).toEqual({
      ok: false,
      rejected: "unknown-asset",
      detail: expect.stringContaining("ast_ghost99"),
    });
  });

  it("is deterministic and detects digest tampering", () => {
    const a = assembleAssetDetail(makeState(), { now: NOW, assetId: "ast_handheld01" });
    const b = assembleAssetDetail(makeState(), { now: NOW, assetId: "ast_handheld01" });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(verifyAssetDetailDigest(b.view)).toBe(true);
    const tampered = { ...b.view, displayName: "Tampered" };
    expect(verifyAssetDetailDigest(tampered)).toBe(false);
  });
});
