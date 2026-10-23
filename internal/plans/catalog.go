// Package plans is the local subscriptions ledger: a bundled catalog of
// common AI plans, monthly-equivalent math, and the rows the user adds.
package plans

import (
	"database/sql"
	"time"
)

// CatalogDate is when the bundled prices were checked against official pages.
const CatalogDate = "2026-10-23"

type BillingPeriod string

const (
	PeriodMonthly BillingPeriod = "monthly"
	PeriodYearly  BillingPeriod = "yearly"
	PeriodUsage   BillingPeriod = "usage"
)

// UsageKind maps a plan to telemetry Aftertrace already stores. "none" means
// we cannot see whether the user used it (ChatGPT chat, Perplexity, Copilot…).
type UsageKind string

const (
	UsageNone         UsageKind = "none"
	UsageClaudeCode   UsageKind = "claude_code"
	UsageOpenAIAPI    UsageKind = "openai_api"
	UsageAnthropicAPI UsageKind = "anthropic_api"
	UsageGoogleAPI    UsageKind = "google_api"
	UsageXAIAPI       UsageKind = "xai_api"
)

type CatalogEntry struct {
	ID            string        `json:"id"`
	Vendor        string        `json:"vendor"`
	PlanName      string        `json:"plan_name"`
	Brand         string        `json:"brand"`
	Price         *float64      `json:"price"`
	Currency      string        `json:"currency"`
	BillingPeriod BillingPeriod `json:"billing_period"`
	SourceURL     string        `json:"source_url"`
	SourcedAt     string        `json:"sourced_at"`
	Notes         string        `json:"notes,omitempty"`
	UsageKind     UsageKind     `json:"usage_kind"`
}

func usd(v float64) *float64 { return &v }

