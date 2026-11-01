"use strict"

const UI_HOST = "127.0.0.1"
const UI_PORT = "7311"

function fileIsRenderer(pathname) {
  const p = decodeURIComponent(pathname).replace(/\\/g, "/")
  return p.endsWith("/renderer/first-launch.html") || p.endsWith("/renderer/waiting.html")
}

function isUiOrigin(url) {
  return (
    (url.protocol === "http:" || url.protocol === "ws:") &&
    url.hostname === UI_HOST &&
    url.port === UI_PORT
  )
}

/** True when the window is allowed to navigate to this URL. */
function isAllowedUrl(raw) {
  let url
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.protocol === "devtools:") return true
  if (url.protocol === "about:" && (url.pathname === "blank" || url.pathname === "")) return true
  if (url.protocol === "file:") return fileIsRenderer(url.pathname)
  return isUiOrigin(url)
}

module.exports = { isAllowedUrl, UI_HOST, UI_PORT, UI_ORIGIN: `http://${UI_HOST}:${UI_PORT}` }
