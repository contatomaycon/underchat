package app

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/store/sqlstore"
)

type workerProviderHandoffFlight struct {
	done   chan struct{}
	result ProviderHandoffPrepareResponse
	err    error
}

type whatsmeowProviderHandoffCheckpoint struct {
	RevisionID                           int64
	Checksum                             string
	SizeBytes                            int64
	RecordCount                          int64
	CanonicalSignalSessionScopes         [1]string
	CanonicalSignalSessionResyncRequired bool
	CanonicalSignalSessionResyncScopes   [2]string
}

func validateWhatsmeowProviderHandoffRequest(cfg Config, req ProviderHandoffPrepareRequest) error {
	if cfg.SessionStorage != SessionStoragePostgres {
		return errors.New("whatsmeow provider handoff requires postgres session storage")
	}
	if req.WorkerID != cfg.WorkerID || req.AccountID != cfg.AccountID ||
		req.SourceProvider != "whatsmeow" ||
		(req.TargetProvider != "baileys" && req.TargetProvider != "wwebjs") ||
		req.SourceRevisionID <= 0 || req.RuntimeGeneration <= 0 ||
		req.RuntimeGeneration != cfg.RuntimeGeneration {
		return errors.New("whatsmeow provider handoff runtime context is invalid")
	}
	for _, value := range []string{req.WorkerID, req.AccountID, req.HandoffID, req.LifecycleOperationID} {
		if _, err := uuid.Parse(strings.TrimSpace(value)); err != nil {
			return errors.New("whatsmeow provider handoff UUID is invalid")
		}
	}
	return nil
}

// PrepareProviderHandoff is the only source-drain RPC. The same
// handoff/lifecycle pair shares one flight and a completed response is replayed
// byte-for-byte. A different handoff can never reuse the fenced process.
func (w *Worker) PrepareProviderHandoff(ctx context.Context, req ProviderHandoffPrepareRequest) (ProviderHandoffPrepareResponse, error) {
	if err := validateWhatsmeowProviderHandoffRequest(w.cfg, req); err != nil {
		return ProviderHandoffPrepareResponse{}, wrapSafeOperationalError(safeCodeHandoffInputFailed, err)
	}
	// A missing portable route is a precondition failure, not a drain attempt.
	// Reject it before fencing Kafka/provider admission so the source channel
	// remains fully usable and can receive a later edge-routing update.
	if req.TargetProvider == "wwebjs" {
		manager := w.currentWhatsApp()
		if manager == nil {
			return ProviderHandoffPrepareResponse{}, errors.New("whatsmeow runtime is not initialized")
		}
		if err := manager.preflightProviderHandoffRouting(ctx, req); err != nil {
			return ProviderHandoffPrepareResponse{}, err
		}
	}
	key := req.HandoffID + ":" + req.LifecycleOperationID
	w.providerHandoffMu.Lock()
	if w.providerHandoffKey != "" && w.providerHandoffKey != key {
		w.providerHandoffMu.Unlock()
		return ProviderHandoffPrepareResponse{}, errors.New("another whatsmeow provider handoff already fenced this runtime")
	}
	if w.providerHandoffResult != nil {
		result := *w.providerHandoffResult
		w.providerHandoffMu.Unlock()
		return result, nil
	}
	if flight := w.providerHandoffFlight; flight != nil {
		w.providerHandoffMu.Unlock()
		select {
		case <-flight.done:
			return flight.result, flight.err
		case <-ctx.Done():
			return ProviderHandoffPrepareResponse{}, ctx.Err()
		}
	}
	flight := &workerProviderHandoffFlight{done: make(chan struct{})}
	w.providerHandoffKey = key
	w.providerHandoffFlight = flight
	w.providerHandoffBlocked.Store(true)
	w.revokeKafkaConsumerAuthorization()
	w.kafkaConsumersReady.Store(false)
	w.providerHandoffMu.Unlock()

	result, err := w.performPrepareProviderHandoff(ctx, req)
	w.providerHandoffMu.Lock()
	flight.result = result
	flight.err = err
	if err == nil {
		copyResult := result
		w.providerHandoffResult = &copyResult
	}
	w.providerHandoffFlight = nil
	close(flight.done)
	w.providerHandoffMu.Unlock()
	return result, err
}

