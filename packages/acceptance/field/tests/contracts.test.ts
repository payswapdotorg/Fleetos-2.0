/**
 * @fleetos/acceptance-field — contract + helper unit tests: the FNV-1a digest
 * convention, canonical JSON, the assertion evaluator, and the mission-replay
 * structural mirror's resume policy (completed stages never re-execute).
 */

import { describe, expect, it } from "vitest";
import { fnv1a, fnv1a32, canonicalJson, deepEquals, digestOf } from "../src/determinism.js";
import { evaluateAssertion, journeyOutcomeDigest, toJourneyReport, verifyJourneyOutcome, type JourneyAssertion } from "../src/journey-contracts.js";
import {
  appendMirrorEntries,
  foldMirrorMission,
  makeMirrorJournal,
  mirrorWorkOrderIdempotencyKey,
  resumeMirrorMission,
  verifyMirrorJournal,
} from "../src/mission-mirror.js";

describe("determinism helpers (FNV-1a convention)", () => {
  it("fnv1a matches the standard FNV-1a 32-bit test vectors", () => {
    expect(fnv1a("")).toBe("811c9dc5");
    expect(fnv1a("a")).toBe("e40c292c");
    expect(fnv1a("foobar")).toBe("bf9cf968");
  });

  it("fnv1a32 joins parts with the unit separator", () => {
    expect(fnv1a32(["a", "b"])).toBe(fnv1a("a\u001fb"));
    expect(fnv1a32(["x", 1, true, null, undefined])).toBe(fnv1a("x\u001f1\u001ftrue\u001fnull\u001f"));
  });

  it("canonicalJson sorts object keys recursively and skips undefined members", () => {
    expect(canonicalJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    expect(canonicalJson({ a: 1, b: 2 })).toBe('{"a":1,"b":2}');
    expect(canonicalJson({ z: { y: 2, x: 1 }, a: [3, 1, 2] })).toBe('{"a":[3,1,2],"z":{"x":1,"y":2}}');
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
  });

  it("deepEquals is key-order insensitive and array-order sensitive", () => {
    expect(deepEquals({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1 })).toBe(true);
    expect(deepEquals([1, 2], [2, 1])).toBe(false);
    expect(deepEquals(null, null)).toBe(true);
    // JSON semantics: undefined members are skipped, so {b:1} equals {a:undefined,b:1}.
    expect(deepEquals({ b: 1 }, { a: undefined, b: 1 })).toBe(true);
    expect(deepEquals({ a: 1 }, { b: 1 })).toBe(false);
  });

  it("digestOf is scope-prefixed and canonical (key-order irrelevant)", () => {
    expect(digestOf("scope", { a: 1, b: 2 })).toBe(digestOf("scope", { b: 2, a: 1 }));
    expect(digestOf("scope-a", { a: 1 })).not.toBe(digestOf("scope-b", { a: 1 }));
  });
});

describe("assertion evaluator (every operator)", () => {
  const readings = new Map<string, unknown>([
    ["n", 5],
    ["s", "hello"],
    ["arr", [1, 2, 3]],
    ["nil", null],
    ["obj", { a: 1 }],
  ]);
  const run = (a: JourneyAssertion) => evaluateAssertion(a, readings);

  it("deep-equals / not-deep-equals", () => {
    expect(run({ id: "1", description: "", reading: "n", op: "deep-equals", expected: 5 }).pass).toBe(true);
    expect(run({ id: "2", description: "", reading: "n", op: "deep-equals", expected: 6 }).pass).toBe(false);
    expect(run({ id: "3", description: "", reading: "obj", op: "deep-equals", expected: { a: 1 } }).pass).toBe(true);
    expect(run({ id: "4", description: "", reading: "n", op: "not-deep-equals", expected: 5 }).pass).toBe(false);
  });

  it("reading-equals compares TWO recorded readings", () => {
    const pair = new Map<string, unknown>([["a", 7], ["b", 7], ["c", 8]]);
    expect(evaluateAssertion({ id: "r", description: "", reading: "a", op: "reading-equals", expected: "b" }, pair).pass).toBe(true);
    expect(evaluateAssertion({ id: "r", description: "", reading: "a", op: "reading-equals", expected: "c" }, pair).pass).toBe(false);
    expect(evaluateAssertion({ id: "r", description: "", reading: "a", op: "reading-equals", expected: "missing" }, pair).pass).toBe(false);
  });

  it("number-gte / number-lte refuse non-numbers", () => {
    expect(run({ id: "g", description: "", reading: "n", op: "number-gte", expected: 5 }).pass).toBe(true);
    expect(run({ id: "g", description: "", reading: "n", op: "number-gte", expected: 6 }).pass).toBe(false);
    expect(run({ id: "g", description: "", reading: "s", op: "number-gte", expected: 0 }).pass).toBe(false);
    expect(run({ id: "l", description: "", reading: "n", op: "number-lte", expected: 5 }).pass).toBe(true);
    expect(run({ id: "l", description: "", reading: "n", op: "number-lte", expected: 4 }).pass).toBe(false);
  });

  it("includes / length-eq operate on arrays", () => {
    expect(run({ id: "i", description: "", reading: "arr", op: "includes", expected: 2 }).pass).toBe(true);
    expect(run({ id: "i", description: "", reading: "arr", op: "includes", expected: 9 }).pass).toBe(false);
    expect(run({ id: "i", description: "", reading: "s", op: "includes", expected: "h" }).pass).toBe(false);
    expect(run({ id: "L", description: "", reading: "arr", op: "length-eq", expected: 3 }).pass).toBe(true);
    expect(run({ id: "L", description: "", reading: "arr", op: "length-eq", expected: 2 }).pass).toBe(false);
  });

  it("is-null / not-null", () => {
    expect(run({ id: "z", description: "", reading: "nil", op: "is-null" }).pass).toBe(true);
    expect(run({ id: "z", description: "", reading: "n", op: "is-null" }).pass).toBe(false);
    expect(run({ id: "z", description: "", reading: "n", op: "not-null" }).pass).toBe(true);
    expect(run({ id: "z", description: "", reading: "nil", op: "not-null" }).pass).toBe(false);
  });

  it("a reading that was never recorded is <missing-reading> and never passes", () => {
    const o = run({ id: "m", description: "", reading: "nope", op: "not-null" });
    expect(o.pass).toBe(false);
    expect(o.actual).toBe("<missing-reading>");
  });
});

describe("journey report form", () => {
  it("toJourneyReport double-digests the outcome and preserves content", () => {
    const outcome = {
      journeyId: "j",
      persona: "field-technician",
      capability: "enrollment",
      goal: "g",
      steps: [],
      assertions: [],
      passed: true,
      handoff: null,
      digest: "deadbeef",
    } as never;
    const report = toJourneyReport(outcome);
    expect(report.journeyId).toBe("j");
    expect(report.reportDigest).toMatch(/^[0-9a-f]{8}$/);
    expect(report.reportDigest).not.toBe(report.digest);
  });

  it("verifyJourneyOutcome detects content changes under the digest", () => {
    const base: Omit<import("../src/journey-contracts.js").JourneyOutcome, "digest"> = {
      journeyId: "j", persona: "field-technician", capability: "enrollment", goal: "g",
      steps: [], assertions: [], passed: true, handoff: null,
    };
    const digest = journeyOutcomeDigest(base);
    expect(verifyJourneyOutcome({ ...base, digest })).toBe(true);
    expect(verifyJourneyOutcome({ ...base, digest, goal: "tampered" })).toBe(false);
  });
});

describe("mission-replay structural mirror — resume policy", () => {
  const stageIds = ["stage-1", "stage-2", "stage-3", "stage-4"];

  function suspendedJournal() {
    let journal = makeMirrorJournal({
      missionId: "msn_t",
      definitionId: "def_t",
      tenantId: "tnt_field-accept-01",
      stageIds,
    });
    journal = appendMirrorEntries(journal, [
      { at: 1, event: { kind: "mission-created" } },
      { at: 2, event: { kind: "mission-started" } },
    ]);
    for (const stageId of ["stage-1", "stage-2"]) {
      journal = appendMirrorEntries(journal, [
        { at: 3, event: { kind: "work-order-issued", stageId, commandId: `cmd_${stageId}`, idempotencyKey: mirrorWorkOrderIdempotencyKey("msn_t", stageId), attempt: 1 } },
        { at: 4, event: { kind: "stage-started", stageId } },
        { at: 5, event: { kind: "checkpoint-recorded", stageId, checkpointId: `cp-${stageId}` } },
        { at: 6, event: { kind: "stage-completed", stageId } },
      ]);
    }
    journal = appendMirrorEntries(journal, [{ at: 7, event: { kind: "mission-suspended" } }]);
    return journal;
  }

  it("the journal digest verifies and survives appends", () => {
    const journal = suspendedJournal();
    expect(verifyMirrorJournal(journal)).toBe(true);
    const extended = appendMirrorEntries(journal, [{ at: 8, event: { kind: "mission-resumed" } }]);
    expect(verifyMirrorJournal(extended)).toBe(true);
    expect(extended.entries.length).toBe(journal.entries.length + 1);
  });

  it("the fold reads the suspended state with per-stage work orders", () => {
    const view = foldMirrorMission(suspendedJournal());
    expect(view.state).toBe("suspended");
    expect(view.stages.map((s) => s.state)).toEqual(["completed", "completed", "pending", "pending"]);
    expect(view.stages.map((s) => s.workOrders.length)).toEqual([1, 1, 0, 0]);
    expect(view.lastCheckpoint?.stageId).toBe("stage-2");
    expect(view.journalLength).toBe(11); // created + started + 4 events x 2 stages + suspended
  });

  it("RESUME re-issues ONLY incomplete stages, with the SAME idempotency keys", () => {
    const journal = suspendedJournal();
    const r = resumeMirrorMission({
      journal,
      at: 100,
      commandIds: { "stage-3": "cmd_3b", "stage-4": "cmd_4b" },
    });
    expect(r.reissuedStages).toEqual(["stage-3", "stage-4"]);
    expect(r.skippedStages).toEqual(["stage-1", "stage-2"]);
    for (const stageId of ["stage-3", "stage-4"]) {
      expect(r.journal.entries.some(
        (e) => e.event.kind === "work-order-issued" && e.event.stageId === stageId &&
          e.event.idempotencyKey === mirrorWorkOrderIdempotencyKey("msn_t", stageId),
      )).toBe(true);
    }
    expect(verifyMirrorJournal(r.journal)).toBe(true);
  });

  it("NO completed stage receives a second work order after resume", () => {
    const journal = suspendedJournal();
    const r = resumeMirrorMission({ journal, at: 100, commandIds: {} });
    const after = foldMirrorMission(r.journal);
    expect(after.stages.map((s) => s.workOrders.length)).toEqual([1, 1, 1, 1]);
    expect(after.state).toBe("running");
    const completed = appendMirrorEntries(r.journal, [
      { at: 101, event: { kind: "stage-completed", stageId: "stage-3" } },
      { at: 102, event: { kind: "stage-completed", stageId: "stage-4" } },
      { at: 103, event: { kind: "mission-completed" } },
    ]);
    const final = foldMirrorMission(completed);
    expect(final.state).toBe("completed");
    expect(final.stages.map((s) => s.state)).toEqual(["completed", "completed", "completed", "completed"]);
    expect(final.stages.map((s) => s.workOrders.length)).toEqual([1, 1, 1, 1]);
  });

  it("resuming a NON-suspended mission is a no-op (idempotent)", () => {
    const journal = suspendedJournal();
    const r = resumeMirrorMission({ journal, at: 100, commandIds: {} });
    const again = resumeMirrorMission({ journal: r.journal, at: 200, commandIds: {} });
    expect(again.reissuedStages).toEqual([]);
    expect(again.journal).toBe(r.journal);
  });

  it("work-order idempotency keys follow the wo:mission:stage convention", () => {
    expect(mirrorWorkOrderIdempotencyKey("msn_t", "stage-3")).toBe("wo:msn_t:stage-3");
  });
});
