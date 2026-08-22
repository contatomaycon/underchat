package waLog

import (
	"strings"
	"testing"
	"time"
)

func TestSessionDebugSanitizesBoundsAndRateLimitsEveryEvent(t *testing.T) {
	emitter := newSessionDebugEmitter()
	now := time.Date(2026, time.August, 2, 12, 0, 0, 0, time.UTC)
	fields := map[string]any{
		"session_id":     "10000000-0000-4000-8000-000000000001",
		"provider":       "whatsmeow",
		"jid":            "5511999999999@s.whatsapp.net",
		"indexed":        map[string]any{"5511888888888@lid": "safe-value"},
		"database_url":   "postgresql://runtime:super-secret@database.invalid/underchat",
		"endpoint":       "https://user:super-secret@example.invalid/private",
		"qr_payload":     "raw-qr-secret",
		"fencing_token":  int64(91),
		"neutral_binary": []byte("binary-secret"),
		"oversized":      strings.Repeat("x", sessionDebugMaxEventBytes*2),
	}

	var lines []string
	for index := 0; index < 25; index++ {
		lines = append(lines, emitter.prepare("test.event", fields, now)...)
	}
	if len(lines) != sessionDebugMaxEventsPerSecond {
		t.Fatalf("expected %d emitted events, got %d", sessionDebugMaxEventsPerSecond, len(lines))
	}
	joined := strings.Join(lines, "\n")
	for _, forbidden := range []string{
		"5511999999999", "5511888888888", "super-secret", "raw-qr-secret", "binary-secret",
	} {
		if strings.Contains(joined, forbidden) {
			t.Fatalf("debug output leaked %q", forbidden)
		}
	}
	for _, expected := range []string{
		SessionDebugPrefix, "sha256:", "[redacted-url]", "[redacted]", "[binary:13]", `"fencing_token":91`,
	} {
		if !strings.Contains(joined, expected) {
			t.Fatalf("debug output did not contain %q: %s", expected, joined)
		}
	}
	for _, line := range lines {
		if len(line) > sessionDebugMaxEventBytes {
			t.Fatalf("debug event exceeded %d bytes: %d", sessionDebugMaxEventBytes, len(line))
		}
	}

	rollover := emitter.prepare("test.after_rollover", fields, now.Add(time.Second))
	if len(rollover) != 2 || !strings.Contains(rollover[0], "debug.events_dropped") {
		t.Fatalf("expected one dropped-event summary plus the current event, got %#v", rollover)
	}
}

func TestSessionDebugDisabledDoesNotCallOutput(t *testing.T) {
	called := false
	WriteSessionDebug(false, "disabled", map[string]any{"session_id": "session"}, func(string) {
		called = true
	})
	if called {
		t.Fatal("disabled session debug called its output")
	}
}
