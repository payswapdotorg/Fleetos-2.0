/**
 * @fleetos/acceptance-commerce — host-seam journeys (F300C, Wave 10).
 *
 * Journeys over the lane's REAL HostSurface adapter
 * (@fleetos/experience-work-commerce/host — WAVE10-HOST-CONTRACT §2):
 *   - host-surface: the full view-model bundle over the journey's REAL
 *     composed state (all five routes), purity + digest integrity, the
 *     honest not-composed quote-scoring marker, then composed scoring;
 *   - host-intents: UI events → the EXISTING inert CommandDraft builders
 *     with presentation role-lens gates and honest builder refusals;
 *   - host-tenant-edges: tenant fail-closed at the host boundary —
 *     context/slice mismatch, malformed contexts, forbidden scope and
 *     foreign records inside the slice (verbatim per-assembly refusals).
 */

import type { AcceptanceJourney, FactValue } from "../journey-contracts.js";

const eq = (id: string, fact: string, expected: FactValue, description: string) =>
  ({ id, description, fact, op: "eq" as const, expected });
const deq = (id: string, fact: string, expected: readonly string[], description: string) =>
  ({ id, description, fact, op: "deepEq" as const, expected });

const HOST_NOW = 1_774_000_000_000;

export const hostSurfaceJourney: AcceptanceJourney = {
  id: "host-surface",
  persona: "operations-manager",
  capability: "host-integration",
  goal:
    "Build the work/commerce HostSurface view models over REAL composed domain state: every route assembly, byte-identical purity, verified digests, honest limitation markers and the not-composed-then-composed quote scoring.",
  steps: [
    { stepId: "s1", kind: "work-create", itemId: "wo-h1", title: "Winterize depot fleet", projectId: null, deadline: null },
    { stepId: "s2", kind: "project-create", projectId: "proj-h", name: "Depot Winterization" },
    { stepId: "s3", kind: "stage-create", stageId: "st-h1", name: "Preparation", checkpoints: [{ id: "cp-h1", mandatory: true }] },
    { stepId: "s4", kind: "stage-transition", stageId: "st-h1", command: "start" },
    { stepId: "s5", kind: "demand-flow", command: "solicit", authorized: true, evidenceId: "ev-hs1", evidenceTenantId: "acme" },
    { stepId: "s6", kind: "quote-create", quoteId: "q-h1", vendorId: "ven-1", unitCost: 10_00, totalCost: 100_00 },
    { stepId: "s7", kind: "quote-transition", quoteId: "q-h1", command: "submit" },
    { stepId: "s8", kind: "usage-append", requestRef: "req-h1", agentId: "agent-1", modelId: "model-alpha", providerId: "provider-one", capability: "model_invoke", units: 100, costMinor: 4_000 },
    { stepId: "s9", kind: "host-build-view-models", now: HOST_NOW },
    { stepId: "s10", kind: "org-assign-role", assignmentId: "ra-h1", agentId: "agent-1", roleId: "role-ops" },
    { stepId: "s11", kind: "org-transition-role", command: "activate" },
    { stepId: "s12", kind: "workload-apply", demandKey: "wd-h", units: 5, owner: "crew-a" },
    { stepId: "s13", kind: "host-build-view-models", now: HOST_NOW, quoteScoreInputs: [
      {
        demandId: "demand-1",
        requiredCapabilityTags: ["cold-chain", "gps"],
        quotes: [
          { quoteId: "q-h1", vendorId: "ven-1", unitCostMinor: 1_000, totalCostMinor: 10_000, leadTimeDays: 3, capabilityTags: ["cold-chain", "gps"], submittedAtEpoch: HOST_NOW },
        ],
      },
    ] },
  ],
  assertions: [
    deq("a1", "host.build.log", [
      "#1:todo=1:usedUnits=0:active=0:scoreComposed=false",
      "#2:todo=1:usedUnits=5:active=1:scoreComposed=true",
    ], "two host builds over evolving REAL state: the first without workload/role/scoring, the second with all three composed"),
    eq("a2", "host.ok", true, "the final host build succeeds over the REAL composed state"),
    eq("a3", "host.pure", true, "the same slice + context rebuilds byte-identically (the purity law)"),
    eq("a4", "host.digestVerified", true, "the bundle digest verifies — nothing was tampered"),
    eq("a5", "host.routesValid", true, "the route manifest machine-verifies (no dangling drill-downs)"),
    eq("a6", "host.intentsValid", true, "the intent catalog machine-verifies (known builders, declared routes)"),
    eq("a7", "host.workBoard.todoCount", 1, "the work board assembly shows the created work order in todo"),
    eq("a8", "host.stageGates.frontierStageId", "st-h1", "the stage-gate sheet reports the open frontier stage"),
    eq("a9", "host.stageGates.nextUnlockRequires", "close-mandatory-checkpoints", "the frontier reports exactly what unlocks it"),
    eq("a10", "host.workloadRollup.usedUnits", 5, "the workload rollup shows the five applied units"),
    eq("a11", "host.workloadRollup.utilizationBps", 5_000, "the workload rollup computes 5000 bps utilization"),
    deq("a12", "host.spineBoard.quoteStatuses", ["submitted:1"], "the spine assembly shows the submitted quote"),
    deq("a13", "host.vendorKpi.vendorIds", ["ven-1"], "the vendor KPI assembly covers the world's vendor"),
    eq("a14", "host.quoteScore.composed", true, "composed scoring inputs produce real ranked quote sheets"),
    eq("a15", "host.quoteScore.ranked0QuoteId", "q-h1", "the composed sheet ranks the only quote first"),
    eq("a16", "host.seatView.seatsAllocated", 3, "the seat view counts the world's three live entitlements"),
    eq("a17", "host.seatView.seatsTotal", 5, "the seat view shows the subscription's five seats"),
    deq("a18", "host.roleBoard.activeIds", ["ra-h1"], "the role board shows the activated role assignment"),
    eq("a19", "host.budgetBoard.phase0", "consumed", "the org budget sheet classifies the seeded budget as consumed"),
    eq("a20", "host.budgetBoard.unitUtilizationBps0", 8_333, "the org budget sheet computes exact integer bps utilization"),
    eq("a21", "host.budgetBoard.ceilingNote0", "ceiling-satisfied-not-authorization", "every budget row carries the ceiling-not-authorization note"),
    eq("a22", "host.usageRollup.chainOk", true, "the gateway usage rollup verifies its ledger chain"),
    deq("a23", "host.markers.procurementSpine", [
      "read-as-of:logical-time",
      "intent-execution:not-at-lane",
      "quote-scoring:caller-composed",
      "external-adapters:contract-only",
    ], "the procurement route surfaces its four honest limitation markers, including CONTRACT_ONLY adapters"),
  ],
};

