package app

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/color"
	"image/jpeg"
	"log"
	"strings"
	"testing"
	"time"

	"go.mau.fi/whatsmeow/proto/waCommon"
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
	if contextInfo.GetQuotedMessage().GetConversation() != "mensagem original" {
		t.Fatalf("unexpected quoted message %#v", contextInfo.GetQuotedMessage())
	}
	if mentions := contextInfo.GetMentionedJID(); len(mentions) != 1 || mentions[0] != "551188887777@s.whatsapp.net" {
		t.Fatalf("unexpected mentions %#v", mentions)
	}
}

func TestBuildOutgoingQuotedImageContext(t *testing.T) {
	manager := &WhatsAppManager{}
	target := types.NewJID("5511999999999", types.DefaultUserServer)

	msg, err := manager.buildOutgoingMessage(context.Background(), nil, target, ChatMessage{
		Content: map[string]any{
			"type":    MessageTypeText,
			"message": "respondendo foto",
			"quoted": map[string]any{
				"type": MessageTypeImage,
				"key": map[string]any{
					"id":          "image-quoted-id",
					"remote_jid":  "5511999999999@s.whatsapp.net",
					"participant": "5511999999999@s.whatsapp.net",
				},
				"message": "legenda original",
				"image": map[string]any{
					"caption":   "legenda original",
					"mimetype":  "image/jpeg",
					"size":      12,
					"height":    40,
					"width":     30,
					"thumbnail": "data:image/jpeg;base64,AQID",
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("build quoted image text: %v", err)
	}

	quoted := msg.GetExtendedTextMessage().GetContextInfo().GetQuotedMessage().GetImageMessage()
	if quoted == nil {
		t.Fatal("expected quoted image message")
	}
	if got := quoted.GetCaption(); got != "legenda original" {
		t.Fatalf("unexpected quoted caption %q", got)
	}
	if got := quoted.GetMimetype(); got != "image/jpeg" {
		t.Fatalf("unexpected quoted mimetype %q", got)
	}
	if got := quoted.GetFileLength(); got != 12 {
		t.Fatalf("unexpected quoted size %d", got)
	}
	if got := quoted.GetHeight(); got != 40 {
		t.Fatalf("unexpected quoted height %d", got)
	}
	if len(quoted.GetJPEGThumbnail()) != 3 {
		t.Fatalf("expected quoted thumbnail bytes, got %#v", quoted.GetJPEGThumbnail())
	}
}

func TestBuildOutgoingForwardedTextContext(t *testing.T) {
	tests := []struct {
		name      string
		content   map[string]any
		wantScore uint32
	}{
		{
			name: "forward payload uses provided forwarding score",
			content: map[string]any{
				"type":    MessageTypeText,
				"message": "encaminhada",
				"forward": map[string]any{
					"source_message_id": "source-1",
				},
				"context_info": map[string]any{
					"forwarding_score": 3,
				},
			},
			wantScore: 3,
		},
		{
			name: "context forwarded flag defaults score",
			content: map[string]any{
				"type":    MessageTypeText,
				"message": "encaminhada",
				"context_info": map[string]any{
					"is_forwarded": true,
				},
			},
			wantScore: 1,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			manager := &WhatsAppManager{}
			target := types.NewJID("5511999999999", types.DefaultUserServer)

			msg, err := manager.buildOutgoingMessage(context.Background(), nil, target, ChatMessage{
				Content: tt.content,
			})
			if err != nil {
				t.Fatalf("build forwarded text: %v", err)
			}

			extended := msg.GetExtendedTextMessage()
			if extended == nil {
				t.Fatal("expected extended text message")
			}
			if got := extended.GetText(); got != "encaminhada" {
				t.Fatalf("unexpected text %q", got)
			}

			contextInfo := extended.GetContextInfo()
			if contextInfo == nil {
				t.Fatal("expected context info")
			}
			if !contextInfo.GetIsForwarded() {
				t.Fatal("expected forwarded context")
			}
			if got := contextInfo.GetForwardingScore(); got != tt.wantScore {
				t.Fatalf("unexpected forwarding score %d", got)
			}
		})
	}
}

func TestOutgoingAudioPTTDefaultsLikeBaileys(t *testing.T) {
	tests := []struct {
		name     string
		media    map[string]any
		viewOnce bool
		want     bool
	}{
		{name: "default true", media: map[string]any{}, want: true},
		{name: "explicit ptt true", media: map[string]any{"ptt": true}, want: true},
		{name: "explicit ptt false", media: map[string]any{"ptt": false}, want: false},
		{name: "string false", media: map[string]any{"ptt": "false"}, want: false},
		{name: "legacy is_voice", media: map[string]any{"is_voice": true}, want: true},
		{name: "view once forces ptt", media: map[string]any{"ptt": false}, viewOnce: true, want: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := outgoingAudioPTT(tt.media, tt.viewOnce); got != tt.want {
				t.Fatalf("unexpected ptt: got %t want %t", got, tt.want)
			}
		})
	}
}

func TestOutgoingMediaMimetypeCanonicalizesAudioAndVideo(t *testing.T) {
	tests := []struct {
		name            string
		contentKey      string
		media           map[string]any
		httpContentType string
		ptt             bool
		want            string
	}{
		{
			name:            "ptt audio ignores legacy mobile mime",
			contentKey:      "audio",
			media:           map[string]any{"mimetype": "audio/mp4"},
			httpContentType: "application/octet-stream",
			ptt:             true,
			want:            "audio/ogg; codecs=opus",
		},
		{
			name:            "regular audio is mp3",
			contentKey:      "audio",
			media:           map[string]any{"mimetype": "audio/ogg"},
			httpContentType: "audio/ogg",
			ptt:             false,
			want:            "audio/mpeg",
		},
		{
			name:            "video ignores quicktime and generic http",
			contentKey:      "video",
			media:           map[string]any{"mimetype": "video/quicktime"},
			httpContentType: "application/octet-stream",
			want:            "video/mp4",
		},
		{
			name:            "document preserves useful declared mime",
			contentKey:      "document",
			media:           map[string]any{"mimetype": "application/pdf"},
			httpContentType: "application/octet-stream",
			want:            "application/pdf",
		},
		{
			name:            "document falls back when only generic mime exists",
			contentKey:      "document",
			media:           map[string]any{},
			httpContentType: "application/octet-stream",
			want:            "application/octet-stream",
		},
		{
			name:            "image uses useful http mime",
			contentKey:      "image",
			media:           map[string]any{},
			httpContentType: "image/png",
			want:            "image/png",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := outgoingMediaMimetype(tt.contentKey, tt.media, tt.httpContentType, tt.ptt); got != tt.want {
				t.Fatalf("unexpected mimetype: got %q want %q", got, tt.want)
			}
		})
	}
}

func TestQuotedAudioDefaultsToPTT(t *testing.T) {
	quoted := quotedMessageForContext(map[string]any{
		"type": MessageTypeAudio,
		"audio": map[string]any{
			"duration": 3,
			"mimetype": "audio/ogg; codecs=opus",
			"waveform": "AQID",
		},
	})

	audio := quoted.GetAudioMessage()
	if audio == nil {
		t.Fatal("expected quoted audio message")
	}
	if !audio.GetPTT() {
		t.Fatal("expected quoted audio to default to ptt")
	}
	if got := audio.GetSeconds(); got != 3 {
		t.Fatalf("unexpected duration %d", got)
	}
	if got := audio.GetWaveform(); len(got) != 3 {
		t.Fatalf("unexpected waveform %#v", got)
	}
}

func TestBuildOutgoingTextEditFromLatestVersion(t *testing.T) {
	manager := &WhatsAppManager{}
	target := types.NewJID("5511999999999", types.DefaultUserServer)
	fromMe := true

	msg, err := manager.buildOutgoingMessage(context.Background(), nil, target, ChatMessage{
		MessageKey: &MessageKey{
			RemoteJID: "5511999999999@s.whatsapp.net",
			FromMe:    &fromMe,
			ID:        "original-wa-id",
		},
		Content: map[string]any{
			"type":    MessageTypeText,
			"message": "texto 1",
			"version": []any{
				map[string]any{
					"type":    MessageTypeText,
					"message": "texto 1",
					"date":    "2026-04-25T17:00:00Z",
				},
				map[string]any{
					"type":    MessageTypeText,
					"message": "texto 2",
					"date":    "2026-04-25T17:01:00Z",
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("build text edit: %v", err)
	}

	protocol := msg.GetEditedMessage().GetMessage().GetProtocolMessage()
	if protocol == nil {
		t.Fatal("expected protocol edit message")
	}
	if got := protocol.GetType(); got != waE2E.ProtocolMessage_MESSAGE_EDIT {
		t.Fatalf("unexpected protocol type %v", got)
	}
	if got := protocol.GetKey().GetID(); got != "original-wa-id" {
		t.Fatalf("unexpected edit target id %q", got)
	}
	if got := protocol.GetEditedMessage().GetConversation(); got != "texto 2" {
		t.Fatalf("unexpected edited text %q", got)
	}
}

func TestBuildOutgoingTextEditRejectsNonOwnMessage(t *testing.T) {
	manager := &WhatsAppManager{}
	target := types.NewJID("5511999999999", types.DefaultUserServer)
	fromMe := false

	_, err := manager.buildOutgoingMessage(context.Background(), nil, target, ChatMessage{
		MessageKey: &MessageKey{
			RemoteJID: "5511999999999@s.whatsapp.net",
			FromMe:    &fromMe,
			ID:        "original-wa-id",
		},
		Content: map[string]any{
			"type": MessageTypeText,
			"version": []any{map[string]any{
				"type":    MessageTypeText,
				"message": "texto 2",
				"date":    "2026-04-25T17:01:00Z",
			}},
		},
	})
	if err == nil || !strings.Contains(err.Error(), "non-own message") {
		t.Fatalf("expected non-own edit error, got %v", err)
	}
}

func TestChatMessageClaimIDPrefersHashForEdits(t *testing.T) {
	got := chatMessageClaimID(ChatMessage{MessageID: "same-message-id", Hash: "edit-hash"})
	if got != "hash:edit-hash" {
		t.Fatalf("expected hash claim id, got %q", got)
	}

	got = chatMessageClaimID(ChatMessage{MessageID: "message-id"})
	if got != "message:message-id" {
		t.Fatalf("expected message claim id, got %q", got)
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

	messageType, content = manager.incomingContent(context.Background(), &events.Message{
		Message: &waE2E.Message{
			ProtocolMessage: &waE2E.ProtocolMessage{
				Type: waE2E.ProtocolMessage_BOT_FEEDBACK_MESSAGE.Enum(),
			},
		},
	})
	if messageType != MessageTypeSystem {
		t.Fatalf("unknown protocol must map to system fallback, got %q", messageType)
	}
	if got := content["message"]; got != unsupportedIncomingMessageText {
		t.Fatalf("unexpected unknown protocol fallback content %#v", content)
	}
}

func TestIncomingContentMapsQuotedText(t *testing.T) {
	manager := &WhatsAppManager{cfg: Config{WorkerID: "worker-1"}}
	lidChat := types.NewJID("158733669765176", types.HiddenUserServer)
	pnChat := types.NewJID("556195999040", types.DefaultUserServer)
	incoming := incomingTextEvent(lidChat, false, "")
	incoming.Info.ID = "reply-id"
	incoming.Info.SenderAlt = pnChat
	incoming.Message = &waE2E.Message{
		ExtendedTextMessage: &waE2E.ExtendedTextMessage{
			Text: proto.String("Teste"),
			ContextInfo: &waE2E.ContextInfo{
				StanzaID:    proto.String("quoted-id"),
				Participant: proto.String(lidChat.String()),
				QuotedMessage: &waE2E.Message{
					ExtendedTextMessage: &waE2E.ExtendedTextMessage{Text: proto.String("Oi")},
				},
			},
		},
	}

	messageType, content := manager.incomingContent(context.Background(), incoming)
	if messageType != MessageTypeText {
		t.Fatalf("unexpected type %q", messageType)
	}
	if got := content["message"]; got != "Teste" {
		t.Fatalf("unexpected message %#v", content)
	}
	if got := content["message_quoted_id"]; got != "quoted-id" {
		t.Fatalf("unexpected quoted id %#v", content)
	}
	quoted := asMap(content["quoted"])
	if stringValue(quoted["message"]) != "Oi" {
		t.Fatalf("unexpected quoted payload %#v", quoted)
	}
	if got := quoted["type"]; got != MessageTypeText {
		t.Fatalf("unexpected quoted type %#v", got)
	}
	key := asMap(quoted["key"])
	if got := key["remote_jid"]; got != "158733669765176@lid" {
		t.Fatalf("unexpected quoted remote jid %#v", got)
	}
	if got := key["remote_jid_alt"]; got != "556195999040@s.whatsapp.net" {
		t.Fatalf("unexpected quoted remote jid alt %#v", got)
	}
	if got := key["from_me"]; got != false {
		t.Fatalf("unexpected quoted from_me %#v", got)
	}

	upsert, err := manager.buildIncomingUpsert(context.Background(), incoming)
	if err != nil {
		t.Fatalf("build incoming upsert: %v", err)
	}
	if upsert == nil || !upsert.HasQuoted {
		t.Fatalf("expected upsert has_quoted, got %#v", upsert)
	}
}

func TestIncomingContentUnwrapsEphemeralText(t *testing.T) {
	manager := &WhatsAppManager{}

	messageType, content := manager.incomingContent(context.Background(), &events.Message{
		Message: &waE2E.Message{
			EphemeralMessage: &waE2E.FutureProofMessage{
				Message: &waE2E.Message{Conversation: proto.String("texto efemero")},
			},
		},
	})

	if messageType != MessageTypeText {
		t.Fatalf("unexpected type %q", messageType)
	}
	if got := content["message"]; got != "texto efemero" {
		t.Fatalf("unexpected content %#v", content)
	}
}

func TestIncomingContentUnwrapsViewOnceImage(t *testing.T) {
	manager := &WhatsAppManager{}
	evt := &events.Message{
		Message: &waE2E.Message{
			ViewOnceMessageV2: &waE2E.FutureProofMessage{
				Message: &waE2E.Message{
					ImageMessage: &waE2E.ImageMessage{
						Caption:  proto.String("foto"),
						Mimetype: proto.String("image/jpeg"),
					},
				},
			},
		},
	}

	messageType, content := manager.incomingContent(context.Background(), evt)
	if messageType != MessageTypeViewOnce {
		t.Fatalf("unexpected type %q", messageType)
	}
	if got := content["type"]; got != MessageTypeViewOnce {
		t.Fatalf("unexpected view once content %#v", content)
	}
	if !incomingMessageIsViewOnce(evt) {
		t.Fatal("expected view once key marker")
	}
}

func TestMediaContentMarksFailedWhenMediaCannotBePersisted(t *testing.T) {
	manager := &WhatsAppManager{cfg: Config{WorkerID: "worker-1", AccountID: "account-1"}}
	image := &waE2E.ImageMessage{
		Caption:       proto.String("foto"),
		Mimetype:      proto.String("image/jpeg"),
		Height:        proto.Uint32(1600),
		Width:         proto.Uint32(1200),
		JPEGThumbnail: []byte{1, 2, 3},
	}

	content := mediaContent(context.Background(), manager, image, MessageTypeImage, image.GetCaption(), image.GetMimetype(), false)
	if !boolValue(content["media_download_failed"]) {
		t.Fatalf("expected top-level media failure, got %#v", content)
	}
	imageContent := asMap(content["image"])
	if !boolValue(imageContent["media_download_failed"]) {
		t.Fatalf("expected image media failure, got %#v", imageContent)
	}
	if got := imageContent["url"]; got != nil {
		t.Fatalf("failed media must not expose a url, got %#v", got)
	}
	if got := imageContent["height"]; got != 1600 {
		t.Fatalf("unexpected height %#v", got)
	}
	if got := imageContent["width"]; got != 1200 {
		t.Fatalf("unexpected width %#v", got)
	}
	if got := stringValue(imageContent["thumbnail"]); !strings.HasPrefix(got, "data:image/jpeg;base64,") {
		t.Fatalf("expected data-uri thumbnail, got %q", got)
	}

	hasURL, failed := mediaContentPublishStatus(content, MessageTypeImage)
	if hasURL {
		t.Fatal("failed media must not be reported with url")
	}
	if !failed {
		t.Fatal("expected media failure publish status")
	}
}

func TestIncomingContentMapsDisappearingAndPinMessages(t *testing.T) {
	manager := &WhatsAppManager{}

	messageType, content := manager.incomingContent(context.Background(), &events.Message{
		Message: &waE2E.Message{
			ProtocolMessage: &waE2E.ProtocolMessage{
				Type:                waE2E.ProtocolMessage_EPHEMERAL_SETTING.Enum(),
				EphemeralExpiration: proto.Uint32(86400),
			},
		},
	})
	if messageType != MessageTypeSetDisappearingMessages {
		t.Fatalf("unexpected disappearing type %q", messageType)
	}
	if got := content["type"]; got != MessageTypeSetDisappearingMessages {
		t.Fatalf("unexpected disappearing content %#v", content)
	}

	pinType := waE2E.PinInChatMessage_PIN_FOR_ALL
	messageType, content = manager.incomingContent(context.Background(), &events.Message{
		Message: &waE2E.Message{
			PinInChatMessage: &waE2E.PinInChatMessage{
				Type: &pinType,
				Key:  &waCommon.MessageKey{ID: proto.String("target-id")},
			},
		},
	})
	if messageType != MessageTypeSystem {
		t.Fatalf("unexpected pin type %q", messageType)
	}
	if got := content["type"]; got != MessageTypeSystem {
		t.Fatalf("unexpected pin content %#v", content)
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

func TestIncomingUpsertKafkaKeyUsesStablePhoneJIDForLIDChat(t *testing.T) {
	cfg := Config{
		AccountID: "account-1",
		WorkerID:  "worker-1",
	}
	upsert := &UpsertMessage{
		Message: map[string]any{
			"key": map[string]any{
				"id":           "3EB01BB65FF0DD2CA13BB2",
				"remoteJid":    "252067352473847@lid",
				"remoteJidAlt": "556481342084@s.whatsapp.net",
			},
		},
	}

	got := incomingUpsertKafkaKey(cfg, upsert)
	want := "account-1:worker-1:556481342084@s.whatsapp.net"
	if got != want {
		t.Fatalf("unexpected kafka key %q want %q", got, want)
	}
}

func TestIncomingUpsertKafkaKeyFallsBackToMessageID(t *testing.T) {
	cfg := Config{
		AccountID: "account-1",
		WorkerID:  "worker-1",
	}
	upsert := &UpsertMessage{
		Message: map[string]any{
			"key": map[string]any{
				"id": "message-1",
			},
		},
	}

	got := incomingUpsertKafkaKey(cfg, upsert)
	want := "account-1:message-1"
	if got != want {
		t.Fatalf("unexpected kafka key %q want %q", got, want)
	}
}

func TestIncomingUpsertKafkaKeyUsesUpsertScopeAndStableRemote(t *testing.T) {
	cfg := Config{
		AccountID: "config-account",
		WorkerID:  "config-worker",
	}
	upsert := &UpsertMessage{
		AccountID: "account-1",
		WorkerID:  "worker-1",
		Message: map[string]any{
			"key": map[string]any{
				"id":           "call-1",
				"remoteJid":    "252067352473847@lid",
				"remoteJidAlt": "556481342084@s.whatsapp.net",
			},
		},
	}

	got := incomingUpsertKafkaKey(cfg, upsert)
	want := "account-1:worker-1:556481342084@s.whatsapp.net"
	if got != want {
		t.Fatalf("unexpected kafka key %q want %q", got, want)
	}
}

func TestBuildIncomingUpsertNormalizesReactionPayloadForBaileys(t *testing.T) {
	manager := &WhatsAppManager{}
	lidChat := types.NewJID("158733669765176", types.HiddenUserServer)
	pnChat := types.NewJID("556195999040", types.DefaultUserServer)
	targetJID := types.NewJID("128317164409045", types.HiddenUserServer)

	incoming := incomingTextEvent(lidChat, false, "")
	incoming.Info.ID = "reaction-event-id"
	incoming.Info.SenderAlt = pnChat
	incoming.Message = &waE2E.Message{
		ReactionMessage: &waE2E.ReactionMessage{
			Key: &waCommon.MessageKey{
				RemoteJID: proto.String(targetJID.String()),
				FromMe:    proto.Bool(true),
				ID:        proto.String("target-message-id"),
			},
			Text:              proto.String("\u2764\ufe0f"),
			SenderTimestampMS: proto.Int64(1777208911964),
		},
	}

	upsert, err := manager.buildIncomingUpsert(context.Background(), incoming)
	if err != nil {
		t.Fatalf("build incoming reaction upsert: %v", err)
	}
	if upsert == nil || upsert.Type != MessageTypeReact {
		t.Fatalf("expected reaction upsert, got %#v", upsert)
	}

	rawMessage := asMap(upsert.Message["message"])
	reaction := asMap(rawMessage["reactionMessage"])
	if got := stringValue(reaction["text"]); got != "\u2764\ufe0f" {
		t.Fatalf("unexpected reaction text %q", got)
	}

	reactionKey := asMap(reaction["key"])
	if got := stringValue(reactionKey["id"]); got != "target-message-id" {
		t.Fatalf("reaction key must expose baileys id, got %#v", reactionKey)
	}
	if got := stringValue(reactionKey["remoteJid"]); got != "128317164409045@lid" {
		t.Fatalf("reaction key must expose baileys remoteJid, got %#v", reactionKey)
	}
	if got := stringValue(reaction["senderTimestampMs"]); got != "1777208911964" {
		t.Fatalf("reaction must expose baileys senderTimestampMs, got %#v", reaction)
	}
}

func TestIncomingContentMapsImageAlbumMetadata(t *testing.T) {
	manager := &WhatsAppManager{cfg: Config{WorkerID: "worker-1"}}
	parentID := "album-parent-id"
	index := int32(1)

	messageType, content := manager.incomingContent(context.Background(), &events.Message{
		Message: &waE2E.Message{
			ImageMessage: &waE2E.ImageMessage{
				Mimetype: proto.String("image/jpeg"),
			},
			MessageContextInfo: &waE2E.MessageContextInfo{
				MessageAssociation: &waE2E.MessageAssociation{
					AssociationType:  waE2E.MessageAssociation_MEDIA_ALBUM.Enum(),
					ParentMessageKey: &waCommon.MessageKey{ID: proto.String(parentID)},
					MessageIndex:     proto.Int32(index),
				},
			},
		},
	})
	if messageType != MessageTypeImage {
		t.Fatalf("unexpected image type %q", messageType)
	}

	album := asMap(content["album"])
	if got := stringValue(album["id"]); got != parentID {
		t.Fatalf("unexpected album id %#v", album)
	}
	if got := stringValue(album["parent_message_id"]); got != parentID {
		t.Fatalf("unexpected album parent id %#v", album)
	}
	if got := album["item_index"]; got != int(index) {
		t.Fatalf("unexpected album item index %#v", album)
	}
	if got := stringValue(album["source"]); got != "whatsmeow" {
		t.Fatalf("unexpected album source %#v", album)
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

func TestProfilePhotoCandidatesFilterOwnAliasFromIncomingMessage(t *testing.T) {
	selfPN := types.NewJID("5500000000000", types.DefaultUserServer)
	selfLegacy := types.JID{User: "5500000000000", Server: types.LegacyUserServer, Device: 19}
	peerPN := types.NewJID("5511999999999", types.DefaultUserServer)

	incoming := incomingTextEvent(peerPN, false, "")
	incoming.Info.SenderAlt = selfLegacy

	got := profilePhotoCandidates(incomingProfilePhotoJIDs(incoming), profilePhotoAliasSet(selfPN))
	assertJIDStrings(t, got, "5511999999999@s.whatsapp.net")
}

func TestProfilePhotoCandidatesFilterOwnAliasFromOwnMessage(t *testing.T) {
	selfPN := types.NewJID("5500000000000", types.DefaultUserServer)
	selfLID := types.NewJID("158733669765176", types.HiddenUserServer)
	peerPN := types.NewJID("5511999999999", types.DefaultUserServer)
	peerPNDevice := types.JID{User: "5511999999999", Server: types.DefaultUserServer, Device: 84}

	outgoing := incomingTextEvent(peerPN, true, "")
	outgoing.Info.Sender = selfPN
	outgoing.Info.SenderAlt = selfLID
	outgoing.Info.RecipientAlt = peerPNDevice

	got := profilePhotoCandidates(incomingProfilePhotoJIDs(outgoing), profilePhotoAliasSet(selfPN, selfLID))
	assertJIDStrings(t, got, "5511999999999@s.whatsapp.net")
}

func TestProfilePhotoCandidatesPreservePhoneAliasBeforeLID(t *testing.T) {
	selfPN := types.NewJID("5500000000000", types.DefaultUserServer)
	lidChat := types.NewJID("158733669765176", types.HiddenUserServer)
	pnChat := types.JID{User: "556195999040", Server: types.DefaultUserServer, Device: 84}

	incoming := incomingTextEvent(lidChat, false, "")
	incoming.Info.SenderAlt = pnChat

	got := profilePhotoCandidates(incomingProfilePhotoJIDs(incoming), profilePhotoAliasSet(selfPN))
	assertJIDStrings(t, got, "556195999040@s.whatsapp.net", "158733669765176@lid")
}

func TestProfilePhotoCandidatesFilterOwnJIDFromCallCandidates(t *testing.T) {
	selfPN := types.NewJID("5500000000000", types.DefaultUserServer)
	peerPN := types.NewJID("5511999999999", types.DefaultUserServer)

	got := profilePhotoCandidates([]types.JID{selfPN, peerPN}, profilePhotoAliasSet(selfPN))
	assertJIDStrings(t, got, "5511999999999@s.whatsapp.net")
}

func TestProfilePhotoCandidatesReturnEmptyForOnlyOwnAliases(t *testing.T) {
	selfPN := types.NewJID("5500000000000", types.DefaultUserServer)
	selfLegacy := types.JID{User: "5500000000000", Server: types.LegacyUserServer, Device: 19}
	selfLID := types.JID{User: "158733669765176", Server: types.HiddenUserServer, Device: 84}

	got := profilePhotoCandidates([]types.JID{selfPN, selfLegacy, selfLID}, profilePhotoAliasSet(selfPN, selfLID))
	if len(got) != 0 {
		t.Fatalf("expected no candidates for own aliases, got %#v", got)
	}
}

func TestIncomingProfilePhotoCacheKeyStripsDevice(t *testing.T) {
	jid := types.JID{User: "556195999040", Server: types.DefaultUserServer, Device: 84}

	if got := incomingProfilePhotoCacheKey(jid); got != "photo:jid:556195999040@s.whatsapp.net" {
		t.Fatalf("unexpected cache key %q", got)
	}
}

func TestIncomingProfilePhotoNoPhotoCacheKeyIsProviderLocal(t *testing.T) {
	jid := types.JID{User: "556195999040", Server: types.DefaultUserServer, Device: 84}

	if got := incomingProfilePhotoNoPhotoCacheKey(jid); got != "photo:no-photo:whatsmeow:jid:556195999040@s.whatsapp.net" {
		t.Fatalf("unexpected no-photo cache key %q", got)
	}
}

func TestCachedProfilePhotoUsableOnlyValidatesTemporaryWhatsAppUrls(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	if !cachedProfilePhotoUsable(ctx, "https://cdn.test/profile.jpg") {
		t.Fatal("expected durable non-whatsapp url to be accepted without validation")
	}
	if cachedProfilePhotoUsable(ctx, "https://pps.whatsapp.net/stale.jpg") {
		t.Fatal("expected canceled temporary whatsapp url validation to fail")
	}
}

func TestIsImageContentType(t *testing.T) {
	if !isImageContentType("image/jpeg") {
		t.Fatal("expected image/jpeg to be image")
	}
	if !isImageContentType(" image/webp; charset=binary ") {
		t.Fatal("expected image/webp to be image")
	}
	if isImageContentType("text/html") {
		t.Fatal("did not expect text/html to be image")
	}
}

func TestCallPhoneFromJIDsPrefersPhoneAliasOverLID(t *testing.T) {
	lid := types.NewJID("158733669765176", types.HiddenUserServer)
	pn := types.JID{User: "556195999040", Server: types.DefaultUserServer, Device: 84}

	if got := callPhoneFromJIDs(lid, pn); got != "556195999040" {
		t.Fatalf("expected phone alias, got %q", got)
	}
	if got := callAltJID(lid, pn); got != "556195999040@s.whatsapp.net" {
		t.Fatalf("expected call alt jid, got %q", got)
	}
}

func assertJIDStrings(t *testing.T, got []types.JID, want ...string) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("unexpected candidates %#v, want %v", got, want)
	}
	for i := range want {
		if got[i].String() != want[i] {
			t.Fatalf("unexpected candidate %d: got %q want %q", i, got[i].String(), want[i])
		}
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

func captureStandardLog(t *testing.T, fn func()) string {
	t.Helper()
	var output bytes.Buffer
	previous := log.Writer()
	log.SetOutput(&output)
	defer log.SetOutput(previous)

	fn()
	return output.String()
}

func TestBuildChatReadStatePatchesForSentMessage(t *testing.T) {
	fromMe := true
	timestamp := time.Unix(1700000000, 0)
	patches := buildChatReadStatePatches(MessageKey{
		RemoteJID: "5511999999999@s.whatsapp.net",
		FromMe:    &fromMe,
		ID:        "sent-message-id",
	}, types.EmptyJID, timestamp)

	if len(patches) != 1 {
		t.Fatalf("expected one patch, got %d", len(patches))
	}
	if got := patches[0].chat.String(); got != "5511999999999@s.whatsapp.net" {
		t.Fatalf("unexpected chat %q", got)
	}
	if !patches[0].timestamp.Equal(timestamp) {
		t.Fatalf("unexpected timestamp %s", patches[0].timestamp)
	}

	key := patches[0].lastMessageKey
	if got := key.GetRemoteJID(); got != "5511999999999@s.whatsapp.net" {
		t.Fatalf("unexpected remote jid %q", got)
	}
	if got := key.GetID(); got != "sent-message-id" {
		t.Fatalf("unexpected id %q", got)
	}
	if !key.GetFromMe() {
		t.Fatal("expected fromMe=true")
	}
	if got := key.GetParticipant(); got != "" {
		t.Fatalf("expected no participant for direct chat, got %q", got)
	}
}

func TestBuildChatReadStatePatchesForReceivedMessage(t *testing.T) {
	fromMe := false
	patches := buildChatReadStatePatches(MessageKey{
		RemoteJID:   "5511999999999@s.whatsapp.net",
		FromMe:      &fromMe,
		ID:          "incoming-message-id",
		Participant: "551188887777@s.whatsapp.net",
	}, types.EmptyJID, time.Unix(1700000000, 0))

	if len(patches) != 1 {
		t.Fatalf("expected one patch, got %d", len(patches))
	}
	key := patches[0].lastMessageKey
	if key.GetFromMe() {
		t.Fatal("expected fromMe=false")
	}
	if got := key.GetRemoteJID(); got != "5511999999999@s.whatsapp.net" {
		t.Fatalf("unexpected remote jid %q", got)
	}
	if got := key.GetParticipant(); got != "" {
		t.Fatalf("expected participant to be omitted for direct chat, got %q", got)
	}
}

func TestBuildChatReadStatePatchesUsesParticipantOnlyWhenApplicable(t *testing.T) {
	fromMe := false
	groupChat := types.NewJID("120363040000000000", types.GroupServer)

	patches := buildChatReadStatePatches(MessageKey{
		RemoteJID:   groupChat.String(),
		FromMe:      &fromMe,
		ID:          "group-message-id",
		Participant: "551188887777@s.whatsapp.net",
	}, types.EmptyJID, time.Unix(1700000000, 0))

	if len(patches) != 1 {
		t.Fatalf("expected one group patch, got %d", len(patches))
	}
	if got := patches[0].lastMessageKey.GetParticipant(); got != "551188887777@s.whatsapp.net" {
		t.Fatalf("unexpected group participant %q", got)
	}

	directPatches := buildChatReadStatePatches(MessageKey{
		RemoteJID:   "5511999999999@s.whatsapp.net",
		FromMe:      &fromMe,
		ID:          "direct-message-id",
		Participant: "551188887777@s.whatsapp.net",
	}, types.EmptyJID, time.Unix(1700000000, 0))

	if len(directPatches) != 1 {
		t.Fatalf("expected one direct patch, got %d", len(directPatches))
	}
	if got := directPatches[0].lastMessageKey.GetParticipant(); got != "" {
		t.Fatalf("expected no direct participant, got %q", got)
	}
}

func TestBuildChatReadStatePatchesDedupesRemoteJidCandidates(t *testing.T) {
	fromMe := false
	patches := buildChatReadStatePatches(MessageKey{
		RemoteJID:     "12345@lid",
		RemoteJIDC:    "12345@lid",
		RemoteJIDAlt:  "5511999999999@s.whatsapp.net",
		RemoteJIDAltC: "5511999999999@c.us",
		FromMe:        &fromMe,
		ID:            "incoming-message-id",
	}, types.NewJID("5511999999999", types.DefaultUserServer), time.Unix(1700000000, 0))

	if len(patches) != 2 {
		t.Fatalf("expected two distinct pn/lid patches, got %d", len(patches))
	}
	if got := patches[0].chat.String(); got != "12345@lid" {
		t.Fatalf("unexpected first chat %q", got)
	}
	if got := patches[1].chat.String(); got != "5511999999999@s.whatsapp.net" {
		t.Fatalf("unexpected second chat %q", got)
	}
}

func TestSentChatReadMessageKeyPreservesRemoteAliases(t *testing.T) {
	fromMe := false
	key := sentChatReadMessageKey(ChatMessage{
		MessageKey: &MessageKey{
			RemoteJID:    "12345@lid",
			RemoteJIDAlt: "5511999999999@s.whatsapp.net",
			FromMe:       &fromMe,
			ID:           "incoming-message-id",
		},
	}, types.NewJID("12345", types.HiddenUserServer), "sent-message-id")

	if got := key.ID; got != "sent-message-id" {
		t.Fatalf("unexpected id %q", got)
	}
	if !key.FromMeValue() {
		t.Fatal("expected sent key to be fromMe")
	}
	if got := key.RemoteJID; got != "12345@lid" {
		t.Fatalf("unexpected remote jid %q", got)
	}
	if got := key.RemoteJIDAlt; got != "5511999999999@s.whatsapp.net" {
		t.Fatalf("unexpected remote jid alt %q", got)
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

	profileInfo, ok, err = mapToProfileInfoMessage([]byte(`{"worker_id":"w1","account_id":"a1","name":"Maycon","message":"about","photo":"https://cdn.test/photo.png"}`))
	if err != nil || !ok {
		t.Fatalf("expected profile info update payload ok=%v err=%v", ok, err)
	}
	if profileInfo.Name != "Maycon" || profileInfo.Message != "about" || profileInfo.Photo != "https://cdn.test/photo.png" {
		t.Fatalf("unexpected profile info payload %#v", profileInfo)
	}
	if !profileInfo.PhotoPresent || profileInfo.PhotoRemove {
		t.Fatalf("unexpected profile photo flags %#v", profileInfo)
	}
}

func TestNormalizeProfilePhotoJPEG(t *testing.T) {
	src := image.NewRGBA(image.Rect(0, 0, 800, 600))
	for y := 0; y < 600; y++ {
		for x := 0; x < 800; x++ {
			src.Set(x, y, color.RGBA{R: uint8(x % 255), G: uint8(y % 255), B: 80, A: 255})
		}
	}
	var input bytes.Buffer
	if err := jpeg.Encode(&input, src, &jpeg.Options{Quality: 85}); err != nil {
		t.Fatalf("encode source jpeg: %v", err)
	}

	output, err := normalizeProfilePhotoJPEG(input.Bytes(), "image/jpeg")
	if err != nil {
		t.Fatalf("normalize profile photo: %v", err)
	}
	decoded, format, err := image.Decode(bytes.NewReader(output))
	if err != nil {
		t.Fatalf("decode output: %v", err)
	}
	if format != "jpeg" {
		t.Fatalf("expected jpeg, got %s", format)
	}
	if decoded.Bounds().Dx() != 640 || decoded.Bounds().Dy() != 640 {
		t.Fatalf("expected 640x640, got %dx%d", decoded.Bounds().Dx(), decoded.Bounds().Dy())
	}
}
