package app

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
)

const messageUpdateEventIDVersion = "v1"

func ensureMessageUpdateEventID(update *UpdateMessage) string {
	if update == nil {
		return ""
	}
	if existing := strings.TrimSpace(update.EventID); existing != "" {
		update.EventID = existing
		return existing
	}
	accountID := strings.TrimSpace(stringValue(update.Data.Account["id"]))
	workerID := strings.TrimSpace(firstNonEmpty(
		update.WorkerID,
		stringValue(update.Data.Worker["id"]),
	))
	internalMessageID := strings.TrimSpace(update.Data.MessageID)
	providerMessageID := canonicalInboundStanzaID(
		valueString(update.Message["key"], "id"),
	)
	if accountID == "" || workerID == "" || internalMessageID == "" || providerMessageID == "" {
		return ""
	}
	canonical := strings.Join([]string{
		messageUpdateEventIDVersion,
		accountID,
		workerID,
		internalMessageID,
		providerMessageID,
	}, "\x00")
	digest := sha256.Sum256([]byte(canonical))
	update.EventID = "message_update_" + messageUpdateEventIDVersion + "_" + hex.EncodeToString(digest[:])
	return update.EventID
}
