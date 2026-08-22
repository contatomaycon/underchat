package app

import (
	"context"
	"fmt"
	"log"
	"net"
	"time"

	"google.golang.org/grpc"
	grpcCodes "google.golang.org/grpc/codes"
	grpcStatus "google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/dynamicpb"
)

type WorkerConnectionHandler interface {
	RequestConnection(context.Context, StatusConnectionRequest) (ConnectionState, error)
	SendPasskeyResponse(context.Context, PasskeyResponseRequest) (ConnectionState, error)
	ConfirmPasskey(context.Context, PasskeyConfirmationRequest) (ConnectionState, error)
	ImportSecureSession(context.Context, SecureSessionImportRequest) (ConnectionState, error)
	ValidatePhone(context.Context, PhoneValidationRequest) (PhoneValidationResponse, error)
	ActivateRuntime(context.Context, WorkerRuntimeActivationRequest) (WorkerRuntimeActivationResponse, error)
	RuntimeHealth(context.Context, WorkerRuntimeHealthRequest) (WorkerRuntimeHealthResponse, error)
	PrepareProviderHandoff(context.Context, ProviderHandoffPrepareRequest) (ProviderHandoffPrepareResponse, error)
	PrepareSessionStorageMigration(context.Context, SessionStorageMigrationPrepareRequest) (SessionStorageMigrationPrepareResponse, error)
}

func (s *WorkerConnectionGRPCServer) PrepareSessionStorageMigration(ctx context.Context, msg *dynamicpb.Message) (*dynamicpb.Message, error) {
	descs, err := getDescriptors()
	if err != nil {
		return nil, err
	}
	req := SessionStorageMigrationPrepareRequest{
		MigrationID:       dynamicString(msg, "migration_id"),
		WorkerID:          dynamicString(msg, "worker_id"),
		AccountID:         dynamicString(msg, "account_id"),
		Provider:          dynamicString(msg, "provider"),
		RuntimeGeneration: int(dynamicInt32(msg, "runtime_generation")),
		RuntimeCapability: dynamicString(msg, "runtime_capability"),
		LegacyVolumeName:  dynamicString(msg, "source_volume_name"),
		ExpectedPhone:     dynamicString(msg, "expected_phone"),
	}
	resp, err := s.handler.PrepareSessionStorageMigration(ctx, req)
	if err != nil {
		return nil, grpcStatus.Error(grpcCodes.FailedPrecondition, safeOperationalErrorCode(err))
	}
	out := newDynamicMessage(descs.sessionStorageMigrationPrepareResponse)
	setDynamicString(out, "migration_id", resp.MigrationID)
	setDynamicString(out, "worker_id", resp.WorkerID)
	setDynamicString(out, "provider", resp.Provider)
	setDynamicInt32(out, "runtime_generation", int32(resp.RuntimeGeneration))
	setDynamicBool(out, "prepared", resp.Prepared)
	setDynamicBool(out, "consumers_drained", resp.ConsumersDrained)
	setDynamicBool(out, "writes_paused", resp.WritesPaused)
	setDynamicBool(out, "checkpoint_persisted", resp.CheckpointPersisted)
	setDynamicBool(out, "provider_disconnected", resp.ProviderDisconnected)
	setDynamicBool(out, "volume_preserved", resp.VolumePreserved)
	setDynamicString(out, "checkpoint_checksum_sha256", resp.CheckpointChecksumSHA256)
	setDynamicInt64(out, "checkpoint_size_bytes", resp.CheckpointSizeBytes)
	setDynamicInt64(out, "checkpoint_record_count", resp.CheckpointRecordCount)
	setDynamicString(out, "phone", resp.Phone)
	setDynamicString(out, "identity_hash", resp.IdentityHashSHA256)
	setDynamicString(out, "prepared_at", resp.PreparedAt)
	setDynamicString(out, "error", resp.Error)
	return out, nil
}

