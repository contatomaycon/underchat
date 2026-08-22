package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

func TestOutboundIdempotencyV4RedisLifecycle(t *testing.T) {
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
	accountID := "codex-whatsmeow-idempotency-" + uuid.NewString()
	claimedKeys := make(map[string]struct{})
	trackClaim := func(claim outboundSendClaim) {
		if claim.Key != "" {
			claimedKeys[claim.Key] = struct{}{}
		}
	}
	t.Cleanup(func() {
		keys := make([]string, 0, len(claimedKeys))
		for key := range claimedKeys {
			keys = append(keys, key)
		}
		if len(keys) == 0 {
			return
		}
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := client.Del(cleanupCtx, keys...).Err(); err != nil {
			t.Errorf("cleanup redis idempotency keys: %v", err)
		}
	})
	worker := &Worker{redis: client}
	operation := outboundSendOperation{AccountID: accountID, Type: "direct", ID: "message-1"}
	operationMeta := map[string]any{"message_id": "message-1"}

	claim, err := worker.claimOutboundOperation(ctx, operation, operationMeta)
	trackClaim(claim)
	if err != nil || !claim.Acquired || claim.State != sendIdempotencyStateReserved {
		t.Fatalf("initial claim failed: claim=%+v err=%v", claim, err)
	}
	duplicate, err := worker.claimOutboundOperation(ctx, operation, operationMeta)
	if err != nil || duplicate.Acquired || duplicate.State != sendIdempotencyStateReserved {
		t.Fatalf("active reservation was not protected: claim=%+v err=%v", duplicate, err)
	}
	if err := worker.markOutboundProviderInvoked(ctx, claim); err != nil {
		t.Fatalf("mark provider invoked: %v", err)
	}
	duplicate, err = worker.claimOutboundOperation(ctx, operation, operationMeta)
	if err != nil || duplicate.Acquired || duplicate.State != sendIdempotencyStateInvoked {
		t.Fatalf("invoked operation was not protected: claim=%+v err=%v", duplicate, err)
	}
	if err := client.HSet(ctx, claim.Key, "lease_until_ms", time.Now().Add(-time.Second).UnixMilli()).Err(); err != nil {
		t.Fatal(err)
	}
	duplicate, err = worker.claimOutboundOperation(ctx, operation, operationMeta)
	if err != nil || duplicate.Acquired || duplicate.State != sendIdempotencyStateAmbiguous {
		t.Fatalf("expired invocation was not made ambiguous: claim=%+v err=%v", duplicate, err)
	}

	successOperation := outboundSendOperation{AccountID: accountID, Type: "direct", ID: "message-2"}
	successClaim, err := worker.claimOutboundOperation(ctx, successOperation, nil)
	trackClaim(successClaim)
	if err != nil {
		t.Fatal(err)
	}
	if err := worker.markOutboundProviderInvoked(ctx, successClaim); err != nil {
		t.Fatal(err)
	}
	if err := worker.completeOutboundSuccess(ctx, successClaim, map[string]any{"update_message": map[string]any{"id": "message-2"}}); err != nil {
		t.Fatal(err)
	}
	// Completion is owner-CAS and idempotent when a Redis response is lost and retried.
	if err := worker.completeOutboundSuccess(ctx, successClaim, nil); err != nil {
		t.Fatalf("idempotent success retry: %v", err)
	}
	duplicate, err = worker.claimOutboundOperation(ctx, successOperation, nil)
	if err != nil || duplicate.Acquired || duplicate.State != sendIdempotencyStateSucceeded {
		t.Fatalf("success was not protected: claim=%+v err=%v", duplicate, err)
	}
	if _, ok := recoveredUpdateMessage(duplicate); !ok {
		t.Fatal("stored update was not recoverable")
	}
	if ttl := client.TTL(ctx, successClaim.Key).Val(); ttl < workerCommandSucceededTTL-time.Minute || ttl > workerCommandSucceededTTL {
		t.Fatalf("unexpected shared ledger ttl %s", ttl)
	}

	revertedOperation := outboundSendOperation{AccountID: accountID, Type: "direct", ID: "message-reverted"}
	revertedClaim, err := worker.claimOutboundOperation(ctx, revertedOperation, nil)
	trackClaim(revertedClaim)
	if err != nil {
		t.Fatal(err)
	}
	if err := worker.markOutboundProviderInvoked(ctx, revertedClaim); err != nil {
		t.Fatal(err)
	}
	if err := worker.revertOutboundProviderInvocationBeforeStart(ctx, revertedClaim); err != nil {
		t.Fatalf("revert provider invocation before SDK start: %v", err)
	}
	// Repeating the owner-CAS models a response lost after Redis applied the
	// first reversal. It must confirm the same reserved state idempotently.
	if err := worker.revertOutboundProviderInvocationBeforeStart(ctx, revertedClaim); err != nil {
		t.Fatalf("idempotent reversal after lost response: %v", err)
	}
	if state := client.HGet(ctx, revertedClaim.Key, "state").Val(); state != sendIdempotencyStateReserved {
		t.Fatalf("reverted provider invocation state = %s", state)
	}
	if owner := client.HGet(ctx, revertedClaim.Key, "owner").Val(); owner != revertedClaim.Owner {
		t.Fatalf("reversal changed claim owner: %q", owner)
	}

	failedOperation := outboundSendOperation{AccountID: accountID, Type: "schedule", ID: "message-3"}
	failedClaim, err := worker.claimOutboundOperation(ctx, failedOperation, nil)
	trackClaim(failedClaim)
	if err != nil {
		t.Fatal(err)
	}
	if err := worker.completeOutboundPreProviderFailure(ctx, failedClaim, errOutboundPayloadInvalid); err != nil {
		t.Fatal(err)
	}
	duplicate, err = worker.claimOutboundOperation(ctx, failedOperation, nil)
	if err != nil || duplicate.Acquired || duplicate.State != sendIdempotencyStateFailed {
		t.Fatalf("terminal pre-provider failure was not protected: claim=%+v err=%v", duplicate, err)
	}

	releasedOperation := outboundSendOperation{AccountID: accountID, Type: "notification", ID: "notification-1\x00jid:1@s.whatsapp.net"}
	releasedClaim, err := worker.claimOutboundOperation(ctx, releasedOperation, nil)
	trackClaim(releasedClaim)
	if err != nil {
		t.Fatal(err)
	}
	if err := worker.releaseOutboundReservation(ctx, releasedClaim); err != nil {
		t.Fatal(err)
	}
	reacquired, err := worker.claimOutboundOperation(ctx, releasedOperation, nil)
	trackClaim(reacquired)
	if err != nil || !reacquired.Acquired {
		t.Fatalf("released pre-provider reservation was not reacquired: claim=%+v err=%v", reacquired, err)
	}

	collisionOperation := outboundSendOperation{
		AccountID: accountID,
		Type:      "direct",
		ID:        "shared-business-hash",
	}
	collisionClaim, err := worker.claimOutboundOperation(
		ctx,
		collisionOperation,
		map[string]any{
			"provider":   "whatsmeow",
			"account_id": accountID,
			"worker_id":  "worker-1",
			"message_id": "message-a",
			"chat_id":    "chat-a",
			"topic":      "worker.send",
		},
	)
	trackClaim(collisionClaim)
	if err != nil || !collisionClaim.Acquired {
		t.Fatalf("collision baseline claim failed: claim=%+v err=%v", collisionClaim, err)
	}
	conflictingClaim, err := worker.claimOutboundOperation(
		ctx,
		collisionOperation,
		map[string]any{
			"provider":   "whatsmeow",
			"account_id": accountID,
			"worker_id":  "worker-1",
			"message_id": "message-b",
			"chat_id":    "chat-b",
			"topic":      "worker.send",
		},
	)
	if !errors.Is(err, errOutboundIdempotencyIdentityConflict) {
		t.Fatalf("immutable identity collision was not rejected: claim=%+v err=%v", conflictingClaim, err)
	}
	if conflictingClaim.Result != nil || conflictingClaim.Recovery != nil {
		t.Fatalf("identity collision exposed another operation result: %#v", conflictingClaim)
	}

	legacyOperation := outboundSendOperation{
		AccountID: accountID,
		Type:      "direct",
		ID:        "legacy-message-hash",
	}
	legacyClaim, err := worker.claimOutboundOperation(
		ctx,
		legacyOperation,
		map[string]any{
			"worker_id":  "worker-legacy",
			"message_id": "message-legacy",
			"chat_id":    "chat-legacy",
			"topic":      "worker.send",
			"partition":  2,
			"offset":     11,
		},
	)
	trackClaim(legacyClaim)
	if err != nil || !legacyClaim.Acquired {
		t.Fatalf("legacy baseline claim failed: claim=%+v err=%v", legacyClaim, err)
	}
	legacyReplay, err := worker.claimOutboundOperation(
		ctx,
		legacyOperation,
		map[string]any{
			"provider":   "whatsmeow",
			"account_id": accountID,
			"worker_id":  "worker-legacy",
			"message_id": "message-legacy",
			"chat_id":    "chat-legacy",
			"topic":      "worker.send",
			"partition":  2,
			"offset":     11,
		},
	)
	if err != nil ||
		legacyReplay.Acquired ||
		legacyReplay.State != sendIdempotencyStateReserved {
		t.Fatalf("safe legacy identity was not replay-compatible: claim=%+v err=%v", legacyReplay, err)
	}
}

