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
  observed_monthly: number
  headline: string
  shown: Finding[]
  folded: number
  folded_monthly: number
  fold_kind?: "smaller" | "more"
}

export type HomeOpts = {
  since_ns?: number
  history_only?: boolean
  observed_spend?: number
  window_days?: number
}

const SEV: Record<string, number> = { high: 3, medium: 2, low: 1 }

function monthFactor(days: number): number {
  const d = days > 0 ? Math.max(days, 1) : 30
  const f = 30 / d
  return f > 1 ? 1 : f
}

function observationDays(fs: Finding[], fallback: number): number {
  let minFirst = 0
  let maxLast = 0
  for (const f of fs) {
    if (f.first_ns && (minFirst === 0 || f.first_ns < minFirst)) minFirst = f.first_ns
    if (f.last_ns && f.last_ns > maxLast) maxLast = f.last_ns
  }
  if (minFirst > 0 && maxLast >= minFirst) {
    const d = (maxLast - minFirst) / 86400e9
    return d < 1 ? 1 : d
  }
  return fallback > 0 ? fallback : 30
}

export function monthlyUSD(f: Finding, windowDays?: number): number {
  if (f.severity === "error") return 0
  if (!f.impact_unit.startsWith("USD")) return 0
  if (!(f.impact_value > 0)) return 0
  const days = windowDays && windowDays > 0 ? windowDays : spanDays(f.first_ns, f.last_ns)
  const m = f.impact_value * monthFactor(days)
  return m > f.impact_value ? f.impact_value : m
}

export function homeHeadline(total: number): string {
  if (total < HOME_MIN_MONTHLY) return "Your setup looks lean. Here's what we saw this month."
  return `About ${sayUsd(total, true)}/month you could save`
}

export function cardMoney(monthly: number): string {
  if (!(monthly > 0)) return ""
  return `~${sayUsd(monthly, true)}/month`
}

export function shortTitle(f: Finding): string {
  switch (f.rule_id) {
    case "model.opus_downgrade":
      return "Sonnet for quick turns"
    case "cache.drop_after_compaction":
      return "Cache after compaction"
    case "mcp.large_results":
      return mcpTitle(f)
    case "model.switch_cache_rebuild":
      return "Stay on one model"
    case "tool.repeated_errors":
      return `Fix ${toolLead(f.headline)} failures`
    case "skill.cost":
      return skillTitle(f)
    case "hook.overhead":
      return "Slow PreToolUse hook"
    case "permission.allow_rule_candidate":
      return f.headline.replace(/,.+$/, "") || "Permission prompts"
    default:
      return (f.rule_title || f.headline || "").replace(/\.$/, "")
  }
}

function skillSlug(f: Finding): string {
  const m = (f.headline || "").match(/^Skill\s+(\S+)/i)
  return m ? m[1] : ""
}

function findingModel(f: Finding): string {
  const text = `${f.detail || ""} ${f.headline || ""}`
  if (/opus/i.test(text)) return "Opus"
  if (/sonnet/i.test(text)) return "Sonnet"
  if (/haiku/i.test(text)) return "Haiku"
  return ""
}

function titleCaseSlug(slug: string): string {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => (w.toLowerCase() === "pdf" ? "PDF" : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ")
}

function skillTitle(f: Finding): string {
  const slug = skillSlug(f)
  const model = findingModel(f)
  if (slug === "pdf-report") {
    return model ? `PDF report runs on ${model} at max effort` : "PDF report runs at max effort"
  }
  const human = titleCaseSlug(slug) || f.rule_title || f.headline.replace(/\.$/, "")
  return model ? `${human} on ${model}` : human
}

function mcpTitle(f: Finding): string {
  const name = (f.headline || "").trim().split(/\s+/)[0] || ""
  if (name.startsWith("mcp__")) {
    const parts = name.split("__").slice(1)
    const server = parts[0] ? parts[0].charAt(0).toUpperCase() + parts[0].slice(1) : ""
    const tool = parts.slice(1).join(" ")
    if (server && tool) return `Cap ${server} ${tool}`
    if (server) return `Cap ${server}`
  }
  return "Cap large MCP results"
}

export function homeSavings(fs: Finding[], opts: HomeOpts = {}): HomeSavings {
  const eligible = fs.filter((f) => homeEligible(f, opts))
  const days = opts.window_days && opts.window_days > 0 ? opts.window_days : observationDays(eligible, 0)
  const factor = monthFactor(days)
  const obsMonthly = opts.observed_spend && opts.observed_spend > 0 ? opts.observed_spend * factor : 0
  const rows = eligible
    .map((f) => ({ f, m: monthlyUSD(f, days) }))
    .filter((r) => r.m > 0)
  let total = rows.reduce((a, r) => a + r.m, 0)
  if (obsMonthly > 0 && total > obsMonthly) {
    const s = obsMonthly / total
    for (const r of rows) r.m *= s
    total = obsMonthly
  }
  rows.sort((a, b) => {
    if (a.m !== b.m) return b.m - a.m
    const ds = (SEV[b.f.severity] || 0) - (SEV[a.f.severity] || 0)
    if (ds) return ds
    if (a.f.rule_id !== b.f.rule_id) return a.f.rule_id < b.f.rule_id ? -1 : 1
    return a.f.id - b.f.id
  })
  const moneyHeadline = total >= HOME_MIN_MONTHLY
  const above = rows.filter((r) => r.m >= HOME_MIN_MONTHLY).length
  const fill = moneyHeadline && above === 0
  const shown: Finding[] = []
  let folded = 0
  let foldedMonthly = 0
  let foldMore = false
  for (const r of rows) {
    const take = shown.length < HOME_MAX_SHOWN && (r.m >= HOME_MIN_MONTHLY || fill)
    if (take) {
      shown.push({ ...r.f, monthly_usd: r.m })
      continue
    }
    folded++
    foldedMonthly += r.m
    if (r.m >= HOME_MIN_MONTHLY) foldMore = true
  }
  return {
    total_monthly: total,
    observed_monthly: obsMonthly,
    headline: homeHeadline(total),
    shown,
    folded,
    folded_monthly: foldedMonthly,
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
