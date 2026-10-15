/**
 * F370A credential tests — scrypt issuance, timing-safe verification, and
 * the ENUMERATION-RESISTANCE law (unknown-actor, malformed-record and
 * wrong-secret refusals are byte-identical verdicts; the plaintext is
 * never stored, never echoed).
 *
 * scrypt call count is deliberately tight (the frozen N=16384 parameter
 * set costs real milliseconds): all records are derived once at module
 * scope and reused; every verify below burns exactly one derivation,
 * which is the LAW under test (the burn path is the point).
 */

import { describe, expect, it } from "vitest";
import {
  CREDENTIAL_BURN_SALT_HEX,
  CREDENTIAL_SCRYPT_PARAMETERS,
  issueCredential,
  verifyCredential,
  type CredentialRecord,
} from "./credentials.js";

const ACTOR = "act_operator-ama-01";
const TENANT = "acme-ops";
const SECRET = "correct horse battery staple f370a";
const SALT_A = "0f1e2d3c4b5a69788796a5b4c3d2e1f0";
const SALT_B = "f0e1d2c3b4a5968778695a4b3c2d1e0f";

const issued = issueCredential({
  credentialId: "cred-ama-1",
  actorId: ACTOR,
  tenantId: TENANT,
  kind: "human",
  secret: SECRET,
  saltHex: SALT_A,
});
if (!issued.ok) throw new Error("fixture issuance failed");

const otherSalt = issueCredential({
  credentialId: "cred-ama-2",
  actorId: ACTOR,
  tenantId: TENANT,
  kind: "human",
  secret: SECRET,
  saltHex: SALT_B,
});
if (!otherSalt.ok) throw new Error("fixture issuance failed");

describe("F370A issueCredential", () => {
  it("derives a frozen-shape record over the deterministic parameters", () => {
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;
    expect(issued.record.credentialId).toBe("cred-ama-1");
    expect(issued.record.actorId).toBe(ACTOR);
    expect(issued.record.tenantId).toBe(TENANT);
    expect(issued.record.kind).toBe("human");
    expect(issued.record.saltHex).toBe(SALT_A);
    expect(issued.record.params).toEqual(CREDENTIAL_SCRYPT_PARAMETERS);
    expect(issued.record.digestHex).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic: the same inputs derive the same digest", () => {
    const again = issueCredential({
      credentialId: "cred-ama-1",
      actorId: ACTOR,
      tenantId: TENANT,
      kind: "human",
      secret: SECRET,
      saltHex: SALT_A,
    });
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.record.digestHex).toBe(issued.record.digestHex);
  });

  it("salts the digest: the same secret under a different salt differs", () => {
    expect(otherSalt.ok).toBe(true);
    if (otherSalt.ok) {
      expect(otherSalt.record.digestHex).not.toBe(issued.record.digestHex);
    }
  });

  it("NEVER stores the plaintext: the serialized record carries no secret", () => {
    const serialized = JSON.stringify(issued.record);
    expect(serialized.includes(SECRET)).toBe(false);
    expect(Object.values(issued.record).includes(SECRET)).toBe(false);
  });

  it("refuses malformed issuance inputs fail-closed (no record, no digest)", () => {
    const base = {
      credentialId: "cred-x",
      tenantId: TENANT,
      kind: "human" as const,
      secret: "s3cret-value",
      saltHex: SALT_A,
    };
    const refusalOf = (overrides: Record<string, unknown>): string => {
      const r = issueCredential({ ...base, ...overrides } as Parameters<typeof issueCredential>[0]);
      if (r.ok) throw new Error("expected refusal");
      return r.reason;
    };
    expect(refusalOf({ actorId: "" })).toBe("missing-actor-id");
    expect(refusalOf({ actorId: "operator-no-prefix" })).toBe("malformed-actor-id");
    expect(refusalOf({ actorId: ACTOR, tenantId: "" })).toBe("missing-tenant-id");
    expect(refusalOf({ actorId: ACTOR, tenantId: "bad tenant!" })).toBe("malformed-tenant-id");
    expect(refusalOf({ actorId: ACTOR, secret: "" })).toBe("missing-secret");
    expect(refusalOf({ actorId: ACTOR, saltHex: "" })).toBe("missing-salt");
    expect(refusalOf({ actorId: ACTOR, saltHex: "zz-not-hex" })).toBe("malformed-salt");
    expect(refusalOf({ actorId: ACTOR, saltHex: "aabb" })).toBe("salt-too-short");
    expect(refusalOf({ actorId: ACTOR, credentialId: "" })).toBe("missing-credential-id");
  });
});

