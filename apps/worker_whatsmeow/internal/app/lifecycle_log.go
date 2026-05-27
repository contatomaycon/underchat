package app

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"fmt"
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
)

const (
	messageLifecycleDebugIndex = "message_lifecycle"
	messageLifecycleProvider   = "whatsmeow"
)

type messageLifecycleContextKey struct{}

type messageLifecycleContext struct {
	MessageLifecycleID string
	AccountID          string
	WorkerID           string
	ChannelID          string
	SourceProvider     string
	MessageKeyID       string
	Phone              string
	JID                string
	LID                string
	RemoteJID          string
	RemoteJIDAlt       string
}

var (
	messageLifecycleLoggerMu sync.RWMutex
	messageLifecycleLogger   otellog.Logger
)

var lifecycleExceptionOutcomes = map[string]struct{}{
	"error":                      {},
	"failed":                     {},
	"partial_error":              {},
	"timeout":                    {},
	"dlq":                        {},
	"discarded":                  {},
	"dropped":                    {},
	"skipped":                    {},
	"ignored":                    {},
	"ignore_totally":             {},
	"ignore_automation":          {},
	"retrying":                   {},
	"closed":                     {},
	"message_creation_skipped":   {},
	"chat_saved_without_message": {},
}

var lifecycleErrorOutcomes = map[string]struct{}{
	"error":         {},
	"failed":        {},
	"partial_error": {},
	"timeout":       {},
	"dlq":           {},
}

var lifecycleErrorFieldKeys = []string{
	"error",
	"err",
	"exception",
	"stack",
	"error_message",
}

var lifecycleSpanAttributeOmitKeys = map[string]struct{}{
	"message":      {},
	"message_text": {},
	"raw_payload":  {},
	"value":        {},
}

func configureMessageLifecycleLoggerProvider(provider *sdklog.LoggerProvider) {
	messageLifecycleLoggerMu.Lock()
	defer messageLifecycleLoggerMu.Unlock()
	if provider == nil {
		messageLifecycleLogger = nil
		return
	}
	messageLifecycleLogger = provider.Logger("message_lifecycle")
}

func messageLifecycleFromEvent(cfg Config, evt *eventsMessageLike) messageLifecycleContext {
	if evt == nil {
		evt = &eventsMessageLike{}
	}
	remoteJID := evt.chat
	remoteJIDAlt := evt.remoteJIDAlt
	participant := evt.sender
	participantAlt := evt.senderAlt
	jid := firstNonLID(remoteJID, remoteJIDAlt, participant, participantAlt)
	lid := firstLID(remoteJID, remoteJIDAlt, participant, participantAlt)
	return messageLifecycleContext{
		MessageLifecycleID: stableLifecycleID(
			cfg.AccountID,
			cfg.WorkerID,
			remoteJID,
			remoteJIDAlt,
			fmt.Sprintf("%t", evt.fromMe),
			evt.id,
		),
		AccountID:      cfg.AccountID,
		WorkerID:       cfg.WorkerID,
		ChannelID:      cfg.WorkerID,
		SourceProvider: messageLifecycleProvider,
		MessageKeyID:   evt.id,
		Phone:          lifecyclePhoneFromJID(firstNonEmpty(jid, remoteJID, remoteJIDAlt)),
		JID:            jid,
		LID:            lid,
		RemoteJID:      remoteJID,
		RemoteJIDAlt:   remoteJIDAlt,
	}
}

