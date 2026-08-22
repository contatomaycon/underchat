package app

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

func TestScheduleMessageAttemptIdentityAndOutboundOperation(t *testing.T) {
	legacy := ScheduleMessage{
		ScheduleID: "schedule-1",
		AccountID:  "account-1",
		Message: ChatMessage{
			MessageID: "message-1",
			Account:   map[string]any{"id": "account-1"},
			Worker:    map[string]any{"id": "worker-1"},
		},
	}
	if got := scheduleMessageAttemptID(legacy); got != "legacy:message-1" {
		t.Fatalf("unexpected legacy attempt identity %q", got)
	}
	if got := scheduleMessageOutboundOperationID(legacy); got != "message-1" {
		t.Fatalf("unexpected legacy outbound operation identity %q", got)
	}

	current := legacy
	current.AttemptID = "attempt-1"
	if got := scheduleMessageAttemptID(current); got != "attempt-1" {
		t.Fatalf("unexpected current attempt identity %q", got)
	}
	if got := scheduleMessageOutboundOperationID(current); got != "message-1" {
		t.Fatalf("message_id was not kept as the stable outbound operation identity: %q", got)
	}
	retry := current
	retry.AttemptID = "attempt-2"
	if got := scheduleMessageOutboundOperationID(retry); got != "message-1" {
		t.Fatalf("a new attempt changed the stable outbound operation identity: %q", got)
	}

	key, err := scheduleMessageAttemptKey(scheduleMessageAttemptReferenceFor(current))
	if err != nil {
		t.Fatal(err)
	}
	if key != "{schedule-status}:message-attempt:v3:schedule-1:message-1" {
		t.Fatalf("unexpected shared Redis key %q", key)
	}

	reference := scheduleMessageAttemptReferenceFor(current)
	if reference.AccountID != "account-1" ||
		reference.WorkerID != "worker-1" ||
		reference.MessageID != "message-1" ||
		reference.AttemptID != "attempt-1" {
		t.Fatalf("operational correlation was not preserved: %+v", reference)
	}
}

func TestScheduleMessageOperationalTransitionContract(t *testing.T) {
	if !strings.Contains(
		setScheduleMessageOperationalStateScript,
		"current == 'pre_provider_failed'",
	) || !strings.Contains(
		setScheduleMessageOperationalStateScript,
		"target == 'ambiguous'",
	) {
		t.Fatal("provider invocation cannot supersede a pre-provider failure for the same attempt")
	}
	if !strings.Contains(
		setScheduleMessageOperationalStateScript,
		"current == 'ambiguous'",
	) || !strings.Contains(
		setScheduleMessageOperationalStateScript,
		"target == 'succeeded'",
	) {
		t.Fatal("an ambiguous provider invocation cannot converge to succeeded")
	}
}

