# Desktop shell (menu bar, Dock, updater)

The Electron app is a local shell around the Go engine. Glance at activity and cost without opening the dashboard; when the dashboard is open it is a normal Mac app.

Published **v0.5.3** stays on GitHub Releases until a separate approval. This tree is **0.5.4** so an installed v0.5.3 (whose `app.getVersion()` is `0.5.0`) can see a newer feed.

## 1. Updater

electron-updater 6.8.12 against GitHub Releases (`latest-mac.yml` arm64 zip only). Background check after 20s, then every 4 hours. Auto-download; **no auto-restart**. The user presses **Restart to update**. Quit after a download may install on the way out (`autoInstallOnAppQuit`) but does not relaunch.

Visible states: checking, downloading, ready, error / retry, up to date. Offline and cancelled downloads stay in error; the app keeps running.

`before-quit` stops the sidecar, then `quitAndInstall(false, true)` on Restart. Engine data lives in `~/.aftertrace` and survives.

**Identity (fail-closed).** Tag `vX.Y.Z`, `desktop/package.json`, updater yml `version:`, and `CHANGELOG.md` `## vX.Y.Z` must match. Package version must be newer than `0.5.0`. Mac feed must list `Aftertrace-mac-arm64.zip` and must not list an Intel zip. Checks: `node desktop/scripts/release-identity.cjs` (and with a `dist/` after pack) plus `EXPECT_DESKTOP_VERSION` in `scripts/verify-release-assets.sh`.

Privacy: the check contacts GitHub Releases. No usage telemetry. Logs strip `ghp_` / `github_pat_` tokens.

### Evidence: mock vs real Mac

| What | Kind |
| - | - |
| `desktop/test/updater.test.js` — 0.5.0 sees 0.5.4, downloads, stays running, Restart calls `quitAndInstall`, Later does not, offline/cancel are errors | **Unit / mock** |
| `desktop/test/quit.test.js` — sidecar stop then install | **Unit / mock** |
| Installed v0.5.3 (internal 0.5.0) → signed 0.5.4 zip on a Mac, engine/data survive | **Not run here** (no connected macOS GUI worker / pool). Needs a signed feed on a real Mac after parent approves a release. |

Do not treat unit tests as a real Mac upgrade test.

## 2. Dock / Cmd+Tab

`LSUIElement` stays true (menu-bar default). While the dashboard window is shown: `setActivationPolicy('regular')` + `dock.show()`. On close: accessory again, process stays (tray + engine). Reopen: tray, Dock click, `activate`, second instance. Closing the dashboard is not Quit. Restart-to-update hides the Dock, stops the engine, then installs.

## 3. Menu bar

Custom compact popover (Mac/Windows). Linux keeps a native menu. Hierarchy: sessions/activity → today’s spend → one finding → utilities. Freshness: live / stale / offline / starting. Quiet 90s is not “needs you”. No plan-cap or 5h meter (localStorage weekly cap and TrayPage inference are not a plan API). `#/tray` is an unused prototype.

## 4. Compact glyph

“Trace corner”: 18×18 template, one bend + endpoint, optical pad inside the ~22pt capsule. Not the retired 28×18 ECG. Scale evidence: `docs/screenshots/tray-glyph-scale.png` (capsule outline vs 18pt glyph bounds, 8×). Native capsule ≠ glyph bounds.

## 5. Recap header

Time and `$` are primary; sessions/commits/lines secondary; prose is quiet. No decorative chips. Empty: “Nothing ran this week.” Long numerals wrap (`recap-3` mock).
