package app

import (
	"context"
	"errors"
	"testing"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/reflect/protoreflect"
)

type capturingWorkerConnectionHandler struct {
	request                  StatusConnectionRequest
	runtimeActivationRequest WorkerRuntimeActivationRequest
	runtimeHealthResponse    WorkerRuntimeHealthResponse
	providerHandoffRequest   ProviderHandoffPrepareRequest
	providerHandoffErr       error
}

func (h *capturingWorkerConnectionHandler) PrepareSessionStorageMigration(_ context.Context, request SessionStorageMigrationPrepareRequest) (SessionStorageMigrationPrepareResponse, error) {
	return SessionStorageMigrationPrepareResponse{
		MigrationID:       request.MigrationID,
		WorkerID:          request.WorkerID,
		Provider:          request.Provider,
		RuntimeGeneration: request.RuntimeGeneration,
		Prepared:          true,
	}, nil
}

func (h *capturingWorkerConnectionHandler) PrepareProviderHandoff(_ context.Context, request ProviderHandoffPrepareRequest) (ProviderHandoffPrepareResponse, error) {
	h.providerHandoffRequest = request
	if h.providerHandoffErr != nil {
		return ProviderHandoffPrepareResponse{}, h.providerHandoffErr
	}
	return ProviderHandoffPrepareResponse{
		WorkerID: request.WorkerID, Provider: request.SourceProvider,
		HandoffID: request.HandoffID, LifecycleOperationID: request.LifecycleOperationID,
		SourceRevisionID: request.SourceRevisionID, RuntimeGeneration: request.RuntimeGeneration,
		Prepared: true, ConsumersDrained: true, WritesPaused: true,
		CheckpointPersisted: true, ProviderDisconnected: true, LeaseReleased: true,
		CheckpointChecksumSHA256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		PreparedAt:               "2026-08-02T14:45:00Z",
	}, nil
}

func TestPrepareProviderHandoffReturnsSanitizedFailedPrecondition(t *testing.T) {
	descs, err := getDescriptors()
	if err != nil {
		t.Fatal(err)
	}
	request := newDynamicMessage(descs.providerHandoffPrepareRequest)
	setDynamicString(request, "worker_id", "018f47a0-0100-7000-8000-000000000001")
	setDynamicString(request, "source_provider", "whatsmeow")
	setDynamicString(request, "target_provider", "baileys")

	handler := &capturingWorkerConnectionHandler{
		providerHandoffErr: wrapSafeOperationalError(
			safeCodeHandoffSourceStateConflict,
			errors.New("database endpoint and session material must remain private"),
		),
	}
	server := &WorkerConnectionGRPCServer{handler: handler}
	_, err = server.PrepareProviderHandoff(context.Background(), request)
	if status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("gRPC code = %s, want %s", status.Code(err), codes.FailedPrecondition)
	}
	if status.Convert(err).Message() != safeCodeHandoffSourceStateConflict {
		t.Fatalf("gRPC detail = %q", status.Convert(err).Message())
	}
}

func (h *capturingWorkerConnectionHandler) RequestConnection(_ context.Context, request StatusConnectionRequest) (ConnectionState, error) {
	h.request = request
	return ConnectionState{
		WorkerID:     request.WorkerID,
		WorkerTypeID: WorkerTypeWhatsmeow,
	}, nil
}

func (*capturingWorkerConnectionHandler) SendPasskeyResponse(context.Context, PasskeyResponseRequest) (ConnectionState, error) {
	return ConnectionState{}, nil
}

func (*capturingWorkerConnectionHandler) ConfirmPasskey(context.Context, PasskeyConfirmationRequest) (ConnectionState, error) {
	return ConnectionState{}, nil
}

func (*capturingWorkerConnectionHandler) ImportSecureSession(context.Context, SecureSessionImportRequest) (ConnectionState, error) {
	return ConnectionState{}, nil
}

