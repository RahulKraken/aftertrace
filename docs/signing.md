# Signing and notarizing the Mac app

A tagged release (`v*`) builds two Mac apps (Apple silicon and Intel), plus Windows and Linux packages, and attaches them to the GitHub Release next to the Go engine archives `install.sh` uses. Each Mac DMG bundles only the Go engine for that chip.

The Mac apps are signed with a Developer ID, notarized, and stapled when these GitHub Actions secrets exist. If they do not, the same workflow still succeeds: it ships unsigned builds, and the website shows the right-click → Open note until a notarized release is published.

Add the secrets at **Settings → Secrets and variables → Actions** on `RahulKraken/aftertrace`. After they are in, the next `v*` tag is signed, notarized and stapled. The site hides the first-open note automatically once `Aftertrace-mac-notarized.json` is on that release. Do not put certificates or passwords in the repo.

## Create the Developer ID certificate

You need an Apple Developer Program membership.

1. On a Mac, signed into the developer account, open [Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/certificates/list).
2. Click **+** and choose **Developer ID Application** (not Apple Development, not Mac App Store). This is the cert Gatekeeper accepts for apps distributed outside the App Store.
3. Continue, pick the G2 sub-CA if asked, create a certificate signing request in Keychain Access if you do not already have one (**Keychain Access → Certificate Assistant → Request a Certificate From a Certificate Authority…**, saved to disk, email and name filled, “Saved to disk”).
4. Upload the CSR, download the `.cer`, double-click it so it lands in the **login** keychain under **My Certificates**. It should read **Developer ID Application: &lt;Your Name&gt; (&lt;TEAMID&gt;)**.

## Export the `.p12` and base64 it

1. In Keychain Access, select **My Certificates**, select the Developer ID Application cert (the private key must be nested under it).
2. **File → Export Items…** (or right-click → Export). Format: **Personal Information Exchange (.p12)**. Give it a password. You will need that password as `CSC_KEY_PASSWORD`.
3. Encode it as one line of base64 and copy it:

   ```bash
   base64 -i DeveloperID.p12 | pbcopy
   ```

   On Linux: `base64 -w0 DeveloperID.p12` and copy the output. Do not commit the `.p12`.

## Add each repo secret

**Settings → Secrets and variables → Actions → New repository secret** on `RahulKraken/aftertrace`. Create every row you will use. Empty secrets are unset in CI so electron-builder does not treat `CSC_LINK=""` as a path.

### Signing (required for a signed build)

| Secret | What to paste |
| - | - |
| `CSC_LINK` | The base64 of the `.p12` from the previous step (the `pbcopy` buffer). electron-builder also accepts a `https://` URL or a `file://` path; GitHub secrets should be the base64. |
| `CSC_KEY_PASSWORD` | The password you typed when exporting the `.p12`. |

The same pair signs the Windows NSIS installer if the file is a code-signing `.pfx`. Leave them empty and Windows stays unsigned, like Mac.

### Notarization (one of the two Apple methods)

You need **signing** and **one** notarization method. Signing without notarization still builds; Gatekeeper will treat it like an unsigned app until notarization is on.

**Apple ID** (an app-specific password):

