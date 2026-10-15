/**
 * F370A tests — spot checks of the five Wave-18 lane A authenticated-
 * marketplace journeys (the F341B/F361B precedent: new journeys get
 * their spot checks in their own file; tests/journeys.test.ts stays at
 * its existing size and grows only through its it.each auto-growth).
 *
 * Everything here re-runs the REAL journeys through the REAL runner and
 * pins the same facts the corpus assertions pin (focused re-assertion —
 * the machine-measured double-check, not new semantics), plus the two
 * F370A-specific machine laws:
 *   - the GATE-COVERAGE law: across the five journeys, EVERY frozen gate
 *     reason (UNAUTHENTICATED / SESSION_EXPIRED / TENANT_MISMATCH /
 *     SCOPE_MISSING / MALFORMED) is asserted at least once;
 *   - the ENUMERATION-RESISTANCE law over the credential verdicts.
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

const F370A_IDS = [
  "security.authenticated-marketplace-credentials",
  "security.authenticated-marketplace-sessions",
  "security.authenticated-marketplace-request-order",
  "security.authenticated-marketplace-receipt-enrollment",
  "security.authenticated-marketplace-approval",
] as const;

describe("F370A journey spot checks (REAL behaviors)", () => {
  it("credentials: the frozen record, deterministic digest, plaintext never stored", () => {
    const { facts } = runJourney(journey("security.authenticated-marketplace-credentials"));
    expect(facts["cre.issue.ok"]).toBe(true);
    expect(facts["cre.issue.digestHexLength"]).toBe(64);
    expect(facts["cre.issue.paramCostN"]).toBe(16384);
    expect(facts["cre.issue.deterministic"]).toBe(true);
    expect(facts["cre.issue.plaintextNeverStored"]).toBe(true);
    expect(facts["cre.issue.frozenParams"]).toBe(true);
  });

  it("credentials: REFUSAL — the enumeration-resistance law holds byte-identically", () => {
    const { facts } = runJourney(journey("security.authenticated-marketplace-credentials"));
    expect(facts["cre.refusal.wrongSecret"]).toBe("INVALID_CREDENTIAL");
    expect(facts["cre.refusal.unknownActor"]).toBe("INVALID_CREDENTIAL");
    expect(facts["cre.refusal.malformedRecord"]).toBe("INVALID_CREDENTIAL");
    expect(facts["cre.refusal.unknownEqualsWrong"]).toBe(true);
    expect(facts["cre.refusal.malformedEqualsWrong"]).toBe(true);
    expect(facts["cre.refusal.singleReasonVocabulary"]).toBe(true);
  });

  it("sessions: the tamper / wrong-key / expiry / malformed refusal laws", () => {
    const { facts } = runJourney(journey("security.authenticated-marketplace-sessions"));
    expect(facts["ses.tamper.claimMutation"]).toBe("SIGNATURE_INVALID");
    expect(facts["ses.tamper.flippedSignature"]).toBe("SIGNATURE_INVALID");
    expect(facts["ses.refusal.wrongKey"]).toBe("SIGNATURE_INVALID");
    expect(facts["ses.refusal.expired"]).toBe("SESSION_EXPIRED");
    expect(facts["ses.malformed.allOneReason"]).toBe(true);
    expect(facts["ses.malformed.nullToken"]).toBe("MALFORMED_TOKEN");
    expect(facts["ses.verify.boundaryInclusive"]).toBe(true);
    expect(facts["ses.refusal.wrongKeyEqualsTamper"]).toBe(true);
  });

  it("request/order: the authorized chain + a refusal at every gate reason", () => {
    const { facts } = runJourney(journey("security.authenticated-marketplace-request-order"));
    expect(facts["ama.request.status"]).toBe("submitted");
    expect(facts["ama.request.replayDuplicate"]).toBe(true);
    expect(facts["ama.comparison.eligible"]).toBe(1);
    expect(facts["ama.order.placedStatus"]).toBe("placed");
    expect(facts["ama.ack.status"]).toBe("acknowledged");
    expect(facts["ama.request.unauthenticated"]).toBe("UNAUTHENTICATED");
    expect(facts["ama.request.expired"]).toBe("SESSION_EXPIRED");
    expect(facts["ama.request.malformedScope"]).toBe("MALFORMED");
    expect(facts["ama.offer.scopeMissing"]).toBe("SCOPE_MISSING");
    expect(facts["ama.offer.tenantMismatch"]).toBe("TENANT_MISMATCH");
    expect(facts["ama.ack.unauthenticated"]).toBe("UNAUTHENTICATED");
  });

  it("request/order: the domain refusal propagates VERBATIM through the gate", () => {
    const { facts } = runJourney(journey("security.authenticated-marketplace-request-order"));
    expect(facts["ama.order.domainRefusedBy"]).toBe("domain");
    expect(facts["ama.order.domainReasonCode"]).toBe("TOTAL_MISMATCH");
  });

  it("receipt/enrollment: the authenticated F361A chain + gate refusals at every position", () => {
    const { facts } = runJourney(journey("security.authenticated-marketplace-receipt-enrollment"));
    expect(facts["ama.receipt.recordState"]).toBe("recorded");
    expect(facts["ama.receipt.verifyState"]).toBe("verified");
    expect(facts["ama.enroll.openState"]).toBe("candidate");
    expect(facts["ama.enroll.completeState"]).toBe("enrolled");
    expect(facts["ama.enroll.enrollmentId"]).toBe("enr_acme-ops_SN-AMA-J4-0001");
    expect(facts["ama.receipt.unauthenticatedRecord"]).toBe("UNAUTHENTICATED");
    expect(facts["ama.receipt.storeUntouched"]).toBe(true);
    expect(facts["ama.receipt.expiredVerify"]).toBe("SESSION_EXPIRED");
    expect(facts["ama.enroll.scopeMissing"]).toBe("SCOPE_MISSING");
    expect(facts["ama.enroll.tenantMismatch"]).toBe("TENANT_MISMATCH");
    expect(facts["ama.enroll.unauthenticatedComplete"]).toBe("UNAUTHENTICATED");
    expect(facts["ama.enroll.completedBeforeRefusals"]).toBe("enrolled");
  });

  it("approval: the two-layer law — the gate authorizes, the Guardian still refuses over-limit", () => {
    const { facts } = runJourney(journey("security.authenticated-marketplace-approval"));
    expect(facts["ama.approval.decision"]).toBe("approve");
    expect(facts["ama.approval.reasonCode"]).toBe("approve.within_limits");
    expect(facts["ama.approval.authoritySource"]).toBe("guardian.evaluateCapability");
    expect(facts["ama.approval.limitChecks"]).toBe(8);
    expect(facts["ama.overLimit.gateAuthorized"]).toBe(true);
    expect(facts["ama.overLimit.decision"]).toBe("refuse");
    expect(facts["ama.overLimit.reasonCode"]).toBe("refuse.amount_over_limit");
    expect(facts["ama.overLimit.amountObserved"]).toBe("42000");
  });

  it("approval: the gate refusals at the approval verb", () => {
    const { facts } = runJourney(journey("security.authenticated-marketplace-approval"));
    expect(facts["ama.approval.unauthenticated"]).toBe("UNAUTHENTICATED");
    expect(facts["ama.approval.expired"]).toBe("SESSION_EXPIRED");
    expect(facts["ama.approval.scopeMissing"]).toBe("SCOPE_MISSING");
    expect(facts["ama.approval.tenantMismatch"]).toBe("TENANT_MISMATCH");
  });

  it("the GATE-COVERAGE law: every frozen gate reason is asserted across the battery", () => {
    const allFacts = F370A_IDS.map((id) => runJourney(journey(id)).facts);
    const values = JSON.stringify(allFacts);
    for (const reason of ["UNAUTHENTICATED", "SESSION_EXPIRED", "TENANT_MISMATCH", "SCOPE_MISSING", "MALFORMED"]) {
      expect(values.includes(`"${reason}"`), `gate reason ${reason} never asserted`).toBe(true);
    }
  });

  it("all five F370A journeys pass their full assertion chains", () => {
    for (const id of F370A_IDS) {
      const { outcome } = runJourney(journey(id));
      expect(outcome.pass, `${id} does not pass`).toBe(true);
      expect(outcome.failedAssertionCount).toBe(0);
      expect(outcome.passedStepCount).toBe(journey(id).steps.length);
    }
  });

  it("the five journeys assert at least the D14 floor (>=5 assertions, >=1 refusal each)", () => {
    for (const id of F370A_IDS) {
      const j = journey(id);
      expect(j.assertions.length, `${id} below the D14 floor`).toBeGreaterThanOrEqual(5);
      const refusalAssertions = j.assertions.filter((a) => a.description.startsWith("REFUSAL") || a.description.includes("REFUSAL"));
      expect(refusalAssertions.length, `${id} has no refusal assertion`).toBeGreaterThanOrEqual(1);
    }
  });
});
