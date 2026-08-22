package app

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/segmentio/kafka-go"
)

func TestOutboundSendIdempotencyKeyMatchesSharedV4Contract(t *testing.T) {
	key, err := outboundSendIdempotencyKey(outboundSendOperation{
		AccountID: " account-1 ",
		Type:      "direct",
		ID:        "operation-123",
	})
	if err != nil {
		t.Fatalf("build key: %v", err)
	}
	want := "message-send:idempotency:v4:account-1:e6bc38ac0678af03d74fdbc9acf5e0277f5e353d5578eaab0da84bbcf2e5976f"
	if key != want {
		t.Fatalf("unexpected shared key\nwant: %s\n got: %s", want, key)
	}
}

func TestOutboundIdentityAllowsRepeatedContentWithDistinctOperations(t *testing.T) {
	first, err := outboundSendIdempotencyKey(outboundSendOperation{AccountID: "a1", Type: "direct", ID: "message-1"})
	if err != nil {
		t.Fatal(err)
	}
	second, err := outboundSendIdempotencyKey(outboundSendOperation{AccountID: "a1", Type: "direct", ID: "message-2"})
	if err != nil {
		t.Fatal(err)
	}
	if first == second {
		t.Fatal("distinct user operations must not be deduplicated even when their content is equal")
	}
}

func TestTransportHashProducesSameV4KeyAsMessageIDFallback(t *testing.T) {
	message := ChatMessage{
		MessageID: "message-id",
		ChatID:    "chat-1",
		Hash:      "e68dc070f5ce0151f86c42da8479ed27f1826a967283b5fd0c21d2c0e488e1a4",
		Account:   map[string]any{"id": "account-1"},
	}
	operationID := chatMessageOperationID(message)
	key, err := outboundSendIdempotencyKey(outboundSendOperation{AccountID: "account-1", Type: "direct", ID: operationID})
	if err != nil {
		t.Fatal(err)
	}
	want := "message-send:idempotency:v4:account-1:c46c4f28350d86912fbedc1ce8acb516d297a20e8299bb4a6505efd0c0ae3ca2"
	if key != want {
		t.Fatalf("Go/TypeScript transport fallback diverged: want %s got %s", want, key)
	}
}

func TestTransportHashComparisonMatchesTypeScriptCaseSensitivity(t *testing.T) {
	message := ChatMessage{
		MessageID: "message-id",
		ChatID:    "chat-1",
		Hash:      strings.ToUpper("e68dc070f5ce0151f86c42da8479ed27f1826a967283b5fd0c21d2c0e488e1a4"),
		Account:   map[string]any{"id": "account-1"},
	}
	if got := chatMessageOperationID(message); got != message.Hash {
		t.Fatalf("uppercase logical hash must not be mistaken for the lowercase transport hash: want %q got %q", message.Hash, got)
	}
}

func TestWorkerCommandOperationIDMatchesTypeScriptContract(t *testing.T) {
	const envelopeOperationID = "message-123"
	msg := kafka.Message{
		Topic:     "worker.worker-1.send.message",
		Partition: 2,
		Offset:    42,
		Headers: []kafka.Header{
			{Key: workerCommandHeaderOperationID, Value: []byte(envelopeOperationID)},
		},
	}
	want := envelopeOperationID
	operationID := workerCommandOperationID(msg)
	if operationID != want {
		got := operationID
		t.Fatalf("worker command identity diverged from TypeScript: want %q got %q", want, got)
	}
	key, err := outboundSendIdempotencyKey(outboundSendOperation{
		AccountID: "account-1",
		Type:      "direct",
		ID:        operationID,
	})
	if err != nil {
		t.Fatal(err)
	}
	const wantKey = "message-send:idempotency:v4:account-1:b53e1c64580e3d50e1eb8ab00431fb01d47c39971498e17a1ea323b79ef4296d"
	if key != wantKey {
		t.Fatalf("worker command v4 key diverged from TypeScript: want %q got %q", wantKey, key)
	}
}

