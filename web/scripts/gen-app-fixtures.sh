#!/bin/sh
# Regenerate the mock build's app fixtures from the real backend and the
# synthetic demo data, so the mock and the server agree. Run from web/:
#   sh scripts/gen-app-fixtures.sh
set -eu
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
OUT="$ROOT/web/src/mock/fixtures"
TMP=$(mktemp -d)
PORT=17399
trap 'kill $PID 2>/dev/null || true; rm -rf "$TMP"' EXIT
(cd "$ROOT" && go build -o "$TMP/aftertrace" ./cmd/aftertrace)
"$TMP/aftertrace" demo --db "$TMP/demo.duckdb" >/dev/null 2>&1
"$TMP/aftertrace" serve --db "$TMP/demo.duckdb" --grpc-port 17397 --http-port 17398 --ui-port $PORT >/dev/null 2>&1 &
PID=$!
for _ in 1 2 3 4 5 6 7 8 9 10; do curl -sf -m 60 "http://127.0.0.1:$PORT/api/status" >/dev/null && break; sleep 0.5; done
mkdir -p "$OUT/apps"
curl -sf -m 60 "http://127.0.0.1:$PORT/api/apps" > "$OUT/apps.json"
curl -sf -m 60 "http://127.0.0.1:$PORT/api/findings" > "$TMP/findings.json"
python3 - "$OUT" "$TMP" "$PORT" <<'PY'
import json, sys, urllib.parse, urllib.request
out, tmp, port = sys.argv[1], sys.argv[2], sys.argv[3]
get = lambda p: json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}{p}"))
apps = json.load(open(f"{out}/apps.json"))
traces = set()
for a in apps:
    d = get("/api/app/" + urllib.parse.quote(a["service"]))
    json.dump(d, open(f"{out}/apps/{a['service']}.json", "w"))
    traces |= {r["trace_id"] for r in d["recent"][:15]} | {e["trace_id"] for e in d["errors"]}
# App findings, appended after the hand-kept Claude Code ones so their ids stay put.
mock = json.load(open(f"{out}/findings.json"))
mock = [f for f in mock if not f["rule_id"].startswith("app.")]
nxt = max(f["id"] for f in mock) + 1
remap = {}
for f in json.load(open(f"{tmp}/findings.json")):
    if f["rule_id"].startswith("app."):
        remap[f["id"]] = nxt
        f["id"] = nxt
        nxt += 1
        mock.append(f)
json.dump(mock, open(f"{out}/findings.json", "w"), indent=1)
# Span finding ids in traces point at the server's numbering; map them to the mock's.
for t in sorted(traces):
    tr = get(f"/api/trace/{t}")
    for sp in tr["spans"]:
        sp["findings"] = [remap[i] for i in sp.get("findings") or [] if i in remap]
    json.dump(tr, open(f"{out}/traces/{t}.json", "w"))
for wk in (0, 1):
    json.dump(get(f"/api/recap?week={wk}"), open(f"{out}/recap-{wk}.json", "w"))
print(f"{len(apps)} apps, {len(traces)} traces, recap")
PY
