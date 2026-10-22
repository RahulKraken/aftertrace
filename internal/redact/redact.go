// Package redact drops content and account attributes at ingest.
package redact

// ContentKeys are attribute names the docs use for prompt, response or tool
// content. Dropped unless the user sets store_content.
var ContentKeys = []string{
	"user_prompt", "prompt", "prompt_text", "response",
	"tool_input", "tool.output", "new_context", "body",
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
	}
	for _, k := range IdentityKeys {
		delete(m, k)
	}
}
