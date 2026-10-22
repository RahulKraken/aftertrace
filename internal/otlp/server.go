package otlp

import (
	"context"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/RahulKraken/aftertrace/internal/store"
	collogspb "go.opentelemetry.io/proto/otlp/collector/logs/v1"
	colmetricspb "go.opentelemetry.io/proto/otlp/collector/metrics/v1"
	coltracepb "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/proto"
)

const maxBody = 32 << 20

type Receiver struct {
	Store        *store.Store
	StoreContent bool
	GRPC         *grpc.Server
	HTTP         *http.Server
}

func NewReceiver(st *store.Store, storeContent bool) *Receiver {
	r := &Receiver{Store: st, StoreContent: storeContent}
	gs := grpc.NewServer(grpc.MaxRecvMsgSize(maxBody))
	coltracepb.RegisterTraceServiceServer(gs, &traceSrv{r: r})
	collogspb.RegisterLogsServiceServer(gs, &logsSrv{r: r})
	colmetricspb.RegisterMetricsServiceServer(gs, &metricsSrv{r: r})
	r.GRPC = gs

	mux := http.NewServeMux()
	mux.HandleFunc("/v1/traces", r.handleHTTP(r.acceptTraces))
	mux.HandleFunc("/v1/logs", r.handleHTTP(r.acceptLogs))
	mux.HandleFunc("/v1/metrics", r.handleHTTP(r.acceptMetrics))
	r.HTTP = &http.Server{Handler: mux, ReadHeaderTimeout: 10 * time.Second}
	return r
}

func (r *Receiver) Listen(host string, grpcPort, httpPort int) (grpcLn, httpLn net.Listener, err error) {
	grpcLn, err = net.Listen("tcp", fmt.Sprintf("%s:%d", host, grpcPort))
	if err != nil {
		return nil, nil, fmt.Errorf("otlp grpc: %w", err)
	}
	httpLn, err = net.Listen("tcp", fmt.Sprintf("%s:%d", host, httpPort))
	if err != nil {
		grpcLn.Close()
		return nil, nil, fmt.Errorf("otlp http: %w", err)
	}
	return grpcLn, httpLn, nil
}

func (r *Receiver) Serve(grpcLn, httpLn net.Listener) {
	go func() {
		if err := r.GRPC.Serve(grpcLn); err != nil {
			log.Printf("otlp grpc: %v", err)
		}
	}()
	go func() {
		if err := r.HTTP.Serve(httpLn); err != nil && err != http.ErrServerClosed {
			log.Printf("otlp http: %v", err)
		}
	}()
}

func (r *Receiver) Shutdown(ctx context.Context) {
	r.GRPC.GracefulStop()
	_ = r.HTTP.Shutdown(ctx)
}

type traceSrv struct {
	coltracepb.UnimplementedTraceServiceServer
	r *Receiver
}

func (s *traceSrv) Export(_ context.Context, req *coltracepb.ExportTraceServiceRequest) (*coltracepb.ExportTraceServiceResponse, error) {
	sp, se := ConvertTraces(req, s.r.StoreContent)
	if err := s.r.Store.Insert(sp, se, nil, nil); err != nil {
		return nil, err
	}
	return &coltracepb.ExportTraceServiceResponse{}, nil
}

type logsSrv struct {
	collogspb.UnimplementedLogsServiceServer
	r *Receiver
}

func (s *logsSrv) Export(_ context.Context, req *collogspb.ExportLogsServiceRequest) (*collogspb.ExportLogsServiceResponse, error) {
	if err := s.r.Store.Insert(nil, nil, ConvertLogs(req, s.r.StoreContent), nil); err != nil {
		return nil, err
	}
	return &collogspb.ExportLogsServiceResponse{}, nil
}

type metricsSrv struct {
	colmetricspb.UnimplementedMetricsServiceServer
	r *Receiver
}

func (s *metricsSrv) Export(_ context.Context, req *colmetricspb.ExportMetricsServiceRequest) (*colmetricspb.ExportMetricsServiceResponse, error) {
	if err := s.r.Store.Insert(nil, nil, nil, ConvertMetrics(req, s.r.StoreContent)); err != nil {
		return nil, err
	}
	return &colmetricspb.ExportMetricsServiceResponse{}, nil
}

func (r *Receiver) handleHTTP(fn func([]byte, bool) error) http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) {
		if req.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		req.Body = http.MaxBytesReader(w, req.Body, maxBody)
		body, err := io.ReadAll(req.Body)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		ct := req.Header.Get("Content-Type")
		isJSON := strings.Contains(ct, "json")
		if ct == "" {
			isJSON = len(body) > 0 && body[0] == '{'
		}
		if err := fn(body, isJSON); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		w.WriteHeader(http.StatusOK)
	}
}

func (r *Receiver) acceptTraces(body []byte, isJSON bool) error {
	var req coltracepb.ExportTraceServiceRequest
	if err := unmarshalOTLP(body, isJSON, &req); err != nil {
		return err
	}
	sp, se := ConvertTraces(&req, r.StoreContent)
	return r.Store.Insert(sp, se, nil, nil)
}

func (r *Receiver) acceptLogs(body []byte, isJSON bool) error {
	var req collogspb.ExportLogsServiceRequest
	if err := unmarshalOTLP(body, isJSON, &req); err != nil {
		return err
	}
	return r.Store.Insert(nil, nil, ConvertLogs(&req, r.StoreContent), nil)
}

func (r *Receiver) acceptMetrics(body []byte, isJSON bool) error {
	var req colmetricspb.ExportMetricsServiceRequest
	if err := unmarshalOTLP(body, isJSON, &req); err != nil {
		return err
	}
	return r.Store.Insert(nil, nil, nil, ConvertMetrics(&req, r.StoreContent))
}

func unmarshalOTLP(body []byte, isJSON bool, msg proto.Message) error {
	if isJSON {
		return unmarshalOTLPJSON(body, msg)
	}
	return proto.Unmarshal(body, msg)
}
