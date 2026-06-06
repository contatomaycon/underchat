package app

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waCompanionReg"
	"go.mau.fi/whatsmeow/store"
	"google.golang.org/grpc/metadata"
)

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

func TestConnectionLifecycleConfigEnvParse(t *testing.T) {
	t.Setenv("WORKER_ID", "worker-1")
	t.Setenv("ACCOUNT_ID", "account-1")
	t.Setenv("KAFKA_BROKER", "localhost:9092")
	t.Setenv("CONNECTION_LIFECYCLE_DEBUG_ENABLED", "true")
	t.Setenv("CONNECTION_LIFECYCLE_DEBUG_VALUE_LIMIT", "123")
	t.Setenv("CONNECTION_LIFECYCLE_DEBUG_RAW_LIMIT", "456")

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if !cfg.ConnectionLifecycleDebugEnabled {
		t.Fatal("expected connection lifecycle debug to be enabled")
	}
	if cfg.ConnectionLifecycleDebugValueLimit != 123 {
		t.Fatalf("unexpected value limit %d", cfg.ConnectionLifecycleDebugValueLimit)
	}
	if cfg.ConnectionLifecycleDebugRawLimit != 456 {
		t.Fatalf("unexpected raw limit %d", cfg.ConnectionLifecycleDebugRawLimit)
	}
}

func TestOutboundReliabilityConfigDefaults(t *testing.T) {
	t.Setenv("WORKER_ID", "worker-1")
	t.Setenv("ACCOUNT_ID", "account-1")
	t.Setenv("KAFKA_BROKER", "localhost:9092")

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
	if cfg.SendIdempotencyInProgressTTL.String() != "10m0s" {
		t.Fatalf("unexpected in-progress ttl %s", cfg.SendIdempotencyInProgressTTL)
	}
	if cfg.SendIdempotencyFinalTTL.String() != "24h0m0s" {
		t.Fatalf("unexpected final ttl %s", cfg.SendIdempotencyFinalTTL)
	}
	if !cfg.MessageLifecycleOutboundSuccessEnabled {
		t.Fatal("expected outbound success lifecycle to be enabled by default")
	}
	if cfg.OutboundReadyTimeout != time.Minute {
		t.Fatalf("unexpected outbound ready timeout %s", cfg.OutboundReadyTimeout)
	}
	if cfg.KafkaSendConsumerIdleRecreateInterval != 0 {
		t.Fatalf("unexpected kafka send idle recreate interval %s", cfg.KafkaSendConsumerIdleRecreateInterval)
	}
	if cfg.KafkaHandlerErrorBackoff != time.Second {
		t.Fatalf("unexpected kafka handler error backoff %s", cfg.KafkaHandlerErrorBackoff)
	}
}

func TestWorkerSendTopicDetectionIsExact(t *testing.T) {
	if !isWorkerSendTopic("worker.019b7f05-d392-7410-9e58-f3b8e97da892.send.message") {
		t.Fatal("expected direct worker send topic")
	}
	if isWorkerSendTopic("worker.019b7f05-d392-7410-9e58-f3b8e97da892.schedule.send.message") {
		t.Fatal("expected schedule send topic to be excluded")
	}
	if isWorkerSendTopic(topicWorkerConnectionQRCode("019b7f05-d392-7410-9e58-f3b8e97da892")) {
		t.Fatal("expected connection QR topic to be excluded")
	}
	if topicWorkerConnectionQRCode("w1") != "worker.w1.connection.qrcode" {
		t.Fatalf("unexpected connection QR topic %s", topicWorkerConnectionQRCode("w1"))
	}
	if isWorkerSendTopic("update.message") {
		t.Fatal("expected global topic to be excluded")
	}
}

func TestKafkaTopicConfigDefaultsToWorkerTopicShape(t *testing.T) {
	config := (KafkaTopicConfig{}).normalized()

	if config.Partitions != 1 {
		t.Fatalf("unexpected partitions %d", config.Partitions)
	}
	if config.ReplicationFactor != 2 {
		t.Fatalf("unexpected replication factor %d", config.ReplicationFactor)
	}
}