func TestOutboundProviderWatchdogV4TerminalizesAbandonedInvocation(t *testing.T) {
	address := os.Getenv("TEST_REDIS_ADDR")
	if address == "" {
		t.Skip("TEST_REDIS_ADDR is not configured")
	}
	ctx := context.Background()
	client := redis.NewClient(&redis.Options{Addr: address, Password: os.Getenv("TEST_REDIS_PASSWORD")})
	t.Cleanup(func() { _ = client.Close() })
	worker := &Worker{redis: client, cfg: Config{WorkerID: "watchdog-worker-" + uuid.NewString()}}
	operation := outboundSendOperation{
		AccountID: "watchdog-account-" + uuid.NewString(),
		Type:      "direct",
		ID:        "watchdog-operation-" + uuid.NewString(),
	}
	claim, err := worker.claimOutboundOperation(ctx, operation, map[string]any{
		"provider": "whatsmeow", "account_id": operation.AccountID, "worker_id": worker.cfg.WorkerID,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = client.ZRem(cleanupCtx, outboundProviderWatchdogQueueKey(), claim.Key).Err()
		_ = client.Del(cleanupCtx, claim.Key).Err()
	})
	if err := worker.markOutboundProviderInvoked(ctx, claim); err != nil {
		t.Fatal(err)
	}
	if score := client.ZScore(ctx, outboundProviderWatchdogQueueKey(), claim.Key).Val(); score <= float64(time.Now().UnixMilli()) {
		t.Fatalf("provider watchdog was not scheduled in the future: %.0f", score)
	}
	if err := client.ZAdd(ctx, outboundProviderWatchdogQueueKey(), redis.Z{Score: float64(time.Now().Add(-time.Second).UnixMilli()), Member: claim.Key}).Err(); err != nil {
		t.Fatal(err)
	}
	if err := worker.processOutboundProviderWatchdog(ctx); err != nil {
		t.Fatal(err)
	}
	inspected, exists, err := inspectOutboundOperationWithRedis(ctx, client, operation)
	if err != nil || !exists || inspected.State != sendIdempotencyStateAmbiguous || inspected.TerminalAtMS <= 0 {
		t.Fatalf("watchdog terminal state = %+v exists=%v err=%v", inspected, exists, err)
	}
	if scoreErr := client.ZScore(ctx, outboundProviderWatchdogQueueKey(), claim.Key).Err(); !errors.Is(scoreErr, redis.Nil) {
		t.Fatalf("watchdog member was not compacted: %v", scoreErr)
	}
}

