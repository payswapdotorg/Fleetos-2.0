/**
 * @fleetos/apify — tenant-scoped run registry as an event fold (Wave 5).
 *
 * An append-only run JOURNAL of actor-job lifecycle events with per-event
 * chained digests (law A19: `verifyRunJournalChain` recomputes the chain
 * and reports the earliest broken seq), folded deterministically into a
 * registry STATE indexed by job/status/window. `foldRunJournal` is a pure
 * replay: folding the same journal always produces a byte-identical state,
 * and `foldFromCheckpoint` folds only the events after a stored checkpoint —
 * incremental replay converges to the identical full-replay state
 * (machine-tested).
 *
 * Fail-closed tenancy: a journal is single-tenant; cross-tenant appends and
 * lookups are refused; `lookupRun` returns null for both unknown and
 * other-tenant job ids (no existence leaks).
 *
 * Pure and deterministic; logical times are caller-supplied and must be
 * monotonic across appends (EVENT_TIME_REGRESSION otherwise).
 */
import { validateTenantScope, type TenantScope } from "./seam.js";
import { canonicalJson, fnv1a32Hex } from "./digest.js";
import type { ActorJobStatus } from "./job-lifecycle.js";

// ---------------------------------------------------------------------------
// Types.
// ---------------------------------------------------------------------------

export type RunEventKind =
  | "job-created"
  | "job-authorized"
  | "job-scheduled"
  | "job-started"
  | "job-completed"
  | "job-failed"
  | "job-expired";

export interface RunEvent {
  readonly kind: RunEventKind;
  readonly tenant: TenantScope;
  readonly jobId: string;
  readonly at: number;
  readonly actorId?: string;
  readonly decisionId?: string;
  readonly window?: string;
  readonly units?: number;
  readonly reasonCode?: string;
}

export interface JournaledRunEvent {
  /** Journal-assigned sequence (1-based, append order). */
  readonly seq: number;
  readonly digest: string;
  readonly event: RunEvent;
}

export interface RunJournal {
  readonly tenant: TenantScope;
  readonly events: readonly JournaledRunEvent[];
}

export interface RegistryJobEntry {
  readonly jobId: string;
  readonly actorId: string | null;
  readonly status: ActorJobStatus;
  readonly window: string | null;
  readonly lastEventAt: number;
  readonly eventCount: number;
  readonly failureReasonCode: string | null;
}

export interface RunRegistryState {
  readonly tenant: TenantScope;
  /** Number of journal events folded into this state (the checkpoint). */
  readonly checkpoint: number;
  readonly jobs: ReadonlyMap<string, RegistryJobEntry>;
  readonly byStatus: ReadonlyMap<ActorJobStatus, readonly string[]>;
  readonly byWindow: ReadonlyMap<string, readonly string[]>;
}

export type RegistryRefusalCode =
  | "TENANT_SCOPE_MISSING"
  | "TENANT_MISMATCH"
  | "JOB_ID_EMPTY"
  | "EVENT_KIND_INVALID"
  | "EVENT_TIME_REGRESSION"
  | "LOGICAL_TIME_INVALID"
  | "JOURNAL_CHAIN_BROKEN";

export type AppendResult =
  | { readonly ok: true; readonly journal: RunJournal }
  | { readonly ok: false; readonly reasonCode: RegistryRefusalCode; readonly detail: string };

export type QueryResult =
  | { readonly ok: true; readonly jobIds: readonly string[] }
  | { readonly ok: false; readonly reasonCode: "TENANT_SCOPE_MISSING" | "TENANT_MISMATCH"; readonly detail: string };

const EVENT_KINDS: ReadonlySet<string> = new Set([
  "job-created",
  "job-authorized",
  "job-scheduled",
  "job-started",
  "job-completed",
  "job-failed",
  "job-expired",
]);

const STATUS_BY_KIND: Readonly<Record<RunEventKind, ActorJobStatus>> = {
  "job-created": "proposed",
  "job-authorized": "authorized",
  "job-scheduled": "scheduled",
  "job-started": "running",
  "job-completed": "completed",
  "job-failed": "failed",
  "job-expired": "expired",
};

const JOURNAL_GENESIS = "run_genesis";

