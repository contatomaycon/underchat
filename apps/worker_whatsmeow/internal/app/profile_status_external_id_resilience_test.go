package app

import (
	"context"
	"errors"
	"os"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/segmentio/kafka-go"
)

func TestProfileStatusEmptyExternalIDIsDurablyAmbiguousAcrossRestart(t *testing.T) {
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

	workerID := "profile-status-empty-id-worker-" + uuid.NewString()
	accountID := "profile-status-empty-id-account-" + uuid.NewString()
	message := kafka.Message{
		Topic:     "worker." + workerID + ".send.message",
		Partition: 4,
		Offset:    117,
	}
	operation := outboundSendOperation{
		AccountID: accountID,
		Type:      "direct",
		ID:        workerCommandOperationID(message),
	}
	key, err := outboundSendIdempotencyKey(operation)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = client.Del(context.Background(), key).Err() })

	newWorker := func(epoch uint64) (*Worker, context.Context) {
		worker := &Worker{
			cfg: Config{
				AccountID: accountID,
				WorkerID:  workerID,
			},
			redis: client,
		}
		worker.kafkaConsumerBarrierEpoch.Store(epoch)
		worker.kafkaConsumersReady.Store(true)
		worker.kafkaConsumersAuthorized.Store(true)
		return worker, captureAuthorizedKafkaContext(t, worker)
	}

	var providerCalls atomic.Int32
	invokeWithEmptyExternalID := func(callCtx context.Context) func(providerInvocationBoundary) error {
		return func(boundary providerInvocationBoundary) error {
			if err := boundary(callCtx); err != nil {
				return err
			}
			providerCalls.Add(1)
			_, err := requireProfileStatusExternalID(" \t ")
			return err
		}
	}

	firstWorker, firstCtx := newWorker(901)
	if err := firstWorker.processProviderCommandWithIdempotency(
		firstCtx,
		message,
		accountID,
		workerID,
		invokeWithEmptyExternalID(firstCtx),
		nil,
	); err != nil {
		t.Fatalf("empty post-provider external id was not terminalized: %v", err)
	}
	if got := providerCalls.Load(); got != 1 {
		t.Fatalf("first execution called provider %d times, want 1", got)
	}
	if state := client.HGet(ctx, key, "state").Val(); state != sendIdempotencyStateAmbiguous {
		t.Fatalf("empty external id ledger state=%q, want ambiguous", state)
	}
	if result := client.HGet(ctx, key, "result_json").Val(); result != "" {
		t.Fatalf("ambiguous profile status persisted a success result: %q", result)
	}
	if reason := client.HGet(ctx, key, "error").Val(); !strings.Contains(reason, "missing external_id") {
		t.Fatalf("ambiguous profile status lost its operational reason: %q", reason)
	}

	// Model a process restart and a new Kafka generation. The durable
	// provider_invoked -> ambiguous transition must remain terminal for this
	// immutable operation and suppress every provider replay.
	restartedWorker, restartedCtx := newWorker(902)
	if err := restartedWorker.processProviderCommandWithIdempotency(
		restartedCtx,
		message,
		accountID,
		workerID,
		invokeWithEmptyExternalID(restartedCtx),
		nil,
	); err != nil {
		t.Fatalf("ambiguous duplicate did not settle safely: %v", err)
	}
	if got := providerCalls.Load(); got != 1 {
		t.Fatalf("restart/redelivery replayed provider; calls=%d", got)
	}
	if state := client.HGet(ctx, key, "state").Val(); state != sendIdempotencyStateAmbiguous {
		t.Fatalf("restart changed terminal ledger state to %q", state)
	}
}

