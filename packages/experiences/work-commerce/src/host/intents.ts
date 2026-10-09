/**
 * @fleetos/experience-work-commerce — the host intent catalog (F300C).
 *
 * Maps UI events to the lane's EXISTING inert CommandDraft builders
 * (command-intents.ts): work.create-work-order / procurement.approve-quote
 * / procurement.place-order / org.allocate-budget. The catalog is DATA;
 * drafts stay inert frozen records — binding them to the control-plane
 * CommandQueue.submit is TL composition work (WAVE10-HOST-CONTRACT §2/§3).
 *
 * ROLE LENSES (fail-closed presentation): `offeredTo` decides which role
 * lenses the UI offers an intent to. A role NOT in the list is REFUSED
 * at the seam (`intent-not-offered-to-role`) — the UI never renders the
 * affordance. This is PRESENTATION gating only: authorization is always
 * the control plane + Guardian's (the draft's requiredCapability is a
 * REQUEST, never an authorization).
 *
 * Determinism: pure data + pure helpers; no clock, no randomness.
 */

import type { CommandDraft, CommandDraftResult } from "../command-intents.js";
import {
  draftCreateWorkOrder,
  draftApproveQuote,
  draftPlaceOrder,
  draftAllocateBudget,
} from "../command-intents.js";
import type { HostIntentCatalog, HostIntentSpec, HostSurfaceRole } from "./contract.js";
import { ORG_BUDGETS_ROUTE_ID, PROCUREMENT_SPINE_ROUTE_ID, WORK_BOARD_ROUTE_ID, routeById } from "./routes.js";

export const WORK_COMMERCE_INTENTS: HostIntentCatalog = [
  {
    intentId: "work-commerce.create-work-order",
    event: "work-board:create-work-order",
    builderId: "work.create-work-order",
    routeId: WORK_BOARD_ROUTE_ID,
    title: "Create work order",
    description: "Draft a new work order on the tenant's work board (optionally on a project, with an assignee).",
    capabilityRequest: "work.order.create",
    offeredTo: ["operations-manager", "project-manager"],
  },
  {
    intentId: "work-commerce.approve-quote",
    event: "procurement-spine:approve-quote",
    builderId: "procurement.approve-quote",
    routeId: PROCUREMENT_SPINE_ROUTE_ID,
    title: "Approve quote",
    description: "Draft the approval of a submitted quote on the procurement spine.",
    capabilityRequest: "procurement.quote.approve",
    offeredTo: ["procurement-lead", "finance-controller"],
  },
  {
    intentId: "work-commerce.place-order",
    event: "procurement-spine:place-order",
    builderId: "procurement.place-order",
    routeId: PROCUREMENT_SPINE_ROUTE_ID,
    title: "Place order",
    description: "Draft placing the order for an approved quote with a vendor.",
    capabilityRequest: "procurement.order.place",
    offeredTo: ["procurement-lead"],
  },
  {
    intentId: "work-commerce.allocate-budget",
    event: "org-budgets:allocate-budget",
    builderId: "org.allocate-budget",
    routeId: ORG_BUDGETS_ROUTE_ID,
    title: "Allocate budget",
    description: "Draft an additional allocation against a capability budget (a ceiling change request).",
    capabilityRequest: "org.budget.allocate",
    offeredTo: ["org-optimizer", "finance-controller"],
  },
];

/** Deterministic event lookup (first match; events are unique by law). */
export function intentForEvent(event: string): HostIntentSpec | null {
  return WORK_COMMERCE_INTENTS.find((i) => i.event === event) ?? null;
}

/** Intents offered from a route, in catalog order. */
export function intentsForRoute(routeId: string): HostIntentCatalog {
  return WORK_COMMERCE_INTENTS.filter((i) => i.routeId === routeId);
}

/** Intents offered to a role lens, in catalog order. */
export function intentsOfferedTo(role: string): HostIntentCatalog {
  return WORK_COMMERCE_INTENTS.filter((i) => i.offeredTo.includes(role as HostSurfaceRole));
}

/** The presentation gate: is this event's intent offered to this role? */
export function isIntentOfferedToRole(event: string, role: string): boolean {
  const spec = intentForEvent(event);
  return spec !== null && spec.offeredTo.includes(role as HostSurfaceRole);
}

/**
 * Machine-check catalog integrity: unique intent ids + events, known
 * builder ids, declared routes, non-empty offeredTo, role vocabulary
 * membership. Empty = valid.
 */
