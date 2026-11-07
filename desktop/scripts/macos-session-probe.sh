#!/bin/sh
# Record what this GitHub-hosted Mac VM actually is before claiming Aqua is
# missing. Does not change TCC.db. A throwaway screencapture may show a
# normal Screen Recording dialog; clicking Allow via System Events is the
# same path as a user, not a TCC inject.
set -eu

out=${1:-macos-session-probe.txt}
: >"$out"
log() { printf '%s\n' "$*" | tee -a "$out"; }

log "== runner session =="
log "date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
log "uname: $(uname -a)"
log "arch: $(uname -m)"
if command -v sw_vers >/dev/null 2>&1; then
  sw_vers | tee -a "$out"
fi
log "whoami: $(whoami)"
log "id: $(id)"
log "HOME=$HOME"
log "RUNNER_TEMP=${RUNNER_TEMP-}"
log "GITHUB_WORKSPACE=${GITHUB_WORKSPACE-}"

if command -v dscl >/dev/null 2>&1; then
  log "NFSHomeDirectory: $(dscl . -read "/Users/$(whoami)" NFSHomeDirectory 2>/dev/null || true)"
fi

log "console user: $(stat -f %Su /dev/console 2>/dev/null || echo unknown)"
log "WINDOWID=${WINDOWID-}"

uid=$(id -u)
if launchctl print "gui/$uid" >/dev/null 2>&1; then
  log "launchctl gui/$uid: present"
  launchctl print "gui/$uid" 2>/dev/null | head -n 40 | tee -a "$out" || true
else
  log "launchctl gui/$uid: absent"
fi

if pgrep -x WindowServer >/dev/null 2>&1; then
  log "WindowServer: running"
else
  log "WindowServer: not running"
fi
if pgrep -x Dock >/dev/null 2>&1; then
  log "Dock: running"
else
  log "Dock: not running"
fi

log "== screencapture (no TCC.db writes) =="
cap_dir=$(CDPATH='' cd -- "$(dirname "$out")" && pwd)
cap=$cap_dir/session-screencapture.png
set +e
screencapture -x "$cap"
cap_st=$?
set -e
log "screencapture exit=$cap_st path=$cap"
if [ "$cap_st" -ne 0 ]; then
  log "screencapture failed; trying the macOS 15 consent dialog click (Allow), not a TCC inject"
  sleep 2
  osascript -e 'tell application "System Events" to tell (first process whose name contains "UserNotificationCenter") to click button "Allow" of window 1' 2>>"$out" || true
  sleep 1
  set +e
  screencapture -x "$cap"
  cap_st=$?
  set -e
  log "screencapture retry exit=$cap_st"
fi
if [ -f "$cap" ]; then
  log "screencapture bytes=$(wc -c < "$cap")"
else
  log "screencapture produced no file"
fi

log "probe recorded (Aqua may still be absent; this file is the evidence)"
exit 0