func TestOutboundProviderWatchdogV4ReleasesWorkerCommandLaneAsAmbiguous(t *testing.T) {
	address := os.Getenv("TEST_REDIS_ADDR")
	if address == "" {
		t.Skip("TEST_REDIS_ADDR is not configured")
	}
	ctx := context.Background()
	client := redis.NewClient(&redis.Options{Addr: address, Password: os.Getenv("TEST_REDIS_PASSWORD")})
	t.Cleanup(func() { _ = client.Close() })
	workerID := "watchdog-lane-worker-" + uuid.NewString()
	accountID := "watchdog-lane-account-" + uuid.NewString()
	worker := &Worker{redis: client, cfg: Config{WorkerID: workerID, AccountID: accountID}}
	const assignmentEpoch = uint64(41)
	worker.kafkaConsumerBarrierEpoch.Store(assignmentEpoch)
	worker.kafkaConsumersAuthorized.Store(true)
	worker.kafkaConsumersReady.Store(true)
	worker.kafkaConsumersStarted.Store(true)

	issuedAt := time.Now().UTC().Truncate(time.Millisecond)
	envelope := WorkerCommandEnvelopeV1{
		CommandID: uuid.NewString(), OperationID: "watchdog-lane-operation-" + uuid.NewString(),
		AccountID: accountID, WorkerID: workerID, EntityKey: "chat:" + accountID + ":" + workerID + ":chat-1",
		EntitySequence: 1, OriginEpoch: "logical-command-epoch", IssuedAt: workerCommandTimestamp(issuedAt),
		PayloadDigest: "ea4529441c11c15cb44c9597af9944d10b459a8718a901cf5c7cfb1e15c89874", CommandType: WorkerCommandTypeDirectSend,
	}
	laneKey := workerCommandLaneKey(envelope)
	operationDigest := workerCommandLaneOperationDigest(envelope.OperationID)
	if err := client.HSet(ctx, laneKey, map[string]any{
		"sequence":                            1,
		"op:" + operationDigest + ":sequence": 1, "op:" + operationDigest + ":operation_id": envelope.OperationID,
		"op:" + operationDigest + ":predecessor": "", "op:" + operationDigest + ":issued_at_ms": issuedAt.UnixMilli(),
		"op:" + operationDigest + ":command_id": envelope.CommandID, "op:" + operationDigest + ":origin_epoch": envelope.OriginEpoch,
		"op:" + operationDigest + ":payload_digest": envelope.PayloadDigest, "op:" + operationDigest + ":command_type": envelope.CommandType,
	}).Err(); err != nil {
		t.Fatal(err)
	}
	if disposition, err := worker.claimWorkerCommandLane(ctx, envelope); err != nil || disposition != workerCommandLaneAcquired {
		t.Fatalf("claim worker command lane = %q, %v", disposition, err)
	}

	operation := outboundSendOperation{AccountID: accountID, Type: "direct", ID: envelope.OperationID}
	claim, err := worker.claimOutboundOperation(ctx, operation, map[string]any{"account_id": accountID, "worker_id": workerID})
	if err != nil {
		t.Fatal(err)
	}
	queueKey := outboundRecoveryQueueKey(workerID)
	t.Cleanup(func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = client.ZRem(cleanupCtx, outboundProviderWatchdogQueueKey(), claim.Key).Err()
		_ = client.Del(cleanupCtx, claim.Key, queueKey, laneKey).Err()
	})
	if err := worker.prepareOutboundRecovery(ctx, claim); err != nil {
		t.Fatal(err)
	}
	authorized := context.WithValue(ctx, kafkaDispatchAuthorizationContextKey{}, kafkaDispatchAuthorization{worker: worker, epoch: assignmentEpoch})
	commandCtx := withWorkerCommandEpochVerification(authorized, envelope, func(context.Context, WorkerCommandEnvelopeV1) error { return nil })
	if err := worker.markOutboundProviderInvoked(commandCtx, claim); err != nil {
		t.Fatal(err)
	}
	if err := client.ZAdd(ctx, outboundProviderWatchdogQueueKey(), redis.Z{Score: float64(time.Now().Add(-time.Second).UnixMilli()), Member: claim.Key}).Err(); err != nil {
		t.Fatal(err)
	}
	if err := worker.processOutboundProviderWatchdog(ctx); err != nil {
		t.Fatal(err)
	}
	claims, err := worker.claimDueOutboundRecoveries(ctx)
	if err != nil || len(claims) != 1 {
		t.Fatalf("claim terminal recovery = %+v, %v", claims, err)
	}
	worker.processOutboundRecovery(ctx, claims[0])
	if disposition, err := worker.claimWorkerCommandLane(ctx, envelope); err != nil || disposition != workerCommandLaneDuplicate {
		t.Fatalf("watchdog lane disposition = %q, %v", disposition, err)
	}
	if code, err := worker.workerCommandLaneFailureCode(ctx, envelope); err != nil || code != "ambiguous" {
		t.Fatalf("watchdog lane failure code = %q, %v", code, err)
	}
}

