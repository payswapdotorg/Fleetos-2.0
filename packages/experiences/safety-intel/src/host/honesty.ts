/**
 * @fleetos/experience-safety-intel — host predictive honesty (F300B
 * deliverable 4).
 *
 * PREDICTIVE HONESTY LAW (packet + AGENTS.md "predictive output is advisory
 * and never authoritative" + the F300B packet's explicit mandate):
 *
 *   - every advisory output carries `advisory: true` machine-carried
 *     end-to-end (enforced upstream by the advisory-cards module's four
 *     mechanisms — brand, runtime guard, compile pins, input verification);
 *   - provenance (model identity + method + input digest), uncertainty
 *     (integer bps / honest null) and model identity are surfaced on the host
 *     view models;
 *   - the hash-derived JEPA structural analogue is labeled a DETERMINISTIC
 *     STRUCTURAL/REFERENCE model — NEVER claimed as trained/validated
 *     accuracy;
 *   - the structural-vs-trained differentiation is MACHINE-READABLE here:
 *     `ModelHonestyDisclosure.modelClass` is a closed two-value vocabulary,
 *     and `classifyModelHonesty` is FAIL-CLOSED — an UNKNOWN model identity
 *     is refused (`honesty.unknown-model-identity`) rather than guessed,
 *     because this module cannot certify a "trained-validated" claim for a
 *     model it does not know. No fabricated class, ever.
 *
 * HONEST CURRENT STATE (machine-tested): this lane ships NO genuinely
 * trained/validated models. Every registry entry discloses
 * `trainedValidated: false`; the empty trained registry is itself pinned by
 * tests. When a genuinely trained model lands, its disclosure must be added
 * here with the evidence that makes the claim honest.
 *
 * Determinism: pure functions over caller-supplied identities only.
 */

// ---------------------------------------------------------------------------
// The machine-readable class vocabulary
// ---------------------------------------------------------------------------

/**
 * The closed model-class vocabulary — the structural-vs-trained
 * differentiation, machine-readable on every host advisory view model.
 *
 *  - "deterministic-structural-reference": hash-derived / reference /
 *    deterministic-assembly models. Deterministic, replayable, NOT trained,
 *    NOT validated for accuracy. This includes the JEPA structural analogue.
 *  - "trained-validated": a genuinely trained AND validated predictive model.
 *    NONE exist in this lane today (pinned by tests).
 */
export type PredictiveModelClass =
  | "deterministic-structural-reference"
  | "trained-validated";

export interface ModelHonestyDisclosure {
  readonly modelVersion: string;
  /** The method identity carried with the model (e.g. "reference.linear-drift"). */
  readonly method: string;
  readonly modelClass: PredictiveModelClass;
  /** Machine-carried: false for every model this lane ships today. */
  readonly trainedValidated: boolean;
  /**
   * Machine-carried: true when the model is a hash-derived structural
   * analogue of a learned model (the JEPA family) or a deterministic
   * reference twin — presented as STRUCTURE, never as learned accuracy.
   */
  readonly structuralAnalogue: boolean;
  /** The honest statement, carried machine-side (rendered verbatim by the shell). */
  readonly statement: string;
}

// ---------------------------------------------------------------------------
// The registry — every model identity this lane can honestly disclose
// ---------------------------------------------------------------------------

const STRUCTURAL_STATEMENT =
  "Deterministic structural/reference model — hash-derived replayable structure, not a trained or accuracy-validated model. Outputs are advisory only.";

interface RegistryEntry {
  /** Exact modelVersion match, or a prefix match when `prefix: true`. */
  readonly match: string;
  readonly prefix: boolean;
  readonly method: string;
  readonly statement?: string;
}

/**
 * The known deterministic structural/reference model identities:
 *  - `reference-twin-1.0.0` (@fleetos/predictive, method reference.linear-drift);
 *  - the JEPA family (`jepa-*`, @fleetos/world-model space versions — the
 *    hash-derived structural analogue);
 *  - `world-context@*` (deterministic context assembly — honest
 *    no-confidence, not a predictive model at all).
 */
