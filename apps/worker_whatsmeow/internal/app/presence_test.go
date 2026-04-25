package app

import (
	"testing"

	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
)

func TestChatPresencePayloadMatchesChatTypingContract(t *testing.T) {
	cfg := Config{WorkerID: "worker-1", AccountID: "account-1"}
	chat := types.NewJID("5511999999999", types.DefaultUserServer)
	sender := types.NewJID("158733669765176", types.HiddenUserServer)

	payload, ok := chatPresencePayload(cfg, &events.ChatPresence{
		MessageSource: types.MessageSource{Chat: chat, Sender: sender},
		State:         types.ChatPresenceComposing,
		Media:         types.ChatPresenceMediaText,
	})
	if !ok {
		t.Fatal("expected typing payload")
	}
	if got := payload["type"]; got != "typing" {
		t.Fatalf("unexpected type %#v", got)
	}
	if got := payload["jid"]; got != "5511999999999@s.whatsapp.net" {
		t.Fatalf("unexpected jid %#v", got)
	}
	if got := payload["is_typing"]; got != true {
		t.Fatalf("expected is_typing=true, got %#v", got)
	}
	if got := payload["is_recording"]; got != false {
		t.Fatalf("expected is_recording=false, got %#v", got)
	}
	if got := payload["typing_state"]; got != "typing" {
		t.Fatalf("unexpected typing_state %#v", got)
	}
	if got := payload["account_id"]; got != "account-1" {
		t.Fatalf("unexpected account_id %#v", got)
	}
	if got := payload["worker_id"]; got != "worker-1" {
		t.Fatalf("unexpected worker_id %#v", got)
	}
}

func TestChatPresencePayloadMapsRecordingAndPaused(t *testing.T) {
	cfg := Config{WorkerID: "worker-1", AccountID: "account-1"}
	chat := types.NewJID("5511999999999", types.DefaultUserServer)

	payload, ok := chatPresencePayload(cfg, &events.ChatPresence{
		MessageSource: types.MessageSource{Chat: chat, Sender: chat},
		State:         types.ChatPresenceComposing,
		Media:         types.ChatPresenceMediaAudio,
	})
	if !ok {
		t.Fatal("expected recording payload")
	}
	if got := payload["is_typing"]; got != false {
		t.Fatalf("expected is_typing=false, got %#v", got)
	}
	if got := payload["is_recording"]; got != true {
		t.Fatalf("expected is_recording=true, got %#v", got)
	}
	if got := payload["typing_state"]; got != "recording" {
		t.Fatalf("unexpected typing_state %#v", got)
	}

	payload, ok = chatPresencePayload(cfg, &events.ChatPresence{
		MessageSource: types.MessageSource{Chat: chat, Sender: chat},
		State:         types.ChatPresencePaused,
	})
	if !ok {
		t.Fatal("expected paused payload")
	}
	if got := payload["is_typing"]; got != false {
		t.Fatalf("expected is_typing=false, got %#v", got)
	}
	if got := payload["is_recording"]; got != false {
		t.Fatalf("expected is_recording=false, got %#v", got)
	}
	if got := payload["typing_state"]; got != "available" {
		t.Fatalf("unexpected typing_state %#v", got)
	}
}

func TestChatPresencePayloadRejectsUnknownState(t *testing.T) {
	payload, ok := chatPresencePayload(Config{}, &events.ChatPresence{
		MessageSource: types.MessageSource{
			Chat: types.NewJID("5511999999999", types.DefaultUserServer),
		},
		State: types.ChatPresence("unknown"),
	})
	if ok {
		t.Fatalf("expected unknown state to be rejected, got %#v", payload)
	}
}
