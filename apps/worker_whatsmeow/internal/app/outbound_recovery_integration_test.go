package app

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strconv"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/segmentio/kafka-go"
)

func TestDurableOutboundRecoveryRebindsAfterAssignmentReplacement(t *testing.T) {
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

	workerID := "recovery-worker-" + uuid.NewString()
	accountID := "recovery-account-" + uuid.NewString()
	operation := outboundSendOperation{AccountID: accountID, Type: "direct", ID: "message-1"}
	originScope := whatsAppRuntimeFence{
		State:             "active",
		WorkerID:          workerID,
		RuntimeGeneration: 7,
		ConnectionEpoch:   "epoch-1",
		SourceProvider:    "whatsmeow",
	}
	firstWorker := &Worker{
		cfg: Config{
			AccountID:         accountID,
			WorkerID:          workerID,
			RuntimeGeneration: originScope.RuntimeGeneration,
		},
		redis: client,
	}
	firstWorker.kafkaConsumerBarrierEpoch.Store(100)
	firstWorker.kafkaConsumersReady.Store(true)
	firstWorker.kafkaConsumersAuthorized.Store(true)
	claim, err := firstWorker.claimOutboundOperation(ctx, operation, map[string]any{"message_id": "message-1"})
	if err != nil {
		t.Fatal(err)
	}
	queueKey := outboundRecoveryQueueKey(workerID)
	t.Cleanup(func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = client.Del(cleanupCtx, claim.Key, queueKey).Err()
	})
	if err := firstWorker.prepareOutboundRecovery(ctx, claim); err != nil {
		t.Fatal(err)
	}
	if err := firstWorker.markOutboundProviderInvoked(ctx, claim); err != nil {
		t.Fatal(err)
	}
	update := UpdateMessage{
		WorkerID:          workerID,
		SourceProvider:    "whatsmeow",
		RuntimeGeneration: originScope.RuntimeGeneration,
		ConnectionEpoch:   originScope.ConnectionEpoch,
		Message:           map[string]any{"key": map[string]any{"id": "provider-1"}},
		Data: ChatMessage{
			MessageID: "message-1",
			Account:   map[string]any{"id": accountID},
			Worker:    map[string]any{"id": workerID},
		},
	}
	originalEventID := ensureMessageUpdateEventID(&update)
	publication, err := newOutboundRecoveryPublication(
		topicUpdateMessage,
		outboundUpdateKafkaKey(accountID, workerID, "message-1"),
		update,
	)
	if err != nil {
		t.Fatal(err)
	}
	recovery := outboundRecoveryRecord{
		SchemaVersion:           outboundRecoverySchemaVersion,
		WorkerID:                workerID,
		AccountID:               accountID,
		ConsumerAssignmentEpoch: 100,
		OriginRuntimeGeneration: originScope.RuntimeGeneration,
		OriginConnectionEpoch:   originScope.ConnectionEpoch,
		Publications:            []outboundRecoveryPublication{publication},
	}
	if err := firstWorker.completeOutboundSuccessWithRecovery(ctx, claim, map[string]any{"update_message": map[string]any{"message_id": "message-1"}}, recovery); err != nil {
		t.Fatal(err)
	}

	firstWorker.outboundRecoveryPublisher = func(context.Context, outboundRecoveryRecord) error {
		return errors.New("forced Kafka outage")
	}
	if err := firstWorker.publishAndAcknowledgeOutboundRecovery(ctx, claim, recovery); err == nil {
		t.Fatal("expected the immediate post-provider publication to fail")
	}
	if _, err := client.ZScore(ctx, queueKey, claim.Key).Result(); err != nil {
		t.Fatalf("durable recovery index was lost after publication failure: %v", err)
	}

	// A replacement assignment republishes only the durable follow-up under
	// its current Kafka acceptance fence. The provider and an active WhatsApp
	// scope are never represented here.
	var published atomic.Int32
	replacement := &Worker{
		cfg: Config{
			AccountID:         accountID,
			WorkerID:          workerID,
			RuntimeGeneration: 8,
		},
		redis: client,
		outboundRecoveryPublisher: func(_ context.Context, got outboundRecoveryRecord) error {
			published.Add(1)
			if len(got.Publications) != 1 || got.Publications[0].Topic != topicUpdateMessage {
				t.Fatalf("unexpected recovered publications: %#v", got.Publications)
			}
			if got.ConsumerAssignmentEpoch != 200 {
				t.Fatalf("recovery assignment was not rebound: %d", got.ConsumerAssignmentEpoch)
			}
			var rebound UpdateMessage
			if err := json.Unmarshal(got.Publications[0].Payload, &rebound); err != nil {
				t.Fatal(err)
			}
			if rebound.EventID != originalEventID ||
				rebound.RuntimeGeneration != originScope.RuntimeGeneration ||
				rebound.ConnectionEpoch != originScope.ConnectionEpoch {
				t.Fatalf("unexpected rebound update: %#v", rebound)
			}
			return nil
		},
	}
	replacement.kafkaConsumerBarrierEpoch.Store(200)
	replacement.kafkaConsumersReady.Store(true)
	replacement.kafkaConsumersAuthorized.Store(true)
	if err := replacement.processDueOutboundRecoveries(ctx); err != nil {
		t.Fatal(err)
	}
	if published.Load() != 1 {
		t.Fatalf("replacement assignment recovery published %d Kafka records", published.Load())
	}
	if _, err := client.ZScore(ctx, queueKey, claim.Key).Result(); !errors.Is(err, redis.Nil) {
		t.Fatalf("recovery index was not acknowledged: %v", err)
	}
	if state := client.HGet(ctx, claim.Key, "state").Val(); state != sendIdempotencyStateSucceeded {
		t.Fatalf("unexpected durable ledger state %q", state)
	}
}

