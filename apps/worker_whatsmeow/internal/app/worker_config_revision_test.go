package app

import (
	"context"
	"os"
	"testing"

	"github.com/redis/go-redis/v9"
)

func TestNormalizeWorkerConfigRevision(t *testing.T) {
	if revision, err := normalizeWorkerConfigRevision(" 1777777777000000 "); err != nil || revision != "1777777777000000" {
		t.Fatalf("normalize revision = %q, %v", revision, err)
	}
	for _, invalid := range []string{"", "0", "-1", "invalid", "9007199254740992"} {
		if _, err := normalizeWorkerConfigRevision(invalid); err == nil {
			t.Fatalf("invalid revision %q was accepted", invalid)
		}
	}
}

func TestWorkerConfigRevisionIsSharedAcrossWorkerRestarts(t *testing.T) {
	address := os.Getenv("TEST_REDIS_ADDR")
	if address == "" {
		t.Skip("TEST_REDIS_ADDR is not configured")
	}

	ctx := context.Background()
	password := os.Getenv("TEST_REDIS_PASSWORD")
	if password == "" {
		password = os.Getenv("DB_CACHE_PASSWORD")
	}
	client := redis.NewClient(&redis.Options{
		Addr:     address,
		Password: password,
	})
	t.Cleanup(func() {
		_ = client.Close()
	})
	currentKey := workerConfigCurrentRevisionKey("worker-1")
	appliedKey := workerConfigAppliedRevisionKey("worker-1")
	if err := client.Del(ctx, currentKey, appliedKey).Err(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = client.Del(context.Background(), currentKey, appliedKey).Err()
	})

	if err := client.Set(ctx, currentKey, "200", 0).Err(); err != nil {
		t.Fatal(err)
	}
	first := &Worker{redis: client}
	second := &Worker{redis: client}

	if current, err := first.validateCurrentWorkerConfigRevision(ctx, "worker-1", "200"); err != nil || !current {
		t.Fatalf("first validation = %t, %v", current, err)
	}
	if current, err := second.validateCurrentWorkerConfigRevision(ctx, "worker-1", "200"); err != nil || !current {
		t.Fatalf("restart validation = %t, %v", current, err)
	}
	if applied, err := client.Get(ctx, appliedKey).Result(); err != redis.Nil {
		t.Fatalf("validation mutated legacy applied key: value=%q error=%v", applied, err)
	}
	if err := client.Set(ctx, currentKey, "201", 0).Err(); err != nil {
		t.Fatal(err)
	}
	if current, err := second.validateCurrentWorkerConfigRevision(ctx, "worker-1", "200"); err != nil || current {
		t.Fatalf("stale validation = %t, %v", current, err)
	}
	if current, err := second.validateCurrentWorkerConfigRevision(ctx, "worker-1", "201"); err != nil || !current {
		t.Fatalf("new current validation = %t, %v", current, err)
	}
}

func TestWorkerConfigRevisionLegacyFallbackIsFailClosedAfterRevisionRollout(t *testing.T) {
	address := os.Getenv("TEST_REDIS_ADDR")
	if address == "" {
		t.Skip("TEST_REDIS_ADDR is not configured")
	}

	ctx := context.Background()
	password := os.Getenv("TEST_REDIS_PASSWORD")
	if password == "" {
		password = os.Getenv("DB_CACHE_PASSWORD")
	}
	client := redis.NewClient(&redis.Options{
		Addr:     address,
		Password: password,
	})
	t.Cleanup(func() {
		_ = client.Close()
	})

	currentKey := workerConfigCurrentRevisionKey("worker-legacy")
	appliedKey := workerConfigAppliedRevisionKey("worker-legacy")
	if err := client.Del(ctx, currentKey, appliedKey).Err(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = client.Del(context.Background(), currentKey, appliedKey).Err()
	})

	worker := &Worker{redis: client}
	if current, err := worker.validateCurrentWorkerConfigRevision(ctx, "worker-legacy", ""); err != nil || !current {
		t.Fatalf("clean legacy validation = %t, %v", current, err)
	}
	if err := client.Set(ctx, appliedKey, "199", 0).Err(); err != nil {
		t.Fatal(err)
	}
	if current, err := worker.validateCurrentWorkerConfigRevision(ctx, "worker-legacy", ""); err != nil || current {
		t.Fatalf("legacy validation with rollout marker = %t, %v", current, err)
	}
	if err := client.Set(ctx, currentKey, "200", 0).Err(); err != nil {
		t.Fatal(err)
	}
	if current, err := worker.validateCurrentWorkerConfigRevision(ctx, "worker-legacy", ""); err != nil || current {
		t.Fatalf("legacy validation after current revision = %t, %v", current, err)
	}
}
