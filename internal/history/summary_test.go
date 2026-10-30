package history

import (
	"math"
	"testing"
	"time"
)

func TestProjectsInSumsToLlmWindow(t *testing.T) {
	st := openStore(t)
	dir := fixtureDir(t)
	if _, err := Import(st, dir); err != nil {
		t.Fatal(err)
	}
	all := Summarize(st.DB, dir)
	// Fixture sessions run 20–25 Oct 2026. A window from the 23rd drops the
	// earlier days, so Home's week is not all-time spend.
	lo := time.Date(2026, 10, 23, 0, 0, 0, 0, time.UTC).UnixNano()
	hi := time.Date(2026, 10, 26, 0, 0, 0, 0, time.UTC).UnixNano()
	in := ProjectsIn(st.DB, lo, hi)
	var sum float64
	for _, p := range in {
		sum += p.CostUSD
	}
	var week float64
	if err := st.DB.QueryRow(`SELECT coalesce(sum(cost_usd),0) FROM llm WHERE start_ns >= ? AND start_ns < ?`, lo, hi).Scan(&week); err != nil {
		t.Fatal(err)
	}
	if math.Abs(sum-week) > 1e-9 {
		t.Fatalf("project rows sum to %v, llm window is %v", sum, week)
	}
	if all.CostUSD <= week+1e-9 {
		t.Fatalf("all-time %v should exceed week %v so the window is doing work", all.CostUSD, week)
	}
	if week <= 0 {
		t.Fatal("week window should still have spend")
	}
	t.Logf("all-time spend $%.2f across %d projects; week $%.2f across %d projects", all.CostUSD, len(all.Projects), week, len(in))
	for _, p := range in {
		t.Logf("  week %s: %d sessions $%.4f", p.Name, p.Sessions, p.CostUSD)
	}
}
