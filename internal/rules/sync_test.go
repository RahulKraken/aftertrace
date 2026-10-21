package rules

import (
	"os"
	"path/filepath"
	"testing"
)

func TestRepoRulesMatchEmbedded(t *testing.T) {
	root := filepath.Join("..", "..", "rules")
	ents, err := os.ReadDir(root)
	if err != nil {
		t.Fatal(err)
	}
	embedded, err := os.ReadDir("files")
	if err != nil {
		t.Fatal(err)
	}
	if len(ents) != len(embedded) {
		t.Fatalf("rules/ has %d files, internal/rules/files has %d", len(ents), len(embedded))
	}
	for _, e := range embedded {
		if e.IsDir() {
			continue
		}
		a, err := os.ReadFile(filepath.Join("files", e.Name()))
		if err != nil {
			t.Fatal(err)
		}
		b, err := os.ReadFile(filepath.Join(root, e.Name()))
		if err != nil {
			t.Fatal(err)
		}
		if string(a) != string(b) {
			t.Errorf("%s differs between rules/ and internal/rules/files/", e.Name())
		}
	}
}
