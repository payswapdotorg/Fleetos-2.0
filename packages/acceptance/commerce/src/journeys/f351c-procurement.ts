/**
 * @fleetos/acceptance-commerce — F351C procurement journeys (Wave 15 lane
 * C): order-creation authorization discipline, quote comparison, and
 * idempotent document creation.
 *
 * CENSUS CITATION (the F351C commerce census — docs/evidence/F351C/
 * report.md §1, machine-measured at base cb572b8): every journey here
 * drives public APIs with ZERO corpus coverage across all three corpora
 * (grep proof): `createProcurementDirectory` / `ProcurementDirectory.
 * createOrder` (directory.ts:216/301 — the existing procure-spine
 * journeys drive the FLOW API `awardQuoteToOrder`, a different entry
 * point whose gate is a SUBMITTED quote, not an ACCEPTED one),
 * `compareQuotes` (commerce-math.ts:96 — the existing quote-scoring
 * journey drives the EXPERIENCE read model), and
 * `createDocumentIdempotent` + `computeRequestDigest` (flow.ts:284/312).
 *
 * D14 form: unique ids, REAL domain public entry points, >=5 substantive
 * assertions incl. >=1 refusal each, deterministic byte-identity on
 * rerun. Single-epoch (T0): no step consumes the run anchor, no
 * assertion carries an epoch table (D13 — invariant across the frozen
 * schedule, never an epoch-earning responder).
 */

import type { AcceptanceJourney, FactValue } from "../journey-contracts.js";
import { CLOCK } from "../journey-world.js";

const eq = (id: string, fact: string, expected: FactValue, description: string) =>
  ({ id, description, fact, op: "eq" as const, expected });
const deq = (id: string, fact: string, expected: readonly string[], description: string) =>
  ({ id, description, fact, op: "deepEq" as const, expected });

const guardianAllow = { decisionId: "gd-allow-1", authorized: true, reasonCode: "within-policy" };
const guardianDeny = { decisionId: "gd-deny-1", authorized: false, reasonCode: "exceeds-policy" };

/**
 * Order creation through the REAL ProcurementDirectory application
 * service: quotes transition draft → submitted → accepted with
 * append-only audit events; an order is created ONLY from an ACCEPTED
 * quote and ONLY behind a law-A5 Guardian authorization (a denied
 * decision refuses AUTHORIZATION_DENIED — procurement never
 * self-authorizes; a not-yet-accepted quote refuses ILLEGAL_TRANSITION);
 * the created order persists with the procurement.order-created audit
 * carrying the authorization decision id; and cross-tenant reads through
 * the directory return NOTHING (fail-closed).
 */