export const hostIntentsJourney: AcceptanceJourney = {
  id: "host-intents",
  persona: "procurement-lead",
  capability: "host-integration",
  goal:
    "Turn UI events into inert CommandDrafts through the host intent catalog: role-lens presentation gates, subject-key idempotency, honest builder refusals and digest-validated drafts — nothing ever executes at the seam.",
  steps: [
    { stepId: "s1", kind: "host-intent-draft", event: "work-board:create-work-order", role: "operations-manager", title: "Inspect dock levelers", projectId: "proj-h", reason: "planned inspection" },
    { stepId: "s2", kind: "host-intent-draft", event: "work-board:create-work-order", role: "vendor-manager", title: "Inspect dock levelers", reason: "planned inspection" },
    { stepId: "s3", kind: "host-intent-draft", event: "work-board:create-work-order", role: "operations-manager", title: "   ", reason: "blank title refusal" },
    { stepId: "s4", kind: "demand-flow", command: "solicit", authorized: true, evidenceId: "ev-hi", evidenceTenantId: "acme" },
    { stepId: "s5", kind: "quote-create", quoteId: "q-i1", vendorId: "ven-1", unitCost: 10_00, totalCost: 100_00 },
    { stepId: "s6", kind: "quote-transition", quoteId: "q-i1", command: "submit" },
    { stepId: "s7", kind: "host-intent-draft", event: "procurement-spine:approve-quote", role: "procurement-lead", quoteId: "q-i1", demandId: "demand-1", reason: "best ranked quote" },
    { stepId: "s8", kind: "host-intent-draft", event: "procurement-spine:approve-quote", role: "finance-controller", quoteId: "q-i1", reason: "counter-signature" },
    { stepId: "s9", kind: "host-intent-draft", event: "procurement-spine:place-order", role: "procurement-lead", quoteId: "q-i1", vendorId: "ven-1", totalCostMinor: 100_00, reason: "award execution" },
    { stepId: "s10", kind: "host-intent-draft", event: "procurement-spine:place-order", role: "finance-controller", quoteId: "q-i1", reason: "role not offered" },
    { stepId: "s11", kind: "host-intent-draft", event: "procurement-spine:place-order", role: "procurement-lead", quoteId: "q-i1", totalCostMinor: -5, reason: "negative money refusal" },
    { stepId: "s12", kind: "host-intent-draft", event: "org-budgets:allocate-budget", role: "org-optimizer", budgetId: "bud-agent-1", additionalUnits: 100, additionalSpendMinor: 4_000, reason: "raise ceiling for season peak" },
    { stepId: "s13", kind: "host-intent-draft", event: "org-budgets:allocate-budget", role: "org-optimizer", budgetId: "bud-agent-1", additionalUnits: 100, reason: "missing spend refusal" },
    { stepId: "s14", kind: "host-intent-draft", event: "work-board:unknown-event", reason: "unknown event refusal" },
    { stepId: "s15", kind: "host-build-view-models", now: HOST_NOW },
  ],
  assertions: [
    deq("a1", "host.draft.log", [
      "ok:work.create-work-order:work.order.create",
      "refused:intent-not-offered-to-role:intent work-commerce.create-work-order is not offered to role vendor-manager",
      "refused:builder-refused:TITLE_REQUIRED: title",
      "ok:procurement.approve-quote:procurement.quote.approve",
      "ok:procurement.approve-quote:procurement.quote.approve",
      "ok:procurement.place-order:procurement.order.place",
      "refused:intent-not-offered-to-role:intent work-commerce.place-order is not offered to role finance-controller",
      "refused:builder-refused:NEGATIVE_AMOUNT: totalCostMinor",
      "ok:org.allocate-budget:org.budget.allocate",
      "refused:missing-intent-input:intent input is missing required field additionalSpendMinor",
      "refused:unknown-intent-event:no catalog intent binds UI event work-board:unknown-event",
    ], "the full intent sequence: five drafts build, role gates and builder laws refuse honestly"),
    eq("a2", "host.draft.successCount", 5, "exactly five inert drafts were built through the existing builders"),
    eq("a3", "host.draft.ok", false, "the final draft step (unknown event) is refused — no draft exists for it"),
    eq("a4", "host.draft.rejected", "unknown-intent-event", "the unknown event is refused with the catalog rejection"),
    eq("a5", "host.draft.idempotencyKey", "host:org.allocate-budget:bud-agent-1:100:4000", "the last built draft's key is subject-derived (the queue dedupe law)"),
    eq("a6", "host.routesValid", true, "the closing host build still machine-verifies the manifest"),
    eq("a7", "host.intentsValid", true, "the closing host build still machine-verifies the catalog"),
    eq("a8", "host.draft.validated", true, "the last built draft validates through the lane's digest law — drafts never execute here"),
  ],
};

