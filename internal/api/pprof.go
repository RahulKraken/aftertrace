//go:build harness

package api

import (
	"context"
	"net"
	"net/http"
	"net/http/pprof"
	"net/url"
	"os"
	runtimepprof "runtime/pprof"
	"strings"
)

func maybePprof(next http.Handler) http.Handler {
	if os.Getenv("AFTERTRACE_PPROF") == "" {
		return next
	}
	return withPprof(withRouteLabels(next))
}

func withRouteLabels(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		label := r.Pattern
		if label == "" {
			label = r.Method + " " + r.URL.Path
		}
		runtimepprof.Do(r.Context(), runtimepprof.Labels("route", label), func(ctx context.Context) {
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	})
}

func withPprof(next http.Handler) http.Handler {
	mux := http.NewServeMux()
	wrap := func(h http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			if !pprofOriginOK(r) {
				http.Error(w, "forbidden", http.StatusForbidden)
				return
			}
			h(w, r)
		}
	}
	mux.HandleFunc("/debug/pprof/", wrap(pprof.Index))
	mux.HandleFunc("/debug/pprof/cmdline", wrap(pprof.Cmdline))
	mux.HandleFunc("/debug/pprof/profile", wrap(pprof.Profile))
	mux.HandleFunc("/debug/pprof/symbol", wrap(pprof.Symbol))
	mux.HandleFunc("/debug/pprof/trace", wrap(pprof.Trace))
	mux.Handle("/debug/pprof/heap", wrap(pprof.Handler("heap").ServeHTTP))
	mux.Handle("/debug/pprof/goroutine", wrap(pprof.Handler("goroutine").ServeHTTP))
	mux.Handle("/debug/pprof/threadcreate", wrap(pprof.Handler("threadcreate").ServeHTTP))
	mux.Handle("/debug/pprof/block", wrap(pprof.Handler("block").ServeHTTP))
	mux.Handle("/debug/pprof/mutex", wrap(pprof.Handler("mutex").ServeHTTP))
	mux.Handle("/", next)
	return mux
}

func pprofOriginOK(r *http.Request) bool {
	host := r.Host
	if h, _, err := net.SplitHostPort(r.Host); err == nil {
		host = h
	}
	if host != "127.0.0.1" && host != "localhost" && host != "::1" {
		return false
	}
	o := strings.TrimSpace(r.Header.Get("Origin"))
	if o == "" {
		return true
	}
	u, err := url.Parse(o)
	if err != nil {
		return false
	}
	h := u.Hostname()
	return h == "127.0.0.1" || h == "localhost" || h == "::1"
}
