/**
 * @fleetos/control-plane — local digest helper (law A19).
 *
 * Same semantics as the kernel's `digestOf`: sha256 hex over the joined
 * parts. Duplicated locally because the F221 grant permits TYPE imports
 * from `@fleetos/kernel` only. Deterministic: byte-identical inputs
 * produce byte-identical digests.
 */

import { createHash } from "node:crypto";

export function digestOf(...parts: ReadonlyArray<string | number>): string {
  const text = parts.map((p) => String(p)).join("|");
  return createHash("sha256").update(text).digest("hex");
}
