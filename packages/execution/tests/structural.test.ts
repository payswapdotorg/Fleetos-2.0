import { describe, it, expect } from "vitest";
import type { TenantScopeLike, MissionRefLike } from "../src/index.ts";
import type {
  TenantScopeLike as PolicyTenantScope,
  MissionRefLike as PolicyMissionRef,
} from "@fleetos/policy/capability";

/** Structural-compat test (cross-worker seam rule). */
describe("structural compatibility with @fleetos/policy", () => {
  it("TenantScopeLike is structurally compatible", () => {
    const local: TenantScopeLike = { tenantId: "t1" };
    const policy: PolicyTenantScope = local;
    expect(policy.tenantId).toBe("t1");
  });

  it("MissionRefLike is structurally compatible", () => {
    const local: MissionRefLike = { missionId: "m1" };
    const policy: PolicyMissionRef = local;
    expect(policy.missionId).toBe("m1");
  });
});