// Catalog is the bundled list. Every non-nil Price was read from SourceURL on
// SourcedAt. Nil Price means the official page did not list a number we could
// record; the UI leaves the field blank for the user to fill in.
var Catalog = []CatalogEntry{
	// OpenAI / ChatGPT. https://chatgpt.com/pricing, help centre, Codex docs.
	cat("chatgpt-go", "OpenAI", "ChatGPT Go", "openai", usd(8), PeriodMonthly,
		"https://learn.chatgpt.com/docs/pricing", "", UsageNone),
	cat("chatgpt-plus", "OpenAI", "ChatGPT Plus", "openai", usd(20), PeriodMonthly,
		"https://help.openai.com/en/articles/6950777-what-is-chatgpt-plus", "", UsageNone),
	cat("chatgpt-pro-100", "OpenAI", "ChatGPT Pro 100", "openai", usd(100), PeriodMonthly,
		"https://help.openai.com/en/articles/9793128-about-chatgpt-pro-tiers", "", UsageNone),
	cat("chatgpt-pro-200", "OpenAI", "ChatGPT Pro 200", "openai", usd(200), PeriodMonthly,
		"https://help.openai.com/en/articles/9793128-about-chatgpt-pro-tiers", "", UsageNone),
	cat("chatgpt-pro-500", "OpenAI", "ChatGPT Pro 500", "openai", usd(500), PeriodMonthly,
		"https://help.openai.com/en/articles/9793128-about-chatgpt-pro-tiers", "Includes Ultrafast.", UsageNone),
	cat("openai-api", "OpenAI", "API pay as you go", "openai", nil, PeriodUsage,
		"https://openai.com/api/pricing", "No monthly fee; usage is billed on tokens. Aftertrace estimates this month from app traces when they report OpenAI cost.", UsageOpenAIAPI),

	// Anthropic / Claude.
	cat("claude-pro", "Anthropic", "Claude Pro", "anthropic", usd(20), PeriodMonthly,
		"https://claude.com/pricing", "$20 billed monthly. Includes Claude Code.", UsageClaudeCode),
	cat("claude-pro-annual", "Anthropic", "Claude Pro", "anthropic", usd(200), PeriodYearly,
		"https://claude.com/pricing", "$200 billed up front ($17/month equivalent on the pricing page).", UsageClaudeCode),
	cat("claude-max-5x", "Anthropic", "Claude Max 5x", "anthropic", usd(100), PeriodMonthly,
		"https://support.claude.com/en/articles/11049741-what-is-the-max-plan", "Monthly only. Includes Claude Code.", UsageClaudeCode),
	cat("claude-max-20x", "Anthropic", "Claude Max 20x", "anthropic", usd(200), PeriodMonthly,
		"https://support.claude.com/en/articles/11049741-what-is-the-max-plan", "Monthly only. Includes Claude Code.", UsageClaudeCode),
	cat("anthropic-api", "Anthropic", "API pay as you go", "anthropic", nil, PeriodUsage,
		"https://platform.claude.com/docs/en/about-claude/pricing", "No monthly fee. Aftertrace estimates this month from non-Claude-Code app traces.", UsageAnthropicAPI),

	// Google / Gemini.
	cat("google-ai-plus", "Google", "Google AI Plus", "google", usd(4.99), PeriodMonthly,
		"https://one.google.com/about/google-ai-plans/", "", UsageNone),
	cat("google-ai-pro", "Google", "Google AI Pro", "google", usd(19.99), PeriodMonthly,
		"https://one.google.com/about/google-ai-plans/", "", UsageNone),
	cat("google-ai-ultra-5x", "Google", "Google AI Ultra 5x", "google", usd(99.99), PeriodMonthly,
		"https://one.google.com/about/google-ai-plans/", "", UsageNone),
	cat("google-ai-ultra-20x", "Google", "Google AI Ultra 20x", "google", usd(199.99), PeriodMonthly,
		"https://one.google.com/about/google-ai-plans/", "", UsageNone),
	cat("gemini-api", "Google", "Gemini API pay as you go", "google", nil, PeriodUsage,
		"https://ai.google.dev/gemini-api/docs/pricing", "No monthly fee. Aftertrace estimates this month from app traces billed as Gemini.", UsageGoogleAPI),

	// xAI / Grok. Current self-serve plans are The X Subscription (Grok + Cursor + X).
	cat("x-plus", "xAI", "The X Subscription Plus", "xai", usd(8), PeriodMonthly,
		"https://x.ai/pricing", "Includes Grok and Cursor on the current self-serve plans. Do not also add the matching Cursor plan if this is the same bill.", UsageNone),
	cat("x-plus-annual", "xAI", "The X Subscription Plus", "xai", usd(80), PeriodYearly,
		"https://docs.x.ai/x-subscription/pricing", "", UsageNone),
	cat("x-premium", "xAI", "The X Subscription Premium", "xai", usd(30), PeriodMonthly,
		"https://x.ai/pricing", "Includes Grok Bot. Do not also add the matching Cursor plan if this is the same bill.", UsageNone),
	cat("x-premium-annual", "xAI", "The X Subscription Premium", "xai", usd(300), PeriodYearly,
		"https://docs.x.ai/x-subscription/pricing", "", UsageNone),
	cat("x-super", "xAI", "The X Subscription Super", "xai", usd(100), PeriodMonthly,
		"https://x.ai/pricing", "", UsageNone),
	cat("x-super-annual", "xAI", "The X Subscription Super", "xai", usd(1000), PeriodYearly,
		"https://docs.x.ai/x-subscription/pricing", "", UsageNone),
	cat("x-ultra", "xAI", "The X Subscription Ultra", "xai", usd(200), PeriodMonthly,
		"https://x.ai/pricing", "", UsageNone),
	cat("x-ultra-annual", "xAI", "The X Subscription Ultra", "xai", usd(2000), PeriodYearly,
		"https://docs.x.ai/x-subscription/pricing", "", UsageNone),
	cat("supergrok", "xAI", "SuperGrok", "xai", nil, PeriodMonthly,
		"https://x.ai/news/x-subscription", "Legacy SuperGrok still runs for existing subscribers; the current pricing page does not list a standalone SuperGrok price.", UsageNone),
	cat("xai-api", "xAI", "API pay as you go", "xai", nil, PeriodUsage,
		"https://docs.x.ai/docs/models", "No monthly fee. Aftertrace estimates this month from app traces billed as xAI/Grok.", UsageXAIAPI),

	// Perplexity. Consumer page quotes a monthly figure when billed annually,
	// not a separate monthly list price.
	cat("perplexity-pro", "Perplexity", "Perplexity Pro", "perplexity", usd(17), PeriodMonthly,
		"https://www.perplexity.ai/hub/pricing", "Listed as $17/month when billed annually. Monthly list price is not shown separately.", UsageNone),
	cat("perplexity-max", "Perplexity", "Perplexity Max", "perplexity", usd(167), PeriodMonthly,
		"https://www.perplexity.ai/hub/pricing", "Listed as $167/month when billed annually. Monthly list price is not shown separately.", UsageNone),

	// Cursor. Current self-serve plans are The X Subscription; legacy plans remain for existing subscribers.
	cat("cursor-plus", "Cursor", "Plus", "cursor", usd(8), PeriodMonthly,
		"https://cursor.com/pricing", "Current self-serve plan; Cursor is sold as part of The X Subscription. Do not also add The X Subscription Plus if this is the same bill.", UsageNone),
	cat("cursor-plus-annual", "Cursor", "Plus", "cursor", usd(80), PeriodYearly,
		"https://cursor.com/help/account-and-billing/pricing", "", UsageNone),
	cat("cursor-premium", "Cursor", "Premium", "cursor", usd(30), PeriodMonthly,
		"https://cursor.com/pricing", "Do not also add The X Subscription Premium if this is the same bill.", UsageNone),
	cat("cursor-premium-annual", "Cursor", "Premium", "cursor", usd(300), PeriodYearly,
		"https://cursor.com/help/account-and-billing/pricing", "", UsageNone),
	cat("cursor-super", "Cursor", "Super", "cursor", usd(100), PeriodMonthly,
		"https://cursor.com/pricing", "", UsageNone),
	cat("cursor-super-annual", "Cursor", "Super", "cursor", usd(1000), PeriodYearly,
		"https://cursor.com/help/account-and-billing/pricing", "", UsageNone),
	cat("cursor-ultra", "Cursor", "Ultra", "cursor", usd(200), PeriodMonthly,
		"https://cursor.com/pricing", "", UsageNone),
	cat("cursor-ultra-annual", "Cursor", "Ultra", "cursor", usd(2000), PeriodYearly,
		"https://cursor.com/help/account-and-billing/pricing", "", UsageNone),
	cat("cursor-pro-legacy", "Cursor", "Pro (legacy)", "cursor", usd(20), PeriodMonthly,
		"https://cursor.com/docs/account/pricing/legacy-cursor-plans", "Not sold to new customers; existing subscribers keep it.", UsageNone),
	cat("cursor-proplus-legacy", "Cursor", "Pro+ (legacy)", "cursor", usd(60), PeriodMonthly,
		"https://cursor.com/docs/account/pricing/legacy-cursor-plans", "Not sold to new customers; existing subscribers keep it.", UsageNone),
	cat("cursor-ultra-legacy", "Cursor", "Ultra (legacy)", "cursor", usd(200), PeriodMonthly,
		"https://cursor.com/docs/account/pricing/legacy-cursor-plans", "Not sold to new customers; existing subscribers keep it.", UsageNone),

	// GitHub Copilot, individual plans.
	cat("copilot-pro", "GitHub", "Copilot Pro", "github", usd(10), PeriodMonthly,
		"https://docs.github.com/en/copilot/get-started/plans", "", UsageNone),
	cat("copilot-proplus", "GitHub", "Copilot Pro+", "github", usd(39), PeriodMonthly,
		"https://docs.github.com/en/copilot/get-started/plans", "", UsageNone),
	cat("copilot-max", "GitHub", "Copilot Max", "github", usd(100), PeriodMonthly,
		"https://docs.github.com/en/copilot/get-started/plans", "", UsageNone),

	// Midjourney.
	cat("midjourney-basic", "Midjourney", "Basic", "midjourney", usd(10), PeriodMonthly,
		"https://docs.midjourney.com/hc/en-us/articles/27870484040333-Comparing-Midjourney-Plans", "", UsageNone),
	cat("midjourney-basic-annual", "Midjourney", "Basic", "midjourney", usd(96), PeriodYearly,
		"https://docs.midjourney.com/hc/en-us/articles/27870484040333-Comparing-Midjourney-Plans", "$8/month equivalent.", UsageNone),
	cat("midjourney-standard", "Midjourney", "Standard", "midjourney", usd(30), PeriodMonthly,
		"https://docs.midjourney.com/hc/en-us/articles/27870484040333-Comparing-Midjourney-Plans", "", UsageNone),
	cat("midjourney-standard-annual", "Midjourney", "Standard", "midjourney", usd(288), PeriodYearly,
		"https://docs.midjourney.com/hc/en-us/articles/27870484040333-Comparing-Midjourney-Plans", "$24/month equivalent.", UsageNone),
	cat("midjourney-pro", "Midjourney", "Pro", "midjourney", usd(60), PeriodMonthly,
		"https://docs.midjourney.com/hc/en-us/articles/27870484040333-Comparing-Midjourney-Plans", "", UsageNone),
	cat("midjourney-pro-annual", "Midjourney", "Pro", "midjourney", usd(576), PeriodYearly,
		"https://docs.midjourney.com/hc/en-us/articles/27870484040333-Comparing-Midjourney-Plans", "$48/month equivalent.", UsageNone),
	cat("midjourney-mega", "Midjourney", "Mega", "midjourney", usd(120), PeriodMonthly,
		"https://docs.midjourney.com/hc/en-us/articles/27870484040333-Comparing-Midjourney-Plans", "", UsageNone),
	cat("midjourney-mega-annual", "Midjourney", "Mega", "midjourney", usd(1152), PeriodYearly,
		"https://docs.midjourney.com/hc/en-us/articles/27870484040333-Comparing-Midjourney-Plans", "$96/month equivalent.", UsageNone),
}

