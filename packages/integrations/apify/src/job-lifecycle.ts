/**
 * @fleetos/apify — actor job lifecycle (Wave 5, operational-truth grade).
 *
 * States: proposed → authorized → scheduled → running → completed | failed
 * (+ expired from proposed/authorized/scheduled — never from running).
 *
 * - GUARDIAN DECISIONS ARE INPUTS, NEVER MINTED (law A4): the only way a
 *   job becomes `authorized` is `authorizeActorJob(job, decision)` with a
 *   caller-supplied `GuardianDecisionRefLike` carrying authorized=true. No
 *   function in this package constructs a decision.
 * - IDEMPOTENCY KEYS: jobs carry a client key; `createActorJobsIdempotent`
 *   dedupes by key (same key + same draft digest → the original job with
 *   `duplicate: true`; different draft → typed conflict).
 * - RATE-BUDGET ACCOUNTING PER LOGICAL WINDOW in integer units, with
 *   utilization in integer bps (floored) and the ceiling-not-authorization
 *   vocabulary on every accounting result: staying within the budget NEVER
 *   authorizes anything — authorization is exclusively the Guardian input.
 * - JOB MANIFESTS WITH DIGESTS: the manifest digest is the FNV-1a digest
 *   over the canonical serialization of (jobId, actorId, input, createdAt)
 *   and `verifyJobManifest` recomputes it (tamper detection).
 *
 * Pure and deterministic: logical `now` is caller-supplied; no clocks, no
 * randomness, no network; inputs are never mutated.
 */
import { validateTenantScope, type GuardianDecisionRefLike, type TenantScope } from "./seam.js";
import { canonicalJson, fnv1a32Hex } from "./digest.js";

// ---------------------------------------------------------------------------
// Types.
// ---------------------------------------------------------------------------

export type ActorJobStatus =
  | "proposed"
  | "authorized"
  | "scheduled"
  | "running"
  | "completed"
  | "failed"
  | "expired";

export interface JobManifest {
  readonly jobId: string;
  readonly actorId: string;
  readonly inputCanonical: string;
  readonly createdAt: number;
  readonly manifestDigest: string;
}

export interface ActorJobRecord {
  readonly jobId: string;
  readonly tenant: TenantScope;
  readonly actorId: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly idempotencyKey: string;
  readonly status: ActorJobStatus;
  readonly authorization: GuardianDecisionRefLike | null;
  readonly window: string;
  readonly reservedUnits: number | null;
  readonly manifest: JobManifest;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly expiresAt: number | null;
  readonly failure: { readonly reasonCode: string; readonly detail: string } | null;
}

export type JobRefusalCode =
  | "TENANT_SCOPE_MISSING"
  | "JOB_ID_EMPTY"
  | "ACTOR_ID_EMPTY"
  | "IDEMPOTENCY_KEY_EMPTY"
  | "WINDOW_EMPTY"
  | "LOGICAL_TIME_INVALID"
  | "EXPIRES_AT_INVALID"
  | "ILLEGAL_TRANSITION"
  | "TERMINAL_STATE"
  | "AUTHORIZATION_REQUIRED"
  | "AUTHORIZATION_DENIED"
  | "AUTHORIZATION_DECISION_ID_EMPTY"
  | "RATE_UNITS_INVALID"
  | "RATE_BUDGET_EXCEEDED"
  | "RATE_BUDGET_MISMATCH"
  | "FAILURE_REASON_REQUIRED"
  | "NOT_DUE_FOR_EXPIRY"
  | "IDEMPOTENCY_KEY_CONFLICT"
  | "MANIFEST_MISMATCH";

export type JobCommandResult =
  | { readonly ok: true; readonly job: ActorJobRecord }
  | { readonly ok: false; readonly reasonCode: JobRefusalCode; readonly detail: string };

// ---------------------------------------------------------------------------
// Manifest.
// ---------------------------------------------------------------------------

export function buildJobManifest(
  jobId: string,
  actorId: string,
  input: Readonly<Record<string, unknown>>,
  createdAt: number,
): JobManifest {
  const inputCanonical = canonicalJson(input);
  return {
    jobId,
    actorId,
    inputCanonical,
    createdAt,
    manifestDigest: fnv1a32Hex("manifest", `${jobId}\u241f${actorId}\u241f${inputCanonical}\u241f${String(createdAt)}`),
  };
}

