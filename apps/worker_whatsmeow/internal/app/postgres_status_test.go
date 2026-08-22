package app

import (
	"context"
	"encoding/json"
	"errors"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestWorkerPostgresAtomicParametersDSNForPgBouncer(t *testing.T) {
	urlDSN := "postgresql://worker:secret@database.invalid:5432/under?sslmode=disable&binary_parameters=no"
	gotURL := workerPostgresAtomicParametersDSN(urlDSN)
	parsed, err := url.Parse(gotURL)
	if err != nil {
		t.Fatalf("parse normalized URL: %v", err)
	}
	if got := parsed.Query().Get("binary_parameters"); got != "yes" {
		t.Fatalf("binary_parameters = %q, want yes", got)
	}
	if got := parsed.Query().Get("sslmode"); got != "disable" {
		t.Fatalf("sslmode changed to %q", got)
	}

	keywordDSN := "host=database.invalid dbname=under binary_parameters=no"
	gotKeyword := workerPostgresAtomicParametersDSN(keywordDSN)
	if !strings.HasSuffix(gotKeyword, "binary_parameters=yes") {
		t.Fatalf("keyword DSN did not force atomic parameters: %q", gotKeyword)
	}
}

func TestWorkerPostgresJSONTextPreservesDocumentAsText(t *testing.T) {
	payload := []byte(`{"status":"online","sequence":3}`)
	got := workerPostgresJSONText(payload)
	if got != string(payload) {
		t.Fatalf("JSON text parameter = %q, want %q", got, payload)
	}
}

func TestLateSuccessfulSessionLeaseRenewalCannotSilentlyHealLocalLoss(t *testing.T) {
	originalDeadline := time.Unix(100, 0)
	originalExpiry := time.Unix(105, 0)
	state := &whatsappSessionLeaseState{
		sessionID:     "019fdc47-c4df-73e3-9b6b-1daa998b0a02",
		provider:      "whatsmeow",
		fencingToken:  2,
		generation:    11,
		expiresAt:     originalExpiry,
		localDeadline: originalDeadline,
	}
	postgres := &WorkerPostgres{
		lease:    state,
		leaseErr: ErrWhatsAppSessionLeaseLost,
	}

	// This is the exact production race: PostgreSQL renewed the old token a few
	// milliseconds after another goroutine crossed the local safety deadline.
	// The successful response must not mutate the local proof or clear the
	// sticky loss before controlled reacquisition and provider resume.
	postgres.leaseMu.Lock()
	applied, recoveryRequired, summarize, count := postgres.applySuccessfulSessionLeaseRenewalLocked(
		state,
		time.Unix(170, 0),
		time.Unix(200, 0),
		whatsappSessionLeaseTTL.Milliseconds(),
	)
	postgres.leaseMu.Unlock()

	if applied || !recoveryRequired || summarize || count != 0 {
		t.Fatalf("late renewal disposition = applied:%t recovery:%t summarize:%t count:%d", applied, recoveryRequired, summarize, count)
	}
	if !errors.Is(postgres.leaseErr, ErrWhatsAppSessionLeaseLost) {
		t.Fatalf("late renewal cleared sticky lease loss: %v", postgres.leaseErr)
	}
	if !state.expiresAt.Equal(originalExpiry) || !state.localDeadline.Equal(originalDeadline) {
		t.Fatalf("late renewal changed the rejected local proof: expiry=%v deadline=%v", state.expiresAt, state.localDeadline)
	}
}

func TestSuccessfulSessionLeaseRenewalAdvancesHealthyLocalProof(t *testing.T) {
	renewStarted := time.Unix(300, 0)
	state := &whatsappSessionLeaseState{
		localDeadline: time.Unix(250, 0),
		lastSummary:   time.Now(),
	}
	postgres := &WorkerPostgres{lease: state}

	postgres.leaseMu.Lock()
	applied, recoveryRequired, summarize, count := postgres.applySuccessfulSessionLeaseRenewalLocked(
		state,
		renewStarted,
		time.Unix(335, 0),
		whatsappSessionLeaseTTL.Milliseconds(),
	)
	postgres.leaseMu.Unlock()

	if !applied || recoveryRequired || summarize || count != 1 {
		t.Fatalf("healthy renewal disposition = applied:%t recovery:%t summarize:%t count:%d", applied, recoveryRequired, summarize, count)
	}
	wantDeadline := renewStarted.Add(whatsappSessionLeaseTTL)
	if !state.localDeadline.Equal(wantDeadline) || state.renewed != 1 {
		t.Fatalf("healthy renewal did not advance proof: deadline=%v renewals=%d", state.localDeadline, state.renewed)
	}
}

func TestOpenWorkerPostgresRequiresDatabaseForLegacyRuntime(t *testing.T) {
	_, err := OpenWorkerPostgres(context.Background(), Config{
		SessionStorage: SessionStorageLegacyVolume,
	})
	if err == nil {
		t.Fatal("OpenWorkerPostgres() accepted a legacy runtime without its status outbox database")
	}
}

func TestAttachRuntimeFenceBuildsCanonicalOnlineStatus(t *testing.T) {
	epoch := uuid.NewString()
	scope := whatsAppRuntimeFence{
		State:              "active",
		WorkerID:           "worker-1",
		RuntimeGeneration:  9,
		ConnectionEpoch:    epoch,
		SourceProvider:     "whatsmeow",
		ActivatedAt:        time.Now().UnixMilli(),
		ActivationOrder:    1,
		ConnectionSequence: 27,
	}
	manager := &WhatsAppManager{cfg: Config{
		WorkerID:          "worker-1",
		AccountID:         "account-1",
		RuntimeGeneration: 9,
	}}
	state := ConnectionState{
		WorkerID:          "worker-1",
		AccountID:         "account-1",
		WorkerTypeID:      WorkerTypeWhatsmeow,
		RuntimeGeneration: 9,
		WorkerStatusID:    WorkerStatusOnline,
		Status:            "connected",
	}

	manager.attachRuntimeFenceToConnectionState(withInboundConnectionScope(context.Background(), scope), &state)

	if state.WorkerTypeID != WorkerTypeWhatsmeow || state.SourceProvider != "whatsmeow" {
		t.Fatalf("provider identity was not canonicalized: %+v", state)
	}
	if state.EventType != "status" || !state.RequiresConnectionFence {
		t.Fatalf("online status is missing fence metadata: %+v", state)
	}
	if state.ConnectionEpoch != epoch || state.ConnectionSequence != 27 {
		t.Fatalf("online status has the wrong fence: %+v", state)
	}

	payload, err := json.Marshal(state)
	if err != nil {
		t.Fatalf("marshal status: %v", err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(payload, &decoded); err != nil {
		t.Fatalf("decode status: %v", err)
	}
	for _, key := range []string{"worker_type_id", "source_provider", "event_type", "connection_epoch", "connection_sequence", "requires_connection_fence"} {
		if _, ok := decoded[key]; !ok {
			t.Fatalf("canonical online payload is missing %q: %s", key, payload)
		}
	}
}

func TestCanonicalWorkerStatusPayloadRejectsUnfencedOnlineStatus(t *testing.T) {
	cfg := Config{WorkerID: "worker-1", AccountID: "account-1", RuntimeGeneration: 4}
	_, err := canonicalWorkerStatusPayload(cfg, ConnectionState{
		WorkerStatusID: WorkerStatusOnline,
		Status:         "connected",
	})
	if err == nil {
		t.Fatal("unfenced online status was accepted")
	}
}

func TestCanonicalWorkerStatusPayloadFillsProviderIdentity(t *testing.T) {
	epoch := uuid.NewString()
	cfg := Config{WorkerID: "worker-1", AccountID: "account-1", RuntimeGeneration: 4}
	state, err := canonicalWorkerStatusPayload(cfg, ConnectionState{
		WorkerStatusID:     WorkerStatusOnline,
		Status:             "connected",
		ConnectionEpoch:    epoch,
		ConnectionSequence: 3,
	})
	if err != nil {
		t.Fatalf("canonicalize status: %v", err)
	}
	if state.WorkerID != cfg.WorkerID || state.AccountID != cfg.AccountID ||
		state.WorkerTypeID != WorkerTypeWhatsmeow || state.SourceProvider != "whatsmeow" ||
		state.RuntimeGeneration != cfg.RuntimeGeneration || state.EventType != "status" ||
		!state.RequiresConnectionFence {
		t.Fatalf("unexpected canonical status: %+v", state)
	}
}
