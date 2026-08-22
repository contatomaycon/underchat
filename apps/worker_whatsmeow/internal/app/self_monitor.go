package app

import (
	"context"
	"encoding/json"
	"errors"
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
	SessionReady          bool   `json:"session_ready,omitempty"`
	CanSend               bool   `json:"can_send,omitempty"`
	CanReceiveRuntime     bool   `json:"can_receive_runtime,omitempty"`
	Authenticated         bool   `json:"authenticated,omitempty"`
	Phone                 string `json:"phone,omitempty"`
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
	applyKafkaDispatchReadiness(
		health,
		w.kafkaConsumersReady.Load(),
		w.kafkaConsumersAuthorized.Load(),
	)

	return w.runSelfMonitorHealthCheck(ctx, failures, health)
}

func (w *Worker) runSelfMonitorHealthCheck(
	ctx context.Context,
	failures int,
	health map[string]any,
) int {
	// kafka_unhealthy is retained on the wire for compatibility, but command
	// ingress is exclusively JetStream and this value comes from its lifecycle.
	kafkaUnhealthy := w.commandIngressUnhealthy()
	healthy := selfMonitorHealthReady(health, kafkaUnhealthy)

	w.handleSelfHealRecoveryWindow(ctx, health, kafkaUnhealthy, healthy)
	w.maybeRequestDailyMaintenance(ctx, health, kafkaUnhealthy)

	if healthy {
		w.resetKafkaConsumerRepairBudget()
		return 0
	}

	if kafkaUnhealthy && selfMonitorHasActiveSessionEvidence(health) {
		handled, scheduled, attempt := w.tryLocalKafkaConsumerRepair(time.Now())
		if handled {
			localConnectionStatusLog("whatsmeow.self_monitor.kafka_local_repair", map[string]any{
				"layer":                  "worker_whatsmeow.self_monitor",
				"provider":               "whatsmeow",
				"worker_id":              w.cfg.WorkerID,
				"account_id":             w.cfg.AccountID,
				"worker_type_id":         WorkerTypeWhatsmeow,
				"runtime_generation":     w.cfg.RuntimeGeneration,
				"repair_attempt":         attempt,
				"repair_scheduled":       scheduled,
				"repair_max_attempts":    w.cfg.KafkaConsumerMaxLocalRepairs,
				"provider_state":         healthString(health, "provider_state"),
				"authenticated":          healthBool(health, "authenticated"),
				"kafka_unhealthy":        true,
				"full_self_heal_blocked": true,
				"reason":                 "repair_consumers_before_runtime",
			})
			return 0
		}
		localConnectionStatusLog("whatsmeow.self_monitor.kafka_local_repair_exhausted", map[string]any{
			"layer":               "worker_whatsmeow.self_monitor",
			"provider":            "whatsmeow",
			"worker_id":           w.cfg.WorkerID,
			"account_id":          w.cfg.AccountID,
			"worker_type_id":      WorkerTypeWhatsmeow,
			"runtime_generation":  w.cfg.RuntimeGeneration,
			"repair_attempts":     attempt,
			"repair_max_attempts": w.cfg.KafkaConsumerMaxLocalRepairs,
			"provider_state":      healthString(health, "provider_state"),
			"authenticated":       healthBool(health, "authenticated"),
			"kafka_unhealthy":     true,
			"reason":              "local_repair_budget_exhausted",
		})
	}

	if !selfMonitorShouldEscalate(health, kafkaUnhealthy) {
		localConnectionStatusLog("whatsmeow.self_monitor.pending", map[string]any{
			"layer":               "worker_whatsmeow.self_monitor",
			"provider":            "whatsmeow",
			"worker_id":           w.cfg.WorkerID,
			"account_id":          w.cfg.AccountID,
			"worker_type_id":      WorkerTypeWhatsmeow,
			"session_ready":       healthBool(health, "session_ready"),
			"can_send":            healthBool(health, "can_send"),
			"can_receive_runtime": healthBool(health, "can_receive_runtime"),
			"authenticated":       healthBool(health, "authenticated"),
			"provider_state":      healthString(health, "provider_state"),
			"degraded_reason":     firstNonEmpty(healthString(health, "degraded_reason"), healthString(health, "reason")),
			"kafka_unhealthy":     kafkaUnhealthy,
			"runtime_generation":  w.cfg.RuntimeGeneration,
		})
		return 0
	}

	nextFailures := failures + 1
	consumerHealthCount := len(w.commandIngressHealthSnapshot())
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

	if nextFailures >= w.cfg.SelfMonitorFailureThreshold {
		w.requestSelfHealing(ctx, "health_monitor", health, kafkaUnhealthy)
		return 0
	}

	return nextFailures
}

