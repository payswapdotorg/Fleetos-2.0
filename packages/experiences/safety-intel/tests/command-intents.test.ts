/**
 * command-intents tests (F240B) — typed intent builders, the LOCAL
 * CommandDraft ↔ control-plane submit-contract seam (compile-pinned),
 * "never execute, never bypass Guardian" structural proofs, every refusal
 * code with exact cases, determinism.
 */
import { beforeAll, describe, it, expect } from "vitest";
import {
  proposeActionPlanStep,
  requestAdvisoryRefresh,
  requestRemediation,
  type CommandDraft,
  type SubmitCommandInputMirror,
} from "../src/command-intents.ts";
import type { GuardianDecision, PolicyVerdict } from "@fleetos/policy";
import type { AuthorizedCommand } from "@fleetos/execution";
import type { RemediationProposalRecord } from "@fleetos/security";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const base = {
  intentId: "intent-1",
  tenantId: "t1",
  actorId: "actor-7",
  requiredCapabilityId: "security.remediation",
  reason: "two critical findings on asset a-1",
  issuedAt: 1000,
} as const;

// ---------------------------------------------------------------------------
// The three builders
// ---------------------------------------------------------------------------

describe("requestRemediation", () => {
  it("builds a remediation-request draft with a deterministic key and payload", () => {
    const r = requestRemediation({
      ...base,
      proposalId: "rem-1",
      findingIds: ["f-2", "f-1", "f-2"],
      remediationKind: "patch",
    });
    if (!r.ok) throw new Error(`expected ok, got ${r.refused}`);
    expect(r.draft.kind).toBe("security.remediation.request");
    expect(r.draft.idempotencyKey).toBe("security.remediation.request|t1|intent-1");
    // Deduped + sorted finding ids — deterministic payload.
    expect(r.draft.payload).toEqual({
      proposalId: "rem-1",
      findingIds: ["f-1", "f-2"],
      remediationKind: "patch",
    });
    expect(r.draft.intent).toEqual({
      intentId: "intent-1",
      tenantId: "t1",
      actorId: "actor-7",
      requiredCapabilityId: "security.remediation",
      reason: "two critical findings on asset a-1",
      draft: true,
    });
  });
});

describe("proposeActionPlanStep", () => {
  it("builds a plan-step proposal draft", () => {
    const r = proposeActionPlanStep({
      ...base,
      planId: "plan-9",
      stepId: "s-1",
      stepCapabilityId: "cap.device.reboot",
      stepInputs: { assetId: "a-1" },
    });
    if (!r.ok) throw new Error(`expected ok, got ${r.refused}`);
    expect(r.draft.kind).toBe("actions.plan-step.propose");
    expect(r.draft.payload).toEqual({
      planId: "plan-9",
      stepId: "s-1",
      capabilityId: "cap.device.reboot",
      inputs: { assetId: "a-1" },
    });
    expect(r.draft.intent.draft).toBe(true);
  });
});

describe("requestAdvisoryRefresh", () => {
  it("builds an advisory-refresh request draft with the horizon", () => {
    const r = requestAdvisoryRefresh({
      ...base,
      assetId: "a-1",
      metric: "temperature",
      horizonSteps: 5,
      horizonStepMs: 60000,
    });
    if (!r.ok) throw new Error(`expected ok, got ${r.refused}`);
    expect(r.draft.kind).toBe("predictive.advisory.refresh-request");
    expect(r.draft.payload).toEqual({
      assetId: "a-1",
      metric: "temperature",
      horizon: { steps: 5, stepMs: 60000 },
    });
  });

  it("carries notBefore through the submit-contract seam when supplied", () => {
    const r = requestAdvisoryRefresh({
      ...base,
      assetId: "a-1",
      metric: "temperature",
      horizonSteps: 5,
      horizonStepMs: 60000,
      notBefore: 5000,
    });
    if (!r.ok) throw new Error("expected ok");
    expect(r.draft.notBefore).toBe(5000);
  });
});

// ---------------------------------------------------------------------------
// THE SEAM — CommandDraft ↔ control-plane submit contract (compile-pinned)
// ---------------------------------------------------------------------------

