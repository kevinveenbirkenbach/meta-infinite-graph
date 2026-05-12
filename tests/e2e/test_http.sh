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

status="$(curl -sS -o "${TMP_DIR}/list.json" -w '%{http_code}' "${BASE_URL}/roles/list.json")"
if [[ "${status}" != "200" ]]; then
  echo "[e2e] Expected /roles/list.json to return 200, got ${status}" >&2
  exit 1
fi

python3 - "${TMP_DIR}/list.json" "${BASE_URL}" <<'PY'
import json
import sys
import urllib.parse
import urllib.request

list_path = sys.argv[1]
base_url = sys.argv[2]

with open(list_path, "r", encoding="utf-8") as fh:
    roles = json.load(fh)

if not isinstance(roles, list) or not roles:
    raise SystemExit("[e2e] roles/list.json is empty or invalid")

first_role = roles[0]
if not isinstance(first_role, str) or not first_role:
    raise SystemExit("[e2e] First role entry is not a non-empty string")

encoded_role = urllib.parse.quote(first_role, safe="")
tree_url = f"{base_url}/roles/{encoded_role}/meta/tree.json"
with urllib.request.urlopen(tree_url, timeout=30) as response:
    if response.status != 200:
        raise SystemExit(f"[e2e] tree endpoint status was {response.status}")
    tree = json.load(response)

if not isinstance(tree, dict) or not tree:
    raise SystemExit("[e2e] tree.json payload is empty or invalid")

print(f"[e2e] Verified role tree for '{first_role}' ({len(tree)} top-level keys)")
PY

echo "[e2e] All checks passed"
