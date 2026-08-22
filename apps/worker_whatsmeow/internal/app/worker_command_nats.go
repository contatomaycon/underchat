package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/nats-io/nats.go"
	modernjs "github.com/nats-io/nats.go/jetstream"
	"github.com/redis/go-redis/v9"
	"github.com/segmentio/kafka-go"
)

var (
	errWorkerCommandEpochRejected    = errors.New("worker command origin epoch rejected")
	errWorkerCommandEpochUnavailable = errors.New("worker command origin epoch unavailable")
	errWorkerCommandRuntimeReplaced  = errors.New("worker command runtime was replaced")
	errWorkerCommandLaneStale        = errors.New("worker command entity sequence is stale")
	workerCommandRedeliveryBackoff   = []time.Duration{
		time.Second,
		3 * time.Second,
		10 * time.Second,
		30 * time.Second,
		60 * time.Second,
		workerCommandPublicRetryDelay,
	}
)

const (
	workerCommandMaximumTechnicalRetries = 6
	workerCommandConcurrentLanes         = 32
	workerCommandLaneActiveLease         = 30 * time.Second
	workerCommandLaneRenewInterval       = 10 * time.Second
	workerCommandLaneRecheckDelay        = time.Second
	workerCommandLaneWaitPoll            = 100 * time.Millisecond
)

type WorkerCommandNATSClient struct {
	conn      *nats.Conn
	js        nats.JetStreamContext
	deferred  modernjs.JetStream
	epochKV   nats.KeyValue
	laneSlots chan struct{}

	epochVerifier    workerCommandEpochVerifier
	runtimeIdentityM sync.RWMutex
	runtimeIdentity  workerCommandRuntimeIdentity
}

type workerCommandRuntimeIdentity struct {
	WorkerID          string
	AccountID         string
	CommandEpoch      string
	WriterEpoch       string
	RuntimeGeneration int
}

type workerCommandOutcomeContextKey struct{}

type workerCommandOutcomeRecorder struct {
	mu   sync.Mutex
	code string
}

func withWorkerCommandOutcomeRecorder(ctx context.Context) (context.Context, *workerCommandOutcomeRecorder) {
	recorder := &workerCommandOutcomeRecorder{}
	return context.WithValue(ctx, workerCommandOutcomeContextKey{}, recorder), recorder
}

func recordWorkerCommandLedgerState(ctx context.Context, state string) {
	if ctx == nil {
		return
	}
	recorder, ok := ctx.Value(workerCommandOutcomeContextKey{}).(*workerCommandOutcomeRecorder)
	if !ok || recorder == nil {
		return
	}
	code := ""
	switch state {
	case sendIdempotencyStateAmbiguous:
		code = "ambiguous"
	case sendIdempotencyStateFailed:
		code = "failed"
	case sendIdempotencyStateExpired:
		code = "expired"
	default:
		return
	}
	recorder.mu.Lock()
	if recorder.code == "" || code == "ambiguous" {
		recorder.code = code
	}
	recorder.mu.Unlock()
}

func (recorder *workerCommandOutcomeRecorder) terminalCode() string {
	if recorder == nil {
		return ""
	}
	recorder.mu.Lock()
	defer recorder.mu.Unlock()
	return recorder.code
}

type workerCommandEpochRecordV1 struct {
	SchemaVersion      int     `json:"schema_version"`
	WorkerID           string  `json:"worker_id"`
	AccountID          string  `json:"account_id"`
	Epoch              string  `json:"epoch"`
	RuntimeWriterEpoch *string `json:"runtime_writer_epoch,omitempty"`
	RuntimeGeneration  int     `json:"runtime_generation"`
	State              string  `json:"state"`
	ActivatedAt        string  `json:"activated_at"`
	UpdatedAt          string  `json:"updated_at"`
	ClosedAt           *string `json:"closed_at"`
}

type workerCommandEpochActivation uint8

const (
	workerCommandEpochReject workerCommandEpochActivation = iota
	workerCommandEpochAccept
	workerCommandEpochReplace
)

type workerCommandFailureV1 struct {
	SchemaVersion  int     `json:"schema_version"`
	FailureID      string  `json:"failure_id"`
	CommandID      *string `json:"command_id"`
	OperationID    *string `json:"operation_id"`
	AccountID      *string `json:"account_id"`
	WorkerID       string  `json:"worker_id"`
	CommandType    *string `json:"command_type"`
	EntityKey      *string `json:"entity_key"`
	EntitySequence *uint64 `json:"entity_sequence"`
	PayloadDigest  *string `json:"payload_digest"`
	Code           string  `json:"code"`
	ErrorName      string  `json:"error_name"`
	ErrorCode      string  `json:"error_code"`
	FailedAt       string  `json:"failed_at"`
}

var workerCommandFailureCodes = map[string]struct{}{
	"invalid_envelope": {},
	"invalid_subject":  {},
	"invalid_target":   {},
	"expired":          {},
	"epoch_rejected":   {},
	"dead_letter":      {},
	"ambiguous":        {},
	"failed":           {},
}

func NewWorkerCommandNATSClient(ctx context.Context, cfg Config) (*WorkerCommandNATSClient, error) {
	if len(cfg.NATSURLs) == 0 {
		return nil, errors.New("NATS_URL is required for worker command ingress")
	}
	options := []nats.Option{
		nats.Name("underchat-worker-whatsmeow-command-ingress"),
		nats.Timeout(5 * time.Second),
		nats.ReconnectWait(time.Second),
		nats.MaxReconnects(-1),
		nats.RetryOnFailedConnect(false),
		nats.DisconnectErrHandler(func(_ *nats.Conn, err error) {
			log.Printf("whatsmeow JetStream disconnected error_code=%s", safeOperationalErrorCode(err))
		}),
		nats.ReconnectHandler(func(connection *nats.Conn) {
			log.Printf("whatsmeow JetStream reconnected server=%s", connection.ConnectedUrl())
		}),
		nats.ClosedHandler(func(connection *nats.Conn) {
			log.Printf("whatsmeow JetStream connection closed error_code=%s", safeOperationalErrorCode(connection.LastError()))
		}),
	}
	authOptions, err := workerCommandNATSAuthOptions(cfg)
	if err != nil {
		return nil, err
	}
	options = append(options, authOptions...)
	if cfg.NATSTLS {
		options = append(options, nats.Secure())
	}
	connection, err := nats.Connect(strings.Join(cfg.NATSURLs, ","), options...)
	if err != nil {
		return nil, fmt.Errorf("connect worker command NATS: %w", err)
	}
	initialized := false
	defer func() {
		if !initialized {
			connection.Close()
		}
	}()
	jetstream, err := connection.JetStream(nats.MaxWait(5 * time.Second))
	if err != nil {
		return nil, fmt.Errorf("initialize worker command JetStream: %w", err)
	}
	if _, err := jetstream.StreamInfo(workerCommandStreamName, nats.Context(ctx)); err != nil {
		return nil, fmt.Errorf("resolve worker command stream %s: %w", workerCommandStreamName, err)
	}
	if _, err := jetstream.StreamInfo(workerCommandFailuresStreamName, nats.Context(ctx)); err != nil {
		return nil, fmt.Errorf("resolve worker command failure stream %s: %w", workerCommandFailuresStreamName, err)
	}
	deferred, err := modernjs.New(connection)
	if err != nil {
		return nil, fmt.Errorf("initialize worker command deferred JetStream: %w", err)
	}
	deferredStream, err := deferred.Stream(ctx, workerCommandDeferredStreamName)
	if err != nil {
		return nil, fmt.Errorf("resolve worker command deferred stream %s: %w", workerCommandDeferredStreamName, err)
	}
	deferredInfo, err := deferredStream.Info(ctx)
	if err != nil {
		return nil, fmt.Errorf("inspect worker command deferred stream %s: %w", workerCommandDeferredStreamName, err)
	}
	if err := validateWorkerCommandDeferredStreamInfo(deferredInfo); err != nil {
		return nil, err
	}
	epochKV, err := jetstream.KeyValue(workerCommandEpochBucketName)
	if err != nil {
		return nil, fmt.Errorf("resolve worker command epoch bucket %s: %w", workerCommandEpochBucketName, err)
	}
	client := &WorkerCommandNATSClient{
		conn:      connection,
		js:        jetstream,
		deferred:  deferred,
		epochKV:   epochKV,
		laneSlots: make(chan struct{}, workerCommandConcurrentLanes),
	}
	client.epochVerifier = client.verifyEpoch
	initialized = true
	return client, nil
}