func TestScheduleMessageAttemptRedisLifecycle(t *testing.T) {
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
	reference := scheduleMessageAttemptReference{
		ScheduleID: "schedule-" + uuid.NewString(),
		AccountID:  "account-1",
		WorkerID:   "worker-1",
		MessageID:  "message-1",
		AttemptID:  "attempt-1",
	}
	key, err := scheduleMessageAttemptKey(reference)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = client.Del(cleanupCtx, key).Err()
		_ = client.ZRem(
			cleanupCtx,
			scheduleReconciliationDeadlineKey,
			reference.ScheduleID,
		).Err()
		_ = client.HDel(
			cleanupCtx,
			scheduleReconciliationVersionKey,
			reference.ScheduleID,
		).Err()
	})
	worker := &Worker{redis: client}

	if err := client.HSet(ctx, key, map[string]any{
		"state":                     "queued",
		"attempt_id":                reference.AttemptID,
		"account_id":                reference.AccountID,
		"worker_id":                 reference.WorkerID,
		"message_id":                reference.MessageID,
		"operational_state":         "pending",
		"operational_updated_at_ms": time.Now().UnixMilli(),
		"owner":                     "",
		"lease_until_ms":            time.Now().Add(5 * time.Minute).UnixMilli(),
		"updated_at_ms":             time.Now().UnixMilli(),
	}).Err(); err != nil {
		t.Fatal(err)
	}
	if err := client.Expire(ctx, key, scheduleMessageAttemptTTL).Err(); err != nil {
		t.Fatal(err)
	}

	first, err := worker.claimScheduleMessageAttempt(ctx, reference)
	if err != nil || first.State != scheduleMessageAttemptAcquired {
		t.Fatalf("queued attempt was not acquired: claim=%+v err=%v", first, err)
	}
	if err := worker.setScheduleMessageOperationalState(
		ctx,
		reference,
		scheduleMessageOperationalPreProviderFailed,
	); err != nil {
		t.Fatalf("pre-provider failure was not persisted: %v", err)
	}
	if err := worker.setScheduleMessageOperationalState(
		ctx,
		reference,
		scheduleMessageOperationalAmbiguous,
	); err != nil {
		t.Fatalf("provider invocation did not supersede the pre-provider failure: %v", err)
	}
	if got := client.HGet(ctx, key, "operational_state").Val(); got != "ambiguous" {
		t.Fatalf("unexpected ambiguous operational state %q", got)
	}
	if _, err := client.ZScore(
		ctx,
		scheduleReconciliationDeadlineKey,
		reference.ScheduleID,
	).Result(); err != nil {
		t.Fatalf("operational transition did not schedule reconciliation: %v", err)
	}
	if got := client.HGet(
		ctx,
		scheduleReconciliationVersionKey,
		reference.ScheduleID,
	).Val(); got == "" || got == "0" {
		t.Fatalf("operational transition did not version reconciliation: %q", got)
	}
	if err := worker.setScheduleMessageOperationalState(
		ctx,
		reference,
		scheduleMessageOperationalSucceeded,
	); err != nil {
		t.Fatalf("provider success did not resolve the ambiguous outcome: %v", err)
	}
	if got := client.HGet(ctx, key, "operational_state").Val(); got != "succeeded" {
		t.Fatalf("unexpected succeeded operational state %q", got)
	}
	second, err := worker.claimScheduleMessageAttempt(ctx, reference)
	if err != nil || second.State != scheduleMessageAttemptBusy {
		t.Fatalf("active attempt was not fenced: claim=%+v err=%v", second, err)
	}
	stale, err := worker.claimScheduleMessageAttempt(ctx, scheduleMessageAttemptReference{
		ScheduleID: reference.ScheduleID,
		AccountID:  reference.AccountID,
		WorkerID:   reference.WorkerID,
		MessageID:  reference.MessageID,
		AttemptID:  "attempt-2",
	})
	if err != nil || stale.State != scheduleMessageAttemptStale {
		t.Fatalf("replaced attempt was not rejected as stale: claim=%+v err=%v", stale, err)
	}
	if err := worker.assertScheduleMessageAttempt(ctx, first.Lease); err != nil {
		t.Fatalf("active attempt assertion failed: %v", err)
	}
	if err := worker.releaseScheduleMessageAttempt(ctx, first.Lease); err != nil {
		t.Fatalf("release to grace failed: %v", err)
	}
	grace, err := worker.claimScheduleMessageAttempt(ctx, reference)
	if err != nil || grace.State != scheduleMessageAttemptBusy {
		t.Fatalf("grace did not fence a replacement provider: claim=%+v err=%v", grace, err)
	}

	if err := client.HSet(ctx, key, "lease_until_ms", "0").Err(); err != nil {
		t.Fatal(err)
	}
	reacquired, err := worker.claimScheduleMessageAttempt(ctx, reference)
	if err != nil || reacquired.State != scheduleMessageAttemptAcquired {
		t.Fatalf("expired grace was not reacquired: claim=%+v err=%v", reacquired, err)
	}
	if err := worker.completeScheduleMessageAttempt(ctx, reacquired.Lease); err != nil {
		t.Fatalf("completion failed: %v", err)
	}
	completed, err := worker.claimScheduleMessageAttempt(ctx, reference)
	if err != nil || completed.State != scheduleMessageAttemptCompleted {
		t.Fatalf("completed attempt was not terminal: claim=%+v err=%v", completed, err)
	}
	if err := worker.assertScheduleMessageAttempt(ctx, reacquired.Lease); !errors.Is(err, errScheduleMessageAttemptLeaseLost) {
		t.Fatalf("completed lease remained active: %v", err)
	}
}

