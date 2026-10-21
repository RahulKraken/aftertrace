package demo

import "math/rand"

var (
	npmTest   = map[string]any{"bash_command_class": "package_manager", "bash_argv0": "npm", "full_command": "npm test -- --watch=false"}
	gitCommit = map[string]any{"bash_command_class": "vcs", "bash_argv0": "git", "full_command": "git commit -m \"wip\""}
	pytest    = map[string]any{"bash_command_class": "other", "bash_argv0": "other", "full_command": "pytest tests/unit -x"}
)

func pNpm() map[string]any {
	return map[string]any{"bash_command": "npm test -- --watch=false", "full_command": "npm test -- --watch=false", "timeout": 120000}
}

func buildSessions(rng *rand.Rand) []*Session {
	var sessions []*Session

	s := newSession(rng, "acme-web", "claude-sonnet-5", "high", BaseNS, "cli")
	sessions = append(sessions, s)
	s.start([][2]any{{"release-notes", 2}}, [][2]string{{"linear", "connected"}}, nil)
	for i := 0; i < 5; i++ {
		ii := i
		s.interaction(func(ctx [4]string, t int64) int64 {
			if ii == 0 {
				t, _, _ = s.llm(ctx, t, llmOpt{effort: "__s"})
				t, _, _ = s.tool(ctx, t, "Skill", toolOpt{execMS: 40, extra: map[string]any{"skill_name": "frontend-design"}, params: map[string]any{"skill_name": "frontend-design"}})
				s.event("skill_activated", t, map[string]any{"skill.name": "frontend-design", "invocation_trigger": "claude-proactive", "skill.source": "userSettings"}, ctx[0], ctx[3], ctx[2])
				s.skill = "frontend-design"
			}
			att := 1
			if ii == 2 {
				att = 2
			}
			t, _, _ = s.llm(ctx, t, llmOpt{effort: "__s", attempts: att, errClass: "server_overload"})
			var ends []int64
			for k := 0; k < 3; k++ {
				e, _, _ := s.tool(ctx, t, "Read", toolOpt{execMS: 8 + s.rng.Intn(33), extra: map[string]any{"file_path": "src/components/Card" + itoa(k) + ".tsx"}})
				ends = append(ends, e)
			}
			t = max64(ends)
			t, _, _ = s.llm(ctx, t, llmOpt{effort: "__s"})
			t, _, _ = s.tool(ctx, t, "Edit", toolOpt{execMS: 60, extra: map[string]any{"file_path": "src/components/Card0.tsx"}})
			t, _, _ = s.llm(ctx, t, llmOpt{effort: "__s"})
			t, _, _ = s.tool(ctx, t, "Bash", toolOpt{
				execMS: 14000 + s.rng.Intn(12001),
				perm:   &perm{waitMS: 6000 + s.rng.Intn(25001), decision: "accept", source: "user_temporary"},
				extra:  npmTest, params: pNpm(),
			})
			t, _, _ = s.llm(ctx, t, llmOpt{effort: "__s", stop: "end_turn"})
			return t
		}, 0, nil)
	}

	s2 := newSession(rng, "acme-api", "claude-opus-5", "xhigh", BaseNS+int64(26*3600e9), "cli")
	sessions = append(sessions, s2)
	s2.start([][2]any{{"release-notes", 2}}, [][2]string{{"linear", "connected"}, {"sentry", "failed"}}, nil)
	for i := 0; i < 4; i++ {
		ii := i
		s2.interaction(func(ctx [4]string, t int64) int64 {
			t, _, _ = s2.llm(ctx, t, llmOpt{effort: "__s"})
			if ii == 0 {
				t, _, _ = s2.tool(ctx, t, "mcp__linear__list_issues", toolOpt{
					execMS: 1500 + s2.rng.Intn(1501), resultTokens: 18000 + s2.rng.Intn(8001), mcp: "user",
					params: map[string]any{"mcp_server_name": "linear", "mcp_tool_name": "list_issues"},
				})
				added := 22000
				t, _, _ = s2.llm(ctx, t, llmOpt{effort: "__s", added: &added, attribution: map[string]any{"mcp_server.name": "linear", "mcp_tool.name": "list_issues"}})
				starts := t
				var ends []int64
				for _, spec := range []struct {
					atype, model string
					nested       bool
				}{{"general-purpose", "claude-sonnet-5", true}, {"code-reviewer", "claude-opus-5", false}} {
					spec := spec
					e, _, _ := s2.tool(ctx, starts, "Agent", toolOpt{
						execMS: 50, extra: map[string]any{"subagent_type": spec.atype},
						params: map[string]any{"subagent_type": spec.atype},
						children: func(toolSID string, tt int64) int64 {
							return subagent(s2, ctx, toolSID, tt, spec.atype, spec.model, 4, "", spec.nested)
						},
					})
					ends = append(ends, e)
				}
				t = max64(ends)
				t, _, _ = s2.llm(ctx, t, llmOpt{effort: "__s"})
			}
			if ii == 2 {
				for n := 0; n < 2; n++ {
					t, _, _ = s2.tool(ctx, t, "mcp__linear__get_issue", toolOpt{
						execMS: 900 + s2.rng.Intn(701), resultTokens: 12000 + s2.rng.Intn(8001), mcp: "user",
						params: map[string]any{"mcp_server_name": "linear", "mcp_tool.name": "get_issue"},
					})
					added := 15000
					t, _, _ = s2.llm(ctx, t, llmOpt{effort: "__s", added: &added, attribution: map[string]any{"mcp_server.name": "linear", "mcp_tool.name": "get_issue"}})
				}
			}
			t, _, _ = s2.tool(ctx, t, "Edit", toolOpt{execMS: 80, extra: map[string]any{"file_path": "api/handlers/orders.go"}})
			t, _, _ = s2.llm(ctx, t, llmOpt{effort: "__s", stop: "end_turn"})
			return t
		}, 0, nil)
	}

	s3 := newSession(rng, "acme-web", "claude-sonnet-5", "medium", BaseNS+int64(50*3600e9), "cli")
	sessions = append(sessions, s3)
	s3.start([][2]any{{"release-notes", 2}}, nil, nil)
	s3.ctx = 40000
	for i := 0; i < 10; i++ {
		ii := i
		gap := 30 + rng.Float64()*90
		s3.interaction(func(ctx [4]string, t int64) int64 {
			if ii == 6 {
				pre := s3.ctx
				added := 500
				t, _, _ = s3.llm(ctx, t, llmOpt{effort: "__s", querySource: "compact", querySourceSafe: "compact", outTokens: 3500, stop: "end_turn", added: &added})
				s3.event("compaction", t, map[string]any{"trigger": "auto", "success": "true", "duration_ms": 41000, "pre_tokens": pre, "post_tokens": 14000}, ctx[0], ctx[3], ctx[2])
				s3.ctx = 14000
				s3.cacheModel = ""
			}
			if ii == 8 {
				s3.Model = "claude-opus-5"
				s3.Effort = "high"
			}
			for n := 0; n < 3; n++ {
				added := 3000 + s3.rng.Intn(3001)
				t, _, _ = s3.llm(ctx, t, llmOpt{effort: "__s", added: &added})
				var ends []int64
				for k := 0; k < 2; k++ {
					e, _, _ := s3.tool(ctx, t, "Read", toolOpt{
						execMS: 10 + s3.rng.Intn(41), resultTokens: 3000 + s3.rng.Intn(4001),
						extra: map[string]any{"file_path": "src/lib/mod" + itoa(k) + ".ts"},
					})
					ends = append(ends, e)
				}
				t = max64(ends)
				added2 := 2500 + s3.rng.Intn(2501)
				t, _, _ = s3.llm(ctx, t, llmOpt{effort: "__s", added: &added2})
				t, _, _ = s3.tool(ctx, t, "Edit", toolOpt{execMS: 70, extra: map[string]any{"file_path": "src/lib/mod0.ts"}})
			}
			if ii%3 == 2 {
				t, _, _ = s3.tool(ctx, t, "Bash", toolOpt{
					execMS: 900,
					perm:   &perm{waitMS: 4000 + s3.rng.Intn(11001), decision: "accept", source: "user_temporary"},
					extra:  gitCommit,
					params: map[string]any{"bash_command": "git commit -m \"wip\"", "full_command": "git commit -m \"wip\"", "timeout": 120000},
				})
			}
			t, _, _ = s3.llm(ctx, t, llmOpt{effort: "__s", stop: "end_turn"})
			return t
		}, 0, &gap)
	}

	s4 := newSession(rng, "acme-api", "claude-sonnet-5", "high", BaseNS+int64(74*3600e9), "cli")
	sessions = append(sessions, s4)
	s4.start(nil, nil, nil)
	atts := []int{4, 3, 1, 5}
	for i := 0; i < 4; i++ {
		ii := i
		s4.interaction(func(ctx [4]string, t int64) int64 {
			t, _, _ = s4.llm(ctx, t, llmOpt{effort: "__s", attempts: atts[ii], errClass: "server_overload"})
			t, _, _ = s4.tool(ctx, t, "Grep", toolOpt{execMS: 120})
			if ii == 1 {
				t, _, _ = s4.llm(ctx, t, llmOpt{effort: "__s", attempts: 11, fail: true, statusCode: 529, errClass: "server_overload"})
				t += 20_000_000_000
				t, _, _ = s4.llm(ctx, t, llmOpt{effort: "__s", attempts: 2, errClass: "api_timeout"})
			}
			att := 1
			if ii == 3 {
				att = 2
			}
			ec := ""
			if att > 1 {
				ec = "api_timeout"
			}
			t, _, _ = s4.llm(ctx, t, llmOpt{effort: "__s", stop: "end_turn", attempts: att, errClass: ec})
			return t
		}, 0, nil)
	}

	s5 := newSession(rng, "dotfiles", "claude-opus-5", "max", BaseNS+int64(98*3600e9), "cli")
	sessions = append(sessions, s5)
	s5.start([][2]any{{"release-notes", 2}}, nil, []string{"PreToolUse"})
	for i := 0; i < 3; i++ {
		ii := i
		s5.interaction(func(ctx [4]string, t int64) int64 {
			if ii == 0 {
				t, _, _ = s5.tool(ctx, t, "Skill", toolOpt{execMS: 30, extra: map[string]any{"skill_name": "pdf-report"}, params: map[string]any{"skill_name": "pdf-report"}})
				s5.event("skill_activated", t, map[string]any{"skill.name": "pdf-report", "invocation_trigger": "user-slash", "skill.source": "userSettings"}, ctx[0], ctx[3], ctx[2])
				s5.skill = "pdf-report"
			}
			added := 8000 + s5.rng.Intn(7001)
			t, _, _ = s5.llm(ctx, t, llmOpt{effort: "__s", outTokens: 2500 + s5.rng.Intn(3501), added: &added})
			for k := 0; k < 3; k++ {
				t = s5.hook(ctx, t, "PreToolUse:Bash", 1800+s5.rng.Intn(801))
				fail := ""
				if ii < 2 {
					fail = "ShellError"
				}
				t, _, _ = s5.tool(ctx, t, "Bash", toolOpt{
					execMS: 3000 + s5.rng.Intn(6001), extra: pytest, fail: fail,
					params: map[string]any{"bash_command": "pytest tests/unit -x", "full_command": "pytest tests/unit -x", "timeout": 120000},
				})
				t, _, _ = s5.llm(ctx, t, llmOpt{effort: "__s", outTokens: 1500 + s5.rng.Intn(2501)})
			}
			if ii == 1 {
				t, _, _ = s5.tool(ctx, t, "Bash", toolOpt{
					execMS: 0,
					perm:   &perm{waitMS: 9000, decision: "reject", source: "user_reject"},
					extra:  map[string]any{"bash_command_class": "other", "bash_argv0": "other", "full_command": "rm -rf build/"},
				})
				t, _, _ = s5.llm(ctx, t, llmOpt{effort: "__s"})
			}
			t, _, _ = s5.llm(ctx, t, llmOpt{effort: "__s", stop: "end_turn", outTokens: 2000 + s5.rng.Intn(3001)})
			return t
		}, 0, nil)
	}

	s6 := newSession(rng, "dotfiles", "claude-haiku-5", nil, BaseNS+int64(120*3600e9), "claude-vscode")
	sessions = append(sessions, s6)
	s6.start(nil, nil, nil)
	turn := func(ctx [4]string, t int64) int64 {
		t, _, _ = s6.llm(ctx, t, llmOpt{effort: "__s", outTokens: 300})
		t, _, _ = s6.tool(ctx, t, "Read", toolOpt{execMS: 15, extra: map[string]any{"file_path": ".zshrc"}})
		t, _, _ = s6.llm(ctx, t, llmOpt{effort: "__s", stop: "end_turn", outTokens: 400})
		return t
	}
	s6.interaction(turn, 0, nil)
	s6.interaction(turn, 0, nil)

	return sessions
}

