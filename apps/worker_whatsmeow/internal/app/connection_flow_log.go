package app

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"log"
	"reflect"
	"strconv"
	"strings"
	"time"
)

var connectionFlowSensitiveKeys = map[string]struct{}{
	"authenticatordata":       {},
	"clientdatajson":          {},
	"credentialid":            {},
	"passkeyconfirmationcode": {},
	"passkeypublickey":        {},
	"passkeyresponse":         {},
	"passkeysecret":           {},
	"pairingcode":             {},
	"publickey":               {},
	"qr":                      {},
	"qrcode":                  {},
	"rawid":                   {},
	"signature":               {},
	"userhandle":              {},
	"webauthnassertion":       {},
}

func connectionFlowLog(event string, fields map[string]any) {
	payload := map[string]any{
		"event":     event,
		"timestamp": time.Now().UTC().Format(time.RFC3339Nano),
	}
	for key, value := range fields {
		payload[key] = sanitizeConnectionFlowValue(key, value)
	}

	encoded, err := json.Marshal(payload)
	if err != nil {
		log.Printf("[CONNECTION_FLOW] event=%s serialization_error=%s", event, err.Error())
		return
	}
	log.Printf("[CONNECTION_FLOW] %s", encoded)
}

func sanitizeConnectionFlowValue(key string, value any) any {
	if byteCount, binary := connectionFlowBinarySize(value); binary {
		return map[string]any{
			"redacted": true,
			"present":  byteCount > 0,
			"type":     "binary",
			"bytes":    byteCount,
		}
	}
	normalizedKey := normalizeConnectionFlowKey(key)
	if isConnectionFlowPotentiallySensitiveKey(normalizedKey) {
		if isConnectionFlowSafeSensitiveMetadata(normalizedKey, value) {
			return value
		}
		return redactedConnectionFlowValue(value)
	}
	if isConnectionFlowIdentifierKey(key) {
		return hashConnectionFlowIdentifier(value)
	}
	switch typed := value.(type) {
	case map[string]any:
		sanitized := make(map[string]any, len(typed))
		for nestedKey, nestedValue := range typed {
			sanitized[nestedKey] = sanitizeConnectionFlowValue(nestedKey, nestedValue)
		}
		return sanitized
	case []any:
		sanitized := make([]any, len(typed))
		for index, nestedValue := range typed {
			sanitized[index] = sanitizeConnectionFlowValue(key, nestedValue)
		}
		return sanitized
	}

	reflected := reflect.ValueOf(value)
	if reflected.IsValid() {
		switch reflected.Kind() {
		case reflect.Map:
			if reflected.Type().Key().Kind() != reflect.String {
				return map[string]any{"type": reflected.Type().String(), "count": reflected.Len()}
			}
			sanitized := make(map[string]any, reflected.Len())
			iterator := reflected.MapRange()
			for iterator.Next() {
				nestedKey := iterator.Key().String()
				sanitized[nestedKey] = sanitizeConnectionFlowValue(nestedKey, iterator.Value().Interface())
			}
			return sanitized
		case reflect.Array, reflect.Slice:
			sanitized := make([]any, reflected.Len())
			for index := 0; index < reflected.Len(); index++ {
				sanitized[index] = sanitizeConnectionFlowValue(key, reflected.Index(index).Interface())
			}
			return sanitized
		case reflect.Struct:
			if timestamp, ok := value.(time.Time); ok {
				return timestamp
			}
			return map[string]any{"type": reflected.Type().String()}
		}
	}
	return value
}

func isConnectionFlowIdentifierKey(key string) bool {
	normalized := normalizeConnectionFlowKey(key)
	return strings.HasSuffix(normalized, "jid") ||
		strings.HasSuffix(normalized, "jidalt") ||
		normalized == "phone" ||
		strings.HasSuffix(normalized, "phonenumber") ||
		normalized == "redactedphone"
}

func hashConnectionFlowIdentifier(value any) string {
	raw := strings.TrimSpace(fmt.Sprint(value))
	if raw == "" || raw == "<nil>" {
		return ""
	}
	digest := sha256.Sum256([]byte(raw))
	return fmt.Sprintf("sha256:%x", digest[:])
}

func isConnectionFlowSensitiveKey(key string) bool {
	normalized := normalizeConnectionFlowKey(key)
	return isConnectionFlowPotentiallySensitiveKey(normalized) &&
		!isConnectionFlowSensitiveMetadataKey(normalized)
}

