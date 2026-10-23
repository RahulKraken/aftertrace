package plans

import (
	"database/sql"
	"math"
	"testing"
	"time"
)

func TestInsertUpdateCancelRestore(t *testing.T) {
	db := openTestDB(t)
	now := time.Date(2026, 10, 23, 12, 0, 0, 0, time.UTC)
	var sub Subscription
	mutate(t, db, func(tx *sql.Tx) error {
		var err error
		sub, err = Insert(tx, Draft{CatalogID: "claude-max-20x", RenewalDay: intp(1), StartDate: "2026-06-01"}, now)
		return err
	})
	if sub.Vendor != "Anthropic" || sub.PlanName != "Claude Max 20x" || sub.Price == nil || *sub.Price != 200 {
		t.Fatalf("catalog fill: %+v", sub)
	}
	if sub.MonthlyUSD == nil || *sub.MonthlyUSD != 200 {
		t.Fatalf("monthly %+v", sub.MonthlyUSD)
	}
	if sub.UsageKind != UsageClaudeCode {
		t.Fatalf("usage %s", sub.UsageKind)
	}

	mutate(t, db, func(tx *sql.Tx) error {
		var err error
		sub, err = Update(tx, sub.ID, Draft{
			Price: floatp(180), Vendor: sub.Vendor, PlanName: sub.PlanName,
			BillingPeriod: sub.BillingPeriod, RenewalDay: intp(5),
		}, now)
		return err
	})
	if sub.Price == nil || *sub.Price != 180 || sub.RenewalDay == nil || *sub.RenewalDay != 5 {
		t.Fatalf("update %+v", sub)
	}

	mutate(t, db, func(tx *sql.Tx) error {
		var err error
		sub, err = Cancel(tx, sub.ID, now)
		return err
	})
	if sub.Status != StatusCancelled || sub.CancelledAt != "2026-10-23" {
		t.Fatalf("cancel %+v", sub)
	}

	mutate(t, db, func(tx *sql.Tx) error {
		var err error
		sub, err = Restore(tx, sub.ID, now)
		return err
	})
	if sub.Status != StatusActive || sub.CancelledAt != "" {
		t.Fatalf("restore %+v", sub)
	}

	list, err := List(db)
	if err != nil || len(list) != 1 {
		t.Fatalf("list %v %v", list, err)
	}

	if _, err := (Draft{Vendor: "X"}).cleaned(); err == nil {
		t.Fatal("expected validation error")
	}
}

func TestYearlyNormalizesInSummary(t *testing.T) {
	db := openTestDB(t)
	now := time.Date(2026, 10, 23, 12, 0, 0, 0, time.UTC)
	mutate(t, db, func(tx *sql.Tx) error {
		_, err := Insert(tx, Draft{CatalogID: "claude-pro-annual", RenewalDay: intp(1)}, now)
		return err
	})
	mutate(t, db, func(tx *sql.Tx) error {
		_, err := Insert(tx, Draft{CatalogID: "chatgpt-plus", RenewalDay: intp(28)}, now)
		return err
	})
	mutate(t, db, func(tx *sql.Tx) error {
		_, err := Insert(tx, Draft{CatalogID: "anthropic-api"}, now)
		return err
	})
	// Usage estimate reads the calls view. Stub it so this package does not import store.
	if _, err := db.Exec(`CREATE TABLE calls (start_ns BIGINT, provider VARCHAR, model_key VARCHAR, cost_usd DOUBLE)`); err != nil {
		t.Fatal(err)
	}
	sum, err := Compute(db, now)
	if err != nil {
		t.Fatal(err)
	}
	// Claude Pro annual $200/12 + ChatGPT Plus $20. API usage is 0 without traces.
	want := 200.0/12 + 20
	if math.Abs(sum.MonthlyUSD-want) > 1e-9 {
		t.Fatalf("monthly=%v want %v", sum.MonthlyUSD, want)
	}
	if math.Abs(sum.TotalUSD-want) > 1e-9 {
		t.Fatalf("total=%v", sum.TotalUSD)
	}
	if sum.Active != 3 || sum.UsageBased != 1 {
		t.Fatalf("active=%d usage=%d", sum.Active, sum.UsageBased)
	}
	if sum.Next == nil || sum.Next.PlanName != "ChatGPT Plus" || sum.Next.On != "2026-10-28" || sum.Next.InDays != 5 {
		t.Fatalf("next %+v", sum.Next)
	}
}

func intp(v int) *int           { return &v }
func floatp(v float64) *float64 { return &v }
