/**
 * F240A field-mode tests — the phone-shaped field operator view.
 *
 * Themes: priority-ordered + size-bounded sections with truncation
 * accounting; last-known provenance on every entry; the OFFLINE TOLERANCE
 * LAW (views derived from last-known state never claim freshness —
 * non-fresh sections are declared in lastKnownSections and no serialized
 * entry claims "fresh" for stale data); redaction in connectivity
 * entries; determinism + digest tamper; tenant fail-closed.
 */

import { describe, expect, it } from "vitest";
import { assembleFieldView, verifyFieldViewDigest } from "../src/field-mode.js";
import { makeState, NOW } from "./helpers.js";

const OPTIONS = { now: NOW };

function fieldView() {
  const result = assembleFieldView(makeState(), OPTIONS);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("unreachable");
  return result.view;
}

describe("assembleFieldView — top alerts (priority-ordered, bounded)", () => {
  it("orders alerts critical-first, then newest, then deviceId/code", () => {
    const view = fieldView();
    expect(view.topAlerts.entries.map((a) => a.code)).toEqual([
      "engine.overheat.fault",
      "engine.temp.warn",
      "battery.low.warn",
      "link.drop.warn",
    ]);
  });

  it("carries last-known provenance on every alert", () => {
    const view = fieldView();
    const alert = view.topAlerts.entries[0]!;
    expect(alert.assetId).toBe("ast_bulldozer");
    expect(alert.assetDisplayName).toBe("Bulldozer 7");
    expect(alert.lastKnown.at).toBe(NOW - 4_000);
    expect(alert.lastKnown.staleness).toBe("fresh");
    expect(alert.lastKnown.ageMs).toBe(4_000);
  });

  it("bounds the section with truncation + omittedCount accounting", () => {
    const result = assembleFieldView(makeState(), {
      now: NOW,
      limits: { alerts: 2 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const section = result.view.topAlerts;
    expect(section.entries).toHaveLength(2);
    expect(section.truncated).toBe(true);
    expect(section.omittedCount).toBe(2);
  });
});

describe("assembleFieldView — recovery in progress", () => {
  it("lists only open/investigating/proposal cases, longest-open first", () => {
    const view = fieldView();
    expect(view.recoveryInProgress.entries.map((c) => c.caseId)).toEqual([
      "rc_tablet01",
      "rc_bulldoz01",
    ]);
    const entry = view.recoveryInProgress.entries[0]!;
    expect(entry.state).toBe("proposal");
    expect(entry.lastKnown.at).toBe(NOW - 2_000_000);
  });

  it("excludes terminal cases and honors the section limit", () => {
    const result = assembleFieldView(makeState(), {
      now: NOW,
      limits: { recoveries: 1 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.recoveryInProgress.entries.map((c) => c.caseId)).toEqual([
      "rc_tablet01",
    ]);
    expect(result.view.recoveryInProgress.omittedCount).toBe(1);
  });
});

describe("assembleFieldView — next maintenance", () => {
  it("orders upcoming work by next run (soonest first), orders before bare plans", () => {
    const view = fieldView();
    expect(view.nextMaintenance.entries.map((e) => e.refId)).toEqual([
      "plan_handheld_chk",
      "mo_bulldoz_q1",
      "plan_sensor_cal",
    ]);
    const plan = view.nextMaintenance.entries[0]!;
    expect(plan.entryKind).toBe("plan");
    expect(plan.nextRunAt).toBe(NOW + 3_600_000);
    const order = view.nextMaintenance.entries[1]!;
    expect(order.entryKind).toBe("order");
    expect(order.orderState).toBe("scheduled");
    expect(order.nextRunAt).toBe(NOW + 86_400_000);
  });

  it("bounds the section with truncation accounting", () => {
    const result = assembleFieldView(makeState(), {
      now: NOW,
      limits: { maintenance: 1 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.nextMaintenance.entries).toHaveLength(1);
    expect(result.view.nextMaintenance.truncated).toBe(true);
    expect(result.view.nextMaintenance.omittedCount).toBe(2);
  });
});

describe("assembleFieldView — connectivity status + redaction", () => {
  it("shows every device in deviceId order with honest postures", () => {
    const view = fieldView();
    expect(view.connectivityStatus.entries.map((c) => c.deviceId)).toEqual([
      "dev_bulldoz7",
      "dev_sensor09a",
      "dev_sensor09b",
      "dev_tablet12",
    ]);
    const postures = view.connectivityStatus.entries.map((c) => c.posture);
    expect(postures).toEqual(["online", "offline", "unknown", "degraded"]);
  });

  it("redacts operatorContact in connectivity excerpts but keeps location (field mode)", () => {
    const view = fieldView();
    const serialized = JSON.stringify(view);
    const entry = view.connectivityStatus.entries[0]!;
    expect(entry.attributes.location).toBe("site-A");
    expect(entry.attributes.operatorContact).toBe("[REDACTED]");
    expect(serialized).not.toContain("+15550100");
  });

  it("stamps never-observed devices with unknown last-known provenance", () => {
    const view = fieldView();
    const entry = view.connectivityStatus.entries.find(
      (c) => c.deviceId === "dev_sensor09b",
    )!;
    expect(entry.lastKnown).toEqual({ at: null, staleness: "unknown", ageMs: null });
  });
});

describe("assembleFieldView — OFFLINE TOLERANCE LAW", () => {
  it("never claims freshness for last-known data: stale entries declared, no fresh claim", () => {
    const view = fieldView();
    // tablet twin observed 120s ago -> stale; its alert + recovery + connectivity
    const tabletAlert = view.topAlerts.entries.find((a) => a.deviceId === "dev_tablet12");
    expect(tabletAlert?.lastKnown.staleness).toBe("stale");
    expect(tabletAlert?.lastKnown.at).toBe(NOW - 100_000);
    const tabletConn = view.connectivityStatus.entries.find(
      (c) => c.deviceId === "dev_tablet12",
    );
    expect(tabletConn?.lastKnown.staleness).toBe("stale");
    expect(view.lastKnownSections).toContain("top-alerts");
    expect(view.lastKnownSections).toContain("connectivity-status");
    // the serialized view never stamps the tablet entries as fresh
    const tabletEntryJson = JSON.stringify(tabletConn);
    expect(tabletEntryJson).not.toContain('"staleness":"fresh"');
  });

  it("declares no last-known sections when everything is fresh", () => {
    const state = makeState();
    // drop every stale/unknown source: keep only the fresh bulldozer data
    state.twins = state.twins.filter((t) => t.deviceId === "dev_bulldoz7");
    state.findings = state.findings.filter((f) => f.deviceId === "dev_bulldoz7");
    state.recoveryCases = [];
    state.connectivity = state.connectivity.filter((r) => r.deviceId === "dev_bulldoz7");
    state.devices = state.devices.filter((d) => d.id === "dev_bulldoz7");
    state.observations = state.observations.filter((o) => o.deviceId === "dev_bulldoz7");
    const result = assembleFieldView(state, OPTIONS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.lastKnownSections).toEqual([]);
  });

  it("maintenance entries make no freshness claim (declared intents, not observations)", () => {
    const view = fieldView();
    for (const entry of view.nextMaintenance.entries) {
      expect("lastKnown" in entry).toBe(false);
    }
    expect(view.lastKnownSections).not.toContain("next-maintenance");
  });
});

describe("assembleFieldView — determinism, digests, fail-closed", () => {
  it("is byte-identical across assemblies", () => {
    const a = JSON.stringify(assembleFieldView(makeState(), OPTIONS));
    const b = JSON.stringify(assembleFieldView(makeState(), OPTIONS));
    expect(a).toBe(b);
  });

  it("verifies its digest and detects section tampering", () => {
    const view = fieldView();
    expect(verifyFieldViewDigest(view)).toBe(true);
    const tampered = {
      ...view,
      topAlerts: {
        ...view.topAlerts,
        entries: view.topAlerts.entries.map((e) => ({ ...e, severity: "info" as const })),
      },
    };
    expect(verifyFieldViewDigest(tampered)).toBe(false);
    const tamperedSections = { ...view, lastKnownSections: [] };
    expect(verifyFieldViewDigest(tamperedSections)).toBe(false);
  });

  it("refuses cross-tenant state fail-closed (no partial sections)", () => {
    const state = makeState();
    state.recoveryCases[0]!.tenantId = "tnt_other99";
    const result = assembleFieldView(state, OPTIONS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejected).toBe("cross-tenant-ref");
    expect(result.detail).toContain("rc_bulldoz01");
  });

  it("refuses malformed thresholds and invalid now", () => {
    const thresholds = assembleFieldView(makeState(), {
      now: NOW,
      thresholds: { freshWithinMs: 500, staleWithinMs: 100 },
    });
    expect(thresholds.ok).toBe(false);
    if (!thresholds.ok) {
      expect(thresholds.rejected).toBe("invalid-thresholds");
    }
    const now = assembleFieldView(makeState(), { now: -1 });
    expect(now.ok).toBe(false);
    if (!now.ok) {
      expect(now.rejected).toBe("invalid-now");
    }
  });
});
