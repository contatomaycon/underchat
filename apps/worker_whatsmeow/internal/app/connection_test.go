package app

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/segmentio/kafka-go"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waCompanionReg"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types/events"
)

func TestLegacyQRCodeStateUsesStatusOutboxWithoutDirectCentrifugo(t *testing.T) {
	centrifugoCalls := 0
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		centrifugoCalls++
	}))
	defer server.Close()

	persisted := make([]ConnectionState, 0, 2)
	manager := &WhatsAppManager{
		cfg: Config{
			WorkerID:          "worker-legacy",
			AccountID:         "account-legacy",
			RuntimeGeneration: 7,
			SessionStorage:    SessionStorageLegacyVolume,
		},
		centrifugo: &CentrifugoClient{
			url:    server.URL,
			apiKey: "test-key",
			client: server.Client(),
		},
		notifyWorkerStatus: func(_ context.Context, state ConnectionState) error {
			persisted = append(persisted, state)
			return nil
		},
	}
	manager.setConnectionAttemptID("01900000-0000-7000-8000-000000000221")

	manager.publishState(
		context.Background(),
		"connecting",
		CodeAwaitingReadQRCode,
		WorkerStatusDisponible,
		"",
		"private-qr",
		true,
	)

	if len(persisted) != 2 {
		t.Fatalf("status outbox writes = %d, want 2", len(persisted))
	}
	if persisted[0].QRCode != "private-qr" || persisted[0].EventType != "status" {
		t.Fatalf("unexpected persisted QR status: %#v", persisted[0])
	}
	if persisted[1].QRCode != "private-qr" || persisted[1].EventType != "telemetry" ||
		persisted[1].WorkerStatusID != "" || persisted[1].ConnectionStatus != nil ||
		persisted[1].ConnectionStatusSourceID != "" {
		t.Fatalf("unexpected persisted QR credential telemetry: %#v", persisted[1])
	}
	if centrifugoCalls != 0 {
		t.Fatalf("direct Centrifugo status publications = %d, want 0", centrifugoCalls)
	}
}

func TestFreshLoginFallbackIsConsumedOnce(t *testing.T) {
	manager := &WhatsAppManager{}

	manager.armFreshLoginFallback(freshLoginRequest{Type: "qrcode"})

	req, ok := manager.consumeFreshLoginFallback()
	if !ok {
		t.Fatal("expected fallback request")
	}
	if req.Type != "qrcode" {
		t.Fatalf("unexpected fallback request %#v", req)
	}

	if _, ok := manager.consumeFreshLoginFallback(); ok {
		t.Fatal("expected fallback request to be consumed only once")
	}
}

func TestRequestConnectionRejectsPhonePairing(t *testing.T) {
	manager := &WhatsAppManager{
		cfg: Config{
			WorkerID: "worker-1",
		},
	}

	_, err := manager.RequestConnection(context.Background(), StatusConnectionRequest{
		WorkerID:        "worker-1",
		Status:          WorkerStatusOnline,
		Type:            "phone",
		PhoneConnection: "5511999999999",
	})

	if err == nil {
		t.Fatal("expected phone connection to be rejected")
	}
	if !strings.Contains(err.Error(), "phone connection is disabled") {
		t.Fatalf("unexpected error %q", err.Error())
	}
}

