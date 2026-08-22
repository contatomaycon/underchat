package app

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

func TestProviderWatchdogTerminalizesBlockedCallAndRequiresReplacementProcess(t *testing.T) {
	address := os.Getenv("TEST_REDIS_ADDR")
	if address == "" {
		t.Skip("TEST_REDIS_ADDR is not configured")
	}

	ctx := context.Background()
	client := redis.NewClient(&redis.Options{
		Addr:     address,
		Password: os.Getenv("TEST_REDIS_PASSWORD"),
	})
	t.Cleanup(func() { _ = client.Close() })

	accountID := "provider-stall-account-" + uuid.NewString()
	workerID := "provider-stall-worker-" + uuid.NewString()
	messageID := "provider-stall-message-" + uuid.NewString()
	operation := outboundSendOperation{
		AccountID: accountID,
		Type:      "direct",
		ID:        messageID,
	}
	ledgerKey, err := outboundSendIdempotencyKey(operation)
	if err != nil {
		t.Fatal(err)
	}
	queueKey := outboundRecoveryQueueKey(workerID)
	runtimeKey := whatsAppRuntimeFenceKey(workerID)
	t.Cleanup(func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = client.Del(cleanupCtx, ledgerKey, runtimeKey).Err()
		_ = client.ZRem(cleanupCtx, queueKey, ledgerKey).Err()
	})

	oldScope := whatsAppRuntimeFence{
		State:              "active",
		WorkerID:           workerID,
		RuntimeGeneration:  71,
		ConnectionEpoch:    "provider-stall-old-" + uuid.NewString(),
		ConnectionSequence: 1,
		SourceProvider:     "whatsmeow",
		ActivatedAt:        time.Now().Add(-time.Minute).UnixMilli(),
		ActivationOrder:    1,
	}
	persistScope := func(scope whatsAppRuntimeFence) {
		t.Helper()
		raw, marshalErr := json.Marshal(scope)
		if marshalErr != nil {
			t.Fatal(marshalErr)
		}
		if setErr := client.Set(ctx, runtimeKey, raw, time.Hour).Err(); setErr != nil {
			t.Fatal(setErr)
		}
	}
	persistScope(oldScope)

	manager := &WhatsAppManager{
		cfg: Config{
			AccountID:                        accountID,
			WorkerID:                         workerID,
			OutboundFailureReconnectCooldown: time.Hour,
		},
		redis: client,
	}
	manager.mu.Lock()
	capturedOldScope := oldScope
	manager.inboundConnectionScope = &capturedOldScope
	manager.connected = true
	manager.status = "connected"
	manager.code = CodeConnectionEstablished
	manager.mu.Unlock()

	worker := &Worker{
		cfg: Config{
			AccountID: accountID,
			WorkerID:  workerID,
		},
		redis: client,
	}
	claim, err := claimOutboundOperationWithRedis(
		ctx,
		client,
		operation,
		map[string]any{
			"worker_id":                 workerID,
			"message_id":                messageID,
			"consumer_assignment_epoch": 301,
		},
	)
	if err != nil || !claim.Acquired {
		t.Fatalf("outbound ledger was not acquired: claim=%+v err=%v", claim, err)
	}
	if err := worker.prepareOutboundRecovery(ctx, claim); err != nil {
		t.Fatal(err)
	}
	recovery, err := newOutboundAmbiguousRecovery(
		workerID,
		accountID,
		301,
		oldScope,
		messageID,
		"5511988888888@s.whatsapp.net",
		nil,
	)
	if err != nil {
		t.Fatal(err)
	}

	kafkaAttemptCtx, cancelKafkaAttempt := context.WithCancel(ctx)
	defer cancelKafkaAttempt()
	callCtx, cancelCall := context.WithTimeout(kafkaAttemptCtx, 75*time.Millisecond)
	defer cancelCall()
	callCtx = withInboundConnectionScope(callCtx, oldScope)
	tracker := &providerTransportEffectTracker{}
	callCtx = withProviderTransportEffectTracker(callCtx, tracker)
	var stallTerminalizations atomic.Int32
	terminalizeStall := worker.outboundProviderStallTerminalizer(claim, recovery)
	watchdog := newProviderInvocationWatchdog(
		callCtx,
		manager,
		oldScope,
		ChatMessage{MessageID: messageID},
		time.Now(),
		tracker,
		func(stallCtx context.Context, cause error) error {
			stallTerminalizations.Add(1)
			return terminalizeStall(stallCtx, cause)
		},
	)
	callCtx = withProviderInvocationWatchdog(callCtx, watchdog)

	var providerCalls atomic.Int32
	providerStarted := make(chan struct{})
	releaseProvider := make(chan struct{})
	callResult := make(chan error, 1)
	go func() {
		_, invokeErr := invokeProviderCallAtBoundary(
			callCtx,
			func(boundaryCtx context.Context) error {
				if err := manager.assertCapturedConnectionScope(boundaryCtx, oldScope); err != nil {
					return err
				}
				return worker.markOutboundProviderInvokedWithRecovery(
					boundaryCtx,
					claim,
					recovery,
				)
			},
			func(invokeCtx context.Context) (string, error) {
				if active := providerInvocationWatchdogFromContext(invokeCtx); active == nil || !active.isArmed() {
					return "", errors.New("provider call started before watchdog was armed")
				}
				providerCalls.Add(1)
				close(providerStarted)
				<-releaseProvider // Deliberately ignores invokeCtx.
				return "late-provider-success", nil
			},
		)
		callResult <- invokeErr
	}()

	select {
	case <-providerStarted:
	case <-time.After(2 * time.Second):
		t.Fatal("provider call did not start")
	}
	// Kafka abandons its generation before the provider deadline. The SDK
	// ignores that cancellation, so the independent watchdog must still fire
	// at the original send deadline.
	cancelKafkaAttempt()

	deadline := time.Now().Add(2 * time.Second)
	for {
		state := client.HGet(ctx, ledgerKey, "state").Val()
		manager.mu.RLock()
		failures := manager.consecutiveSendFailures
		degradedReason := manager.degradedReason
		resetAt := manager.lastOutboundReconnectAt
		manager.mu.RUnlock()
		if state == sendIdempotencyStateAmbiguous &&
			failures == 1 &&
			degradedReason == "outbound_send_stalled" &&
			!resetAt.IsZero() {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf(
				"watchdog did not terminalize/degrade promptly state=%q failures=%d reason=%q reset_at=%s",
				state,
				failures,
				degradedReason,
				resetAt,
			)
		}
		time.Sleep(10 * time.Millisecond)
	}
	if got := providerCalls.Load(); got != 1 {
		t.Fatalf("blocked provider was invoked %d times", got)
	}
	if _, err := client.ZScore(ctx, queueKey, ledgerKey).Result(); err != nil {
		t.Fatalf("watchdog lost the durable ambiguous recovery: %v", err)
	}
	health := manager.ConnectionHealth()
	if healthBool(health, "can_send") ||
		!healthBool(health, "outbound_provider_stalled") ||
		healthString(health, "degraded_reason") != "outbound_send_stalled" {
		t.Fatalf("stalled runtime remained send-capable: %#v", health)
	}
	manager.recordOutboundSuccess(
		withInboundConnectionScope(ctx, oldScope),
		ChatMessage{MessageID: "another-old-runtime-message"},
		time.Millisecond,
		"late-success",
	)
	manager.mu.RLock()
	failuresAfterLateSuccess := manager.consecutiveSendFailures
	reasonAfterLateSuccess := manager.degradedReason
	manager.mu.RUnlock()
	if failuresAfterLateSuccess != 1 ||
		reasonAfterLateSuccess != "outbound_send_stalled" {
		t.Fatalf(
			"late old-runtime success cleared the stall failures=%d reason=%q",
			failuresAfterLateSuccess,
			reasonAfterLateSuccess,
		)
	}

	_, err = invokeProviderCallAtBoundary(
		withInboundConnectionScope(ctx, oldScope),
		func(boundaryCtx context.Context) error {
			return manager.assertCapturedConnectionScope(boundaryCtx, oldScope)
		},
		func(context.Context) (string, error) {
			providerCalls.Add(1)
			return "unexpected-old-runtime-send", nil
		},
	)
	if !errors.Is(err, errOutboundProviderCallStalled) {
		t.Fatalf("old runtime was not fenced after the stall: %v", err)
	}
	if got := providerCalls.Load(); got != 1 {
		t.Fatalf("old runtime accumulated another provider call: %d", got)
	}

	newScope := oldScope
	newScope.RuntimeGeneration++
	newScope.ConnectionEpoch = "provider-stall-new-" + uuid.NewString()
	newScope.ActivatedAt = time.Now().UnixMilli()
	newScope.ActivationOrder++
	persistScope(newScope)
	manager.mu.Lock()
	capturedNewScope := newScope
	manager.inboundConnectionScope = &capturedNewScope
	manager.mu.Unlock()

	_, err = invokeProviderCallAtBoundary(
		withInboundConnectionScope(ctx, newScope),
		func(boundaryCtx context.Context) error {
			return manager.assertCapturedConnectionScope(boundaryCtx, newScope)
		},
		func(context.Context) (string, error) {
			providerCalls.Add(1)
			return "unexpected-in-process-successor", nil
		},
	)
	if !errors.Is(err, errOutboundProviderCallStalled) {
		t.Fatalf("quarantined process admitted a new runtime epoch: %v", err)
	}
	if got := providerCalls.Load(); got != 1 {
		t.Fatalf("in-process successor reached provider; calls=%d", got)
	}

	// Only a new process/manager is a safe successor. It has no reference to
	// the context-ignoring SDK flight and may own the durable replacement fence.
	replacementManager := &WhatsAppManager{
		cfg:   Config{AccountID: accountID, WorkerID: workerID},
		redis: client,
	}
	replacementManager.mu.Lock()
	replacementScope := newScope
	replacementManager.inboundConnectionScope = &replacementScope
	replacementManager.mu.Unlock()
	result, err := invokeProviderCallAtBoundary(
		withInboundConnectionScope(ctx, newScope),
		func(boundaryCtx context.Context) error {
			return replacementManager.assertCapturedConnectionScope(boundaryCtx, newScope)
		},
		func(context.Context) (string, error) {
			providerCalls.Add(1)
			return "replacement-process-success", nil
		},
	)
	if err != nil || result != "replacement-process-success" {
		t.Fatalf("replacement process remained fenced result=%q err=%v", result, err)
	}
	if got := providerCalls.Load(); got != 2 {
		t.Fatalf("replacement process provider calls=%d, want 2 total", got)
	}

	close(releaseProvider)
	select {
	case err := <-callResult:
		if !errors.Is(err, errOutboundProviderCallStalled) {
			t.Fatalf("late SDK settlement was not kept ambiguous: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("late provider callback did not settle")
	}
	if got := client.HGet(ctx, ledgerKey, "state").Val(); got != sendIdempotencyStateAmbiguous {
		t.Fatalf("late provider success overwrote ambiguous ledger: %q", got)
	}
	manager.mu.RLock()
	failures := manager.consecutiveSendFailures
	manager.mu.RUnlock()
	if failures != 1 {
		t.Fatalf("provider stall was counted more than once: %d", failures)
	}
	if got := stallTerminalizations.Load(); got != 1 {
		t.Fatalf("provider stall terminalized the ledger %d times", got)
	}
}
