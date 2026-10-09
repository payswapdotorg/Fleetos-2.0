import { describe, expect, it } from "vitest";
import type { Need, ProcurementDemand, Quote, Order, Fulfillment, QuoteScoreInput } from "@fleetos/procurement";
import type { VendorLifecycleRecord, ServiceExposureLedger } from "@fleetos/vendors";
import type { Subscription, Entitlement } from "@fleetos/software";
import type { WorkItem, WorkItemStatus } from "@fleetos/work";
import type { Project, Milestone, ProjectStage } from "@fleetos/projects";
import type { WorkloadCapacity, WorkloadAllocation } from "@fleetos/workloads";
import type { RoleAssignment, CapabilityBudgetRecord } from "@fleetos/agent-organizations";
import type { UsageLedgerEntry, BudgetCheckPort } from "@fleetos/model-gateway";
import { appendUsage } from "@fleetos/model-gateway";
import {
  workCommerceHostSurface,
  buildWorkCommerceHostViewModels as buildViewModels,
  verifyHostViewModelsDigest,
  stageGateSheetFor,
  verifyRouteManifest,
  verifyIntentCatalog,
  buildIntentForEvent,
  MANIFEST_VIEW_MODEL_KEYS,
  routeById,
} from "../src/host/index.js";
import type { WorkCommerceSlice, HostTenantContext } from "../src/host/index.js";

const TENANT = "acme";
const OTHER = "other";
const ESTABLISHED_AT = 1774000000000;
const COMPUTED_AT = new Date(ESTABLISHED_AT).toISOString();

const ctx = (overrides: Partial<HostTenantContext> = {}): HostTenantContext => ({
  tenantId: TENANT,
  actorId: "actor-1",
  roleId: "role-ops-1",
  establishedAt: ESTABLISHED_AT,
  scope: "self",
  ...overrides,
});

const alwaysOkPort: BudgetCheckPort = {
  check: () => ({ ok: true, remainingUnits: 1000, remainingSpendMinor: 100000 }),
};

function usageLedger(): readonly UsageLedgerEntry[] {
  let ledger: readonly UsageLedgerEntry[] = [];
  for (const spec of [
    { agentId: "agent-1", modelId: "m-big", providerId: "p-2", units: 50, costMinor: 1500, at: 2 },
    { agentId: "agent-2", modelId: "m-small", providerId: "p-1", units: 100, costMinor: 500, at: 3 },
  ]) {
    const appended = appendUsage(ledger, alwaysOkPort, {
      tenantId: TENANT,
      requestRef: `req-${spec.at}`,
      capability: "model-inference",
      ...spec,
    });
    if (!appended.ok) throw new Error(appended.reasonCode);
    ledger = appended.ledger;
  }
  return ledger;
}

const workItem = (v: string, status: WorkItemStatus, projectId: string | null): WorkItem => ({
  id: { kind: "work-item", value: v },
  tenant: { tenantId: TENANT },
  title: `title-${v}`,
  assignee: { assigneeId: `agent-${v}`, assignedAt: "2026-01-01T00:00:00Z" },
  assignmentHistory: [],
  deadline: null,
  status,
  blockedReason: null,
  missionRef: null,
  workflowRef: null,
  projectId,
});

const project = (v: string): Project => ({
  id: { kind: "project", value: v },
  tenant: { tenantId: TENANT },
  name: `project-${v}`,
  status: "active",
  milestoneIds: [],
});

const stage = (id: string, projectId: string, status: ProjectStage["status"], mandatoryOpen: number): ProjectStage => ({
  id,
  tenant: { tenantId: TENANT },
  projectId,
  name: `stage-${id}`,
  status,
  checkpoints: Array.from({ length: mandatoryOpen }, (_, i) => ({
    id: `cp-${id}-${i}`,
    mandatory: true,
    completedAt: null,
  })),
  updatedAt: 1000,
});

const milestone = (v: string, projectId: string, workItemIds: readonly string[]): Milestone => ({
  id: { kind: "milestone", value: v },
  tenant: { tenantId: TENANT },
  projectId,
  name: `milestone-${v}`,
  status: "open",
  workItemIds,
});

const capacity = (owner: string, maxUnits: number): WorkloadCapacity => ({
  owner,
  tenant: { tenantId: TENANT },
  maxUnits,
  unitCost: 10,
});

const allocation = (owner: string, allocatedUnits: number): WorkloadAllocation => ({
  owner,
  tenant: { tenantId: TENANT },
  allocatedUnits,
  reservedCost: allocatedUnits * 10,
});

