package app

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/segmentio/kafka-go"
	"github.com/segmentio/kafka-go/sasl"
	"github.com/segmentio/kafka-go/sasl/plain"
	"github.com/segmentio/kafka-go/sasl/scram"
)

type KafkaClient struct {
	cfg       Config
	transport *kafka.Transport
	writer    *kafka.Writer
	readers   []*kafka.Reader
	consumers map[string]*kafkaConsumerHealthState
	mu        sync.Mutex
}

type kafkaConsumerHealthState struct {
	Topic                        string
	GroupID                      string
	Connected                    bool
	Unhealthy                    bool
	StallReason                  string
	LastMessageAt                time.Time
	LastCommitAt                 time.Time
	LastProgressAt               time.Time
	LastRestartAt                time.Time
	LastWatchdogAt               time.Time
	RestartCount                 int
	ConsecutiveStallRestartCount int
	LastError                    string
	Pending                      map[string]time.Time
	Lag                          int64
	HighWatermark                *int64
	CommittedOffset              *int64
}

func NewKafkaClient(cfg Config) (*KafkaClient, error) {
	transport, err := buildKafkaTransport(cfg)
	if err != nil {
		return nil, err
	}

	writer := &kafka.Writer{
		Addr:                   kafka.TCP(cfg.KafkaBrokers...),
		Balancer:               &kafka.Hash{},
		RequiredAcks:           kafka.RequireAll,
		AllowAutoTopicCreation: true,
		Transport:              transport,
		BatchTimeout:           5 * time.Millisecond,
		WriteTimeout:           30 * time.Second,
		ReadTimeout:            30 * time.Second,
	}

	return &KafkaClient{
		cfg:       cfg,
		transport: transport,
		writer:    writer,
		consumers: make(map[string]*kafkaConsumerHealthState),
	}, nil
}

func buildKafkaTransport(cfg Config) (*kafka.Transport, error) {
	protocol := strings.ToLower(cfg.KafkaProtocol)
	transport := &kafka.Transport{}

	if strings.Contains(protocol, "ssl") {
		transport.TLS = &tls.Config{InsecureSkipVerify: true} // matches the existing worker config.
	}

	if protocol != "plaintext" {
		mechanism, err := buildKafkaSASL(cfg)
		if err != nil {
			return nil, err
		}
		transport.SASL = mechanism
	}

	return transport, nil
}

func buildKafkaSASL(cfg Config) (sasl.Mechanism, error) {
	mechanism := strings.ToUpper(cfg.KafkaSASLMechanism)
	switch mechanism {
	case "", "PLAIN":
		return plain.Mechanism{
			Username: cfg.KafkaUsername,
			Password: cfg.KafkaPassword,
		}, nil
	case "SCRAM-SHA-256":
		return scram.Mechanism(scram.SHA256, cfg.KafkaUsername, cfg.KafkaPassword)
	case "SCRAM-SHA-512":
		return scram.Mechanism(scram.SHA512, cfg.KafkaUsername, cfg.KafkaPassword)
	default:
		return nil, fmt.Errorf("unsupported kafka SASL mechanism %q", mechanism)
	}
}

func (k *KafkaClient) Close() error {
	k.mu.Lock()
	readers := append([]*kafka.Reader(nil), k.readers...)
	k.readers = nil
	for _, state := range k.consumers {
		state.Connected = false
	}
	k.mu.Unlock()

	var closeErr error
	for _, reader := range readers {
		if err := reader.Close(); err != nil && closeErr == nil {
			closeErr = err
		}
	}
	if err := k.writer.Close(); err != nil && closeErr == nil {
		closeErr = err
	}
	k.transport.CloseIdleConnections()
	return closeErr
}

func (k *KafkaClient) EnsureTopic(ctx context.Context, topic string, partitions, replicationFactor int) error {
	dialer := kafka.Dialer{
		Timeout:       10 * time.Second,
		TLS:           k.transport.TLS,
		SASLMechanism: k.transport.SASL,
	}
	conn, err := dialer.DialContext(ctx, "tcp", k.cfg.KafkaBrokers[0])
	if err != nil {
		return err
	}
	defer conn.Close()

	err = conn.CreateTopics(kafka.TopicConfig{
		Topic:             topic,
		NumPartitions:     partitions,
		ReplicationFactor: replicationFactor,
	})
	if err != nil && !strings.Contains(strings.ToLower(err.Error()), "already exists") {
		return err
	}
	return nil
}

