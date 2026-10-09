/**
 * Predictive-honesty + host-intent machine tests (F300B deliverables 1+4).
 *
 * Predictive honesty (packet law):
 *  - advisory: true machine-carried end-to-end (card, board, route);
 *  - provenance + uncertainty (integer bps / honest null) + model identity
 *    surfaced on the host view models;
 *  - the JEPA structural analogue and the reference twin are labeled
 *    DETERMINISTIC STRUCTURAL/REFERENCE models — trainedValidated false,
 *    structuralAnalogue true, NEVER claimed as trained/validated accuracy;
 *  - the structural-vs-trained differentiation is machine-readable
 *    (ModelHonestyDisclosure.modelClass) and FAIL-CLOSED: an unknown model
 *    identity is refused, never guessed;
 *  - the trained/validated registry is honestly EMPTY today.
 *
 * Host intents (inert-intent law):
 *  - the dispatcher produces inert CommandDraft records (draft: true) for
 *    the 3 catalogued events, byte-identical for identical inputs;
 *  - unknown event ids are refused; builder validation surfaces verbatim.
 */
import { describe, it, expect } from "vitest";
import {
  classifyModelHonesty,
  modelHonestyRegistryView,
} from "../src/host/honesty.ts";
import { buildAdvisoryBoardRouteView } from "../src/host/advisory-route.ts";
import {
  buildHostIntentDraft,
  buildHostIntentDraftUntyped,
  hostIntentEventIds,
} from "../src/host/intents.ts";
import type { HostIntentRequest } from "../src/host/intents.ts";
import {
  TENANT_ID,
  fullSlice,
  hostCtx,
  prediction,
  worldContext,
  NOW_MS,
  THRESHOLDS,
} from "./host-fixture.ts";
import { buildViewModels } from "../src/host/view-models.ts";

