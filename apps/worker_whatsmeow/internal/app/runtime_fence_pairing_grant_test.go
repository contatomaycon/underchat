package app

import (
	"context"
	"errors"
	"regexp"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

func TestWorkerConnectionQRCodeQueueMessagePreservesAuthorizedEpoch(t *testing.T) {
	attemptID := uuid.NewString()
	authorizedEpoch := uuid.NewString()
	message := redis.XMessage{
		ID: "1-0",
		Values: map[string]any{
			"request_id":                  "request-1",
			"connection_attempt_id":       attemptID,
			"authorized_connection_epoch": authorizedEpoch,
			"worker_id":                   uuid.NewString(),
			"account_id":                  uuid.NewString(),
			"worker_type_id":              WorkerTypeWhatsmeow,
			"runtime_generation":          "7",
			"source":                      "manager",
			"requested_at":                "2026-08-09T21:30:00Z",
		},
	}

	parsed, err := workerConnectionQRCodeQueueMessageFromRedis(message)
	if err != nil {
		t.Fatalf("parse authorized QR message: %v", err)
	}
	if parsed.ConnectionAttemptID != attemptID ||
		parsed.AuthorizedConnectionEpoch != authorizedEpoch {
		t.Fatalf("authorized identity changed while parsing: %+v", parsed)
	}
}

func TestWorkerConnectionQRCodeQueueMessageRejectsInvalidAuthorizedIdentity(t *testing.T) {
	base := map[string]any{
		"request_id":            "request-1",
		"connection_attempt_id": uuid.NewString(),
		"worker_id":             uuid.NewString(),
		"account_id":            uuid.NewString(),
		"worker_type_id":        WorkerTypeWhatsmeow,
		"runtime_generation":    "7",
		"source":                "manager",
		"requested_at":          "2026-08-09T21:30:00Z",
	}

	tests := []struct {
		name    string
		attempt string
		epoch   string
	}{
		{name: "invalid epoch", attempt: uuid.NewString(), epoch: "not-a-uuid"},
		{name: "invalid attempt", attempt: "not-a-uuid", epoch: uuid.NewString()},
		{name: "missing attempt", attempt: "", epoch: uuid.NewString()},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			values := make(map[string]any, len(base)+1)
			for key, value := range base {
				values[key] = value
			}
			values["connection_attempt_id"] = test.attempt
			values["authorized_connection_epoch"] = test.epoch
			if _, err := workerConnectionQRCodeQueueMessageFromRedis(redis.XMessage{
				ID: "1-0", Values: values,
			}); err == nil {
				t.Fatal("invalid authorized QR identity was accepted")
			}
		})
	}
}

func TestRuntimeFenceActivationIdentityNeverGeneratesRandomEpochForOwnedGrant(t *testing.T) {
	attemptID := uuid.NewString()
	authorizedEpoch := uuid.NewString()
	randomCalled := false
	epoch, attempt, err := runtimeFenceActivationIdentity(
		&WhatsappRuntimeOwnedConnectionFence{
			ConnectionEpoch:     authorizedEpoch,
			ConnectionAttemptID: attemptID,
		},
		func() string {
			randomCalled = true
			return uuid.NewString()
		},
	)
	if err != nil {
		t.Fatalf("resolve owned activation identity: %v", err)
	}
	if randomCalled {
		t.Fatal("owned runtime attempted to generate replacement epoch")
	}
	if epoch != authorizedEpoch || attempt != attemptID {
		t.Fatalf("owned identity changed: epoch=%q attempt=%q", epoch, attempt)
	}
}

func TestWhatsmeowRuntimeFenceBootstrapPinsPendingOrConsumedGrant(t *testing.T) {
	for _, test := range []struct {
		name               string
		authorizationState string
		connectionSequence int64
	}{
		{name: "pending grant before first activation", authorizationState: "pending", connectionSequence: 0},
		{name: "consumed current owner", authorizationState: "owned", connectionSequence: 41},
	} {
		t.Run(test.name, func(t *testing.T) {
			attemptID := uuid.NewString()
			authorizedEpoch := uuid.NewString()
			cfg := Config{
				WorkerID:          uuid.NewString(),
				AccountID:         uuid.NewString(),
				RuntimeGeneration: 9,
			}
			resolvedCfg, request, err := whatsmeowRuntimeFenceBootstrap(
				cfg,
				&WhatsappRuntimeOwnedConnectionFence{
					ConnectionEpoch:     authorizedEpoch,
					ConnectionAttemptID: attemptID,
					ConnectionSequence:  test.connectionSequence,
					AuthorizationState:  test.authorizationState,
				},
				nil,
			)
			if err != nil {
				t.Fatalf("bootstrap owned runtime fence: %v", err)
			}
			if request.ConnectionEpoch != authorizedEpoch ||
				request.ConnectionAttemptID != attemptID ||
				resolvedCfg.OwnedConnectionEpoch != authorizedEpoch ||
				resolvedCfg.OwnedConnectionAttemptID != attemptID {
				t.Fatalf("bootstrap did not preserve grant identity: cfg=%+v request=%+v", resolvedCfg, request)
			}
		})
	}
}

