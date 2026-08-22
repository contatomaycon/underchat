package app

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	_ "image/gif"
	"image/jpeg"
	_ "image/png"
	"io"
	"log"
	"mime"
	"net/http"
	"os"
	"path"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/appstate"
	"go.mau.fi/whatsmeow/proto/waCommon"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	"google.golang.org/protobuf/proto"
)

const unsupportedIncomingMessageText = "Mensagem recebida não suportada pelo provedor. Verifique no WhatsApp."

const (
	defaultMediaDownloadRequestTimeout  = 45 * time.Second
	defaultMediaDownloadMaxBytes        = int64(128 * 1024 * 1024)
	maxConcurrentIncomingMediaDownloads = 2
)

var (
	errMediaDownloadTooLarge   = errors.New("media download exceeds configured maximum")
	errMediaDownloadInvalidURL = errors.New("media download URL is invalid")
	errOutboundPayloadInvalid  = errors.New("outbound payload is invalid")
)

type mediaDownloadHTTPError struct {
	StatusCode int
	Status     string
}

func (e *mediaDownloadHTTPError) Error() string {
	if e == nil {
		return "media download HTTP failure"
	}
	return fmt.Sprintf("media download failed: %s", e.Status)
}

func (e *mediaDownloadHTTPError) Transient() bool {
	if e == nil {
		return false
	}
	switch e.StatusCode {
	case http.StatusRequestTimeout,
		http.StatusTooEarly,
		http.StatusTooManyRequests:
		return true
	default:
		return e.StatusCode >= http.StatusInternalServerError
	}
}

type boundedIncomingMediaFile struct {
	file     *os.File
	maxBytes int64
	mu       sync.Mutex
}

func newBoundedIncomingMediaFile(
	file *os.File,
	maxBytes int64,
) (*boundedIncomingMediaFile, error) {
	if file == nil {
		return nil, errors.New("media temporary file is required")
	}
	if maxBytes <= 0 {
		return nil, errors.New("media download maximum must be positive")
	}
	return &boundedIncomingMediaFile{
		file:     file,
		maxBytes: maxBytes,
	}, nil
}

func (f *boundedIncomingMediaFile) Read(p []byte) (int, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.file.Read(p)
}

func (f *boundedIncomingMediaFile) Write(p []byte) (int, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	offset, err := f.file.Seek(0, io.SeekCurrent)
	if err != nil {
		return 0, err
	}
	if f.exceedsLimit(offset, len(p)) {
		return 0, errMediaDownloadTooLarge
	}
	return f.file.Write(p)
}

func (f *boundedIncomingMediaFile) Seek(
	offset int64,
	whence int,
) (int64, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.file.Seek(offset, whence)
}

func (f *boundedIncomingMediaFile) ReadAt(
	p []byte,
	offset int64,
) (int, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.file.ReadAt(p, offset)
}

func (f *boundedIncomingMediaFile) WriteAt(
	p []byte,
	offset int64,
) (int, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.exceedsLimit(offset, len(p)) {
		return 0, errMediaDownloadTooLarge
	}
	return f.file.WriteAt(p, offset)
}

func (f *boundedIncomingMediaFile) Truncate(size int64) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if size > f.maxBytes {
		return errMediaDownloadTooLarge
	}
	return f.file.Truncate(size)
}

func (f *boundedIncomingMediaFile) Stat() (os.FileInfo, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.file.Stat()
}

func (f *boundedIncomingMediaFile) exceedsLimit(
	offset int64,
	writeLength int,
) bool {
	if offset < 0 || offset > f.maxBytes {
		return true
	}
	return int64(writeLength) > f.maxBytes-offset
}

type UnsupportedFeatureError struct {
	Feature string
}

func (e UnsupportedFeatureError) Error() string {
	return "unsupported_whatsmeow_feature:" + e.Feature
}

type providerInvocationBoundary func(context.Context) error

type providerAuthorizationGuard func(context.Context) error

type providerAuthorizationContextKey struct{}
type providerTransportEffectContextKey struct{}
type providerInvocationWatchdogContextKey struct{}
type providerInvocationWatchdogFactoryContextKey struct{}
type outboundProviderStallHandlerContextKey struct{}
type providerInvocationTimeoutContextKey struct{}

var errOutboundProviderCallStalled = errors.New("outbound provider call stalled")

type outboundProviderStallHandler func(context.Context, error) error

const defaultProviderInvocationTimeout = 45 * time.Second

func withProviderInvocationTimeout(
	ctx context.Context,
	timeout time.Duration,
) context.Context {
	if timeout <= 0 {
		timeout = defaultProviderInvocationTimeout
	}
	return context.WithValue(
		ctx,
		providerInvocationTimeoutContextKey{},
		timeout,
	)
}

func providerInvocationTimeoutFromContext(ctx context.Context) time.Duration {
	if ctx == nil {
		return 0
	}
	configuredTimeout := defaultProviderInvocationTimeout
	if timeout, ok := ctx.Value(providerInvocationTimeoutContextKey{}).(time.Duration); ok &&
		timeout > 0 {
		configuredTimeout = timeout
		if deadline, hasDeadline := ctx.Deadline(); hasDeadline {
			remaining := time.Until(deadline)
			if remaining < configuredTimeout {
				return remaining
			}
		}
		return configuredTimeout
	}
	if deadline, ok := ctx.Deadline(); ok {
		return time.Until(deadline)
	}
	return configuredTimeout
}

func withOutboundProviderStallHandler(
	ctx context.Context,
	handler outboundProviderStallHandler,
) context.Context {
	if handler == nil {
		return ctx
	}
	return context.WithValue(ctx, outboundProviderStallHandlerContextKey{}, handler)
}

func outboundProviderStallHandlerFromContext(
	ctx context.Context,
) outboundProviderStallHandler {
	if ctx == nil {
		return nil
	}
	handler, _ := ctx.Value(outboundProviderStallHandlerContextKey{}).(outboundProviderStallHandler)
	return handler
}

const (
	providerInvocationPending uint32 = iota
	providerInvocationSettled
	providerInvocationStalled
)

type providerInvocationWatchdog struct {
	ctx       context.Context
	manager   *WhatsAppManager
	scope     whatsAppRuntimeFence
	data      ChatMessage
	startedAt time.Time
	tracker   *providerTransportEffectTracker
	onStall   outboundProviderStallHandler
	armed     atomic.Bool
	state     atomic.Uint32
	done      chan struct{}
	doneOnce  sync.Once
}

func newProviderInvocationWatchdog(
	ctx context.Context,
	manager *WhatsAppManager,
	scope whatsAppRuntimeFence,
	data ChatMessage,
	startedAt time.Time,
	tracker *providerTransportEffectTracker,
	onStall outboundProviderStallHandler,
) *providerInvocationWatchdog {
	if ctx == nil || manager == nil || !scope.isValid() {
		return nil
	}
	return &providerInvocationWatchdog{
		ctx:       ctx,
		manager:   manager,
		scope:     scope,
		data:      data,
		startedAt: startedAt,
		tracker:   tracker,
		onStall:   onStall,
		done:      make(chan struct{}),
	}
}

func withProviderInvocationWatchdog(
	ctx context.Context,
	watchdog *providerInvocationWatchdog,
) context.Context {
	if watchdog == nil {
		return ctx
	}
	return context.WithValue(ctx, providerInvocationWatchdogContextKey{}, watchdog)
}

func withProviderInvocationWatchdogFactory(
	ctx context.Context,
	factory func() *providerInvocationWatchdog,
) context.Context {
	if factory == nil {
		return ctx
	}
	return context.WithValue(
		ctx,
		providerInvocationWatchdogFactoryContextKey{},
		factory,
	)
}

func providerInvocationWatchdogFromContext(
	ctx context.Context,
) *providerInvocationWatchdog {
	if ctx == nil {
		return nil
	}
	watchdog, _ := ctx.Value(providerInvocationWatchdogContextKey{}).(*providerInvocationWatchdog)
	if watchdog != nil {
		return watchdog
	}
	factory, _ := ctx.Value(
		providerInvocationWatchdogFactoryContextKey{},
	).(func() *providerInvocationWatchdog)
	if factory != nil {
		return factory()
	}
	return watchdog
}

func providerInvocationWatchdogFromFactoryContext(
	ctx context.Context,
) *providerInvocationWatchdog {
	if ctx == nil {
		return nil
	}
	factory, _ := ctx.Value(
		providerInvocationWatchdogFactoryContextKey{},
	).(func() *providerInvocationWatchdog)
	if factory == nil {
		return nil
	}
	return factory()
}

func (w *providerInvocationWatchdog) arm(providerCtx context.Context) {
	if w == nil || !w.armed.CompareAndSwap(false, true) {
		return
	}
	deadline, hasDeadline := providerCtx.Deadline()
	if !hasDeadline {
		return
	}
	go func() {
		remaining := time.Until(deadline)
		if remaining < 0 {
			remaining = 0
		}
		timer := time.NewTimer(remaining)
		defer timer.Stop()
		select {
		case <-timer.C:
		case <-w.done:
			return
		}
		cause := fmt.Errorf(
			"%w: %w",
			errOutboundProviderCallStalled,
			context.DeadlineExceeded,
		)
		w.stall(cause)
	}()
}

func (w *providerInvocationWatchdog) stall(cause error) bool {
	if w == nil || !w.state.CompareAndSwap(
		providerInvocationPending,
		providerInvocationStalled,
	) {
		return false
	}
	if cause == nil {
		cause = fmt.Errorf(
			"%w: %w",
			errOutboundProviderCallStalled,
			context.DeadlineExceeded,
		)
	}
	if w.tracker != nil {
		w.tracker.markStallReported()
	}
	if w.onStall != nil {
		// Ledger terminalization must not depend on reconnect hooks,
		// Centrifugo, or the provider's ResetConnection returning.
		go func() {
			recoveryCtx, cancel := context.WithTimeout(
				context.WithoutCancel(w.ctx),
				outboundRecoveryAttemptTimeout,
			)
			defer cancel()
			if err := w.onStall(recoveryCtx, cause); err != nil {
				log.Printf(
					"whatsmeow provider stall ledger terminalization deferred worker_id=%s message_id_hash=%s error_code=%s",
					w.scope.WorkerID,
					hashConnectionFlowIdentifier(w.data.MessageID),
					safeOperationalErrorCode(err),
				)
			}
		}()
	}
	// Fence the old runtime and update health before the timed-out provider
	// invocation can return control to Kafka. Even a slow/unavailable ledger
	// cannot admit another call behind an SDK flight that ignored its context.
	w.manager.recordOutboundProviderStall(
		context.WithoutCancel(w.ctx),
		w.data,
		w.scope,
		time.Since(w.startedAt),
		cause,
	)
	return true
}

func (w *providerInvocationWatchdog) settle() {
	if w == nil {
		return
	}
	w.state.CompareAndSwap(providerInvocationPending, providerInvocationSettled)
	w.doneOnce.Do(func() { close(w.done) })
}

func (w *providerInvocationWatchdog) stalled() bool {
	return w != nil && w.state.Load() == providerInvocationStalled
}

func (w *providerInvocationWatchdog) isArmed() bool {
	return w != nil && w.armed.Load()
}

type providerTransportEffectTracker struct {
	mu            sync.Mutex
	invocations   int
	firstError    error
	stallReported bool
}

func withProviderTransportEffectTracker(
	ctx context.Context,
	tracker *providerTransportEffectTracker,
) context.Context {
	if tracker == nil {
		return ctx
	}
	return context.WithValue(ctx, providerTransportEffectContextKey{}, tracker)
}

func providerTransportEffectTrackerFromContext(
	ctx context.Context,
) *providerTransportEffectTracker {
	if ctx == nil {
		return nil
	}
	tracker, _ := ctx.Value(providerTransportEffectContextKey{}).(*providerTransportEffectTracker)
	return tracker
}

