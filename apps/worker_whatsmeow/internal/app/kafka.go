package app

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/segmentio/kafka-go"
	"github.com/segmentio/kafka-go/sasl"
	"github.com/segmentio/kafka-go/sasl/plain"
	"github.com/segmentio/kafka-go/sasl/scram"
)

// KafkaClient is the worker's output-only Kafka client. Worker commands arrive
// exclusively through JetStream; this client must never create Kafka readers.
type KafkaClient struct {
	transport *kafka.Transport
	writer    *kafka.Writer
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

	return &KafkaClient{transport: transport, writer: writer}, nil
}

func buildKafkaTransport(cfg Config) (*kafka.Transport, error) {
	tlsConfig, mechanism, err := buildKafkaSecurity(
		cfg.KafkaProtocol,
		cfg.KafkaUsername,
		cfg.KafkaPassword,
		cfg.KafkaSASLMechanism,
		cfg.KafkaAllowPlaintext,
	)
	if err != nil {
		return nil, err
	}
	return &kafka.Transport{TLS: tlsConfig, SASL: mechanism}, nil
}

func kafkaProtocolUsesPlaintext(protocol string) bool {
	normalizedProtocol := strings.ToLower(strings.TrimSpace(protocol))
	return normalizedProtocol == "plaintext" || normalizedProtocol == "sasl_plaintext"
}

func buildKafkaSecurity(
	protocol,
	username,
	password,
	saslMechanism string,
	allowPlaintext bool,
) (*tls.Config, sasl.Mechanism, error) {
	normalizedProtocol := strings.ToLower(strings.TrimSpace(protocol))
	usesTLS := false
	usesSASL := false
	switch normalizedProtocol {
	case "plaintext":
	case "ssl":
		usesTLS = true
	case "sasl_plaintext":
		usesSASL = true
	case "sasl_ssl":
		usesTLS = true
		usesSASL = true
	default:
		return nil, nil, fmt.Errorf("unsupported kafka security protocol %q", protocol)
	}
	if !usesTLS && !allowPlaintext {
		return nil, nil, errors.New("kafka plaintext transport requires KAFKA_ALLOW_PLAINTEXT=true")
	}

	var tlsConfig *tls.Config
	if usesTLS {
		tlsConfig = &tls.Config{MinVersion: tls.VersionTLS12}
	}
	if !usesSASL {
		if strings.TrimSpace(username) != "" || password != "" || strings.TrimSpace(saslMechanism) != "" {
			return nil, nil, fmt.Errorf("kafka protocol %q must not include SASL credentials or mechanism", normalizedProtocol)
		}
		return tlsConfig, nil, nil
	}
	if strings.TrimSpace(username) == "" || password == "" {
		return nil, nil, errors.New("kafka SASL requires complete credentials")
	}

	mechanism := strings.ToUpper(strings.TrimSpace(saslMechanism))
	switch mechanism {
	case "PLAIN":
		return tlsConfig, plain.Mechanism{Username: username, Password: password}, nil
	case "SCRAM-SHA-256":
		value, err := scram.Mechanism(scram.SHA256, username, password)
		return tlsConfig, value, err
	case "SCRAM-SHA-512":
		value, err := scram.Mechanism(scram.SHA512, username, password)
		return tlsConfig, value, err
	default:
		return nil, nil, fmt.Errorf("unsupported kafka SASL mechanism %q", mechanism)
	}
}

func (k *KafkaClient) Close() error {
	closeErr := k.writer.Close()
	k.transport.CloseIdleConnections()
	return closeErr
}

func (k *KafkaClient) SendJSON(ctx context.Context, topic string, key string, value any) error {
	payload, err := json.Marshal(value)
	if err != nil {
		return err
	}
	msg := kafka.Message{Topic: topic, Value: payload, Time: time.Now()}
	if key != "" {
		msg.Key = []byte(key)
	}
	return k.writer.WriteMessages(ctx, msg)
}

// KafkaMessageHandler is retained as the internal payload adapter signature.
// JetStream constructs a synthetic kafka.Message so the mature handlers can
// be reused without operating a Kafka command consumer.
type KafkaMessageHandler func(ctx context.Context, msg kafka.Message) error

type KafkaConsumerLifecycleEvent struct {
	Topic        string
	GroupID      string
	GenerationID int32
	Ready        bool
	Reason       string
}

type KafkaConsumerLifecycleObserver func(KafkaConsumerLifecycleEvent)

type KafkaConsumerHandle struct {
	Ready     <-chan struct{}
	Lifecycle <-chan KafkaConsumerLifecycleEvent
	Done      <-chan struct{}
}

type kafkaRestartWithoutCommitError struct{ cause error }

func (e *kafkaRestartWithoutCommitError) Error() string { return e.cause.Error() }
func (e *kafkaRestartWithoutCommitError) Unwrap() error { return e.cause }

func restartKafkaGenerationWithoutCommit(cause error) error {
	return &kafkaRestartWithoutCommitError{cause: cause}
}

func shouldRestartKafkaGenerationWithoutCommit(err error) bool {
	var restartErr *kafkaRestartWithoutCommitError
	return errors.As(err, &restartErr)
}

type kafkaTerminalHandlerError struct{ cause error }

func (e *kafkaTerminalHandlerError) Error() string { return e.cause.Error() }
func (e *kafkaTerminalHandlerError) Unwrap() error { return e.cause }

func terminalKafkaHandlerError(cause error) error {
	if cause == nil {
		cause = errors.New("terminal Kafka handler outcome")
	}
	return &kafkaTerminalHandlerError{cause: cause}
}

func shouldCommitTerminalKafkaHandlerError(err error) bool {
	var terminalErr *kafkaTerminalHandlerError
	return errors.As(err, &terminalErr)
}

func emitKafkaConsumerLifecycle(
	ctx context.Context,
	lifecycle chan KafkaConsumerLifecycleEvent,
	observer KafkaConsumerLifecycleObserver,
	event KafkaConsumerLifecycleEvent,
) {
	if observer != nil {
		observer(event)
	}
	select {
	case <-ctx.Done():
		return
	default:
	}
	select {
	case lifecycle <- event:
		return
	default:
	}
	select {
	case <-lifecycle:
	default:
	}
	select {
	case lifecycle <- event:
	default:
	}
}

func kafkaConsumerHealthKey(topic, groupID string) string {
	return topic + "\x00" + groupID
}

func (k *KafkaClient) clearDispatchAuthorizationHolds() {}

// These topic names are synthetic DTO metadata only. They are never passed to
// a Kafka reader or writer; handlers use them to preserve existing logging,
// idempotency and queue-key semantics while commands arrive from JetStream.
func topicWorkerSendMessage(workerID string) string {
	return "worker." + workerID + ".send.message"
}

func topicWorkerScheduleSend(workerID string) string {
	return "worker." + workerID + ".schedule.send.message"
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
