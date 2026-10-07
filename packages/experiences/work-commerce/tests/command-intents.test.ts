import { describe, expect, it } from "vitest";
import {
  draftCreateWorkOrder,
  draftApproveQuote,
  draftPlaceOrder,
  draftAllocateBudget,
  validateCommandDraft,
  computeDraftDigest,
  isCommandDraft,
  CREATE_WORK_ORDER_KIND,
  CREATE_WORK_ORDER_CAPABILITY,
  PLACE_ORDER_KIND,
} from "../src/command-intents.js";
import type { CommandDraft, CommandDraftResult } from "../src/command-intents.js";

const TENANT = { tenantId: "acme" };
const BASE = {
  tenant: TENANT,
  idempotencyKey: "idem-1",
  issuedAt: 1000,
  reason: "operator request",
};

function refusalOf(result: CommandDraftResult): string {
  if (result.ok) throw new Error("expected a refusal");
  return result.reasonCode;
}

function assertNoFunctionsDeep(value: unknown): boolean {
  if (typeof value === "function") return false;
  if (value === null || typeof value !== "object") return true;
  return Object.values(value).every((v) => assertNoFunctionsDeep(v));
}

describe("draftCreateWorkOrder", () => {
  it("builds an inert, digest-stamped draft with capability requirement + reason", () => {
    const result = draftCreateWorkOrder({ ...BASE, title: "Replace valve", projectId: "proj-1" });
    if (!result.ok) throw new Error(result.reasonCode);
    expect(result.draft.recordType).toBe("command-draft");
    expect(result.draft.tenantId).toBe("acme");
    expect(result.draft.command.kind).toBe(CREATE_WORK_ORDER_KIND);
    expect(result.draft.command.payload).toEqual({ title: "Replace valve", projectId: "proj-1" });
    expect(result.draft.command.idempotencyKey).toBe("idem-1");
    expect(result.draft.command.issuedAt).toBe(1000);
    expect(result.draft.command.notBefore).toBeUndefined();
    expect(result.draft.requiredCapability).toBe(CREATE_WORK_ORDER_CAPABILITY);
    expect(result.draft.reason).toBe("operator request");
    expect(result.draft.draftDigest).toMatch(/^draft_[0-9a-f]{8}$/);
    expect(assertNoFunctionsDeep(result.draft)).toBe(true);
    expect(validateCommandDraft(result.draft).ok).toBe(true);
  });

  it("is byte-identical for identical inputs regardless of payload key order", () => {
    const a = draftCreateWorkOrder({ ...BASE, title: "T", projectId: "p", assigneeId: "ag" });
    const b = draftCreateWorkOrder({ ...BASE, title: "T", assigneeId: "ag", projectId: "p" });
    if (!a.ok || !b.ok) throw new Error("refused");
    expect(JSON.stringify(a.draft)).toBe(JSON.stringify(b.draft));
  });

  it("refuses an empty title and a missing idempotency key with exact codes", () => {
    expect(refusalOf(draftCreateWorkOrder({ ...BASE, title: "  " }))).toBe("TITLE_REQUIRED");
    expect(refusalOf(draftCreateWorkOrder({ ...BASE, title: "T", idempotencyKey: "" }))).toBe(
      "missing-idempotency-key",
    );
  });
});

describe("draftApproveQuote / draftPlaceOrder", () => {
  it("builds the approve-quote draft with the quote lineage", () => {
    const result = draftApproveQuote({ ...BASE, quoteId: "q-1", demandId: "d-1" });
    if (!result.ok) throw new Error(result.reasonCode);
    expect(result.draft.command.payload).toEqual({ quoteId: "q-1", demandId: "d-1" });
    expect(result.draft.command.kind).toBe("procurement.approve-quote");
  });

  it("refuses an empty quoteId", () => {
    expect(refusalOf(draftApproveQuote({ ...BASE, quoteId: "" }))).toBe("QUOTE_ID_REQUIRED");
  });

  it("builds the place-order draft and refuses non-integer/negative money", () => {
    const ok = draftPlaceOrder({ ...BASE, quoteId: "q-1", vendorId: "v-1", totalCostMinor: 500 });
    if (!ok.ok) throw new Error(ok.reasonCode);
    expect(ok.draft.command.kind).toBe(PLACE_ORDER_KIND);
    expect(ok.draft.command.payload).toEqual({ quoteId: "q-1", vendorId: "v-1", totalCostMinor: 500 });

    expect(refusalOf(draftPlaceOrder({ ...BASE, quoteId: "q-1", totalCostMinor: 10.5 }))).toBe(
      "NON_INTEGER_AMOUNT",
    );
    expect(refusalOf(draftPlaceOrder({ ...BASE, quoteId: "q-1", totalCostMinor: -1 }))).toBe(
      "NEGATIVE_AMOUNT",
    );
    expect(refusalOf(draftPlaceOrder({ ...BASE, quoteId: "" }))).toBe("QUOTE_ID_REQUIRED");
  });

  it("carries notBefore when supplied and validates it", () => {
    const withDelay = draftPlaceOrder({ ...BASE, quoteId: "q-1", notBefore: 2000 });
    if (!withDelay.ok) throw new Error(withDelay.reasonCode);
    expect(withDelay.draft.command.notBefore).toBe(2000);
    expect(validateCommandDraft(withDelay.draft).ok).toBe(true);

    expect(refusalOf(draftPlaceOrder({ ...BASE, quoteId: "q-1", notBefore: 0 }))).toBe(
      "invalid-not-before",
    );
  });
});

