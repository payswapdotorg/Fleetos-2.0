/**
 * @fleetos/kernel — Result<T, E> and machine-stable reason helpers.
 *
 * Pure TypeScript. No I/O. The kernel's repository/session/outbox surfaces
 * return discriminated Result unions so callers never receive exceptions
 * for expected failure modes (stale revision, tenant-mismatch, session
 * aborted, etc.). Every Result failure carries a stable string reason code
 * so the calling site can branch on machine-stable semantics.
 */

export type Result<T, E = KernelReason> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: E };

export type KernelReason = string;

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function fail<E>(reason: E): Result<never, E> {
  return { ok: false, reason };
}

/**
 * Returns the value if ok, throws an Error on failure with the stable reason
 * as the message. Used by tests and by call sites that have already branched
 * on ok.
 */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.ok) return result.value;
  throw new Error(`kernel: unwrap on failed result — reason=${String(result.reason)}`);
}

/**
 * Returns the value if ok, otherwise the fallback. Never throws.
 */
export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback;
}

/**
 * Maps the value of a successful Result; passes failures through unchanged.
 */
export function mapOk<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  if (result.ok) return ok(fn(result.value));
  return fail(result.reason);
}
