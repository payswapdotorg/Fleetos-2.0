/**
 * @fleetos/acceptance-convergence — scenario fleet + lineage assembly (F290A REAL surfaces).
 *
 * Builds the scenario's asset fleet + material lots + versioned methods +
 * tamper-evident lineage chain over the REAL assets-package surfaces:
 * `AssetDirectory` (kernel), `registerMethod`/`deprecateMethod`/
 * `applyMethodToAsset`, `createMaterialLot`/`consumeMaterialLot`,
 * `appendLineageEdge` (the chain) and `validateObservationAnchor` (the
 * fail-closed observation gate). Every record produced here is a REAL lane
 * output carried BY REFERENCE; the scenario digest (src/scenarios.ts) cites
 * the owning lane's own digests — nothing is recomputed.
 *
 * HONESTY: the assembly deliberately attempts ONE application of a DEPRECATED
 * method version — the REAL surface refuses with `method-deprecated` and the
 * refusal is RECORDED (an explained shortfall that flows into the
 * intelligence rollup), never hidden and never worked around.
 *
 * Pure deterministic TS; logical `now` is caller-supplied throughout.
 */

import {
  AssetDirectory,
  InMemoryAssetRepository,
  appendLineageEdge,
  applyMethodToAsset,
  consumeMaterialLot,
  createMaterialLot,
  deprecateMethod,
  emptyLineageGraph,
  materialLotDigest,
  registerMethod,
  validateObservationAnchor,
} from "@fleetos/assets";
import type {
  AssetId,
  AssetKind,
  AssetLookupPort,
  LineageEdgePayload,
  LineageGraph,
  ManagedAssetRecord,
  MaterialLot,
  MethodApplication,
  MethodApplicationId,
  MethodDefinition,
  MethodId,
  MethodKind,
  MethodParameterSchema,
  MethodRegistry,
  ObservationLookupPort,
  ObservationSummary,
  TenantIdLike,
} from "@fleetos/assets";

/** A REAL observation-anchor outcome (from `validateObservationAnchor`). */
export interface AnchorOutcome {
  readonly applicationId: string;
  readonly observationId: string;
  readonly ok: boolean;
  /** The REAL `ObservationAnchorRejectionCode` on refusal. */
  readonly reasonCode?: string;
  readonly observation?: ObservationSummary;
}

/** An honest refusal recorded during assembly (REAL reason codes verbatim). */
export interface AssemblyRefusal {
  readonly surface: string;
  readonly reasonCode: string;
  readonly detail: string | null;
  readonly at: number;
}

/** The assembled fleet bundle (REAL records by reference). */
export interface FleetBundle {
  readonly fleet: readonly ManagedAssetRecord[];
  readonly methodDefinitions: readonly MethodDefinition[];
  readonly applications: readonly MethodApplication[];
  readonly lots: readonly MaterialLot[];
  readonly graph: LineageGraph;
  readonly anchorResults: readonly AnchorOutcome[];
  readonly refusals: readonly AssemblyRefusal[];
}

export type FleetAssemblyResult =
  | { readonly ok: true; readonly bundle: FleetBundle }
  | { readonly ok: false; readonly reasonCode: string; readonly detail: string | null };

/** Adapter: makes a REAL AssetDirectory look like the lineage AssetLookupPort. */
function directoryPort(directory: AssetDirectory): AssetLookupPort {
  return {
    findAsset: (tenantId: TenantIdLike, assetId: AssetId) => {
      const hit = directory.lookupAsset(tenantId, assetId);
      return hit ? { id: hit.id, tenantId: hit.tenantId } : null;
    },
  };
}

const LUB_CONSUMED = 40;
const BASE_QUANTITY = 200;
const TRANSFORM_YIELD = 0.9;

interface MethodSpec {
  readonly methodId: MethodId;
  readonly version: string;
  readonly kind: MethodKind;
  readonly displayName: string;
  readonly schema: readonly MethodParameterSchema[];
  readonly createdAt: number;
  readonly deprecateAt: number | null;
}

/**
 * Assemble the fleet + lineage world for one scenario. Fail-closed: an
 * unexpected REAL refusal surfaces as `FLEET_REFUSED` carrying the lane's
 * own reason code verbatim (the fixture is calibrated, so this path means a
 * fixture bug — loudly reported, never papered over).
 */
