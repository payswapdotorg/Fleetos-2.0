/**
 * The production release gate: all-green → READY over the REAL corpora;
 * each single degradation → NOT-READY with the NAMED blocker; tamper
 * detection on every gate input; tenant fail-closed; no partial readiness;
 * determinism.
 *
 * The acceptance baselines are the REAL reports assembled from the REAL
 * corpora (field 20 / security 17 / commerce 31 journeys + the F271 (Wave 11 converged: field 14→20 F300A, security 13→17 F300B, commerce 15→31 F300C+F310C;
 * adoption simulation, 30 workspaces) — run ONCE at module scope.
 */

import { describe, expect, it } from "vitest";
import {
  evaluateReleaseGate,
  verifyReleaseGateVerdict,
  type ReleaseBlocker,
  type ReleaseGateInput,
  type ReleaseGateVerdict,
} from "../src/release-gate.js";
import { assembleSystemStatus } from "../src/observability.js";
import { buildCostPosture } from "../src/cost.js";
import { byteIdentical } from "../src/digest.js";
import {
  TENANT,
  breachedSlaScorecard,
  breachBurnProjection,
  divergentOfflineReport,
  gappedAuditVerification,
  healthyAuditVerification,
  healthyBurnProjection,
  healthyLaneSignals,
  overCapAdmission,
  overCeilingCheck,
  warningBurnProjection,
  withinCeilingCheck,
} from "./fixtures.js";
import {
  assembleAcceptanceReport as assembleFieldReport,
  digestOf as fieldDigestOf,
  type AcceptanceReport as FieldAcceptanceReport,
} from "@fleetos/acceptance-field";
import { FIELD_JOURNEYS } from "@fleetos/acceptance-field/journeys";
import {
  acceptanceReportDigest as securityDigestOf,
  assembleAcceptanceReport as assembleSecurityReport,
  runAllJourneys as runAllSecurityJourneys,
  type AcceptanceReport as SecurityAcceptanceReport,
} from "@fleetos/acceptance-security";
import { SECURITY_JOURNEYS } from "@fleetos/acceptance-security/journeys";
import {
  assembleJourneyReport as assembleCommerceReport,
  runAllJourneys as runAllCommerceJourneys,
  type JourneyReport as CommerceJourneyReport,
} from "@fleetos/acceptance-commerce";
import { JOURNEYS as COMMERCE_JOURNEYS } from "@fleetos/acceptance-commerce/journeys";
import {
  assembleAdoptionReport,
  digestOf as adoptionDigestOf,
  runAdoptionSimulation,
  type AdoptionReport,
} from "@fleetos/acceptance-adoption";

// ---------------------------------------------------------------------------
// The REAL acceptance baselines (module scope, run once).
// ---------------------------------------------------------------------------

const fieldReport = assembleFieldReport(FIELD_JOURNEYS);
const securityReport = assembleSecurityReport(runAllSecurityJourneys(SECURITY_JOURNEYS));
const commerceOutcomes = await runAllCommerceJourneys(COMMERCE_JOURNEYS);
const commerceReport = assembleCommerceReport(commerceOutcomes);
const adoptionSimulation = await runAdoptionSimulation();
const adoptionReport = assembleAdoptionReport(adoptionSimulation);

// ---------------------------------------------------------------------------
// Digest-consistent negative fixtures (mutated content, digest RESEALED with
// the owning package's own digest primitive — these are structurally valid
// reports that honestly carry failures, not digest forgeries).
// ---------------------------------------------------------------------------

function failingFieldReport(): FieldAcceptanceReport {
  const { digest: _omit, ...rest } = fieldReport;
  const mutated = {
    ...rest,
    aggregate: { ...rest.aggregate, failed: 1, passed: rest.aggregate.passed - 1 },
  };
  return { ...mutated, digest: fieldDigestOf("acceptance-report", mutated as unknown as object) };
}