func TestFailedPreProviderRecoverySurvivesPublicationFailureWithoutProviderRetry(t *testing.T) {
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

	workerID := "failed-recovery-worker-" + uuid.NewString()
	accountID := "failed-recovery-account-" + uuid.NewString()
	operation := outboundSendOperation{
		AccountID: accountID,
		Type:      "direct",
		ID:        "message-1",
	}
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
	}
	worker.kafkaConsumerBarrierEpoch.Store(91)
	worker.kafkaConsumersReady.Store(true)
	worker.kafkaConsumersAuthorized.Store(true)
	claim, err := worker.claimOutboundOperation(ctx, operation, map[string]any{
		"message_id":                "message-1",
		"consumer_assignment_epoch": 91,
	})
	if err != nil {
		t.Fatal(err)
	}
	queueKey := outboundRecoveryQueueKey(workerID)
	t.Cleanup(func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = client.Del(cleanupCtx, claim.Key, queueKey).Err()
	})
	if err := worker.prepareOutboundRecovery(ctx, claim); err != nil {
		t.Fatal(err)
	}
	failedUpdate := MessageStatusUpdate{
		AccountID:         accountID,
		WorkerID:          workerID,
		SourceProvider:    "whatsmeow",
		RuntimeGeneration: 7,
		ConnectionEpoch:   "epoch-1",
		MessageID:         "message-1",
		Failed:            true,
	}
	ensureMessageStatusEventID(&failedUpdate)
	publication, err := newOutboundRecoveryPublication(
		topicUpdateMessageStatus,
		messageStatusKafkaKey(accountID, workerID, "message-1"),
		failedUpdate,
	)
	if err != nil {
		t.Fatal(err)
	}
	recovery := outboundRecoveryRecord{
		SchemaVersion:           outboundRecoverySchemaVersion,
		WorkerID:                workerID,
		AccountID:               accountID,
		ConsumerAssignmentEpoch: 91,
		OriginRuntimeGeneration: activeScope.RuntimeGeneration,
		OriginConnectionEpoch:   activeScope.ConnectionEpoch,
		Publications:            []outboundRecoveryPublication{publication},
	}
	preProviderErr := errors.New("typing/send parent deadline")
	if err := worker.completeOutboundPreProviderFailureWithRecovery(
		context.Background(),
		claim,
		preProviderErr,
		recovery,
	); err != nil {
		t.Fatal(err)
	}
	if state := client.HGet(ctx, claim.Key, "state").Val(); state != sendIdempotencyStateFailed {
		t.Fatalf("unexpected failed ledger state %q", state)
	}
	if raw := client.HGet(ctx, claim.Key, "recovery_json").Val(); raw == "" {
		t.Fatal("failed ledger lost recovery payload")
	}

	worker.outboundRecoveryPublisher = func(context.Context, outboundRecoveryRecord) error {
		return errors.New("forced Kafka outage")
	}
	if err := worker.publishAndAcknowledgeOutboundRecovery(ctx, claim, recovery); err == nil {
		t.Fatal("expected failed-status publication outage")
	}
	if _, err := client.ZScore(ctx, queueKey, claim.Key).Result(); err != nil {
		t.Fatalf("publication failure lost durable recovery index: %v", err)
	}

	var published atomic.Int32
	worker.outboundRecoveryPublisher = func(_ context.Context, got outboundRecoveryRecord) error {
		published.Add(1)
		if len(got.Publications) != 1 ||
			got.Publications[0].Topic != topicUpdateMessageStatus {
			t.Fatalf("unexpected failed recovery: %#v", got)
		}
		return nil
	}
	if err := worker.processDueOutboundRecoveries(ctx); err != nil {
		t.Fatal(err)
	}
	if published.Load() != 1 {
		t.Fatalf("failed recovery published %d times", published.Load())
	}
	if _, err := client.ZScore(ctx, queueKey, claim.Key).Result(); !errors.Is(err, redis.Nil) {
		t.Fatalf("completed failed recovery index was not acknowledged: %v", err)
	}

	duplicate, err := worker.claimOutboundOperation(ctx, operation, map[string]any{
		"message_id":                "message-1",
		"consumer_assignment_epoch": 91,
	})
	if err != nil {
		t.Fatal(err)
	}
	if duplicate.Acquired || duplicate.State != sendIdempotencyStateFailed {
		t.Fatalf("failed command became provider-retryable: %#v", duplicate)
	}
}

