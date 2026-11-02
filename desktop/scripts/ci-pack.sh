#!/bin/sh
# Package Aftertrace for one OS. Run from desktop/ after npm ci and with the
# Go sidecar in resources/engine/.
#   sh scripts/ci-pack.sh mac|win|linux
set -eu
cd "$(dirname "$0")/.."

# shellcheck disable=SC1091
. "$(dirname "$0")/ci-signing-env.sh"

target="${1:-}"
case "$target" in
  mac)
    extra=""
    # Notarize only when a signing identity AND Apple credentials exist.
    # -c.mac.notarize=false keeps unsigned / sign-only builds green.
    if [ -z "${CSC_LINK-}" ] || { [ -z "${APPLE_ID-}" ] && [ -z "${APPLE_API_KEY-}" ]; }; then
      extra="-c.mac.notarize=false"
    fi
    # extra is a single flag or empty; splitting is intentional.
    # shellcheck disable=SC2086
    npx electron-builder --mac --universal --publish never $extra
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
