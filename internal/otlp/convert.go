package otlp

import (
	"github.com/RahulKraken/aftertrace/internal/redact"
	"github.com/RahulKraken/aftertrace/internal/store"
	collogspb "go.opentelemetry.io/proto/otlp/collector/logs/v1"
	colmetricspb "go.opentelemetry.io/proto/otlp/collector/metrics/v1"
	coltracepb "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	metricspb "go.opentelemetry.io/proto/otlp/metrics/v1"
	tracepb "go.opentelemetry.io/proto/otlp/trace/v1"
)

func ConvertTraces(req *coltracepb.ExportTraceServiceRequest, storeContent bool) ([]store.Span, []store.SpanEvent) {
	if req == nil {
		return nil, nil
	}
	var spans []store.Span
	var sevs []store.SpanEvent
	for _, rs := range req.ResourceSpans {
		res := resourceAttrs(rs.GetResource())
		redact.Attrs(res, storeContent)
		for _, ss := range rs.ScopeSpans {
			for _, sp := range ss.Spans {
				if sp == nil {
					continue
				}
				at := kvs(sp.Attributes)
				redact.Attrs(at, storeContent)
				start, end := int64(sp.StartTimeUnixNano), int64(sp.EndTimeUnixNano)
				st := sp.GetStatus()
				isErr := st != nil && st.Code == tracepb.Status_STATUS_CODE_ERROR
				msg := ""
				if st != nil {
					msg = st.Message
				}
				parent := hexID(sp.ParentSpanId)
				spans = append(spans, store.Span{
					TraceID:       hexID(sp.TraceId),
					SpanID:        hexID(sp.SpanId),
					ParentSpanID:  parent,
					Name:          sp.Name,
					StartNS:       start,
					EndNS:         end,
					DurationMS:    float64(end-start) / 1e6,
					IsError:       isErr,
					StatusMessage: msg,
					SessionID:     sessionID(at, res),
					Attrs:         at,
					Resource:      res,
				})
				for _, e := range sp.Events {
					ea := kvs(e.Attributes)
					redact.Attrs(ea, storeContent)
					sevs = append(sevs, store.SpanEvent{
						TraceID: hexID(sp.TraceId),
						SpanID:  hexID(sp.SpanId),
						Name:    e.Name,
						TimeNS:  int64(e.TimeUnixNano),
						Attrs:   ea,
					})
				}
			}
		}
	}
	return spans, sevs
}

func ConvertLogs(req *collogspb.ExportLogsServiceRequest, storeContent bool) []store.Event {
	if req == nil {
		return nil
	}
	var evs []store.Event
	for _, rl := range req.ResourceLogs {
		res := resourceAttrs(rl.GetResource())
		redact.Attrs(res, storeContent)
		for _, sl := range rl.ScopeLogs {
			for _, r := range sl.LogRecords {
				if r == nil {
					continue
				}
				at := kvs(r.Attributes)
				redact.Attrs(at, storeContent)
				body := asString(anyVal(r.Body))
				name := eventName(strAttr(at, "event.name"), body)
				ts := int64(r.TimeUnixNano)
				if ts == 0 {
					ts = int64(r.ObservedTimeUnixNano)
				}
				evs = append(evs, store.Event{
					TsNS:      ts,
					Name:      name,
					SessionID: sessionID(at, res),
					PromptID:  strAttr(at, "prompt.id"),
					TraceID:   hexID(r.TraceId),
					SpanID:    hexID(r.SpanId),
					RequestID: strAttr(at, "request_id"),
					ToolUseID: strAttr(at, "tool_use_id"),
					Attrs:     at,
					Resource:  res,
				})
			}
		}
	}
	return evs
}

func ConvertMetrics(req *colmetricspb.ExportMetricsServiceRequest, storeContent bool) []store.MetricPoint {
	if req == nil {
		return nil
	}
	var pts []store.MetricPoint
	for _, rm := range req.ResourceMetrics {
		res := resourceAttrs(rm.GetResource())
		redact.Attrs(res, storeContent)
		for _, sm := range rm.ScopeMetrics {
			for _, m := range sm.Metrics {
				if m == nil {
					continue
				}
				for _, dp := range metricPoints(m) {
					at := kvs(dp.Attributes)
					redact.Attrs(at, storeContent)
					pts = append(pts, store.MetricPoint{
						Name:      m.Name,
						Unit:      m.Unit,
						TsNS:      int64(dp.TimeUnixNano),
						Value:     dpValue(dp),
						SessionID: sessionID(at, res),
						Attrs:     at,
						Resource:  res,
					})
				}
			}
		}
	}
	return pts
}

func metricPoints(m *metricspb.Metric) []*metricspb.NumberDataPoint {
	switch d := m.Data.(type) {
	case *metricspb.Metric_Sum:
		if d.Sum == nil {
			return nil
		}
		return d.Sum.DataPoints
	case *metricspb.Metric_Gauge:
		if d.Gauge == nil {
			return nil
		}
		return d.Gauge.DataPoints
	default:
		return nil
	}
}

func dpValue(dp *metricspb.NumberDataPoint) float64 {
	if dp == nil {
		return 0
	}
	switch v := dp.Value.(type) {
	case *metricspb.NumberDataPoint_AsDouble:
		return v.AsDouble
	case *metricspb.NumberDataPoint_AsInt:
		return float64(v.AsInt)
	default:
		return 0
	}
}

func ConvertAndStore(st *store.Store, traces *coltracepb.ExportTraceServiceRequest, logs *collogspb.ExportLogsServiceRequest, metrics *colmetricspb.ExportMetricsServiceRequest, storeContent bool) error {
	sp, se := ConvertTraces(traces, storeContent)
	ev := ConvertLogs(logs, storeContent)
	pt := ConvertMetrics(metrics, storeContent)
	if len(sp)+len(se)+len(ev)+len(pt) == 0 {
		return nil
	}
	return st.Insert(sp, se, ev, pt)
}
