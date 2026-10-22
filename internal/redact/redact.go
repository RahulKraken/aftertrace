// Package redact drops content and account attributes at ingest.
package redact

import "strings"

// ContentKeys are attribute names that hold prompt, response or tool
// content. Dropped unless the user sets store_content.
var ContentKeys = []string{
	// Claude Code (and the Agent SDK). tool.output span events carry "output".
	"user_prompt", "prompt", "prompt_text", "response",
	"tool_input", "tool.output", "output", "new_context", "body",
	// OpenTelemetry GenAI conventions, current and deprecated.
	"gen_ai.input.messages", "gen_ai.output.messages", "gen_ai.system_instructions",
	"gen_ai.tool.definitions", "gen_ai.tool.call.arguments", "gen_ai.tool.call.result",
	"gen_ai.retrieval.query.text", "gen_ai.retrieval.documents",
	"gen_ai.prompt", "gen_ai.completion", "gen_ai.request.stop_sequences",
	// Claude SDK and API spans.
	"anthropic.tool_result.content",
	// OpenLLMetry, OpenInference, Vercel AI SDK, Pydantic AI.
	"traceloop.entity.input", "traceloop.entity.output",
	"input.value", "output.value", "llm.prompts", "llm.tools",
	"tool_call.function.arguments", "tool.parameters",
	"ai.prompt", "ai.prompt.messages", "ai.response.text", "ai.response.toolCalls",
	"ai.response.reasoning", "ai.toolCall.args", "ai.toolCall.result",
	"pydantic_ai.all_messages",
	// Gemini CLI.
	"request_text", "response_text", "function_args",
}

// ContentPrefixes cover indexed content keys such as gen_ai.prompt.0.content
// (OpenLLMetry) and llm.input_messages.0.message.content (OpenInference).
var ContentPrefixes = []string{
	"gen_ai.prompt.", "gen_ai.completion.",
	"llm.input_messages.", "llm.output_messages.",
}

// IdentityKeys are account identifiers dropped by default.
var IdentityKeys = []string{
	"user.email", "user.account_uuid", "user.account_id",
	"user.id", "organization.id", "process.owner",
}

// Attrs removes content and identity keys from a flat attribute map.
// storeContent keeps content keys but still drops identity.
func Attrs(m map[string]any, storeContent bool) {
	if m == nil {
		return
	}
	if !storeContent {
		for _, k := range ContentKeys {
			delete(m, k)
		}
		for k := range m {
			for _, p := range ContentPrefixes {
				if strings.HasPrefix(k, p) {
					delete(m, k)
					break
				}
			}
		}
	}
	for _, k := range IdentityKeys {
		delete(m, k)
	}
}
