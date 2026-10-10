/**
 * F321B journey — tamper-evident audit ledger (persona: compliance-auditor).
 *
 * A compliance auditor seals the lane's REAL decision surfaces into the
 * tamper-evident audit ledger (@fleetos/security audit-ledger — F280B) and
 * proves every tamper law machine-wise:
 *   - append is fail-closed (empty tenant / empty subject / unknown surface /
 *     invalid occurredAt / invalid sequence / cross-tenant append all REFUSE
 *     with machine-stable reason codes);
 *   - the verified chain recomputes entry digests and pins the head;
 *   - REMOVING an entry is detected at the exact gap position (`audit.gap`)
 *     even though the surviving successor still chains — the sequence check
 *     fires first;
 *   - a payload edit without re-sealing breaks the payload digest; a forged
 *     chain digest breaks the entry digest; a rewound sequence reports
 *     `audit.sequence-regressed`;
 *   - the EXTERNAL anchor catches TAIL TRUNCATION — the one removal a bare
 *     hash chain cannot see (sealAuditLedgerHead + verifyAuditLedgerAgainstAnchor).
 *
 * Determinism: logical epochs only (BASE_MS offsets); no clock, no
 * randomness, no network. The four sealed events cover all three REAL
 * ledger surfaces (guardian.evaluation, action.emission, execution.entry).
 */

import type { AcceptanceJourney } from "../journey-contracts.ts";
import {
  appendAuditEvent,
  auditEntryDigest,
  dropAuditEvent,
  sealAuditLedgerHead,
  tamperAuditEntryDigest,
  tamperAuditPayload,
  verifyAuditLedger,
  verifyAuditLedgerAgainstAnchor,
} from "@fleetos/security";
import type { AuditLedgerEvent } from "@fleetos/security";
import { BASE_MS, TENANT, FOREIGN_TENANT } from "./fixture-world.ts";

type AppendInput = Parameters<typeof appendAuditEvent>[1];

function append(ledger: readonly AuditLedgerEvent[], input: AppendInput): readonly AuditLedgerEvent[] {
  const result = appendAuditEvent(ledger, input);
  if (!result.ok) throw new Error(`audit append refused: ${result.reason}`);
  return result.ledger;
}

function refused(input: AppendInput): string {
  const result = appendAuditEvent([], input);
  if (result.ok) throw new Error("append unexpectedly accepted");
  return result.reason;
}

function baseEvent(subjectId: string, at: number, payload: Readonly<Record<string, unknown>>): AppendInput {
  return {
    tenantId: TENANT.tenantId,
    surface: "guardian.evaluation",
    subjectId,
    occurredAt: at,
    payload,
  };
}

