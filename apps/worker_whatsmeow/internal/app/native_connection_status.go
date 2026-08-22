package app

import (
	"context"
	"errors"
	"log"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/types/events"
)

var nativeConnectionStatusTokenPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_.:-]{0,127}$`)

var nativeConnectionStatusPersistenceRetryDelays = [...]time.Duration{
	250 * time.Millisecond,
	time.Second,
	5 * time.Second,
}

type nativeConnectionStatusPersistenceItem struct {
	State      ConnectionState
	SourceID   string
	Sequence   uint64
	EventID    string
	LeaseProof *workerConnectionStatusLeaseProof
	Attempt    int
}

func cloneOptionalBool(value *bool) *bool {
	if value == nil {
		return nil
	}
	copyValue := *value
	return &copyValue
}

func cloneWhatsappConnectionStatus(value WhatsappConnectionStatus) WhatsappConnectionStatus {
	value.SessionValid = cloneOptionalBool(value.SessionValid)
	return value
}

func safeNativeConnectionStatusToken(value string) string {
	if nativeConnectionStatusTokenPattern.MatchString(value) {
		return value
	}
	return ""
}

func normalizeNativeConnectionStatus(value events.ConnectionStatus) (WhatsappConnectionStatus, bool) {
	status := string(value.Status)
	known := false
	for _, candidate := range []events.ConnectionStatusType{
		events.ConnectionStatusInitializing,
		events.ConnectionStatusRestoring,
		events.ConnectionStatusConnecting,
		events.ConnectionStatusQR,
		events.ConnectionStatusOnline,
		events.ConnectionStatusReconnecting,
		events.ConnectionStatusOffline,
		events.ConnectionStatusLoggedOut,
		events.ConnectionStatusInvalidSession,
		events.ConnectionStatusConflict,
		events.ConnectionStatusLeaseLost,
		events.ConnectionStatusHandoff,
		events.ConnectionStatusStopped,
		events.ConnectionStatusError,
	} {
		if value.Status == candidate {
			known = true
			break
		}
	}
	if value.Provider != "whatsmeow" || !known || value.Sequence == 0 || value.ChangedAt.IsZero() {
		return WhatsappConnectionStatus{}, false
	}
	if value.Status == events.ConnectionStatusOnline &&
		(!value.Connected || !value.Authenticated || value.SessionValid == nil || !*value.SessionValid || value.QRAvailable) {
		return WhatsappConnectionStatus{}, false
	}
	if value.Status == events.ConnectionStatusQR && (value.Connected || value.Authenticated || !value.QRAvailable) {
		return WhatsappConnectionStatus{}, false
	}
	if (value.Status == events.ConnectionStatusOffline ||
		value.Status == events.ConnectionStatusLoggedOut ||
		value.Status == events.ConnectionStatusInvalidSession ||
		value.Status == events.ConnectionStatusConflict ||
		value.Status == events.ConnectionStatusLeaseLost ||
		value.Status == events.ConnectionStatusStopped ||
		value.Status == events.ConnectionStatusError) && value.Connected {
		return WhatsappConnectionStatus{}, false
	}
	return WhatsappConnectionStatus{
		Provider:      "whatsmeow",
		Status:        status,
		Connected:     value.Connected,
		Authenticated: value.Authenticated,
		SessionValid:  cloneOptionalBool(value.SessionValid),
		Recoverable:   value.Recoverable,
		QRAvailable:   value.QRAvailable,
		Sequence:      value.Sequence,
		ChangedAt:     value.ChangedAt.UTC().Format(time.RFC3339Nano),
		Reason:        safeNativeConnectionStatusToken(value.Reason),
		ErrorCode:     safeNativeConnectionStatusToken(value.ErrorCode),
	}, true
}

func (m *WhatsAppManager) readNativeConnectionStatus(client *whatsmeow.Client) events.ConnectionStatus {
	if client == nil {
		return (*whatsmeow.Client)(nil).GetConnectionStatus()
	}
	m.mu.RLock()
	reader := m.nativeStatusReader
	m.mu.RUnlock()
	if reader != nil {
		return reader(client)
	}
	return client.GetConnectionStatus()
}

func (m *WhatsAppManager) installNativeConnectionStatus(client *whatsmeow.Client) {
	if client == nil {
		return
	}
	_, ok := normalizeNativeConnectionStatus(m.readNativeConnectionStatus(client))
	if !ok {
		return
	}
	m.mu.Lock()
	if m.client == client {
		m.nativeStatusClient = client
		m.nativeStatusSourceID = uuid.NewString()
		m.nativeStatus = WhatsappConnectionStatus{}
	}
	m.mu.Unlock()
	m.acceptNativeConnectionStatus(context.Background(), client, m.readNativeConnectionStatus(client), true)
}

func (m *WhatsAppManager) nativeConnectionStatusSnapshot() (*WhatsappConnectionStatus, string) {
	m.mu.RLock()
	client := m.client
	nativeClient := m.nativeStatusClient
	sourceID := m.nativeStatusSourceID
	stored := cloneWhatsappConnectionStatus(m.nativeStatus)
	m.mu.RUnlock()
	if client == nil || client != nativeClient || sourceID == "" {
		return nil, ""
	}
	current, ok := normalizeNativeConnectionStatus(m.readNativeConnectionStatus(client))
	if !ok || current.Sequence < stored.Sequence {
		return nil, ""
	}
	stored = current
	return &stored, sourceID
}

func whatsappConnectionStatusOnline(status *WhatsappConnectionStatus) bool {
	return status != nil &&
		status.Status == string(events.ConnectionStatusOnline) &&
		status.Connected &&
		status.Authenticated &&
		status.SessionValid != nil &&
		*status.SessionValid &&
		!status.QRAvailable
}

func (m *WhatsAppManager) nativeConnectionStatusHealthEvidence() (
	status *WhatsappConnectionStatus,
	sourceID string,
	sourceCurrent bool,
	leaseRequired bool,
	leaseProofValid bool,
) {
	status, sourceID = m.nativeConnectionStatusSnapshot()
	parsedSourceID, sourceErr := uuid.Parse(sourceID)
	sourceCurrent = sourceErr == nil && parsedSourceID.String() == strings.ToLower(sourceID)
	leaseRequired = m.cfg.SessionStorage == SessionStoragePostgres
	leaseProofValid = !leaseRequired
	if leaseRequired && m.postgres != nil {
		_, leaseProofValid = m.postgres.ConnectionStatusLeaseProof()
	}
	if !sourceCurrent || !whatsappConnectionStatusOnline(status) || !leaseProofValid {
		// The database projection is asynchronous. Dispatch authorization is a
		// local safety fence and must close immediately when live proof is absent.
		m.invalidateConsumerBarrier()
	}
	return status, sourceID, sourceCurrent, leaseRequired, leaseProofValid
}

func (m *WhatsAppManager) attachNativeConnectionStatus(state *ConnectionState) {
	if state == nil {
		return
	}
	status, sourceID := m.nativeConnectionStatusSnapshot()
	state.ConnectionStatus = status
	state.ConnectionStatusSourceID = sourceID
}

func (m *WhatsAppManager) acceptNativeConnectionStatus(
	ctx context.Context,
	client *whatsmeow.Client,
	raw events.ConnectionStatus,
	publish bool,
) {
	if raw.Status == events.ConnectionStatusOnline && client != nil {
		// ONLINE is revalidated at consumption time so a delayed handler can
		// never resurrect a socket after a newer disconnect/lease transition.
		raw = m.readNativeConnectionStatus(client)
	}
	status, ok := normalizeNativeConnectionStatus(raw)
	m.mu.RLock()
	currentSource := m.client == client &&
		m.nativeStatusClient == client &&
		m.nativeStatusSourceID != ""
	m.mu.RUnlock()
	if !currentSource {
		return
	}
	if !ok {
		// A malformed snapshot from the exact active source cannot retain a stale
		// ONLINE authorization. Replaced sources were fenced above.
		m.invalidateConsumerBarrier()
		return
	}
	m.mu.Lock()
	if m.client != client || m.nativeStatusClient != client || m.nativeStatusSourceID == "" || status.Sequence <= m.nativeStatus.Sequence {
		m.mu.Unlock()
		return
	}
	m.nativeStatus = cloneWhatsappConnectionStatus(status)
	sourceID := m.nativeStatusSourceID
	m.mu.Unlock()
	if !whatsappConnectionStatusOnline(&status) {
		// Fence source identity and monotonic sequence before revocation so a
		// delayed/duplicate event cannot close a newer ONLINE generation. Once
		// accepted, dispatch closes before listeners or persistence can run.
		m.invalidateConsumerBarrier()
	}
	if whatsappConnectionStatusOnline(&status) {
		logWhatsappSessionDebug(m.cfg.WhatsappSessionDebugEnabled, "native_status.strong_online_accepted", map[string]any{
			"trace_id":           m.getDebugTraceID(),
			"session_id":         m.cfg.WorkerID,
			"provider":           "whatsmeow",
			"runtime_generation": m.cfg.RuntimeGeneration,
			"status":             status.Status,
			"sequence":           status.Sequence,
			"connected":          status.Connected,
			"authenticated":      status.Authenticated,
			"session_valid":      status.SessionValid,
			"qr_available":       status.QRAvailable,
		})
	}

	localConnectionStatusLog("whatsmeow.provider.native_connection_status", map[string]any{
		"layer":              "worker_whatsmeow.provider",
		"provider":           status.Provider,
		"worker_id":          m.cfg.WorkerID,
		"account_id":         m.cfg.AccountID,
		"worker_type_id":     WorkerTypeWhatsmeow,
		"runtime_generation": m.cfg.RuntimeGeneration,
		"status":             status.Status,
		"sequence":           status.Sequence,
		"connected":          status.Connected,
		"authenticated":      status.Authenticated,
		"session_valid":      status.SessionValid,
		"recoverable":        status.Recoverable,
		"qr_available":       status.QRAvailable,
		"reason":             status.Reason,
		"error_code":         status.ErrorCode,
	})
	if !publish {
		return
	}
	if whatsappConnectionStatusOnline(&status) &&
		(m.providerHandoffInProgress.Load() || m.sourceProviderHandoffInProgress.Load()) {
		reason := "provider_handoff_validating"
		if m.sourceProviderHandoffInProgress.Load() {
			reason = "provider_handoff_source_draining"
		} else if m.providerHandoffSnapshotResyncPending.Load() {
			reason = "app_state_snapshot_resync_pending"
		}
		logWhatsappSessionDebug(m.cfg.WhatsappSessionDebugEnabled, "native_status.persistence_deferred", map[string]any{
			"trace_id":           m.getDebugTraceID(),
			"session_id":         m.cfg.WorkerID,
			"provider":           "whatsmeow",
			"runtime_generation": m.cfg.RuntimeGeneration,
			"status":             status.Status,
			"sequence":           status.Sequence,
			"reason":             reason,
		})
		return
	}
	if status.Status == string(events.ConnectionStatusReconnecting) {
		m.scheduleTransientNativeConnectionStatusPersistence(
			client,
			status,
			sourceID,
			whatsmeowTransientDisconnectDebounce,
		)
		return
	}
	state := m.nativeConnectionState(status, sourceID)
	m.enqueueNativeConnectionStatusPersistence(state, status, sourceID)
}

func (m *WhatsAppManager) nativeConnectionState(
	status WhatsappConnectionStatus,
	sourceID string,
) ConnectionState {
	state := ConnectionState{
		Code:                     CodeInfo,
		Status:                   status.Status,
		WorkerID:                 m.cfg.WorkerID,
		AccountID:                m.cfg.AccountID,
		WorkerTypeID:             WorkerTypeWhatsmeow,
		SourceProvider:           "whatsmeow",
		EventType:                "telemetry",
		Time:                     time.Now().Unix(),
		ConnectionAttemptID:      m.getConnectionAttemptID(),
		DebugTraceID:             m.getDebugTraceID(),
		RuntimeGeneration:        m.cfg.RuntimeGeneration,
		WarmPoolID:               m.cfg.WarmPoolID,
		Authenticated:            status.Authenticated,
		ProviderState:            status.Status,
		ConnectionStatus:         &status,
		ConnectionStatusSourceID: sourceID,
	}
	if scope, ok := m.currentInboundConnectionScope(); ok {
		state.ConnectionEpoch = scope.ConnectionEpoch
		state.ConnectionSequence = scope.ConnectionSequence
	}
	if status.Status == string(events.ConnectionStatusOnline) {
		m.enrichReadiness(&state)
	}
	return state
}

// scheduleTransientNativeConnectionStatusPersistence keeps the local safety
// fence immediate while avoiding a customer-visible reconnect for a transport
// interruption that Whatsmeow heals within the normal disconnect debounce.
//
// The accepted native snapshot has already revoked the consumer barrier, so
// delaying only the database/realtime projection cannot authorize stale
// traffic. The exact client, source and monotonic sequence are checked again
// after the delay; any ONLINE recovery, terminal transition or client
// replacement suppresses the obsolete reconnecting projection.
func (m *WhatsAppManager) scheduleTransientNativeConnectionStatusPersistence(
	client *whatsmeow.Client,
	status WhatsappConnectionStatus,
	sourceID string,
	delay time.Duration,
) {
	if m == nil || client == nil || sourceID == "" || status.Sequence == 0 {
		return
	}
	if delay < 0 {
		delay = 0
	}
	status = cloneWhatsappConnectionStatus(status)
	logWhatsappSessionDebug(m.cfg.WhatsappSessionDebugEnabled, "native_status.transient_persistence_scheduled", map[string]any{
		"trace_id":           m.getDebugTraceID(),
		"session_id":         m.cfg.WorkerID,
		"provider":           "whatsmeow",
		"runtime_generation": m.cfg.RuntimeGeneration,
		"status":             status.Status,
		"sequence":           status.Sequence,
		"delay_ms":           delay.Milliseconds(),
	})

	ctx := m.connectionContext()
	go func() {
		timer := time.NewTimer(delay)
		defer timer.Stop()
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}

		m.mu.RLock()
		current := cloneWhatsappConnectionStatus(m.nativeStatus)
		currentSource := m.client == client &&
			m.nativeStatusClient == client &&
			m.nativeStatusSourceID == sourceID
		m.mu.RUnlock()
		if !currentSource || current.Sequence != status.Sequence ||
			current.Status != status.Status {
			logWhatsappSessionDebug(m.cfg.WhatsappSessionDebugEnabled, "native_status.transient_persistence_suppressed", map[string]any{
				"trace_id":           m.getDebugTraceID(),
				"session_id":         m.cfg.WorkerID,
				"provider":           "whatsmeow",
				"runtime_generation": m.cfg.RuntimeGeneration,
				"status":             status.Status,
				"sequence":           status.Sequence,
				"current_status":     current.Status,
				"current_sequence":   current.Sequence,
				"source_current":     currentSource,
			})
			return
		}

		state := m.nativeConnectionState(status, sourceID)
		m.enqueueNativeConnectionStatusPersistence(state, status, sourceID)
	}()
}

func (m *WhatsAppManager) publishCurrentNativeConnectionStatusAfterResync() {
	status, sourceID := m.nativeConnectionStatusSnapshot()
	if !whatsappConnectionStatusOnline(status) || sourceID == "" ||
		m.providerHandoffInProgress.Load() {
		return
	}
	state := m.nativeConnectionState(*status, sourceID)
	m.enqueueNativeConnectionStatusPersistence(state, *status, sourceID)
}

func (m *WhatsAppManager) enqueueNativeConnectionStatusPersistence(
	state ConnectionState,
	status WhatsappConnectionStatus,
	sourceID string,
) {
	if m == nil || m.persistNativeConnectionStatus == nil || sourceID == "" || status.Sequence == 0 {
		return
	}
	var leaseProof *workerConnectionStatusLeaseProof
	requiresLeaseProof := m.cfg.SessionStorage == SessionStoragePostgres &&
		status.Status == string(events.ConnectionStatusOnline)
	if requiresLeaseProof {
		proof, ok := m.postgres.ConnectionStatusLeaseProof()
		if !ok {
			logWhatsappSessionDebug(m.cfg.WhatsappSessionDebugEnabled, "native_status.persistence_rejected", map[string]any{
				"trace_id":           state.DebugTraceID,
				"session_id":         m.cfg.WorkerID,
				"provider":           "whatsmeow",
				"runtime_generation": m.cfg.RuntimeGeneration,
				"status":             status.Status,
				"sequence":           status.Sequence,
				"reason":             "session_lease_proof_unavailable",
			})
			localConnectionStatusLog("whatsmeow.provider.native_connection_status_persistence_rejected", map[string]any{
				"layer":              "worker_whatsmeow.provider",
				"worker_id":          m.cfg.WorkerID,
				"account_id":         m.cfg.AccountID,
				"runtime_generation": m.cfg.RuntimeGeneration,
				"status":             status.Status,
				"sequence":           status.Sequence,
				"reason":             "session_lease_proof_unavailable",
			})
			return
		}
		leaseProof = &proof
	}
	item := &nativeConnectionStatusPersistenceItem{
		State:      state,
		SourceID:   sourceID,
		Sequence:   status.Sequence,
		EventID:    uuid.NewString(),
		LeaseProof: leaseProof,
	}
	logWhatsappSessionDebug(m.cfg.WhatsappSessionDebugEnabled, "native_status.persistence_queued", map[string]any{
		"trace_id":            state.DebugTraceID,
		"session_id":          m.cfg.WorkerID,
		"provider":            "whatsmeow",
		"runtime_generation":  m.cfg.RuntimeGeneration,
		"event_type":          state.EventType,
		"status":              status.Status,
		"sequence":            status.Sequence,
		"strong_online":       whatsappConnectionStatusOnline(&status),
		"lease_proof_present": leaseProof != nil,
	})

	m.nativeStatusPublishMu.Lock()
	newest := m.nativeStatusPublishPending
	if newest == nil {
		newest = m.nativeStatusPublishActive
	}
	if newest != nil && newest.SourceID == item.SourceID && item.Sequence <= newest.Sequence {
		m.nativeStatusPublishMu.Unlock()
		return
	}
	m.nativeStatusPublishPending = item
	if m.nativeStatusPublishWake == nil {
		m.nativeStatusPublishWake = make(chan struct{}, 1)
	}
	if !m.nativeStatusPublishRunning {
		m.nativeStatusPublishRunning = true
		go m.runNativeConnectionStatusPersistence()
	} else {
		select {
		case m.nativeStatusPublishWake <- struct{}{}:
		default:
		}
	}
	m.nativeStatusPublishMu.Unlock()
}

func (m *WhatsAppManager) runNativeConnectionStatusPersistence() {
	for {
		m.nativeStatusPublishMu.Lock()
		item := m.nativeStatusPublishPending
		if item == nil {
			m.nativeStatusPublishActive = nil
			m.nativeStatusPublishRunning = false
			waiters := m.nativeStatusPublishWaiters
			m.nativeStatusPublishWaiters = nil
			m.nativeStatusPublishMu.Unlock()
			for _, waiter := range waiters {
				close(waiter)
			}
			return
		}
		m.nativeStatusPublishPending = nil
		m.nativeStatusPublishActive = item
		m.nativeStatusPublishMu.Unlock()

		startedAt := time.Now()
		publishCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		err := m.persistNativeConnectionStatus(
			publishCtx,
			item.State,
			item.EventID,
			item.LeaseProof,
		)
		cancel()
		logWhatsappSessionDebug(m.cfg.WhatsappSessionDebugEnabled, "native_status.persistence_completed", map[string]any{
			"trace_id":           item.State.DebugTraceID,
			"session_id":         m.cfg.WorkerID,
			"provider":           "whatsmeow",
			"runtime_generation": m.cfg.RuntimeGeneration,
			"event_type":         item.State.EventType,
			"status":             item.State.Status,
			"sequence":           item.Sequence,
			"attempt":            item.Attempt + 1,
			"duration_ms":        time.Since(startedAt).Milliseconds(),
			"successful":         err == nil,
			"error_code":         safeOperationalErrorCode(err),
		})

		m.nativeStatusPublishMu.Lock()
		m.nativeStatusPublishActive = nil
		retrying := false
		if err != nil && m.nativeStatusPublishPending == nil && nativeConnectionStatusPersistenceRetryable(err) {
			item.Attempt++
			m.nativeStatusPublishPending = item
			retrying = true
		}
		m.nativeStatusPublishMu.Unlock()

		if err == nil {
			continue
		}
		log.Printf(
			"persist native connection status failed worker_id=%s status=%s sequence=%d retrying=%t error_code=%s",
			m.cfg.WorkerID,
			item.State.Status,
			item.Sequence,
			retrying,
			safeOperationalErrorCode(err),
		)
		if !retrying {
			continue
		}
		delayIndex := item.Attempt - 1
		if delayIndex >= len(nativeConnectionStatusPersistenceRetryDelays) {
			delayIndex = len(nativeConnectionStatusPersistenceRetryDelays) - 1
		}
		timer := time.NewTimer(nativeConnectionStatusPersistenceRetryDelays[delayIndex])
		select {
		case <-timer.C:
		case <-m.nativeStatusPublishWake:
			if !timer.Stop() {
				select {
				case <-timer.C:
				default:
				}
			}
		}
	}
}

func nativeConnectionStatusPersistenceRetryable(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	for _, terminal := range []string{
		"worker status rejected:",
		"runtime event id is invalid",
		"lease proof is invalid",
		"database identity is incomplete",
		"scope rejected",
	} {
		if strings.Contains(message, terminal) {
			return false
		}
	}
	return true
}

func (m *WhatsAppManager) flushNativeConnectionStatusPersistence(ctx context.Context) error {
	if m == nil {
		return nil
	}
	m.nativeStatusPublishMu.Lock()
	if !m.nativeStatusPublishRunning && m.nativeStatusPublishPending == nil && m.nativeStatusPublishActive == nil {
		m.nativeStatusPublishMu.Unlock()
		return nil
	}
	waiter := make(chan struct{})
	m.nativeStatusPublishWaiters = append(m.nativeStatusPublishWaiters, waiter)
	m.nativeStatusPublishMu.Unlock()
	select {
	case <-waiter:
		return nil
	case <-ctx.Done():
		return errors.Join(errors.New("native connection status persistence remains pending"), ctx.Err())
	}
}

func (m *WhatsAppManager) stopAndPublishNativeConnectionStatus(
	ctx context.Context,
	client *whatsmeow.Client,
) {
	if m == nil || client == nil {
		return
	}
	client.Disconnect()
	m.acceptNativeConnectionStatus(
		context.Background(),
		client,
		m.readNativeConnectionStatus(client),
		true,
	)
	flushCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	if err := m.flushNativeConnectionStatusPersistence(flushCtx); err != nil {
		log.Printf(
			"flush native connection status failed worker_id=%s error_code=%s",
			m.cfg.WorkerID,
			safeOperationalErrorCode(err),
		)
	}
}
