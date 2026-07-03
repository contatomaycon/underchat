package app

import (
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"
)

var connectionFlowSensitiveKeys = map[string]struct{}{
	"authenticatordata":         {},
	"clientdatajson":            {},
	"credential_id":             {},
	"passkey_confirmation_code": {},
	"passkey_public_key":        {},
	"passkey_response":          {},
	"passkey_secret":            {},
	"pairing_code":              {},
	"publickey":                 {},
	"qr":                        {},
	"qr_code":                   {},
	"qrcode":                    {},
	"rawid":                     {},
	"signature":                 {},
	"userhandle":                {},
	"webauthn_assertion":        {},
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
	if isConnectionFlowSensitiveKey(key) {
		return redactedConnectionFlowValue(value)
	}
	return value
}

func isConnectionFlowSensitiveKey(key string) bool {
	normalized := normalizeConnectionFlowKey(key)
	if _, ok := connectionFlowSensitiveKeys[normalized]; ok {
		return true
	}
	return strings.Contains(normalized, "passkeyresponse") ||
		strings.Contains(normalized, "clientdatajson") ||
		strings.Contains(normalized, "authenticatordata") ||
		strings.Contains(normalized, "webauthnassertion")
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
			"length":   0,
		}
	}

	raw := fmt.Sprint(value)
	return map[string]any{
		"redacted": true,
		"present":  raw != "",
		"length":   len(raw),
	}
}
