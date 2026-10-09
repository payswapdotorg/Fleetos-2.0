/**
 * Journey 17 — host-surface integration (F300B deliverable 1; persona:
 * security-analyst).
 *
 * An analyst drives the REAL HostSurface adapter — the WAVE10 seam the TL's
 * F301 shell mounts — over a REAL composed slice (composition in
 * ./wave10-world.ts, file law):
 *   - the surface manifest: stable id, the 7 routes, no dangling drills,
 *     the 3-intent catalog with machine-carried inert markers;
 *   - `buildViewModels` composes ALL 7 route views from the lane's REAL
 *     read-models, byte-identically on rebuild (determinism law);
 *   - the intent dispatcher produces INERT CommandDraft records — a draft
 *     carries no authorization surface and never executes;
 *   - NEGATIVE: tenant fail-closed at the HOST boundary (a cross-tenant
 *     finding / prediction refuses the WHOLE view, route + code named);
 *   - the honest not-composed markers for optional sections.
 */

import type { AcceptanceJourney } from "../journey-contracts.ts";
import {
  SAFETY_INTEL_HOST_SURFACE,
  buildHostIntentDraft,
  buildHostIntentDraftUntyped,
  isKnownIntentEvent,
} from "@fleetos/experience-safety-intel";
import type { SafetyIntelSlice } from "@fleetos/experience-safety-intel";
import { TENANT, FOREIGN_TENANT, NOW_MS } from "./fixture-world.ts";
import { HOST_CTX, hostJourneySlice } from "./wave10-world.ts";

function surfaceBuild(): ReturnType<typeof SAFETY_INTEL_HOST_SURFACE.buildViewModels> {
  return SAFETY_INTEL_HOST_SURFACE.buildViewModels(hostJourneySlice(), HOST_CTX);
}

/** Omit one key from a readonly slice (honest not-composed composition). */
function withoutPlan(slice: SafetyIntelSlice): SafetyIntelSlice {
  const { plan: _plan, ...rest } = slice;
  return rest;
}

