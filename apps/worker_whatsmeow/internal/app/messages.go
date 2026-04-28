package app

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	_ "image/gif"
	"image/jpeg"
	_ "image/png"
	"io"
	"log"
	"mime"
	"net/http"
	"path"
	"strconv"
	"strings"
	"time"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/appstate"
	"go.mau.fi/whatsmeow/proto/waCommon"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	"google.golang.org/protobuf/proto"
)

type UnsupportedFeatureError struct {
	Feature string
}

func (e UnsupportedFeatureError) Error() string {
	return "unsupported_whatsmeow_feature:" + e.Feature
}

func (m *WhatsAppManager) SendChatMessage(ctx context.Context, data ChatMessage) (map[string]any, error) {
	client := m.getClient()
	if client == nil {
		return nil, fmt.Errorf("client is not initialized")
	}
	target, err := resolveTargetJID(data)
	if err != nil {
		return nil, err
	}
	msg, err := m.buildOutgoingMessage(ctx, client, target, data)
	if err != nil {
		return nil, err
	}
	if text, ok := typingSimulationText(data); ok {
		m.simulateTypingBeforeSend(ctx, client, target, text)
	}
	sendCtx, cancel := context.WithTimeout(ctx, m.cfg.SendTimeout)
	defer cancel()
	resp, err := client.SendMessage(sendCtx, target, msg)
	if err != nil {
		return nil, err
	}
	m.markChatAsReadAppState(ctx, client, sentChatReadMessageKey(data, target, string(resp.ID)), target, time.Now())
	return map[string]any{
		"key": map[string]any{
			"id":        string(resp.ID),
			"remoteJid": target.String(),
			"fromMe":    true,
		},
	}, nil
}

func (m *WhatsAppManager) SendProfileStatus(ctx context.Context, data ProfileStatusMessage) (string, error) {
	client := m.getClient()
	if client == nil {
		return "", fmt.Errorf("client is not initialized")
	}
	if len(data.StatusJIDList) > 0 {
		return "", UnsupportedFeatureError{Feature: "status_custom_audience"}
	}
	msg, err := m.buildProfileStatusMessage(ctx, client, data)
	if err != nil {
		return "", err
	}
	sendCtx, cancel := context.WithTimeout(ctx, m.cfg.SendTimeout)
	defer cancel()
	resp, err := client.SendMessage(sendCtx, types.StatusBroadcastJID, msg)
	if err != nil {
		return "", err
	}
	return string(resp.ID), nil
}

func (m *WhatsAppManager) DeleteProfileStatus(ctx context.Context, data ProfileStatusDeleteMessage) error {
	client := m.getClient()
	if client == nil {
		return fmt.Errorf("client is not initialized")
	}
	if strings.TrimSpace(data.ExternalID) == "" {
		return fmt.Errorf("profile status external_id is required")
	}
	if len(data.StatusJIDList) > 0 {
		return UnsupportedFeatureError{Feature: "status_custom_audience"}
	}
	sendCtx, cancel := context.WithTimeout(ctx, m.cfg.SendTimeout)
	defer cancel()
	_, err := client.SendMessage(sendCtx, types.StatusBroadcastJID, client.BuildRevoke(types.StatusBroadcastJID, types.EmptyJID, types.MessageID(data.ExternalID)))
	return err
}

func (m *WhatsAppManager) UpdateProfileInfo(ctx context.Context, data ProfileInfoMessage) error {
	client := m.getClient()
	if client == nil {
		return fmt.Errorf("client is not initialized")
	}
	if strings.TrimSpace(data.Name) != "" {
		name := strings.TrimSpace(data.Name)
		log.Printf("whatsmeow profile info updating name worker_id=%s", m.cfg.WorkerID)
		if err := client.SendAppState(ctx, appstate.BuildSettingPushName(name)); err != nil {
			return fmt.Errorf("update profile name: %w", err)
		}
		client.Store.PushName = name
		if err := client.Store.Save(ctx); err != nil {
			log.Printf("whatsmeow profile info local push name save failed worker_id=%s error=%v", m.cfg.WorkerID, err)
		}
		log.Printf("whatsmeow profile info name updated worker_id=%s", m.cfg.WorkerID)
	}
	if strings.TrimSpace(data.Message) != "" {
		log.Printf("whatsmeow profile info updating status worker_id=%s", m.cfg.WorkerID)
		if err := client.SetStatusMessage(ctx, data.Message); err != nil {
			return fmt.Errorf("update profile status: %w", err)
		}
		log.Printf("whatsmeow profile info status updated worker_id=%s", m.cfg.WorkerID)
	}
	if data.PhotoPresent {
		if client.Store.ID == nil {
			return fmt.Errorf("own profile jid is unavailable")
		}
		if data.PhotoRemove {
			log.Printf("whatsmeow profile info removing picture worker_id=%s jid=%s", m.cfg.WorkerID, client.Store.ID.String())
			_, err := client.SetProfilePhoto(ctx, nil)
			if err != nil {
				return fmt.Errorf("remove profile picture: %w", err)
			}
			log.Printf("whatsmeow profile info picture removed worker_id=%s", m.cfg.WorkerID)
			return err
		}
		log.Printf("whatsmeow profile info updating picture worker_id=%s jid=%s", m.cfg.WorkerID, client.Store.ID.String())
		body, contentType, _, err := downloadURL(ctx, data.Photo)
		if err != nil {
			return fmt.Errorf("download profile picture: %w", err)
		}
		avatar, err := normalizeProfilePhotoJPEG(body, contentType)
		if err != nil {
			return fmt.Errorf("normalize profile picture: %w", err)
		}
		pictureID, err := client.SetProfilePhoto(ctx, avatar)
		if err != nil {
			return fmt.Errorf("update profile picture: %w", err)
		}
		log.Printf("whatsmeow profile info picture updated worker_id=%s picture_id=%s bytes=%d", m.cfg.WorkerID, pictureID, len(avatar))
	}
	return nil
}

