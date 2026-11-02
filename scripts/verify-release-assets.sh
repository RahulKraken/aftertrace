#!/bin/sh
# Confirm a directory has the files a tagged GitHub Release must attach.
# Engine archives keep the aftertrace_vX_os_arch.tar.gz names install.sh uses.
# Desktop files use the stable Aftertrace-<os>.<ext> names the site links to.
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
need latest-mac.yml
need Aftertrace-win.exe
need latest.yml
need Aftertrace-linux.AppImage
need Aftertrace-linux.deb

echo "release assets ok:"
ls -1 aftertrace_*.tar.gz Aftertrace-mac.dmg Aftertrace-mac.zip Aftertrace-win.exe Aftertrace-linux.AppImage Aftertrace-linux.deb latest-mac.yml latest.yml
if [ -f latest-linux.yml ]; then ls -1 latest-linux.yml; fi
if [ -f checksums.txt ]; then ls -1 checksums.txt; fi
