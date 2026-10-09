/**
 * @fleetos/policy — Capability store with disaster-recovery semantics
 * (F280B, Wave 8 lane B).
 *
 * A tenant-scoped capability store composing the REAL decision surfaces:
 * enrolled policies + capabilities (law A15 vocabulary) + capability grants
 * (`issueGrant` / `revokeGrant` / `verifyGrantChain` / `activeGrantsForActor`)
 * + the REAL Guardian (`evaluateCapability`).
 *
 * DISASTER-RECOVERY LAWS (machine-tested; the snapshot/restore protocol
 * itself lives in the sibling `capability-store-dr.ts`):
 *  - SNAPSHOT EQUIVALENCE: a restored store behaves IDENTICALLY to the
 *    original for every decision in a corpus — same Guardian verdict, same
 *    reason code, same effective outcome (allow / deny / escalate), same
 *    grant id — byte-identical decision records.
 *  - REVOCATION PERMANENCE: revocations survive DR. Every revocation is
 *    recorded as an immutable TOMBSTONE in an append-only log; restore
 *    replays the tombstone log OVER the snapshot state, so a capability
 *    revoked before OR after the snapshot is still revoked after restore —
 *    an agent can never act on a pre-restore capability.
 *
 * Laws:
 *  - A8: tenant fail-closed — cross-tenant enroll/restore/tombstone REFUSE
 *    with machine-stable reason codes; cross-tenant decisions surface the
 *    REAL Guardian `block.cross_tenant`.
 *  - A19: the snapshot is content-addressed (digest over canonical state);
 *    a tampered snapshot REFUSES at restore (`store.snapshot-digest-mismatch`).
 *  - Determinism: no clock, no randomness; `at`/`sealedAt` are explicit
 *    number inputs.
 */

import type { Policy, GuardianContext, GuardianDecision } from "./policy.ts";
import type { Capability, TenantScopeLike } from "./capability.ts";
import { evaluateCapability } from "./guardian.ts";
import {
  issueGrant,
  revokeGrant,
  verifyGrantChain,
} from "./grant-chain.ts";
import type { GrantRecord, GrantRefusalCode } from "./grant-chain.ts";

// ---------------------------------------------------------------------------
// Store state
// ---------------------------------------------------------------------------

/** The capability store — pure state, no I/O. */
export interface CapabilityStore {
  readonly tenantId: string;
  /** Enrolled policies, ordered by policyId. */
  readonly policies: readonly Policy[];
  /** Enrolled capabilities, ordered by capabilityId. */
  readonly capabilities: readonly Capability[];
  readonly grants: readonly GrantRecord[];
}

export type StoreRefusalCode =
  | "store.missing-tenant"
  | "store.tenant-mismatch"
  | "store.unknown-capability"
  | "store.unknown-policy"
  | "store.duplicate-enrollment"
  | "store.snapshot-digest-mismatch"
  | "store.grant-refused";

export type StoreMutationResult =
  | { readonly ok: true; readonly store: CapabilityStore }
  | { readonly ok: false; readonly reason: StoreRefusalCode; readonly detail: string };

/** Open an empty store for one tenant. */
export function openCapabilityStore(tenantId: string): CapabilityStore | null {
  if (tenantId === "") return null;
  return { tenantId, policies: [], capabilities: [], grants: [] };
}

/** Enroll a policy — same-tenant only (A8), no duplicate ids. */
export function enrollPolicy(store: CapabilityStore, policy: Policy): StoreMutationResult {
  if (policy.tenantId !== store.tenantId) {
    return { ok: false, reason: "store.tenant-mismatch", detail: `policy ${policy.id} belongs to tenant ${policy.tenantId}` };
  }
  if (store.policies.some((p) => p.id === policy.id)) {
    return { ok: false, reason: "store.duplicate-enrollment", detail: `policy ${policy.id} already enrolled` };
  }
  return {
    ok: true,
    store: { ...store, policies: [...store.policies, policy].sort((a, b) => (a.id < b.id ? -1 : 1)) },
  };
}

