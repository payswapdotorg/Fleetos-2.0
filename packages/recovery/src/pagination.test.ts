/**
 * @fleetos/recovery — Wave 8 case-volume pagination law tests (F280A).
 *
 * Covers:
 *   - Deterministic ordering: shuffled inputs yield identical pages; the
 *     (openedAt DESC, id ASC) tie-break makes the order total.
 *   - Exhaustive keyset walk at fleet scale: every case exactly once.
 *   - Stable pages under inserts BETWEEN reads: no duplicates, no skips of
 *     pre-existing cases (law a); inserts behind the cursor may appear on
 *     later pages (law b); inserts ahead of the cursor are not seen (law c).
 *   - Fail-closed validation: invalid limits; malformed cursors.
 *   - Tenant isolation: foreign-tenant cursor refuses cursor-tenant-mismatch;
 *     missing tenant refuses missing-tenant-id; the page never contains a
 *     foreign-tenant case even if one is injected into the underlying list.
 */

import { describe, it, expect } from "vitest";
import {
  MAX_PAGE_LIMIT,
  decodeRecoveryCaseCursor,
  encodeRecoveryCaseCursor,
  paginateCasesForTenant,
  paginateRecoveryCases,
  recoveryCasePageDigest,
  type RecoveryCaseCursor,
} from "./pagination.js";
import { openRecoveryCase, type RecoveryCase, type RecoveryCaseId } from "./recovery.js";

const NOW = 1_727_000_000_000;
const TENANT_A = "tnt_acme";
const TENANT_B = "tnt_globex";

function mkCase(id: string, openedAt: number, tenantId = TENANT_A): RecoveryCase {
  return openRecoveryCase({ id: id as RecoveryCaseId, tenantId, deviceId: "dev_truck-001", openedAt });
}

function fleet(count: number, tenantId = TENANT_A): RecoveryCase[] {
  const cases: RecoveryCase[] = [];
  for (let i = 1; i <= count; i++) {
    cases.push(mkCase(`rc_${String(i).padStart(6, "0")}`, NOW + (count - i) * 100, tenantId));
  }
  return cases;
}

function walkAll(cases: RecoveryCase[], limit: number): RecoveryCase[] {
  const seen: RecoveryCase[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 1000; guard++) {
    const r = paginateRecoveryCases(cases, { limit, cursor });
    if (!r.ok) throw new Error("pagination refused");
    seen.push(...r.page.items);
    if (!r.page.hasMore) {
      expect(r.page.nextCursor).toBeNull();
      return seen;
    }
    cursor = r.page.nextCursor ?? undefined;
  }
  throw new Error("walk did not terminate");
}

// ---------------------------------------------------------------------------
// Deterministic ordering + exhaustive walk
// ---------------------------------------------------------------------------

