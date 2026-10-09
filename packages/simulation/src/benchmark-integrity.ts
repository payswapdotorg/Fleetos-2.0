/**
 * @fleetos/simulation — Benchmark-set integrity verification (F280B, Wave 8).
 *
 * Loud, POSITIONED tamper detection over benchmark definitions: a tampered
 * case or set definition fails with the tamper POSITION named — which case
 * (index + caseId), which level (case manifest / case content / structural
 * law / set manifest / set digest), and which component.
 *
 * The existing `verifyBenchmarkSetDigest` (boolean) is untouched; this module
 * is the positioned, fail-loud sibling.
 *
 * Verification layers (in order — the FIRST failure wins):
 *  1. set manifest shape: `caseDigests` length vs `cases` (addition/removal);
 *  2. per-case manifest: `caseDigests[i]` vs `cases[i].caseDigest` (an edited
 *     manifest digest row);
 *  3. per-case content: `benchmarkCaseDigest(cases[i])` recompute (any edited
 *     case field — invocation, envelope, outcomes, context, journal head);
 *  4. per-case STRUCTURAL re-derivations (fields with internal laws):
 *     tenant (case vs its own journal) and expected-outcome atMs (journal
 *     seq atMs + step x stepMs);
 *  5. set manifest re-derivations: `modelVersions` recomputed from cases;
 *  6. the set digest recompute (covers tenantId + assembledAtMs).
 *
 * Laws: A2/A11 unchanged (benchmarks stay EVALUATION EVIDENCE ONLY);
 * A8 tenant fail-closed — a cross-tenant case inside the set is reported as
 * the structural `tenant` tamper with the offender case named.
 *
 * Determinism: no clock, no randomness, no I/O.
 */

import {
  benchmarkCaseDigest,
} from "./benchmark-definition.ts";
import type { BenchmarkCase, BenchmarkSet } from "./benchmark-definition.ts";

// ---------------------------------------------------------------------------
// Result vocabulary
// ---------------------------------------------------------------------------

/** Where the tamper was detected. */
export type BenchmarkTamperLevel =
  | "set-manifest"
  | "case-manifest"
  | "case-content"
  | "case-structure"
  | "set-digest";

/** The positioned tamper report — the tamper POSITION, named. */
export interface BenchmarkTamper {
  readonly level: BenchmarkTamperLevel;
  /** 0-based index of the offending case (null for set-level tamper). */
  readonly caseIndex: number | null;
  readonly caseId: string | null;
  /** Which component diverged. */
  readonly component: string;
  readonly detail: string;
}

export interface BenchmarkIntegrityResult {
  readonly verified: boolean;
  readonly checkedCases: number;
  readonly tamper: BenchmarkTamper | null;
}

// ---------------------------------------------------------------------------
// Structural re-derivations (fields with internal laws)
// ---------------------------------------------------------------------------

