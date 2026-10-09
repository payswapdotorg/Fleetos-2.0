/**
 * Journey 15 — mission replay on REAL package outputs (F300B deliverable 3;
 * persona: compliance-auditor).
 *
 * An auditor replays a completed mission's records — the REAL execution
 * ledger + the REAL action audit journal + the REAL Guardian reasoning
 * trace — through the lane's replay-of-record surfaces:
 *   - `replayIncident` merges ledger + journal into one canonical timeline
 *     with per-step digests and a whole-replay digest;
 *   - `replayExecutionLedger` rebuilds the command view from the ledger
 *     alone (byte-identical on re-replay);
 *   - `diffIncidentReplays` pins the FIRST divergence with its field class
 *     (a tampered journal kind, a dropped ledger entry);
 *   - NEGATIVE: cross-tenant journal/ledger entries REFUSE the replay
 *     (A8), offender named;
 *   - NEGATIVE: a structurally broken ledger REFUSES the replay
 *     (`replay.ledger-refused`) — never a fabricated timeline.
 *
 * HONEST SCOPE (recorded in docs/evidence/F300B/report.md): the durable
 * MissionJournal replay surface belongs to the TL-owned @fleetos/mission
 * package (kernel-only dependency, outside this lane's ownership); this
 * journey replays THIS lane's real records — the execution ledger and the
 * action audit journal every mission leaves behind. The mission-package
 * replay view is a TL shell integration proposal (S-3), not lane work.
 */

import type { AcceptanceJourney } from "../journey-contracts.ts";
import {
  diffIncidentReplays,
  replayExecutionLedger,
  replayIncident,
  verifyExecutionLedger,
  verifyIncidentReplayDeterminism,
} from "@fleetos/execution";
import type { IncidentReplay } from "@fleetos/execution";
import { emitAuditTrail } from "@fleetos/actions";
import type { ActionAuditEvent } from "@fleetos/actions";
import {
  buildDecisionAuditRef,
  buildDecisionRecord,
  evaluateCapability,
  evaluateRulesOrdered,
} from "@fleetos/policy";
import type { DecisionRecord } from "@fleetos/policy";
import {
  EXECUTE_CAPABILITY,
  NOW_MS,
  OPERATOR_CTX,
  TENANT,
  FOREIGN_TENANT,
  isoOfEpochMs,
  tenantPolicy,
} from "./fixture-world.ts";
import { missionAction, missionLedger } from "./wave10-world.ts";