func TestWhatsmeowRuntimeFenceBootstrapKeepsLegacyRandomPathWithoutOwnership(t *testing.T) {
	randomEpoch := uuid.NewString()
	cfg := Config{
		WorkerID:                 uuid.NewString(),
		AccountID:                uuid.NewString(),
		RuntimeGeneration:        9,
		OwnedConnectionEpoch:     uuid.NewString(),
		OwnedConnectionAttemptID: uuid.NewString(),
	}
	resolvedCfg, request, err := whatsmeowRuntimeFenceBootstrap(
		cfg,
		nil,
		func() string { return randomEpoch },
	)
	if err != nil {
		t.Fatalf("bootstrap legacy runtime fence: %v", err)
	}
	if request.ConnectionEpoch != randomEpoch || request.ConnectionAttemptID != "" {
		t.Fatalf("legacy bootstrap identity=%+v", request)
	}
	if resolvedCfg.OwnedConnectionEpoch != "" || resolvedCfg.OwnedConnectionAttemptID != "" {
		t.Fatalf("legacy bootstrap retained stale ownership: %+v", resolvedCfg)
	}
}

func TestActivateWhatsmeowBootstrapRuntimeFenceDefersAuthStoreAfterTombstone(t *testing.T) {
	cfg := Config{
		WorkerID:          uuid.NewString(),
		AccountID:         uuid.NewString(),
		RuntimeGeneration: 31,
	}
	resolved, err := whatsmeowBootstrapRuntimeFenceActivationResult(
		cfg,
		errWhatsAppRuntimeFenceActivationRejected,
	)
	if err != nil {
		t.Fatalf("tombstoned bootstrap must remain dormant: %v", err)
	}
	if !resolved.DeferAuthStoreInitialization {
		t.Fatal("tombstoned bootstrap was allowed to open the auth store")
	}
}

func TestDormantWhatsAppManagerDoesNotOpenAuthStoreDuringConstruction(t *testing.T) {
	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	manager, err := NewWhatsAppManager(
		ctx,
		Config{
			WorkerID:                     uuid.NewString(),
			AccountID:                    uuid.NewString(),
			RuntimeGeneration:            37,
			DeferAuthStoreInitialization: true,
		},
		nil,
		nil,
		nil,
		nil,
		&WorkerPostgres{DB: db},
	)
	if err != nil {
		t.Fatalf("construct dormant manager: %v", err)
	}
	if manager.getClient() != nil {
		t.Fatal("dormant manager opened a provider auth store")
	}
	manager.mu.RLock()
	dormant := manager.authStoreDormant
	manager.mu.RUnlock()
	if !dormant {
		t.Fatal("dormant manager lost its auth-store barrier")
	}
}

func TestDormantAuthStoreOpensOnlyAfterActiveAuthorizedFenceVerification(t *testing.T) {
	scope := whatsAppRuntimeFence{
		State:              "active",
		WorkerID:           uuid.NewString(),
		RuntimeGeneration:  41,
		ConnectionEpoch:    uuid.NewString(),
		ConnectionSequence: 83,
		SourceProvider:     "whatsmeow",
		ActivatedAt:        1,
		ActivationOrder:    1,
	}
	steps := make([]string, 0, 2)
	manager := &WhatsAppManager{
		cfg:                    Config{WorkerID: scope.WorkerID, RuntimeGeneration: scope.RuntimeGeneration},
		inboundConnectionScope: &scope,
		authStoreDormant:       true,
		authStoreRuntimeFenceVerifier: func(_ context.Context, candidate whatsAppRuntimeFence) error {
			steps = append(steps, "verify")
			if candidate != scope {
				return errors.New("unexpected runtime fence")
			}
			return nil
		},
		authStoreInitializer: func(context.Context) error {
			steps = append(steps, "open")
			return nil
		},
	}

	if err := manager.initializeClientUnderActiveRuntimeFence(
		context.Background(),
		"authorized-qrcode",
	); err != nil {
		t.Fatalf("initialize dormant auth store: %v", err)
	}
	if len(steps) != 2 || steps[0] != "verify" || steps[1] != "open" {
		t.Fatalf("auth store opened before fence verification: %v", steps)
	}
	manager.mu.RLock()
	dormant := manager.authStoreDormant
	manager.mu.RUnlock()
	if dormant {
		t.Fatal("verified authorized grant did not wake dormant auth store")
	}
}

