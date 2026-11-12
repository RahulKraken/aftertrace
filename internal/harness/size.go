package harness

import (
	"fmt"
	"strconv"
	"strings"
	"unicode"
)

// ParseSize accepts 2GiB, 32MiB, 1GB, 100MB, 4096, or 4096B.
func ParseSize(s string) (int64, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, fmt.Errorf("empty size")
	}
	i := len(s)
	for i > 0 {
		r := rune(s[i-1])
		if unicode.IsDigit(r) || r == '.' {
			break
		}
		i--
	}
	num, unit := s[:i], strings.TrimSpace(s[i:])
	if num == "" {
		return 0, fmt.Errorf("invalid size %q", s)
	}
	f, err := strconv.ParseFloat(num, 64)
	if err != nil || f < 0 {
		return 0, fmt.Errorf("invalid size %q", s)
	}
	mult := int64(1)
	switch strings.ToLower(unit) {
	case "", "b":
		mult = 1
	case "k", "kb":
		mult = 1000
	case "ki", "kib":
		mult = 1024
	case "m", "mb":
		mult = 1000 * 1000
	case "mi", "mib":
		mult = 1024 * 1024
	case "g", "gb":
		mult = 1000 * 1000 * 1000
	case "gi", "gib":
		mult = 1024 * 1024 * 1024
	default:
		return 0, fmt.Errorf("invalid size unit %q", unit)
	}
	n := int64(f * float64(mult))
	if n < 1 {
		return 0, fmt.Errorf("size must be at least 1 byte")
	}
	return n, nil
}

func FormatSize(n int64) string {
	switch {
	case n >= 1<<30 && n%(1<<30) == 0:
		return fmt.Sprintf("%dGiB", n>>30)
	case n >= 1<<20 && n%(1<<20) == 0:
		return fmt.Sprintf("%dMiB", n>>20)
	case n >= 1<<20:
		return fmt.Sprintf("%.1fMiB", float64(n)/(1<<20))
	case n >= 1<<10:
		return fmt.Sprintf("%dKiB", n>>10)
	default:
		return fmt.Sprintf("%dB", n)
	}
}
