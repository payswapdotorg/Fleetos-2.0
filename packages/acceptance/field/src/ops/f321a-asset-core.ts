/**
 * @fleetos/acceptance-field — F321A asset/identity/tenancy operation
 * executors (Wave 12 lane A). Every executor drives a REAL public API of
 * @fleetos/assets (lineage + material lots), @fleetos/identity (session +
 * membership kernels) or @fleetos/tenancy (tenant lifecycle kernel) and
 * records readings from the REAL output (states, boundaries, refusals).
 */

import {
  declareLineage,
  createMaterialLot,
  consumeMaterialLot,
  materialLotLifecycleState,
  appendLineageEdge,
  ancestry,
  verifyLineageChain,
} from "@fleetos/assets";
import type { LineageRelationKind, LineageEdgePayload } from "@fleetos/assets";
import {
  issueSession,
  validateSession,
  evaluateSessionTransition,
  bindRole,
  sweepSessions,
  makeTenantContext,
} from "@fleetos/identity";
import { establishTenant, evaluateTenantOperation } from "@fleetos/tenancy";
import type { JourneyOperation } from "../journey-contracts.js";
import type { JourneyContext } from "../context.js";
import { OPERATOR } from "../fixtures.js";
import { opOk, opRefused, type OpExecution } from "./common.js";

