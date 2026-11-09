#!/bin/sh
# Pack a CI-only signed Mac zip whose version is newer than shipping, for a
# local generic feed. Does not tag, publish, or rewrite desktop/dist.
# Shipping identity stays on desktop/package.json + desktop/dist.
set -eu

root=$(CDPATH='' cd -- "$(dirname "$0")/../.." && pwd)
desktop=$root/desktop
version=${1:-0.5.6}
out=${2:-$desktop/dist-fixture}
mkdir -p "$out"
out=$(CDPATH='' cd -- "$out" && pwd)

if [ -z "${CSC_LINK-}" ]; then
  echo "skip: CSC_LINK unset; CI fixture is Developer ID only"
  exit 0
fi

if [ ! -f "$desktop/package.json" ]; then
  echo "missing $desktop/package.json" >&2
  exit 1
fi

ship=$desktop/package.json.shipping
cp "$desktop/package.json" "$ship"
eng=$desktop/resources/engine-arch/darwin-arm64/aftertrace
eng_ship=$eng.shipping
if [ -f "$eng" ]; then
  cp "$eng" "$eng_ship"
fi
restore() {
  if [ -f "$ship" ]; then
    mv "$ship" "$desktop/package.json"
  fi
  if [ -f "$eng_ship" ]; then
    mv "$eng_ship" "$eng"
  fi
}
trap restore EXIT

node -e '
  const fs = require("fs")
  const p = process.argv[1]
  const v = process.argv[2]
  const pkg = JSON.parse(fs.readFileSync(p, "utf8"))
  pkg.version = v
  fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + "\n")
' "$desktop/package.json" "$version"

stamp=$(sh "$desktop/scripts/engine-stamp.sh" "$version")
mkdir -p "$desktop/resources/engine-arch/darwin-arm64"
CGO_ENABLED=1 GOOS=darwin GOARCH=arm64 go build -trimpath \
  -ldflags "-s -w -X main.version=${stamp}" \
  -o "$desktop/resources/engine-arch/darwin-arm64/aftertrace" \
  "$root/cmd/aftertrace"
chmod +x "$desktop/resources/engine-arch/darwin-arm64/aftertrace"

# shellcheck disable=SC1091
. "$desktop/scripts/ci-signing-env.sh"

# Do not notarize the fixture (shipping dist already did). Empty arches skip
# afterAllArtifactBuild targets. Same Developer ID as shipping. Output is
# dist-fixture, never desktop/dist.
NOTARIZE_MAC_ARCHES=""
export NOTARIZE_MAC_ARCHES
REQUIRE_MAC_NOTARIZE=""
export REQUIRE_MAC_NOTARIZE
(
  cd "$desktop"
  npx electron-builder --mac --arm64 --publish never \
    -c.mac.notarize=false \
    -c.directories.output="$out"
  node scripts/stable-artifacts.cjs "$out" "$version"
)

echo "ci fixture $version in $out"
ls -la "$out"/Aftertrace-mac-arm64.zip "$out"/latest-mac.yml
