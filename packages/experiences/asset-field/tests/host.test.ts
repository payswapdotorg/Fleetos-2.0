/**
 * F300A host-seam tests — the WAVE10-HOST-CONTRACT §2 laws, machine-checked:
 * surface shape + manifest/catalog integrity, purity (byte-identical),
 * real read-models (no second truth store), tenant fail-closed at the
 * seam, honest limitation markers, inert intent drafts, role lenses.
 */

import { describe, expect, it } from "vitest";
import { makeTenantContext } from "@fleetos/identity";
import type { TenantContext } from "@fleetos/identity";
import { makeState, makeReversedState, TENANT, ACTOR, NOW } from "./helpers.js";
import {
  assetFieldHostSurface,
  buildAssetFieldHostViewModels,
  verifyHostViewModelsDigest,
  device360SheetFor,
  verifyRouteManifest,
  verifyIntentCatalog,
  intentForEvent,
  intentsForRoute,
  intentsOfferedTo,
  isIntentOfferedToRole,
  buildIntentForEvent,
  DEVICE_360_ROUTE_ID,
  ASSET_DISCOVERY_ROUTE_ID,
  FIELD_WORKFLOW_ROUTE_ID,
} from "../src/host/index.js";
import {
  assembleFleetOverview,
  assembleAssetDetail,
  assembleFieldView,
  validateCommandDraft,
  verifyCommandDraftDigest,
} from "../src/index.js";

const ROLE = "role_field-ops-01";

function hostContext(tenantId: string = TENANT, establishedAt: number = NOW): TenantContext {
  const r = makeTenantContext({ tenantId, actorId: ACTOR, roleId: ROLE, establishedAt });
  if (!r.ok) throw new Error(`test context refused: ${r.reason}`);
  return r.context;
}

describe("F300A host surface — shape and integrity", () => {
  it("exposes the stable surface identity and lane-experience kind", () => {
    expect(assetFieldHostSurface.surfaceId).toBe("asset-field");
    expect(assetFieldHostSurface.surfaceKind).toBe("lane-experience");
  });

  it("declares the five packet routes and the manifest verifies", () => {
    expect(assetFieldHostSurface.routes.map((r) => r.routeId)).toEqual([
      "fleet-overview",
      "asset-discovery",
      "device-360",
      "health-timeline",
      "field-workflow",
    ]);
    expect(verifyRouteManifest()).toEqual([]);
  });

  it("declares an intent catalog binding UI events to the existing builders", () => {
    expect(verifyIntentCatalog()).toEqual([]);
    expect(assetFieldHostSurface.intents.length).toBe(5);
    const builders = new Set(assetFieldHostSurface.intents.map((i) => i.builderId));
    expect(builders).toEqual(new Set(["asset.enroll", "recovery.request", "maintenance.schedule"]));
  });

  it("every route carries the honest offline-read marker; write-sync is honestly NOT implemented", () => {
    for (const route of assetFieldHostSurface.routes) {
      expect(route.limitations.map((l) => l.marker)).toContain("offline-read:last-known");
    }
    for (const routeId of [DEVICE_360_ROUTE_ID, FIELD_WORKFLOW_ROUTE_ID]) {
      const route = assetFieldHostSurface.routes.find((r) => r.routeId === routeId);
      expect(route?.limitations.map((l) => l.marker)).toContain("offline-write-sync:not-implemented");
    }
  });
});