func TestProviderInvocationBoundaryRunsImmediatelyBeforeProvider(t *testing.T) {
	var order []string
	result, err := invokeProviderCallAtBoundary(
		context.Background(),
		func(context.Context) error {
			order = append(order, "provider_invoked")
			return nil
		},
		func(context.Context) (string, error) {
			order = append(order, "provider_call")
			return "ok", nil
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if result != "ok" || strings.Join(order, ",") != "provider_invoked,provider_call" {
		t.Fatalf("unexpected provider boundary result=%q order=%v", result, order)
	}
}

func TestProviderInvocationBoundaryFailurePreventsProviderCall(t *testing.T) {
	boundaryErr := errors.New("redis transition uncertain")
	providerCalls := 0
	_, err := invokeProviderCallAtBoundary(
		context.Background(),
		func(context.Context) error { return boundaryErr },
		func(context.Context) (string, error) {
			providerCalls++
			return "", nil
		},
	)
	if !errors.Is(err, boundaryErr) {
		t.Fatalf("expected boundary error, got %v", err)
	}
	if providerCalls != 0 {
		t.Fatalf("provider was called %d times after an uncertain boundary", providerCalls)
	}
}

func TestOutboundProviderInvocationFenceReversesAfterImmediatePostCASRevocation(t *testing.T) {
	worker := &Worker{}
	worker.kafkaConsumerBarrierEpoch.Store(7)
	worker.kafkaConsumersReady.Store(true)
	worker.kafkaConsumersAuthorized.Store(true)

	var authorizedCtx context.Context
	handler := worker.authorizedKafkaHandler(func(ctx context.Context, _ kafka.Message) error {
		authorizedCtx = ctx
		return nil
	})
	if err := handler(context.Background(), kafka.Message{Topic: "worker.w1.send.message", Partition: 0, Offset: 9}); err != nil {
		t.Fatalf("capture authorized dispatch: %v", err)
	}

	state := sendIdempotencyStateReserved
	assertCalls := 0
	markCalls := 0
	revertCalls := 0
	providerCalls := 0
	providerInvoked := false
	boundary := func(ctx context.Context) error {
		return runOutboundProviderInvocationFence(
			ctx,
			&providerInvoked,
			func(assertCtx context.Context) error {
				assertCalls++
				return worker.assertKafkaDispatchAuthorized(assertCtx)
			},
			func(context.Context) error {
				markCalls++
				state = sendIdempotencyStateInvoked
				// Revoke while the provider_invoked Redis round-trip is in flight,
				// then reopen authorization to reproduce an ABA race.
				worker.kafkaConsumersReady.Store(false)
				worker.revokeKafkaConsumerAuthorization()
				worker.kafkaConsumersReady.Store(true)
				worker.kafkaConsumersAuthorized.Store(true)
				return nil
			},
			func(_ context.Context, cause error) error {
				if !errors.Is(cause, errKafkaConsumerDispatchRevoked) {
					t.Fatalf("unexpected reversal cause: %v", cause)
				}
				revertCalls++
				state = sendIdempotencyStateReserved
				return nil
			},
		)
	}

	result, err := invokeProviderCallAtBoundary(authorizedCtx, boundary, func(context.Context) (string, error) {
		providerCalls++
		return "sent", nil
	})
	if !errors.Is(err, errKafkaConsumerDispatchRevoked) || result != "" {
		t.Fatalf("post-CAS revocation was not returned result=%q err=%v", result, err)
	}
	if assertCalls != 2 || markCalls != 1 || revertCalls != 1 {
		t.Fatalf("unexpected fence calls assert=%d mark=%d revert=%d", assertCalls, markCalls, revertCalls)
	}
	if state != sendIdempotencyStateReserved {
		t.Fatalf("revoked provider transition state=%s", state)
	}
	if providerInvoked {
		t.Fatal("confirmed reversal retained provider_invoked")
	}
	if providerCalls != 0 {
		t.Fatalf("provider was called %d times after post-CAS revocation", providerCalls)
	}
}

func TestOutboundProviderInvocationFenceKeepsUncertainReversalFailClosed(t *testing.T) {
	deadlineErr := context.DeadlineExceeded
	revertErr := errors.New("redis reversal response uncertain")
	assertCalls := 0
	providerInvoked := false
	providerCalls := 0

	boundary := func(ctx context.Context) error {
		return runOutboundProviderInvocationFence(
			ctx,
			&providerInvoked,
			func(context.Context) error {
				assertCalls++
				if assertCalls == 2 {
					return deadlineErr
				}
				return nil
			},
			func(context.Context) error { return nil },
			func(context.Context, error) error { return revertErr },
		)
	}

	result, err := invokeProviderCallAtBoundary(
		context.Background(),
		boundary,
		func(context.Context) (string, error) {
			providerCalls++
			return "sent", nil
		},
	)
	if !errors.Is(err, deadlineErr) || !errors.Is(err, revertErr) || result != "" {
		t.Fatalf("uncertain reversal did not remain fail-closed result=%q err=%v", result, err)
	}
	if !providerInvoked {
		t.Fatal("uncertain reversal cleared provider_invoked")
	}
	if providerCalls != 0 || assertCalls != 2 {
		t.Fatalf(
			"unexpected post-CAS calls provider=%d authorization=%d",
			providerCalls,
			assertCalls,
		)
	}
}

func TestOutboundProviderInvocationFenceRechecksSameCompositeConnectionAuthority(t *testing.T) {
	connectionGeneration := 11
	expectedGeneration := connectionGeneration
	authorizationOrder := make([]string, 0, 8)
	providerInvoked := false
	providerCalls := 0
	revertCalls := 0

	authorize := func(context.Context) error {
		authorizationOrder = append(authorizationOrder, "connection")
		if connectionGeneration != expectedGeneration {
			return errWhatsAppRuntimeFenceRevoked
		}
		authorizationOrder = append(authorizationOrder, "kafka")
		return nil
	}
	boundary := func(ctx context.Context) error {
		return runOutboundProviderInvocationFence(
			ctx,
			&providerInvoked,
			authorize,
			func(context.Context) error {
				authorizationOrder = append(authorizationOrder, "mark")
				connectionGeneration++
				return nil
			},
			func(context.Context, error) error {
				revertCalls++
				authorizationOrder = append(authorizationOrder, "revert")
				return nil
			},
		)
	}

	_, err := invokeProviderCallAtBoundary(
		context.Background(),
		boundary,
		func(context.Context) (string, error) {
			providerCalls++
			return "sent", nil
		},
	)
	if !errors.Is(err, errWhatsAppRuntimeFenceRevoked) {
		t.Fatalf("connection revocation during mark was not fenced: %v", err)
	}
	if providerCalls != 0 || revertCalls != 1 || providerInvoked {
		t.Fatalf(
			"connection revocation crossed provider boundary calls=%d reverts=%d invoked=%t",
			providerCalls,
			revertCalls,
			providerInvoked,
		)
	}
	if got := strings.Join(authorizationOrder, ","); got != "connection,kafka,mark,connection,revert" {
		t.Fatalf("composite connection authority order = %s", got)
	}
}

func TestOutboundProviderInvocationFenceRechecksScheduleConnectionKafkaInOrder(t *testing.T) {
	scheduleLeaseActive := true
	connectionEpoch := "epoch-a"
	expectedEpoch := connectionEpoch
	kafkaAuthorized := true
	order := make([]string, 0, 10)
	providerInvoked := false
	providerCalls := 0
	revertCalls := 0

	authorize := func(context.Context) error {
		order = append(order, "schedule")
		if !scheduleLeaseActive {
			return errScheduleMessageAttemptLeaseLost
		}
		order = append(order, "connection")
		if connectionEpoch != expectedEpoch {
			return errWhatsAppRuntimeFenceRevoked
		}
		order = append(order, "kafka")
		if !kafkaAuthorized {
			return errKafkaConsumerDispatchRevoked
		}
		return nil
	}
	boundary := func(ctx context.Context) error {
		return runOutboundProviderInvocationFence(
			ctx,
			&providerInvoked,
			authorize,
			func(context.Context) error {
				order = append(order, "mark")
				scheduleLeaseActive = false
				return nil
			},
			func(context.Context, error) error {
				revertCalls++
				order = append(order, "revert")
				return nil
			},
		)
	}

	_, err := invokeProviderCallAtBoundary(
		context.Background(),
		boundary,
		func(context.Context) (string, error) {
			providerCalls++
			return "sent", nil
		},
	)
	if !errors.Is(err, errScheduleMessageAttemptLeaseLost) {
		t.Fatalf("schedule lease revocation during mark was not fenced: %v", err)
	}
	if providerCalls != 0 || revertCalls != 1 || providerInvoked {
		t.Fatalf(
			"schedule revocation crossed provider boundary calls=%d reverts=%d invoked=%t",
			providerCalls,
			revertCalls,
			providerInvoked,
		)
	}
	if got := strings.Join(order, ","); got != "schedule,connection,kafka,mark,schedule,revert" {
		t.Fatalf("schedule composite authorization order = %s", got)
	}
}

func TestOutboundProviderInvocationFenceRejectsConnectionEpochABA(t *testing.T) {
	type authority struct {
		epoch    string
		sequence int
	}
	current := authority{epoch: "epoch-a", sequence: 1}
	captured := current
	providerInvoked := false
	providerCalls := 0

	_, err := invokeProviderCallAtBoundary(
		context.Background(),
		func(ctx context.Context) error {
			return runOutboundProviderInvocationFence(
				ctx,
				&providerInvoked,
				func(context.Context) error {
					if current != captured {
						return errWhatsAppRuntimeFenceRevoked
					}
					return nil
				},
				func(context.Context) error {
					// The visible epoch returns to the old value, but the
					// monotonic sequence proves that authority changed.
					current = authority{epoch: "epoch-b", sequence: 2}
					current = authority{epoch: "epoch-a", sequence: 3}
					return nil
				},
				func(context.Context, error) error { return nil },
			)
		},
		func(context.Context) (string, error) {
			providerCalls++
			return "sent", nil
		},
	)
	if !errors.Is(err, errWhatsAppRuntimeFenceRevoked) {
		t.Fatalf("connection epoch ABA was not rejected: %v", err)
	}
	if providerCalls != 0 || providerInvoked {
		t.Fatalf("connection epoch ABA crossed provider boundary calls=%d invoked=%t", providerCalls, providerInvoked)
	}
}

func TestProviderInvocationBoundaryDetachesCancellationImmediatelyAfterCAS(t *testing.T) {
	type contextKey string
	const key contextKey = "provider-context-value"
	parent, cancel := context.WithCancel(
		context.WithValue(context.Background(), key, "preserved"),
	)
	parent = withProviderInvocationTimeout(parent, time.Second)

	providerCalls := 0
	result, err := invokeProviderCallAtBoundary(
		parent,
		func(context.Context) error {
			cancel()
			return nil
		},
		func(invokeCtx context.Context) (string, error) {
			providerCalls++
			if err := invokeCtx.Err(); err != nil {
				return "", fmt.Errorf("provider context was canceled: %w", err)
			}
			if invokeCtx.Value(key) != "preserved" {
				return "", errors.New("provider context values were not preserved")
			}
			return "ack", nil
		},
	)
	if err != nil || result != "ack" || providerCalls != 1 {
		t.Fatalf(
			"post-CAS cancellation fenced provider result=%q calls=%d err=%v",
			result,
			providerCalls,
			err,
		)
	}
}

func TestKnownProviderOutcomePersistenceIgnoresPostACKCancellation(t *testing.T) {
	parent, cancel := context.WithCancel(context.Background())
	cancel()
	persistenceCalls := 0
	err := persistOutboundProviderOutcome(
		parent,
		func(persistenceCtx context.Context) error {
			persistenceCalls++
			if err := persistenceCtx.Err(); err != nil {
				return fmt.Errorf("persistence inherited canceled assignment: %w", err)
			}
			return nil
		},
	)
	if err != nil || persistenceCalls != 1 {
		t.Fatalf(
			"known provider ACK was not persisted calls=%d err=%v",
			persistenceCalls,
			err,
		)
	}
}

func TestOutboundAmbiguousTransitionIsIdempotentForSameOwner(t *testing.T) {
	idempotentBranch := strings.Index(transitionOutboundSendScript, "if state == next_state then")
	expectedStateBranch := strings.Index(transitionOutboundSendScript, "if state ~= expected_state then")
	if idempotentBranch < 0 || expectedStateBranch < 0 || idempotentBranch > expectedStateBranch {
		t.Fatal("transition script must accept ambiguous -> ambiguous before rejecting the old expected state")
	}
	ownerCheck := strings.Index(transitionOutboundSendScript, "if current_owner ~= owner then")
	if ownerCheck < 0 || ownerCheck > idempotentBranch {
		t.Fatal("idempotent transition must remain protected by owner CAS")
	}
}

func TestOutboundIdempotencyAndRecoveryLeasesUseRedisClock(t *testing.T) {
	for name, script := range map[string]string{
		"claim":               claimOutboundSendScript,
		"transition":          transitionOutboundSendScript,
		"prepare_recovery":    prepareOutboundRecoveryScript,
		"claim_recovery":      claimOutboundRecoveryScript,
		"reschedule_recovery": rescheduleOutboundRecoveryScript,
	} {
		if !strings.Contains(script, "redis.call('TIME')") {
			t.Fatalf("%s script must derive deadlines from the shared Redis clock", name)
		}
	}
}

func TestUnacquiredInFlightClaimNeverCommitsCurrentAssignment(t *testing.T) {
	worker := &Worker{}
	const epoch = uint64(17)
	worker.kafkaConsumerBarrierEpoch.Store(epoch)
	worker.kafkaConsumersReady.Store(true)
	worker.kafkaConsumersAuthorized.Store(true)
	ctx := context.WithValue(
		context.Background(),
		kafkaDispatchAuthorizationContextKey{},
		kafkaDispatchAuthorization{worker: worker, epoch: epoch},
	)

	for _, state := range []string{sendIdempotencyStateReserved, sendIdempotencyStateInvoked} {
		t.Run(state, func(t *testing.T) {
			err := worker.resolveUnacquiredOutboundClaim(ctx, outboundSendClaim{
				Key:      "claim-" + state,
				State:    state,
				MetaJSON: `{"consumer_assignment_epoch":17}`,
			})
			if !shouldRestartKafkaGenerationWithoutCommit(err) {
				t.Fatalf("current in-flight state %s was commit-eligible: %v", state, err)
			}
		})
	}
}

func TestUnacquiredTerminalClaimIsCommitEligibleWithoutProviderRetry(t *testing.T) {
	worker := &Worker{}
	for _, state := range []string{
		sendIdempotencyStateSucceeded,
		sendIdempotencyStateFailed,
		sendIdempotencyStateAmbiguous,
	} {
		t.Run(state, func(t *testing.T) {
			if err := worker.resolveUnacquiredOutboundClaim(context.Background(), outboundSendClaim{State: state}); err != nil {
				t.Fatalf("terminal state %s unexpectedly requested retry: %v", state, err)
			}
		})
	}
}

func TestUnacquiredLegacyInFlightClaimFailsClosed(t *testing.T) {
	worker := &Worker{}
	const epoch = uint64(19)
	worker.kafkaConsumerBarrierEpoch.Store(epoch)
	worker.kafkaConsumersReady.Store(true)
	worker.kafkaConsumersAuthorized.Store(true)
	ctx := context.WithValue(
		context.Background(),
		kafkaDispatchAuthorizationContextKey{},
		kafkaDispatchAuthorization{worker: worker, epoch: epoch},
	)
	err := worker.resolveUnacquiredOutboundClaim(ctx, outboundSendClaim{
		Key:      "legacy-provider-invoked",
		State:    sendIdempotencyStateInvoked,
		MetaJSON: `{}`,
	})
	if !shouldRestartKafkaGenerationWithoutCommit(err) {
		t.Fatalf("legacy provider_invoked claim was silently committed: %v", err)
	}
}

func TestRepeatableProviderBoundaryDoesNotFenceCallsCoveredByDurableCAS(t *testing.T) {
	worker := &Worker{}
	worker.kafkaConsumerBarrierEpoch.Store(12)
	worker.kafkaConsumersReady.Store(true)
	worker.kafkaConsumersAuthorized.Store(true)

	var authorizedCtx context.Context
	handler := worker.authorizedKafkaHandler(func(ctx context.Context, _ kafka.Message) error {
		authorizedCtx = ctx
		return nil
	})
	if err := handler(context.Background(), kafka.Message{Topic: "worker.w1.send.message", Partition: 0, Offset: 10}); err != nil {
		t.Fatalf("capture authorized dispatch: %v", err)
	}

	providerInvoked := false
	markCalls := 0
	boundary := func(ctx context.Context) error {
		return runRepeatableOutboundProviderInvocationBoundary(
			ctx,
			&providerInvoked,
			worker.assertKafkaDispatchAuthorized,
			func(context.Context) error {
				markCalls++
				return nil
			},
		)
	}

	providerCall1 := 0
	if _, err := invokeProviderCallAtBoundary(authorizedCtx, boundary, func(context.Context) (string, error) {
		providerCall1++
		return "first", nil
	}); err != nil {
		t.Fatalf("first provider call failed: %v", err)
	}

	worker.kafkaConsumersReady.Store(false)
	worker.revokeKafkaConsumerAuthorization()
	worker.kafkaConsumersReady.Store(true)
	worker.kafkaConsumersAuthorized.Store(true)

	providerCall2 := 0
	_, err := invokeProviderCallAtBoundary(authorizedCtx, boundary, func(context.Context) (string, error) {
		providerCall2++
		return "second", nil
	})
	if err != nil {
		t.Fatalf("second provider call was fenced after durable CAS: %v", err)
	}
	if markCalls != 1 || providerCall1 != 1 || providerCall2 != 1 {
		t.Fatalf("unexpected repeated boundary calls mark=%d provider1=%d provider2=%d", markCalls, providerCall1, providerCall2)
	}
}

func TestSendChatMessagePreflightFailureDoesNotCrossInvocationBoundary(t *testing.T) {
	manager := &WhatsAppManager{cfg: Config{OutboundFailureReconnectThreshold: 100}}
	boundaryCalls := 0
	_, err := manager.SendChatMessageWithInvocationBoundary(
		context.Background(),
		ChatMessage{},
		func(context.Context) error { return nil },
		func(context.Context) error {
			boundaryCalls++
			return nil
		},
	)
	if err == nil {
		t.Fatal("expected disconnected provider preflight to fail")
	}
	if boundaryCalls != 0 {
		t.Fatalf("pre-provider failure crossed the invocation boundary %d times", boundaryCalls)
	}
}

func TestProfileCommandPreflightFailuresDoNotCrossInvocationBoundary(t *testing.T) {
	manager := &WhatsAppManager{}
	tests := map[string]func(providerInvocationBoundary) error{
		"status": func(boundary providerInvocationBoundary) error {
			_, err := manager.SendProfileStatusWithInvocationBoundary(context.Background(), ProfileStatusMessage{}, boundary)
			return err
		},
		"status_delete": func(boundary providerInvocationBoundary) error {
			return manager.DeleteProfileStatusWithInvocationBoundary(context.Background(), ProfileStatusDeleteMessage{}, boundary)
		},
		"profile_info": func(boundary providerInvocationBoundary) error {
			return manager.UpdateProfileInfoWithInvocationBoundary(context.Background(), ProfileInfoMessage{}, boundary)
		},
	}
	for name, run := range tests {
		t.Run(name, func(t *testing.T) {
			boundaryCalls := 0
			err := run(func(context.Context) error {
				boundaryCalls++
				return nil
			})
			if err == nil {
				t.Fatal("expected disconnected provider preflight to fail")
			}
			if boundaryCalls != 0 {
				t.Fatalf("pre-provider failure crossed the invocation boundary %d times", boundaryCalls)
			}
		})
	}
}

func TestOutboundIdempotencyFailsClosedWithoutRedisOrIdentity(t *testing.T) {
	worker := &Worker{}
	if _, err := worker.claimOutboundOperation(context.Background(), outboundSendOperation{AccountID: "a1", Type: "direct", ID: "m1"}, nil); err == nil {
		t.Fatal("missing redis must prevent a provider call")
	}
	if _, err := outboundSendIdempotencyKey(outboundSendOperation{AccountID: "a1", Type: "direct"}); err == nil {
		t.Fatal("missing operation identity must fail closed")
	}
}

func TestNotificationOperationIdentityIncludesDestination(t *testing.T) {
	first := NotificationMessage{NotificationID: "notification-1"}
	first.MessageKey.RemoteJID = "5511999999999@s.whatsapp.net"
	second := first
	second.MessageKey.RemoteJID = "5511888888888@s.whatsapp.net"
	if notificationOperationID(first) == notificationOperationID(second) {
		t.Fatal("same notification sent to different destinations must remain distinct")
	}
}

func TestNotificationOperationIdentityPrefersProducerIDAndNeverContent(t *testing.T) {
	first := NotificationMessage{
		OperationID:     " operation-1 ",
		NotificationID:  "notification-1",
		MessageWhatsApp: "same content",
	}
	first.MessageKey.RemoteJID = "5511999999999@s.whatsapp.net"

	retry := first
	retry.NotificationID = "changed-legacy-id"
	retry.MessageWhatsApp = "content changed during a retry"
	retry.MessageKey.RemoteJID = "5511888888888@s.whatsapp.net"
	if got := notificationOperationID(first); got != "operation-1" {
		t.Fatalf("producer operation_id was not normalized: %q", got)
	}
	if got := notificationOperationID(retry); got != "operation-1" {
		t.Fatalf("retry did not preserve producer operation_id: %q", got)
	}

	secondOperation := first
	secondOperation.OperationID = "operation-2"
	firstKey, err := outboundSendIdempotencyKey(outboundSendOperation{
		AccountID: "account-1",
		Type:      "notification",
		ID:        notificationOperationID(first),
	})
	if err != nil {
		t.Fatal(err)
	}
	secondKey, err := outboundSendIdempotencyKey(outboundSendOperation{
		AccountID: "account-1",
		Type:      "notification",
		ID:        notificationOperationID(secondOperation),
	})
	if err != nil {
		t.Fatal(err)
	}
	if firstKey == secondKey {
		t.Fatal("distinct producer operations with equal content were deduplicated")
	}
}

func TestNotificationLegacyIdentityKeepsPreviousContractWithoutContent(t *testing.T) {
	legacy := NotificationMessage{
		NotificationID:  "notification-1",
		MessageWhatsApp: "first text",
	}
	legacy.MessageKey.RemoteJID = "5511999999999@s.whatsapp.net"
	const expected = "notification-1\x00jid:5511999999999@s.whatsapp.net"
	if got := notificationOperationID(legacy); got != expected {
		t.Fatalf("legacy operation identity changed: want %q got %q", expected, got)
	}

	legacy.MessageWhatsApp = "same operation, changed text"
	if got := notificationOperationID(legacy); got != expected {
		t.Fatalf("legacy identity depends on message content: want %q got %q", expected, got)
	}

	malformed := NotificationMessage{MessageWhatsApp: "content must not become identity"}
	malformed.MessageKey.RemoteJID = "5511999999999@s.whatsapp.net"
	if got := notificationOperationID(malformed); got != "" {
		t.Fatalf("missing physical/operational ID fell back to content: %q", got)
	}
}

func TestCallAutoReplyIdentityConvergesAcrossOfferVariants(t *testing.T) {
	fromOffer := callAutoReplyOperationID("worker-1", "call-123")
	fromNotice := callAutoReplyOperationID("worker-1", "call-123")
	if fromOffer == "" || fromOffer != fromNotice {
		t.Fatalf("CallOffer and CallOfferNotice did not converge: %q != %q", fromOffer, fromNotice)
	}
	if fromOffer != "call-auto-reply:worker-1:call-123" {
		t.Fatalf("operation id diverged from WWebJS/Baileys: %q", fromOffer)
	}
	sharedKey, err := outboundSendIdempotencyKey(outboundSendOperation{
		AccountID: "account-1",
		Type:      "direct",
		ID:        fromOffer,
	})
	if err != nil {
		t.Fatal(err)
	}
	if want := "message-send:idempotency:v4:account-1:2b5d8b5c46698532a42fdc44d75c438792350ffcb7e5ac1d7e9f21df2a81e14e"; sharedKey != want {
		t.Fatalf("shared call auto-reply v4 key diverged: want %s got %s", want, sharedKey)
	}
	if fromOffer == callAutoReplyOperationID("worker-1", "call-456") {
		t.Fatal("distinct physical calls must not be deduplicated")
	}
	if got := callAutoReplyOperationID("worker-1", ""); got != "" {
		t.Fatalf("missing immutable call id must fail closed, got %q", got)
	}
}

func TestCallInboundIdentityUsesImmutableCallID(t *testing.T) {
	if got, want := stableCallInboundEventID("account-1", "worker-1", "call-123", "5511999999999:7@c.us"), stableCallInboundEventID("account-1", "worker-1", "call-123", "5511999999999@s.whatsapp.net"); got == "" || got != want {
		t.Fatalf("call event JID normalization diverged: %q != %q", got, want)
	}
	first := inboundIdentityFixture("call_call-123")
	first.IsCallEvent = true
	first.EventID = stableCallInboundEventID(first.AccountID, first.WorkerID, "call-123", "5511999999999@s.whatsapp.net")
	first.EventRevision = "call-123"
	second := first
	second.SourceProvider = "another-provider"
	second.Message = map[string]any{
		"key": map[string]any{
			"id":        "call_call-123",
			"remoteJid": "5511999999999:4@c.us",
			"fromMe":    false,
		},
		"messageTimestamp": float64(1_800_000_000),
	}
	if got, want := ensureInboundEventIdentity(&first, "call_event"), ensureInboundEventIdentity(&second, "call_event"); got == "" || got != want {
		t.Fatalf("duplicate call event did not converge: %q != %q", got, want)
	}
}

func TestOutboundRecoveryRecordCannotRepresentProviderCalls(t *testing.T) {
	publication, err := newOutboundRecoveryPublication(topicUpdateMessage, "message-1", map[string]any{"id": "message-1"})
	if err != nil {
		t.Fatal(err)
	}
	if err := validateOutboundRecoveryRecord(outboundRecoveryRecord{
		SchemaVersion:           outboundRecoverySchemaVersion,
		WorkerID:                "worker-1",
		ConsumerAssignmentEpoch: 7,
		Publications:            []outboundRecoveryPublication{publication},
	}); err != nil {
		t.Fatalf("valid Kafka recovery record rejected: %v", err)
	}
	if _, err := newOutboundRecoveryPublication("worker.w1.send.message", "message-1", map[string]any{"id": "message-1"}); err == nil {
		t.Fatal("recovery must reject worker/provider send topics")
	}
}

func TestInboundEventIdentityIsProviderNeutralAndContentIndependent(t *testing.T) {
	left := inboundIdentityFixture("false_5511999999999@c.us_stanza-1")
	left.SourceProvider = "wwebjs"
	left.Content = map[string]any{"message": "first rendering"}
	left.Message["key"].(map[string]any)["remoteJid"] = "5511999999999:7@c.us"

	right := inboundIdentityFixture("stanza-1")
	right.SourceProvider = "whatsmeow"
	right.Content = map[string]any{"message": "second rendering"}

	leftID := ensureInboundEventIdentity(&left, "incoming_message")
	rightID := ensureInboundEventIdentity(&right, "incoming_message")
	if leftID != rightID {
		t.Fatalf("provider/content normalization changed identity: %s != %s", leftID, rightID)
	}
	if !strings.HasPrefix(leftID, inboundEventIDPrefix) {
		t.Fatalf("unexpected event id %q", leftID)
	}
	want := "waevt_v1_7c15f3828681b891392eadfc301c86bec03c1ece80699bf7d153ad0acf638caf"
	if leftID != want {
		t.Fatalf("event id does not match the shared v1 contract: want %s got %s", want, leftID)
	}
}

func TestInboundRepeatedContentWithDifferentStanzaIDsIsAccepted(t *testing.T) {
	first := inboundIdentityFixture("stanza-1")
	second := inboundIdentityFixture("stanza-2")
	firstID := ensureInboundEventIdentity(&first, "incoming_message")
	secondID := ensureInboundEventIdentity(&second, "incoming_message")
	if firstID == secondID {
		t.Fatal("different provider stanza IDs must produce distinct events")
	}
}

func TestInboundMutationRevisionNormalizesMillisecondsToSeconds(t *testing.T) {
	seconds := inboundIdentityFixture("edit-stanza")
	seconds.Type = MessageTypeEditText
	seconds.Message["messageTimestamp"] = float64(1_700_000_001)
	milliseconds := inboundIdentityFixture("edit-stanza")
	milliseconds.Type = MessageTypeEditText
	milliseconds.Message["messageTimestamp"] = "1700000001000"
	if got := ensureInboundEventIdentity(&seconds, "incoming_message"); got != ensureInboundEventIdentity(&milliseconds, "incoming_message") {
		t.Fatalf("second and millisecond revisions did not converge: %s", got)
	}
	if seconds.EventRevision != "1700000001" || milliseconds.EventRevision != "1700000001" {
		t.Fatalf("unexpected normalized revisions %q and %q", seconds.EventRevision, milliseconds.EventRevision)
	}
	want := "waevt_v1_f701af190d1fc7a8c6797111736477e6d9d1d1f63450a2212ad5b6cd7254b9b9"
	if got := ensureInboundEventIdentity(&seconds, "incoming_message"); got != want {
		t.Fatalf("mutable event id does not match the shared Go/TypeScript golden: want %s got %s", want, got)
	}
}

func TestInboundMutationRevisionAcceptsProductionInt64Timestamp(t *testing.T) {
	productionPayload := inboundIdentityFixture("edit-stanza")
	productionPayload.Type = MessageTypeEditText
	productionPayload.Message["messageTimestamp"] = int64(1_700_000_001)

	reference := inboundIdentityFixture("edit-stanza")
	reference.Type = MessageTypeEditText
	reference.Message["messageTimestamp"] = "1700000001"

	got := ensureInboundEventIdentity(&productionPayload, "incoming_message")
	want := ensureInboundEventIdentity(&reference, "incoming_message")
	if got == "" {
		t.Fatal("production int64 timestamp did not produce an inbound event id")
	}
	if got != want {
		t.Fatalf("production int64 timestamp did not match the shared identity: want %s got %s", want, got)
	}
	if productionPayload.EventRevision != "1700000001" {
		t.Fatalf("unexpected production int64 revision %q", productionPayload.EventRevision)
	}
}

func TestInboundMutableEventWithoutStableRevisionIsNotDeduplicable(t *testing.T) {
	tests := []struct {
		name      string
		typeName  string
		callEvent bool
	}{
		{name: "edit", typeName: MessageTypeEditText},
		{name: "delete", typeName: MessageTypeDelete},
		{name: "reaction", typeName: MessageTypeReact},
		{name: "pin", typeName: "annotation"},
		{name: "call", typeName: MessageTypeText, callEvent: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			upsert := inboundIdentityFixture("mutable-stanza")
			upsert.Type = test.typeName
			upsert.IsCallEvent = test.callEvent
			delete(upsert.Message, "messageTimestamp")
			if got := ensureInboundEventIdentity(&upsert, "incoming_message"); got != "" {
				t.Fatalf("mutation without a provider revision must not be deduplicated, got %s", got)
			}
			if upsert.EventID != "" {
				t.Fatalf("mutation unexpectedly stored event_id %s", upsert.EventID)
			}
		})
	}

	whatsmeowPin := inboundIdentityFixture("pin-stanza")
	whatsmeowPin.Type = MessageTypeSystem
	whatsmeowPin.Message["message"] = map[string]any{
		"pinInChatMessage": map[string]any{"type": "PIN_FOR_ALL"},
	}
	delete(whatsmeowPin.Message, "messageTimestamp")
	if got := ensureInboundEventIdentity(&whatsmeowPin, "incoming_message"); got != "" {
		t.Fatalf("WhatsMeow pin without a provider revision must not be deduplicated, got %s", got)
	}
}

func TestInboundEventIdentityPrefersNonLIDAlternateAndPreservesExistingID(t *testing.T) {
	upsert := inboundIdentityFixture("stanza-1")
	key := upsert.Message["key"].(map[string]any)
	key["remoteJid"] = "123456@lid"
	key["remoteJidAlt"] = "5511999999999:4@c.us"
	firstID := ensureInboundEventIdentity(&upsert, "incoming_message")

	equivalent := inboundIdentityFixture("stanza-1")
	secondID := ensureInboundEventIdentity(&equivalent, "incoming_message")
	if firstID != secondID {
		t.Fatalf("non-LID alternate was not canonicalized: %s != %s", firstID, secondID)
	}

	upsert.EventID = "external-event-id"
	if got := ensureInboundEventIdentity(&upsert, "incoming_message"); got != "external-event-id" {
		t.Fatalf("existing event id was not preserved: %q", got)
	}
}

func inboundIdentityFixture(stanzaID string) UpsertMessage {
	return UpsertMessage{
		AccountID: "account-1",
		WorkerID:  "worker-1",
		Type:      MessageTypeText,
		Message: map[string]any{
			"key": map[string]any{
				"id":          stanzaID,
				"remoteJid":   "5511999999999@s.whatsapp.net",
				"fromMe":      false,
				"participant": "",
			},
			"messageTimestamp": float64(1_700_000_000),
		},
	}
}

func TestPostProviderSideEffectRetriesWithoutRepeatingProviderWork(t *testing.T) {
	attempts := 0
	transient := errors.New("transient kafka failure")
	err := retryOutboundPostProviderSideEffectWithPolicy(
		context.Background(),
		3,
		time.Millisecond,
		time.Millisecond,
		func(context.Context) error {
			attempts++
			if attempts == 1 {
				return transient
			}
			return nil
		},
	)
	if err != nil {
		t.Fatalf("post-provider publication did not recover: %v", err)
	}
	if attempts != 2 {
		t.Fatalf("expected only the side effect to run twice, got %d attempts", attempts)
	}
}
