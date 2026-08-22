package app

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/nats-io/nats.go"
	modernjs "github.com/nats-io/nats.go/jetstream"
	"github.com/segmentio/kafka-go"
)

func TestWorkerCommandLaneClaimRequiresTransitivePredecessorCompletion(t *testing.T) {
	for _, fragment := range []string{
		"local function dependencies_terminal(start_prefix)",
		"predecessor_prefix .. ':predecessor_satisfied', '1'",
		"prefix .. ':predecessor_satisfied') or '') ~= '1'",
		"elseif not dependencies_terminal(predecessor_prefix) then",
		"return 'deferred'",
	} {
		if !strings.Contains(claimWorkerCommandLaneScript, fragment) {
			t.Fatalf("claim lane script is missing transitive ordering guard %q", fragment)
		}
	}
}

func TestWorkerCommandNATSAuthenticationRequiresStaticUserAndPassword(t *testing.T) {
	options, err := workerCommandNATSAuthOptions(Config{
		NATSUser:     "runtime-user",
		NATSPassword: "runtime-password",
	})
	if err != nil || len(options) != 1 {
		t.Fatalf("static user/password option = %d, %v", len(options), err)
	}
	for _, cfg := range []Config{{}, {NATSUser: "user"}, {NATSPassword: "password"}} {
		if _, err := workerCommandNATSAuthOptions(cfg); err == nil {
			t.Fatalf("incomplete static NATS authentication was accepted: %+v", cfg)
		}
	}
}

func TestWorkerCommandNATSClientCloseIsNilSafe(t *testing.T) {
	var client *WorkerCommandNATSClient
	client.Close()
	(&WorkerCommandNATSClient{}).Close()
}

func TestWorkerCommandEnvelopeOperationIDOverridesLegacyPayloadIdentities(t *testing.T) {
	message := kafka.Message{Headers: []kafka.Header{{Key: workerCommandHeaderOperationID, Value: []byte("manual-retry-operation-2")}}}
	if got := outboundOperationIDFromMessage(message, "payload-hash"); got != "manual-retry-operation-2" {
		t.Fatalf("outbound operation id = %q", got)
	}
	scheduled := ScheduleMessage{OperationID: "manual-retry-operation-2", Message: ChatMessage{MessageID: "legacy-message-id"}}
	if got := scheduleMessageOutboundOperationID(scheduled); got != "manual-retry-operation-2" {
		t.Fatalf("schedule operation id = %q", got)
	}
}

type workerCommandEpochTestEntry struct {
	value     []byte
	revision  uint64
	operation nats.KeyValueOp
}

func (entry workerCommandEpochTestEntry) Bucket() string             { return workerCommandEpochBucketName }
func (entry workerCommandEpochTestEntry) Key() string                { return "worker.worker-1" }
func (entry workerCommandEpochTestEntry) Value() []byte              { return entry.value }
func (entry workerCommandEpochTestEntry) Revision() uint64           { return entry.revision }
func (entry workerCommandEpochTestEntry) Created() time.Time         { return time.Time{} }
func (entry workerCommandEpochTestEntry) Delta() uint64              { return 0 }
func (entry workerCommandEpochTestEntry) Operation() nats.KeyValueOp { return entry.operation }

func TestDecodeWorkerCommandEpochEntryRequiresCanonicalCrossRuntimeRecord(t *testing.T) {
	const epoch = "opaque-epoch-7"
	record := workerCommandEpochRecordV1{
		SchemaVersion:     1,
		WorkerID:          "worker-1",
		AccountID:         "account-1",
		Epoch:             epoch,
		RuntimeGeneration: 7,
		State:             "active",
		ActivatedAt:       "2026-08-13T12:00:00.000Z",
		UpdatedAt:         "2026-08-13T12:00:00.000Z",
		ClosedAt:          nil,
	}
	payload, err := json.Marshal(record)
	if err != nil {
		t.Fatal(err)
	}
	entry := workerCommandEpochTestEntry{value: payload, revision: 7, operation: nats.KeyValuePut}
	decoded, err := decodeWorkerCommandEpochEntry(entry, "worker-1", "account-1")
	if err != nil {
		t.Fatalf("decodeWorkerCommandEpochEntry() error = %v", err)
	}
	if decoded.Epoch != epoch || decoded.State != "active" {
		t.Fatalf("unexpected decoded epoch record: %+v", decoded)
	}

	record.UpdatedAt = ""
	payload, _ = json.Marshal(record)
	entry.value = payload
	if _, err := decodeWorkerCommandEpochEntry(entry, "worker-1", "account-1"); err == nil {
		t.Fatal("epoch record without canonical updated_at was accepted")
	}
}