func (s *WorkerConnectionGRPCServer) PrepareProviderHandoff(ctx context.Context, msg *dynamicpb.Message) (*dynamicpb.Message, error) {
	descs, err := getDescriptors()
	if err != nil {
		return nil, err
	}
	req := ProviderHandoffPrepareRequest{
		WorkerID:             dynamicString(msg, "worker_id"),
		AccountID:            dynamicString(msg, "account_id"),
		HandoffID:            dynamicString(msg, "handoff_id"),
		LifecycleOperationID: dynamicString(msg, "lifecycle_operation_id"),
		SourceProvider:       dynamicString(msg, "source_provider"),
		TargetProvider:       dynamicString(msg, "target_provider"),
		SourceRevisionID:     dynamicInt64(msg, "source_revision_id"),
		RuntimeGeneration:    int(dynamicInt32(msg, "runtime_generation")),
		DebugTraceID:         dynamicString(msg, "debug_trace_id"),
	}
	startedAt := time.Now()
	logWhatsappSessionDebug(s.cfg.WhatsappSessionDebugEnabled, "provider_handoff.grpc_received", map[string]any{
		"trace_id": req.DebugTraceID, "session_id": req.WorkerID,
		"provider": req.SourceProvider, "handoff_id": req.HandoffID,
		"lifecycle_operation_id": req.LifecycleOperationID,
		"revision":               req.SourceRevisionID, "generation": req.RuntimeGeneration,
		"target_provider": req.TargetProvider,
	})
	resp, err := s.handler.PrepareProviderHandoff(ctx, req)
	if err != nil {
		errorCode := safeOperationalErrorCode(err)
		logWhatsappSessionDebug(true, "provider_handoff.grpc_failed", map[string]any{
			"trace_id": req.DebugTraceID, "session_id": req.WorkerID,
			"provider": req.SourceProvider, "handoff_id": req.HandoffID,
			"duration_ms": time.Since(startedAt).Milliseconds(),
			"error":       errorCode,
		})
		return nil, grpcStatus.Error(grpcCodes.FailedPrecondition, errorCode)
	}
	out := newDynamicMessage(descs.providerHandoffPrepareResponse)
	setDynamicString(out, "worker_id", resp.WorkerID)
	setDynamicString(out, "provider", resp.Provider)
	setDynamicString(out, "handoff_id", resp.HandoffID)
	setDynamicString(out, "lifecycle_operation_id", resp.LifecycleOperationID)
	setDynamicInt64(out, "source_revision_id", resp.SourceRevisionID)
	setDynamicInt32(out, "runtime_generation", int32(resp.RuntimeGeneration))
	setDynamicBool(out, "prepared", resp.Prepared)
	setDynamicBool(out, "consumers_drained", resp.ConsumersDrained)
	setDynamicBool(out, "writes_paused", resp.WritesPaused)
	setDynamicBool(out, "checkpoint_persisted", resp.CheckpointPersisted)
	setDynamicBool(out, "provider_disconnected", resp.ProviderDisconnected)
	setDynamicBool(out, "lease_released", resp.LeaseReleased)
	setDynamicString(out, "checkpoint_checksum_sha256", resp.CheckpointChecksumSHA256)
	setDynamicInt64(out, "checkpoint_size_bytes", resp.CheckpointSizeBytes)
	setDynamicInt64(out, "checkpoint_record_count", resp.CheckpointRecordCount)
	setDynamicString(out, "prepared_at", resp.PreparedAt)
	setDynamicString(out, "error", resp.Error)
	logWhatsappSessionDebug(s.cfg.WhatsappSessionDebugEnabled, "provider_handoff.grpc_completed", map[string]any{
		"trace_id": req.DebugTraceID, "session_id": resp.WorkerID,
		"provider": resp.Provider, "handoff_id": resp.HandoffID,
		"revision":                resp.SourceRevisionID,
		"duration_ms":             time.Since(startedAt).Milliseconds(),
		"checkpoint_size_bytes":   resp.CheckpointSizeBytes,
		"checkpoint_record_count": resp.CheckpointRecordCount,
		"lease_released":          resp.LeaseReleased,
	})
	return out, nil
}

type WorkerConnectionGRPCServer struct {
	handler WorkerConnectionHandler
	server  *grpc.Server
	addr    string
	cfg     Config
	debug   *ConnectionLifecycleDebugLogger
}

func NewWorkerConnectionGRPCServer(addr string, handler WorkerConnectionHandler, cfg Config, debugLoggers ...*ConnectionLifecycleDebugLogger) (*WorkerConnectionGRPCServer, error) {
	if _, err := getDescriptors(); err != nil {
		return nil, err
	}
	var debug *ConnectionLifecycleDebugLogger
	if len(debugLoggers) > 0 {
		debug = debugLoggers[0]
	}
	return &WorkerConnectionGRPCServer{
		handler: handler,
		server:  grpc.NewServer(),
		addr:    addr,
		cfg:     cfg,
		debug:   debug,
	}, nil
}

func (s *WorkerConnectionGRPCServer) Start() error {
	listener, err := net.Listen("tcp", s.addr)
	if err != nil {
		return err
	}

	RegisterWorkerConnectionService(s.server, s)
	go func() {
		if err := s.server.Serve(listener); err != nil {
			fmt.Printf("worker connection grpc server stopped: %v\n", err)
		}
	}()
	log.Printf("worker connection grpc server listening addr=%s", s.addr)
	return nil
}

func (s *WorkerConnectionGRPCServer) Stop() {
	if s.server != nil {
		s.server.GracefulStop()
	}
}

