/**
 * @fleetos/security — Posture as an event-sourced fold (F220B, Wave 2).
 *
 * Posture is DERIVED from the findings event stream — never stored as mutable
 * truth. The fold is a pure deterministic reduction with an explicit
 * checkpoint: callers resume from a checkpointed state by replaying only
 * events with `seq > checkpoint.lastAppliedSeq`.
 *
 * Laws:
 *  - A8 tenant fail-closed: an event stream for tenant A folded under tenant
 *    B's scope REFUSES (`fold.tenant-mismatch`); a missing tenant refuses
 *    (`fold.missing-tenant`); reading posture cross-tenant refuses
 *    (`posture.tenant-mismatch` / `posture.missing-tenant`).
 *  - Determinism: the same event stream always folds to the byte-identical
 *    state — machine-tested by `verifyPostureFoldDeterminism`.
 *  - No wall-clock: `at` is an explicit number carried per event.
 */

import type { SecuritySeverity } from "./index.ts";

// ---------------------------------------------------------------------------
// Event stream vocabulary
// ---------------------------------------------------------------------------

export type PostureEventKind =
  | "finding.opened"
  | "finding.escalated"
  | "finding.suppressed"
  | "finding.suppression_expired"
  | "finding.resolved";

export interface PostureEvent {
  /** Monotonic stream position — strictly increasing within the stream. */
  readonly seq: number;
  readonly tenantId: string;
  readonly kind: PostureEventKind;
  readonly findingId: string;
  /** Effective severity AFTER this event applies (opened/escalated). */
  readonly severity: SecuritySeverity;
  readonly at: number;
}

// ---------------------------------------------------------------------------
// Fold state
// ---------------------------------------------------------------------------

export type FoldedFindingStatus = "open" | "suppressed" | "resolved";

export interface FoldedFinding {
  readonly findingId: string;
  readonly status: FoldedFindingStatus;
  readonly severity: SecuritySeverity;
}

export interface PostureFoldState {
  readonly tenantId: string;
  /** Folded findings, sorted by findingId — deterministic iteration. */
  readonly findings: readonly FoldedFinding[];
  readonly escalations: number;
  /** Highest applied seq (0 = nothing applied). */
  readonly appliedSeq: number;
  readonly appliedEvents: number;
}

export interface PostureFoldCheckpoint {
  readonly tenantId: string;
  readonly lastAppliedSeq: number;
  readonly appliedEvents: number;
  /** Deterministic digest over the canonical fold state. */
  readonly checkpointDigest: string;
}

export type PostureFoldRefusalCode =
  | "fold.missing-tenant"
  | "fold.tenant-mismatch"
  | "fold.missing-finding-id";

export type PostureFoldResult =
  | { readonly ok: true; readonly state: PostureFoldState; readonly checkpoint: PostureFoldCheckpoint }
  | { readonly ok: false; readonly reason: PostureFoldRefusalCode; readonly atSeq: number };

/** Empty fold state — the identity element of the reduction. */
export function emptyPostureFold(): PostureFoldState {
  return { tenantId: "", findings: [], escalations: 0, appliedSeq: 0, appliedEvents: 0 };
}

// ---------------------------------------------------------------------------
// Deterministic digests
// ---------------------------------------------------------------------------

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Canonical serialization of a fold state — sorted, stable, no key order dependence. */
export function canonicalPostureFoldState(state: PostureFoldState): string {
  const findings = [...state.findings]
    .sort((a, b) => (a.findingId < b.findingId ? -1 : a.findingId > b.findingId ? 1 : 0))
    .map((f) => `${f.findingId}:${f.status}:${f.severity}`)
    .join(",");
  return `tenant=${state.tenantId}|seq=${state.appliedSeq}|events=${state.appliedEvents}|escalations=${state.escalations}|findings=[${findings}]`;
}

/** Content-addressed checkpoint digest over the canonical fold state. */
export function postureFoldCheckpointDigest(state: PostureFoldState): string {
  return fnv1a(canonicalPostureFoldState(state));
}

// ---------------------------------------------------------------------------
// The fold
// ---------------------------------------------------------------------------

