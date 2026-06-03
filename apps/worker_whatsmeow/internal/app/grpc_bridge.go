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
	ValidatePhone(context.Context, PhoneValidationRequest) (PhoneValidationResponse, error)
}

type WorkerConnectionGRPCServer struct {
	handler WorkerConnectionHandler
	server  *grpc.Server
	addr    string
	cfg     Config
}

func NewWorkerConnectionGRPCServer(addr string, handler WorkerConnectionHandler, cfg Config) (*WorkerConnectionGRPCServer, error) {
	if _, err := getDescriptors(); err != nil {
		return nil, err
	}
	return &WorkerConnectionGRPCServer{
		handler: handler,
		server:  grpc.NewServer(),
		addr:    addr,
		cfg:     cfg,
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
	}
	ctx = extractIncomingConnectionLifecycleContext(ctx, s.cfg, req, "request_connection")
	lifecycle, _ := connectionLifecycleFromContext(ctx)
	ctx, finishLifecycleSpan := startConnectionLifecycleSpan(ctx, s.cfg, lifecycle)
	var finalErr error
	defer func() {
		finishLifecycleSpan(finalErr)
	}()
	recordConnectionLifecycle(ctx, s.cfg, map[string]any{
		"stage":                    "connection.whatsmeow.grpc.request_received",
		"decision":                 "request_connection",
		"outcome":                  "received",
		"grpc_method":              "RequestConnection",
		"status":                   req.Status,
		"connection_type":          req.Type,
		"remove_session":           req.RemoveSession,
		"has_phone_connection":     req.PhoneConnection != "",
		"has_connection_metadata":  incomingConnectionLifecycleID(ctx) != "",
		"connection_metadata_type": "grpc",
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
		finalErr = err
		recordConnectionLifecycle(ctx, s.cfg, map[string]any{
			"stage":           "connection.whatsmeow.grpc.request_error",
			"decision":        "request_connection",
			"outcome":         "error",
			"reason":          "handler_error",
			"level":           "error",
			"grpc_method":     "RequestConnection",
			"status":          req.Status,
			"connection_type": req.Type,
			"error":           err.Error(),
		})
		log.Printf("grpc RequestConnection failed worker_id=%s type=%s error=%v", req.WorkerID, req.Type, err)
		return nil, err
	}
	if resp.ConnectionAttemptID == "" {
		resp.ConnectionAttemptID = req.ConnectionAttemptID
	}
	recordConnectionLifecycle(ctx, s.cfg, map[string]any{
		"stage":            "connection.whatsmeow.grpc.request_success",
		"decision":         "request_connection",
		"outcome":          "success",
		"grpc_method":      "RequestConnection",
		"status":           resp.Status,
		"code":             resp.Code,
		"worker_status_id": resp.WorkerStatusID,
		"qrcode":           resp.QRCode,
		"pairing_code":     resp.PairingCode,
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
	setDynamicString(out, "qrcode", state.QRCode)
	setDynamicBool(out, "is_new_login", state.IsNewLogin)
	setDynamicInt64(out, "time", state.Time)
	setDynamicString(out, "phone", state.Phone)
	setDynamicBool(out, "disconnected_user", state.DisconnectedUser)
	setDynamicString(out, "pairing_code", state.PairingCode)
	setDynamicInt32(out, "seconds_until_next_attempt", int32(state.SecondsUntilNextAttempt))
	setDynamicString(out, "worker_status_id", state.WorkerStatusID)
	setDynamicInt32(out, "attempt", int32(state.Attempt))
	setDynamicInt32(out, "max_attempts", int32(state.MaxAttempts))
	setDynamicString(out, "connection_attempt_id", state.ConnectionAttemptID)
	setDynamicBool(out, "qr_pending", state.QRPending)
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

type dynamicWorkerConnectionService interface {
	RequestConnection(context.Context, *dynamicpb.Message) (*dynamicpb.Message, error)
	ValidatePhone(context.Context, *dynamicpb.Message) (*dynamicpb.Message, error)
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
				MethodName: "ValidatePhone",
				Handler:    validatePhoneHandler,
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

type BalanceGRPCClient struct {
	cfg Config
}

func NewBalanceGRPCClient(cfg Config) *BalanceGRPCClient {
	return &BalanceGRPCClient{cfg: cfg}
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
	setDynamicString(req, "worker_id", state.WorkerID)
	setDynamicString(req, "account_id", state.AccountID)
	setDynamicString(req, "worker_status_id", state.WorkerStatusID)
	setDynamicString(req, "phone", state.Phone)
	setDynamicBool(req, "disconnected_user", state.DisconnectedUser)

	recordConnectionLifecycle(ctx, c.cfg, map[string]any{
		"stage":             "connection.whatsmeow.balance.notify_start",
		"decision":          "notify_worker_status",
		"outcome":           "started",
		"grpc_method":       "NotifyWorkerStatus",
		"grpc_address":      c.cfg.BalanceGRPCAddress(),
		"account_id":        state.AccountID,
		"worker_id":         state.WorkerID,
		"status":            state.Status,
		"code":              state.Code,
		"worker_status_id":  state.WorkerStatusID,
		"disconnected_user": state.DisconnectedUser,
	})
	err = c.invoke(ctx, "/worker_command.WorkerCommand/NotifyWorkerStatus", req, newDynamicMessage(descs.commandResponse))
	if err != nil {
		recordConnectionLifecycle(ctx, c.cfg, map[string]any{
			"stage":            "connection.whatsmeow.balance.notify_error",
			"decision":         "notify_worker_status",
			"outcome":          "error",
			"reason":           "grpc_error",
			"level":            "error",
			"grpc_method":      "NotifyWorkerStatus",
			"grpc_address":     c.cfg.BalanceGRPCAddress(),
			"account_id":       state.AccountID,
			"worker_id":        state.WorkerID,
			"status":           state.Status,
			"code":             state.Code,
			"worker_status_id": state.WorkerStatusID,
			"error":            err.Error(),
		})
		return err
	}
	recordConnectionLifecycle(ctx, c.cfg, map[string]any{
		"stage":            "connection.whatsmeow.balance.notify_success",
		"decision":         "notify_worker_status",
		"outcome":          "success",
		"grpc_method":      "NotifyWorkerStatus",
		"grpc_address":     c.cfg.BalanceGRPCAddress(),
		"account_id":       state.AccountID,
		"worker_id":        state.WorkerID,
		"status":           state.Status,
		"code":             state.Code,
		"worker_status_id": state.WorkerStatusID,
	})
	return nil
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
	callCtx = injectOutgoingConnectionLifecycleContext(callCtx)
	return conn.Invoke(callCtx, method, req, resp)
}
