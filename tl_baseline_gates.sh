#!/usr/bin/env bash
# tl_baseline_gates.sh — TL baseline gate run at the exact base commit.
# Usage: run detached; writes logs/tl_baseline.log in the repo.
set -uo pipefail
cd /home/z/fleetos2
LOG=/home/z/fleetos2/tl_baseline.log
{
echo "=== TL BASELINE GATES at $(git rev-parse HEAD) ($(date -u +%FT%TZ)) ==="
echo "--- pnpm install ---"
corepack pnpm install 2>&1 | tail -5
echo "--- fleetos:source-of-truth ---"
corepack pnpm fleetos:source-of-truth 2>&1 | tail -4
echo "--- architecture:check ---"
corepack pnpm architecture:check 2>&1 | tail -15
echo "--- lint ---"
corepack pnpm lint 2>&1 | tail -6
echo "--- typecheck ---"
NODE_OPTIONS=--max-old-space-size=2048 corepack pnpm typecheck 2>&1 | tail -6
echo "--- build (bootstrap variant first for env-safety) ---"
corepack pnpm run build:bootstrap 2>&1 | tail -8
echo "=== BASELINE DONE $(date -u +%FT%TZ) ==="
} >> "$LOG" 2>&1
