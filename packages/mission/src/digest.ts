/**
 * @fleetos/mission — local digest helper (law A19).
 *
 * Same semantics as the kernel's `digestOf` (sha256 hex over joined
 * parts). Duplicated locally — TYPE imports only from `@fleetos/kernel`.
 */

import { createHash } from "node:crypto";

export function digestOf(...parts: ReadonlyArray<string | number>): string {
  const text = parts.map((p) => String(p)).join("|");
  return createHash("sha256").update(text).digest("hex");
}
