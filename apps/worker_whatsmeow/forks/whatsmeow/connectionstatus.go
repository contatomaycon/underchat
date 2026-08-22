// Copyright (c) 2026 Underchat
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

package whatsmeow

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode"

	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types/events"
)

const connectionStatusProvider = "whatsmeow"

var (
	errConnectionStatusTerminal         = errors.New("connection status requires a new client lifecycle")
	errConnectionStatusLeaseUnavailable = errors.New("connection status lease is unavailable")
)

type connectionValidityUpdate uint8

const (
	connectionValidityPreserve connectionValidityUpdate = iota
	connectionValidityUnknown
	connectionValidityValid
	connectionValidityInvalid
)

type connectionConnectedUpdate uint8

const (
	connectionConnectedDefault connectionConnectedUpdate = iota
	connectionConnectedFalse
	connectionConnectedTrue
)

type connectionStatusHandoffPhase uint8

const (
	connectionStatusHandoffNone connectionStatusHandoffPhase = iota
	connectionStatusHandoffDraining
	connectionStatusHandoffSourceClosed
)

type connectionStatusTransition struct {
	status                events.ConnectionStatusType
	validity              connectionValidityUpdate
	connected             connectionConnectedUpdate
	fence                 *store.ConnectionStatusFence
	handoffPhase          connectionStatusHandoffPhase
	reason                string
	errorCode             string
	allowTerminalRecovery bool
}

func connectionStatusIsTerminal(status events.ConnectionStatusType) bool {
	switch status {
	case events.ConnectionStatusLoggedOut,
		events.ConnectionStatusInvalidSession,
		events.ConnectionStatusLeaseLost,
		events.ConnectionStatusStopped,
		events.ConnectionStatusError:
		return true
	default:
		return false
	}
}

func boolPointer(value bool) *bool {
	copy := value
	return &copy
}

func cloneConnectionStatus(status events.ConnectionStatus) events.ConnectionStatus {
	if status.SessionValid != nil {
		status.SessionValid = boolPointer(*status.SessionValid)
	}
	return status
}

func (cli *Client) detachedConnectionStatusEvent(rawEvent any) any {
	status, ok := rawEvent.(*events.ConnectionStatus)
	if !ok || status == nil {
		return rawEvent
	}
	detached := cloneConnectionStatus(*status)
	return &detached
}

func (cli *Client) dispatchConnectionStatusEvent(rawEvent any) (handlerFailed bool) {
	cli.eventHandlersLock.RLock()
	defer cli.eventHandlersLock.RUnlock()
	for _, handler := range cli.eventHandlers {
		failed, panicked := cli.callConnectionStatusHandler(handler, rawEvent)
		if panicked {
			continue
		}
		if failed {
			return true
		}
	}
	return false
}

func (cli *Client) callConnectionStatusHandler(handler wrappedEventHandler, rawEvent any) (failed, panicked bool) {
	defer func() {
		if recovered := recover(); recovered != nil {
			panicked = true
			cli.Log.Errorf("Event handler panicked while handling a %T: %v", rawEvent, recovered)
		}
	}()
	return !handler.fn(cli.detachedConnectionStatusEvent(rawEvent)), false
}

func connectionStatusSessionValidEqual(left, right *bool) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return *left == *right
}

func connectionStatusSemanticallyEqual(left, right events.ConnectionStatus) bool {
	return left.Provider == right.Provider &&
		left.Status == right.Status &&
		left.Connected == right.Connected &&
		left.Authenticated == right.Authenticated &&
		connectionStatusSessionValidEqual(left.SessionValid, right.SessionValid) &&
		left.Recoverable == right.Recoverable &&
		left.QRAvailable == right.QRAvailable &&
		left.Reason == right.Reason &&
		left.ErrorCode == right.ErrorCode
}

func connectionStatusFenceEqual(left, right store.ConnectionStatusFence) bool {
	return left.Required == right.Required &&
		left.OwnerID == right.OwnerID &&
		left.FencingToken == right.FencingToken &&
		left.Generation == right.Generation &&
		left.Epoch == right.Epoch
}

