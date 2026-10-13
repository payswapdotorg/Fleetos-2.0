/**
 * F341B tests — spot checks of the two Wave-14 lane B remainder journeys
 * (the F341A sixth-slot precedent: new journeys get their spot checks in
 * their own file; tests/journeys.test.ts sits at the file-law ceiling).
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

describe("F341B journey spot checks (REAL behaviors)", () => {
  it("artifact store: content addressing dedups and keeps artifacts traceable", () => {
    const { facts } = runJourney(journey("security.evidence-artifact-store-completeness"));
    expect(facts["store.count"]).toBe(3);
    expect(facts["store.duplicateSameArtifactId"]).toBe(true);
    expect(facts["store.duplicateKeepsOriginalDescription"]).toBe(true);
    expect(facts["store.artifactIdMatchesShaPrefix"]).toBe(true);
    expect(facts["store.retrieveRoundTripIdentical"]).toBe(true);
    expect(facts["store.retrieveUnknownIsNull"]).toBe(true);
    expect(facts["store.existsUnknown"]).toBe(false);
  });

  it("artifact store: a complete bundle verifies; an incomplete bundle NEVER verifies", () => {
    const { facts } = runJourney(journey("security.evidence-artifact-store-completeness"));
    expect(facts["complete.verified"]).toBe(true);
    expect(facts["complete.totalArtifacts"]).toBe(3);
    expect(facts["incomplete.verified"]).toBe(false);
    expect(facts["incomplete.missingCount"]).toBe(2);
    expect(facts["incomplete.missingMatchesSortedReference"]).toBe(true);
    expect(facts["incomplete.missingFirstPrefix"]).toBe("8c7a1b46");
    expect(facts["assemble.incompleteVerified"]).toBe(false);
    expect(facts["assemble.bundleDigestMatchesCanonical"]).toBe(true);
  });

  it("artifact store: port contract honesty — a second port behaves identically, an empty one reports everything missing", () => {
    const { facts } = runJourney(journey("security.evidence-artifact-store-completeness"));
    expect(facts["port.preloadedResultsIdentical"]).toBe(true);
    expect(facts["port.preloadedDigestIdentical"]).toBe(true);
    expect(facts["port.emptyVerified"]).toBe(false);
    expect(facts["port.emptyMissingCount"]).toBe(3);
    expect(facts["port.emptyMissingIsSorted"]).toBe(true);
  });

  it("windowing: inclusive boundaries, out-of-window exclusion, forged-projection detection", () => {
    const { facts } = runJourney(journey("security.world-context-windowing"));
    expect(facts["wl.provenanceRefs"]).toEqual(["obs-w-2", "obs-w-3", "obs-w-4"]);
    expect(facts["wl.integrityOutOfWindow"]).toBe(0);
    expect(facts["edge.startInclusive"]).toBe(true);
    expect(facts["edge.endInclusive"]).toBe(true);
    expect(facts["edge.oneMsAfterStartExcluded"]).toBe(true);
    expect(facts["edge.oneMsBeforeEndExcluded"]).toBe(true);
    expect(facts["edge.emptyWindowDegraded"]).toBe(true);
    expect(facts["edge.negativeUtilizationDegraded"]).toBe(true);
    expect(facts["edge.forgedCaught"]).toBe(true);
    expect(facts["edge.forgedOutOfWindow"]).toBe(1);
  });

  it("windowing: immature observations NEVER join — even inside the window", () => {
    const { facts } = runJourney(journey("security.world-context-windowing"));
    expect(facts["mat.boundaryMature"]).toBe(true);
    expect(facts["mat.boundaryOneMsShortImmature"]).toBe(true);
    expect(facts["mat.filterRefs"]).toEqual(["obs-w-1", "obs-w-2", "obs-w-3", "obs-w-4"]);
    expect(facts["mat.compositionInWindowCount"]).toBe(4);
    expect(facts["mat.compositionJoinedCount"]).toBe(3);
    expect(facts["mat.compositionJoinedRefs"]).toEqual(["obs-w-2", "obs-w-3", "obs-w-4"]);
  });

  it("windowing is NOT staleness — the distinction asserted in both directions", () => {
    const { facts } = runJourney(journey("security.world-context-windowing"));
    expect(facts["st.oldObsClass"]).toBe("unknown");
    expect(facts["st.oldObsInHistoricalWindow"]).toBe(true);
    expect(facts["st.unknownYetWindowed"]).toBe(true);
    expect(facts["st.freshObsClass"]).toBe("fresh");
    expect(facts["st.freshObsAgeMs"]).toBe(10000);
    expect(facts["st.freshObsMature"]).toBe(false);
    expect(facts["st.freshYetRefused"]).toBe(true);
  });

  it("windowing: the project projection windows its provenance too", () => {
    const { facts } = runJourney(journey("security.world-context-windowing"));
    expect(facts["proj.activeWorkItems"]).toBe(2);
    expect(facts["proj.provenanceRefs"]).toEqual(["obs-w-2", "obs-w-3"]);
    expect(facts["proj.integrityOk"]).toBe(true);
    expect(facts["proj.schemaVersion"]).toBe("1.0.0");
  });
});
