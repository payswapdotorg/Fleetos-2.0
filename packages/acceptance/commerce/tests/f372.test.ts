/**
 * F372 (Wave 19 lane A) machine battery — the networked-PG journeys:
 *   1. CENSUS BOUND: the three journeys drive ONLY their declared kinds
 *      (the npg-* server lifecycle + the EXISTING mps-* verb family over
 *      the service's HTTP boundary — zero in-process kernel re-drives).
 *   2. CORPUS LAWS: 49 -> 52 grow-only; the three new capabilities.
 *   3. D14 FORM: >= 5 substantive assertions per journey; >= 1 asserted
 *      refusal each.
 *   4. THE OUTPUT LAW: the ephemeral ports (service AND postgres server),
 *      the temp paths and every wall-clock/ISO timestamp NEVER appear in
 *      any journey fact or log (machine-scanned after a real run).
 *   5. DETERMINISM: same-journey re-runs byte-identical (real re-provisions,
 *      real SIGKILLs, real WAL recoveries, real restores — stable digests).
 *   6. THE SERVER-CRASH LAW: the postgres SERVER PROCESS is SIGKILLed
 *      mid-journey (the service survives; the boundary reports the
 *      persistence plane's death); the restart's WAL recovery leaves the
 *      digest envelope byte-identical — machine-asserted, not prose.
 *   7. THE PORT-CONTRACT LAW: the same record set through the pglite and
 *      networked adapters yields an identical digest envelope; the
 *      dump -> wipe -> restore round-trip over the network boundary
 *      reproduces it.
 *   8. THE CRASH-WINDOW VERDICT LAW (the gate-race amendment): the
 *      connection-lost error family classifies to ONE frozen boundary
 *      verdict (503 + STORE_UNREACHABLE — never the raw pool error, never
 *      the ECONNREFUSED port), and the post-crash digest is sequenced
 *      after a VERIFIED reconnect — deterministic on ANY real postgres
 *      (PG 15/16/17 all legal; the poisoned-pool-client and
 *      WAL-recovery windows are retried through, never blindly read).
 */

import { describe, expect, it } from "vitest";
import { JOURNEYS } from "../src/journeys/index.js";
import { runJourney } from "../src/runner.js";
import { canonicalJson } from "../src/journey-contracts.js";
import { buildJourneyWorld } from "../src/journey-world.js";
import { bootService, mpsCall, serviceOf, shutdownService } from "../src/drivers-mps-harness.js";
import { PostgresServerProcess } from "../../../../infrastructure/fleetos-marketplace/pg-server.js";
import { STORE_UNREACHABLE_REASON, isStoreUnreachableError, storeUnreachableOutcome } from "../../../../infrastructure/fleetos-marketplace/store-unreachable.js";

const F372_IDS = [
  "marketplace-networked-persistence",
  "marketplace-networked-server-crash",
  "marketplace-networked-adapter-parity",
] as const;

const NPG_KINDS: ReadonlySet<string> = new Set([
  "npg-server-boot", "npg-server-kill", "npg-server-restart", "npg-server-stop",
  "npg-digest-baseline", "npg-parity",
]);

const MPS_KINDS: ReadonlySet<string> = new Set([
  "mps-boot", "mps-shutdown", "mps-restart",
  "mps-provision", "mps-login", "mps-mint-keyed-token", "mps-token-surgery", "mps-revoke",
  "mps-request-submit", "mps-request-transition",
  "mps-offer-capture", "mps-offer-sheet", "mps-comparison",
  "mps-evidence-retain", "mps-approval",
  "mps-order-draft", "mps-order-place", "mps-order-ack", "mps-order-transition",
  "mps-receipt-record", "mps-receipt-verify",
  "mps-enrollment-open", "mps-enrollment-complete",
  "mps-digest", "mps-backup", "mps-state",
]);

const DECLARED_KINDS: ReadonlySet<string> = new Set([...NPG_KINDS, ...MPS_KINDS]);

function byId(id: string) {
  const journey = JOURNEYS.find((j) => j.id === id);
  if (journey === undefined) throw new Error(`unknown journey ${id}`);
  return journey;
}