func isConnectionFlowPotentiallySensitiveKey(normalized string) bool {
	if _, ok := connectionFlowSensitiveKeys[normalized]; ok {
		return true
	}
	return strings.Contains(normalized, "passkeyresponse") ||
		strings.Contains(normalized, "clientdatajson") ||
		strings.Contains(normalized, "authenticatordata") ||
		strings.Contains(normalized, "webauthnassertion") ||
		strings.Contains(normalized, "credential") ||
		strings.Contains(normalized, "creds") ||
		strings.Contains(normalized, "capability") ||
		strings.Contains(normalized, "secret") ||
		strings.Contains(normalized, "databaseurl") ||
		strings.Contains(normalized, "connectionstring") ||
		strings.Contains(normalized, "dsn") ||
		strings.Contains(normalized, "url") ||
		strings.Contains(normalized, "qr") ||
		strings.Contains(normalized, "cookie") ||
		strings.Contains(normalized, "token") ||
		strings.Contains(normalized, "payload") ||
		strings.Contains(normalized, "binary")
}

func isConnectionFlowSensitiveMetadataKey(normalized string) bool {
	if normalized == "fencingtoken" {
		return true
	}
	for _, prefix := range []string{
		"hascapability",
		"hassecret",
		"hasdatabaseurl",
		"hasdsn",
		"hasurl",
		"hasqr",
		"hascookie",
		"hastoken",
		"haspayload",
		"hasbinary",
	} {
		if strings.HasPrefix(normalized, prefix) {
			return true
		}
	}
	for _, suffix := range []string{
		"available",
		"bytes",
		"count",
		"generatedat",
		"length",
		"ms",
		"omitted",
		"pending",
		"present",
		"ready",
		"set",
		"size",
		"timeoutms",
	} {
		if strings.HasSuffix(normalized, suffix) {
			return true
		}
	}
	return false
}

func isConnectionFlowSafeSensitiveMetadata(normalized string, value any) bool {
	if !isConnectionFlowSensitiveMetadataKey(normalized) || value == nil {
		return false
	}
	if normalized == "fencingtoken" {
		switch typed := value.(type) {
		case string:
			if len(typed) == 0 || len(typed) > 20 {
				return false
			}
			_, err := strconv.ParseUint(typed, 10, 64)
			return err == nil
		}
	}
	if strings.HasSuffix(normalized, "generatedat") {
		switch typed := value.(type) {
		case string:
			_, err := time.Parse(time.RFC3339Nano, typed)
			return err == nil
		case time.Time:
			return true
		}
	}
	reflected := reflect.ValueOf(value)
	if !reflected.IsValid() {
		return false
	}
	switch reflected.Kind() {
	case reflect.Bool,
		reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64,
		reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64,
		reflect.Float32, reflect.Float64:
		return true
	default:
		return false
	}
}

func normalizeConnectionFlowKey(key string) string {
	var b strings.Builder
	for _, r := range key {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		}
	}
	return strings.ToLower(b.String())
}

func redactedConnectionFlowValue(value any) map[string]any {
	if value == nil {
		return map[string]any{
			"redacted": true,
			"present":  false,
			"type":     "nil",
		}
	}

	metadata := map[string]any{
		"redacted": true,
		"present":  true,
	}
	reflected := reflect.ValueOf(value)
	metadata["type"] = reflected.Type().String()
	if (reflected.Kind() == reflect.Pointer || reflected.Kind() == reflect.Interface || reflected.Kind() == reflect.Map || reflected.Kind() == reflect.Slice) && reflected.IsNil() {
		metadata["present"] = false
		return metadata
	}
	switch reflected.Kind() {
	case reflect.String:
		metadata["bytes"] = len([]byte(reflected.String()))
		metadata["present"] = reflected.Len() > 0
	case reflect.Array, reflect.Slice:
		metadata["count"] = reflected.Len()
		metadata["present"] = reflected.Len() > 0
	case reflect.Map:
		metadata["count"] = reflected.Len()
		metadata["present"] = reflected.Len() > 0
	}
	return metadata
}

func connectionFlowBinarySize(value any) (int, bool) {
	if value == nil {
		return 0, false
	}
	reflected := reflect.ValueOf(value)
	if reflected.Kind() != reflect.Array && reflected.Kind() != reflect.Slice {
		return 0, false
	}
	if reflected.Type().Elem().Kind() != reflect.Uint8 {
		return 0, false
	}
	return reflected.Len(), true
}