func (k *KafkaClient) SendJSON(ctx context.Context, topic string, key string, value any) error {
	payload, err := json.Marshal(value)
	if err != nil {
		return err
	}
	msg := kafka.Message{
		Topic: topic,
		Value: payload,
		Time:  time.Now(),
	}
	if key != "" {
		msg.Key = []byte(key)
	}
	return k.writer.WriteMessages(ctx, msg)
}

type KafkaMessageHandler func(ctx context.Context, msg kafka.Message) error

type KafkaTopicConfig struct {
	Partitions        int
	ReplicationFactor int
}

var errKafkaConsumerIdleRecreate = errors.New("kafka consumer idle recreate")

func (c KafkaTopicConfig) normalized() KafkaTopicConfig {
	if c.Partitions <= 0 {
		c.Partitions = 1
	}
	if c.ReplicationFactor <= 0 {
		c.ReplicationFactor = 2
	}
	return c
}

func (k *KafkaClient) StartConsumer(ctx context.Context, topic, groupID string, topicConfig KafkaTopicConfig, handler KafkaMessageHandler) error {
	state := k.ensureConsumerHealth(topic, groupID)
	go k.runConsumer(ctx, topic, groupID, topicConfig.normalized(), state, handler)
	return nil
}

func kafkaConsumerHealthKey(topic, groupID string) string {
	return topic + "\x00" + groupID
}

func (k *KafkaClient) ensureConsumerHealth(topic, groupID string) *kafkaConsumerHealthState {
	k.mu.Lock()
	defer k.mu.Unlock()
	key := kafkaConsumerHealthKey(topic, groupID)
	if state := k.consumers[key]; state != nil {
		return state
	}
	state := &kafkaConsumerHealthState{
		Topic:   topic,
		GroupID: groupID,
		Pending: make(map[string]time.Time),
	}
	k.consumers[key] = state
	return state
}

func (k *KafkaClient) updateConsumerHealth(state *kafkaConsumerHealthState, update func(*kafkaConsumerHealthState)) {
	if state == nil {
		return
	}
	k.mu.Lock()
	defer k.mu.Unlock()
	update(state)
}

func (k *KafkaClient) markConsumerPendingStart(state *kafkaConsumerHealthState, msg kafka.Message) {
	now := time.Now()
	k.updateConsumerHealth(state, func(state *kafkaConsumerHealthState) {
		if state.Pending == nil {
			state.Pending = make(map[string]time.Time)
		}
		state.Pending[kafkaPendingKey(msg)] = now
		state.LastMessageAt = now
		state.LastError = ""
	})
}

func (k *KafkaClient) markConsumerPendingDone(state *kafkaConsumerHealthState, msg kafka.Message, err error, committed bool) {
	now := time.Now()
	k.updateConsumerHealth(state, func(state *kafkaConsumerHealthState) {
		delete(state.Pending, kafkaPendingKey(msg))
		if err != nil {
			state.LastError = err.Error()
			return
		}
		if committed {
			state.LastCommitAt = now
		}
		state.LastProgressAt = now
		state.LastError = ""
		state.Unhealthy = false
		state.StallReason = ""
		state.ConsecutiveStallRestartCount = 0
	})
}

func kafkaPendingKey(msg kafka.Message) string {
	return fmt.Sprintf("%s:%d:%d", msg.Topic, msg.Partition, msg.Offset)
}

func kafkaPendingHealth(state *kafkaConsumerHealthState) (int, time.Duration) {
	if state == nil || len(state.Pending) == 0 {
		return 0, 0
	}

	var oldest time.Time
	for _, seenAt := range state.Pending {
		if seenAt.IsZero() {
			continue
		}
		if oldest.IsZero() || seenAt.Before(oldest) {
			oldest = seenAt
		}
	}
	if oldest.IsZero() {
		return len(state.Pending), 0
	}
	return len(state.Pending), time.Since(oldest)
}