describe("F300A buildViewModels — purity and real read-models", () => {
  it("same slice + same context => byte-identical view models (pure law)", () => {
    const ctx = hostContext();
    const first = buildAssetFieldHostViewModels(makeState(), ctx);
    const second = buildAssetFieldHostViewModels(makeState(), ctx);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(JSON.stringify(second.models)).toBe(JSON.stringify(first.models));
    expect(second.models.digest).toBe(first.models.digest);
  });

  it("the surface object's bound builder equals the standalone function", () => {
    const ctx = hostContext();
    const viaSurface = assetFieldHostSurface.buildViewModels(makeState(), ctx);
    const standalone = buildAssetFieldHostViewModels(makeState(), ctx);
    expect(JSON.stringify(viaSurface)).toBe(JSON.stringify(standalone));
  });

  it("input record order never changes the bundle (deterministic order law)", () => {
    const ctx = hostContext();
    const a = buildAssetFieldHostViewModels(makeState(), ctx);
    const b = buildAssetFieldHostViewModels(makeReversedState(), ctx);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(b.models.digest).toBe(a.models.digest);
  });

  it("projects the REAL assemblies verbatim — no second truth store", () => {
    const state = makeState();
    const ctx = hostContext();
    const r = buildAssetFieldHostViewModels(state, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const overview = assembleFleetOverview(state, { now: NOW });
    expect(overview.ok).toBe(true);
    if (!overview.ok) return;
    const vmOverview = r.models.fleetOverview;
    expect(vmOverview.ok).toBe(true);
    if (vmOverview.ok) expect(JSON.stringify(vmOverview.view)).toBe(JSON.stringify(overview.view));
    for (const sheet of r.models.device360) {
      const detail = assembleAssetDetail(state, { now: NOW, assetId: sheet.assetId });
      expect(detail.ok).toBe(true);
      const sheetOutcome = sheet.outcome;
      expect(sheetOutcome.ok).toBe(true);
      if (sheetOutcome.ok && detail.ok) {
        expect(JSON.stringify(sheetOutcome.view)).toBe(JSON.stringify(detail.view));
      }
    }
    const field = assembleFieldView(state, { now: NOW });
    expect(field.ok).toBe(true);
    const vmField = r.models.fieldWorkflow;
    expect(vmField.ok).toBe(true);
    if (vmField.ok && field.ok) expect(JSON.stringify(vmField.view)).toBe(JSON.stringify(field.view));
  });

  it("asOf is the context's logical time — never a clock", () => {
    const ctx = hostContext(TENANT, NOW + 123_456);
    const r = buildAssetFieldHostViewModels(makeState(), ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.models.asOf).toBe(NOW + 123_456);
    if (r.models.fleetOverview.ok) expect(r.models.fleetOverview.view.asOf).toBe(NOW + 123_456);
  });

  it("the bundle digest is tamper-evident", () => {
    const r = buildAssetFieldHostViewModels(makeState(), hostContext());
    if (!r.ok) throw new Error("bundle refused");
    expect(verifyHostViewModelsDigest(r.models)).toBe(true);
    const tampered = { ...r.models, asOf: r.models.asOf + 1 };
    expect(verifyHostViewModelsDigest(tampered)).toBe(false);
  });

  it("Device 360 sheets resolve per asset and refuse unknown assets", () => {
    const r = buildAssetFieldHostViewModels(makeState(), hostContext());
    if (!r.ok) throw new Error("bundle refused");
    const found = device360SheetFor(r.models, "ast_bulldozer");
    expect(found.ok).toBe(true);
    const missing = device360SheetFor(r.models, "ast_not-there");
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.rejected).toBe("unknown-asset");
  });

  it("route limitations surface with every build (honesty fields)", () => {
    const r = buildAssetFieldHostViewModels(makeState(), hostContext());
    if (!r.ok) throw new Error("bundle refused");
    expect(r.models.routeLimitations.map((l) => l.routeId)).toEqual([
      "fleet-overview",
      "asset-discovery",
      "device-360",
      "health-timeline",
      "field-workflow",
    ]);
    const device360 = r.models.routeLimitations.find((l) => l.routeId === DEVICE_360_ROUTE_ID);
    expect(device360?.markers).toContain("offline-write-sync:not-implemented");
  });
});

describe("F300A host seam — tenant fail-closed", () => {
  it("a context tenant that does not own the slice refuses the WHOLE bundle", () => {
    const r = buildAssetFieldHostViewModels(makeState(), hostContext("tnt_other-operator-9"));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.rejected).toBe("tenant-mismatch");
      expect(r.detail).toContain("tnt_other-operator-9");
    }
  });

  it("malformed context ids and times are refused honestly", () => {
    // Runtime-widened malformed values (bypassing the identity validator)
    // must still be refused by the host seam itself — fail closed.
    const badTenant = buildAssetFieldHostViewModels(
      makeState(),
      { ...hostContext(), tenantId: "not-a-tenant" as never },
    );
    expect(badTenant.ok).toBe(false);
    if (!badTenant.ok) expect(badTenant.rejected).toBe("malformed-context");
    const badActor = buildAssetFieldHostViewModels(
      makeState(),
      { ...hostContext(), actorId: "act_x" as never },
    );
    expect(badActor.ok).toBe(false);
    if (!badActor.ok) expect(badActor.rejected).toBe("malformed-context");
    const badTime = buildAssetFieldHostViewModels(
      makeState(),
      { ...hostContext(), establishedAt: -1 },
    );
    expect(badTime.ok).toBe(false);
    if (!badTime.ok) expect(badTime.rejected).toBe("invalid-established-at");
  });

  it("the forbidden cross-tenant scope is refused at the boundary", () => {
    const ctx = { ...hostContext(), scope: "cross-tenant-forbidden" as const };
    const r = buildAssetFieldHostViewModels(makeState(), ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rejected).toBe("forbidden-scope");
  });

  it("a cross-tenant record refuses every projection verbatim (lane law surfaced)", () => {
    const state = makeState();
    state.assets[0]!.tenantId = "tnt_other-operator-9" as never;
    const r = buildAssetFieldHostViewModels(state, hostContext());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const view of [r.models.fleetOverview, r.models.healthBoard, r.models.fieldWorkflow]) {
      expect(view.ok).toBe(false);
      if (!view.ok) expect(view.rejected).toBe("cross-tenant-ref");
    }
  });
});

