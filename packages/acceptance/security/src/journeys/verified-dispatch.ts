/**
 * F321B journey — verified execution dispatch (persona: site-reliability-engineer).
 *
 * An SRE runs the REAL dispatch discipline end-to-end:
 *   - the due-command schedule: submit -> ack -> fail re-queues with the PURE
 *     exponential backoff (`backoffDelayMs` — no jitter, no randomness), and
 *     `dueCommands` at a logical time returns EXACTLY the commands whose
 *     nextAttemptAt has arrived, in arrival order — never early, never late;
 *   - the at-least-once + idempotency intersection
 *     (`verifyAtLeastOnceIdempotencyIntersection`): duplicates from
 *     at-least-once delivery are deduplicated — effective executions equal
 *     unique keys, and a key that never executed breaks the invariant;
 *   - the incident-audit sealers bind all three REAL decision surfaces
 *     (Guardian evaluation, action emission, execution entry) into ONE
 *     tamper-evident chain (`buildIncidentAuditTrail`), assembled in
 *     canonical order — input order never leaks — and verified;
 *   - a cross-tenant sealed input REFUSES the whole trail naming the
 *     offender (`trail.tenant-mismatch`, A8); an empty tenant refuses.
 *
 * NOTE (async-signature APIs): `executeWithVerification` and `drainQueue`
 * carry Promise signatures over the transport/queue PORTS. The security
 * corpus runner executes synchronous steps by contract (the TL-owned
 * adoption seam consumes `runJourney(j).outcome` synchronously), so this
 * journey drives the synchronous dispatch surface; the two async-signature
 * APIs are machine-run over deterministic ports in
 * tests/async-dispatch.test.ts (supporting evidence — not counted as a
 * corpus journey).
 *
 * Determinism: logical epochs (NOW_MS offsets) only; no clock, no
 * randomness, no network, no env.
 */

import type { AcceptanceJourney } from "../journey-contracts.ts";
import {
  appendExecutionLedger,
  ackCommand,
  backoffDelayMs,
  buildIncidentAuditTrail,
  completeCommand,
  createCommandQueue,
  dueCommands,
  failCommand,
  sealActionEmission,
  sealExecutionLedgerEntry,
  sealGuardianEvaluation,
  submitCommand,
  verifyAtLeastOnceIdempotencyIntersection,
  verifyIncidentAuditTrail,
} from "@fleetos/execution";
import type { CommandQueueState, ExecutionLedgerEntry } from "@fleetos/execution";
import { buildDecisionRecord, evaluateCapability } from "@fleetos/policy";
import { emitAuditTrail } from "@fleetos/actions";
import { READ_CAPABILITY, TENANT, FOREIGN_TENANT, NOW_MS, isoOfEpochMs, tenantPolicy } from "./fixture-world.ts";
import { appendLed, e2eActionChain } from "./wave10-world.ts";

const QUEUE_KEY = "dispatch-cmd-1";
const QUEUE_KEY_B = "dispatch-cmd-2";

