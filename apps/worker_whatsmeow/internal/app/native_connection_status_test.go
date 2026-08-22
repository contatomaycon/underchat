package app

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	"google.golang.org/protobuf/proto"
)

type workerConnectionStatusFenceContainer struct {
	fence store.ConnectionStatusFence
	err   error
}

func (*workerConnectionStatusFenceContainer) PutDevice(context.Context, *store.Device) error {
	return nil
}

func (*workerConnectionStatusFenceContainer) DeleteDevice(context.Context, *store.Device) error {
	return nil
}

func (container *workerConnectionStatusFenceContainer) CurrentConnectionStatusFence(string, int64) (store.ConnectionStatusFence, error) {
	return container.fence, container.err
}

func optionalBool(value bool) *bool {
	return &value
}

func validNativeConnectionStatus() events.ConnectionStatus {
	return events.ConnectionStatus{
		Provider:      "whatsmeow",
		Status:        events.ConnectionStatusOnline,
		Connected:     true,
		Authenticated: true,
		SessionValid:  optionalBool(true),
		Recoverable:   true,
		Sequence:      1,
		ChangedAt:     time.Date(2026, time.August, 4, 12, 0, 0, 123, time.FixedZone("test", -3*60*60)),
		Reason:        "socket.open",
		ErrorCode:     "unsafe value",
	}
}

func TestNormalizeNativeConnectionStatusKeepsOnlyCoherentSecretFreeState(t *testing.T) {
	normalized, ok := normalizeNativeConnectionStatus(validNativeConnectionStatus())
	if !ok {
		t.Fatal("valid native status was rejected")
	}
	if normalized.Provider != "whatsmeow" || normalized.Status != "online" || normalized.Sequence != 1 {
		t.Fatalf("unexpected canonical status: %+v", normalized)
	}
	if !normalized.Connected || !normalized.Authenticated || normalized.SessionValid == nil || !*normalized.SessionValid {
		t.Fatalf("online invariants were not preserved: %+v", normalized)
	}
	if normalized.ChangedAt != "2026-08-04T15:00:00.000000123Z" {
		t.Fatalf("timestamp was not canonicalized: %q", normalized.ChangedAt)
	}
	if normalized.Reason != "socket.open" || normalized.ErrorCode != "" {
		t.Fatalf("unsafe diagnostics were not removed: %+v", normalized)
	}
}

func TestNormalizeNativeConnectionStatusRejectsUnknownOrIncoherentState(t *testing.T) {
	for name, mutate := range map[string]func(*events.ConnectionStatus){
		"wrong provider":         func(value *events.ConnectionStatus) { value.Provider = "baileys" },
		"zero sequence":          func(value *events.ConnectionStatus) { value.Sequence = 0 },
		"online disconnected":    func(value *events.ConnectionStatus) { value.Connected = false },
		"online invalid session": func(value *events.ConnectionStatus) { value.SessionValid = optionalBool(false) },
		"online with qr":         func(value *events.ConnectionStatus) { value.QRAvailable = true },
		"unknown status":         func(value *events.ConnectionStatus) { value.Status = "provider_private" },
	} {
		t.Run(name, func(t *testing.T) {
			value := validNativeConnectionStatus()
			mutate(&value)
			if _, ok := normalizeNativeConnectionStatus(value); ok {
				t.Fatalf("incoherent status was accepted: %+v", value)
			}
		})
	}
}

func TestExpiredLeaseNotifiesProviderAtFirstAuthorizationCheckOnlyOnce(t *testing.T) {
	notified := make(chan struct{}, 2)
	postgres := &WorkerPostgres{
		lease: &whatsappSessionLeaseState{
			fencingToken:  7,
			localDeadline: time.Now().Add(-time.Second),
		},
		leaseLostHandler: func() { notified <- struct{}{} },
	}

	if token, valid := postgres.SessionLeaseToken(); valid || token != 0 {
		t.Fatalf("expired lease returned token %d valid=%v", token, valid)
	}
	select {
	case <-notified:
	case <-time.After(time.Second):
		t.Fatal("lease loss did not immediately notify the provider")
	}

	if _, _, _, _, _, err := postgres.SessionOperationFence(); !errors.Is(err, ErrWhatsAppSessionLeaseLost) {
		t.Fatalf("expired operation fence returned %v", err)
	}
	select {
	case <-notified:
		t.Fatal("lease loss handler ran more than once")
	case <-time.After(25 * time.Millisecond):
	}
}

