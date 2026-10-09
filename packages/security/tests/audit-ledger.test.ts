/**
 * Audit-ledger tests (F280B, Wave 8 lane B).
 *
 * Behavior under test: append-only hash chaining over the lane's three REAL
 * decision surfaces, tamper detection (payload / chain digest / removal gap),
 * documented gap semantics (gapAt names the removed position), external head
 * anchoring for tail truncation, and A8 tenant fail-closed appends.
 */
import { describe, it, expect } from "vitest";
import {
  appendAuditEvent,
  verifyAuditLedger,
  verifyAuditLedgerAgainstAnchor,
  sealAuditLedgerHead,
  dropAuditEvent,
  tamperAuditPayload,
  tamperAuditEntryDigest,
  auditEntryDigest,
  auditPayloadDigest,
} from "../src/index.ts";
import type { AuditLedgerEvent } from "../src/index.ts";

const TENANT = "tnt_alpha";

function seedLedger(count = 5): readonly AuditLedgerEvent[] {
  let ledger: readonly AuditLedgerEvent[] = [];
  for (let i = 0; i < count; i += 1) {
    const surface = (["guardian.evaluation", "action.emission", "execution.entry"] as const)[i % 3]!;
    const appended = appendAuditEvent(ledger, {
      tenantId: TENANT,
      surface,
      subjectId: `subject-${i}`,
      occurredAt: 1_000 + i,
      payload: { i, verdict: i % 2 === 0 ? "ALLOW" : "BLOCK", detail: `step ${i}` },
    });
    if (!appended.ok) throw new Error(`seed append ${i} refused: ${appended.reason}`);
    ledger = appended.ledger;
  }
  return ledger;
}

describe("audit ledger — append + chain", () => {
  it("appends sequentially, chaining previous digests", () => {
    const a = appendAuditEvent([], {
      tenantId: TENANT, surface: "guardian.evaluation", subjectId: "rec-1",
      occurredAt: 1_000, payload: { verdict: "ALLOW" },
    });
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.event.sequence).toBe(0);
    expect(a.event.previousDigest).toBeNull();

    const b = appendAuditEvent(a.ledger, {
      tenantId: TENANT, surface: "action.emission", subjectId: "audit-1",
      occurredAt: 1_001, payload: { kind: "action.authorized" },
    });
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    expect(b.event.sequence).toBe(1);
    expect(b.event.previousDigest).toBe(a.event.entryDigest);
  });

  it("seals the payload content-addressedly (digest matches canonical JSON)", () => {
    const payload = { z: 1, a: { y: true, b: "s" } };
    const r = appendAuditEvent([], {
      tenantId: TENANT, surface: "execution.entry", subjectId: "k1#0",
      occurredAt: 5, payload,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.event.payloadDigest).toBe(auditPayloadDigest(payload));
    // Key order in the caller's payload never leaks into the digest.
    expect(auditPayloadDigest({ a: { b: "s", y: true }, z: 1 })).toBe(r.event.payloadDigest);
  });

  it("verifies a genuine chain and reports the head digest", () => {
    const ledger = seedLedger(6);
    const v = verifyAuditLedger(ledger);
    expect(v.verified).toBe(true);
    expect(v.checkedEntries).toBe(6);
    expect(v.brokenAt).toBeNull();
    expect(v.computedHeadDigest).toBe(sealAuditLedgerHead(ledger));
  });

  it("empty ledger verifies trivially", () => {
    const v = verifyAuditLedger([]);
    expect(v.verified).toBe(true);
    expect(v.checkedEntries).toBe(0);
  });
});

describe("audit ledger — refusal surface", () => {
  it("refuses missing tenant, subject, unknown surface, invalid at", () => {
    expect(appendAuditEvent([], { tenantId: "", surface: "guardian.evaluation", subjectId: "s", occurredAt: 1, payload: {} })).toMatchObject({ ok: false, reason: "audit.missing-tenant" });
    expect(appendAuditEvent([], { tenantId: TENANT, surface: "guardian.evaluation", subjectId: "", occurredAt: 1, payload: {} })).toMatchObject({ ok: false, reason: "audit.missing-subject" });
    expect(appendAuditEvent([], { tenantId: TENANT, surface: "nonsense" as never, subjectId: "s", occurredAt: 1, payload: {} })).toMatchObject({ ok: false, reason: "audit.unknown-surface" });
    expect(appendAuditEvent([], { tenantId: TENANT, surface: "guardian.evaluation", subjectId: "s", occurredAt: -1, payload: {} })).toMatchObject({ ok: false, reason: "audit.invalid-occurred-at" });
  });

  it("refuses an out-of-position explicit sequence", () => {
    const ledger = seedLedger(2);
    const r = appendAuditEvent(ledger, {
      tenantId: TENANT, surface: "execution.entry", subjectId: "s9", occurredAt: 9,
      payload: {}, sequence: 7,
    });
    expect(r).toMatchObject({ ok: false, reason: "audit.invalid-sequence" });
  });

  it("A8 fail-closed: refuses a cross-tenant append into the chain", () => {
    const ledger = seedLedger(2); // tnt_alpha chain
    const r = appendAuditEvent(ledger, {
      tenantId: "tnt_beta", surface: "guardian.evaluation", subjectId: "rec-x",
      occurredAt: 9, payload: {},
    });
    expect(r).toMatchObject({ ok: false, reason: "audit.tenant-mismatch" });
  });
});