func TestScheduleMessageAttemptTerminalOutcomeCompletesBeforeKafkaCommit(t *testing.T) {
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
	reference := scheduleMessageAttemptReference{
		ScheduleID: "schedule-terminal-" + uuid.NewString(),
		AccountID:  "account-1",
		WorkerID:   "worker-1",
		MessageID:  "message-1",
		AttemptID:  "attempt-1",
	}
	key, err := scheduleMessageAttemptKey(reference)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = client.Del(cleanupCtx, key).Err()
		_ = client.ZRem(
			cleanupCtx,
			scheduleReconciliationDeadlineKey,
			reference.ScheduleID,
		).Err()
		_ = client.HDel(
			cleanupCtx,
			scheduleReconciliationVersionKey,
			reference.ScheduleID,
		).Err()
	})
	worker := &Worker{
		cfg: Config{
			AccountID: reference.AccountID,
			WorkerID:  reference.WorkerID,
		},
		redis: client,
	}

	state, err := worker.withScheduleMessageAttempt(
		ctx,
		reference,
		func(context.Context) error {
			return terminalKafkaHandlerError(errOutboundTargetNotRegistered)
		},
	)
	if state != scheduleMessageAttemptAcquired {
		t.Fatalf("unexpected attempt claim state %q", state)
	}
	if !shouldCommitTerminalKafkaHandlerError(err) {
		t.Fatalf("completed business outcome lost terminal marker: %v", err)
	}
	if got := client.HGet(ctx, key, "state").Val(); got != "completed" {
		t.Fatalf("terminal business outcome did not complete attempt: %q", got)
	}
	if got := client.HGet(ctx, key, "owner").Val(); got != "" {
		t.Fatalf("completed business outcome retained owner %q", got)
	}
	if _, err := client.ZScore(
		ctx,
		scheduleReconciliationDeadlineKey,
		reference.ScheduleID,
	).Result(); !errors.Is(err, redis.Nil) {
		t.Fatalf("completed business outcome scheduled retry reconciliation: %v", err)
	}
}

func TestScheduleMessageAttemptInfrastructureFailureCannotRetainTerminalMarker(t *testing.T) {
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
	reference := scheduleMessageAttemptReference{
		ScheduleID: "schedule-terminal-failure-" + uuid.NewString(),
		AccountID:  "account-1",
		WorkerID:   "worker-1",
		MessageID:  "message-1",
		AttemptID:  "attempt-1",
	}
	key, err := scheduleMessageAttemptKey(reference)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = client.Del(cleanupCtx, key).Err()
		_ = client.ZRem(
			cleanupCtx,
			scheduleReconciliationDeadlineKey,
			reference.ScheduleID,
		).Err()
		_ = client.HDel(
			cleanupCtx,
			scheduleReconciliationVersionKey,
			reference.ScheduleID,
		).Err()
	})
	worker := &Worker{
		cfg: Config{
			AccountID: reference.AccountID,
			WorkerID:  reference.WorkerID,
		},
		redis: client,
	}

	_, err = worker.withScheduleMessageAttempt(
		ctx,
		reference,
		func(context.Context) error {
			if deleteErr := client.Del(ctx, key).Err(); deleteErr != nil {
				return deleteErr
			}
			return terminalKafkaHandlerError(errOutboundTargetInvalid)
		},
	)
	if err == nil {
		t.Fatal("lost attempt lease was silently committed")
	}
	if shouldCommitTerminalKafkaHandlerError(err) {
		t.Fatalf("lost attempt lease retained terminal commit marker: %v", err)
	}
	if !errors.Is(err, errOutboundTargetInvalid) ||
		!errors.Is(err, errScheduleMessageAttemptLeaseLost) {
		t.Fatalf("lost lease causes were not preserved: %v", err)
	}
}

