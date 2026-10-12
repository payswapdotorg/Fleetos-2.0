/**
 * @fleetos/acceptance-adoption — firm sizing + the 30-workspace population.
 *
 * For EACH of the ten industries, exactly 3 firms (one per size: small,
 * medium, large) = 30 firm workspaces. Each `FirmWorkspace` carries a stable
 * id, its industry, a REAL per-firm tenant id, a logical-time epoch schedule
 * (small: 1 epoch; medium: 2; large: 3), and a device-population scale
 * (small 10s, medium 100s, large 1000s — informational record fields, NEVER
 * fake telemetry).
 *
 * TWO REAL constraints shape this population (F271 seam findings, evidenced
 * in docs/evidence/F271; constraint 2 superseded at F332 by the frozen D9
 * schedule law — F330 §2):
 *
 * 1. TENANT FORMAT LAW: the identity package's validator accepts only
 *    `^tnt_[A-Za-z0-9_-]{4,128}$`. The packet's example shape
 *    (`tenant-<industry>-<size>`) FAILS that REAL validator
 *    (malformed-tenant-id refusals, machine-verified). Per-firm tenant ids
 *    therefore use the REAL format: `tnt_<industry>-<size>`.
 *
 * 2. EPOCH SCHEDULE LAW (F330 D9, frozen TL-owned values — landed at F332):
 *    the declared epoch schedule per firm size is EXACTLY small `[T0]`,
 *    medium `[T0, T0+30d]`, large `[T0, T0+30d, T0+90d]` with
 *    `T0 = ADOPTION_T0 = 1_774_000_000_000` (the corpora's fixture epoch),
 *    `30d = 2_592_000_000` ms and `90d = 7_776_000_000` ms. No lane may
 *    choose its own spacing — these are the only anchors a parameterized
 *    journey's per-epoch expectation tables may cover. EXECUTION anchoring
 *    is governed by the counting gate (`EPOCH_COUNTING_ACTIVE`,
 *    adoption-run.ts): while the gate is INACTIVE every declared epoch
 *    executes at the fixture anchor T0 (the Wave-12 state persists
 *    byte-identically — epoch 1 counted, epochs ≥ 2 asserted
 *    byte-identical re-runs, never counted); when ACTIVE the epochs execute
 *    at their D9 anchors and per-epoch distinct journeys may count iff the
 *    D10 proof form passes and the D13 refusals hold (F330 §2).
 *
 * Pure deterministic TS. The epoch anchors are fixed constants — no wall
 * clock anywhere.
 */

import { INDUSTRIES, type IndustryDefinition } from "./industries.js";

export type FirmSize = "small" | "medium" | "large";

export const FIRM_SIZES: readonly FirmSize[] = ["small", "medium", "large"];

/**
 * The corpora's fixture epoch — epoch 0 of every firm-size schedule (the
 * D9 anchor-0 value; see FIRM_EPOCH_SCHEDULES below).
 */
export const ADOPTION_T0 = 1_774_000_000_000;

/** D9 frozen spacing (F330 §2 — TL-owned values, landed at F332). */
export const EPOCH_30D_MS = 2_592_000_000;
export const EPOCH_90D_MS = 7_776_000_000;

/**
 * The D9 frozen epoch schedule per firm size (F330 §2 — TL-owned values,
 * exact): small `[T0]`; medium `[T0, T0+30d]`; large `[T0, T0+30d,
 * T0+90d]`. The ONLY per-epoch anchors the corpora's expectation tables
 * may cover; execution anchoring is governed by the counting gate
 * (EPOCH_COUNTING_ACTIVE, adoption-run.ts) — while INACTIVE every epoch
 * still executes at the fixture anchor T0 (byte-identical re-runs).
 */
export const FIRM_EPOCH_SCHEDULES: Readonly<Record<FirmSize, readonly number[]>> = {
  small: [ADOPTION_T0],
  medium: [ADOPTION_T0, ADOPTION_T0 + EPOCH_30D_MS],
  large: [ADOPTION_T0, ADOPTION_T0 + EPOCH_30D_MS, ADOPTION_T0 + EPOCH_90D_MS],
};

/** The declared logical-time epoch schedule per firm size (packet law). */
export const FIRM_EPOCH_COUNTS: Readonly<Record<FirmSize, number>> = {
  small: 1,
  medium: 2,
  large: 3,
};

/** Informational device-population scale (record fields, never telemetry). */
export interface DevicePopulationScale {
  /** Nominal device count (tens / hundreds / thousands). */
  readonly devices: number;
  readonly scaleNote: string;
}

const DEVICE_POPULATIONS: Readonly<Record<FirmSize, DevicePopulationScale>> = {
  small: { devices: 25, scaleNote: "tens of devices" },
  medium: { devices: 350, scaleNote: "hundreds of devices" },
  large: { devices: 4_200, scaleNote: "thousands of devices" },
};

export interface FirmWorkspace {
  /** Stable id: `firm-<industry>-<size>`. */
  readonly id: string;
  readonly industryId: string;
  readonly size: FirmSize;
  /** REAL per-firm tenant id (identity-format law: `tnt_<industry>-<size>`). */
  readonly tenantId: string;
  /** Declared epoch count (1 / 2 / 3). */
  readonly epochCount: number;
  /** The D9 frozen epoch schedule for this firm's size (startedAt anchors —
   * see FIRM_EPOCH_SCHEDULES; while the counting gate is INACTIVE every
   * epoch executes at the fixture anchor T0, byte-identical re-runs). */
  readonly epochs: readonly number[];
  readonly devicePopulation: DevicePopulationScale;
}

function buildFirm(industry: IndustryDefinition, size: FirmSize): FirmWorkspace {
  const epochCount = FIRM_EPOCH_COUNTS[size];
  return {
    id: `firm-${industry.id}-${size}`,
    industryId: industry.id,
    size,
    tenantId: `tnt_${industry.id}-${size}`,
    epochCount,
    epochs: FIRM_EPOCH_SCHEDULES[size],
    devicePopulation: DEVICE_POPULATIONS[size] as DevicePopulationScale,
  };
}

/** The 30-firm population: 10 industries × exactly one firm per size. */
export const WORKSPACE_POPULATION: readonly FirmWorkspace[] = (() => {
  const firms: FirmWorkspace[] = [];
  for (const industry of INDUSTRIES) {
    for (const size of FIRM_SIZES) {
      firms.push(buildFirm(industry, size));
    }
  }
  return firms;
})();

/** Firms of one industry (size order: small, medium, large). */
export function firmsOfIndustry(industryId: string): readonly FirmWorkspace[] {
  return WORKSPACE_POPULATION.filter((f) => f.industryId === industryId);
}

/** The determinism-proof firm for an industry (the LARGE one, per packet). */
export function determinismProofFirm(industryId: string): FirmWorkspace | undefined {
  return WORKSPACE_POPULATION.find((f) => f.industryId === industryId && f.size === "large");
}

/** Lookup by stable id. */
export function firmById(id: string): FirmWorkspace | undefined {
  return WORKSPACE_POPULATION.find((f) => f.id === id);
}