func sanitizeConnectionStatusIdentifier(value, fallback string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	var result strings.Builder
	result.Grow(min(len(value), 64))
	for _, character := range value {
		if result.Len() >= 64 {
			break
		}
		switch {
		case character >= 'a' && character <= 'z':
			result.WriteRune(character)
		case character >= 'A' && character <= 'Z':
			result.WriteRune(unicode.ToLower(character))
		case character >= '0' && character <= '9', character == '_', character == '-', character == '.', character == ':':
			result.WriteRune(character)
		default:
			result.WriteByte('_')
		}
	}
	resultValue := strings.Trim(result.String(), "_")
	if resultValue == "" {
		return fallback
	}
	return resultValue
}

func sanitizeExternalConnectionErrorCode(value string) string {
	normalized := sanitizeConnectionStatusIdentifier(value, "connection_error")
	switch normalized {
	case "connection_error",
		"auto_reconnect_stopped",
		"connect_failed",
		"client_outdated",
		"cat_refresh_failed",
		"handoff_failed",
		"invalid_session",
		"lease_lost",
		"pair_failed",
		"session_restore_failed",
		"session_validation_failed",
		"transport_not_ready":
		return normalized
	default:
		// Public callers may accidentally pass err.Error(), a URL or a
		// credential. Unknown values are discarded instead of being reflected
		// into an event that is commonly logged by applications.
		return "connection_error"
	}
}

func (cli *Client) initializeConnectionStatus() {
	validity := connectionValidityUnknown
	status := events.ConnectionStatusInitializing
	if cli.Store != nil {
		switch {
		case cli.Store.Deleted:
			validity = connectionValidityInvalid
			status = events.ConnectionStatusInvalidSession
		case cli.Store.ID != nil:
			validity = connectionValidityValid
		}
	}
	initial := buildConnectionStatus(events.ConnectionStatus{}, connectionStatusTransition{
		status:    status,
		validity:  validity,
		connected: connectionConnectedFalse,
	})
	initial.Sequence = 1
	initial.ChangedAt = time.Now().UTC()
	// A handler cannot be registered before NewClient returns. Store the initial
	// snapshot without queueing an event that would otherwise be delivered (or
	// dropped) nondeterministically depending on goroutine scheduling.
	cli.connectionStatus = cloneConnectionStatus(initial)
}

func connectionStatusValidity(current *bool, update connectionValidityUpdate) *bool {
	switch update {
	case connectionValidityUnknown:
		return nil
	case connectionValidityValid:
		return boolPointer(true)
	case connectionValidityInvalid:
		return boolPointer(false)
	default:
		if current == nil {
			return nil
		}
		return boolPointer(*current)
	}
}

func buildConnectionStatus(current events.ConnectionStatus, transition connectionStatusTransition) events.ConnectionStatus {
	next := events.ConnectionStatus{
		Provider:     connectionStatusProvider,
		Status:       transition.status,
		SessionValid: connectionStatusValidity(current.SessionValid, transition.validity),
		Reason:       sanitizeConnectionStatusIdentifier(transition.reason, ""),
		ErrorCode:    sanitizeConnectionStatusIdentifier(transition.errorCode, ""),
	}
	validSession := next.SessionValid != nil && *next.SessionValid
	next.Authenticated = validSession

	switch transition.status {
	case events.ConnectionStatusInitializing,
		events.ConnectionStatusRestoring,
		events.ConnectionStatusConnecting,
		events.ConnectionStatusReconnecting,
		events.ConnectionStatusOffline,
		events.ConnectionStatusConflict,
		events.ConnectionStatusLeaseLost,
		events.ConnectionStatusHandoff:
		next.Recoverable = true
	case events.ConnectionStatusQR:
		next.SessionValid = nil
		next.Authenticated = false
		next.QRAvailable = true
		next.Recoverable = true
	case events.ConnectionStatusOnline:
		next.Connected = true
		next.Authenticated = true
		next.SessionValid = boolPointer(true)
	case events.ConnectionStatusLoggedOut, events.ConnectionStatusInvalidSession:
		next.SessionValid = boolPointer(false)
		next.Authenticated = false
	}

	switch transition.connected {
	case connectionConnectedFalse:
		next.Connected = false
	case connectionConnectedTrue:
		next.Connected = true
	}
	if next.Connected && validSession {
		next.Authenticated = true
	}
	return next
}

