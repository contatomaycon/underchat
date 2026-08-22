package sqlstore

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"go.mau.fi/libsignal/ecc"
	"go.mau.fi/libsignal/groups/ratchet"
	grouprecord "go.mau.fi/libsignal/groups/state/record"
	"go.mau.fi/libsignal/keys/chain"
	signalrecord "go.mau.fi/libsignal/state/record"
	"go.mau.fi/util/dbutil"

	"go.mau.fi/whatsmeow/proto/waAdv"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
)

func newIsolationTestContainer(t *testing.T) (*Container, context.Context) {
	t.Helper()
	ctx := context.Background()
	dsn := fmt.Sprintf("file:%s?mode=memory&cache=shared&_foreign_keys=on", uuid.NewString())
	container, err := New(ctx, "sqlite3", dsn, nil)
	if err != nil {
		t.Fatalf("create test container: %v", err)
	}
	container.db.RawDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = container.Close() })
	return container, ctx
}

func TestFreshSchemaUsesOnlyGenericWhatsAppTableNames(t *testing.T) {
	container, ctx := newIsolationTestContainer(t)
	var legacyTables int
	if err := container.db.QueryRow(ctx, `
		SELECT COUNT(*) FROM sqlite_master
		WHERE type='table' AND name LIKE 'whatsmeow_%'
	`).Scan(&legacyTables); err != nil {
		t.Fatal(err)
	}
	if legacyTables != 0 {
		t.Fatalf("fresh store retained %d legacy whatsmeow tables", legacyTables)
	}
	if err := container.ValidateSchemaVersion(ctx, SharedSchemaVersion); err != nil {
		t.Fatal(err)
	}
	var canonicalV17Tables int
	if err := container.db.QueryRow(ctx, `
		SELECT COUNT(*) FROM sqlite_master
		WHERE type='table' AND name IN (
			'whatsapp_provider_record',
			'whatsapp_pq_pre_keys',
			'whatsapp_pq_pre_key_state'
		)
	`).Scan(&canonicalV17Tables); err != nil {
		t.Fatal(err)
	} else if canonicalV17Tables != 3 {
		t.Fatalf("fresh store is missing canonical v17 tables: got %d", canonicalV17Tables)
	}
}

func TestFreshSchemaEnforcesCanonicalPQCodec(t *testing.T) {
	container, ctx := newIsolationTestContainer(t)
	sessionID := uuid.NewString()
	pairedTestDevice(
		t, ctx, container, sessionID, 1,
		types.NewADJID("5511999999970", 0, 1),
	)

	if _, err := container.db.Exec(ctx, `
		INSERT INTO whatsapp_pq_pre_keys (
			session_id, revision_id, key_id, key_kind, public_key,
			private_key, signature, timestamp_ms, sent_to_server
		) VALUES ($1, 1, 7, 'last_resort', $2, $3, $4, 1, true)
	`, sessionID, make([]byte, 1567), make([]byte, 3168), make([]byte, 64)); err == nil {
		t.Fatal("PQ public key with an invalid ML-KEM-1024 length was accepted")
	}

	if _, err := container.db.Exec(ctx, `
		INSERT INTO whatsapp_pq_pre_key_state (
			session_id, revision_id, codec_version, algorithm,
			next_pre_key_id, migrated, last_server_count,
			last_server_count_timestamp_ms
		) VALUES ($1, 1, 1, 'ML-KEM-1024', 8, false, NULL, 1)
	`, sessionID); err == nil {
		t.Fatal("unpaired PQ server count timestamp was accepted")
	}

	if _, err := container.db.Exec(ctx, `
		INSERT INTO whatsapp_pq_pre_keys (
			session_id, revision_id, key_id, key_kind, public_key,
			private_key, signature, timestamp_ms, sent_to_server
		) VALUES ($1, 1, 7, 'last_resort', $2, $3, $4, 1, true)
	`, sessionID, make([]byte, 1568), make([]byte, 3168), make([]byte, 64)); err != nil {
		t.Fatalf("valid canonical PQ material was rejected: %v", err)
	}
	if _, err := container.db.Exec(ctx, `
		INSERT INTO whatsapp_pq_pre_keys (
			session_id, revision_id, key_id, key_kind, public_key,
			private_key, signature, timestamp_ms, sent_to_server
		) VALUES ($1, 1, 8, 'last_resort', $2, $3, $4, 2, true)
	`, sessionID, make([]byte, 1568), make([]byte, 3168), make([]byte, 64)); err == nil {
		t.Fatal("a second last-resort PQ key was accepted in one revision")
	}
}

func TestUnpairedDevicePersistsRoutingInfoBeforeJID(t *testing.T) {
	container, ctx := newIsolationTestContainer(t)
	sessionID := uuid.NewString()
	device := container.NewDeviceForSession(sessionID, 1)
	if device.Transport == nil {
		t.Fatal("unpaired SQL device has no transport store")
	}
	routingInfo := []byte{0x08, 0x01, 0x12, 0x02, 0xaa, 0xbb}
	if err := device.Transport.PutTransportRoutingInfo(ctx, routingInfo); err != nil {
		t.Fatalf("persist pre-pairing routing info: %v", err)
	}
	got, err := device.Transport.GetTransportRoutingInfo(ctx)
	if err != nil || !bytes.Equal(got, routingInfo) {
		t.Fatalf("restore pre-pairing routing info: size=%d err=%v", len(got), err)
	}
	var deviceRows int
	if err := container.db.QueryRow(ctx, `
		SELECT COUNT(*) FROM whatsapp_device
		WHERE session_id=$1 AND revision_id=$2
	`, sessionID, 1).Scan(&deviceRows); err != nil {
		t.Fatal(err)
	} else if deviceRows != 0 {
		t.Fatal("transport persistence fabricated a paired device row")
	}
}

func TestUpgradeRejectsUnsupportedLegacyVersionCursor(t *testing.T) {
	ctx := context.Background()
	dsn := fmt.Sprintf("file:%s?mode=memory&cache=shared&_foreign_keys=on", uuid.NewString())
	rawDB, err := sql.Open("sqlite3", dsn)
	if err != nil {
		t.Fatal(err)
	}
	rawDB.SetMaxOpenConns(1)
	container := NewWithDB(rawDB, "sqlite3", nil)
	t.Cleanup(func() { _ = container.Close() })

	if _, err = rawDB.ExecContext(ctx, `
		CREATE TABLE whatsmeow_version (version INTEGER NOT NULL, compat INTEGER NOT NULL);
		INSERT INTO whatsmeow_version (version, compat) VALUES (999, 999);
		CREATE TABLE whatsmeow_device (jid TEXT);
		INSERT INTO whatsmeow_device (jid) VALUES ('paired-device');
	`); err != nil {
		t.Fatalf("create unsupported legacy fixture: %v", err)
	}

	if err = container.Upgrade(ctx); !errors.Is(err, ErrLegacySQLiteVersionUnsupported) {
		t.Fatalf("unsupported legacy cursor was not rejected: %v", err)
	}
}