export const procurementOrderAuthorizationJourney: AcceptanceJourney = {
  id: "procurement-order-authorization",
  persona: "procurement-lead",
  capability: "procurement-ordering",
  goal: "Create a purchase order through the REAL ProcurementDirectory over the REAL in-memory repository — the quote must be ACCEPTED first (an early attempt off a submitted quote refuses ILLEGAL_TRANSITION), the law-A5 Guardian gate refuses a denied decision (AUTHORIZATION_DENIED — procurement never self-authorizes), the successful creation persists a draft order whose audit event carries the authorization decision id, and cross-tenant order/quote reads fail closed (the other tenant sees nothing, never a record).",
  steps: [
    { stepId: "s1", kind: "pdir-quote-seed", factKey: "seed",
      quotes: [
        { quoteId: "q-alpha", vendorId: "ven-alpha", unitCost: 200, totalCost: 2000 },
        { quoteId: "q-beta", vendorId: "ven-beta", unitCost: 210, totalCost: 2100 },
        { quoteId: "q-foreign", vendorId: "ven-foreign", unitCost: 150, totalCost: 1500, tenant: "foreign" },
      ] },
    { stepId: "s2", kind: "pdir-quote-transition", factKey: "submit", quoteId: "q-alpha", command: "submit" },
    { stepId: "s3", kind: "pdir-quote-transition", factKey: "submitBeta", quoteId: "q-beta", command: "submit" },
    { stepId: "s4", kind: "pdir-quote-transition", factKey: "accept", quoteId: "q-alpha", command: "accept" },
    // A5 refusal: the Guardian decision is denied (the quote IS accepted — the authorization gate fires).
    { stepId: "s5", kind: "pdir-order-create", factKey: "denied", orderId: "ord-1", quoteId: "q-alpha", authorization: guardianDeny },
    // Gate refusal: q-beta is only SUBMITTED, not accepted.
    { stepId: "s6", kind: "pdir-order-create", factKey: "early", orderId: "ord-1", quoteId: "q-beta", authorization: guardianAllow },
    { stepId: "s7", kind: "pdir-order-create", factKey: "ok", orderId: "ord-1", quoteId: "q-alpha", authorization: guardianAllow },
    { stepId: "s8", kind: "pdir-order-read", factKey: "own", orderId: "ord-1" },
    // Fail-closed: the other tenant's scope sees nothing.
    { stepId: "s9", kind: "pdir-order-read", factKey: "foreign", orderId: "ord-1", callerTenant: "foreign" },
    { stepId: "s10", kind: "pdir-quote-read", factKey: "own", quoteId: "q-alpha" },
    { stepId: "s11", kind: "pdir-quote-read", factKey: "foreignQuote", quoteId: "q-alpha", callerTenant: "foreign" },
    // Illegal transition: an accepted quote allows no further transition.
    { stepId: "s12", kind: "pdir-quote-transition", factKey: "illegal", quoteId: "q-alpha", command: "withdraw" },
  ],
  assertions: [
    eq("oa1", "pdir.seed.seed.count", 3, "three quotes are seeded into the REAL in-memory repository"),
    eq("oa2", "pdir.seed.seed.foreignCount", 1, "one seeded quote sits under the OTHER tenant (fail-closed probe input)"),
    eq("oa3", "pdir.quote.submit.ok", true, "the draft quote submits through the directory"),
    eq("oa4", "pdir.quote.submit.status", "submitted", "the quote's next status is submitted"),
    eq("oa5", "pdir.quote.submit.auditKind", "procurement.quote-transitioned", "the directory emits the quote-transitioned audit event"),
    eq("oa6", "pdir.quote.submit.auditFromStatus", "draft", "the audit records the from-status verbatim"),
    eq("oa7", "pdir.order.denied.reasonCode", "AUTHORIZATION_DENIED", "REFUSAL: a denied Guardian decision refuses order creation (law A5 — procurement never self-authorizes)"),
    eq("oa8", "pdir.order.denied.status", null, "no order exists after the denied attempt"),
    eq("oa9", "pdir.order.early.reasonCode", "ILLEGAL_TRANSITION", "REFUSAL: an order cannot be created from a quote that is only SUBMITTED (the directory's accepted-quote gate)"),
    eq("oa10", "pdir.quote.accept.status", "accepted", "the accepted quote reaches the accepted status"),
    eq("oa11", "pdir.order.ok.ok", true, "the order creates from the accepted quote behind the authorized Guardian decision"),
    eq("oa12", "pdir.order.ok.status", "draft", "the created order starts in draft status"),
    eq("oa13", "pdir.order.ok.quoteId", "q-alpha", "the order references the accepted quote"),
    eq("oa14", "pdir.order.ok.authorizationDecisionId", "gd-allow-1", "the order carries the authorizing decision id"),
    eq("oa15", "pdir.order.ok.auditKind", "procurement.order-created", "the directory emits the order-created audit event"),
    eq("oa16", "pdir.order.ok.auditAuthorizationDecisionId", "gd-allow-1", "the audit event carries the authorization decision id"),
    eq("oa17", "pdir.order.ok.auditDigest", "audit_d4b38cce", "the order-created audit digest is the FNV-1a shape (stable, evidence-grade)"),
    eq("oa18", "pdir.orderRead.own.found", true, "the order reads back through the directory (persisted)"),
    eq("oa19", "pdir.orderRead.foreign.found", false, "REFUSAL-class fact: the OTHER tenant's scope reads NOTHING (fail-closed)"),
    eq("oa20", "pdir.orderRead.foreign.status", null, "the cross-tenant read exposes no order status"),
    eq("oa21", "pdir.quoteRead.foreignQuote.found", false, "the cross-tenant quote read also returns nothing"),
    eq("oa22", "pdir.quote.illegal.reasonCode", "ILLEGAL_TRANSITION", "REFUSAL: an accepted quote is terminal — withdraw refuses"),
    deq("oa23", "pdir.quoteLog", [
      "q-alpha:submitted",
      "q-beta:submitted",
      "q-alpha:accepted",
      "q-alpha:refused:ILLEGAL_TRANSITION",
    ], "the quote log carries every transition and refusal in order"),
    deq("oa24", "pdir.orderLog", [
      "ord-1:refused:AUTHORIZATION_DENIED",
      "ord-1:refused:ILLEGAL_TRANSITION",
      "ord-1:draft:gd-allow-1",
    ], "the order log carries both refusals and the successful creation in order"),
  ],
};

