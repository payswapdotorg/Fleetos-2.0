/**
 * @fleetos/execution — Unified incident audit trail (F280B, Wave 8 lane B).
 *
 * Surface-specific sealers binding the lane's REAL decision surfaces into the
 * tamper-evident audit ledger (`@fleetos/security` audit-ledger — the
 * dependency-free hash-chain engine):
 *
 *   - Guardian evaluations  — `@fleetos/policy` DecisionRecord (the Guardian's
 *     full authorization record: verdict, reason, rule, digests);
 *   - action emissions      — `@fleetos/actions` ActionAuditEvent (every
 *     consequential action-protocol transition);
 *   - execution entries     — this package's ExecutionLedgerEntry (the
 *     queue-operation ledger whose own digest chains INTO the audit chain).
 *
 * Laws:
 *  - A19: append-only, tenant-scoped, hash-verifiable, machine-readable.
 *  - A8: tenant fail-closed — building a trail from cross-tenant inputs
 *    REFUSES naming the offender surface + subject.
 *  - Determinism: assembly order is canonical ((occurredAt, surface rank,
 *    subjectId)) — input order never leaks; no clock, no randomness.
 */

import {
  appendAuditEvent,
  verifyAuditLedger,
} from "@fleetos/security";
import type { AuditLedgerEvent, AuditLedgerSurface } from "@fleetos/security";
import type { DecisionRecord } from "@fleetos/policy";
import type { ActionAuditEvent } from "@fleetos/actions";
import type { ExecutionLedgerEntry } from "./ledger.ts";

// ---------------------------------------------------------------------------
// Surface sealers — REAL records → sealed audit events
// ---------------------------------------------------------------------------

/** Deterministic ordering rank of the surfaces (identity < action < execution). */
const SURFACE_RANK: Readonly<Record<AuditLedgerSurface, number>> = {
  "guardian.evaluation": 0,
  "action.emission": 1,
  "execution.entry": 2,
};

/**
 * Seal a Guardian evaluation (REAL DecisionRecord) into an audit event input.
 * `atMs` is the caller-supplied logical epoch of the evaluation.
 */
export function sealGuardianEvaluation(record: DecisionRecord, atMs: number) {
  return {
    tenantId: record.tenantId,
    surface: "guardian.evaluation" as const,
    subjectId: record.recordId,
    occurredAt: atMs,
    payload: {
      capabilityId: record.capabilityId,
      capabilityVersion: record.capabilityVersion,
      policyId: record.policyId,
      policyVersion: record.policyVersion,
      actorId: record.actorId,
      actorIsAutonomous: record.actorIsAutonomous,
      verdict: record.decision.verdict,
      reasonCode: record.decision.reasonCode,
      matchedRuleId: record.decision.matchedRuleId,
      decisionDigest: record.decision.decisionDigest,
      recordDigest: record.recordDigest,
      evaluatedAt: record.evaluatedAt,
    },
  };
}

/** Seal an action emission (REAL ActionAuditEvent) into an audit event input. */
export function sealActionEmission(event: ActionAuditEvent) {
  return {
    tenantId: event.tenantId,
    surface: "action.emission" as const,
    subjectId: event.eventId,
    occurredAt: auditAtOfIso(event.emittedAt),
    payload: {
      intentId: event.intentId,
      kind: event.kind,
      fromState: event.fromState,
      toState: event.toState,
      actorId: event.actorId,
      reason: event.reason,
      transitionDigest: event.transitionDigest,
    },
  };
}

/** Seal an execution ledger entry (REAL) into an audit event input. */
export function sealExecutionLedgerEntry(entry: ExecutionLedgerEntry) {
  return {
    tenantId: entry.tenantId,
    surface: "execution.entry" as const,
    subjectId: `${entry.idempotencyKey}#${entry.index}`,
    occurredAt: entry.at,
    payload: {
      index: entry.index,
      idempotencyKey: entry.idempotencyKey,
      kind: entry.kind,
      detail: entry.detail,
      entryDigest: entry.entryDigest,
    },
  };
}

/** Logical epoch of an ISO string — deterministic (no wall-clock). */
function auditAtOfIso(iso: string): number {
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

// ---------------------------------------------------------------------------
// Trail assembly — canonical order, tenant fail-closed
// ---------------------------------------------------------------------------

export type TrailRefusalCode = "trail.tenant-mismatch" | "trail.missing-tenant";

export type TrailBuildResult =
  | { readonly ok: true; readonly trail: readonly AuditLedgerEvent[] }
  | { readonly ok: false; readonly reason: TrailRefusalCode; readonly offender: string };

/**
 * Assemble the unified audit trail over the three REAL decision surfaces.
 *
 * Inputs are sealed and appended in canonical order — (occurredAt, surface
 * rank, subjectId) — so the assembled chain is byte-identical regardless of
 * the caller's input ordering. All inputs must belong to ONE tenant (A8);
 * a cross-tenant input refuses naming the offender surface + subject.
 */
export function buildIncidentAuditTrail(input: {
  readonly tenantId: string;
  readonly decisions?: readonly { readonly record: DecisionRecord; readonly atMs: number }[];
  readonly emissions?: readonly ActionAuditEvent[];
  readonly entries?: readonly ExecutionLedgerEntry[];
}): TrailBuildResult {
  if (input.tenantId === "") {
    return { ok: false, reason: "trail.missing-tenant", offender: "" };
  }
  const sealed: {
    tenantId: string;
    surface: AuditLedgerSurface;
    subjectId: string;
    occurredAt: number;
    payload: Readonly<Record<string, unknown>>;
    offender: string;
  }[] = [];
  for (const d of input.decisions ?? []) {
    const s = sealGuardianEvaluation(d.record, d.atMs);
    sealed.push({ ...s, offender: `${s.surface}:${s.subjectId}` });
  }
  for (const e of input.emissions ?? []) {
    const s = sealActionEmission(e);
    sealed.push({ ...s, offender: `${s.surface}:${s.subjectId}` });
  }
  for (const e of input.entries ?? []) {
    const s = sealExecutionLedgerEntry(e);
    sealed.push({ ...s, offender: `${s.surface}:${s.subjectId}` });
  }
  for (const s of sealed) {
    if (s.tenantId !== input.tenantId) {
      return { ok: false, reason: "trail.tenant-mismatch", offender: s.offender };
    }
  }
  const ordered = [...sealed].sort((a, b) => {
    const byAt = a.occurredAt - b.occurredAt;
    if (byAt !== 0) return byAt;
    const bySurface = SURFACE_RANK[a.surface] - SURFACE_RANK[b.surface];
    if (bySurface !== 0) return bySurface;
    return a.subjectId < b.subjectId ? -1 : 1;
  });
  let trail: readonly AuditLedgerEvent[] = [];
  for (const s of ordered) {
    const appended = appendAuditEvent(trail, s);
    if (!appended.ok) {
      // Structurally unreachable after the tenant pre-check — kept fail-loud.
      return { ok: false, reason: "trail.tenant-mismatch", offender: s.offender };
    }
    trail = appended.ledger;
  }
  return { ok: true, trail };
}

/**
 * Verify an assembled incident audit trail (delegates to the REAL audit-ledger
 * verifier — sequence/gap/hash semantics identical).
 */
export function verifyIncidentAuditTrail(trail: readonly AuditLedgerEvent[]): ReturnType<typeof verifyAuditLedger> {
  return verifyAuditLedger(trail);
}
