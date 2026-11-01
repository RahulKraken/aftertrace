package rules

import (
	"sort"
	"strings"

	"github.com/RahulKraken/aftertrace/internal/prose"
)

// HomeMinMonthly is the floor for a finding to appear as its own Home card
// when anything already clears it. Below this, it folds into "smaller tweaks"
// — unless the honest total is still a money headline, in which case the
// top cards render anyway so the number is never a sentence with no proof.
const HomeMinMonthly = 1.0

// HomeMaxShown is the attention budget for Home finding cards.
const HomeMaxShown = 3

// HomeOpts is the observation window Home savings are measured against.
type HomeOpts struct {
	SinceNS       int64
	HistoryOnly   bool
	ObservedSpend float64 // actual USD spent in the window; 0 means do not cap
	WindowDays    float64 // observation window in days; <=0 derives from findings
}

// HomeSavings is the first-open Home surface: a savings headline, at most
// three cards, and a fold count for everything else.
type HomeSavings struct {
	TotalMonthly    float64   `json:"total_monthly"`
	ObservedMonthly float64   `json:"observed_monthly"`
	Headline        string    `json:"headline"`
	Shown           []Finding `json:"shown"`
	Folded          int       `json:"folded"`
	FoldedMonthly   float64   `json:"folded_monthly"`
	FoldKind        string    `json:"fold_kind,omitempty"`
}

// MonthlyUSD is the estimated monthly dollars for a finding. It never
// exceeds the finding's own impact: a one-day $0.02 drop is $0.02, not 30×.
func MonthlyUSD(f Finding) float64 {
	return monthlyInWindow(f, spanDays(f.FirstNS, f.LastNS))
}

func monthlyInWindow(f Finding, windowDays float64) float64 {
	if f.Severity == "error" {
		return 0
	}
	if !strings.HasPrefix(f.ImpactUnit, "USD") {
		return 0
	}
	if f.ImpactValue <= 0 {
		return 0
	}
	m := f.ImpactValue * monthFactor(windowDays)
	if m > f.ImpactValue {
		return f.ImpactValue
	}
	return m
}

// monthFactor converts an observation window into a monthly rate. Windows
// shorter than 30 days stay at 1: we do not invent days we did not see.
func monthFactor(days float64) float64 {
	if days <= 0 {
		days = 30
	}
	if days < 1 {
		days = 1
	}
	f := 30 / days
	if f > 1 {
		return 1
	}
	return f
}

func observationDays(first, last int64, fallback float64) float64 {
	if first > 0 && last >= first {
		d := float64(last-first) / 1e9 / 86400
		if d < 1 {
			return 1
		}
		return d
	}
	if fallback > 0 {
		return fallback
	}
	return 30
}

// HomeHeadline is the one sentence above the cards. Tiny or zero totals
// stay honest instead of advertising a sad small number.
func HomeHeadline(total float64) string {
	if total < HomeMinMonthly {
		return "Your setup looks lean. Here's what we saw this month."
	}
	return "About " + prose.Money(total, true) + "/month you could save"
}

// CardMoney is the plain impact on a Home card: "~$12/month".
func CardMoney(monthly float64) string {
	if monthly <= 0 {
		return ""
	}
	return "~" + prose.Money(monthly, true) + "/month"
}

// HomeSurfaceFrom ranks USD findings by honest monthly savings, caps the
// total at observed spend over the same window, shows at most three cards,
// and folds the rest. A money headline always has cards under it.
func HomeSurfaceFrom(fs []Finding, opts HomeOpts) HomeSavings {
	type row struct {
		f Finding
		m float64
	}
	rows := make([]row, 0, len(fs))
	var minFirst, maxLast int64
	for i := range fs {
		f := fs[i]
		if !homeEligible(f, opts.SinceNS, opts.HistoryOnly) {
			continue
		}
		if f.FirstNS > 0 && (minFirst == 0 || f.FirstNS < minFirst) {
			minFirst = f.FirstNS
		}
		if f.LastNS > maxLast {
			maxLast = f.LastNS
		}
		rows = append(rows, row{f: f})
	}
	days := opts.WindowDays
	if days <= 0 {
		days = observationDays(minFirst, maxLast, 0)
	}
	factor := monthFactor(days)
	obsMonthly := 0.0
	if opts.ObservedSpend > 0 {
		obsMonthly = opts.ObservedSpend * factor
	}
	var total float64
	kept := rows[:0]
	for i := range rows {
		m := monthlyInWindow(rows[i].f, days)
		if m <= 0 {
			continue
		}
		rows[i].m = m
		total += m
		kept = append(kept, rows[i])
	}
	rows = kept
	if obsMonthly > 0 && total > obsMonthly {
		s := obsMonthly / total
		for i := range rows {
			rows[i].m *= s
		}
		total = obsMonthly
	}
	sort.SliceStable(rows, func(i, j int) bool {
		if rows[i].m != rows[j].m {
			return rows[i].m > rows[j].m
		}
		if sevRank[rows[i].f.Severity] != sevRank[rows[j].f.Severity] {
			return sevRank[rows[i].f.Severity] > sevRank[rows[j].f.Severity]
		}
		if rows[i].f.RuleID != rows[j].f.RuleID {
			return rows[i].f.RuleID < rows[j].f.RuleID
		}
		return rows[i].f.ID < rows[j].f.ID
	})
	shown := make([]Finding, 0, HomeMaxShown)
	folded := 0
	foldedMonthly := 0.0
	foldMore := false
	headline := HomeHeadline(total)
	moneyHeadline := total >= HomeMinMonthly
	above := 0
	for _, r := range rows {
		if r.m >= HomeMinMonthly {
			above++
		}
	}
	// Money headline with zero cards was the bug: lots of sub-$1 findings
	// still add up. Show the top three in that case. Otherwise keep the
	// $1 floor so a $12 finding is not crowded by cents.
	fill := moneyHeadline && above == 0
	for _, r := range rows {
		take := len(shown) < HomeMaxShown && (r.m >= HomeMinMonthly || fill)
		if take {
			f := r.f
			f.MonthlyUSD = r.m
			shown = append(shown, f)
			continue
		}
		folded++
		foldedMonthly += r.m
		if r.m >= HomeMinMonthly {
			foldMore = true
		}
	}
	kind := ""
	if folded > 0 {
		if foldMore {
			kind = "more"
		} else {
			kind = "smaller"
		}
	}
	return HomeSavings{
		TotalMonthly:    total,
		ObservedMonthly: obsMonthly,
		Headline:        headline,
		Shown:           shown,
		Folded:          folded,
		FoldedMonthly:   foldedMonthly,
		FoldKind:        kind,
	}
}

func homeEligible(f Finding, sinceNS int64, historyOnly bool) bool {
	if f.Severity == "error" {
		return false
	}
	if !strings.HasPrefix(f.ImpactUnit, "USD") {
		return false
	}
	if historyOnly && !f.Estimated {
		return false
	}
	if sinceNS > 0 && f.LastNS > 0 && f.LastNS < sinceNS {
		return false
	}
	return true
}