func TestOutboundReliabilityConfigDefaults(t *testing.T) {
	t.Setenv("WORKER_ID", "worker-1")
	t.Setenv("ACCOUNT_ID", "account-1")
	t.Setenv("KAFKA_BROKER", "localhost:9092")
	t.Setenv("SECURITY_PROTOCOL", "SSL")
	t.Setenv("WORKER_SEND_TIMEOUT", "")
	t.Setenv("WORKER_PROVIDER_SEND_MAX_IN_FLIGHT", "")
	t.Setenv("TYPING_SIMULATION_MAX_DELAY_MS", "")
	t.Setenv("WORKER_SEND_PROVIDER_RESERVE_MS", "")
	t.Setenv("WORKER_TYPING_MAX_ORPHANS", "")
	t.Setenv("WHATSAPP_RUNTIME_EFFECT_LEASE_TTL_MS", "")
	t.Setenv("WHATSAPP_RUNTIME_EFFECT_LEASE_HEARTBEAT_MS", "")
	t.Setenv("KAFKA_CONSUMER_IDLE_LAG_STALL_MS", "")

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if cfg.OutboundFailureReconnectThreshold != 3 {
		t.Fatalf("unexpected reconnect threshold %d", cfg.OutboundFailureReconnectThreshold)
	}
	if cfg.OutboundFailureReconnectCooldown.String() != "2m0s" {
		t.Fatalf("unexpected reconnect cooldown %s", cfg.OutboundFailureReconnectCooldown)
	}
	if cfg.OutboundReadyTimeout != time.Minute {
		t.Fatalf("unexpected outbound ready timeout %s", cfg.OutboundReadyTimeout)
	}
	if cfg.SendMaxInFlight != 256 {
		t.Fatalf("unexpected send max in-flight %d", cfg.SendMaxInFlight)
	}
	if cfg.ProviderSendMaxInFlight != defaultProviderSendMaxInFlight {
		t.Fatalf("unexpected provider send max in-flight %d", cfg.ProviderSendMaxInFlight)
	}
	if cfg.KafkaConsumerMaxInFlight != 32 {
		t.Fatalf("unexpected kafka max in-flight %d", cfg.KafkaConsumerMaxInFlight)
	}
	if cfg.SendQueueTimeout != 45*time.Second {
		t.Fatalf("unexpected send queue timeout %s", cfg.SendQueueTimeout)
	}
	if cfg.SendTimeout != 45*time.Second {
		t.Fatalf("unexpected provider send timeout %s", cfg.SendTimeout)
	}
	if cfg.TypingSimulationMaxDelay != 15*time.Second {
		t.Fatalf("unexpected typing simulation max delay %s", cfg.TypingSimulationMaxDelay)
	}
	if cfg.TypingSimulationProviderReserve != 20*time.Second {
		t.Fatalf("unexpected typing provider reserve %s", cfg.TypingSimulationProviderReserve)
	}
	if cfg.TypingSimulationMaxOrphans != defaultTypingSimulationMaxOrphans {
		t.Fatalf(
			"unexpected typing orphan limit %d",
			cfg.TypingSimulationMaxOrphans,
		)
	}
	if cfg.RuntimeEffectLeaseTTL != 45*time.Second {
		t.Fatalf("unexpected runtime effect lease TTL %s", cfg.RuntimeEffectLeaseTTL)
	}
	if cfg.RuntimeEffectLeaseHeartbeat != 5*time.Second {
		t.Fatalf("unexpected runtime effect lease heartbeat %s", cfg.RuntimeEffectLeaseHeartbeat)
	}
	if cfg.KafkaConsumerRepairCooldown != 30*time.Second {
		t.Fatalf("unexpected kafka consumer repair cooldown %s", cfg.KafkaConsumerRepairCooldown)
	}
	if cfg.KafkaConsumerMaxLocalRepairs != 3 {
		t.Fatalf("unexpected kafka max local repairs %d", cfg.KafkaConsumerMaxLocalRepairs)
	}
	if cfg.ConnectionHealthFailOnKafkaUnhealthy {
		t.Fatal("expected connection health to ignore kafka unhealthy by default")
	}
	if cfg.DailyMaintenanceHour != 2 {
		t.Fatalf("unexpected daily maintenance hour %d", cfg.DailyMaintenanceHour)
	}
	if cfg.DailyMaintenanceMinute != 0 {
		t.Fatalf("unexpected daily maintenance minute %d", cfg.DailyMaintenanceMinute)
	}
	if cfg.DailyMaintenanceEnabled {
		t.Fatal("daily maintenance must be opt-in")
	}
}

func TestProviderSendMaxInFlightEnvIsOptionalAndSafe(t *testing.T) {
	invalid := "not-an-integer"
	nonPositive := "-5"
	explicit := "17"
	aboveMaximum := "999"
	tests := []struct {
		name string
		raw  *string
		want int
	}{
		{name: "unset uses default", raw: nil, want: defaultProviderSendMaxInFlight},
		{name: "invalid uses default", raw: &invalid, want: defaultProviderSendMaxInFlight},
		{name: "non-positive uses default", raw: &nonPositive, want: defaultProviderSendMaxInFlight},
		{name: "explicit safe value", raw: &explicit, want: 17},
		{name: "above maximum is clamped", raw: &aboveMaximum, want: maxProviderSendMaxInFlight},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Setenv("WORKER_ID", "worker-provider-cap")
			t.Setenv("ACCOUNT_ID", "account-provider-cap")
			t.Setenv("KAFKA_BROKER", "localhost:9092")
			t.Setenv("SECURITY_PROTOCOL", "SSL")
			if test.raw == nil {
				previous, existed := os.LookupEnv("WORKER_PROVIDER_SEND_MAX_IN_FLIGHT")
				if err := os.Unsetenv("WORKER_PROVIDER_SEND_MAX_IN_FLIGHT"); err != nil {
					t.Fatalf("unset provider send cap: %v", err)
				}
				t.Cleanup(func() {
					if existed {
						_ = os.Setenv("WORKER_PROVIDER_SEND_MAX_IN_FLIGHT", previous)
						return
					}
					_ = os.Unsetenv("WORKER_PROVIDER_SEND_MAX_IN_FLIGHT")
				})
			} else {
				t.Setenv("WORKER_PROVIDER_SEND_MAX_IN_FLIGHT", *test.raw)
			}

			cfg, err := LoadConfig()
			if err != nil {
				t.Fatalf(
					"LoadConfig rejected optional WORKER_PROVIDER_SEND_MAX_IN_FLIGHT=%v: %v",
					test.raw,
					err,
				)
			}
			if cfg.ProviderSendMaxInFlight != test.want {
				t.Fatalf(
					"provider send cap for raw=%v is %d, want %d",
					test.raw,
					cfg.ProviderSendMaxInFlight,
					test.want,
				)
			}
		})
	}
}

