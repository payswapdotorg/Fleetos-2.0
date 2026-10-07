/**
 * Capability grant-chain tests (F220B, Wave 2).
 *
 * Behavior under test: grant issuance validation, chain verification
 * (active / revoked / ancestor-revoked / expired / not-found / cycle),
 * revocation propagation to derived grants, idempotent re-revocation,
 * tenant fail-closed isolation.
 */
import { describe, it, expect } from "vitest";
import {
  issueGrant,
  verifyGrantChain,
  revokeGrant,
  activeGrantsForActor,
  assertGrantTenantIsolation,
} from "../src/index.ts";
import type { GrantRecord } from "../src/index.ts";

function root(overrides: Partial<GrantRecord> = {}): GrantRecord {
  return {
    grantId: "g-root",
    tenantId: "t1",
    capabilityId: "cap.execute.device.restart",
    granteeActorId: "actor-root",
    grantedByActorId: "guardian",
    grantedAt: 100,
    expiresAt: null,
    parentGrantId: null,
    status: "active",
    revokedAt: null,
    revokedBy: null,
    revocationReason: null,
    ...overrides,
  };
}

/** g-root -> g-mid -> g-leaf */
function chain(): GrantRecord[] {
  return [
    root(),
    root({ grantId: "g-mid", granteeActorId: "actor-mid", parentGrantId: "g-root", grantedAt: 200 }),
    root({ grantId: "g-leaf", granteeActorId: "actor-leaf", parentGrantId: "g-mid", grantedAt: 300 }),
  ];
}

