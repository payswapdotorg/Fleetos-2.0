/**
 * @fleetos/acceptance-commerce — the marketplace order step drivers
 * (F361C, Wave 17 lane C).
 *
 * Interprets the mord-* typed journey steps against the REAL public
 * entry points of `@fleetos/procurement` marketplace-equipment-order.ts
 * COMPOSED with `@fleetos/work` marketplace-order-work.ts:
 *   - draftEquipmentMarketplaceOrder / transitionEquipmentMarketplaceOrder
 *     — the §3.4 machine (draft → placed → acknowledged → shipped →
 *     received → accepted | discrepancy → disputed | returned; terminal
 *     states refuse ILLEGAL_TRANSITION);
 *   - acknowledgeProviderOrder — THE MANUAL PROVIDER-ACK SEAM: the ack
 *     evidence reference is recorded idempotently (the SAME provider
 *     event replayed returns the acknowledged order with duplicate=true,
 *     the ORIGINAL evidence winning — never a second conclusion); a
 *     DIFFERENT provider event on an acknowledged order REFUSES
 *     ALREADY_ACKNOWLEDGED (duplicate provider events refused, mission
 *     §6); a missing evidence reference or a foreign evidence tenant
 *     refuses with the exact codes;
 *   - the work composition: REAL work items are created through the
 *     REAL in-memory work repository and transitioned through the REAL
 *     WorkItemDirectory; the order→work link and the
 *     service-completion ACCEPT gate run through the REAL
 *     linkMarketplaceOrderWork / serviceWorkAcceptanceGate APIs — the
 *     documented composition site binding BOTH lane packages.
 *
 * The order/link population lives in a WeakMap keyed by JourneyState —
 * a fresh world per run keeps every run pure and deterministic.
 */

import type { FactValue } from "./journey-contracts.js";
import type { MarketplaceOrderAckStep } from "./journey-contracts-f361c.js";
import type { JourneyState } from "./journey-world.js";
import { CLOCK, OTHER_TENANT, logPush } from "./journey-world.js";
import type { MarketplaceEquipmentOrder } from "@fleetos/procurement";
import type { MarketplaceOrderWorkLink, WorkItem as RealWorkItem } from "@fleetos/work";
import {
  draftEquipmentMarketplaceOrder,
  transitionEquipmentMarketplaceOrder,
  acknowledgeProviderOrder,
  findEquipmentMarketplaceOrder,
  buildEquipmentMarketplaceOrderBoard,
  type EquipmentOrderCommand,
} from "@fleetos/procurement";
import {
  linkMarketplaceOrderWork,
  serviceWorkAcceptanceGate,
} from "@fleetos/work";

export type DriverFacts = Record<string, FactValue>;

interface OrderSeam {
  order: MarketplaceEquipmentOrder | null;
  orders: MarketplaceEquipmentOrder[];
  links: MarketplaceOrderWorkLink[];
}

const seams = new WeakMap<JourneyState, OrderSeam>();

function seamFor(state: JourneyState): OrderSeam {
  let seam = seams.get(state);
  if (seam === undefined) {
    seam = { order: null, orders: [], links: [] };
    seams.set(state, seam);
  }
  return seam;
}

function replaceOrder(seam: OrderSeam, next: MarketplaceEquipmentOrder): void {
  seam.order = next;
  const index = seam.orders.findIndex((o) => o.orderId === next.orderId);
  if (index === -1) seam.orders.push(next);
  else seam.orders[index] = next;
}

async function loadWorkItem(state: JourneyState, workItemId: string): Promise<RealWorkItem | null> {
  return state.work.repo.load(state.tenant, { kind: "work-item", value: workItemId });
}