func (cli *Client) setConnectionStatus(transition connectionStatusTransition) events.ConnectionStatus {
	if cli == nil {
		return events.ConnectionStatus{
			Provider:  connectionStatusProvider,
			Status:    events.ConnectionStatusStopped,
			ChangedAt: time.Time{},
		}
	}
	cli.connectionStatusMu.Lock()
	current := cli.connectionStatus
	currentFence := cli.connectionStatusFence
	currentHandoffPhase := cli.connectionStatusHandoff
	if connectionStatusIsTerminal(current.Status) &&
		current.Status != transition.status &&
		!transition.allowTerminalRecovery {
		result := cloneConnectionStatus(current)
		cli.connectionStatusMu.Unlock()
		return result
	}
	next := buildConnectionStatus(current, transition)
	nextHandoffPhase := currentHandoffPhase
	if transition.handoffPhase != connectionStatusHandoffNone {
		nextHandoffPhase = transition.handoffPhase
	} else if transition.status != events.ConnectionStatusHandoff &&
		transition.status != events.ConnectionStatusLeaseLost {
		nextHandoffPhase = connectionStatusHandoffNone
	}
	nextFence := store.ConnectionStatusFence{}
	if transition.status == events.ConnectionStatusOnline && transition.fence != nil {
		nextFence = *transition.fence
	} else if transition.status == events.ConnectionStatusHandoff && transition.fence != nil {
		nextFence = *transition.fence
	} else if transition.status == events.ConnectionStatusHandoff ||
		(transition.status == events.ConnectionStatusLeaseLost && nextHandoffPhase != connectionStatusHandoffNone) {
		nextFence = currentFence
	}
	if connectionStatusSemanticallyEqual(current, next) &&
		connectionStatusFenceEqual(currentFence, nextFence) &&
		currentHandoffPhase == nextHandoffPhase {
		result := cloneConnectionStatus(current)
		cli.connectionStatusMu.Unlock()
		return result
	}
	next.Sequence = current.Sequence + 1
	next.ChangedAt = time.Now().UTC()
	if !current.ChangedAt.IsZero() && !next.ChangedAt.After(current.ChangedAt) {
		next.ChangedAt = current.ChangedAt.Add(time.Nanosecond)
	}
	cli.connectionStatus = cloneConnectionStatus(next)
	cli.connectionStatusFence = nextFence
	cli.connectionStatusHandoff = nextHandoffPhase
	cli.connectionStatusPending = append(cli.connectionStatusPending, cloneConnectionStatus(next))
	startDispatcher := !cli.connectionStatusDispatching
	if startDispatcher {
		cli.connectionStatusDispatching = true
	}
	result := cloneConnectionStatus(next)
	cli.connectionStatusMu.Unlock()
	if startDispatcher {
		go cli.dispatchPendingConnectionStatuses()
	}
	return result
}

func (cli *Client) dispatchPendingConnectionStatuses() {
	for {
		cli.connectionStatusMu.Lock()
		if len(cli.connectionStatusPending) == 0 {
			cli.connectionStatusDispatching = false
			cli.connectionStatusMu.Unlock()
			return
		}
		status := cloneConnectionStatus(cli.connectionStatusPending[0])
		cli.connectionStatusPending[0] = events.ConnectionStatus{}
		cli.connectionStatusPending = cli.connectionStatusPending[1:]
		cli.connectionStatusMu.Unlock()
		if status.Status == events.ConnectionStatusOnline {
			// Status delivery is asynchronous to avoid re-entrant handler
			// deadlocks. Revalidate the one state that grants availability so a
			// queued ONLINE event cannot outlive its socket or fencing lease.
			current := cli.GetConnectionStatus()
			if current.Status != events.ConnectionStatusOnline || current.Sequence != status.Sequence {
				continue
			}
		}
		cli.dispatchEvent(&status)
	}
}

