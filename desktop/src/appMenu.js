"use strict"

function appMenuTemplate({
  isMac = process.platform === "darwin",
  appName = "Aftertrace",
  packaged = true,
  onCheckUpdates,
} = {}) {
  const checkItem = {
    id: "check-for-updates",
    label: "Check for Updates…",
    click: () => (typeof onCheckUpdates === "function" ? onCheckUpdates() : undefined),
  }
  const macApp = {
    label: appName,
    submenu: [
      { role: "about" },
      { type: "separator" },
      checkItem,
      { type: "separator" },
      { role: "hide" },
      { role: "hideOthers" },
      { role: "unhide" },
      { type: "separator" },
      { role: "quit" },
    ],
  }
  const template = [
    ...(isMac ? [macApp] : [{ label: "File", submenu: [checkItem, { type: "separator" }, { role: "quit" }] }]),
    { role: "editMenu" },
    { role: "windowMenu" },
    ...(!packaged
      ? [
          {
            label: "Develop",
            submenu: [{ role: "reload" }, { role: "toggleDevTools" }],
          },
        ]
      : []),
  ]
  return template
}

function appMenuLabels(opts) {
  const walk = (items) => {
    const out = []
    for (const item of items || []) {
      if (item.type === "separator") continue
      if (item.label) out.push(item.label)
      if (item.role && !item.label) out.push(item.role)
      if (item.submenu) out.push(...walk(item.submenu))
    }
    return out
  }
  return walk(appMenuTemplate(opts))
}

module.exports = { appMenuTemplate, appMenuLabels }
