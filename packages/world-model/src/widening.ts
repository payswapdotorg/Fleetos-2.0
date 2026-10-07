/**
 * @fleetos/world-model — Counterfactual uncertainty widening + A11 reinforcement.
 *
 * Wave 1 (F210B) additions:
 *   - Counterfactuals with WIDENED uncertainty (law A11 — hypothetical is less certain)
 *   - Adapter that produces counterfactuals with widened uncertainty
 *   - A11 type distinctness reinforcement (HYPOTHETICAL never conflated with OBSERVED)
 *
 * Pure types + pure functions.
 */

import type {
  WorldModelRepresentation,
  CounterfactualScenario,
  WorldModelAdapter,
  UncertaintyInterval,
  PredictedValue,
  HypotheticalValue,
} from "./index.ts";
import { makeReferenceWorldModelAdapter } from "./index.ts";

/**
 * Widen uncertainty for a counterfactual (law A11).
 *
 * A counterfactual is LESS certain than a prediction — its uncertainty
 * interval MUST be wider. This function takes a baseline uncertainty and
 * widens it by a factor (default 2x).
 */
export function widenUncertaintyForCounterfactual(
  baseline: UncertaintyInterval,
  factor: number = 2,
): UncertaintyInterval {
  const center = (baseline.lower + baseline.upper) / 2;
  const halfWidth = (baseline.upper - baseline.lower) / 2;
  return {
    lower: center - halfWidth * factor,
    upper: center + halfWidth * factor,
    confidence: Math.max(0, baseline.confidence / factor),
    method: baseline.method,
  };
}

/**
 * Build a counterfactual with WIDENED uncertainty from a world-model representation.
 *
 * Law A11: the counterfactual's uncertainty MUST be wider than the baseline
 * prediction's uncertainty. This is the machine-tested widening invariant.
 */
export function buildCounterfactualWithWidenedUncertainty<T = unknown>(
  adapter: WorldModelAdapter,
  rep: WorldModelRepresentation,
  premise: string,
  newValue: T,
  wideningFactor: number = 2,
): CounterfactualScenario<T> {
  const baseline = adapter.predict(rep);
  const widened = widenUncertaintyForCounterfactual(baseline.uncertainty, wideningFactor);
  return adapter.counterfactual(rep, premise, newValue, widened);
}

/**
 * Machine-test: verify that a counterfactual's uncertainty is wider than
 * the baseline prediction's uncertainty.
 *
 * Returns true if the counterfactual's uncertainty interval is strictly wider.
 */
export function counterfactualUncertaintyIsWider<T>(
  baseline: PredictedValue<T>,
  counterfactual: HypotheticalValue<T>,
): boolean {
  const baselineWidth = baseline.uncertainty.upper - baseline.uncertainty.lower;
  const cfWidth = counterfactual.uncertainty.upper - counterfactual.uncertainty.lower;
  return cfWidth > baselineWidth;
}

/**
 * Build a reference adapter that produces counterfactuals with widened
 * uncertainty by default.
 */
export function makeWideningReferenceAdapter(
  now: string = "1970-01-01T00:00:00.000Z",
  wideningFactor: number = 2,
): WorldModelAdapter {
  const base = makeReferenceWorldModelAdapter(now);
  return {
    name: "reference.widening",
    represent: base.represent,
    predict: base.predict,
    counterfactual: <T = unknown>(
      rep: WorldModelRepresentation,
      premise: string,
      newValue: T,
      newUncertainty: UncertaintyInterval,
    ) => {
      // Widen the provided uncertainty if it's not already wider than the baseline.
      const baseline = base.predict(rep);
      const widened = newUncertainty.upper - newUncertainty.lower <= baseline.uncertainty.upper - baseline.uncertainty.lower
        ? widenUncertaintyForCounterfactual(newUncertainty, wideningFactor)
        : newUncertainty;
      return base.counterfactual(rep, premise, newValue, widened);
    },
  };
}
