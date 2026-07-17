#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8000}"
WAIT_SECONDS="${WAIT_SECONDS:-90}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

echo "[e2e] Waiting for ${BASE_URL}"
status=""
for _ in $(seq 1 "${WAIT_SECONDS}"); do
  status="$(curl -s -o "${TMP_DIR}/index.html" -w '%{http_code}' "${BASE_URL}/" || true)"
  if [[ "${status}" == "200" ]]; then
    break
  fi
  sleep 1
done

if [[ "${status}" != "200" ]]; then
  echo "[e2e] App did not become ready (last status: ${status})" >&2
  exit 1
fi

grep -q "Meta Infinite Graph" "${TMP_DIR}/index.html"

status="$(curl -sS -o "${TMP_DIR}/roles.json" -w '%{http_code}' "${BASE_URL}/roles/")"
if [[ "${status}" != "200" ]]; then
  echo "[e2e] Expected /roles/ autoindex to return 200, got ${status}" >&2
  exit 1
fi

python3 - "${TMP_DIR}/roles.json" "${BASE_URL}" <<'PY'
import json
import sys
import urllib.error
import urllib.parse
import urllib.request

listing_path = sys.argv[1]
base_url = sys.argv[2]

with open(listing_path, "r", encoding="utf-8") as fh:
    entries = json.load(fh)

roles = [e["name"] for e in entries if e.get("type") == "directory"]
if not roles:
    raise SystemExit("[e2e] /roles/ autoindex lists no role directories")

for role in roles:
    encoded = urllib.parse.quote(role, safe="")
    url = f"{base_url}/roles/{encoded}/meta/main.yml"
    try:
        with urllib.request.urlopen(url, timeout=30) as response:
            if response.status == 200 and response.read().strip():
                print(f"[e2e] scanned meta/main.yml of '{role}'")
                break
    except urllib.error.HTTPError:
        continue
else:
    raise SystemExit("[e2e] No role exposed a readable meta/main.yml")
PY

echo "[e2e] All checks passed"