export const verifiedDispatchJourney: AcceptanceJourney = {
  journeyId: "security.verified-execution-dispatch",
  persona: "site-reliability-engineer",
  capabilities: ["execution-ledger"],
  goal: "Run the due-command dispatch schedule, the idempotency intersection and the sealed incident trail",
  steps: [
    {
      stepId: "due-schedule",
      kind: "queue",
      description: "Drive the retry schedule: fail re-queues with pure backoff; dueCommands returns exactly what is due at each logical time",
      packages: ["@fleetos/execution"],
      operations: ["createCommandQueue", "submitCommand", "ackCommand", "failCommand", "completeCommand", "dueCommands", "backoffDelayMs"],
      run: (ctx) => {
        // The pure backoff schedule — deterministic, capped, no jitter.
        ctx.record("backoff.attempt1", backoffDelayMs(1));
        ctx.record("backoff.attempt2", backoffDelayMs(2));
        ctx.record("backoff.attempt3", backoffDelayMs(3));
        ctx.record("backoff.attempt6", backoffDelayMs(6));

        const queue = createCommandQueue(TENANT.tenantId);
        if (!queue.ok) throw new Error("queue creation refused");
        let state: CommandQueueState = queue.state;

        // T0: submit A (due immediately).
        const a = submit(state, QUEUE_KEY, NOW_MS);
        state = a;
        ctx.record("due.atT0.keys", dueCommands(state, NOW_MS).map((c) => c.idempotencyKey));

        // T0+1s: ack A -> in-flight.
        const ack1 = ackOf(state, QUEUE_KEY, NOW_MS + 1_000);
        state = ack1;

        // T0+2s: A fails -> re-queued with attempts 2 and
        // nextAttemptAt = T0+2s + backoff(2) = T0+4s.
        const fail = failOf(state, QUEUE_KEY, "transport error", NOW_MS + 2_000);
        state = fail.state;
        ctx.record("due.failed.status", fail.command.status);
        ctx.record("due.failed.attempts", fail.command.attempts);
        ctx.record("due.failed.nextAttemptAt", fail.command.nextAttemptAt);

        // T0+3s: submit B (due at submission time).
        state = submit(state, QUEUE_KEY_B, NOW_MS + 3_000);

        // At T0+3s: ONLY B is due (A backs off until T0+4s).
        ctx.record("due.atT3.keys", dueCommands(state, NOW_MS + 3_000).map((c) => c.idempotencyKey));
        // At T0+3.5s: still only B.
        ctx.record("due.atT35.keys", dueCommands(state, NOW_MS + 3_500).map((c) => c.idempotencyKey));

        // At T0+4s: A AND B are due, in ARRIVAL order (A first).
        const atT4 = dueCommands(state, NOW_MS + 4_000);
        ctx.record("due.atT4.keys", atT4.map((c) => c.idempotencyKey));
        ctx.record("due.atT4.order", atT4.map((c) => c.submissionSeq));

        // Dispatch A (ack -> complete) and B (ack -> complete).
        state = ackOf(state, QUEUE_KEY, NOW_MS + 4_000);
        state = completeOf(state, QUEUE_KEY, NOW_MS + 4_500);
        state = ackOf(state, QUEUE_KEY_B, NOW_MS + 5_000);
        state = completeOf(state, QUEUE_KEY_B, NOW_MS + 5_500);

        // Nothing left due — the queue is drained honestly.
        ctx.record("due.atT6.keys", dueCommands(state, NOW_MS + 6_000).map((c) => c.idempotencyKey));
        ctx.record("due.completedCount", state.commands.filter((c) => c.status === "completed").length);
      },
    },
    {
      stepId: "idempotency-intersection",
      kind: "negative-check",
      description: "At-least-once duplicates dedupe to effectively-once; a key that never executed breaks the invariant",
      packages: ["@fleetos/execution"],
      operations: ["verifyAtLeastOnceIdempotencyIntersection"],
      run: (ctx) => {
        // At-least-once delivery with a duplicate: the duplicate never
        // double-executes — effective executions == unique keys.
        const delivered = verifyAtLeastOnceIdempotencyIntersection([
          { idempotencyKey: "dispatch-cmd-1", executed: true },
          { idempotencyKey: "dispatch-cmd-2", executed: true },
          { idempotencyKey: "dispatch-cmd-1", executed: true },
        ]);
        ctx.record("idem.totalDispatches", delivered.totalDispatches);
        ctx.record("idem.uniqueKeys", delivered.uniqueKeys);
        ctx.record("idem.effectiveExecutions", delivered.effectiveExecutions);
        ctx.record("idem.intersectionHolds", delivered.intersectionHolds);

        // NEGATIVE: a unique key that never executed breaks the law.
        const lost = verifyAtLeastOnceIdempotencyIntersection([
          { idempotencyKey: "dispatch-cmd-1", executed: true },
          { idempotencyKey: "dispatch-cmd-2", executed: false },
        ]);
        ctx.record("idem.lost.intersectionHolds", lost.intersectionHolds);
        ctx.record("idem.lost.effectiveExecutions", lost.effectiveExecutions);
        ctx.record("idem.lost.uniqueKeys", lost.uniqueKeys);
      },
    },
    {
      stepId: "incident-trail-sealing",
      kind: "ledger",
      description: "Seal the three REAL decision surfaces into one tamper-evident incident trail; refuse cross-tenant and empty-tenant inputs",
      packages: ["@fleetos/execution", "@fleetos/policy", "@fleetos/actions"],
      operations: ["sealGuardianEvaluation", "sealActionEmission", "sealExecutionLedgerEntry", "buildIncidentAuditTrail", "verifyIncidentAuditTrail"],
      run: (ctx) => {
        // REAL Guardian evaluation -> DecisionRecord.
        const policy = tenantPolicy();
        const decision = evaluateCapability(policy, READ_CAPABILITY, {
          tenant: TENANT,
          capability: READ_CAPABILITY,
          actor: { actorId: "analyst-kim", authority: ["tenant.engineer"], isAutonomous: false },
          degraded: false,
        });
        const record = buildDecisionRecord(decision, {
          policyId: policy.id,
          policyVersion: policy.version,
          capability: READ_CAPABILITY,
          actorId: "analyst-kim",
          actorIsAutonomous: false,
          actorAuthority: ["tenant.engineer"],
          evaluatedAt: isoOfEpochMs(NOW_MS),
          matchedFacts: [],
        });

        // REAL action emissions (the F300B e2e chain through the REAL protocol).
        const emissions = emitAuditTrail(e2eActionChain("dispatch-intent-1", "dispatch-nonce-1", QUEUE_KEY), "operator-ada");

        // REAL execution ledger entries.
        let ledger: readonly ExecutionLedgerEntry[] = [];
        ledger = appendLed(ledger, { tenantId: TENANT.tenantId, idempotencyKey: QUEUE_KEY, kind: "submitted", at: NOW_MS, detail: "" });
        ledger = appendLed(ledger, { tenantId: TENANT.tenantId, idempotencyKey: QUEUE_KEY, kind: "acked", at: NOW_MS + 1_000, detail: "" });
        ledger = appendLed(ledger, { tenantId: TENANT.tenantId, idempotencyKey: QUEUE_KEY, kind: "completed", at: NOW_MS + 2_000, detail: "state=ok" });

        // THE SEALERS: each REAL record maps onto its audit surface.
        const sealedDecision = sealGuardianEvaluation(record, NOW_MS);
        const sealedEmission = sealActionEmission(emissions[0]!);
        const sealedEntry = sealExecutionLedgerEntry(ledger[0]!);
        ctx.record("seal.decision.surface", sealedDecision.surface);
        ctx.record("seal.decision.subjectIsRecordId", sealedDecision.subjectId === record.recordId);
        ctx.record("seal.decision.subjectPrefix", sealedDecision.subjectId.slice(0, "rec-fleetos.asset.read-state-".length));
        ctx.record("seal.decision.occurredAt", sealedDecision.occurredAt);
        ctx.record("seal.decision.verdict", sealedDecision.payload.verdict);
        ctx.record("seal.emission.surface", sealedEmission.surface);
        ctx.record("seal.emission.subject", sealedEmission.subjectId);
        ctx.record("seal.emission.intentId", sealedEmission.payload.intentId);
        ctx.record("seal.entry.surface", sealedEntry.surface);
        ctx.record("seal.entry.subject", sealedEntry.subjectId);
        ctx.record("seal.entry.kind", sealedEntry.payload.kind);
        ctx.record("seal.entry.entryDigestCarried", typeof sealedEntry.payload.entryDigest === "string" && (sealedEntry.payload.entryDigest as string).length === 8);

        // ASSEMBLY: canonical order — reverse input order, identical chain.
        const trail = buildIncidentAuditTrail({
          tenantId: TENANT.tenantId,
          decisions: [{ record, atMs: NOW_MS }],
          emissions,
          entries: [...ledger],
        });
        if (!trail.ok) throw new Error(`incident trail refused: ${trail.reason}`);
        const trailReversed = buildIncidentAuditTrail({
          tenantId: TENANT.tenantId,
          decisions: [{ record, atMs: NOW_MS }],
          emissions: [...emissions].reverse(),
          entries: [...ledger].reverse(),
        });
        if (!trailReversed.ok) throw new Error(`reversed trail refused: ${trailReversed.reason}`);
        ctx.record("trail.eventCount", trail.trail.length);
        ctx.record("trail.inputOrderInvariant", JSON.stringify(trail.trail.map((e) => e.entryDigest)) === JSON.stringify(trailReversed.trail.map((e) => e.entryDigest)));
        ctx.record("trail.uniqueSurfaces", [...new Set(trail.trail.map((e) => e.surface))]);
        ctx.record("trail.firstSurface", trail.trail[0]?.surface ?? "none");
        const verified = verifyIncidentAuditTrail(trail.trail);
        ctx.record("trail.verified", verified.verified);
        ctx.record("trail.checkedEntries", verified.checkedEntries);

        // NEGATIVE: a sealed input from ANOTHER tenant refuses the whole trail.
        const foreignAppend = appendExecutionLedger([], {
          tenantId: FOREIGN_TENANT.tenantId,
          idempotencyKey: "foreign-cmd-1",
          kind: "submitted",
          at: NOW_MS,
          detail: "",
        });
        if (!foreignAppend.ok) throw new Error("foreign ledger append refused");
        const foreignLedger: readonly ExecutionLedgerEntry[] = foreignAppend.ledger;
        const foreign = buildIncidentAuditTrail({
          tenantId: TENANT.tenantId,
          decisions: [{ record, atMs: NOW_MS }],
          emissions,
          entries: [...ledger, ...foreignLedger],
        });
        ctx.record("trail.crossTenantOk", foreign.ok);
        ctx.record("trail.crossTenantReason", foreign.ok ? "unexpected-allow" : foreign.reason);
        ctx.record("trail.crossTenantOffender", foreign.ok ? "none" : foreign.offender);

        // NEGATIVE: an empty tenant scope refuses.
        const noTenant = buildIncidentAuditTrail({ tenantId: "", emissions });
        ctx.record("trail.noTenantOk", noTenant.ok);
        ctx.record("trail.noTenantReason", noTenant.ok ? "unexpected-allow" : noTenant.reason);
      },
    },
  ],
  assertions: [
    { assertionId: "vd-1", description: "Backoff attempt 1 is the base delay", path: "backoff.attempt1", expected: 1000 },
    { assertionId: "vd-2", description: "Backoff attempt 2 doubles", path: "backoff.attempt2", expected: 2000 },
    { assertionId: "vd-3", description: "Backoff attempt 3 quadruples", path: "backoff.attempt3", expected: 4000 },
    { assertionId: "vd-4", description: "Backoff caps at the policy maximum (no runaway)", path: "backoff.attempt6", expected: 30000 },
    { assertionId: "vd-5", description: "A fresh command is due immediately", path: "due.atT0.keys", expected: ["dispatch-cmd-1"] },
    { assertionId: "vd-6", description: "A failed attempt re-queues for retry", path: "due.failed.status", expected: "queued" },
    { assertionId: "vd-7", description: "Attempts increment on retry", path: "due.failed.attempts", expected: 2 },
    { assertionId: "vd-8", description: "Next attempt scheduled with pure backoff (T0+2s + 2s)", path: "due.failed.nextAttemptAt", expected: 1791831004000 },
    { assertionId: "vd-9", description: "At T0+3s only the newly-submitted command is due", path: "due.atT3.keys", expected: ["dispatch-cmd-2"] },
    { assertionId: "vd-10", description: "The backed-off command is not due a moment early", path: "due.atT35.keys", expected: ["dispatch-cmd-2"] },
    { assertionId: "vd-11", description: "At the backoff time BOTH commands are due", path: "due.atT4.keys", expected: ["dispatch-cmd-1", "dispatch-cmd-2"] },
    { assertionId: "vd-12", description: "Due order is arrival order (submission sequence)", path: "due.atT4.order", expected: [1, 2] },
    { assertionId: "vd-13", description: "Nothing due after both complete (drained)", path: "due.atT6.keys", expected: [] },
    { assertionId: "vd-14", description: "Both commands completed", path: "due.completedCount", expected: 2 },
    { assertionId: "vd-15", description: "3 dispatches seen by the intersection probe", path: "idem.totalDispatches", expected: 3 },
    { assertionId: "vd-16", description: "2 unique keys", path: "idem.uniqueKeys", expected: 2 },
    { assertionId: "vd-17", description: "Duplicates never double-execute (effective = unique)", path: "idem.effectiveExecutions", expected: 2 },
    { assertionId: "vd-18", description: "The at-least-once + idempotency intersection HOLDS", path: "idem.intersectionHolds", expected: true },
    { assertionId: "vd-19", description: "A key that never executed breaks the law", path: "idem.lost.intersectionHolds", expected: false },
    { assertionId: "vd-20", description: "The lost key produced zero effective executions", path: "idem.lost.effectiveExecutions", expected: 1 },
    { assertionId: "vd-21", description: "The lost case still sees the unique keys", path: "idem.lost.uniqueKeys", expected: 2 },
    { assertionId: "vd-22", description: "Guardian evaluations seal onto their surface", path: "seal.decision.surface", expected: "guardian.evaluation" },
    { assertionId: "vd-23", description: "The sealed subject IS the DecisionRecord id", path: "seal.decision.subjectIsRecordId", expected: true },
    { assertionId: "vd-23b", description: "The record id derives from the capability + decision digest", path: "seal.decision.subjectPrefix", expected: "rec-fleetos.asset.read-state-" },
    { assertionId: "vd-24", description: "The decision's logical epoch is carried", path: "seal.decision.occurredAt", expected: 1791831000000 },
    { assertionId: "vd-25", description: "The Guardian verdict is sealed into the payload", path: "seal.decision.verdict", expected: "ALLOW" },
    { assertionId: "vd-26", description: "Action emissions seal onto their surface", path: "seal.emission.surface", expected: "action.emission" },
    { assertionId: "vd-27", description: "The emission id is the sealed subject", path: "seal.emission.subject", expected: "audit-dispatch-intent-1-proposed-authorized" },
    { assertionId: "vd-28", description: "The intent id is sealed into the payload", path: "seal.emission.intentId", expected: "dispatch-intent-1" },
    { assertionId: "vd-29", description: "Execution entries seal onto their surface", path: "seal.entry.surface", expected: "execution.entry" },
    { assertionId: "vd-30", description: "The sealed subject is key#index", path: "seal.entry.subject", expected: "dispatch-cmd-1#0" },
    { assertionId: "vd-31", description: "The ledger kind is sealed into the payload", path: "seal.entry.kind", expected: "submitted" },
    { assertionId: "vd-32", description: "The entry's own digest is carried in the payload (8-hex)", path: "seal.entry.entryDigestCarried", expected: true },
    { assertionId: "vd-33", description: "The trail chains every emission of the action protocol", path: "trail.eventCount", expected: 11 },
    { assertionId: "vd-34", description: "Input order never leaks (byte-identical chains)", path: "trail.inputOrderInvariant", expected: true },
    { assertionId: "vd-35", description: "All three surfaces present (canonical epoch + surface-rank order)", path: "trail.uniqueSurfaces", expected: ["guardian.evaluation", "execution.entry", "action.emission"] },
    { assertionId: "vd-35b", description: "The first sealed event is the earliest-epoch decision surface", path: "trail.firstSurface", expected: "guardian.evaluation" },
    { assertionId: "vd-36", description: "The assembled trail verifies", path: "trail.verified", expected: true },
    { assertionId: "vd-37", description: "Every trail entry checked", path: "trail.checkedEntries", expected: 11 },
    { assertionId: "vd-38", description: "A cross-tenant sealed input REFUSES the trail (A8)", path: "trail.crossTenantOk", expected: false },
    { assertionId: "vd-39", description: "Cross-tenant refusal code", path: "trail.crossTenantReason", expected: "trail.tenant-mismatch" },
    { assertionId: "vd-40", description: "The offender names surface and subject", path: "trail.crossTenantOffender", expected: "execution.entry:foreign-cmd-1#0" },
    { assertionId: "vd-41", description: "An empty tenant scope refuses the trail", path: "trail.noTenantOk", expected: false },
    { assertionId: "vd-42", description: "Empty-tenant refusal code", path: "trail.noTenantReason", expected: "trail.missing-tenant" },
  ],
};