func TestConnectionStatusLeaseProofRequiresCurrentUnexpiredLease(t *testing.T) {
	ownerID := "019fce0d-1d24-7000-8000-000000000020"
	postgres := &WorkerPostgres{lease: &whatsappSessionLeaseState{
		ownerID:       ownerID,
		fencingToken:  23,
		localDeadline: time.Now().Add(time.Minute),
	}}
	proof, ok := postgres.ConnectionStatusLeaseProof()
	if !ok || proof.OwnerID != ownerID || proof.FencingToken != 23 {
		t.Fatalf("active lease proof was not returned: proof=%+v ok=%v", proof, ok)
	}

	postgres.leaseErr = ErrWhatsAppSessionLeaseLost
	if proof, ok := postgres.ConnectionStatusLeaseProof(); ok || proof.FencingToken != 0 {
		t.Fatalf("lost lease exposed proof: proof=%+v ok=%v", proof, ok)
	}

	notified := make(chan struct{}, 1)
	postgres.leaseErr = nil
	postgres.lease.localDeadline = time.Now().Add(-time.Second)
	postgres.leaseLostNotified = false
	postgres.leaseLostHandler = func() {
		// Re-entering proves the callback is not invoked while leaseMu is held.
		_, _ = postgres.ConnectionStatusLeaseProof()
		notified <- struct{}{}
	}
	if proof, ok := postgres.ConnectionStatusLeaseProof(); ok || proof.FencingToken != 0 {
		t.Fatalf("expired lease exposed proof: proof=%+v ok=%v", proof, ok)
	}
	select {
	case <-notified:
	case <-time.After(time.Second):
		t.Fatal("expired proof check did not notify lease loss")
	}
}

func TestNativeConnectionStatusPersistenceRetriesSameEventID(t *testing.T) {
	var eventIDs []string
	unexpectedProof := false
	manager := &WhatsAppManager{
		cfg: Config{WorkerID: "019fce0d-1d24-7000-8000-000000000021"},
		persistNativeConnectionStatus: func(_ context.Context, _ ConnectionState, eventID string, proof *workerConnectionStatusLeaseProof) error {
			if proof != nil {
				unexpectedProof = true
			}
			eventIDs = append(eventIDs, eventID)
			if len(eventIDs) == 1 {
				return errors.New("temporary database outage")
			}
			return nil
		},
		nativeStatusPublishWake: make(chan struct{}, 1),
	}
	manager.enqueueNativeConnectionStatusPersistence(
		ConnectionState{Status: string(events.ConnectionStatusStopped)},
		WhatsappConnectionStatus{Status: string(events.ConnectionStatusStopped), Sequence: 2},
		"019fce0d-1d24-7000-8000-000000000022",
	)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := manager.flushNativeConnectionStatusPersistence(ctx); err != nil {
		t.Fatal(err)
	}
	if len(eventIDs) != 2 || eventIDs[0] != eventIDs[1] {
		t.Fatalf("retry did not reuse one event ID: %#v", eventIDs)
	}
	if unexpectedProof {
		t.Fatal("terminal legacy status unexpectedly carried lease proof")
	}
}

