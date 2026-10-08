/**
 * Journey 12 — use agent automation safely (persona: automation-agent).
 *
 * An autonomous agent operates ONLY through capabilities granted to it:
 *   - the REAL grant chain: issue a root grant, derive a child grant,
 *     verify the chain (depth 2);
 *   - REVOCATION PROPAGATES: revoking the root deterministically
 *     invalidates the derived grant — `verifyGrantChain` then refuses with
 *     `grant.ancestor-revoked` and the agent's active-grant read is EMPTY
 *     (an agent CANNOT act on a revoked capability);
 *   - the Guardian blocks an autonomous actor on non-low-risk capabilities
 *     (law A5 — self-authorization unrepresentable), while the same actor
 *     WITH human.approval authority is escalated to REQUIRE_APPROVAL;
 *   - an expired grant is honestly refused.
 */

import type { AcceptanceJourney } from "../journey-contracts.ts";
import {
  activeGrantsForActor,
  assertGrantTenantIsolation,
  evaluateCapability,
  issueGrant,
  revokeGrant,
  verifyGrantChain,
} from "@fleetos/policy";
import type { GrantRecord } from "@fleetos/policy";
import {
  AUTONOMOUS_AGENT_CTX,
  AUTONOMOUS_WITH_APPROVAL_CTX,
  EXECUTE_CAPABILITY,
  NOW_MS,
  READ_CAPABILITY,
  TENANT,
  FOREIGN_TENANT,
  tenantPolicy,
} from "./fixture-world.ts";

const AGENT_ID = "agent-fleetos-01";

