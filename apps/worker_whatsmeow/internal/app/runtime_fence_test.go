package app

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
	"go.mau.fi/whatsmeow"
)

type fakeKafkaConsumerOwnerScopeCapturer struct {
	scope whatsAppRuntimeFence
	err   error
	calls int
}

func (f *fakeKafkaConsumerOwnerScopeCapturer) captureActiveConnectionScope(
	context.Context,
) (whatsAppRuntimeFence, error) {
	f.calls++
	return f.scope, f.err
}

func TestRuntimeFenceRetryFullJitterUsesInjectedEntropyWithinCap(t *testing.T) {
	cap := 400 * time.Millisecond
	width := uint64(cap) + 1
	sequence := []uint64{
		0,
		width / 4,
		width / 2,
		width - 1,
		width + 17,
	}
	index := 0
	random := func() uint64 {
		value := sequence[index]
		index++
		return value
	}
	unique := make(map[time.Duration]struct{}, len(sequence))
	for _, raw := range sequence {
		delay := whatsAppRuntimeFenceRetryFullJitter(cap, random)
		if delay < 0 || delay > cap {
			t.Fatalf("full jitter delay %s outside [0,%s]", delay, cap)
		}
		expected := time.Duration(raw % width)
		if delay != expected {
			t.Fatalf("full jitter delay=%s want=%s for entropy=%d", delay, expected, raw)
		}
		unique[delay] = struct{}{}
	}
	if len(unique) < 4 {
		t.Fatalf("injected entropy did not desynchronize retry sequence: %#v", unique)
	}

	maximum := whatsAppRuntimeFenceRetryFullJitter(
		10*time.Second,
		func() uint64 { return uint64(whatsAppRuntimeFenceRetryMaximumCap) },
	)
	if maximum != whatsAppRuntimeFenceRetryMaximumCap {
		t.Fatalf(
			"oversized retry cap produced %s, want clamped maximum %s",
			maximum,
			whatsAppRuntimeFenceRetryMaximumCap,
		)
	}
}

func TestRuntimeFenceRetryCapGrowthIsBounded(t *testing.T) {
	expected := []time.Duration{
		100 * time.Millisecond,
		200 * time.Millisecond,
		400 * time.Millisecond,
		800 * time.Millisecond,
		1600 * time.Millisecond,
		2 * time.Second,
		2 * time.Second,
	}
	cap := whatsAppRuntimeFenceRetryInitialCap
	for index, want := range expected {
		if cap != want {
			t.Fatalf("retry cap[%d]=%s want=%s", index, cap, want)
		}
		cap = nextWhatsAppRuntimeFenceRetryCap(cap)
	}
}