func (s *WorkerConnectionGRPCServer) RequestConnection(ctx context.Context, msg *dynamicpb.Message) (*dynamicpb.Message, error) {
	descs, err := getDescriptors()
	if err != nil {
		return nil, err
	}
	req := StatusConnectionRequest{
		WorkerID:                  dynamicString(msg, "worker_id"),
		Status:                    dynamicString(msg, "status"),
		Type:                      dynamicString(msg, "type"),
		PhoneConnection:           dynamicString(msg, "phone_connection"),
		RemoveSession:             dynamicBool(msg, "remove_session"),
		ConnectionAttemptID:       dynamicString(msg, "connection_attempt_id"),
		AuthorizedConnectionEpoch: dynamicString(msg, "authorized_connection_epoch"),
		RuntimeGeneration:         int(dynamicInt32(msg, "runtime_generation")),
		WarmPoolID:                dynamicString(msg, "warm_pool_id"),
		DebugTraceID:              dynamicString(msg, "debug_trace_id"),
		QRPending:                 dynamicBool(msg, "qr_pending"),
	}
	startedAt := time.Now()
	s.debug.Log(ctx, "whatsmeow.grpc.request_connection.received", map[string]any{
		"trace_id":              req.DebugTraceID,
		"layer":                 "worker_whatsmeow.grpc",
		"worker_id":             req.WorkerID,
		"worker_type_id":        WorkerTypeWhatsmeow,
		"connection_attempt_id": req.ConnectionAttemptID,
		"runtime_generation":    req.RuntimeGeneration,
		"status":                req.Status,
		"type":                  req.Type,
		"remove_session":        req.RemoveSession,
		"qr_pending":            req.QRPending,
		"phone_connection_set":  req.PhoneConnection != "",
		"grpc_method":           "RequestConnection",
		"warm_pool_id":          req.WarmPoolID,
	})
	log.Printf(
		"grpc RequestConnection received worker_id=%s status=%s type=%s remove_session=%t qr_pending=%t phone_connection_set=%t",
		req.WorkerID,
		req.Status,
		req.Type,
		req.RemoveSession,
		req.QRPending,
		req.PhoneConnection != "",
	)
	connectionFlowLog("whatsmeow.grpc.request_connection.received", map[string]any{
		"trace_id":              req.DebugTraceID,
		"layer":                 "worker_whatsmeow.grpc",
		"worker_id":             req.WorkerID,
		"worker_type_id":        WorkerTypeWhatsmeow,
		"connection_attempt_id": req.ConnectionAttemptID,
		"runtime_generation":    req.RuntimeGeneration,
		"status":                req.Status,
		"type":                  req.Type,
		"remove_session":        req.RemoveSession,
		"qr_pending":            req.QRPending,
		"phone_connection_set":  req.PhoneConnection != "",
		"grpc_method":           "RequestConnection",
		"warm_pool_id":          req.WarmPoolID,
	})
	resp, err := s.handler.RequestConnection(ctx, req)
	if err != nil {
		errorCode := safeOperationalErrorCode(err)
		s.debug.Log(ctx, "whatsmeow.grpc.request_connection.error", map[string]any{
			"trace_id":              req.DebugTraceID,
			"layer":                 "worker_whatsmeow.grpc",
			"worker_id":             req.WorkerID,
			"worker_type_id":        WorkerTypeWhatsmeow,
			"connection_attempt_id": req.ConnectionAttemptID,
			"runtime_generation":    req.RuntimeGeneration,
			"status":                req.Status,
			"type":                  req.Type,
			"duration_ms":           time.Since(startedAt).Milliseconds(),
			"error_code":            errorCode,
		})
		log.Printf("grpc RequestConnection failed worker_id=%s type=%s error_code=%s", req.WorkerID, req.Type, errorCode)
		connectionFlowLog("whatsmeow.grpc.request_connection.error", map[string]any{
			"trace_id":              req.DebugTraceID,
			"layer":                 "worker_whatsmeow.grpc",
			"worker_id":             req.WorkerID,
			"worker_type_id":        WorkerTypeWhatsmeow,
			"connection_attempt_id": req.ConnectionAttemptID,
			"runtime_generation":    req.RuntimeGeneration,
			"status":                req.Status,
			"type":                  req.Type,
			"duration_ms":           time.Since(startedAt).Milliseconds(),
			"reason":                errorCode,
		})
		return nil, err
	}
	if resp.ConnectionAttemptID == "" {
		resp.ConnectionAttemptID = req.ConnectionAttemptID
	}
	if resp.DebugTraceID == "" {
		resp.DebugTraceID = req.DebugTraceID
	}
	s.debug.Log(ctx, "whatsmeow.grpc.request_connection.completed", map[string]any{
		"trace_id":                      resp.DebugTraceID,
		"layer":                         "worker_whatsmeow.grpc",
		"worker_id":                     resp.WorkerID,
		"account_id":                    resp.AccountID,
		"worker_type_id":                WorkerTypeWhatsmeow,
		"connection_attempt_id":         resp.ConnectionAttemptID,
		"runtime_generation":            resp.RuntimeGeneration,
		"status":                        resp.Status,
		"code":                          resp.Code,
		"duration_ms":                   time.Since(startedAt).Milliseconds(),
		"has_qr":                        resp.QRCode != "",
		"qr_length":                     len(resp.QRCode),
		"has_pairing_code":              resp.PairingCode != "",
		"pairing_code_length":           len(resp.PairingCode),
		"has_passkey_public_key":        resp.PasskeyPublicKey != "",
		"has_passkey_confirmation_code": resp.PasskeyConfirmationCode != "",
	})
	log.Printf("grpc RequestConnection completed worker_id=%s type=%s has_qr=%t", req.WorkerID, req.Type, resp.QRCode != "")
	connectionFlowLog("whatsmeow.grpc.request_connection.completed", map[string]any{
		"trace_id":                         resp.DebugTraceID,
		"layer":                            "worker_whatsmeow.grpc",
		"worker_id":                        resp.WorkerID,
		"account_id":                       resp.AccountID,
		"worker_type_id":                   WorkerTypeWhatsmeow,
		"connection_attempt_id":            resp.ConnectionAttemptID,
		"runtime_generation":               resp.RuntimeGeneration,
		"status":                           resp.Status,
		"code":                             resp.Code,
		"reason":                           resp.Reason,
		"duration_ms":                      time.Since(startedAt).Milliseconds(),
		"has_qr":                           resp.QRCode != "",
		"qr_length":                        len(resp.QRCode),
		"has_pairing_code":                 resp.PairingCode != "",
		"pairing_code_length":              len(resp.PairingCode),
		"has_passkey_public_key":           resp.PasskeyPublicKey != "",
		"passkey_public_key_length":        len(resp.PasskeyPublicKey),
		"has_passkey_confirmation_code":    resp.PasskeyConfirmationCode != "",
		"passkey_confirmation_code_length": len(resp.PasskeyConfirmationCode),
	})
	out := newDynamicMessage(descs.workerConnectionResponse)
	setConnectionStateMessage(out, resp)
	return out, nil
}

