package otlp

import (
	"encoding/hex"
	"strconv"
	"strings"

	commonpb "go.opentelemetry.io/proto/otlp/common/v1"
	resourcepb "go.opentelemetry.io/proto/otlp/resource/v1"
)

func kvs(list []*commonpb.KeyValue) map[string]any {
	out := make(map[string]any, len(list))
	for _, kv := range list {
		if kv == nil {
			continue
		}
		out[kv.Key] = anyVal(kv.Value)
	}
	return out
}

func resourceAttrs(r *resourcepb.Resource) map[string]any {
	if r == nil {
		return map[string]any{}
	}
	return kvs(r.Attributes)
}

func anyVal(v *commonpb.AnyValue) any {
	if v == nil {
		return nil
	}
	switch x := v.Value.(type) {
	case *commonpb.AnyValue_StringValue:
		return x.StringValue
	case *commonpb.AnyValue_IntValue:
		return x.IntValue
	case *commonpb.AnyValue_DoubleValue:
		return x.DoubleValue
	case *commonpb.AnyValue_BoolValue:
		return x.BoolValue
	case *commonpb.AnyValue_BytesValue:
		return hex.EncodeToString(x.BytesValue)
	case *commonpb.AnyValue_ArrayValue:
		if x.ArrayValue == nil {
			return []any{}
		}
		s := make([]any, 0, len(x.ArrayValue.Values))
		for _, e := range x.ArrayValue.Values {
			s = append(s, anyVal(e))
		}
		return s
	case *commonpb.AnyValue_KvlistValue:
		if x.KvlistValue == nil {
			return map[string]any{}
		}
		return kvs(x.KvlistValue.Values)
	default:
		return nil
	}
}

func hexID(b []byte) string {
	if len(b) == 0 {
		return ""
	}
	return hex.EncodeToString(b)
}

func strAttr(m map[string]any, k string) string {
	if m == nil {
		return ""
	}
	return asString(m[k])
}

func asString(v any) string {
	switch t := v.(type) {
	case nil:
		return ""
	case string:
		return t
	case float64:
		if t == float64(int64(t)) {
			return strconv.FormatInt(int64(t), 10)
		}
		return strconv.FormatFloat(t, 'f', -1, 64)
	case int64:
		return strconv.FormatInt(t, 10)
	case int:
		return strconv.Itoa(t)
	case bool:
		if t {
			return "true"
		}
		return "false"
	default:
		return ""
	}
}

func eventName(attrName, body string) string {
	n := attrName
	if n == "" {
		n = body
	}
	return strings.TrimPrefix(n, "claude_code.")
}

func sessionID(attrs, res map[string]any) string {
	if s := strAttr(attrs, "session.id"); s != "" {
		return s
	}
	return strAttr(res, "session.id")
}
