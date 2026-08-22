package app

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
)

const messageStatusEventIDVersion = "v1"

func messageStatusRevision(update *MessageStatusUpdate) string {
	if update == nil {
		return "unknown"
	}
	if update.Failed && update.Ambiguous {
		return "ambiguous"
	}
	if update.Failed {
		return "failed"
	}
	if value, _ := update.Patch["is_seen"].(bool); value {
		return "seen"
	}
	if value, _ := update.Patch["is_delivered"].(bool); value {
		return "delivered"
	}
	if value, _ := update.Patch["is_sent"].(bool); value {
		return "sent"
	}
	return "unknown"
}

func ensureMessageStatusEventID(update *MessageStatusUpdate) string {
	if update == nil {
		return ""
	}
	if existing := strings.TrimSpace(update.EventID); existing != "" {
		update.EventID = existing
		return existing
	}
	accountID := strings.TrimSpace(update.AccountID)
	workerID := strings.TrimSpace(update.WorkerID)
	messageID := canonicalInboundStanzaID(update.MessageID)
	if accountID == "" || workerID == "" || messageID == "" {
		return ""
	}
	canonical := strings.Join([]string{
		messageStatusEventIDVersion,
		accountID,
		workerID,
		messageID,
		messageStatusRevision(update),
	}, "\x00")
	digest := sha256.Sum256([]byte(canonical))
	update.EventID = "message_status_" + messageStatusEventIDVersion + "_" + hex.EncodeToString(digest[:])
	return update.EventID
}

func messageStatusKafkaKey(accountID, workerID, messageID string) string {
	return strings.Join([]string{
		strings.TrimSpace(accountID),
		strings.TrimSpace(workerID),
		canonicalInboundStanzaID(messageID),
	}, ":")
}
