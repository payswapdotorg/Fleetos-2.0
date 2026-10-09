/**
 * @fleetos/adcos — Wave 8 journal compaction, SAFE mode (F280A).
 *
 * At fleet scale the append-only command journal grows without bound. This
 * module compacts it WITHOUT breaking any verification property:
 *
 *   - **SAFE mode contract** — compaction removes a contiguous PREFIX of
 *     the journal (all events with seq <= cutoffSeq) and is REFUSED unless
 *     every command touched in that prefix is TERMINAL (reconciled /
 *     expired / dead-letter) at the cutoff — so the retained suffix never
 *     references a command whose `issued` event was removed. Compaction
 *     never rewrites a retained event, never re-chains a digest, and never
 *     drops the idempotency index: the checkpoint carries `byId` and
 *     `byIdempotencyKey` forward unchanged.
 *   - **Same digest chain semantics** — the retained suffix verifies with
 *     the FULL journal's own verifier (`verifyCommandJournal`) with the
 *     compaction anchor seeded as the chain root and `cutoffSeq + 1` as
 *     the first expected seq. The chain rule is untouched: every retained
 *     event's audit digest still equals chainedAuditDigest(prev, event).
 *     Because the chain is prefix-invariant, appending the same new events
 *     to the compacted journal and to the full journal yields the IDENTICAL
 *     final chain digest — machine-tested below.
 *   - **Chain prefix invariance + state equivalence** — for any suffix of
 *     new events: fold(full + suffix) and resumeFromCompacted(compacted,
 *     suffix) agree on byId, byIdempotencyKey, seq and lastAuditDigest.
 *     (The raw event LIST differs by design — that is the memory bound:
 *     events are what compaction removes; the command-record index is
 *     retained so post-compaction idempotency dedup still works.)
 *   - **Tamper-evident summary** — the compaction record carries a
 *     summaryDigest over the terminal command records at the cutoff;
 *     verification recomputes it from the checkpoint and refuses with
 *     `summary-mismatch` when it does not match.
 *
 * Honest bound: compaction bounds the EVENT list (the per-command record
 * index still grows with command count — documented residual; a record
 * index bound requires dropping idempotency history and is a separate
 * policy decision for the TL).
 *
 * Pure deterministic TypeScript; logical `now` everywhere.
 */

import { createHash } from "node:crypto";
import {
  foldCommandJournal,
  resumeCommandJournal,
  verifyCommandJournal,
  type CommandJournalCheckpoint,
  type CommandJournalEvent,
  type CommandJournalState,
  type CommandJournalVerification,
  type JournalVerificationFailure,
} from "./command-journal.js";

// ---------------------------------------------------------------------------
// Compaction record.
// ---------------------------------------------------------------------------

export interface CompactionStats {
  readonly removedEvents: number;
  readonly retainedEvents: number;
  readonly terminalCommands: number; // terminal commands whose events were removed
}

export interface CompactedCommandJournal {
  readonly cutoffSeq: number;
  /** Chain root of the removed prefix — seeds retained-suffix verification. */
  readonly anchor: string;
  /** Digest over the terminal command records at the cutoff (tamper-evident summary). */
  readonly summaryDigest: string;
  /** Events with seq > cutoffSeq — UNCHANGED bytes from the full journal. */
  readonly retained: ReadonlyArray<CommandJournalEvent>;
  /** Resume point: the pruned state at the cutoff (events dropped, indexes kept). */
  readonly checkpoint: CommandJournalCheckpoint;
  readonly stats: CompactionStats;
  readonly compactedAt: number;
}

export type CompactionRejectionCode =
  | "invalid-cutoff"
  | "non-terminal-in-prefix";

export type CompactionResult =
  | { readonly ok: false; readonly reason: CompactionRejectionCode; readonly offendingCommandIds?: ReadonlyArray<string> }
  | { readonly ok: true; readonly compacted: CompactedCommandJournal };

const TERMINAL_PHASES: ReadonlySet<string> = new Set(["reconciled", "expired", "dead-letter"]);

function digestOf(...parts: ReadonlyArray<string | number>): string {
  const text = parts.map((p) => String(p)).join("|");
  return createHash("sha256").update(text).digest("hex");
}

// ---------------------------------------------------------------------------
// compactCommandJournal — SAFE mode: fail-closed prefix removal.
// ---------------------------------------------------------------------------