func workerCommandNATSAuthOptions(cfg Config) ([]nats.Option, error) {
	if cfg.NATSUser == "" || cfg.NATSPassword == "" {
		return nil, errors.New("NATS user and password are required")
	}
	return []nats.Option{nats.UserInfo(cfg.NATSUser, cfg.NATSPassword)}, nil
}

func (client *WorkerCommandNATSClient) Close() {
	if client != nil && client.conn != nil {
		client.conn.Close()
	}
}

func (client *WorkerCommandNATSClient) IsConnected() bool {
	return client != nil && client.conn != nil && client.conn.IsConnected()
}

func workerCommandDurableName(workerID string) string {
	digest := sha256.Sum256([]byte(strings.TrimSpace(workerID)))
	return "uc_worker_" + hex.EncodeToString(digest[:16])
}

func (client *WorkerCommandNATSClient) StartConsumer(
	ctx context.Context,
	worker *Worker,
	observer KafkaConsumerLifecycleObserver,
) (KafkaConsumerHandle, error) {
	if client == nil || client.js == nil || client.conn == nil {
		return KafkaConsumerHandle{}, errors.New("worker command JetStream client is unavailable")
	}
	if worker == nil {
		return KafkaConsumerHandle{}, errors.New("worker is required for JetStream command ingress")
	}
	workerID := strings.TrimSpace(worker.cfg.WorkerID)
	if workerID == "" {
		return KafkaConsumerHandle{}, errors.New("worker_id is required for JetStream command ingress")
	}
	subject := workerCommandSubject(workerID)
	durable := workerCommandDurableName(workerID)
	consumerConfig := workerCommandConsumerConfig(workerID)
	consumerInfo, err := client.js.AddConsumer(workerCommandStreamName, consumerConfig, nats.Context(ctx))
	if err != nil {
		return KafkaConsumerHandle{}, fmt.Errorf("create or validate worker command consumer durable=%s: %w", durable, err)
	}
	if err := validateWorkerCommandConsumerInfo(consumerInfo, consumerConfig); err != nil {
		return KafkaConsumerHandle{}, err
	}
	subscription, err := client.js.PullSubscribe(
		subject,
		durable,
		nats.Bind(workerCommandStreamName, durable),
		nats.ManualAck(),
	)
	if err != nil {
		return KafkaConsumerHandle{}, fmt.Errorf("bind worker command pull consumer subject=%s durable=%s: %w", subject, durable, err)
	}
	// Activate the epoch only after the durable has been validated and bound.
	// This prevents publishers from observing an active replacement fence while
	// the new runtime is still unable to receive its queued commands.
	commandEpoch, err := client.ensureActiveEpoch(ctx, worker.cfg)
	if err != nil {
		_ = subscription.Unsubscribe()
		return KafkaConsumerHandle{}, err
	}
	// Warm workers connect to NATS before runtime activation; retain the bound
	// identity so malformed or mistargeted envelopes cannot choose the failure
	// subject through untrusted payload fields, and stale runtimes cannot accept
	// commands issued for a replacement writer epoch.
	client.bindRuntimeIdentity(worker.cfg, commandEpoch)
	ready := make(chan struct{})
	lifecycle := make(chan KafkaConsumerLifecycleEvent, 4)
	done := make(chan struct{})
	event := KafkaConsumerLifecycleEvent{Topic: subject, GroupID: durable, GenerationID: 1, Ready: true, Reason: "jetstream_pull_bound"}
	emitKafkaConsumerLifecycle(ctx, lifecycle, observer, event)
	close(ready)
	go func() {
		defer close(done)
		defer close(lifecycle)
		defer subscription.Unsubscribe()
		err := client.consume(ctx, worker, subscription)
		reason := "jetstream_consumer_stopped"
		if err != nil && ctx.Err() == nil {
			reason = "jetstream_consumer_failed"
			log.Printf("whatsmeow JetStream command consumer failed worker_id=%s durable=%s error_code=%s", workerID, durable, safeOperationalErrorCode(err))
		}
		emitKafkaConsumerLifecycle(context.Background(), lifecycle, observer, KafkaConsumerLifecycleEvent{
			Topic: subject, GroupID: durable, GenerationID: 1, Ready: false, Reason: reason,
		})
	}()
	return KafkaConsumerHandle{Ready: ready, Lifecycle: lifecycle, Done: done}, nil
}

func workerCommandConsumerConfig(workerID string) *nats.ConsumerConfig {
	return &nats.ConsumerConfig{
		Durable:         workerCommandDurableName(workerID),
		Name:            workerCommandDurableName(workerID),
		Description:     "Underchat worker command ingress v1",
		DeliverPolicy:   nats.DeliverAllPolicy,
		AckPolicy:       nats.AckExplicitPolicy,
		AckWait:         workerCommandDeadline,
		MaxDeliver:      -1,
		FilterSubject:   workerCommandSubject(workerID),
		ReplayPolicy:    nats.ReplayInstantPolicy,
		MaxAckPending:   128,
		MaxRequestBatch: 64,
		MaxWaiting:      128,
		Replicas:        3,
	}
}

// ensureActiveEpoch binds a concrete runtime to a logical command epoch. The
// logical epoch survives runtime recreation so commands admitted immediately
// before a handoff remain valid; generation plus runtime_writer_epoch fence the
// concrete process. Draining/closed records are never reopened implicitly.
func (client *WorkerCommandNATSClient) ensureActiveEpoch(_ context.Context, cfg Config) (string, error) {
	workerID := strings.TrimSpace(cfg.WorkerID)
	accountID := strings.TrimSpace(cfg.AccountID)
	writerEpoch := strings.TrimSpace(cfg.WriterEpoch)
	runtimeGeneration := cfg.RuntimeGeneration
	if workerID == "" || accountID == "" || writerEpoch == "" || runtimeGeneration <= 0 {
		return "", errors.New("worker_id, account_id, writer epoch and positive runtime generation are required for command epoch fencing")
	}
	if err := validateOpaqueWorkerCommandEpoch(writerEpoch); err != nil {
		return "", fmt.Errorf("invalid writer epoch for command epoch fencing: %w", err)
	}
	epochKey := workerCommandEpochKey(workerID)
	entry, err := client.epochKV.Get(epochKey)
	if err == nil {
		record, decodeErr := decodeWorkerCommandEpochEntry(entry, workerID, accountID)
		if decodeErr != nil {
			return "", decodeErr
		}
		switch classifyWorkerCommandEpochActivation(record, writerEpoch, runtimeGeneration) {
		case workerCommandEpochAccept:
			return record.Epoch, nil
		case workerCommandEpochReplace:
			return client.advanceWorkerCommandRuntime(epochKey, entry.Revision(), record, writerEpoch, runtimeGeneration)
		default:
			return "", errWorkerCommandEpochRejected
		}
	}
	if !errors.Is(err, nats.ErrKeyNotFound) || entry != nil {
		return "", fmt.Errorf("inspect worker command epoch: %w", err)
	}
	logicalUUID, err := uuid.NewV7()
	if err != nil {
		return "", fmt.Errorf("generate logical worker command epoch: %w", err)
	}
	logicalEpoch := logicalUUID.String()
	now := workerCommandTimestamp(time.Now())
	record := workerCommandEpochRecordV1{
		SchemaVersion:      1,
		WorkerID:           workerID,
		AccountID:          accountID,
		Epoch:              logicalEpoch,
		RuntimeWriterEpoch: stringPointer(writerEpoch),
		RuntimeGeneration:  runtimeGeneration,
		State:              "active",
		ActivatedAt:        now,
		UpdatedAt:          now,
		ClosedAt:           nil,
	}
	payload, marshalErr := json.Marshal(record)
	if marshalErr != nil {
		return "", marshalErr
	}
	if _, updateErr := client.epochKV.Update(epochKey, payload, 0); updateErr != nil {
		// A concurrent initializer may have won the CAS. Re-read and accept only
		// the exact active identity; a tombstone or different epoch stays closed.
		current, currentErr := client.epochKV.Get(epochKey)
		if currentErr != nil {
			return "", fmt.Errorf("initialize worker command epoch without reopening tombstone: %w", updateErr)
		}
		currentRecord, currentErr := decodeWorkerCommandEpochEntry(current, workerID, accountID)
		if currentErr != nil || classifyWorkerCommandEpochActivation(currentRecord, writerEpoch, runtimeGeneration) != workerCommandEpochAccept {
			return "", errWorkerCommandEpochRejected
		}
		return currentRecord.Epoch, nil
	}
	return logicalEpoch, nil
}

