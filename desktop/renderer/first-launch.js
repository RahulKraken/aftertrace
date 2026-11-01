"use strict"

const api = window.aftertraceDesktop
const trayWord = api && api.platform === "darwin" ? "menu bar" : "tray"

for (const el of document.querySelectorAll("[data-tray]")) el.textContent = trayWord

const box = document.getElementById("login")
const open = document.getElementById("open")

if (api) {
  api.getOpenAtLogin().then((v) => {
    box.checked = Boolean(v)
  })
}

box.addEventListener("change", () => {
  if (api) api.setOpenAtLogin(box.checked)
})

open.addEventListener("click", () => {
  open.disabled = true
  open.textContent = "Opening…"
  if (api) api.continueToApp()
})