func TestRuntimeFenceJitterWaitCancelsBeforeTimerAndEntropy(t *testing.T) {
	var randomCalls atomic.Int32
	randomCalled := make(chan struct{})
	manager := &WhatsAppManager{
		runtimeFenceRetryRandom: func() uint64 {
			if randomCalls.Add(1) == 1 {
				close(randomCalled)
			}
			return uint64(whatsAppRuntimeFenceRetryMaximumCap)
		},
	}

	ctx, cancel := context.WithCancel(context.Background())
	result := make(chan error, 1)
	go func() {
		result <- manager.waitWhatsAppRuntimeFenceRetry(
			ctx,
			whatsAppRuntimeFenceRetryMaximumCap,
		)
	}()
	select {
	case <-randomCalled:
	case <-time.After(time.Second):
		t.Fatal("jitter wait did not sample injected entropy")
	}
	cancel()
	select {
	case err := <-result:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("jitter wait cancellation error=%v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("jitter wait ignored context cancellation")
	}

	alreadyCancelled, cancelAlready := context.WithCancel(context.Background())
	cancelAlready()
	before := randomCalls.Load()
	if err := manager.waitWhatsAppRuntimeFenceRetry(
		alreadyCancelled,
		whatsAppRuntimeFenceRetryMaximumCap,
	); !errors.Is(err, context.Canceled) {
		t.Fatalf("pre-cancelled jitter wait error=%v", err)
	}
	if after := randomCalls.Load(); after != before {
		t.Fatalf("pre-cancelled wait sampled entropy calls=%d want=%d", after, before)
	}
}

func TestInboundConnectionScopeContextIsImmutable(t *testing.T) {
	scope := whatsAppRuntimeFence{
		State:              "active",
		WorkerID:           "worker-1",
		RuntimeGeneration:  7,
		ConnectionEpoch:    "epoch-7",
		ConnectionSequence: 1,
		SourceProvider:     "whatsmeow",
		ActivatedAt:        1_700_000_000_000,
		ActivationOrder:    1,
	}
	ctx := withInboundConnectionScope(context.Background(), scope)

	scope.ConnectionEpoch = "replacement"
	captured, ok := inboundConnectionScopeFromContext(ctx)
	if !ok {
		t.Fatal("expected captured connection scope")
	}
	if captured.ConnectionEpoch != "epoch-7" {
		t.Fatalf("captured callback scope changed: %q", captured.ConnectionEpoch)
	}
}

func TestKafkaConsumerOwnerScopeRequiresProviderReadinessAndActiveFence(t *testing.T) {
	active := whatsAppRuntimeFence{
		State:              "active",
		WorkerID:           "worker-1",
		RuntimeGeneration:  7,
		ConnectionEpoch:    "epoch-7",
		ConnectionSequence: 1,
		SourceProvider:     "whatsmeow",
		ActivatedAt:        1_700_000_000_000,
		ActivationOrder:    1,
	}
	capturer := &fakeKafkaConsumerOwnerScopeCapturer{scope: active}

	if _, err := captureKafkaConsumerOwnerScope(context.Background(), capturer, false); !errors.Is(err, errWhatsAppRuntimeFenceRevoked) {
		t.Fatalf("provider-not-ready consumer ownership did not fail closed: %v", err)
	}
	if capturer.calls != 0 {
		t.Fatalf("provider-not-ready path queried the runtime fence %d times", capturer.calls)
	}

	captured, err := captureKafkaConsumerOwnerScope(context.Background(), capturer, true)
	if err != nil {
		t.Fatalf("capture active consumer owner scope: %v", err)
	}
	if captured != active {
		t.Fatalf("captured unexpected consumer owner scope: %#v", captured)
	}
	if capturer.calls != 1 {
		t.Fatalf("active path queried the runtime fence %d times", capturer.calls)
	}
}

func TestKafkaConsumerOwnerScopeFailsClosedAfterFenceReplacement(t *testing.T) {
	owned := whatsAppRuntimeFence{
		State:              "active",
		WorkerID:           "worker-1",
		RuntimeGeneration:  7,
		ConnectionEpoch:    "epoch-owned",
		ConnectionSequence: 1,
		SourceProvider:     "whatsmeow",
		ActivatedAt:        1_700_000_000_000,
		ActivationOrder:    1,
	}
	capturer := &fakeKafkaConsumerOwnerScopeCapturer{scope: owned}

	if !isKafkaConsumerOwnerScopeCurrent(context.Background(), capturer, owned) {
		t.Fatal("active consumer ownership was rejected")
	}

	replacement := owned
	replacement.ConnectionEpoch = "epoch-replacement"
	replacement.ActivatedAt++
	capturer.scope = replacement
	if isKafkaConsumerOwnerScopeCurrent(context.Background(), capturer, owned) {
		t.Fatal("consumer ownership survived a connection-epoch replacement")
	}

	capturer.scope = owned
	capturer.scope.ActivatedAt++
	if isKafkaConsumerOwnerScopeCurrent(context.Background(), capturer, owned) {
		t.Fatal("consumer ownership accepted a mutated runtime-fence record")
	}

	capturer.scope = owned
	capturer.err = errors.New("redis unavailable")
	if isKafkaConsumerOwnerScopeCurrent(context.Background(), capturer, owned) {
		t.Fatal("consumer ownership failed open while Redis was unavailable")
	}

	capturer.err = nil
	if isKafkaConsumerOwnerScopeCurrent(context.Background(), capturer, whatsAppRuntimeFence{}) {
		t.Fatal("invalid expected scope authorized Kafka consumers")
	}
}

func TestRuntimeFenceRedisOutageRemainsDistinctFromConfirmedRevocation(t *testing.T) {
	t.Parallel()

	scope := whatsAppRuntimeFence{
		State:              "active",
		WorkerID:           "worker-1",
		RuntimeGeneration:  7,
		ConnectionEpoch:    "epoch-7",
		ConnectionSequence: 1,
		SourceProvider:     "whatsmeow",
		ActivatedAt:        1_700_000_000_000,
		ActivationOrder:    1,
	}
	client := redis.NewClient(&redis.Options{
		Addr:         "127.0.0.1:1",
		DialTimeout:  20 * time.Millisecond,
		ReadTimeout:  20 * time.Millisecond,
		WriteTimeout: 20 * time.Millisecond,
		MaxRetries:   -1,
	})
	defer client.Close()
	manager := &WhatsAppManager{
		redis:                  client,
		inboundConnectionScope: &scope,
	}
	ctx, cancel := context.WithTimeout(context.Background(), 250*time.Millisecond)
	defer cancel()

	_, err := manager.captureActiveConnectionScope(ctx)
	if err == nil {
		t.Fatal("runtime fence Redis outage was accepted")
	}
	if errors.Is(err, errWhatsAppRuntimeFenceRevoked) {
		t.Fatalf("Redis outage was misclassified as a confirmed revocation: %v", err)
	}
}

func TestInboundSpoolKeyRotatesByGenerationAndConnectionEpoch(t *testing.T) {
	manager := &WhatsAppManager{cfg: Config{WorkerID: "worker-1"}}
	first := whatsAppRuntimeFence{
		State:              "active",
		WorkerID:           "worker-1",
		RuntimeGeneration:  7,
		ConnectionEpoch:    "epoch-a",
		ConnectionSequence: 1,
		SourceProvider:     "whatsmeow",
		ActivatedAt:        1,
		ActivationOrder:    1,
	}
	second := first
	second.ConnectionEpoch = "epoch-b"

	firstKeys := []string{
		manager.inboundSpoolStreamKey(first),
		manager.inboundSpoolRetrySetKey(first),
		manager.inboundSpoolRetryPayloadHashKey(first),
		manager.inboundSpoolParkingSetKey(first),
		manager.inboundSpoolPayloadHashKey(first),
	}
	secondKeys := []string{
		manager.inboundSpoolStreamKey(second),
		manager.inboundSpoolRetrySetKey(second),
		manager.inboundSpoolRetryPayloadHashKey(second),
		manager.inboundSpoolParkingSetKey(second),
		manager.inboundSpoolPayloadHashKey(second),
	}
	for index := range firstKeys {
		if firstKeys[index] == secondKeys[index] {
			t.Fatalf("connection epochs must use different spool keys: %q", firstKeys[index])
		}
	}
}

func TestInboundSpoolIndexAndCleanupKeysAreWorkerScopedAndDeterministic(t *testing.T) {
	manager := &WhatsAppManager{cfg: Config{WorkerID: "worker-1"}}
	other := &WhatsAppManager{cfg: Config{WorkerID: "worker-10"}}
	scope := whatsAppRuntimeFence{
		State:              "active",
		WorkerID:           "worker-1",
		RuntimeGeneration:  7,
		ConnectionEpoch:    "epoch-7",
		ConnectionSequence: 1,
		SourceProvider:     "whatsmeow",
		ActivatedAt:        1_700_000_000_000,
		ActivationOrder:    1,
	}

	if got, want := manager.inboundSpoolIndexKey(), "inbound:message:spool-index:v1:worker-1"; got != want {
		t.Fatalf("unexpected worker spool index %q want %q", got, want)
	}
	scopeKeys := manager.inboundSpoolScopeKeys(scope)
	if len(scopeKeys) != 5 {
		t.Fatalf("scope key count = %d, want 5", len(scopeKeys))
	}
	for _, key := range scopeKeys {
		if !manager.isIndexedInboundSpoolKey(key) {
			t.Fatalf("current worker rejected its indexed key %q", key)
		}
		if other.isIndexedInboundSpoolKey(key) {
			t.Fatalf("worker-10 accepted worker-1 key %q", key)
		}
	}
	if !manager.isIndexedInboundSpoolKey(
		"inbound:message:wwebjs:worker-1:generation:7:epoch:epoch:with:colon:retry",
	) {
		t.Fatal("valid scoped spool key with a non-empty compound epoch was rejected")
	}
	for _, key := range []string{
		"inbound:message:whatsmeow:worker-1:unrelated",
		"inbound:message:whatsmeow:worker-1:generation:0:epoch:epoch-7:stream",
		"inbound:message:whatsmeow:worker-1:generation:7:epoch::stream",
		"inbound:message:whatsmeow:worker-1:generation:7:epoch:epoch-7:unrelated",
		"inbound:message:unknown:worker-1:stream",
	} {
		if manager.isIndexedInboundSpoolKey(key) {
			t.Fatalf("corrupt index member passed the spool key allowlist: %q", key)
		}
	}

	legacyKeys := manager.inboundSpoolLegacyKeys()
	if len(legacyKeys) != 15 {
		t.Fatalf("legacy cleanup key count = %d, want 15", len(legacyKeys))
	}
	seen := make(map[string]struct{}, len(legacyKeys))
	for _, key := range legacyKeys {
		if strings.ContainsAny(key, "*?[") {
			t.Fatalf("legacy cleanup key is not deterministic: %q", key)
		}
		if _, duplicate := seen[key]; duplicate {
			t.Fatalf("duplicate legacy cleanup key %q", key)
		}
		seen[key] = struct{}{}
		if !manager.isIndexedInboundSpoolKey(key) {
			t.Fatalf("legacy key was not recognized as worker-scoped: %q", key)
		}
	}
}

func TestFencedLifecycleEventClosesBarrierBeforeDeferredCleanup(t *testing.T) {
	scope := whatsAppRuntimeFence{
		State:              "active",
		WorkerID:           "worker-1",
		RuntimeGeneration:  7,
		ConnectionEpoch:    "epoch-7",
		ConnectionSequence: 1,
		SourceProvider:     "whatsmeow",
		ActivatedAt:        1_700_000_000_000,
		ActivationOrder:    1,
	}
	barrierReady := true
	invalidationCalls := 0
	manager := &WhatsAppManager{inboundConnectionScope: &scope}
	manager.setConsumerBarrierCallbacks(
		func() bool { return barrierReady },
		func() {
			invalidationCalls++
			barrierReady = false
		},
	)

	event := manager.beginFencedProviderLifecycleEvent()
	if barrierReady || invalidationCalls != 1 {
		t.Fatalf(
			"lifecycle event did not synchronously close consumer barrier ready=%t calls=%d",
			barrierReady,
			invalidationCalls,
		)
	}
	if event.capturedScope == nil ||
		!sameWhatsAppRuntimeFenceIdentity(*event.capturedScope, scope) {
		t.Fatalf("lifecycle event did not capture current scope: %#v", event.capturedScope)
	}
}

func TestFencedLifecycleInvalidationCannotRaceNewConnectedLifecycle(t *testing.T) {
	invalidationStarted := make(chan struct{})
	allowInvalidation := make(chan struct{})
	manager := &WhatsAppManager{}
	manager.setConsumerBarrierCallbacks(
		func() bool { return true },
		func() {
			close(invalidationStarted)
			<-allowInvalidation
		},
	)

	fencedDone := make(chan providerLifecycleEventToken, 1)
	go func() {
		fencedDone <- manager.beginFencedProviderLifecycleEvent()
	}()
	select {
	case <-invalidationStarted:
	case <-time.After(time.Second):
		t.Fatal("fenced lifecycle did not begin barrier invalidation")
	}

	connectedDone := make(chan providerLifecycleEventToken, 1)
	go func() {
		connectedDone <- manager.beginProviderLifecycleEvent(false)
	}()
	select {
	case <-connectedDone:
		t.Fatal("new Connected lifecycle raced ahead of disconnect invalidation")
	case <-time.After(20 * time.Millisecond):
	}

	close(allowInvalidation)
	var fenced providerLifecycleEventToken
	select {
	case fenced = <-fencedDone:
	case <-time.After(time.Second):
		t.Fatal("fenced lifecycle did not finish")
	}
	select {
	case connected := <-connectedDone:
		if connected.serial != fenced.serial+1 {
			t.Fatalf(
				"connected serial = %d, want %d after fenced event",
				connected.serial,
				fenced.serial+1,
			)
		}
	case <-time.After(time.Second):
		t.Fatal("connected lifecycle did not resume after invalidation")
	}
}

func TestRuntimeFenceRecoveryCancelledBeforeDelayedRunnerCannotSupersedeTerminalLifecycle(t *testing.T) {
	client := &whatsmeow.Client{}
	var rotateCalls atomic.Int32
	manager := &WhatsAppManager{
		client: client,
		runtimeFenceRecoveryVerify: func(candidate *whatsmeow.Client) bool {
			return candidate == client
		},
		runtimeFenceRecoveryRotate: func(
			context.Context,
			*whatsmeow.Client,
			string,
		) (whatsAppRuntimeFence, error) {
			rotateCalls.Add(1)
			return whatsAppRuntimeFence{}, errors.New("unexpected stale recovery rotation")
		},
	}
	origin := manager.beginProviderLifecycleEvent(false)
	recoveryCtx, cancel := context.WithCancel(context.Background())

	manager.runtimeFenceRecoveryMu.Lock()
	manager.runtimeFenceRecoverySerial++
	recoverySerial := manager.runtimeFenceRecoverySerial
	manager.runtimeFenceRecoveryCancel = cancel
	manager.runtimeFenceRecoveryClient = client
	manager.runtimeFenceRecoveryMu.Unlock()

	terminal := manager.beginFencedProviderLifecycleEvent()
	manager.runRuntimeFenceRecovery(
		recoveryCtx,
		cancel,
		client,
		"delayed-runner",
		recoverySerial,
		origin.serial,
	)

	if rotateCalls.Load() != 0 {
		t.Fatalf("cancelled delayed recovery rotated the runtime fence %d times", rotateCalls.Load())
	}
	if !manager.isProviderLifecycleEventCurrent(terminal.serial) {
		t.Fatal("cancelled delayed recovery superseded the terminal lifecycle token")
	}
	if !manager.applyProviderLifecycleState(terminal.serial, func() {
		manager.connected = false
		manager.status = "disconnected"
		manager.code = CodeLoggedOut
	}) {
		t.Fatal("terminal lifecycle could not apply after cancelling delayed recovery")
	}
	if manager.IsConnected() {
		t.Fatal("cancelled delayed recovery revived a terminal provider lifecycle")
	}
}

func TestRuntimeFenceRecoveryCancelledAfterRotateCannotApplyConnectedState(t *testing.T) {
	client := &whatsmeow.Client{}
	scope := whatsAppRuntimeFence{
		State:              "active",
		WorkerID:           "worker-runtime-recovery",
		RuntimeGeneration:  7,
		ConnectionEpoch:    "epoch-runtime-recovery",
		ConnectionSequence: 19,
		SourceProvider:     "whatsmeow",
		ActivatedAt:        1_700_000_000_000,
		ActivationOrder:    3,
	}
	beforeApply := make(chan struct{})
	allowApply := make(chan struct{})
	var manager *WhatsAppManager
	manager = &WhatsAppManager{
		cfg:    Config{WorkerID: scope.WorkerID, RuntimeGeneration: scope.RuntimeGeneration},
		client: client,
		runtimeFenceRecoveryVerify: func(candidate *whatsmeow.Client) bool {
			return candidate == client
		},
		runtimeFenceRecoveryRotate: func(
			context.Context,
			*whatsmeow.Client,
			string,
		) (whatsAppRuntimeFence, error) {
			manager.mu.Lock()
			captured := scope
			manager.inboundConnectionScope = &captured
			manager.mu.Unlock()
			return scope, nil
		},
		runtimeFenceRecoveryBeforeApply: func() {
			close(beforeApply)
			<-allowApply
		},
	}
	origin := manager.beginProviderLifecycleEvent(false)
	recoveryCtx, cancel := context.WithCancel(context.Background())
	manager.runtimeFenceRecoveryMu.Lock()
	manager.runtimeFenceRecoverySerial++
	recoverySerial := manager.runtimeFenceRecoverySerial
	manager.runtimeFenceRecoveryCancel = cancel
	manager.runtimeFenceRecoveryClient = client
	manager.runtimeFenceRecoveryMu.Unlock()

	done := make(chan struct{})
	go func() {
		defer close(done)
		manager.runRuntimeFenceRecovery(
			recoveryCtx,
			cancel,
			client,
			"remove-session",
			recoverySerial,
			origin.serial,
		)
	}()

	select {
	case <-beforeApply:
	case <-time.After(time.Second):
		t.Fatal("recovery did not reach the deterministic pre-apply gate")
	}

	terminal := manager.beginFencedProviderLifecycleEvent()
	manager.deactivateInboundConnectionScope(context.Background())
	if !manager.applyProviderLifecycleState(terminal.serial, func() {
		manager.connected = false
		manager.status = "disconnected"
		manager.code = CodeLoggedOut
	}) {
		t.Fatal("session teardown lifecycle could not apply")
	}
	close(allowApply)

	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("cancelled recovery did not settle")
	}
	if manager.IsConnected() {
		t.Fatal("cancelled recovery published connected after session teardown")
	}
	manager.mu.RLock()
	status := manager.status
	code := manager.code
	manager.mu.RUnlock()
	if status != "disconnected" || code != CodeLoggedOut {
		t.Fatalf("cancelled recovery overwrote teardown state status=%q code=%d", status, code)
	}
	if _, ok := manager.currentInboundConnectionScope(); ok {
		t.Fatal("cancelled recovery retained a runtime fence after session teardown")
	}
}

