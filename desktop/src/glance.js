"use strict"

const http = require("http")

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

async function readGlance(origin) {
  try {
    const status = await getJson(origin, "/api/status")
    let weekCost
    let todayCost
    let runningTitle
    let topFinding
    try {
      const overview = await getJson(origin, "/api/overview", 2500)
      if (overview && overview.week && typeof overview.week.cost_usd === "number") {
        weekCost = overview.week.cost_usd
      }
      const days = overview && overview.days
      if (Array.isArray(days) && days.length) {
        todayCost = days[days.length - 1].cost_usd
      }
      if (overview && Array.isArray(overview.live) && overview.live[0]) {
        runningTitle = overview.live[0].title || overview.live[0].doing || "Running"
      }
      const shown = overview && overview.savings && overview.savings.shown
      if (Array.isArray(shown) && shown[0] && shown[0].headline) {
        topFinding = shown[0].headline
      } else if (overview && overview.top && overview.top.headline) {
        topFinding = overview.top.headline
      }
    } catch {
      // Overview is heavier; findings from /api/status are enough for a glance.
    }
    return {
      ok: true,
      findings: status.findings,
      weekCost,
      todayCost,
      running: Boolean(status.running || runningTitle),
      runningTitle,
      topFinding,
    }
  } catch {
    return { ok: false }
  }
}

module.exports = { formatGlance, readGlance, sayUsd, getJson }
