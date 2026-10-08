/**
 * @fleetos/acceptance-field — the device/field journey corpus (Wave 7 lane A).
 *
 * 14 journeys across the fixed 7-persona vocabulary, one per acceptance
 * capability of the device/field lane. Journeys are pure DATA (typed
 * operations + declarative assertions); the runner executes them against
 * the REAL public APIs of this lane's packages.
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
};
