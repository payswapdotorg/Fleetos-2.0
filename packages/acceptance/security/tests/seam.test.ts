/**
 * F331B seam tests — the `startedAt`-class time seam on the security runner.
 *
 * The seam's ZERO-BEHAVIOR-CHANGE law, machine-proven:
 *
 *   1. BASE_CORPUS_DIGESTS below are the 27 journey digests harvested from
 *      the BASE tree (`e2103c6`, pre-seam) by running the corpus in its
 *      default mode. Every post-seam default run must reproduce them
 *      EXACTLY — byte-identical outcomes, the same digests, the same pass
 *      vector — for every journey, before and after any journey consumes
 *      the anchor. This is the proof the seam changes nothing at the
 *      corpus's own anchor.
 *   2. An explicit `startedAt: SECURITY_CORPUS_T0` equals the implicit
 *      default (same digests) — the seam parameter itself is inert at the
 *      default anchor.
 *   3. Same-anchor re-runs stay byte-identical (D2(c) discipline): two
 *      runs at ANY fixed anchor produce identical digests, including at
 *      anchors far from the fixture clock.
 *   4. The anchor genuinely flows: a probe step reading `ctx.startedAt`
 *      records the caller-supplied value verbatim (fail-loud if a journey
 *      cannot observe the seam).
 */

import { describe, expect, it } from "vitest";
import { runJourney, runAllJourneys } from "../src/runner.ts";
import { SECURITY_JOURNEYS } from "../src/journeys/index.ts";
import { SECURITY_CORPUS_T0 } from "../src/journeys/fixture-world.ts";
import type { AcceptanceJourney, JourneyStepContext } from "../src/journey-contracts.ts";

/** The pre-seam base-tree corpus digests (harvested at `e2103c6`), plus the
 *  two F341B remainder journeys' digests harvested on the F341B lane tree
 *  (they did not exist at the base — grow-only: the 27 base entries are
 *  byte-identical and untouched). */
export const BASE_CORPUS_DIGESTS = [
  { journeyId: "security.investigate-finding", digest: "297ba68f", pass: true },
  { journeyId: "security.understand-evidence", digest: "78f52574", pass: true },
  { journeyId: "security.guardian-decision", digest: "372f6517", pass: true },
  { journeyId: "security.action-plan", digest: "43d11beb", pass: true },
  { journeyId: "security.execution-ledger", digest: "f639b189", pass: true },
  { journeyId: "security.reasoning-context", digest: "acf29c19", pass: true },
  { journeyId: "security.predictive-advice", digest: "463803d3", pass: true },
  { journeyId: "security.counterfactual-reasoning", digest: "3a2dedcc", pass: true },
  { journeyId: "security.inspect-why", digest: "330f21f4", pass: true },
  { journeyId: "security.learn-from-outcomes", digest: "cf9d6195", pass: true },
  { journeyId: "security.benchmark-trust", digest: "b9e37049", pass: true },
  { journeyId: "security.agent-safety", digest: "6b52c184", pass: true },
  { journeyId: "security.tenant-fail-closed", digest: "10dd2f12", pass: true },
  { journeyId: "security.guardian-e2e", digest: "0d8ea35e", pass: true },
  { journeyId: "security.mission-replay", digest: "4563d972", pass: true },
  { journeyId: "security.predictive-honesty", digest: "048d0ead", pass: true },
  { journeyId: "security.host-surface", digest: "331ba29c", pass: true },
  { journeyId: "security.tamper-evident-audit-ledger", digest: "d82d209b", pass: true },
  { journeyId: "security.finding-storm-triage", digest: "2f2f8c71", pass: true },
  { journeyId: "security.finding-suppression-lifecycle", digest: "dbd95a18", pass: true },
  { journeyId: "security.verified-execution-dispatch", digest: "09f51b09", pass: true },
  { journeyId: "security.action-compensation-rollback", digest: "f680160e", pass: true },
  { journeyId: "security.capability-store-dr", digest: "d1d4a531", pass: true },
  { journeyId: "security.outcome-evaluation-adoption", digest: "95fa40e6", pass: true },
  { journeyId: "security.jepa-family-honesty", digest: "3f3e9084", pass: true },
  { journeyId: "security.degradation-staleness-honesty", digest: "6853a7d8", pass: true },
  { journeyId: "security.posture-fold-determinism", digest: "db47a8a3", pass: true },
  // ---- F341B additions (harvested on the F341B lane tree, grow-only) ----
  { journeyId: "security.evidence-artifact-store-completeness", digest: "43f7fa34", pass: true },
  { journeyId: "security.world-context-windowing", digest: "e1792e6d", pass: true },
  // ---- F361B additions (harvested on the F361B lane tree, grow-only) ----
  { journeyId: "security.marketplace-order-approval-discipline", digest: "061289bb", pass: true },
  { journeyId: "security.marketplace-evidence-dedup-discipline", digest: "609cb56c", pass: true },
  // ---- F370A additions (harvested on the F370A lane tree, grow-only;
  //      the 31 prior entries are byte-identical and untouched) ----
  { journeyId: "security.authenticated-marketplace-credentials", digest: "463943ee", pass: true },
  { journeyId: "security.authenticated-marketplace-sessions", digest: "2809145b", pass: true },
  { journeyId: "security.authenticated-marketplace-request-order", digest: "3b2ead03", pass: true },
  { journeyId: "security.authenticated-marketplace-receipt-enrollment", digest: "5c25d946", pass: true },
  { journeyId: "security.authenticated-marketplace-approval", digest: "cc82587e", pass: true },
] as const;