// GetConnectionStatus returns a detached, race-free snapshot of the current
// connection lifecycle. It only reads in-memory state and never performs a
// database or network call.
func (cli *Client) GetConnectionStatus() events.ConnectionStatus {
	if cli == nil {
		return events.ConnectionStatus{
			Provider: connectionStatusProvider,
			Status:   events.ConnectionStatusStopped,
		}
	}
	status, fence, handoffPhase := cli.getConnectionStatusSnapshot()
	if status.Status == events.ConnectionStatusHandoff && handoffPhase == connectionStatusHandoffSourceClosed {
		if cli.IsConnected() || cli.IsLoggedIn() {
			cli.MarkConnectionLeaseLost()
			status, fence, handoffPhase = cli.getConnectionStatusSnapshot()
		}
	}
	if status.Status != events.ConnectionStatusOnline &&
		connectionStatusRequiresActiveLease(status.Status, handoffPhase) {
		currentFence, err := cli.currentConnectionStatusFence()
		invalidFence := currentFence.Required && (err != nil || !validRequiredConnectionStatusFence(currentFence))
		if !invalidFence && status.Status == events.ConnectionStatusHandoff &&
			handoffPhase == connectionStatusHandoffDraining {
			invalidFence = err != nil || !connectionStatusFenceEqual(fence, currentFence)
		}
		if invalidFence {
			cli.MarkConnectionLeaseLost()
			status, fence, handoffPhase = cli.getConnectionStatusSnapshot()
		}
	}
	if status.Status == events.ConnectionStatusOnline {
		if failure := cli.validateOnlineConnectionStatus(status, fence); failure != onlineStatusValid {
			cli.downgradeInvalidOnlineStatus(failure)
			status, _, _ = cli.getConnectionStatusSnapshot()
		}
	} else if status.Connected {
		switch {
		case !cli.paired.Load() || status.SessionValid == nil || !*status.SessionValid:
			cli.MarkConnectionInvalidSession()
		case !cli.connectionStatusFenceIsCurrent(fence):
			cli.MarkConnectionLeaseLost()
		case !cli.IsConnected() || !cli.IsLoggedIn():
			cli.setConnectionStatus(connectionStatusTransition{
				status:    status.Status,
				validity:  connectionValidityPreserve,
				connected: connectionConnectedFalse,
				reason:    status.Reason,
				errorCode: status.ErrorCode,
			})
		}
		status, _, _ = cli.getConnectionStatusSnapshot()
	}
	return status
}

func connectionStatusRequiresActiveLease(status events.ConnectionStatusType, handoffPhase connectionStatusHandoffPhase) bool {
	switch status {
	case events.ConnectionStatusInitializing,
		events.ConnectionStatusRestoring,
		events.ConnectionStatusConnecting,
		events.ConnectionStatusQR,
		events.ConnectionStatusReconnecting,
		events.ConnectionStatusOffline:
		return true
	case events.ConnectionStatusHandoff:
		return handoffPhase != connectionStatusHandoffSourceClosed
	default:
		return false
	}
}

func (cli *Client) getConnectionStatusSnapshot() (events.ConnectionStatus, store.ConnectionStatusFence, connectionStatusHandoffPhase) {
	cli.connectionStatusMu.Lock()
	status := cloneConnectionStatus(cli.connectionStatus)
	fence := cli.connectionStatusFence
	handoffPhase := cli.connectionStatusHandoff
	cli.connectionStatusMu.Unlock()
	return status, fence, handoffPhase
}

type onlineStatusValidation uint8

const (
	onlineStatusValid onlineStatusValidation = iota
	onlineStatusTransportUnavailable
	onlineStatusInvalidSession
	onlineStatusFenceLost
)

func validRequiredConnectionStatusFence(fence store.ConnectionStatusFence) bool {
	if !fence.Required {
		return true
	}
	return fence.OwnerID != "" && fence.FencingToken > 0 && fence.Generation > 0 && fence.Epoch != ""
}

func (cli *Client) currentConnectionStatusFence() (store.ConnectionStatusFence, error) {
	if cli == nil || cli.Store == nil || cli.Store.Container == nil {
		return store.ConnectionStatusFence{Required: false}, nil
	}
	provider, ok := cli.Store.Container.(store.ConnectionStatusFenceProvider)
	if !ok {
		return store.ConnectionStatusFence{Required: false}, nil
	}
	return provider.CurrentConnectionStatusFence(cli.Store.SessionID, cli.Store.RevisionID)
}

func (cli *Client) validateOnlineConnectionStatus(status events.ConnectionStatus, activeFence store.ConnectionStatusFence) onlineStatusValidation {
	if !cli.paired.Load() || status.SessionValid == nil || !*status.SessionValid {
		return onlineStatusInvalidSession
	}
	if !cli.connectionStatusFenceIsCurrent(activeFence) {
		return onlineStatusFenceLost
	}
	if !cli.IsConnected() || !cli.IsLoggedIn() {
		return onlineStatusTransportUnavailable
	}
	return onlineStatusValid
}

func (cli *Client) connectionStatusFenceIsCurrent(activeFence store.ConnectionStatusFence) bool {
	currentFence, err := cli.currentConnectionStatusFence()
	return err == nil && validRequiredConnectionStatusFence(currentFence) && connectionStatusFenceEqual(activeFence, currentFence)
}

