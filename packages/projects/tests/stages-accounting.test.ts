/**
 * @fleetos/projects — Wave 2 (F220C) operational-truth grade tests:
 * stage gates, budget envelope + actuals ledger, archival rules,
 * tenant fail-closed reads.
 */
import { describe, expect, it } from "vitest";
import {
  transitionStage,
  completeStageCheckpoint,
  archiveProject,
  readProjectForTenant,
  emptyLedger,
  postLedgerEntry,
  verifyLedgerChain,
  computeBudgetPosition,
  computeEntryDigest,
  BUDGET_WARNING_THRESHOLD_BPS,
  type ProjectStage,
  type Project,
  type ProjectArchivalRecord,
  type BudgetEnvelope,
  type ActualsLedger,
  type LedgerEntry,
  type StageStatus,
  type StageTransitionCommand,
  type TenantScope,
} from "../src/index.js";

const TENANT: TenantScope = { tenantId: "acme" };
const OTHER_TENANT: TenantScope = { tenantId: "globex" };

function stage(overrides: Partial<ProjectStage> = {}): ProjectStage {
  return {
    id: "stage-1",
    tenant: TENANT,
    projectId: "proj-1",
    name: "Design",
    status: "planned",
    checkpoints: [
      { id: "cp-1", mandatory: true, completedAt: null },
      { id: "cp-2", mandatory: false, completedAt: null },
    ],
    updatedAt: 1000,
    ...overrides,
  };
}

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: { kind: "project", value: "proj-1" },
    tenant: TENANT,
    name: "Fleet Rollout",
    status: "draft",
    milestoneIds: [],
    ...overrides,
  };
}

function envelope(overrides: Partial<BudgetEnvelope> = {}): BudgetEnvelope {
  return {
    projectId: "proj-1",
    tenant: TENANT,
    limitMinorUnits: 100_000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Stage state machine + stage gates.
// ---------------------------------------------------------------------------

describe("transitionStage — legal transitions", () => {
  it("planned → in_progress → closed when all mandatory checkpoints complete", () => {
    const started = transitionStage(stage(), { type: "start" }, 1000);
    expect(started.ok).toBe(true);
    if (started.ok) {
      expect(started.next.status).toBe("in_progress");
      const withCp1 = completeStageCheckpoint(started.next, "cp-1", 2000);
      expect(withCp1.ok).toBe(true);
      if (withCp1.ok) {
        const closed = transitionStage(withCp1.next, { type: "close" }, 3000);
        expect(closed.ok).toBe(true);
        if (closed.ok) expect(closed.next.status).toBe("closed");
      }
    }
  });

  it("closing works when only OPTIONAL checkpoints remain open", () => {
    const inProgress = stage({ status: "in_progress", checkpoints: [{ id: "cp-opt", mandatory: false, completedAt: null }] });
    const result = transitionStage(inProgress, { type: "close" }, 1000);
    expect(result.ok).toBe(true);
  });

  it("transitioning never mutates the input stage", () => {
    const input = stage();
    transitionStage(input, { type: "start" }, 1000);
    expect(input.status).toBe("planned");
  });
});

describe("transitionStage — refusals", () => {
  it("refuses close with OPEN_MANDATORY_CHECKPOINTS and lists the exact open ids", () => {
    const inProgress = stage({
      status: "in_progress",
      checkpoints: [
        { id: "cp-a", mandatory: true, completedAt: null },
        { id: "cp-b", mandatory: true, completedAt: 500 },
        { id: "cp-c", mandatory: true, completedAt: null },
        { id: "cp-d", mandatory: false, completedAt: null },
      ],
    });
    const result = transitionStage(inProgress, { type: "close" }, 1000);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("OPEN_MANDATORY_CHECKPOINTS");
      expect(result.openCheckpointIds).toEqual(["cp-a", "cp-c"]);
    }
  });

  const illegalStageCases: readonly (readonly [string, StageTransitionCommand, StageStatus])[] = [
    ["start from in_progress", { type: "start" }, "in_progress"],
    ["start from closed", { type: "start" }, "closed"],
    ["close from planned", { type: "close" }, "planned"],
    ["close from closed (terminal)", { type: "close" }, "closed"],
  ];
  it.each(illegalStageCases)("refuses %s with ILLEGAL_TRANSITION", (_label, command, status) => {
    const result = transitionStage(stage({ status }), command, 1000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasonCode).toBe("ILLEGAL_TRANSITION");
  });
});

describe("completeStageCheckpoint — refusals", () => {
  it("refuses an unknown checkpoint with UNKNOWN_CHECKPOINT", () => {
    const result = completeStageCheckpoint(stage(), "cp-nope", 1000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasonCode).toBe("UNKNOWN_CHECKPOINT");
  });

  it("refuses double completion with CHECKPOINT_ALREADY_COMPLETE", () => {
    const once = stage({ checkpoints: [{ id: "cp-1", mandatory: true, completedAt: 500 }] });
    const result = completeStageCheckpoint(once, "cp-1", 900);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasonCode).toBe("CHECKPOINT_ALREADY_COMPLETE");
  });

  it("refuses completion on a closed stage with STAGE_CLOSED", () => {
    const closed = stage({ status: "closed" });
    const result = completeStageCheckpoint(closed, "cp-1", 1000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasonCode).toBe("STAGE_CLOSED");
  });
});