func (k *KafkaClient) ConsumerHealthSnapshot() []map[string]any {
	k.mu.Lock()
	defer k.mu.Unlock()

	out := make([]map[string]any, 0, len(k.consumers))
	for _, state := range k.consumers {
		pendingCount, oldestPendingAge := kafkaPendingHealth(state)
		out = append(out, map[string]any{
			"topic":                           state.Topic,
			"group_id":                        state.GroupID,
			"connected":                       state.Connected,
			"unhealthy":                       state.Unhealthy,
			"stall_reason":                    state.StallReason,
			"lag":                             state.Lag,
			"high_watermark":                  nullableInt64(state.HighWatermark),
			"committed_offset":                nullableInt64(state.CommittedOffset),
			"pending_count":                   pendingCount,
			"oldest_pending_age_ms":           oldestPendingAge.Milliseconds(),
			"last_message_at":                 healthTime(state.LastMessageAt),
			"last_commit_at":                  healthTime(state.LastCommitAt),
			"last_progress_at":                healthTime(state.LastProgressAt),
			"last_restart_at":                 healthTime(state.LastRestartAt),
			"last_watchdog_at":                healthTime(state.LastWatchdogAt),
			"restart_count":                   state.RestartCount,
			"consecutive_stall_restart_count": state.ConsecutiveStallRestartCount,
			"last_error":                      state.LastError,
		})
	}
	return out
}

func (k *KafkaClient) HasUnhealthyConsumers() bool {
	k.mu.Lock()
	defer k.mu.Unlock()

	for _, state := range k.consumers {
		if state.Unhealthy {
			return true
		}
	}
	return false
}

func nullableInt64(value *int64) any {
	if value == nil {
		return nil
	}
	return *value
}

func (k *KafkaClient) newReader(topic, groupID string) *kafka.Reader {
	return kafka.NewReader(kafka.ReaderConfig{
		Brokers:        k.cfg.KafkaBrokers,
		GroupID:        groupID,
		Topic:          topic,
		MinBytes:       1,
		MaxBytes:       10e6,
		MaxWait:        50 * time.Millisecond,
		CommitInterval: 0,
		StartOffset:    kafka.FirstOffset,
		Dialer: &kafka.Dialer{
			Timeout:       10 * time.Second,
			DualStack:     true,
			SASLMechanism: k.transport.SASL,
			TLS:           k.transport.TLS,
		},
	})
}

func (k *KafkaClient) addReader(reader *kafka.Reader) {
	k.mu.Lock()
	k.readers = append(k.readers, reader)
	k.mu.Unlock()
}

func (k *KafkaClient) removeReader(reader *kafka.Reader) {
	k.mu.Lock()
	defer k.mu.Unlock()
	for index, existing := range k.readers {
		if existing == reader {
			k.readers = append(k.readers[:index], k.readers[index+1:]...)
			return
		}
	}
}

func (k *KafkaClient) runConsumer(ctx context.Context, topic, groupID string, topicConfig KafkaTopicConfig, state *kafkaConsumerHealthState, handler KafkaMessageHandler) {
	for {
		if ctx.Err() != nil {
			return
		}
		err := k.runConsumerOnce(ctx, topic, groupID, topicConfig, state, handler)
		if ctx.Err() != nil {
			return
		}
		k.updateConsumerHealth(state, func(state *kafkaConsumerHealthState) {
			state.Connected = false
			state.LastRestartAt = time.Now()
			state.RestartCount++
			state.Pending = make(map[string]time.Time)
			if err != nil {
				state.LastError = err.Error()
			}
		})
		log.Printf("kafka consumer restarting topic=%s group=%s reason=%v", topic, groupID, err)
		time.Sleep(k.consumerRestartBackoff())
	}
}

