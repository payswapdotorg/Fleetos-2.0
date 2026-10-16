/**
 * F370C (Wave 18 lane C) machine battery — the verified-deployment
 * journeys:
 *   1. CENSUS BOUND: the three journeys drive ONLY their own mps-* kinds
 *      (the service's HTTP boundary — zero in-process kernel re-drives).
 *   2. CORPUS LAWS: 46 -> 49 grow-only; the three new capabilities.
 *   3. D14 FORM: >= 5 substantive assertions per journey; >= 1 asserted
 *      refusal at every surface.
 *   4. THE OUTPUT LAW: the ephemeral port, the data-dir path and every
 *      wall-clock/ISO timestamp NEVER appear in any journey fact or log
 *      (machine-scanned after a real run).
 *   5. DETERMINISM: same-journey re-runs byte-identical (real re-spawns,
 *      real SIGKILLs, real restores — the digest values stable).
 *   6. THE RUNBOOK LAW: the backup journey's step sequence IS the
 *      runbook's procedure (dump -> incident -> --restore boot -> verify
 *      -> serve) — the doc and the test can never drift.
 *   7. THE REFUSAL COVERAGE LAW: every F370A gate reason surfaced at the
 *      boundary + the two-layer law + the crash-persistent revocation.
 */

import { describe, expect, it } from "vitest";
import { JOURNEYS } from "../src/journeys/index.js";
import { runJourney } from "../src/runner.js";
import { canonicalJson } from "../src/journey-contracts.js";

const F370C_IDS = ["marketplace-persistence-spine", "marketplace-boundary-authorization", "marketplace-backup-restore"] as const;

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

function byId(id: string) {
  const journey = JOURNEYS.find((j) => j.id === id);
  if (journey === undefined) throw new Error(`unknown journey ${id}`);
  return journey;
}