func TestRuntimeFenceRecoveryIsSingleFlightForSameClientAndLifecycle(t *testing.T) {
	client := &whatsmeow.Client{}
	rotationStarted := make(chan struct{})
	rotationDone := make(chan struct{})
	var rotateCalls atomic.Int32
	manager := &WhatsAppManager{
		client:     client,
		runtimeCtx: context.Background(),
		runtimeFenceRecoveryVerify: func(candidate *whatsmeow.Client) bool {
			return candidate == client
		},
		runtimeFenceRecoveryRotate: func(
			ctx context.Context,
			_ *whatsmeow.Client,
			_ string,
		) (whatsAppRuntimeFence, error) {
			if rotateCalls.Add(1) == 1 {
				close(rotationStarted)
				defer close(rotationDone)
			}
			<-ctx.Done()
			return whatsAppRuntimeFence{}, ctx.Err()
		},
	}
	lifecycle := manager.beginProviderLifecycleEvent(false)
	manager.scheduleRuntimeFenceRecovery(client, "single-flight", lifecycle.serial)

	select {
	case <-rotationStarted:
	case <-time.After(time.Second):
		t.Fatal("runtime fence recovery did not start")
	}
	manager.runtimeFenceRecoveryMu.Lock()
	firstSerial := manager.runtimeFenceRecoverySerial
	manager.runtimeFenceRecoveryMu.Unlock()

	manager.scheduleRuntimeFenceRecovery(client, "single-flight-duplicate", lifecycle.serial)
	manager.runtimeFenceRecoveryMu.Lock()
	secondSerial := manager.runtimeFenceRecoverySerial
	manager.runtimeFenceRecoveryMu.Unlock()
	if secondSerial != firstSerial {
		t.Fatalf("duplicate schedule replaced the active recovery serial %d with %d", firstSerial, secondSerial)
	}

	_ = manager.beginFencedProviderLifecycleEvent()
	select {
	case <-rotationDone:
	case <-time.After(time.Second):
		t.Fatal("single-flight recovery did not stop after lifecycle cancellation")
	}
	if rotateCalls.Load() != 1 {
		t.Fatalf("same client/lifecycle started %d recovery flights", rotateCalls.Load())
	}
}