/**
 * Deterministic quote comparison over the REAL procurement commerce-math
 * kernel: integer-bps score decomposition (cheapest unit cost and
 * shortest lead time score 10000; capability coverage in bps of the
 * required tags), the weighted total, ranking with the tie-break rule
 * RECORDED on every entry that tied with its predecessor — all four
 * rules exercised (lower-total-cost, shorter-lead-time,
 * earlier-submission, vendor-id-lexical) — and the honest refusals (no
 * quotes, weights that do not sum to 10000, invalid unit cost, invalid
 * lead time, foreign-tenant quotes refuse the whole comparison
 * fail-closed).
 */
export const quoteComparisonDisciplineJourney: AcceptanceJourney = {
  id: "quote-comparison-discipline",
  persona: "procurement-lead",
  capability: "quote-comparison",
  goal: "Compare quotes through the REAL compareQuotes kernel — the cheapest and shortest quotes score 10000 in their lanes, capability coverage scores in bps of the required tags, the total is the floored weighted sum; every tie on the total records the rule that resolved it (lower-total-cost, shorter-lead-time, earlier-submission, vendor-id-lexical — in that documented order), and the kernel refuses honestly: NO_QUOTES on an empty sheet, WEIGHTS_MUST_SUM_TO_10000 on misweighted policy, INVALID_UNIT_COST / INVALID_LEAD_TIME on malformed quotes, and TENANT_MISMATCH when a foreign-tenant quote enters the input (fail-closed — never silently filtered).",
  steps: [
    // Default weights (5000/2000/3000): bravo beats alpha on the total-cost tie-break; cheap scores 7100.
    { stepId: "s1", kind: "qcmp-compare", factKey: "main",
      demandTags: ["telemetry", "maintenance"],
      quotes: [
        { quoteId: "q-alpha", vendorId: "ven-alpha", unitCostMinor: 200, totalCostMinor: 2000, leadTimeDays: 3, capabilityTags: ["telemetry", "maintenance"], submittedAtEpoch: 1_000 },
        { quoteId: "q-bravo", vendorId: "ven-bravo", unitCostMinor: 200, totalCostMinor: 1500, leadTimeDays: 3, capabilityTags: ["telemetry", "maintenance"], submittedAtEpoch: 1_000 },
        { quoteId: "q-cheap", vendorId: "ven-budget", unitCostMinor: 100, totalCostMinor: 900, leadTimeDays: 10, capabilityTags: ["telemetry"], submittedAtEpoch: 2_000 },
      ] },
    // Custom weights (5000/0/5000): the score tie resolves on lead time.
    { stepId: "s2", kind: "qcmp-compare", factKey: "tieLead",
      demandTags: ["telemetry", "maintenance"],
      weights: { priceWeightBps: 5000, termsWeightBps: 0, capabilityWeightBps: 5000 },
      quotes: [
        { quoteId: "q-papa", vendorId: "ven-papa", unitCostMinor: 100, totalCostMinor: 1000, leadTimeDays: 10, capabilityTags: ["telemetry"], submittedAtEpoch: 1_000 },
        { quoteId: "q-quil", vendorId: "ven-quil", unitCostMinor: 200, totalCostMinor: 1000, leadTimeDays: 3, capabilityTags: ["telemetry", "maintenance"], submittedAtEpoch: 1_000 },
      ] },
    // Earlier submission decides BEFORE vendor-id lexical (ven-zulu beats ven-alpha).
    { stepId: "s3", kind: "qcmp-compare", factKey: "tieSubmit",
      demandTags: ["telemetry"],
      quotes: [
        { quoteId: "q-first", vendorId: "ven-zulu", unitCostMinor: 150, totalCostMinor: 1500, leadTimeDays: 4, capabilityTags: ["telemetry"], submittedAtEpoch: 1_000 },
        { quoteId: "q-second", vendorId: "ven-alpha", unitCostMinor: 150, totalCostMinor: 1500, leadTimeDays: 4, capabilityTags: ["telemetry"], submittedAtEpoch: 2_000 },
      ] },
    // Fully identical except vendor id: lexical decides.
    { stepId: "s4", kind: "qcmp-compare", factKey: "tieLexical",
      demandTags: ["telemetry"],
      quotes: [
        { quoteId: "q-lex-b", vendorId: "ven-alva", unitCostMinor: 150, totalCostMinor: 1500, leadTimeDays: 4, capabilityTags: ["telemetry"], submittedAtEpoch: 1_000 },
        { quoteId: "q-lex-a", vendorId: "ven-alfa", unitCostMinor: 150, totalCostMinor: 1500, leadTimeDays: 4, capabilityTags: ["telemetry"], submittedAtEpoch: 1_000 },
      ] },
    // The refusal battery.
    { stepId: "s5", kind: "qcmp-compare", factKey: "refEmpty", demandTags: ["telemetry"], quotes: [] },
    { stepId: "s6", kind: "qcmp-compare", factKey: "refWeights", demandTags: ["telemetry"],
      weights: { priceWeightBps: 4000, termsWeightBps: 3000, capabilityWeightBps: 2000 },
      quotes: [{ quoteId: "q-w", vendorId: "ven-w", unitCostMinor: 100, totalCostMinor: 1000, leadTimeDays: 1, capabilityTags: ["telemetry"], submittedAtEpoch: 1 }] },
    { stepId: "s7", kind: "qcmp-compare", factKey: "refUnitCost", demandTags: ["telemetry"],
      quotes: [{ quoteId: "q-u", vendorId: "ven-u", unitCostMinor: 0, totalCostMinor: 1000, leadTimeDays: 1, capabilityTags: ["telemetry"], submittedAtEpoch: 1 }] },
    { stepId: "s8", kind: "qcmp-compare", factKey: "refLeadTime", demandTags: ["telemetry"],
      quotes: [{ quoteId: "q-l", vendorId: "ven-l", unitCostMinor: 100, totalCostMinor: 1000, leadTimeDays: -1, capabilityTags: ["telemetry"], submittedAtEpoch: 1 }] },
    { stepId: "s9", kind: "qcmp-compare", factKey: "refForeign", demandTags: ["telemetry"],
      quotes: [{ quoteId: "q-f", vendorId: "ven-f", unitCostMinor: 100, totalCostMinor: 1000, leadTimeDays: 1, capabilityTags: ["telemetry"], submittedAtEpoch: 1, tenant: "foreign" }] },
  ],
  assertions: [
    deq("qc1", "qcmp.main.quoteOrder", ["q-bravo", "q-alpha", "q-cheap"], "the ranked order: bravo wins the 7500 tie on lower total cost"),
    deq("qc2", "qcmp.main.ranks", ["q-bravo:1", "q-alpha:2", "q-cheap:3"], "the ranks are 1, 2, 3 in the recorded order"),
    deq("qc3", "qcmp.main.totals", ["q-bravo:7500", "q-alpha:7500", "q-cheap:7100"], "the weighted totals: the tie pair at 7500, the cheap-but-slow quote at 7100"),
    deq("qc4", "qcmp.main.priceScores", ["q-bravo:5000", "q-alpha:5000", "q-cheap:10000"], "the cheapest unit cost scores 10000; twice-the-cost quotes score 5000"),
    deq("qc5", "qcmp.main.termsScores", ["q-bravo:10000", "q-alpha:10000", "q-cheap:3000"], "the shortest lead time scores 10000; the 10-day quote scores floor(3*10000/10)"),
    deq("qc6", "qcmp.main.capabilityScores", ["q-bravo:10000", "q-alpha:10000", "q-cheap:5000"], "full tag coverage scores 10000; half coverage scores 5000"),
    deq("qc7", "qcmp.main.tieBreakRules", ["q-bravo:none", "q-alpha:lower-total-cost", "q-cheap:none"], "the tie records the rule that resolved it (lower-total-cost); non-tied entries record none"),
    deq("qc8", "qcmp.tieLead.tieBreakRules", ["q-quil:none", "q-papa:shorter-lead-time"], "with a zero terms weight the score tie resolves on the recorded shorter-lead-time rule"),
    deq("qc9", "qcmp.tieLead.totals", ["q-quil:7500", "q-papa:7500"], "both custom-weight comparisons total 7500 — a genuine score tie"),
    deq("qc10", "qcmp.tieSubmit.quoteOrder", ["q-first", "q-second"], "the earlier submission ranks first"),
    deq("qc11", "qcmp.tieSubmit.tieBreakRules", ["q-first:none", "q-second:earlier-submission"], "the tie records earlier-submission (ven-zulu beats ven-alpha — submission order decides BEFORE vendor-id lexical)"),
    deq("qc12", "qcmp.tieLexical.quoteOrder", ["q-lex-a", "q-lex-b"], "fully identical quotes resolve on vendor-id lexical (ven-alfa before ven-alva)"),
    deq("qc13", "qcmp.tieLexical.tieBreakRules", ["q-lex-a:none", "q-lex-b:vendor-id-lexical"], "the last tie-break rule is recorded verbatim"),
    eq("qc14", "qcmp.refEmpty.reasonCode", "NO_QUOTES", "REFUSAL: comparing an empty quote sheet refuses NO_QUOTES"),
    eq("qc15", "qcmp.refWeights.reasonCode", "WEIGHTS_MUST_SUM_TO_10000", "REFUSAL: weights that sum to 9000 (not 10000) refuse — the policy is never silently rebalanced"),
    eq("qc16", "qcmp.refUnitCost.reasonCode", "INVALID_UNIT_COST", "REFUSAL: a zero unit cost refuses"),
    eq("qc17", "qcmp.refLeadTime.reasonCode", "INVALID_LEAD_TIME", "REFUSAL: a negative lead time refuses"),
    eq("qc18", "qcmp.refForeign.reasonCode", "TENANT_MISMATCH", "REFUSAL: a foreign-tenant quote refuses the whole comparison fail-closed"),
    eq("qc19", "qcmp.refForeign.rankedCount", 0, "no ranking is produced on refusal"),
  ],
};

