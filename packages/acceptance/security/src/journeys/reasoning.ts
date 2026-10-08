/**
 * Journey 6 — ask FleetOS to reason (persona: site-reliability-engineer).
 *
 * An SRE asks FleetOS to reason about a fleet situation. FleetOS assembles
 * a tenant-scoped world context through the REAL world-context package:
 *   - assembly is tenant fail-closed (a foreign entity REFUSES with the
 *     offender named);
 *   - field-level redaction is declarative per purpose — a security review
 *     redacts operator identity + location, and the REDACTED sentinel never
 *     leaks the original value;
 *   - the context digest is tamper-evident (verify recomputes);
 *   - the underlying world state is folded through the REAL world-model and
 *     staleness is classified HONESTLY (stale shows stale).
 */

import type { AcceptanceJourney } from "../journey-contracts.ts";
import { assembleContext, verifyAssembledContextDigest, REDACTED_VALUE } from "@fleetos/world-context";
import type { WorldEntitySnapshot } from "@fleetos/world-context";
import { classifyStaleness, foldWorldState } from "@fleetos/world-model";
import {
  FOREIGN_TENANT,
  NOW_MS,
  NOW_ISO,
  STALENESS_THRESHOLDS,
  TENANT,
  pumpJournal,
} from "./fixture-world.ts";

function entity(entityId: string, tenantId: string, lastObservedAtMs: number, operatorName = "Ada Chen"): WorldEntitySnapshot {
  return {
    entityId,
    entityType: "asset",
    tenantId,
    fields: {
      operatorName,
      operatorContact: `${operatorName.split(" ")[0]?.toLowerCase()}@acme.example`,
      location: "bay-7",
      temperature: 41,
    },
    lastObservationRef: `obs-${entityId}-latest`,
    lastObservedAtMs,
  };
}

