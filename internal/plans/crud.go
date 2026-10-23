package plans

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"
	"strings"
	"time"
)

type Status string

const (
	StatusActive    Status = "active"
	StatusCancelled Status = "cancelled"
)

type Subscription struct {
	ID            string        `json:"id"`
	CatalogID     string        `json:"catalog_id,omitempty"`
	Vendor        string        `json:"vendor"`
	PlanName      string        `json:"plan_name"`
	Brand         string        `json:"brand,omitempty"`
	Price         *float64      `json:"price"`
	Currency      string        `json:"currency"`
	BillingPeriod BillingPeriod `json:"billing_period"`
	RenewalDay    *int          `json:"renewal_day"`
	StartDate     string        `json:"start_date,omitempty"`
	Status        Status        `json:"status"`
	Notes         string        `json:"notes,omitempty"`
	UsageKind     UsageKind     `json:"usage_kind"`
	CancelledAt   string        `json:"cancelled_at,omitempty"`
	CreatedNS     int64         `json:"created_ns"`
	UpdatedNS     int64         `json:"updated_ns"`
	MonthlyUSD    *float64      `json:"monthly_usd"`
}

type Draft struct {
	CatalogID     string        `json:"catalog_id"`
	Vendor        string        `json:"vendor"`
	PlanName      string        `json:"plan_name"`
	Brand         string        `json:"brand"`
	Price         *float64      `json:"price"`
	Currency      string        `json:"currency"`
	BillingPeriod BillingPeriod `json:"billing_period"`
	RenewalDay    *int          `json:"renewal_day"`
	StartDate     string        `json:"start_date"`
	Notes         string        `json:"notes"`
	UsageKind     UsageKind     `json:"usage_kind"`
}

func newID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}

func List(db *sql.DB) ([]Subscription, error) {
	rows, err := db.Query(`SELECT id, catalog_id, vendor, plan_name, brand, price, currency, billing_period,
		renewal_day, start_date, status, notes, usage_kind, cancelled_at, created_ns, updated_ns
		FROM subscriptions ORDER BY status, vendor, plan_name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Subscription{}
	for rows.Next() {
		s, err := scanSub(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func Get(db *sql.DB, id string) (Subscription, error) {
	row := db.QueryRow(`SELECT id, catalog_id, vendor, plan_name, brand, price, currency, billing_period,
		renewal_day, start_date, status, notes, usage_kind, cancelled_at, created_ns, updated_ns
		FROM subscriptions WHERE id=?`, id)
	s, err := scanSub(row)
	if err == sql.ErrNoRows {
		return Subscription{}, fmt.Errorf("not found")
	}
	return s, err
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanSub(row rowScanner) (Subscription, error) {
	var s Subscription
	var catalog, brand, start, notes, cancelled sql.NullString
	var price sql.NullFloat64
	var renewal sql.NullInt64
	var period, status, kind string
	err := row.Scan(&s.ID, &catalog, &s.Vendor, &s.PlanName, &brand, &price, &s.Currency, &period,
		&renewal, &start, &status, &notes, &kind, &cancelled, &s.CreatedNS, &s.UpdatedNS)
	if err != nil {
		return s, err
	}
	s.CatalogID = catalog.String
	s.Brand = brand.String
	s.Notes = notes.String
	s.StartDate = start.String
	s.CancelledAt = cancelled.String
	s.BillingPeriod = BillingPeriod(period)
	s.Status = Status(status)
	s.UsageKind = UsageKind(kind)
	if price.Valid {
		v := price.Float64
		s.Price = &v
	}
	if renewal.Valid {
		d := int(renewal.Int64)
		s.RenewalDay = &d
	}
	s.MonthlyUSD = MonthlyUSD(s.Price, s.BillingPeriod)
	return s, nil
}

func (d Draft) applyCatalog() Draft {
	if d.CatalogID == "" {
		return d
	}
	e, ok := LookupCatalog(d.CatalogID)
	if !ok {
		return d
	}
	if d.Vendor == "" {
		d.Vendor = e.Vendor
	}
	if d.PlanName == "" {
		d.PlanName = e.PlanName
	}
	if d.Brand == "" {
		d.Brand = e.Brand
	}
	if d.Currency == "" {
		d.Currency = e.Currency
	}
	if d.BillingPeriod == "" {
		d.BillingPeriod = e.BillingPeriod
	}
	if d.UsageKind == "" {
		d.UsageKind = e.UsageKind
	}
	if d.Price == nil && e.Price != nil {
		v := *e.Price
		d.Price = &v
	}
	if d.Notes == "" {
		d.Notes = e.Notes
	}
	return d
}

func (d Draft) cleaned() (Draft, error) {
	d = d.applyCatalog()
	d.Vendor = strings.TrimSpace(d.Vendor)
	d.PlanName = strings.TrimSpace(d.PlanName)
	d.Brand = strings.TrimSpace(d.Brand)
	d.Notes = strings.TrimSpace(d.Notes)
	d.StartDate = strings.TrimSpace(d.StartDate)
	if d.Vendor == "" || d.PlanName == "" {
		return d, fmt.Errorf("vendor and plan name are required")
	}
	switch d.BillingPeriod {
	case PeriodMonthly, PeriodYearly, PeriodUsage:
	case "":
		return d, fmt.Errorf("billing period is required")
	default:
		return d, fmt.Errorf("billing period must be monthly, yearly or usage")
	}
	if d.Currency == "" {
		d.Currency = "USD"
	}
	if d.RenewalDay != nil && (*d.RenewalDay < 1 || *d.RenewalDay > 31) {
		return d, fmt.Errorf("renewal day must be 1–31")
	}
	if d.StartDate != "" && parseDate(d.StartDate) == nil {
		return d, fmt.Errorf("start date must be YYYY-MM-DD")
	}
	if d.Price != nil && *d.Price < 0 {
		return d, fmt.Errorf("price cannot be negative")
	}
	if d.UsageKind == "" {
		d.UsageKind = UsageNone
	}
	return d, nil
}

func Insert(tx *sql.Tx, d Draft, now time.Time) (Subscription, error) {
	d, err := d.cleaned()
	if err != nil {
		return Subscription{}, err
	}
	ns := now.UnixNano()
	id := newID()
	_, err = tx.Exec(`INSERT INTO subscriptions
		(id, catalog_id, vendor, plan_name, brand, price, currency, billing_period, renewal_day, start_date, status, notes, usage_kind, cancelled_at, created_ns, updated_ns)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
		id, nullStr(d.CatalogID), d.Vendor, d.PlanName, nullStr(d.Brand), nullFloat(d.Price), d.Currency, string(d.BillingPeriod),
		nullInt(d.RenewalDay), nullStr(d.StartDate), string(StatusActive), nullStr(d.Notes), string(d.UsageKind), ns, ns)
	if err != nil {
		return Subscription{}, err
	}
	return getTx(tx, id)
}

