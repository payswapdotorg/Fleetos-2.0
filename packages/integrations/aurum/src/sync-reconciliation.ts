/**
 * @fleetos/aurum — periodic full-state reconciliation (Wave 5).
 *
 * Deterministic set-diff between the EXTERNAL projection snapshot set
 * (caller-supplied — fetched through the AurumPort by the composing
 * application) and the locally-applied replica store. Output is classified:
 *   - in-sync         — no differences at all
 *   - external-ahead  — external has projections the local replica lacks
 *   - local-ahead     — the replica has live projections external lacks
 *   - diverged        — mixed drift or same-id content divergence
 *
 * THE REPAIR PLAN IS A PURE PROPOSAL (adapters never execute): every
 * `RepairProposal` is inert data tagged `kind: "repair-proposal"` and
 * `note: "adapter-never-executes"`. This module exports NO function that
 * mutates a store or performs an action; the composing application (or the
 * TL's composition site) decides and executes under Guardian authority.
 *
 * Pure, deterministic, tenant fail-closed; logical `now` is caller-supplied.
 */
import { validateTenantScope, type TenantScope } from "./tenant.js";
import { canonicalJson, fnv1a32Hex } from "./digest.js";
import {
  computeProjectionDigest,
  listLiveProjections,
  type ProjectionStore,
} from "./delta-apply.js";

// ---------------------------------------------------------------------------
// Types.
// ---------------------------------------------------------------------------

export interface ExternalProjectionSnapshot {
  readonly externalId: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly logicalTime: number;
}

export type ReconciliationClass = "in-sync" | "external-ahead" | "local-ahead" | "diverged";

export type RepairAction = "fetch-external" | "purge-local" | "manual-review";

export interface RepairProposal {
  readonly kind: "repair-proposal";
  readonly action: RepairAction;
  readonly externalId: string;
  readonly reasonCode: "EXTERNAL_AHEAD" | "LOCAL_AHEAD" | "DIVERGED";
  readonly note: "adapter-never-executes";
}

export interface DivergentPair {
  readonly externalId: string;
  readonly externalDigest: string;
  readonly localDigest: string;
}

export interface ReconciliationReport {
  readonly tenant: TenantScope;
  readonly source: string;
  readonly computedAt: number;
  readonly classification: ReconciliationClass;
  readonly matchedIds: readonly string[];
  readonly externalOnly: readonly string[];
  readonly localOnly: readonly string[];
  readonly divergent: readonly DivergentPair[];
  readonly repairPlan: readonly RepairProposal[];
  readonly digest: string;
}

export type ReconciliationRefusalCode =
  | "TENANT_SCOPE_MISSING"
  | "TENANT_MISMATCH"
  | "SOURCE_MISMATCH"
  | "SNAPSHOT_MALFORMED"
  | "LOGICAL_TIME_INVALID";

export type ReconciliationResult =
  | { readonly ok: true; readonly report: ReconciliationReport }
  | { readonly ok: false; readonly reasonCode: ReconciliationRefusalCode; readonly detail: string };

// ---------------------------------------------------------------------------
// reconcileProjectionSet.
// ---------------------------------------------------------------------------

