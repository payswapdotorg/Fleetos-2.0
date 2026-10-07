/**
 * F241 Control Tower test fixtures — deterministic, REAL-implementation
 * bindings only. Logical `now`, fixed tenants, no clock, no randomness.
 *
 * Domain record shapes are TYPE-EXTRACTED from the composed packages' own
 * builder signatures (Parameters<...>) so the fixtures satisfy the lanes'
 * real input contracts without deep-path imports.
 */

import { makeTenantContext, type TenantContext } from "@fleetos/kernel";
import { CommandQueue, queueAsSubmitPort } from "@fleetos/control-plane";
import {
  InMemoryMissionOutbox,
  MissionJournal,
  MissionRuntime,
  MissionStore,
  validateMissionDefinition,
  type MissionJournalEntry,
  type ValidatedMissionDefinition,
} from "@fleetos/mission";
import type { ExperienceStateSlice } from "@fleetos/experience-asset-field";
import {
  buildFindingViews,
  buildPredictionAdvisoryCard,
  type AdvisoryCardView,
} from "@fleetos/experience-safety-intel";
import { buildWorkBoard } from "@fleetos/experience-work-commerce";

export const TENANT = "tnt_f241tower01";
export const TENANT_B = "tnt_other99x";
export const ACTOR = "act_towerop001";
export const SESSION = "sess_abcdef0123456789";
export const NOW = 1_700_000_000_000;
export const DAY_MS = 86_400_000;

export function ctxFor(tenant: string = TENANT, actor: string = ACTOR): TenantContext {
  const made = makeTenantContext({
    tenantId: tenant,
    actorId: actor,
    sessionId: SESSION,
    establishedAt: NOW,
  });
  if (!made.ok) throw new Error(`fixture ctx refused: ${made.reason}`);
  return made.context;
}

// ---------------------------------------------------------------------------
// Lane A fixture — an ExperienceStateSlice the real guard accepts
// ---------------------------------------------------------------------------

type AssetId = ExperienceStateSlice["assets"][number]["id"];
type DeviceId = ExperienceStateSlice["devices"][number]["id"];
type PlanId = ExperienceStateSlice["plans"][number]["id"];

export function makeAssetFieldState(tenant: string = TENANT): ExperienceStateSlice {
  return {
    tenantId: tenant,
    assets: [
      {
        id: "ast_towercrane" as AssetId,
        tenantId: tenant,
        kind: "vehicle",
        displayName: "Tower Crane 3",
        lifecycle: "active",
        createdAt: NOW - 90 * DAY_MS,
      },
      {
        id: "ast_genset01" as AssetId,
        tenantId: tenant,
        kind: "fixed",
        displayName: "Generator Set 1",
        lifecycle: "active",
        createdAt: NOW - 30 * DAY_MS,
      },
    ],
    devices: [
      {
        id: "dev_crane03" as DeviceId,
        tenantId: tenant,
        assetId: "ast_towercrane" as AssetId,
        serial: "SN-TC-3",
        enrolledAt: NOW - 89 * DAY_MS,
      },
      {
        id: "dev_genset01" as DeviceId,
        tenantId: tenant,
        assetId: "ast_genset01" as AssetId,
        serial: "SN-GS-1",
        enrolledAt: NOW - 29 * DAY_MS,
      },
    ],
    twins: [
      {
        deviceId: "dev_crane03" as DeviceId,
        tenantId: tenant,
        revisions: [
          {
            seq: 9 as never,
            observedAt: NOW - 10_000,
            appliedAt: NOW - 9_000,
            source: "observation",
            attributes: { load: 0.71, location: "site-A" },
          },
        ],
        lastSeq: 9 as never,
        lastObservedAt: NOW - 10_000,
      },
      {
        deviceId: "dev_genset01" as DeviceId,
        tenantId: tenant,
        revisions: [
          {
            seq: 4 as never,
            observedAt: NOW - 20_000,
            appliedAt: NOW - 19_000,
            source: "observation",
            attributes: { fuel: 0.55 },
          },
        ],
        lastSeq: 4 as never,
        lastObservedAt: NOW - 20_000,
      },
    ],
    observations: [
      {
        id: `obs_crane03_9` as never,
        tenantId: tenant,
        deviceId: "dev_crane03" as DeviceId,
        seq: 9 as never,
        observedAt: NOW - 10_000,
        kind: "telemetry.ok",
        payloadDigest: "d".padEnd(64, "0"),
        admittedAt: NOW - 9_000,
      },
      {
        id: `obs_genset01_4` as never,
        tenantId: tenant,
        deviceId: "dev_genset01" as DeviceId,
        seq: 4 as never,
        observedAt: NOW - 20_000,
        kind: "telemetry.ok",
        payloadDigest: "e".padEnd(64, "0"),
        admittedAt: NOW - 19_000,
      },
    ],
    findings: [
      {
        deviceId: "dev_crane03" as DeviceId,
        code: "load.limit.exceeded",
        severity: "critical",
        observedAt: NOW - 5_000,
        evidence: [{ digest: "f1".padEnd(64, "0"), kind: "load.limit.exceeded", observedAt: NOW - 5_000 }],
      },
      {
        deviceId: "dev_genset01" as DeviceId,
        code: "fuel.low.warn",
        severity: "warning",
        observedAt: NOW - 15_000,
        evidence: [{ digest: "f2".padEnd(64, "0"), kind: "fuel.low.warn", observedAt: NOW - 15_000 }],
      },
    ],
    recoveryCases: [
      {
        id: "rc_crane01" as never,
        tenantId: tenant,
        deviceId: "dev_crane03" as DeviceId,
        state: "investigating",
        openedAt: NOW - 3_600_000,
        evidence: [{ digest: "r1".padEnd(64, "0") }],
        history: [{ from: "open", to: "investigating", command: "investigate", at: NOW - 3_000_000 }],
      },
    ],
    plans: [
      {
        id: "plan_crane_svc" as PlanId,
        tenantId: tenant,
        assetId: "ast_towercrane" as AssetId,
        kind: "preventive",
        schedule: { kind: "recurring", intervalMs: DAY_MS, startsAt: NOW - 5 * DAY_MS },
        createdAt: NOW - 80 * DAY_MS,
      },
    ],
    orders: [
      {
        id: "mo_crane_q1" as never,
        tenantId: tenant,
        planId: "plan_crane_svc" as PlanId,
        state: "scheduled",
        createdAt: NOW - 100_000,
        assignedTo: "crew-1",
      },
    ],
    connectivity: [
      { tenantId: tenant, deviceId: "dev_crane03" as DeviceId, state: "online", observedAt: NOW - 5_000 },
      { tenantId: tenant, deviceId: "dev_genset01" as DeviceId, state: "online", observedAt: NOW - 15_000 },
    ],
  };
}