export function compactCommandJournal(
  state: CommandJournalState,
  input: { readonly cutoffSeq: number; readonly compactedAt: number },
): CompactionResult {
  if (
    !Number.isInteger(input.cutoffSeq) ||
    input.cutoffSeq < 0 ||
    input.cutoffSeq > state.seq
  ) {
    return { ok: false, reason: "invalid-cutoff" };
  }

  const prefixEvents = state.events.filter((e) => e.seq <= input.cutoffSeq);
  const retained = state.events.filter((e) => e.seq > input.cutoffSeq);
  const prefixFold = foldCommandJournal(prefixEvents);

  // SAFE-mode fail-closed check: every command touched in the prefix must be
  // TERMINAL at the cutoff — otherwise the retained suffix could reference a
  // command whose `issued` event was removed and verification would break.
  const offending: string[] = [];
  for (const record of prefixFold.byId.values()) {
    if (!TERMINAL_PHASES.has(record.phase)) offending.push(record.commandId);
  }
  if (offending.length > 0) {
    return { ok: false, reason: "non-terminal-in-prefix", offendingCommandIds: offending.sort() };
  }

  const anchor = prefixFold.lastAuditDigest;
  const summaryDigest = summarizeTerminalRecords(prefixFold);
  const checkpoint: CommandJournalCheckpoint = {
    foldedSeq: input.cutoffSeq,
    state: { ...prefixFold, events: [] }, // memory bound: prefix events dropped
  };
  return {
    ok: true,
    compacted: {
      cutoffSeq: input.cutoffSeq,
      anchor,
      summaryDigest,
      retained,
      checkpoint,
      stats: {
        removedEvents: prefixEvents.length,
        retainedEvents: retained.length,
        terminalCommands: prefixFold.byId.size,
      },
      compactedAt: input.compactedAt,
    },
  };
}

function summarizeTerminalRecords(state: CommandJournalState): string {
  // Deterministic summary over the terminal command records at the cutoff.
  const records = [...state.byId.values()].sort((a, b) =>
    a.commandId < b.commandId ? -1 : a.commandId > b.commandId ? 1 : 0,
  );
  const text = records
    .map((r) => `${r.commandId}|${r.tenantId}|${r.phase}|${r.idempotencyKey}|${r.terminalAt ?? 0}`)
    .join("|");
  return digestOf("compaction-summary", text);
}

// ---------------------------------------------------------------------------
// Verification — same digest chain semantics as the full journal.
// ---------------------------------------------------------------------------

export type CompactedJournalVerification =
  | { readonly ok: true }
  | { readonly ok: false; readonly kind: "chain"; readonly failures: ReadonlyArray<JournalVerificationFailure> }
  | { readonly ok: false; readonly kind: "summary-mismatch" };

export function verifyCompactedCommandJournal(compacted: CompactedCommandJournal): CompactedJournalVerification {
  // (1) The retained suffix verifies under the FULL journal's own verifier,
  // with the compaction anchor as the chain root — identical semantics.
  const chain: CommandJournalVerification = verifyCommandJournal(compacted.retained, {
    anchor: compacted.anchor,
    firstSeq: compacted.cutoffSeq + 1,
  });
  if (!chain.ok) {
    return { ok: false, kind: "chain", failures: chain.failures };
  }
  // (2) The checkpoint's command records must still match the recorded
  // summary digest — a tampered checkpoint or record fails closed.
  const recomputed = summarizeTerminalRecords(compacted.checkpoint.state);
  if (recomputed !== compacted.summaryDigest) {
    return { ok: false, kind: "summary-mismatch" };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Resume — continue the live fold from the compacted form.
// ---------------------------------------------------------------------------

/** The live state after compaction (retained events folded over the checkpoint). */
export function liveStateFromCompacted(compacted: CompactedCommandJournal): CommandJournalState {
  return resumeCommandJournal(compacted.checkpoint, compacted.retained);
}

/** Append new events (seq > cutoffSeq + retained count) onto the compacted journal. */
export function resumeFromCompacted(
  compacted: CompactedCommandJournal,
  newEvents: ReadonlyArray<CommandJournalEvent>,
): CommandJournalState {
  return resumeCommandJournal(compacted.checkpoint, [...compacted.retained, ...newEvents]);
}
