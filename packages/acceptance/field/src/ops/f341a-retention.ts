/**
 * @fleetos/acceptance-field — F341A operation executors: A2 the observations
 * retention + projection law (Wave 14 lane A; the F340 §1 census candidate
 * A2 — `packages/observations/src/retention.ts`, zero prior corpus coverage).
 *
 * Every executor drives a REAL public API of @fleetos/observations
 * (createInMemoryImmutableStore, buildDeviceSummary, projectionStale,
 * defaultRetentionPolicy — the surface re-exported through ingestion.ts) and
 * records readings from the REAL outputs. The appended observations are REAL
 * pipeline-admitted outputs (runPipeline through the existing
 * observation.ingest ops); a fail-closed read (null on a foreign tenant or
 * an unknown key) surfaces as an op refusal so `expectRefusal` steps prove
 * the store's honest-absence law.
 */

import {
  buildDeviceSummary,
  createInMemoryImmutableStore,
  defaultRetentionPolicy,
  projectionStale,
  type InMemoryImmutableStore,
  type Observation,
} from "@fleetos/observations";
import type { JourneyOperation } from "../journey-contracts.js";
import type { JourneyContext, ReadingValue } from "../context.js";
import { opOk, opRefused, type OpExecution } from "./common.js";
import { deepEquals } from "../determinism.js";

const FIRST_SUMMARY_KEY = "first";

function storeOf(ctx: JourneyContext, storeId: string): InMemoryImmutableStore | undefined {
  return ctx.retentionStores.get(storeId);
}

function ingestedObservationsFor(ctx: JourneyContext, deviceId: string): Observation[] {
  return ctx.observations.filter((o) => o.deviceId === deviceId);
}

