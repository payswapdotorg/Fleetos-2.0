/**
 * Arena certification tests — minting from accepted evaluations, chained
 * digests, revocation + propagation, tenant fail-closed (Wave 5, F250B).
 */
import { describe, it, expect } from "vitest";
import {
  intakeCases,
  assembleCaseSet,
  stageRun,
  startRun,
  scoreRun,
  reportRun,
  scoreRunProposal,
  mintCertification,
  revokeCertification,
  propagateRevocation,
  verifyCertificationChain,
  certificationGenesisDigest,
  assertNoSubmitOrAdopt,
  type EvaluationRun,
  type ScoredProposal,
  type CertificationDependent,
  type CertificationRef,
} from "../src/index.ts";

const tenant = { tenantId: "t1" };
const cap = { capabilityId: "cap.test", version: "1.0.0" };

const ALL_PASS_7 = [true, true, true, true, true, true, true] as const;
const ALL_PASS_8 = [true, true, true, true, true, true, true, true] as const;

function candidate(i: number, capOverride = cap) {
  return {
    caseId: `c${i}`,
    tenant,
    capability: capOverride,
    inputs: { x: i },
    expected: i,
    description: `case ${i}`,
    tags: [],
    source: "suite",
    submittedAtMs: 1000 + i,
  };
}

function acceptedRun(passed: readonly boolean[], adapterId = "reference.arena"): { run: EvaluationRun; scored: ScoredProposal } {
  const intake = intakeCases(passed.map((_, i) => candidate(i)), tenant);
  if (!intake.ok) throw new Error("fixture intake failed");
  const set = assembleCaseSet([...intake.cases], { tenant, capability: cap, assembledAtMs: 5000 });
  if (!set.ok) throw new Error("fixture set failed");
  const staged = stageRun({ tenant, caseSet: set.caseSet, adapterId, stagedAtMs: 6000 });
  if (!staged.ok) throw new Error("fixture stage failed");
  const started = startRun(staged.run, 7000);
  if (!started.ok) throw new Error("fixture start failed");
  const scored = scoreRun(
    started.run,
    passed.map((p, i) => ({ caseId: `c${i}`, actual: i, passed: p })),
    8000,
  );
  if (!scored.ok) throw new Error("fixture score failed");
  const reported = reportRun(scored.run, 8500);
  if (!reported.ok) throw new Error("fixture report failed");
  const ladder = scoreRunProposal(reported.run, 9000);
  if (!ladder.ok) throw new Error("fixture ladder failed");
  return { run: reported.run, scored: ladder.scored };
}

const MINT_INPUT = {
  issuedBy: "arena.operator",
  issuedAtMs: 10_000,
  validUntilMs: 20_000,
  evidenceRef: "evidence://run/1",
};

