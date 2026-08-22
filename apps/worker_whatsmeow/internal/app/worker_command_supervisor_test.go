package app

import (
	"context"
	"encoding/json"
	"sync/atomic"
	"testing"
	"time"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
)

func TestShouldRestartCommandIngressGenerationWhenTerminalLifecycleIsNotReady(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	const (
		subject = "uc.worker.command.worker-1"
		durable = "uc_worker_test"
	)
	barrier := newKafkaConsumerSetBarrier(
		ctx,
		[]string{kafkaConsumerHealthKey(subject, durable)},
		nil,
	)
	barrier.observe(KafkaConsumerLifecycleEvent{
		Topic:   subject,
		GroupID: durable,
		Ready:   true,
	})
	barrier.observe(KafkaConsumerLifecycleEvent{
		Topic:   subject,
		GroupID: durable,
		Ready:   false,
		Reason:  "jetstream_consumer_failed",
	})

	if !shouldRestartCommandIngressGeneration(false, barrier) {
		t.Fatal("terminal JetStream lifecycle did not request a replacement generation")
	}
}

func TestShouldRestartCommandIngressGenerationIgnoresCoalescedStaleFalse(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	const (
		subject = "uc.worker.command.worker-1"
		durable = "uc_worker_test"
	)
	barrier := newKafkaConsumerSetBarrier(
		ctx,
		[]string{kafkaConsumerHealthKey(subject, durable)},
		nil,
	)
	barrier.observe(KafkaConsumerLifecycleEvent{
		Topic:   subject,
		GroupID: durable,
		Ready:   true,
	})

	// allReady=false can be a queued notification from the previous aggregate
	// state. The per-consumer atomic is newer and remains authoritative.
	if shouldRestartCommandIngressGeneration(false, barrier) {
		t.Fatal("stale false notification requested churn of a ready generation")
	}
}

func TestShouldRestartCommandIngressGenerationHandlesMissingBarrierFailClosed(t *testing.T) {
	if !shouldRestartCommandIngressGeneration(false, nil) {
		t.Fatal("missing barrier did not request fail-closed generation replacement")
	}
	if shouldRestartCommandIngressGeneration(true, nil) {
		t.Fatal("ready notification unexpectedly requested generation replacement")
	}
}

func TestCommandIngressHealthUsesJetStreamLifecycleInsteadOfKafkaWriter(t *testing.T) {
	worker := &Worker{
		cfg: Config{WorkerID: "worker-1", RuntimeGeneration: 7},
	}

	if !worker.commandIngressUnhealthy() {
		t.Fatal("active runtime without a JetStream client was reported healthy")
	}
	if got := worker.commandIngressHealth().reason; got != "command_ingress_unavailable" {
		t.Fatalf("unavailable ingress reason=%q", got)
	}

	worker.startWorkerCommandConsumer = func(
		context.Context,
		*Worker,
		KafkaConsumerLifecycleObserver,
	) (KafkaConsumerHandle, error) {
		return KafkaConsumerHandle{}, nil
	}
	if got := worker.commandIngressHealth(); !worker.commandIngressUnhealthy() || got.missing != 1 || got.reason != "command_ingress_not_started" {
		t.Fatalf("not-started ingress health=%+v", got)
	}

	worker.kafkaConsumersStarted.Store(true)
	if got := worker.commandIngressHealth(); !worker.commandIngressUnhealthy() || got.active != 1 || got.unhealthy != 1 || got.reason != "command_ingress_positioning" {
		t.Fatalf("terminal/positioning ingress health=%+v", got)
	}

	worker.kafkaConsumersReady.Store(true)
	if got := worker.commandIngressHealth(); worker.commandIngressUnhealthy() || got.reason != "awaiting_dispatch_authorization" {
		t.Fatalf("positioned durable was treated as transport-unhealthy: %+v", got)
	}

	worker.kafkaConsumersAuthorized.Store(true)
	if got := worker.commandIngressHealth(); worker.commandIngressUnhealthy() || got.reason != "" {
		t.Fatalf("authorized JetStream ingress health=%+v", got)
	}

	worker.cfg.RuntimeGeneration = 0
	if got := worker.commandIngressHealth(); got.expected != 0 || worker.commandIngressUnhealthy() {
		t.Fatalf("warm standby unexpectedly required command ingress: %+v", got)
	}
}

