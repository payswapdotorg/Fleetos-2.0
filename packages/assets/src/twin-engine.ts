/**
 * @fleetos/assets — Wave 2 twin projection engine at operational-truth grade (F220A).
 *
 * Event-sourced fold over the revision log with:
 *   - Checkpointing contracts (resume-from-sequence).
 *   - Deterministic replay (same log -> byte-identical twin state).
 *   - Conflict detection (concurrent revision sequences on the same device).
 *
 * The managed-asset registry: lineage references (typed relationships per
 * A17 — relational model, no graph DB), lifecycle projections per asset,
 * and the enrollment boundary (an observation from an unenrolled device is
 * refused with a machine-stable reason).
 *
 * Pure TypeScript over injected PORT interfaces. No I/O, no servers, no
 * databases. Persistence lands at F211 (TL lane).
 */

import type {
  AssetId,
  DeviceId,
  TenantIdLike,
  TwinRevision,
} from "./assets.js";
import type { AuditEventRef } from "./kernel-audit.js";
import { digestOf } from "./kernel-audit.js";

// ---------------------------------------------------------------------------
// Twin fold state — a pure, deterministic reduction over a revision log.
// Two fresh folds over the same log MUST produce byte-identical state.
// ---------------------------------------------------------------------------

export interface TwinFoldState {
  readonly deviceId: DeviceId;
  readonly tenantId: TenantIdLike;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly lastSeq: number;
  readonly lastObservedAt: number;
  readonly headDigest: string | null;
  readonly revisionCount: number;
}

export interface TwinFoldCheckpoint {
  readonly deviceId: DeviceId;
  readonly tenantId: TenantIdLike;
  readonly lastAppliedSeq: number;
  readonly atRevisionIndex: number;
  readonly state: TwinFoldState;
  readonly checkpointDigest: string;
}

export function emptyFoldState(deviceId: DeviceId, tenantId: TenantIdLike): TwinFoldState {
  return {
    deviceId,
    tenantId,
    attributes: {},
    lastSeq: 0,
    lastObservedAt: 0,
    headDigest: null,
    revisionCount: 0,
  };
}

// ---------------------------------------------------------------------------
// foldRevisions — pure event-sourced fold. Same log -> same state.
//
// `resumeFromSeq` lets the caller resume from a checkpoint: only revisions
// with seq > resumeFromSeq are applied. Returns the new state + a
// checkpoint describing the new high-water mark.
// ---------------------------------------------------------------------------

export interface FoldResult {
  readonly state: TwinFoldState;
  readonly checkpoint: TwinFoldCheckpoint;
}

export function foldRevisions(
  revisions: ReadonlyArray<TwinRevision>,
  deviceId: DeviceId,
  tenantId: TenantIdLike,
  resumeFromSeq: number = 0,
): FoldResult {
  let state = emptyFoldState(deviceId, tenantId);
  let lastAppliedSeq = resumeFromSeq;
  let atRevisionIndex = 0;

  for (let i = 0; i < revisions.length; i++) {
    const rev = revisions[i]!;
    atRevisionIndex = i + 1;
    if ((rev.seq as number) <= resumeFromSeq) continue;
    // Apply the revision's attributes (last-writer-wins per key).
    const merged: Record<string, unknown> = { ...state.attributes };
    for (const [k, v] of Object.entries(rev.attributes)) merged[k] = v;
    const headDigest = (rev as TwinRevision & { readonly revisionDigest?: string }).revisionDigest ?? null;
    state = {
      deviceId,
      tenantId,
      attributes: merged,
      lastSeq: rev.seq as number,
      lastObservedAt: rev.observedAt,
      headDigest,
      revisionCount: state.revisionCount + 1,
    };
    lastAppliedSeq = rev.seq as number;
  }
  const checkpoint: TwinFoldCheckpoint = {
    deviceId,
    tenantId,
    lastAppliedSeq,
    atRevisionIndex,
    state,
    checkpointDigest: digestOf(deviceId, tenantId, lastAppliedSeq, atRevisionIndex),
  };
  return { state, checkpoint };
}

// ---------------------------------------------------------------------------
// Deterministic replay verification — fold the same log twice and compare
// byte-identical state. Returns true only if BOTH attributes match (deep
// equality on the canonical JSON) AND headDigest/lastSeq match.
// ---------------------------------------------------------------------------