func (*capturingWorkerConnectionHandler) ValidatePhone(context.Context, PhoneValidationRequest) (PhoneValidationResponse, error) {
	return PhoneValidationResponse{}, nil
}

func (h *capturingWorkerConnectionHandler) ActivateRuntime(_ context.Context, request WorkerRuntimeActivationRequest) (WorkerRuntimeActivationResponse, error) {
	h.runtimeActivationRequest = request
	return WorkerRuntimeActivationResponse{}, nil
}

func (h *capturingWorkerConnectionHandler) RuntimeHealth(context.Context, WorkerRuntimeHealthRequest) (WorkerRuntimeHealthResponse, error) {
	return h.runtimeHealthResponse, nil
}

func TestActivateRuntimeDoesNotExposeLegacyNATSCredentialsField(t *testing.T) {
	descs, err := getDescriptors()
	if err != nil {
		t.Fatalf("get descriptors: %v", err)
	}
	request := newDynamicMessage(descs.workerRuntimeActivationRequest)
	setDynamicString(request, "worker_id", "018f47a0-0100-7000-8000-000000000001")
	setDynamicString(request, "account_id", "018f47a0-0100-7000-8000-000000000002")

	handler := &capturingWorkerConnectionHandler{}
	server := &WorkerConnectionGRPCServer{handler: handler}
	response, err := server.ActivateRuntime(context.Background(), request)
	if err != nil {
		t.Fatalf("ActivateRuntime() error = %v", err)
	}
	if handler.runtimeActivationRequest.WorkerID != "018f47a0-0100-7000-8000-000000000001" {
		t.Fatalf("propagated worker_id = %q", handler.runtimeActivationRequest.WorkerID)
	}
	if response.Descriptor().Fields().ByName("nats_creds_base64") != nil {
		t.Fatal("activation response unexpectedly exposes nats_creds_base64")
	}
}

func TestWorkerConnectionRequestPreservesQRPendingField12(t *testing.T) {
	descs, err := getDescriptors()
	if err != nil {
		t.Fatalf("get descriptors: %v", err)
	}

	field := descs.statusConnectionRequest.Fields().ByName("qr_pending")
	if field == nil {
		t.Fatal("qr_pending field is missing")
	}
	if got := field.Number(); got != 12 {
		t.Fatalf("unexpected qr_pending field number %d", got)
	}

	msg := newDynamicMessage(descs.statusConnectionRequest)
	setDynamicString(msg, "worker_id", "worker-1")
	setDynamicString(msg, "status", "online")
	setDynamicString(msg, "type", "qrcode")
	setDynamicBool(msg, "qr_pending", true)

	handler := &capturingWorkerConnectionHandler{}
	server := &WorkerConnectionGRPCServer{handler: handler}
	if _, err := server.RequestConnection(context.Background(), msg); err != nil {
		t.Fatalf("request connection: %v", err)
	}
	if !handler.request.QRPending {
		t.Fatal("qr_pending was not propagated to the handler")
	}
}

func TestWorkerConnectionRequestPreservesAuthorizedEpochField13(t *testing.T) {
	descs, err := getDescriptors()
	if err != nil {
		t.Fatalf("get descriptors: %v", err)
	}

	field := descs.statusConnectionRequest.Fields().ByName("authorized_connection_epoch")
	if field == nil {
		t.Fatal("authorized_connection_epoch field is missing")
	}
	if got := field.Number(); got != 13 {
		t.Fatalf("unexpected authorized_connection_epoch field number %d", got)
	}

	attemptID := "018f47a0-0100-7000-8000-000000000011"
	authorizedEpoch := "018f47a0-0100-7000-8000-000000000012"
	msg := newDynamicMessage(descs.statusConnectionRequest)
	setDynamicString(msg, "worker_id", "worker-1")
	setDynamicString(msg, "status", "online")
	setDynamicString(msg, "type", "qrcode")
	setDynamicString(msg, "connection_attempt_id", attemptID)
	setDynamicString(msg, "authorized_connection_epoch", authorizedEpoch)

	handler := &capturingWorkerConnectionHandler{}
	server := &WorkerConnectionGRPCServer{handler: handler}
	if _, err := server.RequestConnection(context.Background(), msg); err != nil {
		t.Fatalf("request connection: %v", err)
	}
	if handler.request.ConnectionAttemptID != attemptID ||
		handler.request.AuthorizedConnectionEpoch != authorizedEpoch {
		t.Fatalf("authorized identity was not propagated: %+v", handler.request)
	}
}