func TestRuntimeEffectLeaseConfigKeepsSixHeartbeatSafetyMargin(t *testing.T) {
	ttl, heartbeat := normalizeRuntimeEffectLeaseDurations(20*time.Second, 5*time.Second)
	if ttl != 30*time.Second || heartbeat != 5*time.Second {
		t.Fatalf("runtime effect lease normalization = %s/%s, want 30s/5s", ttl, heartbeat)
	}

	ttl, heartbeat = normalizeRuntimeEffectLeaseDurations(0, 0)
	if ttl != defaultRuntimeEffectLeaseTTL ||
		heartbeat != defaultRuntimeEffectLeaseHeartbeat {
		t.Fatalf(
			"runtime effect lease defaults = %s/%s, want %s/%s",
			ttl,
			heartbeat,
			defaultRuntimeEffectLeaseTTL,
			defaultRuntimeEffectLeaseHeartbeat,
		)
	}
}

func TestDailyMaintenanceHourConfigFromEnv(t *testing.T) {
	t.Setenv("WORKER_ID", "worker-1")
	t.Setenv("ACCOUNT_ID", "account-1")
	t.Setenv("KAFKA_BROKER", "localhost:9092")
	t.Setenv("SECURITY_PROTOCOL", "SSL")
	t.Setenv("WORKER_DAILY_MAINTENANCE_HOUR", "13:40")
	t.Setenv("WORKER_DAILY_MAINTENANCE_ENABLED", "true")

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if cfg.DailyMaintenanceHour != 13 {
		t.Fatalf("unexpected daily maintenance hour %d", cfg.DailyMaintenanceHour)
	}
	if cfg.DailyMaintenanceMinute != 40 {
		t.Fatalf("unexpected daily maintenance minute %d", cfg.DailyMaintenanceMinute)
	}
	if !cfg.DailyMaintenanceEnabled {
		t.Fatal("expected explicit daily maintenance opt-in")
	}
}

func TestOutboundIdempotencyV4RetentionAndLease(t *testing.T) {
	wantTTLs := map[string]time.Duration{
		sendIdempotencyStateReserved:  30 * time.Minute,
		sendIdempotencyStateInvoked:   time.Hour,
		sendIdempotencyStateSucceeded: 12 * time.Hour,
		sendIdempotencyStateFailed:    2 * time.Hour,
		sendIdempotencyStateExpired:   2 * time.Hour,
		sendIdempotencyStateAmbiguous: 24 * time.Hour,
	}
	for state, want := range wantTTLs {
		if got, err := sendIdempotencyTTL(state); err != nil || got != want {
			t.Fatalf("idempotency ttl state=%s got=%s want=%s err=%v", state, got, want, err)
		}
	}
	if sendIdempotencyLease != 20*time.Second {
		t.Fatalf("unexpected idempotency lease %s", sendIdempotencyLease)
	}
	if sendIdempotencyProviderLease != 75*time.Second {
		t.Fatalf(
			"unexpected provider invocation lease %s",
			sendIdempotencyProviderLease,
		)
	}
}

func TestConnectedPublicationBarrierDefaultsClosedAndRequiresAllConsumers(t *testing.T) {
	manager := &WhatsAppManager{}
	if manager.isConsumerBarrierReady() {
		t.Fatal("connected publication must fail closed before the worker installs the consumer barrier")
	}

	ready := false
	manager.setConsumerBarrierCallbacks(func() bool { return ready }, func() { ready = false })
	if manager.isConsumerBarrierReady() {
		t.Fatal("connected publication must remain blocked while consumers are positioning")
	}

	ready = true
	if !manager.isConsumerBarrierReady() {
		t.Fatal("connected publication should open only after all consumers are ready")
	}
	manager.invalidateConsumerBarrier()
	if manager.isConsumerBarrierReady() {
		t.Fatal("provider disconnect must close the consumer barrier synchronously")
	}
}

func TestProviderInvalidationRequestsConsumerRestartDuringPositioning(t *testing.T) {
	worker := &Worker{kafkaConsumerRestart: make(chan struct{}, 1)}
	worker.invalidateKafkaConsumerBarrier()
	if worker.kafkaConsumerBarrierEpoch.Load() != 1 {
		t.Fatal("provider invalidation must advance the consumer barrier epoch")
	}
	select {
	case <-worker.kafkaConsumerRestart:
		t.Fatal("inactive consumers must not receive a stale restart request")
	default:
	}

	worker.kafkaConsumersStarted.Store(true)
	worker.invalidateKafkaConsumerBarrier()
	if worker.kafkaConsumerBarrierEpoch.Load() != 2 {
		t.Fatal("each provider invalidation must fence the previous assignment epoch")
	}
	select {
	case <-worker.kafkaConsumerRestart:
	default:
		t.Fatal("provider invalidation must interrupt consumers that are still positioning")
	}
}

