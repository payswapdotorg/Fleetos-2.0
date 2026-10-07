/**
 * @fleetos/workloads — Workloads bounded context public contracts.
 *
 * Wave 0 lane C (F200C). Pure TypeScript domain package: types + pure
 * functions only. No I/O, no servers, no databases, no network, no providers.
 *
 * Laws satisfied here:
 *   A1, A4, A8, A20 — see ARCHITECTURE-LOCK.md.
 *
 * Honest overload detection (law A4): over-allocation is REFUSED with a
 * machine-stable reason code, NEVER silently clamped. The feasibility check
 * returns the exact over-capacity amount so callers can act on the truth.
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
// Capacity + allocation contracts
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
}

// ---------------------------------------------------------------------------
// Pure allocation feasibility check — honest overload detection, never
// silent clamping (law A4). Returns refusal with exact overshoot when the
// requested demand exceeds the available capacity.
// ---------------------------------------------------------------------------

export interface AllocationDemand {
  readonly owner: string;
  readonly tenant: TenantScope;
  readonly requestedUnits: number;
}

export type FeasibilityResult =
  | {
      ok: true;
      remainingUnits: number;
      utilizationRatio: number;
    }
  | { ok: false; reasonCode: FeasibilityReasonCode; overshootUnits: number };

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
  };
}