func TestNonOnlineNativeStatusRevokesDispatchBeforePersistence(t *testing.T) {
	client := whatsmeow.NewClient(&store.Device{}, nil)
	revoked := false
	persistedAfterRevocation := make(chan bool, 1)
	manager := &WhatsAppManager{
		cfg: Config{
			WorkerID:  "019fce0d-1d24-7000-8000-000000000040",
			AccountID: "019fce0d-1d24-7000-8000-000000000041",
		},
		client:                    client,
		nativeStatusClient:        client,
		nativeStatusSourceID:      "019fce0d-1d24-7000-8000-000000000042",
		nativeStatus:              WhatsappConnectionStatus{Sequence: 1},
		consumerBarrierInvalidate: func() { revoked = true },
		persistNativeConnectionStatus: func(context.Context, ConnectionState, string, *workerConnectionStatusLeaseProof) error {
			persistedAfterRevocation <- revoked
			return nil
		},
	}
	manager.acceptNativeConnectionStatus(context.Background(), client, events.ConnectionStatus{
		Provider:      "whatsmeow",
		Status:        events.ConnectionStatusLeaseLost,
		Connected:     false,
		Authenticated: true,
		SessionValid:  optionalBool(true),
		Recoverable:   true,
		Sequence:      2,
		ChangedAt:     time.Now(),
		Reason:        "lease_lost",
	}, true)

	if !revoked {
		t.Fatal("non-ONLINE snapshot did not synchronously revoke dispatch")
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := manager.flushNativeConnectionStatusPersistence(ctx); err != nil {
		t.Fatal(err)
	}
	if persistedAfter := <-persistedAfterRevocation; !persistedAfter {
		t.Fatal("native persistence started before dispatch revocation")
	}
}

func TestNativeReconnectingRevokesImmediatelyButDefersRealtimePersistence(t *testing.T) {
	client := whatsmeow.NewClient(&store.Device{}, nil)
	runtimeCtx, cancel := context.WithCancel(context.Background())
	defer cancel()
	revoked := false
	persisted := make(chan ConnectionState, 1)
	manager := &WhatsAppManager{
		cfg: Config{
			WorkerID:  "019fce0d-1d24-7000-8000-000000000060",
			AccountID: "019fce0d-1d24-7000-8000-000000000061",
		},
		client:                    client,
		nativeStatusClient:        client,
		nativeStatusSourceID:      "019fce0d-1d24-7000-8000-000000000062",
		nativeStatus:              WhatsappConnectionStatus{Sequence: 1},
		runtimeCtx:                runtimeCtx,
		consumerBarrierInvalidate: func() { revoked = true },
		persistNativeConnectionStatus: func(_ context.Context, state ConnectionState, _ string, _ *workerConnectionStatusLeaseProof) error {
			persisted <- state
			return nil
		},
	}
	manager.acceptNativeConnectionStatus(context.Background(), client, events.ConnectionStatus{
		Provider:      "whatsmeow",
		Status:        events.ConnectionStatusReconnecting,
		Connected:     false,
		Authenticated: true,
		SessionValid:  optionalBool(true),
		Recoverable:   true,
		Sequence:      2,
		ChangedAt:     time.Now(),
		Reason:        "remote_disconnect",
	}, true)

	if !revoked {
		t.Fatal("native reconnecting did not synchronously revoke dispatch")
	}
	select {
	case state := <-persisted:
		t.Fatalf("transient reconnecting escaped before debounce: %+v", state)
	case <-time.After(25 * time.Millisecond):
	}
}

func TestTransientNativeReconnectPersistenceIsSuppressedByOnlineRecovery(t *testing.T) {
	client := whatsmeow.NewClient(&store.Device{}, nil)
	sourceID := "019fce0d-1d24-7000-8000-000000000063"
	valid := true
	reconnecting := WhatsappConnectionStatus{
		Provider:      "whatsmeow",
		Status:        string(events.ConnectionStatusReconnecting),
		Authenticated: true,
		SessionValid:  &valid,
		Recoverable:   true,
		Sequence:      4,
		ChangedAt:     time.Now().UTC().Format(time.RFC3339Nano),
	}
	persisted := make(chan ConnectionState, 1)
	manager := &WhatsAppManager{
		cfg:                  Config{WorkerID: "019fce0d-1d24-7000-8000-000000000064"},
		client:               client,
		nativeStatusClient:   client,
		nativeStatusSourceID: sourceID,
		nativeStatus:         reconnecting,
		persistNativeConnectionStatus: func(_ context.Context, state ConnectionState, _ string, _ *workerConnectionStatusLeaseProof) error {
			persisted <- state
			return nil
		},
	}
	manager.scheduleTransientNativeConnectionStatusPersistence(
		client, reconnecting, sourceID, 20*time.Millisecond,
	)

	manager.mu.Lock()
	manager.nativeStatus = WhatsappConnectionStatus{
		Provider:      "whatsmeow",
		Status:        string(events.ConnectionStatusOnline),
		Connected:     true,
		Authenticated: true,
		SessionValid:  &valid,
		Sequence:      5,
		ChangedAt:     time.Now().UTC().Format(time.RFC3339Nano),
	}
	manager.mu.Unlock()

	select {
	case state := <-persisted:
		t.Fatalf("recovered reconnecting snapshot was persisted: %+v", state)
	case <-time.After(60 * time.Millisecond):
	}
}

func TestTransientNativeReconnectPersistencePublishesWhenStillCurrent(t *testing.T) {
	client := whatsmeow.NewClient(&store.Device{}, nil)
	sourceID := "019fce0d-1d24-7000-8000-000000000065"
	valid := true
	reconnecting := WhatsappConnectionStatus{
		Provider:      "whatsmeow",
		Status:        string(events.ConnectionStatusReconnecting),
		Authenticated: true,
		SessionValid:  &valid,
		Recoverable:   true,
		Sequence:      6,
		ChangedAt:     time.Now().UTC().Format(time.RFC3339Nano),
	}
	persisted := make(chan ConnectionState, 1)
	manager := &WhatsAppManager{
		cfg:                  Config{WorkerID: "019fce0d-1d24-7000-8000-000000000066"},
		client:               client,
		nativeStatusClient:   client,
		nativeStatusSourceID: sourceID,
		nativeStatus:         reconnecting,
		persistNativeConnectionStatus: func(_ context.Context, state ConnectionState, _ string, _ *workerConnectionStatusLeaseProof) error {
			persisted <- state
			return nil
		},
	}
	manager.scheduleTransientNativeConnectionStatusPersistence(
		client, reconnecting, sourceID, time.Millisecond,
	)

	select {
	case state := <-persisted:
		if state.Status != string(events.ConnectionStatusReconnecting) ||
			state.ConnectionStatus == nil || state.ConnectionStatus.Sequence != 6 {
			t.Fatalf("unexpected debounced reconnecting projection: %+v", state)
		}
	case <-time.After(time.Second):
		t.Fatal("current reconnecting snapshot was not persisted after debounce")
	}
}

func TestNativeStatusFencesSourceMismatchStaleAndDuplicateBeforeRevocation(t *testing.T) {
	client := whatsmeow.NewClient(&store.Device{}, nil)
	replacedClient := whatsmeow.NewClient(&store.Device{}, nil)
	revocations := 0
	sessionValid := true
	manager := &WhatsAppManager{
		client:               client,
		nativeStatusClient:   client,
		nativeStatusSourceID: "019fce0d-1d24-7000-8000-000000000043",
		nativeStatus: WhatsappConnectionStatus{
			Provider:      "whatsmeow",
			Status:        string(events.ConnectionStatusOnline),
			Connected:     true,
			Authenticated: true,
			SessionValid:  &sessionValid,
			Sequence:      5,
			ChangedAt:     time.Now().UTC().Format(time.RFC3339Nano),
		},
		consumerBarrierInvalidate: func() { revocations++ },
	}
	offline := func(sequence uint64) events.ConnectionStatus {
		return events.ConnectionStatus{
			Provider:      "whatsmeow",
			Status:        events.ConnectionStatusOffline,
			Connected:     false,
			Authenticated: true,
			SessionValid:  optionalBool(true),
			Recoverable:   true,
			Sequence:      sequence,
			ChangedAt:     time.Now(),
			Reason:        "socket_closed",
		}
	}

	manager.acceptNativeConnectionStatus(context.Background(), client, offline(4), true)
	manager.acceptNativeConnectionStatus(context.Background(), client, offline(5), true)
	manager.acceptNativeConnectionStatus(context.Background(), replacedClient, offline(6), true)

	if revocations != 0 {
		t.Fatalf("untrusted or non-monotonic snapshots revoked current ONLINE dispatch: %d", revocations)
	}
	if manager.nativeStatus.Sequence != 5 || manager.nativeStatus.Status != string(events.ConnectionStatusOnline) {
		t.Fatalf("untrusted snapshot replaced current native status: %+v", manager.nativeStatus)
	}
}

func TestInstallNativeConnectionStatusPublishesInitialSnapshot(t *testing.T) {
	client := whatsmeow.NewClient(&store.Device{}, nil)
	persisted := make(chan struct {
		state   ConnectionState
		eventID string
		proof   *workerConnectionStatusLeaseProof
	}, 1)
	manager := &WhatsAppManager{
		cfg: Config{
			WorkerID:          "019fce0d-1d24-7000-8000-000000000025",
			AccountID:         "019fce0d-1d24-7000-8000-000000000026",
			RuntimeGeneration: 4,
		},
		client: client,
		persistNativeConnectionStatus: func(_ context.Context, state ConnectionState, eventID string, proof *workerConnectionStatusLeaseProof) error {
			persisted <- struct {
				state   ConnectionState
				eventID string
				proof   *workerConnectionStatusLeaseProof
			}{state: state, eventID: eventID, proof: proof}
			return nil
		},
	}

	manager.installNativeConnectionStatus(client)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := manager.flushNativeConnectionStatusPersistence(ctx); err != nil {
		t.Fatal(err)
	}

	result := <-persisted
	if result.proof != nil {
		t.Fatalf("legacy initial snapshot carried lease proof: %+v", result.proof)
	}
	if _, err := uuid.Parse(result.eventID); err != nil {
		t.Fatalf("initial snapshot event ID is not a UUID: %q", result.eventID)
	}
	status := result.state.ConnectionStatus
	if status == nil || status.Provider != "whatsmeow" || status.Status != "initializing" || status.Sequence < 1 {
		t.Fatalf("unexpected initial native status: %+v", status)
	}
	if result.state.ConnectionStatusSourceID == "" || result.state.EventType != "telemetry" {
		t.Fatalf("initial publication omitted source/telemetry scope: %+v", result.state)
	}
}

func TestStrongOnlinePersistenceWaitsForProviderHandoffPromotion(t *testing.T) {
	client := whatsmeow.NewClient(&store.Device{}, nil)
	status := validNativeConnectionStatus()
	status.Sequence = 2
	ownerID := "019fce0d-1d24-7000-8000-000000000050"
	persisted := make(chan struct {
		status string
		proof  *workerConnectionStatusLeaseProof
	}, 1)
	manager := &WhatsAppManager{
		cfg: Config{
			WorkerID:       "019fce0d-1d24-7000-8000-000000000051",
			AccountID:      "019fce0d-1d24-7000-8000-000000000052",
			SessionStorage: SessionStoragePostgres,
		},
		client:               client,
		nativeStatusClient:   client,
		nativeStatusSourceID: "019fce0d-1d24-7000-8000-000000000053",
		nativeStatusReader: func(*whatsmeow.Client) events.ConnectionStatus {
			return status
		},
		postgres: &WorkerPostgres{lease: &whatsappSessionLeaseState{
			ownerID:       ownerID,
			fencingToken:  101,
			localDeadline: time.Now().Add(time.Minute),
		}},
		persistNativeConnectionStatus: func(
			_ context.Context,
			state ConnectionState,
			_ string,
			proof *workerConnectionStatusLeaseProof,
		) error {
			persisted <- struct {
				status string
				proof  *workerConnectionStatusLeaseProof
			}{status: state.Status, proof: proof}
			return nil
		},
	}
	manager.providerHandoffInProgress.Store(true)
	manager.providerHandoffSnapshotResyncPending.Store(true)

	manager.acceptNativeConnectionStatus(
		context.Background(), client, status, true,
	)
	select {
	case value := <-persisted:
		t.Fatalf("candidate ONLINE escaped before promotion: %+v", value)
	case <-time.After(25 * time.Millisecond):
	}
	if snapshot, sourceID := manager.nativeConnectionStatusSnapshot(); !whatsappConnectionStatusOnline(snapshot) || sourceID == "" {
		t.Fatalf("deferred native proof was not retained locally: status=%+v source=%q", snapshot, sourceID)
	}

	manager.providerHandoffSnapshotResyncPending.Store(false)
	manager.providerHandoffInProgress.Store(false)
	manager.publishCurrentNativeConnectionStatusAfterResync()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := manager.flushNativeConnectionStatusPersistence(ctx); err != nil {
		t.Fatal(err)
	}
	value := <-persisted
	if value.status != string(events.ConnectionStatusOnline) ||
		value.proof == nil || value.proof.OwnerID != ownerID ||
		value.proof.FencingToken != 101 {
		t.Fatalf("promoted ONLINE omitted exact lease proof: %+v", value)
	}
}

func TestStrongOnlineWorkerStatusUsesExactNativeSourceAndLeaseProof(t *testing.T) {
	client := whatsmeow.NewClient(&store.Device{}, nil)
	sessionValid := true
	ownerID := "019fce0d-1d24-7000-8000-000000000027"
	persisted := make(chan struct {
		state ConnectionState
		proof *workerConnectionStatusLeaseProof
	}, 1)
	notifyCalls := 0
	manager := &WhatsAppManager{
		cfg: Config{
			WorkerID:       "019fce0d-1d24-7000-8000-000000000028",
			AccountID:      "019fce0d-1d24-7000-8000-000000000029",
			SessionStorage: SessionStoragePostgres,
		},
		client:               client,
		nativeStatusClient:   client,
		nativeStatusSourceID: "019fce0d-1d24-7000-8000-000000000030",
		nativeStatus: WhatsappConnectionStatus{
			Provider:      "whatsmeow",
			Status:        string(events.ConnectionStatusOnline),
			Connected:     true,
			Authenticated: true,
			SessionValid:  &sessionValid,
			Sequence:      100,
			ChangedAt:     time.Now().UTC().Format(time.RFC3339Nano),
		},
		nativeStatusReader: func(*whatsmeow.Client) events.ConnectionStatus {
			return events.ConnectionStatus{
				Provider:      "whatsmeow",
				Status:        events.ConnectionStatusOnline,
				Connected:     true,
				Authenticated: true,
				SessionValid:  optionalBool(true),
				Sequence:      100,
				ChangedAt:     time.Now(),
			}
		},
		postgres: &WorkerPostgres{lease: &whatsappSessionLeaseState{
			ownerID:       ownerID,
			fencingToken:  91,
			localDeadline: time.Now().Add(time.Minute),
		}},
		notifyWorkerStatus: func(context.Context, ConnectionState) error {
			notifyCalls++
			return nil
		},
		persistNativeConnectionStatus: func(_ context.Context, state ConnectionState, _ string, proof *workerConnectionStatusLeaseProof) error {
			persisted <- struct {
				state ConnectionState
				proof *workerConnectionStatusLeaseProof
			}{state: state, proof: proof}
			return nil
		},
	}

	err := manager.persistWorkerStatus(context.Background(), ConnectionState{
		WorkerStatusID:    WorkerStatusOnline,
		SessionReady:      true,
		CanSend:           true,
		CanReceiveRuntime: true,
		Authenticated:     true,
	})
	if err != nil {
		t.Fatal(err)
	}
	result := <-persisted
	if notifyCalls != 0 {
		t.Fatalf("strong PostgreSQL ONLINE bypassed proof-aware writer: calls=%d", notifyCalls)
	}
	if result.proof == nil || result.proof.OwnerID != ownerID || result.proof.FencingToken != 91 {
		t.Fatalf("strong ONLINE omitted exact lease proof: %+v", result.proof)
	}
	if result.state.ConnectionStatus == nil || result.state.ConnectionStatus.Status != "online" ||
		result.state.ConnectionStatusSourceID != manager.nativeStatusSourceID {
		t.Fatalf("strong ONLINE omitted exact native source: %+v", result.state)
	}

	manager.postgres.leaseErr = ErrWhatsAppSessionLeaseLost
	if err := manager.persistWorkerStatus(context.Background(), ConnectionState{
		WorkerStatusID:    WorkerStatusOnline,
		SessionReady:      true,
		CanSend:           true,
		CanReceiveRuntime: true,
		Authenticated:     true,
	}); err == nil || !strings.Contains(err.Error(), "lease proof is unavailable") {
		t.Fatalf("lost lease did not fail strong ONLINE closed: %v", err)
	}
}

func TestTerminalNativeStatusPersistsWithoutLeaseProof(t *testing.T) {
	persisted := make(chan *workerConnectionStatusLeaseProof, 1)
	manager := &WhatsAppManager{
		cfg: Config{
			WorkerID:       "019fce0d-1d24-7000-8000-000000000023",
			SessionStorage: SessionStoragePostgres,
		},
		postgres: &WorkerPostgres{},
		persistNativeConnectionStatus: func(_ context.Context, _ ConnectionState, _ string, proof *workerConnectionStatusLeaseProof) error {
			persisted <- proof
			return nil
		},
		nativeStatusPublishWake: make(chan struct{}, 1),
	}
	manager.enqueueNativeConnectionStatusPersistence(
		ConnectionState{Status: string(events.ConnectionStatusLeaseLost)},
		WhatsappConnectionStatus{Status: string(events.ConnectionStatusLeaseLost), Sequence: 3},
		"019fce0d-1d24-7000-8000-000000000024",
	)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := manager.flushNativeConnectionStatusPersistence(ctx); err != nil {
		t.Fatal(err)
	}
	if proof := <-persisted; proof != nil {
		t.Fatalf("terminal status carried an unavailable lease proof: %+v", proof)
	}
}

func TestLateLeaseLossHandlerStillReceivesExistingLoss(t *testing.T) {
	notified := make(chan struct{}, 1)
	postgres := &WorkerPostgres{leaseErr: ErrWhatsAppSessionLeaseLost}
	postgres.SetSessionLeaseLostHandler(func() { notified <- struct{}{} })

	select {
	case <-notified:
	case <-time.After(time.Second):
		t.Fatal("late handler missed an already definitive lease loss")
	}
}

func TestDynamicConnectionStatusPreservesOptionalSessionValidity(t *testing.T) {
	descriptors, err := getDescriptors()
	if err != nil {
		t.Fatalf("build descriptors: %v", err)
	}
	response := newDynamicMessage(descriptors.workerConnectionResponse)
	invalid := false
	setDynamicConnectionStatus(response, "connection_status", &WhatsappConnectionStatus{
		Provider:      "whatsmeow",
		Status:        "invalid_session",
		SessionValid:  &invalid,
		Recoverable:   false,
		Sequence:      2,
		ChangedAt:     "2026-08-04T12:00:00Z",
		Authenticated: false,
	})
	wire, err := proto.Marshal(response)
	if err != nil {
		t.Fatalf("marshal response: %v", err)
	}
	decoded := newDynamicMessage(descriptors.workerConnectionResponse)
	if err := proto.Unmarshal(wire, decoded); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	statusField := decoded.Descriptor().Fields().ByName("connection_status")
	status := decoded.Get(statusField).Message()
	sessionValidField := status.Descriptor().Fields().ByName("sessionValid")
	if !status.Has(sessionValidField) || status.Get(sessionValidField).Bool() {
		t.Fatal("explicit false session validity lost protobuf presence")
	}

	unknownResponse := newDynamicMessage(descriptors.workerConnectionResponse)
	setDynamicConnectionStatus(unknownResponse, "connection_status", &WhatsappConnectionStatus{
		Provider:  "whatsmeow",
		Status:    "initializing",
		Sequence:  1,
		ChangedAt: "2026-08-04T12:00:00Z",
	})
	unknownWire, err := proto.Marshal(unknownResponse)
	if err != nil {
		t.Fatalf("marshal unknown response: %v", err)
	}
	unknownDecoded := newDynamicMessage(descriptors.workerConnectionResponse)
	if err := proto.Unmarshal(unknownWire, unknownDecoded); err != nil {
		t.Fatalf("unmarshal unknown response: %v", err)
	}
	unknownStatus := unknownDecoded.Get(statusField).Message()
	if unknownStatus.Has(sessionValidField) {
		t.Fatal("unknown session validity was encoded as explicit false")
	}
}

func TestConnectionHealthKeepsConfirmedHandoffSourceClosed(t *testing.T) {
	container := &workerConnectionStatusFenceContainer{fence: store.ConnectionStatusFence{
		Required: true, OwnerID: "health-owner-must-not-escape", FencingToken: 71, Generation: 10,
		Epoch: "019fce0d-1d24-7000-8000-000000000006",
	}}
	jid := types.NewJID("15550000002", types.DefaultUserServer)
	client := whatsmeow.NewClient(&store.Device{
		ID: &jid, SessionID: "019fce0d-1d24-7000-8000-000000000007", RevisionID: 13,
		Container: container,
	}, nil)
	manager := &WhatsAppManager{
		cfg: Config{
			WorkerID:  "019fce0d-1d24-7000-8000-000000000007",
			AccountID: "019fce0d-1d24-7000-8000-000000000008",
		},
		client: client,
		status: "disconnected",
	}
	manager.installNativeConnectionStatus(client)

	client.MarkConnectionHandoff()
	client.Disconnect()
	container.err = errors.New("lease intentionally released")
	if !client.MarkConnectionHandoffSourceClosed() {
		t.Fatal("confirmed handoff source close was rejected")
	}

	health := manager.ConnectionHealth()
	status, ok := health["connection_status"].(*WhatsappConnectionStatus)
	if !ok || status == nil {
		t.Fatalf("worker health omitted native connection status: %#v", health["connection_status"])
	}
	if status.Status != "handoff" || status.Reason != "handoff_source_closed" || status.Connected {
		t.Fatalf("worker health misreported intentional release: %+v", status)
	}
	if sourceID, _ := health["connection_status_source_id"].(string); sourceID == "" {
		t.Fatal("worker health omitted the status source ID")
	}
	encoded, err := json.Marshal(status)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), container.fence.OwnerID) || strings.Contains(string(encoded), "fencing") {
		t.Fatalf("worker health exposed internal fence identity: %s", encoded)
	}
}
