/**
 * Incident-replay tests (F280B, Wave 8 lane B).
 *
 * Behavior under test: deterministic incident replay over the REAL execution
 * ledger + REAL action-audit journal — byte-identical re-replay, divergence
 * detection pinned to the first divergent entry (kind/subject/at/length),
 * REAL per-command view reuse, and A8 cross-tenant fail-closed refusals.
 */
import { describe, it, expect } from "vitest";
import {
  proposeAction,
  advanceActionState,
  emitAuditTrail,
} from "@fleetos/actions";
import type { ActionAuditEvent, ActionIntent } from "@fleetos/actions";
import { evaluateCapability } from "@fleetos/policy";
import type { Capability, GuardianContext } from "@fleetos/policy";
import {
  appendExecutionLedger,
  replayIncident,
  verifyIncidentReplayDeterminism,
  diffIncidentReplays,
} from "../src/index.ts";
import type { ExecutionLedgerEntry } from "../src/index.ts";

const TENANT = "tnt_forensics";

// ---------------------------------------------------------------------------
// REAL fixtures — a full incident: 2 commands through the queue lifecycle,
// with a failure → retry → dead-letter tail on the second command.
// ---------------------------------------------------------------------------

function incidentLedger(): readonly ExecutionLedgerEntry[] {
  let ledger: readonly ExecutionLedgerEntry[] = [];
  const ops = [
    { key: "plan|s1|n1", kind: "submitted" as const, at: 1_000, detail: "" },
    { key: "plan|s1|n1", kind: "acked" as const, at: 1_100, detail: "" },
    { key: "plan|s1|n1", kind: "completed" as const, at: 1_200, detail: "ok" },
    { key: "plan|s2|n1", kind: "submitted" as const, at: 1_300, detail: "" },
    { key: "plan|s2|n1", kind: "acked" as const, at: 1_400, detail: "" },
    { key: "plan|s2|n1", kind: "failed" as const, at: 1_500, detail: "transport error 1" },
    { key: "plan|s2|n1", kind: "retried" as const, at: 1_600, detail: "transport error 2" },
    { key: "plan|s2|n1", kind: "failed" as const, at: 1_700, detail: "transport error 3" },
    { key: "plan|s2|n1", kind: "dead-lettered" as const, at: 1_800, detail: "transport error 3" },
  ] as const;
  for (const op of ops) {
    const r = appendExecutionLedger(ledger, {
      tenantId: TENANT, idempotencyKey: op.key, kind: op.kind, at: op.at, detail: op.detail,
    });
    if (!r.ok) throw new Error(`fixture append refused: ${r.reason}`);
    ledger = r.ledger;
  }
  return ledger;
}

function cap(): Capability {
  return {
    id: "cap.execute.device.restart", category: "execute.device", risk: "high",
    requiredAuthority: ["asset.owner", "human.approval"], tenantScope: "single",
    resourceScope: { assetIds: ["asset-1"] },
    sideEffects: [{ kind: "device.command", target: "asset-1", reversible: false, description: "restart" }],
    idempotency: { supported: true, keyShape: ["tenantId", "assetId"] },
    verification: { kind: "device.ack", timeoutMs: 30_000 },
    inputs: ["assetId"], outputs: ["restartReceipt"],
    description: "Restart a managed device", version: "1.0.0",
  };
}

function incidentJournal(): readonly ActionAuditEvent[] {
  const ctx: GuardianContext = {
    tenant: { tenantId: TENANT }, capability: cap(),
    actor: { actorId: "engineer-1", authority: ["asset.owner", "human.approval"], isAutonomous: false },
    degraded: false,
  };
  const allowHighRisk = {
    id: "rule.require_human_approval_for_high_risk" as const,
    description: "high-risk requires approval",
    riskFloor: "high" as const, riskCeiling: "irreversible" as const,
    requiredAuthority: ["asset.owner", "human.approval"] as const,
    tenantScope: "any" as const, verdict: "ALLOW" as const, priority: 10,
  };
  const decision = evaluateCapability(
    { id: "pol-1", version: "1.0.0", tenantId: TENANT, rules: [allowHighRisk], defaultVerdict: "ALLOW", failClosed: true },
    cap(), ctx,
  );
  const intent: ActionIntent = {
    intentId: "intent-1", tenant: { tenantId: TENANT }, capability: cap(),
    idempotencyKey: { tenantId: TENANT, capabilityId: cap().id, nonce: "n1" },
    inputs: { assetId: "asset-1" }, proposedAt: "1970-01-01T00:00:00.900Z", proposedBy: "engineer-1",
  };
  let record = proposeAction(intent);
  record = advanceActionState(record, "authorized", {
    at: "1970-01-01T00:00:01.000Z", authorization: decision, tenantId: TENANT,
  }).record;
  record = advanceActionState(record, "confirmed", {
    at: "1970-01-01T00:00:01.050Z", confirmedBy: "engineer-1", tenantId: TENANT,
  }).record;
  return emitAuditTrail(record, "engineer-1");
}