// ---------------------------------------------------------------------------
// Archival rules + tenant fail-closed reads.
// ---------------------------------------------------------------------------

describe("archiveProject", () => {
  it("archives a terminal project", () => {
    const result = archiveProject(project({ status: "completed" }), [], 10_000);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.record.statusAtArchival).toBe("completed");
      expect(result.record.archivedAt).toBe(10_000);
    }
  });

  it("refuses a non-terminal project with PROJECT_NOT_TERMINAL", () => {
    const result = archiveProject(project({ status: "active" }), [], 10_000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasonCode).toBe("PROJECT_NOT_TERMINAL");
  });

  it("refuses double archival with ALREADY_ARCHIVED", () => {
    const existing: ProjectArchivalRecord[] = [
      { projectId: "proj-1", tenant: TENANT, statusAtArchival: "cancelled", archivedAt: 5000 },
    ];
    const result = archiveProject(project({ status: "cancelled" }), existing, 9000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasonCode).toBe("ALREADY_ARCHIVED");
  });

  it("same project id in ANOTHER tenant is not a duplicate (tenant scoping)", () => {
    const existing: ProjectArchivalRecord[] = [
      { projectId: "proj-1", tenant: OTHER_TENANT, statusAtArchival: "completed", archivedAt: 5000 },
    ];
    const result = archiveProject(project({ status: "completed" }), existing, 9000);
    expect(result.ok).toBe(true);
  });
});

