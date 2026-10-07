/**
 * @fleetos/workloads — Workloads bounded context public contracts.
 *
 * Wave 1 lane C (F210C) kernel-grade.
 *
 * Laws: A1, A4 (refuse over-allocation, never clamp), A8 (tenant-scoped,
 * fail-closed), A19 (audit), A20.
 *
 * Wave 1 kernel-grade additions over Wave 0 (F200C):
 *   - feasibility checking with machine-stable reason codes (over-allocation REFUSED);
 *   - utilization read models;
 *   - rebalancing PROPOSALS (a rebalance is a proposal surface, never a
 *     silent mutation — law A4).
 *   - WorkloadDirectory over WorkloadRepositoryPort + in-memory reference.
 */

export interface TenantScope {
  readonly tenantId: string;
}

export type TenantValidation =
  | { ok: true; scope: TenantScope }
  | { ok: false; reasonCode: TenantReasonCode };

export type TenantReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "TENANT_ID_EMPTY"
  | "TENANT_ID_TOO_LONG"
  | "TENANT_ID_INVALID_CHARS";

const TENANT_PATTERN = /^[A-Za-z0-9_-]+$/;

export function validateTenantScope(scope: unknown): TenantValidation {
  if (scope === null || typeof scope !== "object") {
    return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  }
  const candidate = scope as Record<string, unknown>;
  const tenantId = candidate["tenantId"];
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    return { ok: false, reasonCode: "TENANT_ID_EMPTY" };
  }
  if (tenantId.length > 128) {
    return { ok: false, reasonCode: "TENANT_ID_TOO_LONG" };
  }
  if (!TENANT_PATTERN.test(tenantId)) {
    return { ok: false, reasonCode: "TENANT_ID_INVALID_CHARS" };
  }
  return { ok: true, scope: { tenantId } };
}

// ---------------------------------------------------------------------------
// Capacity + allocation contracts.
// ---------------------------------------------------------------------------

export interface WorkloadCapacity {
  readonly owner: string;
  readonly tenant: TenantScope;
  /** Maximum concurrent allocation units this owner can hold. */
  readonly maxUnits: number;
  /** Per-unit cost in abstract capacity units. */
  readonly unitCost: number;
}

export interface WorkloadAllocation {
  readonly owner: string;
  readonly tenant: TenantScope;
  /** Allocated units currently reserved against this owner's capacity. */
  readonly allocatedUnits: number;
  /** Reserved cost incurred by the current allocation. */
  readonly reservedCost: number;
}

export interface WorkloadUtilization {
  readonly owner: string;
  readonly tenant: TenantScope;
  readonly usedUnits: number;
  readonly maxUnits: number;
  readonly utilizationRatio: number;
  /** Honest flag: true iff usedUnits > maxUnits. Never silently clamped. */
  readonly overAllocated: boolean;
}

export interface AllocationDemand {
  readonly owner: string;
  readonly tenant: TenantScope;
  readonly requestedUnits: number;
}

// ---------------------------------------------------------------------------
// Pure allocation feasibility check — honest overload detection, never
// silent clamping (law A4). Returns refusal with exact overshoot when the
// requested demand exceeds the available capacity.
// ---------------------------------------------------------------------------

export type FeasibilityResult =
  | {
      readonly ok: true;
      readonly remainingUnits: number;
      readonly utilizationRatio: number;
    }
  | { readonly ok: false; readonly reasonCode: FeasibilityReasonCode; readonly overshootUnits: number };

export type FeasibilityReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "TENANT_MISMATCH"
  | "OWNER_MISMATCH"
  | "NEGATIVE_DEMAND"
  | "EXCEEDS_CAPACITY";

