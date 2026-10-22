package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/RahulKraken/aftertrace/internal/api"
	"github.com/RahulKraken/aftertrace/internal/ask"
	"github.com/RahulKraken/aftertrace/internal/demo"
	"github.com/RahulKraken/aftertrace/internal/otlp"
	"github.com/RahulKraken/aftertrace/internal/rules"
	"github.com/RahulKraken/aftertrace/internal/store"
	"github.com/RahulKraken/aftertrace/web"
)

// version is set at release time with -ldflags "-X main.version=v0.1.0".
var version = "dev"

func main() {
	log.SetFlags(0)
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	switch os.Args[1] {
	case "serve":
		os.Exit(cmdServe(os.Args[2:]))
	case "import":
		os.Exit(cmdImport(os.Args[2:]))
	case "demo":
		os.Exit(cmdDemo(os.Args[2:]))
	case "version", "--version":
		fmt.Println("aftertrace", version)
	case "help", "-h", "--help":
		usage()
	default:
		fmt.Fprintf(os.Stderr, "unknown command %q\n", os.Args[1])
		usage()
		os.Exit(2)
	}
}

func usage() {
	fmt.Fprintf(os.Stderr, `Aftertrace — local profiler for Claude Code.

Usage:
  aftertrace serve   [--db PATH] [--listen HOST] [--grpc-port N] [--http-port N] [--ui-port N] [--store-content] [--ask]
  aftertrace import  [--db PATH] [--store-content] <dir>
  aftertrace demo    [--db PATH]
  aftertrace version

Default bind is 127.0.0.1. Pass --listen 0.0.0.0 to accept remote OTLP (team mode).
Prompt, response and tool content attributes are dropped at ingest unless --store-content.
user.email and account IDs are always dropped.
There is no telemetry and no phone-home. --ask is the only path that sends
anything out: the schema and query results go to the Anthropic API
(ANTHROPIC_API_KEY; AFTERTRACE_ASK_MODEL to pick the model).
`)
}

func defaultDB() string {
	h, err := os.UserHomeDir()
	if err != nil {
		return "aftertrace.duckdb"
	}
	return filepath.Join(h, ".aftertrace", "aftertrace.duckdb")
}

func cmdServe(args []string) int {
	fs := flag.NewFlagSet("serve", flag.ExitOnError)
	dbPath := fs.String("db", defaultDB(), "DuckDB file")
	listen := fs.String("listen", "127.0.0.1", "bind address (use 0.0.0.0 for team mode)")
	grpcPort := fs.Int("grpc-port", 4317, "OTLP gRPC port")
	httpPort := fs.Int("http-port", 4318, "OTLP HTTP port")
	uiPort := fs.Int("ui-port", 7311, "UI and JSON API port")
	storeContent := fs.Bool("store-content", false, "keep prompt/response/tool content attributes")
	askOn := fs.Bool("ask", false, "answer English questions with Claude (sends schema and query results to the Anthropic API)")
	_ = fs.Parse(args)

	var opts []api.Option
	askState := "off"
	if *askOn {
		agent, err := ask.FromEnv()
		if err != nil {
			log.Printf("--ask: %v", err)
			return 1
		}
		opts = append(opts, api.WithAsk(agent))
		askState = agent.Model + " (sends schema and query results to the Anthropic API)"
	}

	st, err := store.Open(*dbPath)
	if err != nil {
		log.Printf("open db: %v", err)
		return 1
	}
	defer st.Close()

	recv := otlp.NewReceiver(st, *storeContent)
	grpcLn, httpLn, err := recv.Listen(*listen, *grpcPort, *httpPort)
	if err != nil {
		log.Print(err)
		return 1
	}
	recv.Serve(grpcLn, httpLn)

	apiLn, err := net.Listen("tcp", fmt.Sprintf("%s:%d", *listen, *uiPort))
	if err != nil {
		log.Printf("ui: %v", err)
		return 1
	}
	opts = append(opts, api.WithInfo(api.Info{
		Version: version, DBPath: st.Path, StoreContent: *storeContent,
		GRPC: grpcLn.Addr().String(), HTTP: httpLn.Addr().String(), UI: apiLn.Addr().String(),
	}))
	srv := &http.Server{Handler: api.New(st, web.FS, opts...), ReadHeaderTimeout: 10 * time.Second}
	go func() {
		if err := srv.Serve(apiLn); err != nil && err != http.ErrServerClosed {
			log.Printf("api: %v", err)
		}
	}()

	c, _ := st.Counts()
	log.Printf("Aftertrace")
	log.Printf("  db          %s  (%d spans)", st.Path, c.Spans)
	log.Printf("  OTLP gRPC   %s", grpcLn.Addr())
	log.Printf("  OTLP HTTP   %s", httpLn.Addr())
	log.Printf("  UI / API    http://%s", apiLn.Addr())
	log.Printf("redact=on store_content=%v  (no telemetry)", *storeContent)
	log.Printf("ask=%s", askState)

	ch := make(chan os.Signal, 1)
	signal.Notify(ch, syscall.SIGINT, syscall.SIGTERM)
	<-ch
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	recv.Shutdown(ctx)
	_ = srv.Shutdown(ctx)
	return 0
}