export const reasoningJourney: AcceptanceJourney = {
  journeyId: "security.reasoning-context",
  persona: "site-reliability-engineer",
  capabilities: ["reasoning-context"],
  goal: "Ask FleetOS to reason over a tenant-safe, redacted world context",
  steps: [
    {
      stepId: "assemble-security-review",
      kind: "context-assembly",
      description: "Assemble the REAL context for a security review (redaction + digest)",
      packages: ["@fleetos/world-context"],
      operations: ["assembleContext", "verifyAssembledContextDigest"],
      run: (ctx) => {
        const result = assembleContext({
          focus: {
            tenant: TENANT,
            entities: [
              entity("pump-7", TENANT.tenantId, NOW_MS - 5_000),
              entity("pump-8", TENANT.tenantId, NOW_MS - 120_000, "Ravi Patel"),
            ],
            purpose: "security-review",
          },
          computedAt: NOW_ISO,
        });
        if (!result.ok) throw new Error(`assembly refused: ${result.rejected} (${result.detail})`);
        const context = result.context;
        ctx.record("assembly.entityCount", context.entityIds.length);
        ctx.record("assembly.entityIds", context.entityIds);
        ctx.record("assembly.redactedFields", context.redactedFields);
        ctx.record("assembly.pump7Location", context.features["pump-7#location"] ?? null);
        ctx.record("assembly.pump7OperatorName", context.features["pump-7#operatorName"] ?? null);
        ctx.record("assembly.pump7Temperature", context.features["pump-7#temperature"] ?? null);
        const serialized = JSON.stringify(context.features);
        ctx.record("assembly.leaksOperatorIdentity", serialized.includes("Ada Chen") || serialized.includes("Ravi Patel"));
        ctx.record("assembly.digestVerifies", verifyAssembledContextDigest(context));
        ctx.record("assembly.digestLength", context.digest.length);
        const planning = assembleContext({
          focus: {
            tenant: TENANT,
            entities: [entity("pump-7", TENANT.tenantId, NOW_MS - 5_000)],
            purpose: "maintenance-planning",
          },
          computedAt: NOW_ISO,
        });
        if (!planning.ok) throw new Error("planning assembly refused");
        ctx.record("assembly.planningRedactedFields", planning.context.redactedFields);
        ctx.record("assembly.planningLocationVisible", planning.context.features["pump-7#location"] ?? null);
      },
    },
    {
      stepId: "fail-closed-assembly",
      kind: "negative-check",
      description: "A foreign-tenant entity REFUSES assembly with the offender named",
      packages: ["@fleetos/world-context"],
      operations: ["assembleContext"],
      run: (ctx) => {
        const crossing = assembleContext({
          focus: {
            tenant: TENANT,
            entities: [entity("pump-7", TENANT.tenantId, NOW_MS - 5_000), entity("pump-99", FOREIGN_TENANT.tenantId, NOW_MS)],
            purpose: "security-review",
          },
          computedAt: NOW_ISO,
        });
        ctx.record("assembly.crossOk", crossing.ok);
        ctx.record("assembly.crossRejected", crossing.ok ? "unexpected-allow" : crossing.rejected);
        ctx.record("assembly.crossNamesOffender", crossing.ok ? "" : (crossing.detail.includes("pump-99") ? "pump-99" : "not-named"));
        const empty = assembleContext({
          focus: { tenant: { tenantId: "" }, entities: [entity("pump-7", "", NOW_MS)], purpose: "security-review" },
          computedAt: NOW_ISO,
        });
        ctx.record("assembly.emptyOk", empty.ok);
        ctx.record("assembly.emptyRejected", empty.ok ? "unexpected-allow" : empty.rejected);
      },
    },
    {
      stepId: "world-state-fold",
      kind: "context-assembly",
      description: "Fold the REAL world journal and classify staleness honestly",
      packages: ["@fleetos/world-model"],
      operations: ["foldWorldState", "classifyStaleness"],
      run: (ctx) => {
        const journal = pumpJournal();
        const folded = foldWorldState(journal);
        if (!folded.ok) throw new Error(`fold refused: ${folded.rejected}`);
        const pump = folded.state.entities.find((e) => e.entityId === "pump-7");
        if (pump === undefined) throw new Error("pump-7 missing from folded state");
        ctx.record("fold.entityCount", folded.state.entities.length);
        ctx.record("fold.observationCount", pump.observations.length);
        ctx.record("fold.journalLength", folded.state.journalLength);
        const fresh = classifyStaleness(NOW_MS - 5_000, NOW_MS, STALENESS_THRESHOLDS);
        if (!fresh.ok) throw new Error("staleness classification refused");
        ctx.record("staleness.fresh.class", fresh.staleness);
        ctx.record("staleness.fresh.ageMs", fresh.ageMs);
        const stale = classifyStaleness(NOW_MS - 30_000, NOW_MS, STALENESS_THRESHOLDS);
        if (!stale.ok) throw new Error("staleness classification refused");
        ctx.record("staleness.stale.class", stale.staleness);
        ctx.record("staleness.stale.ageMs", stale.ageMs);
        const beyond = classifyStaleness(NOW_MS - 120_000, NOW_MS, STALENESS_THRESHOLDS);
        if (!beyond.ok) throw new Error("staleness classification refused");
        ctx.record("staleness.beyond.class", beyond.staleness);
        ctx.record("staleness.beyond.ageMs", beyond.ageMs);
        const never = classifyStaleness(null, NOW_MS, STALENESS_THRESHOLDS);
        if (!never.ok) throw new Error("staleness classification refused");
        ctx.record("staleness.neverObserved.class", never.staleness);
        ctx.record("staleness.neverObserved.ageMs", never.ageMs);
      },
    },
  ],
  assertions: [
    { assertionId: "rs-1", description: "Context covers both entities", path: "assembly.entityCount", expected: 2 },
    { assertionId: "rs-2", description: "Entities assembled in deterministic order", path: "assembly.entityIds", expected: ["pump-7", "pump-8"] },
    { assertionId: "rs-3", description: "Security review redacts operator + location fields (both entities)", path: "assembly.redactedFields", expected: ["pump-7#location", "pump-7#operatorContact", "pump-7#operatorName", "pump-8#location", "pump-8#operatorContact", "pump-8#operatorName"] },
    { assertionId: "rs-4", description: "Location replaced by the sentinel", path: "assembly.pump7Location", expected: REDACTED_VALUE },
    { assertionId: "rs-5", description: "Operator name replaced by the sentinel", path: "assembly.pump7OperatorName", expected: REDACTED_VALUE },
    { assertionId: "rs-6", description: "Non-redacted fields stay readable", path: "assembly.pump7Temperature", expected: 41 },
    { assertionId: "rs-7", description: "Redacted values never leak through serialization", path: "assembly.leaksOperatorIdentity", expected: false },
    { assertionId: "rs-8", description: "Context digest verifies", path: "assembly.digestVerifies", expected: true },
    { assertionId: "rs-9", description: "Digest is FNV-1a 8-hex", path: "assembly.digestLength", expected: 8 },
    { assertionId: "rs-10", description: "Maintenance planning redacts fewer fields", path: "assembly.planningRedactedFields", expected: ["pump-7#operatorContact", "pump-7#operatorName"] },
    { assertionId: "rs-11", description: "Location visible for maintenance planning", path: "assembly.planningLocationVisible", expected: "bay-7" },
    { assertionId: "rs-12", description: "Cross-tenant entity refuses assembly (A8)", path: "assembly.crossOk", expected: false },
    { assertionId: "rs-13", description: "Rejection code names cross-tenant-ref", path: "assembly.crossRejected", expected: "cross-tenant-ref" },
    { assertionId: "rs-14", description: "The offender entity is named in the detail", path: "assembly.crossNamesOffender", expected: "pump-99" },
    { assertionId: "rs-15", description: "Empty tenant refuses assembly (A8)", path: "assembly.emptyOk", expected: false },
    { assertionId: "rs-16", description: "Empty-tenant rejection code", path: "assembly.emptyRejected", expected: "missing-tenant" },
    { assertionId: "rs-17", description: "World fold covers the entity", path: "fold.entityCount", expected: 1 },
    { assertionId: "rs-18", description: "Fold preserves the observation history", path: "fold.observationCount", expected: 3 },
    { assertionId: "rs-19", description: "Journal length surfaced", path: "fold.journalLength", expected: 4 },
    { assertionId: "rs-20", description: "Data observed 5s ago classified fresh", path: "staleness.fresh.class", expected: "fresh" },
    { assertionId: "rs-21", description: "Fresh age surfaced exactly", path: "staleness.fresh.ageMs", expected: 5000 },
    { assertionId: "rs-22", description: "Data observed 30s ago is honestly stale (not fresh)", path: "staleness.stale.class", expected: "stale" },
    { assertionId: "rs-22b", description: "Stale age surfaced exactly", path: "staleness.stale.ageMs", expected: 30000 },
    { assertionId: "rs-22c", description: "Data beyond the staleness window is unknown (not trustworthy)", path: "staleness.beyond.class", expected: "unknown" },
    { assertionId: "rs-22d", description: "Beyond-window age still surfaced for audit", path: "staleness.beyond.ageMs", expected: 120000 },
    { assertionId: "rs-23", description: "Never-observed entity classified unknown", path: "staleness.neverObserved.class", expected: "unknown" },
    { assertionId: "rs-24", description: "Unknown staleness carries no age (never invented)", path: "staleness.neverObserved.ageMs", expected: null },
  ],
};
