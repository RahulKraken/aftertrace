#!/bin/sh
# Print a Homebrew formula for an Aftertrace release, for a tap's
# Formula/aftertrace.rb. Reads the sha256 sums from the release's checksums.txt.
#   sh scripts/homebrew-formula.sh v0.2.0 > Formula/aftertrace.rb
#   sh scripts/homebrew-formula.sh v0.2.0 dist/checksums.txt   # a local file
set -eu

tag="${1:?usage: homebrew-formula.sh vX.Y.Z [checksums.txt]}"
base="https://github.com/RahulKraken/aftertrace/releases/download/$tag"
if [ -n "${2:-}" ]; then sums=$(cat "$2"); else sums=$(curl -fsSL "$base/checksums.txt"); fi

sha() {
  s=$(printf '%s\n' "$sums" | awk -v f="aftertrace_${tag}_$1.tar.gz" '$2 == f { print $1 }')
  [ -n "$s" ] || { echo "homebrew-formula: no checksum for aftertrace_${tag}_$1.tar.gz" >&2; exit 1; }
  printf '%s' "$s"
}
darwin_arm64=$(sha darwin_arm64)
darwin_amd64=$(sha darwin_amd64)
linux_arm64=$(sha linux_arm64)
linux_amd64=$(sha linux_amd64)

cat <<RUBY
class Aftertrace < Formula
  desc "Local-first profiler for Claude Code and AI apps"
  homepage "https://rahulkraken.github.io/aftertrace/"
  version "${tag#v}"
  license "Apache-2.0"

  on_macos do
    on_arm do
      url "$base/aftertrace_${tag}_darwin_arm64.tar.gz"
      sha256 "$darwin_arm64"
    end
    on_intel do
      url "$base/aftertrace_${tag}_darwin_amd64.tar.gz"
      sha256 "$darwin_amd64"
    end
  end

  on_linux do
    on_arm do
      url "$base/aftertrace_${tag}_linux_arm64.tar.gz"
      sha256 "$linux_arm64"
    end
    on_intel do
      url "$base/aftertrace_${tag}_linux_amd64.tar.gz"
      sha256 "$linux_amd64"
    end
  end

  def install
    bin.install "aftertrace"
  end

  def caveats
    <<~EOS
      Run it now:            aftertrace serve
      Or start it at login:  aftertrace service install
      Then open http://127.0.0.1:7311 and go to Connect.
    EOS
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/aftertrace version")
  end
end
RUBY
