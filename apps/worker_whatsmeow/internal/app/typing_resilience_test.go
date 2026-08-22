package app

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"go.mau.fi/whatsmeow/types"
)

type blockingTypingPresence struct {
	started chan struct{}
	once    sync.Once
}

func (p *blockingTypingPresence) SendChatPresence(
	ctx context.Context,
	_ types.JID,
	_ types.ChatPresence,
	_ types.ChatPresenceMedia,
) error {
	p.once.Do(func() { close(p.started) })
	<-ctx.Done()
	return ctx.Err()
}

type contextIgnoringTypingPresence struct {
	started chan struct{}
	release chan struct{}
	once    sync.Once
}

func (p *contextIgnoringTypingPresence) SendChatPresence(
	context.Context,
	types.JID,
	types.ChatPresence,
	types.ChatPresenceMedia,
) error {
	p.once.Do(func() { close(p.started) })
	<-p.release
	return nil
}

type noopTypingPresence struct {
	mu    sync.Mutex
	calls int
}

func (p *noopTypingPresence) SendChatPresence(
	context.Context,
	types.JID,
	types.ChatPresence,
	types.ChatPresenceMedia,
) error {
	p.mu.Lock()
	p.calls++
	p.mu.Unlock()
	return nil
}

type cancelingTypingPresence struct {
	cancel context.CancelFunc
	paused chan struct{}
	once   sync.Once
	mu     sync.Mutex
	states []types.ChatPresence
}

func (p *cancelingTypingPresence) SendChatPresence(
	_ context.Context,
	_ types.JID,
	state types.ChatPresence,
	_ types.ChatPresenceMedia,
) error {
	p.mu.Lock()
	p.states = append(p.states, state)
	p.mu.Unlock()
	if state == types.ChatPresenceComposing {
		p.cancel()
	}
	if state == types.ChatPresencePaused {
		p.once.Do(func() { close(p.paused) })
	}
	return nil
}

func (p *cancelingTypingPresence) snapshot() []types.ChatPresence {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]types.ChatPresence(nil), p.states...)
}

func TestLongTextTypingDeadlineLeavesParentForProvider(t *testing.T) {
	parent := withProviderAuthorizationGuard(
		context.Background(),
		func(context.Context) error { return nil },
	)
	text := strings.Repeat("x", 1810)
	if got := len([]rune(text)); got != 1810 {
		t.Fatalf("invalid long-text fixture length %d", got)
	}
	if estimated := time.Duration(
		float64(estimateTypingDuration(text)) *
			typingSimulationDelayMultiplier(typingSimulationDefaultSpeed),
	); estimated <= defaultSendQueueTimeout {
		t.Fatalf("long-text fixture unexpectedly fits old handler budget: %s", estimated)
	}
	presence := &noopTypingPresence{}

	err := runTypingSimulationBestEffort(
		parent,
		20*time.Millisecond,
		0,
		func(typingCtx context.Context) error {
			return simulateHumanTyping(
				typingCtx,
				presence,
				types.NewJID("5511999999999", types.DefaultUserServer),
				text,
				typingSimulationDefaultSpeed,
			)
		},
	)
	if !errors.Is(err, errTypingSimulationLocalDeadline) {
		t.Fatalf("1810-character typing did not stop at its local cap: %v", err)
	}
	if parent.Err() != nil {
		t.Fatalf("typing canceled its parent send context: %v", parent.Err())
	}

	boundaryCalls := 0
	providerCalls := 0
	_, err = invokeProviderCallAtBoundary(
		parent,
		func(context.Context) error {
			boundaryCalls++
			return nil
		},
		func(context.Context) (string, error) {
			providerCalls++
			return "sent", nil
		},
	)
	if err != nil {
		t.Fatalf("provider call after local typing cap failed: %v", err)
	}
	if boundaryCalls != 1 || providerCalls != 1 {
		t.Fatalf("expected one boundary/provider call, got boundary=%d provider=%d", boundaryCalls, providerCalls)
	}
}