func (m *WhatsAppManager) preflightProviderHandoffRouting(ctx context.Context, req ProviderHandoffPrepareRequest) error {
	if req.TargetProvider != "wwebjs" {
		return nil
	}
	client := m.getClient()
	if client == nil || client.Store == nil || client.Store.Transport == nil {
		return errors.New("whatsmeow_canonical_routing_info_unavailable")
	}
	if client.Store.SessionID != req.WorkerID || client.Store.RevisionID != req.SourceRevisionID {
		return errors.New("whatsmeow provider handoff store scope mismatch")
	}
	routingInfo, err := client.Store.Transport.GetTransportRoutingInfo(ctx)
	if err != nil {
		return fmt.Errorf("preflight whatsmeow canonical routing info: %w", err)
	}
	if store.ValidateWhatsAppTransportRoutingInfo(routingInfo) != nil {
		return errors.New("whatsmeow_canonical_routing_info_unavailable")
	}
	logWhatsappSessionDebug(m.cfg.WhatsappSessionDebugEnabled, "provider_handoff.routing_preflight", map[string]any{
		"trace_id": req.DebugTraceID, "session_id": req.WorkerID,
		"provider": "whatsmeow", "revision": req.SourceRevisionID,
		"target_provider": "wwebjs", "routing_info_size": len(routingInfo),
	})
	return nil
}

func (w *Worker) performPrepareProviderHandoff(ctx context.Context, req ProviderHandoffPrepareRequest) (ProviderHandoffPrepareResponse, error) {
	manager := w.currentWhatsApp()
	if manager == nil {
		return ProviderHandoffPrepareResponse{}, wrapSafeOperationalError(
			safeCodeHandoffSourceScopeFailed,
			errors.New("whatsmeow runtime is not initialized"),
		)
	}
	manager.sourceProviderHandoffInProgress.Store(true)
	if err := w.waitForKafkaConsumersDrained(ctx); err != nil {
		return ProviderHandoffPrepareResponse{}, wrapSafeOperationalError(
			safeCodeHandoffSourceScopeFailed,
			fmt.Errorf("drain whatsmeow kafka consumers: %w", err),
		)
	}
	checkpoint, err := manager.prepareProviderHandoff(ctx, req)
	if err != nil {
		return ProviderHandoffPrepareResponse{}, wrapSafeOperationalError(
			safeCodeHandoffSourceSnapshotFailed,
			err,
		)
	}
	return ProviderHandoffPrepareResponse{
		WorkerID: req.WorkerID, Provider: "whatsmeow",
		HandoffID: req.HandoffID, LifecycleOperationID: req.LifecycleOperationID,
		SourceRevisionID: req.SourceRevisionID, RuntimeGeneration: req.RuntimeGeneration,
		Prepared: true, ConsumersDrained: true, WritesPaused: true,
		CheckpointPersisted: true, ProviderDisconnected: true, LeaseReleased: true,
		CheckpointChecksumSHA256: checkpoint.Checksum,
		CheckpointSizeBytes:      checkpoint.SizeBytes,
		CheckpointRecordCount:    checkpoint.RecordCount,
		PreparedAt:               time.Now().UTC().Format(time.RFC3339Nano),
	}, nil
}

