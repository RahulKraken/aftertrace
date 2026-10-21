package otlp

import (
	"bytes"
	"context"
	"fmt"
	"net"
	"net/http"
	"path/filepath"
	"testing"
	"time"

	"github.com/RahulKraken/aftertrace/internal/store"
	coltracepb "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	commonpb "go.opentelemetry.io/proto/otlp/common/v1"
	resourcepb "go.opentelemetry.io/proto/otlp/resource/v1"
	tracepb "go.opentelemetry.io/proto/otlp/trace/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

func testReq() *coltracepb.ExportTraceServiceRequest {
	return &coltracepb.ExportTraceServiceRequest{ResourceSpans: []*tracepb.ResourceSpans{{
		Resource: &resourcepb.Resource{Attributes: []*commonpb.KeyValue{
			{Key: "aftertrace.synthetic", Value: &commonpb.AnyValue{Value: &commonpb.AnyValue_StringValue{StringValue: "true"}}},
			{Key: "user.email", Value: &commonpb.AnyValue{Value: &commonpb.AnyValue_StringValue{StringValue: "nope@example.com"}}},
		}},
		ScopeSpans: []*tracepb.ScopeSpans{{Spans: []*tracepb.Span{{
			TraceId: bytesN(16, 9), SpanId: bytesN(8, 8), Name: "claude_code.interaction",
			StartTimeUnixNano: 10, EndTimeUnixNano: 20,
			Attributes: []*commonpb.KeyValue{
				{Key: "session.id", Value: &commonpb.AnyValue{Value: &commonpb.AnyValue_StringValue{StringValue: "otlp-test"}}},
				{Key: "user_prompt", Value: &commonpb.AnyValue{Value: &commonpb.AnyValue_StringValue{StringValue: "secret"}}},
			},
		}}}},
	}}}
}

func bytesN(n, fill int) []byte {
	b := make([]byte, n)
	for i := range b {
		b[i] = byte(fill)
	}
	return b
}

func TestHTTPandGRPCIngest(t *testing.T) {
	st, err := store.Open(filepath.Join(t.TempDir(), "o.duckdb"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	recv := NewReceiver(st, false)
	grpcLn, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	httpLn, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	recv.Serve(grpcLn, httpLn)
	t.Cleanup(func() { recv.Shutdown(context.Background()) })

	body, err := protojson.Marshal(testReq())
	if err != nil {
		t.Fatal(err)
	}
	res, err := http.Post("http://"+httpLn.Addr().String()+"/v1/traces", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("http json %d", res.StatusCode)
	}

	pb, err := proto.Marshal(testReq())
	if err != nil {
		t.Fatal(err)
	}
	res, err = http.Post("http://"+httpLn.Addr().String()+"/v1/traces", "application/x-protobuf", bytes.NewReader(pb))
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("http proto %d", res.StatusCode)
	}

	conn, err := grpc.NewClient(grpcLn.Addr().String(), grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_, err = coltracepb.NewTraceServiceClient(conn).Export(ctx, testReq())
	if err != nil {
		t.Fatal(err)
	}

	var n int
	var attrs, resource string
	if err := st.DB.QueryRow(`SELECT count(*), any_value(attrs::VARCHAR), any_value(resource::VARCHAR) FROM spans WHERE session_id='otlp-test'`).
		Scan(&n, &attrs, &resource); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("spans=%d (dedupe should keep one)", n)
	}
	if bytes.Contains([]byte(attrs), []byte("secret")) {
		t.Fatal("prompt stored")
	}
	if bytes.Contains([]byte(resource), []byte("nope@")) {
		t.Fatal("email stored")
	}
	fmt.Println("ok")
}
