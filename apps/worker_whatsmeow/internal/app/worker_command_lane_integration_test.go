package app

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

func TestWorkerCommandLaneRedisOrderingAndIdentity(t *testing.T) {
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

	issuedAt := time.Now().UTC().Truncate(time.Millisecond)
	first := WorkerCommandEnvelopeV1{
		CommandID:      uuid.NewString(),
		OperationID:    "message-1",
		AccountID:      "account-1",
		WorkerID:       "worker-1",
		EntityKey:      "chat:account-1:worker-1:chat-1",
		EntitySequence: 1,
		OriginEpoch:    "018f47cc-6a4c-7a4a-8b2c-87fd93c87a11",
		PayloadDigest:  "ea4529441c11c15cb44c9597af9944d10b459a8718a901cf5c7cfb1e15c89874",
		CommandType:    WorkerCommandTypeDirectSend,
		IssuedAt:       workerCommandTimestamp(issuedAt),
	}
	key := workerCommandLaneKey(first)
	t.Cleanup(func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = client.Del(cleanupCtx, key).Err()
	})
	firstDigest := workerCommandLaneOperationDigest(first.OperationID)
	if err := client.HSet(ctx, key, map[string]any{
		"sequence":                                 1,
		"last_operation_id":                        first.OperationID,
		"last_operation_digest":                    firstDigest,
		"op:" + firstDigest + ":sequence":          1,
		"op:" + firstDigest + ":operation_id":      first.OperationID,
		"op:" + firstDigest + ":predecessor":       "",
		"op:" + firstDigest + ":issued_at_ms":      issuedAt.UnixMilli(),
		"op:" + firstDigest + ":command_id":        first.CommandID,
		"op:" + firstDigest + ":origin_epoch":      first.OriginEpoch,
		"op:" + firstDigest + ":payload_digest":    first.PayloadDigest,
		"op:" + firstDigest + ":command_type":      first.CommandType,
		"op:" + firstDigest + ":active_until_ms":   issuedAt.Add(-time.Second).UnixMilli(),
		"op:" + firstDigest + ":active_command_id": first.CommandID,
	}).Err(); err != nil {
		t.Fatal(err)
	}
	if err := client.Expire(ctx, key, workerCommandLaneTTL).Err(); err != nil {
		t.Fatal(err)
	}

	worker := &Worker{redis: client}
	disposition, err := worker.claimWorkerCommandLane(ctx, first)
	if err != nil || disposition != workerCommandLaneAcquired {
		t.Fatalf("first lane claim = %q, err=%v", disposition, err)
	}
	if err := worker.completeWorkerCommandLane(ctx, first, sendIdempotencyStateSucceeded); err != nil {
		t.Fatalf("complete first lane: %v", err)
	}
	disposition, err = worker.claimWorkerCommandLane(ctx, first)
	if err != nil || disposition != workerCommandLaneDuplicate {
		t.Fatalf("completed lane replay = %q, err=%v", disposition, err)
	}

	predecessor := first.OperationID
	second := first
	second.CommandID = uuid.NewString()
	second.OperationID = "message-2"
	second.EntitySequence = 2
	second.PredecessorOperationID = &predecessor
	second.IssuedAt = workerCommandTimestamp(issuedAt.Add(time.Millisecond))
	secondDigest := workerCommandLaneOperationDigest(second.OperationID)
	if err := client.HSet(ctx, key, map[string]any{
		"sequence":                               2,
		"last_operation_id":                      second.OperationID,
		"last_operation_digest":                  secondDigest,
		"op:" + secondDigest + ":sequence":       2,
		"op:" + secondDigest + ":operation_id":   second.OperationID,
		"op:" + secondDigest + ":predecessor":    predecessor,
		"op:" + secondDigest + ":issued_at_ms":   issuedAt.Add(time.Millisecond).UnixMilli(),
		"op:" + secondDigest + ":command_id":     second.CommandID,
		"op:" + secondDigest + ":origin_epoch":   second.OriginEpoch,
		"op:" + secondDigest + ":payload_digest": second.PayloadDigest,
		"op:" + secondDigest + ":command_type":   second.CommandType,
	}).Err(); err != nil {
		t.Fatal(err)
	}
	disposition, err = worker.claimWorkerCommandLane(ctx, second)
	if err != nil || disposition != workerCommandLaneAcquired {
		t.Fatalf("successor lane claim = %q, err=%v", disposition, err)
	}
	if retained, retainedErr := client.HGet(ctx, key, "op:"+firstDigest+":operation_id").Result(); retainedErr != nil || retained != first.OperationID {
		t.Fatalf("terminal predecessor identity tombstone was not retained: value=%q err=%v", retained, retainedErr)
	}
	if active, activeErr := client.HExists(ctx, key, "op:"+firstDigest+":active_command_id").Result(); activeErr != nil || active {
		t.Fatalf("terminal predecessor active ownership was not compacted: exists=%v err=%v", active, activeErr)
	}
	if err := worker.releaseWorkerCommandLane(ctx, second); err != nil {
		t.Fatalf("release successor lane: %v", err)
	}
	if err := client.HDel(ctx, key,
		"op:"+firstDigest+":sequence",
		"op:"+firstDigest+":operation_id",
		"op:"+firstDigest+":predecessor",
		"op:"+firstDigest+":issued_at_ms",
		"op:"+firstDigest+":command_id",
		"op:"+firstDigest+":origin_epoch",
		"op:"+firstDigest+":payload_digest",
		"op:"+firstDigest+":command_type",
		"op:"+firstDigest+":terminal",
	).Err(); err != nil {
		t.Fatalf("simulate shared allocator compaction: %v", err)
	}
	if disposition, claimErr := worker.claimWorkerCommandLane(ctx, second); claimErr != nil || disposition != workerCommandLaneAcquired {
		t.Fatalf("compacted predecessor recovery = %q, err=%v", disposition, claimErr)
	}
	if satisfied := client.HGet(ctx, key, "op:"+secondDigest+":predecessor_satisfied").Val(); satisfied != "1" {
		t.Fatalf("compacted predecessor was not persisted as satisfied: %q", satisfied)
	}
	if err := worker.releaseWorkerCommandLane(ctx, second); err != nil {
		t.Fatalf("release recovered successor lane: %v", err)
	}

	allocatedCommandID := second.CommandID
	second.CommandID = uuid.NewString()
	disposition, err = worker.claimWorkerCommandLane(ctx, second)
	if err != nil || disposition != workerCommandLaneStale {
		t.Fatalf("mismatched command identity = %q, err=%v", disposition, err)
	}
	second.CommandID = allocatedCommandID
	second.OriginEpoch = "018f47cc-6a4c-7a4a-8b2c-87fd93c87a12"
	disposition, err = worker.claimWorkerCommandLane(ctx, second)
	if err != nil || disposition != workerCommandLaneStale {
		t.Fatalf("retagged command epoch = %q, err=%v", disposition, err)
	}
	second.OriginEpoch = first.OriginEpoch
	second.PayloadDigest = "ba4529441c11c15cb44c9597af9944d10b459a8718a901cf5c7cfb1e15c89874"
	disposition, err = worker.claimWorkerCommandLane(ctx, second)
	if err != nil || disposition != workerCommandLaneStale {
		t.Fatalf("mutated retry payload digest = %q, err=%v", disposition, err)
	}
	second.PayloadDigest = first.PayloadDigest
	disposition, err = worker.claimWorkerCommandLane(ctx, second)
	if err != nil || disposition != workerCommandLaneAcquired {
		t.Fatalf("canonical retry claim = %q, err=%v", disposition, err)
	}
	if err := worker.completeWorkerCommandLaneWithFailure(ctx, second, sendIdempotencyStateFailed, "failed"); err != nil {
		t.Fatalf("terminalize failed successor: %v", err)
	}
	if code, codeErr := worker.workerCommandLaneFailureCode(ctx, second); codeErr != nil || code != "failed" {
		t.Fatalf("stored terminal failure code = %q, err=%v", code, codeErr)
	}
	disposition, err = worker.claimWorkerCommandLane(ctx, second)
	if err != nil || disposition != workerCommandLaneDuplicate {
		t.Fatalf("failed command replay = %q, err=%v", disposition, err)
	}
}

