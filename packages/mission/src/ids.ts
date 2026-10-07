/**
 * @fleetos/mission — branded ids.
 *
 * `MissionId` is a branded string (`msn_` prefix). Stage ids and
 * checkpoint ids are plain validated strings — they appear inside
 * mission definitions supplied by the application layer.
 */

declare const __brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [__brand]: B };

export type MissionId = Brand<string, "MissionId">;

const MISSION_ID_PATTERN = /^msn_[A-Za-z0-9_-]{4,128}$/;
const STAGE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

export function isMissionId(value: string): value is MissionId {
  return typeof value === "string" && MISSION_ID_PATTERN.test(value);
}

export function asMissionId(value: string): MissionId {
  return value as MissionId;
}

export function isValidStageId(value: string): boolean {
  return typeof value === "string" && STAGE_ID_PATTERN.test(value);
}

export function isValidCheckpointId(value: string): boolean {
  return typeof value === "string" && value.length >= 1 && value.length <= 256;
}

export function workOrderIdempotencyKey(
  missionId: string,
  stageId: string,
): string {
  return `wo:${missionId}:${stageId}`;
}
