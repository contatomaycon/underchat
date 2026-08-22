package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/nats-io/nats.go"
	modernjs "github.com/nats-io/nats.go/jetstream"
)

// This integration test uses the real R3 streams. One in-stream successor is
// allowed to wait for an ever-active predecessor; 127 deeper successors are
// moved with publish-before-Ack into the broker-native one-shot scheduler. It
// proves that a 130-command single-chat burst cannot hide another chat behind
// MaxAckPending=128 and that predecessor redelivery retains priority.
func TestWorkerCommandJetStreamBurstDeferredDoesNotBlockOtherChat(t *testing.T) {
	connection := connectWorkerCommandIntegrationNATS(t)
	js, err := connection.JetStream(nats.MaxWait(5 * time.Second))
	if err != nil {
		t.Fatal(err)
	}
	modern, err := modernjs.New(connection)
	if err != nil {
		t.Fatal(err)
	}
	deferredStream, err := modern.Stream(context.Background(), workerCommandDeferredStreamName)
	if err != nil {
		t.Fatal(err)
	}
	deferredInfo, err := deferredStream.Info(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if err := validateWorkerCommandDeferredStreamInfo(deferredInfo); err != nil {
		t.Fatal(err)
	}

	workerID := "go-burst-" + uuid.NewString()
	subject := workerCommandSubject(workerID)
	durable := workerCommandDurableName(workerID)
	consumer, err := js.AddConsumer(workerCommandStreamName, workerCommandConsumerConfig(workerID))
	if err != nil {
		t.Fatalf("create burst consumer: %v", err)
	}
	if err := validateWorkerCommandConsumerInfo(consumer, workerCommandConsumerConfig(workerID)); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = js.DeleteConsumer(workerCommandStreamName, durable) })
	subscription, err := js.PullSubscribe(subject, durable, nats.Bind(workerCommandStreamName, durable), nats.ManualAck())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = subscription.Unsubscribe() })

	issuedAt := time.Now().UTC().Truncate(time.Millisecond)
	deadlineAt := issuedAt.Add(4*time.Minute + 30*time.Second)
	longEntity := "chat:account-1:" + workerID + ":long"
	predecessor := ""
	for sequence := 1; sequence <= 129; sequence++ {
		operationID := fmt.Sprintf("long-%03d-%s", sequence, uuid.NewString())
		envelope := workerCommandIntegrationEnvelope(t, workerID, longEntity, uint64(sequence), predecessor, operationID, issuedAt, deadlineAt)
		publishWorkerCommandIntegrationEnvelope(t, js, subject, envelope)
		predecessor = operationID
	}
	otherEnvelope := workerCommandIntegrationEnvelope(
		t, workerID, "chat:account-1:"+workerID+":other", 1, "", "other-"+uuid.NewString(), issuedAt, deadlineAt,
	)
	publishWorkerCommandIntegrationEnvelope(t, js, subject, otherEnvelope)

	client := &WorkerCommandNATSClient{js: js, deferred: modern}
	seenOther := false
	seenPredecessorRetry := false
	deferredCount := 0
	var immediateSuccessor *nats.Msg
	deadline := time.Now().Add(10 * time.Second)
	for !seenOther || !seenPredecessorRetry || deferredCount < 127 {
		if time.Now().After(deadline) {
			t.Fatalf("burst stalled: other_chat=%v predecessor_retry=%v deferred=%d", seenOther, seenPredecessorRetry, deferredCount)
		}
		messages, fetchErr := subscription.Fetch(64, nats.MaxWait(time.Second))
		if fetchErr != nil {
			if errors.Is(fetchErr, nats.ErrTimeout) {
				continue
			}
			t.Fatal(fetchErr)
		}
		for _, message := range messages {
			envelope, decodeErr := DecodeWorkerCommandEnvelopeV1(message.Data)
			if decodeErr != nil {
				t.Fatal(decodeErr)
			}
			if envelope.EntityKey == otherEnvelope.EntityKey {
				seenOther = true
				if err := message.AckSync(); err != nil {
					t.Fatal(err)
				}
				continue
			}
			switch envelope.EntitySequence {
			case 1:
				metadata, metadataErr := message.Metadata()
				if metadataErr != nil {
					t.Fatal(metadataErr)
				}
				if metadata.NumDelivered == 1 {
					if err := message.NakWithDelay(10 * time.Millisecond); err != nil {
						t.Fatal(err)
					}
				} else {
					seenPredecessorRetry = true
					if err := message.AckSync(); err != nil {
						t.Fatal(err)
					}
				}
			case 2:
				// At most this immediate successor stays AckPending. It heartbeats
				// in place instead of consuming a NAK/redelivery attempt or adding
				// an artificial one-second gap after the predecessor completes.
				if err := message.InProgress(); err != nil {
					t.Fatal(err)
				}
				immediateSuccessor = message
			default:
				if err := client.deferWorkerCommand(context.Background(), message, envelope); err != nil {
					t.Fatal(err)
				}
				if deferredCount == 0 {
					// Simulate a crash after schedule PubAck but before original Ack.
					// The second transfer must resolve through the same dedupe identity.
					if err := client.deferWorkerCommand(context.Background(), message, envelope); err != nil {
						t.Fatalf("idempotent deferred replay: %v", err)
					}
				}
				if err := message.AckSync(); err != nil {
					t.Fatal(err)
				}
				deferredCount++
			}
		}
	}
	if immediateSuccessor == nil {
		t.Fatal("immediate successor was not kept as the single in-stream waiter")
	}
	metadata, err := immediateSuccessor.Metadata()
	if err != nil {
		t.Fatal(err)
	}
	if metadata.NumDelivered != 1 {
		t.Fatalf("immediate successor delivery count = %d, want 1", metadata.NumDelivered)
	}
	if err := immediateSuccessor.AckSync(); err != nil {
		t.Fatal(err)
	}

	// Exercise the singleton relay contract on one generated ready message.
	// The remaining schedules age out in five minutes and are isolated under the
	// unique worker subject.
	relayDigest := sha256.Sum256([]byte(workerID))
	relayDurable := "go_relay_" + hex.EncodeToString(relayDigest[:8])
	relayConfig := *workerCommandDeferredRelayConsumerConfig()
	relayConfig.Durable = relayDurable
	relayConfig.Name = relayDurable
	relayConfig.FilterSubject = workerCommandDeferredReadySubject(workerID)
	relayInfo, err := js.AddConsumer(workerCommandDeferredStreamName, &relayConfig)
	if err != nil {
		t.Fatalf("create test relay consumer: %v", err)
	}
	if relayInfo.Config.FilterSubject != relayConfig.FilterSubject || relayInfo.Config.AckPolicy != nats.AckExplicitPolicy {
		t.Fatalf("test relay durable drifted: %+v", relayInfo.Config)
	}
	t.Cleanup(func() { _ = js.DeleteConsumer(workerCommandDeferredStreamName, relayDurable) })
	relaySubscription, err := js.PullSubscribe(
		relayConfig.FilterSubject,
		relayDurable,
		nats.Bind(workerCommandDeferredStreamName, relayDurable),
		nats.ManualAck(),
	)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = relaySubscription.Unsubscribe() })
	readyMessages, err := relaySubscription.Fetch(1, nats.MaxWait(5*time.Second))
	if err != nil {
		t.Fatalf("fetch scheduled ready command: %v", err)
	}
	if err := client.relayDeferredWorkerCommand(context.Background(), readyMessages[0]); err != nil {
		t.Fatal(err)
	}
	relayEnvelope, err := DecodeWorkerCommandEnvelopeV1(readyMessages[0].Data)
	if err != nil {
		t.Fatal(err)
	}
	scheduleID, err := parseWorkerCommandDeferredScheduleSubject(
		readyMessages[0].Header.Get(modernjs.SchedulerHeader),
		relayEnvelope.WorkerID,
	)
	if err != nil {
		t.Fatal(err)
	}
	duplicateAck, err := js.Publish(
		workerCommandSubject(relayEnvelope.WorkerID),
		readyMessages[0].Data,
		nats.ExpectStream(workerCommandStreamName),
		nats.MsgId(workerCommandDeferredRelayMessageID(scheduleID)),
	)
	if err != nil || duplicateAck == nil || !duplicateAck.Duplicate {
		t.Fatalf("relay crash-window publish was not deduplicated: ack=%+v err=%v", duplicateAck, err)
	}
	relayed, err := subscription.Fetch(64, nats.MaxWait(5*time.Second))
	if err != nil {
		t.Fatalf("fetch relayed command: %v", err)
	}
	relayedCount := 0
	for _, message := range relayed {
		envelope, decodeErr := DecodeWorkerCommandEnvelopeV1(message.Data)
		if decodeErr != nil {
			t.Fatal(decodeErr)
		}
		if envelope.EntitySequence >= 3 {
			relayedCount++
		}
		if err := message.AckSync(); err != nil {
			t.Fatal(err)
		}
	}
	if relayedCount != 1 {
		t.Fatalf("deferred relay count = %d, want exactly one", relayedCount)
	}
}