func TestWorkerCommandBurstWaitDoesNotConsumeRetryOrBlockAnotherChat(t *testing.T) {
	address := os.Getenv("TEST_REDIS_ADDR")
	if address == "" {
		t.Skip("TEST_REDIS_ADDR is not configured")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	client := redis.NewClient(&redis.Options{Addr: address, Password: os.Getenv("TEST_REDIS_PASSWORD")})
	t.Cleanup(func() { _ = client.Close() })
	workerID := "worker-" + uuid.NewString()
	worker := &Worker{redis: client}
	issuedAt := time.Now().UTC().Truncate(time.Millisecond)

	first := WorkerCommandEnvelopeV1{
		CommandID: uuid.NewString(), OperationID: "long-" + uuid.NewString(),
		AccountID: "account-1", WorkerID: workerID,
		EntityKey: "chat:account-1:" + workerID + ":long-" + uuid.NewString(), EntitySequence: 1,
		OriginEpoch: "opaque-epoch-7", PayloadDigest: "ea4529441c11c15cb44c9597af9944d10b459a8718a901cf5c7cfb1e15c89874",
		CommandType: WorkerCommandTypeDirectSend, IssuedAt: workerCommandTimestamp(issuedAt),
	}
	firstDigest := workerCommandLaneOperationDigest(first.OperationID)
	longKey := workerCommandLaneKey(first)
	laneFields := map[string]any{
		"sequence":                        129,
		"op:" + firstDigest + ":sequence": 1, "op:" + firstDigest + ":operation_id": first.OperationID,
		"op:" + firstDigest + ":predecessor": "", "op:" + firstDigest + ":issued_at_ms": issuedAt.UnixMilli(),
		"op:" + firstDigest + ":command_id": first.CommandID, "op:" + firstDigest + ":origin_epoch": first.OriginEpoch,
		"op:" + firstDigest + ":payload_digest": first.PayloadDigest, "op:" + firstDigest + ":command_type": first.CommandType,
	}
	successors := make([]WorkerCommandEnvelopeV1, 0, 128)
	predecessor := first.OperationID
	for index := 2; index <= 129; index++ {
		successor := first
		successor.CommandID = uuid.NewString()
		successor.OperationID = "successor-" + uuid.NewString()
		successor.EntitySequence = uint64(index)
		successor.PredecessorOperationID = stringPointer(predecessor)
		successor.IssuedAt = workerCommandTimestamp(issuedAt.Add(time.Duration(index-1) * time.Millisecond))
		digest := workerCommandLaneOperationDigest(successor.OperationID)
		laneFields["op:"+digest+":sequence"] = index
		laneFields["op:"+digest+":operation_id"] = successor.OperationID
		laneFields["op:"+digest+":predecessor"] = predecessor
		laneFields["op:"+digest+":issued_at_ms"] = issuedAt.Add(time.Duration(index-1) * time.Millisecond).UnixMilli()
		laneFields["op:"+digest+":command_id"] = successor.CommandID
		laneFields["op:"+digest+":origin_epoch"] = successor.OriginEpoch
		laneFields["op:"+digest+":payload_digest"] = successor.PayloadDigest
		laneFields["op:"+digest+":command_type"] = successor.CommandType
		predecessor = successor.OperationID
		successors = append(successors, successor)
	}
	laneFields["last_operation_id"] = successors[len(successors)-1].OperationID
	laneFields["last_operation_digest"] = workerCommandLaneOperationDigest(successors[len(successors)-1].OperationID)
	if err := client.HSet(ctx, longKey, laneFields).Err(); err != nil {
		t.Fatal(err)
	}
	if disposition, err := worker.claimWorkerCommandLane(ctx, first); err != nil || disposition != workerCommandLaneAcquired {
		t.Fatalf("claim long command = %q, err=%v", disposition, err)
	}
	for index, successor := range successors {
		want := workerCommandLaneDeferred
		if index == 0 {
			want = workerCommandLaneBusy
		}
		if disposition, err := worker.claimWorkerCommandLane(ctx, successor); err != nil || disposition != want {
			t.Fatalf("successor %d disposition = %q, want %q, err=%v", index, disposition, want, err)
		}
		digest := workerCommandLaneOperationDigest(successor.OperationID)
		if retries := client.HGet(ctx, longKey, "op:"+digest+":technical_retry_count").Val(); retries != "" {
			t.Fatalf("lane wait consumed technical retry for successor %d: %q", index, retries)
		}
	}

	other := first
	other.CommandID = uuid.NewString()
	other.OperationID = "other-chat-" + uuid.NewString()
	other.EntityKey = "chat:account-1:" + workerID + ":other-" + uuid.NewString()
	otherDigest := workerCommandLaneOperationDigest(other.OperationID)
	otherKey := workerCommandLaneKey(other)
	if err := client.HSet(ctx, otherKey, map[string]any{
		"sequence": 1, "last_operation_id": other.OperationID, "last_operation_digest": otherDigest,
		"op:" + otherDigest + ":sequence": 1, "op:" + otherDigest + ":operation_id": other.OperationID,
		"op:" + otherDigest + ":predecessor": "", "op:" + otherDigest + ":issued_at_ms": issuedAt.UnixMilli(),
		"op:" + otherDigest + ":command_id": other.CommandID, "op:" + otherDigest + ":origin_epoch": other.OriginEpoch,
		"op:" + otherDigest + ":payload_digest": other.PayloadDigest, "op:" + otherDigest + ":command_type": other.CommandType,
	}).Err(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = client.Del(context.Background(), longKey, otherKey).Err() })
	otherStarted := time.Now()
	if disposition, err := worker.claimWorkerCommandLane(ctx, other); err != nil || disposition != workerCommandLaneAcquired {
		t.Fatalf("other chat claim = %q, err=%v", disposition, err)
	}
	if elapsed := time.Since(otherStarted); elapsed > 500*time.Millisecond {
		t.Fatalf("other chat was delayed by long chat for %s", elapsed)
	}
	// N failed before invoking the provider. Release plus the durable technical
	// retry counter models the ingress retry path; no process-local sequencer can
	// leave N behind the 128 already-delivered successors.
	if err := worker.releaseWorkerCommandLane(ctx, first); err != nil {
		t.Fatal(err)
	}
	if count, err := worker.recordWorkerCommandTechnicalRetry(ctx, first); err != nil || count != 1 {
		t.Fatalf("predecessor technical retry count = %d, err=%v", count, err)
	}
	if disposition, claimErr := worker.claimWorkerCommandLane(ctx, first); claimErr != nil || disposition != workerCommandLaneAcquired {
		t.Fatalf("predecessor retry was blocked by delivered successors: disposition=%q err=%v", disposition, claimErr)
	}
}

