/**
 * Journey 4 — compose an action plan (persona: remediation-engineer).
 *
 * A remediation engineer composes a Guardian-gated action plan:
 *   - plan validation + per-step idempotency keys (REAL @fleetos/actions);
 *   - every step carries a REAL Guardian decision — a BLOCKed step refuses
 *     the WHOLE emission (all-or-nothing authorization boundary);
 *   - the plan lifecycle advances draft -> authorized -> dispatched only
 *     when EVERY step is authorized;
 *   - the emitted commands land in the REAL command queue and the REAL
 *     action-plan board view joins them by the domain idempotency key.
 */

import type { AcceptanceJourney } from "../journey-contracts.ts";
import {
  advancePlanLifecycle,
  emitPlanCommands,
  initPlanLifecycle,
  stepIdempotencyKey,
  validatePlan,
} from "@fleetos/actions";
import type { ActionPlan, StepDecision } from "@fleetos/actions";
import { createCommandQueue, submitCommand } from "@fleetos/execution";
import { buildActionPlanBoard } from "@fleetos/experience-safety-intel";
import { evaluateCapability } from "@fleetos/policy";
import {
  EXECUTE_CAPABILITY,
  NOW_MS,
  OPERATOR_CTX,
  READ_CAPABILITY,
  TENANT,
  tenantPolicy,
} from "./fixture-world.ts";

const PLAN_ID = "plan-isolate-pump-7";
const NONCE_A = "nonce-read-1";
const NONCE_B = "nonce-execute-1";

export function remediationPlan(): ActionPlan {
  return {
    planId: PLAN_ID,
    tenant: TENANT,
    steps: [
      { stepId: "step-read-state", capability: READ_CAPABILITY, inputs: { assetId: "pump-7" }, idempotencyNonce: NONCE_A },
      { stepId: "step-execute-isolate", capability: EXECUTE_CAPABILITY, inputs: { assetId: "pump-7", command: "isolate" }, idempotencyNonce: NONCE_B },
    ],
  };
}

function decisionsFor(plan: ActionPlan): StepDecision[] {
  const policy = tenantPolicy();
  return plan.steps.map((step) => ({
    stepId: step.stepId,
    decision: evaluateCapability(policy, step.capability, OPERATOR_CTX(step.capability)),
  }));
}

