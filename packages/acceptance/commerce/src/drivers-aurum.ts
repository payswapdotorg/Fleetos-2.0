/**
 * @fleetos/acceptance-commerce — Aurum settlement-adapter step drivers.
 *
 * Interprets typed journey steps against the REAL public entry points of
 * @fleetos/aurum (the deterministic reference adapter — no network):
 * idempotent invokes with cache hits, honest degraded/unavailable states,
 * tenant-scoped idempotency separation, and the never-owns-domain-truth
 * boundary assertions. Facts are verbatim REAL outputs.
 */

import type { FactValue, AurumStep } from "./journey-contracts.js";
import type { JourneyState } from "./journey-world.js";
import { logPush } from "./journey-world.js";
import { isAurumProjection, aurumDoesNotOwnDomainTruth } from "@fleetos/aurum";

export type DriverFacts = Record<string, FactValue>;

/** The commerce lane's domain record kinds — the adapter must never own these. */
const AURUM_DOMAIN_KINDS: readonly string[] = [
  "work-item",
  "quote",
  "order",
  "fulfillment",
  "subscription",
  "project",
  "vendor",
];

export async function runAurumStep(step: AurumStep, state: JourneyState): Promise<DriverFacts> {
  switch (step.kind) {
    case "aurum-invoke":
    case "aurum-outage-invoke": {
      const port = step.kind === "aurum-outage-invoke" ? state.aurum.outagePort : state.aurum.port;
      const tenant = step.kind === "aurum-invoke" && step.foreignTenant === true ? state.otherTenant : state.tenant;
      const result = port.invoke({
        tenant,
        intent: step.intent,
        payload: {},
        idempotencyKey: step.idempotencyKey,
      });
      logPush(
        state,
        "aurum.kindLog",
        `${result.ok}:${result.ok ? (result.fromCache ? "cached" : "fresh") : result.reasonCode}:${result.ok ? 0 : result.attempts}:${result.ok && typeof result.result.kind === "string" ? result.result.kind : "-"}`,
      );
      return {
        "aurum.ok": result.ok,
        "aurum.fromCache": result.ok ? result.fromCache : false,
        "aurum.reasonCode": result.ok ? null : result.reasonCode,
        "aurum.attempts": result.ok ? 0 : result.attempts,
        "aurum.resultKind": result.ok && typeof result.result.kind === "string" ? result.result.kind : null,
      };
    }
    case "aurum-boundary": {
      const projection = { kind: step.projectionKind };
      const isProjection = isAurumProjection(projection);
      const doesNotOwnTruth = aurumDoesNotOwnDomainTruth(projection, AURUM_DOMAIN_KINDS);
      logPush(state, "aurum.boundaryLog", `${isProjection}:${doesNotOwnTruth}`);
      return {
        "aurum.isProjection": isProjection,
        "aurum.doesNotOwnTruth": doesNotOwnTruth,
      };
    }
  }
}
