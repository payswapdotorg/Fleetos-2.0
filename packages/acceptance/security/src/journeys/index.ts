/**
 * @fleetos/acceptance/security — the journey corpus (F270B + F300B + F321B
 * + F341B + F361B).
 *
 * 36 journeys over the REAL lane packages: the 13 F270B journeys (one per
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
 * CONTRACT_ONLY / provider-not-ready), plus the 2 F341B remainder
 * journeys (Wave 14 lane B: the evidence artifact-store completeness and
 * the world-context windowing families per the F340 census — both
 * single-epoch invariant; the artifact-store family is driven at module
 * evaluation via top-level await, its documented async-API law), plus the
 * 2 F361B extensions (Wave 17 lane B: the F360 freeze §3.6 marketplace
 * trust controls — the Guardian approval discipline and the evidence
 * dedup discipline; both census-invariant, the evidence family driven at
 * module evaluation via top-level await per the F341B async-API law),
 * plus the 5 F370A extensions (Wave 18 lane A: the authenticated
 * marketplace family — credential verification, signed sessions, and the
 * gated request/offer/order, receipt/enrollment and Guardian-approval
 * compositions over the REAL Wave-17 public APIs; all census-invariant,
 * fixed logical fixtures, never the run anchor).
 * Every journey is DATA + declarative assertions executed by the runner.
 * Identical reruns never count — each journey drives genuinely distinct
 * REAL surfaces.
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
// ---- F341B extensions (Wave 14 lane B; the F340 census remainders) ----
import { artifactStoreCompletenessJourney } from "./artifact-store-completeness.ts";
import { worldContextWindowingJourney } from "./world-windowing.ts";
// ---- F361B extensions (Wave 17 lane B; the F360 freeze §3.6 marketplace trust controls) ----
import { marketplaceOrderApprovalJourney } from "./marketplace-order-approval.ts";
import { marketplaceEvidenceDedupJourney } from "./marketplace-evidence-dedup.ts";
// ---- F370A extensions (Wave 18 lane A; real authentication + server-side tenant authorization) ----
import { authenticatedMarketplaceCredentialsJourney } from "./f370a-credentials.ts";
import { authenticatedMarketplaceSessionsJourney } from "./f370a-sessions.ts";
import { authenticatedMarketplaceRequestOrderJourney } from "./f370a-request-order.ts";
import { authenticatedMarketplaceReceiptEnrollmentJourney } from "./f370a-receipt-enrollment.ts";
import { authenticatedMarketplaceApprovalJourney } from "./f370a-approval.ts";

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
  // ---- F341B extensions (Wave 14 lane B; the F340 census remainders) ----
  artifactStoreCompletenessJourney,
  worldContextWindowingJourney,
  // ---- F361B extensions (Wave 17 lane B; the F360 freeze §3.6) ----
  marketplaceOrderApprovalJourney,
  marketplaceEvidenceDedupJourney,
  // ---- F370A extensions (Wave 18 lane A: real authentication + server-side tenant authorization) ----
  authenticatedMarketplaceCredentialsJourney,
  authenticatedMarketplaceSessionsJourney,
  authenticatedMarketplaceRequestOrderJourney,
  authenticatedMarketplaceReceiptEnrollmentJourney,
  authenticatedMarketplaceApprovalJourney,
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
  artifactStoreCompletenessJourney,
  worldContextWindowingJourney,
  marketplaceOrderApprovalJourney,
  marketplaceEvidenceDedupJourney,
  authenticatedMarketplaceCredentialsJourney,
  authenticatedMarketplaceSessionsJourney,
  authenticatedMarketplaceRequestOrderJourney,
  authenticatedMarketplaceReceiptEnrollmentJourney,
  authenticatedMarketplaceApprovalJourney,
};
