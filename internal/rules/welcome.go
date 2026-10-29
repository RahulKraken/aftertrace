package rules

import (
	"strings"
	"time"

	"github.com/RahulKraken/aftertrace/internal/prose"
)

// ActionSentence is the first-open advice line: what to do, in plain speech,
// built from the finding. History-capable cost rules each have their own.
func ActionSentence(f Finding) string {
	place := inPlace(f.Project)
	switch f.RuleID {
	case "model.opus_downgrade":
		return "Use Sonnet for quick replies" + place + "."
	case "tool.repeated_errors":
		return "Fix the " + toolLead(f.Headline) + " that keeps failing" + place + "."
	case "model.switch_cache_rebuild":
		from, to, ok := switchModels(f.Headline)
		if ok {
			return "Don't switch from " + modelFamily(from) + " to " + modelFamily(to) + " mid-session" + place + "."
		}
		return "Stay on one model for the whole session" + place + "."
	case "cache.drop_after_compaction":
		return "Start a new session between tasks" + place + "."
	case "mcp.large_results":
		return "Ask " + mcpServer(f.Headline) + " for less at a time" + place + "."
	default:
		if f.Headline != "" {
			return f.Headline
		}
		return f.RuleTitle
	}
}

// MoneyLabel is the quieter line under the advice. USD findings that are a
// change you can make are a monthly saving, scaled from the finding's span.
// Compaction rewrite is money already spent, so it is labelled as a cost
// over the dates.
func MoneyLabel(f Finding) string {
	if !strings.HasPrefix(f.ImpactUnit, "USD") {
		return ""
	}
	if f.RuleID == "cache.drop_after_compaction" {
		span := dateSpan(f.FirstNS, f.LastNS)
		if span != "" {
			return "Cost " + prose.Money(f.ImpactValue, false) + " over " + span
		}
		return "Cost " + prose.Money(f.ImpactValue, false)
	}
	days := spanDays(f.FirstNS, f.LastNS)
	monthly := f.ImpactValue * 30 / days
	return "Saves about " + prose.Money(monthly, true) + " a month"
}

func decorateCopy(fs []Finding) {
	for i := range fs {
		fs[i].Action = ActionSentence(fs[i])
		fs[i].MoneyLabel = MoneyLabel(fs[i])
	}
}

func inPlace(project string) string {
	p := strings.TrimSpace(project)
	if p == "" || p == "unknown" {
		return ""
	}
	if strings.HasSuffix(p, "projects") {
		return " across " + p
	}
	return " in " + p
}

func toolLead(headline string) string {
	fields := strings.Fields(headline)
	if len(fields) == 0 {
		return "tool"
	}
	name := fields[0]
	if strings.HasPrefix(name, "mcp__") {
		parts := strings.Split(name, "__")
		if len(parts) >= 2 && parts[1] != "" {
			return parts[1]
		}
	}
	return name
}

func mcpServer(headline string) string {
	s := toolLead(headline)
	if s == "tool" || s == "" {
		return "the server"
	}
	return s
}

func switchModels(headline string) (from, to string, ok bool) {
	rest, found := strings.CutPrefix(headline, "Switching ")
	if !found {
		return "", "", false
	}
	from, rest, found = strings.Cut(rest, " to ")
	if !found {
		return "", "", false
	}
	to, _, _ = strings.Cut(rest, " mid-session")
	from, to = strings.TrimSpace(from), strings.TrimSpace(to)
	return from, to, from != "" && to != ""
}

func modelFamily(id string) string {
	s := strings.ToLower(id)
	switch {
	case strings.Contains(s, "opus"):
		return "Opus"
	case strings.Contains(s, "sonnet"):
		return "Sonnet"
	case strings.Contains(s, "haiku"):
		return "Haiku"
	}
	s = strings.TrimPrefix(s, "claude-")
	if i := strings.IndexByte(s, '-'); i > 0 {
		s = s[:i]
	}
	if s == "" {
		return "the model"
	}
	return strings.ToUpper(s[:1]) + s[1:]
}

func spanDays(first, last int64) float64 {
	if first <= 0 || last <= 0 || last < first {
		return 30
	}
	d := float64(last-first) / 1e9 / 86400
	if d < 1 {
		return 1
	}
	return d
}

func dateSpan(first, last int64) string {
	if first <= 0 {
		return ""
	}
	a := time.Unix(0, first).UTC()
	b := a
	if last > 0 {
		b = time.Unix(0, last).UTC()
	}
	as := a.Format("2 Jan")
	bs := b.Format("2 Jan")
	if as == bs {
		return as
	}
	return as + " – " + bs
}