export function executeF321AAssetCoreOperation(op: JourneyOperation, ctx: JourneyContext): OpExecution {
  switch (op.kind) {
    // -------------------------------------------------------------------------
    // Slot 20 — asset lineage + material lots (@fleetos/assets).
    // -------------------------------------------------------------------------
    case "lineage.declare": {
      const r = declareLineage({
        lineageId: op.lineageId,
        tenantId: ctx.tenantId,
        fromAssetId: op.fromAssetId as never,
        toAssetId: op.toAssetId as never,
        relation: op.relation as LineageRelationKind,
        declaredAt: ctx.clock,
        declaredBy: OPERATOR,
        existing: ctx.lineage.refs,
      });
      if (!r.ok) return opRefused(r.reason, { "lin.refused": r.reason });
      ctx.lineage.refs = [...ctx.lineage.refs, r.lineage];
      return opOk({
        "lin.relation": r.lineage.relation,
        "lin.from": r.lineage.fromAssetId,
        "lin.to": r.lineage.toAssetId,
        "lin.auditIntent": r.audit.intent,
        "lin.declaredCount": ctx.lineage.refs.length,
      });
    }
    case "lineage.material-create": {
      const r = createMaterialLot({
        lotId: op.lotId,
        tenantId: ctx.tenantId,
        kind: op.materialKind,
        attributes: { source: "field-acceptance", journey: "asset-lineage-material-lots" },
        quantity: op.quantity,
        unit: op.materialUnit,
        createdAt: ctx.clock,
      });
      if (!r.ok) return opRefused(r.reason, { "lot.refused": r.reason });
      ctx.lineage.lots.set(op.lotId, r.lot);
      return opOk({
        "lot.initial": r.lot.initialQuantity,
        "lot.remaining": r.lot.remainingQuantity,
        "lot.state": materialLotLifecycleState(r.lot),
        "lot.consumeSeq": r.lot.consumeSeq,
      });
    }
    case "lineage.material-consume": {
      const lot = ctx.lineage.lots.get(op.lotId);
      if (!lot) return opRefused("unknown-lot", { "lot.refused": "unknown-lot" });
      const r = consumeMaterialLot(lot, {
        tenantId: op.tenantId ?? ctx.tenantId,
        lotId: op.lotId as never,
        quantity: op.quantity,
        consumedAt: ctx.clock,
        consumeSeq: op.consumeSeq,
      });
      if (!r.ok) {
        return opRefused(r.reason, {
          "lot.refused": r.reason,
          ...(r.requested !== undefined ? { "lot.requested": r.requested } : {}),
          ...(r.remaining !== undefined ? { "lot.remaining": r.remaining } : {}),
        });
      }
      ctx.lineage.lots.set(op.lotId, r.lot);
      return opOk({
        "lot.remaining": r.lot.remainingQuantity,
        "lot.state": materialLotLifecycleState(r.lot),
        "lot.exhausted": r.exhausted,
        "lot.consumeSeq": r.lot.consumeSeq,
      });
    }
    case "lineage.append-edge": {
      // Map the plain-data edge spec onto the REAL (branded) payload type.
      const payload: LineageEdgePayload = (
        op.edge.edgeKind === "asset-consumed-lot"
          ? { kind: "asset-consumed-lot", assetId: op.edge.assetId as never, lotId: op.edge.lotId as never, quantity: op.edge.quantity, unit: op.edge.unit, consumeSeq: op.edge.consumeSeq }
          : op.edge.edgeKind === "method-applied-to-asset"
            ? { kind: "method-applied-to-asset", methodId: op.edge.methodId as never, methodVersion: op.edge.methodVersion, assetId: op.edge.assetId as never, applicationId: op.edge.applicationId as never }
            : op.edge.edgeKind === "lot-transformed-into-lot"
              ? { kind: "lot-transformed-into-lot", sourceLotId: op.edge.sourceLotId as never, targetLotId: op.edge.targetLotId as never, yieldRatio: op.edge.yieldRatio }
              : { kind: "asset-replaced-by-asset", predecessorAssetId: op.edge.predecessorAssetId as never, successorAssetId: op.edge.successorAssetId as never, reason: op.edge.reason }
      );
      const r = appendLineageEdge(ctx.lineage.graph, { tenantId: ctx.tenantId, payload, at: op.at });
      if (!r.ok) return opRefused(r.reason, { "edge.refused": r.reason });
      ctx.lineage.graph = r.graph;
      return opOk({
        "edge.sequence": r.edge.sequence,
        "edge.prevDigest": r.edge.prevDigest,
        "graph.headDigest": r.graph.headDigest,
        "graph.edgeCount": r.graph.edgeCount,
      });
    }
    case "lineage.ancestry": {
      const maxDepth = op.maxDepth;
      const r = ancestry(ctx.lineage.graph, {
        tenantId: ctx.tenantId,
        id: op.id,
        kind: op.nodeKind,
        ...(maxDepth !== undefined ? { maxDepth } : {}),
      });
      if (!r.ok) return opRefused(r.refusal ?? "traversal-refused", { "trav.refused": r.refusal ?? "traversal-refused", "trav.depth": r.depth });
      return opOk({
        "trav.ok": true,
        "trav.edgeCount": r.edges.length,
        "trav.visited": [...r.visited].map((v) => `${v.kind}:${v.id}`).sort(),
        "trav.depth": r.depth,
      });
    }
    case "lineage.verify-chain": {
      if (op.tamperEdgeSequence !== undefined) {
        // The honest tamper probe: mutate a REAL chained edge's payload —
        // the chain verification MUST break and name the failing edge.
        const tampered = {
          ...ctx.lineage.graph,
          edges: ctx.lineage.graph.edges.map((e) =>
            e.sequence === op.tamperEdgeSequence
              ? { ...e, at: e.at + 1 }
              : e,
          ),
        };
        const r = verifyLineageChain(tampered);
        return opOk({
          "chain.tamperedOk": r.ok,
          "chain.tamperedReason": r.ok ? null : r.reason,
          "chain.tamperedFailingSequence": r.ok ? null : r.failingSequence,
        });
      }
      const r = verifyLineageChain(ctx.lineage.graph);
      if (!r.ok) return opRefused(r.reason, { "chain.refused": r.reason, "chain.failingSequence": r.failingSequence });
      return opOk({ "chain.ok": true, "chain.edgeCount": r.edgeCount, "chain.headDigest": r.headDigest });
    }
    // -------------------------------------------------------------------------
    // Slot 22 — identity session lifecycle (@fleetos/identity).
    // -------------------------------------------------------------------------
    case "identity.issue-session": {
      const tenantId = op.tenantId ?? ctx.tenantId;
      const lastSeq = ctx.identity.lastSeqByActor.get(op.actorId) ?? 0;
      const r = issueSession({
        sessionId: op.sessionId,
        tenantId,
        actorId: op.actorId,
        roleId: op.roleId,
        issuedAt: ctx.clock,
        expiresAt: op.expiresAt,
        lastSeq,
      });
      if (!r.ok) return opRefused(r.reason, { "sess.refused": r.reason });
      ctx.identity.sessions.set(op.sessionId, { ...r.issued.session, state: r.issued.session.state });
      ctx.identity.lastSeqByActor.set(op.actorId, r.issued.session.seq);
      return opOk({
        "sess.state": r.issued.session.state,
        "sess.seq": r.issued.session.seq,
        "sess.expiresAt": r.issued.session.expiresAt,
        "sess.auditIntent": r.issued.audit.intent,
      });
    }
    case "identity.session-command": {
      const session = ctx.identity.sessions.get(op.sessionId);
      if (!session) return opRefused("unknown-session", { "sess.refused": "unknown-session" });
      const r = evaluateSessionTransition(
        session.state,
        { kind: op.command, reason: op.reason, at: ctx.clock },
        { id: session.id as never, actorId: session.actorId as never, tenantId: session.tenantId as never },
      );
      if (!r.ok) return opRefused(r.reason, { "sess.refused": r.reason });
      // The kernel evaluates purely; application is the documented caller
      // role (the record's state advances to the audited target).
      ctx.identity.sessions.set(op.sessionId, { ...session, state: r.to });
      return opOk({ "sess.from": r.from, "sess.to": r.to, "sess.auditIntent": r.audit.intent });
    }
    case "identity.validate-session": {
      const session = ctx.identity.sessions.get(op.sessionId);
      if (!session) return opRefused("unknown-session", { "sess.refused": "unknown-session" });
      const ctxResult = makeTenantContext({
        tenantId: (op.asTenant ?? ctx.tenantId) as never,
        actorId: (op.asActor ?? session.actorId) as never,
        roleId: session.roleId as never,
        establishedAt: ctx.clock,
      });
      if (!ctxResult.ok) return opRefused(ctxResult.reason, { "sess.refused": ctxResult.reason });
      const r = validateSession(ctxResult.context, session as never, op.now);
      if (!r.ok) return opRefused(r.reason, { "validation.refused": r.reason, "validation.ok": false });
      return opOk({ "validation.ok": true, "validation.code": r.code });
    }
    case "identity.sweep-sessions": {
      const r = sweepSessions([...ctx.identity.sessions.values()], op.now, ctx.tenantId as never);
      return opOk({
        "sweep.valid": r.valid.length,
        "sweep.expired": r.expired.length,
        "sweep.revoked": r.revoked.length,
        "sweep.total": r.valid.length + r.expired.length + r.revoked.length,
        "sweep.auditIntent": r.audit.intent,
      });
    }
    case "identity.bind-role": {
      const r = bindRole({
        membershipId: op.membershipId,
        tenantId: ctx.tenantId,
        actorId: op.actorId,
        roleId: op.roleId,
        establishedAt: ctx.clock,
        existingBindings: ctx.identity.memberships,
        knownActors: ctx.identity.knownActors,
        knownRoles: ctx.identity.knownRoles,
      });
      if (!r.ok) return opRefused(r.reason, { "mbr.refused": r.reason });
      ctx.identity.memberships = [...ctx.identity.memberships, r.membership];
      return opOk({
        "mbr.state": r.membership.state,
        "mbr.actor": r.membership.actorId,
        "mbr.role": r.membership.roleId,
        "mbr.auditIntent": r.audit.intent,
      });
    }
    // -------------------------------------------------------------------------
    // Slot 23 — tenant lifecycle gating (@fleetos/tenancy).
    // -------------------------------------------------------------------------
    case "tenancy.provision-tenant": {
      const r = ctx.tenants.provisionTenant({
        tenantId: op.tenantId,
        displayName: op.displayName,
        kind: op.tenantKind,
        createdAt: ctx.clock,
        actor: OPERATOR,
      });
      if (!r.ok) return opRefused(r.reason, { "tenant.refused": r.reason });
      return opOk({
        "tenant.state": r.tenant.state,
        "tenant.seq": r.tenant.transitionSeq,
        "tenant.suspendReason": r.tenant.suspendReason,
        "tenant.auditIntent": r.audit.intent,
      });
    }
    case "tenancy.transition": {
      const r = ctx.tenants.executeTransition({
        tenantId: op.tenantId,
        command: { kind: op.command, reason: op.reason, initiatedAt: ctx.clock },
        actor: OPERATOR,
      });
      if (!r.ok) return opRefused(r.reason, { "tenant.refused": r.reason });
      return opOk({
        "tenant.state": r.tenant.state,
        "tenant.seq": r.tenant.transitionSeq,
        "tenant.suspendReason": r.tenant.suspendReason,
        "tenant.closeReason": r.tenant.closeReason,
      });
    }
    case "tenancy.establish": {
      const r = establishTenant(ctx.tenants, op.tenantId, op.allowTransitional);
      if (!r.ok) return opRefused(r.reason, { "est.refused": r.reason });
      return opOk({
        "est.state": r.tenant.state,
        "est.readCrossTenant": r.boundary.readCrossTenant,
        "est.writeCrossTenant": r.boundary.writeCrossTenant,
      });
    }
    case "tenancy.evaluate-operation": {
      const tenant = ctx.tenants.lookupTenant(op.tenantId);
      const r = evaluateTenantOperation(tenant, op.operation);
      if (!r.ok) {
        return opOk({ "top.allowed": false, "top.refused": r.reason, "top.tenantState": r.tenantState });
      }
      return opOk({ "top.allowed": true, "top.refused": null, "top.tenantState": r.tenantState });
    }
    default:
      return opRefused("unknown-operation");
  }
}

/** Re-exported for the runner's dispatch sets (F321A asset-core family). */
export const F321A_ASSET_CORE_OP_KINDS: ReadonlySet<string> = new Set([
  "lineage.declare",
  "lineage.material-create",
  "lineage.material-consume",
  "lineage.append-edge",
  "lineage.ancestry",
  "lineage.verify-chain",
  "identity.issue-session",
  "identity.session-command",
  "identity.validate-session",
  "identity.sweep-sessions",
  "identity.bind-role",
  "tenancy.provision-tenant",
  "tenancy.transition",
  "tenancy.establish",
  "tenancy.evaluate-operation",
]);