func TestPrepareLegacySQLiteUpgradeRepairsStrandedEmptyCanonicalSchema(t *testing.T) {
	container, ctx := newIsolationTestContainer(t)
	if _, err := container.db.Exec(ctx, `
		CREATE TABLE whatsmeow_version (version INTEGER NOT NULL, compat INTEGER NOT NULL);
		INSERT INTO whatsmeow_version (version, compat) VALUES (14, 8);
		CREATE TABLE whatsmeow_device (jid TEXT);
		INSERT INTO whatsmeow_device (jid) VALUES ('paired-device');
	`); err != nil {
		t.Fatalf("create stranded legacy fixture: %v", err)
	}

	if err := container.prepareLegacySQLiteUpgrade(ctx); err != nil {
		t.Fatalf("prepare stranded legacy upgrade: %v", err)
	}
	for _, table := range []string{"whatsapp_session", "whatsapp_session_revision", "whatsapp_device"} {
		exists, err := container.sqliteTableExists(ctx, table)
		if err != nil {
			t.Fatal(err)
		} else if exists {
			t.Fatalf("empty canonical table %s was not retired", table)
		}
	}
	legacyCursorExists, err := container.sqliteTableExists(ctx, "whatsmeow_version")
	if err != nil {
		t.Fatal(err)
	} else if legacyCursorExists {
		t.Fatal("legacy cursor was not adopted")
	}
	version, compat, err := container.readSQLiteVersionCursor(ctx, "whatsapp_store_version")
	if err != nil {
		t.Fatal(err)
	} else if version != 14 || compat != 8 {
		t.Fatalf("unexpected adopted cursor: version=%d compat=%d", version, compat)
	}
	var devices int
	if err = container.db.QueryRow(ctx, "SELECT COUNT(*) FROM whatsmeow_device").Scan(&devices); err != nil {
		t.Fatal(err)
	} else if devices != 1 {
		t.Fatalf("legacy device projection changed: got %d rows", devices)
	}
}

func TestPrepareLegacySQLiteUpgradeRejectsPopulatedCanonicalSchema(t *testing.T) {
	container, ctx := newIsolationTestContainer(t)
	if _, err := container.db.Exec(ctx, `
		CREATE TABLE whatsmeow_version (version INTEGER NOT NULL, compat INTEGER NOT NULL);
		INSERT INTO whatsmeow_version (version, compat) VALUES (14, 8);
		CREATE TABLE whatsmeow_device (jid TEXT);
		INSERT INTO whatsmeow_device (jid) VALUES ('legacy-device');
		INSERT INTO whatsapp_session (
			session_id, provider, state, generation, epoch
		) VALUES (
			'current-session', 'whatsmeow', 'staging', 1,
			'00000000-0000-0000-0000-000000000000'
		);
	`); err != nil {
		t.Fatalf("create ambiguous sqlite fixture: %v", err)
	}

	if err := container.prepareLegacySQLiteUpgrade(ctx); !errors.Is(err, ErrLegacySQLiteSessionAmbiguous) {
		t.Fatalf("ambiguous legacy/current state was not rejected: %v", err)
	}
	var canonicalSessions int
	if err := container.db.QueryRow(ctx, "SELECT COUNT(*) FROM whatsapp_session").Scan(&canonicalSessions); err != nil {
		t.Fatal(err)
	} else if canonicalSessions != 1 {
		t.Fatal("ambiguous canonical state was mutated")
	}
}

func TestPrepareLegacySQLiteUpgradeRepairsStrandedStagingCanonicalSession(t *testing.T) {
	container, ctx := newIsolationTestContainer(t)
	canonicalSessionID := uuid.NewString()
	canonicalJID := types.NewADJID("5511888888888", 0, 1)
	pairedTestDevice(t, ctx, container, canonicalSessionID, 1, canonicalJID)
	if _, err := container.db.Exec(ctx, `
		UPDATE whatsapp_session
		SET state='staging', active_revision_id=NULL, previous_revision_id=NULL
		WHERE session_id=$1
	`, canonicalSessionID); err != nil {
		t.Fatalf("stage stranded canonical session: %v", err)
	}
	if _, err := container.db.Exec(ctx, `
		UPDATE whatsapp_session_revision
		SET status='staging', source=NULL
		WHERE session_id=$1 AND revision_id=1
	`, canonicalSessionID); err != nil {
		t.Fatalf("stage stranded canonical revision: %v", err)
	}
	if _, err := container.db.Exec(ctx, `
		CREATE TABLE whatsmeow_version (
			version INTEGER NOT NULL,
			compat INTEGER NOT NULL
		);
		INSERT INTO whatsmeow_version (version, compat) VALUES (14, 8);
		CREATE TABLE whatsmeow_device (jid TEXT);
		INSERT INTO whatsmeow_device (jid) VALUES ('legacy-device');
	`); err != nil {
		t.Fatalf("create stranded staging canonical fixture: %v", err)
	}

	if err := container.prepareLegacySQLiteUpgrade(ctx); err != nil {
		t.Fatalf("prepare stranded staging canonical upgrade: %v", err)
	}
	for _, table := range []string{"whatsapp_session", "whatsapp_session_revision", "whatsapp_device"} {
		exists, err := container.sqliteTableExists(ctx, table)
		if err != nil {
			t.Fatal(err)
		} else if exists {
			t.Fatalf("stranded canonical table %s was not retired", table)
		}
	}
	legacyCursorExists, err := container.sqliteTableExists(ctx, "whatsmeow_version")
	if err != nil {
		t.Fatal(err)
	} else if legacyCursorExists {
		t.Fatal("legacy cursor was not adopted")
	}
	version, compat, err := container.readSQLiteVersionCursor(ctx, "whatsapp_store_version")
	if err != nil {
		t.Fatal(err)
	} else if version != 14 || compat != 8 {
		t.Fatalf("unexpected adopted cursor: version=%d compat=%d", version, compat)
	}
}

func TestPrepareLegacySQLiteUpgradeRejectsAuthoritativeCanonicalSession(t *testing.T) {
	container, ctx := newIsolationTestContainer(t)
	canonicalSessionID := uuid.NewString()
	canonicalJID := types.NewADJID("5511777777777", 0, 1)
	pairedTestDevice(t, ctx, container, canonicalSessionID, 1, canonicalJID)
	if _, err := container.db.Exec(ctx, `
		UPDATE whatsapp_session
		SET state='ready', active_revision_id=1, previous_revision_id=NULL
		WHERE session_id=$1
	`, canonicalSessionID); err != nil {
		t.Fatalf("activate authoritative canonical session: %v", err)
	}
	if _, err := container.db.Exec(ctx, `
		UPDATE whatsapp_session_revision
		SET status='active', source='legacy_sqlite'
		WHERE session_id=$1 AND revision_id=1
	`, canonicalSessionID); err != nil {
		t.Fatalf("activate authoritative canonical revision: %v", err)
	}
	if _, err := container.db.Exec(ctx, `
		CREATE TABLE whatsmeow_version (
			version INTEGER NOT NULL,
			compat INTEGER NOT NULL
		);
		INSERT INTO whatsmeow_version (version, compat) VALUES (14, 8);
		CREATE TABLE whatsmeow_device (jid TEXT);
		INSERT INTO whatsmeow_device (jid) VALUES ('legacy-device');
	`); err != nil {
		t.Fatalf("create authoritative canonical fixture: %v", err)
	}

	if err := container.prepareLegacySQLiteUpgrade(ctx); !errors.Is(err, ErrLegacySQLiteSessionAmbiguous) {
		t.Fatalf("authoritative canonical session was not rejected: %v", err)
	}
	var canonicalDevices int
	if err := container.db.QueryRow(ctx, "SELECT COUNT(*) FROM whatsapp_device").Scan(&canonicalDevices); err != nil {
		t.Fatal(err)
	} else if canonicalDevices != 1 {
		t.Fatal("ambiguous authoritative canonical session was mutated")
	}
}

