/**
 * @fleetos/convergence — the model-stack assembly (F231, Wave 3 TL lane).
 *
 * THE sanctioned composition site for the Intelligence-Plane budget seam
 * (F230C §6.1): model-gateway ROUTING (`selectModel` — capability → context
 * → cost filter + priority ordering) + PROVIDER FALLBACK
 * (`resolveFallbackLadder` — reason code at every hop) bound against
 * agent-organization BUDGETS through the gateway's `BudgetCheckPort` TYPE
 * seam, whose concrete binding here is the org package's REAL
 * `checkAgentBudget` (the port's port ← the org implementation — exactly
 * the binding workers are forbidden to make and the TL owns).
 *
 * Budget-gated selection: candidates are tried in the gateway's ranked
 * order; the org budget is checked through the port BEFORE any usage is
 * recorded; a refused candidate routes selection to the next-ranked model
 * with the ORG's reason code propagated verbatim as `budgetReasonCode`
 * (never silently dropped, law A4). The winner's usage is appended to the
 * chained usage ledger through the SAME port (which re-checks the budget),
 * and the org budget record is consumed via the org package's pure
 * `consumeFromBudget` so subsequent selections see the true remaining
 * ceiling. `replenish` raises the ceiling through the org package's
 * `replenishBudget` (consumption preserved — never a stealth reset).
 *
 * Determinism laws: pure functions + injected state, `now`/`at` explicit
 * inputs, no Date.now/Math.random/timers/network. Public-entry imports
 * only.
 */

import {
  appendUsage,
  classifyDegradedMode,
  resolveFallbackLadder,
  selectModel,
  verifyUsageLedgerChain,
  type BudgetCheckPort,
  type DegradedModeClassification,
  type FallbackResolution,
  type ModelDescriptor,
  type ModelSelectionDecision,
  type ProviderRecord,
  type UsageAppendReasonCode,
  type UsageLedgerEntry,
} from "@fleetos/model-gateway";
import {
  checkAgentBudget,
  consumeFromBudget,
  replenishBudget,
  type CapabilityBudgetRecord,
} from "@fleetos/agent-organizations";

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------

export interface ModelStackOptions {
  /** The validated model registry (gateway routing input). */
  readonly registry: readonly ModelDescriptor[];
  /** Provider records (health + declared models). */
  readonly providers: readonly ProviderRecord[];
  /** The declared fallback ladder order (primary → secondary → …). */
  readonly chainOrder: readonly string[];
  /** The agent-organization capability budget records (authoritative). */
  readonly budgets: readonly CapabilityBudgetRecord[];
}

export interface ModelStackRequest {
  readonly tenantId: string;
  readonly agentId: string;
  /** The org capability being spent (budget key + usage-ledger entry). */
  readonly capability: string;
  /** Routing capability tags (ALL required). */
  readonly requiredCapabilities: readonly string[];
  /** Integer priority 1 (highest) … 5 (lowest). */
  readonly priority: number;
  readonly estimatedUnits: number;
  /**
   * The application-declared ROUTING spend ceiling (integer minor units) —
   * an explicit input like `estimatedUnits`, INDEPENDENT of the org budget.
   * The gateway filters candidates against this ceiling; the ORG budget
   * then gates every surviving candidate through the BudgetCheckPort —
   * the two policies compose, and the org's refusal routes selection to
   * the next-ranked candidate with the org's reason code propagated.
   */
  readonly budgetCeilingMinor: number;
  /** Dedupe key for the usage ledger (retries never double-charge). */
  readonly requestRef: string;
  readonly at: number;
}

/** A candidate the org budget refused (model + the org's reason code). */
export interface BudgetRefusedCandidate {
  readonly modelId: string;
  readonly reasonCode: string;
}