func selfMonitorHealthReady(health map[string]any, kafkaUnhealthy bool) bool {
	return healthBool(health, "session_ready") &&
		healthBool(health, "can_send") &&
		healthBool(health, "can_receive_runtime") &&
		healthBool(health, "authenticated") &&
		strings.TrimSpace(healthString(health, "phone")) != "" &&
		!kafkaUnhealthy
}

func selfMonitorShouldEscalate(health map[string]any, kafkaUnhealthy bool) bool {
	if !selfMonitorHasActiveSessionEvidence(health) {
		return false
	}
	if !kafkaUnhealthy && strings.EqualFold(
		strings.TrimSpace(healthString(health, "degraded_reason")),
		"awaiting_dispatch_authorization",
	) {
		// The supervisor retries the central ACK continuously and the Kafka
		// watchdog owns a bounded authorization-hold timer. Escalating the whole
		// runtime before that timer expires causes reconnect flapping during a
		// short control-plane outage. Once the hold is marked unhealthy, the
		// normal local-consumer repair path runs before any container recreation.
		return false
	}

	return kafkaUnhealthy || !selfMonitorHealthReady(health, false)
}

func selfMonitorHasActiveSessionEvidence(health map[string]any) bool {
	if !healthBool(health, "authenticated") || selfMonitorHasPassiveSessionState(health) {
		return false
	}

	providerState := strings.ToLower(strings.TrimSpace(healthString(health, "provider_state")))
	return healthBool(health, "session_ready") ||
		strings.TrimSpace(healthString(health, "phone")) != "" ||
		strings.Contains(providerState, "connected") ||
		providerState == "open" ||
		providerState == "ready"
}

func selfMonitorHasPassiveSessionState(health map[string]any) bool {
	state := strings.ToLower(healthString(health, "provider_state") + " " + firstNonEmpty(healthString(health, "degraded_reason"), healthString(health, "reason")))
	for _, marker := range []string{
		"qr",
		"pairing",
		"no_session",
		"not_authenticated",
		"logged_out",
		"bad_session",
		"mismatch",
		"launching",
		"state_unavailable",
		"state_probe_pending",
		"not_initialized",
		"runtime_not_initialized",
		"not initialized",
		"disconnected",
		"disconnecting",
		"offline",
		"closed",
		"awaiting_connection",
		"awaiting connection",
	} {
		if strings.Contains(state, marker) {
			return true
		}
	}
	return false
}

func (w *Worker) maybeRequestDailyMaintenance(ctx context.Context, health map[string]any, kafkaUnhealthy bool) {
	if !w.cfg.DailyMaintenanceEnabled || !selfMonitorHasActiveSessionEvidence(health) {
		return
	}

	now := time.Now().In(selfMonitorLocation())
	if now.Hour() != w.cfg.DailyMaintenanceHour || now.Minute() < w.cfg.DailyMaintenanceMinute {
		return
	}

	schedule := selfMonitorDailyScheduleKey(w.cfg.DailyMaintenanceHour, w.cfg.DailyMaintenanceMinute)
	key := "worker:self-heal:daily:" + w.cfg.WorkerID + ":" + now.Format("2006-01-02") + ":" + schedule
	acquired, err := w.redis.SetNX(ctx, key, "1", 36*time.Hour).Result()
	if err != nil || !acquired {
		if err == nil {
			localConnectionStatusLog("whatsmeow.self_monitor.daily_skipped_dedupe", map[string]any{
				"layer":          "worker_whatsmeow.self_monitor",
				"provider":       "whatsmeow",
				"worker_id":      w.cfg.WorkerID,
				"account_id":     w.cfg.AccountID,
				"worker_type_id": WorkerTypeWhatsmeow,
				"local_date":     now.Format("2006-01-02"),
				"schedule":       schedule,
				"daily_key":      key,
			})
		}
		return
	}

	w.requestSelfHealing(ctx, "daily_maintenance", health, kafkaUnhealthy)
}

