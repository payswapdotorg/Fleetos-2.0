# Browser Journey 1 — The Guardian journey, end to end

**Persona:** tenant-operator (operator-ada, acme-ops).
**Routes:** findings-board → evidence-chain → guardian-decision →
action-authorization → execution-results → inspect-why.
**Machine-run twin:** `security.guardian-e2e` (acceptance corpus, journey 14).

## Preconditions (TL-composed state)

- Tenant `acme-ops`, operator session with `tenant.operator` +
  `human.approval` + `asset.owner` authority.
- One admitted finding: `auth.weak_credential`, severity high, confidence
  confirmed, asset pump-7, evidence ref `ev-intake-e2e-1`.
- The tenant policy with the three fixture rules (allow low-risk read /
  require human approval for high risk / block irreversible without
  operator).
- An evidence chain with two entries and a complete A13 traceability chain.

## Steps

1. **Open the findings board** (`findings-board`).
   - EXPECT: the weak-credential finding renders with severity high,
     confidence confirmed, evidence-ref count 1; the triage queue orders it
     first; the remediation section shows the proposal at
     `proposed-awaiting-approval` (evidence-gated — never "done").
   - RECORD: screenshot, rendered severity, remediation stage.

2. **Drill into the evidence chain** (`evidence-chain`, via the finding's
   evidence ref).
   - EXPECT: two chain entries with per-entry digests; the REAL
     verification outcome rendered verbatim ("chain verified"); the A13
     traceability links visible (actor → intent → authorization →
     execution → verification → capability_version).

3. **Open the Guardian decision view** (`guardian-decision`).
   - EXPECT: the rule catalog with applicability summaries; the capability
     ceiling board carries the machine-readable marker
     "ceilings are NOT authorizations"; NO authorized/verdict field on any
     ceiling entry.

4. **Trigger the action intent** (UI event
   `security.findings.request-remediation` on the findings board).
   - EXPECT: the intent produces an inert draft card ("request queued for
     Guardian adjudication" wording — never "remediation applied"); the
     draft carries the intent reason; no success claim.
   - The TL binding submits the draft through the control-plane
     `CommandQueue.submit`; the Guardian adjudicates.

5. **Open action authorization** (`action-authorization`).
   - EXPECT: the plan board shows the step with its real queue status
     (queued/in-flight/completed — the REAL state, whatever it is);
     dead-letter visibility if any step dead-lettered; the authorization
     state per step is visible.

6. **Open execution results + audit trail** (`execution-results`).
   - EXPECT: the execution ledger entries in order with digests; the ledger
     verification outcome verbatim; the action audit trail events; the
     replay summary. If verification failed, it renders as failed.

7. **Open inspect-why** (`inspect-why`).
   - EXPECT: the Guardian block (verdict REQUIRE_APPROVAL → after approval
     ALLOW) with its decision digest; the reason chain (matched rule, facts);
     the grants in force; the journal slice; evidence refs; the
     chain-digest-covered provenance.

8. **Return to the findings board.**
   - EXPECT: the remediation has advanced only as far as its evidence gates
     allow (approval ref → verification evidence → verified outcome). If
     any gate is missing, the stage shows the honest awaiting state.

## Negative checks (run in the same session)

- With an analyst session (no `human.approval`): the high-risk intent
  escalates visibly ("requires human approval"); the irreversible action
  renders BLOCKED with the fail-closed policy reason; no authorized command
  is created.
- An unknown capability (no matching rule) renders denied fail-closed
  (`block.no_matching_rule`).

## Pass criteria

Every consequential action visibly communicates authorization and
verification state; no fabricated success; refusals render with their
reason codes; the full chain finding → evidence → decision → intent →
execution → verification → audit is navigable.