func (client *WorkerCommandNATSClient) advanceWorkerCommandRuntime(
	epochKey string,
	revision uint64,
	record workerCommandEpochRecordV1,
	writerEpoch string,
	runtimeGeneration int,
) (string, error) {
	now := workerCommandTimestamp(time.Now())
	replacement := record
	replacement.RuntimeWriterEpoch = stringPointer(writerEpoch)
	replacement.RuntimeGeneration = runtimeGeneration
	replacement.UpdatedAt = now
	replacement.ClosedAt = nil
	payload, err := json.Marshal(replacement)
	if err != nil {
		return "", err
	}
	if _, err = client.epochKV.Update(epochKey, payload, revision); err == nil {
		return replacement.Epoch, nil
	}
	current, currentErr := client.epochKV.Get(epochKey)
	if currentErr == nil {
		currentRecord, decodeErr := decodeWorkerCommandEpochEntry(current, record.WorkerID, record.AccountID)
		if decodeErr == nil && currentRecord.Epoch == record.Epoch && classifyWorkerCommandEpochActivation(currentRecord, writerEpoch, runtimeGeneration) == workerCommandEpochAccept {
			return currentRecord.Epoch, nil
		}
	}
	if currentErr != nil {
		return "", errors.Join(errWorkerCommandEpochUnavailable, err, currentErr)
	}
	return "", errWorkerCommandEpochRejected
}

func workerCommandEpochKey(workerID string) string {
	return "worker." + strings.TrimSpace(workerID)
}

func (client *WorkerCommandNATSClient) bindRuntimeIdentity(cfg Config, commandEpoch string) {
	client.runtimeIdentityM.Lock()
	client.runtimeIdentity = workerCommandRuntimeIdentity{
		WorkerID:          strings.TrimSpace(cfg.WorkerID),
		AccountID:         strings.TrimSpace(cfg.AccountID),
		CommandEpoch:      strings.TrimSpace(commandEpoch),
		WriterEpoch:       strings.TrimSpace(cfg.WriterEpoch),
		RuntimeGeneration: cfg.RuntimeGeneration,
	}
	client.runtimeIdentityM.Unlock()
}

func (client *WorkerCommandNATSClient) boundRuntimeIdentity() workerCommandRuntimeIdentity {
	client.runtimeIdentityM.RLock()
	defer client.runtimeIdentityM.RUnlock()
	return client.runtimeIdentity
}

func classifyWorkerCommandEpochActivation(record workerCommandEpochRecordV1, requestedWriterEpoch string, requestedGeneration int) workerCommandEpochActivation {
	if record.State != "active" {
		return workerCommandEpochReject
	}
	if record.RuntimeGeneration == requestedGeneration && effectiveWorkerCommandRuntimeWriterEpoch(record) == requestedWriterEpoch {
		return workerCommandEpochAccept
	}
	if requestedGeneration > record.RuntimeGeneration {
		return workerCommandEpochReplace
	}
	return workerCommandEpochReject
}

func effectiveWorkerCommandRuntimeWriterEpoch(record workerCommandEpochRecordV1) string {
	if record.RuntimeWriterEpoch != nil && strings.TrimSpace(*record.RuntimeWriterEpoch) != "" {
		return strings.TrimSpace(*record.RuntimeWriterEpoch)
	}
	// Records written before runtime_writer_epoch was introduced used epoch for
	// both identities. This compatibility is read-only; the next newer runtime
	// upgrades the record through CAS without changing the logical epoch.
	return record.Epoch
}

func stringPointer(value string) *string {
	value = strings.TrimSpace(value)
	return &value
}

func decodeWorkerCommandEpochEntry(entry nats.KeyValueEntry, workerID, accountID string) (workerCommandEpochRecordV1, error) {
	if entry == nil || entry.Operation() != nats.KeyValuePut {
		return workerCommandEpochRecordV1{}, errWorkerCommandEpochRejected
	}
	if len(entry.Value()) == 0 || len(entry.Value()) > 1024 {
		return workerCommandEpochRecordV1{}, errWorkerCommandEpochRejected
	}
	var record workerCommandEpochRecordV1
	if err := json.Unmarshal(entry.Value(), &record); err != nil {
		return workerCommandEpochRecordV1{}, errors.Join(errWorkerCommandEpochRejected, err)
	}
	if record.SchemaVersion != 1 ||
		record.WorkerID != workerID ||
		record.AccountID != accountID ||
		record.RuntimeGeneration <= 0 ||
		record.Epoch != strings.TrimSpace(record.Epoch) ||
		(record.State != "active" && record.State != "draining" && record.State != "closed") {
		return workerCommandEpochRecordV1{}, errWorkerCommandEpochRejected
	}
	if err := validateOpaqueWorkerCommandEpoch(record.Epoch); err != nil {
		return workerCommandEpochRecordV1{}, errWorkerCommandEpochRejected
	}
	if record.RuntimeWriterEpoch != nil {
		if *record.RuntimeWriterEpoch != strings.TrimSpace(*record.RuntimeWriterEpoch) {
			return workerCommandEpochRecordV1{}, errWorkerCommandEpochRejected
		}
		if err := validateOpaqueWorkerCommandEpoch(*record.RuntimeWriterEpoch); err != nil {
			return workerCommandEpochRecordV1{}, errWorkerCommandEpochRejected
		}
	}
	if _, err := parseCanonicalWorkerCommandTimestamp(record.ActivatedAt); err != nil {
		return workerCommandEpochRecordV1{}, errWorkerCommandEpochRejected
	}
	if _, err := parseCanonicalWorkerCommandTimestamp(record.UpdatedAt); err != nil {
		return workerCommandEpochRecordV1{}, errWorkerCommandEpochRejected
	}
	if record.State == "closed" {
		if record.ClosedAt == nil {
			return workerCommandEpochRecordV1{}, errWorkerCommandEpochRejected
		}
		if _, err := parseCanonicalWorkerCommandTimestamp(*record.ClosedAt); err != nil {
			return workerCommandEpochRecordV1{}, errWorkerCommandEpochRejected
		}
	} else if record.ClosedAt != nil {
		return workerCommandEpochRecordV1{}, errWorkerCommandEpochRejected
	}
	return record, nil
}

func validateWorkerCommandConsumerInfo(actual *nats.ConsumerInfo, expected *nats.ConsumerConfig) error {
	if actual == nil || expected == nil {
		return errors.New("worker command consumer metadata is unavailable")
	}
	config := actual.Config
	if config.Durable != expected.Durable ||
		config.Name != expected.Name ||
		config.FilterSubject != expected.FilterSubject ||
		config.DeliverPolicy != nats.DeliverAllPolicy ||
		config.AckPolicy != nats.AckExplicitPolicy ||
		config.AckWait != workerCommandDeadline ||
		config.MaxDeliver != -1 ||
		config.MaxAckPending != 128 ||
		config.MaxRequestBatch != 64 ||
		config.MaxWaiting != 128 ||
		config.ReplayPolicy != nats.ReplayInstantPolicy ||
		config.Replicas != 3 ||
		config.DeliverSubject != "" {
		return fmt.Errorf("worker command durable %s has incompatible fail-closed configuration", expected.Durable)
	}
	// NakWithDelay applies the six approved retry delays. Configuring server-side
	// BackOff would override AckWait with its first value, making the 15-second
	// InProgress heartbeat too slow and allowing concurrent duplicate delivery.
	if len(config.BackOff) != 0 || len(expected.BackOff) != 0 {
		return fmt.Errorf("worker command durable %s has incompatible redelivery backoff", expected.Durable)
	}
	return nil
}