func TestOnlineAuthorizationFailureKeepsPositionedConsumersForRetry(t *testing.T) {
	barrierReady := true
	notifyCalls := 0
	manager := &WhatsAppManager{
		cfg: Config{WorkerID: "worker-1", AccountID: "account-1", RuntimeGeneration: 7},
		notifyWorkerStatus: func(_ context.Context, state ConnectionState) error {
			notifyCalls++
			if state.RuntimeGeneration != 7 {
				t.Fatalf("unexpected runtime generation %d", state.RuntimeGeneration)
			}
			return errors.New("failed precondition")
		},
	}
	manager.setConsumerBarrierCallbacks(func() bool { return barrierReady }, func() { barrierReady = false })
	state := ConnectionState{
		Status:            "connected",
		Code:              CodeConnectionEstablished,
		WorkerID:          "worker-1",
		AccountID:         "account-1",
		WorkerTypeID:      WorkerTypeWhatsmeow,
		WorkerStatusID:    WorkerStatusOnline,
		RuntimeGeneration: 7,
		SessionReady:      true,
		CanSend:           true,
	}

	if manager.authorizeOnlineState(context.Background(), &state) {
		t.Fatal("rejected online status must not authorize Kafka handlers")
	}
	if notifyCalls != 1 {
		t.Fatalf("unexpected notify call count %d", notifyCalls)
	}
	if !barrierReady {
		t.Fatal("transient central authorization failure dismantled positioned consumers")
	}
	if state.WorkerStatusID != WorkerStatusDisponible || state.Status != "connecting" || state.CanSend {
		t.Fatalf("rejected state was not downgraded: %#v", state)
	}
	manager.mu.RLock()
	defer manager.mu.RUnlock()
	if manager.degradedReason != "" {
		t.Fatalf("transient central authorization failure degraded provider health: %q", manager.degradedReason)
	}
}

func TestKafkaHandlerWaitsForCentralAuthorization(t *testing.T) {
	worker := &Worker{}
	worker.kafkaConsumersReady.Store(true)
	handled := make(chan struct{}, 1)
	handler := worker.authorizedKafkaHandler(func(context.Context, kafka.Message) error {
		handled <- struct{}{}
		return nil
	})
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	done := make(chan error, 1)
	go func() {
		done <- handler(ctx, kafka.Message{Topic: "worker.w1.send.message", Partition: 0, Offset: 1})
	}()

	select {
	case <-handled:
		t.Fatal("Kafka handler ran before central online authorization")
	case <-time.After(20 * time.Millisecond):
	}
	worker.kafkaConsumersAuthorized.Store(true)
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("authorized handler failed: %v", err)
		}
	case <-ctx.Done():
		t.Fatal("authorized handler did not resume")
	}
}

func TestKafkaHandlerAuthorizationEpochRejectsFalseTrueABA(t *testing.T) {
	worker := &Worker{}
	worker.kafkaConsumerBarrierEpoch.Store(41)
	worker.kafkaConsumersReady.Store(true)
	worker.kafkaConsumersAuthorized.Store(true)

	var captured context.Context
	handler := worker.authorizedKafkaHandler(func(ctx context.Context, _ kafka.Message) error {
		captured = ctx
		return worker.assertKafkaDispatchAuthorized(ctx)
	})
	if err := handler(context.Background(), kafka.Message{Topic: "worker.w1.send.message", Partition: 0, Offset: 1}); err != nil {
		t.Fatalf("capture authorized epoch: %v", err)
	}

	worker.kafkaConsumersReady.Store(false)
	worker.revokeKafkaConsumerAuthorization()
	worker.kafkaConsumersReady.Store(true)
	worker.kafkaConsumersAuthorized.Store(true)

	if got := worker.kafkaConsumerBarrierEpoch.Load(); got != 42 {
		t.Fatalf("authorization revocation did not advance epoch: %d", got)
	}
	if err := worker.assertKafkaDispatchAuthorized(captured); !errors.Is(err, errKafkaConsumerDispatchRevoked) {
		t.Fatalf("old dispatch survived false/true ABA: %v", err)
	}

	if err := handler(context.Background(), kafka.Message{Topic: "worker.w1.send.message", Partition: 0, Offset: 2}); err != nil {
		t.Fatalf("replacement epoch was not dispatchable: %v", err)
	}
}

func TestWaitUntilReadyReturnsTransientNotReady(t *testing.T) {
	manager := &WhatsAppManager{}

	err := manager.WaitUntilReady(context.Background(), time.Millisecond)
	if err == nil {
		t.Fatal("expected readiness wait to fail")
	}
	if !errors.Is(err, ErrWhatsAppNotReady) {
		t.Fatalf("expected ErrWhatsAppNotReady, got %v", err)
	}
}

