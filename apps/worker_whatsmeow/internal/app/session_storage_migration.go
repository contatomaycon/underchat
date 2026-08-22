package app

import (
	"bufio"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/lib/pq"
)

const legacyVolumeImportMaxAttempts = 3

func retryableLegacyVolumeImportError(err error) bool {
	var postgresError *pq.Error
	if !errors.As(err, &postgresError) {
		return false
	}
	return postgresError.Code == "40001" || postgresError.Code == "40P01"
}

func runLegacyVolumeImportWithRetry(
	ctx context.Context,
	retryDelay func(attempt int) time.Duration,
	operation func() error,
) error {
	var err error
	for attempt := 1; attempt <= legacyVolumeImportMaxAttempts; attempt++ {
		err = operation()
		if err == nil || !retryableLegacyVolumeImportError(err) || attempt == legacyVolumeImportMaxAttempts {
			return err
		}
		delay := retryDelay(attempt)
		if delay <= 0 {
			continue
		}
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			if !timer.Stop() {
				select {
				case <-timer.C:
				default:
				}
			}
			return ctx.Err()
		case <-timer.C:
		}
	}
	return err
}

type legacyVolumeSnapshotProof struct {
	Checksum  string
	SizeBytes int64
	Files     int64
}

func snapshotLegacyVolume(rootInput string) (legacyVolumeSnapshotProof, error) {
	root, err := filepath.Abs(rootInput)
	if err != nil {
		return legacyVolumeSnapshotProof{}, err
	}
	var files []string
	err = filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if path == root {
			return nil
		}
		info, infoErr := entry.Info()
		if infoErr != nil {
			return infoErr
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return errors.New("legacy_session_snapshot_symlink_forbidden")
		}
		if entry.IsDir() {
			return nil
		}
		if !info.Mode().IsRegular() {
			return errors.New("legacy_session_snapshot_special_file_forbidden")
		}
		files = append(files, path)
		return nil
	})
	if err != nil {
		return legacyVolumeSnapshotProof{}, err
	}
	if len(files) == 0 {
		return legacyVolumeSnapshotProof{}, errors.New("legacy_session_snapshot_empty")
	}
	sort.Strings(files)
	hash := sha256.New()
	var total int64
	for _, file := range files {
		relative, relErr := filepath.Rel(root, file)
		if relErr != nil || relative == "." || strings.HasPrefix(relative, "..") {
			return legacyVolumeSnapshotProof{}, errors.New("legacy_session_snapshot_path_escape")
		}
		relative = filepath.ToSlash(relative)
		_, _ = fmt.Fprintf(hash, "%d:%s:", len([]byte(relative)), relative)
		handle, openErr := os.Open(file)
		if openErr != nil {
			return legacyVolumeSnapshotProof{}, openErr
		}
		written, copyErr := io.Copy(hash, bufio.NewReader(handle))
		closeErr := handle.Close()
		if copyErr != nil {
			return legacyVolumeSnapshotProof{}, copyErr
		}
		if closeErr != nil {
			return legacyVolumeSnapshotProof{}, closeErr
		}
		total += written
		_, _ = hash.Write([]byte("\n"))
	}
	return legacyVolumeSnapshotProof{
		Checksum:  hex.EncodeToString(hash.Sum(nil)),
		SizeBytes: total,
		Files:     int64(len(files)),
	}, nil
}

func validateSessionStorageMigrationPrepare(cfg Config, req SessionStorageMigrationPrepareRequest) error {
	if cfg.SessionStorage != SessionStorageLegacyVolume || req.Provider != "whatsmeow" ||
		req.WorkerID != cfg.WorkerID || req.AccountID != cfg.AccountID ||
		req.RuntimeGeneration != cfg.RuntimeGeneration || req.RuntimeGeneration <= 0 ||
		req.RuntimeCapability == "" || req.RuntimeCapability != cfg.RuntimeCapability ||
		req.LegacyVolumeName == "" || req.LegacyVolumeName != strings.TrimSpace(os.Getenv("SESSION_VOLUME_NAME")) {
		return errors.New("session_storage_migration_source_scope_invalid")
	}
	for _, value := range []string{req.MigrationID, req.WorkerID, req.AccountID} {
		if _, err := uuid.Parse(value); err != nil {
			return errors.New("session_storage_migration_uuid_invalid")
		}
	}
	return nil
}