func (w *Worker) handleSelfHealRecoveryWindow(ctx context.Context, health map[string]any, kafkaUnhealthy, healthy bool) {
	w.handleSelfHealRecoveryWindowWithNotifier(
		ctx,
		health,
		kafkaUnhealthy,
		healthy,
		func(notifyCtx context.Context, state ConnectionState) error {
			if w.postgres == nil || w.postgres.DB == nil {
				return errors.New("worker status database writer is unavailable")
			}
			return w.postgres.ApplyWorkerStatus(notifyCtx, w.cfg, state)
		},
	)
}

func (w *Worker) handleSelfHealRecoveryWindowWithNotifier(
	ctx context.Context,
	health map[string]any,
	kafkaUnhealthy bool,
	healthy bool,
	notifyRecoveryTimeout func(context.Context, ConnectionState) error,
) {
	key := "worker:self-heal:recovery:" + w.cfg.WorkerID
	raw, err := w.redis.Get(ctx, key).Result()
	if err != nil || raw == "" {
		return
	}

	var recovery selfHealRecoveryState
	if err := json.Unmarshal([]byte(raw), &recovery); err != nil || recovery.DeadlineAt == "" {
		return
	}

	if recovery.RuntimeGeneration <= 0 ||
		w.cfg.RuntimeGeneration <= 0 ||
		recovery.RuntimeGeneration != w.cfg.RuntimeGeneration {
		return
	}

	if healthy {
		localConnectionStatusLog("whatsmeow.self_monitor.recovery_healthy", map[string]any{
			"layer":                 "worker_whatsmeow.self_monitor",
			"provider":              "whatsmeow",
			"worker_id":             w.cfg.WorkerID,
			"account_id":            w.cfg.AccountID,
			"worker_type_id":        WorkerTypeWhatsmeow,
			"source":                recovery.Source,
			"reason":                recovery.Reason,
			"recovery_operation_id": recovery.OperationID,
			"runtime_generation":    w.cfg.RuntimeGeneration,
			"recovery_retained":     true,
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
	if notifyRecoveryTimeout == nil {
		log.Printf("self monitor recovery timeout notify unavailable worker_id=%s", w.cfg.WorkerID)
		return
	}
	if err := notifyRecoveryTimeout(notifyCtx, state); err != nil {
		log.Printf("self monitor recovery timeout notify failed worker_id=%s error_code=%s", w.cfg.WorkerID, safeOperationalErrorCode(err))
		return
	}
	localConnectionStatusLog("whatsmeow.self_monitor.recovery_timeout", map[string]any{
		"layer":                 "worker_whatsmeow.self_monitor",
		"provider":              "whatsmeow",
		"worker_id":             w.cfg.WorkerID,
		"account_id":            w.cfg.AccountID,
		"worker_type_id":        WorkerTypeWhatsmeow,
		"kafka_unhealthy":       kafkaUnhealthy,
		"recovery_operation_id": recovery.OperationID,
		"runtime_generation":    w.cfg.RuntimeGeneration,
		"recovery_retained":     true,
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
		SessionReady:          healthBool(health, "session_ready"),
		CanSend:               healthBool(health, "can_send"),
		CanReceiveRuntime:     healthBool(health, "can_receive_runtime"),
		Authenticated:         healthBool(health, "authenticated"),
		Phone:                 strings.TrimSpace(healthString(health, "phone")),
		RuntimeGeneration:     w.cfg.RuntimeGeneration,
		DebugTraceID:          w.selfMonitorTraceID(source),
		RecoveryWindowSeconds: int(w.cfg.SelfHealRecoveryWindow.Seconds()),
	}

	notifyCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	err := w.postgres.RequestSelfHealing(notifyCtx, w.cfg, request)
	if err != nil {
		log.Printf("self monitor self-heal request failed worker_id=%s source=%s error_code=%s", w.cfg.WorkerID, source, safeOperationalErrorCode(err))
	}
}

func (w *Worker) selfMonitorTraceID(source string) string {
	return "self-heal:" + source + ":" + w.cfg.WorkerID + ":" + time.Now().UTC().Format("20060102150405.000000000")
}

func selfMonitorDailyScheduleKey(hour, minute int) string {
	return time.Date(2000, 1, 1, hour, minute, 0, 0, time.UTC).Format("1504")
}

func selfMonitorLocation() *time.Location {
	name := firstNonEmpty(os.Getenv("TZ"), os.Getenv("APP_TIMEZONE"), "America/Sao_Paulo")
	location, err := time.LoadLocation(name)
	if err != nil {
		return time.Local
	}
	return location
}
