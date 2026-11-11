#!/bin/sh
# Print a Homebrew cask for an Aftertrace Mac release, for a tap's
# Casks/aftertrace.rb. The public tap ships this app cask, not the CLI
# formula (same token would collide).
#   sh scripts/homebrew-cask.sh 0.5.7 <sha256>
#   sh scripts/homebrew-cask.sh v0.5.7 --from dist/Aftertrace-mac-arm64.dmg
set -eu

usage() {
  echo "usage: homebrew-cask.sh VERSION SHA256|--from DMG" >&2
  exit 1
}

[ "$#" -ge 2 ] || usage
version=$1
shift
version=${version#v}
case $1 in
  --from)
    [ "$#" -eq 2 ] || usage
    dmg=$2
    [ -f "$dmg" ] || { echo "homebrew-cask: not a file: $dmg" >&2; exit 1; }
    if command -v sha256sum >/dev/null 2>&1; then
      sha256=$(sha256sum "$dmg" | awk '{print $1}')
    else
      sha256=$(shasum -a 256 "$dmg" | awk '{print $1}')
    fi
    ;;
  *)
    [ "$#" -eq 1 ] || usage
    sha256=$1
    ;;
esac
[ -n "$sha256" ] || { echo "homebrew-cask: empty sha256" >&2; exit 1; }

cat <<RUBY
cask "aftertrace" do
  version "$version"
  sha256 "$sha256"

  url "https://github.com/RahulKraken/aftertrace/releases/download/v#{version}/Aftertrace-mac-arm64.dmg",
      verified: "github.com/RahulKraken/aftertrace/"
  name "Aftertrace"
  desc "Time, cost and usage for your AI coding tools"
  homepage "https://rahulkraken.github.io/aftertrace/"

  livecheck do
    url "https://github.com/RahulKraken/aftertrace/releases/latest"
    strategy :github_latest
  end

  auto_updates true
  depends_on arch: :arm64

  app "Aftertrace.app"

  uninstall quit: "com.rahulkraken.aftertrace"

  zap trash: [
    "~/.aftertrace",
    "~/Library/Application Support/Aftertrace",
    "~/Library/Logs/Aftertrace",
    "~/Library/Preferences/com.rahulkraken.aftertrace.plist",
    "~/Library/Saved Application State/com.rahulkraken.aftertrace.savedState",
  ]
end
RUBY