func (k *KafkaClient) runConsumerOnce(ctx context.Context, topic, groupID string, topicConfig KafkaTopicConfig, state *kafkaConsumerHealthState, handler KafkaMessageHandler) (err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			err = fmt.Errorf("kafka consumer panic topic=%s group=%s: %v", topic, groupID, recovered)
			log.Printf("%v", err)
		}
	}()

	if err := k.ensureConsumerTopic(ctx, topic, topicConfig); err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		k.updateConsumerHealth(state, func(state *kafkaConsumerHealthState) {
			state.Connected = false
			state.LastError = err.Error()
		})
		return err
	}

	reader := k.newReader(topic, groupID)
	k.addReader(reader)
	k.updateConsumerHealth(state, func(state *kafkaConsumerHealthState) {
		now := time.Now()
		state.Connected = true
		state.Pending = make(map[string]time.Time)
		state.LastError = ""
		state.LastProgressAt = now
	})
	defer func() {
		k.removeReader(reader)
		k.updateConsumerHealth(state, func(state *kafkaConsumerHealthState) {
			state.Connected = false
		})
		if closeErr := reader.Close(); closeErr != nil && ctx.Err() == nil {
			log.Printf("kafka reader close error topic=%s group=%s: %v", topic, groupID, closeErr)
		}
	}()

	consumeCtx, cancel := context.WithCancel(ctx)
	watchdogDone := make(chan struct{})
	go func() {
		defer close(watchdogDone)
		k.watchConsumer(consumeCtx, reader, topic, groupID, state, cancel)
	}()
	defer func() {
		cancel()
		<-watchdogDone
	}()

	return k.consumeReader(consumeCtx, reader, topic, groupID, state, handler)
}

func (k *KafkaClient) ensureConsumerTopic(ctx context.Context, topic string, topicConfig KafkaTopicConfig) error {
	if err := k.EnsureTopic(ctx, topic, topicConfig.Partitions, topicConfig.ReplicationFactor); err != nil {
		log.Printf("kafka consumer topic ensure failed topic=%s partitions=%d replication_factor=%d: %v", topic, topicConfig.Partitions, topicConfig.ReplicationFactor, err)
		return err
	}
	return nil
}

func (k *KafkaClient) watchConsumer(ctx context.Context, reader *kafka.Reader, topic, groupID string, state *kafkaConsumerHealthState, cancel context.CancelFunc) {
	interval := k.cfg.KafkaConsumerStallCheckInterval
	if interval <= 0 {
		interval = 30 * time.Second
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if k.consumerWatchdogStalled(reader, topic, groupID, state) {
				cancel()
				if err := reader.Close(); err != nil && ctx.Err() == nil {
					log.Printf("kafka watchdog reader close error topic=%s group=%s: %v", topic, groupID, err)
				}
				return
			}
		}
	}
}

func (k *KafkaClient) consumerWatchdogStalled(reader *kafka.Reader, topic, groupID string, state *kafkaConsumerHealthState) bool {
	timeout := k.cfg.KafkaConsumerStallTimeout
	if timeout <= 0 {
		timeout = 5 * time.Minute
	}
	maxStallRestarts := k.cfg.KafkaConsumerMaxStallRestarts
	if maxStallRestarts <= 0 {
		maxStallRestarts = 3
	}

	stats := reader.Stats()
	now := time.Now()
	var stalled bool
	var reason string

	k.mu.Lock()
	if state.Pending == nil {
		state.Pending = make(map[string]time.Time)
	}
	state.LastWatchdogAt = now
	state.Lag = stats.Lag
	if state.Lag < 0 {
		state.Lag = 0
	}
	committedOffset := stats.Offset
	highWatermark := stats.Offset + state.Lag
	state.CommittedOffset = &committedOffset
	state.HighWatermark = &highWatermark

	_, oldestPendingAge := kafkaPendingHealth(state)
	if oldestPendingAge >= timeout {
		stalled = true
		reason = "pending_offset_stall"
	} else if state.Lag > 0 && !state.LastProgressAt.IsZero() && now.Sub(state.LastProgressAt) >= timeout {
		stalled = true
		reason = "lag_no_commit_progress"
	}

	if stalled {
		state.StallReason = reason
		state.LastError = reason
		state.ConsecutiveStallRestartCount++
		if state.ConsecutiveStallRestartCount >= maxStallRestarts {
			state.Unhealthy = true
		}
	}
	k.mu.Unlock()

	if !stalled {
		return false
	}

	log.Printf("kafka consumer watchdog stalled topic=%s group=%s reason=%s lag=%d timeout=%s", topic, groupID, reason, stats.Lag, timeout)
	return true
}

func (k *KafkaClient) consumeReader(ctx context.Context, reader *kafka.Reader, topic, groupID string, state *kafkaConsumerHealthState, handler KafkaMessageHandler) error {
	return k.consumeParallelReader(ctx, reader, topic, groupID, state, handler)
}

