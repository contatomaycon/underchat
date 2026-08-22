package app

import (
	"encoding/json"
	"testing"
)

func TestMessageStatusIdentityIsProviderNeutral(t *testing.T) {
	left := MessageStatusUpdate{
		AccountID:         "account-1",
		WorkerID:          "worker-1",
		SourceProvider:    "whatsmeow",
		RuntimeGeneration: 7,
		ConnectionEpoch:   "meow-epoch",
		MessageID:         "message-1",
		Patch:             map[string]any{"is_seen": true},
	}
	right := left
	right.SourceProvider = "wwebjs"
	right.RuntimeGeneration = 8
	right.ConnectionEpoch = "browser-epoch"

	leftID := ensureMessageStatusEventID(&left)
	rightID := ensureMessageStatusEventID(&right)
	if leftID != rightID {
		t.Fatalf("provider metadata changed status identity: %q != %q", leftID, rightID)
	}
	const expected = "message_status_v1_7a937446652d77c43924dca720c0125c939d42aea1a2cf7f7df02ab47392d56c"
	if leftID != expected {
		t.Fatalf("Go identity diverged from shared TypeScript contract: %q", leftID)
	}

	serialized := left
	serialized.EventID = ""
	serialized.MessageID = "true_5511999999999@s.whatsapp.net_message-1"
	if got := ensureMessageStatusEventID(&serialized); got != expected {
		t.Fatalf("serialized status message id did not canonicalize: %q", got)
	}
	if got := messageStatusKafkaKey(
		"account-1",
		"worker-1",
		"true_5511999999999@s.whatsapp.net_message-1",
	); got != "account-1:worker-1:message-1" {
		t.Fatalf("serialized status Kafka key did not canonicalize: %q", got)
	}
}

func TestFailedMessageStatusCarriesInternalMessageIDContract(t *testing.T) {
	const internalMessageID = "019fca38-01e2-7f99-b6f6-a133b093ccd2"
	update := newMessageNotSentStatusUpdate(
		"worker-1",
		"account-1",
		whatsAppRuntimeFence{
			State:             "active",
			WorkerID:          "worker-1",
			RuntimeGeneration: 7,
			ConnectionEpoch:   "epoch-1",
			SourceProvider:    "whatsmeow",
		},
		internalMessageID,
		"5511999999999@s.whatsapp.net",
	)

	raw, err := json.Marshal(update)
	if err != nil {
		t.Fatalf("marshal failed status: %v", err)
	}
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatalf("unmarshal failed status: %v", err)
	}
	if got := payload["internal_message_id"]; got != internalMessageID {
		t.Fatalf("failed status lost internal_message_id: %#v", got)
	}
	if got := payload["message_id"]; got != internalMessageID {
		t.Fatalf("failed status changed message_id compatibility field: %#v", got)
	}
	if got := payload["failed"]; got != true {
		t.Fatalf("failed status lost terminal marker: %#v", got)
	}
}

func TestAmbiguousMessageStatusMatchesCrossProviderIdentityContract(t *testing.T) {
	const internalMessageID = "019fca38-01e2-7f99-b6f6-a133b093ccd2"
	update := newMessageAmbiguousStatusUpdate(
		"worker-1",
		"account-1",
		whatsAppRuntimeFence{
			State:             "active",
			WorkerID:          "worker-1",
			RuntimeGeneration: 7,
			ConnectionEpoch:   "epoch-1",
			SourceProvider:    "whatsmeow",
		},
		internalMessageID,
		"5511999999999@s.whatsapp.net",
	)

	const expectedEventID = "message_status_v1_eb69eadc0397495251a77df8a4d46cb2e4a64dc4e5e02822e9c18bbf4a5bb59b"
	if update.EventID != expectedEventID {
		t.Fatalf("Go ambiguous identity diverged from TypeScript vector: %q", update.EventID)
	}
	if !update.Failed ||
		!update.Ambiguous ||
		update.TerminalFailureSchema != messageSendAmbiguousTerminalSchema ||
		update.MessageID != internalMessageID ||
		update.InternalMessageID != internalMessageID ||
		len(update.Patch) != 0 {
		t.Fatalf("invalid ambiguous terminal contract: %#v", update)
	}

	raw, err := json.Marshal(update)
	if err != nil {
		t.Fatal(err)
	}
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatal(err)
	}
	if payload["failed"] != true || payload["ambiguous"] != true {
		t.Fatalf("ambiguous terminal flags were not serialized: %#v", payload)
	}
}
