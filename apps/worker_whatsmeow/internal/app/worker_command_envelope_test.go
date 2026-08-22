package app

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"testing"
	"time"
)

const workerCommandEnvelopeGolden = `{"schema_version":1,"command_id":"018f47cc-6a4c-7a4a-8b2c-87fd93c87a11","operation_id":"message-123","retry_of":null,"account_id":"account-1","worker_id":"worker-1","command_type":"direct_send","entity_key":"chat:account-1:worker-1:chat-1","entity_sequence":1,"predecessor_operation_id":null,"origin_epoch":"epoch-7","issued_at":"2026-08-13T12:00:00.000Z","deadline_at":"2026-08-13T12:05:00.000Z","payload_version":1,"payload_digest":"ea4529441c11c15cb44c9597af9944d10b459a8718a901cf5c7cfb1e15c89874","payload":{"account":{"id":"account-1"},"chat_id":"chat-1","message_id":"message-123","worker":{"id":"worker-1"}},"traceparent":null,"source":"message-service"}`

func TestWorkerCommandEnvelopeV1Golden(t *testing.T) {
	envelope, err := DecodeWorkerCommandEnvelopeV1([]byte(workerCommandEnvelopeGolden))
	if err != nil {
		t.Fatalf("DecodeWorkerCommandEnvelopeV1() error = %v", err)
	}
	if envelope.CommandType != WorkerCommandTypeDirectSend || envelope.EntitySequence != 1 {
		t.Fatalf("unexpected envelope: %+v", envelope)
	}
	if err := envelope.ValidateTarget("account-1", "worker-1"); err != nil {
		t.Fatalf("ValidateTarget() error = %v", err)
	}
	if err := envelope.ValidateFresh(time.Date(2026, 8, 13, 12, 4, 59, 0, time.UTC)); err != nil {
		t.Fatalf("ValidateFresh() error = %v", err)
	}
}

func TestWorkerCommandEnvelopeV1RejectsDigestAndUnknownField(t *testing.T) {
	var value map[string]any
	if err := json.Unmarshal([]byte(workerCommandEnvelopeGolden), &value); err != nil {
		t.Fatal(err)
	}
	value["payload_digest"] = string(make([]byte, 64))
	raw, _ := json.Marshal(value)
	if _, err := DecodeWorkerCommandEnvelopeV1(raw); err == nil {
		t.Fatal("invalid digest was accepted")
	}
	delete(value, "payload_digest")
	value["payload_digest"] = workerCommandPayloadDigest(t, value["payload"])
	value["unexpected"] = true
	raw, _ = json.Marshal(value)
	if _, err := DecodeWorkerCommandEnvelopeV1(raw); err == nil {
		t.Fatal("unknown envelope field was accepted")
	}
}

func TestWorkerCommandEnvelopeV1RejectsOversizedPayload(t *testing.T) {
	oversized := make([]byte, workerCommandMaxBytes+1)
	if _, err := DecodeWorkerCommandEnvelopeV1(oversized); err == nil {
		t.Fatal("oversized command envelope was accepted")
	}
}

func TestWorkerCommandEnvelopeV1RejectsExpiredAndMismatchedTarget(t *testing.T) {
	envelope, err := DecodeWorkerCommandEnvelopeV1([]byte(workerCommandEnvelopeGolden))
	if err != nil {
		t.Fatal(err)
	}
	if err := envelope.ValidateTarget("other-account", "worker-1"); err == nil {
		t.Fatal("mismatched account target was accepted")
	}
	if err := envelope.ValidateFresh(time.Date(2026, 8, 13, 12, 5, 0, 0, time.UTC)); err == nil {
		t.Fatal("expired command was accepted")
	}
}

func TestWorkerCommandDurableNameIsProviderNeutralAndStable(t *testing.T) {
	const workerID = "worker-1"
	digest := sha256.Sum256([]byte(workerID))
	want := "uc_worker_" + hex.EncodeToString(digest[:16])
	if got := workerCommandDurableName(workerID); got != want {
		t.Fatalf("workerCommandDurableName() = %q, want %q", got, want)
	}
}

