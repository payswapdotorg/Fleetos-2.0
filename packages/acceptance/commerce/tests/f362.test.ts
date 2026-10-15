/**
 * F362 (Wave 17, the TL-delegated E2E lane) machine battery — the
 * deterministic transaction-spine journey:
 *   1. CENSUS BOUND: the journey drives its own NEW spn-* kinds (the
 *      F361B approval/evidence + F361A receipt/enrollment surfaces, zero
 *      commerce coverage at base d714616) COMPOSED verbatim over the
 *      census-certified F361C chain kinds — no other surface.
 *   2. D14 SEGMENT FORM: >=5 substantive assertions per segment incl.
 *      >=1 asserted refusal at EVERY gate.
 *   3. DETERMINISM: same-journey re-runs byte-identical; the FULL
 *      46-journey corpus re-runs byte-identically (grow-only).
 *   4. D13 INVARIANCE: the journey carries NO epoch tables and is
 *      invariant across the census offsets (single-epoch T0).
 *   5. DEEP FACTS: the idempotency semantics on every seam (the
 *      natural-key replay, the provider-ack replay on BOTH sides, the
 *      receipt re-record), THE FRESHNESS LAW, the verified-only gate, the
 *      plainly-labelled catalogue seam, the advisory-never-authorizes
 *      law, the duplicate-serial guard, the twin link, the cross-lane
 *      composition bindings, the fail-closed foreign reads, and the
 *      spine log verbatim.
 */

import { describe, expect, it } from "vitest";
import { JOURNEYS } from "../src/journeys/index.js";
import { runJourney, runAllJourneys } from "../src/runner.js";
import { COMMERCE_T0 } from "../src/journey-world.js";
import { canonicalJson } from "../src/journey-contracts.js";

const F362_ID = "marketplace-transaction-spine" as const;

const SPINE_STEP_KINDS = new Set([
  // The composed F361C chain (verbatim, census-certified at F361C).
  "mreq-submit", "mreq-transition", "mreq-read", "mreq-board",
  "moff-capture", "moff-sheet", "moff-compare",
  "mver-open", "mver-verify", "mver-gate", "mver-catalogue-import",
  "mord-draft", "mord-place", "mord-ack", "mord-transition", "mord-read", "mord-board",
  // The NEW F362 surfaces (the F361B + F361A public entry points).
  "spn-evidence-retain", "spn-evidence-read", "spn-guardian-approval",
  "spn-receipt-record", "spn-receipt-verify", "spn-receipt-read",
  "spn-enrollment-open", "spn-enrollment-complete", "spn-enrollment-read",
  "spn-registry-read",
]);

/** The D14 segment accounting: assertion-id ranges per packet §2 segment. */
const SEGMENTS: readonly { readonly name: string; readonly ids: readonly string[] }[] = [
  { name: "real need (F361C request contract)", ids: ["sp1", "sp2", "sp3", "sp4", "sp5", "sp6", "sp7", "sp8", "sp9", "sp10", "sp11", "sp12"] },
  { name: "seeded supplier catalogue (verified suppliers, plainly-labelled manual import)", ids: ["sp13", "sp14", "sp15", "sp16", "sp17", "sp18", "sp19", "sp20", "sp21"] },
  { name: "two offers (F361C offer schema, freshness law asserted)", ids: ["sp22", "sp23", "sp24", "sp25", "sp26", "sp27", "sp28", "sp29", "sp30"] },
  { name: "explainable comparison (hard constraints vs preference weights)", ids: ["sp31", "sp32", "sp33", "sp34", "sp35", "sp36", "sp37", "sp38", "sp39", "sp40"] },
  { name: "Guardian approval (F361B approval contract, advisory-never-authorizes)", ids: ["sp41", "sp42", "sp43", "sp44", "sp45", "sp46", "sp47", "sp48", "sp49", "sp50", "sp51", "sp52", "sp53", "sp54", "sp55", "sp56", "sp57", "sp58", "sp59", "sp60", "sp61", "sp62", "sp63", "sp64"] },
  { name: "order placement + manual provider-ack seam (idempotent, dedup-refusing)", ids: ["sp65", "sp66", "sp67", "sp68", "sp69", "sp70", "sp71", "sp72", "sp73", "sp74", "sp75", "sp76", "sp77", "sp78", "sp79", "sp80", "sp81", "sp82", "sp83", "sp84", "sp85", "sp86", "sp87"] },
  { name: "receipt evidence (F361A ReceiptEvidence)", ids: ["sp88", "sp89", "sp90", "sp91", "sp92", "sp93", "sp94"] },
  { name: "asset enrollment (F361A duplicate guard; the authoritative record)", ids: ["sp95", "sp96", "sp97", "sp98", "sp99", "sp100", "sp101", "sp102", "sp103", "sp104", "sp105", "sp106", "sp107", "sp108", "sp109", "sp110"] },
  { name: "the honest closure of both state machines", ids: ["sp111", "sp112", "sp113", "sp114", "sp115", "sp116"] },
];

