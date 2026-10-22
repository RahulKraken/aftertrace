package pricing

import "testing"

func TestLookupLongestPrefixAndNormalize(t *testing.T) {
	cases := map[string]float64{
		"claude-opus-5-5":              4,
		"us.anthropic.claude-opus-5-5": 4,
		"claude-opus-4-20250514":       15,
		"claude-opus-4-6":              5,
		"claude-haiku-4-5-20251001":    1,
		"models/gemini-2.5-pro":        1.25,
		"openai/gpt-5-mini":            0.25,
		"gpt-5":                        1.25,
		"gpt-5.4-mini-2026-03-01":      0.75,
	}
	for model, in := range cases {
		p, ok := Lookup(model)
		if !ok || p.Input != in {
			t.Errorf("%s: got %+v ok=%v, want input %v", model, p, ok, in)
		}
	}
	if _, ok := Lookup("llama-3-70b"); ok {
		t.Error("unknown model priced")
	}
	if Normalize("gpt-5.4") != "gpt-5.4" {
		t.Errorf("normalize stripped a version dot: %q", Normalize("gpt-5.4"))
	}
}