describe("F372 — census bound + corpus laws", () => {
  it("the three journeys exist with unique ids in the corpus (49 -> 52, grow-only)", () => {
    expect(JOURNEYS.length).toBe(52);
    const ids = JOURNEYS.map((j) => j.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of F372_IDS) expect(ids).toContain(id);
  });

  it("the journeys drive ONLY their declared kinds (the npg-* server lifecycle + the existing mps-* verb family — no in-process kernel re-drives)", () => {
    for (const id of F372_IDS) {
      const journey = byId(id);
      for (const step of journey.steps) {
        expect(DECLARED_KINDS.has(step.kind), `${journey.id}:${step.kind}`).toBe(true);
      }
    }
    const kinds: ReadonlySet<string> = new Set(F372_IDS.flatMap((id) => byId(id).steps.map((s) => s.kind)));
    for (const kind of ["npg-server-boot", "npg-server-kill", "npg-server-restart", "mps-boot", "mps-provision", "mps-login", "mps-digest", "mps-shutdown"]) {
      expect(kinds.has(kind), kind).toBe(true);
    }
    // The networked composition is real: every journey boots the NETWORKED
    // store (the pg adapter at the port) against a provisioned server.
    for (const id of F372_IDS) {
      const boots = byId(id).steps.filter((s) => s.kind === "mps-boot");
      expect(boots.length, id).toBeGreaterThanOrEqual(1);
      expect(boots.some((s) => (s as { readonly store?: string }).store === "networked"), id).toBe(true);
    }
  });

  it("the three new capabilities are covered and in the fixed vocabulary", () => {
    const covered: ReadonlySet<string> = new Set(JOURNEYS.map((j) => j.capability));
    for (const capability of ["marketplace-networked-persistence", "marketplace-networked-server-crash", "marketplace-networked-adapter-parity"]) {
      expect(covered.has(capability)).toBe(true);
    }
  });

  it("D14 form: >= 5 substantive assertions per journey and >= 1 asserted refusal each", () => {
    for (const id of F372_IDS) {
      const journey = byId(id);
      expect(journey.assertions.length, id).toBeGreaterThanOrEqual(5);
      const refusalAssertions = journey.assertions.filter((a) =>
        ["UNAUTHENTICATED", "SESSION_EXPIRED", "TENANT_MISMATCH", "SCOPE_MISSING", "MALFORMED", "NOT_FOUND",
          "NATURAL_KEY_CONFLICT", "ILLEGAL_TRANSITION", "ALREADY_ACKNOWLEDGED", "refuse"].includes(String(a.expected)));
      expect(refusalAssertions.length, id).toBeGreaterThanOrEqual(1);
    }
  });

  it("carries NO epoch tables (D13 — single-epoch T0 by construction)", () => {
    for (const id of F372_IDS) {
      const tables = byId(id).assertions.filter((a) => a.expectedByEpoch !== undefined);
      expect(tables.length, id).toBe(0);
    }
  });
});

describe("F372 — the machine-run journeys (real provisions, real SIGKILLs, real WAL recoveries)", () => {
  it.skipIf(process.env["F372_SKIP_SLOW"] === "1")("the networked-persistence journey passes end to end", async () => {
    const { outcome, facts } = await runJourney(byId("marketplace-networked-persistence"));
    expect(outcome.passed, JSON.stringify(outcome.assertionOutcomes.filter((a) => !a.ok), null, 2)).toBe(true);
    expect(outcome.stepOutcomes.every((s) => s.executed && s.ok)).toBe(true);
    // THE SERVER-CRASH LAWS (machine-checked on the real run):
    expect(facts.get("npg.serverKill.crash.serviceAlive")).toBe(true);
    expect(facts.get("npg.serverKill.crash.storeUnreachable")).toBe(true);
    expect(facts.get("npg.serverRestart.recovery.digestsIdentical")).toBe(true);
  });

  it.skipIf(process.env["F372_SKIP_SLOW"] === "1")("the server-crash-restart journey passes end to end — TWO server SIGKILLs + the service cold restart", async () => {
    const { outcome, facts } = await runJourney(byId("marketplace-networked-server-crash"));
    expect(outcome.passed, JSON.stringify(outcome.assertionOutcomes.filter((a) => !a.ok), null, 2)).toBe(true);
    // THE WAL RECOVERY LAWS at BOTH crash points:
    expect(facts.get("npg.serverRestart.recoveryOne.digestsIdentical")).toBe(true);
    expect(facts.get("npg.serverRestart.recoveryTwo.digestsIdentical")).toBe(true);
    // The F370C client-crash law extended networked (verify-on-start replay):
    expect(facts.get("mps.restart.coldRestart.receiptsReplayed")).toBe(1);
    expect(facts.get("mps.restart.coldRestart.digestsIdentical")).toBe(true);
  });

  it.skipIf(process.env["F372_SKIP_SLOW"] === "1")("the adapter-parity journey passes end to end — the port contract + the round-trip over the network boundary", async () => {
    const { outcome, facts } = await runJourney(byId("marketplace-networked-adapter-parity"));
    expect(outcome.passed, JSON.stringify(outcome.assertionOutcomes.filter((a) => !a.ok), null, 2)).toBe(true);
    // THE PORT-CONTRACT LAW + THE ROUND-TRIP LAW:
    expect(facts.get("npg.parity.pgliteVsNetworked.digestsIdentical")).toBe(true);
    expect(facts.get("npg.parity.restored.digestsIdentical")).toBe(true);
    expect(facts.get("mps.orderT.accept.status")).toBe("accepted");
  });

  it.skipIf(process.env["F372_SKIP_SLOW"] === "1")("THE OUTPUT LAW: ports, data-dir/PGDATA paths and wall-clock timestamps never appear in any fact or log", async () => {
    const { facts } = await runJourney(byId("marketplace-networked-server-crash"));
    const serialized = JSON.stringify([...facts.entries()].map(([k, v]) => [k, v]));
    // The ephemeral-port shape (":<4-5 digits>") never appears:
    expect(serialized).not.toMatch(/:(?:3[0-9]{3}|[1-9][0-9]{4})\b/);
    // The temp data-dir/PGDATA paths never appear (both live under /tmp —
    // the mps-journey- and npg-server- mkdtemp prefixes; the npg-* log
    // LABELS are op names, never paths):
    expect(serialized).not.toContain("/tmp/");
    expect(serialized).not.toContain("mps-journey-");
    expect(serialized).not.toContain("pgdata");
    // The connection-string shape never appears:
    expect(serialized).not.toContain("postgres://");
    // No wall-clock ISO timestamp ever appears (the fixture-clock law; the
    // only ISO strings are the fixed 2026-10-14/15 evidence fixtures):
    const isoMatches = serialized.match(/"20\d\d-\d\d-\d\dT[^"]+"/g) ?? [];
    for (const match of isoMatches) {
      expect(match.startsWith("\"2026-10-1")).toBe(true);
    }
  });

  it.skipIf(process.env["F372_SKIP_SLOW"] === "1")("DETERMINISM: the three journeys re-run byte-identically (real re-provisions, real SIGKILLs, stable digests)", async () => {
    for (const id of F372_IDS) {
      const first = await runJourney(byId(id));
      const second = await runJourney(byId(id));
      expect(canonicalJson(second.outcome), id).toBe(canonicalJson(first.outcome));
      expect(canonicalJson([...second.facts.entries()].map(([k, v]) => [k, v])), id).toBe(canonicalJson([...first.facts.entries()].map(([k, v]) => [k, v])));
    }
  });
});

