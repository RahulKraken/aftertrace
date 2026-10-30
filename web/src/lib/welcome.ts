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
