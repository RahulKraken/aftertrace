// Package ask answers plain-English questions about the local store. Claude
// writes read-only SQL, Aftertrace runs it in the sandbox, and only the schema
// and the (truncated) query results are sent to the Anthropic API. It is off
// unless the user starts the server with --ask and sets ANTHROPIC_API_KEY.
package ask

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/RahulKraken/aftertrace/internal/query"
	"github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
	"github.com/anthropics/anthropic-sdk-go/shared/constant"
)

const DefaultModel = "claude-opus-5-5"

// Cells and rows sent to the model are capped. Content attributes (prompts,
// responses, tool output) are long strings, so this keeps them out by size
// even when a query selects them.
const (
	maxRowsToModel  = 50
	maxCellToModel  = 200
	maxSteps        = 8
	maxRowsReturned = 200
)

type Agent struct {
	client anthropic.Client
	Model  string
}

// FromEnv returns an agent when ANTHROPIC_API_KEY is set. AFTERTRACE_ASK_MODEL
// overrides the model; ANTHROPIC_BASE_URL is honoured by the SDK.
func FromEnv() (*Agent, error) {
	key := os.Getenv("ANTHROPIC_API_KEY")
	if key == "" {
		return nil, errors.New("ANTHROPIC_API_KEY is not set")
	}
	model := os.Getenv("AFTERTRACE_ASK_MODEL")
	if model == "" {
		model = DefaultModel
	}
	return New(key, model)
}

func New(apiKey, model string, opts ...option.RequestOption) (*Agent, error) {
	opts = append([]option.RequestOption{option.WithAPIKey(apiKey), option.WithMaxRetries(2)}, opts...)
	return &Agent{client: anthropic.NewClient(opts...), Model: model}, nil
}

// RunSQL executes one read-only statement. The caller owns locking and the sandbox.
type RunSQL func(sql string) (*query.SQLResult, error)

type Step struct {
	SQL   string `json:"sql"`
	Rows  int    `json:"rows"`
	Error string `json:"error,omitempty"`
}

type Result struct {
	Answer   string           `json:"answer"`
	SQL      string           `json:"sql"`
	Result   *query.SQLResult `json:"result"`
	TraceIDs []string         `json:"-"`
	Steps    []Step           `json:"steps"`
	Model    string           `json:"model"`
}

var tools = []anthropic.BetaToolUnionParam{
	{OfTool: &anthropic.BetaToolParam{
		Name:        "run_sql",
		Description: anthropic.String("Run one read-only DuckDB SELECT or WITH statement against the local Aftertrace store and get the rows back (at most 50 rows, long strings truncated). Use it as many times as you need to check your work."),
		Strict:      anthropic.Bool(true),
		InputSchema: anthropic.BetaToolInputSchemaParam{
			Properties: map[string]any{
				"sql": map[string]any{"type": "string", "description": "A single SELECT or WITH statement in DuckDB SQL. No semicolons."},
			},
			Required:    []string{"sql"},
			ExtraFields: map[string]any{"additionalProperties": false},
		},
	}},
	{OfTool: &anthropic.BetaToolParam{
		Name:        "final_answer",
		Description: anthropic.String("Give the final answer. Call this exactly once, after you have run the SQL that supports it."),
		Strict:      anthropic.Bool(true),
		InputSchema: anthropic.BetaToolInputSchemaParam{
			Properties: map[string]any{
				"answer": map[string]any{"type": "string", "description": "Two to five plain sentences with the actual numbers. No markdown headings."},
				"sql":    map[string]any{"type": "string", "description": "The one query whose result best supports the answer. It is re-run and shown to the user."},
				"trace_ids": map[string]any{
					"type":        "array",
					"items":       map[string]any{"type": "string"},
					"description": "Up to five trace_id values of the turns that are the best evidence. Empty if none apply.",
				},
			},
			Required:    []string{"answer", "sql", "trace_ids"},
			ExtraFields: map[string]any{"additionalProperties": false},
		},
	}},
}

func system(schema string) string {
	return `You answer questions about a developer's own AI usage, using a local DuckDB database that Aftertrace filled from OpenTelemetry. The developer runs Claude Code and other agents and apps; you are looking at what those agents did, how long it took, and what it cost.

Work like an analyst: run SQL with run_sql, check that the numbers make sense, then call final_answer once. Prefer the views over raw tables. Use only SELECT or WITH. Timestamps are unix nanoseconds (use to_timestamp(ts_ns / 1e9) for dates). Durations are milliseconds unless the column name says otherwise. Cost is in USD and is Claude Code's own estimate.

Never select prompt text, response text, tool input or tool output (attributes such as prompt, user_prompt, response, tool_input, output). Answer from counts, durations, costs, names and ids. Long strings are truncated before you see them anyway.

If the data cannot answer the question, say what is missing in the final answer instead of guessing.

Schema:
` + schema
}

