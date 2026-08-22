package app

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/segmentio/kafka-go"
)

const (
	workerCommandSchemaVersion = 1

	workerCommandStreamName         = "UC_WORKER_COMMANDS_V1"
	workerCommandFailuresStreamName = "UC_WORKER_FAILURES_V1"
	workerCommandDeferredStreamName = "UC_WORKER_DEFERRED_V1"
	workerCommandEpochBucketName    = "UC_WORKER_EPOCH_V1"

	workerCommandSubjectPrefix          = "uc.worker.command."
	workerFailureSubjectPrefix          = "uc.worker.failure."
	workerDeferredScheduleSubjectPrefix = "uc.worker.deferred.schedule."
	workerDeferredReadySubjectPrefix    = "uc.worker.deferred.ready."
	workerDeferredScheduleSubjectFilter = "uc.worker.deferred.schedule.>"
	workerDeferredReadySubjectFilter    = "uc.worker.deferred.ready.*"
	workerDeferredRelayDurableName      = "uc_worker_deferred_relay_v1"

	workerCommandHeaderCommandID   = "uc-command-id"
	workerCommandHeaderOperationID = "uc-operation-id"
	workerCommandMaxBytes          = 64 * 1024
	workerCommandTimestampLayout   = "2006-01-02T15:04:05.000Z"
)

const (
	WorkerCommandTypeDirectSend         = "direct_send"
	WorkerCommandTypeScheduleSend       = "schedule_send"
	WorkerCommandTypeNotificationSend   = "notification_send"
	WorkerCommandTypeMarkRead           = "mark_read"
	WorkerCommandTypeWorkerConfig       = "worker_config"
	WorkerCommandTypeProviderCommand    = "provider_command"
	WorkerCommandTypeWebhookIntegration = "webhook_integration"
)

const (
	workerCommandMaxAge                  = 5 * time.Minute
	workerCommandDeadline                = 5 * time.Minute
	workerCommandPublicRetryDelay        = 2 * time.Minute
	workerCommandNATSDuplicateWindow     = 5 * time.Minute
	workerCommandReservedTTL             = 30 * time.Minute
	workerCommandMaximumReservationLease = 10 * time.Minute
	workerCommandProviderInvokedTTL      = time.Hour
	workerCommandProviderWatchdog        = 5 * time.Minute
	workerCommandSucceededTTL            = 12 * time.Hour
	workerCommandFailedTTL               = 2 * time.Hour
	workerCommandExpiredTTL              = 2 * time.Hour
	workerCommandAmbiguousTTL            = 24 * time.Hour
	workerCommandLaneTTL                 = 15 * time.Minute
	workerCommandRecoveryTTL             = 24 * time.Hour
	workerCommandScheduleOperationalTTL  = 24 * time.Hour
)

