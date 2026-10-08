/**
 * @fleetos/apify — Wave 5 job-lifecycle tests (operational-truth grade).
 *
 * Themes: legal/illegal transitions + terminal states; Guardian decision
 * required at `authorized` (input, never minted); rate-budget ceiling
 * behavior (integer bps, ceiling-not-authorization); idempotency keys;
 * manifests with digests; expiry by logical time; tenant fail-closed.
 */
import { describe, expect, it } from "vitest";
import {
  accountRateBudget,
  authorizeActorJob,
  buildJobManifest,
  completeActorJob,
  createActorJob,
  createActorJobIdempotent,
  expireActorJob,
  failActorJob,
  openRateBudgetLedger,
  reserveRateBudget,
  scheduleActorJob,
  startActorJob,
  verifyJobManifest,
  type ActorJobRecord,
  type CreateJobDraft,
  type GuardianDecisionRefLike,
  type TenantScope,
} from "../src/index.js";

const TENANT: TenantScope = { tenantId: "acme" };
const ALLOW: GuardianDecisionRefLike = { decisionId: "d-1", authorized: true, reasonCode: "allow.matched_rule" };
const DENY: GuardianDecisionRefLike = { decisionId: "d-2", authorized: false, reasonCode: "block.policy" };

function draft(now = 100, expiresAt: number | null = null): CreateJobDraft {
  return { tenant: TENANT, jobId: "job-1", actorId: "actor-1", input: { url: "https://example.test" }, idempotencyKey: "k-1", window: "w-2026-01", now, expiresAt };
}

function proposedJob(): ActorJobRecord {
  const created = createActorJob(draft());
  if (!created.ok) throw new Error("createActorJob failed");
  return created.job;
}

describe("job-lifecycle — legal path", () => {
  it("walks proposed → authorized → scheduled → running → completed", () => {
    const authorized = authorizeActorJob(proposedJob(), ALLOW, 101);
    expect(authorized).toMatchObject({ ok: true, job: { status: "authorized", authorization: { decisionId: "d-1" } } });
    const ledger = openRateBudgetLedger(TENANT, "w-2026-01", 100);
    expect(ledger.ok).toBe(true);
    if (!authorized.ok || !ledger.ok) return;
    const scheduled = scheduleActorJob(authorized.job, ledger.ledger, 10, 102);
    expect(scheduled.job).toMatchObject({ ok: true, job: { status: "scheduled", reservedUnits: 10 } });
    if (!scheduled.job.ok) return;
    const running = startActorJob(scheduled.job.job, 103);
    expect(running).toMatchObject({ ok: true, job: { status: "running" } });
    if (!running.ok) return;
    const completed = completeActorJob(running.job, 104);
    expect(completed).toMatchObject({ ok: true, job: { status: "completed" } });
  });

  it("running → failed records the typed failure reason", () => {
    const authorized = authorizeActorJob(proposedJob(), ALLOW, 101);
    const ledger = openRateBudgetLedger(TENANT, "w-2026-01", 100);
    if (!authorized.ok || !ledger.ok) return;
    const scheduled = scheduleActorJob(authorized.job, ledger.ledger, 1, 102);
    if (!scheduled.job.ok) return;
    const running = startActorJob(scheduled.job.job, 103);
    if (!running.ok) return;
    const failed = failActorJob(running.job, "ACTOR_TIMEOUT", 104);
    expect(failed).toMatchObject({ ok: true, job: { status: "failed", failure: { reasonCode: "ACTOR_TIMEOUT" } } });
  });
});

describe("job-lifecycle — Guardian decision is an INPUT, never minted", () => {
  it("refuses authorization with no decision (AUTHORIZATION_REQUIRED)", () => {
    expect(authorizeActorJob(proposedJob(), null, 101)).toMatchObject({ ok: false, reasonCode: "AUTHORIZATION_REQUIRED" });
  });

  it("refuses a denied decision (AUTHORIZATION_DENIED)", () => {
    expect(authorizeActorJob(proposedJob(), DENY, 101)).toMatchObject({ ok: false, reasonCode: "AUTHORIZATION_DENIED" });
  });

  it("refuses a decision without a decisionId (AUTHORIZATION_DECISION_ID_EMPTY)", () => {
    const anonymous = { decisionId: "  ", authorized: true, reasonCode: "allow" } as GuardianDecisionRefLike;
    expect(authorizeActorJob(proposedJob(), anonymous, 101)).toMatchObject({ ok: false, reasonCode: "AUTHORIZATION_DECISION_ID_EMPTY" });
  });

  it("created jobs always carry authorization=null (no minting path exists)", () => {
    expect(proposedJob().authorization).toBeNull();
  });

  it("scheduling requires the attached authorization even in authorized state", () => {
    const stripped: ActorJobRecord = { ...proposedJob(), status: "authorized", authorization: null };
    const ledger = openRateBudgetLedger(TENANT, "w-2026-01", 100);
    if (!ledger.ok) return;
    const result = scheduleActorJob(stripped, ledger.ledger, 1, 101);
    expect(result.job).toMatchObject({ ok: false, reasonCode: "AUTHORIZATION_REQUIRED" });
  });
});

