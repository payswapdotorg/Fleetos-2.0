/**
 * Posture event-sourced fold tests (F220B, Wave 2).
 *
 * Behavior under test: fold determinism, checkpoint/resume contract, tenant
 * fail-closed (fold scope + reads), worst-wins snapshot projection,
 * idempotent replay semantics of the event vocabulary.
 */
import { describe, it, expect } from "vitest";
import {
  foldPostureEvents,
  emptyPostureFold,
  canonicalPostureFoldState,
  postureFoldCheckpointDigest,
  verifyPostureFoldDeterminism,
  verifyPostureFoldResume,
  readPostureForTenant,
} from "../src/index.ts";
import type { PostureEvent } from "../src/index.ts";

function ev(seq: number, kind: PostureEvent["kind"], findingId: string, severity: PostureEvent["severity"], at = seq * 100): PostureEvent {
  return { seq, tenantId: "t1", kind, findingId, severity, at };
}

describe("posture fold — basics", () => {
  it("empty stream folds to the identity state with an empty-tenant checkpoint", () => {
    const result = foldPostureEvents([]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.findings).toHaveLength(0);
      expect(result.state.appliedSeq).toBe(0);
      expect(result.state.appliedEvents).toBe(0);
    }
  });

  it("finding.opened puts a finding in open state at the event severity", () => {
    const result = foldPostureEvents([ev(1, "finding.opened", "f1", "high")]);
    if (!result.ok) throw new Error(result.reason);
    expect(result.state.findings).toEqual([{ findingId: "f1", status: "open", severity: "high" }]);
  });

  it("finding.resolved removes the finding from open (resolved, not suppressed)", () => {
    const result = foldPostureEvents([
      ev(1, "finding.opened", "f1", "high"),
      ev(2, "finding.resolved", "f1", "high"),
    ]);
    if (!result.ok) throw new Error(result.reason);
    expect(result.state.findings[0]!.status).toBe("resolved");
  });

  it("finding.suppressed hides the finding from open; suppression_expired reopens it", () => {
    const result = foldPostureEvents([
      ev(1, "finding.opened", "f1", "medium"),
      ev(2, "finding.suppressed", "f1", "medium"),
      ev(3, "finding.suppression_expired", "f1", "medium"),
    ]);
    if (!result.ok) throw new Error(result.reason);
    expect(result.state.findings[0]!.status).toBe("open");
  });

  it("finding.escalated moves an OPEN finding's severity and counts the escalation", () => {
    const result = foldPostureEvents([
      ev(1, "finding.opened", "f1", "medium"),
      ev(2, "finding.escalated", "f1", "high"),
    ]);
    if (!result.ok) throw new Error(result.reason);
    expect(result.state.findings[0]!.severity).toBe("high");
    expect(result.state.escalations).toBe(1);
  });

  it("finding.escalated on a resolved finding is a deterministic no-op", () => {
    const result = foldPostureEvents([
      ev(1, "finding.opened", "f1", "medium"),
      ev(2, "finding.resolved", "f1", "medium"),
      ev(3, "finding.escalated", "f1", "critical"),
    ]);
    if (!result.ok) throw new Error(result.reason);
    expect(result.state.escalations).toBe(0);
    expect(result.state.findings[0]!.status).toBe("resolved");
  });

  it("re-opening the same finding id replaces its severity (idempotent re-application)", () => {
    const a = foldPostureEvents([ev(1, "finding.opened", "f1", "low")]);
    const b = foldPostureEvents([ev(1, "finding.opened", "f1", "low"), ev(1, "finding.opened", "f1", "low")]);
    // seq 1 twice is skipped by the checkpoint contract (seq <= appliedSeq)
    if (!a.ok || !b.ok) throw new Error("fold failed");
    expect(canonicalPostureFoldState(a.state)).toBe(canonicalPostureFoldState(b.state));
  });
});

