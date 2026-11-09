#!/bin/sh
# Print the Go sidecar stamp: vX.Y.Z from the release tag or package.json.
set -eu
root=$(CDPATH='' cd -- "$(dirname "$0")/.." && pwd)
# cd then require('./…') so Windows Node does not see a Git-Bash /d/… path.
pkg=$(cd "$root" && node -p "require('./package.json').version")
v=${1:-}
if [ -z "$v" ]; then v=$pkg; fi
case "$v" in
  v*) ;;
  *) v="v$v" ;;
esac
printf '%s\n' "$v"
