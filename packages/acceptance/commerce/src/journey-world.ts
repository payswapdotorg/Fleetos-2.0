/**
 * @fleetos/acceptance-commerce — deterministic journey world.
 *
 * The caller-supplied initial state a journey runs against: REAL domain
 * records (built through the REAL packages wherever a constructor exists)
 * plus the in-memory reference repositories from the work package. Every
 * timestamp/money value is literal here — the whole world is a pure
 * function of `tenantId` (byte-identical for identical inputs).
 *
 * The model-gateway budget port is bound to the REAL agent-organizations
 * `checkAgentBudget` (intra-lane composition at this composition site —
 * both packages are worker-C lane packages and the shapes are the
 * documented seam).
 */

import type {
  TenantScope,
  WorkItem,
} from "@fleetos/work";
import {
  createInMemoryWorkRepository,
  createWorkItemDirectory,
  type WorkItemDirectory,
  type WorkRepositoryPort,
} from "@fleetos/work";
import type {
  Project,
  Milestone,
  ProjectStage,
  BudgetEnvelope,
  ActualsLedger,
} from "@fleetos/projects";
import { emptyLedger } from "@fleetos/projects";
import type {
  IdempotentAllocationLedger,
  CapacityLedger,
  AllocationLifecycleRecord,
  WorkloadCapacity,
} from "@fleetos/workloads";
import type {
  Need,
  ProcurementDemand,
  Quote,
  Order,
  Fulfillment,
  DemandFlowRecord,
} from "@fleetos/procurement";
import type {
  VendorLifecycleRecord,
  VendorCapabilityRecord,
  ServiceExposureLedger,
} from "@fleetos/vendors";
import type {
  Subscription,
  Entitlement,
  CatalogSoftwareEntry,
  EntitlementGrant,
} from "@fleetos/software";
import { createCatalogEntry } from "@fleetos/software";
import type {
  VendorCatalog,
  VerificationRegistry,
  VendorMetricRecord,
} from "@fleetos/external-vendors";
import { openVendorCatalog, openVerificationRegistry } from "@fleetos/external-vendors";
import type {
  ActorJobRecord,
  RateBudgetLedger,
  IngestedJobResult,
} from "@fleetos/apify";
import { openRateBudgetLedger } from "@fleetos/apify";
import type {
  UsageLedgerEntry,
  BudgetCheckPort,
} from "@fleetos/model-gateway";
import type {
  AgentRoleDefinition,
  CapabilityBudgetRecord,
  OptimizationProblem,
  RoleAllocationProposal,
  WhatIfAnalysis,
  OrgJournalEntry,
  TenantScope as OrgTenantScope,
} from "@fleetos/agent-organizations";
import { checkAgentBudget } from "@fleetos/agent-organizations";

/** All states a journey's steps may accumulate. Mutated only by the runner. */
export interface JourneyState {
  readonly tenant: TenantScope;
  readonly otherTenant: TenantScope;
  readonly work: {
    readonly repo: WorkRepositoryPort;
    readonly directory: WorkItemDirectory;
    readonly items: Map<string, WorkItem>;
  };
  readonly projectState: {
    project: Project | null;
    stages: ProjectStage[];
    milestones: Milestone[];
    envelope: BudgetEnvelope;
    ledger: ActualsLedger;
  };
  readonly workload: {
    idemLedger: IdempotentAllocationLedger;
    capacityLedger: CapacityLedger;
    lifecycle: AllocationLifecycleRecord | null;
    capacities: readonly WorkloadCapacity[];
  };
  readonly commerce: {
    need: Need;
    demand: ProcurementDemand;
    flow: DemandFlowRecord;
    quotes: Map<string, Quote>;
    orders: Map<string, Order>;
    fulfillment: Fulfillment | null;
  };
  readonly vendor: {
    record: VendorLifecycleRecord;
    capabilities: VendorCapabilityRecord[];
    exposure: ServiceExposureLedger;
  };
  readonly software: {
    subscription: Subscription;
    entitlements: Entitlement[];
    catalogEntry: CatalogSoftwareEntry;
    grants: EntitlementGrant[];
  };
  readonly external: {
    catalog: VendorCatalog;
    registry: VerificationRegistry;
    metrics: VendorMetricRecord[];
  };
  readonly apify: {
    job: ActorJobRecord | null;
    rateLedger: RateBudgetLedger;
    results: IngestedJobResult[];
  };
  readonly org: {
    journal: OrgJournalEntry[];
    usage: UsageLedgerEntry[];
    budgets: readonly CapabilityBudgetRecord[];
    roles: readonly AgentRoleDefinition[];
    roleDemand: readonly { roleId: string; holders: number }[];
    problem: OptimizationProblem | null;
    proposal: RoleAllocationProposal | null;
    whatIf: WhatIfAnalysis | null;
    baselineSnapshotDigest: string | null;
  };
  /** Sequence logs drivers append to (assertable as array facts). */
  readonly logs: Record<string, string[]>;
}