func messageLifecycleFromUpsert(cfg Config, upsert *UpsertMessage) messageLifecycleContext {
	if upsert == nil {
		return messageLifecycleContext{
			MessageLifecycleID: stableLifecycleID(cfg.AccountID, cfg.WorkerID),
			AccountID:          cfg.AccountID,
			WorkerID:           cfg.WorkerID,
			ChannelID:          cfg.WorkerID,
			SourceProvider:     messageLifecycleProvider,
		}
	}
	key := asMap(upsert.Message["key"])
	remoteJID := strings.ToLower(valueString(key, "remoteJid"))
	remoteJIDAlt := strings.ToLower(valueString(key, "remoteJidAlt"))
	participant := strings.ToLower(valueString(key, "participant"))
	participantAlt := strings.ToLower(valueString(key, "participantAlt"))
	jid := firstNonLID(remoteJID, remoteJIDAlt, participant, participantAlt)
	lid := firstLID(remoteJID, remoteJIDAlt, participant, participantAlt)
	sourceProvider := firstNonEmpty(upsert.SourceProvider, messageLifecycleProvider)
	return messageLifecycleContext{
		MessageLifecycleID: stableLifecycleID(
			firstNonEmpty(upsert.AccountID, cfg.AccountID),
			firstNonEmpty(upsert.WorkerID, cfg.WorkerID),
			remoteJID,
			remoteJIDAlt,
			fmt.Sprintf("%t", boolValue(key["fromMe"])),
			valueString(key, "id"),
		),
		AccountID:      firstNonEmpty(upsert.AccountID, cfg.AccountID),
		WorkerID:       firstNonEmpty(upsert.WorkerID, cfg.WorkerID),
		ChannelID:      firstNonEmpty(upsert.WorkerID, cfg.WorkerID),
		SourceProvider: sourceProvider,
		MessageKeyID:   valueString(key, "id"),
		Phone:          lifecyclePhoneFromJID(firstNonEmpty(jid, remoteJID, remoteJIDAlt)),
		JID:            jid,
		LID:            lid,
		RemoteJID:      remoteJID,
		RemoteJIDAlt:   remoteJIDAlt,
	}
}

func contextWithMessageLifecycle(ctx context.Context, lifecycle messageLifecycleContext) context.Context {
	return context.WithValue(ctx, messageLifecycleContextKey{}, lifecycle)
}

func startMessageLifecycleSpan(ctx context.Context, cfg Config, lifecycle messageLifecycleContext) (context.Context, func(error)) {
	ctx = contextWithMessageLifecycle(ctx, lifecycle)
	return ctx, func(error) {}
}

func messageLifecycleFromContext(ctx context.Context) (messageLifecycleContext, bool) {
	lifecycle, ok := ctx.Value(messageLifecycleContextKey{}).(messageLifecycleContext)
	return lifecycle, ok
}

func recordMessageLifecycle(ctx context.Context, cfg Config, event map[string]any) {
	if !cfg.MessageLifecycleDebugEnabled || !shouldRecordLifecycleDebugEvent(event) {
		return
	}
	payload := normalizeMessageLifecyclePayload(ctx, cfg, event)
	recordMessageLifecycleExceptionSpan(ctx, payload, event)
	messageLifecycleLoggerMu.RLock()
	logger := messageLifecycleLogger
	messageLifecycleLoggerMu.RUnlock()

	if logger == nil {
		raw, _ := json.Marshal(payload)
		stdlog.Printf("message_lifecycle %s", raw)
		return
	}

	record := otellog.Record{}
	now := time.Now()
	record.SetTimestamp(now)
	record.SetObservedTimestamp(now)
	record.SetSeverity(messageLifecycleSeverity(payload["level"]))
	record.SetSeverityText(strings.ToUpper(stringValue(payload["level"])))
	record.SetBody(otellog.StringValue(firstNonEmpty(stringValue(payload["message"]), "Message lifecycle event")))
	record.AddAttributes(messageLifecycleAttributes(payload)...)
	logger.Emit(ctx, record)
}

