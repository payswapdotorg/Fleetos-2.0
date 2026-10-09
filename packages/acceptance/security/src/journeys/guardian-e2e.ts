/**
 * Journey 14 — the Guardian journey, end to end (F300B deliverable 2;
 * persona: tenant-operator): finding -> evidence -> Guardian decision ->
 * authorized action intent -> execution result -> verification + audit
 * trail, EVERY leg through REAL public APIs. Negative fixtures: a BLOCKED
 * decision cannot authorize a command (`refused.block_verdict`); cross-
 * tenant policy BLOCKED (A8); an unmatched capability denied fail-closed
 * (`block.no_matching_rule`); a tampered ledger entry fails verification.
 * Remediation advances only through its evidence gates; the incident
 * audit trail seals decision + emissions + entries. Composition in
 * ./wave10-world.ts (file law).
 */

import type { AcceptanceJourney } from "../journey-contracts.ts";
import { runFindingIntake, proposeRemediationRecord, advanceRemediation, verifyRemediationHistory } from "@fleetos/security";
import type { FindingIntakeCandidate, RemediationProposalRecord } from "@fleetos/security";
import { appendEvidence, buildCompleteChain, verifyEvidenceChain } from "@fleetos/evidence";
import type { EvidenceChainEntry, TraceabilityChain } from "@fleetos/evidence";
import {
  authorizeCommand,
  commandFromAuthorized,
  ackCommand,
  buildIncidentAuditTrail,
  completeCommand,
  createCommandQueue,
  submitCommand,
  verifyExecutionLedger,
  verifyIncidentAuditTrail,
} from "@fleetos/execution";
import type { CommandQueueState, ExecutionLedgerEntry } from "@fleetos/execution";
import { emitAuditTrail } from "@fleetos/actions";
import {
  buildDecisionAuditRef,
  buildDecisionRecord,
  evaluateCapability,
  evaluateRulesOrdered,
} from "@fleetos/policy";
import { requestRemediation } from "@fleetos/experience-safety-intel";
import {
  ANALYST_CTX,
  BASE_MS,
  EXECUTE_CAPABILITY,
  IRREVERSIBLE_CAPABILITY,
  NOW_MS,
  OPERATOR_CTX,
  READ_CAPABILITY,
  STALENESS_THRESHOLDS,
  TENANT,
  FOREIGN_TENANT,
  isoOfEpochMs,
  tenantPolicy,
} from "./fixture-world.ts";
import { UNMATCHED_CAPABILITY, appendLed, e2eActionChain } from "./wave10-world.ts";

const INTENT_ID = "intent-guardian-e2e-1";
const QUEUE_KEY = "guardian-e2e-command-1";

