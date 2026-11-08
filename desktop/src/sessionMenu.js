"use strict"

const { sayUsd, clip } = require("./glance")

const MAX_LIVE = 5

function finiteNumber(v) {
  return typeof v === "number" && Number.isFinite(v)
}

// Unknown is omitted. A real 0 is also omitted on the compact line so a
// missing measurement cannot be read as "zero tokens / $0".
function knownAmount(v) {
  return finiteNumber(v) && v > 0
}

function sayTok(v) {
  if (!knownAmount(v)) return ""
  const abs = Math.abs(v)
  if (abs >= 1e6) return `${(abs / 1e6).toFixed(abs >= 1e7 ? 1 : 2)}M tok`
  if (abs >= 1e3) return `${(abs / 1e3).toFixed(abs >= 1e4 ? 0 : 1)}k tok`
  return `${Math.round(abs)} tok`
}

function shortTool(v) {
  const s = String(v || "").trim()
  if (!s) return ""
  if (s === "cli" || s === "claude-code" || s.startsWith("claude-code")) return "Claude Code"
  if (/vscode|vs code/i.test(s)) return "VS Code"
  if (/desktop/i.test(s)) return "Desktop"
  return s
}

function sessionTail(id) {
  const t = String(id || "").replace(/-/g, "")
  return t ? t.slice(-4) : ""
}

function identFor(session, shown = []) {
  const repo = String((session && session.repo) || "").trim()
  const tool = shortTool((session && session.entrypoint) || (session && session.source) || "")
  const tail = sessionTail(session && session.session_id)
  const rows = Array.isArray(shown) ? shown : []
  if (repo) {
    const dups = rows.filter((s) => String(s.repo || "").trim() === repo)
    if (dups.length > 1) {
      if (tool) return `${repo} · ${tool}`
      if (tail) return `${repo} · ${tail}`
    }
    return repo
  }
  if (tool) {
    const dups = rows.filter((s) => !String(s.repo || "").trim() && shortTool(s.entrypoint || s.source) === tool)
    if (dups.length > 1 && tail) return `${tool} · ${tail}`
    return tool
  }
  return tail ? `session ${tail}` : "session"
}

function formatSessionLine(session, shown = []) {
  const s = session || {}
  const parts = [identFor(s, shown)]
  const doing = clip(s.doing || "", 32)
  if (doing) parts.push(doing)
  const tok = sayTok(s.tokens)
  if (tok) parts.push(tok)
  if (knownAmount(s.cost_usd)) parts.push(sayUsd(s.cost_usd))
  return parts.join(" · ")
}

function formatTodayLine({ ok, todayCost, estimated } = {}) {
  if (!ok || !knownAmount(todayCost)) return ""
  const money = sayUsd(todayCost)
  return estimated ? `Today · ${money} · estimated` : `Today · ${money}`
}

function sessionSlice(sessions, limit = MAX_LIVE) {
  const live = Array.isArray(sessions) ? sessions : []
  return {
    shown: live.slice(0, limit),
    more: Math.max(0, live.length - limit),
    idle: live.length === 0,
  }
}

function isWaiting(session) {
  const d = String((session && session.doing) || "")
  return /^Waiting for your (answer|approval)/.test(d)
}

function menuLabels(view) {
  return menuTemplate(view)
    .map((item) => item.label)
    .filter((label) => typeof label === "string" && label.length > 0)
}

function menuTemplate(view = {}, handlers = {}) {
  const {
    onOpen,
    onOpenSession,
    onToggleLogin,
    onCheckUpdates,
    onRestart,
    onQuit,
    openAtLogin,
  } = handlers
  const items = []
  if (!view.ok) {
    items.push({ label: view.error ? "Engine offline" : "Starting…", enabled: false })
  } else {
    const sliced = sessionSlice(view.sessions)
    if (sliced.idle) {
      items.push({ label: "Idle", enabled: false })
    } else {
      for (const s of sliced.shown) {
        const id = s && s.session_id
        items.push({
          label: formatSessionLine(s, sliced.shown),
          click: () => {
            if (id && typeof onOpenSession === "function") onOpenSession(id)
            else if (typeof onOpen === "function") onOpen()
          },
        })
      }
      if (sliced.more) {
        items.push({
          label: `${sliced.more} more in Aftertrace…`,
          click: () => (typeof onOpen === "function" ? onOpen("/sessions") : undefined),
        })
      }
    }
    const today = formatTodayLine(view)
    if (today) {
      items.push({ type: "separator" })
      items.push({ label: today, enabled: false })
    }
  }
  const update = view.update
  items.push({ type: "separator" })
  items.push({
    label: "Open Aftertrace",
    accelerator: "CommandOrControl+O",
    click: () => (typeof onOpen === "function" ? onOpen() : undefined),
  })
  items.push({
    label: "Start at login",
    type: "checkbox",
    checked: Boolean(openAtLogin),
    click: onToggleLogin,
  })
  if (update && update.status === "ready") {
    items.push({
      label: update.version ? `Restart to update · ${update.version}` : "Restart to update",
      click: onRestart,
    })
  } else {
    items.push({
      label: updateFooterLabel(update),
      enabled: updateFooterEnabled(update),
      click: onCheckUpdates,
    })
  }
  items.push({ type: "separator" })
  items.push({ label: "Quit Aftertrace", click: onQuit })
  return items
}

function updateFooterLabel(update) {
  const status = update && update.status
  if (status === "downloading") return "Downloading…"
  if (status === "checking") return "Checking…"
  if (status === "error") return "Retry update"
  return "Check for updates"
}

function updateFooterEnabled(update) {
  const status = update && update.status
  return status !== "downloading" && status !== "checking"
}

module.exports = {
  MAX_LIVE,
  knownAmount,
  sayTok,
  shortTool,
  identFor,
  formatSessionLine,
  formatTodayLine,
  sessionSlice,
  isWaiting,
  menuLabels,
  menuTemplate,
  updateFooterLabel,
}
