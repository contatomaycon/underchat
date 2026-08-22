package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/nats-io/nats.go"
	modernjs "github.com/nats-io/nats.go/jetstream"
)

const workerCommandDeferredDelay = time.Second

var errWorkerCommandDeferredExpired = errors.New("worker command deadline cannot accommodate deferred delivery")

func workerCommandDeferredReadySubject(workerID string) string {
	return workerDeferredReadySubjectPrefix + strings.TrimSpace(workerID)
}

func workerCommandDeferredIdentity(commandID string, sourceStreamSequence uint64) string {
	digest := sha256.Sum256([]byte(commandID + ":" + strconv.FormatUint(sourceStreamSequence, 10)))
	return hex.EncodeToString(digest[:])
}

func workerCommandDeferredScheduleMessageID(scheduleID string) string {
	return "worker-deferred-schedule-v1:" + scheduleID
}

func workerCommandDeferredScheduleSubject(workerID, commandID string, sourceStreamSequence uint64) string {
	return workerDeferredScheduleSubjectPrefix + strings.TrimSpace(workerID) + "." +
		workerCommandDeferredIdentity(commandID, sourceStreamSequence)
}

func workerCommandDeferredRelayMessageID(scheduleID string) string {
	return "worker-deferred-relay-v1:" + scheduleID
}

func validateWorkerCommandDeferredStreamInfo(info *modernjs.StreamInfo) error {
	if info == nil {
		return errors.New("worker command deferred stream metadata is unavailable")
	}
	config := info.Config
	if config.Name != workerCommandDeferredStreamName ||
		config.Retention != modernjs.WorkQueuePolicy ||
		config.MaxConsumers != 8 ||
		config.Storage != modernjs.FileStorage ||
		config.Replicas != 3 ||
		config.Compression != modernjs.S2Compression ||
		config.MaxAge != workerCommandMaxAge ||
		config.MaxMsgSize != workerCommandMaxBytes ||
		config.MaxMsgs != -1 ||
		config.MaxBytes != -1 ||
		config.MaxMsgsPerSubject != -1 ||
		config.Discard != modernjs.DiscardOld ||
		config.DiscardNewPerSubject ||
		config.Duplicates != workerCommandNATSDuplicateWindow ||
		config.NoAck ||
		config.Sealed ||
		!config.DenyDelete ||
		config.DenyPurge ||
		!config.AllowRollup ||
		config.AllowDirect ||
		config.MirrorDirect ||
		!config.AllowMsgSchedules ||
		!config.AllowMsgTTL {
		return fmt.Errorf("worker command deferred stream %s has incompatible fail-closed configuration", workerCommandDeferredStreamName)
	}
	wantSubjects := map[string]struct{}{
		workerDeferredScheduleSubjectFilter: {},
		workerDeferredReadySubjectFilter:    {},
	}
	if len(config.Subjects) != len(wantSubjects) {
		return fmt.Errorf("worker command deferred stream %s has incompatible subjects", workerCommandDeferredStreamName)
	}
	for _, subject := range config.Subjects {
		if _, ok := wantSubjects[subject]; !ok {
			return fmt.Errorf("worker command deferred stream %s has incompatible subject %q", workerCommandDeferredStreamName, subject)
		}
	}
	return nil
}

// deferWorkerCommand transfers a never-active successor to the broker-native
// scheduler. The original delivery is acknowledged only after the R3 PubAck;
// a crash in between is safe because the schedule subject and Msg-Id are both
// deterministic for the source stream sequence. Command bytes never leave
// JetStream.
func (client *WorkerCommandNATSClient) deferWorkerCommand(
	ctx context.Context,
	message *nats.Msg,
	envelope WorkerCommandEnvelopeV1,
) error {
	if client == nil || client.deferred == nil || message == nil {
		return errors.New("worker command deferred scheduler is unavailable")
	}
	metadata, err := message.Metadata()
	if err != nil {
		return fmt.Errorf("inspect worker command source sequence before defer: %w", err)
	}
	if metadata.Stream != workerCommandStreamName || metadata.Sequence.Stream == 0 {
		return errors.New("worker command defer source is not the canonical command stream")
	}
	if message.Subject != workerCommandSubject(envelope.WorkerID) {
		return errors.New("worker command defer source subject does not match envelope")
	}
	now := time.Now().UTC()
	fireAt := now.Add(workerCommandDeferredDelay).Truncate(time.Millisecond)
	readyTTL := envelope.deadlineTime().Sub(fireAt)
	if readyTTL <= 0 {
		return errWorkerCommandDeferredExpired
	}
	identity := workerCommandDeferredIdentity(envelope.CommandID, metadata.Sequence.Stream)
	publishCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	scheduleMessage := &nats.Msg{
		Subject: workerCommandDeferredScheduleSubject(envelope.WorkerID, envelope.CommandID, metadata.Sequence.Stream),
		Header:  make(nats.Header),
		Data:    append([]byte(nil), message.Data...),
	}
	// WithScheduleAt in older nats.go versions serializes only whole seconds.
	// The explicit canonical millisecond timestamp stays byte-for-byte aligned
	// with JavaScript Date.toISOString() and guarantees a full one-second park.
	scheduleMessage.Header.Set(modernjs.ScheduleHeader, "@at "+workerCommandTimestamp(fireAt))
	ack, err := client.deferred.PublishMsg(
		publishCtx,
		scheduleMessage,
		modernjs.WithExpectStream(workerCommandDeferredStreamName),
		modernjs.WithMsgID(workerCommandDeferredScheduleMessageID(identity)),
		modernjs.WithScheduleTarget(workerCommandDeferredReadySubject(envelope.WorkerID)),
		modernjs.WithScheduleTTL(readyTTL),
	)
	if err != nil {
		return fmt.Errorf("persist worker command deferred schedule: %w", err)
	}
	if ack == nil || ack.Stream != workerCommandDeferredStreamName || ack.Sequence == 0 {
		return errors.New("worker command deferred schedule returned an invalid PubAck")
	}
	return nil
}

