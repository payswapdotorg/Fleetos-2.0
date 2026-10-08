/**
 * @fleetos/acceptance-field — executor support types.
 */

import type { ReadingValue } from "../context.js";

/** One executed journey operation: outcome + the readings it recorded. */
export interface OpExecution {
  readonly ok: boolean;
  /** Refusal note (REAL package reason code) when ok === false. */
  readonly note: string | null;
  /** Relative reading names — the runner prefixes them with the step id. */
  readonly readings: Readonly<Record<string, ReadingValue>>;
}

export function opOk(readings: Readonly<Record<string, ReadingValue>> = {}): OpExecution {
  return { ok: true, note: null, readings };
}

export function opRefused(note: string, readings: Readonly<Record<string, ReadingValue>> = {}): OpExecution {
  return { ok: false, note, readings };
}