export async function runMarketplaceOrderStep(
  step: MarketplaceOrderAckStep,
  state: JourneyState,
): Promise<DriverFacts> {
  const seam = seamFor(state);
  switch (step.kind) {
    case "mord-draft": {
      const result = draftEquipmentMarketplaceOrder(state.tenant, {
        orderId: step.orderId,
        requestId: step.requestId,
        offerId: step.offerId,
        supplierId: step.supplierId,
        sku: step.sku,
        quantity: step.quantity,
        unitCostMinor: step.unitCostMinor,
        totalCostMinor: step.totalCostMinor,
        currency: step.currency,
      });
      if (!result.ok) {
        logPush(state, "mord.log", `draft:${step.orderId}:refused:${result.reasonCode}`);
        return { [`mord.draft.${step.factKey}.ok`]: false, [`mord.draft.${step.factKey}.reasonCode`]: result.reasonCode };
      }
      replaceOrder(seam, result.order);
      logPush(state, "mord.log", `draft:${step.orderId}:draft`);
      return {
        [`mord.draft.${step.factKey}.ok`]: true,
        [`mord.draft.${step.factKey}.reasonCode`]: null,
        [`mord.draft.${step.factKey}.status`]: result.order.status,
        [`mord.draft.${step.factKey}.requestId`]: result.order.requestId,
        [`mord.draft.${step.factKey}.offerId`]: result.order.offerId,
        [`mord.draft.${step.factKey}.totalCostMinor`]: result.order.totalCostMinor,
      };
    }
    case "mord-place": {
      const current = seam.order;
      if (current === null) {
        return { [`mord.place.${step.factKey}.ok`]: false, [`mord.place.${step.factKey}.reasonCode`]: "ORDER_ID_REQUIRED" };
      }
      const result = transitionEquipmentMarketplaceOrder(current, { type: "place", at: step.at });
      if (!result.ok) {
        logPush(state, "mord.log", `place:${current.orderId}:refused:${result.reasonCode}`);
        return { [`mord.place.${step.factKey}.ok`]: false, [`mord.place.${step.factKey}.reasonCode`]: result.reasonCode };
      }
      replaceOrder(seam, result.order);
      logPush(state, "mord.log", `place:${current.orderId}:placed`);
      return {
        [`mord.place.${step.factKey}.ok`]: true,
        [`mord.place.${step.factKey}.reasonCode`]: null,
        [`mord.place.${step.factKey}.status`]: result.order.status,
        [`mord.place.${step.factKey}.placedAt`]: result.order.placedAt,
        [`mord.place.${step.factKey}.acknowledgement`]: result.order.acknowledgement === null,
      };
    }
    case "mord-ack": {
      const current = seam.order;
      if (current === null) {
        return { [`mord.ack.${step.factKey}.ok`]: false, [`mord.ack.${step.factKey}.reasonCode`]: "ORDER_ID_REQUIRED" };
      }
      const result = acknowledgeProviderOrder(current, {
        providerEventId: step.providerEventId,
        evidence: { evidenceId: step.evidenceId, tenantId: step.evidenceTenantId },
        channel: step.channel,
        acknowledgedAt: step.acknowledgedAt,
      });
      if (!result.ok) {
        logPush(state, "mord.log", `ack:${step.providerEventId}:refused:${result.reasonCode}`);
        return {
          [`mord.ack.${step.factKey}.ok`]: false,
          [`mord.ack.${step.factKey}.reasonCode`]: result.reasonCode,
          [`mord.ack.${step.factKey}.duplicate`]: false,
        };
      }
      replaceOrder(seam, result.order);
      logPush(
        state,
        "mord.log",
        `ack:${step.providerEventId}:${result.duplicate ? "duplicate" : "acknowledged"}:${result.order.acknowledgement?.evidence.evidenceId ?? "-"}`,
      );
      return {
        [`mord.ack.${step.factKey}.ok`]: true,
        [`mord.ack.${step.factKey}.reasonCode`]: null,
        [`mord.ack.${step.factKey}.duplicate`]: result.duplicate,
        [`mord.ack.${step.factKey}.status`]: result.order.status,
        [`mord.ack.${step.factKey}.providerEventId`]: result.order.acknowledgement?.providerEventId ?? null,
        [`mord.ack.${step.factKey}.evidenceId`]: result.order.acknowledgement?.evidence.evidenceId ?? null,
        [`mord.ack.${step.factKey}.channel`]: result.order.acknowledgement?.channel ?? null,
        [`mord.ack.${step.factKey}.acknowledgedAt`]: result.order.acknowledgement?.acknowledgedAt ?? null,
      };
    }
    case "mord-transition": {
      const current = seam.order;
      if (current === null) {
        return { [`mord.transition.${step.factKey}.ok`]: false, [`mord.transition.${step.factKey}.reasonCode`]: "ORDER_ID_REQUIRED" };
      }
      const command: EquipmentOrderCommand =
        step.command === "ship" || step.command === "receive" || step.command === "accept"
          ? { type: step.command, at: step.at }
          : { type: step.command, at: step.at, reason: step.reason ?? "" };
      const result = transitionEquipmentMarketplaceOrder(current, command);
      if (!result.ok) {
        logPush(state, "mord.log", `transition:${step.command}:refused:${result.reasonCode}`);
        return {
          [`mord.transition.${step.factKey}.ok`]: false,
          [`mord.transition.${step.factKey}.reasonCode`]: result.reasonCode,
          [`mord.transition.${step.factKey}.status`]: null,
        };
      }
      replaceOrder(seam, result.order);
      logPush(state, "mord.log", `transition:${step.command}:${result.order.status}`);
      return {
        [`mord.transition.${step.factKey}.ok`]: true,
        [`mord.transition.${step.factKey}.reasonCode`]: null,
        [`mord.transition.${step.factKey}.status`]: result.order.status,
        [`mord.transition.${step.factKey}.receivedAt`]: result.order.receivedAt,
      };
    }
    case "mord-read": {
      const current = seam.order;
      if (current === null) {
        return { [`mord.read.${step.factKey}.found`]: false, [`mord.read.${step.factKey}.status`]: null };
      }
      const caller = (step.callerTenant ?? "own") === "own" ? state.tenant : OTHER_TENANT;
      const found = findEquipmentMarketplaceOrder(caller, seam.orders, current.orderId);
      logPush(state, "mord.readLog", `${step.callerTenant ?? "own"}:${current.orderId}:${found?.status ?? "null"}`);
      return {
        [`mord.read.${step.factKey}.found`]: found !== null,
        [`mord.read.${step.factKey}.status`]: found?.status ?? null,
        [`mord.read.${step.factKey}.acknowledged`]: found?.acknowledgement !== null,
      };
    }
    case "mord-board": {
      const board = buildEquipmentMarketplaceOrderBoard(state.tenant, seam.orders);
      logPush(state, "mord.boardLog", `total:${board.total}:ackPending:${board.ackPendingOrderIds.join(",") || "-"}`);
      return {
        [`mord.board.${step.factKey}.total`]: board.total,
        [`mord.board.${step.factKey}.placed`]: board.byStatus.placed,
        [`mord.board.${step.factKey}.acknowledged`]: board.byStatus.acknowledged,
        [`mord.board.${step.factKey}.accepted`]: board.byStatus.accepted,
        [`mord.board.${step.factKey}.ackPendingOrderIds`]: board.ackPendingOrderIds,
      };
    }
    case "mord-work-create": {
      const item: RealWorkItem = {
        id: { kind: "work-item", value: step.workItemId },
        tenant: state.tenant,
        title: step.title,
        assignee: null,
        assignmentHistory: [],
        deadline: null,
        status: "todo",
        blockedReason: null,
        missionRef: null,
        workflowRef: null,
        projectId: null,
      };
      await state.work.repo.store(state.tenant, item);
      logPush(state, "mord.log", `work-create:${step.workItemId}:todo`);
      return { [`mord.workCreate.${step.factKey}.ok`]: true, [`mord.workCreate.${step.factKey}.status`]: "todo" };
    }
    case "mord-work-assign": {
      const result = await state.work.directory.assign(
        state.tenant,
        { kind: "work-item", value: step.workItemId },
        step.assignmentId,
        step.assigneeId,
        CLOCK.iso1,
        { occurredAt: CLOCK.iso1 },
      );
      if (!result.ok) {
        logPush(state, "mord.log", `work-assign:${step.workItemId}:refused:${result.reasonCode}`);
        return { [`mord.workAssign.${step.factKey}.ok`]: false, [`mord.workAssign.${step.factKey}.reasonCode`]: result.reasonCode };
      }
      logPush(state, "mord.log", `work-assign:${step.workItemId}:${step.assigneeId}`);
      return { [`mord.workAssign.${step.factKey}.ok`]: true, [`mord.workAssign.${step.factKey}.reasonCode`]: null };
    }
    case "mord-work-transition": {
      const command =
        step.command === "start"
          ? { type: "start" as const }
          : { type: "complete" as const };
      const result = await state.work.directory.transition(
        state.tenant,
        { kind: "work-item", value: step.workItemId },
        command,
        { occurredAt: CLOCK.iso2 },
      );
      if (!result.ok) {
        logPush(state, "mord.log", `work:${step.command}:${step.workItemId}:refused:${result.reasonCode}`);
        return {
          [`mord.workTransition.${step.factKey}.ok`]: false,
          [`mord.workTransition.${step.factKey}.reasonCode`]: result.reasonCode,
          [`mord.workTransition.${step.factKey}.status`]: null,
        };
      }
      const workItem = await loadWorkItem(state, step.workItemId);
      logPush(state, "mord.log", `work:${step.command}:${step.workItemId}:${workItem?.status ?? "?"}`);
      return {
        [`mord.workTransition.${step.factKey}.ok`]: true,
        [`mord.workTransition.${step.factKey}.reasonCode`]: null,
        [`mord.workTransition.${step.factKey}.status`]: workItem?.status ?? null,
      };
    }
    case "mord-work-link": {
      const current = seam.order;
      const workItem = await loadWorkItem(state, step.workItemId);
      if (current === null || workItem === null) {
        return { [`mord.workLink.${step.factKey}.ok`]: false, [`mord.workLink.${step.factKey}.reasonCode`]: "ORDER_ID_REQUIRED" };
      }
      const result = linkMarketplaceOrderWork(
        state.tenant,
        { orderId: current.orderId, workItemId: step.workItemId, kind: step.linkKind, at: step.at },
        workItem,
        seam.links,
      );
      if (!result.ok) {
        logPush(state, "mord.log", `work-link:${current.orderId}:refused:${result.reasonCode}`);
        return { [`mord.workLink.${step.factKey}.ok`]: false, [`mord.workLink.${step.factKey}.reasonCode`]: result.reasonCode };
      }
      seam.links.push(result.link);
      logPush(state, "mord.log", `work-link:${current.orderId}:${step.workItemId}:${step.linkKind}`);
      return {
        [`mord.workLink.${step.factKey}.ok`]: true,
        [`mord.workLink.${step.factKey}.reasonCode`]: null,
        [`mord.workLink.${step.factKey}.status`]: result.link.status,
        [`mord.workLink.${step.factKey}.kind`]: result.link.kind,
      };
    }
    case "mord-work-gate": {
      const current = seam.order;
      const link = seam.links.find((l) => l.status === "linked");
      if (current === null || link === undefined) {
        return { [`mord.workGate.${step.factKey}.ok`]: false, [`mord.workGate.${step.factKey}.reasonCode`]: "WORK_LINK_NOT_LIVE" };
      }
      const workItem = await loadWorkItem(state, link.workItemId);
      if (workItem === null) {
        return { [`mord.workGate.${step.factKey}.ok`]: false, [`mord.workGate.${step.factKey}.reasonCode`]: "WORK_LINK_NOT_LIVE" };
      }
      const result = serviceWorkAcceptanceGate(link, workItem);
      if (!result.ok) {
        logPush(state, "mord.log", `work-gate:${current.orderId}:refused:${result.reasonCode}`);
        return {
          [`mord.workGate.${step.factKey}.ok`]: false,
          [`mord.workGate.${step.factKey}.reasonCode`]: result.reasonCode,
        };
      }
      logPush(state, "mord.log", `work-gate:${current.orderId}:open:${result.workItemId}`);
      return {
        [`mord.workGate.${step.factKey}.ok`]: true,
        [`mord.workGate.${step.factKey}.reasonCode`]: null,
        [`mord.workGate.${step.factKey}.workItemId`]: result.workItemId,
      };
    }
    case "mord-accept": {
      const current = seam.order;
      if (current === null) {
        return { [`mord.accept.${step.factKey}.ok`]: false, [`mord.accept.${step.factKey}.reasonCode`]: "ORDER_ID_REQUIRED" };
      }
      if (step.requireWorkGate) {
        const link = seam.links.find((l) => l.status === "linked");
        const workItem = link === undefined ? null : await loadWorkItem(state, link.workItemId);
        if (link === undefined || workItem === null) {
          logPush(state, "mord.log", `accept:${current.orderId}:refused:WORK_LINK_NOT_LIVE`);
          return {
            [`mord.accept.${step.factKey}.ok`]: false,
            [`mord.accept.${step.factKey}.reasonCode`]: "WORK_LINK_NOT_LIVE",
            [`mord.accept.${step.factKey}.gateChecked`]: true,
          };
        }
        const gate = serviceWorkAcceptanceGate(link, workItem);
        if (!gate.ok) {
          logPush(state, "mord.log", `accept:${current.orderId}:refused:${gate.reasonCode}`);
          return {
            [`mord.accept.${step.factKey}.ok`]: false,
            [`mord.accept.${step.factKey}.reasonCode`]: gate.reasonCode,
            [`mord.accept.${step.factKey}.gateChecked`]: true,
          };
        }
      }
      const result = transitionEquipmentMarketplaceOrder(current, { type: "accept", at: step.at });
      if (!result.ok) {
        logPush(state, "mord.log", `accept:${current.orderId}:refused:${result.reasonCode}`);
        return {
          [`mord.accept.${step.factKey}.ok`]: false,
          [`mord.accept.${step.factKey}.reasonCode`]: result.reasonCode,
          [`mord.accept.${step.factKey}.gateChecked`]: step.requireWorkGate,
        };
      }
      replaceOrder(seam, result.order);
      logPush(state, "mord.log", `accept:${current.orderId}:accepted`);
      return {
        [`mord.accept.${step.factKey}.ok`]: true,
        [`mord.accept.${step.factKey}.reasonCode`]: null,
        [`mord.accept.${step.factKey}.gateChecked`]: step.requireWorkGate,
        [`mord.accept.${step.factKey}.status`]: result.order.status,
        [`mord.accept.${step.factKey}.acceptedAt`]: result.order.acceptedAt,
      };
    }
  }
}
