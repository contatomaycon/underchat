package app

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waCompanionReg"
	"go.mau.fi/whatsmeow/store"
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
	if cfg.SendIdempotencyStaleAfter.String() != "2m0s" {
		t.Fatalf("unexpected stale claim threshold %s", cfg.SendIdempotencyStaleAfter)
	}
	if cfg.OutboundReadyTimeout != time.Minute {
		t.Fatalf("unexpected outbound ready timeout %s", cfg.OutboundReadyTimeout)
	}
	if cfg.SendMaxInFlight != 256 {
		t.Fatalf("unexpected send max in-flight %d", cfg.SendMaxInFlight)
	}
	if cfg.KafkaConsumerMaxInFlight != 32 {
		t.Fatalf("unexpected kafka max in-flight %d", cfg.KafkaConsumerMaxInFlight)
	}
	if cfg.SendQueueTimeout != 5*time.Minute {
		t.Fatalf("unexpected send queue timeout %s", cfg.SendQueueTimeout)
	}
	if cfg.KafkaConsumerStallTimeout != 5*time.Minute {
		t.Fatalf("unexpected kafka consumer stall timeout %s", cfg.KafkaConsumerStallTimeout)
	}
	if cfg.KafkaConsumerStallCheckInterval != 30*time.Second {
		t.Fatalf("unexpected kafka consumer stall check interval %s", cfg.KafkaConsumerStallCheckInterval)
	}
	if cfg.KafkaConsumerMaxStallRestarts != 3 {
		t.Fatalf("unexpected kafka max stall restarts %d", cfg.KafkaConsumerMaxStallRestarts)
	}
	if cfg.ConnectionHealthFailOnKafkaUnhealthy {
		t.Fatal("expected connection health to ignore kafka unhealthy by default")
	}
	if cfg.KafkaSendConsumerIdleRecreateInterval != 0 {
		t.Fatalf("unexpected kafka send idle recreate interval %s", cfg.KafkaSendConsumerIdleRecreateInterval)
	}
	if cfg.KafkaHandlerErrorBackoff != time.Second {
		t.Fatalf("unexpected kafka handler error backoff %s", cfg.KafkaHandlerErrorBackoff)
	}
}

func TestOutboundClaimStaleDetection(t *testing.T) {
	now := time.Date(2026, 6, 8, 22, 0, 0, 0, time.UTC)
	stale, age := shouldReacquireOutboundClaim(outboundSendClaimRecord{
		State:     sendIdempotencyStateInProgress,
		UpdatedAt: now.Add(-3 * time.Minute).Format(time.RFC3339Nano),
	}, now, 2*time.Minute)
	if !stale {
		t.Fatal("expected old in-progress claim to be stale")
	}
	if age != 3*time.Minute {
		t.Fatalf("unexpected claim age %s", age)
	}

	stale, _ = shouldReacquireOutboundClaim(outboundSendClaimRecord{
		State:     sendIdempotencyStateInProgress,
		UpdatedAt: now.Add(-30 * time.Second).Format(time.RFC3339Nano),
	}, now, 2*time.Minute)
	if stale {
		t.Fatal("expected fresh in-progress claim to remain protected")
	}

	stale, _ = shouldReacquireOutboundClaim(outboundSendClaimRecord{
		State:     sendIdempotencyStateSucceeded,
		UpdatedAt: now.Add(-3 * time.Minute).Format(time.RFC3339Nano),
	}, now, 2*time.Minute)
	if stale {
		t.Fatal("expected final claims to remain protected")
	}
}

func TestWorkerSendTopicDetectionIsExact(t *testing.T) {
	if !isWorkerSendTopic("worker.019b7f05-d392-7410-9e58-f3b8e97da892.send.message") {
		t.Fatal("expected direct worker send topic")
	}
	if isWorkerSendTopic("worker.019b7f05-d392-7410-9e58-f3b8e97da892.schedule.send.message") {
		t.Fatal("expected schedule send topic to be excluded")
	}
	if isWorkerSendTopic("worker.019b7f05-d392-7410-9e58-f3b8e97da892.validate.phone") {
		t.Fatal("expected non-send worker topic to be excluded")
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
		state.Unhealthy = true
		state.StallReason = "pending_offset_stall"
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
	if snapshot[0]["unhealthy"] != true {
		t.Fatalf("expected unhealthy true, got %#v", snapshot[0]["unhealthy"])
	}
	if snapshot[0]["stall_reason"] != "pending_offset_stall" {
		t.Fatalf("unexpected stall reason %#v", snapshot[0]["stall_reason"])
	}
	if !client.HasUnhealthyConsumers() {
		t.Fatal("expected unhealthy consumer detection")
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