func normalizeProfilePhotoJPEG(body []byte, contentType string) ([]byte, error) {
	if len(body) == 0 {
		return nil, fmt.Errorf("profile picture is empty")
	}
	img, format, err := image.Decode(bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	bounds := img.Bounds()
	width := bounds.Dx()
	height := bounds.Dy()
	if width <= 0 || height <= 0 {
		return nil, fmt.Errorf("profile picture has invalid dimensions")
	}

	side := width
	if height < side {
		side = height
	}
	cropX := bounds.Min.X + (width-side)/2
	cropY := bounds.Min.Y + (height-side)/2
	size := 640
	dst := image.NewRGBA(image.Rect(0, 0, size, size))
	for y := 0; y < size; y++ {
		srcY := cropY + y*side/size
		for x := 0; x < size; x++ {
			srcX := cropX + x*side/size
			dst.Set(x, y, img.At(srcX, srcY))
		}
	}

	var out bytes.Buffer
	if err := jpeg.Encode(&out, dst, &jpeg.Options{Quality: 90}); err != nil {
		return nil, err
	}
	log.Printf("whatsmeow profile picture normalized format=%s content_type=%s input_bytes=%d output_bytes=%d size=%d", format, contentType, len(body), out.Len(), size)
	return out.Bytes(), nil
}

func (m *WhatsAppManager) buildProfileStatusMessage(ctx context.Context, client *whatsmeow.Client, data ProfileStatusMessage) (*waE2E.Message, error) {
	url, caption := splitStatusValue(data.Value)
	switch data.WorkerProfileStatusTypeID {
	case WorkerProfileStatusTypeText:
		text := strings.TrimSpace(data.Value)
		if text == "" {
			return nil, fmt.Errorf("profile status text is required")
		}
		return &waE2E.Message{Conversation: proto.String(text)}, nil
	case WorkerProfileStatusTypeImage:
		return m.buildMediaMessage(ctx, client, ChatMessage{
			Content: map[string]any{
				"type": MessageTypeImage,
				"image": map[string]any{
					"url":     url,
					"caption": caption,
				},
			},
		}, whatsmeow.MediaImage, "image", nil)
	case WorkerProfileStatusTypeVideo:
		return m.buildMediaMessage(ctx, client, ChatMessage{
			Content: map[string]any{
				"type": MessageTypeVideo,
				"video": map[string]any{
					"url":     url,
					"caption": caption,
				},
			},
		}, whatsmeow.MediaVideo, "video", nil)
	case WorkerProfileStatusTypeAudio:
		return m.buildMediaMessage(ctx, client, ChatMessage{
			Content: map[string]any{
				"type": MessageTypeAudio,
				"audio": map[string]any{
					"url": url,
				},
			},
		}, whatsmeow.MediaAudio, "audio", nil)
	default:
		return nil, UnsupportedFeatureError{Feature: "profile_status_type"}
	}
}

func (m *WhatsAppManager) buildOutgoingMessage(ctx context.Context, client *whatsmeow.Client, target types.JID, data ChatMessage) (*waE2E.Message, error) {
	contentType := stringValue(data.Content["type"])
	if contentType == "" {
		contentType = MessageTypeText
	}

	if unsupported := firstUnsupportedContent(data.Content); unsupported != "" {
		return nil, UnsupportedFeatureError{Feature: unsupported}
	}

	if isTextEditMessage(data, contentType) {
		log.Printf("whatsmeow edit message requested worker_id=%s message_id=%s target_key_id=%s", m.cfg.WorkerID, data.MessageID, data.MessageKey.ID)
		return buildTextEditMessage(client, target, data)
	}

	contextInfo := buildContextInfo(data)
	switch contentType {
	case MessageTypeText, MessageTypeSystem:
		text := stringValue(data.Content["message"])
		if ext := buildExtendedTextMessage(text, data, contextInfo); ext != nil {
			return &waE2E.Message{ExtendedTextMessage: ext}, nil
		}
		return &waE2E.Message{Conversation: proto.String(text)}, nil
	case MessageTypeEditText:
		if data.MessageKey == nil || data.MessageKey.ID == "" {
			return nil, fmt.Errorf("edit_text requires message_key.id")
		}
		return client.BuildEdit(target, data.MessageKey.ID, &waE2E.Message{
			Conversation: proto.String(stringValue(data.Content["message"])),
		}), nil
	case MessageTypeDelete:
		if data.MessageKey == nil || data.MessageKey.ID == "" {
			return nil, fmt.Errorf("delete_message requires message_key.id")
		}
		return client.BuildRevoke(target, senderJIDFromKey(target, data.MessageKey), data.MessageKey.ID), nil
	case MessageTypeReact:
		if data.MessageKey == nil || data.MessageKey.ID == "" {
			return nil, fmt.Errorf("react requires message_key.id")
		}
		emoji := stringValue(data.Content["message"])
		if emoji == "" {
			if reactions, ok := data.Content["reactions"].([]any); ok && len(reactions) > 0 {
				emoji = stringValue(asMap(reactions[len(reactions)-1])["emoji"])
			}
		}
		return client.BuildReaction(target, senderJIDFromKey(target, data.MessageKey), data.MessageKey.ID, emoji), nil
	case MessageTypeImage:
		return m.buildMediaMessage(ctx, client, data, whatsmeow.MediaImage, "image", contextInfo)
	case MessageTypeVideo, MessageTypeVideoNote:
		return m.buildMediaMessage(ctx, client, data, whatsmeow.MediaVideo, "video", contextInfo)
	case MessageTypeAudio:
		return m.buildMediaMessage(ctx, client, data, whatsmeow.MediaAudio, "audio", contextInfo)
	case MessageTypeDocument:
		return m.buildMediaMessage(ctx, client, data, whatsmeow.MediaDocument, "document", contextInfo)
	case MessageTypeSticker:
		return m.buildMediaMessage(ctx, client, data, whatsmeow.MediaImage, "sticker", contextInfo)
	case MessageTypeLocation:
		location := asMap(data.Content["location"])
		lat := floatValue(location["latitude"])
		lng := floatValue(location["longitude"])
		if lat == 0 && lng == 0 {
			lat = floatValue(location["degreesLatitude"])
			lng = floatValue(location["degreesLongitude"])
		}
		return &waE2E.Message{LocationMessage: &waE2E.LocationMessage{
			DegreesLatitude:  proto.Float64(lat),
			DegreesLongitude: proto.Float64(lng),
			Name:             proto.String(stringValue(location["name"])),
			Address:          proto.String(stringValue(location["address"])),
			ContextInfo:      contextInfo,
		}}, nil
	case MessageTypeContact:
		contact := asMap(data.Content["contact"])
		return &waE2E.Message{ContactMessage: buildContactMessage(contact, contextInfo)}, nil
	case MessageTypeContacts:
		contactsRaw, _ := data.Content["contacts"].([]any)
		contacts := make([]*waE2E.ContactMessage, 0, len(contactsRaw))
		for _, item := range contactsRaw {
			contacts = append(contacts, buildContactMessage(asMap(item), nil))
		}
		return &waE2E.Message{ContactsArrayMessage: &waE2E.ContactsArrayMessage{
			DisplayName: proto.String("Contacts"),
			Contacts:    contacts,
			ContextInfo: contextInfo,
		}}, nil
	default:
		return nil, UnsupportedFeatureError{Feature: contentType}
	}
}

func isTextEditMessage(data ChatMessage, contentType string) bool {
	if contentType != MessageTypeText {
		return false
	}
	if data.MessageKey == nil || data.MessageKey.ID == "" {
		return false
	}
	return len(versionItems(data.Content["version"])) > 0
}

func buildTextEditMessage(client *whatsmeow.Client, target types.JID, data ChatMessage) (*waE2E.Message, error) {
	if data.MessageKey == nil || data.MessageKey.ID == "" {
		return nil, fmt.Errorf("edit_text requires message_key.id")
	}
	if !data.MessageKey.FromMeValue() {
		return nil, fmt.Errorf("Message edit is not allowed for non-own message")
	}
	newText := firstNonEmpty(latestVersionMessage(data.Content["version"]), stringValue(data.Content["message"]))
	if newText == "" {
		return nil, fmt.Errorf("edit_text requires message")
	}
	return client.BuildEdit(target, data.MessageKey.ID, &waE2E.Message{
		Conversation: proto.String(newText),
	}), nil
}

func latestVersionMessage(value any) string {
	versions := versionItems(value)
	if len(versions) == 0 {
		return ""
	}
	latestIndex := -1
	latestTime := time.Time{}
	for index, item := range versions {
		message := stringValue(item["message"])
		if message == "" {
			continue
		}
		parsedTime, _ := time.Parse(time.RFC3339Nano, stringValue(item["date"]))
		if latestIndex == -1 || parsedTime.After(latestTime) || (parsedTime.IsZero() && latestTime.IsZero() && index > latestIndex) {
			latestIndex = index
			latestTime = parsedTime
		}
	}
	if latestIndex < 0 {
		return ""
	}
	return stringValue(versions[latestIndex]["message"])
}

func versionItems(value any) []map[string]any {
	switch typed := value.(type) {
	case []map[string]any:
		return typed
	case []any:
		items := make([]map[string]any, 0, len(typed))
		for _, item := range typed {
			mapped := asMap(item)
			if len(mapped) > 0 {
				items = append(items, mapped)
			}
		}
		return items
	default:
		return nil
	}
}

func (m *WhatsAppManager) buildMediaMessage(ctx context.Context, client *whatsmeow.Client, data ChatMessage, mediaType whatsmeow.MediaType, contentKey string, contextInfo *waE2E.ContextInfo) (*waE2E.Message, error) {
	media := asMap(data.Content[contentKey])
	url := stringValue(media["url"])
	if url == "" {
		return nil, fmt.Errorf("%s url is required", contentKey)
	}
	body, contentType, fileName, err := downloadURL(ctx, url)
	if err != nil {
		return nil, err
	}
	if mimeType := stringValue(media["mimetype"]); mimeType != "" {
		contentType = mimeType
	}
	if name := stringValue(media["name"]); name != "" {
		fileName = name
	}
	upload, err := client.Upload(ctx, body, mediaType)
	if err != nil {
		return nil, err
	}
	now := time.Now().Unix()
	caption := firstNonEmpty(stringValue(media["caption"]), stringValue(data.Content["message"]))
	viewOnce := boolValue(media["is_view_once"]) || boolValue(media["view_once"]) || boolValue(data.Content["is_view_once"])

	switch contentKey {
	case "image":
		return &waE2E.Message{ImageMessage: &waE2E.ImageMessage{
			URL:               proto.String(upload.URL),
			DirectPath:        proto.String(upload.DirectPath),
			Mimetype:          proto.String(firstNonEmpty(contentType, "image/jpeg")),
			Caption:           proto.String(caption),
			MediaKey:          upload.MediaKey,
			FileEncSHA256:     upload.FileEncSHA256,
			FileSHA256:        upload.FileSHA256,
			FileLength:        proto.Uint64(upload.FileLength),
			MediaKeyTimestamp: proto.Int64(now),
			ContextInfo:       contextInfo,
			ViewOnce:          proto.Bool(viewOnce),
		}}, nil
	case "video":
		video := &waE2E.VideoMessage{
			URL:               proto.String(upload.URL),
			DirectPath:        proto.String(upload.DirectPath),
			Mimetype:          proto.String(firstNonEmpty(contentType, "video/mp4")),
			Caption:           proto.String(caption),
			MediaKey:          upload.MediaKey,
			FileEncSHA256:     upload.FileEncSHA256,
			FileSHA256:        upload.FileSHA256,
			FileLength:        proto.Uint64(upload.FileLength),
			MediaKeyTimestamp: proto.Int64(now),
			ContextInfo:       contextInfo,
			ViewOnce:          proto.Bool(viewOnce),
		}
		if data.Content["type"] == MessageTypeVideoNote {
			return &waE2E.Message{PtvMessage: video}, nil
		}
		return &waE2E.Message{VideoMessage: video}, nil
	case "audio":
		ptt := outgoingAudioPTT(media, viewOnce)
		duration := uint32Value(firstNonEmptyAny(media["duration"], media["seconds"]))
		waveform := outgoingAudioWaveform(media, ptt)
		log.Printf(
			"whatsmeow audio message build worker_id=%s ptt=%t view_once=%t mimetype=%s duration=%d has_waveform=%t",
			m.cfg.WorkerID,
			ptt,
			viewOnce,
			firstNonEmpty(contentType, "audio/ogg; codecs=opus"),
			duration,
			len(waveform) > 0,
		)
		return &waE2E.Message{AudioMessage: &waE2E.AudioMessage{
			URL:               proto.String(upload.URL),
			DirectPath:        proto.String(upload.DirectPath),
			Mimetype:          proto.String(firstNonEmpty(contentType, "audio/ogg; codecs=opus")),
			MediaKey:          upload.MediaKey,
			FileEncSHA256:     upload.FileEncSHA256,
			FileSHA256:        upload.FileSHA256,
			FileLength:        proto.Uint64(upload.FileLength),
			Seconds:           proto.Uint32(duration),
			MediaKeyTimestamp: proto.Int64(now),
			ContextInfo:       contextInfo,
			PTT:               proto.Bool(ptt),
			Waveform:          waveform,
			ViewOnce:          proto.Bool(viewOnce),
		}}, nil
	case "document":
		return &waE2E.Message{DocumentMessage: &waE2E.DocumentMessage{
			URL:               proto.String(upload.URL),
			DirectPath:        proto.String(upload.DirectPath),
			Mimetype:          proto.String(firstNonEmpty(contentType, "application/octet-stream")),
			Title:             proto.String(firstNonEmpty(stringValue(media["title"]), fileName)),
			FileName:          proto.String(fileName),
			Caption:           proto.String(caption),
			MediaKey:          upload.MediaKey,
			FileEncSHA256:     upload.FileEncSHA256,
			FileSHA256:        upload.FileSHA256,
			FileLength:        proto.Uint64(upload.FileLength),
			MediaKeyTimestamp: proto.Int64(now),
			ContextInfo:       contextInfo,
		}}, nil
	case "sticker":
		return &waE2E.Message{StickerMessage: &waE2E.StickerMessage{
			URL:               proto.String(upload.URL),
			DirectPath:        proto.String(upload.DirectPath),
			Mimetype:          proto.String(firstNonEmpty(contentType, "image/webp")),
			MediaKey:          upload.MediaKey,
			FileEncSHA256:     upload.FileEncSHA256,
			FileSHA256:        upload.FileSHA256,
			FileLength:        proto.Uint64(upload.FileLength),
			MediaKeyTimestamp: proto.Int64(now),
			ContextInfo:       contextInfo,
			IsAnimated:        proto.Bool(boolValue(media["is_animated"])),
		}}, nil
	default:
		return nil, UnsupportedFeatureError{Feature: contentKey}
	}
}

func (m *WhatsAppManager) incomingContent(ctx context.Context, evt *events.Message) (string, map[string]any) {
	msg, wrappedViewOnce := unwrapIncomingMessage(evt.Message)
	if msg == nil {
		return "", nil
	}
	viewOnce := evt.IsViewOnce || evt.IsViewOnceV2 || evt.IsViewOnceV2Extension || wrappedViewOnce
	if viewOnce {
		return m.withIncomingQuoted(evt, msg, MessageTypeViewOnce, map[string]any{"type": MessageTypeViewOnce})
	}
	base := map[string]any{}
	if text := msg.GetConversation(); text != "" {
		return m.withIncomingQuoted(evt, msg, MessageTypeText, map[string]any{"type": MessageTypeText, "message": text})
	}
	if ext := msg.GetExtendedTextMessage(); ext != nil {
		return m.withIncomingQuoted(evt, msg, MessageTypeText, map[string]any{"type": MessageTypeText, "message": ext.GetText()})
	}
	if protocolMsg := msg.GetProtocolMessage(); protocolMsg != nil {
		if protocolMsg.Type == nil {
			return "", nil
		}
		switch protocolMsg.GetType() {
		case waE2E.ProtocolMessage_REVOKE:
			return m.withIncomingQuoted(evt, msg, MessageTypeDelete, map[string]any{"type": MessageTypeDelete, "message": "Mensagem apagada"})
		case waE2E.ProtocolMessage_MESSAGE_EDIT:
			edited := protocolMsg.GetEditedMessage()
			if edited == nil {
				return "", nil
			}
			message := edited.GetConversation()
			if message == "" && edited.GetExtendedTextMessage() != nil {
				message = edited.GetExtendedTextMessage().GetText()
			}
			return m.withIncomingQuoted(evt, msg, MessageTypeEditText, map[string]any{"type": MessageTypeEditText, "message": message})
		case waE2E.ProtocolMessage_EPHEMERAL_SETTING, waE2E.ProtocolMessage_EPHEMERAL_SYNC_RESPONSE:
			return m.withIncomingQuoted(evt, msg, MessageTypeSetDisappearingMessages, map[string]any{"type": MessageTypeSetDisappearingMessages})
		default:
			return "", nil
		}
	}
	if reaction := msg.GetReactionMessage(); reaction != nil {
		return m.withIncomingQuoted(evt, msg, MessageTypeReact, map[string]any{
			"type":    MessageTypeReact,
			"message": reaction.GetText(),
			"reactions": []map[string]any{{
				"emoji": reaction.GetText(),
			}},
		})
	}
	if msg.GetEncReactionMessage() != nil {
		return m.withIncomingQuoted(evt, msg, MessageTypeReact, map[string]any{"type": MessageTypeReact, "message": ""})
	}
	if msg.GetPinInChatMessage() != nil {
		return m.withIncomingQuoted(evt, msg, MessageTypeSystem, map[string]any{"type": MessageTypeSystem, "message": ""})
	}
	if template := msg.GetTemplateMessage(); template != nil && template.GetHydratedTemplate() != nil {
		text := template.GetHydratedTemplate().GetHydratedContentText()
		return m.withIncomingQuoted(evt, msg, MessageTypeText, map[string]any{"type": MessageTypeText, "message": text})
	}
	if image := msg.GetImageMessage(); image != nil {
		base = mediaContent(ctx, m, image, MessageTypeImage, image.GetCaption(), image.GetMimetype(), viewOnce)
		enrichIncomingAlbumContent(base, msg)
		return m.withIncomingQuoted(evt, msg, MessageTypeImage, base)
	}
	if video := msg.GetVideoMessage(); video != nil {
		base = mediaContent(ctx, m, video, MessageTypeVideo, video.GetCaption(), video.GetMimetype(), viewOnce)
		return m.withIncomingQuoted(evt, msg, MessageTypeVideo, base)
	}
	if video := msg.GetPtvMessage(); video != nil {
		base = mediaContent(ctx, m, video, MessageTypeVideoNote, video.GetCaption(), video.GetMimetype(), viewOnce)
		return m.withIncomingQuoted(evt, msg, MessageTypeVideoNote, base)
	}
	if audio := msg.GetAudioMessage(); audio != nil {
		base = mediaContent(ctx, m, audio, MessageTypeAudio, "", audio.GetMimetype(), viewOnce)
		if audio.GetPTT() {
			asMap(base["audio"])["ptt"] = true
		}
		return m.withIncomingQuoted(evt, msg, MessageTypeAudio, base)
	}
	if doc := msg.GetDocumentMessage(); doc != nil {
		base = mediaContent(ctx, m, doc, MessageTypeDocument, doc.GetCaption(), doc.GetMimetype(), viewOnce)
		asMap(base["document"])["name"] = firstNonEmpty(doc.GetFileName(), doc.GetTitle())
		return m.withIncomingQuoted(evt, msg, MessageTypeDocument, base)
	}
	if sticker := msg.GetStickerMessage(); sticker != nil {
		base = mediaContent(ctx, m, sticker, MessageTypeSticker, "", sticker.GetMimetype(), viewOnce)
		asMap(base["sticker"])["is_animated"] = sticker.GetIsAnimated()
		asMap(base["sticker"])["is_lottie"] = sticker.GetIsLottie()
		return m.withIncomingQuoted(evt, msg, MessageTypeSticker, base)
	}
	if loc := msg.GetLocationMessage(); loc != nil {
		return m.withIncomingQuoted(evt, msg, MessageTypeLocation, map[string]any{
			"type": MessageTypeLocation,
			"location": map[string]any{
				"latitude":  loc.GetDegreesLatitude(),
				"longitude": loc.GetDegreesLongitude(),
				"name":      loc.GetName(),
				"address":   loc.GetAddress(),
			},
		})
	}
	if contact := msg.GetContactMessage(); contact != nil {
		return m.withIncomingQuoted(evt, msg, MessageTypeContact, map[string]any{
			"type":    MessageTypeContact,
			"contact": parseVCard(contact.GetDisplayName(), contact.GetVcard()),
		})
	}
	if contacts := msg.GetContactsArrayMessage(); contacts != nil {
		items := make([]map[string]any, 0, len(contacts.GetContacts()))
		for _, contact := range contacts.GetContacts() {
			items = append(items, parseVCard(contact.GetDisplayName(), contact.GetVcard()))
		}
		return m.withIncomingQuoted(evt, msg, MessageTypeContacts, map[string]any{"type": MessageTypeContacts, "contacts": items})
	}
	return "", nil
}

func unwrapIncomingMessage(msg *waE2E.Message) (*waE2E.Message, bool) {
	viewOnce := false
	for i := 0; i < 16 && msg != nil; i++ {
		if inner := futureProofInner(msg.GetEphemeralMessage()); inner != nil {
			msg = inner
			continue
		}
		if inner := futureProofInner(msg.GetViewOnceMessage()); inner != nil {
			viewOnce = true
			msg = inner
			continue
		}
		if inner := futureProofInner(msg.GetViewOnceMessageV2()); inner != nil {
			viewOnce = true
			msg = inner
			continue
		}
		if inner := futureProofInner(msg.GetViewOnceMessageV2Extension()); inner != nil {
			viewOnce = true
			msg = inner
			continue
		}
		if inner := futureProofInner(msg.GetDocumentWithCaptionMessage()); inner != nil {
			msg = inner
			continue
		}
		if inner := futureProofInner(msg.GetLottieStickerMessage()); inner != nil {
			msg = inner
			continue
		}
		if inner := futureProofInner(msg.GetEditedMessage()); inner != nil {
			msg = inner
			continue
		}
		return msg, viewOnce
	}
	return msg, viewOnce
}

func futureProofInner(msg *waE2E.FutureProofMessage) *waE2E.Message {
	if msg == nil {
		return nil
	}
	return msg.GetMessage()
}

func mediaContent(ctx context.Context, manager *WhatsAppManager, media whatsmeow.DownloadableMessage, messageType, caption, mimetype string, viewOnce bool) map[string]any {
	content := map[string]any{"type": messageType}
	key := messageType
	if messageType == MessageTypeVideoNote {
		key = "video"
	}
	entry := map[string]any{
		"caption":      caption,
		"mimetype":     mimetype,
		"is_view_once": viewOnce,
		"view_once":    viewOnce,
	}
	enrichIncomingMediaMetadata(entry, media)

	failMedia := func(reason string, err error) map[string]any {
		entry["media_download_failed"] = true
		content["media_download_failed"] = true
		content[key] = entry
		if manager != nil {
			if err != nil {
				log.Printf("whatsmeow media failed worker_id=%s type=%s key=%s reason=%s error=%v", manager.cfg.WorkerID, messageType, key, reason, err)
			} else {
				log.Printf("whatsmeow media failed worker_id=%s type=%s key=%s reason=%s", manager.cfg.WorkerID, messageType, key, reason)
			}
		}
		return content
	}

	if manager == nil {
		return failMedia("manager_unavailable", nil)
	}

	client := manager.getClient()
	if client == nil {
		return failMedia("client_unavailable", nil)
	}
	if manager.storage == nil {
		return failMedia("storage_unavailable", nil)
	}

	data, err := client.Download(ctx, media)
	if err != nil {
		return failMedia("download_failed", err)
	}
	contentType := normalizeIncomingMediaMimetype(media, firstNonEmpty(mimetype, http.DetectContentType(data)), data)
	entry["mimetype"] = contentType
	name := incomingMediaFileName(media, messageType, contentType)
	object, uploadErr := manager.storage.Upload(ctx, manager.cfg.AccountID, data, name, contentType)
	if uploadErr != nil {
		return failMedia("upload_failed", uploadErr)
	}
	entry["url"] = object.URL
	entry["name"] = firstNonEmpty(stringValue(entry["name"]), object.Name)
	entry["size"] = object.Size
	entry["extension"] = extensionName(firstNonEmpty(object.Name, name), contentType)
	content[key] = entry
	log.Printf(
		"whatsmeow media uploaded worker_id=%s type=%s key=%s name=%s mimetype=%s size=%d url=%s backup=%t",
		manager.cfg.WorkerID,
		messageType,
		key,
		object.Name,
		contentType,
		object.Size,
		object.URL,
		object.UsedBackup,
	)
	return content
}

func enrichIncomingMediaMetadata(entry map[string]any, media whatsmeow.DownloadableMessage) {
	switch msg := media.(type) {
	case *waE2E.ImageMessage:
		setPositiveNumber(entry, "height", msg.GetHeight())
		setPositiveNumber(entry, "width", msg.GetWidth())
		setThumbnail(entry, msg.GetJPEGThumbnail())
	case *waE2E.VideoMessage:
		setPositiveNumber(entry, "height", msg.GetHeight())
		setPositiveNumber(entry, "width", msg.GetWidth())
		setPositiveNumber(entry, "duration", msg.GetSeconds())
		setThumbnail(entry, msg.GetJPEGThumbnail())
	case *waE2E.AudioMessage:
		setPositiveNumber(entry, "duration", msg.GetSeconds())
		entry["ptt"] = msg.GetPTT()
		if waveform := msg.GetWaveform(); len(waveform) > 0 {
			entry["waveform"] = base64.StdEncoding.EncodeToString(waveform)
		}
	case *waE2E.DocumentMessage:
		if name := firstNonEmpty(msg.GetFileName(), msg.GetTitle()); name != "" {
			entry["name"] = name
		}
		setThumbnail(entry, msg.GetJPEGThumbnail())
	case *waE2E.StickerMessage:
		setPositiveNumber(entry, "height", msg.GetHeight())
		setPositiveNumber(entry, "width", msg.GetWidth())
		entry["is_animated"] = msg.GetIsAnimated()
		entry["is_lottie"] = msg.GetIsLottie()
	}
}

func setPositiveNumber(entry map[string]any, key string, value uint32) {
	if value > 0 {
		entry[key] = int(value)
	}
}

func setThumbnail(entry map[string]any, thumbnail []byte) {
	if len(thumbnail) == 0 {
		return
	}
	entry["thumbnail"] = "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(thumbnail)
}

func incomingMediaFileName(media whatsmeow.DownloadableMessage, messageType, mimetype string) string {
	if doc, ok := media.(*waE2E.DocumentMessage); ok {
		if name := firstNonEmpty(doc.GetFileName(), doc.GetTitle()); name != "" {
			return name
		}
	}
	prefix := messageType
	if prefix == MessageTypeVideoNote {
		prefix = MessageTypeVideo
	}
	return prefix + "-" + randomHex(8) + extensionFromMime(mimetype)
}

func normalizeIncomingMediaMimetype(media whatsmeow.DownloadableMessage, mimetype string, data []byte) string {
	normalized := strings.ToLower(strings.TrimSpace(strings.Split(mimetype, ";")[0]))
	if sticker, ok := media.(*waE2E.StickerMessage); ok {
		if sticker.GetIsLottie() || normalized == "application/was" {
			return "application/was"
		}
		if normalized == "application/x-tgsticker" {
			return "application/x-tgsticker"
		}
		if normalized == "" || normalized == "application/octet-stream" {
			if looksLikeLottie(data) {
				return "application/was"
			}
			return "image/webp"
		}
	}
	if normalized == "" || normalized == "application/octet-stream" {
		return firstNonEmpty(http.DetectContentType(data), "application/octet-stream")
	}
	return normalized
}

func looksLikeLottie(data []byte) bool {
	if len(data) < 4 {
		return false
	}
	return data[0] == 0x50 && data[1] == 0x4b
}

func extensionName(fileName, mimetype string) string {
	ext := strings.TrimPrefix(strings.ToLower(path.Ext(fileName)), ".")
	if ext != "" {
		return ext
	}
	return strings.TrimPrefix(strings.ToLower(extensionFromMime(mimetype)), ".")
}

func mediaContentPublishStatus(content map[string]any, messageType string) (bool, bool) {
	if len(content) == 0 {
		return false, false
	}
	key := messageType
	if messageType == MessageTypeVideoNote {
		key = "video"
	}
	media := asMap(content[key])
	hasURL := stringValue(media["url"]) != ""
	failed := boolValue(content["media_download_failed"]) || boolValue(media["media_download_failed"])
	return hasURL, failed
}

func enrichIncomingAlbumContent(content map[string]any, msg *waE2E.Message) {
	if len(content) == 0 || msg == nil {
		return
	}
	association := incomingMessageAssociation(msg)
	if association == nil || association.GetAssociationType() != waE2E.MessageAssociation_MEDIA_ALBUM {
		return
	}

	parentMessageID := incomingMessageKeyID(association.GetParentMessageKey())
	if parentMessageID == "" {
		return
	}

	album := map[string]any{
		"id":                parentMessageID,
		"parent_message_id": parentMessageID,
		"association_type":  "MEDIA_ALBUM",
		"source":            "whatsmeow",
	}
	if association.MessageIndex != nil {
		album["item_index"] = int(association.GetMessageIndex())
	}
	content["album"] = album
}

func incomingMessageAssociation(msg *waE2E.Message) *waE2E.MessageAssociation {
	if msg == nil || msg.GetMessageContextInfo() == nil {
		return nil
	}
	return msg.GetMessageContextInfo().GetMessageAssociation()
}

func incomingMessageKeyID(key *waCommon.MessageKey) string {
	if key == nil {
		return ""
	}
	return strings.TrimSpace(key.GetID())
}

func (m *WhatsAppManager) withIncomingQuoted(evt *events.Message, msg *waE2E.Message, messageType string, content map[string]any) (string, map[string]any) {
	if content == nil {
		return messageType, content
	}
	quoted := incomingQuotedMessage(evt, msg)
	if len(quoted) == 0 {
		return messageType, content
	}
	content["quoted"] = quoted
	if key := asMap(quoted["key"]); stringValue(key["id"]) != "" {
		content["message_quoted_id"] = stringValue(key["id"])
	}
	if m != nil {
		log.Printf(
			"whatsmeow incoming quoted mapped worker_id=%s message_id=%s quoted_id=%s quoted_type=%s participant=%s",
			m.cfg.WorkerID,
			evt.Info.ID,
			stringValue(asMap(quoted["key"])["id"]),
			stringValue(quoted["type"]),
			stringValue(asMap(quoted["key"])["participant"]),
		)
	}
	return messageType, content
}

func incomingQuotedMessage(evt *events.Message, msg *waE2E.Message) map[string]any {
	if evt == nil || msg == nil {
		return nil
	}
	ctx := incomingMessageContextInfo(msg)
	if ctx == nil || ctx.GetQuotedMessage() == nil || ctx.GetStanzaID() == "" {
		return nil
	}

	currentParticipant := ""
	if !evt.Info.Sender.IsEmpty() && evt.Info.Sender != evt.Info.Chat {
		currentParticipant = evt.Info.Sender.String()
	}
	participant := firstNonEmpty(ctx.GetParticipant(), currentParticipant, evt.Info.Sender.String())
	fromMe := evt.Info.IsFromMe
	if ctx.GetParticipant() != "" {
		fromMe = ctx.GetParticipant() == currentParticipant
	}

	key := map[string]any{
		"remote_jid":   evt.Info.Chat.String(),
		"from_me":      fromMe,
		"id":           ctx.GetStanzaID(),
		"participant":  participant,
		"is_view_once": false,
		"addressing_mode": func() string {
			if evt.Info.AddressingMode != "" {
				return string(evt.Info.AddressingMode)
			}
			return ""
		}(),
	}
	if remoteJIDAlt := incomingRemoteJIDAlt(evt); remoteJIDAlt != "" {
		key["remote_jid_alt"] = remoteJIDAlt
	}
	if !evt.Info.SenderAlt.IsEmpty() {
		key["participant_alt"] = nonADJID(evt.Info.SenderAlt).String()
	}
	if key["addressing_mode"] == "" {
		delete(key, "addressing_mode")
	}

	quotedMsg := ctx.GetQuotedMessage()
	quoted := map[string]any{
		"key":     key,
		"message": quotedMessageText(quotedMsg),
		"type":    quotedMessageType(quotedMsg),
	}
	enrichQuotedContent(quotedMsg, quoted)
	if quoted["message"] == "" {
		quoted["message"] = nil
	}
	return quoted
}

func incomingMessageContextInfo(msg *waE2E.Message) *waE2E.ContextInfo {
	switch {
	case msg.GetExtendedTextMessage() != nil:
		return msg.GetExtendedTextMessage().GetContextInfo()
	case msg.GetImageMessage() != nil:
		return msg.GetImageMessage().GetContextInfo()
	case msg.GetVideoMessage() != nil:
		return msg.GetVideoMessage().GetContextInfo()
	case msg.GetPtvMessage() != nil:
		return msg.GetPtvMessage().GetContextInfo()
	case msg.GetAudioMessage() != nil:
		return msg.GetAudioMessage().GetContextInfo()
	case msg.GetDocumentMessage() != nil:
		return msg.GetDocumentMessage().GetContextInfo()
	case msg.GetStickerMessage() != nil:
		return msg.GetStickerMessage().GetContextInfo()
	case msg.GetLocationMessage() != nil:
		return msg.GetLocationMessage().GetContextInfo()
	case msg.GetContactMessage() != nil:
		return msg.GetContactMessage().GetContextInfo()
	case msg.GetContactsArrayMessage() != nil:
		return msg.GetContactsArrayMessage().GetContextInfo()
	}
	return nil
}

func quotedMessageType(msg *waE2E.Message) string {
	switch {
	case msg == nil:
		return MessageTypeText
	case msg.GetDocumentMessage() != nil:
		return MessageTypeDocument
	case msg.GetPtvMessage() != nil:
		return MessageTypeVideoNote
	case msg.GetVideoMessage() != nil:
		return MessageTypeVideo
	case msg.GetImageMessage() != nil:
		return MessageTypeImage
	case msg.GetAudioMessage() != nil:
		return MessageTypeAudio
	case msg.GetStickerMessage() != nil:
		return MessageTypeSticker
	case msg.GetLocationMessage() != nil:
		return MessageTypeLocation
	case msg.GetContactMessage() != nil:
		return MessageTypeContact
	case msg.GetContactsArrayMessage() != nil:
		return MessageTypeContacts
	default:
		return MessageTypeText
	}
}

func quotedMessageText(msg *waE2E.Message) string {
	if msg == nil {
		return ""
	}
	switch {
	case msg.GetConversation() != "":
		return msg.GetConversation()
	case msg.GetExtendedTextMessage() != nil:
		return msg.GetExtendedTextMessage().GetText()
	case msg.GetImageMessage() != nil:
		return msg.GetImageMessage().GetCaption()
	case msg.GetVideoMessage() != nil:
		return msg.GetVideoMessage().GetCaption()
	case msg.GetPtvMessage() != nil:
		return msg.GetPtvMessage().GetCaption()
	case msg.GetDocumentMessage() != nil:
		return msg.GetDocumentMessage().GetCaption()
	case msg.GetLocationMessage() != nil:
		loc := msg.GetLocationMessage()
		return firstNonEmpty(loc.GetName(), loc.GetAddress())
	case msg.GetContactMessage() != nil:
		return msg.GetContactMessage().GetDisplayName()
	case msg.GetContactsArrayMessage() != nil:
		return msg.GetContactsArrayMessage().GetDisplayName()
	default:
		return ""
	}
}

func enrichQuotedContent(msg *waE2E.Message, quoted map[string]any) {
	if msg == nil {
		return
	}
	if image := msg.GetImageMessage(); image != nil {
		quoted["image"] = map[string]any{
			"url":       nil,
			"caption":   nullableString(image.GetCaption()),
			"mimetype":  nullableString(image.GetMimetype()),
			"extension": nil,
			"size":      nullableUint64(image.GetFileLength()),
			"height":    nullableUint32(image.GetHeight()),
			"width":     nullableUint32(image.GetWidth()),
			"thumbnail": thumbnailDataURI(image.GetJPEGThumbnail()),
		}
		return
	}
	if video := firstVideoMessage(msg); video != nil {
		quoted["video"] = map[string]any{
			"url":       nil,
			"caption":   nullableString(video.GetCaption()),
			"name":      nil,
			"mimetype":  nullableString(video.GetMimetype()),
			"extension": nil,
			"size":      nullableUint64(video.GetFileLength()),
			"duration":  nullableUint32(video.GetSeconds()),
			"height":    nullableUint32(video.GetHeight()),
			"width":     nullableUint32(video.GetWidth()),
			"thumbnail": thumbnailDataURI(video.GetJPEGThumbnail()),
		}
		return
	}
	if doc := msg.GetDocumentMessage(); doc != nil {
		quoted["document"] = map[string]any{
			"url":       nil,
			"name":      nullableString(firstNonEmpty(doc.GetFileName(), doc.GetTitle())),
			"mimetype":  nullableString(doc.GetMimetype()),
			"extension": nil,
			"size":      nullableUint64(doc.GetFileLength()),
		}
		return
	}
	if audio := msg.GetAudioMessage(); audio != nil {
		quoted["audio"] = map[string]any{
			"url":       nil,
			"name":      nil,
			"mimetype":  nullableString(audio.GetMimetype()),
			"extension": nil,
			"size":      nullableUint64(audio.GetFileLength()),
			"duration":  nullableUint32(audio.GetSeconds()),
			"ptt":       audio.GetPTT(),
			"view_once": false,
		}
		return
	}
	if sticker := msg.GetStickerMessage(); sticker != nil {
		quoted["sticker"] = map[string]any{
			"url":         nil,
			"mimetype":    nullableString(sticker.GetMimetype()),
			"extension":   nil,
			"size":        nullableUint64(sticker.GetFileLength()),
			"height":      nullableUint32(sticker.GetHeight()),
			"width":       nullableUint32(sticker.GetWidth()),
			"is_animated": sticker.GetIsAnimated(),
		}
		return
	}
	if loc := msg.GetLocationMessage(); loc != nil {
		quoted["location"] = map[string]any{
			"latitude":  loc.GetDegreesLatitude(),
			"longitude": loc.GetDegreesLongitude(),
			"name":      nullableString(loc.GetName()),
			"address":   nullableString(loc.GetAddress()),
		}
		return
	}
	if contact := msg.GetContactMessage(); contact != nil {
		quoted["contact"] = quotedContactPayload(contact.GetDisplayName(), contact.GetVcard())
		return
	}
	if contacts := msg.GetContactsArrayMessage(); contacts != nil {
		items := make([]map[string]any, 0, len(contacts.GetContacts()))
		for _, contact := range contacts.GetContacts() {
			items = append(items, quotedContactPayload(contact.GetDisplayName(), contact.GetVcard()))
		}
		quoted["contacts"] = items
	}
}

func firstVideoMessage(msg *waE2E.Message) *waE2E.VideoMessage {
	if msg.GetVideoMessage() != nil {
		return msg.GetVideoMessage()
	}
	return msg.GetPtvMessage()
}

func nullableString(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func nullableUint32(value uint32) any {
	if value == 0 {
		return nil
	}
	return int(value)
}

func nullableUint64(value uint64) any {
	if value == 0 {
		return nil
	}
	return int64(value)
}

func thumbnailDataURI(thumbnail []byte) any {
	if len(thumbnail) == 0 {
		return nil
	}
	return "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(thumbnail)
}

func quotedContactPayload(name, vcard string) map[string]any {
	parsed := parseVCard(name, vcard)
	fullName := firstNonEmpty(stringValue(parsed["name"]), strings.TrimSpace(name), "Contato")
	phone := stringValue(parsed["phone"])
	return map[string]any{
		"contact_id":    "quoted_" + base64.RawURLEncoding.EncodeToString([]byte(firstNonEmpty(vcard, fullName, phone))),
		"name":          fullName,
		"last_name":     nil,
		"phone":         nullableString(phone),
		"phone_partial": nullableString(digits(phone)),
		"phone_ddi":     nil,
		"email":         nil,
		"email_partial": nil,
	}
}

func buildContextInfo(data ChatMessage) *waE2E.ContextInfo {
	var contextInfo *waE2E.ContextInfo
	if quoted := asMap(data.Content["quoted"]); len(quoted) > 0 {
		key := asMap(quoted["key"])
		stanzaID := stringValue(key["id"])
		if stanzaID != "" {
			remoteJID := firstNonEmpty(
				stringValue(key["remote_jid"]),
				stringValue(key["remoteJid"]),
				stringValue(key["remote_jid_alt"]),
				stringValue(key["remoteJidAlt"]),
			)
			participant := firstNonEmpty(
				stringValue(key["participant"]),
				stringValue(key["participant_alt"]),
				stringValue(key["participantAlt"]),
			)
			if participant == "" && !(boolValue(key["from_me"]) || boolValue(key["fromMe"])) {
				participant = remoteJID
			}
			contextInfo = &waE2E.ContextInfo{
				StanzaID:      proto.String(stanzaID),
				Participant:   proto.String(participant),
				RemoteJID:     proto.String(remoteJID),
				QuotedMessage: quotedMessageForContext(quoted),
			}
		}
	}
	mentions := stringSlice(data.Content["mentioned_jid"])
	if len(mentions) == 0 {
		mentions = stringSlice(asMap(data.Content["context_info"])["mentioned_jid"])
	}
	if len(mentions) > 0 {
		if contextInfo == nil {
			contextInfo = &waE2E.ContextInfo{}
		}
		contextInfo.MentionedJID = mentions
	}
	contextInfo = applyForwardContextInfo(data, contextInfo)
	return contextInfo
}

func applyForwardContextInfo(data ChatMessage, contextInfo *waE2E.ContextInfo) *waE2E.ContextInfo {
	context := asMap(data.Content["context_info"])
	score := uint32Value(firstNonEmptyAny(context["forwarding_score"], context["forwardingScore"]))
	isForwarded := len(asMap(data.Content["forward"])) > 0 ||
		boolValue(firstNonEmptyAny(context["is_forwarded"], context["isForwarded"])) ||
		score > 0
	if !isForwarded {
		return contextInfo
	}
	if contextInfo == nil {
		contextInfo = &waE2E.ContextInfo{}
	}
	if score == 0 {
		score = 1
	}
	contextInfo.IsForwarded = proto.Bool(true)
	contextInfo.ForwardingScore = proto.Uint32(score)
	return contextInfo
}

func quotedMessageForContext(quoted map[string]any) *waE2E.Message {
	quotedType := firstNonEmpty(stringValue(quoted["type"]), inferQuotedContentType(quoted))
	text := stringValue(quoted["message"])

	switch quotedType {
	case MessageTypeImage:
		image := asMap(quoted["image"])
		return &waE2E.Message{ImageMessage: &waE2E.ImageMessage{
			Caption:       proto.String(firstNonEmpty(stringValue(image["caption"]), text)),
			Mimetype:      proto.String(firstNonEmpty(stringValue(image["mimetype"]), "image/jpeg")),
			FileLength:    proto.Uint64(uint64Value(image["size"])),
			Height:        proto.Uint32(uint32Value(image["height"])),
			Width:         proto.Uint32(uint32Value(image["width"])),
			JPEGThumbnail: bytesFromJSONValue(image["thumbnail"]),
		}}
	case MessageTypeVideo, MessageTypeVideoNote:
		video := asMap(quoted["video"])
		videoMessage := &waE2E.VideoMessage{
			Caption:       proto.String(firstNonEmpty(stringValue(video["caption"]), text)),
			Mimetype:      proto.String(firstNonEmpty(stringValue(video["mimetype"]), "video/mp4")),
			FileLength:    proto.Uint64(uint64Value(video["size"])),
			Seconds:       proto.Uint32(uint32Value(video["duration"])),
			Height:        proto.Uint32(uint32Value(video["height"])),
			Width:         proto.Uint32(uint32Value(video["width"])),
			JPEGThumbnail: bytesFromJSONValue(video["thumbnail"]),
		}
		if quotedType == MessageTypeVideoNote {
			return &waE2E.Message{PtvMessage: videoMessage}
		}
		return &waE2E.Message{VideoMessage: videoMessage}
	case MessageTypeDocument:
		doc := asMap(quoted["document"])
		name := firstNonEmpty(stringValue(doc["name"]), stringValue(doc["file_name"]), "document")
		return &waE2E.Message{DocumentMessage: &waE2E.DocumentMessage{
			Caption:       proto.String(firstNonEmpty(stringValue(doc["caption"]), text)),
			Mimetype:      proto.String(firstNonEmpty(stringValue(doc["mimetype"]), "application/octet-stream")),
			FileLength:    proto.Uint64(uint64Value(doc["size"])),
			FileName:      proto.String(name),
			Title:         proto.String(name),
			JPEGThumbnail: bytesFromJSONValue(doc["thumbnail"]),
		}}
	case MessageTypeAudio:
		audio := asMap(quoted["audio"])
		viewOnce := boolValue(firstNonEmptyAny(audio["is_view_once"], audio["view_once"]))
		ptt := outgoingAudioPTT(audio, viewOnce)
		return &waE2E.Message{AudioMessage: &waE2E.AudioMessage{
			Mimetype:   proto.String(firstNonEmpty(stringValue(audio["mimetype"]), "audio/ogg; codecs=opus")),
			FileLength: proto.Uint64(uint64Value(audio["size"])),
			Seconds:    proto.Uint32(uint32Value(firstNonEmptyAny(audio["duration"], audio["seconds"]))),
			PTT:        proto.Bool(ptt),
			Waveform:   outgoingAudioWaveform(audio, ptt),
		}}
	case MessageTypeSticker:
		sticker := asMap(quoted["sticker"])
		return &waE2E.Message{StickerMessage: &waE2E.StickerMessage{
			Mimetype:   proto.String(firstNonEmpty(stringValue(sticker["mimetype"]), "image/webp")),
			FileLength: proto.Uint64(uint64Value(sticker["size"])),
			Height:     proto.Uint32(uint32Value(sticker["height"])),
			Width:      proto.Uint32(uint32Value(sticker["width"])),
			IsAnimated: proto.Bool(boolValue(sticker["is_animated"])),
		}}
	case MessageTypeLocation:
		location := asMap(quoted["location"])
		return &waE2E.Message{LocationMessage: &waE2E.LocationMessage{
			DegreesLatitude:  proto.Float64(floatValue(firstNonEmptyAny(location["latitude"], location["degreesLatitude"]))),
			DegreesLongitude: proto.Float64(floatValue(firstNonEmptyAny(location["longitude"], location["degreesLongitude"]))),
			Name:             proto.String(stringValue(location["name"])),
			Address:          proto.String(stringValue(location["address"])),
		}}
	case MessageTypeContact:
		return &waE2E.Message{ContactMessage: buildContactMessage(asMap(quoted["contact"]), nil)}
	case MessageTypeContacts:
		contactsRaw, _ := quoted["contacts"].([]any)
		contacts := make([]*waE2E.ContactMessage, 0, len(contactsRaw))
		for _, item := range contactsRaw {
			contacts = append(contacts, buildContactMessage(asMap(item), nil))
		}
		return &waE2E.Message{ContactsArrayMessage: &waE2E.ContactsArrayMessage{
			DisplayName: proto.String("Contacts"),
			Contacts:    contacts,
		}}
	default:
		return &waE2E.Message{Conversation: proto.String(text)}
	}
}

func inferQuotedContentType(quoted map[string]any) string {
	for _, item := range []struct {
		key         string
		messageType string
	}{
		{"image", MessageTypeImage},
		{"video", MessageTypeVideo},
		{"document", MessageTypeDocument},
		{"audio", MessageTypeAudio},
		{"sticker", MessageTypeSticker},
		{"location", MessageTypeLocation},
		{"contact", MessageTypeContact},
		{"contacts", MessageTypeContacts},
	} {
		if value, ok := quoted[item.key]; ok && value != nil {
			return item.messageType
		}
	}
	return MessageTypeText
}

func buildExtendedTextMessage(text string, data ChatMessage, contextInfo *waE2E.ContextInfo) *waE2E.ExtendedTextMessage {
	preview := asMap(data.Content["link_preview"])
	if contextInfo == nil && len(preview) == 0 {
		return nil
	}
	extended := &waE2E.ExtendedTextMessage{
		Text:        proto.String(text),
		ContextInfo: contextInfo,
	}
	if len(preview) == 0 {
		return extended
	}
	matchedText := firstNonEmpty(
		stringValue(preview["matchedText"]),
		stringValue(preview["matched-text"]),
		stringValue(preview["canonicalUrl"]),
		stringValue(preview["canonical-url"]),
	)
	if matchedText != "" {
		extended.MatchedText = proto.String(matchedText)
	}
	if title := stringValue(preview["title"]); title != "" {
		extended.Title = proto.String(title)
	}
	if description := stringValue(preview["description"]); description != "" {
		extended.Description = proto.String(description)
	}
	if thumbnail := bytesFromJSONValue(preview["jpegThumbnail"]); len(thumbnail) > 0 {
		extended.JPEGThumbnail = thumbnail
	}
	return extended
}

func buildContactMessage(contact map[string]any, contextInfo *waE2E.ContextInfo) *waE2E.ContactMessage {
	name := firstNonEmpty(stringValue(contact["name"]), stringValue(contact["display_name"]), stringValue(contact["phone"]))
	phone := firstNonEmpty(stringValue(contact["phone"]), stringValue(contact["phone_number"]))
	vcard := stringValue(contact["vcard"])
	if vcard == "" {
		vcard = fmt.Sprintf("BEGIN:VCARD\nVERSION:3.0\nFN:%s\nTEL;type=CELL;type=VOICE;waid=%s:%s\nEND:VCARD", name, digits(phone), phone)
	}
	return &waE2E.ContactMessage{
		DisplayName: proto.String(name),
		Vcard:       proto.String(vcard),
		ContextInfo: contextInfo,
	}
}

func parseVCard(name, vcard string) map[string]any {
	phone := ""
	for _, line := range strings.Split(vcard, "\n") {
		if strings.Contains(strings.ToUpper(line), "TEL") {
			parts := strings.Split(line, ":")
			phone = digits(parts[len(parts)-1])
			break
		}
	}
	return map[string]any{
		"name":  name,
		"phone": phone,
	}
}

func resolveTargetJID(data ChatMessage) (types.JID, error) {
	if data.MessageKey != nil {
		if remote := data.MessageKey.Remote(); remote != "" {
			return parseJID(remote)
		}
	}
	if data.ChatID != "" && strings.Contains(data.ChatID, "@") {
		return parseJID(data.ChatID)
	}
	phone := digits(data.PhoneDDI + data.Phone)
	if phone != "" {
		return types.NewJID(phone, types.DefaultUserServer), nil
	}
	return types.EmptyJID, fmt.Errorf("message target jid is required")
}

func parseJID(value string) (types.JID, error) {
	value = strings.TrimSpace(value)
	value = strings.ReplaceAll(value, "@c.us", "@s.whatsapp.net")
	if !strings.Contains(value, "@") {
		value = digits(value) + "@" + types.DefaultUserServer
	}
	return types.ParseJID(value)
}

func senderJIDFromKey(target types.JID, key *MessageKey) types.JID {
	if key == nil {
		return types.EmptyJID
	}
	if key.Participant != "" {
		if jid, err := parseJID(key.Participant); err == nil {
			return jid
		}
	}
	if !key.FromMeValue() {
		return target
	}
	return types.EmptyJID
}

func sentChatReadMessageKey(data ChatMessage, target types.JID, messageID string) MessageKey {
	fromMe := true
	key := MessageKey{}
	if data.MessageKey != nil {
		key = *data.MessageKey
	}
	if key.RemoteJID == "" && key.RemoteJIDC == "" {
		key.RemoteJID = target.String()
	}
	key.FromMe = &fromMe
	key.ID = messageID
	return key
}

type chatReadStatePatch struct {
	chat           types.JID
	lastMessageKey *waCommon.MessageKey
	timestamp      time.Time
}

func (m *WhatsAppManager) markChatAsReadAppState(ctx context.Context, client *whatsmeow.Client, key MessageKey, fallbackChat types.JID, timestamp time.Time) {
	if client == nil {
		return
	}
	patches := buildChatReadStatePatches(key, fallbackChat, timestamp)
	if len(patches) == 0 {
		return
	}
	appStateCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	for _, patch := range patches {
		if err := client.SendAppState(appStateCtx, appstate.BuildMarkChatAsRead(patch.chat, true, patch.timestamp, patch.lastMessageKey)); err != nil {
			log.Printf("whatsmeow mark chat read app state failed worker_id=%s chat=%s id=%s error=%v", m.cfg.WorkerID, patch.chat.String(), patch.lastMessageKey.GetID(), err)
		}
	}
}

func buildChatReadStatePatches(key MessageKey, fallbackChat types.JID, timestamp time.Time) []chatReadStatePatch {
	if strings.TrimSpace(key.ID) == "" {
		return nil
	}
	chats := chatReadJIDCandidates(key, fallbackChat)
	patches := make([]chatReadStatePatch, 0, len(chats))
	for _, chat := range chats {
		lastMessageKey := buildChatReadMessageKey(chat, key)
		if lastMessageKey == nil {
			continue
		}
		patches = append(patches, chatReadStatePatch{
			chat:           chat,
			lastMessageKey: lastMessageKey,
			timestamp:      timestamp,
		})
	}
	return patches
}

func chatReadJIDCandidates(key MessageKey, fallbackChat types.JID) []types.JID {
	rawCandidates := []string{
		key.RemoteJID,
		key.RemoteJIDC,
		key.RemoteJIDAlt,
		key.RemoteJIDAltC,
	}
	if !fallbackChat.IsEmpty() {
		rawCandidates = append(rawCandidates, fallbackChat.String())
	}

	seen := map[string]struct{}{}
	candidates := make([]types.JID, 0, len(rawCandidates))
	for _, rawCandidate := range rawCandidates {
		if strings.TrimSpace(rawCandidate) == "" {
			continue
		}
		jid, err := parseJID(rawCandidate)
		if err != nil || jid.IsEmpty() {
			continue
		}
		jid = nonADJID(jid)
		key := jid.String()
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		candidates = append(candidates, jid)
	}
	return candidates
}

func buildChatReadMessageKey(chat types.JID, key MessageKey) *waCommon.MessageKey {
	id := strings.TrimSpace(key.ID)
	if id == "" || chat.IsEmpty() {
		return nil
	}
	messageKey := &waCommon.MessageKey{
		RemoteJID: proto.String(chat.String()),
		FromMe:    proto.Bool(key.FromMeValue()),
		ID:        proto.String(id),
	}
	if participant := chatReadParticipant(chat, key); !participant.IsEmpty() {
		messageKey.Participant = proto.String(participant.String())
	}
	return messageKey
}

func chatReadParticipant(chat types.JID, key MessageKey) types.JID {
	if chat.Server == types.DefaultUserServer || chat.Server == types.HiddenUserServer || chat.Server == types.MessengerServer {
		return types.EmptyJID
	}
	for _, rawParticipant := range []string{key.Participant, key.ParticipantAlt, key.ParticipantAltC} {
		if strings.TrimSpace(rawParticipant) == "" {
			continue
		}
		participant, err := parseJID(rawParticipant)
		if err == nil && !participant.IsEmpty() {
			return nonADJID(participant)
		}
	}
	return types.EmptyJID
}

func firstUnsupportedContent(content map[string]any) string {
	for _, key := range []string{
		"template",
		"template_buttons",
		"buttons",
		"button",
		"interactive",
		"list",
		"list_response",
		"product",
		"product_message",
		"poll",
		"poll_creation",
		"poll_update",
		"flow",
		"flow_response",
		"pin",
		"ephemeral",
		"broadcast",
		"broadcast_list",
		"call",
		"voice_call",
		"video_call",
	} {
		if value, ok := content[key]; ok && value != nil {
			return key
		}
	}
	return ""
}

func splitStatusValue(value string) (string, string) {
	parts := strings.Split(value, "|")
	url := strings.TrimSpace(parts[0])
	if len(parts) == 1 {
		return url, ""
	}
	return url, strings.TrimSpace(strings.Join(parts[1:], "|"))
}

func downloadURL(ctx context.Context, rawURL string) ([]byte, string, string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, "", "", err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, "", "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, "", "", fmt.Errorf("download failed: %s", resp.Status)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, "", "", err
	}
	contentType := resp.Header.Get("Content-Type")
	fileName := path.Base(req.URL.Path)
	if fileName == "." || fileName == "/" || fileName == "" {
		fileName = randomHex(8) + extensionFromMime(contentType)
	}
	return body, contentType, fileName, nil
}

func extensionFromMime(mimetype string) string {
	if mimetype == "" {
		return ".bin"
	}
	if exts, err := mime.ExtensionsByType(strings.Split(mimetype, ";")[0]); err == nil && len(exts) > 0 {
		return exts[0]
	}
	return ".bin"
}

func asMap(value any) map[string]any {
	switch typed := value.(type) {
	case map[string]any:
		return typed
	default:
		return map[string]any{}
	}
}

func stringValue(value any) string {
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case fmt.Stringer:
		return strings.TrimSpace(typed.String())
	case json.Number:
		return typed.String()
	case float64:
		return strconv.FormatFloat(typed, 'f', -1, 64)
	case int:
		return strconv.Itoa(typed)
	default:
		return ""
	}
}

