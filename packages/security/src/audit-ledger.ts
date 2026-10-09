/**
 * @fleetos/security — Tamper-evident audit ledger (F280B, Wave 8 lane B).
 *
 * A UNIFIED, append-only, hash-chained audit ledger over the lane's REAL
 * decision surfaces (Guardian evaluations, action emissions, execution ledger
 * entries — the surface-specific sealers live beside the records they seal;
 * see `@fleetos/execution` incident-audit). This module is the dependency-free
 * engine: it knows the surface VOCABULARY but no @fleetos types.
 *
 * Laws:
 *  - A19: append-only, tenant-scoped, hash-verifiable, machine-readable.
 *  - A8: tenant fail-closed — an append whose tenant differs from the chain's
 *    tenant REFUSES (`audit.tenant-mismatch`); an empty tenant REFUSES.
 *  - Determinism: no clock, no randomness, no I/O. `occurredAt` is a
 *    caller-supplied logical epoch-ms; digests are FNV-1a over canonical JSON
 *    (the lane's established presentation convention).
 *
 * GAP-DETECTION SEMANTICS (documented, machine-tested):
 *  - Entries carry 0-based `sequence` numbers. `verifyAuditLedger` checks
 *    sequence continuity FIRST: if the entry at position i carries a sequence
 *    greater than i, entries were REMOVED — the result names `gapAt: i` (the
 *    position of the first missing entry) with reason `audit.gap`. A sequence
 *    smaller than its position (rewind/duplication) reports
 *    `audit.sequence-regressed` at the detection position.
 *  - A removed entry ALSO breaks the hash chain: the surviving successor's
 *    `previousDigest` points at the removed entry's digest. The sequence
 *    check fires first and pins the gap position precisely.
 *  - HONEST LIMIT: removing the FINAL entry (tail truncation) leaves a
 *    shorter but internally valid chain — inherent to hash chains without an
 *    external anchor. `sealAuditLedgerHead` returns an anchor digest the
 *    caller persists OUTSIDE the ledger; `verifyAuditLedgerAgainstAnchor`
 *    detects tail truncation by comparing the recomputed head digest.
 */

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** The lane's REAL decision surfaces the unified ledger seals. */
export type AuditLedgerSurface = "guardian.evaluation" | "action.emission" | "execution.entry";

const SURFACES: readonly AuditLedgerSurface[] = [
  "guardian.evaluation",
  "action.emission",
  "execution.entry",
];

/** One sealed audit event — append-only, hash-chained. */
export interface AuditLedgerEvent {
  /** 0-based position — monotonically increasing. */
  readonly sequence: number;
  readonly tenantId: string;
  readonly surface: AuditLedgerSurface;
  /** The sealed record's stable id (recordId / eventId / key#index). */
  readonly subjectId: string;
  /** Logical epoch ms — caller-supplied, never wall-clock. */
  readonly occurredAt: number;
  /** FNV-1a over the canonical JSON of the payload. */
  readonly payloadDigest: string;
  /** Canonical JSON of the payload (the auditable content). */
  readonly payloadCanonical: string;
  readonly previousDigest: string | null;
  /** Chain digest over (sequence, tenant, surface, subject, at, payloadDigest, previousDigest). */
  readonly entryDigest: string;
}

export type AuditAppendRefusal =
  | "audit.missing-tenant"
  | "audit.missing-subject"
  | "audit.unknown-surface"
  | "audit.invalid-occurred-at"
  | "audit.invalid-sequence"
  | "audit.tenant-mismatch";

export type AuditAppendResult =
  | { readonly ok: true; readonly ledger: readonly AuditLedgerEvent[]; readonly event: AuditLedgerEvent }
  | { readonly ok: false; readonly reason: AuditAppendRefusal };

export type AuditBreakReason =
  | "audit.gap"
  | "audit.sequence-regressed"
  | "audit.tenant_mismatch"
  | "audit.previous_digest_mismatch"
  | "audit.entry_digest_mismatch"
  | "audit.first_entry_has_previous"
  | "audit.payload_digest_mismatch";

export interface AuditVerification {
  readonly verified: boolean;
  readonly checkedEntries: number;
  /** Position where verification stopped (the DETECTION position). */
  readonly brokenAt: number | null;
  /** Position of the first MISSING entry (removal gap) — null unless a gap. */
  readonly gapAt: number | null;
  readonly reason: AuditBreakReason | null;
  readonly computedHeadDigest: string | null;
}

// ---------------------------------------------------------------------------
// Deterministic digests (local — the lane's presentation convention)
// ---------------------------------------------------------------------------

