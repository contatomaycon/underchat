// Copyright (c) 2026 Underchat
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

package whatsmeow

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	waLog "go.mau.fi/whatsmeow/util/log"
)

type recordingSessionDebugLogger struct {
	events []string
}

func (logger *recordingSessionDebugLogger) Debugf(string, ...any) {}
func (logger *recordingSessionDebugLogger) Infof(string, ...any)  {}
func (logger *recordingSessionDebugLogger) Warnf(string, ...any)  {}
func (logger *recordingSessionDebugLogger) Errorf(string, ...any) {}
func (logger *recordingSessionDebugLogger) Sub(string) waLog.Logger {
	return logger
}
func (logger *recordingSessionDebugLogger) SessionDebug(event string, _ map[string]any) {
	logger.events = append(logger.events, event)
}

func newConnectionStatusTestClient(registered bool) *Client {
	device := &store.Device{}
	if registered {
		jid := types.NewJID("15550000000", types.DefaultUserServer)
		device.ID = &jid
	}
	return NewClient(device, nil)
}

func waitForConnectionStatus(t *testing.T, statuses <-chan events.ConnectionStatus) events.ConnectionStatus {
	t.Helper()
	select {
	case status := <-statuses:
		return status
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for connection status event")
		return events.ConnectionStatus{}
	}
}

func TestGetConnectionStatusReturnsDetachedSnapshot(t *testing.T) {
	client := newConnectionStatusTestClient(true)
	status := client.GetConnectionStatus()
	if status.Provider != connectionStatusProvider || status.Status != events.ConnectionStatusInitializing {
		t.Fatalf("unexpected initial status: %+v", status)
	}
	if !status.Authenticated || status.SessionValid == nil || !*status.SessionValid {
		t.Fatalf("registered credentials were not reflected in initial snapshot: %+v", status)
	}
	if status.Connected || !status.Recoverable || status.QRAvailable || status.Sequence != 1 || status.ChangedAt.IsZero() {
		t.Fatalf("initial snapshot invariants are invalid: %+v", status)
	}

	*status.SessionValid = false
	second := client.GetConnectionStatus()
	if second.SessionValid == nil || !*second.SessionValid {
		t.Fatal("mutating a returned snapshot changed the client's internal status")
	}

	nilClient := (*Client)(nil).GetConnectionStatus()
	if nilClient.Provider != connectionStatusProvider || nilClient.Status != events.ConnectionStatusStopped {
		t.Fatalf("nil client status is not safe: %+v", nilClient)
	}
}

func TestConnectionStatusUsesNativeEventHandlersAndDeduplicates(t *testing.T) {
	client := newConnectionStatusTestClient(false)
	statuses := make(chan events.ConnectionStatus, 16)
	client.AddEventHandler(func(rawEvent any) {
		if status, ok := rawEvent.(*events.ConnectionStatus); ok {
			statuses <- cloneConnectionStatus(*status)
			if status.SessionValid != nil {
				*status.SessionValid = false
			}
		}
	})

	client.MarkConnectionRestoring()
	restoring := waitForConnectionStatus(t, statuses)
	if restoring.Status != events.ConnectionStatusRestoring || restoring.Sequence != 2 || !restoring.Recoverable {
		t.Fatalf("unexpected restoring status: %+v", restoring)
	}
	client.MarkConnectionRestoring()
	select {
	case duplicate := <-statuses:
		t.Fatalf("equivalent transition emitted duplicate event: %+v", duplicate)
	case <-time.After(30 * time.Millisecond):
	}
	if client.GetConnectionStatus().Sequence != restoring.Sequence {
		t.Fatal("equivalent transition incremented the sequence")
	}

	client.dispatchEvent(&events.QR{Codes: []string{"sensitive-qr-payload"}})
	qr := waitForConnectionStatus(t, statuses)
	if qr.Status != events.ConnectionStatusQR || qr.Connected || qr.Authenticated || qr.SessionValid != nil || !qr.QRAvailable {
		t.Fatalf("unexpected QR status: %+v", qr)
	}
	if qr.Reason != "" || qr.ErrorCode != "" {
		t.Fatalf("QR status leaked event data: %+v", qr)
	}

	client.dispatchEvent(&events.PairSuccess{})
	connecting := waitForConnectionStatus(t, statuses)
	if connecting.Status != events.ConnectionStatusConnecting || connecting.SessionValid == nil || !*connecting.SessionValid || !connecting.Authenticated {
		t.Fatalf("unexpected post-pair status: %+v", connecting)
	}

	client.dispatchEvent(&events.Connected{})
	notReady := waitForConnectionStatus(t, statuses)
	if notReady.Status == events.ConnectionStatusOnline || notReady.Connected || notReady.ErrorCode != "transport_not_ready" {
		t.Fatalf("connected event produced a false-positive online state without a live transport: %+v", notReady)
	}

	client.paired.Store(true)
	client.dispatchEvent(&events.Disconnected{})
	reconnecting := waitForConnectionStatus(t, statuses)
	if reconnecting.Status != events.ConnectionStatusReconnecting || reconnecting.Connected || !reconnecting.Recoverable {
		t.Fatalf("unexpected reconnecting status: %+v", reconnecting)
	}

	client.dispatchEvent(&events.StreamReplaced{})
	conflict := waitForConnectionStatus(t, statuses)
	if conflict.Status != events.ConnectionStatusConflict || conflict.ErrorCode != "stream_replaced" || !conflict.Recoverable {
		t.Fatalf("unexpected conflict status: %+v", conflict)
	}

	client.dispatchEvent(&events.LoggedOut{Reason: events.ConnectFailureLoggedOut})
	loggedOut := waitForConnectionStatus(t, statuses)
	if loggedOut.Status != events.ConnectionStatusLoggedOut || loggedOut.SessionValid == nil || *loggedOut.SessionValid || loggedOut.Authenticated || loggedOut.Recoverable {
		t.Fatalf("unexpected logged-out status: %+v", loggedOut)
	}
}

