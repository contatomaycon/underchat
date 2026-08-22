package app

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"go.mau.fi/whatsmeow"
)

func TestAuxiliaryProviderDeadlineFencesRuntimeAndObservesLateResult(t *testing.T) {
	scope := whatsAppRuntimeFence{
		State:              "active",
		WorkerID:           "worker-auxiliary-timeout",
		RuntimeGeneration:  17,
		ConnectionEpoch:    "auxiliary-old-epoch",
		ConnectionSequence: 1,
		SourceProvider:     "whatsmeow",
		ActivatedAt:        time.Now().Add(-time.Minute).UnixMilli(),
		ActivationOrder:    1,
	}
	manager := &WhatsAppManager{
		cfg: Config{
			WorkerID:                         scope.WorkerID,
			OutboundFailureReconnectCooldown: time.Hour,
		},
	}
	manager.mu.Lock()
	captured := scope
	manager.inboundConnectionScope = &captured
	manager.connected = true
	manager.status = "connected"
	manager.code = CodeConnectionEstablished
	manager.mu.Unlock()

	ctx := withInboundConnectionScope(context.Background(), scope)
	ctx = withProviderInvocationTimeout(ctx, 30*time.Millisecond)
	ctx = manager.withAuxiliaryProviderInvocationWatchdog(
		ctx,
		"profile_info:"+scope.WorkerID,
	)

	var providerCalls atomic.Int32
	providerStarted := make(chan struct{})
	releaseProvider := make(chan struct{})
	providerReturned := make(chan struct{})
	startedAt := time.Now()
	_, err := invokeProviderCallAtBoundary(
		ctx,
		func(context.Context) error { return nil },
		func(context.Context) (string, error) {
			providerCalls.Add(1)
			close(providerStarted)
			<-releaseProvider // Deliberately ignores its context.
			close(providerReturned)
			return "late-profile-success", nil
		},
	)
	if !errors.Is(err, errOutboundProviderCallStalled) {
		t.Fatalf("context-ignoring profile call was not timed out: %v", err)
	}
	if elapsed := time.Since(startedAt); elapsed > 500*time.Millisecond {
		t.Fatalf("profile call exceeded its hard application deadline: %s", elapsed)
	}
	select {
	case <-providerStarted:
	default:
		t.Fatal("profile provider call was not invoked")
	}
	if got := providerCalls.Load(); got != 1 {
		t.Fatalf("profile provider call count=%d, want 1", got)
	}
	if !manager.isOutboundProviderScopeBlocked(scope) {
		t.Fatal("provider deadline returned before fencing the old runtime")
	}

	deadline := time.Now().Add(time.Second)
	for {
		manager.mu.RLock()
		degradedReason := manager.degradedReason
		reconnectAt := manager.lastOutboundReconnectAt
		manager.mu.RUnlock()
		if manager.isOutboundProviderScopeBlocked(scope) &&
			degradedReason == "outbound_send_stalled" &&
			!reconnectAt.IsZero() {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("auxiliary provider timeout did not fence the old runtime")
		}
		time.Sleep(5 * time.Millisecond)
	}
	manager.mu.RLock()
	degradedReason := manager.degradedReason
	reconnectAt := manager.lastOutboundReconnectAt
	manager.mu.RUnlock()
	if degradedReason != "outbound_send_stalled" || reconnectAt.IsZero() {
		t.Fatalf(
			"auxiliary provider timeout did not force recovery reason=%q reconnect_at=%s",
			degradedReason,
			reconnectAt,
		)
	}

	close(releaseProvider)
	select {
	case <-providerReturned:
	case <-time.After(time.Second):
		t.Fatal("late provider call was not allowed to settle under observation")
	}
	time.Sleep(10 * time.Millisecond)
	if !manager.isOutboundProviderScopeBlocked(scope) {
		t.Fatal("late auxiliary success cleared the old-runtime fence")
	}
	if got := providerCalls.Load(); got != 1 {
		t.Fatalf("late settlement replayed provider call count=%d", got)
	}
}

func TestAuxiliaryProviderWatchdogCreatesFreshFlightPerProfileMutation(t *testing.T) {
	scope := whatsAppRuntimeFence{
		State:              "active",
		WorkerID:           "worker-profile-sequence",
		RuntimeGeneration:  21,
		ConnectionEpoch:    "profile-sequence-epoch",
		ConnectionSequence: 1,
		SourceProvider:     "whatsmeow",
		ActivatedAt:        time.Now().Add(-time.Minute).UnixMilli(),
		ActivationOrder:    1,
	}
	manager := &WhatsAppManager{
		cfg: Config{WorkerID: scope.WorkerID},
	}
	manager.mu.Lock()
	captured := scope
	manager.inboundConnectionScope = &captured
	manager.mu.Unlock()

	ctx := withInboundConnectionScope(context.Background(), scope)
	ctx = withProviderInvocationTimeout(ctx, time.Second)
	ctx = manager.withAuxiliaryProviderInvocationWatchdog(
		ctx,
		"profile_info:"+scope.WorkerID,
	)
	var providerCalls atomic.Int32
	boundary := func(context.Context) error { return nil }
	invoke := func(context.Context) (string, error) {
		providerCalls.Add(1)
		return "ok", nil
	}

	if _, err := invokeProviderCallAtBoundary(ctx, boundary, invoke); err != nil {
		t.Fatalf("first profile mutation failed: %v", err)
	}
	if _, err := invokeProviderCallAtBoundary(ctx, boundary, invoke); err != nil {
		t.Fatalf("second profile mutation reused a settled watchdog: %v", err)
	}
	if got := providerCalls.Load(); got != 2 {
		t.Fatalf("profile mutation provider calls=%d, want 2", got)
	}
}

