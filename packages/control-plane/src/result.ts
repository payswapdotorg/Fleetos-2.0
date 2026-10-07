/**
 * @fleetos/control-plane — local Result<T, E>.
 *
 * Structurally identical to the kernel's Result (discriminated union with a
 * machine-stable reason string). Duplicated locally because the F221 grant
 * permits TYPE imports from `@fleetos/kernel` only; every expected failure
 * mode is a value, never an exception.
 */

export type Result<T, E = string> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function fail<E>(reason: E): Result<never, E> {
  return { ok: false, reason };
}
