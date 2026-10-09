/**
 * Capability-store DR tests (F280B, Wave 8 lane B).
 *
 * Behavior under test: snapshot/restore equivalence over a decision corpus
 * (allow/deny/escalate, byte-identical decisions), revocation permanence
 * across restore (pre- AND post-snapshot revocations survive DR), tampered
 * snapshot refusal, and A8 cross-tenant fail-closed probes with the REAL
 * Guardian `block.cross_tenant` surfacing on cross-tenant decisions.
 */
import { describe, it, expect } from "vitest";
import {
  openCapabilityStore,
  openRevocationLog,
  enrollPolicy,
  enrollCapability,
  issueCapabilityGrant,
  revokeCapabilityGrant,
  decideCapability,
  snapshotCapabilityStore,
  restoreCapabilityStore,
  verifySnapshotEquivalence,
} from "../src/index.ts";
import type {
  CapabilityStore,
  DecisionCorpusCase,
  Policy,
  PolicyRule,
  Capability,
  GuardianContext,
  RevocationLog,
} from "../src/index.ts";

const TENANT = "tnt_dr";
const T0 = 1_774_000_000_000;

function readCap(): Capability {
  return {
    id: "cap.read.health", category: "read", risk: "low",
    requiredAuthority: ["tenant.engineer"], tenantScope: "single",
    resourceScope: { assetIds: ["asset-1"] }, sideEffects: [],
    idempotency: { supported: true, keyShape: ["tenantId", "assetId"] },
    verification: { kind: "domain.read" }, inputs: ["assetId"], outputs: ["healthSummary"],
    description: "Read asset health summary", version: "1.0.0",
  };
}

function execCap(): Capability {
  return {
    id: "cap.execute.device.restart", category: "execute.device", risk: "high",
    requiredAuthority: ["asset.owner", "human.approval"], tenantScope: "single",
    resourceScope: { assetIds: ["asset-1"] },
    sideEffects: [{ kind: "device.command", target: "asset-1", reversible: false, description: "restart" }],
    idempotency: { supported: true, keyShape: ["tenantId", "assetId"] },
    verification: { kind: "device.ack", timeoutMs: 30_000 },
    inputs: ["assetId"], outputs: ["restartReceipt"],
    description: "Restart a managed device", version: "1.0.0",
  };
}

function policy(): Policy {
  const allowRead: PolicyRule = {
    id: "rule.allow_low_risk_read", description: "allow low-risk reads",
    riskFloor: "none", riskCeiling: "low", requiredAuthority: ["tenant.engineer"],
    tenantScope: "any", verdict: "ALLOW", priority: 10,
  };
  const requireApproval: PolicyRule = {
    id: "rule.require_human_approval_for_high_risk", description: "high risk needs approval",
    riskFloor: "medium", riskCeiling: "irreversible", requiredAuthority: ["asset.owner", "human.approval"],
    tenantScope: "any", verdict: "ALLOW", priority: 20,
  };
  return { id: "pol-1", version: "1.0.0", tenantId: TENANT, rules: [allowRead, requireApproval], defaultVerdict: "BLOCK", failClosed: true };
}

function ctxFor(actorId: string, authority: readonly string[], autonomous = false): GuardianContext {
  return {
    tenant: { tenantId: TENANT },
    capability: readCap(),
    actor: { actorId, authority: authority as GuardianContext["actor"]["authority"], isAutonomous: autonomous },
    degraded: false,
  };
}

/** Restore helper — fails loudly if a fixture restore ever refuses. */
function mustRestore(snapshot: ReturnType<typeof snapshotCapabilityStore>, log: RevocationLog) {
  if (snapshot === null) throw new Error("fixture snapshot failed");
  const r = restoreCapabilityStore(snapshot, log);
  if (!r.ok) throw new Error(`fixture restore refused: ${r.reason}`);
  return r;
}

/** Decide helper — fails loudly if a fixture decision ever refuses. */
function mustDecide(store: CapabilityStore, c: DecisionCorpusCase) {
  const r = decideCapability(store, c);
  if (!r.ok) throw new Error(`fixture decision refused: ${r.reason}`);
  return r.decision;
}

