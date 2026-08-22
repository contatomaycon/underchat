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
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestRuntimeFenceActivationRetriesTransientBalanceOutageWithSameEpoch(t *testing.T) {
	address := os.Getenv("TEST_REDIS_ADDR")
	if address == "" {
		t.Skip("TEST_REDIS_ADDR is not configured")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	client := redis.NewClient(&redis.Options{
		Addr:     address,
		Password: os.Getenv("TEST_REDIS_PASSWORD"),
	})
	t.Cleanup(func() { _ = client.Close() })

	workerID := "runtime-balance-recovery-" + uuid.NewString()
	var attempts int
	var activationEpoch string
	manager := &WhatsAppManager{
		cfg: Config{
			WorkerID:          workerID,
			AccountID:         "account-runtime-recovery",
			RuntimeGeneration: 7,
		},
		redis: client,
		activateRuntimeFence: func(
			_ context.Context,
			request WhatsappRuntimeFenceActivationRequest,
		) (WhatsappRuntimeFenceActivationResponse, error) {
			attempts++
			if activationEpoch == "" {
				activationEpoch = request.ConnectionEpoch
			} else if request.ConnectionEpoch != activationEpoch {
				t.Fatalf(
					"transient Balance retry changed connection epoch: %q != %q",
					request.ConnectionEpoch,
					activationEpoch,
				)
			}
			if attempts < 3 {
				return WhatsappRuntimeFenceActivationResponse{},
					status.Error(codes.Unavailable, "temporary Balance outage")
			}
			return WhatsappRuntimeFenceActivationResponse{
				Activated:          true,
				ConnectionSequence: 41,
			}, nil
		},
	}

	t.Cleanup(func() {
		_ = client.Del(
			context.Background(),
			whatsAppRuntimeFenceKey(workerID),
			whatsAppRuntimeFenceActivationLockKey(workerID),
			whatsAppRuntimeFenceActivationOrdersKey(workerID, 7),
			whatsAppRuntimeEffectLeasesKey(workerID),
			whatsAppRuntimeEffectLeaseOwnersKey(workerID),
		).Err()
	})

	scope, err := manager.rotateInboundConnectionScope(ctx)
	if err != nil {
		t.Fatalf("recover runtime fence after Balance outage: %v", err)
	}
	if attempts != 3 {
		t.Fatalf("Balance activation attempts = %d, want 3", attempts)
	}
	if scope.ConnectionEpoch != activationEpoch {
		t.Fatalf(
			"active scope epoch = %q, want retried epoch %q",
			scope.ConnectionEpoch,
			activationEpoch,
		)
	}
	if scope.ConnectionSequence != 41 || !scope.isValid() {
		t.Fatalf("invalid recovered runtime fence: %+v", scope)
	}
	if current, ok := manager.currentInboundConnectionScope(); !ok ||
		current != scope {
		t.Fatalf("recovered runtime fence was not installed locally: %+v", current)
	}
}

func TestKafkaConsumerOwnershipMovesAtomicallyToReplacementInstance(t *testing.T) {
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

	workerID := "consumer-owner-" + uuid.NewString()
	fenceKey := whatsAppRuntimeFenceKey(workerID)
	lockKey := whatsAppRuntimeFenceActivationLockKey(workerID)
	ordersKey := whatsAppRuntimeFenceActivationOrdersKey(workerID, 7)
	leasesKey := whatsAppRuntimeEffectLeasesKey(workerID)
	ownersKey := whatsAppRuntimeEffectLeaseOwnersKey(workerID)
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cleanupCancel()
		_ = client.Del(cleanupCtx, fenceKey, lockKey, ordersKey, leasesKey, ownersKey).Err()
	})

	firstScope := whatsAppRuntimeFence{
		State:              "active",
		WorkerID:           workerID,
		RuntimeGeneration:  7,
		ConnectionEpoch:    "first-" + uuid.NewString(),
		ConnectionSequence: 1,
		SourceProvider:     "whatsmeow",
		ActivatedAt:        time.Now().UnixMilli(),
		ActivationOrder:    1,
	}
	replacementScope := firstScope
	replacementScope.ConnectionEpoch = "replacement-" + uuid.NewString()
	replacementScope.ConnectionSequence = 2
	replacementScope.ActivatedAt++
	replacementScope.ActivationOrder = 2

	firstManager := &WhatsAppManager{
		cfg:                    Config{WorkerID: workerID, RuntimeGeneration: firstScope.RuntimeGeneration},
		redis:                  client,
		inboundConnectionScope: &firstScope,
	}
	replacementManager := &WhatsAppManager{
		cfg:                    Config{WorkerID: workerID, RuntimeGeneration: replacementScope.RuntimeGeneration},
		redis:                  client,
		inboundConnectionScope: &replacementScope,
	}

	writeFence := func(scope whatsAppRuntimeFence) {
		t.Helper()
		raw, err := json.Marshal(scope)
		if err != nil {
			t.Fatal(err)
		}
		if err := client.Set(ctx, fenceKey, raw, 0).Err(); err != nil {
			t.Fatalf("write runtime fence: %v", err)
		}
	}

	writeFence(firstScope)
	if !isKafkaConsumerOwnerScopeCurrent(ctx, firstManager, firstScope) {
		t.Fatal("first instance did not own Kafka consumers")
	}
	if isKafkaConsumerOwnerScopeCurrent(ctx, replacementManager, replacementScope) {
		t.Fatal("replacement instance owned Kafka consumers before cutover")
	}

	writeFence(replacementScope)
	if isKafkaConsumerOwnerScopeCurrent(ctx, firstManager, firstScope) {
		t.Fatal("old instance retained Kafka consumer ownership after replacement")
	}
	if !isKafkaConsumerOwnerScopeCurrent(ctx, replacementManager, replacementScope) {
		t.Fatal("replacement instance did not acquire Kafka consumer ownership")
	}
	oldLease, err := firstManager.acquireActiveRuntimeEffectLease(ctx)
	if err != nil {
		t.Fatalf("old instance active effect lease: %v", err)
	}
	if oldLease != nil {
		t.Fatal("old instance borrowed the replacement connection effect lease")
	}
	replacementLease, err := replacementManager.acquireActiveRuntimeEffectLease(ctx)
	if err != nil {
		t.Fatalf("replacement instance active effect lease: %v", err)
	}
	if replacementLease == nil {
		t.Fatal("replacement instance did not acquire its exact connection effect lease")
	}
	releaseCtx, releaseCancel := context.WithTimeout(context.Background(), 5*time.Second)
	if _, err := replacementLease.release(releaseCtx); err != nil {
		releaseCancel()
		t.Fatalf("release replacement effect lease: %v", err)
	}
	releaseCancel()
}

