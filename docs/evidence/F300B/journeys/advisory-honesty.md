# Browser Journey 3 — Predictive honesty on the advisory board

**Persona:** ml-engineer.
**Routes:** advisory-board (drill: findings-board).
**Machine-run twin:** `security.predictive-honesty` (acceptance corpus,
journey 16).

## Preconditions

- At least one REAL reference-twin prediction (pump-7 vibration) and one
  assembled world context for the tenant.

## Steps

1. **Open the advisory board** (`advisory-board`).
   - EXPECT: every card carries the machine-carried advisory marker
     (advisory badge — never presented as authoritative fact); the
     prediction card shows: the headline value WITH bounds (uncertainty),
     integer-bps confidence, staleness class, and provenance (model
     version `reference-twin-1.0.0`, method `reference.linear-drift`,
     observation refs, input digest).
   - The world-context card shows confidence "—" (honest null — no model
     confidence applies, none invented).

2. **Inspect the model honesty disclosure on each card.**
   - EXPECT (machine-readable in the view models, rendered by the shell):
     modelClass `deterministic-structural-reference`; `trainedValidated:
     false`; `structuralAnalogue: true`; the honest statement naming the
     model as a deterministic structural/reference model — NOT trained,
     NOT accuracy-validated.

3. **Inspect the JEPA structural analogue disclosure.**
   - EXPECT: any JEPA-derived surface (world-model latent predictions, if
     the TL composes them) is labeled with the SAME class
     `deterministic-structural-reference` and the statement "hash-derived
     JEPA structural analogue … NOT a trained model and carries NO
     validated accuracy". NOTHING anywhere claims trained/validated
     accuracy for the JEPA analogue (the packet's explicit law).

4. **Inspect the model registry panel** (the route carries it).
   - EXPECT: the structural/reference list (reference twin, JEPA family,
     world-context assembly) and the trained/validated list rendered
     HONESTLY EMPTY ("no trained/validated models shipped" or equivalent).

5. **Trigger an advisory refresh** (UI event
   `security.advisory.request-refresh`).
   - EXPECT: an inert draft ("refresh requested" — the refresh itself goes
     through the command path); the refreshed card re-renders with NEW
     provenance + input digest only when a real projection ran.

## Negative checks

- A card whose model identity the registry cannot certify must render the
  refusal (`advisory.model-honesty-refused`) — never a guessed class.
- An advisory marker stripped in transit (simulated fault) must be refused
  at the boundary (`card.non-advisory-input`).

## Pass criteria

`advisory: true` machine-carried end-to-end; provenance, uncertainty and
model identity visible on every card; the structural-vs-trained
differentiation machine-readable AND rendered; no accuracy claims for
deterministic structural models.
