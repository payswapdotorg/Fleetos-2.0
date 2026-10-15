/**
 * @fleetos/acceptance-commerce — the F370C deployment-service step drivers,
 * the verb families (drivers-marketplace-service.ts).
 *
 * Interprets the mps-* VERB steps (the F362 spine shape) against the REAL
 * marketplace deployment service over its HTTP boundary. The lifecycle/
 * auth/ops steps (boot, login, revoke, restart, digest, backup, state)
 * live in drivers-mps-ops.ts; the harness in drivers-mps-harness.ts
 * spawns the service as a real child process. Every fact surfaced is
 * logical and deterministic — never the port, the data dir, a pid or a
 * wall clock (the fixture-clock law, byte-identical re-runs).
 *
 * The approval policy/limits/policyRefs are CALLER-SUPPLIED fixtures
 * inside this module (the F361B/F362 journey convention — fixture-
 * labelled, never a live-policy claim); the supplier verifications are
 * built through the REAL @fleetos/vendors machine (the F361C
 * composition-site law); the evidence artifacts through the REAL
 * @fleetos/evidence content-addressing helpers.
 */
import type { FactValue } from "./journey-contracts.js";
import type { MpsStep } from "./journey-contracts-f370c.js";
import type { JourneyState } from "./journey-world.js";
import { logPush } from "./journey-world.js";
import { buildArtifact, utf8Bytes } from "@fleetos/evidence";
import { baseFacts, fieldOf, reasonOf, runMpsOpsStep } from "./drivers-mps-ops.js";
import { openSupplierVerification, transitionSupplierVerification } from "@fleetos/vendors";
import { mpsCall, serviceOf } from "./drivers-mps-harness.js";

export type DriverFacts = Record<string, FactValue>;

// --- the approval fixtures (the F362 driver convention, verbatim values) ---

const APPROVAL_RULES = [
  {
    id: "rule.require_human_approval_for_high_risk",
    description: "high-risk execution requires human approval",
    riskFloor: "medium",
    riskCeiling: "high",
    requiredAuthority: ["human.approval"],
    tenantScope: "single",
    verdict: "REQUIRE_APPROVAL",
    priority: 20,
  },
] as const;

const APPROVAL_POLICY = {
  id: "pol-mps-01",
  version: "1.0.0",
  tenantId: "acme",
  rules: APPROVAL_RULES,
  defaultVerdict: "BLOCK",
  failClosed: true,
} as const;

const APPROVAL_LIMITS = {
  amountCeiling: { purchase: 8_000_000, "repair-service": 5_000_000, rental: 0, lease: 0 },
  currency: "GHS",
  allowedCategories: ["laptops", "printers"],
  maxUnitsPerOrder: 10,
  requiredPolicyKinds: ["procurement", "budget"],
} as const;

const APPROVAL_POLICY_REFS = [
  { policyKind: "procurement", policyId: "pol-proc-mps-1", version: "1.0.0" },
  { policyKind: "budget", policyId: "pol-budget-mps-1", version: "1.1.0" },
] as const;

// --- the response fact helpers ----------------------------------------------

// --- the step interpreter ----------------------------------------------------