func setConnectionStateMessage(out *dynamicpb.Message, state ConnectionState) {
	setDynamicInt32(out, "code", int32(state.Code))
	setDynamicString(out, "status", state.Status)
	setDynamicString(out, "worker_id", state.WorkerID)
	setDynamicString(out, "account_id", state.AccountID)
	setDynamicString(out, "worker_type_id", state.WorkerTypeID)
	setDynamicString(out, "qrcode", state.QRCode)
	setDynamicBool(out, "is_new_login", state.IsNewLogin)
	setDynamicInt64(out, "time", state.Time)
	setDynamicString(out, "phone", state.Phone)
	setDynamicBool(out, "disconnected_user", state.DisconnectedUser)
	setDynamicString(out, "pairing_code", state.PairingCode)
	setDynamicString(out, "passkey_public_key", state.PasskeyPublicKey)
	setDynamicBool(out, "passkey_pending", state.PasskeyPending)
	setDynamicString(out, "passkey_confirmation_code", state.PasskeyConfirmationCode)
	setDynamicBool(out, "passkey_skip_handoff_ux", state.PasskeySkipHandoffUX)
	setDynamicInt32(out, "seconds_until_next_attempt", int32(state.SecondsUntilNextAttempt))
	setDynamicString(out, "worker_status_id", state.WorkerStatusID)
	setDynamicInt32(out, "attempt", int32(state.Attempt))
	setDynamicInt32(out, "max_attempts", int32(state.MaxAttempts))
	setDynamicString(out, "connection_attempt_id", state.ConnectionAttemptID)
	setDynamicString(out, "authorized_connection_epoch", state.AuthorizedConnectionEpoch)
	setDynamicBool(out, "qr_pending", state.QRPending)
	setDynamicString(out, "qr_generated_at", state.QRGeneratedAt)
	setDynamicString(out, "expires_at", state.ExpiresAt)
	setDynamicString(out, "reason", state.Reason)
	setDynamicString(out, "error", state.Error)
	setDynamicInt32(out, "time_to_first_qr_ms", int32(state.TimeToFirstQRMS))
	setDynamicString(out, "container_id", state.ContainerID)
	setDynamicInt32(out, "runtime_generation", int32(state.RuntimeGeneration))
	setDynamicString(out, "warm_pool_id", state.WarmPoolID)
	setDynamicString(out, "proxy_status", state.ProxyStatus)
	setDynamicString(out, "proxy_error_code", state.ProxyErrorCode)
	setDynamicString(out, "proxy_fallback", state.ProxyFallback)
	setDynamicBool(out, "proxy_bypassed", state.ProxyBypassed)
	setDynamicString(out, "debug_trace_id", state.DebugTraceID)
	setDynamicBool(out, "session_ready", state.SessionReady)
	setDynamicBool(out, "can_send", state.CanSend)
	setDynamicBool(out, "can_receive_runtime", state.CanReceiveRuntime)
	setDynamicBool(out, "authenticated", state.Authenticated)
	setDynamicString(out, "provider_state", state.ProviderState)
	setDynamicString(out, "degraded_reason", state.DegradedReason)
	setDynamicString(out, "last_probe_at", state.LastProbeAt)
	setDynamicInt32(out, "probe_latency_ms", int32(state.ProbeLatencyMS))
	setDynamicConnectionStatus(out, "connection_status", state.ConnectionStatus)
	setDynamicString(out, "connection_status_source_id", state.ConnectionStatusSourceID)
}

func (s *WorkerConnectionGRPCServer) SendPasskeyResponse(ctx context.Context, msg *dynamicpb.Message) (*dynamicpb.Message, error) {
	descs, err := getDescriptors()
	if err != nil {
		return nil, err
	}
	req := PasskeyResponseRequest{
		WorkerID:            dynamicString(msg, "worker_id"),
		AccountID:           dynamicString(msg, "account_id"),
		ConnectionAttemptID: dynamicString(msg, "connection_attempt_id"),
		PasskeyResponse:     dynamicString(msg, "passkey_response"),
		DebugTraceID:        dynamicString(msg, "debug_trace_id"),
	}
	startedAt := time.Now()
	s.debug.Log(ctx, "whatsmeow.grpc.passkey_response.received", map[string]any{
		"trace_id":              req.DebugTraceID,
		"layer":                 "worker_whatsmeow.grpc",
		"worker_id":             req.WorkerID,
		"account_id":            req.AccountID,
		"worker_type_id":        WorkerTypeWhatsmeow,
		"connection_attempt_id": req.ConnectionAttemptID,
		"grpc_method":           "SendPasskeyResponse",
		"passkey_response_len":  len(req.PasskeyResponse),
	})
	connectionFlowLog("whatsmeow.grpc.passkey_response.received", map[string]any{
		"trace_id":              req.DebugTraceID,
		"layer":                 "worker_whatsmeow.grpc",
		"worker_id":             req.WorkerID,
		"account_id":            req.AccountID,
		"worker_type_id":        WorkerTypeWhatsmeow,
		"connection_attempt_id": req.ConnectionAttemptID,
		"grpc_method":           "SendPasskeyResponse",
		"has_passkey_response":  req.PasskeyResponse != "",
		"passkey_response_len":  len(req.PasskeyResponse),
	})
	resp, err := s.handler.SendPasskeyResponse(ctx, req)
	if err != nil {
		errorCode := safeOperationalErrorCode(err)
		s.debug.Log(ctx, "whatsmeow.grpc.passkey_response.error", map[string]any{
			"trace_id":              req.DebugTraceID,
			"layer":                 "worker_whatsmeow.grpc",
			"worker_id":             req.WorkerID,
			"account_id":            req.AccountID,
			"worker_type_id":        WorkerTypeWhatsmeow,
			"connection_attempt_id": req.ConnectionAttemptID,
			"duration_ms":           time.Since(startedAt).Milliseconds(),
			"error_code":            errorCode,
		})
		connectionFlowLog("whatsmeow.grpc.passkey_response.error", map[string]any{
			"trace_id":              req.DebugTraceID,
			"layer":                 "worker_whatsmeow.grpc",
			"worker_id":             req.WorkerID,
			"account_id":            req.AccountID,
			"worker_type_id":        WorkerTypeWhatsmeow,
			"connection_attempt_id": req.ConnectionAttemptID,
			"duration_ms":           time.Since(startedAt).Milliseconds(),
			"reason":                errorCode,
		})
		return nil, err
	}
	if resp.ConnectionAttemptID == "" {
		resp.ConnectionAttemptID = req.ConnectionAttemptID
	}
	if resp.DebugTraceID == "" {
		resp.DebugTraceID = req.DebugTraceID
	}
	connectionFlowLog("whatsmeow.grpc.passkey_response.completed", map[string]any{
		"trace_id":                      resp.DebugTraceID,
		"layer":                         "worker_whatsmeow.grpc",
		"worker_id":                     resp.WorkerID,
		"account_id":                    resp.AccountID,
		"worker_type_id":                WorkerTypeWhatsmeow,
		"connection_attempt_id":         resp.ConnectionAttemptID,
		"status":                        resp.Status,
		"code":                          resp.Code,
		"reason":                        resp.Reason,
		"duration_ms":                   time.Since(startedAt).Milliseconds(),
		"has_passkey_public_key":        resp.PasskeyPublicKey != "",
		"has_passkey_confirmation_code": resp.PasskeyConfirmationCode != "",
	})
	out := newDynamicMessage(descs.workerConnectionResponse)
	setConnectionStateMessage(out, resp)
	return out, nil
}