func TestWorkerCommandFailureIDMatchesCrossRuntimeGolden(t *testing.T) {
	const commandID = "018f47cc-6a4c-7a4a-8b2c-87fd93c87a11"
	const want = "978c1f02f54ab3efee977ad1192285d2143daf590f22063f37edd0fd7642fc71"
	if got := workerCommandFailureID("worker-1", commandID, "expired"); got != want {
		t.Fatalf("workerCommandFailureID() = %q, want %q", got, want)
	}
	message := &nats.Msg{Subject: "uc.worker.command.worker-1", Data: []byte("not-json")}
	identity := workerCommandFailureIdentity(message, "")
	if identity == "" || identity == "unknown" {
		t.Fatalf("invalid envelope did not receive delivery-scoped identity: %q", identity)
	}
	if workerCommandFailureID("worker-1", identity, "invalid_envelope") == workerCommandFailureID("worker-1", "unknown", "invalid_envelope") {
		t.Fatal("invalid-envelope failure identity collapsed to a global unknown record")
	}
}

func TestWorkerCommandConsumerConfigKeepsFiveMinuteAckWait(t *testing.T) {
	config := workerCommandConsumerConfig("worker-1")
	if config.AckPolicy != nats.AckExplicitPolicy || config.AckWait != 5*time.Minute {
		t.Fatalf("unexpected ack contract: policy=%v wait=%s", config.AckPolicy, config.AckWait)
	}
	if len(config.BackOff) != 0 {
		t.Fatalf("server BackOff overrides AckWait and must remain empty: %v", config.BackOff)
	}
	if config.MaxDeliver != -1 || config.MaxAckPending != 128 || config.MaxRequestBatch != 64 || config.Replicas != 3 {
		t.Fatalf("unexpected durable limits: %+v", *config)
	}
}

