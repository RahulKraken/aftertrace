package demo

import (
	"fmt"
	"math/rand"
)

// Synthetic apps for the demo, each in a different instrumentation style so
// the Apps view and the calls view are exercised end to end. Names follow the
// conventions documented in docs/schema-notes.md; nothing here is real data.
type appSpan struct {
	trace, id, parent, name string
	kind                    int
	start, end              int64
	attrs                   map[string]any
	err                     string
}

type app struct {
	service, scope, version string
	spans                   []appSpan
	rng                     *rand.Rand
}

func (a *app) hex(n int) string {
	const h = "0123456789abcdef"
	b := make([]byte, n)
	for i := range b {
		b[i] = h[a.rng.Intn(16)]
	}
	return string(b)
}

func (a *app) span(trace, parent, name string, kind int, start, end int64, at map[string]any, err string) string {
	id := a.hex(16)
	a.spans = append(a.spans, appSpan{trace, id, parent, name, kind, start, end, at, err})
	return id
}

func (a *app) otlp() map[string]any {
	spans := make([]any, 0, len(a.spans))
	for _, s := range a.spans {
		st := map[string]any{}
		if s.err != "" {
			st = map[string]any{"code": 2, "message": s.err}
		}
		spans = append(spans, map[string]any{
			"traceId": s.trace, "spanId": s.id, "parentSpanId": s.parent, "name": s.name, "kind": s.kind,
			"startTimeUnixNano": fmt.Sprintf("%d", s.start), "endTimeUnixNano": fmt.Sprintf("%d", s.end),
			"attributes": attrs(s.attrs), "status": st,
		})
	}
	return map[string]any{"resourceSpans": []any{map[string]any{
		"resource": map[string]any{"attributes": attrs(map[string]any{
			"service.name": a.service, "service.version": a.version, "aftertrace.synthetic": "true",
		})},
		"scopeSpans": []any{map[string]any{"scope": map[string]any{"name": a.scope, "version": a.version}, "spans": spans}},
	}}}
}

const (
	kindInternal = 1
	kindServer   = 2
	kindClient   = 3
	sec          = int64(1e9)
	ms           = int64(1e6)
)

func buildApps(seed int64) []*app {
	rng := rand.New(rand.NewSource(seed))
	start := BaseNS - 18*3600*sec // the evening before the first session
	return []*app{supportBot(rng, start), nightlyDigest(rng, start), notesApp(rng, start)}
}

// support-bot: a TypeScript app on the Claude SDK. Chat requests run a tool
// runner (two messages.create calls around a custom tool); classify requests
// make one Opus call that returns a single label.
func supportBot(rng *rand.Rand, t0 int64) *app {
	a := &app{service: "support-bot", scope: "com.anthropic.sdk.typescript", version: "1.4.2", rng: rng}
	t := t0
	for i := 0; i < 150; i++ {
		t += int64(20+rng.Intn(70)) * 60 * sec
		trace := a.hex(32)
		create := func(parent string, at int64, model string, in, out, cacheRead, cacheWrite int, failed bool) int64 {
			ttft := int64(350+rng.Intn(900)) * ms
			dur := ttft + int64(out)*int64(9+rng.Intn(8))*ms
			attrsm := map[string]any{
				"gen_ai.operation.name": "chat", "gen_ai.provider.name": "anthropic",
				"gen_ai.request.model": model, "gen_ai.response.model": model,
				"gen_ai.usage.input_tokens": in, "gen_ai.usage.output_tokens": out,
				"gen_ai.usage.cache_read.input_tokens": cacheRead, "gen_ai.usage.cache_write.input_tokens": cacheWrite,
				"gen_ai.response.time_to_first_chunk": float64(ttft) / 1e9, "gen_ai.request.stream": true,
				"anthropic.message.stop_reason": "end_turn", "gen_ai.conversation.id": fmt.Sprintf("conv_%04d", i/3),
			}
			errMsg := ""
			if failed {
				dur = int64(200+rng.Intn(300)) * ms
				attrsm["error.type"] = "rate_limit_error"
				delete(attrsm, "gen_ai.usage.output_tokens")
				attrsm["gen_ai.usage.input_tokens"] = 0
				errMsg = "429 rate_limit_error"
			}
			a.span(trace, parent, "anthropic.messages.create", kindClient, at, at+dur, attrsm, errMsg)
			return at + dur
		}
		if i%4 == 3 {
			root := a.span(trace, "", "POST /api/classify", kindServer, t, t, map[string]any{"http.request.method": "POST", "http.route": "/api/classify"}, "")
			end := create(root, t+4*ms, "claude-opus-5-5", 1100+rng.Intn(400), 4+rng.Intn(8), 0, 0, false)
			a.spans[len(a.spans)-2].end = end + 3*ms
			continue
		}
		root := a.span(trace, "", "POST /api/chat", kindServer, t, t, map[string]any{"http.request.method": "POST", "http.route": "/api/chat"}, "")
		rootIdx := len(a.spans) - 1
		runner := a.span(trace, root, "anthropic.messages.tool_runner", kindInternal, t+2*ms, t+2*ms, map[string]any{"gen_ai.operation.name": "chat"}, "")
		runnerIdx := len(a.spans) - 1
		cur := t + 5*ms
		failed := i%9 == 1 // about one chat request in nine hits a rate limit
		cur = create(runner, cur, "claude-sonnet-5-5", 6200+rng.Intn(2000), 60+rng.Intn(90), 5400+rng.Intn(900), 300+rng.Intn(400), failed)
		if !failed {
			toolEnd := cur + int64(80+rng.Intn(600))*ms
			a.span(trace, runner, "anthropic.custom_tool_use lookup_order", kindInternal, cur, toolEnd, map[string]any{
				"gen_ai.operation.name": "execute_tool", "gen_ai.tool.name": "lookup_order", "gen_ai.tool.call.id": "toolu_" + a.hex(20),
			}, "")
			cur = create(runner, toolEnd+2*ms, "claude-sonnet-5-5", 6900+rng.Intn(2000), 180+rng.Intn(260), 6200+rng.Intn(900), 0, false)
		}
		a.spans[runnerIdx].end = cur + ms
		a.spans[rootIdx].end = cur + 4*ms
		if failed {
			a.spans[rootIdx].err = "upstream rate limited"
			a.spans[rootIdx].attrs["http.response.status_code"] = 502
		}
	}
	return a
}

