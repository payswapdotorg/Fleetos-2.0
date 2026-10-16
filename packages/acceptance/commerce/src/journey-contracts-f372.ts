/**
 * @fleetos/acceptance-commerce — F372 (Wave 19 lane A): the networked-
 * PostgreSQL step families. The npg-* ops own the postgres SERVER
 * lifecycle (the REAL separate server process provisioned by the
 * infrastructure harness — initdb a temp PGDATA, an ephemeral port, a REAL
 * SIGKILL, a restart with WAL recovery) and the adapter-parity proof
 * surface (the same record set through the pglite and networked adapters —
 * identical digests; the dump -> wipe -> restore round-trip over the
 * network boundary rides the existing mps-backup / mps-restart(restore)
 * steps with mps-boot's store selection).
 *
 * CENSUS CITATION (the F354 lesson; greps at base 76ddba0 recorded in
 * docs/evidence/F372/report.md §1): the npg-* op family and the journey
 * ids `marketplace-networked-persistence` / `marketplace-networked-
 * server-crash` / `marketplace-networked-adapter-parity` are NEW at this
 * base — the composition angle (the marketplace store's networked
 * composition) is in the ids, never a mechanic a parallel corpus could
 * claim. The F362 spine verbs stay the EXISTING mps-* family (the same
 * HTTP boundary shape — only the backing store differs).
 *
 * Time law (D13/D14): single-epoch (T0) by construction — every timestamp
 * is literal journey data; the run anchor never reaches the service.
 * PORTS/TIMESTAMPS/PATHS NEVER IN JOURNEY OUTPUT: the ephemeral ports
 * (service AND postgres server), the temp dirs, the server pid and every
 * wall-clock value stay in the harness; only logical facts surface (the
 * fixture-clock law, byte-identical re-runs).
 *
 * File law: this file holds ONLY the typed step data; the server harness
 * composes infrastructure/fleetos-marketplace/pg-server.ts (the REAL
 * postgres process); the interpreter lives in drivers-npg.ts; the
 * journeys in journeys/f372-*.ts.
 */

import type { JourneyStepBase } from "./journey-contracts.js";

export type NpgStep =
  /** Provision a REAL postgres server process: initdb a temp PGDATA,
   *  start on an ephemeral port (127.0.0.1), probe TCP readiness. */
  | (JourneyStepBase & {
      readonly kind: "npg-server-boot";
      readonly factKey: string;
    })
  /** SIGKILL the REAL postgres SERVER PROCESS mid-journey (the F370C
   *  client-crash proof extended to the server): the harness records the
   *  pre-kill digest as the recovery baseline, kills the server, and
   *  probes the still-running service — the boundary reports the
   *  persistence plane's death (HTTP 500), never a silent hang. */
  | (JourneyStepBase & {
      readonly kind: "npg-server-kill";
      readonly factKey: string;
    })
  /** Respawn postgres over the SAME PGDATA and port — REAL WAL crash
   *  recovery — then prove the service reconnected transparently and the
   *  digest envelope is BYTE-IDENTICAL to the pre-kill baseline. */
  | (JourneyStepBase & {
      readonly kind: "npg-server-restart";
      readonly factKey: string;
    })
  /** Stop + tear down the postgres server (the reprovision preamble —
   *  the next npg-server-boot provisions a FRESH cluster; the honest
   *  "wipe" of the dump -> wipe -> restore round-trip). */
  | (JourneyStepBase & {
      readonly kind: "npg-server-stop";
      readonly factKey: string;
    })
  /** Record the CURRENT service digest as the adapter-parity baseline
   *  (the networked phase's proof value). */
  | (JourneyStepBase & {
      readonly kind: "npg-digest-baseline";
      readonly factKey: string;
    })
  /** Compare the CURRENT service digest against the recorded baseline:
   *  identical digests = the same record set through a DIFFERENT adapter
   *  (pglite vs networked) — the port contract proved — or the restored
   *  store's envelope fidelity after the round-trip. */
  | (JourneyStepBase & {
      readonly kind: "npg-parity";
      readonly factKey: string;
    });
