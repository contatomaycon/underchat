package app

import (
	"context"
	"errors"
	"os"
	"reflect"
	"testing"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/segmentio/kafka-go"
)

func TestProfileInfoSuboperationsAreOrderedAndIsolated(t *testing.T) {
	data := ProfileInfoMessage{
		WorkerID:     "worker-1",
		AccountID:    "account-1",
		Name:         "Maycon",
		Message:      "Disponível",
		Photo:        "https://cdn.test/profile.jpg",
		PhotoPresent: true,
		Raw:          map[string]any{"must_not_leak": true},
	}
	operations := profileInfoSuboperations(data)
	if len(operations) != 3 {
		t.Fatalf("expected three profile suboperations, got %#v", operations)
	}
	if got := []string{operations[0].ID, operations[1].ID, operations[2].ID}; !reflect.DeepEqual(got, []string{"name", "status", "photo"}) {
		t.Fatalf("profile suboperation order = %#v", got)
	}

	name := operations[0].Payload
	if name.Name != data.Name ||
		name.Message != "" ||
		name.PhotoPresent ||
		name.Photo != "" ||
		name.PhotoRemove {
		t.Fatalf("name suboperation leaked another provider effect: %#v", name)
	}
	status := operations[1].Payload
	if status.Name != "" ||
		status.Message != data.Message ||
		status.PhotoPresent ||
		status.Photo != "" ||
		status.PhotoRemove {
		t.Fatalf("status suboperation leaked another provider effect: %#v", status)
	}
	photo := operations[2].Payload
	if photo.Name != "" ||
		photo.Message != "" ||
		!photo.PhotoPresent ||
		photo.Photo != data.Photo ||
		photo.PhotoRemove {
		t.Fatalf("photo suboperation leaked another provider effect: %#v", photo)
	}
	for _, operation := range operations {
		if operation.Payload.WorkerID != data.WorkerID ||
			operation.Payload.AccountID != data.AccountID {
			t.Fatalf("suboperation lost immutable identity: %#v", operation)
		}
		if operation.Payload.Raw != nil {
			t.Fatalf("suboperation retained unrelated raw payload: %#v", operation.Payload.Raw)
		}
	}
}

func TestProfileInfoPhotoRemovalIsAnIndependentSuboperation(t *testing.T) {
	operations := profileInfoSuboperations(ProfileInfoMessage{
		WorkerID:     "worker-1",
		AccountID:    "account-1",
		PhotoPresent: true,
		PhotoRemove:  true,
	})
	if len(operations) != 1 ||
		operations[0].ID != "photo" ||
		!operations[0].Payload.PhotoPresent ||
		!operations[0].Payload.PhotoRemove {
		t.Fatalf("profile photo removal was not isolated: %#v", operations)
	}
}

func TestProfileInfoSuboperationIdentitiesAreStableAndDistinct(t *testing.T) {
	source := kafka.Message{
		Topic:     "worker.worker-1.send.message",
		Partition: 3,
		Offset:    91,
		Headers: []kafka.Header{
			{Key: workerCommandHeaderOperationID, Value: []byte("profile-command-1")},
		},
	}
	originalTopic := source.Topic
	seen := map[string]string{}
	for _, effect := range []string{"name", "status", "photo"} {
		first := profileInfoSuboperationMessage(source, effect)
		second := profileInfoSuboperationMessage(source, effect)
		firstID := workerCommandOperationID(first)
		if firstID != workerCommandOperationID(second) {
			t.Fatalf("%s suboperation identity is not stable", effect)
		}
		if priorEffect, exists := seen[firstID]; exists {
			t.Fatalf("%s and %s share operation identity %q", priorEffect, effect, firstID)
		}
		seen[firstID] = effect
	}
	nameOperationID := "profile-command-1\x00profile-info\x00name"
	if _, exists := seen[nameOperationID]; !exists {
		t.Fatalf("profile name child operation ID is not cross-runtime canonical: %v", seen)
	}
	key, err := outboundSendIdempotencyKey(outboundSendOperation{
		AccountID: "account-1",
		Type:      "direct",
		ID:        nameOperationID,
	})
	if err != nil {
		t.Fatal(err)
	}
	const wantNameKey = "message-send:idempotency:v4:account-1:a80a764a9182b1c84388a3711ed560723a8a72d1bbb597ff6ff26e9abe7eedae"
	if key != wantNameKey {
		t.Fatalf("profile child v4 ledger key = %q, want %q", key, wantNameKey)
	}
	if source.Topic != originalTopic {
		t.Fatalf("source Kafka message was mutated: %q", source.Topic)
	}
}

