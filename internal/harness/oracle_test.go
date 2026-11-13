package harness

import "testing"

func TestInputOTLPUniqueKeys(t *testing.T) {
	want := InputOTLP(20)
	if want.Spans != 40 || want.Events != 20 || want.LLMFacts != 20 {
		t.Fatalf("unique %+v", want)
	}
	if want.LLMCost < 0.199 || want.LLMCost > 0.201 {
		t.Fatalf("cost %v", want.LLMCost)
	}
	got := want
	got.Events = 60
	got.MetaSpans = 240
	got.MetaEvents = 60
	got.SourceSpans = map[string]int{"claude-code": 240}
	d := CompareFacts(got, want)
	if len(d) == 0 {
		t.Fatal("duplicate events must fail an INPUT oracle")
	}
	seen := map[string]bool{}
	for _, x := range d {
		seen[x.Field] = true
	}
	for _, f := range []string{"events", "meta.spans", "meta.events", "source_stats.spans.claude-code"} {
		if !seen[f] {
			t.Errorf("missing diff %s in %+v", f, d)
		}
	}
}

func TestCompareFactsCostTolerance(t *testing.T) {
	want := InputOTLP(1)
	got := want
	got.LLMCost += 1e-9
	if d := CompareFacts(got, want); len(d) != 0 {
		t.Fatalf("1e-9 should be inside 1e-6: %v", d)
	}
	got.LLMCost = want.LLMCost + 1e-4
	if d := CompareFacts(got, want); len(d) == 0 {
		t.Fatal("cost drift must fail")
	}
	got = want
	got.TraceCost = 0
	got.SessionCost = 0
	got.DayCost = 0
	got.ModelCost = 0
	d := CompareFacts(got, want)
	if len(d) < 4 {
		t.Fatalf("want trace/session/day/model cost diffs, got %v", d)
	}
}
