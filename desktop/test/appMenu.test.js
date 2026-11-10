"use strict"

const { test } = require("node:test")
const assert = require("node:assert/strict")
const { appMenuTemplate, appMenuLabels } = require("../src/appMenu")

test("Mac Aftertrace menu puts Check for Updates… under About", () => {
  const labels = appMenuLabels({ isMac: true, appName: "Aftertrace", packaged: true })
  const about = labels.indexOf("about")
  const check = labels.indexOf("Check for Updates…")
  const hide = labels.indexOf("hide")
  assert.ok(about >= 0)
  assert.ok(check > about)
  assert.ok(hide > check)
})

test("Check for Updates… click is the hook", () => {
  let n = 0
  const template = appMenuTemplate({
    isMac: true,
    appName: "Aftertrace",
    packaged: true,
    onCheckUpdates: () => {
      n += 1
    },
  })
  const item = template[0].submenu.find((row) => row.id === "check-for-updates")
  assert.equal(item.label, "Check for Updates…")
  item.click()
  assert.equal(n, 1)
})

test("non-Mac File menu still has Check for Updates…", () => {
  const labels = appMenuLabels({ isMac: false, packaged: true })
  assert.ok(labels.includes("Check for Updates…"))
  assert.ok(labels.includes("quit") || labels.includes("File"))
})
