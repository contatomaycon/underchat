package app

import (
	"context"
	"database/sql/driver"
	"errors"
	"fmt"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	waLog "go.mau.fi/whatsmeow/util/log"
)

func TestReleaseSessionLeaseForHandoffRetainsFenceAcrossTransientFailure(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("create sql mock: %v", err)
	}
	defer db.Close()

	state := &whatsappSessionLeaseState{
		sessionID:    "019c225d-4c92-7046-9c5a-4da54ef23533",
		provider:     "whatsmeow",
		ownerID:      "019c225d-59bb-7dd7-94bf-72b2b60bef83",
		fencingToken: 19,
		generation:   7,
		epoch:        "019c225d-65dd-700f-82b0-c4ccf9fe820c",
		capability:   "0123456789abcdef0123456789abcdef",
	}
	_, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	close(done)
	postgres := &WorkerPostgres{
		DB:           db,
		lease:        state,
		leaseCancel:  cancel,
		leaseDone:    done,
		leaseOwnerID: state.ownerID,
	}

	arguments := []driver.Value{
		state.sessionID,
		state.ownerID,
		state.provider,
		state.fencingToken,
		state.generation,
		state.epoch,
		state.capability,
	}
	mock.ExpectQuery(`SELECT release_whatsapp_session_lease`).
		WithArgs(arguments...).
		WillReturnError(errors.New("transient network failure after commit is unknown"))

	if err := postgres.ReleaseSessionLeaseForHandoff(context.Background()); err == nil {
		t.Fatal("expected the first release attempt to surface the transient failure")
	}
	postgres.leaseMu.Lock()
	retainedState := postgres.lease
	retainedCancel := postgres.leaseCancel
	retainedDone := postgres.leaseDone
	retainedError := postgres.leaseErr
	postgres.leaseMu.Unlock()
	if retainedState != state || retainedCancel == nil || retainedDone != done {
		t.Fatal("release failure discarded the fencing identity required for retry")
	}
	if !errors.Is(retainedError, ErrWhatsAppSessionLeaseLost) {
		t.Fatalf("release-pending lease remained writable: %v", retainedError)
	}

	// PostgreSQL's release function is idempotent for this exact fencing token.
	// A retry therefore returns true whether the first transaction rolled back
	// or committed and only its response was lost.
	mock.ExpectQuery(`SELECT release_whatsapp_session_lease`).
		WithArgs(arguments...).
		WillReturnRows(sqlmock.NewRows([]string{"released"}).AddRow(true))
	if err := postgres.ReleaseSessionLeaseForHandoff(context.Background()); err != nil {
		t.Fatalf("retry release: %v", err)
	}

	postgres.leaseMu.Lock()
	defer postgres.leaseMu.Unlock()
	if postgres.lease != nil || postgres.leaseCancel != nil || postgres.leaseDone != nil || postgres.leaseErr != nil {
		t.Fatal("confirmed release did not clear the retained local lease state")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}
}

func TestWhatsmeowToWWebHandoffRejectsMissingRoutingBeforeRuntimeDrain(t *testing.T) {
	ctx := context.Background()
	container, err := sqlstore.New(ctx, "sqlite3",
		fmt.Sprintf("file:%s?mode=memory&cache=shared&_foreign_keys=on", uuid.NewString()), waLog.Noop)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = container.Close() })
	workerID := uuid.NewString()
	device := container.NewDeviceForSession(workerID, 41)
	nativeStore := sqlstore.NewSQLStore(container, workerID, 41)
	device.SetAllStores(nativeStore)
	client := whatsmeow.NewClient(device, waLog.Noop)
	request := ProviderHandoffPrepareRequest{
		WorkerID: workerID, AccountID: uuid.NewString(),
		HandoffID: uuid.NewString(), LifecycleOperationID: uuid.NewString(),
		SourceProvider: "whatsmeow", TargetProvider: "wwebjs",
		SourceRevisionID: 41, RuntimeGeneration: 7,
	}
	manager := &WhatsAppManager{
		cfg: Config{
			WorkerID: workerID, AccountID: request.AccountID,
			RuntimeGeneration: 7, SessionStorage: SessionStoragePostgres,
		},
		client: client,
	}

	_, err = manager.prepareProviderHandoff(ctx, request)
	if err == nil || err.Error() != "whatsmeow_canonical_routing_info_unavailable" {
		t.Fatalf("missing canonical route did not fail closed: %v", err)
	}
	if manager.providerLifecycleEventSerial != 0 {
		t.Fatal("runtime lifecycle was fenced before canonical routing preflight")
	}
	if _, err := nativeStore.GetTransportRoutingInfo(ctx); err != nil {
		t.Fatalf("source SQLStore was paused before canonical routing preflight: %v", err)
	}

	worker := &Worker{cfg: manager.cfg, whatsapp: manager}
	worker.kafkaConsumersAuthorized.Store(true)
	worker.kafkaConsumersReady.Store(true)
	if _, err = worker.PrepareProviderHandoff(ctx, request); err == nil ||
		err.Error() != "whatsmeow_canonical_routing_info_unavailable" {
		t.Fatalf("worker accepted missing canonical route: %v", err)
	}
	if worker.providerHandoffBlocked.Load() || worker.providerHandoffKey != "" ||
		!worker.kafkaConsumersAuthorized.Load() || !worker.kafkaConsumersReady.Load() {
		t.Fatal("routing preflight failure fenced the otherwise healthy source runtime")
	}
}