func TestWorkerCommandLaneExpiresOnlyNeverActiveOrphan(t *testing.T) {
	address := os.Getenv("TEST_REDIS_ADDR")
	if address == "" {
		t.Skip("TEST_REDIS_ADDR is not configured")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	client := redis.NewClient(&redis.Options{Addr: address, Password: os.Getenv("TEST_REDIS_PASSWORD")})
	t.Cleanup(func() { _ = client.Close() })
	worker := &Worker{redis: client}
	issuedAt := time.Now().UTC().Add(-workerCommandDeadline - time.Second).Truncate(time.Millisecond)
	predecessor := WorkerCommandEnvelopeV1{
		CommandID: uuid.NewString(), OperationID: "orphan-" + uuid.NewString(), AccountID: "account-1", WorkerID: "worker-1",
		EntityKey: "chat:account-1:worker-1:orphan-" + uuid.NewString(), EntitySequence: 1, OriginEpoch: "opaque-epoch-7",
		PayloadDigest: "ea4529441c11c15cb44c9597af9944d10b459a8718a901cf5c7cfb1e15c89874", CommandType: WorkerCommandTypeDirectSend,
		IssuedAt: workerCommandTimestamp(issuedAt),
	}
	predecessorID := predecessor.OperationID
	successor := predecessor
	successor.CommandID = uuid.NewString()
	successor.OperationID = "successor-" + uuid.NewString()
	successor.EntitySequence = 2
	successor.PredecessorOperationID = &predecessorID
	successor.IssuedAt = workerCommandTimestamp(issuedAt.Add(time.Millisecond))
	predDigest := workerCommandLaneOperationDigest(predecessor.OperationID)
	succDigest := workerCommandLaneOperationDigest(successor.OperationID)
	key := workerCommandLaneKey(predecessor)
	t.Cleanup(func() { _ = client.Del(context.Background(), key).Err() })
	if err := client.HSet(ctx, key, map[string]any{
		"sequence":                       2,
		"op:" + predDigest + ":sequence": 1, "op:" + predDigest + ":operation_id": predecessor.OperationID,
		"op:" + predDigest + ":predecessor": "", "op:" + predDigest + ":issued_at_ms": issuedAt.UnixMilli(),
		"op:" + predDigest + ":command_id": predecessor.CommandID, "op:" + predDigest + ":origin_epoch": predecessor.OriginEpoch,
		"op:" + predDigest + ":payload_digest": predecessor.PayloadDigest, "op:" + predDigest + ":command_type": predecessor.CommandType,
		"op:" + succDigest + ":sequence": 2, "op:" + succDigest + ":operation_id": successor.OperationID,
		"op:" + succDigest + ":predecessor": predecessor.OperationID, "op:" + succDigest + ":issued_at_ms": issuedAt.Add(time.Millisecond).UnixMilli(),
		"op:" + succDigest + ":command_id": successor.CommandID, "op:" + succDigest + ":origin_epoch": successor.OriginEpoch,
		"op:" + succDigest + ":payload_digest": successor.PayloadDigest, "op:" + succDigest + ":command_type": successor.CommandType,
	}).Err(); err != nil {
		t.Fatal(err)
	}
	if disposition, err := worker.claimWorkerCommandLane(ctx, successor); err != nil || disposition != workerCommandLaneAcquired {
		t.Fatalf("successor did not expire never-active orphan: disposition=%q err=%v", disposition, err)
	}
	if terminal, err := client.HGet(ctx, key, "op:"+predDigest+":terminal").Result(); err != nil || terminal != sendIdempotencyStateExpired {
		t.Fatalf("orphan terminal=%q err=%v", terminal, err)
	}

	if err := worker.releaseWorkerCommandLane(ctx, successor); err != nil {
		t.Fatal(err)
	}
	if err := client.HDel(
		ctx,
		key,
		"op:"+predDigest+":terminal",
		"op:"+predDigest+":terminal_at_ms",
		"op:"+predDigest+":terminal_failure_code",
		"op:"+succDigest+":predecessor_satisfied",
	).Err(); err != nil {
		t.Fatal(err)
	}
	if err := client.HSet(ctx, key, "op:"+predDigest+":ever_active", "1").Err(); err != nil {
		t.Fatal(err)
	}
	if disposition, err := worker.claimWorkerCommandLane(ctx, successor); err != nil || disposition != workerCommandLaneBusy {
		t.Fatalf("ever-active predecessor was auto-expired: disposition=%q err=%v", disposition, err)
	}
}

func TestWorkerCommandLaneDoesNotSkipEverActiveTransitivePredecessor(t *testing.T) {
	address := os.Getenv("TEST_REDIS_ADDR")
	if address == "" {
		t.Skip("TEST_REDIS_ADDR is not configured")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	client := redis.NewClient(&redis.Options{Addr: address, Password: os.Getenv("TEST_REDIS_PASSWORD")})
	t.Cleanup(func() { _ = client.Close() })
	worker := &Worker{redis: client}
	issuedAt := time.Now().UTC().Add(-workerCommandDeadline - time.Second).Truncate(time.Millisecond)
	base := WorkerCommandEnvelopeV1{
		CommandID: uuid.NewString(), OperationID: "active-" + uuid.NewString(), AccountID: "account-1", WorkerID: "worker-1",
		EntityKey: "chat:account-1:worker-1:transitive-" + uuid.NewString(), EntitySequence: 1, OriginEpoch: "opaque-epoch-7",
		PayloadDigest: "ea4529441c11c15cb44c9597af9944d10b459a8718a901cf5c7cfb1e15c89874", CommandType: WorkerCommandTypeDirectSend,
		IssuedAt: workerCommandTimestamp(issuedAt),
	}
	second := base
	second.CommandID = uuid.NewString()
	second.OperationID = "expired-waiter-" + uuid.NewString()
	second.EntitySequence = 2
	second.PredecessorOperationID = stringPointer(base.OperationID)
	second.IssuedAt = workerCommandTimestamp(issuedAt.Add(time.Millisecond))
	third := second
	third.CommandID = uuid.NewString()
	third.OperationID = "successor-" + uuid.NewString()
	third.EntitySequence = 3
	third.PredecessorOperationID = stringPointer(second.OperationID)
	third.IssuedAt = workerCommandTimestamp(issuedAt.Add(2 * time.Millisecond))

	baseDigest := workerCommandLaneOperationDigest(base.OperationID)
	secondDigest := workerCommandLaneOperationDigest(second.OperationID)
	thirdDigest := workerCommandLaneOperationDigest(third.OperationID)
	key := workerCommandLaneKey(base)
	t.Cleanup(func() { _ = client.Del(context.Background(), key).Err() })
	fields := map[string]any{
		"sequence": 3, "last_operation_id": third.OperationID, "last_operation_digest": thirdDigest,
		"op:" + baseDigest + ":sequence": 1, "op:" + baseDigest + ":operation_id": base.OperationID,
		"op:" + baseDigest + ":predecessor": "", "op:" + baseDigest + ":predecessor_digest": "",
		"op:" + baseDigest + ":issued_at_ms": issuedAt.UnixMilli(), "op:" + baseDigest + ":command_id": base.CommandID,
		"op:" + baseDigest + ":origin_epoch": base.OriginEpoch, "op:" + baseDigest + ":payload_digest": base.PayloadDigest,
		"op:" + baseDigest + ":command_type": base.CommandType,
		"op:" + secondDigest + ":sequence":   2, "op:" + secondDigest + ":operation_id": second.OperationID,
		"op:" + secondDigest + ":predecessor": base.OperationID, "op:" + secondDigest + ":predecessor_digest": baseDigest,
		"op:" + secondDigest + ":issued_at_ms": issuedAt.Add(time.Millisecond).UnixMilli(), "op:" + secondDigest + ":command_id": second.CommandID,
		"op:" + secondDigest + ":origin_epoch": second.OriginEpoch, "op:" + secondDigest + ":payload_digest": second.PayloadDigest,
		"op:" + secondDigest + ":command_type": second.CommandType,
		"op:" + thirdDigest + ":sequence":      3, "op:" + thirdDigest + ":operation_id": third.OperationID,
		"op:" + thirdDigest + ":predecessor": second.OperationID, "op:" + thirdDigest + ":predecessor_digest": secondDigest,
		"op:" + thirdDigest + ":issued_at_ms": issuedAt.Add(2 * time.Millisecond).UnixMilli(), "op:" + thirdDigest + ":command_id": third.CommandID,
		"op:" + thirdDigest + ":origin_epoch": third.OriginEpoch, "op:" + thirdDigest + ":payload_digest": third.PayloadDigest,
		"op:" + thirdDigest + ":command_type": third.CommandType,
	}
	if err := client.HSet(ctx, key, fields).Err(); err != nil {
		t.Fatal(err)
	}
	if disposition, err := worker.claimWorkerCommandLane(ctx, base); err != nil || disposition != workerCommandLaneAcquired {
		t.Fatalf("active predecessor claim = %q, err=%v", disposition, err)
	}
	if disposition, err := worker.claimWorkerCommandLane(ctx, second); err != nil || disposition != workerCommandLaneBusy {
		t.Fatalf("immediate waiter disposition = %q, want busy, err=%v", disposition, err)
	}
	if disposition, err := worker.claimWorkerCommandLane(ctx, third); err != nil || disposition != workerCommandLaneDeferred {
		t.Fatalf("deep successor disposition = %q, want deferred, err=%v", disposition, err)
	}
	if terminal := client.HGet(ctx, key, "op:"+secondDigest+":terminal").Val(); terminal != "" {
		t.Fatalf("never-active waiter expired across active predecessor: %q", terminal)
	}
	// Reproduce the legacy race explicitly: a stale N+1 expired marker must not
	// allow N+2 to cross while N is still provider-active.
	if err := client.HSet(ctx, key,
		"op:"+secondDigest+":terminal", sendIdempotencyStateExpired,
		"op:"+secondDigest+":terminal_at_ms", time.Now().UnixMilli(),
	).Err(); err != nil {
		t.Fatal(err)
	}
	if disposition, err := worker.claimWorkerCommandLane(ctx, third); err != nil || disposition != workerCommandLaneDeferred {
		t.Fatalf("stale expired waiter skipped active predecessor: disposition=%q err=%v", disposition, err)
	}
	if err := client.HDel(ctx, key,
		"op:"+secondDigest+":terminal",
		"op:"+secondDigest+":terminal_at_ms",
	).Err(); err != nil {
		t.Fatal(err)
	}
	if err := worker.completeWorkerCommandLane(ctx, base, sendIdempotencyStateSucceeded); err != nil {
		t.Fatalf("complete active predecessor: %v", err)
	}
	if disposition, err := worker.claimWorkerCommandLane(ctx, third); err != nil || disposition != workerCommandLaneAcquired {
		t.Fatalf("successor did not advance after safe waiter expiry: disposition=%q err=%v", disposition, err)
	}
	if terminal := client.HGet(ctx, key, "op:"+secondDigest+":terminal").Val(); terminal != sendIdempotencyStateExpired {
		t.Fatalf("waiter terminal after predecessor completion = %q", terminal)
	}
}
