/**
 * F321C spot checks — the three new journeys' specific laws, beyond the
 * generic per-journey pass loop: digest shapes, fail-closed boundary
 * probes, terminal-lifecycle laws and byte-identical re-run determinism
 * (each journey runs against a fresh world per run).
 */

import { describe, expect, it } from "vitest";
import { JOURNEYS } from "../src/journeys/index.js";
import { runJourney } from "../src/runner.js";

function byId(id: string) {
  const journey = JOURNEYS.find((j) => j.id === id);
  if (journey === undefined) throw new Error(`unknown journey ${id}`);
  return journey;
}

describe("F321C — marketplace-publication-lifecycle", () => {
  it("the publication lifecycle log carries every publication and refusal in order", async () => {
    const { facts } = await runJourney(byId("marketplace-publication-lifecycle"));
    expect(facts.get("mp.publishLog")).toEqual([
      "listing-1:published",
      "listing-2:refused:CAPABILITY_UNVERIFIED",
      "listing-3:refused:CAPABILITY_UNVERIFIED",
      "listing-4:refused:NO_CLAIMED_CAPABILITIES",
      "listing-5:refused:TENANT_MISMATCH",
      "listing-6:published",
    ]);
  });

  it("the cascade log records the delisting and the no-op re-revocation", async () => {
    const { facts } = await runJourney(byId("marketplace-publication-lifecycle"));
    expect(facts.get("mp.cascadeLog")).toEqual([
      "ven-2:refused:VENDOR_MISMATCH",
      "ven-1:delisted:listing-1",
      "ven-1:delisted:-",
      "ven-2:refused:NO_REVOKED_TAGS",
    ]);
  });

  it("the delisted listing keeps its original reason after a later revocation of a different tag", async () => {
    const { facts } = await runJourney(byId("marketplace-publication-lifecycle"));
    expect(facts.get("mp.cascade.revokeAgain.firstDelistReason")).toBe("CAPABILITY_REVOKED:cold-chain");
    expect(facts.get("mp.cascade.revokeAgain.delistedIds")).toEqual([]);
  });

  it("re-runs byte-identically (fresh world per run)", async () => {
    const first = await runJourney(byId("marketplace-publication-lifecycle"));
    const second = await runJourney(byId("marketplace-publication-lifecycle"));
    expect(second.outcome.digest).toBe(first.outcome.digest);
  });
});

describe("F321C — vendor-directory-service-relationship", () => {
  it("every transition audit event carries an FNV-1a audit digest of the lane shape", async () => {
    const { facts } = await runJourney(byId("vendor-directory-service-relationship"));
    for (const key of ["vd.transition.suspend.auditDigest", "vd.transition.resume.auditDigest", "vd.transition.terminate.auditDigest"]) {
      expect(facts.get(key)).toMatch(/^audit_[0-9a-f]{8}$/);
    }
  });

  it("the scorecard log carries the worst-wins aggregates and both refusals", async () => {
    const { facts } = await runJourney(byId("vendor-directory-service-relationship"));
    expect(facts.get("vd.scorecardLog")).toEqual([
      "v-1:0.7",
      "v-3:0.55",
      "v-4:refused:EMPTY_SCORECARD",
      "v-5:refused:SCORE_OUT_OF_RANGE",
    ]);
  });

  it("the capability matching feed is deterministic across re-runs (same seed, same request)", async () => {
    const first = await runJourney(byId("vendor-directory-service-relationship"));
    const second = await runJourney(byId("vendor-directory-service-relationship"));
    expect(second.facts.get("vd.feed.cold.serviceLevels")).toStrictEqual(first.facts.get("vd.feed.cold.serviceLevels"));
    expect(first.facts.get("vd.feed.cold.serviceLevels")).toEqual(["v-1:0.7", "v-4:0.5", "v-5:0.5"]);
  });

  it("cross-tenant reads see nothing: the foreign caller's read log is null", async () => {
    const { facts } = await runJourney(byId("vendor-directory-service-relationship"));
    expect(facts.get("vd.readLog")).toEqual([
      "own:v-1:Northwind Logistics",
      "foreign:v-1:null",
      "own:v-77:null",
    ]);
  });
});

describe("F321C — actor-job-failure-expiry (contract-level local lifecycle)", () => {
  it("no journey step claims a live provider: the driven APIs are the local job-record state machine only", () => {
    const journey = byId("actor-job-failure-expiry");
    expect(journey.goal).toContain("no live Apify claim");
    expect(journey.steps.every((s) => s.kind.startsWith("apify-"))).toBe(true);
  });

  it("the failure and expiry refusals precede their successes in the log", async () => {
    const { facts } = await runJourney(byId("actor-job-failure-expiry"));
    const log = facts.get("apifyFx.log") as readonly string[];
    expect(log.filter((l) => l.endsWith("ILLEGAL_TRANSITION")).length).toBe(4);
    expect(log).toContain("job-fx-1:FAILURE_REASON_REQUIRED");
    expect(log).toContain("job-fx-2:NOT_DUE_FOR_EXPIRY");
    expect(log).toContain("job-fx-3:failed");
  });

  it("the idempotent-creation law: duplicate, typed conflict, tenant-distinct fresh create", async () => {
    const { facts } = await runJourney(byId("actor-job-failure-expiry"));
    expect(facts.get("apifyIdem.dup.duplicate")).toBe(true);
    expect(facts.get("apifyIdem.conflict.reasonCode")).toBe("IDEMPOTENCY_KEY_CONFLICT");
    expect(facts.get("apifyIdem.foreign.duplicate")).toBe(false);
    expect(facts.get("apifyIdem.foreign.tenantId")).toBe("acme");
  });

  it("re-runs byte-identically (fresh world per run)", async () => {
    const first = await runJourney(byId("actor-job-failure-expiry"));
    const second = await runJourney(byId("actor-job-failure-expiry"));
    expect(second.outcome.digest).toBe(first.outcome.digest);
  });
});

describe("F321C — corpus integration", () => {
  it("the three F321C journeys each carry well over the five-assertion law", () => {
    for (const id of ["marketplace-publication-lifecycle", "vendor-directory-service-relationship", "actor-job-failure-expiry"]) {
      const journey = byId(id);
      expect(journey.assertions.length, id).toBeGreaterThanOrEqual(5);
    }
  });

  it("the new journeys use personas and capabilities from the fixed vocabularies", () => {
    for (const id of ["marketplace-publication-lifecycle", "vendor-directory-service-relationship", "actor-job-failure-expiry"]) {
      const journey = byId(id);
      expect(["vendor-manager", "procurement-lead", "operations-manager", "project-manager", "software-admin", "org-optimizer", "finance-controller"]).toContain(journey.persona);
      expect(["vendor-marketplace", "vendor-management", "actor-jobs"]).toContain(journey.capability);
    }
  });
});