func TestRunProfileInfoSuboperationsStopsAndResumesInOrder(t *testing.T) {
	data := ProfileInfoMessage{
		WorkerID:     "worker-1",
		AccountID:    "account-1",
		Name:         "Maycon",
		Message:      "Disponível",
		PhotoPresent: true,
		PhotoRemove:  true,
	}
	stop := errors.New("status preflight unavailable")
	var first []string
	err := runProfileInfoSuboperations(data, func(operation profileInfoSuboperation) error {
		first = append(first, operation.ID)
		if operation.ID == "status" {
			return stop
		}
		return nil
	})
	if !errors.Is(err, stop) || !reflect.DeepEqual(first, []string{"name", "status"}) {
		t.Fatalf("first pass order=%#v err=%v", first, err)
	}

	var retry []string
	if err := runProfileInfoSuboperations(data, func(operation profileInfoSuboperation) error {
		retry = append(retry, operation.ID)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(retry, []string{"name", "status", "photo"}) {
		t.Fatalf("retry order=%#v", retry)
	}
}

func TestProfileInfoSuboperationLedgersResumeWithoutRepeatingTerminalEffects(t *testing.T) {
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

	workerID := "profile-suboperation-worker-" + uuid.NewString()
	accountID := "profile-suboperation-account-" + uuid.NewString()
	worker := &Worker{
		cfg: Config{
			WorkerID:  workerID,
			AccountID: accountID,
		},
		redis: client,
	}
	worker.kafkaConsumerBarrierEpoch.Store(731)
	worker.kafkaConsumersReady.Store(true)
	worker.kafkaConsumersAuthorized.Store(true)
	ctx = captureAuthorizedKafkaContext(t, worker)

	data := ProfileInfoMessage{
		WorkerID:     workerID,
		AccountID:    accountID,
		Name:         "Maycon",
		Message:      "Disponível",
		PhotoPresent: true,
		PhotoRemove:  true,
	}
	message := kafka.Message{
		Topic:     "worker." + workerID + ".send.message",
		Partition: 2,
		Offset:    37,
		Headers: []kafka.Header{
			{Key: workerCommandHeaderOperationID, Value: []byte("profile-command-resume")},
		},
	}
	keyFor := func(effect string) string {
		key, err := outboundSendIdempotencyKey(outboundSendOperation{
			AccountID: accountID,
			Type:      "direct",
			ID: workerCommandOperationID(
				profileInfoSuboperationMessage(message, effect),
			),
		})
		if err != nil {
			t.Fatal(err)
		}
		return key
	}
	keys := []string{keyFor("name"), keyFor("status"), keyFor("photo")}
	t.Cleanup(func() { _ = client.Del(context.Background(), keys...).Err() })

	providerCalls := map[string]int{}
	statusPreflightUnavailable := true
	run := func() error {
		return runProfileInfoSuboperations(data, func(operation profileInfoSuboperation) error {
			return worker.processProviderCommandWithIdempotency(
				ctx,
				profileInfoSuboperationMessage(message, operation.ID),
				accountID,
				workerID,
				func(boundary providerInvocationBoundary) error {
					if operation.ID == "status" && statusPreflightUnavailable {
						statusPreflightUnavailable = false
						return errors.New("provider not ready before invocation")
					}
					if err := boundary(ctx); err != nil {
						return err
					}
					providerCalls[operation.ID]++
					return nil
				},
				nil,
			)
		})
	}

	if err := run(); err == nil {
		t.Fatal("expected the status preflight failure to keep the source retryable")
	}
	if !reflect.DeepEqual(providerCalls, map[string]int{"name": 1}) {
		t.Fatalf("first pass provider calls = %#v", providerCalls)
	}
	if state := client.HGet(ctx, keys[0], "state").Val(); state != sendIdempotencyStateSucceeded {
		t.Fatalf("name ledger state=%q", state)
	}
	if exists := client.Exists(ctx, keys[1], keys[2]).Val(); exists != 0 {
		t.Fatalf("unattempted effects left %d durable claims", exists)
	}

	if err := run(); err != nil {
		t.Fatalf("retry did not resume missing effects: %v", err)
	}
	if !reflect.DeepEqual(providerCalls, map[string]int{"name": 1, "status": 1, "photo": 1}) {
		t.Fatalf("retry repeated or skipped an effect: %#v", providerCalls)
	}
	for index, key := range keys {
		if state := client.HGet(ctx, key, "state").Val(); state != sendIdempotencyStateSucceeded {
			t.Fatalf("ledger %d state=%q", index, state)
		}
	}

	if err := run(); err != nil {
		t.Fatalf("terminal replay failed: %v", err)
	}
	if !reflect.DeepEqual(providerCalls, map[string]int{"name": 1, "status": 1, "photo": 1}) {
		t.Fatalf("terminal replay repeated provider calls: %#v", providerCalls)
	}
}

func TestProfileInfoAmbiguousSuboperationDoesNotBlockOrRepeatLaterEffects(t *testing.T) {
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

	workerID := "profile-ambiguous-worker-" + uuid.NewString()
	accountID := "profile-ambiguous-account-" + uuid.NewString()
	worker := &Worker{
		cfg:   Config{WorkerID: workerID, AccountID: accountID},
		redis: client,
	}
	worker.kafkaConsumerBarrierEpoch.Store(811)
	worker.kafkaConsumersReady.Store(true)
	worker.kafkaConsumersAuthorized.Store(true)
	ctx = captureAuthorizedKafkaContext(t, worker)
	data := ProfileInfoMessage{
		WorkerID:     workerID,
		AccountID:    accountID,
		Name:         "Maycon",
		Message:      "Disponível",
		PhotoPresent: true,
		PhotoRemove:  true,
	}
	message := kafka.Message{
		Topic:     "worker." + workerID + ".send.message",
		Partition: 1,
		Offset:    83,
		Headers: []kafka.Header{
			{Key: workerCommandHeaderOperationID, Value: []byte("profile-command-ambiguous")},
		},
	}
	keyFor := func(effect string) string {
		key, err := outboundSendIdempotencyKey(outboundSendOperation{
			AccountID: accountID,
			Type:      "direct",
			ID: workerCommandOperationID(
				profileInfoSuboperationMessage(message, effect),
			),
		})
		if err != nil {
			t.Fatal(err)
		}
		return key
	}
	keys := []string{keyFor("name"), keyFor("status"), keyFor("photo")}
	t.Cleanup(func() { _ = client.Del(context.Background(), keys...).Err() })

	providerCalls := map[string]int{}
	run := func() error {
		return runProfileInfoSuboperations(data, func(operation profileInfoSuboperation) error {
			return worker.processProviderCommandWithIdempotency(
				ctx,
				profileInfoSuboperationMessage(message, operation.ID),
				accountID,
				workerID,
				func(boundary providerInvocationBoundary) error {
					if err := boundary(ctx); err != nil {
						return err
					}
					providerCalls[operation.ID]++
					if operation.ID == "status" {
						return errors.New("provider result unknown")
					}
					return nil
				},
				nil,
			)
		})
	}
	if err := run(); err != nil {
		t.Fatalf("ambiguous suboperation blocked later effects: %v", err)
	}
	if !reflect.DeepEqual(providerCalls, map[string]int{"name": 1, "status": 1, "photo": 1}) {
		t.Fatalf("first pass calls=%#v", providerCalls)
	}
	if state := client.HGet(ctx, keys[1], "state").Val(); state != sendIdempotencyStateAmbiguous {
		t.Fatalf("status ledger state=%q", state)
	}
	if state := client.HGet(ctx, keys[2], "state").Val(); state != sendIdempotencyStateSucceeded {
		t.Fatalf("photo ledger state=%q", state)
	}

	if err := run(); err != nil {
		t.Fatalf("ambiguous replay failed: %v", err)
	}
	if !reflect.DeepEqual(providerCalls, map[string]int{"name": 1, "status": 1, "photo": 1}) {
		t.Fatalf("ambiguous replay repeated provider effects: %#v", providerCalls)
	}
}