export function reconcileProjectionSet(
  store: ProjectionStore,
  snapshots: readonly ExternalProjectionSnapshot[],
  source: string,
  now: number,
): ReconciliationResult {
  const storeTenant = validateTenantScope(store.tenant);
  if (!storeTenant.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING", detail: "store tenant invalid" };
  if (source !== store.source) {
    return { ok: false, reasonCode: "SOURCE_MISMATCH", detail: `snapshot source "${source}" ≠ store source "${store.source}"` };
  }
  if (!Number.isInteger(now) || now < 0) {
    return { ok: false, reasonCode: "LOGICAL_TIME_INVALID", detail: "now is not a non-negative integer" };
  }
  for (let i = 0; i < snapshots.length; i++) {
    const snap = snapshots[i];
    if (
      snap === null ||
      typeof snap !== "object" ||
      typeof snap.externalId !== "string" ||
      snap.externalId.trim().length === 0 ||
      snap.payload === null ||
      typeof snap.payload !== "object"
    ) {
      return { ok: false, reasonCode: "SNAPSHOT_MALFORMED", detail: `snapshot at index ${String(i)} is malformed` };
    }
    if (!Number.isInteger(snap.logicalTime) || snap.logicalTime < 0) {
      return {
        ok: false,
        reasonCode: "SNAPSHOT_MALFORMED",
        detail: `snapshot "${snap.externalId}" has invalid logicalTime ${String(snap.logicalTime)}`,
      };
    }
  }

  // Deterministic set-diff. Duplicate snapshot ids count as malformed input.
  const externalIds = new Set<string>();
  for (const snap of snapshots) {
    const id = snap.externalId;
    if (externalIds.has(id)) {
      return { ok: false, reasonCode: "SNAPSHOT_MALFORMED", detail: `duplicate snapshot externalId "${id}"` };
    }
    externalIds.add(id);
  }

  const live = listLiveProjections(store);
  const localIds = new Set(live.map((p) => p.externalId));

  const matchedIds: string[] = [];
  const externalOnly: string[] = [];
  const divergent: DivergentPair[] = [];
  const repairPlan: RepairProposal[] = [];

  const byId = new Map(live.map((p) => [p.externalId, p] as const));
  for (const snap of snapshots) {
    if (!localIds.has(snap.externalId)) {
      externalOnly.push(snap.externalId);
      repairPlan.push({
        kind: "repair-proposal",
        action: "fetch-external",
        externalId: snap.externalId,
        reasonCode: "EXTERNAL_AHEAD",
        note: "adapter-never-executes",
      });
      continue;
    }
    const local = byId.get(snap.externalId);
    const externalDigest = computeProjectionDigest(source, snap.externalId, snap.logicalTime, "upsert", snap.payload);
    if (local !== undefined && externalDigest === local.projectionDigest) {
      matchedIds.push(snap.externalId);
    } else if (local !== undefined) {
      divergent.push({ externalId: snap.externalId, externalDigest, localDigest: local.projectionDigest });
      repairPlan.push({
        kind: "repair-proposal",
        action: "manual-review",
        externalId: snap.externalId,
        reasonCode: "DIVERGED",
        note: "adapter-never-executes",
      });
    }
  }

  const localOnly: string[] = [];
  for (const p of live) {
    if (!externalIds.has(p.externalId)) {
      localOnly.push(p.externalId);
      repairPlan.push({
        kind: "repair-proposal",
        action: "purge-local",
        externalId: p.externalId,
        reasonCode: "LOCAL_AHEAD",
        note: "adapter-never-executes",
      });
    }
  }

  const classification = classify(externalOnly.length, localOnly.length, divergent.length);

  const report: ReconciliationReport = {
    tenant: storeTenant.scope,
    source,
    computedAt: now,
    classification,
    matchedIds: sorted(matchedIds),
    externalOnly: sorted(externalOnly),
    localOnly: sorted(localOnly),
    divergent: [...divergent].sort((a, b) => lexical(a.externalId, b.externalId)),
    repairPlan: [...repairPlan].sort((a, b) => lexical(a.externalId, b.externalId)),
    digest: "",
  };
  return { ok: true, report: { ...report, digest: computeReconciliationDigest(report) } };
}

export function computeReconciliationDigest(report: ReconciliationReport): string {
  const joined = [
    report.tenant.tenantId,
    report.source,
    String(report.computedAt),
    report.classification,
    report.matchedIds.join(","),
    report.externalOnly.join(","),
    report.localOnly.join(","),
    report.divergent.map((d) => `${d.externalId}:${d.externalDigest}:${d.localDigest}`).join(","),
  ].join("\u241f");
  return fnv1a32Hex("recon", `${joined}\u241f${canonicalJson(report.repairPlan.map((p) => [p.action, p.externalId, p.reasonCode]))}`);
}

// ---------------------------------------------------------------------------
// Internals.
// ---------------------------------------------------------------------------

function classify(externalOnlyCount: number, localOnlyCount: number, divergentCount: number): ReconciliationClass {
  if (externalOnlyCount === 0 && localOnlyCount === 0 && divergentCount === 0) return "in-sync";
  if (localOnlyCount === 0 && divergentCount === 0) return "external-ahead";
  if (externalOnlyCount === 0 && divergentCount === 0) return "local-ahead";
  return "diverged";
}

function sorted(ids: readonly string[]): string[] {
  return [...ids].sort((a, b) => lexical(a, b));
}

function lexical(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