export interface ModelStackSelection {
  readonly ok: boolean;
  readonly selectedModelId: string | null;
  readonly selectedProviderId: string | null;
  /** The gateway routing decision (success or typed refusal). */
  readonly routed: ModelSelectionDecision | null;
  /** The fallback ladder for the SERVED model (per-hop reason codes). */
  readonly fallback: FallbackResolution | null;
  /** Degraded-mode classification, surfaced on every decision. */
  readonly degradedMode: DegradedModeClassification;
  /**
   * The ORG's reason code that routed selection off the primary model
   * (e.g. "UNITS_EXHAUSTED"), or the refusal cause; null when the primary
   * served. Propagated VERBATIM from checkAgentBudget — never invented.
   */
  readonly budgetReasonCode: string | null;
  /** Candidates the org budget refused, in attempted order. */
  readonly budgetRefused: readonly BudgetRefusedCandidate[];
  /** The appended usage-ledger entry on success. */
  readonly usage: UsageLedgerEntry | null;
  /** The usage-append refusal code on failure (when budget was not the cause). */
  readonly usageReasonCode: UsageAppendReasonCode | null;
  /** Deterministic digest over inputs + outcome (byte-identical replays). */
  readonly digest: string;
}

export interface ModelStack {
  /** Budget-gated model selection with fallback + reason-code propagation. */
  selectForRequest(request: ModelStackRequest): ModelStackSelection;
  /** Raise an agent budget ceiling through the org package (no reset). */
  replenish(input: {
    readonly tenantId: string;
    readonly agentId: string;
    readonly capability: string;
    readonly additionalUnits: number;
    readonly additionalSpendMinor: number;
  }): { readonly ok: boolean; readonly reasonCode: string | null };
  /** The current budget records (post-consumption state). */
  budgets(): ReadonlyArray<CapabilityBudgetRecord>;
  /** The chained usage ledger, seq-ordered. */
  usageLedger(): ReadonlyArray<UsageLedgerEntry>;
  /** Chain verification delegated to the gateway's verifier. */
  verifyUsageChain(): { readonly ok: boolean; readonly brokenAtSeq: number | null };
  /** The BudgetCheckPort binding (org checkAgentBudget behind the port). */
  budgetPort(): BudgetCheckPort;
}

// ---------------------------------------------------------------------------
// The assembly
// ---------------------------------------------------------------------------

