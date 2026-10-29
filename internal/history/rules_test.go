package history

import (
	"strings"
	"testing"

	"github.com/RahulKraken/aftertrace/internal/rules"
	"github.com/RahulKraken/aftertrace/internal/store"
)

func TestHistoryCapableRulesFireOnFixtures(t *testing.T) {
	st := openStore(t)
	if _, err := Import(st, fixtureDir(t)); err != nil {
		t.Fatal(err)
	}

	var toks float64
	if err := st.DB.QueryRow(`SELECT result_tokens FROM tools WHERE tool_name = 'mcp__docs__search'`).Scan(&toks); err != nil {
		t.Fatal(err)
	}
	if toks < 10000 {
		t.Fatalf("mcp result_tokens=%v, want >10000 from tool_result content", toks)
	}

	fs := rules.RunAll(st.DB)
	got := map[string][]rules.Finding{}
	for _, f := range fs {
		if f.Severity == "error" {
			t.Errorf("rule error: %s %s", f.RuleID, f.Headline)
		}
		got[f.RuleID] = append(got[f.RuleID], f)
	}

	need := []string{
		"tool.repeated_errors",
		"model.switch_cache_rebuild",
		"cache.drop_after_compaction",
		"mcp.large_results",
		"model.opus_downgrade",
	}
	for _, id := range need {
		if len(got[id]) == 0 {
			t.Errorf("rule %s did not fire on history fixtures", id)
			continue
		}
		for _, f := range got[id] {
			if !f.Estimated {
				t.Errorf("%s not labelled estimated from session files", id)
			}
		}
	}

	// tool.repeated_errors: Bash in session A (v2.1.305) and Read in session C
	// (v2.0.70, below @min_version 2.1.268). History reconstructs success from
	// tool_result.is_error, so the version header must not skip those rows.
	var sawBash, sawOldRead bool
	for _, f := range got["tool.repeated_errors"] {
		if strings.Contains(f.Headline, "Bash") {
			sawBash = true
		}
		for _, sid := range f.Sessions {
			if sid == "cccccccc-cccc-4ccc-8ccc-cccccccccccc" {
				sawOldRead = true
			}
		}
	}
	if !sawBash {
		t.Error("tool.repeated_errors: missing Bash failures from session A")
	}
	if !sawOldRead {
		t.Error("tool.repeated_errors: session C (service.version 2.0.70) should still match; min_version is not a skip gate on reconstructed history")
	}

	if len(got["cache.drop_after_compaction"]) == 0 {
		t.Fatal("cache.drop_after_compaction")
	}
	if !strings.Contains(got["cache.drop_after_compaction"][0].Detail, "tokens") {
		t.Errorf("cache drop detail missing derived token counts: %s", got["cache.drop_after_compaction"][0].Detail)
	}

	opus := got["model.opus_downgrade"][0]
	if !strings.Contains(opus.Detail, "claude-sonnet-5-5") || !strings.Contains(opus.Detail, "claude-haiku-5-5") {
		t.Errorf("opus detail should show Sonnet and Haiku costs: %s", opus.Detail)
	}
	if opus.Project != "inbox" {
		t.Errorf("opus project=%q", opus.Project)
	}
	wantAction := map[string]string{
		"model.opus_downgrade":        "Use Sonnet for quick replies in inbox.",
		"tool.repeated_errors":        "Fix the Bash that keeps failing in app.",
		"model.switch_cache_rebuild":  "Don't switch from Sonnet to Opus mid-session in app.",
		"cache.drop_after_compaction": "Start a new session between tasks in app.",
		"mcp.large_results":           "Ask docs for less at a time in app.",
	}
	for id, want := range wantAction {
		if len(got[id]) == 0 {
			continue
		}
		// Bash is session A; Read on session C is a second repeated-errors row.
		found := false
		for _, f := range got[id] {
			if f.Action == want {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("%s action=%q want %q (all: %v)", id, got[id][0].Action, want, actions(got[id]))
		}
	}

	silent := []string{
		"hook.overhead", "permission.allow_rule_candidate", "retry.waste", "retry.exhausted",
		"skill.cost", "plugin.skills_unused", "app.model_downgrade", "app.errors", "app.no_prompt_cache",
	}
	for _, id := range silent {
		if len(got[id]) != 0 {
			t.Errorf("rule %s should stay silent on history-only data, got %d", id, len(got[id]))
		}
	}
}

func TestHistoryFindingsDedupWhenLiveOTelArrives(t *testing.T) {
	st := openStore(t)
	if _, err := Import(st, fixtureDir(t)); err != nil {
		t.Fatal(err)
	}
	before := rules.RunAll(st.DB)
	sid := "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
	nBefore := 0
	for _, f := range before {
		for _, s := range f.Sessions {
			if s == sid {
				nBefore++
			}
		}
	}
	if nBefore == 0 {
		t.Fatal("expected history findings on session B before live OTel")
	}
	live := store.Span{
		TraceID: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", SpanID: "cccccccccccccccc",
		Name: "claude_code.llm_request", StartNS: 1, EndNS: 2, DurationMS: 0.001,
		SessionID: sid,
		Attrs:     map[string]any{"session.id": sid, "model": "claude-sonnet-4", "request_id": "live-b"},
		Resource:  map[string]any{"service.name": "claude-code"},
	}
	if err := st.Insert([]store.Span{live}, nil, nil, nil); err != nil {
		t.Fatal(err)
	}
	after := rules.RunAll(st.DB)
	nAfter := 0
	var stillHist bool
	for _, f := range after {
		for _, s := range f.Sessions {
			if s == sid {
				nAfter++
				if f.Estimated {
					stillHist = true
				}
			}
		}
	}
	if stillHist {
		t.Error("findings for a live-OTel session should not stay labelled estimated from session files")
	}
	// History rows are dropped; live stub has no compaction/switch, so B's
	// history findings disappear rather than doubling.
	if nAfter >= nBefore && nBefore > 0 {
		t.Errorf("findings citing session B: before=%d after=%d (duplicates?)", nBefore, nAfter)
	}
}

func actions(fs []rules.Finding) []string {
	out := make([]string, len(fs))
	for i, f := range fs {
		out[i] = f.Action
	}
	return out
}

func TestPickMoneyFindingPrefersUSDAndConfidence(t *testing.T) {
	fs := []rules.Finding{
		{RuleID: "a", ImpactValue: 2, ImpactUnit: "USD", Severity: "low", Estimated: true, LastNS: 2},
		{RuleID: "b", ImpactValue: 2, ImpactUnit: "USD", Severity: "high", Estimated: true, LastNS: 2},
		{RuleID: "c", ImpactValue: 9, ImpactUnit: "s waited", Severity: "high", Estimated: true, LastNS: 2},
		{RuleID: "d", ImpactValue: 3, ImpactUnit: "USD", Severity: "medium", Estimated: false, LastNS: 2},
	}
	got := rules.PickMoneyFinding(fs, 1, true)
	if got == nil || got.RuleID != "b" {
		t.Fatalf("tie on $2 should pick higher confidence, got %+v", got)
	}
	got = rules.PickMoneyFinding(fs, 1, false)
	if got == nil || got.RuleID != "d" {
		t.Fatalf("with live included, $3 should win, got %+v", got)
	}
}
