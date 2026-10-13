/**
 * F341B journey B1 — evidence artifact-store completeness (persona:
 * compliance-auditor).
 *
 * CENSUS CITATION (F340 §1, candidate B1, verbatim row): "evidence artifact
 * store | `packages/evidence/src/artifact-store.ts` (ArtifactStorePort,
 * InMemoryArtifactStore, verifyBundleCompleteness, assembleBundle) | NO
 * journey in acceptance/security exercises it (grep: zero) | CANDIDATE B1".
 * Re-verified at this lane's base `5c2ba68`: zero matches for
 * verifyBundleCompleteness / assembleBundle / InMemoryArtifactStore /
 * ArtifactStorePort across packages/acceptance/** (the understand-evidence
 * journey drives the canonical-bundle.ts family — a distinct surface).
 *
 * The auditor proves the artifact-store's laws end-to-end:
 *   - content-addressed storage: the artifactId is `art-` + the first 16
 *     hex of the sha-256 of the bytes; storing the same bytes twice returns
 *     the SAME artifact (automatic dedup — the store never grows, the
 *     first description wins);
 *   - traceability: retrieve(sha256) returns the stored artifact verbatim
 *     (mediaType, description, byte length); an unknown digest retrieves
 *     null and exists() answers false — honest absence, never fabricated;
 *   - bundle completeness verification: a complete bundle verifies; an
 *     incomplete bundle NEVER verifies — the missing digests come back
 *     SORTED (deterministic) so the caller can name exactly what is absent;
 *   - assembly: assembleBundle returns the completeness result + the
 *     canonical bundle digest (sha-256 over `bundleId|tenantId|sorted
 *     evidenceIds` — port-blind, exactly computeBundleDigest's parts); an
 *     incomplete input NEVER verifies through assembly either;
 *   - PORT CONTRACT HONESTY: verifyBundleCompleteness and assembleBundle
 *     accept ANY ArtifactStorePort. A second, object-store-shaped port
 *     preloaded with the same artifacts yields the IDENTICAL completeness
 *     result and bundle digest; an EMPTY port reports every referenced
 *     digest missing — the functions depend only on the port contract, and
 *     the InMemoryArtifactStore is the reference implementation of it.
 *
 * NOTE (async-signature family — the F321B async-dispatch law, extended):
 * the WHOLE census-named surface here (store/retrieve/exists on the port,
 * verifyBundleCompleteness, assembleBundle) carries Promise signatures over
 * the ArtifactStorePort I/O seam, and the corpus runner executes
 * synchronous steps by contract (the TL-owned adoption seam consumes
 * `runJourney(j).outcome` synchronously — F321B precedent). Unlike the
 * F321B case there is NO synchronous surface to drive in-corpus, so the
 * REAL APIs are driven to completion at MODULE EVALUATION TIME via
 * top-level await over deterministic in-memory ports: fixed bytes, sha-256
 * content addressing, no clock, no randomness, no network, no timers — the
 * promises resolve on pure microtasks. ESM evaluation-order semantics
 * guarantee the results are complete before ANY consumer's module body
 * runs — including fully-synchronous module-scope consumers (the release
 * family runs `runAllJourneys(SECURITY_JOURNEYS)` at module scope) and the
 * adoption seam's synchronous consumption. The resolved values are frozen
 * as module constants; the sync steps record them as facts; the runner's
 * determinism law holds byte-identically (content-addressed values are
 * anchor-independent — the family has no time surface at all).
 */

import type { AcceptanceJourney } from "../journey-contracts.ts";
import {
  InMemoryArtifactStore,
  assembleBundle,
  computeBundleDigest,
  sha256Hex,
  utf8Bytes,
  verifyBundleCompleteness,
} from "@fleetos/evidence";
import type {
  ArtifactStorePort,
  BundleAssemblyInput,
  BundleCompletenessResult,
  ContentAddressedArtifact,
} from "@fleetos/evidence";
import { TENANT } from "./fixture-world.ts";

