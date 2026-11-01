package rules

import (
	"math"
	"strings"
	"testing"
)

const monthNS = int64(30 * 24 * 3600 * 1e9)
const dayNS = int64(24 * 3600 * 1e9)

func usdFinding(id int, rule string, raw float64, sev string, first, last int64) Finding {
	return Finding{
		ID: id, RuleID: rule, ImpactValue: raw, ImpactUnit: "USD",
		Severity: sev, Estimated: true, FirstNS: first, LastNS: last,
		Action: "Do the thing.",
	}
}

func TestMonthlyUSDDoesNotInflatePastImpact(t *testing.T) {
	full := usdFinding(1, "a", 12, "medium", 1, 1+monthNS)
	if got := MonthlyUSD(full); math.Abs(got-12) > 0.01 {
		t.Errorf("full month: got %v want 12", got)
	}
	half := usdFinding(2, "a", 6, "medium", 1, 1+monthNS/2)
	if got := MonthlyUSD(half); math.Abs(got-6) > 0.01 {
		t.Errorf("half month must not invent days: got %v want 6", got)
	}
	oneDay := usdFinding(3, "tiny", 0.016, "medium", 1, 1+dayNS)
	if got := MonthlyUSD(oneDay); got > 0.016+1e-9 {
		t.Errorf("1-day span inflated %v from 0.016", got)
	}
	if MonthlyUSD(Finding{ImpactUnit: "s waited", ImpactValue: 90, Severity: "high"}) != 0 {
		t.Error("non-USD should be 0")
	}
	if MonthlyUSD(Finding{ImpactUnit: "USD", ImpactValue: 3, Severity: "error"}) != 0 {
		t.Error("error findings should be 0")
	}
}

func TestHomeSurfaceRanksByHonestDollarsNotInflatedSpan(t *testing.T) {
	// $2 over a month vs $1.50 over a week. Inflating the week to ~$6/month
	// was the lie; honest dollars keep the $2 finding first.
	fs := []Finding{
		usdFinding(1, "low-raw-long", 2.0, "high", 1, 1+monthNS),
		usdFinding(2, "high-monthly", 1.5, "low", 1, 1+monthNS/4),
	}
	got := HomeSurfaceFrom(fs, HomeOpts{HistoryOnly: true})
	if len(got.Shown) != 2 {
		t.Fatalf("shown %d want 2", len(got.Shown))
	}
	if got.Shown[0].RuleID != "low-raw-long" {
		t.Errorf("rank: first=%s want low-raw-long", got.Shown[0].RuleID)
	}
	assertMoneyHeadlineHasCards(t, got)
}

func TestHomeSurfaceThresholdAndFold(t *testing.T) {
	fs := []Finding{
		usdFinding(1, "big", 12, "medium", 1, 1+monthNS),
		usdFinding(2, "tiny", 0.02, "high", 1, 1+monthNS),
		usdFinding(3, "also-tiny", 0.40, "medium", 1, 1+monthNS),
	}
	got := HomeSurfaceFrom(fs, HomeOpts{HistoryOnly: true})
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
	if math.Abs(shownPlusFolded(got)-got.TotalMonthly) > 0.01 {
		t.Errorf("shown+folded %v != total %v", shownPlusFolded(got), got.TotalMonthly)
	}
	assertMoneyHeadlineHasCards(t, got)
}