func TestOutboundRecoveryQueueOwnerCASRejectsExpiredProcess(t *testing.T) {
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

	workerID := "recovery-cas-worker-" + uuid.NewString()
	accountID := "recovery-cas-account-" + uuid.NewString()
	worker := &Worker{
		cfg:   Config{AccountID: accountID, WorkerID: workerID},
		redis: client,
	}
	claim, err := worker.claimOutboundOperation(
		ctx,
		outboundSendOperation{AccountID: accountID, Type: "direct", ID: "message-1"},
		map[string]any{"consumer_assignment_epoch": 1},
	)
	if err != nil {
		t.Fatal(err)
	}
	queueKey := outboundRecoveryQueueKey(workerID)
	t.Cleanup(func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = client.Del(cleanupCtx, claim.Key, queueKey).Err()
	})
	if err := worker.prepareOutboundRecovery(ctx, claim); err != nil {
		t.Fatal(err)
	}
	if err := worker.markOutboundProviderInvoked(ctx, claim); err != nil {
		t.Fatal(err)
	}
	failedUpdate := MessageStatusUpdate{
		AccountID:             accountID,
		WorkerID:              workerID,
		SourceProvider:        "whatsmeow",
		RuntimeGeneration:     1,
		ConnectionEpoch:       "epoch-1",
		MessageID:             "message-1",
		InternalMessageID:     "message-1",
		TerminalFailureSchema: messageSendTerminalFailureRecoverySchema,
		Patch:                 map[string]any{},
		Failed:                true,
	}
	ensureMessageStatusEventID(&failedUpdate)
	publication, err := newOutboundRecoveryPublication(
		topicUpdateMessageStatus,
		messageStatusKafkaKey(accountID, workerID, "message-1"),
		failedUpdate,
	)
	if err != nil {
		t.Fatal(err)
	}
	recovery := outboundRecoveryRecord{
		SchemaVersion:           outboundRecoverySchemaVersion,
		WorkerID:                workerID,
		AccountID:               accountID,
		ConsumerAssignmentEpoch: 1,
		OriginRuntimeGeneration: 1,
		OriginConnectionEpoch:   "epoch-1",
		Publications:            []outboundRecoveryPublication{publication},
	}
	if err := worker.completeOutboundSuccessWithRecovery(
		ctx,
		claim,
		map[string]any{"message_id": "message-1"},
		recovery,
	); err != nil {
		t.Fatal(err)
	}
	recoveryJSON := client.HGet(ctx, claim.Key, "recovery_json").Val()
	if recoveryJSON == "" {
		t.Fatal("terminal recovery body was not persisted")
	}

	oldOwner := uuid.NewString()
	if _, err := client.Eval(
		ctx,
		claimOutboundRecoveryScript,
		[]string{queueKey},
		"1",
		"1",
		oldOwner,
	).Result(); err != nil {
		t.Fatal(err)
	}
	time.Sleep(5 * time.Millisecond)
	newOwner := uuid.NewString()
	if _, err := client.Eval(
		ctx,
		claimOutboundRecoveryScript,
		[]string{queueKey},
		strconv.FormatInt(outboundRecoveryLease.Milliseconds(), 10),
		"1",
		newOwner,
	).Result(); err != nil {
		t.Fatal(err)
	}

	oldClaim := outboundRecoveryClaim{Key: claim.Key, Owner: oldOwner}
	if acknowledged, err := worker.acknowledgeOutboundRecovery(
		ctx,
		oldClaim,
		sendIdempotencyStateSucceeded,
		recoveryJSON,
	); err != nil || acknowledged {
		t.Fatalf("expired owner acknowledged replacement claim acknowledged=%t err=%v", acknowledged, err)
	}
	if rescheduled, err := worker.rescheduleOutboundRecovery(
		ctx,
		oldClaim,
		sendIdempotencyStateSucceeded,
		recoveryJSON,
	); err != nil || rescheduled {
		t.Fatalf("expired owner rescheduled replacement claim rescheduled=%t err=%v", rescheduled, err)
	}
	if _, err := client.ZScore(ctx, queueKey, claim.Key).Result(); err != nil {
		t.Fatalf("expired owner removed replacement work: %v", err)
	}

	acknowledged, err := worker.acknowledgeOutboundRecovery(
		ctx,
		outboundRecoveryClaim{Key: claim.Key, Owner: newOwner},
		sendIdempotencyStateSucceeded,
		recoveryJSON,
	)
	if err != nil || !acknowledged {
		t.Fatalf("current owner could not acknowledge recovery acknowledged=%t err=%v", acknowledged, err)
	}
	if _, err := client.ZScore(ctx, queueKey, claim.Key).Result(); !errors.Is(err, redis.Nil) {
		t.Fatalf("current owner left recovery queued: %v", err)
	}
	tombstone, err := client.HGetAll(ctx, claim.Key).Result()
	if err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{
		"meta_json",
		"result_json",
		"recovery_json",
		"owner",
		"lease_until_ms",
		"error",
		"provider_invoked_at_ms",
		"recovery_claim_owner",
		"recovery_claim_until_ms",
	} {
		if _, exists := tombstone[field]; exists {
			t.Fatalf("compacted tombstone retained heavy or ephemeral field %q", field)
		}
	}
	if tombstone["operation_type"] != "direct" || tombstone["operation_id"] != "message-1" {
		t.Fatalf("compacted tombstone lost operation identity: %#v", tombstone)
	}
	if tombstone["outcome_digest"] == "" {
		t.Fatalf("compacted tombstone lost outcome digest: %#v", tombstone)
	}
	encodedTombstone, err := json.Marshal(tombstone)
	if err != nil {
		t.Fatal(err)
	}
	if len(encodedTombstone) > 1024 {
		t.Fatalf("compacted tombstone exceeds 1KiB: %d bytes", len(encodedTombstone))
	}
}

