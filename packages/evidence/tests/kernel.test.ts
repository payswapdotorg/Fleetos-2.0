/**
 * Evidence kernel tests — artifact store, bundle completeness,
 * A13 traceability chain.
 *
 * Wave 1 (F210B) additions.
 */
import { describe, it, expect } from "vitest";
import {
  InMemoryArtifactStore,
  verifyBundleCompleteness,
  assembleBundle,
  buildTraceabilityChain,
  verifyTraceabilityChain,
  buildCompleteChain,
  REQUIRED_LINK_KINDS,
  utf8Bytes,
} from "../src/index.ts";
import type { TraceabilityLink, TraceabilityChain } from "../src/index.ts";

// ---------- Artifact Store ----------

describe("InMemoryArtifactStore", () => {
  it("stores bytes and returns content-addressed artifact", async () => {
    const store = new InMemoryArtifactStore();
    const bytes = utf8Bytes("hello world");
    const art = await store.store(bytes, "text/plain", "test");
    expect(art.sha256).toHaveLength(64);
    expect(art.bytes).toBe(11);
    expect(art.mediaType).toBe("text/plain");
    expect(art.artifactId).toContain("art-");
  });

  it("deduplicates by sha-256 digest", async () => {
    const store = new InMemoryArtifactStore();
    const bytes = utf8Bytes("same content");
    const art1 = await store.store(bytes, "text/plain", "first");
    const art2 = await store.store(bytes, "text/plain", "second");
    expect(art1.sha256).toBe(art2.sha256);
    expect(art1.artifactId).toBe(art2.artifactId);
    expect(store.size()).toBe(1); // dedup
  });

  it("retrieves by sha-256 digest", async () => {
    const store = new InMemoryArtifactStore();
    const bytes = utf8Bytes("retrieve me");
    const art = await store.store(bytes, "text/plain", "test");
    const retrieved = await store.retrieve(art.sha256);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.sha256).toBe(art.sha256);
  });

  it("retrieve returns null for unknown digest", async () => {
    const store = new InMemoryArtifactStore();
    expect(await store.retrieve("unknown".repeat(8))).toBeNull();
  });

  it("exists returns true/false correctly", async () => {
    const store = new InMemoryArtifactStore();
    const bytes = utf8Bytes("exists test");
    const art = await store.store(bytes, "text/plain", "test");
    expect(await store.exists(art.sha256)).toBe(true);
    expect(await store.exists("nonexistent".repeat(6))).toBe(false);
  });

  it("produces well-known sha-256 digest for 'hello world'", async () => {
    const store = new InMemoryArtifactStore();
    const art = await store.store(utf8Bytes("hello world"), "text/plain", "test");
    // sha256("hello world") = b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9
    expect(art.sha256).toBe("b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");
  });
});

// ---------- Bundle Completeness ----------