/**
 * Fold the posture event stream. Pure and deterministic.
 *
 * Options:
 *  - `resumeFrom` — checkpointed prior state; only events with
 *    `seq > resumeFrom.appliedSeq` are applied (the checkpoint contract).
 *  - `requireTenant` — fold scope; an event carrying a different tenant
 *    REFUSES the fold at that seq (fail-closed, law A8).
 *
 * Event semantics (idempotent where the stream replays):
 *  - `finding.opened`        -> open at the event severity (re-open allowed).
 *  - `finding.escalated`     -> open finding moves to the event severity.
 *  - `finding.suppressed`    -> open finding becomes suppressed (not resolved).
 *  - `finding.suppression_expired` -> suppressed finding becomes open again.
 *  - `finding.resolved`      -> open/suppressed finding becomes resolved.
 *
 * Ordering: the fold processes events by ascending `seq` — the array is
 * sorted (stable) first, so `seq` is the authority, never array position.
 * Events sharing a seq collapse to the first (idempotent replay of the same
 * position); events at or below the resume checkpoint are skipped.
 */
export function foldPostureEvents(
  events: readonly PostureEvent[],
  options: {
    readonly resumeFrom?: PostureFoldState;
    readonly requireTenant?: string;
  } = {},
): PostureFoldResult {
  const resume = options.resumeFrom ?? emptyPostureFold();
  if (options.requireTenant !== undefined && options.requireTenant === "") {
    return { ok: false, reason: "fold.missing-tenant", atSeq: resume.appliedSeq };
  }

  // Mutable working copies of the immutable resume state.
  let tenantId = resume.tenantId;
  const findings = new Map<string, FoldedFinding>();
  for (const f of resume.findings) findings.set(f.findingId, f);
  let escalations = resume.escalations;
  let appliedSeq = resume.appliedSeq;
  let appliedEvents = resume.appliedEvents;

  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  for (const event of ordered) {
    // Checkpoint contract: skip already-applied positions (also collapses
    // duplicate seqs to the first occurrence).
    if (event.seq <= appliedSeq) continue;

    if (event.tenantId === "") {
      return { ok: false, reason: "fold.missing-tenant", atSeq: event.seq };
    }
    if (tenantId !== "" && event.tenantId !== tenantId) {
      return { ok: false, reason: "fold.tenant-mismatch", atSeq: event.seq };
    }
    if (options.requireTenant !== undefined && event.tenantId !== options.requireTenant) {
      return { ok: false, reason: "fold.tenant-mismatch", atSeq: event.seq };
    }
    if (event.findingId === "") {
      return { ok: false, reason: "fold.missing-finding-id", atSeq: event.seq };
    }

    switch (event.kind) {
      case "finding.opened":
        findings.set(event.findingId, { findingId: event.findingId, status: "open", severity: event.severity });
        break;
      case "finding.escalated": {
        const existing = findings.get(event.findingId);
        if (existing && existing.status === "open") {
          findings.set(event.findingId, { ...existing, severity: event.severity });
          escalations += 1;
        }
        break;
      }
      case "finding.suppressed": {
        const existing = findings.get(event.findingId);
        if (existing && existing.status === "open") {
          findings.set(event.findingId, { ...existing, status: "suppressed" });
        }
        break;
      }
      case "finding.suppression_expired": {
        const existing = findings.get(event.findingId);
        if (existing && existing.status === "suppressed") {
          findings.set(event.findingId, { ...existing, status: "open" });
        }
        break;
      }
      case "finding.resolved": {
        const existing = findings.get(event.findingId);
        if (existing && existing.status !== "resolved") {
          findings.set(event.findingId, { ...existing, status: "resolved" });
        }
        break;
      }
    }

    appliedSeq = event.seq;
    appliedEvents += 1;
    if (tenantId === "") {
      // First applied event pins the stream's tenant; every later event is
      // checked against it by the guard above.
      tenantId = event.tenantId;
    }
  }

  const state: PostureFoldState = {
    tenantId,
    findings: [...findings.values()].sort((a, b) => (a.findingId < b.findingId ? -1 : 1)),
    escalations,
    appliedSeq,
    appliedEvents,
  };
  return {
    ok: true,
    state,
    checkpoint: {
      tenantId: state.tenantId,
      lastAppliedSeq: state.appliedSeq,
      appliedEvents: state.appliedEvents,
      checkpointDigest: postureFoldCheckpointDigest(state),
    },
  };
}

// ---------------------------------------------------------------------------
// Determinism + resume verification (machine-testable contracts)
// ---------------------------------------------------------------------------