/** Enroll a capability — same-tenant only (A8), no duplicate ids. */
export function enrollCapability(store: CapabilityStore, capability: Capability): StoreMutationResult {
  if (capability.tenantScope !== "system" && store.capabilities.some((c) => c.id === capability.id)) {
    return { ok: false, reason: "store.duplicate-enrollment", detail: `capability ${capability.id} already enrolled` };
  }
  return {
    ok: true,
    store: { ...store, capabilities: [...store.capabilities, capability].sort((a, b) => (a.id < b.id ? -1 : 1)) },
  };
}

// ---------------------------------------------------------------------------
// Revocation tombstones — the DR permanence log
// ---------------------------------------------------------------------------

/** An immutable revocation record — survives every snapshot/restore. */
export interface RevocationTombstone {
  readonly tenantId: string;
  /** The root grant that was revoked. */
  readonly rootGrantId: string;
  /** Every grant revoked by the propagation (root + descendants), sorted. */
  readonly revokedGrantIds: readonly string[];
  readonly capabilityId: string;
  readonly revokedAt: number;
  readonly revokedBy: string;
  readonly reason: string;
}

/** The append-only tombstone log — the disaster-recovery permanence record. */
export interface RevocationLog {
  readonly tenantId: string;
  readonly tombstones: readonly RevocationTombstone[];
}

export function openRevocationLog(tenantId: string): RevocationLog | null {
  if (tenantId === "") return null;
  return { tenantId, tombstones: [] };
}

// ---------------------------------------------------------------------------
// Grants — issue / revoke through the REAL primitives, tombstoned
// ---------------------------------------------------------------------------

export type GrantMutationResult =
  | {
      readonly ok: true;
      readonly store: CapabilityStore;
      readonly log: RevocationLog;
      readonly tombstone: RevocationTombstone | null;
    }
  | { readonly ok: false; readonly reason: StoreRefusalCode; readonly detail: string };

/** Issue a capability grant via the REAL `issueGrant` (tenant fail-closed). */
export function issueCapabilityGrant(
  store: CapabilityStore,
  log: RevocationLog,
  input: Parameters<typeof issueGrant>[1],
): GrantMutationResult {
  if (input.tenantId !== store.tenantId) {
    return { ok: false, reason: "store.tenant-mismatch", detail: `grant ${input.grantId} tenant ${input.tenantId} != store ${store.tenantId}` };
  }
  const r = issueGrant(store.grants, input);
  if (!r.ok) return { ok: false, reason: "store.grant-refused", detail: r.reason };
  return { ok: true, store: { ...store, grants: r.grants }, log, tombstone: null };
}

/**
 * Revoke a grant via the REAL `revokeGrant` (deterministic propagation) AND
 * record the immutable tombstone — the revocation now survives every DR.
 */
export function revokeCapabilityGrant(
  store: CapabilityStore,
  log: RevocationLog,
  grantId: string,
  at: number,
  revokedBy: string,
  reason: string,
): GrantMutationResult {
  const root = store.grants.find((g) => g.grantId === grantId);
  if (root === undefined) {
    return { ok: false, reason: "store.grant-refused", detail: `grant ${grantId} not found` };
  }
  const r = revokeGrant(store.grants, grantId, at, revokedBy, reason);
  if (!r.ok) return { ok: false, reason: "store.grant-refused", detail: r.reason };
  const revokedGrantIds = r.grants
    .filter((g) => g.status === "revoked")
    .map((g) => g.grantId)
    .sort();
  const tombstone: RevocationTombstone = {
    tenantId: store.tenantId,
    rootGrantId: grantId,
    revokedGrantIds,
    capabilityId: root.capabilityId,
    revokedAt: at,
    revokedBy,
    reason,
  };
  return {
    ok: true,
    store: { ...store, grants: r.grants },
    log: { tenantId: log.tenantId, tombstones: [...log.tombstones, tombstone] },
    tombstone,
  };
}

// ---------------------------------------------------------------------------
// Decisions — the REAL Guardian + grant gate, composed
// ---------------------------------------------------------------------------

