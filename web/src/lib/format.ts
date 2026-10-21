import type { Breakdown, Finding } from "./types"

export const CATS: (keyof Breakdown)[] = [
  "model",
  "tool",
  "permission_wait",
  "retry",
  "hook",
  "other",
]

export const CAT_LABEL: Record<keyof Breakdown, string> = {
  model: "model",
  tool: "tool run",
  permission_wait: "waiting on you",
  retry: "retry waste",
  hook: "hooks",
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
