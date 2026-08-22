package app

import "strings"

type workerCommandIngressHealth struct {
	expected   int
	active     int
	missing    int
	unhealthy  int
	available  bool
	connected  bool
	started    bool
	ready      bool
	authorized bool
	reason     string
}

// commandIngressHealth is the single source of truth for the WhatsMeow
// command reader. Kafka is output-only in this worker, so its writer cannot
// provide consumer health. The lifecycle atomics are synchronously fenced by
// the JetStream handle before a terminal event is delivered to the supervisor.
func (w *Worker) commandIngressHealth() workerCommandIngressHealth {
	if w == nil {
		return workerCommandIngressHealth{}
	}

	expected := 0
	if strings.TrimSpace(w.cfg.WorkerID) != "" && w.cfg.RuntimeGeneration > 0 {
		expected = 1
	}
	available := w.workerCommands != nil || w.startWorkerCommandConsumer != nil
	connected := w.startWorkerCommandConsumer != nil
	if w.workerCommands != nil {
		connected = w.workerCommands.IsConnected()
	}
	started := w.kafkaConsumersStarted.Load()
	ready := w.kafkaConsumersReady.Load()
	authorized := w.kafkaConsumersAuthorized.Load()

	health := workerCommandIngressHealth{
		expected:   expected,
		available:  available,
		connected:  connected,
		started:    started,
		ready:      ready,
		authorized: authorized,
	}
	if expected == 0 {
		return health
	}
	if started {
		health.active = 1
	} else {
		health.missing = 1
	}

	switch {
	case !available:
		health.unhealthy = 1
		health.reason = "command_ingress_unavailable"
	case !connected:
		health.unhealthy = 1
		health.reason = "command_ingress_disconnected"
	case !started:
		health.reason = "command_ingress_not_started"
	case !ready:
		health.unhealthy = 1
		health.reason = "command_ingress_positioning"
	case !authorized:
		// Central ONLINE authorization is deliberately not a transport failure.
		// The supervisor retries that ACK in place without churning a healthy
		// durable or overlapping two command executors.
		health.reason = "awaiting_dispatch_authorization"
	}
	return health
}

func (w *Worker) commandIngressUnhealthy() bool {
	health := w.commandIngressHealth()
	return health.expected > 0 &&
		(health.missing > 0 || health.unhealthy > 0)
}

func (w *Worker) commandIngressHealthSnapshot() []map[string]any {
	health := w.commandIngressHealth()
	if health.expected == 0 {
		return nil
	}

	snapshot := map[string]any{
		"transport":           "jetstream",
		"stream":              workerCommandStreamName,
		"group_id":            workerCommandDurableName(w.cfg.WorkerID),
		"topics":              []string{workerCommandSubject(w.cfg.WorkerID)},
		"connected":           health.connected,
		"consuming":           health.started,
		"assignments_ready":   health.ready,
		"dispatch_authorized": health.authorized,
		"unhealthy":           health.missing > 0 || health.unhealthy > 0,
		"missing":             health.missing > 0,
		"restart_count":       w.commandIngressRepairAttempts(),
		"last_error":          "",
	}
	if health.reason != "" {
		snapshot["stall_reason"] = health.reason
		if health.missing > 0 || health.unhealthy > 0 {
			snapshot["last_error"] = health.reason
		}
	}
	return []map[string]any{snapshot}
}

func (w *Worker) commandIngressHealthSummary() map[string]any {
	health := w.commandIngressHealth()
	return map[string]any{
		"expected":   health.expected,
		"active":     health.active,
		"missing":    health.missing,
		"unhealthy":  health.unhealthy,
		"ready":      health.ready,
		"authorized": health.authorized,
		"transport":  "jetstream",
	}
}

func (w *Worker) commandIngressRepairAttempts() int {
	if w == nil {
		return 0
	}
	w.kafkaConsumerRepairMu.Lock()
	defer w.kafkaConsumerRepairMu.Unlock()
	return w.kafkaConsumerRepairAttempts
}
