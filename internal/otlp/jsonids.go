package otlp

import (
	"encoding/base64"
	"encoding/hex"
	"encoding/json"

	"google.golang.org/protobuf/proto"
)

// OTLP/JSON encodes trace and span ids as hex strings, but protojson decodes
// bytes fields as base64. Convert hex ids to base64 before decoding so ids
// match what the exporter sent. Values that are not 32 or 16 hex characters
// (already base64, or empty) are left alone.
var idKeys = map[string]bool{
	"traceId": true, "spanId": true, "parentSpanId": true,
	"trace_id": true, "span_id": true, "parent_span_id": true,
}

func unmarshalOTLPJSON(b []byte, msg proto.Message) error {
	var v any
	if err := json.Unmarshal(b, &v); err != nil {
		return err
	}
	if fixIDs(v) {
		fixed, err := json.Marshal(v)
		if err != nil {
			return err
		}
		b = fixed
	}
	return protoJSON.Unmarshal(b, msg)
}

func fixIDs(v any) bool {
	changed := false
	switch t := v.(type) {
	case map[string]any:
		for k, x := range t {
			if s, ok := x.(string); ok && idKeys[k] && (len(s) == 32 || len(s) == 16) {
				if raw, err := hex.DecodeString(s); err == nil {
					t[k] = base64.StdEncoding.EncodeToString(raw)
					changed = true
				}
				continue
			}
			if fixIDs(x) {
				changed = true
			}
		}
	case []any:
		for _, x := range t {
			if fixIDs(x) {
				changed = true
			}
		}
	}
	return changed
}
