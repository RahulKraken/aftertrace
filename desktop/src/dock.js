"use strict"

// Dashboard window visible → regular app (Dock + Cmd+Tab).
// Window closed → accessory again (menu bar + engine). Never always-Dock.

function setDashboardVisible(visible, { app, platform } = {}) {
  const plat = platform || process.platform
  const policy = visible ? "regular" : "accessory"
  if (plat !== "darwin") return { policy, skipped: true }
  if (!app) return { policy, skipped: true }
  // LSUIElement stays true in Info.plist (menu-bar default). Runtime policy
  // is what Dock + Cmd+Tab actually follow. Not always-Dock.
  if (typeof app.setActivationPolicy === "function") {
    app.setActivationPolicy(policy)
  }
  const dock = app.dock
  if (dock) {
    if (visible && typeof dock.show === "function") dock.show()
    if (!visible && typeof dock.hide === "function") dock.hide()
  }
  return { policy, skipped: false }
}

module.exports = { setDashboardVisible }
