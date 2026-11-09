#!/bin/sh
# Signed 0.5.5 app + local 0.5.6 fixture feed on a disposable GitHub Mac VM.
# No production tag/release. No ad-hoc resign. No TCC database writes.
#
# Distinguishes shipped v0.5.3 (internal 0.5.0, Download then quitAndInstall)
# from 0.5.4/0.5.5 (download, stay running, Restart that did not relaunch)
# from this tree (Restart must spawn N+1; quit-to-install must not).
set -eu

root=$(CDPATH='' cd -- "$(dirname "$0")/../.." && pwd)
ship_dist=$(CDPATH='' cd -- "${1:-$root/desktop/dist}" && pwd)
fixture_dist=$(CDPATH='' cd -- "${2:-$root/desktop/dist-fixture}" && pwd)
base=${RUNNER_TEMP:-${TMPDIR:-/tmp}}
iso=$base/aftertrace-signed-smoke-$$
report=$iso/report.txt
http_pid=""
legacy_uid=""
legacy_plist=""
mkdir -p "$iso"
: >"$report"
log() { printf '%s\n' "$*" | tee -a "$report"; }
cleanup_legacy() {
  if [ -n "${legacy_uid:-}" ]; then
    launchctl bootout "gui/${legacy_uid}/dev.aftertrace" >/dev/null 2>&1 || true
  fi
  if [ -n "${legacy_plist:-}" ]; then
    rm -f "$legacy_plist"
  fi
}
copy_report() {
  cleanup_legacy
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

app_pids() {
  pgrep -f "/Aftertrace.app/Contents/MacOS/Aftertrace" 2>/dev/null || true
}

dump_shipit() {
  log "== ShipIt logs =="
  find "$iso_home/Library" \( -iname '*ShipIt*' -o -iname '*shipit*' \) 2>/dev/null | tee -a "$report" || true
  find "$iso_home/Library" \( -iname '*ShipIt*' -o -iname '*shipit*' \) -type f 2>/dev/null | while IFS= read -r f; do
    log "--- $f ---"
    tail -n 80 "$f" | tee -a "$report" || true
  done
}

wait_pid_gone() {
  pid=$1
  i=0
  while [ "$i" -lt 60 ]; do
    if ! kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
    i=$((i + 1))
    sleep 1
  done
  return 1
}

wait_plist() {
  app=$1
  want=$2
  i=0
  while [ "$i" -lt 60 ]; do
    now=$(plist_version "$app" 2>/dev/null || true)
    if [ "$now" = "$want" ]; then
      echo "$now"
      return 0
    fi
    i=$((i + 1))
    sleep 1
  done
  plist_version "$app"
  return 1
}

wait_new_app_pid() {
  old=$1
  i=0
  while [ "$i" -lt 30 ]; do
    for pid in $(app_pids); do
      if [ "$pid" != "$old" ] && kill -0 "$pid" 2>/dev/null; then
        echo "$pid"
        return 0
      fi
    done
    i=$((i + 1))
    sleep 1
  done
  return 1
}

assert_no_app_pid() {
  i=0
  while [ "$i" -lt 30 ]; do
    sleep 1
    i=$((i + 1))
  done
  live=""
  for pid in $(app_pids); do
    if kill -0 "$pid" 2>/dev/null; then
      live="$live $pid"
    fi
  done
  if [ -n "$live" ]; then
    log "FAIL: Aftertrace still running after quit-to-install:$live"
    pgrep -lf Aftertrace | tee -a "$report" || true
    return 1
  fi
  log "quit-to-install: no new Aftertrace process in 30s"
}

assert_no_runner_writes() {
  support="$runner_home/Library/Application Support/Aftertrace"
  if [ -e "$support" ]; then
    # ShipIt relaunch cannot inherit --user-data-dir, so Chromium caches land
    # in the login home. Fail only if our own files leaked there.
    ours=$(find "$support" \( -name 'desktop.json' -o -name '*.duckdb' -o -name '*.duckdb.wal' -o -name 'aftertrace.log' \) -print 2>/dev/null || true)
    if [ -n "$ours" ]; then
      log "FAIL: wrote $support"
      printf '%s\n' "$ours" | tee -a "$report"
      find "$support" -maxdepth 3 -print | tee -a "$report" || true
      exit 1
    fi
    log "note: $support has Chromium caches from ShipIt relaunch (no --user-data-dir)"
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
# 0.5.5 is the live upgrade under explicit paths.
log "v0.5.3 not launched (Cocoa home leak on 0.5.0); asar/codesign recorded"

# --- 0.5.5 → CI fixture 0.5.6 ---
log "== 0.5.5 plus local 0.5.6 fixture feed =="
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
[ "$ship_ver" = "0.5.5" ]
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
grep -q "version: 0.5.6" "$fixture_dist/latest-mac.yml"
new_asar=$ship_app/Contents/Resources/app.asar
python3 - "$new_asar" "$report" <<'PY'
import sys
data = open(sys.argv[1], "rb").read()
lines = []
flag = b"autoRunAppAfterInstall = Boolean(relaunch)" in data
lines.append("0.5.5 asar autoRunAppAfterInstall = Boolean(relaunch): %s" % flag)
lines.append("0.5.5 asar default autoRunAppAfterInstall false: %s" % (b"autoRunAppAfterInstall = false" in data or b"autoRunAppAfterInstall=false" in data))
open(sys.argv[2], "a", encoding="utf8").write("\n".join(lines) + "\n")
print("\n".join(lines))
if not flag:
    sys.exit(1)
PY

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

wait_status() {
  i=0
  while [ "$i" -lt 40 ]; do
    if [ -f "$smoke_dir/status.json" ]; then
      return 0
    fi
    i=$((i + 1))
    sleep 1
  done
  return 1
}

wait_ready() {
  pid=$1
  i=0
  while [ "$i" -lt 90 ]; do
    if [ -f "$smoke_dir/status.json" ] && grep -q '"status": "ready"' "$smoke_dir/status.json"; then
      return 0
    fi
    if ! kill -0 "$pid" 2>/dev/null; then
      log "FAIL: process exited during download"
      return 1
    fi
    i=$((i + 1))
    sleep 1
  done
  return 1
}

copy_app() {
  dest=$1
  rm -rf "$dest"
  mkdir -p "$dest"
  ditto "$ship_app" "$dest/Aftertrace.app"
  xattr -dr com.apple.quarantine "$dest/Aftertrace.app" 2>/dev/null || true
  codesign -v "$dest/Aftertrace.app"
}

wait_engine_version() {
  want=$1
  i=0
  while [ "$i" -lt 40 ]; do
    got=$(curl -sf http://127.0.0.1:7311/api/version 2>/dev/null || true)
    if [ -n "$got" ]; then
      log "GET /api/version: $got"
    fi
    if printf '%s' "$got" | grep -q "$want"; then
      return 0
    fi
    i=$((i + 1))
    sleep 1
  done
  return 1
}

# --- leftover LaunchAgent (Rahul's v0.4.2 path): unload, keep DB ---
log "== legacy dev.aftertrace LaunchAgent =="
legacy_uid=$(id -u)
legacy_plist="$runner_home/Library/LaunchAgents/dev.aftertrace.plist"
mkdir -p "$runner_home/Library/LaunchAgents" "$iso_home/Library/LaunchAgents"
cat >"$iso/fake-legacy-engine.py" <<'PY'
from http.server import BaseHTTPRequestHandler, HTTPServer
import json, os
class H(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith("/api/version"):
            body = json.dumps({"version": "v0.4.2", "pid": os.getpid(), "bin": os.path.expanduser("~/.aftertrace/bin/aftertrace"), "service": "launchd"}).encode()
        elif self.path.startswith("/api/status"):
            body = json.dumps({"info": {"version": "v0.4.2", "service": "launchd"}}).encode()
        else:
            body = b'{"ok":true}'
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, *_args):
        pass
HTTPServer(("127.0.0.1", 7311), H).serve_forever()
PY
cat >"$legacy_plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>dev.aftertrace</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/python3</string>
    <string>$iso/fake-legacy-engine.py</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$iso/legacy.stdout</string>
  <key>StandardErrorPath</key>
  <string>$iso/legacy.stderr</string>
</dict>
</plist>
EOF
cp "$legacy_plist" "$iso_home/Library/LaunchAgents/dev.aftertrace.plist"
launchctl bootout "gui/${legacy_uid}/dev.aftertrace" >/dev/null 2>&1 || true
launchctl bootstrap "gui/${legacy_uid}" "$legacy_plist"
sleep 1
wait_engine_version "v0.4.2"
log "legacy LaunchAgent is serving v0.4.2 on 7311"
echo "legacy-keep" >"$engine_home/legacy-keep.txt"
[ -f "$engine_home/marker.txt" ]

# --- quit-to-install: replace, do not reopen ---
log "== quit-to-install (no relaunch) =="
quitdir=$iso/quit-app
copy_app "$quitdir"
rm -f "$smoke_dir/status.json" "$smoke_dir/cmd"
"$quitdir/Aftertrace.app/Contents/MacOS/Aftertrace" --hidden \
  --user-data-dir="$user_data" \
  >"$iso/quit.stdout" 2>"$iso/quit.stderr" &
quit_pid=$!
log "launched 0.5.5 for quit-to-install pid=$quit_pid"
wait_status
tee -a "$report" <"$smoke_dir/status.json"
if ! wait_engine_version "v0.5.5"; then
  log "FAIL: bundled engine did not replace v0.4.2 on 7311"
  tail -n 40 "$iso/quit.stderr" | tee -a "$report" || true
  tail -n 20 "$iso/legacy.stderr" | tee -a "$report" || true
  exit 1
fi
if [ -f "$legacy_plist" ]; then
  log "FAIL: $legacy_plist still present after packaged start"
  exit 1
fi
if launchctl print "gui/${legacy_uid}/dev.aftertrace" >/dev/null 2>&1; then
  log "FAIL: launchctl print gui/${legacy_uid}/dev.aftertrace still succeeds"
  launchctl print "gui/${legacy_uid}/dev.aftertrace" | tee -a "$report" || true
  exit 1
fi
[ -f "$engine_home/legacy-keep.txt" ]
grep -q legacy-keep "$engine_home/legacy-keep.txt"
[ -f "$engine_home/marker.txt" ]
log "legacy LaunchAgent replaced; /api/version is v0.5.5; DB marker kept"
echo check >"$smoke_dir/cmd"
wait_ready "$quit_pid"
log "download ready; sending quit (install on quit, no reopen)"
echo quit >"$smoke_dir/cmd"
if ! wait_pid_gone "$quit_pid"; then
  log "FAIL: pid $quit_pid still running after quit"
  exit 1
fi
now=$(wait_plist "$quitdir/Aftertrace.app" 0.5.6) || true
log "quit-to-install plist=$now"
[ "$now" = "0.5.6" ]
dump_shipit
if ! assert_no_app_pid; then
  exit 1
fi
[ -f "$engine_home/marker.txt" ]
grep -q retain-054 "$engine_home/marker.txt"
assert_no_runner_writes

# --- Restart to update: ShipIt must spawn N+1 ---
log "== Restart to update (auto-relaunch) =="
appdir=$iso/current
copy_app "$appdir"
rm -f "$smoke_dir/status.json" "$smoke_dir/cmd"
"$appdir/Aftertrace.app/Contents/MacOS/Aftertrace" --hidden \
  --user-data-dir="$user_data" \
  >"$iso/app.stdout" 2>"$iso/app.stderr" &
new_pid=$!
log "launched 0.5.5 for Restart pid=$new_pid"
wait_status
log "status after boot:"
tee -a "$report" <"$smoke_dir/status.json"
grep -q "$engine_home" "$smoke_dir/status.json"
grep -q "$user_data" "$smoke_dir/status.json"
grep -q "$iso_home" "$smoke_dir/status.json"
pgrep -lf Aftertrace | tee -a "$report" || true
kill -0 "$new_pid"
echo check >"$smoke_dir/cmd"
wait_ready "$new_pid"
log "download ready; process still pid=$new_pid"
tee -a "$report" <"$smoke_dir/status.json"
assert_no_runner_writes
[ -f "$engine_home/marker.txt" ]
grep -q retain-054 "$engine_home/marker.txt"

echo restart >"$smoke_dir/cmd"
log "sent explicit Restart"
if ! wait_pid_gone "$new_pid"; then
  log "FAIL: pid $new_pid still running after Restart"
  exit 1
fi
log "old pid $new_pid gone"
now=$(wait_plist "$appdir/Aftertrace.app" 0.5.6) || true
log "replacement plist=$now"
[ "$now" = "0.5.6" ]
codesign -v "$appdir/Aftertrace.app"
test -f "$appdir/Aftertrace.app/Contents/Resources/engine/aftertrace"
eng_ver=$("$appdir/Aftertrace.app/Contents/Resources/engine/aftertrace" version || true)
log "replacement engine version: $eng_ver"
[ "$eng_ver" = "aftertrace v0.5.6" ]
[ -f "$engine_home/marker.txt" ]
grep -q retain-054 "$engine_home/marker.txt"
assert_no_runner_writes

rel_pid=$(wait_new_app_pid "$new_pid" || true)
if [ -z "$rel_pid" ]; then
  log "FAIL: Restart did not spawn a new Aftertrace process within 30s"
  dump_shipit
  pgrep -lf Aftertrace | tee -a "$report" || true
  tail -n 80 "$iso/app.stderr" | tee -a "$report" || true
  exit 1
fi
log "auto-relaunch pid=$rel_pid (ShipIt, not this script)"
dump_shipit
if [ -f "$smoke_dir/status.json" ]; then
  tee -a "$report" <"$smoke_dir/status.json"
fi
kill "$rel_pid" 2>/dev/null || true
wait "$rel_pid" 2>/dev/null || true
for extra in $(app_pids); do
  log "stopping leftover pid=$extra"
  kill "$extra" 2>/dev/null || true
  wait "$extra" 2>/dev/null || true
done
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
log "0.5.6 fixture AppleInterfaceStyle=$appearance (menu capture waits for notarized 0.5.5 head app)"
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
log "0.5.6 fixture icon-only trayWidth=$tw (NSMenu with live sessions is captured on the notarized 0.5.5 pack)"
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
# Drop the 0.5.6 fixture process so OTLP 4318 / UI 7311 are free for the notarized pack.
pkill -f "$appdir/Aftertrace.app" 2>/dev/null || true
pkill -f "$engine_home/aftertrace.duckdb" 2>/dev/null || true
sleep 1

log "== notarized PR-head 0.5.5 NSMenu with synthetic OTel (not Rahul usage) =="
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
log "notarized-pack plist=$nv (this CI pack identity; not GitHub Release v0.5.5 unless SHA matches a tag)"
[ "$nv" = "0.5.5" ]
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
log "notarized 0.5.5 pid=$menu_pid"
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
need = ("40k", "$1.23", "acme-payments-platform-service")
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
sys.exit(1 if re.search(r"\$0\.00\b|\$0(?!\.)|0 tok", labs) else 0)
PY
then
  log "FAIL: unknown rendered as zero"
  tee -a "$report" <"$smoke_dir/status.json"
  exit 1
fi
log "sw_vers:"
sw_vers | tee -a "$report" || true
python3 - "$smoke_dir/status.json" <<'PY' | tee -a "$report"
import json, sys, re
st = json.load(open(sys.argv[1]))
ver = str(st.get("osVersion") or "")
print("status osVersion=%s menuVariant=%s menuSublabelSupported=%s" % (
    ver, st.get("menuVariant"), st.get("menuSublabelSupported")))
m = re.match(r"(\d+)\.(\d+)", ver)
ok = False
if m:
    major, minor = int(m.group(1)), int(m.group(2))
    ok = major > 14 or (major == 14 and minor >= 4)
print("sublabel expected on this Darwin: %s (need >= 14.4)" % ("yes" if ok else "no, fallback single-line labels"))
PY
log "synthetic menuLabels:"
python3 -c 'import json,sys; print("\n".join(json.load(open(sys.argv[1])).get("menuLabels") or []))' "$smoke_dir/status.json" | tee -a "$report"

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

set_variant() {
  echo hide-menu >"$smoke_dir/cmd"
  sleep 0.2
  echo "variant $1" >"$smoke_dir/cmd"
  v=0
  while [ "$v" -lt 16 ]; do
    if grep -q "\"menuVariant\": \"$1\"" "$smoke_dir/status.json" 2>/dev/null; then
      log "menuVariant=$1"
      return 0
    fi
    v=$((v + 1))
    sleep 0.25
    echo "variant $1" >"$smoke_dir/cmd"
  done
  log "FAIL: menu variant $1 did not apply"
  tee -a "$report" <"$smoke_dir/status.json" || true
  exit 1
}

set_dark Light
set_variant identity
open_menu
log "menu capture=fullscreen variant=identity (stock NSMenu label+sublabel)"
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

log "capture activity variant Light+Dark"
set_dark Light
set_variant activity
open_menu
screencapture -x "$iso/native-menu-activity.png"
osascript -e 'tell application "System Events" to key code 53' >/dev/null 2>&1 || true
echo hide-menu >"$smoke_dir/cmd"
set_dark Dark
open_menu
screencapture -x "$iso/native-menu-activity-dark.png"
osascript -e 'tell application "System Events" to key code 53' >/dev/null 2>&1 || true
echo hide-menu >"$smoke_dir/cmd"
set_variant identity
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
sys.exit(0 if ("41k" in labs and "$1.73" in labs) else 1)
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
for shot in native-menu.png native-menu-keyboard.png native-menu-dark.png native-menu-activity.png native-menu-activity-dark.png native-menu-reopen.png native-session-open.png native-glyph.png; do
  [ -s "$iso/$shot" ] || {
    log "FAIL: $shot missing or empty"
    exit 1
  }
  log "$shot bytes=$(wc -c < "$iso/$shot")"
done

kill "$menu_pid" 2>/dev/null || true
wait "$menu_pid" 2>/dev/null || true

cp "$report" "$ship_dist/signed-upgrade-smoke.txt" 2>/dev/null || cp "$report" "$iso/../signed-upgrade-smoke.txt"
for shot in native-desktop.png native-dock-open.png native-dock-closed.png native-dock-reopen.png native-menu.png native-menu-keyboard.png native-menu-dark.png native-menu-activity.png native-menu-activity-dark.png native-menu-reopen.png native-session-open.png native-glyph.png; do
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
