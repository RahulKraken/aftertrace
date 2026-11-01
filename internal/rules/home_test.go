package rules

import (
	"math"
	"strings"
	"testing"
)

const monthNS = int64(30 * 24 * 3600 * 1e9)

func usdFinding(id int, rule string, raw float64, sev string, first, last int64) Finding {
	return Finding{
		ID: id, RuleID: rule, ImpactValue: raw, ImpactUnit: "USD",
		Severity: sev, Estimated: true, FirstNS: first, LastNS: last,
		Action: "Do the thing.",
	}
}

func TestMonthlyUSDScalesFromSpan(t *testing.T) {
	full := usdFinding(1, "a", 12, "medium", 1, 1+monthNS)
	if got := MonthlyUSD(full); math.Abs(got-12) > 0.01 {
		t.Errorf("full month: got %v want 12", got)
	}
	half := usdFinding(2, "a", 6, "medium", 1, 1+monthNS/2)
	if got := MonthlyUSD(half); math.Abs(got-12) > 0.01 {
		t.Errorf("half month: got %v want 12", got)
	}
	if MonthlyUSD(Finding{ImpactUnit: "s waited", ImpactValue: 90, Severity: "high"}) != 0 {
		t.Error("non-USD should be 0")
	}
	if MonthlyUSD(Finding{ImpactUnit: "USD", ImpactValue: 3, Severity: "error"}) != 0 {
		t.Error("error findings should be 0")
	}
}

func TestHomeSurfaceRanksByMonthlyNotRaw(t *testing.T) {
	// $2 over a month vs $1.50 over a week (≈ $6.4/month). The week one wins.
	fs := []Finding{
		usdFinding(1, "low-raw-long", 2.0, "high", 1, 1+monthNS),
		usdFinding(2, "high-monthly", 1.5, "low", 1, 1+monthNS/4),
	}
	got := HomeSurfaceFrom(fs, 0, true)
	if len(got.Shown) != 2 {
		t.Fatalf("shown %d want 2", len(got.Shown))
	}
	if got.Shown[0].RuleID != "high-monthly" {
		t.Errorf("rank: first=%s want high-monthly", got.Shown[0].RuleID)
	}
}

func TestHomeSurfaceThresholdAndFold(t *testing.T) {
	fs := []Finding{
		usdFinding(1, "big", 12, "medium", 1, 1+monthNS),
		usdFinding(2, "tiny", 0.02, "high", 1, 1+monthNS),
		usdFinding(3, "also-tiny", 0.40, "medium", 1, 1+monthNS),
	}
	got := HomeSurfaceFrom(fs, 0, true)
	if len(got.Shown) != 1 || got.Shown[0].RuleID != "big" {
		t.Fatalf("shown %+v want [big]", ids(got.Shown))
	}
	if got.Folded != 2 || got.FoldKind != "smaller" {
		t.Errorf("fold=%d kind=%q want 2 smaller", got.Folded, got.FoldKind)
	}
	wantTotal := 12 + 0.02 + 0.40
	if math.Abs(got.TotalMonthly-wantTotal) > 0.01 {
		t.Errorf("total %v want %v", got.TotalMonthly, wantTotal)
	}
	if !strings.Contains(got.Headline, "you could save") {
		t.Errorf("headline %q", got.Headline)
	}
}

func TestHomeSurfaceCapsAtThreeAndFoldsRest(t *testing.T) {
	fs := []Finding{
		usdFinding(1, "a", 12, "medium", 1, 1+monthNS),
		usdFinding(2, "b", 10, "medium", 1, 1+monthNS),
		usdFinding(3, "c", 8, "medium", 1, 1+monthNS),
		usdFinding(4, "d", 5, "medium", 1, 1+monthNS),
		usdFinding(5, "e", 3, "medium", 1, 1+monthNS),
	}
	got := HomeSurfaceFrom(fs, 0, true)
	if len(got.Shown) != 3 {
		t.Fatalf("shown %d want 3: %v", len(got.Shown), ids(got.Shown))
	}
	if got.Shown[0].RuleID != "a" || got.Shown[2].RuleID != "c" {
		t.Errorf("order %v", ids(got.Shown))
	}
	if got.Folded != 2 || got.FoldKind != "more" {
		t.Errorf("fold=%d kind=%q want 2 more", got.Folded, got.FoldKind)
	}
}

func TestHomeHeadlineEdgeCases(t *testing.T) {
	if got := HomeHeadline(0); got != "Your setup looks lean. Here's what we saw this month." {
		t.Errorf("zero: %q", got)
	}
	if got := HomeHeadline(0.41); got != "Your setup looks lean. Here's what we saw this month." {
		t.Errorf("tiny: %q", got)
	}
	if got := HomeHeadline(0.99); !strings.Contains(got, "lean") {
		t.Errorf("just under $1: %q", got)
	}
	got := HomeHeadline(12.4)
	if got != "About $12/month you could save" {
		t.Errorf("twelve: %q", got)
	}
	got = HomeHeadline(1)
	if got != "About $1/month you could save" {
		t.Errorf("one: %q", got)
	}
}

func TestHomeSurfaceAllSmallStillSums(t *testing.T) {
	fs := make([]Finding, 0, 10)
	for i := 0; i < 10; i++ {
		fs = append(fs, usdFinding(i, "tiny", 0.30, "low", 1, 1+monthNS))
	}
	got := HomeSurfaceFrom(fs, 0, true)
	if len(got.Shown) != 0 {
		t.Errorf("shown %v want none", ids(got.Shown))
	}
	if got.Folded != 10 || got.FoldKind != "smaller" {
		t.Errorf("fold=%d kind=%q", got.Folded, got.FoldKind)
	}
	if math.Abs(got.TotalMonthly-3) > 0.01 {
		t.Errorf("total %v want 3", got.TotalMonthly)
	}
	if !strings.Contains(got.Headline, "you could save") {
		t.Errorf("aggregate is over $1, headline %q", got.Headline)
	}
}

func TestHomeSurfaceFilters(t *testing.T) {
	fs := []Finding{
		usdFinding(1, "live", 9, "medium", 1, 1+monthNS),
		usdFinding(2, "hist", 8, "medium", 1, 1+monthNS),
		usdFinding(3, "old", 20, "high", 1, 50),
		{ID: 4, RuleID: "wait", ImpactValue: 90, ImpactUnit: "s waited", Severity: "high", Estimated: true, LastNS: 1 + monthNS},
		{ID: 5, RuleID: "err", ImpactValue: 40, ImpactUnit: "USD", Severity: "error", Estimated: true, LastNS: 1 + monthNS},
	}
	fs[0].Estimated = false
	got := HomeSurfaceFrom(fs, 100, true)
	if len(got.Shown) != 1 || got.Shown[0].RuleID != "hist" {
		t.Fatalf("history-only+since: %v", ids(got.Shown))
	}
	live := HomeSurfaceFrom(fs, 100, false)
	if len(live.Shown) != 2 {
		t.Fatalf("live includes non-estimated: %v", ids(live.Shown))
	}
}

func TestCardMoney(t *testing.T) {
	if got := CardMoney(12.4); got != "~$12/month" {
		t.Errorf("got %q", got)
	}
	if got := CardMoney(0.41); got != "~41¢/month" {
		t.Errorf("cents %q", got)
	}
}

func ids(fs []Finding) []string {
	out := make([]string, len(fs))
	for i, f := range fs {
		out[i] = f.RuleID
	}
	return out
}