func (s *WorkerConnectionGRPCServer) ConfirmPasskey(ctx context.Context, msg *dynamicpb.Message) (*dynamicpb.Message, error) {
	descs, err := getDescriptors()
	if err != nil {
		return nil, err
	}
	req := PasskeyConfirmationRequest{
		WorkerID:            dynamicString(msg, "worker_id"),
		AccountID:           dynamicString(msg, "account_id"),
		ConnectionAttemptID: dynamicString(msg, "connection_attempt_id"),
		DebugTraceID:        dynamicString(msg, "debug_trace_id"),
	}
	startedAt := time.Now()
	s.debug.Log(ctx, "whatsmeow.grpc.passkey_confirmation.received", map[string]any{
		"trace_id":              req.DebugTraceID,
		"layer":                 "worker_whatsmeow.grpc",
		"worker_id":             req.WorkerID,
		"account_id":            req.AccountID,
		"worker_type_id":        WorkerTypeWhatsmeow,
		"connection_attempt_id": req.ConnectionAttemptID,
		"grpc_method":           "ConfirmPasskey",
	})
	connectionFlowLog("whatsmeow.grpc.passkey_confirmation.received", map[string]any{
		"trace_id":              req.DebugTraceID,
		"layer":                 "worker_whatsmeow.grpc",
		"worker_id":             req.WorkerID,
		"account_id":            req.AccountID,
		"worker_type_id":        WorkerTypeWhatsmeow,
		"connection_attempt_id": req.ConnectionAttemptID,
		"grpc_method":           "ConfirmPasskey",
	})
	resp, err := s.handler.ConfirmPasskey(ctx, req)
	if err != nil {
		errorCode := safeOperationalErrorCode(err)
		s.debug.Log(ctx, "whatsmeow.grpc.passkey_confirmation.error", map[string]any{
			"trace_id":              req.DebugTraceID,
			"layer":                 "worker_whatsmeow.grpc",
			"worker_id":             req.WorkerID,
			"account_id":            req.AccountID,
			"worker_type_id":        WorkerTypeWhatsmeow,
			"connection_attempt_id": req.ConnectionAttemptID,
			"duration_ms":           time.Since(startedAt).Milliseconds(),
			"error_code":            errorCode,
		})
		connectionFlowLog("whatsmeow.grpc.passkey_confirmation.error", map[string]any{
			"trace_id":              req.DebugTraceID,
			"layer":                 "worker_whatsmeow.grpc",
			"worker_id":             req.WorkerID,
			"account_id":            req.AccountID,
			"worker_type_id":        WorkerTypeWhatsmeow,
			"connection_attempt_id": req.ConnectionAttemptID,
			"duration_ms":           time.Since(startedAt).Milliseconds(),
			"reason":                errorCode,
		})
		return nil, err
	}
	if resp.ConnectionAttemptID == "" {
		resp.ConnectionAttemptID = req.ConnectionAttemptID
	}
	if resp.DebugTraceID == "" {
		resp.DebugTraceID = req.DebugTraceID
	}
	connectionFlowLog("whatsmeow.grpc.passkey_confirmation.completed", map[string]any{
		"trace_id":                      resp.DebugTraceID,
		"layer":                         "worker_whatsmeow.grpc",
		"worker_id":                     resp.WorkerID,
		"account_id":                    resp.AccountID,
		"worker_type_id":                WorkerTypeWhatsmeow,
		"connection_attempt_id":         resp.ConnectionAttemptID,
		"status":                        resp.Status,
		"code":                          resp.Code,
		"reason":                        resp.Reason,
		"duration_ms":                   time.Since(startedAt).Milliseconds(),
		"has_passkey_public_key":        resp.PasskeyPublicKey != "",
		"has_passkey_confirmation_code": resp.PasskeyConfirmationCode != "",
	})
	out := newDynamicMessage(descs.workerConnectionResponse)
	setConnectionStateMessage(out, resp)
	return out, nil
}

func (s *WorkerConnectionGRPCServer) ImportSecureSession(ctx context.Context, msg *dynamicpb.Message) (*dynamicpb.Message, error) {
	descs, err := getDescriptors()
	if err != nil {
		return nil, err
	}
	req := SecureSessionImportRequest{
		WorkerID:            dynamicString(msg, "worker_id"),
		AccountID:           dynamicString(msg, "account_id"),
		WorkerTypeID:        dynamicString(msg, "worker_type_id"),
		ConnectionAttemptID: dynamicString(msg, "connection_attempt_id"),
		RuntimeGeneration:   int(dynamicInt32(msg, "runtime_generation")),
		FormatVersion:       dynamicString(msg, "format_version"),
		Source:              dynamicString(msg, "source"),
		TargetProvider:      dynamicString(msg, "target_provider"),
		PayloadRef:          dynamicString(msg, "payload_ref"),
		PayloadJSON:         dynamicString(msg, "payload_json"),
		Checksum:            dynamicString(msg, "checksum"),
		DebugTraceID:        dynamicString(msg, "debug_trace_id"),
	}
	startedAt := time.Now()
	connectionFlowLog("whatsmeow.grpc.secure_import.received", map[string]any{
		"trace_id":              req.DebugTraceID,
		"layer":                 "worker_whatsmeow.grpc",
		"worker_id":             req.WorkerID,
		"account_id":            req.AccountID,
		"worker_type_id":        WorkerTypeWhatsmeow,
		"connection_attempt_id": req.ConnectionAttemptID,
		"runtime_generation":    req.RuntimeGeneration,
		"format_version":        req.FormatVersion,
		"target_provider":       req.TargetProvider,
		"has_payload_ref":       req.PayloadRef != "",
		"has_payload_json":      req.PayloadJSON != "",
		"grpc_method":           "ImportSecureSession",
	})
	resp, err := s.handler.ImportSecureSession(ctx, req)
	if err != nil {
		errorCode := safeOperationalErrorCode(err)
		connectionFlowLog("whatsmeow.grpc.secure_import.error", map[string]any{
			"trace_id":              req.DebugTraceID,
			"layer":                 "worker_whatsmeow.grpc",
			"worker_id":             req.WorkerID,
			"account_id":            req.AccountID,
			"worker_type_id":        WorkerTypeWhatsmeow,
			"connection_attempt_id": req.ConnectionAttemptID,
			"duration_ms":           time.Since(startedAt).Milliseconds(),
			"reason":                errorCode,
		})
		return nil, err
	}
	if resp.ConnectionAttemptID == "" {
		resp.ConnectionAttemptID = req.ConnectionAttemptID
	}
	if resp.DebugTraceID == "" {
		resp.DebugTraceID = req.DebugTraceID
	}
	out := newDynamicMessage(descs.workerConnectionResponse)
	setConnectionStateMessage(out, resp)
	return out, nil
}