describe("grant issuance", () => {
  it("issues a root grant (active, no parent)", () => {
    const r = issueGrant([], {
      grantId: "g-1",
      tenantId: "t1",
      capabilityId: "cap.read.health",
      granteeActorId: "actor-1",
      grantedByActorId: "guardian",
      grantedAt: 100,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.grant.status).toBe("active");
      expect(r.grant.parentGrantId).toBeNull();
      expect(r.grants).toHaveLength(1);
    }
  });

  it("refuses a missing tenant scope (fail-closed, A8)", () => {
    const r = issueGrant([], {
      grantId: "g-1", tenantId: "", capabilityId: "c", granteeActorId: "a", grantedByActorId: "g", grantedAt: 100,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("grant.missing-tenant");
  });

  it("refuses a missing grant id", () => {
    const r = issueGrant([], {
      grantId: "", tenantId: "t1", capabilityId: "c", granteeActorId: "a", grantedByActorId: "g", grantedAt: 100,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("grant.missing-grant-id");
  });

  it("refuses a duplicate grant id", () => {
    const r = issueGrant([root()], {
      grantId: "g-root", tenantId: "t1", capabilityId: "c", granteeActorId: "a", grantedByActorId: "g", grantedAt: 100,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("grant.duplicate-grant-id");
  });

  it("refuses an unknown parent", () => {
    const r = issueGrant([], {
      grantId: "g-2", tenantId: "t1", capabilityId: "c", granteeActorId: "a", grantedByActorId: "g", grantedAt: 100, parentGrantId: "nope",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("grant.unknown-parent");
  });

  it("refuses deriving from a parent of ANOTHER tenant (A8)", () => {
    const other = root({ tenantId: "t2" });
    const r = issueGrant([other], {
      grantId: "g-2", tenantId: "t1", capabilityId: "c", granteeActorId: "a", grantedByActorId: "g", grantedAt: 100, parentGrantId: "g-root",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("grant.parent-tenant-mismatch");
  });

  it("refuses deriving from a revoked parent", () => {
    const revoked = root({ status: "revoked", revokedAt: 150, revokedBy: "op", revocationReason: "compromise" });
    const r = issueGrant([revoked], {
      grantId: "g-2", tenantId: "t1", capabilityId: "c", granteeActorId: "a", grantedByActorId: "g", grantedAt: 200, parentGrantId: "g-root",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("grant.parent-revoked");
  });

  it("refuses an invalid grantedAt (negative / non-integer)", () => {
    const base = { grantId: "g-2", tenantId: "t1", capabilityId: "c", granteeActorId: "a", grantedByActorId: "g" };
    expect(issueGrant([], { ...base, grantedAt: -1 }).ok).toBe(false);
    expect(issueGrant([], { ...base, grantedAt: 1.5 }).ok).toBe(false);
  });
});

describe("grant chain verification", () => {
  it("verifies a healthy 3-level chain with the full ancestor walk", () => {
    const v = verifyGrantChain(chain(), "g-leaf", 400);
    expect(v.valid).toBe(true);
    if (v.valid) {
      expect(v.chainDepth).toBe(3);
      expect(v.checkedGrantIds).toEqual(["g-leaf", "g-mid", "g-root"]);
    }
  });

  it("refuses an unknown grant id", () => {
    const v = verifyGrantChain(chain(), "g-nope", 400);
    expect(v.valid).toBe(false);
    if (!v.valid) expect(v.reason).toBe("grant.not-found");
  });

  it("refuses a directly revoked grant with grant.revoked", () => {
    const grants = revokeGrant(chain(), "g-leaf", 500, "op-1", "policy change");
    if (!grants.ok) throw new Error(grants.reason);
    const v = verifyGrantChain(grants.grants, "g-leaf", 600);
    expect(v.valid).toBe(false);
    if (!v.valid) expect(v.reason).toBe("grant.revoked");
  });

  it("refuses a chain whose ANCESTOR is revoked but the leaf is not (hand-built store)", () => {
    // Propagation normally revokes descendants together with the ancestor;
    // this hand-built store models a partially-applied revocation — the
    // verifier must still fail closed on the revoked ancestor.
    const grants: GrantRecord[] = [
      root(),
      root({ grantId: "g-mid", parentGrantId: "g-root", grantedAt: 200, status: "revoked", revokedAt: 450, revokedBy: "op", revocationReason: "manual" }),
      root({ grantId: "g-leaf", parentGrantId: "g-mid", grantedAt: 300 }),
    ];
    const v = verifyGrantChain(grants, "g-leaf", 600);
    expect(v.valid).toBe(false);
    if (!v.valid) {
      expect(v.reason).toBe("grant.ancestor-revoked");
      expect(v.checkedGrantIds).toEqual(["g-leaf", "g-mid"]);
    }
  });

  it("revoking via revokeGrant leaves NO active descendant (propagation closes the gap)", () => {
    const grants = revokeGrant(chain(), "g-mid", 500, "op-1", "policy change");
    if (!grants.ok) throw new Error(grants.reason);
    const v = verifyGrantChain(grants.grants, "g-leaf", 600);
    expect(v.valid).toBe(false);
    if (!v.valid) expect(v.reason).toBe("grant.revoked");
  });

  it("refuses an expired grant (expiry is checked at the verification instant)", () => {
    const grants = [root({ expiresAt: 1_000 })];
    expect(verifyGrantChain(grants, "g-root", 999).valid).toBe(true);
    expect(verifyGrantChain(grants, "g-root", 1_000).valid).toBe(true); // expiry is inclusive
    const v = verifyGrantChain(grants, "g-root", 1_001);
    expect(v.valid).toBe(false);
    if (!v.valid) expect(v.reason).toBe("grant.expired");
  });

  it("refuses an expired ANCESTOR even when the leaf has no expiry", () => {
    const grants = [
      root({ expiresAt: 1_000 }),
      root({ grantId: "g-leaf", parentGrantId: "g-root", grantedAt: 200 }),
    ];
    const v = verifyGrantChain(grants, "g-leaf", 2_000);
    expect(v.valid).toBe(false);
    if (!v.valid) expect(v.reason).toBe("grant.expired");
  });

  it("refuses a chain that crosses tenants mid-chain (A8)", () => {
    const grants = [
      root({ tenantId: "t1" }),
      root({ grantId: "g-leaf", tenantId: "t2", parentGrantId: "g-root", grantedAt: 200 }),
    ];
    const v = verifyGrantChain(grants, "g-leaf", 300);
    expect(v.valid).toBe(false);
    if (!v.valid) expect(v.reason).toBe("grant.tenant-mismatch");
  });

  it("detects a malformed cycle in hand-built chain data", () => {
    const grants = [
      root({ grantId: "g-a", parentGrantId: "g-b", grantedAt: 100 }),
      root({ grantId: "g-b", parentGrantId: "g-a", grantedAt: 100 }),
    ];
    const v = verifyGrantChain(grants, "g-a", 200);
    expect(v.valid).toBe(false);
    if (!v.valid) expect(v.reason).toBe("grant.cycle");
  });
});

describe("revocation propagation", () => {
  it("revoking a ROOT grant propagates to ALL descendants deterministically", () => {
    const r = revokeGrant(chain(), "g-root", 500, "op-1", "compromise");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.revokedCount).toBe(3);
    for (const g of r.grants) {
      expect(g.status).toBe("revoked");
      expect(g.revokedAt).toBe(500);
      expect(g.revokedBy).toBe("op-1");
    }
    const mid = r.grants.find((g) => g.grantId === "g-mid")!;
    const leaf = r.grants.find((g) => g.grantId === "g-leaf")!;
    expect(mid.revocationReason).toBe("propagated:g-root");
    expect(leaf.revocationReason).toBe("propagated:g-root");
    expect(r.grants.find((g) => g.grantId === "g-root")!.revocationReason).toBe("compromise");
  });

  it("revoking a MIDDLE grant leaves the root active but kills the subtree", () => {
    const r = revokeGrant(chain(), "g-mid", 500, "op-1", "policy change");
    if (!r.ok) throw new Error(r.reason);
    expect(r.revokedCount).toBe(2);
    expect(r.grants.find((g) => g.grantId === "g-root")!.status).toBe("active");
    expect(r.grants.find((g) => g.grantId === "g-mid")!.status).toBe("revoked");
    expect(r.grants.find((g) => g.grantId === "g-leaf")!.status).toBe("revoked");
  });

  it("revoking a LEAF grant touches nothing else", () => {
    const r = revokeGrant(chain(), "g-leaf", 500, "op-1", "single revoke");
    if (!r.ok) throw new Error(r.reason);
    expect(r.revokedCount).toBe(1);
    expect(r.grants.filter((g) => g.status === "active")).toHaveLength(2);
  });

  it("revocation is IDEMPOTENT — re-revoking yields byte-identical state", () => {
    const first = revokeGrant(chain(), "g-root", 500, "op-1", "compromise");
    if (!first.ok) throw new Error(first.reason);
    const second = revokeGrant(first.grants, "g-root", 999, "op-2", "again");
    if (!second.ok) throw new Error(second.reason);
    expect(second.revokedCount).toBe(0);
    expect(JSON.stringify(first.grants)).toBe(JSON.stringify(second.grants));
  });

  it("propagation handles a wide tree deterministically (sorted BFS order)", () => {
    const grants: GrantRecord[] = [
      root(),
      ...["g-c-b", "g-c-a", "g-c-c"].map((id) => root({ grantId: id, parentGrantId: "g-root", grantedAt: 200 })),
      root({ grantId: "g-leaf", parentGrantId: "g-c-a", grantedAt: 300 }),
    ];
    const r = revokeGrant(grants, "g-root", 500, "op", "r");
    if (!r.ok) throw new Error(r.reason);
    expect(r.revokedCount).toBe(5);
    expect(r.grants.every((g) => g.status === "revoked")).toBe(true);
  });

  it("refuses revoking an unknown grant", () => {
    const r = revokeGrant(chain(), "g-nope", 500, "op", "r");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("grant.not-found");
  });

  it("refuses an empty grant id and an invalid at", () => {
    expect(revokeGrant(chain(), "", 500, "op", "r").ok).toBe(false);
    expect(revokeGrant(chain(), "g-root", -1, "op", "r").ok).toBe(false);
    expect(revokeGrant(chain(), "g-root", 1.5, "op", "r").ok).toBe(false);
  });
});

describe("tenant-scoped active grant reads (A8)", () => {
  it("lists only the given tenant's active, unexpired grants — sorted by grantId", () => {
    const grants = [
      ...chain(),
      root({ grantId: "g-other", tenantId: "t2", granteeActorId: "actor-root" }),
      root({ grantId: "g-exp", tenantId: "t1", granteeActorId: "actor-root", expiresAt: 150 }),
    ];
    const r = activeGrantsForActor(grants, "t1", "actor-root", 400);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.grants.map((g) => g.grantId)).toEqual(["g-root"]);
    }
  });

  it("refuses an empty tenant scope", () => {
    const r = activeGrantsForActor(chain(), "", "actor-root", 400);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("grant.missing-tenant");
  });

  it("never leaks another tenant's grants — machine-tested isolation harness", () => {
    const grants = [
      root(),
      root({ grantId: "g-t2", tenantId: "t2" }),
    ];
    const r = activeGrantsForActor(grants, "t1", "actor-root", 400);
    if (!r.ok) throw new Error(r.reason);
    expect(r.grants.every((g) => g.tenantId === "t1")).toBe(true);
    const iso = assertGrantTenantIsolation(r.grants, "t1");
    expect(iso.isolated).toBe(true);
    expect(iso.leakedGrantIds).toEqual([]);
  });

  it("the isolation harness flags a hand-built leak", () => {
    const grants = [root(), root({ grantId: "g-t2", tenantId: "t2" })];
    const iso = assertGrantTenantIsolation(grants, "t1");
    expect(iso.isolated).toBe(false);
    expect(iso.leakedGrantIds).toEqual(["g-t2"]);
  });
});
