/**
 * F321B journey — capability-store disaster recovery (persona: tenant-operator).
 *
 * A tenant operator proves the Guardian's capability store survives a
 * disaster (@fleetos/policy capability-store + capability-store-dr — F280B):
 *   - openCapabilityStore is tenant-fail-closed (an empty tenant REFUSES);
 *     enrollment refuses duplicates; grants issue through the REAL grant
 *     chain and decideCapability composes the REAL Guardian verdict with
 *     the grant gate (allow / escalate / deny);
 *   - revocation is PERMANENT: revokeCapabilityGrant propagates to derived
 *     grants AND writes an immutable tombstone — a revoked grant DENIES at
 *     decision time (`grant.revoked`);
 *   - the DR protocol: snapshotCapabilityStore content-addresses the state;
 *     restoreCapabilityStore replays the tombstone log OVER the snapshot so
 *     a revocation recorded BEFORE OR AFTER the snapshot survives restore;
 *   - SNAPSHOT EQUIVALENCE is machine-checked: every decision in a corpus
 *     produces byte-identical results on the original and restored stores;
 *   - fail-closed: a tampered snapshot REFUSES at restore
 *     (`store.snapshot-digest-mismatch`); a cross-tenant tombstone log
 *     REFUSES (`store.tenant-mismatch`).
 *
 * Determinism: logical epochs (NOW_MS offsets) only; no clock, no
 * randomness, no network.
 */

import type { AcceptanceJourney } from "../journey-contracts.ts";
import {
  decideCapability,
  enrollCapability,
  enrollPolicy,
  issueCapabilityGrant,
  openCapabilityStore,
  openRevocationLog,
  restoreCapabilityStore,
  revokeCapabilityGrant,
  snapshotCapabilityStore,
  verifySnapshotEquivalence,
} from "@fleetos/policy";
import type { CapabilityStore, Capability, GuardianContext, AuthorityKind, RevocationLog, DecisionCorpusCase } from "@fleetos/policy";
import { EXECUTE_CAPABILITY, READ_CAPABILITY, TENANT, FOREIGN_TENANT, NOW_MS, tenantPolicy } from "./fixture-world.ts";

const ANALYST = { actorId: "analyst-kim", authority: ["tenant.engineer"] as readonly AuthorityKind[], isAutonomous: false } as const;
const OPERATOR = { actorId: "operator-ada", authority: ["tenant.operator", "human.approval", "asset.owner"] as readonly AuthorityKind[], isAutonomous: false } as const;

function guardianCtx(
  capability: Capability,
  actor: { readonly actorId: string; readonly authority: readonly AuthorityKind[]; readonly isAutonomous: boolean },
): GuardianContext {
  return { tenant: TENANT, capability, actor, degraded: false };
}

function freshStore(): { store: CapabilityStore; log: RevocationLog } {
  const store = openCapabilityStore(TENANT.tenantId);
  if (store === null) throw new Error("store creation refused");
  const log = openRevocationLog(TENANT.tenantId);
  if (log === null) throw new Error("revocation log creation refused");
  const policyEnroll = enrollPolicy(store, tenantPolicy());
  if (!policyEnroll.ok) throw new Error(`policy enrollment refused: ${policyEnroll.reason}`);
  const capabilityEnroll = enrollCapability(policyEnroll.store, READ_CAPABILITY);
  if (!capabilityEnroll.ok) throw new Error(`capability enrollment refused: ${capabilityEnroll.reason}`);
  return { store: capabilityEnroll.store, log };
}

