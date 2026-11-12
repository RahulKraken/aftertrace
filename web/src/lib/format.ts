import type { Breakdown, Finding } from "./types"

export const CATS: (keyof Breakdown)[] = [
  "model",
  "tool",
  "permission_wait",
  "retry",
  "hook",
  "permission_check",
  "other",
]

export const CAT_LABEL: Record<keyof Breakdown, string> = {
  model: "model",
  tool: "tool run",
  permission_wait: "waiting on you",
  retry: "retry waste",
  hook: "hooks",
  permission_check: "permission checks",
  other: "other",
}

export function dur(ms: number | null | undefined): string {
  if (ms == null || Number.isNaN(ms)) return "—"
  const neg = ms < 0 ? "-" : ""
  const abs = Math.abs(ms)
  if (abs < 1000) return `${neg}${Math.round(abs)}ms`
  if (abs < 60_000) {
    const s = abs / 1000
    if (s < 10) return `${neg}${s.toFixed(1)}s`
    if (Math.abs(s - Math.round(s)) < 0.05) return `${neg}${Math.round(s)}s`
    return `${neg}${s.toFixed(1)}s`
  }
  const m = Math.floor(abs / 60_000)
  const s = Math.round((abs % 60_000) / 1000)
  if (m < 60) return s === 0 ? `${neg}${m}m` : `${neg}${m}m ${s}s`
  const h = Math.floor(m / 60)
  const rm = m % 60
  return rm === 0 ? `${neg}${h}h` : `${neg}${h}h ${rm}m`
}

// One money rule everywhere: 2 decimals, "<$0.01" for tiny amounts,
// no cents at $100 and above. Never 3-decimal values.
export function usd(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—"
  const neg = v < 0
  const abs = Math.abs(v)
  const sign = neg ? "-" : ""
  if (abs === 0) return "$0.00"
  if (abs < 0.01) return `${sign}<$0.01`
  if (abs >= 100) return `${sign}$${Math.round(abs)}`
  return `${sign}$${abs.toFixed(2)}`
}

// A running session's cost is the session total everywhere (Home, Sessions,
// tray, menu bar). Live-lane turn spend is only a fallback when no session row exists.
export function runCost(
  session?: { cost_usd?: number | null } | null,
  live?: { cost_usd?: number | null } | null,
): number {
  if (session != null && typeof session.cost_usd === "number") return session.cost_usd
  if (live != null && typeof live.cost_usd === "number") return live.cost_usd
  return 0
}

function compact(n: number, suffix: string): string {
  const digits = n >= 100 ? 0 : n >= 10 ? 1 : 2
  return `${n.toFixed(digits).replace(/\.?0+$/, "")}${suffix}`
}

export function tok(v: number | null | undefined): string {
  if (v == null) return "—"
  const neg = v < 0 ? "-" : ""
  const abs = Math.abs(v)
  if (abs >= 1e6) return `${neg}${compact(abs / 1e6, "M")}`
  if (abs >= 1e3) return `${neg}${compact(abs / 1e3, "k")}`
  return `${neg}${Math.round(abs)}`
}

// Spoken forms for sentences and headlines. Tables keep dur / usd / tok.

export function sayDur(ms: number | null | undefined): string {
  if (ms == null || Number.isNaN(ms)) return ""
  const neg = ms < 0
  const abs = Math.abs(ms)
  let s: string
  if (abs < 1000) {
    const n = Math.round(abs)
    s = n === 0 ? "0s" : `${n}ms`
  } else if (abs < 60_000) {
    s = `${Math.round(abs / 1000)}s`
  } else if (abs < 3_600_000) {
    s = `${Math.round(abs / 60_000)} min`
  } else {
    let h = Math.floor(abs / 3_600_000)
    let min = Math.round((abs % 3_600_000) / 60_000)
    if (min === 60) {
      h++
      min = 0
    }
    if (h >= 24) {
      const d = Math.floor(h / 24)
      h = h % 24
      s = h === 0 ? `${d}d` : `${d}d ${h}h`
    } else {
      s = min === 0 ? `${h}h` : `${h}h ${min} min`
    }
  }
  return neg ? `-${s}` : s
}

export function sayUsd(v: number | null | undefined, _whole = false): string {
  if (v == null || Number.isNaN(v)) return ""
  const s = usd(v)
  return s === "—" ? "" : s
}

export function clock(ns: number | null | undefined): string {
  if (ns == null) return ""
  return new Date(ns / 1e6).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
}

export function remain(ms: number): string {
  if (!(ms > 0) || !Number.isFinite(ms)) return ""
  const tot = Math.round(ms / 60000)
  const h = Math.floor(tot / 60)
  const m = tot % 60
  if (h <= 0) return `${m}m`
  return `${h}h ${m}m`
}

export function hm(ms: number): { h: number; m: number } {
  const tot = Math.max(0, Math.round(ms / 60000))
  return { h: Math.floor(tot / 60), m: tot % 60 }
}

export function moneyParts(v: number | null | undefined): { whole: string; cents: string } | null {
  if (v == null || Number.isNaN(v)) return null
  return { whole: usd(v), cents: "" }
}

