/**
 * @fleetos/acceptance-field — F331A operation executors: the edge firmware /
 * OTA campaign family (Wave 13 lane A, row 39). Every executor drives a REAL
 * public API of @fleetos/maintenance's firmware-campaign module and records
 * readings from the REAL output (states, wave progress, refusals, journal
 * verification — never re-derived). All ops execute at the context's logical
 * clock; the actor is the lane's fixed edge service actor.
 */

import {
  announceFirmwareCampaign,
  campaignProgress,
  declareFirmwareCampaign,
  haltFirmwareCampaign,
  recordCampaignDeviceOutcome,
  recordCampaignDeviceRollback,
  resumeFirmwareCampaign,
  rollbackFirmwareCampaign,
  startCampaignWave,
  verifyFirmwareCampaignJournal,
  type FirmwareCampaign,
} from "@fleetos/maintenance";
import type { JourneyOperation } from "../journey-contracts.js";
export { F331A_OTA_OP_KINDS } from "../journey-contracts-f331a.js";
import type { JourneyContext } from "../context.js";
import { EDGE_ACTOR } from "../fixtures.js";
import { opOk, opRefused, type OpExecution } from "./common.js";

export function executeF331AOtaOperation(op: JourneyOperation, ctx: JourneyContext): OpExecution {
  switch (op.kind) {
    case "ota.declare-campaign": {
      const r = declareFirmwareCampaign({
        id: op.campaignId,
        tenantId: ctx.tenantId,
        firmwareId: op.firmwareId,
        fromVersion: op.fromVersion,
        toVersion: op.toVersion,
        declaredAt: ctx.clock,
        waves: op.waves,
      });
      if (!r.ok) return opRefused(r.reason, { "ota.refused": r.reason });
      ctx.firmwareCampaigns.set(op.campaignId, r.campaign);
      return opOk({
        "ota.campaignId": r.campaign.id,
        "ota.state": r.campaign.state,
        "ota.waves": r.campaign.waves.length,
        "ota.journalVerified": verifyFirmwareCampaignJournal(r.campaign.events),
      });
    }
    case "ota.announce": {
      const campaign = lookup(ctx, op.campaignId);
      if (!campaign) return opRefused("unknown-campaign", { "ota.refused": "unknown-campaign" });
      const r = announceFirmwareCampaign(campaign, { tenantId: ctx.tenantId, at: ctx.clock, actor: EDGE_ACTOR });
      if (!r.ok) return opRefused(r.reason, { "ota.refused": r.reason });
      ctx.firmwareCampaigns.set(op.campaignId, r.campaign);
      return opOk({ "ota.state": r.campaign.state });
    }
    case "ota.start-wave": {
      const campaign = lookup(ctx, op.campaignId);
      if (!campaign) return opRefused("unknown-campaign", { "ota.refused": "unknown-campaign" });
      const r = startCampaignWave(campaign, { tenantId: ctx.tenantId, waveId: op.waveId, at: ctx.clock, actor: EDGE_ACTOR });
      if (!r.ok) return opRefused(r.reason, { "ota.refused": r.reason });
      ctx.firmwareCampaigns.set(op.campaignId, r.campaign);
      return opOk({ "ota.state": r.campaign.state, "ota.currentWaveId": campaignProgress(r.campaign).currentWaveId });
    }
    case "ota.device-outcome": {
      const campaign = lookup(ctx, op.campaignId);
      if (!campaign) return opRefused("unknown-campaign", { "ota.refused": "unknown-campaign" });
      const r = recordCampaignDeviceOutcome(campaign, {
        tenantId: ctx.tenantId,
        deviceId: op.deviceId,
        ok: op.ok,
        at: ctx.clock,
        actor: EDGE_ACTOR,
        ...(op.failureReason !== undefined ? { failureReason: op.failureReason } : {}),
      });
      if (!r.ok) return opRefused(r.reason, { "ota.refused": r.reason });
      ctx.firmwareCampaigns.set(op.campaignId, r.campaign);
      const progress = campaignProgress(r.campaign);
      return opOk({
        "ota.state": r.campaign.state,
        "ota.applied": progress.applied,
        "ota.failed": progress.failed,
        "ota.waveStates": progress.waves.map((w) => w.state),
        "ota.wavePending": progress.waves.map((w) => w.pending),
        "ota.currentWaveId": progress.currentWaveId,
      });
    }
    default:
      return executeOtaLifecycleOp(op, ctx);
  }
}