describe("F370A verifyCredential — the verification + enumeration-resistance laws", () => {
  it("verifies the correct secret", () => {
    const r = verifyCredential({ presentedSecret: SECRET, record: issued.record });
    expect(r).toEqual({ ok: true, actorId: ACTOR, tenantId: TENANT });
  });

  it("REFUSAL: a wrong secret refuses with the single code INVALID_CREDENTIAL", () => {
    const r = verifyCredential({ presentedSecret: "wrong horse", record: issued.record });
    expect(r).toEqual({ ok: false, reason: "INVALID_CREDENTIAL" });
  });

  it("REFUSAL: an UNKNOWN actor is indistinguishable from a wrong secret", () => {
    const unknown = verifyCredential({ presentedSecret: "wrong horse", record: null });
    const wrong = verifyCredential({ presentedSecret: "wrong horse", record: issued.record });
    expect(unknown).toEqual({ ok: false, reason: "INVALID_CREDENTIAL" });
    // The law, byte-for-byte: the two verdicts are IDENTICAL data.
    expect(unknown).toEqual(wrong);
  });

  it("REFUSAL: a MALFORMED record is indistinguishable from a wrong secret", () => {
    const tamperedDigest: CredentialRecord = { ...issued.record, digestHex: "deadbeef" };
    const downgradedParams: CredentialRecord = {
      ...issued.record,
      params: { ...CREDENTIAL_SCRYPT_PARAMETERS, costN: 1024 },
    };
    const badKind: CredentialRecord = { ...issued.record, kind: "robot" as "human" };
    for (const record of [tamperedDigest, downgradedParams, badKind]) {
      const r = verifyCredential({ presentedSecret: SECRET, record });
      expect(r).toEqual({ ok: false, reason: "INVALID_CREDENTIAL" });
    }
    // The law again: identical to the plain wrong-secret verdict.
    expect(verifyCredential({ presentedSecret: SECRET, record: tamperedDigest })).toEqual(
      verifyCredential({ presentedSecret: "nope", record: issued.record }),
    );
  });

  it("refuses the right secret against ANOTHER PRINCIPAL's record (credential isolation)", () => {
    const otherPrincipal = issueCredential({
      credentialId: "cred-ama-3",
      actorId: ACTOR,
      tenantId: TENANT,
      kind: "human",
      secret: "a-completely-different-secret",
      saltHex: SALT_B,
    });
    if (!otherPrincipal.ok) throw new Error("fixture");
    // The SAME salt family, a DIFFERENT secret: presenting OUR secret
    // against their record must refuse (the digest is secret-bound).
    const r = verifyCredential({ presentedSecret: SECRET, record: otherPrincipal.record });
    expect(r).toEqual({ ok: false, reason: "INVALID_CREDENTIAL" });
  });

  it("is TOTAL: undefined records and empty presentations still return typed verdicts", () => {
    expect(verifyCredential({ presentedSecret: "", record: undefined })).toEqual({
      ok: false,
      reason: "INVALID_CREDENTIAL",
    });
    expect(verifyCredential({ presentedSecret: SECRET, record: null })).toEqual({
      ok: false,
      reason: "INVALID_CREDENTIAL",
    });
  });

  it("the burn target is labelled and never a production salt shape-mate", () => {
    expect(CREDENTIAL_BURN_SALT_HEX).toMatch(/^[0-9a-f]{32}$/);
    expect(CREDENTIAL_BURN_SALT_HEX).not.toBe(SALT_A);
    expect(CREDENTIAL_BURN_SALT_HEX).not.toBe(SALT_B);
  });

  it("the frozen parameter set is the OWASP floor (recorded, machine-pinned)", () => {
    expect(CREDENTIAL_SCRYPT_PARAMETERS.costN).toBeGreaterThanOrEqual(16_384);
    expect(CREDENTIAL_SCRYPT_PARAMETERS.blockSizeR).toBe(8);
    expect(CREDENTIAL_SCRYPT_PARAMETERS.parallelizationP).toBe(1);
    expect(CREDENTIAL_SCRYPT_PARAMETERS.keylenBytes).toBe(32);
  });
});
