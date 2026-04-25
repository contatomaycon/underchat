package app

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/http"
	"path"
	"strconv"
	"strings"
	"time"

	"go.mau.fi/whatsmeow"
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
	sendCtx, cancel := context.WithTimeout(ctx, m.cfg.SendTimeout)
	defer cancel()
	resp, err := client.SendMessage(sendCtx, target, msg)
	if err != nil {
		return nil, err
	}
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
		return UnsupportedFeatureError{Feature: "profile_name"}
	}
	if strings.TrimSpace(data.Message) != "" {
		if err := client.SetStatusMessage(ctx, data.Message); err != nil {
			return err
		}
	}
	if data.PhotoPresent {
		if client.Store.ID == nil {
			return fmt.Errorf("own profile jid is unavailable")
		}
		if data.PhotoRemove {
			_, err := client.SetGroupPhoto(ctx, *client.Store.ID, nil)
			return err
		}
		body, _, _, err := downloadURL(ctx, data.Photo)
		if err != nil {
			return err
		}
		_, err = client.SetGroupPhoto(ctx, *client.Store.ID, body)
		return err
	}
	return nil
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
		return &waE2E.Message{AudioMessage: &waE2E.AudioMessage{
			URL:               proto.String(upload.URL),
			DirectPath:        proto.String(upload.DirectPath),
			Mimetype:          proto.String(firstNonEmpty(contentType, "audio/ogg; codecs=opus")),
			MediaKey:          upload.MediaKey,
			FileEncSHA256:     upload.FileEncSHA256,
			FileSHA256:        upload.FileSHA256,
			FileLength:        proto.Uint64(upload.FileLength),
			MediaKeyTimestamp: proto.Int64(now),
			ContextInfo:       contextInfo,
			PTT:               proto.Bool(boolValue(media["ptt"]) || boolValue(media["is_voice"])),
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
		return MessageTypeViewOnce, map[string]any{"type": MessageTypeViewOnce}
	}
	base := map[string]any{}
	if text := msg.GetConversation(); text != "" {
		return MessageTypeText, map[string]any{"type": MessageTypeText, "message": text}
	}
	if ext := msg.GetExtendedTextMessage(); ext != nil {
		return MessageTypeText, map[string]any{"type": MessageTypeText, "message": ext.GetText()}
	}
	if protocolMsg := msg.GetProtocolMessage(); protocolMsg != nil {
		if protocolMsg.Type == nil {
			return "", nil
		}
		switch protocolMsg.GetType() {
		case waE2E.ProtocolMessage_REVOKE:
			return MessageTypeDelete, map[string]any{"type": MessageTypeDelete, "message": "Mensagem apagada"}
		case waE2E.ProtocolMessage_MESSAGE_EDIT:
			edited := protocolMsg.GetEditedMessage()
			if edited == nil {
				return "", nil
			}
			message := edited.GetConversation()
			if message == "" && edited.GetExtendedTextMessage() != nil {
				message = edited.GetExtendedTextMessage().GetText()
			}
			return MessageTypeEditText, map[string]any{"type": MessageTypeEditText, "message": message}
		case waE2E.ProtocolMessage_EPHEMERAL_SETTING, waE2E.ProtocolMessage_EPHEMERAL_SYNC_RESPONSE:
			return MessageTypeSetDisappearingMessages, map[string]any{"type": MessageTypeSetDisappearingMessages}
		default:
			return "", nil
		}
	}
	if reaction := msg.GetReactionMessage(); reaction != nil {
		return MessageTypeReact, map[string]any{
			"type":    MessageTypeReact,
			"message": reaction.GetText(),
			"reactions": []map[string]any{{
				"emoji": reaction.GetText(),
			}},
		}
	}
	if msg.GetEncReactionMessage() != nil {
		return MessageTypeReact, map[string]any{"type": MessageTypeReact, "message": ""}
	}
	if msg.GetPinInChatMessage() != nil {
		return MessageTypeSystem, map[string]any{"type": MessageTypeSystem, "message": ""}
	}
	if template := msg.GetTemplateMessage(); template != nil && template.GetHydratedTemplate() != nil {
		text := template.GetHydratedTemplate().GetHydratedContentText()
		return MessageTypeText, map[string]any{"type": MessageTypeText, "message": text}
	}
	if image := msg.GetImageMessage(); image != nil {
		base = mediaContent(ctx, m, image, MessageTypeImage, image.GetCaption(), image.GetMimetype(), viewOnce)
		return MessageTypeImage, base
	}
	if video := msg.GetVideoMessage(); video != nil {
		base = mediaContent(ctx, m, video, MessageTypeVideo, video.GetCaption(), video.GetMimetype(), viewOnce)
		return MessageTypeVideo, base
	}
	if video := msg.GetPtvMessage(); video != nil {
		base = mediaContent(ctx, m, video, MessageTypeVideoNote, video.GetCaption(), video.GetMimetype(), viewOnce)
		return MessageTypeVideoNote, base
	}
	if audio := msg.GetAudioMessage(); audio != nil {
		base = mediaContent(ctx, m, audio, MessageTypeAudio, "", audio.GetMimetype(), viewOnce)
		if audio.GetPTT() {
			asMap(base["audio"])["ptt"] = true
		}
		return MessageTypeAudio, base
	}
	if doc := msg.GetDocumentMessage(); doc != nil {
		base = mediaContent(ctx, m, doc, MessageTypeDocument, doc.GetCaption(), doc.GetMimetype(), viewOnce)
		asMap(base["document"])["name"] = firstNonEmpty(doc.GetFileName(), doc.GetTitle())
		return MessageTypeDocument, base
	}
	if sticker := msg.GetStickerMessage(); sticker != nil {
		base = mediaContent(ctx, m, sticker, MessageTypeSticker, "", sticker.GetMimetype(), viewOnce)
		asMap(base["sticker"])["is_animated"] = sticker.GetIsAnimated()
		asMap(base["sticker"])["is_lottie"] = sticker.GetIsLottie()
		return MessageTypeSticker, base
	}
	if loc := msg.GetLocationMessage(); loc != nil {
		return MessageTypeLocation, map[string]any{
			"type": MessageTypeLocation,
			"location": map[string]any{
				"latitude":  loc.GetDegreesLatitude(),
				"longitude": loc.GetDegreesLongitude(),
				"name":      loc.GetName(),
				"address":   loc.GetAddress(),
			},
		}
	}
	if contact := msg.GetContactMessage(); contact != nil {
		return MessageTypeContact, map[string]any{
			"type":    MessageTypeContact,
			"contact": parseVCard(contact.GetDisplayName(), contact.GetVcard()),
		}
	}
	if contacts := msg.GetContactsArrayMessage(); contacts != nil {
		items := make([]map[string]any, 0, len(contacts.GetContacts()))
		for _, contact := range contacts.GetContacts() {
			items = append(items, parseVCard(contact.GetDisplayName(), contact.GetVcard()))
		}
		return MessageTypeContacts, map[string]any{"type": MessageTypeContacts, "contacts": items}
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
	}
	client := manager.getClient()
	if client != nil && manager.storage != nil {
		data, err := client.Download(ctx, media)
		if err == nil {
			name := randomHex(8) + extensionFromMime(mimetype)
			object, uploadErr := manager.storage.Upload(ctx, manager.cfg.AccountID, data, name, mimetype)
			if uploadErr == nil {
				entry["url"] = object.URL
				entry["name"] = object.Name
				entry["size"] = object.Size
			} else {
				entry["media_download_failed"] = true
			}
		} else {
			entry["media_download_failed"] = true
		}
	}
	content[key] = entry
	if failed, _ := entry["media_download_failed"].(bool); failed {
		content["media_download_failed"] = true
	}
	return content
}

func buildContextInfo(data ChatMessage) *waE2E.ContextInfo {
	var contextInfo *waE2E.ContextInfo
	if quoted := asMap(data.Content["quoted"]); len(quoted) > 0 {
		key := asMap(quoted["key"])
		stanzaID := stringValue(key["id"])
		if stanzaID != "" {
			contextInfo = &waE2E.ContextInfo{
				StanzaID:      proto.String(stanzaID),
				Participant:   proto.String(firstNonEmpty(stringValue(key["participant"]), stringValue(key["remote_jid"]))),
				RemoteJID:     proto.String(stringValue(key["remote_jid"])),
				QuotedMessage: &waE2E.Message{Conversation: proto.String(stringValue(quoted["message"]))},
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
	return contextInfo
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
	if forward := asMap(content["forward"]); len(forward) > 0 {
		return "forward"
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

func floatValue(value any) float64 {
	switch typed := value.(type) {
	case float64:
		return typed
	case float32:
		return float64(typed)
	case int:
		return float64(typed)
	case string:
		parsed, _ := strconv.ParseFloat(strings.TrimSpace(typed), 64)
		return parsed
	default:
		return 0
	}
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
		data, err := base64.StdEncoding.DecodeString(strings.TrimSpace(typed))
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
