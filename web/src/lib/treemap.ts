import type { CostTable, Finding } from "./types"
import { monthlyUSD } from "./welcome"

export type TmItem = { id: string; label: string; spend: number; save: number }
export type TmBlock = TmItem & { x: number; y: number; w: number; h: number }

function family(id: string): string {
  const s = id.toLowerCase()
  if (s.includes("opus")) return "Opus"
  if (s.includes("sonnet")) return "Sonnet"
  if (s.includes("haiku")) return "Haiku"
  const rest = s.replace(/^claude-/, "").split("-")[0]
  return rest ? rest[0].toUpperCase() + rest.slice(1) : id
}

function dimRows(t: CostTable | null | undefined, dim: string): { name: string; spend: number }[] {
  if (!t) return []
  const ni = t.columns.indexOf(dim)
  const nameI = ni >= 0 ? ni : 0
  const ci = t.columns.indexOf("cost_usd")
  if (ci < 0) return []
  return t.rows
    .map((r) => ({ name: String(r[nameI] ?? ""), spend: Number(r[ci] || 0) }))
    .filter((x) => x.spend > 0 && x.name && x.name !== "(none)")
}

/** Models plus named skill/mcp slices (pulled out of model totals so they still sum to spend). */
export function spendBlocks(model: CostTable | null, skill: CostTable | null, mcp: CostTable | null, findings: Finding[]): TmItem[] {
  const modelMap = new Map<string, number>()
  for (const m of dimRows(model, "model")) {
    const label = family(m.name)
    modelMap.set(label, (modelMap.get(label) || 0) + m.spend)
  }
  const tools = [...dimRows(skill, "skill"), ...dimRows(mcp, "mcp")]
  const modelTotal = [...modelMap.values()].reduce((a, b) => a + b, 0)
  const toolTotal = tools.reduce((a, b) => a + b.spend, 0)
  const keep = modelTotal > toolTotal ? modelTotal - toolTotal : modelTotal
  const scale = modelTotal > 0 ? keep / modelTotal : 1
  const items: TmItem[] = []
  for (const [label, spend] of modelMap) items.push({ id: `m-${label}`, label, spend: spend * scale, save: 0 })
  for (const t of tools) items.push({ id: `t-${t.name}`, label: t.name, spend: t.spend, save: 0 })

  const take = (pred: (it: TmItem) => boolean, usd: number): number => {
    const it = items.find(pred)
    if (!it || !(usd > 0)) return usd
    const room = Math.max(0, it.spend - it.save)
    const add = Math.min(room, usd)
    it.save += add
    return usd - add
  }
  const ranked = [...findings].sort((a, b) => monthlyUSD(b) - monthlyUSD(a))
  for (const f of ranked) {
    let rest = monthlyUSD(f)
    if (!(rest > 0)) continue
    if (f.rule_id === "model.opus_downgrade") rest = take((i) => i.label === "Opus", rest)
    else if (f.rule_id === "skill.cost") {
      const name = (f.headline || "").match(/Skill (\S+)/)?.[1]
      if (name) rest = take((i) => i.label === name, rest)
      rest = take((i) => i.label === "Opus", rest)
    } else if (f.rule_id === "mcp.large_results") {
      const name = (f.headline || "").match(/mcp__([^_]+)/)?.[1]
      if (name) rest = take((i) => i.label === name, rest)
    } else if (f.rule_id === "model.switch_cache_rebuild") rest = take((i) => i.label === "Opus", rest)
    if (rest > 0) {
      const largest = [...items].sort((a, b) => b.spend - a.spend)[0]
      if (largest) take((i) => i.id === largest.id, rest)
    }
  }

  const tot = items.reduce((a, i) => a + i.spend, 0)
  const min = tot * 0.035
  const big = items.filter((i) => i.spend >= min).sort((a, b) => b.spend - a.spend)
  const small = items.filter((i) => i.spend < min)
  if (small.length) {
    big.push({
      id: "other",
      label: "Other",
      spend: small.reduce((a, i) => a + i.spend, 0),
      save: small.reduce((a, i) => a + i.save, 0),
    })
  }
  return big.slice(0, 6)
}

/** Slice-and-dice: largest block on the long side, rest stacked. */
export function layoutTreemap(items: TmItem[], W: number, H: number, gap = 4): TmBlock[] {
  const list = items.filter((i) => i.spend > 0).sort((a, b) => b.spend - a.spend)
  const out: TmBlock[] = []
  const walk = (xs: TmItem[], x: number, y: number, w: number, h: number) => {
    if (!xs.length || w <= 0 || h <= 0) return
    if (xs.length === 1) {
      out.push({ ...xs[0], x, y, w, h })
      return
    }
    const sum = xs.reduce((a, i) => a + i.spend, 0) || 1
    const first = xs[0]
    const vertical = w >= h
    if (vertical) {
      const ww = Math.min(w - 48, Math.max(88, (first.spend / sum) * w))
      out.push({ ...first, x, y, w: ww, h })
      walk(xs.slice(1), x + ww + gap, y, w - ww - gap, h)
    } else {
      const hh = Math.min(h - 40, Math.max(56, (first.spend / sum) * h))
      out.push({ ...first, x, y, w, h: hh })
      walk(xs.slice(1), x, y + hh + gap, w, h - hh - gap)
    }
  }
  walk(list, 0, 0, W, H)
  return out
}
