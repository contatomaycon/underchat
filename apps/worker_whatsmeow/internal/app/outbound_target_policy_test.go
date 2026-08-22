package app

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"testing"
	"time"
)

func TestOutboundTargetBusinessRejectionClassification(t *testing.T) {
	t.Parallel()

	for _, rejection := range []error{
		errOutboundTargetNotRegistered,
		errOutboundTargetInvalid,
	} {
		rejection := rejection
		t.Run(rejection.Error(), func(t *testing.T) {
			t.Parallel()
			if !isOutboundTargetBusinessRejection(fmt.Errorf("wrapped: %w", rejection)) {
				t.Fatalf("wrapped rejection was not classified: %v", rejection)
			}
		})
	}

	for _, operational := range []error{
		errOutboundTargetLIDUnavailable,
		context.Canceled,
		context.DeadlineExceeded,
		errors.New("USync unavailable"),
	} {
		if isOutboundTargetBusinessRejection(operational) {
			t.Fatalf("operational failure was classified as a business rejection: %v", operational)
		}
	}
}

func TestOutboundPreProviderFailureClassificationFailsOpenForInfrastructure(t *testing.T) {
	t.Parallel()

	permanent := []error{
		fmt.Errorf("wrapped target: %w", errOutboundTargetNotRegistered),
		fmt.Errorf("wrapped payload: %w", errOutboundPayloadInvalid),
		fmt.Errorf("wrapped oversize: %w", errMediaDownloadTooLarge),
		fmt.Errorf("wrapped URL: %w", errMediaDownloadInvalidURL),
		UnsupportedFeatureError{Feature: "future_content"},
		&mediaDownloadHTTPError{StatusCode: http.StatusNotFound, Status: "404 Not Found"},
	}
	for _, failure := range permanent {
		if !isPermanentOutboundPreProviderFailure(failure) {
			t.Fatalf("deterministic failure was not classified as permanent: %v", failure)
		}
	}

	transient := []error{
		ErrWhatsAppNotReady,
		errKafkaConsumerDispatchRevoked,
		errWhatsAppRuntimeFenceRevoked,
		errOutboundTargetLIDUnavailable,
		errOutboundProviderAdmissionUnavailable,
		errTypingSimulationLocalDeadline,
		errTypingSimulationSaturated,
		context.Canceled,
		context.DeadlineExceeded,
		errors.New("provider capacity exhausted"),
		&mediaDownloadHTTPError{StatusCode: http.StatusRequestTimeout, Status: "408 Request Timeout"},
		&mediaDownloadHTTPError{StatusCode: http.StatusTooManyRequests, Status: "429 Too Many Requests"},
		&mediaDownloadHTTPError{StatusCode: http.StatusServiceUnavailable, Status: "503 Service Unavailable"},
	}
	for _, failure := range transient {
		if isPermanentOutboundPreProviderFailure(failure) {
			t.Fatalf("transient failure was classified as permanent: %v", failure)
		}
	}
}

func TestTerminalizeOutboundTargetBusinessRejectionOnlyAfterPersistence(t *testing.T) {
	t.Parallel()

	persistCalls := 0
	rejection := fmt.Errorf("resolve target: %w", errOutboundTargetNotRegistered)
	err := terminalizeOutboundTargetBusinessRejection(rejection, func() error {
		persistCalls++
		return nil
	})
	if persistCalls != 1 {
		t.Fatalf("business rejection persistence ran %d times", persistCalls)
	}
	if !shouldCommitTerminalKafkaHandlerError(err) {
		t.Fatalf("persisted business rejection was not terminal: %v", err)
	}
	if !errors.Is(err, errOutboundTargetNotRegistered) {
		t.Fatalf("business rejection cause was not preserved: %v", err)
	}

	persistenceErr := errors.New("Redis unavailable")
	err = terminalizeOutboundTargetBusinessRejection(rejection, func() error {
		return persistenceErr
	})
	if shouldCommitTerminalKafkaHandlerError(err) {
		t.Fatalf("failed persistence retained a terminal Kafka marker: %v", err)
	}
	if !errors.Is(err, errOutboundTargetNotRegistered) ||
		!errors.Is(err, persistenceErr) {
		t.Fatalf("persistence failure causes were not preserved: %v", err)
	}
}

func TestTerminalizeOutboundTargetOperationalFailureRemainsRetryable(t *testing.T) {
	t.Parallel()

	persistCalls := 0
	err := terminalizeOutboundTargetBusinessRejection(
		fmt.Errorf("lookup failed: %w", errOutboundTargetLIDUnavailable),
		func() error {
			persistCalls++
			return nil
		},
	)
	if persistCalls != 0 {
		t.Fatalf("operational failure ran terminal persistence %d times", persistCalls)
	}
	if shouldCommitTerminalKafkaHandlerError(err) {
		t.Fatalf("operational failure was marked terminal: %v", err)
	}
	if !errors.Is(err, errOutboundTargetLIDUnavailable) {
		t.Fatalf("operational cause was not preserved: %v", err)
	}
}