func TestPrepareLegacySQLiteUpgradeRejectsPartialCanonicalSchema(t *testing.T) {
	ctx := context.Background()
	dsn := fmt.Sprintf("file:%s?mode=memory&cache=shared&_foreign_keys=on", uuid.NewString())
	rawDB, err := sql.Open("sqlite3", dsn)
	if err != nil {
		t.Fatal(err)
	}
	rawDB.SetMaxOpenConns(1)
	container := NewWithDB(rawDB, "sqlite3", nil)
	t.Cleanup(func() { _ = container.Close() })

	if _, err = rawDB.ExecContext(ctx, `
		CREATE TABLE whatsmeow_version (version INTEGER NOT NULL, compat INTEGER NOT NULL);
		INSERT INTO whatsmeow_version (version, compat) VALUES (14, 8);
		CREATE TABLE whatsmeow_device (jid TEXT);
		INSERT INTO whatsmeow_device (jid) VALUES ('legacy-device');
		CREATE TABLE whatsapp_session (session_id TEXT PRIMARY KEY);
	`); err != nil {
		t.Fatalf("create partial canonical fixture: %v", err)
	}

	if err = container.prepareLegacySQLiteUpgrade(ctx); !errors.Is(err, ErrLegacySQLiteSessionAmbiguous) {
		t.Fatalf("partial canonical schema was not rejected: %v", err)
	}
	legacyCursorExists, err := container.sqliteTableExists(ctx, "whatsmeow_version")
	if err != nil {
		t.Fatal(err)
	} else if !legacyCursorExists {
		t.Fatal("ambiguous partial schema adopted the legacy cursor")
	}
}

func pairedTestDevice(t *testing.T, ctx context.Context, container *Container, sessionID string, revisionID int64, jid types.JID) *store.Device {
	t.Helper()
	device := container.NewDeviceForSession(sessionID, revisionID)
	device.ID = &jid
	device.Account = &waAdv.ADVSignedDeviceIdentity{
		Details:             []byte{1},
		AccountSignature:    make([]byte, 64),
		AccountSignatureKey: make([]byte, 32),
		DeviceSignature:     make([]byte, 64),
	}
	if err := device.Save(ctx); err != nil {
		t.Fatalf("save device %s/%d: %v", sessionID, revisionID, err)
	}
	return device
}

func canonicalTestSignalSession(t *testing.T, marker byte) []byte {
	t.Helper()
	localIdentity := ecc.CreateKeyPair(bytes.Repeat([]byte{marker}, 32))
	remoteIdentity := ecc.CreateKeyPair(bytes.Repeat([]byte{marker + 1}, 32))
	senderBase := ecc.CreateKeyPair(bytes.Repeat([]byte{marker + 2}, 32))
	ratchetKey := ecc.CreateKeyPair(bytes.Repeat([]byte{marker + 3}, 32))
	privateKey := ratchetKey.PrivateKey().Serialize()
	structure := &signalrecord.SessionStructure{SessionState: &signalrecord.StateStructure{
		LocalIdentityPublic:  localIdentity.PublicKey().Serialize(),
		LocalRegistrationID:  7,
		RemoteIdentityPublic: remoteIdentity.PublicKey().Serialize(),
		RemoteRegistrationID: 9,
		RootKey:              bytes.Repeat([]byte{marker + 4}, 32),
		SenderBaseKey:        senderBase.PublicKey().Serialize(),
		SenderChain: &signalrecord.ChainStructure{
			SenderRatchetKeyPublic:  ratchetKey.PublicKey().Serialize(),
			SenderRatchetKeyPrivate: privateKey[:],
			ChainKey: &chain.KeyStructure{
				Index: 1,
				Key:   bytes.Repeat([]byte{marker + 5}, 32),
			},
		},
		SessionVersion: 3,
	}}
	encoded := store.SignalProtobufSerializer.Session.Serialize(structure)
	if _, err := store.NormalizeSignalSessionStorage(encoded); err != nil {
		t.Fatalf("invalid test Signal fixture: %v", err)
	}
	return encoded
}

func canonicalTestSenderKey(t *testing.T, marker byte) []byte {
	t.Helper()
	signingKey := ecc.CreateKeyPair(bytes.Repeat([]byte{marker}, 32))
	privateKey := signingKey.PrivateKey().Serialize()
	structure := &grouprecord.SenderKeyStructure{SenderKeyStates: []*grouprecord.SenderKeyStateStructure{{
		Keys:  []*ratchet.SenderMessageKeyStructure{},
		KeyID: uint32(marker),
		SenderChainKey: &ratchet.SenderChainKeyStructure{
			Iteration: 1,
			ChainKey:  bytes.Repeat([]byte{marker + 1}, 32),
		},
		SigningKeyPublic:  signingKey.PublicKey().Serialize(),
		SigningKeyPrivate: privateKey[:],
	}}}
	encoded := store.SignalProtobufSerializer.SenderKeyRecord.Serialize(structure)
	if _, err := store.NormalizeSenderKeyStorage(encoded); err != nil {
		t.Fatalf("invalid test sender-key fixture: %v", err)
	}
	return encoded
}