func valueString(value any, key string) string {
	return stringValue(asMap(value)[key])
}

func boolValue(value any) bool {
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		normalized := strings.ToLower(strings.TrimSpace(typed))
		return normalized == "true" || normalized == "1" || normalized == "yes" || normalized == "on"
	case float64:
		return typed == 1
	default:
		return false
	}
}

func optionalBoolValue(value any) (bool, bool) {
	if value == nil {
		return false, false
	}
	switch typed := value.(type) {
	case bool:
		return typed, true
	case string:
		normalized := strings.ToLower(strings.TrimSpace(typed))
		if normalized == "" {
			return false, false
		}
		return normalized == "true" || normalized == "1" || normalized == "yes" || normalized == "on", true
	case float64:
		return typed == 1, true
	case float32:
		return typed == 1, true
	case int:
		return typed == 1, true
	case int64:
		return typed == 1, true
	case uint32:
		return typed == 1, true
	case uint64:
		return typed == 1, true
	case json.Number:
		parsed, err := typed.Int64()
		if err != nil {
			return false, false
		}
		return parsed == 1, true
	default:
		return false, false
	}
}

func outgoingAudioPTT(media map[string]any, viewOnce bool) bool {
	if viewOnce {
		return true
	}
	for _, key := range []string{"ptt", "is_voice", "isVoice"} {
		if value, ok := optionalBoolValue(media[key]); ok {
			return value
		}
	}
	return true
}

