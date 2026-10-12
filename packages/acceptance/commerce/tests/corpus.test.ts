/**
 * Corpus shape invariants — the journey corpus is well-formed data before
 * any of it is run. F331C additions: the 34 → 36 count law, the two new
 * required capabilities, and the D10 epoch-table shape laws (T0 entry
 * identity, unique epochs, census-certified journeys only).
 */

import { describe, expect, it } from "vitest";
import { JOURNEYS, WORK_JOURNEYS, COMMERCE_JOURNEYS, ORG_JOURNEYS, HOST_JOURNEYS, GATEWAY_JOURNEYS, LIFECYCLE_JOURNEYS, FINANCE_JOURNEYS, RESILIENCE_JOURNEYS, MARKETPLACE_JOURNEYS, ACTOR_JOBS_JOURNEYS, MARKETPLACE_TRANSACTION_JOURNEYS, TENANT_BILLING_JOURNEYS } from "../src/journeys/index.js";
import {
  JOURNEY_PERSONAS,
  JOURNEY_CAPABILITIES,
  type AcceptanceJourney,
} from "../src/journey-contracts.js";
import { COMMERCE_T0 as WORLD_T0 } from "../src/journey-world.js";

const EPOCH_TABLE_JOURNEYS = new Set(["marketplace-transaction-flow", "tenant-billing-invoicing"]);

describe("journey corpus shape", () => {
  it("has at least 12 distinct journeys", () => {
    expect(JOURNEYS.length).toBeGreaterThanOrEqual(12);
    expect(JOURNEYS.length).toBe(36);
  });

  it("is assembled from the twelve journey files without loss", () => {
    expect(JOURNEYS.length).toBe(
      WORK_JOURNEYS.length + COMMERCE_JOURNEYS.length + ORG_JOURNEYS.length +
      HOST_JOURNEYS.length + GATEWAY_JOURNEYS.length +
      LIFECYCLE_JOURNEYS.length + FINANCE_JOURNEYS.length + RESILIENCE_JOURNEYS.length +
      MARKETPLACE_JOURNEYS.length + ACTOR_JOBS_JOURNEYS.length +
      MARKETPLACE_TRANSACTION_JOURNEYS.length + TENANT_BILLING_JOURNEYS.length,
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
      "host-integration", "model-gateway-routing", "role-assignment",
      "work-assignment-management", "work-deadlines", "sla-management", "cost-allocation",
      "vendor-marketplace",
      // F331C (Wave 13 lane C): rows 34–35.
      "marketplace-transactions", "tenant-billing",
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

describe("F331C epoch-table shape (D10)", () => {
  it("every expectedByEpoch table has unique epochs, a T0 entry identical to the single-valued expectation, and only frozen-schedule values", () => {
    const COMMERCE_T0 = WORLD_T0;
    const frozen = new Set([COMMERCE_T0, COMMERCE_T0 + 2_592_000_000, COMMERCE_T0 + 7_776_000_000]);
    for (const journey of JOURNEYS) {
      for (const assertion of journey.assertions) {
        if (assertion.expectedByEpoch === undefined) continue;
        const epochs = assertion.expectedByEpoch.map((e) => e.epoch);
        expect(new Set(epochs).size, `${journey.id}:${assertion.id}`).toBe(epochs.length);
        for (const epoch of epochs) {
          expect(frozen.has(epoch), `${journey.id}:${assertion.id}:${epoch}`).toBe(true);
        }
        const t0Entry = assertion.expectedByEpoch.find((e) => e.epoch === COMMERCE_T0);
        expect(t0Entry, `${journey.id}:${assertion.id}:t0-entry`).toBeDefined();
        if (t0Entry !== undefined) {
          expect(t0Entry.expected, `${journey.id}:${assertion.id}:t0-identity`).toStrictEqual(assertion.expected);
        }
      }
    }
  });

  it("epoch tables exist ONLY on census-certified journeys (the F331C census responder set)", () => {
    for (const journey of JOURNEYS) {
      const hasTable = journey.assertions.some((a) => a.expectedByEpoch !== undefined);
      // Subset law: a table may only exist on a census-certified journey.
      // (The strict equality form — every certified responder is
      // parameterized — lands with the D10 parameterization commit.)
      if (hasTable) {
        expect(EPOCH_TABLE_JOURNEYS.has(journey.id), journey.id).toBe(true);
      }
    }
  });
});

export type { AcceptanceJourney };
