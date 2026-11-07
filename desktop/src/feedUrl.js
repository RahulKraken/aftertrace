"use strict"

const { ciIntent } = require("./ciIntent")

// Local generic feed for disposable CI only. Production keeps GitHub
// Releases. Host must be 127.0.0.1 even when CI intent is present; this
// is not a public-internet override and not a signature bypass
// (electron-updater still requires the same Developer ID).

function localGenericFeedUrl(raw) {
  const fromEnv = arguments.length === 0
  if (fromEnv && !ciIntent()) return null
  const s = String((fromEnv ? process.env.AFTERTRACE_UPDATE_FEED_URL : raw) || "").trim()
  if (!s) return null
  let url
  try {
    url = new URL(s)
  } catch {
    return null
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null
  if (url.hostname !== "127.0.0.1") return null
  if (url.username || url.password) return null
  if (url.pathname && url.pathname !== "/") return null
  return `${url.protocol}//${url.host}/`
}

module.exports = { localGenericFeedUrl }