describe("mintCertification", () => {
  it("mints an immutable certification reference from a reported + high run", () => {
    const { run, scored } = acceptedRun(ALL_PASS_8);
    const r = mintCertification({ tenant, run, scored, ...MINT_INPUT });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const c = r.certification;
      expect(c.kind).toBe("ARENA_CERTIFICATION");
      expect(c.tenantId).toBe("t1");
      expect(c.prevDigest).toBe(certificationGenesisDigest("t1"));
      expect(c.digest).toMatch(/^[0-9a-f]{8}$/);
      expect(c.certificationId).toContain(c.digest);
      expect(c.runId).toBe(run.manifest.runId);
      expect(c.proposalId).toBe(scored.proposalId);
    }
  });

  it("mints deterministically — identical inputs, identical certification", () => {
    const { run, scored } = acceptedRun(ALL_PASS_7);
    const a = mintCertification({ tenant, run, scored, ...MINT_INPUT });
    const b = mintCertification({ tenant, run, scored, ...MINT_INPUT });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("chains the second certification on the first", () => {
    const first = acceptedRun(ALL_PASS_7);
    const a = mintCertification({ tenant, run: first.run, scored: first.scored, ...MINT_INPUT });
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const second = acceptedRun(ALL_PASS_8);
    const b = mintCertification({ tenant, run: second.run, scored: second.scored, ...MINT_INPUT, previous: a.certification });
    expect(b.ok).toBe(true);
    if (b.ok) {
      expect(b.certification.prevDigest).toBe(a.certification.digest);
      expect(b.certification.digest).not.toBe(a.certification.digest);
    }
  });

  it("rejects an unreported run as run_not_scored", () => {
    const intake = intakeCases([candidate(0)], tenant);
    if (!intake.ok) throw new Error("fixture intake failed");
    const set = assembleCaseSet([...intake.cases], { tenant, capability: cap, assembledAtMs: 1 });
    if (!set.ok) throw new Error("fixture set failed");
    const staged = stageRun({ tenant, caseSet: set.caseSet, adapterId: "a", stagedAtMs: 2 });
    if (!staged.ok) throw new Error("fixture stage failed");
    // hand-built scored proposal for a staged (unreported) run
    const fakeScored: ScoredProposal = {
      kind: "ARENA_SCORED_PROPOSAL",
      advisory: true,
      proposalId: "p",
      runId: staged.run.manifest.runId,
      tenantId: "t1",
      capability: cap,
      caseCount: 1,
      passRateBps: 10000,
      confidenceBps: 4600,
      confidence: "high",
      rationale: "fixture",
      scoredAtMs: 3,
      scoreDigest: "00000000",
    };
    const r = mintCertification({ tenant, run: staged.run, scored: fakeScored, ...MINT_INPUT });
    expect(r).toMatchObject({ ok: false, degraded: "run_not_scored" });
  });

  it("rejects a non-high tier as insufficient_evidence", () => {
    // 8 cases, 6 passed => medium tier (7500 bps).
    const { run, scored } = acceptedRun([...ALL_PASS_8.slice(0, 6), false, false]);
    expect(scored.confidence).toBe("medium");
    const r = mintCertification({ tenant, run, scored, ...MINT_INPUT });
    expect(r).toMatchObject({ ok: false, degraded: "insufficient_evidence" });
  });

  it("rejects tenant mismatches fail-closed", () => {
    const { run, scored } = acceptedRun(ALL_PASS_7);
    const r = mintCertification({ tenant: { tenantId: "t2" }, run, scored, ...MINT_INPUT });
    expect(r).toMatchObject({ ok: false, degraded: "tenant_mismatch" });
    expect(mintCertification({ tenant: { tenantId: "" }, run, scored, ...MINT_INPUT })).toMatchObject({
      ok: false,
      degraded: "tenant_mismatch",
    });
  });

  it("rejects a scored proposal from a different run and invalid windows/fields", () => {
    const a = acceptedRun([true, true, true, true, true]);
    const b = acceptedRun([true, true, true, true, true, true]);
    expect(mintCertification({ tenant, run: a.run, scored: b.scored, ...MINT_INPUT })).toMatchObject({
      ok: false,
      degraded: "run_not_scored",
    });
    expect(mintCertification({ tenant, run: a.run, scored: a.scored, ...MINT_INPUT, validUntilMs: MINT_INPUT.issuedAtMs })).toMatchObject({
      ok: false,
      degraded: "insufficient_evidence",
    });
    expect(mintCertification({ tenant, run: a.run, scored: a.scored, ...MINT_INPUT, issuedBy: "" })).toMatchObject({
      ok: false,
      degraded: "insufficient_evidence",
    });
    expect(mintCertification({ tenant, run: a.run, scored: a.scored, ...MINT_INPUT, issuedAtMs: 1.5 })).toMatchObject({
      ok: false,
      degraded: "insufficient_evidence",
    });
  });
});

describe("verifyCertificationChain (tamper-evident)", () => {
  function chainOf(n: number): CertificationRef[] {
    const out: CertificationRef[] = [];
    let prev: CertificationRef | undefined;
    for (let i = 0; i < n; i += 1) {
      const { run, scored } = acceptedRun(ALL_PASS_7, `adapter-${i}`);
      const minted = mintCertification({
        tenant,
        run,
        scored,
        ...MINT_INPUT,
        previous: prev,
      });
      if (!minted.ok) throw new Error("fixture mint failed");
      out.push(minted.certification);
      prev = minted.certification;
    }
    return out;
  }

  it("verifies an honest chain and detects tampering", () => {
    const links = chainOf(3);
    expect(verifyCertificationChain(links, tenant).ok).toBe(true);

    // tamper with a field
    const tampered = [{ ...links[0]!, issuedBy: "attacker" }, links[1]!, links[2]!];
    expect(verifyCertificationChain(tampered, tenant).ok).toBe(false);
    // break the chain link
    const broken = [links[0]!, { ...links[1]!, prevDigest: "deadbeef" }, links[2]!];
    expect(verifyCertificationChain(broken, tenant).ok).toBe(false);
    // drop a link (skip)
    const skipped = [links[0]!, links[2]!];
    expect(verifyCertificationChain(skipped, tenant).ok).toBe(false);
    // cross-tenant chain
    expect(verifyCertificationChain(links, { tenantId: "t2" }).ok).toBe(false);
    expect(verifyCertificationChain(links, { tenantId: "" }).ok).toBe(false);
  });
});

describe("revokeCertification + propagation", () => {
  it("revokes with a reason code and a deterministic digest", () => {
    const { run, scored } = acceptedRun(ALL_PASS_7);
    const m = mintCertification({ tenant, run, scored, ...MINT_INPUT });
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    const r = revokeCertification(m.certification, { reason: "evaluation-fraud", revokedBy: "guardian", revokedAtMs: 15_000 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.revocation.kind).toBe("ARENA_CERTIFICATION_REVOCATION");
      expect(r.revocation.reason).toBe("evaluation-fraud");
      expect(r.revocation.certificationId).toBe(m.certification.certificationId);
      const again = revokeCertification(m.certification, { reason: "evaluation-fraud", revokedBy: "guardian", revokedAtMs: 15_000 });
      expect(JSON.stringify(r)).toBe(JSON.stringify(again));
    }
  });

  it("rejects a revocation that precedes issuance or carries bad input", () => {
    const { run, scored } = acceptedRun(ALL_PASS_7);
    const m = mintCertification({ tenant, run, scored, ...MINT_INPUT });
    if (!m.ok) throw new Error("fixture mint failed");
    expect(revokeCertification(m.certification, { reason: "expired", revokedBy: "g", revokedAtMs: 9_999 })).toMatchObject({
      ok: false,
    });
    expect(revokeCertification(m.certification, { reason: "expired", revokedBy: "", revokedAtMs: 15_000 })).toMatchObject({
      ok: false,
    });
    expect(revokeCertification(m.certification, { reason: "expired", revokedBy: "g", revokedAtMs: -1 })).toMatchObject({
      ok: false,
    });
  });

  it("propagates to dependent proposals (blocked, never auto-executed)", () => {
    const { run, scored } = acceptedRun(ALL_PASS_7);
    const m = mintCertification({ tenant, run, scored, ...MINT_INPUT });
    if (!m.ok) throw new Error("fixture mint failed");
    const rev = revokeCertification(m.certification, { reason: "guardian-directive", revokedBy: "guardian", revokedAtMs: 15_000 });
    expect(rev.ok).toBe(true);
    if (!rev.ok) return;
    const deps: CertificationDependent[] = [
      { proposalId: "dep-1", tenantId: "t1", certificationId: m.certification.certificationId },
      { proposalId: "dep-2", tenantId: "t1", certificationId: "cert-other" },
      { proposalId: "dep-3", tenantId: "t1", certificationId: m.certification.certificationId },
    ];
    const p = propagateRevocation(rev.revocation, deps);
    expect(p.ok).toBe(true);
    if (p.ok) {
      expect(p.blocked).toHaveLength(2);
      expect(p.blocked.map((b) => b.proposalId).sort()).toEqual(["dep-1", "dep-3"]);
      expect(p.blocked[0]!.status).toBe("blocked");
      expect(p.blocked[0]!.reason).toBe("certification-revoked");
      expect(p.blocked[0]!.revocationDigest).toBe(rev.revocation.revocationDigest);
    }
  });

  it("propagation is tenant fail-closed (offender named)", () => {
    const { run, scored } = acceptedRun(ALL_PASS_7);
    const m = mintCertification({ tenant, run, scored, ...MINT_INPUT });
    if (!m.ok) throw new Error("fixture mint failed");
    const rev = revokeCertification(m.certification, { reason: "expired", revokedBy: "g", revokedAtMs: 15_000 });
    if (!rev.ok) throw new Error("fixture revoke failed");
    const foreignDep: CertificationDependent = { proposalId: "dep-x", tenantId: "t2", certificationId: m.certification.certificationId };
    const r = propagateRevocation(rev.revocation, [foreignDep]);
    expect(r).toMatchObject({ ok: false, degraded: "certification_revoked" });
    if (!r.ok) expect(r.reason).toContain("dep-x");
  });

  it("a certification is a REFERENCE, never an authorization (module surface)", async () => {
    const mod = await import("../src/certification.ts");
    const probe = assertNoSubmitOrAdopt(mod as unknown as Record<string, unknown>);
    expect(probe.ok).toBe(true);
    expect(probe.forbidden).toEqual([]);
  });
});