func TestOrphanRuntimeEffectLeaseAllowsReplacementWithinBoundedTTL(t *testing.T) {
	address := os.Getenv("TEST_REDIS_ADDR")
	if address == "" {
		t.Skip("TEST_REDIS_ADDR is not configured")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	client := redis.NewClient(&redis.Options{
		Addr:     address,
		Password: os.Getenv("TEST_REDIS_PASSWORD"),
	})
	t.Cleanup(func() { _ = client.Close() })

	workerID := "orphan-effect-lease-" + uuid.NewString()
	fenceKey := whatsAppRuntimeFenceKey(workerID)
	lockKey := whatsAppRuntimeFenceActivationLockKey(workerID)
	ordersKey := whatsAppRuntimeFenceActivationOrdersKey(workerID, 7)
	leasesKey := whatsAppRuntimeEffectLeasesKey(workerID)
	ownersKey := whatsAppRuntimeEffectLeaseOwnersKey(workerID)
	t.Cleanup(func() {
		_ = client.Del(context.Background(), fenceKey, lockKey, ordersKey, leasesKey, ownersKey).Err()
	})

	active := whatsAppRuntimeFence{
		State:              "active",
		WorkerID:           workerID,
		RuntimeGeneration:  7,
		ConnectionEpoch:    "active-" + uuid.NewString(),
		ConnectionSequence: 1,
		SourceProvider:     "whatsmeow",
		ActivatedAt:        time.Now().UnixMilli(),
		ActivationOrder:    1,
	}
	raw, err := json.Marshal(active)
	if err != nil {
		t.Fatal(err)
	}
	if err := client.Set(ctx, fenceKey, raw, 0).Err(); err != nil {
		t.Fatal(err)
	}
	manager := &WhatsAppManager{
		cfg: Config{
			WorkerID:                    workerID,
			RuntimeGeneration:           7,
			RuntimeEffectLeaseTTL:       60 * time.Millisecond,
			RuntimeEffectLeaseHeartbeat: 10 * time.Millisecond,
		},
		redis:                  client,
		inboundConnectionScope: &active,
	}
	lease, err := manager.acquireActiveRuntimeEffectLease(ctx)
	if err != nil || lease == nil {
		t.Fatalf("acquire runtime effect lease lease=%v err=%v", lease, err)
	}

	// Simulate a hard process death: stop heartbeats without executing the
	// owner-token release script.
	lease.stopOnce.Do(func() { close(lease.stop) })
	select {
	case <-lease.done:
	case <-ctx.Done():
		t.Fatal("effect lease heartbeat did not stop")
	}

	replacement := active
	replacement.ConnectionEpoch = "replacement-" + uuid.NewString()
	replacement.ConnectionSequence = 0
	replacement.ActivationOrder = 2
	replacement.ActivatedAt++
	replacement.State = "activating"
	replacementManager := &WhatsAppManager{
		cfg:   Config{WorkerID: workerID, RuntimeGeneration: 7},
		redis: client,
	}
	firstAttempt, err := replacementManager.beginRuntimeFenceActivation(ctx, replacement)
	if err != nil {
		t.Fatal(err)
	}
	if firstAttempt.Status != "draining" {
		t.Fatalf("live orphan was not fenced before expiry: %#v", firstAttempt)
	}

	time.Sleep(90 * time.Millisecond)
	recovered, err := replacementManager.beginRuntimeFenceActivation(ctx, replacement)
	if err != nil {
		t.Fatal(err)
	}
	if recovered.Status != "acquired" || recovered.ActiveEffectLeases != 0 {
		t.Fatalf("replacement did not recover after orphan TTL: %#v", recovered)
	}
}

func TestObsoleteSpoolDeleteIsAtomicWithRuntimeFenceReplacement(t *testing.T) {
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

	workerID := "spool-fence-" + uuid.NewString()
	oldScope := whatsAppRuntimeFence{
		State:              "active",
		WorkerID:           workerID,
		RuntimeGeneration:  7,
		ConnectionEpoch:    "old-" + uuid.NewString(),
		ConnectionSequence: 1,
		SourceProvider:     "whatsmeow",
		ActivatedAt:        time.Now().UnixMilli(),
		ActivationOrder:    1,
	}
	replacementScope := oldScope
	replacementScope.RuntimeGeneration = 8
	replacementScope.ConnectionEpoch = "winner-" + uuid.NewString()
	replacementScope.ConnectionSequence = 2
	replacementScope.ActivatedAt++
	replacementScope.ActivationOrder = 2

	oldManager := &WhatsAppManager{
		cfg:                    Config{WorkerID: workerID, RuntimeGeneration: oldScope.RuntimeGeneration},
		redis:                  client,
		inboundConnectionScope: &oldScope,
	}
	replacementManager := &WhatsAppManager{
		cfg:                    Config{WorkerID: workerID, RuntimeGeneration: replacementScope.RuntimeGeneration},
		redis:                  client,
		inboundConnectionScope: &replacementScope,
	}
	fenceKey := whatsAppRuntimeFenceKey(workerID)
	replacementSpool := replacementManager.inboundSpoolStreamKey(replacementScope)
	spoolIndex := replacementManager.inboundSpoolIndexKey()
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cleanupCancel()
		_ = client.Del(cleanupCtx, fenceKey, replacementSpool, spoolIndex).Err()
	})

	writeFence := func(scope whatsAppRuntimeFence) {
		t.Helper()
		raw, err := json.Marshal(scope)
		if err != nil {
			t.Fatal(err)
		}
		if err := client.Set(ctx, fenceKey, raw, 0).Err(); err != nil {
			t.Fatal(err)
		}
	}

	writeFence(oldScope)
	if !isKafkaConsumerOwnerScopeCurrent(ctx, oldManager, oldScope) {
		t.Fatal("old runtime was not current before the simulated cleanup race")
	}
	if err := client.Set(ctx, replacementSpool, "winner", 0).Err(); err != nil {
		t.Fatal(err)
	}
	if err := client.SAdd(ctx, spoolIndex, replacementSpool).Err(); err != nil {
		t.Fatal(err)
	}

	// The replacement wins after the old process checked ownership but before
	// it attempts the delete. The Lua CAS must retain the winner's spool.
	writeFence(replacementScope)
	deleteStatus, err := oldManager.discardInboundSpoolKeyIfFenceCurrent(ctx, oldScope, replacementSpool)
	if err != nil {
		t.Fatal(err)
	}
	if deleteStatus != -1 {
		t.Fatal("revoked runtime deleted the replacement provider spool")
	}
	if exists, err := client.Exists(ctx, replacementSpool).Result(); err != nil || exists != 1 {
		t.Fatalf("replacement spool was not retained exists=%d error=%v", exists, err)
	}
	if indexed, err := client.SIsMember(ctx, spoolIndex, replacementSpool).Result(); err != nil || !indexed {
		t.Fatalf("replacement spool index was not retained indexed=%t error=%v", indexed, err)
	}

	deleteStatus, err = replacementManager.discardInboundSpoolKeyIfFenceCurrent(ctx, replacementScope, replacementSpool)
	if err != nil || deleteStatus != 1 {
		t.Fatalf("current runtime could not delete an obsolete key status=%d error=%v", deleteStatus, err)
	}
	if indexed, err := client.SIsMember(ctx, spoolIndex, replacementSpool).Result(); err != nil || indexed {
		t.Fatalf("deleted spool remained indexed indexed=%t error=%v", indexed, err)
	}
	deleteStatus, err = replacementManager.discardInboundSpoolKeyIfFenceCurrent(ctx, replacementScope, replacementSpool)
	if err != nil || deleteStatus != 0 {
		t.Fatalf("already absent key was not distinguished status=%d error=%v", deleteStatus, err)
	}
}

