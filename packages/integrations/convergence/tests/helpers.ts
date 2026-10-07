/**
 * @fleetos/convergence — shared deterministic test fixtures.
 *
 * Bind REAL implementations at the composition site (per the ownership
 * law: "cross-context tests may bind real implementations at test
 * composition sites"). Logical `now` values, fixed tenants, deterministic
 * registries/budgets/world journals. No clock, no randomness.
 */

import type { ActorId, SessionId, TenantContext, TenantId } from "@fleetos/kernel";
import type { ModelDescriptor, ProviderRecord } from "@fleetos/model-gateway";
import type { CapabilityBudgetRecord } from "@fleetos/agent-organizations";
import { nextWorldEntry, type WorldJournalEntry } from "@fleetos/world-model";
import type { MissionDefinition } from "@fleetos/mission";

export const NOW = 1_727_000_000_000;
export const TENANT_A = "tnt_acme-corp-001";
export const TENANT_B = "tnt_globex-002";
export const AGENT_A = "act_alice-001";
export const CAPABILITY = "model-inference";

export function ctxFor(
  tenant: string,
  actor: string = AGENT_A,
): TenantContext {
  return {
    tenantId: tenant as TenantId,
    actorId: actor as ActorId,
    sessionId: "sess_abcdef0123456789" as SessionId,
    establishedAt: NOW,
    scope: "tenant",
  };
}

// ---------------------------------------------------------------------------
// Mission fixtures
// ---------------------------------------------------------------------------

/** Three stages: a parallel pair, then a dependent singleton. */
export const THREE_STAGE_DEFINITION: MissionDefinition = {
  id: "def_inspection_001",
  stages: [
    { id: "ingest", parallelGroup: "phase-1" },
    { id: "analyze", parallelGroup: "phase-1" },
    { id: "report", dependsOn: ["ingest", "analyze"] },
  ],
};

// ---------------------------------------------------------------------------
// Model-stack fixtures
// ---------------------------------------------------------------------------

export const REGISTRY: readonly ModelDescriptor[] = [
  {
    id: "mdl_primary",
    providerId: "prov_a",
    capabilityTags: ["reasoning", "tools", "vision"],
    costPerUnitMinor: 10,
    maxContextUnits: 100_000,
  },
  {
    id: "mdl_alt",
    providerId: "prov_b",
    capabilityTags: ["reasoning", "tools"],
    costPerUnitMinor: 4,
    maxContextUnits: 100_000,
  },
  {
    id: "mdl_cheap",
    providerId: "prov_a",
    capabilityTags: ["reasoning"],
    costPerUnitMinor: 2,
    maxContextUnits: 100_000,
  },
];

export function providersFixture(
  provAHealth: ProviderRecord["health"] = "healthy",
  provBHealth: ProviderRecord["health"] = "healthy",
): readonly ProviderRecord[] {
  return [
    { id: "prov_a", declaredModels: ["mdl_primary", "mdl_cheap"], health: provAHealth },
    { id: "prov_b", declaredModels: ["mdl_alt"], health: provBHealth },
  ];
}

export const CHAIN_ORDER: readonly string[] = ["prov_a", "prov_b"];

export function budgetFixture(overrides?: {
  readonly allocatedUnits?: number;
  readonly allocatedSpendMinor?: number;
  readonly consumedUnits?: number;
  readonly consumedSpendMinor?: number;
  readonly tenantId?: string;
  readonly agentId?: string;
}): CapabilityBudgetRecord {
  return {
    id: "bgt_agent_alice_001",
    tenant: { tenantId: overrides?.tenantId ?? TENANT_A },
    scope: { kind: "agent", refId: overrides?.agentId ?? AGENT_A },
    capability: CAPABILITY,
    allocatedUnits: overrides?.allocatedUnits ?? 10_000,
    allocatedSpendMinor: overrides?.allocatedSpendMinor ?? 10_000,
    consumedUnits: overrides?.consumedUnits ?? 0,
    consumedSpendMinor: overrides?.consumedSpendMinor ?? 0,
    generation: 1,
  };
}

// ---------------------------------------------------------------------------
// World-model fixtures (digest-chained journal, tenant A)
// ---------------------------------------------------------------------------

export function worldJournalFixture(tenantId: string = TENANT_A): WorldJournalEntry[] {
  let entries: WorldJournalEntry[] = [];
  const add = (event: Parameters<typeof nextWorldEntry>[0]["event"], atMs: number) => {
    entries = [
      ...entries,
      nextWorldEntry({ tenantId, existing: entries, event, atMs }),
    ];
  };
  add({ kind: "entity-registered", entityId: "asset_truck_01", entityType: "asset" }, NOW - 100_000);
  add(
    {
      kind: "observation-recorded",
      entityId: "asset_truck_01",
      entityType: "asset",
      observationRef: "obs_001",
      observedAtMs: NOW - 90_000,
      value: 10,
    },
    NOW - 90_000,
  );
  add(
    {
      kind: "observation-recorded",
      entityId: "asset_truck_01",
      entityType: "asset",
      observationRef: "obs_002",
      observedAtMs: NOW - 80_000,
      value: 12,
    },
    NOW - 80_000,
  );
  add(
    {
      kind: "observation-recorded",
      entityId: "asset_truck_01",
      entityType: "asset",
      observationRef: "obs_003",
      observedAtMs: NOW - 70_000,
      value: 14,
    },
    NOW - 70_000,
  );
  add({ kind: "entity-registered", entityId: "agent_ops_01", entityType: "agent" }, NOW - 60_000);
  add(
    { kind: "entity-tagged", entityId: "asset_truck_01", entityType: "asset", tags: ["critical"] },
    NOW - 50_000,
  );
  return entries;
}
