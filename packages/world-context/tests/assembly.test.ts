/**
 * Context assembly tests (Wave 3, F230B) — tenant fail-closed, declarative
 * redaction, provenance refs, audit digests, determinism, every rejection
 * code.
 */
import { describe, it, expect } from "vitest";
import {
  DEFAULT_REDACTION_RULES,
  REDACTED_VALUE,
  assembleContext,
  hasValidSchemaVersion,
  verifyAssembledContextDigest,
  type ContextQueryFocus,
  type WorldEntitySnapshot,
} from "../src/index.ts";

const tenant = { tenantId: "t1" };

function entities(): WorldEntitySnapshot[] {
  return [
    {
      entityId: "a-1",
      entityType: "asset",
      tenantId: "t1",
      fields: { temperature: 42, operatorName: "Alice", location: "DC-1", operatorContact: "alice@fleet.example" },
      lastObservationRef: "obs-9",
      lastObservedAtMs: 12345,
    },
    {
      entityId: "g-2",
      entityType: "agent",
      tenantId: "t1",
      fields: { queueDepth: 3 },
    },
  ];
}

function focus(overrides: Partial<ContextQueryFocus> = {}): ContextQueryFocus {
  return { tenant, entities: entities(), purpose: "security-review", ...overrides };
}

const computedAt = "2026-10-07T00:00:00.000Z";

// ---------- Assembly + determinism ----------

describe("assembleContext: deterministic assembly", () => {
  it("assembles a namespaced feature snapshot with provenance refs and a digest", () => {
    const r = assembleContext({ focus: focus(), computedAt });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const ctx = r.context;
      expect(ctx.tenantId).toBe("t1");
      expect(ctx.purpose).toBe("security-review");
      expect(ctx.entityIds).toEqual(["a-1", "g-2"]); // sorted
      expect(ctx.features["a-1#temperature"]).toBe(42);
      expect(ctx.features["g-2#queueDepth"]).toBe(3);
      expect(ctx.provenance).toEqual([
        { entityId: "a-1", observationRef: "obs-9", observedAtMs: 12345 },
        { entityId: "g-2", observationRef: null, observedAtMs: null },
      ]);
      expect(ctx.digest).toMatch(/^[0-9a-f]{8}$/);
      expect(ctx.computedAt).toBe(computedAt);
      expect(hasValidSchemaVersion(ctx)).toBe(true);
    }
  });

  it("is deterministic — identical inputs assemble identical contexts", () => {
    const a = assembleContext({ focus: focus(), computedAt });
    const b = assembleContext({ focus: focus(), computedAt });
    expect(a).toEqual(b);
  });

  it("input entity order is irrelevant — entities are folded in entityId order", () => {
    const a = assembleContext({ focus: focus(), computedAt });
    const b = assembleContext({
      focus: { ...focus(), entities: [...entities()].reverse() },
      computedAt,
    });
    expect(a).toEqual(b);
  });
});

// ---------- Redaction (declarative, per purpose) ----------

