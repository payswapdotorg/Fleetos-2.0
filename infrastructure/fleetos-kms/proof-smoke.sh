#!/usr/bin/env bash
# KMS smoke test (F373) — boots the real service, drives the API, SIGKILLs,
# restarts, verifies recovery. Development smoke only (the journeys are the
# machine evidence).
set -u
cd /home/z/Fleetos-2.0/infrastructure/fleetos-kms
SMOKE_DIR=$(mktemp -d)
export FLEETOS_KMS_PORT=0
export FLEETOS_KMS_DATA="$SMOKE_DIR"
export FLEETOS_KMS_MASTER_KEY=aa112233445566778899aabbccddeeff00112233445566778899aabbccddeeff
export FLEETOS_KMS_RANDOM_STREAM='["feed0000beef0000feed0000beef0000feed0000beef0000feed0000beef0000","c0ffee00c0ffee00","00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff","deadbeefdeadbeef","cafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabe"]'

start_kms() {
  node --experimental-transform-types --no-warnings --import /home/z/Fleetos-2.0/infrastructure/fleetos-kms/runtime.mjs /home/z/Fleetos-2.0/infrastructure/fleetos-kms/service.ts > "$SMOKE_DIR/boot-$1.log" 2>&1 &
  KMS_PID=$!
  for _ in $(seq 1 100); do
    PORT=$(grep -o 'listening on :[0-9]*' "$SMOKE_DIR/boot-$1.log" 2>/dev/null | grep -o '[0-9]*$')
    [ -n "$PORT" ] && break
    sleep 0.1
  done
}
start_kms 1
BASE="http://127.0.0.1:$PORT"
echo "== boot1 port=$PORT =="
echo "-- unauthenticated current:"; curl -s "$BASE/api/keys/current?now=1000"; echo
echo "-- provision:"; curl -s -X POST "$BASE/api/admin/credentials" -H 'content-type: application/json' -d '{"adminId":"admin-smoke","secret":"smoke-secret-01","now":1000}'; echo
echo "-- login wrong (enumeration-resistant):"; curl -s -X POST "$BASE/api/session" -H 'content-type: application/json' -d '{"adminId":"ghost-admin","secret":"WRONG","now":2000,"ttlMs":60000}'; echo
TOKEN=$(curl -s -X POST "$BASE/api/session" -H 'content-type: application/json' -d '{"adminId":"admin-smoke","secret":"smoke-secret-01","now":2000,"ttlMs":600000,"jti":"jti-smoke-1"}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])')
echo "-- token minted: ${TOKEN:0:24}..."
echo "-- create:"; curl -s -X POST "$BASE/api/keys/create" -H 'content-type: application/json' -H "authorization: Bearer $TOKEN" -d '{"now":3000}'; echo
echo "-- current+list:"; curl -s "$BASE/api/keys/current?now=3000" -H "authorization: Bearer $TOKEN"; curl -s "$BASE/api/keys?now=3000" -H "authorization: Bearer $TOKEN"; echo
echo "-- resolve k1:"; curl -s -X POST "$BASE/api/keys/resolve" -H 'content-type: application/json' -H "authorization: Bearer $TOKEN" -d '{"keyId":"c0ffee00c0ffee00","now":3000}'; echo
echo "-- rotate:"; curl -s -X POST "$BASE/api/keys/rotate" -H 'content-type: application/json' -H "authorization: Bearer $TOKEN" -d '{"now":4000,"verifyGraceMs":600000}'; echo
echo "-- audit:"; curl -s "$BASE/api/audit?now=5000" -H "authorization: Bearer $TOKEN" | python3 -c 'import json,sys; [print(e) for e in json.load(sys.stdin)["entries"]]'
echo "-- tampered admin token:"; curl -s "$BASE/api/keys?now=3000" -H "authorization: Bearer ${TOKEN:0:20}X${TOKEN:21}"; echo
echo "-- expired admin session:"; curl -s "$BASE/api/keys?now=99999999" -H "authorization: Bearer $TOKEN"; echo
echo "-- state file scan for plaintext material (expect CLEAN):"
if grep -qE "cafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabe|00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff|smoke-secret-01|feed0000beef0000" "$SMOKE_DIR/kms-state.json"; then echo "LEAK!"; else echo "CLEAN"; fi
echo "-- audit file scan (expect CLEAN):"
if grep -qE "cafebabecafebabe|smoke-secret|feed0000beef" "$SMOKE_DIR/kms-audit.jsonl"; then echo "LEAK!"; else echo "CLEAN"; fi
echo "== SIGKILL ($KMS_PID) + restart =="
kill -9 "$KMS_PID"; wait "$KMS_PID" 2>/dev/null; sleep 0.3
start_kms 2
BASE2="http://127.0.0.1:$PORT"
echo "-- boot2 recovery (health):"; curl -s "$BASE2/api/health"; echo
echo "-- post-crash resolve of k1 (material recovered from envelope):"; curl -s -X POST "$BASE2/api/keys/resolve" -H 'content-type: application/json' -H "authorization: Bearer $TOKEN" -d '{"keyId":"c0ffee00c0ffee00","now":6000}'; echo
echo "-- post-crash current (should be the rotated-in key):"; curl -s "$BASE2/api/keys/current?now=6000" -H "authorization: Bearer $TOKEN"; echo
echo "-- post-crash audit entry count:"; curl -s "$BASE2/api/audit?now=6000" -H "authorization: Bearer $TOKEN" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["entries"]))'
kill -9 "$KMS_PID" 2>/dev/null; wait "$KMS_PID" 2>/dev/null
rm -rf "$SMOKE_DIR"
echo "== smoke done =="