export const guardianE2eJourney: AcceptanceJourney = {
  journeyId: "security.guardian-e2e",
  persona: "tenant-operator",
  capabilities: ["guardian-e2e-authorization", "guardian-decision", "understand-evidence", "execution-ledger"],
  goal: "Drive one finding from intake to verified, Guardian-authorized remediation with a sealed audit trail",
  steps: [
    {
      stepId: "finding-intake",
      kind: "intake",
      description: "Intake the detector finding through the REAL security pipeline",
      packages: ["@fleetos/security"],
      operations: ["runFindingIntake"],
      run: (ctx) => {
        const candidates: readonly FindingIntakeCandidate[] = [
          {
            tenantId: TENANT.tenantId, kind: "auth.weak_credential", declaredSeverity: "high", confidence: "confirmed",
            detectedAt: BASE_MS + 10_000, assetIds: ["pump-7"], description: "Weak operator credential on pump-7 control plane",
            evidenceRefs: ["ev-intake-e2e-1"], signalCount: 4,
          },
        ];
        const result = runFindingIntake(candidates, { correlationWindowMs: 120_000 });
        if (result.admitted.length !== 1) throw new Error(`expected 1 admitted finding, got ${result.admitted.length}`);
        const admitted = result.admitted[0]!;
        ctx.record("finding.admitted", result.metrics.admitted);
        ctx.record("finding.severity", admitted.severity);
        ctx.record("finding.kind", admitted.kind);
        ctx.record("finding.confidence", admitted.confidence);
        ctx.record("finding.evidenceRefs", [...admitted.evidenceRefs]);
      },
    },
    {
      stepId: "evidence-chain",
      kind: "evidence",
      description: "Seal the A13 traceability chain and the evidence chain through the REAL evidence package",
      packages: ["@fleetos/evidence"],
      operations: ["buildCompleteChain", "appendEvidence", "verifyEvidenceChain"],
      run: (ctx) => {
        const trace: TraceabilityChain = buildCompleteChain({
          tenantId: TENANT.tenantId,
          actorId: "operator-ada",
          intentRef: INTENT_ID,
          authorizationRef: "digest-auth-e2e",
          executionRef: QUEUE_KEY,
          verificationRef: "ev-verification-e2e",
          capabilityId: EXECUTE_CAPABILITY.id,
          capabilityVersion: EXECUTE_CAPABILITY.version,
          recordedAt: isoOfEpochMs(NOW_MS),
        });
        let chain: readonly EvidenceChainEntry[] = [];
        chain = appendEvidence(chain, { evidenceId: "ev-intake-e2e-1", tenantId: TENANT.tenantId, recordedAt: isoOfEpochMs(NOW_MS) });
        chain = appendEvidence(chain, { evidenceId: "ev-verification-e2e", tenantId: TENANT.tenantId, recordedAt: isoOfEpochMs(NOW_MS + 6_000) });
        const verification = verifyEvidenceChain(chain);
        ctx.record("evidence.traceLinkCount", trace.links.length);
        ctx.record("evidence.chainEntryCount", chain.length);
        ctx.record("evidence.chainVerified", verification.verified);
        ctx.record("evidence.chainDigestLength", (chain[0]?.entryDigest ?? "").length);
      },
    },
    {
      stepId: "guardian-decision",
      kind: "guardian-decision",
      description: "Adjudicate through the REAL Guardian: allow path authorized, refusal paths visible and non-authorizable",
      packages: ["@fleetos/policy", "@fleetos/execution"],
      operations: ["evaluateCapability", "evaluateRulesOrdered", "buildDecisionAuditRef", "buildDecisionRecord", "authorizeCommand"],
      run: (ctx) => {
        const policy = tenantPolicy();
        const read = evaluateCapability(policy, READ_CAPABILITY, ANALYST_CTX(READ_CAPABILITY));
        const irreversible = evaluateCapability(policy, IRREVERSIBLE_CAPABILITY, OPERATOR_CTX(IRREVERSIBLE_CAPABILITY));
        const cross = evaluateCapability(tenantPolicy(FOREIGN_TENANT.tenantId), READ_CAPABILITY, ANALYST_CTX(READ_CAPABILITY));
        const unmatched = evaluateCapability(policy, UNMATCHED_CAPABILITY, OPERATOR_CTX(UNMATCHED_CAPABILITY));
        ctx.record("guardian.read.verdict", read.verdict);
        ctx.record("guardian.irreversible.verdict", irreversible.verdict);
        ctx.record("guardian.irreversible.reason", irreversible.reasonCode);
        ctx.record("guardian.cross.verdict", cross.verdict);
        ctx.record("guardian.cross.reason", cross.reasonCode);
        ctx.record("guardian.unmatched.verdict", unmatched.verdict);
        ctx.record("guardian.unmatched.reason", unmatched.reasonCode);

        // The authorized command — the ONLY constructor of AuthorizedCommand.
        const authorized = authorizeCommand(read, { capabilityId: READ_CAPABILITY.id, inputs: { assetId: "pump-7" } }, TENANT, undefined, QUEUE_KEY);
        if (!authorized.ok) throw new Error(`authorization refused: ${authorized.reason}`);
        ctx.record("authorize.ok", true);
        ctx.record("authorize.verdict", authorized.command.verdict);
        ctx.record("authorize.digestMatchesDecision", authorized.command.authorizationDigest === read.decisionDigest);
        ctx.record("authorize.idempotencyKey", authorized.command.idempotencyKey);

        // NEGATIVE: a BLOCKED decision can never become a command.
        const blocked = authorizeCommand(irreversible, { capabilityId: IRREVERSIBLE_CAPABILITY.id, inputs: { assetId: "pump-7" } }, TENANT, undefined, "guardian-e2e-blocked");
        ctx.record("authorize.blockedOk", blocked.ok);
        ctx.record("authorize.blockedReason", blocked.ok ? "unexpected" : blocked.reason);

        // The reasoning trace: ordered evaluation + decision record + audit ref.
        const ordered = evaluateRulesOrdered(policy, EXECUTE_CAPABILITY, OPERATOR_CTX(EXECUTE_CAPABILITY));
        if (!ordered.ok) throw new Error(`ordered evaluation refused: ${ordered.reason}`);
        const audit = buildDecisionAuditRef(ordered.evaluation, NOW_MS);
        if (!audit.ok) throw new Error("audit ref refused");
        const executeDecision = evaluateCapability(policy, EXECUTE_CAPABILITY, OPERATOR_CTX(EXECUTE_CAPABILITY));
        const record = buildDecisionRecord(executeDecision, {
          policyId: policy.id, policyVersion: policy.version, capability: EXECUTE_CAPABILITY, actorId: "operator-ada",
          actorIsAutonomous: false, actorAuthority: ["tenant.operator", "human.approval", "asset.owner"],
          evaluatedAt: isoOfEpochMs(NOW_MS), matchedFacts: ordered.evaluation.decisions[0]?.matchedFacts ?? [],
        });
        ctx.record("guardian.ordered.decisionCount", ordered.evaluation.decisions.length);
        ctx.record("guardian.ordered.resolution", ordered.evaluation.resolution.verdict);
        ctx.record("guardian.auditRef.resolvedVerdict", audit.ref.resolvedVerdict);
        ctx.record("guardian.auditRef.evaluatedAt", audit.ref.evaluatedAt);
        ctx.record("guardian.decisionRecord.idPrefix", record.recordId.startsWith("rec-fleetos.device.execute-command-"));
        ctx.record("guardian.decisionRecord.digestLength", record.recordDigest.length);
      },
    },
    {
      stepId: "intent-execution",
      kind: "queue",
      description: "Submit the inert intent draft through the submit seam and drive the authorized command to completion",
      packages: ["@fleetos/experience-safety-intel", "@fleetos/execution", "@fleetos/actions"],
      operations: ["requestRemediation", "submitCommand", "commandFromAuthorized", "ackCommand", "completeCommand", "e2eActionChain"],
      run: (ctx) => {
        // The INERT intent draft (host intent catalog builder) — a value,
        // never an execution; its seam fields submit into the REAL queue.
        const draft = requestRemediation({
          intentId: INTENT_ID, tenantId: TENANT.tenantId, actorId: "operator-ada",
          requiredCapabilityId: "fleetos.security.remediation", reason: "rotate the weak credential admitted by intake",
          issuedAt: NOW_MS, proposalId: "prop-guardian-e2e-1", findingIds: ["finding-e2e-1"], remediationKind: "rotate_credential",
        });
        if (!draft.ok) throw new Error(`draft refused: ${draft.refused}`);
        ctx.record("intent.draft", draft.draft.intent.draft);
        ctx.record("intent.kind", draft.draft.kind);
        ctx.record("intent.hasAuthorizationField", "authorization" in draft.draft);

        const queue = createCommandQueue(TENANT.tenantId);
        if (!queue.ok) throw new Error("queue creation refused");
        let state: CommandQueueState = queue.state;
        const draftSubmit = submitCommand(state, {
          idempotencyKey: draft.draft.idempotencyKey, capabilityId: draft.draft.intent.requiredCapabilityId,
          payloadInputs: draft.draft.payload as Record<string, unknown>, at: draft.draft.issuedAt, tenantId: draft.draft.intent.tenantId,
        });
        if (!draftSubmit.ok) throw new Error("draft submit refused");
        state = draftSubmit.state;
        const duplicate = submitCommand(state, {
          idempotencyKey: draft.draft.idempotencyKey, capabilityId: draft.draft.intent.requiredCapabilityId,
          payloadInputs: {}, at: NOW_MS + 1_000, tenantId: TENANT.tenantId,
        });
        if (!duplicate.ok) throw new Error("duplicate submit refused");
        ctx.record("intent.submittedStatus", draftSubmit.command.status);
        ctx.record("intent.duplicateNoOp", duplicate.duplicate);

        // The authorized command path: Guardian decision -> AuthorizedCommand
        // -> queue submit -> ack -> complete.
        const decision = evaluateCapability(tenantPolicy(), READ_CAPABILITY, ANALYST_CTX(READ_CAPABILITY));
        const authorized = authorizeCommand(decision, { capabilityId: READ_CAPABILITY.id, inputs: { assetId: "pump-7" } }, TENANT, undefined, QUEUE_KEY);
        if (!authorized.ok) throw new Error(`authorization refused: ${authorized.reason}`);
        const submitInput = commandFromAuthorized(authorized.command, NOW_MS);
        const submitted = submitCommand(state, {
          idempotencyKey: submitInput.idempotencyKey, capabilityId: submitInput.capabilityId, payloadInputs: submitInput.payloadInputs,
          at: submitInput.at, tenantId: submitInput.tenantId, authorizationDigest: authorized.command.authorizationDigest,
          verdict: authorized.command.verdict,
        });
        if (!submitted.ok) throw new Error("authorized submit refused");
        state = submitted.state;
        const acked = ackCommand(state, QUEUE_KEY, NOW_MS + 1_000, TENANT.tenantId);
        if (!acked.ok) throw new Error("ack refused");
        state = acked.state;
        const completed = completeCommand(state, QUEUE_KEY, { state: "ok" }, NOW_MS + 2_000, TENANT.tenantId);
        if (!completed.ok) throw new Error("complete refused");
        state = completed.state;
        ctx.record("execution.finalStatus", completed.command.status);
        ctx.record("execution.completedAt", completed.command.completedAt);
        ctx.record("execution.queueCommandCount", state.commands.length);

        // The action chain carries the execution + verification records.
        const action = e2eActionChain(INTENT_ID, "e2e-1", QUEUE_KEY);
        ctx.record("action.finalState", action.state);
        ctx.record("action.executedSucceeded", action.executionResult?.succeeded ?? false);
        ctx.record("action.verificationVerified", action.verificationRecord?.verified ?? false);
        ctx.record("action.verificationKind", action.verificationRecord?.verifierKind ?? "none");
      },
    },
    {
      stepId: "verification-audit",
      kind: "ledger",
      description: "Advance the remediation through its evidence gates and seal the incident audit trail",
      packages: ["@fleetos/security", "@fleetos/execution", "@fleetos/actions", "@fleetos/policy"],
      operations: ["proposeRemediationRecord", "advanceRemediation", "verifyRemediationHistory", "verifyExecutionLedger", "emitAuditTrail", "buildIncidentAuditTrail", "verifyIncidentAuditTrail"],
      run: (ctx) => {
        // Remediation: evidence-gated lifecycle (never auto-done).
        const proposed = proposeRemediationRecord({
          proposalId: "prop-guardian-e2e-1",
          tenantId: TENANT.tenantId,
          findingIds: ["finding-e2e-1"],
          remediationKind: "rotate_credential",
          at: NOW_MS,
        });
        if (!proposed.ok) throw new Error(`remediation proposal refused: ${proposed.reason}`);
        let remediation: RemediationProposalRecord = proposed.record;
        const gates: readonly [RemediationProposalRecord["state"], Parameters<typeof advanceRemediation>[2]][] = [
          ["approved", { tenantId: TENANT.tenantId, actorId: "operator-ada", at: NOW_MS + 4_000, approvalRef: "audit-e2e-1" }],
          ["applied", { tenantId: TENANT.tenantId, actorId: "operator-ada", at: NOW_MS + 5_000, verificationEvidenceRef: "ev-verification-e2e" }],
          ["verified", { tenantId: TENANT.tenantId, actorId: "operator-ada", at: NOW_MS + 6_000, verificationOutcome: { verified: true, evidenceRef: "ev-verification-e2e" } }],
        ];
        for (const [target, advanceCtx] of gates) {
          const result = advanceRemediation(remediation, target, advanceCtx);
          if (!result.ok) throw new Error(`remediation advance to ${target} refused: ${result.reason}`);
          remediation = result.record;
        }
        const postMortem = verifyRemediationHistory(remediation);
        ctx.record("remediation.finalState", remediation.state);
        ctx.record("remediation.verifiedOutcome", remediation.verificationOutcome?.verified ?? false);
        ctx.record("remediation.postMortemOk", postMortem.ok);

        // The execution ledger + its verification.
        let ledger: readonly ExecutionLedgerEntry[] = [];
        ledger = appendLed(ledger, { tenantId: TENANT.tenantId, idempotencyKey: QUEUE_KEY, kind: "submitted", at: NOW_MS, detail: "" });
        ledger = appendLed(ledger, { tenantId: TENANT.tenantId, idempotencyKey: QUEUE_KEY, kind: "acked", at: NOW_MS + 1_000, detail: "" });
        ledger = appendLed(ledger, { tenantId: TENANT.tenantId, idempotencyKey: QUEUE_KEY, kind: "completed", at: NOW_MS + 2_000, detail: "state=ok" });
        const verified = verifyExecutionLedger(ledger);
        ctx.record("audit.ledgerVerified", verified.verified);
        ctx.record("audit.ledgerEntries", ledger.length);

        // The incident audit trail: Guardian decision + action emissions +
        // execution entries sealed into ONE tamper-evident chain.
        const policy = tenantPolicy();
        const ordered = evaluateRulesOrdered(policy, EXECUTE_CAPABILITY, OPERATOR_CTX(EXECUTE_CAPABILITY));
        if (!ordered.ok) throw new Error("ordered evaluation refused");
        const decisionRecord = buildDecisionRecord(evaluateCapability(policy, READ_CAPABILITY, ANALYST_CTX(READ_CAPABILITY)), {
          policyId: policy.id, policyVersion: policy.version, capability: READ_CAPABILITY, actorId: "analyst-kim",
          actorIsAutonomous: false, actorAuthority: ["tenant.engineer"], evaluatedAt: isoOfEpochMs(NOW_MS),
          matchedFacts: ordered.evaluation.decisions[0]?.matchedFacts ?? [],
        });
        const emissions = emitAuditTrail(e2eActionChain(INTENT_ID, "e2e-1", QUEUE_KEY), "operator-ada");
        const trail = buildIncidentAuditTrail({
          tenantId: TENANT.tenantId,
          decisions: [{ record: decisionRecord, atMs: NOW_MS }],
          emissions,
          entries: [...ledger],
        });
        if (!trail.ok) throw new Error(`incident trail refused: ${trail.reason}`);
        const trailVerified = verifyIncidentAuditTrail(trail.trail);
        ctx.record("audit.trailEvents", trail.trail.length);
        ctx.record("audit.trailVerified", trailVerified.verified);

        // NEGATIVE: a tampered ledger entry is caught with the break named.
        const tampered = [...ledger];
        (tampered[1] as { detail: string }).detail = "forged";
        const tamperCheck = verifyExecutionLedger(tampered);
        ctx.record("audit.tamperedVerified", tamperCheck.verified);
        ctx.record("audit.tamperedBrokenAt", tamperCheck.brokenAt);
        ctx.record("audit.tamperedReason", tamperCheck.reason);

        // Staleness thresholds surface (honesty: logical constants only).
        ctx.record("audit.thresholdsFreshWithin", STALENESS_THRESHOLDS.freshWithinMs);
      },
    },
  ],
  assertions: [
    { assertionId: "ge-1", description: "One finding admitted by the REAL intake", path: "finding.admitted", expected: 1 },
    { assertionId: "ge-2", description: "High severity carried through", path: "finding.severity", expected: "high" },
    { assertionId: "ge-3", description: "Weak-credential kind carried through", path: "finding.kind", expected: "auth.weak_credential" },
    { assertionId: "ge-4", description: "Confirmed confidence", path: "finding.confidence", expected: "confirmed" },
    { assertionId: "ge-5", description: "Intake evidence refs carried", path: "finding.evidenceRefs", expected: ["ev-intake-e2e-1"] },
    { assertionId: "ge-6", description: "A13 traceability chain carries all six links", path: "evidence.traceLinkCount", expected: 6 },
    { assertionId: "ge-7", description: "Evidence chain holds two entries", path: "evidence.chainEntryCount", expected: 2 },
    { assertionId: "ge-8", description: "Evidence chain verifies", path: "evidence.chainVerified", expected: true },
    { assertionId: "ge-9", description: "Evidence entry digests are sha-256 64-hex (the evidence package convention)", path: "evidence.chainDigestLength", expected: 64 },
    { assertionId: "ge-10", description: "Low-risk read allowed by the Guardian", path: "guardian.read.verdict", expected: "ALLOW" },
    { assertionId: "ge-11", description: "Irreversible action BLOCKED (visible refusal)", path: "guardian.irreversible.verdict", expected: "BLOCK" },
    { assertionId: "ge-12", description: "The block reason names the fail-closed policy", path: "guardian.irreversible.reason", expected: "block.policy_fail_closed" },
    { assertionId: "ge-13", description: "Cross-tenant policy BLOCKED (A8)", path: "guardian.cross.verdict", expected: "BLOCK" },
    { assertionId: "ge-14", description: "Cross-tenant refusal reason", path: "guardian.cross.reason", expected: "block.cross_tenant" },
    { assertionId: "ge-15", description: "Unmatched capability denied fail-closed (capability-denial path)", path: "guardian.unmatched.verdict", expected: "BLOCK" },
    { assertionId: "ge-16", description: "Denial reason: no matching rule", path: "guardian.unmatched.reason", expected: "block.no_matching_rule" },
    { assertionId: "ge-17", description: "The ALLOW decision authorizes a command", path: "authorize.ok", expected: true },
    { assertionId: "ge-18", description: "Authorized command carries the verdict", path: "authorize.verdict", expected: "ALLOW" },
    { assertionId: "ge-19", description: "Authorization digest is the decision digest (no invented authority)", path: "authorize.digestMatchesDecision", expected: true },
    { assertionId: "ge-20", description: "Idempotency key carried on the command", path: "authorize.idempotencyKey", expected: QUEUE_KEY },
    { assertionId: "ge-21", description: "A BLOCKED decision cannot authorize a command (Guardian never bypassed)", path: "authorize.blockedOk", expected: false },
    { assertionId: "ge-22", description: "Block refusal reason", path: "authorize.blockedReason", expected: "refused.block_verdict" },
    { assertionId: "ge-23", description: "Ordered evaluation yields the operator trace", path: "guardian.ordered.decisionCount", expected: 1 },
    { assertionId: "ge-24", description: "Resolution escalates high risk to approval", path: "guardian.ordered.resolution", expected: "REQUIRE_APPROVAL" },
    { assertionId: "ge-25", description: "Audit ref carries the resolved verdict", path: "guardian.auditRef.resolvedVerdict", expected: "REQUIRE_APPROVAL" },
    { assertionId: "ge-26", description: "Audit ref time is the logical now", path: "guardian.auditRef.evaluatedAt", expected: 1791831000000 },
    { assertionId: "ge-27", description: "Decision record id derived from the capability + digest", path: "guardian.decisionRecord.idPrefix", expected: true },
    { assertionId: "ge-28", description: "Decision record digest is FNV-1a 8-hex", path: "guardian.decisionRecord.digestLength", expected: 8 },
    { assertionId: "ge-29", description: "The intent draft is machine-carried inert", path: "intent.draft", expected: true },
    { assertionId: "ge-30", description: "Draft kind is the remediation request", path: "intent.kind", expected: "security.remediation.request" },
    { assertionId: "ge-31", description: "The draft carries NO authorization surface", path: "intent.hasAuthorizationField", expected: false },
    { assertionId: "ge-32", description: "Draft submit lands in the REAL queue as queued", path: "intent.submittedStatus", expected: "queued" },
    { assertionId: "ge-33", description: "Duplicate draft submit is an idempotent no-op", path: "intent.duplicateNoOp", expected: true },
    { assertionId: "ge-34", description: "Authorized command completes", path: "execution.finalStatus", expected: "completed" },
    { assertionId: "ge-35", description: "Completion time recorded", path: "execution.completedAt", expected: 1791831002000 },
    { assertionId: "ge-36", description: "Queue holds both commands (draft + authorized)", path: "execution.queueCommandCount", expected: 2 },
    { assertionId: "ge-37", description: "Action reached the recorded state", path: "action.finalState", expected: "recorded" },
    { assertionId: "ge-38", description: "Execution result succeeded (recorded, not asserted by an agent)", path: "action.executedSucceeded", expected: true },
    { assertionId: "ge-39", description: "Verification record verified", path: "action.verificationVerified", expected: true },
    { assertionId: "ge-40", description: "Verifier kind is the domain read", path: "action.verificationKind", expected: "domain.read" },
    { assertionId: "ge-41", description: "Remediation reached verified through its evidence gates", path: "remediation.finalState", expected: "verified" },
    { assertionId: "ge-42", description: "Verification outcome recorded on the remediation", path: "remediation.verifiedOutcome", expected: true },
    { assertionId: "ge-43", description: "Post-mortem walk finds a consistent history", path: "remediation.postMortemOk", expected: true },
    { assertionId: "ge-44", description: "Execution ledger verifies", path: "audit.ledgerVerified", expected: true },
    { assertionId: "ge-45", description: "Three ledger entries (one per operation)", path: "audit.ledgerEntries", expected: 3 },
    { assertionId: "ge-46", description: "Incident audit trail seals decision + emissions + entries", path: "audit.trailEvents", expected: 11 },
    { assertionId: "ge-47", description: "Incident audit trail verifies", path: "audit.trailVerified", expected: true },
    { assertionId: "ge-48", description: "Tampered ledger entry fails verification", path: "audit.tamperedVerified", expected: false },
    { assertionId: "ge-49", description: "Break located at the tampered index", path: "audit.tamperedBrokenAt", expected: 1 },
    { assertionId: "ge-50", description: "Tamper reason names the digest mismatch", path: "audit.tamperedReason", expected: "ledger.entry_digest_mismatch" },
    { assertionId: "ge-51", description: "Logical staleness constants carried (no wall clock)", path: "audit.thresholdsFreshWithin", expected: 10000 },
  ],
};