export const capabilityDrJourney: AcceptanceJourney = {
  journeyId: "security.capability-store-dr",
  persona: "tenant-operator",
  capabilities: ["guardian-decision"],
  goal: "Prove grants, revocations and Guardian decisions survive a capability-store disaster restore",
  steps: [
    {
      stepId: "store-and-grants",
      kind: "grant-chain",
      description: "Open the store, enroll the real policy/capabilities, issue grants, decide allow/escalate/deny",
      packages: ["@fleetos/policy"],
      operations: ["openCapabilityStore", "enrollPolicy", "enrollCapability", "issueCapabilityGrant", "decideCapability"],
      run: (ctx) => {
        // Empty tenant REFUSES (A8 fail-closed).
        ctx.record("store.openEmptyTenant", openCapabilityStore("") === null ? null : "unexpected-store");
        ctx.record("store.openRevocationLogEmpty", openRevocationLog("") === null ? null : "unexpected-log");

        const { store: s0, log: l0 } = freshStore();
        // Duplicate enrollment REFUSES.
        const dup = enrollCapability(s0, READ_CAPABILITY);
        ctx.record("store.duplicateEnrollOk", dup.ok);
        ctx.record("store.duplicateEnrollReason", dup.ok ? "unexpected-allow" : dup.reason);
        // Cross-tenant enrollment REFUSES.
        const cross = enrollPolicy(s0, tenantPolicy(FOREIGN_TENANT.tenantId));
        ctx.record("store.crossEnrollOk", cross.ok);
        ctx.record("store.crossEnrollReason", cross.ok ? "unexpected-allow" : cross.reason);

        // Issue a root grant + a derived grant through the REAL chain.
        const root = issueCapabilityGrant(s0, l0, {
          grantId: "grant-dr-root",
          tenantId: TENANT.tenantId,
          capabilityId: READ_CAPABILITY.id,
          granteeActorId: ANALYST.actorId,
          grantedByActorId: "tenant-operator",
          grantedAt: NOW_MS,
        });
        if (!root.ok) throw new Error(`root grant refused: ${root.reason}`);
        let store = root.store;
        let log = root.log;
        const child = issueCapabilityGrant(store, log, {
          grantId: "grant-dr-child",
          tenantId: TENANT.tenantId,
          capabilityId: READ_CAPABILITY.id,
          granteeActorId: ANALYST.actorId,
          grantedByActorId: "analyst-kim",
          grantedAt: NOW_MS + 1_000,
          parentGrantId: "grant-dr-root",
        });
        if (!child.ok) throw new Error(`child grant refused: ${child.reason}`);
        store = child.store;
        log = child.log;
        // A duplicate grant id REFUSES.
        const dupGrant = issueCapabilityGrant(store, log, {
          grantId: "grant-dr-root",
          tenantId: TENANT.tenantId,
          capabilityId: READ_CAPABILITY.id,
          granteeActorId: ANALYST.actorId,
          grantedByActorId: "tenant-operator",
          grantedAt: NOW_MS + 2_000,
        });
        ctx.record("grant.duplicateOk", dupGrant.ok);
        ctx.record("grant.duplicateReason", dupGrant.ok ? "unexpected-allow" : dupGrant.reason);

        // DECIDE: a low-risk read with a valid grant => allow.
        const allowed = decideCapability(store, {
          policyId: tenantPolicy().id,
          capabilityId: READ_CAPABILITY.id,
          ctx: guardianCtx(READ_CAPABILITY, ANALYST),
          at: NOW_MS + 3_000,
        });
        if (!allowed.ok) throw new Error(`allow decision refused: ${allowed.reason}`);
        ctx.record("decide.allow.outcome", allowed.decision.outcome);
        ctx.record("decide.allow.grantId", allowed.decision.grantId);
        ctx.record("decide.allow.guardianVerdict", allowed.decision.guardian.verdict);
        ctx.record("decide.allow.outcomeReason", allowed.decision.outcomeReason);

        // ESCALATE: a high-risk execute with a valid grant => REQUIRE_APPROVAL.
        const executeStore = openCapabilityStore(TENANT.tenantId);
        if (executeStore === null) throw new Error("execute store refused");
        let s2 = executeStore;
        const p2 = enrollPolicy(s2, tenantPolicy());
        if (!p2.ok) throw new Error("policy enroll refused");
        s2 = p2.store;
        const c2 = enrollCapability(s2, EXECUTE_CAPABILITY);
        if (!c2.ok) throw new Error("capability enroll refused");
        s2 = c2.store;
        const execGrant = issueCapabilityGrant(s2, log, {
          grantId: "grant-dr-exec",
          tenantId: TENANT.tenantId,
          capabilityId: EXECUTE_CAPABILITY.id,
          granteeActorId: OPERATOR.actorId,
          grantedByActorId: "tenant-operator",
          grantedAt: NOW_MS,
        });
        if (!execGrant.ok) throw new Error(`exec grant refused: ${execGrant.reason}`);
        const escalated = decideCapability(execGrant.store, {
          policyId: tenantPolicy().id,
          capabilityId: EXECUTE_CAPABILITY.id,
          ctx: guardianCtx(EXECUTE_CAPABILITY, OPERATOR),
          at: NOW_MS + 3_000,
        });
        if (!escalated.ok) throw new Error(`escalate decision refused: ${escalated.reason}`);
        ctx.record("decide.escalate.outcome", escalated.decision.outcome);
        ctx.record("decide.escalate.guardianVerdict", escalated.decision.guardian.verdict);
        ctx.record("decide.escalate.grantId", escalated.decision.grantId);
        ctx.record("decide.escalate.outcomeReason", escalated.decision.outcomeReason);

        // No grant at all => escalate with require_approval.no_grant.
        const noGrant = decideCapability(store, {
          policyId: tenantPolicy().id,
          capabilityId: READ_CAPABILITY.id,
          ctx: guardianCtx(READ_CAPABILITY, { actorId: "visitor-sam", authority: [], isAutonomous: false }),
          at: NOW_MS + 3_000,
        });
        if (!noGrant.ok) throw new Error(`no-grant decision refused: ${noGrant.reason}`);
        ctx.record("decide.noGrant.outcome", noGrant.decision.outcome);
        ctx.record("decide.noGrant.outcomeReason", noGrant.decision.outcomeReason);
        ctx.record("decide.noGrant.grantId", noGrant.decision.grantId);
        ctx.record("decide.unknownPolicyOk", decideCapability(store, {
          policyId: "policy-missing",
          capabilityId: READ_CAPABILITY.id,
          ctx: guardianCtx(READ_CAPABILITY, ANALYST),
          at: NOW_MS,
        }).ok);
      },
    },
    {
      stepId: "revocation-and-restore",
      kind: "guardian-decision",
      description: "Revoke with propagation + tombstone; snapshot; restore; prove revocation permanence and snapshot equivalence",
      packages: ["@fleetos/policy"],
      operations: ["revokeCapabilityGrant", "decideCapability", "snapshotCapabilityStore", "restoreCapabilityStore", "verifySnapshotEquivalence"],
      run: (ctx) => {
        const { store: s0, log: l0 } = freshStore();
        const root = issueCapabilityGrant(s0, l0, {
          grantId: "grant-dr-root",
          tenantId: TENANT.tenantId,
          capabilityId: READ_CAPABILITY.id,
          granteeActorId: ANALYST.actorId,
          grantedByActorId: "tenant-operator",
          grantedAt: NOW_MS,
        });
        if (!root.ok) throw new Error("root grant refused");
        let store = root.store;
        let log = root.log;
        const child = issueCapabilityGrant(store, log, {
          grantId: "grant-dr-child",
          tenantId: TENANT.tenantId,
          capabilityId: READ_CAPABILITY.id,
          granteeActorId: ANALYST.actorId,
          grantedByActorId: "analyst-kim",
          grantedAt: NOW_MS + 1_000,
          parentGrantId: "grant-dr-root",
        });
        if (!child.ok) throw new Error("child grant refused");
        store = child.store;
        log = child.log;

        // A snapshot BEFORE any revocation (the pre-disaster backup).
        const before = snapshotCapabilityStore(store, log, NOW_MS + 2_000);
        if (before === null) throw new Error("pre-revocation snapshot refused");

        // REVOKE the root: propagation revokes the child too + tombstone.
        const revoked = revokeCapabilityGrant(store, log, "grant-dr-root", NOW_MS + 3_000, "tenant-operator", "operator-initiated revocation");
        if (!revoked.ok) throw new Error(`revocation refused: ${revoked.reason}`);
        store = revoked.store;
        log = revoked.log;
        ctx.record("revoke.tombstoneRoot", revoked.tombstone?.rootGrantId ?? "none");
        ctx.record("revoke.tombstoneRevokedIds", revoked.tombstone?.revokedGrantIds ?? []);
        ctx.record("revoke.capabilityId", revoked.tombstone?.capabilityId ?? "none");
        ctx.record("revoke.reason", revoked.tombstone?.reason ?? "none");

        // A REVOKED grant DENIES at decision time.
        const denied = decideCapability(store, {
          policyId: tenantPolicy().id,
          capabilityId: READ_CAPABILITY.id,
          ctx: guardianCtx(READ_CAPABILITY, ANALYST),
          at: NOW_MS + 4_000,
        });
        if (!denied.ok) throw new Error("denied decision refused");
        ctx.record("revoke.decision.outcome", denied.decision.outcome);
        ctx.record("revoke.decision.outcomeReason", denied.decision.outcomeReason);
        ctx.record("revoke.decision.grantId", denied.decision.grantId);

        // RESTORE from the PRE-revocation snapshot + the post-snapshot log:
        // the tombstone replays OVER the snapshot — the grant stays revoked.
        const restored = restoreCapabilityStore(before, log);
        if (!restored.ok) throw new Error(`restore refused: ${restored.reason}`);
        ctx.record("dr.replayedTombstones", restored.replayedTombstones);
        const after = decideCapability(restored.store, {
          policyId: tenantPolicy().id,
          capabilityId: READ_CAPABILITY.id,
          ctx: guardianCtx(READ_CAPABILITY, ANALYST),
          at: NOW_MS + 5_000,
        });
        if (!after.ok) throw new Error("post-restore decision refused");
        ctx.record("dr.postRestore.outcome", after.decision.outcome);
        ctx.record("dr.postRestore.outcomeReason", after.decision.outcomeReason);

        // SNAPSHOT EQUIVALENCE over a decision corpus (byte-identical).
        const corpus: readonly DecisionCorpusCase[] = [
          { policyId: tenantPolicy().id, capabilityId: READ_CAPABILITY.id, ctx: guardianCtx(READ_CAPABILITY, ANALYST), at: NOW_MS + 5_000 },
          { policyId: tenantPolicy().id, capabilityId: READ_CAPABILITY.id, ctx: guardianCtx(READ_CAPABILITY, { actorId: "visitor-sam", authority: [], isAutonomous: false }), at: NOW_MS + 5_000 },
          { policyId: tenantPolicy().id, capabilityId: READ_CAPABILITY.id, ctx: guardianCtx(READ_CAPABILITY, OPERATOR), at: NOW_MS + 5_000 },
        ];
        const equivalence = verifySnapshotEquivalence(store, restored.store, corpus);
        ctx.record("dr.equivalence.equivalent", equivalence.equivalent);
        ctx.record("dr.equivalence.casesChecked", equivalence.casesChecked);
        ctx.record("dr.equivalence.divergedAt", equivalence.divergedAt);

        // A snapshot AFTER the revocation restores with zero replayed tombstones.
        const afterSnapshot = snapshotCapabilityStore(store, log, NOW_MS + 6_000);
        if (afterSnapshot === null) throw new Error("post-revocation snapshot refused");
        const restoredAfter = restoreCapabilityStore(afterSnapshot, log);
        if (!restoredAfter.ok) throw new Error(`post-revocation restore refused: ${restoredAfter.reason}`);
        ctx.record("dr.afterSnapshot.replayed", restoredAfter.replayedTombstones);

        // NEGATIVE: a TAMPERED snapshot REFUSES at restore.
        const tampered = {
          ...before,
          grants: before.grants.map((g) => (g.grantId === "grant-dr-root" ? { ...g, status: "revoked" as const } : g)),
        };
        const tamperedRestore = restoreCapabilityStore(tampered, log);
        ctx.record("dr.tamperedOk", tamperedRestore.ok);
        ctx.record("dr.tamperedReason", tamperedRestore.ok ? "unexpected-allow" : tamperedRestore.reason);

        // NEGATIVE: a CROSS-TENANT tombstone log REFUSES the restore.
        const foreignLog: RevocationLog = { tenantId: FOREIGN_TENANT.tenantId, tombstones: [] };
        const foreignRestore = restoreCapabilityStore(before, foreignLog);
        ctx.record("dr.crossLogOk", foreignRestore.ok);
        ctx.record("dr.crossLogReason", foreignRestore.ok ? "unexpected-allow" : foreignRestore.reason);
      },
    },
  ],
  assertions: [
    { assertionId: "cd-1", description: "An empty tenant cannot open a store", path: "store.openEmptyTenant", expected: null },
    { assertionId: "cd-2", description: "An empty tenant cannot open a revocation log", path: "store.openRevocationLogEmpty", expected: null },
    { assertionId: "cd-3", description: "Duplicate capability enrollment refused", path: "store.duplicateEnrollOk", expected: false },
    { assertionId: "cd-4", description: "Duplicate enrollment reason", path: "store.duplicateEnrollReason", expected: "store.duplicate-enrollment" },
    { assertionId: "cd-5", description: "Cross-tenant policy enrollment refused (A8)", path: "store.crossEnrollOk", expected: false },
    { assertionId: "cd-6", description: "Cross-tenant enrollment reason", path: "store.crossEnrollReason", expected: "store.tenant-mismatch" },
    { assertionId: "cd-7", description: "A duplicate grant id refused", path: "grant.duplicateOk", expected: false },
    { assertionId: "cd-8", description: "Duplicate grant reason", path: "grant.duplicateReason", expected: "store.grant-refused" },
    { assertionId: "cd-9", description: "Valid grant + Guardian allow => outcome allow", path: "decide.allow.outcome", expected: "allow" },
    { assertionId: "cd-10", description: "The authorizing grant is named", path: "decide.allow.grantId", expected: "grant-dr-child" },
    { assertionId: "cd-11", description: "The Guardian verdict itself is ALLOW", path: "decide.allow.guardianVerdict", expected: "ALLOW" },
    { assertionId: "cd-12", description: "Allow outcome reason", path: "decide.allow.outcomeReason", expected: "allow.matched_rule+grant" },
    { assertionId: "cd-13", description: "High-risk execute escalates even with a grant", path: "decide.escalate.outcome", expected: "escalate" },
    { assertionId: "cd-14", description: "The Guardian verdict is REQUIRE_APPROVAL", path: "decide.escalate.guardianVerdict", expected: "REQUIRE_APPROVAL" },
    { assertionId: "cd-15", description: "The escalation still names the valid grant", path: "decide.escalate.grantId", expected: "grant-dr-exec" },
    { assertionId: "cd-16", description: "Escalation reason carries the Guardian code", path: "decide.escalate.outcomeReason", expected: "require_approval.high_risk" },
    { assertionId: "cd-17", description: "No grant => escalate (never silent allow)", path: "decide.noGrant.outcome", expected: "escalate" },
    { assertionId: "cd-18", description: "No-grant reason", path: "decide.noGrant.outcomeReason", expected: "require_approval.no_grant" },
    { assertionId: "cd-19", description: "No grant is named on the no-grant path", path: "decide.noGrant.grantId", expected: null },
    { assertionId: "cd-20", description: "An unknown policy refuses the decision", path: "decide.unknownPolicyOk", expected: false },
    { assertionId: "cd-21", description: "The tombstone names the root grant", path: "revoke.tombstoneRoot", expected: "grant-dr-root" },
    { assertionId: "cd-22", description: "Revocation PROPAGATES to the derived grant", path: "revoke.tombstoneRevokedIds", expected: ["grant-dr-child", "grant-dr-root"] },
    { assertionId: "cd-23", description: "The tombstone carries the capability", path: "revoke.capabilityId", expected: "fleetos.asset.read-state" },
    { assertionId: "cd-24", description: "The revocation reason is recorded", path: "revoke.reason", expected: "operator-initiated revocation" },
    { assertionId: "cd-25", description: "A revoked grant DENIES at decision time", path: "revoke.decision.outcome", expected: "deny" },
    { assertionId: "cd-26", description: "Denial reason: grant.revoked (permanence)", path: "revoke.decision.outcomeReason", expected: "grant.revoked" },
    { assertionId: "cd-27", description: "No grant is named once revoked", path: "revoke.decision.grantId", expected: null },
    { assertionId: "cd-28", description: "The pre-revocation snapshot replays ONE tombstone at restore", path: "dr.replayedTombstones", expected: 1 },
    { assertionId: "cd-29", description: "REVOCATION PERMANENCE: the restored store still DENIES", path: "dr.postRestore.outcome", expected: "deny" },
    { assertionId: "cd-30", description: "Post-restore denial reason", path: "dr.postRestore.outcomeReason", expected: "grant.revoked" },
    { assertionId: "cd-31", description: "SNAPSHOT EQUIVALENCE holds over the corpus", path: "dr.equivalence.equivalent", expected: true },
    { assertionId: "cd-32", description: "Every corpus case checked", path: "dr.equivalence.casesChecked", expected: 3 },
    { assertionId: "cd-33", description: "No divergence point", path: "dr.equivalence.divergedAt", expected: null },
    { assertionId: "cd-34", description: "A post-revocation snapshot replays ZERO tombstones", path: "dr.afterSnapshot.replayed", expected: 0 },
    { assertionId: "cd-35", description: "A tampered snapshot REFUSES at restore (A19)", path: "dr.tamperedOk", expected: false },
    { assertionId: "cd-36", description: "Tamper refusal reason", path: "dr.tamperedReason", expected: "store.snapshot-digest-mismatch" },
    { assertionId: "cd-37", description: "A cross-tenant log REFUSES the restore (A8)", path: "dr.crossLogOk", expected: false },
    { assertionId: "cd-38", description: "Cross-tenant log reason", path: "dr.crossLogReason", expected: "store.tenant-mismatch" },
  ],
};