describe("job-lifecycle — illegal transitions + terminal states", () => {
  it("refuses scheduling a proposed job (must authorize first)", () => {
    const ledger = openRateBudgetLedger(TENANT, "w-2026-01", 100);
    if (!ledger.ok) return;
    expect(scheduleActorJob(proposedJob(), ledger.ledger, 1, 101).job).toMatchObject({ ok: false, reasonCode: "ILLEGAL_TRANSITION" });
  });

  it("refuses starting an unscheduled job and completing a non-running job", () => {
    expect(startActorJob(proposedJob(), 101)).toMatchObject({ ok: false, reasonCode: "ILLEGAL_TRANSITION" });
    expect(completeActorJob(proposedJob(), 101)).toMatchObject({ ok: false, reasonCode: "ILLEGAL_TRANSITION" });
  });

  it("refuses every command on a terminal job with TERMINAL_STATE", () => {
    const completed = completeActorJob({ ...proposedJob(), status: "running" }, 104);
    if (!completed.ok) return;
    expect(authorizeActorJob(completed.job, ALLOW, 105)).toMatchObject({ ok: false, reasonCode: "TERMINAL_STATE" });
    expect(startActorJob(completed.job, 105)).toMatchObject({ ok: false, reasonCode: "TERMINAL_STATE" });
    expect(expireActorJob(completed.job, 105)).toMatchObject({ ok: false, reasonCode: "TERMINAL_STATE" });
  });

  it("refuses failure without a reason (FAILURE_REASON_REQUIRED)", () => {
    const running: ActorJobRecord = { ...proposedJob(), status: "running" };
    expect(failActorJob(running, "", 104)).toMatchObject({ ok: false, reasonCode: "FAILURE_REASON_REQUIRED" });
  });
});

describe("job-lifecycle — expiry by logical time", () => {
  it("expires a proposed job at/after expiresAt", () => {
    const job = (() => {
      const created = createActorJob(draft(100, 200));
      if (!created.ok) throw new Error("create failed");
      return created.job;
    })();
    expect(expireActorJob(job, 199)).toMatchObject({ ok: false, reasonCode: "NOT_DUE_FOR_EXPIRY" });
    expect(expireActorJob(job, 200)).toMatchObject({ ok: true, job: { status: "expired" } });
  });

  it("refuses expiry when no expiration is set, and never expires a RUNNING job", () => {
    expect(expireActorJob(proposedJob(), 999)).toMatchObject({ ok: false, reasonCode: "NOT_DUE_FOR_EXPIRY" });
    const running: ActorJobRecord = { ...proposedJob(), status: "running", expiresAt: 100 };
    expect(expireActorJob(running, 500)).toMatchObject({ ok: false, reasonCode: "ILLEGAL_TRANSITION" });
  });
});

describe("job-lifecycle — rate budget is a ceiling, never an authorization", () => {
  it("refuses a reservation that exceeds the window budget with the exact overshoot", () => {
    const ledger = openRateBudgetLedger(TENANT, "w-2026-01", 10);
    if (!ledger.ok) return;
    const job = proposedJob();
    const spent = reserveRateBudget(ledger.ledger, job, 8, 101);
    expect(spent.ok).toBe(true);
    if (!spent.ok) return;
    expect(accountRateBudget(spent.ledger)).toMatchObject({ spentUnits: 8, budgetUnits: 10, utilizationBps: 8000, remainingUnits: 2, note: "ceiling-not-authorization" });
    const over = reserveRateBudget(spent.ledger, job, 3, 102);
    expect(over).toMatchObject({ ok: false, reasonCode: "RATE_BUDGET_EXCEEDED", overshootUnits: 1 });
  });

  it("floors utilization bps to integers (1/3 window → 3333 bps)", () => {
    const ledger = openRateBudgetLedger(TENANT, "w-2026-01", 3);
    if (!ledger.ok) return;
    const spent = reserveRateBudget(ledger.ledger, proposedJob(), 1, 101);
    expect(spent.ok).toBe(true);
    if (!spent.ok) return;
    expect(accountRateBudget(spent.ledger).utilizationBps).toBe(3333);
  });

  it("scheduleActorJob propagates the ceiling refusal (never clamps)", () => {
    const authorized = authorizeActorJob(proposedJob(), ALLOW, 101);
    const ledger = openRateBudgetLedger(TENANT, "w-2026-01", 5);
    if (!authorized.ok || !ledger.ok) return;
    const result = scheduleActorJob(authorized.job, ledger.ledger, 6, 102);
    expect(result.job).toMatchObject({ ok: false, reasonCode: "RATE_BUDGET_EXCEEDED" });
    expect(result.budget).toMatchObject({ ok: false, reasonCode: "RATE_BUDGET_EXCEEDED", overshootUnits: 1 });
  });

  it("refuses cross-tenant and cross-window reservations (RATE_BUDGET_MISMATCH)", () => {
    const ledger = openRateBudgetLedger(TENANT, "w-2026-01", 100);
    if (!ledger.ok) return;
    const foreign: ActorJobRecord = { ...proposedJob(), tenant: { tenantId: "other" } };
    expect(reserveRateBudget(ledger.ledger, foreign, 1, 101)).toMatchObject({ ok: false, reasonCode: "RATE_BUDGET_MISMATCH" });
    const wrongWindow: ActorJobRecord = { ...proposedJob(), window: "w-2099-01" };
    expect(reserveRateBudget(ledger.ledger, wrongWindow, 1, 101)).toMatchObject({ ok: false, reasonCode: "RATE_BUDGET_MISMATCH" });
  });
});