func TestCallAutoReplyV3DeduplicatesOfferAndNotice(t *testing.T) {
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

	accountID := "call-account-" + uuid.NewString()
	manager := &WhatsAppManager{
		cfg:   Config{WorkerID: "worker-1", AccountID: accountID, RuntimeGeneration: 7},
		redis: client,
		activateRuntimeFence: func(
			context.Context,
			WhatsappRuntimeFenceActivationRequest,
		) (WhatsappRuntimeFenceActivationResponse, error) {
			return WhatsappRuntimeFenceActivationResponse{
				Activated:          true,
				ConnectionSequence: 1,
			}, nil
		},
	}
	scope, err := manager.rotateInboundConnectionScope(ctx)
	if err != nil {
		t.Fatal(err)
	}
	ctx = withInboundConnectionScope(ctx, scope)
	t.Cleanup(func() { manager.deactivateInboundConnectionScope(context.Background()) })
	var providerCalls atomic.Int32
	manager.callAutoReplySender = func(ctx context.Context, message ChatMessage, boundary providerInvocationBoundary) (map[string]any, error) {
		if err := boundary(ctx); err != nil {
			return nil, err
		}
		providerCalls.Add(1)
		return map[string]any{"key": map[string]any{"id": message.MessageID}}, nil
	}

	callID := "call-" + uuid.NewString()
	operation := outboundSendOperation{
		AccountID: accountID,
		Type:      "direct",
		ID:        callAutoReplyOperationID("worker-1", callID),
	}
	key, err := outboundSendIdempotencyKey(operation)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = client.Del(context.Background(), key).Err() })

	if err := manager.sendCallAutoReply(ctx, "5511999999999:7@c.us", callID, "Nao atendemos ligacoes"); err != nil {
		t.Fatal(err)
	}
	if err := manager.sendCallAutoReply(ctx, "5511999999999@s.whatsapp.net", callID, "Nao atendemos ligacoes"); err != nil {
		t.Fatal(err)
	}
	if providerCalls.Load() != 1 {
		t.Fatalf("CallOffer and CallOfferNotice caused %d provider sends", providerCalls.Load())
	}
}