func (cli *Client) downgradeInvalidOnlineStatus(failure onlineStatusValidation) {
	switch failure {
	case onlineStatusInvalidSession:
		cli.MarkConnectionInvalidSession()
	case onlineStatusFenceLost:
		cli.MarkConnectionLeaseLost()
	case onlineStatusTransportUnavailable:
		status := events.ConnectionStatusOffline
		if cli.EnableAutoReconnect && cli.paired.Load() && !cli.isExpectedDisconnect() {
			status = events.ConnectionStatusReconnecting
		}
		cli.setConnectionStatus(connectionStatusTransition{
			status:    status,
			validity:  connectionValidityPreserve,
			connected: connectionConnectedFalse,
			reason:    "transport_not_ready",
			errorCode: "transport_not_ready",
		})
	}
}

func (cli *Client) markConnectionOnline() {
	cli.markConnectionOnlineFor(socketBinding{})
}

func (cli *Client) markConnectionOnlineFor(expected socketBinding) bool {
	current, _, _ := cli.getConnectionStatusSnapshot()
	switch current.Status {
	case events.ConnectionStatusLoggedOut,
		events.ConnectionStatusInvalidSession,
		events.ConnectionStatusConflict,
		events.ConnectionStatusLeaseLost,
		events.ConnectionStatusHandoff,
		events.ConnectionStatusStopped:
		// Connected may already be queued when a stronger lifecycle boundary
		// disconnects or fences the client. Such a stale event must never
		// resurrect a terminal client as online.
		return false
	}
	cli.socketLock.RLock()
	if expected.socket != nil && (cli.socket != expected.socket || cli.socketGeneration != expected.generation) {
		cli.socketLock.RUnlock()
		return false
	}
	transportReady := cli.socket != nil && cli.socket.IsConnected() && cli.isLoggedIn.Load()
	if !transportReady || !cli.paired.Load() {
		cli.socketLock.RUnlock()
		if !cli.paired.Load() {
			cli.MarkConnectionInvalidSession()
		} else {
			cli.downgradeInvalidOnlineStatus(onlineStatusTransportUnavailable)
		}
		return false
	}
	fence, err := cli.currentConnectionStatusFence()
	if err != nil || !validRequiredConnectionStatusFence(fence) {
		cli.socketLock.RUnlock()
		cli.MarkConnectionLeaseLost()
		return false
	}
	if !cli.connectionStatusFenceIsCurrent(fence) {
		cli.socketLock.RUnlock()
		cli.MarkConnectionLeaseLost()
		return false
	}
	cli.setConnectionStatus(connectionStatusTransition{
		status:    events.ConnectionStatusOnline,
		validity:  connectionValidityValid,
		connected: connectionConnectedTrue,
		fence:     &fence,
	})
	cli.socketLock.RUnlock()
	return true
}

// prepareConnectionStatusForExplicitConnect is called only by the public
// Connect/ConnectContext entrypoint while socketLock is held. This makes an
// intentional Disconnect -> Connect reusable without allowing an automatic
// reconnect or a late socket callback to recover a sticky terminal state.
func (cli *Client) prepareConnectionStatusForExplicitConnect() error {
	current, _, _ := cli.getConnectionStatusSnapshot()
	switch current.Status {
	case events.ConnectionStatusLoggedOut,
		events.ConnectionStatusInvalidSession,
		events.ConnectionStatusConflict,
		events.ConnectionStatusLeaseLost,
		events.ConnectionStatusHandoff,
		events.ConnectionStatusError:
		return errConnectionStatusTerminal
	case events.ConnectionStatusStopped:
		if cli.Store == nil || cli.Store.Deleted {
			cli.paired.Store(false)
			cli.setConnectionStatus(connectionStatusTransition{
				status:                events.ConnectionStatusInvalidSession,
				validity:              connectionValidityInvalid,
				connected:             connectionConnectedFalse,
				reason:                "invalid_session",
				errorCode:             "invalid_session",
				allowTerminalRecovery: true,
			})
			return store.ErrDeviceDeleted
		}
		fence, err := cli.currentConnectionStatusFence()
		if err != nil || !validRequiredConnectionStatusFence(fence) {
			cli.setConnectionStatus(connectionStatusTransition{
				status:                events.ConnectionStatusLeaseLost,
				validity:              connectionValidityPreserve,
				connected:             connectionConnectedFalse,
				reason:                "lease_lost",
				errorCode:             "lease_lost",
				allowTerminalRecovery: true,
			})
			return errConnectionStatusLeaseUnavailable
		}
		next := cli.setConnectionStatus(connectionStatusTransition{
			status:                events.ConnectionStatusConnecting,
			validity:              connectionValidityPreserve,
			connected:             connectionConnectedFalse,
			allowTerminalRecovery: true,
		})
		if next.Status != events.ConnectionStatusConnecting {
			return errConnectionStatusTerminal
		}
	}
	return nil
}

