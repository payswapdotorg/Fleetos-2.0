/**
 * World state fold tests (Wave 3, F230B) — journal-fold determinism, digest
 * chaining, checkpoints/resume, staleness classification, predictive
 * integration through ModelPort (advisory law), every fold rejection code.
 */
import { describe, it, expect } from "vitest";
import {
  checkpointWorld,
  classifyStaleness,
  foldWorldState,
  nextWorldEntry,
  projectEntity,
  resumeWorld,
  worldEntryDigest,
  worldGenesisDigest,
  worldStateDigest,
  askWorldProjection,
  type WorldEvent,
  type WorldJournalEntry,
} from "../src/index.ts";
import { makeReferenceModelPort } from "@fleetos/predictive";
import type { TwinStateInput } from "../src/index.ts";

const TENANT = "t1";
const AT = [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000];

function buildJournal(events: readonly WorldEvent[]): WorldJournalEntry[] {
  const entries: WorldJournalEntry[] = [];
  events.forEach((event, i) => {
    entries.push(
      nextWorldEntry({
        tenantId: TENANT,
        existing: entries,
        event,
        atMs: (AT[i] ?? 9000 + i) as number,
      }),
    );
  });
  return entries;
}

function standardEvents(): WorldEvent[] {
  return [
    { kind: "entity-registered", entityId: "a-1", entityType: "asset" },
    { kind: "observation-recorded", entityId: "a-1", entityType: "asset", observationRef: "o1", observedAtMs: 1500, value: 10 },
    { kind: "observation-recorded", entityId: "a-1", entityType: "asset", observationRef: "o2", observedAtMs: 2500, value: 20 },
    { kind: "entity-registered", entityId: "g-1", entityType: "agent" },
    { kind: "entity-tagged", entityId: "a-1", entityType: "asset", tags: ["critical", "fleet"] },
    { kind: "entity-tagged", entityId: "a-1", entityType: "asset", tags: ["critical", "north"] },
    { kind: "entity-retired", entityId: "g-1", entityType: "agent", reason: "decommissioned" },
    { kind: "observation-recorded", entityId: "g-1", entityType: "agent", observationRef: "o3", observedAtMs: 7500, value: 1 },
  ];
}

// ---------- Fold: determinism + projections ----------

describe("foldWorldState: deterministic replay", () => {
  it("folding the same journal twice yields the identical state", () => {
    const entries = buildJournal(standardEvents());
    const a = foldWorldState(entries);
    const b = foldWorldState(entries);
    expect(a).toEqual(b);
  });

  it("input entry order is irrelevant — the fold is seq-driven", () => {
    const entries = buildJournal(standardEvents());
    const shuffled = [...entries].reverse();
    expect(foldWorldState(entries)).toEqual(foldWorldState(shuffled));
  });

  it("folds entities with last-observation-driven state, tags, and lifecycle", () => {
    const r = foldWorldState(buildJournal(standardEvents()));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.tenantId).toBe(TENANT);
      expect(r.state.journalLength).toBe(8);
      expect(r.state.entities.map((e) => e.entityId)).toEqual(["a-1", "g-1"]); // sorted
      const a1 = r.state.entities[0];
      expect(a1?.entityType).toBe("asset");
      expect(a1?.state).toBe("active");
      expect(a1?.observationCount).toBe(2);
      expect(a1?.lastObservation).toEqual({ observationRef: "o2", atMs: 2500, value: 20 });
      expect(a1?.observations).toEqual([
        { observationRef: "o1", atMs: 1500, value: 10 },
        { observationRef: "o2", atMs: 2500, value: 20 },
      ]);
      expect(a1?.tags).toEqual(["critical", "fleet", "north"]); // deduped, insertion order
      const g1 = r.state.entities[1];
      expect(g1?.state).toBe("retired");
      expect(g1?.retiredAtMs).toBe(7000);
      // Mechanical fold: an observation recorded after retirement is still
      // recorded (the journal is the durable record of what happened).
      expect(g1?.lastObservation?.observationRef).toBe("o3");
      expect(g1?.state).toBe("retired");
    }
  });

  it("an observation for an unknown entity auto-registers it", () => {
    const r = foldWorldState(
      buildJournal([
        { kind: "observation-recorded", entityId: "org-1", entityType: "org", observationRef: "o1", observedAtMs: 100, value: 5 },
      ]),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      const org = r.state.entities[0];
      expect(org?.entityType).toBe("org");
      expect(org?.state).toBe("active");
      expect(org?.observationCount).toBe(1);
      expect(org?.registeredAtMs).toBe(1000);
    }
  });

  it("re-registering a known entity is idempotent", () => {
    const r = foldWorldState(
      buildJournal([
        { kind: "entity-registered", entityId: "a-1", entityType: "asset" },
        { kind: "entity-registered", entityId: "a-1", entityType: "asset" },
      ]),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.entities).toHaveLength(1);
      expect(r.state.entities[0]?.registeredAtMs).toBe(1000);
    }
  });
});

