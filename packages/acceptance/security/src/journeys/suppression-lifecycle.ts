/**
 * F321B journey — finding suppression lifecycle (persona: security-analyst).
 *
 * The honest suppression discipline (@fleetos/security lifecycle — Wave 5):
 * suppressed != resolved, suppressions EXPIRE, and an expired suppression
 * RETURNS THE FINDING TO OPEN — never silently resolved:
 *   - suppressFinding keeps the finding open-but-hidden (state "suppressed",
 *     isEffectivelyOpen false) with the full transition history;
 *   - expireSuppressions with `now` BEFORE the expiry leaves it suppressed;
 *     with `now` AT/AFTER the expiry the finding honestly transitions to
 *     "expired_suppression" — which IS effectively open again;
 *   - resolveFinding on a suppressed finding resolves it outright and CLEARS
 *     the suppression (resolved is terminal, not hidden);
 *   - a still-suppressed finding is not effectively open; a plain open one is.
 *
 * Determinism: logical epochs (BASE_MS offsets) rendered through the
 * fixture-world's pure isoOfEpochMs; no clock, no randomness, no network.
 */

import type { AcceptanceJourney } from "../journey-contracts.ts";
import { runFindingIntake } from "@fleetos/security";
import { expireSuppressions, initLifecycle, isEffectivelyOpen, resolveFinding, suppressFinding } from "@fleetos/security";
import type { FindingWithLifecycle } from "@fleetos/security";
import { BASE_MS, TENANT, findingRecord, isoOfEpochMs } from "./fixture-world.ts";

const SUPPRESSED_AT = isoOfEpochMs(BASE_MS + 60_000);
const EXPIRES_AT = isoOfEpochMs(BASE_MS + 600_000);
const BEFORE_EXPIRY = isoOfEpochMs(BASE_MS + 300_000);
const AT_EXPIRY = isoOfEpochMs(BASE_MS + 600_000);
const AFTER_EXPIRY = isoOfEpochMs(BASE_MS + 900_000);
const RESOLVED_AT = isoOfEpochMs(BASE_MS + 120_000);

/** One REAL admitted finding from the REAL intake pipeline. */
function admittedFinding(description: string) {
  const result = runFindingIntake(
    [
      {
        tenantId: TENANT.tenantId,
        kind: "auth.weak_credential",
        declaredSeverity: "medium",
        confidence: "confirmed",
        detectedAt: BASE_MS + 1_000,
        assetIds: ["pump-7"],
        description,
        evidenceRefs: ["ev-suppression-1"],
        signalCount: 3,
      },
    ],
    { correlationWindowMs: 120_000 },
  );
  const admitted = result.admitted[0];
  if (admitted === undefined) throw new Error(`finding "${description}" not admitted`);
  return initLifecycle(findingRecord(admitted));
}

