import type { BillingPeriod, CatalogPlan, PlansLedger, PlansSummary, Subscription } from "../lib/types"

const TODAY = "2026-10-23"

export const MOCK_CATALOG: CatalogPlan[] = [
  { id: "chatgpt-go", vendor: "OpenAI", plan_name: "ChatGPT Go", brand: "openai", price: 8, currency: "USD", billing_period: "monthly", source_url: "https://learn.chatgpt.com/docs/pricing", sourced_at: TODAY, usage_kind: "none" },
  { id: "chatgpt-plus", vendor: "OpenAI", plan_name: "ChatGPT Plus", brand: "openai", price: 20, currency: "USD", billing_period: "monthly", source_url: "https://help.openai.com/en/articles/6950777-what-is-chatgpt-plus", sourced_at: TODAY, usage_kind: "none" },
  { id: "chatgpt-pro-100", vendor: "OpenAI", plan_name: "ChatGPT Pro 100", brand: "openai", price: 100, currency: "USD", billing_period: "monthly", source_url: "https://help.openai.com/en/articles/9793128-about-chatgpt-pro-tiers", sourced_at: TODAY, usage_kind: "none" },
  { id: "chatgpt-pro-200", vendor: "OpenAI", plan_name: "ChatGPT Pro 200", brand: "openai", price: 200, currency: "USD", billing_period: "monthly", source_url: "https://help.openai.com/en/articles/9793128-about-chatgpt-pro-tiers", sourced_at: TODAY, usage_kind: "none" },
  { id: "openai-api", vendor: "OpenAI", plan_name: "API pay as you go", brand: "openai", price: null, currency: "USD", billing_period: "usage", source_url: "https://openai.com/api/pricing", sourced_at: TODAY, usage_kind: "openai_api", notes: "No monthly fee." },
  { id: "claude-pro", vendor: "Anthropic", plan_name: "Claude Pro", brand: "anthropic", price: 20, currency: "USD", billing_period: "monthly", source_url: "https://claude.com/pricing", sourced_at: TODAY, usage_kind: "claude_code" },
  { id: "claude-pro-annual", vendor: "Anthropic", plan_name: "Claude Pro", brand: "anthropic", price: 200, currency: "USD", billing_period: "yearly", source_url: "https://claude.com/pricing", sourced_at: TODAY, usage_kind: "claude_code" },
  { id: "claude-max-5x", vendor: "Anthropic", plan_name: "Claude Max 5x", brand: "anthropic", price: 100, currency: "USD", billing_period: "monthly", source_url: "https://support.claude.com/en/articles/11049741-what-is-the-max-plan", sourced_at: TODAY, usage_kind: "claude_code" },
  { id: "claude-max-20x", vendor: "Anthropic", plan_name: "Claude Max 20x", brand: "anthropic", price: 200, currency: "USD", billing_period: "monthly", source_url: "https://support.claude.com/en/articles/11049741-what-is-the-max-plan", sourced_at: TODAY, usage_kind: "claude_code" },
  { id: "anthropic-api", vendor: "Anthropic", plan_name: "API pay as you go", brand: "anthropic", price: null, currency: "USD", billing_period: "usage", source_url: "https://platform.claude.com/docs/en/about-claude/pricing", sourced_at: TODAY, usage_kind: "anthropic_api" },
  { id: "google-ai-pro", vendor: "Google", plan_name: "Google AI Pro", brand: "google", price: 19.99, currency: "USD", billing_period: "monthly", source_url: "https://one.google.com/about/google-ai-plans/", sourced_at: TODAY, usage_kind: "none" },
  { id: "google-ai-ultra-5x", vendor: "Google", plan_name: "Google AI Ultra 5x", brand: "google", price: 99.99, currency: "USD", billing_period: "monthly", source_url: "https://one.google.com/about/google-ai-plans/", sourced_at: TODAY, usage_kind: "none" },
  { id: "x-premium", vendor: "xAI", plan_name: "The X Subscription Premium", brand: "xai", price: 30, currency: "USD", billing_period: "monthly", source_url: "https://x.ai/pricing", sourced_at: TODAY, usage_kind: "none" },
  { id: "x-super", vendor: "xAI", plan_name: "The X Subscription Super", brand: "xai", price: 100, currency: "USD", billing_period: "monthly", source_url: "https://x.ai/pricing", sourced_at: TODAY, usage_kind: "none" },
  { id: "supergrok", vendor: "xAI", plan_name: "SuperGrok", brand: "xai", price: null, currency: "USD", billing_period: "monthly", source_url: "https://x.ai/news/x-subscription", sourced_at: TODAY, usage_kind: "none", notes: "Legacy; current page does not list a standalone price." },
  { id: "xai-api", vendor: "xAI", plan_name: "API pay as you go", brand: "xai", price: null, currency: "USD", billing_period: "usage", source_url: "https://docs.x.ai/docs/models", sourced_at: TODAY, usage_kind: "xai_api" },
  { id: "perplexity-pro", vendor: "Perplexity", plan_name: "Perplexity Pro", brand: "perplexity", price: 17, currency: "USD", billing_period: "monthly", source_url: "https://www.perplexity.ai/hub/pricing", sourced_at: TODAY, usage_kind: "none", notes: "Listed as $17/month when billed annually." },
  { id: "perplexity-max", vendor: "Perplexity", plan_name: "Perplexity Max", brand: "perplexity", price: 167, currency: "USD", billing_period: "monthly", source_url: "https://www.perplexity.ai/hub/pricing", sourced_at: TODAY, usage_kind: "none", notes: "Listed as $167/month when billed annually." },
  { id: "cursor-plus", vendor: "Cursor", plan_name: "Plus", brand: "cursor", price: 8, currency: "USD", billing_period: "monthly", source_url: "https://cursor.com/pricing", sourced_at: TODAY, usage_kind: "none" },
  { id: "cursor-premium", vendor: "Cursor", plan_name: "Premium", brand: "cursor", price: 30, currency: "USD", billing_period: "monthly", source_url: "https://cursor.com/pricing", sourced_at: TODAY, usage_kind: "none" },
  { id: "cursor-super", vendor: "Cursor", plan_name: "Super", brand: "cursor", price: 100, currency: "USD", billing_period: "monthly", source_url: "https://cursor.com/pricing", sourced_at: TODAY, usage_kind: "none" },
  { id: "cursor-ultra", vendor: "Cursor", plan_name: "Ultra", brand: "cursor", price: 200, currency: "USD", billing_period: "monthly", source_url: "https://cursor.com/pricing", sourced_at: TODAY, usage_kind: "none" },
  { id: "cursor-pro-legacy", vendor: "Cursor", plan_name: "Pro (legacy)", brand: "cursor", price: 20, currency: "USD", billing_period: "monthly", source_url: "https://cursor.com/docs/account/pricing/legacy-cursor-plans", sourced_at: TODAY, usage_kind: "none" },
  { id: "cursor-ultra-legacy", vendor: "Cursor", plan_name: "Ultra (legacy)", brand: "cursor", price: 200, currency: "USD", billing_period: "monthly", source_url: "https://cursor.com/docs/account/pricing/legacy-cursor-plans", sourced_at: TODAY, usage_kind: "none" },
  { id: "copilot-pro", vendor: "GitHub", plan_name: "Copilot Pro", brand: "github", price: 10, currency: "USD", billing_period: "monthly", source_url: "https://docs.github.com/en/copilot/get-started/plans", sourced_at: TODAY, usage_kind: "none" },
  { id: "copilot-proplus", vendor: "GitHub", plan_name: "Copilot Pro+", brand: "github", price: 39, currency: "USD", billing_period: "monthly", source_url: "https://docs.github.com/en/copilot/get-started/plans", sourced_at: TODAY, usage_kind: "none" },
  { id: "midjourney-basic", vendor: "Midjourney", plan_name: "Basic", brand: "midjourney", price: 10, currency: "USD", billing_period: "monthly", source_url: "https://docs.midjourney.com/hc/en-us/articles/27870484040333-Comparing-Midjourney-Plans", sourced_at: TODAY, usage_kind: "none" },
  { id: "midjourney-standard", vendor: "Midjourney", plan_name: "Standard", brand: "midjourney", price: 30, currency: "USD", billing_period: "monthly", source_url: "https://docs.midjourney.com/hc/en-us/articles/27870484040333-Comparing-Midjourney-Plans", sourced_at: TODAY, usage_kind: "none" },
  { id: "gemini-api", vendor: "Google", plan_name: "Gemini API pay as you go", brand: "google", price: null, currency: "USD", billing_period: "usage", source_url: "https://ai.google.dev/gemini-api/docs/pricing", sourced_at: TODAY, usage_kind: "google_api" },
]

