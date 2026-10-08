/**
 * @fleetos/integration-health — the integration convergence view (F251 deliverable 4).
 *
 * Aggregates the two reconciliation surfaces into ONE per-tenant convergence
 * verdict with a FIXED classification ladder and per-source counts:
 *
 *   - `diverged`         — adcos conflict, aurum divergence, or BOTH sides
 *                          lagging in opposite directions on either surface;
 *   - `adapter-lagging`  — the adapter projection is behind its authoritative
 *                          source (adcos twin-ahead; aurum external-ahead);
 *   - `truth-lagging`    — the authoritative source is behind the adapter
 *                          observation (adcos adapter-ahead; aurum local-ahead);
 *   - `converged`        — every record in sync on both surfaces.
 *
 * The repair queue is PURE PROPOSALS: every entry is inert data carrying the
 * lane's own action + reason vocabulary verbatim and the machine-carried
 * `note: "composition-never-executes"`. Adapters never author domain truth —
 * this module exports NO function that mutates a store or performs an action.
 *
 * STRUCTURAL LAW (mirrors the F240B advisory-cannot-feed-back proof): an
 * `AdapterProjectionEntry` cannot be assigned where a domain-authoritative
 * record is required — pinned at the type level via the module-private
 * authority brand AND against the adcos twin-record shape (a projection entry
 * carries no authoritative `digest`).
 *
 * Pure deterministic TypeScript; logical `now` is caller-supplied.
 */

import {
  computeReconciliationDiff,
  resolveReconciliation,
  type AdcosReconciliationDiff,
  type ReconcileRecord,
} from "@fleetos/adcos";
import { reconcileProjectionSet, type ExternalProjectionSnapshot, type ProjectionStore, type ReconciliationReport } from "@fleetos/aurum";
import { HEALTH_SCHEMA_VERSION, healthDigestOf, lexical } from "./health-core.js";

// ---------------------------------------------------------------------------
// Structural law — projections never feed back as authoritative state.
// ---------------------------------------------------------------------------

/** Module-private authority brand: only this module can mint authority. */
declare const authoritativeBrand: unique symbol;

/** A domain-authoritative record (the twin / external source side). */
export interface DomainAuthoritativeRecord {
  readonly [authoritativeBrand]: true;
  readonly id: string;
  readonly digest: string;
}

/** An adapter-side PROJECTION entry — never assignable to authority. */
export interface AdapterProjectionEntry {
  readonly id: string;
  readonly adapterDigest: string;
  readonly source: "adcos" | "aurum";
}

// ---------------------------------------------------------------------------
// Verdicts + counts.
// ---------------------------------------------------------------------------

export type ConvergenceVerdict = "converged" | "adapter-lagging" | "truth-lagging" | "diverged";

export interface ConvergenceSourceCounts {
  readonly adcos: { readonly inSync: number; readonly adapterAhead: number; readonly twinAhead: number; readonly conflict: number };
  readonly aurum: { readonly matched: number; readonly externalOnly: number; readonly localOnly: number; readonly divergent: number };
}

/** The FIXED classification ladder over the per-source counts. */
export function convergenceVerdictOf(counts: ConvergenceSourceCounts): ConvergenceVerdict {
  const { adcos, aurum } = counts;
  if (
    adcos.conflict > 0 || aurum.divergent > 0 ||
    (adcos.adapterAhead > 0 && adcos.twinAhead > 0) ||
    (aurum.externalOnly > 0 && aurum.localOnly > 0)
  ) {
    return "diverged";
  }
  if (adcos.twinAhead > 0 || aurum.externalOnly > 0) return "adapter-lagging";
  if (adcos.adapterAhead > 0 || aurum.localOnly > 0) return "truth-lagging";
  return "converged";
}

// ---------------------------------------------------------------------------
// The repair queue — PURE PROPOSALS (never executed here).
// ---------------------------------------------------------------------------