func TestTransientDisconnectDebounceIsCancelledByNewLifecycleEvent(t *testing.T) {
	manager := &WhatsAppManager{}
	disconnected := manager.beginProviderLifecycleEvent(false)
	result := make(chan bool, 1)
	go func() {
		result <- manager.waitForProviderLifecycleDebounce(
			context.Background(),
			disconnected.serial,
			30*time.Millisecond,
		)
	}()

	_ = manager.beginProviderLifecycleEvent(false)
	select {
	case current := <-result:
		if current {
			t.Fatal("stale disconnect survived a newer provider lifecycle event")
		}
	case <-time.After(time.Second):
		t.Fatal("disconnect debounce did not finish")
	}
}

func TestTransientDisconnectDebounceFiresOnlyForCurrentLifecycleEvent(t *testing.T) {
	manager := &WhatsAppManager{}
	disconnected := manager.beginProviderLifecycleEvent(false)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if !manager.waitForProviderLifecycleDebounce(
		ctx,
		disconnected.serial,
		time.Millisecond,
	) {
		t.Fatal("current disconnect was not released after its debounce")
	}
}

func TestAsyncFenceDeactivationRevokesLocalScopeSynchronously(t *testing.T) {
	scope := whatsAppRuntimeFence{
		State:              "active",
		WorkerID:           "worker-1",
		RuntimeGeneration:  7,
		ConnectionEpoch:    "epoch-7",
		ConnectionSequence: 1,
		SourceProvider:     "whatsmeow",
		ActivatedAt:        1_700_000_000_000,
		ActivationOrder:    1,
	}
	manager := &WhatsAppManager{
		cfg:                    Config{WorkerID: scope.WorkerID},
		inboundConnectionScope: &scope,
	}

	if !manager.deactivateCapturedInboundConnectionScopeAsync(&scope) {
		t.Fatal("async deactivation did not capture the current scope")
	}
	if _, ok := manager.currentInboundConnectionScope(); ok {
		t.Fatal("async durable cleanup left the local scope active")
	}
}

