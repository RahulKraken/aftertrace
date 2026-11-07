#!/bin/sh
# Confirm a directory has the files a tagged GitHub Release must attach.
# Engine archives keep the aftertrace_vX_os_arch.tar.gz names install.sh uses.
# Desktop files use the stable Aftertrace-<os>.<ext> names the site links to,
# plus the Apple-silicon Mac names (Aftertrace-mac-arm64.dmg).
# Aftertrace-mac.dmg is a copy of the arm64 DMG. Intel Mac packages are
# not a consumer release requirement.
#   sh scripts/verify-release-assets.sh dist
set -eu
dir="${1:?usage: verify-release-assets.sh DIR}"
cd "$dir"

need_glob() {
  label=$1
  shift
  found=0
  for f in "$@"; do
    if [ -f "$f" ]; then
      found=1
      break
    fi
  done
  if [ "$found" -ne 1 ]; then
    echo "verify-release-assets: missing $label in $dir" >&2
    ls -la >&2
    exit 1
  fi
}

need() {
  if [ ! -f "$1" ]; then
    echo "verify-release-assets: missing $1 in $dir" >&2
    ls -la >&2
    exit 1
  fi
}

need_glob "darwin arm64 engine archive" aftertrace_*_darwin_arm64.tar.gz
need_glob "darwin amd64 engine archive" aftertrace_*_darwin_amd64.tar.gz
need_glob "linux amd64 engine archive" aftertrace_*_linux_amd64.tar.gz
need_glob "linux arm64 engine archive" aftertrace_*_linux_arm64.tar.gz

need Aftertrace-mac.dmg
need Aftertrace-mac.zip
need Aftertrace-mac-arm64.dmg
need Aftertrace-mac-arm64.zip
need latest-mac.yml
if ! grep -q "Aftertrace-mac-arm64.zip" latest-mac.yml; then
  echo "verify-release-assets: latest-mac.yml must list Aftertrace-mac-arm64.zip" >&2
  cat latest-mac.yml >&2
  exit 1
fi
if grep -q "Aftertrace-mac-x64.zip" latest-mac.yml; then
  echo "verify-release-assets: latest-mac.yml must not list Aftertrace-mac-x64.zip (Apple-silicon-only consumer)" >&2
  cat latest-mac.yml >&2
  exit 1
fi
if [ -f Aftertrace-mac-arm64.dmg ] && [ -f Aftertrace-mac.dmg ]; then
  if ! cmp -s Aftertrace-mac.dmg Aftertrace-mac-arm64.dmg; then
    echo "verify-release-assets: Aftertrace-mac.dmg is not a copy of Aftertrace-mac-arm64.dmg" >&2
    exit 1
  fi
fi
need Aftertrace-win.exe
need latest.yml
need Aftertrace-linux.AppImage
need Aftertrace-linux.deb
# Consumer GitHub Releases must attach the notarized marker. PRs and
# workflow_dispatch dry-runs may omit it (signed-only / Apple still In Progress).
if [ "${REQUIRE_MAC_NOTARIZE-}" = "true" ] || [ "${REQUIRE_MAC_NOTARIZE-}" = "1" ]; then
  need Aftertrace-mac-notarized.json
fi

echo "release assets ok:"
ls -1 aftertrace_*.tar.gz Aftertrace-mac.dmg Aftertrace-mac.zip \
  Aftertrace-mac-arm64.dmg Aftertrace-mac-arm64.zip \
  Aftertrace-win.exe Aftertrace-linux.AppImage Aftertrace-linux.deb \
  latest-mac.yml latest.yml
if [ -f latest-linux.yml ]; then ls -1 latest-linux.yml; fi
if [ -f checksums.txt ]; then ls -1 checksums.txt; fi
