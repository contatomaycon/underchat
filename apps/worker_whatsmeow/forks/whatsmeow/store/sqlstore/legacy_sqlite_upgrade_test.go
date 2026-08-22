package sqlstore

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"testing"

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"go.mau.fi/whatsmeow/proto/waAdv"
	"go.mau.fi/whatsmeow/types"
)

func TestUpgradeRecoversExternalLegacySQLiteFixture(t *testing.T) {
	sourcePath := os.Getenv("WHATSMEOW_LEGACY_SQLITE_FIXTURE")
	if sourcePath == "" {
		t.Skip("WHATSMEOW_LEGACY_SQLITE_FIXTURE is not configured")
	}
	source, err := os.Open(sourcePath)
	if err != nil {
		t.Fatalf("open legacy fixture: %v", err)
	}
	defer source.Close()
	destinationPath := filepath.Join(t.TempDir(), "store.db")
	destination, err := os.OpenFile(destinationPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		t.Fatalf("create private fixture copy: %v", err)
	}
	if _, err = io.Copy(destination, source); err != nil {
		_ = destination.Close()
		t.Fatalf("copy legacy fixture: %v", err)
	} else if err = destination.Close(); err != nil {
		t.Fatalf("close legacy fixture copy: %v", err)
	}

	container, err := New(
		context.Background(),
		"sqlite3",
		"file:"+destinationPath+"?_foreign_keys=on",
		nil,
	)
	if err != nil {
		t.Fatalf("upgrade legacy fixture: %v", err)
	}
	defer container.Close()
	device, err := container.GetFirstDevice(context.Background())
	if err != nil {
		t.Fatalf("load upgraded legacy device: %v", err)
	} else if device == nil || device.ID == nil {
		t.Fatal("upgraded legacy fixture lost its paired device identity")
	}
	var canonicalDevices int
	if err = container.db.QueryRow(
		context.Background(),
		"SELECT COUNT(*) FROM whatsapp_device WHERE jid IS NOT NULL",
	).Scan(&canonicalDevices); err != nil {
		t.Fatalf("count upgraded canonical devices: %v", err)
	} else if canonicalDevices != 1 {
		t.Fatalf("unexpected upgraded canonical device count: %d", canonicalDevices)
	}
	legacyCursorExists, err := container.sqliteTableExists(context.Background(), "whatsmeow_version")
	if err != nil {
		t.Fatal(err)
	} else if legacyCursorExists {
		t.Fatal("legacy cursor remained after the fixture upgrade")
	}
}

func TestUpgradeNormalizesEmptyLegacySQLiteADVSecret(t *testing.T) {
	container, ctx := newIsolationTestContainer(t)
	sessionID := uuid.NewString()
	jid := types.NewADJID("5511999999999", 0, 1)
	device := container.NewDeviceForSession(sessionID, 1)
	device.ID = &jid
	device.Account = &waAdv.ADVSignedDeviceIdentity{
		Details:             []byte{1},
		AccountSignature:    make([]byte, 64),
		AccountSignatureKey: make([]byte, 32),
		DeviceSignature:     make([]byte, 64),
	}
	device.AdvSecretKey = nil
	device.AdvSecretAvailable = false
	if err := device.Save(ctx); err != nil {
		t.Fatalf("save canonical public-only device: %v", err)
	}
	if _, err := container.db.Exec(ctx, `
		UPDATE whatsapp_session_revision SET source='legacy_sqlite'
		WHERE session_id=$1 AND revision_id=1
	`, sessionID); err != nil {
		t.Fatalf("mark legacy revision: %v", err)
	}
	if _, err := container.db.Exec(ctx, `PRAGMA ignore_check_constraints=ON`); err != nil {
		t.Fatalf("allow migrated legacy representation: %v", err)
	}
	if _, err := container.db.Exec(ctx, `
		UPDATE whatsapp_device SET adv_key=x'', adv_secret_available=true
		WHERE session_id=$1 AND revision_id=1
	`, sessionID); err != nil {
		t.Fatalf("reproduce legacy empty ADV secret: %v", err)
	}
	if err := container.Upgrade(ctx); err != nil {
		t.Fatalf("repair already-upgraded legacy store: %v", err)
	}
	if _, err := container.db.Exec(ctx, `PRAGMA ignore_check_constraints=OFF`); err != nil {
		t.Fatalf("restore canonical constraints: %v", err)
	}
	restored, err := container.GetDeviceForSession(ctx, sessionID, 1)
	if err != nil {
		t.Fatalf("restore normalized legacy device: %v", err)
	}
	if restored.AdvSecretAvailable || len(restored.AdvSecretKey) != 0 {
		t.Fatal("normalization invented an extractable ADV secret")
	}
}

func TestUpgradeDoesNotNormalizeEmptyCanonicalADVSecret(t *testing.T) {
	container, ctx := newIsolationTestContainer(t)
	sessionID := uuid.NewString()
	jid := types.NewADJID("5511888888888", 0, 1)
	device := container.NewDeviceForSession(sessionID, 1)
	device.ID = &jid
	device.Account = &waAdv.ADVSignedDeviceIdentity{
		Details:             []byte{1},
		AccountSignature:    make([]byte, 64),
		AccountSignatureKey: make([]byte, 32),
		DeviceSignature:     make([]byte, 64),
	}
	device.AdvSecretKey = nil
	device.AdvSecretAvailable = false
	if err := device.Save(ctx); err != nil {
		t.Fatalf("save canonical public-only device: %v", err)
	}
	if _, err := container.db.Exec(ctx, `PRAGMA ignore_check_constraints=ON`); err != nil {
		t.Fatalf("allow corruption fixture: %v", err)
	}
	if _, err := container.db.Exec(ctx, `
		UPDATE whatsapp_device SET adv_key=x'', adv_secret_available=true
		WHERE session_id=$1 AND revision_id=1
	`, sessionID); err != nil {
		t.Fatalf("corrupt canonical ADV secret: %v", err)
	}
	if err := container.Upgrade(ctx); err != nil {
		t.Fatalf("re-run canonical upgrade: %v", err)
	}
	if _, err := container.db.Exec(ctx, `PRAGMA ignore_check_constraints=OFF`); err != nil {
		t.Fatalf("restore canonical constraints: %v", err)
	}
	if restored, err := container.GetDeviceForSession(ctx, sessionID, 1); restored != nil || err == nil {
		t.Fatalf("canonical corruption was hidden: device=%v err=%v", restored != nil, err)
	}
}
