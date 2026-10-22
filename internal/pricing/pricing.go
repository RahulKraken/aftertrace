// Package pricing estimates the cost of model calls that do not report one.
// Claude Code reports its own cost; apps sending OpenTelemetry GenAI spans
// usually report only tokens. Prices are USD per million tokens, checked
// 2026-10-22 against the providers' pricing pages. They are estimates:
// batch, regional and long-context surcharges are not applied.
package pricing

import (
	"database/sql"
	"strings"
)

type Price struct {
	Prefix     string  // lowercased model id prefix; the longest match wins
	Input      float64 // uncached input
	CacheWrite float64 // 5-minute cache write (Anthropic); same as input elsewhere
	CacheRead  float64
	Output     float64
}

var Table = []Price{
	// Anthropic. Cache writes are 1.25x input for the 5-minute TTL.
	{"claude-fable-5", 10, 12.5, 0.25, 50},
	{"claude-opus-5-5", 4, 5, 0.20, 20},
	{"claude-opus-5", 5, 6.25, 0.50, 25},
	{"claude-opus-4-8", 5, 6.25, 0.50, 25},
	{"claude-opus-4-7", 5, 6.25, 0.50, 25},
	{"claude-opus-4-6", 5, 6.25, 0.50, 25},
	{"claude-opus-4-5", 5, 6.25, 0.50, 25},
	{"claude-opus-4", 15, 18.75, 1.50, 75},
	{"claude-sonnet-5-5", 2, 2.5, 0.10, 10},
	{"claude-sonnet-5", 2, 2.5, 0.20, 10},
	{"claude-sonnet-4", 3, 3.75, 0.30, 15},
	{"claude-haiku-5-5", 0.10, 0.125, 0.01, 0.50},
	{"claude-haiku-4-5", 1, 1.25, 0.10, 5},
	// OpenAI (input, cached input, output; writes billed as input).
	{"gpt-6-astra", 10, 10, 1, 50},
	{"gpt-6.1-sol", 2, 2, 0.10, 10},
	{"gpt-6-sol", 2, 2, 0.20, 10},
	{"gpt-6-luna", 0.10, 0.10, 0.01, 0.50},
	{"gpt-5.6-sol", 4, 4, 0.40, 20},
	{"gpt-5.6-terra", 2, 2, 0.20, 12},
	{"gpt-5.6-luna", 0.20, 0.20, 0.02, 1.20},
	{"gpt-5.5", 5, 5, 0.50, 30},
	{"gpt-5.4-mini", 0.75, 0.75, 0.075, 4.50},
	{"gpt-5.4", 2.50, 2.50, 0.25, 15},
	{"gpt-5-mini", 0.25, 0.25, 0.025, 2},
	{"gpt-5", 1.25, 1.25, 0.125, 10},
	{"gpt-4.1", 2, 2, 0.50, 8},
	{"o3", 2, 2, 0.50, 8},
	// Google Gemini (input, output, cache read; storage not included).
	{"gemini-4-argon", 2, 2, 0.10, 10},
	{"gemini-3.8-flash", 0.75, 0.75, 0.075, 3.75},
	{"gemini-3.6-flash", 0.75, 0.75, 0.075, 3.75},
	{"gemini-3.5-flash-lite", 0.30, 0.30, 0.03, 2.50},
	{"gemini-3.1-pro", 2, 2, 0.20, 12},
	{"gemini-3-flash", 0.50, 0.50, 0.05, 3},
	{"gemini-2.5-pro", 1.25, 1.25, 0.125, 10},
	{"gemini-2.5-flash", 0.30, 0.30, 0.03, 2.50},
}

// Normalize lowercases a model id and strips provider and region prefixes:
// "us.anthropic.claude-opus-5-5" and "models/gemini-2.5-pro" become
// "claude-opus-5-5" and "gemini-2.5-pro".
func Normalize(model string) string {
	m := strings.ToLower(strings.TrimSpace(model))
	if i := strings.LastIndex(m, "/"); i >= 0 {
		m = m[i+1:]
	}
	for {
		i := strings.Index(m, ".")
		if i <= 0 || !isLetters(m[:i]) {
			return m
		}
		m = m[i+1:]
	}
}

func isLetters(s string) bool {
	for _, r := range s {
		if r < 'a' || r > 'z' {
			return false
		}
	}
	return true
}

// Lookup returns the longest-prefix price for a model, if any.
func Lookup(model string) (Price, bool) {
	m := Normalize(model)
	var best Price
	ok := false
	for _, p := range Table {
		if strings.HasPrefix(m, p.Prefix) && len(p.Prefix) > len(best.Prefix) {
			best, ok = p, true
		}
	}
	return best, ok
}

// Seed writes the table into the store so views can price calls in SQL.
func Seed(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`CREATE OR REPLACE TABLE prices (prefix VARCHAR PRIMARY KEY, input DOUBLE, cache_write DOUBLE, cache_read DOUBLE, output DOUBLE)`); err != nil {
		return err
	}
	for _, p := range Table {
		if _, err := tx.Exec(`INSERT INTO prices VALUES (?, ?, ?, ?, ?)`, p.Prefix, p.Input, p.CacheWrite, p.CacheRead, p.Output); err != nil {
			return err
		}
	}
	return tx.Commit()
}