func TestDormantAuthStoreRejectsInitializationWithoutActiveFence(t *testing.T) {
	opened := false
	manager := &WhatsAppManager{
		cfg:              Config{WorkerID: uuid.NewString(), RuntimeGeneration: 43},
		authStoreDormant: true,
		authStoreInitializer: func(context.Context) error {
			opened = true
			return nil
		},
	}
	if err := manager.initializeClientUnderActiveRuntimeFence(
		context.Background(),
		"unauthorized-qrcode",
	); err == nil {
		t.Fatal("auth store initialized without an active runtime fence")
	}
	if opened {
		t.Fatal("auth store initializer ran before runtime authorization")
	}
}

func TestResolveOwnedRuntimeConnectionFenceUsesStrictRuntimeIdentity(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	postgres := &WorkerPostgres{DB: db}
	cfg := Config{WorkerID: uuid.NewString(), AccountID: uuid.NewString()}
	identity := workerDatabaseIdentity{
		Capability:  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		Container:   "abcdef123456",
		Generation:  17,
		WriterEpoch: uuid.NewString(),
	}
	authorizedEpoch := uuid.NewString()
	attemptID := uuid.NewString()
	mock.ExpectQuery(regexp.QuoteMeta("FROM resolve_whatsapp_runtime_owned_connection_fence(")).
		WithArgs(
			cfg.WorkerID,
			cfg.AccountID,
			"whatsmeow",
			identity.Generation,
			identity.WriterEpoch,
			identity.Capability,
			identity.Container,
		).
		WillReturnRows(sqlmock.NewRows([]string{
			"connection_epoch", "connection_attempt_id", "connection_sequence", "authorization_state",
		}).AddRow(authorizedEpoch, attemptID, int64(51), "owned"))

	owned, err := postgres.resolveOwnedRuntimeConnectionFence(
		context.Background(), cfg, "whatsmeow", identity,
	)
	if err != nil {
		t.Fatalf("resolve owned connection fence: %v", err)
	}
	if owned == nil || owned.ConnectionEpoch != authorizedEpoch ||
		owned.ConnectionAttemptID != attemptID || owned.ConnectionSequence != 51 ||
		owned.AuthorizationState != "owned" {
		t.Fatalf("resolved ownership changed: %+v", owned)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestResolveOwnedRuntimeConnectionFenceAcceptsPendingGrantBeforeFirstSequence(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	postgres := &WorkerPostgres{DB: db}
	cfg := Config{WorkerID: uuid.NewString(), AccountID: uuid.NewString()}
	identity := workerDatabaseIdentity{
		Capability:  "cccccccccccccccccccccccccccccccc",
		Container:   "abcdef123456",
		Generation:  23,
		WriterEpoch: uuid.NewString(),
	}
	authorizedEpoch := uuid.NewString()
	attemptID := uuid.NewString()
	mock.ExpectQuery(regexp.QuoteMeta("FROM resolve_whatsapp_runtime_owned_connection_fence(")).
		WithArgs(
			cfg.WorkerID,
			cfg.AccountID,
			"whatsmeow",
			identity.Generation,
			identity.WriterEpoch,
			identity.Capability,
			identity.Container,
		).
		WillReturnRows(sqlmock.NewRows([]string{
			"connection_epoch", "connection_attempt_id", "connection_sequence", "authorization_state",
		}).AddRow(authorizedEpoch, attemptID, int64(0), "pending"))

	owned, err := postgres.resolveOwnedRuntimeConnectionFence(
		context.Background(), cfg, "whatsmeow", identity,
	)
	if err != nil {
		t.Fatalf("resolve pending connection grant: %v", err)
	}
	if owned == nil || owned.ConnectionEpoch != authorizedEpoch ||
		owned.ConnectionAttemptID != attemptID || owned.ConnectionSequence != 0 ||
		owned.AuthorizationState != "pending" {
		t.Fatalf("resolved pending grant changed: %+v", owned)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestActivateRuntimeFencePassesExactGrantIdentityAsNinthArgument(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	postgres := &WorkerPostgres{DB: db}
	cfg := Config{WorkerID: uuid.NewString(), AccountID: uuid.NewString()}
	identity := workerDatabaseIdentity{
		Capability:  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
		Container:   "abcdef123456",
		Generation:  19,
		WriterEpoch: uuid.NewString(),
	}
	attemptID := uuid.NewString()
	authorizedEpoch := uuid.NewString()
	payload := WhatsappRuntimeFenceActivationRequest{
		WorkerID:            cfg.WorkerID,
		AccountID:           cfg.AccountID,
		SourceProvider:      "whatsmeow",
		RuntimeGeneration:   identity.Generation,
		ConnectionEpoch:     authorizedEpoch,
		ConnectionAttemptID: attemptID,
	}
	mock.ExpectQuery(regexp.QuoteMeta("FROM activate_whatsapp_runtime_fence($1::uuid, $2::uuid, $3, $4,")).
		WithArgs(
			payload.WorkerID,
			payload.AccountID,
			payload.SourceProvider,
			identity.Generation,
			identity.WriterEpoch,
			identity.Capability,
			identity.Container,
			authorizedEpoch,
			attemptID,
		).
		WillReturnRows(sqlmock.NewRows([]string{
			"activated", "already_active", "connection_sequence",
		}).AddRow(true, false, int64(52)))

	response, err := postgres.activateRuntimeFence(
		context.Background(), cfg, payload, identity,
	)
	if err != nil {
		t.Fatalf("activate authorized runtime fence: %v", err)
	}
	if !response.Activated || response.ConnectionSequence != 52 {
		t.Fatalf("unexpected activation response: %+v", response)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestActivateRuntimeFencePassesNullAttemptForLegacyRuntime(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	postgres := &WorkerPostgres{DB: db}
	cfg := Config{WorkerID: uuid.NewString(), AccountID: uuid.NewString()}
	identity := workerDatabaseIdentity{
		Capability:  "dddddddddddddddddddddddddddddddd",
		Container:   "abcdef123456",
		Generation:  29,
		WriterEpoch: uuid.NewString(),
	}
	connectionEpoch := uuid.NewString()
	payload := WhatsappRuntimeFenceActivationRequest{
		WorkerID:          cfg.WorkerID,
		AccountID:         cfg.AccountID,
		SourceProvider:    "whatsmeow",
		RuntimeGeneration: identity.Generation,
		ConnectionEpoch:   connectionEpoch,
	}
	mock.ExpectQuery(regexp.QuoteMeta("FROM activate_whatsapp_runtime_fence($1::uuid, $2::uuid, $3, $4,")).
		WithArgs(
			payload.WorkerID,
			payload.AccountID,
			payload.SourceProvider,
			identity.Generation,
			identity.WriterEpoch,
			identity.Capability,
			identity.Container,
			connectionEpoch,
			nil,
		).
		WillReturnRows(sqlmock.NewRows([]string{
			"activated", "already_active", "connection_sequence",
		}).AddRow(true, false, int64(61)))

	response, err := postgres.activateRuntimeFence(
		context.Background(), cfg, payload, identity,
	)
	if err != nil {
		t.Fatalf("activate legacy runtime fence: %v", err)
	}
	if !response.Activated || response.ConnectionSequence != 61 {
		t.Fatalf("unexpected activation response: %+v", response)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestRequestConnectionRejectsInvalidAuthorizedGrantBeforeMutatingAttempt(t *testing.T) {
	manager := &WhatsAppManager{
		cfg: Config{
			WorkerID:          uuid.NewString(),
			AccountID:         uuid.NewString(),
			RuntimeGeneration: 7,
		},
	}
	_, err := manager.RequestConnection(context.Background(), StatusConnectionRequest{
		WorkerID:                  manager.cfg.WorkerID,
		Type:                      "qrcode",
		ConnectionAttemptID:       "invalid-attempt",
		AuthorizedConnectionEpoch: uuid.NewString(),
		RuntimeGeneration:         manager.cfg.RuntimeGeneration,
	})
	if err == nil {
		t.Fatal("invalid authorized grant was accepted")
	}
	if manager.getConnectionAttemptID() != "" {
		t.Fatal("invalid authorized grant mutated active connection attempt")
	}
}

func TestRequestConnectionRejectsAuthorizedGrantGenerationMismatchBeforeActivation(t *testing.T) {
	manager := &WhatsAppManager{
		cfg: Config{
			WorkerID:          uuid.NewString(),
			AccountID:         uuid.NewString(),
			RuntimeGeneration: 7,
		},
	}
	_, err := manager.RequestConnection(context.Background(), StatusConnectionRequest{
		WorkerID:                  manager.cfg.WorkerID,
		Type:                      "qrcode",
		ConnectionAttemptID:       uuid.NewString(),
		AuthorizedConnectionEpoch: uuid.NewString(),
		RuntimeGeneration:         8,
	})
	if err == nil {
		t.Fatal("cross-generation authorized grant was accepted")
	}
	if manager.getConnectionAttemptID() != "" {
		t.Fatal("cross-generation grant mutated active connection attempt")
	}
}