export function assembleModelStack(options: ModelStackOptions): ModelStack {
  let budgets: CapabilityBudgetRecord[] = [...options.budgets];
  let ledger: UsageLedgerEntry[] = [];
  const port: BudgetCheckPort = {
    check: (query) => checkAgentBudget(budgets, query),
  };

  return {
    budgetPort: () => port,

    selectForRequest(request: ModelStackRequest): ModelStackSelection {
      const degradedMode = classifyDegradedMode(options.providers);
      const refused: BudgetRefusedCandidate[] = [];
      const routed = selectModel(options.registry, {
        tenantId: request.tenantId,
        requiredCapabilities: request.requiredCapabilities,
        priority: request.priority,
        budgetCeilingMinor: request.budgetCeilingMinor,
        estimatedUnits: request.estimatedUnits,
      });
      if (!routed.ok) {
        return refusal(routed, degradedMode, null, refused, null, {
          request,
          routed,
          outcome: `routing:${routed.reasonCode}`,
        });
      }
      let ladderRefusal: FallbackResolution | null = null;
      for (const candidate of routed.rankedCandidates) {
        const budgetCheck = port.check({
          tenantId: request.tenantId,
          agentId: request.agentId,
          capability: request.capability,
          unitsRequested: request.estimatedUnits,
          spendRequestedMinor: candidate.estimatedCostMinor,
        });
        if (!budgetCheck.ok) {
          refused.push({ modelId: candidate.modelId, reasonCode: budgetCheck.reasonCode });
          continue;
        }
        const ladder = resolveFallbackLadder(
          options.providers,
          options.chainOrder,
          candidate.modelId,
        );
        if (!ladder.ok) {
          ladderRefusal = ladder;
          continue;
        }
        // Winner: record usage through the SAME port (re-checks the budget).
        const appended = appendUsage(ledger, port, {
          tenantId: request.tenantId,
          agentId: request.agentId,
          requestRef: request.requestRef,
          modelId: candidate.modelId,
          providerId: candidate.providerId,
          capability: request.capability,
          units: request.estimatedUnits,
          costMinor: candidate.estimatedCostMinor,
          at: request.at,
        });
        if (!appended.ok) {
          return refusal(routed, degradedMode, appended.budgetReasonCode, refused, appended.reasonCode, {
            request,
            routed,
            outcome: `usage:${appended.reasonCode}`,
          });
        }
        ledger = [...appended.ledger];
        budgets = consumeOrgBudget(budgets, request, candidate.estimatedCostMinor);
        return {
          ok: true,
          selectedModelId: candidate.modelId,
          selectedProviderId: ladder.selectedProviderId,
          routed,
          fallback: ladder,
          degradedMode,
          budgetReasonCode:
            candidate.rank === 1
              ? null
              : (refused[refused.length - 1]?.reasonCode ?? null),
          budgetRefused: refused,
          usage: appended.appended,
          usageReasonCode: null,
          digest: selectionDigest(request, `served:${candidate.modelId}`),
        };
      }
      const lastBudgetReason = refused[refused.length - 1]?.reasonCode ?? null;
      return refusal(routed, degradedMode, lastBudgetReason, refused, null, {
        request,
        routed,
        outcome:
          lastBudgetReason !== null
            ? `budget:${lastBudgetReason}`
            : `ladder:${ladderRefusal?.reasonCode ?? "no-candidate"}`,
      });
    },

    replenish(input) {
      const index = budgets.findIndex(
        (b) =>
          b.scope.kind === "agent" &&
          b.scope.refId === input.agentId &&
          b.capability === input.capability &&
          b.tenant.tenantId === input.tenantId,
      );
      const budget = budgets[index];
      if (budget === undefined) return { ok: false, reasonCode: "BUDGET_NOT_FOUND" };
      const result = replenishBudget(budget, {
        units: input.additionalUnits,
        spendMinor: input.additionalSpendMinor,
      });
      if (!result.ok) return { ok: false, reasonCode: result.reasonCode };
      budgets = [...budgets.slice(0, index), result.budget, ...budgets.slice(index + 1)];
      return { ok: true, reasonCode: null };
    },

    budgets: () => budgets,
    usageLedger: () => ledger,
    verifyUsageChain() {
      const verification = verifyUsageLedgerChain(ledger);
      return verification.ok
        ? { ok: true, brokenAtSeq: null }
        : { ok: false, brokenAtSeq: verification.brokenAtSeq };
    },
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function consumeOrgBudget(
  budgets: CapabilityBudgetRecord[],
  request: ModelStackRequest,
  costMinor: number,
): CapabilityBudgetRecord[] {
  return budgets.map((b) => {
    if (
      b.scope.kind !== "agent" ||
      b.scope.refId !== request.agentId ||
      b.capability !== request.capability ||
      b.tenant.tenantId !== request.tenantId
    ) {
      return b;
    }
    const consumed = consumeFromBudget(b, {
      units: request.estimatedUnits,
      spendMinor: costMinor,
    });
    return consumed.ok ? consumed.budget : b;
  });
}

function refusal(
  routed: ModelSelectionDecision | null,
  degradedMode: DegradedModeClassification,
  budgetReasonCode: string | null,
  budgetRefused: readonly BudgetRefusedCandidate[],
  usageReasonCode: UsageAppendReasonCode | null,
  digestInput: {
    readonly request: ModelStackRequest;
    readonly routed: ModelSelectionDecision | null;
    readonly outcome: string;
  },
): ModelStackSelection {
  return {
    ok: false,
    selectedModelId: null,
    selectedProviderId: null,
    routed: digestInput.routed,
    fallback: null,
    degradedMode,
    budgetReasonCode,
    budgetRefused,
    usage: null,
    usageReasonCode,
    digest: selectionDigest(digestInput.request, digestInput.outcome),
  };
}

/** FNV-1a composition digest (deterministic; the lane convention). */
function selectionDigest(request: ModelStackRequest, outcome: string): string {
  const parts = [
    request.tenantId,
    request.agentId,
    request.capability,
    request.requiredCapabilities.join(","),
    request.priority,
    request.estimatedUnits,
    request.budgetCeilingMinor,
    request.requestRef,
    request.at,
    outcome,
  ].join("|");
  let h = 0x811c9dc5;
  for (let i = 0; i < parts.length; i += 1) {
    h ^= parts.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return `mstack_${h.toString(16).padStart(8, "0")}`;
}