export const agentSafetyJourney: AcceptanceJourney = {
  journeyId: "security.agent-safety",
  persona: "automation-agent",
  capabilities: ["agent-safety"],
  goal: "Operate safely on granted capabilities — revocation propagates, no self-authorization",
  steps: [
    {
      stepId: "grant-chain",
      kind: "grant-chain",
      description: "Issue, derive, verify and REVOKE a capability grant chain",
      packages: ["@fleetos/policy"],
      operations: ["issueGrant", "verifyGrantChain", "revokeGrant", "activeGrantsForActor", "assertGrantTenantIsolation"],
      run: (ctx) => {
        let grants: readonly GrantRecord[] = [];
        const root = issueGrant(grants, {
          grantId: "grant-agent-root",
          tenantId: TENANT.tenantId,
          capabilityId: EXECUTE_CAPABILITY.id,
          granteeActorId: AGENT_ID,
          grantedByActorId: "operator-ada",
          grantedAt: NOW_MS - 120_000,
          expiresAt: null,
        });
        if (!root.ok) throw new Error(`root grant refused: ${root.reason}`);
        grants = root.grants;
        const derived = issueGrant(grants, {
          grantId: "grant-agent-child",
          tenantId: TENANT.tenantId,
          capabilityId: EXECUTE_CAPABILITY.id,
          granteeActorId: "agent-fleetos-02",
          grantedByActorId: AGENT_ID,
          grantedAt: NOW_MS - 60_000,
          expiresAt: NOW_MS + 3_600_000,
          parentGrantId: "grant-agent-root",
        });
        if (!derived.ok) throw new Error(`derived grant refused: ${derived.reason}`);
        grants = derived.grants;
        const verifyChild = verifyGrantChain(grants, "grant-agent-child", NOW_MS);
        if (!verifyChild.valid) throw new Error(`child chain invalid: ${verifyChild.reason}`);
        ctx.record("grant.chainDepth", verifyChild.chainDepth);
        ctx.record(
          "grant.checkedChain",
          verifyChild.checkedGrantIds,
        );
        const active = activeGrantsForActor(grants, TENANT.tenantId, AGENT_ID, NOW_MS);
        if (!active.ok) throw new Error(`active grants refused: ${active.reason}`);
        ctx.record("grant.activeCount", active.grants.length);
        const isolation = assertGrantTenantIsolation(grants, TENANT.tenantId);
        ctx.record("grant.tenantIsolated", isolation.isolated);

        const revoked = revokeGrant(grants, "grant-agent-root", NOW_MS + 1_000, "operator-ada", "compromise suspected");
        if (!revoked.ok) throw new Error(`revoke refused: ${revoked.reason}`);
        ctx.record("revoke.count", revoked.revokedCount);
        const rootAfter = revoked.grants.find((g) => g.grantId === "grant-agent-root");
        const childAfter = revoked.grants.find((g) => g.grantId === "grant-agent-child");
        if (rootAfter === undefined || childAfter === undefined) throw new Error("revoked grants missing");
        ctx.record("revoke.rootStatus", rootAfter.status);
        ctx.record("revoke.rootReason", rootAfter.revocationReason);
        ctx.record("revoke.childStatus", childAfter.status);
        ctx.record("revoke.childPropagatedReason", childAfter.revocationReason);
        const childVerifyAfter = verifyGrantChain(revoked.grants, "grant-agent-child", NOW_MS + 2_000);
        ctx.record("revoke.childStillValid", childVerifyAfter.valid);
        ctx.record("revoke.childRefusal", childVerifyAfter.valid ? "still-valid" : childVerifyAfter.reason);
        const rootVerifyAfter = verifyGrantChain(revoked.grants, "grant-agent-root", NOW_MS + 2_000);
        ctx.record("revoke.rootRefusal", rootVerifyAfter.valid ? "still-valid" : rootVerifyAfter.reason);
        const activeAfter = activeGrantsForActor(revoked.grants, TENANT.tenantId, AGENT_ID, NOW_MS + 2_000);
        if (!activeAfter.ok) throw new Error(`active read refused: ${activeAfter.reason}`);
        ctx.record("revoke.activeCountAfter", activeAfter.grants.length);

        const foreignGrant = issueGrant([], {
          grantId: "grant-foreign-1",
          tenantId: FOREIGN_TENANT.tenantId,
          capabilityId: READ_CAPABILITY.id,
          granteeActorId: AGENT_ID,
          grantedByActorId: "globex-admin",
          grantedAt: NOW_MS,
          expiresAt: null,
        });
        if (!foreignGrant.ok) throw new Error("foreign grant refused");
        const foreignActive = activeGrantsForActor([...revoked.grants, ...foreignGrant.grants], TENANT.tenantId, AGENT_ID, NOW_MS);
        if (!foreignActive.ok) throw new Error("foreign active read refused");
        ctx.record("grant.foreverLeakCount", foreignActive.grants.length);

        const expireCheck = verifyGrantChain(
          [
            {
              grantId: "grant-expiring",
              tenantId: TENANT.tenantId,
              capabilityId: READ_CAPABILITY.id,
              granteeActorId: AGENT_ID,
              grantedByActorId: "operator-ada",
              grantedAt: NOW_MS - 10_000,
              expiresAt: NOW_MS - 1_000,
              parentGrantId: null,
              status: "active",
              revokedAt: null,
              revokedBy: null,
              revocationReason: null,
            },
          ],
          "grant-expiring",
          NOW_MS,
        );
        ctx.record("grant.expiredValid", expireCheck.valid);
        ctx.record("grant.expiredRefusal", expireCheck.valid ? "still-valid" : expireCheck.reason);
      },
    },
    {
      stepId: "guardian-boundary",
      kind: "guardian-decision",
      description: "The Guardian refuses agent self-authorization on risky capabilities",
      packages: ["@fleetos/policy"],
      operations: ["evaluateCapability"],
      run: (ctx) => {
        const policy = tenantPolicy();
        const alone = evaluateCapability(policy, EXECUTE_CAPABILITY, AUTONOMOUS_AGENT_CTX(EXECUTE_CAPABILITY));
        ctx.record("agent.aloneVerdict", alone.verdict);
        ctx.record("agent.aloneReason", alone.reasonCode);
        const withApproval = evaluateCapability(policy, EXECUTE_CAPABILITY, AUTONOMOUS_WITH_APPROVAL_CTX(EXECUTE_CAPABILITY));
        ctx.record("agent.withApprovalVerdict", withApproval.verdict);
        ctx.record("agent.withApprovalReason", withApproval.reasonCode);
        const read = evaluateCapability(policy, READ_CAPABILITY, AUTONOMOUS_AGENT_CTX(READ_CAPABILITY));
        ctx.record("agent.readVerdict", read.verdict);
      },
    },
  ],
  assertions: [
    { assertionId: "as-1", description: "Derived grant chain depth 2", path: "grant.chainDepth", expected: 2 },
    { assertionId: "as-2", description: "Chain walk names root then child", path: "grant.checkedChain", expected: ["grant-agent-child", "grant-agent-root"] },
    { assertionId: "as-3", description: "Agent holds its active grant before revocation", path: "grant.activeCount", expected: 1 },
    { assertionId: "as-4", description: "No cross-tenant grants leak into the tenant scope", path: "grant.tenantIsolated", expected: true },
    { assertionId: "as-5", description: "Revocation revokes root + derived (propagation)", path: "revoke.count", expected: 2 },
    { assertionId: "as-6", description: "Root grant revoked", path: "revoke.rootStatus", expected: "revoked" },
    { assertionId: "as-7", description: "Root revocation reason recorded", path: "revoke.rootReason", expected: "compromise suspected" },
    { assertionId: "as-8", description: "Derived grant revoked by propagation", path: "revoke.childStatus", expected: "revoked" },
    { assertionId: "as-9", description: "Propagation reason names the root cause", path: "revoke.childPropagatedReason", expected: "propagated:grant-agent-root" },
    { assertionId: "as-10", description: "The derived grant is no longer valid", path: "revoke.childStillValid", expected: false },
    { assertionId: "as-11", description: "The revoked child grant is refused as revoked", path: "revoke.childRefusal", expected: "grant.revoked" },
    { assertionId: "as-11b", description: "The revoked root grant is refused as revoked too", path: "revoke.rootRefusal", expected: "grant.revoked" },
    { assertionId: "as-12", description: "The agent has ZERO active grants after revocation", path: "revoke.activeCountAfter", expected: 0 },
    { assertionId: "as-13", description: "A foreign tenant's grant never leaks into the agent's active set", path: "grant.foreverLeakCount", expected: 0 },
    { assertionId: "as-14", description: "An expired grant is honestly invalid", path: "grant.expiredValid", expected: false },
    { assertionId: "as-15", description: "Expiry refusal reason", path: "grant.expiredRefusal", expected: "grant.expired" },
    { assertionId: "as-16", description: "An autonomous agent cannot self-authorize high risk (A5)", path: "agent.aloneVerdict", expected: "BLOCK" },
    { assertionId: "as-17", description: "Self-authorization refusal reason", path: "agent.aloneReason", expected: "block.self_authorization" },
    { assertionId: "as-18", description: "With human.approval the agent is escalated to approval", path: "agent.withApprovalVerdict", expected: "REQUIRE_APPROVAL" },
    { assertionId: "as-19", description: "Approval escalation reason", path: "agent.withApprovalReason", expected: "require_approval.high_risk" },
    { assertionId: "as-20", description: "Low-risk reads stay allowed for the agent", path: "agent.readVerdict", expected: "ALLOW" },
  ],
};
