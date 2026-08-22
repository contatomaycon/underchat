package app

import (
	"encoding/json"
	"math"
	"testing"
	"time"
)

func TestInboundSpoolRawPayloadAcceptsRedisStringAndBytes(t *testing.T) {
	for name, value := range map[string]any{
		"string": `{"worker_id":"worker-1"}`,
		"bytes":  []byte(`{"worker_id":"worker-1"}`),
	} {
		t.Run(name, func(t *testing.T) {
			raw, ok := inboundSpoolRawPayload(value)
			if !ok || raw != `{"worker_id":"worker-1"}` {
				t.Fatalf("unexpected Redis payload raw=%q ok=%t", raw, ok)
			}
		})
	}
	if _, ok := inboundSpoolRawPayload(17); ok {
		t.Fatal("unsupported Redis payload type was accepted")
	}
}

func TestRehomeInboundSpoolPayloadTransfersFenceAndResetsRetry(t *testing.T) {
	active := whatsAppRuntimeFence{
		State:             "active",
		WorkerID:          "worker-1",
		RuntimeGeneration: 8,
		ConnectionEpoch:   "epoch-b",
		SourceProvider:    "whatsmeow",
	}
	// runtime_generation is deliberately a string: this was the historical
	// TypeScript wire shape stored in retry-payloads.
	raw := `{
		"provider":"whatsmeow",
		"source_provider":"whatsmeow",
		"account_id":"account-1",
		"worker_id":"worker-1",
		"runtime_generation":"7",
		"connection_epoch":"epoch-a",
		"event_source":"incoming_message",
		"dedupe_key":"waevt_v1_stable",
		"kafka_topic":"message.upsert",
		"kafka_key":"chat-1",
		"upsert":{
			"event_id":"waevt_v1_stable",
			"worker_id":"worker-1",
			"account_id":"account-1",
			"source_provider":"whatsmeow",
			"runtime_generation":"7",
			"connection_epoch":"epoch-a",
			"type":"text",
			"message":{"key":{"id":"message-1","remoteJid":"5511999999999@s.whatsapp.net"},"messageTimestamp":1784570400}
		},
		"received_at":"2026-07-20T19:00:00Z",
		"attempts":4,
		"next_attempt_at":9999999999999,
		"last_error":"kafka unavailable"
	}`

	payload, encoded, err := rehomeInboundSpoolPayload(raw, active, "worker-1")
	if err != nil {
		t.Fatalf("rehome payload: %v", err)
	}
	if payload.RuntimeGeneration != 8 || payload.ConnectionEpoch != "epoch-b" {
		t.Fatalf("top-level fence was not transferred: %+v", payload)
	}
	if payload.Upsert == nil || payload.Upsert.RuntimeGeneration != 8 || payload.Upsert.ConnectionEpoch != "epoch-b" {
		t.Fatalf("upsert fence was not transferred: %+v", payload.Upsert)
	}
	if payload.Attempts != 0 || payload.NextAttemptAt != 0 || payload.LastError != "" {
		t.Fatalf("obsolete retry delay survived transfer: %+v", payload)
	}
	if payload.DedupeKey != "waevt_v1_stable" || payload.Upsert.EventID != "waevt_v1_stable" {
		t.Fatalf("stable identity changed during transfer: %+v", payload)
	}

	var wire map[string]any
	if err := json.Unmarshal([]byte(encoded), &wire); err != nil {
		t.Fatalf("encoded payload is invalid: %v", err)
	}
	if _, exists := wire["next_attempt_at"]; exists {
		t.Fatal("encoded payload retained obsolete next_attempt_at")
	}
	if _, exists := wire["last_error"]; exists {
		t.Fatal("encoded payload retained obsolete last_error")
	}
}

func TestObsoleteWhatsmeowInboundScopePrefixRecognizesLegacyAndScopedRetry(t *testing.T) {
	manager := &WhatsAppManager{cfg: Config{WorkerID: "worker-1"}}
	active := whatsAppRuntimeFence{RuntimeGeneration: 8, ConnectionEpoch: "epoch-b"}

	for _, key := range []string{
		"inbound:message:whatsmeow:worker-1:retry",
		"inbound:message:whatsmeow:worker-1:retry-payloads",
		"inbound:message:whatsmeow:worker-1:generation:7:epoch:epoch-a:retry",
		"inbound:message:whatsmeow:worker-1:generation:7:epoch:epoch:a:retry-payloads",
	} {
		if _, ok := manager.obsoleteWhatsmeowInboundScopePrefix(key, active); !ok {
			t.Fatalf("obsolete WhatsMeow key was not recognized: %s", key)
		}
	}
	for _, key := range []string{
		manager.inboundSpoolRetrySetKey(active),
		manager.inboundSpoolRetryPayloadHashKey(active),
		"inbound:message:baileys:worker-1:generation:7:epoch:epoch-a:retry",
		"inbound:message:whatsmeow:worker-10:generation:7:epoch:epoch-a:retry",
	} {
		if _, ok := manager.obsoleteWhatsmeowInboundScopePrefix(key, active); ok {
			t.Fatalf("non-obsolete/foreign key was accepted: %s", key)
		}
	}
}