var (
	workerCommandIdentifierPattern  = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$`)
	workerCommandWorkerIDPattern    = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)
	workerCommandDigestPattern      = regexp.MustCompile(`^[0-9a-f]{64}$`)
	workerCommandTraceparentPattern = regexp.MustCompile(`^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$`)
)

var workerCommandTypes = map[string]struct{}{
	WorkerCommandTypeDirectSend:         {},
	WorkerCommandTypeScheduleSend:       {},
	WorkerCommandTypeNotificationSend:   {},
	WorkerCommandTypeMarkRead:           {},
	WorkerCommandTypeWorkerConfig:       {},
	WorkerCommandTypeProviderCommand:    {},
	WorkerCommandTypeWebhookIntegration: {},
}

var workerCommandEnvelopeFields = map[string]struct{}{
	"schema_version":           {},
	"command_id":               {},
	"operation_id":             {},
	"retry_of":                 {},
	"account_id":               {},
	"worker_id":                {},
	"command_type":             {},
	"entity_key":               {},
	"entity_sequence":          {},
	"predecessor_operation_id": {},
	"origin_epoch":             {},
	"issued_at":                {},
	"deadline_at":              {},
	"payload_version":          {},
	"payload_digest":           {},
	"payload":                  {},
	"traceparent":              {},
	"source":                   {},
}

// WorkerCommandEnvelopeV1 is the immutable, cross-language command contract.
// Timestamps intentionally remain strings: validation must reject values which
// are parseable only through a more permissive representation.
type WorkerCommandEnvelopeV1 struct {
	SchemaVersion          int             `json:"schema_version"`
	CommandID              string          `json:"command_id"`
	OperationID            string          `json:"operation_id"`
	RetryOf                *string         `json:"retry_of"`
	AccountID              string          `json:"account_id"`
	WorkerID               string          `json:"worker_id"`
	CommandType            string          `json:"command_type"`
	EntityKey              string          `json:"entity_key"`
	EntitySequence         uint64          `json:"entity_sequence"`
	PredecessorOperationID *string         `json:"predecessor_operation_id"`
	OriginEpoch            string          `json:"origin_epoch"`
	IssuedAt               string          `json:"issued_at"`
	DeadlineAt             string          `json:"deadline_at"`
	PayloadVersion         int             `json:"payload_version"`
	PayloadDigest          string          `json:"payload_digest"`
	Payload                json.RawMessage `json:"payload"`
	Traceparent            *string         `json:"traceparent"`
	Source                 string          `json:"source"`
}

func workerCommandSubject(workerID string) string {
	return workerCommandSubjectPrefix + strings.TrimSpace(workerID)
}

func workerCommandFailureSubject(workerID string) string {
	return workerFailureSubjectPrefix + strings.TrimSpace(workerID)
}

func DecodeWorkerCommandEnvelopeV1(raw []byte) (WorkerCommandEnvelopeV1, error) {
	if len(raw) == 0 || len(raw) > workerCommandMaxBytes {
		return WorkerCommandEnvelopeV1{}, fmt.Errorf("command envelope size must be between 1 and %d bytes", workerCommandMaxBytes)
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return WorkerCommandEnvelopeV1{}, fmt.Errorf("decode command envelope object: %w", err)
	}
	if len(fields) != len(workerCommandEnvelopeFields) {
		return WorkerCommandEnvelopeV1{}, fmt.Errorf("command envelope must contain exactly %d fields", len(workerCommandEnvelopeFields))
	}
	for name := range fields {
		if _, allowed := workerCommandEnvelopeFields[name]; !allowed {
			return WorkerCommandEnvelopeV1{}, fmt.Errorf("unknown command envelope field %q", name)
		}
	}
	for name := range workerCommandEnvelopeFields {
		if _, present := fields[name]; !present {
			return WorkerCommandEnvelopeV1{}, fmt.Errorf("missing command envelope field %q", name)
		}
	}

	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var envelope WorkerCommandEnvelopeV1
	if err := decoder.Decode(&envelope); err != nil {
		return WorkerCommandEnvelopeV1{}, fmt.Errorf("decode command envelope: %w", err)
	}
	if err := envelope.Validate(); err != nil {
		return WorkerCommandEnvelopeV1{}, err
	}
	return envelope, nil
}

func (envelope WorkerCommandEnvelopeV1) Validate() error {
	if envelope.SchemaVersion != workerCommandSchemaVersion {
		return fmt.Errorf("schema_version must be %d", workerCommandSchemaVersion)
	}
	if err := validateWorkerCommandIdentifier("command_id", envelope.CommandID); err != nil {
		return err
	}
	if err := validateWorkerCommandIdentifier("operation_id", envelope.OperationID); err != nil {
		return err
	}
	if envelope.RetryOf != nil {
		if err := validateWorkerCommandIdentifier("retry_of", *envelope.RetryOf); err != nil {
			return err
		}
	}
	if err := validateWorkerCommandIdentifier("account_id", envelope.AccountID); err != nil {
		return err
	}
	if err := validateWorkerCommandIdentifier("worker_id", envelope.WorkerID); err != nil {
		return err
	}
	if !workerCommandWorkerIDPattern.MatchString(envelope.WorkerID) {
		return errors.New("worker_id must be a canonical NATS subject token")
	}
	if _, allowed := workerCommandTypes[envelope.CommandType]; !allowed {
		return fmt.Errorf("unsupported command_type %q", envelope.CommandType)
	}
	if err := validateCanonicalWorkerCommandEntityKey(envelope.EntityKey); err != nil {
		return err
	}
	if envelope.EntitySequence == 0 {
		return errors.New("entity_sequence must be greater than zero")
	}
	if envelope.PredecessorOperationID != nil {
		if err := validateWorkerCommandIdentifier("predecessor_operation_id", *envelope.PredecessorOperationID); err != nil {
			return err
		}
	}
	if err := validateOpaqueWorkerCommandEpoch(envelope.OriginEpoch); err != nil {
		return err
	}
	issuedAt, err := parseCanonicalWorkerCommandTimestamp(envelope.IssuedAt)
	if err != nil {
		return fmt.Errorf("issued_at must be RFC3339: %w", err)
	}
	deadlineAt, err := parseCanonicalWorkerCommandTimestamp(envelope.DeadlineAt)
	if err != nil {
		return fmt.Errorf("deadline_at must be RFC3339: %w", err)
	}
	if !deadlineAt.After(issuedAt) {
		return errors.New("deadline_at must be strictly after issued_at")
	}
	if deadlineAt.Sub(issuedAt) > workerCommandDeadline {
		return fmt.Errorf("deadline_at must be at most %s after issued_at", workerCommandDeadline)
	}
	if envelope.PayloadVersion <= 0 {
		return errors.New("payload_version must be greater than zero")
	}
	if !workerCommandDigestPattern.MatchString(envelope.PayloadDigest) {
		return errors.New("payload_digest must be a lowercase SHA-256 hex digest")
	}
	if len(envelope.Payload) == 0 || !json.Valid(envelope.Payload) {
		return errors.New("payload must be valid JSON")
	}
	payload := bytes.TrimSpace(envelope.Payload)
	if len(payload) == 0 || payload[0] != '{' {
		return errors.New("payload must be a JSON object")
	}
	digest := sha256.Sum256(envelope.Payload)
	if hex.EncodeToString(digest[:]) != envelope.PayloadDigest {
		return errors.New("payload_digest does not match payload bytes")
	}
	if envelope.Traceparent != nil && !workerCommandTraceparentPattern.MatchString(*envelope.Traceparent) {
		return errors.New("traceparent is invalid")
	}
	if err := validateWorkerCommandIdentifier("source", envelope.Source); err != nil {
		return err
	}
	return nil
}

func validateOpaqueWorkerCommandEpoch(value string) error {
	if value == "" || value != strings.TrimSpace(value) || len(value) > 512 {
		return errors.New("origin_epoch must be a canonical opaque string of at most 512 bytes")
	}
	for _, character := range value {
		if character < 0x20 || character == 0x7f {
			return errors.New("origin_epoch must not contain control characters")
		}
	}
	return nil
}

func parseCanonicalWorkerCommandTimestamp(value string) (time.Time, error) {
	parsed, err := time.Parse(workerCommandTimestampLayout, value)
	if err != nil {
		return time.Time{}, err
	}
	if parsed.Format(workerCommandTimestampLayout) != value {
		return time.Time{}, errors.New("timestamp must match JavaScript Date.toISOString")
	}
	return parsed, nil
}

func workerCommandTimestamp(value time.Time) string {
	return value.UTC().Format(workerCommandTimestampLayout)
}

func (envelope WorkerCommandEnvelopeV1) issuedTime() time.Time {
	issuedAt, _ := parseCanonicalWorkerCommandTimestamp(envelope.IssuedAt)
	return issuedAt
}

func (envelope WorkerCommandEnvelopeV1) deadlineTime() time.Time {
	deadlineAt, _ := parseCanonicalWorkerCommandTimestamp(envelope.DeadlineAt)
	return deadlineAt
}

func (envelope WorkerCommandEnvelopeV1) ValidateTarget(accountID, workerID string) error {
	if envelope.AccountID != strings.TrimSpace(accountID) {
		return fmt.Errorf("command account_id %q does not target runtime account", envelope.AccountID)
	}
	if envelope.WorkerID != strings.TrimSpace(workerID) {
		return fmt.Errorf("command worker_id %q does not target runtime worker", envelope.WorkerID)
	}
	return nil
}

func (envelope WorkerCommandEnvelopeV1) ValidateFresh(now time.Time) error {
	issuedAt := envelope.issuedTime()
	deadlineAt := envelope.deadlineTime()
	if !now.Before(deadlineAt) {
		return errors.New("command deadline expired")
	}
	if now.Sub(issuedAt) > workerCommandMaxAge {
		return errors.New("command exceeded maximum age")
	}
	if issuedAt.After(now.Add(30 * time.Second)) {
		return errors.New("command issued_at is too far in the future")
	}
	return nil
}

func validateWorkerCommandIdentifier(field, value string) error {
	if value != strings.TrimSpace(value) || !workerCommandIdentifierPattern.MatchString(value) {
		return fmt.Errorf("%s is invalid", field)
	}
	return nil
}

func validateCanonicalWorkerCommandEntityKey(value string) error {
	if value != strings.TrimSpace(value) || len(value) > 512 || strings.ContainsAny(value, "\r\n\t ") {
		return errors.New("entity_key is not canonical")
	}
	separator := strings.IndexByte(value, ':')
	if separator <= 0 || separator == len(value)-1 {
		return errors.New("entity_key must contain a canonical kind prefix")
	}
	kind := value[:separator]
	if kind != strings.ToLower(kind) || !workerCommandIdentifierPattern.MatchString(kind) {
		return errors.New("entity_key kind is not canonical")
	}
	return nil
}

func workerCommandKafkaMessage(envelope WorkerCommandEnvelopeV1) (kafka.Message, error) {
	var topic string
	switch envelope.CommandType {
	case WorkerCommandTypeDirectSend, WorkerCommandTypeProviderCommand:
		topic = topicWorkerSendMessage(envelope.WorkerID)
	case WorkerCommandTypeScheduleSend:
		topic = topicWorkerScheduleSend(envelope.WorkerID)
	case WorkerCommandTypeNotificationSend:
		topic = topicWorkerNotification(envelope.WorkerID)
	case WorkerCommandTypeWebhookIntegration:
		topic = topicWorkerWebhook(envelope.WorkerID)
	case WorkerCommandTypeMarkRead:
		topic = topicMarkMessageRead
	case WorkerCommandTypeWorkerConfig:
		topic = topicWorkerConfigUpdate
	default:
		return kafka.Message{}, fmt.Errorf("unsupported command_type %q", envelope.CommandType)
	}
	digest := sha256.Sum256([]byte(envelope.CommandID))
	message := kafka.Message{
		Topic: topic,
		Key:   []byte(envelope.EntityKey),
		Value: append([]byte(nil), envelope.Payload...),
		Time:  envelope.issuedTime(),
		Headers: []kafka.Header{
			{Key: workerCommandHeaderCommandID, Value: []byte(envelope.CommandID)},
			{Key: workerCommandHeaderOperationID, Value: []byte(envelope.OperationID)},
		},
	}
	for _, value := range digest[:8] {
		message.Offset = message.Offset<<8 | int64(value)
	}
	return message, nil
}

func (w *Worker) validateWorkerCommandPayload(envelope WorkerCommandEnvelopeV1, _ kafka.Message) error {
	requireTarget := func(accountID, workerID string) error {
		if strings.TrimSpace(accountID) != envelope.AccountID {
			return errors.New("payload account target does not match envelope")
		}
		if strings.TrimSpace(workerID) != envelope.WorkerID {
			return errors.New("payload worker target does not match envelope")
		}
		return nil
	}

	switch envelope.CommandType {
	case WorkerCommandTypeDirectSend:
		data, err := mapToChatMessage(envelope.Payload)
		if err != nil {
			return fmt.Errorf("decode direct_send payload: %w", err)
		}
		if err := requireTarget(stringValue(data.Account["id"]), stringValue(data.Worker["id"])); err != nil {
			return err
		}
		if strings.TrimSpace(data.MessageID) == "" {
			return errors.New("direct_send payload requires message_id")
		}
		if err := validateWorkerCommandChatEntityKey(envelope, workerCommandChatIdentity(data)); err != nil {
			return err
		}
	case WorkerCommandTypeScheduleSend:
		var data ScheduleMessage
		if err := json.Unmarshal(envelope.Payload, &data); err != nil {
			return fmt.Errorf("decode schedule_send payload: %w", err)
		}
		if err := requireTarget(data.AccountID, stringValue(data.Message.Worker["id"])); err != nil {
			return err
		}
		if strings.TrimSpace(stringValue(data.Message.Account["id"])) != envelope.AccountID {
			return errors.New("scheduled message account target does not match envelope")
		}
		if strings.TrimSpace(data.ScheduleID) == "" || strings.TrimSpace(data.Message.MessageID) == "" {
			return errors.New("schedule_send payload requires schedule_id and message_id")
		}
		if err := validateWorkerCommandChatEntityKey(envelope, workerCommandChatIdentity(data.Message)); err != nil {
			return err
		}
	case WorkerCommandTypeNotificationSend:
		var data NotificationMessage
		if err := json.Unmarshal(envelope.Payload, &data); err != nil {
			return fmt.Errorf("decode notification_send payload: %w", err)
		}
		if err := requireTarget(stringValue(data.Account["id"]), stringValue(data.Worker["id"])); err != nil {
			return err
		}
		destination := strings.TrimSpace(data.MessageKey.RemoteJID)
		if destination == "" {
			destination = strings.Join([]string{
				"phone",
				strings.TrimSpace(data.MessageKey.PhoneDDI),
				strings.TrimSpace(data.MessageKey.PhoneNumber),
			}, ":")
		}
		if err := validateWorkerCommandChatEntityKey(envelope, destination); err != nil {
			return err
		}
	case WorkerCommandTypeMarkRead:
		var data MarkReadRequest
		if err := json.Unmarshal(envelope.Payload, &data); err != nil {
			return fmt.Errorf("decode mark_read payload: %w", err)
		}
		if err := requireTarget(data.AccountID, data.WorkerID); err != nil {
			return err
		}
		if len(data.Keys) == 0 {
			return errors.New("mark_read payload requires at least one message key")
		}
		remote := strings.TrimSpace(data.Keys[0].Remote())
		for _, key := range data.Keys[1:] {
			if strings.TrimSpace(key.Remote()) != remote {
				return errors.New("mark_read command may target only one chat lane")
			}
		}
		if err := validateWorkerCommandChatEntityKey(envelope, remote); err != nil {
			return err
		}
	case WorkerCommandTypeWorkerConfig:
		var data WorkerConfigUpdateEvent
		if err := json.Unmarshal(envelope.Payload, &data); err != nil {
			return fmt.Errorf("decode worker_config payload: %w", err)
		}
		if strings.TrimSpace(data.WorkerID) != envelope.WorkerID {
			return errors.New("worker_config payload target does not match envelope")
		}
		if envelope.EntityKey != strings.Join([]string{"control", envelope.AccountID, envelope.WorkerID, "config"}, ":") {
			return errors.New("worker_config entity_key is not canonical")
		}
	case WorkerCommandTypeProviderCommand, WorkerCommandTypeWebhookIntegration:
		var data map[string]any
		if err := json.Unmarshal(envelope.Payload, &data); err != nil {
			return fmt.Errorf("decode %s payload: %w", envelope.CommandType, err)
		}
		if err := requireTarget(stringValue(data["account_id"]), stringValue(data["worker_id"])); err != nil {
			return err
		}
		if !strings.HasPrefix(envelope.EntityKey, strings.Join([]string{"control", envelope.AccountID, envelope.WorkerID}, ":")+":") &&
			envelope.CommandType == WorkerCommandTypeProviderCommand {
			return errors.New("provider_command entity_key is not canonical")
		}
	}
	return nil
}

func validateWorkerCommandChatEntityKey(envelope WorkerCommandEnvelopeV1, remoteJIDOrChatID string) error {
	remoteJIDOrChatID = strings.TrimSpace(remoteJIDOrChatID)
	if remoteJIDOrChatID == "" {
		return errors.New("chat command canonical remote identity is missing")
	}
	expected := strings.Join([]string{
		"chat",
		envelope.AccountID,
		envelope.WorkerID,
		remoteJIDOrChatID,
	}, ":")
	if envelope.EntityKey != expected {
		return fmt.Errorf("entity_key is not canonical for payload: got %q want %q", envelope.EntityKey, expected)
	}
	return nil
}

func workerCommandChatIdentity(data ChatMessage) string {
	if data.MessageKey != nil {
		if remote := strings.TrimSpace(data.MessageKey.Remote()); remote != "" {
			return remote
		}
	}
	return strings.TrimSpace(data.ChatID)
}

type workerCommandEpochVerifier func(context.Context, WorkerCommandEnvelopeV1) error

type workerCommandEpochContext struct {
	envelope WorkerCommandEnvelopeV1
	verify   workerCommandEpochVerifier
}

type workerCommandEpochContextKey struct{}

func withWorkerCommandEpochVerification(ctx context.Context, envelope WorkerCommandEnvelopeV1, verify workerCommandEpochVerifier) context.Context {
	return context.WithValue(ctx, workerCommandEpochContextKey{}, workerCommandEpochContext{envelope: envelope, verify: verify})
}

func verifyWorkerCommandEpochFromContext(ctx context.Context) error {
	if ctx == nil {
		return errors.New("worker command epoch context is missing")
	}
	verification, ok := ctx.Value(workerCommandEpochContextKey{}).(workerCommandEpochContext)
	if !ok || verification.verify == nil {
		return errors.New("worker command epoch verification is missing")
	}
	return verification.verify(ctx, verification.envelope)
}

func workerCommandLaneRecoveryReferenceFromContext(ctx context.Context) *workerCommandLaneRecoveryReference {
	if ctx == nil {
		return nil
	}
	verification, ok := ctx.Value(workerCommandEpochContextKey{}).(workerCommandEpochContext)
	if !ok {
		return nil
	}
	envelope := verification.envelope
	if strings.TrimSpace(envelope.AccountID) == "" ||
		strings.TrimSpace(envelope.WorkerID) == "" ||
		strings.TrimSpace(envelope.EntityKey) == "" ||
		strings.TrimSpace(envelope.OperationID) == "" ||
		strings.TrimSpace(envelope.CommandID) == "" {
		return nil
	}
	return &workerCommandLaneRecoveryReference{
		AccountID:   envelope.AccountID,
		WorkerID:    envelope.WorkerID,
		EntityKey:   envelope.EntityKey,
		OperationID: envelope.OperationID,
		CommandID:   envelope.CommandID,
	}
}