/** Fixture helper — fails loudly if a seeded mutation ever refuses. */
function must<T extends { readonly ok: boolean }>(r: T): Extract<T, { readonly ok: true }> {
  if (!r.ok) throw new Error("seeded mutation refused");
  return r as Extract<T, { readonly ok: true }>;
}

function seededStore(): { store: CapabilityStore; log: RevocationLog } {
  let store = openCapabilityStore(TENANT)!;
  let log = openRevocationLog(TENANT)!;
  store = must(enrollPolicy(store, policy())).store;
  store = must(enrollCapability(store, readCap())).store;
  store = must(enrollCapability(store, execCap())).store;
  // engineer-1 holds a read grant; operator-1 holds an exec grant.
  const r1 = must(issueCapabilityGrant(store, log, {
    grantId: "g-read-1", tenantId: TENANT, capabilityId: "cap.read.health",
    granteeActorId: "engineer-1", grantedByActorId: "admin", grantedAt: T0,
  }));
  store = r1.store; log = r1.log;
  const r2 = must(issueCapabilityGrant(store, log, {
    grantId: "g-exec-1", tenantId: TENANT, capabilityId: "cap.execute.device.restart",
    granteeActorId: "operator-1", grantedByActorId: "admin", grantedAt: T0,
  }));
  store = r2.store; log = r2.log;
  return { store, log };
}

/** The decision corpus: allow / deny / escalate, granted / grantless. */
function corpus(): readonly DecisionCorpusCase[] {
  return [
    { policyId: "pol-1", capabilityId: "cap.read.health", ctx: ctxFor("engineer-1", ["tenant.engineer"]), at: T0 + 1_000 },
    { policyId: "pol-1", capabilityId: "cap.read.health", ctx: ctxFor("engineer-2", ["tenant.engineer"]), at: T0 + 1_000 },
    { policyId: "pol-1", capabilityId: "cap.execute.device.restart", ctx: ctxFor("operator-1", ["asset.owner", "human.approval"]), at: T0 + 1_000 },
    { policyId: "pol-1", capabilityId: "cap.execute.device.restart", ctx: ctxFor("operator-2", ["asset.owner"]), at: T0 + 1_000 },
    { policyId: "pol-1", capabilityId: "cap.execute.device.restart", ctx: ctxFor("agent-1", ["guardian.autonomous"], true), at: T0 + 1_000 },
  ];
}

describe("capability store — decisions over the REAL Guardian", () => {
  it("composes allow / escalate / deny across the corpus", () => {
    const { store } = seededStore();
    const outcomes = corpus().map((c) => mustDecide(store, c).outcome);
    // allow: granted read; escalate: grantless read, high-risk-with-grant;
    // deny: high-risk without required authority (fail-closed no-matching-rule),
    // autonomous self-authorization on high risk.
    expect(outcomes).toEqual(["allow", "escalate", "escalate", "deny", "deny"]);
  });

  it("an allow carries the authorizing grant id; a grantless ALLOW escalates honestly", () => {
    const { store } = seededStore();
    const allow = mustDecide(store, corpus()[0]!);
    expect(allow.outcome).toBe("allow");
    expect(allow.grantId).toBe("g-read-1");
    const grantless = mustDecide(store, corpus()[1]!);
    expect(grantless.outcome).toBe("escalate");
    expect(grantless.outcomeReason).toBe("require_approval.no_grant");
  });

  it("high risk escalates even with a grant (REAL Guardian REQUIRE_APPROVAL)", () => {
    const { store } = seededStore();
    const d = mustDecide(store, corpus()[2]!);
    expect(d.guardian.verdict).toBe("REQUIRE_APPROVAL");
    expect(d.outcome).toBe("escalate");
    expect(d.grantId).toBe("g-exec-1");
  });

  it("autonomous self-authorization denies via the REAL Guardian reason", () => {
    const { store } = seededStore();
    const d = mustDecide(store, corpus()[4]!);
    expect(d.outcome).toBe("deny");
    expect(d.guardian.reasonCode).toBe("block.self_authorization");
  });

  it("an actor missing required authority denies fail-closed (no matching rule)", () => {
    const { store } = seededStore();
    const d = mustDecide(store, corpus()[3]!);
    expect(d.outcome).toBe("deny");
    expect(d.guardian.reasonCode).toBe("block.no_matching_rule");
  });

  it("refuses unknown policy/capability enrollments honestly", () => {
    const { store } = seededStore();
    const r = decideCapability(store, { policyId: "pol-x", capabilityId: "cap.read.health", ctx: ctxFor("e", ["tenant.engineer"]), at: T0 });
    expect(r).toMatchObject({ ok: false, reason: "store.unknown-policy" });
    const r2 = decideCapability(store, { policyId: "pol-1", capabilityId: "cap.x", ctx: ctxFor("e", ["tenant.engineer"]), at: T0 });
    expect(r2).toMatchObject({ ok: false, reason: "store.unknown-capability" });
  });
});

