/**
 * @fleetos/control-plane — SLA / deadline tracker tests.
 *
 * The deterministic severity ladder: exact breach times, idempotent
 * evaluation, the full escalation ladder in order, registration
 * validations, and tenant fail-closed access.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_ESCALATION_CONFIG,
  escalationLadder,
  SlaTracker,
  severityForLevel,
} from "../src/index.js";
import { ctxFor, NOW, TENANT_A, TENANT_B } from "./helpers.js";

const DUE = NOW + 10_000;

describe("escalationLadder — pure ladder computation", () => {
  it("computes exact ladder times: due, due+window, due+2*window", () => {
    const ladder = escalationLadder(DUE, DEFAULT_ESCALATION_CONFIG);
    expect(ladder.map((s) => s.at)).toEqual([
      DUE,
      DUE + 10_000,
      DUE + 20_000,
    ]);
  });

  it("maps the severity ladder: warning → critical → escalation → executive", () => {
    expect(severityForLevel(1)).toBe("warning");
    expect(severityForLevel(2)).toBe("critical");
    expect(severityForLevel(3)).toBe("escalation");
    expect(severityForLevel(4)).toBe("executive");
    expect(severityForLevel(9)).toBe("executive");
  });

  it("a custom config changes the ladder geometry", () => {
    const ladder = escalationLadder(1_000, { levels: 2, windowMs: 5_000 });
    expect(ladder.map((s) => s.at)).toEqual([1_000, 6_000]);
    expect(ladder.map((s) => s.severity)).toEqual(["warning", "critical"]);
  });
});

describe("SlaTracker — register", () => {
  it("registers a deadline with an empty escalation list", () => {
    const tracker = new SlaTracker();
    const registration = tracker.register({
      ctx: ctxFor(TENANT_A),
      commandId: "cmd_0000000001",
      dueAt: DUE,
      now: NOW,
    });
    expect(registration.ok).toBe(true);
    if (!registration.ok) return;
    expect(registration.value.commandId).toBe("cmd_0000000001");
    expect(registration.value.dueAt).toBe(DUE);
    expect(registration.value.escalations).toEqual([]);
    expect(registration.value.digest).toHaveLength(64);
  });

  it("refuses a duplicate deadline for the same command: deadline-exists", () => {
    const tracker = new SlaTracker();
    tracker.register({ ctx: ctxFor(TENANT_A), commandId: "cmd_0000000001", dueAt: DUE, now: NOW });
    expect(
      tracker.register({ ctx: ctxFor(TENANT_A), commandId: "cmd_0000000001", dueAt: DUE + 1, now: NOW }),
    ).toEqual({ ok: false, reason: "deadline-exists" });
  });

  it("the same command id under another tenant is a separate deadline", () => {
    const tracker = new SlaTracker();
    const a = tracker.register({ ctx: ctxFor(TENANT_A), commandId: "cmd_0000000001", dueAt: DUE, now: NOW });
    const b = tracker.register({ ctx: ctxFor(TENANT_B), commandId: "cmd_0000000001", dueAt: DUE, now: NOW });
    expect(a.ok && b.ok).toBe(true);
  });

  it("rejects an invalid dueAt (NaN / zero / negative)", () => {
    const tracker = new SlaTracker();
    expect(
      tracker.register({ ctx: ctxFor(TENANT_A), commandId: "cmd_0000000001", dueAt: Number.NaN, now: NOW }),
    ).toEqual({ ok: false, reason: "invalid-due-at" });
    expect(
      tracker.register({ ctx: ctxFor(TENANT_A), commandId: "cmd_0000000001", dueAt: 0, now: NOW }),
    ).toEqual({ ok: false, reason: "invalid-due-at" });
  });

  it("rejects an invalid command id", () => {
    const tracker = new SlaTracker();
    expect(
      tracker.register({ ctx: ctxFor(TENANT_A), commandId: "", dueAt: DUE, now: NOW }),
    ).toEqual({ ok: false, reason: "invalid-command-id" });
  });

  it("rejects an invalid escalation config", () => {
    const tracker = new SlaTracker();
    expect(
      tracker.register({
        ctx: ctxFor(TENANT_A),
        commandId: "cmd_0000000001",
        dueAt: DUE,
        now: NOW,
        config: { levels: 0, windowMs: 1_000 },
      }),
    ).toEqual({ ok: false, reason: "invalid-config" });
    expect(
      tracker.register({
        ctx: ctxFor(TENANT_A),
        commandId: "cmd_0000000001",
        dueAt: DUE,
        now: NOW,
        config: { levels: 3, windowMs: 0 },
      }),
    ).toEqual({ ok: false, reason: "invalid-config" });
  });
});

describe("SlaTracker — evaluate (the breach ladder)", () => {
  it("before the deadline: no escalations", () => {
    const tracker = new SlaTracker();
    tracker.register({ ctx: ctxFor(TENANT_A), commandId: "cmd_0000000001", dueAt: DUE, now: NOW });
    const evaluation = tracker.evaluate({ ctx: ctxFor(TENANT_A), commandId: "cmd_0000000001", now: DUE - 1 });
    expect(evaluation.ok).toBe(true);
    if (!evaluation.ok) return;
    expect(evaluation.value.newEscalations).toEqual([]);
    expect(evaluation.value.registration.escalations).toEqual([]);
  });

  it("AT the deadline: level 1 warning with the exact threshold time", () => {
    const tracker = new SlaTracker();
    tracker.register({ ctx: ctxFor(TENANT_A), commandId: "cmd_0000000001", dueAt: DUE, now: NOW });
    const evaluation = tracker.evaluate({ ctx: ctxFor(TENANT_A), commandId: "cmd_0000000001", now: DUE });
    expect(evaluation.ok).toBe(true);
    if (!evaluation.ok) return;
    expect(evaluation.value.newEscalations).toHaveLength(1);
    const first = evaluation.value.newEscalations[0];
    expect(first?.level).toBe(1);
    expect(first?.severity).toBe("warning");
    expect(first?.thresholdAt).toBe(DUE);
    expect(first?.recordedAt).toBe(DUE);
  });

  it("one window late: level 2 critical", () => {
    const tracker = new SlaTracker();
    tracker.register({ ctx: ctxFor(TENANT_A), commandId: "cmd_0000000001", dueAt: DUE, now: NOW });
    const evaluation = tracker.evaluate({
      ctx: ctxFor(TENANT_A),
      commandId: "cmd_0000000001",
      now: DUE + DEFAULT_ESCALATION_CONFIG.windowMs,
    });
    expect(evaluation.ok && evaluation.value.newEscalations).toHaveLength(2);
    const second = evaluation.ok ? evaluation.value.newEscalations[1] : undefined;
    expect(second?.severity).toBe("critical");
    expect(second?.thresholdAt).toBe(DUE + DEFAULT_ESCALATION_CONFIG.windowMs);
  });

  it("two windows late: level 3 escalation", () => {
    const tracker = new SlaTracker();
    tracker.register({ ctx: ctxFor(TENANT_A), commandId: "cmd_0000000001", dueAt: DUE, now: NOW });
    const evaluation = tracker.evaluate({
      ctx: ctxFor(TENANT_A),
      commandId: "cmd_0000000001",
      now: DUE + 2 * DEFAULT_ESCALATION_CONFIG.windowMs,
    });
    expect(evaluation.ok && evaluation.value.newEscalations).toHaveLength(3);
    const third = evaluation.ok ? evaluation.value.newEscalations[2] : undefined;
    expect(third?.severity).toBe("escalation");
  });

  it("evaluation is idempotent — re-evaluating the same now records nothing new", () => {
    const tracker = new SlaTracker();
    tracker.register({ ctx: ctxFor(TENANT_A), commandId: "cmd_0000000001", dueAt: DUE, now: NOW });
    tracker.evaluate({ ctx: ctxFor(TENANT_A), commandId: "cmd_0000000001", now: DUE });
    const again = tracker.evaluate({ ctx: ctxFor(TENANT_A), commandId: "cmd_0000000001", now: DUE });
    expect(again.ok && again.value.newEscalations).toEqual([]);
    const registration = tracker.registration(ctxFor(TENANT_A), "cmd_0000000001");
    expect(registration.ok && registration.value.escalations).toHaveLength(1);
  });

  it("a late single evaluation records the WHOLE observed ladder in order", () => {
    const tracker = new SlaTracker();
    tracker.register({ ctx: ctxFor(TENANT_A), commandId: "cmd_0000000001", dueAt: DUE, now: NOW });
    const evaluation = tracker.evaluate({
      ctx: ctxFor(TENANT_A),
      commandId: "cmd_0000000001",
      now: DUE + 5 * DEFAULT_ESCALATION_CONFIG.windowMs,
    });
    expect(evaluation.ok).toBe(true);
    if (!evaluation.ok) return;
    expect(evaluation.value.newEscalations.map((e) => e.level)).toEqual([1, 2, 3]);
    expect(
      evaluation.value.newEscalations.map((e) => e.severity),
    ).toEqual(["warning", "critical", "escalation"]);
    expect(
      evaluation.value.newEscalations.every((e) => e.recordedAt === DUE + 50_000),
    ).toBe(true);
  });

  it("escalation records carry digests and are cumulative", () => {
    const tracker = new SlaTracker();
    tracker.register({ ctx: ctxFor(TENANT_A), commandId: "cmd_0000000001", dueAt: DUE, now: NOW });
    tracker.evaluate({ ctx: ctxFor(TENANT_A), commandId: "cmd_0000000001", now: DUE });
    tracker.evaluate({
      ctx: ctxFor(TENANT_A),
      commandId: "cmd_0000000001",
      now: DUE + DEFAULT_ESCALATION_CONFIG.windowMs,
    });
    const registration = tracker.registration(ctxFor(TENANT_A), "cmd_0000000001");
    expect(registration.ok && registration.value.escalations).toHaveLength(2);
    expect(
      registration.ok && registration.value.escalations.every((e) => e.digest.length === 64),
    ).toBe(true);
  });

  it("cross-tenant evaluate fails closed: deadline-not-found", () => {
    const tracker = new SlaTracker();
    tracker.register({ ctx: ctxFor(TENANT_A), commandId: "cmd_0000000001", dueAt: DUE, now: NOW });
    expect(
      tracker.evaluate({ ctx: ctxFor(TENANT_B), commandId: "cmd_0000000001", now: DUE + 100_000 }),
    ).toEqual({ ok: false, reason: "deadline-not-found" });
    expect(tracker.registration(ctxFor(TENANT_B), "cmd_0000000001")).toEqual({
      ok: false,
      reason: "deadline-not-found",
    });
  });

  it("evaluating an unknown deadline is deadline-not-found", () => {
    const tracker = new SlaTracker();
    expect(
      tracker.evaluate({ ctx: ctxFor(TENANT_A), commandId: "cmd_0000000001", now: NOW }),
    ).toEqual({ ok: false, reason: "deadline-not-found" });
  });

  it("rejects an invalid now", () => {
    const tracker = new SlaTracker();
    tracker.register({ ctx: ctxFor(TENANT_A), commandId: "cmd_0000000001", dueAt: DUE, now: NOW });
    expect(
      tracker.evaluate({ ctx: ctxFor(TENANT_A), commandId: "cmd_0000000001", now: Number.NaN }),
    ).toEqual({ ok: false, reason: "invalid-now" });
  });

  it("registrationsFor is tenant-scoped", () => {
    const tracker = new SlaTracker();
    tracker.register({ ctx: ctxFor(TENANT_A), commandId: "cmd_0000000001", dueAt: DUE, now: NOW });
    tracker.register({ ctx: ctxFor(TENANT_B), commandId: "cmd_0000000002", dueAt: DUE, now: NOW });
    expect(tracker.registrationsFor(ctxFor(TENANT_A))).toHaveLength(1);
    expect(tracker.registrationsFor(ctxFor(TENANT_B))).toHaveLength(1);
  });
});
