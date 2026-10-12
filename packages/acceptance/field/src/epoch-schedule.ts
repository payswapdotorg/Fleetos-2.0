/**
 * @fleetos/acceptance-field — the FROZEN Wave-13 epoch schedule + the
 * field census declarations (F330 D8/D9 — TL-owned values, restated here
 * for machine enforcement; the counting gate itself lands at F332).
 *
 * D9 (frozen): medium firms `[T0, T0+30d]`, large firms
 * `[T0, T0+30d, T0+90d]`, small firms `[T0]`; T0 = ADOPTION_T0 =
 * 1_774_000_000_000; 30d = 2_592_000_000 ms; 90d = 7_776_000_000 ms.
 * No lane may choose its own spacing — these exact values are the only
 * anchors a parameterized journey's per-epoch tables may cover.
 *
 * D8 (the field parameterization set, census-measured at 31bfe69 —
 * `docs/evidence/F330/report.md` §1.1): 4 count-eligible journeys, 2
 * rewrite-eligible (echo class), 1 excluded (past-only), 23 invariant.
 */

/** The corpora's fixture epoch (same value as adoption's ADOPTION_T0). */
export const ADOPTION_T0 = 1_774_000_000_000;

/** D9 frozen spacing (TL-owned values). */
export const EPOCH_30D_MS = 2_592_000_000;
export const EPOCH_90D_MS = 7_776_000_000;

export const EPOCH_ANCHOR_0 = ADOPTION_T0;
export const EPOCH_ANCHOR_1 = ADOPTION_T0 + EPOCH_30D_MS;
export const EPOCH_ANCHOR_2 = ADOPTION_T0 + EPOCH_90D_MS;

/** The frozen schedule per firm size (D9): small / medium / large. */
export const FIRM_EPOCH_SCHEDULES: Readonly<Record<"small" | "medium" | "large", readonly number[]>> = {
  small: [EPOCH_ANCHOR_0],
  medium: [EPOCH_ANCHOR_0, EPOCH_ANCHOR_1],
  large: [EPOCH_ANCHOR_0, EPOCH_ANCHOR_1, EPOCH_ANCHOR_2],
};

/** The maximal frozen schedule (large) — the D10 proof schedule: every
 * parameterized journey's per-epoch tables must cover these anchors and be
 * pairwise distinct on them (medium's 2-anchor schedule is a prefix). */
export const FROZEN_EPOCH_SCHEDULE: readonly number[] = FIRM_EPOCH_SCHEDULES.large;

// ---------------------------------------------------------------------------
// The F330 §1.1 census citations (machine-checkable declarations).
// ---------------------------------------------------------------------------

export type FieldCensusClass = "count-eligible" | "rewrite-eligible" | "excluded" | "invariant";

export interface FieldCensusEntry {
  readonly journeyId: string;
  readonly censusClass: FieldCensusClass;
  /** The F330 §1.1 census table row (verbatim citation, D10(3)). */
  readonly citation: string;
}

/**
 * The census's own framing of the 7 responding journeys (F330 §1.1 table):
 * transition-class (4) + echo-class (2) + past-only (1); the remaining 23
 * are invariant (the machine list below is exhaustive: 30 rows).
 */
export const FIELD_CENSUS: readonly FieldCensusEntry[] = [
  { journeyId: "maintain-asset-schedule", censusClass: "count-eligible", citation: "F330 §1.1: maintain-asset-schedule | transition (forward) | +1d and beyond | maintenance window/deadline" },
  { journeyId: "connectivity-postures", censusClass: "count-eligible", citation: "F330 §1.1: connectivity-postures | transition (bidirectional) | ±1h and beyond | posture window transitions" },
  { journeyId: "edge-command-lifecycle", censusClass: "count-eligible", citation: "F330 §1.1: edge-command-lifecycle | transition (bidirectional) | ±1h and beyond | command lifecycle" },
  { journeyId: "host-maintenance-intent-to-verification", censusClass: "count-eligible", citation: "F330 §1.1: host-maintenance-intent-to-verification | transition (forward) | +1d and beyond | scheduled verification" },
  { journeyId: "recover-lost-device", censusClass: "rewrite-eligible", citation: "F330 §1.1: recover-lost-device | echo (strict T0 pin) | ALL Δ incl. ±1s | absolute timestamp pin" },
  { journeyId: "host-health-evidence-timeline", censusClass: "rewrite-eligible", citation: "F330 §1.1: host-health-evidence-timeline | echo (strict T0 pin) | ALL Δ incl. ±1s | absolute timestamp pin" },
  { journeyId: "evidence-gated-recovery", censusClass: "excluded", citation: "F330 §1.1: evidence-gated-recovery | transition (past-only) | −1h only | evidence window — the frozen forward schedule cannot produce a distinct forward outcome; NO epochs declared" },
  ...[
    "enroll-new-asset",
    "trustworthy-state-recency",
    "investigate-injected-fault",
    "field-mode-offline-tolerance",
    "simulation-driven-experiment",
    "mission-replay-resume",
    "handoff-field-to-operator-publish",
    "handoff-field-to-operator-consume",
    "mobile-field-shape",
    "tenant-isolation-fail-closed",
    "host-discovery-device-360",
    "host-recovery-intent-to-verification",
    "host-field-workflow-mobile-offline",
    "host-role-lens-tenant-fail-closed",
    "store-and-forward-redelivery",
    "offline-buffer-capture-replay",
    "ingestion-limits-admission-discipline",
    "diagnosis-lifecycle-supersession",
    "anomaly-confidence-triage",
    "maintenance-calendar-scale",
    "asset-lineage-material-lots",
    "identity-session-lifecycle",
    "tenant-lifecycle-gating",
  ].map((journeyId) => ({
    journeyId,
    censusClass: "invariant" as const,
    citation: "F330 §1.1: invariant journey — no time response at any census Δ; NO epochs declared (D2(d) rerun supremacy)",
  })),
];

export function censusEntryOf(journeyId: string): FieldCensusEntry | undefined {
  return FIELD_CENSUS.find((e) => e.journeyId === journeyId);
}

/** The census classes that MAY declare epochs (D8: count-eligible plus a
 * SUCCESSFULLY rewritten echo journey — an unrewritten echo journey stays
 * single-counted and must NOT declare epochs). */
export const EPOCH_DECLARING_CLASSES: readonly FieldCensusClass[] = ["count-eligible", "rewrite-eligible"];
