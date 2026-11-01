// User-set weekly spend cap, stored in this browser. Never invent a default.
const KEY = "aftertrace-budget"

export type Budget = { weekly: number }

export function readBudget(): Budget | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return null
    const n = Number(JSON.parse(raw)?.weekly)
    if (!Number.isFinite(n) || n <= 0) return null
    return { weekly: n }
  } catch {
    return null
  }
}

export function writeBudget(weekly: number | null) {
  try {
    if (weekly && weekly > 0) window.localStorage.setItem(KEY, JSON.stringify({ weekly }))
    else window.localStorage.removeItem(KEY)
    window.dispatchEvent(new Event("aftertrace-budget"))
  } catch {
    /* private mode */
  }
}

export function mondayReset(now = new Date()): { ms: number; label: string } {
  const d = new Date(now)
  const day = d.getDay() // 0 Sun
  const daysUntilMon = day === 0 ? 1 : 8 - day
  const next = new Date(d)
  next.setDate(d.getDate() + daysUntilMon)
  next.setHours(0, 0, 0, 0)
  return { ms: next.getTime() - d.getTime(), label: "resets Mon" }
}
