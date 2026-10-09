# Browser Journey 2 — Inspect-why and mission replay

**Persona:** compliance-auditor.
**Routes:** inspect-why → execution-results (audit trail) → evidence-chain.
**Machine-run twin:** `security.mission-replay` + `security.inspect-why`
(acceptance corpus, journeys 15 + 9).

## Preconditions

- A completed mission's records: an action chain driven to `recorded`
  (authorized → confirmed → dispatched → executing → executed → verified →
  recorded), its execution ledger, its action audit journal, and the
  Guardian decision records + audit refs (the reasoning traces).

## Steps

1. **Open inspect-why for the completed action** (`inspect-why`).
   - EXPECT: the decision provenance view — guardian block with verdict and
     decision digest; the ordered reason chain (rule id, flavor, reason
     code, matched fact count); the capability grants with status; the
     execution journal slice with per-entry digests; the evidence refs
     (action evidence + A13 trace links); a chain digest that VERIFIES.
   - The view must present an unauthorized action with
     `authorizationPending` and a NULL guardian block — never invented
     authorization.

2. **Open execution results + audit trail** (`execution-results`).
   - EXPECT: the ledger in recorded order; the REAL verification outcome
     verbatim (verified true, or the named break if tampered); the REPLAY
     summary — the rebuilt command list from the ledger; the audit trail
     summary over the emitted action events.
   - If the TL shell surfaces the incident replay timeline, the canonical
     merge (journal + ledger by time, source rank, subject, kind) renders
     deterministically.

3. **Replay determinism check (shell-level).**
   - Reload the route. EXPECT: byte-identical presentation (same digests,
     same timeline). Any difference is a FAIL (non-deterministic
     projection).

4. **Drill into the evidence chain** (`evidence-chain`).
   - EXPECT: the verification + action evidence entries with digests; the
     A13 chain links; the REAL verification outcome.

## Negative checks

- Cross-tenant probe (if the shell offers a tenant switch): opening this
  tenant's records under a rival tenant session must REFUSE the whole view
  with the offender named — never partial state.
- A structurally broken ledger (simulated by the TL's test fixture) must
  render the replay refusal (`replay.ledger-refused`) — never a fabricated
  timeline.

## Pass criteria

Real reasoning traces and replay records are presented (no fabricated
explanations); digests verify; determinism holds across reloads; refusals
render honestly.