export function checkAllocationFeasibility(
  capacity: WorkloadCapacity,
  allocation: WorkloadAllocation,
  demand: AllocationDemand,
): FeasibilityResult {
  const tenantCap = validateTenantScope(capacity.tenant);
  if (!tenantCap.ok) return fail("TENANT_SCOPE_MISSING", 0);
  const tenantAlloc = validateTenantScope(allocation.tenant);
  if (!tenantAlloc.ok) return fail("TENANT_SCOPE_MISSING", 0);
  const tenantDemand = validateTenantScope(demand.tenant);
  if (!tenantDemand.ok) return fail("TENANT_SCOPE_MISSING", 0);

  if (
    tenantCap.scope.tenantId !== tenantAlloc.scope.tenantId ||
    tenantCap.scope.tenantId !== tenantDemand.scope.tenantId
  ) {
    return fail("TENANT_MISMATCH", 0);
  }

  if (capacity.owner !== allocation.owner || capacity.owner !== demand.owner) {
    return fail("OWNER_MISMATCH", 0);
  }

  if (demand.requestedUnits < 0 || allocation.allocatedUnits < 0) {
    return fail("NEGATIVE_DEMAND", 0);
  }

  const totalAfterDemand = allocation.allocatedUnits + demand.requestedUnits;
  if (totalAfterDemand > capacity.maxUnits) {
    return fail("EXCEEDS_CAPACITY", totalAfterDemand - capacity.maxUnits);
  }

  const remainingUnits = capacity.maxUnits - totalAfterDemand;
  const utilizationRatio = capacity.maxUnits === 0 ? 0 : totalAfterDemand / capacity.maxUnits;
  return { ok: true, remainingUnits, utilizationRatio };
}

function fail(
  reasonCode: FeasibilityReasonCode,
  overshootUnits: number,
): FeasibilityResult {
  return { ok: false, reasonCode, overshootUnits };
}

// ---------------------------------------------------------------------------
// Utilization projection — pure function. Never clamps; if inputs imply
// utilization > 1, that is the truth returned.
// ---------------------------------------------------------------------------

export function computeUtilization(
  capacity: WorkloadCapacity,
  allocation: WorkloadAllocation,
): WorkloadUtilization {
  const ratio = capacity.maxUnits === 0 ? 0 : allocation.allocatedUnits / capacity.maxUnits;
  return {
    owner: capacity.owner,
    tenant: capacity.tenant,
    usedUnits: allocation.allocatedUnits,
    maxUnits: capacity.maxUnits,
    utilizationRatio: ratio,
    overAllocated: allocation.allocatedUnits > capacity.maxUnits,
  };
}

// ---------------------------------------------------------------------------
// Rebalancing PROPOSALS. A rebalance is a proposal surface — never a
// silent mutation (law A4). The kernel produces a deterministic proposal;
// the composing application (TL at F211) routes it through Guardian +
// the mission runtime before applying.
// ---------------------------------------------------------------------------

export type RebalanceReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "TENANT_MISMATCH"
  | "NO_OVER_ALLOCATED_OWNERS"
  | "INSUFFICIENT_HEADROOM";

export interface RebalanceMove {
  readonly fromOwner: string;
  readonly toOwner: string;
  readonly units: number;
  readonly rationale: string;
}

export interface RebalanceProposal {
  readonly kind: "rebalance-proposal";
  readonly tenant: TenantScope;
  readonly moves: readonly RebalanceMove[];
  readonly generatedAt: string;
  /** Stable digest — byte-identical for byte-identical inputs. */
  readonly digest: string;
  /** Reason code explaining why the proposal has zero moves (when applicable). */
  readonly reasonCode: RebalanceReasonCode | null;
}

/**
 * proposeRebalance — pure factory. Produces a deterministic rebalance
 * proposal that moves units from over-allocated owners to owners with
 * headroom. Returns a proposal with zero moves + a stable reason code
 * when no rebalance is possible (no over-allocated owners, or no
 * headroom). NEVER mutates inputs.
 */