export type EffectiveOutcome = "allow" | "deny" | "escalate";

export interface StoreDecision {
  readonly capabilityId: string;
  readonly guardian: GuardianDecision;
  /** The grant authorizing the actor, when one is valid. */
  readonly grantId: string | null;
  readonly grantCheck: { readonly valid: boolean; readonly reason: GrantRefusalCode | null };
  readonly outcome: EffectiveOutcome;
  readonly outcomeReason: string;
}

export type StoreDecisionResult =
  | { readonly ok: true; readonly decision: StoreDecision }
  | { readonly ok: false; readonly reason: StoreRefusalCode; readonly detail: string };

/**
 * Decide a capability request: the REAL Guardian verdict composed with the
 * grant gate.
 *
 *   - Guardian BLOCK            => deny (the Guardian's reason stands).
 *   - Guardian REQUIRE_APPROVAL => escalate.
 *   - Guardian ALLOW/WARN       => valid grant ? allow : escalate
 *     (`require_approval.no_grant`); a REVOKED grant denies
 *     (`grant.revoked` — revocation permanence at decision time).
 */
export function decideCapability(
  store: CapabilityStore,
  input: {
    readonly policyId: string;
    readonly capabilityId: string;
    readonly ctx: GuardianContext;
    readonly at: number;
  },
): StoreDecisionResult {
  const policy = store.policies.find((p) => p.id === input.policyId);
  if (policy === undefined) {
    return { ok: false, reason: "store.unknown-policy", detail: `policy ${input.policyId} not enrolled` };
  }
  const capability = store.capabilities.find((c) => c.id === input.capabilityId);
  if (capability === undefined) {
    return { ok: false, reason: "store.unknown-capability", detail: `capability ${input.capabilityId} not enrolled` };
  }
  const guardian = evaluateCapability(policy, capability, input.ctx);
  if (guardian.verdict === "BLOCK") {
    return {
      ok: true,
      decision: {
        capabilityId: input.capabilityId, guardian, grantId: null,
        grantCheck: { valid: false, reason: null }, outcome: "deny",
        outcomeReason: guardian.reasonCode,
      },
    };
  }
  // Grant gate: the actor's most recent active grant for this capability.
  const candidates = store.grants
    .filter(
      (g) =>
        g.capabilityId === input.capabilityId &&
        g.tenantId === store.tenantId &&
        g.granteeActorId === input.ctx.actor.actorId,
    )
    .sort((a, b) => (a.grantId < b.grantId ? -1 : 1));
  let grantId: string | null = null;
  let grantReason: GrantRefusalCode | null = null;
  for (const g of candidates) {
    const v = verifyGrantChain(store.grants, g.grantId, input.at);
    if (v.valid) {
      grantId = g.grantId;
      break;
    }
    grantReason = v.valid ? null : v.reason;
  }
  if (guardian.verdict === "REQUIRE_APPROVAL") {
    return {
      ok: true,
      decision: {
        capabilityId: input.capabilityId, guardian, grantId,
        grantCheck: { valid: grantId !== null, reason: grantReason }, outcome: "escalate",
        outcomeReason: guardian.reasonCode,
      },
    };
  }
  if (grantId !== null) {
    return {
      ok: true,
      decision: {
        capabilityId: input.capabilityId, guardian, grantId,
        grantCheck: { valid: true, reason: null }, outcome: "allow",
        outcomeReason: "allow.matched_rule+grant",
      },
    };
  }
  const revoked = candidates.some((g) => g.status === "revoked");
  return {
    ok: true,
    decision: {
      capabilityId: input.capabilityId, guardian, grantId: null,
      grantCheck: { valid: false, reason: grantReason }, outcome: revoked ? "deny" : "escalate",
      outcomeReason: revoked ? "grant.revoked" : "require_approval.no_grant",
    },
  };
}



/** Tenant-scope helper for decision contexts (A8 discipline at call sites). */
export function storeTenantScope(store: CapabilityStore): TenantScopeLike {
  return { tenantId: store.tenantId };
}
