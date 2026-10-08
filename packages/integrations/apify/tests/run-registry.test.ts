/**
 * @fleetos/apify — Wave 5 run-registry tests (operational-truth grade).
 *
 * Themes: append-only journal with chained digests + tamper detection;
 * replay == state; checkpoint fold == full fold; index by job/status/
 * window with deterministic ordering; monotonic event times; fail-closed
 * cross-tenant appends and lookups.
 */
import { describe, expect, it } from "vitest";
import {
  appendRunEvent,
  foldFromCheckpoint,
  foldRunJournal,
  lookupRun,
  openRunJournal,
  queryRunsByStatus,
  queryRunsByWindow,
  verifyRunJournalChain,
  type RunEvent,
  type RunJournal,
  type TenantScope,
} from "../src/index.js";

const TENANT: TenantScope = { tenantId: "acme" };

function event(kind: RunEvent["kind"], jobId: string, at: number, extra: Partial<RunEvent> = {}): RunEvent {
  return { kind, tenant: TENANT, jobId, at, ...extra };
}

function journalOf(...events: readonly RunEvent[]): RunJournal {
  let journal = openRunJournal(TENANT);
  if (!journal.ok) throw new Error("openRunJournal failed");
  for (const e of events) {
    const appended = appendRunEvent(journal.journal, e);
    if (!appended.ok) throw new Error(`append failed: ${appended.reasonCode}`);
    journal = { ok: true, journal: appended.journal } as typeof journal;
  }
  return journal.journal;
}

