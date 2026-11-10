"use strict"

const http = require("http")

const STALE_MS = 90_000

function sayUsd(v) {
  if (v == null || Number.isNaN(v)) return ""
  const neg = v < 0
  const abs = Math.abs(v)
  let s
  if (abs < 1) {
    let cents = Math.round(abs * 100)
    if (cents === 0 && abs > 0) cents = 1
    s = `${cents}¢`
  } else {
    s = `$${abs.toFixed(2)}`
  }
  return neg ? `-${s}` : s
}

function clip(s, n = 36) {
  const t = String(s || "").replace(/\s+/g, " ").trim()
  if (t.length <= n) return t
  return `${t.slice(0, n - 1)}…`
}

function formatTitle(data = {}) {
  if (!data.ok) return ""
  const live = (data.sessions || []).filter((s) => s && s.running)
  if (live[0]) return clip(live[0].doing || live[0].title || "Running", 28)
  return ""
}

function formatGlance({ ok, todayCost, weekCost, findings, running } = {}) {
  if (!ok) return "Starting…"
  const parts = []
  if (typeof todayCost === "number" && todayCost > 0) parts.push(`${sayUsd(todayCost)} today`)
  else if (typeof weekCost === "number" && weekCost > 0) parts.push(`${sayUsd(weekCost)} this week`)
  if (running) parts.push("running")
  if (typeof findings === "number" && findings > 0) {
    parts.push(findings === 1 ? "1 finding" : `${findings} findings`)
  }
  return parts.length ? parts.join(" · ") : "Open Aftertrace"
}

function freshnessLabel(data, now = Date.now()) {
  if (!data || !data.ok) return data && data.error ? "Engine offline" : "Starting…"
  if (data.stale) return "Engine data is stale"
  const at = data.fetchedAt || now
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 5) return "Updated just now"
  if (s < 60) return `Updated ${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `Updated ${m}m ago`
  return `Updated ${Math.floor(m / 60)}h ago`
}

function getJson(origin, path, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    let url
    try {
      url = new URL(path, origin)
    } catch (err) {
      reject(err)
      return
    }
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      const chunks = []
      res.on("data", (c) => chunks.push(c))
      res.on("end", () => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`))
          return
        }
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"))
        } catch (err) {
          reject(err)
        }
      })
    })
    req.on("error", reject)
    req.on("timeout", () => {
      req.destroy()
      reject(new Error("timeout"))
    })
  })
}

function todayCostFromDays(days, now = Date.now()) {
  if (!Array.isArray(days) || !days.length) return undefined
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const todayNs = start.getTime() * 1e6
  const hit = days.find((d) => typeof d.start_ns === "number" && d.start_ns >= todayNs && d.start_ns < todayNs + 86400e9)
  const row = hit || days[days.length - 1]
  return row && typeof row.cost_usd === "number" ? row.cost_usd : undefined
}

function pickFinding(overview) {
  const shown = overview && overview.savings && overview.savings.shown
  const top = (Array.isArray(shown) && shown[0]) || (overview && overview.top) || null
  if (!top) return { text: undefined, id: null }
  const text = top.action || top.headline
  if (!text) return { text: undefined, id: null }
  return { text: clip(text, 88), id: top.id != null ? String(top.id) : null }
}

function numOrUndef(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined
}

function sessionIndex(rows) {
  const byId = new Map()
  if (!Array.isArray(rows)) return byId
  for (const row of rows) {
    if (row && row.session_id) byId.set(row.session_id, row)
  }
  return byId
}

// Live lanes carry doing/quiet/source. /api/sessions (not overview.recent)
// carries repo/tokens/cost for long-lived ids that fell out of the six newest.
function joinLiveSessions(overview, sessionRows) {
  const live = overview && Array.isArray(overview.live) ? overview.live : []
  const byId = sessionIndex(sessionRows)
  return live.map((l) => {
    const row = (l.session_id && byId.get(l.session_id)) || {}
    const cost = numOrUndef(row.cost_usd)
    return {
      session_id: l.session_id || "",
      trace_id: l.trace_id || "",
      title: l.title || row.title || null,
      doing: l.doing || "",
      running: true,
      // quiet means nothing new for 90s (thinking / long tool). Never "needs you".
      quiet: Boolean(l.quiet),
      source: l.source || "",
      last_ns: typeof l.last_ns === "number" ? l.last_ns : undefined,
      repo: row.repo || "",
      entrypoint: row.entrypoint || "",
      tokens: numOrUndef(row.tokens),
      cost_usd: cost != null ? cost : numOrUndef(l.cost_usd),
      models: Array.isArray(row.models) ? row.models : [],
    }
  })
}

async function readGlance(origin, { now = Date.now(), last = null, processAlive = false } = {}) {
  let health = null
  try {
    health = await getJson(origin, "/api/health", 800)
  } catch {
    health = null
  }
  const alive = Boolean((health && health.ok) || processAlive)
  if (!alive) {
    return {
      ok: false,
      alive: false,
      stale: true,
      fetchedAt: now,
      sessions: (last && last.sessions) || [],
      estimated: false,
      error: last && last.ok ? "offline" : null,
    }
  }
  try {
    const g = await getJson(origin, "/api/glance", 1500)
    if (g && typeof g === "object") {
      const sessions = Array.isArray(g.sessions) ? g.sessions : []
      return {
        ok: true,
        alive: true,
        stale: false,
        busy: Boolean(g.busy || (health && health.busy)),
        fetchedAt: now,
        findings: g.findings,
        weekCost: numOrUndef(g.week_cost),
        todayCost: numOrUndef(g.today_cost),
        estimated: Boolean(g.estimated),
        running: Boolean(g.running || sessions.length),
        sessions,
        topFinding: g.top_finding || undefined,
        topFindingId: g.top_finding_id != null ? String(g.top_finding_id) : null,
        error: null,
      }
    }
  } catch {
    // Engine is up; glance may still be building. Keep the last good row.
  }
  if (last && last.ok) {
    return { ...last, ok: true, alive: true, stale: true, busy: true, error: null }
  }
  return {
    ok: true,
    alive: true,
    stale: false,
    busy: Boolean(health && (health.busy || health.ready === false)),
    fetchedAt: now,
    sessions: [],
    estimated: false,
    error: null,
  }
}

function markStale(data, now = Date.now()) {
  if (!data || !data.ok) return { ...data, stale: true }
  const age = now - (data.fetchedAt || 0)
  return { ...data, stale: age > STALE_MS }
}

module.exports = {
  formatGlance,
  formatTitle,
  readGlance,
  sayUsd,
  getJson,
  freshnessLabel,
  markStale,
  clip,
  STALE_MS,
  todayCostFromDays,
  pickFinding,
  joinLiveSessions,
}
