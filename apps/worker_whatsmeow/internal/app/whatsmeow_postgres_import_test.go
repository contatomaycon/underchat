package app

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"
	"go.mau.fi/libsignal/ecc"
	"go.mau.fi/libsignal/keys/chain"
	signalrecord "go.mau.fi/libsignal/state/record"
	"go.mau.fi/whatsmeow/proto/waAdv"
	meowstore "go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/util/keys"
)

type fakeWhatsmeowRuntimeFenceActivator struct {
	request WhatsappRuntimeFenceActivationRequest
	err     error
	calls   int
}

func validWhatsmeowPQRollbackMarker(provider string) whatsmeowPQRollbackMarker {
	uploadLifecycleFenced := true
	uploadLifecycleFenceVersion := whatsmeowPQUploadLifecycleFenceV1
	runtimeUploadEnabled := false
	runtimeMessagingEnabled := false
	marker := whatsmeowPQRollbackMarker{
		Version:                 1,
		State:                   "acknowledged",
		HandoffID:               "0198b905-35db-75de-a48f-99dd9133273c",
		LifecycleOperationID:    "0198b905-35db-75de-a48f-99dd9133273d",
		SourceRevisionID:        "41",
		TargetProvider:          "whatsmeow",
		OwnerID:                 "0198b905-35db-75de-a48f-99dd9133273e",
		FencingToken:            "73",
		Generation:              7,
		Epoch:                   "0198b905-35db-75de-a48f-99dd9133273f",
		CreatedAtMS:             1_770_000_000_000,
		Protocol:                whatsmeowPQRollbackProtocol,
		ServerAcknowledged:      true,
		LocalCleanupComplete:    true,
		AcknowledgedAtMS:        1_770_000_000_100,
		ResponseValidated:       true,
		UploadLifecycleFenced:   &uploadLifecycleFenced,
		UploadLifecycleFenceVer: &uploadLifecycleFenceVersion,
	}
	if provider == "wwebjs" {
		marker.RuntimeUploadEnabled = &runtimeUploadEnabled
		marker.RuntimeMessagingEnabled = &runtimeMessagingEnabled
	}
	return marker
}

func newWhatsmeowGuardTestPostgres(
	t *testing.T,
) (*WorkerPostgres, sqlmock.Sqlmock, Config, whatsmeowOperationFence) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	now := time.Now()
	fence := whatsmeowOperationFence{
		OwnerID:      uuid.NewString(),
		FencingToken: 41,
		Generation:   7,
		Epoch:        uuid.NewString(),
		Capability:   strings.Repeat("c", 64),
	}
	cfg := Config{WorkerID: uuid.NewString()}
	postgres := &WorkerPostgres{
		DB: db,
		lease: &whatsappSessionLeaseState{
			sessionID:     cfg.WorkerID,
			provider:      "whatsmeow",
			ownerID:       fence.OwnerID,
			fencingToken:  fence.FencingToken,
			generation:    fence.Generation,
			epoch:         fence.Epoch,
			capability:    fence.Capability,
			expiresAt:     now.Add(time.Minute),
			localDeadline: now.Add(time.Minute),
		},
	}
	return postgres, mock, cfg, fence
}