export const missionReplayJourney: AcceptanceJourney = {
  journeyId: "security.mission-replay",
  persona: "compliance-auditor",
  capabilities: ["mission-replay", "decision-provenance", "execution-ledger"],
  goal: "Replay a completed mission's real records deterministically and detect any divergence",
  steps: [
    {
      stepId: "reasoning-trace",
      kind: "guardian-decision",
      description: "Seal the REAL Guardian reasoning trace the mission decisions leave behind",
      packages: ["@fleetos/policy"],
      operations: ["evaluateCapability", "evaluateRulesOrdered", "buildDecisionRecord", "buildDecisionAuditRef"],
      run: (ctx) => {
        const policy = tenantPolicy();
        const decision = evaluateCapability(policy, EXECUTE_CAPABILITY, OPERATOR_CTX(EXECUTE_CAPABILITY));
        const ordered = evaluateRulesOrdered(policy, EXECUTE_CAPABILITY, OPERATOR_CTX(EXECUTE_CAPABILITY));
        if (!ordered.ok) throw new Error(`ordered evaluation refused: ${ordered.reason}`);
        const record: DecisionRecord = buildDecisionRecord(decision, {
          policyId: policy.id,
          policyVersion: policy.version,
          capability: EXECUTE_CAPABILITY,
          actorId: "operator-ada",
          actorIsAutonomous: false,
          actorAuthority: ["tenant.operator", "human.approval", "asset.owner"],
          evaluatedAt: isoOfEpochMs(NOW_MS + 500),
          matchedFacts: ordered.evaluation.decisions[0]?.matchedFacts ?? [],
        });
        const audit = buildDecisionAuditRef(ordered.evaluation, NOW_MS + 500);
        if (!audit.ok) throw new Error("audit ref refused");
        ctx.record("trace.decisionVerdict", decision.verdict);
        ctx.record("trace.decisionCount", ordered.evaluation.decisions.length);
        ctx.record("trace.recordIdPrefix", record.recordId.startsWith("rec-fleetos.device.execute-command-"));
        ctx.record("trace.recordDigestLength", record.recordDigest.length);
        ctx.record("trace.auditRefPrefix", audit.ref.auditRefId.startsWith("audit-"));
        ctx.record("trace.auditRefCarriesTime", audit.ref.auditRefId.endsWith(String(NOW_MS + 500)));
        ctx.record("trace.auditInputsDigestLength", audit.ref.inputsDigest.length);
      },
    },
    {
      stepId: "incident-replay",
      kind: "ledger",
      description: "Replay the mission's REAL ledger + journal into the canonical timeline",
      packages: ["@fleetos/execution", "@fleetos/actions"],
      operations: ["replayIncident", "verifyIncidentReplayDeterminism", "emitAuditTrail"],
      run: (ctx) => {
        const ledger = missionLedger();
        const journal: readonly ActionAuditEvent[] = emitAuditTrail(missionAction(), "engineer-raj");
        const result = replayIncident({ tenantId: TENANT.tenantId, ledger, journal });
        if (!result.ok) throw new Error(`incident replay refused: ${result.reason}`);
        const replay: IncidentReplay = result.replay;
        ctx.record("replay.timelineLength", replay.timeline.length);
        ctx.record("replay.commandCount", replay.commands.length);
        ctx.record("replay.commandStatus", replay.commands[0]?.status ?? "none");
        ctx.record("replay.decisionSequenceLength", replay.decisionSequence.length);
        ctx.record("replay.digestLength", replay.replayDigest.length);
        ctx.record("replay.step0Source", replay.timeline[0]?.source ?? "none");
        ctx.record("replay.lastStepKind", replay.timeline[replay.timeline.length - 1]?.kind ?? "none");
        const determinism = verifyIncidentReplayDeterminism({ tenantId: TENANT.tenantId, ledger, journal });
        ctx.record("replay.deterministic", determinism.deterministic);
        const rerun = replayIncident({ tenantId: TENANT.tenantId, ledger, journal });
        if (!rerun.ok) throw new Error("re-replay refused");
        ctx.record("replay.redigestStable", rerun.replay.replayDigest === replay.replayDigest);
        // The INCIDENT layer canonicalizes by RECORDED index — a reordered
        // ledger copy still produces the byte-identical timeline.
        const reorderedIncident = replayIncident({ tenantId: TENANT.tenantId, ledger: [...ledger].reverse(), journal });
        if (!reorderedIncident.ok) throw new Error("reordered incident replay refused");
        ctx.record("replay.reorderedIncidentStable", reorderedIncident.replay.replayDigest === replay.replayDigest);
        ctx.record("replay.journalEventCount", journal.length);
        ctx.record("replay.ledgerVerified", verifyExecutionLedger(ledger).verified);
      },
    },
    {
      stepId: "ledger-replay",
      kind: "ledger",
      description: "Rebuild the command view from the ledger alone and check tamper detection",
      packages: ["@fleetos/execution"],
      operations: ["replayExecutionLedger", "verifyExecutionLedger"],
      run: (ctx) => {
        const ledger = missionLedger();
        const replay = replayExecutionLedger(ledger);
        if (!replay.ok) throw new Error(`ledger replay refused: ${replay.reason}`);
        ctx.record("ledgerReplay.commandCount", replay.commands.length);
        ctx.record("ledgerReplay.status", replay.commands[0]?.status ?? "none");
        ctx.record("ledgerReplay.lastKind", replay.commands[0]?.lastKind ?? "none");
        // HONEST LAYERING: the RAW ledger replay iterates ARRAY order — a
        // reversed copy refuses with index_gap (an acked entry whose
        // submitted predecessor is gone). Canonicalization-by-recorded-index
        // belongs to the INCIDENT replay layer (asserted above: a reordered
        // copy fed to replayIncident still produces the same timeline).
        const reordered = replayExecutionLedger([...ledger].reverse());
        ctx.record("ledgerReplay.reorderedOk", reordered.ok);
        ctx.record("ledgerReplay.reorderedReason", reordered.ok ? "unexpected-allow" : reordered.reason);
        const tampered = [...ledger];
        (tampered[1] as { detail: string }).detail = "forged";
        const tamperVerify = verifyExecutionLedger(tampered);
        ctx.record("ledgerReplay.tamperedVerified", tamperVerify.verified);
        ctx.record("ledgerReplay.tamperedBrokenAt", tamperVerify.brokenAt);
      },
    },
    {
      stepId: "divergence-and-refusals",
      kind: "negative-check",
      description: "Divergence detection over tampered replays + cross-tenant fail-closed refusals",
      packages: ["@fleetos/execution", "@fleetos/actions"],
      operations: ["diffIncidentReplays", "replayIncident"],
      run: (ctx) => {
        const ledger = missionLedger();
        const journal: readonly ActionAuditEvent[] = emitAuditTrail(missionAction(), "engineer-raj");
        const recorded = replayIncident({ tenantId: TENANT.tenantId, ledger, journal });
        if (!recorded.ok) throw new Error("recorded replay refused");

        // A tampered journal kind diverges at the first journal step.
        const tamperedJournal = journal.map((e, i) => (i === 0 ? { ...e, kind: "action.cancelled" as const } : e));
        const tamperedReplay = replayIncident({ tenantId: TENANT.tenantId, ledger, journal: tamperedJournal });
        if (!tamperedReplay.ok) throw new Error("tampered replay refused");
        const kindDivergence = diffIncidentReplays(recorded.replay, tamperedReplay.replay);
        ctx.record("diverge.kindDiverged", kindDivergence.diverged);
        ctx.record("diverge.kindField", kindDivergence.field);
        ctx.record("diverge.kindStepIndex", kindDivergence.stepIndex);

        // A dropped ledger entry diverges on timeline length.
        const shortLedger = ledger.slice(0, 2);
        const shortReplay = replayIncident({ tenantId: TENANT.tenantId, ledger: shortLedger, journal });
        if (!shortReplay.ok) throw new Error("short replay refused");
        const lengthDivergence = diffIncidentReplays(recorded.replay, shortReplay.replay);
        ctx.record("diverge.lengthDiverged", lengthDivergence.diverged);
        ctx.record("diverge.lengthField", lengthDivergence.field);

        // NEGATIVE: cross-tenant journal entry refuses the replay (A8).
        const foreignJournal = journal.map((e, i) => (i === 0 ? { ...e, tenantId: FOREIGN_TENANT.tenantId } : e));
        const foreignJournalReplay = replayIncident({ tenantId: TENANT.tenantId, ledger, journal: foreignJournal });
        ctx.record("foreign.journalOk", foreignJournalReplay.ok);
        ctx.record("foreign.journalReason", foreignJournalReplay.ok ? "unexpected-allow" : foreignJournalReplay.reason);
        ctx.record("foreign.journalOffender", foreignJournalReplay.ok ? "none" : foreignJournalReplay.offender);

        // NEGATIVE: cross-tenant ledger entry refuses the replay (A8).
        const foreignLedger = ledger.map((e, i) => (i === 0 ? { ...e, tenantId: FOREIGN_TENANT.tenantId } : e));
        const foreignLedgerReplay = replayIncident({ tenantId: TENANT.tenantId, ledger: foreignLedger, journal });
        ctx.record("foreign.ledgerOk", foreignLedgerReplay.ok);
        ctx.record("foreign.ledgerReason", foreignLedgerReplay.ok ? "unexpected-allow" : foreignLedgerReplay.reason);
        ctx.record("foreign.ledgerOffender", foreignLedgerReplay.ok ? "none" : foreignLedgerReplay.offender);

        // NEGATIVE: a structurally broken ledger (acked/completed entries
        // whose submitted predecessor was dropped) refuses the replay
        // honestly — never a fabricated timeline.
        const brokenLedger = ledger.slice(1);
        const brokenReplay = replayIncident({ tenantId: TENANT.tenantId, ledger: brokenLedger, journal });
        ctx.record("foreign.brokenOk", brokenReplay.ok);
        ctx.record("foreign.brokenReason", brokenReplay.ok ? "unexpected-allow" : brokenReplay.reason);
      },
    },
  ],
  assertions: [
    { assertionId: "mr-1", description: "The reasoning trace carries the escalation verdict", path: "trace.decisionVerdict", expected: "REQUIRE_APPROVAL" },
    { assertionId: "mr-2", description: "One rule decision in the ordered trace", path: "trace.decisionCount", expected: 1 },
    { assertionId: "mr-3", description: "Decision record id derived from the capability + digest", path: "trace.recordIdPrefix", expected: true },
    { assertionId: "mr-4", description: "Decision record digest is FNV-1a 8-hex", path: "trace.recordDigestLength", expected: 8 },
    { assertionId: "mr-5", description: "Audit ref id is digest+time derived", path: "trace.auditRefPrefix", expected: true },
    { assertionId: "mr-5b", description: "Audit ref carries the logical evaluation time", path: "trace.auditRefCarriesTime", expected: true },
    { assertionId: "mr-6", description: "Audit inputs digest is FNV-1a 8-hex", path: "trace.auditInputsDigestLength", expected: 8 },
    { assertionId: "mr-7", description: "Timeline merges ledger + journal (3 + 7 steps)", path: "replay.timelineLength", expected: 10 },
    { assertionId: "mr-8", description: "One command rebuilt from the merged records", path: "replay.commandCount", expected: 1 },
    { assertionId: "mr-9", description: "The command completed", path: "replay.commandStatus", expected: "completed" },
    { assertionId: "mr-10", description: "Per-step digests cover the whole timeline", path: "replay.decisionSequenceLength", expected: 10 },
    { assertionId: "mr-11", description: "Whole-replay digest is FNV-1a 8-hex", path: "replay.digestLength", expected: 8 },
    { assertionId: "mr-12", description: "The first timeline step comes from the journal (authorize precedes submit)", path: "replay.step0Source", expected: "journal" },
    { assertionId: "mr-13", description: "The last timeline step is the recorded emission", path: "replay.lastStepKind", expected: "action.recorded" },
    { assertionId: "mr-14", description: "Re-replay is deterministic", path: "replay.deterministic", expected: true },
    { assertionId: "mr-15", description: "Re-replay digest is byte-stable", path: "replay.redigestStable", expected: true },
    { assertionId: "mr-15b", description: "A reordered ledger copy produces the identical incident timeline (recorded index is the truth)", path: "replay.reorderedIncidentStable", expected: true },
    { assertionId: "mr-16", description: "The journal carries one emission per state transition", path: "replay.journalEventCount", expected: 7 },
    { assertionId: "mr-17", description: "The replayed ledger verifies", path: "replay.ledgerVerified", expected: true },
    { assertionId: "mr-18", description: "Ledger replay rebuilds the command", path: "ledgerReplay.commandCount", expected: 1 },
    { assertionId: "mr-19", description: "Ledger replay status is completed", path: "ledgerReplay.status", expected: "completed" },
    { assertionId: "mr-20", description: "Last event kind is completed", path: "ledgerReplay.lastKind", expected: "completed" },
    { assertionId: "mr-21", description: "A reversed ledger copy refuses the RAW replay (array order matters at this layer)", path: "ledgerReplay.reorderedOk", expected: false },
    { assertionId: "mr-21b", description: "The raw-replay refusal is the index gap", path: "ledgerReplay.reorderedReason", expected: "ledger.index_gap" },
    { assertionId: "mr-22", description: "A tampered ledger entry fails verification", path: "ledgerReplay.tamperedVerified", expected: false },
    { assertionId: "mr-23", description: "The tamper break is located", path: "ledgerReplay.tamperedBrokenAt", expected: 1 },
    { assertionId: "mr-24", description: "A tampered journal kind diverges", path: "diverge.kindDiverged", expected: true },
    { assertionId: "mr-25", description: "The divergence names the kind field", path: "diverge.kindField", expected: "kind" },
    { assertionId: "mr-26", description: "The divergence pins the first journal step", path: "diverge.kindStepIndex", expected: 0 },
    { assertionId: "mr-27", description: "A dropped ledger entry diverges", path: "diverge.lengthDiverged", expected: true },
    { assertionId: "mr-28", description: "The divergence pins the first differing step (the vanished ledger entry shifts the journal event up at the 3000ms tie)", path: "diverge.lengthField", expected: "source" },
    { assertionId: "mr-29", description: "Cross-tenant journal entry refuses the replay (A8)", path: "foreign.journalOk", expected: false },
    { assertionId: "mr-30", description: "Refusal reason: tenant mismatch", path: "foreign.journalReason", expected: "replay.tenant-mismatch" },
    { assertionId: "mr-31", description: "The offending journal event is named", path: "foreign.journalOffender", expected: "journal:audit-intent-mission-replay-1-proposed-authorized" },
    { assertionId: "mr-32", description: "Cross-tenant ledger entry refuses the replay (A8)", path: "foreign.ledgerOk", expected: false },
    { assertionId: "mr-33", description: "Refusal reason: tenant mismatch", path: "foreign.ledgerReason", expected: "replay.tenant-mismatch" },
    { assertionId: "mr-34", description: "The offending ledger entry is named", path: "foreign.ledgerOffender", expected: "ledger#0" },
    { assertionId: "mr-35", description: "A structurally broken ledger refuses the replay (no fabricated timeline)", path: "foreign.brokenOk", expected: false },
    { assertionId: "mr-36", description: "The structural refusal reason is the ledger", path: "foreign.brokenReason", expected: "replay.ledger-refused" },
  ],
};
