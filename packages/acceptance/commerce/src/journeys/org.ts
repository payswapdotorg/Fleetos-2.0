/**
 * @fleetos/acceptance-commerce — external-adapter, org and handoff journeys.
 *
 * Journeys 10-14 of the corpus: external catalog sync with scorecards,
 * the apify actor job, the org optimization review (proposals only),
 * the cross-role procurement → operations handoff, and tenant fail-closed
 * behavior inside the journeys.
 */

import type { AcceptanceJourney, FactValue } from "../journey-contracts.js";
import { CLOCK } from "../journey-world.js";

const eq = (id: string, fact: string, expected: FactValue, description: string) =>
  ({ id, description, fact, op: "eq" as const, expected });
const deq = (id: string, fact: string, expected: readonly string[], description: string) =>
  ({ id, description, fact, op: "deepEq" as const, expected });

export const externalCatalogSyncJourney: AcceptanceJourney = {
  id: "external-catalog-sync",
  persona: "vendor-manager",
  capability: "external-catalog-sync",
  goal: "Sync an external vendor catalog (dedupe + LWW re-import), verify a claimed capability, ingest metrics with honest quarantines and see the scorecards + revocation propagation.",
  steps: [
    { stepId: "s1", kind: "catalog-import", entries: [
      { externalId: "x-ven-1", vendorExternalId: "ven-1", displayName: "Northwind", capabilities: ["cold-chain", "gps"], logicalTime: 10 },
      { externalId: "x-ven-2", vendorExternalId: "ven-2", displayName: "Meridian", capabilities: ["gps"], logicalTime: 10 },
      { externalId: "x-ven-1", vendorExternalId: "ven-1", displayName: "Northwind", capabilities: ["cold-chain", "gps"], logicalTime: 10 },
    ] },
    { stepId: "s2", kind: "catalog-import", entries: [
      { externalId: "x-ven-1", vendorExternalId: "ven-1", displayName: "Northwind", capabilities: ["cold-chain", "gps"], logicalTime: 10 },
      { externalId: "x-ven-3", vendorExternalId: "ven-3", displayName: "Aurora", capabilities: ["cold-chain"], logicalTime: 7 },
      { externalId: "x-ven-2", vendorExternalId: "ven-2", displayName: "Meridian", capabilities: ["gps"], logicalTime: 5 },
    ] },
    { stepId: "s3", kind: "catalog-verify", externalId: "x-ven-2", capability: "gps", evidenceId: "ev-x-1" },
    { stepId: "s4", kind: "catalog-verify", externalId: "x-ven-2", capability: "cold-chain", evidenceId: "ev-x-2" },
    { stepId: "s5", kind: "catalog-metrics", drafts: [
      { metricId: "m-1", vendorExternalId: "x-ven-2", metric: "on-time", window: "W2", valueBps: 9_000, weightBps: 6_000, dependsOnCapability: "gps" },
      { metricId: "m-2", vendorExternalId: "x-ven-1", metric: "fill-rate", window: "W2", valueBps: 8_000, weightBps: 4_000, dependsOnCapability: "cold-chain" },
      { metricId: "m-3", vendorExternalId: "x-ven-9", metric: "sla", window: "W1", valueBps: 5_000, weightBps: 5_000, dependsOnCapability: null },
    ] },
    { stepId: "s6", kind: "catalog-scorecards", currentWindow: "W2", previousWindow: "W1" },
    { stepId: "s7", kind: "catalog-revoke", externalId: "x-ven-2", capability: "gps", reason: "evidence invalidated" },
    { stepId: "s8", kind: "catalog-scorecards", currentWindow: "W2", previousWindow: "W1" },
  ],
  assertions: [
    eq("a1", "catalog.ok", true, "the batch import succeeds"),
    eq("a2", "catalog.imported", 3, "two new vendors plus the LWW re-import of x-ven-2"),
    deq("a3", "catalog.importedIds", ["x-ven-1", "x-ven-2", "x-ven-3", "x-ven-2"], "the imported ids across both batches, in order"),
    deq("a4", "catalog.duplicates", ["x-ven-1", "x-ven-1"], "identical re-imports are skipped as duplicates"),
    eq("a5", "catalog.digestVerified", true, "the catalog digest verifies after every mutation"),
    eq("a6", "catalog.entryCount", 3, "three vendors live in the catalog"),
    eq("a7", "xverify.ok", true, "verifying the claimed gps capability succeeds with evidence"),
    eq("a8", "xverify.claimState", "verified", "the claim moved claimed → verified"),
    eq("a9", "xverify.reasonCode", "CAPABILITY_NOT_CLAIMED", "a capability the vendor never claimed cannot be verified"),
    eq("a10", "metrics.ok", true, "metric ingestion succeeds"),
    eq("a11", "metrics.admitted", 1, "only the metric backed by a VERIFIED capability is admitted"),
    deq("a12", "metrics.quarantined", ["m-2", "m-3"], "the unverified-capability metric and the unknown-vendor metric are quarantined, never dropped"),
    eq("a13", "scorecards.ok", true, "the REAL scorecard rollup builds"),
    deq("a14", "scorecards.vendors", ["x-ven-1", "x-ven-2", "x-ven-3"], "rollups exist for every vendor with metrics"),
    deq("a15", "scorecards.aggregatedBps", ["0", "9000", "0"], "only the verified capability contributes (9000 bps); quarantined vendors aggregate 0"),
    deq("a16", "scorecards.exclusionLines", ["m-2:CAPABILITY_NOT_VERIFIED", "", ""], "exclusions are listed with their reason codes"),
    eq("a17", "xrevoke.ok", true, "revoking the verification succeeds with a reason"),
    eq("a18", "xrevoke.recordState", "revoked", "the verification record is revoked"),
    deq("a19", "xrevoke.affectedIds", ["m-1"], "revocation propagates to the dependent metric"),
    deq("a20", "scorecards.aggregatedBps", ["0", "0", "0"], "after revocation the rollup honestly aggregates 0 for that vendor"),
  ],
};