func TestTransientPreProviderFailureReleasesWithoutFailedLedger(t *testing.T) {
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

	workerID := "transient-pre-provider-" + uuid.NewString()
	accountID := "transient-pre-provider-account-" + uuid.NewString()
	worker := &Worker{
		cfg: Config{
			WorkerID:  workerID,
			AccountID: accountID,
		},
		redis: client,
	}
	operation := outboundSendOperation{
		AccountID: accountID,
		Type:      "direct",
		ID:        "message-1",
	}
	claim, err := worker.claimOutboundOperation(ctx, operation, map[string]any{
		"message_id": "message-1",
	})
	if err != nil || !claim.Acquired {
		t.Fatalf("claim transient operation: claim=%+v err=%v", claim, err)
	}
	queueKey := outboundRecoveryQueueKey(workerID)
	t.Cleanup(func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = client.Del(cleanupCtx, claim.Key, queueKey).Err()
	})
	if err := worker.prepareOutboundRecovery(ctx, claim); err != nil {
		t.Fatalf("prepare transient recovery: %v", err)
	}

	retryErr := worker.retryTransientOutboundPreProviderFailure(
		ctx,
		claim,
		true,
		fmt.Errorf("ready changed after claim: %w", ErrWhatsAppNotReady),
	)
	if !shouldRestartKafkaGenerationWithoutCommit(retryErr) {
		t.Fatalf("transient failure did not force restart without commit: %v", retryErr)
	}
	if exists := client.Exists(ctx, claim.Key).Val(); exists != 0 {
		state := client.HGet(ctx, claim.Key, "state").Val()
		t.Fatalf("transient failure retained ledger state=%q", state)
	}
	if _, err := client.ZScore(ctx, queueKey, claim.Key).Result(); !errors.Is(err, redis.Nil) {
		t.Fatalf("transient failure retained prepared recovery index: %v", err)
	}

	reacquired, err := worker.claimOutboundOperation(ctx, operation, map[string]any{
		"message_id": "message-1",
	})
	if err != nil || !reacquired.Acquired ||
		reacquired.State != sendIdempotencyStateReserved {
		t.Fatalf("transient operation was not retryable: claim=%+v err=%v", reacquired, err)
	}
	if err := worker.releaseOutboundReservation(ctx, reacquired); err != nil {
		t.Fatalf("release reacquired operation: %v", err)
	}
}

