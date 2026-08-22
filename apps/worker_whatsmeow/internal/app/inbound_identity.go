package app

import (
	"crypto/sha256"
	"encoding/hex"
	"strconv"
	"strings"
)

const inboundEventIDPrefix = "waevt_v1_"

func stableCallInboundEventID(accountID, workerID, callID, eventJID string) string {
	accountID = strings.TrimSpace(accountID)
	workerID = strings.TrimSpace(workerID)
	callID = strings.TrimSpace(callID)
	eventJID = canonicalInboundJID(eventJID)
	if accountID == "" || workerID == "" || callID == "" || eventJID == "" {
		return ""
	}
	// Keep the shared inbound-v1 field contract. CallCreator is used as the
	// stable event JID because CallOffer and CallOfferNotice may expose different
	// conversation/group JIDs for the same immutable call ID.
	digest := sha256.Sum256([]byte(strings.Join([]string{
		"v1",
		accountID,
		workerID,
		"call",
		eventJID,
		"0",
		"",
		"call_" + callID,
		callID,
	}, "\x00")))
	return inboundEventIDPrefix + hex.EncodeToString(digest[:])
}

func ensureInboundEventIdentity(upsert *UpsertMessage, eventSource string) string {
	if upsert == nil {
		return ""
	}
	if existing := strings.TrimSpace(upsert.EventID); existing != "" {
		upsert.EventID = existing
		return existing
	}

	messageKey := asMap(upsert.Message["key"])
	parsed := parseInboundSerializedStanzaID(valueString(messageKey, "id"))
	remoteJID := preferredCanonicalJID(
		valueString(messageKey, "remoteJid"),
		valueString(messageKey, "remoteJidAlt"),
		parsed.RemoteJID,
	)
	participant := preferredCanonicalJID(
		valueString(messageKey, "participant"),
		valueString(messageKey, "participantAlt"),
	)
	fromMe := "0"
	if parsed.Valid {
		if parsed.FromMe {
			fromMe = "1"
		}
	} else if boolValue(messageKey["fromMe"]) {
		fromMe = "1"
	}
	eventKind := inboundEventKind(upsert, eventSource)
	eventRevision := strings.TrimSpace(upsert.EventRevision)
	if eventRevision == "" && inboundEventKindHasRevision(eventKind) {
		eventRevision = canonicalEventRevisionSeconds(upsert.Message["messageTimestamp"])
		upsert.EventRevision = eventRevision
	}
	// Mutations can legitimately repeat against the same target stanza. Without
	// a provider revision/action timestamp they are not safely deduplicable, so
	// leave event_id empty and let every physical delivery through.
	if inboundEventKindHasRevision(eventKind) && eventRevision == "" {
		return ""
	}
	stanzaID := parsed.StanzaID
	if !parsed.Valid {
		stanzaID = canonicalInboundStanzaID(valueString(messageKey, "id"))
	}
	accountID := strings.TrimSpace(upsert.AccountID)
	workerID := strings.TrimSpace(upsert.WorkerID)
	if accountID == "" || workerID == "" || stanzaID == "" {
		return ""
	}
	if remoteJID == "" {
		remoteJID = "unknown"
	}
	fields := []string{
		"v1",
		accountID,
		workerID,
		eventKind,
		remoteJID,
		fromMe,
		participant,
		stanzaID,
		eventRevision,
	}
	digest := sha256.Sum256([]byte(strings.Join(fields, "\x00")))
	upsert.EventID = inboundEventIDPrefix + hex.EncodeToString(digest[:])
	return upsert.EventID
}

func inboundEventKind(upsert *UpsertMessage, eventSource string) string {
	if upsert == nil {
		return "message"
	}
	if upsert.IsCallEvent || eventSource == "call_event" {
		return "call"
	}
	if inboundMessageHasPinAction(upsert.Message) {
		return "annotation"
	}
	switch strings.TrimSpace(upsert.Type) {
	case MessageTypeEditText:
		return "edit"
	case MessageTypeDelete:
		return "delete"
	case MessageTypeReact:
		return "reaction"
	case "annotation":
		return "annotation"
	}
	return "message"
}

