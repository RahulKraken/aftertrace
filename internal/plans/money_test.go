package plans

import (
	"testing"
	"time"
)

func TestMonthlyUSD(t *testing.T) {
	p := 240.0
	got := MonthlyUSD(&p, PeriodYearly)
	if got == nil || *got != 20 {
		t.Fatalf("yearly 240 -> %v, want 20", got)
	}
	p = 20
	got = MonthlyUSD(&p, PeriodMonthly)
	if got == nil || *got != 20 {
		t.Fatalf("monthly 20 -> %v", got)
	}
	if MonthlyUSD(&p, PeriodUsage) != nil {
		t.Fatal("usage should have no list monthly")
	}
	if MonthlyUSD(nil, PeriodMonthly) != nil {
		t.Fatal("nil price")
	}
	neg := -1.0
	if MonthlyUSD(&neg, PeriodMonthly) != nil {
		t.Fatal("negative")
	}
}

func TestNextRenewalMonthlyClampsEndOfMonth(t *testing.T) {
	now := time.Date(2026, 1, 31, 12, 0, 0, 0, time.UTC)
	on, ok := NextRenewalOn(now, PeriodMonthly, 31, nil)
	if !ok {
		t.Fatal("expected date")
	}
	// Next month after 31 Jan is 28 Feb 2026 (not a leap year... 2026 is not leap).
	if on.Format("2006-01-02") != "2026-02-28" {
		t.Fatalf("got %s, want 2026-02-28", on.Format("2006-01-02"))
	}
}

func TestNextRenewalMonthlySameDayIsNextMonth(t *testing.T) {
	now := time.Date(2026, 10, 23, 0, 0, 0, 0, time.UTC)
	on, ok := NextRenewalOn(now, PeriodMonthly, 23, nil)
	if !ok || on.Format("2006-01-02") != "2026-11-23" {
		t.Fatalf("got %v %s", ok, on.Format("2006-01-02"))
	}
	on, _ = NextRenewalOn(now, PeriodMonthly, 28, nil)
	if on.Format("2006-01-02") != "2026-10-28" {
		t.Fatalf("later this month: %s", on.Format("2006-01-02"))
	}
}

func TestNextRenewalYearlyFromStartDate(t *testing.T) {
	now := time.Date(2026, 10, 23, 0, 0, 0, 0, time.UTC)
	start := time.Date(2025, 3, 15, 0, 0, 0, 0, time.UTC)
	on, ok := NextRenewalOn(now, PeriodYearly, 0, &start)
	if !ok || on.Format("2006-01-02") != "2027-03-15" {
		t.Fatalf("got %v %s", ok, on.Format("2006-01-02"))
	}
	now = time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC)
	on, _ = NextRenewalOn(now, PeriodYearly, 0, &start)
	if on.Format("2006-01-02") != "2026-03-15" {
		t.Fatalf("still this year: %s", on.Format("2006-01-02"))
	}
}

func TestNextRenewalUsageHasNone(t *testing.T) {
	now := time.Date(2026, 10, 23, 0, 0, 0, 0, time.UTC)
	if _, ok := NextRenewalOn(now, PeriodUsage, 1, nil); ok {
		t.Fatal("usage")
	}
	if _, ok := NextRenewalOn(now, PeriodMonthly, 0, nil); ok {
		t.Fatal("no day")
	}
}

func TestDaysUntil(t *testing.T) {
	now := time.Date(2026, 10, 23, 15, 0, 0, 0, time.UTC)
	on := time.Date(2026, 10, 28, 0, 0, 0, 0, time.UTC)
	if d := daysUntil(now, on); d != 5 {
		t.Fatalf("days=%d", d)
	}
}