export const auditLedgerJourney: AcceptanceJourney = {
  journeyId: "security.tamper-evident-audit-ledger",
  persona: "compliance-auditor",
  capabilities: ["decision-provenance"],
  goal: "Seal real decision surfaces into the tamper-evident audit ledger and prove every tamper law",
  steps: [
    {
      stepId: "seal-and-verify",
      kind: "ledger",
      description: "Append events across all three REAL surfaces, drive every append refusal, verify the chain",
      packages: ["@fleetos/security"],
      operations: ["appendAuditEvent", "verifyAuditLedger", "auditEntryDigest"],
      run: (ctx) => {
        let ledger: readonly AuditLedgerEvent[] = [];
        const firstInput: AppendInput = {
          ...baseEvent("decision-record-1", BASE_MS, { verdict: "ALLOW", rule: "rule.allow_low_risk_read" }),
          surface: "guardian.evaluation",
        };
        ledger = append(ledger, firstInput);
        ledger = append(ledger, {
          ...baseEvent("action-intent-1", BASE_MS + 1_000, { from: "proposed", to: "authorized" }),
          surface: "action.emission",
        });
        ledger = append(ledger, {
          ...baseEvent("exec-cmd-1#2", BASE_MS + 2_000, { kind: "acked", idempotencyKey: "exec-cmd-1" }),
          surface: "execution.entry",
        });
        const fourth = appendAuditEvent(ledger, {
          ...baseEvent("exec-cmd-1#3", BASE_MS + 3_000, { kind: "completed" }),
          surface: "execution.entry",
        });
        if (!fourth.ok) throw new Error("fourth append refused");
        ledger = fourth.ledger;

        const verified = verifyAuditLedger(ledger);
        ctx.record("ledger.verified", verified.verified);
        ctx.record("ledger.checkedEntries", verified.checkedEntries);
        ctx.record("ledger.reason", verified.reason);
        ctx.record("ledger.headMatchesLastEntry", verified.computedHeadDigest === (ledger[ledger.length - 1]?.entryDigest ?? null));
        ctx.record("ledger.surfaces", ledger.map((e) => e.surface));
        ctx.record("ledger.sequences", ledger.map((e) => e.sequence));
        ctx.record("ledger.entryDigestRecomputes", ledger.every((e) => auditEntryDigest(e) === e.entryDigest));
        // Content-addressed sealing: re-sealing the SAME input on a fresh
        // chain produces the byte-identical payload digest + canonical form.
        const again = appendAuditEvent([], firstInput);
        ctx.record(
          "ledger.contentAddressed",
          again.ok && again.event.payloadDigest === ledger[0]!.payloadDigest && again.event.payloadCanonical === ledger[0]!.payloadCanonical,
        );

        // Append refusals — every fail-closed reason code, machine-stable.
        ctx.record("refusal.missingTenant", refused({ ...baseEvent("s", BASE_MS, {}), tenantId: "" }));
        ctx.record("refusal.missingSubject", refused({ ...baseEvent("", BASE_MS, {}) }));
        ctx.record("refusal.unknownSurface", refused({
          ...baseEvent("s", BASE_MS, {}),
          surface: "guardian.fabricated" as unknown as "guardian.evaluation",
        }));
        ctx.record("refusal.invalidOccurredAt", refused({ ...baseEvent("s", BASE_MS, {}), occurredAt: -1 }));
        ctx.record("refusal.invalidSequence", refused({ ...baseEvent("s", BASE_MS, {}), sequence: 7 }));
        // Cross-tenant append onto an acme chain REFUSES (A8 fail-closed).
        const cross = appendAuditEvent(ledger, { ...baseEvent("s", BASE_MS, {}), tenantId: FOREIGN_TENANT.tenantId });
        ctx.record("refusal.crossTenantOk", cross.ok);
        ctx.record("refusal.crossTenantReason", cross.ok ? "unexpected-accept" : cross.reason);
      },
    },
    {
      stepId: "tamper-detection",
      kind: "negative-check",
      description: "Drop, edit and forge entries — every attack is detected at the exact break position",
      packages: ["@fleetos/security"],
      operations: ["dropAuditEvent", "tamperAuditPayload", "tamperAuditEntryDigest", "verifyAuditLedger"],
      run: (ctx) => {
        let ledger: readonly AuditLedgerEvent[] = [];
        ledger = append(ledger, baseEvent("decision-record-1", BASE_MS, { verdict: "ALLOW" }));
        ledger = append(ledger, { ...baseEvent("action-intent-1", BASE_MS + 1_000, { from: "proposed", to: "authorized" }), surface: "action.emission" });
        ledger = append(ledger, { ...baseEvent("exec-cmd-1#2", BASE_MS + 2_000, { kind: "acked" }), surface: "execution.entry" });
        ledger = append(ledger, { ...baseEvent("exec-cmd-1#3", BASE_MS + 3_000, { kind: "completed" }), surface: "execution.entry" });

        // Attack 1: REMOVE entry 1 — the sequence jump names the gap position.
        const dropped = verifyAuditLedger(dropAuditEvent(ledger, 1));
        ctx.record("tamper.dropped.verified", dropped.verified);
        ctx.record("tamper.dropped.gapAt", dropped.gapAt);
        ctx.record("tamper.dropped.reason", dropped.reason);

        // Attack 2: EDIT a payload without re-sealing — content digest mismatch.
        const edited = verifyAuditLedger(tamperAuditPayload(ledger, 2, { kind: "dead-lettered" }));
        ctx.record("tamper.payload.verified", edited.verified);
        ctx.record("tamper.payload.brokenAt", edited.brokenAt);
        ctx.record("tamper.payload.reason", edited.reason);

        // Attack 3: FORGE a chain digest — the entry digest fails to recompute.
        const forged = verifyAuditLedger(tamperAuditEntryDigest(ledger, 0, "deadbeef"));
        ctx.record("tamper.forged.verified", forged.verified);
        ctx.record("tamper.forged.brokenAt", forged.brokenAt);
        ctx.record("tamper.forged.reason", forged.reason);

        // Attack 4: REWIND a sequence (duplication/rewind) — regressed report.
        const rewound: readonly AuditLedgerEvent[] = ledger.map((e) =>
          e.sequence === 3 ? { ...e, sequence: 1 } : e,
        );
        const regressed = verifyAuditLedger(rewound);
        ctx.record("tamper.rewound.verified", regressed.verified);
        ctx.record("tamper.rewound.brokenAt", regressed.brokenAt);
        ctx.record("tamper.rewound.reason", regressed.reason);

        // The FIRST entry must chain from null previousDigest.
        const headLinked: readonly AuditLedgerEvent[] = ledger.map((e) =>
          e.sequence === 0 ? { ...e, previousDigest: "811c9dc5" } : e,
        );
        const firstPrev = verifyAuditLedger(headLinked);
        ctx.record("tamper.firstPrev.verified", firstPrev.verified);
        ctx.record("tamper.firstPrev.reason", firstPrev.reason);
      },
    },
    {
      stepId: "anchor-sealing",
      kind: "provenance-inspect",
      description: "Seal the head digest as an external anchor and catch TAIL TRUNCATION",
      packages: ["@fleetos/security"],
      operations: ["sealAuditLedgerHead", "verifyAuditLedgerAgainstAnchor"],
      run: (ctx) => {
        let ledger: readonly AuditLedgerEvent[] = [];
        ledger = append(ledger, baseEvent("decision-record-1", BASE_MS, { verdict: "ALLOW" }));
        ledger = append(ledger, { ...baseEvent("action-intent-1", BASE_MS + 1_000, { from: "proposed", to: "authorized" }), surface: "action.emission" });
        ledger = append(ledger, { ...baseEvent("exec-cmd-1#2", BASE_MS + 2_000, { kind: "acked" }), surface: "execution.entry" });
        ledger = append(ledger, { ...baseEvent("exec-cmd-1#3", BASE_MS + 3_000, { kind: "completed" }), surface: "execution.entry" });

        const anchor = sealAuditLedgerHead(ledger);
        ctx.record("anchor.headDigestLength", anchor === null ? 0 : anchor.length);
        ctx.record("anchor.digestMatchesLastEntry", anchor === (ledger[ledger.length - 1]?.entryDigest ?? null));
        // An empty ledger has NO head to seal (honest null).
        ctx.record("anchor.emptyLedgerSeal", sealAuditLedgerHead([]));

        // Full ledger against its anchor: verified, not truncated.
        const full = verifyAuditLedgerAgainstAnchor(ledger, anchor ?? "");
        ctx.record("anchor.full.verified", full.verified);
        ctx.record("anchor.full.truncated", full.truncated);

        // TAIL TRUNCATION: removing the final entry leaves a valid chain that
        // no longer reaches the anchored head — the anchor catches it.
        const truncatedLedger = ledger.slice(0, 3);
        const truncInternal = verifyAuditLedger(truncatedLedger);
        const truncAnchored = verifyAuditLedgerAgainstAnchor(truncatedLedger, anchor ?? "");
        ctx.record("anchor.truncated.internalStillVerifies", truncInternal.verified);
        ctx.record("anchor.truncated.anchoredVerified", truncAnchored.verified);
        ctx.record("anchor.truncated.flagged", truncAnchored.truncated);
        ctx.record("anchor.truncated.reason", truncAnchored.reason);

        // A wrong anchor against the full ledger is equally caught.
        const wrongAnchor = verifyAuditLedgerAgainstAnchor(ledger, "deadbeef");
        ctx.record("anchor.wrong.verified", wrongAnchor.verified);
        ctx.record("anchor.wrong.truncated", wrongAnchor.truncated);
      },
    },
  ],
  assertions: [
    { assertionId: "al-1", description: "Four sealed events verify", path: "ledger.verified", expected: true },
    { assertionId: "al-2", description: "Every entry checked", path: "ledger.checkedEntries", expected: 4 },
    { assertionId: "al-3", description: "No break reason on the genuine chain", path: "ledger.reason", expected: null },
    { assertionId: "al-4", description: "Computed head digest is the last entry digest", path: "ledger.headMatchesLastEntry", expected: true },
    { assertionId: "al-5", description: "All three REAL ledger surfaces covered", path: "ledger.surfaces", expected: ["guardian.evaluation", "action.emission", "execution.entry", "execution.entry"] },
    { assertionId: "al-6", description: "Sequences are 0-based and contiguous", path: "ledger.sequences", expected: [0, 1, 2, 3] },
    { assertionId: "al-7", description: "Every entry digest recomputes exactly", path: "ledger.entryDigestRecomputes", expected: true },
    { assertionId: "al-7b", description: "Sealing is content-addressed (same payload, same digest)", path: "ledger.contentAddressed", expected: true },
    { assertionId: "al-8", description: "Empty-tenant append refused", path: "refusal.missingTenant", expected: "audit.missing-tenant" },
    { assertionId: "al-9", description: "Empty-subject append refused", path: "refusal.missingSubject", expected: "audit.missing-subject" },
    { assertionId: "al-10", description: "Unknown-surface append refused", path: "refusal.unknownSurface", expected: "audit.unknown-surface" },
    { assertionId: "al-11", description: "Negative occurredAt refused", path: "refusal.invalidOccurredAt", expected: "audit.invalid-occurred-at" },
    { assertionId: "al-12", description: "Non-contiguous sequence refused", path: "refusal.invalidSequence", expected: "audit.invalid-sequence" },
    { assertionId: "al-13", description: "Cross-tenant append refused (A8 fail-closed)", path: "refusal.crossTenantOk", expected: false },
    { assertionId: "al-14", description: "Cross-tenant refusal reason", path: "refusal.crossTenantReason", expected: "audit.tenant-mismatch" },
    { assertionId: "al-15", description: "Entry removal breaks verification", path: "tamper.dropped.verified", expected: false },
    { assertionId: "al-16", description: "Removal gap pinned at the missing position", path: "tamper.dropped.gapAt", expected: 1 },
    { assertionId: "al-17", description: "Removal detected as a sequence gap", path: "tamper.dropped.reason", expected: "audit.gap" },
    { assertionId: "al-18", description: "Unsealed payload edit breaks verification", path: "tamper.payload.verified", expected: false },
    { assertionId: "al-19", description: "Payload tamper located at the edited entry", path: "tamper.payload.brokenAt", expected: 2 },
    { assertionId: "al-20", description: "Payload tamper reason names the content digest", path: "tamper.payload.reason", expected: "audit.payload_digest_mismatch" },
    { assertionId: "al-21", description: "Forged chain digest breaks verification", path: "tamper.forged.verified", expected: false },
    { assertionId: "al-22", description: "Forge located at the first entry", path: "tamper.forged.brokenAt", expected: 0 },
    { assertionId: "al-23", description: "Forge reason names the entry digest", path: "tamper.forged.reason", expected: "audit.entry_digest_mismatch" },
    { assertionId: "al-24", description: "Rewound sequence breaks verification", path: "tamper.rewound.verified", expected: false },
    { assertionId: "al-25", description: "Rewind detected at the rewound position", path: "tamper.rewound.brokenAt", expected: 3 },
    { assertionId: "al-26", description: "Rewind reason is sequence-regressed", path: "tamper.rewound.reason", expected: "audit.sequence-regressed" },
    { assertionId: "al-27", description: "A first entry with a previous digest refuses", path: "tamper.firstPrev.verified", expected: false },
    { assertionId: "al-28", description: "First-entry linkage reason", path: "tamper.firstPrev.reason", expected: "audit.first_entry_has_previous" },
    { assertionId: "al-29", description: "Head seal is an 8-hex digest", path: "anchor.headDigestLength", expected: 8 },
    { assertionId: "al-30", description: "The seal is the last entry's chain digest", path: "anchor.digestMatchesLastEntry", expected: true },
    { assertionId: "al-31", description: "An empty ledger has no head to seal", path: "anchor.emptyLedgerSeal", expected: null },
    { assertionId: "al-32", description: "Full ledger verifies against its anchor", path: "anchor.full.verified", expected: true },
    { assertionId: "al-33", description: "Full ledger is not flagged truncated", path: "anchor.full.truncated", expected: false },
    { assertionId: "al-34", description: "Tail truncation stays internally valid (the honest hash-chain limit)", path: "anchor.truncated.internalStillVerifies", expected: true },
    { assertionId: "al-35", description: "The ANCHOR catches the truncated tail", path: "anchor.truncated.anchoredVerified", expected: false },
    { assertionId: "al-36", description: "Truncation flagged by the anchor check", path: "anchor.truncated.flagged", expected: true },
    { assertionId: "al-37", description: "Anchored truncation reason", path: "anchor.truncated.reason", expected: "audit.entry_digest_mismatch" },
    { assertionId: "al-38", description: "A wrong anchor fails the full ledger too", path: "anchor.wrong.verified", expected: false },
    { assertionId: "al-39", description: "Wrong anchor flagged as truncation", path: "anchor.wrong.truncated", expected: true },
  ],
};
