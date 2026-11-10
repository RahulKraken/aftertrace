package perf

import (
	"fmt"
	"time"

	"github.com/RahulKraken/aftertrace/internal/store"
)

type Spec struct {
	Spans        int
	Sessions     int
	HistorySess  int
	Turns        int
	ContentBytes int
}

func Realistic() Spec {
	return Spec{Spans: 92075, Sessions: 100, HistorySess: 11, Turns: 501}
}

func Large() Spec {
	s := Realistic()
	s.Spans *= 5
	s.Turns *= 5
	s.Sessions *= 5
	s.HistorySess *= 5
	return s
}

func Seed(st *store.Store, spec Spec) error {
	if spec.Turns < 1 {
		spec.Turns = 1
	}
	if spec.Sessions < 1 {
		spec.Sessions = 1
	}
	if spec.Spans < spec.Turns*6 {
		spec.Spans = spec.Turns * 6
	}
	now := time.Now().UnixNano()
	pad := spec.ContentBytes
	if pad < 0 {
		pad = 0
	}
	padSQL := "''"
	if pad > 0 {
		padSQL = fmt.Sprintf("repeat('x', %d)", pad)
	}
	// Interaction roots, one per turn, spread over 40 days so week/day charts have data.
	q := fmt.Sprintf(`
		INSERT INTO spans
		SELECT
			'tr-' || gs,
			'root-' || gs,
			NULL,
			'claude_code.interaction',
			(%d) - ((gs %% 40) * 86400000000000) - gs,
			(%d) - ((gs %% 40) * 86400000000000) - gs + 2000000000,
			2000.0, false, NULL,
			'sess-' || (gs %% %d),
			json_object(
				'session.title', 'turn ' || gs,
				'vcs.repository.name', 'repo-' || (gs %% 11),
				'app.entrypoint', 'cli',
				'user_prompt', 'do the thing ' || gs,
				'pad', %s
			),
			json_object(
				'service.name', 'claude-code',
				'aftertrace.source', CASE WHEN (gs %% %d) < %d THEN 'history' ELSE 'live' END
			)
		FROM generate_series(1, %d) AS t(gs)`,
		now, now, spec.Sessions, padSQL, spec.Sessions, spec.HistorySess, spec.Turns)
	if _, err := st.DB.Exec(q); err != nil {
		return fmt.Errorf("seed interactions: %w", err)
	}
	rest := spec.Spans - spec.Turns
	per := rest / spec.Turns
	if per < 5 {
		per = 5
	}
	// Five named children every turn (llm/tool/wait/exec/hook) plus filler.
	q = fmt.Sprintf(`
		INSERT INTO spans
		SELECT
			'tr-' || turn,
			kind || '-' || turn,
			'root-' || turn,
			CASE kind
				WHEN 'llm' THEN 'claude_code.llm_request'
				WHEN 'tool' THEN 'claude_code.tool'
				WHEN 'wait' THEN 'claude_code.tool.blocked_on_user'
				WHEN 'exec' THEN 'claude_code.tool.execution'
				ELSE 'claude_code.hook'
			END,
			(%d) - ((turn %% 40) * 86400000000000) - turn + 1000000,
			(%d) - ((turn %% 40) * 86400000000000) - turn + 1500000000,
			500.0, false, NULL,
			'sess-' || (turn %% %d),
			json_object(
				'model', 'claude-opus-4-5',
				'request_id', 'req-' || turn,
				'input_tokens', 1200,
				'output_tokens', 400,
				'cache_read_tokens', 200,
				'cache_creation_tokens', 0,
				'tool_name', 'Bash',
				'source', 'user_temporary',
				'cost_usd', 0.012,
				'pad', %s
			),
			json_object(
				'service.name', 'claude-code',
				'aftertrace.source', CASE WHEN (turn %% %d) < %d THEN 'history' ELSE 'live' END
			)
		FROM generate_series(1, %d) AS t(turn)
		CROSS JOIN (SELECT unnest(['llm','tool','wait','exec','hook']) AS kind)`,
		now, now, spec.Sessions, padSQL, spec.Sessions, spec.HistorySess, spec.Turns)
	if _, err := st.DB.Exec(q); err != nil {
		return fmt.Errorf("seed children: %w", err)
	}
	filler := spec.Spans - spec.Turns*6
	if filler > 0 {
		q = fmt.Sprintf(`
			INSERT INTO spans
			SELECT
				'tr-' || ((gs %% %d) + 1),
				'pad-' || gs,
				'root-' || ((gs %% %d) + 1),
				'claude_code.tool',
				(%d) - gs,
				(%d) - gs + 1000000,
				1.0, false, NULL,
				'sess-' || (((gs %% %d) + 1) %% %d),
				json_object('tool_name','Read','pad', %s),
				json_object('service.name','claude-code')
			FROM generate_series(1, %d) AS t(gs)`,
			spec.Turns, spec.Turns, now, now, spec.Turns, spec.Sessions, padSQL, filler)
		if _, err := st.DB.Exec(q); err != nil {
			return fmt.Errorf("seed filler: %w", err)
		}
	}
	if _, err := st.DB.Exec(fmt.Sprintf(`
		INSERT INTO events
		SELECT
			(%d) - turn,
			'api_request',
			'sess-' || (turn %% %d),
			NULL, 'tr-' || turn, 'llm-' || turn, 'req-' || turn, NULL,
			json_object('cost_usd', 0.012, 'skill.name', 'x'),
			json_object('service.name','claude-code')
		FROM generate_series(1, %d) AS t(turn)`, now, spec.Sessions, spec.Turns)); err != nil {
		return fmt.Errorf("seed events: %w", err)
	}
	if err := st.EnsureRollups(); err != nil {
		return err
	}
	_, err := st.DB.Exec(`CHECKPOINT`)
	return err
}
