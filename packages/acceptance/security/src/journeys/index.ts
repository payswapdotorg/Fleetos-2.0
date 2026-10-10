/**
 * @fleetos/acceptance/security — the journey corpus (F270B + F300B + F321B).
 *
 * 27 journeys over the REAL lane packages: the 13 F270B journeys (one per
 * acceptance capability of the F270B deliverable list plus the tenant-
 * isolation cross-cut), the 4 F300B extensions (the Guardian journey
 * end-to-end, mission replay on real package outputs, predictive honesty
 * incl. the JEPA structural-analogue labeling, and the HostSurface
 * integration) and the 10 F321B extensions (Wave 12 lane B: the F310C
 * §3.4 map — tamper-evident audit ledger, finding-storm triage,
 * suppression lifecycle, verified dispatch, compensation/rollback,
 * capability-store DR, outcome-evaluation adoption, JEPA-family honesty,
 * degradation/staleness honesty — plus the tenth-slot posture-fold
 * determinism journey; arena-evaluation-runs EXCLUDED, Arena is
 * CONTRACT_ONLY / provider-not-ready). Every journey is DATA + declarative
 * assertions executed by the runner. Identical reruns never count — each
 * F321B journey drives genuinely distinct REAL surfaces.
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
import { guardianE2eJourney } from "./guardian-e2e.ts";
import { missionReplayJourney } from "./mission-replay.ts";
import { predictiveHonestyJourney } from "./predictive-honesty.ts";
import { hostSurfaceJourney } from "./host-surface.ts";
// ---- F321B extensions (Wave 12 lane B) ----
import { auditLedgerJourney } from "./audit-ledger-journey.ts";
import { findingStormJourney } from "./finding-storm.ts";
import { suppressionLifecycleJourney } from "./suppression-lifecycle.ts";
import { verifiedDispatchJourney } from "./verified-dispatch.ts";
import { compensationRollbackJourney } from "./compensation-rollback.ts";
import { capabilityDrJourney } from "./capability-dr.ts";
import { evaluationAdoptionJourney } from "./evaluation-adoption.ts";
import { jepaFamilyJourney } from "./jepa-family.ts";
import { degradationStalenessJourney } from "./degradation-staleness.ts";
import { postureFoldJourney } from "./posture-fold.ts";

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
  // ---- F300B extensions (Wave 10 lane B) ----
  guardianE2eJourney,
  missionReplayJourney,
  predictiveHonestyJourney,
  hostSurfaceJourney,
  // ---- F321B extensions (Wave 12 lane B; F310C §3.4 + tenth slot) ----
  auditLedgerJourney,
  findingStormJourney,
  suppressionLifecycleJourney,
  verifiedDispatchJourney,
  compensationRollbackJourney,
  capabilityDrJourney,
  evaluationAdoptionJourney,
  jepaFamilyJourney,
  degradationStalenessJourney,
  postureFoldJourney,
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
  guardianE2eJourney,
  missionReplayJourney,
  predictiveHonestyJourney,
  hostSurfaceJourney,
  auditLedgerJourney,
  findingStormJourney,
  suppressionLifecycleJourney,
  verifiedDispatchJourney,
  compensationRollbackJourney,
  capabilityDrJourney,
  evaluationAdoptionJourney,
  jepaFamilyJourney,
  degradationStalenessJourney,
  postureFoldJourney,
};
