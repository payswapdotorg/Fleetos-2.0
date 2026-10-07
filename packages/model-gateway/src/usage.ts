/**
 * @fleetos/model-gateway — usage accounting: the append-only usage ledger
 * + budget enforcement through the BudgetCheckPort TYPE seam (F230C).
 *
 * The ledger is append-only: every entry carries a ledger-assigned
 * sequence number and a digest CHAINED to its predecessor (the projects
 * lane's chained-ledger pattern). Enforcement against agent-organization
 * budgets goes through `BudgetCheckPort` — a LOCAL structural shape; this
 * package does NOT import @fleetos/agent-organizations at runtime (packet
 * rule; the TL composes the two contexts). Duplicate request refs are
 * refused (idempotency); refusals are NEVER silent drops (law A4).
 *
 * Laws: A4 (refuse, never silently drop/clamp), A7 (no provider types),
 * A19 (chained audit digests). Pure deterministic TS; timestamps are
 * number inputs.
 */

import { fnv1a32 } from "./internal-digest.js";

// ---------------------------------------------------------------------------
// The cross-context budget-check TYPE seam.
// ---------------------------------------------------------------------------

/**
 * BudgetCheckPort — the local structural shape of the agent-organizations
 * budget check (agent-scoped ceiling check). TYPE seam only: no runtime
 * import of @fleetos/agent-organizations (A20 + packet rule). The TL binds
 * the real implementation at the composition site; structural
 * compatibility with `checkAgentBudget` in the org package is deliberate.
 */
export interface BudgetCheckPort {
  check(input: {
    readonly tenantId: string;
    readonly agentId: string;
    readonly capability: string;
    readonly unitsRequested: number;
    readonly spendRequestedMinor: number;
  }): { readonly ok: true; readonly remainingUnits: number; readonly remainingSpendMinor: number } | { readonly ok: false; readonly reasonCode: string };
}

// ---------------------------------------------------------------------------
// The usage ledger.
// ---------------------------------------------------------------------------

export interface UsageLedgerEntry {
  readonly seq: number;
  readonly tenantId: string;
  readonly agentId: string;
  readonly requestRef: string;
  readonly modelId: string;
  readonly providerId: string;
  readonly capability: string;
  readonly units: number;
  readonly costMinor: number;
  /** Timestamp as an explicit number input (logical time). */
  readonly at: number;
  readonly digest: string;
  readonly prevDigest: string | null;
}

export const USAGE_LEDGER_GENESIS = "usagedger_genesis";

export function usageEntryDigest(
  prevDigest: string | null,
  entry: Omit<UsageLedgerEntry, "digest" | "prevDigest">,
): string {
  return `usage_${fnv1a32([
    prevDigest ?? USAGE_LEDGER_GENESIS,
    entry.seq,
    entry.tenantId,
    entry.agentId,
    entry.requestRef,
    entry.modelId,
    entry.providerId,
    entry.capability,
    entry.units,
    entry.costMinor,
    entry.at,
  ])}`;
}

export type UsageAppendReasonCode =
  | "TENANT_ID_EMPTY"
  | "AGENT_ID_EMPTY"
  | "REQUEST_REF_EMPTY"
  | "MODEL_ID_EMPTY"
  | "PROVIDER_ID_EMPTY"
  | "CAPABILITY_EMPTY"
  | "NEGATIVE_UNITS"
  | "NEGATIVE_COST"
  | "NON_INTEGER_AMOUNT"
  | "NEGATIVE_TIME"
  | "TENANT_MISMATCH"
  | "DUPLICATE_REQUEST_REF"
  | "BUDGET_REFUSED_BY_ORG";

export type UsageAppendResult =
  | { readonly ok: true; readonly ledger: readonly UsageLedgerEntry[]; readonly appended: UsageLedgerEntry }
  | {
      readonly ok: false;
      readonly reasonCode: UsageAppendReasonCode;
      readonly budgetReasonCode: string | null;
      readonly conflictingSeq: number | null;
    };

/**
 * Append a usage record to the ledger AFTER enforcing the org budget
 * through the port. PURE: returns a NEW ledger array; the input ledger is
 * never mutated. Rules:
 *   - the port's refusal propagates (`BUDGET_REFUSED_BY_ORG` carries the
 *     org's reason code) — never a silent drop;
 *   - a requestRef already present in the ledger refuses
 *     `DUPLICATE_REQUEST_REF` with the conflicting seq (idempotency —
 *     retries never double-charge);
 *   - entries are tenant-uniform — a cross-tenant append refuses
 *     `TENANT_MISMATCH` (fail-closed, law A8);
 *   - the new entry's digest chains to the predecessor's.
 */