// ---------------------------------------------------------------------------
// Deterministic artifacts (fixed bytes — the investigation's real outputs)
// ---------------------------------------------------------------------------

const INTAKE_REPORT = JSON.stringify({
  findingId: "finding-alpha",
  tenantId: TENANT.tenantId,
  assetId: "pump-7",
  severity: "medium",
  recordedAt: "2026-10-12T18:40:01.000Z",
});
const GUARDIAN_DECISION = JSON.stringify({
  decisionDigest: "dig-guardian-allow-1",
  verdict: "ALLOW",
  tenantId: TENANT.tenantId,
  recordedAt: "2026-10-12T18:40:02.000Z",
});
const EXECUTION_PROOF = JSON.stringify({
  commandId: "cmd-read-pump-7",
  state: "succeeded",
  ackBy: "device.ack",
  recordedAt: "2026-10-12T18:40:03.000Z",
});
/** Bytes the object store LOST — a real content address that is never stored. */
const LOST_ARTIFACT = JSON.stringify({
  findingId: "finding-alpha",
  note: "the artifact the object store lost",
  recordedAt: "2026-10-12T18:40:04.000Z",
});
/** A second never-stored content — referenced BEFORE the first so the
 *  missing-list's sortedness is machine-distinguishable from input order. */
const LOST_ARTIFACT_B = JSON.stringify({
  findingId: "finding-alpha",
  note: "a second absent artifact, referenced first",
  recordedAt: "2026-10-12T18:40:05.000Z",
});

const INTAKE_BYTES = utf8Bytes(INTAKE_REPORT);
const DECISION_BYTES = utf8Bytes(GUARDIAN_DECISION);
const PROOF_BYTES = utf8Bytes(EXECUTION_PROOF);
const LOST_DIGEST = sha256Hex(utf8Bytes(LOST_ARTIFACT));
const LOST_B_DIGEST = sha256Hex(utf8Bytes(LOST_ARTIFACT_B));

/**
 * A second REAL port implementation (the production shape the port doc
 * names: "production injects an object-store-backed repository"). A plain
 * preloaded map — deterministic, no InMemoryArtifactStore internals.
 */
class PreloadedObjectStore implements ArtifactStorePort {
  private readonly objects: Map<string, ContentAddressedArtifact>;

  constructor(preloaded: readonly ContentAddressedArtifact[]) {
    this.objects = new Map(preloaded.map((a) => [a.sha256, a]));
  }

  async store(bytes: Uint8Array, mediaType: string, description: string): Promise<ContentAddressedArtifact> {
    const digest = sha256Hex(bytes);
    const existing = this.objects.get(digest);
    if (existing) return existing;
    const artifact: ContentAddressedArtifact = {
      artifactId: `art-${digest.slice(0, 16)}`,
      sha256: digest,
      bytes: bytes.byteLength,
      mediaType,
      description,
    };
    this.objects.set(digest, artifact);
    return artifact;
  }

  async retrieve(sha256: string): Promise<ContentAddressedArtifact | null> {
    return this.objects.get(sha256) ?? null;
  }

  async exists(sha256: string): Promise<boolean> {
    return this.objects.has(sha256);
  }
}

// ---------------------------------------------------------------------------
// The REAL async APIs, driven to completion at module evaluation (TLA —
// see the module doc). Every value below is a frozen deterministic fact.
// ---------------------------------------------------------------------------

const STORE = new InMemoryArtifactStore();

