/**
 * F321B journey — finding-storm triage (persona: security-analyst).
 *
 * A security analyst survives a detector STORM through the hardened intake
 * pipeline (@fleetos/security finding-storms — F280B):
 *   - the full storm pipeline (runStormIntake) dedupes exact duplicates,
 *     correlates survivors by the REAL correlation key and escalates by
 *     repeat pressure — the queue carries the GROUP-escalated severity;
 *   - the deduped survivor SET is invariant under any arrival permutation
 *     (dedupeFindingStorm over the reversed storm => byte-identical ids);
 *   - the triage queue has an HONEST BOUND: over-limit input REFUSES with
 *     the exact counts (`triage.queue-overflow`), never silently truncates;
 *   - an empty queue refuses (`triage.empty-queue`) and a cross-tenant
 *     finding refuses naming the offender (`storm.tenant-mismatch`, A8).
 *
 * Determinism: fixed logical epochs (BASE_MS offsets); no clock, no
 * randomness, no network. Same-shape discipline as the F270B intake journey
 * but over the STORM path — never driven by any corpus journey before.
 */

import type { AcceptanceJourney } from "../journey-contracts.ts";
import {
  buildStormTriageQueue,
  correlateFindingStorm,
  dedupeFindingStorm,
  runStormIntake,
} from "@fleetos/security";
import type { FindingIntakeCandidate } from "@fleetos/security";
import { BASE_MS, TENANT, FOREIGN_TENANT } from "./fixture-world.ts";

const WINDOW_MS = 120_000;
const LIMIT = 10;

function candidate(input: {
  readonly tenantId: string;
  readonly detectedAt: number;
  readonly description: string;
  readonly declaredSeverity?: string;
  readonly assetIds?: readonly string[];
}): FindingIntakeCandidate {
  return {
    tenantId: input.tenantId,
    kind: "device.compromised_indicator",
    declaredSeverity: input.declaredSeverity ?? "medium",
    confidence: "confirmed",
    detectedAt: input.detectedAt,
    assetIds: input.assetIds ?? ["pump-7"],
    description: input.description,
    evidenceRefs: ["ev-storm-1"],
    signalCount: 3,
  };
}

/** The storm: 3 distinct descriptions of one compromise (correlated class
 * on pump-7) + 2 exact duplicates of the first report + 1 low-severity
 * report on a DIFFERENT asset (its own correlation class) + 1 empty-tenant
 * invalid candidate => 4 survivors, 2 duplicates, 1 invalid, one correlated
 * group of 3 occurrences escalating medium -> high. */
const STORM: readonly FindingIntakeCandidate[] = [
  candidate({ tenantId: "", detectedAt: BASE_MS, description: "no tenant" }),
  candidate({ tenantId: TENANT.tenantId, detectedAt: BASE_MS + 1_000, description: "indicator trip one" }),
  candidate({ tenantId: TENANT.tenantId, detectedAt: BASE_MS + 10_000, description: "indicator trip two" }),
  candidate({ tenantId: TENANT.tenantId, detectedAt: BASE_MS + 20_000, description: "indicator trip three" }),
  candidate({ tenantId: TENANT.tenantId, detectedAt: BASE_MS + 1_000, description: "indicator trip one" }),
  candidate({ tenantId: TENANT.tenantId, detectedAt: BASE_MS + 1_000, description: "indicator trip one" }),
  candidate({
    tenantId: TENANT.tenantId,
    detectedAt: BASE_MS + 30_000,
    description: "unrelated low report",
    declaredSeverity: "low",
    assetIds: ["pump-8"],
  }),
];

const VALID_STORM = STORM.filter((c) => c.tenantId !== "");