func TestConsumerSupervisorReplacesTerminalJetStreamHandle(t *testing.T) {
	const (
		workerID   = "worker-1"
		accountID  = "account-1"
		generation = 7
	)
	scope := whatsAppRuntimeFence{
		State:              "active",
		WorkerID:           workerID,
		RuntimeGeneration:  generation,
		ConnectionEpoch:    "019ffb50-0bbc-714b-ab45-ffd55db269d7",
		ConnectionSequence: 1,
		SourceProvider:     "whatsmeow",
		ActivatedAt:        time.Now().Add(-time.Minute).UnixMilli(),
		ActivationOrder:    1,
	}
	rawScope, err := json.Marshal(scope)
	if err != nil {
		t.Fatalf("marshal runtime fence: %v", err)
	}
	redisClient, _ := newSelfMonitorRedisClientForTest(t, string(rawScope))

	jid := types.NewJID("5511999999999", types.DefaultUserServer)
	client := whatsmeow.NewClient(&store.Device{ID: &jid}, nil)
	nativeRaw := validNativeConnectionStatus()
	nativeStatus, ok := normalizeNativeConnectionStatus(nativeRaw)
	if !ok {
		t.Fatal("test native ONLINE status is invalid")
	}
	manager := &WhatsAppManager{
		cfg: Config{
			WorkerID:          workerID,
			AccountID:         accountID,
			RuntimeGeneration: generation,
		},
		redis:                redisClient,
		client:               client,
		nativeStatusClient:   client,
		nativeStatusSourceID: "019ffb50-0bbc-714b-ab45-ffd55db269d8",
		nativeStatus:         nativeStatus,
		nativeStatusReader: func(*whatsmeow.Client) events.ConnectionStatus {
			return nativeRaw
		},
		providerTransportStatusReader: func(*whatsmeow.Client) (bool, bool) {
			return true, true
		},
		inboundConnectionScope: &scope,
		connected:              true,
		status:                 "connected",
		code:                   CodeConnectionEstablished,
	}

	var starts atomic.Int32
	var firstGenerationContext atomic.Pointer[context.Context]
	var firstWasCancelledBeforeReplacement atomic.Bool
	secondStarted := make(chan struct{})
	worker := &Worker{
		cfg: Config{
			WorkerID:          workerID,
			AccountID:         accountID,
			RuntimeGeneration: generation,
		},
		whatsapp:             manager,
		kafkaConsumerRestart: make(chan struct{}, 1),
	}
	worker.startWorkerCommandConsumer = func(
		consumerCtx context.Context,
		_ *Worker,
		observer KafkaConsumerLifecycleObserver,
	) (KafkaConsumerHandle, error) {
		generationNumber := starts.Add(1)
		ready := make(chan struct{})
		lifecycle := make(chan KafkaConsumerLifecycleEvent, 2)
		done := make(chan struct{})
		readyEvent := KafkaConsumerLifecycleEvent{
			Topic:        workerCommandSubject(workerID),
			GroupID:      workerCommandDurableName(workerID),
			GenerationID: generationNumber,
			Ready:        true,
			Reason:       "jetstream_pull_bound",
		}
		observer(readyEvent)
		lifecycle <- readyEvent
		close(ready)

		if generationNumber == 1 {
			firstGenerationContext.Store(&consumerCtx)
			terminal := readyEvent
			terminal.Ready = false
			terminal.Reason = "jetstream_consumer_failed"
			observer(terminal)
			lifecycle <- terminal
			close(lifecycle)
			close(done)
		} else {
			first := firstGenerationContext.Load()
			firstWasCancelledBeforeReplacement.Store(
				first != nil && (*first).Err() != nil,
			)
			close(secondStarted)
			go func() {
				<-consumerCtx.Done()
				terminal := readyEvent
				terminal.Ready = false
				terminal.Reason = "jetstream_consumer_stopped"
				observer(terminal)
				lifecycle <- terminal
				close(lifecycle)
				close(done)
			}()
		}
		return KafkaConsumerHandle{Ready: ready, Lifecycle: lifecycle, Done: done}, nil
	}
	manager.setConsumerBarrierCallbacks(func() bool {
		return worker.kafkaConsumersReady.Load()
	}, worker.invalidateKafkaConsumerBarrier)

	ctx, cancel := context.WithCancel(context.Background())
	supervisorDone := make(chan struct{})
	go func() {
		worker.superviseConsumers(ctx)
		close(supervisorDone)
	}()

	select {
	case <-secondStarted:
	case <-time.After(2 * time.Second):
		cancel()
		<-supervisorDone
		t.Fatalf("terminal JetStream generation was not replaced; starts=%d", starts.Load())
	}
	if starts.Load() != 2 {
		t.Fatalf("unexpected generation count before shutdown: %d", starts.Load())
	}
	if !firstWasCancelledBeforeReplacement.Load() {
		t.Fatal("replacement StartConsumer overlapped the terminal generation")
	}

	cancel()
	select {
	case <-supervisorDone:
	case <-time.After(2 * time.Second):
		t.Fatal("consumer supervisor did not stop")
	}
	if worker.kafkaConsumersStarted.Load() || worker.kafkaConsumersReady.Load() || worker.kafkaConsumersAuthorized.Load() {
		t.Fatal("supervisor shutdown left command dispatch open")
	}
}
