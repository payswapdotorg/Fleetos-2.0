/**
 * @fleetos/acceptance-field — the F321A journey-contract extension
 * (Wave 12 lane A).
 *
 * The typed domain operations for the ten F321A journeys (F310C §3.3 rows
 * 14-23, row 21 substituted per the provider-boundary law). Held in SEPARATE
 * contracts files to respect the ≤400-line file law over the contracts
 * surface (the F310C commerce split-file precedent), one per F321A journey
 * family — mirroring the ops-executor split:
 *
 *   - journey-contracts-f321a-edge.ts        (slots 14, 15, 21-substitute)
 *   - journey-contracts-f321a-care.ts        (slots 16, 17, 18, 19)
 *   - journey-contracts-f321a-asset-core.ts  (slots 20, 22, 23)
 *
 * This module is the single aggregation point: the core union re-exports the
 * combined `F321AOperation` through `JourneyOperation` (journey-contracts.ts),
 * so journeys stay pure DATA against one closed vocabulary; the runner
 * executes them against the REAL public APIs of this lane's packages
 * (@fleetos/observations, @fleetos/connectivity, @fleetos/health,
 * @fleetos/recovery, @fleetos/maintenance, @fleetos/assets, @fleetos/identity,
 * @fleetos/tenancy).
 *
 * Pure deterministic TS; logical `now` everywhere.
 */

import type { OfflineOverflowPolicy } from "@fleetos/connectivity";
import type { F321AEdgeOperation } from "./journey-contracts-f321a-edge.js";
import type { F321ACareOperation } from "./journey-contracts-f321a-care.js";
import type { F321AAssetCoreOperation } from "./journey-contracts-f321a-asset-core.js";

/** The closed F321A operation union (all ten journeys' typed operations). */
export type F321AOperation = F321AEdgeOperation | F321ACareOperation | F321AAssetCoreOperation;

// Family sub-unions and op interfaces stay importable from one place.
export type {
  F321AEdgeOperation,
  StoreForwardSignOp,
  StoreForwardReceiveOp,
  StoreForwardReceiveForgedOp,
  StoreForwardReceiveTamperedOp,
  StoreForwardSequenceReportOp,
  OfflineOpenBufferOp,
  OfflineCaptureOp,
  OfflineStampPostureOp,
  OfflineReplayOp,
  OfflineSweepOp,
  LimitsOpenBufferOp,
  LimitsBufferOp,
  LimitsAdmissionCapOp,
  LimitsCheckAdmissionOp,
  LimitsBatchOp,
} from "./journey-contracts-f321a-edge.js";
export type {
  F321ACareOperation,
  DiagnosisProposeOp,
  DiagnosisCommandOp,
  DiagnosisSupersedeOp,
  AnomalyWindowOp,
  AnomalyRunOp,
  AnomalyEvaluateOp,
  AnomalyPropagateOp,
  RecoveryCommandGatedOp,
  RecoveryPostmortemOp,
  RecoveryPaginateOp,
  RecoveryPaginateTenantOp,
  CalendarWindowSpec,
  CalendarBuildOp,
  CalendarConflictOp,
  CalendarNextFreeOp,
  CalendarBatchOp,
} from "./journey-contracts-f321a-care.js";
export type {
  F321AAssetCoreOperation,
  LineageDeclareOp,
  LineageMaterialCreateOp,
  LineageMaterialConsumeOp,
  LineageEdgeSpec,
  LineageAppendEdgeOp,
  LineageAncestryOp,
  LineageVerifyChainOp,
  IdentityIssueSessionOp,
  IdentitySessionCommandOp,
  IdentityValidateSessionOp,
  IdentitySweepSessionsOp,
  IdentityBindRoleOp,
  TenancyProvisionOp,
  TenancyTransitionOp,
  TenancyEstablishOp,
  TenancyEvaluateOperationOp,
} from "./journey-contracts-f321a-asset-core.js";

// Re-export the overflow policy type so executor consumers need one import.
export type { OfflineOverflowPolicy };
