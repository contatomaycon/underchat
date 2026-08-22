package app

import (
	"bytes"
	"context"
	"encoding/json"
	"log"
	"strings"
	"testing"
)

func TestConnectionLifecycleDebugLoggerDisabledDoesNotLog(t *testing.T) {
	var buf bytes.Buffer
	restore := captureConnectionLifecycleDebugLogs(&buf)
	defer restore()

	logger := NewConnectionLifecycleDebugLogger(false, nil)
	logger.Log(context.Background(), "test.event", map[string]any{"trace_id": "trace-1"})

	if got := strings.TrimSpace(buf.String()); got != "" {
		t.Fatalf("expected no log output, got %q", got)
	}
}

func TestConnectionLifecycleDebugLoggerLocalTraceOrdering(t *testing.T) {
	var buf bytes.Buffer
	restore := captureConnectionLifecycleDebugLogs(&buf)
	defer restore()

	logger := NewConnectionLifecycleDebugLogger(true, nil)
	logger.Log(context.Background(), "test.first", map[string]any{"trace_id": "trace-1", "layer": "test"})
	logger.Log(context.Background(), "test.second", map[string]any{"trace_id": "trace-1", "layer": "test"})

	entries := parseConnectionLifecycleDebugLogLines(t, buf.String())
	if len(entries) != 2 {
		t.Fatalf("expected 2 log entries, got %d", len(entries))
	}
	assertDebugNumber(t, entries[0], "seq", 1)
	assertDebugNumber(t, entries[0], "trace_seq", 1)
	assertDebugNumber(t, entries[1], "seq", 2)
	assertDebugNumber(t, entries[1], "trace_seq", 2)
	if entries[1]["event"] != "test.second" {
		t.Fatalf("unexpected event %v", entries[1]["event"])
	}
}

func TestConnectionLifecycleDebugLoggerRedactsQRCodeAndPairingCode(t *testing.T) {
	var buf bytes.Buffer
	restore := captureConnectionLifecycleDebugLogs(&buf)
	defer restore()

	logger := NewConnectionLifecycleDebugLogger(true, nil)
	logger.Log(context.Background(), "test.qr", map[string]any{
		"trace_id":     "trace-qr",
		"qrcode":       "raw-qr-value",
		"pairing_code": "123-456",
	})

	output := buf.String()
	if strings.Contains(output, "raw-qr-value") || strings.Contains(output, "123-456") {
		t.Fatalf("log leaked sensitive QR or pairing data: %s", output)
	}

	entries := parseConnectionLifecycleDebugLogLines(t, output)
	if len(entries) != 1 {
		t.Fatalf("expected 1 log entry, got %d", len(entries))
	}
	if entries[0]["has_qr"] != true || entries[0]["has_pairing_code"] != true {
		t.Fatalf("expected QR and pairing metadata, got %+v", entries[0])
	}
	assertDebugNumber(t, entries[0], "qr_length", len("raw-qr-value"))
	assertDebugNumber(t, entries[0], "pairing_code_length", len("123-456"))
	if _, ok := entries[0]["qr_sha256_12"]; ok {
		t.Fatalf("QR-derived hashes must not be logged, got %+v", entries[0])
	}
	if _, ok := entries[0]["pairing_code_sha256_12"]; ok {
		t.Fatalf("pairing-code-derived hashes must not be logged, got %+v", entries[0])
	}
}

func TestConnectionLifecycleDebugLoggerRedactsPasskeyMaterial(t *testing.T) {
	var buf bytes.Buffer
	restore := captureConnectionLifecycleDebugLogs(&buf)
	defer restore()

	logger := NewConnectionLifecycleDebugLogger(true, nil)
	logger.Log(context.Background(), "test.passkey", map[string]any{
		"trace_id":         "trace-passkey",
		"passkey_response": "raw-passkey-assertion",
		"public_key":       "raw-public-key",
	})
	output := buf.String()
	if strings.Contains(output, "raw-passkey-assertion") || strings.Contains(output, "raw-public-key") {
		t.Fatalf("log leaked passkey material: %s", output)
	}
	entries := parseConnectionLifecycleDebugLogLines(t, output)
	if len(entries) != 1 || entries[0]["has_passkey_response"] != true || entries[0]["has_passkey_public_key"] != true {
		t.Fatalf("expected only passkey presence metadata, got %+v", entries)
	}
}

func captureConnectionLifecycleDebugLogs(buf *bytes.Buffer) func() {
	previousOutput := log.Writer()
	previousFlags := log.Flags()
	log.SetOutput(buf)
	log.SetFlags(0)
	return func() {
		log.SetOutput(previousOutput)
		log.SetFlags(previousFlags)
	}
}

func parseConnectionLifecycleDebugLogLines(t *testing.T, output string) []map[string]any {
	t.Helper()
	lines := strings.Split(strings.TrimSpace(output), "\n")
	entries := make([]map[string]any, 0, len(lines))
	for _, line := range lines {
		if strings.TrimSpace(line) == "" {
			continue
		}
		raw := strings.TrimPrefix(line, "[connection-lifecycle-debug] ")
		var entry map[string]any
		if err := json.Unmarshal([]byte(raw), &entry); err != nil {
			t.Fatalf("failed to decode log line %q: %v", line, err)
		}
		entries = append(entries, entry)
	}
	return entries
}

func assertDebugNumber(t *testing.T, entry map[string]any, key string, want int) {
	t.Helper()
	got, ok := entry[key].(float64)
	if !ok {
		t.Fatalf("entry[%s] = %T(%v), want number", key, entry[key], entry[key])
	}
	if int(got) != want {
		t.Fatalf("entry[%s] = %d, want %d", key, int(got), want)
	}
}
