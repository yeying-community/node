#!/usr/bin/env bash
set -euo pipefail

API_URL="${API_URL:-http://localhost:8100}"
SSE_URL="${SSE_URL:-$API_URL}"
TOKEN="${TOKEN:?Missing TOKEN (UCAN/JWT)}"
IDENTITY="${IDENTITY:?Missing IDENTITY (did:pkh:eth:0x...)}"

SESSION_ID="${SESSION_ID:-}"
if [[ -z "$SESSION_ID" ]]; then
  SESSION_ID="$(python - <<'PY'
import uuid
print(uuid.uuid4())
PY
)"
fi

WALLET_ID="${WALLET_ID:-mpc_wallet_01}"
PARTICIPANTS_JSON="${PARTICIPANTS_JSON:-[\"p1\"]}"
PARTICIPANT_ID="${PARTICIPANT_ID:-p1}"
DEVICE_ID="${DEVICE_ID:-dev_1}"

TMP_LOG="$(mktemp)"
cleanup() {
  if [[ -n "${SSE_PID:-}" ]]; then
    kill "$SSE_PID" >/dev/null 2>&1 || true
  fi
  rm -f "$TMP_LOG"
}
trap cleanup EXIT

echo "Opening SSE stream on $SSE_URL ..."
curl -N -s \
  -H "Authorization: Bearer $TOKEN" \
  "$SSE_URL/api/v1/public/mpc/ws?sessionId=$SESSION_ID" > "$TMP_LOG" &
SSE_PID=$!

sleep 1

echo "Creating session $SESSION_ID ..."
curl -s \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"id\": \"$SESSION_ID\",
    \"type\": \"keygen\",
    \"walletId\": \"$WALLET_ID\",
    \"threshold\": 1,
    \"participants\": $PARTICIPANTS_JSON,
    \"curve\": \"secp256k1\",
    \"expiresAt\": \"\"
  }" \
  "$API_URL/api/v1/public/mpc/sessions" >/dev/null

echo "Joining session ..."
curl -s \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"participantId\": \"$PARTICIPANT_ID\",
    \"deviceId\": \"$DEVICE_ID\",
    \"identity\": \"$IDENTITY\",
    \"e2ePublicKey\": \"x25519:base64(dummy)\"
  }" \
  "$API_URL/api/v1/public/mpc/sessions/$SESSION_ID/join" >/dev/null

echo "Sending message ..."
curl -s \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"message\": {
      \"id\": \"msg_01\",
      \"from\": \"$PARTICIPANT_ID\",
      \"round\": 1,
      \"type\": \"sign_round_1\",
      \"seq\": 1,
      \"envelope\": {\"enc\":\"x25519-aes-gcm\",\"ciphertext\":\"dummy\"}
    }
  }" \
  "$API_URL/api/v1/public/mpc/sessions/$SESSION_ID/messages" >/dev/null

sleep 2

if grep -q "event: message" "$TMP_LOG"; then
  echo "SSE smoke test: OK"
else
  echo "SSE smoke test: FAILED"
  echo "Captured SSE output:"
  cat "$TMP_LOG"
  exit 1
fi
