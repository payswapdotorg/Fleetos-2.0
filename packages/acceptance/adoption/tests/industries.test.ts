/**
 * Industry definitions: the ten-industry catalog, applicability-mask
 * well-formedness, and the honest-subset laws.
 */

import { describe, expect, it } from "vitest";
import {
  INDUSTRIES,
  CORPUS_JOURNEY_IDS,
  applicableCommerceJourneys,
  applicableFieldJourneys,
  applicableSecurityJourneys,
  industryById,
  maskedJourneyRationales,
} from "../src/industries.js";
import { FIELD_JOURNEYS } from "@fleetos/acceptance-field/journeys";
import { SECURITY_JOURNEYS } from "@fleetos/acceptance-security/journeys";
import { JOURNEYS as COMMERCE_JOURNEYS } from "@fleetos/acceptance-commerce/journeys";

const PACKET_ORDER = [
  "manufacturing",
  "construction",
  "energy-utilities",
  "transportation-logistics",
  "agriculture",
  "healthcare-facilities",
  "facilities-management",
  "telecommunications",
  "mining",
  "water-waste",
];

describe("industries", () => {
  it("defines exactly TEN industries in the packet's order", () => {
    expect(INDUSTRIES.length).toBe(10);
    expect(INDUSTRIES.map((i) => i.id)).toEqual(PACKET_ORDER);
  });

  it("has unique stable ids and non-empty display names", () => {
    const ids = INDUSTRIES.map((i) => i.id);
    expect(new Set(ids).size).toBe(10);
    for (const industry of INDUSTRIES) {
      expect(industry.displayName.length).toBeGreaterThan(0);
    }
  });

  it("asset-profile weights are non-negative integers summing to 100", () => {
    for (const industry of INDUSTRIES) {
      const w = industry.assetProfile;
      const values = [w.heavyEquipment, w.vehicle, w.fixedAsset, w.instrument];
      for (const v of values) {
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
      }
      expect(values.reduce((a, b) => a + b, 0)).toBe(100);
    }
  });

  it("posture emphasis stays inside the fixed vocabulary", () => {
    const vocabulary = new Set(["connectivity-edge", "security-intelligence", "work-commerce"]);
    for (const industry of INDUSTRIES) {
      expect(vocabulary.has(industry.postureEmphasis)).toBe(true);
    }
    // All three emphases are actually exercised by the catalog.
    const used = new Set(INDUSTRIES.map((i) => i.postureEmphasis));
    expect(used.size).toBe(3);
  });

  it("every mask entry references a REAL journey id of its corpus", () => {
    for (const industry of INDUSTRIES) {
      for (const [journeyId] of Object.entries(industry.masked.field)) {
        expect(CORPUS_JOURNEY_IDS.field).toContain(journeyId);
      }
      for (const [journeyId] of Object.entries(industry.masked.commerce)) {
        expect(CORPUS_JOURNEY_IDS.commerce).toContain(journeyId);
      }
      for (const [journeyId] of Object.entries(industry.masked.security)) {
        expect(CORPUS_JOURNEY_IDS.security).toContain(journeyId);
      }
    }
  });

  it("every masked journey carries a non-empty rationale (honest exclusion)", () => {
    for (const industry of INDUSTRIES) {
      const rationales = maskedJourneyRationales(industry);
      for (const r of rationales) {
        expect(r.rationale.length).toBeGreaterThan(20);
      }
    }
  });

  it("mask keys exist verbatim in the corpus objects (no typo'd masks)", () => {
    const fieldIds = new Set(FIELD_JOURNEYS.map((j) => j.id));
    const commerceIds = new Set(COMMERCE_JOURNEYS.map((j) => j.id));
    const securityIds = new Set(SECURITY_JOURNEYS.map((j) => j.journeyId));
    for (const industry of INDUSTRIES) {
      for (const id of Object.keys(industry.masked.field)) expect(fieldIds.has(id)).toBe(true);
      for (const id of Object.keys(industry.masked.commerce)) expect(commerceIds.has(id)).toBe(true);
      for (const id of Object.keys(industry.masked.security)) expect(securityIds.has(id)).toBe(true);
    }
  });

  it("HONEST SUBSET law: not every industry is the full set — and the corpora are 42+52+42 (converged Wave 19 final at F374)", () => {
    expect(FIELD_JOURNEYS.length).toBe(42);
    expect(COMMERCE_JOURNEYS.length).toBe(52);
    expect(SECURITY_JOURNEYS.length).toBe(42);
    const applicableCounts = INDUSTRIES.map(
      (i) => applicableFieldJourneys(i).length + applicableCommerceJourneys(i).length + applicableSecurityJourneys(i).length,
    );
    // F353: the fully-applicable cap is 105 post-F351B (sanctioned grow-only
    // corpus expansion per F350 §4); the B-3 law is now "at or above the 100
    // target" — never below.
    // F362 E2E re-pin: the cap is 119 (42+46+31); agriculture's applicable
    // set crossed to EXACTLY 100 on the universal spine — every industry
    // now meets the 100 target, while the masked subset law HOLDS (not
    // every industry spans the full cap).
    // F370 re-pin: the cap is 130 (42+49+39) — the 11 Wave-18 journeys are
    // fleet-universal, so every industry grows +11 and the honest subset
    // law holds unchanged.
    // F374 re-pin: the cap is 136 (42+52+42) — the 6 Wave-19 journeys (3
    // F372 networked-PG commerce + 3 F373 KMS security) are fleet-universal,
    // so every industry grows +6 and the honest subset law holds unchanged.
    const cap = Math.max(...applicableCounts);
    const fullSet = applicableCounts.filter((c) => c === cap).length;
    const belowCap = applicableCounts.filter((c) => c < cap).length;
    const belowTarget = applicableCounts.filter((c) => c < 100).length;
    expect(fullSet).toBeGreaterThan(0); // manufacturing + energy-utilities legitimately span everything
    expect(belowCap).toBeGreaterThan(0); // the honest subset law: masked industries remain below the cap
    expect(belowTarget).toBe(0); // the E2E spine closed the last applicable-target gap (agriculture 99 -> 100)
  });

  it("every industry keeps at least one applicable journey per corpus", () => {
    for (const industry of INDUSTRIES) {
      expect(applicableFieldJourneys(industry).length).toBeGreaterThanOrEqual(1);
      expect(applicableCommerceJourneys(industry).length).toBeGreaterThanOrEqual(1);
      expect(applicableSecurityJourneys(industry).length).toBeGreaterThanOrEqual(1);
    }
  });

  it("mobile-shape journey is applicable for EVERY industry (field applicability)", () => {
    for (const industry of INDUSTRIES) {
      const mobile = applicableFieldJourneys(industry).find((j) => j.id === "mobile-field-shape");
      expect(mobile).toBeDefined();
    }
  });

  it("handoff pair law: consume is applicable only together with publish", () => {
    for (const industry of INDUSTRIES) {
      const ids = new Set(applicableFieldJourneys(industry).map((j) => j.id));
      const consume = ids.has("handoff-field-to-operator-consume");
      const publish = ids.has("handoff-field-to-operator-publish");
      if (consume) expect(publish).toBe(true);
    }
    // And the family (both field handoffs + commerce cross-role) applies everywhere.
    for (const industry of INDUSTRIES) {
      const fieldIds = applicableFieldJourneys(industry).map((j) => j.id);
      expect(fieldIds).toContain("handoff-field-to-operator-publish");
      expect(fieldIds).toContain("handoff-field-to-operator-consume");
      expect(applicableCommerceJourneys(industry).map((j) => j.id)).toContain("cross-role-handoff");
    }
  });

  it("tenant-isolation journeys are never masked for any industry", () => {
    for (const industry of INDUSTRIES) {
      expect(industry.masked.field["tenant-isolation-fail-closed"]).toBeUndefined();
      expect(industry.masked.commerce["tenant-fail-closed"]).toBeUndefined();
      expect(industry.masked.security["security.tenant-fail-closed"]).toBeUndefined();
    }
  });

  it("agriculture masks counterfactual-reasoning (the packet's worked example)", () => {
    const agriculture = industryById("agriculture") as { masked: { security: Record<string, string> } };
    expect(agriculture.masked.security["security.counterfactual-reasoning"]).toBeDefined();
  });
});