func normalizeMessageLifecyclePayload(ctx context.Context, cfg Config, event map[string]any) map[string]any {
	payload := map[string]any{
		"debug_index": messageLifecycleDebugIndex,
		"log_type":    messageLifecycleDebugIndex,
	}
	if lifecycle, ok := messageLifecycleFromContext(ctx); ok {
		payload["message_lifecycle_id"] = lifecycle.MessageLifecycleID
		payload["account_id"] = lifecycle.AccountID
		payload["worker_id"] = lifecycle.WorkerID
		payload["channel_id"] = lifecycle.ChannelID
		payload["source_provider"] = lifecycle.SourceProvider
		payload["message_key_id"] = lifecycle.MessageKeyID
		payload["phone"] = lifecycle.Phone
		payload["jid"] = lifecycle.JID
		payload["lid"] = lifecycle.LID
		payload["remote_jid"] = lifecycle.RemoteJID
		payload["remote_jid_alt"] = lifecycle.RemoteJIDAlt
	} else {
		payload["message_lifecycle_id"] = stableLifecycleID(cfg.AccountID, cfg.WorkerID)
		payload["account_id"] = cfg.AccountID
		payload["worker_id"] = cfg.WorkerID
		payload["channel_id"] = cfg.WorkerID
		payload["source_provider"] = messageLifecycleProvider
	}
	for key, value := range event {
		payload[key] = value
	}
	if payload["level"] == nil {
		payload["level"] = "info"
	}
	if payload["stage"] == nil {
		payload["stage"] = "whatsmeow.lifecycle"
	}
	if file, line, fn, ok := messageLifecycleCaller(); ok {
		payload["source_file"] = file
		payload["source_line"] = line
		payload["source_function"] = fn
	}
	if spanContext := trace.SpanContextFromContext(ctx); spanContext.IsValid() {
		payload["trace_id"] = spanContext.TraceID().String()
		payload["span_id"] = spanContext.SpanID().String()
	}
	if value, ok := event["message_text"]; ok {
		text, truncated := truncateLifecycleValue(value, cfg.MessageLifecycleDebugBodyLimit)
		payload["message_text"] = text
		payload["message_truncated"] = truncated
	}
	if value, ok := event["raw_payload"]; ok {
		raw, truncated := truncateLifecycleValue(value, cfg.MessageLifecycleDebugRawLimit)
		payload["raw_payload"] = raw
		payload["raw_truncated"] = truncated
	}
	return payload
}

func lifecycleToken(value any) string {
	return strings.ToLower(strings.TrimSpace(stringValue(value)))
}

func lifecycleHasMeaningfulValue(value any) bool {
	if value == nil {
		return false
	}
	if typed, ok := value.(string); ok {
		return strings.TrimSpace(typed) != ""
	}
	return true
}

func lifecycleEventHasErrorField(event map[string]any) bool {
	for _, key := range lifecycleErrorFieldKeys {
		value, ok := event[key]
		if ok && lifecycleHasMeaningfulValue(value) {
			return true
		}
	}
	return false
}

func shouldRecordLifecycleDebugEvent(event map[string]any) bool {
	level := lifecycleToken(event["level"])
	if level == "warn" || level == "warning" || level == "error" {
		return true
	}

	if _, ok := lifecycleExceptionOutcomes[lifecycleToken(event["outcome"])]; ok {
		return true
	}

	return lifecycleEventHasErrorField(event)
}

func lifecycleEventIsError(event map[string]any) bool {
	if lifecycleToken(event["level"]) == "error" {
		return true
	}
	if _, ok := lifecycleErrorOutcomes[lifecycleToken(event["outcome"])]; ok {
		return true
	}
	return lifecycleEventHasErrorField(event)
}

func lifecycleString(value any) string {
	if text := stringValue(value); text != "" {
		return text
	}
	return strings.TrimSpace(stringifyLifecycleValue(value))
}

func lifecycleErrorFromEvent(event map[string]any) error {
	for _, key := range lifecycleErrorFieldKeys {
		value, ok := event[key]
		if !ok || !lifecycleHasMeaningfulValue(value) {
			continue
		}
		if err, ok := value.(error); ok {
			return err
		}
		if message := lifecycleString(value); message != "" {
			return fmt.Errorf("%s", message)
		}
	}

	message := firstNonEmpty(
		lifecycleString(event["reason"]),
		fmt.Sprintf("%s:%s", lifecycleString(event["stage"]), lifecycleString(event["outcome"])),
	)
	return fmt.Errorf("%s", message)
}