func TestKeepAliveFailuresAfter515RemainTelemetryUntilNativeTimeBudgetReconnect(t *testing.T) {
	client := whatsmeow.NewClient(&store.Device{}, nil)
	barrierRevocations := 0
	transportConnected := true
	lastSuccess := time.Now().Add(-30 * time.Second)
	manager := &WhatsAppManager{
		cfg: Config{
			WorkerID:                          "worker-post-515",
			RuntimeGeneration:                 2,
			OutboundFailureReconnectThreshold: 3,
		},
		client:    client,
		connected: true,
		status:    "connected",
		code:      CodeConnectionEstablished,
		providerTransportStatusReader: func(*whatsmeow.Client) (bool, bool) {
			return transportConnected, true
		},
		consumerBarrierInvalidate: func() {
			barrierRevocations++
		},
	}

	if !manager.IsReady() {
		t.Fatal("expected provider to be ready before transient keepalive failures")
	}
	for errorCount := 1; errorCount <= 4; errorCount++ {
		manager.recordKeepAliveTimeout(context.Background(), &events.KeepAliveTimeout{
			ErrorCount:  errorCount,
			LastSuccess: lastSuccess,
		})
		if !manager.IsReady() {
			t.Fatalf("transient keepalive failure %d revoked readiness before native time budget", errorCount)
		}
	}

	manager.mu.RLock()
	keepAliveFailures := manager.keepAliveFailures
	lastKeepAliveAt := manager.lastKeepAliveAt
	lastKeepAliveFailureAt := manager.lastKeepAliveFailureAt
	lastOutboundReconnectAt := manager.lastOutboundReconnectAt
	status := manager.status
	code := manager.code
	degradedReason := manager.degradedReason
	manager.mu.RUnlock()

	if keepAliveFailures != 4 {
		t.Fatalf("keepalive telemetry count = %d, want 4", keepAliveFailures)
	}
	if !lastKeepAliveAt.Equal(lastSuccess) {
		t.Fatalf("last successful keepalive = %s, want %s", lastKeepAliveAt, lastSuccess)
	}
	if lastKeepAliveFailureAt.IsZero() {
		t.Fatal("last keepalive failure timestamp was not recorded")
	}
	if !lastOutboundReconnectAt.IsZero() {
		t.Fatalf("manager started a second reconnect authority at %s", lastOutboundReconnectAt)
	}
	if status != "connected" || code != CodeConnectionEstablished || degradedReason != "" {
		t.Fatalf("transient keepalive changed provider state: status=%q code=%d degraded=%q", status, code, degradedReason)
	}
	if barrierRevocations != 0 {
		t.Fatalf("transient keepalive revoked local dispatch %d times", barrierRevocations)
	}
	health := manager.ConnectionHealth()
	if health["keepalive_warning"] != true || health["keepalive_failures"] != 4 {
		t.Fatalf("keepalive telemetry missing from health: %#v", health)
	}
	transportConnected = false
	if manager.IsReady() {
		t.Fatal("definitive socket loss was masked by telemetry-only keepalive handling")
	}
	if reason := manager.outboundReadinessReason(); reason != "client_socket_disconnected" {
		t.Fatalf("definitive socket loss reason = %q, want client_socket_disconnected", reason)
	}
	transportConnected = true

	manager.recordKeepAliveRestored(context.Background())
	if !manager.IsReady() {
		t.Fatal("restored keepalive unexpectedly revoked readiness")
	}
	health = manager.ConnectionHealth()
	if health["keepalive_warning"] != false || health["keepalive_failures"] != 0 {
		t.Fatalf("restored keepalive telemetry was not cleared: %#v", health)
	}
}

func TestKeepAliveRestoreDoesNotClearDefinitiveTransportFailure(t *testing.T) {
	manager := &WhatsAppManager{
		keepAliveFailures: 2,
		degradedReason:    "lease_lost",
	}

	manager.recordKeepAliveRestored(context.Background())

	manager.mu.RLock()
	degradedReason := manager.degradedReason
	keepAliveFailures := manager.keepAliveFailures
	manager.mu.RUnlock()
	if degradedReason != "lease_lost" {
		t.Fatalf("keepalive restore masked definitive failure: %q", degradedReason)
	}
	if keepAliveFailures != 0 {
		t.Fatalf("keepalive restore count = %d, want 0", keepAliveFailures)
	}
}