export const JOURNEY_TENANT: TenantScope = { tenantId: "acme" };
export const OTHER_TENANT: TenantScope = { tenantId: "globex" };

/** Deterministic logical clock values (caller-supplied, never Date.now). */
export const CLOCK = {
  t0: 1_000,
  t1: 2_000,
  t2: 3_000,
  t3: 4_000,
  t4: 5_000,
  t5: 6_000,
  iso0: "2026-10-01T00:00:00Z",
  iso1: "2026-10-02T00:00:00Z",
  iso2: "2026-10-03T00:00:00Z",
  iso3: "2026-10-04T00:00:00Z",
  now: "2026-10-05T00:00:00Z",
  later: "2026-12-31T00:00:00Z",
} as const;

export const ORG_BUDGETS: readonly CapabilityBudgetRecord[] = [
  {
    id: "bud-agent-1",
    tenant: JOURNEY_TENANT as OrgTenantScope,
    scope: { kind: "agent", refId: "agent-1" },
    capability: "model_invoke",
    allocatedUnits: 600,
    allocatedSpendMinor: 24_000,
    consumedUnits: 500,
    consumedSpendMinor: 20_000,
    generation: 1,
  },
];

export const ORG_ROLES: readonly AgentRoleDefinition[] = [
  { id: "role-ops", name: "Operations", capabilities: ["model_invoke", "summarize"], responsibilities: ["run-ops"] },
  { id: "role-legacy", name: "Legacy", capabilities: ["legacy_scan"], responsibilities: ["scan"] },
];

/** The REAL agent-organizations budget check bound to the gateway port shape. */
export function realBudgetPort(state: JourneyState): BudgetCheckPort {
  return {
    check: (input) => checkAgentBudget(state.org.budgets, input),
  };
}

/**
 * buildJourneyWorld — the deterministic initial state. Pure function of
 * the tenant ids (fixed); byte-identical every call.
 */
