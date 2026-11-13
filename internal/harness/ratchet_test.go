package harness

import "testing"

func TestRatchetGreenToRed(t *testing.T) {
	base := &ratchetFile{Budgets: []ratchetBudget{
		{ID: "B2", Pass: true},
		{ID: "B3", Pass: false},
		{ID: "B4", Pass: true, Resource: map[string]float64{"peak_rss_mb": 100}},
	}}
	rep := &Report{Budgets: []Budget{
		{ID: "B2", Pass: false},
		{ID: "B3", Pass: false},
		{ID: "B4", Pass: true, Measured: map[string]any{"peak_rss_mb": 105.0}},
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
}