// Ask runs the tool loop. It returns an error only for API or loop failures;
// SQL errors go back to the model as tool errors so it can fix its query.
func (a *Agent) Ask(ctx context.Context, question, schema string, run RunSQL) (*Result, error) {
	msgs := []anthropic.BetaMessageParam{
		anthropic.NewBetaUserMessage(anthropic.NewBetaTextBlock(question)),
	}
	res := &Result{Model: a.Model, Steps: []Step{}}
	for step := 0; step < maxSteps; step++ {
		resp, err := a.client.Beta.Messages.New(ctx, anthropic.BetaMessageNewParams{
			Model:        anthropic.Model(a.Model),
			MaxTokens:    16000,
			System:       []anthropic.BetaTextBlockParam{{Text: system(schema), CacheControl: anthropic.NewBetaCacheControlEphemeralParam()}},
			Messages:     msgs,
			Tools:        tools,
			ToolChoice:   anthropic.BetaToolChoiceUnionParam{OfAuto: &anthropic.BetaToolChoiceAutoParam{}},
			OutputConfig: anthropic.BetaOutputConfigParam{Effort: anthropic.BetaOutputConfigEffortMedium},
			Fallbacks:    anthropic.BetaFallbacksParamUnion{OfDefault: constant.ValueOf[constant.Default]()},
			Betas:        []anthropic.AnthropicBeta{anthropic.AnthropicBetaServerSideFallback2026_07_01},
		})
		if err != nil {
			return nil, fmt.Errorf("anthropic: %w", err)
		}
		switch resp.StopReason {
		case anthropic.BetaStopReasonRefusal:
			return nil, fmt.Errorf("the model declined to answer (%s)", resp.StopDetails.Category)
		case anthropic.BetaStopReasonMaxTokens:
			return nil, errors.New("the model ran out of output tokens")
		}
		msgs = append(msgs, resp.ToParam())

		var results []anthropic.BetaContentBlockParamUnion
		var text strings.Builder
		for _, block := range resp.Content {
			switch b := block.AsAny().(type) {
			case anthropic.BetaTextBlock:
				text.WriteString(b.Text)
			case anthropic.BetaToolUseBlock:
				raw := b.JSON.Input.Raw()
				switch b.Name {
				case "run_sql":
					var in struct {
						SQL string `json:"sql"`
					}
					if err := json.Unmarshal([]byte(raw), &in); err != nil {
						results = append(results, anthropic.NewBetaToolResultBlock(b.ID, "invalid input: "+err.Error(), true))
						continue
					}
					out, err := run(in.SQL)
					if err != nil {
						res.Steps = append(res.Steps, Step{SQL: in.SQL, Error: err.Error()})
						results = append(results, anthropic.NewBetaToolResultBlock(b.ID, err.Error(), true))
						continue
					}
					res.Steps = append(res.Steps, Step{SQL: in.SQL, Rows: len(out.Rows)})
					results = append(results, anthropic.NewBetaToolResultBlock(b.ID, forModel(out), false))
				case "final_answer":
					var in struct {
						Answer   string   `json:"answer"`
						SQL      string   `json:"sql"`
						TraceIDs []string `json:"trace_ids"`
					}
					if err := json.Unmarshal([]byte(raw), &in); err != nil {
						results = append(results, anthropic.NewBetaToolResultBlock(b.ID, "invalid input: "+err.Error(), true))
						continue
					}
					res.Answer, res.SQL, res.TraceIDs = in.Answer, in.SQL, in.TraceIDs
					if in.SQL != "" {
						if out, err := run(in.SQL); err == nil {
							res.Result = clip(out, maxRowsReturned)
						}
					}
					return res, nil
				default:
					results = append(results, anthropic.NewBetaToolResultBlock(b.ID, "unknown tool", true))
				}
			}
		}
		if len(results) == 0 {
			// The model answered in text without calling final_answer. Accept it.
			res.Answer = strings.TrimSpace(text.String())
			if res.Answer == "" {
				return nil, errors.New("the model returned no answer")
			}
			return res, nil
		}
		msgs = append(msgs, anthropic.NewBetaUserMessage(results...))
	}
	return nil, fmt.Errorf("no answer after %d steps", maxSteps)
}

// forModel renders a result as compact JSON with rows and cells capped.
func forModel(r *query.SQLResult) string {
	c := clip(r, maxRowsToModel)
	rows := make([][]any, len(c.Rows))
	for i, row := range c.Rows {
		out := make([]any, len(row))
		for j, v := range row {
			out[j] = truncateCell(v)
		}
		rows[i] = out
	}
	b, _ := json.Marshal(map[string]any{"columns": c.Columns, "rows": rows, "total_rows": len(r.Rows)})
	return string(b)
}

func truncateCell(v any) any {
	var s string
	switch t := v.(type) {
	case string:
		s = t
	case map[string]any, []any:
		b, _ := json.Marshal(t)
		s = string(b)
	default:
		return v
	}
	if len(s) > maxCellToModel {
		return s[:maxCellToModel] + "…[truncated]"
	}
	return s
}

func clip(r *query.SQLResult, n int) *query.SQLResult {
	if r == nil || len(r.Rows) <= n {
		return r
	}
	return &query.SQLResult{Columns: r.Columns, Rows: r.Rows[:n]}
}
