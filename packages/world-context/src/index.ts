/**
 * @fleetos/world-context — context projections (workload/project context
 * shape), per-observation provenance refs, versioned schema.
 *
 * Pure types + pure projectors. No I/O. Each projection carries a schema
 * version and a per-observation provenance ref (law A3 — observations are
 * immutable; derived projections are versioned).
 */

/** LOCAL structural tenant scope (compatible with Worker A). */
export interface TenantScopeLike {
  readonly tenantId: string;
  readonly workspaceId?: string;
}

/** LOCAL structural work-item reference (compatible with Worker C). */
export interface WorkItemRef {
  readonly workItemId: string;
  readonly missionId?: string;
}

/** LOCAL structural project reference (compatible with Worker C). */
export interface ProjectRef {
  readonly projectId: string;
}

/** Schema version — bumped when the projection shape changes. */
export const WORLD_CONTEXT_SCHEMA_VERSION = "1.0.0" as const;

/** Per-observation provenance — which observation contributed this datum. */
export interface ObservationProvenance {
  readonly observationRef: string;
  readonly observedAt: string;
  readonly observer: string;
  readonly sensorKind: string;
}

/** Workload projection — derived from observations + work context. */
export interface WorkloadProjection {
  readonly schemaVersion: typeof WORLD_CONTEXT_SCHEMA_VERSION;
  readonly tenant: TenantScopeLike;
  readonly workloadId: string;
  readonly assetIds: readonly string[];
  readonly workItemRefs: readonly WorkItemRef[];
  readonly projectRefs: readonly ProjectRef[];
  readonly utilization: number; // 0..1
  readonly computedAt: string;
  readonly provenance: readonly ObservationProvenance[];
  readonly degraded: boolean;
}

/** Project projection — derived from work items + asset assignments. */
export interface ProjectProjection {
  readonly schemaVersion: typeof WORLD_CONTEXT_SCHEMA_VERSION;
  readonly tenant: TenantScopeLike;
  readonly project: ProjectRef;
  readonly activeWorkItems: number;
  readonly assetIds: readonly string[];
  readonly computedAt: string;
  readonly provenance: readonly ObservationProvenance[];
}

/** Project a workload from raw observations + work/project refs. Pure. */
export function projectWorkload(input: {
  readonly tenant: TenantScopeLike;
  readonly workloadId: string;
  readonly assetIds: readonly string[];
  readonly workItemRefs: readonly WorkItemRef[];
  readonly projectRefs: readonly ProjectRef[];
  readonly observations: readonly ObservationProvenance[];
  readonly utilization: number;
  readonly computedAt: string;
}): WorkloadProjection {
  const degraded = input.observations.length === 0 || input.utilization < 0;
  return {
    schemaVersion: WORLD_CONTEXT_SCHEMA_VERSION,
    tenant: input.tenant,
    workloadId: input.workloadId,
    assetIds: input.assetIds,
    workItemRefs: input.workItemRefs,
    projectRefs: input.projectRefs,
    utilization: input.utilization,
    computedAt: input.computedAt,
    provenance: input.observations,
    degraded,
  };
}

/** Project a project from work-item counts + asset assignments. Pure. */
export function projectProject(input: {
  readonly tenant: TenantScopeLike;
  readonly project: ProjectRef;
  readonly workItems: readonly WorkItemRef[];
  readonly assetIds: readonly string[];
  readonly observations: readonly ObservationProvenance[];
  readonly computedAt: string;
}): ProjectProjection {
  return {
    schemaVersion: WORLD_CONTEXT_SCHEMA_VERSION,
    tenant: input.tenant,
    project: input.project,
    activeWorkItems: input.workItems.length,
    assetIds: input.assetIds,
    computedAt: input.computedAt,
    provenance: input.observations,
  };
}

/** Verify the schema version on a projection — runtime guard. */
export function hasValidSchemaVersion<P extends { readonly schemaVersion: string }>(p: P): boolean {
  return p.schemaVersion === WORLD_CONTEXT_SCHEMA_VERSION;
}
