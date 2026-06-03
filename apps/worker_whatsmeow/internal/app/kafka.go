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
	mu        sync.Mutex
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

func (k *KafkaClient) StartConsumer(ctx context.Context, topic, groupID string, handler KafkaMessageHandler) error {
	reader := kafka.NewReader(kafka.ReaderConfig{
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

	k.mu.Lock()
	k.readers = append(k.readers, reader)
	k.mu.Unlock()

	go func() {
		defer reader.Close()
		for {
			msg, err := reader.FetchMessage(ctx)
			if err != nil {
				if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
					return
				}
				log.Printf("kafka fetch error topic=%s group=%s: %v", topic, groupID, err)
				time.Sleep(time.Second)
				continue
			}

			carrier := propagation.MapCarrier{}
			for _, header := range msg.Headers {
				carrier.Set(header.Key, string(header.Value))
			}
			messageCtx := otel.GetTextMapPropagator().Extract(ctx, carrier)

			if err := handler(messageCtx, msg); err != nil {
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
				}
				continue
			}

			if err := reader.CommitMessages(ctx, msg); err != nil {
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
				}
			} else if isWorkerSendTopic(topic) {
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
	}()

	return nil
}

func isWorkerSendTopic(topic string) bool {
	return strings.HasSuffix(topic, ".send.message")
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
