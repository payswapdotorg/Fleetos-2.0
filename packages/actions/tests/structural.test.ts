import { describe, it, expect } from "vitest";
import type { TenantScopeLike, MissionRefLike } from "../src/index.ts";
import type {
  TenantScopeLike as PolicyTenantScope,
  MissionRefLike as PolicyMissionRef,
} from "@fleetos/policy/capability";

/**
 * Structural-compatibility test (cross-worker seam rule, Wave 0).
 *
 * Verifies that the LOCAL structural interfaces defined in @fleetos/actions
 * are structurally compatible with the canonical ones in @fleetos/policy.
 * When the TL converges the shared contracts at F201, both can be replaced
 * by the frozen canonical type without code changes here.
 */
describe("structural compatibility with @fleetos/policy", () => {
  it("TenantScopeLike is structurally compatible", () => {
    const local: TenantScopeLike = { tenantId: "t1", workspaceId: "w1" };
    const policy: PolicyTenantScope = local;
    expect(policy.tenantId).toBe("t1");
  });

  it("MissionRefLike is structurally compatible", () => {
    const local: MissionRefLike = { missionId: "m1", runId: "r1", workItemId: "wi1" };
    const policy: PolicyMissionRef = local;
    expect(policy.missionId).toBe("m1");
  });
});