func Update(tx *sql.Tx, id string, d Draft, now time.Time) (Subscription, error) {
	cur, err := getTx(tx, id)
	if err != nil {
		return Subscription{}, err
	}
	if d.Vendor == "" {
		d.Vendor = cur.Vendor
	}
	if d.PlanName == "" {
		d.PlanName = cur.PlanName
	}
	if d.Brand == "" {
		d.Brand = cur.Brand
	}
	if d.Currency == "" {
		d.Currency = cur.Currency
	}
	if d.BillingPeriod == "" {
		d.BillingPeriod = cur.BillingPeriod
	}
	if d.UsageKind == "" {
		d.UsageKind = cur.UsageKind
	}
	if d.CatalogID == "" {
		d.CatalogID = cur.CatalogID
	}
	if d.Notes == "" && cur.Notes != "" && d.Vendor == cur.Vendor {
		d.Notes = cur.Notes
	}
	if d.Price == nil && d.CatalogID == cur.CatalogID {
		d.Price = cur.Price
	}
	if d.RenewalDay == nil {
		d.RenewalDay = cur.RenewalDay
	}
	if d.StartDate == "" {
		d.StartDate = cur.StartDate
	}
	d, err = d.cleaned()
	if err != nil {
		return Subscription{}, err
	}
	_, err = tx.Exec(`UPDATE subscriptions SET catalog_id=?, vendor=?, plan_name=?, brand=?, price=?, currency=?,
		billing_period=?, renewal_day=?, start_date=?, notes=?, usage_kind=?, updated_ns=? WHERE id=?`,
		nullStr(d.CatalogID), d.Vendor, d.PlanName, nullStr(d.Brand), nullFloat(d.Price), d.Currency,
		string(d.BillingPeriod), nullInt(d.RenewalDay), nullStr(d.StartDate), nullStr(d.Notes), string(d.UsageKind),
		now.UnixNano(), id)
	if err != nil {
		return Subscription{}, err
	}
	return getTx(tx, id)
}

func Cancel(tx *sql.Tx, id string, now time.Time) (Subscription, error) {
	if _, err := getTx(tx, id); err != nil {
		return Subscription{}, err
	}
	day := now.UTC().Format("2006-01-02")
	_, err := tx.Exec(`UPDATE subscriptions SET status=?, cancelled_at=?, updated_ns=? WHERE id=?`,
		string(StatusCancelled), day, now.UnixNano(), id)
	if err != nil {
		return Subscription{}, err
	}
	return getTx(tx, id)
}

func Restore(tx *sql.Tx, id string, now time.Time) (Subscription, error) {
	if _, err := getTx(tx, id); err != nil {
		return Subscription{}, err
	}
	_, err := tx.Exec(`UPDATE subscriptions SET status=?, cancelled_at=NULL, updated_ns=? WHERE id=?`,
		string(StatusActive), now.UnixNano(), id)
	if err != nil {
		return Subscription{}, err
	}
	return getTx(tx, id)
}

func getTx(tx *sql.Tx, id string) (Subscription, error) {
	row := tx.QueryRow(`SELECT id, catalog_id, vendor, plan_name, brand, price, currency, billing_period,
		renewal_day, start_date, status, notes, usage_kind, cancelled_at, created_ns, updated_ns
		FROM subscriptions WHERE id=?`, id)
	s, err := scanSub(row)
	if err == sql.ErrNoRows {
		return Subscription{}, fmt.Errorf("not found")
	}
	return s, err
}

func nullFloat(v *float64) any {
	if v == nil {
		return nil
	}
	return *v
}

func nullInt(v *int) any {
	if v == nil {
		return nil
	}
	return *v
}