func TestWorkerCommandEpochActivationTransitions(t *testing.T) {
	const logicalEpoch = "018f47cc-6a4c-7a4a-8b2c-87fd93c87a10"
	const oldWriterEpoch = "018f47cc-6a4c-7a4a-8b2c-87fd93c87a11"
	const newWriterEpoch = "018f47cc-6a4c-7a4a-8b2c-87fd93c87a12"
	tests := []struct {
		name                string
		state               string
		storedWriter        string
		storedGeneration    int
		requestedWriter     string
		requestedGeneration int
		want                workerCommandEpochActivation
	}{
		{name: "active exact runtime", state: "active", storedWriter: newWriterEpoch, storedGeneration: 8, requestedWriter: newWriterEpoch, requestedGeneration: 8, want: workerCommandEpochAccept},
		{name: "active same runtime newer generation", state: "active", storedWriter: oldWriterEpoch, storedGeneration: 8, requestedWriter: oldWriterEpoch, requestedGeneration: 9, want: workerCommandEpochReplace},
		{name: "active different writer same generation", state: "active", storedWriter: oldWriterEpoch, storedGeneration: 8, requestedWriter: newWriterEpoch, requestedGeneration: 8, want: workerCommandEpochReject},
		{name: "active different writer newer generation", state: "active", storedWriter: oldWriterEpoch, storedGeneration: 8, requestedWriter: newWriterEpoch, requestedGeneration: 9, want: workerCommandEpochReplace},
		{name: "active lower generation", state: "active", storedWriter: oldWriterEpoch, storedGeneration: 8, requestedWriter: newWriterEpoch, requestedGeneration: 7, want: workerCommandEpochReject},
		{name: "draining newer generation", state: "draining", storedWriter: oldWriterEpoch, storedGeneration: 8, requestedWriter: newWriterEpoch, requestedGeneration: 9, want: workerCommandEpochReject},
		{name: "closed newer generation", state: "closed", storedWriter: oldWriterEpoch, storedGeneration: 8, requestedWriter: newWriterEpoch, requestedGeneration: 9, want: workerCommandEpochReject},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			record := workerCommandEpochRecordV1{
				State: test.state, Epoch: logicalEpoch, RuntimeWriterEpoch: stringPointer(test.storedWriter), RuntimeGeneration: test.storedGeneration,
			}
			if got := classifyWorkerCommandEpochActivation(record, test.requestedWriter, test.requestedGeneration); got != test.want {
				t.Fatalf("classifyWorkerCommandEpochActivation() = %d, want %d", got, test.want)
			}
		})
	}
}

func TestWorkerCommandInfrastructureHorizons(t *testing.T) {
	if workerCommandMaxAge != 5*time.Minute || workerCommandDeadline != 5*time.Minute {
		t.Fatal("command deadline horizon changed")
	}
	if workerCommandPublicRetryDelay != 2*time.Minute || workerCommandNATSDuplicateWindow != 5*time.Minute {
		t.Fatal("transport retry/dedupe horizons changed")
	}
	if workerCommandReservedTTL != 30*time.Minute || workerCommandProviderInvokedTTL != time.Hour || workerCommandAmbiguousTTL != 24*time.Hour {
		t.Fatal("idempotency horizons changed")
	}
	if workerCommandLaneTTL != 15*time.Minute || workerCommandRecoveryTTL != 24*time.Hour || workerCommandScheduleOperationalTTL != 24*time.Hour {
		t.Fatal("operational horizons changed")
	}
	wantBackoff := []time.Duration{time.Second, 3 * time.Second, 10 * time.Second, 30 * time.Second, time.Minute, 2 * time.Minute}
	if len(workerCommandRedeliveryBackoff) != len(wantBackoff) {
		t.Fatal("redelivery backoff count changed")
	}
	if workerCommandMaximumTechnicalRetries != 6 || workerCommandLaneRecheckDelay != time.Second {
		t.Fatalf("retry contract changed: technical=%d lane_wait=%s", workerCommandMaximumTechnicalRetries, workerCommandLaneRecheckDelay)
	}
	if workerCommandConcurrentLanes != 32 || defaultProviderSendMaxInFlight != 4 {
		t.Fatalf("concurrency contract changed: lanes=%d provider=%d", workerCommandConcurrentLanes, defaultProviderSendMaxInFlight)
	}
	for index := range wantBackoff {
		if workerCommandRedeliveryBackoff[index] != wantBackoff[index] {
			t.Fatalf("redelivery backoff[%d] = %s, want %s", index, workerCommandRedeliveryBackoff[index], wantBackoff[index])
		}
	}
}

func workerCommandPayloadDigest(t *testing.T, value any) string {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(raw)
	return hex.EncodeToString(digest[:])
}