func TestWorkerScopedSpoolIndexCleanupDeletesOnlyAllowlistedObsoleteKeys(t *testing.T) {
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

	workerID := "spool-index-" + uuid.NewString()
	scope := whatsAppRuntimeFence{
		State:              "active",
		WorkerID:           workerID,
		RuntimeGeneration:  7,
		ConnectionEpoch:    "active-" + uuid.NewString(),
		ConnectionSequence: 1,
		SourceProvider:     "whatsmeow",
		ActivatedAt:        time.Now().UnixMilli(),
		ActivationOrder:    1,
	}
	manager := &WhatsAppManager{
		cfg:                    Config{WorkerID: workerID, RuntimeGeneration: 7},
		redis:                  client,
		inboundConnectionScope: &scope,
	}
	fenceKey := whatsAppRuntimeFenceKey(workerID)
	indexKey := manager.inboundSpoolIndexKey()
	obsoleteKey := "inbound:message:wwebjs:" + workerID + ":generation:6:epoch:obsolete:stream"
	corruptKey := "inbound:message:whatsmeow:" + workerID + ":unrelated"
	foreignKey := "inbound:message:whatsmeow:another-worker:generation:7:epoch:foreign:stream"
	cleanupKeys := append(
		[]string{fenceKey, indexKey, obsoleteKey, corruptKey, foreignKey},
		manager.inboundSpoolScopeKeys(scope)...,
	)
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cleanupCancel()
		_ = client.Unlink(cleanupCtx, cleanupKeys...).Err()
	})

	rawFence, err := json.Marshal(scope)
	if err != nil {
		t.Fatal(err)
	}
	if err := client.Set(ctx, fenceKey, rawFence, 0).Err(); err != nil {
		t.Fatal(err)
	}
	if err := client.MSet(
		ctx,
		obsoleteKey, "obsolete",
		corruptKey, "must-survive",
		foreignKey, "must-survive",
	).Err(); err != nil {
		t.Fatal(err)
	}
	if err := client.SAdd(
		ctx,
		indexKey,
		obsoleteKey,
		corruptKey,
		foreignKey,
	).Err(); err != nil {
		t.Fatal(err)
	}

	manager.discardObsoleteInboundSpools(ctx, scope)

	if exists, err := client.Exists(ctx, obsoleteKey).Result(); err != nil || exists != 0 {
		t.Fatalf("allowlisted obsolete spool survived exists=%d error=%v", exists, err)
	}
	for _, key := range []string{corruptKey, foreignKey} {
		if exists, err := client.Exists(ctx, key).Result(); err != nil || exists != 1 {
			t.Fatalf("non-allowlisted key was deleted key=%s exists=%d error=%v", key, exists, err)
		}
		if indexed, err := client.SIsMember(ctx, indexKey, key).Result(); err != nil || indexed {
			t.Fatalf("invalid member remained in spool index key=%s indexed=%t error=%v", key, indexed, err)
		}
	}
	for _, key := range manager.inboundSpoolScopeKeys(scope) {
		if indexed, err := client.SIsMember(ctx, indexKey, key).Result(); err != nil || !indexed {
			t.Fatalf("active scope key was not retained key=%s indexed=%t error=%v", key, indexed, err)
		}
	}
}

