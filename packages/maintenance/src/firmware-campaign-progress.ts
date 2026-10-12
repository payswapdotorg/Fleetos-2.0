/**
 * @fleetos/maintenance — F331A firmware campaign progress read model
 * (Wave 13 lane A). The deterministic per-wave campaign rollup over a
 * campaign record (targeted/applied/failed/pending + campaign totals +
 * digest). Pure; no clocks, no I/O (see firmware-campaign.ts).
 */

import type { FirmwareCampaign, FirmwareCampaignState, FirmwareWaveState } from "./firmware-campaign.js";

function fnv1a32(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export interface FirmwareWaveProgress {
  readonly waveId: string;
  readonly state: FirmwareWaveState;
  readonly targeted: number;
  readonly applied: number;
  readonly failed: number;
  readonly pending: number;
}

export interface FirmwareCampaignProgress {
  readonly campaignId: string;
  readonly state: FirmwareCampaignState;
  readonly fromVersion: string;
  readonly toVersion: string;
  readonly currentWaveId: string | null;
  readonly waves: readonly FirmwareWaveProgress[];
  readonly applied: number;
  readonly failed: number;
  readonly rolledBack: number;
  readonly haltReason: string | null;
  readonly rollbackReason: string | null;
  readonly digest: string;
}

export function campaignProgress(campaign: FirmwareCampaign): FirmwareCampaignProgress {
  const waves: FirmwareWaveProgress[] = campaign.waves.map((w) => {
    let applied = 0;
    let failed = 0;
    for (const deviceId of w.deviceIds) {
      const o = campaign.outcomes[deviceId];
      if (!o) continue;
      if (o.appliedAt !== null) applied += 1;
      else if (o.failedAt !== null) failed += 1;
    }
    return {
      waveId: w.waveId,
      state: w.state,
      targeted: w.deviceIds.length,
      applied,
      failed,
      pending: w.deviceIds.length - applied - failed,
    };
  });
  const allOutcomes = Object.values(campaign.outcomes);
  const digest = fnv1a32([
    campaign.id,
    campaign.tenantId,
    campaign.state,
    campaign.waves.map((w) => `${w.waveId}:${w.state}:${w.deviceIds.length}`).join(","),
    allOutcomes.length,
    allOutcomes.filter((o) => o.appliedAt !== null).length,
    allOutcomes.filter((o) => o.rolledBackAt !== null).length,
  ].join("\u001f"));
  return {
    campaignId: campaign.id,
    state: campaign.state,
    fromVersion: campaign.fromVersion,
    toVersion: campaign.toVersion,
    currentWaveId: campaign.waves.find((w) => w.state === "deploying")?.waveId ?? null,
    waves,
    applied: allOutcomes.filter((o) => o.appliedAt !== null).length,
    failed: allOutcomes.filter((o) => o.failedAt !== null).length,
    rolledBack: allOutcomes.filter((o) => o.rolledBackAt !== null).length,
    haltReason: campaign.halt?.reason ?? null,
    rollbackReason: campaign.rollback?.reason ?? null,
    digest,
  };
}