func TestTypingMaxDelayCompatibilityAndProviderReserve(t *testing.T) {
	if got := resolveTypingSimulationMaxDelay(""); got != 15*time.Second {
		t.Fatalf("unexpected default typing cap %s", got)
	}
	if got := resolveTypingSimulationMaxDelay("15000"); got != 15*time.Second {
		t.Fatalf("millisecond compatibility failed: %s", got)
	}
	if got := resolveTypingSimulationMaxDelay("100ms"); got != time.Second {
		t.Fatalf("minimum typing cap was not enforced: %s", got)
	}
	if got := resolveTypingSimulationMaxDelay("120000"); got != 60*time.Second {
		t.Fatalf("maximum typing cap was not enforced: %s", got)
	}

	parent, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	budget := typingSimulationBudget(parent, time.Second, 80*time.Millisecond)
	if budget <= 0 || budget > 25*time.Millisecond {
		t.Fatalf("typing budget did not reserve provider time: %s", budget)
	}
}

func TestStuckPresenceIsBoundedWithoutCancelingParent(t *testing.T) {
	parent := context.Background()
	presence := &blockingTypingPresence{started: make(chan struct{})}
	startedAt := time.Now()
	err := runTypingSimulationBestEffort(
		parent,
		25*time.Millisecond,
		0,
		func(typingCtx context.Context) error {
			return presence.SendChatPresence(
				typingCtx,
				types.NewJID("5511999999999", types.DefaultUserServer),
				types.ChatPresenceComposing,
				types.ChatPresenceMediaText,
			)
		},
	)
	if !errors.Is(err, errTypingSimulationLocalDeadline) {
		t.Fatalf("stuck presence returned %v", err)
	}
	if elapsed := time.Since(startedAt); elapsed > 500*time.Millisecond {
		t.Fatalf("stuck presence exceeded local budget: %s", elapsed)
	}
	if parent.Err() != nil {
		t.Fatalf("stuck presence canceled parent: %v", parent.Err())
	}
}

func TestPresenceIgnoringContextCannotExceedTypingHardCap(t *testing.T) {
	parent := context.Background()
	presence := &contextIgnoringTypingPresence{
		started: make(chan struct{}),
		release: make(chan struct{}),
	}
	defer close(presence.release)

	startedAt := time.Now()
	err := runTypingSimulationBestEffort(
		parent,
		25*time.Millisecond,
		0,
		func(typingCtx context.Context) error {
			return presence.SendChatPresence(
				typingCtx,
				types.NewJID("5511999999999", types.DefaultUserServer),
				types.ChatPresenceComposing,
				types.ChatPresenceMediaText,
			)
		},
	)
	if !errors.Is(err, errTypingSimulationLocalDeadline) {
		t.Fatalf("context-ignoring presence returned %v", err)
	}
	select {
	case <-presence.started:
	default:
		t.Fatal("context-ignoring presence callback was not invoked")
	}
	if elapsed := time.Since(startedAt); elapsed > 500*time.Millisecond {
		t.Fatalf("context-ignoring presence exceeded hard cap and grace: %s", elapsed)
	}
	if parent.Err() != nil {
		t.Fatalf("context-ignoring presence canceled parent: %v", parent.Err())
	}
}

func TestConfigLookupIgnoringContextCannotExceedTypingHardCap(t *testing.T) {
	parent := context.Background()
	configStarted := make(chan struct{})
	configRelease := make(chan struct{})
	defer close(configRelease)

	startedAt := time.Now()
	err := runTypingSimulationBestEffort(
		parent,
		25*time.Millisecond,
		0,
		func(context.Context) error {
			close(configStarted)
			// Models a Redis/gRPC configuration dependency that accepts a
			// context but never observes its cancellation.
			<-configRelease
			return nil
		},
	)
	if !errors.Is(err, errTypingSimulationLocalDeadline) {
		t.Fatalf("context-ignoring config lookup returned %v", err)
	}
	select {
	case <-configStarted:
	default:
		t.Fatal("context-ignoring config callback was not invoked")
	}
	if elapsed := time.Since(startedAt); elapsed > 500*time.Millisecond {
		t.Fatalf("context-ignoring config lookup exceeded hard cap and grace: %s", elapsed)
	}
	if parent.Err() != nil {
		t.Fatalf("context-ignoring config lookup canceled parent: %v", parent.Err())
	}
}

