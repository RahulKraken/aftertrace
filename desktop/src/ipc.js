"use strict"

const { isUiOrigin } = require("./allowlist")

function senderUrl(event) {
  try {
    if (event && event.senderFrame && event.senderFrame.url) return String(event.senderFrame.url)
    if (event && event.sender && typeof event.sender.getURL === "function") return String(event.sender.getURL())
  } catch {
    // destroyed frame
  }
  return ""
}

function senderKind(event) {
  const raw = senderUrl(event)
  let url
  try {
    url = new URL(raw)
  } catch {
    return "unknown"
  }
  if (url.protocol === "file:") {
    const p = decodeURIComponent(url.pathname).replace(/\\/g, "/")
    if (p.endsWith("/renderer/popover.html")) return "popover"
    if (p.endsWith("/renderer/first-launch.html")) return "first-launch"
    if (p.endsWith("/renderer/waiting.html")) return "waiting"
    return "file"
  }
  if (isUiOrigin(url)) return "ui"
  return "unknown"
}

function allowSender(event, kinds) {
  const kind = senderKind(event)
  if (kinds.includes(kind)) return kind
  const err = new Error(`ipc denied from ${kind}`)
  err.code = "IPC_DENIED"
  throw err
}

function dashboardHash(raw) {
  if (raw == null || raw === "") return ""
  let s = String(raw).trim()
  if (s.length > 200) return ""
  s = s.replace(/^#/, "")
  if (!s.startsWith("/")) s = `/${s}`
  const qAt = s.indexOf("?")
  const pathPart = qAt === -1 ? s : s.slice(0, qAt)
  const query = qAt === -1 ? null : s.slice(qAt + 1)
  if (pathPart.includes("..")) return ""
  if (!/^\/[A-Za-z0-9/_-]*$/.test(pathPart)) return ""
  if (query != null && !/^[A-Za-z0-9_=-]*$/.test(query)) return ""
  return query != null ? `${pathPart}?${query}` : pathPart
}

module.exports = { senderUrl, senderKind, allowSender, dashboardHash }