export function verifyJobManifest(manifest: JobManifest): boolean {
  // Total: a tampered manifest whose inputCanonical is not parseable JSON is
  // a failed verification (false), never a thrown exception.
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifest.inputCanonical) as unknown;
  } catch {
    return false;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return false;
  }
  const input = parsed as Record<string, unknown>;
  return (
    buildJobManifest(manifest.jobId, manifest.actorId, input, manifest.createdAt).manifestDigest ===
    manifest.manifestDigest
  );
}

// ---------------------------------------------------------------------------
// Creation (proposal only — authorization is null until Guardian input).
// ---------------------------------------------------------------------------

export interface CreateJobDraft {
  readonly tenant: TenantScope;
  readonly jobId: string;
  readonly actorId: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly idempotencyKey: string;
  readonly window: string;
  readonly now: number;
  readonly expiresAt: number | null;
}

export function createActorJob(draft: CreateJobDraft): JobCommandResult {
  const scope = validateTenantScope(draft.tenant);
  if (!scope.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING", detail: "invalid tenant scope" };
  if (draft.jobId.trim().length === 0) return { ok: false, reasonCode: "JOB_ID_EMPTY", detail: "jobId is empty" };
  if (draft.actorId.trim().length === 0) return { ok: false, reasonCode: "ACTOR_ID_EMPTY", detail: "actorId is empty" };
  if (draft.idempotencyKey.trim().length === 0) {
    return { ok: false, reasonCode: "IDEMPOTENCY_KEY_EMPTY", detail: "idempotencyKey is empty" };
  }
  if (draft.window.trim().length === 0) return { ok: false, reasonCode: "WINDOW_EMPTY", detail: "window is empty" };
  if (!Number.isInteger(draft.now) || draft.now < 0) {
    return { ok: false, reasonCode: "LOGICAL_TIME_INVALID", detail: "now is not a non-negative integer" };
  }
  if (draft.expiresAt !== null && (!Number.isInteger(draft.expiresAt) || draft.expiresAt < 0)) {
    return { ok: false, reasonCode: "EXPIRES_AT_INVALID", detail: "expiresAt is not a non-negative integer" };
  }
  const manifest = buildJobManifest(draft.jobId, draft.actorId, draft.input, draft.now);
  return {
    ok: true,
    job: {
      jobId: draft.jobId,
      tenant: scope.scope,
      actorId: draft.actorId,
      input: draft.input,
      idempotencyKey: draft.idempotencyKey,
      status: "proposed",
      authorization: null,
      window: draft.window,
      reservedUnits: null,
      manifest,
      createdAt: draft.now,
      updatedAt: draft.now,
      expiresAt: draft.expiresAt,
      failure: null,
    },
  };
}

export type CreateJobIdempotentResult =
  | { readonly ok: true; readonly job: ActorJobRecord; readonly duplicate: boolean }
  | { readonly ok: false; readonly reasonCode: JobRefusalCode; readonly detail: string };

/** Dedupe creation by idempotency key against existing (tenant-scoped) jobs. */
export function createActorJobIdempotent(
  existing: readonly ActorJobRecord[],
  draft: CreateJobDraft,
): CreateJobIdempotentResult {
  const created = createActorJob(draft);
  if (!created.ok) return created;
  const scope = validateTenantScope(draft.tenant);
  if (!scope.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING", detail: "invalid tenant scope" };
  for (const prior of existing) {
    if (prior.tenant.tenantId !== scope.scope.tenantId || prior.idempotencyKey !== draft.idempotencyKey) continue;
    if (prior.manifest.manifestDigest === created.job.manifest.manifestDigest) {
      return { ok: true, job: prior, duplicate: true };
    }
    return { ok: false, reasonCode: "IDEMPOTENCY_KEY_CONFLICT", detail: `key "${draft.idempotencyKey}" was used for a different job` };
  }
  return { ok: true, job: created.job, duplicate: false };
}

// ---------------------------------------------------------------------------
// Rate-budget accounting per logical window (ceiling, never authorization).
// ---------------------------------------------------------------------------

export interface RateBudgetLedger {
  readonly tenant: TenantScope;
  readonly window: string;
  readonly budgetUnits: number;
  readonly spentUnits: number;
  readonly reservations: readonly { readonly jobId: string; readonly units: number; readonly reservedAt: number }[];
}

export interface RateBudgetAccounting {
  readonly window: string;
  readonly spentUnits: number;
  readonly budgetUnits: number;
  readonly utilizationBps: number;
  readonly remainingUnits: number;
  readonly note: "ceiling-not-authorization";
}

export type RateBudgetResult =
  | { readonly ok: true; readonly ledger: RateBudgetLedger; readonly accounting: RateBudgetAccounting }
  | { readonly ok: false; readonly reasonCode: JobRefusalCode; readonly detail: string; readonly overshootUnits?: number };

export function openRateBudgetLedger(tenant: TenantScope, window: string, budgetUnits: number): RateBudgetResult {
  const scope = validateTenantScope(tenant);
  if (!scope.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING", detail: "invalid tenant scope" };
  if (window.trim().length === 0) return { ok: false, reasonCode: "WINDOW_EMPTY", detail: "window is empty" };
  if (!Number.isInteger(budgetUnits) || budgetUnits <= 0) {
    return { ok: false, reasonCode: "RATE_UNITS_INVALID", detail: "budgetUnits must be a positive integer" };
  }
  const ledger: RateBudgetLedger = { tenant: scope.scope, window, budgetUnits, spentUnits: 0, reservations: [] };
  return { ok: true, ledger, accounting: accountRateBudget(ledger) };
}

export function accountRateBudget(ledger: RateBudgetLedger): RateBudgetAccounting {
  return {
    window: ledger.window,
    spentUnits: ledger.spentUnits,
    budgetUnits: ledger.budgetUnits,
    utilizationBps: Math.floor((ledger.spentUnits * 10000) / ledger.budgetUnits),
    remainingUnits: ledger.budgetUnits - ledger.spentUnits,
    note: "ceiling-not-authorization",
  };
}

export function reserveRateBudget(
  ledger: RateBudgetLedger,
  job: ActorJobRecord,
  units: number,
  now: number,
): RateBudgetResult {
  const ledgerTenant = validateTenantScope(ledger.tenant);
  const jobTenant = validateTenantScope(job.tenant);
  if (!ledgerTenant.ok || !jobTenant.ok) {
    return { ok: false, reasonCode: "TENANT_SCOPE_MISSING", detail: "invalid tenant scope" };
  }
  if (ledgerTenant.scope.tenantId !== jobTenant.scope.tenantId) {
    return { ok: false, reasonCode: "RATE_BUDGET_MISMATCH", detail: "job tenant differs from ledger tenant" };
  }
  if (ledger.window !== job.window) {
    return { ok: false, reasonCode: "RATE_BUDGET_MISMATCH", detail: "job window differs from ledger window" };
  }
  if (!Number.isInteger(units) || units <= 0) {
    return { ok: false, reasonCode: "RATE_UNITS_INVALID", detail: "units must be a positive integer" };
  }
  const next = ledger.spentUnits + units;
  if (next > ledger.budgetUnits) {
    return {
      ok: false,
      reasonCode: "RATE_BUDGET_EXCEEDED",
      detail: `reservation of ${String(units)} exceeds the window budget by ${String(next - ledger.budgetUnits)} units`,
      overshootUnits: next - ledger.budgetUnits,
    };
  }
  const updated: RateBudgetLedger = {
    ...ledger,
    spentUnits: next,
    reservations: [...ledger.reservations, { jobId: job.jobId, units, reservedAt: now }],
  };
  return { ok: true, ledger: updated, accounting: accountRateBudget(updated) };
}

// ---------------------------------------------------------------------------
// Transitions.
// ---------------------------------------------------------------------------

export function authorizeActorJob(
  job: ActorJobRecord,
  decision: GuardianDecisionRefLike | null,
  now: number,
): JobCommandResult {
  if (isTerminal(job)) return terminalRefusal(job);
  if (job.status !== "proposed") {
    return { ok: false, reasonCode: "ILLEGAL_TRANSITION", detail: `authorizeActorJob requires "proposed", got "${job.status}"` };
  }
  if (decision === null) {
    return { ok: false, reasonCode: "AUTHORIZATION_REQUIRED", detail: "a Guardian decision must be presented (never minted here)" };
  }
  if (typeof decision.decisionId !== "string" || decision.decisionId.trim().length === 0) {
    return { ok: false, reasonCode: "AUTHORIZATION_DECISION_ID_EMPTY", detail: "decisionId is empty" };
  }
  if (!decision.authorized) {
    return { ok: false, reasonCode: "AUTHORIZATION_DENIED", detail: `Guardian refused: ${decision.reasonCode}` };
  }
  return { ok: true, job: { ...job, status: "authorized", authorization: decision, updatedAt: now } };
}

export function scheduleActorJob(
  job: ActorJobRecord,
  ledger: RateBudgetLedger,
  units: number,
  now: number,
): { job: JobCommandResult; budget: RateBudgetResult } {
  if (isTerminal(job)) return { job: terminalRefusal(job), budget: { ok: false, reasonCode: "TERMINAL_STATE", detail: "job is terminal" } };
  if (job.status !== "authorized") {
    return {
      job: { ok: false, reasonCode: "ILLEGAL_TRANSITION", detail: `scheduleActorJob requires "authorized", got "${job.status}"` },
      budget: { ok: false, reasonCode: "ILLEGAL_TRANSITION", detail: "job not schedulable" },
    };
  }
  if (job.authorization === null || !job.authorization.authorized) {
    return {
      job: { ok: false, reasonCode: "AUTHORIZATION_REQUIRED", detail: "scheduling requires the attached Guardian decision" },
      budget: { ok: false, reasonCode: "AUTHORIZATION_REQUIRED", detail: "not authorized" },
    };
  }
  const budget = reserveRateBudget(ledger, job, units, now);
  if (!budget.ok) return { job: { ok: false, reasonCode: budget.reasonCode, detail: budget.detail }, budget };
  return {
    job: { ok: true, job: { ...job, status: "scheduled", reservedUnits: units, updatedAt: now } },
    budget,
  };
}

export function startActorJob(job: ActorJobRecord, now: number): JobCommandResult {
  if (isTerminal(job)) return terminalRefusal(job);
  if (job.status !== "scheduled") {
    return { ok: false, reasonCode: "ILLEGAL_TRANSITION", detail: `startActorJob requires "scheduled", got "${job.status}"` };
  }
  return { ok: true, job: { ...job, status: "running", updatedAt: now } };
}

export function completeActorJob(job: ActorJobRecord, now: number): JobCommandResult {
  if (isTerminal(job)) return terminalRefusal(job);
  if (job.status !== "running") {
    return { ok: false, reasonCode: "ILLEGAL_TRANSITION", detail: `completeActorJob requires "running", got "${job.status}"` };
  }
  return { ok: true, job: { ...job, status: "completed", updatedAt: now } };
}

export function failActorJob(job: ActorJobRecord, reasonCode: string, now: number): JobCommandResult {
  if (isTerminal(job)) return terminalRefusal(job);
  if (job.status !== "running") {
    return { ok: false, reasonCode: "ILLEGAL_TRANSITION", detail: `failActorJob requires "running", got "${job.status}"` };
  }
  if (reasonCode.trim().length === 0) {
    return { ok: false, reasonCode: "FAILURE_REASON_REQUIRED", detail: "failure reasonCode is empty" };
  }
  return { ok: true, job: { ...job, status: "failed", updatedAt: now, failure: { reasonCode, detail: "" } } };
}

export function expireActorJob(job: ActorJobRecord, now: number): JobCommandResult {
  if (isTerminal(job)) return terminalRefusal(job);
  if (job.status === "running" || job.status === "scheduled" || job.status === "authorized" || job.status === "proposed") {
    if (job.expiresAt === null) {
      return { ok: false, reasonCode: "NOT_DUE_FOR_EXPIRY", detail: "job carries no expiration" };
    }
    if (now < job.expiresAt) {
      return { ok: false, reasonCode: "NOT_DUE_FOR_EXPIRY", detail: `now ${String(now)} is before expiresAt ${String(job.expiresAt)}` };
    }
    if (job.status === "running") {
      return { ok: false, reasonCode: "ILLEGAL_TRANSITION", detail: "a running job completes or fails — it is never expired" };
    }
    return { ok: true, job: { ...job, status: "expired", updatedAt: now } };
  }
  return { ok: false, reasonCode: "ILLEGAL_TRANSITION", detail: `cannot expire from "${job.status}"` };
}

// ---------------------------------------------------------------------------
// Internals.
// ---------------------------------------------------------------------------

function isTerminal(job: ActorJobRecord): boolean {
  return job.status === "completed" || job.status === "failed" || job.status === "expired";
}

function terminalRefusal(job: ActorJobRecord): { ok: false; reasonCode: "TERMINAL_STATE"; detail: string } {
  return { ok: false, reasonCode: "TERMINAL_STATE", detail: `job is terminal ("${job.status}")` };
}
