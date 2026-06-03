package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	stdlog "log"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	otellog "go.opentelemetry.io/otel/log"
	sdklog "go.opentelemetry.io/otel/sdk/log"
	"go.opentelemetry.io/otel/trace"
	"google.golang.org/grpc/metadata"
)

const (
	connectionLifecycleDebugIndex = "connection_lifecycle"
	connectionLifecycleProvider   = "whatsmeow"
	connectionLifecycleWorkerType = "whatsmeow"
	connectionLifecycleIDHeader   = "x-connection-lifecycle-id"
)

type connectionLifecycleContextKey struct{}

type connectionLifecycleContext struct {
	ConnectionLifecycleID string
	AccountID             string
	WorkerID              string
	ChannelID             string
	WorkerType            string
	SourceProvider        string
	ConnectionType        string
	ConnectionAction      string
}

var (
	connectionLifecycleLoggerMu sync.RWMutex
	connectionLifecycleLogger   otellog.Logger
)

func configureConnectionLifecycleLoggerProvider(provider *sdklog.LoggerProvider) {
	connectionLifecycleLoggerMu.Lock()
	defer connectionLifecycleLoggerMu.Unlock()
	if provider == nil {
		connectionLifecycleLogger = nil
		return
	}
	connectionLifecycleLogger = provider.Logger("connection_lifecycle")
}

func connectionLifecycleFromRequest(cfg Config, req StatusConnectionRequest, action string) connectionLifecycleContext {
	workerID := firstNonEmpty(req.WorkerID, cfg.WorkerID)
	connectionType := strings.ToLower(firstNonEmpty(req.Type, "qrcode"))
	return connectionLifecycleContext{
		ConnectionLifecycleID: stableLifecycleID(
			cfg.AccountID,
			workerID,
			connectionType,
			firstNonEmpty(action, req.Status),
			time.Now().UTC().Format(time.RFC3339Nano),
		),
		AccountID:        cfg.AccountID,
		WorkerID:         workerID,
		ChannelID:        workerID,
		WorkerType:       connectionLifecycleWorkerType,
		SourceProvider:   connectionLifecycleProvider,
		ConnectionType:   connectionType,
		ConnectionAction: action,
	}
}

func contextWithConnectionLifecycle(ctx context.Context, lifecycle connectionLifecycleContext) context.Context {
	return context.WithValue(ctx, connectionLifecycleContextKey{}, lifecycle)
}

func connectionLifecycleFromContext(ctx context.Context) (connectionLifecycleContext, bool) {
	lifecycle, ok := ctx.Value(connectionLifecycleContextKey{}).(connectionLifecycleContext)
	return lifecycle, ok
}

func extractIncomingConnectionLifecycleContext(ctx context.Context, cfg Config, req StatusConnectionRequest, action string) context.Context {
	ctx = extractIncomingTraceContext(ctx)
	lifecycle := connectionLifecycleFromRequest(cfg, req, action)
	if id := incomingConnectionLifecycleID(ctx); id != "" {
		lifecycle.ConnectionLifecycleID = id
	}
	return contextWithConnectionLifecycle(ctx, lifecycle)
}

func startConnectionLifecycleSpan(ctx context.Context, cfg Config, lifecycle connectionLifecycleContext) (context.Context, func(error)) {
	ctx = contextWithConnectionLifecycle(ctx, lifecycle)
	tracer := otel.Tracer("connection-lifecycle")
	ctx, span := tracer.Start(
		ctx,
		"connection_lifecycle.operation",
		trace.WithAttributes(
			attribute.String("connection_lifecycle_id", lifecycle.ConnectionLifecycleID),
			attribute.String("account_id", lifecycle.AccountID),
			attribute.String("worker_id", lifecycle.WorkerID),
			attribute.String("channel_id", lifecycle.ChannelID),
			attribute.String("worker_type", lifecycle.WorkerType),
			attribute.String("source_provider", lifecycle.SourceProvider),
			attribute.String("connection_type", lifecycle.ConnectionType),
			attribute.String("connection_action", lifecycle.ConnectionAction),
		),
	)
	return ctx, func(err error) {
		if err != nil {
			span.RecordError(err)
			span.SetStatus(codes.Error, err.Error())
		}
		span.End()
	}
}

