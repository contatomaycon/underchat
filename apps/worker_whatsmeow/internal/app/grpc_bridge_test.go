package app

import "testing"

func TestCommandNotifyWorkerStatusUsesCompleteConnectionState(t *testing.T) {
	descs, err := getDescriptors()
	if err != nil {
		t.Fatalf("get descriptors: %v", err)
	}

	msg := newDynamicMessage(descs.commandNotifyWorkerStatus)
	setConnectionStateMessage(msg, ConnectionState{
		Code:                CodeAwaitingReadQRCode,
		Status:              "connecting",
		WorkerID:            "worker-1",
		AccountID:           "account-1",
		QRCode:              "data:image/png;base64,qr",
		IsNewLogin:          true,
		Time:                123,
		WorkerStatusID:      WorkerStatusDisponible,
		Attempt:             2,
		MaxAttempts:         3,
		ConnectionAttemptID: "attempt-1",
		QRPending:           false,
		QRGeneratedAt:       "2026-06-06T03:53:23Z",
		TimeToFirstQRMS:     393,
	})

	if got := int(dynamicInt32(msg, "code")); got != CodeAwaitingReadQRCode {
		t.Fatalf("unexpected code %d", got)
	}
	if got := dynamicString(msg, "status"); got != "connecting" {
		t.Fatalf("unexpected status %q", got)
	}
	if got := dynamicString(msg, "qrcode"); got != "data:image/png;base64,qr" {
		t.Fatalf("unexpected qrcode %q", got)
	}
	if got := dynamicString(msg, "worker_status_id"); got != WorkerStatusDisponible {
		t.Fatalf("unexpected worker_status_id %q", got)
	}
	if got := int(dynamicInt32(msg, "attempt")); got != 2 {
		t.Fatalf("unexpected attempt %d", got)
	}
	if got := int(dynamicInt32(msg, "max_attempts")); got != 3 {
		t.Fatalf("unexpected max_attempts %d", got)
	}
	if got := dynamicString(msg, "connection_attempt_id"); got != "attempt-1" {
		t.Fatalf("unexpected connection_attempt_id %q", got)
	}
	if got := dynamicString(msg, "qr_generated_at"); got != "2026-06-06T03:53:23Z" {
		t.Fatalf("unexpected qr_generated_at %q", got)
	}
	if got := int(dynamicInt32(msg, "time_to_first_qr_ms")); got != 393 {
		t.Fatalf("unexpected time_to_first_qr_ms %d", got)
	}
}
