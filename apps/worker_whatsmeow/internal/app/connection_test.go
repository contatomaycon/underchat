package app

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

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
	if int(whatsmeowPairClientDesktop) != int(waCompanionReg.DeviceProps_DESKTOP) {
		t.Fatalf("expected pairing client type to match desktop platform id")
	}
}
