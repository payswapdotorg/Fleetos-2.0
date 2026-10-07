import { describe, it, expect } from "vitest";
import {
  appendEvidence,
  buildArtifact,
  bytesToHex,
  computeBundleDigest,
  computeEntryDigest,
  defaultSha256,
  hexToBytes,
  sha256Hex,
  utf8Bytes,
  verifyEvidenceChain,
  type EvidenceChainEntry,
  type Sha256Port,
} from "../src/index.ts";

/** Deterministic fake sha256 — reverses the bytes' hex string for testing. */
const fakeSha: Sha256Port = (bytes) => {
  // A predictable, deterministic digest for tests that want stability
  // without depending on real SHA-256. NOT cryptographically valid.
  return bytesToHex(bytes).split("").reverse().join("").padEnd(64, "0").slice(0, 64);
};

describe("sha256Hex: determinism", () => {
  it("returns the same digest for the same input bytes", () => {
    const a = sha256Hex(utf8Bytes("hello"));
    const b = sha256Hex(utf8Bytes("hello"));
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it("returns a different digest for different inputs", () => {
    expect(sha256Hex(utf8Bytes("hello"))).not.toBe(sha256Hex(utf8Bytes("world")));
  });

  it("matches the well-known SHA-256 of empty string", () => {
    expect(sha256Hex(new Uint8Array(0))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("matches the well-known SHA-256 of 'abc'", () => {
    expect(sha256Hex(utf8Bytes("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("hex / bytes round-trip", () => {
  it("round-trips arbitrary bytes through hex", () => {
    const bytes = new Uint8Array([0, 1, 2, 255, 128, 64]);
    const hex = bytesToHex(bytes);
    expect(hex).toBe("000102ff8040");
    expect(hexToBytes(hex)).toEqual(bytes);
  });

  it("rejects odd-length hex", () => {
    expect(() => hexToBytes("abc")).toThrow();
  });
});

describe("custom Sha256Port seam", () => {
  it("uses the injected port instead of node:crypto", () => {
    const fake = fakeSha;
    const a = sha256Hex(utf8Bytes("hello"), fake);
    const b = sha256Hex(utf8Bytes("hello"), fake);
    expect(a).toBe(b);
    expect(a).not.toBe(sha256Hex(utf8Bytes("hello"), defaultSha256));
  });
});

describe("appendEvidence: append-only chain", () => {
  it("creates a single-entry chain with previousDigest=null", () => {
    const chain = appendEvidence([], { evidenceId: "e1", tenantId: "t1", recordedAt: "0" });
    expect(chain).toHaveLength(1);
    expect(chain[0]?.index).toBe(0);
    expect(chain[0]?.previousDigest).toBe(null);
    expect(chain[0]?.entryDigest).toHaveLength(64);
  });

  it("links each new entry to the previous entry's digest", () => {
    let chain: readonly EvidenceChainEntry[] = [];
    chain = appendEvidence(chain, { evidenceId: "e1", tenantId: "t1", recordedAt: "0" });
    chain = appendEvidence(chain, { evidenceId: "e2", tenantId: "t1", recordedAt: "1" });
    chain = appendEvidence(chain, { evidenceId: "e3", tenantId: "t1", recordedAt: "2" });
    expect(chain).toHaveLength(3);
    expect(chain[1]?.previousDigest).toBe(chain[0]?.entryDigest);
    expect(chain[2]?.previousDigest).toBe(chain[1]?.entryDigest);
  });

  it("refuses to append across tenants (fail-closed)", () => {
    let chain = appendEvidence([], { evidenceId: "e1", tenantId: "t1", recordedAt: "0" });
    expect(() => appendEvidence(chain, { evidenceId: "e2", tenantId: "t2", recordedAt: "1" })).toThrow();
  });

  it("is pure — does not mutate the input array", () => {
    const initial: readonly EvidenceChainEntry[] = [];
    const next = appendEvidence(initial, { evidenceId: "e1", tenantId: "t1", recordedAt: "0" });
    expect(initial).toHaveLength(0);
    expect(next).toHaveLength(1);
  });
});

describe("verifyEvidenceChain", () => {
  it("verifies an empty chain", () => {
    const r = verifyEvidenceChain([]);
    expect(r.verified).toBe(true);
    expect(r.checkedEntries).toBe(0);
    expect(r.reason).toBe("chain.empty");
  });

  it("verifies a correctly-built chain", () => {
    let chain: readonly EvidenceChainEntry[] = [];
    for (let i = 0; i < 5; i += 1) {
      chain = appendEvidence(chain, { evidenceId: `e${i}`, tenantId: "t1", recordedAt: `${i}` });
    }
    const r = verifyEvidenceChain(chain);
    expect(r.verified).toBe(true);
    expect(r.checkedEntries).toBe(5);
    expect(r.brokenAt).toBe(null);
  });

  it("detects a tampered entry digest", () => {
    let chain: readonly EvidenceChainEntry[] = [];
    chain = appendEvidence(chain, { evidenceId: "e1", tenantId: "t1", recordedAt: "0" });
    chain = appendEvidence(chain, { evidenceId: "e2", tenantId: "t1", recordedAt: "1" });
    const tampered: EvidenceChainEntry = { ...chain[1]!, entryDigest: "0".repeat(64) };
    const broken = [chain[0]!, tampered];
    const r = verifyEvidenceChain(broken);
    expect(r.verified).toBe(false);
    expect(r.brokenAt).toBe(1);
    expect(r.reason).toBe("chain.entry_digest_mismatch");
  });

  it("detects an index gap", () => {
    let chain: readonly EvidenceChainEntry[] = [];
    chain = appendEvidence(chain, { evidenceId: "e1", tenantId: "t1", recordedAt: "0" });
    chain = appendEvidence(chain, { evidenceId: "e2", tenantId: "t1", recordedAt: "1" });
    // Tamper: skip index 1 -> 3
    const tampered: EvidenceChainEntry = {
      ...chain[1]!,
      index: 3,
      entryDigest: computeEntryDigest(chain[0]!.entryDigest, "e2", "t1", 3),
    };
    const r = verifyEvidenceChain([chain[0]!, tampered]);
    expect(r.verified).toBe(false);
    expect(r.reason).toBe("chain.index_gap");
  });

  it("detects a tenant mismatch", () => {
    let chain: readonly EvidenceChainEntry[] = [];
    chain = appendEvidence(chain, { evidenceId: "e1", tenantId: "t1", recordedAt: "0" });
    chain = appendEvidence(chain, { evidenceId: "e2", tenantId: "t1", recordedAt: "1" });
    const tampered: EvidenceChainEntry = { ...chain[1]!, tenantId: "t2" };
    const r = verifyEvidenceChain([chain[0]!, tampered]);
    expect(r.verified).toBe(false);
    expect(r.reason).toBe("chain.tenant_mismatch");
  });

  it("detects a broken previousDigest link", () => {
    let chain: readonly EvidenceChainEntry[] = [];
    chain = appendEvidence(chain, { evidenceId: "e1", tenantId: "t1", recordedAt: "0" });
    chain = appendEvidence(chain, { evidenceId: "e2", tenantId: "t1", recordedAt: "1" });
    const tampered: EvidenceChainEntry = {
      ...chain[1]!,
      previousDigest: "f".repeat(64),
      entryDigest: computeEntryDigest("f".repeat(64), "e2", "t1", 1),
    };
    const r = verifyEvidenceChain([chain[0]!, tampered]);
    expect(r.verified).toBe(false);
    expect(r.reason).toBe("chain.previous_digest_mismatch");
  });

  it("rejects a first entry with non-null previousDigest", () => {
    const bad: EvidenceChainEntry = {
      index: 0,
      tenantId: "t1",
      evidenceId: "e1",
      previousDigest: "f".repeat(64),
      entryDigest: computeEntryDigest("f".repeat(64), "e1", "t1", 0),
      recordedAt: "0",
    };
    const r = verifyEvidenceChain([bad]);
    expect(r.verified).toBe(false);
    expect(r.reason).toBe("chain.first_entry_has_previous");
  });
});

describe("buildArtifact + computeBundleDigest", () => {
  it("buildArtifact computes sha256 over the raw bytes", () => {
    const a = buildArtifact("a1", utf8Bytes("hello"), "text/plain", "test");
    expect(a.sha256).toBe(sha256Hex(utf8Bytes("hello")));
    expect(a.bytes).toBe(5);
  });

  it("computeBundleDigest is stable for the same evidence set in any order", () => {
    const a = computeBundleDigest("b1", "t1", ["e1", "e2", "e3"]);
    const b = computeBundleDigest("b1", "t1", ["e3", "e2", "e1"]);
    expect(a).toBe(b);
  });

  it("computeBundleDigest differs for different bundle IDs", () => {
    expect(computeBundleDigest("b1", "t1", ["e1"])).not.toBe(computeBundleDigest("b2", "t1", ["e1"]));
  });
});