func TestRecordOutboundFailureDoesNotDegradeForBusinessRejection(t *testing.T) {
	t.Parallel()

	for _, rejection := range []error{
		errOutboundTargetNotRegistered,
		errOutboundTargetInvalid,
	} {
		rejection := rejection
		t.Run(rejection.Error(), func(t *testing.T) {
			t.Parallel()
			manager := &WhatsAppManager{
				cfg: Config{
					OutboundFailureReconnectThreshold: 1,
				},
			}
			manager.recordOutboundFailure(
				context.Background(),
				ChatMessage{},
				time.Millisecond,
				fmt.Errorf("connection timeout while resolving target: %w", rejection),
			)

			manager.mu.Lock()
			defer manager.mu.Unlock()
			if manager.consecutiveSendFailures != 0 {
				t.Fatalf(
					"business rejection incremented send failures: %d",
					manager.consecutiveSendFailures,
				)
			}
			if manager.degradedReason != "" {
				t.Fatalf("business rejection degraded the channel: %q", manager.degradedReason)
			}
			if !manager.lastOutboundReconnectAt.IsZero() {
				t.Fatalf(
					"business rejection requested reconnect at %s",
					manager.lastOutboundReconnectAt,
				)
			}
			if manager.lastSendErrorAt.IsZero() {
				t.Fatal("business rejection lost failure observability")
			}
		})
	}
}

func TestRecordOutboundFailureStillTracksOperationalLIDFailure(t *testing.T) {
	t.Parallel()

	manager := &WhatsAppManager{
		cfg: Config{
			OutboundFailureReconnectThreshold: 3,
		},
	}
	manager.recordOutboundFailure(
		context.Background(),
		ChatMessage{},
		time.Millisecond,
		fmt.Errorf("resolve target: %w", errOutboundTargetLIDUnavailable),
	)

	manager.mu.Lock()
	defer manager.mu.Unlock()
	if manager.consecutiveSendFailures != 1 {
		t.Fatalf(
			"operational LID failure was not tracked: %d",
			manager.consecutiveSendFailures,
		)
	}
	if manager.degradedReason != "outbound_send_failed" {
		t.Fatalf("unexpected operational degraded reason %q", manager.degradedReason)
	}
}

func TestOutboundTimeoutResetsImmediatelyWhileFastTransportErrorsUseThreshold(t *testing.T) {
	t.Parallel()

	if reason := outboundFailureResetReason(
		1,
		3,
		context.DeadlineExceeded,
	); reason != "outbound_send_stalled" {
		t.Fatalf("first provider deadline reset reason=%q", reason)
	}
	if reason := outboundFailureResetReason(
		1,
		3,
		errors.New("websocket connection reset"),
	); reason != "" {
		t.Fatalf("first fast transport error reset early: %q", reason)
	}
	if reason := outboundFailureResetReason(
		2,
		3,
		errors.New("websocket connection reset"),
	); reason != "" {
		t.Fatalf("second fast transport error reset early: %q", reason)
	}
	if reason := outboundFailureResetReason(
		3,
		3,
		errors.New("websocket connection reset"),
	); reason != "outbound_failure_threshold" {
		t.Fatalf("threshold transport reset reason=%q", reason)
	}
}

func TestNonTerminalKafkaHandlerCauseRemovesCommitMarker(t *testing.T) {
	t.Parallel()

	cause := fmt.Errorf("invalid target: %w", errOutboundTargetInvalid)
	err := nonTerminalKafkaHandlerCause(terminalKafkaHandlerError(cause))
	if shouldCommitTerminalKafkaHandlerError(err) {
		t.Fatalf("non-terminal cause retained commit marker: %v", err)
	}
	if !errors.Is(err, errOutboundTargetInvalid) {
		t.Fatalf("non-terminal cause was not preserved: %v", err)
	}
}

func TestScheduleBusinessRejectionFinalizationOrdersCrashSafeEffects(t *testing.T) {
	t.Parallel()

	var order []string
	err := runScheduleOutboundBusinessRejectionFinalization(
		func() error {
			order = append(order, "recovery_removed")
			return nil
		},
		func() error {
			order = append(order, "claim_failed")
			return nil
		},
		func() error {
			order = append(order, "operational_pre_provider_failed")
			return nil
		},
		func() error {
			order = append(order, "status_failed")
			return nil
		},
	)
	if err != nil {
		t.Fatalf("finalize schedule business rejection: %v", err)
	}
	want := []string{
		"recovery_removed",
		"claim_failed",
		"operational_pre_provider_failed",
		"status_failed",
	}
	if fmt.Sprint(order) != fmt.Sprint(want) {
		t.Fatalf("unsafe finalization order: got=%v want=%v", order, want)
	}
}

