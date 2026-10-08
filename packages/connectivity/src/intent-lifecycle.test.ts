/**
 * @fleetos/connectivity — Wave 5 intent lifecycle tests (F250A).
 *
 * Covers: legal transitions; illegal transitions + already-in-state
 * idempotency; the Guardian law (authorization is an INPUT — ceiling
 * allow without a grant refuses; a deny ceiling always refuses); stale
 * + malformed grants; reason requirements; staleness classification
 * boundaries (unknown != fresh).
 */

import { describe, it, expect } from "vitest";
import {
  applyIntentTransition,
  classifyIntentStaleness,
  defaultIntentStalenessThresholds,
  initialIntentRecord,
  isAuthorizationStale,
  transitionIntentLifecycle,
  type AuthorizationGrant,
  type IntentPolicyCeiling,
  type IntentTransitionInput,
} from "./intent-lifecycle.js";

const NOW = 1_727_000_000_000;
const TENANT_A = "tnt_acme";
const DEV_1 = "dev_truck-001";
const ACTOR = "operator:alice";

const GRANT: AuthorizationGrant = {
  grantedBy: "guardian",
  authorizationDigest: "grant-digest-1",
  grantedAt: NOW - 1_000,
  expiresAt: NOW + 60_000,
};

const CEILING_ALLOW: IntentPolicyCeiling = { effect: "allow", matchedRulePriority: 10, reason: "fleet policy" };
const CEILING_DENY: IntentPolicyCeiling = { effect: "deny", reason: "blacklisted device" };

function tr(overrides: Partial<IntentTransitionInput>): IntentTransitionInput {
  return {
    tenantId: TENANT_A,
    deviceId: DEV_1,
    from: "proposed",
    event: "authorize",
    now: NOW,
    actor: ACTOR,
    ...overrides,
  };
}

describe("connectivity intent-lifecycle: legal transitions", () => {
  it("proposed -> authorized (ceiling allow + grant) -> active -> suspended -> resume -> terminated", () => {
    const auth = transitionIntentLifecycle(tr({ from: "proposed", event: "authorize", authorization: GRANT, ceiling: CEILING_ALLOW }));
    expect(auth.ok).toBe(true);
    if (auth.ok) expect(auth.to).toBe("authorized");

    const activate = transitionIntentLifecycle(tr({ from: "authorized", event: "activate" }));
    expect(activate.ok && activate.to).toBe("active");

    const suspend = transitionIntentLifecycle(tr({ from: "active", event: "suspend", reason: "maintenance window" }));
    expect(suspend.ok && suspend.to).toBe("suspended");

    const resume = transitionIntentLifecycle(tr({ from: "suspended", event: "resume" }));
    expect(resume.ok && resume.to).toBe("active");

    const terminate = transitionIntentLifecycle(tr({ from: "active", event: "terminate", reason: "decommission" }));
    expect(terminate.ok && terminate.to).toBe("terminated");
  });

  it("withdraw terminates a proposed intent", () => {
    const r = transitionIntentLifecycle(tr({ from: "proposed", event: "withdraw", reason: "changed mind" }));
    expect(r.ok && r.to).toBe("terminated");
  });

  it("illegal transitions are refused with typed codes", () => {
    expect(transitionIntentLifecycle(tr({ from: "proposed", event: "activate" }))).toMatchObject({ ok: false, reason: "illegal-transition" });
    expect(transitionIntentLifecycle(tr({ from: "proposed", event: "suspend", reason: "x" }))).toMatchObject({ ok: false, reason: "illegal-transition" });
    expect(transitionIntentLifecycle(tr({ from: "terminated", event: "activate" }))).toMatchObject({ ok: false, reason: "illegal-transition" });
    expect(transitionIntentLifecycle(tr({ from: "suspended", event: "authorize", authorization: GRANT, ceiling: CEILING_ALLOW }))).toMatchObject({ ok: false, reason: "illegal-transition" });
  });

  it("re-applying a completed transition is already-in-state (idempotency)", () => {
    expect(transitionIntentLifecycle(tr({ from: "authorized", event: "authorize", authorization: GRANT, ceiling: CEILING_ALLOW }))).toMatchObject({ ok: false, reason: "already-in-state" });
    expect(transitionIntentLifecycle(tr({ from: "active", event: "activate" }))).toMatchObject({ ok: false, reason: "already-in-state" });
    expect(transitionIntentLifecycle(tr({ from: "active", event: "resume" }))).toMatchObject({ ok: false, reason: "already-in-state" });
    expect(transitionIntentLifecycle(tr({ from: "terminated", event: "terminate", reason: "x" }))).toMatchObject({ ok: false, reason: "already-in-state" });
  });

  it("missing tenant / device / now are refused", () => {
    expect(transitionIntentLifecycle(tr({ tenantId: "" }))).toMatchObject({ ok: false, reason: "missing-tenant-id" });
    expect(transitionIntentLifecycle(tr({ deviceId: "" }))).toMatchObject({ ok: false, reason: "missing-device-id" });
    expect(transitionIntentLifecycle(tr({ now: 0 }))).toMatchObject({ ok: false, reason: "invalid-now" });
  });
});