function subsetFieldReport(): FieldAcceptanceReport {
  return assembleFieldReport(FIELD_JOURNEYS.slice(0, 19));
}

function failingSecurityReport(): SecurityAcceptanceReport {
  const { digest: _omit, ...rest } = securityReport;
  const mutated = {
    ...rest,
    failedJourneys: 1,
    passedJourneys: rest.passedJourneys - 1,
  };
  return { ...mutated, digest: securityDigestOf(mutated) };
}

function subsetSecurityReport(): SecurityAcceptanceReport {
  return assembleSecurityReport(runAllSecurityJourneys(SECURITY_JOURNEYS.slice(0, 16)));
}

async function subsetCommerceReport(): Promise<CommerceJourneyReport> {
  const outcomes = await runAllCommerceJourneys(COMMERCE_JOURNEYS.slice(0, 30));
  return assembleCommerceReport(outcomes);
}

function failingAdoptionReport(): AdoptionReport {
  const { digest: _omit, ...rest } = adoptionReport;
  const mutated = {
    ...rest,
    aggregate: { ...rest.aggregate, allJourneysPassed: false },
  };
  return { ...mutated, digest: adoptionDigestOf("adoption-report", mutated as unknown as object) };
}

function shortWorkspaceAdoptionReport(): AdoptionReport {
  const { digest: _omit, ...rest } = adoptionReport;
  const mutated = {
    ...rest,
    aggregate: { ...rest.aggregate, workspaces: 29 },
  };
  return { ...mutated, digest: adoptionDigestOf("adoption-report", mutated as unknown as object) };
}

// ---------------------------------------------------------------------------
// Gate input builders.
// ---------------------------------------------------------------------------

function greenInputs(): ReleaseGateInput {
  return {
    tenantId: TENANT,
    status: assembleSystemStatus({ tenantId: TENANT, lanes: healthyLaneSignals(TENANT) }),
    cost: buildCostPosture({
      tenantId: TENANT,
      budgets: [healthyBurnProjection(TENANT)],
      checks: [withinCeilingCheck(TENANT)],
    }),
    acceptance: { field: fieldReport, security: securityReport, commerce: commerceReport, adoption: adoptionReport },
  };
}

function gateWithStatusLane(
  kind: "audit-ledger" | "incident-replay" | "sla-scorecard" | "ingestion-admission" | "offline-replay",
  degrade: () => ReturnType<typeof healthyLaneSignals>[number],
): ReleaseGateVerdict {
  const lanes = healthyLaneSignals(TENANT).map((s) => (s.kind === kind ? degrade() : s));
  return evaluateReleaseGate({
    ...greenInputs(),
    status: assembleSystemStatus({ tenantId: TENANT, lanes }),
  });
}

function blockerOf(verdict: ReleaseGateVerdict, code: string): ReleaseBlocker | undefined {
  return verdict.blockers.find((b) => b.code === code);
}

// ---------------------------------------------------------------------------
// Tests.
// ---------------------------------------------------------------------------

describe("release gate — the all-green path", () => {
  it("READY over the REAL corpora + REAL healthy lanes + within-budget cost (zero blockers)", () => {
    const verdict = evaluateReleaseGate(greenInputs());
    expect(verdict.verdict).toBe("READY");
    expect(verdict.blockers).toEqual([]);
    expect(verifyReleaseGateVerdict(verdict)).toBe(true);
  });

  it("the REAL baseline counts the gate verified: field 20, security 17, commerce 31, adoption 30 workspaces (converged Wave 11 corpora)", () => {
    expect(FIELD_JOURNEYS.length).toBe(20);
    expect(SECURITY_JOURNEYS.length).toBe(17);
    expect(COMMERCE_JOURNEYS.length).toBe(31);
    expect(fieldReport.aggregate.journeys).toBe(20);
    expect(securityReport.totalJourneys).toBe(17);
    expect(commerceReport.totals.journeyCount).toBe(31);
    expect(adoptionReport.aggregate.workspaces).toBe(30);
    expect(adoptionReport.aggregate.allJourneysPassed).toBe(true);
  });

  it("byte-identical re-evaluation (determinism law)", () => {
    const a = evaluateReleaseGate(greenInputs());
    const b = evaluateReleaseGate(greenInputs());
    expect(byteIdentical(a, b)).toBe(true);
    expect(a.gateDigest).toBe(b.gateDigest);
  });
});

