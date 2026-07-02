package app

import (
	"context"
	"fmt"
	"log"
	"net"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/protobuf/types/dynamicpb"
)

type WorkerConnectionHandler interface {
	RequestConnection(context.Context, StatusConnectionRequest) (ConnectionState, error)
	SendPasskeyResponse(context.Context, PasskeyResponseRequest) (ConnectionState, error)
	ConfirmPasskey(context.Context, PasskeyConfirmationRequest) (ConnectionState, error)
	ValidatePhone(context.Context, PhoneValidationRequest) (PhoneValidationResponse, error)
	ActivateRuntime(context.Context, WorkerRuntimeActivationRequest) (WorkerRuntimeActivationResponse, error)
	RuntimeHealth(context.Context, WorkerRuntimeHealthRequest) (WorkerRuntimeHealthResponse, error)
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
		WorkerID:            dynamicString(msg, "worker_id"),
		Status:              dynamicString(msg, "status"),
		Type:                dynamicString(msg, "type"),
		PhoneConnection:     dynamicString(msg, "phone_connection"),
		RemoveSession:       dynamicBool(msg, "remove_session"),
		ConnectionAttemptID: dynamicString(msg, "connection_attempt_id"),
		RuntimeGeneration:   int(dynamicInt32(msg, "runtime_generation")),
		WarmPoolID:          dynamicString(msg, "warm_pool_id"),
		DebugTraceID:        dynamicString(msg, "debug_trace_id"),
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
		"phone_connection_set":  req.PhoneConnection != "",
		"grpc_method":           "RequestConnection",
		"warm_pool_id":          req.WarmPoolID,
	})
	log.Printf(
		"grpc RequestConnection received worker_id=%s status=%s type=%s remove_session=%t phone_connection_set=%t",
		req.WorkerID,
		req.Status,
		req.Type,
		req.RemoveSession,
		req.PhoneConnection != "",
	)
	resp, err := s.handler.RequestConnection(ctx, req)
	if err != nil {
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
			"error":                 err.Error(),
		})
		log.Printf("grpc RequestConnection failed worker_id=%s type=%s error=%v", req.WorkerID, req.Type, err)
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
		"qrcode":                        resp.QRCode,
		"pairing_code":                  resp.PairingCode,
		"has_passkey_public_key":        resp.PasskeyPublicKey != "",
		"has_passkey_confirmation_code": resp.PasskeyConfirmationCode != "",
	})
	log.Printf("grpc RequestConnection completed worker_id=%s type=%s has_qr=%t", req.WorkerID, req.Type, resp.QRCode != "")
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
	resp, err := s.handler.SendPasskeyResponse(ctx, req)
	if err != nil {
		s.debug.Log(ctx, "whatsmeow.grpc.passkey_response.error", map[string]any{
			"trace_id":              req.DebugTraceID,
			"layer":                 "worker_whatsmeow.grpc",
			"worker_id":             req.WorkerID,
			"account_id":            req.AccountID,
			"worker_type_id":        WorkerTypeWhatsmeow,
			"connection_attempt_id": req.ConnectionAttemptID,
			"duration_ms":           time.Since(startedAt).Milliseconds(),
			"error":                 err.Error(),
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
	resp, err := s.handler.ConfirmPasskey(ctx, req)
	if err != nil {
		s.debug.Log(ctx, "whatsmeow.grpc.passkey_confirmation.error", map[string]any{
			"trace_id":              req.DebugTraceID,
			"layer":                 "worker_whatsmeow.grpc",
			"worker_id":             req.WorkerID,
			"account_id":            req.AccountID,
			"worker_type_id":        WorkerTypeWhatsmeow,
			"connection_attempt_id": req.ConnectionAttemptID,
			"duration_ms":           time.Since(startedAt).Milliseconds(),
			"error":                 err.Error(),
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
		log.Printf("grpc ValidatePhone failed worker_id=%s request_id=%s error=%v", req.WorkerID, req.RequestID, err)
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
	}
	log.Printf("grpc ActivateRuntime received worker_id=%s warm_pool_id=%s", req.WorkerID, req.WarmPoolID)
	resp, err := s.handler.ActivateRuntime(ctx, req)
	if err != nil {
		log.Printf("grpc ActivateRuntime failed worker_id=%s warm_pool_id=%s error=%v", req.WorkerID, req.WarmPoolID, err)
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
		log.Printf("grpc RuntimeHealth failed worker_id=%s warm_pool_id=%s error=%v", req.WorkerID, req.WarmPoolID, err)
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
	setDynamicString(out, "error", resp.Error)
	return out, nil
}

type dynamicWorkerConnectionService interface {
	RequestConnection(context.Context, *dynamicpb.Message) (*dynamicpb.Message, error)
	SendPasskeyResponse(context.Context, *dynamicpb.Message) (*dynamicpb.Message, error)
	ConfirmPasskey(context.Context, *dynamicpb.Message) (*dynamicpb.Message, error)
	ValidatePhone(context.Context, *dynamicpb.Message) (*dynamicpb.Message, error)
	ActivateRuntime(context.Context, *dynamicpb.Message) (*dynamicpb.Message, error)
	RuntimeHealth(context.Context, *dynamicpb.Message) (*dynamicpb.Message, error)
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

type BalanceGRPCClient struct {
	cfg   Config
	debug *ConnectionLifecycleDebugLogger
}

func NewBalanceGRPCClient(cfg Config, debugLoggers ...*ConnectionLifecycleDebugLogger) *BalanceGRPCClient {
	var debug *ConnectionLifecycleDebugLogger
	if len(debugLoggers) > 0 {
		debug = debugLoggers[0]
	}
	return &BalanceGRPCClient{cfg: cfg, debug: debug}
}

func (c *BalanceGRPCClient) dial(ctx context.Context) (*grpc.ClientConn, error) {
	return grpc.DialContext(ctx, c.cfg.BalanceGRPCAddress(), grpc.WithTransportCredentials(insecure.NewCredentials()), grpc.WithBlock())
}

func (c *BalanceGRPCClient) NotifyWorkerStatus(ctx context.Context, state ConnectionState) error {
	descs, err := getDescriptors()
	if err != nil {
		return err
	}
	req := newDynamicMessage(descs.commandNotifyWorkerStatus)
	setConnectionStateMessage(req, state)

	startedAt := time.Now()
	c.debug.Log(ctx, "whatsmeow.balance.notify_status.call", map[string]any{
		"trace_id":              state.DebugTraceID,
		"layer":                 "worker_whatsmeow.balance_grpc",
		"worker_id":             state.WorkerID,
		"account_id":            state.AccountID,
		"worker_type_id":        WorkerTypeWhatsmeow,
		"connection_attempt_id": state.ConnectionAttemptID,
		"runtime_generation":    state.RuntimeGeneration,
		"status":                state.Status,
		"code":                  state.Code,
		"qrcode":                state.QRCode,
		"pairing_code":          state.PairingCode,
	})
	err = c.invoke(ctx, "/worker_command.WorkerCommand/NotifyWorkerStatus", req, newDynamicMessage(descs.commandResponse))
	if err != nil {
		c.debug.Log(ctx, "whatsmeow.balance.notify_status.error", map[string]any{
			"trace_id":              state.DebugTraceID,
			"layer":                 "worker_whatsmeow.balance_grpc",
			"worker_id":             state.WorkerID,
			"account_id":            state.AccountID,
			"worker_type_id":        WorkerTypeWhatsmeow,
			"connection_attempt_id": state.ConnectionAttemptID,
			"runtime_generation":    state.RuntimeGeneration,
			"status":                state.Status,
			"code":                  state.Code,
			"duration_ms":           time.Since(startedAt).Milliseconds(),
			"error":                 err.Error(),
		})
		return err
	}
	c.debug.Log(ctx, "whatsmeow.balance.notify_status.ok", map[string]any{
		"trace_id":              state.DebugTraceID,
		"layer":                 "worker_whatsmeow.balance_grpc",
		"worker_id":             state.WorkerID,
		"account_id":            state.AccountID,
		"worker_type_id":        WorkerTypeWhatsmeow,
		"connection_attempt_id": state.ConnectionAttemptID,
		"runtime_generation":    state.RuntimeGeneration,
		"status":                state.Status,
		"code":                  state.Code,
		"duration_ms":           time.Since(startedAt).Milliseconds(),
	})
	return nil
}

func (c *BalanceGRPCClient) RequestWorkerSelfHealing(ctx context.Context, payload SelfHealingRequest) error {
	descs, err := getDescriptors()
	if err != nil {
		return err
	}
	req := newDynamicMessage(descs.commandSelfHealingReq)
	setDynamicString(req, "worker_id", payload.WorkerID)
	setDynamicString(req, "account_id", payload.AccountID)
	setDynamicString(req, "worker_type_id", payload.WorkerTypeID)
	setDynamicString(req, "source", payload.Source)
	setDynamicString(req, "reason", payload.Reason)
	setDynamicString(req, "provider_state", payload.ProviderState)
	setDynamicString(req, "degraded_reason", payload.DegradedReason)
	setDynamicBool(req, "kafka_unhealthy", payload.KafkaUnhealthy)
	setDynamicInt32(req, "runtime_generation", int32(payload.RuntimeGeneration))
	setDynamicString(req, "debug_trace_id", payload.DebugTraceID)
	setDynamicInt32(req, "recovery_window_seconds", int32(payload.RecoveryWindowSeconds))

	return c.invoke(ctx, "/worker_command.WorkerCommand/RequestWorkerSelfHealing", req, newDynamicMessage(descs.commandResponse))
}

func (c *BalanceGRPCClient) RegisterS3BackupFallbackUpload(ctx context.Context, payload S3BackupFallbackUpload) error {
	descs, err := getDescriptors()
	if err != nil {
		return err
	}
	req := newDynamicMessage(descs.commandRegisterS3BackupFallback)
	setDynamicString(req, "account_id", payload.AccountID)
	setDynamicString(req, "bucket", payload.Bucket)
	setDynamicString(req, "object_key", payload.ObjectKey)
	setDynamicString(req, "file_name", payload.FileName)
	setDynamicString(req, "content_type", payload.ContentType)
	setDynamicInt64(req, "size_bytes", payload.SizeBytes)
	setDynamicInt32(req, "primary_attempts", payload.PrimaryAttempts)
	setDynamicInt32(req, "backup_attempts", payload.BackupAttempts)
	setDynamicString(req, "primary_error", payload.PrimaryError)
	setDynamicString(req, "backup_error", payload.BackupError)

	return c.invoke(ctx, "/worker_command.WorkerCommand/RegisterS3BackupFallbackUpload", req, newDynamicMessage(descs.commandResponse))
}

func (c *BalanceGRPCClient) ResolveIncomingCallAction(ctx context.Context, workerID, accountID, callJID, callPhone string, isVideo bool) (bool, bool, string, error) {
	descs, err := getDescriptors()
	if err != nil {
		return false, false, "", err
	}
	req := newDynamicMessage(descs.commandResolveIncomingCallReq)
	setDynamicString(req, "worker_id", workerID)
	setDynamicString(req, "account_id", accountID)
	setDynamicString(req, "call_jid", callJID)
	setDynamicString(req, "call_phone", callPhone)
	setDynamicBool(req, "is_video", isVideo)

	resp := newDynamicMessage(descs.commandResolveIncomingCallResp)
	if err := c.invoke(ctx, "/worker_command.WorkerCommand/ResolveIncomingCallAction", req, resp); err != nil {
		return false, false, "", err
	}
	return dynamicBool(resp, "reject_call"), dynamicBool(resp, "show_message_on_call"), dynamicString(resp, "show_message_text"), nil
}

func (c *BalanceGRPCClient) GetTypingSimulationConfig(ctx context.Context, workerID, accountID string) (TypingSimulationConfig, error) {
	descs, err := getDescriptors()
	if err != nil {
		return defaultTypingSimulationConfig(), err
	}
	req := newDynamicMessage(descs.commandTypingSimulationReq)
	setDynamicString(req, "worker_id", workerID)
	setDynamicString(req, "account_id", accountID)

	resp := newDynamicMessage(descs.commandTypingSimulationResp)
	if err := c.invoke(ctx, "/worker_command.WorkerCommand/GetTypingSimulationConfig", req, resp); err != nil {
		return defaultTypingSimulationConfig(), err
	}

	return normalizeTypingSimulationConfig(TypingSimulationConfig{
		Enabled: dynamicBool(resp, "enabled"),
		Speed:   int(dynamicInt32(resp, "speed")),
	}), nil
}

func (c *BalanceGRPCClient) invoke(ctx context.Context, method string, req *dynamicpb.Message, resp *dynamicpb.Message) error {
	callCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	conn, err := c.dial(callCtx)
	if err != nil {
		return err
	}
	defer conn.Close()
	return conn.Invoke(callCtx, method, req, resp)
}