// nightly-digest: a Pydantic AI-style agent run every night at 02:00. The
// agent span carries aggregated usage, which the calls view must not count.
func nightlyDigest(rng *rand.Rand, t0 int64) *app {
	a := &app{service: "nightly-digest", scope: "pydantic-ai", version: "0.9.0", rng: rng}
	for night := 0; night < 8; night++ {
		t := t0 + int64(night)*24*3600*sec + 7*3600*sec
		trace := a.hex(32)
		root := a.span(trace, "", "invoke_agent digest", kindInternal, t, t, map[string]any{
			"gen_ai.operation.name": "invoke_agent", "gen_ai.agent.name": "digest", "gen_ai.provider.name": "anthropic",
			"gen_ai.aggregated_usage.input_tokens": 99999,
		}, "")
		rootIdx := len(a.spans) - 1
		cur := t + 10*ms
		fail := night == 5
		for step := 0; step < 3; step++ {
			in, out := 3800+rng.Intn(3000), 300+rng.Intn(500)
			dur := int64(1200+rng.Intn(2500)) * ms
			a.span(trace, root, "chat claude-haiku-5-5", kindClient, cur, cur+dur, map[string]any{
				"gen_ai.operation.name": "chat", "gen_ai.provider.name": "anthropic", "gen_ai.system": "anthropic",
				"gen_ai.request.model": "claude-haiku-5-5", "gen_ai.usage.input_tokens": in, "gen_ai.usage.output_tokens": out,
			}, "")
			cur += dur
			if step < 2 {
				tool := int64(300+rng.Intn(2200)) * ms
				errMsg := ""
				if fail && step == 1 {
					errMsg = "fetch_feed: 503 from news API"
				}
				a.span(trace, root, "execute_tool fetch_feed", kindInternal, cur, cur+tool, map[string]any{
					"gen_ai.operation.name": "execute_tool", "gen_ai.tool.name": "fetch_feed",
				}, errMsg)
				cur += tool
				if errMsg != "" {
					a.spans[rootIdx].err = "agent run failed: " + errMsg
					break
				}
			}
		}
		a.spans[rootIdx].end = cur + 5*ms
	}
	return a
}

// notes-app: the Vercel AI SDK (v6 telemetry names) on OpenAI.
func notesApp(rng *rand.Rand, t0 int64) *app {
	a := &app{service: "notes-app", scope: "ai", version: "6.0.3", rng: rng}
	t := t0 + 3600*sec
	for i := 0; i < 40; i++ {
		t += int64(60+rng.Intn(240)) * 60 * sec
		trace := a.hex(32)
		dur := int64(700+rng.Intn(1800)) * ms
		root := a.span(trace, "", "ai.generateText", kindInternal, t, t+dur+6*ms, map[string]any{
			"ai.model.id": "gpt-5-mini", "ai.model.provider": "openai.chat", "ai.telemetry.functionId": "summarize-note",
		}, "")
		a.span(trace, root, "ai.generateText.doGenerate", kindClient, t+3*ms, t+3*ms+dur, map[string]any{
			"ai.model.id": "gpt-5-mini", "ai.model.provider": "openai.chat", "ai.response.model": "gpt-5-mini",
			"ai.usage.inputTokens": 900 + rng.Intn(1500), "ai.usage.outputTokens": 120 + rng.Intn(200),
			"ai.response.msToFirstChunk": float64(250 + rng.Intn(500)), "ai.telemetry.functionId": "summarize-note",
			"gen_ai.system": "openai.chat", "gen_ai.request.model": "gpt-5-mini",
		}, "")
	}
	return a
}

// addOutputMetrics gives each demo session the lines, commits and PRs that
// Claude Code reports, so Home can say what the week shipped.
func addOutputMetrics(sessions []*Session, rng *rand.Rand) {
	for i, s := range sessions {
		at := s.T + 60*sec
		s.metric("claude_code.lines_of_code.count", "count", at, float64(40+rng.Intn(400)), map[string]any{"type": "added"}, false)
		s.metric("claude_code.lines_of_code.count", "count", at, float64(5+rng.Intn(90)), map[string]any{"type": "removed"}, false)
		s.metric("claude_code.commit.count", "count", at, float64(1+rng.Intn(3)), nil, false)
		if i%2 == 1 {
			s.metric("claude_code.pull_request.count", "count", at, 1, nil, false)
		}
	}
}
