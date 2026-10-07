/**
 * F240A command-intents tests — the CommandDraft seam.
 *
 * Themes: the three intent builders produce complete inert drafts (frozen,
 * capability REQUEST carried, mandatory reason); subject-keyed
 * deterministic idempotency; every refusal code with exact cases; the
 * structural mirror of the control-plane submit contract
 * (toSubmitInput/validateCommandDraft); digest tamper detection;
 * determinism.
 */

import { describe, expect, it } from "vitest";
import {
  buildEnrollAssetIntent,
  buildRequestRecoveryIntent,
  buildScheduleMaintenanceIntent,
  toSubmitInput,
  validateCommandDraft,
  verifyCommandDraftDigest,
  type CommandDraft,
} from "../src/command-intents.js";
import { ACTOR, NOW, TENANT } from "./helpers.js";

const COMMON = {
  tenantId: TENANT,
  actorId: ACTOR,
  issuedAt: NOW,
  reason: "field operator request",
};

describe("intent builders — happy paths", () => {
  it("builds an enroll-asset draft with capability request + frozen inert data", () => {
    const result = buildEnrollAssetIntent({
      ...COMMON,
      assetId: "ast_newtruck",
      deviceId: "dev_newtruck1",
      serial: "SN-NT-1",
      displayName: "New Truck",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const draft = result.draft;
    expect(draft.kind).toBe("asset.enroll");
    expect(draft.capabilityRequirement).toBe("assets.enroll");
    expect(draft.tenantId).toBe(TENANT);
    expect(draft.actorId).toBe(ACTOR);
    expect(draft.reason).toBe("field operator request");
    expect(draft.payload).toEqual({
      assetId: "ast_newtruck",
      deviceId: "dev_newtruck1",
      serial: "SN-NT-1",
      displayName: "New Truck",
    });
    expect(Object.isFrozen(draft)).toBe(true);
    expect(verifyCommandDraftDigest(draft)).toBe(true);
    expect(validateCommandDraft(draft)).toEqual({ ok: true });
  });

  it("builds a recovery-request draft", () => {
    const result = buildRequestRecoveryIntent({
      ...COMMON,
      deviceId: "dev_tablet12",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.kind).toBe("recovery.request");
    expect(result.draft.capabilityRequirement).toBe("recovery.request");
    expect(result.draft.payload).toEqual({
      deviceId: "dev_tablet12",
      reason: "field operator request",
    });
  });

  it("builds maintenance-schedule drafts for one-time and recurring schedules", () => {
    const oneTime = buildScheduleMaintenanceIntent({
      ...COMMON,
      assetId: "ast_bulldozer",
      planId: "plan_bulldoz_svc",
      schedule: { kind: "one-time", at: NOW + 3_600_000 },
    });
    const recurring = buildScheduleMaintenanceIntent({
      ...COMMON,
      assetId: "ast_sensor09",
      planId: "plan_sensor_cal",
      schedule: {
        kind: "recurring",
        intervalMs: 86_400_000,
        startsAt: NOW,
        endsAt: NOW + 30 * 86_400_000,
      },
    });
    expect(oneTime.ok).toBe(true);
    expect(recurring.ok).toBe(true);
    if (!oneTime.ok || !recurring.ok) return;
    expect(oneTime.draft.kind).toBe("maintenance.schedule");
    expect(oneTime.draft.capabilityRequirement).toBe("maintenance.schedule");
    expect(recurring.draft.payload).toEqual({
      assetId: "ast_sensor09",
      planId: "plan_sensor_cal",
      schedule: {
        kind: "recurring",
        intervalMs: 86_400_000,
        startsAt: NOW,
        endsAt: NOW + 30 * 86_400_000,
      },
    });
  });
});

describe("intent builders — deterministic subject-keyed idempotency", () => {
  it("derives the SAME idempotency key for the same logical intent across issuances", () => {
    const first = buildRequestRecoveryIntent({
      ...COMMON,
      deviceId: "dev_tablet12",
      issuedAt: NOW,
      reason: "first attempt",
    });
    const second = buildRequestRecoveryIntent({
      ...COMMON,
      deviceId: "dev_tablet12",
      issuedAt: NOW + 500_000,
      reason: "retry after timeout",
    });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.draft.idempotencyKey).toBe(second.draft.idempotencyKey);
    expect(first.draft.idempotencyKey).toMatch(/^idem_[0-9a-f]{8}$/);
  });

  it("keys different subjects apart", () => {
    const a = buildRequestRecoveryIntent({ ...COMMON, deviceId: "dev_tablet12" });
    const b = buildRequestRecoveryIntent({ ...COMMON, deviceId: "dev_bulldoz7" });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.draft.idempotencyKey).not.toBe(b.draft.idempotencyKey);
  });

  it("is byte-identical for identical inputs", () => {
    const input = {
      ...COMMON,
      assetId: "ast_newtruck",
      deviceId: "dev_newtruck1",
    };
    const a = buildEnrollAssetIntent(input);
    const b = buildEnrollAssetIntent(input);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("intent builders — refusal codes (exact cases)", () => {
  it("refuses missing/malformed tenant and actor", () => {
    expect(buildRequestRecoveryIntent({ ...COMMON, deviceId: "dev_tablet12", tenantId: "" })).toMatchObject({
      ok: false,
      rejected: "missing-tenant",
    });
    expect(buildRequestRecoveryIntent({ ...COMMON, deviceId: "dev_tablet12", tenantId: "tenant-x" })).toMatchObject({
      ok: false,
      rejected: "malformed-tenant-id",
    });
    expect(buildRequestRecoveryIntent({ ...COMMON, deviceId: "dev_tablet12", actorId: "" })).toMatchObject({
      ok: false,
      rejected: "missing-actor",
    });
    expect(buildRequestRecoveryIntent({ ...COMMON, deviceId: "dev_tablet12", actorId: "actor-x" })).toMatchObject({
      ok: false,
      rejected: "malformed-actor-id",
    });
  });

  it("refuses a missing reason (audit trail is mandatory)", () => {
    expect(buildRequestRecoveryIntent({ ...COMMON, deviceId: "dev_tablet12", reason: "" })).toMatchObject({
      ok: false,
      rejected: "missing-reason",
    });
  });

  it("refuses invalid issuedAt / notBefore", () => {
    expect(buildRequestRecoveryIntent({ ...COMMON, deviceId: "dev_tablet12", issuedAt: 0 })).toMatchObject({
      ok: false,
      rejected: "invalid-issued-at",
    });
    expect(
      buildRequestRecoveryIntent({ ...COMMON, deviceId: "dev_tablet12", notBefore: -5 }),
    ).toMatchObject({ ok: false, rejected: "invalid-not-before" });
  });

  it("refuses missing/malformed asset, device and plan ids", () => {
    expect(buildEnrollAssetIntent({ ...COMMON, assetId: "", deviceId: "dev_x1" })).toMatchObject({
      ok: false,
      rejected: "missing-asset-id",
    });
    expect(buildEnrollAssetIntent({ ...COMMON, assetId: "asset-x", deviceId: "dev_x1" })).toMatchObject({
      ok: false,
      rejected: "malformed-asset-id",
    });
    expect(buildEnrollAssetIntent({ ...COMMON, assetId: "ast_newtruck", deviceId: "" })).toMatchObject({
      ok: false,
      rejected: "missing-device-id",
    });
    expect(buildEnrollAssetIntent({ ...COMMON, assetId: "ast_newtruck", deviceId: "device-x" })).toMatchObject({
      ok: false,
      rejected: "malformed-device-id",
    });
    expect(
      buildScheduleMaintenanceIntent({
        ...COMMON,
        assetId: "ast_newtruck",
        planId: "plan_x",
        schedule: { kind: "one-time", at: NOW },
      }),
    ).toMatchObject({ ok: false, rejected: "malformed-plan-id" });
  });

  it("refuses invalid schedules with exact cases", () => {
    const base = {
      ...COMMON,
      assetId: "ast_bulldozer",
      planId: "plan_bulldoz_svc",
    };
    expect(
      buildScheduleMaintenanceIntent({ ...base, schedule: { kind: "one-time", at: 0 } }),
    ).toMatchObject({ ok: false, rejected: "invalid-schedule" });
    expect(
      buildScheduleMaintenanceIntent({
        ...base,
        schedule: { kind: "recurring", intervalMs: 0, startsAt: NOW },
      }),
    ).toMatchObject({ ok: false, rejected: "invalid-schedule" });
    expect(
      buildScheduleMaintenanceIntent({
        ...base,
        schedule: { kind: "recurring", intervalMs: 1000, startsAt: NOW, endsAt: NOW - 1 },
      }),
    ).toMatchObject({ ok: false, rejected: "invalid-schedule" });
  });
});

describe("the CommandDraft <-> control-plane submit seam (structural mirror)", () => {
  it("toSubmitInput projects EXACTLY the submit-boundary shape", () => {
    const result = buildRequestRecoveryIntent({ ...COMMON, deviceId: "dev_tablet12", notBefore: NOW + 10 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const mirror = toSubmitInput(result.draft);
    expect(Object.keys(mirror).sort()).toEqual([
      "idempotencyKey",
      "issuedAt",
      "kind",
      "notBefore",
      "payload",
    ]);
    expect(mirror.kind).toBe(result.draft.kind);
    expect(mirror.payload).toBe(result.draft.payload);
    expect(mirror.idempotencyKey).toBe(result.draft.idempotencyKey);
    expect(mirror.issuedAt).toBe(result.draft.issuedAt);
    expect(mirror.notBefore).toBe(NOW + 10);
    expect(Object.isFrozen(mirror)).toBe(true);
  });

  it("omits notBefore from the mirror when the draft carries none", () => {
    const result = buildEnrollAssetIntent({
      ...COMMON,
      assetId: "ast_newtruck",
      deviceId: "dev_newtruck1",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const mirror = toSubmitInput(result.draft);
    expect("notBefore" in mirror).toBe(false);
    expect(Object.keys(mirror).sort()).toEqual(["idempotencyKey", "issuedAt", "kind", "payload"]);
  });

  it("validateCommandDraft mirrors the queue's submit rejection vocabulary", () => {
    const good = buildRequestRecoveryIntent({ ...COMMON, deviceId: "dev_tablet12" });
    expect(good.ok).toBe(true);
    if (!good.ok) return;
    const draft = good.draft as unknown as Record<string, unknown>;
    const asDraft = (patch: Record<string, unknown>): CommandDraft =>
      ({ ...draft, ...patch }) as unknown as CommandDraft;
    expect(validateCommandDraft(asDraft({ kind: "" }))).toMatchObject({
      ok: false,
      rejected: "missing-kind",
    });
    expect(validateCommandDraft(asDraft({ idempotencyKey: "" }))).toMatchObject({
      ok: false,
      rejected: "missing-idempotency-key",
    });
    expect(validateCommandDraft(asDraft({ issuedAt: 0 }))).toMatchObject({
      ok: false,
      rejected: "invalid-issued-at",
    });
    expect(validateCommandDraft(asDraft({ notBefore: -1 }))).toMatchObject({
      ok: false,
      rejected: "invalid-not-before",
    });
    expect(validateCommandDraft(asDraft({ reason: "" }))).toMatchObject({
      ok: false,
      rejected: "missing-reason",
    });
    expect(validateCommandDraft(asDraft({ capabilityRequirement: "" }))).toMatchObject({
      ok: false,
      rejected: "missing-capability-requirement",
    });
  });

  it("detects draft digest tampering", () => {
    const result = buildRequestRecoveryIntent({ ...COMMON, deviceId: "dev_tablet12" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const tampered = { ...result.draft, reason: "escalated without re-digest" };
    expect(verifyCommandDraftDigest(tampered)).toBe(false);
    expect(verifyCommandDraftDigest(result.draft)).toBe(true);
  });
});
