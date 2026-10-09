/**
 * @fleetos/execution — Deterministic incident replay (F280B, Wave 8 lane B).
 *
 * Forensics-grade replay over the REAL execution ledger + REAL action-audit
 * journal: reproduces the EXACT decision sequence of an incident as a
 * canonical timeline, is byte-identical on re-replay, and pinpoints the FIRST
 * divergent entry when replayed inputs differ from the recorded ones.
 *
 * Laws:
 *  - A19/A14: replay/recovery data points back at authoritative records — the
 *    replay consumes the REAL `ExecutionLedgerEntry` chain and the REAL
 *    `ActionAuditEvent` journal verbatim (no re-derivation, no re-scoring).
 *  - A8: tenant fail-closed — a journal entry or ledger entry from another
 *    tenant REFUSES naming the offender (`replay.tenant-mismatch`).
 *  - Determinism: canonical timeline order ((at, source rank, subject, kind));
 *    same inputs => byte-identical canonical JSON, machine-tested.
 */

import type { ActionAuditEvent } from "@fleetos/actions";
import type { ExecutionLedgerEntry, ReplayedCommand } from "./ledger.ts";
import { replayExecutionLedger } from "./ledger.ts";

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** Where a timeline step came from. */
export type IncidentStepSource = "execution" | "journal";

/** One step of the reproduced decision sequence. */
export interface IncidentStep {
  readonly at: number;
  readonly source: IncidentStepSource;
  readonly subject: string;
  readonly kind: string;
  /** Content digest of the step — deterministic over the step's fields. */
  readonly stepDigest: string;
}

export type ReplayRefusalCode =
  | "replay.missing-tenant"
  | "replay.tenant-mismatch"
  | "replay.ledger-refused";

export type IncidentReplayResult =
  | { readonly ok: true; readonly replay: IncidentReplay }
  | {
      readonly ok: false;
      readonly reason: ReplayRefusalCode;
      /** Names the offender entry (journal eventId or ledger index). */
      readonly offender: string;
    };

/** The replayed incident — the reproduced decision sequence. */
export interface IncidentReplay {
  readonly tenantId: string;
  /** Canonical decision sequence — ordered (at, source rank, subject, kind). */
  readonly timeline: readonly IncidentStep[];
  /** Per-step digests, in timeline order (the decision sequence fingerprint). */
  readonly decisionSequence: readonly string[];
  /** The REAL per-command replay view (from replayExecutionLedger). */
  readonly commands: readonly ReplayedCommand[];
  /** Whole-replay digest — byte-identical for identical inputs. */
  readonly replayDigest: string;
}

// ---------------------------------------------------------------------------
// Deterministic digests (local — the lane's convention)
// ---------------------------------------------------------------------------

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function stepDigest(step: Omit<IncidentStep, "stepDigest">): string {
  return fnv1a([String(step.at), step.source, step.subject, step.kind].join("|"));
}

