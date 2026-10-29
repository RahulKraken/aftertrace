package rules

import (
	"strings"
	"testing"
)

func TestActionSentenceHistoryRules(t *testing.T) {
	cases := []struct {
		f    Finding
		want string
	}{
		{
			Finding{RuleID: "model.opus_downgrade", Project: "aftertrace",
				Headline: "aftertrace uses claude-opus-4-6 for 28-token turns with no tools"},
			"Use Sonnet for quick replies in aftertrace.",
		},
		{
			Finding{RuleID: "tool.repeated_errors", Project: "app",
				Headline: "Bash failed 3 times with exit_code in one session"},
			"Fix the Bash that keeps failing in app.",
		},
		{
			Finding{RuleID: "model.switch_cache_rebuild", Project: "app",
				Headline: "Switching claude-sonnet-4 to claude-opus-4-6 mid-session rebuilt the prompt cache"},
			"Don't switch from Sonnet to Opus mid-session in app.",
		},
		{
			Finding{RuleID: "cache.drop_after_compaction", Project: "app",
				Headline: "Cache hit rate fell from 98% to 0% after auto compaction"},
			"Start a new session between tasks in app.",
		},
		{
			Finding{RuleID: "mcp.large_results", Project: "app",
				Headline: "mcp__docs__search returned 44000 tokens over 1 calls"},
			"Ask docs for less at a time in app.",
		},
	}
	for _, c := range cases {
		got := ActionSentence(c.f)
		if got != c.want {
			t.Errorf("%s: got %q want %q", c.f.RuleID, got, c.want)
		}
		if hasJargon(got) {
			t.Errorf("%s: jargon in %q", c.f.RuleID, got)
		}
	}
}

func TestMoneyLabelSavingVsCost(t *testing.T) {
	month := int64(30 * 24 * 3600 * 1e9)
	save := MoneyLabel(Finding{
		RuleID: "model.opus_downgrade", ImpactValue: 12.4, ImpactUnit: "USD",
		FirstNS: 1, LastNS: 1 + month,
	})
	if save != "Saves about $12 a month" {
		t.Errorf("opus money: %q", save)
	}
	half := MoneyLabel(Finding{
		RuleID: "mcp.large_results", ImpactValue: 6.2, ImpactUnit: "USD",
		FirstNS: 1, LastNS: 1 + month/2,
	})
	if half != "Saves about $12 a month" {
		t.Errorf("half-month scaled: %q", half)
	}
	cost := MoneyLabel(Finding{
		RuleID: "cache.drop_after_compaction", ImpactValue: 0.42,
		ImpactUnit: "USD on compaction and cache rewrite",
		FirstNS:    1760000000 * 1e9, LastNS: 1761500000 * 1e9,
	})
	if cost == "" || cost[:4] != "Cost" {
		t.Errorf("compaction should be a cost, got %q", cost)
	}
}

func hasJargon(s string) bool {
	l := strings.ToLower(s)
	for _, w := range []string{"tiny turns", "cache rebuild", "downgrade", "compaction"} {
		if strings.Contains(l, w) {
			return true
		}
	}
	return false
}