export function buildJourneyWorld(): JourneyState {
  const tenant = JOURNEY_TENANT;
  const repo = createInMemoryWorkRepository([]);
  const directory = createWorkItemDirectory(repo);

  const envelope: BudgetEnvelope = { projectId: "proj-1", tenant, limitMinorUnits: 1_000_000 };
  const ledgerResult = emptyLedger(envelope);
  if (!ledgerResult.ok) throw new Error("world: emptyLedger refused");

  const catalogEntry = createCatalogEntry({
    id: "cat-routeplanner",
    tenant,
    name: "RoutePlanner",
    version: "2.4.1",
  });
  if (!catalogEntry.ok) throw new Error("world: createCatalogEntry refused");

  const externalCatalog = openVendorCatalog(tenant, "marketplace-a");
  if (!externalCatalog.ok) throw new Error("world: openVendorCatalog refused");
  const registry = openVerificationRegistry(tenant);
  if (!registry.ok) throw new Error("world: openVerificationRegistry refused");
  const rate = openRateBudgetLedger(tenant, "2026-W01", 10);
  if (!rate.ok) throw new Error("world: openRateBudgetLedger refused");

  return {
    tenant,
    otherTenant: OTHER_TENANT,
    work: { repo, directory, items: new Map() },
    projectState: {
      project: null,
      stages: [],
      milestones: [],
      envelope,
      ledger: ledgerResult.ledger,
    },
    workload: {
      idemLedger: { tenant, owner: "crew-a", maxUnits: 10, allocatedUnits: 0, applications: [] },
      capacityLedger: { owner: "crew-a", tenant, maxUnits: 10, reservedUnits: 0 },
      lifecycle: null,
      capacities: [{ owner: "crew-a", tenant, maxUnits: 10, unitCost: 100 }],
    },
    commerce: {
      need: {
        id: { kind: "need", value: "need-1" },
        tenant,
        description: "Temperature-logged transport for depot rotation",
        requiredCapabilityTags: ["cold-chain", "gps"],
      },
      demand: {
        id: { kind: "procurement-demand", value: "demand-1" },
        tenant,
        needId: { kind: "need", value: "need-1" },
        quantity: 10,
        requiredBy: "2026-11-01",
        capabilityTags: ["cold-chain", "gps"],
      },
      flow: {
        id: { kind: "procurement-demand", value: "demand-1" },
        tenant,
        needId: { kind: "need", value: "need-1" },
        quantity: 10,
        requiredBy: 1_761_000_000_000,
        capabilityTags: ["cold-chain", "gps"],
        status: "draft",
        solicitationAuthorization: null,
        solicitationEvidence: null,
        awardAuthorization: null,
        awardEvidence: null,
      },
      quotes: new Map(),
      orders: new Map(),
      fulfillment: null,
    },
    vendor: {
      record: {
        vendorId: "ven-1",
        tenant,
        displayName: "Northwind Logistics",
        status: "prospective",
        suspendedReason: null,
        terminatedReason: null,
        terminatedAt: null,
        reinstatementCount: 0,
      },
      capabilities: [
        { vendorId: "ven-1", tenant, tag: "cold-chain", status: "declared" as const, verifiedAt: null, evidence: null },
        { vendorId: "ven-1", tenant, tag: "gps", status: "declared" as const, verifiedAt: null, evidence: null },
      ],
      exposure: {
        vendorId: "ven-1",
        tenant,
        relationshipStatus: "active" as const,
        limitMinorUnits: 500_000,
        committedMinorUnits: 0,
      },
    },
    software: {
      subscription: {
        id: { kind: "subscription", value: "sub-1" },
        tenant,
        sku: "FLEET-OPS-PRO",
        seatsTotal: 5,
        status: "active" as const,
        validFrom: "2026-01-01T00:00:00Z",
        validUntil: "2027-01-01T00:00:00Z",
      },
      entitlements: [
        { id: { kind: "entitlement", value: "ent-1" }, tenant, subscriptionId: { kind: "subscription", value: "sub-1" }, assigneeId: "agent-1", revokedAt: null, revokedReason: null },
        { id: { kind: "entitlement", value: "ent-2" }, tenant, subscriptionId: { kind: "subscription", value: "sub-1" }, assigneeId: "agent-2", revokedAt: null, revokedReason: null },
        { id: { kind: "entitlement", value: "ent-3" }, tenant, subscriptionId: { kind: "subscription", value: "sub-1" }, assigneeId: "agent-3", revokedAt: null, revokedReason: null },
      ],
      catalogEntry: catalogEntry.entry,
      grants: [
        {
          id: "grant-1",
          tenant,
          subscriptionId: "sub-1",
          catalogEntryId: "cat-routeplanner",
          assigneeId: null,
          seats: 3,
          status: "granted" as const,
          grantedAt: 1,
          assignedAt: null,
          revokedAt: null,
          revokedReason: null,
          expiresAt: null,
        },
      ],
    },
    external: { catalog: externalCatalog.catalog, registry: registry.registry, metrics: [] },
    apify: { job: null, rateLedger: rate.ledger, results: [] },
    org: {
      journal: [],
      usage: [],
      budgets: ORG_BUDGETS,
      roles: ORG_ROLES,
      roleDemand: [{ roleId: "role-ops", holders: 1 }],
      problem: null,
      proposal: null,
      whatIf: null,
      baselineSnapshotDigest: null,
    },
    logs: {},
  };
}

/** Append to a named sequence log (deterministic order). */
export function logPush(state: JourneyState, key: string, entry: string): void {
  const log = state.logs[key] ?? [];
  log.push(entry);
  state.logs[key] = log;
}