export function sayTok(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return ""
  const neg = v < 0
  const abs = Math.abs(v)
  const compact = (n: number, suffix: string) => {
    if (n >= 10 || Math.abs(n - Math.round(n)) < 0.05) return `${Math.round(n)}${suffix}`
    return `${n.toFixed(1)}${suffix}`.replace(`.0${suffix}`, suffix)
  }
  let s: string
  if (abs >= 1e6) s = compact(abs / 1e6, "M")
  else if (abs >= 1e3) s = compact(abs / 1e3, "k")
  else s = String(Math.round(abs))
  return neg ? `-${s}` : s
}

export function pct(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—"
  const n = v <= 1 ? v * 100 : v
  if (n > 0 && n < 1) return "<1%"
  return `${Math.round(n)}%`
}

// Headline durations: 49m, 2m. Tables and rows keep seconds via dur().
export function durHead(ms: number | null | undefined): string {
  if (ms == null || Number.isNaN(ms)) return "—"
  const neg = ms < 0 ? "-" : ""
  const abs = Math.abs(ms)
  if (abs < 45_000) return dur(ms)
  const m = Math.round(abs / 60_000)
  if (m < 60) return `${neg}${m}m`
  const h = Math.floor(m / 60)
  const rm = m % 60
  return rm ? `${neg}${h}h ${rm}m` : `${neg}${h}h`
}

export function when(ns: number | null | undefined): { date: string; time: string } {
  if (ns == null) return { date: "", time: "" }
  const d = new Date(ns / 1e6)
  return {
    date: d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }),
    time: d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
  }
}

export function wallClock(ns: number): string {
  const d = new Date(ns / 1e6)
  return d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

export function shortId(id: string | null | undefined, n = 8): string {
  if (!id) return ""
  return id.slice(0, n)
}

export function modelShort(m: string | null | undefined): string {
  return (m || "").replace(/^claude-/, "")
}

// A model id as people say it: claude-opus-5-5 → Opus 5.5, gpt-4o-mini → GPT-4o mini.
export function modelName(m: string | null | undefined): string {
  const id = (m || "").replace(/^(anthropic|openai|google)[/.]/, "").replace(/-\d{8}$/, "")
  if (!id) return ""
  const claude = id.match(/^claude-([a-z]+)-(\d+)(?:-(\d+))?/)
  if (claude) return `${claude[1][0].toUpperCase()}${claude[1].slice(1)} ${claude[2]}${claude[3] ? `.${claude[3]}` : ""}`
  if (/^gpt-/i.test(id)) return id.replace(/^gpt/i, "GPT").replace(/-(mini|nano|pro)$/, " $1")
  if (/^gemini-/i.test(id)) return id.replace(/^gemini-/i, "Gemini ").replace(/-/g, " ")
  return id
}

// How to print a finding's impact value, for counting it up in place.
export function impactFormat(f: Finding): (n: number) => string {
  if (f.impact_unit.startsWith("USD")) return usd
  if (f.impact_unit.startsWith("s")) return (n) => dur(n * 1000)
  return (n) => String(Math.round(n))
}

export function impactParts(f: Finding): [string, string] {
  if (f.impact_unit.startsWith("USD")) return [usd(f.impact_value), f.impact_unit.slice(4).trim()]
  if (f.impact_unit.startsWith("s ")) return [dur(f.impact_value * 1000), f.impact_unit.slice(2).trim()]
  if (f.impact_unit === "s waited" || f.impact_unit === "s stalled" || f.impact_unit.startsWith("s ")) {
    return [dur(f.impact_value * 1000), f.impact_unit.replace(/^s\s*/, "")]
  }
  return [String(f.impact_value), f.impact_unit]
}

export function median(arr: (number | null | undefined)[]): number | null {
  const a = arr.filter((x): x is number => x != null).sort((x, y) => x - y)
  if (!a.length) return null
  return a[Math.floor(a.length / 2)]
}

export function sum(arr: (number | null | undefined)[]): number {
  return arr.reduce<number>((a, b) => a + (b || 0), 0)
}

export function niceTicks(totalMs: number): number[] {
  const steps = [100, 250, 500, 1000, 2000, 5000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000]
  const step = steps.find((s) => totalMs / s <= 8) || 600_000
  const t: number[] = []
  for (let x = 0; x <= totalMs; x += step) t.push(x)
  return t
}

// Relative time for a unix-ns timestamp: "now", "12s ago", "4m ago", "3h ago", "2d ago".
export function ago(ns: number | null | undefined, nowMs = Date.now()): string {
  if (!ns) return "never"
  const s = Math.max(0, Math.round((nowMs * 1e6 - ns) / 1e9))
  if (s < 5) return "now"
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

// Signed percentage change, or null when there is no baseline.
export function delta(cur: number, prev: number): number | null {
  if (!prev) return null
  return (cur - prev) / prev
}

export function int(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—"
  return Math.round(v).toLocaleString("en-US")
}

// "1 commit", "3 commits".
export function plural(n: number, word: string, many = `${word}s`): string {
  return `${int(n)} ${Math.round(n) === 1 ? word : many}`
}