function monthly(price: number | null, period: BillingPeriod): number | null {
  if (price == null) return null
  if (period === "yearly") return price / 12
  if (period === "monthly") return price
  return null
}

function nextOn(period: BillingPeriod, day: number | null, start: string | undefined, now: Date): Date | null {
  if (period === "usage" || !day) return null
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth()
  const clamp = (yy: number, mm: number, d: number) => {
    const last = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate()
    return new Date(Date.UTC(yy, mm, Math.min(d, last)))
  }
  if (period === "monthly") {
    let cand = clamp(y, m, day)
    const today = new Date(Date.UTC(y, m, now.getUTCDate()))
    if (cand.getTime() <= today.getTime()) cand = clamp(m === 11 ? y + 1 : y, (m + 1) % 12, day)
    return cand
  }
  const startD = start ? new Date(start + "T00:00:00Z") : null
  const month = startD ? startD.getUTCMonth() : m
  let cand = clamp(y, month, day)
  const today = new Date(Date.UTC(y, m, now.getUTCDate()))
  if (cand.getTime() <= today.getTime()) cand = clamp(y + 1, month, day)
  return cand
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10)
}

let n = 0
function nid(): string {
  n += 1
  return `sub-${n}`
}

function fromCatalog(id: string, renewal: number, start?: string): Subscription {
  const c = MOCK_CATALOG.find((x) => x.id === id)!
  const now = Date.now() * 1e6
  return {
    id: nid(),
    catalog_id: c.id,
    vendor: c.vendor,
    plan_name: c.plan_name,
    brand: c.brand,
    price: c.price,
    currency: c.currency,
    billing_period: c.billing_period,
    renewal_day: renewal,
    start_date: start,
    status: "active",
    notes: c.notes,
    usage_kind: c.usage_kind,
    created_ns: now,
    updated_ns: now,
    monthly_usd: monthly(c.price, c.billing_period),
  }
}