func TestPreparedWhatsmeowHandoffRetryOnlyReleasesRetainedLease(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("create sql mock: %v", err)
	}
	defer db.Close()

	state := &whatsappSessionLeaseState{
		sessionID:    "019c225d-4c92-7046-9c5a-4da54ef23533",
		provider:     "whatsmeow",
		ownerID:      "019c225d-59bb-7dd7-94bf-72b2b60bef83",
		fencingToken: 23,
		generation:   7,
		epoch:        "019c225d-65dd-700f-82b0-c4ccf9fe820c",
		capability:   "0123456789abcdef0123456789abcdef",
	}
	_, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	close(done)
	postgres := &WorkerPostgres{
		DB: db, lease: state, leaseCancel: cancel, leaseDone: done,
		leaseOwnerID: state.ownerID,
	}
	request := ProviderHandoffPrepareRequest{
		WorkerID: state.sessionID, AccountID: "019c225d-7d53-78f7-a815-9279c9324357",
		HandoffID:            "019c225d-86d5-76b0-8378-7373044eb96c",
		LifecycleOperationID: "019c225d-90d1-76e0-b57b-fc41ca0c56c3",
		SourceProvider:       "whatsmeow", TargetProvider: "baileys",
		SourceRevisionID: 41, RuntimeGeneration: 7,
	}
	checkpoint := whatsmeowProviderHandoffCheckpoint{
		RevisionID: 41,
		Checksum:   "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
	}
	fenceContainer := &workerConnectionStatusFenceContainer{fence: store.ConnectionStatusFence{
		Required: true, OwnerID: state.ownerID, FencingToken: state.fencingToken,
		Generation: int64(state.generation), Epoch: state.epoch,
	}}
	jid := types.NewJID("15550000003", types.DefaultUserServer)
	client := whatsmeow.NewClient(&store.Device{
		ID: &jid, SessionID: request.WorkerID, RevisionID: request.SourceRevisionID,
		Container: fenceContainer,
	}, nil)
	client.MarkConnectionHandoff()
	client.Disconnect()
	manager := &WhatsAppManager{
		cfg: Config{
			WorkerID: request.WorkerID, AccountID: request.AccountID,
			RuntimeGeneration: 7, SessionStorage: SessionStoragePostgres,
		},
		postgres:                        postgres,
		client:                          client,
		sourceProviderHandoffKey:        request.HandoffID + ":" + request.LifecycleOperationID,
		sourceProviderHandoffCheckpoint: &checkpoint,
	}

	arguments := []driver.Value{
		state.sessionID, state.ownerID, state.provider, state.fencingToken,
		state.generation, state.epoch, state.capability,
	}
	mock.ExpectQuery(`SELECT release_whatsapp_session_lease`).
		WithArgs(arguments...).
		WillReturnError(errors.New("transient release response lost"))
	if _, err := manager.prepareProviderHandoff(context.Background(), request); err == nil {
		t.Fatal("expected ambiguous release to be surfaced")
	}
	if manager.sourceProviderHandoffCheckpoint == nil || postgres.lease != state {
		t.Fatal("prepared checkpoint or release fence was discarded")
	}
	fenceContainer.err = errors.New("lease release confirmed locally")

	mock.ExpectQuery(`SELECT release_whatsapp_session_lease`).
		WithArgs(arguments...).
		WillReturnRows(sqlmock.NewRows([]string{"released"}).AddRow(true))
	replayed, err := manager.prepareProviderHandoff(context.Background(), request)
	if err != nil {
		t.Fatalf("resume prepared handoff: %v", err)
	}
	if replayed != checkpoint {
		t.Fatalf("checkpoint changed across release retry: %+v", replayed)
	}
	if postgres.lease != nil {
		t.Fatal("confirmed retry did not clear retained lease")
	}
	if status := client.GetConnectionStatus(); status.Status != events.ConnectionStatusHandoff || status.Reason != "handoff_source_closed" {
		t.Fatalf("confirmed retry did not preserve handoff source-close status: %+v", status)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}
}