describe("readProjectForTenant — tenant fail-closed", () => {
  const projects = [project(), project({ id: { kind: "project", value: "proj-2" }, tenant: OTHER_TENANT })];

  it("returns the project for the owning tenant", () => {
    expect(readProjectForTenant(projects, TENANT, "proj-1")?.id.value).toBe("proj-1");
  });
  it("returns null for another tenant's project (no existence leak)", () => {
    expect(readProjectForTenant(projects, TENANT, "proj-2")).toBeNull();
    expect(readProjectForTenant(projects, OTHER_TENANT, "proj-1")).toBeNull();
  });
  it("returns null for an unknown project", () => {
    expect(readProjectForTenant(projects, TENANT, "proj-404")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Actuals ledger + budget envelope.
// ---------------------------------------------------------------------------

describe("actuals ledger — posting and chain integrity", () => {
  it("emptyLedger creates an empty tenant-scoped ledger", () => {
    const result = emptyLedger(envelope());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.ledger.entries.length).toBe(0);
  });

  it("refuses a negative or non-integer envelope limit with NEGATIVE_LIMIT", () => {
    expect(emptyLedger(envelope({ limitMinorUnits: -1 })).ok).toBe(false);
    expect(emptyLedger(envelope({ limitMinorUnits: 10.5 })).ok).toBe(false);
  });

  it("posts entries with ledger-assigned sequence numbers and chained digests", () => {
    const start = emptyLedger(envelope());
    expect(start.ok).toBe(true);
    if (start.ok) {
      const e1 = postLedgerEntry(start.ledger, envelope(), { kind: "actual", amountMinorUnits: 10_000, recordedAt: 100 });
      expect(e1.ok).toBe(true);
      if (e1.ok) {
        expect(e1.ledger.entries[0]?.seq).toBe(1);
        const e2 = postLedgerEntry(e1.ledger, envelope(), { kind: "commitment", amountMinorUnits: 5_000, recordedAt: 200, note: "phase 2" });
        expect(e2.ok).toBe(true);
        if (e2.ok) {
          expect(e2.ledger.entries[1]?.seq).toBe(2);
          expect(e2.ledger.entries[1]?.digest).not.toBe(e2.ledger.entries[0]?.digest);
          expect(verifyLedgerChain(e2.ledger).ok).toBe(true);
        }
      }
    }
  });

  it("posting never mutates the input ledger (append-only)", () => {
    const start = emptyLedger(envelope());
    expect(start.ok).toBe(true);
    if (start.ok) {
      const before = start.ledger.entries.length;
      postLedgerEntry(start.ledger, envelope(), { kind: "actual", amountMinorUnits: 1, recordedAt: 1 });
      expect(start.ledger.entries.length).toBe(before);
    }
  });

  it("refuses zero amounts with ZERO_AMOUNT", () => {
    const start = emptyLedger(envelope());
    expect(start.ok).toBe(true);
    if (start.ok) {
      const result = postLedgerEntry(start.ledger, envelope(), { kind: "actual", amountMinorUnits: 0, recordedAt: 1 });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reasonCode).toBe("ZERO_AMOUNT");
    }
  });

  it("refuses non-integer amounts with NON_INTEGER_AMOUNT (no float money)", () => {
    const start = emptyLedger(envelope());
    expect(start.ok).toBe(true);
    if (start.ok) {
      const result = postLedgerEntry(start.ledger, envelope(), { kind: "actual", amountMinorUnits: 10.5, recordedAt: 1 });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reasonCode).toBe("NON_INTEGER_AMOUNT");
    }
  });

  it("refuses a tenant/project mismatch between ledger and envelope", () => {
    const start = emptyLedger(envelope());
    expect(start.ok).toBe(true);
    if (start.ok) {
      const otherTenant = postLedgerEntry(start.ledger, envelope({ tenant: OTHER_TENANT }), { kind: "actual", amountMinorUnits: 1, recordedAt: 1 });
      expect(otherTenant.ok).toBe(false);
      if (!otherTenant.ok) expect(otherTenant.reasonCode).toBe("TENANT_MISMATCH");
      const otherProject = postLedgerEntry(start.ledger, envelope({ projectId: "proj-2" }), { kind: "actual", amountMinorUnits: 1, recordedAt: 1 });
      expect(otherProject.ok).toBe(false);
      if (!otherProject.ok) expect(otherProject.reasonCode).toBe("PROJECT_MISMATCH");
    }
  });

  it("verifyLedgerChain detects a TAMPERED entry (CHAIN_BROKEN with earliest seq)", () => {
    const start = emptyLedger(envelope());
    expect(start.ok).toBe(true);
    if (start.ok) {
      const e1 = postLedgerEntry(start.ledger, envelope(), { kind: "actual", amountMinorUnits: 10_000, recordedAt: 100 });
      expect(e1.ok).toBe(true);
      if (e1.ok) {
        const e2 = postLedgerEntry(e1.ledger, envelope(), { kind: "credit", amountMinorUnits: -2_000, recordedAt: 200 });
        expect(e2.ok).toBe(true);
        if (e2.ok) {
          const tampered: ActualsLedger = {
            ...e2.ledger,
            entries: [
              e2.ledger.entries[0] as LedgerEntry,
              { ...(e2.ledger.entries[1] as LedgerEntry), amountMinorUnits: -9_999 },
            ],
          };
          const v = verifyLedgerChain(tampered);
          expect(v.ok).toBe(false);
          if (!v.ok) {
            expect(v.reasonCode).toBe("CHAIN_BROKEN");
            expect(v.firstBrokenSeq).toBe(2);
          }
        }
      }
    }
  });

  it("identical histories produce byte-identical digest chains (determinism)", () => {
    const build = (): ActualsLedger => {
      let l = emptyLedger(envelope());
      if (!l.ok) throw new Error("unreachable");
      for (const [kind, amount, at, note] of [
        ["actual", 10_000, 100, null],
        ["commitment", 5_000, 200, "phase 2"],
        ["credit", -2_000, 300, "refund"],
      ] as const) {
        const r = postLedgerEntry(l.ledger, envelope(), { kind, amountMinorUnits: amount, recordedAt: at, note });
        if (!r.ok) throw new Error("unreachable");
        l = r;
      }
      return l.ledger;
    };
    const a = build();
    const b = build();
    expect(a.entries.map((e) => e.digest)).toEqual(b.entries.map((e) => e.digest));
    const first = a.entries[0] as LedgerEntry;
    expect(computeEntryDigest("ledger_genesis", first)).toBe(first.digest);
  });
});

describe("computeBudgetPosition — breach detection with severity", () => {
  function ledgerWith(entries: readonly { kind: "actual" | "commitment" | "credit"; amount: number }[]): ActualsLedger {
    let l = emptyLedger(envelope());
    if (!l.ok) throw new Error("unreachable");
    for (const e of entries) {
      const r = postLedgerEntry(l.ledger, envelope(), { kind: e.kind, amountMinorUnits: e.amount, recordedAt: 1 });
      if (!r.ok) throw new Error("unreachable");
      l = r;
    }
    return l.ledger;
  }

  it("under the warning threshold → severity none with exact integers", () => {
    const ledger = ledgerWith([{ kind: "actual", amount: 50_000 }]);
    const result = computeBudgetPosition(ledger, envelope());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.position.spentMinorUnits).toBe(50_000);
      expect(result.position.utilizationBps).toBe(5000);
      expect(result.position.severity).toBe("none");
      expect(Number.isInteger(result.position.utilizationBps)).toBe(true);
    }
  });

  it("credits reduce spend (deterministic accounting)", () => {
    const ledger = ledgerWith([
      { kind: "actual", amount: 80_000 },
      { kind: "credit", amount: -30_000 },
    ]);
    const result = computeBudgetPosition(ledger, envelope());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.position.spentMinorUnits).toBe(50_000);
  });

  it("at exactly the warning threshold → severity warning (bps comparison, integer)", () => {
    const ledger = ledgerWith([{ kind: "actual", amount: 90_000 }]);
    const result = computeBudgetPosition(ledger, envelope());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.position.utilizationBps).toBe(BUDGET_WARNING_THRESHOLD_BPS);
      expect(result.position.severity).toBe("warning");
    }
  });

  it("just below the warning threshold → severity none (floor, not round)", () => {
    const ledger = ledgerWith([{ kind: "actual", amount: 89_999 }]);
    const result = computeBudgetPosition(ledger, envelope());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.position.utilizationBps).toBe(8999);
      expect(result.position.severity).toBe("none");
    }
  });

  it("over the limit → severity breach with the exact breach amount", () => {
    const ledger = ledgerWith([{ kind: "actual", amount: 120_000 }]);
    const result = computeBudgetPosition(ledger, envelope());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.position.severity).toBe("breach");
      expect(result.position.breachAmountMinorUnits).toBe(20_000);
      expect(result.position.remainingMinorUnits).toBe(-20_000);
    }
  });

  it("refuses a tenant/project mismatch (fail-closed accounting)", () => {
    const ledger = ledgerWith([{ kind: "actual", amount: 1 }]);
    const mismatch = computeBudgetPosition(ledger, envelope({ tenant: OTHER_TENANT }));
    expect(mismatch.ok).toBe(false);
    const mismatchProject = computeBudgetPosition(ledger, envelope({ projectId: "proj-2" }));
    expect(mismatchProject.ok).toBe(false);
  });
});