export const apifyActorJobJourney: AcceptanceJourney = {
  id: "apify-actor-job",
  persona: "vendor-manager",
  capability: "actor-jobs",
  goal: "Propose → authorize (Guardian ref) → schedule under a rate budget → run → complete an apify actor job, then ingest its result through the evidence gate.",
  steps: [
    { stepId: "s1", kind: "apify-job-create", jobId: "job-1", actorId: "vendor-price-scraper", window: "2026-W01" },
    { stepId: "s2", kind: "apify-job-authorize", decisionId: "gd-deny-1", authorized: false, reasonCode: "exceeds-policy" },
    { stepId: "s3", kind: "apify-job-authorize", decisionId: "gd-allow-1", authorized: true, reasonCode: "within-policy" },
    { stepId: "s4", kind: "apify-job-schedule", units: 8 },
    { stepId: "s5", kind: "apify-job-transition", command: "start" },
    { stepId: "s6", kind: "apify-job-transition", command: "complete" },
    { stepId: "s7", kind: "apify-ingest-result", resultId: "r-1", payload: "structured" },
    { stepId: "s8", kind: "apify-attach-evidence", bundleId: "ev-bundle-1", digest: "sha", digestShapeValid: true },
    { stepId: "s9", kind: "apify-ingest-result", resultId: "r-2", payload: "malformed" },
    { stepId: "s10", kind: "apify-attach-evidence", bundleId: "ev-bundle-2", digest: "sha", digestShapeValid: true },
    { stepId: "s11", kind: "apify-job-create", jobId: "job-2", actorId: "vendor-price-scraper", window: "2026-W01" },
    { stepId: "s12", kind: "apify-job-authorize", decisionId: "gd-allow-2", authorized: true, reasonCode: "within-policy" },
    { stepId: "s13", kind: "apify-job-schedule", units: 5 },
  ],
  assertions: [
    eq("a1", "apify.ok", false, "the final scheduling of job-2 is refused by the rate budget"),
    eq("a2", "apify.manifestVerified", true, "the job manifest digest verifies"),
    deq("a3", "apify.statusLog", [
      "job-1:proposed", "job-1:AUTHORIZATION_DENIED", "job-1:authorized", "job-1:scheduled",
      "job-1:running", "job-1:completed", "job-2:proposed", "job-2:authorized", "job-2:RATE_BUDGET_EXCEEDED",
    ], "the full job lifecycle: proposed, refused without authorization, authorized, scheduled, running, completed; then a second job hits the rate ceiling"),
    eq("a4", "apify.budgetSpent", 8, "the rate ledger holds the 8 reserved units"),
    eq("a5", "apify.budgetUtilizationBps", 8_000, "rate utilization is 8000 bps"),
    eq("a6", "apify.budgetNote", "ceiling-not-authorization", "staying inside the rate budget authorizes NOTHING"),
    eq("a7", "apify.budgetOvershootUnits", 3, "the refused reservation reports the exact overshoot of 3 units"),
    deq("a8", "apifyIngest.stateLog", ["r-1:quarantined:EVIDENCE_NOT_ATTACHED", "r-2:quarantined:PAYLOAD_MALFORMED"], "results enter quarantine; the malformed payload is quarantined, never dropped"),
    eq("a9", "apifyEvidence.state", "usable", "attaching the sha-256-shaped evidence makes the structured result usable"),
    eq("a10", "apifyEvidence.usableCount", 1, "exactly one usable result"),
    eq("a11", "apifyEvidence.quarantinedCount", 1, "the malformed result stays quarantined"),
    eq("a12", "apifyEvidence.reasonCode", "RESULT_NOT_QUARANTINED", "evidence cannot launder a malformed payload"),
  ],
};

