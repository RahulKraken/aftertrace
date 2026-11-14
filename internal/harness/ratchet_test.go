package harness

import (
	"strings"
	"testing"
)

func TestRatchetGreenToRed(t *testing.T) {
	base := &ratchetFile{Budgets: []ratchetBudget{
		{ID: "B2", Pass: true},
		{ID: "B3", Pass: false},
		{ID: "B4", Pass: true, Resource: map[string]float64{"peak_rss_mb": 100}},
		{ID: "B5", Pass: true, Resource: map[string]float64{"hits": 0}},
	}}
	rep := &Report{Budgets: []Budget{
		{ID: "B2", Pass: false},
		{ID: "B3", Pass: false},
		{ID: "B4", Pass: true, Measured: map[string]any{"peak_rss_mb": 105.0}},
		{ID: "B5", Pass: true, Measured: map[string]any{"hits": 0.0}},
	}}
	errs := checkRatchet(rep, base)
	if len(errs) != 1 || errs[0] != "B2 turned red (was green)" {
		t.Fatalf("got %v", errs)
	}
	rep.Budgets[2].Measured = map[string]any{"peak_rss_mb": 120.0}
	errs = checkRatchet(rep, base)
	if len(errs) != 2 {
		t.Fatalf("want green→red and 10%% RSS, got %v", errs)
	}
	rep.Budgets[1].Pass = true
	errs = checkRatchet(rep, base)
	if !hasPrefix(errs, "B3 turned green (was red)") {
		t.Fatalf("want red→green, got %v", errs)
	}
	rep.Budgets[3].Measured = map[string]any{"hits": 2.0}
	errs = checkRatchet(rep, base)
	if !hasPrefix(errs, "B5 hits 0 → 2") {
		t.Fatalf("want 0→positive, got %v", errs)
	}
}

func TestRatchetSkipsOtherOSResource(t *testing.T) {
	base := &ratchetFile{GOOS: "darwin", Budgets: []ratchetBudget{
		{ID: "B4", Pass: false, Resource: map[string]float64{"peak_rss_mb": 358}},
	}}
	rep := &Report{GOOS: "linux", Budgets: []Budget{
		{ID: "B4", Pass: false, Measured: map[string]any{"peak_rss_mb": 536.0}},
	}}
	errs := checkRatchet(rep, base)
	if len(errs) != 0 {
		t.Fatalf("linux vs darwin resource should skip, got %v", errs)
	}
	rep.GOOS = "darwin"
	errs = checkRatchet(rep, base)
	if len(errs) != 1 || !strings.Contains(errs[0], "B4 peak_rss_mb") {
		t.Fatalf("same OS should compare RSS, got %v", errs)
	}
}

func TestRatchetInvalidNotSkipped(t *testing.T) {
	base := &ratchetFile{Budgets: []ratchetBudget{{ID: "B6", Pass: false}}}
	rep := &Report{Budgets: []Budget{
		{ID: "B6", Pass: false, Invalid: true, Notes: "reopen blocked"},
	}}
	errs := checkRatchet(rep, base)
	if len(errs) != 1 || !strings.Contains(errs[0], "B6 invalid (not skipped)") {
		t.Fatalf("got %v", errs)
	}
}

func hasPrefix(errs []string, want string) bool {
	for _, e := range errs {
		if strings.HasPrefix(e, want) || strings.Contains(e, want) {
			return true
		}
	}
	return false
}
