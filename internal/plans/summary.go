package plans

import (
	"database/sql"
	"sort"
	"time"
)

type Renewal struct {
	ID       string   `json:"id"`
	Vendor   string   `json:"vendor"`
	PlanName string   `json:"plan_name"`
	On       string   `json:"on"`
	InDays   int      `json:"in_days"`
	Amount   *float64 `json:"amount"`
}

type UsageLine struct {
	Kind  UsageKind `json:"kind"`
	Label string    `json:"label"`
	USD   float64   `json:"usd"`
	From  string    `json:"from"`
}

type Summary struct {
	MonthlyUSD float64     `json:"monthly_usd"`
	UsageUSD   float64     `json:"usage_usd"`
	TotalUSD   float64     `json:"total_usd"`
	Currency   string      `json:"currency"`
	Active     int         `json:"active"`
	Unpriced   int         `json:"unpriced"`
	UsageBased int         `json:"usage_based"`
	Next       *Renewal    `json:"next_renewal"`
	Usage      []UsageLine `json:"usage"`
}

// Compute rolls active USD plans up to a monthly total, estimates usage-based
// spend for the calendar month of `now` from traces Aftertrace already has,
// and picks the next renewal.
func Compute(db *sql.DB, now time.Time) (Summary, error) {
	subs, err := List(db)
	if err != nil {
		return Summary{}, err
	}
	return summarize(db, subs, now)
}

func summarize(db *sql.DB, subs []Subscription, now time.Time) (Summary, error) {
	out := Summary{Currency: "USD", Usage: []UsageLine{}}
	var next *Renewal
	seenUsage := map[UsageKind]bool{}
	for _, s := range subs {
		if s.Status != StatusActive {
			continue
		}
		out.Active++
		if s.BillingPeriod == PeriodUsage {
			out.UsageBased++
			if s.UsageKind != UsageNone && s.UsageKind != "" {
				seenUsage[s.UsageKind] = true
			}
			continue
		}
		if s.Currency != "" && s.Currency != "USD" {
			out.Unpriced++
			continue
		}
		m := MonthlyUSD(s.Price, s.BillingPeriod)
		if m == nil {
			out.Unpriced++
		} else {
			out.MonthlyUSD += *m
		}
		day := 0
		if s.RenewalDay != nil {
			day = *s.RenewalDay
		}
		on, ok := NextRenewalOn(now, s.BillingPeriod, day, parseDate(s.StartDate))
		if !ok {
			continue
		}
		cand := Renewal{
			ID: s.ID, Vendor: s.Vendor, PlanName: s.PlanName,
			On: on.Format("2006-01-02"), InDays: daysUntil(now, on), Amount: m,
		}
		if next == nil || on.Before(parseDay(next.On)) {
			cp := cand
			next = &cp
		}
	}
	monthLo := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC).UnixNano()
	monthHi := time.Date(now.Year(), now.Month()+1, 1, 0, 0, 0, 0, time.UTC).UnixNano()
	kinds := make([]UsageKind, 0, len(seenUsage))
	for kind := range seenUsage {
		kinds = append(kinds, kind)
	}
	sort.Slice(kinds, func(i, j int) bool { return kinds[i] < kinds[j] })
	for _, kind := range kinds {
		usd, label, from, err := estimateUsage(db, kind, monthLo, monthHi)
		if err != nil {
			return Summary{}, err
		}
		out.Usage = append(out.Usage, UsageLine{Kind: kind, Label: label, USD: usd, From: from})
		out.UsageUSD += usd
	}
	out.TotalUSD = out.MonthlyUSD + out.UsageUSD
	out.Next = next
	return out, nil
}

func parseDay(s string) time.Time {
	t, _ := time.Parse("2006-01-02", s)
	return t
}

func estimateUsage(db *sql.DB, kind UsageKind, lo, hi int64) (float64, string, string, error) {
	var q, label, from string
	switch kind {
	case UsageClaudeCode:
		// Claude Code cost is the API-equivalent of the subscription, not extra
		// API spend, so it is not added to the monthly total.
		return 0, "Claude Code", "subscription, not extra API spend", nil
	case UsageOpenAIAPI:
		q = `SELECT coalesce(sum(cost_usd), 0) FROM calls WHERE start_ns >= ? AND start_ns < ? AND (
			lower(coalesce(provider, '')) LIKE '%openai%' OR starts_with(lower(coalesce(model_key, '')), 'gpt-')
			OR starts_with(lower(coalesce(model_key, '')), 'o3') OR starts_with(lower(coalesce(model_key, '')), 'o4'))`
		label, from = "OpenAI API", "app traces this month"
	case UsageAnthropicAPI:
		q = `SELECT coalesce(sum(cost_usd), 0) FROM calls WHERE start_ns >= ? AND start_ns < ? AND (
			lower(coalesce(provider, '')) LIKE '%anthropic%' OR lower(coalesce(provider, '')) LIKE '%claude%'
			OR starts_with(lower(coalesce(model_key, '')), 'claude-'))`
		label, from = "Anthropic API", "app traces this month"
	case UsageGoogleAPI:
		q = `SELECT coalesce(sum(cost_usd), 0) FROM calls WHERE start_ns >= ? AND start_ns < ? AND (
			lower(coalesce(provider, '')) LIKE '%google%' OR lower(coalesce(provider, '')) LIKE '%gemini%'
			OR starts_with(lower(coalesce(model_key, '')), 'gemini-'))`
		label, from = "Gemini API", "app traces this month"
	case UsageXAIAPI:
		q = `SELECT coalesce(sum(cost_usd), 0) FROM calls WHERE start_ns >= ? AND start_ns < ? AND (
			lower(coalesce(provider, '')) LIKE '%xai%' OR lower(coalesce(provider, '')) LIKE '%x.ai%'
			OR starts_with(lower(coalesce(model_key, '')), 'grok-'))`
		label, from = "xAI API", "app traces this month"
	default:
		return 0, "", "", nil
	}
	var v float64
	if err := db.QueryRow(q, lo, hi).Scan(&v); err != nil {
		return 0, label, from, err
	}
	return v, label, from, nil
}
