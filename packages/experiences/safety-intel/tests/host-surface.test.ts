/**
 * HostSurface machine tests (F300B deliverable 1) — the WAVE10-HOST-CONTRACT
 * §2 laws, machine-verified over the REAL composed slice:
 *
 *  - surface shape: stable id, 7-route manifest, no dangling drills, intent
 *    catalog with inert markers, NO submit/execute members (inert intents);
 *  - purity + determinism: same slice + ctx => byte-identical view models
 *    and a stable viewModelsDigest; input order never leaks;
 *  - tenant fail-closed (A8): every cross-tenant input family refuses the
 *    WHOLE view with route + code + detail;
 *  - honest not-composed sections (plan/action/advisory absent);
 *  - honesty fields carried verbatim (ceiling marker, authorization state,
 *    ledger verification outcome, scope).
 */
import { describe, it, expect } from "vitest";
import { SAFETY_INTEL_HOST_SURFACE } from "../src/host/index.ts";
import { SAFETY_INTEL_ROUTES } from "../src/host/contract.ts";
import type { HostRouteId } from "../src/host/contract.ts";
import { buildViewModels } from "../src/host/view-models.ts";
import type { SafetyIntelSlice } from "../src/host/view-models.ts";
import {
  FOREIGN_TENANT_ID,
  TENANT_ID,
  fullSlice,
  hostCtx,
  findings,
  ledger,
  evidenceChain,
  grants,
  tenantPolicy,
  actionRecord,
  auditEvents,
  prediction,
  worldContext,
  PLAN,
  lifecycle,
  queue,
} from "./host-fixture.ts";

const ROUTE_IDS: readonly HostRouteId[] = [
  "findings-board",
  "evidence-chain",
  "guardian-decision",
  "action-authorization",
  "execution-results",
  "inspect-why",
  "advisory-board",
];

describe("HostSurface shape (contract §2)", () => {
  it("exposes the stable surface identity", () => {
    expect(SAFETY_INTEL_HOST_SURFACE.surfaceId).toBe("safety-intel");
    expect(SAFETY_INTEL_HOST_SURFACE.surfaceKind).toBe("lane-experience");
  });

  it("carries the 7 F300B routes with no dangling drill refs", () => {
    expect(Object.keys(SAFETY_INTEL_ROUTES).sort()).toEqual([...ROUTE_IDS].sort());
    for (const id of ROUTE_IDS) {
      const route = SAFETY_INTEL_ROUTES[id];
      expect(route.routeId).toBe(id);
      expect(route.title.length).toBeGreaterThan(5);
      expect(route.description.length).toBeGreaterThan(20);
      for (const drill of route.drills) {
        expect(ROUTE_IDS).toContain(drill);
        expect(drill).not.toBe(id);
      }
    }
  });

  it("catalogues 3 inert intents bound to the lane's CommandDraft builders", () => {
    const intents = SAFETY_INTEL_HOST_SURFACE.intents;
    expect(Object.keys(intents).sort()).toEqual([
      "security.advisory.request-refresh",
      "security.findings.request-remediation",
      "security.plans.propose-step",
    ].sort());
    for (const eventId of Object.keys(intents)) {
      const intent = intents[eventId as keyof typeof intents];
      expect(intent.eventId).toBe(eventId);
      expect(intent.inert).toBe(true);
      expect(intent.requiredInputs.length).toBeGreaterThan(0);
    }
    expect(intents["security.findings.request-remediation"].builderId).toBe("requestRemediation");
    expect(intents["security.plans.propose-step"].builderId).toBe("proposeActionPlanStep");
    expect(intents["security.advisory.request-refresh"].builderId).toBe("requestAdvisoryRefresh");
  });

  it("carries NO submit/execute/dispatch member anywhere on the surface (inert intents)", () => {
    const surfaceKeys = Object.keys(SAFETY_INTEL_HOST_SURFACE);
    for (const forbidden of ["submit", "execute", "dispatch", "enqueue", "commandQueue"]) {
      expect(surfaceKeys).not.toContain(forbidden);
    }
    const moduleExports = Object.keys(SAFETY_INTEL_HOST_SURFACE.intents);
    expect(moduleExports.every((k) => k.startsWith("security."))).toBe(true);
  });
});

