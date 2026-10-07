/**
 * @fleetos/apify — Wave 1 kernel-grade tests.
 */
import { describe, expect, it } from "vitest";
import {
  createDeterministicApifyAdapter,
  proposeActorJob,
  isApifyProjection,
  DEFAULT_RETRY_POLICY,
  type TenantScope,
  type GuardianDecisionRefLike,
} from "../src/index.js";

const TENANT: TenantScope = { tenantId: "acme" };
const AUTH: GuardianDecisionRefLike = {
  decisionId: "d-1",
  authorized: true,
  reasonCode: "allow.matched_rule",
};

describe("DeterministicApifyAdapter — proposal/authorization boundary", () => {
  it("refuses with PROPOSAL_UNAUTHORIZED when the proposal has no authorization", () => {
    const adapter = createDeterministicApifyAdapter({
      simulateOutage: false,
      actors: { "actor-1": { ok: true } },
    });
    const proposal = proposeActorJob(TENANT, "actor-1", {}, "2026-01-01T00:00:00Z", "k-1");
    const result = adapter.runActorJob(proposal);
    expect(result).toEqual({ ok: false, reasonCode: "PROPOSAL_UNAUTHORIZED", attempts: 0 });
  });

  it("refuses with PROPOSAL_UNAUTHORIZED when authorization.authorized is false", () => {
    const adapter = createDeterministicApifyAdapter({
      simulateOutage: false,
      actors: {},
    });
    const proposal: import("../src/index.js").ActorJobProposal = {
      kind: "actor-job-proposal",
      tenant: TENANT,
      actorId: "actor-1",
      input: {},
      proposedAt: "2026-01-01T00:00:00Z",
      authorization: { decisionId: "d-2", authorized: false, reasonCode: "block.policy" },
      idempotencyKey: "k-1",
    };
    const result = adapter.runActorJob(proposal);
    expect(result).toEqual({ ok: false, reasonCode: "PROPOSAL_UNAUTHORIZED", attempts: 0 });
  });
});

describe("DeterministicApifyAdapter — idempotency", () => {
  it("returns the same output for the same idempotency key (cached)", () => {
    const adapter = createDeterministicApifyAdapter({
      simulateOutage: false,
      actors: { "actor-1": { result: "ok" } },
    });
    const proposal: import("../src/index.js").ActorJobProposal = {
      kind: "actor-job-proposal",
      tenant: TENANT,
      actorId: "actor-1",
      input: {},
      proposedAt: "2026-01-01T00:00:00Z",
      authorization: AUTH,
      idempotencyKey: "k-1",
    };
    const first = adapter.runActorJob(proposal);
    const second = adapter.runActorJob(proposal);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.fromCache).toBe(false);
      expect(second.fromCache).toBe(true);
      expect(first.output).toEqual(second.output);
    }
  });

  it("refuses with IDEMPOTENCY_KEY_EMPTY when the key is empty", () => {
    const adapter = createDeterministicApifyAdapter({
      simulateOutage: false,
      actors: { "actor-1": { result: "ok" } },
    });
    const proposal: import("../src/index.js").ActorJobProposal = {
      kind: "actor-job-proposal",
      tenant: TENANT,
      actorId: "actor-1",
      input: {},
      proposedAt: "2026-01-01T00:00:00Z",
      authorization: AUTH,
      idempotencyKey: "  ",
    };
    const result = adapter.runActorJob(proposal);
    expect(result).toEqual({ ok: false, reasonCode: "IDEMPOTENCY_KEY_EMPTY", attempts: 0 });
  });
});

describe("DeterministicApifyAdapter — honest degraded states", () => {
  it("returns APIFY_UNAVAILABLE after retries when simulateOutage is true", () => {
    const adapter = createDeterministicApifyAdapter({
      simulateOutage: true,
      actors: {},
    });
    const proposal: import("../src/index.js").ActorJobProposal = {
      kind: "actor-job-proposal",
      tenant: TENANT,
      actorId: "actor-1",
      input: {},
      proposedAt: "2026-01-01T00:00:00Z",
      authorization: AUTH,
      idempotencyKey: "k-1",
    };
    const result = adapter.runActorJob(proposal);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("APIFY_UNAVAILABLE");
      expect(result.attempts).toBe(DEFAULT_RETRY_POLICY.maxAttempts);
    }
  });

  it("returns ACTOR_UNKNOWN when the actor id is not in the config", () => {
    const adapter = createDeterministicApifyAdapter({
      simulateOutage: false,
      actors: {},
    });
    const proposal: import("../src/index.js").ActorJobProposal = {
      kind: "actor-job-proposal",
      tenant: TENANT,
      actorId: "missing-actor",
      input: {},
      proposedAt: "2026-01-01T00:00:00Z",
      authorization: AUTH,
      idempotencyKey: "k-1",
    };
    const result = adapter.runActorJob(proposal);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("ACTOR_UNKNOWN");
    }
  });

  it("refuses with TENANT_SCOPE_MISSING on broken tenant", () => {
    const adapter = createDeterministicApifyAdapter({
      simulateOutage: false,
      actors: {},
    });
    const proposal: import("../src/index.js").ActorJobProposal = {
      kind: "actor-job-proposal",
      tenant: { tenantId: "" } as unknown as TenantScope,
      actorId: "actor-1",
      input: {},
      proposedAt: "2026-01-01T00:00:00Z",
      authorization: AUTH,
      idempotencyKey: "k-1",
    };
    const result = adapter.runActorJob(proposal);
    expect(result).toEqual({ ok: false, reasonCode: "TENANT_SCOPE_MISSING", attempts: 0 });
  });
});

describe("determinism", () => {
  it("returns the same result payload for the same inputs across calls (idempotency)", () => {
    const adapter = createDeterministicApifyAdapter({
      simulateOutage: false,
      actors: { "actor-1": { result: "ok" } },
    });
    const proposal: import("../src/index.js").ActorJobProposal = {
      kind: "actor-job-proposal",
      tenant: TENANT,
      actorId: "actor-1",
      input: {},
      proposedAt: "2026-01-01T00:00:00Z",
      authorization: AUTH,
      idempotencyKey: "k-determinism",
    };
    const a = adapter.runActorJob(proposal);
    const b = adapter.runActorJob(proposal);
    expect(a.ok).toBe(b.ok);
    if (a.ok && b.ok) {
      expect(a.output).toEqual(b.output);
      expect(b.fromCache).toBe(true);
    }
  });
});

describe("proposeActorJob — proposal factory", () => {
  it("constructs an unauthorized proposal by default", () => {
    const proposal = proposeActorJob(TENANT, "actor-1", { x: 1 }, "2026-01-01T00:00:00Z", "k-1");
    expect(proposal.kind).toBe("actor-job-proposal");
    expect(proposal.authorization).toBeNull();
    expect(proposal.actorId).toBe("actor-1");
    expect(proposal.idempotencyKey).toBe("k-1");
  });
});

describe("boundary assertions", () => {
  it("isApifyProjection returns true for kind=apify-projection", () => {
    expect(isApifyProjection({ kind: "apify-projection" })).toBe(true);
  });

  it("isApifyProjection returns false for domain kinds", () => {
    expect(isApifyProjection({ kind: "asset" })).toBe(false);
  });

  it("isApifyProjection returns false when kind is missing", () => {
    expect(isApifyProjection({})).toBe(false);
  });
});
