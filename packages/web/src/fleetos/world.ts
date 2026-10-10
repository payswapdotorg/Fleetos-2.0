/**
 * FleetOS application world — the TL's composed real state (F301).
 *
 * Composes the REAL public APIs of the three lanes into a deterministic,
 * in-browser demo world: two tenants; real assets/devices/enrollments via
 * @fleetos/assets; real observation ingestion via the @fleetos/observations
 * pipeline; real health triage; real security posture via @fleetos/security;
 * real work items via @fleetos/work.
 *
 * HONESTY: this is a DEMO COMPOSITION (deterministic logical time T0, fixed
 * fixture inputs — the acceptance-suite convention). Every VIEW rendered by
 * the shell is a REAL output of the REAL packages. No second business-truth
 * store: state lives in the lane packages' own in-memory directories.
 */

import {
  AssetDirectory,
  InMemoryAssetRepository,
  EnrollmentDirectory,
  InMemoryEnrollmentRegistry,
  admitTwinRevision,
  type Device,
  type DeviceTwin,
} from "@fleetos/assets";
import {
  runPipeline,
  emptyAdmissionStore,
  emptyStageMetrics,
  type AdmissionStore,
  type StageMetrics,
  type Observation,
} from "@fleetos/observations";
import { triage, type Finding } from "@fleetos/health";
import {
  computePosture,
  type SecurityFinding,
  type RemediationProposalRecord,
  type SecuritySeverity,
} from "@fleetos/security";
import type { ExperienceStateSlice } from "@fleetos/experience-asset-field";
import { runWorld, type FleetWorld, type WorldEvent } from "@fleetos/sim-worlds";

export const T0 = 1_774_000_000_000;

export interface DemoTenant {
  readonly id: string;
  readonly name: string;
  readonly actors: readonly { readonly id: string; readonly name: string; readonly role: string }[];
}

export const TENANTS: readonly DemoTenant[] = [
  {
    id: "tnt_acme-logistics",
    name: "Acme Logistics",
    actors: [
      { id: "act_ada-operator", name: "Ada — Fleet Operator", role: "fleet-operator" },
      { id: "act_tom-technician", name: "Tom — Technician", role: "technician" },
    ],
  },
  {
    id: "tnt_meridian-health",
    name: "Meridian Health",
    actors: [
      { id: "act_maya-operator", name: "Maya — Fleet Operator", role: "fleet-operator" },
      { id: "act_ben-security", name: "Ben — Security Lead", role: "security-lead" },
    ],
  },
];

const ASSETS_ACME = [
  { assetId: "ast_acme-truck-01", assetKind: "vehicle", displayName: "Truck A-01" },
  { assetId: "ast_acme-trailer-02", assetKind: "vehicle", displayName: "Trailer T-02" },
  { assetId: "ast_acme-pump-03", assetKind: "fixed", displayName: "Depot Pump P-03" },
] as const;

const ASSETS_MERIDIAN = [
  { assetId: "ast_mer-fridge-01", assetKind: "sensor", displayName: "Cold Chain Monitor F-01" },
  { assetId: "ast_mer-van-02", assetKind: "vehicle", displayName: "Medical Van V-02" },
] as const;

const DEVICES_ACME = [
  { deviceId: "dev_acme-telem-1001", assetId: "ast_acme-truck-01", serial: "SN-ACME-1001" },
  { deviceId: "dev_acme-gate-2002", assetId: "ast_acme-trailer-02", serial: "SN-ACME-2002" },
  { deviceId: "dev_acme-flow-3003", assetId: "ast_acme-pump-03", serial: "SN-ACME-3003" },
] as const;

const DEVICES_MERIDIAN = [
  { deviceId: "dev_mer-temp-1001", assetId: "ast_mer-fridge-01", serial: "SN-MER-1001" },
  { deviceId: "dev_mer-gps-2002", assetId: "ast_mer-van-02", serial: "SN-MER-2002" },
] as const;

function encodePayload(payload: Readonly<Record<string, unknown>>): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(payload));
}

function securityFindingsFor(tenantId: string): SecurityFinding[] {
  const mk = (
    n: number,
    kind: SecurityFinding["kind"],
    severity: SecuritySeverity,
    assetIds: string[],
    description: string,
  ): SecurityFinding => ({
    findingId: `fnd_${tenantId.slice(4)}-${String(n).padStart(3, "0")}`,
    tenantId,
    kind,
    severity,
    confidence: "probable",
    detectedAt: new Date(T0).toISOString(),
    assetIds,
    description,
    evidenceRefs: [`evd_intake-${n}`],
    findingDigest: `digest-${tenantId}-${n}`,
  });
  if (tenantId === "tnt_acme-logistics") {
    return [
      mk(1, "device.compromised_indicator", "critical", ["ast_acme-truck-01"], "Telemetry key used from two sites simultaneously"),
      mk(2, "auth.weak_credential", "high", ["ast_acme-pump-03"], "Gateway credential older than policy window"),
    ];
  }
  return [
    mk(1, "device.firmware_outdated", "high", ["ast_mer-fridge-01"], "Cold-chain monitor firmware below hardened baseline"),
    mk(2, "evidence.chain_break", "medium", ["ast_mer-van-02"], "Van GPS audit trail has a 6-minute gap"),
  ];
}