function executeOtaLifecycleOp(op: JourneyOperation, ctx: JourneyContext): OpExecution {
  switch (op.kind) {
    case "ota.halt": {
      const campaign = lookup(ctx, op.campaignId);
      if (!campaign) return opRefused("unknown-campaign", { "ota.refused": "unknown-campaign" });
      const r = haltFirmwareCampaign(campaign, {
        tenantId: ctx.tenantId,
        ...(op.reason !== undefined ? { reason: op.reason } : {}),
        at: ctx.clock,
        actor: EDGE_ACTOR,
      });
      if (!r.ok) return opRefused(r.reason, { "ota.refused": r.reason });
      ctx.firmwareCampaigns.set(op.campaignId, r.campaign);
      return opOk({ "ota.state": r.campaign.state, "ota.haltReason": r.campaign.halt?.reason ?? null });
    }
    case "ota.resume": {
      const campaign = lookup(ctx, op.campaignId);
      if (!campaign) return opRefused("unknown-campaign", { "ota.refused": "unknown-campaign" });
      const r = resumeFirmwareCampaign(campaign, { tenantId: ctx.tenantId, at: ctx.clock, actor: EDGE_ACTOR });
      if (!r.ok) return opRefused(r.reason, { "ota.refused": r.reason });
      ctx.firmwareCampaigns.set(op.campaignId, r.campaign);
      return opOk({ "ota.state": r.campaign.state });
    }
    case "ota.rollback": {
      const campaign = lookup(ctx, op.campaignId);
      if (!campaign) return opRefused("unknown-campaign", { "ota.refused": "unknown-campaign" });
      const r = rollbackFirmwareCampaign(campaign, {
        tenantId: ctx.tenantId,
        ...(op.reason !== undefined ? { reason: op.reason } : {}),
        at: ctx.clock,
        actor: EDGE_ACTOR,
      });
      if (!r.ok) return opRefused(r.reason, { "ota.refused": r.reason });
      ctx.firmwareCampaigns.set(op.campaignId, r.campaign);
      return opOk({ "ota.state": r.campaign.state, "ota.rollbackReason": r.campaign.rollback?.reason ?? null });
    }
    case "ota.device-rollback": {
      const campaign = lookup(ctx, op.campaignId);
      if (!campaign) return opRefused("unknown-campaign", { "ota.refused": "unknown-campaign" });
      const r = recordCampaignDeviceRollback(campaign, {
        tenantId: ctx.tenantId,
        deviceId: op.deviceId,
        at: ctx.clock,
        actor: EDGE_ACTOR,
      });
      if (!r.ok) return opRefused(r.reason, { "ota.refused": r.reason });
      ctx.firmwareCampaigns.set(op.campaignId, r.campaign);
      const progress = campaignProgress(r.campaign);
      return opOk({ "ota.state": r.campaign.state, "ota.rolledBack": progress.rolledBack });
    }
    case "ota.progress": {
      const campaign = lookup(ctx, op.campaignId);
      if (!campaign) return opRefused("unknown-campaign", { "ota.refused": "unknown-campaign" });
      const progress = campaignProgress(campaign);
      return opOk({
        "ota.state": progress.state,
        "ota.currentWaveId": progress.currentWaveId,
        "ota.applied": progress.applied,
        "ota.failed": progress.failed,
        "ota.rolledBack": progress.rolledBack,
        "ota.haltReason": progress.haltReason,
        "ota.rollbackReason": progress.rollbackReason,
        "ota.waveStates": progress.waves.map((w) => w.state),
        "ota.waveApplied": progress.waves.map((w) => w.applied),
        "ota.waveFailed": progress.waves.map((w) => w.failed),
        "ota.wavePending": progress.waves.map((w) => w.pending),
        "ota.waveIds": progress.waves.map((w) => w.waveId),
        "ota.journalVerified": verifyFirmwareCampaignJournal(campaign.events),
        "ota.progressDigest": progress.digest,
      });
    }
    default:
      return opRefused("unknown-operation");
  }
}

function lookup(ctx: JourneyContext, campaignId: string): FirmwareCampaign | undefined {
  return ctx.firmwareCampaigns.get(campaignId);
}