// MarkConnectionRestoring publishes the lifecycle boundary used while a
// provider projection is being restored before a network connection starts.
func (cli *Client) MarkConnectionRestoring() {
	cli.setConnectionStatus(connectionStatusTransition{
		status:    events.ConnectionStatusRestoring,
		validity:  connectionValidityPreserve,
		connected: connectionConnectedFalse,
	})
}

// MarkConnectionHandoff publishes the lifecycle boundary used while the
// current provider is draining for a transactional provider handoff. The
// provider becomes unavailable immediately even if its socket remains open
// briefly while in-flight operations drain.
func (cli *Client) MarkConnectionHandoff() {
	fence, err := cli.currentConnectionStatusFence()
	if err != nil || !validRequiredConnectionStatusFence(fence) {
		cli.MarkConnectionLeaseLost()
		return
	}
	cli.setConnectionStatus(connectionStatusTransition{
		status:       events.ConnectionStatusHandoff,
		validity:     connectionValidityPreserve,
		connected:    connectionConnectedFalse,
		fence:        &fence,
		handoffPhase: connectionStatusHandoffDraining,
	})
}

// MarkConnectionHandoffSourceClosed confirms the narrow lease-free handoff
// phase. Callers may invoke it only after provider operations are drained, the
// transport is closed and the exact fenced lease release has succeeded.
//
// A handoff that merely lost its lease remains lease_lost. This method can
// recover that status only when the client itself previously entered the
// draining phase, which covers an idempotent retry after an ambiguous release
// response without weakening terminal stickiness for other lifecycle events.
func (cli *Client) MarkConnectionHandoffSourceClosed() bool {
	if cli == nil {
		return false
	}
	cli.socketLock.RLock()
	defer cli.socketLock.RUnlock()
	if (cli.socket != nil && cli.socket.IsConnected()) || cli.isLoggedIn.Load() {
		return false
	}
	currentFence, fenceErr := cli.currentConnectionStatusFence()
	if !currentFence.Required || (fenceErr == nil && validRequiredConnectionStatusFence(currentFence)) {
		return false
	}
	current, _, handoffPhase := cli.getConnectionStatusSnapshot()
	if handoffPhase != connectionStatusHandoffDraining ||
		(current.Status != events.ConnectionStatusHandoff && current.Status != events.ConnectionStatusLeaseLost) {
		return false
	}
	next := cli.setConnectionStatus(connectionStatusTransition{
		status:                events.ConnectionStatusHandoff,
		validity:              connectionValidityPreserve,
		connected:             connectionConnectedFalse,
		handoffPhase:          connectionStatusHandoffSourceClosed,
		reason:                "handoff_source_closed",
		allowTerminalRecovery: true,
	})
	_, _, appliedPhase := cli.getConnectionStatusSnapshot()
	return next.Status == events.ConnectionStatusHandoff && appliedPhase == connectionStatusHandoffSourceClosed
}

// MarkConnectionLeaseAcquired starts a new fenced lifecycle after an explicit
// lease acquire/reacquire. It is the only generic path that clears a completed
// source-handoff exception, and it never recovers invalid credentials, logout,
// conflicts or provider errors.
func (cli *Client) MarkConnectionLeaseAcquired() bool {
	if cli == nil {
		return false
	}
	cli.socketLock.RLock()
	defer cli.socketLock.RUnlock()
	if (cli.socket != nil && cli.socket.IsConnected()) || cli.isLoggedIn.Load() {
		return false
	}
	fence, err := cli.currentConnectionStatusFence()
	if err != nil || !fence.Required || !validRequiredConnectionStatusFence(fence) {
		return false
	}
	current, _, _ := cli.getConnectionStatusSnapshot()
	switch current.Status {
	case events.ConnectionStatusLoggedOut,
		events.ConnectionStatusInvalidSession,
		events.ConnectionStatusConflict,
		events.ConnectionStatusError:
		return false
	}
	next := cli.setConnectionStatus(connectionStatusTransition{
		status:                events.ConnectionStatusRestoring,
		validity:              connectionValidityPreserve,
		connected:             connectionConnectedFalse,
		reason:                "lease_acquired",
		allowTerminalRecovery: true,
	})
	_, _, appliedPhase := cli.getConnectionStatusSnapshot()
	return next.Status == events.ConnectionStatusRestoring && appliedPhase == connectionStatusHandoffNone
}

