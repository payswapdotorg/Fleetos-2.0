/**
 * Canonical evidence bundle tests (F220B, Wave 2).
 *
 * Behavior under test: canonical JSON determinism, content-addressed entries
 * (sha-256 digests, key-order independence), chain-of-custody rules, bundle
 * sealing (insertion-order independence, tenant fail-closed), integrity
 * verification (tamper detection), signer-free deterministic verification
 * records.
 */
import { describe, it, expect } from "vitest";
import {
  canonicalJson,
  buildCanonicalEntry,
  sealCanonicalBundle,
  computeCanonicalBundleDigest,
  verifyCanonicalBundle,
  verifyBundleAndRecord,
  verifyChainOfCustody,
} from "../src/index.ts";
import type { CanonicalEvidenceEntry, CustodyRef, CanonicalEvidenceBundle } from "../src/index.ts";
import { sha256Hex, utf8Bytes } from "../src/index.ts";

function custody(overrides: Partial<CustodyRef> = {}): CustodyRef {
  return { actorId: "actor-1", role: "collector", at: 100, ...overrides };
}

function entryInput(entryId = "e1", payload: Readonly<Record<string, unknown>> = { assetId: "a-1", value: 42 }) {
  return {
    entryId,
    tenantId: "t1",
    kind: "observation" as const,
    payload,
    recordedAt: 100,
    custody: [custody(), custody({ actorId: "arch-1", role: "archivist", at: 150 })],
  };
}

function makeEntry(entryId = "e1", payload?: Readonly<Record<string, unknown>>): CanonicalEvidenceEntry {
  const r = buildCanonicalEntry(entryInput(entryId, payload));
  if (!r.ok) throw new Error(r.reason);
  return r.entry;
}

function makeBundle(entries: readonly CanonicalEvidenceEntry[], bundleId = "b-1"): CanonicalEvidenceBundle {
  const r = sealCanonicalBundle({ bundleId, tenantId: "t1", entries, sealedAt: 500 });
  if (!r.ok) throw new Error(r.reason);
  return r.bundle;
}

// ---------- Canonical JSON ----------