func (k *KafkaClient) consumeParallelReader(ctx context.Context, reader *kafka.Reader, topic, groupID string, state *kafkaConsumerHealthState, handler KafkaMessageHandler) error {
	sequencer := newKeyedSequencer()
	commits := newPartitionCommitCoordinator(func(commitCtx context.Context, msg kafka.Message) error {
		return reader.CommitMessages(commitCtx, msg)
	})
	consumeCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	maxInFlight := k.consumerMaxInFlight(topic)
	inFlight := make(chan struct{}, maxInFlight)
	var wg sync.WaitGroup
	var firstErrMu sync.Mutex
	var firstErr error

	setFirstErr := func(err error) {
		if err == nil {
			return
		}
		firstErrMu.Lock()
		if firstErr == nil {
			firstErr = err
			cancel()
		}
		firstErrMu.Unlock()
	}
	getFirstErr := func() error {
		firstErrMu.Lock()
		defer firstErrMu.Unlock()
		return firstErr
	}
	waitAndReturn := func(err error) error {
		wg.Wait()
		if first := getFirstErr(); first != nil {
			return first
		}
		return err
	}

	idleRecreateInterval := k.consumerIdleRecreateInterval(topic)
	for {
		select {
		case inFlight <- struct{}{}:
		case <-consumeCtx.Done():
			return waitAndReturn(consumeCtx.Err())
		}

		currentIdleRecreateInterval := idleRecreateInterval
		if len(inFlight) > 1 {
			currentIdleRecreateInterval = 0
		}
		msg, err := k.fetchMessage(consumeCtx, reader, currentIdleRecreateInterval)
		if err != nil {
			<-inFlight
			k.updateConsumerHealth(state, func(state *kafkaConsumerHealthState) {
				state.LastError = err.Error()
			})
			if ctx.Err() != nil {
				return waitAndReturn(ctx.Err())
			}
			if first := getFirstErr(); first != nil {
				return waitAndReturn(first)
			}
			if errors.Is(err, errKafkaConsumerIdleRecreate) {
				return waitAndReturn(err)
			}
			if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
				return waitAndReturn(err)
			}
			log.Printf("kafka fetch error topic=%s group=%s: %v", topic, groupID, err)
			time.Sleep(k.fetchErrorBackoff())
			continue
		}

		k.markConsumerPendingStart(state, msg)

		queueKey := kafkaMessageQueueKey(topic, msg)
		commits.register(msg)

		var done <-chan error
		if kafkaTopicRequiresMessageOrder(topic) {
			done = sequencer.enqueue(consumeCtx, consumeCtx, queueKey, k.handlerTimeout(topic), func(taskCtx context.Context) error {
				return handler(taskCtx, msg)
			})
		} else {
			done = runKafkaQueueTask(consumeCtx, k.handlerTimeout(topic), func(taskCtx context.Context) error {
				return handler(taskCtx, msg)
			})
		}

		wg.Add(1)
		go func(msg kafka.Message, queueKey string, done <-chan error) {
			defer wg.Done()
			defer func() {
				<-inFlight
			}()

			if err := <-done; err != nil {
				if errors.Is(err, context.Canceled) && ctx.Err() != nil {
					k.markConsumerPendingDone(state, msg, err, false)
					return
				}

				k.updateConsumerHealth(state, func(state *kafkaConsumerHealthState) {
					state.LastError = err.Error()
				})
				log.Printf("kafka async handler error topic=%s partition=%d offset=%d queue_key=%s: %v", topic, msg.Partition, msg.Offset, queueKey, err)
				reason := "handler_failed"
				cause := err
				if errors.Is(err, context.DeadlineExceeded) {
					reason = "handler_timeout"
					cause = fmt.Errorf("handler timeout after %s: %w", k.handlerTimeout(topic), err)
				}

				log.Printf("kafka handler failed; discarding message and committing offset without redrive topic=%s group=%s partition=%d offset=%d queue_key=%s reason=%s error=%v", topic, groupID, msg.Partition, msg.Offset, queueKey, reason, cause)

				committed, commitErr := commits.complete(consumeCtx, msg)
				if commitErr != nil {
					k.markConsumerPendingDone(state, msg, commitErr, false)
					setFirstErr(fmt.Errorf("kafka commit failed after handler discard topic=%s partition=%d offset=%d: %w", topic, msg.Partition, msg.Offset, commitErr))
					return
				}
				k.markConsumerPendingDone(state, msg, nil, committed)
				return
			}

			committed, err := commits.complete(consumeCtx, msg)
			if err != nil {
				k.markConsumerPendingDone(state, msg, err, false)
				log.Printf("kafka commit error topic=%s partition=%d offset=%d queue_key=%s: %v", topic, msg.Partition, msg.Offset, queueKey, err)
				setFirstErr(fmt.Errorf("kafka commit failed topic=%s partition=%d offset=%d: %w", topic, msg.Partition, msg.Offset, err))
				return
			}
			if !committed {
				k.markConsumerPendingDone(state, msg, nil, false)
				return
			}

			k.markConsumerPendingDone(state, msg, nil, true)
		}(msg, queueKey, done)
	}
}

