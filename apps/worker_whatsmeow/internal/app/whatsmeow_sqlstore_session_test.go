package app

import (
	"bytes"
	"context"
	"testing"
	"time"

	"go.mau.fi/whatsmeow/proto/waAdv"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types"
	waLog "go.mau.fi/whatsmeow/util/log"
)

func TestWhatsmeowDeleteDeviceIsSessionScopedAndRemovesPrivacyTokens(t *testing.T) {
	ctx := context.Background()
	container, err := sqlstore.New(ctx, "sqlite3", "file:delete-device-session-test?mode=memory&cache=shared&_foreign_keys=on", waLog.Noop)
	if err != nil {
		t.Fatal(err)
	}
	defer container.Close()
	if err := container.ValidateSchemaVersion(ctx, sqlstore.SharedSchemaVersion); err != nil {
		t.Fatalf("fresh SQLStore did not reach shared schema v17: %v", err)
	}
	jid, err := types.ParseJID("5511999999999.1:0@s.whatsapp.net")
	if err != nil {
		t.Fatal(err)
	}
	contact, err := types.ParseJID("5511888888888@s.whatsapp.net")
	if err != nil {
		t.Fatal(err)
	}
	device := container.NewDeviceForSession("019f6f00-0000-7000-8000-000000000001", 1)
	device.ID = &jid
	device.Account = &waAdv.ADVSignedDeviceIdentity{
		Details:             []byte{1},
		AccountSignature:    bytes.Repeat([]byte{2}, 64),
		AccountSignatureKey: bytes.Repeat([]byte{3}, 32),
		DeviceSignature:     bytes.Repeat([]byte{4}, 64),
	}
	if err := device.Save(ctx); err != nil {
		t.Fatal(err)
	}
	if err := device.PrivacyTokens.PutPrivacyTokens(ctx, store.PrivacyToken{
		User: contact, Token: []byte("token"), Timestamp: time.Now(),
	}); err != nil {
		t.Fatal(err)
	}

	wrongOwner := &store.Device{ID: &jid, SessionID: "019f6f00-0000-7000-8000-000000000002", RevisionID: 1}
	if err := container.DeleteDevice(ctx, wrongOwner); err != nil {
		t.Fatalf("wrong-session cleanup should be an idempotent no-op: %v", err)
	}
	token, err := device.PrivacyTokens.GetPrivacyToken(ctx, contact)
	if err != nil || token == nil {
		t.Fatalf("wrong-session delete removed privacy token: token=%v error=%v", token, err)
	}
	if err := container.DeleteDevice(ctx, device); err != nil {
		t.Fatal(err)
	}
	if err := container.DeleteDevice(ctx, device); err != nil {
		t.Fatalf("duplicate owned delete must be idempotent: %v", err)
	}
	token, err = device.PrivacyTokens.GetPrivacyToken(ctx, contact)
	if err != nil {
		t.Fatal(err)
	}
	if token != nil {
		t.Fatalf("owned delete left privacy token behind: %+v", token)
	}
}
