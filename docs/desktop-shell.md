# Desktop shell (menu bar, Dock, updater)

The Electron app is a local shell around the Go engine. Glance at activity and cost without opening the dashboard; when the dashboard is open it is a normal Mac app.

Published **v0.5.3** stays on GitHub Releases until a separate approval. This tree is **0.5.4** so an installed v0.5.3 (whose `app.getVersion()` is `0.5.0`) can see a newer feed.

## 1. Updater

electron-updater 6.8.12 against GitHub Releases (`latest-mac.yml` arm64 zip only). Background check after 20s, then every 4 hours. Auto-download; **no auto-restart**. The user presses **Restart to update**. Quit after a download may install on the way out (`autoInstallOnAppQuit`) but does not relaunch.

Visible states: checking, downloading, ready, error / retry, up to date. Offline and cancelled downloads stay in error; the app keeps running.

`before-quit` stops the sidecar, then `quitAndInstall(false, true)` on Restart. Engine data lives in `~/.aftertrace` and survives.

**Identity (fail-closed).** Tag `vX.Y.Z`, `desktop/package.json`, updater yml `version:`, packed `Aftertrace.app` `CFBundleShortVersionString`, and `CHANGELOG.md` `## vX.Y.Z` must match. Package version must be newer than `0.5.0`. Mac feed must list `Aftertrace-mac-arm64.zip` and must not list an Intel zip. Checks: `node desktop/scripts/release-identity.cjs` (and with a `dist/` after pack), `PlistBuddy` in `ci-verify-mac.sh`, plus `EXPECT_DESKTOP_VERSION` in `scripts/verify-release-assets.sh`.

Privacy: the check contacts GitHub Releases. No usage telemetry. Logs strip `ghp_` / `github_pat_` tokens.

### Evidence: mock vs real Mac

| What | Kind |
| - | - |
| `desktop/test/updater.test.js` — 0.5.0 sees 0.5.4, downloads, stays running, Restart calls `quitAndInstall`, Later does not, overlapping checks share one download, offline/cancel retry | **Unit / mock** |
| `desktop/test/quit.test.js` — sidecar stop then install | **Unit / mock** |
| Playwright popover/recap PNGs | **Chromium layout**, not the native Mac menu extra |
| Packed `Aftertrace.app` Info.plist + `latest-mac.yml` + zip sha512 vs published v0.5.3 zip (`CFBundleShortVersionString` `0.5.0`) on `macos-15` (`artifact-feed-smoke.sh`) | **Real files** on the GitHub-hosted Mac runner. Isolated `$HOME` is not enough: `AFTERTRACE_HOME` + `AFTERTRACE_USER_DATA_DIR` too. No tag/Release. |
| Developer ID / Apple Accepted / stapler / app `spctl` | **Real** on that runner when secrets exist (`ci-verify-mac.sh`) |
| `macos-session-probe.sh` on `macos-15` | **Real session.** Records arch, console user, `launchctl gui/$uid`, WindowServer/Dock, a `screencapture` (Allow dialog click only; no TCC.db writes). Read the job log before claiming Aqua is missing. |
| Signed 0.5.4 app in `$RUNNER_TEMP` + local `127.0.0.1` generic feed of a CI-only signed **0.5.5** fixture (`signed-upgrade-smoke.sh`) | **Real process.** ditto of the shipping signed app (no ad-hoc resign). File-protocol smoke (`AFTERTRACE_SMOKE=1` **and** GitHub Actions runner env, plus `AFTERTRACE_SMOKE_DIR`): check → download → **ready while still running** → explicit Restart → replacement plist 0.5.5, engine binary, marker data retained. Playwright Electron is not used (hardened runtime typically disables `EnableNodeCliInspectArguments`). Native Dock: AX tiles of Dock list 1 + `background only is false` while dashboard open; close removes both while engine+tray stay; reopen restores. Native NSMenu/glyph: `screencapture -R` of `popUpContextMenu` plus the menu extra bounds; not a Chromium mock. An open NSMenu is not live-updated; labels rebuild on reopen. |
| Shipped signed v0.5.3 (internal 0.5.0) | **Compatibility read of the published zip / asar, not a live old-client→new-client run.** asar contains `autoRunAppAfterInstall = true` and `quitAndInstall()`. Background check does not download. Interactive Download then quits immediately — that forced-restart is unavoidable on the published tag and is not patched. The smoke does **not** rewrite `app-update.yml` (that would break the seal) and does **not** click Download. |

Production checks stay on GitHub Releases. `AFTERTRACE_UPDATE_FEED_URL` is ignored unless CI/test intent is set, and even then must be `http(s)://127.0.0.1[:port]/`. The 0.5.5 fixture is not tagged or attached to a Release. Shipping identity stays 0.5.4. Do not treat unit tests or Playwright shots as a real Mac upgrade or native menu-bar test. The one-time v0.5.3 → 0.5.4 transition still uses v0.5.3’s Download-then-quit path; later updates on 0.5.4 stay running until Restart.

## 2. Dock / Cmd+Tab

`LSUIElement` stays true (menu-bar default). While the dashboard window is shown: `setActivationPolicy('regular')` + `dock.show()`. On close: accessory again, process stays (tray + engine). Reopen: tray, Dock click, `activate`, second instance. Closing the dashboard is not Quit. Restart-to-update hides the Dock, stops the engine, then installs.

## 3. Menu bar

Mac and Linux use Electron `Menu.buildFromTemplate` (real NSMenu on Mac). Windows keeps the compact web popover. Icon-only extra: `tray.setTitle("")`, current glyph unchanged. Hierarchy: live sessions (identity · doing · session tokens · session $) → Today (period total, `estimated` when `history_only`) → utilities. Click a session to open `/session/{id}`. More than five live rows: first five plus `N more in Aftertrace…`. Quiet 90s is not “needs you”. Approval-wait is `doing` from `blocked_on_user` / AskUserQuestion, not a savings finding. Findings stay in the dashboard. No plan-cap meter. `#/tray` is an unused prototype. An open NSMenu is not mutated; glance rebuilds the template every 45s for the next open.

## 4. Compact glyph

“Trace corner”: 18×18 template, one bend + endpoint, optical pad inside the ~22pt capsule. Not the retired 28×18 ECG. Scale evidence: `docs/screenshots/tray-glyph-scale.png` (capsule outline vs 18pt glyph bounds, 8×). Native capsule ≠ glyph bounds.

## 5. Recap header

Time and `$` are primary; sessions/commits/lines secondary; prose is quiet. No decorative chips. Empty: “Nothing ran this week.” Long numerals wrap (`recap-3` mock).