func TestWorkerCommandDeferredContractAndCrossRuntimeIdentities(t *testing.T) {
	const wantIdentity = "dce832b8f1070faea5da666e250a2e7a1dbd6e18ebcf0338020b2195f95f0397"
	if got := workerCommandDeferredIdentity("command-1", 42); got != wantIdentity {
		t.Fatalf("deferred identity = %q, want %q", got, wantIdentity)
	}
	wantSubject := "uc.worker.deferred.schedule.worker-1." + wantIdentity
	if got := workerCommandDeferredScheduleSubject("worker-1", "command-1", 42); got != wantSubject {
		t.Fatalf("deferred schedule subject = %q, want %q", got, wantSubject)
	}
	const wantScheduleMessageID = "worker-deferred-schedule-v1:" + wantIdentity
	if got := workerCommandDeferredScheduleMessageID(wantIdentity); got != wantScheduleMessageID {
		t.Fatalf("deferred schedule Msg-Id = %q, want %q", got, wantScheduleMessageID)
	}
	const wantRelayID = "worker-deferred-relay-v1:" + wantIdentity
	if got := workerCommandDeferredRelayMessageID(wantIdentity); got != wantRelayID {
		t.Fatalf("deferred relay Msg-Id = %q, want %q", got, wantRelayID)
	}

	info := &modernjs.StreamInfo{Config: modernjs.StreamConfig{
		Name:              workerCommandDeferredStreamName,
		Subjects:          []string{workerDeferredScheduleSubjectFilter, workerDeferredReadySubjectFilter},
		Retention:         modernjs.WorkQueuePolicy,
		MaxConsumers:      8,
		MaxMsgs:           -1,
		MaxBytes:          -1,
		MaxAge:            workerCommandMaxAge,
		MaxMsgsPerSubject: -1,
		MaxMsgSize:        workerCommandMaxBytes,
		Discard:           modernjs.DiscardOld,
		Storage:           modernjs.FileStorage,
		Replicas:          3,
		Compression:       modernjs.S2Compression,
		Duplicates:        workerCommandNATSDuplicateWindow,
		DenyDelete:        true,
		DenyPurge:         false,
		AllowRollup:       true,
		AllowMsgTTL:       true,
		AllowMsgSchedules: true,
	}}
	if err := validateWorkerCommandDeferredStreamInfo(info); err != nil {
		t.Fatalf("canonical deferred stream was rejected: %v", err)
	}
	info.Config.Discard = modernjs.DiscardNew
	if err := validateWorkerCommandDeferredStreamInfo(info); err == nil {
		t.Fatal("DiscardNew deferred stream was accepted despite ADR-51")
	}

	relay := workerCommandDeferredRelayConsumerConfig()
	if relay.Durable != workerDeferredRelayDurableName ||
		relay.FilterSubject != workerDeferredReadySubjectFilter ||
		relay.AckPolicy != nats.AckExplicitPolicy ||
		relay.MaxDeliver != -1 || relay.MaxAckPending != 512 || relay.MaxRequestBatch != 128 || relay.Replicas != 3 {
		t.Fatalf("unexpected deferred relay durable contract: %+v", *relay)
	}
	if err := validateWorkerCommandDeferredRelayConsumerInfo(&nats.ConsumerInfo{Config: *relay}); err != nil {
		t.Fatalf("canonical deferred relay consumer was rejected: %v", err)
	}
	driftedRelay := *relay
	driftedRelay.MaxAckPending = 128
	if err := validateWorkerCommandDeferredRelayConsumerInfo(&nats.ConsumerInfo{Config: driftedRelay}); err == nil {
		t.Fatal("drifted deferred relay consumer was accepted")
	}
	if parsed, err := parseWorkerCommandDeferredScheduleSubject(wantSubject, "worker-1"); err != nil || parsed != wantIdentity {
		t.Fatalf("parse deferred schedule identity = %q, %v", parsed, err)
	}
	if _, err := parseWorkerCommandDeferredScheduleSubject(wantSubject, "worker-2"); err == nil {
		t.Fatal("cross-worker deferred schedule identity was accepted")
	}
}

func TestDecodeWorkerCommandEpochEntryRequiresClosedTimestamp(t *testing.T) {
	record := workerCommandEpochRecordV1{
		SchemaVersion:     1,
		WorkerID:          "worker-1",
		AccountID:         "account-1",
		Epoch:             "018f47cc-6a4c-7a4a-8b2c-87fd93c87a11",
		RuntimeGeneration: 7,
		State:             "closed",
		ActivatedAt:       "2026-08-13T12:00:00.000Z",
		UpdatedAt:         "2026-08-13T12:01:00.000Z",
		ClosedAt:          nil,
	}
	payload, _ := json.Marshal(record)
	entry := workerCommandEpochTestEntry{value: payload, operation: nats.KeyValuePut}
	if _, err := decodeWorkerCommandEpochEntry(entry, "worker-1", "account-1"); err == nil {
		t.Fatal("closed epoch record without closed_at was accepted")
	}

	closedAt := "2026-08-13T12:01:00.000Z"
	record.ClosedAt = &closedAt
	payload, _ = json.Marshal(record)
	entry.value = payload
	if _, err := decodeWorkerCommandEpochEntry(entry, "worker-1", "account-1"); err != nil {
		t.Fatalf("canonical closed epoch record rejected: %v", err)
	}
}