func TestScheduleBusinessRejectionFinalizationStopsAtEveryCrashPoint(t *testing.T) {
	t.Parallel()

	const stepCount = 4
	for failAt := 0; failAt < stepCount; failAt++ {
		failAt := failAt
		t.Run(fmt.Sprintf("step_%d", failAt), func(t *testing.T) {
			t.Parallel()
			calls := 0
			crashErr := errors.New("simulated process interruption")
			step := func() error {
				current := calls
				calls++
				if current == failAt {
					return crashErr
				}
				return nil
			}

			err := runScheduleOutboundBusinessRejectionFinalization(
				step,
				step,
				step,
				step,
			)
			if !errors.Is(err, crashErr) {
				t.Fatalf("crash cause was not preserved: %v", err)
			}
			if calls != failAt+1 {
				t.Fatalf(
					"finalization continued after crash point: calls=%d want=%d",
					calls,
					failAt+1,
				)
			}
		})
	}
}

func TestScheduleBusinessRejectionPostLedgerFailureRemainsRetryable(t *testing.T) {
	t.Parallel()

	claimTransitions := 0
	operationalErr := errors.New("schedule operational Redis unavailable")
	rejection := fmt.Errorf("resolve target: %w", errOutboundTargetNotRegistered)
	err := terminalizeOutboundTargetBusinessRejection(rejection, func() error {
		return runScheduleOutboundBusinessRejectionFinalization(
			func() error {
				return nil
			},
			func() error {
				claimTransitions++
				return nil
			},
			func() error {
				return operationalErr
			},
			func() error {
				t.Fatal("status publication ran after failed operational persistence")
				return nil
			},
		)
	})
	if claimTransitions != 1 {
		t.Fatalf("outbound claim was terminalized %d times", claimTransitions)
	}
	if shouldCommitTerminalKafkaHandlerError(err) {
		t.Fatalf("post-ledger side-effect failure retained terminal marker: %v", err)
	}
	if !errors.Is(err, errOutboundTargetNotRegistered) ||
		!errors.Is(err, operationalErr) {
		t.Fatalf("post-ledger failure causes were not preserved: %v", err)
	}
}

func TestScheduleBusinessRejectionRedeliveryFinishesAfterTerminalLedger(t *testing.T) {
	t.Parallel()

	rejection := fmt.Errorf("resolve target: %w", errOutboundTargetNotRegistered)
	ledgerState := sendIdempotencyStateReserved
	claimTransitions := 0
	recoveryRemovals := 0
	operationalWrites := 0
	statusPublications := 0
	firstAttemptErr := errors.New("simulated crash after terminal ledger")

	runAttempt := func(failAfterLedger bool) error {
		return terminalizeOutboundTargetBusinessRejection(rejection, func() error {
			return runScheduleOutboundBusinessRejectionFinalization(
				func() error {
					recoveryRemovals++
					return nil
				},
				func() error {
					if ledgerState == sendIdempotencyStateFailed {
						return nil
					}
					claimTransitions++
					ledgerState = sendIdempotencyStateFailed
					return nil
				},
				func() error {
					if failAfterLedger {
						return firstAttemptErr
					}
					operationalWrites++
					return nil
				},
				func() error {
					statusPublications++
					return nil
				},
			)
		})
	}

	firstErr := runAttempt(true)
	if shouldCommitTerminalKafkaHandlerError(firstErr) {
		t.Fatalf("crashed first attempt retained terminal marker: %v", firstErr)
	}
	if !errors.Is(firstErr, firstAttemptErr) {
		t.Fatalf("crash cause was not preserved: %v", firstErr)
	}
	if ledgerState != sendIdempotencyStateFailed || claimTransitions != 1 {
		t.Fatalf(
			"first attempt did not retain terminal ledger: state=%s transitions=%d",
			ledgerState,
			claimTransitions,
		)
	}

	secondErr := runAttempt(false)
	if !shouldCommitTerminalKafkaHandlerError(secondErr) {
		t.Fatalf("redelivery did not become terminal after finishing effects: %v", secondErr)
	}
	if claimTransitions != 1 {
		t.Fatalf("redelivery rewrote terminal ledger %d times", claimTransitions)
	}
	if recoveryRemovals != 2 {
		t.Fatalf("redelivery did not retry recovery cleanup: %d", recoveryRemovals)
	}
	if operationalWrites != 1 || statusPublications != 1 {
		t.Fatalf(
			"redelivery did not finish schedule effects: operational=%d status=%d",
			operationalWrites,
			statusPublications,
		)
	}
}