func TestKafkaConsumerHealthSnapshotIncludesRegisteredConsumer(t *testing.T) {
	client := &KafkaClient{
		consumers: make(map[string]*kafkaConsumerHealthState),
	}

	state := client.ensureConsumerHealth("worker.w1.send.message", "group-1")
	client.updateConsumerHealth(state, func(state *kafkaConsumerHealthState) {
		state.Connected = true
		state.RestartCount = 2
		state.LastError = "forced"
	})

	snapshot := client.ConsumerHealthSnapshot()
	if len(snapshot) != 1 {
		t.Fatalf("expected one consumer health item, got %d", len(snapshot))
	}
	if snapshot[0]["topic"] != "worker.w1.send.message" {
		t.Fatalf("unexpected topic %#v", snapshot[0]["topic"])
	}
	if snapshot[0]["group_id"] != "group-1" {
		t.Fatalf("unexpected group %#v", snapshot[0]["group_id"])
	}
	if snapshot[0]["connected"] != true {
		t.Fatalf("expected connected true, got %#v", snapshot[0]["connected"])
	}
	if snapshot[0]["restart_count"] != 2 {
		t.Fatalf("expected restart count 2, got %#v", snapshot[0]["restart_count"])
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

func TestLifecycleDebugFiltersOnlyExceptionEvents(t *testing.T) {
	if shouldRecordLifecycleDebugEvent(map[string]any{
		"stage":   "test.success",
		"outcome": "success",
	}) {
		t.Fatal("expected success lifecycle event to be dropped")
	}
	if shouldRecordLifecycleDebugEvent(map[string]any{
		"stage":   "test.published",
		"outcome": "published",
	}) {
		t.Fatal("expected published lifecycle event to be dropped")
	}
	if !shouldRecordLifecycleDebugEvent(map[string]any{
		"stage":   "test.skipped",
		"outcome": "skipped",
	}) {
		t.Fatal("expected skipped lifecycle event to be emitted")
	}
	if !shouldRecordLifecycleDebugEvent(map[string]any{
		"stage":   "test.retrying",
		"outcome": "retrying",
	}) {
		t.Fatal("expected retrying lifecycle event to be emitted")
	}
	if !shouldRecordLifecycleDebugEvent(map[string]any{
		"stage":   "test.error",
		"outcome": "success",
		"level":   "error",
		"error":   "forced error",
	}) {
		t.Fatal("expected explicit error lifecycle event to be emitted")
	}
}

func TestOutboundLifecycleSuccessFilter(t *testing.T) {
	cfg := Config{MessageLifecycleOutboundSuccessEnabled: true}
	if !shouldRecordMessageLifecycleEvent(cfg, map[string]any{
		"stage":   "whatsmeow.outgoing.send.ack.success",
		"outcome": "success",
	}) {
		t.Fatal("expected outbound success event to be emitted")
	}

	cfg.MessageLifecycleOutboundSuccessEnabled = false
	if shouldRecordMessageLifecycleEvent(cfg, map[string]any{
		"stage":   "whatsmeow.outgoing.send.ack.success",
		"outcome": "success",
	}) {
		t.Fatal("expected outbound success event to be dropped when disabled")
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

func TestConnectionLifecyclePayloadRedactsQRCodeAndPairingCode(t *testing.T) {
	cfg := Config{
		AccountID:                          "account-1",
		WorkerID:                           "worker-1",
		ConnectionLifecycleDebugEnabled:    true,
		ConnectionLifecycleDebugValueLimit: 10,
		ConnectionLifecycleDebugRawLimit:   1000,
	}
	ctx := contextWithConnectionLifecycle(context.Background(), connectionLifecycleContext{
		ConnectionLifecycleID: "connection-1",
		AccountID:             "account-1",
		WorkerID:              "worker-1",
		ChannelID:             "worker-1",
		WorkerType:            "whatsmeow",
		SourceProvider:        "whatsmeow",
		ConnectionType:        "qrcode",
		ConnectionAction:      "request_connection",
	})

	payload := normalizeConnectionLifecyclePayload(ctx, cfg, map[string]any{
		"stage":        "test.redaction",
		"decision":     "redact",
		"outcome":      "skipped",
		"qrcode":       "qr-secret-value",
		"pairing_code": "pair-secret-value",
		"raw_payload": map[string]any{
			"qrcode":       "raw-qr-secret",
			"pairing_code": "raw-pair-secret",
		},
	})
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	serialized := string(raw)
	for _, secret := range []string{"qr-secret-value", "pair-secret-value", "raw-qr-secret", "raw-pair-secret"} {
		if strings.Contains(serialized, secret) {
			t.Fatalf("payload leaked secret %q: %s", secret, serialized)
		}
	}
	if payload["has_qr"] != true {
		t.Fatalf("expected has_qr true, got %#v", payload["has_qr"])
	}
	if payload["has_pairing_code"] != true {
		t.Fatalf("expected has_pairing_code true, got %#v", payload["has_pairing_code"])
	}
}

func TestConnectionLifecycleGrpcMetadataPropagation(t *testing.T) {
	cfg := Config{AccountID: "account-1", WorkerID: "worker-1"}
	ctx := metadata.NewIncomingContext(
		context.Background(),
		metadata.Pairs(connectionLifecycleIDHeader, "connection-grpc-1"),
	)

	ctx = extractIncomingConnectionLifecycleContext(ctx, cfg, StatusConnectionRequest{
		WorkerID: "worker-1",
		Status:   WorkerStatusOnline,
		Type:     "qrcode",
	}, "request_connection")

	lifecycle, ok := connectionLifecycleFromContext(ctx)
	if !ok {
		t.Fatal("expected connection lifecycle context")
	}
	if lifecycle.ConnectionLifecycleID != "connection-grpc-1" {
		t.Fatalf("unexpected lifecycle id %q", lifecycle.ConnectionLifecycleID)
	}

	outgoing := injectOutgoingConnectionLifecycleContext(ctx)
	md, ok := metadata.FromOutgoingContext(outgoing)
	if !ok {
		t.Fatal("expected outgoing metadata")
	}
	values := md.Get(connectionLifecycleIDHeader)
	if len(values) != 1 || values[0] != "connection-grpc-1" {
		t.Fatalf("unexpected outgoing lifecycle metadata %#v", values)
	}
}

func TestQRCodeReadSessionAllowsThreeUniqueCodes(t *testing.T) {
	manager := &WhatsAppManager{}

	manager.resetQRCodeReadSession(true)

	for attempt, raw := range []string{"qr-1", "qr-2", "qr-3"} {
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

	gotAttempt, allowed, duplicate := manager.recordQRCodeGeneration("qr-4")
	if allowed {
		t.Fatal("expected fourth unique qr to be rejected")
	}
	if duplicate {
		t.Fatal("expected fourth unique qr to be treated as limit exhaustion")
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
	for _, raw := range []string{"qr-1", "qr-2", "qr-3", "qr-4"} {
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