/** Fold the same stream twice — the states MUST be canonically identical. */
export function verifyPostureFoldDeterminism(events: readonly PostureEvent[]): {
  readonly deterministic: boolean;
  readonly digest1: string;
  readonly digest2: string;
} {
  const fold1 = foldPostureEvents(events);
  const fold2 = foldPostureEvents(events);
  if (!fold1.ok || !fold2.ok) {
    const r1 = fold1.ok ? "" : fold1.reason;
    const r2 = fold2.ok ? "" : fold2.reason;
    return { deterministic: r1 === r2, digest1: r1, digest2: r2 };
  }
  return {
    deterministic: canonicalPostureFoldState(fold1.state) === canonicalPostureFoldState(fold2.state),
    digest1: postureFoldCheckpointDigest(fold1.state),
    digest2: postureFoldCheckpointDigest(fold2.state),
  };
}

/**
 * Verify the checkpoint/resume contract: a full fold MUST equal
 * (fold prefix) + (resume fold of the remainder). Any divergence is a bug in
 * the fold — this is the machine test for it.
 */
export function verifyPostureFoldResume(
  events: readonly PostureEvent[],
  splitAtSeq: number,
): { readonly resumesCleanly: boolean; readonly fullDigest: string; readonly resumedDigest: string } {
  const full = foldPostureEvents(events);
  const prefix = events.filter((e) => e.seq <= splitAtSeq);
  const remainder = events.filter((e) => e.seq > splitAtSeq);
  const prefixFold = foldPostureEvents(prefix);
  if (!prefixFold.ok) {
    return { resumesCleanly: false, fullDigest: "", resumedDigest: prefixFold.reason };
  }
  const resumed = foldPostureEvents(remainder, { resumeFrom: prefixFold.state });
  if (!resumed.ok || !full.ok) {
    return {
      resumesCleanly: false,
      fullDigest: full.ok ? postureFoldCheckpointDigest(full.state) : full.reason,
      resumedDigest: resumed.ok ? postureFoldCheckpointDigest(resumed.state) : resumed.reason,
    };
  }
  return {
    resumesCleanly: canonicalPostureFoldState(full.state) === canonicalPostureFoldState(resumed.state),
    fullDigest: postureFoldCheckpointDigest(full.state),
    resumedDigest: postureFoldCheckpointDigest(resumed.state),
  };
}

// ---------------------------------------------------------------------------
// Posture snapshot — tenant fail-closed reads over the fold state
// ---------------------------------------------------------------------------

const SEVERITY_RANK: readonly SecuritySeverity[] = ["info", "low", "medium", "high", "critical"];

/** The derived posture snapshot — a projection of the fold state. */
export interface PostureSnapshot {
  readonly tenantId: string;
  readonly openFindings: number;
  readonly suppressed: number;
  readonly resolved: number;
  readonly bySeverity: Readonly<Record<SecuritySeverity, number>>;
  /** Worst-wins integer score: 100 when no open findings. */
  readonly postureScore: number;
  readonly escalations: number;
  readonly appliedSeq: number;
}

export type PostureReadRefusalCode = "posture.missing-tenant" | "posture.tenant-mismatch";

export type PostureReadResult =
  | { readonly ok: true; readonly snapshot: PostureSnapshot }
  | { readonly ok: false; readonly reason: PostureReadRefusalCode };

/**
 * Read the posture snapshot for a tenant — fail-closed (law A8).
 *
 * Reading tenant A's fold state under tenant B's scope REFUSES with
 * `posture.tenant-mismatch`; an empty tenant scope refuses with
 * `posture.missing-tenant`. Posture is NEVER returned cross-tenant.
 */
export function readPostureForTenant(state: PostureFoldState, tenantId: string): PostureReadResult {
  if (tenantId === "") return { ok: false, reason: "posture.missing-tenant" };
  if (state.tenantId !== tenantId) return { ok: false, reason: "posture.tenant-mismatch" };

  const bySeverity: Record<SecuritySeverity, number> = { info: 0, low: 0, medium: 0, high: 0, critical: 0 };
  let open = 0;
  let suppressed = 0;
  let resolved = 0;
  let worstRank = -1;
  for (const f of state.findings) {
    if (f.status === "open") {
      open += 1;
      bySeverity[f.severity] += 1;
      const r = SEVERITY_RANK.indexOf(f.severity);
      if (r > worstRank) worstRank = r;
    } else if (f.status === "suppressed") {
      suppressed += 1;
    } else {
      resolved += 1;
    }
  }
  const postureScore = worstRank === -1 ? 100 : Math.max(0, 100 - (worstRank + 1) * 20);
  return {
    ok: true,
    snapshot: {
      tenantId,
      openFindings: open,
      suppressed,
      resolved,
      bySeverity,
      postureScore,
      escalations: state.escalations,
      appliedSeq: state.appliedSeq,
    },
  };
}
