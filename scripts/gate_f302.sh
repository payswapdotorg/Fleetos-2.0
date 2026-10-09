#!/usr/bin/env bash
# gate_f302.sh — the F302 clean-checkout release-gate runner (TL).
# Usage: gate_f302.sh <clean-checkout-dir> [log-file]
# Runs every gate from the handoff in order, capturing command + counts.
# A gate FAILS the run immediately unless prefixed SKIP (none are skippable
# silently — a skip must be recorded as a named blocker in the verdict).
set -uo pipefail

DIR="${1:?usage: gate_f302.sh <clean-checkout-dir> [log-file]}"
LOG="${2:-/tmp/f302_gates.log}"
cd "$DIR" || exit 2

run_gate() {
  local name="$1"; shift
  echo "=== GATE: $name ===" | tee -a "$LOG"
  echo "\$ $*" | tee -a "$LOG"
  if "$@" >>"$LOG" 2>&1; then
    echo "GATE OK: $name" | tee -a "$LOG"
    return 0
  else
    echo "GATE FAILED: $name (see $LOG)" | tee -a "$LOG"
    return 1
  fi
}

: > "$LOG"
echo "F302 gates at $(git rev-parse HEAD 2>/dev/null || echo unknown) — $(date -u)" | tee -a "$LOG"

FAIL=0
run_gate install-frozen   corepack pnpm install --frozen-lockfile || FAIL=1
run_gate source-of-truth  corepack pnpm fleetos:source-of-truth || FAIL=1
run_gate snapshot-check   corepack pnpm fleetos:snapshot:check || FAIL=1
run_gate architecture    corepack pnpm run architecture:check || FAIL=1
run_gate lint             corepack pnpm lint || FAIL=1
run_gate typecheck        corepack pnpm typecheck || FAIL=1
run_gate monorepo-tests   corepack pnpm -r test || FAIL=1

# The six acceptance suites (explicit, per the handoff — after any change).
for suite in field security commerce adoption release convergence; do
  if [ -d "packages/acceptance/$suite" ]; then
    run_gate "acceptance-$suite" sh -c "cd packages/acceptance/$suite && corepack pnpm run test" || FAIL=1
  else
    echo "GATE FAILED: acceptance-$suite (package missing)" | tee -a "$LOG"; FAIL=1
  fi
done

run_gate build            corepack pnpm build || FAIL=1

echo | tee -a "$LOG"
if [ "$FAIL" = "0" ]; then
  echo "F302 VERDICT INPUT: all gates green at $(git rev-parse HEAD)" | tee -a "$LOG"
else
  echo "F302 VERDICT INPUT: FAILURES PRESENT — see $LOG" | tee -a "$LOG"
fi
exit "$FAIL"
