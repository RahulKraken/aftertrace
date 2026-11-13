package harness

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

type ratchetFile struct {
	Profile string          `json:"profile"`
	Budgets []ratchetBudget `json:"budgets"`
}

type ratchetBudget struct {
	ID       string             `json:"id"`
	Pass     bool               `json:"pass"`
	Resource map[string]float64 `json:"resource,omitempty"`
}

func loadRatchet(path string) (*ratchetFile, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var f ratchetFile
	if err := json.Unmarshal(b, &f); err != nil {
		return nil, err
	}
	return &f, nil
}

func defaultRatchetPath(profile string) string {
	root, err := findModRoot()
	if err != nil {
		return ""
	}
	return filepath.Join(root, "internal/harness/testdata", "baseline-"+profile+".json")
}

// checkRatchet fails when a previously green budget turns red, or a stored
// resource number regresses by more than ~10%. Report-only misses that are
// already red in the baseline stay red.
func checkRatchet(rep *Report, base *ratchetFile) []string {
	if rep == nil || base == nil {
		return nil
	}
	byID := map[string]Budget{}
	for _, b := range rep.Budgets {
		byID[b.ID] = b
	}
	var errs []string
	for _, want := range base.Budgets {
		got, ok := byID[want.ID]
		if !ok {
			continue
		}
		if want.Pass && !got.Pass && !got.Invalid {
			errs = append(errs, fmt.Sprintf("%s turned red (was green)", want.ID))
		}
		for k, prev := range want.Resource {
			cur, ok := resourceNumber(got.Measured, k)
			if !ok || prev <= 0 {
				continue
			}
			if cur > prev*1.10+1e-9 {
				errs = append(errs, fmt.Sprintf("%s %s %.4g → %.4g (>10%%)", want.ID, k, prev, cur))
			}
		}
	}
	return errs
}

func resourceNumber(measured any, key string) (float64, bool) {
	m, ok := measured.(map[string]any)
	if !ok {
		return 0, false
	}
	v, ok := m[key]
	if !ok {
		return 0, false
	}
	switch t := v.(type) {
	case float64:
		return t, true
	case int:
		return float64(t), true
	case int64:
		return float64(t), true
	default:
		return 0, false
	}
}
