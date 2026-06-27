package app

import (
	"context"
	"encoding/json"
	"log"
	"os"
	"strings"
	"time"
)

type selfHealRecoveryState struct {
	WorkerID              string `json:"worker_id"`
	AccountID             string `json:"account_id,omitempty"`
	WorkerTypeID          string `json:"worker_type_id,omitempty"`
	Source                string `json:"source,omitempty"`
	Reason                string `json:"reason,omitempty"`
	ProviderState         string `json:"provider_state,omitempty"`
	DegradedReason        string `json:"degraded_reason,omitempty"`
	KafkaUnhealthy        bool   `json:"kafka_unhealthy,omitempty"`
	RuntimeGeneration     int    `json:"runtime_generation,omitempty"`
	OperationID           string `json:"operation_id,omitempty"`
	RequestedAt           string `json:"requested_at"`
	DeadlineAt            string `json:"deadline_at"`
	RecoveryWindowSeconds int    `json:"recovery_window_seconds"`
	DebugTraceID          string `json:"debug_trace_id,omitempty"`
}

func (w *Worker) startSelfMonitor(ctx context.Context) {
	if w.cfg.WarmStandby {
		return
	}

	if w.cfg.SelfMonitorInitialDelay > 0 {
		timer := time.NewTimer(w.cfg.SelfMonitorInitialDelay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
	}

	ticker := time.NewTicker(w.cfg.SelfMonitorInterval)
	defer ticker.Stop()

	failures := 0
	for {
		failures = w.runSelfMonitorCheck(ctx, failures)

		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (w *Worker) runSelfMonitorCheck(ctx context.Context, failures int) int {
	manager := w.currentWhatsApp()
	health := map[string]any{
		"session_ready":       false,
		"can_send":            false,
		"can_receive_runtime": false,
		"authenticated":       false,
		"provider_state":      "not_initialized",
		"degraded_reason":     "runtime_not_initialized",
	}
	if manager != nil {
		health = manager.ConnectionHealth()
	}

	kafkaUnhealthy := w.kafka != nil && w.kafka.HasUnhealthyConsumers()
	healthy := selfMonitorHealthReady(health, kafkaUnhealthy)

	w.handleSelfHealRecoveryWindow(ctx, health, kafkaUnhealthy, healthy)
	w.maybeRequestDailyMaintenance(ctx, health, kafkaUnhealthy)

	if healthy {
		return 0
	}

	nextFailures := failures + 1
	consumerHealthCount := 0
	if w.kafka != nil {
		consumerHealthCount = len(w.kafka.ConsumerHealthSnapshot())
	}
	localConnectionStatusLog("whatsmeow.self_monitor.unhealthy", map[string]any{
		"layer":                 "worker_whatsmeow.self_monitor",
		"provider":              "whatsmeow",
		"worker_id":             w.cfg.WorkerID,
		"account_id":            w.cfg.AccountID,
		"worker_type_id":        WorkerTypeWhatsmeow,
		"session_ready":         healthBool(health, "session_ready"),
		"can_send":              healthBool(health, "can_send"),
		"can_receive_runtime":   healthBool(health, "can_receive_runtime"),
		"authenticated":         healthBool(health, "authenticated"),
		"provider_state":        healthString(health, "provider_state"),
		"degraded_reason":       firstNonEmpty(healthString(health, "degraded_reason"), healthString(health, "reason")),
		"kafka_unhealthy":       kafkaUnhealthy,
		"failure_count":         nextFailures,
		"failure_threshold":     w.cfg.SelfMonitorFailureThreshold,
		"runtime_generation":    w.cfg.RuntimeGeneration,
		"consumer_health_count": consumerHealthCount,
	})

	if nextFailures >= w.cfg.SelfMonitorFailureThreshold && selfMonitorShouldEscalate(health, kafkaUnhealthy) {
		w.requestSelfHealing(ctx, "health_monitor", health, kafkaUnhealthy)
	}

	return nextFailures
}

func selfMonitorHealthReady(health map[string]any, kafkaUnhealthy bool) bool {
	return healthBool(health, "session_ready") &&
		healthBool(health, "can_send") &&
		healthBool(health, "can_receive_runtime") &&
		healthBool(health, "authenticated") &&
		!kafkaUnhealthy
}

func selfMonitorShouldEscalate(health map[string]any, kafkaUnhealthy bool) bool {
	if kafkaUnhealthy {
		return true
	}

	state := strings.ToLower(healthString(health, "provider_state") + " " + firstNonEmpty(healthString(health, "degraded_reason"), healthString(health, "reason")))
	waitingForUserSession := strings.Contains(state, "qr") ||
		strings.Contains(state, "pairing") ||
		strings.Contains(state, "no_session") ||
		strings.Contains(state, "not_authenticated") ||
		strings.Contains(state, "logged_out") ||
		strings.Contains(state, "bad_session") ||
		strings.Contains(state, "mismatch")

	if waitingForUserSession &&
		!healthBool(health, "session_ready") &&
		!healthBool(health, "can_send") &&
		!healthBool(health, "can_receive_runtime") &&
		!healthBool(health, "authenticated") {
		return false
	}

	return true
}

func (w *Worker) maybeRequestDailyMaintenance(ctx context.Context, health map[string]any, kafkaUnhealthy bool) {
	now := time.Now().In(selfMonitorLocation())
	if now.Hour() != w.cfg.DailyMaintenanceHour {
		return
	}

	key := "worker:self-heal:daily:" + w.cfg.WorkerID + ":" + now.Format("2006-01-02")
	acquired, err := w.redis.SetNX(ctx, key, "1", 36*time.Hour).Result()
	if err != nil || !acquired {
		return
	}

	w.requestSelfHealing(ctx, "daily_maintenance", health, kafkaUnhealthy)
}

func (w *Worker) handleSelfHealRecoveryWindow(ctx context.Context, health map[string]any, kafkaUnhealthy, healthy bool) {
	key := "worker:self-heal:recovery:" + w.cfg.WorkerID
	raw, err := w.redis.Get(ctx, key).Result()
	if err != nil || raw == "" {
		return
	}

	var recovery selfHealRecoveryState
	if err := json.Unmarshal([]byte(raw), &recovery); err != nil || recovery.DeadlineAt == "" {
		return
	}

	if healthy {
		_ = w.redis.Del(ctx, key).Err()
		localConnectionStatusLog("whatsmeow.self_monitor.recovery_healthy", map[string]any{
			"layer":          "worker_whatsmeow.self_monitor",
			"provider":       "whatsmeow",
			"worker_id":      w.cfg.WorkerID,
			"account_id":     w.cfg.AccountID,
			"worker_type_id": WorkerTypeWhatsmeow,
			"source":         recovery.Source,
			"reason":         recovery.Reason,
		})
		return
	}

	deadline, err := time.Parse(time.RFC3339, recovery.DeadlineAt)
	if err != nil || time.Now().Before(deadline) {
		return
	}

	state := ConnectionState{
		Code:              CodeConnectionLost,
		Status:            "disconnected",
		WorkerID:          w.cfg.WorkerID,
		AccountID:         w.cfg.AccountID,
		WorkerTypeID:      WorkerTypeWhatsmeow,
		WorkerStatusID:    WorkerStatusOffline,
		Reason:            "self_heal_recovery_timeout",
		RuntimeGeneration: w.cfg.RuntimeGeneration,
		DebugTraceID:      w.selfMonitorTraceID("recovery_timeout"),
		SessionReady:      false,
		CanSend:           false,
		CanReceiveRuntime: false,
		Authenticated:     false,
		ProviderState:     firstNonEmpty(healthString(health, "provider_state"), "recovery_timeout"),
		DegradedReason:    "self_heal_recovery_timeout",
	}
	notifyCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if err := w.balance.NotifyWorkerStatus(notifyCtx, state); err != nil {
		log.Printf("self monitor recovery timeout notify failed worker_id=%s error=%v", w.cfg.WorkerID, err)
		return
	}
	_ = w.redis.Del(ctx, key).Err()
	localConnectionStatusLog("whatsmeow.self_monitor.recovery_timeout", map[string]any{
		"layer":           "worker_whatsmeow.self_monitor",
		"provider":        "whatsmeow",
		"worker_id":       w.cfg.WorkerID,
		"account_id":      w.cfg.AccountID,
		"worker_type_id":  WorkerTypeWhatsmeow,
		"kafka_unhealthy": kafkaUnhealthy,
	})
}

func (w *Worker) requestSelfHealing(ctx context.Context, source string, health map[string]any, kafkaUnhealthy bool) {
	reason := firstNonEmpty(healthString(health, "degraded_reason"), healthString(health, "reason"))
	if reason == "" && kafkaUnhealthy {
		reason = "kafka_unhealthy"
	}
	if reason == "" {
		reason = "runtime_unhealthy"
	}

	request := SelfHealingRequest{
		WorkerID:              w.cfg.WorkerID,
		AccountID:             w.cfg.AccountID,
		WorkerTypeID:          WorkerTypeWhatsmeow,
		Source:                source,
		Reason:                reason,
		ProviderState:         healthString(health, "provider_state"),
		DegradedReason:        reason,
		KafkaUnhealthy:        kafkaUnhealthy,
		RuntimeGeneration:     w.cfg.RuntimeGeneration,
		DebugTraceID:          w.selfMonitorTraceID(source),
		RecoveryWindowSeconds: int(w.cfg.SelfHealRecoveryWindow.Seconds()),
	}

	notifyCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if err := w.balance.RequestWorkerSelfHealing(notifyCtx, request); err != nil {
		log.Printf("self monitor self-heal request failed worker_id=%s source=%s error=%v", w.cfg.WorkerID, source, err)
	}
}

func (w *Worker) selfMonitorTraceID(source string) string {
	return "self-heal:" + source + ":" + w.cfg.WorkerID + ":" + time.Now().UTC().Format("20060102150405.000000000")
}

func selfMonitorLocation() *time.Location {
	name := firstNonEmpty(os.Getenv("TZ"), os.Getenv("APP_TIMEZONE"), "America/Sao_Paulo")
	location, err := time.LoadLocation(name)
	if err != nil {
		return time.Local
	}
	return location
}
