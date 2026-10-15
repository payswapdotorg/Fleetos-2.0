/**
 * F370B tests — spot checks of the three Wave-18 lane B secret-management
 * journeys (the F341B/F361B/F370A precedent: new journeys get their spot
 * checks in their own file; tests/journeys.test.ts stays at its existing
 * size and grows only through its it.each auto-growth).
 *
 * Everything here re-runs the REAL journeys through the REAL runner and
 * pins the same facts the corpus assertions pin (focused re-assertion —
 * the machine-measured double-check, not new semantics), plus the four
 * F370B-specific machine laws:
 *   - the KEY-LAW COVERAGE law: across the battery, every keyring
 *     refusal family (KEY_UNKNOWN / KEY_RETIRED / verify-grace /
 *     SIGNATURE_INVALID / MALFORMED_TOKEN) is asserted at least once;
 *   - the PRECEDENCE law: signature/expiry (and key retirement) precede
 *     the revocation check — re-asserted at the exact seams;
 *   - the NO-SECRET-LEAK law: the known secret constants of this lane
 *     (fixture + generated key material, plaintext, salts) appear in NO
 *     journey fact and NO journey outcome across the WHOLE corpus —
 *     grep-asserted, the machine form of the packet's law;
 *   - the DETERMINISM law: the FULL corpus re-run is byte-identical
 *     (digest arrays and full outcome arrays).
 */

import { describe, expect, it } from "vitest";
import { runAllJourneys, runJourney } from "../src/runner.ts";
import { SECURITY_JOURNEYS } from "../src/journeys/index.ts";
import type { AcceptanceJourney } from "../src/journey-contracts.ts";

const byId = new Map(SECURITY_JOURNEYS.map((j) => [j.journeyId, j]));
function journey(id: string): AcceptanceJourney {
  const found = byId.get(id);
  if (found === undefined) throw new Error(`journey ${id} not found`);
  return found;
}

const F370B_IDS = [
  "security.keyring-rotation",
  "security.session-revocation",
  "security.secure-random-no-leak",
] as const;

// The lane's known secret constants (fixtures and injected-stream draws
// — every value the no-leak law must keep OUT of all journey output).
const LANE_SECRETS = [
  "0b1f2e3d4c5b6a7988776655443322110b1f2e3d4c5b6a798877665544332211", // the pilot fixture key material
  "33445566778899aabbccddeeff00112233445566778899aabbccddeeff001122", // the revocation-journey signing key
  "9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c5b4a39281706f5e4d3c2b1a0", // generated key material (stream A)
  "11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff", // generated key material (stream B)
  "a1b2c3d4e5f60718293a4b5c6d7e8f90", // generated credential salt (A)
  "0f1e2d3c4b5a69788796a5b4c3d2e1f0", // generated credential salt (B)
  "f370b-plaintext-secret-fixture", // the credential plaintext
];