func (t *providerTransportEffectTracker) record(err error) {
	if t == nil {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	t.invocations++
	if err != nil && t.firstError == nil {
		t.firstError = err
	}
}

func (t *providerTransportEffectTracker) failure() (error, bool) {
	if t == nil {
		return nil, false
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.firstError, t.invocations > 0
}

func (t *providerTransportEffectTracker) markStallReported() {
	if t == nil {
		return
	}
	t.mu.Lock()
	t.stallReported = true
	t.mu.Unlock()
}

func (t *providerTransportEffectTracker) wasStallReported() bool {
	if t == nil {
		return false
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.stallReported
}

func withProviderAuthorizationGuard(ctx context.Context, guard providerAuthorizationGuard) context.Context {
	return context.WithValue(ctx, providerAuthorizationContextKey{}, guard)
}

func providerAuthorizationGuardFromContext(ctx context.Context) providerAuthorizationGuard {
	if ctx == nil {
		return nil
	}
	guard, _ := ctx.Value(providerAuthorizationContextKey{}).(providerAuthorizationGuard)
	return guard
}

func assertProviderCallAuthorized(ctx context.Context) error {
	guard := providerAuthorizationGuardFromContext(ctx)
	if guard == nil {
		return fmt.Errorf("provider authorization guard is required")
	}
	return guard(ctx)
}

func invokeProviderAuthorizedCall[T any](
	ctx context.Context,
	guard providerAuthorizationGuard,
	invoke func(context.Context) (T, error),
) (T, error) {
	var zero T
	if guard == nil {
		return zero, fmt.Errorf("provider authorization guard is required")
	}
	if invoke == nil {
		return zero, fmt.Errorf("provider invocation is required")
	}
	if err := guard(ctx); err != nil {
		return zero, err
	}
	if watchdog := providerInvocationWatchdogFromFactoryContext(ctx); watchdog != nil {
		return invokeProviderOperationWithDeadline(ctx, watchdog, invoke)
	}
	result, err := invoke(ctx)
	providerTransportEffectTrackerFromContext(ctx).record(err)
	return result, err
}

func invokeProviderAuthorizedErrorCall(
	ctx context.Context,
	guard providerAuthorizationGuard,
	invoke func(context.Context) error,
) error {
	_, err := invokeProviderAuthorizedCall(ctx, guard, func(invokeCtx context.Context) (struct{}, error) {
		return struct{}{}, invoke(invokeCtx)
	})
	return err
}

type providerInvocationResult[T any] struct {
	value T
	err   error
}

func observeLateProviderInvocation[T any](
	result <-chan providerInvocationResult[T],
) {
	go func() {
		late := <-result
		if late.err != nil {
			log.Printf(
				"whatsmeow provider invocation rejected after application deadline error_code=%s",
				safeOperationalErrorCode(late.err),
			)
			return
		}
		log.Printf("whatsmeow provider invocation resolved after application deadline")
	}()
}

func invokeProviderOperationWithDeadline[T any](
	ctx context.Context,
	watchdog *providerInvocationWatchdog,
	invoke func(context.Context) (T, error),
) (T, error) {
	var zero T
	providerTimeout := providerInvocationTimeoutFromContext(ctx)
	if providerTimeout <= 0 {
		return zero, context.DeadlineExceeded
	}
	providerCtx, cancelProvider := context.WithTimeout(
		context.WithoutCancel(ctx),
		providerTimeout,
	)
	defer cancelProvider()
	watchdog.arm(providerCtx)
	result := make(chan providerInvocationResult[T], 1)
	go func() {
		value, invokeErr := invoke(providerCtx)
		providerTransportEffectTrackerFromContext(providerCtx).record(invokeErr)
		watchdog.settle()
		result <- providerInvocationResult[T]{
			value: value,
			err:   invokeErr,
		}
	}()

	select {
	case outcome := <-result:
		if watchdog.stalled() {
			return zero, fmt.Errorf(
				"%w: provider returned after its operation deadline",
				errOutboundProviderCallStalled,
			)
		}
		return outcome.value, outcome.err
	case <-providerCtx.Done():
		cause := fmt.Errorf(
			"%w: %w",
			errOutboundProviderCallStalled,
			providerCtx.Err(),
		)
		watchdog.stall(cause)
		observeLateProviderInvocation(result)
		return zero, cause
	}
}

// invokeProviderCallAtBoundary schedules the observed SDK flight immediately
// after the boundary's durable provider_invoked transition and post-CAS
// authorization check. When the boundary fails (including an uncertain Redis
// result or reversal), invoke is not executed and the caller fails closed.
func invokeProviderCallAtBoundary[T any](
	ctx context.Context,
	boundary providerInvocationBoundary,
	invoke func(context.Context) (T, error),
) (T, error) {
	var zero T
	if ctx == nil {
		return zero, context.Canceled
	}
	if invoke == nil {
		return zero, fmt.Errorf("provider invocation is required")
	}
	if boundary == nil {
		return zero, fmt.Errorf("provider invocation boundary is required")
	}
	// The boundary owns both the durable transition and its final authorization
	// check. There must be no further await between a successful boundary and
	// scheduling the SDK call.
	if err := ctx.Err(); err != nil {
		return zero, err
	}
	if err := boundary(ctx); err != nil {
		return zero, err
	}
	return invokeProviderOperationWithDeadline(
		ctx,
		providerInvocationWatchdogFromContext(ctx),
		invoke,
	)
}

func invokeProviderErrorCallAtBoundary(
	ctx context.Context,
	boundary providerInvocationBoundary,
	invoke func(context.Context) error,
) error {
	_, err := invokeProviderCallAtBoundary(ctx, boundary, func(invokeCtx context.Context) (struct{}, error) {
		return struct{}{}, invoke(invokeCtx)
	})
	return err
}

func (m *WhatsAppManager) SendChatMessageWithInvocationBoundary(
	ctx context.Context,
	data ChatMessage,
	authorize providerAuthorizationGuard,
	boundary providerInvocationBoundary,
) (result map[string]any, err error) {
	if authorize == nil {
		return nil, fmt.Errorf("provider authorization guard is required")
	}
	if boundary == nil {
		return nil, fmt.Errorf("provider invocation boundary is required")
	}
	startedAt := time.Now()
	var target types.JID
	externalID := ""
	transportEffects := &providerTransportEffectTracker{}
	m.logOutgoingSendDebug("whatsmeow.outgoing.send.start", data, target, externalID, 0, nil)
	m.recordOutboundAttempt(ctx, data)
	defer func() {
		if err != nil {
			if !transportEffects.wasStallReported() {
				transportErr, providerInvoked := transportEffects.failure()
				if transportErr == nil {
					transportErr = err
					providerInvoked = false
				}
				m.recordOutboundFailureWithInvocation(
					ctx,
					data,
					time.Since(startedAt),
					transportErr,
					providerInvoked,
				)
			}
			m.logOutgoingSendDebug("whatsmeow.outgoing.send.error", data, target, externalID, time.Since(startedAt), err)
		}
	}()

	opCtx, cancel := m.sendOperationContext(ctx)
	defer cancel()
	opCtx = withProviderAuthorizationGuard(opCtx, authorize)
	opCtx = withProviderTransportEffectTracker(opCtx, transportEffects)
	connectionScope, _ := inboundConnectionScopeFromContext(ctx)
	opCtx = withProviderInvocationWatchdog(
		opCtx,
		newProviderInvocationWatchdog(
			opCtx,
			m,
			connectionScope,
			data,
			startedAt,
			transportEffects,
			outboundProviderStallHandlerFromContext(ctx),
		),
	)

	if !m.IsReady() {
		return nil, fmt.Errorf("%w: %s", ErrWhatsAppNotReady, m.outboundReadinessReason())
	}

	client := m.getClient()
	if client == nil {
		return nil, fmt.Errorf("client is not initialized")
	}
	target, err = resolveTargetJID(data)
	if err != nil {
		return nil, err
	}
	resolvedTarget, err := m.resolveOutboundSendTarget(opCtx, client, target, authorize)
	if err != nil {
		return nil, err
	}
	providerTarget := resolvedTarget.providerTarget
	sendExtra, err := sendRequestExtraForProviderTarget(target, resolvedTarget)
	if err != nil {
		return nil, err
	}
	// The USync lookup above is a provider read and may take time. Revalidate
	// ownership before any subsequent message preparation/provider activity.
	if err := authorize(opCtx); err != nil {
		return nil, err
	}
	msg, err := m.buildOutgoingMessage(opCtx, client, target, data)
	if err != nil {
		return nil, err
	}
	if text, ok := typingSimulationText(data); ok {
		typingErr := m.simulateTypingBeforeSend(opCtx, client, providerTarget, text)
		if err := opCtx.Err(); err != nil {
			return nil, err
		}
		// Presence is best-effort, but a genuine fence revocation is not a
		// cosmetic presence failure. Fail before provider_invoked so the active
		// generation can safely reconcile the message.
		if errors.Is(typingErr, errWhatsAppRuntimeFenceRevoked) {
			return nil, typingErr
		}
	}
	if err := opCtx.Err(); err != nil {
		return nil, err
	}
	m.logOutgoingSendDebug("whatsmeow.outgoing.send.before_provider", data, target, externalID, time.Since(startedAt), nil)
	resp, err := invokeProviderCallAtBoundary(opCtx, boundary, func(invokeCtx context.Context) (whatsmeow.SendResponse, error) {
		return client.SendMessage(invokeCtx, providerTarget, msg, sendExtra)
	})
	if err != nil {
		return nil, err
	}
	externalID = string(resp.ID)
	m.recordOutboundSuccess(ctx, data, time.Since(startedAt), externalID)
	m.logOutgoingSendDebug("whatsmeow.outgoing.send.ack.success", data, target, externalID, time.Since(startedAt), nil)
	return map[string]any{
		"key": map[string]any{
			"id":        externalID,
			"remoteJid": target.String(),
			"fromMe":    true,
		},
	}, nil
}

func sendRequestExtraForProviderTarget(
	logicalTarget types.JID,
	resolvedTarget outboundSendTargetResolution,
) (whatsmeow.SendRequestExtra, error) {
	logicalTarget = logicalTarget.ToNonAD()
	providerTarget := resolvedTarget.providerTarget
	recipientPN := resolvedTarget.recipientPN
	if logicalTarget.Server != types.DefaultUserServer {
		return whatsmeow.SendRequestExtra{}, nil
	}
	if !isValidNonADNumericJID(logicalTarget, types.DefaultUserServer) {
		return whatsmeow.SendRequestExtra{}, fmt.Errorf(
			"%w: invalid logical PN %s",
			errOutboundTargetInvalid,
			logicalTarget,
		)
	}
	if !isValidNonADNumericJID(providerTarget, types.HiddenUserServer) ||
		!isValidNonADNumericJID(recipientPN, types.DefaultUserServer) ||
		(recipientPN.User != logicalTarget.User &&
			!isBrazilMobileNinthDigitAlias(logicalTarget.User, recipientPN.User)) {
		return whatsmeow.SendRequestExtra{}, fmt.Errorf(
			"%w: inconsistent pre-resolved target (logical=%s provider=%s recipient_pn=%s)",
			errOutboundTargetLIDUnavailable,
			logicalTarget,
			providerTarget,
			recipientPN,
		)
	}
	return whatsmeow.SendRequestExtra{PreResolvedRecipientPN: recipientPN}, nil
}

func (m *WhatsAppManager) withAuxiliaryProviderInvocationWatchdog(
	ctx context.Context,
	operationID string,
) context.Context {
	scope, ok := inboundConnectionScopeFromContext(ctx)
	if !ok || !scope.isValid() {
		return ctx
	}
	tracker := &providerTransportEffectTracker{}
	trackedCtx := withProviderTransportEffectTracker(ctx, tracker)
	return withProviderInvocationWatchdogFactory(
		trackedCtx,
		func() *providerInvocationWatchdog {
			return newProviderInvocationWatchdog(
				trackedCtx,
				m,
				scope,
				ChatMessage{MessageID: operationID},
				time.Now(),
				tracker,
				nil,
			)
		},
	)
}

func (m *WhatsAppManager) SendProfileStatusWithInvocationBoundary(ctx context.Context, data ProfileStatusMessage, boundary providerInvocationBoundary) (string, error) {
	if boundary == nil {
		return "", fmt.Errorf("provider invocation boundary is required")
	}
	opCtx, cancel := m.sendOperationContext(ctx)
	defer cancel()
	opCtx = withProviderAuthorizationGuard(opCtx, providerAuthorizationGuard(boundary))
	opCtx = m.withAuxiliaryProviderInvocationWatchdog(
		opCtx,
		"profile_status:"+firstNonEmpty(data.WorkerProfileStatusID, data.WorkerID),
	)

	if !m.IsReady() {
		return "", fmt.Errorf("%w: %s", ErrWhatsAppNotReady, m.outboundReadinessReason())
	}
	client := m.getClient()
	if client == nil {
		return "", fmt.Errorf("client is not initialized")
	}
	if len(data.StatusJIDList) > 0 {
		return "", UnsupportedFeatureError{Feature: "status_custom_audience"}
	}
	msg, err := m.buildProfileStatusMessage(opCtx, client, data)
	if err != nil {
		return "", err
	}
	resp, err := invokeProviderCallAtBoundary(opCtx, boundary, func(invokeCtx context.Context) (whatsmeow.SendResponse, error) {
		return client.SendMessage(invokeCtx, types.StatusBroadcastJID, msg)
	})
	if err != nil {
		return "", err
	}
	return string(resp.ID), nil
}

func (m *WhatsAppManager) DeleteProfileStatusWithInvocationBoundary(ctx context.Context, data ProfileStatusDeleteMessage, boundary providerInvocationBoundary) error {
	if boundary == nil {
		return fmt.Errorf("provider invocation boundary is required")
	}
	opCtx, cancel := m.sendOperationContext(ctx)
	defer cancel()
	opCtx = m.withAuxiliaryProviderInvocationWatchdog(
		opCtx,
		"profile_status_delete:"+firstNonEmpty(data.ExternalID, data.WorkerProfileStatusID),
	)

	if !m.IsReady() {
		return fmt.Errorf("%w: %s", ErrWhatsAppNotReady, m.outboundReadinessReason())
	}
	client := m.getClient()
	if client == nil {
		return fmt.Errorf("client is not initialized")
	}
	if strings.TrimSpace(data.ExternalID) == "" {
		return fmt.Errorf("%w: profile status external_id is required", errOutboundPayloadInvalid)
	}
	if len(data.StatusJIDList) > 0 {
		return UnsupportedFeatureError{Feature: "status_custom_audience"}
	}
	revoke := client.BuildRevoke(types.StatusBroadcastJID, types.EmptyJID, types.MessageID(data.ExternalID))
	_, err := invokeProviderCallAtBoundary(opCtx, boundary, func(invokeCtx context.Context) (whatsmeow.SendResponse, error) {
		return client.SendMessage(invokeCtx, types.StatusBroadcastJID, revoke)
	})
	return err
}

func (m *WhatsAppManager) UpdateProfileInfoWithInvocationBoundary(ctx context.Context, data ProfileInfoMessage, boundary providerInvocationBoundary) error {
	if boundary == nil {
		return fmt.Errorf("provider invocation boundary is required")
	}
	opCtx, cancel := m.sendOperationContext(ctx)
	defer cancel()
	opCtx = m.withAuxiliaryProviderInvocationWatchdog(
		opCtx,
		"profile_info:"+firstNonEmpty(data.WorkerID, m.cfg.WorkerID),
	)

	if !m.IsReady() {
		return fmt.Errorf("%w: %s", ErrWhatsAppNotReady, m.outboundReadinessReason())
	}
	client := m.getClient()
	if client == nil {
		return fmt.Errorf("client is not initialized")
	}
	if strings.TrimSpace(data.Name) != "" {
		name := strings.TrimSpace(data.Name)
		pushNamePatch := appstate.BuildSettingPushName(name)
		log.Printf("whatsmeow profile info updating name worker_id=%s", m.cfg.WorkerID)
		if err := invokeProviderErrorCallAtBoundary(opCtx, boundary, func(invokeCtx context.Context) error {
			return client.SendAppState(invokeCtx, pushNamePatch)
		}); err != nil {
			return fmt.Errorf("update profile name: %w", err)
		}
		client.Store.PushName = name
		if err := client.Store.Save(opCtx); err != nil {
			log.Printf("whatsmeow profile info local push name save failed worker_id=%s error_code=%s", m.cfg.WorkerID, safeOperationalErrorCode(err))
		}
		log.Printf("whatsmeow profile info name updated worker_id=%s", m.cfg.WorkerID)
	}
	if strings.TrimSpace(data.Message) != "" {
		log.Printf("whatsmeow profile info updating status worker_id=%s", m.cfg.WorkerID)
		if err := invokeProviderErrorCallAtBoundary(opCtx, boundary, func(invokeCtx context.Context) error {
			return client.SetStatusMessage(invokeCtx, data.Message)
		}); err != nil {
			return fmt.Errorf("update profile status: %w", err)
		}
		log.Printf("whatsmeow profile info status updated worker_id=%s", m.cfg.WorkerID)
	}
	if data.PhotoPresent {
		if client.Store.ID == nil {
			return fmt.Errorf("own profile jid is unavailable")
		}
		if data.PhotoRemove {
			log.Printf("whatsmeow profile info removing picture worker_id=%s jid_hash=%s", m.cfg.WorkerID, hashConnectionFlowIdentifier(client.Store.ID.String()))
			_, err := invokeProviderCallAtBoundary(opCtx, boundary, func(invokeCtx context.Context) (string, error) {
				return client.SetProfilePhoto(invokeCtx, nil)
			})
			if err != nil {
				return fmt.Errorf("remove profile picture: %w", err)
			}
			log.Printf("whatsmeow profile info picture removed worker_id=%s", m.cfg.WorkerID)
			return err
		}
		log.Printf("whatsmeow profile info updating picture worker_id=%s jid_hash=%s", m.cfg.WorkerID, hashConnectionFlowIdentifier(client.Store.ID.String()))
		body, contentType, _, err := downloadURL(opCtx, data.Photo)
		if err != nil {
			return fmt.Errorf("download profile picture: %w", err)
		}
		avatar, err := normalizeProfilePhotoJPEG(body, contentType)
		if err != nil {
			return fmt.Errorf("normalize profile picture: %w", err)
		}
		pictureID, err := invokeProviderCallAtBoundary(opCtx, boundary, func(invokeCtx context.Context) (string, error) {
			return client.SetProfilePhoto(invokeCtx, avatar)
		})
		if err != nil {
			return fmt.Errorf("update profile picture: %w", err)
		}
		log.Printf("whatsmeow profile info picture updated worker_id=%s picture_id_hash=%s bytes=%d", m.cfg.WorkerID, hashConnectionFlowIdentifier(pictureID), len(avatar))
	}
	return nil
}

func (m *WhatsAppManager) sendOperationContext(ctx context.Context) (context.Context, context.CancelFunc) {
	if m.cfg.SendTimeout <= 0 {
		operationCtx, cancel := context.WithCancel(ctx)
		return withProviderInvocationTimeout(
			operationCtx,
			defaultProviderInvocationTimeout,
		), cancel
	}
	operationCtx, cancel := context.WithTimeout(ctx, m.cfg.SendTimeout)
	return withProviderInvocationTimeout(operationCtx, m.cfg.SendTimeout), cancel
}

func (m *WhatsAppManager) logOutgoingSendDebug(stage string, data ChatMessage, target types.JID, externalID string, elapsed time.Duration, err error) {
	accountID := firstNonEmpty(stringValue(data.Account["id"]), m.cfg.AccountID)
	if !messageDebugEnabledForAccount(m.cfg, accountID) {
		return
	}
	textBytes := len([]byte(outgoingMessageTextPreview(data)))
	log.Printf(
		"message_debug direction=out stage=%s worker_id=%s account_id=%s message_id_hash=%s chat_id_hash=%s target_jid_hash=%s phone_hash=%s message_type=%s external_message_id_hash=%s elapsed_ms=%d timeout_ms=%d text_bytes=%d content_field_count=%d content_fields=%q error_code=%s",
		stage,
		m.cfg.WorkerID,
		accountID,
		hashConnectionFlowIdentifier(data.MessageID),
		hashConnectionFlowIdentifier(data.ChatID),
		hashConnectionFlowIdentifier(jidString(target)),
		hashConnectionFlowIdentifier(data.Phone),
		chatMessageType(data),
		hashConnectionFlowIdentifier(externalID),
		elapsed.Milliseconds(),
		m.cfg.SendTimeout.Milliseconds(),
		textBytes,
		len(data.Content),
		mapLogFieldNames(data.Content),
		safeOperationalErrorCode(err),
	)
}

func mapLogFieldNames(value map[string]any) []string {
	keys := make([]string, 0, len(value))
	for key := range value {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func messageDebugEnabledForAccount(cfg Config, accountID string) bool {
	enabled := envBoolDefault("MESSAGE_DEBUG_ENABLED", false) || envBoolDefault("WHATS_MEOW_MESSAGE_DEBUG_ENABLED", false)
	if !enabled {
		return false
	}

	accountID = firstNonEmpty(strings.TrimSpace(accountID), cfg.AccountID)
	return messageDebugFilterMatches("MESSAGE_DEBUG_ACCOUNT_IDS", accountID) &&
		messageDebugFilterMatches("MESSAGE_DEBUG_WORKER_IDS", cfg.WorkerID)
}

func messageDebugFilterMatches(key string, value string) bool {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return true
	}
	value = strings.TrimSpace(value)
	if value == "" {
		return false
	}
	for _, item := range strings.Split(raw, ",") {
		normalized := strings.TrimSpace(item)
		if normalized == "*" || normalized == value {
			return true
		}
	}
	return false
}

func outgoingMessageTextPreview(data ChatMessage) string {
	candidates := []string{
		stringValue(data.Content["message"]),
		stringValue(asMap(data.Content["image"])["caption"]),
		stringValue(asMap(data.Content["video"])["caption"]),
		stringValue(asMap(data.Content["document"])["caption"]),
		stringValue(asMap(data.Content["document"])["file_name"]),
		stringValue(asMap(data.Content["document"])["filename"]),
	}
	for _, candidate := range candidates {
		candidate = strings.TrimSpace(candidate)
		if candidate != "" {
			return candidate
		}
	}
	return ""
}

func normalizeProfilePhotoJPEG(body []byte, contentType string) ([]byte, error) {
	if len(body) == 0 {
		return nil, fmt.Errorf("%w: profile picture is empty", errOutboundPayloadInvalid)
	}
	img, format, err := image.Decode(bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	bounds := img.Bounds()
	width := bounds.Dx()
	height := bounds.Dy()
	if width <= 0 || height <= 0 {
		return nil, fmt.Errorf("%w: profile picture has invalid dimensions", errOutboundPayloadInvalid)
	}

	side := width
	if height < side {
		side = height
	}
	cropX := bounds.Min.X + (width-side)/2
	cropY := bounds.Min.Y + (height-side)/2
	size := 640
	dst := image.NewRGBA(image.Rect(0, 0, size, size))
	for y := 0; y < size; y++ {
		srcY := cropY + y*side/size
		for x := 0; x < size; x++ {
			srcX := cropX + x*side/size
			dst.Set(x, y, img.At(srcX, srcY))
		}
	}

	var out bytes.Buffer
	if err := jpeg.Encode(&out, dst, &jpeg.Options{Quality: 90}); err != nil {
		return nil, err
	}
	log.Printf("whatsmeow profile picture normalized format=%s content_type=%s input_bytes=%d output_bytes=%d size=%d", format, contentType, len(body), out.Len(), size)
	return out.Bytes(), nil
}

func (m *WhatsAppManager) buildProfileStatusMessage(ctx context.Context, client *whatsmeow.Client, data ProfileStatusMessage) (*waE2E.Message, error) {
	url, caption := splitStatusValue(data.Value)
	switch data.WorkerProfileStatusTypeID {
	case WorkerProfileStatusTypeText:
		text := strings.TrimSpace(data.Value)
		if text == "" {
			return nil, fmt.Errorf("%w: profile status text is required", errOutboundPayloadInvalid)
		}
		return &waE2E.Message{Conversation: proto.String(text)}, nil
	case WorkerProfileStatusTypeImage:
		return m.buildMediaMessage(ctx, client, ChatMessage{
			Content: map[string]any{
				"type": MessageTypeImage,
				"image": map[string]any{
					"url":     url,
					"caption": caption,
				},
			},
		}, whatsmeow.MediaImage, "image", nil)
	case WorkerProfileStatusTypeVideo:
		return m.buildMediaMessage(ctx, client, ChatMessage{
			Content: map[string]any{
				"type": MessageTypeVideo,
				"video": map[string]any{
					"url":     url,
					"caption": caption,
				},
			},
		}, whatsmeow.MediaVideo, "video", nil)
	case WorkerProfileStatusTypeAudio:
		return m.buildMediaMessage(ctx, client, ChatMessage{
			Content: map[string]any{
				"type": MessageTypeAudio,
				"audio": map[string]any{
					"url": url,
				},
			},
		}, whatsmeow.MediaAudio, "audio", nil)
	default:
		return nil, UnsupportedFeatureError{Feature: "profile_status_type"}
	}
}

func (m *WhatsAppManager) buildOutgoingMessage(ctx context.Context, client *whatsmeow.Client, target types.JID, data ChatMessage) (*waE2E.Message, error) {
	contentType := stringValue(data.Content["type"])
	if contentType == "" {
		contentType = MessageTypeText
	}

	if unsupported := firstUnsupportedContent(data.Content); unsupported != "" {
		return nil, UnsupportedFeatureError{Feature: unsupported}
	}

	if isTextEditMessage(data, contentType) {
		log.Printf("whatsmeow edit message requested worker_id=%s message_id_hash=%s target_key_id_hash=%s", m.cfg.WorkerID, hashConnectionFlowIdentifier(data.MessageID), hashConnectionFlowIdentifier(data.MessageKey.ID))
		return buildTextEditMessage(client, target, data)
	}

	contextInfo := buildContextInfo(data)
	switch contentType {
	case MessageTypeText, MessageTypeSystem:
		text := stringValue(data.Content["message"])
		if ext := buildExtendedTextMessage(text, data, contextInfo); ext != nil {
			return &waE2E.Message{ExtendedTextMessage: ext}, nil
		}
		return &waE2E.Message{Conversation: proto.String(text)}, nil
	case MessageTypeEditText:
		if data.MessageKey == nil || data.MessageKey.ID == "" {
			return nil, fmt.Errorf("%w: edit_text requires message_key.id", errOutboundPayloadInvalid)
		}
		return client.BuildEdit(target, data.MessageKey.ID, &waE2E.Message{
			Conversation: proto.String(stringValue(data.Content["message"])),
		}), nil
	case MessageTypeDelete:
		if data.MessageKey == nil || data.MessageKey.ID == "" {
			return nil, fmt.Errorf("%w: delete_message requires message_key.id", errOutboundPayloadInvalid)
		}
		return client.BuildRevoke(target, senderJIDFromKey(target, data.MessageKey), data.MessageKey.ID), nil
	case MessageTypeReact:
		if data.MessageKey == nil || data.MessageKey.ID == "" {
			return nil, fmt.Errorf("%w: react requires message_key.id", errOutboundPayloadInvalid)
		}
		emoji := stringValue(data.Content["message"])
		if emoji == "" {
			if reactions, ok := data.Content["reactions"].([]any); ok && len(reactions) > 0 {
				emoji = stringValue(asMap(reactions[len(reactions)-1])["emoji"])
			}
		}
		return client.BuildReaction(target, senderJIDFromKey(target, data.MessageKey), data.MessageKey.ID, emoji), nil
	case MessageTypeImage:
		return m.buildMediaMessage(ctx, client, data, whatsmeow.MediaImage, "image", contextInfo)
	case MessageTypeVideo, MessageTypeVideoNote:
		return m.buildMediaMessage(ctx, client, data, whatsmeow.MediaVideo, "video", contextInfo)
	case MessageTypeAudio:
		return m.buildMediaMessage(ctx, client, data, whatsmeow.MediaAudio, "audio", contextInfo)
	case MessageTypeDocument:
		return m.buildMediaMessage(ctx, client, data, whatsmeow.MediaDocument, "document", contextInfo)
	case MessageTypeSticker:
		return m.buildMediaMessage(ctx, client, data, whatsmeow.MediaImage, "sticker", contextInfo)
	case MessageTypeLocation:
		location := asMap(data.Content["location"])
		lat := floatValue(location["latitude"])
		lng := floatValue(location["longitude"])
		if lat == 0 && lng == 0 {
			lat = floatValue(location["degreesLatitude"])
			lng = floatValue(location["degreesLongitude"])
		}
		return &waE2E.Message{LocationMessage: &waE2E.LocationMessage{
			DegreesLatitude:  proto.Float64(lat),
			DegreesLongitude: proto.Float64(lng),
			Name:             proto.String(stringValue(location["name"])),
			Address:          proto.String(stringValue(location["address"])),
			ContextInfo:      contextInfo,
		}}, nil
	case MessageTypeContact:
		contact := asMap(data.Content["contact"])
		return &waE2E.Message{ContactMessage: buildContactMessage(contact, contextInfo)}, nil
	case MessageTypeContacts:
		contactsRaw, _ := data.Content["contacts"].([]any)
		contacts := make([]*waE2E.ContactMessage, 0, len(contactsRaw))
		for _, item := range contactsRaw {
			contacts = append(contacts, buildContactMessage(asMap(item), nil))
		}
		return &waE2E.Message{ContactsArrayMessage: &waE2E.ContactsArrayMessage{
			DisplayName: proto.String("Contacts"),
			Contacts:    contacts,
			ContextInfo: contextInfo,
		}}, nil
	default:
		return nil, UnsupportedFeatureError{Feature: contentType}
	}
}

func isTextEditMessage(data ChatMessage, contentType string) bool {
	if contentType != MessageTypeText {
		return false
	}
	if data.MessageKey == nil || data.MessageKey.ID == "" {
		return false
	}
	return len(versionItems(data.Content["version"])) > 0
}

func buildTextEditMessage(client *whatsmeow.Client, target types.JID, data ChatMessage) (*waE2E.Message, error) {
	if data.MessageKey == nil || data.MessageKey.ID == "" {
		return nil, fmt.Errorf("%w: edit_text requires message_key.id", errOutboundPayloadInvalid)
	}
	if !data.MessageKey.FromMeValue() {
		return nil, fmt.Errorf("%w: message edit is not allowed for non-own message", errOutboundPayloadInvalid)
	}
	newText := firstNonEmpty(latestVersionMessage(data.Content["version"]), stringValue(data.Content["message"]))
	if newText == "" {
		return nil, fmt.Errorf("%w: edit_text requires message", errOutboundPayloadInvalid)
	}
	return client.BuildEdit(target, data.MessageKey.ID, &waE2E.Message{
		Conversation: proto.String(newText),
	}), nil
}

func latestVersionMessage(value any) string {
	versions := versionItems(value)
	if len(versions) == 0 {
		return ""
	}
	latestIndex := -1
	latestTime := time.Time{}
	for index, item := range versions {
		message := stringValue(item["message"])
		if message == "" {
			continue
		}
		parsedTime, _ := time.Parse(time.RFC3339Nano, stringValue(item["date"]))
		if latestIndex == -1 || parsedTime.After(latestTime) || (parsedTime.IsZero() && latestTime.IsZero() && index > latestIndex) {
			latestIndex = index
			latestTime = parsedTime
		}
	}
	if latestIndex < 0 {
		return ""
	}
	return stringValue(versions[latestIndex]["message"])
}

func versionItems(value any) []map[string]any {
	switch typed := value.(type) {
	case []map[string]any:
		return typed
	case []any:
		items := make([]map[string]any, 0, len(typed))
		for _, item := range typed {
			mapped := asMap(item)
			if len(mapped) > 0 {
				items = append(items, mapped)
			}
		}
		return items
	default:
		return nil
	}
}

func (m *WhatsAppManager) buildMediaMessage(ctx context.Context, client *whatsmeow.Client, data ChatMessage, mediaType whatsmeow.MediaType, contentKey string, contextInfo *waE2E.ContextInfo) (*waE2E.Message, error) {
	media := asMap(data.Content[contentKey])
	url := stringValue(media["url"])
	if url == "" {
		return nil, fmt.Errorf("%w: %s url is required", errOutboundPayloadInvalid, contentKey)
	}
	body, contentType, fileName, err := downloadURL(ctx, url)
	if err != nil {
		return nil, fmt.Errorf("download media %s: %w", contentKey, err)
	}
	httpContentType := contentType
	if name := firstNonEmpty(stringValue(media["name"]), stringValue(media["filename"]), stringValue(media["fileName"])); name != "" {
		fileName = name
	}
	upload, err := invokeProviderAuthorizedCall(ctx, providerAuthorizationGuardFromContext(ctx), func(invokeCtx context.Context) (whatsmeow.UploadResponse, error) {
		return client.Upload(invokeCtx, body, mediaType)
	})
	if err != nil {
		return nil, fmt.Errorf("upload media %s: %w", contentKey, err)
	}
	now := time.Now().Unix()
	caption := firstNonEmpty(stringValue(media["caption"]), stringValue(data.Content["message"]))
	viewOnce := boolValue(media["is_view_once"]) || boolValue(media["view_once"]) || boolValue(data.Content["is_view_once"])

	switch contentKey {
	case "image":
		mimetype := outgoingMediaMimetype(contentKey, media, httpContentType, false)
		return &waE2E.Message{ImageMessage: &waE2E.ImageMessage{
			URL:               proto.String(upload.URL),
			DirectPath:        proto.String(upload.DirectPath),
			Mimetype:          proto.String(mimetype),
			Caption:           proto.String(caption),
			MediaKey:          upload.MediaKey,
			FileEncSHA256:     upload.FileEncSHA256,
			FileSHA256:        upload.FileSHA256,
			FileLength:        proto.Uint64(upload.FileLength),
			MediaKeyTimestamp: proto.Int64(now),
			ContextInfo:       contextInfo,
			ViewOnce:          proto.Bool(viewOnce),
		}}, nil
	case "video":
		mimetype := outgoingMediaMimetype(contentKey, media, httpContentType, false)
		video := &waE2E.VideoMessage{
			URL:               proto.String(upload.URL),
			DirectPath:        proto.String(upload.DirectPath),
			Mimetype:          proto.String(mimetype),
			Caption:           proto.String(caption),
			MediaKey:          upload.MediaKey,
			FileEncSHA256:     upload.FileEncSHA256,
			FileSHA256:        upload.FileSHA256,
			FileLength:        proto.Uint64(upload.FileLength),
			MediaKeyTimestamp: proto.Int64(now),
			ContextInfo:       contextInfo,
			ViewOnce:          proto.Bool(viewOnce),
		}
		if data.Content["type"] == MessageTypeVideoNote {
			return &waE2E.Message{PtvMessage: video}, nil
		}
		return &waE2E.Message{VideoMessage: video}, nil
	case "audio":
		ptt := outgoingAudioPTT(media, viewOnce)
		duration := uint32Value(firstNonEmptyAny(media["duration"], media["seconds"]))
		waveform := outgoingAudioWaveform(media, ptt)
		mimetype := outgoingMediaMimetype(contentKey, media, httpContentType, ptt)
		return &waE2E.Message{AudioMessage: &waE2E.AudioMessage{
			URL:               proto.String(upload.URL),
			DirectPath:        proto.String(upload.DirectPath),
			Mimetype:          proto.String(mimetype),
			MediaKey:          upload.MediaKey,
			FileEncSHA256:     upload.FileEncSHA256,
			FileSHA256:        upload.FileSHA256,
			FileLength:        proto.Uint64(upload.FileLength),
			Seconds:           proto.Uint32(duration),
			MediaKeyTimestamp: proto.Int64(now),
			ContextInfo:       contextInfo,
			PTT:               proto.Bool(ptt),
			Waveform:          waveform,
			ViewOnce:          proto.Bool(viewOnce),
		}}, nil
	case "document":
		mimetype := outgoingMediaMimetype(contentKey, media, httpContentType, false)
		return &waE2E.Message{DocumentMessage: &waE2E.DocumentMessage{
			URL:               proto.String(upload.URL),
			DirectPath:        proto.String(upload.DirectPath),
			Mimetype:          proto.String(mimetype),
			Title:             proto.String(firstNonEmpty(stringValue(media["title"]), fileName)),
			FileName:          proto.String(fileName),
			Caption:           proto.String(caption),
			MediaKey:          upload.MediaKey,
			FileEncSHA256:     upload.FileEncSHA256,
			FileSHA256:        upload.FileSHA256,
			FileLength:        proto.Uint64(upload.FileLength),
			MediaKeyTimestamp: proto.Int64(now),
			ContextInfo:       contextInfo,
		}}, nil
	case "sticker":
		mimetype := outgoingMediaMimetype(contentKey, media, httpContentType, false)
		return &waE2E.Message{StickerMessage: &waE2E.StickerMessage{
			URL:               proto.String(upload.URL),
			DirectPath:        proto.String(upload.DirectPath),
			Mimetype:          proto.String(mimetype),
			MediaKey:          upload.MediaKey,
			FileEncSHA256:     upload.FileEncSHA256,
			FileSHA256:        upload.FileSHA256,
			FileLength:        proto.Uint64(upload.FileLength),
			MediaKeyTimestamp: proto.Int64(now),
			ContextInfo:       contextInfo,
			IsAnimated:        proto.Bool(boolValue(media["is_animated"])),
		}}, nil
	default:
		return nil, UnsupportedFeatureError{Feature: contentKey}
	}
}

func outgoingMediaMimetype(contentKey string, media map[string]any, httpContentType string, ptt bool) string {
	switch contentKey {
	case "video":
		return "video/mp4"
	case "audio":
		if ptt {
			return "audio/ogg; codecs=opus"
		}
		return "audio/mpeg"
	}

	if mimetype := usableOutgoingMimetype(stringValue(media["mimetype"])); mimetype != "" {
		return mimetype
	}
	if mimetype := usableOutgoingMimetype(httpContentType); mimetype != "" {
		return mimetype
	}

	switch contentKey {
	case "image":
		return "image/jpeg"
	case "document":
		return "application/octet-stream"
	case "sticker":
		return "image/webp"
	default:
		return "application/octet-stream"
	}
}

func usableOutgoingMimetype(value string) string {
	mimetype := strings.TrimSpace(value)
	if mimetype == "" {
		return ""
	}
	base := strings.ToLower(strings.TrimSpace(strings.Split(mimetype, ";")[0]))
	switch base {
	case "application/octet-stream", "binary/octet-stream":
		return ""
	default:
		return mimetype
	}
}

func (m *WhatsAppManager) incomingContent(ctx context.Context, evt *events.Message) (string, map[string]any) {
	msg, wrappedViewOnce := unwrapIncomingMessage(evt.Message)
	if msg == nil {
		return "", nil
	}
	if incomingHasEditSignal(evt, msg) {
		m.logIncomingProviderDebug("incoming.edit_signal", evt)
	}
	if incomingIsSecretMessageEdit(msg) {
		return m.incomingSecretEncryptedContent(ctx, evt, msg)
	}
	viewOnce := evt.IsViewOnce || evt.IsViewOnceV2 || evt.IsViewOnceV2Extension || wrappedViewOnce
	if viewOnce {
		return m.withIncomingQuoted(evt, msg, MessageTypeViewOnce, map[string]any{"type": MessageTypeViewOnce})
	}
	base := map[string]any{}
	if messageType, content := m.incomingEditedContent(evt, msg); messageType != "" {
		return messageType, content
	}
	if text := msg.GetConversation(); text != "" {
		return m.withIncomingQuoted(evt, msg, MessageTypeText, map[string]any{"type": MessageTypeText, "message": text})
	}
	if ext := msg.GetExtendedTextMessage(); ext != nil {
		return m.withIncomingQuoted(evt, msg, MessageTypeText, map[string]any{"type": MessageTypeText, "message": ext.GetText()})
	}
	if protocolMsg := msg.GetProtocolMessage(); protocolMsg != nil {
		if protocolMsg.Type == nil {
			return m.unsupportedIncomingFallback(evt, msg, "incoming.protocol_unknown_type")
		}
		switch protocolMsg.GetType() {
		case waE2E.ProtocolMessage_REVOKE:
			return m.withIncomingQuoted(evt, msg, MessageTypeDelete, map[string]any{"type": MessageTypeDelete, "message": "Mensagem apagada"})
		case waE2E.ProtocolMessage_MESSAGE_EDIT:
			edited := protocolMsg.GetEditedMessage()
			if edited == nil {
				return m.unsupportedIncomingFallback(evt, msg, "incoming.protocol_edit_without_payload")
			}
			message := edited.GetConversation()
			if message == "" && edited.GetExtendedTextMessage() != nil {
				message = edited.GetExtendedTextMessage().GetText()
			}
			return m.withIncomingQuoted(evt, msg, MessageTypeEditText, map[string]any{"type": MessageTypeEditText, "message": message})
		case waE2E.ProtocolMessage_EPHEMERAL_SETTING, waE2E.ProtocolMessage_EPHEMERAL_SYNC_RESPONSE:
			return m.withIncomingQuoted(evt, msg, MessageTypeSetDisappearingMessages, map[string]any{"type": MessageTypeSetDisappearingMessages})
		case waE2E.ProtocolMessage_HISTORY_SYNC_NOTIFICATION:
			return "", nil
		default:
			return m.unsupportedIncomingFallback(evt, msg, "incoming.protocol_unsupported")
		}
	}
	if reaction := msg.GetReactionMessage(); reaction != nil {
		return m.withIncomingQuoted(evt, msg, MessageTypeReact, map[string]any{
			"type":    MessageTypeReact,
			"message": reaction.GetText(),
			"reactions": []map[string]any{{
				"emoji": reaction.GetText(),
			}},
		})
	}
	if msg.GetEncReactionMessage() != nil {
		return m.withIncomingQuoted(evt, msg, MessageTypeReact, map[string]any{"type": MessageTypeReact, "message": ""})
	}
	if msg.GetPinInChatMessage() != nil {
		return m.withIncomingQuoted(evt, msg, MessageTypeSystem, map[string]any{"type": MessageTypeSystem, "message": ""})
	}
	if interactive := msg.GetInteractiveMessage(); interactive != nil {
		if content := incomingInteractiveCtaURLContent(interactive); content != nil {
			return m.withIncomingQuoted(evt, msg, MessageTypeText, content)
		}
	}
	if template := msg.GetTemplateMessage(); template != nil {
		if content := incomingTemplateContent(template); content != nil {
			return m.withIncomingQuoted(evt, msg, MessageTypeOfficialTemplate, content)
		}
	}
	if hsm := msg.GetHighlyStructuredMessage(); hsm != nil {
		if content := incomingTemplateContent(hsm.GetHydratedHsm()); content != nil {
			return m.withIncomingQuoted(evt, msg, MessageTypeOfficialTemplate, content)
		}
	}
	if buttons := msg.GetButtonsMessage(); buttons != nil {
		content := incomingButtonsContent(buttons)
		return m.withIncomingQuoted(evt, msg, MessageTypeText, content)
	}
	if response := msg.GetButtonsResponseMessage(); response != nil {
		text := firstNonEmpty(response.GetSelectedDisplayText(), response.GetSelectedButtonID())
		return m.withIncomingQuoted(evt, msg, MessageTypeText, map[string]any{"type": MessageTypeText, "message": text})
	}
	if list := msg.GetListMessage(); list != nil {
		content := incomingListContent(list)
		return m.withIncomingQuoted(evt, msg, MessageTypeText, content)
	}
	if response := msg.GetListResponseMessage(); response != nil {
		content := incomingListResponseContent(response)
		return m.withIncomingQuoted(evt, msg, MessageTypeText, content)
	}
	if image := msg.GetImageMessage(); image != nil {
		base = mediaContent(ctx, m, image, MessageTypeImage, image.GetCaption(), image.GetMimetype(), viewOnce)
		enrichIncomingAlbumContent(base, msg)
		return m.withIncomingQuoted(evt, msg, MessageTypeImage, base)
	}
	if video := msg.GetVideoMessage(); video != nil {
		base = mediaContent(ctx, m, video, MessageTypeVideo, video.GetCaption(), video.GetMimetype(), viewOnce)
		return m.withIncomingQuoted(evt, msg, MessageTypeVideo, base)
	}
	if video := msg.GetPtvMessage(); video != nil {
		base = mediaContent(ctx, m, video, MessageTypeVideoNote, video.GetCaption(), video.GetMimetype(), viewOnce)
		return m.withIncomingQuoted(evt, msg, MessageTypeVideoNote, base)
	}
	if audio := msg.GetAudioMessage(); audio != nil {
		base = mediaContent(ctx, m, audio, MessageTypeAudio, "", audio.GetMimetype(), viewOnce)
		if audio.GetPTT() {
			asMap(base["audio"])["ptt"] = true
		}
		return m.withIncomingQuoted(evt, msg, MessageTypeAudio, base)
	}
	if doc := msg.GetDocumentMessage(); doc != nil {
		base = mediaContent(ctx, m, doc, MessageTypeDocument, doc.GetCaption(), doc.GetMimetype(), viewOnce)
		asMap(base["document"])["name"] = firstNonEmpty(doc.GetFileName(), doc.GetTitle())
		return m.withIncomingQuoted(evt, msg, MessageTypeDocument, base)
	}
	if sticker := msg.GetStickerMessage(); sticker != nil {
		base = mediaContent(ctx, m, sticker, MessageTypeSticker, "", sticker.GetMimetype(), viewOnce)
		asMap(base["sticker"])["is_animated"] = sticker.GetIsAnimated()
		asMap(base["sticker"])["is_lottie"] = sticker.GetIsLottie()
		return m.withIncomingQuoted(evt, msg, MessageTypeSticker, base)
	}
	if loc := msg.GetLocationMessage(); loc != nil {
		return m.withIncomingQuoted(evt, msg, MessageTypeLocation, map[string]any{
			"type": MessageTypeLocation,
			"location": map[string]any{
				"latitude":  loc.GetDegreesLatitude(),
				"longitude": loc.GetDegreesLongitude(),
				"name":      loc.GetName(),
				"address":   loc.GetAddress(),
			},
		})
	}
	if contact := msg.GetContactMessage(); contact != nil {
		return m.withIncomingQuoted(evt, msg, MessageTypeContact, map[string]any{
			"type":    MessageTypeContact,
			"contact": parseVCard(contact.GetDisplayName(), contact.GetVcard()),
		})
	}
	if contacts := msg.GetContactsArrayMessage(); contacts != nil {
		items := make([]map[string]any, 0, len(contacts.GetContacts()))
		for _, contact := range contacts.GetContacts() {
			items = append(items, parseVCard(contact.GetDisplayName(), contact.GetVcard()))
		}
		return m.withIncomingQuoted(evt, msg, MessageTypeContacts, map[string]any{"type": MessageTypeContacts, "contacts": items})
	}
	return m.unsupportedIncomingFallback(evt, msg, "incoming.unknown_message_type")
}

// incomingHistoryContent deliberately avoids Download and storage Upload.
// History records are deduplicated downstream, so replaying media bytes here
// would amplify reconnects into provider/storage storms before deduplication.
// The historical payload keeps its media type and lightweight metadata; a live
// delivery remains the authoritative path for the attachment URL.
func (m *WhatsAppManager) incomingHistoryContent(ctx context.Context, evt *events.Message) (string, map[string]any) {
	if evt == nil {
		return "", nil
	}
	msg, wrappedViewOnce := unwrapIncomingMessage(evt.Message)
	if msg == nil {
		return "", nil
	}
	viewOnce := evt.IsViewOnce || evt.IsViewOnceV2 || evt.IsViewOnceV2Extension || wrappedViewOnce

	if image := msg.GetImageMessage(); image != nil {
		content := historyMediaContent(image, MessageTypeImage, image.GetCaption(), image.GetMimetype(), viewOnce)
		enrichIncomingAlbumContent(content, msg)
		return m.withIncomingHistoryMedia(evt, msg, MessageTypeImage, content, viewOnce)
	}
	if video := msg.GetVideoMessage(); video != nil {
		return m.withIncomingHistoryMedia(evt, msg, MessageTypeVideo, historyMediaContent(video, MessageTypeVideo, video.GetCaption(), video.GetMimetype(), viewOnce), viewOnce)
	}
	if video := msg.GetPtvMessage(); video != nil {
		return m.withIncomingHistoryMedia(evt, msg, MessageTypeVideoNote, historyMediaContent(video, MessageTypeVideoNote, video.GetCaption(), video.GetMimetype(), viewOnce), viewOnce)
	}
	if audio := msg.GetAudioMessage(); audio != nil {
		return m.withIncomingHistoryMedia(evt, msg, MessageTypeAudio, historyMediaContent(audio, MessageTypeAudio, "", audio.GetMimetype(), viewOnce), viewOnce)
	}
	if document := msg.GetDocumentMessage(); document != nil {
		return m.withIncomingHistoryMedia(evt, msg, MessageTypeDocument, historyMediaContent(document, MessageTypeDocument, document.GetCaption(), document.GetMimetype(), viewOnce), viewOnce)
	}
	if sticker := msg.GetStickerMessage(); sticker != nil {
		return m.withIncomingHistoryMedia(evt, msg, MessageTypeSticker, historyMediaContent(sticker, MessageTypeSticker, "", sticker.GetMimetype(), viewOnce), viewOnce)
	}
	return m.incomingContent(ctx, evt)
}

func (m *WhatsAppManager) withIncomingHistoryMedia(
	evt *events.Message,
	msg *waE2E.Message,
	mediaType string,
	content map[string]any,
	viewOnce bool,
) (string, map[string]any) {
	messageType := mediaType
	if viewOnce {
		messageType = MessageTypeViewOnce
		content["type"] = MessageTypeViewOnce
		content["media_type"] = mediaType
	}
	return m.withIncomingQuoted(evt, msg, messageType, content)
}

func historyMediaContent(media whatsmeow.DownloadableMessage, messageType, caption, mimetype string, viewOnce bool) map[string]any {
	key := messageType
	if messageType == MessageTypeVideoNote {
		key = "video"
	}
	entry := map[string]any{
		"caption":               caption,
		"mimetype":              mimetype,
		"is_view_once":          viewOnce,
		"view_once":             viewOnce,
		"history_media_omitted": true,
	}
	enrichHistoryMediaMetadata(entry, media)
	return map[string]any{
		"type":                  messageType,
		"history_media_omitted": true,
		key:                     entry,
	}
}

func enrichHistoryMediaMetadata(entry map[string]any, media whatsmeow.DownloadableMessage) {
	switch msg := media.(type) {
	case *waE2E.ImageMessage:
		setPositiveNumber(entry, "height", msg.GetHeight())
		setPositiveNumber(entry, "width", msg.GetWidth())
		setPositiveUint64(entry, "size", msg.GetFileLength())
	case *waE2E.VideoMessage:
		setPositiveNumber(entry, "height", msg.GetHeight())
		setPositiveNumber(entry, "width", msg.GetWidth())
		setPositiveNumber(entry, "duration", msg.GetSeconds())
		setPositiveUint64(entry, "size", msg.GetFileLength())
	case *waE2E.AudioMessage:
		setPositiveNumber(entry, "duration", msg.GetSeconds())
		setPositiveUint64(entry, "size", msg.GetFileLength())
		entry["ptt"] = msg.GetPTT()
	case *waE2E.DocumentMessage:
		if name := firstNonEmpty(msg.GetFileName(), msg.GetTitle()); name != "" {
			entry["name"] = name
		}
		setPositiveUint64(entry, "size", msg.GetFileLength())
	case *waE2E.StickerMessage:
		setPositiveNumber(entry, "height", msg.GetHeight())
		setPositiveNumber(entry, "width", msg.GetWidth())
		setPositiveUint64(entry, "size", msg.GetFileLength())
		entry["is_animated"] = msg.GetIsAnimated()
		entry["is_lottie"] = msg.GetIsLottie()
	}
}

func setPositiveUint64(entry map[string]any, key string, value uint64) {
	if value > 0 {
		entry[key] = value
	}
}

func incomingButtonsContent(buttons *waE2E.ButtonsMessage) map[string]any {
	options := make([]map[string]any, 0, len(buttons.GetButtons()))
	for _, button := range buttons.GetButtons() {
		if button == nil || button.GetButtonText().GetDisplayText() == "" {
			continue
		}

		options = append(options, map[string]any{
			"id":           emptyStringAsNil(button.GetButtonID()),
			"display_text": button.GetButtonText().GetDisplayText(),
			"type":         int(button.GetType()),
		})
	}

	return map[string]any{
		"type":    MessageTypeText,
		"message": buttons.GetContentText(),
		"buttons": map[string]any{
			"text":        emptyStringAsNil(buttons.GetContentText()),
			"footer":      emptyStringAsNil(buttons.GetFooterText()),
			"header":      emptyStringAsNil(buttons.GetText()),
			"header_type": int(buttons.GetHeaderType()),
			"buttons":     options,
		},
	}
}

func incomingListContent(list *waE2E.ListMessage) map[string]any {
	payload := listContentPayload(list)
	return map[string]any{
		"type":    MessageTypeText,
		"message": emptyStringAsNil(list.GetDescription()),
		"list":    payload,
	}
}

func listContentPayload(list *waE2E.ListMessage) map[string]any {
	sections := make([]map[string]any, 0, len(list.GetSections()))
	for sectionIndex, section := range list.GetSections() {
		if section == nil {
			continue
		}

		rows := make([]map[string]any, 0, len(section.GetRows()))
		for _, row := range section.GetRows() {
			if row == nil || strings.TrimSpace(row.GetTitle()) == "" {
				continue
			}

			rows = append(rows, map[string]any{
				"id":          emptyStringAsNil(row.GetRowID()),
				"title":       row.GetTitle(),
				"description": emptyStringAsNil(row.GetDescription()),
			})
		}
		if len(rows) == 0 {
			continue
		}

		sections = append(sections, map[string]any{
			"id":    fmt.Sprintf("section-%d", sectionIndex+1),
			"title": emptyStringAsNil(section.GetTitle()),
			"rows":  rows,
		})
	}

	return map[string]any{
		"text":        emptyStringAsNil(list.GetDescription()),
		"button_text": emptyStringAsNil(list.GetButtonText()),
		"list_type":   int(list.GetListType()),
		"sections":    sections,
	}
}

func incomingListResponseContent(response *waE2E.ListResponseMessage) map[string]any {
	id := response.GetSingleSelectReply().GetSelectedRowID()
	title := firstNonEmpty(response.GetTitle(), id)
	description := response.GetDescription()

	return map[string]any{
		"type":    MessageTypeText,
		"message": title,
		"official": map[string]any{
			"provider": "meta_whatsapp",
			"type":     "interactive",
			"display": map[string]any{
				"kind":     "reply",
				"raw_type": "list_reply",
				"title":    title,
				"body":     emptyStringAsNil(description),
				"actions": []map[string]any{{
					"id":          emptyStringAsNil(id),
					"type":        "list_reply",
					"title":       title,
					"description": emptyStringAsNil(description),
				}},
			},
			"raw": map[string]any{
				"type": "list_response",
				"list_response": map[string]any{
					"id":          emptyStringAsNil(id),
					"title":       title,
					"description": emptyStringAsNil(description),
				},
			},
		},
	}
}

func incomingInteractiveCtaURLContent(interactive *waE2E.InteractiveMessage) map[string]any {
	nativeFlow := interactive.GetNativeFlowMessage()
	if nativeFlow == nil {
		return nil
	}

	for _, button := range nativeFlow.GetButtons() {
		if button == nil || strings.ToLower(strings.TrimSpace(button.GetName())) != "cta_url" {
			continue
		}

		params := map[string]any{}
		if err := json.Unmarshal([]byte(button.GetButtonParamsJSON()), &params); err != nil {
			continue
		}

		url := stringValue(params["url"])
		if url == "" {
			continue
		}

		displayText := firstNonEmpty(
			stringValue(params["display_text"]),
			stringValue(params["displayText"]),
			stringValue(params["title"]),
			stringValue(params["text"]),
			"Abrir link",
		)
		body := interactive.GetBody().GetText()
		message := firstNonEmpty(body, displayText)

		return map[string]any{
			"type":    MessageTypeText,
			"message": message,
			"official": map[string]any{
				"provider": "meta_whatsapp",
				"type":     "interactive",
				"display": map[string]any{
					"kind":         "cta_url",
					"raw_type":     "cta_url",
					"body":         emptyStringAsNil(body),
					"action_label": displayText,
					"actions": []map[string]any{{
						"type":  "cta_url",
						"title": displayText,
						"url":   url,
					}},
				},
				"raw": map[string]any{
					"type": "interactive",
					"interactive": map[string]any{
						"body": map[string]any{
							"text": body,
						},
						"nativeFlowMessage": map[string]any{
							"buttons": []map[string]any{{
								"name":             button.GetName(),
								"buttonParamsJSON": button.GetButtonParamsJSON(),
							}},
						},
					},
				},
			},
		}
	}

	return nil
}

func incomingTemplateButton(button *waE2E.HydratedTemplateButton) map[string]any {
	if button == nil {
		return nil
	}
	if quickReply := button.GetQuickReplyButton(); quickReply != nil {
		text := strings.TrimSpace(quickReply.GetDisplayText())
		if text == "" {
			return nil
		}
		return map[string]any{
			"type": "QUICK_REPLY",
			"text": text,
		}
	}
	if urlButton := button.GetUrlButton(); urlButton != nil {
		text := strings.TrimSpace(urlButton.GetDisplayText())
		url := strings.TrimSpace(urlButton.GetURL())
		if text == "" && url == "" {
			return nil
		}
		return map[string]any{
			"type": "URL",
			"text": emptyStringAsNil(text),
			"url":  emptyStringAsNil(url),
		}
	}
	if callButton := button.GetCallButton(); callButton != nil {
		text := strings.TrimSpace(callButton.GetDisplayText())
		phoneNumber := strings.TrimSpace(callButton.GetPhoneNumber())
		if text == "" && phoneNumber == "" {
			return nil
		}
		return map[string]any{
			"type":         "PHONE_NUMBER",
			"text":         emptyStringAsNil(text),
			"phone_number": emptyStringAsNil(phoneNumber),
		}
	}
	return nil
}

func incomingTemplateButtons(buttons []*waE2E.HydratedTemplateButton) []map[string]any {
	result := make([]map[string]any, 0, len(buttons))
	for _, button := range buttons {
		if mapped := incomingTemplateButton(button); mapped != nil {
			result = append(result, mapped)
		}
	}
	return result
}

func incomingTemplateActions(buttons []map[string]any) []map[string]any {
	actions := make([]map[string]any, 0, len(buttons))
	for index, button := range buttons {
		title := firstNonEmpty(stringValue(button["text"]), stringValue(button["type"]))
		if title == "" {
			continue
		}
		action := map[string]any{
			"id":    strconv.Itoa(index),
			"type":  emptyStringAsNil(stringValue(button["type"])),
			"title": title,
		}
		if url := stringValue(button["url"]); url != "" {
			action["url"] = url
		}
		if phoneNumber := stringValue(button["phone_number"]); phoneNumber != "" {
			action["phone_number"] = phoneNumber
		}
		actions = append(actions, action)
	}
	return actions
}

func incomingTemplateContent(template *waE2E.TemplateMessage) map[string]any {
	if template == nil {
		return nil
	}
	hydrated := template.GetHydratedTemplate()
	if hydrated == nil {
		hydrated = template.GetHydratedFourRowTemplate()
	}
	if hydrated == nil {
		return nil
	}

	header := strings.TrimSpace(hydrated.GetHydratedTitleText())
	body := strings.TrimSpace(hydrated.GetHydratedContentText())
	footer := strings.TrimSpace(hydrated.GetHydratedFooterText())
	buttons := incomingTemplateButtons(hydrated.GetHydratedButtons())
	if header == "" && body == "" && footer == "" && len(buttons) == 0 {
		return nil
	}

	templateName := firstNonEmpty(template.GetTemplateID(), hydrated.GetTemplateID(), "template")
	components := make([]map[string]any, 0, 4)
	if header != "" {
		components = append(components, map[string]any{"type": "HEADER", "text": header})
	}
	if body != "" {
		components = append(components, map[string]any{"type": "BODY", "text": body})
	}
	if footer != "" {
		components = append(components, map[string]any{"type": "FOOTER", "text": footer})
	}
	if len(buttons) > 0 {
		components = append(components, map[string]any{"type": "BUTTONS", "buttons": buttons})
	}

	previewButtons := make([]string, 0, len(buttons))
	for _, button := range buttons {
		if text := stringValue(button["text"]); text != "" {
			previewButtons = append(previewButtons, text)
		}
	}

	officialTemplate := map[string]any{
		"name":       templateName,
		"language":   "",
		"components": components,
		"variables":  []map[string]any{},
		"preview": map[string]any{
			"header":  emptyStringAsNil(header),
			"body":    emptyStringAsNil(body),
			"footer":  emptyStringAsNil(footer),
			"buttons": previewButtons,
		},
	}

	return map[string]any{
		"type":              MessageTypeOfficialTemplate,
		"message":           firstNonEmpty(body, header, footer),
		"official_template": officialTemplate,
		"official": map[string]any{
			"provider": "meta_whatsapp",
			"type":     "template",
			"display": map[string]any{
				"kind":     "template",
				"raw_type": "template",
				"title":    emptyStringAsNil(header),
				"body":     emptyStringAsNil(body),
				"footer":   emptyStringAsNil(footer),
				"actions":  incomingTemplateActions(buttons),
			},
			"raw": map[string]any{
				"type":     "template",
				"template": officialTemplate,
			},
		},
	}
}

func emptyStringAsNil(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}

func (m *WhatsAppManager) incomingSecretEncryptedContent(ctx context.Context, evt *events.Message, msg *waE2E.Message) (string, map[string]any) {
	secret := msg.GetSecretEncryptedMessage()
	if secret == nil {
		return "", nil
	}

	if m.client == nil {
		m.logIncomingProviderDebug("incoming.secret_edit_missing_client", evt)
		return "", nil
	}

	decrypted, err := m.client.DecryptSecretEncryptedMessage(ctx, evt)
	if err != nil {
		log.Printf(
			"whatsmeow incoming secret edit decrypt failed worker_id=%s account_id=%s chat_hash=%s sender_hash=%s id_hash=%s target_id_hash=%s error_code=%s",
			m.cfg.WorkerID,
			m.cfg.AccountID,
			hashConnectionFlowIdentifier(incomingChatString(evt)),
			hashConnectionFlowIdentifier(incomingSenderString(evt)),
			hashConnectionFlowIdentifier(incomingMessageID(evt)),
			hashConnectionFlowIdentifier(secret.GetTargetMessageKey().GetID()),
			safeOperationalErrorCode(err),
		)
		return "", nil
	}

	edited := decrypted
	if protocolMsg := edited.GetProtocolMessage(); protocolMsg != nil && protocolMsg.GetType() == waE2E.ProtocolMessage_MESSAGE_EDIT {
		edited = protocolMsg.GetEditedMessage()
	}

	message := incomingEditedMessageText(edited)
	if message == "" {
		m.logIncomingProviderDebug("incoming.secret_edit_without_text", evt)
		return "", nil
	}

	return m.withIncomingQuoted(evt, msg, MessageTypeEditText, map[string]any{"type": MessageTypeEditText, "message": message})
}

func incomingIsSecretMessageEdit(msg *waE2E.Message) bool {
	if msg == nil {
		return false
	}
	secret := msg.GetSecretEncryptedMessage()
	return secret != nil && secret.GetSecretEncType() == waE2E.SecretEncryptedMessage_MESSAGE_EDIT
}

func (m *WhatsAppManager) incomingEditedContent(evt *events.Message, msg *waE2E.Message) (string, map[string]any) {
	if evt == nil || evt.Message == nil || evt.Message.GetEditedMessage() == nil {
		return "", nil
	}

	edited := futureProofInner(evt.Message.GetEditedMessage())
	if edited == nil {
		return "", nil
	}

	if protocolMsg := edited.GetProtocolMessage(); protocolMsg != nil && protocolMsg.GetType() == waE2E.ProtocolMessage_MESSAGE_EDIT {
		edited = protocolMsg.GetEditedMessage()
	}

	message := incomingEditedMessageText(edited)
	if message == "" {
		return m.unsupportedIncomingFallback(evt, msg, "incoming.edited_message_without_text")
	}

	return m.withIncomingQuoted(evt, msg, MessageTypeEditText, map[string]any{"type": MessageTypeEditText, "message": message})
}

func (m *WhatsAppManager) unsupportedIncomingFallback(evt *events.Message, msg *waE2E.Message, stage string) (string, map[string]any) {
	m.logIncomingProviderDebug(stage, evt)
	return m.withIncomingQuoted(evt, msg, MessageTypeSystem, map[string]any{"type": MessageTypeSystem, "message": unsupportedIncomingMessageText})
}

func (m *WhatsAppManager) logIncomingProviderDebug(stage string, evt *events.Message) {
	log.Printf(
		"whatsmeow incoming debug stage=%s worker_id=%s account_id=%s chat_hash=%s sender_hash=%s sender_alt_hash=%s recipient_alt_hash=%s id_hash=%s from_me=%t category=%q info_type=%q media_type=%q edit=%q is_edit=%t source_web_msg=%t is_ephemeral=%t is_view_once=%t is_view_once_v2=%t is_view_once_v2_extension=%t is_document_with_caption=%t is_lottie_sticker=%t is_bot_invoke=%t kinds=%q message_text_bytes=%d protobuf_bytes=%d",
		stage,
		m.cfg.WorkerID,
		m.cfg.AccountID,
		hashConnectionFlowIdentifier(incomingChatString(evt)),
		hashConnectionFlowIdentifier(incomingSenderString(evt)),
		hashConnectionFlowIdentifier(incomingSenderAltString(evt)),
		hashConnectionFlowIdentifier(incomingRecipientAltString(evt)),
		hashConnectionFlowIdentifier(incomingMessageID(evt)),
		incomingFromMe(evt),
		incomingCategory(evt),
		incomingInfoType(evt),
		incomingMediaType(evt),
		incomingEdit(evt),
		evt != nil && evt.IsEdit,
		evt != nil && evt.SourceWebMsg != nil,
		evt != nil && evt.IsEphemeral,
		evt != nil && evt.IsViewOnce,
		evt != nil && evt.IsViewOnceV2,
		evt != nil && evt.IsViewOnceV2Extension,
		evt != nil && evt.IsDocumentWithCaption,
		evt != nil && evt.IsLottieSticker,
		evt != nil && evt.IsBotInvoke,
		strings.Join(incomingMessageKinds(evt), ","),
		len([]byte(incomingTextPreview(evt))),
		incomingMessageProtoSize(evt),
	)
}

func incomingMessageProtoSize(evt *events.Message) int {
	if evt == nil || evt.Message == nil {
		return 0
	}
	return proto.Size(evt.Message)
}

func incomingHasEditSignal(evt *events.Message, msg *waE2E.Message) bool {
	if evt == nil {
		return false
	}
	if evt.IsEdit || strings.TrimSpace(string(evt.Info.Edit)) != "" {
		return true
	}
	if evt.Message != nil && evt.Message.GetEditedMessage() != nil {
		return true
	}
	if msg != nil && msg.GetEditedMessage() != nil {
		return true
	}
	if protocolMsg := msg.GetProtocolMessage(); protocolMsg != nil && protocolMsg.GetType() == waE2E.ProtocolMessage_MESSAGE_EDIT {
		return true
	}
	if incomingIsSecretMessageEdit(msg) {
		return true
	}
	return false
}

func incomingEditedMessageText(msg *waE2E.Message) string {
	if msg == nil {
		return ""
	}
	if message := msg.GetConversation(); message != "" {
		return message
	}
	if ext := msg.GetExtendedTextMessage(); ext != nil {
		return ext.GetText()
	}
	return ""
}

func unwrapIncomingMessage(msg *waE2E.Message) (*waE2E.Message, bool) {
	viewOnce := false
	for i := 0; i < 16 && msg != nil; i++ {
		if inner := futureProofInner(msg.GetEphemeralMessage()); inner != nil {
			msg = inner
			continue
		}
		if inner := futureProofInner(msg.GetViewOnceMessage()); inner != nil {
			viewOnce = true
			msg = inner
			continue
		}
		if inner := futureProofInner(msg.GetViewOnceMessageV2()); inner != nil {
			viewOnce = true
			msg = inner
			continue
		}
		if inner := futureProofInner(msg.GetViewOnceMessageV2Extension()); inner != nil {
			viewOnce = true
			msg = inner
			continue
		}
		if inner := futureProofInner(msg.GetDocumentWithCaptionMessage()); inner != nil {
			msg = inner
			continue
		}
		if inner := futureProofInner(msg.GetLottieStickerMessage()); inner != nil {
			msg = inner
			continue
		}
		if inner := futureProofInner(msg.GetEditedMessage()); inner != nil {
			msg = inner
			continue
		}
		return msg, viewOnce
	}
	return msg, viewOnce
}

func futureProofInner(msg *waE2E.FutureProofMessage) *waE2E.Message {
	if msg == nil {
		return nil
	}
	return msg.GetMessage()
}

func mediaContent(ctx context.Context, manager *WhatsAppManager, media whatsmeow.DownloadableMessage, messageType, caption, mimetype string, viewOnce bool) map[string]any {
	content := map[string]any{"type": messageType}
	key := messageType
	if messageType == MessageTypeVideoNote {
		key = "video"
	}
	entry := map[string]any{
		"caption":      caption,
		"mimetype":     mimetype,
		"is_view_once": viewOnce,
		"view_once":    viewOnce,
	}
	enrichIncomingMediaMetadata(entry, media)

	failMedia := func(reason string, err error) map[string]any {
		entry["media_download_failed"] = true
		content["media_download_failed"] = true
		content[key] = entry
		if manager != nil {
			if err != nil {
				log.Printf("whatsmeow media failed worker_id=%s type=%s key=%s reason=%s error_code=%s", manager.cfg.WorkerID, messageType, key, reason, safeOperationalErrorCode(err))
			} else {
				log.Printf("whatsmeow media failed worker_id=%s type=%s key=%s reason=%s", manager.cfg.WorkerID, messageType, key, reason)
			}
		}
		return content
	}

	if manager == nil {
		return failMedia("manager_unavailable", nil)
	}

	client := manager.getClient()
	if client == nil {
		return failMedia("client_unavailable", nil)
	}
	if manager.storage == nil {
		return failMedia("storage_unavailable", nil)
	}

	data, err := downloadIncomingMedia(ctx, manager, client, media)
	if err != nil {
		return failMedia("download_failed", err)
	}
	contentType := normalizeIncomingMediaMimetype(media, firstNonEmpty(mimetype, http.DetectContentType(data)), data)
	entry["mimetype"] = contentType
	name := incomingMediaFileName(media, messageType, contentType)
	object, uploadErr := manager.storage.Upload(ctx, manager.cfg.AccountID, data, name, contentType)
	if uploadErr != nil {
		return failMedia("upload_failed", uploadErr)
	}
	entry["url"] = object.URL
	entry["name"] = firstNonEmpty(stringValue(entry["name"]), object.Name)
	entry["size"] = object.Size
	entry["extension"] = extensionName(firstNonEmpty(object.Name, name), contentType)
	content[key] = entry
	log.Printf(
		"whatsmeow media uploaded worker_id=%s type=%s key=%s name_hash=%s mimetype=%s size=%d host=%s backup=%t",
		manager.cfg.WorkerID,
		messageType,
		key,
		hashConnectionFlowIdentifier(object.Name),
		contentType,
		object.Size,
		urlHost(object.URL),
		object.UsedBackup,
	)
	return content
}

type incomingMediaDownloadInvoker func(
	context.Context,
	whatsmeow.File,
) error

func downloadIncomingMedia(
	ctx context.Context,
	manager *WhatsAppManager,
	client *whatsmeow.Client,
	media whatsmeow.DownloadableMessage,
) ([]byte, error) {
	if media == nil {
		return nil, errors.New("downloadable media is required")
	}
	return downloadIncomingMediaWithInvoker(
		ctx,
		manager,
		client,
		incomingMediaDownloadOperation(media),
		func(downloadCtx context.Context, file whatsmeow.File) error {
			return client.DownloadToFile(downloadCtx, media, file)
		},
	)
}

func incomingMediaDownloadOperation(
	media whatsmeow.DownloadableMessage,
) string {
	if media == nil {
		return "inbound_media_download:missing"
	}
	digest := sha256.Sum256([]byte(media.GetDirectPath()))
	return fmt.Sprintf("inbound_media_download:%x", digest[:8])
}

func downloadIncomingMediaWithInvoker(
	ctx context.Context,
	manager *WhatsAppManager,
	client *whatsmeow.Client,
	operation string,
	invoke incomingMediaDownloadInvoker,
) (data []byte, err error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if manager == nil {
		return nil, errors.New("whatsmeow manager is required")
	}
	if client == nil {
		return nil, errors.New("whatsmeow client is not initialized")
	}
	if invoke == nil {
		return nil, errors.New("media download invocation is required")
	}
	operation = strings.TrimSpace(operation)
	if operation == "" {
		return nil, errors.New("media download operation is required")
	}

	downloadCtx, cancelDownload := context.WithTimeout(
		ctx,
		resolveMediaDownloadRequestTimeout(),
	)
	defer cancelDownload()
	releaseDownload, err := manager.acquireIncomingMediaDownload(downloadCtx)
	if err != nil {
		return nil, err
	}
	defer releaseDownload()

	tempFile, err := os.CreateTemp("", "underchat-whatsmeow-media-*")
	if err != nil {
		return nil, fmt.Errorf("create media temporary file: %w", err)
	}
	tempPath := tempFile.Name()
	defer func() {
		closeErr := tempFile.Close()
		removeErr := os.Remove(tempPath)
		var cleanupErr error
		if closeErr != nil && !errors.Is(closeErr, os.ErrClosed) {
			cleanupErr = errors.Join(
				cleanupErr,
				fmt.Errorf("close media temporary file: %w", closeErr),
			)
		}
		if removeErr != nil && !errors.Is(removeErr, os.ErrNotExist) {
			cleanupErr = errors.Join(
				cleanupErr,
				fmt.Errorf("remove media temporary file: %w", removeErr),
			)
		}
		if cleanupErr != nil {
			err = errors.Join(err, cleanupErr)
		}
	}()

	maxBytes := resolveMediaDownloadMaxBytes()
	boundedFile, err := newBoundedIncomingMediaFile(tempFile, maxBytes)
	if err != nil {
		return nil, err
	}
	_, err = invokeWhatsmeowProviderOperationWithDeadline(
		downloadCtx,
		manager,
		client,
		operation,
		resolveMediaDownloadRequestTimeout(),
		func(downloadCtx context.Context) (struct{}, error) {
			return struct{}{}, invoke(downloadCtx, boundedFile)
		},
	)
	if err != nil {
		return nil, err
	}

	fileInfo, err := boundedFile.Stat()
	if err != nil {
		return nil, fmt.Errorf("stat downloaded media: %w", err)
	}
	if fileInfo.Size() > maxBytes {
		return nil, errMediaDownloadTooLarge
	}
	if _, err = boundedFile.Seek(0, io.SeekStart); err != nil {
		return nil, fmt.Errorf("seek downloaded media: %w", err)
	}
	data, err = io.ReadAll(io.LimitReader(boundedFile, maxBytes+1))
	if err != nil {
		return nil, fmt.Errorf("read downloaded media: %w", err)
	}
	if int64(len(data)) > maxBytes {
		return nil, errMediaDownloadTooLarge
	}
	return data, nil
}

func enrichIncomingMediaMetadata(entry map[string]any, media whatsmeow.DownloadableMessage) {
	switch msg := media.(type) {
	case *waE2E.ImageMessage:
		setPositiveNumber(entry, "height", msg.GetHeight())
		setPositiveNumber(entry, "width", msg.GetWidth())
		setThumbnail(entry, msg.GetJPEGThumbnail())
	case *waE2E.VideoMessage:
		setPositiveNumber(entry, "height", msg.GetHeight())
		setPositiveNumber(entry, "width", msg.GetWidth())
		setPositiveNumber(entry, "duration", msg.GetSeconds())
		setThumbnail(entry, msg.GetJPEGThumbnail())
	case *waE2E.AudioMessage:
		setPositiveNumber(entry, "duration", msg.GetSeconds())
		entry["ptt"] = msg.GetPTT()
		if waveform := msg.GetWaveform(); len(waveform) > 0 {
			entry["waveform"] = base64.StdEncoding.EncodeToString(waveform)
		}
	case *waE2E.DocumentMessage:
		if name := firstNonEmpty(msg.GetFileName(), msg.GetTitle()); name != "" {
			entry["name"] = name
		}
		setThumbnail(entry, msg.GetJPEGThumbnail())
	case *waE2E.StickerMessage:
		setPositiveNumber(entry, "height", msg.GetHeight())
		setPositiveNumber(entry, "width", msg.GetWidth())
		entry["is_animated"] = msg.GetIsAnimated()
		entry["is_lottie"] = msg.GetIsLottie()
	}
}

func setPositiveNumber(entry map[string]any, key string, value uint32) {
	if value > 0 {
		entry[key] = int(value)
	}
}

func setThumbnail(entry map[string]any, thumbnail []byte) {
	if len(thumbnail) == 0 {
		return
	}
	entry["thumbnail"] = "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(thumbnail)
}

func incomingMediaFileName(media whatsmeow.DownloadableMessage, messageType, mimetype string) string {
	if doc, ok := media.(*waE2E.DocumentMessage); ok {
		if name := firstNonEmpty(doc.GetFileName(), doc.GetTitle()); name != "" {
			return name
		}
	}
	prefix := messageType
	if prefix == MessageTypeVideoNote {
		prefix = MessageTypeVideo
	}
	return prefix + "-" + randomHex(8) + extensionFromMime(mimetype)
}

func normalizeIncomingMediaMimetype(media whatsmeow.DownloadableMessage, mimetype string, data []byte) string {
	normalized := strings.ToLower(strings.TrimSpace(strings.Split(mimetype, ";")[0]))
	if sticker, ok := media.(*waE2E.StickerMessage); ok {
		if sticker.GetIsLottie() || normalized == "application/was" {
			return "application/was"
		}
		if normalized == "application/x-tgsticker" {
			return "application/x-tgsticker"
		}
		if normalized == "" || normalized == "application/octet-stream" {
			if looksLikeLottie(data) {
				return "application/was"
			}
			return "image/webp"
		}
	}
	if normalized == "" || normalized == "application/octet-stream" {
		return firstNonEmpty(http.DetectContentType(data), "application/octet-stream")
	}
	return normalized
}

func looksLikeLottie(data []byte) bool {
	if len(data) < 4 {
		return false
	}
	return data[0] == 0x50 && data[1] == 0x4b
}

func extensionName(fileName, mimetype string) string {
	ext := strings.TrimPrefix(strings.ToLower(path.Ext(fileName)), ".")
	if ext != "" {
		return ext
	}
	return strings.TrimPrefix(strings.ToLower(extensionFromMime(mimetype)), ".")
}

func mediaContentPublishStatus(content map[string]any, messageType string) (bool, bool) {
	if len(content) == 0 {
		return false, false
	}
	key := messageType
	if messageType == MessageTypeVideoNote {
		key = "video"
	}
	media := asMap(content[key])
	hasURL := stringValue(media["url"]) != ""
	failed := boolValue(content["media_download_failed"]) || boolValue(media["media_download_failed"])
	return hasURL, failed
}

func enrichIncomingAlbumContent(content map[string]any, msg *waE2E.Message) {
	if len(content) == 0 || msg == nil {
		return
	}
	association := incomingMessageAssociation(msg)
	if association == nil || association.GetAssociationType() != waE2E.MessageAssociation_MEDIA_ALBUM {
		return
	}

	parentMessageID := incomingMessageKeyID(association.GetParentMessageKey())
	if parentMessageID == "" {
		return
	}

	album := map[string]any{
		"id":                parentMessageID,
		"parent_message_id": parentMessageID,
		"association_type":  "MEDIA_ALBUM",
		"source":            "whatsmeow",
	}
	if association.MessageIndex != nil {
		album["item_index"] = int(association.GetMessageIndex())
	}
	content["album"] = album
}

func incomingMessageAssociation(msg *waE2E.Message) *waE2E.MessageAssociation {
	if msg == nil || msg.GetMessageContextInfo() == nil {
		return nil
	}
	return msg.GetMessageContextInfo().GetMessageAssociation()
}

func incomingMessageKeyID(key *waCommon.MessageKey) string {
	if key == nil {
		return ""
	}
	return strings.TrimSpace(key.GetID())
}

func (m *WhatsAppManager) withIncomingQuoted(evt *events.Message, msg *waE2E.Message, messageType string, content map[string]any) (string, map[string]any) {
	if content == nil {
		return messageType, content
	}
	quoted := incomingQuotedMessage(evt, msg)
	if len(quoted) == 0 {
		return messageType, content
	}
	content["quoted"] = quoted
	if key := asMap(quoted["key"]); stringValue(key["id"]) != "" {
		content["message_quoted_id"] = stringValue(key["id"])
	}
	if m != nil {
		log.Printf(
			"whatsmeow incoming quoted mapped worker_id=%s message_id_hash=%s quoted_id_hash=%s quoted_type=%s participant_hash=%s",
			m.cfg.WorkerID,
			hashConnectionFlowIdentifier(evt.Info.ID),
			hashConnectionFlowIdentifier(stringValue(asMap(quoted["key"])["id"])),
			stringValue(quoted["type"]),
			hashConnectionFlowIdentifier(stringValue(asMap(quoted["key"])["participant"])),
		)
	}
	return messageType, content
}

func incomingQuotedMessage(evt *events.Message, msg *waE2E.Message) map[string]any {
	if evt == nil || msg == nil {
		return nil
	}
	ctx := incomingMessageContextInfo(msg)
	if ctx == nil || ctx.GetQuotedMessage() == nil || ctx.GetStanzaID() == "" {
		return nil
	}

	currentParticipant := ""
	if !evt.Info.Sender.IsEmpty() && evt.Info.Sender != evt.Info.Chat {
		currentParticipant = evt.Info.Sender.String()
	}
	participant := firstNonEmpty(ctx.GetParticipant(), currentParticipant, evt.Info.Sender.String())
	fromMe := evt.Info.IsFromMe
	if ctx.GetParticipant() != "" {
		fromMe = ctx.GetParticipant() == currentParticipant
	}

	key := map[string]any{
		"remote_jid":   evt.Info.Chat.String(),
		"from_me":      fromMe,
		"id":           ctx.GetStanzaID(),
		"participant":  participant,
		"is_view_once": false,
		"addressing_mode": func() string {
			if evt.Info.AddressingMode != "" {
				return string(evt.Info.AddressingMode)
			}
			return ""
		}(),
	}
	if remoteJIDAlt := incomingRemoteJIDAlt(evt); remoteJIDAlt != "" {
		key["remote_jid_alt"] = remoteJIDAlt
	}
	if !evt.Info.SenderAlt.IsEmpty() {
		key["participant_alt"] = nonADJID(evt.Info.SenderAlt).String()
	}
	if key["addressing_mode"] == "" {
		delete(key, "addressing_mode")
	}

	quotedMsg := ctx.GetQuotedMessage()
	quoted := map[string]any{
		"key":     key,
		"message": quotedMessageText(quotedMsg),
		"type":    quotedMessageType(quotedMsg),
	}
	enrichQuotedContent(quotedMsg, quoted)
	if quoted["message"] == "" {
		quoted["message"] = nil
	}
	return quoted
}

func incomingMessageContextInfo(msg *waE2E.Message) *waE2E.ContextInfo {
	switch {
	case msg.GetExtendedTextMessage() != nil:
		return msg.GetExtendedTextMessage().GetContextInfo()
	case msg.GetImageMessage() != nil:
		return msg.GetImageMessage().GetContextInfo()
	case msg.GetVideoMessage() != nil:
		return msg.GetVideoMessage().GetContextInfo()
	case msg.GetPtvMessage() != nil:
		return msg.GetPtvMessage().GetContextInfo()
	case msg.GetAudioMessage() != nil:
		return msg.GetAudioMessage().GetContextInfo()
	case msg.GetDocumentMessage() != nil:
		return msg.GetDocumentMessage().GetContextInfo()
	case msg.GetStickerMessage() != nil:
		return msg.GetStickerMessage().GetContextInfo()
	case msg.GetLocationMessage() != nil:
		return msg.GetLocationMessage().GetContextInfo()
	case msg.GetContactMessage() != nil:
		return msg.GetContactMessage().GetContextInfo()
	case msg.GetContactsArrayMessage() != nil:
		return msg.GetContactsArrayMessage().GetContextInfo()
	case msg.GetButtonsMessage() != nil:
		return msg.GetButtonsMessage().GetContextInfo()
	case msg.GetButtonsResponseMessage() != nil:
		return msg.GetButtonsResponseMessage().GetContextInfo()
	case msg.GetListMessage() != nil:
		return msg.GetListMessage().GetContextInfo()
	case msg.GetListResponseMessage() != nil:
		return msg.GetListResponseMessage().GetContextInfo()
	case msg.GetInteractiveMessage() != nil:
		return msg.GetInteractiveMessage().GetContextInfo()
	}
	return nil
}

func quotedMessageType(msg *waE2E.Message) string {
	switch {
	case msg == nil:
		return MessageTypeText
	case msg.GetDocumentMessage() != nil:
		return MessageTypeDocument
	case msg.GetPtvMessage() != nil:
		return MessageTypeVideoNote
	case msg.GetVideoMessage() != nil:
		return MessageTypeVideo
	case msg.GetImageMessage() != nil:
		return MessageTypeImage
	case msg.GetAudioMessage() != nil:
		return MessageTypeAudio
	case msg.GetStickerMessage() != nil:
		return MessageTypeSticker
	case msg.GetLocationMessage() != nil:
		return MessageTypeLocation
	case msg.GetContactMessage() != nil:
		return MessageTypeContact
	case msg.GetContactsArrayMessage() != nil:
		return MessageTypeContacts
	case msg.GetButtonsMessage() != nil:
		return MessageTypeText
	case msg.GetButtonsResponseMessage() != nil:
		return MessageTypeText
	case msg.GetListMessage() != nil:
		return MessageTypeText
	case msg.GetListResponseMessage() != nil:
		return MessageTypeText
	case msg.GetInteractiveMessage() != nil:
		return MessageTypeText
	default:
		return MessageTypeText
	}
}

func quotedMessageText(msg *waE2E.Message) string {
	if msg == nil {
		return ""
	}
	switch {
	case msg.GetConversation() != "":
		return msg.GetConversation()
	case msg.GetExtendedTextMessage() != nil:
		return msg.GetExtendedTextMessage().GetText()
	case msg.GetImageMessage() != nil:
		return msg.GetImageMessage().GetCaption()
	case msg.GetVideoMessage() != nil:
		return msg.GetVideoMessage().GetCaption()
	case msg.GetPtvMessage() != nil:
		return msg.GetPtvMessage().GetCaption()
	case msg.GetDocumentMessage() != nil:
		return msg.GetDocumentMessage().GetCaption()
	case msg.GetLocationMessage() != nil:
		loc := msg.GetLocationMessage()
		return firstNonEmpty(loc.GetName(), loc.GetAddress())
	case msg.GetContactMessage() != nil:
		return msg.GetContactMessage().GetDisplayName()
	case msg.GetContactsArrayMessage() != nil:
		return msg.GetContactsArrayMessage().GetDisplayName()
	case msg.GetButtonsMessage() != nil:
		return msg.GetButtonsMessage().GetContentText()
	case msg.GetButtonsResponseMessage() != nil:
		return firstNonEmpty(
			msg.GetButtonsResponseMessage().GetSelectedDisplayText(),
			msg.GetButtonsResponseMessage().GetSelectedButtonID(),
		)
	case msg.GetListMessage() != nil:
		return msg.GetListMessage().GetDescription()
	case msg.GetListResponseMessage() != nil:
		return firstNonEmpty(
			msg.GetListResponseMessage().GetTitle(),
			msg.GetListResponseMessage().GetSingleSelectReply().GetSelectedRowID(),
		)
	case msg.GetInteractiveMessage() != nil:
		return msg.GetInteractiveMessage().GetBody().GetText()
	default:
		return ""
	}
}

func enrichQuotedContent(msg *waE2E.Message, quoted map[string]any) {
	if msg == nil {
		return
	}
	if image := msg.GetImageMessage(); image != nil {
		quoted["image"] = map[string]any{
			"url":       nil,
			"caption":   nullableString(image.GetCaption()),
			"mimetype":  nullableString(image.GetMimetype()),
			"extension": nil,
			"size":      nullableUint64(image.GetFileLength()),
			"height":    nullableUint32(image.GetHeight()),
			"width":     nullableUint32(image.GetWidth()),
			"thumbnail": thumbnailDataURI(image.GetJPEGThumbnail()),
		}
		return
	}
	if video := firstVideoMessage(msg); video != nil {
		quoted["video"] = map[string]any{
			"url":       nil,
			"caption":   nullableString(video.GetCaption()),
			"name":      nil,
			"mimetype":  nullableString(video.GetMimetype()),
			"extension": nil,
			"size":      nullableUint64(video.GetFileLength()),
			"duration":  nullableUint32(video.GetSeconds()),
			"height":    nullableUint32(video.GetHeight()),
			"width":     nullableUint32(video.GetWidth()),
			"thumbnail": thumbnailDataURI(video.GetJPEGThumbnail()),
		}
		return
	}
	if doc := msg.GetDocumentMessage(); doc != nil {
		quoted["document"] = map[string]any{
			"url":       nil,
			"name":      nullableString(firstNonEmpty(doc.GetFileName(), doc.GetTitle())),
			"mimetype":  nullableString(doc.GetMimetype()),
			"extension": nil,
			"size":      nullableUint64(doc.GetFileLength()),
		}
		return
	}
	if audio := msg.GetAudioMessage(); audio != nil {
		quoted["audio"] = map[string]any{
			"url":       nil,
			"name":      nil,
			"mimetype":  nullableString(audio.GetMimetype()),
			"extension": nil,
			"size":      nullableUint64(audio.GetFileLength()),
			"duration":  nullableUint32(audio.GetSeconds()),
			"ptt":       audio.GetPTT(),
			"view_once": false,
		}
		return
	}
	if sticker := msg.GetStickerMessage(); sticker != nil {
		quoted["sticker"] = map[string]any{
			"url":         nil,
			"mimetype":    nullableString(sticker.GetMimetype()),
			"extension":   nil,
			"size":        nullableUint64(sticker.GetFileLength()),
			"height":      nullableUint32(sticker.GetHeight()),
			"width":       nullableUint32(sticker.GetWidth()),
			"is_animated": sticker.GetIsAnimated(),
		}
		return
	}
	if loc := msg.GetLocationMessage(); loc != nil {
		quoted["location"] = map[string]any{
			"latitude":  loc.GetDegreesLatitude(),
			"longitude": loc.GetDegreesLongitude(),
			"name":      nullableString(loc.GetName()),
			"address":   nullableString(loc.GetAddress()),
		}
		return
	}
	if contact := msg.GetContactMessage(); contact != nil {
		quoted["contact"] = quotedContactPayload(contact.GetDisplayName(), contact.GetVcard())
		return
	}
	if contacts := msg.GetContactsArrayMessage(); contacts != nil {
		items := make([]map[string]any, 0, len(contacts.GetContacts()))
		for _, contact := range contacts.GetContacts() {
			items = append(items, quotedContactPayload(contact.GetDisplayName(), contact.GetVcard()))
		}
		quoted["contacts"] = items
		return
	}
	if list := msg.GetListMessage(); list != nil {
		quoted["list"] = listContentPayload(list)
		return
	}
}

func firstVideoMessage(msg *waE2E.Message) *waE2E.VideoMessage {
	if msg.GetVideoMessage() != nil {
		return msg.GetVideoMessage()
	}
	return msg.GetPtvMessage()
}

func nullableString(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func nullableUint32(value uint32) any {
	if value == 0 {
		return nil
	}
	return int(value)
}

func nullableUint64(value uint64) any {
	if value == 0 {
		return nil
	}
	return int64(value)
}

func thumbnailDataURI(thumbnail []byte) any {
	if len(thumbnail) == 0 {
		return nil
	}
	return "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(thumbnail)
}

func quotedContactPayload(name, vcard string) map[string]any {
	parsed := parseVCard(name, vcard)
	fullName := firstNonEmpty(stringValue(parsed["name"]), strings.TrimSpace(name), "Contato")
	phone := stringValue(parsed["phone"])
	return map[string]any{
		"contact_id":    "quoted_" + base64.RawURLEncoding.EncodeToString([]byte(firstNonEmpty(vcard, fullName, phone))),
		"name":          fullName,
		"last_name":     nil,
		"phone":         nullableString(phone),
		"phone_partial": nullableString(digits(phone)),
		"phone_ddi":     nil,
		"email":         nil,
		"email_partial": nil,
	}
}

func buildContextInfo(data ChatMessage) *waE2E.ContextInfo {
	var contextInfo *waE2E.ContextInfo
	if quoted := asMap(data.Content["quoted"]); len(quoted) > 0 {
		key := asMap(quoted["key"])
		stanzaID := stringValue(key["id"])
		if stanzaID != "" {
			remoteJID := firstNonEmpty(
				stringValue(key["remote_jid"]),
				stringValue(key["remoteJid"]),
				stringValue(key["remote_jid_alt"]),
				stringValue(key["remoteJidAlt"]),
			)
			participant := firstNonEmpty(
				stringValue(key["participant"]),
				stringValue(key["participant_alt"]),
				stringValue(key["participantAlt"]),
			)
			if participant == "" && !(boolValue(key["from_me"]) || boolValue(key["fromMe"])) {
				participant = remoteJID
			}
			contextInfo = &waE2E.ContextInfo{
				StanzaID:      proto.String(stanzaID),
				Participant:   proto.String(participant),
				RemoteJID:     proto.String(remoteJID),
				QuotedMessage: quotedMessageForContext(quoted),
			}
		}
	}
	mentions := stringSlice(data.Content["mentioned_jid"])
	if len(mentions) == 0 {
		mentions = stringSlice(asMap(data.Content["context_info"])["mentioned_jid"])
	}
	if len(mentions) > 0 {
		if contextInfo == nil {
			contextInfo = &waE2E.ContextInfo{}
		}
		contextInfo.MentionedJID = mentions
	}
	contextInfo = applyForwardContextInfo(data, contextInfo)
	return contextInfo
}

func applyForwardContextInfo(data ChatMessage, contextInfo *waE2E.ContextInfo) *waE2E.ContextInfo {
	context := asMap(data.Content["context_info"])
	score := uint32Value(firstNonEmptyAny(context["forwarding_score"], context["forwardingScore"]))
	isForwarded := len(asMap(data.Content["forward"])) > 0 ||
		boolValue(firstNonEmptyAny(context["is_forwarded"], context["isForwarded"])) ||
		score > 0
	if !isForwarded {
		return contextInfo
	}
	if contextInfo == nil {
		contextInfo = &waE2E.ContextInfo{}
	}
	if score == 0 {
		score = 1
	}
	contextInfo.IsForwarded = proto.Bool(true)
	contextInfo.ForwardingScore = proto.Uint32(score)
	return contextInfo
}

func quotedMessageForContext(quoted map[string]any) *waE2E.Message {
	quotedType := firstNonEmpty(stringValue(quoted["type"]), inferQuotedContentType(quoted))
	text := stringValue(quoted["message"])

	switch quotedType {
	case MessageTypeImage:
		image := asMap(quoted["image"])
		return &waE2E.Message{ImageMessage: &waE2E.ImageMessage{
			Caption:       proto.String(firstNonEmpty(stringValue(image["caption"]), text)),
			Mimetype:      proto.String(firstNonEmpty(stringValue(image["mimetype"]), "image/jpeg")),
			FileLength:    proto.Uint64(uint64Value(image["size"])),
			Height:        proto.Uint32(uint32Value(image["height"])),
			Width:         proto.Uint32(uint32Value(image["width"])),
			JPEGThumbnail: bytesFromJSONValue(image["thumbnail"]),
		}}
	case MessageTypeVideo, MessageTypeVideoNote:
		video := asMap(quoted["video"])
		videoMessage := &waE2E.VideoMessage{
			Caption:       proto.String(firstNonEmpty(stringValue(video["caption"]), text)),
			Mimetype:      proto.String(firstNonEmpty(stringValue(video["mimetype"]), "video/mp4")),
			FileLength:    proto.Uint64(uint64Value(video["size"])),
			Seconds:       proto.Uint32(uint32Value(video["duration"])),
			Height:        proto.Uint32(uint32Value(video["height"])),
			Width:         proto.Uint32(uint32Value(video["width"])),
			JPEGThumbnail: bytesFromJSONValue(video["thumbnail"]),
		}
		if quotedType == MessageTypeVideoNote {
			return &waE2E.Message{PtvMessage: videoMessage}
		}
		return &waE2E.Message{VideoMessage: videoMessage}
	case MessageTypeDocument:
		doc := asMap(quoted["document"])
		name := firstNonEmpty(stringValue(doc["name"]), stringValue(doc["file_name"]), "document")
		return &waE2E.Message{DocumentMessage: &waE2E.DocumentMessage{
			Caption:       proto.String(firstNonEmpty(stringValue(doc["caption"]), text)),
			Mimetype:      proto.String(firstNonEmpty(stringValue(doc["mimetype"]), "application/octet-stream")),
			FileLength:    proto.Uint64(uint64Value(doc["size"])),
			FileName:      proto.String(name),
			Title:         proto.String(name),
			JPEGThumbnail: bytesFromJSONValue(doc["thumbnail"]),
		}}
	case MessageTypeAudio:
		audio := asMap(quoted["audio"])
		viewOnce := boolValue(firstNonEmptyAny(audio["is_view_once"], audio["view_once"]))
		ptt := outgoingAudioPTT(audio, viewOnce)
		return &waE2E.Message{AudioMessage: &waE2E.AudioMessage{
			Mimetype:   proto.String(firstNonEmpty(stringValue(audio["mimetype"]), "audio/ogg; codecs=opus")),
			FileLength: proto.Uint64(uint64Value(audio["size"])),
			Seconds:    proto.Uint32(uint32Value(firstNonEmptyAny(audio["duration"], audio["seconds"]))),
			PTT:        proto.Bool(ptt),
			Waveform:   outgoingAudioWaveform(audio, ptt),
		}}
	case MessageTypeSticker:
		sticker := asMap(quoted["sticker"])
		return &waE2E.Message{StickerMessage: &waE2E.StickerMessage{
			Mimetype:   proto.String(firstNonEmpty(stringValue(sticker["mimetype"]), "image/webp")),
			FileLength: proto.Uint64(uint64Value(sticker["size"])),
			Height:     proto.Uint32(uint32Value(sticker["height"])),
			Width:      proto.Uint32(uint32Value(sticker["width"])),
			IsAnimated: proto.Bool(boolValue(sticker["is_animated"])),
		}}
	case MessageTypeLocation:
		location := asMap(quoted["location"])
		return &waE2E.Message{LocationMessage: &waE2E.LocationMessage{
			DegreesLatitude:  proto.Float64(floatValue(firstNonEmptyAny(location["latitude"], location["degreesLatitude"]))),
			DegreesLongitude: proto.Float64(floatValue(firstNonEmptyAny(location["longitude"], location["degreesLongitude"]))),
			Name:             proto.String(stringValue(location["name"])),
			Address:          proto.String(stringValue(location["address"])),
		}}
	case MessageTypeContact:
		return &waE2E.Message{ContactMessage: buildContactMessage(asMap(quoted["contact"]), nil)}
	case MessageTypeContacts:
		contactsRaw, _ := quoted["contacts"].([]any)
		contacts := make([]*waE2E.ContactMessage, 0, len(contactsRaw))
		for _, item := range contactsRaw {
			contacts = append(contacts, buildContactMessage(asMap(item), nil))
		}
		return &waE2E.Message{ContactsArrayMessage: &waE2E.ContactsArrayMessage{
			DisplayName: proto.String("Contacts"),
			Contacts:    contacts,
		}}
	default:
		return &waE2E.Message{Conversation: proto.String(text)}
	}
}

func inferQuotedContentType(quoted map[string]any) string {
	for _, item := range []struct {
		key         string
		messageType string
	}{
		{"image", MessageTypeImage},
		{"video", MessageTypeVideo},
		{"document", MessageTypeDocument},
		{"audio", MessageTypeAudio},
		{"sticker", MessageTypeSticker},
		{"location", MessageTypeLocation},
		{"contact", MessageTypeContact},
		{"contacts", MessageTypeContacts},
	} {
		if value, ok := quoted[item.key]; ok && value != nil {
			return item.messageType
		}
	}
	return MessageTypeText
}

func buildExtendedTextMessage(text string, data ChatMessage, contextInfo *waE2E.ContextInfo) *waE2E.ExtendedTextMessage {
	preview := asMap(data.Content["link_preview"])
	if contextInfo == nil && len(preview) == 0 {
		return nil
	}
	extended := &waE2E.ExtendedTextMessage{
		Text:        proto.String(text),
		ContextInfo: contextInfo,
	}
	if len(preview) == 0 {
		return extended
	}
	matchedText := firstNonEmpty(
		stringValue(preview["matchedText"]),
		stringValue(preview["matched-text"]),
		stringValue(preview["canonicalUrl"]),
		stringValue(preview["canonical-url"]),
	)
	if matchedText != "" {
		extended.MatchedText = proto.String(matchedText)
	}
	if title := stringValue(preview["title"]); title != "" {
		extended.Title = proto.String(title)
	}
	if description := stringValue(preview["description"]); description != "" {
		extended.Description = proto.String(description)
	}
	if thumbnail := bytesFromJSONValue(preview["jpegThumbnail"]); len(thumbnail) > 0 {
		extended.JPEGThumbnail = thumbnail
	}
	return extended
}

func buildContactMessage(contact map[string]any, contextInfo *waE2E.ContextInfo) *waE2E.ContactMessage {
	name := firstNonEmpty(stringValue(contact["name"]), stringValue(contact["display_name"]), stringValue(contact["phone"]))
	phone := firstNonEmpty(stringValue(contact["phone"]), stringValue(contact["phone_number"]))
	vcard := stringValue(contact["vcard"])
	if vcard == "" {
		vcard = fmt.Sprintf("BEGIN:VCARD\nVERSION:3.0\nFN:%s\nTEL;type=CELL;type=VOICE;waid=%s:%s\nEND:VCARD", name, digits(phone), phone)
	}
	return &waE2E.ContactMessage{
		DisplayName: proto.String(name),
		Vcard:       proto.String(vcard),
		ContextInfo: contextInfo,
	}
}

func parseVCard(name, vcard string) map[string]any {
	phone := ""
	for _, line := range strings.Split(vcard, "\n") {
		if strings.Contains(strings.ToUpper(line), "TEL") {
			parts := strings.Split(line, ":")
			phone = digits(parts[len(parts)-1])
			break
		}
	}
	return map[string]any{
		"name":  name,
		"phone": phone,
	}
}

func resolveTargetJID(data ChatMessage) (types.JID, error) {
	if data.MessageKey != nil {
		if remote := data.MessageKey.Remote(); remote != "" {
			target, err := parseJID(remote)
			if err != nil {
				return types.EmptyJID, fmt.Errorf("%w: %v", errOutboundTargetInvalid, err)
			}
			return target, nil
		}
	}
	if data.ChatID != "" && strings.Contains(data.ChatID, "@") {
		target, err := parseJID(data.ChatID)
		if err != nil {
			return types.EmptyJID, fmt.Errorf("%w: %v", errOutboundTargetInvalid, err)
		}
		return target, nil
	}
	phone := digits(data.PhoneDDI + data.Phone)
	if phone != "" {
		return types.NewJID(phone, types.DefaultUserServer), nil
	}
	return types.EmptyJID, fmt.Errorf("%w: message target jid is required", errOutboundTargetInvalid)
}

func parseJID(value string) (types.JID, error) {
	value = strings.TrimSpace(value)
	value = strings.ReplaceAll(value, "@c.us", "@s.whatsapp.net")
	if !strings.Contains(value, "@") {
		value = digits(value) + "@" + types.DefaultUserServer
	}
	return types.ParseJID(value)
}

func senderJIDFromKey(target types.JID, key *MessageKey) types.JID {
	if key == nil {
		return types.EmptyJID
	}
	if key.Participant != "" {
		if jid, err := parseJID(key.Participant); err == nil {
			return jid
		}
	}
	if !key.FromMeValue() {
		return target
	}
	return types.EmptyJID
}

func sentChatReadMessageKey(data ChatMessage, target types.JID, messageID string) MessageKey {
	fromMe := true
	key := MessageKey{}
	if data.MessageKey != nil {
		key = *data.MessageKey
	}
	if key.RemoteJID == "" && key.RemoteJIDC == "" {
		key.RemoteJID = target.String()
	}
	key.FromMe = &fromMe
	key.ID = messageID
	return key
}

type chatReadStatePatch struct {
	chat           types.JID
	lastMessageKey *waCommon.MessageKey
	timestamp      time.Time
}

func (m *WhatsAppManager) markChatAsReadAppState(ctx context.Context, client *whatsmeow.Client, key MessageKey, fallbackChat types.JID, timestamp time.Time) {
	if client == nil {
		return
	}
	patches := buildChatReadStatePatches(key, fallbackChat, timestamp)
	if len(patches) == 0 {
		return
	}
	appStateCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	authorizeProvider := providerAuthorizationGuardFromContext(appStateCtx)
	for _, patch := range patches {
		if err := invokeProviderAuthorizedErrorCall(
			appStateCtx,
			authorizeProvider,
			func(invokeCtx context.Context) error {
				return client.SendAppState(
					invokeCtx,
					appstate.BuildMarkChatAsRead(
						patch.chat,
						true,
						patch.timestamp,
						patch.lastMessageKey,
					),
				)
			},
		); err != nil {
			log.Printf("whatsmeow mark chat read app state failed worker_id=%s chat_jid_hash=%s message_id_hash=%s error_code=%s", m.cfg.WorkerID, hashConnectionFlowIdentifier(patch.chat.String()), hashConnectionFlowIdentifier(patch.lastMessageKey.GetID()), safeOperationalErrorCode(err))
			if errors.Is(err, errOutboundProviderCallStalled) {
				return
			}
		}
	}
}

func buildChatReadStatePatches(key MessageKey, fallbackChat types.JID, timestamp time.Time) []chatReadStatePatch {
	if strings.TrimSpace(key.ID) == "" {
		return nil
	}
	chats := chatReadJIDCandidates(key, fallbackChat)
	patches := make([]chatReadStatePatch, 0, len(chats))
	for _, chat := range chats {
		lastMessageKey := buildChatReadMessageKey(chat, key)
		if lastMessageKey == nil {
			continue
		}
		patches = append(patches, chatReadStatePatch{
			chat:           chat,
			lastMessageKey: lastMessageKey,
			timestamp:      timestamp,
		})
	}
	return patches
}

func chatReadJIDCandidates(key MessageKey, fallbackChat types.JID) []types.JID {
	rawCandidates := []string{
		key.RemoteJID,
		key.RemoteJIDC,
		key.RemoteJIDAlt,
		key.RemoteJIDAltC,
	}
	if !fallbackChat.IsEmpty() {
		rawCandidates = append(rawCandidates, fallbackChat.String())
	}

	seen := map[string]struct{}{}
	candidates := make([]types.JID, 0, len(rawCandidates))
	for _, rawCandidate := range rawCandidates {
		if strings.TrimSpace(rawCandidate) == "" {
			continue
		}
		jid, err := parseJID(rawCandidate)
		if err != nil || jid.IsEmpty() {
			continue
		}
		jid = nonADJID(jid)
		key := jid.String()
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		candidates = append(candidates, jid)
	}
	return candidates
}

func buildChatReadMessageKey(chat types.JID, key MessageKey) *waCommon.MessageKey {
	id := strings.TrimSpace(key.ID)
	if id == "" || chat.IsEmpty() {
		return nil
	}
	messageKey := &waCommon.MessageKey{
		RemoteJID: proto.String(chat.String()),
		FromMe:    proto.Bool(key.FromMeValue()),
		ID:        proto.String(id),
	}
	if participant := chatReadParticipant(chat, key); !participant.IsEmpty() {
		messageKey.Participant = proto.String(participant.String())
	}
	return messageKey
}

func chatReadParticipant(chat types.JID, key MessageKey) types.JID {
	if chat.Server == types.DefaultUserServer || chat.Server == types.HiddenUserServer || chat.Server == types.MessengerServer {
		return types.EmptyJID
	}
	for _, rawParticipant := range []string{key.Participant, key.ParticipantAlt, key.ParticipantAltC} {
		if strings.TrimSpace(rawParticipant) == "" {
			continue
		}
		participant, err := parseJID(rawParticipant)
		if err == nil && !participant.IsEmpty() {
			return nonADJID(participant)
		}
	}
	return types.EmptyJID
}

func firstUnsupportedContent(content map[string]any) string {
	for _, key := range []string{
		"template",
		"template_buttons",
		"buttons",
		"button",
		"interactive",
		"list",
		"list_response",
		"product",
		"product_message",
		"poll",
		"poll_creation",
		"poll_update",
		"flow",
		"flow_response",
		"pin",
		"ephemeral",
		"broadcast",
		"broadcast_list",
		"call",
		"voice_call",
		"video_call",
	} {
		if value, ok := content[key]; ok && value != nil {
			return key
		}
	}
	return ""
}

func splitStatusValue(value string) (string, string) {
	parts := strings.Split(value, "|")
	url := strings.TrimSpace(parts[0])
	if len(parts) == 1 {
		return url, ""
	}
	return url, strings.TrimSpace(strings.Join(parts[1:], "|"))
}

func resolveMediaDownloadRequestTimeout() time.Duration {
	raw := strings.TrimSpace(os.Getenv("MEDIA_DOWNLOAD_REQUEST_TIMEOUT_MS"))
	if raw == "" {
		return defaultMediaDownloadRequestTimeout
	}
	timeoutMs, err := strconv.ParseInt(raw, 10, 64)
	if err != nil ||
		timeoutMs <= 0 ||
		timeoutMs > int64((time.Duration(1<<63-1)/time.Millisecond)) {
		return defaultMediaDownloadRequestTimeout
	}
	return time.Duration(timeoutMs) * time.Millisecond
}

func resolveMediaDownloadMaxBytes() int64 {
	raw := strings.TrimSpace(os.Getenv("MEDIA_DOWNLOAD_MAX_BYTES"))
	if raw == "" {
		return defaultMediaDownloadMaxBytes
	}
	maxBytes, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || maxBytes <= 0 || maxBytes == int64(1<<63-1) {
		return defaultMediaDownloadMaxBytes
	}
	return maxBytes
}

func downloadURL(ctx context.Context, rawURL string) ([]byte, string, string, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	downloadCtx, cancel := context.WithTimeout(
		ctx,
		resolveMediaDownloadRequestTimeout(),
	)
	defer cancel()

	req, err := http.NewRequestWithContext(downloadCtx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, "", "", fmt.Errorf("%w: %v", errMediaDownloadInvalidURL, err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, "", "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, "", "", &mediaDownloadHTTPError{
			StatusCode: resp.StatusCode,
			Status:     resp.Status,
		}
	}
	maxBytes := resolveMediaDownloadMaxBytes()
	if resp.ContentLength > maxBytes {
		return nil, "", "", fmt.Errorf(
			"%w: content_length=%d max_bytes=%d",
			errMediaDownloadTooLarge,
			resp.ContentLength,
			maxBytes,
		)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxBytes+1))
	if err != nil {
		return nil, "", "", err
	}
	if int64(len(body)) > maxBytes {
		return nil, "", "", fmt.Errorf(
			"%w: received_bytes>%d",
			errMediaDownloadTooLarge,
			maxBytes,
		)
	}
	contentType := resp.Header.Get("Content-Type")
	fileName := path.Base(req.URL.Path)
	if fileName == "." || fileName == "/" || fileName == "" {
		fileName = randomHex(8) + extensionFromMime(contentType)
	}
	return body, contentType, fileName, nil
}

func extensionFromMime(mimetype string) string {
	if mimetype == "" {
		return ".bin"
	}
	if exts, err := mime.ExtensionsByType(strings.Split(mimetype, ";")[0]); err == nil && len(exts) > 0 {
		return exts[0]
	}
	return ".bin"
}

func asMap(value any) map[string]any {
	switch typed := value.(type) {
	case map[string]any:
		return typed
	default:
		return map[string]any{}
	}
}

func stringValue(value any) string {
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case fmt.Stringer:
		return strings.TrimSpace(typed.String())
	case json.Number:
		return typed.String()
	case float64:
		return strconv.FormatFloat(typed, 'f', -1, 64)
	case int:
		return strconv.Itoa(typed)
	case int8:
		return strconv.FormatInt(int64(typed), 10)
	case int16:
		return strconv.FormatInt(int64(typed), 10)
	case int32:
		return strconv.FormatInt(int64(typed), 10)
	case int64:
		return strconv.FormatInt(typed, 10)
	case uint:
		return strconv.FormatUint(uint64(typed), 10)
	case uint8:
		return strconv.FormatUint(uint64(typed), 10)
	case uint16:
		return strconv.FormatUint(uint64(typed), 10)
	case uint32:
		return strconv.FormatUint(uint64(typed), 10)
	case uint64:
		return strconv.FormatUint(typed, 10)
	default:
		return ""
	}
}

func valueString(value any, key string) string {
	return stringValue(asMap(value)[key])
}

func boolValue(value any) bool {
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		normalized := strings.ToLower(strings.TrimSpace(typed))
		return normalized == "true" || normalized == "1" || normalized == "yes" || normalized == "on"
	case float64:
		return typed == 1
	default:
		return false
	}
}

func optionalBoolValue(value any) (bool, bool) {
	if value == nil {
		return false, false
	}
	switch typed := value.(type) {
	case bool:
		return typed, true
	case string:
		normalized := strings.ToLower(strings.TrimSpace(typed))
		if normalized == "" {
			return false, false
		}
		return normalized == "true" || normalized == "1" || normalized == "yes" || normalized == "on", true
	case float64:
		return typed == 1, true
	case float32:
		return typed == 1, true
	case int:
		return typed == 1, true
	case int64:
		return typed == 1, true
	case uint32:
		return typed == 1, true
	case uint64:
		return typed == 1, true
	case json.Number:
		parsed, err := typed.Int64()
		if err != nil {
			return false, false
		}
		return parsed == 1, true
	default:
		return false, false
	}
}

func outgoingAudioPTT(media map[string]any, viewOnce bool) bool {
	if viewOnce {
		return true
	}
	for _, key := range []string{"ptt", "is_voice", "isVoice"} {
		if value, ok := optionalBoolValue(media[key]); ok {
			return value
		}
	}
	return true
}

func outgoingAudioWaveform(media map[string]any, ptt bool) []byte {
	if !ptt {
		return nil
	}
	return bytesFromJSONValue(firstNonEmptyAny(media["waveform"], media["waveform_base64"], media["waveformBase64"]))
}

func floatValue(value any) float64 {
	switch typed := value.(type) {
	case float64:
		return typed
	case float32:
		return float64(typed)
	case int:
		return float64(typed)
	case int64:
		return float64(typed)
	case uint32:
		return float64(typed)
	case uint64:
		return float64(typed)
	case json.Number:
		parsed, _ := typed.Float64()
		return parsed
	case string:
		parsed, _ := strconv.ParseFloat(strings.TrimSpace(typed), 64)
		return parsed
	default:
		return 0
	}
}

func uint32Value(value any) uint32 {
	if value == nil {
		return 0
	}
	if parsed := floatValue(value); parsed > 0 {
		return uint32(parsed)
	}
	return 0
}

func uint64Value(value any) uint64 {
	if value == nil {
		return 0
	}
	if parsed := floatValue(value); parsed > 0 {
		return uint64(parsed)
	}
	return 0
}

func firstNonEmptyAny(values ...any) any {
	for _, value := range values {
		if value == nil {
			continue
		}
		if stringValue(value) != "" {
			return value
		}
		switch typed := value.(type) {
		case int:
			if typed != 0 {
				return value
			}
		case int64:
			if typed != 0 {
				return value
			}
		case uint32:
			if typed != 0 {
				return value
			}
		case uint64:
			if typed != 0 {
				return value
			}
		case float32:
			if typed != 0 {
				return value
			}
		case float64:
			if typed != 0 {
				return value
			}
		case bool:
			return value
		}
	}
	return nil
}

func stringSlice(value any) []string {
	switch typed := value.(type) {
	case []string:
		return typed
	case []any:
		out := make([]string, 0, len(typed))
		for _, item := range typed {
			if value := stringValue(item); value != "" {
				out = append(out, value)
			}
		}
		return out
	default:
		return nil
	}
}

func bytesFromJSONValue(value any) []byte {
	switch typed := value.(type) {
	case []byte:
		return typed
	case string:
		encoded := strings.TrimSpace(typed)
		if strings.HasPrefix(encoded, "data:") {
			if _, payload, ok := strings.Cut(encoded, ","); ok {
				encoded = payload
			}
		}
		data, err := base64.StdEncoding.DecodeString(encoded)
		if err == nil {
			return data
		}
	case []any:
		out := make([]byte, 0, len(typed))
		for _, item := range typed {
			out = append(out, byte(floatValue(item)))
		}
		return out
	case map[string]any:
		return bytesFromJSONValue(typed["data"])
	}
	return nil
}

func messageKeyFromSendResult(result map[string]any) string {
	return valueString(result["key"], "id")
}

func mapToChatMessage(raw []byte) (ChatMessage, error) {
	var data ChatMessage
	if err := json.Unmarshal(raw, &data); err != nil {
		return data, err
	}
	var rawMap map[string]any
	_ = json.Unmarshal(raw, &rawMap)
	data.Raw = rawMap
	return data, nil
}

func mapToProfileStatusMessage(raw []byte) (ProfileStatusMessage, bool, error) {
	rawMap, err := mapToRawPayload(raw)
	if err != nil {
		return ProfileStatusMessage{}, false, err
	}
	if stringValue(rawMap["worker_profile_status_id"]) == "" || stringValue(rawMap["external_id"]) != "" {
		return ProfileStatusMessage{}, false, nil
	}
	if stringValue(rawMap["worker_profile_status_type_id"]) == "" {
		return ProfileStatusMessage{}, false, nil
	}
	var data ProfileStatusMessage
	if err := json.Unmarshal(raw, &data); err != nil {
		return ProfileStatusMessage{}, false, err
	}
	data.Raw = rawMap
	return data, true, nil
}

func mapToProfileStatusDeleteMessage(raw []byte) (ProfileStatusDeleteMessage, bool, error) {
	rawMap, err := mapToRawPayload(raw)
	if err != nil {
		return ProfileStatusDeleteMessage{}, false, err
	}
	if stringValue(rawMap["worker_profile_status_id"]) == "" || stringValue(rawMap["external_id"]) == "" {
		return ProfileStatusDeleteMessage{}, false, nil
	}
	var data ProfileStatusDeleteMessage
	if err := json.Unmarshal(raw, &data); err != nil {
		return ProfileStatusDeleteMessage{}, false, err
	}
	data.Raw = rawMap
	return data, true, nil
}

func mapToProfileInfoMessage(raw []byte) (ProfileInfoMessage, bool, error) {
	rawMap, err := mapToRawPayload(raw)
	if err != nil {
		return ProfileInfoMessage{}, false, err
	}
	if stringValue(rawMap["message_id"]) != "" || stringValue(rawMap["worker_profile_status_id"]) != "" {
		return ProfileInfoMessage{}, false, nil
	}
	if stringValue(rawMap["worker_id"]) == "" || stringValue(rawMap["account_id"]) == "" {
		return ProfileInfoMessage{}, false, nil
	}
	_, hasName := rawMap["name"]
	_, hasMessage := rawMap["message"]
	photoValue, hasPhoto := rawMap["photo"]
	if !hasName && !hasMessage && !hasPhoto {
		return ProfileInfoMessage{}, false, nil
	}
	var data ProfileInfoMessage
	if err := json.Unmarshal(raw, &data); err != nil {
		return ProfileInfoMessage{}, false, err
	}
	data.PhotoPresent = hasPhoto
	data.PhotoRemove = hasPhoto && photoValue == nil
	data.Raw = rawMap
	return data, true, nil
}

func mapToRawPayload(raw []byte) (map[string]any, error) {
	var rawMap map[string]any
	if err := json.Unmarshal(raw, &rawMap); err != nil {
		return nil, err
	}
	if rawMap == nil {
		rawMap = map[string]any{}
	}
	return rawMap, nil
}

func waKeyMap(key MessageKey) map[string]any {
	return map[string]any{
		"id":          key.ID,
		"remoteJid":   key.Remote(),
		"fromMe":      key.FromMeValue(),
		"participant": key.Participant,
	}
}