func TestProfileStatusValidExternalIDReplaysAuxiliaryWithoutProvider(t *testing.T) {
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

	workerID := "profile-status-recovery-worker-" + uuid.NewString()
	accountID := "profile-status-recovery-account-" + uuid.NewString()
	message := kafka.Message{
		Topic:     "worker." + workerID + ".send.message",
		Partition: 5,
		Offset:    118,
	}
	operation := outboundSendOperation{
		AccountID: accountID,
		Type:      "direct",
		ID:        workerCommandOperationID(message),
	}
	key, err := outboundSendIdempotencyKey(operation)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = client.Del(context.Background(), key).Err() })

	newWorker := func(epoch uint64) (*Worker, context.Context) {
		worker := &Worker{
			cfg:   Config{AccountID: accountID, WorkerID: workerID},
			redis: client,
		}
		worker.kafkaConsumerBarrierEpoch.Store(epoch)
		worker.kafkaConsumersReady.Store(true)
		worker.kafkaConsumersAuthorized.Store(true)
		return worker, captureAuthorizedKafkaContext(t, worker)
	}

	var providerCalls atomic.Int32
	var auxiliaryCalls atomic.Int32
	var externalID string
	auxiliaryUnavailable := errors.New("profile external id topic unavailable")
	action := func(callCtx context.Context) func(providerInvocationBoundary) error {
		return func(boundary providerInvocationBoundary) error {
			if err := boundary(callCtx); err != nil {
				return err
			}
			providerCalls.Add(1)
			var err error
			externalID, err = requireProfileStatusExternalID(" external-status-1 ")
			return err
		}
	}
	success := func() providerCommandDurableSuccess {
		return providerCommandDurableSuccess{
			result: func() map[string]any {
				return map[string]any{"external_id": externalID}
			},
			after: func(claim outboundSendClaim) error {
				attempt := auxiliaryCalls.Add(1)
				if got := stringValue(claim.Result["external_id"]); got != "external-status-1" {
					t.Fatalf("durable external id=%q", got)
				}
				if attempt == 1 {
					return auxiliaryUnavailable
				}
				return nil
			},
		}
	}

	firstWorker, firstCtx := newWorker(911)
	if err := firstWorker.processProviderCommandWithIdempotency(
		firstCtx,
		message,
		accountID,
		workerID,
		action(firstCtx),
		nil,
		success(),
	); !errors.Is(err, auxiliaryUnavailable) {
		t.Fatalf("expected first auxiliary outage, got %v", err)
	}
	if state := client.HGet(ctx, key, "state").Val(); state != sendIdempotencyStateSucceeded {
		t.Fatalf("valid external id ledger state=%q, want succeeded", state)
	}

	// A fresh process has no process-local provider response. Recovery must use
	// the succeeded ledger result and execute only the auxiliary publication.
	externalID = ""
	restartedWorker, restartedCtx := newWorker(912)
	if err := restartedWorker.processProviderCommandWithIdempotency(
		restartedCtx,
		message,
		accountID,
		workerID,
		action(restartedCtx),
		nil,
		success(),
	); err != nil {
		t.Fatalf("valid external id auxiliary replay failed: %v", err)
	}
	if got := providerCalls.Load(); got != 1 {
		t.Fatalf("auxiliary replay repeated provider; calls=%d", got)
	}
	if got := auxiliaryCalls.Load(); got != 2 {
		t.Fatalf("auxiliary publication attempts=%d, want 2", got)
	}
}

func TestNotificationJIDUpdateFailureBlocksProviderUntilRedelivery(t *testing.T) {
	publicationUnavailable := errors.New("user phone JID topic unavailable")
	var publicationCalls atomic.Int32
	var providerCalls atomic.Int32

	run := func() error {
		err := publishNotificationJIDUpdateBeforeProvider(
			context.Background(),
			func(context.Context) error {
				if publicationCalls.Add(1) == 1 {
					return publicationUnavailable
				}
				return nil
			},
		)
		if err != nil {
			return err
		}
		providerCalls.Add(1)
		return nil
	}

	firstErr := run()
	if !errors.Is(firstErr, publicationUnavailable) {
		t.Fatalf("first publication error was not preserved: %v", firstErr)
	}
	if !shouldRestartKafkaGenerationWithoutCommit(firstErr) ||
		shouldCommitTerminalKafkaHandlerError(firstErr) {
		t.Fatalf("technical auxiliary failure did not request redrive: %T %v", firstErr, firstErr)
	}
	if got := providerCalls.Load(); got != 0 {
		t.Fatalf("provider ran before required JID publication; calls=%d", got)
	}

	if err := run(); err != nil {
		t.Fatalf("redelivery did not recover after JID publication: %v", err)
	}
	if got := publicationCalls.Load(); got != 2 {
		t.Fatalf("JID publication attempts=%d, want 2", got)
	}
	if got := providerCalls.Load(); got != 1 {
		t.Fatalf("recovered redelivery provider calls=%d, want 1", got)
	}
}
