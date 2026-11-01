package rules

import (
	"sort"
	"strings"

	"github.com/RahulKraken/aftertrace/internal/prose"
)

// HomeMinMonthly is the floor for a finding to appear as its own Home card.
// Below this, it folds into the quiet "smaller tweaks" line.
const HomeMinMonthly = 1.0

// HomeMaxShown is the attention budget for Home finding cards.
const HomeMaxShown = 3

// HomeSavings is the first-open Home surface: a savings headline, at most
// three cards, and a fold count for everything else.
type HomeSavings struct {
	TotalMonthly float64   `json:"total_monthly"`
	Headline     string    `json:"headline"`
	Shown        []Finding `json:"shown"`
	Folded       int       `json:"folded"`
	FoldKind     string    `json:"fold_kind,omitempty"`
}

// MonthlyUSD is the estimated monthly dollars for a finding, scaled from
// the span of its evidence. Non-USD findings are 0.
func MonthlyUSD(f Finding) float64 {
	if f.Severity == "error" {
		return 0
	}
	if !strings.HasPrefix(f.ImpactUnit, "USD") {
		return 0
	}
	if f.ImpactValue <= 0 {
		return 0
	}
	days := spanDays(f.FirstNS, f.LastNS)
	if days <= 0 {
		return 0
	}
	return f.ImpactValue * 30 / days
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

// HomeSurfaceFrom ranks USD findings by monthly savings, hides sub-$1
// cards, keeps at most three, and folds the rest. sinceNS drops evidence
// that ended before that instant. historyOnly keeps estimated-from-files
// findings only.
func HomeSurfaceFrom(fs []Finding, sinceNS int64, historyOnly bool) HomeSavings {
	type row struct {
		f Finding
		m float64
	}
	rows := make([]row, 0, len(fs))
	for i := range fs {
		f := fs[i]
		if !homeEligible(f, sinceNS, historyOnly) {
			continue
		}
		m := MonthlyUSD(f)
		if m <= 0 {
			continue
		}
		rows = append(rows, row{f: f, m: m})
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
	var total float64
	for _, r := range rows {
		total += r.m
	}
	shown := make([]Finding, 0, HomeMaxShown)
	folded := 0
	foldMore := false
	for _, r := range rows {
		if r.m >= HomeMinMonthly && len(shown) < HomeMaxShown {
			shown = append(shown, r.f)
			continue
		}
		folded++
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
		TotalMonthly: total,
		Headline:     HomeHeadline(total),
		Shown:        shown,
		Folded:       folded,
		FoldKind:     kind,
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