export function verifyIntentCatalog(): readonly string[] {
  const problems: string[] = [];
  const intentIds = new Set<string>();
  const events = new Set<string>();
  const builders = new Set<string>([
    "work.create-work-order",
    "procurement.approve-quote",
    "procurement.place-order",
    "org.allocate-budget",
  ]);
  const roles = new Set<string>([
    "operations-manager",
    "procurement-lead",
    "project-manager",
    "vendor-manager",
    "software-admin",
    "org-optimizer",
    "finance-controller",
  ]);
  for (const intent of WORK_COMMERCE_INTENTS) {
    if (intentIds.has(intent.intentId)) problems.push(`duplicate intent id ${intent.intentId}`);
    intentIds.add(intent.intentId);
    if (events.has(intent.event)) problems.push(`duplicate intent event ${intent.event}`);
    events.add(intent.event);
    if (!builders.has(intent.builderId)) {
      problems.push(`intent ${intent.intentId} names unknown builder ${intent.builderId}`);
    }
    if (routeById(intent.routeId) === null) {
      problems.push(`intent ${intent.intentId} names undeclared route ${intent.routeId}`);
    }
    if (intent.offeredTo.length === 0) {
      problems.push(`intent ${intent.intentId} is offered to no role`);
    }
    for (const role of intent.offeredTo) {
      if (!roles.has(role)) problems.push(`intent ${intent.intentId} offers to unknown role ${role}`);
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Draft building — UI event -> the EXISTING inert CommandDraft builder.
// ---------------------------------------------------------------------------

/** The caller-supplied draft input (logical time only — never a clock). */
export interface HostIntentInput {
  readonly tenantId: string;
  readonly issuedAt: number;
  readonly reason: string;
  readonly notBefore?: number;
  // Builder-specific fields (validated by the builders themselves):
  readonly title?: string;
  readonly projectId?: string;
  readonly assigneeId?: string;
  readonly quoteId?: string;
  readonly demandId?: string;
  readonly vendorId?: string;
  readonly totalCostMinor?: number;
  readonly budgetId?: string;
  readonly additionalUnits?: number;
  readonly additionalSpendMinor?: number;
}

export type HostIntentRejection =
  | "unknown-intent-event"
  | "missing-intent-input"
  | "intent-not-offered-to-role"
  | "builder-refused";

export type HostIntentBuildResult =
  | { readonly ok: true; readonly draft: CommandDraft; readonly intent: HostIntentSpec }
  | { readonly ok: false; readonly rejected: HostIntentRejection; readonly detail: string };

function missingField(field: string): HostIntentBuildResult {
  return {
    ok: false,
    rejected: "missing-intent-input",
    detail: `intent input is missing required field ${field}`,
  };
}

/**
 * Build the inert CommandDraft for a UI event, optionally gated by the
 * presentation role lens (fail-closed: a role not offered the intent is
 * refused BEFORE any draft is built). The draft remains inert: it never
 * executes here; the TL binds it to the control plane.
 */
export function buildIntentForEvent(
  event: string,
  input: HostIntentInput,
  role?: string,
): HostIntentBuildResult {
  const spec = intentForEvent(event);
  if (spec === null) {
    return {
      ok: false,
      rejected: "unknown-intent-event",
      detail: `no catalog intent binds UI event ${event}`,
    };
  }
  if (role !== undefined && !isIntentOfferedToRole(event, role)) {
    return {
      ok: false,
      rejected: "intent-not-offered-to-role",
      detail: `intent ${spec.intentId} is not offered to role ${role}`,
    };
  }
  const tenant = { tenantId: input.tenantId };
  // Subject-identity idempotency (the F300A convention): the key derives
  // from WHAT is acted on, not when — re-drafting the same subject is the
  // same command at the queue (dedupe), a different subject is not.
  const subjectKey =
    spec.builderId === "work.create-work-order"
      ? String(input.title)
      : spec.builderId === "org.allocate-budget"
        ? `${input.budgetId}:${input.additionalUnits}:${input.additionalSpendMinor}`
        : String(input.quoteId);
  const idempotencyKey = `host:${spec.builderId}:${subjectKey}`;
  let result: CommandDraftResult;
  switch (spec.builderId) {
    case "work.create-work-order":
      if (input.title === undefined) return missingField("title");
      result = draftCreateWorkOrder({
        tenant,
        idempotencyKey,
        issuedAt: input.issuedAt,
        ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
        ...(input.assigneeId === undefined ? {} : { assigneeId: input.assigneeId }),
        title: input.title,
        ...(input.notBefore === undefined ? {} : { notBefore: input.notBefore }),
        reason: input.reason,
      });
      break;
    case "procurement.approve-quote":
      if (input.quoteId === undefined) return missingField("quoteId");
      result = draftApproveQuote({
        tenant,
        idempotencyKey,
        issuedAt: input.issuedAt,
        quoteId: input.quoteId,
        ...(input.demandId === undefined ? {} : { demandId: input.demandId }),
        ...(input.notBefore === undefined ? {} : { notBefore: input.notBefore }),
        reason: input.reason,
      });
      break;
    case "procurement.place-order":
      if (input.quoteId === undefined) return missingField("quoteId");
      result = draftPlaceOrder({
        tenant,
        idempotencyKey,
        issuedAt: input.issuedAt,
        quoteId: input.quoteId,
        ...(input.vendorId === undefined ? {} : { vendorId: input.vendorId }),
        ...(input.totalCostMinor === undefined ? {} : { totalCostMinor: input.totalCostMinor }),
        ...(input.notBefore === undefined ? {} : { notBefore: input.notBefore }),
        reason: input.reason,
      });
      break;
    case "org.allocate-budget":
      if (input.budgetId === undefined) return missingField("budgetId");
      if (input.additionalUnits === undefined) return missingField("additionalUnits");
      if (input.additionalSpendMinor === undefined) return missingField("additionalSpendMinor");
      result = draftAllocateBudget({
        tenant,
        idempotencyKey,
        issuedAt: input.issuedAt,
        budgetId: input.budgetId,
        additionalUnits: input.additionalUnits,
        additionalSpendMinor: input.additionalSpendMinor,
        ...(input.notBefore === undefined ? {} : { notBefore: input.notBefore }),
        reason: input.reason,
      });
      break;
    default:
      // Unreachable while verifyIntentCatalog() is empty (machine-tested);
      // kept fail-closed for widened runtime values.
      return {
        ok: false,
        rejected: "missing-intent-input",
        detail: `no builder dispatch for ${spec.builderId}`,
      };
  }
  if (!result.ok) {
    return { ok: false, rejected: "builder-refused", detail: `${result.reasonCode}: ${result.detail}` };
  }
  return { ok: true, draft: result.draft, intent: spec };
}