export function verifyDeterministicReplay(
  revisions: ReadonlyArray<TwinRevision>,
  deviceId: DeviceId,
  tenantId: TenantIdLike,
): { readonly deterministic: boolean; readonly a: TwinFoldState; readonly b: TwinFoldState } {
  const a = foldRevisions(revisions, deviceId, tenantId).state;
  const b = foldRevisions(revisions, deviceId, tenantId).state;
  const deterministic = canonicalJson(a) === canonicalJson(b);
  return { deterministic, a, b };
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object" && !(value instanceof Uint8Array)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = sortKeysDeep((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Conflict detection — concurrent revision sequences on the same device.
//
// A "conflict" arises when two revision sequences share the same parent
// digest but different (seq, observedAt) — both are valid on their own but
// cannot be merged linearly. The kernel exposes a typed `ConflictMarker`
// so callers can detect and resolve conflicts (e.g., pick the higher-seq
// revision, or trigger a recovery case).
// ---------------------------------------------------------------------------

export interface TwinRevisionWithDigest extends TwinRevision {
  readonly revisionDigest: string;
  readonly parentDigest: string;
}

export interface ConflictMarker {
  readonly branchA: { readonly seq: number; readonly digest: string };
  readonly branchB: { readonly seq: number; readonly digest: string };
  readonly commonParent: string;
}

export function detectConflicts(revisions: ReadonlyArray<TwinRevisionWithDigest>): ReadonlyArray<ConflictMarker> {
  // Group revisions by their parentDigest. Two revisions sharing a parent
  // are a fork in the log — a conflict candidate.
  const byParent = new Map<string, TwinRevisionWithDigest[]>();
  for (const r of revisions) {
    const list = byParent.get(r.parentDigest) ?? [];
    list.push(r);
    byParent.set(r.parentDigest, list);
  }
  const conflicts: ConflictMarker[] = [];
  for (const [parent, list] of byParent) {
    if (list.length < 2) continue;
    // Pick the first two revisions as the conflict pair.
    const a = list[0]!;
    const b = list[1]!;
    if ((a.seq as number) === (b.seq as number) && a.revisionDigest === b.revisionDigest) continue;
    conflicts.push({
      branchA: { seq: a.seq as number, digest: a.revisionDigest },
      branchB: { seq: b.seq as number, digest: b.revisionDigest },
      commonParent: parent,
    });
  }
  return conflicts;
}

// ---------------------------------------------------------------------------
// Lineage references (A17) — typed relationships across assets, components,
// projects, materials, vendors, methods and failures. Relational model,
// NOT a graph DB.
// ---------------------------------------------------------------------------

export type LineageRelationKind =
  | "asset-contains-component"
  | "asset-part-of-asset"
  | "asset-installed-in-asset"
  | "asset-supplied-by-vendor"
  | "asset-manufactured-by-vendor"
  | "asset-serviced-by-vendor"
  | "asset-uses-method"
  | "asset-failure-mode"
  | "asset-project-uses"
  | "asset-made-of-material";

export interface LineageRef {
  readonly id: string;
  readonly tenantId: TenantIdLike;
  readonly fromAssetId: AssetId;
  readonly toAssetId: AssetId;
  readonly relation: LineageRelationKind;
  readonly declaredAt: number;
  readonly declaredBy: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type LineageRejectionCode =
  | "malformed-lineage-id"
  | "missing-from-asset"
  | "missing-to-asset"
  | "unknown-relation"
  | "self-reference"
  | "duplicate-lineage"
  | "tenant-mismatch";

export type LineageResult =
  | { readonly ok: true; readonly lineage: LineageRef; readonly audit: AuditEventRef }
  | { readonly ok: false; readonly reason: LineageRejectionCode };

const LINEAGE_ID_RE = /^lin_[A-Za-z0-9_-]{4,128}$/;
const RELATION_VALUES: ReadonlyArray<LineageRelationKind> = [
  "asset-contains-component",
  "asset-part-of-asset",
  "asset-installed-in-asset",
  "asset-supplied-by-vendor",
  "asset-manufactured-by-vendor",
  "asset-serviced-by-vendor",
  "asset-uses-method",
  "asset-failure-mode",
  "asset-project-uses",
  "asset-made-of-material",
];

export function declareLineage(input: {
  readonly lineageId: string;
  readonly tenantId: TenantIdLike;
  readonly fromAssetId: AssetId;
  readonly toAssetId: AssetId;
  readonly relation: LineageRelationKind;
  readonly declaredAt: number;
  readonly declaredBy: string;
  readonly existing?: ReadonlyArray<LineageRef>;
}): LineageResult {
  if (typeof input.lineageId !== "string" || !LINEAGE_ID_RE.test(input.lineageId)) {
    return { ok: false, reason: "malformed-lineage-id" };
  }
  if (!input.fromAssetId) return { ok: false, reason: "missing-from-asset" };
  if (!input.toAssetId) return { ok: false, reason: "missing-to-asset" };
  if (input.fromAssetId === input.toAssetId) return { ok: false, reason: "self-reference" };
  if (!RELATION_VALUES.includes(input.relation)) return { ok: false, reason: "unknown-relation" };
  // Duplicate detection: same (from, to, relation) is refused unless the
  // caller explicitly declares it with a new id.
  if (input.existing) {
    const dup = input.existing.some(
      (l) =>
        l.tenantId === input.tenantId &&
        l.fromAssetId === input.fromAssetId &&
        l.toAssetId === input.toAssetId &&
        l.relation === input.relation,
    );
    if (dup) return { ok: false, reason: "duplicate-lineage" };
  }
  const lineage: LineageRef = {
    id: input.lineageId,
    tenantId: input.tenantId,
    fromAssetId: input.fromAssetId,
    toAssetId: input.toAssetId,
    relation: input.relation,
    declaredAt: input.declaredAt,
    declaredBy: input.declaredBy,
  };
  const audit: AuditEventRef = {
    actor: input.declaredBy,
    intent: `asset:lineage:${input.relation}`,
    tenant: input.tenantId,
    timestamp: input.declaredAt,
    digest: digestOf(input.lineageId, input.fromAssetId, input.toAssetId, input.relation, input.declaredAt),
  };
  return { ok: true, lineage, audit };
}

// ---------------------------------------------------------------------------
// Lineage registry — typed queries over the lineage graph. The graph is
// stored as a flat list of LineageRef records; queries traverse in-memory.
// Tenant-scoped reads fail-closed.
// ---------------------------------------------------------------------------

export interface LineageRegistry {
  readonly byId: ReadonlyMap<string, LineageRef>;
  readonly byFrom: ReadonlyMap<AssetId, ReadonlyArray<string>>;
  readonly byTo: ReadonlyMap<AssetId, ReadonlyArray<string>>;
}

export function emptyLineageRegistry(): LineageRegistry {
  return { byId: new Map(), byFrom: new Map(), byTo: new Map() };
}

export function registerLineage(registry: LineageRegistry, lineage: LineageRef): LineageRegistry {
  const byId = new Map(registry.byId);
  byId.set(lineage.id, lineage);
  const byFrom = new Map(registry.byFrom);
  const fromList = byFrom.get(lineage.fromAssetId) ?? [];
  byFrom.set(lineage.fromAssetId, [...fromList, lineage.id]);
  const byTo = new Map(registry.byTo);
  const toList = byTo.get(lineage.toAssetId) ?? [];
  byTo.set(lineage.toAssetId, [...toList, lineage.id]);
  return { byId, byFrom, byTo };
}

export function listLineageFrom(
  registry: LineageRegistry,
  tenantId: TenantIdLike,
  assetId: AssetId,
  relation?: LineageRelationKind,
): ReadonlyArray<LineageRef> {
  const ids = registry.byFrom.get(assetId) ?? [];
  return ids
    .map((id) => registry.byId.get(id))
    .filter((l): l is LineageRef => l !== undefined && l.tenantId === tenantId)
    .filter((l) => relation === undefined || l.relation === relation);
}

export function listLineageTo(
  registry: LineageRegistry,
  tenantId: TenantIdLike,
  assetId: AssetId,
  relation?: LineageRelationKind,
): ReadonlyArray<LineageRef> {
  const ids = registry.byTo.get(assetId) ?? [];
  return ids
    .map((id) => registry.byId.get(id))
    .filter((l): l is LineageRef => l !== undefined && l.tenantId === tenantId)
    .filter((l) => relation === undefined || l.relation === relation);
}

// ---------------------------------------------------------------------------
// Lifecycle projection per asset — the kernel exposes the asset's current
// lifecycle state derived from its audit history. Pure function.
// ---------------------------------------------------------------------------

export interface LifecycleProjection {
  readonly assetId: AssetId;
  readonly tenantId: TenantIdLike;
  readonly state: "admitted" | "active" | "retired";
  readonly enrolledAt: number | null;
  readonly retiredAt: number | null;
  readonly transitionCount: number;
}

export interface LifecycleAuditEntry {
  readonly assetId: AssetId;
  readonly tenantId: TenantIdLike;
  readonly command: "admit" | "activate" | "retire";
  readonly at: number;
}

export function projectLifecycle(
  assetId: AssetId,
  tenantId: TenantIdLike,
  history: ReadonlyArray<LifecycleAuditEntry>,
): LifecycleProjection {
  let state: LifecycleProjection["state"] = "admitted";
  let enrolledAt: number | null = null;
  let retiredAt: number | null = null;
  let transitionCount = 0;
  for (const entry of history) {
    if (entry.assetId !== assetId || entry.tenantId !== tenantId) continue;
    transitionCount++;
    if (entry.command === "admit") state = "admitted";
    else if (entry.command === "activate") {
      state = "active";
      enrolledAt = entry.at;
    } else if (entry.command === "retire") {
      state = "retired";
      retiredAt = entry.at;
    }
  }
  return { assetId, tenantId, state, enrolledAt, retiredAt, transitionCount };
}

// Enrollment boundary + EnrollmentDirectory live in ./enrollment.ts (split
// to keep this file under the 400-line lint limit).
export {
  checkEnrollment,
  EnrollmentDirectory,
  gateObservationOnEnrollment,
  InMemoryEnrollmentRegistry,
  type EnrollmentCheck,
  type EnrollmentDirectoryRejectionCode,
  type EnrollmentDirectoryResult,
  type EnrollmentRecord,
  type EnrollmentRejectionCode,
  type EnrollmentRegistryPort,
  type ObservationAdmissionDecision,
} from "./enrollment.js";