// ---------- Fold: rejection codes ----------

describe("foldWorldState: honest rejections", () => {
  it("rejects mixed-tenant journals (tenant fail-closed)", () => {
    const entries = buildJournal(standardEvents());
    // A 9th entry chained onto the journal but stamped with a foreign tenant.
    const foreign = nextWorldEntry({
      tenantId: "t2",
      existing: entries,
      event: { kind: "entity-registered", entityId: "x", entityType: "asset" },
      atMs: 9500,
    });
    const r = foldWorldState([...entries, foreign]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rejected).toBe("mixed-tenant");
  });

  it("rejects seq gaps and duplicate seqs", () => {
    const entries = buildJournal(standardEvents());
    const gapped = entries.filter((e) => e.seq !== 3);
    const gapResult = foldWorldState(gapped);
    expect(gapResult.ok).toBe(false);
    if (!gapResult.ok) expect(gapResult.rejected).toBe("seq-gap");

    const dupResult = foldWorldState([...entries, entries[entries.length - 1] as WorldJournalEntry]);
    expect(dupResult.ok).toBe(false);
    if (!dupResult.ok) expect(dupResult.rejected).toBe("seq-gap");
  });

  it("rejects a tampered digest (bad-digest)", () => {
    const entries = buildJournal(standardEvents());
    const tampered = entries.map((e) =>
      e.seq === 4 ? { ...e, digest: "deadbeef" } : e,
    );
    const r = foldWorldState(tampered);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rejected).toBe("bad-digest");
  });

  it("rejects a broken prevDigest link (bad-digest)", () => {
    const entries = buildJournal(standardEvents());
    const broken = entries.map((e) =>
      e.seq === 5 ? { ...e, prevDigest: null } : e,
    );
    const r = foldWorldState(broken);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rejected).toBe("bad-digest");
  });

  it("rejects malformed event payloads (invalid-event-payload)", () => {
    const emptyRef = buildJournal([
      { kind: "observation-recorded", entityId: "a-1", entityType: "asset", observationRef: "", observedAtMs: 100, value: 1 },
    ]);
    const refResult = foldWorldState(emptyRef);
    expect(refResult.ok).toBe(false);
    if (!refResult.ok) expect(refResult.rejected).toBe("invalid-event-payload");

    const emptyTag = buildJournal([
      { kind: "entity-tagged", entityId: "a-1", entityType: "asset", tags: [""] },
    ]);
    const tagResult = foldWorldState(emptyTag);
    expect(tagResult.ok).toBe(false);
    if (!tagResult.ok) expect(tagResult.rejected).toBe("invalid-event-payload");
  });
});

// ---------- Journal construction + digest chain ----------