describe("assembleContext: declarative field-level redaction", () => {
  it("applies the default redact-list for the purpose; redacted values never leak", () => {
    const r = assembleContext({ focus: focus(), computedAt }); // security-review
    expect(r.ok).toBe(true);
    if (r.ok) {
      const ctx = r.context;
      expect(ctx.features["a-1#operatorName"]).toBe(REDACTED_VALUE);
      expect(ctx.features["a-1#location"]).toBe(REDACTED_VALUE);
      expect(ctx.features["a-1#operatorContact"]).toBe(REDACTED_VALUE);
      expect(ctx.features["a-1#temperature"]).toBe(42);
      expect(ctx.redactedFields).toEqual([
        "a-1#location",
        "a-1#operatorContact",
        "a-1#operatorName",
      ]);
      // The privacy law is structural: the serialized context carries no trace
      // of the redacted values.
      expect(JSON.stringify(ctx)).not.toContain("Alice");
      expect(JSON.stringify(ctx)).not.toContain("DC-1");
      expect(JSON.stringify(ctx)).not.toContain("alice@fleet.example");
    }
  });

  it("a purpose with a narrower default rule redacts fewer fields", () => {
    const r = assembleContext({
      focus: focus({ purpose: "operational-monitoring" }),
      computedAt,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.context.features["a-1#operatorName"]).toBe("Alice");
      expect(r.context.features["a-1#operatorContact"]).toBe(REDACTED_VALUE);
      expect(r.context.redactedFields).toEqual(["a-1#operatorContact"]);
    }
  });

  it("caller-supplied rules replace the defaults deterministically", () => {
    const rules = [{ purpose: "model-input" as const, redactFields: ["temperature"] }];
    const r = assembleContext({ focus: focus({ purpose: "model-input" }), rules, computedAt });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.context.features["a-1#temperature"]).toBe(REDACTED_VALUE);
      expect(r.context.features["a-1#operatorName"]).toBe("Alice"); // custom rule replaced defaults
    }
  });

  it("duplicate rules for the same purpose union their redact-lists", () => {
    const rules = [
      { purpose: "model-input" as const, redactFields: ["temperature"] },
      { purpose: "model-input" as const, redactFields: ["queueDepth"] },
    ];
    const r = assembleContext({ focus: focus({ purpose: "model-input" }), rules, computedAt });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.context.features["a-1#temperature"]).toBe(REDACTED_VALUE);
      expect(r.context.features["g-2#queueDepth"]).toBe(REDACTED_VALUE);
      expect(r.context.redactedFields).toEqual(["a-1#temperature", "g-2#queueDepth"]);
    }
  });

  it("the default rules cover every declared purpose", () => {
    const purposes = ["maintenance-planning", "security-review", "operational-monitoring", "model-input"] as const;
    for (const purpose of purposes) {
      const r = assembleContext({ focus: focus({ purpose }), computedAt });
      expect(r.ok).toBe(true);
    }
    expect(DEFAULT_REDACTION_RULES.length).toBe(4);
  });
});

// ---------- Tenant fail-closed + rejections ----------

describe("assembleContext: tenant fail-closed + honest rejections", () => {
  it("rejects a missing tenant identifier", () => {
    const r = assembleContext({ focus: focus({ tenant: { tenantId: "" } }), computedAt });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rejected).toBe("missing-tenant");
  });

  it("rejects an empty focus (no entities)", () => {
    const r = assembleContext({ focus: focus({ entities: [] }), computedAt });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rejected).toBe("no-entities");
  });

  it("fail-closed on cross-tenant refs — the offender is named in the detail", () => {
    const crossTenant: WorldEntitySnapshot = {
      entityId: "a-foreign",
      entityType: "asset",
      tenantId: "t2",
      fields: { temperature: 1 },
    };
    const r = assembleContext({
      focus: focus({ entities: [...entities(), crossTenant] }),
      computedAt,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.rejected).toBe("cross-tenant-ref");
      expect(r.detail).toContain("a-foreign");
      expect(r.detail).toContain("t2");
    }
  });

  it("rejects an unknown purpose (no rule covers it)", () => {
    const rules = [{ purpose: "security-review" as const, redactFields: ["location"] }];
    const r = assembleContext({
      focus: focus({ purpose: "model-input" }),
      rules,
      computedAt,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rejected).toBe("unknown-purpose");
  });
});

// ---------- Audit digest ----------

describe("context digests (audit)", () => {
  it("verifyAssembledContextDigest accepts an untampered context", () => {
    const r = assembleContext({ focus: focus(), computedAt });
    expect(r.ok).toBe(true);
    if (r.ok) expect(verifyAssembledContextDigest(r.context)).toBe(true);
  });

  it("detects tampering with features, redacted lists, provenance, and tenant", () => {
    const r = assembleContext({ focus: focus(), computedAt });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const base = r.context;
      const tamperedFeature = { ...base, features: { ...base.features, "a-1#temperature": 999 } };
      expect(verifyAssembledContextDigest(tamperedFeature)).toBe(false);
      const tamperedRedaction = { ...base, redactedFields: [] };
      expect(verifyAssembledContextDigest(tamperedRedaction)).toBe(false);
      const tamperedProvenance = {
        ...base,
        provenance: [{ entityId: "a-1", observationRef: "forged", observedAtMs: 1 }],
      };
      expect(verifyAssembledContextDigest(tamperedProvenance)).toBe(false);
      const tamperedTenant = { ...base, tenantId: "t2" };
      expect(verifyAssembledContextDigest(tamperedTenant)).toBe(false);
    }
  });

  it("digests differ across purposes (redaction is digest-visible)", () => {
    const a = assembleContext({ focus: focus({ purpose: "security-review" }), computedAt });
    const b = assembleContext({ focus: focus({ purpose: "model-input" }), computedAt });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.context.digest).not.toBe(b.context.digest);
    }
  });
});
