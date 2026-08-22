package app

import (
	"log"

	waLog "go.mau.fi/whatsmeow/util/log"
)

const whatsappSessionDebugPrefix = waLog.SessionDebugPrefix

// logWhatsappSessionDebug funnels worker and SQLStore diagnostics through the
// same process-wide sanitizer, byte bound and per-session rate limiter.
func logWhatsappSessionDebug(enabled bool, event string, fields map[string]any) {
	payload := make(map[string]any, len(fields)+1)
	for key, value := range fields {
		payload[key] = value
	}
	payload["layer"] = "worker_whatsmeow"
	waLog.WriteSessionDebug(enabled, event, payload, func(line string) {
		log.Print(line)
	})
}