func TestConnectionStatusEventIsDetachedForEveryHandler(t *testing.T) {
	client := newConnectionStatusTestClient(true)
	client.AddEventHandler(func(rawEvent any) {
		if status, ok := rawEvent.(*events.ConnectionStatus); ok && status.SessionValid != nil {
			*status.SessionValid = false
			status.Reason = "mutated_by_first_handler"
		}
	})
	secondHandlerStatuses := make(chan events.ConnectionStatus, 1)
	client.AddEventHandler(func(rawEvent any) {
		if status, ok := rawEvent.(*events.ConnectionStatus); ok {
			secondHandlerStatuses <- cloneConnectionStatus(*status)
		}
	})

	client.MarkConnectionRestoring()
	second := waitForConnectionStatus(t, secondHandlerStatuses)
	if second.SessionValid == nil || !*second.SessionValid || second.Reason != "" {
		t.Fatalf("one event handler mutated another handler's snapshot: %+v", second)
	}
	current := client.GetConnectionStatus()
	if current.SessionValid == nil || !*current.SessionValid || current.Reason != "" {
		t.Fatalf("an event handler mutated the internal snapshot: %+v", current)
	}
}

func TestConnectionStatusObserverPanicDoesNotBlockOtherHandlers(t *testing.T) {
	client := newConnectionStatusTestClient(true)
	client.AddEventHandler(func(rawEvent any) {
		if _, ok := rawEvent.(*events.ConnectionStatus); ok {
			panic("consumer failure")
		}
	})
	observed := make(chan events.ConnectionStatus, 1)
	client.AddEventHandler(func(rawEvent any) {
		if status, ok := rawEvent.(*events.ConnectionStatus); ok {
			observed <- cloneConnectionStatus(*status)
		}
	})

	client.MarkConnectionRestoring()
	status := waitForConnectionStatus(t, observed)
	if status.Status != events.ConnectionStatusRestoring {
		t.Fatalf("healthy handler did not receive status after observer panic: %+v", status)
	}
}

func TestGetConnectionStatusDowngradesStaleCachedOnline(t *testing.T) {
	client := newConnectionStatusTestClient(true)
	client.isLoggedIn.Store(true)
	client.setConnectionStatus(connectionStatusTransition{
		status:    events.ConnectionStatusOnline,
		validity:  connectionValidityValid,
		connected: connectionConnectedTrue,
	})
	status := client.GetConnectionStatus()
	if status.Status == events.ConnectionStatusOnline || status.Connected {
		t.Fatalf("stale cached state remained online without a live socket: %+v", status)
	}
	if status.Status != events.ConnectionStatusReconnecting || status.ErrorCode != "transport_not_ready" {
		t.Fatalf("stale online state was not conservatively downgraded: %+v", status)
	}
}

type connectionStatusFenceTestContainer struct {
	fence store.ConnectionStatusFence
	err   error
}

func (*connectionStatusFenceTestContainer) PutDevice(_ context.Context, _ *store.Device) error {
	return nil
}

func (*connectionStatusFenceTestContainer) DeleteDevice(_ context.Context, _ *store.Device) error {
	return nil
}

func (container *connectionStatusFenceTestContainer) CurrentConnectionStatusFence(_ string, _ int64) (store.ConnectionStatusFence, error) {
	return container.fence, container.err
}