export const suppressionLifecycleJourney: AcceptanceJourney = {
  journeyId: "security.finding-suppression-lifecycle",
  persona: "security-analyst",
  capabilities: ["investigate-findings"],
  goal: "Suppress, expire and resolve findings honestly — an expired suppression returns the finding to open",
  steps: [
    {
      stepId: "suppress-and-expire",
      kind: "lifecycle",
      description: "Suppress a real finding, sweep before and after expiry, verify the honest return-to-open",
      packages: ["@fleetos/security"],
      operations: ["initLifecycle", "suppressFinding", "expireSuppressions", "isEffectivelyOpen"],
      run: (ctx) => {
        const open = admittedFinding("weak credential on pump-7");
        ctx.record("lifecycle.initial.state", open.state);
        ctx.record("lifecycle.initial.effectivelyOpen", isEffectivelyOpen(open));
        ctx.record("lifecycle.initial.suppression", open.suppression);
        ctx.record("lifecycle.initial.transitions", open.transitions.length);

        const suppressed = suppressFinding(open, {
          suppressionId: "supp-001",
          suppressedBy: "analyst-kim",
          suppressedAt: SUPPRESSED_AT,
          expiresAt: EXPIRES_AT,
          reason: "awaiting vendor patch — false-positive window",
        });
        ctx.record("suppress.state", suppressed.state);
        ctx.record("suppress.effectivelyOpen", isEffectivelyOpen(suppressed));
        ctx.record("suppress.active", suppressed.suppression?.active ?? null);
        ctx.record("suppress.expiresAt", suppressed.suppression?.expiresAt ?? "none");
        ctx.record("suppress.suppressedBy", suppressed.suppression?.suppressedBy ?? "none");
        ctx.record("suppress.transitions", suppressed.transitions.map((t) => `${t.from}>${t.to}`));
        ctx.record("suppress.lastTransitionAt", suppressed.lastTransitionAt);

        // Sweep BEFORE expiry: the suppression holds.
        const beforeSweep = expireSuppressions([suppressed], BEFORE_EXPIRY);
        ctx.record("expire.before.state", beforeSweep[0]?.state ?? "missing");
        ctx.record("expire.before.effectivelyOpen", isEffectivelyOpen(beforeSweep[0] as FindingWithLifecycle));
        ctx.record("expire.before.active", beforeSweep[0]?.suppression?.active ?? null);

        // Sweep AT expiry (boundary: expiresAt is no longer in the future):
        // the finding transitions to expired_suppression — OPEN again.
        const atSweep = expireSuppressions([suppressed], AT_EXPIRY);
        const expired = atSweep[0];
        if (expired === undefined) throw new Error("expiry sweep lost the finding");
        ctx.record("expire.at.state", expired.state);
        ctx.record("expire.at.effectivelyOpen", isEffectivelyOpen(expired));
        ctx.record("expire.at.active", expired.suppression?.active ?? null);
        ctx.record("expire.at.transitionCount", expired.transitions.length);
        ctx.record("expire.at.lastReason", expired.transitions[expired.transitions.length - 1]?.reason ?? "none");
        ctx.record("expire.at.actor", expired.transitions[expired.transitions.length - 1]?.actorId ?? "none");
        ctx.record("expire.at.lastTransitionAt", expired.lastTransitionAt);

        // The boundary is inclusive: expiry exactly AT expiresAt expires it.
        ctx.record("expire.boundaryIsInclusive", expired.state === "expired_suppression" && AT_EXPIRY === EXPIRES_AT);

        // Re-sweep after expiry is idempotent (already expired, stays put).
        const reSweep = expireSuppressions([expired], AFTER_EXPIRY);
        ctx.record("expire.reSweep.state", reSweep[0]?.state ?? "missing");
        ctx.record("expire.reSweep.transitionCount", reSweep[0]?.transitions.length ?? -1);
      },
    },
    {
      stepId: "resolve-and-contrast",
      kind: "negative-check",
      description: "Resolve a suppressed finding outright; contrast the three lifecycle states honestly",
      packages: ["@fleetos/security"],
      operations: ["suppressFinding", "resolveFinding", "isEffectivelyOpen", "expireSuppressions"],
      run: (ctx) => {
        // A SECOND real finding, suppressed then RESOLVED: the suppression is
        // cleared — resolution is terminal, not a hiding mechanism.
        const second = suppressFinding(admittedFinding("stale mfa on pump-7"), {
          suppressionId: "supp-002",
          suppressedBy: "analyst-kim",
          suppressedAt: SUPPRESSED_AT,
          expiresAt: EXPIRES_AT,
          reason: "temporarily accepted risk",
        });
        const resolved = resolveFinding(second, RESOLVED_AT, "operator-ada");
        ctx.record("resolve.fromSuppressed.state", resolved.state);
        ctx.record("resolve.suppressionCleared", resolved.suppression);
        ctx.record("resolve.effectivelyOpen", isEffectivelyOpen(resolved));
        ctx.record("resolve.transitions", resolved.transitions.map((t) => `${t.from}>${t.to}`));
        ctx.record("resolve.actor", resolved.transitions[resolved.transitions.length - 1]?.actorId ?? "none");
        ctx.record("resolve.reason", resolved.transitions[resolved.transitions.length - 1]?.reason ?? "none");

        // A still-suppressed finding (expiry far in the future) is NOT open.
        const stillSuppressed = suppressFinding(admittedFinding("open ingress on pump-7"), {
          suppressionId: "supp-003",
          suppressedBy: "analyst-kim",
          suppressedAt: SUPPRESSED_AT,
          expiresAt: isoOfEpochMs(BASE_MS + 86_400_000),
          reason: "long suppression",
        });
        const afterSweep = expireSuppressions([stillSuppressed], AFTER_EXPIRY);
        ctx.record("contrast.stillSuppressed.state", afterSweep[0]?.state ?? "missing");
        ctx.record("contrast.stillSuppressed.effectivelyOpen", isEffectivelyOpen(afterSweep[0] as FindingWithLifecycle));

        // An untouched finding IS effectively open.
        const untouched = admittedFinding("unhandled finding");
        ctx.record("contrast.untouched.state", untouched.state);
        ctx.record("contrast.untouched.effectivelyOpen", isEffectivelyOpen(untouched));

        // The three-state honesty: suppressed (hidden), expired (open),
        // resolved (closed) — all three machine-distinguishable.
        const states = [
          (afterSweep[0] as FindingWithLifecycle).state,
          resolved.state,
          untouched.state,
        ];
        ctx.record("contrast.threeStatesDistinct", new Set(states).size === 3);
      },
    },
  ],
  assertions: [
    { assertionId: "sl-1", description: "A new finding starts open", path: "lifecycle.initial.state", expected: "open" },
    { assertionId: "sl-2", description: "An open finding is effectively open", path: "lifecycle.initial.effectivelyOpen", expected: true },
    { assertionId: "sl-3", description: "No suppression record before suppression", path: "lifecycle.initial.suppression", expected: null },
    { assertionId: "sl-4", description: "No transitions before suppression", path: "lifecycle.initial.transitions", expected: 0 },
    { assertionId: "sl-5", description: "Suppressed state machine-stable", path: "suppress.state", expected: "suppressed" },
    { assertionId: "sl-6", description: "A suppressed finding is NOT effectively open (hidden from posture)", path: "suppress.effectivelyOpen", expected: false },
    { assertionId: "sl-7", description: "The suppression is active", path: "suppress.active", expected: true },
    { assertionId: "sl-8", description: "Expiry carried on the record", path: "suppress.expiresAt", expected: "2026-10-12T18:50:00.000Z" },
    { assertionId: "sl-9", description: "Suppressor carried for provenance", path: "suppress.suppressedBy", expected: "analyst-kim" },
    { assertionId: "sl-10", description: "The open>suppressed transition recorded", path: "suppress.transitions", expected: ["open>suppressed"] },
    { assertionId: "sl-11", description: "Last transition time is the suppression time", path: "suppress.lastTransitionAt", expected: "2026-10-12T18:41:00.000Z" },
    { assertionId: "sl-12", description: "Sweep before expiry leaves it suppressed", path: "expire.before.state", expected: "suppressed" },
    { assertionId: "sl-13", description: "Still not effectively open before expiry", path: "expire.before.effectivelyOpen", expected: false },
    { assertionId: "sl-14", description: "Suppression still active before expiry", path: "expire.before.active", expected: true },
    { assertionId: "sl-15", description: "Sweep at expiry transitions to expired_suppression", path: "expire.at.state", expected: "expired_suppression" },
    { assertionId: "sl-16", description: "The HONEST return-to-open: expired suppression is effectively open", path: "expire.at.effectivelyOpen", expected: true },
    { assertionId: "sl-17", description: "The expired suppression is deactivated", path: "expire.at.active", expected: false },
    { assertionId: "sl-18", description: "Both transitions recorded append-only", path: "expire.at.transitionCount", expected: 2 },
    { assertionId: "sl-19", description: "Expiry transition reason carried", path: "expire.at.lastReason", expected: "suppression expired" },
    { assertionId: "sl-20", description: "Expiry attributed to the system actor", path: "expire.at.actor", expected: "system" },
    { assertionId: "sl-21", description: "Expiry transition time is the sweep time", path: "expire.at.lastTransitionAt", expected: "2026-10-12T18:50:00.000Z" },
    { assertionId: "sl-22", description: "The boundary is inclusive (expiresAt itself expires)", path: "expire.boundaryIsInclusive", expected: true },
    { assertionId: "sl-23", description: "Re-sweep after expiry is idempotent", path: "expire.reSweep.state", expected: "expired_suppression" },
    { assertionId: "sl-24", description: "No extra transition on the idempotent re-sweep", path: "expire.reSweep.transitionCount", expected: 2 },
    { assertionId: "sl-25", description: "Resolving a suppressed finding resolves outright", path: "resolve.fromSuppressed.state", expected: "resolved" },
    { assertionId: "sl-26", description: "Resolution CLEARS the suppression record", path: "resolve.suppressionCleared", expected: null },
    { assertionId: "sl-27", description: "A resolved finding is not effectively open", path: "resolve.effectivelyOpen", expected: false },
    { assertionId: "sl-28", description: "The full transition chain recorded", path: "resolve.transitions", expected: ["open>suppressed", "suppressed>resolved"] },
    { assertionId: "sl-29", description: "Resolution actor carried", path: "resolve.actor", expected: "operator-ada" },
    { assertionId: "sl-30", description: "Resolution reason carried", path: "resolve.reason", expected: "resolved" },
    { assertionId: "sl-31", description: "A long suppression survives the sweep", path: "contrast.stillSuppressed.state", expected: "suppressed" },
    { assertionId: "sl-32", description: "A still-suppressed finding is not effectively open", path: "contrast.stillSuppressed.effectivelyOpen", expected: false },
    { assertionId: "sl-33", description: "An untouched finding stays open", path: "contrast.untouched.state", expected: "open" },
    { assertionId: "sl-34", description: "An untouched finding is effectively open", path: "contrast.untouched.effectivelyOpen", expected: true },
    { assertionId: "sl-35", description: "Suppressed/expired/resolved are machine-distinguishable", path: "contrast.threeStatesDistinct", expected: true },
  ],
};
