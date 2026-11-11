import { pct } from "./format"

const WORDS = ["", "One", "Two", "Three"]

export type Costed = { cost_usd?: number | null }

// Smallest prefix of sessions-by-cost that reaches half of spend.
// Returns null when that prefix would be more than 3 sessions or more than
// half of the sessions — then the recap line should speak instead.
export function spendLead(sessions: Costed[], total: number): string | null {
  if (!(total > 0)) return null
  const ranked = [...sessions].sort((a, b) => (b.cost_usd || 0) - (a.cost_usd || 0))
  const n = ranked.length
  const maxN = Math.min(3, Math.floor(n / 2))
  if (maxN < 1) return null
  let sum = 0
  for (let i = 0; i < maxN; i++) {
    sum += ranked[i].cost_usd || 0
    if (sum / total >= 0.5) {
      const count = i + 1
      const word = WORDS[count] || String(count)
      const noun = count === 1 ? "session" : "sessions"
      return `${word} ${noun} made ${pct(sum / total)} of your spend.`
    }
  }
  return null
}
