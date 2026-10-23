package plans

import (
	"database/sql"
	"testing"
	"time"
)

func TestCatalogPricesAreSourced(t *testing.T) {
	seen := map[string]bool{}
	need := []string{
		"chatgpt-plus", "chatgpt-pro-200", "claude-pro", "claude-max-20x",
		"google-ai-pro", "x-premium", "cursor-premium", "copilot-pro",
		"midjourney-standard", "openai-api", "anthropic-api", "supergrok",
		"perplexity-pro",
	}
	for _, e := range Catalog {
		if seen[e.ID] {
			t.Errorf("duplicate catalog id %s", e.ID)
		}
		seen[e.ID] = true
		if e.Vendor == "" || e.PlanName == "" || e.Brand == "" {
			t.Errorf("%s missing vendor/name/brand", e.ID)
		}
		if e.SourceURL == "" || e.SourcedAt != CatalogDate {
			t.Errorf("%s missing source", e.ID)
		}
		if _, err := time.Parse("2006-01-02", e.SourcedAt); err != nil {
			t.Errorf("%s sourced_at: %v", e.ID, err)
		}
		switch e.BillingPeriod {
		case PeriodMonthly, PeriodYearly, PeriodUsage:
		default:
			t.Errorf("%s bad period %s", e.ID, e.BillingPeriod)
		}
		if e.BillingPeriod == PeriodUsage && e.Price != nil {
			t.Errorf("%s usage plan must not invent a monthly price", e.ID)
		}
		if e.Price != nil && *e.Price <= 0 {
			t.Errorf("%s non-positive price", e.ID)
		}
		if e.Currency != "USD" {
			t.Errorf("%s currency", e.ID)
		}
	}
	for _, id := range need {
		if !seen[id] {
			t.Errorf("catalog missing %s", id)
		}
	}
	if _, ok := LookupCatalog("nope"); ok {
		t.Fatal("unknown id")
	}
}

func TestSeedCatalog(t *testing.T) {
	db := openTestDB(t)
	var n int
	if err := db.QueryRow(`SELECT count(*) FROM plan_catalog`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != len(Catalog) {
		t.Fatalf("rows=%d catalog=%d", n, len(Catalog))
	}
	var price sql.NullFloat64
	if err := db.QueryRow(`SELECT price FROM plan_catalog WHERE id='supergrok'`).Scan(&price); err != nil {
		t.Fatal(err)
	}
	if price.Valid {
		t.Fatalf("supergrok must have a blank price, got %v", price.Float64)
	}
	var plus float64
	if err := db.QueryRow(`SELECT price FROM plan_catalog WHERE id='chatgpt-plus'`).Scan(&plus); err != nil {
		t.Fatal(err)
	}
	if plus != 20 {
		t.Fatalf("chatgpt-plus=%v", plus)
	}
}