export interface ConvergenceRepairProposal {
  readonly kind: "convergence-repair-proposal";
  readonly source: "adcos" | "aurum";
  readonly externalId: string;
  /** Lane-carried action vocabulary, verbatim. */
  readonly action: "adopt-twin" | "drop-adapter" | "fetch-external" | "purge-local" | "manual-review";
  /** Lane-carried reason vocabulary, verbatim. */
  readonly reasonCode: string;
  readonly note: "composition-never-executes";
}

// ---------------------------------------------------------------------------
// The view.
// ---------------------------------------------------------------------------

export interface ConvergenceView {
  readonly schemaVersion: number;
  readonly tenantId: string;
  readonly asOf: number;
  readonly verdict: ConvergenceVerdict;
  readonly counts: ConvergenceSourceCounts;
  readonly sources: {
    readonly adcos: { readonly outcome: AdcosReconciliationDiff["outcome"]; readonly digest: string };
    readonly aurum: { readonly classification: ReconciliationReport["classification"]; readonly digest: string };
  };
  readonly projectionEntries: readonly AdapterProjectionEntry[];
  readonly repairQueue: readonly ConvergenceRepairProposal[];
  readonly digest: string;
}

export type ConvergenceRefusal =
  | "missing-tenant"
  | "invalid-now"
  | "tenant-mismatch"
  | "adcos-refused"
  | "aurum-refused";

export type ConvergenceResult =
  | { readonly ok: true; readonly view: ConvergenceView }
  | {
      readonly ok: false;
      readonly refused: ConvergenceRefusal;
      readonly detail: string;
      readonly laneCode?: string;
    };

export interface ConvergenceInput {
  readonly tenantId: string;
  readonly now: number;
  readonly adcos: {
    readonly adapterRecords: readonly ReconcileRecord[];
    readonly twinRecords: readonly ReconcileRecord[];
  };
  readonly aurum: {
    readonly store: ProjectionStore;
    readonly snapshots: readonly ExternalProjectionSnapshot[];
    readonly source: string;
  };
}

// ---------------------------------------------------------------------------
// Assembly.
// ---------------------------------------------------------------------------

function refuse(refused: ConvergenceRefusal, detail: string, laneCode?: string): { ok: false; refused: ConvergenceRefusal; detail: string; laneCode?: string } {
  return laneCode === undefined ? { ok: false, refused, detail } : { ok: false, refused, detail, laneCode };
}