function incidentInput() {
  return { tenantId: TENANT, ledger: incidentLedger(), journal: incidentJournal() };
}

/** Replay helper — fails loudly if the fixture ever refuses. */
function mustReplay(input: ReturnType<typeof incidentInput>) {
  const r = replayIncident(input);
  if (!r.ok) throw new Error(`fixture replay refused: ${r.reason}/${r.offender}`);
  return r.replay;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("incident replay — determinism", () => {
  it("replays the incident into a canonical timeline over both REAL sources", () => {
    const r = replayIncident(incidentInput());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const sources = new Set(r.replay.timeline.map((s) => s.source));
    expect(sources.has("execution")).toBe(true);
    expect(sources.has("journal")).toBe(true);
    // Canonical order: non-decreasing `at` across the merged timeline.
    const ats = r.replay.timeline.map((s) => s.at);
    expect(ats).toEqual([...ats].sort((a, b) => a - b));
  });

  it("BYTE-IDENTICAL RE-REPLAY: replaying twice produces identical canonical JSON", () => {
    const input = incidentInput();
    const a = replayIncident(input);
    const b = replayIncident(input);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(verifyIncidentReplayDeterminism(input)).toMatchObject({ deterministic: true });
  });

  it("input array order never leaks (journal/ledger permutations are stable)", () => {
    const input = incidentInput();
    const a = replayIncident(input);
    const b = replayIncident({
      tenantId: input.tenantId,
      journal: [...input.journal].reverse(),
      ledger: [...input.ledger].reverse(),
    });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("the replay reuses the REAL per-command view (dead-letter tail preserved)", () => {
    const r = replayIncident(incidentInput());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.replay.commands).toHaveLength(2);
    const dead = r.replay.commands.find((c) => c.idempotencyKey === "plan|s2|n1");
    expect(dead).toMatchObject({
      status: "dead-lettered", attempts: 4, lastFailureReason: "transport error 3",
    });
  });

  it("the decision sequence fingerprint is deterministic and covers every step", () => {
    const r = replayIncident(incidentInput());
    if (!r.ok) throw new Error("replay refused");
    expect(r.replay.decisionSequence).toHaveLength(r.replay.timeline.length);
    expect(new Set(r.replay.decisionSequence).size).toBe(r.replay.timeline.length);
    expect(r.replay.replayDigest).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("incident replay — divergence detection", () => {
  it("identical inputs report NO divergence", () => {
    const input = incidentInput();
    const recorded = mustReplay(input);
    const replayed = mustReplay(input);
    expect(diffIncidentReplays(recorded, replayed)).toMatchObject({ diverged: false, stepIndex: null });
  });

  it("a tampered journal detail pins the FIRST divergent entry", () => {
    const input = incidentInput();
    const recorded = mustReplay(input);
    // The forensic replay runs over MODIFIED inputs: one journal event's kind
    // is different from what was recorded.
    const tamperedJournal = input.journal.map((e, i) =>
      i === 1 ? { ...e, kind: "action.cancelled" as const } : e,
    );
    const replayed = replayIncident({ ...input, journal: tamperedJournal });
    if (!replayed.ok) throw new Error("tampered replay refused");
    const d = diffIncidentReplays(recorded, replayed.replay);
    expect(d.diverged).toBe(true);
    expect(d.field).toBe("kind");
    expect(d.expected).toBe("action.confirmed");
    expect(d.actual).toBe("action.cancelled");
    // Pinned to the FIRST divergence — everything before it agrees.
    for (let i = 0; i < d.stepIndex!; i += 1) {
      expect(recorded.timeline[i]!.stepDigest).toBe(replayed.replay.timeline[i]!.stepDigest);
    }
  });

  it("a dropped execution entry pins timeline-length divergence at the truncation point", () => {
    const input = incidentInput();
    const recorded = mustReplay(input);
    const shortLedger = input.ledger.slice(0, -1);
    const replayed = replayIncident({ ...input, ledger: shortLedger });
    if (!replayed.ok) throw new Error("short replay refused");
    const d = diffIncidentReplays(recorded, replayed.replay);
    expect(d.diverged).toBe(true);
    expect(d.field).toBe("timeline-length");
    expect(d.stepIndex).toBe(replayed.replay.timeline.length);
    expect(d.expected).toBe(String(recorded.timeline.length));
    expect(d.actual).toBe(String(replayed.replay.timeline.length));
  });

  it("a shifted ledger timestamp pins the divergent step with both values", () => {
    const input = incidentInput();
    const recorded = mustReplay(input);
    const shifted = input.ledger.map((e) => (e.index === 4 ? { ...e, at: e.at + 5_000 } : e));
    const replayed = replayIncident({ ...input, ledger: shifted });
    if (!replayed.ok) throw new Error("shifted replay refused");
    const d = diffIncidentReplays(recorded, replayed.replay);
    expect(d.diverged).toBe(true);
    expect(d.field).toBe("at");
    expect(d.stepIndex).not.toBeNull();
    expect(Number(d.actual!)).toBeGreaterThan(Number(d.expected!));
  });

  it("divergence in a later step does not misreport earlier agreement", () => {
    const input = incidentInput();
    const recorded = mustReplay(input);
    // Tamper only the LAST ledger entry's detail (not part of the step kind,
    // but the dead-letter kind position changes if we swap it).
    const swapped = input.ledger.map((e) =>
      e.index === input.ledger.length - 1 ? { ...e, kind: "completed" as const } : e,
    );
    const replayed = replayIncident({ ...input, ledger: swapped });
    if (!replayed.ok) throw new Error("swapped replay refused");
    const d = diffIncidentReplays(recorded, replayed.replay);
    expect(d.diverged).toBe(true);
    expect(d.stepIndex).toBe(recorded.timeline.length - 1);
  });
});

describe("incident replay — A8 tenant fail-closed", () => {
  it("refuses a cross-tenant ledger entry, naming the offender index", () => {
    const input = incidentInput();
    const foreign: ExecutionLedgerEntry = { ...input.ledger[2]!, tenantId: "tnt_other" };
    const r = replayIncident({ ...input, ledger: [...input.ledger.slice(0, 2), foreign] });
    expect(r).toMatchObject({ ok: false, reason: "replay.tenant-mismatch", offender: "ledger#2" });
  });

  it("refuses a cross-tenant journal event, naming the offender eventId", () => {
    const input = incidentInput();
    const foreign: ActionAuditEvent = { ...input.journal[0]!, tenantId: "tnt_other" };
    const r = replayIncident({ ...input, journal: [foreign, ...input.journal.slice(1)] });
    expect(r).toMatchObject({ ok: false, reason: "replay.tenant-mismatch" });
    if (!r.ok) expect(r.offender).toContain("journal:");
  });

  it("refuses an empty tenant scope", () => {
    const r = replayIncident({ tenantId: "", ledger: [], journal: [] });
    expect(r).toMatchObject({ ok: false, reason: "replay.missing-tenant" });
  });

  it("refuses a structurally inconsistent ledger with the REAL refusal surfaced", () => {
    // An acked command with no submitted predecessor — the REAL replay
    // refuses (ledger.index_gap); the incident replay surfaces it verbatim.
    let ledger: readonly ExecutionLedgerEntry[] = [];
    const r1 = appendExecutionLedger(ledger, {
      tenantId: TENANT, idempotencyKey: "k", kind: "acked", at: 1_000,
    });
    if (!r1.ok) throw new Error("fixture refused");
    ledger = r1.ledger;
    const r = replayIncident({ tenantId: TENANT, ledger, journal: [] });
    expect(r).toMatchObject({ ok: false, reason: "replay.ledger-refused", offender: "ledger.index_gap" });
  });
});