func (s *WorkerConnectionGRPCServer) ValidatePhone(ctx context.Context, msg *dynamicpb.Message) (*dynamicpb.Message, error) {
	descs, err := getDescriptors()
	if err != nil {
		return nil, err
	}
	req := PhoneValidationRequest{
		RequestID: dynamicString(msg, "request_id"),
		AccountID: dynamicString(msg, "account_id"),
		WorkerID:  dynamicString(msg, "worker_id"),
		Phone:     dynamicString(msg, "phone"),
		PhoneDDI:  dynamicString(msg, "phone_ddi"),
	}
	log.Printf("grpc ValidatePhone received worker_id=%s request_id=%s", req.WorkerID, req.RequestID)
	resp, err := s.handler.ValidatePhone(ctx, req)
	if err != nil {
		log.Printf("grpc ValidatePhone failed worker_id=%s request_id=%s error_code=%s", req.WorkerID, req.RequestID, safeOperationalErrorCode(err))
		return nil, err
	}
	out := newDynamicMessage(descs.connectionPhoneValidationResponse)
	setDynamicString(out, "request_id", resp.RequestID)
	setDynamicString(out, "account_id", resp.AccountID)
	setDynamicString(out, "worker_id", resp.WorkerID)
	setDynamicBool(out, "valid", resp.Valid)
	setDynamicString(out, "jid", resp.JID)
	setDynamicString(out, "phone", resp.Phone)
	setDynamicString(out, "error", resp.Error)
	return out, nil
}

func (s *WorkerConnectionGRPCServer) ActivateRuntime(ctx context.Context, msg *dynamicpb.Message) (*dynamicpb.Message, error) {
	descs, err := getDescriptors()
	if err != nil {
		return nil, err
	}
	req := WorkerRuntimeActivationRequest{
		WorkerID:          dynamicString(msg, "worker_id"),
		AccountID:         dynamicString(msg, "account_id"),
		WorkerTypeID:      dynamicString(msg, "worker_type_id"),
		WarmPoolID:        dynamicString(msg, "warm_pool_id"),
		SessionVolumeName: dynamicString(msg, "session_volume_name"),
		BalancerGRPCHost:  dynamicString(msg, "balancer_grpc_host"),
		BalancerGRPCPort:  int(dynamicInt32(msg, "balancer_grpc_port")),
		RuntimeGeneration: int(dynamicInt32(msg, "runtime_generation")),
		SessionStorage:    dynamicString(msg, "session_storage"),
		RuntimeCapability: dynamicString(msg, "runtime_capability"),
		WriterEpoch:       dynamicString(msg, "writer_epoch"),
	}
	log.Printf("grpc ActivateRuntime received worker_id=%s warm_pool_id=%s", req.WorkerID, req.WarmPoolID)
	resp, err := s.handler.ActivateRuntime(ctx, req)
	if err != nil {
		log.Printf("grpc ActivateRuntime failed worker_id=%s warm_pool_id=%s error_code=%s", req.WorkerID, req.WarmPoolID, safeOperationalErrorCode(err))
		return nil, err
	}
	out := newDynamicMessage(descs.workerRuntimeActivationResponse)
	setDynamicBool(out, "activated", resp.Activated)
	setDynamicBool(out, "already_active", resp.AlreadyActive)
	setDynamicString(out, "worker_id", resp.WorkerID)
	setDynamicString(out, "account_id", resp.AccountID)
	setDynamicString(out, "warm_pool_id", resp.WarmPoolID)
	setDynamicString(out, "error", resp.Error)
	return out, nil
}