func TestInboundCutoffRejectsMessagesFromBeforeConnection(t *testing.T) {
	now := time.Now()
	scope := whatsAppRuntimeFence{
		State:              "active",
		WorkerID:           "worker-1",
		RuntimeGeneration:  7,
		ConnectionEpoch:    "epoch-7",
		ConnectionSequence: 1,
		SourceProvider:     "whatsmeow",
		ActivatedAt:        now.UnixMilli(),
		ActivationOrder:    1,
	}
	manager := &WhatsAppManager{
		cfg: Config{HistoryReconciliationWindow: 6 * time.Hour},
	}

	old := &UpsertMessage{
		Message: map[string]any{"messageTimestamp": now.Add(-time.Second).Unix()},
	}
	if manager.isUpsertWithinConnectionCutoff(old, scope) {
		t.Fatal("message from before connection must be discarded")
	}

	currentSecond := &UpsertMessage{
		Message: map[string]any{"messageTimestamp": now.Unix()},
	}
	if manager.isUpsertWithinConnectionCutoff(currentSecond, scope) {
		t.Fatal("the complete connection start second must be discarded")
	}

	nextSecond := &UpsertMessage{
		Message: map[string]any{"messageTimestamp": now.Add(time.Second).Unix()},
	}
	if !manager.isUpsertWithinConnectionCutoff(nextSecond, scope) {
		t.Fatal("message after the connection start second must be accepted")
	}

	historyWithoutTimestamp := &UpsertMessage{
		FromHistorySync: true,
		Message:         map[string]any{},
	}
	if manager.isUpsertWithinConnectionCutoff(historyWithoutTimestamp, scope) {
		t.Fatal("history event without timestamp must fail closed")
	}

	historyInsideWindow := &UpsertMessage{
		FromHistorySync: true,
		Message: map[string]any{
			"messageTimestamp": now.Add(-2 * time.Hour).Unix(),
		},
	}
	if !manager.isUpsertWithinConnectionCutoff(historyInsideWindow, scope) {
		t.Fatal("history event before the connection but inside the reconciliation window must be accepted")
	}

	historyOutsideWindow := &UpsertMessage{
		FromHistorySync: true,
		Message: map[string]any{
			"messageTimestamp": now.Add(-7 * time.Hour).Unix(),
		},
	}
	if manager.isUpsertWithinConnectionCutoff(historyOutsideWindow, scope) {
		t.Fatal("history event outside the reconciliation window must be discarded")
	}
}

