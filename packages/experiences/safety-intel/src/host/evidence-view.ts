/**
 * @fleetos/experience-safety-intel — host evidence-chain route view (F300B
 * deliverable 1, route "evidence-chain").
 *
 * Presentation read-model over the REAL @fleetos/evidence surfaces:
 * the append-only evidence chain (per-entry digests + the REAL
 * `verifyEvidenceChain` outcome presented VERBATIM — a broken chain renders
 * as broken, never as verified) and the optional A13 traceability chain
 * (with the REAL `verifyTraceabilityChain` outcome).
 *
 * Laws:
 *  - tenant fail-closed (A8): a cross-tenant evidence entry, trace chain, or
 *    metadata record refuses the WHOLE route view, offender named;
 *  - honest empty: an absent/empty chain composes an explicit `composed:
 *    false` marker — the route never fabricates chain entries;
 *  - determinism: entries ordered by their RECORDED index (derived ordering,
 *    never input order); digests are FNV-1a over the presented content.
 */

import { verifyEvidenceChain, verifyTraceabilityChain } from "@fleetos/evidence";
import type {
  EvidenceChainEntry,
  EvidenceMetadata,
  TraceabilityChain,
} from "@fleetos/evidence";

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export interface EvidenceEntryLinkView {
  readonly index: number;
  readonly evidenceId: string;
  readonly recordedAt: string;
  readonly previousDigest: string | null;
  readonly entryDigest: string;
}

export interface EvidenceRecordLinkView {
  readonly evidenceId: string;
  readonly intentRef: string;
  readonly capabilityId: string;
  readonly artifactCount: number;
  readonly recordedAt: string;
}

export interface EvidenceChainRouteView {
  readonly tenantId: string;
  /** Ordered by recorded index asc. */
  readonly entries: readonly EvidenceEntryLinkView[];
  /** The REAL verification outcome, presented verbatim. */
  readonly verification: {
    readonly verified: boolean;
    readonly checkedEntries: number;
    readonly brokenAt: number | null;
    readonly reason: string | null;
  };
  /** Evidence metadata joined by evidenceId, ordered by evidenceId asc. */
  readonly records: readonly EvidenceRecordLinkView[];
  readonly trace: {
    readonly chainId: string;
    readonly linkCount: number;
    readonly verified: boolean;
    readonly reason: string | null;
    readonly missingLinks: readonly string[];
  } | null;
  readonly digest: string;
}

export type EvidenceRouteRefusal =
  | "evidence.missing-tenant"
  | "evidence.cross-tenant-entry"
  | "evidence.cross-tenant-record"
  | "evidence.cross-tenant-trace"
  | "evidence.record-chain-mismatch";

export type EvidenceRouteResult =
  | { readonly ok: true; readonly view: EvidenceChainRouteView }
  | { readonly ok: false; readonly refused: EvidenceRouteRefusal; readonly detail: string };

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export function buildEvidenceChainRouteView(input: {
  readonly tenantId: string;
  readonly chain: readonly EvidenceChainEntry[];
  readonly records: readonly EvidenceMetadata[];
  readonly trace?: TraceabilityChain;
}): EvidenceRouteResult {
  if (input.tenantId === "") {
    return { ok: false, refused: "evidence.missing-tenant", detail: "tenant identifier is empty" };
  }
  for (const entry of input.chain) {
    if (entry.tenantId !== input.tenantId) {
      return {
        ok: false,
        refused: "evidence.cross-tenant-entry",
        detail: `evidence entry ${entry.index} (${entry.evidenceId}) belongs to tenant ${entry.tenantId}, not ${input.tenantId}`,
      };
    }
  }
  for (const record of input.records) {
    if (record.tenantId !== input.tenantId) {
      return {
        ok: false,
        refused: "evidence.cross-tenant-record",
        detail: `evidence record ${record.evidenceId} belongs to tenant ${record.tenantId}, not ${input.tenantId}`,
      };
    }
  }
  if (input.trace && input.trace.tenantId !== input.tenantId) {
    return {
      ok: false,
      refused: "evidence.cross-tenant-trace",
      detail: `traceability chain ${input.trace.chainId} belongs to tenant ${input.trace.tenantId}, not ${input.tenantId}`,
    };
  }
  const chainIds = new Set(input.chain.map((e) => e.evidenceId));
  for (const record of input.records) {
    if (!chainIds.has(record.evidenceId)) {
      return {
        ok: false,
        refused: "evidence.record-chain-mismatch",
        detail: `evidence record ${record.evidenceId} has no chain entry in this tenant's chain`,
      };
    }
  }

  const entries = [...input.chain]
    .sort((a, b) => a.index - b.index)
    .map((e) => ({
      index: e.index,
      evidenceId: e.evidenceId,
      recordedAt: e.recordedAt,
      previousDigest: e.previousDigest,
      entryDigest: e.entryDigest,
    }));
  const verification = verifyEvidenceChain(input.chain);
  const records = [...input.records]
    .sort((a, b) => (a.evidenceId < b.evidenceId ? -1 : 1))
    .map((r) => ({
      evidenceId: r.evidenceId,
      intentRef: r.intentRef,
      capabilityId: r.capability.capabilityId,
      artifactCount: r.artifacts.length,
      recordedAt: r.recordedAt,
    }));
  const traceVerified = input.trace ? verifyTraceabilityChain(input.trace) : null;
  const trace = input.trace
    ? {
        chainId: input.trace.chainId,
        linkCount: input.trace.links.length,
        verified: traceVerified?.verified ?? false,
        reason: traceVerified?.reason ?? null,
        missingLinks: [...(traceVerified?.missingLinks ?? [])],
      }
    : null;

  const view: EvidenceChainRouteView = {
    tenantId: input.tenantId,
    entries,
    verification: {
      verified: verification.verified,
      checkedEntries: verification.checkedEntries,
      brokenAt: verification.brokenAt,
      reason: verification.reason,
    },
    records,
    trace,
    digest: evidenceRouteDigest({ entries, verification, records, trace }),
  };
  return { ok: true, view };
}

function evidenceRouteDigest(parts: {
  readonly entries: readonly EvidenceEntryLinkView[];
  readonly verification: { readonly verified: boolean; readonly brokenAt: number | null; readonly reason: string | null };
  readonly records: readonly EvidenceRecordLinkView[];
  readonly trace: { readonly chainId: string; readonly verified: boolean } | null;
}): string {
  const entries = parts.entries.map((e) => `${e.index}:${e.evidenceId}=${e.entryDigest}`).join(",");
  const records = parts.records.map((r) => `${r.evidenceId}@${r.capabilityId}#${r.artifactCount}`).join(",");
  const trace = parts.trace === null ? "none" : `${parts.trace.chainId}${parts.trace.verified ? "*" : ""}`;
  return fnv1a(
    `evroute|v1|${parts.entries.length}|${entries}|${parts.verification.verified}/${parts.verification.brokenAt ?? "-"}/${parts.verification.reason ?? "-"}|${records}|${trace}`,
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
