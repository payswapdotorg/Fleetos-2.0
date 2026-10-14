/**
 * @fleetos/acceptance-commerce — F361C order journey (Wave 17 lane C):
 * the marketplace order-ack discipline.
 *
 * CENSUS CITATION (the F361C commerce census — docs/evidence/F361C/
 * report.md §1, machine-measured at base `203f077`): every step here
 * drives public APIs with ZERO corpus coverage across all three
 * corpora (grep proof): `draftEquipmentMarketplaceOrder` /
 * `transitionEquipmentMarketplaceOrder` /
 * `acknowledgeProviderOrder` / `findEquipmentMarketplaceOrder` /
 * `buildEquipmentMarketplaceOrderBoard` (procurement/
 * marketplace-equipment-order.ts — the §3.4 machine + the manual
 * provider-ack seam) composed with `linkMarketplaceOrderWork` /
 * `serviceWorkAcceptanceGate` (work/marketplace-order-work.ts) over
 * the REAL in-memory work repository + WorkItemDirectory. The id names
 * THIS lane's MARKETPLACE angle (the F354 lesson; the pre-existing
 * `marketplace-transactions` journeys drive the DIFFERENT F331C
 * listing-checkout machine).
 *
 * D14 form: unique id, REAL domain public entry points, >=5 substantive
 * assertions incl. >=1 refusal, deterministic byte-identity on rerun.
 * Single-epoch (T0): no step consumes the run anchor, no assertion
 * carries an epoch table (D13).
 */

import type { AcceptanceJourney, FactValue } from "../journey-contracts.js";

const eq = (id: string, fact: string, expected: FactValue, description: string) =>
  ({ id, description, fact, op: "eq" as const, expected });
const deq = (id: string, fact: string, expected: readonly string[], description: string) =>
  ({ id, description, fact, op: "deepEq" as const, expected });

const T0 = 1_774_000_000_000;

/**
 * The marketplace order lifecycle through the REAL §3.4 machine + the
 * manual provider-ack seam: the order drafts from the approved request
 * and selected offer with exact integer money, places into
 * provider-ack-pending, and the MANUAL acknowledgement records its
 * evidence reference IDEMPOTENTLY — the SAME provider event replayed
 * returns the acknowledged order with duplicate=true and the ORIGINAL
 * evidence (never a second conclusion), while a DIFFERENT provider
 * event on the acknowledged order REFUSES ALREADY_ACKNOWLEDGED
 * (duplicate provider events refused). The repair-service composition:
 * the order links to a REAL work item through the REAL repository, the
 * accept gate REFUSES WORK_NOT_COMPLETED while the service work is
 * outstanding, and the order accepts ONLY after the REAL work item
 * completes through the REAL WorkItemDirectory. Terminal states refuse
 * re-transition; the cross-tenant read sees NOTHING.
 */