function remediationsFor(tenantId: string, findings: SecurityFinding[]): RemediationProposalRecord[] {
  // Full RemediationProposalRecord (the tower consumes this shape): the
  // evidence-gated remediation lifecycle, "proposed" state — Guardian
  // approval refs are REQUIRED to reach "approved" and are null here.
  return findings.map((f, i) => ({
    proposalId: `prp_${tenantId.slice(4)}-${i + 1}`,
    tenantId,
    findingIds: [f.findingId],
    remediationKind: i === 0 ? ("rotate_credential" as const) : ("enforce_mfa" as const),
    state: "proposed" as const,
    approvalRef: null,
    verificationEvidenceRef: null,
    verificationOutcome: null,
    transitions: [],
    lastTransitionAt: T0,
  }));
}

export interface TenantWorld {
  readonly tenantId: string;
  readonly assets: readonly ReturnType<AssetDirectory["listAssets"]>[number][];
  readonly devices: readonly Device[];
  readonly twins: readonly DeviceTwin[];
  readonly observations: readonly Observation[];
  readonly healthFindings: readonly Finding[];
  readonly securityFindings: readonly SecurityFinding[];
  readonly remediations: readonly RemediationProposalRecord[];
  readonly posture: ReturnType<typeof computePosture>;
  readonly workBoardItems: readonly {
    readonly id: string;
    readonly tenant: string;
    readonly title: string;
    readonly state: string;
    readonly assignee: string;
  }[];
  readonly slice: ExperienceStateSlice;
}

export function buildTenantWorld(tenant: DemoTenant): TenantWorld {
  const assets = new AssetDirectory(new InMemoryAssetRepository());
  const enrollment = new EnrollmentDirectory(new InMemoryEnrollmentRegistry());
  let admission: AdmissionStore = emptyAdmissionStore();
  let metrics: StageMetrics = emptyStageMetrics();
  const devices: Device[] = [];
  const twins: DeviceTwin[] = [];
  const observations: Observation[] = [];

  const assetSpecs = tenant.id === "tnt_acme-logistics" ? ASSETS_ACME : ASSETS_MERIDIAN;
  const deviceSpecs = tenant.id === "tnt_acme-logistics" ? DEVICES_ACME : DEVICES_MERIDIAN;
  // noUncheckedIndexedAccess: the actor fixtures are non-empty by design;
  // made explicit — fail loudly rather than silently using a missing actor.
  const leadActor = tenant.actors[0];
  if (leadActor === undefined) throw new Error(`no actors configured for tenant ${tenant.id}`);
  const operator = leadActor.id;
  const secondActor = tenant.actors[1] ?? leadActor;
  const technician = secondActor.id;

  for (const [i, spec] of assetSpecs.entries()) {
    const r = assets.admitAsset({
      assetId: spec.assetId,
      tenantId: tenant.id,
      kind: spec.assetKind,
      displayName: spec.displayName,
      createdAt: T0 + i * 1_000,
      actor: operator,
    });
    if (!r.ok) throw new Error(`demo world admit refused: ${r.reason}`);
    const t = assets.transitionAsset({
      tenantId: tenant.id,
      assetId: spec.assetId as never,
      command: "activate",
      at: T0 + i * 1_000 + 100,
      actor: operator,
    });
    if (!t.ok) throw new Error(`demo world activate refused: ${t.reason}`);
  }

  for (const [i, spec] of deviceSpecs.entries()) {
    const e = enrollment.enroll({
      deviceId: spec.deviceId,
      tenantId: tenant.id,
      enrolledAt: T0 + 2_000 + i * 100,
      actor: technician,
    });
    if (!e.ok) throw new Error(`demo world enroll refused: ${e.reason}`);
    devices.push({
      id: spec.deviceId as never,
      tenantId: tenant.id,
      assetId: spec.assetId as never,
      serial: spec.serial,
      enrolledAt: e.enrollment.enrolledAt,
    });
    let current: DeviceTwin | null = null;
    const rev = admitTwinRevision(current, {
      deviceId: spec.deviceId as never,
      tenantId: tenant.id,
      seq: 1,
      observedAt: T0 + 3_000 + i * 100,
      appliedAt: T0 + 3_000 + i * 100,
      source: "manual",
      attributes: { site: "demo-site", commission: "T0" },
      actor: technician,
    });
    if (rev.ok) {
      twins.push(rev.twin);
      current = rev.twin;
    }
  }

  let seq = 0;
  for (const [i, d] of devices.entries()) {
    for (let k = 0; k < 3; k++) {
      seq += 1;
      const r = runPipeline(admission, metrics, {
        tenantId: tenant.id,
        deviceId: d.id as never,
        seq,
        observedAt: T0 + 4_000 + i * 300 + k * 100,
        kind: "telemetry.state",
        payload: encodePayload({ status: k === 2 ? "degraded" : "active" }),
        receivedAt: T0 + 4_000 + i * 300 + k * 100,
      });
      if (r.ok) {
        observations.push(r.observation);
        admission = r.store;
        metrics = r.metrics;
      }
    }
  }

  const healthFindings = triage(observations, T0 + 6_000).findings;
  const securityFindings = securityFindingsFor(tenant.id);
  const remediations = remediationsFor(tenant.id, securityFindings);
  const posture = computePosture(tenant.id, securityFindings);

  const workBoardItems = [
    { id: `wrk_${tenant.id.slice(4)}-001`, tenant: tenant.id, title: "Quarterly fleet inspection", state: "in_progress", assignee: technician },
    { id: `wrk_${tenant.id.slice(4)}-002`, tenant: tenant.id, title: "Depot pump recalibration", state: "open", assignee: operator },
  ];

  const slice: ExperienceStateSlice = {
    tenantId: tenant.id,
    assets: assets.listAssets(tenant.id as never),
    devices,
    twins,
    observations,
    findings: healthFindings,
    recoveryCases: [],
    plans: [],
    orders: [],
    connectivity: [],
  };

  return {
    tenantId: tenant.id,
    assets: assets.listAssets(tenant.id as never),
    devices,
    twins,
    observations,
    healthFindings,
    securityFindings,
    remediations,
    posture,
    workBoardItems,
    slice,
  };
}

