"use strict"

const api = window.aftertraceDesktop
const title = document.getElementById("title")
const body = document.getElementById("body")
const log = document.getElementById("log")
const fixWrap = document.getElementById("fix-wrap")
const fixBtn = document.getElementById("fix")

function render(status) {
  if (!status) return
  if (fixWrap) fixWrap.hidden = true
  if (status.state === "replacing") {
    title.textContent = "Updating the local engine"
    body.textContent =
      status.error ||
      "An older Aftertrace login service was using this machine. Stopping it and starting the one in this app. Your database is kept."
    return
  }
  if (status.state === "reused") {
    title.textContent = "Connecting"
    body.textContent = "Aftertrace is already running on this machine. Opening it."
    return
  }
  if (status.state === "healthy") {
    title.textContent = "Opening"
    body.textContent = "The local engine is ready."
    return
  }
  if (status.state === "restarting") {
    title.textContent = "Starting again"
    body.textContent = "The engine stopped. Aftertrace is bringing it back."
  }
  if (status.state === "error") {
    title.textContent = "Could not start the engine"
    body.textContent = status.error || "The local engine did not become ready."
    if (status.logPath) {
      log.hidden = false
      log.textContent = "Log: " + status.logPath
    }
    if (fixWrap && /old login service|holding the database|already serving/i.test(status.error || "")) {
      fixWrap.hidden = false
    }
  }
}

if (fixBtn && api && api.fixForeignEngine) {
  fixBtn.addEventListener("click", () => {
    fixBtn.disabled = true
    api.fixForeignEngine().finally(() => {
      fixBtn.disabled = false
    })
  })
}

if (api) {
  api.engineStatus().then(render)
  api.onEngineStatus(render)
}