type explicitConnectStatusTestContainer struct {
	connectionStatusFenceTestContainer
	reserveCalled bool
	reserveErr    error
}

func (container *explicitConnectStatusTestContainer) ReserveCompanionIdentity(context.Context, *store.Device) error {
	container.reserveCalled = true
	return container.reserveErr
}

func TestConnectionStatusFenceRejectsTakeoverGenerationAndLoss(t *testing.T) {
	active := store.ConnectionStatusFence{
		Required: true, OwnerID: "owner-a", FencingToken: 41, Generation: 7,
		Epoch: "019fce0d-1d24-7000-8000-000000000001",
	}
	container := &connectionStatusFenceTestContainer{fence: active}
	jid := types.NewJID("15550000000", types.DefaultUserServer)
	client := NewClient(&store.Device{
		ID: &jid, SessionID: "019fce0d-1d24-7000-8000-000000000002", RevisionID: 11,
		Container: container,
	}, nil)
	if !client.connectionStatusFenceIsCurrent(active) {
		t.Fatal("current exact fencing generation was rejected")
	}

	container.fence.Generation++
	container.fence.FencingToken++
	if client.connectionStatusFenceIsCurrent(active) {
		t.Fatal("a takeover generation kept the previous transport online")
	}
	client.setConnectionStatus(connectionStatusTransition{
		status:    events.ConnectionStatusOnline,
		validity:  connectionValidityValid,
		connected: connectionConnectedTrue,
		fence:     &active,
	})
	takeoverStatus := client.GetConnectionStatus()
	if takeoverStatus.Status != events.ConnectionStatusLeaseLost || takeoverStatus.Connected {
		t.Fatalf("GetConnectionStatus did not synchronously reject a takeover generation: %+v", takeoverStatus)
	}
	takeoverSequence := takeoverStatus.Sequence
	client.dispatchEvent(&events.Connected{})
	afterStaleConnected := client.GetConnectionStatus()
	if afterStaleConnected.Status != events.ConnectionStatusLeaseLost || afterStaleConnected.Sequence != takeoverSequence {
		t.Fatalf("stale Connected event resurrected a lease-lost client: %+v", afterStaleConnected)
	}
	client.dispatchEvent(&events.Disconnected{})
	afterStaleDisconnected := client.GetConnectionStatus()
	if afterStaleDisconnected.Status != events.ConnectionStatusLeaseLost || afterStaleDisconnected.Sequence != takeoverSequence {
		t.Fatalf("stale Disconnected event overwrote lease loss: %+v", afterStaleDisconnected)
	}

	container.fence = active
	container.err = errors.New("lease expired")
	if client.connectionStatusFenceIsCurrent(active) {
		t.Fatal("lease provider failure kept the transport online")
	}
	client.setConnectionStatus(connectionStatusTransition{
		status:    events.ConnectionStatusOnline,
		validity:  connectionValidityValid,
		connected: connectionConnectedTrue,
		fence:     &active,
	})
	expiredStatus := client.GetConnectionStatus()
	if expiredStatus.Status != events.ConnectionStatusLeaseLost || expiredStatus.Connected {
		t.Fatalf("GetConnectionStatus did not synchronously reject an expired lease: %+v", expiredStatus)
	}
}

