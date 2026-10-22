package redact

import "testing"

func TestAttrsDropsContentFromEveryConvention(t *testing.T) {
	m := map[string]any{
		"output":                                "$ npm test\nok",
		"gen_ai.input.messages":                 "[...]",
		"gen_ai.prompt.0.content":               "hi",
		"llm.output_messages.0.message.content": "hello",
		"ai.response.text":                      "hello",
		"response_text":                         "hello",
		"response.model_output":                 "hello",
		"gen_ai.usage.input_tokens":             int64(12),
		"gen_ai.request.model":                  "claude-opus-5-5",
		"user.email":                            "you@example.com",
	}
	Attrs(m, false)
	for _, k := range []string{"output", "gen_ai.input.messages", "gen_ai.prompt.0.content", "llm.output_messages.0.message.content", "ai.response.text", "response_text", "response.model_output", "user.email"} {
		if _, ok := m[k]; ok {
			t.Errorf("%s kept", k)
		}
	}
	for _, k := range []string{"gen_ai.usage.input_tokens", "gen_ai.request.model"} {
		if _, ok := m[k]; !ok {
			t.Errorf("%s dropped; it is metadata", k)
		}
	}

	keep := map[string]any{"output": "x", "gen_ai.prompt.0.content": "hi", "user.email": "you@example.com"}
	Attrs(keep, true)
	if keep["output"] != "x" || keep["gen_ai.prompt.0.content"] != "hi" {
		t.Error("store_content should keep content")
	}
	if _, ok := keep["user.email"]; ok {
		t.Error("identity kept with store_content")
	}
}