/**
 * Idempotent document creation over the REAL procurement flow API: the
 * same request id + the same request digest returns the ORIGINAL
 * document id with duplicate=true (never created twice — even when the
 * replay names a different documentId); the same request id with a
 * different digest is a typed conflict; empty ids/digests refuse with
 * the exact required-field reason codes; and the request digest itself
 * is deterministic and distinct for distinct semantic content.
 */
export const procurementIdempotentCreationJourney: AcceptanceJourney = {
  id: "procurement-idempotent-creation",
  persona: "operations-manager",
  capability: "idempotent-creation",
  goal: "Create procurement documents idempotently through the REAL createDocumentIdempotent + computeRequestDigest APIs — a first submission creates the document (duplicate=false), a replay of the SAME request id with the SAME digest returns the ORIGINAL document id with duplicate=true even though the replay names a different documentId (the registry never creates twice), the same request id with a DIFFERENT digest refuses IDEMPOTENCY_KEY_CONFLICT (a typed conflict, never a silent overwrite), empty request ids / digests / document ids refuse with their exact reason codes, and the request digest is deterministic for identical content and distinct for different content.",
  steps: [
    { stepId: "s1", kind: "pidem-create", factKey: "first", requestId: "req-101", semanticContent: "order:ven-alpha:10:2000", documentKind: "order", documentId: "doc-1", createdAt: CLOCK.t0 },
    // The replay: same request id + same digest, but a DIFFERENT documentId in the input.
    { stepId: "s2", kind: "pidem-create", factKey: "replay", requestId: "req-101", semanticContent: "order:ven-alpha:10:2000", documentKind: "order", documentId: "doc-999", createdAt: CLOCK.t1 },
    // The conflict: same request id, different semantic content (different digest).
    { stepId: "s3", kind: "pidem-create", factKey: "conflict", requestId: "req-101", semanticContent: "order:ven-beta:5:900", documentKind: "order", documentId: "doc-2", createdAt: CLOCK.t2 },
    // A second, distinct request id creates a second document (registry grows).
    { stepId: "s4", kind: "pidem-create", factKey: "second", requestId: "req-102", semanticContent: "quote:ven-gamma:12:1440", documentKind: "quote", documentId: "doc-2", createdAt: CLOCK.t3 },
    { stepId: "s5", kind: "pidem-create", factKey: "noRequestId", requestId: "", semanticContent: "order:ven-alpha:10:2000", documentKind: "order", documentId: "doc-3", createdAt: CLOCK.t4 },
    { stepId: "s6", kind: "pidem-create", factKey: "noDigest", requestId: "req-103", semanticContent: "", documentKind: "order", documentId: "doc-3", createdAt: CLOCK.t4 },
    { stepId: "s7", kind: "pidem-create", factKey: "noDocId", requestId: "req-103", semanticContent: "order:ven-alpha:10:2000", documentKind: "order", documentId: "", createdAt: CLOCK.t4 },
    { stepId: "s8", kind: "pidem-digest", factKey: "law", first: "order:ven-alpha:10:2000", second: "order:ven-beta:5:900", third: "quote:ven-gamma:12:1440" },
  ],
  assertions: [
    eq("ic1", "pidem.create.first.ok", true, "the first submission creates the document"),
    eq("ic2", "pidem.create.first.duplicate", false, "the first submission is not a duplicate"),
    eq("ic3", "pidem.create.first.documentId", "doc-1", "the created document carries the requested id"),
    eq("ic4", "pidem.create.first.recordCount", 1, "the registry holds exactly one record after the first creation"),
    eq("ic5", "pidem.create.replay.ok", true, "the replay of the same request id succeeds (idempotent)"),
    eq("ic6", "pidem.create.replay.duplicate", true, "the replay is marked duplicate"),
    eq("ic7", "pidem.create.replay.documentId", "doc-1", "the replay returns the ORIGINAL document id — even though its input named doc-999"),
    eq("ic8", "pidem.create.replay.recordCount", 1, "the registry still holds ONE record — the document is never created twice"),
    eq("ic9", "pidem.create.conflict.reasonCode", "IDEMPOTENCY_KEY_CONFLICT", "REFUSAL: the same request id with a different digest is a typed conflict"),
    eq("ic10", "pidem.create.conflict.recordCount", 1, "the conflict leaves the registry untouched"),
    eq("ic11", "pidem.create.second.ok", true, "a distinct request id creates a second document"),
    eq("ic12", "pidem.create.second.duplicate", false, "the second request is not a duplicate"),
    eq("ic13", "pidem.create.second.recordCount", 2, "the registry now holds two records"),
    eq("ic14", "pidem.create.noRequestId.reasonCode", "REQUEST_ID_REQUIRED", "REFUSAL: an empty request id refuses"),
    eq("ic15", "pidem.create.noDigest.reasonCode", "REQUEST_DIGEST_REQUIRED", "REFUSAL: an empty request digest refuses"),
    eq("ic16", "pidem.create.noDocId.reasonCode", "DOCUMENT_ID_REQUIRED", "REFUSAL: an empty document id refuses"),
    eq("ic17", "pidem.digest.law.deterministic", true, "the REAL request digest is deterministic (identical content, identical digest)"),
    eq("ic18", "pidem.digest.law.distinct", true, "distinct semantic content produces a distinct digest"),
    eq("ic19", "pidem.digest.law.thirdDistinct", true, "a third distinct content is distinct from both"),
    deq("ic20", "pidem.log", [
      "req-101:created:doc-1",
      "req-101:duplicate:doc-1",
      "req-101:refused:IDEMPOTENCY_KEY_CONFLICT",
      "req-102:created:doc-2",
      "-:refused:REQUEST_ID_REQUIRED",
      "req-103:refused:REQUEST_DIGEST_REQUIRED",
      "req-103:refused:DOCUMENT_ID_REQUIRED",
    ], "the idempotency log carries every creation, duplicate, conflict, and refusal in order"),
  ],
};

export const F351C_PROCUREMENT_JOURNEYS: readonly AcceptanceJourney[] = [
  procurementOrderAuthorizationJourney,
  quoteComparisonDisciplineJourney,
  procurementIdempotentCreationJourney,
];
