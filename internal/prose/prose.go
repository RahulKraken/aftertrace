// Package prose formats durations, money and tokens for sentences.
// Tables keep the exact formatters in the UI; this is the spoken form:
// "49 min", "41¢", "12M".
package prose

import (
	"fmt"
	"math"
	"strings"
)

// Duration turns milliseconds into spoken time: "36s", "49 min", "3h", "3h 12 min".
func Duration(ms float64) string {
	if math.IsNaN(ms) {
		return ""
	}
	neg := ms < 0
	abs := math.Abs(ms)
	var s string
	switch {
	case abs < 1000:
		n := int(math.Round(abs))
		if n == 0 {
			s = "0s"
		} else {
			s = fmt.Sprintf("%dms", n)
		}
	case abs < 60_000:
		s = fmt.Sprintf("%ds", int(math.Round(abs/1000)))
	case abs < 3_600_000:
		s = fmt.Sprintf("%d min", int(math.Round(abs/60_000)))
	default:
		h := int(abs / 3_600_000)
		min := int(math.Round(math.Mod(abs, 3_600_000) / 60_000))
		if min == 60 {
			h++
			min = 0
		}
		if h >= 24 {
			d := h / 24
			h = h % 24
			if h == 0 {
				s = fmt.Sprintf("%dd", d)
			} else {
				s = fmt.Sprintf("%dd %dh", d, h)
			}
			break
		}
		if min == 0 {
			s = fmt.Sprintf("%dh", h)
		} else {
			s = fmt.Sprintf("%dh %d min", h, min)
		}
	}
	if neg {
		return "-" + s
	}
	return s
}

// Money is spoken currency. Under a dollar becomes cents ("41¢").
// whole rounds to the nearest dollar when the amount is at least $1
// ("Saves about $12 a month"); otherwise two decimals ("$12.40").
func Money(v float64, whole bool) string {
	if math.IsNaN(v) {
		return ""
	}
	neg := v < 0
	abs := math.Abs(v)
	var s string
	if abs < 1 {
		cents := int(math.Round(abs * 100))
		if cents == 0 && abs > 0 {
			cents = 1
		}
		s = fmt.Sprintf("%d¢", cents)
	} else if whole {
		s = fmt.Sprintf("$%d", int(math.Round(abs)))
	} else {
		s = fmt.Sprintf("$%.2f", abs)
	}
	if neg {
		return "-" + s
	}
	return s
}

// Tokens is a spoken count: "12M", "1.2M", "12k", "412". No trailing ".00".
func Tokens(v float64) string {
	if math.IsNaN(v) {
		return ""
	}
	neg := v < 0
	abs := math.Abs(v)
	var s string
	switch {
	case abs >= 1e6:
		s = compact(abs/1e6, "M")
	case abs >= 1e3:
		s = compact(abs/1e3, "k")
	default:
		s = fmt.Sprintf("%d", int(math.Round(abs)))
	}
	if neg {
		return "-" + s
	}
	return s
}

func compact(n float64, suffix string) string {
	if n >= 10 || math.Abs(n-math.Round(n)) < 0.05 {
		return fmt.Sprintf("%d%s", int(math.Round(n)), suffix)
	}
	s := fmt.Sprintf("%.1f%s", n, suffix)
	return strings.Replace(s, ".0"+suffix, suffix, 1)
}
