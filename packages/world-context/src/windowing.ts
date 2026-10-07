/**
 * @fleetos/world-context — Windowed context projections + horizon discipline.
 *
 * Wave 1 (F210B) additions:
 *   - Windowed context projection (sliding window over observations)
 *   - Horizon discipline — never join observations before producedAt + horizonMs
 *
 * Pure types + pure functions.
 */

import type {
  WorkloadProjection,
  ProjectProjection,
  ObservationProvenance,
  TenantScopeLike,
  WorkItemRef,
  ProjectRef,
} from "./index.ts";
import { projectWorkload, projectProject } from "./index.ts";

/** A windowed workload projection — adds windowStart/windowEnd to the base. */
export interface WindowedWorkloadProjection extends WorkloadProjection {
  readonly windowStart: string;
  readonly windowEnd: string;
}

/** A windowed project projection — adds windowStart/windowEnd to the base. */
export interface WindowedProjectProjection extends ProjectProjection {
  readonly windowStart: string;
  readonly windowEnd: string;
}

/**
 * Project a workload over a time window.
 *
 * Only observations within [windowStart, windowEnd] are included in the
 * provenance. This is the windowing extension for law A3 — observations are
 * immutable, but projections are versioned + windowed.
 */
export function projectWindowedWorkload(input: {
  readonly tenant: TenantScopeLike;
  readonly workloadId: string;
  readonly assetIds: readonly string[];
  readonly workItemRefs: readonly WorkItemRef[];
  readonly projectRefs: readonly ProjectRef[];
  readonly observations: readonly ObservationProvenance[];
  readonly utilization: number;
  readonly computedAt: string;
  readonly windowStart: string;
  readonly windowEnd: string;
}): WindowedWorkloadProjection {
  const windowed = input.observations.filter(
    (o) => o.observedAt >= input.windowStart && o.observedAt <= input.windowEnd,
  );
  const base = projectWorkload({
    tenant: input.tenant,
    workloadId: input.workloadId,
    assetIds: input.assetIds,
    workItemRefs: input.workItemRefs,
    projectRefs: input.projectRefs,
    observations: windowed,
    utilization: input.utilization,
    computedAt: input.computedAt,
  });
  return {
    ...base,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
  };
}

/**
 * Project a project over a time window.
 */
export function projectWindowedProject(input: {
  readonly tenant: TenantScopeLike;
  readonly project: ProjectRef;
  readonly workItems: readonly WorkItemRef[];
  readonly assetIds: readonly string[];
  readonly observations: readonly ObservationProvenance[];
  readonly computedAt: string;
  readonly windowStart: string;
  readonly windowEnd: string;
}): WindowedProjectProjection {
  const windowed = input.observations.filter(
    (o) => o.observedAt >= input.windowStart && o.observedAt <= input.windowEnd,
  );
  const base = projectProject({
    tenant: input.tenant,
    project: input.project,
    workItems: input.workItems,
    assetIds: input.assetIds,
    observations: windowed,
    computedAt: input.computedAt,
  });
  return {
    ...base,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
  };
}

/**
 * Horizon discipline — check if an observation is mature enough to join.
 *
 * Law: never join an observation before producedAt + horizonMs. This prevents
 * premature joins of observations that haven't reached their validity horizon.
 *
 * Returns true if the observation is mature (now >= producedAt + horizonMs).
 */
export function isObservationMature(
  producedAt: string,
  horizonMs: number,
  now: string,
): boolean {
  const producedTime = new Date(producedAt).getTime();
  const nowTime = new Date(now).getTime();
  return nowTime >= producedTime + horizonMs;
}

/**
 * Filter observations by horizon discipline — only return mature observations.
 *
 * Law: never join before producedAt + horizonMs.
 */
export function filterMatureObservations(
  observations: readonly ObservationProvenance[],
  horizonMs: number,
  now: string,
): readonly ObservationProvenance[] {
  return observations.filter((o) => isObservationMature(o.observedAt, horizonMs, now));
}

/**
 * Verify that a windowed projection only contains observations within its window.
 *
 * Law A3 — observations are immutable; projections are versioned + windowed.
 */
export function verifyWindowIntegrity(
  projection: WindowedWorkloadProjection | WindowedProjectProjection,
): { readonly ok: boolean; readonly outOfWindow: number } {
  let outOfWindow = 0;
  for (const obs of projection.provenance) {
    if (obs.observedAt < projection.windowStart || obs.observedAt > projection.windowEnd) {
      outOfWindow += 1;
    }
  }
  return { ok: outOfWindow === 0, outOfWindow };
}
