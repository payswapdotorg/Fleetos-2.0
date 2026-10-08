/**
 * Journey 10 — learn from outcomes (persona: ml-engineer).
 *
 * An ML engineer runs an arena evaluation and drives the learning adoption
 * lifecycle through the REAL packages:
 *   - arena case intake dedupes by digest and assembles a verified case set
 *     (@fleetos/arena);
 *   - the reference Arena adapter returns an ARENA_PROPOSAL — never an
 *     outcome, never an authorization (it stays a proposal);
 *   - the REAL learning evaluation aggregates outcomes across cases;
 *   - `proposeAdoption` returns a PROPOSAL (status pending) — adoption
 *     proceeds ONLY through Guardian review with a GuardianAuthorization
 *     INPUT, and completing adoption is evidence-gated;
 *   - a certification revocation CASCADE force-rejects dependent proposals
 *     that have not completed adoption (adopted records are skipped,
 *     history never rewritten).
 */

import type { AcceptanceJourney } from "../journey-contracts.ts";
import {
  assembleCaseSet,
  intakeCases,
  isArenaEvaluationProposal,
  makeReferenceArenaAdapter,
  verifyCaseSetDigest,
} from "@fleetos/arena";
import type { CaseIntakeCandidate } from "@fleetos/arena";
import {
  authorizeAdoption as authorizeLearning,
  beginGuardianReview,
  cascadeCertificationRevocation,
  completeAdoption,
  evaluateCapability,
  openAdoptionLifecycle,
  proposeAdoption,
} from "@fleetos/learning";
import type { EvaluationCase, OutcomeObservation } from "@fleetos/learning";
import { NOW_MS, TENANT, isoOfEpochMs } from "./fixture-world.ts";

const CAPABILITY_REF = { capabilityId: "fleetos.device.execute-command", version: "1.2.0" } as const;

function candidate(caseId: string, inputs: Readonly<Record<string, unknown>>, expected: string): CaseIntakeCandidate<string> {
  return {
    caseId,
    tenant: TENANT,
    capability: CAPABILITY_REF,
    inputs,
    expected,
    description: `Arena case ${caseId}`,
    tags: ["journey", "wave7b"],
    source: "journey-f270b",
    submittedAtMs: NOW_MS,
  };
}

function evaluationCases(): readonly EvaluationCase<string>[] {
  return [
    { caseId: "case-ack-1", tenant: { tenantId: TENANT.tenantId }, capability: CAPABILITY_REF, inputs: { assetId: "pump-7" }, expected: "ok", description: "ack 1", tags: [] },
    { caseId: "case-ack-2", tenant: { tenantId: TENANT.tenantId }, capability: CAPABILITY_REF, inputs: { assetId: "pump-8" }, expected: "ok", description: "ack 2", tags: [] },
    { caseId: "case-ack-3", tenant: { tenantId: TENANT.tenantId }, capability: CAPABILITY_REF, inputs: { assetId: "pump-9" }, expected: "ok", description: "ack 3 (no outcome yet)", tags: [] },
  ];
}

function outcomes(): readonly OutcomeObservation<string>[] {
  return [
    { observationId: "out-1", caseId: "case-ack-1", actual: "ok", observedAt: isoOfEpochMs(NOW_MS), observationRef: "obs-out-1", success: true },
    { observationId: "out-2", caseId: "case-ack-2", actual: "timeout", observedAt: isoOfEpochMs(NOW_MS), observationRef: "obs-out-2", success: false },
  ];
}

