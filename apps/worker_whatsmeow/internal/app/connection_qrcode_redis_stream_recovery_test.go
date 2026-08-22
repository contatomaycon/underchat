package app

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

func TestConnectionQRCodeRedisNoGroupErrorClassification(t *testing.T) {
	if !isConnectionQRCodeRedisNoGroupError(errors.New("NOGROUP No such key or consumer group")) {
		t.Fatal("expected NOGROUP to be classified as a recoverable missing group")
	}
	if isConnectionQRCodeRedisNoGroupError(errors.New("READONLY replica")) {
		t.Fatal("unexpected Redis errors must not be classified as NOGROUP")
	}
	if isConnectionQRCodeRedisNoGroupError(nil) {
		t.Fatal("nil must not be classified as NOGROUP")
	}
}

func TestConnectionQRCodeRedisReadersRecoverDeletedGroupWithoutRestart(t *testing.T) {
	address := os.Getenv("TEST_REDIS_ADDR")
	if address == "" {
		t.Skip("TEST_REDIS_ADDR is not configured")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	client := redis.NewClient(&redis.Options{
		Addr:     address,
		Password: os.Getenv("TEST_REDIS_PASSWORD"),
	})
	t.Cleanup(func() { _ = client.Close() })

	workerID := "qr-group-recovery-" + uuid.NewString()
	worker := &Worker{
		cfg: Config{
			WorkerID:  workerID,
			AccountID: "qr-group-recovery-account",
		},
		redis: client,
	}
	streamKey := worker.connectionQRCodeRedisStreamKey(workerID)
	groupID := worker.connectionQRCodeRedisStreamGroup(workerID)
	consumerName := worker.connectionQRCodeRedisStreamConsumer(workerID)
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cleanupCancel()
		_ = client.Del(cleanupCtx, streamKey).Err()
	})

	messageID, err := client.XAdd(ctx, &redis.XAddArgs{
		Stream: streamKey,
		Values: map[string]any{"request_id": "request-1"},
	}).Result()
	if err != nil {
		t.Fatal(err)
	}

	streams, err := worker.readConnectionQRCodeRedisMessages(ctx, streamKey, groupID, consumerName)
	if err != nil {
		t.Fatalf("XREADGROUP did not recover NOGROUP: %v", err)
	}
	if len(streams) != 1 || len(streams[0].Messages) != 1 || streams[0].Messages[0].ID != messageID {
		t.Fatalf("unexpected recovered stream response: %#v", streams)
	}

	if _, err := client.XGroupDestroy(ctx, streamKey, groupID).Result(); err != nil {
		t.Fatal(err)
	}
	claimed, err := worker.claimConnectionQRCodeRedisMessages(ctx, streamKey, groupID, consumerName)
	if err != nil {
		t.Fatalf("XAUTOCLAIM did not recover NOGROUP: %v", err)
	}
	if len(claimed) != 0 {
		t.Fatalf("newly recreated group unexpectedly claimed messages: %#v", claimed)
	}

	groups, err := client.XInfoGroups(ctx, streamKey).Result()
	if err != nil {
		t.Fatal(err)
	}
	if len(groups) != 1 || groups[0].Name != groupID {
		t.Fatalf("consumer group was not recreated: %#v", groups)
	}
}

func TestConnectionQRCodeAttemptCASRejectsProviderResponseAfterReplacement(t *testing.T) {
	address := os.Getenv("TEST_REDIS_ADDR")
	if address == "" {
		t.Skip("TEST_REDIS_ADDR is not configured")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	client := redis.NewClient(&redis.Options{
		Addr:     address,
		Password: os.Getenv("TEST_REDIS_PASSWORD"),
	})
	t.Cleanup(func() { _ = client.Close() })

	workerID := "qr-cas-replacement-" + uuid.NewString()
	worker := &Worker{
		cfg: Config{
			WorkerID:  workerID,
			AccountID: "qr-cas-replacement-account",
		},
		redis: client,
	}
	attemptA := WorkerConnectionQRCodeQueueMessage{
		ConnectionAttemptID:       uuid.NewString(),
		AuthorizedConnectionEpoch: uuid.NewString(),
		WorkerID:                  workerID,
		AccountID:                 worker.cfg.AccountID,
		WorkerTypeID:              WorkerTypeWhatsmeow,
		RuntimeGeneration:         17,
	}
	attemptB := attemptA
	attemptB.ConnectionAttemptID = uuid.NewString()
	attemptB.AuthorizedConnectionEpoch = uuid.NewString()

	activeKey := worker.activeConnectionQRCodeAttemptKey(workerID)
	cacheKey := worker.connectionQRCodeAttemptCacheKey(workerID)
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cleanupCancel()
		_ = client.Del(
			cleanupCtx,
			activeKey,
			cacheKey,
			worker.processedConnectionQRCodeAttemptKey(attemptA),
			worker.processedConnectionQRCodeAttemptKey(attemptB),
		).Err()
	})

	activate := func(data WorkerConnectionQRCodeQueueMessage) {
		t.Helper()
		envelope, err := json.Marshal(map[string]any{
			"worker_type_id":              data.WorkerTypeID,
			"runtime_generation":          data.RuntimeGeneration,
			"authorized_connection_epoch": data.AuthorizedConnectionEpoch,
			"ack": map[string]any{
				"connection_attempt_id":       data.ConnectionAttemptID,
				"worker_type_id":              data.WorkerTypeID,
				"runtime_generation":          data.RuntimeGeneration,
				"authorized_connection_epoch": data.AuthorizedConnectionEpoch,
			},
		})
		if err != nil {
			t.Fatal(err)
		}
		if err := client.Set(ctx, activeKey, envelope, time.Minute).Err(); err != nil {
			t.Fatal(err)
		}
	}

	activate(attemptA)
	active, err := worker.compareConnectionQRCodeAttemptAndMaybeCache(
		ctx,
		attemptA,
		`{"connection_attempt_id":"attempt-a"}`,
		time.Minute,
	)
	if err != nil || !active {
		t.Fatalf("attempt A should initially own the cache CAS: active=%t err=%v", active, err)
	}

	// B supersedes A while A's provider invocation is still in flight. When A
	// finally returns, its CAS must neither validate nor overwrite B's QR cache.
	activate(attemptB)
	payloadB := `{"connection_attempt_id":"` + attemptB.ConnectionAttemptID + `"}`
	active, err = worker.compareConnectionQRCodeAttemptAndMaybeCache(ctx, attemptB, payloadB, time.Minute)
	if err != nil || !active {
		t.Fatalf("attempt B should own the replacement cache CAS: active=%t err=%v", active, err)
	}
	active, err = worker.compareConnectionQRCodeAttemptAndMaybeCache(
		ctx,
		attemptA,
		`{"connection_attempt_id":"stale-attempt-a"}`,
		time.Minute,
	)
	if err != nil {
		t.Fatal(err)
	}
	if active {
		t.Fatal("superseded attempt A unexpectedly passed the exact CAS")
	}

	cached, err := client.Get(ctx, cacheKey).Result()
	if err != nil {
		t.Fatal(err)
	}
	if cached != payloadB {
		t.Fatalf("stale attempt A overwrote B's cache: got %q want %q", cached, payloadB)
	}
}
