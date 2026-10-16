/**
 * @fleetos/acceptance-security — the F331B security time-census (D12:
 * census-before-variants). Machine-measured, machine-verified.
 *
 * Method (F330 §1.1, the binding Wave-13 law): run the corpus through the
 * `startedAt` seam at the ADOPTION anchors `T0 = ADOPTION_T0 =
 * 1_774_000_000_000` for Δ ∈ {−1h, +1s, +1h, +1d, +30d, +90d, +365d}; a
 * journey RESPONDS at Δ when its corpus-mode pass/fail flips vs the T0
 * baseline. Class each responder: transition (D2(b) family), echo
 * (absolute-timestamp equality pin — count-only variation, never earns
 * epoch counts), or past-only (not parameterizable).
 *
 * Machine facts this module pins (all asserted in tests/census.test.ts):
 *
 *   - The T0 baseline: 19/27 pass; 8 fail (their absolute-timestamp
 *     equality pins — the D13 echo family — fail uniformly because the
 *     security corpus's fixture clock (BASE_MS, 2026-10-12) is displaced
 *     ~206d from the adoption clock (ADOPTION_T0, 2026-04). The census
 *     measures the corpus AT THE ADOPTION ANCHORS — the D9-schedule
 *     regime in which firm epochs would execute — not at the fixture
 *     default anchor).
 *   - 19 journeys are byte-identical (same digest) at ALL 8 census
 *     anchors — anchor-insensitive at the reading level, not merely
 *     non-flipping.
 *   - 6 journeys fail identically at T0 and every Δ (no flip —
 *     non-responders per the census definition; their digests move with
 *     the anchor, machine-evidenced: the readings move, the pins fail
 *     uniformly in the displaced regime).
 *   - exactly 2 responders, both TRANSITION-class (D2(b) family), both
 *     at Δ=+365d ONLY:
 *       · security.predictive-advice — staleness-class transition
 *         (classifyStaleness(originMs = fixture BASE_MS+3s, nowMs =
 *         anchor): "fresh" in the inverted regime, "unknown" once the
 *         anchor passes the staleness window; crossing at anchor >
 *         BASE_MS+63_000, Δ ≈ +206.4d);
 *       · security.benchmark-trust — realized-outcome window boundary
 *         (scoreBenchmarkSet refuses `now-before-realized` while the
 *         anchor precedes the fixture journals' realized outcomes at
 *         BASE_MS+5s; inclusive boundary, crossing at Δ = +17_830_405_000
 *         ≈ +206.4d).
 *   - Both crossings lie BETWEEN +90d and +365d — OUTSIDE the frozen D9
 *     schedule [T0, T0+30d, T0+90d] (F330 D9, TL-owned spacing). Within
 *     the frozen schedule both responders' outcomes are identical to the
 *     T0 baseline (fail), so D10's proof form is impossible: per-epoch
 *     tables cannot make the epochs PASS and no distinct asserted
 *     reading exists on the schedule. They are SCHEDULE-EXCLUDED
 *     responders — recorded honestly, no slot filled (the F330
 *     `evidence-gated-recovery` precedent for out-of-schedule response).
 *   - The D12 gate therefore yields an EMPTY parameterization set
 *     (`PARAMETERIZED_SECURITY_JOURNEYS`): zero security journeys carry
 *     per-epoch expectation tables this wave; all 29 stay single-counted
 *     (the two F341B additions are census-invariant: the artifact-store
 *     family is content-addressed with no time surface; the windowing
 *     family's asserted values are all relative to the run anchor; the
 *     two F361B additions are likewise census-invariant — fixed logical
 *     ISO fixtures and content-addressed digests, never the run anchor).
 *     The corpus now carries 39 journeys; the 8-journey echo-failure
 *     baseline is unchanged.
 *
 * Determinism: the census is a pure function of the corpus + the frozen
 * grid — no clock, no randomness, no network.
 */