func (s *WorkerConnectionGRPCServer) RuntimeHealth(ctx context.Context, msg *dynamicpb.Message) (*dynamicpb.Message, error) {
	descs, err := getDescriptors()
	if err != nil {
		return nil, err
	}
	req := WorkerRuntimeHealthRequest{
		WorkerID:   dynamicString(msg, "worker_id"),
		WarmPoolID: dynamicString(msg, "warm_pool_id"),
	}
	resp, err := s.handler.RuntimeHealth(ctx, req)
	if err != nil {
		log.Printf("grpc RuntimeHealth failed worker_id=%s warm_pool_id=%s error_code=%s", req.WorkerID, req.WarmPoolID, safeOperationalErrorCode(err))
		return nil, err
	}
	out := newDynamicMessage(descs.workerRuntimeHealthResponse)
	setDynamicBool(out, "ready", resp.Ready)
	setDynamicBool(out, "standby", resp.Standby)
	setDynamicBool(out, "activated", resp.Activated)
	setDynamicString(out, "worker_id", resp.WorkerID)
	setDynamicString(out, "account_id", resp.AccountID)
	setDynamicString(out, "warm_pool_id", resp.WarmPoolID)
	setDynamicBool(out, "has_session", resp.HasSession)
	setDynamicBool(out, "has_qr", resp.HasQR)
	setDynamicString(out, "worker_type_id", resp.WorkerTypeID)
	setDynamicInt32(out, "runtime_generation", int32(resp.RuntimeGeneration))
	setDynamicString(out, "runtime_state", resp.RuntimeState)
	setDynamicBool(out, "qr_stream_ready", resp.QRStreamReady)
	setDynamicBool(out, "session_ready", resp.SessionReady)
	setDynamicBool(out, "can_send", resp.CanSend)
	setDynamicBool(out, "can_receive_runtime", resp.CanReceiveRuntime)
	setDynamicBool(out, "authenticated", resp.Authenticated)
	setDynamicString(out, "provider_state", resp.ProviderState)
	setDynamicString(out, "degraded_reason", resp.DegradedReason)
	setDynamicString(out, "last_probe_at", resp.LastProbeAt)
	setDynamicInt32(out, "probe_latency_ms", int32(resp.ProbeLatencyMS))
	setDynamicString(out, "phone", resp.Phone)
	setDynamicBool(out, "kafka_unhealthy", resp.KafkaUnhealthy)
	setDynamicBool(out, "kafka_consumers_ready", resp.KafkaConsumersReady)
	setDynamicBool(out, "kafka_consumers_authorized", resp.KafkaConsumersAuthorized)
	setDynamicBool(out, "command_ingress_ready", resp.CommandIngressReady)
	setDynamicBool(out, "command_ingress_authorized", resp.CommandIngressAuthorized)
	setDynamicUint32(out, "runtime_health_schema_version", resp.RuntimeHealthSchemaVersion)
	setDynamicConnectionStatus(out, "connection_status", resp.ConnectionStatus)
	setDynamicString(out, "connection_status_source_id", resp.ConnectionStatusSourceID)
	setDynamicString(out, "session_storage", resp.SessionStorage)
	setDynamicInt64(out, "session_revision_id", resp.SessionRevisionID)
	setDynamicString(out, "session_storage_migration_id", resp.SessionStorageMigrationID)
	setDynamicString(out, "error", resp.Error)
	return out, nil
}

type dynamicWorkerConnectionService interface {
	RequestConnection(context.Context, *dynamicpb.Message) (*dynamicpb.Message, error)
	SendPasskeyResponse(context.Context, *dynamicpb.Message) (*dynamicpb.Message, error)
	ConfirmPasskey(context.Context, *dynamicpb.Message) (*dynamicpb.Message, error)
	ImportSecureSession(context.Context, *dynamicpb.Message) (*dynamicpb.Message, error)
	ValidatePhone(context.Context, *dynamicpb.Message) (*dynamicpb.Message, error)
	ActivateRuntime(context.Context, *dynamicpb.Message) (*dynamicpb.Message, error)
	RuntimeHealth(context.Context, *dynamicpb.Message) (*dynamicpb.Message, error)
	PrepareProviderHandoff(context.Context, *dynamicpb.Message) (*dynamicpb.Message, error)
	PrepareSessionStorageMigration(context.Context, *dynamicpb.Message) (*dynamicpb.Message, error)
}

func RegisterWorkerConnectionService(server *grpc.Server, service dynamicWorkerConnectionService) {
	server.RegisterService(&grpc.ServiceDesc{
		ServiceName: "worker_connection.WorkerConnection",
		HandlerType: (*dynamicWorkerConnectionService)(nil),
		Methods: []grpc.MethodDesc{
			{
				MethodName: "RequestConnection",
				Handler:    requestConnectionHandler,
			},
			{
				MethodName: "SendPasskeyResponse",
				Handler:    sendPasskeyResponseHandler,
			},
			{
				MethodName: "ConfirmPasskey",
				Handler:    confirmPasskeyHandler,
			},
			{
				MethodName: "ImportSecureSession",
				Handler:    importSecureSessionHandler,
			},
			{
				MethodName: "ValidatePhone",
				Handler:    validatePhoneHandler,
			},
			{
				MethodName: "ActivateRuntime",
				Handler:    activateRuntimeHandler,
			},
			{
				MethodName: "RuntimeHealth",
				Handler:    runtimeHealthHandler,
			},
			{
				MethodName: "PrepareProviderHandoff",
				Handler:    prepareProviderHandoffHandler,
			},
			{
				MethodName: "PrepareSessionStorageMigration",
				Handler:    prepareSessionStorageMigrationHandler,
			},
		},
		Streams:  []grpc.StreamDesc{},
		Metadata: "worker_connection.proto",
	}, service)
}

func requestConnectionHandler(srv any, ctx context.Context, dec func(any) error, interceptor grpc.UnaryServerInterceptor) (any, error) {
	descs, err := getDescriptors()
	if err != nil {
		return nil, err
	}
	in := newDynamicMessage(descs.statusConnectionRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(dynamicWorkerConnectionService).RequestConnection(ctx, in)
	}
	info := &grpc.UnaryServerInfo{
		Server:     srv,
		FullMethod: "/worker_connection.WorkerConnection/RequestConnection",
	}
	handler := func(ctx context.Context, req any) (any, error) {
		return srv.(dynamicWorkerConnectionService).RequestConnection(ctx, req.(*dynamicpb.Message))
	}
	return interceptor(ctx, in, info, handler)
}

func sendPasskeyResponseHandler(srv any, ctx context.Context, dec func(any) error, interceptor grpc.UnaryServerInterceptor) (any, error) {
	descs, err := getDescriptors()
	if err != nil {
		return nil, err
	}
	in := newDynamicMessage(descs.passkeyResponseRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(dynamicWorkerConnectionService).SendPasskeyResponse(ctx, in)
	}
	info := &grpc.UnaryServerInfo{
		Server:     srv,
		FullMethod: "/worker_connection.WorkerConnection/SendPasskeyResponse",
	}
	handler := func(ctx context.Context, req any) (any, error) {
		return srv.(dynamicWorkerConnectionService).SendPasskeyResponse(ctx, req.(*dynamicpb.Message))
	}
	return interceptor(ctx, in, info, handler)
}