func outgoingAudioWaveform(media map[string]any, ptt bool) []byte {
	if !ptt {
		return nil
	}
	return bytesFromJSONValue(firstNonEmptyAny(media["waveform"], media["waveform_base64"], media["waveformBase64"]))
}

func floatValue(value any) float64 {
	switch typed := value.(type) {
	case float64:
		return typed
	case float32:
		return float64(typed)
	case int:
		return float64(typed)
	case int64:
		return float64(typed)
	case uint32:
		return float64(typed)
	case uint64:
		return float64(typed)
	case json.Number:
		parsed, _ := typed.Float64()
		return parsed
	case string:
		parsed, _ := strconv.ParseFloat(strings.TrimSpace(typed), 64)
		return parsed
	default:
		return 0
	}
}

func uint32Value(value any) uint32 {
	if value == nil {
		return 0
	}
	if parsed := floatValue(value); parsed > 0 {
		return uint32(parsed)
	}
	return 0
}

func uint64Value(value any) uint64 {
	if value == nil {
		return 0
	}
	if parsed := floatValue(value); parsed > 0 {
		return uint64(parsed)
	}
	return 0
}

func firstNonEmptyAny(values ...any) any {
	for _, value := range values {
		if value == nil {
			continue
		}
		if stringValue(value) != "" {
			return value
		}
		switch typed := value.(type) {
		case int:
			if typed != 0 {
				return value
			}
		case int64:
			if typed != 0 {
				return value
			}
		case uint32:
			if typed != 0 {
				return value
			}
		case uint64:
			if typed != 0 {
				return value
			}
		case float32:
			if typed != 0 {
				return value
			}
		case float64:
			if typed != 0 {
				return value
			}
		case bool:
			return value
		}
	}
	return nil
}