/** FNV-1a 32-bit — deterministic, dependency-free. */
export function auditFnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Canonical JSON: object keys recursively sorted, arrays kept in order. */
export function auditCanonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return value === undefined ? "null" : (JSON.stringify(value) ?? "null");
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => auditCanonicalJson(v === undefined ? null : v)).join(",")}]`;
  }
  const rec = value as Record<string, unknown>;
  const keys = Object.keys(rec).filter((k) => rec[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${auditCanonicalJson(rec[k])}`).join(",")}}`;
}

/** Content digest of an audit payload — canonical JSON + FNV-1a. */
export function auditPayloadDigest(payload: Readonly<Record<string, unknown>>): string {
  return auditFnv1a(auditCanonicalJson(payload));
}

/** Chain digest of one event over its canonical fields. */
export function auditEntryDigest(event: {
  readonly sequence: number;
  readonly tenantId: string;
  readonly surface: AuditLedgerSurface;
  readonly subjectId: string;
  readonly occurredAt: number;
  readonly payloadDigest: string;
  readonly previousDigest: string | null;
}): string {
  return auditFnv1a(
    [
      String(event.sequence),
      event.tenantId,
      event.surface,
      event.subjectId,
      String(event.occurredAt),
      event.payloadDigest,
      event.previousDigest ?? "",
    ].join("|"),
  );
}

// ---------------------------------------------------------------------------
// Append — append-only, tenant fail-closed
// ---------------------------------------------------------------------------

/**
 * Append one audit event. The payload is sealed content-addressedly: the
 * canonical JSON and its digest are computed here, never accepted pre-digested
 * (a caller cannot smuggle a payload whose digest does not match its content).
 */
export function appendAuditEvent(
  ledger: readonly AuditLedgerEvent[],
  input: {
    readonly tenantId: string;
    readonly surface: AuditLedgerSurface;
    readonly subjectId: string;
    readonly occurredAt: number;
    readonly payload: Readonly<Record<string, unknown>>;
    readonly sequence?: number;
  },
): AuditAppendResult {
  if (input.tenantId === "") return { ok: false, reason: "audit.missing-tenant" };
  if (input.subjectId === "") return { ok: false, reason: "audit.missing-subject" };
  if (!SURFACES.includes(input.surface)) return { ok: false, reason: "audit.unknown-surface" };
  if (!Number.isInteger(input.occurredAt) || input.occurredAt < 0) {
    return { ok: false, reason: "audit.invalid-occurred-at" };
  }
  const last = ledger.length > 0 ? ledger[ledger.length - 1]! : null;
  if (last !== null && last.tenantId !== input.tenantId) {
    return { ok: false, reason: "audit.tenant-mismatch" };
  }
  const sequence = input.sequence ?? ledger.length;
  if (!Number.isInteger(sequence) || sequence !== ledger.length) {
    return { ok: false, reason: "audit.invalid-sequence" };
  }
  const payloadCanonical = auditCanonicalJson(input.payload);
  const payloadDigest = auditFnv1a(payloadCanonical);
  const event: AuditLedgerEvent = {
    sequence,
    tenantId: input.tenantId,
    surface: input.surface,
    subjectId: input.subjectId,
    occurredAt: input.occurredAt,
    payloadDigest,
    payloadCanonical,
    previousDigest: last === null ? null : last.entryDigest,
    entryDigest: "",
  };
  const entryDigest = auditEntryDigest(event);
  const sealed: AuditLedgerEvent = { ...event, entryDigest };
  return { ok: true, ledger: [...ledger, sealed], event: sealed };
}

// ---------------------------------------------------------------------------
// Verify — hash chain + GAP DETECTION
// ---------------------------------------------------------------------------

/**
 * Verify the audit ledger. Checks, in order, per position i:
 *   1. sequence continuity — a jump names the REMOVED entry's position
 *      (`gapAt: i`, reason `audit.gap`); a rewind reports
 *      `audit.sequence-regressed`;
 *   2. tenant consistency (A8 fail-closed);
 *   3. previous-digest linkage (first entry must chain from null);
 *   4. payload digest — `payloadCanonical` must rehash to `payloadDigest`;
 *   5. entry digest — the chain digest must recompute exactly.
 */
export function verifyAuditLedger(ledger: readonly AuditLedgerEvent[]): AuditVerification {
  if (ledger.length === 0) {
    return { verified: true, checkedEntries: 0, brokenAt: null, gapAt: null, reason: null, computedHeadDigest: null };
  }
  const tenantId = ledger[0]!.tenantId;
  let previousDigest: string | null = null;
  for (let i = 0; i < ledger.length; i += 1) {
    const event = ledger[i]!;
    if (event.sequence !== i) {
      if (event.sequence > i) {
        // Entries were REMOVED: the first missing position is i.
        return {
          verified: false, checkedEntries: i, brokenAt: i, gapAt: i,
          reason: "audit.gap", computedHeadDigest: previousDigest,
        };
      }
      return {
        verified: false, checkedEntries: i, brokenAt: i, gapAt: null,
        reason: "audit.sequence-regressed", computedHeadDigest: previousDigest,
      };
    }
    if (event.tenantId !== tenantId) {
      return { verified: false, checkedEntries: i, brokenAt: i, gapAt: null, reason: "audit.tenant_mismatch", computedHeadDigest: previousDigest };
    }
    if (i === 0) {
      if (event.previousDigest !== null) {
        return { verified: false, checkedEntries: i, brokenAt: i, gapAt: null, reason: "audit.first_entry_has_previous", computedHeadDigest: previousDigest };
      }
    } else if (event.previousDigest !== previousDigest) {
      return { verified: false, checkedEntries: i, brokenAt: i, gapAt: null, reason: "audit.previous_digest_mismatch", computedHeadDigest: previousDigest };
    }
    if (auditFnv1a(event.payloadCanonical) !== event.payloadDigest) {
      return { verified: false, checkedEntries: i, brokenAt: i, gapAt: null, reason: "audit.payload_digest_mismatch", computedHeadDigest: previousDigest };
    }
    const expected = auditEntryDigest(event);
    if (expected !== event.entryDigest) {
      return { verified: false, checkedEntries: i, brokenAt: i, gapAt: null, reason: "audit.entry_digest_mismatch", computedHeadDigest: previousDigest };
    }
    previousDigest = event.entryDigest;
  }
  return {
    verified: true,
    checkedEntries: ledger.length,
    brokenAt: null,
    gapAt: null,
    reason: null,
    computedHeadDigest: previousDigest,
  };
}

// ---------------------------------------------------------------------------
// Anchoring — external tail-truncation detection
// ---------------------------------------------------------------------------

/**
 * Seal the ledger head — the digest of the LAST entry. Persist this OUTSIDE
 * the ledger (e.g. in an evidence bundle); a ledger whose tail was truncated
 * no longer reaches the anchored head digest.
 */
export function sealAuditLedgerHead(ledger: readonly AuditLedgerEvent[]): string | null {
  if (ledger.length === 0) return null;
  return ledger[ledger.length - 1]!.entryDigest;
}

/**
 * Verify the ledger against an externally persisted head anchor.
 * A verified chain whose head differs from the anchor is a TRUNCATED tail
 * (`audit.truncated-tail`) — the honest detection of final-entry removal.
 */
export function verifyAuditLedgerAgainstAnchor(
  ledger: readonly AuditLedgerEvent[],
  anchor: string,
): AuditVerification & { readonly truncated: boolean } {
  const base = verifyAuditLedger(ledger);
  if (!base.verified) return { ...base, truncated: false };
  const head = sealAuditLedgerHead(ledger);
  const truncated = head !== anchor;
  return {
    ...base,
    verified: !truncated,
    reason: truncated ? "audit.entry_digest_mismatch" : null,
    truncated,
  };
}

// ---------------------------------------------------------------------------
// Tamper helpers — machine-testing law A19 (same discipline as the lane's
// existing tamperExecutionEntry / tamperEntry)
// ---------------------------------------------------------------------------

/** Remove one event by sequence — the "removed entry" attack, for tests. */
export function dropAuditEvent(
  ledger: readonly AuditLedgerEvent[],
  sequence: number,
): readonly AuditLedgerEvent[] {
  return ledger.filter((e) => e.sequence !== sequence);
}

/** Mutate one event's payload content without re-sealing — content tamper. */
export function tamperAuditPayload(
  ledger: readonly AuditLedgerEvent[],
  sequence: number,
  patch: Readonly<Record<string, unknown>>,
): readonly AuditLedgerEvent[] {
  return ledger.map((e) => {
    if (e.sequence !== sequence) return e;
    const payload: Record<string, unknown> = JSON.parse(e.payloadCanonical) as Record<string, unknown>;
    return { ...e, payloadCanonical: auditCanonicalJson({ ...payload, ...patch }) };
  });
}

/** Forge one event's chain digest — link tamper, for tests. */
export function tamperAuditEntryDigest(
  ledger: readonly AuditLedgerEvent[],
  sequence: number,
  forgedDigest: string,
): readonly AuditLedgerEvent[] {
  return ledger.map((e) => (e.sequence === sequence ? { ...e, entryDigest: forgedDigest } : e));
}
