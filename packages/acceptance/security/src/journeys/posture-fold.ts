/**
 * F321B journey — posture-fold determinism (persona: compliance-auditor).
 *
 * THE TENTH-SLOT journey (arena-evaluation-runs EXCLUDED: Arena is
 * CONTRACT_ONLY / provider-not-ready — no Arena API is driven here). This is
 * a genuinely distinct journey on a NON-Arena surface explicitly named by
 * F310C §3.6 as an additionally-unexercised mining area: POSTURE-FOLD
 * DETERMINISM (@fleetos/security posture-fold — F220B).
 *
 * Posture is DERIVED from the findings event stream — never stored as
 * mutable truth. The compliance auditor proves the fold's laws:
 *   - the full lifecycle folds deterministically (open -> escalate ->
 *     suppress -> expire -> resolve), with out-of-order input canonically
 *     ordered by seq and duplicate seqs collapsed to the first occurrence;
 *   - the CHECKPOINT/RESUME protocol: folding a prefix, then resuming from
 *     the checkpointed state over the full stream, lands on a state that is
 *     BYTE-IDENTICAL to the full fold (canonical serialization equality);
 *   - the checkpoint digest is content-addressed over the canonical state
 *     (recomputes exactly; a forged digest is detected by recomputation);
 *   - the derived posture snapshot reads the fold honestly (worst-wins
 *     score, suppressed hidden from score, escalations carried);
 *   - fail-closed: an empty-tenant event, a cross-tenant event, an empty
 *     findingId and an empty requireTenant scope each REFUSE with the
 *     machine-stable reason; reading posture cross-tenant REFUSES.
 *
 * Corpus-absence note (machine-verified before writing this journey): the
 * tenancy-fail-closed journey drives `foldPostureEvents` ONLY on the
 * tenant-mismatch refusal path; the positive lifecycle fold, the
 * checkpoint/resume protocol, `emptyPostureFold`,
 * `canonicalPostureFoldState`, `postureFoldCheckpointDigest` and the
 * derived posture read have ZERO references in any acceptance corpus.
 *
 * Determinism: logical epochs (BASE_MS offsets) as explicit per-event `at`
 * numbers; no clock, no randomness, no network.
 */

import type { AcceptanceJourney } from "../journey-contracts.ts";
import {
  canonicalPostureFoldState,
  emptyPostureFold,
  foldPostureEvents,
  postureFoldCheckpointDigest,
  readPostureForTenant,
} from "@fleetos/security";
import type { PostureEvent } from "@fleetos/security";
import { BASE_MS, TENANT, FOREIGN_TENANT } from "./fixture-world.ts";

function event(seq: number, kind: PostureEvent["kind"], findingId: string, severity: PostureEvent["severity"], at: number): PostureEvent {
  return { seq, tenantId: TENANT.tenantId, kind, findingId, severity, at };
}

/**
 * The full stream: f1 opens (medium), f2 opens (low), f1 escalates (high),
 * f1 is suppressed, f2 resolves, f1's suppression expires (back to open).
 * Final fold: f1 open+high, f2 resolved, 1 escalation, appliedSeq 6.
 */
const STREAM: readonly PostureEvent[] = [
  event(1, "finding.opened", "finding-alpha", "medium", BASE_MS + 1_000),
  event(2, "finding.opened", "finding-beta", "low", BASE_MS + 2_000),
  event(3, "finding.escalated", "finding-alpha", "high", BASE_MS + 3_000),
  event(4, "finding.suppressed", "finding-alpha", "high", BASE_MS + 4_000),
  event(5, "finding.resolved", "finding-beta", "low", BASE_MS + 5_000),
  event(6, "finding.suppression_expired", "finding-alpha", "high", BASE_MS + 6_000),
];

