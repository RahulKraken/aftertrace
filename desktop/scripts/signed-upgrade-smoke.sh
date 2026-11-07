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
  if [ -e "$runner_home/.aftertrace" ]; then
    log "FAIL: wrote $runner_home/.aftertrace"
    find "$runner_home/.aftertrace" -maxdepth 2 -print | tee -a "$report" || true
    exit 1
  fi
  if [ -e "$runner_home/Library/Application Support/Aftertrace" ]; then
    log "FAIL: wrote $runner_home/Library/Application Support/Aftertrace"
    find "$runner_home/Library/Application Support/Aftertrace" -maxdepth 2 -print | tee -a "$report" || true
    exit 1
  fi
}

kill_bundle() {
  app=$1
  pkill -KILL -f "$app/Contents/MacOS/Aftertrace" 2>/dev/null || true
  pkill -KILL -f "$app/Contents/Frameworks/Aftertrace Helper" 2>/dev/null || true
  pkill -KILL -f "$app/Contents/Resources/engine/aftertrace" 2>/dev/null || true
  sleep 2
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

old_home=$iso/v053/home
mkdir -p "$old_home/.aftertrace" "$iso/v053/tmp"
echo "retain-v053" >"$old_home/.aftertrace/marker.txt"
# Launch signed 0.5.3 without rewriting app-update.yml (that would break the seal).
# Do not ad-hoc resign. Published 0.5.0 has no AFTERTRACE_HOME, and Cocoa
# NSHomeDirectory ignores HOME, so this launch may write the runner NFS
# home. Record that, then delete only what we created, so the 0.5.4 half
# can require explicit paths.
created_dot=0
created_support=0
[ -e "$runner_home/.aftertrace" ] || created_dot=1
[ -e "$runner_home/Library/Application Support/Aftertrace" ] || created_support=1
xattr -dr com.apple.quarantine "$old_app" 2>/dev/null || true
codesign -v "$old_app"
if codesign -dv --verbose=4 "$old_app" 2>&1 | grep -q "Signature=adhoc"; then
  log "FAIL: published v0.5.3 is ad-hoc; refusing to treat that as shipping evidence"
  exit 1
fi
HOME=$old_home TMPDIR=$iso/v053/tmp AFTERTRACE_HOME=$old_home/.aftertrace \
  "$old_app/Contents/MacOS/Aftertrace" --hidden \
  --user-data-dir="$old_home/Library/Application Support/Aftertrace" \
  >/dev/null 2>"$iso/v053/stderr.txt" &
old_pid=$!
sleep 8
if kill -0 "$old_pid" 2>/dev/null; then
  log "v0.5.3 still running pid=$old_pid version=$old_ver (did not self-quit)"
else
  log "v0.5.3 pid $old_pid exited; stderr follows"
  tail -n 40 "$iso/v053/stderr.txt" | tee -a "$report" || true
fi
if [ -e "$runner_home/.aftertrace" ]; then
  log "v0.5.3 Cocoa wrote $runner_home/.aftertrace despite HOME=$old_home (0.5.0 has no AFTERTRACE_HOME)"
fi
kill_bundle "$old_app"
wait "$old_pid" 2>/dev/null || true
if [ "$created_dot" = 1 ]; then
  rm -rf "$runner_home/.aftertrace"
fi
if [ "$created_support" = 1 ]; then
  rm -rf "$runner_home/Library/Application Support/Aftertrace"
fi
if [ -e "$runner_home/.aftertrace" ] || [ -e "$runner_home/Library/Application Support/Aftertrace" ]; then
  log "FAIL: could not remove v0.5.3 runner-home leak (helpers still alive?)"
  pgrep -lf Aftertrace | tee -a "$report" || true
  find "$runner_home/.aftertrace" "$runner_home/Library/Application Support/Aftertrace" -maxdepth 2 -print 2>/dev/null | tee -a "$report" || true
  exit 1
fi
[ -f "$old_home/.aftertrace/marker.txt" ]
log "v0.5.3 marker retained; 0.5.0 runner-home leak cleaned; 0.5.4 uses explicit paths"

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

log "== GUI capture attempt (file protocol + screencapture, not inspector attach) =="
# Hardened runtime typically disables nodeCliInspect. Native: open dashboard
# via smoke cmd + screencapture / osascript.
export AFTERTRACE_UPDATE_FEED_URL="http://127.0.0.1:${port}/"
"$appdir/Aftertrace.app/Contents/MacOS/Aftertrace" \
  --user-data-dir="$user_data" \
  >"$iso/gui.stdout" 2>"$iso/gui.stderr" &
gui_pid=$!
sleep 5
echo dashboard >"$smoke_dir/cmd" 2>/dev/null || true
sleep 4
set +e
osascript -e 'tell application "System Events" to get name of every process whose background only is false' >>"$report" 2>&1
screencapture -x "$iso/native-desktop.png"
osascript -e 'tell application "System Events" to tell (first process whose name contains "UserNotificationCenter") to click button "Allow" of window 1' >/dev/null 2>&1
screencapture -x "$iso/native-desktop.png"
set -e
if pgrep -x Dock >/dev/null 2>&1; then
  log "Dock running (session has a Dock process; LSUIElement still true in Info.plist)"
fi
if [ -f "$iso/native-desktop.png" ]; then
  log "native capture bytes=$(wc -c < "$iso/native-desktop.png")"
else
  log "native capture missing (Aqua/screencapture gap on this VM)"
fi
kill "$gui_pid" 2>/dev/null || true
wait "$gui_pid" 2>/dev/null || true

cp "$report" "$ship_dist/signed-upgrade-smoke.txt" 2>/dev/null || cp "$report" "$iso/../signed-upgrade-smoke.txt"
if [ -f "$iso/native-desktop.png" ]; then
  cp "$iso/native-desktop.png" "$ship_dist/signed-upgrade-native.png" 2>/dev/null || true
fi
log "signed-upgrade-smoke ok"
echo "$iso"