func TestConnectionStatusHandoffRequiresLeaseUntilConfirmedSourceClose(t *testing.T) {
	active := store.ConnectionStatusFence{
		Required: true, OwnerID: "owner-a", FencingToken: 51, Generation: 8,
		Epoch: "019fce0d-1d24-7000-8000-000000000003",
	}
	newClient := func(container *connectionStatusFenceTestContainer) *Client {
		jid := types.NewJID("15550000001", types.DefaultUserServer)
		return NewClient(&store.Device{
			ID: &jid, SessionID: "019fce0d-1d24-7000-8000-000000000004", RevisionID: 12,
			Container: container,
		}, nil)
	}

	t.Run("unexpected loss remains terminal", func(t *testing.T) {
		container := &connectionStatusFenceTestContainer{fence: active}
		client := newClient(container)
		client.MarkConnectionHandoff()
		handoff := client.GetConnectionStatus()
		if handoff.Status != events.ConnectionStatusHandoff || handoff.Connected {
			t.Fatalf("fenced handoff was not preserved while draining: %+v", handoff)
		}
		_, storedFence, phase := client.getConnectionStatusSnapshot()
		if phase != connectionStatusHandoffDraining || !connectionStatusFenceEqual(storedFence, active) {
			t.Fatalf("draining handoff did not retain its exact fence: phase=%d fence=%+v", phase, storedFence)
		}

		container.fence.FencingToken++
		container.fence.Generation++
		lost := client.GetConnectionStatus()
		if lost.Status != events.ConnectionStatusLeaseLost || lost.Connected {
			t.Fatalf("unexpected handoff takeover was not failed closed: %+v", lost)
		}
		client.MarkConnectionRestoring()
		if afterLateCallback := client.GetConnectionStatus(); afterLateCallback.Status != events.ConnectionStatusLeaseLost || afterLateCallback.Sequence != lost.Sequence {
			t.Fatalf("late lifecycle callback recovered unexpected lease loss: %+v", afterLateCallback)
		}
	})

	t.Run("confirmed release remains handoff and new acquire clears exception", func(t *testing.T) {
		container := &connectionStatusFenceTestContainer{fence: active}
		client := newClient(container)
		statuses := make(chan events.ConnectionStatus, 8)
		client.AddEventHandler(func(rawEvent any) {
			if status, ok := rawEvent.(*events.ConnectionStatus); ok {
				statuses <- cloneConnectionStatus(*status)
			}
		})

		client.MarkConnectionHandoff()
		if event := waitForConnectionStatus(t, statuses); event.Status != events.ConnectionStatusHandoff {
			t.Fatalf("missing draining handoff event: %+v", event)
		}
		client.Disconnect()
		container.err = errors.New("lease intentionally released")
		if !client.MarkConnectionHandoffSourceClosed() {
			t.Fatal("confirmed source close was rejected")
		}
		closedEvent := waitForConnectionStatus(t, statuses)
		if closedEvent.Status != events.ConnectionStatusHandoff || closedEvent.Reason != "handoff_source_closed" || closedEvent.Connected {
			t.Fatalf("source-close event is incoherent: %+v", closedEvent)
		}
		closed := client.GetConnectionStatus()
		if closed.Status != events.ConnectionStatusHandoff || closed.Reason != "handoff_source_closed" || closed.Connected {
			t.Fatalf("intentional lease release was misreported: %+v", closed)
		}
		_, _, phase := client.getConnectionStatusSnapshot()
		if phase != connectionStatusHandoffSourceClosed {
			t.Fatalf("source-close marker was not installed: %d", phase)
		}

		container.err = nil
		container.fence = store.ConnectionStatusFence{
			Required: true, OwnerID: "owner-b", FencingToken: 52, Generation: 9,
			Epoch: "019fce0d-1d24-7000-8000-000000000005",
		}
		if !client.MarkConnectionLeaseAcquired() {
			t.Fatal("new exact lease was not accepted")
		}
		restoredEvent := waitForConnectionStatus(t, statuses)
		if restoredEvent.Status != events.ConnectionStatusRestoring || restoredEvent.Connected {
			t.Fatalf("new lease did not start a fenced restoring lifecycle: %+v", restoredEvent)
		}
		_, _, phase = client.getConnectionStatusSnapshot()
		if phase != connectionStatusHandoffNone {
			t.Fatalf("new acquire retained the source-close exception: %d", phase)
		}

		container.err = errors.New("new lease lost")
		lost := client.GetConnectionStatus()
		if lost.Status != events.ConnectionStatusLeaseLost || lost.Connected {
			t.Fatalf("new lifecycle incorrectly remained lease-free: %+v", lost)
		}
	})
}

func TestExplicitConnectRecoversOnlyStoppedWithCurrentFence(t *testing.T) {
	active := store.ConnectionStatusFence{
		Required: true, OwnerID: "owner-explicit", FencingToken: 61, Generation: 11,
		Epoch: "019fce0d-1d24-7000-8000-000000000009",
	}
	connectRejected := errors.New("test connect stopped before network")
	container := &explicitConnectStatusTestContainer{
		connectionStatusFenceTestContainer: connectionStatusFenceTestContainer{fence: active},
		reserveErr:                         connectRejected,
	}
	jid := types.NewJID("15550000004", types.DefaultUserServer)
	client := NewClient(&store.Device{
		ID: &jid, SessionID: "019fce0d-1d24-7000-8000-000000000010", RevisionID: 14,
		Container: container,
	}, nil)
	statuses := make(chan events.ConnectionStatus, 4)
	client.AddEventHandler(func(rawEvent any) {
		if status, ok := rawEvent.(*events.ConnectionStatus); ok {
			statuses <- cloneConnectionStatus(*status)
		}
	})
	client.Disconnect()
	stopped := waitForConnectionStatus(t, statuses)
	if stopped.Status != events.ConnectionStatusStopped {
		t.Fatalf("explicit reconnect fixture did not stop: %+v", stopped)
	}

	err := client.ConnectContext(context.Background())
	if !errors.Is(err, connectRejected) || !container.reserveCalled {
		t.Fatalf("explicit Connect did not enter the normal pre-network path: called=%v err=%v", container.reserveCalled, err)
	}
	connecting := waitForConnectionStatus(t, statuses)
	if connecting.Status != events.ConnectionStatusConnecting || connecting.Sequence <= stopped.Sequence {
		t.Fatalf("explicit Connect did not recover stopped as connecting: %+v", connecting)
	}
	failed := waitForConnectionStatus(t, statuses)
	if failed.Status != events.ConnectionStatusError || failed.Connected {
		t.Fatalf("pre-network rejection did not fail closed: %+v", failed)
	}
	client.dispatchEvent(&events.Connected{})
	if afterLateConnected := client.GetConnectionStatus(); afterLateConnected.Status != events.ConnectionStatusError || afterLateConnected.Sequence != failed.Sequence {
		t.Fatalf("late Connected recovered explicit-connect failure: %+v", afterLateConnected)
	}
}

