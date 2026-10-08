/**
 * @fleetos/integrations/arena — Evaluation case registry (Wave 5, F250B).
 *
 * Typed case intake: validate -> dedupe by deterministic case digest ->
 * correlate by capability version; case-set assembly with deterministic
 * ordering + case-set digest.
 *
 * Laws:
 *   - Pure deterministic TS: no clock, no randomness, no I/O. Logical time
 *     (`submittedAtMs`, integer ms) is caller-supplied everywhere.
 *   - Tenant fail-closed: empty registry tenant or any cross-tenant case
 *     rejects the WHOLE intake (offender named), never silently filtered.
 *   - Every registered case carries provenance (source, capability version,
 *     submitted-at logical time, deterministic case digest).
 *
 * Digests: FNV-1a 32-bit over version-prefixed canonical serializations
 * (the lane convention — deterministic, not cryptographic).
 */

import type { CapabilityVersionRef, EvaluationCase, TenantScopeLike } from "./index.ts";

/** FNV-1a 32-bit — deterministic, NOT cryptographically secure. */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Deterministic canonical JSON: object keys sorted at every depth. */
export function canonicalJson(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NaN";
  if (typeof v === "boolean" || typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (typeof v === "object") {
    const keys = Object.keys(v as Record<string, unknown>).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return "undefined";
}

/** Intake rejection codes — fail-closed, machine-stable. */
export type RegistryRejectionCode =
  | "missing-tenant"
  | "empty-case-id"
  | "empty-source"
  | "invalid-submitted-at"
  | "invalid-tags"
  | "cross-tenant-case"
  | "duplicate-case-id"
  | "empty-case-set"
  | "capability-mismatch";

export interface RegistryRejection {
  readonly ok: false;
  readonly code: RegistryRejectionCode;
  readonly reason: string;
}

/** Case intake candidate — an EvaluationCase + provenance (pre-validation). */
export interface CaseIntakeCandidate<T = unknown> extends EvaluationCase<T> {
  /** Where the case came from (registry provenance — opaque ref). */
  readonly source: string;
  /** Logical submit time in integer ms (caller-supplied, never wall clock). */
  readonly submittedAtMs: number;
}

/** Provenance carried on every registered case. */
export interface CaseProvenance {
  readonly source: string;
  readonly capability: CapabilityVersionRef;
  readonly submittedAtMs: number;
  readonly caseDigest: string;
}

/** A registered case — validated, digest-stamped, deterministically ordered. */
export interface RegistryCase<T = unknown> {
  readonly caseId: string;
  readonly tenantId: string;
  readonly capability: CapabilityVersionRef;
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly expected: T;
  readonly description: string;
  readonly tags: readonly string[];
  readonly provenance: CaseProvenance;
}

export interface IntakeResult<T = unknown> {
  readonly ok: true;
  readonly tenantId: string;
  readonly cases: readonly RegistryCase<T>[];
  /** CaseIds dropped as exact duplicates (same deterministic digest). */
  readonly duplicates: readonly string[];
}

export type IntakeOutcomeResult<T = unknown> = IntakeResult<T> | RegistryRejection;

/**
 * Deterministic case digest over the FULL case content (version-prefixed so
 * future shape changes can bump the prefix without silent collisions).
 * Tags are sorted+deduped first — tag ORDER and duplicates never change the
 * identity of a case.
 */
export function caseDigest<T>(c: CaseIntakeCandidate<T>): string {
  const tags = [...new Set(c.tags)].sort();
  return fnv1a(
    `case|v1|${c.tenant.tenantId}|${c.capability.capabilityId}@${c.capability.version}` +
      `|${c.caseId}|${canonicalJson(c.inputs)}|${canonicalJson(c.expected)}` +
      `|${c.description}|${tags.join(",")}`,
  );
}

/**
 * Typed case intake: validate -> dedupe by deterministic case digest.
 *
 * Rules:
 *   - fail-closed on: empty tenant, empty caseId, empty source,
 *     non-integer/negative submittedAtMs, tags not an array of strings,
 *     a case from ANOTHER tenant (offender named), a DUPLICATE caseId with
 *     DIFFERENT content (identity conflict — never silently overwritten).
 *   - exact duplicates (same digest) are dropped and reported in
 *     `duplicates` — intake is idempotent for replayed batches.
 *   - result ordering is deterministic (caseId asc); input order never leaks.
 */
export function intakeCases<T>(
  candidates: readonly CaseIntakeCandidate<T>[],
  tenant: TenantScopeLike,
): IntakeOutcomeResult<T> {
  const tenantId = tenant.tenantId;
  if (tenantId === "") {
    return { ok: false, code: "missing-tenant", reason: "registry tenant identifier is empty" };
  }
  const seenIds = new Map<string, string>();
  const seenDigests = new Set<string>();
  const duplicates: string[] = [];
  const accepted: RegistryCase<T>[] = [];
  // Deterministic ordering FIRST — "first" in dedupe is order-independent.
  const ordered = [...candidates].sort((a, b) => (a.caseId < b.caseId ? -1 : a.caseId > b.caseId ? 1 : 0));
  for (const c of ordered) {
    if (c.caseId === "") {
      return { ok: false, code: "empty-case-id", reason: "case identifier is empty" };
    }
    if (c.tenant.tenantId !== tenantId) {
      return {
        ok: false,
        code: "cross-tenant-case",
        reason: `case ${c.caseId} belongs to tenant "${c.tenant.tenantId}" (registry tenant "${tenantId}")`,
      };
    }
    if (c.capability.capabilityId === "") {
      return { ok: false, code: "capability-mismatch", reason: `case ${c.caseId} has an empty capabilityId` };
    }
    if (c.source === "") {
      return { ok: false, code: "empty-source", reason: `case ${c.caseId} has an empty provenance source` };
    }
    if (!Number.isInteger(c.submittedAtMs) || c.submittedAtMs < 0) {
      return { ok: false, code: "invalid-submitted-at", reason: `case ${c.caseId} submittedAtMs must be an integer >= 0` };
    }
    if (!Array.isArray(c.tags) || c.tags.some((t) => typeof t !== "string")) {
      return { ok: false, code: "invalid-tags", reason: `case ${c.caseId} tags must be an array of strings` };
    }
    const digest = caseDigest(c);
    const prior = seenIds.get(c.caseId);
    if (prior !== undefined && prior !== digest) {
      return {
        ok: false,
        code: "duplicate-case-id",
        reason: `caseId ${c.caseId} submitted twice with different content`,
      };
    }
    seenIds.set(c.caseId, digest);
    if (seenDigests.has(digest)) {
      duplicates.push(c.caseId);
      continue;
    }
    seenDigests.add(digest);
    accepted.push({
      caseId: c.caseId,
      tenantId,
      capability: c.capability,
      inputs: c.inputs,
      expected: c.expected,
      description: c.description,
      tags: [...new Set(c.tags)].sort(),
      provenance: { source: c.source, capability: c.capability, submittedAtMs: c.submittedAtMs, caseDigest: digest },
    });
  }
  return { ok: true, tenantId, cases: accepted, duplicates };
}

/** A capability-correlated group of registered cases. */
export interface CapabilityCaseGroup<T = unknown> {
  readonly capability: CapabilityVersionRef;
  readonly cases: readonly RegistryCase<T>[];
}

/**
 * Correlate registered cases by capability version. Groups are ordered by
 * (capabilityId asc, version asc); cases keep registry order (caseId asc).
 */
export function correlateByCapability<T>(
  cases: readonly RegistryCase<T>[],
): readonly CapabilityCaseGroup<T>[] {
  const byKey = new Map<string, CapabilityCaseGroup<T>>();
  for (const c of cases) {
    const key = `${c.capability.capabilityId}@${c.capability.version}`;
    const group = byKey.get(key);
    if (group) byKey.set(key, { ...group, cases: [...group.cases, c] });
    else byKey.set(key, { capability: c.capability, cases: [c] });
  }
  return [...byKey.values()].sort((a, b) => {
    const ka = `${a.capability.capabilityId}@${a.capability.version}`;
    const kb = `${b.capability.capabilityId}@${b.capability.version}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

/** An assembled case set — the evaluation unit for a run. */
export interface CaseSet<T = unknown> {
  readonly kind: "ARENA_CASE_SET";
  readonly tenantId: string;
  readonly capability: CapabilityVersionRef;
  readonly cases: readonly RegistryCase<T>[];
  readonly caseCount: number;
  readonly caseSetDigest: string;
  readonly assembledAtMs: number;
  /** Sorted unique provenance sources of the member cases. */
  readonly sources: readonly string[];
}

/** Assemble result — uniform ok-discriminated union (fail-closed). */
export type AssembleCaseSetResult<T = unknown> =
  | { readonly ok: true; readonly caseSet: CaseSet<T> }
  | RegistryRejection;

/**
 * Assemble a case set for one tenant + one capability version, with a
 * deterministic ordering (caseId asc — input order never leaks) and a
 * case-set digest over the ordered case digests.
 *
 * Fail-closed: empty set, cross-tenant case, capability mismatch.
 */
export function assembleCaseSet<T>(
  cases: readonly RegistryCase<T>[],
  input: { readonly tenant: TenantScopeLike; readonly capability: CapabilityVersionRef; readonly assembledAtMs: number },
): AssembleCaseSetResult<T> {
  if (input.tenant.tenantId === "") {
    return { ok: false, code: "missing-tenant", reason: "case-set tenant identifier is empty" };
  }
  if (!Number.isInteger(input.assembledAtMs) || input.assembledAtMs < 0) {
    return { ok: false, code: "invalid-submitted-at", reason: "assembledAtMs must be an integer >= 0" };
  }
  if (cases.length === 0) {
    return { ok: false, code: "empty-case-set", reason: "a case set requires at least one registered case" };
  }
  const ordered = [...cases].sort((a, b) => (a.caseId < b.caseId ? -1 : a.caseId > b.caseId ? 1 : 0));
  for (const c of ordered) {
    if (c.tenantId !== input.tenant.tenantId) {
      return {
        ok: false,
        code: "cross-tenant-case",
        reason: `case ${c.caseId} belongs to tenant "${c.tenantId}" (set tenant "${input.tenant.tenantId}")`,
      };
    }
    if (c.capability.capabilityId !== input.capability.capabilityId || c.capability.version !== input.capability.version) {
      return {
        ok: false,
        code: "capability-mismatch",
        reason: `case ${c.caseId} targets ${c.capability.capabilityId}@${c.capability.version}, set is ${input.capability.capabilityId}@${input.capability.version}`,
      };
    }
  }
  const digests = ordered.map((c) => c.provenance.caseDigest).join(",");
  const caseSetDigest = fnv1a(
    `caseset|v1|${input.tenant.tenantId}|${input.capability.capabilityId}@${input.capability.version}|${input.assembledAtMs}|${digests}`,
  );
  return {
    ok: true,
    caseSet: {
      kind: "ARENA_CASE_SET",
      tenantId: input.tenant.tenantId,
      capability: input.capability,
      cases: ordered,
      caseCount: ordered.length,
      caseSetDigest,
      assembledAtMs: input.assembledAtMs,
      sources: [...new Set(ordered.map((c) => c.provenance.source))].sort(),
    },
  };
}

/** Recompute a registered case's digest from its STORED form (audit). */
export function registryCaseDigest<T>(c: RegistryCase<T>): string {
  return fnv1a(
    `case|v1|${c.tenantId}|${c.capability.capabilityId}@${c.capability.version}` +
      `|${c.caseId}|${canonicalJson(c.inputs)}|${canonicalJson(c.expected)}` +
      `|${c.description}|${c.tags.join(",")}`,
  );
}

/**
 * Recompute a case set's digest for audit — detects tampering. TWO levels:
 *   - each member case's provenance digest must recompute from its stored
 *     content (case-level tamper detection);
 *   - the set digest must recompute over the ordered member digests
 *     (set-level tamper detection: additions, removals, reordering, digest
 *     edits, tenant/capability/assembledAt edits).
 */
export function verifyCaseSetDigest<T>(caseSet: CaseSet<T>): boolean {
  for (const c of caseSet.cases) {
    if (registryCaseDigest(c) !== c.provenance.caseDigest) return false;
  }
  const digests = caseSet.cases.map((c) => c.provenance.caseDigest).join(",");
  return (
    fnv1a(
      `caseset|v1|${caseSet.tenantId}|${caseSet.capability.capabilityId}@${caseSet.capability.version}|${caseSet.assembledAtMs}|${digests}`,
    ) === caseSet.caseSetDigest
  );
}