func (client *WorkerCommandNATSClient) consume(ctx context.Context, worker *Worker, subscription *nats.Subscription) error {
	batchSize := worker.cfg.KafkaConsumerMaxInFlight
	if batchSize <= 0 {
		batchSize = 32
	}
	if batchSize > 64 {
		batchSize = 64
	}
	var handlers sync.WaitGroup
	defer handlers.Wait()
	for {
		if !client.conn.IsConnected() {
			return errors.New("worker command NATS connection is not ready")
		}
		batch, err := subscription.FetchBatch(batchSize, nats.MaxWait(time.Second))
		if err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			return fmt.Errorf("fetch worker commands: %w", err)
		}
		messages := batch.Messages()
		for messages != nil {
			var message *nats.Msg
			var ok bool
			select {
			case <-ctx.Done():
				return ctx.Err()
			case message, ok = <-messages:
				if !ok {
					messages = nil
					continue
				}
			}
			dispatchMessage := message
			handlers.Add(1)
			go func() {
				defer handlers.Done()
				client.consumeMessage(ctx, worker, dispatchMessage)
			}()
		}
		if err := batch.Error(); err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			return fmt.Errorf("receive worker command batch: %w", err)
		}
	}
}

func (client *WorkerCommandNATSClient) consumeMessage(ctx context.Context, worker *Worker, message *nats.Msg) {
	stopProgress := make(chan struct{})
	progressDone := make(chan struct{})
	_ = message.InProgress()
	go func() {
		defer close(progressDone)
		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-stopProgress:
				return
			case <-ctx.Done():
				return
			case <-ticker.C:
				_ = message.InProgress()
			}
		}
	}()
	defer func() {
		close(stopProgress)
		<-progressDone
	}()

	envelope, err := DecodeWorkerCommandEnvelopeV1(message.Data)
	if err != nil {
		client.failAndAck(ctx, message, WorkerCommandEnvelopeV1{WorkerID: worker.cfg.WorkerID}, "invalid_envelope", err)
		return
	}
	if message.Subject != workerCommandSubject(worker.cfg.WorkerID) {
		client.failAndAck(ctx, message, envelope, "invalid_subject", errors.New("message subject does not exactly target worker"))
		return
	}
	if err := envelope.ValidateTarget(worker.cfg.AccountID, worker.cfg.WorkerID); err != nil {
		client.failAndAck(ctx, message, envelope, "invalid_target", err)
		return
	}
	if err := envelope.ValidateFresh(time.Now()); err != nil {
		if completeErr := worker.completeWorkerCommandLaneWithFailure(ctx, envelope, sendIdempotencyStateExpired, "expired"); completeErr != nil {
			client.retryMessage(message, completeErr)
			return
		}
		client.failAndAck(ctx, message, envelope, "expired", err)
		return
	}
	kafkaMessage, err := workerCommandKafkaMessage(envelope)
	if err != nil {
		client.failAndAck(ctx, message, envelope, "invalid_envelope", err)
		return
	}
	// Redis is the cross-runtime sequencer. Keeping a process-local FIFO here
	// would let an already-delivered successor sit in front of a redelivered
	// predecessor. Each delivery therefore attempts the durable lane directly.
	// One immediate successor can heartbeat-wait; deeper never-active successors
	// move to the dedicated JetStream scheduler so they release AckPending
	// capacity without adding redelivery latency to the head of the lane.
	client.consumeLaneMessage(ctx, worker, message, envelope, kafkaMessage)
}

func (client *WorkerCommandNATSClient) consumeLaneMessage(
	ctx context.Context,
	worker *Worker,
	message *nats.Msg,
	envelope WorkerCommandEnvelopeV1,
	kafkaMessage kafka.Message,
) {
	lane, err := worker.claimWorkerCommandLane(ctx, envelope)
	for err == nil && lane == workerCommandLaneBusy {
		if !time.Now().Before(envelope.deadlineTime()) {
			expiredErr := errors.New("worker command expired while waiting for its entity lane")
			if completeErr := worker.completeWorkerCommandLaneWithFailure(ctx, envelope, sendIdempotencyStateExpired, "expired"); completeErr != nil {
				client.retryMessage(message, completeErr)
				return
			}
			client.failAndAck(ctx, message, envelope, "expired", expiredErr)
			return
		}
		timer := time.NewTimer(workerCommandLaneWaitPoll)
		select {
		case <-ctx.Done():
			if !timer.Stop() {
				<-timer.C
			}
			return
		case <-timer.C:
		}
		lane, err = worker.claimWorkerCommandLane(ctx, envelope)
	}
	if err != nil {
		if ctx.Err() == nil {
			client.retryUnacquired(ctx, worker, message, envelope, err)
		}
		return
	}
	if lane == workerCommandLaneDeferred {
		if err := client.deferWorkerCommand(ctx, message, envelope); err != nil {
			if errors.Is(err, errWorkerCommandDeferredExpired) || !time.Now().Before(envelope.deadlineTime()) {
				if completeErr := worker.completeWorkerCommandLaneWithFailure(ctx, envelope, sendIdempotencyStateExpired, "expired"); completeErr == nil {
					client.failAndAck(ctx, message, envelope, "expired", err)
					return
				}
			}
			client.retryUnacquired(ctx, worker, message, envelope, err)
			return
		}
		client.ackMessage(message)
		return
	}
	if lane == workerCommandLaneDuplicate {
		failureCode, readErr := worker.workerCommandLaneFailureCode(ctx, envelope)
		if readErr != nil {
			client.retryMessage(message, readErr)
			return
		}
		if failureCode != "" {
			if publishErr := client.publishFailure(ctx, message, envelope, failureCode, errors.New(failureCode)); publishErr != nil {
				client.retryMessage(message, publishErr)
				return
			}
		}
		client.ackMessage(message)
		return
	}
	if lane == workerCommandLaneStale {
		client.failAndAck(ctx, message, envelope, "failed", errWorkerCommandLaneStale)
		return
	}

	deadline := envelope.deadlineTime()
	commandCtx, cancel := context.WithDeadline(ctx, deadline)
	defer cancel()
	commandCtx, outcomeRecorder := withWorkerCommandOutcomeRecorder(commandCtx)
	stopLaneRenewal, laneRenewalLost := worker.maintainWorkerCommandLane(ctx, envelope)
	var stopLaneRenewalOnce sync.Once
	var laneRenewalErr error
	stopRenewal := func() error {
		stopLaneRenewalOnce.Do(func() { laneRenewalErr = stopLaneRenewal() })
		return laneRenewalErr
	}
	defer stopRenewal()
	retryAcquired := func(cause error) {
		if renewErr := stopRenewal(); renewErr != nil {
			cause = errors.Join(cause, renewErr)
		}
		if releaseErr := worker.releaseWorkerCommandLane(ctx, envelope); releaseErr != nil {
			client.retryMessage(message, errors.Join(cause, releaseErr))
			return
		}
		technicalRetry, retryErr := worker.recordWorkerCommandTechnicalRetry(ctx, envelope)
		if retryErr != nil {
			client.retryMessage(message, errors.Join(cause, retryErr))
			return
		}
		if technicalRetry > workerCommandMaximumTechnicalRetries {
			if completeErr := worker.completeWorkerCommandLaneWithFailure(ctx, envelope, sendIdempotencyStateFailed, "dead_letter"); completeErr != nil {
				client.retryMessage(message, completeErr)
				return
			}
			if publishErr := client.publishFailure(ctx, message, envelope, "dead_letter", cause); publishErr != nil {
				client.retryMessage(message, publishErr)
				return
			}
			client.ackMessage(message)
			return
		}
		client.retryTechnicalMessage(message, cause, technicalRetry)
	}
	finishTerminal := func(state, code string, terminalErr error) {
		_ = stopRenewal()
		failureCode := ""
		if terminalErr != nil {
			failureCode = code
		}
		// The lane is released first and remembers the failure code. If PubAck is
		// unavailable, redelivery observes the terminal record and republishes the
		// same failure idempotently without invoking the provider again.
		if completeErr := worker.completeWorkerCommandLaneWithFailure(ctx, envelope, state, failureCode); completeErr != nil {
			retryAcquired(completeErr)
			return
		}
		if terminalErr != nil {
			if publishErr := client.publishFailure(ctx, message, envelope, code, terminalErr); publishErr != nil {
				client.retryMessage(message, publishErr)
				return
			}
		}
		client.ackMessage(message)
	}

	if err := worker.validateWorkerCommandPayload(envelope, kafkaMessage); err != nil {
		finishTerminal(sendIdempotencyStateFailed, "invalid_target", err)
		return
	}
	if err := envelope.ValidateFresh(time.Now()); err != nil {
		finishTerminal(sendIdempotencyStateExpired, "expired", err)
		return
	}
	if err := client.epochVerifier(commandCtx, envelope); err != nil {
		if errors.Is(err, errWorkerCommandEpochRejected) {
			finishTerminal(sendIdempotencyStateFailed, "epoch_rejected", err)
		} else {
			retryAcquired(err)
		}
		return
	}

	handler, err := worker.workerCommandHandler(envelope.CommandType)
	if err != nil {
		finishTerminal(sendIdempotencyStateFailed, "invalid_envelope", err)
		return
	}
	authorizedCtx, releaseAuthorization, admissionErr := worker.waitForKafkaDispatchAdmission(commandCtx)
	if admissionErr != nil {
		if errors.Is(commandCtx.Err(), context.DeadlineExceeded) {
			finishTerminal(sendIdempotencyStateExpired, "expired", commandCtx.Err())
		} else {
			retryAcquired(admissionErr)
		}
		return
	}
	defer releaseAuthorization()
	authorizedCtx = withWorkerCommandEpochVerification(authorizedCtx, envelope, client.epochVerifier)
	if epochErr := verifyWorkerCommandEpochFromContext(authorizedCtx); epochErr != nil {
		retryAcquired(epochErr)
		return
	}
	select {
	case client.laneSlots <- struct{}{}:
		defer func() { <-client.laneSlots }()
	case renewErr := <-laneRenewalLost:
		retryAcquired(renewErr)
		return
	case <-commandCtx.Done():
		finishTerminal(sendIdempotencyStateExpired, "expired", commandCtx.Err())
		return
	}
	select {
	case renewErr := <-laneRenewalLost:
		retryAcquired(renewErr)
		return
	default:
	}
	err = handler(authorizedCtx, kafkaMessage)
	if terminalCode := outcomeRecorder.terminalCode(); terminalCode != "" {
		terminalState := terminalCode
		terminalErr := err
		if terminalErr == nil {
			terminalErr = errors.New("outbound ledger reached terminal state " + terminalCode)
		}
		finishTerminal(terminalState, terminalCode, terminalErr)
		return
	}
	if err == nil || shouldCommitTerminalKafkaHandlerError(err) {
		if err == nil {
			finishTerminal(sendIdempotencyStateSucceeded, "", nil)
		} else {
			finishTerminal(sendIdempotencyStateFailed, "failed", nonTerminalKafkaHandlerCause(err))
		}
		return
	}
	if errors.Is(err, errWorkerCommandEpochRejected) {
		finishTerminal(sendIdempotencyStateFailed, "epoch_rejected", err)
		return
	}
	if !time.Now().Before(deadline) || errors.Is(err, context.DeadlineExceeded) {
		finishTerminal(sendIdempotencyStateExpired, "expired", err)
		return
	}
	retryAcquired(err)
}