func connectWorkerCommandIntegrationNATS(t *testing.T) *nats.Conn {
	t.Helper()
	url := strings.TrimSpace(os.Getenv("TEST_NATS_URL"))
	if url == "" {
		t.Skip("TEST_NATS_URL is not configured")
	}
	cfg := Config{
		NATSUser:     strings.TrimSpace(os.Getenv("TEST_NATS_USER")),
		NATSPassword: os.Getenv("TEST_NATS_PASSWORD"),
	}
	auth, err := workerCommandNATSAuthOptions(cfg)
	if err != nil {
		t.Fatal(err)
	}
	connection, err := nats.Connect(url, append(auth, nats.Timeout(5*time.Second))...)
	if err != nil {
		t.Fatalf("connect test NATS: %v", err)
	}
	t.Cleanup(connection.Close)
	return connection
}

func workerCommandIntegrationEnvelope(
	t *testing.T,
	workerID, entityKey string,
	sequence uint64,
	predecessor, operationID string,
	issuedAt, deadlineAt time.Time,
) WorkerCommandEnvelopeV1 {
	t.Helper()
	payload := json.RawMessage(`{}`)
	digest := sha256.Sum256(payload)
	var predecessorPointer *string
	if predecessor != "" {
		predecessorPointer = &predecessor
	}
	return WorkerCommandEnvelopeV1{
		SchemaVersion:          1,
		CommandID:              uuid.NewString(),
		OperationID:            operationID,
		RetryOf:                nil,
		AccountID:              "account-1",
		WorkerID:               workerID,
		CommandType:            WorkerCommandTypeDirectSend,
		EntityKey:              entityKey,
		EntitySequence:         sequence,
		PredecessorOperationID: predecessorPointer,
		OriginEpoch:            "integration-logical-epoch",
		IssuedAt:               workerCommandTimestamp(issuedAt),
		DeadlineAt:             workerCommandTimestamp(deadlineAt),
		PayloadVersion:         1,
		PayloadDigest:          hex.EncodeToString(digest[:]),
		Payload:                payload,
		Traceparent:            nil,
		Source:                 "go-integration-test",
	}
}

func publishWorkerCommandIntegrationEnvelope(
	t *testing.T,
	js nats.JetStreamContext,
	subject string,
	envelope WorkerCommandEnvelopeV1,
) {
	t.Helper()
	raw, err := json.Marshal(envelope)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := DecodeWorkerCommandEnvelopeV1(raw); err != nil {
		t.Fatalf("test envelope is invalid: %v", err)
	}
	ack, err := js.Publish(subject, raw, nats.ExpectStream(workerCommandStreamName), nats.MsgId(envelope.CommandID))
	if err != nil {
		t.Fatalf("publish command sequence=%d: %v", envelope.EntitySequence, err)
	}
	if ack.Stream != workerCommandStreamName || ack.Sequence == 0 {
		t.Fatalf("invalid command PubAck: %+v", ack)
	}
}