func (k *KafkaClient) fetchMessage(ctx context.Context, reader *kafka.Reader, idleRecreateInterval time.Duration) (kafka.Message, error) {
	if idleRecreateInterval <= 0 {
		return reader.FetchMessage(ctx)
	}
	fetchCtx, cancel := context.WithTimeout(ctx, idleRecreateInterval)
	defer cancel()
	msg, err := reader.FetchMessage(fetchCtx)
	if err != nil && ctx.Err() == nil && errors.Is(err, context.DeadlineExceeded) {
		return kafka.Message{}, errKafkaConsumerIdleRecreate
	}
	return msg, err
}

func (k *KafkaClient) consumerIdleRecreateInterval(topic string) time.Duration {
	if !isWorkerSendTopic(topic) {
		return 0
	}
	return k.cfg.KafkaSendConsumerIdleRecreateInterval
}

func (k *KafkaClient) consumerRestartBackoff() time.Duration {
	return k.handlerErrorBackoff()
}

func (k *KafkaClient) fetchErrorBackoff() time.Duration {
	if k.cfg.KafkaPollInterval > 0 {
		return k.cfg.KafkaPollInterval
	}
	return time.Second
}

func (k *KafkaClient) handlerErrorBackoff() time.Duration {
	if k.cfg.KafkaHandlerErrorBackoff <= 0 {
		return time.Second
	}
	return k.cfg.KafkaHandlerErrorBackoff
}

func (k *KafkaClient) sendMaxInFlight() int {
	if k.cfg.SendMaxInFlight <= 0 {
		return 256
	}
	return k.cfg.SendMaxInFlight
}

func (k *KafkaClient) consumerMaxInFlight(topic string) int {
	if isWorkerSendTopic(topic) {
		return k.sendMaxInFlight()
	}
	if k.cfg.KafkaConsumerMaxInFlight <= 0 {
		return 32
	}
	return k.cfg.KafkaConsumerMaxInFlight
}

func (k *KafkaClient) handlerTimeout(topic string) time.Duration {
	if isWorkerSendTopic(topic) {
		return k.cfg.SendQueueTimeout
	}
	return k.cfg.KafkaConsumerStallTimeout
}

func isWorkerSendTopic(topic string) bool {
	parts := strings.Split(topic, ".")
	return len(parts) == 4 && parts[0] == "worker" && parts[1] != "" && parts[2] == "send" && parts[3] == "message"
}

func topicWorkerSendMessage(workerID string) string {
	return "worker." + workerID + ".send.message"
}

func topicWorkerScheduleSend(workerID string) string {
	return "worker." + workerID + ".schedule.send.message"
}

func topicWorkerValidatePhone(workerID string) string {
	return "worker." + workerID + ".validate.phone"
}

func topicWorkerNotification(workerID string) string {
	return "worker." + workerID + ".notification.message"
}

func topicWorkerWebhook(workerID string) string {
	return "worker." + workerID + ".webhook.integration"
}

const (
	topicUpdateMessage                 = "update.message"
	topicUpsertMessage                 = "upsert.message"
	topicUpsertMessageHistory          = "upsert.message.history"
	topicUpdateMessageStatus           = "update.message.status"
	topicMarkMessageRead               = "mark.message.read"
	topicPhoneValidationResponse       = "phone.validation.response"
	topicUserPhoneJIDUpdate            = "user.phone.jid.update"
	topicScheduleStatusUpdate          = "schedule.status.update"
	topicUpdateProfileStatusExternalID = "update.profile.status.external.id"
	topicWorkerConfigUpdate            = "worker.config.update"
)
