package plans

import (
	"database/sql"
	"path/filepath"
	"testing"

	_ "github.com/duckdb/duckdb-go/v2"
)

func openTestDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("duckdb", filepath.Join(t.TempDir(), "t.duckdb"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS subscriptions (
		id VARCHAR PRIMARY KEY,
		catalog_id VARCHAR,
		vendor VARCHAR NOT NULL,
		plan_name VARCHAR NOT NULL,
		brand VARCHAR,
		price DOUBLE,
		currency VARCHAR NOT NULL DEFAULT 'USD',
		billing_period VARCHAR NOT NULL,
		renewal_day INTEGER,
		start_date VARCHAR,
		status VARCHAR NOT NULL DEFAULT 'active',
		notes VARCHAR,
		usage_kind VARCHAR NOT NULL DEFAULT 'none',
		cancelled_at VARCHAR,
		created_ns BIGINT NOT NULL,
		updated_ns BIGINT NOT NULL
	)`); err != nil {
		t.Fatal(err)
	}
	if err := SeedCatalog(db); err != nil {
		t.Fatal(err)
	}
	return db
}

func mutate(t *testing.T, db *sql.DB, fn func(*sql.Tx) error) {
	t.Helper()
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if err := fn(tx); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
}