describe("classifyModelHonesty — the machine-readable class differentiation", () => {
  it("discloses the reference twin as a deterministic structural/reference model", () => {
    const result = classifyModelHonesty({
      modelVersion: "reference-twin-1.0.0",
      method: "reference.linear-drift",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.disclosure.modelClass).toBe("deterministic-structural-reference");
    expect(result.disclosure.trainedValidated).toBe(false);
    expect(result.disclosure.structuralAnalogue).toBe(true);
    expect(result.disclosure.statement).toContain("not trained");
  });

  it("discloses the JEPA structural analogue as deterministic structural/reference — NEVER trained", () => {
    for (const modelVersion of ["jepa-1.0.0"]) {
      const result = classifyModelHonesty({ modelVersion });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.disclosure.modelClass).toBe("deterministic-structural-reference");
      expect(result.disclosure.trainedValidated).toBe(false);
      expect(result.disclosure.structuralAnalogue).toBe(true);
      expect(result.disclosure.statement).toContain("structural");
      expect(result.disclosure.statement).toContain("NOT a trained model");
    }
  });

  it("discloses world-context assembly as deterministic structural/reference", () => {
    const result = classifyModelHonesty({
      modelVersion: "world-context@2.1.0",
      method: "context.assembly",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.disclosure.modelClass).toBe("deterministic-structural-reference");
    expect(result.disclosure.trainedValidated).toBe(false);
  });

  it("REFUSES an unknown model identity — the class is never guessed", () => {
    const result = classifyModelHonesty({
      modelVersion: "vendor-forecast-9",
      method: "trained.nn",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refused).toBe("honesty.unknown-model-identity");
    expect(result.detail).toContain("vendor-forecast-9");
  });

  it("REFUSES an empty model identity", () => {
    const result = classifyModelHonesty({ modelVersion: "" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refused).toBe("honesty.unknown-model-identity");
  });

  it("classification is deterministic (pure function of identity)", () => {
    const a = classifyModelHonesty({ modelVersion: "jepa-1.0.0" });
    const b = classifyModelHonesty({ modelVersion: "jepa-1.0.0" });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("modelHonestyRegistryView — the honest registry", () => {
  it("lists the structural/reference models with the machine-readable class", () => {
    const view = modelHonestyRegistryView();
    expect(view.structuralReference.length).toBe(3);
    for (const entry of view.structuralReference) {
      expect(entry.modelClass).toBe("deterministic-structural-reference");
      expect(entry.trainedValidated).toBe(false);
      expect(entry.structuralAnalogue).toBe(true);
    }
    expect(view.structuralReference.map((e) => e.modelVersion)).toContain("jepa-1.0.0");
  });

  it("the trained/validated list is HONESTLY EMPTY (no trained models shipped)", () => {
    const view = modelHonestyRegistryView();
    expect(view.trainedValidated).toEqual([]);
  });
});

describe("buildAdvisoryBoardRouteView — the honesty join over REAL cards", () => {
  it("joins every REAL card with its model-honesty disclosure", () => {
    const result = buildAdvisoryBoardRouteView({
      tenantId: TENANT_ID,
      nowMs: NOW_MS,
      thresholds: THRESHOLDS,
      predictions: [prediction()],
      worldContexts: [worldContext()],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const view = result.view;
    expect(view.composed).toBe(true);
    if (!view.composed) return;
    expect(view.advisory).toBe(true);
    expect(view.board.advisory).toBe(true);
    expect(view.board.cards.length).toBe(2);
    expect(view.cardHonesty.length).toBe(2);
    for (const entry of view.cardHonesty) {
      expect(entry.modelIdentity.modelClass).toBe("deterministic-structural-reference");
      expect(entry.modelIdentity.trainedValidated).toBe(false);
      expect(entry.modelIdentity.structuralAnalogue).toBe(true);
    }
    // Uncertainty + provenance carried on the join: the prediction card has
    // integer bps, the world-context card carries the HONEST null.
    const predEntry = view.cardHonesty.find((e) => e.cardId.includes("|pred|"));
    const ctxEntry = view.cardHonesty.find((e) => e.cardId.includes("|ctx|"));
    expect(predEntry?.confidenceBps).toBe(2500);
    expect(ctxEntry?.confidenceBps).toBeNull();
    expect(predEntry?.modelIdentity.modelVersion).toBe("reference-twin-1.0.0");
    expect(predEntry?.modelIdentity.method).toBe("reference.linear-drift");
  });

  it("is deterministic: same inputs => byte-identical route view", () => {
    const input = {
      tenantId: TENANT_ID,
      nowMs: NOW_MS,
      thresholds: THRESHOLDS,
      predictions: [prediction()],
      worldContexts: [worldContext()],
    };
    const a = buildAdvisoryBoardRouteView(input);
    const b = buildAdvisoryBoardRouteView(input);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("refuses a cross-tenant prediction, offender named", () => {
    const result = buildAdvisoryBoardRouteView({
      tenantId: TENANT_ID,
      nowMs: NOW_MS,
      thresholds: THRESHOLDS,
      predictions: [{ ...prediction(), tenant: { tenantId: "globex-rival" } }],
      worldContexts: [],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refused).toBe("advisory.cross-tenant-prediction");
    expect(result.detail).toContain("globex-rival");
  });

  it("zero cards compose the honest empty route (advisory still carried)", () => {
    const result = buildAdvisoryBoardRouteView({
      tenantId: TENANT_ID,
      nowMs: NOW_MS,
      thresholds: THRESHOLDS,
      predictions: [],
      worldContexts: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.composed).toBe(false);
    if (result.view.composed) return;
    expect(result.view.advisory).toBe(true);
    expect(result.view.reason).toBe("no-advisory-cards");
  });
});

describe("host view models carry the honesty surface (end-to-end)", () => {
  it("the advisory route on the composed slice carries disclosures + registry", () => {
    const result = buildViewModels(fullSlice(), hostCtx());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const route = result.views.routes["advisory-board"];
    expect(route.advisory).toBe(true);
    if (!route.composed) return;
    expect(route.cardHonesty.length).toBe(2);
    expect(route.modelRegistry.structuralReference.length).toBe(3);
    expect(route.modelRegistry.trainedValidated).toEqual([]);
    expect(route.board.cards.every((c) => c.advisory === true)).toBe(true);
  });
});

describe("buildHostIntentDraft — inert CommandDraft dispatch", () => {
  const base = {
    intentId: "intent-host-1",
    tenantId: TENANT_ID,
    actorId: "operator-ada",
    requiredCapabilityId: "fleetos.security.remediation",
    reason: "operator requests credential rotation from the findings board",
    issuedAt: NOW_MS,
  };

  it("builds an inert remediation draft for the catalogued event", () => {
    const result = buildHostIntentDraft({
      ...base,
      eventId: "security.findings.request-remediation",
      proposalId: "prop-rotate-1",
      findingIds: ["finding-weak-cred-1"],
      remediationKind: "rotate_credential",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.kind).toBe("security.remediation.request");
    expect(result.draft.intent.draft).toBe(true);
    expect(result.draft.intent.tenantId).toBe(TENANT_ID);
    expect(result.draft.idempotencyKey).toBe(`security.remediation.request|${TENANT_ID}|intent-host-1`);
    expect("authorization" in result.draft).toBe(false);
    expect("verdict" in result.draft).toBe(false);
  });

  it("builds an inert plan-step draft", () => {
    const result = buildHostIntentDraft({
      ...base,
      eventId: "security.plans.propose-step",
      planId: "plan-isolate-1",
      stepId: "step-2",
      stepCapabilityId: "fleetos.device.execute-command",
      stepInputs: { assetId: "pump-7" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.kind).toBe("actions.plan-step.propose");
    expect(result.draft.intent.draft).toBe(true);
  });

  it("builds an inert advisory-refresh draft", () => {
    const result = buildHostIntentDraft({
      ...base,
      eventId: "security.advisory.request-refresh",
      assetId: "pump-7",
      metric: "vibration",
      horizonSteps: 3,
      horizonStepMs: 1_000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.kind).toBe("predictive.advisory.refresh-request");
    expect(result.draft.intent.draft).toBe(true);
  });

  it("drafts are byte-identical for identical inputs (pure)", () => {
    const request: HostIntentRequest = {
      ...base,
      eventId: "security.advisory.request-refresh",
      assetId: "pump-7",
      metric: "vibration",
      horizonSteps: 3,
      horizonStepMs: 1_000,
    };
    const a = buildHostIntentDraft(request);
    const b = buildHostIntentDraft(request);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("builder validation surfaces verbatim (empty reason refused)", () => {
    const result = buildHostIntentDraft({
      ...base,
      reason: "",
      eventId: "security.findings.request-remediation",
      proposalId: "prop-rotate-1",
      findingIds: ["finding-weak-cred-1"],
      remediationKind: "rotate_credential",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refused).toBe("intent.missing-reason");
  });
});

describe("buildHostIntentDraftUntyped — untrusted event ids", () => {
  const payload = {
    intentId: "intent-host-2",
    tenantId: TENANT_ID,
    actorId: "operator-ada",
    requiredCapabilityId: "fleetos.security.remediation",
    reason: "operator requests credential rotation from the findings board",
    issuedAt: NOW_MS,
    proposalId: "prop-rotate-1",
    findingIds: ["finding-weak-cred-1"],
    remediationKind: "rotate_credential",
  };

  it("refuses an unknown event id (the catalog is the truth)", () => {
    const result = buildHostIntentDraftUntyped("security.unknown.event", payload);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refused).toBe("intent.unknown-event");
    expect(result.detail).toContain("security.unknown.event");
  });

  it("dispatches a catalogued event id to the right builder", () => {
    const result = buildHostIntentDraftUntyped("security.findings.request-remediation", payload);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.kind).toBe("security.remediation.request");
  });

  it("refuses a payload missing a catalogued required input (fail-loud, no undefined fields)", () => {
    const result = buildHostIntentDraftUntyped("security.findings.request-remediation", {
      intentId: "intent-host-3",
      tenantId: TENANT_ID,
      actorId: "operator-ada",
      requiredCapabilityId: "fleetos.security.remediation",
      reason: "operator requests credential rotation from the findings board",
      issuedAt: NOW_MS,
      // proposalId / findingIds / remediationKind deliberately absent
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refused).toBe("intent.missing-required-input");
    expect(result.detail).toContain("proposalId");
  });

  it("the catalogued event ids are exactly the 3 catalog entries", () => {
    expect(hostIntentEventIds()).toEqual([
      "security.findings.request-remediation",
      "security.plans.propose-step",
      "security.advisory.request-refresh",
    ]);
  });
});