describe("F300A intent catalog — inert drafts and role lenses", () => {
  it("builds a valid inert draft per event, dispatched to the existing builder", () => {
    const enroll = buildIntentForEvent("asset-discovery:enroll-asset", {
      tenantId: TENANT,
      actorId: ACTOR,
      issuedAt: NOW,
      reason: "host: enroll a discovered asset",
      assetId: "ast_new-asset-01",
      deviceId: "dev_new-device-01",
    });
    expect(enroll.ok).toBe(true);
    if (enroll.ok) {
      expect(enroll.draft.kind).toBe("asset.enroll");
      expect(enroll.intent.intentId).toBe("asset-field.enroll-asset");
      expect(validateCommandDraft(enroll.draft).ok).toBe(true);
      expect(verifyCommandDraftDigest(enroll.draft)).toBe(true);
      expect(Object.isFrozen(enroll.draft)).toBe(true);
    }

    const recovery = buildIntentForEvent("device-360:request-recovery", {
      tenantId: TENANT,
      actorId: ACTOR,
      issuedAt: NOW,
      reason: "host: request recovery from Device 360",
      deviceId: "dev_bulldoz7",
    });
    expect(recovery.ok).toBe(true);
    if (recovery.ok) expect(recovery.draft.capabilityRequirement).toBe("recovery.request");

    const maintenance = buildIntentForEvent("device-360:schedule-maintenance", {
      tenantId: TENANT,
      actorId: ACTOR,
      issuedAt: NOW,
      reason: "host: schedule maintenance from Device 360",
      assetId: "ast_bulldozer",
      planId: "plan_new-svc-01",
      schedule: { kind: "one-time", at: NOW + 86_400_000 },
    });
    expect(maintenance.ok).toBe(true);
    if (maintenance.ok) expect(maintenance.draft.kind).toBe("maintenance.schedule");
  });

  it("unknown events and missing inputs are refused (never guessed)", () => {
    const unknown = buildIntentForEvent("no-such-event", {
      tenantId: TENANT, actorId: ACTOR, issuedAt: NOW, reason: "x",
    });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.rejected).toBe("unknown-intent-event");

    const missing = buildIntentForEvent("device-360:request-recovery", {
      tenantId: TENANT, actorId: ACTOR, issuedAt: NOW, reason: "x",
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.rejected).toBe("missing-intent-input");
  });

  it("role lenses gate presentation fail-closed and never authorize", () => {
    expect(isIntentOfferedToRole("asset-discovery:enroll-asset", "fleet-operator")).toBe(true);
    expect(isIntentOfferedToRole("asset-discovery:enroll-asset", "field-technician")).toBe(false);
    expect(isIntentOfferedToRole("device-360:request-recovery", "field-technician")).toBe(true);
    expect(isIntentOfferedToRole("no-such-event", "fleet-operator")).toBe(false);
    expect(intentsOfferedTo("field-technician").map((i) => i.event)).toEqual([
      "device-360:request-recovery",
      "field-workflow:request-recovery",
    ]);
    expect(intentsForRoute(ASSET_DISCOVERY_ROUTE_ID).map((i) => i.event)).toEqual([
      "asset-discovery:enroll-asset",
    ]);
    expect(intentForEvent(FIELD_WORKFLOW_ROUTE_ID === "field-workflow" ? "field-workflow:schedule-maintenance" : "")?.builderId).toBe(
      "maintenance.schedule",
    );
  });
});