func TestExplicitConnectRejectsStoppedWithLostFence(t *testing.T) {
	container := &explicitConnectStatusTestContainer{
		connectionStatusFenceTestContainer: connectionStatusFenceTestContainer{fence: store.ConnectionStatusFence{
			Required: true, OwnerID: "owner-expired", FencingToken: 64, Generation: 14,
			Epoch: "019fce0d-1d24-7000-8000-000000000015",
		}},
		reserveErr: errors.New("must not be reached"),
	}
	jid := types.NewJID("15550000006", types.DefaultUserServer)
	client := NewClient(&store.Device{
		ID: &jid, SessionID: "019fce0d-1d24-7000-8000-000000000016", RevisionID: 17,
		Container: container,
	}, nil)
	client.Disconnect()
	container.err = errors.New("lease expired")

	err := client.ConnectContext(context.Background())
	if !errors.Is(err, errConnectionStatusLeaseUnavailable) {
		t.Fatalf("explicit Connect returned unexpected error after lease loss: %v", err)
	}
	if container.reserveCalled {
		t.Fatal("explicit Connect reached provider work after lease loss")
	}
	status := client.GetConnectionStatus()
	if status.Status != events.ConnectionStatusLeaseLost || status.Connected {
		t.Fatalf("explicit Connect did not fail closed after lease loss: %+v", status)
	}
}

func TestExplicitConnectRejectsStoppedWithDeletedStore(t *testing.T) {
	container := &explicitConnectStatusTestContainer{
		connectionStatusFenceTestContainer: connectionStatusFenceTestContainer{fence: store.ConnectionStatusFence{
			Required: true, OwnerID: "owner-deleted", FencingToken: 65, Generation: 15,
			Epoch: "019fce0d-1d24-7000-8000-000000000017",
		}},
		reserveErr: errors.New("must not be reached"),
	}
	jid := types.NewJID("15550000007", types.DefaultUserServer)
	client := NewClient(&store.Device{
		ID: &jid, SessionID: "019fce0d-1d24-7000-8000-000000000018", RevisionID: 18,
		Container: container,
	}, nil)
	client.Disconnect()
	client.Store.Deleted = true

	err := client.ConnectContext(context.Background())
	if !errors.Is(err, store.ErrDeviceDeleted) {
		t.Fatalf("explicit Connect returned unexpected error for deleted store: %v", err)
	}
	if container.reserveCalled {
		t.Fatal("explicit Connect reached provider work with a deleted store")
	}
	status := client.GetConnectionStatus()
	if status.Status != events.ConnectionStatusInvalidSession || status.SessionValid == nil || *status.SessionValid || status.Connected {
		t.Fatalf("explicit Connect did not invalidate a deleted store: %+v", status)
	}
}