func TestWorkerCommandEpochAuthorizationRejectsStaleRuntime(t *testing.T) {
	const oldEpoch = "018f47cc-6a4c-7a4a-8b2c-87fd93c87a11"
	const newEpoch = "018f47cc-6a4c-7a4a-8b2c-87fd93c87a12"
	record := workerCommandEpochRecordV1{
		Epoch:              newEpoch,
		RuntimeWriterEpoch: stringPointer(newEpoch),
		RuntimeGeneration:  9,
		State:              "active",
	}
	envelope := WorkerCommandEnvelopeV1{
		WorkerID:    "worker-1",
		AccountID:   "account-1",
		OriginEpoch: newEpoch,
	}
	current := workerCommandRuntimeIdentity{
		WorkerID:          "worker-1",
		AccountID:         "account-1",
		CommandEpoch:      newEpoch,
		WriterEpoch:       newEpoch,
		RuntimeGeneration: 9,
	}
	if !workerCommandEpochAuthorizesRuntime(record, envelope, current) {
		t.Fatal("current runtime epoch was rejected")
	}
	stale := current
	stale.WriterEpoch = oldEpoch
	stale.RuntimeGeneration = 8
	if workerCommandEpochAuthorizesRuntime(record, envelope, stale) {
		t.Fatal("stale runtime accepted a replacement epoch command")
	}
}

func TestWorkerCommandEpochVerifierClassification(t *testing.T) {
	const oldEpoch = "018f47cc-6a4c-7a4a-8b2c-87fd93c87a11"
	const newEpoch = "018f47cc-6a4c-7a4a-8b2c-87fd93c87a12"
	record := workerCommandEpochRecordV1{Epoch: newEpoch, RuntimeGeneration: 9, State: "active"}
	envelope := WorkerCommandEnvelopeV1{WorkerID: "worker-1", AccountID: "account-1", OriginEpoch: newEpoch}
	staleRuntime := workerCommandRuntimeIdentity{
		WorkerID:          "worker-1",
		AccountID:         "account-1",
		CommandEpoch:      newEpoch,
		WriterEpoch:       oldEpoch,
		RuntimeGeneration: 8,
	}
	if err := workerCommandEpochVerificationError(record, envelope, staleRuntime); !errors.Is(err, errWorkerCommandRuntimeReplaced) {
		t.Fatalf("current envelope on stale runtime classified as %v", err)
	}

	staleEnvelope := envelope
	staleEnvelope.OriginEpoch = oldEpoch
	if err := workerCommandEpochVerificationError(record, staleEnvelope, staleRuntime); !errors.Is(err, errWorkerCommandEpochRejected) {
		t.Fatalf("stale envelope classified as %v", err)
	}
}

func TestWorkerCommandLogicalEpochSurvivesRuntimeRecreation(t *testing.T) {
	const logicalEpoch = "018f47cc-6a4c-7a4a-8b2c-87fd93c87a10"
	const oldWriterEpoch = "018f47cc-6a4c-7a4a-8b2c-87fd93c87a11"
	const newWriterEpoch = "018f47cc-6a4c-7a4a-8b2c-87fd93c87a12"
	record := workerCommandEpochRecordV1{
		Epoch:              logicalEpoch,
		RuntimeWriterEpoch: stringPointer(newWriterEpoch),
		RuntimeGeneration:  9,
		State:              "active",
	}
	backlog := WorkerCommandEnvelopeV1{WorkerID: "worker-1", AccountID: "account-1", OriginEpoch: logicalEpoch}
	recreated := workerCommandRuntimeIdentity{
		WorkerID: "worker-1", AccountID: "account-1", CommandEpoch: logicalEpoch,
		WriterEpoch: newWriterEpoch, RuntimeGeneration: 9,
	}
	if err := workerCommandEpochVerificationError(record, backlog, recreated); err != nil {
		t.Fatalf("valid pre-recreate backlog was rejected: %v", err)
	}
	oldRuntime := recreated
	oldRuntime.WriterEpoch = oldWriterEpoch
	oldRuntime.RuntimeGeneration = 8
	if err := workerCommandEpochVerificationError(record, backlog, oldRuntime); !errors.Is(err, errWorkerCommandRuntimeReplaced) {
		t.Fatalf("old runtime was not fenced: %v", err)
	}

	legacy := workerCommandEpochRecordV1{Epoch: oldWriterEpoch, RuntimeGeneration: 8, State: "active"}
	if got := effectiveWorkerCommandRuntimeWriterEpoch(legacy); got != oldWriterEpoch {
		t.Fatalf("legacy runtime writer inference = %q", got)
	}
	if got := classifyWorkerCommandEpochActivation(legacy, newWriterEpoch, 9); got != workerCommandEpochReplace {
		t.Fatalf("legacy active record could not advance safely: %v", got)
	}
}
