#!/bin/sh
# Signed 0.5.4 app + local 0.5.5 fixture feed on a disposable GitHub Mac VM.
# No production tag/release. No ad-hoc resign. No TCC database writes.
#
# Distinguishes shipped v0.5.3 (internal 0.5.0, Download then quitAndInstall)
# from 0.5.4 (download, stay running, explicit Restart).
set -eu

root=$(CDPATH='' cd -- "$(dirname "$0")/../.." && pwd)
ship_dist=$(CDPATH='' cd -- "${1:-$root/desktop/dist}" && pwd)
fixture_dist=$(CDPATH='' cd -- "${2:-$root/desktop/dist-fixture}" && pwd)
base=${RUNNER_TEMP:-${TMPDIR:-/tmp}}
iso=$base/aftertrace-signed-smoke-$$
report=$iso/report.txt
http_pid=""
mkdir -p "$iso"
: >"$report"
log() { printf '%s\n' "$*" | tee -a "$report"; }
copy_report() {
  cp "$report" "$ship_dist/signed-upgrade-smoke.txt" 2>/dev/null || true
  if [ -n "$http_pid" ]; then
    kill "$http_pid" 2>/dev/null || true
  fi
}
trap copy_report EXIT

runner_user=$(whoami)
runner_home=$(dscl . -read "/Users/$runner_user" NFSHomeDirectory 2>/dev/null | awk '{print $2}')
if [ -z "$runner_home" ]; then
  runner_home="/Users/$runner_user"
fi
log "runner_user=$runner_user runner_home=$runner_home"
log "GITHUB_ACTIONS=${GITHUB_ACTIONS-} RUNNER_NAME=${RUNNER_NAME-} RUNNER_ENVIRONMENT=${RUNNER_ENVIRONMENT-}"
log "isolate=$iso"
if [ "${GITHUB_ACTIONS:-}" != "true" ]; then
  echo "refusing: not a GitHub Actions runner (disposable VM only)" >&2
  exit 1