func (worker *Worker) workerCommandHandler(commandType string) (KafkaMessageHandler, error) {
	switch commandType {
	case WorkerCommandTypeDirectSend, WorkerCommandTypeProviderCommand:
		return worker.handleSendMessage, nil
	case WorkerCommandTypeScheduleSend:
		return worker.handleScheduleSend, nil
	case WorkerCommandTypeNotificationSend:
		return worker.handleNotification, nil
	case WorkerCommandTypeWebhookIntegration:
		return worker.handleWebhookIntegration, nil
	case WorkerCommandTypeMarkRead:
		return worker.handleMarkRead, nil
	case WorkerCommandTypeWorkerConfig:
		return worker.handleWorkerConfigUpdate, nil
	default:
		return nil, fmt.Errorf("unsupported command_type %q", commandType)
	}
}

func (client *WorkerCommandNATSClient) ackMessage(message *nats.Msg) {
	ackCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := message.AckSync(nats.Context(ackCtx)); err != nil {
		log.Printf("whatsmeow JetStream command AckSync failed error_code=%s", safeOperationalErrorCode(err))
	}
}

func (client *WorkerCommandNATSClient) retryMessage(message *nats.Msg, cause error) {
	if err := message.NakWithDelay(workerCommandLaneRecheckDelay); err != nil {
		log.Printf("whatsmeow JetStream command NAK failed cause_code=%s error_code=%s", safeOperationalErrorCode(cause), safeOperationalErrorCode(err))
	}
}

func (client *WorkerCommandNATSClient) retryTechnicalMessage(message *nats.Msg, cause error, technicalRetry int) {
	index := technicalRetry - 1
	if index < 0 {
		index = 0
	}
	if index >= len(workerCommandRedeliveryBackoff) {
		index = len(workerCommandRedeliveryBackoff) - 1
	}
	if err := message.NakWithDelay(workerCommandRedeliveryBackoff[index]); err != nil {
		log.Printf("whatsmeow JetStream technical command NAK failed retry=%d cause_code=%s error_code=%s", technicalRetry, safeOperationalErrorCode(cause), safeOperationalErrorCode(err))
	}
}

func (client *WorkerCommandNATSClient) retryUnacquired(
	ctx context.Context,
	worker *Worker,
	message *nats.Msg,
	envelope WorkerCommandEnvelopeV1,
	cause error,
) {
	technicalRetry, retryErr := worker.recordWorkerCommandTechnicalRetry(ctx, envelope)
	if retryErr != nil {
		client.retryMessage(message, errors.Join(cause, retryErr))
		return
	}
	if technicalRetry <= workerCommandMaximumTechnicalRetries {
		client.retryTechnicalMessage(message, cause, technicalRetry)
		return
	}
	if err := worker.completeWorkerCommandLaneWithFailure(ctx, envelope, sendIdempotencyStateFailed, "dead_letter"); err != nil {
		client.retryMessage(message, err)
		return
	}
	if err := client.publishFailure(ctx, message, envelope, "dead_letter", cause); err != nil {
		client.retryMessage(message, err)
		return
	}
	client.ackMessage(message)
}

func (client *WorkerCommandNATSClient) failAndAck(ctx context.Context, message *nats.Msg, envelope WorkerCommandEnvelopeV1, code string, cause error) {
	if err := client.publishFailure(ctx, message, envelope, code, cause); err != nil {
		client.retryMessage(message, err)
		return
	}
	client.ackMessage(message)
}