describe("draftAllocateBudget", () => {
  it("builds the allocate-budget draft with integer minor-unit amounts", () => {
    const result = draftAllocateBudget({
      ...BASE,
      budgetId: "b-1",
      additionalUnits: 10,
      additionalSpendMinor: 2500,
    });
    if (!result.ok) throw new Error(result.reasonCode);
    expect(result.draft.command.payload).toEqual({
      budgetId: "b-1",
      additionalUnits: 10,
      additionalSpendMinor: 2500,
    });
    expect(result.draft.command.kind).toBe("org.allocate-budget");
  });

  it("refuses empty budgetId, non-integer and negative amounts", () => {
    expect(
      refusalOf(
        draftAllocateBudget({ ...BASE, budgetId: "", additionalUnits: 1, additionalSpendMinor: 1 }),
      ),
    ).toBe("BUDGET_ID_REQUIRED");
    expect(
      refusalOf(
        draftAllocateBudget({ ...BASE, budgetId: "b-1", additionalUnits: 1.5, additionalSpendMinor: 1 }),
      ),
    ).toBe("NON_INTEGER_AMOUNT");
    expect(
      refusalOf(
        draftAllocateBudget({ ...BASE, budgetId: "b-1", additionalUnits: 1, additionalSpendMinor: -5 }),
      ),
    ).toBe("NEGATIVE_AMOUNT");
  });
});

describe("draft envelope refusals", () => {
  it("refuses invalid tenants, capabilities, reasons, idempotency keys, and issuedAt", () => {
    expect(refusalOf(draftCreateWorkOrder({ ...BASE, tenant: { tenantId: "" }, title: "T" }))).toBe(
      "TENANT_ID_EMPTY",
    );
    expect(refusalOf(draftCreateWorkOrder({ ...BASE, tenant: { tenantId: "bad id" }, title: "T" }))).toBe(
      "TENANT_ID_INVALID_CHARS",
    );
    expect(
      refusalOf(draftCreateWorkOrder({ ...BASE, tenant: { tenantId: "x".repeat(129) }, title: "T" })),
    ).toBe("TENANT_ID_TOO_LONG");
    expect(refusalOf(draftCreateWorkOrder({ ...BASE, title: "T", requiredCapability: "" }))).toBe(
      "CAPABILITY_REQUIRED",
    );
    expect(refusalOf(draftCreateWorkOrder({ ...BASE, title: "T", reason: "  " }))).toBe(
      "INTENT_REASON_REQUIRED",
    );
    expect(refusalOf(draftCreateWorkOrder({ ...BASE, title: "T", issuedAt: 0 }))).toBe(
      "invalid-issued-at",
    );
    expect(refusalOf(draftCreateWorkOrder({ ...BASE, title: "T", issuedAt: Number.NaN }))).toBe(
      "invalid-issued-at",
    );
  });
});

describe("validateCommandDraft + guards", () => {
  const valid = draftCreateWorkOrder({ ...BASE, title: "T" });
  if (!valid.ok) throw new Error("fixture refused");

  it("rejects non-draft shapes and malformed submit contracts with the mirrored codes", () => {
    expect(refusalOf(validateCommandDraft({ kind: "not-a-draft" }))).toBe("NOT_A_DRAFT");
    expect(refusalOf(validateCommandDraft(null))).toBe("NOT_A_DRAFT");

    const noKind: CommandDraft = {
      ...valid.draft,
      command: { ...valid.draft.command, kind: "" },
    };
    expect(refusalOf(validateCommandDraft(noKind))).toBe("missing-kind");

    const noKey: CommandDraft = {
      ...valid.draft,
      command: { ...valid.draft.command, idempotencyKey: "" },
    };
    expect(refusalOf(validateCommandDraft(noKey))).toBe("missing-idempotency-key");

    const badIssuedAt: CommandDraft = {
      ...valid.draft,
      command: { ...valid.draft.command, issuedAt: -5 },
    };
    expect(refusalOf(validateCommandDraft(badIssuedAt))).toBe("invalid-issued-at");
  });

  it("detects digest tampering", () => {
    const tampered: CommandDraft = { ...valid.draft, reason: "rewritten" };
    expect(refusalOf(validateCommandDraft(tampered))).toBe("DIGEST_MISMATCH");
  });

  it("recomputes the digest over the canonical form", () => {
    const { draftDigest: _omit, ...base } = valid.draft;
    expect(computeDraftDigest(base)).toBe(valid.draft.draftDigest);
  });

  it("isCommandDraft guards runtime shapes", () => {
    expect(isCommandDraft(valid.draft)).toBe(true);
    expect(isCommandDraft({ recordType: "other" })).toBe(false);
    expect(isCommandDraft(null)).toBe(false);
    expect(isCommandDraft(42)).toBe(false);
  });
});
