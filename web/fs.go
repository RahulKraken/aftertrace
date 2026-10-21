package web

import (
	"embed"
	"io/fs"
)

// Dist is the Vite production build (`cd web && npm run build:embed`).
// A stub dist/index.html is committed so `go test ./...` compiles without Node.
// Assets created by the frontend build are picked up from disk at `go build`
// even when gitignored.
//
//go:embed all:dist
var distFS embed.FS

// FS is the static UI served on the UI port. Paths are relative to dist/
// (index.html, assets/*, favicon.svg).
var FS fs.FS = mustDist()

func mustDist() fs.FS {
	sub, err := fs.Sub(distFS, "dist")
	if err != nil {
		panic("web: dist embed: " + err.Error())
	}
	return sub
}