export function buildWorld(): Map<string, TenantWorld> {
  const m = new Map<string, TenantWorld>();
  for (const t of TENANTS) m.set(t.id, buildTenantWorld(t));
  return m;
}

// ---------------------------------------------------------------------------
// Engineering Lab — a REAL deterministic simulation run (TL-owned surface).
// Experimental evidence only: outputs never self-execute, never adopt.
// ---------------------------------------------------------------------------

export const LAB_WORLD: FleetWorld = {
  worldId: "world_fleetos-lab-01",
  tenantId: "tnt_acme-logistics",
  version: 1,
  description: "FleetOS shell lab: two assets, jittered telemetry, fault stream.",
  seed: "fleetos-lab-seed-01",
  timeUnitMs: 1_000,
  healthPolicy: { downAfterSteps: 3, recoveryGraceSteps: 2 },
  assets: [
    { assetId: "ast_lab-alpha", assetClass: "pump", failureRateBps: 1 },
    { assetId: "ast_lab-beta", assetClass: "valve", failureRateBps: 1 },
  ],
  devices: [
    {
      deviceId: "dev_lab-flow-b2",
      assetId: "ast_lab-beta",
      dropoutBps: 1,
      emitEverySteps: 2,
      streams: [{ kind: "telemetry.flow", unit: "lpm", baseValue: 120, jitterMinOffset: -5, jitterMaxOffset: 5 }],
    },
    {
      deviceId: "dev_lab-thermo-a1",
      assetId: "ast_lab-alpha",
      dropoutBps: 1,
      emitEverySteps: 1,
      streams: [
        { kind: "telemetry.temp", unit: "C", baseValue: 40, jitterMinOffset: -2, jitterMaxOffset: 2 },
        { kind: "event.fault", unit: "code", baseValue: 7, jitterMinOffset: 0, jitterMaxOffset: 0 },
      ],
    },
  ],
  links: [{ linkId: "lnk_lab-a-b", endpoints: ["dev_lab-thermo-a1", "dev_lab-flow-b2"], uptimeBps: 9_999 }],
  maintenancePolicies: [
    {
      policyId: "pol_lab-alpha",
      assetId: "ast_lab-alpha",
      windowEverySteps: 12,
      windowLengthSteps: 2,
      serviceLevel: "standard",
      mtbfSteps: 24,
    },
  ],
  initialHealthPostures: [
    { assetId: "ast_lab-alpha", posture: "healthy" },
    { assetId: "ast_lab-beta", posture: "healthy" },
  ],
};

export interface LabRun {
  readonly ok: boolean;
  readonly step: number;
  readonly eventCount: number;
  readonly lastDigest: string;
  readonly events: readonly WorldEvent[];
}

export function runLab(steps: number): LabRun {
  const r = runWorld(LAB_WORLD, steps);
  if (!r.ok) {
    return { ok: false, step: 0, eventCount: 0, lastDigest: "", events: [] };
  }
  return {
    ok: true,
    step: r.state.step,
    eventCount: r.events.length,
    lastDigest: r.state.lastDigest,
    events: r.events,
  };
}
