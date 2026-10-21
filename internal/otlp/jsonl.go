package otlp

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/RahulKraken/aftertrace/internal/store"
	collogspb "go.opentelemetry.io/proto/otlp/collector/logs/v1"
	colmetricspb "go.opentelemetry.io/proto/otlp/collector/metrics/v1"
	coltracepb "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	"google.golang.org/protobuf/encoding/protojson"
)

var protoJSON = protojson.UnmarshalOptions{DiscardUnknown: true}

func ImportDir(st *store.Store, dir string, storeContent bool) (store.Counts, error) {
	fi, err := os.Stat(dir)
	if err != nil {
		return store.Counts{}, err
	}
	if !fi.IsDir() {
		return store.Counts{}, fmt.Errorf("%s: not a directory", dir)
	}
	before, _ := st.Counts()
	if err := importJSONL(filepath.Join(dir, "traces.jsonl"), func(b []byte) error {
		var req coltracepb.ExportTraceServiceRequest
		if err := protoJSON.Unmarshal(b, &req); err != nil {
			return err
		}
		sp, se := ConvertTraces(&req, storeContent)
		return st.Insert(sp, se, nil, nil)
	}); err != nil {
		return store.Counts{}, err
	}
	if err := importJSONL(filepath.Join(dir, "logs.jsonl"), func(b []byte) error {
		var req collogspb.ExportLogsServiceRequest
		if err := protoJSON.Unmarshal(b, &req); err != nil {
			return err
		}
		return st.Insert(nil, nil, ConvertLogs(&req, storeContent), nil)
	}); err != nil {
		return store.Counts{}, err
	}
	if err := importJSONL(filepath.Join(dir, "metrics.jsonl"), func(b []byte) error {
		var req colmetricspb.ExportMetricsServiceRequest
		if err := protoJSON.Unmarshal(b, &req); err != nil {
			return err
		}
		return st.Insert(nil, nil, nil, ConvertMetrics(&req, storeContent))
	}); err != nil {
		return store.Counts{}, err
	}
	after, err := st.Counts()
	if err != nil {
		return after, err
	}
	return store.Counts{
		Spans:        after.Spans - before.Spans,
		SpanEvents:   after.SpanEvents - before.SpanEvents,
		Events:       after.Events - before.Events,
		MetricPoints: after.MetricPoints - before.MetricPoints,
	}, nil
}

func importJSONL(path string, fn func([]byte) error) error {
	f, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64*1024), 32<<20)
	n := 0
	for sc.Scan() {
		line := sc.Bytes()
		if len(line) == 0 {
			continue
		}
		n++
		if !json.Valid(line) {
			return fmt.Errorf("%s:%d: invalid JSON", path, n)
		}
		if err := fn(line); err != nil {
			return fmt.Errorf("%s:%d: %w", path, n, err)
		}
	}
	return sc.Err()
}

func UnmarshalTracesJSON(b []byte) (*coltracepb.ExportTraceServiceRequest, error) {
	var req coltracepb.ExportTraceServiceRequest
	if err := protoJSON.Unmarshal(b, &req); err != nil {
		return nil, err
	}
	return &req, nil
}

func UnmarshalLogsJSON(b []byte) (*collogspb.ExportLogsServiceRequest, error) {
	var req collogspb.ExportLogsServiceRequest
	if err := protoJSON.Unmarshal(b, &req); err != nil {
		return nil, err
	}
	return &req, nil
}

func UnmarshalMetricsJSON(b []byte) (*colmetricspb.ExportMetricsServiceRequest, error) {
	var req colmetricspb.ExportMetricsServiceRequest
	if err := protoJSON.Unmarshal(b, &req); err != nil {
		return nil, err
	}
	return &req, nil
}