func TestDelayedConnectedReadinessCannotRecreateScopeAfterDisconnect(t *testing.T) {
	scope := whatsAppRuntimeFence{
		State:              "active",
		WorkerID:           "worker-1",
		RuntimeGeneration:  7,
		ConnectionEpoch:    "connected-epoch",
		ConnectionSequence: 1,
		SourceProvider:     "whatsmeow",
		ActivatedAt:        1_700_000_000_000,
		ActivationOrder:    1,
	}
	manager := &WhatsAppManager{
		cfg:                    Config{WorkerID: scope.WorkerID, RuntimeGeneration: scope.RuntimeGeneration},
		inboundConnectionScope: &scope,
	}
	manager.setConsumerBarrierCallbacks(func() bool { return true }, func() {})

	captured := scope
	if !manager.deactivateCapturedInboundConnectionScope(context.Background(), &captured) {
		t.Fatal("disconnect did not revoke the connected scope")
	}
	if _, ok := manager.currentInboundConnectionScope(); ok {
		t.Fatal("disconnect left an active connection scope")
	}

	staleReadyHealth := map[string]any{
		"session_ready":       true,
		"can_send":            true,
		"can_receive_runtime": true,
		"authenticated":       true,
		"provider_state":      "connected",
	}
	if manager.publishConnectedWithHealth(
		context.Background(),
		staleReadyHealth,
		captured,
		"delayed-connected-readiness",
		"",
		false,
	) {
		t.Fatal("stale readiness published the disconnected epoch online")
	}
	if _, ok := manager.currentInboundConnectionScope(); ok {
		t.Fatal("stale readiness recreated a connection scope after disconnect")
	}

	if manager.publishConnectedWithHealth(
		context.Background(),
		map[string]any{"session_ready": false},
		captured,
		"delayed-disconnected-readiness",
		"",
		false,
	) {
		t.Fatal("stale disconnected readiness published a connection state")
	}
	if _, ok := manager.currentInboundConnectionScope(); ok {
		t.Fatal("stale disconnected readiness recreated a connection scope")
	}
}

