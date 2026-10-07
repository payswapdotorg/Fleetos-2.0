/**
 * @fleetos/health — Wave 3 edge diagnostics tests (F230A).
 *
 * Covers:
 *   - Severity ordering: severityMax, severityGe
 *   - Probe contracts: id, severity, message, evidence
 *   - DiagnosticsReport aggregation: overall = MAX of probe severities
 *   - Fatal short-circuit: stops battery on first fatal probe
 *   - Operational / degraded / fatal predicates
 *   - Tenant isolation: probes are tenant-bound via ProbeInput
 *   - Reference probes (deterministic System-1 reference path)
 *   - Audit emission stability
 */

import { describe, it, expect } from "vitest";
import {
  alwaysFatalProbe,
  alwaysHealthyProbe,
  alwaysWarnProbe,
  assertProbeTenantScope,
  isDegraded,
  isFatal,
  isOperational,
  makeProbeResult,
  runSelfCheck,
  severityGe,
  severityMax,
  SEVERITY_ORDER,
  type ProbeInput,
  type ProbeSeverity,
  type SelfCheckProbe,
} from "./kernel-diagnostics.js";

const NOW = 1_727_000_000_000;
const TENANT_A = "tnt_acme";
const DEVICE_1 = "dev_truck-001";

const input: ProbeInput = { tenantId: TENANT_A, deviceId: DEVICE_1, at: NOW };

// ---------------------------------------------------------------------------
// Severity ordering
// ---------------------------------------------------------------------------

