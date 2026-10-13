/**
 * @fleetos/acceptance-field — F341A journey A1: the observations
 * backpressure discipline (Wave 14 lane A).
 *
 * CENSUS CITATION (F340 §1, candidate A1, verbatim row): "observations
 * backpressure | `packages/observations/src/backpressure.ts` (OverflowPolicy
 * refuse/shed-oldest, BackpressurePolicy, QueueState, EnqueueDecision,
 * BackpressureLevel ok/warn/critical) | NO journey exercises it (grep: zero
 * matches in acceptance/field) | CANDIDATE A1".
 *
 * The REAL capability is @fleetos/observations' bounded-queue law: enqueue
 * under a REAL BackpressurePolicy, level transitions at the REAL thresholds
 * (evaluateBackpressureLevel ok/warn/critical), refuse-and-retry overflow
 * that NEVER silently drops (the refused item leaves depth unchanged and
 * increments the refused counter), shed-oldest divergence (the same
 * thresholds, the opposite outcome), and bounded recovery via dequeue.
 *
 * Vocabulary law: persona `edge-operator` + capability `trustworthy-state`
 * (the ingestion queue that guards observation admission — the frozen
 * 14-capability vocabulary's trustworthy-state family; no vocabulary
 * change, F331A precedent).
 */

import type { AcceptanceJourney } from "../journey-contracts.js";