import { runJourney } from "./runner.ts";
import type { AcceptanceJourney } from "./journey-contracts.ts";
import { SECURITY_JOURNEYS } from "./journeys/index.ts";

// ---------------------------------------------------------------------------
// The frozen grid (F330 D9/D12 — TL-owned values; no lane may choose spacing)
// ---------------------------------------------------------------------------

/** The census base anchor — ADOPTION_T0 (F330 §1.1; firms.ts:44). */
export const CENSUS_T0 = 1_774_000_000_000;
/** D9 frozen spacings (TL-owned). */
export const EPOCH_30D_MS = 2_592_000_000;
export const EPOCH_90D_MS = 7_776_000_000;

/** The census Δ grid: −1h, +1s, +1h, +1d, +30d, +90d, +365d (ms). */
export const CENSUS_DELTAS_MS: readonly number[] = [
  -3_600_000,
  1_000,
  3_600_000,
  86_400_000,
  EPOCH_30D_MS,
  EPOCH_90D_MS,
  31_536_000_000,
];

/** The frozen D9 schedule (large firms — the maximal parameterization grid). */
export const FROZEN_EPOCH_SCHEDULE: readonly number[] = [
  CENSUS_T0,
  CENSUS_T0 + EPOCH_30D_MS,
  CENSUS_T0 + EPOCH_90D_MS,
];

// ---------------------------------------------------------------------------
// The machine measurement
// ---------------------------------------------------------------------------

export interface CensusDeltaResult {
  readonly deltaMs: number;
  readonly pass: boolean;
  readonly digest: string;
  /** Assertion ids failing at this Δ that passed at T0 (flip evidence). */
  readonly newlyFailing: readonly string[];
  /** Assertion ids passing at this Δ that failed at T0 (flip evidence). */
  readonly newlyPassing: readonly string[];
}

export interface CensusMeasurement {
  readonly journeyId: string;
  readonly baselinePass: boolean;
  readonly baselineDigest: string;
  readonly perDelta: readonly CensusDeltaResult[];
  /** The Δs where pass/fail flips vs the T0 baseline (sorted by grid order). */
  readonly respondingDeltas: readonly number[];
  readonly responder: boolean;
  /** True when the digest is identical at T0 and every Δ (anchor-insensitive). */
  readonly byteIdenticalAcrossGrid: boolean;
}

/** Run the full census: every journey × every grid anchor, machine-measured. */
export function runSecurityCensus(journeys: readonly AcceptanceJourney[] = SECURITY_JOURNEYS): readonly CensusMeasurement[] {
  return journeys.map((journey) => {
    const baseline = runJourney(journey, { startedAt: CENSUS_T0 }).outcome;
    const baselineFailing = new Set(baseline.assertions.filter((a) => !a.pass).map((a) => a.assertionId));
    const perDelta: CensusDeltaResult[] = CENSUS_DELTAS_MS.map((deltaMs) => {
      const outcome = runJourney(journey, { startedAt: CENSUS_T0 + deltaMs }).outcome;
      const newlyFailing: string[] = [];
      const newlyPassing: string[] = [];
      for (const a of outcome.assertions) {
        const wasFailing = baselineFailing.has(a.assertionId);
        if (!a.pass && !wasFailing) newlyFailing.push(a.assertionId);
        if (a.pass && wasFailing) newlyPassing.push(a.assertionId);
      }
      return { deltaMs, pass: outcome.pass, digest: outcome.digest, newlyFailing, newlyPassing };
    });
    const respondingDeltas = perDelta.filter((d) => d.pass !== baseline.pass).map((d) => d.deltaMs);
    const digests = [baseline.digest, ...perDelta.map((d) => d.digest)];
    return {
      journeyId: journey.journeyId,
      baselinePass: baseline.pass,
      baselineDigest: baseline.digest,
      perDelta,
      respondingDeltas,
      responder: respondingDeltas.length > 0,
      byteIdenticalAcrossGrid: digests.every((d) => d === digests[0]),
    };
  });
}

