package plans

import (
	"math"
	"time"
)

// MonthlyUSD is the calendar-month equivalent of a list price.
// Yearly plans divide by 12. Usage-based plans have no list monthly amount.
func MonthlyUSD(price *float64, period BillingPeriod) *float64 {
	if price == nil || math.IsNaN(*price) || *price < 0 {
		return nil
	}
	switch period {
	case PeriodMonthly:
		v := *price
		return &v
	case PeriodYearly:
		v := *price / 12
		return &v
	default:
		return nil
	}
}

// NextRenewalOn is the next calendar date a plan renews, in local time of `now`.
// Monthly uses renewalDay (1–31, clamped to the month). Yearly uses startDate's
// month and day when present, otherwise renewalDay in the start month of now.
func NextRenewalOn(now time.Time, period BillingPeriod, renewalDay int, startDate *time.Time) (time.Time, bool) {
	now = dateOnly(now)
	day := renewalDay
	if day <= 0 && startDate != nil {
		day = startDate.Day()
	}
	if day <= 0 {
		return time.Time{}, false
	}
	switch period {
	case PeriodMonthly:
		cand := clampDay(now.Year(), now.Month(), day)
		if !cand.After(now) {
			y, m := now.Year(), now.Month()+1
			if m > 12 {
				y, m = y+1, 1
			}
			cand = clampDay(y, m, day)
		}
		return cand, true
	case PeriodYearly:
		month := now.Month()
		year := now.Year()
		if startDate != nil {
			month = startDate.Month()
		}
		cand := clampDay(year, month, day)
		if !cand.After(now) {
			cand = clampDay(year+1, month, day)
		}
		return cand, true
	default:
		return time.Time{}, false
	}
}

func clampDay(year int, month time.Month, day int) time.Time {
	if day < 1 {
		day = 1
	}
	first := time.Date(year, month, 1, 0, 0, 0, 0, time.UTC)
	last := first.AddDate(0, 1, -1).Day()
	if day > last {
		day = last
	}
	return time.Date(year, month, day, 0, 0, 0, 0, time.UTC)
}

func dateOnly(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
}

func daysUntil(now, on time.Time) int {
	d := dateOnly(on).Sub(dateOnly(now))
	n := int(d.Hours() / 24)
	if n < 0 {
		return 0
	}
	return n
}