describe("release gate — each single lane degradation blocks with the NAMED blocker", () => {
  it("audit gap → LANE_DEGRADED with reason 'audit.gap' verbatim", () => {
    const verdict = gateWithStatusLane("audit-ledger", () => ({
      kind: "audit-ledger",
      tenantId: TENANT,
      verification: gappedAuditVerification(TENANT),
    }));
    expect(verdict.verdict).toBe("NOT-READY");
    const blocker = blockerOf(verdict, "LANE_DEGRADED");
    expect(blocker).toBeDefined();
    expect(blocker!.source).toBe("system-status.lanes[audit-ledger]");
    expect(blocker!.detail).toContain("audit.gap");
  });

  it("replay refusal → LANE_DEGRADED with the REAL replay refusal code", () => {
    const signals = healthyLaneSignals(TENANT);
    const replaySignal = signals.find((s) => s.kind === "incident-replay");
    if (replaySignal?.kind !== "incident-replay") throw new Error("signal absent");
    const refused = {
      kind: "incident-replay" as const,
      tenantId: TENANT,
      replay: { ok: false as const, reason: "replay.ledger-refused" as const, offender: "ledger.index_gap" },
      divergence: replaySignal.divergence,
    };
    const lanes = signals.map((s) => (s.kind === "incident-replay" ? refused : s));
    const verdict = evaluateReleaseGate({
      ...greenInputs(),
      status: assembleSystemStatus({ tenantId: TENANT, lanes }),
    });
    expect(verdict.verdict).toBe("NOT-READY");
    const blocker = blockerOf(verdict, "LANE_DEGRADED");
    expect(blocker!.source).toBe("system-status.lanes[incident-replay]");
    expect(blocker!.detail).toContain("replay.ledger-refused");
  });

  it("sla penalty → LANE_DEGRADED with reason 'penalty' verbatim", () => {
    const verdict = gateWithStatusLane("sla-scorecard", () => ({
      kind: "sla-scorecard",
      tenantId: TENANT,
      scorecard: breachedSlaScorecard(TENANT),
    }));
    expect(verdict.verdict).toBe("NOT-READY");
    const blocker = blockerOf(verdict, "LANE_DEGRADED");
    expect(blocker!.source).toBe("system-status.lanes[sla-scorecard]");
    expect(blocker!.detail).toContain("penalty");
  });

  it("ingestion over-cap → LANE_DEGRADED with reason 'tenant-cap-exceeded' verbatim", () => {
    const verdict = gateWithStatusLane("ingestion-admission", () => ({
      kind: "ingestion-admission",
      tenantId: TENANT,
      decision: overCapAdmission(TENANT),
    }));
    expect(verdict.verdict).toBe("NOT-READY");
    const blocker = blockerOf(verdict, "LANE_DEGRADED");
    expect(blocker!.source).toBe("system-status.lanes[ingestion-admission]");
    expect(blocker!.detail).toContain("tenant-cap-exceeded");
  });

  it("offline divergence → LANE_DEGRADED with reason 'posture-changed-while-offline' verbatim", () => {
    const verdict = gateWithStatusLane("offline-replay", () => ({
      kind: "offline-replay",
      tenantId: TENANT,
      report: divergentOfflineReport(TENANT),
    }));
    expect(verdict.verdict).toBe("NOT-READY");
    const blocker = blockerOf(verdict, "LANE_DEGRADED");
    expect(blocker!.source).toBe("system-status.lanes[offline-replay]");
    expect(blocker!.detail).toContain("posture-changed-while-offline");
  });

  it("a missing lane → LANE_MISSING (default: all five lanes required)", () => {
    const lanes = healthyLaneSignals(TENANT).filter((s) => s.kind !== "offline-replay");
    const verdict = evaluateReleaseGate({
      ...greenInputs(),
      status: assembleSystemStatus({ tenantId: TENANT, lanes }),
    });
    expect(verdict.verdict).toBe("NOT-READY");
    const blocker = blockerOf(verdict, "LANE_MISSING");
    expect(blocker!.source).toBe("system-status.lanes[offline-replay]");
  });

  it("custom requiredLanes relax ONLY the presence check — a degraded present lane still blocks", () => {
    const lanes = healthyLaneSignals(TENANT).map((s) =>
      s.kind === "sla-scorecard" ? { ...s, scorecard: breachedSlaScorecard(TENANT) } : s,
    );
    const verdict = evaluateReleaseGate({
      ...greenInputs(),
      status: assembleSystemStatus({ tenantId: TENANT, lanes }),
      requiredLanes: ["audit-ledger"],
    });
    expect(verdict.verdict).toBe("NOT-READY");
    expect(blockerOf(verdict, "LANE_DEGRADED")).toBeDefined();
  });

  it("custom requiredLanes with a status carrying only that lane → READY (no phantom LANE_MISSING)", () => {
    const verdict = evaluateReleaseGate({
      ...greenInputs(),
      status: assembleSystemStatus({
        tenantId: TENANT,
        lanes: [{ kind: "audit-ledger", tenantId: TENANT, verification: healthyAuditVerification(TENANT) }],
      }),
      requiredLanes: ["audit-ledger"],
    });
    expect(verdict.verdict).toBe("READY");
    expect(verdict.blockers).toEqual([]);
  });

  it("status refused → STATUS_REFUSED with the REAL refusal reasonCode verbatim", () => {
    const verdict = evaluateReleaseGate({
      ...greenInputs(),
      status: { ok: false, reasonCode: "LANE_TENANT_MISMATCH", lane: "sla-scorecard", detail: "fixture refusal" },
    });
    expect(verdict.verdict).toBe("NOT-READY");
    const blocker = blockerOf(verdict, "STATUS_REFUSED");
    expect(blocker!.source).toBe("observability.assembleSystemStatus");
    expect(blocker!.detail).toContain("LANE_TENANT_MISMATCH");
  });

  it("status tampered → STATUS_TAMPERED (digest mismatch)", () => {
    const status = assembleSystemStatus({ tenantId: TENANT, lanes: healthyLaneSignals(TENANT) });
    if (!status.ok) throw new Error(status.detail);
    const tampered = { ...status, status: { ...status.status, healthyLaneCount: 4 } };
    const verdict = evaluateReleaseGate({ ...greenInputs(), status: tampered });
    expect(verdict.verdict).toBe("NOT-READY");
    expect(blockerOf(verdict, "STATUS_TAMPERED")).toBeDefined();
  });
});

