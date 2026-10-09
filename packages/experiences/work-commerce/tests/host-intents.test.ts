import { describe, expect, it } from "vitest";
import {
  intentForEvent,
  intentsForRoute,
  intentsOfferedTo,
  isIntentOfferedToRole,
  verifyIntentCatalog,
  buildIntentForEvent,
} from "../src/host/index.js";
import { validateCommandDraft, computeDraftDigest } from "../src/command-intents.js";

const TENANT = "acme";
const NOW = 1774000000000;
const REASON = "host-intent machine test";

describe("host intent catalog — data integrity", () => {
  it("catalog verifies: unique ids/events, known builders, declared routes, roles", () => {
    expect(verifyIntentCatalog()).toEqual([]);
  });

  it("resolves events deterministically and refuses unknown events at build", () => {
    expect(intentForEvent("work-board:create-work-order")?.intentId).toBe("work-commerce.create-work-order");
    expect(intentForEvent("nope:nope")).toBeNull();
    const unknown = buildIntentForEvent("nope:nope", { tenantId: TENANT, issuedAt: NOW, reason: REASON });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.rejected).toBe("unknown-intent-event");
  });

  it("serves intents per route and per role lens in catalog order", () => {
    expect(intentsForRoute("procurement-spine").map((i) => i.intentId)).toEqual([
      "work-commerce.approve-quote",
      "work-commerce.place-order",
    ]);
    expect(intentsOfferedTo("finance-controller").map((i) => i.intentId)).toEqual([
      "work-commerce.approve-quote",
      "work-commerce.allocate-budget",
    ]);
    expect(intentsOfferedTo("vendor-manager")).toEqual([]);
    expect(isIntentOfferedToRole("org-budgets:allocate-budget", "org-optimizer")).toBe(true);
    expect(isIntentOfferedToRole("org-budgets:allocate-budget", "procurement-lead")).toBe(false);
  });
});

