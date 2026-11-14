//go:build harness

package api

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRoutePatternUsesAPIMux(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/glance", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
	})
	mux.HandleFunc("GET /api/session/{id}", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
	})
	req := httptest.NewRequest("GET", "/api/glance", nil)
	if g := routePattern(mux, req); g != "GET /api/glance" {
		t.Fatalf("glance %q", g)
	}
	req = httptest.NewRequest("GET", "/api/session/abc", nil)
	if g := routePattern(mux, req); g != "GET /api/session/{id}" {
		t.Fatalf("session %q", g)
	}
	pprofMux := http.NewServeMux()
	pprofMux.Handle("/", mux)
	req = httptest.NewRequest("GET", "/api/glance", nil)
	if g := routePattern(pprofMux, req); g == "GET /api/glance" {
		t.Fatal("pprof catch-all should not be the API pattern")
	}
}