describe("capability store — snapshot/restore equivalence (the DR law)", () => {
  it("SNAPSHOT EQUIVALENCE: restored store decides the corpus identically", () => {
    const { store, log } = seededStore();
    const snapshot = snapshotCapabilityStore(store, log, T0 + 5_000)!;
    const restored = mustRestore(snapshot, openRevocationLog(TENANT)!);
    const result = verifySnapshotEquivalence(store, restored.store, corpus());
    expect(result).toMatchObject({ equivalent: true, casesChecked: 5, divergedAt: null });
  });

  it("the snapshot is content-addressed and deterministic", () => {
    const { store, log } = seededStore();
    const a = snapshotCapabilityStore(store, log, T0 + 5_000)!;
    const b = snapshotCapabilityStore(store, log, T0 + 5_000)!;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.snapshotDigest).toMatch(/^[0-9a-f]{8}$/);
  });

  it("a tampered snapshot REFUSES at restore, naming the digest law", () => {
    const { store, log } = seededStore();
    const snapshot = snapshotCapabilityStore(store, log, T0 + 5_000)!;
    const tampered = { ...snapshot, sealedAt: snapshot.sealedAt + 1 };
    const r = restoreCapabilityStore(tampered, openRevocationLog(TENANT)!);
    expect(r).toMatchObject({ ok: false, reason: "store.snapshot-digest-mismatch" });
  });

  it("equivalence detection pins the FIRST divergent corpus case", () => {
    const { store, log } = seededStore();
    const snapshot = snapshotCapabilityStore(store, log, T0 + 5_000)!;
    const restored = mustRestore(snapshot, openRevocationLog(TENANT)!);
    // Hand-diverge the restored store: drop the read grant.
    const diverged: CapabilityStore = {
      ...restored.store,
      grants: restored.store.grants.filter((g) => g.grantId !== "g-read-1"),
    };
    const result = verifySnapshotEquivalence(store, diverged, corpus());
    expect(result.equivalent).toBe(false);
    expect(result.divergedAt).toBe(0);
    expect(result.divergenceDetail).toContain("cap.read.health");
  });
});