func TestObsoleteInboundRetryIsRehomedIntoActiveEpoch(t *testing.T) {
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

	workerID := "spool-rehome-" + uuid.NewString()
	active := whatsAppRuntimeFence{
		State:              "active",
		WorkerID:           workerID,
		RuntimeGeneration:  8,
		ConnectionEpoch:    "epoch-b-" + uuid.NewString(),
		ConnectionSequence: 2,
		SourceProvider:     "whatsmeow",
		ActivatedAt:        time.Now().UnixMilli(),
		ActivationOrder:    2,
	}
	manager := &WhatsAppManager{
		cfg:                    Config{WorkerID: workerID, RuntimeGeneration: active.RuntimeGeneration},
		redis:                  client,
		inboundConnectionScope: &active,
	}
	fenceKey := whatsAppRuntimeFenceKey(workerID)
	indexKey := manager.inboundSpoolIndexKey()
	oldPrefix := "inbound:message:whatsmeow:" + workerID + ":generation:7:epoch:epoch-a"
	oldRetryKey := oldPrefix + ":retry"
	oldPayloadHashKey := oldPrefix + ":retry-payloads"
	cleanupKeys := append(
		[]string{fenceKey, indexKey, oldRetryKey, oldPayloadHashKey},
		manager.inboundSpoolScopeKeys(active)...,
	)
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cleanupCancel()
		_ = client.Unlink(cleanupCtx, cleanupKeys...).Err()
	})

	rawFence, err := json.Marshal(active)
	if err != nil {
		t.Fatal(err)
	}
	if err := client.Set(ctx, fenceKey, rawFence, 0).Err(); err != nil {
		t.Fatal(err)
	}
	member := "whatsmeow:" + workerID + ":7:epoch-a:waevt_v1_stable"
	oldPayload := map[string]any{
		"provider":           "whatsmeow",
		"source_provider":    "whatsmeow",
		"account_id":         "account-1",
		"worker_id":          workerID,
		"runtime_generation": "7",
		"connection_epoch":   "epoch-a",
		"event_source":       "incoming_message",
		"dedupe_key":         "waevt_v1_stable",
		"kafka_topic":        topicUpsertMessage,
		"kafka_key":          "chat-1",
		"upsert": map[string]any{
			"event_id":           "waevt_v1_stable",
			"worker_id":          workerID,
			"account_id":         "account-1",
			"source_provider":    "whatsmeow",
			"runtime_generation": "7",
			"connection_epoch":   "epoch-a",
			"type":               MessageTypeText,
			"message": map[string]any{
				"key":              map[string]any{"id": "message-1", "remoteJid": "5511999999999@s.whatsapp.net"},
				"messageTimestamp": time.Now().Unix(),
			},
		},
		"received_at":     time.Now().UTC().Format(time.RFC3339Nano),
		"attempts":        4,
		"next_attempt_at": time.Now().Add(time.Hour).UnixMilli(),
		"last_error":      "kafka unavailable",
	}
	rawPayload, err := json.Marshal(oldPayload)
	if err != nil {
		t.Fatal(err)
	}
	if err := client.HSet(ctx, oldPayloadHashKey, member, rawPayload).Err(); err != nil {
		t.Fatal(err)
	}
	invalidMember := "invalid:" + workerID
	if err := client.HSet(ctx, oldPayloadHashKey, invalidMember, `{"provider":"whatsmeow","worker_id":"`+workerID+`"}`).Err(); err != nil {
		t.Fatal(err)
	}
	if err := client.ZAdd(
		ctx,
		oldRetryKey,
		redis.Z{Score: float64(time.Now().Add(time.Hour).UnixMilli()), Member: member},
		redis.Z{Score: float64(time.Now().Add(time.Hour).UnixMilli()), Member: invalidMember},
	).Err(); err != nil {
		t.Fatal(err)
	}
	if err := client.SAdd(ctx, indexKey, oldRetryKey, oldPayloadHashKey).Err(); err != nil {
		t.Fatal(err)
	}

	manager.discardObsoleteInboundSpools(ctx, active)

	activeStream := manager.inboundSpoolStreamKey(active)
	entries, err := client.XRange(ctx, activeStream, "-", "+").Result()
	if err != nil {
		t.Fatalf("read active spool: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("active stream entries = %d, want exactly 1 valid retry", len(entries))
	}
	rehomedRaw, ok := inboundSpoolRawPayload(entries[0].Values["payload"])
	if !ok {
		t.Fatalf("rehomed stream payload has invalid Redis type: %#v", entries[0].Values["payload"])
	}
	var rehomed InboundMessageSpoolPayload
	if err := json.Unmarshal([]byte(rehomedRaw), &rehomed); err != nil {
		t.Fatalf("decode rehomed payload: %v", err)
	}
	if rehomed.RuntimeGeneration != active.RuntimeGeneration ||
		rehomed.ConnectionEpoch != active.ConnectionEpoch ||
		rehomed.Upsert == nil ||
		rehomed.Upsert.RuntimeGeneration != active.RuntimeGeneration ||
		rehomed.Upsert.ConnectionEpoch != active.ConnectionEpoch {
		t.Fatalf("rehomed payload retained obsolete fence: %+v", rehomed)
	}
	if rehomed.Attempts != 0 || rehomed.NextAttemptAt != 0 || rehomed.LastError != "" {
		t.Fatalf("rehomed payload retained obsolete retry state: %+v", rehomed)
	}
	if rehomed.DedupeKey != "waevt_v1_stable" || rehomed.Upsert.EventID != "waevt_v1_stable" {
		t.Fatalf("rehomed payload changed stable identity: %+v", rehomed)
	}
	if exists, err := client.Exists(ctx, oldRetryKey, oldPayloadHashKey).Result(); err != nil || exists != 0 {
		t.Fatalf("obsolete retry ledger survived exists=%d error=%v", exists, err)
	}
	for _, key := range []string{oldRetryKey, oldPayloadHashKey} {
		if indexed, err := client.SIsMember(ctx, indexKey, key).Result(); err != nil || indexed {
			t.Fatalf("obsolete retry key remained indexed key=%s indexed=%t error=%v", key, indexed, err)
		}
	}
}

