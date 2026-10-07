/**
 * FleetOS 2.0 — Postgres driver entry.
 *
 * HONEST `unimplemented` state marker. NO live `pg` dependency, NO
 * network, NO credentials. The structural seam (`SqlDriverPort` +
 * schema contract) is exported so the composition layer can adopt it
 * when the live binding lands.
 *
 * Live binding status: DEFERRED — gated on the deployment work item
 * (production/staging verification per AGENTS.md).
 */

import type { SqlDriverPort, SqlDriverState } from "./sql-driver-port.js";

export * from "./sql-driver-port.js";
export * from "./schema.js";

// ---------------------------------------------------------------------------
// unimplemented — the honest marker. Any attempt to acquire a
// connection or open a transaction returns a stable rejection so the
// kernel falls back to the in-memory driver (which is the test reference).
// ---------------------------------------------------------------------------

const UNIMPLEMENTED_REJECTION = "postgres-driver:unimplemented";

export const UNIMPLEMENTED_DRIVER: SqlDriverPort = {
  async acquire(): Promise<never> {
    throw new Error(UNIMPLEMENTED_REJECTION);
  },
  async beginTransaction(): Promise<never> {
    throw new Error(UNIMPLEMENTED_REJECTION);
  },
  state(): SqlDriverState {
    return "unimplemented";
  },
};

// Stable rejection string for tests that branch on the driver state.
export const POSTGRES_UNIMPLEMENTED_REASON = UNIMPLEMENTED_REJECTION;