func TestProviderClientDeadlineRequiresReplacementProcess(t *testing.T) {
	oldClient := &whatsmeow.Client{}
	manager := &WhatsAppManager{
		cfg:    Config{WorkerID: "worker-client-flight"},
		client: oldClient,
	}
	var calls atomic.Int32
	providerStarted := make(chan struct{})
	releaseProvider := make(chan struct{})
	providerReturned := make(chan struct{})

	startedAt := time.Now()
	_, err := invokeWhatsmeowProviderOperationWithDeadline(
		context.Background(),
		manager,
		oldClient,
		"profile_photo:5511999999999",
		25*time.Millisecond,
		func(context.Context) (string, error) {
			calls.Add(1)
			close(providerStarted)
			<-releaseProvider // Deliberately ignores its context.
			close(providerReturned)
			return "", errors.New("late profile rejection")
		},
	)
	if !errors.Is(err, errOutboundProviderCallStalled) {
		t.Fatalf("context-ignoring provider call was not timed out: %v", err)
	}
	if elapsed := time.Since(startedAt); elapsed > 500*time.Millisecond {
		t.Fatalf("provider call exceeded its hard application deadline: %s", elapsed)
	}
	select {
	case <-providerStarted:
	default:
		t.Fatal("provider call did not start")
	}
	if !manager.isProviderClientStalled(oldClient) {
		t.Fatal("old provider client was not fenced synchronously")
	}

	_, err = invokeWhatsmeowProviderOperationWithDeadline(
		context.Background(),
		manager,
		oldClient,
		"profile_photo:5511999999999",
		time.Second,
		func(context.Context) (string, error) {
			calls.Add(1)
			return "unexpected-replay", nil
		},
	)
	if !errors.Is(err, errWhatsmeowProviderClientFenced) {
		t.Fatalf("old provider client accepted another call: %v", err)
	}
	if got := calls.Load(); got != 1 {
		t.Fatalf("old provider call count=%d, want 1", got)
	}

	freshClient := &whatsmeow.Client{}
	_, err = invokeWhatsmeowProviderOperationWithDeadline(
		context.Background(),
		manager,
		freshClient,
		"profile_photo:5511999999999",
		time.Second,
		func(context.Context) (string, error) {
			calls.Add(1)
			return "unexpected-in-process-client", nil
		},
	)
	if !errors.Is(err, errWhatsmeowProviderClientFenced) {
		t.Fatalf("quarantined process admitted a replacement client: %v", err)
	}
	if got := calls.Load(); got != 1 {
		t.Fatalf("replacement client reached provider in quarantined process: %d", got)
	}

	replacementManager := &WhatsAppManager{
		cfg:    Config{WorkerID: "worker-client-flight"},
		client: freshClient,
	}
	result, err := invokeWhatsmeowProviderOperationWithDeadline(
		context.Background(),
		replacementManager,
		freshClient,
		"profile_photo:5511999999999",
		time.Second,
		func(context.Context) (string, error) {
			calls.Add(1)
			return "replacement-process", nil
		},
	)
	if err != nil || result != "replacement-process" {
		t.Fatalf("replacement process result=%q err=%v", result, err)
	}

	close(releaseProvider)
	select {
	case <-providerReturned:
	case <-time.After(time.Second):
		t.Fatal("late provider rejection was not allowed to settle under observation")
	}
	time.Sleep(10 * time.Millisecond)
	if !manager.isProviderClientStalled(oldClient) {
		t.Fatal("late rejection cleared the old provider-client fence")
	}
}

func TestProviderClientOperationSingleFlightTracksRealPromise(t *testing.T) {
	client := &whatsmeow.Client{}
	manager := &WhatsAppManager{cfg: Config{WorkerID: "worker-single-flight"}}
	release := make(chan struct{})
	firstStarted := make(chan struct{})

	firstResult := make(chan error, 1)
	go func() {
		_, err := invokeWhatsmeowProviderOperationWithDeadline(
			context.Background(),
			manager,
			client,
			"validate_phone:5511999999999",
			time.Second,
			func(context.Context) (string, error) {
				close(firstStarted)
				<-release
				return "registered", nil
			},
		)
		firstResult <- err
	}()
	select {
	case <-firstStarted:
	case <-time.After(time.Second):
		t.Fatal("first provider call did not start")
	}

	_, err := invokeWhatsmeowProviderOperationWithDeadline(
		context.Background(),
		manager,
		client,
		"validate_phone:5511999999999",
		time.Second,
		func(context.Context) (string, error) {
			return "duplicate", nil
		},
	)
	if !errors.Is(err, errWhatsmeowProviderCallInFlight) {
		t.Fatalf("concurrent duplicate provider operation was admitted: %v", err)
	}

	close(release)
	select {
	case err := <-firstResult:
		if err != nil {
			t.Fatalf("first provider call failed: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("first provider call did not settle")
	}

	result, err := invokeWhatsmeowProviderOperationWithDeadline(
		context.Background(),
		manager,
		client,
		"validate_phone:5511999999999",
		time.Second,
		func(context.Context) (string, error) {
			return "healthy-follow-up", nil
		},
	)
	if err != nil || result != "healthy-follow-up" {
		t.Fatalf("settled operation did not release slot result=%q err=%v", result, err)
	}
}