func TestSameJIDSessionIsolation(t *testing.T) {
	container, ctx := newIsolationTestContainer(t)
	jid := types.NewADJID("5511999999999", 0, 1)
	sessionA, sessionB := uuid.NewString(), uuid.NewString()
	deviceA := pairedTestDevice(t, ctx, container, sessionA, 1, jid)
	deviceB := pairedTestDevice(t, ctx, container, sessionB, 1, jid)
	if deviceA.DeviceFingerprint == deviceB.DeviceFingerprint {
		t.Fatal("independently paired devices with the same JID must have different fingerprints")
	}
	fingerprintA := deviceA.DeviceFingerprint
	if err := deviceA.Save(ctx); err != nil {
		t.Fatal(err)
	} else if deviceA.DeviceFingerprint != fingerprintA {
		t.Fatal("device fingerprint changed for identical credentials")
	}

	address := "5511888888888:1"
	sessionPayloadA := canonicalTestSignalSession(t, 10)
	sessionPayloadB := canonicalTestSignalSession(t, 30)
	identityA, identityB := [32]byte{1}, [32]byte{2}
	if err := deviceA.Identities.PutIdentity(ctx, address, identityA); err != nil {
		t.Fatal(err)
	}
	if err := deviceB.Identities.PutIdentity(ctx, address, identityB); err != nil {
		t.Fatal(err)
	}
	if trusted, err := deviceA.Identities.IsTrustedIdentity(ctx, address, identityA); err != nil || !trusted {
		t.Fatalf("session A identity leaked or missing: trusted=%v err=%v", trusted, err)
	}
	if trusted, err := deviceA.Identities.IsTrustedIdentity(ctx, address, identityB); err != nil || trusted {
		t.Fatalf("session A trusted session B identity: trusted=%v err=%v", trusted, err)
	}

	if err := deviceA.Sessions.PutSession(ctx, address, sessionPayloadA); err != nil {
		t.Fatal(err)
	}
	if err := deviceB.Sessions.PutSession(ctx, address, sessionPayloadB); err != nil {
		t.Fatal(err)
	}
	gotA, err := deviceA.Sessions.GetSession(ctx, address)
	if err != nil || !bytes.Equal(gotA, sessionPayloadA) {
		t.Fatalf("unexpected session A ratchet %q: %v", gotA, err)
	}
	gotB, err := deviceB.Sessions.GetSession(ctx, address)
	if err != nil || !bytes.Equal(gotB, sessionPayloadB) {
		t.Fatalf("unexpected session B ratchet %q: %v", gotB, err)
	}

	preKeyA, err := deviceA.PreKeys.GenOnePreKey(ctx)
	if err != nil {
		t.Fatal(err)
	}
	preKeyB, err := deviceB.PreKeys.GenOnePreKey(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if preKeyA.KeyID != 1 || preKeyB.KeyID != 1 || *preKeyA.Priv == *preKeyB.Priv {
		t.Fatal("prekey allocators or key material crossed session boundaries")
	}
	for index, sessionID := range []string{sessionA, sessionB} {
		marker := byte(index + 1)
		if _, err = container.db.Exec(ctx, `
			INSERT INTO whatsapp_pq_pre_keys (
				session_id, revision_id, key_id, key_kind, public_key,
				private_key, signature, timestamp_ms, sent_to_server
			) VALUES ($1, 1, 7, 'last_resort', $2, $3, $4, 1700000000000, true)
		`, sessionID, bytes.Repeat([]byte{marker}, 1568),
			bytes.Repeat([]byte{marker}, 3168), bytes.Repeat([]byte{marker}, 64)); err != nil {
			t.Fatalf("insert PQ material for session %s: %v", sessionID, err)
		}
		if _, err = container.db.Exec(ctx, `
			INSERT INTO whatsapp_pq_pre_key_state (
				session_id, revision_id, codec_version, algorithm,
				next_pre_key_id, migrated
			) VALUES ($1, 1, 1, 'ML-KEM-1024', 8, true)
		`, sessionID); err != nil {
			t.Fatalf("insert PQ allocator for session %s: %v", sessionID, err)
		}
	}

	senderPayloadA := canonicalTestSenderKey(t, 50)
	senderPayloadB := canonicalTestSenderKey(t, 70)
	if err = deviceA.SenderKeys.PutSenderKey(ctx, "group", address, senderPayloadA); err != nil {
		t.Fatal(err)
	}
	if err = deviceB.SenderKeys.PutSenderKey(ctx, "group", address, senderPayloadB); err != nil {
		t.Fatal(err)
	}
	if got, err := deviceA.SenderKeys.GetSenderKey(ctx, "group", address); err != nil || !bytes.Equal(got, senderPayloadA) {
		t.Fatalf("session A sender key mismatch: %q %v", got, err)
	}
	if got, err := deviceB.SenderKeys.GetSenderKey(ctx, "group", address); err != nil || !bytes.Equal(got, senderPayloadB) {
		t.Fatalf("session B sender key mismatch: %q %v", got, err)
	}

	appKeyID := []byte("same-app-key")
	if err = deviceA.AppStateKeys.PutAppStateSyncKey(ctx, appKeyID, store.AppStateSyncKey{Data: []byte("app-a"), Timestamp: 1, Fingerprint: []byte("fp-a")}); err != nil {
		t.Fatal(err)
	}
	if err = deviceB.AppStateKeys.PutAppStateSyncKey(ctx, appKeyID, store.AppStateSyncKey{Data: []byte("app-b"), Timestamp: 1, Fingerprint: []byte("fp-b")}); err != nil {
		t.Fatal(err)
	}
	if got, err := deviceA.AppStateKeys.GetAppStateSyncKey(ctx, appKeyID); err != nil || string(got.Data) != "app-a" {
		t.Fatalf("session A app-state key mismatch: %#v %v", got, err)
	}
	if got, err := deviceB.AppStateKeys.GetAppStateSyncKey(ctx, appKeyID); err != nil || string(got.Data) != "app-b" {
		t.Fatalf("session B app-state key mismatch: %#v %v", got, err)
	}
	appHashA, appHashB := [128]byte{1}, [128]byte{2}
	if err = deviceA.AppState.PutAppStateVersion(ctx, "regular", 1, appHashA); err != nil {
		t.Fatal(err)
	}
	if err = deviceB.AppState.PutAppStateVersion(ctx, "regular", 1, appHashB); err != nil {
		t.Fatal(err)
	}
	indexMAC := make([]byte, 32)
	indexMAC[0] = 7
	valueMACA, valueMACB := make([]byte, 32), make([]byte, 32)
	valueMACA[0], valueMACB[0] = 1, 2
	if err = deviceA.AppState.PutAppStateMutationMACs(ctx, "regular", 1, []store.AppStateMutationMAC{{IndexMAC: indexMAC, ValueMAC: valueMACA}}); err != nil {
		t.Fatal(err)
	}
	if err = deviceB.AppState.PutAppStateMutationMACs(ctx, "regular", 1, []store.AppStateMutationMAC{{IndexMAC: indexMAC, ValueMAC: valueMACB}}); err != nil {
		t.Fatal(err)
	}
	if got, err := deviceA.AppState.GetAppStateMutationMAC(ctx, "regular", indexMAC); err != nil || got[0] != 1 {
		t.Fatalf("session A mutation MAC mismatch: %x %v", got, err)
	}
	if got, err := deviceB.AppState.GetAppStateMutationMAC(ctx, "regular", indexMAC); err != nil || got[0] != 2 {
		t.Fatalf("session B mutation MAC mismatch: %x %v", got, err)
	}

	contactJID := types.NewJID("5511444444444", types.DefaultUserServer)
	if err = deviceA.Contacts.PutAllContactNames(ctx, []store.ContactEntry{{JID: contactJID, FirstName: "A", FullName: "Contact A"}}); err != nil {
		t.Fatal(err)
	}
	if err = deviceB.Contacts.PutContactName(ctx, contactJID, "B", "Contact B"); err != nil {
		t.Fatal(err)
	}
	if got, err := deviceA.Contacts.GetContact(ctx, contactJID); err != nil || got.FirstName != "A" {
		t.Fatalf("session A contact mismatch: %#v %v", got, err)
	}
	if got, err := deviceB.Contacts.GetContact(ctx, contactJID); err != nil || got.FirstName != "B" {
		t.Fatalf("session B contact mismatch: %#v %v", got, err)
	}

	chatJID := types.NewJID("120363000000000000", types.GroupServer)
	if err = deviceA.ChatSettings.PutPinned(ctx, chatJID, true); err != nil {
		t.Fatal(err)
	}
	if err = deviceB.ChatSettings.PutPinned(ctx, chatJID, false); err != nil {
		t.Fatal(err)
	}
	if got, err := deviceA.ChatSettings.GetChatSettings(ctx, chatJID); err != nil || !got.Pinned {
		t.Fatalf("session A chat setting mismatch: %#v %v", got, err)
	}
	if got, err := deviceB.ChatSettings.GetChatSettings(ctx, chatJID); err != nil || got.Pinned {
		t.Fatalf("session B chat setting mismatch: %#v %v", got, err)
	}

	senderJID := contactJID
	if err = deviceA.MsgSecrets.PutMessageSecret(ctx, chatJID, senderJID, "same-message", []byte("secret-a")); err != nil {
		t.Fatal(err)
	}
	if err = deviceB.MsgSecrets.PutMessageSecret(ctx, chatJID, senderJID, "same-message", []byte("secret-b")); err != nil {
		t.Fatal(err)
	}
	if got, _, err := deviceA.MsgSecrets.GetMessageSecret(ctx, chatJID, senderJID, "same-message"); err != nil || string(got) != "secret-a" {
		t.Fatalf("session A message secret mismatch: %q %v", got, err)
	}
	if got, _, err := deviceB.MsgSecrets.GetMessageSecret(ctx, chatJID, senderJID, "same-message"); err != nil || string(got) != "secret-b" {
		t.Fatalf("session B message secret mismatch: %q %v", got, err)
	}

	now := time.Now().Truncate(time.Second)
	if err = deviceA.PrivacyTokens.PutPrivacyTokens(ctx, store.PrivacyToken{User: contactJID, Token: []byte("token-a"), Timestamp: now}); err != nil {
		t.Fatal(err)
	}
	if err = deviceB.PrivacyTokens.PutPrivacyTokens(ctx, store.PrivacyToken{User: contactJID, Token: []byte("token-b"), Timestamp: now}); err != nil {
		t.Fatal(err)
	}
	if got, err := deviceA.PrivacyTokens.GetPrivacyToken(ctx, contactJID); err != nil || string(got.Token) != "token-a" {
		t.Fatalf("session A privacy token mismatch: %#v %v", got, err)
	}
	if got, err := deviceB.PrivacyTokens.GetPrivacyToken(ctx, contactJID); err != nil || string(got.Token) != "token-b" {
		t.Fatalf("session B privacy token mismatch: %#v %v", got, err)
	}
	if err = deviceA.NCTSalt.PutNCTSalt(ctx, []byte("salt-a")); err != nil {
		t.Fatal(err)
	}
	if err = deviceB.NCTSalt.PutNCTSalt(ctx, []byte("salt-b")); err != nil {
		t.Fatal(err)
	}
	if got, err := deviceA.NCTSalt.GetNCTSalt(ctx); err != nil || string(got) != "salt-a" {
		t.Fatalf("session A NCT salt mismatch: %q %v", got, err)
	}
	if got, err := deviceB.NCTSalt.GetNCTSalt(ctx); err != nil || string(got) != "salt-b" {
		t.Fatalf("session B NCT salt mismatch: %q %v", got, err)
	}
	if err = deviceA.EventBuffer.AddOutgoingEvent(ctx, chatJID, "same-outgoing", "a", []byte("out-a")); err != nil {
		t.Fatal(err)
	}
	if err = deviceB.EventBuffer.AddOutgoingEvent(ctx, chatJID, "same-outgoing", "b", []byte("out-b")); err != nil {
		t.Fatal(err)
	}
	if format, got, err := deviceA.EventBuffer.GetOutgoingEvent(ctx, chatJID, types.EmptyJID, "same-outgoing"); err != nil || format != "a" || string(got) != "out-a" {
		t.Fatalf("session A outgoing event mismatch: %s %q %v", format, got, err)
	}
	if format, got, err := deviceB.EventBuffer.GetOutgoingEvent(ctx, chatJID, types.EmptyJID, "same-outgoing"); err != nil || format != "b" || string(got) != "out-b" {
		t.Fatalf("session B outgoing event mismatch: %s %q %v", format, got, err)
	}

	routingA, routingB := []byte{0x08, 0x01, 0x12, 0x01, 0xa1}, []byte{0x08, 0x01, 0x12, 0x01, 0xb2}
	if deviceA.Transport == nil || deviceB.Transport == nil {
		t.Fatal("SQL devices did not expose the native transport store")
	}
	if err = deviceA.Transport.PutTransportRoutingInfo(ctx, routingA); err != nil {
		t.Fatal(err)
	}
	if err = deviceB.Transport.PutTransportRoutingInfo(ctx, routingB); err != nil {
		t.Fatal(err)
	}
	if got, err := deviceA.Transport.GetTransportRoutingInfo(ctx); err != nil || !bytes.Equal(got, routingA) {
		t.Fatalf("session A routing info mismatch: size=%d err=%v", len(got), err)
	}
	if got, err := deviceB.Transport.GetTransportRoutingInfo(ctx); err != nil || !bytes.Equal(got, routingB) {
		t.Fatalf("session B routing info mismatch: size=%d err=%v", len(got), err)
	}

	pn := types.NewJID("5511777777777", types.DefaultUserServer)
	lidA := types.NewJID("100000000001", types.HiddenUserServer)
	lidB := types.NewJID("100000000002", types.HiddenUserServer)
	if err = deviceA.LIDs.PutLIDMapping(ctx, lidA, pn); err != nil {
		t.Fatal(err)
	}
	if err = deviceB.LIDs.PutLIDMapping(ctx, lidB, pn); err != nil {
		t.Fatal(err)
	}
	if got, err := deviceA.LIDs.GetLIDForPN(ctx, pn); err != nil || got.User != lidA.User {
		t.Fatalf("session A LID mismatch: %s %v", got, err)
	}
	if got, err := deviceB.LIDs.GetLIDForPN(ctx, pn); err != nil || got.User != lidB.User {
		t.Fatalf("session B LID mismatch: %s %v", got, err)
	}

	hash := [32]byte{9}
	if err = deviceA.EventBuffer.PutBufferedEvent(ctx, hash, []byte("event-a"), time.Now()); err != nil {
		t.Fatal(err)
	}
	if err = deviceB.EventBuffer.PutBufferedEvent(ctx, hash, []byte("event-b"), time.Now()); err != nil {
		t.Fatal(err)
	}
	bufferA, err := deviceA.EventBuffer.GetBufferedEvent(ctx, hash)
	if err != nil || string(bufferA.Plaintext) != "event-a" {
		t.Fatalf("session A event mismatch: %#v %v", bufferA, err)
	}
	bufferB, err := deviceB.EventBuffer.GetBufferedEvent(ctx, hash)
	if err != nil || string(bufferB.Plaintext) != "event-b" {
		t.Fatalf("session B event mismatch: %#v %v", bufferB, err)
	}
	if _, err = container.db.Exec(ctx, `
		UPDATE whatsapp_event_buffer SET insert_timestamp=0
		WHERE ciphertext_hash=$1
	`, hash[:]); err != nil {
		t.Fatal(err)
	}
	if err = deviceA.EventBuffer.DeleteOldBufferedHashes(ctx); err != nil {
		t.Fatal(err)
	}
	if bufferA, err = deviceA.EventBuffer.GetBufferedEvent(ctx, hash); err != nil || bufferA != nil {
		t.Fatalf("session A GC did not remove its old buffer: %#v %v", bufferA, err)
	}
	if bufferB, err = deviceB.EventBuffer.GetBufferedEvent(ctx, hash); err != nil || string(bufferB.Plaintext) != "event-b" {
		t.Fatalf("session A GC changed session B: %#v %v", bufferB, err)
	}

	if _, err = container.GetDevice(ctx, jid); !errors.Is(err, ErrAmbiguousDeviceLookup) {
		t.Fatalf("JID lookup must fail when two scopes share a JID, got %v", err)
	}
	loadedA, err := container.GetDeviceForSession(ctx, sessionA, 1)
	if err != nil || loadedA.SessionID != sessionA || loadedA.RevisionID != 1 {
		t.Fatalf("load exact session A scope: %#v %v", loadedA, err)
	}

	if err = deviceA.Delete(ctx); err != nil {
		t.Fatalf("delete session A: %v", err)
	}
	if got, err := deviceA.LIDs.GetLIDForPN(ctx, pn); err != nil || !got.IsEmpty() {
		t.Fatalf("deleted session A retained a LID cache entry: %s %v", got, err)
	}
	if got, err := deviceB.Sessions.GetSession(ctx, address); err != nil || !bytes.Equal(got, sessionPayloadB) {
		t.Fatalf("deleting session A changed session B: %q %v", got, err)
	}
	if got, err := deviceB.LIDs.GetLIDForPN(ctx, pn); err != nil || got.User != lidB.User {
		t.Fatalf("deleting session A changed session B LID: %s %v", got, err)
	}
	if got, err := deviceB.Transport.GetTransportRoutingInfo(ctx); err != nil || !bytes.Equal(got, routingB) {
		t.Fatalf("deleting session A changed session B routing info: size=%d err=%v", len(got), err)
	}
	protocolTables := []string{
		"whatsapp_device",
		"whatsapp_identity_keys",
		"whatsapp_pre_keys",
		"whatsapp_pq_pre_keys",
		"whatsapp_pq_pre_key_state",
		"whatsapp_signal_sessions",
		"whatsapp_sender_keys",
		"whatsapp_app_state_sync_keys",
		"whatsapp_app_state_version",
		"whatsapp_app_state_mutation_macs",
		"whatsapp_contacts",
		"whatsapp_chat_settings",
		"whatsapp_message_secrets",
		"whatsapp_privacy_tokens",
		"whatsapp_nct_salt",
		"whatsapp_lid_map",
		"whatsapp_event_buffer",
		"whatsapp_retry_buffer",
		"whatsapp_provider_record",
	}
	for _, table := range protocolTables {
		var rowsA, rowsB int
		query := fmt.Sprintf("SELECT COUNT(*) FROM %s WHERE session_id=$1 AND revision_id=$2", table)
		if err = container.db.QueryRow(ctx, query, sessionA, 1).Scan(&rowsA); err != nil {
			t.Fatalf("count %s for session A: %v", table, err)
		}
		if err = container.db.QueryRow(ctx, query, sessionB, 1).Scan(&rowsB); err != nil {
			t.Fatalf("count %s for session B: %v", table, err)
		}
		if rowsA != 0 || rowsB == 0 {
			t.Fatalf("bad cascade/isolation in %s: session A=%d session B=%d", table, rowsA, rowsB)
		}
	}
}

func TestTransportRoutingMutationRejectsCrossSessionLeaseScope(t *testing.T) {
	container, ctx := newIsolationTestContainer(t)
	jid := types.NewADJID("5511999999988", 0, 1)
	sessionA, sessionB := uuid.NewString(), uuid.NewString()
	deviceA := pairedTestDevice(t, ctx, container, sessionA, 1, jid)
	deviceB := pairedTestDevice(t, ctx, container, sessionB, 1, jid)

	errCrossSession := errors.New("test lease rejected cross-session scope")
	container.SetOperationFenceProvider(func(context.Context, SessionScope) (OperationFence, error) {
		return OperationFence{FencingToken: 9, Generation: 3}, nil
	})
	guard := func(_ context.Context, _ *dbutil.Database, scope SessionScope, _ OperationFence) error {
		if scope.SessionID != sessionA || scope.RevisionID != 1 {
			return errCrossSession
		}
		return nil
	}
	container.SetOperationGuard(guard)
	container.SetMutationGuard(guard)

	if err := deviceA.Transport.PutTransportRoutingInfo(ctx, []byte{1, 2, 3}); err != nil {
		t.Fatalf("allowed transport mutation failed: %v", err)
	}
	if err := deviceB.Transport.PutTransportRoutingInfo(ctx, []byte{4, 5, 6}); !errors.Is(err, ErrOperationGuardRejected) {
		t.Fatalf("cross-session transport mutation bypassed the lease guard: %v", err)
	}
	var rowsB int
	if err := container.db.QueryRow(ctx, `
		SELECT COUNT(*) FROM whatsapp_provider_record
		WHERE session_id=$1 AND revision_id=$2
		  AND namespace=$3 AND record_key=$4
	`, sessionB, 1, store.WhatsAppTransportNamespace,
		store.WhatsAppTransportRoutingInfoKey).Scan(&rowsB); err != nil {
		t.Fatal(err)
	} else if rowsB != 0 {
		t.Fatalf("rejected session persisted %d transport records", rowsB)
	}
}

func TestCompanionReservationIsGlobalWriteOnceAndReleasedAfterLastRevision(t *testing.T) {
	container, ctx := newIsolationTestContainer(t)
	sessionA, sessionB := uuid.NewString(), uuid.NewString()
	deviceA := pairedTestDevice(
		t, ctx, container, sessionA, 1,
		types.NewADJID("5511999999997", 0, 1),
	)

	var reservationRows int
	if err := container.db.QueryRow(ctx, `
		SELECT COUNT(*) FROM whatsapp_companion_reservation
		WHERE session_id=$1 AND fingerprint_version=$2 AND device_fingerprint=$3
	`, sessionA, DeviceFingerprintVersion, deviceA.DeviceFingerprint[:]).Scan(&reservationRows); err != nil {
		t.Fatal(err)
	} else if reservationRows != 1 {
		t.Fatalf("got %d initial companion reservations, want 1", reservationRows)
	}

	var changesBefore, changesAfter int64
	if err := container.db.QueryRow(ctx, "SELECT total_changes()").Scan(&changesBefore); err != nil {
		t.Fatal(err)
	}
	if err := container.ReserveCompanionIdentity(ctx, deviceA); err != nil {
		t.Fatalf("same session could not reacquire its companion reservation: %v", err)
	}
	if err := container.db.QueryRow(ctx, "SELECT total_changes()").Scan(&changesAfter); err != nil {
		t.Fatal(err)
	}
	// ReserveCompanionIdentity persists one scoped device row. A write-once
	// reservation contributes no second UPDATE/INSERT on reconnect.
	if delta := changesAfter - changesBefore; delta != 1 {
		t.Fatalf("same-session reservation rewrote its tuple: total_changes delta=%d, want 1", delta)
	}

	secondRevision := *deviceA
	secondRevision.RevisionID = 2
	secondRevision.Initialized = false
	if err := secondRevision.Save(ctx); err != nil {
		t.Fatalf("same session could not reserve the identity for a handoff revision: %v", err)
	}
	if err := container.db.QueryRow(ctx, `
		SELECT COUNT(*) FROM whatsapp_companion_reservation WHERE session_id=$1
	`, sessionA).Scan(&reservationRows); err != nil {
		t.Fatal(err)
	} else if reservationRows != 1 {
		t.Fatalf("same-session revisions created %d reservations, want 1", reservationRows)
	}

	clonedSession := *deviceA
	clonedSession.SessionID = sessionB
	clonedSession.RevisionID = 1
	clonedSession.Initialized = false
	if err := clonedSession.Save(ctx); !errors.Is(err, ErrCompanionIdentityConflict) {
		t.Fatalf("second session opened cloned companion credentials: %v", err)
	}

	if err := container.DeleteDevice(ctx, deviceA); err != nil {
		t.Fatal(err)
	}
	if err := container.db.QueryRow(ctx, `
		SELECT COUNT(*) FROM whatsapp_companion_reservation WHERE session_id=$1
	`, sessionA).Scan(&reservationRows); err != nil {
		t.Fatal(err)
	} else if reservationRows != 1 {
		t.Fatal("deleting one handoff revision released the live companion reservation")
	}
	if err := container.DeleteDevice(ctx, &secondRevision); err != nil {
		t.Fatal(err)
	}
	if err := container.db.QueryRow(ctx, `
		SELECT COUNT(*) FROM whatsapp_companion_reservation WHERE session_id=$1
	`, sessionA).Scan(&reservationRows); err != nil {
		t.Fatal(err)
	} else if reservationRows != 0 {
		t.Fatal("deleting the final revision did not release the companion reservation")
	}

	if err := clonedSession.Save(ctx); err != nil {
		t.Fatalf("released companion identity could not move to another session: %v", err)
	}
}

func TestEstablishedDeviceWithoutADVSecretRoundTrips(t *testing.T) {
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
	expectedFingerprint := CalculateDeviceFingerprint(device)
	device.AdvSecretKey = nil
	device.AdvSecretAvailable = false
	if err := device.Save(ctx); err != nil {
		t.Fatalf("save established public-only companion identity: %v", err)
	}
	restored, err := container.GetDeviceForSession(ctx, sessionID, 1)
	if err != nil {
		t.Fatalf("restore established public-only companion identity: %v", err)
	}
	if restored.AdvSecretAvailable || len(restored.AdvSecretKey) != 0 {
		t.Fatal("restore invented an extractable ADV secret")
	}
	if restored.DeviceFingerprint != expectedFingerprint || restored.FingerprintVersion != DeviceFingerprintVersion {
		t.Fatal("public companion fingerprint changed when ADV capability was removed")
	}
}

func TestDeviceLoaderRejectsTamperedCanonicalKeyMaterial(t *testing.T) {
	for _, fixture := range []struct {
		name   string
		column string
		value  func(*store.Device) []byte
	}{
		{
			name:   "signed pre-key private",
			column: "signed_pre_key",
			value: func(device *store.Device) []byte {
				return append([]byte(nil), device.SignedPreKey.Priv[:]...)
			},
		},
		{
			name:   "signed pre-key signature",
			column: "signed_pre_key_sig",
			value: func(device *store.Device) []byte {
				return append([]byte(nil), device.SignedPreKey.Signature[:]...)
			},
		},
	} {
		t.Run(fixture.name, func(t *testing.T) {
			container, ctx := newIsolationTestContainer(t)
			sessionID := uuid.NewString()
			device := pairedTestDevice(t, ctx, container, sessionID, 1, types.NewADJID("5511555555555", 0, 1))
			tampered := fixture.value(device)
			tampered[10] ^= 0x01
			if _, err := container.db.Exec(ctx, fmt.Sprintf(`
				UPDATE whatsapp_device SET %s=$3
				WHERE session_id=$1 AND revision_id=$2
			`, fixture.column), sessionID, 1, tampered); err != nil {
				t.Fatal(err)
			}

			loaded, err := container.GetDeviceForSession(ctx, sessionID, 1)
			if loaded != nil || !errors.Is(err, ErrSignedPreKeySignatureInvalid) {
				t.Fatalf("tampered canonical key material was restored: device=%v err=%v", loaded != nil, err)
			}
		})
	}
}

func TestProviderNeutralDeviceCannotOpenAsWhatsMeowWithoutCredentials(t *testing.T) {
	container, ctx := newIsolationTestContainer(t)
	sessionID := uuid.NewString()
	if err := container.ensureStandaloneSessionRevision(ctx, sessionID, 1); err != nil {
		t.Fatal(err)
	}
	if _, err := container.db.Exec(ctx, `
		INSERT INTO whatsapp_device (session_id, revision_id, jid)
		VALUES ($1, $2, $3)
	`, sessionID, 1, "5511999999999:1@s.whatsapp.net"); err != nil {
		t.Fatalf("insert provider-neutral device row: %v", err)
	}

	device, err := container.GetDeviceForSession(ctx, sessionID, 1)
	if device != nil || !errors.Is(err, ErrDeviceCredentialsUnavailable) {
		t.Fatalf("provider-neutral row must not be treated as an empty WhatsMeow session: device=%#v err=%v", device, err)
	}
}

func TestMissingStoredFingerprintIsRebuiltFromCredentials(t *testing.T) {
	container, ctx := newIsolationTestContainer(t)
	sessionID := uuid.NewString()
	device := pairedTestDevice(t, ctx, container, sessionID, 1, types.NewADJID("5511999999998", 0, 1))
	want := device.DeviceFingerprint
	if _, err := container.db.Exec(ctx, `
		UPDATE whatsapp_device
		SET device_fingerprint=NULL, fingerprint_version=NULL
		WHERE session_id=$1 AND revision_id=$2
	`, sessionID, 1); err != nil {
		t.Fatal(err)
	}

	loaded, err := container.GetDeviceForSession(ctx, sessionID, 1)
	if err != nil {
		t.Fatal(err)
	} else if loaded.DeviceFingerprint != want {
		t.Fatalf("rebuilt fingerprint mismatch: got %x want %x", loaded.DeviceFingerprint, want)
	}
}

func TestPreKeyReservationIsAtomicAcrossStoreInstances(t *testing.T) {
	container, ctx := newIsolationTestContainer(t)
	sessionID := uuid.NewString()
	device := pairedTestDevice(t, ctx, container, sessionID, 1, types.NewADJID("5511666666666", 0, 1))

	const count = 32
	ids := make(chan uint32, count)
	errs := make(chan error, count)
	var wg sync.WaitGroup
	for range count {
		wg.Add(1)
		go func() {
			defer wg.Done()
			key, err := NewSQLStore(container, sessionID, 1).GenOnePreKey(ctx)
			if err != nil {
				errs <- err
				return
			}
			ids <- key.KeyID
		}()
	}
	wg.Wait()
	close(errs)
	close(ids)
	for err := range errs {
		t.Fatalf("reserve prekey: %v", err)
	}
	seen := make(map[uint32]struct{}, count)
	for id := range ids {
		if _, exists := seen[id]; exists {
			t.Fatalf("duplicate prekey ID %d", id)
		}
		seen[id] = struct{}{}
	}
	if len(seen) != count {
		t.Fatalf("got %d unique prekeys, want %d", len(seen), count)
	}

	var stored int
	if err := container.db.QueryRow(ctx, `
		SELECT COUNT(*) FROM whatsapp_pre_keys WHERE session_id=$1 AND revision_id=$2
	`, sessionID, 1).Scan(&stored); err != nil && !errors.Is(err, sql.ErrNoRows) {
		t.Fatal(err)
	}
	if stored != count {
		t.Fatalf("stored %d prekeys, want %d", stored, count)
	}
	// A regular device Save must never reset the database allocator from its
	// stale in-memory diagnostic value.
	if err := device.Save(ctx); err != nil {
		t.Fatal(err)
	}
	loaded, err := container.GetDeviceForSession(ctx, sessionID, 1)
	if err != nil {
		t.Fatal(err)
	} else if loaded.NextPreKeyID != count+1 {
		t.Fatalf("next prekey ID was reset: got %d want %d", loaded.NextPreKeyID, count+1)
	}
}

func TestOperationGuardRunsInsideScopedTransaction(t *testing.T) {
	container, ctx := newIsolationTestContainer(t)
	sessionID := uuid.NewString()
	device := pairedTestDevice(t, ctx, container, sessionID, 7, types.NewADJID("5511555555555", 0, 1))
	sqlStore := device.Sessions.(*SQLStore)

	var providerCalls atomic.Int64
	var readGuardCalls atomic.Int64
	var mutationGuardCalls atomic.Int64
	container.SetOperationFenceProvider(func(_ context.Context, scope SessionScope) (OperationFence, error) {
		providerCalls.Add(1)
		if scope.SessionID != sessionID || scope.RevisionID != 7 {
			return OperationFence{}, fmt.Errorf("unexpected scope %#v", scope)
		}
		return OperationFence{
			OwnerID:      "worker-test",
			FencingToken: 11,
			Generation:   3,
			Epoch:        "242ddae6-c2fc-47a9-8b64-175055557ba4",
			Capability:   "test-runtime-capability-that-is-never-logged-or-persisted",
		}, nil
	})
	container.SetOperationGuard(func(txCtx context.Context, db *dbutil.Database, scope SessionScope, fence OperationFence) error {
		readGuardCalls.Add(1)
		if scope.SessionID != sessionID || scope.RevisionID != 7 || fence.FencingToken != 11 {
			return fmt.Errorf("unexpected guarded read: scope=%#v fence=%#v", scope, fence)
		}
		var value int
		return db.QueryRow(txCtx, "SELECT 1").Scan(&value)
	})
	container.SetMutationGuard(func(txCtx context.Context, db *dbutil.Database, scope SessionScope, fence OperationFence) error {
		mutationGuardCalls.Add(1)
		if scope.SessionID != sessionID || scope.RevisionID != 7 || fence.FencingToken != 11 {
			return fmt.Errorf("unexpected guarded mutation: scope=%#v fence=%#v", scope, fence)
		}
		var value int
		return db.QueryRow(txCtx, "SELECT 1").Scan(&value)
	})

	err := sqlStore.DoSessionMutation(ctx, func(txCtx context.Context) error {
		if err := sqlStore.PutSession(txCtx, "same-address", []byte("guarded")); err != nil {
			return err
		}
		got, err := sqlStore.GetSession(txCtx, "same-address")
		if err != nil {
			return err
		} else if string(got) != "guarded" {
			return fmt.Errorf("unexpected guarded value %q", got)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if mutationGuardCalls.Load() != 1 || readGuardCalls.Load() != 0 || providerCalls.Load() != 1 {
		t.Fatalf(
			"nested calls must share one guarded mutation: mutation=%d read=%d provider=%d",
			mutationGuardCalls.Load(), readGuardCalls.Load(), providerCalls.Load(),
		)
	}

	if _, err = sqlStore.GetSession(ctx, "same-address"); err != nil {
		t.Fatal(err)
	}
	if mutationGuardCalls.Load() != 1 || readGuardCalls.Load() != 1 || providerCalls.Load() != 2 {
		t.Fatalf(
			"standalone read must use only the read guard: mutation=%d read=%d provider=%d",
			mutationGuardCalls.Load(), readGuardCalls.Load(), providerCalls.Load(),
		)
	}
}

func TestReadScopeRejectsNestedMutationBeforeDML(t *testing.T) {
	container, ctx := newIsolationTestContainer(t)
	sessionID := uuid.NewString()
	device := pairedTestDevice(t, ctx, container, sessionID, 8, types.NewADJID("5511555555556", 0, 1))
	sqlStore := device.Sessions.(*SQLStore)
	container.SetOperationFenceProvider(func(context.Context, SessionScope) (OperationFence, error) {
		return OperationFence{FencingToken: 1, Generation: 1}, nil
	})
	container.SetOperationGuard(func(context.Context, *dbutil.Database, SessionScope, OperationFence) error { return nil })
	container.SetMutationGuard(func(context.Context, *dbutil.Database, SessionScope, OperationFence) error { return nil })

	err := sqlStore.DoSessionOperation(ctx, func(txCtx context.Context) error {
		return sqlStore.PutSession(txCtx, "must-not-write", []byte("blocked"))
	})
	if !errors.Is(err, ErrSessionMutationInReadTxn) {
		t.Fatalf("read transaction mutation was not rejected: %v", err)
	}

	var stored int
	if err = container.db.QueryRow(ctx, `
		SELECT COUNT(*) FROM whatsapp_signal_sessions
		WHERE session_id=$1 AND revision_id=$2 AND their_id=$3
	`, sessionID, 8, "must-not-write").Scan(&stored); err != nil {
		t.Fatal(err)
	} else if stored != 0 {
		t.Fatal("rejected nested mutation reached the protocol table")
	}
}

func TestUpdateReturningUsesMutationGuard(t *testing.T) {
	container, ctx := newIsolationTestContainer(t)
	sessionID := uuid.NewString()
	device := pairedTestDevice(t, ctx, container, sessionID, 9, types.NewADJID("5511555555557", 0, 1))
	sqlStore := device.Sessions.(*SQLStore)
	var readGuardCalls atomic.Int64
	var mutationGuardCalls atomic.Int64
	container.SetOperationFenceProvider(func(context.Context, SessionScope) (OperationFence, error) {
		return OperationFence{FencingToken: 1, Generation: 1}, nil
	})
	container.SetOperationGuard(func(context.Context, *dbutil.Database, SessionScope, OperationFence) error {
		readGuardCalls.Add(1)
		return nil
	})
	container.SetMutationGuard(func(context.Context, *dbutil.Database, SessionScope, OperationFence) error {
		mutationGuardCalls.Add(1)
		return nil
	})

	if _, err := sqlStore.reservePreKeyIDs(ctx, 1); err != nil {
		t.Fatal(err)
	}
	if mutationGuardCalls.Load() != 1 || readGuardCalls.Load() != 0 {
		t.Fatalf(
			"UPDATE RETURNING used the wrong guard: mutation=%d read=%d",
			mutationGuardCalls.Load(), readGuardCalls.Load(),
		)
	}
}