describe("buildIntentForEvent — inert drafts over the EXISTING builders", () => {
  it("builds a create-work-order draft whose digest validates through the lane contract", () => {
    const result = buildIntentForEvent(
      "work-board:create-work-order",
      { tenantId: TENANT, issuedAt: NOW, reason: REASON, title: "Replace hoist cable", projectId: "proj-1" },
      "operations-manager",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.detail);
    expect(result.intent.intentId).toBe("work-commerce.create-work-order");
    expect(result.draft.recordType).toBe("command-draft");
    expect(result.draft.tenantId).toBe(TENANT);
    expect(result.draft.command.kind).toBe("work.create-work-order");
    expect(result.draft.requiredCapability).toBe("work.order.create");
    expect(result.draft.command.idempotencyKey).toBe("host:work.create-work-order:Replace hoist cable");
    expect(validateCommandDraft(result.draft).ok).toBe(true);
    // Inert + stable: same subject re-drafted at the same instant is
    // byte-identical; at a different instant the draft honestly carries
    // the new issuedAt while the idempotency key (the queue dedupe law)
    // stays subject-stable.
    const again = buildIntentForEvent(
      "work-board:create-work-order",
      { tenantId: TENANT, issuedAt: NOW, reason: REASON, title: "Replace hoist cable", projectId: "proj-1" },
      "operations-manager",
    );
    expect(again.ok && JSON.stringify(again.draft)).toBe(JSON.stringify(result.draft));
    const later = buildIntentForEvent(
      "work-board:create-work-order",
      { tenantId: TENANT, issuedAt: NOW + 1, reason: REASON, title: "Replace hoist cable" },
      "operations-manager",
    );
    expect(later.ok && later.draft.command.idempotencyKey).toBe(result.draft.command.idempotencyKey);
    expect(later.ok && JSON.stringify(later.draft)).not.toBe(JSON.stringify(result.draft));
    expect(later.ok && later.draft.command.issuedAt).toBe(NOW + 1);
  });

  it("builds approve-quote, place-order and allocate-budget drafts with subject-key idempotency", () => {
    const approve = buildIntentForEvent(
      "procurement-spine:approve-quote",
      { tenantId: TENANT, issuedAt: NOW, reason: REASON, quoteId: "q-1", demandId: "d-1" },
      "procurement-lead",
    );
    if (!approve.ok) throw new Error(approve.detail);
    expect(approve.draft.command.kind).toBe("procurement.approve-quote");
    expect(approve.draft.command.idempotencyKey).toBe("host:procurement.approve-quote:q-1");

    const place = buildIntentForEvent(
      "procurement-spine:place-order",
      { tenantId: TENANT, issuedAt: NOW, reason: REASON, quoteId: "q-1", vendorId: "v-1", totalCostMinor: 30_000 },
      "procurement-lead",
    );
    if (!place.ok) throw new Error(place.detail);
    expect(place.draft.command.kind).toBe("procurement.place-order");
    expect(validateCommandDraft(place.draft).ok).toBe(true);

    const budget = buildIntentForEvent(
      "org-budgets:allocate-budget",
      { tenantId: TENANT, issuedAt: NOW, reason: REASON, budgetId: "b-1", additionalUnits: 5, additionalSpendMinor: 2_500 },
      "org-optimizer",
    );
    if (!budget.ok) throw new Error(budget.detail);
    expect(budget.draft.command.kind).toBe("org.allocate-budget");
    expect(budget.draft.command.idempotencyKey).toBe("host:org.allocate-budget:b-1:5:2500");
    expect(validateCommandDraft(budget.draft).ok).toBe(true);
  });

  it("propagates builder refusals with the builder's reason code (never softened)", () => {
    const emptyTitle = buildIntentForEvent(
      "work-board:create-work-order",
      { tenantId: TENANT, issuedAt: NOW, reason: REASON, title: "   " },
      "operations-manager",
    );
    expect(emptyTitle.ok).toBe(false);
    if (!emptyTitle.ok) {
      expect(emptyTitle.rejected).toBe("builder-refused");
      expect(emptyTitle.detail).toContain("TITLE_REQUIRED");
    }

    const negativeMoney = buildIntentForEvent(
      "procurement-spine:place-order",
      { tenantId: TENANT, issuedAt: NOW, reason: REASON, quoteId: "q-1", totalCostMinor: -5 },
      "procurement-lead",
    );
    expect(negativeMoney.ok).toBe(false);
    if (!negativeMoney.ok) expect(negativeMoney.detail).toContain("NEGATIVE_AMOUNT");

    const badTenant = buildIntentForEvent(
      "procurement-spine:approve-quote",
      { tenantId: "", issuedAt: NOW, reason: REASON, quoteId: "q-1" },
      "procurement-lead",
    );
    expect(badTenant.ok).toBe(false);
    if (!badTenant.ok) expect(badTenant.detail).toContain("TENANT_ID_EMPTY");
  });

  it("refuses missing builder-specific inputs before any draft exists", () => {
    const noTitle = buildIntentForEvent(
      "work-board:create-work-order",
      { tenantId: TENANT, issuedAt: NOW, reason: REASON },
      "operations-manager",
    );
    expect(noTitle.ok).toBe(false);
    if (!noTitle.ok) {
      expect(noTitle.rejected).toBe("missing-intent-input");
      expect(noTitle.detail).toContain("title");
    }
    const noBudget = buildIntentForEvent(
      "org-budgets:allocate-budget",
      { tenantId: TENANT, issuedAt: NOW, reason: REASON, budgetId: "b-1", additionalUnits: 1 },
      "org-optimizer",
    );
    expect(noBudget.ok).toBe(false);
    if (!noBudget.ok) expect(noBudget.detail).toContain("additionalSpendMinor");
  });

  it("tampered drafts fail the lane digest law", () => {
    const result = buildIntentForEvent(
      "procurement-spine:approve-quote",
      { tenantId: TENANT, issuedAt: NOW, reason: REASON, quoteId: "q-1" },
      "procurement-lead",
    );
    if (!result.ok) throw new Error(result.detail);
    const tampered = { ...result.draft, reason: "smuggled reason" };
    expect(validateCommandDraft(tampered).ok).toBe(false);
    const reDigested = { ...tampered, draftDigest: computeDraftDigest(tampered) };
    expect(validateCommandDraft(reDigested).ok).toBe(true);
  });
});
