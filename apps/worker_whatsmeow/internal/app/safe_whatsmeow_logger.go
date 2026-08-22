package app

import (
	"encoding/json"
	"log"
	"reflect"
	"strings"
	"time"

	waLog "go.mau.fi/whatsmeow/util/log"
)

// safeWhatsmeowLogger keeps the provider's low-level operational trace without
// rendering values supplied by protocol code. Those values routinely include
// JIDs, message IDs, Signal nodes and authentication material.
type safeWhatsmeowLogger struct {
	module       string
	debugEnabled bool
}

func newSafeWhatsmeowLogger(debugEnabled bool) waLog.Logger {
	return &safeWhatsmeowLogger{module: "Whatsmeow", debugEnabled: debugEnabled}
}

func (l *safeWhatsmeowLogger) Debugf(message string, args ...any) {
	if l.debugEnabled {
		l.output("DEBUG", message, args...)
	}
}

func (l *safeWhatsmeowLogger) Infof(message string, args ...any) {
	l.output("INFO", message, args...)
}

func (l *safeWhatsmeowLogger) Warnf(message string, args ...any) {
	l.output("WARN", message, args...)
}

func (l *safeWhatsmeowLogger) Errorf(message string, args ...any) {
	l.output("ERROR", message, args...)
}

// SessionDebug is an optional extension consumed by the vendored whatsmeow
// client for bounded lifecycle diagnostics. Keeping the switch in this
// adapter means the library never reads process environment directly and a
// caller that did not opt into debug output remains completely silent.
func (l *safeWhatsmeowLogger) SessionDebug(event string, fields map[string]any) {
	waLog.WriteSessionDebug(l.debugEnabled, event, fields, func(line string) {
		log.Print(line)
	})
}

func (l *safeWhatsmeowLogger) Sub(module string) waLog.Logger {
	normalized := strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_' || r == '-' {
			return r
		}
		return '_'
	}, module)
	if normalized == "" {
		normalized = "unknown"
	}
	return &safeWhatsmeowLogger{
		module:       l.module + "/" + normalized,
		debugEnabled: l.debugEnabled,
	}
}

func (l *safeWhatsmeowLogger) output(level, message string, args ...any) {
	template := strings.ReplaceAll(strings.ReplaceAll(message, "\r", " "), "\n", " ")
	if len(template) > 512 {
		template = template[:512]
	}
	payload := map[string]any{
		"module":         l.module,
		"level":          level,
		"template":       template,
		"argument_count": len(args),
		"arguments":      safeWhatsmeowLogArguments(args),
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		log.Printf("[whatsmeow-provider-debug] module=%s level=%s error_code=serialization_failed", l.module, level)
		return
	}
	log.Printf("[whatsmeow-provider-debug] %s", encoded)
}

func safeWhatsmeowLogArguments(args []any) []any {
	result := make([]any, len(args))
	for index, arg := range args {
		result[index] = safeWhatsmeowLogArgument(arg)
	}
	return result
}

func safeWhatsmeowLogArgument(value any) any {
	if value == nil {
		return nil
	}
	if duration, ok := value.(time.Duration); ok {
		return map[string]any{"type": "duration", "milliseconds": duration.Milliseconds()}
	}
	if raw, ok := value.([]byte); ok {
		return map[string]any{"type": "binary", "bytes": len(raw)}
	}
	if err, ok := value.(error); ok {
		return map[string]any{"type": reflect.TypeOf(err).String(), "error_code": safeOperationalErrorCode(err)}
	}
	if text, ok := value.(string); ok {
		return map[string]any{"type": "string", "bytes": len([]byte(text))}
	}
	reflected := reflect.ValueOf(value)
	switch reflected.Kind() {
	case reflect.Bool:
		return reflected.Bool()
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		return reflected.Int()
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		return reflected.Uint()
	case reflect.Float32, reflect.Float64:
		return reflected.Float()
	case reflect.Array, reflect.Slice, reflect.Map:
		return map[string]any{"type": reflect.TypeOf(value).String(), "count": reflected.Len()}
	default:
		return map[string]any{"type": reflect.TypeOf(value).String()}
	}
}