export const hostTenantEdgesJourney: AcceptanceJourney = {
  id: "host-tenant-edges",
  persona: "operations-manager",
  capability: "host-integration",
  goal:
    "Tenant fail-closed at the host boundary: a context tenant that does not own the slice refuses the WHOLE bundle, malformed contexts and forbidden scopes refuse before any projection, and a foreign record inside the slice refuses the per-route assemblies verbatim.",
  steps: [
    { stepId: "s1", kind: "host-context-probe", probe: "tenant-mismatch" },
    { stepId: "s2", kind: "host-context-probe", probe: "malformed-context" },
    { stepId: "s3", kind: "host-context-probe", probe: "invalid-established-at" },
    { stepId: "s4", kind: "host-context-probe", probe: "forbidden-scope" },
    { stepId: "s5", kind: "quote-create", quoteId: "q-te1", vendorId: "ven-1", unitCost: 10_00, totalCost: 100_00 },
    { stepId: "s6", kind: "quote-transition", quoteId: "q-te1", command: "submit" },
    { stepId: "s7", kind: "host-context-probe", probe: "foreign-record-in-slice" },
    { stepId: "s8", kind: "host-build-view-models", now: HOST_NOW },
  ],
  assertions: [
    deq("a1", "host.probe.log", [
      "tenant-mismatch:tenant-mismatch",
      "malformed-context:malformed-context",
      "invalid-established-at:invalid-established-at",
      "forbidden-scope:forbidden-scope",
      "foreign-record-in-slice:per-assembly:TENANT_MISMATCH",
    ], "every context probe refuses at the seam with its own rejection code; the foreign record refuses per-assembly"),
    eq("a2", "host.probe.bundleRefused", false, "the context-owned bundle itself is NOT refused for a foreign record — the assemblies refuse verbatim"),
    eq("a3", "host.probe.spineRefused", true, "a foreign quote inside the slice refuses the spine assembly"),
    eq("a4", "host.probe.spineReasonCode", "TENANT_MISMATCH", "the spine refusal carries the domain's reason code"),
    eq("a5", "host.probe.spineDetail", "q-foreign", "the spine refusal names the offending foreign record"),
    eq("a6", "host.probe.vendorKpiRefused", true, "the vendor KPI assembly also refuses on the foreign record"),
    eq("a7", "host.ok", true, "the closing clean build over the tenant's own state succeeds"),
    eq("a8", "host.digestVerified", true, "the clean build's digest verifies"),
    deq("a9", "host.spineBoard.quoteStatuses", ["submitted:1"], "the clean build shows the tenant's own submitted quote"),
    eq("a10", "host.probe.ok", true, "the probes themselves executed honestly (their refusals are the expected behavior)"),
  ],
};

export const HOST_JOURNEYS: readonly AcceptanceJourney[] = [
  hostSurfaceJourney,
  hostIntentsJourney,
  hostTenantEdgesJourney,
];
