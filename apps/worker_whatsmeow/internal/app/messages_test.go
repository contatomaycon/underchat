package app

import (
	"context"
	"errors"
	"testing"
	"time"

	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	"google.golang.org/protobuf/proto"
)

func TestResolveTargetJIDNormalizesChatAndPhone(t *testing.T) {
	jid, err := resolveTargetJID(ChatMessage{ChatID: "5511999999999@c.us"})
	if err != nil {
		t.Fatalf("resolve chat jid: %v", err)
	}
	if got := jid.String(); got != "5511999999999@s.whatsapp.net" {
		t.Fatalf("unexpected jid %q", got)
	}

	jid, err = resolveTargetJID(ChatMessage{
		PhoneDDI: "55",
		Phone:    "(11) 98888-7777",
	})
	if err != nil {
		t.Fatalf("resolve phone jid: %v", err)
	}
	if got := jid.String(); got != "5511988887777@s.whatsapp.net" {
		t.Fatalf("unexpected phone jid %q", got)
	}
}

func TestUnsupportedFeaturesFailExplicitly(t *testing.T) {
	manager := &WhatsAppManager{}
	target := types.NewJID("5511999999999", types.DefaultUserServer)

	_, err := manager.buildOutgoingMessage(context.Background(), nil, target, ChatMessage{
		Content: map[string]any{
			"type":    MessageTypeText,
			"buttons": []any{"legacy-button"},
		},
	})

	var unsupported UnsupportedFeatureError
	if !errors.As(err, &unsupported) {
		t.Fatalf("expected UnsupportedFeatureError, got %T %v", err, err)
	}
	if got := err.Error(); got != "unsupported_whatsmeow_feature:buttons" {
		t.Fatalf("unexpected error %q", got)
	}

	_, err = manager.buildOutgoingMessage(context.Background(), nil, target, ChatMessage{
		Content: map[string]any{
			"type":      MessageTypeText,
			"broadcast": map[string]any{"id": "list"},
		},
	})
	if !errors.As(err, &unsupported) {
		t.Fatalf("expected broadcast UnsupportedFeatureError, got %T %v", err, err)
	}
}

func TestBuildOutgoingTextWithQuotedMessageAndMentions(t *testing.T) {
	manager := &WhatsAppManager{}
	target := types.NewJID("5511999999999", types.DefaultUserServer)

	msg, err := manager.buildOutgoingMessage(context.Background(), nil, target, ChatMessage{
		Content: map[string]any{
			"type":          MessageTypeText,
			"message":       "ola @551188887777",
			"mentioned_jid": []any{"551188887777@s.whatsapp.net"},
			"quoted": map[string]any{
				"key": map[string]any{
					"id":         "quoted-id",
					"remote_jid": "5511999999999@s.whatsapp.net",
				},
				"message": "mensagem original",
			},
		},
	})
	if err != nil {
		t.Fatalf("build text: %v", err)
	}

	extended := msg.GetExtendedTextMessage()
	if extended == nil {
		t.Fatal("expected extended text message")
	}
	if got := extended.GetText(); got != "ola @551188887777" {
		t.Fatalf("unexpected text %q", got)
	}
	contextInfo := extended.GetContextInfo()
	if contextInfo == nil {
		t.Fatal("expected context info")
	}
	if got := contextInfo.GetStanzaID(); got != "quoted-id" {
		t.Fatalf("unexpected stanza id %q", got)
	}
	if mentions := contextInfo.GetMentionedJID(); len(mentions) != 1 || mentions[0] != "551188887777@s.whatsapp.net" {
		t.Fatalf("unexpected mentions %#v", mentions)
	}
}

func TestBuildOutgoingTextWithLinkPreview(t *testing.T) {
	manager := &WhatsAppManager{}
	target := types.NewJID("5511999999999", types.DefaultUserServer)

	msg, err := manager.buildOutgoingMessage(context.Background(), nil, target, ChatMessage{
		Content: map[string]any{
			"type":    MessageTypeText,
			"message": "https://example.com",
			"link_preview": map[string]any{
				"matched-text": "https://example.com",
				"title":        "Example",
				"description":  "Preview",
			},
		},
	})
	if err != nil {
		t.Fatalf("build text preview: %v", err)
	}
	extended := msg.GetExtendedTextMessage()
	if extended == nil {
		t.Fatal("expected extended text message")
	}
	if got := extended.GetMatchedText(); got != "https://example.com" {
		t.Fatalf("unexpected matched text %q", got)
	}
	if got := extended.GetTitle(); got != "Example" {
		t.Fatalf("unexpected title %q", got)
	}
}

