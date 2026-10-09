# Browser Journey 4 — Refusals, tenant fail-closed, honest empty states

**Persona:** security-analyst (analyst-kim, acme-ops) + a rival-tenant
session (globex-rival).
**Routes:** findings-board · host-surface shell states.
**Machine-run twin:** `security.host-surface` + `security.tenant-fail-closed`
(acceptance corpus, journeys 17 + 13).

## Steps

1. **Open the findings board as the analyst.**
   - EXPECT: the tenant's findings render; the surface identity is visible
     (FleetOS product identity, safety-intel surface).

2. **Probe a cross-tenant record** (rival-tenant finding injected into the
   composed state by the TL's test fixture, or a direct cross-tenant URL).
   - EXPECT: the WHOLE view refuses — the refusal names the offending route
     (`findings-board`) and code (`views.cross-tenant-finding`) with the
     offender finding + tenant named. NO partial state, no silent filter.
   - The same fail-closed behavior holds for a cross-tenant prediction on
     the advisory route (`advisory.cross-tenant-prediction`) and a
     cross-tenant policy on the Guardian route.

3. **Open an uncomposed section** (a state slice without the plan/action —
   the TL test fixture's "fresh tenant").
   - EXPECT: the action-authorization route renders its honest
     not-composed marker ("no plan composed"), the inspect-why route
     likewise; the advisory board with zero inputs renders the honest
     empty state (advisory marker still carried). No fabricated views, no
     spinners-forever.

4. **Empty tenant context** (session without tenant scope).
   - EXPECT: the surface refuses with `host.missing-tenant` — the shell
     renders the authentication/tenant-scope prompt, never an empty
     dashboard that looks like "no findings".

5. **Malformed context** (empty actor/session ids from a broken session).
   - EXPECT: `host.invalid-context` refusal rendered.

## Pass criteria

Every refusal state is honest, named, and complete (no partial state);
empty ≠ error ≠ refusal are all distinct renderings; the tenant boundary
is closed at the HOST surface, not just in the domain.
