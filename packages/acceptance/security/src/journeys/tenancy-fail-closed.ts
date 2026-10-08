/**
 * Journey 13 — tenant fail-closed everywhere (persona: security-analyst).
 *
 * The cross-cutting A8 journey: a tenant boundary violation is REFUSED by
 * every REAL read/write surface in the lane, with the offender named and NO
 * partial state:
 *   - findings intake view: a foreign finding refuses the whole view;
 *   - command queue: cross-tenant submit refuses;
 *   - execution ledger: a cross-tenant append refuses;
 *   - action state machine: a cross-tenant advance refuses;
 *   - posture read: another tenant's fold state refuses;
 *   - adoption lifecycle: a foreign proposal refuses to open;
 *   - arena case set: a foreign case refuses to assemble.
 */

import type { AcceptanceJourney } from "../journey-contracts.ts";
import { runFindingIntake, proposeRemediationRecord, readPostureForTenant, foldPostureEvents } from "@fleetos/security";
import type { SecurityFinding } from "@fleetos/security";
import { buildFindingViews } from "@fleetos/experience-safety-intel";
import { createCommandQueue, submitCommand } from "@fleetos/execution";
import { appendExecutionLedger } from "@fleetos/execution";
import { advanceActionState, proposeAction } from "@fleetos/actions";
import { evaluateCapability } from "@fleetos/policy";
import { openAdoptionLifecycle, proposeAdoption, evaluateCapability as evaluateLearning } from "@fleetos/learning";
import { assembleCaseSet, intakeCases } from "@fleetos/arena";
import {
  BASE_MS,
  EXECUTE_CAPABILITY,
  FOREIGN_TENANT,
  NOW_MS,
  OPERATOR_CTX,
  TENANT,
  isoOfEpochMs,
  tenantPolicy,
} from "./fixture-world.ts";