func TestInboundSpoolRetryNeverExhaustsAndBackoffStaysBounded(t *testing.T) {
	attempts := 0
	for range 13 {
		attempts = saturatingInboundSpoolAttempt(attempts)
	}
	if attempts != 13 {
		t.Fatalf("retry attempts = %d, want 13", attempts)
	}
	if delay := inboundSpoolRetryDelay(attempts); delay != whatsmeowInboundSpoolMaxDelay {
		t.Fatalf("retry delay = %s, want capped %s", delay, whatsmeowInboundSpoolMaxDelay)
	}
	if got := saturatingInboundSpoolAttempt(math.MaxInt); got != math.MaxInt {
		t.Fatalf("saturated retry counter wrapped: got %d", got)
	}
	if delay := inboundSpoolRetryDelay(math.MaxInt); delay != whatsmeowInboundSpoolMaxDelay {
		t.Fatalf("huge retry delay = %s, want capped %s", delay, whatsmeowInboundSpoolMaxDelay)
	}
}

func TestRehomeInboundParkingPayloadRestoresDurableRetryIdentity(t *testing.T) {
	active := whatsAppRuntimeFence{
		State:             "active",
		WorkerID:          "worker-1",
		RuntimeGeneration: 9,
		ConnectionEpoch:   "epoch-c",
		SourceProvider:    "whatsmeow",
	}
	parked := inboundMessageParkingPayload{
		Provider:    "whatsmeow",
		AccountID:   "account-1",
		WorkerID:    "worker-1",
		EventSource: "incoming_message",
		Reason:      "retry_exhausted",
		Stage:       "whatsmeow.inbound_spool.publish",
		ParkedAt:    time.Now().UTC().Format(time.RFC3339Nano),
		KafkaTopic:  topicUpsertMessage,
		KafkaKey:    "chat-1",
		RetryCount:  12,
		Upsert: &UpsertMessage{
			EventID:           "waevt_v1_stable",
			AccountID:         "account-1",
			WorkerID:          "worker-1",
			SourceProvider:    "whatsmeow",
			RuntimeGeneration: 7,
			ConnectionEpoch:   "epoch-a",
			Type:              MessageTypeText,
			Message: map[string]any{
				"key": map[string]any{
					"id":        "message-1",
					"remoteJid": "5511999999999@s.whatsapp.net",
				},
			},
		},
		RawMeta: map[string]any{"event_id": "waevt_v1_stable", "chat": "chat-1"},
	}
	raw, err := json.Marshal(parked)
	if err != nil {
		t.Fatal(err)
	}

	payload, encoded, err := rehomeInboundParkingPayload(string(raw), active, "worker-1")
	if err != nil {
		t.Fatalf("rehome parking payload: %v", err)
	}
	if payload.RuntimeGeneration != active.RuntimeGeneration ||
		payload.ConnectionEpoch != active.ConnectionEpoch ||
		payload.Upsert == nil ||
		payload.Upsert.RuntimeGeneration != active.RuntimeGeneration ||
		payload.Upsert.ConnectionEpoch != active.ConnectionEpoch {
		t.Fatalf("parking payload retained obsolete authority: %+v", payload)
	}
	if payload.DedupeKey != "waevt_v1_stable" ||
		payload.Upsert.EventID != "waevt_v1_stable" ||
		payload.Attempts != 0 ||
		payload.NextAttemptAt != 0 {
		t.Fatalf("parking payload lost retry identity: %+v", payload)
	}
	var roundTrip InboundMessageSpoolPayload
	if err := json.Unmarshal([]byte(encoded), &roundTrip); err != nil {
		t.Fatalf("encoded parking retry is invalid: %v", err)
	}
	if roundTrip.DedupeKey != payload.DedupeKey {
		t.Fatalf("encoded parking retry identity changed: %+v", roundTrip)
	}
}

func TestRehomeInboundParkingPayloadRejectsInvalidProviderData(t *testing.T) {
	active := whatsAppRuntimeFence{
		State:             "active",
		WorkerID:          "worker-1",
		RuntimeGeneration: 9,
		ConnectionEpoch:   "epoch-c",
		SourceProvider:    "whatsmeow",
	}
	for name, raw := range map[string]string{
		"malformed":        `{`,
		"foreign worker":   `{"provider":"whatsmeow","worker_id":"worker-2"}`,
		"foreign provider": `{"provider":"baileys","worker_id":"worker-1"}`,
		"missing upsert":   `{"provider":"whatsmeow","worker_id":"worker-1","account_id":"account-1","kafka_topic":"message.upsert"}`,
	} {
		t.Run(name, func(t *testing.T) {
			if _, _, err := rehomeInboundParkingPayload(raw, active, "worker-1"); err == nil {
				t.Fatal("invalid provider parking payload was accepted")
			}
		})
	}
}
