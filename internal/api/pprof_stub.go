//go:build !harness

package api

import "net/http"

func maybePprof(next http.Handler, _ *http.ServeMux) http.Handler { return next }