describe("release gate — cost blockers", () => {
  it("an over-ceiling enforcement check → CEILING_BREACHED naming the check record with REAL numbers", () => {
    const verdict = evaluateReleaseGate({
      ...greenInputs(),
      cost: buildCostPosture({
        tenantId: TENANT,
        budgets: [healthyBurnProjection(TENANT)],
        checks: [overCeilingCheck(TENANT)],
      }),
    });
    expect(verdict.verdict).toBe("NOT-READY");
    const blocker = blockerOf(verdict, "CEILING_BREACHED");
    expect(blocker).toBeDefined();
    expect(blocker!.source).toContain("cost-posture.checks[0]");
    expect(blocker!.detail).toContain("actual=10000");
    expect(blocker!.detail).toContain("ceiling=9000");
    expect(blocker!.detail).toContain("by 1000");
  });

  it("a REAL projection with severity breach → CEILING_BREACHED naming the budget record", () => {
    const verdict = evaluateReleaseGate({
      ...greenInputs(),
      cost: buildCostPosture({
        tenantId: TENANT,
        budgets: [breachBurnProjection(TENANT)],
        checks: [withinCeilingCheck(TENANT)],
      }),
    });
    expect(verdict.verdict).toBe("NOT-READY");
    const blocker = blockerOf(verdict, "CEILING_BREACHED");
    expect(blocker!.source).toBe("cost-posture.budgets[0]");
    expect(blocker!.detail).toContain("severity=breach");
    expect(blocker!.detail).toContain("projection=true");
  });

  it("a warning posture does NOT breach (warnings are under-ceiling — READY)", () => {
    const verdict = evaluateReleaseGate({
      ...greenInputs(),
      cost: buildCostPosture({
        tenantId: TENANT,
        budgets: [warningBurnProjection(TENANT)],
        checks: [withinCeilingCheck(TENANT)],
      }),
    });
    expect(verdict.verdict).toBe("READY");
    expect(verdict.blockers).toEqual([]);
  });

  it("cost refused → COST_REFUSED with the REAL refusal reasonCode", () => {
    const verdict = evaluateReleaseGate({
      ...greenInputs(),
      cost: { ok: false, reasonCode: "NO_CHECKS", offenderIndex: null },
    });
    expect(verdict.verdict).toBe("NOT-READY");
    const blocker = blockerOf(verdict, "COST_REFUSED");
    expect(blocker!.detail).toContain("NO_CHECKS");
  });

  it("cost tampered → COST_TAMPERED (digest mismatch)", () => {
    const cost = buildCostPosture({
      tenantId: TENANT,
      budgets: [healthyBurnProjection(TENANT)],
      checks: [withinCeilingCheck(TENANT)],
    });
    if (!cost.ok) throw new Error("posture refused");
    const tampered = { ...cost, posture: { ...cost.posture, health: "within-budget" as const, rollup: { ...cost.posture.rollup, budgetCount: 99 } } };
    const verdict = evaluateReleaseGate({ ...greenInputs(), cost: tampered });
    expect(verdict.verdict).toBe("NOT-READY");
    expect(blockerOf(verdict, "COST_TAMPERED")).toBeDefined();
  });
});