describe("the CommandDraft ↔ control-plane submit seam", () => {
  let draft: CommandDraft;
  beforeAll(() => {
    const r = requestRemediation({
      ...base,
      proposalId: "rem-1",
      findingIds: ["f-1"],
      remediationKind: "patch",
    });
    if (!r.ok) throw new Error("expected ok");
    draft = r.draft;
  });

  it("a CommandDraft is structurally assignable to the submit-contract mirror (NO adaptation)", () => {
    // NO @ts-expect-error here — this assignment MUST compile: the four
    // top-level fields mirror the control-plane SubmitCommandInput exactly.
    const asSubmitShape: SubmitCommandInputMirror = draft;
    expect(asSubmitShape.kind).toBe(draft.kind);
    expect(asSubmitShape.idempotencyKey).toBe(draft.idempotencyKey);
    expect(asSubmitShape.issuedAt).toBe(draft.issuedAt);
    expect(asSubmitShape.payload).toBe(draft.payload);
  });

  it("a CommandDraft is NOT a GuardianDecision (compile-pinned, law A5)", () => {
    // @ts-expect-error — a draft carries no verdict/reasonCode/decisionDigest;
    // the Guardian is the sole authorization authority.
    const notAnAuthorization: GuardianDecision = draft;
    expect(notAnAuthorization).toBeDefined();
  });

  it("a CommandDraft is NOT an AuthorizedCommand — there is no execute path (compile-pinned)", () => {
    // @ts-expect-error — the executor accepts AuthorizedCommand only; a draft
    // can never be dispatched straight to execution.
    const notExecutable: AuthorizedCommand = draft;
    expect(notExecutable).toBeDefined();
  });

  it("the draft metadata machine-carries draft: true and no authorization field exists", () => {
    expect(draft.intent.draft).toBe(true);
    expect("authorization" in draft).toBe(false);
    expect("verdict" in draft).toBe(false);
    expect("authorizationDigest" in draft).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Refusal codes — every code, exact case
// ---------------------------------------------------------------------------

describe("refusal codes (exact cases)", () => {
  const valid = {
    ...base,
    proposalId: "rem-1",
    findingIds: ["f-1"],
    remediationKind: "patch",
  };

  const cases: readonly { label: string; code: string; input: Record<string, unknown> }[] = [
    { label: "missing tenant", code: "intent.missing-tenant", input: { tenantId: "" } },
    { label: "missing intent id", code: "intent.missing-intent-id", input: { intentId: "" } },
    { label: "missing actor", code: "intent.missing-actor", input: { actorId: "" } },
    { label: "missing capability", code: "intent.missing-capability", input: { requiredCapabilityId: "" } },
    { label: "missing reason", code: "intent.missing-reason", input: { reason: "" } },
    { label: "invalid issuedAt (zero)", code: "intent.invalid-issued-at", input: { issuedAt: 0 } },
    { label: "invalid issuedAt (fractional)", code: "intent.invalid-issued-at", input: { issuedAt: 1.5 } },
    { label: "invalid notBefore (zero)", code: "intent.invalid-not-before", input: { notBefore: 0 } },
    { label: "missing proposal id", code: "intent.missing-proposal", input: { proposalId: "" } },
    { label: "empty finding set", code: "intent.missing-finding", input: { findingIds: [] } },
    { label: "empty finding id inside the set", code: "intent.missing-finding", input: { findingIds: ["f-1", ""] } },
  ];

  for (const c of cases) {
    it(`refuses ${c.label} with ${c.code}`, () => {
      const r = requestRemediation({ ...valid, ...c.input } as unknown as Parameters<typeof requestRemediation>[0]);
      expect(r).toMatchObject({ ok: false, refused: c.code });
    });
  }

  it("refuses a missing plan / step / step capability with exact codes", () => {
    const planValid = {
      ...base,
      planId: "plan-9",
      stepId: "s-1",
      stepCapabilityId: "cap.x",
      stepInputs: {},
    };
    expect(
      proposeActionPlanStep({ ...planValid, planId: "" }),
    ).toMatchObject({ ok: false, refused: "intent.missing-plan" });
    expect(
      proposeActionPlanStep({ ...planValid, stepId: "" }),
    ).toMatchObject({ ok: false, refused: "intent.missing-step" });
    expect(
      proposeActionPlanStep({ ...planValid, stepCapabilityId: "" }),
    ).toMatchObject({ ok: false, refused: "intent.missing-capability" });
  });

  it("refuses a missing asset / metric / invalid horizon with exact codes", () => {
    const refreshValid = {
      ...base,
      assetId: "a-1",
      metric: "temperature",
      horizonSteps: 5,
      horizonStepMs: 60000,
    };
    expect(
      requestAdvisoryRefresh({ ...refreshValid, assetId: "" }),
    ).toMatchObject({ ok: false, refused: "intent.missing-asset" });
    expect(
      requestAdvisoryRefresh({ ...refreshValid, metric: "" }),
    ).toMatchObject({ ok: false, refused: "intent.missing-metric" });
    expect(
      requestAdvisoryRefresh({ ...refreshValid, horizonSteps: 0 }),
    ).toMatchObject({ ok: false, refused: "intent.invalid-horizon" });
    expect(
      requestAdvisoryRefresh({ ...refreshValid, horizonStepMs: 0.5 }),
    ).toMatchObject({ ok: false, refused: "intent.invalid-horizon" });
  });
});

// ---------------------------------------------------------------------------
// Determinism + refusal detail honesty
// ---------------------------------------------------------------------------

describe("determinism and honesty", () => {
  it("same inputs => byte-identical drafts across all three builders", () => {
    const inputs = [
      () => requestRemediation({
        ...base,
        proposalId: "rem-1",
        findingIds: ["f-1", "f-2"],
        remediationKind: "patch",
      }),
      () => proposeActionPlanStep({
        ...base,
        planId: "plan-9",
        stepId: "s-1",
        stepCapabilityId: "cap.x",
        stepInputs: { a: 1 },
      }),
      () => requestAdvisoryRefresh({
        ...base,
        assetId: "a-1",
        metric: "temperature",
        horizonSteps: 5,
        horizonStepMs: 60000,
      }),
    ];
    for (const build of inputs) {
      expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
    }
  });

  it("refusals carry a human-readable detail (no bare codes)", () => {
    const r = requestRemediation({ ...base, proposalId: "", findingIds: ["f-1"], remediationKind: "patch" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.detail.length).toBeGreaterThan(0);
  });

  it("distinct intents produce distinct idempotency keys", () => {
    const a = requestRemediation({
      ...base,
      proposalId: "rem-1",
      findingIds: ["f-1"],
      remediationKind: "patch",
    });
    const b = requestRemediation({
      ...base,
      intentId: "intent-2",
      proposalId: "rem-1",
      findingIds: ["f-1"],
      remediationKind: "patch",
    });
    if (!a.ok || !b.ok) throw new Error("expected ok");
    expect(a.draft.idempotencyKey).not.toBe(b.draft.idempotencyKey);
  });
});

// ---------------------------------------------------------------------------
// Cross-module advisory law: an advisory card is NOT an intent input
// ---------------------------------------------------------------------------

describe("advisory values cannot feed back as intent inputs", () => {
  it("an advisory-shaped value cannot be passed as an intent builder input (compile-pinned)", () => {
    const cardLike = {
      cardId: "advisory|pred|t1|a-1|temperature|d",
      tenantId: "t1",
      title: "Predicted temperature for a-1",
      advisory: true,
      confidenceBps: 8000,
      provenance: { modelVersion: "m", method: "reference.linear-drift", observationRefs: [], inputDigest: "d" },
      staleness: "fresh",
      ageMs: 0,
    };
    // @ts-expect-error — advisory card data lacks every required scalar input
    // (proposalId, findingIds, remediationKind) — feeding a card back as an
    // authoritative intent input is a TYPE ERROR at the view boundary.
    const r = requestRemediation(cardLike);
    expect(r).toBeDefined();
  });

  it("a remediation draft is not assignable to a domain record type (compile-pinned)", () => {
    const r = requestRemediation({
      ...base,
      proposalId: "rem-1",
      findingIds: ["f-1"],
      remediationKind: "patch",
    });
    if (!r.ok) throw new Error("expected ok");
    // @ts-expect-error — a CommandDraft is presentation data, not a domain
    // remediation record (no lifecycle state, no evidence gates).
    const notARemediationRecord: RemediationProposalRecord = r.draft;
    expect(notARemediationRecord).toBeDefined();
    // @ts-expect-error — and not a policy verdict either.
    const notAVerdict: PolicyVerdict = r.draft.intent.draft;
    expect(notAVerdict).toBeDefined();
  });
});