describe("capability store — revocation permanence across DR", () => {
  it("a PRE-snapshot revocation survives restore (grant cannot act post-DR)", () => {
    let { store, log } = seededStore();
    // Revoke the engineer's read grant BEFORE the snapshot.
    const rev = must(revokeCapabilityGrant(store, log, "g-read-1", T0 + 2_000, "admin", "compromise"));
    store = rev.store; log = rev.log;
    expect(rev.tombstone).toMatchObject({ rootGrantId: "g-read-1", capabilityId: "cap.read.health" });
    const snapshot = snapshotCapabilityStore(store, log, T0 + 5_000)!;
    const restored = mustRestore(snapshot, openRevocationLog(TENANT)!);
    const d = mustDecide(restored.store, corpus()[0]!);
    expect(d.outcome).toBe("deny");
    expect(d.outcomeReason).toBe("grant.revoked");
  });

  it("a POST-snapshot revocation survives restore (tombstone log replay)", () => {
    const { store, log } = seededStore();
    const snapshot = snapshotCapabilityStore(store, log, T0 + 5_000)!;
    // Revoke AFTER the snapshot — the live store moves on, DR restores the
    // OLD snapshot, but the tombstone log carries the revocation forward.
    const rev = must(revokeCapabilityGrant(store, log, "g-read-1", T0 + 6_000, "admin", "incident"));
    const restored = mustRestore(snapshot, rev.log);
    expect(restored.replayedTombstones).toBe(1);
    const d = mustDecide(restored.store, corpus()[0]!);
    expect(d.outcome).toBe("deny");
    expect(d.outcomeReason).toBe("grant.revoked");
    // The snapshot WITHOUT the tombstone log would have resurrected the grant
    // — the equivalence check against the live (revoked) store proves the
    // tombstone replay preserved the revocation.
    const live = rev.store;
    expect(verifySnapshotEquivalence(live, restored.store, corpus()).equivalent).toBe(true);
  });

  it("revocation PROPAGATION is tombstoned: derived grants stay revoked after DR", () => {
    let { store, log } = seededStore();
    const child = must(issueCapabilityGrant(store, log, {
      grantId: "g-read-1-child", tenantId: TENANT, capabilityId: "cap.read.health",
      granteeActorId: "engineer-3", grantedByActorId: "engineer-1",
      grantedAt: T0 + 100, parentGrantId: "g-read-1",
    }));
    store = child.store; log = child.log;
    const rev = must(revokeCapabilityGrant(store, log, "g-read-1", T0 + 2_000, "admin", "compromise"));
    store = rev.store; log = rev.log;
    expect(rev.tombstone!.revokedGrantIds).toEqual(["g-read-1", "g-read-1-child"]);
    const snapshot = snapshotCapabilityStore(store, log, T0 + 5_000)!;
    const restored = mustRestore(snapshot, openRevocationLog(TENANT)!);
    const d = mustDecide(restored.store, {
      policyId: "pol-1", capabilityId: "cap.read.health",
      ctx: ctxFor("engineer-3", ["tenant.engineer"]), at: T0 + 6_000,
    });
    expect(d.outcome).toBe("deny");
    expect(d.outcomeReason).toBe("grant.revoked");
  });

  it("an unrevoked grant still allows after DR (permanence is not over-blocking)", () => {
    const { store, log } = seededStore();
    const snapshot = snapshotCapabilityStore(store, log, T0 + 5_000)!;
    const restored = mustRestore(snapshot, openRevocationLog(TENANT)!);
    const d = mustDecide(restored.store, corpus()[0]!);
    expect(d.outcome).toBe("allow");
    expect(d.grantId).toBe("g-read-1");
  });
});

describe("capability store — A8 tenant fail-closed", () => {
  it("refuses enrolling another tenant's policy", () => {
    const store = openCapabilityStore(TENANT)!;
    const foreign = { ...policy(), tenantId: "tnt_other" };
    expect(enrollPolicy(store, foreign)).toMatchObject({
      ok: false, reason: "store.tenant-mismatch",
    });
  });

  it("refuses issuing a grant for another tenant", () => {
    const { store, log } = seededStore();
    const r = issueCapabilityGrant(store, log, {
      grantId: "g-x", tenantId: "tnt_other", capabilityId: "cap.read.health",
      granteeActorId: "x", grantedByActorId: "admin", grantedAt: T0,
    });
    expect(r).toMatchObject({ ok: false, reason: "store.tenant-mismatch" });
  });

  it("a cross-tenant decision context surfaces the REAL Guardian block.cross_tenant", () => {
    const { store } = seededStore();
    const foreignCtx: GuardianContext = {
      ...ctxFor("engineer-9", ["tenant.engineer"]),
      tenant: { tenantId: "tnt_other" },
    };
    const d = mustDecide(store, {
      policyId: "pol-1", capabilityId: "cap.read.health", ctx: foreignCtx, at: T0,
    });
    expect(d.outcome).toBe("deny");
    expect(d.guardian.reasonCode).toBe("block.cross_tenant");
  });

  it("refuses restoring with a cross-tenant tombstone log", () => {
    const { store, log } = seededStore();
    const snapshot = snapshotCapabilityStore(store, log, T0 + 5_000)!;
    const foreignLog = openRevocationLog("tnt_other")!;
    const r = restoreCapabilityStore(snapshot, foreignLog);
    expect(r).toMatchObject({ ok: false, reason: "store.tenant-mismatch" });
  });

  it("refuses an empty tenant scope at open", () => {
    expect(openCapabilityStore("")).toBeNull();
    expect(openRevocationLog("")).toBeNull();
  });
});
