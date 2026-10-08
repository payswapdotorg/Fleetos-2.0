/**
 * Journey 9 — inspect why it happened (persona: compliance-auditor).
 *
 * An auditor asks "why did this action happen?" over a FULL A4 chain built
 * through the REAL packages: propose -> authorize (REAL Guardian decision)
 * -> confirm -> dispatch -> execute -> verify -> record, an execution
 * ledger slice, a capability grant and an A13 traceability chain. The REAL
 * decision-provenance view links them end-to-end:
 *   - guardian block (verdict + decision digest), reason chain (per-rule),
 *     grants, journal slice (per-entry digests), evidence refs;
 *   - an UNAUTHORIZED action is presented with `authorizationPending: true`
 *     and a NULL guardian block — authorization is never invented;
 *   - tampering with any presented field breaks the chain digest;
 *   - a cross-tenant provenance read REFUSES (A8).
 */

import type { AcceptanceJourney } from "../journey-contracts.ts";
import { advanceActionState, proposeAction } from "@fleetos/actions";
import type { ActionRecord } from "@fleetos/actions";
import { appendExecutionLedger } from "@fleetos/execution";
import type { ExecutionLedgerEntry } from "@fleetos/execution";
import { buildTraceabilityChain } from "@fleetos/evidence";
import { evaluateCapability, evaluateRulesOrdered, issueGrant } from "@fleetos/policy";
import type { GrantRecord } from "@fleetos/policy";
import { buildDecisionProvenance, verifyDecisionProvenanceDigest } from "@fleetos/experience-safety-intel";
import {
  EXECUTE_CAPABILITY,
  NOW_MS,
  OPERATOR_CTX,
  TENANT,
  FOREIGN_TENANT,
  isoOfEpochMs,
  tenantPolicy,
} from "./fixture-world.ts";

const INTENT_ID = "intent-isolate-pump-7";
const IDEMPOTENCY_KEY = "exec-inspect-1";

function append(ledger: readonly ExecutionLedgerEntry[], input: Parameters<typeof appendExecutionLedger>[1]): readonly ExecutionLedgerEntry[] {
  const result = appendExecutionLedger(ledger, input);
  if (!result.ok) throw new Error(`ledger append refused: ${result.reason}`);
  return result.ledger;
}

function fullChain(): ActionRecord {
  const intent = {
    intentId: INTENT_ID,
    tenant: TENANT,
    capability: EXECUTE_CAPABILITY,
    idempotencyKey: { tenantId: TENANT.tenantId, capabilityId: EXECUTE_CAPABILITY.id, nonce: "inspect-1" },
    inputs: { assetId: "pump-7", command: "isolate" },
    proposedAt: isoOfEpochMs(NOW_MS),
    proposedBy: "engineer-raj",
  };
  const decision = evaluateCapability(tenantPolicy(), EXECUTE_CAPABILITY, OPERATOR_CTX(EXECUTE_CAPABILITY));
  let record = proposeAction(intent);
  const steps: readonly [ActionRecord["state"], Parameters<typeof advanceActionState>[2]][] = [
    ["authorized", { at: isoOfEpochMs(NOW_MS + 1_000), authorization: decision, tenantId: TENANT.tenantId }],
    ["confirmed", { at: isoOfEpochMs(NOW_MS + 2_000), confirmedBy: "operator-ada", tenantId: TENANT.tenantId }],
    ["dispatched", { at: isoOfEpochMs(NOW_MS + 3_000), dispatchReceipt: IDEMPOTENCY_KEY, tenantId: TENANT.tenantId }],
    ["executing", { at: isoOfEpochMs(NOW_MS + 4_000), tenantId: TENANT.tenantId }],
    ["executed", { at: isoOfEpochMs(NOW_MS + 5_000), executionResult: { succeeded: true, outputs: { ack: true }, executedAt: isoOfEpochMs(NOW_MS + 5_000) }, tenantId: TENANT.tenantId }],
    ["verified", { at: isoOfEpochMs(NOW_MS + 6_000), verificationRecord: { verified: true, verifierKind: "device.ack" as const, verifiedAt: isoOfEpochMs(NOW_MS + 6_000), proofRef: "ev-verification-1" }, tenantId: TENANT.tenantId }],
    ["recorded", { at: isoOfEpochMs(NOW_MS + 7_000), evidenceRef: "bundle-investigation-1", tenantId: TENANT.tenantId }],
  ];
  for (const [target, ctx] of steps) {
    const result = advanceActionState(record, target, ctx);
    if (!result.ok) throw new Error(`advance to ${target} refused: ${result.reason}`);
    record = result.record;
  }
  return record;
}