func cat(id, vendor, name, brand string, price *float64, period BillingPeriod, url, notes string, kind UsageKind) CatalogEntry {
	return CatalogEntry{
		ID: id, Vendor: vendor, PlanName: name, Brand: brand,
		Price: price, Currency: "USD", BillingPeriod: period,
		SourceURL: url, SourcedAt: CatalogDate, Notes: notes, UsageKind: kind,
	}
}

func LookupCatalog(id string) (CatalogEntry, bool) {
	for _, e := range Catalog {
		if e.ID == id {
			return e, true
		}
	}
	return CatalogEntry{}, false
}

// SeedCatalog rewrites plan_catalog from the binary, same pattern as prices.
func SeedCatalog(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`CREATE OR REPLACE TABLE plan_catalog (
		id VARCHAR PRIMARY KEY,
		vendor VARCHAR NOT NULL,
		plan_name VARCHAR NOT NULL,
		brand VARCHAR NOT NULL,
		price DOUBLE,
		currency VARCHAR NOT NULL,
		billing_period VARCHAR NOT NULL,
		source_url VARCHAR NOT NULL,
		sourced_at DATE NOT NULL,
		notes VARCHAR,
		usage_kind VARCHAR NOT NULL
	)`); err != nil {
		return err
	}
	stmt, err := tx.Prepare(`INSERT INTO plan_catalog
		(id, vendor, plan_name, brand, price, currency, billing_period, source_url, sourced_at, notes, usage_kind)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return err
	}
	defer stmt.Close()
	for _, e := range Catalog {
		var price any
		if e.Price != nil {
			price = *e.Price
		}
		if _, err := stmt.Exec(e.ID, e.Vendor, e.PlanName, e.Brand, price, e.Currency, string(e.BillingPeriod),
			e.SourceURL, e.SourcedAt, nullStr(e.Notes), string(e.UsageKind)); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func parseDate(s string) *time.Time {
	if s == "" {
		return nil
	}
	t, err := time.Parse("2006-01-02", s)
	if err != nil {
		return nil
	}
	return &t
}
