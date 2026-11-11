import type { Breakdown } from "./types"
import { dur } from "./format"

export type RibbonKey = "wait" | "think" | "tool" | "hook" | "retry" | "other"

export type RibbonParts = Record<RibbonKey, number>

export const RIBBON_ORDER: RibbonKey[] = ["wait", "think", "tool", "retry", "hook", "other"]

export const RIBBON_LABEL: Record<RibbonKey, string> = {
  wait: "Waiting on you",
  think: "Thinking",
  tool: "Tools",
  retry: "Retries",
  hook: "Hooks",
  other: "Other",
}

export const RIBBON_CLASS: Record<RibbonKey, string> = {
  wait: "t-wait",
  think: "t-think",
  tool: "t-tool",
  retry: "t-retry",
  hook: "t-hook",
  other: "t-other",
}

export function emptyParts(): RibbonParts {
  return { wait: 0, think: 0, tool: 0, hook: 0, retry: 0, other: 0 }
}

export function fromBreakdown(b: Breakdown | null | undefined): RibbonParts {
  const out = emptyParts()
  if (!b) return out
  out.think = b.model || 0
  out.tool = b.tool || 0
  out.wait = b.permission_wait || 0
  out.retry = b.retry || 0
  out.hook = b.hook || 0
  out.other = (b.other || 0) + (b.permission_check || 0)
  return out
}

export function addParts(a: RibbonParts, b: RibbonParts | Breakdown | null | undefined): RibbonParts {
  const extra = b && "model" in b ? fromBreakdown(b) : (b as RibbonParts | null) || emptyParts()
  return {
    wait: a.wait + extra.wait,
    think: a.think + extra.think,
    tool: a.tool + extra.tool,
    hook: a.hook + extra.hook,
    retry: a.retry + extra.retry,
    other: a.other + extra.other,
  }
}

export function partsTotal(p: RibbonParts): number {
  return p.wait + p.think + p.tool + p.hook + p.retry + p.other
}

export function partsList(p: RibbonParts, min = 0): { key: RibbonKey; ms: number; cls: string; label: string }[] {
  return RIBBON_ORDER.map((key) => ({ key, ms: p[key], cls: RIBBON_CLASS[key], label: RIBBON_LABEL[key] })).filter(
    (x) => x.ms > min,
  )
}

export function partsLabel(p: RibbonParts): { key: RibbonKey; text: string; cls: string; label: string }[] {
  return partsList(p).map((x) => ({ key: x.key, text: dur(x.ms), cls: x.cls, label: x.label }))
}