export const actionPlanJourney: AcceptanceJourney = {
  journeyId: "security.action-plan",
  persona: "remediation-engineer",
  capabilities: ["action-plans"],
  goal: "Compose a Guardian-gated action plan and see it queued with idempotency keys",
  steps: [
    {
      stepId: "validate-and-emit",
      kind: "plan",
      description: "Validate the plan and emit Guardian-gated commands with idempotency keys",
      packages: ["@fleetos/actions", "@fleetos/policy"],
      operations: ["validatePlan", "evaluateCapability", "stepIdempotencyKey", "emitPlanCommands"],
      run: (ctx) => {
        const plan = remediationPlan();
        const validation = validatePlan(plan);
        ctx.record("plan.validationOk", validation.ok);
        const decisions = decisionsFor(plan);
        const emission = emitPlanCommands(plan, decisions);
        if (!emission.ok) throw new Error(`emission refused: ${emission.reason}`);
        ctx.record("emission.commandCount", emission.commands.length);
        ctx.record("emission.command0.key", emission.commands[0]!.idempotencyKey);
        ctx.record("emission.command1.key", emission.commands[1]!.idempotencyKey);
        ctx.record(
          "emission.command1.authorizationDigestPresent",
          emission.commands[1]!.authorizationDigest.length > 0,
        );
        ctx.record("emission.command1.verdict", emission.commands[1]!.verdict);
        ctx.record(
          "emission.keyStable",
          emission.commands[0]!.idempotencyKey === stepIdempotencyKey(PLAN_ID, "step-read-state", NONCE_A),
        );
        const blocked = emitPlanCommands(plan, [
          decisions[0]!,
          {
            stepId: "step-execute-isolate",
            decision: {
              ...decisions[1]!.decision,
              verdict: "BLOCK",
              reasonCode: "block.policy_fail_closed",
            },
          },
        ]);
        ctx.record("emission.blockedOk", blocked.ok);
        ctx.record("emission.blockedReason", blocked.ok ? "unexpected-allow" : blocked.reason);
        ctx.record("emission.blockedStep", blocked.ok ? null : blocked.stepId);
      },
    },
    {
      stepId: "lifecycle-and-queue",
      kind: "queue",
      description: "Advance the plan lifecycle and land the commands in the REAL queue",
      packages: ["@fleetos/actions", "@fleetos/execution"],
      operations: ["initPlanLifecycle", "advancePlanLifecycle", "createCommandQueue", "submitCommand"],
      run: (ctx) => {
        const plan = remediationPlan();
        const init = initPlanLifecycle(plan, 0);
        if (!init.ok) throw new Error(`lifecycle init refused: ${init.reason}`);
        const premature = advancePlanLifecycle(init.record, "authorized", {
          tenantId: TENANT.tenantId,
          actorId: "engineer-raj",
          at: NOW_MS,
        });
        ctx.record("lifecycle.prematureOk", premature.ok);
        ctx.record("lifecycle.prematureReason", premature.ok ? "unexpected" : premature.reason);
        const authorized = advancePlanLifecycle(
          { ...init.record, authorizedStepCount: 2 },
          "authorized",
          { tenantId: TENANT.tenantId, actorId: "guardian-path", at: NOW_MS },
        );
        if (!authorized.ok) throw new Error(`authorize refused: ${authorized.reason}`);
        ctx.record("lifecycle.authorizedState", authorized.record.state);
        const partial = advancePlanLifecycle(init.record, "authorized", {
          tenantId: TENANT.tenantId,
          actorId: "guardian-path",
          at: NOW_MS,
        });
        ctx.record("lifecycle.partialOk", partial.ok);
        ctx.record("lifecycle.partialReason", partial.ok ? "unexpected" : partial.reason);
        const dispatched = advancePlanLifecycle(authorized.record, "dispatched", {
          tenantId: TENANT.tenantId,
          actorId: "engineer-raj",
          at: NOW_MS + 1_000,
          dispatchRef: "queue-batch-1",
        });
        if (!dispatched.ok) throw new Error(`dispatch refused: ${dispatched.reason}`);
        ctx.record("lifecycle.dispatchedState", dispatched.record.state);
        ctx.record("lifecycle.transitionCount", dispatched.record.transitions.length);

        const queue = createCommandQueue(TENANT.tenantId);
        if (!queue.ok) throw new Error("queue creation refused");
        const emission = emitPlanCommands(plan, decisionsFor(plan));
        if (!emission.ok) throw new Error("emission refused");
        let state = queue.state;
        for (const command of emission.commands) {
          const submitted = submitCommand(state, {
            idempotencyKey: command.idempotencyKey,
            capabilityId: command.capabilityId,
            payloadInputs: command.inputs,
            at: NOW_MS + 2_000,
            tenantId: TENANT.tenantId,
            authorizationDigest: command.authorizationDigest,
            verdict: command.verdict,
          });
          if (!submitted.ok) throw new Error(`submit refused: ${submitted.reason}`);
          state = submitted.state;
        }
        const duplicate = submitCommand(state, {
          idempotencyKey: emission.commands[0]!.idempotencyKey,
          capabilityId: READ_CAPABILITY.id,
          payloadInputs: {},
          at: NOW_MS + 3_000,
          tenantId: TENANT.tenantId,
        });
        if (!duplicate.ok) throw new Error(`duplicate submit refused: ${duplicate.reason}`);
        ctx.record("queue.commandCount", state.commands.length);
        ctx.record("queue.duplicateFlag", duplicate.duplicate);
        ctx.record("queue.nextSeqAfterDuplicate", duplicate.state.nextSeq);

        const board = buildActionPlanBoard({
          tenantId: TENANT.tenantId,
          plan,
          lifecycle: dispatched.record,
          queue: state,
        });
        if (!board.ok) throw new Error(`plan board refused: ${board.refused} (${board.detail})`);
        ctx.record("board.planState", board.view.planState);
        ctx.record("board.stepCount", board.view.stepCount);
        ctx.record("board.authorizedStepCount", board.view.authorizedStepCount);
        ctx.record("board.step0Status", board.view.steps[0]!.queueStatus);
        ctx.record("board.step1Status", board.view.steps[1]!.queueStatus);
        ctx.record("board.step1Attempts", board.view.steps[1]!.attempts);
        ctx.record("board.deadLetterCount", board.view.deadLetterCount);
      },
    },
  ],
  assertions: [
    { assertionId: "ap-1", description: "Plan validation passes", path: "plan.validationOk", expected: true },
    { assertionId: "ap-2", description: "Both steps emitted authorized commands", path: "emission.commandCount", expected: 2 },
    { assertionId: "ap-3", description: "Read step idempotency key is plan|step|nonce", path: "emission.command0.key", expected: "plan-isolate-pump-7|step-read-state|nonce-read-1" },
    { assertionId: "ap-4", description: "Execute step idempotency key is plan|step|nonce", path: "emission.command1.key", expected: "plan-isolate-pump-7|step-execute-isolate|nonce-execute-1" },
    { assertionId: "ap-5", description: "Authorization digest carried onto the command", path: "emission.command1.authorizationDigestPresent", expected: true },
    { assertionId: "ap-6", description: "Execute command verdict is REQUIRE_APPROVAL (escalated)", path: "emission.command1.verdict", expected: "REQUIRE_APPROVAL" },
    { assertionId: "ap-7", description: "Key helper and emission agree", path: "emission.keyStable", expected: true },
    { assertionId: "ap-8", description: "A BLOCKed step refuses the whole emission", path: "emission.blockedOk", expected: false },
    { assertionId: "ap-9", description: "Refusal reason names the blocked step", path: "emission.blockedReason", expected: "emission.step-blocked" },
    { assertionId: "ap-10", description: "The blocked step is named", path: "emission.blockedStep", expected: "step-execute-isolate" },
    { assertionId: "ap-11", description: "Lifecycle refuses authorize before steps recorded", path: "lifecycle.prematureOk", expected: false },
    { assertionId: "ap-12", description: "Refusal reason: steps not authorized", path: "lifecycle.prematureReason", expected: "plan-refused.steps-not-authorized" },
    { assertionId: "ap-13", description: "Lifecycle reaches authorized", path: "lifecycle.authorizedState", expected: "authorized" },
    { assertionId: "ap-14", description: "A plan with 1/2 steps authorized still refuses", path: "lifecycle.partialOk", expected: false },
    { assertionId: "ap-15", description: "Partial refusal reason", path: "lifecycle.partialReason", expected: "plan-refused.steps-not-authorized" },
    { assertionId: "ap-16", description: "Lifecycle reaches dispatched with a dispatch ref", path: "lifecycle.dispatchedState", expected: "dispatched" },
    { assertionId: "ap-17", description: "Two lifecycle transitions recorded (authorized, dispatched)", path: "lifecycle.transitionCount", expected: 2 },
    { assertionId: "ap-18", description: "Queue holds exactly the two commands", path: "queue.commandCount", expected: 2 },
    { assertionId: "ap-19", description: "Duplicate idempotency key returns the original ack", path: "queue.duplicateFlag", expected: true },
    { assertionId: "ap-20", description: "Duplicate submit does not re-enqueue", path: "queue.nextSeqAfterDuplicate", expected: 3 },
    { assertionId: "ap-21", description: "Board presents the dispatched plan", path: "board.planState", expected: "dispatched" },
    { assertionId: "ap-22", description: "Board carries the full step count", path: "board.stepCount", expected: 2 },
    { assertionId: "ap-23", description: "Board carries the authorized step count", path: "board.authorizedStepCount", expected: 2 },
    { assertionId: "ap-24", description: "Read step joined onto its queued command", path: "board.step0Status", expected: "queued" },
    { assertionId: "ap-25", description: "Execute step joined onto its queued command", path: "board.step1Status", expected: "queued" },
    { assertionId: "ap-26", description: "First attempt started", path: "board.step1Attempts", expected: 1 },
    { assertionId: "ap-27", description: "No dead letters on a healthy plan", path: "board.deadLetterCount", expected: 0 },
  ],
};
