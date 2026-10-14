/**
 * @fleetos/acceptance-commerce — procurement-directory + vendor-matching
 * step drivers (F351C, Wave 15 lane C).
 *
 * Interprets typed journey steps against the REAL public entry points of
 * `@fleetos/procurement` directory.ts: the ProcurementDirectory over the
 * REAL in-memory ProcurementRepositoryPort — quote transitions with
 * append-only audit events (FNV-1a digests, fromStatus/toStatus), order
 * creation behind the accepted-quote gate and the law-A5 Guardian
 * authorization (AUTHORIZATION_DENIED / ILLEGAL_TRANSITION refusals),
 * order persistence with the procurement.order-created audit carrying the
 * authorization decision id, and the deterministic matching engine
 * (matchVendors: score composition 0.6 coverage / 0.3 service / 0.1 cost,
 * matched tags, RECORDED tie-break rules, tenant fail-closed — foreign
 * vendors and zero-match vendors never enter the match set; a foreign
 * demand refuses TENANT_MISMATCH).
 *
 * Cross-tenant reads through the repository return NOTHING (fail-closed
 * null), never another tenant's record. The per-journey directory seam
 * (one repository + one directory bound to it) lives in a WeakMap keyed
 * by JourneyState — a fresh world per run keeps every run pure and
 * deterministic. Refusals are honest facts carrying the domain reason
 * codes.
 */

import type { FactValue } from "./journey-contracts.js";
import type { ProcurementDirectoryStep, VendorMatchingStep, PdirQuoteSeed } from "./journey-contracts-f351c.js";
import type { JourneyState } from "./journey-world.js";
import { CLOCK, OTHER_TENANT, logPush } from "./journey-world.js";
import type { Quote, ProcurementDemand } from "@fleetos/procurement";
import { createInMemoryProcurementRepository, createProcurementDirectory } from "@fleetos/procurement";

export type DriverFacts = Record<string, FactValue>;

interface DirectorySeam {
  readonly directory: ReturnType<typeof createProcurementDirectory>;
}

const seams = new WeakMap<JourneyState, DirectorySeam>();

function seamFor(state: JourneyState, quotes?: readonly PdirQuoteSeed[]): DirectorySeam {
  let seam = seams.get(state);
  if (seam === undefined || quotes !== undefined) {
    const seeded: Quote[] = (quotes ?? []).map((q) => ({
      id: { kind: "quote", value: q.quoteId },
      tenant: (q.tenant ?? "own") === "own" ? state.tenant : OTHER_TENANT,
      demandId: { kind: "procurement-demand", value: "demand-f351c" },
      vendorId: q.vendorId,
      unitCost: q.unitCost,
      totalCost: q.totalCost,
      status: "draft",
      submittedAt: null,
      expiresAt: null,
      supersedes: null,
      superseded: false,
    }));
    const repo = createInMemoryProcurementRepository(seeded);
    seam = { directory: createProcurementDirectory(repo) };
    seams.set(state, seam);
  }
  return seam;
}

const qid = (value: string) => ({ kind: "quote" as const, value });
const oid = (value: string) => ({ kind: "order" as const, value });

