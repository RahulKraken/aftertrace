# Homebrew cask (personal tap)

This directory is the source copy of the Aftertrace **cask**. Copy `Casks/aftertrace.rb` into [RahulKraken/homebrew-tap](https://github.com/RahulKraken/homebrew-tap) as `Casks/aftertrace.rb`.

The tap repository does not exist yet. Until it does, `brew install --cask rahulkraken/tap/aftertrace` will fail.

```bash
brew install --cask rahulkraken/tap/aftertrace
```

That token is the Mac app (Apple silicon DMG), not the CLI formula. A formula with the same name would collide, so the public tap does not ship `Formula/aftertrace.rb`. The CLI stays on `install.sh`.

## Regenerating after a release

From a published tag, or from a local DMG:

```bash
# version and sha256
sh scripts/homebrew-cask.sh 0.5.7 c66b8dd064d9caee3605790f350b96f51e7f695e4c4a6cc7bd7d3145b37262d6

# or hash a DMG
sh scripts/homebrew-cask.sh 0.5.7 --from dist/Aftertrace-mac-arm64.dmg
```

Redirect stdout onto `packaging/homebrew/Casks/aftertrace.rb`, then copy that file into the tap.

The Release workflow's Assemble job generates `aftertrace.rb` from the built Apple-silicon DMG and attaches it to the GitHub Release. Copy that asset into the tap; do not guess the sha256.
