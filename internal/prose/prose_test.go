package prose

import "testing"

func TestDuration(t *testing.T) {
	cases := []struct {
		ms   float64
		want string
	}{
		{0, "0s"},
		{500, "500ms"},
		{12_000, "12s"},
		{35_700, "36s"},
		{49 * 60_000, "49 min"},
		{88_890, "1 min"},
		{3 * 3_600_000, "3h"},
		{3*3_600_000 + 12*60_000, "3h 12 min"},
		{26 * 3_600_000, "1d 2h"},
	}
	for _, c := range cases {
		if got := Duration(c.ms); got != c.want {
			t.Errorf("Duration(%v)=%q want %q", c.ms, got, c.want)
		}
	}
}

func TestMoney(t *testing.T) {
	cases := []struct {
		v     float64
		whole bool
		want  string
	}{
		{0.41, true, "41¢"},
		{0.41, false, "41¢"},
		{0.004, false, "1¢"},
		{12.4, true, "$12"},
		{12.40, false, "$12.40"},
		{38.4, true, "$38"},
		{1.00, false, "$1.00"},
	}
	for _, c := range cases {
		if got := Money(c.v, c.whole); got != c.want {
			t.Errorf("Money(%v,%v)=%q want %q", c.v, c.whole, got, c.want)
		}
	}
}

func TestTokens(t *testing.T) {
	cases := []struct {
		v    float64
		want string
	}{
		{12_400_000, "12M"},
		{1_400_000, "1.4M"},
		{1_040_000, "1M"},
		{12_400, "12k"},
		{1_400, "1.4k"},
		{412, "412"},
	}
	for _, c := range cases {
		if got := Tokens(c.v); got != c.want {
			t.Errorf("Tokens(%v)=%q want %q", c.v, got, c.want)
		}
	}
}
