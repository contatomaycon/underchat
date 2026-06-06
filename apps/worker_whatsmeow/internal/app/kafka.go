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
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
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
	Topic         string
	GroupID       string
	Connected     bool
	LastMessageAt time.Time
	LastCommitAt  time.Time
	LastRestartAt time.Time
	RestartCount  int
	LastError     string
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
	carrier := propagation.MapCarrier{}
	otel.GetTextMapPropagator().Inject(ctx, carrier)
	headers := make([]kafka.Header, 0, len(carrier))
	for headerKey, headerValue := range carrier {
		if headerValue == "" {
			continue
		}
		headers = append(headers, kafka.Header{
			Key:   headerKey,
			Value: []byte(headerValue),
		})
	}
	msg := kafka.Message{
		Topic:   topic,
		Value:   payload,
		Time:    time.Now(),
		Headers: headers,
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
	state := &kafkaConsumerHealthState{Topic: topic, GroupID: groupID}
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

func (k *KafkaClient) ConsumerHealthSnapshot() []map[string]any {
	k.mu.Lock()
	defer k.mu.Unlock()

	out := make([]map[string]any, 0, len(k.consumers))
	for _, state := range k.consumers {
		out = append(out, map[string]any{
			"topic":           state.Topic,
			"group_id":        state.GroupID,
			"connected":       state.Connected,
			"last_message_at": healthTime(state.LastMessageAt),
			"last_commit_at":  healthTime(state.LastCommitAt),
			"last_restart_at": healthTime(state.LastRestartAt),
			"restart_count":   state.RestartCount,
			"last_error":      state.LastError,
		})
	}
	return out
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
			recordMessageLifecycle(ctx, k.cfg, map[string]any{
				"stage":      "whatsmeow.outgoing.kafka.consumer.panic",
				"decision":   "recover_consumer",
				"outcome":    "retrying",
				"reason":     "panic",
				"level":      "error",
				"topic":      topic,
				"group_id":   groupID,
				"error":      fmt.Sprint(recovered),
				"worker_id":  k.cfg.WorkerID,
				"account_id": k.cfg.AccountID,
			})
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
		state.Connected = true
		state.LastError = ""
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

	return k.consumeReader(ctx, reader, topic, groupID, state, handler)
}

func (k *KafkaClient) ensureConsumerTopic(ctx context.Context, topic string, topicConfig KafkaTopicConfig) error {
	if err := k.EnsureTopic(ctx, topic, topicConfig.Partitions, topicConfig.ReplicationFactor); err != nil {
		log.Printf("kafka consumer topic ensure failed topic=%s partitions=%d replication_factor=%d: %v", topic, topicConfig.Partitions, topicConfig.ReplicationFactor, err)
		recordMessageLifecycle(ctx, k.cfg, map[string]any{
			"stage":              "whatsmeow.outgoing.kafka.topic.ensure.error",
			"decision":           "ensure_topic",
			"outcome":            "error",
			"reason":             "topic_ensure_failed",
			"level":              "error",
			"topic":              topic,
			"partitions":         topicConfig.Partitions,
			"replication_factor": topicConfig.ReplicationFactor,
			"error":              err.Error(),
			"worker_id":          k.cfg.WorkerID,
			"account_id":         k.cfg.AccountID,
		})
		return err
	}
	return nil
}

func (k *KafkaClient) consumeReader(ctx context.Context, reader *kafka.Reader, topic, groupID string, state *kafkaConsumerHealthState, handler KafkaMessageHandler) error {
	idleRecreateInterval := k.consumerIdleRecreateInterval(topic)
	for {
		msg, err := k.fetchMessage(ctx, reader, idleRecreateInterval)
		if err != nil {
			k.updateConsumerHealth(state, func(state *kafkaConsumerHealthState) {
				state.LastError = err.Error()
			})
			if ctx.Err() != nil {
				return ctx.Err()
			}
			if errors.Is(err, errKafkaConsumerIdleRecreate) {
				recordMessageLifecycle(ctx, k.cfg, map[string]any{
					"stage":       "whatsmeow.outgoing.kafka.consumer.recreate",
					"decision":    "recreate_consumer",
					"outcome":     "retrying",
					"reason":      "fetch_idle_timeout",
					"level":       "warn",
					"topic":       topic,
					"group_id":    groupID,
					"idle_ms":     idleRecreateInterval.Milliseconds(),
					"worker_id":   k.cfg.WorkerID,
					"account_id":  k.cfg.AccountID,
					"worker_type": "whatsmeow",
				})
				return err
			}
			if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
				return err
			}
			log.Printf("kafka fetch error topic=%s group=%s: %v", topic, groupID, err)
			time.Sleep(k.fetchErrorBackoff())
			continue
		}
		k.updateConsumerHealth(state, func(state *kafkaConsumerHealthState) {
			state.LastMessageAt = time.Now()
			state.LastError = ""
		})

		carrier := propagation.MapCarrier{}
		for _, header := range msg.Headers {
			carrier.Set(header.Key, string(header.Value))
		}
		messageCtx := otel.GetTextMapPropagator().Extract(ctx, carrier)

		if err := handler(messageCtx, msg); err != nil {
			k.updateConsumerHealth(state, func(state *kafkaConsumerHealthState) {
				state.LastError = err.Error()
			})
			log.Printf("kafka handler error topic=%s partition=%d offset=%d: %v", topic, msg.Partition, msg.Offset, err)
			if isWorkerSendTopic(topic) {
				recordMessageLifecycle(messageCtx, k.cfg, map[string]any{
					"stage":     "whatsmeow.outgoing.kafka.commit.skipped",
					"decision":  "commit_message",
					"outcome":   "error",
					"reason":    "handler_failed",
					"level":     "error",
					"topic":     topic,
					"partition": msg.Partition,
					"offset":    msg.Offset,
					"error":     err.Error(),
				})
				return fmt.Errorf("kafka handler failed topic=%s partition=%d offset=%d: %w", topic, msg.Partition, msg.Offset, err)
			}
			time.Sleep(k.handlerErrorBackoff())
			continue
		}

		if err := reader.CommitMessages(ctx, msg); err != nil {
			k.updateConsumerHealth(state, func(state *kafkaConsumerHealthState) {
				state.LastError = err.Error()
			})
			log.Printf("kafka commit error topic=%s partition=%d offset=%d: %v", topic, msg.Partition, msg.Offset, err)
			if isWorkerSendTopic(topic) {
				recordMessageLifecycle(messageCtx, k.cfg, map[string]any{
					"stage":     "whatsmeow.outgoing.kafka.commit.error",
					"decision":  "commit_message",
					"outcome":   "error",
					"reason":    "commit_failed",
					"level":     "error",
					"topic":     topic,
					"partition": msg.Partition,
					"offset":    msg.Offset,
					"error":     err.Error(),
				})
				return fmt.Errorf("kafka commit failed topic=%s partition=%d offset=%d: %w", topic, msg.Partition, msg.Offset, err)
			}
		} else {
			k.updateConsumerHealth(state, func(state *kafkaConsumerHealthState) {
				state.LastCommitAt = time.Now()
				state.LastError = ""
			})
		}
		if isWorkerSendTopic(topic) {
			recordMessageLifecycle(messageCtx, k.cfg, map[string]any{
				"stage":     "whatsmeow.outgoing.kafka.commit.success",
				"decision":  "commit_message",
				"outcome":   "success",
				"topic":     topic,
				"partition": msg.Partition,
				"offset":    msg.Offset,
			})
		}
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

func isWorkerSendTopic(topic string) bool {
	parts := strings.Split(topic, ".")
	return len(parts) == 4 && parts[0] == "worker" && parts[1] != "" && parts[2] == "send" && parts[3] == "message"
}

func topicWorkerSendMessage(workerID string) string {
	return "worker." + workerID + ".send.message"
}

func topicWorkerSendMessageDLQ(workerID string) string {
	return "worker." + workerID + ".send.message.dlq"
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

func topicWorkerConnectionQRCode(workerID string) string {
	return "worker." + workerID + ".connection.qrcode"
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