describe("F331B — the startedAt time seam (zero behavior change at the corpus anchor)", () => {
  it("the default run reproduces the pre-seam base-tree digests byte-for-byte", () => {
    expect(SECURITY_JOURNEYS.length).toBe(BASE_CORPUS_DIGESTS.length);
    for (const base of BASE_CORPUS_DIGESTS) {
      const journey = SECURITY_JOURNEYS.find((j) => j.journeyId === base.journeyId);
      expect(journey, `journey ${base.journeyId} missing from the corpus`).toBeDefined();
      const { outcome } = runJourney(journey as AcceptanceJourney);
      expect(outcome.digest, `${base.journeyId} digest moved`).toBe(base.digest);
      expect(outcome.pass, `${base.journeyId} pass moved`).toBe(base.pass);
    }
  });

  it("an explicit SECURITY_CORPUS_T0 anchor equals the implicit default", () => {
    for (const j of SECURITY_JOURNEYS) {
      const implicit = runJourney(j).outcome;
      const explicit = runJourney(j, { startedAt: SECURITY_CORPUS_T0 }).outcome;
      expect(implicit.digest).toBe(explicit.digest);
    }
  });

  it("same-anchor re-runs are byte-identical at any anchor (D2(c) discipline)", () => {
    const anchors = [SECURITY_CORPUS_T0, 1_774_000_000_000, 1_774_000_000_000 + 2_592_000_000];
    for (const anchor of anchors) {
      for (const j of SECURITY_JOURNEYS) {
        const first = runJourney(j, { startedAt: anchor }).outcome;
        const second = runJourney(j, { startedAt: anchor }).outcome;
        expect(first.digest, `${j.journeyId} at anchor ${anchor}`).toBe(second.digest);
      }
    }
  });

  it("the anchor flows verbatim into the step context (the seam is real)", () => {
    const probes = [SECURITY_CORPUS_T0, 1_774_000_000_000, 1_774_000_000_000 + 7_776_000_000];
    for (const anchor of probes) {
      const probe: AcceptanceJourney = {
        journeyId: "security.seam-probe",
        persona: "security-analyst",
        capabilities: ["tenant-isolation"],
        goal: "Observe the run anchor on the step context",
        steps: [
          {
            stepId: "probe",
            kind: "view-read",
            description: "Record the run's logical anchor verbatim",
            packages: [],
            operations: [],
            run: (ctx: JourneyStepContext) => {
              ctx.record("probe.startedAt", ctx.startedAt);
            },
          },
        ],
        assertions: [{ assertionId: "probe-1", description: "The anchor flows verbatim", path: "probe.startedAt", expected: anchor }],
      };
      const { outcome } = runJourney(probe, { startedAt: anchor });
      expect(outcome.pass).toBe(true);
      expect(outcome.assertions[0]?.actual).toBe(anchor);
    }
  });

  it("runAllJourneys threads the anchor across the corpus (inert at the default)", () => {
    const defaults = runAllJourneys(SECURITY_JOURNEYS);
    const explicit = runAllJourneys(SECURITY_JOURNEYS, { startedAt: SECURITY_CORPUS_T0 });
    expect(defaults.map((o) => o.digest)).toEqual(explicit.map((o) => o.digest));
    expect(defaults.every((o) => o.pass)).toBe(true);
  });
});
