/**
 * F270B journey tests — every journey runs as a test and MUST pass with its
 * full declarative assertion chain, plus focused spot checks of the REAL
 * behaviors each journey captured.
 */

import { describe, expect, it } from "vitest";
import { runJourney, verifyRunnerDeterminism } from "../src/runner.ts";
import { SECURITY_JOURNEYS } from "../src/journeys/index.ts";
import { verifyJourneyOutcome } from "../src/journey-contracts.ts";
import type { AcceptanceJourney } from "../src/journey-contracts.ts";

const byId = new Map(SECURITY_JOURNEYS.map((j) => [j.journeyId, j]));
function journey(id: string): AcceptanceJourney {
  const found = byId.get(id);
  if (found === undefined) throw new Error(`journey ${id} not found`);
  return found;
}

describe("F270B security/action/intelligence acceptance journeys", () => {
  it("runs every journey in the corpus and all pass", () => {
    expect(SECURITY_JOURNEYS.length).toBeGreaterThanOrEqual(12);
    const failures: string[] = [];
    for (const j of SECURITY_JOURNEYS) {
      const { outcome } = runJourney(j);
      if (!outcome.pass) failures.push(outcome.journeyId);
    }
    expect(failures).toEqual([]);
  });

  it.each(SECURITY_JOURNEYS.map((j) => [j.journeyId, j] as const))(
    "journey %s passes its full assertion chain",
    (_id, j) => {
      const { outcome } = runJourney(j);
      expect(outcome.pass).toBe(true);
      expect(outcome.failedAssertionCount).toBe(0);
      expect(outcome.passedStepCount).toBe(j.steps.length);
      expect(verifyJourneyOutcome(outcome)).toBe(true);
    },
  );

  it.each(SECURITY_JOURNEYS.map((j) => [j.journeyId, j] as const))(
    "journey %s is runner-deterministic",
    (_id, j) => {
      const check = verifyRunnerDeterminism(j);
      expect(check.deterministic).toBe(true);
      expect(check.digest1).toBe(check.digest2);
    },
  );

  it("every journey records facts for every declarative assertion", () => {
    for (const j of SECURITY_JOURNEYS) {
      const { facts } = runJourney(j);
      for (const a of j.assertions) {
        expect(Object.keys(facts)).toContain(a.path);
      }
    }
  });
});