func recordConnectionLifecycle(ctx context.Context, cfg Config, event map[string]any) {
	if !cfg.ConnectionLifecycleDebugEnabled || !shouldRecordConnectionLifecycleEvent(event) {
		return
	}

	payload := normalizeConnectionLifecyclePayload(ctx, cfg, event)
	recordConnectionLifecycleExceptionSpan(ctx, payload, event)
	connectionLifecycleLoggerMu.RLock()
	logger := connectionLifecycleLogger
	connectionLifecycleLoggerMu.RUnlock()

	if logger == nil {
		raw, _ := json.Marshal(payload)
		stdlog.Printf("connection_lifecycle %s", raw)
		return
	}

	record := otellog.Record{}
	now := time.Now()
	record.SetTimestamp(now)
	record.SetObservedTimestamp(now)
	record.SetSeverity(messageLifecycleSeverity(payload["level"]))
	record.SetSeverityText(strings.ToUpper(stringValue(payload["level"])))
	record.SetBody(otellog.StringValue(firstNonEmpty(stringValue(payload["message"]), "Connection lifecycle event")))
	record.AddAttributes(messageLifecycleAttributes(payload)...)
	logger.Emit(ctx, record)
}

func shouldRecordConnectionLifecycleEvent(event map[string]any) bool {
	if shouldRecordLifecycleDebugEvent(event) {
		return true
	}
	stage := lifecycleToken(event["stage"])
	return strings.HasPrefix(stage, "connection.whatsmeow.event.keepalive_") ||
		strings.HasPrefix(stage, "connection.whatsmeow.reconnect.") ||
		stage == "connection.whatsmeow.client.connect_success"
}

func normalizeConnectionLifecyclePayload(ctx context.Context, cfg Config, event map[string]any) map[string]any {
	payload := map[string]any{
		"debug_index": connectionLifecycleDebugIndex,
		"log_type":    connectionLifecycleDebugIndex,
	}
	if lifecycle, ok := connectionLifecycleFromContext(ctx); ok {
		payload["connection_lifecycle_id"] = lifecycle.ConnectionLifecycleID
		payload["account_id"] = lifecycle.AccountID
		payload["worker_id"] = lifecycle.WorkerID
		payload["channel_id"] = lifecycle.ChannelID
		payload["worker_type"] = lifecycle.WorkerType
		payload["source_provider"] = lifecycle.SourceProvider
		payload["connection_type"] = lifecycle.ConnectionType
		payload["connection_action"] = lifecycle.ConnectionAction
	} else {
		payload["connection_lifecycle_id"] = stableLifecycleID(cfg.AccountID, cfg.WorkerID, time.Now().UTC().Format(time.RFC3339Nano))
		payload["account_id"] = cfg.AccountID
		payload["worker_id"] = cfg.WorkerID
		payload["channel_id"] = cfg.WorkerID
		payload["worker_type"] = connectionLifecycleWorkerType
		payload["source_provider"] = connectionLifecycleProvider
	}

	for key, value := range event {
		if addConnectionSensitiveMetadata(payload, key, value) {
			continue
		}
		payload[key] = value
	}
	if payload["level"] == nil {
		payload["level"] = "info"
	}
	if payload["stage"] == nil {
		payload["stage"] = "whatsmeow.connection"
	}
	if file, line, fn, ok := connectionLifecycleCaller(); ok {
		payload["source_file"] = file
		payload["source_line"] = line
		payload["source_function"] = fn
	}
	if spanContext := trace.SpanContextFromContext(ctx); spanContext.IsValid() {
		payload["trace_id"] = spanContext.TraceID().String()
		payload["span_id"] = spanContext.SpanID().String()
	}
	if value, ok := event["value"]; ok {
		text, truncated := truncateLifecycleValue(value, cfg.ConnectionLifecycleDebugValueLimit)
		payload["value"] = text
		payload["value_truncated"] = truncated
	}
	if value, ok := event["raw_payload"]; ok {
		raw, truncated := truncateLifecycleValue(sanitizeConnectionLifecycleRawPayload(value), cfg.ConnectionLifecycleDebugRawLimit)
		payload["raw_payload"] = raw
		payload["raw_truncated"] = truncated
	}
	return payload
}