describe("health diagnostics: severity ordering", () => {
  it("SEVERITY_ORDER: info=0, warn=1, error=2, fatal=3", () => {
    expect(SEVERITY_ORDER.info).toBe(0);
    expect(SEVERITY_ORDER.warn).toBe(1);
    expect(SEVERITY_ORDER.error).toBe(2);
    expect(SEVERITY_ORDER.fatal).toBe(3);
  });

  it("severityMax returns the higher severity", () => {
    expect(severityMax("info", "warn")).toBe("warn");
    expect(severityMax("warn", "info")).toBe("warn");
    expect(severityMax("error", "fatal")).toBe("fatal");
    expect(severityMax("info", "info")).toBe("info");
  });

  it("severityGe: greater-or-equal predicate", () => {
    expect(severityGe("fatal", "info")).toBe(true);
    expect(severityGe("info", "fatal")).toBe(false);
    expect(severityGe("warn", "warn")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Probe contracts
// ---------------------------------------------------------------------------

describe("health diagnostics: probe contracts", () => {
  it("makeProbeResult produces a typed result with id + severity + message + evidence", () => {
    const r = makeProbeResult({
      id: "disk.free",
      severity: "warn",
      message: "disk 80% full",
      tenantId: TENANT_A,
      deviceId: DEVICE_1,
      at: NOW,
      evidence: [{ kind: "disk.usage", digest: "abc123" }],
    });
    expect(r.id).toBe("disk.free");
    expect(r.severity).toBe("warn");
    expect(r.message).toBe("disk 80% full");
    expect(r.evidence).toHaveLength(1);
    expect(r.at).toBe(NOW);
  });

  it("makeProbeResult evidence defaults to empty array", () => {
    const r = makeProbeResult({
      id: "p",
      severity: "info",
      message: "ok",
      tenantId: TENANT_A,
      deviceId: DEVICE_1,
      at: NOW,
    });
    expect(r.evidence).toEqual([]);
  });

  it("reference probes return their canonical severity", () => {
    expect(alwaysHealthyProbe().run(input).severity).toBe("info");
    expect(alwaysWarnProbe().run(input).severity).toBe("warn");
    expect(alwaysFatalProbe().run(input).severity).toBe("fatal");
  });
});

// ---------------------------------------------------------------------------
// DiagnosticsReport aggregation
// ---------------------------------------------------------------------------

describe("health diagnostics: report aggregation", () => {
  it("overall = MAX severity across probes (info, warn, error, fatal -> fatal)", () => {
    const probes: SelfCheckProbe[] = [
      alwaysHealthyProbe("p1"),
      alwaysWarnProbe("p2"),
      { id: "p3", run: (i) => makeProbeResult({ id: "p3", severity: "error", message: "x", tenantId: i.tenantId, deviceId: i.deviceId, at: i.at }) },
      alwaysFatalProbe("p4"),
    ];
    const r = runSelfCheck(probes, input);
    // p4 is fatal -> short-circuits at p4; overall = fatal
    expect(r.overall).toBe("fatal");
    expect(r.fatalShortCircuit).toBe(true);
  });

  it("overall = warn when no error/fatal probes", () => {
    const probes: SelfCheckProbe[] = [
      alwaysHealthyProbe("p1"),
      alwaysWarnProbe("p2"),
    ];
    const r = runSelfCheck(probes, input);
    expect(r.overall).toBe("warn");
    expect(r.fatalShortCircuit).toBe(false);
  });

  it("overall = info when all probes are info", () => {
    const probes: SelfCheckProbe[] = [
      alwaysHealthyProbe("p1"),
      alwaysHealthyProbe("p2"),
    ];
    const r = runSelfCheck(probes, input);
    expect(r.overall).toBe("info");
  });

  it("empty probe battery -> overall=info, no results", () => {
    const r = runSelfCheck([], input);
    expect(r.overall).toBe("info");
    expect(r.results).toHaveLength(0);
    expect(r.fatalShortCircuit).toBe(false);
  });

  it("fatal short-circuit stops the battery at the first fatal probe", () => {
    const probes: SelfCheckProbe[] = [
      alwaysHealthyProbe("p1"),
      alwaysFatalProbe("p2"),
      alwaysHealthyProbe("p3"), // should NOT run
    ];
    const r = runSelfCheck(probes, input);
    expect(r.results).toHaveLength(2); // p1 + p2
    expect(r.fatalShortCircuit).toBe(true);
    expect(r.results.map((x) => x.id)).toEqual(["p1", "p2"]);
  });

  it("stopOnFatal=false: battery runs all probes even after fatal", () => {
    const probes: SelfCheckProbe[] = [
      alwaysFatalProbe("p1"),
      alwaysHealthyProbe("p2"),
    ];
    const r = runSelfCheck(probes, input, { stopOnFatal: false });
    expect(r.results).toHaveLength(2);
    expect(r.fatalShortCircuit).toBe(false);
    expect(r.overall).toBe("fatal");
  });

  it("audit digest is stable for identical probe batteries (deterministic)", () => {
    const probes: SelfCheckProbe[] = [alwaysHealthyProbe("p1"), alwaysWarnProbe("p2")];
    const r1 = runSelfCheck(probes, input);
    const r2 = runSelfCheck(probes, input);
    expect(r1.audit.digest).toBe(r2.audit.digest);
  });

  it("audit digest differs when probe severity differs", () => {
    const r1 = runSelfCheck([alwaysHealthyProbe("p")], input);
    const r2 = runSelfCheck([alwaysWarnProbe("p")], input);
    expect(r1.audit.digest).not.toBe(r2.audit.digest);
  });
});

// ---------------------------------------------------------------------------
// Operational / degraded / fatal predicates
// ---------------------------------------------------------------------------

describe("health diagnostics: predicates", () => {
  it("isOperational: true when overall is info or warn", () => {
    expect(isOperational(runSelfCheck([alwaysHealthyProbe()], input))).toBe(true);
    expect(isOperational(runSelfCheck([alwaysWarnProbe()], input))).toBe(true);
  });

  it("isOperational: false when overall is error or fatal", () => {
    const errProbe: SelfCheckProbe = { id: "p", run: (i) => makeProbeResult({ id: "p", severity: "error", message: "x", tenantId: i.tenantId, deviceId: i.deviceId, at: i.at }) };
    expect(isOperational(runSelfCheck([errProbe], input))).toBe(false);
    expect(isOperational(runSelfCheck([alwaysFatalProbe()], input))).toBe(false);
  });

  it("isDegraded: true only when overall is warn", () => {
    expect(isDegraded(runSelfCheck([alwaysWarnProbe()], input))).toBe(true);
    expect(isDegraded(runSelfCheck([alwaysHealthyProbe()], input))).toBe(false);
    expect(isDegraded(runSelfCheck([alwaysFatalProbe()], input))).toBe(false);
  });

  it("isFatal: true only when overall is fatal", () => {
    expect(isFatal(runSelfCheck([alwaysFatalProbe()], input))).toBe(true);
    expect(isFatal(runSelfCheck([alwaysWarnProbe()], input))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tenant isolation
// ---------------------------------------------------------------------------

describe("health diagnostics: tenant isolation", () => {
  it("probe input carries tenantId; probe result is tenant-bound via input", () => {
    const probe: SelfCheckProbe = {
      id: "p",
      run: (i) => makeProbeResult({ id: "p", severity: "info", message: `${i.tenantId}:${i.deviceId}`, tenantId: i.tenantId, deviceId: i.deviceId, at: i.at }),
    };
    const r1 = probe.run({ tenantId: TENANT_A, deviceId: DEVICE_1, at: NOW });
    const r2 = probe.run({ tenantId: "tnt_other", deviceId: DEVICE_1, at: NOW });
    expect(r1.message).toBe(`${TENANT_A}:${DEVICE_1}`);
    expect(r2.message).toBe(`tnt_other:${DEVICE_1}`);
  });

  it("report audit.tenant matches the input tenantId", () => {
    const r = runSelfCheck([alwaysHealthyProbe()], { tenantId: "tnt_other", deviceId: DEVICE_1, at: NOW });
    expect(r.audit.tenant).toBe("tnt_other");
    expect(r.tenantId).toBe("tnt_other");
  });

  it("assertProbeTenantScope is a contract anchor (always true for well-formed results)", () => {
    const r = alwaysHealthyProbe().run(input);
    expect(assertProbeTenantScope(r, TENANT_A, DEVICE_1)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Edge-grade severity contract: info=nominal, warn=degraded, error=capability unavailable, fatal=cannot continue
// ---------------------------------------------------------------------------

describe("health diagnostics: edge-grade severity contract", () => {
  it("info severity means nominal operation", () => {
    const r = makeProbeResult({ id: "p", severity: "info", message: "nominal", tenantId: TENANT_A, deviceId: DEVICE_1, at: NOW });
    expect(r.severity).toBe("info");
    expect(r.message).toBe("nominal");
  });

  it("warn severity means degraded but operational", () => {
    const r = makeProbeResult({ id: "p", severity: "warn", message: "degraded", tenantId: TENANT_A, deviceId: DEVICE_1, at: NOW });
    expect(severityGe(r.severity, "warn")).toBe(true);
    expect(severityGe(r.severity, "error")).toBe(false);
  });

  it("error severity means a capability is unavailable", () => {
    const r = makeProbeResult({ id: "p", severity: "error", message: "capability unavailable", tenantId: TENANT_A, deviceId: DEVICE_1, at: NOW });
    expect(severityGe(r.severity, "error")).toBe(true);
    expect(severityGe(r.severity, "fatal")).toBe(false);
  });

  it("fatal severity means agent cannot continue", () => {
    const r = makeProbeResult({ id: "p", severity: "fatal", message: "cannot continue", tenantId: TENANT_A, deviceId: DEVICE_1, at: NOW });
    expect(severityGe(r.severity, "fatal")).toBe(true);
  });

  it("each severity is distinct (no two map to the same order value)", () => {
    const severities: ProbeSeverity[] = ["info", "warn", "error", "fatal"];
    const orders = severities.map((s) => SEVERITY_ORDER[s]);
    expect(new Set(orders).size).toBe(4);
  });
});
