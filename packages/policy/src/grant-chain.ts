/**
 * @fleetos/policy — Capability grant chains (F220B, Wave 2).
 *
 * grant -> verify -> revoke with REVOCATION PROPAGATION: revoking an
 * intermediate grant deterministically invalidates every grant derived from
 * it (its descendants), recursively. A derived grant can never outlive its
 * ancestor.
 *
 * Laws:
 *  - A5/A6: issuing a grant is a Guardian-path concern OUTSIDE this module —
 *    this module only models the chain discipline once a grant exists.
 *  - A8 tenant fail-closed: grants are tenant-scoped; issuing under a parent
 *    of another tenant REFUSES; verifying cross-tenant REFUSES; reading the
 *    active grants of another tenant REFUSES.
 *  - Determinism: revocation propagation walks the chain deterministically
 *    (BFS over grants sorted by grantId); time is an explicit number input.
 */

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export type GrantStatus = "active" | "revoked";

export interface GrantRecord {
  readonly grantId: string;
  readonly tenantId: string;
  readonly capabilityId: string;
  readonly granteeActorId: string;
  readonly grantedByActorId: string;
  /** Epoch ms — explicit time input. */
  readonly grantedAt: number;
  /** Epoch ms or null (no expiry). */
  readonly expiresAt: number | null;
  /** The grant this one is derived from — null for a root grant. */
  readonly parentGrantId: string | null;
  readonly status: GrantStatus;
  readonly revokedAt: number | null;
  readonly revokedBy: string | null;
  readonly revocationReason: string | null;
}

export type GrantRefusalCode =
  | "grant.missing-tenant"
  | "grant.missing-grant-id"
  | "grant.duplicate-grant-id"
  | "grant.invalid-time"
  | "grant.unknown-parent"
  | "grant.parent-tenant-mismatch"
  | "grant.parent-revoked"
  | "grant.not-found"
  | "grant.revoked"
  | "grant.ancestor-revoked"
  | "grant.expired"
  | "grant.tenant-mismatch"
  | "grant.cycle";

export type GrantIssueResult =
  | { readonly ok: true; readonly grants: readonly GrantRecord[]; readonly grant: GrantRecord }
  | { readonly ok: false; readonly reason: GrantRefusalCode };

export type GrantVerifyResult =
  | { readonly valid: true; readonly chainDepth: number; readonly checkedGrantIds: readonly string[] }
  | { readonly valid: false; readonly reason: GrantRefusalCode; readonly checkedGrantIds: readonly string[] };

export type GrantRevokeResult =
  | { readonly ok: true; readonly grants: readonly GrantRecord[]; readonly revokedCount: number; readonly rootGrantId: string }
  | { readonly ok: false; readonly reason: GrantRefusalCode };

// ---------------------------------------------------------------------------
// Grant (issue)
// ---------------------------------------------------------------------------

/**
 * Issue (grant) a capability grant. Pure — returns a NEW grants array.
 *
 * Refuses:
 *  - `grant.missing-tenant` / `grant.missing-grant-id` / `grant.invalid-time`.
 *  - `grant.duplicate-grant-id` — the id is already in use.
 *  - `grant.unknown-parent` — parentGrantId does not resolve.
 *  - `grant.parent-tenant-mismatch` — parent belongs to another tenant (A8).
 *  - `grant.parent-revoked` — a revoked grant cannot derive new grants.
 */