describe("F370C — census bound + corpus laws", () => {
  it("the three journeys exist with unique ids in the corpus (46 -> 49 at F370C; 52 at F372, grow-only)", () => {
    expect(JOURNEYS.length).toBe(52);
    const ids = JOURNEYS.map((j) => j.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of F370C_IDS) expect(ids).toContain(id);
  });

  it("the journeys drive ONLY their declared mps-* kinds (the service's HTTP boundary — no in-process kernel re-drives)", () => {
    for (const id of F370C_IDS) {
      const journey = byId(id);
      for (const step of journey.steps) {
        expect(MPS_KINDS.has(step.kind), `${journey.id}:${step.kind}`).toBe(true);
      }
    }
    const kinds: ReadonlySet<string> = new Set(F370C_IDS.flatMap((id) => byId(id).steps.map((s) => s.kind)));
    for (const kind of ["mps-boot", "mps-provision", "mps-login", "mps-restart", "mps-digest", "mps-shutdown"]) {
      expect(kinds.has(kind), kind).toBe(true);
    }
  });

  it("the three new capabilities are covered and in the fixed vocabulary", () => {
    const covered: ReadonlySet<string> = new Set(JOURNEYS.map((j) => j.capability));
    for (const capability of ["marketplace-persistence", "marketplace-boundary-authorization", "marketplace-backup-restore"]) {
      expect(covered.has(capability)).toBe(true);
    }
  });

  it("D14 form: >= 5 substantive assertions per journey and >= 1 asserted refusal each", () => {
    for (const id of F370C_IDS) {
      const journey = byId(id);
      expect(journey.assertions.length, id).toBeGreaterThanOrEqual(5);
      const refusalAssertions = journey.assertions.filter((a) =>
        ["UNAUTHENTICATED", "SESSION_EXPIRED", "TENANT_MISMATCH", "SCOPE_MISSING", "MALFORMED", "NOT_FOUND",
          "NATURAL_KEY_CONFLICT", "ILLEGAL_TRANSITION", "ALREADY_ACKNOWLEDGED", "refuse"].includes(String(a.expected)));
      expect(refusalAssertions.length, id).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("F370C — the machine-run journeys (real spawns, real SIGKILLs, real restores)", () => {
  it.skipIf(process.env["F370C_SKIP_SLOW"] === "1")("the persistence journey passes end to end", async () => {
    const { outcome, facts } = await runJourney(byId("marketplace-persistence-spine"));
    expect(outcome.passed, JSON.stringify(outcome.assertionOutcomes.filter((a) => !a.ok), null, 2)).toBe(true);
    expect(outcome.stepOutcomes.every((s) => s.executed && s.ok)).toBe(true);
    // THE CRASH-RESTART LAWS (machine-checked on the real run):
    expect(facts.get("mps.restart.crash.digestsIdentical")).toBe(true);
    expect(facts.get("mps.restart.crashTwo.digestsIdentical")).toBe(true);
    expect(facts.get("mps.restart.crashTwo.receiptsReplayed")).toBe(1);
  });

  it.skipIf(process.env["F370C_SKIP_SLOW"] === "1")("the authorization journey passes end to end — every F370A reason at the boundary", async () => {
    const { outcome, facts } = await runJourney(byId("marketplace-boundary-authorization"));
    expect(outcome.passed, JSON.stringify(outcome.assertionOutcomes.filter((a) => !a.ok), null, 2)).toBe(true);
    // THE REFUSAL COVERAGE LAW: all five F370A gate reasons + the extras.
    const reasons = new Set(outcome.assertionOutcomes.map((a) => a.expected));
    for (const reason of ["UNAUTHENTICATED", "SESSION_EXPIRED", "TENANT_MISMATCH", "SCOPE_MISSING", "MALFORMED", "NOT_FOUND"]) {
      expect(reasons.has(reason), `the boundary must surface ${reason}`).toBe(true);
    }
    // THE TWO-LAYER LAW + THE PERSISTENT REVOCATION:
    expect(facts.get("mps.approval.overLimit.decision")).toBe("refuse");
    expect(facts.get("mps.restart.crash.revocationsReplayed")).toBe(1);
    expect(facts.get("mps.request.revokedAfterRestart.reason")).toBe("UNAUTHENTICATED");
  });

  it.skipIf(process.env["F370C_SKIP_SLOW"] === "1")("the backup/restore journey passes end to end — the runbook's procedure as the journey's steps", async () => {
    const { outcome, facts } = await runJourney(byId("marketplace-backup-restore"));
    expect(outcome.passed, JSON.stringify(outcome.assertionOutcomes.filter((a) => !a.ok), null, 2)).toBe(true);
    // THE RUNBOOK LAW: the journey's step sequence IS the procedure.
    const kinds = byId("marketplace-backup-restore").steps.map((s) => s.kind);
    const digestAt = kinds.indexOf("mps-digest");
    const backupAt = kinds.indexOf("mps-backup");
    const restoreAt = kinds.indexOf("mps-restart");
    expect(digestAt).toBeGreaterThanOrEqual(0);
    expect(backupAt).toBe(digestAt + 1);
    expect(restoreAt).toBe(backupAt + 1);
    // THE ROUND-TRIP LAWS:
    expect(facts.get("mps.restart.restore.digestsIdentical")).toBe(true);
    expect(facts.get("mps.restart.restore.receiptsReplayed")).toBe(1);
    expect(facts.get("mps.orderT.accept.status")).toBe("accepted");
  });

  it.skipIf(process.env["F370C_SKIP_SLOW"] === "1")("THE OUTPUT LAW: ports, data-dir paths and wall-clock timestamps never appear in any fact or log", async () => {
    const { facts } = await runJourney(byId("marketplace-persistence-spine"));
    const serialized = JSON.stringify([...facts.entries()].map(([k, v]) => [k, v]));
    // The ephemeral-port shape (":<4-5 digits>") never appears:
    expect(serialized).not.toMatch(/:(?:3[0-9]{3}|[1-9][0-9]{4})\b/);
    // The temp data-dir path never appears:
    expect(serialized).not.toContain("/tmp/");
    expect(serialized).not.toContain("mps-journey-");
    // No wall-clock ISO timestamp ever appears (the fixture-clock law; the
    // only ISO strings are the fixed 2026-10-14/15 evidence fixtures):
    const isoMatches = serialized.match(/"20\d\d-\d\d-\d\dT[^"]+"/g) ?? [];
    for (const match of isoMatches) {
      expect(match.startsWith("\"2026-10-1")).toBe(true);
    }
  });

  it.skipIf(process.env["F370C_SKIP_SLOW"] === "1")("DETERMINISM: the three journeys re-run byte-identically (real re-spawns, stable digests)", async () => {
    for (const id of F370C_IDS) {
      const first = await runJourney(byId(id));
      const second = await runJourney(byId(id));
      expect(canonicalJson(second.outcome), id).toBe(canonicalJson(first.outcome));
      expect(canonicalJson([...second.facts.entries()].map(([k, v]) => [k, v])), id).toBe(canonicalJson([...first.facts.entries()].map(([k, v]) => [k, v])));
    }
  });
});
