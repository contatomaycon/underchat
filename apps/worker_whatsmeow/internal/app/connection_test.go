package app

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestFreshLoginFallbackIsConsumedOnce(t *testing.T) {
	manager := &WhatsAppManager{}

	manager.armFreshLoginFallback(freshLoginRequest{Type: "phone", Phone: "5511999999999"})

	req, ok := manager.consumeFreshLoginFallback()
	if !ok {
		t.Fatal("expected fallback request")
	}
	if req.Type != "phone" || req.Phone != "5511999999999" {
		t.Fatalf("unexpected fallback request %#v", req)
	}

	if _, ok := manager.consumeFreshLoginFallback(); ok {
		t.Fatal("expected fallback request to be consumed only once")
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
