/**
 * @fleetos/experience-safety-intel — host execution-results route view
 * (F300B deliverable 1, route "execution-results").
 *
 * Presentation read-model over the REAL @fleetos/execution surfaces:
 *  - the execution ledger (hash-chained entries, presented in RECORDED index
 *    order) with the REAL `verifyExecutionLedger` outcome VERBATIM — a broken
 *    ledger renders as broken, never as verified;
 *  - the REAL `replayExecutionLedger` summary (the ledger replay view — the
 *    lane's replay-of-record for execution history);
 *  - dead-letter visibility from the REAL command queue when composed;
 *  - the action audit-trail summary (event kinds + digests) when composed.
 *
 * Laws: tenant fail-closed (A8) — a cross-tenant ledger entry or audit event
 * refuses the WHOLE route view, offender named; honest empty — an absent
 * queue/audit slice composes `null` sections, never fabricated state;
 * determinism — derived orderings only.
 */

import {
  deadLetteredCommands,
  replayExecutionLedger,
  verifyExecutionLedger,
} from "@fleetos/execution";
import type { ActionAuditEvent } from "@fleetos/actions";
import type {
  CommandQueueState,
  ExecutionLedgerEntry,
} from "@fleetos/execution";

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export interface LedgerEntryLinkView {
  readonly index: number;
  readonly idempotencyKey: string;
  readonly kind: ExecutionLedgerEntry["kind"];
  readonly at: number;
  readonly detail: string;
  readonly entryDigest: string;
}

export interface ReplaySummaryView {
  readonly commandCount: number;
  /** Ordered by idempotencyKey asc (the REAL replay ordering). */
  readonly commands: readonly {
    readonly idempotencyKey: string;
    readonly status: "queued" | "in-flight" | "completed" | "dead-lettered";
    readonly attempts: number;
    readonly lastFailureReason: string | null;
  }[];
}

export interface AuditTrailSummaryView {
  readonly eventCount: number;
  /** Ordered by eventId asc. */
  readonly kinds: readonly string[];
  readonly distinctIntents: number;
}

export interface ExecutionResultsRouteView {
  readonly tenantId: string;
  /** Ordered by recorded index asc. */
  readonly ledger: readonly LedgerEntryLinkView[];
  readonly verification: {
    readonly verified: boolean;
    readonly checkedEntries: number;
    readonly brokenAt: number | null;
    readonly reason: string | null;
  };
  readonly replay: ReplaySummaryView | null;
  readonly deadLetters: readonly {
    readonly idempotencyKey: string;
    readonly attempts: number;
    readonly lastFailureReason: string | null;
    readonly deadLetteredAt: number | null;
  }[];
  readonly auditTrail: AuditTrailSummaryView | null;
  readonly digest: string;
}

export type ExecutionRouteRefusal =
  | "execution.missing-tenant"
  | "execution.cross-tenant-entry"
  | "execution.cross-tenant-queue"
  | "execution.cross-tenant-audit";