describe("run-registry — journal + chained digests", () => {
  it("assigns 1-based sequences and chained run_ digests", () => {
    const journal = journalOf(
      event("job-created", "job-1", 100, { actorId: "actor-1" }),
      event("job-authorized", "job-1", 101, { decisionId: "d-1" }),
      event("job-started", "job-1", 103),
    );
    expect(journal.events.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(journal.events[0]?.digest.startsWith("run_")).toBe(true);
    expect(journal.events[1]?.digest).not.toBe(journal.events[0]?.digest);
  });

  it("verifyRunJournalChain passes on an honest journal and detects tampering at the earliest broken seq", () => {
    const journal = journalOf(
      event("job-created", "job-1", 100),
      event("job-authorized", "job-1", 101),
      event("job-completed", "job-1", 105),
    );
    expect(verifyRunJournalChain(journal)).toEqual({ ok: true });
    const tampered: RunJournal = {
      tenant: journal.tenant,
      events: journal.events.map((e, i) => (i === 1 ? { ...e, event: { ...e.event, at: 999 } } : e)),
    };
    expect(verifyRunJournalChain(tampered)).toMatchObject({ ok: false, reasonCode: "JOURNAL_CHAIN_BROKEN", brokenAtSeq: 2 });
  });

  it("refuses non-monotonic event times with EVENT_TIME_REGRESSION", () => {
    const journal = journalOf(event("job-created", "job-1", 100));
    const regression = appendRunEvent(journal, event("job-authorized", "job-1", 99));
    expect(regression).toMatchObject({ ok: false, reasonCode: "EVENT_TIME_REGRESSION" });
  });

  it("refuses invalid events with typed codes", () => {
    const journal = journalOf();
    expect(appendRunEvent(journal, event("job-created", " ", 100))).toMatchObject({ ok: false, reasonCode: "JOB_ID_EMPTY" });
    expect(appendRunEvent(journal, { ...event("job-created", "j", 100), kind: "nonsense" as RunEvent["kind"] })).toMatchObject({ ok: false, reasonCode: "EVENT_KIND_INVALID" });
    expect(appendRunEvent(journal, event("job-created", "j", -1))).toMatchObject({ ok: false, reasonCode: "LOGICAL_TIME_INVALID" });
  });

  it("append never mutates the input journal (append-only)", () => {
    const journal = journalOf(event("job-created", "job-1", 100));
    const appended = appendRunEvent(journal, event("job-authorized", "job-1", 101));
    expect(appended.ok).toBe(true);
    expect(journal.events).toHaveLength(1);
  });
});

describe("run-registry — fold: replay == state", () => {
  it("folds a journal into a status/window-indexed state with deterministic ordering", () => {
    const journal = journalOf(
      event("job-created", "job-b", 100, { actorId: "actor-1" }),
      event("job-created", "job-a", 100, { actorId: "actor-1" }),
      event("job-authorized", "job-b", 101, { decisionId: "d-1" }),
      event("job-scheduled", "job-b", 102, { window: "w-1", units: 5 }),
      event("job-started", "job-b", 103),
      event("job-completed", "job-b", 105),
      event("job-authorized", "job-a", 106, { decisionId: "d-2" }),
    );
    const state = foldRunJournal(journal);
    expect(state.jobs.get("job-b")).toMatchObject({ status: "completed", window: "w-1", eventCount: 5, lastEventAt: 105 });
    expect(state.jobs.get("job-a")).toMatchObject({ status: "authorized", window: null });
    expect(state.byStatus.get("completed")).toEqual(["job-b"]);
    expect(state.byStatus.get("authorized")).toEqual(["job-a"]);
    expect(state.byWindow.get("w-1")).toEqual(["job-b"]);
    expect(state.checkpoint).toBe(7);
  });

  it("folding twice produces a byte-identical state (replay == state)", () => {
    const journal = journalOf(
      event("job-created", "job-1", 100),
      event("job-authorized", "job-1", 101),
      event("job-failed", "job-1", 104, { reasonCode: "ACTOR_TIMEOUT" }),
      event("job-created", "job-2", 105),
      event("job-scheduled", "job-2", 106, { window: "w-1" }),
    );
    const a = foldRunJournal(journal);
    const b = foldRunJournal(journal);
    expect(a).toEqual(b);
  });

  it("checkpoint fold over the SAME journal converges to the identical full-replay state", () => {
    const journal = journalOf(
      event("job-created", "job-1", 100),
      event("job-authorized", "job-1", 101),
      event("job-scheduled", "job-1", 102, { window: "w-1" }),
      event("job-started", "job-1", 103),
      event("job-completed", "job-1", 104),
    );
    const full = foldRunJournal(journal);
    // Incremental: fold prefix, then fold the rest from the checkpoint.
    const prefix = foldRunJournal({ tenant: journal.tenant, events: journal.events.slice(0, 2) });
    const incremental = foldFromCheckpoint(prefix, journal);
    expect(incremental.ok).toBe(true);
    if (!incremental.ok) return;
    expect(incremental.state).toEqual(full);
    expect(incremental.state.checkpoint).toBe(5);
  });

  it("records the failure reason code on the folded entry", () => {
    const journal = journalOf(
      event("job-created", "job-1", 100),
      event("job-failed", "job-1", 101, { reasonCode: "ACTOR_TIMEOUT" }),
    );
    expect(foldRunJournal(journal).jobs.get("job-1")?.failureReasonCode).toBe("ACTOR_TIMEOUT");
  });
});

describe("run-registry — fail-closed queries", () => {
  it("refuses cross-tenant status/window queries with TENANT_MISMATCH", () => {
    const journal = journalOf(
      event("job-created", "job-1", 100),
      event("job-scheduled", "job-1", 101, { window: "w-1" }),
    );
    const state = foldRunJournal(journal);
    expect(queryRunsByStatus(state, { tenantId: "other" }, "scheduled")).toMatchObject({ ok: false, reasonCode: "TENANT_MISMATCH" });
    expect(queryRunsByWindow(state, { tenantId: "other" }, "w-1")).toMatchObject({ ok: false, reasonCode: "TENANT_MISMATCH" });
  });

  it("refuses cross-tenant appends with TENANT_MISMATCH", () => {
    const journal = journalOf();
    const cross = appendRunEvent(journal, { kind: "job-created", tenant: { tenantId: "other" }, jobId: "job-x", at: 100 });
    expect(cross).toMatchObject({ ok: false, reasonCode: "TENANT_MISMATCH" });
  });

  it("lookupRun returns null for both unknown and foreign job ids (no existence leak)", () => {
    const journal = journalOf(event("job-created", "job-1", 100));
    const state = foldRunJournal(journal);
    expect(lookupRun(state, TENANT, "job-1")).not.toBeNull();
    expect(lookupRun(state, { tenantId: "other" }, "job-1")).toBeNull();
    expect(lookupRun(state, TENANT, "nope")).toBeNull();
  });

  it("refuses a cross-tenant checkpoint fold (TENANT_MISMATCH)", () => {
    const journal = journalOf(event("job-created", "job-1", 100));
    const state = foldRunJournal(journal);
    const foreignJournal = journalOf(event("job-created", "x", 100));
    expect(foldFromCheckpoint({ ...state, tenant: { tenantId: "other" } }, foreignJournal)).toMatchObject({ ok: false, reasonCode: "TENANT_MISMATCH" });
  });
});