export function executeF341ARetentionOperation(op: JourneyOperation, ctx: JourneyContext): OpExecution {
  switch (op.kind) {
    case "ret.store-open": {
      const store = createInMemoryImmutableStore();
      ctx.retentionStores.set(op.storeId, store);
      return opOk({ "ret.size": store.size, "ret.lastSeq": 0 });
    }
    case "ret.append-ingested": {
      const store = storeOf(ctx, op.storeId);
      if (!store) return opRefused("unknown-store", { "ret.refused": "unknown-store" });
      const obs = ingestedObservationsFor(ctx, op.deviceId);
      if (obs.length === 0) return opRefused("no-ingested-observations", { "ret.refused": "no-ingested-observations" });
      const sizeBefore = store.size;
      for (const o of obs) store.append(o);
      return opOk({
        "ret.size": store.size,
        "ret.appended": obs.length,
        "ret.sizeGrew": store.size - sizeBefore,
        "ret.lastSeq": store.lastSeqForDevice(op.deviceId),
      });
    }
    case "ret.read": {
      const store = storeOf(ctx, op.storeId);
      if (!store) return opRefused("unknown-store", { "ret.refused": "unknown-store" });
      const tenantId = op.tenantId ?? ctx.tenantId;
      const read = store.findByKey(tenantId, op.deviceId, op.seq);
      if (read === null) {
        // The REAL fail-closed read: unknown key or foreign tenant — honest
        // absence, never a fabricated record.
        const foreign = tenantId !== ctx.tenantId;
        return opRefused(foreign ? "tenant-fail-closed" : "unknown-observation-key", {
          "ret.readRefused": foreign ? "tenant-fail-closed" : "unknown-observation-key",
          "ret.readResult": null,
          "ret.foreignListEmpty": store.listByDevice(tenantId, op.deviceId).length === 0,
        });
      }
      return opOk({
        "ret.readId": read.id,
        "ret.readSeq": read.seq as number,
        "ret.readObservedAt": read.observedAt,
        "ret.readKind": read.kind,
      });
    }
    case "ret.device-summary": {
      const store = storeOf(ctx, op.storeId);
      if (!store) return opRefused("unknown-store", { "ret.refused": "unknown-store" });
      const summary = buildDeviceSummary(store, ctx.tenantId, op.deviceId, op.builtAt);
      ctx.firstSummaries.set(FIRST_SUMMARY_KEY, {
        metaId: summary.meta.id,
        sourceHash: summary.meta.sourceHash,
        count: summary.count,
        lastSeq: summary.lastSeq,
      });
      return opOk({
        "ret.summaryCount": summary.count,
        "ret.summaryLastSeq": summary.lastSeq,
        "ret.summaryLastObservedAt": summary.lastObservedAt,
        "ret.summaryKinds": [...summary.kinds],
        "ret.summaryMetaKind": summary.meta.kind,
        "ret.summaryMetaId": summary.meta.id,
        "ret.summaryMetaTenant": summary.meta.tenantId,
        "ret.summarySourceHash": summary.meta.sourceHash,
        "ret.summaryBuiltAt": summary.meta.builtAt,
      });
    }
    case "ret.projection-stale": {
      const store = storeOf(ctx, op.storeId);
      if (!store) return opRefused("unknown-store", { "ret.refused": "unknown-store" });
      const summary = buildDeviceSummary(store, ctx.tenantId, op.deviceId, op.builtAt);
      const policy = defaultRetentionPolicy();
      const staleByOffset = op.offsets.map((offset) =>
        projectionStale(summary.meta, summary.meta.builtAt + offset, policy),
      );
      return opOk({
        "ret.staleByOffset": staleByOffset,
        "ret.projectionTtlMs": policy.projectionTtlMs,
      });
    }
    case "ret.rebuild-summary": {
      const store = storeOf(ctx, op.storeId);
      if (!store) return opRefused("unknown-store", { "ret.refused": "unknown-store" });
      const first = ctx.firstSummaries.get(FIRST_SUMMARY_KEY);
      if (!first) return opRefused("no-first-summary", { "ret.refused": "no-first-summary" });
      const rebuilt = buildDeviceSummary(store, ctx.tenantId, op.deviceId, op.builtAt);
      return opOk({
        "ret.rebuildCount": rebuilt.count,
        "ret.rebuildLastSeq": rebuilt.lastSeq,
        "ret.rebuildSourceHash": rebuilt.meta.sourceHash,
        "ret.rebuildMetaId": rebuilt.meta.id,
        "ret.rebuildBuiltAt": rebuilt.meta.builtAt,
        // Comparisons of REAL outputs (the disposable projection is
        // rebuildable: content-equal, identity-distinct).
        "ret.rebuildContentIdentical":
          rebuilt.count === first.count && rebuilt.lastSeq === first.lastSeq && rebuilt.meta.sourceHash === first.sourceHash,
        "ret.rebuildMetaIdDiffers": rebuilt.meta.id !== first.metaId,
      });
    }
    case "ret.immutability-probe": {
      const store = storeOf(ctx, op.storeId);
      if (!store) return opRefused("unknown-store", { "ret.refused": "unknown-store" });
      const ingested = ingestedObservationsFor(ctx, op.deviceId).find((o) => (o.seq as number) === op.seq);
      if (!ingested) return opRefused("no-ingested-observation", { "ret.refused": "no-ingested-observation" });
      const stored = store.findByKey(ctx.tenantId, op.deviceId, op.seq);
      return opOk({
        // A stored observation is never mutated: the deep comparison of the
        // REAL stored record against the REAL admitted record (after every
        // append + read since) is the immutability proof.
        "ret.storedUnchanged": stored !== null && deepEquals(stored, ingested),
        "ret.storedId": stored !== null ? stored.id : null,
        "ret.storedSeq": stored !== null ? (stored.seq as number) : null,
        "ret.storedObservedAt": stored !== null ? stored.observedAt : null,
        "ret.ingestedId": ingested.id,
      });
    }
    case "ret.retention-defaults": {
      const policy = defaultRetentionPolicy();
      const readings: Record<string, ReadingValue> = {
        "ret.default.projectionTtlMs": policy.projectionTtlMs,
        "ret.default.rebuildOnDrift": policy.rebuildOnDrift,
        "ret.default.immutableStoreTtl": policy.immutableStoreTtl,
        "ret.default.immutableStoreForever": policy.immutableStoreTtl === null,
      };
      return opOk(readings);
    }
    default:
      return opRefused("unknown-operation");
  }
}
