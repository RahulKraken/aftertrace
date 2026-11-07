"use strict"

// Local generic feed for disposable CI only. Production keeps GitHub
// Releases. An attacker who can set env vars could still not point this
// at the public internet: host must be 127.0.0.1.

function localGenericFeedUrl(raw = process.env.AFTERTRACE_UPDATE_FEED_URL) {
  const s = String(raw || "").trim()
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
