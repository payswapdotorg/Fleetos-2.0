/**
 * @fleetos/experience-asset-field — declarative field-level redaction.
 *
 * Style exemplar: @fleetos/world-context assembly redaction — a DECLARATIVE
 * redact-list per view purpose, applied deterministically:
 *   - redacted field NAMES are recorded on the view (`redactedFields`) so
 *     consumers see WHAT was hidden, never the value;
 *   - redacted values are replaced by the "[REDACTED]" sentinel — the value
 *     is PROVEN absent from the serialized view;
 *   - only SCALAR attribute values (string | number | boolean | null) ever
 *     surface in experience views — nested objects are dropped entirely so
 *     no unredacted structure can leak through an excerpt.
 *
 * Assembly never invents rules: callers may pass their own rule list, the
 * DEFAULT_VIEW_REDACTION_RULES are the reference policy (a production
 * privacy policy belongs to the policy lane).
 *
 * Deterministic: rule union is sorted + deduped; output fields are emitted
 * in sorted key order.
 */

export type ViewPurpose = "fleet-overview" | "asset-detail" | "field-mode";

/** Redact-list: attribute field names hidden for a view purpose. */
export interface ViewRedactionRule {
  readonly purpose: ViewPurpose;
  readonly redactFields: readonly string[];
}

/** The sentinel replacing redacted values — the value never leaks. */
export const REDACTED_VALUE = "[REDACTED]" as const;

/**
 * Reference redaction policy. Fleet-wide views hide operator contact AND
 * location; the field operator's own view keeps location (field work
 * needs it) but hides operator contact; asset detail hides operator
 * contact only.
 */
export const DEFAULT_VIEW_REDACTION_RULES: readonly ViewRedactionRule[] = [
  { purpose: "fleet-overview", redactFields: ["operatorContact", "location"] },
  { purpose: "asset-detail", redactFields: ["operatorContact"] },
  { purpose: "field-mode", redactFields: ["operatorContact"] },
];

/** The only attribute value shapes experience views ever surface. */
export type ScalarFieldValue = string | number | boolean | null;

export interface RedactionOutcome {
  /** Scalar-only fields, redacted where the rule list says so, sorted keys. */
  readonly fields: Readonly<Record<string, ScalarFieldValue>>;
  /** Sorted names of the fields whose values were redacted. */
  readonly redactedFields: readonly string[];
}

export type RedactionRejection = "unknown-purpose";

export type RedactionResult =
  | { readonly ok: true; readonly outcome: RedactionOutcome }
  | { readonly ok: false; readonly rejected: RedactionRejection; readonly detail: string };

/**
 * Apply the purpose's redact-list to a raw attribute record. Non-scalar
 * values are dropped (never surfaced); redacted keys are replaced with the
 * sentinel and listed by name. Fails closed when no rule covers the
 * purpose — a purpose without policy is a misconfiguration, not a
 * redaction-free pass.
 */
export function redactForPurpose(
  purpose: ViewPurpose,
  fields: Readonly<Record<string, unknown>>,
  rules?: readonly ViewRedactionRule[],
): RedactionResult {
  const list = rules ?? DEFAULT_VIEW_REDACTION_RULES;
  const matching = list.filter((r) => r.purpose === purpose);
  if (matching.length === 0) {
    return {
      ok: false,
      rejected: "unknown-purpose",
      detail: `no redaction rule covers view purpose ${purpose}`,
    };
  }
  const redactSet = new Set<string>();
  for (const rule of matching) {
    for (const field of rule.redactFields) redactSet.add(field);
  }

  const out: Record<string, ScalarFieldValue> = {};
  const redacted: string[] = [];
  for (const key of Object.keys(fields).sort()) {
    const value = fields[key];
    if (!redactSet.has(key)) {
      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean" ||
        value === null
      ) {
        out[key] = value;
      }
      // Non-scalar values are dropped: experience views never surface them.
      continue;
    }
    out[key] = REDACTED_VALUE;
    redacted.push(key);
  }
  return { ok: true, outcome: { fields: out, redactedFields: redacted } };
}

/**
 * Bound a redacted field record to the first `limit` keys (sorted) — the
 * deterministic attribute excerpt for size-bounded view cards.
 */
export function limitScalarFields(
  fields: Readonly<Record<string, ScalarFieldValue>>,
  limit: number,
): Readonly<Record<string, ScalarFieldValue>> {
  if (!Number.isInteger(limit) || limit < 0) {
    return {};
  }
  const out: Record<string, ScalarFieldValue> = {};
  for (const key of Object.keys(fields).sort().slice(0, limit)) {
    const value = fields[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}