const need = (v: string): Need => ({
  id: { kind: "need", value: v },
  tenant: { tenantId: TENANT },
  description: `need-${v}`,
  requiredCapabilityTags: ["welding"],
});

const demand = (v: string, needV: string): ProcurementDemand => ({
  id: { kind: "procurement-demand", value: v },
  tenant: { tenantId: TENANT },
  needId: { kind: "need", value: needV },
  quantity: 3,
  requiredBy: "2026-02-01",
  capabilityTags: ["welding"],
});

const quote = (v: string, status: Quote["status"], vendorId = "v-1"): Quote => ({
  id: { kind: "quote", value: v },
  tenant: { tenantId: TENANT },
  demandId: { kind: "procurement-demand", value: "d-1" },
  vendorId,
  unitCost: 100,
  totalCost: 300,
  status,
  submittedAt: "2026-01-05T00:00:00Z",
  expiresAt: null,
  supersedes: null,
  superseded: false,
});

const order = (v: string, status: Order["status"]): Order => ({
  id: { kind: "order", value: v },
  tenant: { tenantId: TENANT },
  quoteId: { kind: "quote", value: "q-1" },
  status,
  authorization: { decisionId: "gd-1", authorized: true, reasonCode: "APPROVED" },
  fulfillmentVerified: false,
});

const fulfillment = (v: string, status: Fulfillment["status"]): Fulfillment => ({
  id: { kind: "fulfillment", value: v },
  tenant: { tenantId: TENANT },
  orderId: { kind: "order", value: "o-1" },
  status,
  verificationEvidence: null,
});

const vendor = (v: string): VendorLifecycleRecord => ({
  vendorId: v,
  tenant: { tenantId: TENANT },
  displayName: `Vendor ${v}`,
  status: "active",
  suspendedReason: null,
  terminatedReason: null,
  terminatedAt: null,
  reinstatementCount: 0,
});

const exposure = (v: string): ServiceExposureLedger => ({
  vendorId: v,
  tenant: { tenantId: TENANT },
  relationshipStatus: "active",
  limitMinorUnits: 10_000,
  committedMinorUnits: 2_500,
});

const subscription = (v: string, seatsTotal: number): Subscription => ({
  id: { kind: "subscription", value: v },
  tenant: { tenantId: TENANT },
  sku: `SKU-${v}`,
  seatsTotal,
  status: "active",
  validFrom: "2025-01-01T00:00:00Z",
  validUntil: "2027-01-01T00:00:00Z",
});

const entitlement = (v: string, subV: string): Entitlement => ({
  id: { kind: "entitlement", value: v },
  tenant: { tenantId: TENANT },
  subscriptionId: { kind: "subscription", value: subV },
  assigneeId: `agent-${v}`,
  revokedAt: null,
  revokedReason: null,
});

const assignment = (id: string): RoleAssignment => ({
  id,
  tenant: { tenantId: TENANT },
  organizationId: "org-1",
  agentId: `agent-${id}`,
  roleId: "role-technician",
  status: "active",
  assignedAt: 100,
  activatedAt: 200,
  relievedAt: null,
  reliefReason: null,
  digest: `assignment-digest-${id}`,
});

const budget = (id: string, allocatedUnits: number, consumedUnits: number): CapabilityBudgetRecord => ({
  id,
  tenant: { tenantId: TENANT },
  scope: { kind: "agent", refId: `agent-${id}` },
  capability: "model-inference",
  allocatedUnits,
  allocatedSpendMinor: 10_000,
  consumedUnits,
  consumedSpendMinor: 2_500,
  generation: 2,
});

const scoreInput = (quoteId: string, vendorId: string, totalCostMinor: number): QuoteScoreInput => ({
  quoteId,
  vendorId,
  tenant: { tenantId: TENANT },
  unitCostMinor: 100,
  totalCostMinor,
  leadTimeDays: 5,
  capabilityTags: ["welding"],
  submittedAtEpoch: ESTABLISHED_AT,
});

