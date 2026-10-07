import { describe, it, expect } from "vitest";
import {
  applyTwinRevision,
  evaluateAssetTransition,
  isAssetId,
  isDeviceId,
  latestAttributes,
  type DeviceTwin,
  type DeviceId,
  type TwinRevisionInput,
} from "./assets.js";

const NOW = 1_727_000_000_000;
const DEV1 = "dev_truck-001" as DeviceId;

function baseInput(seq: number, observedAt = NOW): TwinRevisionInput {
  return {
    deviceId: DEV1,
    tenantId: "tnt_acme",
    seq,
    observedAt,
    attributes: { engineTemp: 90 },
    source: "observation" as const,
    appliedAt: NOW,
  };
}

describe("assets: branded id guards", () => {
  it("accepts well-formed asset id", () => {
    expect(isAssetId("ast_truck-001")).toBe(true);
  });
  it("rejects asset id without prefix", () => {
    expect(isAssetId("truck-001")).toBe(false);
  });
  it("accepts well-formed device id", () => {
    expect(isDeviceId("dev_truck-001")).toBe(true);
  });
  it("rejects device id without prefix", () => {
    expect(isDeviceId("truck-001")).toBe(false);
  });
});

describe("assets: applyTwinRevision bootstrap", () => {
  it("creates twin from null when seq is monotonic (seq=1)", () => {
    const r = applyTwinRevision(null, baseInput(1));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.twin.revisions).toHaveLength(1);
      expect(r.twin.lastSeq).toBe(1);
      expect(r.twin.revisions[0]?.attributes).toEqual({ engineTemp: 90 });
    }
  });
  it("rejects bootstrap with seq < 1 (non-monotonic)", () => {
    const r = applyTwinRevision(null, baseInput(0));
    expect(r).toEqual({ ok: false, reason: "non-monotonic-seq" });
  });
  it("rejects bootstrap with malformed attributes (array)", () => {
    const r = applyTwinRevision(null, {
      ...baseInput(1),
      attributes: [1, 2, 3] as unknown as Readonly<Record<string, unknown>>,
    });
    expect(r).toEqual({ ok: false, reason: "malformed-attributes" });
  });
});

describe("assets: applyTwinRevision append-only & monotonic", () => {
  it("appends revision with strictly greater seq", () => {
    const first = applyTwinRevision(null, baseInput(1));
    if (!first.ok) throw new Error("first failed");
    const second = applyTwinRevision(first.twin, baseInput(2, NOW + 1000));
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.twin.revisions).toHaveLength(2);
      expect(second.twin.lastSeq).toBe(2);
      expect(second.twin.revisions[1]?.seq).toBe(2);
    }
  });
  it("rejects revision with seq equal to lastSeq", () => {
    const first = applyTwinRevision(null, baseInput(1));
    if (!first.ok) throw new Error("first failed");
    const second = applyTwinRevision(first.twin, baseInput(1, NOW + 1000));
    expect(second).toEqual({ ok: false, reason: "non-monotonic-seq" });
  });
  it("rejects revision with seq less than lastSeq", () => {
    const first = applyTwinRevision(null, baseInput(5));
    if (!first.ok) throw new Error("first failed");
    const second = applyTwinRevision(first.twin, baseInput(4, NOW + 1000));
    expect(second).toEqual({ ok: false, reason: "non-monotonic-seq" });
  });
  it("rejects revision with stale observedAt (time travel)", () => {
    const first = applyTwinRevision(null, baseInput(1, NOW + 5000));
    if (!first.ok) throw new Error("first failed");
    const second = applyTwinRevision(first.twin, baseInput(2, NOW));
    expect(second).toEqual({ ok: false, reason: "stale-observed-at" });
  });
  it("does not mutate input twin (immutability check)", () => {
    const first = applyTwinRevision(null, baseInput(1));
    if (!first.ok) throw new Error("first failed");
    const before = first.twin.revisions.length;
    const frozenCopy: DeviceTwin = first.twin;
    applyTwinRevision(frozenCopy, baseInput(2, NOW + 1000));
    expect(first.twin.revisions.length).toBe(before);
    expect(first.twin.lastSeq).toBe(1);
  });
});

describe("assets: latestAttributes projection", () => {
  it("returns last revision attributes", () => {
    const first = applyTwinRevision(null, baseInput(1, NOW));
    if (!first.ok) throw new Error("first failed");
    const second = applyTwinRevision(first.twin, baseInput(2, NOW + 1000));
    if (!second.ok) throw new Error("second failed");
    expect(latestAttributes(second.twin)).toEqual({ engineTemp: 90 });
  });
  it("returns empty object for twin with no revisions (impossible by construction)", () => {
    const empty: DeviceTwin = {
      deviceId: DEV1,
      tenantId: "tnt_acme",
      revisions: [],
      lastSeq: 0 as never,
      lastObservedAt: 0,
    };
    expect(latestAttributes(empty)).toEqual({});
  });
});

describe("assets: asset lifecycle state machine", () => {
  it("activate: admitted -> active", () => {
    expect(evaluateAssetTransition("admitted", "activate")).toEqual({
      ok: true,
      from: "admitted",
      to: "active",
    });
  });
  it("retire: admitted -> retired (skip activate)", () => {
    expect(evaluateAssetTransition("admitted", "retire")).toEqual({
      ok: true,
      from: "admitted",
      to: "retired",
    });
  });
  it("retire: active -> retired", () => {
    expect(evaluateAssetTransition("active", "retire")).toEqual({
      ok: true,
      from: "active",
      to: "retired",
    });
  });
  it("activate from active -> illegal-transition", () => {
    expect(evaluateAssetTransition("active", "activate")).toEqual({
      ok: false,
      reason: "illegal-transition",
    });
  });
  it("activate from retired -> illegal-transition", () => {
    expect(evaluateAssetTransition("retired", "activate")).toEqual({
      ok: false,
      reason: "illegal-transition",
    });
  });
  it("retire from retired -> illegal-transition", () => {
    expect(evaluateAssetTransition("retired", "retire")).toEqual({
      ok: false,
      reason: "illegal-transition",
    });
  });
});