export const tenancyFailClosedJourney: AcceptanceJourney = {
  journeyId: "security.tenant-fail-closed",
  persona: "security-analyst",
  capabilities: ["tenant-isolation"],
  goal: "Tenant boundaries hold on every surface — fail-closed, offender named",
  steps: [
    {
      stepId: "read-surface-refusals",
      kind: "negative-check",
      description: "Foreign findings refuse the intake view; foreign posture refuses the read",
      packages: ["@fleetos/security", "@fleetos/experience-safety-intel"],
      operations: ["runFindingIntake", "buildFindingViews", "readPostureForTenant", "foldPostureEvents"],
      run: (ctx) => {
        const intake = runFindingIntake(
          [
            {
              tenantId: TENANT.tenantId,
              kind: "device.firmware_outdated",
              declaredSeverity: "medium",
              confidence: "confirmed",
              detectedAt: BASE_MS + 1_000,
              assetIds: ["pump-7"],
              description: "outdated firmware",
              evidenceRefs: [],
              signalCount: 2,
            },
          ],
          { correlationWindowMs: 60_000 },
        );
        if (intake.admitted.length !== 1) throw new Error("intake admitted nothing");
        const own: SecurityFinding = {
          findingId: intake.admitted[0]!.findingId,
          tenantId: TENANT.tenantId,
          kind: intake.admitted[0]!.kind,
          severity: intake.admitted[0]!.severity,
          confidence: intake.admitted[0]!.confidence,
          detectedAt: isoOfEpochMs(intake.admitted[0]!.detectedAt),
          assetIds: [...intake.admitted[0]!.assetIds],
          description: intake.admitted[0]!.description,
          evidenceRefs: [],
          findingDigest: intake.admitted[0]!.fingerprint,
        };
        const foreign: SecurityFinding = { ...own, findingId: "finding-foreign", tenantId: FOREIGN_TENANT.tenantId };
        const refused = buildFindingViews({ tenantId: TENANT.tenantId, findings: [own, foreign], remediations: [] });
        ctx.record("views.crossOk", refused.ok);
        ctx.record("views.crossRefused", refused.ok ? "unexpected-allow" : refused.refused);
        ctx.record("views.offenderNamed", refused.ok ? "" : (refused.detail.includes("finding-foreign") ? "finding-foreign" : "not-named"));
        const missing = buildFindingViews({ tenantId: "", findings: [], remediations: [] });
        ctx.record("views.missingOk", missing.ok);
        ctx.record("views.missingRefused", missing.ok ? "unexpected-allow" : missing.refused);

        // Fold the RIVAL tenant's stream (the fold pins the stream's tenant),
        // then attempt to read it under OUR tenant scope — posture is NEVER
        // returned cross-tenant (A8).
        const rivalEvents = [
          { seq: 1, tenantId: FOREIGN_TENANT.tenantId, kind: "finding.opened" as const, findingId: "finding-globex-1", severity: "high" as const, at: BASE_MS },
        ];
        const rivalFolded = foldPostureEvents(rivalEvents);
        if (!rivalFolded.ok) throw new Error("rival posture fold failed");
        const crossRead = readPostureForTenant(rivalFolded.state, TENANT.tenantId);
        ctx.record("posture.readOk", crossRead.ok);
        ctx.record("posture.readRefused", crossRead.ok ? "unexpected-allow" : crossRead.reason);
        // The rival's own read still works (control — isolation, not corruption):
        const ownRivalRead = readPostureForTenant(rivalFolded.state, FOREIGN_TENANT.tenantId);
        ctx.record("posture.rivalOwnReadOk", ownRivalRead.ok);
        // An empty tenant scope refuses the read outright:
        const emptyScope = readPostureForTenant(rivalFolded.state, "");
        ctx.record("posture.missingOk", emptyScope.ok);
        ctx.record("posture.missingRefused", emptyScope.ok ? "unexpected-allow" : emptyScope.reason);
        // A foreign event inside OUR fold scope refuses the FOLD itself:
        const mixedFold = foldPostureEvents(
          [
            { seq: 1, tenantId: TENANT.tenantId, kind: "finding.opened" as const, findingId: "finding-own-1", severity: "low" as const, at: BASE_MS },
            { seq: 2, tenantId: FOREIGN_TENANT.tenantId, kind: "finding.opened" as const, findingId: "finding-globex-1", severity: "high" as const, at: BASE_MS + 1_000 },
          ],
          { requireTenant: TENANT.tenantId },
        );
        ctx.record("posture.foldCrossOk", mixedFold.ok);
        ctx.record("posture.foldCrossRefused", mixedFold.ok ? "unexpected-allow" : mixedFold.reason);
      },
    },
    {
      stepId: "write-surface-refusals",
      kind: "negative-check",
      description: "Cross-tenant queue submit, ledger append, action advance and adoption open all refuse",
      packages: ["@fleetos/execution", "@fleetos/actions", "@fleetos/policy", "@fleetos/learning", "@fleetos/arena"],
      operations: ["createCommandQueue", "submitCommand", "appendExecutionLedger", "advanceActionState", "openAdoptionLifecycle", "assembleCaseSet"],
      run: (ctx) => {
        const queue = createCommandQueue(TENANT.tenantId);
        if (!queue.ok) throw new Error("queue creation refused");
        const foreignSubmit = submitCommand(queue.state, {
          idempotencyKey: "key-foreign-1",
          capabilityId: EXECUTE_CAPABILITY.id,
          payloadInputs: {},
          at: NOW_MS,
          tenantId: FOREIGN_TENANT.tenantId,
        });
        ctx.record("queue.crossOk", foreignSubmit.ok);
        ctx.record("queue.crossRefused", foreignSubmit.ok ? "unexpected-allow" : foreignSubmit.reason);

        const ledger = appendExecutionLedger([], {
          tenantId: TENANT.tenantId,
          idempotencyKey: "key-1",
          kind: "submitted",
          at: NOW_MS,
        });
        if (!ledger.ok) throw new Error("first append refused");
        const foreignAppend = appendExecutionLedger(ledger.ledger, {
          tenantId: FOREIGN_TENANT.tenantId,
          idempotencyKey: "key-2",
          kind: "submitted",
          at: NOW_MS + 1_000,
        });
        ctx.record("ledger.crossOk", foreignAppend.ok);
        ctx.record("ledger.crossRefused", foreignAppend.ok ? "unexpected-allow" : foreignAppend.reason);

        const decision = evaluateCapability(tenantPolicy(), EXECUTE_CAPABILITY, OPERATOR_CTX(EXECUTE_CAPABILITY));
        const record = proposeAction({
          intentId: "intent-tenant-1",
          tenant: TENANT,
          capability: EXECUTE_CAPABILITY,
          idempotencyKey: { tenantId: TENANT.tenantId, capabilityId: EXECUTE_CAPABILITY.id, nonce: "t" },
          inputs: {},
          proposedAt: isoOfEpochMs(NOW_MS),
          proposedBy: "engineer-raj",
        });
        const foreignAdvance = advanceActionState(record, "authorized", {
          at: isoOfEpochMs(NOW_MS),
          authorization: decision,
          tenantId: FOREIGN_TENANT.tenantId,
        });
        ctx.record("action.crossOk", foreignAdvance.ok);
        ctx.record("action.crossRefused", foreignAdvance.ok ? "unexpected-allow" : foreignAdvance.reason);

        const learningEval = evaluateLearning(
          [{ caseId: "c1", tenant: { tenantId: TENANT.tenantId }, capability: { capabilityId: EXECUTE_CAPABILITY.id, version: "1.2.0" }, inputs: {}, expected: "ok", description: "", tags: [] }],
          [],
          { tenantId: TENANT.tenantId },
          { capabilityId: EXECUTE_CAPABILITY.id, version: "1.2.0" },
        );
        const foreignProposal = proposeAdoption({
          tenant: { tenantId: TENANT.tenantId },
          capability: { capabilityId: EXECUTE_CAPABILITY.id, version: "1.2.0" },
          evaluation: learningEval,
          proposedBy: "ml-engineer-sam",
          rationale: "",
          proposedAt: isoOfEpochMs(NOW_MS),
        });
        const foreignLifecycle = openAdoptionLifecycle({
          tenant: { tenantId: FOREIGN_TENANT.tenantId },
          proposal: foreignProposal,
          openedAtMs: NOW_MS,
        });
        ctx.record("adoption.crossOk", foreignLifecycle.ok);
        ctx.record("adoption.crossCode", foreignLifecycle.ok ? "unexpected-allow" : foreignLifecycle.code);

        const arenaIntake = intakeCases(
          [
            {
              caseId: "case-acme-1",
              tenant: TENANT,
              capability: { capabilityId: EXECUTE_CAPABILITY.id, version: "1.2.0" },
              inputs: {},
              expected: "ok",
              description: "acme case",
              tags: [],
              source: "journey-f270b",
              submittedAtMs: NOW_MS,
            },
          ],
          TENANT,
        );
        if (!arenaIntake.ok) throw new Error("arena intake refused");
        const foreignCaseSet = assembleCaseSet(arenaIntake.cases, {
          tenant: FOREIGN_TENANT,
          capability: { capabilityId: EXECUTE_CAPABILITY.id, version: "1.2.0" },
          assembledAtMs: NOW_MS,
        });
        ctx.record("caseset.crossOk", foreignCaseSet.ok);
        ctx.record("caseset.crossCode", foreignCaseSet.ok ? "unexpected-allow" : foreignCaseSet.code);

        const remediation = proposeRemediationRecord({
          proposalId: "prop-tenant-1",
          tenantId: TENANT.tenantId,
          findingIds: ["finding-1"],
          remediationKind: "patch",
          at: NOW_MS,
        });
        if (!remediation.ok) throw new Error("remediation proposal refused");
        ctx.record("remediation.ownOk", remediation.ok);
      },
    },
  ],
  assertions: [
    { assertionId: "tf-1", description: "Foreign finding refuses the whole intake view (A8)", path: "views.crossOk", expected: false },
    { assertionId: "tf-2", description: "Refusal code names cross-tenant-finding", path: "views.crossRefused", expected: "views.cross-tenant-finding" },
    { assertionId: "tf-3", description: "The offending finding is named in the detail", path: "views.offenderNamed", expected: "finding-foreign" },
    { assertionId: "tf-4", description: "An empty tenant scope refuses (A8)", path: "views.missingOk", expected: false },
    { assertionId: "tf-5", description: "Missing-tenant refusal code", path: "views.missingRefused", expected: "views.missing-tenant" },
    { assertionId: "tf-6", description: "Posture is never returned cross-tenant", path: "posture.readOk", expected: false },
    { assertionId: "tf-7", description: "Posture refusal reason", path: "posture.readRefused", expected: "posture.tenant-mismatch" },
    { assertionId: "tf-7b", description: "The rival's own read still works (isolation, not corruption)", path: "posture.rivalOwnReadOk", expected: true },
    { assertionId: "tf-7c", description: "An empty posture read scope refuses (A8)", path: "posture.missingOk", expected: false },
    { assertionId: "tf-7d", description: "Posture missing-tenant refusal reason", path: "posture.missingRefused", expected: "posture.missing-tenant" },
    { assertionId: "tf-7e", description: "A foreign event inside our fold scope refuses the fold", path: "posture.foldCrossOk", expected: false },
    { assertionId: "tf-7f", description: "Fold refusal reason names tenant mismatch", path: "posture.foldCrossRefused", expected: "fold.tenant-mismatch" },
    { assertionId: "tf-8", description: "Cross-tenant queue submit refuses (A8)", path: "queue.crossOk", expected: false },
    { assertionId: "tf-9", description: "Queue refusal reason", path: "queue.crossRefused", expected: "submit.tenant-mismatch" },
    { assertionId: "tf-10", description: "Cross-tenant ledger append refuses (A8/A19)", path: "ledger.crossOk", expected: false },
    { assertionId: "tf-11", description: "Ledger refusal reason", path: "ledger.crossRefused", expected: "ledger.tenant-mismatch" },
    { assertionId: "tf-12", description: "Cross-tenant action advance refuses (A8)", path: "action.crossOk", expected: false },
    { assertionId: "tf-13", description: "Action advance refusal reason", path: "action.crossRefused", expected: "refused.tenant_mismatch" },
    { assertionId: "tf-14", description: "A foreign-tenant lifecycle open refuses (A8)", path: "adoption.crossOk", expected: false },
    { assertionId: "tf-15", description: "Adoption refusal code", path: "adoption.crossCode", expected: "cross-tenant-proposal" },
    { assertionId: "tf-16", description: "Assembling a foreign case set refuses (A8)", path: "caseset.crossOk", expected: false },
    { assertionId: "tf-17", description: "Case set refusal code", path: "caseset.crossCode", expected: "cross-tenant-case" },
    { assertionId: "tf-18", description: "Same-tenant remediation proposal succeeds (control)", path: "remediation.ownOk", expected: true },
  ],
};
