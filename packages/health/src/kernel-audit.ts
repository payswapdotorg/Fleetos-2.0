/**
 * @fleetos/health — Wave 1 kernel audit reference (F210A).
 *
 * AuditEventRef — structural audit reference (A19). Same shape used across
 * all worker-A kernel packages. Each consequential kernel operation emits
 * one. Pure TypeScript, no I/O.
 */

import { createHash } from "node:crypto";

export interface AuditEventRef {
  readonly actor: string;
  readonly intent: string;
  readonly tenant: string;
  readonly timestamp: number;
  readonly digest: string;
}

export function digestOf(...parts: ReadonlyArray<string | number>): string {
  const text = parts.map((p) => String(p)).join("|");
  return createHash("sha256").update(text).digest("hex");
}