// MarkConnectionLeaseLost immediately makes the client unavailable after its
// PostgreSQL fencing lease is lost. Callers must then close the socket; a
// subsequent Disconnect keeps the lease_lost terminal reason intact.
func (cli *Client) MarkConnectionLeaseLost() {
	cli.setConnectionStatus(connectionStatusTransition{
		status:    events.ConnectionStatusLeaseLost,
		validity:  connectionValidityPreserve,
		connected: connectionConnectedFalse,
		reason:    "lease_lost",
		errorCode: "lease_lost",
	})
}

// MarkConnectionStopped publishes an intentional, non-recovering stop.
func (cli *Client) MarkConnectionStopped() {
	cli.setConnectionStatus(connectionStatusTransition{
		status:    events.ConnectionStatusStopped,
		validity:  connectionValidityPreserve,
		connected: connectionConnectedFalse,
		reason:    "client_stopped",
	})
}

// MarkConnectionInvalidSession publishes a known invalid credential set.
func (cli *Client) MarkConnectionInvalidSession() {
	if cli != nil {
		cli.paired.Store(false)
	}
	cli.setConnectionStatus(connectionStatusTransition{
		status:    events.ConnectionStatusInvalidSession,
		validity:  connectionValidityInvalid,
		connected: connectionConnectedFalse,
		reason:    "invalid_session",
		errorCode: "invalid_session",
	})
}

// MarkConnectionError publishes a sanitized machine error code. Raw errors,
// URLs, credentials and user identifiers must never be passed to this method.
func (cli *Client) MarkConnectionError(errorCode string) {
	cli.setConnectionStatus(connectionStatusTransition{
		status:    events.ConnectionStatusError,
		validity:  connectionValidityPreserve,
		connected: connectionConnectedFalse,
		reason:    "connection_error",
		errorCode: sanitizeExternalConnectionErrorCode(errorCode),
	})
}

func (cli *Client) markConnectionDisconnectedByCaller() {
	current := cli.GetConnectionStatus()
	switch current.Status {
	case events.ConnectionStatusHandoff,
		events.ConnectionStatusLeaseLost,
		events.ConnectionStatusLoggedOut,
		events.ConnectionStatusInvalidSession,
		events.ConnectionStatusConflict:
		cli.setConnectionStatus(connectionStatusTransition{
			status:    current.Status,
			validity:  connectionValidityPreserve,
			connected: connectionConnectedFalse,
			reason:    current.Reason,
			errorCode: current.ErrorCode,
		})
	default:
		cli.MarkConnectionStopped()
	}
}

func (cli *Client) setConnectionStatusForConnectError(err error) {
	if fence, fenceErr := cli.currentConnectionStatusFence(); fence.Required &&
		(fenceErr != nil || !validRequiredConnectionStatusFence(fence)) {
		cli.MarkConnectionLeaseLost()
		return
	}
	switch {
	case errors.Is(err, store.ErrDeviceDeleted), errors.Is(err, store.ErrInvalidWhatsAppTransportRoutingInfo):
		cli.MarkConnectionInvalidSession()
	case errors.Is(err, context.Canceled), errors.Is(err, context.DeadlineExceeded):
		cli.MarkConnectionStopped()
	case isRetryableConnectError(err):
		cli.setConnectionStatus(connectionStatusTransition{
			status:    events.ConnectionStatusOffline,
			validity:  connectionValidityPreserve,
			connected: connectionConnectedFalse,
			reason:    "connect_retryable",
			errorCode: "connect_retryable",
		})
	default:
		cli.MarkConnectionError("connect_failed")
	}
}