export async function runMarketplaceServiceStep(step: MpsStep, state: JourneyState): Promise<DriverFacts> {
  const service = serviceOf(state);
  switch (step.kind) {
    case "mps-request-submit": {
      const res = await mpsCall(service, "POST", "/api/marketplace/requests", {
        tenantId: step.tenantId, now: step.now, requestId: step.requestId, naturalKey: step.naturalKey,
        sku: step.sku, quantity: step.quantity, requiredBy: step.requiredBy, at: step.at,
      }, step.sessionKey);
      logPush(state, "mps.log", `request-submit:${res.status}:${reasonOf(res.json) ?? "ok"}`);
      const facts = baseFacts(`mps.request.${step.factKey}`, res);
      facts[`mps.request.${step.factKey}.status`] = fieldOf(res.json, ["result", "request", "status"]);
      facts[`mps.request.${step.factKey}.requestId`] = fieldOf(res.json, ["result", "request", "requestId"]);
      facts[`mps.request.${step.factKey}.duplicate`] = fieldOf(res.json, ["result", "duplicate"]) === true;
      return facts;
    }
    case "mps-request-transition": {
      const res = await mpsCall(service, "POST", "/api/marketplace/request-transitions", {
        tenantId: step.tenantId, now: step.now, requestId: step.requestId,
        command: { type: step.command.type, at: step.command.at, ...(step.command.reason !== undefined ? { reason: step.command.reason } : {}), ...(step.command.offerId !== undefined ? { offerId: step.command.offerId } : {}) },
      }, step.sessionKey);
      logPush(state, "mps.log", `request-transition:${step.command.type}:${res.status}:${reasonOf(res.json) ?? "ok"}`);
      const facts = baseFacts(`mps.requestT.${step.factKey}`, res);
      facts[`mps.requestT.${step.factKey}.status`] = fieldOf(res.json, ["result", "next", "status"]);
      return facts;
    }
    case "mps-offer-capture": {
      const res = await mpsCall(service, "POST", "/api/marketplace/offers", {
        tenantId: step.tenantId, now: step.now,
        offer: { ...step.offer, source: { kind: step.offer.sourceKind, reference: step.offer.sourceReference } },
      }, step.sessionKey);
      logPush(state, "mps.log", `offer:${String(step.offer.offerId)}:${res.status}:${reasonOf(res.json) ?? "ok"}`);
      const facts = baseFacts(`mps.offer.${step.factKey}`, res);
      facts[`mps.offer.${step.factKey}.offerId`] = fieldOf(res.json, ["result", "offer", "offerId"]);
      return facts;
    }
    case "mps-offer-sheet": {
      const res = await mpsCall(service, "GET", `/api/marketplace/offers/sheet?tenantId=${encodeURIComponent(step.tenantId)}&at=${step.at}&now=${step.now}`, undefined, step.sessionKey);
      logPush(state, "mps.log", `offer-sheet:${res.status}:${reasonOf(res.json) ?? "ok"}`);
      const facts = baseFacts(`mps.sheet.${step.factKey}`, res);
      facts[`mps.sheet.${step.factKey}.freshCount`] = fieldOf(res.json, ["result", "freshCount"]);
      const excludedRaw = (res.json["result"] as Record<string, unknown> | undefined)?.["excluded"];
      facts[`mps.sheet.${step.factKey}.excludedIds`] = Array.isArray(excludedRaw) ? excludedRaw.map((e) => `${String((e as Record<string, unknown>)["offerId"])}:${String((e as Record<string, unknown>)["verdict"])}`) : [];
      return facts;
    }
    case "mps-comparison": {
      const verifications = step.suppliers.map((supplier) => {
        const opened = openSupplierVerification({ tenantId: step.tenantId }, supplier.supplierId);
        if (!opened.ok) throw new Error(`supplier open refused: ${opened.reasonCode}`);
        const verified = transitionSupplierVerification(opened.next, {
          type: "verify", evidence: { evidenceId: supplier.evidenceId, tenantId: step.tenantId }, verifiedAt: supplier.verifiedAt, expiresAt: supplier.expiresAt,
        });
        if (!verified.ok) throw new Error(`supplier verify refused: ${verified.reasonCode}`);
        return verified.next;
      });
      const res = await mpsCall(service, "POST", "/api/marketplace/comparisons", {
        tenantId: step.tenantId, now: step.now, at: step.at,
        demand: { sku: step.demandSku, currency: step.demandCurrency, acceptableConditions: step.acceptableConditions },
        supplierVerifications: verifications,
      }, step.sessionKey);
      logPush(state, "mps.log", `comparison:${res.status}:${reasonOf(res.json) ?? "ok"}`);
      const facts = baseFacts(`mps.compare.${step.factKey}`, res);
      facts[`mps.compare.${step.factKey}.eligibleCount`] = fieldOf(res.json, ["result", "eligibleCount"]);
      facts[`mps.compare.${step.factKey}.topOfferId`] = fieldOf(res.json, ["result", "ranked", "0", "quoteId"]);
      const rankedRaw = (res.json["result"] as Record<string, unknown> | undefined)?.["ranked"];
      facts[`mps.compare.${step.factKey}.rankedIds`] = Array.isArray(rankedRaw) ? rankedRaw.map((r) => String((r as Record<string, unknown>)["quoteId"])) : [];
      return facts;
    }
    case "mps-evidence-retain": {
      const artifact = buildArtifact(step.artifactId, utf8Bytes(step.artifactJson), "application/json", step.artifactDescription);
      const res = await mpsCall(service, "POST", "/api/marketplace/evidence", {
        tenantId: step.tenantId, now: step.now, recordedAt: step.recordedAtIso,
        input: {
          tenantId: step.tenantId, providerEventId: step.providerEventId,
          kind: step.evidenceKind === "offer-snapshot" ? "marketplace.offer-snapshot" : "marketplace.provider-ack",
          subjectRef: step.subjectRef,
          source: { system: step.sourceSystem, reference: step.sourceReference, retrievedVia: step.retrievedVia },
          capturedAt: step.capturedAtIso, artifacts: [artifact],
        },
      }, step.sessionKey);
      const evidenceId = fieldOf(res.json, ["result", "record", "evidenceId"]);
      if (step.evidenceKind === "provider-ack") service.lastProviderAckEvidenceId = evidenceId === null ? null : String(evidenceId);
      else service.lastSnapshotEvidenceId = evidenceId === null ? null : String(evidenceId);
      logPush(state, "mps.log", `evidence:${step.evidenceKind}:${res.status}:${String(evidenceId)}`);
      const facts = baseFacts(`mps.evidence.${step.factKey}`, res);
      facts[`mps.evidence.${step.factKey}.evidenceId`] = evidenceId;
      facts[`mps.evidence.${step.factKey}.duplicate`] = fieldOf(res.json, ["result", "duplicate"]) === true;
      return facts;
    }
    case "mps-approval": {
      const snapshotRef = step.offerSnapshotFromEvidence ? service.lastSnapshotEvidenceId : "fixture-snapshot-ref";
      const res = await mpsCall(service, "POST", "/api/marketplace/approvals", {
        tenantId: step.tenantId, now: step.now, requestId: step.requestId,
        actorAuthority: step.actorAuthority, actorAutonomous: step.actorAutonomous,
        order: {
          orderId: step.orderId, category: step.category, transactionKind: step.transactionKind,
          units: step.units, amount: { total: step.amountTotal, currency: step.currency },
          supplierRef: { supplierId: step.supplierId, verificationRef: step.verificationRef }, offerSnapshotRef: snapshotRef,
        },
        limits: APPROVAL_LIMITS, policyRefs: APPROVAL_POLICY_REFS, policy: APPROVAL_POLICY,
      }, step.sessionKey);
      logPush(state, "mps.log", `approval:${res.status}:${String(fieldOf(res.json, ["result", "decision"]))}`);
      const facts = baseFacts(`mps.approval.${step.factKey}`, res);
      facts[`mps.approval.${step.factKey}.decision`] = fieldOf(res.json, ["result", "decision"]);
      facts[`mps.approval.${step.factKey}.reasonCode`] = fieldOf(res.json, ["result", "reasonCode"]);
      facts[`mps.approval.${step.factKey}.guardianVerdict`] = fieldOf(res.json, ["result", "guardianDecision", "verdict"]);
      const findingsRaw = (res.json["result"] as Record<string, unknown> | undefined)?.["limitFindings"];
      facts[`mps.approval.${step.factKey}.allLimitsPassed`] = Array.isArray(findingsRaw) && findingsRaw.every((f) => (f as Record<string, unknown>)["passed"] === true);
      facts[`mps.approval.${step.factKey}.offerSnapshotRef`] = snapshotRef;
      return facts;
    }
    case "mps-order-draft": {
      const res = await mpsCall(service, "POST", "/api/marketplace/orders", {
        tenantId: step.tenantId, now: step.now,
        order: { orderId: step.orderId, requestId: step.requestId, offerId: step.offerId, supplierId: step.supplierId, sku: step.sku, quantity: step.quantity, unitCostMinor: step.unitCostMinor, totalCostMinor: step.totalCostMinor, currency: step.currency },
      }, step.sessionKey);
      logPush(state, "mps.log", `order-draft:${res.status}:${reasonOf(res.json) ?? "ok"}`);
      const facts = baseFacts(`mps.orderDraft.${step.factKey}`, res);
      facts[`mps.orderDraft.${step.factKey}.status`] = fieldOf(res.json, ["result", "order", "status"]);
      return facts;
    }
    case "mps-order-place": {
      const res = await mpsCall(service, "POST", "/api/marketplace/order-places", {
        tenantId: step.tenantId, now: step.now, orderId: step.orderId, at: step.at,
      }, step.sessionKey);
      logPush(state, "mps.log", `order-place:${res.status}:${reasonOf(res.json) ?? "ok"}`);
      const facts = baseFacts(`mps.orderPlace.${step.factKey}`, res);
      facts[`mps.orderPlace.${step.factKey}.status`] = fieldOf(res.json, ["result", "order", "status"]);
      return facts;
    }
    case "mps-order-ack": {
      const evidenceId = step.evidenceFromEvidence ? service.lastProviderAckEvidenceId : "fixture-ack-ref";
      const res = await mpsCall(service, "POST", "/api/marketplace/order-acks", {
        tenantId: step.tenantId, now: step.now, orderId: step.orderId,
        ack: { providerEventId: step.providerEventId, evidence: { evidenceId: evidenceId ?? "fixture-ack-ref", tenantId: step.tenantId }, channel: step.channel, acknowledgedAt: step.acknowledgedAt },
      }, step.sessionKey);
      logPush(state, "mps.log", `order-ack:${step.providerEventId}:${res.status}:${reasonOf(res.json) ?? "ok"}`);
      const facts = baseFacts(`mps.ack.${step.factKey}`, res);
      facts[`mps.ack.${step.factKey}.status`] = fieldOf(res.json, ["result", "order", "status"]);
      facts[`mps.ack.${step.factKey}.duplicate`] = fieldOf(res.json, ["result", "duplicate"]) === true;
      facts[`mps.ack.${step.factKey}.evidenceCited`] = evidenceId;
      return facts;
    }
    case "mps-order-transition": {
      const res = await mpsCall(service, "POST", "/api/marketplace/order-transitions", {
        tenantId: step.tenantId, now: step.now, orderId: step.orderId,
        command: { type: step.command.type, at: step.command.at, ...(step.command.reason !== undefined ? { reason: step.command.reason } : {}) },
      }, step.sessionKey);
      logPush(state, "mps.log", `order-transition:${step.command.type}:${res.status}:${reasonOf(res.json) ?? "ok"}`);
      const facts = baseFacts(`mps.orderT.${step.factKey}`, res);
      facts[`mps.orderT.${step.factKey}.status`] = fieldOf(res.json, ["result", "order", "status"]);
      return facts;
    }
    case "mps-receipt-record": {
      const res = await mpsCall(service, "POST", "/api/marketplace/receipts", {
        tenantId: step.tenantId, now: step.now,
        receipt: { evidenceRef: step.evidenceRef, tenantId: step.tenantId, siteId: step.siteId, supplierOrderRef: step.supplierOrderRef, serial: step.serial, assetTag: step.assetTag, conditionOnArrival: step.conditionOnArrival, warrantyRef: step.warrantyRef, capturedAt: step.capturedAt, recordedAt: step.recordedAt },
      }, step.sessionKey);
      logPush(state, "mps.log", `receipt:${step.evidenceRef}:${res.status}:${reasonOf(res.json) ?? "ok"}`);
      const facts = baseFacts(`mps.receipt.${step.factKey}`, res);
      facts[`mps.receipt.${step.factKey}.state`] = fieldOf(res.json, ["result", "evidence", "state"]);
      facts[`mps.receipt.${step.factKey}.duplicate`] = fieldOf(res.json, ["result", "duplicate"]) === true;
      return facts;
    }
    case "mps-receipt-verify": {
      const res = await mpsCall(service, "POST", "/api/marketplace/receipt-verifications", {
        tenantId: step.tenantId, now: step.now, evidenceRef: step.evidenceRef, decidedAt: step.decidedAt,
        expectation: { supplierOrderRef: step.expectSupplierOrderRef, expectedSerial: step.expectSerial, expectedAssetTag: step.expectAssetTag, expectedCondition: step.expectCondition },
      }, step.sessionKey);
      logPush(state, "mps.log", `receipt-verify:${step.evidenceRef}:${res.status}:${reasonOf(res.json) ?? "ok"}`);
      const facts = baseFacts(`mps.verify.${step.factKey}`, res);
      facts[`mps.verify.${step.factKey}.state`] = fieldOf(res.json, ["result", "evidence", "state"]);
      return facts;
    }
    case "mps-enrollment-open": {
      const res = await mpsCall(service, "POST", "/api/marketplace/enrollments", {
        tenantId: step.tenantId, now: step.now,
        enrollment: { evidenceRef: step.evidenceRef, assetId: step.assetId, displayName: step.displayName, kind: step.assetKind, ...(step.deviceId !== undefined ? { deviceId: step.deviceId } : {}), at: step.at },
      }, step.sessionKey);
      logPush(state, "mps.log", `enroll-open:${step.evidenceRef}:${res.status}:${reasonOf(res.json) ?? "ok"}`);
      const facts = baseFacts(`mps.enrollOpen.${step.factKey}`, res);
      facts[`mps.enrollOpen.${step.factKey}.state`] = fieldOf(res.json, ["result", "enrollment", "state"]);
      facts[`mps.enrollOpen.${step.factKey}.enrollmentId`] = fieldOf(res.json, ["result", "enrollment", "enrollmentId"]);
      facts[`mps.enrollOpen.${step.factKey}.duplicate`] = fieldOf(res.json, ["result", "duplicate"]) === true;
      return facts;
    }
    case "mps-enrollment-complete": {
      const res = await mpsCall(service, "POST", "/api/marketplace/enrollment-completions", {
        tenantId: step.tenantId, now: step.now, serial: step.serial, ...(step.deviceId !== undefined ? { deviceId: step.deviceId } : {}), at: step.at,
      }, step.sessionKey);
      logPush(state, "mps.log", `enroll-complete:${step.serial}:${res.status}:${reasonOf(res.json) ?? "ok"}`);
      const facts = baseFacts(`mps.enrollComplete.${step.factKey}`, res);
      facts[`mps.enrollComplete.${step.factKey}.state`] = fieldOf(res.json, ["result", "enrollment", "state"]);
      facts[`mps.enrollComplete.${step.factKey}.twinLinked`] = fieldOf(res.json, ["result", "twinLinked"]) === true;
      return facts;
    }
  }
  // The lifecycle/auth/ops families live in drivers-mps-ops.ts.
  return runMpsOpsStep(step, state);
}
