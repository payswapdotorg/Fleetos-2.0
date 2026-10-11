/**
 * @fleetos/acceptance-commerce — vendor-directory step drivers (F321C,
 * Wave 12 lane C).
 *
 * Interprets typed journey steps against the REAL public entry points of
 * `@fleetos/vendors` directory.ts: the VendorDirectory over the REAL
 * in-memory VendorRepositoryPort — service-relationship transitions
 * (append-only audit events with FNV-1a digests, illegal-transition and
 * required-reason refusals), worst-wins scorecard aggregation
 * (EMPTY_SCORECARD / SCORE_OUT_OF_RANGE refusals), and the deterministic
 * tenant-scoped capability matching feed (active vendors only, lexical
 * vendor order). Cross-tenant reads through the repository return
 * NOTHING (fail-closed null), never another tenant's record.
 *
 * The per-journey directory seam (one repository + one directory bound to
 * it) lives in a WeakMap keyed by JourneyState — a fresh world per run
 * keeps every run pure and deterministic. Facts are namespaced per
 * `factKey`; refusals are honest facts carrying the domain reason codes.
 */

import type { FactValue, VendorDirectoryStep } from "./journey-contracts.js";
import type { JourneyState } from "./journey-world.js";
import { CLOCK, OTHER_TENANT, logPush } from "./journey-world.js";
import type {
  Vendor,
  VendorId,
  VendorServiceRelationship,
  VendorScorecard,
} from "@fleetos/vendors";
import { createInMemoryVendorRepository, createVendorDirectory } from "@fleetos/vendors";

export type DriverFacts = Record<string, FactValue>;

interface DirectorySeam {
  readonly directory: ReturnType<typeof createVendorDirectory>;
}

const seams = new WeakMap<JourneyState, DirectorySeam>();

function seamFor(state: JourneyState, seed?: {
  readonly vendors: readonly {
    readonly vendorId: string;
    readonly displayName: string;
    readonly status: "active" | "suspended" | "terminated";
    readonly capabilityTags: readonly string[];
    readonly tenant?: "own" | "foreign";
  }[];
  readonly relationships: readonly { readonly vendorId: string; readonly contractRef: string }[];
  readonly scorecards: readonly {
    readonly vendorId: string;
    readonly metrics: readonly { readonly metric: string; readonly score: number; readonly observedAt: string }[];
  }[];
}): DirectorySeam {
  let seam = seams.get(state);
  if (seam === undefined || seed !== undefined) {
    const vendors: Vendor[] = (seed?.vendors ?? []).map((v) => ({
      id: { kind: "vendor", value: v.vendorId },
      tenant: (v.tenant ?? "own") === "own" ? state.tenant : OTHER_TENANT,
      displayName: v.displayName,
      status: v.status,
      capabilityTags: [...v.capabilityTags],
    }));
    const relationships: VendorServiceRelationship[] = (seed?.relationships ?? []).map((r) => ({
      vendorId: { kind: "vendor", value: r.vendorId },
      tenant: state.tenant,
      startedAt: CLOCK.iso1,
      endedAt: null,
      contractRef: r.contractRef,
      status: "active",
    }));
    const scorecards: VendorScorecard[] = (seed?.scorecards ?? []).map((s) => ({
      vendorId: { kind: "vendor", value: s.vendorId },
      tenant: state.tenant,
      metricScores: s.metrics.map((m) => ({ metric: m.metric, score: m.score, observedAt: m.observedAt })),
    }));
    const repo = createInMemoryVendorRepository(vendors, relationships, scorecards);
    seam = { directory: createVendorDirectory(repo) };
    seams.set(state, seam);
  }
  return seam;
}

function vid(value: string): VendorId {
  return { kind: "vendor", value };
}