describe("canonical JSON", () => {
  it("sorts object keys recursively — key order never affects the bytes", () => {
    const a = { z: 1, a: { y: 2, b: 3 }, m: [4, 5] };
    const b = { a: { b: 3, y: 2 }, m: [4, 5], z: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it("preserves array order (arrays are sequences, not sets)", () => {
    expect(canonicalJson([1, 2, 3])).not.toBe(canonicalJson([3, 2, 1]));
  });

  it("drops undefined-valued keys deterministically", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
  });

  it("same value => same bytes, every time (pure function)", () => {
    const value = { b: "x", a: { c: [1, "two", false, null] } };
    expect(canonicalJson(value)).toBe(canonicalJson(value));
  });
});

// ---------- Chain of custody ----------

describe("chain of custody", () => {
  it("accepts a well-formed chain starting with the collector", () => {
    const chain = [
      custody(),
      custody({ actorId: "c-1", role: "custodian", at: 120 }),
      custody({ actorId: "v-1", role: "verifier", at: 140 }),
    ];
    expect(verifyChainOfCustody(chain).ok).toBe(true);
  });

  it("refuses an empty chain", () => {
    const r = verifyChainOfCustody([]);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("custody.empty");
  });

  it("refuses an empty actor id", () => {
    const r = verifyChainOfCustody([custody({ actorId: "" })]);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("custody.missing-actor");
  });

  it("refuses a chain that does not start with the collector", () => {
    const r = verifyChainOfCustody([custody({ role: "verifier" })]);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("custody.missing-collector");
  });

  it("refuses a chain with decreasing timestamps (hands pass forward in time)", () => {
    const r = verifyChainOfCustody([custody({ at: 200 }), custody({ actorId: "x", role: "custodian", at: 100 })]);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("custody.unordered");
  });

  it("equal timestamps are legal (simultaneous handoff)", () => {
    const r = verifyChainOfCustody([custody({ at: 100 }), custody({ actorId: "x", role: "custodian", at: 100 })]);
    expect(r.ok).toBe(true);
  });
});

// ---------- Content-addressed entries ----------

describe("canonical entries", () => {
  it("computes the payload digest as sha-256 over the canonical JSON", () => {
    const entry = makeEntry("e1", { b: 2, a: 1 });
    expect(entry.payloadDigest).toBe(sha256Hex(utf8Bytes(canonicalJson({ a: 1, b: 2 }))));
  });

  it("the SAME payload with different key order yields the SAME digest", () => {
    const a = makeEntry("e1", { a: 1, b: { z: 2, y: 3 } });
    const b = makeEntry("e1", { b: { y: 3, z: 2 }, a: 1 });
    expect(a.payloadDigest).toBe(b.payloadDigest);
  });

  it("a different payload yields a different digest", () => {
    const a = makeEntry("e1", { a: 1 });
    const b = makeEntry("e1", { a: 2 });
    expect(a.payloadDigest).not.toBe(b.payloadDigest);
  });

  it("refuses a missing tenant scope (A8 fail-closed)", () => {
    const r = buildCanonicalEntry({ ...entryInput(), tenantId: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("entry.missing-tenant");
  });

  it("refuses a missing entry id", () => {
    const r = buildCanonicalEntry({ ...entryInput(), entryId: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("entry.missing-entry-id");
  });

  it("refuses an invalid recordedAt (negative / non-integer)", () => {
    expect(buildCanonicalEntry({ ...entryInput(), recordedAt: -1 }).ok).toBe(false);
    expect(buildCanonicalEntry({ ...entryInput(), recordedAt: 1.5 }).ok).toBe(false);
  });

  it("refuses a bad custody chain and reports the custody reason", () => {
    const r = buildCanonicalEntry({ ...entryInput(), custody: [custody({ role: "verifier" })] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("entry.bad-custody");
      expect(r.custodyReason).toBe("custody.missing-collector");
    }
  });
});

// ---------- Bundle sealing ----------

describe("bundle sealing", () => {
  it("seals entries sorted by entryId with a content-addressed digest", () => {
    const bundle = makeBundle([makeEntry("e2"), makeEntry("e1")]);
    expect(bundle.entries.map((e) => e.entryId)).toEqual(["e1", "e2"]);
    expect(bundle.bundleDigest).toBe(computeCanonicalBundleDigest("b-1", "t1", bundle.entries));
  });

  it("the bundle digest is INSERTION-ORDER independent (same set, same digest)", () => {
    const a = makeBundle([makeEntry("e1"), makeEntry("e2"), makeEntry("e3")]);
    const b = makeBundle([makeEntry("e3"), makeEntry("e1"), makeEntry("e2")]);
    expect(a.bundleDigest).toBe(b.bundleDigest);
  });

  it("a different entry set yields a different digest", () => {
    const a = makeBundle([makeEntry("e1")]);
    const b = makeBundle([makeEntry("e2")]);
    expect(a.bundleDigest).not.toBe(b.bundleDigest);
  });

  it("refuses a missing bundle id / tenant / empty entries / invalid sealedAt", () => {
    const entries = [makeEntry()];
    expect(sealCanonicalBundle({ bundleId: "", tenantId: "t1", entries, sealedAt: 1 }).ok).toBe(false);
    expect(sealCanonicalBundle({ bundleId: "b", tenantId: "", entries, sealedAt: 1 }).ok).toBe(false);
    expect(sealCanonicalBundle({ bundleId: "b", tenantId: "t1", entries: [], sealedAt: 1 }).ok).toBe(false);
    expect(sealCanonicalBundle({ bundleId: "b", tenantId: "t1", entries, sealedAt: -1 }).ok).toBe(false);
  });

  it("refuses duplicate entry ids", () => {
    const r = sealCanonicalBundle({ bundleId: "b", tenantId: "t1", entries: [makeEntry("e1"), makeEntry("e1")], sealedAt: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("bundle.duplicate-entry");
  });

  it("refuses a cross-tenant entry inside the bundle (A8 fail-closed)", () => {
    const other = buildCanonicalEntry({ ...entryInput("e-other"), tenantId: "t2" });
    if (!other.ok) throw new Error(other.reason);
    const r = sealCanonicalBundle({ bundleId: "b", tenantId: "t1", entries: [makeEntry(), other.entry], sealedAt: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("bundle.tenant-mismatch");
  });
});

// ---------- Bundle integrity verification ----------

describe("bundle integrity verification", () => {
  it("verifies a healthy bundle", () => {
    const bundle = makeBundle([makeEntry("e1"), makeEntry("e2")]);
    const v = verifyCanonicalBundle(bundle);
    expect(v.verified).toBe(true);
    expect(v.checkedEntries).toBe(2);
    expect(v.reason).toBeNull();
  });

  it("detects a tampered bundle digest", () => {
    const bundle = makeBundle([makeEntry("e1")]);
    const tampered: CanonicalEvidenceBundle = { ...bundle, bundleDigest: "0".repeat(64) };
    const v = verifyCanonicalBundle(tampered);
    expect(v.verified).toBe(false);
    expect(v.reason).toBe("integrity.bundle-digest-mismatch");
  });

  it("detects an entry whose payload digest is not a sha-256 hex digest", () => {
    const bundle = makeBundle([makeEntry("e1")]);
    const tampered: CanonicalEvidenceBundle = {
      ...bundle,
      entries: [{ ...bundle.entries[0]!, payloadDigest: "not-a-digest" }],
    };
    const v = verifyCanonicalBundle(tampered);
    expect(v.verified).toBe(false);
    expect(v.reason).toBe("integrity.entry-digest-mismatch");
    expect(v.brokenEntryId).toBe("e1");
  });

  it("detects an appended entry that changes the digest (content grew without re-seal)", () => {
    const bundle = makeBundle([makeEntry("e1")]);
    const grown: CanonicalEvidenceBundle = {
      ...bundle,
      entries: [...bundle.entries, makeEntry("e2")], // digest NOT recomputed
    };
    const v = verifyCanonicalBundle(grown);
    expect(v.verified).toBe(false);
    expect(v.reason).toBe("integrity.bundle-digest-mismatch");
  });

  it("detects a cross-tenant entry smuggled into a sealed bundle (A8)", () => {
    const bundle = makeBundle([makeEntry("e1")]);
    const other = buildCanonicalEntry({ ...entryInput("e-t2"), tenantId: "t2" });
    if (!other.ok) throw new Error(other.reason);
    const smuggled: CanonicalEvidenceBundle = {
      ...bundle,
      entries: [...bundle.entries, other.entry],
    };
    const v = verifyCanonicalBundle(smuggled);
    expect(v.verified).toBe(false);
    expect(v.reason).toBe("integrity.tenant-mismatch");
    expect(v.brokenEntryId).toBe("e-t2");
  });

  it("detects duplicate entry ids inside a hand-built bundle", () => {
    const e = makeEntry("e1");
    const handBuilt: CanonicalEvidenceBundle = {
      bundleId: "b-1",
      tenantId: "t1",
      entries: [e, { ...e, payloadDigest: sha256Hex(utf8Bytes("x")) }],
      bundleDigest: computeCanonicalBundleDigest("b-1", "t1", [e, e]),
      sealedAt: 1,
    };
    const v = verifyCanonicalBundle(handBuilt);
    expect(v.verified).toBe(false);
    expect(v.reason).toBe("integrity.duplicate-entry");
  });

  it("detects a broken custody chain inside a sealed bundle", () => {
    const bundle = makeBundle([makeEntry("e1")]);
    const brokenCustody: CanonicalEvidenceBundle = {
      ...bundle,
      entries: [
        { ...bundle.entries[0]!, custody: [custody({ actorId: "x", role: "verifier", at: 50 })] },
      ],
      bundleDigest: computeCanonicalBundleDigest("b-1", "t1", [
        { ...bundle.entries[0]!, custody: [custody({ actorId: "x", role: "verifier", at: 50 })] },
      ]),
    };
    const v = verifyCanonicalBundle(brokenCustody);
    expect(v.verified).toBe(false);
    expect(v.reason).toBe("integrity.custody-missing-collector");
  });
});

// ---------- Verification records — signer-free determinism ----------

describe("verification records", () => {
  it("produces a verified record with a content-addressed id and digest", () => {
    const bundle = makeBundle([makeEntry("e1"), makeEntry("e2")]);
    const r = verifyBundleAndRecord(bundle, 1_000);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.record.outcome).toBe("verified");
    expect(r.record.reason).toBeNull();
    expect(r.record.checkedEntries).toBe(2);
    expect(r.record.verifiedAt).toBe(1_000);
    expect(r.record.verificationId).toBe(`ver-${r.record.recordDigest.slice(0, 24)}`);
  });

  it("is signer-free deterministic — same bundle + same verifiedAt => byte-identical record", () => {
    const bundle = makeBundle([makeEntry("e1")]);
    const a = verifyBundleAndRecord(bundle, 5_000);
    const b = verifyBundleAndRecord(bundle, 5_000);
    if (!a.ok || !b.ok) throw new Error("verify failed");
    expect(JSON.stringify(a.record)).toBe(JSON.stringify(b.record));
    expect(a.record.recordDigest).toBe(b.record.recordDigest);
  });

  it("a different verifiedAt yields a different record digest (time is an input, not wall-clock)", () => {
    const bundle = makeBundle([makeEntry("e1")]);
    const a = verifyBundleAndRecord(bundle, 5_000);
    const b = verifyBundleAndRecord(bundle, 6_000);
    if (!a.ok || !b.ok) throw new Error("verify failed");
    expect(a.record.recordDigest).not.toBe(b.record.recordDigest);
  });

  it("a failed integrity check yields a failed record with the exact reason", () => {
    const bundle = makeBundle([makeEntry("e1")]);
    const tampered: CanonicalEvidenceBundle = { ...bundle, bundleDigest: "f".repeat(64) };
    const r = verifyBundleAndRecord(tampered, 1_000);
    if (!r.ok) throw new Error(r.reason);
    expect(r.record.outcome).toBe("failed");
    expect(r.record.reason).toBe("integrity.bundle-digest-mismatch");
  });

  it("refuses an invalid verifiedAt (negative / non-integer)", () => {
    const bundle = makeBundle([makeEntry("e1")]);
    expect(verifyBundleAndRecord(bundle, -1).ok).toBe(false);
    expect(verifyBundleAndRecord(bundle, 1.5).ok).toBe(false);
  });

  it("property-style loop: seeded bundles of 1..5 entries verify deterministically", () => {
    for (let n = 1; n <= 5; n += 1) {
      const entries = Array.from({ length: n }, (_, i) => makeEntry(`e${i}`, { i, payload: "x".repeat(i + 1) }));
      const bundle = makeBundle(entries, `b-${n}`);
      const a = verifyBundleAndRecord(bundle, 1_000 + n);
      const b = verifyBundleAndRecord(bundle, 1_000 + n);
      if (!a.ok || !b.ok) throw new Error("verify failed");
      expect(a.record.recordDigest).toBe(b.record.recordDigest);
      expect(a.record.outcome).toBe("verified");
      expect(a.record.checkedEntries).toBe(n);
    }
  });
});