const CENSUS_OFFSETS = [-3_600_000, 1_000, 3_600_000, 86_400_000, 2_592_000_000, 7_776_000_000, 31_536_000_000] as const;

function byId(id: string) {
  const journey = JOURNEYS.find((j) => j.id === id);
  if (journey === undefined) throw new Error(`unknown journey ${id}`);
  return journey;
}

describe("F362 — census bound + corpus laws", () => {
  it("the journey exists with a unique id in the corpus (45 -> 46, grow-only)", () => {
    expect(JOURNEYS.length).toBe(49);
    const ids = JOURNEYS.map((j) => j.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(F362_ID);
  });

  it("the journey drives ONLY its declared kinds (the composed F361C chain + the NEW spn-* spine surface)", () => {
    const journey = byId(F362_ID);
    for (const step of journey.steps) {
      expect(SPINE_STEP_KINDS.has(step.kind), `${journey.id}:${step.kind}`).toBe(true);
    }
    // The NEW surface is genuinely present (the composition is real).
    const kinds = new Set<string>(journey.steps.map((s) => s.kind));
    for (const kind of ["spn-evidence-retain", "spn-guardian-approval", "spn-receipt-record", "spn-enrollment-open", "spn-registry-read"]) {
      expect(kinds.has(kind), kind).toBe(true);
    }
  });

  it("carries >= 5 substantive assertions per segment incl. >= 1 asserted refusal at EVERY gate (D14)", () => {
    const journey = byId(F362_ID);
    const byIdMap = new Map(journey.assertions.map((a) => [a.id, a]));
    for (const segment of SEGMENTS) {
      const rows = segment.ids.map((id) => byIdMap.get(id)).filter((a) => a !== undefined);
      expect(rows.length, segment.name).toBe(segment.ids.length);
      expect(rows.length, segment.name).toBeGreaterThanOrEqual(5);
      const refusals = rows.filter((a) => a.description.startsWith("REFUSAL"));
      expect(refusals.length, segment.name).toBeGreaterThanOrEqual(1);
    }
    expect(journey.assertions.length).toBe(116);
  });

  it("carries NO epoch tables (D13 — single-epoch T0 by construction)", () => {
    const tables = byId(F362_ID).assertions.filter((a) => a.expectedByEpoch !== undefined);
    expect(tables.length).toBe(0);
  });

  it("passes end to end", async () => {
    const { outcome } = await runJourney(byId(F362_ID));
    expect(outcome.passed).toBe(true);
    expect(outcome.stepOutcomes.every((s) => s.executed && s.ok)).toBe(true);
    expect(outcome.assertionOutcomes.every((a) => a.ok)).toBe(true);
  });

  it("same-journey re-runs are byte-identical (D14 determinism)", async () => {
    const first = await runJourney(byId(F362_ID));
    const second = await runJourney(byId(F362_ID));
    expect(second.outcome.digest).toBe(first.outcome.digest);
    expect(canonicalJson(second.facts)).toBe(canonicalJson(first.facts));
  });

  it("the FULL 46-journey corpus re-runs byte-identically (grow-only — nothing pre-existing disturbed)", async () => {
    const first = await runAllJourneys(JOURNEYS);
    const second = await runAllJourneys(JOURNEYS);
    expect(canonicalJson(second)).toBe(canonicalJson(first));
    expect(first.every((o) => o.passed)).toBe(true);
    expect(first.length).toBe(49);
  });

  it("D13 INVARIANCE: the journey is invariant at every census offset (no epoch ever counts)", async () => {
    for (const delta of CENSUS_OFFSETS) {
      const { outcome } = await runJourney(byId(F362_ID), { startedAt: COMMERCE_T0 + delta });
      expect(outcome.passed, `@ ${delta}ms`).toBe(true);
      expect(outcome.assertionOutcomes.some((a) => a.expected === "__missing-epoch__")).toBe(false);
    }
  });
});

describe("F362 — the deep-fact pins (idempotency + freshness + the guards + the bindings)", () => {
  it("the natural-key replay is idempotent and the drifted content refuses (the need gate)", async () => {
    const { facts } = await runJourney(byId(F362_ID));
    expect(facts.get("mreq.submit.replay.duplicate")).toBe(true);
    expect(facts.get("mreq.submit.replay.requestId")).toBe("req-spine-001");
    expect(facts.get("mreq.submit.replay.population")).toBe(1);
    expect(facts.get("mreq.submit.conflict.reasonCode")).toBe("NATURAL_KEY_CONFLICT");
    expect(facts.get("mreq.transition.earlyOrder.reasonCode")).toBe("ILLEGAL_TRANSITION");
  });

  it("THE FRESHNESS LAW: fresh while the window is open; after the lapse the comparison refuses and the sheet is EMPTY", async () => {
    const { facts } = await runJourney(byId(F362_ID));
    expect(facts.get("moff.sheet.whileOpen.freshCount")).toBe(2);
    expect(facts.get("moff.compare.postLapse.reasonCode")).toBe("NO_ELIGIBLE_OFFERS");
    expect(facts.get("moff.compare.postLapse.rationaleCount")).toBe(2);
    expect(facts.get("moff.sheet.postLapse.freshCount")).toBe(0);
    expect(facts.get("moff.sheet.postLapse.excluded")).toEqual(["off-spine-a:expired", "off-spine-b:expired"]);
  });

  it("the verified-only gate excludes the pending supplier and the catalogue seam is PLAINLY LABELLED", async () => {
    const { facts } = await runJourney(byId(F362_ID));
    expect(facts.get("mver.gate.spine.excluded")).toEqual(["sup-gamma:SUPPLIER_PENDING"]);
    const label = facts.get("mver.catalogue.spine.label");
    expect(typeof label === "string" && label.includes("NOT a live supplier API")).toBe(true);
    expect(facts.get("mver.catalogue.spine.entryCount")).toBe(2);
  });

  it("the Guardian approval: the advisory NEVER authorizes and the over-limit/missing-human-approval refusals hold", async () => {
    const { facts } = await runJourney(byId(F362_ID));
    expect(facts.get("spn.approval.inLimits.decision")).toBe("approve");
    expect(facts.get("spn.approval.inLimits.reason")).toBe("approve.within_limits");
    expect(facts.get("spn.approval.inLimits.authoritySource")).toBe("guardian.evaluateCapability");
    expect(facts.get("spn.approval.inLimits.limitCheckCount")).toBe(8);
    expect(facts.get("spn.approval.overLimit.reason")).toBe("refuse.amount_over_limit");
    expect(facts.get("spn.approval.noHumanApproval.reason")).toBe("refuse.actor_missing_human_approval");
    expect(facts.get("spn.approval.advisory.lawHolds")).toBe(true);
    expect(facts.get("spn.approval.advisory.overLimitWithAdvisoryDecision")).toBe("refuse");
    expect(facts.get("spn.approval.advisory.digestIdentical")).toBe(true);
  });

  it("the CROSS-LANE composition bindings are machine-proved (the frozen TYPE seams)", async () => {
    const { facts } = await runJourney(byId(F362_ID));
    // The approval's offerSnapshotRef IS the retained snapshot's evidence id.
    expect(facts.get("spn.approval.inLimits.offerSnapshotRef")).toBe(facts.get("spn.evidence.snapshot.evidenceId"));
    // The approval's verificationRef IS the §3.3 verification evidence id.
    expect(facts.get("spn.approval.inLimits.verificationRef")).toBe("verify-sup-beta-2026");
    expect(facts.get("mver.verify.beta.evidenceId")).toBe("verify-sup-beta-2026");
    // The order-side ack cites the SAME reference as the retained provider-ack evidence.
    expect(facts.get("mord.ack.ack.evidenceId")).toBe(facts.get("spn.evidence.providerAck.sourceReference"));
    // The receipt names the supplier order; the enrollment names the receipt.
    expect(facts.get("spn.receipt.main.supplierOrderRef")).toBe("ord-spine-001");
    expect(facts.get("spn.enrollOpen.open.receiptEvidenceRef")).toBe("rcpt-spine-001");
  });

  it("the provider-ack seam is idempotent and dedup-refusing on BOTH sides", async () => {
    const { facts } = await runJourney(byId(F362_ID));
    expect(facts.get("mord.ack.replay.duplicate")).toBe(true);
    expect(facts.get("mord.ack.replay.evidenceId")).toBe("inv-spine-001");
    expect(facts.get("mord.ack.differentEvent.reasonCode")).toBe("ALREADY_ACKNOWLEDGED");
    expect(facts.get("spn.evidence.ackReplay.duplicate")).toBe(true);
    expect(facts.get("spn.evidence.ackDivergent.divergent")).toBe(true);
    expect(facts.get("spn.evidence.ackReplay.storeSize")).toBe(2);
    expect(facts.get("spn.evidence.ackDivergent.storeSize")).toBe(2);
    expect(facts.get("spn.evidence.futureDated.reasonCode")).toBe("refused.captured_at_in_future");
  });

  it("the receipt machine is append-only and the enrollment duplicate guard holds (the authoritative record)", async () => {
    const { facts } = await runJourney(byId(F362_ID));
    expect(facts.get("spn.receipt.replay.duplicate")).toBe(true);
    expect(facts.get("spn.verify.main.state")).toBe("verified");
    expect(facts.get("spn.verify.redecide.reasonCode")).toBe("illegal-transition");
    expect(facts.get("spn.enrollOpen.duplicate.duplicate")).toBe(true);
    expect(facts.get("spn.enrollOpen.duplicate.enrollmentId")).toBe("enr_acme_SN-LT5540-0001");
    expect(facts.get("spn.enrollOpen.conflict.reasonCode")).toBe("serial-tag-conflict");
    expect(facts.get("spn.registry.own.count")).toBe(1);
    expect(facts.get("spn.registry.own.lifecycle")).toBe("active");
    expect(facts.get("spn.enrollComplete.complete.twinLinked")).toBe(true);
  });

  it("the fail-closed foreign reads see NOTHING on every surface", async () => {
    const { facts } = await runJourney(byId(F362_ID));
    expect(facts.get("mreq.read.foreign.found")).toBe(false);
    expect(facts.get("mord.read.foreign.found")).toBe(false);
    expect(facts.get("spn.evidenceRead.foreign.found")).toBe(false);
    expect(facts.get("spn.receiptRead.foreign.found")).toBe(false);
    expect(facts.get("spn.enrollRead.foreign.found")).toBe(false);
    expect(facts.get("spn.registry.foreign.count")).toBe(0);
  });

  it("the spine log carries every retain, verdict, refusal and read in order (verbatim)", async () => {
    const { facts } = await runJourney(byId(F362_ID));
    const log = facts.get("spn.log");
    expect(log).toBeDefined();
    const entries = log as readonly string[];
    expect(entries.length).toBe(27);
    expect(entries[0]).toContain("evidence:offer-snapshot:prov-snap-off-spine-b:retained:");
    expect(entries[1]).toContain("approval:in-limits:approve:approve.within_limits:");
    expect(entries[2]).toBe("approval:over-limit:refuse:refuse.amount_over_limit");
    expect(entries[3]).toBe("approval:missing-human-approval:refuse:refuse.actor_missing_human_approval");
    expect(entries[10]).toContain("evidence-read:own:provider-ack:");
    expect(entries[11]).toBe("evidence-read:foreign:provider-ack:null");
    expect(entries[22]).toBe("enroll-open:rcpt-spine-002:refused:serial-tag-conflict");
    expect(entries[23]).toBe("registry:own:1:active");
    expect(entries[24]).toBe("registry:foreign:0:null");
  });
});
