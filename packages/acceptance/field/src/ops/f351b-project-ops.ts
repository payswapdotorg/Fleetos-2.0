/**
 * @fleetos/acceptance-field — F351B operation executors: the project
 * closeout/archival discipline (projects package; census §1 rows P1–P2,
 * zero corpus coverage at base `4f59ffe`).
 *
 * Every executor drives a REAL public API of @fleetos/projects
 * (archiveProject, readProjectForTenant — the unexercised closeout
 * surface; transitionProject as the covered lifecycle substrate that
 * honestly reaches the terminal states the archival law requires) and
 * records readings from the REAL outputs — never re-derived. A refused
 * archival/transition is the REAL machine-stable reason code; a
 * foreign-tenant read is the REAL fail-closed null (no existence leak).
 */

import {
  archiveProject,
  readProjectForTenant,
  transitionProject,
  type Project,
  type ProjectTransitionCommand,
} from "@fleetos/projects";
import type { JourneyOperation } from "../journey-contracts.js";
import type { JourneyContext } from "../context.js";
import { opOk, opRefused, type OpExecution } from "./common.js";

function projectOf(ctx: JourneyContext, projectId: string): Project | undefined {
  return ctx.f351bProjects.get(projectId);
}

function commandOf(op: Extract<JourneyOperation, { kind: "pj.transition" }>): ProjectTransitionCommand {
  switch (op.command) {
    case "activate":
      return { type: "activate" };
    case "hold":
      return { type: "hold", reason: op.reason ?? "" };
    case "resume":
      return { type: "resume" };
    case "complete":
      return { type: "complete" };
    case "cancel":
      return { type: "cancel", reason: op.reason ?? "" };
  }
}

export function executeF351BProjectOperation(op: JourneyOperation, ctx: JourneyContext): OpExecution {
  switch (op.kind) {
    case "pj.open": {
      const project: Project = {
        id: { kind: "project", value: op.projectId },
        tenant: { tenantId: ctx.tenantId },
        name: op.name,
        status: "draft",
        milestoneIds: [],
      };
      ctx.f351bProjects.set(op.projectId, project);
      return opOk({ "pj.status": project.status, "pj.name": project.name });
    }
    case "pj.transition": {
      const current = projectOf(ctx, op.projectId);
      if (current === undefined) return opRefused("unknown-project", { "pj.reasonCode": "UNKNOWN_PROJECT" });
      const result = transitionProject(current, commandOf(op));
      if (!result.ok) {
        return opRefused(result.reasonCode, {
          "pj.reasonCode": result.reasonCode,
          "pj.status": current.status,
        });
      }
      ctx.f351bProjects.set(op.projectId, result.next);
      return opOk({ "pj.status": result.next.status, "pj.reasonCode": null });
    }
    case "pj.archive": {
      const project = projectOf(ctx, op.projectId);
      if (project === undefined) return opRefused("unknown-project", { "pj.reasonCode": "UNKNOWN_PROJECT" });
      const result = archiveProject(project, ctx.f351bProjectArchives, op.archivedAt);
      if (!result.ok) {
        return opRefused(result.reasonCode, {
          "pj.reasonCode": result.reasonCode,
          "pj.status": project.status,
        });
      }
      ctx.f351bProjectArchives.push(result.record);
      return opOk({
        "pj.reasonCode": null,
        "pj.archivedStatus": result.record.statusAtArchival,
        "pj.archivedAt": result.record.archivedAt,
        "pj.archiveCount": ctx.f351bProjectArchives.length,
      });
    }
    case "pj.read": {
      const tenant = { tenantId: op.tenantId ?? ctx.tenantId };
      const found = readProjectForTenant([...ctx.f351bProjects.values()], tenant, op.projectId);
      if (found === null) {
        // The REAL fail-closed read: foreign tenant or unknown id — honest
        // absence, never a fabricated record (no existence leak).
        const foreign = tenant.tenantId !== ctx.tenantId;
        return opRefused(foreign ? "tenant-fail-closed" : "unknown-project", {
          "pj.readRefused": foreign ? "tenant-fail-closed" : "unknown-project",
          "pj.readStatus": null,
        });
      }
      return opOk({ "pj.readStatus": found.status, "pj.readName": found.name });
    }
    default:
      return opRefused("unknown-operation");
  }
}
