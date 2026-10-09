/**
 * @fleetos/acceptance-convergence — tests/fixtures.ts
 *
 * REAL-output builders (the F281 convention): the shared deterministic
 * worlds the test suites assemble once and reference everywhere.
 *
 *   - `realObservationBinding` — ingests a REAL observation through the
 *     observations package's public `admitToLog` and binds the log as the
 *     lineage `ObservationLookupPort` (the F290A composition pattern); the
 *     port is captured over the log closure so lookups are tenant-scoped.
 *   - `ANCHORED_SCENARIOS` — the six default industries assembled with REAL
 *     observation anchors (one ingest per tenant, before assembly).
 *   - `ANCHORED_INTELLIGENCE` — the rollups over the anchored scenarios.
 *
 * Not a test file (no assertions); lint-green under the 400-line law.
 * Pure deterministic TS: no clock, no randomness, no network.
 */

import { admitToLog, emptyAdmittedLog, type AdmittedObservationLog } from "@fleetos/observations";
import type { ObservationLookupPort } from "@fleetos/assets";
import type { Industry } from "@fleetos/agent-organizations";
import { assembleDefaultScenarios, assembleScenario, type ConvergenceScenario, type ScenarioWorldInput } from "../src/scenarios.js";
import { buildScenarioIntelligenceSet, type ScenarioIntelligence } from "../src/intelligence.js";
import { DEFAULT_SCENARIO_INDUSTRIES, INDUSTRY_SHORT_KEYS, NOW_0 } from "../src/scenario-data.js";

export const TENANT_OF = (industry: Industry): string => `tnt_conv_${industry}`;

/** The REAL observation port + the ingested observation's REAL id. */
export interface ObservationBinding {
  readonly port: ObservationLookupPort;
  readonly observationId: string;
  readonly deviceId: string;
  readonly tenantId: string;
}

/** Ingest one REAL observation and bind the admitted log as the lookup port. */
export function realObservationBinding(tenantId: string, shortKey: string): ObservationBinding {
  let log: AdmittedObservationLog = emptyAdmittedLog();
  const deviceId = `dev_conv_${shortKey}_0002`;
  const ingest = admitToLog(log, {
    tenantId,
    deviceId,
    seq: 1,
    observedAt: NOW_0 + 6,
    kind: "state.health",
    payload: new TextEncoder().encode(JSON.stringify({ ok: true, shortKey })),
    admittedAt: NOW_0 + 6,
  });
  if (!ingest.ok) throw new Error(`fixture observation ingest failed: ${ingest.reason}`);
  log = ingest.log;
  const observation = ingest.observation;
  const port: ObservationLookupPort = {
    lookup: (scopeTenant, observationId) => {
      for (const obs of log.byKey.values()) {
        if (obs.id === observationId && obs.tenantId === scopeTenant) {
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
  return { port, observationId: observation.id, deviceId, tenantId };
}

/** Per-industry world with the REAL observation anchor bound. */
export function worldWithRealAnchor(industry: Industry): ScenarioWorldInput {
  const shortKey = INDUSTRY_SHORT_KEYS[industry];
  const binding = realObservationBinding(TENANT_OF(industry), shortKey);
  return { observationAnchor: { port: binding.port, observationId: binding.observationId } };
}

/** The six default scenarios, each anchored to its own REAL observation. */
export const ANCHORED_SCENARIOS: readonly ConvergenceScenario[] =
  assembleDefaultScenarios(worldWithRealAnchor);

/** The rollups over the anchored scenarios (REAL benchmark + traversals + matches). */
export const ANCHORED_INTELLIGENCE: readonly ScenarioIntelligence[] =
  buildScenarioIntelligenceSet(ANCHORED_SCENARIOS);

/** Build a FRESH scenario with the REAL anchor (mutation tests never touch shared fixtures). */
export function freshScenario(industry: Industry): ConvergenceScenario {
  const result = assembleScenario({ industry, world: worldWithRealAnchor(industry) });
  if (!result.ok) throw new Error(`fresh scenario refused: ${result.reasonCode}`);
  return result.scenario;
}

/** Look up one scenario by industry (fail-loud when absent). */
export function scenarioFor(industry: Industry): ConvergenceScenario {
  const scenario = ANCHORED_SCENARIOS.find((s) => s.industry === industry);
  if (scenario === undefined) throw new Error(`fixture scenario missing: ${industry}`);
  return scenario;
}

/** Look up one intelligence rollup by industry (fail-loud when absent). */
export function intelligenceFor(industry: Industry): ScenarioIntelligence {
  const intelligence = ANCHORED_INTELLIGENCE.find((s) => s.scenarioId === `conv-${industry}-medium`);
  if (intelligence === undefined) throw new Error(`fixture intelligence missing: ${industry}`);
  return intelligence;
}

/** All six default industries (the corpus order). */
export const ALL_INDUSTRIES: readonly Industry[] = DEFAULT_SCENARIO_INDUSTRIES;
