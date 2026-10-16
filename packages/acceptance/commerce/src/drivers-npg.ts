/**
 * @fleetos/acceptance-commerce — the F372 networked-PG step drivers
 * (drivers-npg.ts).
 *
 * Interprets the npg-* steps — the postgres SERVER lifecycle owned by the
 * infrastructure harness (infrastructure/fleetos-marketplace/pg-server.ts,
 * the REAL separate server process: initdb a temp PGDATA, an ephemeral
 * port, a REAL SIGKILL, a restart with WAL recovery) and the adapter-
 * parity proof surface. The mps-* verb families stay unchanged: the same
 * F362 spine shape over the service's HTTP boundary — only the backing
 * store differs (mps-boot's store selection).
 *
 * Every fact surfaced is logical and deterministic — NEVER the service
 * port, the postgres port, the temp paths, a pid or a wall clock (the
 * fixture-clock law, byte-identical re-runs). The dead-server probe
 * records ONLY the HTTP status class (the service's frozen 503
 * STORE_UNREACHABLE refusal — the raw pool error NEVER enters facts).
 *
 * THE CRASH-WINDOW SEQUENCING LAW (the gate-race amendment — the F372
 * determinism fix): the SIGKILL/restart window is INHERENTLY racy at the
 * millisecond scale, on ANY real postgres (PG 15/16/17 all legal):
 *   - a lingering pre-crash backend may answer one more read (the
 *     postmaster-death notice is asynchronous in every backend);
 *   - the service's pool may still hold pre-crash connections whose
 *     failure (the 57P01 "unexpected postmaster exit" farewell) surfaces
 *     LATE — one blind read can hit it after the restart already listens;
 *   - the restarted server refuses startup packets with 57P03 until WAL
 *     replay completes (the recovery window).
 * The boundary now answers the ONE frozen verdict for that whole family
 * (503 STORE_UNREACHABLE — service.ts + store-unreachable.ts), and the
 * drivers SEQUENCE through it deterministically-in-OUTCOME:
 *   - the kill PROBE retries (deadline-bounded) until the store's death
 *     has SURFACED at the boundary (any non-200 answer) — never accepts a
 *     transient lingering-backend 200 as "still healthy";
 *   - the post-restart digest is taken only after a VERIFIED RECONNECT:
 *     retry (deadline-bounded) while the answer is the frozen refusal
 *     (each refused read purges one dead pool client / waits out WAL
 *     replay); a non-connection failure fails the step immediately
 *     (fail-closed — a real bug is never masked as recovery); the first
 *     200 IS the comparison point against the pre-kill baseline.
 * The wall-clock budgets are bounds ONLY — they never enter facts, and
 * the happy path converges in milliseconds (byte-identical outputs).
 */

import type { FactValue } from "./journey-contracts.js";
import type { NpgStep } from "./journey-contracts-f372.js";
import type { JourneyState } from "./journey-world.js";
import { logPush } from "./journey-world.js";
import { PostgresServerProcess } from "../../../../infrastructure/fleetos-marketplace/pg-server.js";
import { mpsCall, serviceOf } from "./drivers-mps-harness.js";

export type DriverFacts = Record<string, FactValue>;

// --- the crash-window sequencing budgets (bounds only; never facts) -------

/** One digest read bound — a hung transport is a failed read, never a
 *  hung journey (belt-and-braces; dead backends always FIN, but the bound
 *  keeps the law total on any box). */
const READ_TIMEOUT_MS = 15_000;
/** The kill probe's total window (the lingering-backend notice closes in
 *  milliseconds on every PG; the bound only caps the honest-failure
 *  path). */
const KILL_PROBE_WINDOW_MS = 30_000;
/** The verified-reconnect window after a restart — generous for WAL
 *  replay on any PG version / box speed (the harness's own readiness
 *  bound is 60s; the happy path is a handful of sub-second attempts). */
const RECONNECT_WINDOW_MS = 60_000;
/** The pause between attempts: idle turns for the pool's dead-client
 *  error events to purge (each refused read ALSO purges one). */
