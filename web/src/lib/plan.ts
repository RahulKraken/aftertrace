// What you pay for Claude, so the recap can say whether the plan paid for
// itself. Stored per browser; never sent anywhere.
export type Plan = { id: string; label: string; monthly: number }

export const PLANS: Plan[] = [
  { id: "api", label: "API only (pay as you go)", monthly: 0 },
  { id: "pro", label: "Pro, $20/month", monthly: 20 },
  { id: "max5", label: "Max 5x, $100/month", monthly: 100 },
  { id: "max20", label: "Max 20x, $200/month", monthly: 200 },
]

const KEY = "aftertrace-plan"

export function readPlan(): Plan | null {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as Plan
    return typeof p.monthly === "number" ? p : null
  } catch {
    return null
  }
}

export function writePlan(p: Plan | null) {
  try {
    if (p) window.localStorage.setItem(KEY, JSON.stringify(p))
    else window.localStorage.removeItem(KEY)
    window.dispatchEvent(new Event("aftertrace-plan"))
  } catch {
    // Storage blocked: the setting lasts for this page only.
  }
}

// How many times over a subscription paid for itself in `days` of usage,
// comparing API-equivalent spend with the plan's prorated price.
export function planMultiple(plan: Plan | null, apiValue: number, days: number): number | null {
  if (!plan || !plan.monthly || apiValue <= 0) return null
  return apiValue / ((plan.monthly * days) / 30)
}
