package app

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestConnectionFlowSensitiveKeysUseNormalizedNames(t *testing.T) {
	for _, key := range []string{
		"passkey_public_key",
		"passkey_response",
		"passkey_confirmation_code",
		"clientDataJSON",
		"authenticatorData",
		"rawId",
		"webauthn_assertion",
		"runtime_capability",
		"nats_creds_base64",
		"client_secret",
		"database_url",
		"postgres_dsn",
		"callback_url",
		"session_cookies",
		"access_token",
		"raw_payload",
		"binary_blob",
	} {
		if !isConnectionFlowSensitiveKey(key) {
			t.Fatalf("expected %s to be treated as sensitive", key)
		}
	}
}

func TestConnectionFlowPasskeyValueIsRedacted(t *testing.T) {
	sanitized := sanitizeConnectionFlowValue(
		"passkey_public_key",
		`{"challenge":"secret-challenge"}`,
	)
	metadata, ok := sanitized.(map[string]any)
	if !ok {
		t.Fatalf("expected redaction metadata, got %#v", sanitized)
	}
	if metadata["redacted"] != true {
		t.Fatalf("expected redacted metadata, got %#v", metadata)
	}
	if metadata["present"] != true {
		t.Fatalf("expected present metadata, got %#v", metadata)
	}
}

func TestConnectionFlowIdentifiersAreHashedRecursively(t *testing.T) {
	const rawJID = "5511999999999@s.whatsapp.net"
	const rawPhone = "5511999999999"
	sanitized := sanitizeConnectionFlowValue("context", map[string]any{
		"jid": rawJID,
		"nested": map[string]any{
			"phone_number": rawPhone,
			"qrcode":       "pairing-secret",
		},
	}).(map[string]any)

	if sanitized["jid"] == rawJID || sanitized["jid"] != hashConnectionFlowIdentifier(rawJID) {
		t.Fatalf("JID was not deterministically hashed: %#v", sanitized["jid"])
	}
	nested := sanitized["nested"].(map[string]any)
	if nested["phone_number"] == rawPhone || nested["phone_number"] != hashConnectionFlowIdentifier(rawPhone) {
		t.Fatalf("phone was not deterministically hashed: %#v", nested["phone_number"])
	}
	qrMetadata := nested["qrcode"].(map[string]any)
	if qrMetadata["redacted"] != true || qrMetadata["present"] != true {
		t.Fatalf("nested QR was not redacted: %#v", qrMetadata)
	}
}

func TestConnectionFlowGenericSecretsAreRedactedRecursively(t *testing.T) {
	fields := map[string]any{
		"runtime_capability": "capability-value",
		"nats_creds_base64":  "nats-credential-value",
		"client_secret":      "secret-value",
		"database_url":       "postgres://database-value",
		"postgres_dsn":       "dsn-value",
		"callback_url":       "https://url-value.invalid/path",
		"qr_code":            "qr-value",
		"session_cookies":    []string{"cookie-value"},
		"access_token":       "token-value",
		"raw_payload":        map[string]any{"nested": "payload-value"},
		"nested": map[string]any{
			"binary_blob": []byte("binary-value"),
		},
	}

	sanitized := sanitizeConnectionFlowValue("context", fields).(map[string]any)
	encoded, err := json.Marshal(sanitized)
	if err != nil {
		t.Fatalf("failed to encode sanitized fields: %v", err)
	}
	output := string(encoded)
	for _, forbidden := range []string{
		"capability-value",
		"nats-credential-value",
		"secret-value",
		"database-value",
		"dsn-value",
		"url-value",
		"qr-value",
		"cookie-value",
		"token-value",
		"payload-value",
		"binary-value",
	} {
		if strings.Contains(output, forbidden) {
			t.Fatalf("sanitized output retained a sensitive value")
		}
	}
	for _, key := range []string{
		"runtime_capability",
		"nats_creds_base64",
		"client_secret",
		"database_url",
		"postgres_dsn",
		"callback_url",
		"qr_code",
		"session_cookies",
		"access_token",
		"raw_payload",
	} {
		metadata, ok := sanitized[key].(map[string]any)
		if !ok || metadata["redacted"] != true {
			t.Fatalf("expected %s to contain only redaction metadata, got %#v", key, sanitized[key])
		}
	}
	binaryMetadata := sanitized["nested"].(map[string]any)["binary_blob"].(map[string]any)
	if binaryMetadata["redacted"] != true || binaryMetadata["type"] != "binary" || binaryMetadata["bytes"] != len("binary-value") {
		t.Fatalf("expected binary shape metadata, got %#v", binaryMetadata)
	}
}

func TestConnectionFlowPreservesOnlyTypedOperationalMetadata(t *testing.T) {
	for key, value := range map[string]any{
		"fencing_token":       "42",
		"has_payload_json":    true,
		"payload_bytes":       4096,
		"qr_pending":          false,
		"qr_generated_at":     "2026-08-03T12:00:00Z",
		"time_to_first_qr_ms": 250,
		"token_count":         3,
		"secret_available":    true,
		"binary_size":         128,
		"capability_present":  true,
	} {
		if got := sanitizeConnectionFlowValue(key, value); got != value {
			t.Fatalf("safe operational metadata %s changed from %#v to %#v", key, value, got)
		}
	}

	for key, value := range map[string]any{
		"fencing_token":   "not-a-counter",
		"payload_bytes":   "payload-disguised-as-size",
		"qr_generated_at": "qr-disguised-as-timestamp",
	} {
		metadata, ok := sanitizeConnectionFlowValue(key, value).(map[string]any)
		if !ok || metadata["redacted"] != true {
			t.Fatalf("unsafe metadata-shaped field %s was not redacted", key)
		}
	}
}

func TestConnectionLifecycleDebugUsesIdentifierHashFields(t *testing.T) {
	const rawJID = "5511888888888@s.whatsapp.net"
	sanitized := sanitizeConnectionLifecycleDebugFields(map[string]any{
		"jid": rawJID,
	})

	if _, present := sanitized["jid"]; present {
		t.Fatal("raw JID field remained in lifecycle debug fields")
	}
	if sanitized["jid_hash"] != hashConnectionFlowIdentifier(rawJID) {
		t.Fatalf("unexpected lifecycle JID hash: %#v", sanitized["jid_hash"])
	}
}