describe("F270B journey spot checks (REAL behaviors)", () => {
  it("investigate: the repeated medium finding escalates to high with occurrences 3", () => {
    const { facts } = runJourney(journey("security.investigate-finding"));
    expect(facts["intake.escalated.severity"]).toBe("high");
    expect(facts["intake.escalated.occurrences"]).toBe(3);
    expect(facts["view.triageQueue.first.severity"]).toBe("high");
  });

  it("investigate: the findings view surfaces every admitted finding", () => {
    const { facts } = runJourney(journey("security.investigate-finding"));
    expect(facts["view.rollup.totalFindings"]).toBe(4);
    expect(facts["view.triageQueue.itemCount"]).toBe(4);
  });

  it("evidence: the bundle verifies and a tampered payload digest fails", () => {
    const { facts } = runJourney(journey("security.understand-evidence"));
    expect(facts["bundle.verified"]).toBe(true);
    expect(facts["bundle.tampered.verified"]).toBe(false);
    expect(facts["bundle.tampered.reason"]).toBe("integrity.bundle-digest-mismatch");
  });

  it("guardian: allow/deny/escalate all reachable with audit digests", () => {
    const { facts } = runJourney(journey("security.guardian-decision"));
    expect(facts["guardian.read.verdict"]).toBe("ALLOW");
    expect(facts["guardian.execute.verdict"]).toBe("REQUIRE_APPROVAL");
    expect(facts["guardian.agent.verdict"]).toBe("BLOCK");
    expect(facts["guardian.digestStable"]).toBe(true);
  });

  it("guardian: the ceiling board carries the not-an-authorization marker", () => {
    const { facts } = runJourney(journey("security.guardian-decision"));
    expect(facts["ceiling.read.marker"]).toBe(true);
    expect(facts["ceiling.read.hasAuthorizedField"]).toBe(false);
    expect(facts["ceiling.read.hasVerdictField"]).toBe(false);
  });

  it("action plan: blocked emission is all-or-nothing", () => {
    const { facts } = runJourney(journey("security.action-plan"));
    expect(facts["emission.blockedOk"]).toBe(false);
    expect(facts["emission.blockedReason"]).toBe("emission.step-blocked");
    expect(facts["board.step1Status"]).toBe("queued");
  });

  it("execution: dead-letter after three attempts with the reason preserved", () => {
    const { facts } = runJourney(journey("security.execution-ledger"));
    expect(facts["queue.doomed.round3.status"]).toBe("dead-lettered");
    expect(facts["queue.deadLetterReason"]).toBe("transport error 3");
    expect(facts["replay.doomedStatus"]).toBe("dead-lettered");
  });

  it("execution: the ledger is append-only and tamper-evident", () => {
    const { facts } = runJourney(journey("security.execution-ledger"));
    expect(facts["ledger.indexes"]).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(facts["ledger.tampered.verified"]).toBe(false);
    expect(facts["ledger.tampered.brokenAt"]).toBe(2);
  });

  it("reasoning: security-review redaction hides operator identity and location", () => {
    const { facts } = runJourney(journey("security.reasoning-context"));
    expect(facts["assembly.pump7Location"]).toBe("[REDACTED]");
    expect(facts["assembly.leaksOperatorIdentity"]).toBe(false);
    expect(facts["assembly.digestVerifies"]).toBe(true);
  });

  it("predictive advice: advisory markers survive to the board", () => {
    const { facts } = runJourney(journey("security.predictive-advice"));
    expect(facts["prediction.advisory"]).toBe(true);
    expect(facts["prediction.guardRejectsStripped"]).toBe(true);
    expect(facts["card.strippedRefused"]).toBe("card.non-advisory-input");
    expect(facts["ctxCard.confidenceBps"]).toBeNull();
  });

  it("counterfactual: both branches carry distinct provenance digests", () => {
    const { facts } = runJourney(journey("security.counterfactual-reasoning"));
    expect(facts["cf.kind"]).toBe("HYPOTHETICAL");
    expect(facts["cf.provenancesDiffer"]).toBe(true);
    expect(facts["cf.divergence3.deltaBpsOfBaseline"]).toBe(2500);
  });

  it("inspect why: full A4 lineage is presentable end-to-end", () => {
    const { facts } = runJourney(journey("security.inspect-why"));
    expect(facts["action.stateHistory"]).toEqual([
      "authorized", "confirmed", "dispatched", "executing", "executed", "verified", "recorded",
    ]);
    expect(facts["view.chainDigestVerifies"]).toBe(true);
    expect(facts["view.tamperedVerifies"]).toBe(false);
    expect(facts["pending.guardianNull"]).toBe(true);
  });

  it("learning: proposals stay proposals until the Guardian path authorizes", () => {
    const { facts } = runJourney(journey("security.learn-from-outcomes"));
    expect(facts["adoption.initialStatus"]).toBe("pending");
    expect(facts["adoption.authorizeFromProposedOk"]).toBe(false);
    expect(facts["adoption.authorizedStage"]).toBe("authorized");
  });

  it("learning: certification revocation cascades to dependent proposals", () => {
    const { facts } = runJourney(journey("security.learn-from-outcomes"));
    expect(facts["cascade.rejected"]).toEqual(["prop-fleetos.asset.read-state-1.0.0-acme-ops"]);
    expect(facts["cascade.rejectedReasonCode"]).toBe("certification-revoked");
    expect(facts["cascade.adoptedUnchanged"]).toBe("adopted");
  });

  it("benchmark trust: the scorecard presents REAL numbers verbatim", () => {
    const { facts } = runJourney(journey("security.benchmark-trust"));
    expect(facts["scoring.standardHitRateBps"]).toBe(5000);
    expect(facts["scoring.shortHitRateBps"]).toBe(10000);
    expect(facts["report.hitRatesMatchScoring"]).toBe(true);
    expect(facts["report.verified"]).toBe(true);
  });

  it("benchmark trust: an envelope violation is visible, not softened", () => {
    const { facts } = runJourney(journey("security.benchmark-trust"));
    expect(facts["tight.passed"]).toBe(false);
    expect(facts["tight.envelopePassed"]).toBe(false);
    expect(facts["tight.envelopeViolationCount"]).toBeGreaterThan(0);
    expect(facts["tight.firstViolationCase"]).toBe("case-tight");
  });

  it("agent safety: revocation propagates and the agent cannot act", () => {
    const { facts } = runJourney(journey("security.agent-safety"));
    expect(facts["revoke.childPropagatedReason"]).toBe("propagated:grant-agent-root");
    // REAL behavior: revokeGrant PROPAGATES and directly revokes the derived
    // grant, so verifyGrantChain refuses the child as `grant.revoked` (the
    // queried grant itself is revoked); the root cause is carried by the
    // propagated revocationReason asserted above. `grant.ancestor-revoked` is
    // only reachable when an ancestor is revoked WITHOUT propagation — a
    // state revokeGrant never produces (see docs/evidence/F270B/report.md).
    expect(facts["revoke.childRefusal"]).toBe("grant.revoked");
    expect(facts["revoke.activeCountAfter"]).toBe(0);
    expect(facts["agent.aloneVerdict"]).toBe("BLOCK");
  });

  it("tenancy: every read/write surface refuses cross-tenant input", () => {
    const { facts } = runJourney(journey("security.tenant-fail-closed"));
    expect(facts["views.crossOk"]).toBe(false);
    expect(facts["queue.crossOk"]).toBe(false);
    expect(facts["ledger.crossOk"]).toBe(false);
    expect(facts["action.crossOk"]).toBe(false);
    expect(facts["adoption.crossOk"]).toBe(false);
    expect(facts["caseset.crossOk"]).toBe(false);
  });

  it("guardian e2e: a blocked decision never authorizes a command (Guardian never bypassed)", () => {
    const { facts } = runJourney(journey("security.guardian-e2e"));
    expect(facts["authorize.blockedOk"]).toBe(false);
    expect(facts["authorize.blockedReason"]).toBe("refused.block_verdict");
    expect(facts["intent.draft"]).toBe(true);
    expect(facts["remediation.finalState"]).toBe("verified");
    expect(facts["audit.trailVerified"]).toBe(true);
  });

  it("guardian e2e: the end-to-end chain completes with verification + audit", () => {
    const { facts } = runJourney(journey("security.guardian-e2e"));
    expect(facts["finding.admitted"]).toBe(1);
    expect(facts["evidence.chainVerified"]).toBe(true);
    expect(facts["execution.finalStatus"]).toBe("completed");
    expect(facts["action.finalState"]).toBe("recorded");
    expect(facts["action.verificationVerified"]).toBe(true);
    expect(facts["audit.tamperedVerified"]).toBe(false);
  });

  it("mission replay: deterministic replay with divergence detection + fail-closed refusals", () => {
    const { facts } = runJourney(journey("security.mission-replay"));
    expect(facts["replay.timelineLength"]).toBe(10);
    expect(facts["replay.deterministic"]).toBe(true);
    expect(facts["diverge.kindField"]).toBe("kind");
    expect(facts["foreign.journalReason"]).toBe("replay.tenant-mismatch");
    expect(facts["foreign.brokenReason"]).toBe("replay.ledger-refused");
  });

  it("predictive honesty: JEPA labeled structural, never trained; unknown models refused", () => {
    const { facts } = runJourney(journey("security.predictive-honesty"));
    expect(facts["class.jepa.modelClass"]).toBe("deterministic-structural-reference");
    expect(facts["class.jepa.trainedValidated"]).toBe(false);
    expect(facts["registry.trainedCount"]).toBe(0);
    expect(facts["class.unknownReason"]).toBe("honesty.unknown-model-identity");
    expect(facts["route.unknownModelReason"]).toBe("advisory.model-honesty-refused");
  });

  it("host surface: contract laws hold over the real composed slice", () => {
    const { facts } = runJourney(journey("security.host-surface"));
    expect(facts["surface.id"]).toBe("safety-intel");
    expect(facts["surface.routeCount"]).toBe(7);
    expect(facts["vm.deterministic"]).toBe(true);
    expect(facts["intent.draftMarker"]).toBe(true);
    expect(facts["tenant.findingCode"]).toBe("views.cross-tenant-finding");
    expect(facts["tenant.predictionCode"]).toBe("advisory.cross-tenant-prediction");
  });
});

