/**
 * @fleetos/policy — Append-only decision ledger.
 *
 * Law A19: consequential audit records are append-only, tenant-scoped,
 * hash-verifiable and machine-readable.
 *
 * The decision ledger is a hash-chain over DecisionRecords — each entry links
 * to the previous entry's digest. Tamper detection is pure and deterministic.
 *
 * Pure functions only. The Sha256Port seam allows test substitution.
 */

import type { DecisionRecord } from "./decision-record.ts";

/** Re-export the sha-256 seam shape so callers don't need @fleetos/evidence. */
export type Sha256Port = (bytes: Uint8Array) => string;

/** A single entry in the append-only decision ledger. */
export interface DecisionLedgerEntry {
  readonly index: number;
  readonly tenantId: string;
  readonly recordId: string;
  readonly decisionDigest: string;
  readonly previousDigest: string | null;
  readonly entryDigest: string;
  readonly recordedAt: string;
  readonly verdict: string;
  readonly reasonCode: string;
}

/** Result of verifying the ledger. */
export interface DecisionLedgerVerification {
  readonly verified: boolean;
  readonly checkedEntries: number;
  readonly brokenAt: number | null;
  readonly reason: LedgerBreakReason | null;
  readonly computedTailDigest: string | null;
}

export type LedgerBreakReason =
  | "ledger.empty"
  | "ledger.tenant_mismatch"
  | "ledger.index_gap"
  | "ledger.previous_digest_mismatch"
  | "ledger.entry_digest_mismatch"
  | "ledger.first_entry_has_previous";

/** Default SHA-256 — uses the @fleetos/evidence seam (node:crypto). */
const defaultSha256: Sha256Port = (bytes) => {
  // Lazy import to keep the package surface pure-TS.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createHash } = require("node:crypto") as typeof import("node:crypto");
  return createHash("sha256").update(bytes).digest("hex");
};

function utf8Bytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/** Compute the canonical entry digest for a decision ledger entry. */
export function computeLedgerEntryDigest(
  previousDigest: string | null,
  recordId: string,
  tenantId: string,
  decisionDigest: string,
  index: number,
  port: Sha256Port = defaultSha256,
): string {
  const parts = `${previousDigest ?? ""}|${recordId}|${tenantId}|${decisionDigest}|${index}`;
  return port(utf8Bytes(parts));
}

/**
 * Append a decision to the ledger — pure, returns a new array.
 *
 * Throws on tenant mismatch (law A8 — cross-tenant appends are impossible).
 */
export function appendDecision(
  ledger: readonly DecisionLedgerEntry[],
  record: DecisionRecord,
  port: Sha256Port = defaultSha256,
): readonly DecisionLedgerEntry[] {
  if (ledger.length === 0) {
    const entryDigest = computeLedgerEntryDigest(
      null,
      record.recordId,
      record.tenantId,
      record.decision.decisionDigest,
      0,
      port,
    );
    return [{
      index: 0,
      tenantId: record.tenantId,
      recordId: record.recordId,
      decisionDigest: record.decision.decisionDigest,
      previousDigest: null,
      entryDigest,
      recordedAt: record.evaluatedAt,
      verdict: record.decision.verdict,
      reasonCode: record.decision.reasonCode,
    }];
  }
  const last = ledger[ledger.length - 1]!;
  if (last.tenantId !== record.tenantId) {
    throw new Error(
      `appendDecision: tenant mismatch (ledger=${last.tenantId}, record=${record.tenantId})`,
    );
  }
  const index = last.index + 1;
  const entryDigest = computeLedgerEntryDigest(
    last.entryDigest,
    record.recordId,
    record.tenantId,
    record.decision.decisionDigest,
    index,
    port,
  );
  return [...ledger, {
    index,
    tenantId: record.tenantId,
    recordId: record.recordId,
    decisionDigest: record.decision.decisionDigest,
    previousDigest: last.entryDigest,
    entryDigest,
    recordedAt: record.evaluatedAt,
    verdict: record.decision.verdict,
    reasonCode: record.decision.reasonCode,
  }];
}

/**
 * Verify a decision ledger — pure, deterministic, tamper-detecting.
 *
 * Checks:
 *   - empty => verified:true, checked:0.
 *   - first entry must have previousDigest=null.
 *   - every entry's previousDigest must equal the prior entry's entryDigest.
 *   - every entry's index must equal its position.
 *   - every entry's tenantId must be consistent (law A8).
 *   - every entry's entryDigest must equal computeLedgerEntryDigest(...).
 */
export function verifyDecisionLedger(
  ledger: readonly DecisionLedgerEntry[],
  port: Sha256Port = defaultSha256,
): DecisionLedgerVerification {
  if (ledger.length === 0) {
    return {
      verified: true,
      checkedEntries: 0,
      brokenAt: null,
      reason: "ledger.empty",
      computedTailDigest: null,
    };
  }
  const tenantId = ledger[0]!.tenantId;
  let previousDigest: string | null = null;
  for (let i = 0; i < ledger.length; i += 1) {
    const entry = ledger[i]!;
    if (entry.index !== i) {
      return { verified: false, checkedEntries: i, brokenAt: i, reason: "ledger.index_gap", computedTailDigest: previousDigest };
    }
    if (entry.tenantId !== tenantId) {
      return { verified: false, checkedEntries: i, brokenAt: i, reason: "ledger.tenant_mismatch", computedTailDigest: previousDigest };
    }
    if (i === 0) {
      if (entry.previousDigest !== null) {
        return { verified: false, checkedEntries: i, brokenAt: i, reason: "ledger.first_entry_has_previous", computedTailDigest: previousDigest };
      }
    } else {
      if (entry.previousDigest !== previousDigest) {
        return { verified: false, checkedEntries: i, brokenAt: i, reason: "ledger.previous_digest_mismatch", computedTailDigest: previousDigest };
      }
    }
    const expected = computeLedgerEntryDigest(
      entry.previousDigest,
      entry.recordId,
      entry.tenantId,
      entry.decisionDigest,
      entry.index,
      port,
    );
    if (expected !== entry.entryDigest) {
      return { verified: false, checkedEntries: i, brokenAt: i, reason: "ledger.entry_digest_mismatch", computedTailDigest: previousDigest };
    }
    previousDigest = entry.entryDigest;
  }
  return {
    verified: true,
    checkedEntries: ledger.length,
    brokenAt: null,
    reason: null,
    computedTailDigest: previousDigest,
  };
}

/**
 * Tamper-detection helper — flip a single entryDigest and confirm the ledger
 * breaks. Exported for machine-testing law A19.
 */
export function tamperEntry(
  ledger: readonly DecisionLedgerEntry[],
  atIndex: number,
  newDigest: string,
): readonly DecisionLedgerEntry[] {
  if (atIndex < 0 || atIndex >= ledger.length) {
    throw new Error(`tamperEntry: index ${atIndex} out of range (len ${ledger.length})`);
  }
  return ledger.map((e, i) => (i === atIndex ? { ...e, entryDigest: newDigest } : e));
}