// --- deterministic queue helpers (fail-loud, no silent refusals) ---

function submit(state: CommandQueueState, key: string, at: number): CommandQueueState {
  const result = submitCommand(state, {
    idempotencyKey: key,
    capabilityId: READ_CAPABILITY.id,
    payloadInputs: { assetId: "pump-7" },
    at,
    tenantId: TENANT.tenantId,
    authorizationDigest: "digest-dispatch-allow",
    verdict: "ALLOW",
  });
  if (!result.ok) throw new Error(`submit ${key} refused: ${result.reason}`);
  return result.state;
}

function ackOf(state: CommandQueueState, key: string, at: number): CommandQueueState {
  const result = ackCommand(state, key, at, TENANT.tenantId);
  if (!result.ok) throw new Error(`ack ${key} refused: ${result.reason}`);
  return result.state;
}

function completeOf(state: CommandQueueState, key: string, at: number): CommandQueueState {
  const result = completeCommand(state, key, { ack: true }, at, TENANT.tenantId);
  if (!result.ok) throw new Error(`complete ${key} refused: ${result.reason}`);
  return result.state;
}

function failOf(state: CommandQueueState, key: string, reason: string, at: number) {
  const result = failCommand(state, key, reason, at, TENANT.tenantId);
  if (!result.ok) throw new Error(`fail ${key} refused: ${result.reason}`);
  return result;
}
