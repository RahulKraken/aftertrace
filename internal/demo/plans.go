package demo

import (
	"database/sql"
	"time"

	"github.com/RahulKraken/aftertrace/internal/plans"
	"github.com/RahulKraken/aftertrace/internal/store"
)

// SeedPlans adds a small local ledger so demo data has a monthly AI total
// and the "barely used" money rule has a row to read. Skips if the file
// already has subscriptions (re-running demo on the same db).
func SeedPlans(st *store.Store) error {
	var n int
	if err := st.DB.QueryRow(`SELECT count(*) FROM subscriptions`).Scan(&n); err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	now := time.Now()
	d1, d15, d28 := 1, 15, 28
	return st.Mutate(func(tx *sql.Tx) error {
		for _, d := range []plans.Draft{
			{CatalogID: "claude-max-20x", RenewalDay: &d1, StartDate: "2026-06-01"},
			{CatalogID: "cursor-ultra-legacy", RenewalDay: &d15, StartDate: "2026-01-15"},
			{CatalogID: "chatgpt-plus", RenewalDay: &d28},
			{CatalogID: "anthropic-api"},
		} {
			if _, err := plans.Insert(tx, d, now); err != nil {
				return err
			}
		}
		return nil
	})
}
