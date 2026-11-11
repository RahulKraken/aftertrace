cask "aftertrace" do
  version "0.5.7"
  sha256 "c66b8dd064d9caee3605790f350b96f51e7f695e4c4a6cc7bd7d3145b37262d6"

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
