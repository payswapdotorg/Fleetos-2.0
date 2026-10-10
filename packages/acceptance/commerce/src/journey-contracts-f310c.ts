/**
 * @fleetos/acceptance-commerce — F310C step contracts (Wave 11 lane C).
 *
 * The three step-kind families the F310C corpus extension added:
 *   - LifecycleStep — assignment supersession, the deadline escalation
 *     surface, the project DIRECTORY (completion gate + hold/resume +
 *     portfolio), and workload rebalance PROPOSALS;
 *   - FinanceStep — vendor SLA contract math, batched reconciliation at
 *     volume, exact-sum cost allocation, software renewal windows;
 *   - ResilienceStep — model-gateway provider fallback ladders +
 *     degraded-mode classification, and capability-budget rebalance
 *     proposals.
 *
 * Split from journey-contracts.ts to hold the file law (≤ 400 lines).
 * Pure data contracts — the runner interprets them through the
 * drivers-lifecycle/-finance/-resilience modules.
 */

import type { JourneyStepBase } from "./journey-contracts.js";

// ---------------------------------------------------------------------------
// Lifecycle steps (F310C, Wave 11 lane C).
// ---------------------------------------------------------------------------

export type LifecycleStep =
  | (JourneyStepBase & {
      readonly kind: "work-reassign";
      /** Facts namespace (each step's facts are independently assertable). */
      readonly factKey: string;
      readonly itemId: string;
      readonly newAssignmentId: string;
      readonly newAssigneeId: string;
    })
  | (JourneyStepBase & {
      readonly kind: "work-remove-assignee";
      readonly factKey: string;
      readonly itemId: string;
    })
  | (JourneyStepBase & {
      readonly kind: "work-integrity-holds";
      readonly factKey: string;
      readonly itemId: string;
    })
  | (JourneyStepBase & {
      readonly kind: "work-deadline";
      readonly factKey: string;
      readonly itemId: string;
      readonly mode: "evaluate" | "met";
      readonly now: string;
      readonly approachingWindowMillis: number;
    })
  | (JourneyStepBase & {
      readonly kind: "project-directory-seed";
      readonly projects: readonly {
        readonly projectId: string;
        readonly name: string;
        readonly milestones: readonly { readonly milestoneId: string; readonly name: string; readonly workItemIds: readonly string[] }[];
      }[];
    })
  | (JourneyStepBase & {
      readonly kind: "project-directory-transition";
      readonly factKey: string;
      readonly projectId: string;
      readonly command: "activate" | "hold" | "resume" | "cancel";
      readonly reason?: string;
    })
  | (JourneyStepBase & {
      readonly kind: "project-milestone-verify";
      readonly factKey: string;
      readonly milestoneId: string;
      /** true = compose refs from the REAL work directory state. */
      readonly realWorkItems: boolean;
    })
  | (JourneyStepBase & {
      readonly kind: "project-complete";
      readonly factKey: string;
      readonly projectId: string;
      readonly realWorkItems: boolean;
    })
  | (JourneyStepBase & { readonly kind: "project-portfolio" })
  | (JourneyStepBase & {
      readonly kind: "workload-rebalance";
      readonly factKey: string;
      readonly capacities: readonly { readonly owner: string; readonly maxUnits: number }[];
      readonly allocations: readonly { readonly owner: string; readonly allocatedUnits: number }[];
      readonly generatedAt: string;
    });

// ---------------------------------------------------------------------------
// Finance steps (F310C).
// ---------------------------------------------------------------------------

export type FinanceStep =
  | (JourneyStepBase & {
      readonly kind: "vendor-sla-evaluate";
      readonly factKey: string;
      readonly bands: readonly { readonly bandId: string; readonly maxLatenessMs: number; readonly penaltyBps: number }[];
      readonly availabilityTargetBps: number;
      readonly creditCapBps: number;
      readonly outcomes: readonly {
        readonly orderId: string;
        readonly promisedAt: number;
        readonly deliveredAt: number;
        readonly quantityOrdered: number;
        readonly quantityReceived: number;
        readonly foreignTenant?: boolean;
      }[];
    })
  | (JourneyStepBase & { readonly kind: "vendor-sla-scorecard" })
  | (JourneyStepBase & {
      readonly kind: "vendor-sla-credit";
      readonly factKey: string;
      readonly orderedQuantity: number;
      readonly unitCostMinor: number;
      readonly foreignTenant?: boolean;
    })
  | (JourneyStepBase & {
      readonly kind: "order-reconcile-batch";
      readonly factKey: string;
      readonly batchSize: number;
      readonly orders: readonly { readonly orderId: string; readonly orderedQuantity: number; readonly unitCostMinor: number; readonly foreignTenant?: boolean }[];
      readonly receipts: readonly { readonly orderId: string; readonly receivedQuantity: number }[];
    })
  | (JourneyStepBase & {
      readonly kind: "cost-allocate";
      readonly factKey: string;
      readonly orderId: string;
      readonly totalMinorUnits: number;
      readonly shares: readonly { readonly workOrderId: string; readonly shareBps: number }[];
    })
  | (JourneyStepBase & {
      readonly kind: "cost-allocate-partial";
      readonly factKey: string;
      readonly orderId: string;
      readonly totalMinorUnits: number;
      readonly partials: readonly { readonly fulfillmentId: string; readonly quantity: number }[];
    })
  | (JourneyStepBase & {
      readonly kind: "cost-alloc-verify";
      readonly factKey: string;
      readonly orderId: string;
      readonly totalMinorUnits: number;
      readonly rows: readonly { readonly fulfillmentId: string; readonly amountMinorUnits: number }[];
    })
  | (JourneyStepBase & {
      readonly kind: "software-renewal-sweep";
      readonly factKey: string;
      readonly graceMs: number;
      readonly now: number;
      readonly subscriptions: readonly {
        readonly subscriptionId: string;
        readonly status: "active" | "expired" | "cancelled";
        readonly validUntil: string | null;
        readonly foreignTenant?: boolean;
      }[];
    })
  | (JourneyStepBase & {
      readonly kind: "software-seat-projection";
      readonly factKey: string;
      readonly planned: readonly { readonly requestId: string; readonly seats: number; readonly assumption: string }[];
    });

// ---------------------------------------------------------------------------
// Resilience steps (F310C).
// ---------------------------------------------------------------------------

export type ResilienceStep =
  | (JourneyStepBase & {
      readonly kind: "gw-fallback-ladder";
      readonly factKey: string;
      readonly providers: readonly { readonly id: string; readonly declaredModels: readonly string[]; readonly health: "healthy" | "degraded" | "down" }[];
      readonly chainOrder: readonly string[];
      readonly modelId: string;
    })
  | (JourneyStepBase & {
      readonly kind: "gw-degraded-mode";
      readonly factKey: string;
      readonly providers: readonly { readonly id: string; readonly declaredModels: readonly string[]; readonly health: "healthy" | "degraded" | "down" }[];
    })
  | (JourneyStepBase & {
      readonly kind: "org-budgets-seed";
      readonly budgets: readonly {
        readonly id: string;
        readonly scopeKind: "role" | "agent";
        readonly refId: string;
        readonly capability: string;
        readonly allocatedUnits: number;
        readonly allocatedSpendMinor: number;
        readonly consumedUnits: number;
        readonly consumedSpendMinor: number;
      }[];
    })
  | (JourneyStepBase & {
      readonly kind: "org-budget-rebalance";
      readonly factKey: string;
    });
