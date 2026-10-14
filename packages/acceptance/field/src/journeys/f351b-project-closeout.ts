/**
 * @fleetos/acceptance-field — F351B journey 3: the project closeout
 * archival discipline (Wave 16 lane A — the masked-industry coverage
 * tranche 1; construction-primary persona: stage-gated site projects).
 *
 * CENSUS CITATION (F351B report §1, machine-measured at base `4f59ffe`;
 * zero grep matches across the field/security/commerce corpora):
 *   - archiveProject — packages/projects/src/stages.ts:160
 *   - readProjectForTenant — packages/projects/src/stages.ts:192
 *   (transitionProject — packages/projects/src/contracts.ts:165 — is the
 *   commerce-covered lifecycle SUBSTRATE honestly used to reach the
 *   terminal states the archival law requires; it is not claimed as new
 *   coverage.)
 *
 * The REAL capability is @fleetos/projects' closeout law: only a TERMINAL
 * project (completed/cancelled) may be archived, double archival is
 * refused, the archival record is tenant-scoped, and the read model is
 * fail-closed (a foreign tenant cannot distinguish existence from
 * absence). A distinct mechanic from the commerce stage-gate journeys:
 * this is the terminal-state + archival + fail-closed-read discipline.
 *
 * Applicability (D15-strict): NOT fleet-universal — masked for
 * transportation-logistics + agriculture (the incumbent-PMO /
 * contractor-run rationales mirroring their recorded stage-gated-project
 * commerce masks); applicable to the other eight industries.
 *
 * Vocabulary law: persona `site-manager` + capability `trustworthy-state`
 * (the terminal-state + fail-closed-read family of the frozen
 * 14-capability vocabulary; no vocabulary change, F331A precedent).
 */

import type { AcceptanceJourney } from "../journey-contracts.js";
import { FOREIGN_TENANT } from "../fixtures.js";

const T0 = 1_774_000_000_000;

export const projectCloseoutArchivalJourney: AcceptanceJourney = {
  id: "project-closeout-archival",
  persona: "site-manager",
  capability: "trustworthy-state",
  goal: "Close out the site project honestly: the REAL archival law refuses non-terminal and double archival, the cancelled path archives too, and the read model fails closed on a foreign tenant with no existence leak.",
  steps: [
    { id: "p1", summary: "open the construction project (dockside crane pad)", op: { kind: "pj.open", projectId: "proj_site-210", name: "Dockside crane pad" } },
    { id: "p2", summary: "try archiving the DRAFT project (must refuse — not terminal)", expectRefusal: true, op: { kind: "pj.archive", projectId: "proj_site-210", archivedAt: T0 } },
    { id: "p3", summary: "try completing from draft (must refuse — illegal transition)", expectRefusal: true, op: { kind: "pj.transition", projectId: "proj_site-210", command: "complete" } },
    { id: "p4", summary: "activate the project", op: { kind: "pj.transition", projectId: "proj_site-210", command: "activate" } },
    { id: "p5", summary: "try archiving the ACTIVE project (must refuse — not terminal)", expectRefusal: true, op: { kind: "pj.archive", projectId: "proj_site-210", archivedAt: T0 + 86_400_000 } },
    { id: "p6", summary: "complete the project (the stage gates are green)", op: { kind: "pj.transition", projectId: "proj_site-210", command: "complete" } },
    { id: "p7", summary: "archive the completed project", op: { kind: "pj.archive", projectId: "proj_site-210", archivedAt: T0 + 172_800_000 } },
    { id: "p8", summary: "try archiving again (must refuse — double archival)", expectRefusal: true, op: { kind: "pj.archive", projectId: "proj_site-210", archivedAt: T0 + 259_200_000 } },
    { id: "p9", summary: "read the archived project with the owning tenant", op: { kind: "pj.read", projectId: "proj_site-210" } },
    { id: "p10", summary: "read it with a FOREIGN tenant (must fail closed — no existence leak)", expectRefusal: true, op: { kind: "pj.read", projectId: "proj_site-210", tenantId: FOREIGN_TENANT } },
    { id: "p11", summary: "open the second project (site office rewiring)", op: { kind: "pj.open", projectId: "proj_site-211", name: "Site office rewiring" } },
    { id: "p12", summary: "try cancelling without a reason (must refuse — the reason law)", expectRefusal: true, op: { kind: "pj.transition", projectId: "proj_site-211", command: "cancel" } },
    { id: "p13", summary: "cancel with the honest reason (budget pulled)", op: { kind: "pj.transition", projectId: "proj_site-211", command: "cancel", reason: "capital budget reallocated to the north pit" } },
    { id: "p14", summary: "archive the cancelled project (the other terminal path)", op: { kind: "pj.archive", projectId: "proj_site-211", archivedAt: T0 + 345_600_000 } },
    { id: "p15", summary: "read a project id that does not exist (honest absence, no fabrication)", expectRefusal: true, op: { kind: "pj.read", projectId: "proj_site-999" } },
  ],
  assertions: [
    { id: "c1", description: "a fresh project opens in draft", reading: "p1.pj.status", op: "deep-equals", expected: "draft" },
    { id: "c2", description: "archiving a draft project refuses with the REAL reason", reading: "p2.pj.reasonCode", op: "deep-equals", expected: "PROJECT_NOT_TERMINAL" },
    { id: "c3", description: "completing from draft refuses with the REAL reason (the lifecycle law)", reading: "p3.pj.reasonCode", op: "deep-equals", expected: "ILLEGAL_TRANSITION" },
    { id: "c4", description: "activation moves the project to active", reading: "p4.pj.status", op: "deep-equals", expected: "active" },
    { id: "c5", description: "archiving an active project refuses — only terminal projects archive", reading: "p5.pj.reasonCode", op: "deep-equals", expected: "PROJECT_NOT_TERMINAL" },
    { id: "c6", description: "completion reaches the completed terminal state", reading: "p6.pj.status", op: "deep-equals", expected: "completed" },
    { id: "c7", description: "the archival record carries the status at archival", reading: "p7.pj.archivedStatus", op: "deep-equals", expected: "completed" },
    { id: "c8", description: "the archival record carries the deterministic archival time", reading: "p7.pj.archivedAt", op: "deep-equals", expected: T0 + 172_800_000 },
    { id: "c9", description: "double archival refuses with the REAL reason", reading: "p8.pj.reasonCode", op: "deep-equals", expected: "ALREADY_ARCHIVED" },
    { id: "c10", description: "the owning tenant still reads the archived project's status", reading: "p9.pj.readStatus", op: "deep-equals", expected: "completed" },
    { id: "c11", description: "the foreign tenant read fails closed with the REAL note (no existence leak)", reading: "p10.pj.readRefused", op: "deep-equals", expected: "tenant-fail-closed" },
    { id: "c12", description: "cancelling without a reason refuses with the REAL reason", reading: "p12.pj.reasonCode", op: "deep-equals", expected: "CANCEL_REASON_REQUIRED" },
    { id: "c13", description: "the honest cancel reaches the cancelled terminal state", reading: "p13.pj.status", op: "deep-equals", expected: "cancelled" },
    { id: "c14", description: "the cancelled project archives with its own status at archival", reading: "p14.pj.archivedStatus", op: "deep-equals", expected: "cancelled" },
    { id: "c15", description: "the ledger now holds exactly the two archival records (grow-only)", reading: "p14.pj.archiveCount", op: "deep-equals", expected: 2 },
    { id: "c16", description: "reading a nonexistent id honestly refuses (never fabricates a record)", reading: "p15.pj.readRefused", op: "deep-equals", expected: "unknown-project" },
  ],
};