func stringSlice(value any) []string {
	switch typed := value.(type) {
	case []string:
		return typed
	case []any:
		out := make([]string, 0, len(typed))
		for _, item := range typed {
			if value := stringValue(item); value != "" {
				out = append(out, value)
			}
		}
		return out
	default:
		return nil
	}
}

func bytesFromJSONValue(value any) []byte {
	switch typed := value.(type) {
	case []byte:
		return typed
	case string:
		encoded := strings.TrimSpace(typed)
		if strings.HasPrefix(encoded, "data:") {
			if _, payload, ok := strings.Cut(encoded, ","); ok {
				encoded = payload
			}
		}
		data, err := base64.StdEncoding.DecodeString(encoded)
		if err == nil {
			return data
		}
	case []any:
		out := make([]byte, 0, len(typed))
		for _, item := range typed {
			out = append(out, byte(floatValue(item)))
		}
		return out
	case map[string]any:
		return bytesFromJSONValue(typed["data"])
	}
	return nil
}

func messageKeyFromSendResult(result map[string]any) string {
	return valueString(result["key"], "id")
}

func mapToChatMessage(raw []byte) (ChatMessage, error) {
	var data ChatMessage
	if err := json.Unmarshal(raw, &data); err != nil {
		return data, err
	}
	var rawMap map[string]any
	_ = json.Unmarshal(raw, &rawMap)
	data.Raw = rawMap
	return data, nil
}