export const hostSurfaceJourney: AcceptanceJourney = {
  journeyId: "security.host-surface",
  persona: "security-analyst",
  capabilities: ["host-surface-integration", "decision-provenance", "tenant-isolation"],
  goal: "Mount the safety-intel HostSurface over real read-models and verify the contract laws",
  steps: [
    {
      stepId: "surface-manifest",
      kind: "view-read",
      description: "Inspect the HostSurface manifest: stable id, 7 routes, inert intent catalog",
      packages: ["@fleetos/experience-safety-intel"],
      operations: ["isKnownIntentEvent", "buildViewModels"],
      run: (ctx) => {
        const surface = SAFETY_INTEL_HOST_SURFACE;
        ctx.record("surface.id", surface.surfaceId);
        ctx.record("surface.kind", surface.surfaceKind);
        ctx.record("surface.routeIds", Object.keys(surface.routes).sort());
        ctx.record("surface.routeCount", Object.keys(surface.routes).length);
        const drills = Object.values(surface.routes).flatMap((r) => [...r.drills]);
        ctx.record("surface.drillsAllResolve", drills.every((d) => d in surface.routes));
        ctx.record("surface.intentEventIds", Object.keys(surface.intents).sort());
        ctx.record("surface.intentsAllInert", Object.values(surface.intents).every((i) => i.inert === true));
        ctx.record("surface.hasSubmitMember", "submit" in surface);
        ctx.record("surface.hasExecuteMember", "execute" in surface);
        ctx.record("surface.guardRejectsUnknownEvent", !isKnownIntentEvent("security.not-an-event"));
      },
    },
    {
      stepId: "view-models",
      kind: "view-read",
      description: "Build all 7 route view models over the REAL composed slice, twice",
      packages: ["@fleetos/experience-safety-intel"],
      operations: ["buildViewModels"],
      run: (ctx) => {
        const first = surfaceBuild();
        if (!first.ok) throw new Error(`view models refused: ${first.refused.code} (${first.refused.detail})`);
        const views = first.views;
        ctx.record("vm.tenantId", views.tenantId);
        ctx.record("vm.findingsTotal", views.routes["findings-board"].rollup.totalFindings);
        ctx.record("vm.evidenceEntries", views.routes["evidence-chain"].entries.length);
        ctx.record("vm.evidenceVerified", views.routes["evidence-chain"].verification.verified);
        ctx.record("vm.ruleCount", views.routes["guardian-decision"].ruleCatalog.entries.length);
        ctx.record("vm.ceilingEntries", views.routes["guardian-decision"].ceilingBoard.entries.length);
        ctx.record("vm.actionAuthorizationComposed", views.routes["action-authorization"].composed);
        ctx.record("vm.planStepStatus", views.routes["action-authorization"].composed
          ? views.routes["action-authorization"].planBoard.steps[0]?.queueStatus ?? "none"
          : "not-composed");
        ctx.record("vm.executionLedgerEntries", views.routes["execution-results"].ledger.length);
        ctx.record("vm.executionVerified", views.routes["execution-results"].verification.verified);
        ctx.record("vm.inspectWhyComposed", views.routes["inspect-why"].composed);
        ctx.record("vm.inspectWhyState", views.routes["inspect-why"].composed
          ? views.routes["inspect-why"].provenance.actionState
          : "not-composed");
        ctx.record("vm.inspectWhyVerdict", views.routes["inspect-why"].composed && views.routes["inspect-why"].provenance.guardian
          ? views.routes["inspect-why"].provenance.guardian.verdict
          : "none");
        ctx.record("vm.advisoryComposed", views.routes["advisory-board"].composed);
        ctx.record("vm.advisoryCardCount", views.routes["advisory-board"].composed
          ? views.routes["advisory-board"].board.cards.length
          : 0);
        ctx.record("vm.advisoryHonestyCount", views.routes["advisory-board"].composed
          ? views.routes["advisory-board"].cardHonesty.length
          : 0);
        ctx.record("vm.digestLength", views.viewModelsDigest.length);

        const second = surfaceBuild();
        if (!second.ok) throw new Error("second build refused");
        ctx.record("vm.deterministic", JSON.stringify(second.views) === JSON.stringify(views));
        ctx.record("vm.digestStable", second.views.viewModelsDigest === views.viewModelsDigest);

        // Honest not-composed: a slice without the plan composes the marker.
        const marker = SAFETY_INTEL_HOST_SURFACE.buildViewModels(withoutPlan(hostJourneySlice()), HOST_CTX);
        ctx.record("vm.noPlanComposed", marker.ok && !marker.views.routes["action-authorization"].composed ? "not-composed" : "composed");
      },
    },
    {
      stepId: "inert-intents",
      kind: "view-read",
      description: "Dispatch a catalogued UI event and verify the draft is inert",
      packages: ["@fleetos/experience-safety-intel"],
      operations: ["buildHostIntentDraft", "buildHostIntentDraftUntyped"],
      run: (ctx) => {
        const request = {
          eventId: "security.findings.request-remediation" as const,
          intentId: "intent-host-journey-1",
          tenantId: TENANT.tenantId,
          actorId: "operator-ada",
          requiredCapabilityId: "fleetos.security.remediation",
          reason: "rotate the weak credential from the host findings board",
          issuedAt: NOW_MS,
          proposalId: "prop-host-1",
          findingIds: ["finding-host-1"],
          remediationKind: "rotate_credential",
        };
        const draft = buildHostIntentDraft(request);
        if (!draft.ok) throw new Error(`draft refused: ${draft.refused}`);
        ctx.record("intent.draftMarker", draft.draft.intent.draft);
        ctx.record("intent.kind", draft.draft.kind);
        ctx.record("intent.hasAuthorizationSurface", "authorization" in draft.draft || "verdict" in draft.draft);
        const reDraft = buildHostIntentDraft(request);
        ctx.record("intent.deterministic", JSON.stringify(reDraft) === JSON.stringify(draft));

        const unknown = buildHostIntentDraftUntyped("security.unknown.event", {});
        ctx.record("intent.unknownOk", unknown.ok);
        ctx.record("intent.unknownReason", unknown.ok ? "unexpected" : unknown.refused);
        const missing = buildHostIntentDraftUntyped("security.advisory.request-refresh", {
          intentId: "intent-host-journey-2",
          tenantId: TENANT.tenantId,
          actorId: "operator-ada",
          requiredCapabilityId: "fleetos.predictive.advisory",
          reason: "refresh the vibration advisory",
          issuedAt: NOW_MS,
        });
        ctx.record("intent.missingInputOk", missing.ok);
        ctx.record("intent.missingInputReason", missing.ok ? "unexpected" : missing.refused);
      },
    },
    {
      stepId: "tenant-fail-closed",
      kind: "negative-check",
      description: "Cross-tenant records refuse the WHOLE host view, route + code named (A8)",
      packages: ["@fleetos/experience-safety-intel"],
      operations: ["buildViewModels"],
      run: (ctx) => {
        const slice = hostJourneySlice();
        const cross = SAFETY_INTEL_HOST_SURFACE.buildViewModels(
          { ...slice, findings: [{ ...slice.findings[0]!, tenantId: FOREIGN_TENANT.tenantId }] },
          HOST_CTX,
        );
        ctx.record("tenant.findingOk", cross.ok);
        ctx.record("tenant.findingRoute", cross.ok ? "unexpected-allow" : cross.refused.route);
        ctx.record("tenant.findingCode", cross.ok ? "unexpected-allow" : cross.refused.code);

        const noTenant = SAFETY_INTEL_HOST_SURFACE.buildViewModels(hostJourneySlice(), { ...HOST_CTX, tenantId: "" });
        ctx.record("tenant.emptyOk", noTenant.ok);
        ctx.record("tenant.emptyRoute", noTenant.ok ? "unexpected-allow" : noTenant.refused.route);
        ctx.record("tenant.emptyCode", noTenant.ok ? "unexpected-allow" : noTenant.refused.code);

        const foreignPrediction = SAFETY_INTEL_HOST_SURFACE.buildViewModels(
          { ...slice, predictions: [{ ...slice.predictions[0]!, tenant: { tenantId: FOREIGN_TENANT.tenantId } }] },
          HOST_CTX,
        );
        ctx.record("tenant.predictionOk", foreignPrediction.ok);
        ctx.record("tenant.predictionRoute", foreignPrediction.ok ? "unexpected-allow" : foreignPrediction.refused.route);
        ctx.record("tenant.predictionCode", foreignPrediction.ok ? "unexpected-allow" : foreignPrediction.refused.code);
      },
    },
  ],
  assertions: [
    { assertionId: "hs-1", description: "Stable surface id", path: "surface.id", expected: "safety-intel" },
    { assertionId: "hs-2", description: "Lane-experience surface kind", path: "surface.kind", expected: "lane-experience" },
    { assertionId: "hs-3", description: "The 7 F300B routes are the manifest", path: "surface.routeIds", expected: [
      "action-authorization", "advisory-board", "evidence-chain", "execution-results",
      "findings-board", "guardian-decision", "inspect-why",
    ] },
    { assertionId: "hs-4", description: "Seven routes catalogued", path: "surface.routeCount", expected: 7 },
    { assertionId: "hs-5", description: "No dangling drill refs", path: "surface.drillsAllResolve", expected: true },
    { assertionId: "hs-6", description: "The 3 catalogued intent events", path: "surface.intentEventIds", expected: [
      "security.advisory.request-refresh", "security.findings.request-remediation", "security.plans.propose-step",
    ] },
    { assertionId: "hs-7", description: "Every intent is machine-carried inert", path: "surface.intentsAllInert", expected: true },
    { assertionId: "hs-8", description: "The surface carries NO submit member (TL binds, never the lane)", path: "surface.hasSubmitMember", expected: false },
    { assertionId: "hs-9", description: "The surface carries NO execute member", path: "surface.hasExecuteMember", expected: false },
    { assertionId: "hs-10", description: "Unknown event ids are rejected by the guard", path: "surface.guardRejectsUnknownEvent", expected: true },
    { assertionId: "hs-11", description: "View models carry the tenant scope", path: "vm.tenantId", expected: "acme-ops" },
    { assertionId: "hs-12", description: "Findings board composes over the real findings", path: "vm.findingsTotal", expected: 1 },
    { assertionId: "hs-13", description: "Evidence chain route composes", path: "vm.evidenceEntries", expected: 2 },
    { assertionId: "hs-14", description: "Evidence chain verification presented verbatim", path: "vm.evidenceVerified", expected: true },
    { assertionId: "hs-15", description: "Rule catalog composes over the real policy", path: "vm.ruleCount", expected: 3 },
    { assertionId: "hs-16", description: "Ceiling board composes over the real capabilities", path: "vm.ceilingEntries", expected: 2 },
    { assertionId: "hs-17", description: "Action authorization route composes the plan board", path: "vm.actionAuthorizationComposed", expected: true },
    { assertionId: "hs-18", description: "The plan step shows its real queue status", path: "vm.planStepStatus", expected: "completed" },
    { assertionId: "hs-19", description: "Execution results route composes the real ledger", path: "vm.executionLedgerEntries", expected: 3 },
    { assertionId: "hs-20", description: "Ledger verification presented verbatim", path: "vm.executionVerified", expected: true },
    { assertionId: "hs-21", description: "Inspect-why route composes the provenance view", path: "vm.inspectWhyComposed", expected: true },
    { assertionId: "hs-22", description: "The action state is presented", path: "vm.inspectWhyState", expected: "recorded" },
    { assertionId: "hs-23", description: "The Guardian verdict is presented on the provenance", path: "vm.inspectWhyVerdict", expected: "REQUIRE_APPROVAL" },
    { assertionId: "hs-24", description: "Advisory route composes over real predictions + context", path: "vm.advisoryComposed", expected: true },
    { assertionId: "hs-25", description: "Two advisory cards presented", path: "vm.advisoryCardCount", expected: 2 },
    { assertionId: "hs-26", description: "Every card carries its honesty disclosure", path: "vm.advisoryHonestyCount", expected: 2 },
    { assertionId: "hs-27", description: "View-models digest is FNV-1a 8-hex", path: "vm.digestLength", expected: 8 },
    { assertionId: "hs-28", description: "Rebuild is byte-identical (determinism law)", path: "vm.deterministic", expected: true },
    { assertionId: "hs-29", description: "Digest is stable across rebuilds", path: "vm.digestStable", expected: true },
    { assertionId: "hs-30", description: "An absent plan composes the honest not-composed marker", path: "vm.noPlanComposed", expected: "not-composed" },
    { assertionId: "hs-31", description: "The dispatched draft carries draft: true (inert)", path: "intent.draftMarker", expected: true },
    { assertionId: "hs-32", description: "Draft kind is the remediation request", path: "intent.kind", expected: "security.remediation.request" },
    { assertionId: "hs-33", description: "The draft carries NO authorization surface", path: "intent.hasAuthorizationSurface", expected: false },
    { assertionId: "hs-34", description: "Draft dispatch is deterministic", path: "intent.deterministic", expected: true },
    { assertionId: "hs-35", description: "Unknown event ids are refused", path: "intent.unknownOk", expected: false },
    { assertionId: "hs-36", description: "Unknown-event refusal code", path: "intent.unknownReason", expected: "intent.unknown-event" },
    { assertionId: "hs-37", description: "A payload missing catalogued inputs is refused", path: "intent.missingInputOk", expected: false },
    { assertionId: "hs-38", description: "Missing-input refusal code", path: "intent.missingInputReason", expected: "intent.missing-required-input" },
    { assertionId: "hs-39", description: "A cross-tenant finding refuses the WHOLE host view", path: "tenant.findingOk", expected: false },
    { assertionId: "hs-40", description: "The refusing route is named (findings board)", path: "tenant.findingRoute", expected: "findings-board" },
    { assertionId: "hs-41", description: "The underlying refusal code is surfaced verbatim", path: "tenant.findingCode", expected: "views.cross-tenant-finding" },
    { assertionId: "hs-42", description: "An empty tenant id refuses the view", path: "tenant.emptyOk", expected: false },
    { assertionId: "hs-43", description: "Context-level refusal code", path: "tenant.emptyCode", expected: "host.missing-tenant" },
    { assertionId: "hs-44", description: "A cross-tenant prediction refuses the whole view (host boundary)", path: "tenant.predictionOk", expected: false },
    { assertionId: "hs-45", description: "The refusing route is named (advisory board)", path: "tenant.predictionRoute", expected: "advisory-board" },
    { assertionId: "hs-46", description: "The host-level prediction refusal code", path: "tenant.predictionCode", expected: "advisory.cross-tenant-prediction" },
  ],
};
