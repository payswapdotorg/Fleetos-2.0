/**
 * Journey 1 — investigate a finding (persona: security-analyst).
 *
 * A real analyst intakes detector candidates through the REAL security
 * pipeline (validate -> dedupe -> correlate -> triage) and opens the REAL
 * findings intake view (@fleetos/experience-safety-intel):
 *   - an empty-tenant candidate is REFUSED at validation (A8);
 *   - an exact duplicate is REFUSED at dedupe;
 *   - a medium finding repeated 3x within the window ESCALATES to high;
 *   - the intake view shows it with severity + correlation + occurrences.
 */

import type { AcceptanceJourney } from "../journey-contracts.ts";
import { runFindingIntake } from "@fleetos/security";
import type { FindingIntakeCandidate } from "@fleetos/security";
import { buildFindingViews } from "@fleetos/experience-safety-intel";
import { BASE_MS, TENANT, findingRecord } from "./fixture-world.ts";

const WINDOW_MS = 120_000;

function candidate(input: {
  readonly tenantId: string;
  readonly detectedAt: number;
  readonly description: string;
  readonly declaredSeverity?: string;
  readonly signalCount?: number;
}): FindingIntakeCandidate {
  return {
    tenantId: input.tenantId,
    kind: "device.compromised_indicator",
    declaredSeverity: input.declaredSeverity ?? "medium",
    confidence: "confirmed",
    detectedAt: input.detectedAt,
    assetIds: ["pump-7"],
    description: input.description,
    evidenceRefs: ["ev-intake-1"],
    signalCount: input.signalCount ?? 3,
  };
}