func TestExplicitConnectDoesNotRecoverOtherLifecycleBoundaries(t *testing.T) {
	for _, statusType := range []events.ConnectionStatusType{
		events.ConnectionStatusLoggedOut,
		events.ConnectionStatusInvalidSession,
		events.ConnectionStatusConflict,
		events.ConnectionStatusLeaseLost,
		events.ConnectionStatusHandoff,
		events.ConnectionStatusError,
	} {
		t.Run(string(statusType), func(t *testing.T) {
			container := &explicitConnectStatusTestContainer{
				connectionStatusFenceTestContainer: connectionStatusFenceTestContainer{fence: store.ConnectionStatusFence{
					Required: true, OwnerID: "owner-terminal", FencingToken: 62, Generation: 12,
					Epoch: "019fce0d-1d24-7000-8000-000000000011",
				}},
				reserveErr: errors.New("must not be reached"),
			}
			jid := types.NewJID("15550000005", types.DefaultUserServer)
			client := NewClient(&store.Device{
				ID: &jid, SessionID: "019fce0d-1d24-7000-8000-000000000012", RevisionID: 15,
				Container: container,
			}, nil)
			terminal := client.setConnectionStatus(connectionStatusTransition{
				status:    statusType,
				validity:  connectionValidityPreserve,
				connected: connectionConnectedFalse,
			})

			if err := client.ConnectContext(context.Background()); !errors.Is(err, errConnectionStatusTerminal) {
				t.Fatalf("explicit Connect returned unexpected error for %s: %v", statusType, err)
			}
			if container.reserveCalled {
				t.Fatalf("explicit Connect reached provider work from %s", statusType)
			}
			after := client.GetConnectionStatus()
			if after.Status != terminal.Status || after.Sequence != terminal.Sequence {
				t.Fatalf("explicit Connect recovered %s: before=%+v after=%+v", statusType, terminal, after)
			}
		})
	}
}

