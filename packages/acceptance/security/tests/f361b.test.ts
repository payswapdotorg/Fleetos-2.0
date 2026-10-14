/**
 * F361B tests — spot checks of the two Wave-17 lane B marketplace-trust
 * journeys (the F341A/F341B precedent: new journeys get their spot checks
 * in their own file; tests/journeys.test.ts stays untouched at its
 * existing size).
 *
 * Everything here re-runs the REAL journeys through the REAL runner and
 * pins the same facts the corpus assertions pin (focused re-assertion —
 * the machine-measured double-check, not new semantics).
 */

import { describe, expect, it } from "vitest";
import { runJourney } from "../src/runner.ts";
import { SECURITY_JOURNEYS } from "../src/journeys/index.ts";
import type { AcceptanceJourney } from "../src/journey-contracts.ts";

const byId = new Map(SECURITY_JOURNEYS.map((j) => [j.journeyId, j]));
function journey(id: string): AcceptanceJourney {
  const found = byId.get(id);
  if (found === undefined) throw new Error(`journey ${id} not found`);
  return found;
}

describe("F361B journey spot checks (REAL behaviors)", () => {
  it("approval: the within-limits order approves and the authority trace names the existing Guardian", () => {
    const { facts } = runJourney(journey("security.marketplace-order-approval-discipline"));
    expect(facts["approval.decision"]).toBe("approve");
    expect(facts["approval.reasonCode"]).toBe("approve.within_limits");
    expect(facts["approval.authoritySource"]).toBe("guardian.evaluateCapability");
    expect(facts["approval.limitCheckCount"]).toBe(8);
    expect(facts["approval.allLimitsPassed"]).toBe(true);
    expect(facts["approval.digestStable"]).toBe(true);
  });

  it("approval: the order walks the A4 protocol to authorized with the Guardian digest carried", () => {
    const { facts } = runJourney(journey("security.marketplace-order-approval-discipline"));
    expect(facts["propose.state"]).toBe("proposed");
    expect(facts["authorize.ok"]).toBe(true);
    expect(facts["authorize.state"]).toBe("authorized");
    expect(facts["authorize.guardianDigestCarried"]).toBe(true);
    expect(facts["authorize.transitionTrail"]).toEqual(["proposed->authorized"]);
  });

  it("approval: REFUSAL — over-limit refuses, never authorizes, and leaves the rejected trail", () => {
    const { facts } = runJourney(journey("security.marketplace-order-approval-discipline"));
    expect(facts["overLimit.decision"]).toBe("refuse");
    expect(facts["overLimit.reasonCode"]).toBe("refuse.amount_over_limit");
    expect(facts["overLimit.amountObserved"]).toBe("42000");
    expect(facts["overLimit.amountLimit"]).toBe("15000");
    expect(facts["overLimit.authorizeOk"]).toBe(false);
    expect(facts["overLimit.authorizeRefusalReason"]).toBe("refused.execute_without_authorization");
    expect(facts["overLimit.rejectedState"]).toBe("rejected");
  });

  it("approval: the advisory law holds — an approve-flavored advisory changes nothing", () => {
    const { facts } = runJourney(journey("security.marketplace-order-approval-discipline"));
    expect(facts["advisory.lawHolds"]).toBe(true);
    expect(facts["advisory.withDecision"]).toBe("refuse");
    expect(facts["advisory.withReason"]).toBe("refuse.amount_over_limit");
    expect(facts["advisory.digestIdentical"]).toBe(true);
    expect(facts["advisory.idIdentical"]).toBe(true);
    expect(facts["advisory.hasNoAuthorityField"]).toBe(true);
    expect(facts["advisory.keys"]).toEqual(["rationale", "recommendation", "source"]);
  });

  it("approval: REFUSAL — cross-tenant approval never authorizes the home record", () => {
    const { facts } = runJourney(journey("security.marketplace-order-approval-discipline"));
    expect(facts["crossTenant.decision"]).toBe("refuse");
    expect(facts["crossTenant.reasonCode"]).toBe("refuse.cross_tenant");
    expect(facts["crossTenant.guardianReason"]).toBe("block.cross_tenant");
    expect(facts["crossTenant.authorizeOk"]).toBe(false);
    expect(facts["crossTenant.authorizeRefusalReason"]).toBe("refused.tenant_mismatch");
    expect(facts["crossTenant.stateAfterForeignAttempt"]).toBe("proposed");
  });

  it("evidence: the four frozen kinds retain source + captured-at provenance", () => {
    const { facts } = runJourney(journey("security.marketplace-evidence-dedup-discipline"));
    expect(facts["retain.allOk"]).toBe(true);
    expect(facts["retain.kinds"]).toEqual([
      "marketplace.offer-snapshot",
      "marketplace.provider-ack",
      "marketplace.fulfilment",
      "marketplace.receipt",
    ]);
    expect(facts["retain.count"]).toBe(4);
    expect(facts["retain.idPrefix"]).toBe("mpe-");
    expect(facts["retain.sourceSystem"]).toBe("manual-catalogue-import");
    expect(facts["retain.capturedAt"]).toBe("2026-10-12T18:40:00.000Z");
    expect(facts["retain.recordedAt"]).toBe("2026-10-12T18:45:00.000Z");
    expect(facts["retain.digestLength"]).toBe(64);
  });

  it("evidence: REFUSAL — duplicate provider events return the ORIGINAL record, never a second conclusion", () => {
    const { facts } = runJourney(journey("security.marketplace-evidence-dedup-discipline"));
    expect(facts["dup.samePayloadDuplicate"]).toBe(true);
    expect(facts["dup.samePayloadEvidenceId"]).toBe("mpe-54dd60a363c8");
    expect(facts["dup.samePayloadRecordedAt"]).toBe("2026-10-12T18:45:00.000Z");
    expect(facts["dup.divergentDuplicate"]).toBe(true);
    expect(facts["dup.divergentFlagged"]).toBe(true);
    expect(facts["dup.divergentReturnsOriginalId"]).toBe("mpe-54dd60a363c8");
    expect(facts["dup.divergentReturnsOriginalDigest"]).toBe(
      "54dd60a363c8927a541fce99aec8738c41cda9dc74b677d277c2fcef0feedf6f",
    );
    expect(facts["dup.divergentOriginalCapturedAt"]).toBe("2026-10-12T18:40:00.000Z");
    expect(facts["dup.storeNeverGrew"]).toBe(true);
  });

  it("evidence: REFUSAL — tenant fail-closed reads, writes, and dedup isolation", () => {
    const { facts } = runJourney(journey("security.marketplace-evidence-dedup-discipline"));
    expect(facts["tenant.foreignReadIsNull"]).toBe(true);
    expect(facts["tenant.foreignFindByEventIsNull"]).toBe(true);
    expect(facts["tenant.foreignListEmpty"]).toEqual([]);
    expect(facts["tenant.foreignWriteOk"]).toBe(false);
    expect(facts["tenant.foreignWriteReason"]).toBe("refused.tenant_mismatch");
    expect(facts["tenant.storeUnchangedAfterForeignWrite"]).toBe(true);
    expect(facts["tenant.foreignEventDuplicate"]).toBe(false);
    expect(facts["tenant.foreignEventOwnRecord"]).toBe("globex-rival");
    expect(facts["tenant.countAfterForeignEvent"]).toBe(5);
  });

  it("evidence: REFUSAL — untrusted future-dated intake and honest freshness classes", () => {
    const { facts } = runJourney(journey("security.marketplace-evidence-dedup-discipline"));
    expect(facts["intake.futureCaptureOk"]).toBe(false);
    expect(facts["intake.futureCaptureReason"]).toBe("refused.captured_at_in_future");
    expect(facts["intake.missingCaptureOk"]).toBe(false);
    expect(facts["intake.missingCaptureReason"]).toBe("refused.missing_captured_at");
    expect(facts["fresh.offerClass"]).toBe("fresh");
    expect(facts["fresh.offerAgeMs"]).toBe(300_000);
    expect(facts["fresh.staleClass"]).toBe("stale");
  });
});