func TestCanceledTypingClearsComposingWithFencedDetachedContext(t *testing.T) {
	typingCtx, cancel := context.WithCancel(context.Background())
	presence := &cancelingTypingPresence{
		cancel: cancel,
		paused: make(chan struct{}),
	}
	authorizationCalls := 0
	typingCtx = withProviderAuthorizationGuard(typingCtx, func(callCtx context.Context) error {
		authorizationCalls++
		if callCtx.Err() != nil {
			t.Fatalf("detached presence cleanup inherited cancellation: %v", callCtx.Err())
		}
		return nil
	})

	err := simulateHumanTyping(
		typingCtx,
		presence,
		types.NewJID("5511999999999", types.DefaultUserServer),
		strings.Repeat("x", 1810),
		typingSimulationDefaultSpeed,
	)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected canceled typing simulation, got %v", err)
	}
	select {
	case <-presence.paused:
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for detached paused cleanup")
	}
	states := presence.snapshot()
	if len(states) < 2 ||
		states[0] != types.ChatPresenceComposing ||
		states[len(states)-1] != types.ChatPresencePaused {
		t.Fatalf("typing left orphan composing presence: %#v", states)
	}
	if authorizationCalls < 2 {
		t.Fatalf("cleanup bypassed provider authorization: calls=%d", authorizationCalls)
	}
}

func TestTypingCleanupDoesNotCrossRevokedRuntimeFence(t *testing.T) {
	typingCtx, cancel := context.WithCancel(context.Background())
	presence := &cancelingTypingPresence{
		cancel: cancel,
		paused: make(chan struct{}),
	}
	cleanupChecked := make(chan struct{})
	var guardOnce sync.Once
	authorizationCalls := 0
	typingCtx = withProviderAuthorizationGuard(typingCtx, func(context.Context) error {
		authorizationCalls++
		if authorizationCalls > 1 {
			guardOnce.Do(func() { close(cleanupChecked) })
			return errWhatsAppRuntimeFenceRevoked
		}
		return nil
	})

	err := simulateHumanTyping(
		typingCtx,
		presence,
		types.NewJID("5511999999999", types.DefaultUserServer),
		strings.Repeat("x", 1810),
		typingSimulationDefaultSpeed,
	)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected canceled typing simulation, got %v", err)
	}
	select {
	case <-cleanupChecked:
	case <-time.After(time.Second):
		t.Fatal("detached cleanup did not revalidate runtime fence")
	}
	select {
	case <-presence.paused:
		t.Fatal("paused cleanup crossed a revoked runtime fence")
	default:
	}
	states := presence.snapshot()
	if len(states) != 1 || states[0] != types.ChatPresenceComposing {
		t.Fatalf("unexpected provider calls after fence revocation: %#v", states)
	}
}

func TestCanceledParentNeverCrossesProviderBoundary(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	simulationCalls := 0
	err := runTypingSimulationBestEffort(ctx, time.Second, 0, func(context.Context) error {
		simulationCalls++
		return nil
	})
	if !errors.Is(err, context.Canceled) || simulationCalls != 0 {
		t.Fatalf("canceled parent ran typing callback: err=%v calls=%d", err, simulationCalls)
	}

	boundaryCalls := 0
	providerCalls := 0
	_, err = invokeProviderCallAtBoundary(
		ctx,
		func(context.Context) error {
			boundaryCalls++
			return nil
		},
		func(context.Context) (string, error) {
			providerCalls++
			return "", nil
		},
	)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected parent cancellation, got %v", err)
	}
	if boundaryCalls != 0 || providerCalls != 0 {
		t.Fatalf("canceled parent crossed provider boundary: boundary=%d provider=%d", boundaryCalls, providerCalls)
	}

	manager := &WhatsAppManager{}
	fenceErr := manager.assertCapturedConnectionScope(ctx, whatsAppRuntimeFence{})
	if !errors.Is(fenceErr, context.Canceled) ||
		errors.Is(fenceErr, errWhatsAppRuntimeFenceRevoked) {
		t.Fatalf("local cancellation was misclassified as runtime fence: %v", fenceErr)
	}
}

