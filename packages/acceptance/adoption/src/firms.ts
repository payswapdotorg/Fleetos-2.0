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
 * TWO machine-verified REAL constraints shape this population (F271 seam
 * findings, evidenced in docs/evidence/F271):
 *
 * 1. TENANT FORMAT LAW: the identity package's validator accepts only
 *    `^tnt_[A-Za-z0-9_-]{4,128}$`. The packet's example shape
 *    (`tenant-<industry>-<size>`) FAILS that REAL validator
 *    (malformed-tenant-id refusals, machine-verified). Per-firm tenant ids
 *    therefore use the REAL format: `tnt_<industry>-<size>`.
 *
 * 2. EPOCH ANCHOR LAW: the F270A field corpus pins T0-anchored expectations
 *    (schedules, grants, deadlines, staleness baselines). Machine-verified:
 *    a +1s startedAt offset already fails 1 journey; +1h fails 3; multi-day
 *    offsets fail 12. The single supported logical epoch is the corpora's
 *    fixture epoch T0 = 1_774_000_000_000 — so every declared epoch ANCHORS
 *    there, and epochs ≥ 2 execute as byte-identical re-runs (proven per
 *    firm by the driver, never counted as executions).
 *
 * Pure deterministic TS. The epoch anchor is a fixed constant — no wall
 * clock anywhere.
 */

import { INDUSTRIES, type IndustryDefinition } from "./industries.js";

export type FirmSize = "small" | "medium" | "large";

export const FIRM_SIZES: readonly FirmSize[] = ["small", "medium", "large"];

/**
 * The corpora's fixture epoch — the single machine-verified-supported
 * logical `startedAt` for the parameterizable field runner. Every firm's
 * epochs anchor here (see the module doc: the offset schedule is
 * unsupported by the T0-calibrated corpus).
 */
export const ADOPTION_T0 = 1_774_000_000_000;

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
  /** The startedAt anchor each declared epoch executes at (all T0 — see module doc). */
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
    epochs: Array.from({ length: epochCount }, () => ADOPTION_T0),
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
