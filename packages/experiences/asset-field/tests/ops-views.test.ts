/**
 * F240A ops-views tests — health board, open-recovery timeline,
 * maintenance schedule board.
 *
 * Themes: posture rollup + worst-posture-first ordering; fleet counters;
 * open-case timeline step ordering + age accounting; board columns with
 * deterministic membership + ordering; upcoming runs through the domain's
 * own nextRun; determinism + digest tamper detection; tenant fail-closed.
 */

import { describe, expect, it } from "vitest";
import {
  assembleHealthBoard,
  assembleMaintenanceBoard,
  assembleRecoveryTimeline,
  verifyHealthBoardDigest,
  verifyMaintenanceBoardDigest,
  verifyRecoveryTimelineDigest,
} from "../src/ops-views.js";
import { makeState, NOW } from "./helpers.js";

const OPTIONS = { now: NOW };

describe("assembleHealthBoard", () => {
  it("orders rows worst-posture-first then assetId, with fleet counters", () => {
    const result = assembleHealthBoard(makeState(), OPTIONS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const board = result.view;
    expect(board.rows.map((r) => `${r.assetId}:${r.posture}`)).toEqual([
      "ast_bulldozer:critical",
      "ast_handheld01:warning",
      "ast_sensor09:warning",
    ]);
    expect(board.fleet).toEqual({
      assets: 3,
      critical: 1,
      warning: 2,
      info: 0,
      clear: 0,
      devicesWithNoFindings: 1,
    });
  });

  it("reports each row's worst finding and no-finding device count", () => {
    const result = assembleHealthBoard(makeState(), OPTIONS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bulldozer = result.view.rows[0]!;
    expect(bulldozer.worstFinding).toEqual({
      code: "engine.overheat.fault",
      severity: "critical",
      observedAt: NOW - 4_000,
    });
    expect(bulldozer.severityCounts).toEqual({ critical: 1, warning: 1, info: 0 });
    expect(result.view.rows[2]!.devicesWithNoFindings).toBe(1);
  });

  it("is deterministic and detects digest tampering", () => {
    const a = assembleHealthBoard(makeState(), OPTIONS);
    const b = assembleHealthBoard(makeState(), OPTIONS);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(verifyHealthBoardDigest(b.view)).toBe(true);
    const tampered = { ...b.view, fleet: { ...b.view.fleet, critical: 0 } };
    expect(verifyHealthBoardDigest(tampered)).toBe(false);
  });

  it("refuses unprovable findings fail-closed", () => {
    const state = makeState();
    state.findings[2]!.deviceId = "dev_ghost42";
    const result = assembleHealthBoard(state, OPTIONS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejected).toBe("unknown-device-ref");
    expect(result.detail).toContain("dev_ghost42");
  });
});

describe("assembleRecoveryTimeline", () => {
  it("shows only open cases as timelines, longest-open first, with steps in order", () => {
    const result = assembleRecoveryTimeline(makeState(), OPTIONS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const timeline = result.view;
    expect(timeline.open).toBe(2);
    expect(timeline.cases.map((c) => c.caseId)).toEqual(["rc_tablet01", "rc_bulldoz01"]);
    const tablet = timeline.cases[0]!;
    expect(tablet.steps.map((s) => s.command)).toEqual(["investigate", "propose"]);
    expect(tablet.steps[0]!.at).toBe(NOW - 6_000_000);
    expect(tablet.ageMs).toBe(7_200_000);
    expect(tablet.assetId).toBe("ast_handheld01");
  });

  it("excludes resolved and closed cases", () => {
    const result = assembleRecoveryTimeline(makeState(), OPTIONS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ids = result.view.cases.map((c) => c.caseId);
    expect(ids).not.toContain("rc_sensor01");
    expect(ids).not.toContain("rc_sensor02");
  });

  it("is deterministic and detects digest tampering", () => {
    const a = assembleRecoveryTimeline(makeState(), OPTIONS);
    const b = assembleRecoveryTimeline(makeState(), OPTIONS);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(verifyRecoveryTimelineDigest(b.view)).toBe(true);
    const tampered = {
      ...b.view,
      cases: b.view.cases.map((c) => ({ ...c, state: "open" as const })),
    };
    expect(verifyRecoveryTimelineDigest(tampered)).toBe(false);
  });

  it("refuses a recovery case for an unknown device", () => {
    const state = makeState();
    state.recoveryCases[0]!.deviceId = "dev_ghost77";
    const result = assembleRecoveryTimeline(state, OPTIONS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejected).toBe("unknown-device-ref");
    expect(result.detail).toContain("rc_bulldoz01");
  });
});

describe("assembleMaintenanceBoard", () => {
  it("groups orders into state columns, ordered by createdAt then id", () => {
    const result = assembleMaintenanceBoard(makeState(), OPTIONS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const board = result.view;
    expect(board.scheduled.map((o) => o.orderId)).toEqual(["mo_bulldoz_q1"]);
    expect(board.inProgress.map((o) => o.orderId)).toEqual(["mo_tablet_fix"]);
    expect(board.completed.map((o) => o.orderId)).toEqual(["mo_sensor_cal"]);
    // cancelled: q0 (NOW-50_000) is NEWER than q1 (NOW-100_000) — both cancelled
    // fixtures would sort by createdAt; only q0 exists here.
    expect(board.cancelled.map((o) => o.orderId)).toEqual(["mo_bulldoz_q0"]);
    expect(board.scheduled[0]!.assignedTo).toBe("crew-3");
    expect(board.scheduled[0]!.assetId).toBe("ast_bulldozer");
  });

  it("computes upcoming plan runs through the domain's nextRun, soonest first", () => {
    const result = assembleMaintenanceBoard(makeState(), OPTIONS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const upcoming = result.view.upcoming;
    expect(upcoming.map((u) => u.planId)).toEqual([
      "plan_handheld_chk",
      "plan_bulldoz_svc",
      "plan_sensor_cal",
    ]);
    expect(upcoming[0]!.nextRunAt).toBe(NOW + 3_600_000);
    expect(upcoming[1]!.nextRunAt).toBe(NOW + 86_400_000);
    expect(upcoming[2]!.nextRunAt).toBe(NOW + 561_600_000);
  });

  it("places expired one-time plans last (nextRunAt null)", () => {
    const state = makeState();
    state.plans = state.plans.map((p) =>
      p.id === "plan_handheld_chk"
        ? { ...p, schedule: { kind: "one-time", at: NOW - 1 } }
        : p,
    );
    const result = assembleMaintenanceBoard(state, OPTIONS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const upcoming = result.view.upcoming;
    expect(upcoming[upcoming.length - 1]!.planId).toBe("plan_handheld_chk");
    expect(upcoming[upcoming.length - 1]!.nextRunAt).toBeNull();
  });

  it("is deterministic and detects digest tampering", () => {
    const a = assembleMaintenanceBoard(makeState(), OPTIONS);
    const b = assembleMaintenanceBoard(makeState(), OPTIONS);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(verifyMaintenanceBoardDigest(b.view)).toBe(true);
    const tampered = { ...b.view, scheduled: [] };
    expect(verifyMaintenanceBoardDigest(tampered)).toBe(false);
  });

  it("refuses an order referencing an unknown plan", () => {
    const state = makeState();
    state.orders[0]!.planId = "plan_ghost11" as never;
    const result = assembleMaintenanceBoard(state, OPTIONS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejected).toBe("unknown-plan-ref");
    expect(result.detail).toContain("mo_bulldoz_q1");
  });
});