/** Assemble the per-tenant convergence view over the two REAL surfaces. */
export function assembleConvergenceView(input: ConvergenceInput): ConvergenceResult {
  if (!Number.isFinite(input.now) || input.now <= 0) {
    return refuse("invalid-now", `logical now must be finite and positive, got ${String(input.now)}`);
  }
  if (input.tenantId === "") return refuse("missing-tenant", "convergence tenant scope is empty");
  if (input.aurum.store.tenant.tenantId !== input.tenantId) {
    return refuse("tenant-mismatch", `aurum store belongs to tenant "${input.aurum.store.tenant.tenantId}", not "${input.tenantId}"`);
  }
  for (const record of input.adcos.adapterRecords) {
    if (record.tenantId !== undefined && record.tenantId !== input.tenantId) {
      return refuse("tenant-mismatch", `adcos adapter record "${record.id}" belongs to tenant "${record.tenantId}"`);
    }
  }

  // --- adcos: the REAL reconciliation diff + the lane's own resolution plan ---
  const diffResult = computeReconciliationDiff({
    tenantId: input.tenantId,
    now: input.now,
    adapterRecords: input.adcos.adapterRecords,
    twinRecords: input.adcos.twinRecords,
  });
  if (!diffResult.ok) return refuse("adcos-refused", `reconciliation refused: ${diffResult.reason}`, diffResult.reason);
  const diff = diffResult.diff;
  const adcosPlan = resolveReconciliation(diff);

  // --- aurum: the REAL periodic sync-reconciliation ---
  const reconciliation = reconcileProjectionSet(input.aurum.store, input.aurum.snapshots, input.aurum.source, input.now);
  if (!reconciliation.ok) return refuse("aurum-refused", reconciliation.detail, reconciliation.reasonCode);
  const report = reconciliation.report;

  const counts: ConvergenceSourceCounts = {
    adcos: {
      inSync: diff.counts.inSync,
      adapterAhead: diff.counts.adapterAhead,
      twinAhead: diff.counts.twinAhead,
      conflict: diff.counts.conflict,
    },
    aurum: {
      matched: report.matchedIds.length,
      externalOnly: report.externalOnly.length,
      localOnly: report.localOnly.length,
      divergent: report.divergent.length,
    },
  };

  // --- the repair queue: PURE PROPOSALS, lane vocabulary verbatim ---
  const entryClassById = new Map(diff.entries.map((e) => [e.id, e.class] as const));
  const repairQueue: ConvergenceRepairProposal[] = adcosPlan.actions
    .filter((a): a is { readonly id: string; readonly action: "adopt-twin" | "drop-adapter" } => a.action !== "none")
    .map((a) => ({
      kind: "convergence-repair-proposal" as const,
      source: "adcos" as const,
      externalId: a.id,
      action: a.action,
      reasonCode: entryClassById.get(a.id) ?? "unknown",
      note: "composition-never-executes" as const,
    }));
  for (const proposal of report.repairPlan) {
    repairQueue.push({
      kind: "convergence-repair-proposal",
      source: "aurum",
      externalId: proposal.externalId,
      action: proposal.action,
      reasonCode: proposal.reasonCode,
      note: "composition-never-executes",
    });
  }
  repairQueue.sort((a, b) =>
    a.source !== b.source ? (a.source < b.source ? -1 : 1) : lexical(a.externalId, b.externalId),
  );

  // --- projection entries (the adapter side — NEVER authoritative state) ---
  const projectionEntries: AdapterProjectionEntry[] = [
    ...diff.entries
      .filter((e) => e.adapterDigest !== null)
      .map((e) => ({ id: e.id, adapterDigest: e.adapterDigest ?? "", source: "adcos" as const })),
    ...report.divergent.map((d) => ({ id: d.externalId, adapterDigest: d.externalDigest, source: "aurum" as const })),
  ].sort((a, b) => (a.source !== b.source ? (a.source < b.source ? -1 : 1) : lexical(a.id, b.id)));

  const verdict = convergenceVerdictOf(counts);
  const sources: ConvergenceView["sources"] = {
    adcos: { outcome: diff.outcome, digest: diff.digest },
    aurum: { classification: report.classification, digest: report.digest },
  };
  const view: ConvergenceView = {
    schemaVersion: HEALTH_SCHEMA_VERSION,
    tenantId: input.tenantId,
    asOf: input.now,
    verdict,
    counts,
    sources,
    projectionEntries,
    repairQueue,
    digest: convergenceDigestOf(input.tenantId, input.now, verdict, counts, {
      sources,
      projectionEntries,
      repairQueue: repairQueue.map((p) => [p.source, p.externalId, p.action, p.reasonCode, p.note]),
    }),
  };
  return { ok: true, view };
}

function convergenceDigestOf(
  tenantId: string,
  asOf: number,
  verdict: ConvergenceVerdict,
  counts: ConvergenceSourceCounts,
  body: unknown,
): string {
  return healthDigestOf("convergence", {
    tenantId,
    asOf,
    verdict,
    counts,
    body,
  });
}

/** Recompute the convergence digest from the presented view; false = tampered. */
export function verifyConvergenceDigest(view: ConvergenceView): boolean {
  return convergenceDigestOf(
    view.tenantId,
    view.asOf,
    view.verdict,
    view.counts,
    {
      sources: view.sources,
      projectionEntries: view.projectionEntries,
      repairQueue: view.repairQueue.map((p) => [p.source, p.externalId, p.action, p.reasonCode, p.note]),
    },
  ) === view.digest;
}