func TestExplicitStoppedRecoveryAllowsFreshQRFlow(t *testing.T) {
	container := &connectionStatusFenceTestContainer{fence: store.ConnectionStatusFence{
		Required: true, OwnerID: "owner-qr", FencingToken: 63, Generation: 13,
		Epoch: "019fce0d-1d24-7000-8000-000000000013",
	}}
	client := NewClient(&store.Device{
		SessionID: "019fce0d-1d24-7000-8000-000000000014", RevisionID: 16,
		Container: container,
	}, nil)
	statuses := make(chan events.ConnectionStatus, 4)
	client.AddEventHandler(func(rawEvent any) {
		if status, ok := rawEvent.(*events.ConnectionStatus); ok {
			statuses <- cloneConnectionStatus(*status)
		}
	})
	client.Disconnect()
	if stopped := waitForConnectionStatus(t, statuses); stopped.Status != events.ConnectionStatusStopped {
		t.Fatalf("fresh QR fixture did not stop: %+v", stopped)
	}
	qrCtx, cancelQR := context.WithCancel(context.Background())
	defer cancelQR()
	qrItems, err := client.GetQRChannel(qrCtx)
	if err != nil {
		t.Fatalf("fresh QR channel was rejected after stop: %v", err)
	}

	client.socketLock.Lock()
	err = client.prepareConnectionStatusForExplicitConnect()
	client.socketLock.Unlock()
	if err != nil {
		t.Fatalf("explicit QR reconnect gate rejected a current fence: %v", err)
	}
	if connecting := waitForConnectionStatus(t, statuses); connecting.Status != events.ConnectionStatusConnecting {
		t.Fatalf("QR reconnect did not publish connecting: %+v", connecting)
	}
	client.dispatchEvent(&events.QR{Codes: []string{"test-only-qr-payload"}})
	qrStatus := waitForConnectionStatus(t, statuses)
	if qrStatus.Status != events.ConnectionStatusQR || !qrStatus.QRAvailable || qrStatus.Connected {
		t.Fatalf("QR callback after explicit reconnect was rejected: %+v", qrStatus)
	}
	select {
	case item := <-qrItems:
		if item.Event != QRChannelEventCode || item.Code != "test-only-qr-payload" {
			t.Fatalf("unexpected QR channel item: %+v", item)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for QR channel item")
	}
	if strings.Contains(fmt.Sprintf("%+v", qrStatus), "test-only-qr-payload") {
		t.Fatal("QR payload leaked into canonical connection status")
	}
}

func TestStaleConnectedEventCannotResurrectStoppedClient(t *testing.T) {
	client := newConnectionStatusTestClient(true)
	client.Disconnect()
	stopped := client.GetConnectionStatus()
	client.dispatchEvent(&events.Connected{})
	afterConnected := client.GetConnectionStatus()
	if afterConnected.Status != events.ConnectionStatusStopped || afterConnected.Connected || afterConnected.Sequence != stopped.Sequence {
		t.Fatalf("stale Connected event resurrected a stopped client: %+v", afterConnected)
	}
}

func TestInternalProtocolReconnectDoesNotBecomeExplicitStop(t *testing.T) {
	client := newConnectionStatusTestClient(true)
	debugLogger := &recordingSessionDebugLogger{}
	client.Log = debugLogger
	if !client.disconnectForReconnect("server_login_restart") {
		t.Fatal("internal protocol reconnect was rejected in an active lifecycle")
	}
	status := client.GetConnectionStatus()
	if status.Status != events.ConnectionStatusReconnecting ||
		status.Connected || !status.Recoverable ||
		status.Reason != "server_login_restart" {
		t.Fatalf("internal protocol reconnect produced an invalid status: %+v", status)
	}
	if len(debugLogger.events) != 1 || debugLogger.events[0] != "internal_reconnect.transport_closed" {
		t.Fatalf("internal reconnect did not emit its bounded debug event: %#v", debugLogger.events)
	}
}

func TestInternalProtocolReconnectCannotRecoverExplicitStop(t *testing.T) {
	client := newConnectionStatusTestClient(true)
	client.Disconnect()
	stopped := client.GetConnectionStatus()

	if client.disconnectForReconnect("server_login_restart") {
		t.Fatal("internal protocol reconnect recovered an explicitly stopped client")
	}
	afterReconnect := client.GetConnectionStatus()
	if afterReconnect.Status != events.ConnectionStatusStopped ||
		afterReconnect.Connected || afterReconnect.Sequence != stopped.Sequence {
		t.Fatalf("internal reconnect changed the explicit stop boundary: before=%+v after=%+v", stopped, afterReconnect)
	}
}

func TestInternalProtocolReconnectCannotRecoverLeaseLoss(t *testing.T) {
	client := newConnectionStatusTestClient(true)
	client.MarkConnectionLeaseLost()
	lost := client.GetConnectionStatus()

	if client.disconnectForReconnect("keepalive_timeout") {
		t.Fatal("internal protocol reconnect recovered a lease-lost client")
	}
	afterReconnect := client.GetConnectionStatus()
	if afterReconnect.Status != events.ConnectionStatusLeaseLost ||
		afterReconnect.Connected || afterReconnect.Sequence != lost.Sequence {
		t.Fatalf("internal reconnect changed the lease-loss boundary: before=%+v after=%+v", lost, afterReconnect)
	}
}

func TestTerminalConnectionStatusIsStickyAgainstLateLifecycleCallbacks(t *testing.T) {
	client := newConnectionStatusTestClient(true)
	client.MarkConnectionError("connect_failed")
	terminal := client.GetConnectionStatus()

	client.dispatchEvent(&events.Connected{})
	client.dispatchEvent(&events.Disconnected{})
	client.MarkConnectionRestoring()
	afterCallbacks := client.GetConnectionStatus()
	if afterCallbacks.Status != events.ConnectionStatusError ||
		afterCallbacks.Connected ||
		afterCallbacks.Sequence != terminal.Sequence {
		t.Fatalf("late lifecycle callback resurrected a terminal client: before=%+v after=%+v", terminal, afterCallbacks)
	}
}

func TestUnexpectedQRIsRejectedOutsideAnEmptyPairingLifecycle(t *testing.T) {
	registered := newConnectionStatusTestClient(true)
	registered.dispatchEvent(&events.QR{Codes: []string{"must-never-be-exported"}})
	registeredStatus := registered.GetConnectionStatus()
	if registeredStatus.Status != events.ConnectionStatusInvalidSession ||
		registeredStatus.Connected || registeredStatus.QRAvailable ||
		registeredStatus.SessionValid == nil || *registeredStatus.SessionValid {
		t.Fatalf("registered client accepted an unexpected QR: %+v", registeredStatus)
	}

	handoff := newConnectionStatusTestClient(false)
	handoff.MarkConnectionHandoff()
	handoff.dispatchEvent(&events.QR{Codes: []string{"handoff-secret-qr"}})
	handoffStatus := handoff.GetConnectionStatus()
	if handoffStatus.Status != events.ConnectionStatusInvalidSession ||
		handoffStatus.Connected || handoffStatus.QRAvailable {
		t.Fatalf("handoff client accepted an unexpected QR: %+v", handoffStatus)
	}
}

func TestQueuedOnlineEventIsDroppedAfterLeaseLoss(t *testing.T) {
	client := newConnectionStatusTestClient(true)
	handlerEntered := make(chan struct{})
	releaseHandler := make(chan struct{})
	observed := make(chan events.ConnectionStatus, 3)
	client.AddEventHandler(func(rawEvent any) {
		status, ok := rawEvent.(*events.ConnectionStatus)
		if !ok {
			return
		}
		if status.Status == events.ConnectionStatusRestoring {
			close(handlerEntered)
			<-releaseHandler
		}
		observed <- cloneConnectionStatus(*status)
	})

	client.MarkConnectionRestoring()
	select {
	case <-handlerEntered:
	case <-time.After(2 * time.Second):
		t.Fatal("status dispatcher did not enter the blocking handler")
	}
	client.setConnectionStatus(connectionStatusTransition{
		status:    events.ConnectionStatusOnline,
		validity:  connectionValidityValid,
		connected: connectionConnectedTrue,
	})
	client.MarkConnectionLeaseLost()
	close(releaseHandler)

	first := waitForConnectionStatus(t, observed)
	second := waitForConnectionStatus(t, observed)
	if first.Status != events.ConnectionStatusRestoring || second.Status != events.ConnectionStatusLeaseLost {
		t.Fatalf("unexpected queued lifecycle: first=%+v second=%+v", first, second)
	}
	select {
	case unexpected := <-observed:
		t.Fatalf("stale online event was delivered after lease loss: %+v", unexpected)
	case <-time.After(30 * time.Millisecond):
	}
}

func TestConnectionStatusConcurrentTransitionsAreOrderedAndRaceFree(t *testing.T) {
	client := newConnectionStatusTestClient(true)
	const transitionCount = 128
	statuses := make(chan events.ConnectionStatus, transitionCount)
	client.AddEventHandler(func(rawEvent any) {
		if status, ok := rawEvent.(*events.ConnectionStatus); ok {
			statuses <- cloneConnectionStatus(*status)
		}
	})

	var waitGroup sync.WaitGroup
	waitGroup.Add(transitionCount)
	for index := 0; index < transitionCount; index++ {
		go func(index int) {
			defer waitGroup.Done()
			client.setConnectionStatus(connectionStatusTransition{
				status:    events.ConnectionStatusError,
				validity:  connectionValidityPreserve,
				connected: connectionConnectedFalse,
				reason:    "connection_error",
				errorCode: fmt.Sprintf("canary_%03d", index),
			})
		}(index)
	}
	waitGroup.Wait()

	previousSequence := uint64(1)
	for index := 0; index < transitionCount; index++ {
		status := waitForConnectionStatus(t, statuses)
		if status.Sequence != previousSequence+1 {
			t.Fatalf("status events were delivered out of order: previous=%d current=%d", previousSequence, status.Sequence)
		}
		if status.Status != events.ConnectionStatusError || status.Connected || status.Recoverable {
			t.Fatalf("unexpected concurrent error status: %+v", status)
		}
		previousSequence = status.Sequence
	}
	if current := client.GetConnectionStatus(); current.Sequence != transitionCount+1 {
		t.Fatalf("unexpected final sequence: got %d want %d", current.Sequence, transitionCount+1)
	}
}

func TestConnectionLifecycleMarkersPreserveTerminalCause(t *testing.T) {
	client := newConnectionStatusTestClient(true)
	client.setConnectionStatus(connectionStatusTransition{
		status:    events.ConnectionStatusOnline,
		validity:  connectionValidityValid,
		connected: connectionConnectedTrue,
	})
	client.MarkConnectionHandoff()
	handoff := client.GetConnectionStatus()
	if handoff.Status != events.ConnectionStatusHandoff || handoff.Connected || !handoff.Recoverable {
		t.Fatalf("handoff reported a false-positive live socket: %+v", handoff)
	}
	client.Disconnect()
	handoff = client.GetConnectionStatus()
	if handoff.Status != events.ConnectionStatusHandoff || handoff.Connected {
		t.Fatalf("disconnect overwrote the handoff cause: %+v", handoff)
	}

	client.MarkConnectionLeaseLost()
	client.Disconnect()
	leaseLost := client.GetConnectionStatus()
	if leaseLost.Status != events.ConnectionStatusLeaseLost || leaseLost.Connected || !leaseLost.Recoverable || leaseLost.ErrorCode != "lease_lost" {
		t.Fatalf("disconnect overwrote the lease-loss cause: %+v", leaseLost)
	}

	// A later generic error must not erase the stronger fencing cause. Recovery
	// from lease loss requires a new, freshly fenced client lifecycle.
	client.MarkConnectionError(" Secret Token / with controls\n")
	afterError := client.GetConnectionStatus()
	if afterError.Status != events.ConnectionStatusLeaseLost ||
		afterError.ErrorCode != "lease_lost" ||
		afterError.Sequence != leaseLost.Sequence {
		t.Fatalf("generic error overwrote the terminal lease-loss cause: before=%+v after=%+v", leaseLost, afterError)
	}

	// Validate external error-code redaction independently, before any terminal
	// status has already established a more specific failure cause.
	errorClient := newConnectionStatusTestClient(true)
	errorClient.MarkConnectionError(" Secret Token / with controls\n")
	errorStatus := errorClient.GetConnectionStatus()
	if errorStatus.ErrorCode != "connection_error" {
		t.Fatalf("unknown external error code was not redacted: %q", errorStatus.ErrorCode)
	}
	if strings.ContainsAny(errorStatus.ErrorCode, " /\n\r\t") {
		t.Fatalf("error code contains unsafe characters: %q", errorStatus.ErrorCode)
	}
}