func TestScheduleOutboundRecoveryAcquiresSharedAttemptClaim(t *testing.T) {
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
	workerID := "schedule-recovery-worker-" + uuid.NewString()
	accountID := "schedule-recovery-account-" + uuid.NewString()
	reference := scheduleMessageAttemptReference{
		ScheduleID: "schedule-" + uuid.NewString(),
		AccountID:  accountID,
		WorkerID:   workerID,
		MessageID:  "message-1",
		AttemptID:  "attempt-1",
	}
	attemptKey, err := scheduleMessageAttemptKey(reference)
	if err != nil {
		t.Fatal(err)
	}
	operation := outboundSendOperation{
		AccountID: accountID,
		Type:      "schedule",
		ID:        reference.MessageID,
	}
	claim, err := claimOutboundOperationWithRedis(ctx, client, operation, map[string]any{
		"worker_id":                 workerID,
		"schedule_id":               reference.ScheduleID,
		"message_id":                reference.MessageID,
		"attempt_id":                reference.AttemptID,
		"consumer_assignment_epoch": 77,
	})
	if err != nil {
		t.Fatal(err)
	}
	queueKey := outboundRecoveryQueueKey(workerID)
	t.Cleanup(func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = client.Del(cleanupCtx, claim.Key, attemptKey, queueKey).Err()
		_ = client.ZRem(cleanupCtx, scheduleReconciliationDeadlineKey, reference.ScheduleID).Err()
		_ = client.HDel(cleanupCtx, scheduleReconciliationVersionKey, reference.ScheduleID).Err()
	})

	published := 0
	activeScope := whatsAppRuntimeFence{
		State:             "active",
		WorkerID:          workerID,
		RuntimeGeneration: 7,
		ConnectionEpoch:   "epoch-1",
		SourceProvider:    "whatsmeow",
	}
	worker := &Worker{
		cfg:   Config{AccountID: accountID, WorkerID: workerID},
		redis: client,
		outboundRecoveryScopeCapturer: func(context.Context) (whatsAppRuntimeFence, error) {
			return activeScope, nil
		},
		outboundRecoveryPublisher: func(_ context.Context, recovery outboundRecoveryRecord) error {
			published++
			if recovery.ScheduleAttempt == nil ||
				*recovery.ScheduleAttempt != reference {
				t.Fatalf("unexpected schedule recovery reference: %#v", recovery.ScheduleAttempt)
			}
			return nil
		},
	}
	worker.kafkaConsumerBarrierEpoch.Store(77)
	worker.kafkaConsumersReady.Store(true)
	worker.kafkaConsumersAuthorized.Store(true)

	if err := worker.prepareOutboundRecovery(ctx, claim); err != nil {
		t.Fatal(err)
	}
	if err := markOutboundProviderInvokedWithRedis(ctx, client, claim); err != nil {
		t.Fatal(err)
	}
	scheduleUpdate := ScheduleStatusUpdate{
		AttemptID:         reference.AttemptID,
		AccountID:         accountID,
		WorkerID:          workerID,
		SourceProvider:    "whatsmeow",
		RuntimeGeneration: activeScope.RuntimeGeneration,
		ConnectionEpoch:   activeScope.ConnectionEpoch,
		ScheduleID:        reference.ScheduleID,
		ContactID:         "contact-1",
		MessageID:         reference.MessageID,
		Status:            "sent",
	}
	ensureScheduleStatusEventID(&scheduleUpdate)
	publication, err := newOutboundRecoveryPublication(
		topicScheduleStatusUpdate,
		scheduleStatusKafkaKey(reference.ScheduleID, "contact-1", reference.MessageID),
		scheduleUpdate,
	)
	if err != nil {
		t.Fatal(err)
	}
	recovery := outboundRecoveryRecord{
		SchemaVersion:           outboundRecoverySchemaVersion,
		WorkerID:                workerID,
		AccountID:               accountID,
		ConsumerAssignmentEpoch: 77,
		OriginRuntimeGeneration: activeScope.RuntimeGeneration,
		OriginConnectionEpoch:   activeScope.ConnectionEpoch,
		ScheduleAttempt:         &reference,
		Publications:            []outboundRecoveryPublication{publication},
	}
	if err := worker.completeOutboundSuccessWithRecovery(
		ctx,
		claim,
		map[string]any{"message_id": reference.MessageID},
		recovery,
	); err != nil {
		t.Fatal(err)
	}

	if err := worker.processDueOutboundRecoveries(ctx); err != nil {
		t.Fatal(err)
	}

	if published != 1 {
		t.Fatalf("schedule recovery published %d times", published)
	}
	if _, err := client.ZScore(ctx, queueKey, claim.Key).Result(); !errors.Is(err, redis.Nil) {
		t.Fatalf("schedule recovery index was not acknowledged: %v", err)
	}
	state := client.HGet(ctx, attemptKey, "state").Val()
	if state != "grace" {
		t.Fatalf("schedule attempt was not released to grace after recovery: %q", state)
	}
	if got := client.HGet(ctx, attemptKey, "attempt_id").Val(); got != reference.AttemptID {
		t.Fatalf("unexpected recovered attempt identity %q", got)
	}
	if got := client.HGet(ctx, attemptKey, "owner").Val(); got != "" {
		t.Fatalf("schedule recovery left an owner behind: %q", got)
	}
}