export async function runProcurementDirectoryStep(
  step: ProcurementDirectoryStep,
  state: JourneyState,
): Promise<DriverFacts> {
  switch (step.kind) {
    case "pdir-quote-seed": {
      seamFor(state, step.quotes);
      logPush(state, "pdir.seedLog", step.quotes.map((q) => `${q.quoteId}:${q.vendorId}:${q.tenant ?? "own"}`).join("|"));
      return {
        [`pdir.seed.${step.factKey}.count`]: step.quotes.length,
        [`pdir.seed.${step.factKey}.foreignCount`]: step.quotes.filter((q) => q.tenant === "foreign").length,
      };
    }
    case "pdir-quote-transition": {
      const { directory } = seamFor(state);
      const command =
        step.command === "submit"
          ? { type: "submit" as const, submittedAt: CLOCK.iso1, expiresAt: CLOCK.later }
          : { type: step.command };
      const result = await directory.transitionQuote(state.tenant, qid(step.quoteId), command, {
        occurredAt: CLOCK.iso2,
      });
      if (!result.ok) {
        logPush(state, "pdir.quoteLog", `${step.quoteId}:refused:${result.reasonCode}`);
        return {
          [`pdir.quote.${step.factKey}.ok`]: false,
          [`pdir.quote.${step.factKey}.reasonCode`]: result.reasonCode,
          [`pdir.quote.${step.factKey}.status`]: null,
        };
      }
      const audit = result.auditEvents[0];
      logPush(state, "pdir.quoteLog", `${step.quoteId}:${result.quote?.status ?? "?"}`);
      return {
        [`pdir.quote.${step.factKey}.ok`]: true,
        [`pdir.quote.${step.factKey}.reasonCode`]: null,
        [`pdir.quote.${step.factKey}.status`]: result.quote?.status ?? null,
        [`pdir.quote.${step.factKey}.auditKind`]: audit?.kind ?? null,
        [`pdir.quote.${step.factKey}.auditFromStatus`]: audit?.fromStatus ?? null,
        [`pdir.quote.${step.factKey}.auditToStatus`]: audit?.toStatus ?? null,
        [`pdir.quote.${step.factKey}.auditDigest`]: audit?.digest ?? null,
      };
    }
    case "pdir-order-create": {
      const { directory } = seamFor(state);
      const result = await directory.createOrder(
        state.tenant,
        oid(step.orderId),
        qid(step.quoteId),
        step.authorization,
        { occurredAt: CLOCK.iso3 },
      );
      if (!result.ok) {
        logPush(state, "pdir.orderLog", `${step.orderId}:refused:${result.reasonCode}`);
        return {
          [`pdir.order.${step.factKey}.ok`]: false,
          [`pdir.order.${step.factKey}.reasonCode`]: result.reasonCode,
          [`pdir.order.${step.factKey}.status`]: null,
          [`pdir.order.${step.factKey}.auditCount`]: result.auditEvents?.length ?? 0,
        };
      }
      const audit = result.auditEvents[0];
      logPush(state, "pdir.orderLog", `${step.orderId}:${result.order?.status ?? "?"}:${step.authorization.decisionId}`);
      return {
        [`pdir.order.${step.factKey}.ok`]: true,
        [`pdir.order.${step.factKey}.reasonCode`]: null,
        [`pdir.order.${step.factKey}.status`]: result.order?.status ?? null,
        [`pdir.order.${step.factKey}.quoteId`]: result.order?.quoteId.value ?? null,
        [`pdir.order.${step.factKey}.authorizationDecisionId`]: result.order?.authorization.decisionId ?? null,
        [`pdir.order.${step.factKey}.auditKind`]: audit?.kind ?? null,
        [`pdir.order.${step.factKey}.auditAuthorizationDecisionId`]: audit?.authorizationDecisionId ?? null,
        [`pdir.order.${step.factKey}.auditDigest`]: audit?.digest ?? null,
      };
    }
    case "pdir-order-read": {
      const { directory } = seamFor(state);
      const caller = (step.callerTenant ?? "own") === "own" ? state.tenant : OTHER_TENANT;
      const order = await directory.getOrder(caller, oid(step.orderId));
      logPush(state, "pdir.readLog", `${step.callerTenant ?? "own"}:${step.orderId}:${order?.status ?? "null"}`);
      return {
        [`pdir.orderRead.${step.factKey}.found`]: order !== null,
        [`pdir.orderRead.${step.factKey}.status`]: order?.status ?? null,
        [`pdir.orderRead.${step.factKey}.quoteId`]: order?.quoteId.value ?? null,
      };
    }
    case "pdir-quote-read": {
      const { directory } = seamFor(state);
      const caller = (step.callerTenant ?? "own") === "own" ? state.tenant : OTHER_TENANT;
      const quote = await directory.getQuote(caller, qid(step.quoteId));
      logPush(state, "pdir.readLog", `${step.callerTenant ?? "own"}:${step.quoteId}:${quote?.status ?? "null"}`);
      return {
        [`pdir.quoteRead.${step.factKey}.found`]: quote !== null,
        [`pdir.quoteRead.${step.factKey}.status`]: quote?.status ?? null,
      };
    }
  }
}

export async function runVendorMatchingStep(
  step: VendorMatchingStep,
  state: JourneyState,
): Promise<DriverFacts> {
  switch (step.kind) {
    case "pdir-match-vendors": {
      const { directory } = seamFor(state);
      const demandTenant = (step.demandTenant ?? "own") === "own" ? state.tenant : OTHER_TENANT;
      const demand: ProcurementDemand = {
        id: { kind: "procurement-demand", value: step.demandId },
        tenant: demandTenant,
        needId: { kind: "need", value: "need-f351c" },
        quantity: 1,
        requiredBy: CLOCK.now,
        capabilityTags: [...step.demandTags],
      };
      const vendors = step.vendors.map((v) => ({
        vendorId: v.vendorId,
        tenant: (v.tenant ?? "own") === "own" ? state.tenant : OTHER_TENANT,
        capabilityTags: [...v.capabilityTags],
        serviceLevel: v.serviceLevel,
        unitCost: v.unitCost,
      }));
      const result = await directory.matchVendors(state.tenant, demand, vendors, {
        occurredAt: CLOCK.iso2,
      });
      if (!result.ok) {
        logPush(state, "pdir.matchLog", `${step.demandId}:refused:${result.reasonCode}`);
        return {
          [`pdir.match.${step.factKey}.ok`]: false,
          [`pdir.match.${step.factKey}.reasonCode`]: result.reasonCode,
          [`pdir.match.${step.factKey}.matchCount`]: 0,
        };
      }
      const matches = result.matches ?? [];
      const audit = result.auditEvents[0];
      logPush(
        state,
        "pdir.matchLog",
        `${step.demandId}:${matches.map((m) => `${m.vendorId}@${m.score.toFixed(6)}`).join(",") || "-"}`,
      );
      const scoreFacts: DriverFacts = {};
      matches.forEach((m, i) => {
        scoreFacts[`pdir.match.${step.factKey}.score.${i}`] = m.score;
      });
      return {
        [`pdir.match.${step.factKey}.ok`]: true,
        [`pdir.match.${step.factKey}.reasonCode`]: null,
        [`pdir.match.${step.factKey}.matchCount`]: matches.length,
        [`pdir.match.${step.factKey}.vendors`]: matches.map((m) => m.vendorId),
        [`pdir.match.${step.factKey}.scoreStrings`]: matches.map((m) => `${m.vendorId}:${m.score}`),
        [`pdir.match.${step.factKey}.matchedTags`]: matches.map((m) => `${m.vendorId}:${m.matchedTags.join("+")}`),
        [`pdir.match.${step.factKey}.tieBreakRules`]: matches.map((m) => `${m.vendorId}:${m.tieBreakRule ?? "none"}`),
        [`pdir.match.${step.factKey}.firstTieBreakRule`]: matches[0]?.tieBreakRule ?? null,
        [`pdir.match.${step.factKey}.auditKind`]: audit?.kind ?? null,
        [`pdir.match.${step.factKey}.auditMatchCount`]: audit?.matchCount ?? null,
        ...scoreFacts,
      };
    }
  }
}