func cmdImport(args []string) int {
	fs := flag.NewFlagSet("import", flag.ExitOnError)
	dbPath := fs.String("db", defaultDB(), "DuckDB file")
	storeContent := fs.Bool("store-content", false, "keep prompt/response/tool content attributes")
	_ = fs.Parse(args)
	if fs.NArg() != 1 {
		fmt.Fprintln(os.Stderr, "usage: aftertrace import [--db PATH] [--store-content] <dir>")
		return 2
	}
	st, err := store.Open(*dbPath)
	if err != nil {
		log.Printf("open db: %v", err)
		return 1
	}
	defer st.Close()
	c, err := otlp.ImportDir(st, fs.Arg(0), *storeContent)
	if err != nil {
		log.Printf("import: %v", err)
		return 1
	}
	log.Printf("imported spans=%d span_events=%d events=%d metric_points=%d", c.Spans, c.SpanEvents, c.Events, c.MetricPoints)
	for _, f := range rules.RunAll(st.DB) {
		log.Printf("[%s] %s  %s  (%g %s, %d evidence)", f.Severity, f.RuleID, f.Headline, f.ImpactValue, f.ImpactUnit, len(f.Evidence))
	}
	return 0
}

func cmdDemo(args []string) int {
	fs := flag.NewFlagSet("demo", flag.ExitOnError)
	dbPath := fs.String("db", defaultDB(), "DuckDB file")
	_ = fs.Parse(args)
	dir, err := os.MkdirTemp("", "aftertrace-demo-*")
	if err != nil {
		log.Print(err)
		return 1
	}
	defer os.RemoveAll(dir)
	sessions, err := demo.WriteJSONL(dir)
	if err != nil {
		log.Printf("generate: %v", err)
		return 1
	}
	st, err := store.Open(*dbPath)
	if err != nil {
		log.Printf("open db: %v", err)
		return 1
	}
	defer st.Close()
	c, err := otlp.ImportDir(st, dir, false)
	if err != nil {
		log.Printf("ingest: %v", err)
		return 1
	}
	log.Printf("loaded %d synthetic sessions into %s", len(sessions), st.Path)
	log.Printf("spans=%d span_events=%d events=%d metric_points=%d  (aftertrace.synthetic=true)", c.Spans, c.SpanEvents, c.Events, c.MetricPoints)
	findings := rules.RunAll(st.DB)
	log.Printf("%d findings", len(findings))
	for _, f := range findings {
		log.Printf("[%s] %s  %s", f.Severity, f.RuleID, f.Headline)
	}
	log.Printf("run: aftertrace serve --db %s", st.Path)
	return 0
}