export const orgOptimizationReviewJourney: AcceptanceJourney = {
  id: "org-optimization-review",
  persona: "org-optimizer",
  capability: "optimization-review",
  goal: "Run the role allocator + what-if over the REAL org journal and usage ledger; the review queue shows proposals with traces and NOTHING is applied.",
  steps: [
    { stepId: "s1", kind: "org-journal-append", events: [
      { kind: "org-created" },
      { kind: "agent-enrolled", agentId: "agent-1" },
      { kind: "agent-enrolled", agentId: "agent-2" },
      { kind: "team-added", teamId: "team-core" },
      { kind: "budget-allocated", capability: "model_invoke", units: 1000, spendMinor: 50_000 },
    ] },
    { stepId: "s2", kind: "usage-append", requestRef: "req-1", agentId: "agent-1", modelId: "model-alpha", providerId: "p1", capability: "model_invoke", units: 100, costMinor: 4_000 },
    { stepId: "s3", kind: "usage-append", requestRef: "req-2", agentId: "agent-1", modelId: "model-alpha", providerId: "p1", capability: "model_invoke", units: 200, costMinor: 8_000 },
    { stepId: "s4", kind: "usage-rollup-view", computedAt: CLOCK.now },
    { stepId: "s5", kind: "org-prepare-optimization" },
    { stepId: "s6", kind: "org-allocate-roles" },
    { stepId: "s7", kind: "org-what-if" },
    { stepId: "s8", kind: "org-budget-board", computedAt: CLOCK.now },
  ],
  assertions: [
    eq("a1", "journal.entries", 5, "the org journal carries five chained entries"),
    eq("a2", "usage.ok", false, "the final usage append is refused by the REAL agent budget"),
    deq("a3", "usage.log", ["true:1", "false:BUDGET_REFUSED_BY_ORG:UNITS_EXHAUSTED"], "the first append commits; the second exceeds the agent's unit ceiling and the org reason code propagates"),
    eq("a4", "usageRollup.ok", true, "the REAL usage rollup view builds"),
    eq("a5", "usageRollup.chainOk", true, "the usage ledger chain verifies"),
    eq("a6", "usageRollup.totalCostMinor", 4_000, "the rollup totals the committed usage cost"),
    eq("a7", "opt.prepare.ok", true, "the optimization problem validates over the REAL journal + usage excerpt"),
    eq("a8", "opt.allocate.ok", true, "the role allocator produces a proposal"),
    eq("a9", "opt.allocate.note", "proposal-only-guardian-path", "the proposal is marked proposal-only — the Guardian path"),
    eq("a10", "opt.allocate.assignedCount", 1, "one holder is assigned to role-ops"),
    eq("a11", "opt.allocate.assignedInTrace", 1, "the assignment is recorded in the scoring trace"),
    eq("a12", "opt.allocate.traceLength", 2, "every candidate pair appears in the trace (2 agents × 1 demanded role)"),
    eq("a13", "opt.allocate.totalFitBps", 5_000, "the assigned holder's capability fit is 5000 bps (1 of 2 role capabilities demonstrated)"),
    eq("a14", "opt.whatif.ok", true, "the what-if projection builds"),
    eq("a15", "opt.whatif.state", "experimental-projection", "the what-if is marked experimental"),
    eq("a16", "opt.whatif.note", "never-authoritative-org-state", "the what-if is never authoritative org state"),
    eq("a17", "opt.whatif.roleAssignments", 1, "the projection applies the single role assignment"),
    eq("a18", "opt.whatif.orgDigestUnchanged", true, "running the allocator + what-if leaves the org journal fold unchanged — NOTHING was applied"),
    eq("a19", "orgBudgetBoard.ok", true, "the REAL capability budget board builds"),
    eq("a20", "orgBudgetBoard.unitUtilizationBps", 8_333, "the agent budget shows 8333 bps unit utilization"),
    eq("a21", "orgBudgetBoard.ceilingNote", "ceiling-satisfied-not-authorization", "the board stamps ceilings-not-authorizations on every row"),
  ],
};

