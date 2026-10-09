/**
 * @fleetos/acceptance-field — the device/field journey corpus
 * (Wave 7 lane A + F300A host-integration extension, Wave 10 lane A).
 *
 * 20 journeys across the fixed 7-persona vocabulary, one per acceptance
 * capability of the device/field lane (14 original + 6 genuinely distinct
 * host-integration journeys added by F300A). Journeys are pure DATA
 * (typed operations + declarative assertions); the runner executes them
 * against the REAL public APIs of this lane's packages.
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
};