describe("audit ledger — tamper detection", () => {
  it("detects payload content tampering at the exact position", () => {
    const ledger = seedLedger(5);
    const tampered = tamperAuditPayload(ledger, 3, { verdict: "ALLOW" });
    const v = verifyAuditLedger(tampered);
    expect(v.verified).toBe(false);
    expect(v.brokenAt).toBe(3);
    expect(v.reason).toBe("audit.payload_digest_mismatch");
  });

  it("detects a forged chain digest at the exact position", () => {
    const ledger = seedLedger(5);
    const tampered = tamperAuditEntryDigest(ledger, 2, "deadbeef");
    const v = verifyAuditLedger(tampered);
    expect(v.verified).toBe(false);
    expect(v.brokenAt).toBe(2);
    expect(v.reason).toBe("audit.entry_digest_mismatch");
  });

  it("detects a broken previous-digest link at the successor position", () => {
    const ledger = seedLedger(5);
    const relinked = ledger.map((e) =>
      e.sequence === 3 ? { ...e, previousDigest: "ffffffff" } : e,
    );
    const v = verifyAuditLedger(relinked);
    expect(v.verified).toBe(false);
    expect(v.brokenAt).toBe(3);
    expect(v.reason).toBe("audit.previous_digest_mismatch");
  });

  it("GAP SEMANTICS: a removed interior entry fails naming the gap position", () => {
    const ledger = seedLedger(6);
    const withGap = dropAuditEvent(ledger, 3); // entry at position 3 removed
    const v = verifyAuditLedger(withGap);
    expect(v.verified).toBe(false);
    expect(v.gapAt).toBe(3);
    expect(v.brokenAt).toBe(3);
    expect(v.reason).toBe("audit.gap");
    expect(v.checkedEntries).toBe(3);
  });

  it("removing the first entry names gap position 0", () => {
    const ledger = seedLedger(4);
    const v = verifyAuditLedger(dropAuditEvent(ledger, 0));
    expect(v.verified).toBe(false);
    expect(v.gapAt).toBe(0);
    expect(v.reason).toBe("audit.gap");
  });

  it("detects a regressed (rewound) sequence", () => {
    const ledger = seedLedger(4);
    const rewound = ledger.map((e) => (e.sequence === 2 ? { ...e, sequence: 1 } : e));
    const v = verifyAuditLedger(rewound);
    expect(v.verified).toBe(false);
    expect(v.reason).toBe("audit.sequence-regressed");
    expect(v.brokenAt).toBe(2);
  });

  it("HONEST LIMIT + anchor: tail truncation is caught by the external head anchor", () => {
    const ledger = seedLedger(5);
    const anchor = sealAuditLedgerHead(ledger);
    // Unanchored verify cannot see tail truncation (documented honest limit)…
    const truncated = dropAuditEvent(ledger, 4);
    expect(verifyAuditLedger(truncated).verified).toBe(true);
    // …but the anchor check fails loudly.
    const av = verifyAuditLedgerAgainstAnchor(truncated, anchor!);
    expect(av.verified).toBe(false);
    expect(av.truncated).toBe(true);
    // The genuine ledger still matches its anchor.
    expect(verifyAuditLedgerAgainstAnchor(ledger, anchor!).verified).toBe(true);
  });
});

describe("audit ledger — determinism", () => {
  it("identical inputs produce byte-identical chains", () => {
    const build = () => seedLedger(5);
    expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
  });

  it("auditEntryDigest is stable and covers every canonical field", () => {
    const base = {
      sequence: 1, tenantId: TENANT, surface: "action.emission" as const,
      subjectId: "s", occurredAt: 7, payloadDigest: "abc12345", previousDigest: "00000000",
    };
    expect(auditEntryDigest(base)).toBe(auditEntryDigest({ ...base }));
    expect(auditEntryDigest({ ...base, tenantId: "tnt_beta" })).not.toBe(auditEntryDigest(base));
    expect(auditEntryDigest({ ...base, subjectId: "other" })).not.toBe(auditEntryDigest(base));
    expect(auditEntryDigest({ ...base, occurredAt: 8 })).not.toBe(auditEntryDigest(base));
  });
});
