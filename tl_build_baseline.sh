#!/usr/bin/env bash
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/z/fleetos2
{
echo "--- build:bootstrap $(date -u +%FT%TZ) ---"
pnpm run build:bootstrap 2>&1 | tail -12
echo "=== BUILD DONE $(date -u +%FT%TZ) rc=$? ==="
} >> tl_baseline.log 2>&1
