package app

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
)

const scheduleStatusEventIDVersion = "v1"

func ensureScheduleStatusEventID(update *ScheduleStatusUpdate) string {
	if update == nil {
		return ""
	}
	if existing := strings.TrimSpace(update.EventID); existing != "" {
		update.EventID = existing
		return existing
	}
	canonicalParts := []string{
		scheduleStatusEventIDVersion,
		strings.TrimSpace(update.ScheduleID),
		strings.TrimSpace(update.ContactID),
		strings.TrimSpace(update.MessageID),
		strings.TrimSpace(update.Status),
	}
	canonical := strings.Join(canonicalParts, "\x00")
	digest := sha256.Sum256([]byte(canonical))
	update.EventID = "schedule_status_" + scheduleStatusEventIDVersion + "_" + hex.EncodeToString(digest[:])
	return update.EventID
}
