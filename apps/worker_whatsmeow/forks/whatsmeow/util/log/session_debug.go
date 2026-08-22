package waLog

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"reflect"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	SessionDebugPrefix             = "[whatsapp-session-debug]"
	sessionDebugMaxEventBytes      = 8 * 1024
	sessionDebugMaxEventsPerSecond = 10
	sessionDebugMaxDepth           = 5
	sessionDebugMaxStringBytes     = 1000
)

var (
	sessionDebugRedactedKey = regexp.MustCompile(`(?i)(adv|auth|capability|cookie|credential|key|password|payload|profile|qr|secret|token|url)`)
	sessionDebugJIDKey      = regexp.MustCompile(`(?i)(^|_)jid($|_)`)
	sessionDebugURL         = regexp.MustCompile(`(?i)\b(?:postgres(?:ql)?|https?|wss?)://[^\s"']+`)
	sessionDebugJID         = regexp.MustCompile(`(?i)\b[0-9]{5,}(?::[0-9]+)?@(?:c\.us|s\.whatsapp\.net|lid|g\.us)\b`)
	defaultSessionDebug     = newSessionDebugEmitter()
)

type sessionDebugWindow struct {
	startedAt time.Time
	emitted   int
	dropped   int
}

type sessionDebugEmitter struct {
	mu      sync.Mutex
	windows map[string]*sessionDebugWindow
}

func newSessionDebugEmitter() *sessionDebugEmitter {
	return &sessionDebugEmitter{windows: make(map[string]*sessionDebugWindow)}
}

// WriteSessionDebug emits bounded, structured implementation diagnostics.
// The process-wide limiter is shared by every caller of this package, so a
// worker and its SQLStore cannot independently exceed the per-session limit.
// Raw credentials, URLs, JIDs and binary values are sanitized before output.
func WriteSessionDebug(enabled bool, event string, fields map[string]any, output func(string)) {
	if !enabled || output == nil {
		return
	}
	for _, line := range defaultSessionDebug.prepare(event, fields, time.Now().UTC()) {
		output(line)
	}
}

func (emitter *sessionDebugEmitter) prepare(event string, fields map[string]any, now time.Time) []string {
	sessionID := sessionDebugSessionID(fields)
	emitter.mu.Lock()
	window := emitter.windows[sessionID]
	if window == nil {
		window = &sessionDebugWindow{startedAt: now}
		emitter.windows[sessionID] = window
	}

	var droppedSummary int
	if now.Sub(window.startedAt) >= time.Second || now.Before(window.startedAt) {
		droppedSummary = window.dropped
		window.startedAt = now
		window.emitted = 0
		window.dropped = 0
		if len(emitter.windows) > 2048 {
			for key, candidate := range emitter.windows {
				if key != sessionID && now.Sub(candidate.startedAt) > time.Minute {
					delete(emitter.windows, key)
				}
			}
		}
	}

	lines := make([]string, 0, 2)
	if droppedSummary > 0 && window.emitted < sessionDebugMaxEventsPerSecond {
		window.emitted++
		lines = append(lines, buildSessionDebugLine("debug.events_dropped", map[string]any{
			"session_id": sessionID,
			"provider":   sessionDebugProvider(fields),
			"count":      droppedSummary,
		}, now))
	}
	if window.emitted >= sessionDebugMaxEventsPerSecond {
		window.dropped++
		emitter.mu.Unlock()
		return lines
	}
	window.emitted++
	emitter.mu.Unlock()
	lines = append(lines, buildSessionDebugLine(event, fields, now))
	return lines
}

func sessionDebugSessionID(fields map[string]any) string {
	if value, ok := fields["session_id"].(string); ok && strings.TrimSpace(value) != "" {
		return strings.TrimSpace(value)
	}
	return "unknown"
}

func sessionDebugProvider(fields map[string]any) string {
	if value, ok := fields["provider"].(string); ok && strings.TrimSpace(value) != "" {
		return strings.TrimSpace(value)
	}
	return "unknown"
}

func buildSessionDebugLine(event string, fields map[string]any, now time.Time) string {
	record := make(map[string]any, len(fields)+4)
	for key, value := range fields {
		record[key] = value
	}
	record["timestamp"] = now.Format(time.RFC3339Nano)
	record["event"] = event
	if traceID, ok := record["trace_id"].(string); !ok || strings.TrimSpace(traceID) == "" {
		record["trace_id"] = newSessionDebugTraceID()
	}

	sanitized, _ := sanitizeSessionDebugValue(record, "", 0, make(map[sessionDebugVisit]bool)).(map[string]any)
	serialized, err := json.Marshal(sanitized)
	maxPayloadBytes := sessionDebugMaxEventBytes - len(SessionDebugPrefix) - 1
	if err != nil || len(serialized) > maxPayloadBytes {
		fallback := map[string]any{
			"timestamp":  now.Format(time.RFC3339Nano),
			"event":      sanitizeSessionDebugString(event, "event"),
			"trace_id":   sanitized["trace_id"],
			"session_id": sanitized["session_id"],
			"provider":   sanitized["provider"],
			"truncated":  true,
		}
		serialized, err = json.Marshal(fallback)
		if err != nil {
			serialized = []byte(`{"event":"debug.encode_failed","truncated":true}`)
		}
	}
	return SessionDebugPrefix + " " + string(serialized)
}