func TestPrepareProviderHandoffPreservesExactScopeAndCheckpointProof(t *testing.T) {
	descs, err := getDescriptors()
	if err != nil {
		t.Fatalf("get descriptors: %v", err)
	}
	request := newDynamicMessage(descs.providerHandoffPrepareRequest)
	setDynamicString(request, "worker_id", "018f47a0-0100-7000-8000-000000000001")
	setDynamicString(request, "account_id", "018f47a0-0100-7000-8000-000000000002")
	setDynamicString(request, "handoff_id", "018f47a0-0100-7000-8000-000000000003")
	setDynamicString(request, "lifecycle_operation_id", "018f47a0-0100-7000-8000-000000000004")
	setDynamicString(request, "source_provider", "whatsmeow")
	setDynamicString(request, "target_provider", "baileys")
	setDynamicInt64(request, "source_revision_id", 41)
	setDynamicInt32(request, "runtime_generation", 7)
	setDynamicString(request, "debug_trace_id", "trace-handoff")

	handler := &capturingWorkerConnectionHandler{}
	server := &WorkerConnectionGRPCServer{handler: handler}
	response, err := server.PrepareProviderHandoff(context.Background(), request)
	if err != nil {
		t.Fatalf("prepare provider handoff: %v", err)
	}
	if handler.providerHandoffRequest.SourceRevisionID != 41 ||
		handler.providerHandoffRequest.RuntimeGeneration != 7 ||
		handler.providerHandoffRequest.HandoffID != "018f47a0-0100-7000-8000-000000000003" ||
		handler.providerHandoffRequest.LifecycleOperationID != "018f47a0-0100-7000-8000-000000000004" {
		t.Fatalf("handoff scope changed in gRPC bridge: %+v", handler.providerHandoffRequest)
	}
	if got := dynamicString(response, "checkpoint_checksum_sha256"); got != "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" {
		t.Fatalf("checkpoint checksum changed: %s", got)
	}
	if dynamicInt64(response, "checkpoint_size_bytes") != 0 ||
		dynamicInt64(response, "checkpoint_record_count") != 0 {
		t.Fatal("empty checkpoint proof changed in gRPC bridge")
	}
	if !dynamicBool(response, "prepared") || !dynamicBool(response, "lease_released") {
		t.Fatal("handoff completion flags were not preserved")
	}
}

func TestRuntimeHealthExposesKafkaConsumersReadyField24(t *testing.T) {
	descs, err := getDescriptors()
	if err != nil {
		t.Fatalf("get descriptors: %v", err)
	}

	field := descs.workerRuntimeHealthResponse.Fields().ByName("kafka_consumers_ready")
	if field == nil {
		t.Fatal("kafka_consumers_ready field is missing")
	}
	if got := field.Number(); got != 24 {
		t.Fatalf("unexpected kafka_consumers_ready field number %d", got)
	}

	handler := &capturingWorkerConnectionHandler{
		runtimeHealthResponse: WorkerRuntimeHealthResponse{
			WorkerID:            "worker-1",
			KafkaConsumersReady: true,
		},
	}
	server := &WorkerConnectionGRPCServer{handler: handler}
	request := newDynamicMessage(descs.workerRuntimeHealthRequest)
	setDynamicString(request, "worker_id", "worker-1")

	response, err := server.RuntimeHealth(context.Background(), request)
	if err != nil {
		t.Fatalf("runtime health: %v", err)
	}
	if !dynamicBool(response, "kafka_consumers_ready") {
		t.Fatal("kafka_consumers_ready was not propagated by the gRPC bridge")
	}
}