func subagent(sess *Session, ctx [4]string, parentTool string, t int64, agentType, model string, nSteps int, parentAgent string, nested bool) int64 {
	aid := "agent_" + sess.b62(10)
	t0 := t
	sctx := [4]string{ctx[0], parentTool, ctx[2], ctx[3]}
	qss := "agent.builtin." + agentType
	if agentType == "code-reviewer" {
		qss = "agent.custom"
	}
	attr := map[string]any{"agent.name": agentType}
	tools := 0
	for k := 0; k < nSteps; k++ {
		added := 2000 + sess.rng.Intn(7001)
		eff := any("medium")
		if model == "claude-haiku-5" {
			eff = nil
		}
		t, _, _ = sess.llm(sctx, t, llmOpt{model: model, effort: eff, agent: aid, parentAgent: parentAgent,
			querySourceSafe: qss, querySource: agentType, attribution: attr, added: &added})
		if nested && k == 1 {
			t, _, _ = sess.tool(sctx, t, "Agent", toolOpt{
				execMS: 50, agent: aid, parentAgent: parentAgent,
				extra:  map[string]any{"subagent_type": "general-purpose"},
				params: map[string]any{"subagent_type": "general-purpose"},
				children: func(toolSID string, tt int64) int64 {
					return subagent(sess, sctx, toolSID, tt, "general-purpose", "claude-haiku-5", 2, aid, false)
				},
			})
		} else {
			names := []string{"Grep", "Read", "Glob"}
			t, _, _ = sess.tool(sctx, t, names[sess.rng.Intn(3)], toolOpt{execMS: 20 + sess.rng.Intn(381), agent: aid, parentAgent: parentAgent})
		}
		tools++
	}
	eff := any("medium")
	if model == "claude-haiku-5" {
		eff = nil
	}
	t, _, _ = sess.llm(sctx, t, llmOpt{model: model, effort: eff, agent: aid, parentAgent: parentAgent,
		querySourceSafe: qss, querySource: agentType, attribution: attr, stop: "end_turn"})
	sess.event("subagent_completed", t, map[string]any{
		"agent_type": agentType, "agent.source": map[bool]string{true: "built-in", false: "userSettings"}[agentType != "code-reviewer"],
		"is_built_in": agentType != "code-reviewer", "is_async": false, "total_tokens": 30000 + sess.rng.Intn(60001),
		"total_tool_uses": tools, "duration_ms": (t - t0) / 1_000_000, "model": model, "final_model": model, "model_swapped": false,
	}, ctx[0], ctx[3], ctx[2])
	return t
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b [8]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}

func max64(xs []int64) int64 {
	var m int64
	for _, x := range xs {
		if x > m {
			m = x
		}
	}
	return m
}