describe("F370B journey spot checks (REAL behaviors)", () => {
  it("keyring: issue under the current key, the rotation draw, grace to KEY_RETIRED", () => {
    const { facts } = runJourney(journey("security.keyring-rotation"));
    expect(facts["kr.env.loadOk"]).toBe(true);
    expect(facts["kr.env.source"]).toBe("env");
    expect(facts["kr.issue.keyId"]).toBe("pilot-k1");
    expect(facts["kr.issue.partCount"]).toBe(4);
    expect(facts["kr.rotate.newKeyId"]).toBe("a1b2c3d4e5f60718");
    expect(facts["kr.rotate.retireAt"]).toBe(1791831060000);
    expect(facts["kr.rotate.snapshotKeys"]).toEqual(["a1b2c3d4e5f60718", "pilot-k1"]);
    expect(facts["kr.grace.keyStatus"]).toBe("verify-grace");
    expect(facts["kr.grace.boundaryInclusive"]).toBe(true);
    expect(facts["kr.retired"]).toBe("KEY_RETIRED");
    expect(facts["kr.newKey.keyStatus"]).toBe("current");
  });

  it("keyring: REFUSAL — the unknown-id, wrong-material and malformed laws", () => {
    const { facts } = runJourney(journey("security.keyring-rotation"));
    expect(facts["kr.unknownKey"]).toBe("KEY_UNKNOWN");
    expect(facts["kr.wrongMaterial"]).toBe("SIGNATURE_INVALID");
    expect(facts["kr.malformed.allOneReason"]).toBe(true);
    expect(facts["kr.malformed.nullToken"]).toBe("MALFORMED_TOKEN");
    expect(facts["kr.noleak.verdictsClean"]).toBe(true);
  });

  it("revocation: the jti revocation, the surviving sibling, the actor sweep", () => {
    const { facts } = runJourney(journey("security.session-revocation"));
    expect(facts["rev.jti.refusal"]).toBe("REVOKED");
    expect(facts["rev.jti.cause"]).toBe("jti");
    expect(facts["rev.jti.siblingValid"]).toBe(true);
    expect(facts["rev.sweep.refusal"]).toBe("REVOKED");
    expect(facts["rev.sweep.cause"]).toBe("actor");
    expect(facts["rev.sweep.otherActorUntouched"]).toBe(true);
    expect(facts["rev.sweep.specificCauseWins"]).toBe("jti");
  });

  it("revocation: the PRECEDENCE law at the exact seams", () => {
    const { facts } = runJourney(journey("security.session-revocation"));
    expect(facts["rev.prec.tampered"]).toBe("SIGNATURE_INVALID");
    expect(facts["rev.prec.expiredRevoked"]).toBe("SESSION_EXPIRED");
    expect(facts["rev.prec.malformed"]).toBe("MALFORMED_TOKEN");
    expect(facts["rev.prec.missingJti"]).toBe("JTI_MISSING");
    // The exact seam: at the inclusive expiry boundary the registry refuses;
    // one instant past it the expiry verdict takes over.
    expect(facts["rev.prec.boundarySeam"]).toBe("REVOKED");
    expect(facts["rev.prec.pastSeam"]).toBe("SESSION_EXPIRED");
    // The keyed stack: key retirement precedes revocation; in grace the
    // registry is the refusing verdict.
    expect(facts["rev.keyed.retiredBeatsRevoked"]).toBe("KEY_RETIRED");
    expect(facts["rev.keyed.graceRevoked"]).toBe("REVOKED");
  });

  it("secure-random: deterministic-under-injection + generated-salt enumeration resistance", () => {
    const { facts } = runJourney(journey("security.secure-random-no-leak"));
    expect(facts["sr.det.saltIdentical"]).toBe(true);
    expect(facts["sr.det.keyMaterialIdentical"]).toBe(true);
    expect(facts["sr.det.differentStreamDiffers"]).toBe(true);
    expect(facts["sr.det.saltHexLength"]).toBe(32);
    expect(facts["sr.det.keyHexLength"]).toBe(64);
    expect(facts["sr.cred.verifyOk"]).toBe(true);
    expect(facts["sr.cred.wrongSecret"]).toBe("INVALID_CREDENTIAL");
    expect(facts["sr.cred.unknownActor"]).toBe("INVALID_CREDENTIAL");
    expect(facts["sr.cred.refusalsByteIdentical"]).toBe(true);
    expect(facts["sr.cred.sameStreamIdenticalRecord"]).toBe(true);
    expect(facts["sr.mat.rotationIdentical"]).toBe(true);
    expect(facts["sr.mat.keyedTokenIdentical"]).toBe(true);
    expect(facts["sr.mat.keyedTokenDiffers"]).toBe(true);
  });

  it("secure-random: the NO-LEAK law over the journey's own verdicts", () => {
    const { facts } = runJourney(journey("security.secure-random-no-leak"));
    expect(facts["sr.noleak.verdictsClean"]).toBe(true);
    expect(facts["sr.noleak.saltOnlyInRecord"]).toBe(true);
    expect(facts["sr.noleak.rotationMetadataClean"]).toBe(true);
    expect(facts["sr.noleak.plaintextAbsent"]).toBe(true);
  });

  it("the KEY-LAW COVERAGE law: every keyring refusal family is asserted across the battery", () => {
    const allFacts = F370B_IDS.map((id) => runJourney(journey(id)).facts);
    const values = JSON.stringify(allFacts);
    for (const family of ["KEY_UNKNOWN", "KEY_RETIRED", "verify-grace", "SIGNATURE_INVALID", "MALFORMED_TOKEN"]) {
      expect(values.includes(`"${family}"`), `keyring family ${family} never asserted`).toBe(true);
    }
  });

  it("the NO-SECRET-LEAK law: no lane secret appears in ANY journey fact or outcome across the WHOLE corpus (grep-asserted)", () => {
    for (const j of SECURITY_JOURNEYS) {
      const { facts, outcome } = runJourney(j);
      const journeyJson = JSON.stringify({ facts, outcome });
      for (const secret of LANE_SECRETS) {
        expect(journeyJson.includes(secret), `${j.journeyId} leaked a secret constant`).toBe(false);
      }
    }
  });

  it("the DETERMINISM law: the FULL corpus re-run is byte-identical (digests and full outcomes)", () => {
    const first = runAllJourneys(SECURITY_JOURNEYS);
    const second = runAllJourneys(SECURITY_JOURNEYS);
    expect(first.map((o) => o.digest)).toEqual(second.map((o) => o.digest));
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.every((o) => o.pass)).toBe(true);
  });

  it("all three F370B journeys pass their full assertion chains", () => {
    for (const id of F370B_IDS) {
      const { outcome } = runJourney(journey(id));
      expect(outcome.pass, `${id} does not pass`).toBe(true);
      expect(outcome.failedAssertionCount).toBe(0);
      expect(outcome.passedStepCount).toBe(journey(id).steps.length);
    }
  });

  it("the three journeys assert at least the D14 floor (>=5 assertions, >=1 refusal each)", () => {
    for (const id of F370B_IDS) {
      const j = journey(id);
      expect(j.assertions.length, `${id} below the D14 floor`).toBeGreaterThanOrEqual(5);
      const refusalAssertions = j.assertions.filter((a) => a.description.includes("REFUSAL") || a.description.includes("NO-LEAK") || a.description.includes("PRECEDENCE"));
      expect(refusalAssertions.length, `${id} has no refusal assertion`).toBeGreaterThanOrEqual(1);
    }
  });

  it("the corpus barrel grew grow-only: 39 journeys, unique, all passing, the 36 base entries untouched", () => {
    expect(SECURITY_JOURNEYS.length).toBe(39);
    const ids = SECURITY_JOURNEYS.map((j) => j.journeyId);
    expect(new Set(ids).size).toBe(39);
    const baseIds = ids.filter((id) => !F370B_IDS.includes(id as (typeof F370B_IDS)[number]));
    expect(baseIds.length).toBe(36);
    for (const id of baseIds) {
      const { outcome } = runJourney(journey(id));
      expect(outcome.pass, `${id} stopped passing`).toBe(true);
    }
  });
});
