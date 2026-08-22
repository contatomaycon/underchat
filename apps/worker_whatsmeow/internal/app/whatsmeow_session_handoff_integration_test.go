package app

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"go.mau.fi/whatsmeow/proto/waAdv"
	meowstore "go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/util/keys"
	waLog "go.mau.fi/whatsmeow/util/log"
)

const whatsmeowHandoffIntegrationDatabaseEnv = "WHATSAPP_SESSION_INTEGRATION_DATABASE_URL"

func TestWhatsmeowProviderHandoffAgainstUnifiedPostgres(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv(whatsmeowHandoffIntegrationDatabaseEnv))
	if databaseURL == "" {
		t.Skip("set " + whatsmeowHandoffIntegrationDatabaseEnv + " to run PostgreSQL handoff integration")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	capability := strings.Repeat("whatsmeow-handoff-capability-", 2)
	cfg := Config{
		WorkerDatabaseURL:           databaseURL,
		WorkerID:                    "22222222-2222-4222-8222-222222222222",
		RuntimeGeneration:           1,
		WriterEpoch:                 "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
		RuntimeCapability:           capability,
		SessionStorage:              SessionStoragePostgres,
		WhatsappSessionDebugEnabled: true,
	}
	postgres, err := OpenWorkerPostgres(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer postgres.Close(context.Background())

	sourceRevision, targetRevision, handoffID := prepareWhatsmeowHandoffIntegrationFixture(
		t, ctx, postgres.DB, cfg, capability,
	)
	if err := postgres.AcquireSessionLease(ctx, cfg); err != nil {
		t.Fatalf("acquire target lease: %v", err)
	}

	opened, err := postgres.openSessionRevision(ctx, cfg)
	if err != nil {
		t.Fatalf("open target handoff revision: %v", err)
	}
	if opened.RevisionID != targetRevision || opened.Status != "staging" ||
		!opened.HandoffID.Valid || opened.HandoffID.String != handoffID {
		t.Fatalf("unexpected opened handoff revision: %+v", opened)
	}

	stage, err := postgres.hydrateWhatsmeowProviderHandoff(
		ctx, cfg, targetRevision, handoffID,
	)
	if err != nil {
		t.Fatalf("hydrate target handoff revision: %v", err)
	}
	if stage.PreviousRevision != sourceRevision || stage.CandidateRevision != targetRevision ||
		stage.HandoffID != handoffID || stage.ExpectedJID == "" {
		t.Fatalf("unexpected hydrated handoff stage: %+v", stage)
	}
	container := sqlstore.NewWithDB(postgres.DB, "postgres", waLog.Noop)
	if err := container.ValidateSchemaVersion(ctx, sqlstore.SharedSchemaVersion); err != nil {
		t.Fatalf("validate fork schema against Atlas: %v", err)
	}
	container.ConfigurePostgresSessionOperations(func(context.Context, sqlstore.SessionScope) (sqlstore.OperationFence, error) {
		ownerID, token, generation, epoch, capability, err := postgres.SessionOperationFence()
		return sqlstore.OperationFence{
			OwnerID: ownerID, FencingToken: token, Generation: int64(generation),
			Epoch: epoch, Capability: capability,
		}, err
	})
	deviceStore, err := container.GetDeviceForSession(ctx, cfg.WorkerID, targetRevision)
	if err != nil {
		t.Fatalf("open hydrated candidate through fork SQLStore: %v", err)
	}
	if deviceStore == nil || deviceStore.ID == nil || deviceStore.ID.String() != stage.ExpectedJID {
		t.Fatalf("fork SQLStore opened the wrong candidate identity: %+v", deviceStore)
	}

	if err := postgres.MarkWhatsmeowSessionReady(ctx, cfg); err != nil {
		t.Fatalf("promote target handoff revision: %v", err)
	}
	var provider, state, targetStatus, sourceStatus string
	var activeRevision, previousRevision int64
	if err := postgres.DB.QueryRowContext(ctx, `
		SELECT session.provider, session.state, session.active_revision_id,
			session.previous_revision_id, target.status, source.status
		FROM whatsapp_session AS session
		JOIN whatsapp_session_revision AS target
		  ON target.session_id=session.session_id
		 AND target.revision_id=session.active_revision_id
		JOIN whatsapp_session_revision AS source
		  ON source.session_id=session.session_id
		 AND source.revision_id=session.previous_revision_id
		WHERE session.session_id=$1::uuid
	`, cfg.WorkerID).Scan(
		&provider, &state, &activeRevision, &previousRevision,
		&targetStatus, &sourceStatus,
	); err != nil {
		t.Fatal(err)
	}
	if provider != "whatsmeow" || state != "ready" ||
		activeRevision != targetRevision || previousRevision != sourceRevision ||
		targetStatus != "active" || sourceStatus != "retired" {
		t.Fatalf(
			"handoff was not promoted atomically: provider=%s state=%s active=%d previous=%d target=%s source=%s",
			provider, state, activeRevision, previousRevision, targetStatus, sourceStatus,
		)
	}
	reopened, err := postgres.openSessionRevision(ctx, cfg)
	if err != nil {
		t.Fatalf("reopen promoted active revision: %v", err)
	}
	if reopened.RevisionID != targetRevision || reopened.Status != "active" || reopened.HandoffID.Valid {
		t.Fatalf("promoted revision did not reopen as a normal active scope: %+v", reopened)
	}
}

func TestWhatsmeowProviderHandoffRollbackAgainstUnifiedPostgres(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv(whatsmeowHandoffIntegrationDatabaseEnv))
	if databaseURL == "" {
		t.Skip("set " + whatsmeowHandoffIntegrationDatabaseEnv + " to run PostgreSQL handoff integration")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	capability := strings.Repeat("whatsmeow-rollback-capability-", 2)
	cfg := Config{
		WorkerDatabaseURL:           databaseURL,
		WorkerID:                    "22222222-2222-4222-8222-222222222222",
		RuntimeGeneration:           1,
		WriterEpoch:                 "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
		RuntimeCapability:           capability,
		SessionStorage:              SessionStoragePostgres,
		WhatsappSessionDebugEnabled: true,
	}
	postgres, err := OpenWorkerPostgres(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer postgres.Close(context.Background())
	sourceRevision, targetRevision, handoffID := prepareWhatsmeowHandoffIntegrationFixture(
		t, ctx, postgres.DB, cfg, capability,
	)
	if err := postgres.AcquireSessionLease(ctx, cfg); err != nil {
		t.Fatal(err)
	}
	opened, err := postgres.openSessionRevision(ctx, cfg)
	if err != nil || !opened.HandoffID.Valid || opened.RevisionID != targetRevision {
		t.Fatalf("open rollback candidate: opened=%+v err=%v", opened, err)
	}
	if err := postgres.rollbackWhatsmeowProviderHandoffCandidate(
		ctx, cfg, targetRevision, handoffID,
		safeCodeHandoffTargetImportFailed,
	); err != nil {
		t.Fatalf("rollback requested candidate: %v", err)
	}
	var provider, sessionState, sourceStatus, targetStatus, handoffState string
	var activeRevision int64
	if err := postgres.DB.QueryRowContext(ctx, `
		SELECT session.provider, session.state, session.active_revision_id,
			source.status, target.status, handoff.state
		FROM whatsapp_session AS session
		JOIN whatsapp_session_revision AS source
		  ON source.session_id=session.session_id AND source.revision_id=$2
		JOIN whatsapp_session_revision AS target
		  ON target.session_id=session.session_id AND target.revision_id=$3
		JOIN whatsapp_session_handoff AS handoff
		  ON handoff.session_id=session.session_id AND handoff.handoff_id=$4::uuid
		WHERE session.session_id=$1::uuid
	`, cfg.WorkerID, sourceRevision, targetRevision, handoffID).Scan(
		&provider, &sessionState, &activeRevision, &sourceStatus,
		&targetStatus, &handoffState,
	); err != nil {
		t.Fatal(err)
	}
	if provider != "baileys" || sessionState != "ready" || activeRevision != sourceRevision ||
		sourceStatus != "active" || targetStatus != "failed" || handoffState != "failed" {
		t.Fatalf(
			"rollback did not restore source: provider=%s state=%s active=%d source=%s target=%s handoff=%s",
			provider, sessionState, activeRevision, sourceStatus, targetStatus, handoffState,
		)
	}
}

func prepareWhatsmeowHandoffIntegrationFixture(
	t *testing.T,
	ctx context.Context,
	db *sql.DB,
	cfg Config,
	capability string,
) (int64, int64, string) {
	t.Helper()
	const sourceRevision int64 = 2
	capabilityDigest := sha256.Sum256([]byte(capability))
	capabilityHash := hex.EncodeToString(capabilityDigest[:])

	identityPrivate := deterministicWhatsmeowIntegrationBytes(32, 11)
	var identityArray [32]byte
	copy(identityArray[:], identityPrivate)
	device := &meowstore.Device{
		IdentityKey:  keys.NewKeyPairFromPrivateKey(identityArray),
		AdvSecretKey: deterministicWhatsmeowIntegrationBytes(32, 23),
		Account: &waAdv.ADVSignedDeviceIdentity{
			Details:             deterministicWhatsmeowIntegrationBytes(24, 31),
			AccountSignature:    deterministicWhatsmeowIntegrationBytes(64, 47),
			AccountSignatureKey: deterministicWhatsmeowIntegrationBytes(32, 59),
			DeviceSignature:     deterministicWhatsmeowIntegrationBytes(64, 71),
		},
	}
	fingerprint := sqlstore.CalculateDeviceFingerprint(device)

	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `DELETE FROM whatsapp_session_lease WHERE session_id=$1::uuid`, cfg.WorkerID); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM whatsapp_session_handoff WHERE session_id=$1::uuid`, cfg.WorkerID); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE whatsapp_session_revision
		SET provider='baileys', status='active', source='pairing',
			schema_version=$6, codec_version=1, format='whatsapp-canonical-v1',
			writer_generation=$3, writer_epoch=$4::uuid, capability_hash=$5,
			checksum_sha256=COALESCE(checksum_sha256, repeat('a', 64)),
			retired_at=NULL
		WHERE session_id=$1::uuid AND revision_id=$2
	`, cfg.WorkerID, sourceRevision, cfg.RuntimeGeneration, cfg.WriterEpoch,
		capabilityHash, sqlstore.SharedSchemaVersion); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE whatsapp_device
		SET jid='5511999999999:1@s.whatsapp.net', registration_id=42,
			noise_key=$3, identity_key=$4, signed_pre_key=$5,
			signed_pre_key_id=9, signed_pre_key_sig=$6,
			adv_key=$7, adv_details=$8, adv_account_sig=$9,
			adv_account_sig_key=$10, adv_device_sig=$11,
			next_pre_key_id=128, device_fingerprint=$12
		WHERE session_id=$1::uuid AND revision_id=$2
	`, cfg.WorkerID, sourceRevision,
		deterministicWhatsmeowIntegrationBytes(32, 3), identityPrivate,
		deterministicWhatsmeowIntegrationBytes(32, 7),
		deterministicWhatsmeowIntegrationBytes(64, 13), device.AdvSecretKey,
		device.Account.Details, device.Account.AccountSignature,
		device.Account.AccountSignatureKey, device.Account.DeviceSignature,
		fingerprint[:],
	); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE whatsapp_session
		SET provider='baileys', state='ready', active_revision_id=$2,
			previous_revision_id=NULL, generation=$3, epoch=$4::uuid,
			capability_hash=$5, active_device_fingerprint=$6
		WHERE session_id=$1::uuid
	`, cfg.WorkerID, sourceRevision, cfg.RuntimeGeneration, cfg.WriterEpoch,
		capabilityHash, fingerprint[:]); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.ExecContext(ctx, `
		DELETE FROM whatsapp_session_revision
		WHERE session_id=$1::uuid AND revision_id<>$2
	`, cfg.WorkerID, sourceRevision); err != nil {
		t.Fatal(err)
	}

	var targetRevision int64
	if err := tx.QueryRowContext(ctx, `
		SELECT nextval(pg_get_serial_sequence('public.whatsapp_session_revision', 'revision_id'))
	`).Scan(&targetRevision); err != nil {
		t.Fatal(err)
	}
	handoffID := uuid.NewString()
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO whatsapp_session_revision (
			session_id, revision_id, provider, status, source,
			schema_version, codec_version, format, writer_generation,
			writer_epoch, capability_hash
		) VALUES ($1::uuid, $2, 'whatsmeow', 'staging', 'handoff',
			$6, 1, 'whatsapp-canonical-v1', $3, $4::uuid, $5)
	`, cfg.WorkerID, targetRevision, cfg.RuntimeGeneration,
		cfg.WriterEpoch, capabilityHash, sqlstore.SharedSchemaVersion); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO whatsapp_session_handoff (
			session_id, handoff_id, source_provider, target_provider,
			source_revision_id, target_revision_id, state, next_attempt_at
		) VALUES ($1::uuid, $2::uuid, 'baileys', 'whatsmeow', $3, $4,
			'requested', clock_timestamp())
	`, cfg.WorkerID, handoffID, sourceRevision, targetRevision); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE whatsapp_session SET state='handoff'
		WHERE session_id=$1::uuid AND active_revision_id=$2
	`, cfg.WorkerID, sourceRevision); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	return sourceRevision, targetRevision, handoffID
}

func deterministicWhatsmeowIntegrationBytes(size int, seed byte) []byte {
	value := make([]byte, size)
	for index := range value {
		value[index] = seed + byte(index*17)
	}
	return value
}
