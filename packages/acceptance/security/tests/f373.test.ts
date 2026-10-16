/**
 * F373 tests — spot checks of the three Wave-19 lane B real-KMS journeys
 * (the F341B/F361B/F370A/F370B precedent: new journeys get their spot
 * checks in their own file; tests/journeys.test.ts stays at its existing
 * size and grows only through its it.each auto-growth).
 *
 * Everything here re-runs the REAL journeys through the REAL runner (the
 * drive itself happened at module evaluation against a REAL fleetos-kms
 * child process) and pins the same facts the corpus assertions pin, plus
 * the four F373-specific machine laws:
 *   - the REFUSAL-COVERAGE law: across the three journeys, every KMS/keyring
 *     refusal family is asserted at least once;
 *   - the NO-SECRET-LEAK law: the lane's known secret constants (the fixture
 *     master key, the admin secret, the admin token key draw, both drawn
 *     key materials) appear in NO journey fact and NO journey outcome
 *     across the WHOLE corpus — grep-asserted;
 *   - the OUTPUT law: no ephemeral-port shape, no tmp path, no data-dir
 *     name and no wall-clock ISO timestamp ever appears in the three
 *     journeys' facts (the fixture-clock law — logical epochs only);
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

const F373_IDS = [
  "security.kms-rotation",
  "security.kms-boundary",
  "security.kms-crash-restart",
] as const;

// The lane's known secret constants (plainly-labelled fixtures + the fixed
// SecureRandom stream draws — every value the no-leak law must keep OUT of
// all journey output).
const LANE_SECRETS = [
  "f373a1b2c3d4e5f60718293a4b5c6d7ef373a1b2c3d4e5f60718293a4b5c6d7e", // the fixture master key
  "f373-fixture-admin-secret", // the fixture admin credential secret
  "5f3730a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d", // the admin token key draw (stream position 1)
  "1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff", // the create draw material
  "ffffeeeeddddccccbbbbaaaa9999888877776666555544443333222211110000", // the rotate draw material
];

describe("F373 journey spot checks (REAL behaviors)", () => {
  it("rotation: create through the API, the adapter over the authenticated API, grace to KEY_RETIRED", () => {
    const { facts } = runJourney(journey("security.kms-rotation"));
    expect(facts["kmr.admin.provisionOk"]).toBe(true);
    expect(facts["kmr.adapter1.source"]).toBe("kms");
    expect(facts["kmr.create.keyId"]).toBe("f373c0ffee00f373");
    expect(facts["kmr.issue1.materialFromKms"]).toBe(true);
    expect(facts["kmr.rotate.newKeyId"]).toBe("f373deadbeeff373");
    expect(facts["kmr.rotate.retireAt"]).toBe(1791831060000);
    expect(facts["kmr.list.postRotate"]).toEqual(["f373c0ffee00f373", "f373deadbeeff373"]);
    expect(facts["kmr.adapter2.k1RetireAt"]).toBe(1791831060000);
    expect(facts["kmr.t1.graceKeyStatus"]).toBe("verify-grace");
    expect(facts["kmr.t1.boundaryInclusive"]).toBe(true);
    expect(facts["kmr.t1.retired"]).toBe("KEY_RETIRED");
    expect(facts["kmr.t2.verifyKeyStatus"]).toBe("current");
  });

  it("rotation: REFUSAL — the ghost id, the id substitution, the tamper, the malformed family", () => {
    const { facts } = runJourney(journey("security.kms-rotation"));
    expect(facts["kmr.ghostResolve"]).toBe("KEY_UNKNOWN");
    expect(facts["kmr.swappedKeyId"]).toBe("SIGNATURE_INVALID");
    expect(facts["kmr.tampered"]).toBe("SIGNATURE_INVALID");
    expect(facts["kmr.malformed.allOneReason"]).toBe(true);
    expect(facts["kmr.malformed.nullToken"]).toBe("MALFORMED_TOKEN");
    expect(facts["kmr.audit.ops"]).toEqual(["kms.admin-token-key", "kms.admin-provision", "kms.key-create", "kms.key-rotate"]);
    expect(facts["kmr.audit.opSeqs"]).toEqual([1, 2, 3, 4]);
    expect(facts["kmr.noleak.verdictsClean"]).toBe(true);
  });

  it("boundary: the auth refusals, the at-rest scan, the no-leak law at the network boundary", () => {
    const { facts } = runJourney(journey("security.kms-boundary"));
    expect(facts["kmb.unauth"]).toBe("UNAUTHENTICATED");
    expect(facts["kmb.tampered"]).toBe("SIGNATURE_INVALID");
    expect(facts["kmb.expired"]).toBe("SESSION_EXPIRED");
    expect(facts["kmb.garbage"]).toBe("UNAUTHENTICATED");
    expect(facts["kmb.login.refusal"]).toBe("ADMIN_CREDENTIAL_INVALID");
    expect(facts["kmb.login.byteIdentical"]).toBe(true);
    expect(facts["kmb.provision.duplicate"]).toBe("ADMIN_EXISTS");
    expect(facts["kmb.create.duplicate"]).toBe("KEY_EXISTS");
    expect(facts["kmb.resolve.ghost"]).toBe("KEY_UNKNOWN");
    expect(facts["kmb.atrest.stateFileClean"]).toBe(true);
    expect(facts["kmb.atrest.auditFileClean"]).toBe(true);
    expect(facts["kmb.atrest.hasWrappedEnvelope"]).toBe(true);
    expect(facts["kmb.noleak.responsesClean"]).toBe(true);
    expect(facts["kmb.noleak.materialChannelOnly"]).toBe(true);
  });

  it("crash-restart: the SIGKILL, the recovery, the identical digests and verdicts", () => {
    const { facts } = runJourney(journey("security.kms-crash-restart"));
    expect(facts["kmx.crash.signal"]).toBe("SIGKILL");
    expect(facts["kmx.crash.exitObserved"]).toBe(true);
    expect(facts["kmx.recovery.recovered"]).toBe(true);
    expect(facts["kmx.recovery.keys"]).toBe(2);
    expect(facts["kmx.recovery.adminTokenKeyRecovered"]).toBe(true);
    expect(facts["kmx.recovery.auditEntries"]).toBe(4);
    expect(facts["kmx.recovery.notFreshBoot"]).toBe(true);
    expect(facts["kmx.boot.count"]).toBe(2);
    expect(facts["kmx.digests.keySetIdentical"]).toBe(true);
    expect(facts["kmx.digests.auditIdentical"]).toBe(true);
    expect(facts["kmx.verdicts.resolveIdentical"]).toBe(true);
    expect(facts["kmx.verdicts.materialMatchesStream"]).toBe(true);
    expect(facts["kmx.verdicts.graceIdentical"]).toBe(true);
    expect(facts["kmx.post.graceKeyStatus"]).toBe("verify-grace");
    expect(facts["kmx.post.retired"]).toBe("KEY_RETIRED");
    expect(facts["kmx.atrest.clean"]).toBe(true);
  });

  it("the REFUSAL-COVERAGE law: every KMS/keyring refusal family is asserted across the battery", () => {
    const allFacts = F373_IDS.map((id) => runJourney(journey(id)).facts);
    const values = JSON.stringify(allFacts);
    for (const family of [
      "UNAUTHENTICATED",
      "SIGNATURE_INVALID",
      "SESSION_EXPIRED",
      "ADMIN_CREDENTIAL_INVALID",
      "ADMIN_EXISTS",
      "KEY_UNKNOWN",
      "KEY_EXISTS",
      "KEY_RETIRED",
      "MALFORMED_TOKEN",
      "verify-grace",
    ]) {
      expect(values.includes(`"${family}"`), `refusal family ${family} never asserted`).toBe(true);
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

  it("the OUTPUT law: no port shape, no tmp path, no data-dir name, no wall-clock ISO in the three journeys' facts", () => {
    const PORT_SHAPE = /:(\d{4,5})(?!\d)/;
    const TMP_SHAPE = /\/tmp\//;
    const DATA_DIR_SHAPE = /kms-journey-/;
    const WALL_CLOCK_ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:/;
    for (const id of F373_IDS) {
      const { facts } = runJourney(journey(id));
      const serialized = JSON.stringify(facts);
      expect(PORT_SHAPE.test(serialized), `${id} fact carries an ephemeral-port shape`).toBe(false);
      expect(TMP_SHAPE.test(serialized), `${id} fact carries a tmp path`).toBe(false);
      expect(DATA_DIR_SHAPE.test(serialized), `${id} fact carries a data-dir name`).toBe(false);
      expect(WALL_CLOCK_ISO.test(serialized), `${id} fact carries a wall-clock ISO timestamp`).toBe(false);
    }
  });

  it("the DETERMINISM law: the FULL corpus re-run is byte-identical (digests and full outcomes)", () => {
    const first = runAllJourneys(SECURITY_JOURNEYS);
    const second = runAllJourneys(SECURITY_JOURNEYS);
    expect(first.map((o) => o.digest)).toEqual(second.map((o) => o.digest));
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.every((o) => o.pass)).toBe(true);
  });

  it("all three F373 journeys pass their full assertion chains", () => {
    for (const id of F373_IDS) {
      const { outcome } = runJourney(journey(id));
      expect(outcome.pass, `${id} does not pass`).toBe(true);
      expect(outcome.failedAssertionCount).toBe(0);
      expect(outcome.passedStepCount).toBe(journey(id).steps.length);
    }
  });

  it("the three journeys assert at least the family floor (>=25 assertions, >=1 refusal each)", () => {
    for (const id of F373_IDS) {
      const j = journey(id);
      expect(j.assertions.length, `${id} below the family floor`).toBeGreaterThanOrEqual(25);
      const refusalAssertions = j.assertions.filter((a) => a.description.includes("REFUSAL") || a.description.includes("NO-LEAK") || a.description.includes("THE LAW") || a.description.includes("AT-REST"));
      expect(refusalAssertions.length, `${id} has no refusal assertion`).toBeGreaterThanOrEqual(1);
    }
  });

  it("the corpus barrel grew grow-only: 42 journeys, unique, all passing, the 39 base entries untouched", () => {
    expect(SECURITY_JOURNEYS.length).toBe(42);
    const ids = SECURITY_JOURNEYS.map((j) => j.journeyId);
    expect(new Set(ids).size).toBe(42);
    const baseIds = ids.filter((id) => !F373_IDS.includes(id as (typeof F373_IDS)[number]));
    expect(baseIds.length).toBe(39);
    for (const id of baseIds) {
      const { outcome } = runJourney(journey(id));
      expect(outcome.pass, `${id} stopped passing`).toBe(true);
    }
  });
});