func TestOutboundSuccessClearsOnlyItsFailureDuringKeepAliveWarning(t *testing.T) {
	manager := &WhatsAppManager{
		keepAliveFailures:       4,
		consecutiveSendFailures: 2,
		degradedReason:          "outbound_send_failed",
	}

	manager.recordOutboundSuccess(
		context.Background(),
		ChatMessage{MessageID: "message-success"},
		time.Millisecond,
		"external-success",
	)

	manager.mu.RLock()
	keepAliveFailures := manager.keepAliveFailures
	consecutiveSendFailures := manager.consecutiveSendFailures
	degradedReason := manager.degradedReason
	lastSendSuccessAt := manager.lastSendSuccessAt
	manager.mu.RUnlock()
	if keepAliveFailures != 4 {
		t.Fatalf("outbound success erased keepalive telemetry: %d", keepAliveFailures)
	}
	if consecutiveSendFailures != 0 || degradedReason != "" {
		t.Fatalf(
			"outbound success did not recover its own failure: failures=%d reason=%q",
			consecutiveSendFailures,
			degradedReason,
		)
	}
	if lastSendSuccessAt.IsZero() {
		t.Fatal("outbound success timestamp was not recorded")
	}
}

func TestOutboundSuccessDoesNotMaskUnrelatedDefinitiveFailure(t *testing.T) {
	for _, degradedReason := range []string{
		"lease_lost",
		"provider_call_stalled",
		"runtime_fence_activation_failed",
		"worker_database_unavailable",
		"logged_out",
		"stream_replaced",
	} {
		t.Run(degradedReason, func(t *testing.T) {
			manager := &WhatsAppManager{
				keepAliveFailures:       4,
				consecutiveSendFailures: 2,
				degradedReason:          degradedReason,
			}

			manager.recordOutboundSuccess(
				context.Background(),
				ChatMessage{MessageID: "late-success"},
				time.Millisecond,
				"external-success",
			)

			manager.mu.RLock()
			gotReason := manager.degradedReason
			manager.mu.RUnlock()
			if gotReason != degradedReason {
				t.Fatalf("outbound success masked %q as %q", degradedReason, gotReason)
			}
		})
	}
}

func TestConnectionHealthReportsDegradedClientMismatch(t *testing.T) {
	manager := &WhatsAppManager{
		cfg:       Config{WorkerID: "worker-1", AccountID: "account-1"},
		connected: true,
		status:    "connected",
		code:      CodeConnectionEstablished,
	}

	health := manager.ConnectionHealth()
	if health["ready"] != false {
		t.Fatalf("expected health not ready, got %#v", health)
	}
	if health["status"] != "degraded" {
		t.Fatalf("expected degraded status, got %#v", health["status"])
	}
	if health["degraded_reason"] != "client_socket_disconnected" {
		t.Fatalf("unexpected degraded reason %#v", health["degraded_reason"])
	}
}

func TestQRCodeReadSessionAllowsFiveUniqueCodes(t *testing.T) {
	manager := &WhatsAppManager{}

	manager.resetQRCodeReadSession(true)

	for attempt, raw := range []string{"qr-1", "qr-2", "qr-3", "qr-4", "qr-5"} {
		gotAttempt, allowed, duplicate := manager.recordQRCodeGeneration(raw)
		if !allowed {
			t.Fatalf("expected qr %q to be allowed", raw)
		}
		if duplicate {
			t.Fatalf("expected qr %q to be counted as unique", raw)
		}
		if gotAttempt != attempt+1 {
			t.Fatalf("expected attempt %d, got %d", attempt+1, gotAttempt)
		}
	}

	gotAttempt, allowed, duplicate := manager.recordQRCodeGeneration("qr-6")
	if allowed {
		t.Fatal("expected sixth unique qr to be rejected")
	}
	if duplicate {
		t.Fatal("expected sixth unique qr to be treated as limit exhaustion")
	}
	if gotAttempt != maxQRCodeGenerations+1 {
		t.Fatalf("expected exhausted attempt %d, got %d", maxQRCodeGenerations+1, gotAttempt)
	}
	if !manager.isQRCodeReadSessionLocked() {
		t.Fatal("expected qr read session to be locked")
	}
}

func TestQRCodeReadSessionIgnoresDuplicateCodes(t *testing.T) {
	manager := &WhatsAppManager{}

	manager.resetQRCodeReadSession(true)

	if attempt, allowed, duplicate := manager.recordQRCodeGeneration("qr-1"); !allowed || duplicate || attempt != 1 {
		t.Fatalf("expected first qr to be attempt 1, got attempt=%d allowed=%t duplicate=%t", attempt, allowed, duplicate)
	}

	if attempt, allowed, duplicate := manager.recordQRCodeGeneration("qr-1"); !allowed || !duplicate || attempt != 1 {
		t.Fatalf("expected duplicate qr to keep attempt 1, got attempt=%d allowed=%t duplicate=%t", attempt, allowed, duplicate)
	}

	if attempt, allowed, duplicate := manager.recordQRCodeGeneration("qr-2"); !allowed || duplicate || attempt != 2 {
		t.Fatalf("expected second unique qr to be attempt 2, got attempt=%d allowed=%t duplicate=%t", attempt, allowed, duplicate)
	}
}

