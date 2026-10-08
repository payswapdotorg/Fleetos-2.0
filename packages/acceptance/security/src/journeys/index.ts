/**
 * @fleetos/acceptance-security — the journey corpus (F270B).
 *
 * 13 journeys over the REAL lane packages, one per acceptance capability of
 * the F270B deliverable list plus the tenant-isolation cross-cut. Every
 * journey is DATA + declarative assertions executed by the runner.
 */

import type { AcceptanceJourney } from "../journey-contracts.ts";
import { investigateFindingJourney } from "./investigate-finding.ts";
import { understandEvidenceJourney } from "./understand-evidence.ts";
import { guardianDecisionJourney } from "./guardian-decision.ts";
import { actionPlanJourney } from "./action-plan.ts";
import { executionLedgerJourney } from "./execution-ledger.ts";
import { reasoningJourney } from "./reasoning.ts";
import { predictiveAdviceJourney } from "./predictive-advice.ts";
import { counterfactualJourney } from "./counterfactual.ts";
import { inspectWhyJourney } from "./inspect-why.ts";
import { learningJourney } from "./learning.ts";
import { benchmarkTrustJourney } from "./benchmark-trust.ts";
import { agentSafetyJourney } from "./agent-safety.ts";
import { tenancyFailClosedJourney } from "./tenancy-fail-closed.ts";

/** The full security/action/intelligence acceptance corpus, in declared order. */
export const SECURITY_JOURNEYS: readonly AcceptanceJourney[] = [
  investigateFindingJourney,
  understandEvidenceJourney,
  guardianDecisionJourney,
  actionPlanJourney,
  executionLedgerJourney,
  reasoningJourney,
  predictiveAdviceJourney,
  counterfactualJourney,
  inspectWhyJourney,
  learningJourney,
  benchmarkTrustJourney,
  agentSafetyJourney,
  tenancyFailClosedJourney,
];

export {
  investigateFindingJourney,
  understandEvidenceJourney,
  guardianDecisionJourney,
  actionPlanJourney,
  executionLedgerJourney,
  reasoningJourney,
  predictiveAdviceJourney,
  counterfactualJourney,
  inspectWhyJourney,
  learningJourney,
  benchmarkTrustJourney,
  agentSafetyJourney,
  tenancyFailClosedJourney,
};