describe("F372 — the crash-window verdict law (the gate-race amendment: deterministic on ANY real postgres)", () => {
  it("the connection-lost family classifies to the ONE frozen verdict — and nothing else does (the classifier is total on the family, narrow outside it)", () => {
    // THE FAMILY (every member the crash/recovery window can raise, across
    // PG 15/16/17 and every OS phrasing — machine codes AND bare messages):
    const family = [
      Object.assign(new Error("terminating connection due to unexpected postmaster exit"), { code: "57P01" }), // the lingering backend's FATAL farewell (the gate-box race)
      Object.assign(new Error("terminating connection due to administrator command"), { code: "57P01" }),
      Object.assign(new Error("terminating connection due to crash of another server process"), { code: "57P02" }),
      Object.assign(new Error("the database system is starting up"), { code: "57P03" }), // the WAL-replay window
      Object.assign(new Error("connection failure"), { code: "08006" }),
      Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:54329"), { code: "ECONNREFUSED" }), // the fresh-connect member (its RAW text carries the port)
      Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }),
      Object.assign(new Error("write EPIPE"), { code: "EPIPE" }),
      new Error("Connection terminated unexpectedly"), // pg's bare mid-protocol loss
      new Error("timeout exceeded when trying to connect"), // the pool's connect timeout
    ];
    for (const error of family) {
      expect(isStoreUnreachableError(error), String(error.message)).toBe(true);
    }
    // OUTSIDE the family — fail-loud is the law (a real defect is never
    // masked as "unreachable"):
    const notFamily = [
      Object.assign(new Error('duplicate key value violates unique constraint "requests_pkey"'), { code: "23505" }),
      Object.assign(new Error("too many clients"), { code: "53300" }),
      Object.assign(new Error("syntax error"), { code: "42601" }),
      new Error("boom"),
      "not even an error",
      null,
    ];
    for (const error of notFamily) {
      expect(isStoreUnreachableError(error), String(error)).toBe(false);
    }
    // THE FROZEN VERDICT is byte-stable data (constants — no raw text, no
    // port, no environment phrasing can ever enter it):
    const outcome = storeUnreachableOutcome();
    expect(outcome.status).toBe(503);
    expect(canonicalJson(outcome)).toBe(canonicalJson(storeUnreachableOutcome()));
    const body = outcome.body as { ok: boolean; refusedBy: string; refusal: { reason: string; detail: string } };
    expect(body.ok).toBe(false);
    expect(body.refusedBy).toBe("boundary");
    expect(body.refusal.reason).toBe(STORE_UNREACHABLE_REASON);
    const text = JSON.stringify(outcome);
    expect(text).not.toMatch(/57P01|postmaster|ECONNREFUSED|Connection terminated|starting up/i);
    expect(text).not.toMatch(/:(?:3[0-9]{3}|[1-9][0-9]{4})\b/); // never a port
  });

  it.skipIf(process.env["F372_SKIP_SLOW"] === "1")("THE BOUNDARY VERDICT + THE VERIFIED RECONNECT (real server, real SIGKILL): the crash window answers the frozen refusal — never the raw pool error — and the post-restart digest lands only after the verified reconnect, byte-identical", async () => {
    const state = buildJourneyWorld();
    const service = serviceOf(state);
    service.storeMode = "networked";
    service.pgServer = await PostgresServerProcess.provision();
    const port = await bootService(service);
    try {
      // Populate the service's pool with MULTIPLE clients (concurrent reads
      // — the gate-box condition: several pre-crash connections whose
      // failure can surface late, inside the restart window).
      const baseline = await mpsCall(service, "GET", "/api/digest");
      expect(baseline.status).toBe(200);
      await Promise.all([1, 2, 3, 4].map(() => mpsCall(service, "GET", "/api/digest")));
      const baselineTotal = String((baseline.json["digests"] as Record<string, unknown>)["total"]);

      // THE CRASH: SIGKILL the postgres SERVER PROCESS.
      await service.pgServer.kill();

      // The probe law (the driver's law, mirrored): retry until the death
      // has SURFACED at the boundary — a lingering pre-crash backend may
      // answer a transient 200 first on SOME environments.
      const probeDeadline = Date.now() + 30_000;
      let surfaced: { status: number; json: Record<string, unknown> } | null = null;
      for (;;) {
        const read = await mpsCall(service, "GET", "/api/digest", undefined, undefined, AbortSignal.timeout(15_000));
        if (read.status !== 200) { surfaced = read; break; }
        if (Date.now() > probeDeadline) break;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      expect(surfaced).not.toBeNull();
      expect(surfaced?.status).toBe(503);
      const refusal = surfaced?.json["refusal"] as Record<string, unknown> | undefined;
      expect(surfaced?.json["ok"]).toBe(false);
      expect(surfaced?.json["refusedBy"]).toBe("boundary");
      expect(refusal?.["reason"]).toBe(STORE_UNREACHABLE_REASON);
      // THE RAW POOL ERROR NEVER CROSSES THE BOUNDARY (any family member,
      // any phrasing, any port — the frozen verdict is the whole answer):
      const surfacedText = JSON.stringify(surfaced?.json);
      expect(surfacedText).not.toMatch(/57P01|postmaster|ECONNREFUSED|Connection terminated|starting up/i);
      expect(surfacedText).not.toMatch(/:(?:3[0-9]{3}|[1-9][0-9]{4})\b/);
      // The verdict is STABLE across the window (multiple reads — the same
      // frozen bytes whichever family member fired underneath):
      for (let i = 0; i < 3; i++) {
        const again = await mpsCall(service, "GET", "/api/digest", undefined, undefined, AbortSignal.timeout(15_000));
        expect(again.status).toBe(503);
        expect(canonicalJson(again.json)).toBe(canonicalJson(surfaced?.json));
      }

      // THE RESTART + THE VERIFIED RECONNECT (the driver's law, mirrored):
      // retry through the frozen refusals (poisoned pre-crash clients, the
      // WAL-replay window) until the store's connection is PROVEN back;
      // the first 200 is the comparison point — byte-identical or honest
      // failure, never a blind single read (the gate race).
      await service.pgServer.restart();
      const reconnectDeadline = Date.now() + 60_000;
      let recovered: Record<string, unknown> | null = null;
      for (;;) {
        const read = await mpsCall(service, "GET", "/api/digest", undefined, undefined, AbortSignal.timeout(15_000));
        if (read.status === 200) { recovered = read.json; break; }
        if (read.status !== 503) throw new Error(`unexpected non-refusal status during recovery: ${read.status}`);
        if (Date.now() > reconnectDeadline) break;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      expect(recovered).not.toBeNull();
      const recoveredDigests = (recovered?.["digests"] ?? {}) as Record<string, unknown>;
      expect(String(recoveredDigests["total"])).toBe(baselineTotal);
      // ... and the reconnected store keeps SERVING (the transparent
      // reconnect held — not a one-off read):
      const served = await mpsCall(service, "GET", "/api/digest");
      expect(served.status).toBe(200);
      expect(String((served.json["digests"] as Record<string, unknown>)["total"])).toBe(baselineTotal);
      expect(port).toBeGreaterThan(0); // the port never leaves this scope
    } finally {
      await shutdownService(service);
    }
  });
});