func TestIncomingContentMapsCommonMessageTypes(t *testing.T) {
	manager := &WhatsAppManager{}

	messageType, content := manager.incomingContent(context.Background(), &events.Message{
		Message: &waE2E.Message{Conversation: proto.String("texto recebido")},
	})
	if messageType != MessageTypeText {
		t.Fatalf("unexpected text type %q", messageType)
	}
	if got := content["message"]; got != "texto recebido" {
		t.Fatalf("unexpected text content %#v", content)
	}

	messageType, content = manager.incomingContent(context.Background(), &events.Message{
		Message: &waE2E.Message{
			ProtocolMessage: &waE2E.ProtocolMessage{
				Type: waE2E.ProtocolMessage_REVOKE.Enum(),
			},
		},
	})
	if messageType != MessageTypeDelete {
		t.Fatalf("unexpected delete type %q", messageType)
	}
	if got := content["message"]; got != "Mensagem apagada" {
		t.Fatalf("unexpected delete content %#v", content)
	}

	messageType, content = manager.incomingContent(context.Background(), &events.Message{
		Message: &waE2E.Message{
			ProtocolMessage: &waE2E.ProtocolMessage{
				Type: waE2E.ProtocolMessage_HISTORY_SYNC_NOTIFICATION.Enum(),
			},
		},
	})
	if messageType != "" || content != nil {
		t.Fatalf("history sync protocol must not be mapped as user message: type=%q content=%#v", messageType, content)
	}
}

func TestBuildIncomingUpsertSkipsBaileysIgnoredEvents(t *testing.T) {
	manager := &WhatsAppManager{}
	userChat := types.NewJID("5511999999999", types.DefaultUserServer)

	tests := []struct {
		name string
		evt  *events.Message
	}{
		{
			name: "status broadcast",
			evt:  incomingTextEvent(types.StatusBroadcastJID, false, ""),
		},
		{
			name: "broadcast list",
			evt:  incomingTextEvent(types.NewJID("12345", types.BroadcastServer), false, ""),
		},
		{
			name: "group",
			evt:  incomingTextEvent(types.NewJID("12345", types.GroupServer), false, ""),
		},
		{
			name: "newsletter",
			evt:  incomingTextEvent(types.NewJID("12345", types.NewsletterServer), false, ""),
		},
		{
			name: "peer category",
			evt:  incomingTextEvent(userChat, false, "peer"),
		},
		{
			name: "history sync protocol",
			evt: &events.Message{
				Info: types.MessageInfo{
					MessageSource: types.MessageSource{
						Chat:     userChat,
						Sender:   userChat,
						IsFromMe: true,
					},
					ID:        "history-sync",
					Timestamp: time.Unix(1, 0),
				},
				Message: &waE2E.Message{
					ProtocolMessage: &waE2E.ProtocolMessage{
						Type: waE2E.ProtocolMessage_HISTORY_SYNC_NOTIFICATION.Enum(),
					},
				},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			upsert, err := manager.buildIncomingUpsert(context.Background(), tt.evt)
			if err != nil {
				t.Fatalf("buildIncomingUpsert returned error: %v", err)
			}
			if upsert != nil {
				t.Fatalf("expected event to be skipped, got %#v", upsert)
			}
		})
	}

	upsert, err := manager.buildIncomingUpsert(context.Background(), incomingTextEvent(userChat, false, ""))
	if err != nil {
		t.Fatalf("build normal text: %v", err)
	}
	if upsert == nil || upsert.Type != MessageTypeText {
		t.Fatalf("expected normal user text to be mapped, got %#v", upsert)
	}
}

func TestBuildIncomingUpsertSetsRemoteJIDAltForLIDChat(t *testing.T) {
	manager := &WhatsAppManager{}
	lidChat := types.NewJID("158733669765176", types.HiddenUserServer)
	pnChat := types.NewJID("556195999040", types.DefaultUserServer)

	incoming := incomingTextEvent(lidChat, false, "")
	incoming.Info.SenderAlt = pnChat

	upsert, err := manager.buildIncomingUpsert(context.Background(), incoming)
	if err != nil {
		t.Fatalf("build incoming lid upsert: %v", err)
	}
	if upsert == nil {
		t.Fatal("expected incoming lid upsert")
	}
	key, ok := upsert.Message["key"].(map[string]any)
	if !ok {
		t.Fatalf("unexpected key payload %#v", upsert.Message["key"])
	}
	if got := key["remoteJid"]; got != "158733669765176@lid" {
		t.Fatalf("unexpected remoteJid %#v", got)
	}
	if got := key["remoteJidAlt"]; got != "556195999040@s.whatsapp.net" {
		t.Fatalf("unexpected remoteJidAlt %#v", got)
	}
}