describe("buildViewModels — purity and determinism (contract law 1)", () => {
  it("builds all 7 routes over the full composed slice", () => {
    const result = buildViewModels(fullSlice(), hostCtx());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const routes = result.views.routes;
    expect(routes["findings-board"].rollup.totalFindings).toBe(2);
    expect(routes["evidence-chain"].entries.length).toBe(2);
    expect(routes["guardian-decision"].ruleCatalog.entries.length).toBe(2);
    expect(routes["action-authorization"].composed).toBe(true);
    expect(routes["execution-results"].ledger.length).toBe(3);
    expect(routes["inspect-why"].composed).toBe(true);
    expect(routes["advisory-board"].composed).toBe(true);
    expect(result.views.tenantId).toBe(TENANT_ID);
    expect(result.views.scope).toBe("tenant");
  });

  it("same slice + ctx => byte-identical view models + stable digest", () => {
    const slice = fullSlice();
    const a = buildViewModels(slice, hostCtx());
    const b = buildViewModels(slice, hostCtx());
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(JSON.stringify(a.views)).toBe(JSON.stringify(b.views));
    expect(a.views.viewModelsDigest).toBe(b.views.viewModelsDigest);
    expect(a.views.viewModelsDigest).toMatch(/^[0-9a-f]{8}$/);
  });

  it("input order never leaks (shuffled findings/grants/audit/advisory inputs => same digest)", () => {
    // The ledger and evidence chain stay in canonical order — the REAL domain
    // law (append-only, index-advancing); everything else is presentation-
    // ordered by the builders, so arrival order must never leak.
    const base = buildViewModels(fullSlice(), hostCtx());
    const shuffled = buildViewModels(
      {
        ...fullSlice(),
        findings: [...findings()].reverse(),
        grants: [...grants()].reverse(),
        actionAuditEvents: [...auditEvents()].reverse(),
        predictions: [prediction()],
        worldContexts: [worldContext()],
      },
      hostCtx(),
    );
    expect(base.ok).toBe(true);
    expect(shuffled.ok).toBe(true);
    if (!base.ok || !shuffled.ok) return;
    expect(shuffled.views.viewModelsDigest).toBe(base.views.viewModelsDigest);
  });

  it("a different slice yields a different digest (the digest is honest)", () => {
    const a = buildViewModels(fullSlice(), hostCtx());
    const b = buildViewModels({ ...fullSlice(), findings: findings().slice(0, 1) }, hostCtx());
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(b.views.viewModelsDigest).not.toBe(a.views.viewModelsDigest);
  });
});