func TestLocalFailuresDoNotDegradeProviderAndSevenConsumersRecoverAuthorization(t *testing.T) {
	manager := &WhatsAppManager{
		cfg: Config{OutboundFailureReconnectThreshold: 3},
	}
	for attempt := 0; attempt < 3; attempt++ {
		manager.recordOutboundFailureWithInvocation(
			context.Background(),
			ChatMessage{},
			time.Millisecond,
			errTypingSimulationLocalDeadline,
			false,
		)
	}
	manager.recordOutboundFailureWithInvocation(
		context.Background(),
		ChatMessage{},
		time.Millisecond,
		errWhatsAppRuntimeFenceRevoked,
		false,
	)
	manager.mu.RLock()
	failures := manager.consecutiveSendFailures
	degradedReason := manager.degradedReason
	lastError := manager.lastSendErrorAt
	manager.mu.RUnlock()
	if failures != 0 || degradedReason != "" || lastError.IsZero() {
		t.Fatalf(
			"local failures changed provider health: failures=%d degraded=%q last_error=%s",
			failures,
			degradedReason,
			lastError,
		)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	keys := make([]string, 0, 7)
	events := make([]KafkaConsumerLifecycleEvent, 0, 7)
	for index := 0; index < 7; index++ {
		topic := "topic-" + string(rune('a'+index))
		group := "group-" + string(rune('a'+index))
		keys = append(keys, kafkaConsumerHealthKey(topic, group))
		events = append(events, KafkaConsumerLifecycleEvent{
			Topic:   topic,
			GroupID: group,
			Ready:   true,
		})
	}
	barrier := newKafkaConsumerSetBarrier(ctx, keys, nil)
	for _, event := range events {
		barrier.observe(event)
	}
	if !barrier.isReady() {
		t.Fatal("seven-consumer barrier was not ready")
	}

	notifyCalls := 0
	manager.notifyWorkerStatus = func(context.Context, ConnectionState) error {
		notifyCalls++
		if notifyCalls <= 2 {
			return errors.New("temporary balance outage")
		}
		return nil
	}
	manager.setConsumerBarrierCallbacks(barrier.isReady, func() {
		t.Fatal("transient online ACK failure invalidated positioned consumers")
	})
	for attempt := 1; attempt <= 2; attempt++ {
		state := ConnectionState{
			Status:         "connected",
			Code:           CodeConnectionEstablished,
			WorkerStatusID: WorkerStatusOnline,
			SessionReady:   true,
			CanSend:        true,
		}
		authorized := manager.authorizeOnlineState(context.Background(), &state)
		if authorized {
			t.Fatalf("attempt %d authorized without central ACK", attempt)
		}
		if !barrier.isReady() {
			t.Fatalf("attempt %d dismantled seven positioned consumers", attempt)
		}
	}
	if err := manager.persistWorkerStatus(context.Background(), ConnectionState{
		Status:         "connected",
		Code:           CodeConnectionEstablished,
		WorkerStatusID: WorkerStatusOnline,
		SessionReady:   true,
		CanSend:        true,
	}); err != nil {
		t.Fatalf("central ACK did not recover: %v", err)
	}
	if !barrier.isReady() {
		t.Fatal("central ACK recovery did not preserve seven positioned consumers")
	}
	if notifyCalls != 3 {
		t.Fatalf("unexpected central authorization attempts: %d", notifyCalls)
	}
	if got := consumerOnlineAuthorizationRetryBackoff(1); got != time.Second {
		t.Fatalf("unexpected initial authorization retry delay %s", got)
	}
	if got := consumerOnlineAuthorizationRetryBackoff(10); got != 30*time.Second {
		t.Fatalf("authorization retry was not capped: %s", got)
	}
}

func TestCommandIngressGenerationRestartsOnlyForPersistentTerminalReadiness(t *testing.T) {
	t.Parallel()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	const topic = "uc.worker.command.worker-1"
	const durable = "uc_worker_test"
	barrier := newKafkaConsumerSetBarrier(
		ctx,
		[]string{kafkaConsumerHealthKey(topic, durable)},
		nil,
	)
	barrier.observe(KafkaConsumerLifecycleEvent{
		Topic: topic, GroupID: durable, Ready: true,
	})

	if shouldRestartCommandIngressGeneration(true, barrier) {
		t.Fatal("a ready generation was selected for restart")
	}
	if shouldRestartCommandIngressGeneration(false, barrier) {
		t.Fatal("a coalesced stale false event restarted an already-ready generation")
	}

	barrier.observe(KafkaConsumerLifecycleEvent{
		Topic: topic, GroupID: durable, Ready: false,
	})
	if !shouldRestartCommandIngressGeneration(false, barrier) {
		t.Fatal("a terminal pull generation was not selected for restart")
	}
	if !shouldRestartCommandIngressGeneration(false, nil) {
		t.Fatal("a missing lifecycle barrier was not selected for restart")
	}
}

func TestSevenConsumerAssignmentsSurviveTransientProviderAndFenceFailuresInPlace(t *testing.T) {
	t.Parallel()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	keys := make([]string, 0, 7)
	events := make([]KafkaConsumerLifecycleEvent, 0, 7)
	for index := 0; index < 7; index++ {
		topic := "topic-" + string(rune('a'+index))
		group := "group-" + string(rune('a'+index))
		keys = append(keys, kafkaConsumerHealthKey(topic, group))
		events = append(events, KafkaConsumerLifecycleEvent{
			Topic:   topic,
			GroupID: group,
			Ready:   true,
		})
	}
	barrier := newKafkaConsumerSetBarrier(ctx, keys, nil)
	for _, event := range events {
		barrier.observe(event)
	}
	if !barrier.isReady() || len(barrier.states) != 7 {
		t.Fatalf(
			"test did not start with seven positioned consumers ready=%t count=%d",
			barrier.isReady(),
			len(barrier.states),
		)
	}

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
	assertDisposition := func(
		name string,
		providerReady bool,
		activeScope whatsAppRuntimeFence,
		activeErr error,
		want kafkaConsumerSetOwnershipDisposition,
	) {
		t.Helper()
		got, _ := evaluateKafkaConsumerSetOwnership(
			true,
			providerReady,
			scope,
			true,
			scope,
			activeScope,
			activeErr,
		)
		if got != want {
			t.Fatalf("%s disposition=%s want=%s", name, got, want)
		}
		if !barrier.isReady() || len(barrier.states) != 7 {
			t.Fatalf(
				"%s dismantled positioned consumers ready=%t count=%d",
				name,
				barrier.isReady(),
				len(barrier.states),
			)
		}
	}

	// A transient provider readiness sample closes dispatch but keeps every
	// assignment positioned, so recovery does not require a seven-group churn.
	assertDisposition(
		"provider temporarily not ready",
		false,
		whatsAppRuntimeFence{},
		errWhatsAppRuntimeFenceRevoked,
		kafkaConsumerSetSuspended,
	)
	// Redis/control-plane loss is not proof that the durable fence was revoked.
	assertDisposition(
		"runtime fence temporarily unavailable",
		true,
		whatsAppRuntimeFence{},
		errors.New("redis temporarily unavailable"),
		kafkaConsumerSetSuspended,
	)
	// The same provider/fence recovers by reopening dispatch over the original
	// seven positioned assignments.
	assertDisposition(
		"same runtime recovered",
		true,
		scope,
		nil,
		kafkaConsumerSetActive,
	)
	// A confirmed durable revocation still tears down the stale generation so
	// a replacement runtime can own the groups safely.
	assertDisposition(
		"durable runtime revoked",
		true,
		whatsAppRuntimeFence{},
		errWhatsAppRuntimeFenceRevoked,
		kafkaConsumerSetStopped,
	)
}

func TestFailedStatusRecoveryCanRetryPublicationWithoutProvider(t *testing.T) {
	scope := whatsAppRuntimeFence{
		State:             "active",
		WorkerID:          "worker-1",
		RuntimeGeneration: 7,
		ConnectionEpoch:   "epoch-1",
		SourceProvider:    "whatsmeow",
	}
	update := newMessageNotSentStatusUpdate(
		scope.WorkerID,
		"account-1",
		scope,
		"message-1",
		"5511999999999@s.whatsapp.net",
	)
	publication, err := newOutboundRecoveryPublication(
		topicUpdateMessageStatus,
		messageStatusKafkaKey("account-1", scope.WorkerID, "message-1"),
		update,
	)
	if err != nil {
		t.Fatal(err)
	}
	recovery := outboundRecoveryRecord{
		SchemaVersion:           outboundRecoverySchemaVersion,
		WorkerID:                scope.WorkerID,
		AccountID:               "account-1",
		ConsumerAssignmentEpoch: 41,
		OriginRuntimeGeneration: scope.RuntimeGeneration,
		OriginConnectionEpoch:   scope.ConnectionEpoch,
		Publications:            []outboundRecoveryPublication{publication},
	}
	if err := validateOutboundRecoveryRecord(recovery); err != nil {
		t.Fatalf("failed-status recovery was rejected: %v", err)
	}

	publishCalls := 0
	worker := &Worker{
		cfg: Config{AccountID: "account-1", WorkerID: scope.WorkerID},
		outboundRecoveryScopeCapturer: func(context.Context) (whatsAppRuntimeFence, error) {
			return scope, nil
		},
		outboundRecoveryPublisher: func(context.Context, outboundRecoveryRecord) error {
			publishCalls++
			if publishCalls == 1 {
				return errors.New("temporary Kafka publication failure")
			}
			return nil
		},
	}
	worker.kafkaConsumerBarrierEpoch.Store(41)
	worker.kafkaConsumersReady.Store(true)
	worker.kafkaConsumersAuthorized.Store(true)

	if err := worker.publishOutboundRecoveryRecord(context.Background(), recovery); err == nil {
		t.Fatal("expected first recovery publication to fail")
	}
	if err := worker.publishOutboundRecoveryRecord(context.Background(), recovery); err != nil {
		t.Fatalf("recovery publication did not recover: %v", err)
	}
	if publishCalls != 2 {
		t.Fatalf("unexpected recovery publish calls: %d", publishCalls)
	}
	if update.TerminalFailureSchema != messageSendTerminalFailureRecoverySchema ||
		len(update.Patch) != 0 ||
		update.InternalMessageID != update.MessageID {
		t.Fatalf("unsafe terminal failure recovery payload: %#v", update)
	}
	if !strings.Contains(
		transitionOutboundSendScript,
		"next_state == 'succeeded' or next_state == 'failed'",
	) {
		t.Fatal("failed ledger transition cannot retain durable recovery payload")
	}
}

func TestTypingSimulationNeverReturningCallbacksAreBoundedPerWorker(t *testing.T) {
	t.Parallel()

	const limit = 2
	limiter := newTypingSimulationLimiter(limit)
	releaseCallbacks := make(chan struct{})
	started := make(chan struct{}, 32)
	saturated := 0

	for attempt := 0; attempt < 20; attempt++ {
		err := runTypingSimulationBestEffortWithLimiter(
			context.Background(),
			time.Millisecond,
			0,
			limiter,
			func(context.Context) error {
				started <- struct{}{}
				<-releaseCallbacks
				return nil
			},
		)
		switch {
		case errors.Is(err, errTypingSimulationLocalDeadline):
		case errors.Is(err, errTypingSimulationSaturated):
			saturated++
		default:
			t.Fatalf("unexpected typing result at attempt %d: %v", attempt, err)
		}
	}

	if got := len(started); got != limit {
		t.Fatalf("never-returning callbacks started=%d want bounded=%d", got, limit)
	}
	if saturated != 20-limit {
		t.Fatalf("saturated attempts=%d want=%d", saturated, 20-limit)
	}

	close(releaseCallbacks)
	deadline := time.Now().Add(time.Second)
	for len(limiter.slots) != 0 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if got := len(limiter.slots); got != 0 {
		t.Fatalf("typing limiter slots remained occupied after callbacks settled: %d", got)
	}
}

func TestActualProviderTransportErrorsFeedSelfHealingButFencesDoNot(t *testing.T) {
	t.Parallel()

	manager := &WhatsAppManager{cfg: Config{
		OutboundFailureReconnectThreshold: 10,
	}}
	tracker := &providerTransportEffectTracker{}
	ctx := withProviderTransportEffectTracker(context.Background(), tracker)
	transportErr := errors.New("websocket connection reset")
	_, err := invokeProviderAuthorizedCall(
		ctx,
		func(context.Context) error { return nil },
		func(context.Context) (struct{}, error) {
			return struct{}{}, transportErr
		},
	)
	if !errors.Is(err, transportErr) {
		t.Fatalf("provider error changed: %v", err)
	}
	trackedErr, invoked := tracker.failure()
	manager.recordOutboundFailureWithInvocation(
		ctx,
		ChatMessage{},
		time.Millisecond,
		trackedErr,
		invoked,
	)
	manager.recordOutboundFailureWithInvocation(
		ctx,
		ChatMessage{},
		time.Millisecond,
		errWhatsAppRuntimeFenceRevoked,
		true,
	)

	manager.mu.RLock()
	defer manager.mu.RUnlock()
	if manager.consecutiveSendFailures != 1 {
		t.Fatalf(
			"transport/fence classification produced %d provider failures, want 1",
			manager.consecutiveSendFailures,
		)
	}
}
