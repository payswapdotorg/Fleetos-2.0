/**
 * infrastructure/fleetos-marketplace/store-unreachable.ts — the FROZEN
 * crash-window verdict at the service boundary (F372, Wave 19 lane A; the
 * gate-race amendment).
 *
 * THE LAW this module freezes: when the persistence plane's SERVER
 * connection is lost (a SIGKILLed postgres SERVER PROCESS, its lingering
 * backends' FATAL farewells, a restart still replaying WAL, a refused
 * fresh connect), the boundary answers ONE deterministic verdict AS DATA —
 *
 *   503 { ok: false, refusedBy: "boundary",
 *         refusal: { reason: "STORE_UNREACHABLE", detail: <frozen prose> } }
 *
 * — NEVER the raw pool error. The raw family is environment-dependent by
 * nature (`57P01 terminating connection due to unexpected postmaster
 * exit` vs `ECONNREFUSED connect ECONNREFUSED 127.0.0.1:<port>` vs
 * `Connection terminated unexpectedly` vs `the database system is starting
 * up` — PG 15/16/17 and every OS phrase these differently, and the
 * ECONNREFUSED text carries the PORT). The frozen verdict makes the
 * crash-window answer byte-stable on ANY real postgres: the journeys'
 * reconnection sequencing (drivers-npg.ts) retries THROUGH this verdict,
 * so a killed-and-restarted server is recovered deterministically-in-
 * outcome, not by luck of timing.
 *
 * The classification is DELIBERATELY NARROW — only the connection-lost
 * family. Any other store error (a constraint violation, a bug) keeps the
 * existing fail-loud 500 internal path: masking a real defect as
 * "unreachable" would be the opposite of fail-closed.
 *
 * The pglite in-process mode is UNAFFECTED by construction: an in-process
 * store never raises the connection-lost family, so its observable
 * behavior is byte-identical (zero motion — the F370C law).
 */

/**
 * A LEAF module by design: ZERO imports. The marketplace service's TS
 * projects resolve `@fleetos/*` differently (the infra project pins them
 * via tsconfig paths — its documented precedent — while the acceptance
 * batteries compose infrastructure leaves like pg-server.ts directly), so
 * this module keeps the outcome shape STRUCTURAL: it conforms to the
 * service's ApiOutcome convention (api.ts) without importing it.
 */

/** The frozen reason code (the ONE verdict for the whole family). */
export const STORE_UNREACHABLE_REASON = "STORE_UNREACHABLE";

/**
 * SQLSTATEs that mean "the SERVER connection is gone / not yet serving":
 *   57P01 admin shutdown — INCLUDING the lingering backend's
 *        "terminating connection due to unexpected postmaster exit"
 *        farewell after the postmaster is SIGKILLed (the crash window);
 *   57P02 crash shutdown — a sibling backend crashed, the cluster reboots;
 *   57P03 cannot connect now — "the database system is starting up":
 *        the restarted server is still replaying WAL (the recovery window);
 *   08000/08001/08003/08004/08006 — the SQL connection-exception class.
 */
const CONNECTION_SQLSTATES: ReadonlySet<string> = new Set([
  "57P01", "57P02", "57P03",
  "08000", "08001", "08003", "08004", "08006",
]);

/** Node transport errnos for a lost/unrefused/reset TCP plane. */
const CONNECTION_ERRNOS: ReadonlySet<string> = new Set([
  "ECONNREFUSED", "ECONNRESET", "ECONNABORTED", "EPIPE", "ETIMEDOUT",
  "EHOSTUNREACH", "ENETUNREACH", "ENOTFOUND", "EAI_AGAIN",
]);

/**
 * Driver-level messages that arrive WITHOUT a machine code (pg wraps some
 * of these in plain Errors): the mid-protocol socket loss, the pool's
 * connect timeout, and the postmaster-exit farewells belt-and-braces (the
 * SQLSTATE normally carries them; the match keeps the classifier total on
 * any pg version / wrapper shape).
 */
const CONNECTION_MESSAGES: readonly RegExp[] = [
  /connection terminated unexpectedly/i,
  /timeout exceeded when trying to connect/i,
  /terminating connection due to (?:unexpected postmaster exit|administrator command|crash of another server process|crash shutdown)/i,
];

/** True when the error is the connection-lost family (the crash/recovery
 *  window) — the ONLY class that maps to the frozen verdict. */
export function isStoreUnreachableError(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  const code = (error as { readonly code?: unknown }).code;
  if (typeof code === "string" && (CONNECTION_SQLSTATES.has(code) || CONNECTION_ERRNOS.has(code))) {
    return true;
  }
  const message = (error as { readonly message?: unknown }).message;
  if (typeof message === "string" && CONNECTION_MESSAGES.some((marker) => marker.test(message))) {
    return true;
  }
  return false;
}

/** The frozen boundary verdict (verdict-as-data; the reason code and the
 *  detail are CONSTANTS — byte-stable across environments and re-runs).
 *  Structural ApiOutcome conformance: { status, body }. */
export function storeUnreachableOutcome(): { readonly status: number; readonly body: {
  readonly ok: false;
  readonly refusedBy: "boundary";
  readonly refusal: { readonly reason: string; readonly detail: string };
} } {
  return {
    status: 503,
    body: {
      ok: false,
      refusedBy: "boundary",
      refusal: {
        reason: STORE_UNREACHABLE_REASON,
        detail: "the persistence plane is unreachable — the store's server connection was lost; this verdict is frozen (the raw transport error never crosses the boundary)",
      },
    },
  };
}
