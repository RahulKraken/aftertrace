#!/bin/sh
# Package Aftertrace for one OS. Run from desktop/ after npm ci and with the
# Go sidecar in resources/engine/ (Windows/Linux) or resources/engine-arch/
# (Mac, one binary per chip).
#   sh scripts/ci-pack.sh mac|win|linux
set -eu
cd "$(dirname "$0")/.."

# shellcheck disable=SC1091
. "$(dirname "$0")/ci-signing-env.sh"

target="${1:-}"
case "$target" in
  mac)
    # Sign in electron-builder. Notarize in afterAllArtifactBuild (the two
    # per-chip DMGs: upload both, then wait both). electron-builder's own
    # mac.notarize --waits on each .app in series and cancelled the signed
    # PR 44 Mac job at 60 minutes after codesign had already succeeded.
    npx electron-builder --mac --arm64 --x64 --publish never -c.mac.notarize=false
    ;;
  win)
    npx electron-builder --win --x64 --publish never
    ;;
  linux)
    npx electron-builder --linux --x64 --publish never
    ;;
  *)
    echo "usage: ci-pack.sh mac|win|linux" >&2
    exit 1
    ;;
esac

node scripts/stable-artifacts.cjs