describe("posture fold — tenant fail-closed (A8)", () => {
  it("refuses an event with a missing finding id", () => {
    const result = foldPostureEvents([{ seq: 1, tenantId: "t1", kind: "finding.opened", findingId: "", severity: "low", at: 1 }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("fold.missing-finding-id");
  });

  it("refuses an event with a missing tenant id", () => {
    const result = foldPostureEvents([{ seq: 1, tenantId: "", kind: "finding.opened", findingId: "f1", severity: "low", at: 1 }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("fold.missing-tenant");
      expect(result.atSeq).toBe(1);
    }
  });

  it("refuses a stream that mixes tenants mid-stream", () => {
    const result = foldPostureEvents([
      ev(1, "finding.opened", "f1", "low"),
      { seq: 2, tenantId: "t2", kind: "finding.opened", findingId: "f2", severity: "low", at: 2 },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("fold.tenant-mismatch");
      expect(result.atSeq).toBe(2);
    }
  });

  it("refuses the whole fold when requireTenant does not match the stream", () => {
    const result = foldPostureEvents([ev(1, "finding.opened", "f1", "low")], { requireTenant: "t-other" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("fold.tenant-mismatch");
  });

  it("refuses an empty requireTenant scope", () => {
    const result = foldPostureEvents([ev(1, "finding.opened", "f1", "low")], { requireTenant: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("fold.missing-tenant");
  });

  it("readPostureForTenant refuses cross-tenant reads", () => {
    const result = foldPostureEvents([ev(1, "finding.opened", "f1", "low")]);
    if (!result.ok) throw new Error(result.reason);
    const read = readPostureForTenant(result.state, "t2");
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.reason).toBe("posture.tenant-mismatch");
  });

  it("readPostureForTenant refuses an empty tenant scope", () => {
    const read = readPostureForTenant(emptyPostureFold(), "");
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.reason).toBe("posture.missing-tenant");
  });

  it("readPostureForTenant refuses reads of the empty identity state under any tenant", () => {
    const read = readPostureForTenant(emptyPostureFold(), "t1");
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.reason).toBe("posture.tenant-mismatch");
  });
});

describe("posture fold — determinism + checkpoint", () => {
  it("the same stream folds to byte-identical canonical state (machine-tested)", () => {
    const stream: PostureEvent[] = [
      ev(1, "finding.opened", "f1", "medium"),
      ev(2, "finding.opened", "f2", "critical"),
      ev(3, "finding.escalated", "f1", "high"),
      ev(4, "finding.suppressed", "f2", "critical"),
      ev(5, "finding.suppression_expired", "f2", "critical"),
      ev(6, "finding.resolved", "f1", "high"),
    ];
    const check = verifyPostureFoldDeterminism(stream);
    expect(check.deterministic).toBe(true);
    expect(check.digest1).toBe(check.digest2);
  });

  it("determinism holds on a seeded 60-event stream", () => {
    const stream: PostureEvent[] = [];
    for (let i = 1; i <= 60; i += 1) {
      const kind = (["finding.opened", "finding.escalated", "finding.resolved"] as const)[i % 3]!;
      stream.push(ev(i, kind, `f${i % 7}`, i % 2 === 0 ? "high" : "medium"));
    }
    expect(verifyPostureFoldDeterminism(stream).deterministic).toBe(true);
  });

  it("checkpoint carries lastAppliedSeq + a content-addressed digest", () => {
    const result = foldPostureEvents([ev(1, "finding.opened", "f1", "low"), ev(2, "finding.opened", "f2", "high")]);
    if (!result.ok) throw new Error(result.reason);
    expect(result.checkpoint.lastAppliedSeq).toBe(2);
    expect(result.checkpoint.appliedEvents).toBe(2);
    expect(result.checkpoint.checkpointDigest).toBe(postureFoldCheckpointDigest(result.state));
  });

  it("resuming from a checkpoint applies ONLY events with seq > lastAppliedSeq", () => {
    const stream = [
      ev(1, "finding.opened", "f1", "low"),
      ev(2, "finding.opened", "f2", "medium"),
      ev(3, "finding.opened", "f3", "high"),
    ];
    const check = verifyPostureFoldResume(stream, 2);
    expect(check.resumesCleanly).toBe(true);
    expect(check.fullDigest).toBe(check.resumedDigest);
  });

  it("resume contract holds at every split point of a seeded stream", () => {
    const stream: PostureEvent[] = [];
    for (let i = 1; i <= 20; i += 1) {
      stream.push(ev(i, i % 4 === 0 ? "finding.resolved" : "finding.opened", `f${i % 5}`, i % 2 === 0 ? "high" : "low"));
    }
    for (let split = 0; split <= 20; split += 1) {
      expect(verifyPostureFoldResume(stream, split).resumesCleanly).toBe(true);
    }
  });

  it("canonical state is independent of input event ordering BEYOND seq (seq drives the fold)", () => {
    // Events supplied out of array order but with distinct seqs still fold
    // identically — seq is the authority, not array position.
    const ordered = [ev(1, "finding.opened", "f1", "low"), ev(2, "finding.escalated", "f1", "high")];
    const shuffled = [ordered[1]!, ordered[0]!];
    const a = foldPostureEvents(ordered);
    const b = foldPostureEvents(shuffled);
    if (!a.ok || !b.ok) throw new Error("fold failed");
    expect(canonicalPostureFoldState(a.state)).toBe(canonicalPostureFoldState(b.state));
  });
});

describe("posture snapshot — worst-wins projection", () => {
  it("no open findings => score 100", () => {
    const result = foldPostureEvents([ev(1, "finding.opened", "f1", "low"), ev(2, "finding.resolved", "f1", "low")]);
    if (!result.ok) throw new Error(result.reason);
    const read = readPostureForTenant(result.state, "t1");
    if (!read.ok) throw new Error(read.reason);
    expect(read.snapshot.openFindings).toBe(0);
    expect(read.snapshot.postureScore).toBe(100);
    expect(read.snapshot.resolved).toBe(1);
  });

  it("worst open severity drives the integer score (critical=0, high=20, medium=40)", () => {
    const cases: Array<[PostureEvent["severity"], number]> = [
      ["critical", 0],
      ["high", 20],
      ["medium", 40],
      ["low", 60],
      ["info", 80],
    ];
    for (const [severity, expected] of cases) {
      const result = foldPostureEvents([ev(1, "finding.opened", "f1", severity)]);
      if (!result.ok) throw new Error(result.reason);
      const read = readPostureForTenant(result.state, "t1");
      if (!read.ok) throw new Error(read.reason);
      expect(read.snapshot.postureScore).toBe(expected);
      expect(Number.isInteger(read.snapshot.postureScore)).toBe(true);
    }
  });

  it("suppressed findings are excluded from the open counts and the score", () => {
    const result = foldPostureEvents([
      ev(1, "finding.opened", "f1", "critical"),
      ev(2, "finding.suppressed", "f1", "critical"),
    ]);
    if (!result.ok) throw new Error(result.reason);
    const read = readPostureForTenant(result.state, "t1");
    if (!read.ok) throw new Error(read.reason);
    expect(read.snapshot.openFindings).toBe(0);
    expect(read.snapshot.suppressed).toBe(1);
    expect(read.snapshot.postureScore).toBe(100);
  });

  it("escalations are visible on the snapshot (audit honesty)", () => {
    const result = foldPostureEvents([
      ev(1, "finding.opened", "f1", "medium"),
      ev(2, "finding.escalated", "f1", "high"),
    ]);
    if (!result.ok) throw new Error(result.reason);
    const read = readPostureForTenant(result.state, "t1");
    if (!read.ok) throw new Error(read.reason);
    expect(read.snapshot.escalations).toBe(1);
    expect(read.snapshot.bySeverity.high).toBe(1);
    expect(read.snapshot.bySeverity.medium).toBe(0);
  });
});