func TestOutboundReservationAndPreparedRecoveryReleaseAtomically(t *testing.T) {
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

	workerID := "atomic-release-worker-" + uuid.NewString()
	accountID := "atomic-release-account-" + uuid.NewString()
	worker := &Worker{
		cfg:   Config{WorkerID: workerID, AccountID: accountID},
		redis: client,
	}
	claim, err := worker.claimOutboundOperation(
		ctx,
		outboundSendOperation{AccountID: accountID, Type: "direct", ID: "message-1"},
		map[string]any{"message_id": "message-1"},
	)
	if err != nil {
		t.Fatal(err)
	}
	queueKey := outboundRecoveryQueueKey(workerID)
	t.Cleanup(func() {
		_ = client.Del(context.Background(), claim.Key, queueKey).Err()
	})
	if err := worker.prepareOutboundRecovery(ctx, claim); err != nil {
		t.Fatal(err)
	}

	stale := claim
	stale.Owner = "not-the-owner"
	if err := worker.releaseOutboundReservation(ctx, stale, true); err == nil {
		t.Fatal("stale owner released reservation")
	}
	if exists := client.Exists(ctx, claim.Key).Val(); exists != 1 {
		t.Fatalf("stale owner removed ledger: exists=%d", exists)
	}
	if _, err := client.ZScore(ctx, queueKey, claim.Key).Result(); err != nil {
		t.Fatalf("stale owner removed recovery index: %v", err)
	}

	if err := worker.releaseOutboundReservation(ctx, claim, true); err != nil {
		t.Fatal(err)
	}
	if exists := client.Exists(ctx, claim.Key).Val(); exists != 0 {
		t.Fatalf("owned reservation remained after release: exists=%d", exists)
	}
	if _, err := client.ZScore(ctx, queueKey, claim.Key).Result(); err != redis.Nil {
		t.Fatalf("prepared recovery was not removed atomically: %v", err)
	}
}