func workerCommandDeferredRelayConsumerConfig() *nats.ConsumerConfig {
	return &nats.ConsumerConfig{
		Durable:         workerDeferredRelayDurableName,
		Name:            workerDeferredRelayDurableName,
		Description:     "Underchat worker command deferred relay v1",
		DeliverPolicy:   nats.DeliverAllPolicy,
		AckPolicy:       nats.AckExplicitPolicy,
		AckWait:         30 * time.Second,
		MaxDeliver:      -1,
		FilterSubject:   workerDeferredReadySubjectFilter,
		ReplayPolicy:    nats.ReplayInstantPolicy,
		MaxAckPending:   512,
		MaxRequestBatch: 128,
		MaxWaiting:      128,
		Replicas:        3,
	}
}

func validateWorkerCommandDeferredRelayConsumerInfo(actual *nats.ConsumerInfo) error {
	expected := workerCommandDeferredRelayConsumerConfig()
	if actual == nil {
		return errors.New("worker command deferred relay metadata is unavailable")
	}
	config := actual.Config
	if config.Durable != expected.Durable ||
		config.Name != expected.Name ||
		config.FilterSubject != expected.FilterSubject ||
		config.DeliverPolicy != expected.DeliverPolicy ||
		config.AckPolicy != expected.AckPolicy ||
		config.AckWait != expected.AckWait ||
		config.MaxDeliver != expected.MaxDeliver ||
		config.MaxAckPending != expected.MaxAckPending ||
		config.MaxRequestBatch != expected.MaxRequestBatch ||
		config.MaxWaiting != expected.MaxWaiting ||
		config.ReplayPolicy != expected.ReplayPolicy ||
		config.Replicas != expected.Replicas ||
		config.DeliverSubject != "" || len(config.BackOff) != 0 {
		return errors.New("worker command deferred relay durable has incompatible fail-closed configuration")
	}
	return nil
}

// relayDeferredWorkerCommand is the crash-safe handler used by the singleton
// deferred relay. Its Msg-Id intentionally differs from envelope.command_id:
// the command stream still remembers the producer's original Msg-Id for five
// minutes and would otherwise suppress the newly ready command after the
// original delivery was acknowledged.
func (client *WorkerCommandNATSClient) relayDeferredWorkerCommand(ctx context.Context, message *nats.Msg) error {
	if client == nil || client.js == nil || message == nil {
		return errors.New("worker command deferred relay is unavailable")
	}
	metadata, err := message.Metadata()
	if err != nil {
		return fmt.Errorf("inspect deferred ready sequence: %w", err)
	}
	if metadata.Stream != workerCommandDeferredStreamName || metadata.Sequence.Stream == 0 {
		return errors.New("deferred ready message is not from the canonical stream")
	}
	envelope, err := DecodeWorkerCommandEnvelopeV1(message.Data)
	if err != nil {
		return fmt.Errorf("decode deferred ready command: %w", err)
	}
	if err := envelope.ValidateFresh(time.Now()); err != nil {
		return errors.Join(errWorkerCommandDeferredExpired, err)
	}
	if message.Subject != workerCommandDeferredReadySubject(envelope.WorkerID) {
		return errors.New("deferred ready subject does not match envelope worker")
	}
	schedulerSubject := message.Header.Get(modernjs.SchedulerHeader)
	scheduleID, err := parseWorkerCommandDeferredScheduleSubject(schedulerSubject, envelope.WorkerID)
	if err != nil {
		return err
	}
	publishCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	ack, err := client.js.Publish(
		workerCommandSubject(envelope.WorkerID),
		append([]byte(nil), message.Data...),
		nats.ExpectStream(workerCommandStreamName),
		nats.MsgId(workerCommandDeferredRelayMessageID(scheduleID)),
		nats.Context(publishCtx),
	)
	if err != nil {
		return fmt.Errorf("relay deferred worker command: %w", err)
	}
	if ack == nil || ack.Stream != workerCommandStreamName || ack.Sequence == 0 {
		return errors.New("deferred worker command relay returned an invalid PubAck")
	}
	ackCtx, ackCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer ackCancel()
	if err := message.AckSync(nats.Context(ackCtx)); err != nil {
		return fmt.Errorf("ack deferred ready command after relay PubAck: %w", err)
	}
	return nil
}

func parseWorkerCommandDeferredScheduleSubject(subject, workerID string) (string, error) {
	prefix := workerDeferredScheduleSubjectPrefix + workerID + "."
	if !strings.HasPrefix(subject, prefix) {
		return "", errors.New("deferred command scheduler subject does not match worker")
	}
	scheduleID := strings.TrimPrefix(subject, prefix)
	if !workerCommandDigestPattern.MatchString(scheduleID) {
		return "", errors.New("deferred command scheduler identity is invalid")
	}
	return scheduleID, nil
}
