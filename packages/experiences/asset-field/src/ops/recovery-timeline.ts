/**
 * @fleetos/experience-asset-field — open-recovery timeline read-model.
 *
 * The open-recovery board: every non-terminal recovery case (open /
 * investigating / proposal) as a timeline — the case's full command
 * history (from @fleetos/recovery's append-only case history) ordered by
 * logical time, with the case's age against the view's `now`. Cases are
 * ordered longest-open-first (openedAt asc, then caseId); steps are
 * ordered by `at` asc, then command, then from-state — a total
 * deterministic order. Resolved/closed cases are terminal and excluded.
 *
 * F331A (Wave 13 lane A, D8 echo-rewrite law): the board is AS-OF `now` —
 * a case whose `openedAt` lies in the future of `now` is NOT on the board
 * (window boundary), and every on-board case carries its staleness class
 * against the view's thresholds (the established fresh/stale/unknown
 * vocabulary — a staleness-class transition, never a guessed freshness).
 */

import { viewDigestOf } from "../digest.js";
import { buildStateIndexes } from "../indexes.js";
import type { ExperienceStateSlice } from "../state.js";
import { classifyRecency, defaultRecencyThresholds, type RecencyThresholds, type StalenessClass } from "../staleness.js";
import { guardView, SCHEMA_VERSION, type ViewResult } from "../view-support.js";
import type { RecoveryState } from "@fleetos/recovery";

export interface RecoveryTimelineOptions {
  readonly now: number;
  readonly thresholds?: RecencyThresholds;
}

export interface RecoveryStep {
  readonly at: number;
  readonly from: RecoveryState;
  readonly to: RecoveryState;
  readonly command: string;
  readonly reason: string | null;
}

export interface CaseTimeline {
  readonly caseId: string;
  readonly deviceId: string;
  readonly assetId: string;
  readonly state: RecoveryState;
  readonly openedAt: number;
  readonly ageMs: number;
  /** F331A: the case's staleness class against the view's now + thresholds
   * (the established vocabulary; negative ages clamp to fresh). */
  readonly staleness: StalenessClass;
  readonly steps: readonly RecoveryStep[];
}

export interface RecoveryTimeline {
  readonly schemaVersion: number;
  readonly tenantId: string;
  readonly asOf: number;
  readonly open: number;
  readonly cases: readonly CaseTimeline[];
  readonly digest: string;
}

const OPEN_STATES: ReadonlySet<RecoveryState> = new Set([
  "open",
  "investigating",
  "proposal",
] as const);

function recoveryTimelineDigestOf(timeline: Omit<RecoveryTimeline, "digest">): string {
  return viewDigestOf("recovery-timeline", timeline);
}

/** Recompute the recovery-timeline digest; false means tampered content. */
export function verifyRecoveryTimelineDigest(timeline: RecoveryTimeline): boolean {
  const { digest, ...rest } = timeline;
  return recoveryTimelineDigestOf(rest) === digest;
}

/** Assemble the open-recovery timeline board. */
export function assembleRecoveryTimeline(
  state: ExperienceStateSlice,
  options: RecoveryTimelineOptions,
): ViewResult<RecoveryTimeline> {
  const refused = guardView(state, options.now, options.thresholds ?? defaultRecencyThresholds());
  if (refused) return refused;
  const thresholds = options.thresholds ?? defaultRecencyThresholds();
  const indexes = buildStateIndexes(state);

  const cases: CaseTimeline[] = [];
  for (const recoveryCase of state.recoveryCases) {
    if (!OPEN_STATES.has(recoveryCase.state)) continue;
    // F331A as-of law: a case opened after `now` is not on the as-of board
    // (the case's existence window has not opened at this review moment).
    if (recoveryCase.openedAt > options.now) continue;
    const device = indexes.deviceById.get(recoveryCase.deviceId);
    if (!device) continue; // guarded; kept for total determinism
    const classified = classifyRecency(recoveryCase.openedAt, options.now, thresholds);
    const steps: RecoveryStep[] = recoveryCase.history.map((entry) => ({
      at: entry.at,
      from: entry.from,
      to: entry.to,
      command: entry.command,
      reason: entry.reason ?? null,
    }));
    steps.sort((a, b) => {
      if (a.at !== b.at) return a.at - b.at;
      if (a.command !== b.command) return a.command < b.command ? -1 : 1;
      return a.from < b.from ? -1 : 1;
    });
    cases.push({
      caseId: recoveryCase.id,
      deviceId: recoveryCase.deviceId,
      assetId: device.assetId,
      state: recoveryCase.state,
      openedAt: recoveryCase.openedAt,
      ageMs: options.now - recoveryCase.openedAt,
      staleness: classified.ok ? classified.reading.staleness : "unknown",
      steps,
    });
  }
  cases.sort((a, b) => {
    if (a.openedAt !== b.openedAt) return a.openedAt - b.openedAt;
    return a.caseId < b.caseId ? -1 : 1;
  });

  const base: Omit<RecoveryTimeline, "digest"> = {
    schemaVersion: SCHEMA_VERSION,
    tenantId: state.tenantId,
    asOf: options.now,
    open: cases.length,
    cases,
  };
  return { ok: true, view: { ...base, digest: recoveryTimelineDigestOf(base) } };
}
