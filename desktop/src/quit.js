"use strict"

// Stop the sidecar before Electron quits so quitAndInstall can take over
// the process. A hung stop must not block an update forever.

function withTimeout(promise, ms) {
  let t
  const timeout = new Promise((resolve) => {
    t = setTimeout(resolve, ms)
    if (typeof t.unref === "function") t.unref()
  })
  return Promise.race([Promise.resolve(promise).catch(() => {}), timeout]).finally(() => {
    clearTimeout(t)
  })
}

async function finishQuit({
  stopEngine,
  restartingForUpdate,
  requestInstall,
  quit,
  stopTimeoutMs = 8000,
} = {}) {
  await withTimeout(stopEngine ? stopEngine() : undefined, stopTimeoutMs)
  if (restartingForUpdate && typeof requestInstall === "function" && requestInstall({ relaunch: true })) {
    return "install"
  }
  if (typeof quit === "function") quit()
  return "quit"
}

module.exports = { finishQuit, withTimeout }