export function appendUsage(
  ledger: readonly UsageLedgerEntry[],
  port: BudgetCheckPort,
  input: {
    readonly tenantId: string;
    readonly agentId: string;
    readonly requestRef: string;
    readonly modelId: string;
    readonly providerId: string;
    readonly capability: string;
    readonly units: number;
    readonly costMinor: number;
    readonly at: number;
  },
): UsageAppendResult {
  if (typeof input.tenantId !== "string" || input.tenantId.length === 0) {
    return failUsage("TENANT_ID_EMPTY", null, null);
  }
  if (typeof input.agentId !== "string" || input.agentId.length === 0) {
    return failUsage("AGENT_ID_EMPTY", null, null);
  }
  if (typeof input.requestRef !== "string" || input.requestRef.length === 0) {
    return failUsage("REQUEST_REF_EMPTY", null, null);
  }
  if (typeof input.modelId !== "string" || input.modelId.length === 0) {
    return failUsage("MODEL_ID_EMPTY", null, null);
  }
  if (typeof input.providerId !== "string" || input.providerId.length === 0) {
    return failUsage("PROVIDER_ID_EMPTY", null, null);
  }
  if (typeof input.capability !== "string" || input.capability.length === 0) {
    return failUsage("CAPABILITY_EMPTY", null, null);
  }
  if (!Number.isInteger(input.units) || !Number.isInteger(input.costMinor)) {
    return failUsage("NON_INTEGER_AMOUNT", null, null);
  }
  if (input.units < 0) return failUsage("NEGATIVE_UNITS", null, null);
  if (input.costMinor < 0) return failUsage("NEGATIVE_COST", null, null);
  if (input.at < 0) return failUsage("NEGATIVE_TIME", null, null);
  for (const entry of ledger) {
    if (entry.tenantId !== input.tenantId) {
      return failUsage("TENANT_MISMATCH", null, null);
    }
    if (entry.requestRef === input.requestRef) {
      return failUsage("DUPLICATE_REQUEST_REF", null, entry.seq);
    }
  }
  const budgetDecision = port.check({
    tenantId: input.tenantId,
    agentId: input.agentId,
    capability: input.capability,
    unitsRequested: input.units,
    spendRequestedMinor: input.costMinor,
  });
  if (!budgetDecision.ok) {
    return failUsage("BUDGET_REFUSED_BY_ORG", budgetDecision.reasonCode, null);
  }
  const last = ledger.length > 0 ? ledger[ledger.length - 1] : undefined;
  const prevDigest = last ? last.digest : null;
  const seq = ledger.length + 1;
  const base = {
    seq,
    tenantId: input.tenantId,
    agentId: input.agentId,
    requestRef: input.requestRef,
    modelId: input.modelId,
    providerId: input.providerId,
    capability: input.capability,
    units: input.units,
    costMinor: input.costMinor,
    at: input.at,
  };
  const appended: UsageLedgerEntry = {
    ...base,
    digest: usageEntryDigest(prevDigest, base),
    prevDigest,
  };
  return { ok: true, ledger: [...ledger, appended], appended };
}

function failUsage(
  reasonCode: UsageAppendReasonCode,
  budgetReasonCode: string | null,
  conflictingSeq: number | null,
): UsageAppendResult {
  return { ok: false, reasonCode, budgetReasonCode, conflictingSeq };
}

// ---------------------------------------------------------------------------
// Chain verification + totals (pure projections).
// ---------------------------------------------------------------------------

export type UsageChainVerification =
  | { readonly ok: true; readonly entries: number }
  | { readonly ok: false; readonly reasonCode: "CHAIN_EMPTY" | "CHAIN_SEQ_GAP" | "CHAIN_DIGEST_MISMATCH" | "CHAIN_TENANT_MISMATCH"; readonly brokenAtSeq: number | null };

/**
 * Verify the usage ledger chain: contiguous seqs, exact prevDigest links,
 * recomputable digests, uniform tenant. Tampering detected at the
 * earliest broken seq. Pure.
 */
export function verifyUsageLedgerChain(ledger: readonly UsageLedgerEntry[]): UsageChainVerification {
  if (ledger.length === 0) {
    return { ok: false, reasonCode: "CHAIN_EMPTY", brokenAtSeq: null };
  }
  const first = ledger[0] as UsageLedgerEntry;
  let prevDigest: string | null = null;
  for (let i = 0; i < ledger.length; i++) {
    const entry = ledger[i] as UsageLedgerEntry;
    if (entry.seq !== i + 1) {
      return { ok: false, reasonCode: "CHAIN_SEQ_GAP", brokenAtSeq: entry.seq };
    }
    if (entry.tenantId !== first.tenantId) {
      return { ok: false, reasonCode: "CHAIN_TENANT_MISMATCH", brokenAtSeq: entry.seq };
    }
    if (entry.prevDigest !== prevDigest) {
      return { ok: false, reasonCode: "CHAIN_DIGEST_MISMATCH", brokenAtSeq: entry.seq };
    }
    const expected = usageEntryDigest(prevDigest, {
      seq: entry.seq,
      tenantId: entry.tenantId,
      agentId: entry.agentId,
      requestRef: entry.requestRef,
      modelId: entry.modelId,
      providerId: entry.providerId,
      capability: entry.capability,
      units: entry.units,
      costMinor: entry.costMinor,
      at: entry.at,
    });
    if (entry.digest !== expected) {
      return { ok: false, reasonCode: "CHAIN_DIGEST_MISMATCH", brokenAtSeq: entry.seq };
    }
    prevDigest = entry.digest;
  }
  return { ok: true, entries: ledger.length };
}

/** Deterministic totals: summed units and integer minor-unit cost. Pure. */
export function sumUsageLedger(ledger: readonly UsageLedgerEntry[]): {
  readonly totalUnits: number;
  readonly totalCostMinor: number;
  readonly entries: number;
} {
  let totalUnits = 0;
  let totalCostMinor = 0;
  for (const entry of ledger) {
    totalUnits += entry.units;
    totalCostMinor += entry.costMinor;
  }
  return { totalUnits, totalCostMinor, entries: ledger.length };
}