export function assembleFleet(input: {
  readonly tenantId: string;
  readonly shortKey: string;
  readonly fleetKinds: readonly AssetKind[];
  readonly now: number;
  readonly observationAnchor?: {
    readonly port: ObservationLookupPort;
    readonly observationId: string;
    readonly applicationId: string;
  };
}): FleetAssemblyResult {
  const { tenantId, shortKey, now } = input;
  const directory = new AssetDirectory(new InMemoryAssetRepository());
  const port = directoryPort(directory);
  const fail = (where: string, reason: string): FleetAssemblyResult => ({
    ok: false,
    reasonCode: "FLEET_REFUSED",
    detail: `${where}:${reason}`,
  });

  // --- The REAL fleet: three assets admitted then activated. ---
  const fleet: ManagedAssetRecord[] = [];
  for (const [index, kind] of input.fleetKinds.entries()) {
    const assetId = `ast_conv_${shortKey}_000${index + 1}`;
    const admitted = directory.admitAsset({
      assetId,
      tenantId,
      kind,
      displayName: `Conv ${shortKey} ${index + 1}`,
      createdAt: now + 1 + index,
      actor: `act_${shortKey}`,
    });
    if (!admitted.ok) return fail("admitAsset", admitted.reason);
    const activated = directory.transitionAsset({
      tenantId,
      assetId: admitted.asset.id,
      command: "activate",
      at: now + 4,
      actor: `act_${shortKey}`,
    });
    if (!activated.ok) return fail("activate", activated.reason);
    fleet.push(activated.asset);
  }
  const asset1 = fleet[0] as ManagedAssetRecord;
  const asset2 = fleet[1] as ManagedAssetRecord;
  const asset3 = fleet[2] as ManagedAssetRecord;

  // --- Versioned methods: active inspect + active service + a deprecated legacy. ---
  let registry: MethodRegistry = { byKey: new Map(), byMethod: new Map() };
  const inspectId = `mth_conv_${shortKey}_inspect` as MethodId;
  const serviceId = `mth_conv_${shortKey}_service` as MethodId;
  const legacyId = `mth_conv_${shortKey}_legacy` as MethodId;
  const registrations: readonly MethodSpec[] = [
    {
      methodId: inspectId, version: "1.2.0", kind: "inspection", displayName: "Routine Inspection",
      schema: [
        { name: "intensity", type: "enum", required: true, enumValues: ["light", "standard", "deep"] },
        { name: "notes", type: "text", required: false },
      ],
      createdAt: now + 2, deprecateAt: null,
    },
    {
      methodId: serviceId, version: "2.0.0", kind: "maintenance", displayName: "Scheduled Service",
      schema: [
        { name: "torque", type: "number", required: true },
        { name: "grease", type: "enum", required: false, enumValues: ["synthetic", "mineral"], defaultValue: "synthetic" },
      ],
      createdAt: now + 3, deprecateAt: null,
    },
    {
      methodId: legacyId, version: "1.0.0", kind: "operation", displayName: "Legacy Procedure",
      schema: [], createdAt: now + 1, deprecateAt: now + 5,
    },
  ];
  for (const spec of registrations) {
    const reg = registerMethod(registry, {
      methodId: spec.methodId, version: spec.version, kind: spec.kind, displayName: spec.displayName,
      parameterSchema: spec.schema, createdAt: spec.createdAt, description: `convergence scenario ${shortKey}`,
    });
    if (!reg.ok) return fail("registerMethod", reg.reason);
    registry = reg.registry;
    if (spec.deprecateAt !== null) {
      const dep = deprecateMethod(registry, { methodId: spec.methodId, version: spec.version, deprecatedAt: spec.deprecateAt });
      if (!dep.ok) return fail("deprecateMethod", dep.reason);
      registry = dep.registry;
    }
  }

  // --- Material lots: lubricant partially consumed; coolant base transformed. ---
  const lub = createMaterialLot({
    lotId: `lot_conv_${shortKey}_lub_0001`, tenantId, kind: "lubricant",
    attributes: { grade: "synthetic-5w30" }, quantity: 100, unit: "litre", createdAt: now + 1,
  });
  if (!lub.ok) return fail("createMaterialLot", lub.reason);
  const consumed = consumeMaterialLot(lub.lot, {
    tenantId, lotId: lub.lot.id, quantity: LUB_CONSUMED, consumedAt: now + 10, consumeSeq: 1,
  });
  if (!consumed.ok) return fail("consumeMaterialLot", consumed.reason);
  const base = createMaterialLot({
    lotId: `lot_conv_${shortKey}_base_0001`, tenantId, kind: "coolant",
    attributes: { concentrate: true }, quantity: BASE_QUANTITY, unit: "litre", createdAt: now + 2,
  });
  if (!base.ok) return fail("createMaterialLot", base.reason);
  const blend = createMaterialLot({
    lotId: `lot_conv_${shortKey}_blend_0001`, tenantId, kind: "coolant",
    attributes: { concentrate: false }, quantity: Math.floor(BASE_QUANTITY * TRANSFORM_YIELD), unit: "litre", createdAt: now + 11,
  });
  if (!blend.ok) return fail("createMaterialLot", blend.reason);
  const lots: readonly MaterialLot[] = [consumed.lot, base.lot, blend.lot];

  // --- Method applications over the REAL registry + directory port. ---
  const applications: MethodApplication[] = [];
  const inspectAppId = `app_conv_${shortKey}_insp_0001`;
  const anchored = input.observationAnchor?.applicationId === inspectAppId
    ? { observationId: input.observationAnchor.observationId }
    : undefined;
  const inspectApp = applyMethodToAsset(registry, port, {
    applicationId: inspectAppId, tenantId, methodId: inspectId, methodVersion: "1.2.0",
    assetId: asset2.id, parameters: { intensity: "standard", notes: "routine convergence pass" },
    outcome: "succeeded", appliedAt: now + 12, actor: `act_${shortKey}`, observationAnchor: anchored,
  });
  if (!inspectApp.ok) return fail("applyMethodToAsset", inspectApp.reason);
  applications.push(inspectApp.application);
  const serviceApp = applyMethodToAsset(registry, port, {
    applicationId: `app_conv_${shortKey}_svc_0001`, tenantId, methodId: serviceId, methodVersion: "2.0.0",
    assetId: asset3.id, parameters: { torque: 42 }, outcome: "succeeded", appliedAt: now + 13, actor: `act_${shortKey}`,
  });
  if (!serviceApp.ok) return fail("applyMethodToAsset", serviceApp.reason);
  applications.push(serviceApp.application);

  // --- The honest deprecated-method attempt: REAL refusal, recorded. ---
  const refusals: AssemblyRefusal[] = [];
  const legacyApp = applyMethodToAsset(registry, port, {
    applicationId: `app_conv_${shortKey}_legacy_0001`, tenantId, methodId: legacyId, methodVersion: "1.0.0",
    assetId: asset1.id, parameters: {}, outcome: "skipped", appliedAt: now + 14, actor: `act_${shortKey}`,
  });
  if (legacyApp.ok) return fail("legacy-application", "unexpectedly accepted");
  refusals.push({
    surface: "applyMethodToAsset",
    reasonCode: legacyApp.reason,
    detail: `deprecated ${String(legacyId)}@1.0.0 refused for asset ${asset1.id}`,
    at: now + 14,
  });

  // --- Observation anchoring (fail-closed; REAL outcomes recorded). ---
  const anchorResults: AnchorOutcome[] = [];
  if (input.observationAnchor !== undefined && anchored !== undefined) {
    const outcome = validateObservationAnchor(input.observationAnchor.port, {
      tenantId,
      observationAnchor: { observationId: input.observationAnchor.observationId },
    });
    anchorResults.push(
      outcome.ok
        ? { applicationId: inspectAppId, observationId: input.observationAnchor.observationId, ok: true, observation: outcome.observation }
        : { applicationId: inspectAppId, observationId: input.observationAnchor.observationId, ok: false, reasonCode: outcome.reason },
    );
  }

  // --- The tamper-evident lineage chain (5 edges, all 4 kinds). ---
  const appends: readonly { readonly payload: LineageEdgePayload; readonly at: number }[] = [
    { payload: { kind: "asset-consumed-lot", assetId: asset1.id, lotId: consumed.lot.id, quantity: LUB_CONSUMED, unit: "litre", consumeSeq: 1 }, at: now + 15 },
    { payload: { kind: "method-applied-to-asset", methodId: inspectId, methodVersion: "1.2.0", assetId: asset2.id, applicationId: inspectAppId as MethodApplicationId }, at: now + 16 },
    { payload: { kind: "lot-transformed-into-lot", sourceLotId: base.lot.id, targetLotId: blend.lot.id, yieldRatio: TRANSFORM_YIELD }, at: now + 17 },
    { payload: { kind: "method-applied-to-asset", methodId: serviceId, methodVersion: "2.0.0", assetId: asset3.id, applicationId: `app_conv_${shortKey}_svc_0001` as MethodApplicationId }, at: now + 18 },
    { payload: { kind: "asset-replaced-by-asset", predecessorAssetId: asset1.id, successorAssetId: asset3.id, reason: "end-of-life replacement" }, at: now + 19 },
  ];
  let graph: LineageGraph = emptyLineageGraph();
  for (const append of appends) {
    const result = appendLineageEdge(graph, { tenantId, payload: append.payload, at: append.at });
    if (!result.ok) return fail("appendLineageEdge", result.reason);
    graph = result.graph;
  }

  return {
    ok: true,
    bundle: {
      fleet,
      methodDefinitions: Array.from(registry.byKey.values()),
      applications,
      lots,
      graph,
      anchorResults,
      refusals,
    },
  };
}

/** REAL per-lot digests (cited by the scenario digest — never recomputed). */
export function fleetLotDigests(lots: readonly MaterialLot[]): readonly string[] {
  return lots.map((lot) => materialLotDigest(lot));
}