func (client *WorkerCommandNATSClient) publishFailure(ctx context.Context, message *nats.Msg, envelope WorkerCommandEnvelopeV1, code string, cause error) error {
	if _, allowed := workerCommandFailureCodes[code]; !allowed {
		return fmt.Errorf("invalid worker command failure code %q", code)
	}
	if cause == nil {
		cause = errors.New(code)
	}
	identity := client.boundRuntimeIdentity()
	workerID := firstNonEmpty(identity.WorkerID, envelope.WorkerID)
	failureIdentity := workerCommandFailureIdentity(message, envelope.CommandID)
	failure := workerCommandFailureV1{
		SchemaVersion:  1,
		FailureID:      workerCommandFailureID(workerID, failureIdentity, code),
		CommandID:      nullableWorkerCommandString(envelope.CommandID),
		OperationID:    nullableWorkerCommandString(envelope.OperationID),
		AccountID:      nullableWorkerCommandString(envelope.AccountID),
		WorkerID:       workerID,
		CommandType:    nullableWorkerCommandString(envelope.CommandType),
		EntityKey:      nullableWorkerCommandString(envelope.EntityKey),
		EntitySequence: nullableWorkerCommandSequence(envelope.EntitySequence),
		PayloadDigest:  nullableWorkerCommandString(envelope.PayloadDigest),
		Code:           code,
		ErrorName:      "error",
		ErrorCode:      safeOperationalErrorCode(cause),
		FailedAt:       workerCommandTimestamp(time.Now()),
	}
	payload, err := json.Marshal(failure)
	if err != nil {
		return err
	}
	publishCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	if _, err := client.js.Publish(
		workerCommandFailureSubject(failure.WorkerID),
		payload,
		nats.ExpectStream(workerCommandFailuresStreamName),
		nats.MsgId(failure.FailureID),
		nats.Context(publishCtx),
	); err != nil {
		return fmt.Errorf("publish command failure: %w", err)
	}
	return nil
}

func workerCommandFailureIdentity(message *nats.Msg, commandID string) string {
	if workerCommandIdentifierPattern.MatchString(commandID) {
		return commandID
	}
	stream := "unknown"
	var sequence uint64
	subject := "unknown"
	var raw []byte
	if message != nil {
		subject = firstNonEmpty(message.Subject, subject)
		raw = message.Data
		if metadata, err := message.Metadata(); err == nil {
			stream = firstNonEmpty(metadata.Stream, stream)
			sequence = metadata.Sequence.Stream
		}
	}
	rawDigest := sha256.Sum256(raw)
	return fmt.Sprintf("%s:%d:%s:%s", stream, sequence, subject, hex.EncodeToString(rawDigest[:]))
}

func workerCommandFailureID(workerID, identity, code string) string {
	digest := sha256.Sum256([]byte("worker-command-failure-v1\x00" + workerID + "\x00" + identity + "\x00" + code))
	return hex.EncodeToString(digest[:])
}