func TestScheduleRecoveryTakesOverObsoleteFiveMinuteLeaseWithoutProviderRetry(t *testing.T) {
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

	accountID := "schedule-takeover-account-" + uuid.NewString()
	workerID := "schedule-takeover-worker-" + uuid.NewString()
	reference := scheduleMessageAttemptReference{
		ScheduleID: "schedule-takeover-" + uuid.NewString(),
		AccountID:  accountID,
		WorkerID:   workerID,
		MessageID:  "message-" + uuid.NewString(),
		AttemptID:  "attempt-" + uuid.NewString(),
	}
	operation := outboundSendOperation{
		AccountID: accountID,
		Type:      "schedule",
		ID:        reference.MessageID,
	}
	attemptKey, err := scheduleMessageAttemptKey(reference)
	if err != nil {
		t.Fatal(err)
	}
	ledgerKey, err := outboundSendIdempotencyKey(operation)
	if err != nil {
		t.Fatal(err)
	}
	queueKey := outboundRecoveryQueueKey(workerID)
	t.Cleanup(func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = client.Del(cleanupCtx, attemptKey, ledgerKey).Err()
		_ = client.ZRem(cleanupCtx, queueKey, ledgerKey).Err()
		_ = client.ZRem(
			cleanupCtx,
			scheduleReconciliationDeadlineKey,
			reference.ScheduleID,
		).Err()
		_ = client.HDel(
			cleanupCtx,
			scheduleReconciliationVersionKey,
			reference.ScheduleID,
		).Err()
	})

	oldScope := whatsAppRuntimeFence{
		State:              "active",
		WorkerID:           workerID,
		RuntimeGeneration:  41,
		ConnectionEpoch:    "old-runtime-" + uuid.NewString(),
		ConnectionSequence: 1,
		SourceProvider:     "whatsmeow",
		ActivatedAt:        time.Now().Add(-time.Minute).UnixMilli(),
		ActivationOrder:    1,
	}
	currentScope := oldScope
	currentScope.RuntimeGeneration++
	currentScope.ConnectionEpoch = "new-runtime-" + uuid.NewString()
	currentScope.ActivatedAt = time.Now().UnixMilli()
	currentScope.ActivationOrder++

	published := 0
	providerCalls := 1 // The abandoned runtime already crossed WhatsApp once.
	worker := &Worker{
		cfg: Config{
			AccountID: accountID,
			WorkerID:  workerID,
		},
		redis: client,
		outboundRecoveryScopeCapturer: func(context.Context) (whatsAppRuntimeFence, error) {
			return currentScope, nil
		},
		outboundRecoveryPublisher: func(context.Context, outboundRecoveryRecord) error {
			published++
			return nil
		},
	}
	worker.kafkaConsumerBarrierEpoch.Store(902)
	worker.kafkaConsumersReady.Store(true)
	worker.kafkaConsumersAuthorized.Store(true)

	oldAttempt, err := worker.claimScheduleMessageAttempt(ctx, reference)
	if err != nil || oldAttempt.State != scheduleMessageAttemptAcquired {
		t.Fatalf("old schedule attempt was not acquired: claim=%+v err=%v", oldAttempt, err)
	}
	oldLeaseUntil, err := client.HGet(ctx, attemptKey, "lease_until_ms").Int64()
	if err != nil {
		t.Fatal(err)
	}
	if remaining := time.Until(time.UnixMilli(oldLeaseUntil)); remaining < 4*time.Minute {
		t.Fatalf("test did not create the intended five-minute lease: %s", remaining)
	}

	claim, err := claimOutboundOperationWithRedis(
		ctx,
		client,
		operation,
		map[string]any{
			"worker_id":                 workerID,
			"message_id":                reference.MessageID,
			"consumer_assignment_epoch": 901,
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
		901,
		oldScope,
		reference.MessageID,
		"5511999999999@s.whatsapp.net",
		&reference,
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := worker.markOutboundProviderInvokedWithRecovery(ctx, claim, recovery); err != nil {
		t.Fatal(err)
	}

	currentAttempt, err := worker.takeoverScheduleMessageAttemptRecovery(
		ctx,
		reference,
		operation,
		901,
		oldScope,
	)
	if err != nil {
		t.Fatal(err)
	}
	if currentAttempt.Acquired {
		t.Fatal("takeover stole a lease from the still-current assignment/runtime")
	}
	if err := worker.assertScheduleMessageAttempt(ctx, oldAttempt.Lease); err != nil {
		t.Fatalf("safety check disturbed the current schedule owner: %v", err)
	}

	startedAt := time.Now()
	takeover, err := worker.takeoverScheduleMessageAttemptRecovery(
		ctx,
		reference,
		operation,
		902,
		currentScope,
	)
	elapsed := time.Since(startedAt)
	if err != nil || !takeover.Acquired {
		t.Fatalf("obsolete recovery was not taken over: takeover=%+v err=%v", takeover, err)
	}
	if elapsed >= 2*time.Second {
		t.Fatalf("takeover waited for the old five-minute lease: %s", elapsed)
	}
	if providerCalls != 1 {
		t.Fatalf("schedule recovery retried the provider: calls=%d", providerCalls)
	}
	if got := client.HGet(ctx, ledgerKey, "state").Val(); got != sendIdempotencyStateAmbiguous {
		t.Fatalf("provider_invoked ledger was not terminalized: %q", got)
	}
	if err := worker.assertScheduleMessageAttempt(ctx, oldAttempt.Lease); !errors.Is(err, errScheduleMessageAttemptLeaseLost) {
		t.Fatalf("obsolete schedule owner retained its lease: %v", err)
	}

	err = worker.withTakenOverScheduleMessageAttempt(
		ctx,
		takeover.Lease,
		func(attemptCtx context.Context) error {
			if err := worker.setScheduleMessageOperationalState(
				attemptCtx,
				reference,
				scheduleMessageOperationalAmbiguous,
			); err != nil {
				return err
			}
			return worker.publishAndAcknowledgeOutboundRecovery(
				attemptCtx,
				takeover.Claim,
				takeover.Recovery,
			)
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if providerCalls != 1 {
		t.Fatalf("publication takeover called the provider: calls=%d", providerCalls)
	}
	if published != 1 {
		t.Fatalf("ambiguous recovery published %d times", published)
	}
	if got := client.HGet(ctx, attemptKey, "state").Val(); got != "completed" {
		t.Fatalf("taken-over attempt was not completed: %q", got)
	}
	if _, err := client.ZScore(ctx, queueKey, ledgerKey).Result(); !errors.Is(err, redis.Nil) {
		t.Fatalf("ambiguous recovery queue entry was not acknowledged: %v", err)
	}
}
