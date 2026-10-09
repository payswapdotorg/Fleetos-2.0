/**
 * @fleetos/assets — Wave 9 lineage observation anchoring tests (F290A).
 *
 * Covers:
 *   - validateObservationAnchor: valid anchor returns ok with the REAL summary.
 *   - missing-anchor-field: missing anchor object / missing observationId.
 *   - malformed-observation-id: invalid observation id regex.
 *   - dangling-observation: lookup returns null.
 *   - observation-tenant-mismatch: lookup returns a foreign-tenant record.
 *   - empty tenant id at the input: refused with missing-anchor-field.
 *   - anchorMethodApplication: convenience over a MethodApplication record.
 *   - REAL observation surface binding: the test binds the REAL
 *     `@fleetos/observations` `admitToLog` surface as the lookup port —
 *     proving the structural port + the REAL surface agree on shape.
 */

import { describe, it, expect } from "vitest";
import {
  validateObservationAnchor,
  anchorMethodApplication,
  type ObservationLookupPort,
  type ObservationSummary,
} from "./anchor.js";
import {
  emptyMethodRegistry,
  registerMethod,
  applyMethodToAsset,
  type MethodDefinition,
} from "./method.js";
import type { AssetId } from "../assets.js";

// The REAL observations surface — bound here at the test site, never imported
// by the lineage source (which uses a structural port). The composition binding
// proves the structural shape matches the REAL `Observation`.
import {
  emptyAdmittedLog,
  admitToLog,
  type Observation,
} from "@fleetos/observations";

const NOW = 1_774_000_000_000;
const TENANT_A = "tnt_acme";
const TENANT_B = "tnt_other";
const ASSET_1 = "ast_truck-0001" as AssetId;
const DEVICE_1 = "dev_pump-001";

/** Build a port backed by the REAL observations admitted-log.
 *
 * The port's lookup reads from the closure-captured `log`; the `ingest`
 * helper re-assigns that `log` after each REAL `admitToLog` call, so the
 * port always sees the latest ingested observations.
 */
function realObservationLookup(): {
  port: ObservationLookupPort;
  ingest: (input: { seq: number; tenantId: string }) => Observation;
} {
  let log = emptyAdmittedLog();
  const port: ObservationLookupPort = {
    lookup: (tenantId, observationId) => {
      for (const obs of log.byKey.values()) {
        if (obs.id === observationId && obs.tenantId === tenantId) {
          return {
            id: obs.id,
            tenantId: obs.tenantId,
            deviceId: obs.deviceId,
            seq: obs.seq,
            observedAt: obs.observedAt,
            payloadDigest: obs.payloadDigest,
          };
        }
      }
      return null;
    },
  };
  const ingest = (input: { seq: number; tenantId: string }): Observation => {
    const r = admitToLog(log, {
      tenantId: input.tenantId,
      deviceId: DEVICE_1,
      seq: input.seq,
      observedAt: NOW + input.seq * 1000,
      kind: "state.health",
      payload: new TextEncoder().encode(JSON.stringify({ ok: true, seq: input.seq })),
      admittedAt: NOW + input.seq * 1000,
    });
    if (!r.ok) throw new Error(`ingest failed: ${r.reason}`);
    log = r.log; // closure-captured log reassigned — port sees the new state.
    return r.observation;
  };
  return { port, ingest };
}