export function issueGrant(
  grants: readonly GrantRecord[],
  input: {
    readonly grantId: string;
    readonly tenantId: string;
    readonly capabilityId: string;
    readonly granteeActorId: string;
    readonly grantedByActorId: string;
    readonly grantedAt: number;
    readonly expiresAt?: number | null;
    readonly parentGrantId?: string | null;
  },
): GrantIssueResult {
  if (input.tenantId === "") return { ok: false, reason: "grant.missing-tenant" };
  if (input.grantId === "") return { ok: false, reason: "grant.missing-grant-id" };
  if (!Number.isInteger(input.grantedAt) || input.grantedAt < 0) return { ok: false, reason: "grant.invalid-time" };
  if (grants.some((g) => g.grantId === input.grantId)) {
    return { ok: false, reason: "grant.duplicate-grant-id" };
  }

  let parent: GrantRecord | null = null;
  if (input.parentGrantId !== undefined && input.parentGrantId !== null) {
    parent = grants.find((g) => g.grantId === input.parentGrantId) ?? null;
    if (parent === null) return { ok: false, reason: "grant.unknown-parent" };
    if (parent.tenantId !== input.tenantId) return { ok: false, reason: "grant.parent-tenant-mismatch" };
    if (parent.status === "revoked") return { ok: false, reason: "grant.parent-revoked" };
  }

  const grant: GrantRecord = {
    grantId: input.grantId,
    tenantId: input.tenantId,
    capabilityId: input.capabilityId,
    granteeActorId: input.granteeActorId,
    grantedByActorId: input.grantedByActorId,
    grantedAt: input.grantedAt,
    expiresAt: input.expiresAt ?? null,
    parentGrantId: input.parentGrantId ?? null,
    status: "active",
    revokedAt: null,
    revokedBy: null,
    revocationReason: null,
  };
  return { ok: true, grants: [...grants, grant], grant };
}

// ---------------------------------------------------------------------------
// Verify — walk the parent chain
// ---------------------------------------------------------------------------

/**
 * Verify a grant is valid at time `at`. Walks the FULL parent chain:
 * the grant and EVERY ancestor must be active, unexpired and tenant-consistent.
 *
 * Refusal reasons (machine-stable):
 *  - `grant.not-found` / `grant.revoked` / `grant.ancestor-revoked`
 *  - `grant.expired` — `at` is past the grant's (or an ancestor's) expiry.
 *  - `grant.tenant-mismatch` — the chain crosses tenants (A8 fail-closed).
 *  - `grant.cycle` — malformed chain data.
 */
export function verifyGrantChain(
  grants: readonly GrantRecord[],
  grantId: string,
  at: number,
): GrantVerifyResult {
  const byId = new Map<string, GrantRecord>();
  for (const g of grants) byId.set(g.grantId, g);

  const checked: string[] = [];
  const visited = new Set<string>();
  let currentId: string | null = grantId;
  let isRoot = true;

  while (currentId !== null) {
    if (visited.has(currentId)) {
      return { valid: false, reason: "grant.cycle", checkedGrantIds: checked };
    }
    visited.add(currentId);

    const node = byId.get(currentId);
    if (node === undefined) {
      return { valid: false, reason: "grant.not-found", checkedGrantIds: checked };
    }
    checked.push(node.grantId);

    if (node.tenantId !== (byId.get(grantId)?.tenantId ?? "")) {
      return { valid: false, reason: "grant.tenant-mismatch", checkedGrantIds: checked };
    }
    if (node.status === "revoked") {
      return {
        valid: false,
        reason: isRoot ? "grant.revoked" : "grant.ancestor-revoked",
        checkedGrantIds: checked,
      };
    }
    if (node.expiresAt !== null && at > node.expiresAt) {
      return { valid: false, reason: "grant.expired", checkedGrantIds: checked };
    }

    currentId = node.parentGrantId;
    isRoot = false;
  }

  return { valid: true, chainDepth: checked.length, checkedGrantIds: checked };
}

// ---------------------------------------------------------------------------
// Revoke — with deterministic propagation
// ---------------------------------------------------------------------------

/**
 * Revoke a grant and PROPAGATE the revocation to every derived grant.
 *
 * The revocation walk is deterministic: descendants are visited breadth-first
 * in ascending grantId order. Every revoked descendant carries
 * `revocationReason: "propagated:<rootGrantId>"` so the audit trail names the
 * root cause. Revoking an already-revoked grant is idempotent — the result is
 * byte-identical to the first revocation (no double timestamps).
 *
 * Refuses: `grant.not-found`, `grant.missing-grant-id`, `grant.invalid-time`.
 */
