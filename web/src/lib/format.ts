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
  const abs = Math.abs(ms)
  if (abs < 1000) return `${Math.round(ms)}ms`
  if (abs < 60_000) return `${(ms / 1000).toFixed(abs < 10_000 ? 2 : 1)}s`
  const m = Math.floor(abs / 60_000)
  const s = Math.round((abs % 60_000) / 1000)
  if (m < 60) return `${ms < 0 ? "-" : ""}${m}m ${s}s`
  return `${ms < 0 ? "-" : ""}${Math.floor(m / 60)}h ${m % 60}m`
}

export function usd(v: number | null | undefined): string {
  if (v == null) return "—"
  if (Math.abs(v) >= 1) return `$${v.toFixed(2)}`
  return `$${v.toFixed(3)}`
}

export function tok(v: number | null | undefined): string {
  if (v == null) return "—"
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(2)}M`
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(1)}k`
  return String(Math.round(v))
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

export function sayUsd(v: number | null | undefined, whole = false): string {
  if (v == null || Number.isNaN(v)) return ""
  const neg = v < 0
  const abs = Math.abs(v)
  let s: string
  if (abs < 1) {
    let cents = Math.round(abs * 100)
    if (cents === 0 && abs > 0) cents = 1
    s = `${cents}¢`
  } else if (whole) {
    s = `$${Math.round(abs)}`
  } else {
    s = `$${abs.toFixed(2)}`
  }
  return neg ? `-${s}` : s
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
  if (v == null) return "—"
  return `${Math.round(v * 100)}%`
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