export function proposeRebalance(
  tenant: TenantScope,
  capacities: readonly WorkloadCapacity[],
  allocations: readonly WorkloadAllocation[],
  generatedAt: string,
): RebalanceProposal {
  const tenantCheck = validateTenantScope(tenant);
  if (!tenantCheck.ok) {
    return proposal(tenant, [], generatedAt, "TENANT_SCOPE_MISSING");
  }
  for (const c of capacities) {
    const tc = validateTenantScope(c.tenant);
    if (!tc.ok || tc.scope.tenantId !== tenantCheck.scope.tenantId) {
      return proposal(tenant, [], generatedAt, "TENANT_MISMATCH");
    }
  }
  for (const a of allocations) {
    const tc = validateTenantScope(a.tenant);
    if (!tc.ok || tc.scope.tenantId !== tenantCheck.scope.tenantId) {
      return proposal(tenant, [], generatedAt, "TENANT_MISMATCH");
    }
  }

  // Build per-owner state.
  const capByOwner = new Map<string, WorkloadCapacity>();
  for (const c of capacities) capByOwner.set(c.owner, c);
  const allocByOwner = new Map<string, WorkloadAllocation>();
  for (const a of allocations) allocByOwner.set(a.owner, a);

  const over: { owner: string; overshoot: number }[] = [];
  const under: { owner: string; headroom: number }[] = [];
  for (const [owner, cap] of capByOwner.entries()) {
    const alloc = allocByOwner.get(owner);
    const used = alloc?.allocatedUnits ?? 0;
    if (used > cap.maxUnits) {
      over.push({ owner, overshoot: used - cap.maxUnits });
    } else if (used < cap.maxUnits) {
      under.push({ owner, headroom: cap.maxUnits - used });
    }
  }

  if (over.length === 0) {
    return proposal(tenant, [], generatedAt, "NO_OVER_ALLOCATED_OWNERS");
  }
  if (under.length === 0) {
    return proposal(tenant, [], generatedAt, "INSUFFICIENT_HEADROOM");
  }

  // Deterministic ordering: over owners by descending overshoot, then by
  // owner id. Under owners by descending headroom, then by owner id.
  over.sort((a, b) => b.overshoot - a.overshoot || a.owner.localeCompare(b.owner));
  under.sort((a, b) => b.headroom - a.headroom || a.owner.localeCompare(b.owner));

  const moves: RebalanceMove[] = [];
  const remainingHeadroom = new Map<string, number>(
    under.map((u) => [u.owner, u.headroom]),
  );
  for (const o of over) {
    let toRelieve = o.overshoot;
    for (const u of under) {
      if (toRelieve <= 0) break;
      const headroom = remainingHeadroom.get(u.owner) ?? 0;
      if (headroom <= 0) continue;
      const move = Math.min(toRelieve, headroom);
      moves.push({
        fromOwner: o.owner,
        toOwner: u.owner,
        units: move,
        rationale: `move ${move} units from over-allocated ${o.owner} (overshoot ${o.overshoot}) to ${u.owner} (headroom ${u.headroom})`,
      });
      toRelieve -= move;
      remainingHeadroom.set(u.owner, headroom - move);
    }
  }

  return proposal(tenant, moves, generatedAt, null);
}

function proposal(
  tenant: TenantScope,
  moves: readonly RebalanceMove[],
  generatedAt: string,
  reasonCode: RebalanceReasonCode | null,
): RebalanceProposal {
  const digest = computeRebalanceDigest(tenant.tenantId, moves, generatedAt);
  return {
    kind: "rebalance-proposal",
    tenant,
    moves,
    generatedAt,
    digest,
    reasonCode,
  };
}

/**
 * computeRebalanceDigest — stable deterministic digest. Pure.
 */
export function computeRebalanceDigest(
  tenantId: string,
  moves: readonly RebalanceMove[],
  generatedAt: string,
): string {
  const parts = [
    tenantId,
    generatedAt,
    moves
      .map((m) => `${m.fromOwner}->${m.toOwner}:${m.units}`)
      .join("|"),
  ];
  let hash = 0x811c9dc5;
  const joined = parts.join("\u241f");
  for (let i = 0; i < joined.length; i++) {
    hash ^= joined.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return `rebalance_${hash.toString(16).padStart(8, "0")}`;
}
