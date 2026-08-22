package app

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"
)

const whatsmeowSourceHandoffAuthorizationExpectation = "whatsmeow-source-handoff-authorization"

type whatsmeowSourceHandoffRLSMatcher struct{}

func (whatsmeowSourceHandoffRLSMatcher) Match(expectedSQL, actualSQL string) error {
	if expectedSQL != whatsmeowSourceHandoffAuthorizationExpectation {
		return sqlmock.QueryMatcherRegexp.Match(expectedSQL, actualSQL)
	}

	normalized := strings.Join(strings.Fields(actualSQL), " ")
	if !strings.Contains(normalized, "JOIN whatsapp_session_handoff AS handoff") {
		return errors.New("modeled RLS authorization must select the handoff row")
	}
	const lockClause = "FOR SHARE OF "
	lockIndex := strings.LastIndex(normalized, lockClause)
	if lockIndex < 0 {
		return errors.New("modeled RLS authorization must lock the source session and revision")
	}
	lockTargets := strings.TrimSpace(normalized[lockIndex+len(lockClause):])
	if strings.Contains(","+strings.ReplaceAll(lockTargets, " ", "")+",", ",handoff,") {
		return errors.New("modeled FORCE RLS denies row-locking whatsapp_session_handoff")
	}
	if lockTargets != "session, revision" {
		return fmt.Errorf("unexpected source handoff lock targets: %s", lockTargets)
	}
	return nil
}

func TestPrepareWhatsmeowProviderHandoffAuthorizesWithoutLockingRLSHandoff(t *testing.T) {
	matcher := whatsmeowSourceHandoffRLSMatcher{}
	oldAuthorization := `
		SELECT handoff.handoff_id
		FROM whatsapp_session AS session
		JOIN whatsapp_session_revision AS revision ON true
		JOIN whatsapp_session_handoff AS handoff ON true
		FOR SHARE OF session, revision, handoff
	`
	if err := matcher.Match(whatsmeowSourceHandoffAuthorizationExpectation, oldAuthorization); err == nil ||
		!strings.Contains(err.Error(), "denies row-locking whatsapp_session_handoff") {
		t.Fatalf("legacy handoff row lock was not rejected by the FORCE RLS model: %v", err)
	}

	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(matcher))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })

	now := time.Now()
	fence := whatsmeowOperationFence{
		OwnerID: uuid.NewString(), FencingToken: 41, Generation: 7,
		Epoch: uuid.NewString(), Capability: strings.Repeat("c", 64),
	}
	cfg := Config{WorkerID: uuid.NewString()}
	postgres := &WorkerPostgres{
		DB: db,
		lease: &whatsappSessionLeaseState{
			sessionID: cfg.WorkerID, provider: "whatsmeow",
			ownerID: fence.OwnerID, fencingToken: fence.FencingToken,
			generation: fence.Generation, epoch: fence.Epoch, capability: fence.Capability,
			expiresAt: now.Add(time.Minute), localDeadline: now.Add(time.Minute),
		},
	}
	req := ProviderHandoffPrepareRequest{
		WorkerID: cfg.WorkerID, SourceProvider: "whatsmeow", TargetProvider: "baileys",
		HandoffID: uuid.NewString(), LifecycleOperationID: uuid.NewString(),
		SourceRevisionID: 17, RuntimeGeneration: fence.Generation,
	}

	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT begin_whatsapp_session_operation`).
		WithArgs(cfg.WorkerID, req.SourceRevisionID, fence.OwnerID, fence.FencingToken,
			fence.Generation, fence.Epoch, fence.Capability).
		WillReturnRows(sqlmock.NewRows([]string{"accepted"}).AddRow(true))
	mock.ExpectQuery(whatsmeowSourceHandoffAuthorizationExpectation).
		WithArgs(cfg.WorkerID, req.SourceRevisionID, req.HandoffID,
			req.LifecycleOperationID, req.TargetProvider).
		WillReturnRows(sqlmock.NewRows([]string{
			"status", "jid", "next_pre_key_id", "device_fingerprint", "fingerprint_version",
		}).AddRow("staging", nil, nil, nil, nil))
	mock.ExpectCommit()
	afterAuthorization := errors.New("stop after modeled RLS authorization")
	mock.ExpectBegin().WillReturnError(afterAuthorization)

	_, err = postgres.PrepareWhatsmeowProviderHandoffCheckpoint(context.Background(), cfg, req)
	if !errors.Is(err, afterAuthorization) {
		t.Fatalf("authorization did not advance past the RLS-safe SELECT: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestEmptyWhatsmeowProviderHandoffCheckpointIsDeterministic(t *testing.T) {
	checksum, sizeBytes, err := checksumWhatsmeowPreparedProjection(nil)
	if err != nil {
		t.Fatalf("checksum empty projection: %v", err)
	}
	const emptySHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
	if checksum != emptySHA256 || sizeBytes != 0 {
		t.Fatalf("unexpected empty checkpoint checksum=%s size=%d", checksum, sizeBytes)
	}

	checkpoint := whatsmeowProviderHandoffCheckpoint{
		Checksum: checksum, SizeBytes: sizeBytes,
	}
	if checkpoint.RecordCount != 0 {
		t.Fatalf("empty checkpoint record count=%d", checkpoint.RecordCount)
	}
}

func TestPrepareWhatsmeowProviderHandoffClassifiesSourceStateConflict(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })

	now := time.Now()
	fence := whatsmeowOperationFence{
		OwnerID: uuid.NewString(), FencingToken: 42, Generation: 8,
		Epoch: uuid.NewString(), Capability: strings.Repeat("d", 64),
	}
	cfg := Config{WorkerID: uuid.NewString()}
	postgres := &WorkerPostgres{
		DB: db,
		lease: &whatsappSessionLeaseState{
			sessionID: cfg.WorkerID, provider: "whatsmeow",
			ownerID: fence.OwnerID, fencingToken: fence.FencingToken,
			generation: fence.Generation, epoch: fence.Epoch, capability: fence.Capability,
			expiresAt: now.Add(time.Minute), localDeadline: now.Add(time.Minute),
		},
	}
	req := ProviderHandoffPrepareRequest{
		WorkerID: cfg.WorkerID, SourceProvider: "whatsmeow", TargetProvider: "baileys",
		HandoffID: uuid.NewString(), LifecycleOperationID: uuid.NewString(),
		SourceRevisionID: 18, RuntimeGeneration: fence.Generation,
	}

	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT begin_whatsapp_session_operation`).
		WithArgs(cfg.WorkerID, req.SourceRevisionID, fence.OwnerID, fence.FencingToken,
			fence.Generation, fence.Epoch, fence.Capability).
		WillReturnRows(sqlmock.NewRows([]string{"accepted"}).AddRow(true))
	mock.ExpectQuery(`SELECT revision.status, device.jid`).
		WithArgs(cfg.WorkerID, req.SourceRevisionID, req.HandoffID,
			req.LifecycleOperationID, req.TargetProvider).
		WillReturnError(sql.ErrNoRows)
	mock.ExpectRollback()

	_, err = postgres.PrepareWhatsmeowProviderHandoffCheckpoint(context.Background(), cfg, req)
	if got := safeOperationalErrorCode(err); got != safeCodeHandoffSourceStateConflict {
		t.Fatalf("source state conflict code = %q, want %q", got, safeCodeHandoffSourceStateConflict)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