fi
case "$runner_home" in
  /Users/runner|/Users/runner/*|/Users/runneradmin|/Users/runneradmin/*) ;;
  *)
    echo "refusing: NFSHomeDirectory $runner_home is not a GitHub-hosted runner home" >&2
    exit 1
    ;;
esac

plist_version() {
  /usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$1/Contents/Info.plist"
}

assert_no_runner_writes() {
  support="$runner_home/Library/Application Support/Aftertrace"
  if [ -e "$support" ]; then
    log "FAIL: wrote $support"
    find "$support" -maxdepth 3 -print | tee -a "$report" || true
    exit 1
  fi
  leak="$runner_home/.aftertrace"
  if [ -e "$leak" ]; then
    files=$(find "$leak" -type f -print 2>/dev/null || true)
    if [ -n "$files" ]; then
      log "FAIL: runner-home .aftertrace has files (engine data must stay under AFTERTRACE_HOME)"
      printf '%s\n' "$files" | tee -a "$report"
      exit 1
    fi
    log "note: empty $leak exists; helpers/--db/userData are isolated (see status.json)"
  fi
}

# --- 0.5.3 old updater evidence (read-only on the published signed zip) ---
log "== shipped v0.5.3 (app 0.5.0) =="
old_zip=$iso/published/Aftertrace-mac-arm64.zip
mkdir -p "$iso/published"
if [ ! -f "$old_zip" ]; then
  gh release download v0.5.3 --repo RahulKraken/aftertrace --pattern 'Aftertrace-mac-arm64.zip' --dir "$iso/published"
fi
mkdir -p "$iso/published/app"
unzip -q "$old_zip" -d "$iso/published/app"
old_app=""
for cand in "$iso/published/app/Aftertrace.app" "$iso/published/app/mac-arm64/Aftertrace.app" "$iso/published/app/mac/Aftertrace.app"; do
  if [ -d "$cand" ]; then
    old_app=$cand
    break
  fi
done
[ -n "$old_app" ]
old_ver=$(plist_version "$old_app")
log "published plist=$old_ver"
[ "$old_ver" = "0.5.0" ]
asar=$old_app/Contents/Resources/app.asar
python3 - "$asar" "$report" <<'PY'
import sys
data = open(sys.argv[1], "rb").read()
lines = []
lines.append("v0.5.3 asar autoRunAppAfterInstall true: %s" % (b"autoRunAppAfterInstall = true" in data or b"autoRunAppAfterInstall=true" in data))
lines.append("v0.5.3 asar quitAndInstall() present: %s" % (b"quitAndInstall()" in data))
lines.append("v0.5.3 asar autoDownload = false: %s" % (b"autoDownload = false" in data or b"autoDownload=false" in data))
open(sys.argv[2], "a", encoding="utf8").write("\n".join(lines) + "\n")
print("\n".join(lines))
PY
log "old behavior: interactive Download then quitAndInstall immediately; background check does not download. This smoke does not click Download (that would install)."
xattr -dr com.apple.quarantine "$old_app" 2>/dev/null || true
codesign -v "$old_app"
if codesign -dv --verbose=4 "$old_app" 2>&1 | grep -q "Signature=adhoc"; then
  log "FAIL: published v0.5.3 is ad-hoc; refusing to treat that as shipping evidence"
  exit 1
fi
# Do not launch the published 0.5.0 binary here. It has no AFTERTRACE_HOME
# and Cocoa NSHomeDirectory ignores HOME, so the engine/helpers write
# /Users/runner/.aftertrace and keep the dir busy after the main pid dies
# (Desktop 42362486448 launched it: stayed running, then leaked; 42363302397
# could not rm the leak). asar + codesign above is the old-behavior evidence.
# 0.5.4 is the live upgrade under explicit paths.
log "v0.5.3 not launched (Cocoa home leak on 0.5.0); asar/codesign recorded"

# --- 0.5.4 → CI fixture 0.5.5 ---
log "== 0.5.4 plus local 0.5.5 fixture feed =="
ship_app=""
for cand in "$ship_dist"/mac-arm64/Aftertrace.app "$ship_dist"/mac/Aftertrace.app; do
  if [ -d "$cand" ]; then
    ship_app=$cand
    break
  fi
done
[ -n "$ship_app" ]
ship_ver=$(plist_version "$ship_app")
log "shipping plist=$ship_ver"
[ "$ship_ver" = "0.5.4" ]
codesign -v "$ship_app"
if ! codesign -dv --verbose=4 "$ship_app" 2>&1 | tee -a "$report" | grep -q "Developer ID Application"; then
  log "skip: shipping app is not Developer ID signed"
  cp "$report" "$ship_dist/signed-upgrade-smoke.txt"
  exit 0
fi
if [ ! -f "$fixture_dist/Aftertrace-mac-arm64.zip" ] || [ ! -f "$fixture_dist/latest-mac.yml" ]; then
  log "skip: CI fixture zip missing (unsigned pack or fixture step skipped)"
  cp "$report" "$ship_dist/signed-upgrade-smoke.txt"
  exit 0
fi
grep -q "version: 0.5.5" "$fixture_dist/latest-mac.yml"
new_asar=$ship_app/Contents/Resources/app.asar
python3 - "$new_asar" "$report" <<'PY'
import sys
data = open(sys.argv[1], "rb").read()
lines = []
lines.append("0.5.4 asar autoRunAppAfterInstall false: %s" % (b"autoRunAppAfterInstall = false" in data or b"autoRunAppAfterInstall=false" in data))
open(sys.argv[2], "a", encoding="utf8").write("\n".join(lines) + "\n")
print("\n".join(lines))
PY

appdir=$iso/current
mkdir -p "$appdir"
ditto "$ship_app" "$appdir/Aftertrace.app"
xattr -dr com.apple.quarantine "$appdir/Aftertrace.app" 2>/dev/null || true
codesign -v "$appdir/Aftertrace.app"

iso_home=$iso/home
user_data="$iso_home/Library/Application Support/Aftertrace"
engine_home=$iso_home/.aftertrace
smoke_dir=$iso/smoke
mkdir -p "$iso_home" "$user_data" "$engine_home" "$iso/tmp" "$smoke_dir"
echo "retain-054" >"$engine_home/marker.txt"
echo '{"firstLaunchDone":true,"openAtLogin":false}' >"$user_data/desktop.json"

port=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')
python3 -m http.server "$port" --bind 127.0.0.1 --directory "$fixture_dist" >/tmp/aftertrace-feed-http.log 2>&1 &
http_pid=$!
sleep 1
curl -fsS "http://127.0.0.1:$port/latest-mac.yml" | head -n 5 | tee -a "$report"

export HOME="$iso_home"
export TMPDIR="$iso/tmp"
export AFTERTRACE_HOME="$engine_home"
export AFTERTRACE_USER_DATA_DIR="$user_data"
export AFTERTRACE_SMOKE=1
export AFTERTRACE_SMOKE_DIR="$smoke_dir"
export AFTERTRACE_UPDATE_FEED_URL="http://127.0.0.1:${port}/"

"$appdir/Aftertrace.app/Contents/MacOS/Aftertrace" --hidden \
  --user-data-dir="$user_data" \
  >"$iso/app.stdout" 2>"$iso/app.stderr" &
new_pid=$!
log "launched 0.5.4 pid=$new_pid"

i=0
while [ "$i" -lt 40 ]; do
  if [ -f "$smoke_dir/status.json" ]; then
    break
  fi
  i=$((i + 1))
  sleep 1
done
[ -f "$smoke_dir/status.json" ]
log "status after boot:"
tee -a "$report" <"$smoke_dir/status.json"
grep -q "$engine_home" "$smoke_dir/status.json"
grep -q "$user_data" "$smoke_dir/status.json"
grep -q "$iso_home" "$smoke_dir/status.json"
pgrep -lf Aftertrace | tee -a "$report" || true
kill -0 "$new_pid"
echo check >"$smoke_dir/cmd"

ready=0
i=0
while [ "$i" -lt 90 ]; do
  if [ -f "$smoke_dir/status.json" ] && grep -q '"status": "ready"' "$smoke_dir/status.json"; then
    ready=1
    break
  fi
  if ! kill -0 "$new_pid" 2>/dev/null; then
    log "FAIL: process exited during download"
    tail -n 80 "$iso/app.stderr" | tee -a "$report" || true
    exit 1
  fi
  i=$((i + 1))
  sleep 1
done
[ "$ready" = 1 ]
log "download ready; process still pid=$new_pid"
kill -0 "$new_pid"
tee -a "$report" <"$smoke_dir/status.json"
assert_no_runner_writes
[ -f "$engine_home/marker.txt" ]
grep -q retain-054 "$engine_home/marker.txt"

echo restart >"$smoke_dir/cmd"
log "sent explicit Restart"

i=0
while [ "$i" -lt 60 ]; do
  if ! kill -0 "$new_pid" 2>/dev/null; then
    break
  fi
  i=$((i + 1))
  sleep 1
done
if kill -0 "$new_pid" 2>/dev/null; then
  log "FAIL: pid $new_pid still running after Restart"
  exit 1
fi
log "old pid $new_pid gone"

i=0
while [ "$i" -lt 60 ]; do
  now=$(plist_version "$appdir/Aftertrace.app")
  if [ "$now" = "0.5.5" ]; then
    break
  fi
  i=$((i + 1))
  sleep 1
done
now=$(plist_version "$appdir/Aftertrace.app")
log "replacement plist=$now"
[ "$now" = "0.5.5" ]
codesign -v "$appdir/Aftertrace.app"
test -f "$appdir/Aftertrace.app/Contents/Resources/engine/aftertrace"
[ -f "$engine_home/marker.txt" ]
grep -q retain-054 "$engine_home/marker.txt"
assert_no_runner_writes

# Relaunch the replacement ourselves if autoRunAppAfterInstall stayed false
# (shipping 0.5.4). That is the new behavior: install does not force a start.
unset AFTERTRACE_UPDATE_FEED_URL
"$appdir/Aftertrace.app/Contents/MacOS/Aftertrace" --hidden \
  --user-data-dir="$user_data" \
  >"$iso/relaunch.stdout" 2>"$iso/relaunch.stderr" &
rel_pid=$!
sleep 8
if kill -0 "$rel_pid" 2>/dev/null; then
  log "relaunch pid=$rel_pid version=0.5.5 still running"
  if [ -f "$smoke_dir/status.json" ]; then
    tee -a "$report" <"$smoke_dir/status.json"
  fi
  kill "$rel_pid" 2>/dev/null || true
  wait "$rel_pid" 2>/dev/null || true
else
  log "relaunch exited; stderr:"
  tail -n 40 "$iso/relaunch.stderr" | tee -a "$report" || true
fi
[ -f "$engine_home/marker.txt" ]
assert_no_runner_writes

log "== GUI: Dock open/close/reopen + native NSMenu/glyph (not System Events process list alone) =="
# Hardened runtime typically disables nodeCliInspect. Native: file-protocol
# smoke cmds + Dock AX tiles + screencapture of NSMenu via popUpContextMenu.
# An open NSMenu is not live-updated; labels rebuild on the next open.
pgrep -x WindowServer >/dev/null 2>&1 || {
  log "FAIL: WindowServer not running; Aqua Dock/NSMenu cannot be asserted"
  exit 1
}
pgrep -x Dock >/dev/null 2>&1 || {
  log "FAIL: Dock process not running"
  exit 1
}
export AFTERTRACE_UPDATE_FEED_URL="http://127.0.0.1:${port}/"
rm -f "$smoke_dir/status.json" "$smoke_dir/cmd"
"$appdir/Aftertrace.app/Contents/MacOS/Aftertrace" --hidden \
  --user-data-dir="$user_data" \
  >"$iso/gui.stdout" 2>"$iso/gui.stderr" &
gui_pid=$!
log "gui pid=$gui_pid (hidden; tray+engine only)"

dock_names() {
  osascript -e 'tell application "System Events" to tell process "Dock" to get name of UI elements of list 1' 2>/dev/null || true
}
fg_names() {
  osascript -e 'tell application "System Events" to get name of every process whose background only is false' 2>/dev/null || true
}
has_aftertrace() {
  printf '%s\n' "$1" | grep -E '(^|, )Aftertrace(,|$)' >/dev/null 2>&1
}
engine_alive() {
  pgrep -f "serve --db" >/dev/null 2>&1 || pgrep -f "aftertrace.duckdb" >/dev/null 2>&1
}
assert_engine_and_tray() {
  kill -0 "$gui_pid" || {
    log "FAIL: Aftertrace pid $gui_pid is gone"
    exit 1
  }
  engine_alive || {
    log "FAIL: engine not running while tray should be alive"
    pgrep -lf aftertrace | tee -a "$report" || true
    exit 1
  }
}
wait_gui_ready() {
  j=0
  while [ "$j" -lt 40 ]; do
    if [ -f "$smoke_dir/status.json" ] && grep -q "\"pid\": $gui_pid," "$smoke_dir/status.json"; then
      if engine_alive; then
        log "gui ready pid=$gui_pid"
        return 0
      fi
    fi
    j=$((j + 1))
    sleep 1
  done
  log "FAIL: gui pid $gui_pid did not publish status + engine"
  if [ -f "$smoke_dir/status.json" ]; then
    tee -a "$report" <"$smoke_dir/status.json"
  fi
  pgrep -lf aftertrace | tee -a "$report" || true
  exit 1
}
wait_dock() {
  want=$1
  label=$2
  j=0
  while [ "$j" -lt 20 ]; do
    tiles=$(dock_names)
    fg=$(fg_names)
    log "Dock tiles ($label): $tiles"
    log "foreground ($label): $fg"
    if [ "$want" = "in" ]; then
      if has_aftertrace "$tiles" && has_aftertrace "$fg"; then
        return 0
      fi
    else
      if ! has_aftertrace "$tiles" && ! has_aftertrace "$fg"; then
        return 0
      fi
    fi
    j=$((j + 1))
    sleep 1
  done
  log "FAIL: Aftertrace Dock/app-switcher $label (want $want)"
  exit 1
}
click_allow() {
  osascript -e 'tell application "System Events" to tell (first process whose name contains "UserNotificationCenter") to click button "Allow" of window 1' >/dev/null 2>&1 || true
}
capture_rect() {
  dest=$1
  x=$2
  y=$3
  w=$4
  h=$5
  if [ -n "$w" ] && [ "$w" -gt 8 ] && [ "$h" -gt 8 ]; then
    screencapture -x -R"${x},${y},${w},${h}" "$dest" || screencapture -x "$dest"
  else
    screencapture -x "$dest"
  fi
}
bounds_from_status() {
  python3 - "$smoke_dir/status.json" "$1" <<'PY'
import json, sys
path, key = sys.argv[1], sys.argv[2]
try:
    data = json.load(open(path, encoding="utf-8"))
except Exception:
    sys.exit(1)
b = data.get(key) or {}
if not isinstance(b, dict):
    sys.exit(1)
x, y, w, h = b.get("x"), b.get("y"), b.get("width"), b.get("height")
if None in (x, y, w, h):
    sys.exit(1)
print(f"{int(x)} {int(y)} {int(w)} {int(h)}")
PY
}

wait_gui_ready
assert_engine_and_tray
wait_dock out "hidden boot"
click_allow
screencapture -x "$iso/native-dock-closed-boot.png"

echo dashboard >"$smoke_dir/cmd"
wait_dock in "dashboard open"
assert_engine_and_tray
click_allow
screencapture -x "$iso/native-dock-open.png"

appearance=$(defaults read -g AppleInterfaceStyle 2>/dev/null || echo Light)
log "0.5.5 fixture AppleInterfaceStyle=$appearance (menu capture waits for notarized 0.5.4 head app)"
tb=$(bounds_from_status trayBounds) || {
  log "FAIL: trayBounds missing from status.json"
  tee -a "$report" <"$smoke_dir/status.json" || true
  exit 1
}
tx=$(printf '%s\n' "$tb" | awk '{print $1}')
ty=$(printf '%s\n' "$tb" | awk '{print $2}')
tw=$(printf '%s\n' "$tb" | awk '{print $3}')
th=$(printf '%s\n' "$tb" | awk '{print $4}')
if [ "$tw" -lt 8 ] || [ "$th" -lt 8 ]; then
  log "FAIL: trayBounds too small for a menu extra ($tb)"
  exit 1
fi
if [ "$tw" -gt 64 ]; then
  log "FAIL: tray extra is not icon-only (trayBounds width $tw > 64; setTitle text would shift neighbors)"
  exit 1
fi
log "0.5.5 fixture icon-only trayWidth=$tw (NSMenu with live sessions is captured on the notarized 0.5.4 pack)"
click_allow
screencapture -x "$iso/native-desktop.png"

echo close >"$smoke_dir/cmd"
wait_dock out "dashboard closed"
assert_engine_and_tray
screencapture -x "$iso/native-dock-closed.png"
log "close: Dock/app-switcher empty of Aftertrace; engine+tray pid $gui_pid still alive"

echo dashboard >"$smoke_dir/cmd"
wait_dock in "dashboard reopen"
assert_engine_and_tray
screencapture -x "$iso/native-dock-reopen.png"
log "reopen: Dock/app-switcher restored"

kill "$gui_pid" 2>/dev/null || true
wait "$gui_pid" 2>/dev/null || true
# Drop the 0.5.5 fixture process so OTLP 4318 / UI 7311 are free for the notarized pack.
pkill -f "$appdir/Aftertrace.app" 2>/dev/null || true
pkill -f "$engine_home/aftertrace.duckdb" 2>/dev/null || true
sleep 1

log "== notarized PR-head 0.5.4 NSMenu with synthetic OTel (not Rahul usage) =="
log "GITHUB_SHA=${GITHUB_SHA-} GITHUB_REF=${GITHUB_REF-}"
notarized_app=""
for cand in "$ship_dist"/mac-arm64/Aftertrace.app "$ship_dist"/mac/Aftertrace.app; do
  if [ -d "$cand" ]; then
    notarized_app=$cand
    break
  fi
done
[ -n "$notarized_app" ]
nv=$(plist_version "$notarized_app")
log "notarized-pack plist=$nv (this CI pack identity; not GitHub Release v0.5.4 unless SHA matches a tag)"
[ "$nv" = "0.5.4" ]
codesign -dv --verbose=4 "$notarized_app" 2>&1 | tee -a "$report" | grep -q "Developer ID Application" || {
  log "FAIL: menu capture requires the Developer ID signed pack from this job"
  exit 1
}
cdhash=$(codesign -dv --verbose=4 "$notarized_app" 2>&1 | awk -F= '/^CDHash=/{print $2; exit}')
log "notarized-pack CDHash=$cdhash"
if [ -f "$ship_dist/Aftertrace-mac-notarized.json" ]; then
  log "notarized marker=$(tr -d '\n' < "$ship_dist/Aftertrace-mac-notarized.json")"
else
  log "FAIL: Aftertrace-mac-notarized.json missing; refusing unsigned/unnotarized menu evidence"
  exit 1
fi

menu_home=$iso/menu-home
menu_user="$menu_home/Library/Application Support/Aftertrace"
menu_engine=$menu_home/.aftertrace
menu_smoke=$iso/menu-smoke
menu_appdir=$iso/notarized
mkdir -p "$menu_home" "$menu_user" "$menu_engine" "$menu_smoke" "$menu_appdir"
ditto "$notarized_app" "$menu_appdir/Aftertrace.app"
xattr -dr com.apple.quarantine "$menu_appdir/Aftertrace.app" 2>/dev/null || true
echo '{"firstLaunchDone":true,"openAtLogin":false}' >"$menu_user/desktop.json"
export HOME="$menu_home"
export TMPDIR="$iso/tmp"
export AFTERTRACE_HOME="$menu_engine"
export AFTERTRACE_USER_DATA_DIR="$menu_user"
export AFTERTRACE_SMOKE=1
export AFTERTRACE_SMOKE_DIR="$menu_smoke"
unset AFTERTRACE_UPDATE_FEED_URL

"$menu_appdir/Aftertrace.app/Contents/MacOS/Aftertrace" --hidden \
  --user-data-dir="$menu_user" \
  >"$iso/menu.stdout" 2>"$iso/menu.stderr" &
menu_pid=$!
log "notarized 0.5.4 pid=$menu_pid"
smoke_dir=$menu_smoke
gui_pid=$menu_pid
wait_gui_ready

wait_http() {
  url=$1
  label=$2
  j=0
  while [ "$j" -lt 40 ]; do
    if curl -fsS "$url" >/dev/null 2>&1; then
      log "ok $label $url"
      return 0
    fi
    j=$((j + 1))
    sleep 0.5
  done
  log "FAIL: $label not answering ($url)"
  tail -n 80 "$iso/menu.stderr" | tee -a "$report" || true
  exit 1
}
wait_http "http://127.0.0.1:7311/api/status" "engine /api/status"

echo refresh >"$smoke_dir/cmd"
sleep 1
echo dashboard >"$smoke_dir/cmd"
wait_dock in "notarized dashboard"
click_allow

log "injecting synthetic OTLP fixture (aftertrace.synthetic=true)"
node "$root/desktop/scripts/otlp-menu-fixture.js" --otlp http://127.0.0.1:4318 | tee -a "$report"
live_json=$(curl -fsS http://127.0.0.1:7311/api/overview)
printf '%s\n' "$live_json" | python3 -c 'import json,sys; d=json.load(sys.stdin); live=d.get("live") or [];
assert len(live)>=2, "live lanes %s" % len(live)
print("overview live=%d" % len(live))' | tee -a "$report"
sess_json=$(curl -fsS http://127.0.0.1:7311/api/sessions)
printf '%s\n' "$sess_json" | python3 -c 'import json,sys; rows=json.load(sys.stdin);
assert any(r.get("tokens") for r in rows), rows
assert any((r.get("cost_usd") or 0)>0 for r in rows), rows
print("sessions=%d" % len(rows))' | tee -a "$report"

echo refresh >"$smoke_dir/cmd"
labels_have() {
  python3 - "$smoke_dir/status.json" <<'PY'
import json, sys
labs = "\n".join(json.load(open(sys.argv[1])).get("menuLabels") or [])
need = ("40k tok", "$1.23", "acme-payments-platform-service")
sys.exit(0 if all(s in labs for s in need) else 1)
PY
}
labels_ok=0
j=0
while [ "$j" -lt 24 ]; do
  if [ -f "$smoke_dir/status.json" ] && labels_have; then
    labels_ok=1
    break
  fi
  j=$((j + 1))
  sleep 0.5
  echo refresh >"$smoke_dir/cmd"
done
[ "$labels_ok" = 1 ] || {
  log "FAIL: tray labels never showed synthetic session tokens/cost (Engine offline is not success)"
  tee -a "$report" <"$smoke_dir/status.json" || true
  curl -fsS http://127.0.0.1:7311/api/overview | tee -a "$report" || true
  exit 1
}
if grep -q 'Engine offline' "$smoke_dir/status.json"; then
  log "FAIL: Engine offline after synthetic ingest"
  tee -a "$report" <"$smoke_dir/status.json"
  exit 1
fi
if ! python3 - "$smoke_dir/status.json" <<'PY'
import json, sys, re
labs = "\n".join(json.load(open(sys.argv[1])).get("menuLabels") or [])
sys.exit(1 if re.search(r"\$0\b|0 tok", labs) else 0)
PY
then
  log "FAIL: unknown rendered as zero"
  tee -a "$report" <"$smoke_dir/status.json"
  exit 1
fi
log "synthetic menuLabels:"
python3 -c 'import json,sys; print("\n".join(json.load(open(sys.argv[1]))["menuLabels"]))' "$smoke_dir/status.json" | tee -a "$report"

assert_icon_only() {
  tb=$(bounds_from_status trayBounds) || {
    log "FAIL: trayBounds missing"
    exit 1
  }
  tx=$(printf '%s\n' "$tb" | awk '{print $1}')
  ty=$(printf '%s\n' "$tb" | awk '{print $2}')
  tw=$(printf '%s\n' "$tb" | awk '{print $3}')
  th=$(printf '%s\n' "$tb" | awk '{print $4}')
  if [ "$tw" -gt 64 ]; then
    log "FAIL: tray extra is not icon-only (trayBounds width $tw > 64)"
    exit 1
  fi
  log "icon-only trayWidth=$tw ($1)"
}
assert_icon_only "after ingest"

# Status-item NSMenu hangs left of the extra. Centering the crop on the extra
# (mx=tx+tw/2-240 on 2b12cc7) clipped repo prefixes. Full-display capture keeps
# identities, tokens, and $ in frame at Aqua size.

open_menu() {
  echo hide-menu >"$smoke_dir/cmd"
  sleep 0.3
  echo menu >"$smoke_dir/cmd"
  k=0
  while [ "$k" -lt 20 ]; do
    if grep -q '"menuOpen": true' "$smoke_dir/status.json" 2>/dev/null; then
      sleep 1
      return 0
    fi
    k=$((k + 1))
    sleep 0.25
  done
  log "FAIL: native NSMenu did not open"
  tee -a "$report" <"$smoke_dir/status.json" || true
  exit 1
}

set_dark() {
  want=$1
  if [ "$want" = "Dark" ]; then
    osascript -e 'tell application "System Events" to tell appearance preferences to set dark mode to true' >/dev/null 2>&1 || true
  else
    osascript -e 'tell application "System Events" to tell appearance preferences to set dark mode to false' >/dev/null 2>&1 || true
  fi
  sleep 1
  now=$(defaults read -g AppleInterfaceStyle 2>/dev/null || echo Light)
  log "AppleInterfaceStyle=$now (want $want)"
  if [ "$want" = "Dark" ] && [ "$now" != "Dark" ]; then
    log "FAIL: could not switch system appearance to Dark"
    exit 1
  fi
}

set_dark Light
open_menu
log "menu capture=fullscreen (NSMenu hangs left of extra)"
screencapture -x "$iso/native-menu.png"
osascript -e 'tell application "System Events" to key code 125' >/dev/null 2>&1 || true
sleep 0.4
screencapture -x "$iso/native-menu-keyboard.png"
osascript -e 'tell application "System Events" to key code 36' >/dev/null 2>&1 || true
sleep 1.5
echo hide-menu >"$smoke_dir/cmd"
click_ok=0
j=0
while [ "$j" -lt 16 ]; do
  if grep -q 'aaaaaaaaaaaa' "$smoke_dir/status.json" && grep -q 'session' "$smoke_dir/status.json"; then
    click_ok=1
    break
  fi
  j=$((j + 1))
  sleep 0.25
done
[ "$click_ok" = 1 ] || {
  log "FAIL: menu Enter did not open synthetic session A"
  tee -a "$report" <"$smoke_dir/status.json" || true
  exit 1
}
log "windowHash after Enter:"
python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("windowHash"))' "$smoke_dir/status.json" | tee -a "$report"
screencapture -x "$iso/native-session-open.png"

echo hide-menu >"$smoke_dir/cmd"
sleep 0.3
set_dark Dark
open_menu
screencapture -x "$iso/native-menu-dark.png"
osascript -e 'tell application "System Events" to key code 53' >/dev/null 2>&1 || true
echo hide-menu >"$smoke_dir/cmd"
set_dark Light || true

log "bump synthetic session A tokens/cost and reopen"
node "$root/desktop/scripts/otlp-menu-fixture.js" --otlp http://127.0.0.1:4318 --bump | tee -a "$report"
echo refresh >"$smoke_dir/cmd"
bump_ok=0
j=0
while [ "$j" -lt 20 ]; do
  if python3 - "$smoke_dir/status.json" <<'PY'
import json, sys
labs = "\n".join(json.load(open(sys.argv[1])).get("menuLabels") or [])
sys.exit(0 if ("41k tok" in labs and "$1.73" in labs) else 1)
PY
  then
    bump_ok=1
    break
  fi
  j=$((j + 1))
  sleep 0.5
  echo refresh >"$smoke_dir/cmd"
done
[ "$bump_ok" = 1 ] || {
  log "FAIL: reopen did not refresh session totals after bump"
  tee -a "$report" <"$smoke_dir/status.json" || true
  exit 1
}
log "synthetic menuLabels after bump:"
python3 -c 'import json,sys; print("\n".join(json.load(open(sys.argv[1])).get("menuLabels") or []))' "$smoke_dir/status.json" | tee -a "$report"
open_menu
screencapture -x "$iso/native-menu-reopen.png"
osascript -e 'tell application "System Events" to key code 53' >/dev/null 2>&1 || true
echo hide-menu >"$smoke_dir/cmd"

assert_icon_only "after bump"
gx=$((tx - 8))
gy=$((ty - 4))
gw=$((tw + 16))
gh=$((th + 8))
if [ "$gx" -lt 0 ]; then gx=0; fi
if [ "$gy" -lt 0 ]; then gy=0; fi
capture_rect "$iso/native-glyph.png" "$gx" "$gy" "$gw" "$gh"
log "native glyph crop $gx,$gy ${gw}x${gh} trayWidth=$tw"
for shot in native-menu.png native-menu-keyboard.png native-menu-dark.png native-menu-reopen.png native-session-open.png native-glyph.png; do
  [ -s "$iso/$shot" ] || {
    log "FAIL: $shot missing or empty"
    exit 1
  }
  log "$shot bytes=$(wc -c < "$iso/$shot")"
done

kill "$menu_pid" 2>/dev/null || true
wait "$menu_pid" 2>/dev/null || true

cp "$report" "$ship_dist/signed-upgrade-smoke.txt" 2>/dev/null || cp "$report" "$iso/../signed-upgrade-smoke.txt"
for shot in native-desktop.png native-dock-open.png native-dock-closed.png native-dock-reopen.png native-menu.png native-menu-keyboard.png native-menu-dark.png native-menu-reopen.png native-session-open.png native-glyph.png; do
  if [ -f "$iso/$shot" ]; then
    dest=$shot
    if [ "$shot" = "native-desktop.png" ]; then dest=signed-upgrade-native.png
    else dest=signed-upgrade-${shot#native-}
    fi
    cp "$iso/$shot" "$ship_dist/$dest" 2>/dev/null || true
    log "stored $dest bytes=$(wc -c < "$iso/$shot")"
  fi
done
log "signed-upgrade-smoke ok"
echo "$iso"