func nullableWorkerCommandString(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

func nullableWorkerCommandSequence(value uint64) *uint64 {
	if value == 0 {
		return nil
	}
	return &value
}

func (client *WorkerCommandNATSClient) verifyEpoch(_ context.Context, envelope WorkerCommandEnvelopeV1) error {
	if client == nil || client.epochKV == nil {
		return errWorkerCommandEpochUnavailable
	}
	entry, err := client.epochKV.Get(workerCommandEpochKey(envelope.WorkerID))
	if err != nil {
		if errors.Is(err, nats.ErrKeyNotFound) || errors.Is(err, nats.ErrKeyDeleted) {
			return errors.Join(errWorkerCommandEpochUnavailable, err)
		}
		return errors.Join(errWorkerCommandEpochUnavailable, err)
	}
	record, err := decodeWorkerCommandEpochEntry(entry, envelope.WorkerID, envelope.AccountID)
	if err != nil {
		return err
	}
	return workerCommandEpochVerificationError(record, envelope, client.boundRuntimeIdentity())
}

func workerCommandEpochVerificationError(
	record workerCommandEpochRecordV1,
	envelope WorkerCommandEnvelopeV1,
	identity workerCommandRuntimeIdentity,
) error {
	if record.State != "active" || record.Epoch != envelope.OriginEpoch {
		return errWorkerCommandEpochRejected
	}
	if !workerCommandEpochAuthorizesRuntime(record, envelope, identity) {
		return errWorkerCommandRuntimeReplaced
	}
	return nil
}

func workerCommandEpochAuthorizesRuntime(
	record workerCommandEpochRecordV1,
	envelope WorkerCommandEnvelopeV1,
	identity workerCommandRuntimeIdentity,
) bool {
	return identity.WorkerID == envelope.WorkerID &&
		identity.AccountID == envelope.AccountID &&
		identity.CommandEpoch == envelope.OriginEpoch &&
		identity.WriterEpoch == effectiveWorkerCommandRuntimeWriterEpoch(record) &&
		identity.RuntimeGeneration > 0 &&
		record.RuntimeGeneration == identity.RuntimeGeneration &&
		record.State == "active" &&
		record.Epoch == envelope.OriginEpoch
}

type workerCommandLaneDisposition string

const (
	workerCommandLaneAcquired  workerCommandLaneDisposition = "acquired"
	workerCommandLaneDuplicate workerCommandLaneDisposition = "duplicate"
	workerCommandLaneBusy      workerCommandLaneDisposition = "busy"
	workerCommandLaneDeferred  workerCommandLaneDisposition = "deferred"
	workerCommandLaneStale     workerCommandLaneDisposition = "stale"
)

const claimWorkerCommandLaneScript = `
local key = KEYS[1]
local sequence = tonumber(ARGV[1])
local operation_id = ARGV[2]
local operation_digest = ARGV[3]
local predecessor = ARGV[4]
local predecessor_digest = ARGV[5]
local command_id = ARGV[6]
local issued_at_ms = tonumber(ARGV[7])
local origin_epoch = ARGV[8]
local payload_digest = ARGV[9]
local command_type = ARGV[10]
local active_lease_ms = tonumber(ARGV[11])
local ttl_seconds = tonumber(ARGV[12])
local command_deadline_ms = tonumber(ARGV[13])
local redis_time = redis.call('TIME')
local now = (tonumber(redis_time[1]) * 1000) + math.floor(tonumber(redis_time[2]) / 1000)

local function dependencies_terminal(start_prefix)
  local cursor_prefix = start_prefix
  for _ = 1, 256 do
    if (redis.call('HGET', key, cursor_prefix .. ':predecessor_satisfied') or '') == '1' then
      return true
    end
    local dependency_id = redis.call('HGET', key, cursor_prefix .. ':predecessor') or ''
    if dependency_id == '' then return true end
    local dependency_digest = redis.call('HGET', key, cursor_prefix .. ':predecessor_digest') or ''
    if dependency_digest == '' then return false end
    local dependency_prefix = 'op:' .. dependency_digest
    if (redis.call('HGET', key, dependency_prefix .. ':operation_id') or '') ~= dependency_id or
       (redis.call('HGET', key, dependency_prefix .. ':terminal') or '') == '' then
      return false
    end
    cursor_prefix = dependency_prefix
  end
  return false
end

if redis.call('EXISTS', key) == 0 then
  return 'busy'
end
local prefix = 'op:' .. operation_digest
local stored_sequence = tonumber(redis.call('HGET', key, prefix .. ':sequence') or '0')
local stored_operation = redis.call('HGET', key, prefix .. ':operation_id') or ''
local stored_predecessor = redis.call('HGET', key, prefix .. ':predecessor') or ''
local stored_command_id = redis.call('HGET', key, prefix .. ':command_id') or ''
local stored_issued_at_ms = tonumber(redis.call('HGET', key, prefix .. ':issued_at_ms') or '0')
local stored_origin_epoch = redis.call('HGET', key, prefix .. ':origin_epoch') or ''
local stored_payload_digest = redis.call('HGET', key, prefix .. ':payload_digest') or ''
local stored_command_type = redis.call('HGET', key, prefix .. ':command_type') or ''
if stored_sequence ~= sequence or
   stored_operation ~= operation_id or
   stored_predecessor ~= predecessor or
   stored_command_id ~= command_id or
   stored_issued_at_ms ~= issued_at_ms or
   stored_origin_epoch ~= origin_epoch or
   stored_payload_digest ~= payload_digest or
   stored_command_type ~= command_type then
  return 'stale'
end
local terminal = redis.call('HGET', key, prefix .. ':terminal') or ''
if terminal ~= '' then
  return 'duplicate'
end
local active_until = tonumber(redis.call('HGET', key, prefix .. ':active_until_ms') or '0')
if active_until > now then
  return 'busy'
end
if predecessor ~= '' and
   (redis.call('HGET', key, prefix .. ':predecessor_satisfied') or '') ~= '1' then
  local predecessor_prefix = 'op:' .. predecessor_digest
  local predecessor_operation = redis.call('HGET', key, predecessor_prefix .. ':operation_id') or ''
  if predecessor_operation ~= predecessor then
    return 'busy'
  end
  local predecessor_terminal = redis.call('HGET', key, predecessor_prefix .. ':terminal') or ''
  if predecessor_terminal == '' then
    local predecessor_ever_active = redis.call('HGET', key, predecessor_prefix .. ':ever_active') or ''
    local predecessor_active_until = tonumber(redis.call('HGET', key, predecessor_prefix .. ':active_until_ms') or '0')
    local predecessor_issued_at = tonumber(redis.call('HGET', key, predecessor_prefix .. ':issued_at_ms') or '0')
    if predecessor_ever_active == '' and
       predecessor_active_until <= now and
       predecessor_issued_at > 0 and
       now >= predecessor_issued_at + command_deadline_ms and
       dependencies_terminal(predecessor_prefix) then
      redis.call('HSET', key,
        predecessor_prefix .. ':terminal', 'expired',
        predecessor_prefix .. ':terminal_at_ms', tostring(now),
        predecessor_prefix .. ':terminal_failure_code', 'expired',
        predecessor_prefix .. ':predecessor_satisfied', '1')
    elseif predecessor_ever_active == '' and predecessor_active_until <= now then
      return 'deferred'
    else
      return 'busy'
    end
  elseif not dependencies_terminal(predecessor_prefix) then
    return 'deferred'
  end
  redis.call('HSET', key, prefix .. ':predecessor_satisfied', '1')
  -- Retain immutable allocation and terminal tombstones for the full lane TTL.
  -- Only ephemeral ownership fields are compacted when the successor advances.
  redis.call('HDEL', key,
    predecessor_prefix .. ':active_until_ms',
    predecessor_prefix .. ':active_command_id')
end
redis.call('HSET', key,
  prefix .. ':ever_active', '1',
  prefix .. ':active_until_ms', tostring(now + active_lease_ms),
  prefix .. ':active_command_id', command_id,
  'updated_at_ms', tostring(now))
redis.call('EXPIRE', key, ttl_seconds)
return 'acquired'
`

const renewWorkerCommandLaneScript = `
local key = KEYS[1]
local operation_digest = ARGV[1]
local command_id = ARGV[2]
local active_lease_ms = tonumber(ARGV[3])
local ttl_seconds = tonumber(ARGV[4])
local redis_time = redis.call('TIME')
local now = (tonumber(redis_time[1]) * 1000) + math.floor(tonumber(redis_time[2]) / 1000)
local prefix = 'op:' .. operation_digest
if (redis.call('HGET', key, prefix .. ':active_command_id') or '') ~= command_id or
   (redis.call('HGET', key, prefix .. ':terminal') or '') ~= '' then
  return 0
end
redis.call('HSET', key,
  prefix .. ':active_until_ms', tostring(now + active_lease_ms),
  'updated_at_ms', tostring(now))
redis.call('EXPIRE', key, ttl_seconds)
return 1
`

const completeWorkerCommandLaneScript = `
local key = KEYS[1]
local operation_id = ARGV[1]
local operation_digest = ARGV[2]
local command_id = ARGV[3]
local terminal_state = ARGV[4]
local ttl_seconds = tonumber(ARGV[5])
local terminal_failure_code = ARGV[6]
local redis_time = redis.call('TIME')
local now = (tonumber(redis_time[1]) * 1000) + math.floor(tonumber(redis_time[2]) / 1000)
local prefix = 'op:' .. operation_digest
if (redis.call('HGET', key, prefix .. ':operation_id') or '') ~= operation_id then
  return 0
end
if (redis.call('HGET', key, prefix .. ':command_id') or '') ~= command_id then
  return 0
end
local terminal = redis.call('HGET', key, prefix .. ':terminal') or ''
if terminal ~= '' then
  return 1
end
local active_command_id = redis.call('HGET', key, prefix .. ':active_command_id') or ''
if active_command_id ~= '' and active_command_id ~= command_id then
  return 0
end
if active_command_id == '' and terminal_state ~= 'failed' and terminal_state ~= 'expired' then
  return 0
end
redis.call('HSET', key,
  prefix .. ':terminal', terminal_state,
  prefix .. ':terminal_at_ms', tostring(now),
  'completed_sequence', redis.call('HGET', key, prefix .. ':sequence') or '0',
  'completed_operation_id', operation_id,
  'updated_at_ms', tostring(now))
redis.call('HDEL', key, prefix .. ':active_until_ms', prefix .. ':active_command_id')
if terminal_failure_code ~= '' then
  redis.call('HSET', key, prefix .. ':terminal_failure_code', terminal_failure_code)
else
  redis.call('HDEL', key, prefix .. ':terminal_failure_code')
end
redis.call('EXPIRE', key, ttl_seconds)
return 1
`

const releaseWorkerCommandLaneScript = `
local key = KEYS[1]
local operation_digest = ARGV[1]
local command_id = ARGV[2]
local ttl_seconds = tonumber(ARGV[3])
local prefix = 'op:' .. operation_digest
if (redis.call('HGET', key, prefix .. ':active_command_id') or '') ~= command_id then
  return 0
end
if (redis.call('HGET', key, prefix .. ':terminal') or '') ~= '' then
  return 0
end
redis.call('HDEL', key, prefix .. ':active_until_ms', prefix .. ':active_command_id')
redis.call('EXPIRE', key, ttl_seconds)
return 1
`

const recordWorkerCommandTechnicalRetryScript = `
local key = KEYS[1]
local operation_id = ARGV[1]
local operation_digest = ARGV[2]
local command_id = ARGV[3]
local ttl_seconds = tonumber(ARGV[4])
local prefix = 'op:' .. operation_digest
if (redis.call('HGET', key, prefix .. ':operation_id') or '') ~= operation_id or
   (redis.call('HGET', key, prefix .. ':command_id') or '') ~= command_id or
   (redis.call('HGET', key, prefix .. ':terminal') or '') ~= '' then
  return -1
end
local count = redis.call('HINCRBY', key, prefix .. ':technical_retry_count', 1)
local redis_time = redis.call('TIME')
local now = (tonumber(redis_time[1]) * 1000) + math.floor(tonumber(redis_time[2]) / 1000)
redis.call('HSET', key, 'updated_at_ms', tostring(now))
redis.call('EXPIRE', key, ttl_seconds)
return count
`

func workerCommandLaneOperationDigest(operationID string) string {
	digest := sha256.Sum256([]byte(strings.TrimSpace(operationID)))
	return hex.EncodeToString(digest[:])
}

func workerCommandLaneKey(envelope WorkerCommandEnvelopeV1) string {
	digest := sha256.Sum256([]byte(envelope.EntityKey))
	return strings.Join([]string{
		"message-send:lane:v1",
		envelope.AccountID,
		envelope.WorkerID,
		hex.EncodeToString(digest[:]),
	}, ":")
}

func workerCommandLaneEnvelopeFromRecovery(reference workerCommandLaneRecoveryReference) WorkerCommandEnvelopeV1 {
	return WorkerCommandEnvelopeV1{
		AccountID:   reference.AccountID,
		WorkerID:    reference.WorkerID,
		EntityKey:   reference.EntityKey,
		OperationID: reference.OperationID,
		CommandID:   reference.CommandID,
	}
}

func (worker *Worker) completeRecoveredWorkerCommandLane(
	ctx context.Context,
	reference *workerCommandLaneRecoveryReference,
	state string,
	failureCode string,
) error {
	if reference == nil {
		return nil
	}
	if reference.AccountID != worker.cfg.AccountID || reference.WorkerID != worker.cfg.WorkerID {
		return errors.New("recovered worker command lane target does not match runtime")
	}
	return worker.completeWorkerCommandLaneWithFailure(
		ctx,
		workerCommandLaneEnvelopeFromRecovery(*reference),
		state,
		failureCode,
	)
}

func (worker *Worker) claimWorkerCommandLane(ctx context.Context, envelope WorkerCommandEnvelopeV1) (workerCommandLaneDisposition, error) {
	if worker.redis == nil {
		return "", errors.New("Redis is required for worker command entity ordering")
	}
	predecessor := ""
	predecessorDigest := ""
	if envelope.PredecessorOperationID != nil {
		predecessor = *envelope.PredecessorOperationID
		predecessorDigest = workerCommandLaneOperationDigest(predecessor)
	}
	redisCtx, cancel := context.WithTimeout(ctx, outboundRedisOperationTimeout)
	defer cancel()
	result, err := worker.redis.Eval(
		redisCtx,
		claimWorkerCommandLaneScript,
		[]string{workerCommandLaneKey(envelope)},
		envelope.EntitySequence,
		envelope.OperationID,
		workerCommandLaneOperationDigest(envelope.OperationID),
		predecessor,
		predecessorDigest,
		envelope.CommandID,
		envelope.issuedTime().UnixMilli(),
		envelope.OriginEpoch,
		envelope.PayloadDigest,
		envelope.CommandType,
		workerCommandLaneActiveLease.Milliseconds(),
		int64(workerCommandLaneTTL/time.Second),
		workerCommandDeadline.Milliseconds(),
	).Text()
	if err != nil {
		return "", fmt.Errorf("claim worker command entity lane: %w", err)
	}
	disposition := workerCommandLaneDisposition(result)
	switch disposition {
	case workerCommandLaneAcquired, workerCommandLaneDuplicate, workerCommandLaneBusy, workerCommandLaneDeferred, workerCommandLaneStale:
		return disposition, nil
	default:
		return "", fmt.Errorf("claim worker command entity lane returned invalid state %q", result)
	}
}

func (worker *Worker) completeWorkerCommandLane(ctx context.Context, envelope WorkerCommandEnvelopeV1, terminalState string) error {
	return worker.completeWorkerCommandLaneWithFailure(ctx, envelope, terminalState, "")
}

func (worker *Worker) renewWorkerCommandLane(ctx context.Context, envelope WorkerCommandEnvelopeV1) error {
	if worker.redis == nil {
		return errors.New("Redis is required for worker command entity ordering")
	}
	redisCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), outboundRedisOperationTimeout)
	defer cancel()
	renewed, err := worker.redis.Eval(
		redisCtx,
		renewWorkerCommandLaneScript,
		[]string{workerCommandLaneKey(envelope)},
		workerCommandLaneOperationDigest(envelope.OperationID),
		envelope.CommandID,
		workerCommandLaneActiveLease.Milliseconds(),
		int64(workerCommandLaneTTL/time.Second),
	).Int()
	if err != nil {
		return fmt.Errorf("renew worker command entity lane: %w", err)
	}
	if renewed != 1 {
		return errors.New("worker command entity lane ownership was lost")
	}
	return nil
}