export const investigateFindingJourney: AcceptanceJourney = {
  journeyId: "security.investigate-finding",
  persona: "security-analyst",
  capabilities: ["investigate-findings"],
  goal: "Intake a finding through the real pipeline and see it in the findings view",
  steps: [
    {
      stepId: "intake-batch",
      kind: "intake",
      description: "Run the real intake pipeline over 6 candidates (1 refused, 1 duplicate, 4 admitted with one escalating)",
      packages: ["@fleetos/security"],
      operations: ["runFindingIntake"],
      run: (ctx) => {
        const result = runFindingIntake(
          [
            candidate({ tenantId: "", detectedAt: BASE_MS, description: "no tenant" }),
            candidate({ tenantId: TENANT.tenantId, detectedAt: BASE_MS + 1_000, description: "first report" }),
            candidate({ tenantId: TENANT.tenantId, detectedAt: BASE_MS + 10_000, description: "repeat report" }),
            candidate({ tenantId: TENANT.tenantId, detectedAt: BASE_MS + 20_000, description: "repeat report again" }),
            candidate({ tenantId: TENANT.tenantId, detectedAt: BASE_MS + 1_000, description: "first report" }),
            candidate({
              tenantId: TENANT.tenantId,
              detectedAt: BASE_MS + 30_000,
              description: "unrelated low finding",
              declaredSeverity: "low",
            }),
          ],
          { correlationWindowMs: WINDOW_MS },
        );
        const escalated = result.admitted.find((f) => f.description === "repeat report again");
        if (escalated === undefined) throw new Error("escalated finding not admitted");
        ctx.record("intake.received", result.metrics.received);
        ctx.record("intake.admitted", result.metrics.admitted);
        ctx.record("intake.acks0.refusedAt", result.acks[0]?.refusedAt ?? "missing");
        ctx.record("intake.acks0.reason", result.acks[0]?.reason ?? "missing");
        ctx.record("intake.acks4.refusedAt", result.acks[4]?.refusedAt ?? "missing");
        ctx.record("intake.acks4.reason", result.acks[4]?.reason ?? "missing");
        ctx.record("intake.escalated.severity", escalated.severity);
        ctx.record("intake.escalated.escalated", escalated.escalated);
        ctx.record("intake.escalated.occurrences", escalated.occurrences);
        ctx.record("intake.escalated.correlationKey", escalated.correlationKey);
        ctx.record("intake.escalated.declaredSeverity", escalated.declaredSeverity);
      },
    },
    {
      stepId: "findings-view",
      kind: "view-read",
      description: "Build the REAL findings intake view over the admitted findings",
      packages: ["@fleetos/experience-safety-intel"],
      operations: ["buildFindingViews"],
      run: (ctx) => {
        const result = runFindingIntake(
          [
            candidate({ tenantId: TENANT.tenantId, detectedAt: BASE_MS + 1_000, description: "first report" }),
            candidate({ tenantId: TENANT.tenantId, detectedAt: BASE_MS + 10_000, description: "repeat report" }),
            candidate({ tenantId: TENANT.tenantId, detectedAt: BASE_MS + 20_000, description: "repeat report again" }),
            candidate({
              tenantId: TENANT.tenantId,
              detectedAt: BASE_MS + 30_000,
              description: "unrelated low finding",
              declaredSeverity: "low",
            }),
          ],
          { correlationWindowMs: WINDOW_MS },
        );
        const view = buildFindingViews({
          tenantId: TENANT.tenantId,
          findings: result.admitted.map(findingRecord),
          remediations: [],
        });
        if (!view.ok) throw new Error(`findings view refused: ${view.refused} (${view.detail})`);
        ctx.record("view.rollup.totalFindings", view.views.rollup.totalFindings);
        ctx.record("view.rollup.bySeverity.high", view.views.rollup.bySeverity.high);
        ctx.record("view.rollup.bySeverity.low", view.views.rollup.bySeverity.low);
        ctx.record("view.triageQueue.itemCount", view.views.triageQueue.items.length);
        const first = view.views.triageQueue.items[0];
        if (first === undefined) throw new Error("triage queue is empty");
        ctx.record("view.triageQueue.first.severity", first.severity);
        ctx.record("view.triageQueue.first.queueRank", first.queueRank);
        ctx.record("view.triageQueue.first.assetCount", first.assetCount);
        ctx.record("view.digest.length", view.views.rollup.digest.length);
      },
    },
  ],
  assertions: [
    { assertionId: "inv-1", description: "6 candidates received", path: "intake.received", expected: 6 },
    { assertionId: "inv-2", description: "4 admitted (1 validate-refused, 1 dedupe-refused)", path: "intake.admitted", expected: 4 },
    { assertionId: "inv-3", description: "Empty-tenant candidate refused at validate", path: "intake.acks0.refusedAt", expected: "validate" },
    { assertionId: "inv-4", description: "Empty-tenant refusal reason is A8 fail-closed", path: "intake.acks0.reason", expected: "validate.missing-tenant" },
    { assertionId: "inv-5", description: "Exact duplicate refused at dedupe", path: "intake.acks4.refusedAt", expected: "dedupe" },
    { assertionId: "inv-6", description: "Duplicate refusal reason", path: "intake.acks4.reason", expected: "dedupe.duplicate-finding" },
    { assertionId: "inv-7", description: "Medium repeated 3x escalates to high", path: "intake.escalated.severity", expected: "high" },
    { assertionId: "inv-8", description: "Escalation flag set", path: "intake.escalated.escalated", expected: true },
    { assertionId: "inv-9", description: "Occurrences within the window counted", path: "intake.escalated.occurrences", expected: 3 },
    { assertionId: "inv-10", description: "Correlation key is tenant|kind|assets", path: "intake.escalated.correlationKey", expected: "acme-ops|device.compromised_indicator|pump-7" },
    { assertionId: "inv-11", description: "Declared severity preserved for audit honesty", path: "intake.escalated.declaredSeverity", expected: "medium" },
    { assertionId: "inv-12", description: "View shows all admitted findings", path: "view.rollup.totalFindings", expected: 4 },
    { assertionId: "inv-13", description: "Rollup counts one high (the escalated one)", path: "view.rollup.bySeverity.high", expected: 1 },
    { assertionId: "inv-14", description: "Rollup counts one low", path: "view.rollup.bySeverity.low", expected: 1 },
    { assertionId: "inv-15", description: "Triage queue holds every finding", path: "view.triageQueue.itemCount", expected: 4 },
    { assertionId: "inv-16", description: "Highest severity is triaged first", path: "view.triageQueue.first.severity", expected: "high" },
    { assertionId: "inv-17", description: "Queue ranks start at 1", path: "view.triageQueue.first.queueRank", expected: 1 },
    { assertionId: "inv-18", description: "Per-item asset counts surfaced", path: "view.triageQueue.first.assetCount", expected: 1 },
    { assertionId: "inv-19", description: "View carries an FNV-1a digest (8 hex)", path: "view.digest.length", expected: 8 },
  ],
};
