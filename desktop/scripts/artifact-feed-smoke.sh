#!/bin/sh
# Isolated identity of this pack vs published v0.5.3 (app version 0.5.0).
# Runs on the GitHub macos runner after pack. Does not create a tag or
# Release, does not call quitAndInstall, does not launch a GUI, and does
# not write under the runner user's real Home.
#
# This is NOT a native menu-bar / Dock / Cmd+Tab test. It is NOT a live
# 0.5.3→0.5.4 upgrade of the published binary (that app's background
# updater does not download, and interactive Download then quitAndInstall
# immediately). It IS: real Info.plist + feed + zip sha of this pack,
# plus the published v0.5.3 zip's 0.5.0 identity, plus proof that
# engine/data paths live outside the .app.

set -eu

root=$(CDPATH='' cd -- "$(dirname "$0")/../.." && pwd)
dist=$(CDPATH='' cd -- "${1:-$root/desktop/dist}" && pwd)
base=${RUNNER_TEMP:-${TMPDIR:-/tmp}}
tmp=$base/aftertrace-feed-smoke-$$
mkdir -p "$tmp/home" "$tmp/published"
HOME=$tmp/home
export HOME
# shellcheck disable=SC2064
trap 'rm -rf "$tmp"' EXIT

plist_version() {
  app=$1
  plist=$app/Contents/Info.plist
  if [ ! -f "$plist" ]; then
    echo "missing Info.plist at $plist" >&2
    exit 1
  fi
  if command -v /usr/libexec/PlistBuddy >/dev/null 2>&1; then
    /usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$plist"
  else
    node -e 'const {readAppShortVersion}=require(process.argv[1]); process.stdout.write(readAppShortVersion(process.argv[2])+"\n")' \
      "$root/desktop/scripts/release-identity.cjs" "$app"
  fi
}

echo "HOME for this smoke: $HOME"
test ! -e "$HOME/Library/Application Support/Aftertrace"
test ! -e "$HOME/.aftertrace"

echo "== packed feed identity =="
node "$root/desktop/scripts/artifact-feed.cjs" "$dist"

pkg=$(node -e "process.stdout.write(require(process.argv[1]).version)" "$root/desktop/package.json")
arm_app=""
for cand in "$dist"/mac-arm64/Aftertrace.app "$dist"/mac/Aftertrace.app; do
  if [ -d "$cand" ]; then
    arm_app=$cand
    break
  fi
done
if [ -z "$arm_app" ]; then
  echo "packed Aftertrace.app not found under $dist" >&2
  ls -la "$dist" >&2
  exit 1
fi

short=$(plist_version "$arm_app")
echo "packed CFBundleShortVersionString=$short (want $pkg)"
[ "$short" = "$pkg" ]
test -x "$arm_app/Contents/Resources/engine/aftertrace" || test -f "$arm_app/Contents/Resources/engine/aftertrace"
# User data and engine store are not inside the bundle.
if [ -d "$arm_app/Contents/Resources/.aftertrace" ] || [ -d "$arm_app/Contents/.aftertrace" ]; then
  echo "engine data must not live inside the .app" >&2
  exit 1
fi

echo "== published v0.5.3 (app identity 0.5.0) =="
zip=$tmp/published/Aftertrace-mac-arm64.zip
if command -v gh >/dev/null 2>&1; then
  gh release download v0.5.3 --repo RahulKraken/aftertrace --pattern 'Aftertrace-mac-arm64.zip' --dir "$tmp/published"
else
  echo "gh is required to fetch the published v0.5.3 zip" >&2
  exit 1
fi
if [ ! -f "$zip" ]; then
  echo "v0.5.3 Aftertrace-mac-arm64.zip missing after download" >&2
  ls -la "$tmp/published" >&2
  exit 1
fi
mkdir -p "$tmp/published/app"
unzip -q "$zip" -d "$tmp/published/app"
old_app=""
for cand in "$tmp/published/app/Aftertrace.app" "$tmp/published/app/mac-arm64/Aftertrace.app" "$tmp/published/app/mac/Aftertrace.app"; do
  if [ -d "$cand" ]; then
    old_app=$cand
    break
  fi
done
if [ -z "$old_app" ]; then
  echo "v0.5.3 zip did not contain Aftertrace.app" >&2
  find "$tmp/published/app" -maxdepth 3 -type d >&2
  exit 1
fi
old_short=$(plist_version "$old_app")
echo "published v0.5.3 CFBundleShortVersionString=$old_short (want 0.5.0)"
[ "$old_short" = "0.5.0" ]
test -f "$old_app/Contents/Resources/engine/aftertrace"

echo "shipped 0.5.0 can see packed $pkg (feed identity already required newerThanFloor)"
echo "no files written under the runner Home; smoke HOME was $HOME"
echo "artifact-feed-smoke ok"