function isoToMs(iso: string): number {
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

/**
 * Replay an incident from the REAL execution ledger + action-audit journal.
 *
 * The timeline merges both sources canonically; the per-command view reuses
 * the REAL `replayExecutionLedger` verbatim. Replaying the same inputs twice
 * produces byte-identical output (canonical JSON equality) — the
 * machine-tested replayability contract.
 */
export function replayIncident(input: {
  readonly tenantId: string;
  readonly ledger: readonly ExecutionLedgerEntry[];
  readonly journal: readonly ActionAuditEvent[];
}): IncidentReplayResult {
  if (input.tenantId === "") {
    return { ok: false, reason: "replay.missing-tenant", offender: "" };
  }
  for (const entry of input.ledger) {
    if (entry.tenantId !== input.tenantId) {
      return {
        ok: false,
        reason: "replay.tenant-mismatch",
        offender: `ledger#${entry.index}`,
      };
    }
  }
  for (const event of input.journal) {
    if (event.tenantId !== input.tenantId) {
      return {
        ok: false,
        reason: "replay.tenant-mismatch",
        offender: `journal:${event.eventId}`,
      };
    }
  }
  // Canonical ledger order: entries replay by their RECORDED index — a
  // reordered copy of the same entries replays identically (the index is the
  // authoritative sequence, not array position).
  const ledger = [...input.ledger].sort((a, b) => a.index - b.index);
  const steps: IncidentStep[] = [];
  for (const entry of ledger) {
    const base = {
      at: entry.at,
      source: "execution" as const,
      subject: entry.idempotencyKey,
      kind: entry.kind,
    };
    steps.push({ ...base, stepDigest: stepDigest(base) });
  }
  for (const event of input.journal) {
    const base = {
      at: isoToMs(event.emittedAt),
      source: "journal" as const,
      subject: event.intentId,
      kind: event.kind,
    };
    steps.push({ ...base, stepDigest: stepDigest(base) });
  }
  const SOURCE_RANK: Readonly<Record<IncidentStepSource, number>> = { execution: 0, journal: 1 };
  const timeline = [...steps].sort((a, b) => {
    const byAt = a.at - b.at;
    if (byAt !== 0) return byAt;
    const bySource = SOURCE_RANK[a.source] - SOURCE_RANK[b.source];
    if (bySource !== 0) return bySource;
    const bySubject = a.subject < b.subject ? -1 : a.subject > b.subject ? 1 : 0;
    if (bySubject !== 0) return bySubject;
    return a.kind < b.kind ? -1 : 1;
  });
  const commands = replayExecutionLedger(ledger);
  if (!commands.ok) {
    // The REAL replay refuses structurally inconsistent ledgers (e.g. an
    // acked entry with no submitted predecessor) — surfaced verbatim.
    return { ok: false, reason: "replay.ledger-refused", offender: commands.reason };
  }
  const decisionSequence = timeline.map((s) => s.stepDigest);
  const replay: IncidentReplay = {
    tenantId: input.tenantId,
    timeline,
    decisionSequence,
    commands: commands.commands,
    replayDigest: fnv1a(
      `${input.tenantId}|${decisionSequence.join(",")}|${commands.commands
        .map((c) => `${c.idempotencyKey}:${c.status}:${c.attempts}`)
        .join(",")}`,
    ),
  };
  return { ok: true, replay };
}

/**
 * Replay-determinism machine test: two replays of the same inputs MUST be
 * byte-identical (canonical JSON equality).
 */
export function verifyIncidentReplayDeterminism(input: {
  readonly tenantId: string;
  readonly ledger: readonly ExecutionLedgerEntry[];
  readonly journal: readonly ActionAuditEvent[];
}): { readonly deterministic: boolean } {
  const a = replayIncident(input);
  const b = replayIncident(input);
  return { deterministic: JSON.stringify(a) === JSON.stringify(b) };
}

// ---------------------------------------------------------------------------
// Divergence detection — first divergent entry, pinned
// ---------------------------------------------------------------------------

/** The class of field that diverged at the first divergent step. */
export type DivergenceField =
  | "timeline-length"
  | "at"
  | "source"
  | "subject"
  | "kind"
  | "step-digest";

export interface ReplayDivergence {
  readonly diverged: boolean;
  /** Index of the FIRST divergent timeline step. */
  readonly stepIndex: number | null;
  readonly field: DivergenceField | null;
  readonly expected: string | null;
  readonly actual: string | null;
}

/**
 * Detect divergence between a recorded replay and a re-replay over (possibly
 * different) inputs. The mismatch is pinned to the FIRST divergent entry:
 * the earliest timeline position where the two sequences disagree, with the
 * field class and both values. Identical replays report `diverged: false`.
 */
export function diffIncidentReplays(
  recorded: IncidentReplay,
  replayed: IncidentReplay,
): ReplayDivergence {
  const a = recorded.timeline;
  const b = replayed.timeline;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const sa = a[i]!;
    const sb = b[i]!;
    if (sa.at !== sb.at) {
      return { diverged: true, stepIndex: i, field: "at", expected: String(sa.at), actual: String(sb.at) };
    }
    if (sa.source !== sb.source) {
      return { diverged: true, stepIndex: i, field: "source", expected: sa.source, actual: sb.source };
    }
    if (sa.subject !== sb.subject) {
      return { diverged: true, stepIndex: i, field: "subject", expected: sa.subject, actual: sb.subject };
    }
    if (sa.kind !== sb.kind) {
      return { diverged: true, stepIndex: i, field: "kind", expected: sa.kind, actual: sb.kind };
    }
    if (sa.stepDigest !== sb.stepDigest) {
      return { diverged: true, stepIndex: i, field: "step-digest", expected: sa.stepDigest, actual: sb.stepDigest };
    }
  }
  if (a.length !== b.length) {
    const i = len;
    return {
      diverged: true,
      stepIndex: i,
      field: "timeline-length",
      expected: String(a.length),
      actual: String(b.length),
    };
  }
  return { diverged: false, stepIndex: null, field: null, expected: null, actual: null };
}