describe("release gate — acceptance baselines (present, green, count-exact, untampered)", () => {
  it("missing field report → ACCEPTANCE_MISSING", () => {
    const verdict = evaluateReleaseGate({ ...greenInputs(), acceptance: { security: securityReport, commerce: commerceReport, adoption: adoptionReport } });
    expect(verdict.verdict).toBe("NOT-READY");
    expect(blockerOf(verdict, "ACCEPTANCE_MISSING")!.source).toBe("acceptance.field");
  });

  it("missing security report → ACCEPTANCE_MISSING", () => {
    const verdict = evaluateReleaseGate({ ...greenInputs(), acceptance: { field: fieldReport, commerce: commerceReport, adoption: adoptionReport } });
    expect(blockerOf(verdict, "ACCEPTANCE_MISSING")!.source).toBe("acceptance.security");
  });

  it("missing commerce report → ACCEPTANCE_MISSING", () => {
    const verdict = evaluateReleaseGate({ ...greenInputs(), acceptance: { field: fieldReport, security: securityReport, adoption: adoptionReport } });
    expect(blockerOf(verdict, "ACCEPTANCE_MISSING")!.source).toBe("acceptance.commerce");
  });

  it("missing adoption report → ACCEPTANCE_MISSING", () => {
    const verdict = evaluateReleaseGate({ ...greenInputs(), acceptance: { field: fieldReport, security: securityReport, commerce: commerceReport } });
    expect(blockerOf(verdict, "ACCEPTANCE_MISSING")!.source).toBe("acceptance.adoption");
  });

  it("tampered field report → ACCEPTANCE_TAMPERED (REAL digest verify fails loudly)", () => {
    const tampered = { ...fieldReport, aggregate: { ...fieldReport.aggregate, failed: 0, passed: 99 } };
    const verdict = evaluateReleaseGate({ ...greenInputs(), acceptance: { field: tampered, security: securityReport, commerce: commerceReport, adoption: adoptionReport } });
    expect(verdict.verdict).toBe("NOT-READY");
    expect(blockerOf(verdict, "ACCEPTANCE_TAMPERED")!.source).toBe("acceptance.field");
  });

  it("tampered adoption report → ACCEPTANCE_TAMPERED", () => {
    const tampered = { ...adoptionReport, aggregate: { ...adoptionReport.aggregate, allJourneysPassed: false } };
    const verdict = evaluateReleaseGate({ ...greenInputs(), acceptance: { field: fieldReport, security: securityReport, commerce: commerceReport, adoption: tampered } });
    expect(blockerOf(verdict, "ACCEPTANCE_TAMPERED")!.source).toBe("acceptance.adoption");
  });

  it("digest-consistent FAILING field report → ACCEPTANCE_FAILED (REAL failed count)", () => {
    const verdict = evaluateReleaseGate({ ...greenInputs(), acceptance: { field: failingFieldReport(), security: securityReport, commerce: commerceReport, adoption: adoptionReport } });
    expect(verdict.verdict).toBe("NOT-READY");
    const blocker = blockerOf(verdict, "ACCEPTANCE_FAILED");
    expect(blocker!.source).toBe("acceptance.field");
    expect(blocker!.detail).toContain("aggregate.failed=1");
  });

  it("digest-consistent FAILING security report → ACCEPTANCE_FAILED", () => {
    const verdict = evaluateReleaseGate({ ...greenInputs(), acceptance: { field: fieldReport, security: failingSecurityReport(), commerce: commerceReport, adoption: adoptionReport } });
    const blocker = blockerOf(verdict, "ACCEPTANCE_FAILED");
    expect(blocker!.source).toBe("acceptance.security");
    expect(blocker!.detail).toContain("failedJourneys=1");
  });

  it("digest-consistent FAILING adoption report → ACCEPTANCE_FAILED", () => {
    const verdict = evaluateReleaseGate({ ...greenInputs(), acceptance: { field: fieldReport, security: securityReport, commerce: commerceReport, adoption: failingAdoptionReport() } });
    const blocker = blockerOf(verdict, "ACCEPTANCE_FAILED");
    expect(blocker!.source).toBe("acceptance.adoption");
    expect(blocker!.detail).toContain("allJourneysPassed=false");
  });

  it("short field corpus (REAL assembler over a subset) → ACCEPTANCE_COUNT_MISMATCH (expected 20, got 19)", () => {
    const verdict = evaluateReleaseGate({ ...greenInputs(), acceptance: { field: subsetFieldReport(), security: securityReport, commerce: commerceReport, adoption: adoptionReport } });
    expect(verdict.verdict).toBe("NOT-READY");
    const blocker = blockerOf(verdict, "ACCEPTANCE_COUNT_MISMATCH");
    expect(blocker!.detail).toContain("expected 20");
    expect(blocker!.detail).toContain("report carries 19");
  });

  it("short security corpus → ACCEPTANCE_COUNT_MISMATCH", () => {
    const verdict = evaluateReleaseGate({ ...greenInputs(), acceptance: { field: fieldReport, security: subsetSecurityReport(), commerce: commerceReport, adoption: adoptionReport } });
    const blocker = blockerOf(verdict, "ACCEPTANCE_COUNT_MISMATCH");
    expect(blocker!.detail).toContain("expected 17");
  });

  it("short commerce corpus → ACCEPTANCE_COUNT_MISMATCH", async () => {
    const subset = await subsetCommerceReport();
    const verdict = evaluateReleaseGate({ ...greenInputs(), acceptance: { field: fieldReport, security: securityReport, commerce: subset, adoption: adoptionReport } });
    const blocker = blockerOf(verdict, "ACCEPTANCE_COUNT_MISMATCH");
    expect(blocker!.detail).toContain("expected 31");
    expect(blocker!.detail).toContain("report carries 30");
  });

  it("adoption workspaces short of the REAL population → ACCEPTANCE_COUNT_MISMATCH", () => {
    const verdict = evaluateReleaseGate({ ...greenInputs(), acceptance: { field: fieldReport, security: securityReport, commerce: commerceReport, adoption: shortWorkspaceAdoptionReport() } });
    const blocker = blockerOf(verdict, "ACCEPTANCE_COUNT_MISMATCH");
    expect(blocker!.detail).toContain("expected 30");
    expect(blocker!.detail).toContain("report carries 29");
  });
});