const artIntake = await STORE.store(INTAKE_BYTES, "application/json", "intake report for finding-alpha");
const artDecision = await STORE.store(DECISION_BYTES, "application/json", "guardian decision record");
const artProof = await STORE.store(PROOF_BYTES, "application/json", "device execution proof");
const artDuplicate = await STORE.store(INTAKE_BYTES, "application/json", "intake report for finding-alpha (re-presented)");
const storeSizeAfterStores = STORE.size();
const retrievedIntake = await STORE.retrieve(artIntake.sha256);
const retrieveRoundTripIdentical =
  retrievedIntake !== null &&
  retrievedIntake.artifactId === artIntake.artifactId &&
  retrievedIntake.sha256 === artIntake.sha256 &&
  retrievedIntake.bytes === artIntake.bytes &&
  retrievedIntake.mediaType === artIntake.mediaType &&
  retrievedIntake.description === artIntake.description;
const retrievedUnknown = await STORE.retrieve(sha256Hex(utf8Bytes("never stored at all")));
const existsStored = await STORE.exists(artDecision.sha256);
const existsUnknown = await STORE.exists(sha256Hex(utf8Bytes("never stored at all")));

const COMPLETE_INPUT: BundleAssemblyInput = {
  bundleId: "bundle-investigation-alpha",
  tenantId: TENANT.tenantId,
  entries: [
    { evidenceId: "ev-intake", artifactDigests: [artIntake.sha256, artDecision.sha256] },
    { evidenceId: "ev-execution", artifactDigests: [artDecision.sha256, artProof.sha256] },
  ],
};
/** Incomplete: ev-execution also references two never-stored digests (the
 *  lexicographically-later one referenced FIRST — sortedness is provable). */
const INCOMPLETE_INPUT: BundleAssemblyInput = {
  bundleId: "bundle-investigation-alpha",
  tenantId: TENANT.tenantId,
  entries: [
    { evidenceId: "ev-intake", artifactDigests: [artIntake.sha256, artDecision.sha256] },
    { evidenceId: "ev-execution", artifactDigests: [LOST_B_DIGEST, artProof.sha256, LOST_DIGEST] },
  ],
};

const completeCheck = await verifyBundleCompleteness(STORE, COMPLETE_INPUT);
const incompleteCheck = await verifyBundleCompleteness(STORE, INCOMPLETE_INPUT);
const missingSortedReference = [LOST_DIGEST, LOST_B_DIGEST].sort();
const missingMatchesSortedReference =
  incompleteCheck.missingArtifacts.length === missingSortedReference.length &&
  incompleteCheck.missingArtifacts.every((d, i) => d === missingSortedReference[i]);

const assembledComplete = await assembleBundle(STORE, COMPLETE_INPUT);
const assembledIncomplete = await assembleBundle(STORE, INCOMPLETE_INPUT);
const canonicalDigest = computeBundleDigest(
  COMPLETE_INPUT.bundleId,
  COMPLETE_INPUT.tenantId,
  COMPLETE_INPUT.entries.map((e) => e.evidenceId),
);
const assembledCompleteAgain = await assembleBundle(STORE, COMPLETE_INPUT);
const canonicalIncompleteDigest = computeBundleDigest(
  INCOMPLETE_INPUT.bundleId,
  INCOMPLETE_INPUT.tenantId,
  INCOMPLETE_INPUT.entries.map((e) => e.evidenceId),
);

// Port-contract honesty: the same content through the object-store-shaped port.
const OBJECT_STORE = new PreloadedObjectStore([artIntake, artDecision, artProof]);
const objectStoreCheck = await verifyBundleCompleteness(OBJECT_STORE, COMPLETE_INPUT);
const objectStoreAssembled = await assembleBundle(OBJECT_STORE, COMPLETE_INPUT);
const completenessResultsIdentical =
  completeCheck.verified === objectStoreCheck.verified &&
  completeCheck.totalArtifacts === objectStoreCheck.totalArtifacts &&
  completeCheck.presentArtifacts === objectStoreCheck.presentArtifacts &&
  completeCheck.missingArtifacts.length === objectStoreCheck.missingArtifacts.length;