func TestIncomingProfilePhotoJIDsPreferPhoneAliasForLIDChat(t *testing.T) {
	lidChat := types.NewJID("158733669765176", types.HiddenUserServer)
	pnChat := types.JID{User: "556195999040", Server: types.DefaultUserServer, Device: 84}

	incoming := incomingTextEvent(lidChat, false, "")
	incoming.Info.SenderAlt = pnChat

	got := incomingProfilePhotoJIDs(incoming)
	if len(got) != 2 {
		t.Fatalf("unexpected candidates %#v", got)
	}
	if got[0].String() != "556195999040@s.whatsapp.net" {
		t.Fatalf("expected phone alias first, got %q", got[0].String())
	}
	if got[1].String() != "158733669765176@lid" {
		t.Fatalf("expected lid fallback second, got %q", got[1].String())
	}
}

func TestIncomingProfilePhotoJIDsPreferRecipientAliasForOwnLIDMessage(t *testing.T) {
	lidChat := types.NewJID("158733669765176", types.HiddenUserServer)
	pnChat := types.JID{User: "556195999040", Server: types.DefaultUserServer, Device: 84}

	incoming := incomingTextEvent(lidChat, true, "")
	incoming.Info.RecipientAlt = pnChat

	got := incomingProfilePhotoJIDs(incoming)
	if len(got) != 2 {
		t.Fatalf("unexpected candidates %#v", got)
	}
	if got[0].String() != "556195999040@s.whatsapp.net" {
		t.Fatalf("expected recipient phone alias first, got %q", got[0].String())
	}
	if got[1].String() != "158733669765176@lid" {
		t.Fatalf("expected lid fallback second, got %q", got[1].String())
	}
}

func TestIncomingProfilePhotoCacheKeyStripsDevice(t *testing.T) {
	jid := types.JID{User: "556195999040", Server: types.DefaultUserServer, Device: 84}

	if got := incomingProfilePhotoCacheKey(jid); got != "photo:jid:556195999040@s.whatsapp.net" {
		t.Fatalf("unexpected cache key %q", got)
	}
}

func incomingTextEvent(chat types.JID, fromMe bool, category string) *events.Message {
	return &events.Message{
		Info: types.MessageInfo{
			MessageSource: types.MessageSource{
				Chat:     chat,
				Sender:   chat,
				IsFromMe: fromMe,
			},
			ID:        "message-id",
			Timestamp: time.Unix(1, 0),
			Category:  category,
		},
		Message: &waE2E.Message{Conversation: proto.String("texto recebido")},
	}
}

func TestMapToChatMessagePreservesRawPayload(t *testing.T) {
	data, err := mapToChatMessage([]byte(`{"message_id":"m1","chat_id":"5511999999999@s.whatsapp.net","content":{"type":"text","message":"ok"}}`))
	if err != nil {
		t.Fatalf("map payload: %v", err)
	}
	if data.MessageID != "m1" || data.ChatID != "5511999999999@s.whatsapp.net" {
		t.Fatalf("unexpected chat message %#v", data)
	}
	if got := stringValue(data.Content["message"]); got != "ok" {
		t.Fatalf("unexpected content message %q", got)
	}
	if got := stringValue(data.Raw["message_id"]); got != "m1" {
		t.Fatalf("raw payload was not preserved: %#v", data.Raw)
	}
}

func TestMapsProfileStatusAndProfileInfoPayloads(t *testing.T) {
	status, ok, err := mapToProfileStatusMessage([]byte(`{"worker_id":"w1","account_id":"a1","worker_profile_status_id":"s1","worker_profile_status_type_id":"019a9d00-0001-7000-8000-000000000001","value":"ola"}`))
	if err != nil || !ok {
		t.Fatalf("expected profile status payload ok=%v err=%v", ok, err)
	}
	if status.WorkerProfileStatusID != "s1" || status.Value != "ola" {
		t.Fatalf("unexpected status %#v", status)
	}

	deleteStatus, ok, err := mapToProfileStatusDeleteMessage([]byte(`{"worker_id":"w1","account_id":"a1","worker_profile_status_id":"s1","external_id":"ext1"}`))
	if err != nil || !ok {
		t.Fatalf("expected delete status payload ok=%v err=%v", ok, err)
	}
	if deleteStatus.ExternalID != "ext1" {
		t.Fatalf("unexpected delete status %#v", deleteStatus)
	}

	profileInfo, ok, err := mapToProfileInfoMessage([]byte(`{"worker_id":"w1","account_id":"a1","message":"about","photo":null}`))
	if err != nil || !ok {
		t.Fatalf("expected profile info payload ok=%v err=%v", ok, err)
	}
	if !profileInfo.PhotoPresent || !profileInfo.PhotoRemove {
		t.Fatalf("expected profile photo removal flags %#v", profileInfo)
	}
}
