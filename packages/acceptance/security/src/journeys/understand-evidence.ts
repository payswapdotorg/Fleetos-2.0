/**
 * Journey 2 — understand evidence (persona: compliance-auditor).
 *
 * An auditor builds an evidence bundle through the REAL evidence package:
 * content-addressed entries (sha-256 over canonical JSON), custody chains,
 * bundle sealing + integrity verification, a signer-free verification
 * record, and the A13 traceability chain that surfaces the bundle in the
 * inspect views. Tampering with a payload digest MUST fail verification.
 */

import type { AcceptanceJourney } from "../journey-contracts.ts";
import {
  buildCanonicalEntry,
  buildTraceabilityChain,
  computeEntryDigest,
  sealCanonicalBundle,
  verifyBundleAndRecord,
  verifyCanonicalBundle,
  verifyTraceabilityChain,
} from "@fleetos/evidence";
import type { CanonicalEvidenceBundle } from "@fleetos/evidence";
import { NOW_ISO, TENANT } from "./fixture-world.ts";

function entryInput(entryId: string, payload: Readonly<Record<string, unknown>>, at: number) {
  return {
    entryId,
    tenantId: TENANT.tenantId,
    kind: "authorization" as const,
    payload,
    recordedAt: at,
    custody: [
      { actorId: "guardian-reference", role: "collector" as const, at },
      { actorId: "auditor-kai", role: "verifier" as const, at: at + 1_000 },
    ],
  };
}

export const understandEvidenceJourney: AcceptanceJourney = {
  journeyId: "security.understand-evidence",
  persona: "compliance-auditor",
  capabilities: ["understand-evidence"],
  goal: "Build a verifiable evidence bundle and understand what it proves",
  steps: [
    {
      stepId: "build-and-seal",
      kind: "evidence",
      description: "Build 3 content-addressed entries and seal them through the REAL evidence package",
      packages: ["@fleetos/evidence"],
      operations: ["buildCanonicalEntry", "sealCanonicalBundle"],
      run: (ctx) => {
        const base = 1_791_830_400_000;
        const a = buildCanonicalEntry(entryInput("ev-actor", { actorId: "operator-ada" }, base));
        const b = buildCanonicalEntry(entryInput("ev-authorization", { decisionDigest: "digest-x" }, base + 1_000));
        const c = buildCanonicalEntry(entryInput("ev-execution", { commandId: "cmd-1" }, base + 2_000));
        if (!a.ok || !b.ok || !c.ok) throw new Error("canonical entry refused");
        const sealed = sealCanonicalBundle({
          bundleId: "bundle-investigation-1",
          tenantId: TENANT.tenantId,
          entries: [a.entry, b.entry, c.entry],
          sealedAt: base + 3_000,
        });
        if (!sealed.ok) throw new Error(`bundle seal refused: ${sealed.reason}`);
        ctx.record("bundle.entryCount", sealed.bundle.entries.length);
        ctx.record("bundle.digestLength", sealed.bundle.bundleDigest.length);
        ctx.record("bundle.firstPayloadDigestLength", sealed.bundle.entries[0]!.payloadDigest.length);
        ctx.record(
          "bundle.entryOrder",
          sealed.bundle.entries.map((e) => e.entryId),
        );
        const tampered: CanonicalEvidenceBundle = {
          ...sealed.bundle,
          entries: sealed.bundle.entries.map((e, i) =>
            i === 1 ? { ...e, payloadDigest: "0".repeat(64) } : e,
          ),
        };
        const tamperResult = verifyCanonicalBundle(tampered);
        ctx.record("bundle.tampered.verified", tamperResult.verified);
        ctx.record("bundle.tampered.reason", tamperResult.reason);
        const integrity = verifyCanonicalBundle(sealed.bundle);
        ctx.record("bundle.verified", integrity.verified);
        ctx.record("bundle.checkedEntries", integrity.checkedEntries);
        const record = verifyBundleAndRecord(sealed.bundle, base + 4_000);
        if (!record.ok) throw new Error("verification record refused");
        ctx.record("record.outcome", record.record.outcome);
        ctx.record("record.digestLength", record.record.recordDigest.length);
        const chainDigest = computeEntryDigest(null, "ev-actor", TENANT.tenantId, 0);
        ctx.record("entry.digestLength", chainDigest.length);
      },
    },
    {
      stepId: "traceability-surface",
      kind: "evidence",
      description: "Surface the bundle through the REAL A13 traceability chain",
      packages: ["@fleetos/evidence"],
      operations: ["buildTraceabilityChain", "verifyTraceabilityChain"],
      run: (ctx) => {
        const chain = buildTraceabilityChain(TENANT.tenantId, [
          { kind: "actor", ref: "operator-ada", recordedAt: NOW_ISO, details: {} },
          { kind: "intent", ref: "intent-42", recordedAt: NOW_ISO, details: {} },
          { kind: "authorization", ref: "bundle-investigation-1", recordedAt: NOW_ISO, details: {} },
          { kind: "execution", ref: "ledger-entry-5", recordedAt: NOW_ISO, details: {} },
          { kind: "verification", ref: "ver-1", recordedAt: NOW_ISO, details: {} },
          { kind: "capability_version", ref: "fleetos.device.execute-command@1.2.0", recordedAt: NOW_ISO, details: {} },
        ]);
        const verified = verifyTraceabilityChain(chain);
        ctx.record("trace.verified", verified.verified);
        ctx.record("trace.linkCount", chain.links.length);
        ctx.record("trace.digestLength", chain.chainDigest.length);
        ctx.record("trace.tenantId", chain.tenantId);
      },
    },
  ],
  assertions: [
    { assertionId: "ev-1", description: "Bundle carries all three entries", path: "bundle.entryCount", expected: 3 },
    { assertionId: "ev-2", description: "Bundle digest is sha-256-shaped (64 hex)", path: "bundle.digestLength", expected: 64 },
    { assertionId: "ev-3", description: "Entry payload digests are sha-256-shaped", path: "bundle.firstPayloadDigestLength", expected: 64 },
    { assertionId: "ev-4", description: "Entries sorted by entryId (deterministic)", path: "bundle.entryOrder", expected: ["ev-actor", "ev-authorization", "ev-execution"] },
    { assertionId: "ev-5", description: "Untampered bundle verifies", path: "bundle.verified", expected: true },
    { assertionId: "ev-6", description: "All entries checked", path: "bundle.checkedEntries", expected: 3 },
    { assertionId: "ev-7", description: "Tampered payload digest fails integrity", path: "bundle.tampered.verified", expected: false },
    { assertionId: "ev-8", description: "Tamper reason names the bundle digest mismatch", path: "bundle.tampered.reason", expected: "integrity.bundle-digest-mismatch" },
    { assertionId: "ev-9", description: "Verification record outcome is verified", path: "record.outcome", expected: "verified" },
    { assertionId: "ev-10", description: "Verification record digest is sha-256-shaped", path: "record.digestLength", expected: 64 },
    { assertionId: "ev-11", description: "Chain-entry digest is sha-256-shaped", path: "entry.digestLength", expected: 64 },
    { assertionId: "ev-12", description: "A13 traceability chain verifies", path: "trace.verified", expected: true },
    { assertionId: "ev-13", description: "All six A13 link kinds present", path: "trace.linkCount", expected: 6 },
    { assertionId: "ev-14", description: "Chain digest is sha-256-shaped", path: "trace.digestLength", expected: 64 },
    { assertionId: "ev-15", description: "Chain is tenant-scoped", path: "trace.tenantId", expected: "acme-ops" },
  ],
};