func lifecycleSpanAttributes(payload map[string]any) []attribute.KeyValue {
	attrs := make([]attribute.KeyValue, 0, len(payload))
	for key, value := range payload {
		if _, omit := lifecycleSpanAttributeOmitKeys[key]; omit {
			continue
		}
		switch typed := value.(type) {
		case string:
			attrs = append(attrs, attribute.String(key, typed))
		case bool:
			attrs = append(attrs, attribute.Bool(key, typed))
		case int:
			attrs = append(attrs, attribute.Int(key, typed))
		case int64:
			attrs = append(attrs, attribute.Int64(key, typed))
		case float64:
			attrs = append(attrs, attribute.Float64(key, typed))
		case nil:
			continue
		default:
			attrs = append(attrs, attribute.String(key, stringifyLifecycleValue(typed)))
		}
	}
	return attrs
}

func recordMessageLifecycleExceptionSpan(ctx context.Context, payload map[string]any, event map[string]any) {
	stage := firstNonEmpty(lifecycleString(payload["stage"]), "unknown")
	tracer := otel.Tracer("message-lifecycle")
	_, span := tracer.Start(
		ctx,
		"message_lifecycle.exception."+stage,
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

func messageLifecycleAttributes(payload map[string]any) []otellog.KeyValue {
	attrs := make([]otellog.KeyValue, 0, len(payload))
	for key, value := range payload {
		if key == "message" {
			continue
		}
		switch typed := value.(type) {
		case string:
			attrs = append(attrs, otellog.String(key, typed))
		case bool:
			attrs = append(attrs, otellog.Bool(key, typed))
		case int:
			attrs = append(attrs, otellog.Int(key, typed))
		case int64:
			attrs = append(attrs, otellog.Int64(key, typed))
		case float64:
			attrs = append(attrs, otellog.Float64(key, typed))
		case nil:
			continue
		default:
			attrs = append(attrs, otellog.String(key, stringifyLifecycleValue(typed)))
		}
	}
	return attrs
}

func messageLifecycleSeverity(level any) otellog.Severity {
	switch strings.ToLower(stringValue(level)) {
	case "debug":
		return otellog.SeverityDebug
	case "warn", "warning":
		return otellog.SeverityWarn
	case "error":
		return otellog.SeverityError
	default:
		return otellog.SeverityInfo
	}
}

func messageLifecycleCaller() (string, int, string, bool) {
	for skip := 2; skip < 10; skip++ {
		pc, file, line, ok := runtime.Caller(skip)
		if !ok {
			continue
		}
		if filepath.Base(file) == "lifecycle_log.go" {
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

func stableLifecycleID(parts ...string) string {
	hash := sha1.New()
	_, _ = hash.Write([]byte(strings.Join(parts, ":")))
	return hex.EncodeToString(hash.Sum(nil))
}

func firstLID(values ...string) string {
	for _, value := range values {
		normalized := strings.ToLower(strings.TrimSpace(value))
		if strings.HasSuffix(normalized, "@lid") {
			return normalized
		}
	}
	return ""
}

func firstNonLID(values ...string) string {
	for _, value := range values {
		normalized := strings.ToLower(strings.TrimSpace(value))
		if normalized != "" && !strings.HasSuffix(normalized, "@lid") {
			return normalized
		}
	}
	return ""
}

func lifecyclePhoneFromJID(jid string) string {
	user, _, _ := strings.Cut(jid, "@")
	var builder strings.Builder
	for _, char := range user {
		if char >= '0' && char <= '9' {
			builder.WriteRune(char)
		}
	}
	phone := builder.String()
	if len(phone) < 8 {
		return ""
	}
	return phone
}

func truncateLifecycleValue(value any, limit int) (string, bool) {
	if limit <= 0 {
		limit = 1
	}
	normalized := stringifyLifecycleValue(value)
	if len(normalized) <= limit {
		return normalized, false
	}
	return normalized[:limit] + "...<truncated>", true
}

func stringifyLifecycleValue(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case []byte:
		return string(typed)
	default:
		raw, err := json.Marshal(typed)
		if err == nil {
			return string(raw)
		}
		return fmt.Sprint(typed)
	}
}

type eventsMessageLike struct {
	chat         string
	remoteJIDAlt string
	sender       string
	senderAlt    string
	id           string
	fromMe       bool
}
