package app

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/segmentio/kafka-go"
)

func TestInvalidOutboundIdentityAndEmptyMessageIDCommitBeforeDependencies(t *testing.T) {
	t.Parallel()

	worker := &Worker{cfg: Config{
		AccountID: "account-1",
		WorkerID:  "worker-1",
	}}
	tests := []struct {
		name    string
		handler func(context.Context, kafka.Message) error
		payload string
	}{
		{
			name:    "direct cross account",
			handler: worker.handleSendMessage,
			payload: `{"message_id":"message-1","account":{"id":"account-other"},"worker":{"id":"worker-1"},"content":{"type":"text","message":"hello"}}`,
		},
		{
			name:    "direct empty message id",
			handler: worker.handleSendMessage,
			payload: `{"message_id":"","account":{"id":"account-1"},"worker":{"id":"worker-1"},"content":{"type":"text","message":"hello"}}`,
		},
		{
			name:    "schedule missing worker identity",
			handler: worker.handleScheduleSend,
			payload: `{"schedule_id":"schedule-1","account_id":"account-1","message":{"message_id":"message-1","account":{"id":"account-1"},"content":{"type":"text","message":"hello"}}}`,
		},
		{
			name:    "schedule empty message id",
			handler: worker.handleScheduleSend,
			payload: `{"schedule_id":"schedule-1","account_id":"account-1","message":{"message_id":"","account":{"id":"account-1"},"worker":{"id":"worker-1"},"content":{"type":"text","message":"hello"}}}`,
		},
		{
			name:    "notification cross worker",
			handler: worker.handleNotification,
			payload: `{"operation_id":"operation-1","notification_id":"notification-1","account":{"id":"account-1"},"worker":{"id":"worker-other"},"message_key":{"remote_jid":"5511999999999@s.whatsapp.net"},"message_whatsapp":"hello"}`,
		},
		{
			name:    "notification missing operation identity",
			handler: worker.handleNotification,
			payload: `{"account":{"id":"account-1"},"worker":{"id":"worker-1"},"message_whatsapp":"hello"}`,
		},
	}

	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			// Worker dependencies are intentionally nil. Any lookup, Redis
			// mutation, readiness wait, upload, typing, or provider call would
			// panic and fail the test.
			if err := test.handler(context.Background(), kafka.Message{
				Topic:     "identity-test",
				Partition: 3,
				Offset:    17,
				Value:     []byte(test.payload),
			}); err != nil {
				t.Fatalf("terminal invalid payload must commit: %v", err)
			}
		})
	}
}

func TestOutboundIdentityRejectsConflictingNestedAndTopLevelAccount(t *testing.T) {
	t.Parallel()

	worker := &Worker{cfg: Config{AccountID: "account-1", WorkerID: "worker-1"}}
	err := worker.validateOutboundPayloadIdentity(
		"schedule_message",
		[]string{"account-1", "account-other"},
		[]string{"worker-1"},
	)
	if err == nil {
		t.Fatal("conflicting schedule identities were accepted")
	}
}

func TestOutboundIdempotencyClaimChecksImmutableIdentityBeforeReplay(t *testing.T) {
	t.Parallel()

	for _, required := range []string{
		"stored_operation_type == operation_type",
		"stored_operation_id == operation_id",
		"'worker_id', 'message_id', 'chat_id'",
		"incoming_provider == 'whatsmeow'",
		"'identity_conflict'",
	} {
		if !strings.Contains(claimOutboundSendScript, required) {
			t.Fatalf("claim script is missing immutable identity guard %q", required)
		}
	}
}

func TestOutboundRedisOperationDeadlineIsAlwaysBounded(t *testing.T) {
	t.Parallel()

	ctx, cancel := withOutboundRedisOperationDeadline(context.Background())
	defer cancel()
	deadline, ok := ctx.Deadline()
	if !ok {
		t.Fatal("outbound Redis operation has no deadline")
	}
	remaining := time.Until(deadline)
	if remaining <= 0 || remaining > outboundRedisOperationTimeout {
		t.Fatalf("unexpected outbound Redis deadline %s", remaining)
	}

	parent, parentCancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer parentCancel()
	child, childCancel := withOutboundRedisOperationDeadline(parent)
	defer childCancel()
	childDeadline, ok := child.Deadline()
	if !ok {
		t.Fatal("child outbound Redis operation has no deadline")
	}
	parentDeadline, _ := parent.Deadline()
	if childDeadline.After(parentDeadline) {
		t.Fatalf("outbound Redis deadline extended its parent: child=%s parent=%s", childDeadline, parentDeadline)
	}
}