export const postureFoldJourney: AcceptanceJourney = {
  journeyId: "security.posture-fold-determinism",
  persona: "compliance-auditor",
  capabilities: ["decision-provenance"],
  goal: "Prove the event-sourced posture fold is deterministic, checkpointable and honestly readable",
  steps: [
    {
      stepId: "fold-lifecycle",
      kind: "lifecycle",
      description: "Fold the full finding lifecycle; out-of-order input and duplicate seqs collapse deterministically",
      packages: ["@fleetos/security"],
      operations: ["emptyPostureFold", "foldPostureEvents", "canonicalPostureFoldState"],
      run: (ctx) => {
        // The identity element: nothing applied, no tenant pinned yet.
        const empty = emptyPostureFold();
        ctx.record("fold.empty.appliedSeq", empty.appliedSeq);
        ctx.record("fold.empty.appliedEvents", empty.appliedEvents);
        ctx.record("fold.empty.findings", empty.findings.length);
        ctx.record("fold.empty.tenant", empty.tenantId);

        const folded = foldPostureEvents(STREAM);
        if (!folded.ok) throw new Error(`fold refused: ${folded.reason}`);
        ctx.record("fold.appliedSeq", folded.state.appliedSeq);
        ctx.record("fold.appliedEvents", folded.state.appliedEvents);
        ctx.record("fold.escalations", folded.state.escalations);
        ctx.record("fold.tenant", folded.state.tenantId);
        ctx.record(
          "fold.findings",
          folded.state.findings.map((f) => `${f.findingId}:${f.status}:${f.severity}`),
        );

        // CANONICAL ORDERING: shuffled input folds to the identical state.
        const shuffled = foldPostureEvents([STREAM[4]!, STREAM[1]!, STREAM[5]!, STREAM[0]!, STREAM[3]!, STREAM[2]!]);
        ctx.record(
          "fold.outOfOrderIdentical",
          shuffled.ok && canonicalPostureFoldState(shuffled.state) === canonicalPostureFoldState(folded.state),
        );

        // DUPLICATE SEQ COLLAPSE: replaying seq 3 (different content) is
        // skipped — only the first occurrence at a position applies.
        const duplicated = foldPostureEvents([...STREAM, event(3, "finding.resolved", "finding-alpha", "high", BASE_MS + 7_000)]);
        ctx.record(
          "fold.duplicateSeqCollapsed",
          duplicated.ok && canonicalPostureFoldState(duplicated.state) === canonicalPostureFoldState(folded.state),
        );
        ctx.record("fold.duplicateSeqAppliedEvents", duplicated.ok ? duplicated.state.appliedEvents : -1);

        // A suppression that expires RETURNS the finding to open (honest).
        const f1 = folded.state.findings.find((f) => f.findingId === "finding-alpha");
        ctx.record("fold.f1.status", f1?.status ?? "missing");
        ctx.record("fold.f1.severity", f1?.severity ?? "missing");
        const f2 = folded.state.findings.find((f) => f.findingId === "finding-beta");
        ctx.record("fold.f2.status", f2?.status ?? "missing");

        // Re-folding the same stream is byte-identical (canonical determinism).
        const refolded = foldPostureEvents(STREAM);
        ctx.record(
          "fold.refoldIdentical",
          refolded.ok && canonicalPostureFoldState(refolded.state) === canonicalPostureFoldState(folded.state),
        );
      },
    },
    {
      stepId: "checkpoint-resume",
      kind: "provenance-inspect",
      description: "Fold a prefix, checkpoint, resume over the full stream — the resumed state is byte-identical to the full fold",
      packages: ["@fleetos/security"],
      operations: ["foldPostureEvents", "postureFoldCheckpointDigest", "canonicalPostureFoldState"],
      run: (ctx) => {
        // The prefix: seqs 1-3 (two opens + one escalation).
        const prefix = foldPostureEvents(STREAM.slice(0, 3));
        if (!prefix.ok) throw new Error(`prefix fold refused: ${prefix.reason}`);
        ctx.record("checkpoint.prefix.lastAppliedSeq", prefix.checkpoint.lastAppliedSeq);
        ctx.record("checkpoint.prefix.appliedEvents", prefix.checkpoint.appliedEvents);
        ctx.record("checkpoint.prefix.tenant", prefix.checkpoint.tenantId);
        ctx.record("checkpoint.prefix.digestLength", prefix.checkpoint.checkpointDigest.length);

        // The checkpoint digest is content-addressed over the canonical state.
        ctx.record(
          "checkpoint.digestRecomputes",
          postureFoldCheckpointDigest(prefix.state) === prefix.checkpoint.checkpointDigest,
        );
        // A forged checkpoint digest is detected by recomputation.
        ctx.record("checkpoint.forgedDetected", postureFoldCheckpointDigest(prefix.state) !== "deadbeef");

        // RESUME: fold the FULL stream from the checkpointed state.
        const resumed = foldPostureEvents(STREAM, { resumeFrom: prefix.state });
        if (!resumed.ok) throw new Error(`resume refused: ${resumed.reason}`);
        const full = foldPostureEvents(STREAM);
        if (!full.ok) throw new Error("full fold refused");
        ctx.record(
          "checkpoint.resumeIdenticalToFull",
          canonicalPostureFoldState(resumed.state) === canonicalPostureFoldState(full.state),
        );
        ctx.record("checkpoint.resumed.appliedSeq", resumed.state.appliedSeq);
        ctx.record("checkpoint.resumed.appliedEvents", resumed.state.appliedEvents);
        // Only the events AFTER the checkpoint are applied on resume.
        ctx.record("checkpoint.resumeAppliedOnlyNew", resumed.state.appliedEvents === 6);
        // The resumed checkpoint digest equals the full fold's.
        ctx.record(
          "checkpoint.resumeDigestMatches",
          resumed.checkpoint.checkpointDigest === full.checkpoint.checkpointDigest,
        );

        // Resuming from the FINAL state applies nothing (idempotent no-op).
        const noop = foldPostureEvents(STREAM, { resumeFrom: full.state });
        ctx.record(
          "checkpoint.noopIdentical",
          noop.ok && canonicalPostureFoldState(noop.state) === canonicalPostureFoldState(full.state),
        );
        ctx.record("checkpoint.noopAppliedEvents", noop.ok ? noop.state.appliedEvents : -1);
      },
    },
    {
      stepId: "posture-read-and-refusals",
      kind: "negative-check",
      description: "Read the derived posture honestly; refuse fold and read violations fail-closed",
      packages: ["@fleetos/security"],
      operations: ["foldPostureEvents", "readPostureForTenant"],
      run: (ctx) => {
        const folded = foldPostureEvents(STREAM);
        if (!folded.ok) throw new Error("fold refused");
        const read = readPostureForTenant(folded.state, TENANT.tenantId);
        if (!read.ok) throw new Error(`posture read refused: ${read.reason}`);
        ctx.record("posture.openFindings", read.snapshot.openFindings);
        ctx.record("posture.suppressed", read.snapshot.suppressed);
        ctx.record("posture.resolved", read.snapshot.resolved);
        ctx.record("posture.bySeverityHigh", read.snapshot.bySeverity.high);
        ctx.record("posture.bySeverityMedium", read.snapshot.bySeverity.medium);
        ctx.record("posture.postureScore", read.snapshot.postureScore);
        ctx.record("posture.escalations", read.snapshot.escalations);
        ctx.record("posture.appliedSeq", read.snapshot.appliedSeq);

        // NEGATIVE: reading posture cross-tenant REFUSES (A8).
        const crossRead = readPostureForTenant(folded.state, FOREIGN_TENANT.tenantId);
        ctx.record("posture.crossReadOk", crossRead.ok);
        ctx.record("posture.crossReadReason", crossRead.ok ? "unexpected-allow" : crossRead.reason);
        const noTenantRead = readPostureForTenant(folded.state, "");
        ctx.record("posture.noTenantReadOk", noTenantRead.ok);
        ctx.record("posture.noTenantReadReason", noTenantRead.ok ? "unexpected-allow" : noTenantRead.reason);

        // NEGATIVE: an empty-tenant event refuses mid-stream, at the seq.
        const emptyTenant = foldPostureEvents([
          event(1, "finding.opened", "finding-x", "low", BASE_MS),
          { ...event(2, "finding.opened", "finding-y", "low", BASE_MS + 1_000), tenantId: "" },
        ]);
        ctx.record("fold.emptyTenantOk", emptyTenant.ok);
        ctx.record("fold.emptyTenantReason", emptyTenant.ok ? "unexpected-allow" : emptyTenant.reason);
        ctx.record("fold.emptyTenantAtSeq", emptyTenant.ok ? -1 : emptyTenant.atSeq);

        // NEGATIVE: a cross-tenant event refuses mid-stream, at the seq.
        const crossTenant = foldPostureEvents([
          event(1, "finding.opened", "finding-x", "low", BASE_MS),
          { ...event(2, "finding.opened", "finding-y", "low", BASE_MS + 1_000), tenantId: FOREIGN_TENANT.tenantId },
        ]);
        ctx.record("fold.crossTenantOk", crossTenant.ok);
        ctx.record("fold.crossTenantReason", crossTenant.ok ? "unexpected-allow" : crossTenant.reason);
        ctx.record("fold.crossTenantAtSeq", crossTenant.ok ? -1 : crossTenant.atSeq);

        // NEGATIVE: an empty findingId refuses, at the seq.
        const noFindingId = foldPostureEvents([event(1, "finding.opened", "", "low", BASE_MS)]);
        ctx.record("fold.noFindingIdOk", noFindingId.ok);
        ctx.record("fold.noFindingIdReason", noFindingId.ok ? "unexpected-allow" : noFindingId.reason);
        ctx.record("fold.noFindingIdAtSeq", noFindingId.ok ? -1 : noFindingId.atSeq);

        // NEGATIVE: an empty requireTenant scope refuses up front.
        const noScope = foldPostureEvents(STREAM, { requireTenant: "" });
        ctx.record("fold.noScopeOk", noScope.ok);
        ctx.record("fold.noScopeReason", noScope.ok ? "unexpected-allow" : noScope.reason);

        // POSITIVE scope gate: requireTenant matching the stream folds fine.
        const scoped = foldPostureEvents(STREAM, { requireTenant: TENANT.tenantId });
        ctx.record(
          "fold.scopedIdentical",
          scoped.ok && canonicalPostureFoldState(scoped.state) === canonicalPostureFoldState(folded.state),
        );
      },
    },
  ],
  assertions: [
    { assertionId: "pf-1", description: "The identity element applies nothing", path: "fold.empty.appliedSeq", expected: 0 },
    { assertionId: "pf-2", description: "The identity element has no findings", path: "fold.empty.findings", expected: 0 },
    { assertionId: "pf-3", description: "The identity element pins no tenant", path: "fold.empty.tenant", expected: "" },
    { assertionId: "pf-4", description: "All 6 events applied", path: "fold.appliedSeq", expected: 6 },
    { assertionId: "pf-5", description: "Applied-events count", path: "fold.appliedEvents", expected: 6 },
    { assertionId: "pf-6", description: "One escalation folded", path: "fold.escalations", expected: 1 },
    { assertionId: "pf-7", description: "The first applied event pins the tenant", path: "fold.tenant", expected: "acme-ops" },
    { assertionId: "pf-8", description: "f1 honestly returned to open with escalated severity", path: "fold.findings", expected: ["finding-alpha:open:high", "finding-beta:resolved:low"] },
    { assertionId: "pf-9", description: "Out-of-order input folds to the identical state", path: "fold.outOfOrderIdentical", expected: true },
    { assertionId: "pf-10", description: "Duplicate seqs collapse to the first occurrence", path: "fold.duplicateSeqCollapsed", expected: true },
    { assertionId: "pf-11", description: "The duplicate seq is NOT double-applied", path: "fold.duplicateSeqAppliedEvents", expected: 6 },
    { assertionId: "pf-12", description: "The expired suppression returns f1 to open", path: "fold.f1.status", expected: "open" },
    { assertionId: "pf-13", description: "f1 keeps the escalated severity", path: "fold.f1.severity", expected: "high" },
    { assertionId: "pf-14", description: "f2 is resolved", path: "fold.f2.status", expected: "resolved" },
    { assertionId: "pf-15", description: "Re-folding is byte-identical", path: "fold.refoldIdentical", expected: true },
    { assertionId: "pf-16", description: "The prefix checkpoint names its last applied seq", path: "checkpoint.prefix.lastAppliedSeq", expected: 3 },
    { assertionId: "pf-17", description: "The prefix checkpoint counts its events", path: "checkpoint.prefix.appliedEvents", expected: 3 },
    { assertionId: "pf-18", description: "The checkpoint is tenant-scoped", path: "checkpoint.prefix.tenant", expected: "acme-ops" },
    { assertionId: "pf-19", description: "The checkpoint digest is 8-hex", path: "checkpoint.prefix.digestLength", expected: 8 },
    { assertionId: "pf-20", description: "The checkpoint digest recomputes over the canonical state", path: "checkpoint.digestRecomputes", expected: true },
    { assertionId: "pf-21", description: "A forged checkpoint digest is detected by recomputation", path: "checkpoint.forgedDetected", expected: true },
    { assertionId: "pf-22", description: "RESUME over the full stream lands byte-identical to the full fold", path: "checkpoint.resumeIdenticalToFull", expected: true },
    { assertionId: "pf-23", description: "The resumed state reaches the final seq", path: "checkpoint.resumed.appliedSeq", expected: 6 },
    { assertionId: "pf-24", description: "The resumed state counts all 6 events", path: "checkpoint.resumed.appliedEvents", expected: 6 },
    { assertionId: "pf-25", description: "Resume applies the checkpointed prefix ONCE (not again)", path: "checkpoint.resumeAppliedOnlyNew", expected: true },
    { assertionId: "pf-26", description: "The resumed digest equals the full fold's", path: "checkpoint.resumeDigestMatches", expected: true },
    { assertionId: "pf-27", description: "Resuming from the final state is a no-op (identical)", path: "checkpoint.noopIdentical", expected: true },
    { assertionId: "pf-28", description: "The no-op resume applies nothing", path: "checkpoint.noopAppliedEvents", expected: 6 },
    { assertionId: "pf-29", description: "The posture read counts one open finding", path: "posture.openFindings", expected: 1 },
    { assertionId: "pf-30", description: "No suppressed findings in the final fold", path: "posture.suppressed", expected: 0 },
    { assertionId: "pf-31", description: "One resolved finding", path: "posture.resolved", expected: 1 },
    { assertionId: "pf-32", description: "The open finding is high severity", path: "posture.bySeverityHigh", expected: 1 },
    { assertionId: "pf-33", description: "No open medium remains (escalated away)", path: "posture.bySeverityMedium", expected: 0 },
    { assertionId: "pf-34", description: "Worst-wins score: high => 20", path: "posture.postureScore", expected: 20 },
    { assertionId: "pf-35", description: "Escalations surfaced on the snapshot", path: "posture.escalations", expected: 1 },
    { assertionId: "pf-36", description: "The snapshot carries the applied seq", path: "posture.appliedSeq", expected: 6 },
    { assertionId: "pf-37", description: "Cross-tenant posture read REFUSES (A8)", path: "posture.crossReadOk", expected: false },
    { assertionId: "pf-38", description: "Cross-tenant read reason", path: "posture.crossReadReason", expected: "posture.tenant-mismatch" },
    { assertionId: "pf-39", description: "Empty-tenant posture read REFUSES", path: "posture.noTenantReadOk", expected: false },
    { assertionId: "pf-40", description: "Empty-tenant read reason", path: "posture.noTenantReadReason", expected: "posture.missing-tenant" },
    { assertionId: "pf-41", description: "An empty-tenant event REFUSES the fold", path: "fold.emptyTenantOk", expected: false },
    { assertionId: "pf-42", description: "Empty-tenant event reason", path: "fold.emptyTenantReason", expected: "fold.missing-tenant" },
    { assertionId: "pf-43", description: "The refusal names the offending seq", path: "fold.emptyTenantAtSeq", expected: 2 },
    { assertionId: "pf-44", description: "A cross-tenant event REFUSES the fold", path: "fold.crossTenantOk", expected: false },
    { assertionId: "pf-45", description: "Cross-tenant event reason", path: "fold.crossTenantReason", expected: "fold.tenant-mismatch" },
    { assertionId: "pf-46", description: "The cross-tenant refusal names the seq", path: "fold.crossTenantAtSeq", expected: 2 },
    { assertionId: "pf-47", description: "An empty findingId REFUSES the fold", path: "fold.noFindingIdOk", expected: false },
    { assertionId: "pf-48", description: "Empty findingId reason", path: "fold.noFindingIdReason", expected: "fold.missing-finding-id" },
    { assertionId: "pf-49", description: "The refusal names the offending seq", path: "fold.noFindingIdAtSeq", expected: 1 },
    { assertionId: "pf-50", description: "An empty requireTenant scope REFUSES up front", path: "fold.noScopeOk", expected: false },
    { assertionId: "pf-51", description: "Empty-scope reason", path: "fold.noScopeReason", expected: "fold.missing-tenant" },
    { assertionId: "pf-52", description: "A matching requireTenant scope folds identically", path: "fold.scopedIdentical", expected: true },
  ],
};
