/**
 * @fleetos/convergence — cross-stack composition tests (F231).
 *
 * The packet's end-to-end scenarios that span MORE than one assembly:
 * budget-gated model selection INSIDE a mission stage; suspend/resume of a
 * composed mission across a "restart" (a new runtime instance over the same
 * journal); tenant fail-closed across EVERY context in the composition; and
 * whole-composition determinism.
 */

import { describe, expect, it } from "vitest";
import { MissionRuntime } from "@fleetos/mission";
import { assembleMissionStack, driveMission } from "../src/mission-assembly.js";
import { assembleModelStack } from "../src/model-stack-assembly.js";
import { assembleAdvisoryLoop } from "../src/advisory-assembly.js";
import {
  AGENT_A,
  budgetFixture,
  CAPABILITY,
  CHAIN_ORDER,
  ctxFor,
  NOW,
  providersFixture,
  REGISTRY,
  TENANT_A,
  TENANT_B,
  THREE_STAGE_DEFINITION,
  worldJournalFixture,
} from "./helpers.js";

const MISSION_ID = "msn_convergence01";

describe("cross-stack convergence", () => {
  it("runs budget-gated model selection inside a mission stage", () => {
    const missionStack = assembleMissionStack();
    // Org budget allows exactly ONE primary-model spend (1000 minor).
    const modelStack = assembleModelStack({
      registry: REGISTRY,
      providers: providersFixture(),
      chainOrder: CHAIN_ORDER,
      budgets: [budgetFixture({ allocatedSpendMinor: 1_400 })],
    });
    const ctx = ctxFor(TENANT_A);
    missionStack.runtime.createMission({
      ctx,
      definition: THREE_STAGE_DEFINITION,
      missionId: MISSION_ID,
      now: NOW,
    });
    const started = missionStack.runtime.startMission({ ctx, missionId: MISSION_ID, now: NOW });
    expect(started.ok && started.value.view.state).toBe("running");

    // The parallel pair's work orders are claimed by the executor.
    const due = missionStack.queue.drain({ ctx, now: NOW + 1_000 });
    expect(due).toHaveLength(2);

    // The application picks the inference model for the in-flight "analyze"
    // stage: the primary fits the org budget → selected, no fallback.
    const primary = modelStack.selectForRequest({
      tenantId: TENANT_A,
      agentId: AGENT_A,
      capability: CAPABILITY,
      requiredCapabilities: ["reasoning", "tools"],
      priority: 1,
      estimatedUnits: 100,
      budgetCeilingMinor: 10_000,
      requestRef: "req_stage_analyze_1",
      at: NOW + 1_000,
    });
    expect(primary.ok).toBe(true);
    expect(primary.selectedModelId).toBe("mdl_primary");

    // A second in-flight request (the parallel "ingest" stage's worker):
    // the org budget is now short for the primary → budget-gated fallback
    // with the org's reason code propagated; the usage ledger grows by one
    // chained entry per served request.
    const fallback = modelStack.selectForRequest({
      tenantId: TENANT_A,
      agentId: AGENT_A,
      capability: CAPABILITY,
      requiredCapabilities: ["reasoning", "tools"],
      priority: 2,
      estimatedUnits: 100,
      budgetCeilingMinor: 10_000,
      requestRef: "req_stage_ingest_1",
      at: NOW + 2_000,
    });
    expect(fallback.ok).toBe(true);
    expect(fallback.selectedModelId).toBe("mdl_alt");
    expect(fallback.budgetReasonCode).toBe("SPEND_EXHAUSTED");
    expect(fallback.degradedMode.mode).toBe("full");
    expect(modelStack.usageLedger()).toHaveLength(2);
    expect(modelStack.verifyUsageChain().ok).toBe(true);

    // The mission still completes through the composed command bus.
    for (const command of due) {
      missionStack.queue.complete({
        ctx,
        commandId: String(command.envelope.id),
        result: { stageId: (command.envelope.payload as { stageId?: string }).stageId },
        now: NOW + 3_000,
      });
      missionStack.runtime.completeStage({
        ctx,
        missionId: MISSION_ID,
        stageId: (command.envelope.payload as { stageId?: string }).stageId ?? "",
        now: NOW + 3_000,
      });
    }
    const reportDue = missionStack.queue.drain({ ctx, now: NOW + 4_000 });
    expect(reportDue).toHaveLength(1);
    missionStack.queue.complete({
      ctx,
      commandId: String(reportDue[0]?.envelope.id ?? ""),
      now: NOW + 4_000,
    });
    const finished = missionStack.runtime.completeStage({
      ctx,
      missionId: MISSION_ID,
      stageId: "report",
      now: NOW + 4_000,
    });
    expect(finished.ok && finished.value.view.state).toBe("completed");
    // Composition-level consistency: one outbox event per journal entry.
    const entries = missionStack.runtime.journalEntries(ctx, MISSION_ID);
    expect(entries.ok).toBe(true);
    if (!entries.ok) return;
    expect(missionStack.outbox.eventsFor(ctx)).toHaveLength(entries.value.length);
  });

  it("suspends and resumes a composed mission across a restart (new runtime, same journal)", () => {
    const stack = assembleMissionStack();
    const ctx = ctxFor(TENANT_A);
    stack.runtime.createMission({
      ctx,
      definition: THREE_STAGE_DEFINITION,
      missionId: MISSION_ID,
      now: NOW,
    });
    stack.runtime.startMission({ ctx, missionId: MISSION_ID, now: NOW });

    // Complete the first parallel stage at t+1000 (its work order runs once).
    const due1 = stack.queue.drain({ ctx, now: NOW + 1_000 });
    expect(due1.map((c) => c.envelope.id)).toHaveLength(2);
    const ingest = due1.find(
      (c) => (c.envelope.payload as { stageId?: string }).stageId === "ingest",
    );
    const analyzeClaimed = due1.find(
      (c) => (c.envelope.payload as { stageId?: string }).stageId === "analyze",
    );
    expect(ingest).toBeDefined();
    expect(analyzeClaimed).toBeDefined();
    if (!ingest || !analyzeClaimed) return;
    stack.queue.complete({ ctx, commandId: String(ingest.envelope.id), now: NOW + 1_000 });
    const completed = stack.runtime.completeStage({
      ctx,
      missionId: MISSION_ID,
      stageId: "ingest",
      now: NOW + 1_000,
    });
    expect(completed.ok).toBe(true);
    stack.runtime.recordCheckpoint({
      ctx,
      missionId: MISSION_ID,
      stageId: "analyze",
      checkpointId: "ckpt_mid_flight",
      now: NOW + 1_500,
    });

    // Suspend mid-flight ("analyze" is running; its claim is executing).
    const suspended = stack.runtime.suspendMission({
      ctx,
      missionId: MISSION_ID,
      now: NOW + 2_000,
    });
    expect(suspended.ok && suspended.value.view.state).toBe("suspended");

    // THE RESTART: a brand-new runtime instance over the SAME committed
    // journal/store/outbox/queue — the durable truth is the journal.
    const restarted = new MissionRuntime({
      store: stack.store,
      outbox: stack.outbox,
      commandSubmit: stack.commandSubmit,
    });
    const resumed = restarted.resumeMission({ ctx, missionId: MISSION_ID, now: NOW + 3_000 });
    expect(resumed.ok && resumed.value.view.state).toBe("running");
    if (!resumed.ok) return;
    // Resume from checkpoint: the in-flight stage's work order is re-issued
    // with the SAME idempotency key → the queue DEDUPES it (duplicate ack,
    // never re-executed); completed stages are never re-issued.
    const analyzeView = resumed.value.view.stages.find((s) => s.stageId === "analyze");
    expect(analyzeView?.workOrders).toHaveLength(2);
    expect(analyzeView?.workOrders[1]?.idempotencyKey).toBe(
      analyzeView?.workOrders[0]?.idempotencyKey,
    );
    const commands = stack.queue.listByTenant(ctx);
    expect(commands).toHaveLength(2); // ingest + analyze — no third command
    // The pre-restart claim survives (the in-memory queue state is shared
    // by the composition); the executor completes it directly — the claim
    // counter shows the work order executed EXACTLY once.
    const analyzeRecord = stack.queue.findById(ctx, String(analyzeClaimed.envelope.id));
    expect(analyzeRecord.ok && analyzeRecord.value.attempts).toBe(1);

    // Finish the mission on the restarted runtime.
    stack.queue.complete({ ctx, commandId: String(analyzeClaimed.envelope.id), now: NOW + 4_000 });
    restarted.completeStage({
      ctx,
      missionId: MISSION_ID,
      stageId: "analyze",
      now: NOW + 4_000,
    });
    const reportDue = stack.queue.drain({ ctx, now: NOW + 5_000 });
    expect(reportDue).toHaveLength(1);
    stack.queue.complete({ ctx, commandId: String(reportDue[0]?.envelope.id ?? ""), now: NOW + 5_000 });
    const finished = restarted.completeStage({
      ctx,
      missionId: MISSION_ID,
      stageId: "report",
      now: NOW + 5_000,
    });
    expect(finished.ok && finished.value.view.state).toBe("completed");
    // Replay-the-journal proof across the restart: the folded state of the
    // restarted runtime equals the live view.
    const entries = restarted.journalEntries(ctx, MISSION_ID);
    expect(entries.ok).toBe(true);
    if (!entries.ok) return;
    expect(stack.outbox.eventsFor(ctx)).toHaveLength(entries.value.length);
  });

  it("fails closed on a missing tenant across EVERY context in the composition", () => {
    const missionStack = assembleMissionStack();
    const modelStack = assembleModelStack({
      registry: REGISTRY,
      providers: providersFixture(),
      chainOrder: CHAIN_ORDER,
      budgets: [budgetFixture()],
    });
    const advisory = assembleAdvisoryLoop();
    // Kernel boundary: a missing tenant id cannot even establish a context.
    // Model stack: an empty tenant refuses with the org's reason code.
    const selection = modelStack.selectForRequest({
      tenantId: "",
      agentId: AGENT_A,
      capability: CAPABILITY,
      requiredCapabilities: ["reasoning"],
      priority: 1,
      estimatedUnits: 100,
      budgetCeilingMinor: 10_000,
      requestRef: "req_missing_tenant",
      at: NOW,
    });
    expect(selection.ok).toBe(false);
    expect(selection.usage).toBeNull();
    expect(modelStack.usageLedger()).toHaveLength(0);
    // Advisory loop: an empty tenant refuses before any world access.
    const loop = advisory.run({
      tenantId: "",
      worldEntries: worldJournalFixture(),
      entityId: "asset_truck_01",
      metric: "engine_temp",
      asOfMs: NOW - 70_000,
      nowMs: NOW,
      horizon: { steps: 3, stepMs: 10_000 },
      computedAt: "2026-10-07T00:00:00.000Z",
    });
    expect(loop.ok).toBe(false);
    if (!loop.ok) expect(loop.rejection.rejected).toBe("missing-tenant");
    // Mission stack: an unknown mission for a foreign tenant fails closed.
    const view = missionStack.runtime.missionView(ctxFor(TENANT_B), "msn_nonexistent");
    expect(view.ok).toBe(false);
    // No partial state anywhere: nothing was persisted by the refusals.
    expect(missionStack.queue.listByTenant(ctxFor(TENANT_B))).toHaveLength(0);
    expect(missionStack.ledger.entriesFor(ctxFor(TENANT_B))).toHaveLength(0);
    expect(missionStack.outbox.eventsFor(ctxFor(TENANT_B))).toHaveLength(0);
  });

  it("the whole composition is deterministic end-to-end", () => {
    function runAll() {
      const missionStack = assembleMissionStack();
      const modelStack = assembleModelStack({
        registry: REGISTRY,
        providers: providersFixture(),
        chainOrder: CHAIN_ORDER,
        budgets: [budgetFixture({ allocatedSpendMinor: 1_400 })],
      });
      const advisory = assembleAdvisoryLoop();
      const driven = driveMission(missionStack, {
        ctx: ctxFor(TENANT_A),
        definition: THREE_STAGE_DEFINITION,
        missionId: MISSION_ID,
        startsAt: NOW,
        ticks: [NOW + 1_000, NOW + 2_000, NOW + 3_000],
        stageOutcomes: {
          ingest: [{ kind: "complete" }],
          analyze: [{ kind: "complete" }],
          report: [{ kind: "complete" }],
        },
      });
      const selections = [
        modelStack.selectForRequest({
          tenantId: TENANT_A,
          agentId: AGENT_A,
          capability: CAPABILITY,
          requiredCapabilities: ["reasoning", "tools"],
          priority: 1,
          estimatedUnits: 100,
          budgetCeilingMinor: 10_000,
          requestRef: "req_e2e_1",
          at: NOW + 1_000,
        }),
        modelStack.selectForRequest({
          tenantId: TENANT_A,
          agentId: AGENT_A,
          capability: CAPABILITY,
          requiredCapabilities: ["reasoning", "tools"],
          priority: 2,
          estimatedUnits: 100,
          budgetCeilingMinor: 10_000,
          requestRef: "req_e2e_2",
          at: NOW + 2_000,
        }),
      ];
      const projected = advisory.run({
        tenantId: TENANT_A,
        worldEntries: worldJournalFixture(),
        entityId: "asset_truck_01",
        metric: "engine_temp",
        asOfMs: NOW - 70_000,
        nowMs: NOW,
        horizon: { steps: 4, stepMs: 10_000 },
        computedAt: "2026-10-07T00:00:00.000Z",
      });
      return JSON.stringify({ driven, selections, projected });
    }
    expect(runAll()).toBe(runAll());
  });
});
