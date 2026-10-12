/**
 * @fleetos/maintenance — F331A firmware campaign journal (Wave 13 lane A).
 *
 * The append-only, hash-chained (FNV-1a 32, the lane convention),
 * tenant-scoped event journal every firmware campaign records its whole
 * lifecycle into. Pure functions over an events array — no campaign
 * dependency (the split-file law; see firmware-campaign.ts).
 */

export type FirmwareCampaignEventKind =
  | "campaign-declared"
  | "campaign-announced"
  | "wave-started"
  | "device-outcome"
  | "wave-verified"
  | "campaign-completed"
  | "campaign-halted"
  | "campaign-resumed"
  | "rollback-started"
  | "device-rollback"
  | "campaign-rolled-back";

export interface FirmwareCampaignEvent {
  readonly seq: number;
  readonly at: number;
  readonly actor: string;
  readonly kind: FirmwareCampaignEventKind;
  readonly waveId: string | null;
  readonly deviceId: string | null;
  readonly detail: string;
  readonly prevDigest: string;
  readonly digest: string;
}

export interface FirmwareCampaignEventInput {
  readonly at: number;
  readonly actor: string;
  readonly kind: FirmwareCampaignEventKind;
  readonly waveId?: string;
  readonly deviceId?: string;
  readonly detail: string;
}

function fnv1a32(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function eventDigest(
  seq: number,
  at: number,
  actor: string,
  kind: string,
  waveId: string | null,
  deviceId: string | null,
  detail: string,
  prevDigest: string,
): string {
  return fnv1a32([seq, at, actor, kind, waveId ?? "-", deviceId ?? "-", detail, prevDigest].join("\u001f"));
}

/** Append one event to a campaign journal (returns the new events array). */
export function appendCampaignEvent(
  events: readonly FirmwareCampaignEvent[],
  input: FirmwareCampaignEventInput,
): readonly FirmwareCampaignEvent[] {
  const seq = events.length + 1;
  const prevDigest = events.length === 0 ? "genesis" : events[events.length - 1]!.digest;
  const event: FirmwareCampaignEvent = {
    seq,
    at: input.at,
    actor: input.actor,
    kind: input.kind,
    waveId: input.waveId ?? null,
    deviceId: input.deviceId ?? null,
    detail: input.detail,
    prevDigest,
    digest: eventDigest(seq, input.at, input.actor, input.kind, input.waveId ?? null, input.deviceId ?? null, input.detail, prevDigest),
  };
  return [...events, event];
}

/** Tamper-evident re-verification of a campaign journal's hash chain. */
export function verifyFirmwareCampaignJournal(events: readonly FirmwareCampaignEvent[]): boolean {
  let prev = "genesis";
  for (let i = 0; i < events.length; i += 1) {
    const event = events[i]!;
    if (event.seq !== i + 1) return false;
    if (event.prevDigest !== prev) return false;
    if (event.digest !== eventDigest(event.seq, event.at, event.actor, event.kind, event.waveId, event.deviceId, event.detail, event.prevDigest)) {
      return false;
    }
    prev = event.digest;
  }
  return true;
}