describe("connectivity intent-lifecycle: the Guardian law (authorization-as-input)", () => {
  it("a ceiling allow WITHOUT a grant is authorization-required (ceilings are not authorizations)", () => {
    const r = transitionIntentLifecycle(tr({ authorization: undefined, ceiling: CEILING_ALLOW }));
    expect(r).toMatchObject({ ok: false, reason: "authorization-required" });
  });

  it("no ceiling at all is authorization-required", () => {
    expect(transitionIntentLifecycle(tr({ authorization: GRANT, ceiling: undefined }))).toMatchObject({ ok: false, reason: "authorization-required" });
  });

  it("a deny ceiling refuses even WITH a valid grant (Guardian cannot be bypassed)", () => {
    const r = transitionIntentLifecycle(tr({ authorization: GRANT, ceiling: CEILING_DENY }));
    expect(r).toMatchObject({ ok: false, reason: "policy-denied" });
  });

  it("an expired grant is stale-authorization (logical time)", () => {
    const stale: AuthorizationGrant = { ...GRANT, expiresAt: NOW };
    expect(transitionIntentLifecycle(tr({ authorization: stale, ceiling: CEILING_ALLOW }))).toMatchObject({ ok: false, reason: "stale-authorization" });
  });

  it("a malformed grant is invalid-grant", () => {
    expect(transitionIntentLifecycle(tr({ authorization: { ...GRANT, grantedBy: "" }, ceiling: CEILING_ALLOW }))).toMatchObject({ ok: false, reason: "invalid-grant" });
    expect(transitionIntentLifecycle(tr({ authorization: { ...GRANT, authorizationDigest: "" }, ceiling: CEILING_ALLOW }))).toMatchObject({ ok: false, reason: "invalid-grant" });
    expect(transitionIntentLifecycle(tr({ authorization: { ...GRANT, grantedAt: NOW + 1 }, ceiling: CEILING_ALLOW }))).toMatchObject({ ok: false, reason: "invalid-grant" });
  });

  it("consequential transitions require a reason", () => {
    expect(transitionIntentLifecycle(tr({ from: "active", event: "suspend" }))).toMatchObject({ ok: false, reason: "missing-reason" });
    expect(transitionIntentLifecycle(tr({ from: "active", event: "terminate" }))).toMatchObject({ ok: false, reason: "missing-reason" });
    expect(transitionIntentLifecycle(tr({ from: "proposed", event: "withdraw" }))).toMatchObject({ ok: false, reason: "missing-reason" });
  });

  it("the audit ref is tenant-scoped and deterministic", () => {
    const a = transitionIntentLifecycle(tr({ authorization: GRANT, ceiling: CEILING_ALLOW }));
    const b = transitionIntentLifecycle(tr({ authorization: GRANT, ceiling: CEILING_ALLOW }));
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.audit).toEqual(b.audit);
      expect(a.audit.tenant).toBe(TENANT_A);
      expect(a.audit.intent).toBe("connectivity:intent:proposed->authorized:authorize");
    }
  });
});

describe("connectivity intent-lifecycle: records + staleness", () => {
  it("applyIntentTransition folds state, counts, and captures the grant", () => {
    let record = initialIntentRecord(TENANT_A, DEV_1, NOW);
    expect(record.state).toBe("proposed");
    const auth = transitionIntentLifecycle(tr({ authorization: GRANT, ceiling: CEILING_ALLOW }));
    if (!auth.ok) throw new Error("authorize failed in fixture");
    record = applyIntentTransition(record, auth, NOW, GRANT.authorizationDigest);
    expect(record.state).toBe("authorized");
    expect(record.transitionCount).toBe(1);
    expect(record.authorizedAt).toBe(NOW);
    expect(record.authorizationDigest).toBe("grant-digest-1");
  });

  it("a refused transition leaves the record untouched", () => {
    const record = initialIntentRecord(TENANT_A, DEV_1, NOW);
    const refused = transitionIntentLifecycle(tr({ authorization: undefined, ceiling: CEILING_ALLOW }));
    if (refused.ok) throw new Error("expected refusal in fixture");
    expect(applyIntentTransition(record, refused, NOW)).toEqual(record);
  });

  it("staleness boundaries: fresh / stale / unknown (unknown != fresh)", () => {
    const t = defaultIntentStalenessThresholds(); // stale 300s, unknown 3600s
    const record = { lastTransitionAt: NOW };
    expect(classifyIntentStaleness(record, t, NOW + 299_999)).toBe("fresh");
    expect(classifyIntentStaleness(record, t, NOW + 300_000)).toBe("stale");
    expect(classifyIntentStaleness(record, t, NOW + 3_600_000)).toBe("unknown");
  });

  it("isAuthorizationStale: null authorization is never stale; aged authorization is", () => {
    const t = defaultIntentStalenessThresholds();
    expect(isAuthorizationStale({ authorizedAt: null }, t, NOW)).toBe(false);
    expect(isAuthorizationStale({ authorizedAt: NOW }, t, NOW + 299_999)).toBe(false);
    expect(isAuthorizationStale({ authorizedAt: NOW }, t, NOW + 300_000)).toBe(true);
  });
});