const EMPTY_OBJECT_STORE = new PreloadedObjectStore([]);
const emptyPortCheck = await verifyBundleCompleteness(EMPTY_OBJECT_STORE, COMPLETE_INPUT);

function resultShape(r: BundleCompletenessResult): readonly (string | number | boolean)[] {
  return [r.verified ? 1 : 0, r.totalArtifacts, r.presentArtifacts, r.missingArtifacts.length];
}

export const artifactStoreCompletenessJourney: AcceptanceJourney = {
  journeyId: "security.evidence-artifact-store-completeness",
  persona: "compliance-auditor",
  capabilities: ["understand-evidence"],
  goal: "Prove the content-addressed artifact store: dedup, traceability, and bundle completeness that refuses incomplete bundles",
  steps: [
    {
      stepId: "store-and-trace",
      kind: "evidence",
      description: "Store the investigation's real artifacts; content addressing dedups and keeps them traceable",
      packages: ["@fleetos/evidence"],
      operations: ["InMemoryArtifactStore.store", "retrieve", "exists", "size"],
      run: (ctx) => {
        ctx.record("store.count", storeSizeAfterStores);
        ctx.record("store.duplicateSameArtifactId", artDuplicate.artifactId === artIntake.artifactId);
        ctx.record("store.duplicateSameSha", artDuplicate.sha256 === artIntake.sha256);
        ctx.record("store.duplicateKeepsOriginalDescription", artDuplicate.description === artIntake.description);
        ctx.record("store.artifactIdPrefix", artIntake.artifactId.slice(0, 4));
        ctx.record(
          "store.artifactIdMatchesShaPrefix",
          artIntake.artifactId === `art-${artIntake.sha256.slice(0, 16)}`,
        );
        ctx.record("store.sha256Length", artIntake.sha256.length);
        ctx.record("store.mediaTypePreserved", artIntake.mediaType);
        ctx.record("store.descriptionPreserved", artIntake.description);
        ctx.record("store.byteLengths", [artIntake.bytes, artDecision.bytes, artProof.bytes]);
        ctx.record("store.retrieveRoundTripIdentical", retrieveRoundTripIdentical);
        ctx.record("store.retrieveUnknownIsNull", retrievedUnknown === null);
        ctx.record("store.existsStored", existsStored);
        ctx.record("store.existsUnknown", existsUnknown);
      },
    },
    {
      stepId: "verify-complete-bundle",
      kind: "evidence",
      description: "Verify a complete bundle (all referenced digests present) and assemble it",
      packages: ["@fleetos/evidence"],
      operations: ["verifyBundleCompleteness", "assembleBundle", "computeBundleDigest"],
      run: (ctx) => {
        ctx.record("complete.verified", completeCheck.verified);
        ctx.record("complete.bundleId", completeCheck.bundleId);
        ctx.record("complete.tenant", completeCheck.tenantId);
        // sha(artDecision) is referenced by BOTH entries — the digest set dedups.
        ctx.record("complete.totalArtifacts", completeCheck.totalArtifacts);
        ctx.record("complete.presentArtifacts", completeCheck.presentArtifacts);
        ctx.record("complete.missingCount", completeCheck.missingArtifacts.length);
        ctx.record("assemble.completeVerified", assembledComplete.completeness.verified);
        ctx.record("assemble.bundleDigestLength", assembledComplete.bundleDigest.length);
        ctx.record("assemble.bundleDigestMatchesCanonical", assembledComplete.bundleDigest === canonicalDigest);
        ctx.record(
          "assemble.rerunDigestIdentical",
          assembledCompleteAgain.bundleDigest === assembledComplete.bundleDigest,
        );
        ctx.record("assemble.incompleteVerified", assembledIncomplete.completeness.verified);
        ctx.record("assemble.incompleteDigestStillCanonical", assembledIncomplete.bundleDigest === canonicalIncompleteDigest);
      },
    },
    {
      stepId: "refuse-incomplete-bundle",
      kind: "negative-check",
      description: "An incomplete bundle NEVER verifies; the missing digests come back sorted and named",
      packages: ["@fleetos/evidence"],
      operations: ["verifyBundleCompleteness"],
      run: (ctx) => {
        ctx.record("incomplete.verified", incompleteCheck.verified);
        ctx.record("incomplete.totalArtifacts", incompleteCheck.totalArtifacts);
        ctx.record("incomplete.presentArtifacts", incompleteCheck.presentArtifacts);
        ctx.record("incomplete.missingCount", incompleteCheck.missingArtifacts.length);
        ctx.record("incomplete.missingMatchesSortedReference", missingMatchesSortedReference);
        ctx.record("incomplete.missingFirstPrefix", (missingSortedReference[0] ?? "").slice(0, 8));
      },
    },
    {
      stepId: "port-contract-honesty",
      kind: "negative-check",
      description: "The completeness functions depend only on the port contract — an object-store-shaped port behaves identically; an empty one reports everything missing",
      packages: ["@fleetos/evidence"],
      operations: ["verifyBundleCompleteness", "assembleBundle"],
      run: (ctx) => {
        ctx.record("port.preloadedResultsIdentical", completenessResultsIdentical);
        ctx.record("port.preloadedShape", JSON.stringify(resultShape(objectStoreCheck)));
        ctx.record("port.referenceShape", JSON.stringify(resultShape(completeCheck)));
        ctx.record("port.preloadedDigestIdentical", objectStoreAssembled.bundleDigest === assembledComplete.bundleDigest);
        ctx.record("port.emptyVerified", emptyPortCheck.verified);
        ctx.record("port.emptyPresent", emptyPortCheck.presentArtifacts);
        ctx.record("port.emptyMissingCount", emptyPortCheck.missingArtifacts.length);
        ctx.record("port.emptyMissingIsSorted", emptyPortCheck.missingArtifacts.every((d, i, a) => i === 0 || a[i - 1]! <= d));
      },
    },
  ],
  assertions: [
    { assertionId: "as-1", description: "Three unique artifacts stored (the duplicate deduped)", path: "store.count", expected: 3 },
    { assertionId: "as-2", description: "Re-presenting the same bytes returns the SAME artifactId", path: "store.duplicateSameArtifactId", expected: true },
    { assertionId: "as-3", description: "Re-presenting the same bytes returns the SAME sha-256", path: "store.duplicateSameSha", expected: true },
    { assertionId: "as-4", description: "The dedup path returns the original description (no overwrite)", path: "store.duplicateKeepsOriginalDescription", expected: true },
    { assertionId: "as-5", description: "Artifact ids carry the art- prefix", path: "store.artifactIdPrefix", expected: "art-" },
    { assertionId: "as-6", description: "The artifactId is the first 16 hex of the content's sha-256", path: "store.artifactIdMatchesShaPrefix", expected: true },
    { assertionId: "as-7", description: "The sha-256 is 64 lowercase hex chars", path: "store.sha256Length", expected: 64 },
    { assertionId: "as-8", description: "The media type is preserved verbatim", path: "store.mediaTypePreserved", expected: "application/json" },
    { assertionId: "as-9", description: "The description is preserved verbatim", path: "store.descriptionPreserved", expected: "intake report for finding-alpha" },
    { assertionId: "as-10", description: "Byte lengths recorded per artifact (UTF-8 JSON payloads)", path: "store.byteLengths", expected: [130, 121, 112] },
    { assertionId: "as-11", description: "retrieve(sha256) returns the stored artifact verbatim (traceability)", path: "store.retrieveRoundTripIdentical", expected: true },
    { assertionId: "as-12", description: "An unknown digest retrieves null (honest absence)", path: "store.retrieveUnknownIsNull", expected: true },
    { assertionId: "as-13", description: "exists() answers true for stored content", path: "store.existsStored", expected: true },
    { assertionId: "as-14", description: "exists() answers false for never-stored content", path: "store.existsUnknown", expected: false },
    { assertionId: "as-15", description: "A complete bundle verifies", path: "complete.verified", expected: true },
    { assertionId: "as-16", description: "The result carries the bundleId", path: "complete.bundleId", expected: "bundle-investigation-alpha" },
    { assertionId: "as-17", description: "The result carries the tenant", path: "complete.tenant", expected: "acme-ops" },
    { assertionId: "as-18", description: "Digests shared across entries count once (3 unique over 4 refs)", path: "complete.totalArtifacts", expected: 3 },
    { assertionId: "as-19", description: "All three referenced artifacts are present", path: "complete.presentArtifacts", expected: 3 },
    { assertionId: "as-20", description: "Nothing is missing on the complete bundle", path: "complete.missingCount", expected: 0 },
    { assertionId: "as-21", description: "Assembly of a complete bundle verifies complete", path: "assemble.completeVerified", expected: true },
    { assertionId: "as-22", description: "The bundle digest is sha-256 (64 hex)", path: "assemble.bundleDigestLength", expected: 64 },
    { assertionId: "as-23", description: "assembleBundle's digest equals computeBundleDigest over the same parts", path: "assemble.bundleDigestMatchesCanonical", expected: true },
    { assertionId: "as-24", description: "Re-assembly is byte-identical (deterministic digest)", path: "assemble.rerunDigestIdentical", expected: true },
    { assertionId: "as-25", description: "REFUSAL: an incomplete bundle NEVER verifies through assembly", path: "assemble.incompleteVerified", expected: false },
    { assertionId: "as-26", description: "The incomplete bundle's digest is still the canonical envelope (completeness is the gate, not the digest)", path: "assemble.incompleteDigestStillCanonical", expected: true },
    { assertionId: "as-27", description: "REFUSAL: the incomplete bundle does not verify", path: "incomplete.verified", expected: false },
    { assertionId: "as-28", description: "The incomplete bundle still counts all 5 unique referenced digests", path: "incomplete.totalArtifacts", expected: 5 },
    { assertionId: "as-29", description: "The 3 stored artifacts are counted present", path: "incomplete.presentArtifacts", expected: 3 },
    { assertionId: "as-30", description: "Exactly the 2 lost digests are reported missing", path: "incomplete.missingCount", expected: 2 },
    { assertionId: "as-31", description: "The missing list comes back SORTED (deterministic order, not input order)", path: "incomplete.missingMatchesSortedReference", expected: true },
    { assertionId: "as-32", description: "The first missing digest is the lexicographically-first lost artifact (machine-measured pin: 8c7a1b46...)", path: "incomplete.missingFirstPrefix", expected: "8c7a1b46" },
    { assertionId: "as-33", description: "An object-store-shaped port yields the identical completeness result", path: "port.preloadedResultsIdentical", expected: true },
    { assertionId: "as-34", description: "The preloaded port's result shape (verified/total/present/missing)", path: "port.preloadedShape", expected: "[1,3,3,0]" },
    { assertionId: "as-35", description: "The reference store's result shape matches", path: "port.referenceShape", expected: "[1,3,3,0]" },
    { assertionId: "as-36", description: "The bundle digest is port-blind (same digest through the second port)", path: "port.preloadedDigestIdentical", expected: true },
    { assertionId: "as-37", description: "REFUSAL: an empty port never verifies the bundle", path: "port.emptyVerified", expected: false },
    { assertionId: "as-38", description: "The empty port reports zero present", path: "port.emptyPresent", expected: 0 },
    { assertionId: "as-39", description: "The empty port reports ALL 3 unique digests missing", path: "port.emptyMissingCount", expected: 3 },
    { assertionId: "as-40", description: "The empty port's missing list is sorted ascending", path: "port.emptyMissingIsSorted", expected: true },
  ],
};