func TestQRCodeReadSessionResetRestartsLimit(t *testing.T) {
	manager := &WhatsAppManager{}

	manager.resetQRCodeReadSession(true)
	for _, raw := range []string{"qr-1", "qr-2", "qr-3", "qr-4", "qr-5", "qr-6"} {
		manager.recordQRCodeGeneration(raw)
	}

	if !manager.isQRCodeReadSessionLocked() {
		t.Fatal("expected qr read session to be locked before reset")
	}

	manager.resetQRCodeReadSession(true)

	attempt, allowed, duplicate := manager.recordQRCodeGeneration("qr-1")
	if !allowed || duplicate || attempt != 1 {
		t.Fatalf("expected reset qr attempt to restart at 1, got attempt=%d allowed=%t duplicate=%t", attempt, allowed, duplicate)
	}
	if manager.isQRCodeReadSessionLocked() {
		t.Fatal("expected reset qr read session to be unlocked")
	}
}

func TestQRCodeReadSessionSupersedesPreviousReaderAndAttempt(t *testing.T) {
	manager := &WhatsAppManager{}
	manager.setConnectionAttemptID("attempt-1")
	firstSerial, firstDone := manager.beginQRCodeReadSession(true)

	if attempt, allowed, duplicate, current := manager.recordQRCodeGenerationForSession(
		firstSerial,
		"attempt-1",
		"qr-1",
	); !current || !allowed || duplicate || attempt != 1 {
		t.Fatalf(
			"expected first reader to own QR attempt 1, got attempt=%d allowed=%t duplicate=%t current=%t",
			attempt,
			allowed,
			duplicate,
			current,
		)
	}

	manager.setConnectionAttemptID("attempt-2")
	secondSerial, secondDone := manager.beginQRCodeReadSession(true)
	select {
	case <-firstDone:
	default:
		t.Fatal("expected the previous QR reader to be cancelled")
	}

	if _, _, _, current := manager.recordQRCodeGenerationForSession(
		firstSerial,
		"attempt-1",
		"stale-qr",
	); current {
		t.Fatal("expected the superseded reader to be rejected")
	}
	if manager.setCurrentQRCodeForSession(firstSerial, "attempt-1", "stale-qr") {
		t.Fatal("expected a superseded reader not to replace the current QR")
	}

	if attempt, allowed, duplicate, current := manager.recordQRCodeGenerationForSession(
		secondSerial,
		"attempt-2",
		"qr-2",
	); !current || !allowed || duplicate || attempt != 1 {
		t.Fatalf(
			"expected replacement reader to restart at attempt 1, got attempt=%d allowed=%t duplicate=%t current=%t",
			attempt,
			allowed,
			duplicate,
			current,
		)
	}
	if !manager.setCurrentQRCodeForSession(secondSerial, "attempt-2", "qr-2") {
		t.Fatal("expected replacement reader to publish its QR")
	}
	if got := manager.getCurrentQRCode(); got != "qr-2" {
		t.Fatalf("expected current QR from replacement reader, got %q", got)
	}

	manager.resetQRCodeReadSession(true)
	select {
	case <-secondDone:
	default:
		t.Fatal("expected reset to cancel the active QR reader")
	}
}

func TestStoredSessionInvalidErrorDetection(t *testing.T) {
	invalidErrors := []error{
		errors.New("logged out from another device"),
		errors.New("invalid use of deleted device"),
		errors.New("primary device was logged out"),
	}
	for _, err := range invalidErrors {
		if !isStoredSessionInvalidError(err) {
			t.Fatalf("expected invalid session error for %q", err)
		}
	}

	if isStoredSessionInvalidError(errors.New("dial tcp timeout")) {
		t.Fatal("network errors should not be treated as invalid session errors")
	}
}

