/**
 * FleetOS shell — shared work-item mapping (F301).
 *
 * Maps the demo world's work-board records into the @fleetos/work WorkItem
 * shape the lane builders consume. Pure projection, no store.
 */

import { T0, type TenantWorld } from "./world.js";

export function mapWorkItems(tw: TenantWorld) {
  return tw.workBoardItems.map((w) => ({
    id: { kind: "work-item" as const, value: w.id },
    tenant: { tenantId: w.tenant },
    title: w.title,
    assignee: { assigneeId: w.assignee, assignedAt: new Date(T0).toISOString() },
    assignmentHistory: [],
    deadline: null,
    status: w.state === "in_progress" ? ("in_progress" as const) : ("todo" as const),
    blockedReason: null,
    missionRef: null,
    workflowRef: null,
    projectId: null,
  }));
}