func TestSourceProviderHandoffFencesDelayedStrongOnlinePublish(t *testing.T) {
	manager := &WhatsAppManager{
		cfg: Config{WorkerID: "worker-1", RuntimeGeneration: 7},
		notifyWorkerStatus: func(context.Context, ConnectionState) error {
			t.Fatal("delayed online state crossed the source handoff fence")
			return nil
		},
	}
	manager.sourceProviderHandoffInProgress.Store(true)
	manager.setConsumerBarrierCallbacks(func() bool { return true }, func() {})

	if manager.publishConnectedWithHealth(
		context.Background(),
		map[string]any{
			"session_ready": true, "can_send": true,
			"can_receive_runtime": true, "authenticated": true,
			"provider_state": "connected",
		},
		whatsAppRuntimeFence{WorkerID: "worker-1", RuntimeGeneration: 7},
		"delayed-central-online-reconcile",
		"5511999999999",
		false,
	) {
		t.Fatal("source handoff allowed delayed online publication")
	}

	err := manager.persistWorkerStatus(context.Background(), ConnectionState{
		WorkerStatusID: WorkerStatusOnline, SessionReady: true,
		CanSend: true, CanReceiveRuntime: true, Authenticated: true,
	})
	if got := safeOperationalErrorCode(err); got != safeCodeHandoffSourceScopeFailed {
		t.Fatalf("delayed persistence code = %q, want %q", got, safeCodeHandoffSourceScopeFailed)
	}
}

func TestKafkaPositioningDoesNotDowngradeAuthenticatedSessionCentrally(t *testing.T) {
	scope := whatsAppRuntimeFence{
		State:              "active",
		WorkerID:           "worker-1",
		RuntimeGeneration:  7,
		ConnectionEpoch:    "connected-epoch",
		ConnectionSequence: 1,
		SourceProvider:     "whatsmeow",
		ActivatedAt:        1_700_000_000_000,
		ActivationOrder:    1,
	}
	rawScope, err := json.Marshal(scope)
	if err != nil {
		t.Fatal(err)
	}
	client, _ := newSelfMonitorRedisClientForTest(t, string(rawScope))
	notifyCalls := 0
	manager := &WhatsAppManager{
		cfg:                    Config{WorkerID: scope.WorkerID, AccountID: "account-1", RuntimeGeneration: scope.RuntimeGeneration},
		redis:                  client,
		inboundConnectionScope: &scope,
		notifyWorkerStatus: func(context.Context, ConnectionState) error {
			notifyCalls++
			return nil
		},
	}
	manager.setConsumerBarrierCallbacks(func() bool { return false }, func() {})

	readyHealth := map[string]any{
		"session_ready":       true,
		"can_send":            true,
		"can_receive_runtime": true,
		"authenticated":       true,
		"provider_state":      "connected",
	}
	if manager.publishConnectedWithHealth(
		context.Background(),
		readyHealth,
		scope,
		"consumer-rebalance",
		"5511999999999",
		false,
	) {
		t.Fatal("positioning consumers published the session online")
	}
	if notifyCalls != 0 {
		t.Fatalf("Kafka positioning downgraded the central worker status: calls=%d", notifyCalls)
	}

	state := ConnectionState{
		Code:           CodeConnectionEstablished,
		Status:         "connected",
		WorkerID:       scope.WorkerID,
		AccountID:      "account-1",
		WorkerTypeID:   WorkerTypeWhatsmeow,
		WorkerStatusID: WorkerStatusOnline,
	}
	manager.enrichReadiness(&state)
	if state.WorkerStatusID != WorkerStatusDisponible ||
		state.Status != "connecting" ||
		state.Reason != "command_ingress_positioning" {
		t.Fatalf("unexpected fail-closed response while positioning: %+v", state)
	}
}