describe("verifyBundleCompleteness", () => {
  it("returns verified=true when all artifacts exist", async () => {
    const store = new InMemoryArtifactStore();
    const art1 = await store.store(utf8Bytes("a1"), "text/plain", "1");
    const art2 = await store.store(utf8Bytes("a2"), "text/plain", "2");

    const result = await verifyBundleCompleteness(store, {
      bundleId: "b1",
      tenantId: "t1",
      entries: [
        { evidenceId: "e1", artifactDigests: [art1.sha256] },
        { evidenceId: "e2", artifactDigests: [art2.sha256] },
      ],
    });
    expect(result.verified).toBe(true);
    expect(result.totalArtifacts).toBe(2);
    expect(result.presentArtifacts).toBe(2);
    expect(result.missingArtifacts).toEqual([]);
  });

  it("returns verified=false when artifacts are missing (fail-closed)", async () => {
    const store = new InMemoryArtifactStore();
    const art1 = await store.store(utf8Bytes("a1"), "text/plain", "1");
    const missingDigest = "0".repeat(64);

    const result = await verifyBundleCompleteness(store, {
      bundleId: "b1",
      tenantId: "t1",
      entries: [
        { evidenceId: "e1", artifactDigests: [art1.sha256, missingDigest] },
      ],
    });
    expect(result.verified).toBe(false);
    expect(result.missingArtifacts).toEqual([missingDigest]); // sorted
    expect(result.presentArtifacts).toBe(1);
    expect(result.totalArtifacts).toBe(2);
  });

  it("returns sorted missing artifacts when multiple are missing", async () => {
    const store = new InMemoryArtifactStore();
    const digests = ["f".repeat(64), "a".repeat(64), "5".repeat(64)];
    const result = await verifyBundleCompleteness(store, {
      bundleId: "b1",
      tenantId: "t1",
      entries: [{ evidenceId: "e1", artifactDigests: digests }],
    });
    expect(result.verified).toBe(false);
    expect(result.missingArtifacts).toEqual([...digests].sort());
  });

  it("deduplicates artifact digests across entries", async () => {
    const store = new InMemoryArtifactStore();
    const art1 = await store.store(utf8Bytes("shared"), "text/plain", "shared");

    const result = await verifyBundleCompleteness(store, {
      bundleId: "b1",
      tenantId: "t1",
      entries: [
        { evidenceId: "e1", artifactDigests: [art1.sha256] },
        { evidenceId: "e2", artifactDigests: [art1.sha256] }, // same digest
      ],
    });
    expect(result.totalArtifacts).toBe(1); // deduped
    expect(result.verified).toBe(true);
  });
});

describe("assembleBundle", () => {
  it("assembles and computes bundle digest", async () => {
    const store = new InMemoryArtifactStore();
    const art1 = await store.store(utf8Bytes("a1"), "text/plain", "1");

    const result = await assembleBundle(store, {
      bundleId: "b1",
      tenantId: "t1",
      entries: [{ evidenceId: "e1", artifactDigests: [art1.sha256] }],
    });
    expect(result.completeness.verified).toBe(true);
    expect(result.bundleDigest).toHaveLength(64);
  });

  it("bundle digest is deterministic", async () => {
    const store = new InMemoryArtifactStore();
    const input = {
      bundleId: "b1",
      tenantId: "t1",
      entries: [{ evidenceId: "e1", artifactDigests: [] }],
    };
    const r1 = await assembleBundle(store, input);
    const r2 = await assembleBundle(store, input);
    expect(r1.bundleDigest).toBe(r2.bundleDigest);
  });
});

// ---------- A13 Traceability Chain ----------