const RETRY_PAUSE_MS = 250;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** One bounded digest read through the service's HTTP boundary, the
 *  refusal CLASSIFIED (the frozen STORE_UNREACHABLE verdict vs a real
 *  failure) — the raw error text never reaches this layer's callers. */
interface DigestRead {
  /** The boundary answered (an HTTP status arrived — the service is alive). */
  readonly answered: boolean;
  /** The HTTP status class (0 = unanswered; never surfaced as a fact). */
  readonly status: number;
  /** 200 + the digest envelope served. */
  readonly ok: boolean;
  /** The digest total on ok (the WAL comparison value). */
  readonly total: string | null;
  /** The answer was the FROZEN store-unreachable verdict (503 +
   *  STORE_UNREACHABLE) — the crash/recovery window, retryable. */
  readonly refusal: boolean;
}

async function readDigest(service: ReturnType<typeof serviceOf>): Promise<DigestRead> {
  try {
    const res = await mpsCall(service, "GET", "/api/digest", undefined, undefined, AbortSignal.timeout(READ_TIMEOUT_MS));
    const digests = (res.json["digests"] ?? {}) as Record<string, unknown>;
    const refusal = res.json["refusal"];
    const refusalReason = refusal !== null && typeof refusal === "object"
      ? String((refusal as Record<string, unknown>)["reason"] ?? "")
      : "";
    return {
      answered: true,
      status: res.status,
      ok: res.status === 200,
      total: res.status === 200 ? String(digests["total"] ?? "-") : null,
      refusal: res.status === 503 && refusalReason === "STORE_UNREACHABLE",
    };
  } catch {
    return { answered: false, status: 0, ok: false, total: null, refusal: false };
  }
}

/** The current service's digest total via the verified-read helper (the
 *  healthy-path steps: baseline + parity — the server is up; a failed read
 *  honestly fails the step). */
async function digestTotalOf(service: ReturnType<typeof serviceOf>): Promise<{ ok: boolean; total: string | null }> {
  const read = await readDigest(service);
  return { ok: read.ok, total: read.total };
}