func TestDelayedDisconnectCannotRevokeReplacementConnectionScope(t *testing.T) {
	original := whatsAppRuntimeFence{
		State:              "active",
		WorkerID:           "worker-1",
		RuntimeGeneration:  7,
		ConnectionEpoch:    "epoch-original",
		ConnectionSequence: 1,
		SourceProvider:     "whatsmeow",
		ActivatedAt:        1_700_000_000_000,
		ActivationOrder:    1,
	}
	replacement := original
	replacement.ConnectionEpoch = "epoch-replacement"
	replacement.ConnectionSequence = 2
	replacement.ActivationOrder = 2

	manager := &WhatsAppManager{
		cfg:                    Config{WorkerID: original.WorkerID, RuntimeGeneration: original.RuntimeGeneration},
		inboundConnectionScope: &original,
	}
	delayedDisconnect := manager.beginProviderLifecycleEvent(true)
	_ = manager.beginProviderLifecycleEvent(false)
	manager.mu.Lock()
	manager.inboundConnectionScope = &replacement
	manager.mu.Unlock()

	if delayedDisconnect.capturedScope == nil {
		t.Fatal("disconnect did not capture the scope visible at event entry")
	}
	if manager.deactivateCapturedInboundConnectionScope(
		context.Background(),
		delayedDisconnect.capturedScope,
	) {
		t.Fatal("delayed disconnect revoked the replacement scope")
	}
	if manager.isProviderLifecycleEventCurrent(delayedDisconnect.serial) {
		t.Fatal("delayed disconnect remained causally current")
	}
	current, ok := manager.currentInboundConnectionScope()
	if !ok || current != replacement {
		t.Fatalf("replacement scope was not preserved: %#v", current)
	}
}

func TestDisconnectDuringConnectedActivationSupersedesLateScope(t *testing.T) {
	manager := &WhatsAppManager{}
	connecting := manager.beginProviderLifecycleEvent(false)
	disconnect := manager.beginProviderLifecycleEvent(true)
	if disconnect.capturedScope != nil {
		t.Fatal("disconnect unexpectedly captured a not-yet-active scope")
	}

	lateScope := whatsAppRuntimeFence{
		State:              "active",
		WorkerID:           "worker-1",
		RuntimeGeneration:  7,
		ConnectionEpoch:    "late-connected-epoch",
		ConnectionSequence: 1,
		SourceProvider:     "whatsmeow",
		ActivatedAt:        1_700_000_000_000,
		ActivationOrder:    1,
	}
	manager.mu.Lock()
	manager.inboundConnectionScope = &lateScope
	manager.mu.Unlock()

	if manager.applyProviderLifecycleState(connecting.serial, func() {
		manager.connected = true
	}) {
		t.Fatal("connected event survived a newer disconnect")
	}
	if !manager.deactivateCapturedInboundConnectionScope(
		context.Background(),
		&lateScope,
	) {
		t.Fatal("late connected scope was not cleaned up")
	}
	if _, ok := manager.currentInboundConnectionScope(); ok {
		t.Fatal("late connected scope survived the disconnect")
	}
	if !manager.isProviderLifecycleEventCurrent(disconnect.serial) {
		t.Fatal("disconnect lost causal ownership")
	}
}

func TestChatFollowUpKafkaKeysPreserveEntityOrdering(t *testing.T) {
	if got, want := outboundUpdateKafkaKey("account-1", "worker-1", "message-1"), "account-1:worker-1:message-1"; got != want {
		t.Fatalf("unexpected update.message key %q want %q", got, want)
	}
	if got, want := scheduleStatusKafkaKey("schedule-1", "contact-1", "message-1"), "schedule-1:contact-1:message-1"; got != want {
		t.Fatalf("unexpected schedule.status.update key %q want %q", got, want)
	}
}

func TestRevokedRuntimeFenceStopsPostProviderRetryImmediately(t *testing.T) {
	attempts := 0
	err := retryOutboundPostProviderSideEffectWithPolicy(
		context.Background(),
		5,
		0,
		0,
		func(context.Context) error {
			attempts++
			return errWhatsAppRuntimeFenceRevoked
		},
	)
	if !errors.Is(err, errWhatsAppRuntimeFenceRevoked) {
		t.Fatalf("expected revoked runtime fence, got %v", err)
	}
	if attempts != 1 {
		t.Fatalf("revoked runtime retried %d times", attempts)
	}
}
