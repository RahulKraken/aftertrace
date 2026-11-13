//go:build !harness

package api

import "net/http"

func maybePprof(next http.Handler) http.Handler { return next }