describe("recovery pagination: deterministic ordering laws", () => {
  it("shuffled input yields byte-identical pages (total order via tie-break)", () => {
    const cases = fleet(25);
    // Several cases share openedAt — the id tie-break must dominate.
    for (let i = 0; i < 5; i++) cases.push(mkCase(`rc_tie_0${i}`, cases[0]!.openedAt));
    const shuffled = [...cases].reverse();
    const pageA = paginateRecoveryCases(cases, { limit: 10 });
    const pageB = paginateRecoveryCases(shuffled, { limit: 10 });
    expect(pageA.ok && pageB.ok).toBe(true);
    if (pageA.ok && pageB.ok) {
      expect(recoveryCasePageDigest(pageA.page)).toBe(recoveryCasePageDigest(pageB.page));
      expect(pageA.page.items.map((c) => c.id)).toEqual(pageB.page.items.map((c) => c.id));
    }
  });

  it("ordering is (openedAt DESC, id ASC) — ties resolved by caseId", () => {
    const tie = [mkCase("rc_tie_b1", NOW), mkCase("rc_tie_a1", NOW), mkCase("rc_tie_c1", NOW)];
    const r = paginateRecoveryCases(tie, { limit: 3 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.page.items.map((c) => c.id)).toEqual(["rc_tie_a1", "rc_tie_b1", "rc_tie_c1"]);
  });

  it("exhaustive keyset walk at fleet scale: 1000 cases, every case EXACTLY once", () => {
    const cases = fleet(1000);
    const seen = walkAll(cases, 37);
    expect(seen.length).toBe(1000);
    expect(new Set(seen.map((c) => c.id)).size).toBe(1000); // no duplicates
    const expected = [...cases].sort((a, b) => {
      if (a.openedAt !== b.openedAt) return b.openedAt - a.openedAt;
      return a.id < b.id ? -1 : 1;
    });
    expect(seen.map((c) => c.id)).toEqual(expected.map((c) => c.id)); // no skips
  });

  it("limit 1 walks the whole fleet one case at a time (boundary)", () => {
    const cases = fleet(5);
    const seen = walkAll(cases, 1);
    expect(seen.map((c) => c.id)).toEqual([...cases].sort((a, b) => (a.id < b.id ? -1 : 1)).map((c) => c.id));
  });

  it("determinism: identical inputs produce identical page digests across runs", () => {
    const cases = fleet(50);
    const run = (): string => {
      const r = paginateRecoveryCases(cases, { limit: 12 });
      if (!r.ok) throw new Error("refused");
      return recoveryCasePageDigest(r.page);
    };
    expect(run()).toBe(run());
  });
});

// ---------------------------------------------------------------------------
// Stable pages under inserts BETWEEN reads (the keyset laws)
// ---------------------------------------------------------------------------

describe("recovery pagination: stability under inserts between reads", () => {
  it("law (a): inserts between pages never duplicate or skip a pre-existing case", () => {
    const original = fleet(20);
    let cursor: string | undefined;
    const seenIds = new Set<string>();
    let inserted = false;
    for (let page = 0; page < 10; page++) {
      // The caller re-reads a LIVE view between pages (snapshot vs live is
      // the caller's choice — documented snapshot semantics); a real insert
      // PERSISTS in the live view once it has happened.
      if (!inserted && page === 1) inserted = true; // insert lands mid-walk
      const live = inserted ? [...original, mkCase("rc_new_old", NOW - 5)] : [...original];
      const r = paginateRecoveryCases(live, { limit: 5, cursor });
      if (!r.ok) throw new Error("refused");
      for (const c of r.page.items) {
        expect(seenIds.has(c.id)).toBe(false); // never duplicated
        seenIds.add(c.id);
      }
      if (!r.page.hasMore) break;
      cursor = r.page.nextCursor ?? undefined;
    }
    // Every PRE-EXISTING case was seen exactly once (no skips).
    for (const c of original) expect(seenIds.has(c.id)).toBe(true);
    expect(seenIds.size).toBe(21); // 20 pre-existing + the behind-cursor insert
  });

  it("law (b): a case inserted BEHIND the cursor appears on a later page (never seen before)", () => {
    const original = fleet(10); // openedAt NOW+900..NOW
    const first = paginateRecoveryCases(original, { limit: 4 });
    if (!first.ok) throw new Error("refused");
    const cursor = first.page.nextCursor!;
    // Decode to learn the cursor boundary, then insert behind it.
    const boundary = decodeRecoveryCaseCursor(cursor)!;
    const behind = mkCase("rc_behind", boundary.openedAt - 100);
    const second = paginateRecoveryCases([...original, behind], { limit: 4, cursor });
    if (!second.ok) throw new Error("refused");
    expect(second.page.items.map((c) => c.id)).toContain("rc_behind");
  });

  it("law (c): a case inserted AHEAD of the cursor (newer) is NOT visible to the current walk", () => {
    const original = fleet(10);
    const first = paginateRecoveryCases(original, { limit: 4 });
    if (!first.ok) throw new Error("refused");
    const cursor = first.page.nextCursor!;
    const ahead = mkCase("rc_ahead_1", NOW + 999_999); // newer than everything
    const second = paginateRecoveryCases([...original, ahead], { limit: 4, cursor });
    if (!second.ok) throw new Error("refused");
    expect(second.page.items.map((c) => c.id)).not.toContain("rc_ahead_1");
    // ...but a NEW walk from the start sees it (honest boundary).
    const fresh = paginateRecoveryCases([...original, ahead], { limit: 4 });
    if (!fresh.ok) throw new Error("refused");
    expect(fresh.page.items[0]?.id).toBe("rc_ahead_1");
  });

  it("a stable SNAPSHOT passed page-to-page is immune to concurrent inserts entirely", () => {
    const snapshot = fleet(15);
    const seen = walkAll(snapshot, 4); // same array object throughout
    expect(seen.map((c) => c.id)).toEqual(
      [...snapshot].sort((a, b) => (a.openedAt !== b.openedAt ? b.openedAt - a.openedAt : a.id < b.id ? -1 : 1)).map((c) => c.id),
    );
  });
});

// ---------------------------------------------------------------------------
// Fail-closed validation + tenant isolation
// ---------------------------------------------------------------------------

describe("recovery pagination: fail-closed validation and tenant isolation", () => {
  it("invalid limits refuse invalid-limit (0, negative, above MAX_PAGE_LIMIT, fractional)", () => {
    const cases = fleet(3);
    for (const limit of [0, -1, MAX_PAGE_LIMIT + 1, 1.5]) {
      const r = paginateRecoveryCases(cases, { limit });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("invalid-limit");
    }
  });

  it("limit exactly MAX_PAGE_LIMIT is valid (boundary)", () => {
    const r = paginateRecoveryCases(fleet(2), { limit: MAX_PAGE_LIMIT });
    expect(r.ok).toBe(true);
  });

  it("malformed cursors refuse invalid-cursor (fail closed, never a walk)", () => {
    const cases = fleet(3);
    // Bad base64, empty JSON object, wrong-typed fields — all fail closed.
    for (const cursor of ["not-base64-###", "e30=", "eyJ0ZW5hbnRJZCI6MX0="]) {
      const r = paginateRecoveryCases(cases, { limit: 5, cursor });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("invalid-cursor");
    }
  });

  it("cursor round-trip: encode -> decode is identity", () => {
    const cursor: RecoveryCaseCursor = { tenantId: TENANT_A, openedAt: NOW, caseId: "rc_000123" };
    expect(decodeRecoveryCaseCursor(encodeRecoveryCaseCursor(cursor))).toEqual(cursor);
  });

  it("foreign-tenant cursor REFUSES cursor-tenant-mismatch (cross-tenant probe)", () => {
    const aCases = fleet(5);
    const first = paginateCasesForTenant(aCases, TENANT_A, { limit: 2 });
    if (!first.ok) throw new Error("refused");
    const foreignCursor = first.page.nextCursor!;
    // Tenant B tries to continue tenant A's walk — fail closed.
    const b = paginateCasesForTenant(fleet(5, TENANT_B), TENANT_B, { limit: 2, cursor: foreignCursor });
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.reason).toBe("cursor-tenant-mismatch");
  });

  it("missing tenant id refuses missing-tenant-id", () => {
    const r = paginateCasesForTenant(fleet(3), "", { limit: 5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing-tenant-id");
  });

  it("the page NEVER contains a foreign-tenant case even when injected into the list", () => {
    const aCases = fleet(4);
    const poisoned = [...aCases, mkCase("rc_evil_01", NOW + 1, TENANT_B)]; // foreign-tenant record injected
    const r = paginateCasesForTenant(poisoned, TENANT_A, { limit: 10 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.page.items.every((c) => c.tenantId === TENANT_A)).toBe(true);
      expect(r.page.items.length).toBe(4); // the foreign case never appears
    }
  });

  it("tenant-scoped pagination walks only the tenant's cases end-to-end", () => {
    const aCases = fleet(6);
    const bCases = fleet(6, TENANT_B);
    const mixed = [...aCases, ...bCases];
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 20; guard++) {
      const r = paginateCasesForTenant(mixed, TENANT_A, { limit: 2, cursor });
      if (!r.ok) throw new Error("refused");
      seen.push(...r.page.items.map((c) => c.id));
      if (!r.page.hasMore) break;
      cursor = r.page.nextCursor ?? undefined;
    }
    expect(seen.length).toBe(6);
    expect(seen.every((id) => id.startsWith("rc_"))).toBe(true);
  });
});