func confirmPasskeyHandler(srv any, ctx context.Context, dec func(any) error, interceptor grpc.UnaryServerInterceptor) (any, error) {
	descs, err := getDescriptors()
	if err != nil {
		return nil, err
	}
	in := newDynamicMessage(descs.passkeyConfirmationRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(dynamicWorkerConnectionService).ConfirmPasskey(ctx, in)
	}
	info := &grpc.UnaryServerInfo{
		Server:     srv,
		FullMethod: "/worker_connection.WorkerConnection/ConfirmPasskey",
	}
	handler := func(ctx context.Context, req any) (any, error) {
		return srv.(dynamicWorkerConnectionService).ConfirmPasskey(ctx, req.(*dynamicpb.Message))
	}
	return interceptor(ctx, in, info, handler)
}

func importSecureSessionHandler(srv any, ctx context.Context, dec func(any) error, interceptor grpc.UnaryServerInterceptor) (any, error) {
	descs, err := getDescriptors()
	if err != nil {
		return nil, err
	}
	in := newDynamicMessage(descs.secureSessionImportRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(dynamicWorkerConnectionService).ImportSecureSession(ctx, in)
	}
	info := &grpc.UnaryServerInfo{
		Server:     srv,
		FullMethod: "/worker_connection.WorkerConnection/ImportSecureSession",
	}
	handler := func(ctx context.Context, req any) (any, error) {
		return srv.(dynamicWorkerConnectionService).ImportSecureSession(ctx, req.(*dynamicpb.Message))
	}
	return interceptor(ctx, in, info, handler)
}

func validatePhoneHandler(srv any, ctx context.Context, dec func(any) error, interceptor grpc.UnaryServerInterceptor) (any, error) {
	descs, err := getDescriptors()
	if err != nil {
		return nil, err
	}
	in := newDynamicMessage(descs.connectionPhoneValidationRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(dynamicWorkerConnectionService).ValidatePhone(ctx, in)
	}
	info := &grpc.UnaryServerInfo{
		Server:     srv,
		FullMethod: "/worker_connection.WorkerConnection/ValidatePhone",
	}
	handler := func(ctx context.Context, req any) (any, error) {
		return srv.(dynamicWorkerConnectionService).ValidatePhone(ctx, req.(*dynamicpb.Message))
	}
	return interceptor(ctx, in, info, handler)
}

func activateRuntimeHandler(srv any, ctx context.Context, dec func(any) error, interceptor grpc.UnaryServerInterceptor) (any, error) {
	descs, err := getDescriptors()
	if err != nil {
		return nil, err
	}
	in := newDynamicMessage(descs.workerRuntimeActivationRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(dynamicWorkerConnectionService).ActivateRuntime(ctx, in)
	}
	info := &grpc.UnaryServerInfo{
		Server:     srv,
		FullMethod: "/worker_connection.WorkerConnection/ActivateRuntime",
	}
	handler := func(ctx context.Context, req any) (any, error) {
		return srv.(dynamicWorkerConnectionService).ActivateRuntime(ctx, req.(*dynamicpb.Message))
	}
	return interceptor(ctx, in, info, handler)
}

func runtimeHealthHandler(srv any, ctx context.Context, dec func(any) error, interceptor grpc.UnaryServerInterceptor) (any, error) {
	descs, err := getDescriptors()
	if err != nil {
		return nil, err
	}
	in := newDynamicMessage(descs.workerRuntimeHealthRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(dynamicWorkerConnectionService).RuntimeHealth(ctx, in)
	}
	info := &grpc.UnaryServerInfo{
		Server:     srv,
		FullMethod: "/worker_connection.WorkerConnection/RuntimeHealth",
	}
	handler := func(ctx context.Context, req any) (any, error) {
		return srv.(dynamicWorkerConnectionService).RuntimeHealth(ctx, req.(*dynamicpb.Message))
	}
	return interceptor(ctx, in, info, handler)
}

func prepareProviderHandoffHandler(srv any, ctx context.Context, dec func(any) error, interceptor grpc.UnaryServerInterceptor) (any, error) {
	descs, err := getDescriptors()
	if err != nil {
		return nil, err
	}
	in := newDynamicMessage(descs.providerHandoffPrepareRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(dynamicWorkerConnectionService).PrepareProviderHandoff(ctx, in)
	}
	info := &grpc.UnaryServerInfo{
		Server:     srv,
		FullMethod: "/worker_connection.WorkerConnection/PrepareProviderHandoff",
	}
	handler := func(ctx context.Context, req any) (any, error) {
		return srv.(dynamicWorkerConnectionService).PrepareProviderHandoff(ctx, req.(*dynamicpb.Message))
	}
	return interceptor(ctx, in, info, handler)
}

func prepareSessionStorageMigrationHandler(srv any, ctx context.Context, dec func(any) error, interceptor grpc.UnaryServerInterceptor) (any, error) {
	descs, err := getDescriptors()
	if err != nil {
		return nil, err
	}
	in := newDynamicMessage(descs.sessionStorageMigrationPrepareRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(dynamicWorkerConnectionService).PrepareSessionStorageMigration(ctx, in)
	}
	info := &grpc.UnaryServerInfo{
		Server:     srv,
		FullMethod: "/worker_connection.WorkerConnection/PrepareSessionStorageMigration",
	}
	handler := func(ctx context.Context, req any) (any, error) {
		return srv.(dynamicWorkerConnectionService).PrepareSessionStorageMigration(ctx, req.(*dynamicpb.Message))
	}
	return interceptor(ctx, in, info, handler)
}