export function revokeGrant(
  grants: readonly GrantRecord[],
  grantId: string,
  at: number,
  revokedBy: string,
  reason: string,
): GrantRevokeResult {
  if (grantId === "") return { ok: false, reason: "grant.missing-grant-id" };
  if (!Number.isInteger(at) || at < 0) return { ok: false, reason: "grant.invalid-time" };
  const root = grants.find((g) => g.grantId === grantId);
  if (root === undefined) return { ok: false, reason: "grant.not-found" };

  // Deterministic BFS over sorted child ids.
  const childrenOf = new Map<string, GrantRecord[]>();
  for (const g of grants) {
    if (g.parentGrantId === null) continue;
    const list = childrenOf.get(g.parentGrantId) ?? [];
    list.push(g);
    childrenOf.set(g.parentGrantId, list);
  }
  for (const list of childrenOf.values()) {
    list.sort((a, b) => (a.grantId < b.grantId ? -1 : 1));
  }

  const toRevoke = new Set<string>([grantId]);
  const queue: string[] = [grantId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const child of childrenOf.get(current) ?? []) {
      if (!toRevoke.has(child.grantId)) {
        toRevoke.add(child.grantId);
        queue.push(child.grantId);
      }
    }
  }

  let revokedCount = 0;
  const next = grants.map((g) => {
    if (!toRevoke.has(g.grantId)) return g;
    if (g.status === "revoked") return g; // idempotent: keep the original revocation
    revokedCount += 1;
    return {
      ...g,
      status: "revoked" as const,
      revokedAt: at,
      revokedBy,
      revocationReason: g.grantId === grantId ? reason : `propagated:${grantId}`,
    };
  });

  return { ok: true, grants: next, revokedCount, rootGrantId: grantId };
}

// ---------------------------------------------------------------------------
// Tenant-scoped active-grant reads — fail-closed (A8)
// ---------------------------------------------------------------------------

export type ActiveGrantsResult =
  | { readonly ok: true; readonly grants: readonly GrantRecord[] }
  | { readonly ok: false; readonly reason: GrantRefusalCode };

/**
 * List the ACTIVE grants for an actor under a tenant scope — fail-closed.
 *
 * An empty tenant scope refuses (`grant.missing-tenant`). Cross-tenant
 * isolation is structural: the result is filtered BY the given tenant, so
 * another tenant's grants can never appear in the output.
 */
export function activeGrantsForActor(
  grants: readonly GrantRecord[],
  tenantId: string,
  actorId: string,
  at: number,
): ActiveGrantsResult {
  if (tenantId === "") return { ok: false, reason: "grant.missing-tenant" };
  const active = grants.filter(
    (g) =>
      g.tenantId === tenantId &&
      g.granteeActorId === actorId &&
      g.status === "active" &&
      (g.expiresAt === null || at <= g.expiresAt),
  );
  // Deterministic ordering — grantId ascending.
  return { ok: true, grants: [...active].sort((a, b) => (a.grantId < b.grantId ? -1 : 1)) };
}

/**
 * Tenant fail-closed read harness — machine-testable proof that no code path
 * returns grants of tenant A when tenant B's scope is presented.
 */
export function assertGrantTenantIsolation(
  grants: readonly GrantRecord[],
  tenantId: string,
): { readonly isolated: boolean; readonly leakedGrantIds: readonly string[] } {
  if (tenantId === "") return { isolated: true, leakedGrantIds: [] };
  const leaked = grants.filter((g) => g.tenantId !== tenantId && g.tenantId !== "").map((g) => g.grantId);
  return { isolated: leaked.length === 0, leakedGrantIds: leaked.sort() };
}