describe("F321B journey spot checks (REAL behaviors)", () => {
  it("audit ledger: removal is pinned at the gap and the anchor catches truncation", () => {
    const { facts } = runJourney(journey("security.tamper-evident-audit-ledger"));
    expect(facts["tamper.dropped.reason"]).toBe("audit.gap");
    expect(facts["tamper.dropped.gapAt"]).toBe(1);
    expect(facts["anchor.truncated.flagged"]).toBe(true);
    expect(facts["anchor.truncated.internalStillVerifies"]).toBe(true);
  });

  it("audit ledger: every append refusal is machine-stable", () => {
    const { facts } = runJourney(journey("security.tamper-evident-audit-ledger"));
    expect(facts["refusal.missingTenant"]).toBe("audit.missing-tenant");
    expect(facts["refusal.crossTenantReason"]).toBe("audit.tenant-mismatch");
    expect(facts["refusal.invalidSequence"]).toBe("audit.invalid-sequence");
  });

  it("finding storm: the duplicate storm dedupes to an order-invariant survivor set", () => {
    const { facts } = runJourney(journey("security.finding-storm-triage"));
    expect(facts["storm.survived"]).toBe(4);
    expect(facts["storm.duplicates"]).toBe(2);
    expect(facts["storm.permutationInvariant"]).toBe(true);
    expect(facts["storm.queue.escalated.severity"]).toBe("high");
  });

  it("finding storm: the triage bound refuses with exact counts", () => {
    const { facts } = runJourney(journey("security.finding-storm-triage"));
    expect(facts["bound.overflowRefusal"]).toBe("triage.queue-overflow");
    expect(facts["bound.overflowReceived"]).toBe(4);
    expect(facts["bound.crossTenantRefusal"]).toBe("storm.tenant-mismatch");
  });

  it("suppression: an expired suppression honestly returns the finding to open", () => {
    const { facts } = runJourney(journey("security.finding-suppression-lifecycle"));
    expect(facts["expire.at.state"]).toBe("expired_suppression");
    expect(facts["expire.at.effectivelyOpen"]).toBe(true);
    expect(facts["expire.before.state"]).toBe("suppressed");
    expect(facts["resolve.suppressionCleared"]).toBe(null);
  });

  it("verified dispatch: the backoff schedule gates dueCommands exactly", () => {
    const { facts } = runJourney(journey("security.verified-execution-dispatch"));
    expect(facts["due.atT3.keys"]).toEqual(["dispatch-cmd-2"]);
    expect(facts["due.atT4.keys"]).toEqual(["dispatch-cmd-1", "dispatch-cmd-2"]);
    expect(facts["due.failed.nextAttemptAt"]).toBe(1791831004000);
    expect(facts["idem.intersectionHolds"]).toBe(true);
  });

  it("verified dispatch: the incident trail seals all three surfaces, order-invariantly", () => {
    const { facts } = runJourney(journey("security.verified-execution-dispatch"));
    expect(facts["trail.inputOrderInvariant"]).toBe(true);
    expect(facts["trail.verified"]).toBe(true);
    expect(facts["trail.crossTenantOffender"]).toBe("execution.entry:foreign-cmd-1#0");
  });

  it("compensation: a revert without Guardian authorization refuses", () => {
    const { facts } = runJourney(journey("security.action-compensation-rollback"));
    expect(facts["reversible.refusedReason"]).toBe("compensated.guardian_refused");
    expect(facts["reversible.succeededReason"]).toBe("compensated.successfully");
    expect(facts["irreversible.attemptReason"]).toBe("compensated.requires_manual_intervention");
  });

  it("compensation: terminal records are never rewritten", () => {
    const { facts } = runJourney(journey("security.action-compensation-rollback"));
    expect(facts["cancel.terminalNoop"]).toBe(true);
    expect(facts["cancel.terminalHistoryLen"]).toBe(1);
    expect(facts["cancel.attemptReason"]).toBe("compensated.no_side_effects");
  });

  it("capability DR: revocation is permanent across snapshot/restore", () => {
    const { facts } = runJourney(journey("security.capability-store-dr"));
    expect(facts["dr.postRestore.outcome"]).toBe("deny");
    expect(facts["dr.postRestore.outcomeReason"]).toBe("grant.revoked");
    expect(facts["dr.equivalence.equivalent"]).toBe(true);
    expect(facts["dr.tamperedReason"]).toBe("store.snapshot-digest-mismatch");
  });

  it("capability DR: the tombstone propagates to derived grants", () => {
    const { facts } = runJourney(journey("security.capability-store-dr"));
    expect(facts["revoke.tombstoneRevokedIds"]).toEqual(["grant-dr-child", "grant-dr-root"]);
    expect(facts["revoke.decision.outcomeReason"]).toBe("grant.revoked");
  });

  it("evaluation adoption: below threshold emits no proposal, honestly", () => {
    const { facts } = runJourney(journey("security.outcome-evaluation-adoption"));
    expect(facts["proposal.belowThreshold"]).toBe(null);
    expect(facts["proposal.belowReason"]).toBe("success rate 0.8 below threshold 0.9");
    expect(facts["proposal.status"]).toBe("pending");
  });

  it("evaluation adoption: rejection routes through Guardian review, never from proposed", () => {
    const { facts } = runJourney(journey("security.outcome-evaluation-adoption"));
    expect(facts["reject.fromProposedCode"]).toBe("illegal-transition");
    expect(facts["reject.finalStage"]).toBe("rejected");
    expect(facts["reject.reasonCode"]).toBe("insufficient-evidence");
    expect(facts["withdraw.finalStage"]).toBe("withdrawn");
  });

  it("jepa family: masked and rollout adapters stay deterministic structural references", () => {
    const { facts } = runJourney(journey("security.jepa-family-honesty"));
    expect(facts["family.masked.modelVersion"]).toBe("jepa-1.0.0");
    expect(facts["family.masked.deterministic"]).toBe(true);
    expect(facts["family.rollout.deterministic"]).toBe(true);
    expect(facts["cf.hypothetical"]).toBe(true);
  });

  it("jepa family: the benchmark is byte-identical across re-runs and fresh construction", () => {
    const { facts } = runJourney(journey("security.jepa-family-honesty"));
    expect(facts["bench.rowCount"]).toBe(15);
    expect(facts["bench.everyRowHypothetical"]).toBe(true);
    expect(facts["bench.rerunIdentical"]).toBe(true);
    expect(facts["bench.freshSpaceIdentical"]).toBe(true);
  });

  it("degradation staleness: every degraded state is named, never faked", () => {
    const { facts } = runJourney(journey("security.degradation-staleness-honesty"));
    expect(facts["degraded.unavailableState"]).toBe("model_unavailable");
    expect(facts["degraded.noHistoryState"]).toBe("insufficient_history");
    expect(facts["degraded.noTenantState"]).toBe("tenant_isolated");
  });

  it("degradation staleness: worst-of propagation never re-scores; forged headlines fail", () => {
    const { facts } = runJourney(journey("security.degradation-staleness-honesty"));
    expect(facts["staleness.headline"]).toBe("unknown");
    expect(facts["staleness.rescored"]).toBe(false);
    expect(facts["staleness.forgedReason"]).toBe("staleness.headline-mismatch");
    expect(facts["staleness.crossOffender"]).toBe("obs-foreign-1");
  });

  it("posture fold: checkpoint/resume lands byte-identical to the full fold", () => {
    const { facts } = runJourney(journey("security.posture-fold-determinism"));
    expect(facts["checkpoint.resumeIdenticalToFull"]).toBe(true);
    expect(facts["checkpoint.digestRecomputes"]).toBe(true);
    expect(facts["fold.outOfOrderIdentical"]).toBe(true);
    expect(facts["fold.duplicateSeqCollapsed"]).toBe(true);
  });

  it("posture fold: the expired suppression returns the finding to open in the fold", () => {
    const { facts } = runJourney(journey("security.posture-fold-determinism"));
    expect(facts["fold.findings"]).toEqual(["finding-alpha:open:high", "finding-beta:resolved:low"]);
    expect(facts["posture.postureScore"]).toBe(20);
    expect(facts["posture.crossReadReason"]).toBe("posture.tenant-mismatch");
  });
});
