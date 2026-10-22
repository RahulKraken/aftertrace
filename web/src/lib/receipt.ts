import { dur, int, usd } from "./format"
import { planMultiple, type Plan } from "./plan"
import type { Recap } from "./types"

export type Line = { kind: "title" | "sub" | "rule" | "row" | "head" | "big" | "foot"; left?: string; right?: string }

function range(lo: number, hi: number): string {
  const a = new Date(lo / 1e6)
  const b = new Date((hi - 1) / 1e6)
  const m = (d: Date) => d.toLocaleDateString("en-GB", { month: "short" })
  const same = a.getMonth() === b.getMonth()
  return `${a.getDate()}${same ? "" : ` ${m(a)}`}–${b.getDate()} ${m(b)} ${b.getFullYear()}`
}

export function weekLabel(r: Recap): string {
  return range(r.lo, r.hi)
}

// The receipt, as lines. Rendered as HTML on the page and drawn on a canvas
// for "Copy as image", so both always match. Prompts only appear when the
// user turns them on (they may name private projects).
export function receiptLines(r: Recap, plan: Plan | null, showPrompts: boolean): Line[] {
  const s = r.stats
  const lines: Line[] = [
    { kind: "title", left: "AFTERTRACE" },
    { kind: "sub", left: `Week of ${weekLabel(r)}` },
    { kind: "rule" },
    { kind: "row", left: "Agent time", right: dur(s.turn_ms) },
    { kind: "row", left: "Sessions · turns", right: `${int(s.sessions)} · ${int(s.turns)}` },
    { kind: "row", left: "Model requests", right: int(s.requests) },
    { kind: "row", left: "Tool calls", right: int(s.tool_calls) },
  ]
  if (s.lines_added || s.commits || s.pull_requests) {
    lines.push({ kind: "rule" }, { kind: "head", left: "Shipped" })
    if (s.lines_added || s.lines_removed) lines.push({ kind: "row", left: "  lines", right: `+${int(s.lines_added)} / −${int(s.lines_removed)}` })
    if (s.commits) lines.push({ kind: "row", left: "  commits", right: int(s.commits) })
    if (s.pull_requests) lines.push({ kind: "row", left: "  pull requests", right: int(s.pull_requests) })
  }
  lines.push(
    { kind: "rule" },
    { kind: "row", left: "Waiting on you", right: dur(s.breakdown.permission_wait || 0) },
    { kind: "row", left: "Approvals", right: int(s.approvals) },
    { kind: "rule" },
    { kind: "row", left: "API value", right: usd(s.cost_usd) },
  )
  const mult = planMultiple(plan, s.cost_usd, 7)
  if (plan && plan.monthly) {
    lines.push({ kind: "row", left: `Plan, prorated 7 days`, right: usd((plan.monthly * 7) / 30) })
    if (mult != null) lines.push({ kind: "big", left: "Paid for itself", right: `${mult.toFixed(1)}×` })
  }
  const top = r.tools[0]
  lines.push({ kind: "rule" })
  if (top) lines.push({ kind: "row", left: "Top tool", right: `${top.tool} × ${int(top.calls)}` })
  if (r.peak_parallel > 1) lines.push({ kind: "row", left: "Peak parallel", right: `${r.peak_parallel} turns` })
  if (r.priciest && r.priciest.cost_usd > 0) {
    lines.push({ kind: "row", left: "Priciest turn", right: usd(r.priciest.cost_usd) })
    if (showPrompts && r.priciest.prompt) lines.push({ kind: "sub", left: `“${r.priciest.prompt}”` })
  }
  lines.push({ kind: "rule" }, { kind: "foot", left: "local-first · nothing left this machine" })
  return lines
}

export function receiptMarkdown(r: Recap, plan: Plan | null, showPrompts: boolean): string {
  const out: string[] = []
  for (const l of receiptLines(r, plan, showPrompts)) {
    if (l.kind === "title") out.push(`**${l.left}**`)
    else if (l.kind === "sub" || l.kind === "foot") out.push(`_${l.left}_`)
    else if (l.kind === "rule") out.push("")
    else if (l.kind === "head") out.push(`**${l.left}**`)
    else out.push(`- ${l.left?.trim()}: **${l.right}**`)
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n")
}

// Draw the receipt on a canvas at 2x and return a PNG blob.
export async function receiptPNG(lines: Line[], dark: boolean): Promise<Blob> {
  const W = 400
  const pad = 28
  const lh = 22
  const h = pad * 2 + lines.reduce((a, l) => a + (l.kind === "rule" ? 16 : l.kind === "title" ? 34 : l.kind === "big" ? 32 : lh), 0) + 30
  const c = document.createElement("canvas")
  c.width = W * 2
  c.height = h * 2
  const g = c.getContext("2d")
  if (!g) throw new Error("canvas unavailable")
  g.scale(2, 2)
  const bg = dark ? "#151515" : "#fbfaf7"
  const ink = dark ? "#f2f2f2" : "#151515"
  const mute = dark ? "#9a9a9a" : "#6b6b6b"
  g.fillStyle = dark ? "#0a0a0a" : "#ececea"
  g.fillRect(0, 0, W, h)
  // Paper with a torn (zigzag) bottom edge.
  g.fillStyle = bg
  g.beginPath()
  g.moveTo(10, 8)
  g.lineTo(W - 10, 8)
  g.lineTo(W - 10, h - 18)
  for (let x = W - 10; x > 10; x -= 10) g.lineTo(x - 5, h - (x % 20 === 0 ? 8 : 14))
  g.lineTo(10, h - 18)
  g.closePath()
  g.fill()
  const mono = '13px ui-monospace, "SF Mono", Menlo, Consolas, monospace'
  let y = pad + 8
  for (const l of lines) {
    if (l.kind === "rule") {
      g.strokeStyle = mute
      g.setLineDash([3, 4])
      g.beginPath()
      g.moveTo(pad, y + 6)
      g.lineTo(W - pad, y + 6)
      g.stroke()
      g.setLineDash([])
      y += 16
      continue
    }
    if (l.kind === "title") {
      g.font = '700 20px ui-monospace, "SF Mono", Menlo, monospace'
      g.fillStyle = ink
      g.textAlign = "center"
      g.fillText(l.left || "", W / 2, y + 18)
      y += 34
      continue
    }
    if (l.kind === "sub" || l.kind === "foot") {
      g.font = mono
      g.fillStyle = mute
      g.textAlign = "center"
      g.fillText(clip(g, l.left || "", W - pad * 2), W / 2, y + 14)
      y += lh
      continue
    }
    const big = l.kind === "big"
    g.font = big ? '700 17px ui-monospace, "SF Mono", Menlo, monospace' : l.kind === "head" ? `700 ${mono}` : mono
    g.fillStyle = ink
    g.textAlign = "left"
    g.fillText(l.left || "", pad, y + 15)
    if (l.right) {
      g.textAlign = "right"
      g.fillText(l.right, W - pad, y + 15)
    }
    y += big ? 32 : lh
  }
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("no image"))), "image/png"))
}

function clip(g: CanvasRenderingContext2D, s: string, w: number): string {
  if (g.measureText(s).width <= w) return s
  let t = s
  while (t.length > 1 && g.measureText(`${t}…`).width > w) t = t.slice(0, -1)
  return `${t}…`
}