// ---------------------------------------------------------------------------
// Lane B + C fixtures — record shapes extracted from the real builders
// ---------------------------------------------------------------------------

export type FindingRecord = Parameters<typeof buildFindingViews>[0]["findings"][number];
export type RemediationRecord = Parameters<typeof buildFindingViews>[0]["remediations"][number];
export type WorkItemRecord = Parameters<typeof buildWorkBoard>[0]["workItems"][number];

export function makeFinding(
  over: Partial<FindingRecord> = {},
): FindingRecord {
  return {
    findingId: "sf-001",
    tenantId: TENANT,
    kind: "device.firmware_outdated",
    severity: "critical",
    confidence: "confirmed",
    detectedAt: "2026-10-01T00:00:00.000Z",
    assetIds: ["ast_towercrane"],
    description: "crane controller firmware outdated",
    evidenceRefs: ["ev-1"],
    findingDigest: "sd1",
    ...over,
  };
}

export function makeRemediation(
  over: Partial<RemediationRecord> = {},
): RemediationRecord {
  return {
    proposalId: "rem-001",
    tenantId: TENANT,
    findingIds: ["sf-001"],
    remediationKind: "patch",
    state: "proposed",
    approvalRef: null,
    verificationEvidenceRef: null,
    verificationOutcome: null,
    transitions: [],
    lastTransitionAt: 100,
    ...over,
  };
}

