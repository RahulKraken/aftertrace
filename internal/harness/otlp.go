package harness

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"math/rand/v2"
	"time"

	collogspb "go.opentelemetry.io/proto/otlp/collector/logs/v1"
	coltracepb "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	commonpb "go.opentelemetry.io/proto/otlp/common/v1"
	logspb "go.opentelemetry.io/proto/otlp/logs/v1"
	resourcepb "go.opentelemetry.io/proto/otlp/resource/v1"
	tracepb "go.opentelemetry.io/proto/otlp/trace/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

type Batch struct {
	ID      int
	Trace   *coltracepb.ExportTraceServiceRequest
	Logs    *collogspb.ExportLogsServiceRequest
	TraceID string
	SpanID  string
}

func makeBatch(i int, now uint64) Batch {
	tid := bytesN(16, byte(i+1), byte(i>>8), byte(i>>16))
	root := bytesN(8, 1, byte(i), 0)
	llm := bytesN(8, 2, byte(i), 0)
	sid := fmt.Sprintf("otlp-sess-%d", i)
	rid := fmt.Sprintf("otlp-req-%d", i)
	res := &resourcepb.Resource{Attributes: []*commonpb.KeyValue{
		kv("service.name", "claude-code"),
		kv("aftertrace.synthetic", "true"),
	}}
	tr := &coltracepb.ExportTraceServiceRequest{ResourceSpans: []*tracepb.ResourceSpans{{
		Resource: res,
		ScopeSpans: []*tracepb.ScopeSpans{{Spans: []*tracepb.Span{
			{
				TraceId: tid, SpanId: root, Name: "claude_code.interaction",
				StartTimeUnixNano: now, EndTimeUnixNano: now + 1e9,
				Attributes: []*commonpb.KeyValue{kv("session.id", sid)},
			},
			{
				TraceId: tid, SpanId: llm, ParentSpanId: root, Name: "claude_code.llm_request",
				StartTimeUnixNano: now, EndTimeUnixNano: now + 5e8,
				Attributes: []*commonpb.KeyValue{
					kv("session.id", sid),
					kv("model", "claude-opus-4-5"),
					kv("request_id", rid),
					kvNum("input_tokens", 10),
				},
			},
		}}},
	}}}
	lg := &collogspb.ExportLogsServiceRequest{ResourceLogs: []*logspb.ResourceLogs{{
		Resource: res,
		ScopeLogs: []*logspb.ScopeLogs{{LogRecords: []*logspb.LogRecord{{
			TimeUnixNano: now,
			Body:         &commonpb.AnyValue{Value: &commonpb.AnyValue_StringValue{StringValue: "api_request"}},
			Attributes: []*commonpb.KeyValue{
				kv("event.name", "api_request"),
				kv("session.id", sid),
				kv("request_id", rid),
				kvNum("cost_usd", 0.01),
			},
		}}}},
	}}}
	return Batch{ID: i, Trace: tr, Logs: lg, TraceID: fmt.Sprintf("%x", tid), SpanID: fmt.Sprintf("%x", llm)}
}

func bytesN(n int, fill ...byte) []byte {
	b := make([]byte, n)
	for i := range b {
		if i < len(fill) {
			b[i] = fill[i]
		} else {
			b[i] = byte(n + i)
		}
	}
	return b
}

func kv(k, v string) *commonpb.KeyValue {
	return &commonpb.KeyValue{Key: k, Value: &commonpb.AnyValue{Value: &commonpb.AnyValue_StringValue{StringValue: v}}}
}

func kvNum(k string, v float64) *commonpb.KeyValue {
	return &commonpb.KeyValue{Key: k, Value: &commonpb.AnyValue{Value: &commonpb.AnyValue_DoubleValue{DoubleValue: v}}}
}

type OTLPResult struct {
	OK, Status503, Status400, StatusOther, Unavailable, OtherGRPC, Failed int
	LastStatus                                                            int
	LastBody                                                              string
	LastGRPC                                                              string
}

func postOTLP(url string, msg proto.Message) (int, []byte, error) {
	body, err := protojson.Marshal(msg)
	if err != nil {
		return 0, nil, err
	}
	res, err := harnessHTTP.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		return 0, nil, err
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return res.StatusCode, b, nil
}

func sendHTTP(p *Proc, b Batch) OTLPResult {
	var r OTLPResult
	st, body, err := postOTLP("http://"+p.HTTPOTLP+"/v1/traces", b.Trace)
	r.LastStatus = st
	r.LastBody = trim(body, 200)
	if err != nil {
		r.Failed++
		return r
	}
	noteHTTP(&r, st, body)
	st, body, err = postOTLP("http://"+p.HTTPOTLP+"/v1/logs", b.Logs)
	r.LastStatus = st
	r.LastBody = trim(body, 200)
	if err != nil {
		r.Failed++
		return r
	}
	noteHTTP(&r, st, body)
	return r
}

func noteHTTP(r *OTLPResult, st int, body []byte) {
	switch {
	case st == 200:
		r.OK++
	case st == 503:
		r.Status503++
	case st == 400:
		r.Status400++
	default:
		r.StatusOther++
	}
	_ = body
}

func sendGRPC(p *Proc, b Batch) OTLPResult {
	var r OTLPResult
	conn, err := grpc.NewClient(p.GRPC, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		r.Failed++
		r.LastGRPC = err.Error()
		return r
	}
	defer conn.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_, err = coltracepb.NewTraceServiceClient(conn).Export(ctx, b.Trace)
	if err != nil {
		r.LastGRPC = err.Error()
		if status.Code(err) == codes.Unavailable {
			r.Unavailable++
		} else {
			r.OtherGRPC++
		}
		return r
	}
	r.OK++
	return r
}

func replayShuffled(p *Proc, n int, copies int, seed int64, rate int) OTLPResult {
	now := uint64(time.Now().UnixNano())
	var seq []Batch
	for i := 0; i < n; i++ {
		b := makeBatch(i, now+uint64(i)*1e6)
		for c := 0; c < copies; c++ {
			seq = append(seq, b)
		}
	}
	rng := rand.New(rand.NewPCG(uint64(seed), 2))
	rng.Shuffle(len(seq), func(i, j int) { seq[i], seq[j] = seq[j], seq[i] })
	var acc OTLPResult
	interval := time.Second / time.Duration(rate)
	if rate <= 0 {
		interval = time.Millisecond
	}
	t := time.NewTicker(interval)
	defer t.Stop()
	for i, b := range seq {
		if i > 0 {
			<-t.C
		}
		r := sendHTTP(p, b)
		acc.OK += r.OK
		acc.Status503 += r.Status503
		acc.Status400 += r.Status400
		acc.StatusOther += r.StatusOther
		acc.Failed += r.Failed
		acc.LastStatus = r.LastStatus
		acc.LastBody = r.LastBody
	}
	return acc
}
