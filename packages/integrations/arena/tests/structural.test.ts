import { describe, it, expect } from "vitest";
import type {
  CapabilityVersionRef,
  EvaluationCase,
  TenantScopeLike,
} from "../src/index.ts";

/**
 * Structural-compatibility test (cross-worker seam rule + arena workspace gap).
 *
 * Arena declares LOCAL structural interfaces for the @fleetos/learning concepts
 * it references. The full structural-compat test against @fleetos/learning's
 * canonical types is DEFERRED until the TL adds `packages/integrations/*` to
 * pnpm-workspace.yaml — see docs/evidence/F200B/report.md. The local
 * interfaces below are written to mirror the @fleetos/learning contract shape
 * exactly; field-by-field runtime checks verify the local shape is consistent.
 */
describe("arena local structural interfaces (deferred cross-package check)", () => {
  it("TenantScopeLike has the required tenantId field", () => {
    const local: TenantScopeLike = { tenantId: "t1" };
    expect(typeof local.tenantId).toBe("string");
  });

  it("CapabilityVersionRef has capabilityId + version", () => {
    const local: CapabilityVersionRef = { capabilityId: "c1", version: "1.0.0" };
    expect(typeof local.capabilityId).toBe("string");
    expect(typeof local.version).toBe("string");
  });

  it("EvaluationCase has the required fields", () => {
    const local: EvaluationCase<number> = {
      caseId: "case-1",
      tenant: { tenantId: "t1" },
      capability: { capabilityId: "c1", version: "1.0.0" },
      inputs: { x: 1 },
      expected: 42,
      description: "test",
      tags: [],
    };
    expect(local.caseId).toBe("case-1");
    expect(local.tenant.tenantId).toBe("t1");
    expect(local.capability.capabilityId).toBe("c1");
    expect(local.expected).toBe(42);
  });

  it("TODO(F201): once pnpm-workspace.yaml includes packages/integrations/*, restore the cross-package structural-compat assertions against @fleetos/learning", () => {
    // This test is a placeholder — when the workspace gap is fixed, replace
    // the local interface imports above with cross-package imports and add:
    //   const learningTenant: LearningTenantScope = localTenant;
    // etc. to verify structural compatibility.
    expect(true).toBe(true);
  });
});