describe("buildViewModels — context validation (fail-closed)", () => {
  it("refuses an empty tenant id", () => {
    const result = buildViewModels(fullSlice(), hostCtx({ tenantId: "" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refused.route).toBe("host");
    expect(result.refused.code).toBe("host.missing-tenant");
  });

  it("refuses a malformed context (actor/session/establishedAt)", () => {
    for (const ctx of [
      hostCtx({ actorId: "" }),
      hostCtx({ sessionId: "" }),
      hostCtx({ establishedAt: 0 }),
      hostCtx({ establishedAt: 1.5 }),
    ]) {
      const result = buildViewModels(fullSlice(), ctx);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.refused.code).toBe("host.invalid-context");
    }
  });
});

describe("buildViewModels — tenant fail-closed (A8, contract law 4)", () => {
  it("a cross-tenant finding refuses the WHOLE view, offender named", () => {
    const foreign = findings(FOREIGN_TENANT_ID);
    const result = buildViewModels({ ...fullSlice(), findings: foreign }, hostCtx());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refused.route).toBe("findings-board");
    expect(result.refused.code).toBe("views.cross-tenant-finding");
    expect(result.refused.detail).toContain(FOREIGN_TENANT_ID);
  });

  it("a cross-tenant policy refuses the whole view", () => {
    const result = buildViewModels({ ...fullSlice(), policy: tenantPolicy(FOREIGN_TENANT_ID) }, hostCtx());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refused.route).toBe("guardian-decision");
    expect(result.refused.code).toBe("views.cross-tenant-policy");
  });

  it("a cross-tenant grant refuses the whole view", () => {
    const foreignGrant = grants().map((g) => ({ ...g, tenantId: FOREIGN_TENANT_ID }));
    const result = buildViewModels({ ...fullSlice(), grants: foreignGrant }, hostCtx());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refused.code).toBe("views.cross-tenant-grant");
  });

  it("a cross-tenant queue refuses the whole view", () => {
    const foreignQueue = { ...queue(), tenantId: FOREIGN_TENANT_ID };
    const result = buildViewModels(
      { ...fullSlice(), plan: PLAN, lifecycle: lifecycle(), queue: foreignQueue },
      hostCtx(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refused.route).toBe("action-authorization");
    expect(result.refused.code).toBe("views.cross-tenant-queue");
  });

  it("a cross-tenant ledger entry refuses the whole view", () => {
    const foreignLedger = ledger().map((e, i) => ({ ...e, tenantId: FOREIGN_TENANT_ID, index: i }));
    const result = buildViewModels({ ...fullSlice(), ledger: foreignLedger }, hostCtx());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refused.route).toBe("execution-results");
    expect(result.refused.code).toBe("execution.cross-tenant-entry");
  });

  it("a cross-tenant audit event refuses the whole view", () => {
    const foreignAudit = auditEvents().map((e) => ({ ...e, tenantId: FOREIGN_TENANT_ID }));
    const result = buildViewModels({ ...fullSlice(), actionAuditEvents: foreignAudit }, hostCtx());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refused.route).toBe("execution-results");
    expect(result.refused.code).toBe("execution.cross-tenant-audit");
  });

  it("a cross-tenant action refuses the whole view", () => {
    const foreignAction = actionRecord();
    const result = buildViewModels(
      {
        ...fullSlice(),
        action: {
          ...foreignAction,
          intent: { ...foreignAction.intent, tenant: { tenantId: FOREIGN_TENANT_ID } },
        },
      },
      hostCtx(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refused.route).toBe("inspect-why");
    expect(result.refused.code).toBe("views.cross-tenant-action");
  });

  it("a cross-tenant evidence entry refuses the whole view", () => {
    const foreignChain = evidenceChain().map((e) => ({ ...e, tenantId: FOREIGN_TENANT_ID }));
    const result = buildViewModels({ ...fullSlice(), evidenceChain: foreignChain, evidenceRecords: [] }, hostCtx());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refused.route).toBe("evidence-chain");
    expect(result.refused.code).toBe("evidence.cross-tenant-entry");
  });

  it("a cross-tenant prediction refuses the whole view (host-level check)", () => {
    const foreignPrediction = {
      ...prediction(),
      tenant: { tenantId: FOREIGN_TENANT_ID },
    };
    const result = buildViewModels({ ...fullSlice(), predictions: [foreignPrediction] }, hostCtx());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refused.route).toBe("advisory-board");
    expect(result.refused.code).toBe("advisory.cross-tenant-prediction");
    expect(result.refused.detail).toContain(FOREIGN_TENANT_ID);
  });

  it("a cross-tenant world context refuses the whole view (host-level check)", () => {
    const foreignContext = {
      ...worldContext(),
      tenantId: FOREIGN_TENANT_ID,
    };
    const result = buildViewModels({ ...fullSlice(), worldContexts: [foreignContext] }, hostCtx());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refused.route).toBe("advisory-board");
    expect(result.refused.code).toBe("advisory.cross-tenant-context");
  });
});

