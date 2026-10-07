/**
 * @fleetos/workloads — Audit event contract + directory + repository port
 * + in-memory reference (kernel grade).
 */

import type { TenantScope } from "./contracts.js";
import { validateTenantScope } from "./contracts.js";
import type {
  WorkloadCapacity,
  WorkloadAllocation,
  WorkloadUtilization,
  AllocationDemand,
  RebalanceProposal,
  FeasibilityResult,
} from "./contracts.js";
import {
  checkAllocationFeasibility,
  computeUtilization,
  proposeRebalance,
} from "./contracts.js";

// ---------------------------------------------------------------------------
// Audit event contract (law A19).
// ---------------------------------------------------------------------------

export type AuditEventKind =
  | "workload.allocation-checked"
  | "workload.allocation-applied"
  | "workload.rebalance-proposed"
  | "workload.allocation-refused";

export interface AuditEvent {
  readonly kind: AuditEventKind;
  readonly tenant: TenantScope;
  readonly owner: string;
  readonly occurredAt: string;
  readonly digest: string;
  readonly reasonCode: string | null;
  readonly overshootUnits: number | null;
  readonly moveCount: number | null;
}

export function computeAuditDigest(inputs: {
  readonly kind: AuditEventKind;
  readonly tenantId: string;
  readonly owner: string;
  readonly occurredAt: string;
  readonly reasonCode: string | null;
}): string {
  const parts = [
    inputs.kind,
    inputs.tenantId,
    inputs.owner,
    inputs.occurredAt,
    inputs.reasonCode ?? "",
  ];
  let hash = 0x811c9dc5;
  const joined = parts.join("\u241f");
  for (let i = 0; i < joined.length; i++) {
    hash ^= joined.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return `audit_${hash.toString(16).padStart(8, "0")}`;
}

export function makeAuditEvent(inputs: {
  readonly kind: AuditEventKind;
  readonly tenant: TenantScope;
  readonly owner: string;
  readonly occurredAt: string;
  readonly reasonCode?: string | null;
  readonly overshootUnits?: number | null;
  readonly moveCount?: number | null;
}): AuditEvent {
  const digest = computeAuditDigest({
    kind: inputs.kind,
    tenantId: inputs.tenant.tenantId,
    owner: inputs.owner,
    occurredAt: inputs.occurredAt,
    reasonCode: inputs.reasonCode ?? null,
  });
  return {
    kind: inputs.kind,
    tenant: inputs.tenant,
    owner: inputs.owner,
    occurredAt: inputs.occurredAt,
    digest,
    reasonCode: inputs.reasonCode ?? null,
    overshootUnits: inputs.overshootUnits ?? null,
    moveCount: inputs.moveCount ?? null,
  };
}

// ---------------------------------------------------------------------------
// Repository port + in-memory reference.
// ---------------------------------------------------------------------------

export interface WorkloadRepositoryPort {
  loadCapacity(tenant: TenantScope, owner: string): Promise<WorkloadCapacity | null>;
  storeCapacity(tenant: TenantScope, capacity: WorkloadCapacity): Promise<void>;
  listCapacities(tenant: TenantScope): Promise<readonly WorkloadCapacity[]>;
  loadAllocation(tenant: TenantScope, owner: string): Promise<WorkloadAllocation | null>;
  storeAllocation(tenant: TenantScope, allocation: WorkloadAllocation): Promise<void>;
  listAllocations(tenant: TenantScope): Promise<readonly WorkloadAllocation[]>;
}

export function createInMemoryWorkloadRepository(
  initialCapacities?: readonly WorkloadCapacity[],
  initialAllocations?: readonly WorkloadAllocation[],
): WorkloadRepositoryPort {
  const capacities = new Map<string, WorkloadCapacity>();
  const allocations = new Map<string, WorkloadAllocation>();
  for (const c of initialCapacities ?? []) {
    capacities.set(`${c.tenant.tenantId}::${c.owner}`, c);
  }
  for (const a of initialAllocations ?? []) {
    allocations.set(`${a.tenant.tenantId}::${a.owner}`, a);
  }
  return {
    async loadCapacity(tenant, owner) {
      const tc = validateTenantScope(tenant);
      if (!tc.ok) return null;
      return capacities.get(`${tc.scope.tenantId}::${owner}`) ?? null;
    },
    async storeCapacity(tenant, capacity) {
      const tc = validateTenantScope(tenant);
      if (!tc.ok) return;
      if (capacity.tenant.tenantId !== tc.scope.tenantId) return;
      capacities.set(`${tc.scope.tenantId}::${capacity.owner}`, capacity);
    },
    async listCapacities(tenant) {
      const tc = validateTenantScope(tenant);
      if (!tc.ok) return [];
      const prefix = `${tc.scope.tenantId}::`;
      const out: WorkloadCapacity[] = [];
      for (const [k, c] of capacities.entries()) {
        if (!k.startsWith(prefix)) continue;
        out.push(c);
      }
      out.sort((a, b) => a.owner.localeCompare(b.owner));
      return out;
    },
    async loadAllocation(tenant, owner) {
      const tc = validateTenantScope(tenant);
      if (!tc.ok) return null;
      return allocations.get(`${tc.scope.tenantId}::${owner}`) ?? null;
    },
    async storeAllocation(tenant, allocation) {
      const tc = validateTenantScope(tenant);
      if (!tc.ok) return;
      if (allocation.tenant.tenantId !== tc.scope.tenantId) return;
      allocations.set(`${tc.scope.tenantId}::${allocation.owner}`, allocation);
    },
    async listAllocations(tenant) {
      const tc = validateTenantScope(tenant);
      if (!tc.ok) return [];
      const prefix = `${tc.scope.tenantId}::`;
      const out: WorkloadAllocation[] = [];
      for (const [k, a] of allocations.entries()) {
        if (!k.startsWith(prefix)) continue;
        out.push(a);
      }
      out.sort((a, b) => a.owner.localeCompare(b.owner));
      return out;
    },
  };
}

// ---------------------------------------------------------------------------
// Directory.
// ---------------------------------------------------------------------------

export type DirectoryReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "TENANT_MISMATCH"
  | "OWNER_MISMATCH"
  | "NEGATIVE_DEMAND"
  | "EXCEEDS_CAPACITY"
  | "CAPACITY_NOT_FOUND";

export interface DirectorySuccess {
  readonly ok: true;
  readonly auditEvents: readonly AuditEvent[];
  readonly feasibility?: FeasibilityResult;
  readonly utilization?: WorkloadUtilization;
  readonly proposal?: RebalanceProposal;
}

export interface DirectoryRefusal {
  readonly ok: false;
  readonly reasonCode: DirectoryReasonCode;
  readonly overshootUnits?: number;
  readonly auditEvents?: readonly AuditEvent[];
}

export type DirectoryResult = DirectorySuccess | DirectoryRefusal;

export interface WorkloadDirectory {
  /**
   * Check feasibility of a demand against the current allocation. Pure
   * projection — does NOT mutate. Returns the feasibility result + an
   * audit event.
   */
  checkFeasibility(
    tenant: TenantScope,
    demand: AllocationDemand,
    options: { readonly occurredAt: string },
  ): Promise<DirectoryResult>;

  /**
   * Apply an allocation demand. REFUSES over-allocation; never silently
   * clamps. On success, persists the new allocation.
   */
  applyAllocation(
    tenant: TenantScope,
    demand: AllocationDemand,
    options: { readonly occurredAt: string },
  ): Promise<DirectoryResult>;

  /**
   * Read the utilization projection for an owner.
   */
  readUtilization(
    tenant: TenantScope,
    owner: string,
  ): Promise<WorkloadUtilization | null>;

  /**
   * Produce a rebalancing PROPOSAL across all owners in the tenant.
   * Pure — does not mutate.
   */
  proposeRebalance(
    tenant: TenantScope,
    options: { readonly generatedAt: string },
  ): Promise<RebalanceProposal>;
}

export function createWorkloadDirectory(
  repository: WorkloadRepositoryPort,
): WorkloadDirectory {
  return new DirectoryImpl(repository);
}

class DirectoryImpl implements WorkloadDirectory {
  constructor(private readonly repo: WorkloadRepositoryPort) {}

  async checkFeasibility(
    tenant: TenantScope,
    demand: AllocationDemand,
    options: { readonly occurredAt: string },
  ): Promise<DirectoryResult> {
    const tenantCheck = validateTenantScope(tenant);
    if (!tenantCheck.ok) return refuse("TENANT_SCOPE_MISSING");
    const capacity = await this.repo.loadCapacity(tenant, demand.owner);
    if (capacity === null) return refuse("CAPACITY_NOT_FOUND");
    const allocation = await this.repo.loadAllocation(tenant, demand.owner);
    const current: WorkloadAllocation =
      allocation ?? {
        owner: demand.owner,
        tenant,
        allocatedUnits: 0,
        reservedCost: 0,
      };
    const result = checkAllocationFeasibility(capacity, current, demand);
    if (!result.ok) {
      const audit = makeAuditEvent({
        kind: "workload.allocation-refused",
        tenant,
        owner: demand.owner,
        occurredAt: options.occurredAt,
        reasonCode: result.reasonCode,
        overshootUnits: result.overshootUnits,
      });
      return {
        ok: false,
        reasonCode: result.reasonCode as DirectoryReasonCode,
        overshootUnits: result.overshootUnits,
        auditEvents: [audit],
      };
    }
    const audit = makeAuditEvent({
      kind: "workload.allocation-checked",
      tenant,
      owner: demand.owner,
      occurredAt: options.occurredAt,
    });
    return { ok: true, feasibility: result, auditEvents: [audit] };
  }

  async applyAllocation(
    tenant: TenantScope,
    demand: AllocationDemand,
    options: { readonly occurredAt: string },
  ): Promise<DirectoryResult> {
    const tenantCheck = validateTenantScope(tenant);
    if (!tenantCheck.ok) return refuse("TENANT_SCOPE_MISSING");
    const capacity = await this.repo.loadCapacity(tenant, demand.owner);
    if (capacity === null) return refuse("CAPACITY_NOT_FOUND");
    const allocation = await this.repo.loadAllocation(tenant, demand.owner);
    const current: WorkloadAllocation =
      allocation ?? {
        owner: demand.owner,
        tenant,
        allocatedUnits: 0,
        reservedCost: 0,
      };
    const result = checkAllocationFeasibility(capacity, current, demand);
    if (!result.ok) {
      const audit = makeAuditEvent({
        kind: "workload.allocation-refused",
        tenant,
        owner: demand.owner,
        occurredAt: options.occurredAt,
        reasonCode: result.reasonCode,
        overshootUnits: result.overshootUnits,
      });
      return {
        ok: false,
        reasonCode: result.reasonCode as DirectoryReasonCode,
        overshootUnits: result.overshootUnits,
        auditEvents: [audit],
      };
    }
    const newAllocation: WorkloadAllocation = {
      owner: demand.owner,
      tenant,
      allocatedUnits: current.allocatedUnits + demand.requestedUnits,
      reservedCost: current.reservedCost + demand.requestedUnits * capacity.unitCost,
    };
    await this.repo.storeAllocation(tenant, newAllocation);
    const audit = makeAuditEvent({
      kind: "workload.allocation-applied",
      tenant,
      owner: demand.owner,
      occurredAt: options.occurredAt,
    });
    return { ok: true, feasibility: result, auditEvents: [audit] };
  }

  async readUtilization(
    tenant: TenantScope,
    owner: string,
  ): Promise<WorkloadUtilization | null> {
    const tenantCheck = validateTenantScope(tenant);
    if (!tenantCheck.ok) return null;
    const capacity = await this.repo.loadCapacity(tenant, owner);
    if (capacity === null) return null;
    const allocation = await this.repo.loadAllocation(tenant, owner);
    const current: WorkloadAllocation =
      allocation ?? {
        owner,
        tenant,
        allocatedUnits: 0,
        reservedCost: 0,
      };
    return computeUtilization(capacity, current);
  }

  async proposeRebalance(
    tenant: TenantScope,
    options: { readonly generatedAt: string },
  ): Promise<RebalanceProposal> {
    const tenantCheck = validateTenantScope(tenant);
    if (!tenantCheck.ok) {
      return proposeRebalance(
        { tenantId: "" },
        [],
        [],
        options.generatedAt,
      );
    }
    const capacities = await this.repo.listCapacities(tenant);
    const allocations = await this.repo.listAllocations(tenant);
    return proposeRebalance(tenant, capacities, allocations, options.generatedAt);
  }
}

function refuse(reasonCode: DirectoryReasonCode): DirectoryRefusal {
  return { ok: false, reasonCode };
}
