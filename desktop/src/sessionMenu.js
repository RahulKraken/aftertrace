"use strict"

const { clip, sayUsd } = require("./glance")

const MAX_LIVE = 5
const DEFAULT_VARIANT = "identity"

function finiteNumber(v) {
  return typeof v === "number" && Number.isFinite(v)
}

// Unknown is omitted. A real 0 is also omitted so a missing measurement
// cannot be read as "zero tokens / $0.00".
function knownAmount(v) {
  return finiteNumber(v) && v > 0
}

function joinParts(parts) {
  return (parts || []).map((p) => String(p || "").trim()).filter(Boolean).join(" · ")
}

function sayMenuUsd(v) {
  if (!knownAmount(v)) return ""
  return sayUsd(v)
}

// Compact token count without a "tok" suffix — the sublabel is amounts.
function sayCompactTok(v) {
  if (!knownAmount(v)) return ""
  const abs = Math.abs(v)
  if (abs >= 1e6) return `${(abs / 1e6).toFixed(abs >= 1e7 ? 1 : 2)}M`
  if (abs >= 1e3) return `${(abs / 1e3).toFixed(abs >= 1e4 ? 0 : 1)}k`
  return `${Math.round(abs)}`
}

function shortDisambiguator(v) {
  const s = String(v || "").trim()
  if (!s) return ""
  if (s === "cli" || s === "claude-code" || s.startsWith("claude-code")) return "CLI"
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
  const tool = shortDisambiguator((session && session.entrypoint) || (session && session.source) || "")
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
    const dups = rows.filter((s) => !String(s.repo || "").trim() && shortDisambiguator(s.entrypoint || s.source) === tool)
    if (dups.length > 1 && tail) return `${tool} · ${tail}`
    return tool
  }
  return tail ? `session ${tail}` : "session"
}

function activityFor(session) {
  let d = String((session && session.doing) || "").replace(/\s+/g, " ").trim()
  // Drop trailing model names; the row is identity + activity + amounts.
  d = d.replace(/\s*·\s*(Opus|Sonnet|Haiku|GPT-?\d|Gemini|o\d)\b.*$/i, "").trim()
  return clip(d, 36)
}

function amountsLine(session) {
  return joinParts([sayCompactTok(session && session.tokens), sayMenuUsd(session && session.cost_usd)])
}

function normalizeVariant(v) {
  return v === "activity" ? "activity" : "identity"
}

function envVariant() {
  return normalizeVariant(process.env.AFTERTRACE_MENU_VARIANT)
}

let currentVariant = envVariant()

function setMenuVariant(v) {
  currentVariant = normalizeVariant(v)
  return currentVariant
}

function getMenuVariant() {
  return currentVariant
}

function darwinMajorMinor(ver) {
  const m = String(ver || "").trim().match(/^(\d+)\.(\d+)/)
  if (!m) return null
  return { major: Number(m[1]), minor: Number(m[2]) }
}

function osVersion() {
  if (typeof process.getSystemVersion === "function") {
    try {
      return process.getSystemVersion() || ""
    } catch {
      return ""
    }
  }
  return ""
}

// Electron maps sublabel → NSMenuItem.subtitle on macOS >= 14.4.
function supportsSublabel(version = osVersion(), platform = process.platform) {
  if (platform !== "darwin") return false
  const mm = darwinMajorMinor(version)
  if (!mm) return false
  return mm.major > 14 || (mm.major === 14 && mm.minor >= 4)
}

// Electron type: "header" is macOS 14+.
function supportsHeader(version = osVersion(), platform = process.platform) {
  if (platform !== "darwin") return false
  const mm = darwinMajorMinor(version)
  if (!mm) return false
  return mm.major >= 14
}

function sessionCopy(session, shown = [], variant = DEFAULT_VARIANT, sublabelSupported = false) {
  const identity = identFor(session, shown)
  const activity = activityFor(session)
  const amounts = amountsLine(session)
  let label
  let rest
  if (variant === "activity") {
    label = activity || identity
    rest = joinParts(label === identity ? [amounts] : [identity, amounts])
  } else {
    label = identity
    rest = joinParts([activity, amounts])
  }
  if (sublabelSupported && rest) return { label, sublabel: rest }
  return { label: joinParts([label, rest]) }
}

function formatSessionLine(session, shown = [], variant = DEFAULT_VARIANT) {
  return sessionCopy(session, shown, variant, false).label
}

function formatTodayLine({ ok, todayCost, estimated } = {}) {
  if (!ok || !knownAmount(todayCost)) return ""
  const money = sayMenuUsd(todayCost)
  return estimated ? `Today ${money} estimated` : `Today ${money}`
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

function itemText(item) {
  if (!item || !item.label) return ""
  return joinParts([item.label, item.sublabel])
}

function menuLabels(view, handlers) {
  return menuTemplate(view, handlers)
    .map(itemText)
    .filter((label) => label.length > 0)
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
  const variant = normalizeVariant(handlers.variant != null ? handlers.variant : getMenuVariant())
  const sublabelSupported =
    handlers.sublabelSupported != null ? Boolean(handlers.sublabelSupported) : supportsSublabel()
  const headerSupported =
    handlers.headerSupported != null ? Boolean(handlers.headerSupported) : supportsHeader()
  const items = []
  if (!view.ok) {
    const label = view.alive
      ? view.busy
        ? "Engine busy"
        : "Starting…"
      : view.error
        ? "Engine offline"
        : "Starting…"
    items.push({ label, enabled: false })
  } else {
    const sliced = sessionSlice(view.sessions)
    if (sliced.idle) {
      items.push({ label: "Idle", enabled: false })
    } else {
      for (const s of sliced.shown) {
        const id = s && s.session_id
        const copy = sessionCopy(s, sliced.shown, variant, sublabelSupported)
        const row = {
          label: copy.label,
          click: () => {
            if (id && typeof onOpenSession === "function") onOpenSession(id)
            else if (typeof onOpen === "function") onOpen()
          },
        }
        if (copy.sublabel) row.sublabel = copy.sublabel
        items.push(row)
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
      if (headerSupported) items.push({ type: "header", label: today })
      else items.push({ label: today, enabled: false })
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
      label: update.version ? `Restart to update · v${String(update.version).replace(/^v/, "")}` : "Restart to update",
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
  DEFAULT_VARIANT,
  knownAmount,
  sayCompactTok,
  sayMenuUsd,
  shortDisambiguator,
  identFor,
  activityFor,
  amountsLine,
  sessionCopy,
  formatSessionLine,
  formatTodayLine,
  sessionSlice,
  isWaiting,
  menuLabels,
  menuTemplate,
  updateFooterLabel,
  setMenuVariant,
  getMenuVariant,
  supportsSublabel,
  supportsHeader,
  darwinMajorMinor,
  osVersion,
}