func TestHomeSurfaceCapsAtThreeAndFoldsRest(t *testing.T) {
	fs := []Finding{
		usdFinding(1, "a", 12, "medium", 1, 1+monthNS),
		usdFinding(2, "b", 10, "medium", 1, 1+monthNS),
		usdFinding(3, "c", 8, "medium", 1, 1+monthNS),
		usdFinding(4, "d", 5, "medium", 1, 1+monthNS),
		usdFinding(5, "e", 3, "medium", 1, 1+monthNS),
	}
	got := HomeSurfaceFrom(fs, HomeOpts{HistoryOnly: true})
	if len(got.Shown) != 3 {
		t.Fatalf("shown %d want 3: %v", len(got.Shown), ids(got.Shown))
	}
	if got.Shown[0].RuleID != "a" || got.Shown[2].RuleID != "c" {
		t.Errorf("order %v", ids(got.Shown))
	}
	if got.Folded != 2 || got.FoldKind != "more" {
		t.Errorf("fold=%d kind=%q want 2 more", got.Folded, got.FoldKind)
	}
	assertMoneyHeadlineHasCards(t, got)
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

func TestHomeSurfaceAllSmallStillShowsCards(t *testing.T) {
	fs := make([]Finding, 0, 10)
	for i := 0; i < 10; i++ {
		fs = append(fs, usdFinding(i, "tiny", 0.30, "low", 1, 1+monthNS))
	}
	got := HomeSurfaceFrom(fs, HomeOpts{HistoryOnly: true})
	if len(got.Shown) != 3 {
		t.Errorf("shown %d want 3 (money headline must have cards)", len(got.Shown))
	}
	if got.Folded != 7 || got.FoldKind != "smaller" {
		t.Errorf("fold=%d kind=%q want 7 smaller", got.Folded, got.FoldKind)
	}
	if math.Abs(got.TotalMonthly-3) > 0.01 {
		t.Errorf("total %v want 3", got.TotalMonthly)
	}
	if math.Abs(shownPlusFolded(got)-got.TotalMonthly) > 0.01 {
		t.Errorf("shown+folded %v != total %v", shownPlusFolded(got), got.TotalMonthly)
	}
	assertMoneyHeadlineHasCards(t, got)
}

func TestHomeSurfaceTinyFindingsStayLeanAndDoNotExceedSpend(t *testing.T) {
	// The history-import screenshot: 66 ~1.2¢ compaction findings, each a
	// 1-day span, ~82¢ spent over 22 days. Inflating each ×30 made $24
	// with zero cards. Honest math stays under a dollar and goes lean.
	fs := make([]Finding, 66)
	for i := 0; i < 66; i++ {
		t0 := int64(i+1) * dayNS
		fs[i] = usdFinding(i, "cache.drop_after_compaction", 0.012, "medium", t0, t0+dayNS)
	}
	got := HomeSurfaceFrom(fs, HomeOpts{HistoryOnly: true, ObservedSpend: 0.82, WindowDays: 22})
	if !strings.Contains(got.Headline, "lean") {
		t.Errorf("headline %q want lean", got.Headline)
	}
	if len(got.Shown) != 0 {
		t.Errorf("shown %v want none under $1 total", ids(got.Shown))
	}
	if got.Folded != 66 || got.FoldKind != "smaller" {
		t.Errorf("fold=%d kind=%q want 66 smaller", got.Folded, got.FoldKind)
	}
	if got.TotalMonthly >= HomeMinMonthly {
		t.Errorf("total %v want under $1", got.TotalMonthly)
	}
	if got.ObservedMonthly > 0 && got.TotalMonthly > got.ObservedMonthly+1e-9 {
		t.Errorf("savings %v exceed observed %v", got.TotalMonthly, got.ObservedMonthly)
	}
	if got.TotalMonthly > 0.82+1e-9 {
		t.Errorf("savings %v exceed window spend 0.82", got.TotalMonthly)
	}
}

func TestHomeSurfaceCapsAtObservedSpend(t *testing.T) {
	fs := []Finding{
		usdFinding(1, "a", 12, "medium", 1, 1+monthNS),
		usdFinding(2, "b", 10, "medium", 1, 1+monthNS),
		usdFinding(3, "c", 8, "medium", 1, 1+monthNS),
		usdFinding(4, "d", 5, "medium", 1, 1+monthNS),
		usdFinding(5, "e", 3, "medium", 1, 1+monthNS),
	}
	got := HomeSurfaceFrom(fs, HomeOpts{HistoryOnly: true, ObservedSpend: 5, WindowDays: 30})
	if math.Abs(got.TotalMonthly-5) > 0.01 {
		t.Errorf("total %v want 5 (capped at spend)", got.TotalMonthly)
	}
	if got.ObservedMonthly > 0 && got.TotalMonthly > got.ObservedMonthly+1e-9 {
		t.Errorf("savings %v exceed observed %v", got.TotalMonthly, got.ObservedMonthly)
	}
	if math.Abs(shownPlusFolded(got)-got.TotalMonthly) > 0.01 {
		t.Errorf("shown+folded %v != total %v", shownPlusFolded(got), got.TotalMonthly)
	}
	assertMoneyHeadlineHasCards(t, got)
}

func TestHomeSurfaceMoneyHeadlineImpliesCards(t *testing.T) {
	cases := []struct {
		name string
		fs   []Finding
		opts HomeOpts
	}{
		{
			name: "one big",
			fs:   []Finding{usdFinding(1, "big", 12, "medium", 1, 1+monthNS)},
			opts: HomeOpts{HistoryOnly: true},
		},
		{
			name: "many small",
			fs: []Finding{
				usdFinding(1, "a", 0.4, "low", 1, 1+monthNS),
				usdFinding(2, "b", 0.4, "low", 1, 1+monthNS),
				usdFinding(3, "c", 0.4, "low", 1, 1+monthNS),
			},
			opts: HomeOpts{HistoryOnly: true},
		},
		{
			name: "capped at spend still money",
			fs:   []Finding{usdFinding(1, "a", 12, "medium", 1, 1+monthNS)},
			opts: HomeOpts{HistoryOnly: true, ObservedSpend: 4, WindowDays: 30},
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := HomeSurfaceFrom(c.fs, c.opts)
			assertMoneyHeadlineHasCards(t, got)
			if got.ObservedMonthly > 0 && got.TotalMonthly > got.ObservedMonthly+1e-9 {
				t.Errorf("savings %v exceed observed %v", got.TotalMonthly, got.ObservedMonthly)
			}
		})
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
	got := HomeSurfaceFrom(fs, HomeOpts{SinceNS: 100, HistoryOnly: true})
	if len(got.Shown) != 1 || got.Shown[0].RuleID != "hist" {
		t.Fatalf("history-only+since: %v", ids(got.Shown))
	}
	live := HomeSurfaceFrom(fs, HomeOpts{SinceNS: 100, HistoryOnly: false})
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

func assertMoneyHeadlineHasCards(t *testing.T, got HomeSavings) {
	t.Helper()
	if !strings.Contains(got.Headline, "you could save") {
		return
	}
	if len(got.Shown) == 0 {
		t.Errorf("money headline %q with zero cards", got.Headline)
	}
	for _, f := range got.Shown {
		if f.MonthlyUSD <= 0 {
			t.Errorf("card %s missing monthly_usd", f.RuleID)
		}
	}
}

func shownPlusFolded(got HomeSavings) float64 {
	sum := got.FoldedMonthly
	for _, f := range got.Shown {
		sum += f.MonthlyUSD
	}
	return sum
}

func ids(fs []Finding) []string {
	out := make([]string, len(fs))
	for i, f := range fs {
		out[i] = f.RuleID
	}
	return out
}