describe("job-lifecycle — idempotency keys", () => {
  it("same key + same draft → the original job, duplicate: true", () => {
    const first = createActorJobIdempotent([], draft());
    expect(first).toMatchObject({ ok: true, duplicate: false });
    if (!first.ok) return;
    const second = createActorJobIdempotent([first.job], draft());
    expect(second).toMatchObject({ ok: true, duplicate: true, job: { jobId: first.job.jobId } });
  });

  it("same key + different draft → IDEMPOTENCY_KEY_CONFLICT", () => {
    const first = createActorJobIdempotent([], draft());
    if (!first.ok) return;
    const conflicting = createActorJobIdempotent([first.job], { ...draft(), actorId: "actor-2" });
    expect(conflicting).toMatchObject({ ok: false, reasonCode: "IDEMPOTENCY_KEY_CONFLICT" });
  });

  it("refuses an empty idempotency key at creation (IDEMPOTENCY_KEY_EMPTY)", () => {
    expect(createActorJob({ ...draft(), idempotencyKey: " " })).toMatchObject({ ok: false, reasonCode: "IDEMPOTENCY_KEY_EMPTY" });
  });
});

describe("job-lifecycle — manifests with digests", () => {
  it("builds a verifiable manifest; tampering is detected", () => {
    const manifest = buildJobManifest("job-1", "actor-1", { url: "https://example.test" }, 100);
    expect(verifyJobManifest(manifest)).toBe(true);
    expect(verifyJobManifest({ ...manifest, actorId: "actor-2" })).toBe(false);
  });

  it("verification is TOTAL: a non-JSON tampered inputCanonical fails cleanly (no throw)", () => {
    const manifest = buildJobManifest("job-1", "actor-1", { url: "https://example.test" }, 100);
    expect(verifyJobManifest({ ...manifest, inputCanonical: "{not json" })).toBe(false);
    expect(verifyJobManifest({ ...manifest, inputCanonical: "null" })).toBe(false);
    expect(verifyJobManifest({ ...manifest, inputCanonical: "[1,2]" })).toBe(false);
    expect(verifyJobManifest({ ...manifest, inputCanonical: "" })).toBe(false);
  });

  it("the job manifest digest is payload key-order independent", () => {
    const a = buildJobManifest("job-1", "actor-1", { url: "x", depth: 2 }, 100);
    const b = buildJobManifest("job-1", "actor-1", { depth: 2, url: "x" }, 100);
    expect(a.manifestDigest).toBe(b.manifestDigest);
  });

  it("carries the manifest on the created job and it verifies", () => {
    expect(verifyJobManifest(proposedJob().manifest)).toBe(true);
  });
});

describe("job-lifecycle — tenant fail-closed", () => {
  it("refuses creation with an invalid tenant (TENANT_SCOPE_MISSING)", () => {
    expect(createActorJob({ ...draft(), tenant: { tenantId: "" } as unknown as TenantScope })).toMatchObject({ ok: false, reasonCode: "TENANT_SCOPE_MISSING" });
  });

  it("refuses idempotent creation for a foreign tenant's existing key without leaking (no conflict, fresh job)", () => {
    const first = createActorJobIdempotent([], draft());
    if (!first.ok) return;
    const foreignTenant = createActorJobIdempotent([first.job], { ...draft(), tenant: { tenantId: "other" } });
    expect(foreignTenant).toMatchObject({ ok: true, duplicate: false });
  });
});