/** Interpret the npg-* steps (the postgres server lifecycle + parity). */
export async function runNpgStep(step: NpgStep, state: JourneyState): Promise<DriverFacts> {
  const service = serviceOf(state);
  switch (step.kind) {
    case "npg-server-boot": {
      if (service.pgServer !== null) {
        throw new Error("a postgres server is already provisioned for this journey (npg-server-stop it first)");
      }
      service.pgServer = await PostgresServerProcess.provision();
      logPush(state, "mps.log", "npg-server-boot:ok");
      return {
        [`npg.serverBoot.${step.factKey}.ok`]: true,
        [`npg.serverBoot.${step.factKey}.ready`]: service.pgServer.running,
      };
    }
    case "npg-server-kill": {
      if (service.pgServer === null) throw new Error("npg-server-kill: no postgres server provisioned");
      // The pre-kill digest is the WAL recovery comparison baseline.
      const before = await digestTotalOf(service);
      if (!before.ok || before.total === null) {
        throw new Error("npg-server-kill: the service's store was not reachable before the kill");
      }
      service.pgCrashBaseline = before.total;
      await service.pgServer.kill();
      // THE PROBE — deterministic-in-outcome: the boundary EVENTUALLY answers
      // a NON-200 for the store's death. A lingering pre-crash backend may
      // answer a transient 200 first (the postmaster-death notice is
      // asynchronous in every backend — PG 15/16/17 all legal), so the probe
      // RETRIES (deadline-bounded) until the death has SURFACED at the
      // boundary: the frozen STORE_UNREACHABLE refusal (or any non-200).
      // The service SURVIVES = the boundary kept answering throughout;
      // never a silent hang (per-attempt timeout), never the error detail.
      const deadline = Date.now() + KILL_PROBE_WINDOW_MS;
      let answered = false;
      let status = 0;
      for (;;) {
        const read = await readDigest(service);
        answered = answered || read.answered;
        if (read.answered) status = read.status;
        if (read.answered && read.status !== 200) break; // the death surfaced
        if (Date.now() > deadline) break;
        await sleep(RETRY_PAUSE_MS);
      }
      logPush(state, "mps.log", "npg-server-kill:sigkill");
      return {
        [`npg.serverKill.${step.factKey}.ok`]: true,
        [`npg.serverKill.${step.factKey}.serviceAlive`]: answered,
        [`npg.serverKill.${step.factKey}.storeUnreachable`]: status !== 200,
      };
    }
    case "npg-server-restart": {
      if (service.pgServer === null) throw new Error("npg-server-restart: no postgres server provisioned");
      // THE RESTART: same PGDATA, same port — REAL WAL crash recovery.
      await service.pgServer.restart();
      // THE VERIFIED RECONNECT (the gate-race fix): the post-crash digest is
      // taken ONLY after the store's server connection is PROVEN
      // re-established —
      //   - the service's pool may still hold pre-crash connections whose
      //     failure surfaces as the frozen STORE_UNREACHABLE refusal (each
      //     refused read purges one dead client; the next opens FRESH);
      //   - the restarted server refuses startup packets with 57P03 until
      //     WAL replay completes (the same frozen refusal family).
      // Retry while the refusal (or an unanswered transport blip) holds,
      // deadline-bounded; a NON-connection failure (a real 500) fails the
      // step immediately — fail-closed, never masked as recovery. The
      // first 200 IS the digest comparison point: the transparent
      // reconnect + WAL recovery must leave it BYTE-IDENTICAL to the
      // pre-kill baseline.
      const deadline = Date.now() + RECONNECT_WINDOW_MS;
      let after = await readDigest(service);
      while (!after.ok) {
        if (after.answered && !after.refusal) {
          throw new Error("npg-server-restart: the post-restart digest failed with a non-connection error (fail-closed)");
        }
        if (Date.now() > deadline) break;
        await sleep(RETRY_PAUSE_MS);
        after = await readDigest(service);
      }
      const baseline = service.pgCrashBaseline;
      logPush(state, "mps.log", `npg-server-restart:${after.ok && after.total === baseline ? "wal-recovered" : "RECOVERY-MISMATCH"}`);
      return {
        [`npg.serverRestart.${step.factKey}.ok`]: true,
        [`npg.serverRestart.${step.factKey}.recovered`]: after.ok,
        [`npg.serverRestart.${step.factKey}.digestsIdentical`]: after.ok && after.total !== null && after.total === baseline,
      };
    }
    case "npg-server-stop": {
      if (service.pgServer === null) throw new Error("npg-server-stop: no postgres server provisioned");
      await service.pgServer.teardown();
      service.pgServer = null;
      service.pgCrashBaseline = null;
      logPush(state, "mps.log", "npg-server-stop:ok");
      return { [`npg.serverStop.${step.factKey}.ok`]: true };
    }
    case "npg-digest-baseline": {
      const current = await digestTotalOf(service);
      if (!current.ok || current.total === null) {
        throw new Error("npg-digest-baseline: the service's store was not reachable");
      }
      service.parityBaseline = current.total;
      logPush(state, "mps.log", `npg-baseline:${current.total}`);
      return {
        [`npg.baseline.${step.factKey}.ok`]: true,
        [`npg.baseline.${step.factKey}.digestTotal`]: current.total,
      };
    }
    case "npg-parity": {
      const current = await digestTotalOf(service);
      const baseline = service.parityBaseline;
      if (!current.ok || current.total === null) {
        throw new Error("npg-parity: the service's store was not reachable");
      }
      logPush(state, "mps.log", `npg-parity:${current.total === baseline ? "identical" : "DIFFER"}`);
      return {
        [`npg.parity.${step.factKey}.ok`]: true,
        [`npg.parity.${step.factKey}.digestsIdentical`]: current.total === baseline,
        [`npg.parity.${step.factKey}.digestTotal`]: current.total,
      };
    }
  }
  throw new Error("unknown npg step kind (the switch is exhaustive — a driver dispatch bug)");
}
