/**
 * @fleetos/control-plane — the execution ledger (law A19).
 *
 * Append-only, per-tenant, hash-CHAINED entries with an audit digest per
 * entry: every entry's digest covers its predecessor's digest, so any
 * tamper, removal or reorder breaks `verifyChain`. Entries are frozen on
 * append. Reads are tenant-scoped — a caller can only ever observe their
 * own tenant's chain (fail closed by construction).
 *
 * Deterministic: same append sequence → byte-identical digests.
 */

import type { TenantContext, TenantId } from "@fleetos/kernel";
import { fail, ok, type Result } from "./result.js";
import { digestOf } from "./digest.js";
import { isCommandId } from "./ids.js";

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------

export type LedgerEntryKind =
  | "submitted"
  | "duplicate-suppressed"
  | "acknowledged"
  | "attempt-failed"
  | "retry-scheduled"
  | "completed"
  | "dead-lettered"
  | "transport-timeout";

export interface LedgerEntry {
  readonly seq: number;
  readonly tenantId: TenantId;
  readonly commandId: string;
  readonly kind: LedgerEntryKind;
  /** Attempt number the entry refers to (0 for submission entries). */
  readonly attempt: number;
  readonly at: number;
  readonly reason: string | null;
  /** sha256 over (prevDigest | seq | commandId | kind | attempt | at | reason). */
  readonly digest: string;
  readonly prevDigest: string | null;
}

export type LedgerRejection =
  | "invalid-command-id"
  | "invalid-attempt"
  | "invalid-at";

// ---------------------------------------------------------------------------
// ExecutionLedger
// ---------------------------------------------------------------------------

export class ExecutionLedger {
  private readonly chains = new Map<string, LedgerEntry[]>();

  /** Append an entry to the caller's tenant chain. Entries are frozen. */
  append(input: {
    readonly ctx: TenantContext;
    readonly commandId: string;
    readonly kind: LedgerEntryKind;
    readonly attempt: number;
    readonly at: number;
    readonly reason?: string;
  }): Result<LedgerEntry, LedgerRejection> {
    if (typeof input.commandId !== "string" || !isCommandId(input.commandId)) {
      return fail("invalid-command-id");
    }
    if (!Number.isInteger(input.attempt) || input.attempt < 0) {
      return fail("invalid-attempt");
    }
    if (!Number.isFinite(input.at) || input.at <= 0) {
      return fail("invalid-at");
    }
    const tenantKey = String(input.ctx.tenantId);
    const chain = this.chains.get(tenantKey) ?? [];
    const prevDigest =
      chain.length > 0 ? chain[chain.length - 1]?.digest ?? null : null;
    const seq = chain.length + 1;
    const reason = input.reason ?? null;
    const digest = digestOf(
      prevDigest ?? `genesis:${tenantKey}`,
      seq,
      input.commandId,
      input.kind,
      input.attempt,
      input.at,
      reason ?? "",
    );
    const entry: LedgerEntry = Object.freeze({
      seq,
      tenantId: input.ctx.tenantId,
      commandId: input.commandId,
      kind: input.kind,
      attempt: input.attempt,
      at: input.at,
      reason,
      digest,
      prevDigest,
    });
    chain.push(entry);
    this.chains.set(tenantKey, chain);
    return ok(entry);
  }

  /** The caller's own chain, seq-ordered. Cross-tenant chains are unreachable. */
  entriesFor(ctx: TenantContext): ReadonlyArray<LedgerEntry> {
    const chain = this.chains.get(String(ctx.tenantId));
    return chain ? [...chain] : [];
  }

  entryCount(ctx: TenantContext): number {
    return this.entriesFor(ctx).length;
  }

  /**
   * Recompute the whole chain: every digest must match its recomputed
   * value AND link to its predecessor. Any tamper, removal or reorder
   * (in the array handed to the verifier) breaks the chain.
   */
  verifyChain(ctx: TenantContext): boolean {
    const tenantKey = String(ctx.tenantId);
    const chain = this.chains.get(tenantKey);
    if (!chain) return true; // an empty chain is trivially valid
    let prev: string | null = null;
    for (let i = 0; i < chain.length; i++) {
      const entry = chain[i];
      if (!entry) return false;
      if (entry.seq !== i + 1) return false;
      if (entry.prevDigest !== prev) return false;
      const expected = digestOf(
        prev ?? `genesis:${tenantKey}`,
        entry.seq,
        entry.commandId,
        entry.kind,
        entry.attempt,
        entry.at,
        entry.reason ?? "",
      );
      if (entry.digest !== expected) return false;
      prev = entry.digest;
    }
    return true;
  }
}
