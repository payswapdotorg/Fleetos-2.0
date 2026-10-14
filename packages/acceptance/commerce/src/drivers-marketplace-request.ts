/**
 * @fleetos/acceptance-commerce — the marketplace equipment-request step
 * drivers (F361C, Wave 17 lane C).
 *
 * Interprets the mreq-* typed journey steps against the REAL public
 * entry points of `@fleetos/procurement` marketplace-request.ts:
 *   - submitEquipmentRequest — the IDEMPOTENT create+submit keyed
 *     tenant+natural key (a content-identical replay returns the
 *     ORIGINAL request with duplicate=true; the same natural key with
 *     different content refuses NATURAL_KEY_CONFLICT);
 *   - transitionEquipmentRequest — the §3.1 typed state machine with
 *     machine-stable refusal codes (ILLEGAL_TRANSITION,
 *     REFUSE/CANCEL/DISPUTE_REASON_REQUIRED, SELECT_OFFER_ID_REQUIRED)
 *     and the append-only transition events;
 *   - findEquipmentRequest — the tenant fail-closed read (the OTHER
 *     tenant sees NOTHING, never a record);
 *   - buildEquipmentRequestBoard — the deterministic per-tenant summary.
 *
 * The per-journey population lives in a WeakMap keyed by JourneyState —
 * a fresh world per run keeps every run pure and deterministic. Refusal
 * results are honest facts carrying the domain reason codes.
 */

import type { FactValue } from "./journey-contracts.js";
import type { MarketplaceRequestStep } from "./journey-contracts-f361c.js";
import type { JourneyState } from "./journey-world.js";
import { OTHER_TENANT, logPush } from "./journey-world.js";
import type { EquipmentRequest } from "@fleetos/procurement";
import {
  submitEquipmentRequest,
  transitionEquipmentRequest,
  findEquipmentRequest,
  buildEquipmentRequestBoard,
} from "@fleetos/procurement";

export type DriverFacts = Record<string, FactValue>;

interface RequestSeam {
  requests: EquipmentRequest[];
}

const seams = new WeakMap<JourneyState, RequestSeam>();

function seamFor(state: JourneyState): RequestSeam {
  let seam = seams.get(state);
  if (seam === undefined) {
    seam = { requests: [] };
    seams.set(state, seam);
  }
  return seam;
}

export async function runMarketplaceRequestStep(
  step: MarketplaceRequestStep,
  state: JourneyState,
): Promise<DriverFacts> {
  const seam = seamFor(state);
  switch (step.kind) {
    case "mreq-submit": {
      const result = submitEquipmentRequest(state.tenant, {
        requestId: step.requestId,
        naturalKey: step.naturalKey,
        sku: step.sku,
        quantity: step.quantity,
        requiredBy: step.requiredBy,
        at: step.at,
      }, seam.requests);
      if (!result.ok) {
        logPush(state, "mreq.log", `submit:${step.requestId}:refused:${result.reasonCode}`);
        return {
          [`mreq.submit.${step.factKey}.ok`]: false,
          [`mreq.submit.${step.factKey}.reasonCode`]: result.reasonCode,
          [`mreq.submit.${step.factKey}.duplicate`]: false,
        };
      }
      if (!result.duplicate) seam.requests.push(result.request);
      logPush(
        state,
        "mreq.log",
        `submit:${step.requestId}:${result.duplicate ? "duplicate" : "created"}:${result.request.requestId}:${result.request.status}`,
      );
      return {
        [`mreq.submit.${step.factKey}.ok`]: true,
        [`mreq.submit.${step.factKey}.reasonCode`]: null,
        [`mreq.submit.${step.factKey}.duplicate`]: result.duplicate,
        [`mreq.submit.${step.factKey}.requestId`]: result.request.requestId,
        [`mreq.submit.${step.factKey}.status`]: result.request.status,
        [`mreq.submit.${step.factKey}.eventFrom`]: result.event?.fromStatus ?? null,
        [`mreq.submit.${step.factKey}.eventTo`]: result.event?.toStatus ?? null,
        [`mreq.submit.${step.factKey}.population`]: seam.requests.length,
      };
    }
    case "mreq-transition": {
      const current = seam.requests[seam.requests.length - 1];
      if (current === undefined) {
        return { [`mreq.transition.${step.factKey}.ok`]: false, [`mreq.transition.${step.factKey}.reasonCode`]: "REQUEST_ID_REQUIRED" };
      }
      const command =
        step.command === "select"
          ? { type: "select" as const, at: step.at, offerId: step.offerId ?? "" }
          : step.command === "refuse" || step.command === "cancel" || step.command === "dispute"
            ? { type: step.command, at: step.at, reason: step.reason ?? "" }
            : { type: step.command, at: step.at };
      const result = transitionEquipmentRequest(current, command);
      if (!result.ok) {
        logPush(state, "mreq.log", `transition:${current.requestId}:refused:${result.reasonCode}`);
        return {
          [`mreq.transition.${step.factKey}.ok`]: false,
          [`mreq.transition.${step.factKey}.reasonCode`]: result.reasonCode,
          [`mreq.transition.${step.factKey}.status`]: null,
        };
      }
      seam.requests[seam.requests.length - 1] = result.next;
      logPush(state, "mreq.log", `transition:${current.requestId}:${result.next.status}`);
      return {
        [`mreq.transition.${step.factKey}.ok`]: true,
        [`mreq.transition.${step.factKey}.reasonCode`]: null,
        [`mreq.transition.${step.factKey}.status`]: result.next.status,
        [`mreq.transition.${step.factKey}.selectedOfferId`]: result.next.selectedOfferId,
        [`mreq.transition.${step.factKey}.lastTransitionAt`]: result.next.lastTransitionAt,
      };
    }
    case "mreq-read": {
      const caller = (step.callerTenant ?? "own") === "own" ? state.tenant : OTHER_TENANT;
      const found = findEquipmentRequest(caller, seam.requests, step.requestId);
      logPush(state, "mreq.readLog", `${step.callerTenant ?? "own"}:${step.requestId}:${found?.status ?? "null"}`);
      return {
        [`mreq.read.${step.factKey}.found`]: found !== null,
        [`mreq.read.${step.factKey}.status`]: found?.status ?? null,
      };
    }
    case "mreq-board": {
      const board = buildEquipmentRequestBoard(state.tenant, seam.requests);
      logPush(state, "mreq.boardLog", `total:${board.total}`);
      return {
        [`mreq.board.${step.factKey}.total`]: board.total,
        [`mreq.board.${step.factKey}.submitted`]: board.byStatus.submitted,
        [`mreq.board.${step.factKey}.resolving`]: board.byStatus.resolving,
        [`mreq.board.${step.factKey}.approved`]: board.byStatus.approved,
        [`mreq.board.${step.factKey}.ordered`]: board.byStatus.ordered,
        [`mreq.board.${step.factKey}.fulfilled`]: board.byStatus.fulfilled,
        [`mreq.board.${step.factKey}.requestIds`]: board.requestIds,
      };
    }
  }
}