export const findingStormJourney: AcceptanceJourney = {
  journeyId: "security.finding-storm-triage",
  persona: "security-analyst",
  capabilities: ["investigate-findings"],
  goal: "Survive a finding storm through the hardened dedupe/correlate/triage pipeline with honest bounds",
  steps: [
    {
      stepId: "storm-intake",
      kind: "intake",
      description: "Run the REAL storm pipeline over a 7-candidate storm (1 invalid, 2 duplicates, 4 survivors, one escalating group)",
      packages: ["@fleetos/security"],
      operations: ["runStormIntake", "dedupeFindingStorm", "correlateFindingStorm"],
      run: (ctx) => {
        const storm = runStormIntake(STORM, {
          tenantId: TENANT.tenantId,
          triageLimit: LIMIT,
          correlationWindowMs: WINDOW_MS,
        });
        ctx.record("storm.received", storm.dedupe.metrics.received);
        ctx.record("storm.invalid", storm.dedupe.metrics.invalid);
        ctx.record("storm.duplicates", storm.dedupe.metrics.duplicates);
        ctx.record("storm.survived", storm.dedupe.metrics.survived);
        ctx.record("storm.distinctClasses", storm.dedupe.metrics.distinctClasses);
        ctx.record("storm.survivorDescriptions", storm.dedupe.survivors.map((f) => f.description));
        const group = storm.groups.find((g) => g.occurrences === 3);
        if (group === undefined) throw new Error("escalating correlation group missing");
        ctx.record("storm.group.key", group.correlationKey);
        ctx.record("storm.group.occurrences", group.occurrences);
        ctx.record("storm.group.escalatedTo", group.escalatedTo);
        ctx.record("storm.group.peakSeverity", group.peakSeverity);
        ctx.record("storm.group.firstDetectedAt", group.firstDetectedAt);
        ctx.record("storm.group.lastDetectedAt", group.lastDetectedAt);
        ctx.record("storm.groupCount", storm.groups.length);

        // The escalated survivor enters the triage queue at the escalated severity.
        const queue = storm.triage;
        if (!queue.ok) throw new Error(`triage refused: ${queue.refused}`);
        const escalatedSurvivor = queue.queue.find((f) => f.description === "indicator trip three");
        if (escalatedSurvivor === undefined) throw new Error("escalated survivor missing from queue");
        ctx.record("storm.queue.depth", queue.depth);
        ctx.record("storm.queue.first.description", queue.queue[0]?.description ?? "none");
        ctx.record("storm.queue.escalated.severity", escalatedSurvivor.severity);
        ctx.record("storm.queue.escalated.escalated", escalatedSurvivor.escalated);
        ctx.record("storm.queue.escalated.declared", escalatedSurvivor.declaredSeverity);

        // PERMUTATION INVARIANCE: the reversed storm dedupes to the same survivor set.
        const reversed = dedupeFindingStorm([...VALID_STORM].reverse());
        const forward = dedupeFindingStorm(VALID_STORM);
        ctx.record(
          "storm.permutationInvariant",
          JSON.stringify(reversed.survivors.map((f) => f.findingId)) === JSON.stringify(forward.survivors.map((f) => f.findingId)),
        );
        ctx.record("storm.reversedSurvivorCount", reversed.survivors.length);

        // Correlation groups are stable under insert order too (sorted by key).
        const groupsReversed = correlateFindingStorm(reversed.survivors, { correlationWindowMs: WINDOW_MS });
        const groupsForward = correlateFindingStorm(forward.survivors, { correlationWindowMs: WINDOW_MS });
        ctx.record(
          "storm.groupsOrderStable",
          JSON.stringify(groupsReversed.map((g) => g.correlationKey)) === JSON.stringify(groupsForward.map((g) => g.correlationKey)),
        );
      },
    },
    {
      stepId: "bounded-triage",
      kind: "negative-check",
      description: "Over-bound queues refuse with exact counts; empty queues refuse; cross-tenant findings refuse naming the offender",
      packages: ["@fleetos/security"],
      operations: ["buildStormTriageQueue", "dedupeFindingStorm"],
      run: (ctx) => {
        const survivors = dedupeFindingStorm(VALID_STORM).survivors;

        // HONEST OVERFLOW: a bound of 3 over 4 survivors REFUSES with exact counts.
        const overflow = buildStormTriageQueue(survivors, { tenantId: TENANT.tenantId, limit: 3 });
        ctx.record("bound.overflowOk", overflow.ok);
        if (!overflow.ok && overflow.refused === "triage.queue-overflow") {
          ctx.record("bound.overflowRefusal", overflow.refused);
          ctx.record("bound.overflowReceived", overflow.received);
          ctx.record("bound.overflowLimit", overflow.limit);
        } else {
          throw new Error(`expected queue-overflow refusal, got ${JSON.stringify(overflow)}`);
        }

        // EMPTY QUEUE refuses honestly.
        const empty = buildStormTriageQueue([], { tenantId: TENANT.tenantId, limit: LIMIT });
        ctx.record("bound.emptyOk", empty.ok);
        ctx.record("bound.emptyRefusal", empty.ok ? "unexpected-allow" : empty.refused);

        // CROSS-TENANT finding refuses naming the offender (A8 fail-closed).
        const foreign = dedupeFindingStorm([
          candidate({ tenantId: FOREIGN_TENANT.tenantId, detectedAt: BASE_MS + 1_000, description: "rival tenant finding" }),
        ]).survivors;
        const mixed = buildStormTriageQueue([...survivors, ...foreign], { tenantId: TENANT.tenantId, limit: LIMIT });
        ctx.record("bound.crossTenantOk", mixed.ok);
        if (!mixed.ok && mixed.refused === "storm.tenant-mismatch") {
          ctx.record("bound.crossTenantRefusal", mixed.refused);
          ctx.record("bound.crossTenantOffenderTenant", mixed.offenderTenantId);
        } else {
          throw new Error(`expected storm.tenant-mismatch, got ${JSON.stringify(mixed)}`);
        }

        // An empty tenant scope also refuses (the guard's degenerate arm).
        const noTenant = buildStormTriageQueue(survivors, { tenantId: "", limit: LIMIT });
        ctx.record("bound.noTenantOk", noTenant.ok);
        ctx.record("bound.noTenantRefusal", noTenant.ok ? "unexpected-allow" : noTenant.refused);

        // At the exact bound the queue still admits (4 survivors, limit 4).
        const atBound = buildStormTriageQueue(survivors, { tenantId: TENANT.tenantId, limit: 4 });
        ctx.record("bound.atLimitOk", atBound.ok);
        ctx.record("bound.atLimitDepth", atBound.ok ? atBound.depth : -1);
      },
    },
  ],
  assertions: [
    { assertionId: "fs-1", description: "7 candidates received by the storm", path: "storm.received", expected: 7 },
    { assertionId: "fs-2", description: "1 invalid candidate (empty tenant) refused at validate", path: "storm.invalid", expected: 1 },
    { assertionId: "fs-3", description: "2 exact duplicates deduped", path: "storm.duplicates", expected: 2 },
    { assertionId: "fs-4", description: "4 survivors admitted", path: "storm.survived", expected: 4 },
    { assertionId: "fs-5", description: "4 distinct fingerprint classes", path: "storm.distinctClasses", expected: 4 },
    { assertionId: "fs-6", description: "Survivor set is the canonical four reports", path: "storm.survivorDescriptions", expected: ["indicator trip one", "indicator trip two", "indicator trip three", "unrelated low report"] },
    { assertionId: "fs-7", description: "Correlation key is tenant|kind|assets", path: "storm.group.key", expected: "acme-ops|device.compromised_indicator|pump-7" },
    { assertionId: "fs-8", description: "Three occurrences within the window", path: "storm.group.occurrences", expected: 3 },
    { assertionId: "fs-9", description: "Repeat pressure escalates medium to high", path: "storm.group.escalatedTo", expected: "high" },
    { assertionId: "fs-10", description: "Group peak severity carries the escalation", path: "storm.group.peakSeverity", expected: "high" },
    { assertionId: "fs-11", description: "Group first detection carried", path: "storm.group.firstDetectedAt", expected: 1791830401000 },
    { assertionId: "fs-12", description: "Group last detection carried", path: "storm.group.lastDetectedAt", expected: 1791830420000 },
    { assertionId: "fs-13", description: "Two correlation groups (escalating + unrelated low)", path: "storm.groupCount", expected: 2 },
    { assertionId: "fs-14", description: "Triage queue holds all 4 survivors", path: "storm.queue.depth", expected: 4 },
    { assertionId: "fs-15", description: "Highest severity triaged first", path: "storm.queue.first.description", expected: "indicator trip one" },
    { assertionId: "fs-16", description: "Escalated survivor enters the queue at high", path: "storm.queue.escalated.severity", expected: "high" },
    { assertionId: "fs-17", description: "Escalation flag machine-carried", path: "storm.queue.escalated.escalated", expected: true },
    { assertionId: "fs-18", description: "Declared severity preserved for audit honesty", path: "storm.queue.escalated.declared", expected: "medium" },
    { assertionId: "fs-19", description: "Survivor set invariant under arrival permutation", path: "storm.permutationInvariant", expected: true },
    { assertionId: "fs-20", description: "Reversed storm dedupes to the same count", path: "storm.reversedSurvivorCount", expected: 4 },
    { assertionId: "fs-21", description: "Correlation groups stable under insert order", path: "storm.groupsOrderStable", expected: true },
    { assertionId: "fs-22", description: "Over-bound queue REFUSES (honest overflow)", path: "bound.overflowOk", expected: false },
    { assertionId: "fs-23", description: "Overflow refusal code", path: "bound.overflowRefusal", expected: "triage.queue-overflow" },
    { assertionId: "fs-24", description: "Overflow names the exact received count", path: "bound.overflowReceived", expected: 4 },
    { assertionId: "fs-25", description: "Overflow names the exact limit", path: "bound.overflowLimit", expected: 3 },
    { assertionId: "fs-26", description: "Empty queue refuses", path: "bound.emptyOk", expected: false },
    { assertionId: "fs-27", description: "Empty queue refusal code", path: "bound.emptyRefusal", expected: "triage.empty-queue" },
    { assertionId: "fs-28", description: "Cross-tenant finding refuses the queue (A8)", path: "bound.crossTenantOk", expected: false },
    { assertionId: "fs-29", description: "Cross-tenant refusal code", path: "bound.crossTenantRefusal", expected: "storm.tenant-mismatch" },
    { assertionId: "fs-30", description: "The offender's tenant is named", path: "bound.crossTenantOffenderTenant", expected: "globex-rival" },
    { assertionId: "fs-31", description: "An empty tenant scope refuses", path: "bound.noTenantOk", expected: false },
    { assertionId: "fs-32", description: "Empty-tenant-scope refusal code", path: "bound.noTenantRefusal", expected: "storm.tenant-mismatch" },
    { assertionId: "fs-33", description: "At the exact bound the queue admits", path: "bound.atLimitOk", expected: true },
    { assertionId: "fs-34", description: "At-bound depth equals the survivor count", path: "bound.atLimitDepth", expected: 4 },
  ],
};