function structuralCaseTamper(
  caseIndex: number,
  c: BenchmarkCase,
  component: string,
  detail: string,
): BenchmarkIntegrityResult {
  return {
    verified: false,
    checkedCases: caseIndex,
    tamper: { level: "case-structure", caseIndex, caseId: c.caseId, component, detail },
  };
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

/**
 * Verify a benchmark set's integrity — fail LOUDLY with the tamper position.
 * `true` only if every layer verifies.
 */
export function verifyBenchmarkSetIntegrity(set: BenchmarkSet): BenchmarkIntegrityResult {
  // Layer 1 — set manifest shape.
  if (set.cases.length !== set.caseDigests.length) {
    return {
      verified: false,
      checkedCases: 0,
      tamper: {
        level: "set-manifest",
        caseIndex: null,
        caseId: null,
        component: "case-digests",
        detail: `manifest carries ${set.caseDigests.length} digests for ${set.cases.length} cases (addition or removal)`,
      },
    };
  }

  for (let i = 0; i < set.cases.length; i += 1) {
    const c = set.cases[i]!;
    const manifestDigest = set.caseDigests[i]!;

    // Layer 2 — per-case manifest row.
    if (c.caseDigest !== manifestDigest) {
      return {
        verified: false,
        checkedCases: i,
        tamper: {
          level: "case-manifest",
          caseIndex: i,
          caseId: c.caseId,
          component: "case-digests",
          detail: `manifest digest row ${i} (${manifestDigest}) != case ${c.caseId} digest (${c.caseDigest})`,
        },
      };
    }

    // Layer 4a — structural tenant law: the case's declared tenant must match
    // its own journal's tenant (A8 — a cross-tenant case is a structural
    // tamper, loudly reported).
    const first = c.journal[0];
    if (first !== undefined && first.tenantId !== c.tenant.tenantId) {
      return structuralCaseTamper(
        i, c, "tenant",
        `case ${c.caseId} declares tenant ${c.tenant.tenantId} but its journal belongs to ${first.tenantId}`,
      );
    }

    // Layer 4b — structural expected-outcome law: every outcome's atMs must
    // equal journal[replaySeq-1].atMs + step * stepMs.
    for (const o of c.expectedOutcomes) {
      const entry = c.journal[o.replaySeq - 1];
      if (entry === undefined) continue; // covered by the content digest
      const expectedAt = entry.atMs + o.step * c.invocation.horizon.stepMs;
      if (o.atMs !== expectedAt) {
        return structuralCaseTamper(
          i, c, "expected-outcomes",
          `outcome seq ${o.replaySeq} step ${o.step} atMs ${o.atMs} != journal ${entry.atMs} + ${o.step}x${c.invocation.horizon.stepMs}`,
        );
      }
    }

    // Layer 3 — case content digest recompute (covers invocation, envelope,
    // outcomes, context fields, journal head — every sealed field).
    if (benchmarkCaseDigest(c) !== c.caseDigest) {
      return {
        verified: false,
        checkedCases: i,
        tamper: {
          level: "case-content",
          caseIndex: i,
          caseId: c.caseId,
          component: "case-digest",
          detail: `case ${c.caseId} content does not rehash to its sealed digest (an edited field)`,
        },
      };
    }
  }

  // Layer 5 — set manifest re-derivation: model versions from the cases.
  const derivedVersions = [...new Set(set.cases.map((c) => c.invocation.modelVersion))].sort();
  const storedVersions = [...set.modelVersions];
  if (JSON.stringify(derivedVersions) !== JSON.stringify(storedVersions)) {
    return {
      verified: false,
      checkedCases: set.cases.length,
      tamper: {
        level: "set-manifest",
        caseIndex: null,
        caseId: null,
        component: "model-versions",
        detail: `manifest model versions [${storedVersions.join(",")}] != cases' [${derivedVersions.join(",")}]`,
      },
    };
  }

  // Layer 6 — the set digest (covers tenantId + assembledAtMs + manifest).
  const recomputedSetDigest = setDigestOf(set);
  if (recomputedSetDigest !== set.setDigest) {
    return {
      verified: false,
      checkedCases: set.cases.length,
      tamper: {
        level: "set-digest",
        caseIndex: null,
        caseId: null,
        component: "set-digest",
        detail: `set digest ${set.setDigest} != recomputed ${recomputedSetDigest} (covers tenantId, case digests, model versions, assembledAtMs)`,
      },
    };
  }

  return { verified: true, checkedCases: set.cases.length, tamper: null };
}

// ---------------------------------------------------------------------------
// Per-case variant (delegates to the set layers over a single-case view)
// ---------------------------------------------------------------------------

/**
 * Verify ONE case's integrity in isolation — positioned exactly like the set
 * verifier (manifest row supplied by the caller).
 */
export function verifyBenchmarkCaseIntegrity(
  c: BenchmarkCase,
  manifestDigest: string,
): BenchmarkIntegrityResult {
  const single: BenchmarkSet = {
    kind: "BENCHMARK_SET",
    tenant: c.tenant,
    cases: [c],
    caseDigests: [manifestDigest],
    modelVersions: [c.invocation.modelVersion],
    assembledAtMs: 0,
    setDigest: "unverified",
  };
  const result = verifyBenchmarkSetIntegrity(single);
  // The set-digest layer is meaningless for the synthetic single-case view —
  // stop at the case layers.
  if (result.tamper?.level === "set-digest") {
    return { verified: true, checkedCases: 1, tamper: null };
  }
  return result;
}

// ---------------------------------------------------------------------------
// Deterministic set digest (mirror of the definition module's private shape)
// ---------------------------------------------------------------------------

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return value === undefined ? "null" : (JSON.stringify(value) ?? "null");
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(",")}]`;
  }
  const rec = value as Record<string, unknown>;
  const keys = Object.keys(rec).filter((k) => rec[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(rec[k])}`).join(",")}}`;
}

function setDigestOf(s: BenchmarkSet): string {
  return fnv1a(
    `bench-set|v1|${canonicalJson({
      tenantId: s.tenant.tenantId,
      caseDigests: s.caseDigests,
      modelVersions: s.modelVersions,
      assembledAtMs: s.assembledAtMs,
    })}`,
  );
}