func (w *Worker) waitForKafkaConsumersDrained(ctx context.Context) error {
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	for {
		if !w.kafkaConsumersStarted.Load() &&
			!w.kafkaConsumersReady.Load() &&
			!w.kafkaConsumersAuthorized.Load() {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}

func (m *WhatsAppManager) waitForProviderFlightsDrained(ctx context.Context, client any) error {
	providerClient, ok := client.(*whatsmeow.Client)
	if !ok || providerClient == nil {
		return nil
	}
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	for {
		m.providerFlightMu.Lock()
		count := len(m.providerFlights[providerClient])
		m.providerFlightMu.Unlock()
		if count == 0 {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}

func (m *WhatsAppManager) prepareProviderHandoff(ctx context.Context, req ProviderHandoffPrepareRequest) (whatsmeowProviderHandoffCheckpoint, error) {
	if err := validateWhatsmeowProviderHandoffRequest(m.cfg, req); err != nil {
		return whatsmeowProviderHandoffCheckpoint{}, err
	}
	handoffKey := req.HandoffID + ":" + req.LifecycleOperationID
	m.sourceProviderHandoffMu.Lock()
	if m.sourceProviderHandoffKey != "" && m.sourceProviderHandoffKey != handoffKey {
		m.sourceProviderHandoffMu.Unlock()
		return whatsmeowProviderHandoffCheckpoint{}, errors.New("another whatsmeow source handoff already owns this runtime")
	}
	m.sourceProviderHandoffKey = handoffKey
	preparedCheckpoint := m.sourceProviderHandoffCheckpoint
	m.sourceProviderHandoffMu.Unlock()
	if preparedCheckpoint != nil {
		// Checkpointing and provider shutdown already succeeded. Retrying either
		// after those operations were fenced or after an ambiguous release response
		// must only replay the exact, idempotent lease release.
		if err := m.postgres.ReleaseSessionLeaseForHandoff(ctx); err != nil {
			return whatsmeowProviderHandoffCheckpoint{}, fmt.Errorf("retry whatsmeow provider handoff lease release: %w", err)
		}
		client := m.getClient()
		if client == nil || !client.MarkConnectionHandoffSourceClosed() {
			return whatsmeowProviderHandoffCheckpoint{}, errors.New("confirm whatsmeow provider handoff source close after lease release")
		}
		return *preparedCheckpoint, nil
	}
	client := m.getClient()
	if client == nil || client.Store == nil {
		return whatsmeowProviderHandoffCheckpoint{}, errors.New("whatsmeow provider store is not initialized")
	}
	if client.Store.SessionID != req.WorkerID || client.Store.RevisionID != req.SourceRevisionID {
		return whatsmeowProviderHandoffCheckpoint{}, errors.New("whatsmeow provider handoff store scope mismatch")
	}
	container, ok := client.Store.Container.(*sqlstore.Container)
	if !ok || container == nil {
		return whatsmeowProviderHandoffCheckpoint{}, errors.New("whatsmeow native SQLStore container is required for handoff")
	}
	if err := m.preflightProviderHandoffRouting(ctx, req); err != nil {
		return whatsmeowProviderHandoffCheckpoint{}, err
	}
	client.MarkConnectionHandoff()
	m.acceptNativeConnectionStatus(ctx, client, client.GetConnectionStatus(), true)

	_ = m.beginFencedProviderLifecycleEvent()
	m.deactivateInboundConnectionScope(ctx)
	scope := sqlstore.SessionScope{SessionID: req.WorkerID, RevisionID: req.SourceRevisionID}
	if err := container.PauseSessionOperationsAndWait(ctx, scope); err != nil {
		return whatsmeowProviderHandoffCheckpoint{}, fmt.Errorf("pause whatsmeow SQLStore: %w", err)
	}
	invalidateWhatsmeowClientCaches(client)
	if err := m.waitForProviderFlightsDrained(ctx, client); err != nil {
		return whatsmeowProviderHandoffCheckpoint{}, fmt.Errorf("drain whatsmeow provider operations: %w", err)
	}

	checkpoint, err := m.postgres.PrepareWhatsmeowProviderHandoffCheckpoint(ctx, m.cfg, req)
	if err != nil {
		return whatsmeowProviderHandoffCheckpoint{}, err
	}
	client.Disconnect()
	m.acceptNativeConnectionStatus(ctx, client, client.GetConnectionStatus(), true)
	if err := m.flushNativeConnectionStatusPersistence(ctx); err != nil {
		return whatsmeowProviderHandoffCheckpoint{}, fmt.Errorf("persist whatsmeow provider handoff status: %w", err)
	}
	m.mu.Lock()
	m.connected = false
	m.status = "disconnected"
	m.code = CodeConnectionClosed
	m.degradedReason = "provider_handoff_prepared"
	m.mu.Unlock()
	m.sourceProviderHandoffMu.Lock()
	checkpointCopy := checkpoint
	m.sourceProviderHandoffCheckpoint = &checkpointCopy
	m.sourceProviderHandoffMu.Unlock()
	if err := m.postgres.ReleaseSessionLeaseForHandoff(ctx); err != nil {
		return whatsmeowProviderHandoffCheckpoint{}, fmt.Errorf("release whatsmeow provider handoff lease: %w", err)
	}
	if !client.MarkConnectionHandoffSourceClosed() {
		return whatsmeowProviderHandoffCheckpoint{}, errors.New("confirm whatsmeow provider handoff source close after lease release")
	}
	logWhatsappSessionDebug(m.cfg.WhatsappSessionDebugEnabled, "provider_handoff.prepared", map[string]any{
		"trace_id": req.DebugTraceID, "session_id": req.WorkerID,
		"provider": "whatsmeow", "handoff_id": req.HandoffID,
		"lifecycle_operation_id": req.LifecycleOperationID,
		"revision":               req.SourceRevisionID, "generation": req.RuntimeGeneration,
		"target_provider":                          req.TargetProvider,
		"checkpoint_checksum_sha256":               checkpoint.Checksum,
		"checkpoint_size_bytes":                    checkpoint.SizeBytes,
		"checkpoint_record_count":                  checkpoint.RecordCount,
		"canonical_signal_session_scopes":          checkpoint.CanonicalSignalSessionScopes,
		"canonical_signal_session_resync_required": checkpoint.CanonicalSignalSessionResyncRequired,
		"canonical_signal_session_resync_scopes":   checkpoint.CanonicalSignalSessionResyncScopes,
		"lease_released":                           true,
	})
	return checkpoint, nil
}

func (p *WorkerPostgres) PrepareWhatsmeowProviderHandoffCheckpoint(ctx context.Context, cfg Config, req ProviderHandoffPrepareRequest) (whatsmeowProviderHandoffCheckpoint, error) {
	if p == nil || p.DB == nil {
		return whatsmeowProviderHandoffCheckpoint{}, errors.New("worker database is unavailable")
	}
	fence, err := p.whatsmeowFence(cfg)
	if err != nil {
		return whatsmeowProviderHandoffCheckpoint{}, err
	}
	tx, err := p.DB.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return whatsmeowProviderHandoffCheckpoint{}, err
	}
	defer tx.Rollback()
	if err := beginWhatsmeowSessionOperation(ctx, tx, cfg.WorkerID, req.SourceRevisionID, fence); err != nil {
		return whatsmeowProviderHandoffCheckpoint{}, err
	}
	var revisionStatus string
	var jid sql.NullString
	var nextPreKeyID sql.NullInt64
	var fingerprint []byte
	var fingerprintVersion sql.NullString
	err = tx.QueryRowContext(ctx, `
		SELECT revision.status, device.jid, device.next_pre_key_id,
		       device.device_fingerprint, device.fingerprint_version
		FROM whatsapp_session AS session
		JOIN whatsapp_session_revision AS revision
		  ON revision.session_id=session.session_id
		 AND revision.revision_id=session.active_revision_id
		JOIN whatsapp_session_handoff AS handoff
		  ON handoff.session_id=session.session_id
		 AND handoff.source_revision_id=revision.revision_id
		LEFT JOIN whatsapp_device AS device
		  ON device.session_id=revision.session_id
		 AND device.revision_id=revision.revision_id
		WHERE session.session_id=$1::uuid
		  AND session.provider='whatsmeow' AND session.state='handoff'
		  AND session.active_revision_id=$2::bigint
		  AND revision.provider='whatsmeow'
		  AND revision.status IN ('staging', 'validating', 'active')
		  AND handoff.handoff_id=$3::uuid
		  AND handoff.lifecycle_operation_id=$4::uuid
		  AND handoff.source_provider='whatsmeow'
		  AND handoff.target_provider=$5
		  AND handoff.state IN ('requested', 'draining')
		FOR SHARE OF session, revision
	`, cfg.WorkerID, req.SourceRevisionID, req.HandoffID,
		req.LifecycleOperationID, req.TargetProvider).Scan(
		&revisionStatus, &jid, &nextPreKeyID, &fingerprint,
		&fingerprintVersion,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return whatsmeowProviderHandoffCheckpoint{}, wrapSafeOperationalError(
				safeCodeHandoffSourceStateConflict,
				fmt.Errorf("authorize whatsmeow source handoff checkpoint: %w", err),
			)
		}
		return whatsmeowProviderHandoffCheckpoint{}, fmt.Errorf("authorize whatsmeow source handoff checkpoint: %w", err)
	}
	prepared := []whatsmeowPreparedTable{}
	if jid.Valid && strings.TrimSpace(jid.String) != "" {
		if len(fingerprint) != sha256.Size || !nextPreKeyID.Valid ||
			!fingerprintVersion.Valid || fingerprintVersion.String != sqlstore.DeviceFingerprintVersion {
			return whatsmeowProviderHandoffCheckpoint{}, errors.New("whatsmeow handoff device identity is incomplete")
		}
		// This is a logical default-only export. Never DELETE or rewrite the
		// source revision here: after promotion it is the byte-identical rollback
		// revision. Each target filters and materializes its own candidate.
		snapshot, captureErr := captureWhatsmeowSnapshot(ctx, tx, cfg.WorkerID,
			req.SourceRevisionID, jid.String, nextPreKeyID.Int64)
		if captureErr != nil {
			return whatsmeowProviderHandoffCheckpoint{}, fmt.Errorf("capture whatsmeow source handoff checkpoint: %w", captureErr)
		}
		snapshot.DeviceFingerprint = append([]byte(nil), fingerprint...)
		snapshot.FingerprintVersion = fingerprintVersion.String
		prepared, err = prepareWhatsmeowSnapshot(snapshot)
		if err != nil {
			return whatsmeowProviderHandoffCheckpoint{}, fmt.Errorf("prepare whatsmeow source handoff checkpoint: %w", err)
		}
		if req.TargetProvider == "wwebjs" {
			_, hasRoutingInfo, routeErr := preparedWhatsmeowTransportRoutingInfo(prepared)
			if routeErr != nil {
				return whatsmeowProviderHandoffCheckpoint{}, routeErr
			} else if !hasRoutingInfo {
				return whatsmeowProviderHandoffCheckpoint{}, errors.New("whatsmeow_canonical_routing_info_unavailable")
			}
		}
	} else if revisionStatus == "active" {
		return whatsmeowProviderHandoffCheckpoint{}, errors.New("active whatsmeow handoff source has no companion identity")
	}
	if err := tx.Commit(); err != nil {
		return whatsmeowProviderHandoffCheckpoint{}, err
	}

	checksum, sizeBytes, err := checksumWhatsmeowPreparedProjection(prepared)
	if err != nil {
		return whatsmeowProviderHandoffCheckpoint{}, err
	}
	var recordCount int64
	for _, table := range prepared {
		recordCount += int64(len(table.Rows))
	}
	checkpoint := whatsmeowProviderHandoffCheckpoint{
		RevisionID: req.SourceRevisionID, Checksum: checksum,
		SizeBytes: sizeBytes, RecordCount: recordCount,
		CanonicalSignalSessionScopes:         [1]string{"default"},
		CanonicalSignalSessionResyncRequired: true,
		CanonicalSignalSessionResyncScopes:   [2]string{"status", "pq"},
	}

	writeTx, err := p.DB.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return whatsmeowProviderHandoffCheckpoint{}, err
	}
	defer writeTx.Rollback()
	if err := beginWhatsmeowSessionMutation(ctx, writeTx, cfg.WorkerID, req.SourceRevisionID, fence); err != nil {
		return whatsmeowProviderHandoffCheckpoint{}, err
	}
	result, err := writeTx.ExecContext(ctx, `
		UPDATE whatsapp_session_revision
		SET size_bytes=$3::bigint, persisted_at=clock_timestamp()
		WHERE session_id=$1::uuid AND revision_id=$2::bigint
		  AND provider='whatsmeow'
		  AND status IN ('staging', 'validating', 'active')
	`, cfg.WorkerID, req.SourceRevisionID, sizeBytes)
	if err != nil {
		return whatsmeowProviderHandoffCheckpoint{}, err
	}
	if rows, _ := result.RowsAffected(); rows != 1 {
		return whatsmeowProviderHandoffCheckpoint{}, errors.New("whatsmeow source checkpoint revision changed")
	}
	proof, err := writeTx.ExecContext(ctx, `
		INSERT INTO whatsapp_artifact (
		  session_id, artifact_id, revision_id, provider, kind, status,
		  manifest, checksum_sha256, size_bytes, chunk_count
		) VALUES (
		  $1::uuid, $3::uuid, $2::bigint, 'whatsmeow',
		  'provider_handoff_checkpoint', 'ready',
		  jsonb_build_object(
		    'handoff_id', $3::text,
		    'lifecycle_operation_id', $4::text,
		    'record_count', $7::bigint,
		    'canonical_signal_session_scopes', jsonb_build_array('default'),
		    'canonical_signal_session_resync_required', true,
		    'canonical_signal_session_resync_scopes', jsonb_build_array('status', 'pq'),
		    'app_state_snapshot_resync_required', false,
		    'app_state_snapshot_resync_collections', jsonb_build_array()
		  ), $5, $6::bigint, 0
		)
		ON CONFLICT (session_id, artifact_id) DO UPDATE SET
		  revision_id=EXCLUDED.revision_id, provider=EXCLUDED.provider,
		  kind=EXCLUDED.kind, status=EXCLUDED.status,
		  manifest=EXCLUDED.manifest,
		  checksum_sha256=EXCLUDED.checksum_sha256,
		  size_bytes=EXCLUDED.size_bytes, chunk_count=0,
		  persisted_at=clock_timestamp()
		WHERE whatsapp_artifact.revision_id=EXCLUDED.revision_id
		  AND whatsapp_artifact.provider='whatsmeow'
		  AND whatsapp_artifact.kind='provider_handoff_checkpoint'
	`, cfg.WorkerID, req.SourceRevisionID, req.HandoffID,
		req.LifecycleOperationID, checksum, sizeBytes, recordCount)
	if err != nil {
		return whatsmeowProviderHandoffCheckpoint{}, err
	}
	if rows, _ := proof.RowsAffected(); rows != 1 {
		return whatsmeowProviderHandoffCheckpoint{}, errors.New("whatsmeow source checkpoint proof changed")
	}
	if err := writeTx.Commit(); err != nil {
		return whatsmeowProviderHandoffCheckpoint{}, err
	}
	if _, decodeErr := hex.DecodeString(checksum); decodeErr != nil || len(checksum) != sha256.Size*2 {
		return whatsmeowProviderHandoffCheckpoint{}, errors.New("whatsmeow source checkpoint checksum is invalid")
	}
	return checkpoint, nil
}