func mapToProfileStatusMessage(raw []byte) (ProfileStatusMessage, bool, error) {
	rawMap, err := mapToRawPayload(raw)
	if err != nil {
		return ProfileStatusMessage{}, false, err
	}
	if stringValue(rawMap["worker_profile_status_id"]) == "" || stringValue(rawMap["external_id"]) != "" {
		return ProfileStatusMessage{}, false, nil
	}
	if stringValue(rawMap["worker_profile_status_type_id"]) == "" {
		return ProfileStatusMessage{}, false, nil
	}
	var data ProfileStatusMessage
	if err := json.Unmarshal(raw, &data); err != nil {
		return ProfileStatusMessage{}, false, err
	}
	data.Raw = rawMap
	return data, true, nil
}

func mapToProfileStatusDeleteMessage(raw []byte) (ProfileStatusDeleteMessage, bool, error) {
	rawMap, err := mapToRawPayload(raw)
	if err != nil {
		return ProfileStatusDeleteMessage{}, false, err
	}
	if stringValue(rawMap["worker_profile_status_id"]) == "" || stringValue(rawMap["external_id"]) == "" {
		return ProfileStatusDeleteMessage{}, false, nil
	}
	var data ProfileStatusDeleteMessage
	if err := json.Unmarshal(raw, &data); err != nil {
		return ProfileStatusDeleteMessage{}, false, err
	}
	data.Raw = rawMap
	return data, true, nil
}

