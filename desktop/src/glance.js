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

function lanesFromOverview(overview) {
  const live = overview && Array.isArray(overview.live) ? overview.live : []
  return live.slice(0, 8).map((l) => ({
    session_id: l.session_id,
    trace_id: l.trace_id,
    title: l.title || null,
    doing: l.doing || "",
    running: true,
    // quiet means nothing new for 90s (thinking / long tool). Never "needs you".
    quiet: Boolean(l.quiet),
  }))
}

async function readGlance(origin, { now = Date.now() } = {}) {
  try {
    const status = await getJson(origin, "/api/status")
    let weekCost
    let todayCost
    let topFinding
    let topFindingId
    let sessions = []
    try {
      const overview = await getJson(origin, "/api/overview", 2500)
      if (overview && overview.week && typeof overview.week.cost_usd === "number") {
        weekCost = overview.week.cost_usd
      }
      todayCost = todayCostFromDays(overview && overview.days, now)
      sessions = lanesFromOverview(overview)
      const finding = pickFinding(overview)
      topFinding = finding.text
      topFindingId = finding.id
    } catch {
      // Overview is heavier; findings from /api/status are enough for a glance.
    }
    const running = Boolean(status.running || sessions.length)
    return {
      ok: true,
      stale: false,
      fetchedAt: now,
      findings: status.findings,
      weekCost,
      todayCost,
      running,
      sessions,
      topFinding,
      topFindingId,
      error: null,
    }
  } catch (err) {
    return {
      ok: false,
      stale: true,
      fetchedAt: now,
      sessions: [],
      error: err && err.message ? String(err.message) : "offline",
    }
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
}