type sessionDebugVisit struct {
	typ reflect.Type
	ptr uintptr
}

func sanitizeSessionDebugValue(value any, key string, depth int, seen map[sessionDebugVisit]bool) any {
	if key != "" && key != "fencing_token" && sessionDebugRedactedKey.MatchString(key) {
		return "[redacted]"
	}
	if value == nil {
		return nil
	}
	if depth > sessionDebugMaxDepth {
		return "[max-depth]"
	}
	if err, ok := value.(error); ok {
		result := map[string]any{"name": reflect.TypeOf(err).String()}
		if sqlState, ok := err.(interface{ SQLState() string }); ok {
			result["code"] = sanitizeSessionDebugString(sqlState.SQLState(), "code")
		}
		return result
	}
	if timestamp, ok := value.(time.Time); ok {
		return timestamp.UTC().Format(time.RFC3339Nano)
	}
	if stringer, ok := value.(fmt.Stringer); ok {
		return sanitizeSessionDebugString(stringer.String(), key)
	}

	rv := reflect.ValueOf(value)
	for rv.Kind() == reflect.Interface || rv.Kind() == reflect.Pointer {
		if rv.IsNil() {
			return nil
		}
		visit := sessionDebugVisit{typ: rv.Type(), ptr: rv.Pointer()}
		if seen[visit] {
			return "[cycle]"
		}
		seen[visit] = true
		defer delete(seen, visit)
		rv = rv.Elem()
	}

	switch rv.Kind() {
	case reflect.String:
		return sanitizeSessionDebugString(rv.String(), key)
	case reflect.Bool:
		return rv.Bool()
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		return rv.Int()
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64, reflect.Uintptr:
		return rv.Uint()
	case reflect.Float32, reflect.Float64:
		return rv.Float()
	case reflect.Slice, reflect.Array:
		if rv.Type().Elem().Kind() == reflect.Uint8 {
			return fmt.Sprintf("[binary:%d]", rv.Len())
		}
		length := min(rv.Len(), 50)
		result := make([]any, 0, length)
		for index := 0; index < length; index++ {
			result = append(result, sanitizeSessionDebugValue(rv.Index(index).Interface(), "", depth+1, seen))
		}
		return result
	case reflect.Map:
		if rv.Type().Key().Kind() != reflect.String {
			return "[object:" + rv.Type().String() + "]"
		}
		keys := rv.MapKeys()
		sort.Slice(keys, func(left, right int) bool { return keys[left].String() < keys[right].String() })
		if len(keys) > 100 {
			keys = keys[:100]
		}
		result := make(map[string]any, len(keys))
		for _, mapKey := range keys {
			entryKey := mapKey.String()
			sanitizedEntryKey := sanitizeSessionDebugString(entryKey, "field_name")
			result[sanitizedEntryKey] = sanitizeSessionDebugValue(rv.MapIndex(mapKey).Interface(), entryKey, depth+1, seen)
		}
		return result
	case reflect.Invalid:
		return nil
	default:
		return "[object:" + rv.Type().String() + "]"
	}
}

func sanitizeSessionDebugString(value, key string) string {
	if sessionDebugJIDKey.MatchString(key) && !strings.HasSuffix(strings.ToLower(key), "_hash") {
		return "sha256:" + hashSessionDebugIdentifier(value)
	}
	value = sessionDebugURL.ReplaceAllString(value, "[redacted-url]")
	value = sessionDebugJID.ReplaceAllStringFunc(value, func(jid string) string {
		return "sha256:" + hashSessionDebugIdentifier(jid)
	})
	if len(value) > sessionDebugMaxStringBytes {
		value = value[:sessionDebugMaxStringBytes]
	}
	return value
}

func hashSessionDebugIdentifier(value string) string {
	digest := sha256.Sum256([]byte(value))
	return hex.EncodeToString(digest[:8])
}

func newSessionDebugTraceID() string {
	var raw [16]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return fmt.Sprintf("trace-%d", time.Now().UnixNano())
	}
	raw[6] = (raw[6] & 0x0f) | 0x40
	raw[8] = (raw[8] & 0x3f) | 0x80
	encoded := hex.EncodeToString(raw[:])
	return encoded[0:8] + "-" + encoded[8:12] + "-" + encoded[12:16] + "-" +
		encoded[16:20] + "-" + encoded[20:32]
}
