/**
 * @fleetos/acceptance-field — F321A contracts: the asset/identity/tenancy
 * governance family (Wave 12 lane A). Slots 20 (asset lineage + material
 * lots), 22 (identity session lifecycle) and 23 (tenant lifecycle gating).
 *
 * Split out of journey-contracts-f321a.ts to hold the ≤400-line file law
 * (the F310C commerce split-file precedent). Pure data; no logic.
 */

import type { MaterialKind, MaterialUnit } from "@fleetos/assets";

// ---------------------------------------------------------------------------
// Slot 20 — asset lineage + material lots (assets twin-engine + lineage).
// ---------------------------------------------------------------------------

export interface LineageDeclareOp {
  readonly kind: "lineage.declare";
  readonly lineageId: string;
  readonly fromAssetId: string;
  readonly toAssetId: string;
  readonly relation: string;
}

export interface LineageMaterialCreateOp {
  readonly kind: "lineage.material-create";
  readonly lotId: string;
  readonly materialKind: MaterialKind;
  readonly materialUnit: MaterialUnit;
  readonly quantity: number;
}

export interface LineageMaterialConsumeOp {
  readonly kind: "lineage.material-consume";
  readonly lotId: string;
  readonly quantity: number;
  readonly consumeSeq: number;
  /** Optional fail-closed tenant scope probe (foreign tenant refused). */
  readonly tenantId?: string;
}

/** A plain-data lineage edge spec (the executor maps it onto the REAL
 * LineageEdgePayload — the branded ids stay inside the domain package). */
export type LineageEdgeSpec =
  | { readonly edgeKind: "asset-consumed-lot"; readonly assetId: string; readonly lotId: string; readonly quantity: number; readonly unit: string; readonly consumeSeq: number }
  | { readonly edgeKind: "method-applied-to-asset"; readonly methodId: string; readonly methodVersion: string; readonly assetId: string; readonly applicationId: string }
  | { readonly edgeKind: "lot-transformed-into-lot"; readonly sourceLotId: string; readonly targetLotId: string; readonly yieldRatio: number }
  | { readonly edgeKind: "asset-replaced-by-asset"; readonly predecessorAssetId: string; readonly successorAssetId: string; readonly reason: string };

export interface LineageAppendEdgeOp {
  readonly kind: "lineage.append-edge";
  readonly edge: LineageEdgeSpec;
  readonly at: number;
}

export interface LineageAncestryOp {
  readonly kind: "lineage.ancestry";
  readonly id: string;
  readonly nodeKind: "asset" | "lot" | "method-application";
  readonly maxDepth?: number;
}

export interface LineageVerifyChainOp {
  readonly kind: "lineage.verify-chain";
  /** When true, the executor tampers a REAL edge before verifying (honest
   * negative path: the chain MUST break — machine-verified tamper evidence). */
  readonly tamperEdgeSequence?: number;
}

// ---------------------------------------------------------------------------
// Slot 22 — identity session lifecycle (identity kernel).
// ---------------------------------------------------------------------------

export interface IdentityIssueSessionOp {
  readonly kind: "identity.issue-session";
  readonly sessionId: string;
  readonly actorId: string;
  readonly roleId: string;
  readonly expiresAt: number | null;
  /** Optional tenant override (the sweep's fail-closed exclusion probe). */
  readonly tenantId?: string;
}

export interface IdentitySessionCommandOp {
  readonly kind: "identity.session-command";
  readonly sessionId: string;
  readonly command: "activate" | "expire" | "revoke";
  readonly reason?: string;
}

export interface IdentityValidateSessionOp {
  readonly kind: "identity.validate-session";
  readonly sessionId: string;
  readonly now: number;
  /** Probe contexts: the caller identity the validation runs under. */
  readonly asActor?: string;
  readonly asTenant?: string;
}

export interface IdentitySweepSessionsOp {
  readonly kind: "identity.sweep-sessions";
  readonly now: number;
}

export interface IdentityBindRoleOp {
  readonly kind: "identity.bind-role";
  readonly membershipId: string;
  readonly actorId: string;
  readonly roleId: string;
}

// ---------------------------------------------------------------------------
// Slot 23 — tenant lifecycle gating (tenancy kernel).
// ---------------------------------------------------------------------------

export interface TenancyProvisionOp {
  readonly kind: "tenancy.provision-tenant";
  readonly tenantId: string;
  readonly displayName: string;
  readonly tenantKind: "organization" | "personal" | "internal";
}

export interface TenancyTransitionOp {
  readonly kind: "tenancy.transition";
  readonly tenantId: string;
  readonly command: "provision" | "suspend" | "resume" | "close";
  readonly reason?: string;
}

export interface TenancyEstablishOp {
  readonly kind: "tenancy.establish";
  readonly tenantId: string;
  readonly allowTransitional: boolean;
}

export interface TenancyEvaluateOperationOp {
  readonly kind: "tenancy.evaluate-operation";
  readonly tenantId: string;
  readonly operation: "read" | "write" | "admit" | "mutate" | "provision" | "close";
}

/** The asset/identity/tenancy governance sub-union of the F321A operations. */
export type F321AAssetCoreOperation =
  | LineageDeclareOp
  | LineageMaterialCreateOp
  | LineageMaterialConsumeOp
  | LineageAppendEdgeOp
  | LineageAncestryOp
  | LineageVerifyChainOp
  | IdentityIssueSessionOp
  | IdentitySessionCommandOp
  | IdentityValidateSessionOp
  | IdentitySweepSessionsOp
  | IdentityBindRoleOp
  | TenancyProvisionOp
  | TenancyTransitionOp
  | TenancyEstablishOp
  | TenancyEvaluateOperationOp;