export const marketplaceOrderAckDisciplineJourney: AcceptanceJourney = {
  id: "marketplace-order-ack-discipline",
  persona: "operations-manager",
  capability: "marketplace-fulfilment",
  goal: "Run a marketplace order through the REAL §3.4 lifecycle with the manual provider-ack seam — the order drafts from the approved request + selected offer with exact integer money and places into ack-pending; the acknowledgement records its evidence reference through a MANUAL channel IDEMPOTENTLY (the same provider event replayed returns duplicate=true with the ORIGINAL evidence — never a second conclusion; a different event refuses ALREADY_ACKNOWLEDGED; a missing reference or foreign evidence tenant refuses with the exact codes); the repair-service order links to a REAL work item, the accept gate refuses WORK_NOT_COMPLETED until the REAL work completes through the REAL directory, and only then does the order accept; a shipped-before-ack attempt and a terminal re-transition both refuse ILLEGAL_TRANSITION; and the OTHER tenant's read sees NOTHING.",
  steps: [
    { stepId: "s1", kind: "mord-draft", factKey: "draft", orderId: "ord-7710", requestId: "req-7710", offerId: "off-7710", supplierId: "sup-accra", sku: "LT-5540", quantity: 5, unitCostMinor: 1_200_000, totalCostMinor: 6_000_000, currency: "GHS" },
    // REFUSAL: a draft order cannot ship.
    { stepId: "s2", kind: "mord-transition", factKey: "earlyShip", command: "ship", at: T0 + 1_000 },
    { stepId: "s3", kind: "mord-place", factKey: "place", at: T0 + 2_000 },
    { stepId: "s4", kind: "mord-board", factKey: "placed", },
    // REFUSAL: a placed order cannot ship BEFORE the provider acknowledgement.
    { stepId: "s5", kind: "mord-transition", factKey: "shipBeforeAck", command: "ship", at: T0 + 3_000 },
    // REFUSAL: the ack evidence reference is REQUIRED.
    { stepId: "s6", kind: "mord-ack", factKey: "noEvidence", providerEventId: "pe-2026-7710-x", evidenceId: "", evidenceTenantId: "acme", channel: "manual-invoice-reference", acknowledgedAt: T0 + 4_000 },
    // REFUSAL: the ack evidence reference must belong to the SAME tenant.
    { stepId: "s7", kind: "mord-ack", factKey: "foreignEvidence", providerEventId: "pe-2026-7710-x", evidenceId: "inv-foreign", evidenceTenantId: "globex", channel: "manual-invoice-reference", acknowledgedAt: T0 + 5_000 },
    // The manual provider-ack seam records the evidence reference (invoice number).
    { stepId: "s8", kind: "mord-ack", factKey: "ack", providerEventId: "pe-2026-7710-01", evidenceId: "inv-2026-7710", evidenceTenantId: "acme", channel: "manual-invoice-reference", acknowledgedAt: T0 + 6_000 },
    // The IDEMPOTENT replay: the same provider event id.
    { stepId: "s9", kind: "mord-ack", factKey: "replay", providerEventId: "pe-2026-7710-01", evidenceId: "inv-OTHER", evidenceTenantId: "acme", channel: "manual-portal-export", acknowledgedAt: T0 + 7_000 },
    // REFUSAL: a DIFFERENT provider event on the acknowledged order — duplicate events refused.
    { stepId: "s10", kind: "mord-ack", factKey: "duplicateEvent", providerEventId: "pe-2026-7710-02", evidenceId: "inv-2026-7710-b", evidenceTenantId: "acme", channel: "manual-portal-export", acknowledgedAt: T0 + 8_000 },
    // The repair-service work composition (REAL work package).
    { stepId: "s11", kind: "mord-work-create", factKey: "create", workItemId: "wi-repair-7710", title: "Repair service for marketplace order ord-7710" },
    { stepId: "s12", kind: "mord-work-assign", factKey: "assign", workItemId: "wi-repair-7710", assignmentId: "asgn-7710", assigneeId: "act_tech-kofi-01" },
    { stepId: "s13", kind: "mord-work-transition", factKey: "start", workItemId: "wi-repair-7710", command: "start" },
    { stepId: "s14", kind: "mord-work-link", factKey: "link", workItemId: "wi-repair-7710", linkKind: "repair-service", at: T0 + 9_000 },
    { stepId: "s15", kind: "mord-transition", factKey: "ship", command: "ship", at: T0 + 10_000 },
    { stepId: "s16", kind: "mord-transition", factKey: "receive", command: "receive", at: T0 + 11_000 },
    // REFUSAL: the accept gate — the service work is still outstanding.
    { stepId: "s17", kind: "mord-accept", factKey: "gateRefused", at: T0 + 12_000, requireWorkGate: true },
    // The explicit gate probe: WORK_NOT_COMPLETED.
    { stepId: "s18", kind: "mord-work-gate", factKey: "blocked" },
    // The REAL work completes through the REAL directory.
    { stepId: "s19", kind: "mord-work-transition", factKey: "complete", workItemId: "wi-repair-7710", command: "complete" },
    { stepId: "s20", kind: "mord-work-gate", factKey: "open" },
    // The gated accept now passes.
    { stepId: "s21", kind: "mord-accept", factKey: "accept", at: T0 + 13_000, requireWorkGate: true },
    // REFUSAL: accepted is TERMINAL.
    { stepId: "s22", kind: "mord-transition", factKey: "terminal", command: "ship", at: T0 + 14_000 },
    { stepId: "s23", kind: "mord-read", factKey: "own" },
    // Fail-closed: the OTHER tenant's scope sees nothing.
    { stepId: "s24", kind: "mord-read", factKey: "foreign", callerTenant: "foreign" },
    { stepId: "s25", kind: "mord-board", factKey: "final" },
  ],
  assertions: [
    eq("oa1", "mord.draft.draft.ok", true, "the order drafts from the approved request + selected offer"),
    eq("oa2", "mord.draft.draft.status", "draft", "the drafted order starts in draft"),
    eq("oa3", "mord.draft.draft.totalCostMinor", 6_000_000, "the exact integer total (quantity × unit cost) carries verbatim"),
    eq("oa4", "mord.transition.earlyShip.reasonCode", "ILLEGAL_TRANSITION", "REFUSAL: a draft order cannot ship"),
    eq("oa5", "mord.place.place.status", "placed", "the order places into provider-ack pending"),
    eq("oa6", "mord.place.place.acknowledgement", true, "the placed order carries NO acknowledgement yet (ack pending)"),
    deq("oa7", "mord.board.placed.ackPendingOrderIds", ["ord-7710"], "the board lists the order in the ack-pending set"),
    eq("oa8", "mord.transition.shipBeforeAck.reasonCode", "ILLEGAL_TRANSITION", "REFUSAL: a placed order cannot ship before the provider acknowledgement"),
    eq("oa9", "mord.ack.noEvidence.reasonCode", "ACK_EVIDENCE_REFERENCE_REQUIRED", "REFUSAL: the ack evidence reference is required"),
    eq("oa10", "mord.ack.foreignEvidence.reasonCode", "ACK_EVIDENCE_TENANT_MISMATCH", "REFUSAL: the ack evidence reference must belong to the order's own tenant"),
    eq("oa11", "mord.ack.ack.ok", true, "the manual provider-ack seam acknowledges the placed order"),
    eq("oa12", "mord.ack.ack.status", "acknowledged", "the order reaches the acknowledged status"),
    eq("oa13", "mord.ack.ack.evidenceId", "inv-2026-7710", "the ack records the evidence reference (the invoice number)"),
    eq("oa14", "mord.ack.ack.channel", "manual-invoice-reference", "the ack channel is the MANUAL invoice-reference kind — never a live-API claim"),
    eq("oa15", "mord.ack.replay.duplicate", true, "the SAME provider event replayed is IDEMPOTENT (duplicate=true)"),
    eq("oa16", "mord.ack.replay.evidenceId", "inv-2026-7710", "the replay returns the ORIGINAL evidence reference — even though its input named inv-OTHER"),
    eq("oa17", "mord.ack.replay.acknowledgedAt", T0 + 6_000, "the replay leaves the ORIGINAL acknowledgement timestamp — never a second conclusion"),
    eq("oa18", "mord.ack.duplicateEvent.reasonCode", "ALREADY_ACKNOWLEDGED", "REFUSAL: a DIFFERENT provider event on the acknowledged order is refused (duplicate provider events refused)"),
    eq("oa19", "mord.workCreate.create.ok", true, "the repair-service work item creates through the REAL work repository"),
    eq("oa20", "mord.workTransition.start.status", "in_progress", "the REAL WorkItemDirectory starts the repair work"),
    eq("oa21", "mord.workLink.link.status", "linked", "the order links to the work item through the REAL link API"),
    eq("oa22", "mord.workLink.link.kind", "repair-service", "the link records the repair-service kind"),
    eq("oa23", "mord.transition.ship.status", "shipped", "the acknowledged order ships"),
    eq("oa24", "mord.transition.receive.status", "received", "the shipped order is received"),
    eq("oa25", "mord.accept.gateRefused.reasonCode", "WORK_NOT_COMPLETED", "REFUSAL: the gated accept refuses while the service work is outstanding"),
    eq("oa26", "mord.workGate.blocked.reasonCode", "WORK_NOT_COMPLETED", "the explicit gate probe confirms the same refusal"),
    eq("oa27", "mord.workTransition.complete.status", "done", "the REAL directory completes the repair work"),
    eq("oa28", "mord.workGate.open.ok", true, "the gate opens once the service work is done"),
    eq("oa29", "mord.accept.accept.ok", true, "the gated accept passes AFTER the service work completes"),
    eq("oa30", "mord.accept.accept.status", "accepted", "the order reaches the accepted terminal"),
    eq("oa31", "mord.accept.accept.acceptedAt", T0 + 13_000, "the acceptance carries its timestamp"),
    eq("oa32", "mord.transition.terminal.reasonCode", "ILLEGAL_TRANSITION", "REFUSAL: accepted is TERMINAL — no further transition ever fires"),
    eq("oa33", "mord.read.own.found", true, "the own-tenant read finds the accepted order"),
    eq("oa34", "mord.read.own.acknowledged", true, "the read back shows the acknowledgement persisted"),
    eq("oa35", "mord.read.foreign.found", false, "REFUSAL-class fact: the OTHER tenant's scope reads NOTHING (fail-closed)"),
    eq("oa36", "mord.read.foreign.status", null, "the cross-tenant read exposes no order status"),
    eq("oa37", "mord.board.final.acknowledged", 0, "the final board counts no acknowledged-pending order"),
    eq("oa38", "mord.board.final.accepted", 1, "the final board counts the accepted order"),
    deq("oa39", "mord.log", [
      "draft:ord-7710:draft",
      "transition:ship:refused:ILLEGAL_TRANSITION",
      "place:ord-7710:placed",
      "transition:ship:refused:ILLEGAL_TRANSITION",
      "ack:pe-2026-7710-x:refused:ACK_EVIDENCE_REFERENCE_REQUIRED",
      "ack:pe-2026-7710-x:refused:ACK_EVIDENCE_TENANT_MISMATCH",
      "ack:pe-2026-7710-01:acknowledged:inv-2026-7710",
      "ack:pe-2026-7710-01:duplicate:inv-2026-7710",
      "ack:pe-2026-7710-02:refused:ALREADY_ACKNOWLEDGED",
      "work-create:wi-repair-7710:todo",
      "work-assign:wi-repair-7710:act_tech-kofi-01",
      "work:start:wi-repair-7710:in_progress",
      "work-link:ord-7710:wi-repair-7710:repair-service",
      "transition:ship:shipped",
      "transition:receive:received",
      "accept:ord-7710:refused:WORK_NOT_COMPLETED",
      "work-gate:ord-7710:refused:WORK_NOT_COMPLETED",
      "work:complete:wi-repair-7710:done",
      "work-gate:ord-7710:open:wi-repair-7710",
      "accept:ord-7710:accepted",
      "transition:ship:refused:ILLEGAL_TRANSITION",
    ], "the order log carries every transition, ack, replay, duplicate refusal, gate verdict and work composition in order"),
  ],
};

export const F361C_ORDER_JOURNEYS: readonly AcceptanceJourney[] = [
  marketplaceOrderAckDisciplineJourney,
];
