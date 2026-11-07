import { int, plural, sayDur, sayUsd } from "./format"
import type { Recap } from "./types"

export type StoryPart = { text: string; kind: "prose" | "primary" | "secondary" }

export function recapLead(r: Recap): StoryPart[] {
  const s = r.stats
  if (!s || (!s.turn_ms && !s.cost_usd && !s.sessions)) {
    return [{ kind: "prose", text: "Nothing ran this week." }]
  }
  const parts: StoryPart[] = [{ kind: "prose", text: "Your agents worked " }]
  parts.push({ kind: "primary", text: sayDur(s.turn_ms) || "0s" })
  if (s.sessions) {
    parts.push({ kind: "prose", text: " across " })
    parts.push({ kind: "secondary", text: plural(s.sessions, "session") })
  }
  parts.push({ kind: "prose", text: " for " })
  parts.push({ kind: "primary", text: sayUsd(s.cost_usd) || "$0" })
  parts.push({ kind: "prose", text: "." })
  return parts
}

export function recapShipped(r: Recap): StoryPart[] {
  const s = r.stats
  const bits: StoryPart[] = []
  if (s.lines_added) {
    bits.push({ kind: "prose", text: bits.length ? " and wrote " : "They wrote " })
    bits.push({ kind: "secondary", text: `${int(s.lines_added)} lines` })
  }
  if (s.commits) {
    bits.push({ kind: "prose", text: bits.length ? " and made " : "They made " })
    bits.push({ kind: "secondary", text: plural(s.commits, "commit") })
  }
  if (!bits.length) return []
  bits.push({ kind: "prose", text: "." })
  return bits
}