func TestProviderCommandV3UsesRealInvocationBoundary(t *testing.T) {
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

	workerID := "command-worker-" + uuid.NewString()
	accountID := "command-account-" + uuid.NewString()
	worker := &Worker{cfg: Config{WorkerID: workerID}, redis: client}
	worker.kafkaConsumerBarrierEpoch.Store(300)
	worker.kafkaConsumersReady.Store(true)
	worker.kafkaConsumersAuthorized.Store(true)
	ctx = captureAuthorizedKafkaContext(t, worker)
	message := kafka.Message{
		Topic:     "worker." + workerID + ".send.message",
		Partition: 1,
		Offset:    77,
	}
	keyFor := func(msg kafka.Message) string {
		key, err := outboundSendIdempotencyKey(outboundSendOperation{
			AccountID: accountID,
			Type:      "direct",
			ID:        workerCommandOperationID(msg),
		})
		if err != nil {
			t.Fatal(err)
		}
		return key
	}
	var keys []string
	t.Cleanup(func() { _ = client.Del(context.Background(), keys...).Err() })

	providerCalls := 0
	send := func(boundary providerInvocationBoundary) error {
		if err := boundary(ctx); err != nil {
			return err
		}
		providerCalls++
		return nil
	}
	keys = append(keys, keyFor(message))
	if err := worker.processProviderCommandWithIdempotency(ctx, message, accountID, workerID, send, nil); err != nil {
		t.Fatal(err)
	}
	if err := worker.processProviderCommandWithIdempotency(ctx, message, accountID, workerID, send, nil); err != nil {
		t.Fatal(err)
	}
	if providerCalls != 1 {
		t.Fatalf("duplicate worker command caused %d provider calls", providerCalls)
	}
	if state := client.HGet(ctx, keys[0], "state").Val(); state != sendIdempotencyStateSucceeded {
		t.Fatalf("unexpected completed command state %q", state)
	}

	durableEffectMessage := message
	durableEffectMessage.Offset += 4
	durableEffectKey := keyFor(durableEffectMessage)
	keys = append(keys, durableEffectKey)
	durableProviderCalls := 0
	externalID := "provider-external-id-1"
	sendWithResult := func(boundary providerInvocationBoundary) error {
		if err := boundary(ctx); err != nil {
			return err
		}
		durableProviderCalls++
		return nil
	}
	sideEffectAttempts := 0
	sideEffectFailure := errors.New("external id publication unavailable")
	successHooks := func() providerCommandDurableSuccess {
		return providerCommandDurableSuccess{
			result: func() map[string]any {
				return map[string]any{"external_id": externalID}
			},
			after: func(claim outboundSendClaim) error {
				sideEffectAttempts++
				if got := stringValue(claim.Result["external_id"]); got != "provider-external-id-1" {
					t.Fatalf("durable provider result = %q", got)
				}
				if sideEffectAttempts == 1 {
					return sideEffectFailure
				}
				return nil
			},
		}
	}
	if err := worker.processProviderCommandWithIdempotency(
		ctx,
		durableEffectMessage,
		accountID,
		workerID,
		sendWithResult,
		nil,
		successHooks(),
	); !errors.Is(err, sideEffectFailure) {
		t.Fatalf("expected durable side-effect failure, got %v", err)
	}
	// Model a fresh handler after crash/redelivery: the process-local provider
	// result is gone, so only the succeeded ledger can recover it.
	externalID = ""
	if err := worker.processProviderCommandWithIdempotency(
		ctx,
		durableEffectMessage,
		accountID,
		workerID,
		sendWithResult,
		nil,
		successHooks(),
	); err != nil {
		t.Fatalf("durable side effect did not replay: %v", err)
	}
	if durableProviderCalls != 1 || sideEffectAttempts != 2 {
		t.Fatalf(
			"durable side-effect replay provider_calls=%d side_effect_attempts=%d",
			durableProviderCalls,
			sideEffectAttempts,
		)
	}

	preflightMessage := message
	preflightMessage.Offset++
	preflightKey := keyFor(preflightMessage)
	keys = append(keys, preflightKey)
	preflightErr := errors.New("media preflight failed")
	if err := worker.processProviderCommandWithIdempotency(ctx, preflightMessage, accountID, workerID, func(providerInvocationBoundary) error {
		return preflightErr
	}, nil); !errors.Is(err, preflightErr) {
		t.Fatalf("expected pre-provider error, got %v", err)
	}
	if exists := client.Exists(ctx, preflightKey).Val(); exists != 0 {
		t.Fatalf("pre-provider failure left an idempotency reservation behind")
	}
	if err := worker.processProviderCommandWithIdempotency(ctx, preflightMessage, accountID, workerID, send, nil); err != nil {
		t.Fatal(err)
	}
	if providerCalls != 2 {
		t.Fatalf("released pre-provider failure did not permit retry; calls=%d", providerCalls)
	}

	reportedPreflightMessage := message
	reportedPreflightMessage.Offset += 3
	reportedPreflightKey := keyFor(reportedPreflightMessage)
	keys = append(keys, reportedPreflightKey)
	preProviderFailureCalls := 0
	if err := worker.processProviderCommandWithIdempotency(
		ctx,
		reportedPreflightMessage,
		accountID,
		workerID,
		func(providerInvocationBoundary) error {
			return preflightErr
		},
		func(got error) error {
			if !errors.Is(got, preflightErr) {
				t.Fatalf("unexpected pre-provider callback error: %v", got)
			}
			preProviderFailureCalls++
			return nil
		},
	); err != nil {
		t.Fatalf("reported pre-provider failure must be consumed, got %v", err)
	}
	if preProviderFailureCalls != 1 {
		t.Fatalf("pre-provider failure callback ran %d times", preProviderFailureCalls)
	}
	if exists := client.Exists(ctx, reportedPreflightKey).Val(); exists != 0 {
		t.Fatalf("reported pre-provider failure left an idempotency reservation behind")
	}

	ambiguousMessage := message
	ambiguousMessage.Offset += 2
	ambiguousKey := keyFor(ambiguousMessage)
	keys = append(keys, ambiguousKey)
	providerErr := errors.New("provider acknowledgement lost")
	failedCalls := 0
	failAfterBoundary := func(boundary providerInvocationBoundary) error {
		if err := boundary(ctx); err != nil {
			return err
		}
		failedCalls++
		return providerErr
	}
	ambiguousPreProviderFailureCalls := 0
	if err := worker.processProviderCommandWithIdempotency(
		ctx,
		ambiguousMessage,
		accountID,
		workerID,
		failAfterBoundary,
		func(error) error {
			ambiguousPreProviderFailureCalls++
			return errors.New("must not publish failed after provider_invoked")
		},
	); err != nil {
		t.Fatalf("terminal ambiguous provider error must be consumed, got %v", err)
	}
	if err := worker.processProviderCommandWithIdempotency(ctx, ambiguousMessage, accountID, workerID, failAfterBoundary, nil); err != nil {
		t.Fatal(err)
	}
	if failedCalls != 1 {
		t.Fatalf("ambiguous worker command was reinvoked %d times", failedCalls)
	}
	if ambiguousPreProviderFailureCalls != 0 {
		t.Fatalf("ambiguous worker command published %d failed side effects", ambiguousPreProviderFailureCalls)
	}
	if state := client.HGet(ctx, ambiguousKey, "state").Val(); state != sendIdempotencyStateAmbiguous {
		t.Fatalf("unexpected failed command state %q", state)
	}
}