function baseSlice(overrides: Partial<WorkCommerceSlice> = {}): WorkCommerceSlice {
  return {
    tenantId: TENANT,
    workItems: [workItem("w-1", "todo", "proj-1"), workItem("w-2", "in_progress", null)],
    projects: [project("proj-1")],
    stages: [stage("st-1", "proj-1", "planned", 2), stage("st-2", "proj-1", "closed", 0)],
    milestones: [milestone("m-1", "proj-1", ["w-1"])],
    capacities: [capacity("crew-a", 10)],
    allocations: [allocation("crew-a", 5)],
    needs: [need("n-1")],
    demands: [demand("d-1", "n-1")],
    quotes: [quote("q-1", "submitted"), quote("q-2", "accepted", "v-2")],
    orders: [order("o-1", "placed")],
    fulfillments: [fulfillment("f-1", "delivered")],
    vendors: [vendor("v-1"), vendor("v-2")],
    exposures: [exposure("v-1")],
    subscriptions: [subscription("s-1", 4)],
    entitlements: [entitlement("e-1", "s-1"), entitlement("e-2", "s-1")],
    assignments: [assignment("a-1")],
    budgets: [budget("b-1", 10, 3)],
    usage: usageLedger(),
    ...overrides,
  };
}

describe("host route manifest", () => {
  it("declares the five packet routes with honest limitation markers on every route", () => {
    expect(verifyRouteManifest()).toEqual([]);
    expect(workCommerceHostSurface.routes.map((r) => r.routeId)).toEqual([
      "work-board",
      "project-stage-gates",
      "procurement-spine",
      "software-entitlements",
      "org-budgets",
    ]);
    const spine = routeById("procurement-spine");
    expect(spine?.limitations.map((l) => l.marker)).toContain("external-adapters:contract-only");
    expect(spine?.viewModels).toEqual(["spineBoard", "vendorKpi", "quoteScore"]);
  });

  it("covers every manifest view-model key and resolves drill-down refs", () => {
    expect(MANIFEST_VIEW_MODEL_KEYS).toEqual([
      "workBoard",
      "stageGates",
      "workloadRollup",
      "spineBoard",
      "vendorKpi",
      "quoteScore",
      "seatView",
      "roleBoard",
      "budgetBoard",
      "usageRollup",
    ]);
    for (const route of workCommerceHostSurface.routes) {
      for (const ref of route.drillDown) {
        expect(routeById(ref.routeId)).not.toBeNull();
      }
    }
  });
});

