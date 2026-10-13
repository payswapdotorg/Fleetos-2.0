/**
 * @fleetos/acceptance-field — the device/field journey corpus
 * (Wave 7 lane A + F300A host-integration extension, Wave 10 lane A +
 * F321A edge/asset governance extension, Wave 12 lane A; F331A Wave 13
 * lane A — the edge firmware/OTA campaign journey + the D8 census-certified
 * epoch parameterizations, see epoch-schedule.ts).
 *
 * 35 journeys across the fixed 7-persona vocabulary (14 original + 6
 * genuinely distinct host-integration journeys added by F300A + 10 genuinely
 * distinct F321A journeys + 1 F331A edge firmware/OTA campaign journey + 3
 * F341A field remainder journeys + 1 TL-adjudicated F341A D17 sixth-slot
 * journey). Journeys are pure DATA (typed operations + declarative
 * assertions); the runner executes them against the REAL public APIs of
 * this lane's packages.
 *
 * ORDER MATTERS: `handoff-field-to-operator-consume` declares
 * `consumesHandoff` — the corpus runner threads the publishing journey's
 * context forward into it (the cross-role chain).
 */

import type { AcceptanceJourney } from "../journey-contracts.js";
import { enrollNewAssetJourney, trustworthyStateJourney } from "./enrollment.js";
import { investigateFaultJourney, maintainAssetJourney, recoverDeviceJourney } from "./care.js";
import { connectivityPostureJourney, edgeCommandJourney, fieldModeOfflineJourney } from "./field.js";
import {
  handoffConsumeJourney,
  handoffPublishJourney,
  missionReplayJourney,
  mobileFieldShapeJourney,
  simulationDrivenJourney,
  tenantIsolationJourney,
} from "./cross.js";
import { hostDiscoveryDevice360Journey, hostHealthEvidenceTimelineJourney } from "./host-surface.js";
import {
  hostMaintenanceIntentToVerificationJourney,
  hostRecoveryIntentToVerificationJourney,
} from "./host-intents.js";
import {
  hostFieldWorkflowMobileOfflineJourney,
  hostRoleLensTenantFailClosedJourney,
} from "./host-edges.js";
import {
  ingestionLimitsAdmissionDisciplineJourney,
  offlineBufferCaptureReplayJourney,
  storeAndForwardRedeliveryJourney,
} from "./f321a-ingestion.js";
import {
  anomalyConfidenceTriageJourney,
  diagnosisLifecycleJourney,
  evidenceGatedRecoveryJourney,
  maintenanceCalendarScaleJourney,
} from "./f321a-operations.js";
import {
  assetLineageMaterialLotsJourney,
  identitySessionLifecycleJourney,
  tenantLifecycleGatingJourney,
} from "./f321a-governance.js";
import { edgeFirmwareOtaCampaignJourney } from "./f331a-ota.js";
import {
  observationsBackpressureDisciplineJourney,
  observationsRetentionProjectionsJourney,
  simWorldsCheckpointDeterminismJourney,
  observationsKernelImmutabilityAuditJourney,
} from "./f341a-field-remainder.js";

export const FIELD_JOURNEYS: readonly AcceptanceJourney[] = [
  enrollNewAssetJourney,
  trustworthyStateJourney,
  investigateFaultJourney,
  recoverDeviceJourney,
  maintainAssetJourney,
  fieldModeOfflineJourney,
  connectivityPostureJourney,
  edgeCommandJourney,
  simulationDrivenJourney,
  missionReplayJourney,
  handoffPublishJourney,
  handoffConsumeJourney,
  mobileFieldShapeJourney,
  tenantIsolationJourney,
  hostDiscoveryDevice360Journey,
  hostHealthEvidenceTimelineJourney,
  hostRecoveryIntentToVerificationJourney,
  hostMaintenanceIntentToVerificationJourney,
  hostFieldWorkflowMobileOfflineJourney,
  hostRoleLensTenantFailClosedJourney,
  // F321A (Wave 12 lane A) — the ten new journeys in declared order.
  storeAndForwardRedeliveryJourney,
  offlineBufferCaptureReplayJourney,
  ingestionLimitsAdmissionDisciplineJourney,
  diagnosisLifecycleJourney,
  anomalyConfidenceTriageJourney,
  evidenceGatedRecoveryJourney,
  maintenanceCalendarScaleJourney,
  assetLineageMaterialLotsJourney,
  identitySessionLifecycleJourney,
  tenantLifecycleGatingJourney,
  // F331A (Wave 13 lane A) — the edge firmware/OTA campaign journey
  // (work-item row 39; the REAL @fleetos/maintenance firmware-campaign
  // module). No epochs declared (the F330 census's D8 set is closed).
  edgeFirmwareOtaCampaignJourney,
  // F341A (Wave 14 lane A) — the three field remainder journeys (the F340
  // §1 census candidates: observations backpressure discipline, retention
  // + projections, sim-worlds checkpoint determinism) + the TL-adjudicated
  // D17 sixth slot (the observations kernel immutability-audit family).
  // No epochs declared (queueing/storage/determinism mechanics are
  // single-epoch by D14's default; the F330 census set is closed).
  observationsBackpressureDisciplineJourney,
  observationsRetentionProjectionsJourney,
  simWorldsCheckpointDeterminismJourney,
  observationsKernelImmutabilityAuditJourney,
];

export {
  enrollNewAssetJourney,
  trustworthyStateJourney,
  investigateFaultJourney,
  recoverDeviceJourney,
  maintainAssetJourney,
  fieldModeOfflineJourney,
  connectivityPostureJourney,
  edgeCommandJourney,
  simulationDrivenJourney,
  missionReplayJourney,
  handoffPublishJourney,
  handoffConsumeJourney,
  mobileFieldShapeJourney,
  tenantIsolationJourney,
  hostDiscoveryDevice360Journey,
  hostHealthEvidenceTimelineJourney,
  hostRecoveryIntentToVerificationJourney,
  hostMaintenanceIntentToVerificationJourney,
  hostFieldWorkflowMobileOfflineJourney,
  hostRoleLensTenantFailClosedJourney,
  storeAndForwardRedeliveryJourney,
  offlineBufferCaptureReplayJourney,
  ingestionLimitsAdmissionDisciplineJourney,
  diagnosisLifecycleJourney,
  anomalyConfidenceTriageJourney,
  evidenceGatedRecoveryJourney,
  maintenanceCalendarScaleJourney,
  assetLineageMaterialLotsJourney,
  identitySessionLifecycleJourney,
  tenantLifecycleGatingJourney,
  edgeFirmwareOtaCampaignJourney,
  observationsBackpressureDisciplineJourney,
  observationsRetentionProjectionsJourney,
  simWorldsCheckpointDeterminismJourney,
  observationsKernelImmutabilityAuditJourney,
};