func TestProviderInvokedReplayPublishesAmbiguousWithoutWaitingForLease(t *testing.T) {
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

	workerID := "ambiguous-replay-worker-" + uuid.NewString()
	accountID := "ambiguous-replay-account-" + uuid.NewString()
	const assignmentEpoch = uint64(51)
	scope := whatsAppRuntimeFence{
		State:              "active",
		WorkerID:           workerID,
		RuntimeGeneration:  7,
		ConnectionEpoch:    "epoch-1",
		ConnectionSequence: 1,
		SourceProvider:     "whatsmeow",
		ActivatedAt:        time.Now().UnixMilli(),
		ActivationOrder:    1,
	}
	published := 0
	worker := &Worker{
		cfg:   Config{WorkerID: workerID, AccountID: accountID},
		redis: client,
		outboundRecoveryScopeCapturer: func(context.Context) (whatsAppRuntimeFence, error) {
			return scope, nil
		},
		outboundRecoveryPublisher: func(_ context.Context, recovery outboundRecoveryRecord) error {
			published++
			if len(recovery.Publications) != 1 {
				t.Fatalf("ambiguous publications=%d want=1", len(recovery.Publications))
			}
			var status MessageStatusUpdate
			if err := json.Unmarshal(recovery.Publications[0].Payload, &status); err != nil {
				t.Fatal(err)
			}
			if !status.Failed ||
				!status.Ambiguous ||
				status.TerminalFailureSchema != messageSendAmbiguousTerminalSchema ||
				status.InternalMessageID != status.MessageID ||
				len(status.Patch) != 0 {
				t.Fatalf("invalid ambiguous replay status: %#v", status)
			}
			if published == 1 {
				return errors.New("transient terminal status publication failure")
			}
			return nil
		},
	}
	worker.kafkaConsumerBarrierEpoch.Store(assignmentEpoch)
	worker.kafkaConsumersReady.Store(true)
	worker.kafkaConsumersAuthorized.Store(true)

	operation := outboundSendOperation{
		AccountID: accountID,
		Type:      "direct",
		ID:        "message-1",
	}
	claim, err := worker.claimOutboundOperation(
		ctx,
		operation,
		map[string]any{"consumer_assignment_epoch": assignmentEpoch},
	)
	if err != nil {
		t.Fatal(err)
	}
	queueKey := outboundRecoveryQueueKey(workerID)
	t.Cleanup(func() {
		_ = client.Del(context.Background(), claim.Key, queueKey).Err()
	})
	if err := worker.prepareOutboundRecovery(ctx, claim); err != nil {
		t.Fatal(err)
	}
	recovery, err := newOutboundAmbiguousRecovery(
		workerID,
		accountID,
		assignmentEpoch,
		scope,
		"message-1",
		"5511999999999@s.whatsapp.net",
		nil,
	)
	if err != nil {
		t.Fatal(err)
	}

	providerCalls := 1 // The original invocation crossed the provider once.
	if err := worker.markOutboundProviderInvokedWithRecovery(ctx, claim, recovery); err != nil {
		t.Fatal(err)
	}
	// A concurrent replay while the original SDK deadline is still live must
	// neither publish ambiguity nor re-invoke the provider.
	replay, err := worker.claimOutboundOperation(
		ctx,
		operation,
		map[string]any{"consumer_assignment_epoch": assignmentEpoch},
	)
	if err != nil {
		t.Fatal(err)
	}
	if replay.Acquired || replay.State != sendIdempotencyStateInvoked || replay.Recovery == nil {
		t.Fatalf("live provider invocation was not kept in flight: %#v", replay)
	}
	if published != 0 {
		t.Fatalf("live provider invocation published ambiguity %d times", published)
	}
	if err := client.HSet(
		ctx,
		claim.Key,
		"lease_until_ms",
		time.Now().Add(-time.Second).UnixMilli(),
	).Err(); err != nil {
		t.Fatal(err)
	}
	replay, err = worker.claimOutboundOperation(
		ctx,
		operation,
		map[string]any{"consumer_assignment_epoch": assignmentEpoch},
	)
	if err != nil {
		t.Fatal(err)
	}
	if replay.Acquired || replay.State != sendIdempotencyStateAmbiguous || replay.Recovery == nil {
		t.Fatalf("expired provider invocation was not terminalized: %#v", replay)
	}
	if err := worker.publishAndAcknowledgeOutboundRecovery(
		ctx,
		replay,
		*replay.Recovery,
	); err == nil {
		t.Fatal("expected first ambiguous terminal publication to remain retryable")
	}
	if _, err := client.ZScore(ctx, queueKey, claim.Key).Result(); err != nil {
		t.Fatalf("transient terminal publication removed durable recovery: %v", err)
	}
	secondReplay, err := worker.claimOutboundOperation(
		ctx,
		operation,
		map[string]any{"consumer_assignment_epoch": assignmentEpoch},
	)
	if err != nil {
		t.Fatal(err)
	}
	if secondReplay.State != sendIdempotencyStateAmbiguous || secondReplay.Recovery == nil {
		t.Fatalf("second replay lost ambiguous recovery: %#v", secondReplay)
	}
	if err := worker.publishAndAcknowledgeOutboundRecovery(
		ctx,
		secondReplay,
		*secondReplay.Recovery,
	); err != nil {
		t.Fatal(err)
	}
	if providerCalls != 1 {
		t.Fatalf("provider was retried: calls=%d", providerCalls)
	}
	if published != 2 {
		t.Fatalf("ambiguous terminal publication attempts=%d want=2", published)
	}
	if _, err := client.ZScore(ctx, queueKey, claim.Key).Result(); err != redis.Nil {
		t.Fatalf("ambiguous replay did not release recovery lag: %v", err)
	}
}