describe("buildViewModels — purity, determinism, real assemblies", () => {
  it("projects every REAL assembly with verified bundle digest", () => {
    const result = buildViewModels(baseSlice(), ctx());
    if (!result.ok) throw new Error(result.rejected);
    const m = result.models;
    expect(m.surfaceId).toBe("work-commerce");
    expect(m.tenantId).toBe(TENANT);
    expect(m.asOf).toBe(ESTABLISHED_AT);
    expect(m.computedAt).toBe(COMPUTED_AT);
    expect(verifyHostViewModelsDigest(m)).toBe(true);
    expect(m.workBoard.ok && m.workBoard.board.columns.map((c) => c.status)).toContain("todo");
    expect(m.stageGates.map((s) => s.projectId)).toEqual(["proj-1"]);
    const sheet = stageGateSheetFor(m, "proj-1");
    expect(sheet.ok && sheet.sheet.outcome.ok && sheet.sheet.outcome.view.frontierStageId).toBe("st-1");
    expect(m.workloadRollup.ok && m.workloadRollup.view.totals.usedUnits).toBe(5);
    expect(m.spineBoard.ok && m.spineBoard.board.counts).toContainEqual({ stage: "need", key: "total", count: 1 });
    expect(m.vendorKpi.ok && m.vendorKpi.rows.map((r) => r.vendorId)).toEqual(["v-1", "v-2"]);
    expect(m.quoteScore.composed).toBe(false);
    expect(m.seatView.ok && m.seatView.rows[0]?.seatsAllocated).toBe(2);
    expect(m.roleBoard.ok && m.roleBoard.board.columns[1]?.cards.map((c) => c.assignmentId)).toEqual(["a-1"]);
    expect(m.budgetBoard.ok && m.budgetBoard.rows[0]?.unitUtilizationBps).toBe(3000);
    expect(m.usageRollup.ok && m.usageRollup.rollup.totals.totalCostMinor).toBe(2000);
    expect(m.routeLimitations.map((r) => r.routeId)).toEqual(workCommerceHostSurface.routes.map((r) => r.routeId));
  });

  it("is byte-identical for the same slice + context (input order irrelevant)", () => {
    const slice = baseSlice();
    const reversed: WorkCommerceSlice = {
      ...slice,
      workItems: [...slice.workItems].reverse(),
      quotes: [...slice.quotes].reverse(),
      vendors: [...slice.vendors].reverse(),
      usage: [...slice.usage].reverse().sort((a, b) => a.seq - b.seq),
    };
    const a = buildViewModels(slice, ctx());
    const b = buildViewModels(reversed, ctx());
    const c = buildViewModels(slice, ctx());
    expect(JSON.stringify(a)).toBe(JSON.stringify(c));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("carries honest not-composed quote scoring, then real sheets when inputs are composed", () => {
    const without = buildViewModels(baseSlice(), ctx());
    if (!without.ok) throw new Error(without.rejected);
    expect(without.models.quoteScore).toEqual({
      composed: false,
      marker: "quote-scoring:caller-composed",
    });
    const withScores = buildViewModels(
      baseSlice({
        quoteScoreInputs: [
          { demandId: "d-2", requiredCapabilityTags: ["welding"], quotes: [scoreInput("q-9", "v-2", 900)] },
          { demandId: "d-1", requiredCapabilityTags: ["welding"], quotes: [scoreInput("q-1", "v-1", 300)] },
        ],
      }),
      ctx(),
    );
    if (!withScores.ok) throw new Error(withScores.rejected);
    if (!withScores.models.quoteScore.composed) throw new Error("expected composed");
    expect(withScores.models.quoteScore.sheets.map((s) => s.demandId)).toEqual(["d-1", "d-2"]);
    const sheet = withScores.models.quoteScore.sheets[1];
    expect(sheet?.outcome.ok && sheet?.outcome.view.ranked[0]?.quoteId).toBe("q-9");
  });
});

describe("buildViewModels — tenant fail-closed at the seam", () => {
  it("refuses the WHOLE bundle when the context tenant does not own the slice", () => {
    const result = buildViewModels(baseSlice(), ctx({ tenantId: OTHER }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejected).toBe("tenant-mismatch");
      expect(result.detail).toContain(OTHER);
      expect(result.detail).toContain(TENANT);
    }
  });

  it("refuses on malformed context, invalid establishedAt and forbidden scope", () => {
    const badTenant = buildViewModels(baseSlice(), ctx({ tenantId: "" }));
    expect(badTenant.ok).toBe(false);
    if (!badTenant.ok) expect(badTenant.rejected).toBe("malformed-context");

    const badTime = buildViewModels(baseSlice(), ctx({ establishedAt: 0 }));
    expect(badTime.ok).toBe(false);
    if (!badTime.ok) expect(badTime.rejected).toBe("invalid-established-at");

    const forbidden = buildViewModels(baseSlice(), ctx({ scope: "cross-tenant-forbidden" }));
    expect(forbidden.ok).toBe(false);
    if (!forbidden.ok) expect(forbidden.rejected).toBe("forbidden-scope");
  });

  it("surfaces cross-tenant record refusals VERBATIM inside the per-route assemblies", () => {
    const result = buildViewModels(
      baseSlice({
        quotes: [quote("q-x", "submitted"), { ...quote("q-t", "submitted"), tenant: { tenantId: OTHER } }],
      }),
      ctx(),
    );
    if (!result.ok) throw new Error(result.rejected);
    expect(result.models.spineBoard.ok).toBe(false);
    if (!result.models.spineBoard.ok) {
      expect(result.models.spineBoard.reasonCode).toBe("TENANT_MISMATCH");
      expect(result.models.spineBoard.detail).toBe("q-t");
    }
    expect(result.models.vendorKpi.ok).toBe(false);
  });
});

describe("host intent catalog", () => {
  it("verifies catalog integrity and maps every event to an existing builder", () => {
    expect(verifyIntentCatalog()).toEqual([]);
    expect(workCommerceHostSurface.intents.map((i) => i.builderId)).toEqual([
      "work.create-work-order",
      "procurement.approve-quote",
      "procurement.place-order",
      "org.allocate-budget",
    ]);
  });

  it("gates presentation by role lens — fail-closed before any draft is built", () => {
    expect(workCommerceHostSurface.intents.length).toBe(4);
    const offered = buildIntentForEvent(
      "work-board:create-work-order",
      {
        tenantId: TENANT,
        issuedAt: ESTABLISHED_AT,
        reason: "host test",
        title: "Inspect hoist",
      },
      "operations-manager",
    );
    expect(offered.ok).toBe(true);
    const refused = buildIntentForEvent(
      "work-board:create-work-order",
      {
        tenantId: TENANT,
        issuedAt: ESTABLISHED_AT,
        reason: "host test",
        title: "Inspect hoist",
      },
      "vendor-manager",
    );
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.rejected).toBe("intent-not-offered-to-role");
  });
});