describe("buildViewModels — honest not-composed sections (contract law 5)", () => {
  function sliceWithout(omit: keyof SafetyIntelSlice | (keyof SafetyIntelSlice)[]): SafetyIntelSlice {
    const slice = fullSlice();
    const keys = Array.isArray(omit) ? omit : [omit];
    const copy: Record<string, unknown> = { ...slice };
    for (const key of keys) delete copy[key as string];
    return copy as unknown as SafetyIntelSlice;
  }

  it("an absent plan composes an explicit not-composed marker, never a fabricated board", () => {
    const result = buildViewModels(sliceWithout("plan"), hostCtx());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const route = result.views.routes["action-authorization"];
    expect(route.composed).toBe(false);
    if (route.composed) return;
    expect(route.reason).toBe("plan-not-composed");
  });

  it("an absent action composes an explicit not-composed inspect-why marker", () => {
    const result = buildViewModels(sliceWithout("action"), hostCtx());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const route = result.views.routes["inspect-why"];
    expect(route.composed).toBe(false);
    if (route.composed) return;
    expect(route.reason).toBe("action-not-composed");
  });

  it("zero advisory inputs compose an honest empty advisory route (advisory carried regardless)", () => {
    const result = buildViewModels(
      { ...fullSlice(), predictions: [], worldContexts: [] },
      hostCtx(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const route = result.views.routes["advisory-board"];
    expect(route.composed).toBe(false);
    if (route.composed) return;
    expect(route.advisory).toBe(true);
    expect(route.reason).toBe("no-advisory-cards");
    expect(route.modelRegistry.trainedValidated).toEqual([]);
  });

  it("empty findings compose an honest empty findings board (verified empty, not refusal)", () => {
    const result = buildViewModels({ ...fullSlice(), findings: [], remediations: [] }, hostCtx());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.views.routes["findings-board"].rollup.totalFindings).toBe(0);
  });
});

describe("buildViewModels — honesty fields carried verbatim (contract law 5)", () => {
  it("carries the ceilings-are-not-authorizations marker structurally", () => {
    const result = buildViewModels(fullSlice(), hostCtx());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const entry of result.views.routes["guardian-decision"].ceilingBoard.entries) {
      expect(entry.ceilingSatisfiedIsNotAuthorization).toBe(true);
      expect("authorized" in entry).toBe(false);
      expect("verdict" in entry).toBe(false);
    }
  });

  it("presents the REAL ledger verification outcome verbatim", () => {
    const result = buildViewModels(fullSlice(), hostCtx());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const route = result.views.routes["execution-results"];
    expect(route.verification.verified).toBe(true);
    expect(route.replay?.commandCount).toBe(1);
    const tamperedLedger = ledger().map((e, i) => (i === 1 ? { ...e, detail: "forged" } : e));
    const tampered = buildViewModels({ ...fullSlice(), ledger: tamperedLedger }, hostCtx());
    expect(tampered.ok).toBe(true);
    if (!tampered.ok) return;
    expect(tampered.views.routes["execution-results"].verification.verified).toBe(false);
    expect(tampered.views.routes["execution-results"].verification.brokenAt).toBe(1);
  });

  it("presents the authorization state honestly (not pending, verdict carried)", () => {
    const result = buildViewModels(fullSlice(), hostCtx());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const route = result.views.routes["inspect-why"];
    expect(route.composed).toBe(true);
    if (!route.composed) return;
    expect(route.provenance.authorizationPending).toBe(false);
    expect(route.provenance.guardian?.verdict).toBe("REQUIRE_APPROVAL");
    expect(route.provenance.actionState).toBe("recorded");
  });

  it("carries dead-letter visibility from the real queue", () => {
    const result = buildViewModels(fullSlice(), hostCtx());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.views.routes["execution-results"].deadLetters).toEqual([]);
    const board = result.views.routes["action-authorization"];
    expect(board.composed).toBe(true);
    if (!board.composed) return;
    expect(board.planBoard.steps[0]?.queueStatus).toBe("completed");
    expect(board.planBoard.deadLetterCount).toBe(0);
  });

  it("carries the audit trail summary over the real emitted events", () => {
    const result = buildViewModels(fullSlice(), hostCtx());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const trail = result.views.routes["execution-results"].auditTrail;
    expect(trail).not.toBeNull();
    expect(trail?.eventCount).toBe(auditEvents().length);
    expect(trail?.distinctIntents).toBe(1);
  });
});
