"use strict"

// Pure view-model for the menu-bar popover. Shared by the renderer and tests.

function sessionSlice(sessions, limit = 3) {
  const live = Array.isArray(sessions) ? sessions : []
  return {
    shown: live.slice(0, limit),
    more: Math.max(0, live.length - limit),
    idle: live.length === 0,
  }
}

function updateFooter(u) {
  const status = u && u.status
  if (status === "ready") {
    return {
      restart: true,
      label: u.version ? `Restart to update · v${String(u.version).replace(/^v/, "")}` : "Restart to update",
      disabled: false,
    }
  }
  if (status === "downloading") return { restart: false, label: "Downloading…", disabled: true }
  if (status === "checking") return { restart: false, label: "Checking…", disabled: true }
  if (status === "error") return { restart: false, label: "Retry update", disabled: false }
  return { restart: false, label: "Check for updates", disabled: false }
}

function freshnessKind(g) {
  if (!g || !g.ok) return g && g.error ? "offline" : "loading"
  return g.stale ? "stale" : "live"
}

const popoverView = { sessionSlice, updateFooter, freshnessKind }

if (typeof module === "object" && module.exports) module.exports = popoverView
if (typeof globalThis !== "undefined") globalThis.popoverView = popoverView
