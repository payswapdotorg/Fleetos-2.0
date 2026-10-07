/**
 * @fleetos/predictive — deterministic reference twin model (Wave 3, F230B):
 * the `./reference-model` subpath BARREL.
 *
 * LAW (AGENTS.md / ARCHITECTURE-LOCK A2): "Predictive output is advisory and
 * never authoritative." The advisory envelope (`Prediction.advisory: true`),
 * the HYPOTHETICAL counterfactual brand (law A11), the provenance digests
 * that make every prediction replayable and auditable, and the `ModelPort`
 * adapter seam (Wave 5 / F290B JEPA family) are all defined across the two
 * modules re-exported below — see their headers for the law documentation.
 *
 * LAW A12: deterministic reference path — no GPU, no provider, no I/O, no
 * wall clock, no Math.random; same inputs => byte-identical outputs.
 *
 * Split note (F230B lint conformance): this file was the single 641-line
 * reference-model module; it is now a pure barrel over cohesive modules so
 * every src file stays under the repo's max-lines lint budget. The exported
 * surface is symbol-for-symbol identical:
 *
 *   - `./reference/contracts.ts` — model identity consts, the authoritative
 *     twin-state input shape, the advisory `Prediction` envelope, provenance,
 *     rejection codes, counterfactual contracts (interventions, divergence
 *     accounting, `HypotheticalProjection`), the `ModelPort` seam type, and
 *     the `isAdvisoryPrediction` runtime guard.
 *   - `./reference/model.ts` — the pure deterministic implementation:
 *     `projectReferenceTwin`, `runReferenceCounterfactual`,
 *     `makeReferenceModelPort`, and the private fitting/digest math.
 */

export * from "./reference/contracts.ts";
export * from "./reference/model.ts";
