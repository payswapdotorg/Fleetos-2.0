/**
 * @fleetos/acceptance-commerce — vendor/software step drivers.
 *
 * Interprets typed journey steps against the REAL public entry points of
 * @fleetos/vendors, @fleetos/software and the KPI/seat views of
 * @fleetos/experience-work-commerce. Facts are verbatim REAL outputs;
 * refusals carry the domain's reason codes.
 */

import type { FactValue, CommerceStep } from "./journey-contracts.js";
import type { JourneyState } from "./journey-world.js";
import { CLOCK, logPush } from "./journey-world.js";
import { buildVendorKpiRollup, buildSeatView } from "@fleetos/experience-work-commerce";
import { transitionVendorLifecycle, verifyCapability as verifyVendorCapability, commitServiceExposure, releaseServiceExposure } from "@fleetos/vendors";
import { checkEntitlement, assignGrantWithinPopulation, revokeGrant, countHeldSeats } from "@fleetos/software";

export type DriverFacts = Record<string, FactValue>;

export async function runVendorStep(step: CommerceStep, state: JourneyState): Promise<DriverFacts> {
  switch (step.kind) {
    case "vendor-lifecycle": {
      const command =
        step.command === "suspend"
          ? { type: "suspend" as const, reason: step.reason ?? "sla breach" }
          : step.command === "reinstate"
            ? { type: "reinstate" as const, reason: step.reason ?? "remediation accepted" }
            : step.command === "terminate"
              ? { type: "terminate" as const, reason: step.reason ?? "contract ended", at: CLOCK.t3 }
              : { type: "activate" as const };
      const result = transitionVendorLifecycle(state.vendor.record, command);
      if (result.ok) state.vendor.record = result.next;
      logPush(
        state,
        "vendor.log",
        `${result.ok}:${result.ok ? result.next.status : result.reasonCode}`,
      );
      return {
        "vendor.ok": result.ok,
        "vendor.status": state.vendor.record.status,
        "vendor.reasonCode": result.ok ? null : result.reasonCode,
        "vendor.reinstatementCount": state.vendor.record.reinstatementCount,
      };
    }
    case "vendor-verify-capability": {
      const result = verifyVendorCapability(
        state.vendor.capabilities,
        state.vendor.record.vendorId,
        step.tag,
        step.evidenceId === null ? null : { evidenceId: step.evidenceId, tenantId: state.tenant.tenantId },
        CLOCK.t2,
      );
      if (result.ok) state.vendor.capabilities = [...result.records];
      logPush(state, "vendorVerify.log", `${result.ok}:${result.ok ? null : result.reasonCode}`);
      return {
        "vendorVerify.ok": result.ok,
        "vendorVerify.reasonCode": result.ok ? null : result.reasonCode,
        "vendorVerify.tag": step.tag,
      };
    }
    case "vendor-exposure": {
      const result =
        step.op === "commit"
          ? commitServiceExposure(state.vendor.exposure, step.amountMinorUnits)
          : releaseServiceExposure(state.vendor.exposure, step.amountMinorUnits);
      if (result.ok) state.vendor.exposure = result.ledger;
      logPush(
        state,
        "exposure.log",
        `${result.ok}:${result.ok ? result.ledger.committedMinorUnits : result.overshootMinorUnits}`,
      );
      return {
        "exposure.ok": result.ok,
        "exposure.committedMinorUnits": result.ok ? result.ledger.committedMinorUnits : -1,
        "exposure.reasonCode": result.ok ? null : result.reasonCode,
        "exposure.overshootMinorUnits": result.ok ? null : result.overshootMinorUnits,
      };
    }
    case "vendor-kpi-view": {
      const result = buildVendorKpiRollup({
        tenant: state.tenant,
        vendors: [state.vendor.record],
        quotes: [...state.commerce.quotes.values()],
        exposures: [state.vendor.exposure],
        computedAt: step.computedAt,
      });
      if (!result.ok) return { "kpi.ok": false, "kpi.reasonCode": result.reasonCode, "kpi.detail": result.detail };
      const row = result.rows.find((r) => r.vendorId === "ven-1");
      return {
        "kpi.ok": true,
        "kpi.status": row?.status ?? null,
        "kpi.acceptanceBps": row?.acceptanceBps ?? -1,
        "kpi.quotesAccepted": row?.quotesAccepted ?? -1,
        "kpi.quotesRejected": row?.quotesRejected ?? -1,
        "kpi.quotesSuperseded": row?.quotesSuperseded ?? -1,
        "kpi.exposureUtilizationBps": row?.exposure?.utilizationBps ?? -1,
        "kpi.exposureRemaining": row?.exposure?.remainingMinorUnits ?? -1,
        "kpi.digest": result.digest,
      };
    }
    case "entitlement-check": {
      const result = checkEntitlement(state.software.subscription, state.software.entitlements, {
        tenant: state.tenant,
        subscriptionId: state.software.subscription.id,
        requestedSeats: step.requestedSeats,
      });
      logPush(state, "entitlement.log", `${result.ok}:${result.ok ? result.remainingSeats : result.reasonCode}`);
      return {
        "entitlement.ok": result.ok,
        "entitlement.remainingSeats": result.ok ? result.remainingSeats : -1,
        "entitlement.reasonCode": result.ok ? null : result.reasonCode,
        "entitlement.overshootSeats": result.ok ? null : result.overshootSeats,
      };
    }
    case "grant-assign": {
      const grant = state.software.grants.find((g) => g.id === step.grantId);
      if (grant === undefined) return { "grant.ok": false, "grant.reasonCode": "GRANT_NOT_FOUND" };
      const result = assignGrantWithinPopulation(
        grant,
        state.software.grants,
        state.software.catalogEntry,
        state.software.subscription,
        step.assigneeId,
        CLOCK.t2,
      );
      if (result.ok) {
        state.software.grants = state.software.grants.map((g) => (g.id === step.grantId ? result.next : g));
      }
      return {
        "grant.ok": result.ok,
        "grant.reasonCode": result.ok ? null : result.reasonCode,
        "grant.overshootSeats": result.ok ? null : result.overshootSeats,
        "grant.heldSeatsAfter": result.ok ? result.heldSeatsAfter : -1,
        "grant.status": result.ok ? result.next.status : null,
      };
    }
    case "grant-revoke": {
      const grant = state.software.grants.find((g) => g.id === step.grantId);
      if (grant === undefined) return { "grantRevoke.ok": false, "grantRevoke.reasonCode": "GRANT_NOT_FOUND" };
      const result = revokeGrant(grant, step.reason, CLOCK.t3);
      if (result.ok) {
        state.software.grants = state.software.grants.map((g) => (g.id === step.grantId ? result.next : g));
      }
      return {
        "grantRevoke.ok": result.ok,
        "grantRevoke.reasonCode": result.ok ? null : result.reasonCode,
        "grantRevoke.heldSeatsAfter": countHeldSeats("sub-1", state.software.grants),
        "grantRevoke.status": result.ok ? result.next.status : null,
      };
    }
    case "seat-view": {
      const result = buildSeatView({
        tenant: state.tenant,
        subscriptions: [state.software.subscription],
        entitlements: state.software.entitlements,
        now: step.now,
        computedAt: step.computedAt,
      });
      if (!result.ok) return { "seats.ok": false, "seats.reasonCode": result.reasonCode, "seats.detail": result.detail };
      const row = result.rows.find((r) => r.subscriptionId === "sub-1");
      return {
        "seats.ok": true,
        "seats.allocated": row?.seatsAllocated ?? -1,
        "seats.total": row?.seatsTotal ?? -1,
        "seats.revoked": row?.seatsRevoked ?? -1,
        "seats.overAllocated": row?.seatsOverAllocated ?? -1,
        "seats.utilizationBps": row?.utilizationBps ?? -1,
        "seats.expired": row?.expired ?? false,
        "seats.digest": result.digest,
      };
    }
    default:
      return { "step.ok": false, "step.reasonCode": `UNHANDLED_STEP:${step.kind}` };
  }
}