func recordConnectionLifecycleExceptionSpan(ctx context.Context, payload map[string]any, event map[string]any) {
	stage := firstNonEmpty(lifecycleString(payload["stage"]), "unknown")
	tracer := otel.Tracer("connection-lifecycle")
	_, span := tracer.Start(
		ctx,
		"connection_lifecycle.exception."+stage,
		trace.WithAttributes(lifecycleSpanAttributes(payload)...),
	)
	spanContext := span.SpanContext()
	if spanContext.IsValid() {
		payload["trace_id"] = spanContext.TraceID().String()
		payload["span_id"] = spanContext.SpanID().String()
	}
	if lifecycleEventIsError(event) {
		err := lifecycleErrorFromEvent(event)
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
	}
	span.End()
}

func addConnectionSensitiveMetadata(payload map[string]any, key string, value any) bool {
	switch strings.ToLower(key) {
	case "qrcode", "qr_code", "qr":
		hash, length := hashConnectionSensitiveValue(value)
		payload["has_qr"] = value != nil && stringifyLifecycleValue(value) != ""
		payload["qr_hash"] = hash
		payload["qr_length"] = length
		return true
	case "pairing_code", "pairingcode":
		hash, length := hashConnectionSensitiveValue(value)
		payload["has_pairing_code"] = value != nil && stringifyLifecycleValue(value) != ""
		payload["pairing_code_hash"] = hash
		payload["pairing_code_length"] = length
		return true
	default:
		return false
	}
}

func hashConnectionSensitiveValue(value any) (string, int) {
	normalized := stringifyLifecycleValue(value)
	sum := sha256.Sum256([]byte(normalized))
	return hex.EncodeToString(sum[:])[:16], len(normalized)
}

func sanitizeConnectionLifecycleRawPayload(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		out := make(map[string]any, len(typed))
		for key, item := range typed {
			if addConnectionSensitiveMetadata(out, key, item) {
				continue
			}
			out[key] = sanitizeConnectionLifecycleRawPayload(item)
		}
		return out
	case []any:
		out := make([]any, 0, len(typed))
		for _, item := range typed {
			out = append(out, sanitizeConnectionLifecycleRawPayload(item))
		}
		return out
	default:
		return value
	}
}

func connectionLifecycleCaller() (string, int, string, bool) {
	for skip := 2; skip < 12; skip++ {
		pc, file, line, ok := runtime.Caller(skip)
		if !ok {
			continue
		}
		if filepath.Base(file) == "connection_lifecycle_log.go" {
			continue
		}
		name := ""
		if fn := runtime.FuncForPC(pc); fn != nil {
			name = fn.Name()
		}
		return file, line, name, true
	}
	return "", 0, "", false
}

func incomingConnectionLifecycleID(ctx context.Context) string {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return ""
	}
	values := md.Get(connectionLifecycleIDHeader)
	if len(values) == 0 {
		return ""
	}
	return strings.TrimSpace(values[0])
}

func extractIncomingTraceContext(ctx context.Context) context.Context {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return ctx
	}
	carrier := propagationCarrier{}
	for key, values := range md {
		if len(values) > 0 {
			carrier.Set(key, values[0])
		}
	}
	return otel.GetTextMapPropagator().Extract(ctx, carrier)
}

func injectOutgoingConnectionLifecycleContext(ctx context.Context) context.Context {
	carrier := propagationCarrier{}
	otel.GetTextMapPropagator().Inject(ctx, carrier)
	if lifecycle, ok := connectionLifecycleFromContext(ctx); ok && lifecycle.ConnectionLifecycleID != "" {
		carrier.Set(connectionLifecycleIDHeader, lifecycle.ConnectionLifecycleID)
	}
	pairs := make([]string, 0, len(carrier)*2)
	for key, value := range carrier {
		pairs = append(pairs, key, value)
	}
	if len(pairs) == 0 {
		return ctx
	}
	return metadata.AppendToOutgoingContext(ctx, pairs...)
}

type propagationCarrier map[string]string

func (c propagationCarrier) Get(key string) string {
	return c[strings.ToLower(key)]
}

func (c propagationCarrier) Set(key, value string) {
	c[strings.ToLower(key)] = value
}

func (c propagationCarrier) Keys() []string {
	keys := make([]string, 0, len(c))
	for key := range c {
		keys = append(keys, key)
	}
	return keys
}