describe("observation anchor: validateObservationAnchor — REAL surface binding", () => {
  it("validates an anchor against a REAL observation ingested via the observations surface", () => {
    const { port, ingest } = realObservationLookup();
    const obs = ingest({ seq: 1, tenantId: TENANT_A });
    const r = validateObservationAnchor(port, {
      tenantId: TENANT_A,
      observationAnchor: { observationId: obs.id },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.anchor.observationId).toBe(obs.id);
      expect(r.observation.tenantId).toBe(TENANT_A);
      expect(r.observation.deviceId).toBe(DEVICE_1);
      expect(r.observation.payloadDigest).toBe(obs.payloadDigest);
    }
  });

  it("refuses missing anchor field (missing-anchor-field) — undefined anchor", () => {
    const { port } = realObservationLookup();
    const r = validateObservationAnchor(port, { tenantId: TENANT_A });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing-anchor-field");
  });

  it("refuses missing anchor field (missing-anchor-field) — empty observationId", () => {
    const { port } = realObservationLookup();
    const r = validateObservationAnchor(port, {
      tenantId: TENANT_A,
      observationAnchor: { observationId: "" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing-anchor-field");
  });

  it("refuses empty tenant id (missing-anchor-field) — fail-closed", () => {
    const { port } = realObservationLookup();
    const r = validateObservationAnchor(port, {
      tenantId: "",
      observationAnchor: { observationId: "obs_a-001-aaaaaaaa" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing-anchor-field");
  });

  it("refuses malformed observation id (malformed-observation-id)", () => {
    const { port } = realObservationLookup();
    const r = validateObservationAnchor(port, {
      tenantId: TENANT_A,
      observationAnchor: { observationId: "bad-obs-id" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("malformed-observation-id");
  });

  it("refuses dangling observation (dangling-observation) — id well-formed but not ingested", () => {
    const { port } = realObservationLookup();
    const r = validateObservationAnchor(port, {
      tenantId: TENANT_A,
      observationAnchor: { observationId: "obs_a-001-notfound" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("dangling-observation");
  });

  it("refuses observation-tenant-mismatch — port returns a foreign-tenant observation", () => {
    // The lineage module double-checks tenant even if the lookup port itself
    // does not tenant-filter. Construct a port that ignores tenantId and
    // returns whatever it finds by id alone — the anchor validator must still
    // refuse when the observation's own tenant disagrees with the caller's.
    const foreignObservation: ObservationSummary = {
      id: "obs_a-001-aaaaaaaa",
      tenantId: TENANT_B,
      deviceId: DEVICE_1,
      seq: 1,
      observedAt: NOW,
      payloadDigest: "deadbeef",
    };
    const port: ObservationLookupPort = {
      lookup: (_t, id) => (id === foreignObservation.id ? foreignObservation : null),
    };
    const r = validateObservationAnchor(port, {
      tenantId: TENANT_A,
      observationAnchor: { observationId: foreignObservation.id },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("observation-tenant-mismatch");
  });

  it("refuses dangling-observation when the REAL log has no matching observation", () => {
    const { port, ingest } = realObservationLookup();
    // Ingest under TENANT_B so TENANT_A lookups do not match (the port's
    // tenant-filtered REAL lookup returns null → dangling-observation).
    ingest({ seq: 1, tenantId: TENANT_B });
    const r = validateObservationAnchor(port, {
      tenantId: TENANT_A,
      observationAnchor: { observationId: "obs_a-001-notfound" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("dangling-observation");
  });
});

describe("observation anchor: anchorMethodApplication — convenience over a record", () => {
  it("validates the anchor carried by a method application record", () => {
    const reg = registerMethod(emptyMethodRegistry(), {
      methodId: "mth_oil-change",
      version: "1.0.0",
      kind: "maintenance",
      displayName: "Oil Change",
      parameterSchema: [
        { name: "grade", type: "string", required: true },
      ],
      createdAt: NOW,
    });
    if (!reg.ok) throw new Error();
    const assetLookup = {
      findAsset: (_t: string, id: AssetId) => ({ id, tenantId: TENANT_A }),
    };
    const { port, ingest } = realObservationLookup();
    const obs = ingest({ seq: 1, tenantId: TENANT_A });

    const app = applyMethodToAsset(reg.registry, assetLookup, {
      applicationId: "app_anchor-0001",
      tenantId: TENANT_A,
      methodId: "mth_oil-change" as MethodDefinition["methodId"],
      methodVersion: "1.0.0",
      assetId: ASSET_1,
      parameters: { grade: "5W-30" },
      outcome: "succeeded",
      appliedAt: NOW + 60_000,
      actor: "act_tech-001",
      observationAnchor: { observationId: obs.id },
    });
    if (!app.ok) throw new Error(`applyMethodToAsset failed: ${app.reason}`);
    const r = anchorMethodApplication(port, app.application);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.observation.id).toBe(obs.id);
    }
  });

  it("refuses when the application carries no anchor (missing-anchor-field)", () => {
    const reg = registerMethod(emptyMethodRegistry(), {
      methodId: "mth_oil-change",
      version: "1.0.0",
      kind: "maintenance",
      displayName: "Oil Change",
      parameterSchema: [{ name: "grade", type: "string", required: true }],
      createdAt: NOW,
    });
    if (!reg.ok) throw new Error();
    const assetLookup = {
      findAsset: (_t: string, id: AssetId) => ({ id, tenantId: TENANT_A }),
    };
    const { port } = realObservationLookup();
    const app = applyMethodToAsset(reg.registry, assetLookup, {
      applicationId: "app_anchor-0002",
      tenantId: TENANT_A,
      methodId: "mth_oil-change" as MethodDefinition["methodId"],
      methodVersion: "1.0.0",
      assetId: ASSET_1,
      parameters: { grade: "5W-30" },
      outcome: "succeeded",
      appliedAt: NOW + 60_000,
      actor: "act_tech-001",
      // no observationAnchor
    });
    if (!app.ok) throw new Error();
    const r = anchorMethodApplication(port, app.application);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing-anchor-field");
  });
});

// Type-only consumer — proves the ObservationSummary structural shape is a
// SUPERSET-compatible read view of the REAL Observation (every field the
// summary carries is on the Observation; the converse relies on the branded
// ObservationId being assignable to plain string, which is the structural
// contract the anchor module enforces). The runtime composition above is
// the binding proof; this helper is the static shape sanity-check.
function _summaryFromObservation(o: Observation): ObservationSummary {
  return {
    id: o.id,
    tenantId: o.tenantId,
    deviceId: o.deviceId,
    seq: o.seq,
    observedAt: o.observedAt,
    payloadDigest: o.payloadDigest,
  };
}
void _summaryFromObservation;