// ---------------------------------------------------------------------------
// The declared census table (worker-B adjudication over the machine flips)
// ---------------------------------------------------------------------------

export type SecurityCensusClass = "transition" | "echo" | "past-only";

export interface SecurityCensusEntry {
  readonly journeyId: string;
  /** True iff the machine measured ≥1 pass/fail flip vs the T0 baseline. */
  readonly responder: boolean;
  /** The responder class (null for non-responders — nothing to class). */
  readonly censusClass: SecurityCensusClass | null;
  /** The verbatim census row (the D10(3)-style citation). */
  readonly citation: string;
}

const INVARIANT_CITATION =
  "F331B census: invariant — byte-identical (same digest) at T0 and every census Δ; anchor-insensitive at the reading level; single-counted, NO epochs (D2(d))";

const ECHO_UNIFORM_CITATION =
  "F331B census: non-responder — absolute-timestamp equality pins (D13 echo family) fail IDENTICALLY at T0 and every Δ in the adoption-anchored regime (the security fixture clock BASE_MS 2026-10-12 is displaced ~206d from ADOPTION_T0 2026-04); digest moves with the anchor (machine-evidenced) but pass/fail never flips; single-counted";

/**
 * The declared 42-row census table (the 27 F331B-era rows + the two F341B
 * remainder additions + the two F361B marketplace-trust additions + the
 * five F370A authenticated-marketplace additions + the three F370B
 * secret-management additions + the three F373 real-KMS additions). The
 * two responders are transition-class (D2(b) family) but their crossings
 * sit at Δ ≈ +206.4d — beyond the frozen D9 schedule [T0, T0+30d,
 * T0+90d] — so they are SCHEDULE-EXCLUDED: no per-epoch tables, no
 * epochs, single-counted (the F330 evidence-gated-recovery precedent:
 * out-of-schedule response is recorded, never filled).
 */
