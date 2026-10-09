# ADR-0003 — Tamper-Evident Digest Chains at Evidence Grade

## Status

ACCEPTED (implemented Waves 1–9; per-package verify surfaces)

## Context

FleetOS journals (commands, intents, sessions, jobs, runs, evaluations, certifications,
adoptions, audits, lineage edges) are append-only histories that downstream gates
(admission, release, convergence) consume as evidence. The system needed tamper
evidence without a cryptographic infrastructure dependency inside every domain
package.

## Decision

- Append-only journals chain per-record digests (record N's digest covers record N−1's
  digest + its own canonical fields). Verification detects reordering, edits and
  truncation with named break points (earliest-broken-seq style).
- Domain packages use the FNV-1a 32-bit family (canonical-JSON serialization,
  sorted-key summation order for float determinism) — deterministic, dependency-free,
  evidence-grade.
- The `evidence` package additionally offers sha-256 (node:crypto) at evidence-BUNDLE
  grade where stronger tamper resistance is required.
- `verify*` functions recompute digests from the fields PRESENTED (tamper-evident
  rather than a full re-derivation from genesis); full re-derivation exists as a
  separate tested property where required.

## Consequences

- Any mutation of an already-chained record fails loudly at the next verify —
  machine-tested by mutation fixtures in every lane (including the Wave-9 lineage
  edge log).
- FNV-1a 32-bit is NOT cryptographically strong — a documented, accepted limitation
  (collision resistance at evidence grade, not adversarial grade); recorded in the
  residual-risks register.
- The convention allowed one uniform tamper-evidence vocabulary across 30+ packages
  and five acceptance corpora.