describe("release gate — boolean law + tenant fail-closed + tamper", () => {
  it("multiple simultaneous degradations surface EVERY blocker (no partial readiness)", () => {
    const verdict = evaluateReleaseGate({
      tenantId: TENANT,
      status: assembleSystemStatus({
        tenantId: TENANT,
        lanes: healthyLaneSignals(TENANT)
          .map((s) => (s.kind === "sla-scorecard" ? { ...s, scorecard: breachedSlaScorecard(TENANT) } : s))
          .filter((s) => s.kind !== "offline-replay"),
      }),
      cost: buildCostPosture({
        tenantId: TENANT,
        budgets: [breachBurnProjection(TENANT)],
        checks: [overCeilingCheck(TENANT)],
      }),
      acceptance: { security: securityReport, commerce: commerceReport, adoption: adoptionReport },
    });
    expect(verdict.verdict).toBe("NOT-READY");
    const codes = verdict.blockers.map((b) => b.code).sort();
    expect(codes).toEqual(
      [
        "LANE_DEGRADED",
        "LANE_MISSING",
        "CEILING_BREACHED",
        "CEILING_BREACHED",
        "ACCEPTANCE_MISSING",
      ].sort(),
    );
    expect(verdict.blockers.every((b) => b.source.length > 0 && b.detail.length > 0)).toBe(true);
  });

  it("empty tenant → NOT-READY with exactly one TENANT_ID_EMPTY blocker (fail-closed short-circuit)", () => {
    const verdict = evaluateReleaseGate({ ...greenInputs(), tenantId: "" });
    expect(verdict.verdict).toBe("NOT-READY");
    expect(verdict.blockers.length).toBe(1);
    expect(verdict.blockers[0]!.code).toBe("TENANT_ID_EMPTY");
    expect(verdict.blockers[0]!.source).toBe("release-gate.tenantId");
  });

  it("a view assembled under a foreign tenant blocks with STATUS_TENANT_MISMATCH + COST_TENANT_MISMATCH (fail-closed)", () => {
    const verdict = evaluateReleaseGate({
      ...greenInputs(),
      tenantId: "tnt_other-view",
    });
    expect(verdict.verdict).toBe("NOT-READY");
    const statusBlocker = verdict.blockers.find((b) => b.code === "STATUS_TENANT_MISMATCH");
    const costBlocker = verdict.blockers.find((b) => b.code === "COST_TENANT_MISMATCH");
    expect(statusBlocker).toBeDefined();
    expect(statusBlocker!.source).toBe("system-status.tenantId");
    expect(statusBlocker!.detail).toContain(TENANT);
    expect(costBlocker).toBeDefined();
    expect(costBlocker!.source).toBe("cost-posture.tenantId");
  });

  it("verifyReleaseGateVerdict detects a tampered verdict", () => {
    const verdict = evaluateReleaseGate(greenInputs());
    expect(verifyReleaseGateVerdict(verdict)).toBe(true);
    const tampered: ReleaseGateVerdict = { ...verdict, verdict: "NOT-READY" };
    expect(verifyReleaseGateVerdict(tampered)).toBe(false);
  });
});
