# Signing and notarizing the Mac app

A tagged release (`v*`) builds the Aftertrace Mac app as a DMG and zip, plus Windows and Linux packages, and attaches them to the GitHub Release next to the Go engine archives `install.sh` uses. The Mac app is signed and notarized when these GitHub Actions secrets exist. If they do not, the same workflow still succeeds: it ships an unsigned build, and the website tells people to right-click Aftertrace and choose Open.

Add the secrets at **Settings → Secrets and variables → Actions** on `RahulKraken/aftertrace`. After they are in, the next `v*` tag is signed. Then drop the first-open note from `site/public/index.html` (the `open-note` paragraph) and the matching sentence in the README.

Do not put certificates or passwords in the repo.

## Secret names

### Signing (Developer ID Application)

| Secret | What it is |
| - | - |
| `CSC_LINK` | Developer ID Application certificate. A `https://` URL, a `file://` path, or the **base64** of the `.p12` / `.pfx`. electron-builder reads this name. |
| `CSC_KEY_PASSWORD` | Password for that `.p12` / `.pfx`. |

Export the certificate from Keychain Access as a `.p12`, then:

```bash
base64 -i DeveloperID.p12 | pbcopy
```

Paste that into `CSC_LINK`. The password you typed at export goes in `CSC_KEY_PASSWORD`.

The same pair signs the Windows NSIS installer if the file is a code-signing `.pfx`. Leave them empty and Windows stays unsigned, like Mac.

### Notarization (one of the two Apple methods)

**Apple ID** (an app-specific password):

| Secret | What it is |
| - | - |
| `APPLE_ID` | Apple ID email for the Developer account. |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password from appleid.apple.com, not the account password. |
| `APPLE_TEAM_ID` | Ten-character Team ID (Membership details on developer.apple.com). |

**or App Store Connect API key** (preferred once you have one):

| Secret | What it is |
| - | - |
| `APPLE_API_KEY` | Contents of the `.p8` (including the `BEGIN PRIVATE KEY` lines). CI writes this to a temp file; you can also store a path, but contents are what GitHub secrets can hold. |
| `APPLE_API_KEY_ID` | Key ID shown when you created the key. |
| `APPLE_API_ISSUER` | Issuer ID (a UUID) from App Store Connect → Users and Access → Integrations → App Store Connect API. |
| `APPLE_TEAM_ID` | Same ten-character Team ID. |

You need **signing** (`CSC_LINK` + `CSC_KEY_PASSWORD`) and **one** notarization method. Signing without notarization still builds; Gatekeeper will treat it like an unsigned app until notarization is on.

## What CI does

`.github/workflows/desktop.yml` (PRs, `main`, and the Release workflow on a `v*` tag):

1. If `CSC_LINK` is empty, sets `CSC_IDENTITY_AUTO_DISCOVERY=false` and builds unsigned.
2. If `APPLE_ID` / `APPLE_API_KEY` are empty, passes `-c.mac.notarize=false` so notarization is not attempted.
3. Empty secret values are unset. electron-builder otherwise treats `CSC_LINK=""` as a path and fails.

A PR never publishes a GitHub Release. Desktop packages upload as Actions artifacts named `aftertrace-desktop-mac` / `windows` / `linux`, using the same file names a release will attach (`Aftertrace-mac.dmg`, `latest-mac.yml`, …).

## Release asset names

`install.sh` keeps downloading `aftertrace_<tag>_<os>_<arch>.tar.gz` and `checksums.txt` (sha256 of those archives only).

Desktop files on the same release:

| File | Who uses it |
| - | - |
| `Aftertrace-mac.dmg` | Site **Download for Mac** button, `/releases/latest/download/Aftertrace-mac.dmg` |
| `Aftertrace-mac.zip` | electron-updater (Mac) |
| `latest-mac.yml` | electron-updater (Mac) |
| `Aftertrace-win.exe` | Windows download |
| `latest.yml` | electron-updater (Windows) |
| `Aftertrace-linux.AppImage` | Linux download |
| `Aftertrace-linux.deb` | Debian/Ubuntu |
| `latest-linux.yml` | electron-updater (Linux AppImage) |
| `Aftertrace-<version>-mac.dmg` (and the same for zip / win / linux) | Optional pin to a version |

## First open while unsigned

macOS will warn that Aftertrace is from an unidentified developer. The site and README say: right-click Aftertrace, choose Open, then Open again. Do not tell people to run `xattr` or `spctl`.

Once a notarized build is on GitHub Releases, that note comes off.