export const observationsBackpressureDisciplineJourney: AcceptanceJourney = {
  id: "observations-backpressure-discipline",
  persona: "edge-operator",
  capability: "trustworthy-state",
  goal: "Keep the edge observation queue honest under load: real level thresholds, refuse-and-retry overflow that never silently drops, the shed-oldest divergence, and bounded recovery after dequeue.",
  steps: [
    {
      id: "b1",
      summary: "open the edge ingestion queue under a real backpressure policy (refuse-and-retry, depth 8, warn 3, critical 6)",
      op: {
        kind: "bp.queue-open",
        queueId: "q_ingest-refuse",
        policy: { maxQueueDepth: 8, warnDepth: 3, criticalDepth: 6, overflow: "refuse" },
      },
    },
    {
      id: "b2",
      summary: "classify the real level thresholds across the full depth range (the ok/warn/critical boundaries)",
      op: { kind: "bp.level-probe", queueId: "q_ingest-refuse", depths: [0, 2, 3, 5, 6, 8] },
    },
    { id: "b3", summary: "present the first three observations (below warn)", op: { kind: "bp.enqueue-batch", queueId: "q_ingest-refuse", count: 3 } },
    { id: "b4", summary: "present three more (warn into critical)", op: { kind: "bp.enqueue-batch", queueId: "q_ingest-refuse", count: 3 } },
    {
      id: "b5",
      summary: "present three more at the full queue: the last is refused with overflow-refused (never silently dropped)",
      expectRefusal: true,
      op: { kind: "bp.enqueue-batch", queueId: "q_ingest-refuse", count: 3 },
    },
    {
      id: "b6",
      summary: "present one more: refused again, the caller is expected to retry",
      expectRefusal: true,
      op: { kind: "bp.enqueue-batch", queueId: "q_ingest-refuse", count: 1 },
    },
    { id: "b7", summary: "drain two items (back to the critical boundary)", op: { kind: "bp.dequeue-batch", queueId: "q_ingest-refuse", count: 2 } },
    { id: "b8", summary: "drain one more (into warn)", op: { kind: "bp.dequeue-batch", queueId: "q_ingest-refuse", count: 1 } },
    { id: "b9", summary: "drain three more (back to ok)", op: { kind: "bp.dequeue-batch", queueId: "q_ingest-refuse", count: 3 } },
    {
      id: "b10",
      summary: "open a second queue with the SAME thresholds but shed-oldest overflow",
      op: {
        kind: "bp.queue-open",
        queueId: "q_ingest-shed",
        policy: { maxQueueDepth: 8, warnDepth: 3, criticalDepth: 6, overflow: "shed-oldest" },
      },
    },
    { id: "b11", summary: "fill the shed queue to capacity without shedding", op: { kind: "bp.enqueue-batch", queueId: "q_ingest-shed", count: 8 } },
    { id: "b12", summary: "present two more at the full shed queue: both are admitted by shedding the oldest", op: { kind: "bp.enqueue-batch", queueId: "q_ingest-shed", count: 2 } },
    { id: "b13", summary: "read the package's default backpressure policy (provenance)", op: { kind: "bp.policy-defaults" } },
  ],
  assertions: [
    { id: "q1", description: "a fresh queue starts empty", reading: "b1.bp.depth", op: "deep-equals", expected: 0 },
    { id: "q2", description: "a fresh queue has refused nothing", reading: "b1.bp.refused", op: "deep-equals", expected: 0 },
    { id: "q3", description: "a fresh queue has shed nothing", reading: "b1.bp.shed", op: "deep-equals", expected: 0 },
    {
      id: "q4",
      description: "the REAL level thresholds transition exactly at warnDepth and criticalDepth",
      reading: "b2.bp.levels",
      op: "deep-equals",
      expected: ["ok", "ok", "warn", "warn", "critical", "critical"],
    },
    { id: "q5", description: "three presentations land the queue at the warn boundary", reading: "b3.bp.depth", op: "deep-equals", expected: 3 },
    { id: "q6", description: "the ok->warn transition fires exactly at depth 3 (warnDepth)", reading: "b3.bp.signals", op: "deep-equals", expected: ["ok", "ok", "warn"] },
    { id: "q7", description: "six presentations land the queue at the critical boundary", reading: "b4.bp.depth", op: "deep-equals", expected: 6 },
    { id: "q8", description: "the warn->critical transition fires exactly at depth 6 (criticalDepth)", reading: "b4.bp.signals", op: "deep-equals", expected: ["warn", "warn", "critical"] },
    { id: "q9", description: "the overflow refusal carries the REAL reason code", reading: "b5.bp.reason", op: "deep-equals", expected: "overflow-refused" },
    { id: "q10", description: "a refused item is NEVER silently dropped: the depth stays at the bound", reading: "b5.bp.depth", op: "deep-equals", expected: 8 },
    { id: "q11", description: "the refusal is counted honestly (refused=1)", reading: "b5.bp.refused", op: "deep-equals", expected: 1 },
    { id: "q12", description: "a second refusal accumulates (refused=2), never resets", reading: "b6.bp.refused", op: "deep-equals", expected: 2 },
    { id: "q13", description: "the queue stays bounded across repeated refusals", reading: "b6.bp.depth", op: "deep-equals", expected: 8 },
    { id: "q14", description: "draining two items frees capacity (depth 6)", reading: "b7.bp.depth", op: "deep-equals", expected: 6 },
    { id: "q15", description: "the level at depth 6 is critical (the boundary is inclusive)", reading: "b7.bp.signal", op: "deep-equals", expected: "critical" },
    { id: "q16", description: "the level at depth 5 is warn", reading: "b8.bp.signal", op: "deep-equals", expected: "warn" },
    { id: "q17", description: "the level at depth 2 is ok — the full recovery path critical->warn->ok", reading: "b9.bp.signal", op: "deep-equals", expected: "ok" },
    { id: "q18", description: "the shed queue fills to capacity without shedding anything", reading: "b11.bp.shed", op: "deep-equals", expected: 0 },
    { id: "q19", description: "the shed queue is full (depth 8) at the critical level", reading: "b11.bp.signal", op: "deep-equals", expected: "critical" },
    { id: "q20", description: "DIVERGENCE: at the same full depth, the shed-oldest queue ADMITS both presentations instead of refusing them (admitted=2)", reading: "b12.bp.admitted", op: "deep-equals", expected: 2 },
    { id: "q21", description: "the shed counter records exactly the two shed presentations (the refuse queue refused these instead)", reading: "b12.bp.shed", op: "deep-equals", expected: 2 },
    { id: "q22", description: "shedding keeps the queue bounded (the oldest is replaced, depth stays 8)", reading: "b12.bp.depth", op: "deep-equals", expected: 8 },
    { id: "q23", description: "the package default bound is 1000 deep", reading: "b13.bp.default.maxQueueDepth", op: "deep-equals", expected: 1000 },
    { id: "q24", description: "the package default overflow discipline is refuse-and-retry", reading: "b13.bp.default.overflow", op: "deep-equals", expected: "refuse" },
    { id: "q25", description: "the package default thresholds are warn 100 / critical 500", reading: "b13.bp.default.criticalDepth", op: "deep-equals", expected: 500 },
  ],
};