func inboundEventKindHasRevision(eventKind string) bool {
	switch eventKind {
	case "edit", "delete", "reaction", "annotation", "call":
		return true
	default:
		return false
	}
}

func inboundMessageHasPinAction(message map[string]any) bool {
	payload := asMap(message["message"])
	for len(payload) > 0 {
		if payload["pinInChatMessage"] != nil || payload["pin_in_chat_message"] != nil {
			return true
		}
		var nested map[string]any
		for _, wrapper := range []string{"ephemeralMessage", "viewOnceMessage", "viewOnceMessageV2", "viewOnceMessageV2Extension"} {
			if candidate := asMap(asMap(payload[wrapper])["message"]); len(candidate) > 0 {
				nested = candidate
				break
			}
		}
		payload = nested
	}
	return false
}

func canonicalEventRevisionSeconds(value any) string {
	raw := strings.TrimSpace(stringValue(value))
	if raw == "" {
		return ""
	}
	timestamp, err := strconv.ParseFloat(raw, 64)
	if err != nil || timestamp <= 0 {
		return ""
	}
	if timestamp >= 1_000_000_000_000 {
		timestamp /= 1000
	}
	return strconv.FormatInt(int64(timestamp), 10)
}

func preferredCanonicalJID(primary, alternate string, serialized ...string) string {
	primary = canonicalInboundJID(primary)
	alternate = canonicalInboundJID(alternate)
	if alternate != "" && !strings.HasSuffix(alternate, "@lid") {
		return alternate
	}
	if primary != "" && !strings.HasSuffix(primary, "@lid") {
		return primary
	}
	for _, candidate := range serialized {
		candidate = canonicalInboundJID(candidate)
		if candidate != "" && !strings.HasSuffix(candidate, "@lid") {
			return candidate
		}
	}
	if primary != "" {
		return primary
	}
	if alternate != "" {
		return alternate
	}
	for _, candidate := range serialized {
		if candidate = canonicalInboundJID(candidate); candidate != "" {
			return candidate
		}
	}
	return ""
}

func canonicalInboundJID(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	at := strings.LastIndex(value, "@")
	if at < 0 {
		return value
	}
	user := value[:at]
	server := value[at+1:]
	if device := strings.Index(user, ":"); device >= 0 {
		user = user[:device]
	}
	if strings.EqualFold(server, "c.us") {
		server = "s.whatsapp.net"
	}
	return user + "@" + server
}

func canonicalInboundStanzaID(value string) string {
	parsed := parseInboundSerializedStanzaID(value)
	if parsed.Valid {
		return parsed.StanzaID
	}
	return strings.TrimSpace(value)
}

type parsedInboundStanzaID struct {
	Valid     bool
	FromMe    bool
	RemoteJID string
	StanzaID  string
}

func parseInboundSerializedStanzaID(value string) parsedInboundStanzaID {
	value = strings.TrimSpace(value)
	firstSeparator := strings.Index(value, "_")
	lastSeparator := strings.LastIndex(value, "_")
	if firstSeparator <= 0 || lastSeparator <= firstSeparator {
		return parsedInboundStanzaID{}
	}
	fromMe := value[:firstSeparator]
	if fromMe != "true" && fromMe != "false" {
		return parsedInboundStanzaID{}
	}
	remoteJID := strings.TrimSpace(value[firstSeparator+1 : lastSeparator])
	stanzaID := strings.TrimSpace(value[lastSeparator+1:])
	if remoteJID == "" || stanzaID == "" {
		return parsedInboundStanzaID{}
	}
	return parsedInboundStanzaID{Valid: true, FromMe: fromMe == "true", RemoteJID: remoteJID, StanzaID: stanzaID}
}