export type ExecutionRouteResult =
  | { readonly ok: true; readonly view: ExecutionResultsRouteView }
  | { readonly ok: false; readonly refused: ExecutionRouteRefusal; readonly detail: string };

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export function buildExecutionResultsRouteView(input: {
  readonly tenantId: string;
  readonly ledger: readonly ExecutionLedgerEntry[];
  readonly queue?: CommandQueueState;
  readonly auditEvents?: readonly ActionAuditEvent[];
}): ExecutionRouteResult {
  if (input.tenantId === "") {
    return { ok: false, refused: "execution.missing-tenant", detail: "tenant identifier is empty" };
  }
  for (const entry of input.ledger) {
    if (entry.tenantId !== input.tenantId) {
      return {
        ok: false,
        refused: "execution.cross-tenant-entry",
        detail: `ledger entry ${entry.index} (${entry.idempotencyKey}) belongs to tenant ${entry.tenantId}, not ${input.tenantId}`,
      };
    }
  }
  if (input.queue && input.queue.tenantId !== input.tenantId) {
    return {
      ok: false,
      refused: "execution.cross-tenant-queue",
      detail: `command queue belongs to tenant ${input.queue.tenantId}, not ${input.tenantId}`,
    };
  }
  for (const event of input.auditEvents ?? []) {
    if (event.tenantId !== input.tenantId) {
      return {
        ok: false,
        refused: "execution.cross-tenant-audit",
        detail: `audit event ${event.eventId} belongs to tenant ${event.tenantId}, not ${input.tenantId}`,
      };
    }
  }

  const ledger = [...input.ledger]
    .sort((a, b) => a.index - b.index)
    .map((e) => ({
      index: e.index,
      idempotencyKey: e.idempotencyKey,
      kind: e.kind,
      at: e.at,
      detail: e.detail,
      entryDigest: e.entryDigest,
    }));
  const verification = verifyExecutionLedger(input.ledger);
  const replayResult = replayExecutionLedger(input.ledger);
  // The REAL replay is a result type: a refused replay (e.g. tenant break in
  // the ledger itself) is presented as NO replay summary — never fabricated.
  const replay: ReplaySummaryView | null = replayResult.ok
    ? {
        commandCount: replayResult.commands.length,
        commands: replayResult.commands.map((c) => ({
          idempotencyKey: c.idempotencyKey,
          status: c.status,
          attempts: c.attempts,
          lastFailureReason: c.lastFailureReason,
        })),
      }
    : null;
  const deadLetters = input.queue
    ? deadLetteredCommands(input.queue).map((c) => ({
        idempotencyKey: c.idempotencyKey,
        attempts: c.attempts,
        lastFailureReason: c.lastFailureReason,
        deadLetteredAt: c.deadLetteredAt,
      }))
    : [];
  const auditTrail: AuditTrailSummaryView | null = input.auditEvents
    ? {
        eventCount: input.auditEvents.length,
        kinds: [...input.auditEvents]
          .sort((a, b) => (a.eventId < b.eventId ? -1 : 1))
          .map((e) => e.kind),
        distinctIntents: new Set(input.auditEvents.map((e) => e.intentId)).size,
      }
    : null;

  const view: ExecutionResultsRouteView = {
    tenantId: input.tenantId,
    ledger,
    verification: {
      verified: verification.verified,
      checkedEntries: verification.checkedEntries,
      brokenAt: verification.brokenAt,
      reason: verification.reason,
    },
    replay,
    deadLetters,
    auditTrail,
    digest: executionRouteDigest({ ledger, verification, replay, deadLetters, auditTrail }),
  };
  return { ok: true, view };
}

function executionRouteDigest(parts: {
  readonly ledger: readonly LedgerEntryLinkView[];
  readonly verification: { readonly verified: boolean; readonly brokenAt: number | null; readonly reason: string | null };
  readonly replay: ReplaySummaryView | null;
  readonly deadLetters: readonly { readonly idempotencyKey: string }[];
  readonly auditTrail: AuditTrailSummaryView | null;
}): string {
  const ledger = parts.ledger.map((e) => `${e.index}:${e.idempotencyKey}/${e.kind}=${e.entryDigest}`).join(",");
  const replay = parts.replay === null ? "refused" : parts.replay.commands.map((c) => `${c.idempotencyKey}:${c.status}#${c.attempts}`).join(",");
  const dead = parts.deadLetters.map((d) => `${d.idempotencyKey}!`).join(",");
  const audit = parts.auditTrail === null ? "absent" : `${parts.auditTrail.eventCount}/${parts.auditTrail.distinctIntents}`;
  return fnv1a(
    `execroute|v1|${parts.ledger.length}|${ledger}|${parts.verification.verified}/${parts.verification.brokenAt ?? "-"}/${parts.verification.reason ?? "-"}|${replay}|${dead}|${audit}`,
  );
}

/** Deterministic digest (private FNV-1a — the lane's presentation convention). */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