func TestClearLocalSessionFilesRemovesStaleStore(t *testing.T) {
	manager := &WhatsAppManager{
		cfg: Config{
			DataDir:  t.TempDir(),
			WorkerID: "worker-1",
		},
	}

	sessionDir := manager.sessionDir()
	if err := os.MkdirAll(filepath.Join(sessionDir, "stale"), 0o755); err != nil {
		t.Fatalf("create stale dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(sessionDir, "store.db"), []byte("stale"), 0o644); err != nil {
		t.Fatalf("write stale store: %v", err)
	}
	if err := os.WriteFile(filepath.Join(sessionDir, "stale", "file"), []byte("stale"), 0o644); err != nil {
		t.Fatalf("write stale file: %v", err)
	}

	if err := manager.clearLocalSessionFiles(); err != nil {
		t.Fatalf("clear local session files: %v", err)
	}

	if _, err := os.Stat(filepath.Join(sessionDir, "store.db")); !os.IsNotExist(err) {
		t.Fatalf("expected store.db to be removed, got %v", err)
	}
	if _, err := os.Stat(filepath.Join(sessionDir, "stale")); !os.IsNotExist(err) {
		t.Fatalf("expected stale dir to be removed, got %v", err)
	}
	if info, err := os.Stat(sessionDir); err != nil || !info.IsDir() {
		t.Fatalf("expected session dir to be recreated, info=%v err=%v", info, err)
	}
}

func TestLinkedDeviceProfileMatchesBaileysDesktopMacOS(t *testing.T) {
	if got := store.DeviceProps.GetOs(); got != "Mac OS" {
		t.Fatalf("expected linked device OS Mac OS, got %q", got)
	}
	if got := store.DeviceProps.GetPlatformType(); got != waCompanionReg.DeviceProps_DESKTOP {
		t.Fatalf("expected linked device platform DESKTOP, got %s", got.String())
	}
	if got := store.DeviceProps.GetVersion(); got.GetPrimary() != 10 || got.GetSecondary() != 15 || got.GetTertiary() != 7 {
		t.Fatalf("expected linked device version 10.15.7, got %d.%d.%d", got.GetPrimary(), got.GetSecondary(), got.GetTertiary())
	}
	if whatsmeowPairClientDisplayName != "Desktop (Mac OS)" {
		t.Fatalf("unexpected pairing display name %q", whatsmeowPairClientDisplayName)
	}
	if whatsmeowPairClientDesktop != whatsmeow.PairClientElectron {
		t.Fatalf("expected pairing client type to be electron, got %q", whatsmeowPairClientDesktop)
	}
}

func TestSelfMonitorHealthReadyRequiresRuntimeAndKafkaHealth(t *testing.T) {
	health := map[string]any{
		"session_ready":       true,
		"can_send":            true,
		"can_receive_runtime": true,
		"authenticated":       true,
		"phone":               "556192037138",
	}

	if !selfMonitorHealthReady(health, false) {
		t.Fatal("expected strict runtime health to be ready")
	}
	if selfMonitorHealthReady(health, true) {
		t.Fatal("kafka degradation must make self monitor unhealthy")
	}

	health["can_send"] = false
	if selfMonitorHealthReady(health, false) {
		t.Fatal("send capability is required for healthy status")
	}
}

func TestOutboundFailuresOnlyDegradeAfterThreshold(t *testing.T) {
	if outboundFailuresShouldDegrade(1, 3) {
		t.Fatal("single outbound failure should not degrade channel health")
	}
	if outboundFailuresShouldDegrade(2, 3) {
		t.Fatal("transient outbound failures below threshold should not degrade channel health")
	}
	if !outboundFailuresShouldDegrade(3, 3) {
		t.Fatal("persistent outbound failures should degrade channel health")
	}
	if !outboundFailuresShouldDegrade(3, 0) {
		t.Fatal("default threshold should degrade at three failures")
	}
}

func TestSelfMonitorEscalationRules(t *testing.T) {
	waitingForQR := map[string]any{
		"provider_state":      "awaiting_qr",
		"degraded_reason":     "no_session",
		"session_ready":       false,
		"can_send":            false,
		"can_receive_runtime": false,
		"authenticated":       false,
	}
	if selfMonitorShouldEscalate(waitingForQR, false) {
		t.Fatal("waiting for user QR should not recreate the container")
	}
	if selfMonitorShouldEscalate(waitingForQR, true) {
		t.Fatal("kafka startup degradation without an active session must not self-heal")
	}

	notInitialized := map[string]any{
		"provider_state":      "not_initialized",
		"degraded_reason":     "runtime_not_initialized",
		"session_ready":       false,
		"can_send":            false,
		"can_receive_runtime": false,
		"authenticated":       false,
	}
	if selfMonitorShouldEscalate(notInitialized, true) {
		t.Fatal("an uninitialized runtime must not self-heal")
	}

	activeKafkaFailure := map[string]any{
		"provider_state":      "connected",
		"session_ready":       true,
		"can_send":            true,
		"can_receive_runtime": true,
		"authenticated":       true,
		"phone":               "556192037138",
	}
	if !selfMonitorShouldEscalate(activeKafkaFailure, true) {
		t.Fatal("persistent kafka degradation on an active session should self-heal")
	}

	awaitingDispatchAuthorization := map[string]any{
		"provider_state":      "connected",
		"degraded_reason":     "awaiting_dispatch_authorization",
		"session_ready":       false,
		"can_send":            false,
		"can_receive_runtime": false,
		"authenticated":       true,
		"phone":               "556192037138",
	}
	if selfMonitorShouldEscalate(awaitingDispatchAuthorization, false) {
		t.Fatal("bounded dispatch authorization hold must not recreate the runtime early")
	}
	if !selfMonitorShouldEscalate(awaitingDispatchAuthorization, true) {
		t.Fatal("expired dispatch authorization hold must enter Kafka repair")
	}

	staleDisconnected := map[string]any{
		"provider_state":      "disconnected",
		"degraded_reason":     "connection_closed",
		"session_ready":       true,
		"can_send":            false,
		"can_receive_runtime": false,
		"authenticated":       true,
		"phone":               "556192037138",
	}
	if selfMonitorShouldEscalate(staleDisconnected, true) {
		t.Fatal("a disconnected state must win over stale authenticated fields")
	}
}
