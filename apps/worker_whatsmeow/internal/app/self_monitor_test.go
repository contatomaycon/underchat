package app

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
)

type selfMonitorRedisHook struct {
	mu          sync.Mutex
	recovery    string
	deleteCalls int
}

func (h *selfMonitorRedisHook) DialHook(next redis.DialHook) redis.DialHook {
	return next
}

func (h *selfMonitorRedisHook) ProcessHook(_ redis.ProcessHook) redis.ProcessHook {
	return func(_ context.Context, cmd redis.Cmder) error {
		h.mu.Lock()
		defer h.mu.Unlock()

		switch cmd.Name() {
		case "get":
			get, ok := cmd.(*redis.StringCmd)
			if !ok {
				return fmt.Errorf("unexpected GET command type %T", cmd)
			}
			if h.recovery == "" {
				get.SetErr(redis.Nil)
				return redis.Nil
			}
			get.SetVal(h.recovery)
			get.SetErr(nil)
			return nil
		case "del":
			h.deleteCalls++
			del, ok := cmd.(*redis.IntCmd)
			if !ok {
				return fmt.Errorf("unexpected DEL command type %T", cmd)
			}
			h.recovery = ""
			del.SetVal(1)
			del.SetErr(nil)
			return nil
		default:
			return fmt.Errorf("unexpected Redis command %q", cmd.Name())
		}
	}
}

func (h *selfMonitorRedisHook) ProcessPipelineHook(next redis.ProcessPipelineHook) redis.ProcessPipelineHook {
	return next
}

func (h *selfMonitorRedisHook) replaceRecovery(raw string) {
	h.mu.Lock()
	h.recovery = raw
	h.mu.Unlock()
}

func (h *selfMonitorRedisHook) snapshot() (string, int) {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.recovery, h.deleteCalls
}

func marshalSelfHealRecoveryForTest(t *testing.T, operationID string, generation int, deadline time.Time) string {
	t.Helper()
	raw, err := json.Marshal(selfHealRecoveryState{
		WorkerID:              "worker-1",
		AccountID:             "account-1",
		WorkerTypeID:          WorkerTypeWhatsmeow,
		Source:                "health_monitor",
		Reason:                "kafka_unhealthy",
		RuntimeGeneration:     generation,
		OperationID:           operationID,
		RequestedAt:           time.Now().UTC().Format(time.RFC3339),
		DeadlineAt:            deadline.UTC().Format(time.RFC3339),
		RecoveryWindowSeconds: 600,
	})
	if err != nil {
		t.Fatalf("marshal self-heal recovery: %v", err)
	}
	return string(raw)
}

func newSelfMonitorRedisClientForTest(t *testing.T, recovery string) (*redis.Client, *selfMonitorRedisHook) {
	t.Helper()
	hook := &selfMonitorRedisHook{recovery: recovery}
	client := redis.NewClient(&redis.Options{Addr: "127.0.0.1:1", MaxRetries: 0})
	client.AddHook(hook)
	t.Cleanup(func() { _ = client.Close() })
	return client, hook
}

func TestSelfHealHealthyWorkerRetainsRecoveryForReplacementGeneration(t *testing.T) {
	recovery := marshalSelfHealRecoveryForTest(
		t,
		"operation-old",
		7,
		time.Now().Add(10*time.Minute),
	)
	client, hook := newSelfMonitorRedisClientForTest(t, recovery)
	worker := &Worker{
		cfg: Config{
			WorkerID:          "worker-1",
			AccountID:         "account-1",
			RuntimeGeneration: 7,
		},
		redis: client,
	}
	notifyCalls := 0

	worker.handleSelfHealRecoveryWindowWithNotifier(
		context.Background(),
		map[string]any{"provider_state": "connected"},
		false,
		true,
		func(context.Context, ConnectionState) error {
			notifyCalls++
			return nil
		},
	)

	retained, deleteCalls := hook.snapshot()
	if retained != recovery {
		t.Fatal("healthy old generation removed or changed the central recovery marker")
	}
	if deleteCalls != 0 {
		t.Fatalf("healthy old generation issued %d blind DEL commands", deleteCalls)
	}
	if notifyCalls != 0 {
		t.Fatalf("healthy recovery unexpectedly sent %d timeout notifications", notifyCalls)
	}
}

func TestSelfHealTimeoutDoesNotDeleteReplacementRecovery(t *testing.T) {
	oldRecovery := marshalSelfHealRecoveryForTest(
		t,
		"operation-old",
		7,
		time.Now().Add(-time.Minute),
	)
	replacementRecovery := marshalSelfHealRecoveryForTest(
		t,
		"operation-replacement",
		8,
		time.Now().Add(10*time.Minute),
	)
	client, hook := newSelfMonitorRedisClientForTest(t, oldRecovery)
	worker := &Worker{
		cfg: Config{
			WorkerID:          "worker-1",
			AccountID:         "account-1",
			RuntimeGeneration: 7,
		},
		redis: client,
	}
	notifyCalls := 0

	worker.handleSelfHealRecoveryWindowWithNotifier(
		context.Background(),
		map[string]any{"provider_state": "connected"},
		true,
		false,
		func(_ context.Context, state ConnectionState) error {
			notifyCalls++
			if state.WorkerStatusID != WorkerStatusOffline ||
				state.DegradedReason != "self_heal_recovery_timeout" ||
				state.RuntimeGeneration != 7 {
				t.Fatalf("unexpected recovery timeout state: %#v", state)
			}
			// The central handler may install a later operation before this RPC
			// returns. The worker must never erase that replacement with DEL.
			hook.replaceRecovery(replacementRecovery)
			return nil
		},
	)

	retained, deleteCalls := hook.snapshot()
	if retained != replacementRecovery {
		t.Fatal("timeout path removed or changed the replacement recovery marker")
	}
	if deleteCalls != 0 {
		t.Fatalf("timeout path issued %d blind DEL commands", deleteCalls)
	}
	if notifyCalls != 1 {
		t.Fatalf("expected one recovery timeout notification, got %d", notifyCalls)
	}
}

func TestKafkaDispatchReadinessRequiresAuthorizationForEveryCapability(t *testing.T) {
	health := map[string]any{
		"session_ready":       true,
		"can_send":            true,
		"can_receive_runtime": true,
		"authenticated":       true,
		"provider_state":      "connected",
	}
	applyKafkaDispatchReadiness(health, true, false)
	if healthBool(health, "session_ready") ||
		healthBool(health, "can_send") ||
		healthBool(health, "can_receive_runtime") {
		t.Fatalf("unauthorized dispatch leaked ready capabilities: %#v", health)
	}
	if got := healthString(health, "degraded_reason"); got != "awaiting_dispatch_authorization" {
		t.Fatalf("unauthorized dispatch reason=%q", got)
	}
	health = map[string]any{
		"session_ready":       true,
		"can_send":            true,
		"can_receive_runtime": true,
	}
	applyKafkaDispatchReadiness(health, false, false)
	if got := healthString(health, "degraded_reason"); got != "command_ingress_positioning" {
		t.Fatalf("startup positioning was mislabeled as authorization stall: %q", got)
	}

	health = map[string]any{
		"session_ready":       true,
		"can_send":            true,
		"can_receive_runtime": true,
	}
	applyKafkaDispatchReadiness(health, true, true)
	if !healthBool(health, "session_ready") ||
		!healthBool(health, "can_send") ||
		!healthBool(health, "can_receive_runtime") {
		t.Fatalf("authorized dispatch did not expose ready capabilities: %#v", health)
	}
}
