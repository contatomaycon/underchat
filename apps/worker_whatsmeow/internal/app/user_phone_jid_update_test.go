package app

import (
	"encoding/json"
	"testing"
)

func TestNotificationMessageDecodesProducerOperationID(t *testing.T) {
	var data NotificationMessage
	if err := json.Unmarshal(
		[]byte(`{"operation_id":"operation-1","notification_id":"notification-1","message_whatsapp":"hello"}`),
		&data,
	); err != nil {
		t.Fatal(err)
	}
	if data.OperationID != "operation-1" {
		t.Fatalf("producer operation_id was not decoded: %#v", data)
	}
}

func TestUserPhoneJIDUpdateCarriesRuntimeFenceAndStableOperationIdentity(t *testing.T) {
	data := NotificationMessage{
		OperationID:     "notification-operation-1",
		UserID:          "user-1",
		NotificationID:  "notification-1",
		MessageWhatsApp: "hello",
	}
	data.MessageKey.PhoneDDI = "55"
	data.MessageKey.PhoneNumber = "11999999999"
	scope := whatsAppRuntimeFence{
		State:              "active",
		WorkerID:           "worker-1",
		RuntimeGeneration:  7,
		ConnectionEpoch:    "epoch-1",
		ConnectionSequence: 1,
		SourceProvider:     "whatsmeow",
		ActivatedAt:        1_700_000_000_000,
		ActivationOrder:    1,
	}

	update := buildUserPhoneJIDUpdate(
		data,
		"account-1",
		"5511999999999@s.whatsapp.net",
		scope,
	)
	if update.EventID == "" {
		t.Fatal("user phone JID update is missing event_id")
	}
	if update.OperationID != "notification-operation-1" {
		t.Fatalf("unexpected operation_id %q", update.OperationID)
	}
	if update.AccountID != "account-1" ||
		update.WorkerID != "worker-1" ||
		update.SourceProvider != "whatsmeow" ||
		update.RuntimeGeneration != 7 ||
		update.ConnectionEpoch != "epoch-1" ||
		update.UserID != "user-1" ||
		update.PhoneJID != "5511999999999@s.whatsapp.net" {
		t.Fatalf("unexpected fenced JID update: %#v", update)
	}
	if got := userPhoneJIDUpdateKafkaKey(update); got != "user-1" {
		t.Fatalf("Kafka key must remain user_id, got %q", got)
	}
}

func TestUserPhoneJIDUpdateEventIDSurvivesRetryAndReconnect(t *testing.T) {
	data := NotificationMessage{
		OperationID:     "notification-operation-1",
		UserID:          "user-1",
		NotificationID:  "notification-1",
		MessageWhatsApp: "original content",
	}
	firstScope := whatsAppRuntimeFence{
		State:              "active",
		WorkerID:           "worker-1",
		RuntimeGeneration:  7,
		ConnectionEpoch:    "epoch-1",
		ConnectionSequence: 1,
		SourceProvider:     "whatsmeow",
		ActivatedAt:        1_700_000_000_000,
		ActivationOrder:    1,
	}
	first := buildUserPhoneJIDUpdate(
		data,
		"account-1",
		"5511999999999:7@s.whatsapp.net",
		firstScope,
	)

	retry := data
	retry.MessageWhatsApp = "content changed but operation is unchanged"
	secondScope := firstScope
	secondScope.RuntimeGeneration = 8
	secondScope.ConnectionEpoch = "epoch-2"
	second := buildUserPhoneJIDUpdate(
		retry,
		"account-1",
		"5511999999999@s.whatsapp.net",
		secondScope,
	)
	if first.EventID == "" || first.EventID != second.EventID {
		t.Fatalf(
			"retry/reconnect changed operational event identity: %q != %q",
			first.EventID,
			second.EventID,
		)
	}
	if second.RuntimeGeneration != 8 || second.ConnectionEpoch != "epoch-2" {
		t.Fatalf("retry did not carry the current runtime fence: %#v", second)
	}

	distinct := retry
	distinct.OperationID = "notification-operation-2"
	third := buildUserPhoneJIDUpdate(
		distinct,
		"account-1",
		"5511999999999@s.whatsapp.net",
		secondScope,
	)
	if third.EventID == "" || third.EventID == first.EventID {
		t.Fatal("distinct notification operations share a user phone JID event_id")
	}
}

func TestUserPhoneJIDUpdateEventIDMatchesTypeScriptVector(t *testing.T) {
	const expected = "user_phone_jid_v1_022b41780e3419b670417891925d485df26609cf21b44ce0437ce2053c8d925d"
	got := userPhoneJIDUpdateEventID(
		"account-1",
		"worker-1",
		"user-1",
		"5511999999999:21@c.us",
		"operation-1",
	)
	if got != expected {
		t.Fatalf("cross-runtime event id mismatch: want %q got %q", expected, got)
	}
}