func TestLegacyProviderParkingIsRescuedWithoutRetainingInvalidRecords(t *testing.T) {
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

	workerID := "parking-rehome-" + uuid.NewString()
	active := whatsAppRuntimeFence{
		State:              "active",
		WorkerID:           workerID,
		RuntimeGeneration:  8,
		ConnectionEpoch:    "epoch-active-" + uuid.NewString(),
		ConnectionSequence: 2,
		SourceProvider:     "whatsmeow",
		ActivatedAt:        time.Now().UnixMilli(),
		ActivationOrder:    2,
	}
	manager := &WhatsAppManager{
		cfg:                    Config{WorkerID: workerID, RuntimeGeneration: active.RuntimeGeneration},
		redis:                  client,
		inboundConnectionScope: &active,
	}
	fenceKey := whatsAppRuntimeFenceKey(workerID)
	indexKey := manager.inboundSpoolIndexKey()
	parkingKey := manager.inboundSpoolParkingSetKey(active)
	payloadHashKey := manager.inboundSpoolPayloadHashKey(active)
	cleanupKeys := append(
		[]string{fenceKey, indexKey},
		manager.inboundSpoolScopeKeys(active)...,
	)
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cleanupCancel()
		_ = client.Unlink(cleanupCtx, cleanupKeys...).Err()
	})

	rawFence, err := json.Marshal(active)
	if err != nil {
		t.Fatal(err)
	}
	if err := client.Set(ctx, fenceKey, rawFence, 0).Err(); err != nil {
		t.Fatal(err)
	}
	validParking, err := json.Marshal(inboundMessageParkingPayload{
		Provider:    "whatsmeow",
		AccountID:   "account-1",
		WorkerID:    workerID,
		EventSource: "incoming_message",
		Reason:      "retry_exhausted",
		Stage:       "whatsmeow.inbound_spool.publish",
		ParkedAt:    time.Now().UTC().Format(time.RFC3339Nano),
		KafkaTopic:  topicUpsertMessage,
		KafkaKey:    "chat-1",
		RetryCount:  12,
		Upsert: &UpsertMessage{
			EventID:           "waevt_v1_legacy_parking",
			AccountID:         "account-1",
			WorkerID:          workerID,
			SourceProvider:    "whatsmeow",
			RuntimeGeneration: active.RuntimeGeneration,
			ConnectionEpoch:   active.ConnectionEpoch,
			Type:              MessageTypeText,
			Message: map[string]any{
				"key": map[string]any{
					"id":        "message-1",
					"remoteJid": "5511999999999@s.whatsapp.net",
				},
			},
		},
		RawMeta: map[string]any{"event_id": "waevt_v1_legacy_parking", "chat": "chat-1"},
	})
	if err != nil {
		t.Fatal(err)
	}
	validMember := "whatsmeow:" + workerID + ":chat-1"
	invalidMember := "invalid:" + workerID
	if err := client.HSet(
		ctx,
		payloadHashKey,
		validMember,
		validParking,
		invalidMember,
		`{"provider":"whatsmeow","worker_id":"`+workerID+`","reason":"retry_exhausted"}`,
	).Err(); err != nil {
		t.Fatal(err)
	}
	if err := client.ZAdd(
		ctx,
		parkingKey,
		redis.Z{Score: float64(time.Now().UnixMilli()), Member: validMember},
		redis.Z{Score: float64(time.Now().UnixMilli()), Member: invalidMember},
	).Err(); err != nil {
		t.Fatal(err)
	}
	if err := client.SAdd(ctx, indexKey, parkingKey, payloadHashKey).Err(); err != nil {
		t.Fatal(err)
	}

	manager.discardObsoleteInboundSpools(ctx, active)

	entries, err := client.XRange(ctx, manager.inboundSpoolStreamKey(active), "-", "+").Result()
	if err != nil {
		t.Fatalf("read rescued provider parking: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("rescued stream entries = %d, want exactly 1 valid record", len(entries))
	}
	raw, ok := inboundSpoolRawPayload(entries[0].Values["payload"])
	if !ok {
		t.Fatalf("rescued parking payload has invalid Redis type: %#v", entries[0].Values["payload"])
	}
	var rescued InboundMessageSpoolPayload
	if err := json.Unmarshal([]byte(raw), &rescued); err != nil {
		t.Fatalf("decode rescued parking payload: %v", err)
	}
	if rescued.DedupeKey != "waevt_v1_legacy_parking" ||
		rescued.RuntimeGeneration != active.RuntimeGeneration ||
		rescued.ConnectionEpoch != active.ConnectionEpoch {
		t.Fatalf("rescued provider parking identity/fence changed: %+v", rescued)
	}
	if exists, err := client.Exists(ctx, parkingKey, payloadHashKey).Result(); err != nil || exists != 0 {
		t.Fatalf("legacy provider parking survived rescue/discard exists=%d error=%v", exists, err)
	}
}