func (worker *Worker) maintainWorkerCommandLane(
	ctx context.Context,
	envelope WorkerCommandEnvelopeV1,
) (func() error, <-chan error) {
	renewCtx, cancel := context.WithCancel(ctx)
	done := make(chan struct{})
	lost := make(chan error, 1)
	var renewErr error
	var renewErrMu sync.Mutex
	go func() {
		defer close(done)
		ticker := time.NewTicker(workerCommandLaneRenewInterval)
		defer ticker.Stop()
		for {
			select {
			case <-renewCtx.Done():
				return
			case <-ticker.C:
				if err := worker.renewWorkerCommandLane(renewCtx, envelope); err != nil {
					renewErrMu.Lock()
					renewErr = err
					renewErrMu.Unlock()
					lost <- err
					return
				}
			}
		}
	}()
	stop := func() error {
		cancel()
		<-done
		renewErrMu.Lock()
		defer renewErrMu.Unlock()
		return renewErr
	}
	return stop, lost
}

func (worker *Worker) completeWorkerCommandLaneWithFailure(
	ctx context.Context,
	envelope WorkerCommandEnvelopeV1,
	terminalState string,
	failureCode string,
) error {
	if worker.redis == nil {
		return errors.New("Redis is required for worker command entity ordering")
	}
	switch terminalState {
	case sendIdempotencyStateSucceeded, sendIdempotencyStateFailed, sendIdempotencyStateExpired, sendIdempotencyStateAmbiguous:
	default:
		return fmt.Errorf("invalid worker command lane terminal state %q", terminalState)
	}
	if failureCode != "" {
		if _, allowed := workerCommandFailureCodes[failureCode]; !allowed {
			return fmt.Errorf("invalid worker command lane failure code %q", failureCode)
		}
	}
	redisCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), outboundRedisOperationTimeout)
	defer cancel()
	completed, err := worker.redis.Eval(
		redisCtx,
		completeWorkerCommandLaneScript,
		[]string{workerCommandLaneKey(envelope)},
		envelope.OperationID,
		workerCommandLaneOperationDigest(envelope.OperationID),
		envelope.CommandID,
		terminalState,
		int64(workerCommandLaneTTL/time.Second),
		failureCode,
	).Int()
	if err != nil {
		return fmt.Errorf("complete worker command entity lane: %w", err)
	}
	if completed != 1 {
		return errors.New("worker command entity lane ownership changed before completion")
	}
	return nil
}

func (worker *Worker) workerCommandLaneFailureCode(ctx context.Context, envelope WorkerCommandEnvelopeV1) (string, error) {
	if worker.redis == nil {
		return "", errors.New("Redis is required for worker command entity ordering")
	}
	redisCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), outboundRedisOperationTimeout)
	defer cancel()
	prefix := "op:" + workerCommandLaneOperationDigest(envelope.OperationID)
	code, err := worker.redis.HGet(redisCtx, workerCommandLaneKey(envelope), prefix+":terminal_failure_code").Result()
	if err != nil && !errors.Is(err, redis.Nil) {
		return "", fmt.Errorf("inspect worker command terminal failure: %w", err)
	}
	if code != "" {
		if _, allowed := workerCommandFailureCodes[code]; !allowed {
			return "", fmt.Errorf("invalid stored worker command failure code %q", code)
		}
	}
	return code, nil
}

func (worker *Worker) releaseWorkerCommandLane(ctx context.Context, envelope WorkerCommandEnvelopeV1) error {
	if worker.redis == nil {
		return errors.New("Redis is required for worker command entity ordering")
	}
	redisCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), outboundRedisOperationTimeout)
	defer cancel()
	released, err := worker.redis.Eval(
		redisCtx,
		releaseWorkerCommandLaneScript,
		[]string{workerCommandLaneKey(envelope)},
		workerCommandLaneOperationDigest(envelope.OperationID),
		envelope.CommandID,
		int64(workerCommandLaneTTL/time.Second),
	).Int()
	if err != nil {
		return fmt.Errorf("release worker command entity lane: %w", err)
	}
	if released != 1 {
		return errors.New("worker command entity lane was not releasable")
	}
	return nil
}

func (worker *Worker) recordWorkerCommandTechnicalRetry(ctx context.Context, envelope WorkerCommandEnvelopeV1) (int, error) {
	if worker.redis == nil {
		return 0, errors.New("Redis is required for worker command technical retry accounting")
	}
	redisCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), outboundRedisOperationTimeout)
	defer cancel()
	count, err := worker.redis.Eval(
		redisCtx,
		recordWorkerCommandTechnicalRetryScript,
		[]string{workerCommandLaneKey(envelope)},
		envelope.OperationID,
		workerCommandLaneOperationDigest(envelope.OperationID),
		envelope.CommandID,
		int64(workerCommandLaneTTL/time.Second),
	).Int()
	if err != nil {
		return 0, fmt.Errorf("record worker command technical retry: %w", err)
	}
	if count < 1 {
		return 0, errors.New("worker command technical retry identity is unavailable or terminal")
	}
	return count, nil
}
