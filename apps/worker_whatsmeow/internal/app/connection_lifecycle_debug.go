package app

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	connectionLifecycleDebugGlobalSeqKey = "connection:lifecycle:debug:seq:global"
	connectionLifecycleDebugTraceSeqKey  = "connection:lifecycle:debug:seq:trace:"
	connectionLifecycleDebugTraceTTL     = 24 * time.Hour
)

type ConnectionLifecycleDebugLogger struct {
	enabled       bool
	redis         *redis.Client
	localSeq      atomic.Uint64
	localTraceSeq sync.Map
}

func NewConnectionLifecycleDebugLogger(enabled bool, redisClient *redis.Client) *ConnectionLifecycleDebugLogger {
	return &ConnectionLifecycleDebugLogger{
		enabled: enabled,
		redis:   redisClient,
	}
}

func (l *ConnectionLifecycleDebugLogger) Log(ctx context.Context, event string, fields map[string]any) {
	if l == nil || !l.enabled {
		return
	}
	if ctx == nil {
		ctx = context.Background()
	}

	sanitized := sanitizeConnectionLifecycleDebugFields(fields)
	traceID := connectionLifecycleTraceID(sanitized)
	seq, traceSeq := l.nextSequence(ctx, traceID)

	payload := map[string]any{
		"seq":       seq,
		"event":     event,
		"timestamp": time.Now().UTC().Format(time.RFC3339Nano),
	}
	if traceID != "" {
		payload["trace_id"] = traceID
		payload["trace_seq"] = traceSeq
	}
	for key, value := range sanitized {
		if key == "debug_trace_id" || key == "trace_id" || key == "seq" || key == "trace_seq" || key == "timestamp" || value == nil {
			continue
		}
		if key == "event" {
			payload["source_event"] = value
			continue
		}
		payload[key] = value
	}

	encoded, err := json.Marshal(payload)
	if err != nil {
		log.Printf("[connection-lifecycle-debug] {\"seq\":%d,\"event\":%q,\"marshal_error\":%q}", seq, event, err.Error())
		return
	}
	log.Printf("[connection-lifecycle-debug] %s", string(encoded))
}

func (l *ConnectionLifecycleDebugLogger) nextSequence(ctx context.Context, traceID string) (uint64, uint64) {
	if l.redis != nil {
		pipe := l.redis.TxPipeline()
		globalCmd := pipe.Incr(ctx, connectionLifecycleDebugGlobalSeqKey)
		var traceCmd *redis.IntCmd
		if traceID != "" {
			traceKey := connectionLifecycleDebugTraceSeqKey + traceID
			traceCmd = pipe.Incr(ctx, traceKey)
			pipe.Expire(ctx, traceKey, connectionLifecycleDebugTraceTTL)
		}
		if _, err := pipe.Exec(ctx); err == nil {
			seq := uint64(globalCmd.Val())
			if traceCmd == nil {
				return seq, 0
			}
			return seq, uint64(traceCmd.Val())
		}
	}

	seq := l.localSeq.Add(1)
	if traceID == "" {
		return seq, 0
	}
	value, _ := l.localTraceSeq.LoadOrStore(traceID, new(atomic.Uint64))
	traceSeq := value.(*atomic.Uint64).Add(1)
	return seq, traceSeq
}

func connectionLifecycleTraceID(fields map[string]any) string {
	if value := strings.TrimSpace(fmt.Sprint(fields["trace_id"])); value != "" && value != "<nil>" {
		return value
	}
	if value := strings.TrimSpace(fmt.Sprint(fields["debug_trace_id"])); value != "" && value != "<nil>" {
		return value
	}
	return "no-trace"
}

func sanitizeConnectionLifecycleDebugFields(fields map[string]any) map[string]any {
	sanitized := make(map[string]any, len(fields)+8)
	for key, value := range fields {
		if isConnectionFlowSensitiveKey(key) {
			prefix := connectionLifecycleSensitivePrefix(key)
			raw := fmt.Sprint(value)
			sanitized["has_"+prefix] = raw != "" && raw != "<nil>"
			if raw != "" && raw != "<nil>" {
				sanitized[prefix+"_length"] = len(raw)
			}
			continue
		}
		if isConnectionFlowIdentifierKey(key) {
			sanitized[key+"_hash"] = hashConnectionFlowIdentifier(value)
			continue
		}
		sanitized[key] = sanitizeConnectionFlowValue(key, value)
	}

	if _, ok := sanitized["debug_trace_id"]; ok {
		if _, hasTraceID := sanitized["trace_id"]; !hasTraceID {
			sanitized["trace_id"] = sanitized["debug_trace_id"]
		}
	}

	return sanitized
}

func connectionLifecycleSensitivePrefix(key string) string {
	switch normalizeConnectionFlowKey(key) {
	case "qr", "qrcode":
		return "qr"
	case "pairingcode":
		return "pairing_code"
	case "passkeypublickey", "publickey":
		return "passkey_public_key"
	case "passkeyconfirmationcode":
		return "passkey_confirmation_code"
	case "passkeyresponse", "webauthnassertion":
		return "passkey_response"
	default:
		return "sensitive_value"
	}
}