export const crossRoleHandoffJourney: AcceptanceJourney = {
  id: "cross-role-handoff",
  persona: "procurement-lead",
  capability: "cross-role-handoff",
  goal: "A procurement lead completes an order; an operations manager consumes it into a project work order, milestone and workload — the chain is assertable end to end.",
  steps: [
    { stepId: "s1", kind: "demand-flow", command: "solicit", authorized: true, evidenceId: "ev-hs", evidenceTenantId: "acme" },
    { stepId: "s2", kind: "quote-create", quoteId: "q-h", vendorId: "ven-1", unitCost: 10_00, totalCost: 100_00 },
    { stepId: "s3", kind: "quote-transition", quoteId: "q-h", command: "submit" },
    { stepId: "s4", kind: "demand-flow", command: "award", authorized: true, evidenceId: "ev-ha", evidenceTenantId: "acme" },
    { stepId: "s5", kind: "award-quote", quoteId: "q-h", authorized: true, evidenceId: "ev-ha" },
    { stepId: "s6", kind: "order-transition", command: "confirm" },
    { stepId: "s7", kind: "order-transition", command: "ship" },
    { stepId: "s8", kind: "fulfillment-transition", command: "start_transit" },
    { stepId: "s9", kind: "fulfillment-transition", command: "deliver" },
    { stepId: "s10", kind: "fulfillment-transition", command: "verify", evidenceId: "ev-hrec", evidenceTenantId: "acme" },
    { stepId: "s11", kind: "order-transition", command: "receive" },
    { stepId: "s12", kind: "project-create", projectId: "proj-h", name: "Rotation delivery" },
    { stepId: "s13", kind: "work-create", itemId: "wo-h", title: "Shelve rotation stock", projectId: "proj-h", deadline: null },
    { stepId: "s14", kind: "work-assign", itemId: "wo-h", assignmentId: "asg-h", assigneeId: "agent-9" },
    { stepId: "s15", kind: "work-transition", itemId: "wo-h", command: "start" },
    { stepId: "s16", kind: "milestone-create", milestoneId: "m-h", name: "Stock shelved", workItemIds: ["wo-h"] },
    { stepId: "s17", kind: "milestone-gate" },
    { stepId: "s18", kind: "work-transition", itemId: "wo-h", command: "complete" },
    { stepId: "s19", kind: "milestone-gate" },
    { stepId: "s20", kind: "workload-apply", demandKey: "wd-h", units: 5, owner: "crew-a" },
    { stepId: "s21", kind: "workload-rollup-view", computedAt: CLOCK.now },
    { stepId: "s22", kind: "spine-board", computedAt: CLOCK.now },
    { stepId: "s23", kind: "work-board", computedAt: CLOCK.now },
  ],
  assertions: [
    eq("a1", "order.status", "received", "the procurement lead's order is received"),
    eq("a2", "fulfillment.status", "verified", "the fulfillment is verified with evidence"),
    eq("a3", "fulfillment.evidenceId", "ev-hrec", "the verification evidence id chains to the receipt"),
    deq("a5", "milestone.gate.log", ["false:WORK_ITEMS_NOT_TERMINAL", "true:-"], "the milestone blocks until the operations manager completes the work order"),
    deq("a6", "work.transition.log", ["true:in_progress", "true:done"], "the operations manager executes the work order to done"),
    eq("a7", "wlRollup.usedUnits", 5, "the fulfillment workload is allocated (5 units)"),
    eq("a8", "wlRollup.utilizationBps", 5_000, "the workload rollup shows 5000 bps utilization"),
    deq("a9", "spine.orderCountLines", ["received:1"], "the spine still shows the received order the work consumed"),
    deq("a10", "spine.fulfillmentCountLines", ["verified:1"], "the spine shows the verified fulfillment"),
    eq("a11", "spine.orderParent", "q-h", "the order links to the awarded quote"),
    eq("a12", "workBoard.doneCount", 1, "the work board shows the handed-off work order done"),
    eq("a13", "workBoard.firstTodoAssignee", null, "no todo card remains"),
  ],
};

