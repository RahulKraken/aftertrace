#!/bin/sh
# Install the latest Aftertrace release, start it at login, and open it.
#   curl -fsSL https://rahulkraken.github.io/aftertrace/install.sh | sh
# Pin a version with AFTERTRACE_VERSION=v0.1.0. AFTERTRACE_BIN picks the
# directory (default ~/.local/bin, or /usr/local/bin if writable).
# Skip the login service with AFTERTRACE_NO_SERVICE=1 or --no-service.
# Skip the browser with AFTERTRACE_NO_OPEN=1 or --no-open:
#   curl -fsSL ... | sh -s -- --no-service --no-open
set -eu

REPO="RahulKraken/aftertrace"
UI="http://127.0.0.1:7311"
say() { printf '%s\n' "$*"; }
fail() { say "aftertrace install: $*" >&2; exit 1; }

no_service=0
no_open=0
for arg in "$@"; do
  case "$arg" in
    --no-service) no_service=1 ;;
    --no-open) no_open=1 ;;
    --help | -h)
      cat <<'EOF'
Install Aftertrace, start it at login, and open http://127.0.0.1:7311.

  curl -fsSL https://rahulkraken.github.io/aftertrace/install.sh | sh

Options (curl ... | sh -s -- <options>):
  --no-service   install the binary only
  --no-open      do not open the browser
  -h, --help     show this help

Environment:
  AFTERTRACE_VERSION     pin a release tag (default: latest)
  AFTERTRACE_BIN         install directory
  AFTERTRACE_NO_SERVICE  same as --no-service
  AFTERTRACE_NO_OPEN     same as --no-open
EOF
      exit 0
      ;;
    *) fail "unknown option $arg" ;;
  esac
done
[ -n "${AFTERTRACE_NO_SERVICE:-}" ] && no_service=1
[ -n "${AFTERTRACE_NO_OPEN:-}" ] && no_open=1

case "$(uname -s)" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) fail "unsupported OS $(uname -s). Build from source: https://github.com/$REPO/blob/main/docs/install.md" ;;
esac
case "$(uname -m)" in
  arm64 | aarch64) arch=arm64 ;;
  x86_64 | amd64) arch=amd64 ;;
  *) fail "unsupported architecture $(uname -m)" ;;
esac

gh_curl() {
  token="${GITHUB_TOKEN:-${GH_TOKEN:-}}"
  if [ -n "$token" ]; then
    curl -fsSL -H "Authorization: Bearer $token" -H "Accept: application/vnd.github+json" "$@"
  else
    curl -fsSL -H "Accept: application/vnd.github+json" "$@"
  fi
}

version="${AFTERTRACE_VERSION:-}"
if [ -z "$version" ]; then
  version=$(gh_curl "https://api.github.com/repos/$REPO/releases/latest" | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n1)
  [ -n "$version" ] || fail "could not find the latest release"
fi

name="aftertrace_${version}_${os}_${arch}"
base="https://github.com/$REPO/releases/download/$version"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

say "Downloading Aftertrace $version for $os/$arch"
curl -fsSL "$base/$name.tar.gz" -o "$tmp/$name.tar.gz" || fail "download failed: $base/$name.tar.gz"
curl -fsSL "$base/checksums.txt" -o "$tmp/checksums.txt" || fail "could not download checksums"

want=$(grep " $name.tar.gz\$" "$tmp/checksums.txt" | cut -d' ' -f1)
if command -v sha256sum >/dev/null 2>&1; then got=$(sha256sum "$tmp/$name.tar.gz" | cut -d' ' -f1)
else got=$(shasum -a 256 "$tmp/$name.tar.gz" | cut -d' ' -f1); fi
if [ -z "$want" ] || [ "$want" != "$got" ]; then
  fail "checksum mismatch for $name.tar.gz"
fi

tar xzf "$tmp/$name.tar.gz" -C "$tmp"
dir="${AFTERTRACE_BIN:-}"
if [ -z "$dir" ]; then
  if [ -w /usr/local/bin ]; then dir=/usr/local/bin; else dir="$HOME/.local/bin"; fi
fi
mkdir -p "$dir"
# Replace a running binary by renaming onto the path (unlink, not overwrite).
install -m 0755 "$tmp/$name/aftertrace" "$tmp/aftertrace.bin"
mv -f "$tmp/aftertrace.bin" "$dir/aftertrace"
bin="$dir/aftertrace"

ver=$("$bin" version) || fail "installed $bin but it did not run"
say "Installed $bin ($ver)"
run=aftertrace
case ":$PATH:" in
  *":$dir:"*) ;;
  *)
    run="$bin"
    say "Add $dir to your PATH: export PATH=\"$dir:\$PATH\""
    ;;
esac

if [ "$no_service" -eq 1 ]; then
  say "Start it with $run service install, then open $UI"
  exit 0
fi

say "Starting the login service"
if ! "$bin" service install >/dev/null 2>&1; then
  say "Could not start the login service. Run: $run serve"
  exit 1
fi

i=0
ready=0
while [ "$i" -lt 30 ]; do
  if curl -fsS -o /dev/null --max-time 2 "$UI/api/status" >/dev/null 2>&1; then
    ready=1
    break
  fi
  i=$((i + 1))
  sleep 1
done
if [ "$ready" -ne 1 ]; then
  say "Installed, but $UI is not answering yet. Run: $run serve"
  exit 1
fi

if [ "$no_open" -eq 0 ] && [ -z "${CI:-}" ] && [ -t 1 ]; then
  case "$os" in
    darwin)
      if command -v open >/dev/null 2>&1; then
        open "$UI" >/dev/null 2>&1 || true
      fi
      ;;
    linux)
      if [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ] && command -v xdg-open >/dev/null 2>&1; then
        xdg-open "$UI" >/dev/null 2>&1 || true
      fi
      ;;
  esac
fi

say "Aftertrace is running at $UI"