export const SECURITY_CENSUS: readonly SecurityCensusEntry[] = [
  { journeyId: "security.predictive-advice", responder: true, censusClass: "transition", citation: "F331B census: transition (forward, +365d only) | staleness-class transition — classifyStaleness(originMs = fixture BASE_MS+3s, nowMs = anchor) returns fresh in the inverted regime and unknown once the anchor passes the staleness window; crossing at anchor > BASE_MS+63_000 (Δ = +17_830_463_001 ≈ +206.4d) — OUTSIDE the frozen D9 schedule; schedule-excluded, NO epochs declared, single-counted" },
  { journeyId: "security.benchmark-trust", responder: true, censusClass: "transition", citation: "F331B census: transition (forward, +365d only) | realized-outcome window boundary — scoreBenchmarkSet refuses now-before-realized while the anchor precedes the fixture journals' realized outcomes (BASE_MS+5s), inclusive boundary at anchor ≥ BASE_MS+5_000 (Δ = +17_830_405_000 ≈ +206.4d) — OUTSIDE the frozen D9 schedule; schedule-excluded, NO epochs declared, single-counted" },
  ...[
    "security.guardian-decision",
    "security.execution-ledger",
    "security.guardian-e2e",
    "security.verified-execution-dispatch",
    "security.action-compensation-rollback",
    "security.jepa-family-honesty",
  ].map((journeyId) => ({ journeyId, responder: false, censusClass: null, citation: ECHO_UNIFORM_CITATION })),
  ...[
    "security.investigate-finding",
    "security.understand-evidence",
    "security.action-plan",
    "security.reasoning-context",
    "security.counterfactual-reasoning",
    "security.inspect-why",
    "security.learn-from-outcomes",
    "security.agent-safety",
    "security.tenant-fail-closed",
    "security.mission-replay",
    "security.predictive-honesty",
    "security.host-surface",
    "security.tamper-evident-audit-ledger",
    "security.finding-storm-triage",
    "security.finding-suppression-lifecycle",
    "security.capability-store-dr",
    "security.outcome-evaluation-adoption",
    "security.degradation-staleness-honesty",
    "security.posture-fold-determinism",
  ].map((journeyId) => ({ journeyId, responder: false, censusClass: null, citation: INVARIANT_CITATION })),
  // ---- F341B additions (Wave 14 lane B — the F340 census remainders) ----
  {
    journeyId: "security.evidence-artifact-store-completeness",
    responder: false,
    censusClass: null,
    citation:
      "F341B census: invariant — the artifact-store family is content-addressed (no time surface at all); the Promise-signature family is driven to completion at module evaluation via top-level await over deterministic in-memory ports (the F321B async-dispatch law extended, documented in the journey module); single-counted, NO epochs (D2(d))",
  },
  {
    journeyId: "security.world-context-windowing",
    responder: false,
    censusClass: null,
    citation:
      "F341B census: invariant — the windowing family consumes the startedAt seam for its ISO clocks (the reasoning.ts pattern) while every asserted value is relative (counts/refs/classes/booleans), so the outcome is byte-identical at any anchor by construction; single-counted, NO epochs (D2(d))",
  },
  // ---- F361B additions (Wave 17 lane B — the F360 freeze §3.6 marketplace trust controls) ----
  {
    journeyId: "security.marketplace-order-approval-discipline",
    responder: false,
    censusClass: null,
    citation:
      "F361B census: invariant — the approval-discipline family is pure fixture data over the sync policy/actions APIs with fixed logical ISO timestamps and never reads the run anchor, so the outcome is byte-identical at any anchor by construction; single-counted, NO epochs (D2(d))",
  },
  {
    journeyId: "security.marketplace-evidence-dedup-discipline",
    responder: false,
    censusClass: null,
    citation:
      "F361B census: invariant — the evidence-dedup family is content-addressed with caller-supplied logical timestamps only (the F341B artifact-store precedent: the Promise-signature store is driven to completion at module evaluation via top-level await over the deterministic in-memory port, documented in the journey module) and never reads the run anchor; byte-identical at any anchor by construction; single-counted, NO epochs (D2(d))",
  },
  // ---- F370A additions (Wave 18 lane A — real authentication + server-side tenant authorization) ----
  {
    journeyId: "security.authenticated-marketplace-credentials",
    responder: false,
    censusClass: null,
    citation:
      "F370A census: invariant — the credentials family is pure fixture data over the sync identity scrypt APIs with the frozen deterministic parameter set and fixed logical inputs; the journey never reads the run anchor, so the outcome is byte-identical at any anchor by construction; single-counted, NO epochs (D2(d))",
  },
  {
    journeyId: "security.authenticated-marketplace-sessions",
    responder: false,
    censusClass: null,
    citation:
      "F370A census: invariant — the signed-session family mints HMAC-SHA256 tokens over fixed logical epochs with fixed keys; token bytes and verdicts are pure functions of the fixtures and never read the run anchor, so the outcome is byte-identical at any anchor by construction; single-counted, NO epochs (D2(d))",
  },
  {
    journeyId: "security.authenticated-marketplace-request-order",
    responder: false,
    censusClass: null,
    citation:
      "F370A census: invariant — the authenticated request/offer/order family drives the composed Wave-17 kernels behind the gate with fixed logical timestamps (caller-supplied epoch inputs, never the run anchor); every verdict is a pure function of the fixtures, so the outcome is byte-identical at any anchor by construction; single-counted, NO epochs (D2(d))",
  },
  {
    journeyId: "security.authenticated-marketplace-receipt-enrollment",
    responder: false,
    censusClass: null,
    citation:
      "F370A census: invariant — the authenticated receipt/enrollment family drives the REAL F361A directory over one in-memory registry with fixed logical timestamps and never reads the run anchor, so the outcome is byte-identical at any anchor by construction; single-counted, NO epochs (D2(d))",
  },
  {
    journeyId: "security.authenticated-marketplace-approval",
    responder: false,
    censusClass: null,
    citation:
      "F370A census: invariant — the authenticated Guardian-approval family evaluates the EXISTING approval contract over fixed logical fixtures with fixed keys and never reads the run anchor, so the outcome is byte-identical at any anchor by construction; single-counted, NO epochs (D2(d))",
  },
  // ---- F370B additions (Wave 18 lane B — secret management) ----
  {
    journeyId: "security.keyring-rotation",
    responder: false,
    censusClass: null,
    citation:
      "F370B census: invariant — the keyring-rotation family drives the rotating keyring over fixed logical epochs with a fixed injected SecureRandom stream (id first, then material — the frozen draw order), so tokens, verdicts and the rotated snapshot are pure functions of the fixtures and never read the run anchor; byte-identical at any anchor by construction; single-counted, NO epochs (D2(d))",
  },
  {
    journeyId: "security.session-revocation",
    responder: false,
    censusClass: null,
    citation:
      "F370B census: invariant — the session-revocation family mints jti-carrying tokens over fixed logical epochs and one in-memory registry driven in a fixed order, so every verdict (REVOKED and its causes, the precedence seams) is a pure function of the fixtures and never reads the run anchor; byte-identical at any anchor by construction; single-counted, NO epochs (D2(d))",
  },
  {
    journeyId: "security.secure-random-no-leak",
    responder: false,
    censusClass: null,
    citation:
      "F370B census: invariant — the randomness/no-leak family draws salts and key material from fixed injected streams and asserts equality/length/no-leak booleans only, so the outcome is a pure function of the fixtures and never reads the run anchor; byte-identical at any anchor by construction; single-counted, NO epochs (D2(d))",
  },
  // ---- F373 additions (Wave 19 lane B — the real KMS for the keyring) ----
  {
    journeyId: "security.kms-rotation",
    responder: false,
    censusClass: null,
    citation:
      "F373 census: invariant — the kms-rotation family drives the REAL fleetos-kms service (a REAL child process) over fixed logical epochs with a fixed injected SecureRandom stream at the service boundary, so every key id, verdict and audit line is a pure function of the fixtures and never reads the run anchor; byte-identical at any anchor by construction; single-counted, NO epochs (D2(d))",
  },
  {
    journeyId: "security.kms-boundary",
    responder: false,
    censusClass: null,
    citation:
      "F373 census: invariant — the kms-boundary family drives the REAL service's authentication plane and the at-rest scan over fixed logical epochs; every refusal is a frozen code and every scan a fixed-constant boolean, so the outcome never reads the run anchor; byte-identical at any anchor by construction; single-counted, NO epochs (D2(d))",
  },
  {
    journeyId: "security.kms-crash-restart",
    responder: false,
    censusClass: null,
    citation:
      "F373 census: invariant — the kms-crash-restart family SIGKILLs the REAL service mid-rotation-sequence and restarts it on the same data dir; the digests and verdicts are computed over logical metadata only (ids + deadlines, never material) under fixed logical epochs, so the outcome never reads the run anchor; byte-identical at any anchor by construction; single-counted, NO epochs (D2(d))",
  },
];

export function censusEntryOf(journeyId: string): SecurityCensusEntry | undefined {
  return SECURITY_CENSUS.find((e) => e.journeyId === journeyId);
}

// ---------------------------------------------------------------------------
// The D12 gate — the (empty) parameterization set
// ---------------------------------------------------------------------------

/**
 * The journeys parameterized this wave per D10 (per-epoch expectation
 * tables + runner distinctness proof + census citation). The census
 * machine-measured ZERO transition-class responders whose flips fall
 * within the frozen D9 schedule — the two census-certified transition
 * responders cross at Δ ≈ +206.4d, beyond [T0, T0+30d, T0+90d] — so the
 * honest set is EMPTY. Every security journey stays single-counted.
 * tests/census.test.ts machine-enforces this against the measurement.
 */
export const PARAMETERIZED_SECURITY_JOURNEYS: readonly string[] = [];