func (w *Worker) PrepareSessionStorageMigration(ctx context.Context, req SessionStorageMigrationPrepareRequest) (SessionStorageMigrationPrepareResponse, error) {
	if err := validateSessionStorageMigrationPrepare(w.cfg, req); err != nil {
		return SessionStorageMigrationPrepareResponse{}, err
	}
	w.sessionMigrationMu.Lock()
	defer w.sessionMigrationMu.Unlock()
	if w.sessionMigrationID != "" && w.sessionMigrationID != req.MigrationID {
		return SessionStorageMigrationPrepareResponse{}, errors.New("another_session_storage_migration_owns_runtime")
	}
	if w.sessionMigrationResult != nil {
		return *w.sessionMigrationResult, nil
	}
	w.sessionMigrationID = req.MigrationID
	w.providerHandoffBlocked.Store(true)
	w.revokeKafkaConsumerAuthorization()
	w.kafkaConsumersReady.Store(false)
	if err := w.waitForKafkaConsumersDrained(ctx); err != nil {
		return SessionStorageMigrationPrepareResponse{}, fmt.Errorf("drain_session_storage_migration_consumers: %w", err)
	}
	phone := w.sessionMigrationPhone
	manager := w.currentWhatsApp()
	if phone == "" {
		if manager == nil {
			return SessionStorageMigrationPrepareResponse{}, errors.New("session_storage_migration_runtime_missing")
		}
		client := manager.getClient()
		if client == nil || client.Store == nil || client.Store.ID == nil || client.Store.Deleted {
			return SessionStorageMigrationPrepareResponse{}, errors.New("session_storage_migration_identity_missing")
		}
		phone = phoneFromOwnID(client.Store.ID)
		w.sessionMigrationPhone = phone
	}
	if req.ExpectedPhone != "" && normalizePhone(req.ExpectedPhone) != normalizePhone(phone) {
		return SessionStorageMigrationPrepareResponse{}, errors.New("session_storage_migration_phone_mismatch")
	}
	if manager != nil {
		manager.closeCurrentWhatsmeowClient()
	}
	proof, err := snapshotLegacyVolume(w.cfg.DataDir)
	if err != nil {
		return SessionStorageMigrationPrepareResponse{}, fmt.Errorf("snapshot_session_storage_migration: %w", err)
	}
	identityHash := sha256.Sum256([]byte(normalizePhone(phone)))
	result := SessionStorageMigrationPrepareResponse{
		MigrationID:              req.MigrationID,
		WorkerID:                 req.WorkerID,
		Provider:                 "whatsmeow",
		RuntimeGeneration:        req.RuntimeGeneration,
		Prepared:                 true,
		ConsumersDrained:         true,
		WritesPaused:             true,
		CheckpointPersisted:      true,
		ProviderDisconnected:     true,
		VolumePreserved:          true,
		CheckpointChecksumSHA256: proof.Checksum,
		CheckpointSizeBytes:      proof.SizeBytes,
		CheckpointRecordCount:    proof.Files,
		Phone:                    phone,
		IdentityHashSHA256:       hex.EncodeToString(identityHash[:]),
		PreparedAt:               time.Now().UTC().Format(time.RFC3339Nano),
	}
	w.sessionMigrationResult = &result
	return result, nil
}

func normalizePhone(value string) string {
	var result strings.Builder
	for _, char := range value {
		if char >= '0' && char <= '9' {
			result.WriteRune(char)
		}
	}
	return result.String()
}

