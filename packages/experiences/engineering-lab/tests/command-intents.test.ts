/**
 * F261 — command intent tests: typed builders produce frozen inert
 * CommandDraft records via the LOCAL structural seam (no
 * @fleetos/control-plane import — F240 precedent), subject-keyed
 * deterministic idempotency, capability REQUIREMENT + mandatory audit
 * reason, ceilings-not-authorizations markers, mirrored rejection
 * vocabulary, digest verify + tamper, determinism.
 */

import { describe, expect, it } from "vitest";
import {
  buildLaunchExperimentIntent,
  buildRequestBenchmarkRunIntent,
  buildSubmitOptimizationProposalIntent,
  toSubmitInput,
  validateLabCommandDraft,
  verifyLabCommandDraftDigest,
} from "../src/command-intents.js";
import { CEILING_NOT_AUTHORIZATION } from "../src/lab-core.js";

const BASE = {
  tenantId: "lab-tenant-1",
  actorId: "act_labop001",
  reason: "quarterly experiment plan",
  issuedAt: 1_700_000_000_000,
} as const;

describe("launch experiment intent", () => {
  it("builds a frozen draft with capability, reason + the ceiling marker", () => {
    const result = buildLaunchExperimentIntent({
      ...BASE,
      worldId: "world-lab-main",
      scenarioId: "scenario-lab-1",
      steps: 6,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.kind).toBe("lab.experiment.launch");
    expect(result.draft.capabilityRequirement).toBe("lab.experiment.launch");
    expect(result.draft.payload).toEqual({
      worldId: "world-lab-main",
      scenarioId: "scenario-lab-1",
      steps: 6,
    });
    expect(result.draft.reason).toBe("quarterly experiment plan");
    expect(result.draft.ceiling).toBe(CEILING_NOT_AUTHORIZATION);
    expect(Object.isFrozen(result.draft)).toBe(true);
  });

  it("refuses malformed world/scenario/steps with exact codes", () => {
    expect(buildLaunchExperimentIntent({ ...BASE, worldId: "", scenarioId: "s", steps: 6 })).toMatchObject({
      rejected: "missing-world-id",
    });
    expect(buildLaunchExperimentIntent({ ...BASE, worldId: "w", scenarioId: "", steps: 6 })).toMatchObject({
      rejected: "missing-scenario-id",
    });
    expect(buildLaunchExperimentIntent({ ...BASE, worldId: "w", scenarioId: "s", steps: -1 })).toMatchObject({
      rejected: "invalid-step-count",
    });
    expect(buildLaunchExperimentIntent({ ...BASE, worldId: "w", scenarioId: "s", steps: 1.5 })).toMatchObject({
      rejected: "invalid-step-count",
    });
  });

  it("keys idempotency on the SUBJECT (same subject → same key; different → different)", () => {
    const a = buildLaunchExperimentIntent({ ...BASE, worldId: "w1", scenarioId: "s1", steps: 6 });
    const b = buildLaunchExperimentIntent({ ...BASE, worldId: "w1", scenarioId: "s1", steps: 6 });
    const c = buildLaunchExperimentIntent({ ...BASE, worldId: "w1", scenarioId: "s1", steps: 5 });
    expect(a.ok && b.ok && c.ok).toBe(true);
    if (!a.ok || !b.ok || !c.ok) return;
    expect(a.draft.idempotencyKey).toBe(b.draft.idempotencyKey);
    expect(a.draft.idempotencyKey).not.toBe(c.draft.idempotencyKey);
    // Same logical intent re-issued by another actor still dedupes per subject.
    const other = buildLaunchExperimentIntent({
      ...BASE,
      actorId: "act_other0001",
      worldId: "w1",
      scenarioId: "s1",
      steps: 6,
    });
    expect(other.ok).toBe(true);
    if (!other.ok) return;
    expect(other.draft.idempotencyKey).toBe(a.draft.idempotencyKey);
  });
});

describe("benchmark run-request intent", () => {
  it("builds the draft with the set digest + metric subject", () => {
    const result = buildRequestBenchmarkRunIntent({
      ...BASE,
      setDigest: "set_abc123",
      metric: "aggregate-bps",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.kind).toBe("lab.benchmark.run-request");
    expect(result.draft.capabilityRequirement).toBe("lab.benchmark.run");
    expect(result.draft.payload).toEqual({ setDigest: "set_abc123", metric: "aggregate-bps" });
  });

  it("refuses missing set digest / metric with exact codes", () => {
    expect(buildRequestBenchmarkRunIntent({ ...BASE, setDigest: "", metric: "m" })).toMatchObject({
      rejected: "missing-set-digest",
    });
    expect(buildRequestBenchmarkRunIntent({ ...BASE, setDigest: "s", metric: "" })).toMatchObject({
      rejected: "missing-metric",
    });
  });
});

describe("submit optimization proposal intent", () => {
  it("builds a draft for every proposal kind", () => {
    for (const proposalKind of ["role-allocation", "budget-rebalance", "routing", "what-if"] as const) {
      const result = buildSubmitOptimizationProposalIntent({
        ...BASE,
        organizationId: "org-1",
        proposalKind,
        proposalDigest: "roalloc_abc",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.draft.kind).toBe("lab.optimization.submit-proposal");
      expect(result.draft.capabilityRequirement).toBe("lab.optimization.proposal.submit");
      expect(result.draft.payload).toEqual({
        organizationId: "org-1",
        proposalKind,
        proposalDigest: "roalloc_abc",
      });
    }
  });

  it("refuses malformed organization / digest / kind with exact codes", () => {
    expect(
      buildSubmitOptimizationProposalIntent({ ...BASE, organizationId: "", proposalKind: "routing", proposalDigest: "d" }),
    ).toMatchObject({ rejected: "missing-organization-id" });
    expect(
      buildSubmitOptimizationProposalIntent({ ...BASE, organizationId: "o", proposalKind: "routing", proposalDigest: "" }),
    ).toMatchObject({ rejected: "missing-proposal-digest" });
    expect(
      buildSubmitOptimizationProposalIntent({ ...BASE, organizationId: "o", proposalKind: "exec" as never, proposalDigest: "d" }),
    ).toMatchObject({ rejected: "invalid-proposal-kind" });
  });
});

describe("common draft validation (mirrors the queue boundary)", () => {
  it("refuses missing tenant/actor/reason and invalid times with exact codes", () => {
    expect(buildLaunchExperimentIntent({ ...BASE, tenantId: "", worldId: "w", scenarioId: "s", steps: 1 })).toMatchObject({
      rejected: "missing-tenant",
    });
    expect(buildLaunchExperimentIntent({ ...BASE, actorId: "", worldId: "w", scenarioId: "s", steps: 1 })).toMatchObject({
      rejected: "missing-actor",
    });
    expect(buildLaunchExperimentIntent({ ...BASE, reason: "", worldId: "w", scenarioId: "s", steps: 1 })).toMatchObject({
      rejected: "missing-reason",
    });
    expect(buildLaunchExperimentIntent({ ...BASE, issuedAt: 0, worldId: "w", scenarioId: "s", steps: 1 })).toMatchObject({
      rejected: "invalid-issued-at",
    });
    expect(
      buildLaunchExperimentIntent({ ...BASE, notBefore: -1, worldId: "w", scenarioId: "s", steps: 1 }),
    ).toMatchObject({ rejected: "invalid-not-before" });
  });
});

describe("the structural seam (CommandSubmitInputMirror)", () => {
  function draft() {
    const result = buildLaunchExperimentIntent({
      ...BASE,
      worldId: "world-lab-main",
      scenarioId: "scenario-lab-1",
      steps: 6,
      notBefore: 1_700_000_001_000,
    });
    if (!result.ok) throw new Error("draft refused");
    return result.draft;
  }

  it("toSubmitInput carries the exact submit-boundary key set (notBefore present)", () => {
    const input = toSubmitInput(draft());
    expect(Object.keys(input).sort()).toEqual(["idempotencyKey", "issuedAt", "kind", "notBefore", "payload"]);
    expect(input.kind).toBe("lab.experiment.launch");
    expect(input.issuedAt).toBe(BASE.issuedAt);
    expect(Object.isFrozen(input)).toBe(true);
  });

  it("toSubmitInput omits notBefore when the draft carries none", () => {
    const result = buildRequestBenchmarkRunIntent({ ...BASE, setDigest: "s", metric: "m" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(toSubmitInput(result.draft)).sort()).toEqual(["idempotencyKey", "issuedAt", "kind", "payload"]);
  });

  it("validateLabCommandDraft mirrors the queue's rejection vocabulary", () => {
    const good = draft();
    expect(validateLabCommandDraft(good)).toEqual({ ok: true });
    expect(validateLabCommandDraft({ ...good, kind: "" as never })).toMatchObject({ rejected: "missing-kind" });
    expect(validateLabCommandDraft({ ...good, idempotencyKey: "" })).toMatchObject({
      rejected: "missing-idempotency-key",
    });
    expect(validateLabCommandDraft({ ...good, tenantId: "" })).toMatchObject({ rejected: "missing-tenant" });
    expect(validateLabCommandDraft({ ...good, issuedAt: 0 })).toMatchObject({ rejected: "invalid-issued-at" });
    expect(validateLabCommandDraft({ ...good, reason: "" })).toMatchObject({ rejected: "missing-reason" });
    expect(validateLabCommandDraft({ ...good, capabilityRequirement: "" })).toMatchObject({
      rejected: "missing-capability-requirement",
    });
  });

  it("digest verifies and detects tampering; drafts are byte-identical", () => {
    const a = draft();
    const b = draft();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(verifyLabCommandDraftDigest(a)).toBe(true);
    expect(verifyLabCommandDraftDigest({ ...a, reason: "tampered" })).toBe(false);
    expect(verifyLabCommandDraftDigest({ ...a, payload: { worldId: "other" } })).toBe(false);
  });

  it("drafts never execute: inert frozen data, no execute path on the shape", () => {
    const d = draft();
    const keys = Object.keys(d);
    expect(keys).not.toContain("execute");
    expect(keys).not.toContain("submit");
    expect(Object.isFrozen(d)).toBe(true);
  });
});
