package api

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/RahulKraken/aftertrace/internal/store"
)

func TestSessions503WhileClosedAndAfterReopen(t *testing.T) {
	st, err := store.Open(filepath.Join(t.TempDir(), "r.duckdb"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err := st.Insert([]store.Span{{
		TraceID: "t1", SpanID: "s1", Name: "claude_code.interaction",
		StartNS: 1, EndNS: 2, DurationMS: 1, SessionID: "sess",
	}}, nil, nil, nil); err != nil {
		t.Fatal(err)
	}

	h := New(st, nil)
	srv := httptest.NewServer(h)
	defer srv.Close()

	if err := st.Close(); err != nil {
		t.Fatal(err)
	}
	res, err := http.Get(srv.URL + "/api/sessions")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("closed sessions status=%d body=%s", res.StatusCode, body)
	}
	var payload map[string]string
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatal(err)
	}
	if payload["code"] != "restarting" || payload["error"] != "restarting" {
		t.Fatalf("payload=%v", payload)
	}
	if strings.Contains(strings.ToLower(string(body)), "sql:") || strings.Contains(strings.ToLower(string(body)), "database is closed") {
		t.Fatalf("leaked driver error: %s", body)
	}

	health, err := http.Get(srv.URL + "/api/health")
	if err != nil {
		t.Fatal(err)
	}
	hb, _ := io.ReadAll(health.Body)
	health.Body.Close()
	if health.StatusCode != 200 {
		t.Fatalf("health status=%d", health.StatusCode)
	}
	var hs map[string]any
	if err := json.Unmarshal(hb, &hs); err != nil {
		t.Fatal(err)
	}
	if hs["ok"] != true || hs["restarting"] != true || hs["ready"] != false {
		t.Fatalf("health=%v", hs)
	}

	if err := st.Reopen(); err != nil {
		t.Fatal(err)
	}
	res2, err := http.Get(srv.URL + "/api/sessions")
	if err != nil {
		t.Fatal(err)
	}
	body2, _ := io.ReadAll(res2.Body)
	res2.Body.Close()
	if res2.StatusCode != 200 {
		t.Fatalf("after reopen status=%d body=%s", res2.StatusCode, body2)
	}
	health2, err := http.Get(srv.URL + "/api/health")
	if err != nil {
		t.Fatal(err)
	}
	hb2, _ := io.ReadAll(health2.Body)
	health2.Body.Close()
	var hs2 map[string]any
	if err := json.Unmarshal(hb2, &hs2); err != nil {
		t.Fatal(err)
	}
	if hs2["ok"] != true || hs2["restarting"] != false {
		t.Fatalf("health after reopen=%v", hs2)
	}
}

func TestHandler503DuringReopenNotDriverError(t *testing.T) {
	st, err := store.Open(filepath.Join(t.TempDir(), "reopen.duckdb"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err := st.Insert([]store.Span{{
		TraceID: "t1", SpanID: "s1", Name: "claude_code.interaction",
		StartNS: 1, EndNS: 2, DurationMS: 1, SessionID: "sess",
	}}, nil, nil, nil); err != nil {
		t.Fatal(err)
	}
	h := New(st, nil)
	srv := httptest.NewServer(h)
	defer srv.Close()

	var wg sync.WaitGroup
	errCh := make(chan string, 64)
	stop := make(chan struct{})
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				select {
				case <-stop:
					return
				default:
				}
				res, err := http.Get(srv.URL + "/api/sessions")
				if err != nil {
					continue
				}
				body, _ := io.ReadAll(res.Body)
				res.Body.Close()
				if res.StatusCode != 200 && res.StatusCode != 503 {
					errCh <- "status " + res.Status
					return
				}
				low := strings.ToLower(string(body))
				if strings.Contains(low, "sql:") || strings.Contains(low, "database is closed") {
					errCh <- string(body)
					return
				}
				if res.StatusCode == 503 && !strings.Contains(low, `"code":"restarting"`) {
					errCh <- string(body)
					return
				}
			}
		}()
	}
	for i := 0; i < 20; i++ {
		if err := st.Reopen(); err != nil {
			close(stop)
			wg.Wait()
			t.Fatal(err)
		}
	}
	close(stop)
	wg.Wait()
	select {
	case msg := <-errCh:
		t.Fatal(msg)
	default:
	}

	res, err := http.Get(srv.URL + "/api/sessions")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("after reopen status=%d", res.StatusCode)
	}
}