describe("TraceabilityChain", () => {
  it("REQUIRED_LINK_KINDS has exactly 6 kinds in canonical order", () => {
    expect(REQUIRED_LINK_KINDS).toEqual([
      "actor",
      "intent",
      "authorization",
      "execution",
      "verification",
      "capability_version",
    ]);
  });

  it("buildCompleteChain produces a chain with all 6 links in order", () => {
    const chain = buildCompleteChain({
      tenantId: "t1",
      actorId: "user-1",
      intentRef: "intent-1",
      authorizationRef: "auth-1",
      executionRef: "exec-1",
      verificationRef: "verify-1",
      capabilityId: "cap.test",
      capabilityVersion: "1.0.0",
      recordedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(chain.links).toHaveLength(6);
    expect(chain.links.map((l) => l.kind)).toEqual(REQUIRED_LINK_KINDS);
    expect(chain.chainDigest).toHaveLength(64);
  });

  it("verifyTraceabilityChain returns verified=true for a complete chain", () => {
    const chain = buildCompleteChain({
      tenantId: "t1",
      actorId: "user-1",
      intentRef: "intent-1",
      authorizationRef: "auth-1",
      executionRef: "exec-1",
      verificationRef: "verify-1",
      capabilityId: "cap.test",
      capabilityVersion: "1.0.0",
      recordedAt: "2026-01-01T00:00:00.000Z",
    });
    const result = verifyTraceabilityChain(chain);
    expect(result.verified).toBe(true);
    expect(result.reason).toBeNull();
    expect(result.missingLinks).toEqual([]);
  });

  it("verifyTraceabilityChain returns verified=false for empty chain", () => {
    const chain: TraceabilityChain = {
      chainId: "trace-empty",
      tenantId: "t1",
      links: [],
      computedAt: "2026-01-01T00:00:00.000Z",
      chainDigest: "",
    };
    const result = verifyTraceabilityChain(chain);
    expect(result.verified).toBe(false);
    expect(result.reason).toBe("trace.empty");
    expect(result.missingLinks).toHaveLength(6);
  });

  it("verifyTraceabilityChain detects missing actor link", () => {
    const links: TraceabilityLink[] = [
      { kind: "intent", ref: "i1", recordedAt: "t", details: {} },
      { kind: "authorization", ref: "a1", recordedAt: "t", details: {} },
      { kind: "execution", ref: "e1", recordedAt: "t", details: {} },
      { kind: "verification", ref: "v1", recordedAt: "t", details: {} },
      { kind: "capability_version", ref: "c1:1.0", recordedAt: "t", details: {} },
    ];
    const chain = buildTraceabilityChain("t1", links);
    const result = verifyTraceabilityChain(chain);
    expect(result.verified).toBe(false);
    expect(result.reason).toBe("trace.missing_actor");
    expect(result.missingLinks).toContain("actor");
  });

  it("verifyTraceabilityChain detects missing authorization link", () => {
    const links: TraceabilityLink[] = [
      { kind: "actor", ref: "u1", recordedAt: "t", details: {} },
      { kind: "intent", ref: "i1", recordedAt: "t", details: {} },
      { kind: "execution", ref: "e1", recordedAt: "t", details: {} },
      { kind: "verification", ref: "v1", recordedAt: "t", details: {} },
      { kind: "capability_version", ref: "c1:1.0", recordedAt: "t", details: {} },
    ];
    const chain = buildTraceabilityChain("t1", links);
    const result = verifyTraceabilityChain(chain);
    expect(result.verified).toBe(false);
    expect(result.reason).toBe("trace.missing_authorization");
  });

  it("verifyTraceabilityChain detects missing capability_version link", () => {
    const links: TraceabilityLink[] = [
      { kind: "actor", ref: "u1", recordedAt: "t", details: {} },
      { kind: "intent", ref: "i1", recordedAt: "t", details: {} },
      { kind: "authorization", ref: "a1", recordedAt: "t", details: {} },
      { kind: "execution", ref: "e1", recordedAt: "t", details: {} },
      { kind: "verification", ref: "v1", recordedAt: "t", details: {} },
    ];
    const chain = buildTraceabilityChain("t1", links);
    const result = verifyTraceabilityChain(chain);
    expect(result.verified).toBe(false);
    expect(result.reason).toBe("trace.missing_capability_version");
  });

  it("verifyTraceabilityChain detects tenant mismatch", () => {
    const links: TraceabilityLink[] = [
      { kind: "actor", ref: "u1", recordedAt: "t", details: { tenantId: "WRONG" } },
      { kind: "intent", ref: "i1", recordedAt: "t", details: {} },
      { kind: "authorization", ref: "a1", recordedAt: "t", details: {} },
      { kind: "execution", ref: "e1", recordedAt: "t", details: {} },
      { kind: "verification", ref: "v1", recordedAt: "t", details: {} },
      { kind: "capability_version", ref: "c1:1.0", recordedAt: "t", details: {} },
    ];
    const chain = buildTraceabilityChain("t1", links);
    const result = verifyTraceabilityChain(chain);
    expect(result.verified).toBe(false);
    expect(result.reason).toBe("trace.tenant_mismatch");
  });

  it("verifyTraceabilityChain detects digest mismatch (tamper detection)", () => {
    const chain = buildCompleteChain({
      tenantId: "t1",
      actorId: "user-1",
      intentRef: "intent-1",
      authorizationRef: "auth-1",
      executionRef: "exec-1",
      verificationRef: "verify-1",
      capabilityId: "cap.test",
      capabilityVersion: "1.0.0",
      recordedAt: "2026-01-01T00:00:00.000Z",
    });
    const tampered: TraceabilityChain = { ...chain, chainDigest: "tampered".repeat(8) };
    const result = verifyTraceabilityChain(tampered);
    expect(result.verified).toBe(false);
    expect(result.reason).toBe("trace.digest_mismatch");
  });

  it("buildTraceabilityChain sorts links into canonical order", () => {
    // Provide links out of order
    const links: TraceabilityLink[] = [
      { kind: "capability_version", ref: "c1:1.0", recordedAt: "t", details: {} },
      { kind: "actor", ref: "u1", recordedAt: "t", details: {} },
      { kind: "verification", ref: "v1", recordedAt: "t", details: {} },
      { kind: "intent", ref: "i1", recordedAt: "t", details: {} },
      { kind: "execution", ref: "e1", recordedAt: "t", details: {} },
      { kind: "authorization", ref: "a1", recordedAt: "t", details: {} },
    ];
    const chain = buildTraceabilityChain("t1", links);
    expect(chain.links.map((l) => l.kind)).toEqual(REQUIRED_LINK_KINDS);
  });

  it("chain digest is deterministic", () => {
    const c1 = buildCompleteChain({
      tenantId: "t1",
      actorId: "u1",
      intentRef: "i1",
      authorizationRef: "a1",
      executionRef: "e1",
      verificationRef: "v1",
      capabilityId: "cap",
      capabilityVersion: "1.0",
      recordedAt: "t",
    });
    const c2 = buildCompleteChain({
      tenantId: "t1",
      actorId: "u1",
      intentRef: "i1",
      authorizationRef: "a1",
      executionRef: "e1",
      verificationRef: "v1",
      capabilityId: "cap",
      capabilityVersion: "1.0",
      recordedAt: "t",
    });
    expect(c1.chainDigest).toBe(c2.chainDigest);
  });

  it("different chains produce different digests", () => {
    const c1 = buildCompleteChain({
      tenantId: "t1",
      actorId: "u1",
      intentRef: "i1",
      authorizationRef: "a1",
      executionRef: "e1",
      verificationRef: "v1",
      capabilityId: "cap",
      capabilityVersion: "1.0",
      recordedAt: "t",
    });
    const c2 = buildCompleteChain({
      tenantId: "t1",
      actorId: "u2", // different
      intentRef: "i1",
      authorizationRef: "a1",
      executionRef: "e1",
      verificationRef: "v1",
      capabilityId: "cap",
      capabilityVersion: "1.0",
      recordedAt: "t",
    });
    expect(c1.chainDigest).not.toBe(c2.chainDigest);
  });
});

// ---------- Integration: hash chain + artifact store + traceability ----------

describe("Evidence kernel integration", () => {
  it("stores artifacts, verifies chain, assembles bundle", async () => {
    const store = new InMemoryArtifactStore();
    const execProof = await store.store(utf8Bytes("exec-proof"), "application/octet-stream", "execution proof");
    const verifyProof = await store.store(utf8Bytes("verify-proof"), "application/octet-stream", "verification proof");

    // Build traceability chain
    const chain = buildCompleteChain({
      tenantId: "t1",
      actorId: "user-1",
      intentRef: "intent-1",
      authorizationRef: "auth-1",
      executionRef: execProof.sha256,
      verificationRef: verifyProof.sha256,
      capabilityId: "cap.test",
      capabilityVersion: "1.0.0",
      recordedAt: "2026-01-01T00:00:00.000Z",
    });

    const chainVerification = verifyTraceabilityChain(chain);
    expect(chainVerification.verified).toBe(true);

    // Verify bundle completeness
    const bundleResult = await verifyBundleCompleteness(store, {
      bundleId: "b1",
      tenantId: "t1",
      entries: [
        { evidenceId: "e1", artifactDigests: [execProof.sha256] },
        { evidenceId: "e2", artifactDigests: [verifyProof.sha256] },
      ],
    });
    expect(bundleResult.verified).toBe(true);
  });
});
