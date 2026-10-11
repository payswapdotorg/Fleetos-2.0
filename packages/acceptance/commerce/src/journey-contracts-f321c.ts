/**
 * @fleetos/acceptance-commerce — F321C step contracts (Wave 12 lane C).
 *
 * The three step-kind families the F321C corpus extension adds:
 *   - MarketplaceStep — vendor marketplace listing publication gate,
 *     revocation→delisting cascade, and deterministic tenant-scoped
 *     listing search (`@fleetos/vendors` marketplace.ts);
 *   - VendorDirectoryStep — the VendorDirectory over the REAL in-memory
 *     repository: service-relationship transitions with audit events,
 *     worst-wins scorecard aggregation, and the deterministic capability
 *     matching feed (`@fleetos/vendors` directory.ts + contracts.ts);
 *   - ActorJobStep — the actor-job failure/expiry/idempotent-creation
 *     surface (`@fleetos/apify` job-lifecycle.ts) — contract-level local
 *     lifecycle only, never a live Apify binding.
 *
 * Split from journey-contracts.ts to hold the file law (≤ 400 lines).
 * Pure data contracts — the runner interprets them through the
 * drivers-marketplace / drivers-vendor-directory / drivers-actor-jobs
 * modules.
 */

import type { JourneyStepBase } from "./journey-contracts.js";

// ---------------------------------------------------------------------------
// Marketplace steps (F321C, Wave 12 lane C).
// ---------------------------------------------------------------------------

export type MarketplaceStep =
  | (JourneyStepBase & {
      readonly kind: "marketplace-capabilities-seed";
      readonly factKey: string;
      readonly records: readonly {
        readonly vendorId: string;
        readonly tag: string;
        readonly status: "verified" | "declared";
        /** "foreign" seeds the record under the OTHER tenant (fail-closed probe input). */
        readonly tenant?: "own" | "foreign";
      }[];
    })
  | (JourneyStepBase & {
      readonly kind: "marketplace-publish";
      readonly factKey: string;
      readonly listingId: string;
      readonly vendorId: string;
      readonly claimedCapabilities: readonly string[];
      /** Honest exclusions — carried verbatim onto the published listing. */
      readonly exclusions: readonly string[];
    })
  | (JourneyStepBase & {
      readonly kind: "marketplace-revoke-cascade";
      readonly factKey: string;
      readonly vendorId: string;
      readonly revokedTags: readonly string[];
      /** Inject a foreign-vendor published listing into the cascade input (fail-closed probe). */
      readonly foreignVendorListingInjected?: boolean;
    })
  | (JourneyStepBase & {
      readonly kind: "marketplace-search";
      readonly factKey: string;
      readonly capabilityTag: string | null;
      readonly vendorId: string | null;
      /** Inject a foreign-tenant published listing into the search input (fail-closed probe). */
      readonly foreignListingInjected?: boolean;
    });

// ---------------------------------------------------------------------------
// VendorDirectory steps (F321C).
// ---------------------------------------------------------------------------

export type VendorDirectoryStep =
  | (JourneyStepBase & {
      readonly kind: "vendor-directory-seed";
      readonly factKey: string;
      readonly vendors: readonly {
        readonly vendorId: string;
        readonly displayName: string;
        readonly status: "active" | "suspended" | "terminated";
        readonly capabilityTags: readonly string[];
        /** "foreign" seeds the vendor under the OTHER tenant (tenant isolation probe). */
        readonly tenant?: "own" | "foreign";
      }[];
      /** Service relationships start ACTIVE; only seeded vendors get one. */
      readonly relationships: readonly { readonly vendorId: string; readonly contractRef: string }[];
      readonly scorecards: readonly {
        readonly vendorId: string;
        /** Metric scores in [0,1] — worst wins the aggregate. */
        readonly metrics: readonly { readonly metric: string; readonly score: number; readonly observedAt: string }[];
      }[];
    })
  | (JourneyStepBase & {
      readonly kind: "vendor-relationship-transition";
      readonly factKey: string;
      readonly vendorId: string;
      readonly command: "suspend" | "resume" | "terminate";
      /** Empty/whitespace reason drives the REQUIRED reason refusal paths. */
      readonly reason?: string;
      readonly endedAt?: string;
    })
  | (JourneyStepBase & {
      readonly kind: "vendor-scorecard-aggregate";
      readonly factKey: string;
      readonly vendorId: string;
    })
  | (JourneyStepBase & {
      readonly kind: "vendor-capability-feed";
      readonly factKey: string;
      readonly requestedTags: readonly string[];
    })
  | (JourneyStepBase & {
      readonly kind: "vendor-directory-read";
      readonly factKey: string;
      readonly vendorId: string;
      /** "foreign" reads through the OTHER tenant's scope (must see nothing). */
      readonly callerTenant?: "own" | "foreign";
    });

// ---------------------------------------------------------------------------
// Actor-job steps (F321C) — contract-level local lifecycle ONLY.
// ---------------------------------------------------------------------------

export type ActorJobStep =
  | (JourneyStepBase & {
      readonly kind: "apify-job-create-idempotent";
      readonly factKey: string;
      readonly jobId: string;
      readonly actorId: string;
      readonly window: string;
      readonly idempotencyKey: string;
      /** Which existing (tenant-scoped) jobs the idempotent create runs against. */
      readonly prior: "none" | "current" | "foreign-same-key";
      /** "same" reproduces the standard create input (duplicate hit); "different" changes it (typed conflict). */
      readonly inputTag: "same" | "different";
      /** Logical clock values — caller-supplied, never wall-clock time. */
      readonly nowMs: number;
      readonly expiresAtMs: number | null;
    })
  | (JourneyStepBase & {
      readonly kind: "apify-job-fail";
      readonly factKey: string;
      /** Empty string drives FAILURE_REASON_REQUIRED from a running job. */
      readonly reasonCode: string;
    })
  | (JourneyStepBase & {
      readonly kind: "apify-job-expire-at";
      readonly factKey: string;
      /** Logical clock value — before/after the job's expiresAt drives the refusal paths. */
      readonly nowMs: number;
    });