1. At [appleid.apple.com](https://appleid.apple.com) → Sign-In and Security → App-Specific Passwords, generate one. Do not use the account password.
2. Team ID is the ten-character value on [Membership details](https://developer.apple.com/account) (`ABCD123456`).

| Secret | What to paste |
| - | - |
| `APPLE_ID` | Apple ID email for the Developer account. |
| `APPLE_APP_SPECIFIC_PASSWORD` | The app-specific password. |
| `APPLE_TEAM_ID` | Ten-character Team ID. |

**or App Store Connect API key** (preferred in CI):

1. [App Store Connect](https://appstoreconnect.apple.com) → Users and Access → Integrations → App Store Connect API → Generate API Key. Role **Developer** is enough. Download the `.p8` (once).
2. Note the Key ID and the Issuer ID (a UUID).

| Secret | What to paste |
| - | - |
| `APPLE_API_KEY` | Contents of the `.p8` (the `BEGIN PRIVATE KEY` block). CI writes this to a temp file. You can also store a path, but contents are what GitHub secrets can hold. |
| `APPLE_API_KEY_ID` | Key ID shown when you created the key. |
| `APPLE_API_ISSUER` | Issuer ID (UUID) from App Store Connect. |

`APPLE_TEAM_ID` is required for the Apple ID method. It is unused for the API-key method.

## What CI does

`.github/workflows/desktop.yml` (PRs, `main`, and the Release workflow on a `v*` tag):

1. If `CSC_LINK` is empty, sets `CSC_IDENTITY_AUTO_DISCOVERY=false` and builds unsigned.
2. If a signing identity **and** `APPLE_ID` or `APPLE_API_KEY` are set: signs with Developer ID (hardened runtime; Electron entitlements on the app, a separate empty entitlements file on the Go sidecar), then `afterAllArtifactBuild` notarizes DMGs one at a time (`notarytool wait --timeout 5400`) and staples them. PRs set `NOTARIZE_MAC_ARCHES=arm64` (Intel stays signed). The Release workflow (`workflow_call` / `v*` tag) sets `REQUIRE_MAC_NOTARIZE` and notarizes both chips. electron-builder's own `mac.notarize` stays off. `Aftertrace-mac-notarized.json` is written **only** after Apple Accepted and stapler succeeded. A PR wait timeout may keep signed artifacts without that marker. A tagged GitHub Release **fails closed** without it. Invalid/Rejected still fails.
3. If those secrets are missing, notarization is not attempted (`-c.mac.notarize=false`; the hook skips). The build stays green.
4. Empty secret values are unset. electron-builder otherwise treats `CSC_LINK=""` as a path and fails.
5. When `CSC_LINK` is set, CI requires `codesign -v` and a `Developer ID Application` identity on each `.app`. When `Aftertrace-mac-notarized.json` is present, it also runs `spctl -a -vv --type install` and `xcrun stapler validate` on each notarized DMG (and `spctl -a -vv` on each `.app`).
6. Data files (the Apache LICENSE) go in `extraResources` (`Contents/Resources/` on Mac). `extraFiles` copies into `Contents/`, and `codesign` treats a loose file there as nested code (`code object is not signed at all`). `after-pack` fails the Mac build if anything unexpected is at `Contents/` top level.

A PR never publishes a GitHub Release. Desktop packages upload as Actions artifacts named `aftertrace-desktop-mac` / `windows` / `linux`, using the same file names a release will attach.

## Release asset names

`install.sh` keeps downloading `aftertrace_<tag>_<os>_<arch>.tar.gz` and `checksums.txt` (sha256 of those archives only).

Desktop files on the same release:

| File | Who uses it |
| - | - |
| `Aftertrace-mac-arm64.dmg` | Apple silicon download |
| `Aftertrace-mac-x64.dmg` | Intel Mac download |
| `Aftertrace-mac.dmg` | Copy of the arm64 DMG. Site **Download for Mac** fallback and `/releases/latest/download/Aftertrace-mac.dmg` |
| `Aftertrace-mac-arm64.zip` / `Aftertrace-mac-x64.zip` | electron-updater (Mac). `latest-mac.yml` lists both; the running app picks its chip |
| `Aftertrace-mac.zip` | Copy of the arm64 zip (link stability only; not what the updater reads) |
| `latest-mac.yml` | electron-updater (Mac) |
| `Aftertrace-mac-notarized.json` | Present only on a notarized build. The website hides the first-open note when this file is on the latest release |
| `Aftertrace-win.exe` | Windows download |
| `latest.yml` | electron-updater (Windows) |
| `Aftertrace-linux.AppImage` | Linux download |
| `Aftertrace-linux.deb` | Debian/Ubuntu |
| `latest-linux.yml` | electron-updater (Linux AppImage) |
| `Aftertrace-<version>-mac-arm64.dmg` (and the same for x64 / zip / win / linux) | Optional pin to a version |

## First open while unsigned

macOS will warn that Aftertrace is from an unidentified developer. The site and README say: right-click Aftertrace, choose Open, then Open again. Do not tell people to run `xattr` or `spctl`.

Once a notarized build is on GitHub Releases, the site drops that note by itself. You do not edit `index.html` for that.
