/**
 * @fleetos/acceptance-commerce — actor-job failure/expiry journey (F321C,
 * Wave 12 lane C).
 *
 * The F310C §3.2 row-13 slot: the actor-job failure and expiry surfaces
 * of `@fleetos/apify` job-lifecycle.ts — `failActorJob` and
 * `expireActorJob` were wired in drivers-external.ts but exercised by NO
 * journey (only start/complete transitions were used), and
 * `createActorJobIdempotent` had zero references anywhere in the
 * acceptance corpora (machine-verified with rg; see the F321C report §3).
 *
 * CONTRACT-LEVEL LOCAL LIFECYCLE ONLY: every step drives the local
 * job-record state machine over a logical clock. This journey makes NO
 * live or sandbox Apify provider claim anywhere — Apify stays
 * CONTRACT_ONLY until its own provider-readiness evidence passes.
 */

import type { AcceptanceJourney, FactValue } from "../journey-contracts.js";

const eq = (id: string, fact: string, expected: FactValue, description: string) =>
  ({ id, description, fact, op: "eq" as const, expected });
const deq = (id: string, fact: string, expected: readonly string[], description: string) =>
  ({ id, description, fact, op: "deepEq" as const, expected });

export const actorJobFailureExpiryJourney: AcceptanceJourney = {
  id: "actor-job-failure-expiry",
  persona: "vendor-manager",
  capability: "actor-jobs",
  goal: "Exercise the actor-job terminal surfaces as LOCAL contract-level lifecycle behavior (no live Apify claim): idempotent creation dedupes by key + manifest digest (same key, different draft → typed conflict; a foreign-tenant job with the same key never collides); failure is legal ONLY from a running job with a non-empty reason code (terminal afterwards); expiry is legal only at/after expiresAt and NEVER from a running job — a running job completes or fails.",
  steps: [
    { stepId: "s1", kind: "apify-job-create", jobId: "job-fx-1", actorId: "vendor-price-scraper", window: "2026-W01" },
    { stepId: "s2", kind: "apify-job-create-idempotent", factKey: "dup", jobId: "job-fx-1", actorId: "vendor-price-scraper",
      window: "2026-W01", idempotencyKey: "idem-job-fx-1", prior: "current", inputTag: "same", nowMs: 1_000, expiresAtMs: 6_000 },
    { stepId: "s3", kind: "apify-job-create-idempotent", factKey: "conflict", jobId: "job-fx-1", actorId: "vendor-price-scraper",
      window: "2026-W01", idempotencyKey: "idem-job-fx-1", prior: "current", inputTag: "different", nowMs: 1_000, expiresAtMs: 6_000 },
    { stepId: "s4", kind: "apify-job-create-idempotent", factKey: "foreign", jobId: "job-fx-1", actorId: "vendor-price-scraper",
      window: "2026-W01", idempotencyKey: "idem-job-fx-1", prior: "foreign-same-key", inputTag: "same", nowMs: 1_000, expiresAtMs: 6_000 },
    { stepId: "s5", kind: "apify-job-fail", factKey: "fromProposed", reasonCode: "ACTOR_ERROR" },
    { stepId: "s6", kind: "apify-job-authorize", decisionId: "gd-fx-1", authorized: true, reasonCode: "within-policy" },
    { stepId: "s7", kind: "apify-job-fail", factKey: "fromAuthorized", reasonCode: "ACTOR_ERROR" },
    { stepId: "s8", kind: "apify-job-schedule", units: 3 },
    { stepId: "s9", kind: "apify-job-fail", factKey: "fromScheduled", reasonCode: "ACTOR_ERROR" },
    { stepId: "s10", kind: "apify-job-transition", command: "start" },
    { stepId: "s11", kind: "apify-job-fail", factKey: "noReason", reasonCode: "" },
    { stepId: "s12", kind: "apify-job-fail", factKey: "fail", reasonCode: "ACTOR_ERROR" },
    { stepId: "s13", kind: "apify-job-fail", factKey: "terminal", reasonCode: "ACTOR_ERROR" },
    { stepId: "s14", kind: "apify-job-create", jobId: "job-fx-2", actorId: "vendor-price-scraper", window: "2026-W01" },
    { stepId: "s15", kind: "apify-job-authorize", decisionId: "gd-fx-2", authorized: true, reasonCode: "within-policy" },
    { stepId: "s16", kind: "apify-job-schedule", units: 3 },
    { stepId: "s17", kind: "apify-job-expire-at", factKey: "early", nowMs: 5_000 },
    { stepId: "s18", kind: "apify-job-expire-at", factKey: "due", nowMs: 6_000 },
    { stepId: "s19", kind: "apify-job-expire-at", factKey: "expiredTerminal", nowMs: 6_000 },
    { stepId: "s20", kind: "apify-job-create", jobId: "job-fx-3", actorId: "vendor-price-scraper", window: "2026-W01" },
    { stepId: "s21", kind: "apify-job-authorize", decisionId: "gd-fx-3", authorized: true, reasonCode: "within-policy" },
    { stepId: "s22", kind: "apify-job-schedule", units: 3 },
    { stepId: "s23", kind: "apify-job-transition", command: "start" },
    { stepId: "s24", kind: "apify-job-expire-at", factKey: "running", nowMs: 6_000 },
    { stepId: "s25", kind: "apify-job-fail", factKey: "runningFail", reasonCode: "RUNTIME_TIMEOUT" },
  ],
  assertions: [
    eq("a1", "apify.manifestVerified", true, "the created job's manifest digest verifies"),
    eq("a2", "apifyIdem.dup.ok", true, "the idempotent create over the same key + same draft succeeds"),
    eq("a3", "apifyIdem.dup.duplicate", true, "…and reports the ORIGINAL job (duplicate, never a second record)"),
    eq("a4", "apifyIdem.dup.jobId", "job-fx-1", "the duplicate returns the original job id"),
    eq("a5", "apifyIdem.dup.status", "proposed", "the duplicate returns the original's CURRENT status"),
    eq("a6", "apifyIdem.conflict.ok", false, "the same key with a DIFFERENT draft refuses"),
    eq("a7", "apifyIdem.conflict.reasonCode", "IDEMPOTENCY_KEY_CONFLICT", "the conflict is typed — the key was used for a different job"),
    eq("a8", "apifyIdem.foreign.ok", true, "a foreign-tenant job carrying the same key does not collide"),
    eq("a9", "apifyIdem.foreign.duplicate", false, "the tenant scope makes the same key genuinely distinct — this is a FRESH create"),
    eq("a10", "apifyIdem.foreign.tenantId", "acme", "the created job belongs to the caller's tenant"),
    eq("a11", "apifyFail.fromProposed.ok", false, "failing a job that has not started refuses"),
    eq("a12", "apifyFail.fromProposed.reasonCode", "ILLEGAL_TRANSITION", "failActorJob requires running — the refusal names the transition law"),
    eq("a13", "apifyFail.fromAuthorized.reasonCode", "ILLEGAL_TRANSITION", "failing an authorized (not running) job refuses"),
    eq("a14", "apifyFail.fromScheduled.reasonCode", "ILLEGAL_TRANSITION", "failing a scheduled (not running) job refuses"),
    eq("a15", "apifyFail.noReason.ok", false, "failing a running job without a reason code refuses"),
    eq("a16", "apifyFail.noReason.reasonCode", "FAILURE_REASON_REQUIRED", "the failure reason is REQUIRED — never invented"),
    eq("a17", "apifyFail.fail.ok", true, "failing a running job with a reason succeeds"),
    eq("a18", "apifyFail.fail.status", "failed", "the job is failed"),
    eq("a19", "apifyFail.fail.failureReasonCode", "ACTOR_ERROR", "the failure record carries the caller's reason code verbatim"),
    eq("a20", "apifyFail.terminal.ok", false, "a failed job is TERMINAL — no second failure"),
    eq("a21", "apifyFail.terminal.reasonCode", "TERMINAL_STATE", "the terminal refusal names the finality"),
    eq("a22", "apifyExpire.early.ok", false, "expiring a job before its expiresAt refuses"),
    eq("a23", "apifyExpire.early.reasonCode", "NOT_DUE_FOR_EXPIRY", "the expiry window is respected — never expired early"),
    eq("a24", "apifyExpire.due.ok", true, "expiring a scheduled job at/after expiresAt succeeds"),
    eq("a25", "apifyExpire.due.status", "expired", "the job is expired"),
    eq("a26", "apifyExpire.expiredTerminal.reasonCode", "TERMINAL_STATE", "an expired job is terminal — no re-expiry"),
    eq("a27", "apifyExpire.running.ok", false, "a RUNNING job is NEVER expired — even past expiresAt"),
    eq("a28", "apifyExpire.running.reasonCode", "ILLEGAL_TRANSITION", "a running job completes or fails; the law is named"),
    eq("a29", "apifyFail.runningFail.ok", true, "the running job instead ends by FAILURE with its own reason code"),
    eq("a30", "apifyFail.runningFail.failureReasonCode", "RUNTIME_TIMEOUT", "the running failure carries the reason verbatim"),
    deq("a31", "apifyFx.log", [
      "job-fx-1:duplicate", "job-fx-1:refused:IDEMPOTENCY_KEY_CONFLICT", "job-fx-1:fresh",
      "job-fx-1:ILLEGAL_TRANSITION", "job-fx-1:ILLEGAL_TRANSITION", "job-fx-1:ILLEGAL_TRANSITION",
      "job-fx-1:FAILURE_REASON_REQUIRED", "job-fx-1:failed", "job-fx-1:TERMINAL_STATE",
      "job-fx-2:NOT_DUE_FOR_EXPIRY", "job-fx-2:expired", "job-fx-2:TERMINAL_STATE",
      "job-fx-3:ILLEGAL_TRANSITION", "job-fx-3:failed",
    ], "the full contract-level terminal lifecycle of all three jobs, refusals first-class"),
    deq("a32", "apify.statusLog", [
      "job-fx-1:proposed", "job-fx-1:authorized", "job-fx-1:scheduled", "job-fx-1:running",
      "job-fx-2:proposed", "job-fx-2:authorized", "job-fx-2:scheduled",
      "job-fx-3:proposed", "job-fx-3:authorized", "job-fx-3:scheduled", "job-fx-3:running",
    ], "the Guardian-gated forward lifecycle of all three jobs (decisions are inputs, never minted)"),
  ],
};

export const ACTOR_JOBS_JOURNEYS: readonly AcceptanceJourney[] = [
  actorJobFailureExpiryJourney,
];