func mapToProfileInfoMessage(raw []byte) (ProfileInfoMessage, bool, error) {
	rawMap, err := mapToRawPayload(raw)
	if err != nil {
		return ProfileInfoMessage{}, false, err
	}
	if stringValue(rawMap["message_id"]) != "" || stringValue(rawMap["worker_profile_status_id"]) != "" {
		return ProfileInfoMessage{}, false, nil
	}
	if stringValue(rawMap["worker_id"]) == "" || stringValue(rawMap["account_id"]) == "" {
		return ProfileInfoMessage{}, false, nil
	}
	_, hasName := rawMap["name"]
	_, hasMessage := rawMap["message"]
	photoValue, hasPhoto := rawMap["photo"]
	if !hasName && !hasMessage && !hasPhoto {
		return ProfileInfoMessage{}, false, nil
	}
	var data ProfileInfoMessage
	if err := json.Unmarshal(raw, &data); err != nil {
		return ProfileInfoMessage{}, false, err
	}
	data.PhotoPresent = hasPhoto
	data.PhotoRemove = hasPhoto && photoValue == nil
	data.Raw = rawMap
	return data, true, nil
}

func mapToRawPayload(raw []byte) (map[string]any, error) {
	var rawMap map[string]any
	if err := json.Unmarshal(raw, &rawMap); err != nil {
		return nil, err
	}
	if rawMap == nil {
		rawMap = map[string]any{}
	}
	return rawMap, nil
}

func waKeyMap(key MessageKey) map[string]any {
	return map[string]any{
		"id":          key.ID,
		"remoteJid":   key.Remote(),
		"fromMe":      key.FromMeValue(),
		"participant": key.Participant,
	}
}