export const inspectWhyJourney: AcceptanceJourney = {
  journeyId: "security.inspect-why",
  persona: "compliance-auditor",
  capabilities: ["decision-provenance"],
  goal: "Inspect why an action happened, end-to-end with full lineage",
  steps: [
    {
      stepId: "action-chain",
      kind: "lifecycle",
      description: "Drive the FULL A4 action protocol chain through the REAL state machine",
      packages: ["@fleetos/actions", "@fleetos/policy"],
      operations: ["proposeAction", "evaluateCapability", "advanceActionState"],
      run: (ctx) => {
        const record = fullChain();
        ctx.record("action.finalState", record.state);
        ctx.record(
          "action.stateHistory",
          record.stateHistory.map((t) => t.to),
        );
        ctx.record("action.authorizationVerdict", record.authorization?.verdict ?? "none");
        ctx.record("action.authorizationRule", record.authorization?.matchedRuleId ?? "none");
        const premature = advanceActionState(proposeAction({
          intentId: INTENT_ID,
          tenant: TENANT,
          capability: EXECUTE_CAPABILITY,
          idempotencyKey: { tenantId: TENANT.tenantId, capabilityId: EXECUTE_CAPABILITY.id, nonce: "x" },
          inputs: {},
          proposedAt: isoOfEpochMs(NOW_MS),
          proposedBy: "engineer-raj",
        }), "executing", { at: isoOfEpochMs(NOW_MS), tenantId: TENANT.tenantId });
        ctx.record("action.prematureOk", premature.ok);
        ctx.record("action.prematureReason", premature.ok ? "unexpected" : premature.reason);
      },
    },
    {
      stepId: "provenance-view",
      kind: "provenance-inspect",
      description: "Build + verify the REAL decision-provenance view over the full chain",
      packages: ["@fleetos/experience-safety-intel", "@fleetos/evidence", "@fleetos/execution", "@fleetos/policy"],
      operations: ["buildDecisionProvenance", "verifyDecisionProvenanceDigest", "buildTraceabilityChain", "evaluateRulesOrdered", "issueGrant"],
      run: (ctx) => {
        const record = fullChain();
        const policy = tenantPolicy();
        const evaluation = evaluateRulesOrdered(policy, EXECUTE_CAPABILITY, OPERATOR_CTX(EXECUTE_CAPABILITY));
        if (!evaluation.ok) throw new Error(`ordered evaluation refused: ${evaluation.reason}`);
        let grants: readonly GrantRecord[] = [];
        const issued = issueGrant(grants, {
          grantId: "grant-execute-1",
          tenantId: TENANT.tenantId,
          capabilityId: EXECUTE_CAPABILITY.id,
          granteeActorId: "operator-ada",
          grantedByActorId: "tenant-admin",
          grantedAt: NOW_MS - 60_000,
          expiresAt: NOW_MS + 3_600_000,
        });
        if (!issued.ok) throw new Error(`grant refused: ${issued.reason}`);
        grants = issued.grants;
        const trace = buildTraceabilityChain(TENANT.tenantId, [
          { kind: "actor", ref: "engineer-raj", recordedAt: isoOfEpochMs(NOW_MS), details: {} },
          { kind: "intent", ref: INTENT_ID, recordedAt: isoOfEpochMs(NOW_MS), details: {} },
          { kind: "authorization", ref: record.authorization?.decisionDigest ?? "", recordedAt: isoOfEpochMs(NOW_MS + 1_000), details: {} },
          { kind: "execution", ref: IDEMPOTENCY_KEY, recordedAt: isoOfEpochMs(NOW_MS + 3_000), details: {} },
          { kind: "verification", ref: "ev-verification-1", recordedAt: isoOfEpochMs(NOW_MS + 6_000), details: {} },
          { kind: "capability_version", ref: `${EXECUTE_CAPABILITY.id}@${EXECUTE_CAPABILITY.version}`, recordedAt: isoOfEpochMs(NOW_MS), details: {} },
        ]);
        let ledger: readonly ExecutionLedgerEntry[] = [];
        ledger = append(ledger, { tenantId: TENANT.tenantId, idempotencyKey: IDEMPOTENCY_KEY, kind: "submitted", at: NOW_MS + 3_000, detail: "" });
        ledger = append(ledger, { tenantId: TENANT.tenantId, idempotencyKey: IDEMPOTENCY_KEY, kind: "acked", at: NOW_MS + 4_000, detail: "" });
        ledger = append(ledger, { tenantId: TENANT.tenantId, idempotencyKey: IDEMPOTENCY_KEY, kind: "completed", at: NOW_MS + 5_000, detail: "ack=true" });

        const view = buildDecisionProvenance({
          tenantId: TENANT.tenantId,
          action: record,
          evaluation: evaluation.evaluation,
          grants,
          journal: ledger,
          trace,
        });
        if (!view.ok) throw new Error(`provenance view refused: ${view.refused} (${view.detail})`);
        ctx.record("view.intentId", view.view.intentId);
        ctx.record("view.capabilityId", view.view.capabilityId);
        ctx.record("view.actionState", view.view.actionState);
        ctx.record("view.authorizationPending", view.view.authorizationPending);
        ctx.record("view.guardian.verdict", view.view.guardian?.verdict ?? "null");
        ctx.record("view.guardian.decisionDigestPresent", (view.view.guardian?.decisionDigest.length ?? 0) > 0);
        ctx.record("view.reasonChainCount", view.view.reasonChain.length);
        ctx.record("view.reasonChain0.ruleId", view.view.reasonChain[0]?.ruleId ?? "none");
        ctx.record("view.reasonChain0.matchedFactCount", view.view.reasonChain[0]?.matchedFactCount ?? 0);
        ctx.record("view.grantCount", view.view.grants.length);
        ctx.record("view.grant0.status", view.view.grants[0]?.status ?? "none");
        ctx.record("view.journalCount", view.view.executionJournal.length);
        ctx.record("view.evidenceRefCount", view.view.evidenceRefs.length);
        ctx.record("view.chainDigestVerifies", verifyDecisionProvenanceDigest(view.view));

        const tampered = { ...view.view, actionState: "learned" as const };
        ctx.record("view.tamperedVerifies", verifyDecisionProvenanceDigest(tampered));

        const pending = buildDecisionProvenance({
          tenantId: TENANT.tenantId,
          action: proposeAction({
            intentId: "intent-unauthorized-1",
            tenant: TENANT,
            capability: EXECUTE_CAPABILITY,
            idempotencyKey: { tenantId: TENANT.tenantId, capabilityId: EXECUTE_CAPABILITY.id, nonce: "u" },
            inputs: {},
            proposedAt: isoOfEpochMs(NOW_MS),
            proposedBy: "engineer-raj",
          }),
          grants,
          journal: [],
        });
        if (!pending.ok) throw new Error(`pending view refused: ${pending.refused}`);
        ctx.record("pending.authorizationPending", pending.view.authorizationPending);
        ctx.record("pending.guardianNull", pending.view.guardian === null);

        const foreign = buildDecisionProvenance({
          tenantId: FOREIGN_TENANT.tenantId,
          action: record,
          grants,
          journal: ledger,
        });
        ctx.record("foreign.ok", foreign.ok);
        ctx.record("foreign.refused", foreign.ok ? "unexpected-allow" : foreign.refused);
      },
    },
  ],
  assertions: [
    { assertionId: "iw-1", description: "The action reached the recorded state", path: "action.finalState", expected: "recorded" },
    { assertionId: "iw-2", description: "Full A4 state history visible", path: "action.stateHistory", expected: ["authorized", "confirmed", "dispatched", "executing", "executed", "verified", "recorded"] },
    { assertionId: "iw-3", description: "Authorization verdict recorded on the action", path: "action.authorizationVerdict", expected: "REQUIRE_APPROVAL" },
    { assertionId: "iw-4", description: "Matched rule recorded", path: "action.authorizationRule", expected: "rule.require_human_approval_for_high_risk" },
    { assertionId: "iw-5", description: "Executing without authorization is refused (A4)", path: "action.prematureOk", expected: false },
    { assertionId: "iw-6", description: "Refusal reason", path: "action.prematureReason", expected: "refused.execute_without_authorization" },
    { assertionId: "iw-7", description: "View names the intent", path: "view.intentId", expected: "intent-isolate-pump-7" },
    { assertionId: "iw-8", description: "View names the capability", path: "view.capabilityId", expected: "fleetos.device.execute-command" },
    { assertionId: "iw-9", description: "View presents the action state", path: "view.actionState", expected: "recorded" },
    { assertionId: "iw-10", description: "Authorized action is not pending", path: "view.authorizationPending", expected: false },
    { assertionId: "iw-11", description: "Guardian block presents the verdict", path: "view.guardian.verdict", expected: "REQUIRE_APPROVAL" },
    { assertionId: "iw-12", description: "Guardian decision digest carried on the block", path: "view.guardian.decisionDigestPresent", expected: true },
    { assertionId: "iw-13", description: "Reason chain presents the matched rule", path: "view.reasonChain0.ruleId", expected: "rule.require_human_approval_for_high_risk" },
    { assertionId: "iw-14", description: "Reason chain presents matched facts", path: "view.reasonChain0.matchedFactCount", expected: 3 },
    { assertionId: "iw-15", description: "One reason-chain link", path: "view.reasonChainCount", expected: 1 },
    { assertionId: "iw-16", description: "Grant link presented", path: "view.grantCount", expected: 1 },
    { assertionId: "iw-17", description: "Grant status visible", path: "view.grant0.status", expected: "active" },
    { assertionId: "iw-18", description: "Journal slice presents all entries", path: "view.journalCount", expected: 3 },
    { assertionId: "iw-19", description: "Evidence refs: action evidence + 6 trace links", path: "view.evidenceRefCount", expected: 7 },
    { assertionId: "iw-20", description: "Chain digest verifies", path: "view.chainDigestVerifies", expected: true },
    { assertionId: "iw-21", description: "Tampering with the presented state breaks the digest", path: "view.tamperedVerifies", expected: false },
    { assertionId: "iw-22", description: "Unauthorized action presented as authorization-pending", path: "pending.authorizationPending", expected: true },
    { assertionId: "iw-23", description: "No guardian block invented for it", path: "pending.guardianNull", expected: true },
    { assertionId: "iw-24", description: "Cross-tenant provenance read refused (A8)", path: "foreign.ok", expected: false },
    { assertionId: "iw-25", description: "Refusal names the cross-tenant action", path: "foreign.refused", expected: "views.cross-tenant-action" },
  ],
};
