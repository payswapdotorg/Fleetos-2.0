/**
 * @fleetos/kernel — AuditEventRef (law A19).
 *
 * Every consequential kernel operation emits an AuditEventRef with a
 * sha256 digest so the operation is traceable through evidence to actor,
 * intent, tenant, timestamp, and a deterministic digest. Pure TypeScript,
 * deterministic, no I/O.
 */

import { createHash } from "node:crypto";
import type { ActorId, TenantId, SessionId } from "./tenant.js";

export interface AuditEventRef {
  readonly actor: ActorId | string;
  readonly intent: string;
  readonly tenant: TenantId | string;
  readonly session: SessionId | string;
  readonly timestamp: number;
  readonly digest: string;
}

/**
 * Computes a sha256 hex digest over the joined parts. Stable for byte-
 * identical inputs (no separator ambiguity — the pipe is unambiguous in
 * real values because ids and intents are validated upstream).
 */
export function digestOf(...parts: ReadonlyArray<string | number>): string {
  const text = parts.map((p) => String(p)).join("|");
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Builds an AuditEventRef from its constituent parts. Pure, deterministic,
 * idempotent. Two calls with the same inputs produce byte-identical refs.
 */
export function auditEvent(input: {
  readonly actor: ActorId | string;
  readonly intent: string;
  readonly tenant: TenantId | string;
  readonly session: SessionId | string;
  readonly timestamp: number;
  readonly digestSeed?: ReadonlyArray<string | number>;
}): AuditEventRef {
  const seed = input.digestSeed ?? [
    input.actor,
    input.intent,
    input.tenant,
    input.session,
    input.timestamp,
  ];
  return {
    actor: input.actor,
    intent: input.intent,
    tenant: input.tenant,
    session: input.session,
    timestamp: input.timestamp,
    digest: digestOf(...seed),
  };
}