func TestNotificationAmbiguousRecoveryIsTerminalOnlyAndVersioned(t *testing.T) {
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

	workerID := "notification-terminal-worker-" + uuid.NewString()
	accountID := "notification-terminal-account-" + uuid.NewString()
	const assignmentEpoch = uint64(61)
	scope := whatsAppRuntimeFence{
		State:              "active",
		WorkerID:           workerID,
		RuntimeGeneration:  8,
		ConnectionEpoch:    "notification-epoch",
		ConnectionSequence: 1,
		SourceProvider:     "whatsmeow",
		ActivatedAt:        time.Now().UnixMilli(),
		ActivationOrder:    1,
	}
	statusPublications := 0
	worker := &Worker{
		cfg:   Config{WorkerID: workerID, AccountID: accountID},
		redis: client,
		outboundRecoveryScopeCapturer: func(context.Context) (whatsAppRuntimeFence, error) {
			return scope, nil
		},
		outboundRecoveryPublisher: func(context.Context, outboundRecoveryRecord) error {
			statusPublications++
			return nil
		},
	}
	worker.kafkaConsumerBarrierEpoch.Store(assignmentEpoch)
	worker.kafkaConsumersReady.Store(true)
	worker.kafkaConsumersAuthorized.Store(true)

	operation := outboundSendOperation{
		AccountID: accountID,
		Type:      "notification",
		ID:        "notification-1\x00jid:5511999999999@s.whatsapp.net",
	}
	claim, err := worker.claimOutboundOperation(
		ctx,
		operation,
		map[string]any{"consumer_assignment_epoch": assignmentEpoch},
	)
	if err != nil {
		t.Fatal(err)
	}
	queueKey := outboundRecoveryQueueKey(workerID)
	t.Cleanup(func() {
		_ = client.Del(context.Background(), claim.Key, queueKey).Err()
	})
	if err := worker.prepareOutboundRecovery(ctx, claim); err != nil {
		t.Fatal(err)
	}
	recovery, err := newNotificationAmbiguousRecovery(
		workerID,
		accountID,
		assignmentEpoch,
		scope,
	)
	if err != nil {
		t.Fatal(err)
	}
	if recovery.TargetKind != outboundRecoveryTargetNotification ||
		len(recovery.Publications) != 0 {
		t.Fatalf("notification recovery is not terminal-only: %#v", recovery)
	}

	providerCalls := 0
	providerCalls++
	if err := worker.markOutboundProviderInvokedWithRecovery(ctx, claim, recovery); err != nil {
		t.Fatal(err)
	}
	liveReplay, err := worker.claimOutboundOperation(ctx, operation, nil)
	if err != nil {
		t.Fatal(err)
	}
	if liveReplay.State != sendIdempotencyStateInvoked ||
		liveReplay.Acquired ||
		liveReplay.Recovery == nil {
		t.Fatalf("live notification provider lease was reopened: %#v", liveReplay)
	}
	if providerCalls != 1 {
		t.Fatalf("live notification redelivery replayed provider: %d", providerCalls)
	}

	// The first provider goroutine may still settle while its lease is live.
	// Simulate lease expiry instead of sleeping for the production timeout:
	// only then may a redelivery converge provider_invoked -> ambiguous.
	if err := client.HSet(ctx, claim.Key, "lease_until_ms", "1").Err(); err != nil {
		t.Fatal(err)
	}
	replay, err := worker.claimOutboundOperation(ctx, operation, nil)
	if err != nil {
		t.Fatal(err)
	}
	if replay.State != sendIdempotencyStateAmbiguous || replay.Recovery == nil {
		t.Fatalf("notification replay did not become terminal ambiguous: %#v", replay)
	}

	recoveryJSON, err := json.Marshal(*replay.Recovery)
	if err != nil {
		t.Fatal(err)
	}
	acknowledged, err := worker.acknowledgeOutboundRecovery(
		ctx,
		outboundRecoveryClaim{Key: replay.Key},
		sendIdempotencyStateAmbiguous,
		string(recoveryJSON)+"-stale-version",
	)
	if err != nil {
		t.Fatal(err)
	}
	if acknowledged {
		t.Fatal("stale notification recovery version was acknowledged")
	}
	if _, err := client.ZScore(ctx, queueKey, claim.Key).Result(); err != nil {
		t.Fatalf("stale ACK removed notification recovery: %v", err)
	}

	recoveryClaims, err := worker.claimDueOutboundRecoveries(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(recoveryClaims) != 1 || recoveryClaims[0].Key != replay.Key {
		t.Fatalf("notification recovery worker claims=%#v", recoveryClaims)
	}
	worker.processOutboundRecovery(ctx, recoveryClaims[0])
	if providerCalls != 1 {
		t.Fatalf("notification provider calls=%d want=1", providerCalls)
	}
	if statusPublications != 0 {
		t.Fatalf("notification emitted synthetic message status: %d", statusPublications)
	}
	if _, err := client.ZScore(ctx, queueKey, claim.Key).Result(); err != redis.Nil {
		t.Fatalf("terminal-only notification recovery was not acknowledged: %v", err)
	}
}

func TestObsoleteOutboundClaimsReconcileBeforeKafkaCommit(t *testing.T) {
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

	worker := &Worker{redis: client}
	const oldEpoch = uint64(17)
	const activeEpoch = uint64(18)
	worker.kafkaConsumerBarrierEpoch.Store(activeEpoch)
	worker.kafkaConsumersReady.Store(true)
	worker.kafkaConsumersAuthorized.Store(true)
	authorizedCtx := context.WithValue(
		ctx,
		kafkaDispatchAuthorizationContextKey{},
		kafkaDispatchAuthorization{worker: worker, epoch: activeEpoch},
	)
	accountID := "codex-whatsmeow-obsolete-claim-" + uuid.NewString()
	var keys []string
	t.Cleanup(func() {
		if len(keys) == 0 {
			return
		}
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = client.Del(cleanupCtx, keys...).Err()
	})

	reservedOperation := outboundSendOperation{AccountID: accountID, Type: "direct", ID: "reserved"}
	reserved, err := worker.claimOutboundOperation(ctx, reservedOperation, map[string]any{"consumer_assignment_epoch": oldEpoch})
	if err != nil {
		t.Fatal(err)
	}
	keys = append(keys, reserved.Key)
	reservedDuplicate, err := worker.claimOutboundOperation(ctx, reservedOperation, nil)
	if err != nil || reservedDuplicate.Acquired || reservedDuplicate.State != sendIdempotencyStateReserved {
		t.Fatalf("load obsolete reservation: claim=%+v err=%v", reservedDuplicate, err)
	}
	if err := worker.resolveUnacquiredOutboundClaim(authorizedCtx, reservedDuplicate); err == nil || shouldRestartKafkaGenerationWithoutCommit(err) {
		t.Fatalf("obsolete pre-provider reservation did not request a local reacquire: %v", err)
	}
	if exists, err := client.Exists(ctx, reserved.Key).Result(); err != nil || exists != 0 {
		t.Fatalf("obsolete reservation was not released exists=%d err=%v", exists, err)
	}
	reacquired, err := worker.claimOutboundOperation(ctx, reservedOperation, map[string]any{"consumer_assignment_epoch": activeEpoch})
	if err != nil || !reacquired.Acquired {
		t.Fatalf("released reservation was not reacquired: claim=%+v err=%v", reacquired, err)
	}

	invokedOperation := outboundSendOperation{AccountID: accountID, Type: "direct", ID: "provider-invoked"}
	invoked, err := worker.claimOutboundOperation(ctx, invokedOperation, map[string]any{"consumer_assignment_epoch": oldEpoch})
	if err != nil {
		t.Fatal(err)
	}
	keys = append(keys, invoked.Key)
	if err := worker.markOutboundProviderInvoked(ctx, invoked); err != nil {
		t.Fatal(err)
	}
	invokedDuplicate, err := worker.claimOutboundOperation(ctx, invokedOperation, nil)
	if err != nil || invokedDuplicate.Acquired || invokedDuplicate.State != sendIdempotencyStateInvoked {
		t.Fatalf("load obsolete provider invocation: claim=%+v err=%v", invokedDuplicate, err)
	}
	if err := worker.resolveUnacquiredOutboundClaim(
		authorizedCtx,
		invokedDuplicate,
	); err == nil || !shouldRestartKafkaGenerationWithoutCommit(err) {
		t.Fatalf("live obsolete provider invocation did not remain uncommitted: %v", err)
	}
	state, err := client.HGet(ctx, invoked.Key, "state").Result()
	if err != nil || state != sendIdempotencyStateInvoked {
		t.Fatalf("live provider invocation state=%q err=%v", state, err)
	}
	if err := client.HSet(
		ctx,
		invoked.Key,
		"lease_until_ms",
		time.Now().Add(-time.Second).UnixMilli(),
	).Err(); err != nil {
		t.Fatal(err)
	}
	if err := worker.resolveUnacquiredOutboundClaim(
		authorizedCtx,
		invokedDuplicate,
	); err != nil {
		t.Fatalf("expired provider invocation did not terminalize durably: %v", err)
	}
	state, err = client.HGet(ctx, invoked.Key, "state").Result()
	if err != nil || state != sendIdempotencyStateAmbiguous {
		t.Fatalf("provider invocation state=%q err=%v, want durable ambiguous", state, err)
	}
	if reason := client.HGet(ctx, invoked.Key, "error").Val(); reason != "provider_invoked_assignment_replaced" {
		t.Fatalf("unexpected ambiguity reason %q", reason)
	}
}