func TestInboundSpoolRetriesBeyondFormerLimitAndThenPublishesOnce(t *testing.T) {
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

	workerID := "retry-forever-" + uuid.NewString()
	scope := whatsAppRuntimeFence{
		State:              "active",
		WorkerID:           workerID,
		RuntimeGeneration:  8,
		ConnectionEpoch:    "epoch-" + uuid.NewString(),
		ConnectionSequence: 1,
		SourceProvider:     "whatsmeow",
		ActivatedAt:        time.Now().UnixMilli(),
		ActivationOrder:    1,
	}
	manager := &WhatsAppManager{
		cfg:                    Config{WorkerID: workerID, RuntimeGeneration: scope.RuntimeGeneration},
		redis:                  client,
		inboundConnectionScope: &scope,
	}
	fenceKey := whatsAppRuntimeFenceKey(workerID)
	cleanupKeys := append(
		[]string{fenceKey, manager.inboundSpoolIndexKey()},
		manager.inboundSpoolScopeKeys(scope)...,
	)
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cleanupCancel()
		_ = client.Unlink(cleanupCtx, cleanupKeys...).Err()
	})

	rawFence, err := json.Marshal(scope)
	if err != nil {
		t.Fatal(err)
	}
	if err := client.Set(ctx, fenceKey, rawFence, 0).Err(); err != nil {
		t.Fatal(err)
	}
	payload := InboundMessageSpoolPayload{
		Provider:          "whatsmeow",
		SourceProvider:    "whatsmeow",
		AccountID:         "account-1",
		WorkerID:          workerID,
		RuntimeGeneration: scope.RuntimeGeneration,
		ConnectionEpoch:   scope.ConnectionEpoch,
		EventSource:       "incoming_message",
		DedupeKey:         "waevt_v1_retry_forever",
		KafkaTopic:        topicUpsertMessage,
		KafkaKey:          "chat-1",
		Upsert: &UpsertMessage{
			EventID:           "waevt_v1_retry_forever",
			AccountID:         "account-1",
			WorkerID:          workerID,
			SourceProvider:    "whatsmeow",
			RuntimeGeneration: scope.RuntimeGeneration,
			ConnectionEpoch:   scope.ConnectionEpoch,
			Type:              MessageTypeText,
			Message: map[string]any{
				"key": map[string]any{
					"id":        "message-1",
					"remoteJid": "5511999999999@s.whatsapp.net",
				},
			},
		},
		RawMeta:    map[string]any{"event_id": "waevt_v1_retry_forever", "chat": "chat-1"},
		ReceivedAt: time.Now().UTC().Format(time.RFC3339Nano),
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	streamKey := manager.inboundSpoolStreamKey(scope)
	if err := client.XAdd(ctx, &redis.XAddArgs{
		Stream: streamKey,
		Values: map[string]any{"payload": string(raw)},
	}).Err(); err != nil {
		t.Fatal(err)
	}

	publishAttempts := 0
	successfulPublishes := 0
	for failure := 1; failure <= 13; failure++ {
		entries, err := client.XRange(ctx, streamKey, "-", "+").Result()
		if err != nil || len(entries) != 1 {
			t.Fatalf("read retry stream failure=%d entries=%d error=%v", failure, len(entries), err)
		}
		currentRaw, ok := inboundSpoolRawPayload(entries[0].Values["payload"])
		if !ok {
			t.Fatalf("retry payload has invalid Redis type: %#v", entries[0].Values["payload"])
		}
		var current InboundMessageSpoolPayload
		if err := json.Unmarshal([]byte(currentRaw), &current); err != nil {
			t.Fatal(err)
		}
		publishAttempts++
		manager.deferInboundSpoolPayload(
			ctx,
			scope,
			streamKey,
			entries[0].ID,
			currentRaw,
			current,
			errors.New("Kafka unavailable"),
		)
		if streamLength := client.XLen(ctx, streamKey).Val(); streamLength != 0 {
			t.Fatalf("failed retry remained in live stream failure=%d length=%d", failure, streamLength)
		}
		if retryCount := client.ZCard(ctx, manager.inboundSpoolRetrySetKey(scope)).Val(); retryCount != 1 {
			t.Fatalf("durable retry count failure=%d got=%d", failure, retryCount)
		}
		// Advance the shared Redis deadline without sleeping; production waits
		// for the same score naturally.
		if err := client.ZAddArgs(
			ctx,
			manager.inboundSpoolRetrySetKey(scope),
			redis.ZAddArgs{XX: true, Members: []redis.Z{{Score: 0, Member: "whatsmeow:" + workerID + ":8:" + scope.ConnectionEpoch + ":waevt_v1_retry_forever"}}},
		).Err(); err != nil {
			t.Fatal(err)
		}
		promoted, err := manager.promoteDueInboundSpoolRetries(ctx, scope)
		if err != nil || promoted != 1 {
			t.Fatalf("promote retry failure=%d promoted=%d error=%v", failure, promoted, err)
		}
	}

	entries, err := client.XRange(ctx, streamKey, "-", "+").Result()
	if err != nil || len(entries) != 1 {
		t.Fatalf("read final retry entries=%d error=%v", len(entries), err)
	}
	finalRaw, ok := inboundSpoolRawPayload(entries[0].Values["payload"])
	if !ok {
		t.Fatalf("final retry payload has invalid Redis type: %#v", entries[0].Values["payload"])
	}
	var finalPayload InboundMessageSpoolPayload
	if err := json.Unmarshal([]byte(finalRaw), &finalPayload); err != nil {
		t.Fatal(err)
	}
	if finalPayload.Attempts != 13 || finalPayload.NextAttemptAt != 0 {
		t.Fatalf("retry state after 13 failures = %+v", finalPayload)
	}
	publishAttempts++
	successfulPublishes++
	if err := client.XDel(ctx, streamKey, entries[0].ID).Err(); err != nil {
		t.Fatal(err)
	}
	if publishAttempts != 14 || successfulPublishes != 1 {
		t.Fatalf("publish attempts=%d successes=%d, want 14/1", publishAttempts, successfulPublishes)
	}
	if retryCount := client.ZCard(ctx, manager.inboundSpoolRetrySetKey(scope)).Val(); retryCount != 0 {
		t.Fatalf("retry ledger retained %d members after success", retryCount)
	}
	if parked := client.ZCard(ctx, manager.inboundSpoolParkingSetKey(scope)).Val(); parked != 0 {
		t.Fatalf("valid retry was terminally parked count=%d", parked)
	}

	orphanPayload := finalPayload
	orphanPayload.DedupeKey = "waevt_v1_orphan_retry"
	orphanPayload.Upsert = &UpsertMessage{}
	*orphanPayload.Upsert = *finalPayload.Upsert
	orphanPayload.Upsert.EventID = orphanPayload.DedupeKey
	orphanRaw, err := json.Marshal(orphanPayload)
	if err != nil {
		t.Fatal(err)
	}
	retryKey := manager.inboundSpoolRetrySetKey(scope)
	retryPayloadKey := manager.inboundSpoolRetryPayloadHashKey(scope)
	const futureRetryCount = 512
	futureMembers := make([]string, 0, futureRetryCount)
	_, err = client.TxPipelined(ctx, func(pipe redis.Pipeliner) error {
		for index := 0; index < futureRetryCount; index++ {
			member := fmt.Sprintf("future:%04d:%s", index, workerID)
			futureMembers = append(futureMembers, member)
			pipe.HSet(ctx, retryPayloadKey, member, orphanRaw)
			pipe.ZAdd(ctx, retryKey, redis.Z{
				Score:  float64(time.Now().Add(time.Hour).UnixMilli()),
				Member: member,
			})
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}

	firstPage, firstCursor, err := client.HScan(
		ctx,
		retryPayloadKey,
		0,
		"*",
		whatsmeowInboundSpoolBatchSize,
	).Result()
	if err != nil {
		t.Fatal(err)
	}
	if firstCursor == 0 {
		t.Skip("Redis returned the complete retry hash in one HSCAN page")
	}
	firstPageMembers := make(map[string]struct{}, len(firstPage)/2)
	for index := 0; index+1 < len(firstPage); index += 2 {
		firstPageMembers[firstPage[index]] = struct{}{}
	}
	orphanMember := ""
	for _, member := range futureMembers {
		if _, onFirstPage := firstPageMembers[member]; !onFirstPage {
			orphanMember = member
			break
		}
	}
	if orphanMember == "" {
		t.Fatal("failed to select an orphan outside the first HSCAN page")
	}
	if err := client.ZRem(ctx, retryKey, orphanMember).Err(); err != nil {
		t.Fatal(err)
	}

	totalPromoted := 0
	for pass := 0; pass < 64 && totalPromoted == 0; pass++ {
		promoted, promoteErr := manager.promoteDueInboundSpoolRetries(ctx, scope)
		if promoteErr != nil {
			t.Fatalf("orphan retry promotion pass=%d error=%v", pass, promoteErr)
		}
		totalPromoted += promoted
	}
	if totalPromoted != 1 {
		t.Fatalf("orphan outside first HSCAN page was not recovered promoted=%d", totalPromoted)
	}
	orphanEntries, err := client.XRange(ctx, streamKey, "-", "+").Result()
	if err != nil || len(orphanEntries) != 1 {
		t.Fatalf("orphan retry stream entries=%d error=%v", len(orphanEntries), err)
	}
	orphanStreamRaw, ok := inboundSpoolRawPayload(orphanEntries[0].Values["payload"])
	if !ok {
		t.Fatalf("orphan retry payload has invalid Redis type: %#v", orphanEntries[0].Values["payload"])
	}
	var recoveredOrphan InboundMessageSpoolPayload
	if err := json.Unmarshal([]byte(orphanStreamRaw), &recoveredOrphan); err != nil {
		t.Fatal(err)
	}
	if recoveredOrphan.DedupeKey != "waevt_v1_orphan_retry" {
		t.Fatalf("orphan retry identity changed: %+v", recoveredOrphan)
	}
}

func TestRuntimeFenceActivationIsFailClosedAndLatestPendingWins(t *testing.T) {
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

	workerID := "runtime-sequence-" + uuid.NewString()
	fenceKey := whatsAppRuntimeFenceKey(workerID)
	lockKey := whatsAppRuntimeFenceActivationLockKey(workerID)
	ordersKey := whatsAppRuntimeFenceActivationOrdersKey(workerID, 7)
	leasesKey := whatsAppRuntimeEffectLeasesKey(workerID)
	ownersKey := whatsAppRuntimeEffectLeaseOwnersKey(workerID)
	t.Cleanup(func() {
		_ = client.Del(context.Background(), fenceKey, lockKey, ordersKey, leasesKey, ownersKey).Err()
	})

	begin := func(epoch string) []any {
		t.Helper()
		result, err := client.Eval(
			ctx,
			beginWhatsAppRuntimeFenceActivationScript,
			[]string{fenceKey, lockKey, ordersKey, leasesKey, ownersKey},
			7,
			epoch,
			"whatsmeow",
			workerID,
			whatsAppRuntimeFenceActivationLockTTL.Milliseconds(),
			int64(whatsAppRuntimeFenceActivationOrdersTTL/time.Second),
		).Slice()
		if err != nil {
			t.Fatal(err)
		}
		return result
	}
	resultCode := func(result []any) int64 {
		t.Helper()
		code, ok := runtimeFenceResultInt64(result[0])
		if !ok {
			t.Fatalf("invalid result code %#v", result)
		}
		return code
	}
	resultOrder := func(result []any) int64 {
		t.Helper()
		order, ok := runtimeFenceResultInt64(result[1])
		if !ok {
			t.Fatalf("invalid activation order %#v", result)
		}
		return order
	}
	finalize := func(epoch string, order, sequence int64) int {
		t.Helper()
		result, err := client.Eval(
			ctx,
			finalizeWhatsAppRuntimeFenceActivationScript,
			[]string{fenceKey, lockKey, leasesKey, ownersKey},
			7,
			epoch,
			"whatsmeow",
			order,
			sequence,
		).Int()
		if err != nil {
			t.Fatal(err)
		}
		return result
	}

	epochA := "a-" + uuid.NewString()
	epochB := "b-" + uuid.NewString()

	beginA := begin(epochA)
	if code := resultCode(beginA); code != 1 {
		t.Fatalf("begin A code = %d, want acquired", code)
	}
	orderA := resultOrder(beginA)
	if ttl := client.TTL(ctx, ordersKey).Val(); ttl <= 29*24*time.Hour || ttl > whatsAppRuntimeFenceActivationOrdersTTL {
		t.Fatalf("activation-orders TTL = %s, want approximately %s", ttl, whatsAppRuntimeFenceActivationOrdersTTL)
	}
	pendingRaw, err := client.Get(ctx, fenceKey).Bytes()
	if err != nil {
		t.Fatal(err)
	}
	var pending whatsAppRuntimeFence
	if err := json.Unmarshal(pendingRaw, &pending); err != nil {
		t.Fatal(err)
	}
	if pending.State != "activating" || pending.ConnectionSequence != 0 {
		t.Fatalf("begin did not fail closed: %#v", pending)
	}

	beginB := begin(epochB)
	if code := resultCode(beginB); code != 2 {
		t.Fatalf("begin B code = %d, want waiting", code)
	}
	orderB := resultOrder(beginB)
	if orderB <= orderA {
		t.Fatalf("activation orders are not monotonic: A=%d B=%d", orderA, orderB)
	}

	if result := finalize(epochA, orderA, 1); result != 0 {
		t.Fatalf("superseded A finalized with result %d", result)
	}
	if code := resultCode(begin(epochA)); code != 3 {
		t.Fatalf("A retry code = %d, want superseded", code)
	}
	if code := resultCode(begin(epochB)); code != 1 {
		t.Fatalf("B retry code = %d, want acquired", code)
	}
	if result := finalize(epochB, orderB, 2); result != 1 {
		t.Fatalf("B finalize result = %d, want active", result)
	}
	if result := finalize(epochA, orderA, 1); result != 0 {
		t.Fatalf("delayed A finalization result = %d, want rejected", result)
	}

	raw, err := client.Get(ctx, fenceKey).Bytes()
	if err != nil {
		t.Fatal(err)
	}
	var active whatsAppRuntimeFence
	if err := json.Unmarshal(raw, &active); err != nil {
		t.Fatal(err)
	}
	if active.State != "active" ||
		active.ConnectionEpoch != epochB ||
		active.ConnectionSequence != 2 ||
		active.ActivationOrder != orderB {
		t.Fatalf("persisted runtime fence = %#v, want active B", active)
	}
	if code := resultCode(begin(epochB)); code != 4 {
		t.Fatalf("idempotent B begin code = %d, want already active", code)
	}

	manager := &WhatsAppManager{
		cfg:   Config{WorkerID: workerID, RuntimeGeneration: 7},
		redis: client,
	}
	lease, err := manager.acquireRuntimeEffectLease(ctx, active)
	if err != nil {
		t.Fatalf("acquire runtime effect lease: %v", err)
	}
	if lease == nil {
		t.Fatal("active runtime did not acquire an effect lease")
	}

	if err := client.Del(ctx, ordersKey).Err(); err != nil {
		t.Fatal(err)
	}
	epochC := "c-" + uuid.NewString()
	drainingC := begin(epochC)
	if code := resultCode(drainingC); code != 5 {
		t.Fatalf("begin C with active effects code = %d, want draining", code)
	}
	if result := finalize(epochC, resultOrder(drainingC), 3); result != 0 {
		t.Fatalf("C finalized before prior effects drained with result %d", result)
	}
	if staleLease, staleErr := manager.acquireRuntimeEffectLease(ctx, active); staleErr != nil || staleLease != nil {
		t.Fatalf("revoked runtime acquired a new effect lease lease=%v error=%v", staleLease, staleErr)
	}
	releaseCtx, releaseCancel := context.WithTimeout(context.Background(), 5*time.Second)
	released, releaseErr := lease.release(releaseCtx)
	releaseCancel()
	if releaseErr != nil || !released {
		t.Fatalf("release runtime effect lease released=%t error=%v", released, releaseErr)
	}

	beginC := begin(epochC)
	if code := resultCode(beginC); code != 1 {
		t.Fatalf("begin C after order-hash loss code = %d, want acquired", code)
	}
	if resultOrder(beginC) != resultOrder(drainingC) {
		t.Fatalf("draining activation order changed: first=%d retry=%d", resultOrder(drainingC), resultOrder(beginC))
	}
	if orderC := resultOrder(beginC); orderC <= orderB {
		t.Fatalf(
			"order-hash recovery did not advance beyond the active fence: B=%d C=%d",
			orderB,
			orderC,
		)
	}
	raw, err = client.Get(ctx, fenceKey).Bytes()
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, &pending); err != nil {
		t.Fatal(err)
	}
	if pending.State != "activating" ||
		pending.ConnectionEpoch != epochC ||
		pending.ConnectionSequence != 0 {
		t.Fatalf("unfinished C activation did not remain fail closed: %#v", pending)
	}
}