export const learningJourney: AcceptanceJourney = {
  journeyId: "security.learn-from-outcomes",
  persona: "ml-engineer",
  capabilities: ["learning-from-outcomes"],
  goal: "Run an arena evaluation and adopt a capability through the Guardian path",
  steps: [
    {
      stepId: "arena-intake-and-proposal",
      kind: "evaluation",
      description: "Intake arena cases, assemble the case set, request the evaluation proposal",
      packages: ["@fleetos/arena"],
      operations: ["intakeCases", "assembleCaseSet", "verifyCaseSetDigest", "makeReferenceArenaAdapter", "isArenaEvaluationProposal"],
      run: (ctx) => {
        const intake = intakeCases(
          [
            candidate("case-ack-1", { assetId: "pump-7" }, "ok"),
            candidate("case-ack-2", { assetId: "pump-8" }, "ok"),
            candidate("case-ack-2", { assetId: "pump-8" }, "ok"),
          ],
          TENANT,
        );
        if (!intake.ok) throw new Error(`intake refused: ${intake.code} (${intake.reason})`);
        ctx.record("arena.caseCount", intake.cases.length);
        ctx.record("arena.duplicates", intake.duplicates);
        const caseSet = assembleCaseSet(intake.cases, {
          tenant: TENANT,
          capability: CAPABILITY_REF,
          assembledAtMs: NOW_MS,
        });
        if (!caseSet.ok) throw new Error(`case set refused: ${caseSet.code}`);
        ctx.record("caseset.count", caseSet.caseSet.caseCount);
        ctx.record("caseset.digestVerifies", verifyCaseSetDigest(caseSet.caseSet));
        ctx.record("caseset.sources", caseSet.caseSet.sources);
        const adapter = makeReferenceArenaAdapter();
        const proposal = adapter.evaluate({
          tenant: TENANT,
          capability: CAPABILITY_REF,
          cases: intake.cases.map((c) => ({
            caseId: c.caseId,
            tenant: { tenantId: c.tenantId },
            capability: c.capability,
            inputs: c.inputs,
            expected: c.expected,
            description: c.description,
            tags: [...c.tags],
          })),
          requester: "ml-engineer-sam",
          requestedAt: isoOfEpochMs(NOW_MS),
        });
        ctx.record("proposal.kind", proposal.kind);
        ctx.record("proposal.isProposal", isArenaEvaluationProposal(proposal));
        ctx.record("proposal.caseIds", proposal.caseIds);
        ctx.record(
          "proposal.hasSubmitMethod",
          "submit" in (adapter as unknown as Record<string, unknown>) || "adopt" in (adapter as unknown as Record<string, unknown>),
        );
      },
    },
    {
      stepId: "evaluation-and-adoption",
      kind: "lifecycle",
      description: "Evaluate outcomes and drive the adoption lifecycle through Guardian review",
      packages: ["@fleetos/learning"],
      operations: ["evaluateCapability", "proposeAdoption", "openAdoptionLifecycle", "beginGuardianReview", "authorizeAdoption", "completeAdoption"],
      run: (ctx) => {
        const evaluation = evaluateCapability(evaluationCases(), outcomes(), { tenantId: TENANT.tenantId }, CAPABILITY_REF, isoOfEpochMs(NOW_MS));
        ctx.record("eval.totalCases", evaluation.totalCases);
        ctx.record("eval.successes", evaluation.successes);
        ctx.record("eval.failures", evaluation.failures);
        ctx.record("eval.outcomeRefs", evaluation.outcomeRefs);
        const proposal = proposeAdoption({
          tenant: { tenantId: TENANT.tenantId },
          capability: CAPABILITY_REF,
          evaluation,
          proposedBy: "ml-engineer-sam",
          rationale: "2/3 observed outcomes succeeded",
          proposedAt: isoOfEpochMs(NOW_MS),
        });
        ctx.record("adoption.initialStatus", proposal.status);
        const lifecycle = openAdoptionLifecycle({
          tenant: { tenantId: TENANT.tenantId },
          proposal,
          certificationId: "cert-arena-77",
          openedAtMs: NOW_MS,
        });
        if (!lifecycle.ok) throw new Error(`lifecycle refused: ${lifecycle.code} (${lifecycle.reason})`);
        ctx.record("adoption.initialStage", lifecycle.record.stage);
        const prematureComplete = completeAdoption(lifecycle.record, "evidence-1", NOW_MS);
        ctx.record("adoption.prematureCompleteOk", prematureComplete.ok);
        ctx.record("adoption.prematureCompleteCode", prematureComplete.ok ? "unexpected" : prematureComplete.code);
        const unauthorized = authorizeLearning(lifecycle.record, {
          guardianDecisionId: "gd-1",
          decidedAtMs: NOW_MS,
          authorizedBy: "guardian-reference",
          decisionDigest: "digest-gd-1",
        }, NOW_MS);
        ctx.record("adoption.authorizeFromProposedOk", unauthorized.ok);
        ctx.record("adoption.authorizeFromProposedCode", unauthorized.ok ? "unexpected" : unauthorized.code);
        const reviewed = beginGuardianReview(lifecycle.record, NOW_MS);
        if (!reviewed.ok) throw new Error(`review refused: ${reviewed.code}`);
        ctx.record("adoption.reviewStage", reviewed.record.stage);
        const authorized = authorizeLearning(reviewed.record, {
          guardianDecisionId: "gd-1",
          decidedAtMs: NOW_MS,
          authorizedBy: "guardian-reference",
          decisionDigest: "digest-gd-1",
        }, NOW_MS + 1_000);
        if (!authorized.ok) throw new Error(`authorize refused: ${authorized.code}`);
        ctx.record("adoption.authorizedStage", authorized.record.stage);
        ctx.record("adoption.authorizedProposalStatus", authorized.record.proposal.status);
        const evidenceMissing = completeAdoption(authorized.record, "", NOW_MS);
        ctx.record("adoption.emptyEvidenceOk", evidenceMissing.ok);
        ctx.record("adoption.emptyEvidenceCode", evidenceMissing.ok ? "unexpected" : evidenceMissing.code);
        const adopted = completeAdoption(authorized.record, "evidence-adoption-1", NOW_MS + 2_000);
        if (!adopted.ok) throw new Error(`complete refused: ${adopted.code}`);
        ctx.record("adoption.finalStage", adopted.record.stage);
        ctx.record("adoption.evidenceRef", adopted.record.adoptionEvidenceRef);

        const secondProposal = proposeAdoption({
          tenant: { tenantId: TENANT.tenantId },
          capability: { capabilityId: "fleetos.asset.read-state", version: "1.0.0" },
          evaluation,
          proposedBy: "ml-engineer-sam",
          rationale: "second dependent proposal",
          proposedAt: isoOfEpochMs(NOW_MS),
        });
        const secondLifecycle = openAdoptionLifecycle({
          tenant: { tenantId: TENANT.tenantId },
          proposal: secondProposal,
          certificationId: "cert-arena-77",
          openedAtMs: NOW_MS,
        });
        if (!secondLifecycle.ok) throw new Error(`second lifecycle refused: ${secondLifecycle.code}`);
        const secondReviewed = beginGuardianReview(secondLifecycle.record, NOW_MS);
        if (!secondReviewed.ok) throw new Error(`second review refused: ${secondReviewed.code}`);
        const cascade = cascadeCertificationRevocation(
          [adopted.record, secondReviewed.record],
          {
            certificationId: "cert-arena-77",
            tenantId: TENANT.tenantId,
            reason: "evaluation-fraud",
            revokedAtMs: NOW_MS + 3_000,
            revocationDigest: "digest-revoke-1",
          },
        );
        if (!cascade.ok) throw new Error(`cascade refused: ${cascade.code} (${cascade.reason})`);
        ctx.record("cascade.rejected", cascade.rejected);
        ctx.record("cascade.rejectedStage", cascade.records[1]?.stage ?? "none");
        ctx.record("cascade.rejectedReasonCode", cascade.records[1]?.rejection?.reasonCode ?? "none");
        ctx.record("cascade.skipped", cascade.skipped.map((s) => s.stage));
        ctx.record("cascade.adoptedUnchanged", cascade.records[0]?.stage ?? "none");
      },
    },
  ],
  assertions: [
    { assertionId: "lr-1", description: "Duplicate arena case dropped by digest", path: "arena.caseCount", expected: 2 },
    { assertionId: "lr-2", description: "Duplicate case id named", path: "arena.duplicates", expected: ["case-ack-2"] },
    { assertionId: "lr-3", description: "Case set assembled with both cases", path: "caseset.count", expected: 2 },
    { assertionId: "lr-4", description: "Case set digest verifies (two levels)", path: "caseset.digestVerifies", expected: true },
    { assertionId: "lr-5", description: "Provenance sources carried", path: "caseset.sources", expected: ["journey-f270b"] },
    { assertionId: "lr-6", description: "Arena returns a PROPOSAL, never an outcome", path: "proposal.kind", expected: "ARENA_PROPOSAL" },
    { assertionId: "lr-7", description: "Runtime guard accepts the proposal marker", path: "proposal.isProposal", expected: true },
    { assertionId: "lr-8", description: "Proposal covers the case ids", path: "proposal.caseIds", expected: ["case-ack-1", "case-ack-2"] },
    { assertionId: "lr-9", description: "The adapter has NO submit/adopt method", path: "proposal.hasSubmitMethod", expected: false },
    { assertionId: "lr-10", description: "Evaluation covers all three cases", path: "eval.totalCases", expected: 3 },
    { assertionId: "lr-11", description: "Observed successes counted", path: "eval.successes", expected: 1 },
    { assertionId: "lr-12", description: "Observed failure counted honestly", path: "eval.failures", expected: 2 },
    { assertionId: "lr-13", description: "Outcome refs carried for scored cases only", path: "eval.outcomeRefs", expected: ["obs-out-1", "obs-out-2"] },
    { assertionId: "lr-14", description: "A proposal stays a proposal (pending)", path: "adoption.initialStatus", expected: "pending" },
    { assertionId: "lr-15", description: "Lifecycle opens at the proposed stage", path: "adoption.initialStage", expected: "proposed" },
    { assertionId: "lr-16", description: "Adoption cannot complete before Guardian authorization", path: "adoption.prematureCompleteOk", expected: false },
    { assertionId: "lr-17", description: "Refusal code for premature completion", path: "adoption.prematureCompleteCode", expected: "illegal-transition" },
    { assertionId: "lr-18", description: "Adoption cannot be authorized straight from proposed", path: "adoption.authorizeFromProposedOk", expected: false },
    { assertionId: "lr-19", description: "Guardian review is mandatory first", path: "adoption.authorizeFromProposedCode", expected: "illegal-transition" },
    { assertionId: "lr-20", description: "Lifecycle reaches guardian-review", path: "adoption.reviewStage", expected: "guardian-review" },
    { assertionId: "lr-21", description: "Guardian INPUT authorizes the adoption", path: "adoption.authorizedStage", expected: "authorized" },
    { assertionId: "lr-22", description: "The wrapped proposal flips to authorized", path: "adoption.authorizedProposalStatus", expected: "authorized" },
    { assertionId: "lr-23", description: "Completion without evidence refused", path: "adoption.emptyEvidenceOk", expected: false },
    { assertionId: "lr-24", description: "Evidence-gate refusal code", path: "adoption.emptyEvidenceCode", expected: "missing-adoption-evidence" },
    { assertionId: "lr-25", description: "Evidence-gated adoption completes", path: "adoption.finalStage", expected: "adopted" },
    { assertionId: "lr-26", description: "Adoption evidence ref recorded", path: "adoption.evidenceRef", expected: "evidence-adoption-1" },
    { assertionId: "lr-27", description: "Cascade rejects the dependent review-stage proposal", path: "cascade.rejected", expected: ["prop-fleetos.asset.read-state-1.0.0-acme-ops"] },
    { assertionId: "lr-28", description: "Rejected record lands in the rejected stage", path: "cascade.rejectedStage", expected: "rejected" },
    { assertionId: "lr-29", description: "Cascade names certification-revoked", path: "cascade.rejectedReasonCode", expected: "certification-revoked" },
    { assertionId: "lr-30", description: "The already-adopted record is skipped, not rewritten", path: "cascade.skipped", expected: ["adopted"] },
    { assertionId: "lr-31", description: "Adopted record unchanged by the cascade", path: "cascade.adoptedUnchanged", expected: "adopted" },
  ],
};