func (m *WhatsAppManager) bootstrapLegacyVolumeMigration(ctx context.Context, revisionID int64) error {
	if m == nil || m.postgres == nil || revisionID <= 0 || m.cfg.SessionStorageMigrationID == "" {
		return wrapSafeOperationalError(
			safeCodeStartupLegacyValidationFailed,
			errors.New("legacy_volume_migration_bootstrap_scope_invalid"),
		)
	}
	legacyRoot := "/app/legacy-session"
	proof, err := snapshotLegacyVolume(legacyRoot)
	if err != nil {
		return wrapSafeOperationalError(safeCodeStartupLegacySnapshotFailed, err)
	}
	if proof.Checksum != m.cfg.LegacySessionChecksum {
		return wrapSafeOperationalError(
			safeCodeStartupLegacySnapshotFailed,
			errors.New("legacy_volume_migration_checksum_mismatch"),
		)
	}
	dbPath := filepath.Join(legacyRoot, "whatsmeow", m.cfg.WorkerID, "store.db")
	if info, statErr := os.Stat(dbPath); statErr != nil || !info.Mode().IsRegular() {
		return wrapSafeOperationalError(
			safeCodeStartupLegacySnapshotFailed,
			errors.New("legacy_volume_migration_store_missing"),
		)
	}
	sourceDB, err := sql.Open("sqlite3", "file:"+dbPath+"?mode=ro&_foreign_keys=on")
	if err != nil {
		return wrapSafeOperationalError(
			safeCodeStartupLegacyCaptureFailed,
			fmt.Errorf("open legacy volume checkpoint: %w", err),
		)
	}
	sourceDB.SetMaxOpenConns(1)
	defer sourceDB.Close()
	candidate, err := captureWhatsmeowSQLiteSnapshot(ctx, sourceDB)
	if err != nil {
		return wrapSafeOperationalError(
			safeCodeStartupLegacyCaptureFailed,
			fmt.Errorf("capture legacy volume checkpoint: %w", err),
		)
	}
	prepared, err := prepareWhatsmeowSnapshot(candidate)
	if err != nil {
		return wrapSafeOperationalError(
			safeCodeStartupLegacyValidationFailed,
			fmt.Errorf("validate legacy volume checkpoint: %w", err),
		)
	}
	fence, err := m.postgres.whatsmeowFence(m.cfg)
	if err != nil {
		return wrapSafeOperationalError(safeCodeStartupLegacyImportFailed, err)
	}
	var rows int
	err = runLegacyVolumeImportWithRetry(ctx, func(attempt int) time.Duration {
		return time.Duration(attempt) * 100 * time.Millisecond
	}, func() error {
		imported, importErr := m.importLegacyVolumeSnapshot(ctx, revisionID, proof, prepared, fence)
		if importErr == nil {
			rows = imported
		}
		return importErr
	})
	if err != nil {
		return wrapSafeOperationalError(safeCodeStartupLegacyImportFailed, err)
	}
	logWhatsappSessionDebug(m.cfg.WhatsappSessionDebugEnabled, "legacy_volume_migration.staged", map[string]any{
		"session_id": m.cfg.WorkerID,
		"provider":   "whatsmeow",
		"revision":   revisionID,
		"rows":       rows,
		"bytes":      proof.SizeBytes,
	})
	return nil
}

func (m *WhatsAppManager) importLegacyVolumeSnapshot(
	ctx context.Context,
	revisionID int64,
	proof legacyVolumeSnapshotProof,
	prepared []whatsmeowPreparedTable,
	fence whatsmeowOperationFence,
) (int, error) {
	tx, err := m.postgres.DB.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	if err := beginWhatsmeowSessionMutation(ctx, tx, m.cfg.WorkerID, revisionID, fence); err != nil {
		return 0, err
	}
	rows, err := insertWhatsmeowSnapshot(ctx, tx, m.cfg.WorkerID, revisionID, prepared)
	if err != nil {
		return 0, err
	}
	result, err := tx.ExecContext(ctx, `
		UPDATE whatsapp_session_revision
		SET status='validating', checksum_sha256=$3, size_bytes=$4,
			persisted_at=clock_timestamp(), validated_at=clock_timestamp()
		WHERE session_id=$1::uuid AND revision_id=$2
		  AND provider='whatsmeow'
		  AND source='legacy_volume_migration'
		  AND status='staging'
	`, m.cfg.WorkerID, revisionID, proof.Checksum, proof.SizeBytes)
	if err != nil {
		return 0, err
	}
	if affected, _ := result.RowsAffected(); affected != 1 {
		return 0, errors.New("legacy_volume_migration_revision_fenced")
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return rows, nil
}