let subs: Subscription[] = [
  fromCatalog("claude-max-20x", 1, "2026-06-01"),
  fromCatalog("cursor-ultra-legacy", 15, "2026-01-15"),
  fromCatalog("chatgpt-plus", 28),
  fromCatalog("anthropic-api", 0),
]

export function summaryOf(list: Subscription[]): PlansSummary {
  const now = new Date()
  let monthlyUsd = 0
  let active = 0
  let unpriced = 0
  let usageBased = 0
  let next: PlansSummary["next_renewal"] = null
  for (const s of list) {
    if (s.status !== "active") continue
    active++
    if (s.billing_period === "usage") {
      usageBased++
      continue
    }
    const m = monthly(s.price, s.billing_period)
    if (m == null) unpriced++
    else monthlyUsd += m
    const on = nextOn(s.billing_period, s.renewal_day, s.start_date, now)
    if (!on) continue
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    const inDays = Math.round((on.getTime() - today.getTime()) / 86400000)
    const cand = { id: s.id, vendor: s.vendor, plan_name: s.plan_name, on: iso(on), in_days: inDays, amount: m }
    if (!next || on.getTime() < new Date(next.on + "T00:00:00Z").getTime()) next = cand
  }
  return {
    monthly_usd: monthlyUsd,
    usage_usd: 0,
    total_usd: monthlyUsd,
    currency: "USD",
    active,
    unpriced,
    usage_based: usageBased,
    next_renewal: next,
    usage: [],
  }
}

export function mockLedger(): PlansLedger {
  return { catalog: MOCK_CATALOG, subscriptions: subs, summary: summaryOf(subs) }
}

export function mockAdd(body: Record<string, unknown>): Subscription {
  const cid = String(body.catalog_id || "")
  const cat = MOCK_CATALOG.find((x) => x.id === cid)
  const period = (body.billing_period as BillingPeriod) || cat?.billing_period || "monthly"
  const price = body.price === undefined || body.price === null ? (cat?.price ?? null) : Number(body.price)
  const now = Date.now() * 1e6
  const s: Subscription = {
    id: nid(),
    catalog_id: cid || undefined,
    vendor: String(body.vendor || cat?.vendor || ""),
    plan_name: String(body.plan_name || cat?.plan_name || ""),
    brand: String(body.brand || cat?.brand || ""),
    price,
    currency: String(body.currency || cat?.currency || "USD"),
    billing_period: period,
    renewal_day: body.renewal_day == null ? null : Number(body.renewal_day),
    start_date: body.start_date ? String(body.start_date) : undefined,
    status: "active",
    notes: body.notes ? String(body.notes) : cat?.notes,
    usage_kind: String(body.usage_kind || cat?.usage_kind || "none"),
    created_ns: now,
    updated_ns: now,
    monthly_usd: monthly(price, period),
  }
  if (!s.vendor || !s.plan_name) throw Object.assign(new Error("vendor and plan name are required"), { payload: { error: "vendor and plan name are required" } })
  subs = [...subs, s]
  return s
}

export function mockPatch(id: string, body: Record<string, unknown>): Subscription {
  const i = subs.findIndex((s) => s.id === id)
  if (i < 0) throw Object.assign(new Error("not found"), { payload: { error: "not found" } })
  const cur = subs[i]
  const period = (body.billing_period as BillingPeriod) || cur.billing_period
  const price = body.price === undefined ? cur.price : body.price == null ? null : Number(body.price)
  const next: Subscription = {
    ...cur,
    vendor: body.vendor ? String(body.vendor) : cur.vendor,
    plan_name: body.plan_name ? String(body.plan_name) : cur.plan_name,
    price,
    billing_period: period,
    renewal_day: body.renewal_day === undefined ? cur.renewal_day : body.renewal_day == null ? null : Number(body.renewal_day),
    start_date: body.start_date === undefined ? cur.start_date : String(body.start_date),
    notes: body.notes === undefined ? cur.notes : String(body.notes),
    updated_ns: Date.now() * 1e6,
    monthly_usd: monthly(price, period),
  }
  subs = subs.map((s, j) => (j === i ? next : s))
  return next
}

export function mockCancel(id: string, restore = false): Subscription {
  const i = subs.findIndex((s) => s.id === id)
  if (i < 0) throw Object.assign(new Error("not found"), { payload: { error: "not found" } })
  const next: Subscription = {
    ...subs[i],
    status: restore ? "active" : "cancelled",
    cancelled_at: restore ? undefined : iso(new Date()),
    updated_ns: Date.now() * 1e6,
  }
  subs = subs.map((s, j) => (j === i ? next : s))
  return next
}

export function mockMonthlyUsd(): number {
  return summaryOf(subs).total_usd
}
