package app

import (
	"bytes"
	"errors"
	"log"
	"reflect"
	"strings"
	"testing"
)

type panickingLogStringer struct{}

func (panickingLogStringer) String() string {
	panic("provider String method must not run while sanitizing logs")
}

func TestSafeWhatsmeowLoggerDoesNotRenderProviderArguments(t *testing.T) {
	var output bytes.Buffer
	previousWriter := log.Writer()
	previousFlags := log.Flags()
	log.SetOutput(&output)
	log.SetFlags(0)
	t.Cleanup(func() {
		log.SetOutput(previousWriter)
		log.SetFlags(previousFlags)
	})

	logger := newSafeWhatsmeowLogger(true).Sub("Send")
	logger.Infof(
		"Failed to send message %s to %s: %v",
		"secret-message-id",
		"5511999999999@s.whatsapp.net",
		errors.New("postgres://secret:password@db/session"),
	)

	got := output.String()
	for _, secret := range []string{
		"secret-message-id",
		"5511999999999",
		"postgres://",
		"password",
	} {
		if strings.Contains(got, secret) {
			t.Fatalf("provider logger leaked %q in %q", secret, got)
		}
	}
	if !strings.Contains(got, "Failed to send message %s to %s: %v") {
		t.Fatalf("provider logger dropped the operational template: %q", got)
	}
	if strings.Contains(got, "sha256") {
		t.Fatalf("provider logger retained a stable argument fingerprint: %q", got)
	}
	if !strings.Contains(got, `"type":"string"`) || !strings.Contains(got, "operation_failed") {
		t.Fatalf("provider logger did not retain safe diagnostics: %q", got)
	}
}

func TestSafeWhatsmeowLoggerEmitsOnlyShapeForSensitiveValues(t *testing.T) {
	firstText := safeWhatsmeowLogArgument("first-secret")
	secondText := safeWhatsmeowLogArgument("other-secret")
	if !reflect.DeepEqual(firstText, secondText) {
		t.Fatalf("same-sized strings must have indistinguishable metadata: %#v %#v", firstText, secondText)
	}

	firstBinary := safeWhatsmeowLogArgument([]byte("binary-one"))
	secondBinary := safeWhatsmeowLogArgument([]byte("binary-two"))
	if !reflect.DeepEqual(firstBinary, secondBinary) {
		t.Fatalf("same-sized binaries must have indistinguishable metadata: %#v %#v", firstBinary, secondBinary)
	}

	for _, metadata := range []any{firstText, firstBinary} {
		fields, ok := metadata.(map[string]any)
		if !ok {
			t.Fatalf("expected structural metadata, got %T", metadata)
		}
		if _, present := fields["sha256"]; present {
			t.Fatalf("stable digest must not be logged: %#v", fields)
		}
	}
}

func TestSafeWhatsmeowLoggerDoesNotInvokeProviderStringers(t *testing.T) {
	argument := safeWhatsmeowLogArgument(panickingLogStringer{})
	fields, ok := argument.(map[string]any)
	if !ok {
		t.Fatalf("expected structural log fields, got %T", argument)
	}
	if fields["type"] != "app.panickingLogStringer" {
		t.Fatalf("unexpected structural type: %#v", fields)
	}
	if len(fields) != 1 {
		t.Fatalf("stringer contents must not be inspected: %#v", fields)
	}
}

func TestSafeWhatsmeowLoggerSessionDebugHonorsSwitchAndSanitizesSecrets(t *testing.T) {
	var output bytes.Buffer
	previousWriter := log.Writer()
	previousFlags := log.Flags()
	log.SetOutput(&output)
	log.SetFlags(0)
	t.Cleanup(func() {
		log.SetOutput(previousWriter)
		log.SetFlags(previousFlags)
	})

	disabled := newSafeWhatsmeowLogger(false).(*safeWhatsmeowLogger)
	disabled.SessionDebug("internal_reconnect.disabled", map[string]any{
		"session_id": "019fce0d-1d24-7000-8000-000000000099",
	})
	if output.Len() != 0 {
		t.Fatalf("disabled session debug wrote output: %q", output.String())
	}

	enabled := newSafeWhatsmeowLogger(true).(*safeWhatsmeowLogger)
	enabled.SessionDebug("internal_reconnect.server_login_restart_received", map[string]any{
		"session_id":   "019fce0d-1d24-7000-8000-000000000099",
		"provider":     "whatsmeow",
		"jid":          "5511999999999@s.whatsapp.net",
		"qr_payload":   "sensitive-qr-value",
		"database_url": "postgres://secret:password@db/session",
	})

	got := output.String()
	for _, expected := range []string{
		whatsappSessionDebugPrefix,
		"internal_reconnect.server_login_restart_received",
		`"provider":"whatsmeow"`,
		"sha256:",
		"[redacted]",
	} {
		if !strings.Contains(got, expected) {
			t.Fatalf("session debug omitted %q in %q", expected, got)
		}
	}
	for _, secret := range []string{
		"5511999999999",
		"sensitive-qr-value",
		"postgres://",
		"password",
	} {
		if strings.Contains(got, secret) {
			t.Fatalf("session debug leaked %q in %q", secret, got)
		}
	}
}