export async function runVendorDirectoryStep(step: VendorDirectoryStep, state: JourneyState): Promise<DriverFacts> {
  switch (step.kind) {
    case "vendor-directory-seed": {
      seamFor(state, step);
      return {
        [`vd.seed.${step.factKey}.vendorCount`]: step.vendors.length,
        [`vd.seed.${step.factKey}.activeCount`]: step.vendors.filter((v) => v.status === "active").length,
        [`vd.seed.${step.factKey}.relationshipCount`]: step.relationships.length,
        [`vd.seed.${step.factKey}.scorecardCounts`]: step.scorecards.map((s) => `${s.vendorId}:${s.metrics.length}`),
      };
    }
    case "vendor-relationship-transition": {
      const { directory } = seamFor(state);
      const command =
        step.command === "suspend"
          ? { type: "suspend" as const, reason: step.reason ?? "" }
          : step.command === "resume"
            ? { type: "resume" as const }
            : { type: "terminate" as const, reason: step.reason ?? "", endedAt: step.endedAt ?? CLOCK.iso3 };
      const result = await directory.transitionServiceRelationship(state.tenant, vid(step.vendorId), command, {
        occurredAt: CLOCK.iso2,
      });
      if (!result.ok) {
        logPush(state, "vd.transitionLog", `${step.vendorId}:refused:${result.reasonCode}`);
        return {
          [`vd.transition.${step.factKey}.ok`]: false,
          [`vd.transition.${step.factKey}.reasonCode`]: result.reasonCode,
        };
      }
      logPush(state, "vd.transitionLog", `${step.vendorId}:${result.relationship?.status ?? "?"}`);
      return {
        [`vd.transition.${step.factKey}.ok`]: true,
        [`vd.transition.${step.factKey}.status`]: result.relationship?.status ?? null,
        [`vd.transition.${step.factKey}.endedAt`]: result.relationship?.endedAt ?? null,
        [`vd.transition.${step.factKey}.auditCount`]: result.auditEvents.length,
        [`vd.transition.${step.factKey}.auditKind`]: result.auditEvents[0]?.kind ?? null,
        [`vd.transition.${step.factKey}.auditFromStatus`]: result.auditEvents[0]?.fromStatus ?? null,
        [`vd.transition.${step.factKey}.auditToStatus`]: result.auditEvents[0]?.toStatus ?? null,
        [`vd.transition.${step.factKey}.auditDigest`]: result.auditEvents[0]?.digest ?? null,
      };
    }
    case "vendor-scorecard-aggregate": {
      const { directory } = seamFor(state);
      const result = await directory.aggregateScorecard(state.tenant, vid(step.vendorId));
      if (!result.ok) {
        logPush(state, "vd.scorecardLog", `${step.vendorId}:refused:${result.reasonCode}`);
        return {
          [`vd.scorecard.${step.factKey}.ok`]: false,
          [`vd.scorecard.${step.factKey}.reasonCode`]: result.reasonCode,
        };
      }
      logPush(state, "vd.scorecardLog", `${step.vendorId}:${result.aggregate?.worstScore}`);
      return {
        [`vd.scorecard.${step.factKey}.ok`]: true,
        [`vd.scorecard.${step.factKey}.worstScore`]: result.aggregate?.worstScore ?? null,
        [`vd.scorecard.${step.factKey}.worstMetric`]: result.aggregate?.worstMetric ?? null,
        [`vd.scorecard.${step.factKey}.observationCount`]: result.aggregate?.observationCount ?? -1,
        [`vd.scorecard.${step.factKey}.auditCount`]: result.auditEvents.length,
      };
    }
    case "vendor-capability-feed": {
      const { directory } = seamFor(state);
      const result = await directory.capabilityMatchingFeed(state.tenant, [...step.requestedTags], {
        occurredAt: CLOCK.iso2,
      });
      if (!result.ok) {
        return { [`vd.feed.${step.factKey}.ok`]: false, [`vd.feed.${step.factKey}.reasonCode`]: "FEED_REFUSED" };
      }
      const feed = result.feed ?? [];
      logPush(state, "vd.feedLog", feed.map((f) => `${f.vendorId}@${f.serviceLevel}`).join(",") || "-");
      return {
        [`vd.feed.${step.factKey}.ok`]: true,
        [`vd.feed.${step.factKey}.vendors`]: feed.map((f) => f.vendorId),
        [`vd.feed.${step.factKey}.serviceLevels`]: feed.map((f) => `${f.vendorId}:${f.serviceLevel}`),
        [`vd.feed.${step.factKey}.tags`]: feed.map((f) => `${f.vendorId}:${f.capabilityTags.join("+")}`),
        [`vd.feed.${step.factKey}.auditKind`]: result.auditEvents[0]?.kind ?? null,
        [`vd.feed.${step.factKey}.count`]: feed.length,
      };
    }
    case "vendor-directory-read": {
      const { directory } = seamFor(state);
      const caller = (step.callerTenant ?? "own") === "own" ? state.tenant : OTHER_TENANT;
      const vendor = await directory.getVendor(caller, vid(step.vendorId));
      logPush(state, "vd.readLog", `${step.callerTenant ?? "own"}:${step.vendorId}:${vendor?.displayName ?? "null"}`);
      return {
        [`vd.read.${step.factKey}.found`]: vendor !== null,
        [`vd.read.${step.factKey}.displayName`]: vendor?.displayName ?? null,
        [`vd.read.${step.factKey}.status`]: vendor?.status ?? null,
      };
    }
  }
}