export const tenantFailClosedJourney: AcceptanceJourney = {
  id: "tenant-fail-closed",
  persona: "procurement-lead",
  capability: "tenant-isolation",
  goal: "Cross-tenant evidence, quotes and whole-view reads are refused fail-closed with the domain's reason codes — never silently filtered.",
  steps: [
    { stepId: "s1", kind: "demand-flow", command: "solicit", authorized: true, evidenceId: "ev-t1", evidenceTenantId: "globex" },
    { stepId: "s2", kind: "demand-flow", command: "solicit", authorized: true, evidenceId: "ev-t1", evidenceTenantId: "acme" },
    { stepId: "s3", kind: "quote-create", quoteId: "q-x", vendorId: "ven-1", unitCost: 10_00, totalCost: 100_00, tenantId: "globex" },
    { stepId: "s4", kind: "quote-transition", quoteId: "q-x", command: "submit" },
    { stepId: "s5", kind: "award-quote", quoteId: "q-x", authorized: true, evidenceId: "ev-t1" },
    { stepId: "s6", kind: "quote-create", quoteId: "q-t", vendorId: "ven-1", unitCost: 10_00, totalCost: 100_00 },
    { stepId: "s7", kind: "quote-transition", quoteId: "q-t", command: "submit" },
    { stepId: "s8", kind: "award-quote", quoteId: "q-t", authorized: true, evidenceId: "ev-t1" },
    { stepId: "s9", kind: "order-transition", command: "confirm" },
    { stepId: "s10", kind: "fulfillment-transition", command: "start_transit" },
    { stepId: "s11", kind: "fulfillment-transition", command: "deliver" },
    { stepId: "s12", kind: "fulfillment-transition", command: "verify", evidenceId: "ev-t2", evidenceTenantId: "globex" },
    { stepId: "s13", kind: "fulfillment-transition", command: "verify", evidenceId: "ev-t2", evidenceTenantId: "acme" },
    { stepId: "s14", kind: "spine-board", computedAt: CLOCK.now },
  ],
  assertions: [
    deq("a1", "flow.log", ["false:EVIDENCE_TENANT_MISMATCH", "true:solicited"], "a solicitation gated on another tenant's evidence is refused"),
    deq("a2", "award.log", ["false:EVIDENCE_TENANT_MISMATCH", "true:draft"], "awarding a cross-tenant quote with acme evidence is refused, the same-tenant quote awards"),
    deq("a3", "fulfillment.log", ["true:in_transit", "true:delivered", "false:VERIFICATION_EVIDENCE_TENANT_MISMATCH", "true:verified"], "cross-tenant verification evidence is refused, same-tenant evidence verifies"),
    eq("a4", "spine.ok", false, "the whole spine board refuses when a cross-tenant record is present"),
    eq("a5", "spine.reasonCode", "TENANT_MISMATCH", "the refusal names the tenant violation"),
  ],
};

export const ORG_JOURNEYS: readonly AcceptanceJourney[] = [
  externalCatalogSyncJourney,
  apifyActorJobJourney,
  orgOptimizationReviewJourney,
  crossRoleHandoffJourney,
  tenantFailClosedJourney,
];