func (cli *Client) observeConnectionEvent(rawEvent any) {
	if cli == nil {
		return
	}
	if _, ok := rawEvent.(*events.ConnectionStatus); ok {
		return
	}
	current, _, _ := cli.getConnectionStatusSnapshot()
	if _, isQR := rawEvent.(*events.QR); isQR &&
		(current.Status == events.ConnectionStatusHandoff ||
			current.SessionValid != nil || cli.paired.Load()) {
		// QR is valid only for a genuinely empty pairing lifecycle. A QR from a
		// registered/restoring/handoff client means canonical state and the live
		// protocol disagree, so fail closed without exposing the QR payload.
		cli.MarkConnectionInvalidSession()
		return
	}
	switch current.Status {
	case events.ConnectionStatusLoggedOut,
		events.ConnectionStatusInvalidSession,
		events.ConnectionStatusLeaseLost,
		events.ConnectionStatusHandoff,
		events.ConnectionStatusStopped,
		events.ConnectionStatusError:
		if _, disconnected := rawEvent.(*events.Disconnected); disconnected &&
			current.Status == events.ConnectionStatusHandoff && current.Connected {
			cli.setConnectionStatus(connectionStatusTransition{
				status:    current.Status,
				validity:  connectionValidityPreserve,
				connected: connectionConnectedFalse,
				reason:    current.Reason,
				errorCode: current.ErrorCode,
			})
		}
		return
	case events.ConnectionStatusConflict:
		if _, loggedOut := rawEvent.(*events.LoggedOut); !loggedOut {
			return
		}
	}
	switch event := rawEvent.(type) {
	case *events.QR:
		cli.setConnectionStatus(connectionStatusTransition{
			status:    events.ConnectionStatusQR,
			validity:  connectionValidityUnknown,
			connected: connectionConnectedFalse,
		})
	case *events.PairSuccess:
		cli.paired.Store(true)
		cli.setConnectionStatus(connectionStatusTransition{
			status:    events.ConnectionStatusConnecting,
			validity:  connectionValidityValid,
			connected: connectionConnectedFalse,
		})
	case *events.PairError:
		cli.setConnectionStatus(connectionStatusTransition{
			status:    events.ConnectionStatusError,
			validity:  connectionValidityInvalid,
			connected: connectionConnectedFalse,
			reason:    "pair_failed",
			errorCode: "pair_failed",
		})
	case *events.Connected:
		cli.markConnectionOnline()
	case *events.Disconnected:
		status := events.ConnectionStatusOffline
		if cli.EnableAutoReconnect && cli.paired.Load() && !cli.isExpectedDisconnect() {
			status = events.ConnectionStatusReconnecting
		}
		cli.setConnectionStatus(connectionStatusTransition{
			status:    status,
			validity:  connectionValidityPreserve,
			connected: connectionConnectedFalse,
			reason:    "remote_disconnect",
		})
	case *events.LoggedOut:
		cli.paired.Store(false)
		cli.setConnectionStatus(connectionStatusTransition{
			status:    events.ConnectionStatusLoggedOut,
			validity:  connectionValidityInvalid,
			connected: connectionConnectedFalse,
			reason:    "remote_logout",
			errorCode: "connect_failure_" + event.Reason.NumberString(),
		})
	case *events.StreamReplaced:
		cli.setConnectionStatus(connectionStatusTransition{
			status:    events.ConnectionStatusConflict,
			validity:  connectionValidityPreserve,
			connected: connectionConnectedFalse,
			reason:    "stream_replaced",
			errorCode: "stream_replaced",
		})
	case *events.ManualLoginReconnect:
		cli.setConnectionStatus(connectionStatusTransition{
			status:    events.ConnectionStatusOffline,
			validity:  connectionValidityPreserve,
			connected: connectionConnectedFalse,
			reason:    "manual_reconnect_required",
		})
	case *events.ClientOutdated:
		cli.MarkConnectionError("client_outdated")
	case *events.CATRefreshError:
		cli.MarkConnectionError("cat_refresh_failed")
	case *events.TemporaryBan:
		cli.setConnectionStatus(connectionStatusTransition{
			status:    events.ConnectionStatusOffline,
			validity:  connectionValidityPreserve,
			connected: connectionConnectedFalse,
			reason:    "temporary_ban",
			errorCode: "connect_failure_402",
		})
	case *events.ConnectFailure:
		cli.MarkConnectionError("connect_failure_" + event.Reason.NumberString())
	case *events.StreamError:
		cli.MarkConnectionError("stream_error_" + sanitizeConnectionStatusIdentifier(event.Code, "unknown"))
	}
}