export function makeWorkItem(
  value: string,
  status: WorkItemRecord["status"],
  over: Partial<WorkItemRecord> = {},
): WorkItemRecord {
  return {
    id: { kind: "work-item", value },
    tenant: { tenantId: TENANT },
    title: `title-${value}`,
    assignee: { assigneeId: `agent-${value}`, assignedAt: "2026-01-01T00:00:00Z" },
    assignmentHistory: [],
    deadline: null,
    status,
    blockedReason: null,
    missionRef: null,
    workflowRef: null,
    projectId: null,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Advisory cards — built by the REAL lane-B builder
// ---------------------------------------------------------------------------

type PredictionInput = Parameters<typeof buildPredictionAdvisoryCard>[0]["prediction"];
type StalenessThresholds = Parameters<typeof buildPredictionAdvisoryCard>[0]["thresholds"];

export const THRESHOLDS: StalenessThresholds = { freshWithinMs: 60_000, staleWithinMs: 600_000 };

export function makeAdvisoryCards(tenant: string = TENANT): readonly AdvisoryCardView[] {
  const prediction: PredictionInput = {
    kind: "PREDICTION",
    advisory: true,
    tenant: { tenantId: tenant },
    asset: { assetId: "ast_towercrane" },
    metric: "load",
    originMs: NOW - 10_000,
    horizon: { steps: 3, stepMs: 1_000 },
    points: [
      { step: 1, atMs: NOW - 9_000, value: 0.72, bounds: { lower: 0.7, upper: 0.74 }, confidenceBps: 8000 },
      { step: 2, atMs: NOW - 8_000, value: 0.73, bounds: { lower: 0.7, upper: 0.76 }, confidenceBps: 7500 },
      { step: 3, atMs: NOW - 7_000, value: 0.74, bounds: { lower: 0.69, upper: 0.79 }, confidenceBps: 7000 },
    ],
    provenance: {
      modelVersion: "ref-1.0.0",
      method: "reference.linear-drift",
      observationRefs: ["obs_crane03_9"],
      inputDigest: "id1".padEnd(8, "0"),
    },
  };
  const built = buildPredictionAdvisoryCard({ prediction, nowMs: NOW, thresholds: THRESHOLDS });
  if (!built.ok) throw new Error(`advisory card refused: ${built.refused} ${built.detail}`);
  return [built.card];
}

// ---------------------------------------------------------------------------
// The tower state fixture
// ---------------------------------------------------------------------------

export function makeTowerState(tenant: string = TENANT) {
  return {
    tenantId: tenant,
    assetField: makeAssetFieldState(tenant),
    safety: {
      findings: [
        makeFinding(),
        makeFinding({ findingId: "sf-002", severity: "high", confidence: "probable", kind: "network.open_ingress" }),
        makeFinding({ findingId: "sf-003", severity: "low", confidence: "tentative", kind: "device.unmanaged" }),
      ],
      remediations: [makeRemediation()],
    },
    work: {
      workItems: [
        makeWorkItem("w-101", "in_progress"),
        makeWorkItem("w-102", "blocked", { blockedReason: "waiting on vendor" }),
        makeWorkItem("w-103", "todo"),
      ],
      computedAt: "2026-10-01T00:00:00.000Z",
    },
    advisoryCards: makeAdvisoryCards(tenant),
  };
}

// ---------------------------------------------------------------------------
// Mission journal fixture — the REAL runtime over the REAL queue seam
// ---------------------------------------------------------------------------

export const TOWER_MISSION_DEFINITION = {
  id: "def_tower_demo",
  stages: [
    { id: "ingest", parallelGroup: "phase-1" },
    { id: "analyze", parallelGroup: "phase-1" },
    { id: "report", dependsOn: ["ingest", "analyze"] },
  ],
};

export interface MissionJournalFixture {
  readonly definition: ValidatedMissionDefinition;
  readonly missionId: string;
  readonly entries: readonly MissionJournalEntry[];
}

/**
 * Drives the REAL MissionRuntime (MissionStore + InMemoryMissionOutbox +
 * queueAsSubmitPort over a REAL CommandQueue) through create → start →
 * checkpoint → suspend, and returns the committed journal entries.
 */
export function makeMissionJournal(
  tenant: string = TENANT,
  missionId: string = "msn_tower0001",
): MissionJournalFixture {
  const validated = validateMissionDefinition({ definition: TOWER_MISSION_DEFINITION });
  if (!validated.ok) throw new Error(`definition refused: ${validated.reason}`);
  const store = new MissionStore();
  const outbox = new InMemoryMissionOutbox({ stores: store.stores });
  const queue = new CommandQueue();
  const runtime = new MissionRuntime({
    store,
    outbox,
    commandSubmit: queueAsSubmitPort(queue),
  });
  const ctx = ctxFor(tenant);
  const t0 = NOW;
  const created = runtime.createMission({ ctx, definition: TOWER_MISSION_DEFINITION, missionId, now: t0 });
  if (!created.ok) throw new Error(`create refused: ${created.reason}`);
  const started = runtime.startMission({ ctx, missionId, now: t0 + 1_000 });
  if (!started.ok) throw new Error(`start refused: ${started.reason}`);
  const checkpointed = runtime.recordCheckpoint({
    ctx,
    missionId,
    stageId: "ingest",
    checkpointId: "cp-1",
    now: t0 + 2_000,
  });
  if (!checkpointed.ok) throw new Error(`checkpoint refused: ${checkpointed.reason}`);
  const suspended = runtime.suspendMission({ ctx, missionId, reason: "operator pause", now: t0 + 3_000 });
  if (!suspended.ok) throw new Error(`suspend refused: ${suspended.reason}`);
  const journal = new MissionJournal(store);
  const entries = journal.committedEntries(ctx, missionId);
  return { definition: validated.value, missionId, entries };
}