func TestWhatsmeowSessionScopesChooseReadAndMutationDatabaseGuards(t *testing.T) {
	const revisionID int64 = 17

	t.Run("read operation", func(t *testing.T) {
		postgres, mock, cfg, fence := newWhatsmeowGuardTestPostgres(t)
		mock.ExpectBegin()
		mock.ExpectQuery(`SELECT begin_whatsapp_session_operation`).
			WithArgs(cfg.WorkerID, revisionID, fence.OwnerID, fence.FencingToken,
				fence.Generation, fence.Epoch, fence.Capability).
			WillReturnRows(sqlmock.NewRows([]string{"accepted"}).AddRow(true))
		mock.ExpectQuery(`SELECT provider FROM whatsapp_session`).
			WithArgs(cfg.WorkerID).
			WillReturnRows(sqlmock.NewRows([]string{"provider"}).AddRow("whatsmeow"))
		mock.ExpectCommit()

		err := postgres.withWhatsmeowSessionOperation(
			context.Background(), cfg, revisionID,
			func(tx *sql.Tx, _ whatsmeowOperationFence) error {
				var provider string
				return tx.QueryRowContext(
					context.Background(),
					`SELECT provider FROM whatsapp_session WHERE session_id=$1::uuid`,
					cfg.WorkerID,
				).Scan(&provider)
			},
		)
		if err != nil {
			t.Fatalf("read operation guard failed: %v", err)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
	})

	t.Run("mutation", func(t *testing.T) {
		postgres, mock, cfg, fence := newWhatsmeowGuardTestPostgres(t)
		mock.ExpectBegin()
		mock.ExpectQuery(`SELECT begin_whatsapp_session_mutation`).
			WithArgs(cfg.WorkerID, revisionID, fence.OwnerID, fence.FencingToken,
				fence.Generation, fence.Epoch, fence.Capability).
			WillReturnRows(sqlmock.NewRows([]string{"accepted"}).AddRow(true))
		mock.ExpectExec(`UPDATE whatsapp_session_revision`).
			WithArgs(cfg.WorkerID, revisionID).
			WillReturnResult(sqlmock.NewResult(0, 1))
		mock.ExpectCommit()

		err := postgres.withWhatsmeowSessionMutation(
			context.Background(), cfg, revisionID,
			func(tx *sql.Tx, _ whatsmeowOperationFence) error {
				_, execErr := tx.ExecContext(
					context.Background(),
					`UPDATE whatsapp_session_revision SET persisted_at=clock_timestamp() WHERE session_id=$1::uuid AND revision_id=$2`,
					cfg.WorkerID,
					revisionID,
				)
				return execErr
			},
		)
		if err != nil {
			t.Fatalf("mutation guard failed: %v", err)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
	})
}

func TestWhatsmeowWorkerFirstLifecycleHasNoOuterSessionGuard(t *testing.T) {
	postgres, mock, cfg, fence := newWhatsmeowGuardTestPostgres(t)
	const sourceRevision int64 = 11
	const targetRevision int64 = 12
	// The lifecycle function itself owns worker -> lease -> session ordering.
	// An unexpected begin_operation/begin_mutation query before it fails this
	// ordered sqlmock expectation and protects against lock-order regression.
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT promote_whatsapp_session_revision`).
		WithArgs(cfg.WorkerID, sourceRevision, targetRevision, fence.OwnerID,
			fence.FencingToken, fence.Generation, fence.Epoch, fence.Capability,
			"5511999999999:1@s.whatsapp.net").
		WillReturnRows(sqlmock.NewRows([]string{"promoted"}).AddRow(true))
	mock.ExpectCommit()

	err := postgres.withWhatsmeowSessionLifecycle(
		context.Background(), cfg,
		func(tx *sql.Tx, lifecycleFence whatsmeowOperationFence) error {
			var promoted bool
			return tx.QueryRowContext(context.Background(), `
				SELECT promote_whatsapp_session_revision(
					$1::uuid, $2, $3, $4::uuid, $5, $6, $7::uuid, $8, $9
				)
			`, cfg.WorkerID, sourceRevision, targetRevision,
				lifecycleFence.OwnerID, lifecycleFence.FencingToken,
				lifecycleFence.Generation, lifecycleFence.Epoch,
				lifecycleFence.Capability,
				"5511999999999:1@s.whatsapp.net").Scan(&promoted)
		},
	)
	if err != nil {
		t.Fatalf("worker-first lifecycle transaction failed: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestBeginWhatsmeowSessionLifecycleUsesAuthorizedDatabaseBoundary(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	workerID := "0198b905-1fb1-7b4f-9c6d-dbd24078ef11"
	accountID := "0198b905-1fb1-7b4f-9c6d-dbd24078ef12"
	scope := workerOperationScope{
		workerID: workerID, accountID: accountID, provider: "whatsmeow",
		generation: 7, writerEpoch: "0198b905-1fb1-7b4f-9c6d-dbd24078ef13",
		capability: strings.Repeat("c", 64), container: strings.Repeat("a", 12),
	}
	postgres := &WorkerPostgres{DB: db, operationScope: &scope}
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT begin_whatsapp_session_lifecycle`).
		WithArgs(workerID, accountID, scope.provider, scope.generation,
			scope.writerEpoch, scope.capability, scope.container).
		WillReturnRows(sqlmock.NewRows([]string{"accepted"}).AddRow(true))
	mock.ExpectCommit()

	tx, err := db.BeginTx(context.Background(), &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		t.Fatal(err)
	}
	if err := postgres.beginWhatsmeowSessionLifecycle(
		context.Background(), tx, workerID, accountID,
	); err != nil {
		t.Fatalf("authorized lifecycle boundary failed: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestStageWhatsmeowSecureImportUsesMutationGuardBeforeProjectionDML(t *testing.T) {
	postgres, mock, cfg, fence := newWhatsmeowGuardTestPostgres(t)
	const activeRevision int64 = 21
	const candidateRevision int64 = 22
	handoffID := uuid.NewString()
	descriptor, ok := descriptorForWhatsmeowTable("whatsapp_device")
	if !ok {
		t.Fatal("whatsapp device descriptor is unavailable")
	}

	mock.ExpectQuery(`SELECT revision_id, status, handoff_id::text`).
		WithArgs(cfg.WorkerID, fence.OwnerID, fence.FencingToken,
			fence.Generation, fence.Epoch, fence.Capability,
			"pairing",
			sqlstore.SharedSchemaVersion, whatsappCanonicalCodecVersion,
			whatsappCanonicalFormat).
		WillReturnRows(sqlmock.NewRows([]string{"revision_id", "status", "handoff_id"}).
			AddRow(activeRevision, "active", nil))
	mock.ExpectBegin()
	mock.ExpectQuery(`FROM create_whatsapp_session_candidate`).
		WithArgs(cfg.WorkerID, activeRevision, fence.OwnerID,
			fence.FencingToken, fence.Generation, fence.Epoch, fence.Capability,
			sqlstore.SharedSchemaVersion, whatsappCanonicalCodecVersion,
			whatsappCanonicalFormat).
		WillReturnRows(sqlmock.NewRows([]string{"revision_id", "handoff_id", "source_revision_id"}).
			AddRow(candidateRevision, handoffID, activeRevision))
	mock.ExpectQuery(`SELECT begin_whatsapp_session_mutation`).
		WithArgs(cfg.WorkerID, candidateRevision, fence.OwnerID,
			fence.FencingToken, fence.Generation, fence.Epoch, fence.Capability).
		WillReturnRows(sqlmock.NewRows([]string{"accepted"}).AddRow(true))
	mock.ExpectExec(`UPDATE whatsapp_session_revision`).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`UPDATE whatsapp_session_handoff`).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	stage, err := postgres.stageWhatsmeowSecureImport(
		context.Background(),
		cfg,
		whatsmeowSessionSnapshot{JID: "5511999999999:1@s.whatsapp.net"},
		[]whatsmeowPreparedTable{{
			Name:    descriptor.Name,
			Columns: append([]string(nil), descriptor.Columns...),
		}},
		[]byte("encrypted-import-fixture"),
	)
	if err != nil {
		t.Fatalf("stage secure import: %v", err)
	}
	if stage.CandidateRevision != candidateRevision ||
		stage.PreviousRevision != activeRevision || stage.HandoffID != handoffID {
		t.Fatalf("unexpected import stage: %+v", stage)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestWhatsmeowHandoffPreflightRejectsOversizedSourceBeforeMaterialization(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectBegin()
	tx, err := db.BeginTx(context.Background(), &sql.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatal(err)
	}
	mock.ExpectQuery(`(?s)SELECT COUNT\(\*\).*pg_column_size\(projected\).*FROM whatsapp_device`).
		WithArgs("019f6f00-0000-7000-8000-000000000001", int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{"row_count", "payload_bytes"}).
			AddRow(whatsmeowProjectionMaxRows+1, 1024))

	rows, size, err := preflightWhatsmeowSnapshotBounds(
		context.Background(), tx,
		"019f6f00-0000-7000-8000-000000000001", 10,
	)
	if err == nil || !strings.Contains(err.Error(), "exceeds preflight limits") {
		t.Fatalf("oversized projection was accepted: rows=%d bytes=%d err=%v", rows, size, err)
	}
	if rows != whatsmeowProjectionMaxRows+1 || size != 1024 {
		t.Fatalf("unexpected rejected totals: rows=%d bytes=%d", rows, size)
	}
	mock.ExpectRollback()
	if err := tx.Rollback(); err != nil {
		t.Fatal(err)
	}
	// No target transaction/DML expectation is registered: any target or source
	// mutation before this rejection would make sqlmock fail the test.
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func (f *fakeWhatsmeowRuntimeFenceActivator) ActivateRuntimeFence(
	_ context.Context,
	_ Config,
	request WhatsappRuntimeFenceActivationRequest,
) (WhatsappRuntimeFenceActivationResponse, error) {
	f.calls++
	f.request = request
	if f.err != nil {
		return WhatsappRuntimeFenceActivationResponse{}, f.err
	}
	return WhatsappRuntimeFenceActivationResponse{
		Activated:          true,
		ConnectionSequence: 1,
	}, nil
}

func TestWhatsmeowSecureImportActivatesFenceForEmptyPostgresChannel(t *testing.T) {
	cfg := Config{
		WorkerID:          uuid.NewString(),
		AccountID:         uuid.NewString(),
		RuntimeGeneration: 17,
	}
	activator := &fakeWhatsmeowRuntimeFenceActivator{}
	connectionEpoch, err := whatsmeowSecureImportConnectionEpoch(cfg, "connection-attempt-42")
	if err != nil {
		t.Fatal(err)
	}
	if err := activateWhatsmeowSecureImportFence(context.Background(), cfg, connectionEpoch, activator); err != nil {
		t.Fatalf("activate empty-channel import fence: %v", err)
	}
	if activator.calls != 1 {
		t.Fatalf("expected one canonical activation, got %d", activator.calls)
	}
	request := activator.request
	if request.WorkerID != cfg.WorkerID || request.AccountID != cfg.AccountID ||
		request.SourceProvider != "whatsmeow" || request.RuntimeGeneration != cfg.RuntimeGeneration {
		t.Fatalf("unexpected secure-import fence identity: %+v", request)
	}
	if _, err := uuid.Parse(request.ConnectionEpoch); err != nil {
		t.Fatalf("secure import did not allocate a valid connection epoch: %v", err)
	}
	secondEpoch, err := whatsmeowSecureImportConnectionEpoch(cfg, "connection-attempt-42")
	if err != nil || secondEpoch != request.ConnectionEpoch {
		t.Fatalf("secure import retry changed its activation epoch: first=%s second=%s err=%v", request.ConnectionEpoch, secondEpoch, err)
	}
}

func TestWhatsmeowSecureImportRejectsStaleContainerOrCapabilityFence(t *testing.T) {
	for _, rejection := range []string{
		"runtime fence activation rejected: stale container",
		"runtime fence activation rejected: stale capability",
	} {
		t.Run(rejection, func(t *testing.T) {
			activator := &fakeWhatsmeowRuntimeFenceActivator{err: errors.New(rejection)}
			err := activateWhatsmeowSecureImportFence(
				context.Background(),
				Config{WorkerID: uuid.NewString(), AccountID: uuid.NewString(), RuntimeGeneration: 3},
				uuid.NewString(),
				activator,
			)
			if err == nil || !strings.Contains(err.Error(), rejection) {
				t.Fatalf("stale canonical fence was not propagated: %v", err)
			}
			if activator.calls != 1 {
				t.Fatalf("expected one rejected activation, got %d", activator.calls)
			}
		})
	}
}

func TestWhatsmeowPostgresImportUsesOnlyGenericScopedTables(t *testing.T) {
	foundPrivacyTokens, foundLIDMap := false, false
	for _, descriptor := range whatsmeowScopedTables {
		if len(descriptor.Columns) != len(descriptor.Kinds) {
			t.Fatalf("descriptor %s has mismatched columns and kinds", descriptor.Name)
		}
		if !strings.HasPrefix(descriptor.Name, "whatsapp_") {
			t.Fatalf("projection table is not generic: %s", descriptor.Name)
		}
		for _, column := range descriptor.Columns {
			if column == "session_id" || column == "revision_id" || column == "our_jid" {
				t.Fatalf("source ownership column %s leaked into %s", column, descriptor.Name)
			}
		}
		for _, orderColumn := range whatsmeowSnapshotOrderColumns[descriptor.Name] {
			found := false
			for _, column := range descriptor.Columns {
				if column == orderColumn {
					found = true
					break
				}
			}
			if !found {
				t.Fatalf("snapshot order column %s is not projected by %s", orderColumn, descriptor.Name)
			}
		}
		switch descriptor.Name {
		case "whatsapp_privacy_tokens":
			foundPrivacyTokens = true
		case "whatsapp_lid_map":
			foundLIDMap = true
		}
	}
	if !foundPrivacyTokens {
		t.Fatal("privacy tokens are missing from the channel-scoped snapshot")
	}
	if !foundLIDMap {
		t.Fatal("LID mappings are missing from the session-scoped projection")
	}
}

func TestWhatsmeowSnapshotSourceFilterKeepsOnlyTheScopeMeowMaintains(t *testing.T) {
	for _, provider := range []string{"baileys", "wwebjs", "whatsmeow", ""} {
		if got := whatsmeowSnapshotSourceFilter("whatsapp_signal_sessions", provider); got != " AND scope='default'" {
			t.Fatalf("Signal filter for provider %q = %q", provider, got)
		}
	}
	if got := whatsmeowSnapshotSourceFilter("whatsapp_pre_keys", "baileys"); got != "" {
		t.Fatalf("unexpected non-Signal source filter: %q", got)
	}
	wwebMACFilter := whatsmeowSnapshotSourceFilter(
		"whatsapp_app_state_mutation_macs", "wwebjs",
	)
	if !strings.Contains(wwebMACFilter, "whatsapp_app_state_mutation_macs.version <= version.version") {
		t.Fatalf("WWeb future mutation MAC filter is missing: %q", wwebMACFilter)
	}
	for _, provider := range []string{"baileys", "whatsmeow", ""} {
		if got := whatsmeowSnapshotSourceFilter(
			"whatsapp_app_state_mutation_macs", provider,
		); got != "" {
			t.Fatalf("unexpected mutation MAC filter for provider %q: %q", provider, got)
		}
	}
	if got := whatsmeowSnapshotSourceFilter("whatsapp_provider_record", "wwebjs"); got != " AND namespace='whatsapp/transport' AND record_key='routing_info'" {
		t.Fatalf("transport source filter is not exact: %q", got)
	}
}

func TestValidateWhatsmeowWWebPQMetadataFailsClosed(t *testing.T) {
	marker := validWhatsmeowPQRollbackMarker("wwebjs")
	runtimeEnabled := true
	marker.RuntimeUploadEnabled = &runtimeEnabled
	marker.RuntimeMessagingEnabled = &runtimeEnabled
	metadata := func(capabilities string) []byte {
		return []byte(fmt.Sprintf(`{
			"schema_version": %d,
			"codec_kind": "wwebjs-canonical-session-v1",
			"codec_version": 1,
			"module_abi": "wwebjs-private-modules-v1",
			"complete": true,
			"capabilities": %s
		}`, sqlstore.SharedSchemaVersion, capabilities))
	}
	safe := metadata(fmt.Sprintf(`{
		"pq_migrated": false,
		"pq_upload_enabled": true,
		"pq_messaging_enabled": true,
		"pq_storage_mode": "rollout_without_tables",
		"pq_pre_key_count": 0,
		"pq_last_resort_key_count": 0,
		"pq_server_rollback_acknowledged": true,
		"pq_server_rollback_protocol": %q,
		"pq_server_rollback_handoff_id": %q,
		"pq_server_rollback_lifecycle_operation_id": %q,
		"pq_server_rollback_source_revision_id": %q,
		"pq_server_rollback_owner_id": %q,
		"pq_server_rollback_fencing_token": %q,
		"pq_server_rollback_generation": %d,
		"pq_server_rollback_epoch": %q,
		"pq_server_rollback_acknowledged_at_ms": %d,
		"pq_server_rollback_response_validated": true,
		"pq_upload_lifecycle_fenced": true,
		"pq_upload_lifecycle_fence_version": 1,
		"pq_runtime_upload_enabled": true,
		"pq_runtime_messaging_enabled": true,
		"app_state_snapshot_resync_required": false,
		"app_state_snapshot_resync_collections": []
	}`, marker.Protocol, marker.HandoffID, marker.LifecycleOperationID,
		marker.SourceRevisionID, marker.OwnerID, marker.FencingToken,
		marker.Generation, marker.Epoch, marker.AcknowledgedAtMS))
	if err := validateWhatsmeowWWebPQMetadata(safe, 1, 0, marker); err != nil {
		t.Fatalf("empty WWeb PQ state with DB-bound rollout flags was rejected: %v", err)
	}
	runtimeDisabled := false
	divergedRuntimeMarker := marker
	divergedRuntimeMarker.RuntimeUploadEnabled = &runtimeDisabled
	if err := validateWhatsmeowWWebPQMetadata(
		safe, 1, 0, divergedRuntimeMarker,
	); err == nil || err.Error() != "whatsmeow_wwebjs_pq_rollback_proof_diverged" {
		t.Fatalf("divergent DB-bound runtime flags must fail closed, got %v", err)
	}
	divergedMarker := marker
	divergedMarker.OwnerID = "0198b905-35db-75de-a48f-99dd91332740"
	if err := validateWhatsmeowWWebPQMetadata(
		safe, 1, 0, divergedMarker,
	); err == nil || err.Error() != "whatsmeow_wwebjs_pq_rollback_proof_diverged" {
		t.Fatalf("divergent DB-bound proof must fail closed, got %v", err)
	}
	legacyWithoutUploadFence := append([]byte(nil), safe...)
	legacyWithoutUploadFence = bytes.Replace(
		legacyWithoutUploadFence,
		[]byte(`"pq_upload_lifecycle_fenced": true,`), nil, 1,
	)
	legacyWithoutUploadFence = bytes.Replace(
		legacyWithoutUploadFence,
		[]byte(`"pq_upload_lifecycle_fence_version": 1,`), nil, 1,
	)
	unfencedMetadata := bytes.Replace(
		append([]byte(nil), safe...),
		[]byte(`"pq_upload_lifecycle_fenced": true`),
		[]byte(`"pq_upload_lifecycle_fenced": false`), 1,
	)
	unfencedMarker := marker
	uploadLifecycleFenced := false
	unfencedMarker.UploadLifecycleFenced = &uploadLifecycleFenced
	if err := validateWhatsmeowWWebPQMetadata(
		unfencedMetadata, 1, 0, unfencedMarker,
	); err == nil || err.Error() != "whatsmeow_wwebjs_pq_rollback_proof_diverged" {
		t.Fatalf("mutually unfenced metadata and marker must fail closed, got %v", err)
	}

	active := append([]byte(nil), safe...)
	for _, replacement := range [][2]string{
		{`"pq_migrated": false`, `"pq_migrated": true`},
		{`"pq_storage_mode": "rollout_without_tables"`, `"pq_storage_mode": "legacy_tables"`},
		{`"pq_pre_key_count": 0`, `"pq_pre_key_count": 100`},
		{`"pq_last_resort_key_count": 0`, `"pq_last_resort_key_count": 1`},
	} {
		active = bytes.Replace(active, []byte(replacement[0]), []byte(replacement[1]), 1)
	}
	for name, test := range map[string]struct {
		payload    []byte
		codec      int
		pqSessions int64
		want       string
	}{
		"missing capability fields": {
			payload: metadata(`{}`), codec: 1,
			want: "whatsmeow_wwebjs_app_state_snapshot_resync_manifest_missing",
		},
		"legacy proof without upload lifecycle fence": {
			payload: legacyWithoutUploadFence, codec: 1,
			want: "whatsmeow_wwebjs_pq_rollback_proof_diverged",
		},
		"malformed metadata": {
			payload: []byte(`{"complete":`), codec: 1,
			want: "whatsmeow_wwebjs_pqxdh_state_unknown",
		},
		"wrong provider record codec": {
			payload: safe, codec: 2,
			want: "whatsmeow_wwebjs_pqxdh_state_unknown",
		},
		"active kyber material": {
			payload: active, codec: 1,
			want: "whatsmeow_wwebjs_pqxdh_state_unportable",
		},
		"pq scoped signal session": {
			payload: safe, codec: 1, pqSessions: 1,
			want: "whatsmeow_wwebjs_pqxdh_state_unportable",
		},
	} {
		t.Run(name, func(t *testing.T) {
			err := validateWhatsmeowWWebPQMetadata(
				test.payload, test.codec, test.pqSessions, marker,
			)
			if err == nil || err.Error() != test.want {
				t.Fatalf("error = %v, want %s", err, test.want)
			}
		})
	}
}

func TestValidateWhatsmeowPQRollbackMarkerRejectsForgedStaleAndLegacyLineage(t *testing.T) {
	for _, provider := range []string{"baileys", "wwebjs"} {
		t.Run(provider, func(t *testing.T) {
			valid := validWhatsmeowPQRollbackMarker(provider)
			if err := validateWhatsmeowPQRollbackMarker(
				valid, provider, 41, valid.HandoffID, valid.LifecycleOperationID,
			); err != nil {
				t.Fatalf("valid marker was rejected: %v", err)
			}

			for name, mutate := range map[string]func(*whatsmeowPQRollbackMarker){
				"intent without acknowledgement": func(marker *whatsmeowPQRollbackMarker) {
					marker.State = "intent"
				},
				"forged server response": func(marker *whatsmeowPQRollbackMarker) {
					marker.ResponseValidated = false
				},
				"stale source revision": func(marker *whatsmeowPQRollbackMarker) {
					marker.SourceRevisionID = "40"
				},
				"divergent lifecycle": func(marker *whatsmeowPQRollbackMarker) {
					marker.LifecycleOperationID = "0198b905-35db-75de-a48f-99dd91332741"
				},
				"invalid source fence": func(marker *whatsmeowPQRollbackMarker) {
					marker.FencingToken = "0"
				},
				"legacy proof without upload lifecycle fence": func(marker *whatsmeowPQRollbackMarker) {
					marker.UploadLifecycleFenced = nil
					marker.UploadLifecycleFenceVer = nil
				},
				"upload lifecycle not fenced": func(marker *whatsmeowPQRollbackMarker) {
					fenced := false
					marker.UploadLifecycleFenced = &fenced
				},
				"unsupported upload lifecycle fence version": func(marker *whatsmeowPQRollbackMarker) {
					version := 2
					marker.UploadLifecycleFenceVer = &version
				},
			} {
				t.Run(name, func(t *testing.T) {
					marker := valid
					mutate(&marker)
					err := validateWhatsmeowPQRollbackMarker(
						marker, provider, 41, valid.HandoffID,
						valid.LifecycleOperationID,
					)
					want := "whatsmeow_" + provider + "_pq_rollback_proof_invalid"
					if err == nil || err.Error() != want {
						t.Fatalf("error = %v, want %s", err, want)
					}
				})
			}
		})
	}
}

func TestReadWhatsmeowPQRollbackMarkerRejectsAbsentProviderProof(t *testing.T) {
	for _, provider := range []string{"baileys", "wwebjs"} {
		t.Run(provider, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			mock.ExpectQuery("SELECT payload, octet_length\\(payload\\)").
				WithArgs(
					"0198b905-1fb1-7b4f-9c6d-dbd24078ef11",
					int64(41),
					map[string]string{
						"baileys": whatsmeowBaileysHandoffNamespace,
						"wwebjs":  whatsmeowWWebLifecycleNamespace,
					}[provider],
					map[string]string{
						"baileys": "pq_server_rollback:0198b905-35db-75de-a48f-99dd9133273c",
						"wwebjs":  whatsmeowWWebPQRollbackMarkerKey,
					}[provider],
				).
				WillReturnRows(sqlmock.NewRows([]string{"payload", "octet_length"}))

			_, err = readWhatsmeowPQRollbackMarker(
				context.Background(), db,
				"0198b905-1fb1-7b4f-9c6d-dbd24078ef11", 41, provider,
				"0198b905-35db-75de-a48f-99dd9133273c",
				"0198b905-35db-75de-a48f-99dd9133273d",
			)
			want := "whatsmeow_" + provider + "_pq_rollback_proof_missing"
			if err == nil || err.Error() != want {
				t.Fatalf("error = %v, want %s", err, want)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestReadWhatsmeowPQRollbackMarkerRejectsLegacyProofWithoutUploadFence(t *testing.T) {
	for _, provider := range []string{"baileys", "wwebjs"} {
		t.Run(provider, func(t *testing.T) {
			marker := validWhatsmeowPQRollbackMarker(provider)
			marker.UploadLifecycleFenced = nil
			marker.UploadLifecycleFenceVer = nil
			payload, err := json.Marshal(marker)
			if err != nil {
				t.Fatal(err)
			}
			if bytes.Contains(payload, []byte("upload_lifecycle")) {
				t.Fatalf("legacy fixture unexpectedly contains upload lifecycle proof: %s", payload)
			}

			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			mock.ExpectQuery("SELECT payload, octet_length\\(payload\\)").
				WithArgs(
					"0198b905-1fb1-7b4f-9c6d-dbd24078ef11",
					int64(41),
					map[string]string{
						"baileys": whatsmeowBaileysHandoffNamespace,
						"wwebjs":  whatsmeowWWebLifecycleNamespace,
					}[provider],
					map[string]string{
						"baileys": "pq_server_rollback:0198b905-35db-75de-a48f-99dd9133273c",
						"wwebjs":  whatsmeowWWebPQRollbackMarkerKey,
					}[provider],
				).
				WillReturnRows(sqlmock.NewRows([]string{"payload", "octet_length"}).
					AddRow(payload, len(payload)))

			_, err = readWhatsmeowPQRollbackMarker(
				context.Background(), db,
				"0198b905-1fb1-7b4f-9c6d-dbd24078ef11", 41, provider,
				marker.HandoffID, marker.LifecycleOperationID,
			)
			want := "whatsmeow_" + provider + "_pq_rollback_proof_invalid"
			if err == nil || err.Error() != want {
				t.Fatalf("error = %v, want %s", err, want)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestValidateWhatsmeowBaileysPQStateFailsClosed(t *testing.T) {
	// Baileys deliberately keeps one provider-specific allocator-state record
	// after the acknowledged server rollback. It must describe the same neutral
	// migrated=false state already materialized in the canonical table.
	if err := validateWhatsmeowBaileysPQState(1, 0, 0, 0, 0, 1); err != nil {
		t.Fatalf("classical-only Baileys state was rejected: %v", err)
	}

	for name, counts := range map[string][6]int64{
		"missing canonical allocator state": {0, 0, 0, 0, 0, 1},
		"migrated allocator state":          {1, 1, 0, 0, 0, 1},
		"canonical ML-KEM key material":     {1, 0, 1, 0, 0, 1},
		"PQ Signal ratchet":                 {1, 0, 0, 1, 0, 1},
		"native provider key material":      {1, 0, 0, 0, 1, 1},
		"missing native allocator state":    {1, 0, 0, 0, 0, 0},
		"duplicate native allocator state":  {1, 0, 0, 0, 0, 2},
	} {
		t.Run(name, func(t *testing.T) {
			err := validateWhatsmeowBaileysPQState(
				counts[0], counts[1], counts[2], counts[3], counts[4], counts[5],
			)
			if err == nil || err.Error() != "whatsmeow_baileys_pqxdh_state_unportable" {
				t.Fatalf("error = %v, want fail-closed unportable error", err)
			}
		})
	}

	if err := validateWhatsmeowBaileysPQState(-1, 0, 0, 0, 0, 1); err == nil ||
		err.Error() != "whatsmeow_baileys_pqxdh_state_unknown" {
		t.Fatalf("negative/unknown counters must fail closed, got %v", err)
	}
}

func TestCaptureWhatsmeowSnapshotReadsOnlyRequestedScopeAndFiltersUnmaintainedSignalExtensions(t *testing.T) {
	db, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	defer db.Close()

	for _, descriptor := range whatsmeowPortableTables() {
		definitions := []string{"session_id TEXT NOT NULL", "revision_id INTEGER NOT NULL"}
		for index, column := range descriptor.Columns {
			typeName := "TEXT"
			switch descriptor.Kinds[index] {
			case whatsmeowBytes:
				typeName = "BLOB"
			case whatsmeowInt, whatsmeowBool:
				typeName = "INTEGER"
			}
			definitions = append(definitions, column+" "+typeName)
		}
		if _, err := db.Exec(fmt.Sprintf(
			"CREATE TABLE %s (%s)", descriptor.Name, strings.Join(definitions, ","),
		)); err != nil {
			t.Fatalf("create %s: %v", descriptor.Name, err)
		}
	}

	sessionID := uuid.NewString()
	otherSessionID := uuid.NewString()
	const revisionID int64 = 41
	insertContact := `
		INSERT INTO whatsapp_contacts (
			session_id, revision_id, their_jid, first_name, full_name,
			push_name, business_name, redacted_phone
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`
	if _, err := db.Exec(insertContact, sessionID, revisionID, "same@s.whatsapp.net", "chosen", nil, nil, nil, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(insertContact, otherSessionID, revisionID, "same@s.whatsapp.net", "foreign", nil, nil, nil, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(insertContact, sessionID, revisionID+1, "same@s.whatsapp.net", "old-revision", nil, nil, nil, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`
		INSERT INTO whatsapp_app_state_version (
			session_id, revision_id, name, version, hash
		) VALUES (?, ?, 'regular', 3, ?)
	`, sessionID, revisionID, []byte("hash")); err != nil {
		t.Fatal(err)
	}
	for _, version := range []int64{2, 4} {
		if _, err := db.Exec(`
			INSERT INTO whatsapp_app_state_mutation_macs (
				session_id, revision_id, name, version, index_mac, value_mac
			) VALUES (?, ?, 'regular', ?, ?, ?)
		`, sessionID, revisionID, version, []byte{byte(version)}, []byte{byte(version + 1)}); err != nil {
			t.Fatal(err)
		}
	}
	insertSignalSession := `
		INSERT INTO whatsapp_signal_sessions (
			session_id, revision_id, their_id, scope, session
		) VALUES (?, ?, ?, ?, ?)
	`
	for _, scope := range []string{"default", "status", "pq"} {
		if _, err := db.Exec(
			insertSignalSession, sessionID, revisionID,
			"5511888888888:1", scope, []byte("signal-"+scope),
		); err != nil {
			t.Fatal(err)
		}
		if _, err := db.Exec(
			insertSignalSession, sessionID, revisionID-1,
			"5511888888888:1", scope, []byte("rollback-"+scope),
		); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.Exec(
		insertSignalSession, otherSessionID, revisionID,
		"5511888888888:1", "default", []byte("foreign"),
	); err != nil {
		t.Fatal(err)
	}
	routingInfo := []byte{0x08, 0x01, 0x12, 0x02, 0xaa, 0xbb}
	insertProviderRecord := `
		INSERT INTO whatsapp_provider_record (
			session_id, revision_id, namespace, record_key, codec_version, payload
		) VALUES (?, ?, ?, ?, ?, ?)
	`
	for _, record := range []struct {
		sessionID string
		revision  int64
		namespace string
		key       string
		payload   []byte
	}{
		{sessionID, revisionID, meowstore.WhatsAppTransportNamespace, meowstore.WhatsAppTransportRoutingInfoKey, routingInfo},
		{otherSessionID, revisionID, meowstore.WhatsAppTransportNamespace, meowstore.WhatsAppTransportRoutingInfoKey, []byte("foreign")},
		{sessionID, revisionID, "wwebjs/private", "profile", []byte("private")},
	} {
		if _, err := db.Exec(insertProviderRecord, record.sessionID, record.revision,
			record.namespace, record.key, meowstore.WhatsAppTransportCodecVersion, record.payload); err != nil {
			t.Fatal(err)
		}
	}
	readSignalRows := func(revision int64) []string {
		t.Helper()
		rows, err := db.Query(`
			SELECT their_id, scope, session
			FROM whatsapp_signal_sessions
			WHERE session_id=? AND revision_id=?
			ORDER BY their_id, scope
		`, sessionID, revision)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		result := []string{}
		for rows.Next() {
			var theirID, scope string
			var payload []byte
			if err := rows.Scan(&theirID, &scope, &payload); err != nil {
				t.Fatal(err)
			}
			result = append(result, fmt.Sprintf("%s:%s:%x", theirID, scope, payload))
		}
		if err := rows.Err(); err != nil {
			t.Fatal(err)
		}
		return result
	}
	activeBytesBefore := readSignalRows(revisionID)
	rollbackBytesBefore := readSignalRows(revisionID - 1)

	snapshot, err := captureWhatsmeowSnapshotForSourceProvider(
		context.Background(), db, sessionID, revisionID,
		"5511999999999:1@s.whatsapp.net", 721, "wwebjs",
	)
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.NextPreKeyID != 721 {
		t.Fatalf("next prekey ID = %d, want 721", snapshot.NextPreKeyID)
	}
	foundContacts, foundSignalSessions, foundRoutingInfo := false, false, false
	foundConfirmedMutationMAC := false
	for _, table := range snapshot.Tables {
		switch table.Name {
		case "whatsapp_contacts":
			foundContacts = true
			if len(table.Rows) != 1 || table.Rows[0][1].Text != "chosen" {
				t.Fatalf("cross-session or cross-revision row leaked into snapshot: %#v", table.Rows)
			}
		case "whatsapp_signal_sessions":
			foundSignalSessions = true
			if len(table.Rows) != 1 || table.Rows[0][1].Text != "default" ||
				!bytes.Equal(table.Rows[0][2].Bytes, []byte("signal-default")) {
				t.Fatalf("WhatsMeow projection leaked unmaintained Signal scopes: %#v", table.Rows)
			}
		case "whatsapp_provider_record":
			foundRoutingInfo = true
			if len(table.Rows) != 1 || table.Rows[0][0].Text != meowstore.WhatsAppTransportNamespace ||
				table.Rows[0][1].Text != meowstore.WhatsAppTransportRoutingInfoKey ||
				!bytes.Equal(table.Rows[0][3].Bytes, routingInfo) {
				t.Fatalf("transport projection leaked or changed a provider record: %#v", table.Rows)
			}
		case "whatsapp_app_state_mutation_macs":
			foundConfirmedMutationMAC = true
			if len(table.Rows) != 1 || table.Rows[0][1].Int != 2 {
				t.Fatalf("WWeb future mutation MAC leaked into WhatsMeow projection: %#v", table.Rows)
			}
		}
	}
	if !foundContacts || !foundSignalSessions || !foundRoutingInfo || !foundConfirmedMutationMAC {
		t.Fatalf("captured snapshot is incomplete: contacts=%t signal_sessions=%t routing=%t mutation_mac=%t",
			foundContacts, foundSignalSessions, foundRoutingInfo, foundConfirmedMutationMAC)
	}
	if got := readSignalRows(revisionID); !reflect.DeepEqual(got, activeBytesBefore) {
		t.Fatalf("logical export mutated active source bytes: before=%#v after=%#v", activeBytesBefore, got)
	}
	if got := readSignalRows(revisionID - 1); !reflect.DeepEqual(got, rollbackBytesBefore) {
		t.Fatalf("logical export mutated rollback bytes: before=%#v after=%#v", rollbackBytesBefore, got)
	}
}

func TestCaptureWhatsmeowSQLiteSnapshotRejectsIncompatibleGenericSchema(t *testing.T) {
	db, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(`
		CREATE TABLE whatsapp_store_version (version INTEGER NOT NULL, compat INTEGER NOT NULL);
		INSERT INTO whatsapp_store_version (version, compat) VALUES (15, 15);
	`); err != nil {
		t.Fatal(err)
	}
	_, err = captureWhatsmeowSQLiteSnapshot(context.Background(), db)
	if err == nil || !strings.Contains(err.Error(), "unsupported imported whatsapp schema") {
		t.Fatalf("incompatible generic schema was not rejected: %v", err)
	}
}

func TestCaptureWhatsmeowSQLiteSnapshotCarriesLegacyADVProvenance(t *testing.T) {
	ctx := context.Background()
	dbPath := filepath.Join(t.TempDir(), "store.db")
	db, err := sql.Open("sqlite3", "file:"+dbPath+"?_foreign_keys=on")
	if err != nil {
		t.Fatal(err)
	}
	container := sqlstore.NewWithDB(db, "sqlite3", nil)
	if err = container.Upgrade(ctx); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = container.Close() })

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
	if err = device.Save(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err = db.ExecContext(ctx, `
		UPDATE whatsapp_session_revision SET source='legacy_sqlite'
		WHERE session_id=? AND revision_id=1
	`, sessionID); err != nil {
		t.Fatal(err)
	}
	if _, err = db.ExecContext(ctx, `PRAGMA ignore_check_constraints=ON`); err != nil {
		t.Fatal(err)
	}
	if _, err = db.ExecContext(ctx, `
		UPDATE whatsapp_device SET adv_key=x'', adv_secret_available=false
		WHERE session_id=? AND revision_id=1
	`, sessionID); err != nil {
		t.Fatal(err)
	}
	if _, err = db.ExecContext(ctx, `PRAGMA ignore_check_constraints=OFF`); err != nil {
		t.Fatal(err)
	}

	snapshot, err := captureWhatsmeowSQLiteSnapshot(ctx, db)
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.SourceRevisionOrigin != "legacy_sqlite" {
		t.Fatalf("source revision origin = %q, want legacy_sqlite", snapshot.SourceRevisionOrigin)
	}
	prepared, err := prepareWhatsmeowSnapshot(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	values := preparedWhatsmeowDeviceValues(t, prepared)
	if values["adv_key"] != nil || values["adv_secret_available"] != false {
		t.Fatalf("captured legacy ADV sentinel was not normalized: %#v", values)
	}
}

func TestCaptureWhatsmeowSQLiteSnapshotAcceptsCanonicalNullableSource(t *testing.T) {
	ctx := context.Background()
	dbPath := filepath.Join(t.TempDir(), "store.db")
	db, err := sql.Open("sqlite3", "file:"+dbPath+"?_foreign_keys=on")
	if err != nil {
		t.Fatal(err)
	}
	container := sqlstore.NewWithDB(db, "sqlite3", nil)
	if err = container.Upgrade(ctx); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = container.Close() })

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
	if err = device.Save(ctx); err != nil {
		t.Fatal(err)
	}

	var source sql.NullString
	if err = db.QueryRowContext(ctx, `
		SELECT source FROM whatsapp_session_revision
		WHERE session_id=? AND revision_id=1
	`, sessionID).Scan(&source); err != nil {
		t.Fatal(err)
	}
	if source.Valid {
		t.Fatalf("canonical SQLite source = %q, want NULL", source.String)
	}

	snapshot, err := captureWhatsmeowSQLiteSnapshot(ctx, db)
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.SourceRevisionOrigin != "" {
		t.Fatalf("nullable source was changed to %q", snapshot.SourceRevisionOrigin)
	}
	if _, err = prepareWhatsmeowSnapshot(snapshot); err != nil {
		t.Fatalf("prepare canonical nullable-source snapshot: %v", err)
	}
}

func TestWhatsmeowBackupCellRoundTripPreservesBinaryAndNull(t *testing.T) {
	binary, err := encodeWhatsmeowBackupCell([]byte{0, 1, 2, 255}, whatsmeowBytes)
	if err != nil {
		t.Fatal(err)
	}
	value, ok := binary.value().([]byte)
	if !ok || len(value) != 4 || value[3] != 255 {
		t.Fatalf("binary value was not preserved: %#v", binary.value())
	}
	null, err := encodeWhatsmeowBackupCell(nil, whatsmeowText)
	if err != nil {
		t.Fatal(err)
	}
	if null.value() != nil {
		t.Fatalf("null value was not preserved: %#v", null.value())
	}
}

func TestPrepareWhatsmeowSnapshotInjectsFingerprintAndAtomicPreKeyCounter(t *testing.T) {
	prepared, err := prepareWhatsmeowSnapshot(validWhatsmeowImportSnapshot(t))
	if err != nil {
		t.Fatal(err)
	}
	for _, table := range prepared {
		if table.Name != "whatsapp_device" {
			continue
		}
		if len(table.Rows) != 1 {
			t.Fatalf("invalid prepared device table: %#v", table)
		}
		row := table.Rows[0]
		fingerprint, ok := row[len(row)-3].([]byte)
		if !ok || len(fingerprint) != 32 {
			t.Fatalf("canonical fingerprint was not injected: %#v", row[len(row)-3])
		}
		if version, ok := row[len(row)-2].(string); !ok || version != sqlstore.DeviceFingerprintVersion {
			t.Fatalf("canonical fingerprint version was not injected: %#v", row[len(row)-2])
		}
		nextPreKeyID, ok := row[len(row)-1].(int64)
		if !ok || nextPreKeyID != 8 {
			t.Fatalf("next prekey counter = %#v, want 8", row[len(row)-1])
		}
		return
	}
	t.Fatal("prepared snapshot has no device table")
}

func TestPrepareWhatsmeowSnapshotPreservesAdvancedAtomicPreKeyCounter(t *testing.T) {
	snapshot := validWhatsmeowImportSnapshot(t)
	snapshot.NextPreKeyID = 4096
	prepared, err := prepareWhatsmeowSnapshot(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	for _, table := range prepared {
		if table.Name != "whatsapp_device" {
			continue
		}
		got, ok := table.Rows[0][len(table.Rows[0])-1].(int64)
		if !ok || got != 4096 {
			t.Fatalf("next prekey counter = %#v, want 4096", table.Rows[0][len(table.Rows[0])-1])
		}
		return
	}
	t.Fatal("prepared snapshot has no device table")
}

func TestPrepareWhatsmeowSnapshotAcceptsPublicIdentityWithoutADVSecret(t *testing.T) {
	snapshot := validWhatsmeowImportSnapshot(t)
	for tableIndex := range snapshot.Tables {
		if snapshot.Tables[tableIndex].Name != "whatsapp_device" {
			continue
		}
		descriptor, _ := descriptorForWhatsmeowTable("whatsapp_device")
		for columnIndex, column := range descriptor.Columns {
			switch column {
			case "adv_key":
				snapshot.Tables[tableIndex].Rows[0][columnIndex] = whatsmeowBackupCell{Kind: "null"}
			case "adv_secret_available":
				snapshot.Tables[tableIndex].Rows[0][columnIndex] = whatsmeowBackupCell{
					Kind: string(whatsmeowBool), Bool: false,
				}
			}
		}
	}

	prepared, err := prepareWhatsmeowSnapshot(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	for _, table := range prepared {
		if table.Name != "whatsapp_device" {
			continue
		}
		values := make(map[string]any, len(table.Columns))
		for index, column := range table.Columns {
			values[column] = table.Rows[0][index]
		}
		if values["adv_key"] != nil || values["adv_secret_available"] != false {
			t.Fatalf("ADV capability was invented during import: %#v", values)
		}
		return
	}
	t.Fatal("prepared snapshot has no device table")
}

func TestPrepareWhatsmeowSnapshotNormalizesEmptyLegacySQLiteADVSecret(t *testing.T) {
	snapshot := validWhatsmeowImportSnapshot(t)
	snapshot.SourceRevisionOrigin = "legacy_sqlite"
	setWhatsmeowSnapshotADVCapability(t, &snapshot, false, whatsmeowBackupCell{
		Kind: string(whatsmeowBytes), Bytes: []byte{},
	})

	prepared, err := prepareWhatsmeowSnapshot(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	values := preparedWhatsmeowDeviceValues(t, prepared)
	if values["adv_key"] != nil || values["adv_secret_available"] != false {
		t.Fatalf("legacy SQLite ADV sentinel was not normalized: %#v", values)
	}
}

func TestPrepareWhatsmeowSnapshotRejectsEmptyCanonicalADVSecret(t *testing.T) {
	snapshot := validWhatsmeowImportSnapshot(t)
	setWhatsmeowSnapshotADVCapability(t, &snapshot, false, whatsmeowBackupCell{
		Kind: string(whatsmeowBytes), Bytes: []byte{},
	})

	if _, err := prepareWhatsmeowSnapshot(snapshot); err == nil ||
		!strings.Contains(err.Error(), "ADV capability is inconsistent") {
		t.Fatalf("empty canonical ADV secret was accepted: %v", err)
	}
}

func TestPrepareWhatsmeowSnapshotRejectsNonEmptyLegacySQLiteADVSecretWhenUnavailable(t *testing.T) {
	snapshot := validWhatsmeowImportSnapshot(t)
	snapshot.SourceRevisionOrigin = "legacy_sqlite"
	setWhatsmeowSnapshotADVCapability(t, &snapshot, false, whatsmeowBackupCell{
		Kind: string(whatsmeowBytes), Bytes: make([]byte, 32),
	})

	if _, err := prepareWhatsmeowSnapshot(snapshot); err == nil ||
		!strings.Contains(err.Error(), "ADV capability is inconsistent") {
		t.Fatalf("non-empty unavailable legacy ADV secret was accepted: %v", err)
	}
}

func setWhatsmeowSnapshotADVCapability(
	t *testing.T,
	snapshot *whatsmeowSessionSnapshot,
	available bool,
	advKey whatsmeowBackupCell,
) {
	t.Helper()
	descriptor, _ := descriptorForWhatsmeowTable("whatsapp_device")
	for tableIndex := range snapshot.Tables {
		if snapshot.Tables[tableIndex].Name != "whatsapp_device" {
			continue
		}
		for columnIndex, column := range descriptor.Columns {
			switch column {
			case "adv_key":
				snapshot.Tables[tableIndex].Rows[0][columnIndex] = advKey
			case "adv_secret_available":
				snapshot.Tables[tableIndex].Rows[0][columnIndex] = whatsmeowBackupCell{
					Kind: string(whatsmeowBool), Bool: available,
				}
			}
		}
		return
	}
	t.Fatal("snapshot has no whatsapp_device table")
}

func preparedWhatsmeowDeviceValues(
	t *testing.T,
	prepared []whatsmeowPreparedTable,
) map[string]any {
	t.Helper()
	for _, table := range prepared {
		if table.Name != "whatsapp_device" {
			continue
		}
		values := make(map[string]any, len(table.Columns))
		for index, column := range table.Columns {
			values[column] = table.Rows[0][index]
		}
		return values
	}
	t.Fatal("prepared snapshot has no whatsapp_device table")
	return nil
}

func TestPrepareWhatsmeowSnapshotDropsProviderSpecificSignalScopesAndNormalizesDefault(t *testing.T) {
	snapshot := validWhatsmeowImportSnapshot(t)
	payload := validCanonicalSignalPayload(t)
	statusPayload := append([]byte(nil), payload...)
	statusPayload = append(statusPayload, 0x98, 0x06, 0x01) // unknown protobuf field
	pqPayload := append([]byte(nil), payload...)
	pqPayload = append(pqPayload, 0xa0, 0x06, 0x02) // distinct unknown field
	for tableIndex := range snapshot.Tables {
		if snapshot.Tables[tableIndex].Name != "whatsapp_signal_sessions" {
			continue
		}
		for _, fixture := range []struct {
			scope   string
			payload []byte
		}{
			{scope: "default", payload: payload},
			{scope: "status", payload: statusPayload},
			{scope: "pq", payload: pqPayload},
		} {
			snapshot.Tables[tableIndex].Rows = append(snapshot.Tables[tableIndex].Rows, []whatsmeowBackupCell{
				{Kind: string(whatsmeowText), Text: "5511888888888:1"},
				{Kind: string(whatsmeowText), Text: fixture.scope},
				{Kind: string(whatsmeowBytes), Bytes: fixture.payload},
			})
		}
	}

	prepared, err := prepareWhatsmeowSnapshot(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	for _, table := range prepared {
		if table.Name != "whatsapp_signal_sessions" {
			continue
		}
		byScope := make(map[string][]byte)
		for _, row := range table.Rows {
			if row[0] != "5511888888888:1" {
				continue
			}
			byScope[row[1].(string)] = row[2].([]byte)
		}
		if len(byScope) != 1 || byScope["status"] != nil || byScope["pq"] != nil {
			t.Fatalf("provider-specific Signal scopes leaked into Meow projection: %#v", table.Rows)
		}
		canonicalDefault, normalizeErr := meowstore.NormalizeSignalSessionStorage(payload)
		if normalizeErr != nil {
			t.Fatal(normalizeErr)
		}
		if !bytes.Equal(byScope["default"], canonicalDefault) {
			t.Fatal("default Signal scope was not normalized for WhatsMeow")
		}
		return
	}
	t.Fatal("prepared snapshot has no Signal session table")
}

func TestPrepareWhatsmeowSnapshotPreservesNullDefaultSignalPayloadAndDropsExtensions(t *testing.T) {
	snapshot := validWhatsmeowImportSnapshot(t)
	for tableIndex := range snapshot.Tables {
		if snapshot.Tables[tableIndex].Name != "whatsapp_signal_sessions" {
			continue
		}
		for index, scope := range []string{"default", "status", "pq"} {
			snapshot.Tables[tableIndex].Rows = append(snapshot.Tables[tableIndex].Rows, []whatsmeowBackupCell{
				{Kind: string(whatsmeowText), Text: fmt.Sprintf("551177777777%d:1", index)},
				{Kind: string(whatsmeowText), Text: scope},
				{Kind: "null"},
			})
		}
	}

	prepared, err := prepareWhatsmeowSnapshot(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	for _, table := range prepared {
		if table.Name != "whatsapp_signal_sessions" {
			continue
		}
		if len(table.Rows) != 1 || table.Rows[0][1] != "default" {
			t.Fatalf("nullable provider-specific Signal rows leaked: %#v", table.Rows)
		}
		for _, row := range table.Rows {
			if row[2] != nil {
				t.Fatalf("Signal NULL changed for scope %v: %#v", row[1], row[2])
			}
			encoded, encodeErr := encodeWhatsmeowBackupCell(row[2], whatsmeowBytes)
			if encodeErr != nil {
				t.Fatal(encodeErr)
			} else if encoded.Kind != "null" || encoded.value() != nil {
				t.Fatalf("Signal NULL did not round-trip for scope %v: %#v", row[1], encoded)
			}
		}
		return
	}
	t.Fatal("prepared snapshot has no Signal session table")
}

func validCanonicalSignalPayload(t *testing.T) []byte {
	t.Helper()
	localIdentity := ecc.CreateKeyPair(bytes.Repeat([]byte{1}, 32))
	remoteIdentity := ecc.CreateKeyPair(bytes.Repeat([]byte{2}, 32))
	senderBase := ecc.CreateKeyPair(bytes.Repeat([]byte{3}, 32))
	ratchetKey := ecc.CreateKeyPair(bytes.Repeat([]byte{4}, 32))
	privateKey := ratchetKey.PrivateKey().Serialize()
	structure := &signalrecord.SessionStructure{SessionState: &signalrecord.StateStructure{
		LocalIdentityPublic:  localIdentity.PublicKey().Serialize(),
		LocalRegistrationID:  7,
		RemoteIdentityPublic: remoteIdentity.PublicKey().Serialize(),
		RemoteRegistrationID: 9,
		RootKey:              bytes.Repeat([]byte{5}, 32),
		SenderBaseKey:        senderBase.PublicKey().Serialize(),
		SenderChain: &signalrecord.ChainStructure{
			SenderRatchetKeyPublic:  ratchetKey.PublicKey().Serialize(),
			SenderRatchetKeyPrivate: privateKey[:],
			ChainKey: &chain.KeyStructure{
				Index: 1,
				Key:   bytes.Repeat([]byte{6}, 32),
			},
		},
		SessionVersion: 3,
	}}
	payload := meowstore.SignalProtobufSerializer.Session.Serialize(structure)
	if _, err := meowstore.NormalizeSignalSessionStorage(payload); err != nil {
		t.Fatalf("invalid test Signal fixture: %v", err)
	}
	return payload
}

func TestPreparedWhatsmeowProjectionChecksumAndIdentityAreStable(t *testing.T) {
	prepared, err := prepareWhatsmeowSnapshot(validWhatsmeowImportSnapshot(t))
	if err != nil {
		t.Fatal(err)
	}
	firstChecksum, firstSize, err := checksumWhatsmeowPreparedProjection(prepared)
	if err != nil {
		t.Fatal(err)
	}
	secondChecksum, secondSize, err := checksumWhatsmeowPreparedProjection(prepared)
	if err != nil {
		t.Fatal(err)
	}
	if len(firstChecksum) != 64 || firstChecksum != secondChecksum || firstSize <= 0 || firstSize != secondSize {
		t.Fatalf("projection checksum is unstable: first=%s/%d second=%s/%d", firstChecksum, firstSize, secondChecksum, secondSize)
	}
	jid, fingerprint, nextPreKeyID, err := preparedWhatsmeowDeviceIdentity(prepared)
	if err != nil {
		t.Fatal(err)
	}
	if jid == "" || len(fingerprint) != 32 || nextPreKeyID != 8 {
		t.Fatalf("prepared identity is incomplete: jid=%q fingerprint=%d next_pre_key_id=%d", jid, len(fingerprint), nextPreKeyID)
	}
}

func TestPrepareWhatsmeowSnapshotPreservesOpaqueRoutingInfoInProjectionProof(t *testing.T) {
	withoutRoute, err := prepareWhatsmeowSnapshot(validWhatsmeowImportSnapshot(t))
	if err != nil {
		t.Fatal(err)
	}
	withoutChecksum, withoutSize, err := checksumWhatsmeowPreparedProjection(withoutRoute)
	if err != nil {
		t.Fatal(err)
	}

	routingInfo := []byte{0x08, 0xff, 0x12, 0x02, 0x00, 0x7f}
	snapshot := validWhatsmeowImportSnapshot(t)
	snapshot.Tables = append(snapshot.Tables, validWhatsmeowRoutingTable(routingInfo))
	withRoute, err := prepareWhatsmeowSnapshot(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	got, present, err := preparedWhatsmeowTransportRoutingInfo(withRoute)
	if err != nil {
		t.Fatal(err)
	} else if !present || !bytes.Equal(got, routingInfo) {
		t.Fatalf("opaque transport route changed: present=%t size=%d", present, len(got))
	}
	withChecksum, withSize, err := checksumWhatsmeowPreparedProjection(withRoute)
	if err != nil {
		t.Fatal(err)
	}
	if withChecksum == withoutChecksum || withSize <= withoutSize {
		t.Fatalf("transport route was omitted from projection proof: checksum_equal=%t sizes=%d/%d",
			withChecksum == withoutChecksum, withoutSize, withSize)
	}
}

func TestPrepareWhatsmeowSnapshotRejectsInvalidRoutingInfo(t *testing.T) {
	for _, fixture := range []struct {
		name   string
		mutate func(*whatsmeowBackupTable)
	}{
		{name: "wrong namespace", mutate: func(table *whatsmeowBackupTable) { table.Rows[0][0].Text = "whatsmeow/private" }},
		{name: "wrong key", mutate: func(table *whatsmeowBackupTable) { table.Rows[0][1].Text = "other" }},
		{name: "wrong codec", mutate: func(table *whatsmeowBackupTable) { table.Rows[0][2].Int = 2 }},
		{name: "empty payload", mutate: func(table *whatsmeowBackupTable) { table.Rows[0][3].Bytes = nil }},
		{name: "oversized payload", mutate: func(table *whatsmeowBackupTable) {
			table.Rows[0][3].Bytes = make([]byte, meowstore.MaxWhatsAppTransportRoutingInfoSize+1)
		}},
		{name: "duplicate", mutate: func(table *whatsmeowBackupTable) {
			table.Rows = append(table.Rows, append([]whatsmeowBackupCell(nil), table.Rows[0]...))
		}},
	} {
		t.Run(fixture.name, func(t *testing.T) {
			snapshot := validWhatsmeowImportSnapshot(t)
			table := validWhatsmeowRoutingTable([]byte{1, 2, 3})
			fixture.mutate(&table)
			snapshot.Tables = append(snapshot.Tables, table)
			if _, err := prepareWhatsmeowSnapshot(snapshot); err == nil {
				t.Fatal("invalid routing projection was accepted")
			}
		})
	}
}

func TestPrepareWhatsmeowSnapshotRejectsStoredFingerprintDivergence(t *testing.T) {
	snapshot := validWhatsmeowImportSnapshot(t)
	snapshot.DeviceFingerprint = make([]byte, 32)
	snapshot.DeviceFingerprint[0] = 0xff
	_, err := prepareWhatsmeowSnapshot(snapshot)
	if err == nil || !strings.Contains(err.Error(), "fingerprint diverged") {
		t.Fatalf("divergent stored fingerprint was not rejected: %v", err)
	}
}

func TestPrepareWhatsmeowSnapshotRejectsTamperedCanonicalKeyMaterial(t *testing.T) {
	for _, column := range []string{"signed_pre_key", "signed_pre_key_sig"} {
		t.Run(column, func(t *testing.T) {
			snapshot := validWhatsmeowImportSnapshot(t)
			descriptor, _ := descriptorForWhatsmeowTable("whatsapp_device")
			for tableIndex := range snapshot.Tables {
				if snapshot.Tables[tableIndex].Name != "whatsapp_device" {
					continue
				}
				for columnIndex, name := range descriptor.Columns {
					if name != column {
						continue
					}
					value := append([]byte(nil), snapshot.Tables[tableIndex].Rows[0][columnIndex].Bytes...)
					value[10] ^= 0x01
					snapshot.Tables[tableIndex].Rows[0][columnIndex].Bytes = value
				}
			}

			_, err := prepareWhatsmeowSnapshot(snapshot)
			if !errors.Is(err, sqlstore.ErrSignedPreKeySignatureInvalid) {
				t.Fatalf("tampered canonical key material returned %v", err)
			}
		})
	}
}

func TestProviderHandoffRejectsFreshLoginWithoutExposingQRCode(t *testing.T) {
	manager := &WhatsAppManager{cfg: Config{SessionStorage: SessionStoragePostgres}}
	manager.providerHandoffInProgress.Store(true)
	err := manager.rejectLoginDuringProviderHandoff(context.Background(), "qrcode")
	if err == nil || !strings.Contains(err.Error(), "provider handoff") {
		t.Fatalf("provider handoff did not reject fresh login: %v", err)
	}
}

func validWhatsmeowImportSnapshot(t *testing.T) whatsmeowSessionSnapshot {
	t.Helper()
	jid := "5511999999999:1@s.whatsapp.net"
	var noisePrivate, identityPrivate, signedPreKeyPrivate [32]byte
	for index := range noisePrivate {
		noisePrivate[index] = byte(index + 1)
		identityPrivate[index] = byte(index + 33)
		signedPreKeyPrivate[index] = byte(index + 65)
	}
	identityKey := keys.NewKeyPairFromPrivateKey(identityPrivate)
	signedPreKey := keys.NewKeyPairFromPrivateKey(signedPreKeyPrivate)
	signedPreKeySignature := identityKey.Sign(signedPreKey)
	snapshot := whatsmeowSessionSnapshot{
		Version: 2, JID: jid,
		FingerprintVersion: sqlstore.DeviceFingerprintVersion,
	}
	for _, descriptor := range whatsmeowScopedTables {
		table := whatsmeowBackupTable{Name: descriptor.Name}
		if descriptor.Name == "whatsapp_device" {
			row := make([]whatsmeowBackupCell, len(descriptor.Columns))
			for index, column := range descriptor.Columns {
				switch descriptor.Kinds[index] {
				case whatsmeowText:
					row[index] = whatsmeowBackupCell{Kind: string(whatsmeowText), Text: "value"}
				case whatsmeowBytes:
					row[index] = whatsmeowBackupCell{Kind: string(whatsmeowBytes), Bytes: []byte{1}}
				case whatsmeowInt:
					row[index] = whatsmeowBackupCell{Kind: string(whatsmeowInt), Int: 1}
				case whatsmeowBool:
					row[index] = whatsmeowBackupCell{Kind: string(whatsmeowBool), Bool: true}
				}
				switch column {
				case "jid":
					row[index].Text = jid
				case "facebook_uuid":
					row[index] = whatsmeowBackupCell{Kind: "null"}
				case "noise_key":
					row[index].Bytes = append([]byte(nil), noisePrivate[:]...)
				case "identity_key":
					row[index].Bytes = append([]byte(nil), identityPrivate[:]...)
				case "signed_pre_key":
					row[index].Bytes = append([]byte(nil), signedPreKeyPrivate[:]...)
				case "signed_pre_key_sig":
					row[index].Bytes = append([]byte(nil), signedPreKeySignature[:]...)
				case "adv_key", "adv_account_sig_key":
					row[index].Bytes = make([]byte, 32)
				case "adv_account_sig", "adv_device_sig":
					row[index].Bytes = make([]byte, 64)
				}
			}
			table.Rows = append(table.Rows, row)
		} else if descriptor.Name == "whatsapp_pre_keys" {
			table.Rows = append(table.Rows, []whatsmeowBackupCell{
				{Kind: string(whatsmeowInt), Int: 7},
				{Kind: string(whatsmeowBytes), Bytes: make([]byte, 32)},
				{Kind: string(whatsmeowBool), Bool: false},
			})
		}
		snapshot.Tables = append(snapshot.Tables, table)
	}
	return snapshot
}

func validWhatsmeowRoutingTable(routingInfo []byte) whatsmeowBackupTable {
	return whatsmeowBackupTable{
		Name: whatsmeowTransportTable.Name,
		Rows: [][]whatsmeowBackupCell{{
			{Kind: string(whatsmeowText), Text: meowstore.WhatsAppTransportNamespace},
			{Kind: string(whatsmeowText), Text: meowstore.WhatsAppTransportRoutingInfoKey},
			{Kind: string(whatsmeowInt), Int: meowstore.WhatsAppTransportCodecVersion},
			{Kind: string(whatsmeowBytes), Bytes: append([]byte(nil), routingInfo...)},
		}},
	}
}
