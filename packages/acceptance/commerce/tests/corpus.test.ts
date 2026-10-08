/**
 * Corpus shape invariants — the journey corpus is well-formed data before
 * any of it is run.
 */

import { describe, expect, it } from "vitest";
import { JOURNEYS, WORK_JOURNEYS, COMMERCE_JOURNEYS, ORG_JOURNEYS } from "../src/journeys/index.js";
import {
  JOURNEY_PERSONAS,
  JOURNEY_CAPABILITIES,
  type AcceptanceJourney,
} from "../src/journey-contracts.js";

describe("journey corpus shape", () => {
  it("has at least 12 distinct journeys", () => {
    expect(JOURNEYS.length).toBeGreaterThanOrEqual(12);
    expect(JOURNEYS.length).toBe(15);
  });

  it("is assembled from the three journey files without loss", () => {
    expect(JOURNEYS.length).toBe(
      WORK_JOURNEYS.length + COMMERCE_JOURNEYS.length + ORG_JOURNEYS.length,
    );
  });

  it("has unique journey ids", () => {
    const ids = JOURNEYS.map((j) => j.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses only personas from the fixed 7-persona vocabulary", () => {
    for (const journey of JOURNEYS) {
      expect(JOURNEY_PERSONAS).toContain(journey.persona);
    }
    expect(JOURNEY_PERSONAS.length).toBe(7);
  });

  it("uses only capabilities from the fixed vocabulary", () => {
    for (const journey of JOURNEYS) {
      expect(JOURNEY_CAPABILITIES).toContain(journey.capability);
    }
  });

  it("covers the packet's required capability set", () => {
    const covered = new Set(JOURNEYS.map((j) => j.capability));
    const required = [
      "create-work", "approve-execute-work", "stage-gated-projects", "workload-allocation",
      "procurement-spine", "quote-scoring", "order-reconciliation", "vendor-management",
      "software-entitlements", "external-catalog-sync", "actor-jobs", "optimization-review",
      "cross-role-handoff", "tenant-isolation",
    ];
    for (const capability of required) {
      expect(covered.has(capability as (typeof JOURNEY_CAPABILITIES)[number])).toBe(true);
    }
  });

  it("uses at least four distinct personas (persona spread)", () => {
    const personas = new Set(JOURNEYS.map((j) => j.persona));
    expect(personas.size).toBeGreaterThanOrEqual(4);
  });

  it("every journey has at least one step", () => {
    for (const journey of JOURNEYS) {
      expect(journey.steps.length).toBeGreaterThan(0);
    }
  });

  it("every journey has at least five assertions", () => {
    for (const journey of JOURNEYS) {
      expect(journey.assertions.length).toBeGreaterThanOrEqual(5);
    }
  });

  it("has unique assertion ids within each journey", () => {
    for (const journey of JOURNEYS) {
      const ids = journey.assertions.map((a) => a.id);
      expect(new Set(ids).size, journey.id).toBe(ids.length);
    }
  });

  it("has unique step ids within each journey", () => {
    for (const journey of JOURNEYS) {
      const ids = journey.steps.map((s) => s.stepId);
      expect(new Set(ids).size, journey.id).toBe(ids.length);
    }
  });

  it("every journey states a non-empty goal", () => {
    for (const journey of JOURNEYS) {
      expect(journey.goal.trim().length).toBeGreaterThan(0);
    }
  });
});

export type { AcceptanceJourney };