const STRUCTURAL_REFERENCE_REGISTRY: readonly RegistryEntry[] = [
  {
    match: "reference-twin-1.0.0",
    prefix: false,
    method: "reference.linear-drift",
    statement:
      "Deterministic reference twin (linear drift over the observation history) — a structural/reference model, not trained or accuracy-validated. Outputs are advisory only.",
  },
  {
    match: "jepa-",
    prefix: true,
    method: "jepa.latent-space",
    statement:
      "Hash-derived JEPA structural analogue — a deterministic structural/reference presentation of joint-embedding prediction. It is NOT a trained model and carries NO validated accuracy. Outputs are advisory only.",
  },
  {
    match: "world-context@",
    prefix: true,
    method: "context.assembly",
    statement:
      "Deterministic world-context assembly (observations, not model output) — no model confidence applies and none is invented. Advisory presentation only.",
  },
];

// ---------------------------------------------------------------------------
// Classification — fail-closed
// ---------------------------------------------------------------------------

export type ModelHonestyRefusalCode = "honesty.unknown-model-identity";

export type ModelHonestyResult =
  | { readonly ok: true; readonly disclosure: ModelHonestyDisclosure }
  | { readonly ok: false; readonly refused: ModelHonestyRefusalCode; readonly detail: string };

/**
 * Classify a model identity for honesty. FAIL-CLOSED: an identity that is
 * not in the registry is REFUSED — this module never certifies a class
 * (especially never "trained-validated") for a model it does not know, and
 * never renders an advisory whose model class cannot be honestly stated.
 */
export function classifyModelHonesty(input: {
  readonly modelVersion: string;
  readonly method?: string;
}): ModelHonestyResult {
  if (input.modelVersion === "") {
    return {
      ok: false,
      refused: "honesty.unknown-model-identity",
      detail: "model identity is empty — no honest class can be certified",
    };
  }
  for (const entry of STRUCTURAL_REFERENCE_REGISTRY) {
    const hit = entry.prefix ? input.modelVersion.startsWith(entry.match) : input.modelVersion === entry.match;
    if (!hit) continue;
    return {
      ok: true,
      disclosure: {
        modelVersion: input.modelVersion,
        method: input.method ?? entry.method,
        modelClass: "deterministic-structural-reference",
        trainedValidated: false,
        structuralAnalogue: true,
        statement: entry.statement ?? STRUCTURAL_STATEMENT,
      },
    };
  }
  return {
    ok: false,
    refused: "honesty.unknown-model-identity",
    detail:
      `model identity "${input.modelVersion}" is not in the honesty registry — ` +
      "its class (structural/reference vs trained/validated) cannot be certified, so it is refused rather than guessed",
  };
}

// ---------------------------------------------------------------------------
// The registry view (machine-readable on the host view models)
// ---------------------------------------------------------------------------

export interface ModelRegistryEntryView {
  readonly modelVersion: string;
  readonly method: string;
  readonly modelClass: PredictiveModelClass;
  readonly trainedValidated: boolean;
  readonly structuralAnalogue: boolean;
}

/**
 * The full model-honesty registry as a view: every model identity this lane
 * can honestly disclose, with the machine-readable class. The trained-
 * validated section is HONESTLY EMPTY today — the view carries both lists so
 * the shell can render "no trained/validated models shipped" verbatim.
 */
export function modelHonestyRegistryView(): {
  readonly structuralReference: readonly ModelRegistryEntryView[];
  readonly trainedValidated: readonly ModelRegistryEntryView[];
} {
  const structuralReference: ModelRegistryEntryView[] = [
    {
      modelVersion: "reference-twin-1.0.0",
      method: "reference.linear-drift",
      modelClass: "deterministic-structural-reference",
      trainedValidated: false,
      structuralAnalogue: true,
    },
    {
      modelVersion: "jepa-1.0.0",
      method: "jepa.latent-space",
      modelClass: "deterministic-structural-reference",
      trainedValidated: false,
      structuralAnalogue: true,
    },
    {
      modelVersion: "world-context@*",
      method: "context.assembly",
      modelClass: "deterministic-structural-reference",
      trainedValidated: false,
      structuralAnalogue: true,
    },
  ];
  return { structuralReference, trainedValidated: [] };
}