describe("nextWorldEntry: chained, deterministic journal construction", () => {
  it("builds contiguous entries chained from the genesis digest", () => {
    const entries = buildJournal(standardEvents());
    expect(entries.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(entries[0]?.prevDigest).toBe(null);
    expect(entries[0]?.digest).toBe(
      worldEntryDigest(null, {
        seq: 1,
        tenantId: TENANT,
        event: standardEvents()[0] as WorldEvent,
        atMs: 1000,
      }),
    );
    expect(entries[7]?.prevDigest).toBe(entries[6]?.digest);
    expect(foldWorldState(entries).ok).toBe(true);
  });

  it("is deterministic — rebuilding the journal yields identical digests", () => {
    expect(buildJournal(standardEvents())).toEqual(buildJournal(standardEvents()));
    expect(worldGenesisDigest(TENANT)).toBe(worldGenesisDigest(TENANT));
    expect(worldGenesisDigest(TENANT)).not.toBe(worldGenesisDigest("t2"));
  });
});

// ---------- Staleness classification ----------

describe("classifyStaleness / projectEntity", () => {
  const thresholds = { freshWithinMs: 5000, staleWithinMs: 60000 };

  it("classifies fresh / stale / unknown by integer-ms age thresholds", () => {
    expect(classifyStaleness(95000, 100000, thresholds)).toEqual({ ok: true, staleness: "fresh", ageMs: 5000 });
    expect(classifyStaleness(90000, 100000, thresholds)).toEqual({ ok: true, staleness: "stale", ageMs: 10000 });
    expect(classifyStaleness(1000, 100000, thresholds)).toEqual({ ok: true, staleness: "unknown", ageMs: 99000 });
    expect(classifyStaleness(null, 100000, thresholds)).toEqual({ ok: true, staleness: "unknown", ageMs: null });
  });

  it("rejects invalid thresholds (non-integer, negative, inverted)", () => {
    expect(classifyStaleness(0, 1000, { freshWithinMs: 0.5, staleWithinMs: 10 }).ok).toBe(false);
    expect(classifyStaleness(0, 1000, { freshWithinMs: -1, staleWithinMs: 10 }).ok).toBe(false);
    expect(classifyStaleness(0, 1000, { freshWithinMs: 10, staleWithinMs: 5 }).ok).toBe(false);
  });

  it("projectEntity attaches staleness + age to the entity view", () => {
    const folded = foldWorldState(buildJournal(standardEvents()));
    expect(folded.ok).toBe(true);
    if (folded.ok) {
      const a1 = folded.state.entities[0];
      if (a1) {
        const p = projectEntity(a1, 12500, thresholds);
        expect(p.ok).toBe(true);
        if (p.ok) {
          // last observation @2500, now 12500 => age 10000: beyond fresh (5000), within stale (60000).
          expect(p.projection.staleness).toBe("stale");
          expect(p.projection.ageMs).toBe(10000);
        }
      }
    }
  });

  it("projectEntity propagates invalid-thresholds", () => {
    const folded = foldWorldState(buildJournal(standardEvents()));
    if (folded.ok) {
      const a1 = folded.state.entities[0];
      if (a1) {
        const p = projectEntity(a1, 100000, { freshWithinMs: 10, staleWithinMs: 5 });
        expect(p.ok).toBe(false);
        if (!p.ok) expect(p.rejected).toBe("invalid-thresholds");
      }
    }
  });
});

// ---------- Checkpoints + resume ----------

describe("checkpoints + resume", () => {
  it("checkpointWorld folds a prefix; stateDigest is deterministic", () => {
    const entries = buildJournal(standardEvents());
    const cp = checkpointWorld(entries, 5);
    const cp2 = checkpointWorld(entries, 5);
    expect(cp.ok && cp2.ok).toBe(true);
    if (cp.ok && cp2.ok) {
      expect(cp.checkpoint.stateDigest).toBe(cp2.checkpoint.stateDigest);
      expect(cp.checkpoint.seq).toBe(5);
      expect(cp.checkpoint.state.journalLength).toBe(5);
      expect(cp.checkpoint.stateDigest).toBe(worldStateDigest(cp.checkpoint.state));
      // Checkpoint state equals a full fold of the prefix.
      const prefixFold = foldWorldState(entries.slice(0, 5));
      expect(prefixFold.ok).toBe(true);
      if (prefixFold.ok) expect(cp.checkpoint.state).toEqual(prefixFold.state);
    }
  });

  it("rejects invalid checkpoint seqs", () => {
    const entries = buildJournal(standardEvents());
    const tooFar = checkpointWorld(entries, 9);
    expect(tooFar.ok).toBe(false);
    if (!tooFar.ok) expect(tooFar.rejected).toBe("invalid-checkpoint-seq");
    const negative = checkpointWorld(entries, -1);
    expect(negative.ok).toBe(false);
    if (!negative.ok) expect(negative.rejected).toBe("invalid-checkpoint-seq");
  });

  it("resumeWorld from a checkpoint equals the full fold (no prefix re-fold)", () => {
    const entries = buildJournal(standardEvents());
    const cp = checkpointWorld(entries, 3);
    const full = foldWorldState(entries);
    expect(cp.ok && full.ok).toBe(true);
    if (cp.ok && full.ok) {
      const resumed = resumeWorld(cp.checkpoint, entries.slice(3));
      expect(resumed.ok).toBe(true);
      if (resumed.ok) expect(resumed.state).toEqual(full.state);
      // The checkpoint's own state is not mutated by resuming.
      const again = resumeWorld(cp.checkpoint, entries.slice(3));
      expect(again.ok).toBe(true);
      if (again.ok) expect(again.state).toEqual(full.state);
    }
  });

  it("resumeWorld rejects seq mismatches, foreign tenants, and broken chains", () => {
    const entries = buildJournal(standardEvents());
    const cp = checkpointWorld(entries, 4);
    expect(cp.ok).toBe(true);
    if (cp.ok) {
      const badSeq = resumeWorld(cp.checkpoint, entries.slice(5)); // starts at 6, expected 5
      expect(badSeq.ok).toBe(false);
      if (!badSeq.ok) expect(badSeq.rejected).toBe("suffix-seq-mismatch");

      const foreignEntry: WorldJournalEntry = {
        seq: 5,
        tenantId: "t2",
        event: { kind: "entity-registered", entityId: "x", entityType: "asset" },
        atMs: 9500,
        digest: "irrelevant-before-tenant-check",
        prevDigest: entries[3]?.digest ?? null,
      };
      const badTenant = resumeWorld(cp.checkpoint, [foreignEntry]);
      expect(badTenant.ok).toBe(false);
      if (!badTenant.ok) expect(badTenant.rejected).toBe("suffix-tenant-mismatch");

      const tampered = entries.slice(4).map((e) => (e.seq === 5 ? { ...e, digest: "deadbeef" } : e));
      const badDigest = resumeWorld(cp.checkpoint, tampered);
      expect(badDigest.ok).toBe(false);
      if (!badDigest.ok) expect(badDigest.rejected).toBe("bad-digest");
    }
  });
});

// ---------- Predictive integration (advisory; ModelPort supplied by caller) ----------

describe("askWorldProjection: advisory predictive integration", () => {
  const port = makeReferenceModelPort();

  it("projects a world entity's observation log through the reference port", () => {
    const folded = foldWorldState(buildJournal(standardEvents()));
    expect(folded.ok).toBe(true);
    if (folded.ok) {
      const a1 = folded.state.entities[0];
      if (a1) {
        const r = askWorldProjection({
          tenantId: TENANT,
          entity: a1,
          metric: "temperature",
          asOfMs: 2500,
          horizon: { steps: 2, stepMs: 1000 },
          port,
        });
        expect(r.ok).toBe(true);
        if (r.ok) {
          expect(r.prediction.advisory).toBe(true);
          expect(r.prediction.kind).toBe("PREDICTION");
          expect(r.prediction.provenance.observationRefs).toEqual(["o1", "o2"]);
          // Linear history 10 -> 20 over 1000ms: drift 0.01/ms; last 20 @2500.
          expect(r.prediction.points.map((p) => p.value)).toEqual([30, 40]);
        }
      }
    }
  });

  it("rejects honestly for an entity with no observations and for a missing tenant", () => {
    const folded = foldWorldState(
      buildJournal([{ kind: "entity-registered", entityId: "a-9", entityType: "asset" }]),
    );
    expect(folded.ok).toBe(true);
    if (folded.ok) {
      const a9 = folded.state.entities[0];
      if (a9) {
        const empty = askWorldProjection({
          tenantId: TENANT,
          entity: a9,
          metric: "temperature",
          asOfMs: 0,
          horizon: { steps: 1, stepMs: 1000 },
          port,
        });
        expect(empty.ok).toBe(false);
        if (!empty.ok) expect(empty.rejected).toBe("empty-history");
      }
    }
    const folded2 = foldWorldState(buildJournal(standardEvents()));
    if (folded2.ok) {
      const a1 = folded2.state.entities[0];
      if (a1) {
        const noTenant = askWorldProjection({
          tenantId: "",
          entity: a1,
          metric: "temperature",
          asOfMs: 2500,
          horizon: { steps: 1, stepMs: 1000 },
          port,
        });
        expect(noTenant.ok).toBe(false);
        if (!noTenant.ok) expect(noTenant.rejected).toBe("missing-tenant");
      }
    }
  });

  it("compile-time: an advisory Prediction can never become a journal event or authoritative input", () => {
    const folded = foldWorldState(buildJournal(standardEvents()));
    expect(folded.ok).toBe(true);
    if (folded.ok) {
      const a1 = folded.state.entities[0];
      if (a1) {
        const r = askWorldProjection({
          tenantId: TENANT,
          entity: a1,
          metric: "temperature",
          asOfMs: 2500,
          horizon: { steps: 1, stepMs: 1000 },
          port,
        });
        expect(r.ok).toBe(true);
        if (r.ok) {
          const prediction = r.prediction;
          // @ts-expect-error — a Prediction is not a TwinStateInput (advisory never feeds back)
          const _badState: TwinStateInput = prediction;
          // @ts-expect-error — a Prediction is not a WorldEvent (never enters the journal)
          const _badEvent: WorldEvent = prediction;
          void _badState;
          void _badEvent;
          expect(prediction.advisory).toBe(true);
        }
      }
    }
  });
});