// ---------------------------------------------------------------------------
// Journal construction + append.
// ---------------------------------------------------------------------------

export type OpenJournalResult =
  | { readonly ok: true; readonly journal: RunJournal }
  | { readonly ok: false; readonly reasonCode: "TENANT_SCOPE_MISSING" };

export function openRunJournal(tenant: TenantScope): OpenJournalResult {
  const scope = validateTenantScope(tenant);
  if (!scope.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  return { ok: true, journal: { tenant: scope.scope, events: [] } };
}

function computeEventDigest(previousDigest: string, seq: number, event: RunEvent): string {
  return fnv1a32Hex("run", `${previousDigest}\u241f${String(seq)}\u241f${canonicalJson(event)}`);
}

export function appendRunEvent(journal: RunJournal, event: RunEvent): AppendResult {
  const journalTenant = validateTenantScope(journal.tenant);
  if (!journalTenant.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING", detail: "journal tenant invalid" };
  const eventTenant = validateTenantScope(event.tenant);
  if (!eventTenant.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING", detail: "event tenant invalid" };
  if (eventTenant.scope.tenantId !== journalTenant.scope.tenantId) {
    return { ok: false, reasonCode: "TENANT_MISMATCH", detail: "event tenant differs from journal tenant" };
  }
  if (typeof event.jobId !== "string" || event.jobId.trim().length === 0) {
    return { ok: false, reasonCode: "JOB_ID_EMPTY", detail: "jobId is empty" };
  }
  if (!EVENT_KINDS.has(event.kind)) {
    return { ok: false, reasonCode: "EVENT_KIND_INVALID", detail: `unknown event kind "${String(event.kind)}"` };
  }
  if (!Number.isInteger(event.at) || event.at < 0) {
    return { ok: false, reasonCode: "LOGICAL_TIME_INVALID", detail: "event time is not a non-negative integer" };
  }
  const last = journal.events[journal.events.length - 1];
  if (last !== undefined && event.at < last.event.at) {
    return {
      ok: false,
      reasonCode: "EVENT_TIME_REGRESSION",
      detail: `event at ${String(event.at)} precedes the last journaled time ${String(last.event.at)}`,
    };
  }
  const seq = journal.events.length + 1;
  const previousDigest = last === undefined ? JOURNAL_GENESIS : last.digest;
  const journaled: JournaledRunEvent = {
    seq,
    digest: computeEventDigest(previousDigest, seq, event),
    event,
  };
  return { ok: true, journal: { tenant: journal.tenant, events: [...journal.events, journaled] } };
}

export function verifyRunJournalChain(
  journal: RunJournal,
): { ok: true } | { ok: false; reasonCode: "JOURNAL_CHAIN_BROKEN"; brokenAtSeq: number } {
  let previousDigest = JOURNAL_GENESIS;
  for (let i = 0; i < journal.events.length; i++) {
    const entry = journal.events[i];
    if (entry === undefined) continue;
    const expected = computeEventDigest(previousDigest, i + 1, entry.event);
    if (entry.seq !== i + 1 || entry.digest !== expected) {
      return { ok: false, reasonCode: "JOURNAL_CHAIN_BROKEN", brokenAtSeq: i + 1 };
    }
    previousDigest = entry.digest;
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// The fold — replay == state.
// ---------------------------------------------------------------------------

export function foldRunJournal(journal: RunJournal): RunRegistryState {
  return foldEvents(journal.tenant, [], journal.events, 0);
}

export function foldFromCheckpoint(
  state: RunRegistryState,
  journal: RunJournal,
): { readonly ok: true; readonly state: RunRegistryState } | { readonly ok: false; readonly reasonCode: "TENANT_MISMATCH" } {
  const stateTenant = validateTenantScope(state.tenant);
  const journalTenant = validateTenantScope(journal.tenant);
  if (!stateTenant.ok || !journalTenant.ok || stateTenant.scope.tenantId !== journalTenant.scope.tenantId) {
    return { ok: false, reasonCode: "TENANT_MISMATCH" };
  }
  const pending = journal.events.slice(state.checkpoint);
  return { ok: true, state: foldEvents(journal.tenant, [...indexEntries(state)], pending, state.checkpoint) };
}

function foldEvents(
  tenant: TenantScope,
  seed: readonly (readonly [string, RegistryJobEntry])[],
  events: readonly JournaledRunEvent[],
  baseCheckpoint: number,
): RunRegistryState {
  const jobs = new Map<string, RegistryJobEntry>(seed);
  for (const entry of events) {
    const event = entry.event;
    const status = STATUS_BY_KIND[event.kind];
    const prior = jobs.get(event.jobId);
    jobs.set(event.jobId, {
      jobId: event.jobId,
      actorId: event.actorId ?? prior?.actorId ?? null,
      status,
      window: event.kind === "job-scheduled" ? (event.window ?? null) : (prior?.window ?? null),
      lastEventAt: event.at,
      eventCount: (prior?.eventCount ?? 0) + 1,
      failureReasonCode: event.kind === "job-failed" ? (event.reasonCode ?? null) : (prior?.failureReasonCode ?? null),
    });
  }
  const byStatus = new Map<ActorJobStatus, string[]>();
  const byWindow = new Map<string, string[]>();
  for (const entry of jobs.values()) {
    const statusList = byStatus.get(entry.status) ?? [];
    statusList.push(entry.jobId);
    byStatus.set(entry.status, statusList);
    if (entry.window !== null) {
      const windowList = byWindow.get(entry.window) ?? [];
      windowList.push(entry.jobId);
      byWindow.set(entry.window, windowList);
    }
  }
  for (const [status, ids] of byStatus) byStatus.set(status, [...ids].sort(lexical));
  for (const [window, ids] of byWindow) byWindow.set(window, [...ids].sort(lexical));
  return { tenant, checkpoint: baseCheckpoint + events.length, jobs, byStatus, byWindow };
}

function indexEntries(state: RunRegistryState): readonly (readonly [string, RegistryJobEntry])[] {
  return [...state.jobs.entries()];
}

// ---------------------------------------------------------------------------
// Queries — fail-closed.
// ---------------------------------------------------------------------------

export function queryRunsByStatus(
  state: RunRegistryState,
  tenant: TenantScope,
  status: ActorJobStatus,
): QueryResult {
  const stateTenant = validateTenantScope(state.tenant);
  const queryTenant = validateTenantScope(tenant);
  if (!stateTenant.ok || !queryTenant.ok) {
    return { ok: false, reasonCode: "TENANT_SCOPE_MISSING", detail: "invalid tenant scope" };
  }
  if (stateTenant.scope.tenantId !== queryTenant.scope.tenantId) {
    return { ok: false, reasonCode: "TENANT_MISMATCH", detail: "query tenant differs from registry tenant" };
  }
  return { ok: true, jobIds: state.byStatus.get(status) ?? [] };
}

export function queryRunsByWindow(
  state: RunRegistryState,
  tenant: TenantScope,
  window: string,
): QueryResult {
  const stateTenant = validateTenantScope(state.tenant);
  const queryTenant = validateTenantScope(tenant);
  if (!stateTenant.ok || !queryTenant.ok) {
    return { ok: false, reasonCode: "TENANT_SCOPE_MISSING", detail: "invalid tenant scope" };
  }
  if (stateTenant.scope.tenantId !== queryTenant.scope.tenantId) {
    return { ok: false, reasonCode: "TENANT_MISMATCH", detail: "query tenant differs from registry tenant" };
  }
  if (window.trim().length === 0) {
    return { ok: false, reasonCode: "TENANT_MISMATCH", detail: "window is empty" };
  }
  return { ok: true, jobIds: state.byWindow.get(window) ?? [] };
}

export function lookupRun(
  state: RunRegistryState,
  tenant: TenantScope,
  jobId: string,
): RegistryJobEntry | null {
  const stateTenant = validateTenantScope(state.tenant);
  const queryTenant = validateTenantScope(tenant);
  if (!stateTenant.ok || !queryTenant.ok) return null;
  if (stateTenant.scope.tenantId !== queryTenant.scope.tenantId) return null; // no existence leak
  return state.jobs.get(jobId) ?? null;
}

// ---------------------------------------------------------------------------
// Internals.
// ---------------------------------------------------------------------------

function lexical(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
