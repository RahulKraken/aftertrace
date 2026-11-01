import { sayUsd } from "./format"
import type { Finding } from "./types"

// First-open advice: a plain action, then a labelled monthly saving (or an
// honest cost). Keep in step with internal/rules/welcome.go.

export function actionSentence(f: Finding): string {
  const place = inPlace(f.project)
  switch (f.rule_id) {
    case "model.opus_downgrade":
      return `Use Sonnet for quick replies${place}.`
    case "tool.repeated_errors":
      return `Fix the ${toolLead(f.headline)} that keeps failing${place}.`
    case "model.switch_cache_rebuild": {
      const pair = switchModels(f.headline)
      if (pair) return `Don't switch from ${modelFamily(pair[0])} to ${modelFamily(pair[1])} mid-session${place}.`
      return `Stay on one model for the whole session${place}.`
    }
    case "cache.drop_after_compaction":
      return `Start a new session between tasks${place}.`
    case "mcp.large_results":
      return `Ask ${mcpServer(f.headline)} for less at a time${place}.`
    default:
      return f.headline || f.rule_title || ""
  }
}

export function moneyLabel(f: Finding, span: string): string {
  if (!f.impact_unit.startsWith("USD")) return ""
  if (f.rule_id === "cache.drop_after_compaction") {
    return span ? `Cost ${usdAbout(f.impact_value, false)} over ${span}` : `Cost ${usdAbout(f.impact_value, false)}`
  }
  const days = spanDays(f.first_ns, f.last_ns)
  const monthly = (f.impact_value * 30) / days
  return `Saves about ${usdAbout(monthly, true)} a month`
}

function inPlace(project?: string): string {
  const p = (project || "").trim()
  if (!p || p === "unknown") return ""
  if (p.endsWith("projects")) return ` across ${p}`
  return ` in ${p}`
}

function toolLead(headline?: string): string {
  const name = (headline || "").trim().split(/\s+/)[0] || "tool"
  if (name.startsWith("mcp__")) {
    const parts = name.split("__")
    if (parts[1]) return parts[1]
  }
  return name
}

function mcpServer(headline?: string): string {
  const s = toolLead(headline)
  return !s || s === "tool" ? "the server" : s
}

function switchModels(headline?: string): [string, string] | null {
  const m = (headline || "").match(/^Switching (.+) to (.+?)(?: mid-session|$)/)
  if (!m) return null
  return [m[1].trim(), m[2].trim()]
}

function modelFamily(id: string): string {
  const s = id.toLowerCase()
  if (s.includes("opus")) return "Opus"
  if (s.includes("sonnet")) return "Sonnet"
  if (s.includes("haiku")) return "Haiku"
  const rest = s.replace(/^claude-/, "").split("-")[0]
  if (!rest) return "the model"
  return rest[0].toUpperCase() + rest.slice(1)
}

function spanDays(first?: number, last?: number): number {
  if (!first || !last || last < first) return 30
  const d = (last - first) / 86400e9
  return d < 1 ? 1 : d
}

function usdAbout(v: number, whole: boolean): string {
  return sayUsd(v, whole)
}

export const HOME_MIN_MONTHLY = 1
export const HOME_MAX_SHOWN = 3

export type HomeSavings = {
  total_monthly: number
  headline: string
  shown: Finding[]
  folded: number
  fold_kind?: "smaller" | "more"
}

const SEV: Record<string, number> = { high: 3, medium: 2, low: 1 }

export function monthlyUSD(f: Finding): number {
  if (f.severity === "error") return 0
  if (!f.impact_unit.startsWith("USD")) return 0
  if (!(f.impact_value > 0)) return 0
  return (f.impact_value * 30) / spanDays(f.first_ns, f.last_ns)
}

export function homeHeadline(total: number): string {
  if (total < HOME_MIN_MONTHLY) return "Your setup looks lean. Here's what we saw this month."
  return `About ${sayUsd(total, true)}/month you could save`
}

export function cardMoney(monthly: number): string {
  if (!(monthly > 0)) return ""
  return `~${sayUsd(monthly, true)}/month`
}

export function homeSavings(
  fs: Finding[],
  opts: { since_ns?: number; history_only?: boolean } = {},
): HomeSavings {
  const rows = fs
    .filter((f) => homeEligible(f, opts))
    .map((f) => ({ f, m: monthlyUSD(f) }))
    .filter((r) => r.m > 0)
  rows.sort((a, b) => {
    if (a.m !== b.m) return b.m - a.m
    const ds = (SEV[b.f.severity] || 0) - (SEV[a.f.severity] || 0)
    if (ds) return ds
    if (a.f.rule_id !== b.f.rule_id) return a.f.rule_id < b.f.rule_id ? -1 : 1
    return a.f.id - b.f.id
  })
  const total = rows.reduce((a, r) => a + r.m, 0)
  const shown: Finding[] = []
  let folded = 0
  let foldMore = false
  for (const r of rows) {
    if (r.m >= HOME_MIN_MONTHLY && shown.length < HOME_MAX_SHOWN) {
      shown.push(r.f)
      continue
    }
    folded++
    if (r.m >= HOME_MIN_MONTHLY) foldMore = true
  }
  return {
    total_monthly: total,
    headline: homeHeadline(total),
    shown,
    folded,
    fold_kind: folded ? (foldMore ? "more" : "smaller") : undefined,
  }
}

function homeEligible(f: Finding, opts: { since_ns?: number; history_only?: boolean }): boolean {
  if (f.severity === "error") return false
  if (!f.impact_unit.startsWith("USD")) return false
  if (opts.history_only && !f.estimated) return false
  if (opts.since_ns && f.last_ns && f.last_ns < opts.since_ns) return false
  return true
}
