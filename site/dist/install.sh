#!/bin/sh
# Install the latest Aftertrace release.
#   curl -fsSL https://rahulkraken.github.io/aftertrace/install.sh | sh
# Set AFTERTRACE_VERSION=v0.1.0 to pin a version, AFTERTRACE_BIN to choose
# the install directory (default ~/.local/bin, or /usr/local/bin if writable).
set -eu

REPO="RahulKraken/aftertrace"
say() { printf '%s\n' "$*"; }
fail() { say "aftertrace install: $*" >&2; exit 1; }

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

version="${AFTERTRACE_VERSION:-}"
if [ -z "$version" ]; then
  version=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n1)
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
[ -n "$want" ] && [ "$want" = "$got" ] || fail "checksum mismatch for $name.tar.gz"

tar xzf "$tmp/$name.tar.gz" -C "$tmp"
dir="${AFTERTRACE_BIN:-}"
if [ -z "$dir" ]; then
  if [ -w /usr/local/bin ]; then dir=/usr/local/bin; else dir="$HOME/.local/bin"; fi
fi
mkdir -p "$dir"
install -m 0755 "$tmp/$name/aftertrace" "$dir/aftertrace"

say "Installed $dir/aftertrace ($("$dir/aftertrace" version))"
case ":$PATH:" in *":$dir:"*) ;; *) say "Add $dir to your PATH to run it by name." ;; esac
say ""
say "Next:"
say "  aftertrace demo      # optional: load synthetic sessions to look around"
say "  aftertrace serve     # then open http://127.0.0.1:7311 and go to Connect"