func TestRuntimeHealthExposesKafkaConsumersAuthorizedField25(t *testing.T) {
	descs, err := getDescriptors()
	if err != nil {
		t.Fatalf("get descriptors: %v", err)
	}

	field := descs.workerRuntimeHealthResponse.Fields().ByName("kafka_consumers_authorized")
	if field == nil {
		t.Fatal("kafka_consumers_authorized field is missing")
	}
	if got := field.Number(); got != 25 {
		t.Fatalf("unexpected kafka_consumers_authorized field number %d", got)
	}

	handler := &capturingWorkerConnectionHandler{
		runtimeHealthResponse: WorkerRuntimeHealthResponse{
			WorkerID:                 "worker-1",
			KafkaConsumersAuthorized: true,
		},
	}
	server := &WorkerConnectionGRPCServer{handler: handler}
	request := newDynamicMessage(descs.workerRuntimeHealthRequest)
	setDynamicString(request, "worker_id", "worker-1")

	response, err := server.RuntimeHealth(context.Background(), request)
	if err != nil {
		t.Fatalf("runtime health: %v", err)
	}
	if !dynamicBool(response, "kafka_consumers_authorized") {
		t.Fatal("kafka_consumers_authorized was not propagated by the gRPC bridge")
	}
}

func TestRuntimeHealthExposesSchemaVersionField26(t *testing.T) {
	descs, err := getDescriptors()
	if err != nil {
		t.Fatalf("get descriptors: %v", err)
	}

	field := descs.workerRuntimeHealthResponse.Fields().ByName("runtime_health_schema_version")
	if field == nil {
		t.Fatal("runtime_health_schema_version field is missing")
	}
	if got := field.Number(); got != 26 {
		t.Fatalf("unexpected runtime_health_schema_version field number %d", got)
	}

	handler := &capturingWorkerConnectionHandler{
		runtimeHealthResponse: WorkerRuntimeHealthResponse{
			WorkerID:                   "worker-1",
			RuntimeHealthSchemaVersion: 3,
		},
	}
	server := &WorkerConnectionGRPCServer{handler: handler}
	request := newDynamicMessage(descs.workerRuntimeHealthRequest)
	setDynamicString(request, "worker_id", "worker-1")

	response, err := server.RuntimeHealth(context.Background(), request)
	if err != nil {
		t.Fatalf("runtime health: %v", err)
	}
	if got := response.Get(field).Uint(); got != 3 {
		t.Fatalf("unexpected runtime_health_schema_version %d", got)
	}
}

func TestRuntimeHealthEncodesSessionRevisionIDAsCanonicalInt64Field32(t *testing.T) {
	descs, err := getDescriptors()
	if err != nil {
		t.Fatalf("get descriptors: %v", err)
	}

	field := descs.workerRuntimeHealthResponse.Fields().ByName("session_revision_id")
	if field == nil {
		t.Fatal("session_revision_id field is missing")
	}
	if got := field.Number(); got != 32 {
		t.Fatalf("unexpected session_revision_id field number %d", got)
	}
	if got := field.Kind(); got != protoreflect.Int64Kind {
		t.Fatalf("unexpected session_revision_id field kind %s", got)
	}

	handler := &capturingWorkerConnectionHandler{
		runtimeHealthResponse: WorkerRuntimeHealthResponse{
			WorkerID:          "worker-1",
			SessionRevisionID: 42,
		},
	}
	server := &WorkerConnectionGRPCServer{handler: handler}
	request := newDynamicMessage(descs.workerRuntimeHealthRequest)
	setDynamicString(request, "worker_id", "worker-1")

	response, err := server.RuntimeHealth(context.Background(), request)
	if err != nil {
		t.Fatalf("runtime health: %v", err)
	}
	if got := dynamicInt64(response, "session_revision_id"); got != 42 {
		t.Fatalf("unexpected session_revision_id %d", got)
	}
}
