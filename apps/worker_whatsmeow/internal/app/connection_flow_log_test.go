package app

import "testing"

func TestConnectionFlowSensitiveKeysUseNormalizedNames(t *testing.T) {
	for _, key := range []string{
		"passkey_public_key",
		"passkey_response",
		"passkey_confirmation_code",
		"clientDataJSON",
		"authenticatorData",
		"rawId",
		"webauthn_assertion",
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
