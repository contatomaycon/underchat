package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/segmentio/kafka-go"
	"go.mau.fi/whatsmeow/types"
)

type Worker struct {
	cfg            Config
	kafka          *KafkaClient
	redis          *redis.Client
	centrifugo     *CentrifugoClient
	balance        *BalanceGRPCClient
	storage        *StorageClient
	whatsapp       *WhatsAppManager
	grpcServer     *WorkerConnectionGRPCServer
	debug          *ConnectionLifecycleDebugLogger
	httpServer     *http.Server
	cancel         context.CancelFunc
	shutdown       sync.Once
	runtimeMu      sync.RWMutex
	runCtx         context.Context
	runtimeStarted bool
}

const (
	connectionQRCodeCacheTTL = 115 * time.Second
	connectionQRCodeMaxAge   = 120 * time.Second
)

func NewWorker(ctx context.Context, cfg Config) (*Worker, error) {
	log.Printf("initializing kafka client brokers=%s protocol=%s", strings.Join(cfg.KafkaBrokers, ","), cfg.KafkaProtocol)
	kafkaClient, err := NewKafkaClient(cfg)
	if err != nil {
		return nil, err
	}
	log.Printf("initializing redis client addr=%s:%d", cfg.RedisHost, cfg.RedisPort)
	redisClient := redis.NewClient(&redis.Options{
		Addr:     cfg.RedisHost + ":" + strconv.Itoa(cfg.RedisPort),
		Password: cfg.RedisPassword,
	})
	debug := NewConnectionLifecycleDebugLogger(cfg.ConnectionLifecycleDebugEnabled, redisClient)
	centrifugo := NewCentrifugoClient(cfg)
	balance := NewBalanceGRPCClient(cfg, debug)
	storage, err := NewStorageClient(cfg, balance)
	if err != nil {
		return nil, err
	}
	whatsApp, err := NewWhatsAppManager(ctx, cfg, kafkaClient, centrifugo, balance, storage, redisClient, debug)
	if err != nil {
		return nil, err
	}
	worker := &Worker{
		cfg:        cfg,
		kafka:      kafkaClient,
		redis:      redisClient,
		centrifugo: centrifugo,
		balance:    balance,
		storage:    storage,
		whatsapp:   whatsApp,
		debug:      debug,
	}
	grpcServer, err := NewWorkerConnectionGRPCServer(cfg.GRPCAddr, worker, cfg, debug)
	if err != nil {
		return nil, err
	}
	worker.grpcServer = grpcServer
	return worker, nil
}

func (w *Worker) Run(ctx context.Context) error {
	runCtx, cancel := context.WithCancel(ctx)
	w.cancel = cancel
	w.runCtx = runCtx

	log.Printf("worker run starting worker_id=%s", w.cfg.WorkerID)
	if err := w.startHTTP(); err != nil {
		return err
	}
	if err := w.grpcServer.Start(); err != nil {
		return err
	}
	if w.cfg.WarmStandby {
		log.Printf("worker warm standby ready warm_pool_id=%s worker_id=%s", w.cfg.WarmPoolID, w.cfg.WorkerID)
		<-runCtx.Done()
		log.Printf("worker warm standby stopping worker_id=%s reason=%v", w.cfg.WorkerID, runCtx.Err())
		return runCtx.Err()
	}
	if err := w.startActivatedRuntime(runCtx); err != nil {
		return err
	}
	log.Printf("worker run ready worker_id=%s", w.cfg.WorkerID)

	<-runCtx.Done()
	log.Printf("worker run stopping worker_id=%s reason=%v", w.cfg.WorkerID, runCtx.Err())
	return runCtx.Err()
}

func (w *Worker) Shutdown(ctx context.Context) error {
	var err error
	w.shutdown.Do(func() {
		if w.cancel != nil {
			w.cancel()
		}
		if w.grpcServer != nil {
			w.grpcServer.Stop()
		}
		if w.httpServer != nil {
			if shutdownErr := w.httpServer.Shutdown(ctx); shutdownErr != nil && err == nil {
				err = shutdownErr
			}
		}
		if w.kafka != nil {
			if closeErr := w.kafka.Close(); closeErr != nil && err == nil {
				err = closeErr
			}
		}
		if w.redis != nil {
			if closeErr := w.redis.Close(); closeErr != nil && err == nil {
				err = closeErr
			}
		}
	})
	return err
}

func (w *Worker) startHTTP() error {
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/health/check", func(resp http.ResponseWriter, req *http.Request) {
		writeJSON(resp, http.StatusOK, map[string]any{"status": "ok", "provider": "whatsmeow"})
	})
	mux.HandleFunc("/v1/connection/health/check", func(resp http.ResponseWriter, req *http.Request) {
		manager := w.currentWhatsApp()
		health := map[string]any{
			"ready":               false,
			"connected":           false,
			"session_ready":       false,
			"can_send":            false,
			"can_receive_runtime": false,
			"authenticated":       false,
			"provider":            "whatsmeow",
			"provider_state":      "not_initialized",
			"degraded_reason":     "runtime_not_initialized",
			"error":               "runtime_not_initialized",
		}
		if manager != nil {
			health = manager.ConnectionHealth()
		}
		health["kafka_consumers"] = w.kafka.ConsumerHealthSnapshot()
		health["kafka_consumer_summary"] = w.kafka.ConsumerHealthSummary()
		kafkaUnhealthy := w.kafka.HasUnhealthyConsumers()
		health["kafka_unhealthy"] = kafkaUnhealthy
		failOnKafkaUnhealthy := w.cfg.ConnectionHealthFailOnKafkaUnhealthy
		localConnectionStatusLog("whatsmeow.http.connection_health", map[string]any{
			"layer":                   "worker_whatsmeow.http",
			"provider":                "whatsmeow",
			"worker_id":               w.cfg.WorkerID,
			"account_id":              w.cfg.AccountID,
			"worker_type_id":          WorkerTypeWhatsmeow,
			"session_ready":           healthBool(health, "session_ready"),
			"can_send":                healthBool(health, "can_send"),
			"can_receive_runtime":     healthBool(health, "can_receive_runtime"),
			"authenticated":           healthBool(health, "authenticated"),
			"provider_state":          healthString(health, "provider_state"),
			"degraded_reason":         healthString(health, "degraded_reason"),
			"connected":               healthBool(health, "connected"),
			"phone":                   healthString(health, "phone"),
			"kafka_unhealthy":         kafkaUnhealthy,
			"fail_on_kafka_unhealthy": failOnKafkaUnhealthy,
			"runtime_generation":      w.cfg.RuntimeGeneration,
		})
		if ready, _ := health["session_ready"].(bool); ready && (!kafkaUnhealthy || !failOnKafkaUnhealthy) {
			writeJSON(resp, http.StatusOK, health)
			return
		}
		writeJSON(resp, http.StatusServiceUnavailable, health)
	})
	w.httpServer = &http.Server{
		Addr:              w.cfg.HTTPAddr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}
	go func() {
		if err := w.httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("http server stopped: %v", err)
		}
	}()
	log.Printf("http server listening addr=%s", w.cfg.HTTPAddr)
	return nil
}

func (w *Worker) currentWhatsApp() *WhatsAppManager {
	w.runtimeMu.RLock()
	defer w.runtimeMu.RUnlock()
	return w.whatsapp
}

func (w *Worker) startActivatedRuntime(ctx context.Context) error {
	w.runtimeMu.Lock()
	defer w.runtimeMu.Unlock()
	return w.startActivatedRuntimeLocked(ctx)
}

func (w *Worker) startActivatedRuntimeLocked(ctx context.Context) error {
	if w.runtimeStarted {
		return nil
	}
	if w.whatsapp == nil {
		return fmt.Errorf("whatsmeow runtime is not initialized")
	}
	w.whatsapp.Bootstrap(ctx)
	if err := w.startConnectionQRCodeRedisStream(ctx); err != nil {
		return err
	}
	w.runtimeStarted = true
	go func() {
		if err := w.startConsumers(ctx); err != nil {
			log.Printf("whatsmeow kafka consumers async start failed worker_id=%s error=%v", w.cfg.WorkerID, err)
		}
	}()
	go w.startSelfMonitor(ctx)
	return nil
}

func (w *Worker) RequestConnection(ctx context.Context, req StatusConnectionRequest) (ConnectionState, error) {
	manager := w.currentWhatsApp()
	if manager == nil {
		return ConnectionState{}, fmt.Errorf("whatsmeow runtime is not initialized")
	}
	return manager.RequestConnection(ctx, req)
}

func (w *Worker) SendPasskeyResponse(ctx context.Context, req PasskeyResponseRequest) (ConnectionState, error) {
	manager := w.currentWhatsApp()
	if manager == nil {
		return ConnectionState{}, fmt.Errorf("whatsmeow runtime is not initialized")
	}
	return manager.SendPasskeyResponse(ctx, req)
}

func (w *Worker) ConfirmPasskey(ctx context.Context, req PasskeyConfirmationRequest) (ConnectionState, error) {
	manager := w.currentWhatsApp()
	if manager == nil {
		return ConnectionState{}, fmt.Errorf("whatsmeow runtime is not initialized")
	}
	return manager.ConfirmPasskey(ctx, req)
}

func (w *Worker) ImportSecureSession(ctx context.Context, req SecureSessionImportRequest) (ConnectionState, error) {
	w.runtimeMu.Lock()
	manager := w.whatsapp
	if req.RuntimeGeneration > 0 && w.cfg.RuntimeGeneration != req.RuntimeGeneration {
		w.cfg.RuntimeGeneration = req.RuntimeGeneration
	}
	w.runtimeMu.Unlock()

	if manager == nil {
		return ConnectionState{}, fmt.Errorf("whatsmeow runtime is not initialized")
	}
	return manager.ImportSecureSession(ctx, req)
}

func (w *Worker) ValidatePhone(ctx context.Context, req PhoneValidationRequest) (PhoneValidationResponse, error) {
	manager := w.currentWhatsApp()
	if manager == nil {
		return PhoneValidationResponse{}, fmt.Errorf("whatsmeow runtime is not initialized")
	}
	return manager.ValidatePhone(ctx, req)
}

func (w *Worker) ActivateRuntime(ctx context.Context, req WorkerRuntimeActivationRequest) (WorkerRuntimeActivationResponse, error) {
	if req.WorkerID == "" || req.AccountID == "" {
		return WorkerRuntimeActivationResponse{
			Activated:  false,
			WorkerID:   req.WorkerID,
			AccountID:  req.AccountID,
			WarmPoolID: req.WarmPoolID,
			Error:      "worker_id and account_id are required",
		}, fmt.Errorf("worker_id and account_id are required")
	}

	w.runtimeMu.Lock()
	defer w.runtimeMu.Unlock()

	if w.runtimeStarted {
		if w.cfg.WorkerID == req.WorkerID && w.cfg.AccountID == req.AccountID {
			return WorkerRuntimeActivationResponse{
				Activated:     true,
				AlreadyActive: true,
				WorkerID:      w.cfg.WorkerID,
				AccountID:     w.cfg.AccountID,
				WarmPoolID:    firstNonEmpty(req.WarmPoolID, w.cfg.WarmPoolID),
			}, nil
		}
		err := fmt.Errorf("runtime already activated for worker_id=%s", w.cfg.WorkerID)
		return WorkerRuntimeActivationResponse{
			Activated:  false,
			WorkerID:   req.WorkerID,
			AccountID:  req.AccountID,
			WarmPoolID: req.WarmPoolID,
			Error:      err.Error(),
		}, err
	}

	nextCfg := w.cfg
	nextCfg.WorkerID = req.WorkerID
	nextCfg.AccountID = req.AccountID
	nextCfg.RuntimeGeneration = req.RuntimeGeneration
	nextCfg.WarmStandby = false
	if req.WarmPoolID != "" {
		nextCfg.WarmPoolID = req.WarmPoolID
	}
	if req.BalancerGRPCHost != "" {
		nextCfg.BalanceGRPCHost = req.BalancerGRPCHost
	}
	if req.BalancerGRPCPort > 0 {
		nextCfg.BalanceGRPCPort = req.BalancerGRPCPort
	}

	runtimeCtx := w.runCtx
	if runtimeCtx == nil {
		runtimeCtx = context.Background()
	}
	balance := NewBalanceGRPCClient(nextCfg, w.debug)
	storage, err := NewStorageClient(nextCfg, balance)
	if err != nil {
		return WorkerRuntimeActivationResponse{
			Activated:  false,
			WorkerID:   req.WorkerID,
			AccountID:  req.AccountID,
			WarmPoolID: req.WarmPoolID,
			Error:      err.Error(),
		}, err
	}
	whatsApp, err := NewWhatsAppManager(runtimeCtx, nextCfg, w.kafka, w.centrifugo, balance, storage, w.redis, w.debug)
	if err != nil {
		return WorkerRuntimeActivationResponse{
			Activated:  false,
			WorkerID:   req.WorkerID,
			AccountID:  req.AccountID,
			WarmPoolID: req.WarmPoolID,
			Error:      err.Error(),
		}, err
	}

	w.cfg = nextCfg
	w.balance = balance
	w.storage = storage
	w.whatsapp = whatsApp
	if err := w.startActivatedRuntimeLocked(runtimeCtx); err != nil {
		return WorkerRuntimeActivationResponse{
			Activated:  false,
			WorkerID:   req.WorkerID,
			AccountID:  req.AccountID,
			WarmPoolID: req.WarmPoolID,
			Error:      err.Error(),
		}, err
	}

	log.Printf("worker runtime activated worker_id=%s account_id=%s warm_pool_id=%s", req.WorkerID, req.AccountID, req.WarmPoolID)
	return WorkerRuntimeActivationResponse{
		Activated:  true,
		WorkerID:   req.WorkerID,
		AccountID:  req.AccountID,
		WarmPoolID: req.WarmPoolID,
	}, nil
}

func (w *Worker) RuntimeHealth(ctx context.Context, req WorkerRuntimeHealthRequest) (WorkerRuntimeHealthResponse, error) {
	w.runtimeMu.RLock()
	defer w.runtimeMu.RUnlock()
	standby := w.cfg.WarmStandby && !w.runtimeStarted
	qrStreamReady := w.runtimeStarted
	ready := w.whatsapp != nil && (standby || qrStreamReady)
	runtimeState := "inactive"
	if standby {
		runtimeState = "warm_standby"
	} else if w.runtimeStarted {
		runtimeState = "active"
	} else if w.whatsapp != nil {
		runtimeState = "activating"
	}
	hasSession := false
	hasQR := false
	sessionReady := false
	canSend := false
	canReceiveRuntime := false
	authenticated := false
	providerState := ""
	degradedReason := ""
	lastProbeAt := ""
	probeLatencyMS := 0
	phone := ""
	kafkaUnhealthy := w.kafka != nil && w.kafka.HasUnhealthyConsumers()
	if w.whatsapp != nil {
		health := w.whatsapp.ConnectionHealth()
		if value, ok := health["has_store_id"].(bool); ok {
			hasSession = value
		}
		sessionReady = healthBool(health, "session_ready")
		canSend = healthBool(health, "can_send")
		canReceiveRuntime = healthBool(health, "can_receive_runtime")
		authenticated = healthBool(health, "authenticated")
		providerState = healthString(health, "provider_state")
		degradedReason = healthString(health, "degraded_reason")
		lastProbeAt = healthString(health, "last_probe_at")
		probeLatencyMS = healthInt(health, "probe_latency_ms")
		phone = healthString(health, "phone")
		if phone == "" {
			w.whatsapp.mu.RLock()
			if w.whatsapp.client != nil && w.whatsapp.client.Store.ID != nil {
				phone = phoneFromOwnID(w.whatsapp.client.Store.ID)
			}
			w.whatsapp.mu.RUnlock()
		}
		w.whatsapp.mu.RLock()
		hasQR = w.whatsapp.currentQRCode != ""
		w.whatsapp.mu.RUnlock()
	}
	response := WorkerRuntimeHealthResponse{
		Ready:             ready,
		Standby:           standby,
		Activated:         w.runtimeStarted,
		WorkerID:          w.cfg.WorkerID,
		AccountID:         w.cfg.AccountID,
		WarmPoolID:        firstNonEmpty(req.WarmPoolID, w.cfg.WarmPoolID),
		HasSession:        hasSession,
		HasQR:             hasQR,
		WorkerTypeID:      WorkerTypeWhatsmeow,
		RuntimeGeneration: w.cfg.RuntimeGeneration,
		RuntimeState:      runtimeState,
		QRStreamReady:     qrStreamReady,
		SessionReady:      sessionReady,
		CanSend:           canSend,
		CanReceiveRuntime: canReceiveRuntime,
		Authenticated:     authenticated,
		ProviderState:     providerState,
		DegradedReason:    degradedReason,
		LastProbeAt:       lastProbeAt,
		ProbeLatencyMS:    probeLatencyMS,
		Phone:             phone,
		KafkaUnhealthy:    kafkaUnhealthy,
	}
	localConnectionStatusLog("whatsmeow.grpc.runtime_health", map[string]any{
		"layer":                "worker_whatsmeow.grpc",
		"provider":             "whatsmeow",
		"worker_id":            response.WorkerID,
		"account_id":           response.AccountID,
		"worker_type_id":       response.WorkerTypeID,
		"session_ready":        response.SessionReady,
		"can_send":             response.CanSend,
		"can_receive_runtime":  response.CanReceiveRuntime,
		"authenticated":        response.Authenticated,
		"provider_state":       response.ProviderState,
		"degraded_reason":      response.DegradedReason,
		"runtime_generation":   response.RuntimeGeneration,
		"runtime_state":        response.RuntimeState,
		"ready":                response.Ready,
		"activated":            response.Activated,
		"standby":              response.Standby,
		"has_session":          response.HasSession,
		"has_qr":               response.HasQR,
		"qr_stream_ready":      response.QRStreamReady,
		"phone":                response.Phone,
		"kafka_unhealthy":      response.KafkaUnhealthy,
		"request_worker_id":    req.WorkerID,
		"request_warm_pool_id": req.WarmPoolID,
	})
	return response, nil
}

func writeJSON(resp http.ResponseWriter, status int, payload any) {
	resp.Header().Set("Content-Type", "application/json")
	resp.WriteHeader(status)
	_ = json.NewEncoder(resp).Encode(payload)
}

func (w *Worker) startConsumers(ctx context.Context) error {
	workerID := w.cfg.WorkerID
	workerTopicConfig := KafkaTopicConfig{Partitions: 1, ReplicationFactor: 2}
	globalTopicConfig := KafkaTopicConfig{Partitions: 30, ReplicationFactor: 3}
	topics := []struct {
		name   string
		config KafkaTopicConfig
	}{
		{topicWorkerSendMessage(workerID), workerTopicConfig},
		{topicWorkerScheduleSend(workerID), workerTopicConfig},
		{topicWorkerValidatePhone(workerID), workerTopicConfig},
		{topicWorkerNotification(workerID), workerTopicConfig},
		{topicWorkerWebhook(workerID), workerTopicConfig},
		{topicMarkMessageRead, globalTopicConfig},
		{topicWorkerConfigUpdate, globalTopicConfig},
	}
	for _, topic := range topics {
		if err := w.kafka.EnsureTopic(ctx, topic.name, topic.config.Partitions, topic.config.ReplicationFactor); err != nil {
			log.Printf("failed to ensure kafka topic %s: %v", topic.name, err)
		} else {
			log.Printf("kafka topic ready topic=%s partitions=%d replication_factor=%d", topic.name, topic.config.Partitions, topic.config.ReplicationFactor)
		}
	}

	consumers := []struct {
		topic  string
		group  string
		config KafkaTopicConfig
		fn     KafkaMessageHandler
	}{
		{topicWorkerSendMessage(workerID), "group-underchat-whatsmeow-send-" + workerID, workerTopicConfig, w.handleSendMessage},
		{topicWorkerScheduleSend(workerID), "group-underchat-schedule-message-whatsmeow-" + workerID, workerTopicConfig, w.handleScheduleSend},
		{topicWorkerValidatePhone(workerID), "group-underchat-whatsmeow-validate-phone-" + workerID, workerTopicConfig, w.handlePhoneValidation},
		{topicWorkerNotification(workerID), "group-underchat-whatsmeow-notification-send-" + workerID, workerTopicConfig, w.handleNotification},
		{topicWorkerWebhook(workerID), "group-underchat-webhook-integration-whatsmeow-" + workerID, workerTopicConfig, w.handleWebhookIntegration},
		{topicMarkMessageRead, "group-underchat-mark-read-whatsmeow-" + workerID, globalTopicConfig, w.handleMarkRead},
		{topicWorkerConfigUpdate, "group-underchat-worker-config-update-whatsmeow-" + workerID, globalTopicConfig, w.handleWorkerConfigUpdate},
	}
	for _, consumer := range consumers {
		if err := w.kafka.StartConsumer(ctx, consumer.topic, consumer.group, consumer.config, consumer.fn); err != nil {
			return err
		}
		log.Printf("kafka consumer started topic=%s group=%s partitions=%d replication_factor=%d", consumer.topic, consumer.group, consumer.config.Partitions, consumer.config.ReplicationFactor)
		time.Sleep(500 * time.Millisecond)
	}
	return nil
}

func (w *Worker) connectionQRCodeRedisStreamKey(workerID string) string {
	return "connection:qrcode:" + WorkerTypeWhatsmeow + ":" + workerID + ":requests"
}

func (w *Worker) connectionQRCodeRedisStreamGroup(workerID string) string {
	return "connection:qrcode:" + WorkerTypeWhatsmeow + ":" + workerID + ":group"
}

func (w *Worker) connectionQRCodeRedisStreamConsumer(workerID string) string {
	return "whatsmeow:" + workerID
}

func (w *Worker) startConnectionQRCodeRedisStream(ctx context.Context) error {
	if w.redis == nil {
		return fmt.Errorf("redis client is required for connection QR stream")
	}
	streamKey := w.connectionQRCodeRedisStreamKey(w.cfg.WorkerID)
	groupID := w.connectionQRCodeRedisStreamGroup(w.cfg.WorkerID)
	consumerName := w.connectionQRCodeRedisStreamConsumer(w.cfg.WorkerID)

	err := w.redis.XGroupCreateMkStream(ctx, streamKey, groupID, "0").Err()
	if err != nil && !strings.Contains(err.Error(), "BUSYGROUP") {
		w.debug.Log(ctx, "whatsmeow.redis_qr.group_ensure.error", map[string]any{
			"layer":          "worker_whatsmeow.redis_qr",
			"worker_id":      w.cfg.WorkerID,
			"account_id":     w.cfg.AccountID,
			"worker_type_id": WorkerTypeWhatsmeow,
			"stream_key":     streamKey,
			"group_id":       groupID,
			"error":          err.Error(),
		})
		return err
	}
	w.debug.Log(ctx, "whatsmeow.redis_qr.group_ensured", map[string]any{
		"layer":          "worker_whatsmeow.redis_qr",
		"worker_id":      w.cfg.WorkerID,
		"account_id":     w.cfg.AccountID,
		"worker_type_id": WorkerTypeWhatsmeow,
		"stream_key":     streamKey,
		"group_id":       groupID,
		"consumer":       consumerName,
	})

	go w.consumeConnectionQRCodeRedisStream(ctx, streamKey, groupID, consumerName)
	return nil
}

func (w *Worker) consumeConnectionQRCodeRedisStream(ctx context.Context, streamKey, groupID, consumerName string) {
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		claimed, _, err := w.redis.XAutoClaim(ctx, &redis.XAutoClaimArgs{
			Stream:   streamKey,
			Group:    groupID,
			Consumer: consumerName,
			MinIdle:  3 * time.Second,
			Start:    "0-0",
			Count:    10,
		}).Result()
		if err != nil && !errors.Is(err, redis.Nil) {
			w.logConnectionQRCodeRedisReadError(ctx, streamKey, groupID, consumerName, err)
			time.Sleep(time.Second)
			continue
		}
		if len(claimed) > 0 {
			w.processConnectionQRCodeRedisMessages(ctx, streamKey, groupID, consumerName, claimed, true)
			continue
		}

		streams, err := w.redis.XReadGroup(ctx, &redis.XReadGroupArgs{
			Group:    groupID,
			Consumer: consumerName,
			Streams:  []string{streamKey, ">"},
			Count:    10,
			Block:    time.Second,
		}).Result()
		if errors.Is(err, redis.Nil) {
			continue
		}
		if err != nil {
			w.logConnectionQRCodeRedisReadError(ctx, streamKey, groupID, consumerName, err)
			time.Sleep(time.Second)
			continue
		}
		for _, stream := range streams {
			w.processConnectionQRCodeRedisMessages(ctx, streamKey, groupID, consumerName, stream.Messages, false)
		}
	}
}

func (w *Worker) processConnectionQRCodeRedisMessages(ctx context.Context, streamKey, groupID, consumerName string, messages []redis.XMessage, reclaimed bool) {
	for _, message := range messages {
		ack, err := w.handleConnectionQRCodeRedisMessage(ctx, streamKey, groupID, consumerName, message, reclaimed)
		if err != nil {
			continue
		}
		if ack {
			w.ackDeleteConnectionQRCodeRedisMessage(ctx, streamKey, groupID, consumerName, message.ID)
		}
	}
}

func (w *Worker) handleConnectionQRCodeRedisMessage(ctx context.Context, streamKey, groupID, consumerName string, message redis.XMessage, reclaimed bool) (ack bool, err error) {
	data, err := workerConnectionQRCodeQueueMessageFromRedis(message)
	if err != nil {
		w.debug.Log(ctx, "whatsmeow.redis_qr.invalid_payload", map[string]any{
			"layer":          "worker_whatsmeow.redis_qr",
			"worker_id":      w.cfg.WorkerID,
			"account_id":     w.cfg.AccountID,
			"worker_type_id": WorkerTypeWhatsmeow,
			"stream_key":     streamKey,
			"group_id":       groupID,
			"consumer":       consumerName,
			"stream_id":      message.ID,
			"error":          err.Error(),
		})
		return true, nil
	}
	w.debug.Log(ctx, "whatsmeow.redis_qr.received", map[string]any{
		"trace_id":              data.DebugTraceID,
		"layer":                 "worker_whatsmeow.redis_qr",
		"worker_id":             data.WorkerID,
		"account_id":            data.AccountID,
		"worker_type_id":        data.WorkerTypeID,
		"connection_attempt_id": data.ConnectionAttemptID,
		"runtime_generation":    data.RuntimeGeneration,
		"request_id":            data.RequestID,
		"stream_key":            streamKey,
		"group_id":              groupID,
		"consumer":              consumerName,
		"stream_id":             message.ID,
		"reclaimed":             reclaimed,
		"delivery_count":        w.connectionQRCodeRedisDeliveryCount(ctx, streamKey, groupID, message.ID),
		"queue_latency_ms":      connectionQRCodeQueueLatencyMS(data.RequestedAt),
	})

	req := StatusConnectionRequest{
		WorkerID:            data.WorkerID,
		Status:              WorkerStatusOnline,
		Type:                "qrcode",
		ConnectionAttemptID: data.ConnectionAttemptID,
		RuntimeGeneration:   data.RuntimeGeneration,
		DebugTraceID:        data.DebugTraceID,
	}

	if data.WorkerID != w.cfg.WorkerID || data.AccountID != w.cfg.AccountID || data.WorkerTypeID != WorkerTypeWhatsmeow {
		w.debug.Log(ctx, "whatsmeow.redis_qr.skipped_wrong_worker", map[string]any{
			"trace_id":              data.DebugTraceID,
			"layer":                 "worker_whatsmeow.redis_qr",
			"worker_id":             data.WorkerID,
			"account_id":            data.AccountID,
			"worker_type_id":        data.WorkerTypeID,
			"connection_attempt_id": data.ConnectionAttemptID,
			"runtime_generation":    data.RuntimeGeneration,
			"expected_worker_id":    w.cfg.WorkerID,
			"expected_account_id":   w.cfg.AccountID,
			"expected_worker_type":  WorkerTypeWhatsmeow,
		})
		return true, nil
	}

	w.debug.Log(ctx, "whatsmeow.redis_qr.active_check.start", map[string]any{
		"trace_id":              data.DebugTraceID,
		"layer":                 "worker_whatsmeow.redis_qr",
		"worker_id":             data.WorkerID,
		"account_id":            data.AccountID,
		"worker_type_id":        data.WorkerTypeID,
		"connection_attempt_id": data.ConnectionAttemptID,
		"runtime_generation":    data.RuntimeGeneration,
	})
	active, activeErr := w.isActiveConnectionQRCodeAttempt(ctx, data)
	if activeErr != nil {
		err = activeErr
		w.debug.Log(ctx, "whatsmeow.redis_qr.active_check.error", map[string]any{
			"trace_id":              data.DebugTraceID,
			"layer":                 "worker_whatsmeow.redis_qr",
			"worker_id":             data.WorkerID,
			"account_id":            data.AccountID,
			"worker_type_id":        data.WorkerTypeID,
			"connection_attempt_id": data.ConnectionAttemptID,
			"runtime_generation":    data.RuntimeGeneration,
			"error":                 activeErr.Error(),
		})
		return false, activeErr
	}
	if !active {
		w.debug.Log(ctx, "whatsmeow.redis_qr.skipped_inactive_attempt", map[string]any{
			"trace_id":              data.DebugTraceID,
			"layer":                 "worker_whatsmeow.redis_qr",
			"worker_id":             data.WorkerID,
			"account_id":            data.AccountID,
			"worker_type_id":        data.WorkerTypeID,
			"connection_attempt_id": data.ConnectionAttemptID,
			"runtime_generation":    data.RuntimeGeneration,
		})
		return true, nil
	}
	w.debug.Log(ctx, "whatsmeow.redis_qr.active_check.ok", map[string]any{
		"trace_id":              data.DebugTraceID,
		"layer":                 "worker_whatsmeow.redis_qr",
		"worker_id":             data.WorkerID,
		"account_id":            data.AccountID,
		"worker_type_id":        data.WorkerTypeID,
		"connection_attempt_id": data.ConnectionAttemptID,
		"runtime_generation":    data.RuntimeGeneration,
	})

	startedAt := time.Now()
	w.debug.Log(ctx, "whatsmeow.redis_qr.request_connection.start", map[string]any{
		"trace_id":              data.DebugTraceID,
		"layer":                 "worker_whatsmeow.redis_qr",
		"worker_id":             data.WorkerID,
		"account_id":            data.AccountID,
		"worker_type_id":        data.WorkerTypeID,
		"connection_attempt_id": data.ConnectionAttemptID,
		"runtime_generation":    data.RuntimeGeneration,
	})
	state, err := w.RequestConnection(ctx, req)
	if err != nil {
		w.debug.Log(ctx, "whatsmeow.redis_qr.request_connection.error", map[string]any{
			"trace_id":              data.DebugTraceID,
			"layer":                 "worker_whatsmeow.redis_qr",
			"worker_id":             data.WorkerID,
			"account_id":            data.AccountID,
			"worker_type_id":        data.WorkerTypeID,
			"connection_attempt_id": data.ConnectionAttemptID,
			"runtime_generation":    data.RuntimeGeneration,
			"duration_ms":           time.Since(startedAt).Milliseconds(),
			"error":                 err.Error(),
		})
		return false, err
	}
	w.debug.Log(ctx, "whatsmeow.redis_qr.request_connection.response", map[string]any{
		"trace_id":              firstNonEmpty(state.DebugTraceID, data.DebugTraceID),
		"layer":                 "worker_whatsmeow.redis_qr",
		"worker_id":             state.WorkerID,
		"account_id":            state.AccountID,
		"worker_type_id":        WorkerTypeWhatsmeow,
		"connection_attempt_id": firstNonEmpty(state.ConnectionAttemptID, data.ConnectionAttemptID),
		"runtime_generation":    firstNonZero(state.RuntimeGeneration, data.RuntimeGeneration),
		"status":                state.Status,
		"code":                  state.Code,
		"duration_ms":           time.Since(startedAt).Milliseconds(),
		"qrcode":                state.QRCode,
		"pairing_code":          state.PairingCode,
	})
	w.cacheConnectionQRCodeAttemptState(ctx, state, data)
	if !connectionQRCodeRequestComplete(state) {
		w.debug.Log(ctx, "whatsmeow.redis_qr.not_complete", map[string]any{
			"trace_id":              firstNonEmpty(state.DebugTraceID, data.DebugTraceID),
			"layer":                 "worker_whatsmeow.redis_qr",
			"worker_id":             data.WorkerID,
			"account_id":            data.AccountID,
			"worker_type_id":        data.WorkerTypeID,
			"connection_attempt_id": data.ConnectionAttemptID,
			"runtime_generation":    data.RuntimeGeneration,
			"status":                state.Status,
			"code":                  state.Code,
		})
		return false, nil
	}
	if err = w.markConnectionQRCodeAttemptProcessed(ctx, data); err != nil {
		w.debug.Log(ctx, "whatsmeow.redis_qr.mark_processed.error", map[string]any{
			"trace_id":              data.DebugTraceID,
			"layer":                 "worker_whatsmeow.redis_qr",
			"worker_id":             data.WorkerID,
			"account_id":            data.AccountID,
			"worker_type_id":        data.WorkerTypeID,
			"connection_attempt_id": data.ConnectionAttemptID,
			"runtime_generation":    data.RuntimeGeneration,
			"error":                 err.Error(),
		})
		return false, err
	}
	return true, nil
}

func connectionQRCodeRequestComplete(state ConnectionState) bool {
	if state.QRCode != "" || state.PairingCode != "" || state.PasskeyPublicKey != "" || state.PasskeyConfirmationCode != "" {
		return true
	}
	if state.Status == "connected" {
		return true
	}
	return state.Status == "disconnected" && state.MaxAttempts > 0 && state.Attempt > state.MaxAttempts
}

func workerConnectionQRCodeQueueMessageFromRedis(message redis.XMessage) (WorkerConnectionQRCodeQueueMessage, error) {
	data := WorkerConnectionQRCodeQueueMessage{
		RequestID:           redisStreamString(message.Values, "request_id"),
		ConnectionAttemptID: redisStreamString(message.Values, "connection_attempt_id"),
		WorkerID:            redisStreamString(message.Values, "worker_id"),
		AccountID:           redisStreamString(message.Values, "account_id"),
		WorkerTypeID:        redisStreamString(message.Values, "worker_type_id"),
		RuntimeGeneration:   redisStreamInt(message.Values, "runtime_generation"),
		Source:              redisStreamString(message.Values, "source"),
		RequestedAt:         redisStreamString(message.Values, "requested_at"),
		ExpiresAt:           redisStreamString(message.Values, "expires_at"),
		DebugTraceID:        redisStreamString(message.Values, "debug_trace_id"),
	}
	if data.RequestID == "" || data.ConnectionAttemptID == "" || data.WorkerID == "" || data.AccountID == "" || data.WorkerTypeID == "" || data.RequestedAt == "" {
		return data, fmt.Errorf("missing required redis stream fields")
	}
	return data, nil
}

func redisStreamString(values map[string]interface{}, key string) string {
	value, ok := values[key]
	if !ok || value == nil {
		return ""
	}
	switch typed := value.(type) {
	case string:
		return typed
	case []byte:
		return string(typed)
	default:
		return fmt.Sprint(typed)
	}
}

func redisStreamInt(values map[string]interface{}, key string) int {
	raw := strings.TrimSpace(redisStreamString(values, key))
	if raw == "" {
		return 0
	}
	parsed, err := strconv.Atoi(raw)
	if err != nil {
		return 0
	}
	return parsed
}

func connectionQRCodeQueueLatencyMS(requestedAt string) int64 {
	parsed, err := time.Parse(time.RFC3339Nano, requestedAt)
	if err != nil {
		return 0
	}
	return time.Since(parsed).Milliseconds()
}

func (w *Worker) connectionQRCodeRedisDeliveryCount(ctx context.Context, streamKey, groupID, streamID string) int64 {
	pending, err := w.redis.XPendingExt(ctx, &redis.XPendingExtArgs{
		Stream: streamKey,
		Group:  groupID,
		Start:  streamID,
		End:    streamID,
		Count:  1,
	}).Result()
	if err != nil || len(pending) == 0 {
		return 0
	}
	return pending[0].RetryCount
}

func (w *Worker) ackDeleteConnectionQRCodeRedisMessage(ctx context.Context, streamKey, groupID, consumerName, streamID string) {
	_, ackErr := w.redis.XAck(ctx, streamKey, groupID, streamID).Result()
	_, deleteErr := w.redis.XDel(ctx, streamKey, streamID).Result()
	if ackErr != nil || deleteErr != nil {
		w.debug.Log(ctx, "whatsmeow.redis_qr.ack_delete.error", map[string]any{
			"layer":      "worker_whatsmeow.redis_qr",
			"worker_id":  w.cfg.WorkerID,
			"account_id": w.cfg.AccountID,
			"stream_key": streamKey,
			"group_id":   groupID,
			"consumer":   consumerName,
			"stream_id":  streamID,
			"ack_error":  fmt.Sprint(ackErr),
			"del_error":  fmt.Sprint(deleteErr),
		})
		return
	}
	w.debug.Log(ctx, "whatsmeow.redis_qr.ack_deleted", map[string]any{
		"layer":      "worker_whatsmeow.redis_qr",
		"worker_id":  w.cfg.WorkerID,
		"account_id": w.cfg.AccountID,
		"stream_key": streamKey,
		"group_id":   groupID,
		"consumer":   consumerName,
		"stream_id":  streamID,
	})
}

func (w *Worker) logConnectionQRCodeRedisReadError(ctx context.Context, streamKey, groupID, consumerName string, err error) {
	w.debug.Log(ctx, "whatsmeow.redis_qr.read_error", map[string]any{
		"layer":      "worker_whatsmeow.redis_qr",
		"worker_id":  w.cfg.WorkerID,
		"account_id": w.cfg.AccountID,
		"stream_key": streamKey,
		"group_id":   groupID,
		"consumer":   consumerName,
		"error":      err.Error(),
	})
}

type activeConnectionQRCodeAttemptEnvelope struct {
	WorkerTypeID      string `json:"worker_type_id"`
	RuntimeGeneration int    `json:"runtime_generation"`
	Ack               struct {
		ConnectionAttemptID string `json:"connection_attempt_id"`
		WorkerTypeID        string `json:"worker_type_id"`
		RuntimeGeneration   int    `json:"runtime_generation"`
	} `json:"ack"`
}

func (w *Worker) activeConnectionQRCodeAttemptKey(workerID string) string {
	return "connection:qrcode:" + WorkerTypeWhatsmeow + ":" + workerID + ":active_attempt"
}

func (w *Worker) connectionQRCodeAttemptCacheKey(workerID string) string {
	return "connection:qrcode:" + WorkerTypeWhatsmeow + ":" + workerID + ":attempt"
}

func (w *Worker) processedConnectionQRCodeAttemptKey(data WorkerConnectionQRCodeQueueMessage) string {
	return "connection:qrcode:" + data.WorkerTypeID + ":" + data.WorkerID + ":processed:" + data.ConnectionAttemptID
}

func (w *Worker) isActiveConnectionQRCodeAttempt(ctx context.Context, data WorkerConnectionQRCodeQueueMessage) (bool, error) {
	if w.redis == nil {
		return true, nil
	}
	processed, err := w.redis.Get(ctx, w.processedConnectionQRCodeAttemptKey(data)).Result()
	if err != nil && !errors.Is(err, redis.Nil) {
		return false, err
	}
	if processed != "" {
		return false, nil
	}

	raw, err := w.redis.Get(ctx, w.activeConnectionQRCodeAttemptKey(data.WorkerID)).Result()
	if errors.Is(err, redis.Nil) {
		return false, nil
	}
	if err != nil {
		return false, err
	}

	var envelope activeConnectionQRCodeAttemptEnvelope
	if err := json.Unmarshal([]byte(raw), &envelope); err != nil {
		return false, nil
	}

	activeWorkerTypeID := firstNonEmpty(envelope.WorkerTypeID, envelope.Ack.WorkerTypeID)
	if activeWorkerTypeID != "" && activeWorkerTypeID != data.WorkerTypeID {
		return false, nil
	}

	activeRuntimeGeneration := envelope.RuntimeGeneration
	if activeRuntimeGeneration == 0 {
		activeRuntimeGeneration = envelope.Ack.RuntimeGeneration
	}
	if data.RuntimeGeneration != 0 && activeRuntimeGeneration == 0 {
		return false, nil
	}
	if activeRuntimeGeneration != 0 && activeRuntimeGeneration != data.RuntimeGeneration {
		return false, nil
	}

	return envelope.Ack.ConnectionAttemptID == data.ConnectionAttemptID, nil
}

func (w *Worker) cacheConnectionQRCodeAttemptState(ctx context.Context, state ConnectionState, data WorkerConnectionQRCodeQueueMessage) {
	if w.redis == nil || (state.QRCode == "" && state.PairingCode == "" && state.PasskeyPublicKey == "" && state.PasskeyConfirmationCode == "") {
		return
	}

	normalized := state
	if normalized.WorkerID == "" {
		normalized.WorkerID = data.WorkerID
	}
	if normalized.AccountID == "" {
		normalized.AccountID = data.AccountID
	}
	normalized.WorkerTypeID = WorkerTypeWhatsmeow
	if normalized.DebugTraceID == "" {
		normalized.DebugTraceID = data.DebugTraceID
	}
	if normalized.RuntimeGeneration == 0 {
		normalized.RuntimeGeneration = data.RuntimeGeneration
	}
	if normalized.ConnectionAttemptID == "" {
		normalized.ConnectionAttemptID = data.ConnectionAttemptID
	}
	if normalized.QRGeneratedAt == "" {
		normalized.QRGeneratedAt = time.Now().UTC().Format(time.RFC3339Nano)
	}
	if normalized.ExpiresAt == "" {
		if generatedAt, err := time.Parse(time.RFC3339Nano, normalized.QRGeneratedAt); err == nil {
			normalized.ExpiresAt = generatedAt.Add(connectionQRCodeMaxAge).UTC().Format(time.RFC3339Nano)
		}
	}
	normalized.QRPending = false

	ttl := connectionQRCodeCacheTTLForState(normalized)
	payload, err := json.Marshal(normalized)
	if err != nil {
		return
	}

	if err := w.redis.Set(ctx, w.connectionQRCodeAttemptCacheKey(normalized.WorkerID), string(payload), ttl).Err(); err != nil {
		w.debug.Log(ctx, "whatsmeow.redis_qr.cache_state.error", map[string]any{
			"trace_id":              normalized.DebugTraceID,
			"layer":                 "worker_whatsmeow.redis_qr",
			"worker_id":             normalized.WorkerID,
			"account_id":            normalized.AccountID,
			"worker_type_id":        normalized.WorkerTypeID,
			"connection_attempt_id": normalized.ConnectionAttemptID,
			"runtime_generation":    normalized.RuntimeGeneration,
			"status":                normalized.Status,
			"code":                  normalized.Code,
			"error":                 err.Error(),
		})
		return
	}
	w.debug.Log(ctx, "whatsmeow.redis_qr.cache_state.saved", map[string]any{
		"trace_id":                      normalized.DebugTraceID,
		"layer":                         "worker_whatsmeow.redis_qr",
		"worker_id":                     normalized.WorkerID,
		"account_id":                    normalized.AccountID,
		"worker_type_id":                normalized.WorkerTypeID,
		"connection_attempt_id":         normalized.ConnectionAttemptID,
		"runtime_generation":            normalized.RuntimeGeneration,
		"status":                        normalized.Status,
		"code":                          normalized.Code,
		"ttl_ms":                        ttl.Milliseconds(),
		"qrcode":                        normalized.QRCode,
		"pairing_code":                  normalized.PairingCode,
		"has_passkey_public_key":        normalized.PasskeyPublicKey != "",
		"passkey_public_key_len":        len(normalized.PasskeyPublicKey),
		"has_passkey_confirmation_code": normalized.PasskeyConfirmationCode != "",
	})

}

func connectionQRCodeCacheTTLForState(state ConnectionState) time.Duration {
	if state.QRCode == "" || state.QRGeneratedAt == "" {
		return connectionQRCodeCacheTTL
	}

	generatedAt, err := time.Parse(time.RFC3339Nano, state.QRGeneratedAt)
	if err != nil {
		return connectionQRCodeCacheTTL
	}

	remaining := connectionQRCodeMaxAge - time.Since(generatedAt)
	if remaining < time.Second {
		return time.Second
	}
	if remaining < connectionQRCodeCacheTTL {
		return remaining
	}
	return connectionQRCodeCacheTTL
}

func (w *Worker) markConnectionQRCodeAttemptProcessed(ctx context.Context, data WorkerConnectionQRCodeQueueMessage) error {
	if w.redis == nil {
		return nil
	}
	err := w.redis.Set(ctx, w.processedConnectionQRCodeAttemptKey(data), "1", 5*time.Minute).Err()
	if err == nil {
		w.debug.Log(ctx, "whatsmeow.redis_qr.mark_processed.ok", map[string]any{
			"trace_id":              data.DebugTraceID,
			"layer":                 "worker_whatsmeow.redis_qr",
			"worker_id":             data.WorkerID,
			"account_id":            data.AccountID,
			"worker_type_id":        data.WorkerTypeID,
			"connection_attempt_id": data.ConnectionAttemptID,
			"runtime_generation":    data.RuntimeGeneration,
		})
	}
	return err
}

func (w *Worker) handleSendMessage(ctx context.Context, msg kafka.Message) (err error) {
	w.logOutgoingKafkaRawDebug("whatsmeow.outgoing.kafka.received_raw", msg)

	if statusDelete, ok, err := mapToProfileStatusDeleteMessage(msg.Value); err != nil {
		logKafkaPayloadDecodeError(w.cfg.WorkerID, msg, err)
		w.logOutgoingKafkaDecodeErrorDebug(msg, err)
		return nil
	} else if ok {
		w.logOutgoingKafkaDecodedDebug(msg, "profile_status_delete", statusDelete.WorkerProfileStatusID, "", "profile_status_delete", statusDelete.AccountID)
		return w.handleProfileStatusDelete(ctx, msg, statusDelete)
	}

	if status, ok, err := mapToProfileStatusMessage(msg.Value); err != nil {
		logKafkaPayloadDecodeError(w.cfg.WorkerID, msg, err)
		w.logOutgoingKafkaDecodeErrorDebug(msg, err)
		return nil
	} else if ok {
		w.logOutgoingKafkaDecodedDebug(msg, "profile_status", status.WorkerProfileStatusID, "", "profile_status", status.AccountID)
		return w.handleProfileStatus(ctx, msg, status)
	}

	if profileInfo, ok, err := mapToProfileInfoMessage(msg.Value); err != nil {
		logKafkaPayloadDecodeError(w.cfg.WorkerID, msg, err)
		w.logOutgoingKafkaDecodeErrorDebug(msg, err)
		return nil
	} else if ok {
		w.logOutgoingKafkaDecodedDebug(msg, "profile_info", firstNonEmpty(profileInfo.WorkerID, w.cfg.WorkerID), "", "profile_info", profileInfo.AccountID)
		return w.handleProfileInfo(ctx, msg, profileInfo)
	}

	data, err := mapToChatMessage(msg.Value)
	if err != nil {
		logKafkaPayloadDecodeError(w.cfg.WorkerID, msg, err)
		w.logOutgoingKafkaDecodeErrorDebug(msg, err)
		return nil
	}
	w.logOutgoingKafkaDecodedDebug(msg, "chat_message", data.MessageID, data.ChatID, chatMessageType(data), firstNonEmpty(stringValue(data.Account["id"]), w.cfg.AccountID))

	if err := w.waitOutboundReady(ctx, data, msg); err != nil {
		return err
	}

	claimID := chatMessageClaimID(data)
	w.logOutgoingMessageStepDebug("whatsmeow.outgoing.claim.start", msg, data, map[string]any{"claim_id": claimID}, nil)
	claim, err := w.claimOutboundMessage(ctx, chatMessageClaimID(data), data, msg)
	if err != nil {
		w.logOutgoingMessageStepDebug("whatsmeow.outgoing.claim.error", msg, data, map[string]any{"claim_id": claimID}, err)
		return err
	}
	if !claim.Acquired {
		if claim.State == sendIdempotencyStateSucceeded && len(claim.Result) > 0 {
			w.logOutgoingMessageStepDebug("whatsmeow.outgoing.claim.recover_update", msg, data, map[string]any{"claim_id": claim.ID, "claim_state": claim.State}, nil)
			return w.publishRecoveredOutboundUpdate(ctx, data, claim, msg)
		}
		w.logOutgoingMessageStepDebug("whatsmeow.outgoing.claim.duplicate", msg, data, map[string]any{"claim_id": claim.ID, "claim_state": claim.State, "reason": "duplicate_message"}, nil)
		return nil
	}
	w.logOutgoingMessageStepDebug("whatsmeow.outgoing.claim.acquired", msg, data, map[string]any{"claim_id": claim.ID, "claim_state": claim.State}, nil)
	startedAt := time.Now()
	w.logOutgoingMessageStepDebug("whatsmeow.outgoing.send.invoke", msg, data, map[string]any{"claim_id": claim.ID}, nil)
	result, err := w.whatsapp.SendChatMessage(ctx, data)
	if err != nil {
		w.logOutgoingMessageStepDebug("whatsmeow.outgoing.send.error", msg, data, map[string]any{"claim_id": claim.ID, "elapsed_ms": time.Since(startedAt).Milliseconds()}, err)
		if errors.Is(err, ErrWhatsAppNotReady) {
			w.releaseOutboundClaim(ctx, claim, "connection_not_ready_after_claim", err)
			return err
		}
		statusErr := w.markSendAsNotSent(ctx, data.MessageID, data.ChatID, stringValue(data.Account["id"]), err, sendFailureLogContext{
			Topic:        msg.Topic,
			Partition:    msg.Partition,
			Offset:       msg.Offset,
			MessageType:  chatMessageType(data),
			Elapsed:      time.Since(startedAt),
			SendTimeout:  w.cfg.SendTimeout,
			HandlerScope: "send_message",
		})
		if statusErr != nil {
			w.completeOutboundClaim(ctx, claim, sendIdempotencyStateAmbiguous, nil, statusErr)
			w.logOutgoingMessageStepDebug("whatsmeow.outgoing.status_failed_publish.error", msg, data, map[string]any{"claim_id": claim.ID, "elapsed_ms": time.Since(startedAt).Milliseconds()}, statusErr)
			return statusErr
		}
		w.completeOutboundClaim(ctx, claim, sendIdempotencyStateFailed, nil, err)
		w.logOutgoingMessageStepDebug("whatsmeow.outgoing.send.failed_marked", msg, data, map[string]any{"claim_id": claim.ID, "elapsed_ms": time.Since(startedAt).Milliseconds()}, err)
		return nil
	}
	w.completeOutboundClaim(ctx, claim, sendIdempotencyStateSucceeded, result, nil)
	w.logOutgoingMessageStepDebug("whatsmeow.outgoing.send.success", msg, data, map[string]any{
		"claim_id":            claim.ID,
		"elapsed_ms":          time.Since(startedAt).Milliseconds(),
		"external_message_id": messageKeyFromSendResult(result),
	}, nil)
	w.logOutgoingMessageStepDebug("whatsmeow.outgoing.update.publish.start", msg, data, map[string]any{"topic": topicUpdateMessage}, nil)
	if err := w.kafka.SendJSON(ctx, topicUpdateMessage, data.MessageID, UpdateMessage{Message: result, Data: data}); err != nil {
		log.Printf(
			"whatsmeow send update publish failed worker_id=%s account_id=%s source_topic=%s partition=%d offset=%d message_id=%s chat_id=%s message_type=%s topic=%s error=%v",
			w.cfg.WorkerID,
			w.cfg.AccountID,
			msg.Topic,
			msg.Partition,
			msg.Offset,
			data.MessageID,
			data.ChatID,
			chatMessageType(data),
			topicUpdateMessage,
			err,
		)
		w.logOutgoingMessageStepDebug("whatsmeow.outgoing.update.publish.error", msg, data, map[string]any{"topic": topicUpdateMessage}, err)
		return err
	}
	w.logOutgoingMessageStepDebug("whatsmeow.outgoing.update.publish.success", msg, data, map[string]any{"topic": topicUpdateMessage}, nil)
	w.logOutgoingMessageStepDebug("whatsmeow.outgoing.kafka.commit.ready", msg, data, nil, nil)
	return nil
}

func (w *Worker) waitOutboundReady(ctx context.Context, data ChatMessage, msg kafka.Message) error {
	w.logOutgoingMessageStepDebug("whatsmeow.outgoing.connection.wait.start", msg, data, map[string]any{"timeout_ms": w.cfg.OutboundReadyTimeout.Milliseconds()}, nil)
	if err := w.whatsapp.WaitUntilReady(ctx, w.cfg.OutboundReadyTimeout); err != nil {
		w.logOutgoingMessageStepDebug("whatsmeow.outgoing.connection.wait", msg, data, map[string]any{"timeout_ms": w.cfg.OutboundReadyTimeout.Milliseconds(), "reason": "connection_not_ready"}, err)
		return err
	}
	w.logOutgoingMessageStepDebug("whatsmeow.outgoing.connection.ready", msg, data, nil, nil)
	return nil
}

func (w *Worker) handleProfileStatus(ctx context.Context, msg kafka.Message, data ProfileStatusMessage) error {
	if data.WorkerID != "" && data.WorkerID != w.cfg.WorkerID {
		return nil
	}
	messageID := firstNonEmpty(data.WorkerProfileStatusID, "profile_status_"+randomHex(8))
	if ok := w.claimMessage(ctx, messageID); !ok {
		return nil
	}
	startedAt := time.Now()
	externalID, err := w.whatsapp.SendProfileStatus(ctx, data)
	if err != nil {
		return w.markSendAsNotSent(ctx, messageID, "", data.AccountID, err, sendFailureLogContext{
			Topic:        msg.Topic,
			Partition:    msg.Partition,
			Offset:       msg.Offset,
			MessageType:  "profile_status",
			Elapsed:      time.Since(startedAt),
			SendTimeout:  w.cfg.SendTimeout,
			HandlerScope: "profile_status",
		})
	}
	if externalID == "" {
		return nil
	}
	if err := w.kafka.SendJSON(ctx, topicUpdateProfileStatusExternalID, data.WorkerProfileStatusID, map[string]any{
		"worker_profile_status_id": data.WorkerProfileStatusID,
		"external_id":              externalID,
	}); err != nil {
		log.Printf("whatsmeow profile status external id publish failed worker_id=%s source_topic=%s partition=%d offset=%d profile_status_id=%s topic=%s error=%v", w.cfg.WorkerID, msg.Topic, msg.Partition, msg.Offset, data.WorkerProfileStatusID, topicUpdateProfileStatusExternalID, err)
		return err
	}
	return nil
}

func (w *Worker) handleProfileStatusDelete(ctx context.Context, msg kafka.Message, data ProfileStatusDeleteMessage) error {
	if data.WorkerID != "" && data.WorkerID != w.cfg.WorkerID {
		return nil
	}
	messageID := firstNonEmpty(data.WorkerProfileStatusID, "profile_status_delete_"+randomHex(8))
	if ok := w.claimMessage(ctx, "delete:"+messageID+":"+data.ExternalID); !ok {
		return nil
	}
	startedAt := time.Now()
	if err := w.whatsapp.DeleteProfileStatus(ctx, data); err != nil {
		return w.markSendAsNotSent(ctx, messageID, "", data.AccountID, err, sendFailureLogContext{
			Topic:        msg.Topic,
			Partition:    msg.Partition,
			Offset:       msg.Offset,
			MessageType:  "profile_status_delete",
			Elapsed:      time.Since(startedAt),
			SendTimeout:  w.cfg.SendTimeout,
			HandlerScope: "profile_status_delete",
		})
	}
	return nil
}

func (w *Worker) handleProfileInfo(ctx context.Context, msg kafka.Message, data ProfileInfoMessage) error {
	if data.WorkerID != "" && data.WorkerID != w.cfg.WorkerID {
		return nil
	}
	messageID := "profile_info:" + firstNonEmpty(data.WorkerID, w.cfg.WorkerID)
	if ok := w.claimMessage(ctx, messageID+":"+hashRaw(data.Raw)); !ok {
		return nil
	}
	startedAt := time.Now()
	if err := w.whatsapp.UpdateProfileInfo(ctx, data); err != nil {
		return w.markSendAsNotSent(ctx, messageID, "", data.AccountID, err, sendFailureLogContext{
			Topic:        msg.Topic,
			Partition:    msg.Partition,
			Offset:       msg.Offset,
			MessageType:  "profile_info",
			Elapsed:      time.Since(startedAt),
			SendTimeout:  w.cfg.SendTimeout,
			HandlerScope: "profile_info",
		})
	}
	return nil
}

func (w *Worker) handleScheduleSend(ctx context.Context, msg kafka.Message) error {
	w.logOutgoingKafkaRawDebug("whatsmeow.outgoing.schedule.kafka.received_raw", msg)
	var data ScheduleMessage
	if err := json.Unmarshal(msg.Value, &data); err != nil {
		logKafkaPayloadDecodeError(w.cfg.WorkerID, msg, err)
		w.logOutgoingKafkaDecodeErrorDebug(msg, err)
		return nil
	}
	w.logOutgoingKafkaDecodedDebug(msg, "schedule_message", data.Message.MessageID, data.Message.ChatID, chatMessageType(data.Message), firstNonEmpty(stringValue(data.Message.Account["id"]), w.cfg.AccountID))
	if !data.IsValidated {
		w.logOutgoingMessageStepDebug("whatsmeow.outgoing.schedule.ignored", msg, data.Message, map[string]any{
			"schedule_id": data.ScheduleID,
			"contact_id":  data.ContactID,
			"reason":      "not_validated",
		}, nil)
		return w.publishScheduleStatus(ctx, data, "ignored")
	}
	startedAt := time.Now()
	w.logOutgoingMessageStepDebug("whatsmeow.outgoing.schedule.send.invoke", msg, data.Message, map[string]any{
		"schedule_id": data.ScheduleID,
		"contact_id":  data.ContactID,
	}, nil)
	result, err := w.whatsapp.SendChatMessage(ctx, data.Message)
	if err != nil {
		log.Printf(
			"whatsmeow schedule send failed worker_id=%s account_id=%s topic=%s partition=%d offset=%d schedule_id=%s contact_id=%s message_id=%s chat_id=%s message_type=%s elapsed_ms=%d timeout=%s error=%v",
			w.cfg.WorkerID,
			w.cfg.AccountID,
			msg.Topic,
			msg.Partition,
			msg.Offset,
			data.ScheduleID,
			data.ContactID,
			data.Message.MessageID,
			data.Message.ChatID,
			chatMessageType(data.Message),
			time.Since(startedAt).Milliseconds(),
			w.cfg.SendTimeout,
			err,
		)
		w.logOutgoingMessageStepDebug("whatsmeow.outgoing.schedule.send.error", msg, data.Message, map[string]any{
			"schedule_id": data.ScheduleID,
			"contact_id":  data.ContactID,
			"elapsed_ms":  time.Since(startedAt).Milliseconds(),
		}, err)
		_ = w.publishScheduleStatus(ctx, data, "failed")
		return err
	}
	w.logOutgoingMessageStepDebug("whatsmeow.outgoing.schedule.send.success", msg, data.Message, map[string]any{
		"schedule_id":          data.ScheduleID,
		"contact_id":           data.ContactID,
		"elapsed_ms":           time.Since(startedAt).Milliseconds(),
		"external_message_id":  messageKeyFromSendResult(result),
		"schedule_status_next": "sent",
	}, nil)
	if err := w.kafka.SendJSON(ctx, topicUpdateMessage, data.Message.MessageID, UpdateMessage{Message: result, Data: data.Message}); err != nil {
		log.Printf("whatsmeow schedule update publish failed worker_id=%s account_id=%s source_topic=%s partition=%d offset=%d schedule_id=%s message_id=%s topic=%s error=%v", w.cfg.WorkerID, w.cfg.AccountID, msg.Topic, msg.Partition, msg.Offset, data.ScheduleID, data.Message.MessageID, topicUpdateMessage, err)
		w.logOutgoingMessageStepDebug("whatsmeow.outgoing.schedule.update.publish.error", msg, data.Message, map[string]any{
			"schedule_id": data.ScheduleID,
			"contact_id":  data.ContactID,
			"topic":       topicUpdateMessage,
		}, err)
		return err
	}
	w.logOutgoingMessageStepDebug("whatsmeow.outgoing.schedule.update.publish.success", msg, data.Message, map[string]any{
		"schedule_id": data.ScheduleID,
		"contact_id":  data.ContactID,
		"topic":       topicUpdateMessage,
	}, nil)
	return w.publishScheduleStatus(ctx, data, "sent")
}

func (w *Worker) handlePhoneValidation(ctx context.Context, msg kafka.Message) error {
	var req PhoneValidationRequest
	if err := json.Unmarshal(msg.Value, &req); err != nil {
		return nil
	}
	resp, err := w.whatsapp.ValidatePhone(ctx, req)
	if err != nil {
		resp = PhoneValidationResponse{
			RequestID: req.RequestID,
			AccountID: firstNonEmpty(req.AccountID, w.cfg.AccountID),
			WorkerID:  firstNonEmpty(req.WorkerID, w.cfg.WorkerID),
			Valid:     false,
			Error:     err.Error(),
		}
	}
	return w.kafka.SendJSON(ctx, topicPhoneValidationResponse, resp.RequestID, resp)
}

func (w *Worker) handleNotification(ctx context.Context, msg kafka.Message) error {
	var data NotificationMessage
	if err := json.Unmarshal(msg.Value, &data); err != nil {
		logKafkaPayloadDecodeError(w.cfg.WorkerID, msg, err)
		return nil
	}
	if strings.TrimSpace(data.MessageWhatsApp) == "" {
		return nil
	}
	target := data.MessageKey.RemoteJID
	if target == "" {
		resp, err := w.whatsapp.ValidatePhone(ctx, PhoneValidationRequest{
			AccountID: w.cfg.AccountID,
			WorkerID:  w.cfg.WorkerID,
			Phone:     data.MessageKey.PhoneNumber,
			PhoneDDI:  data.MessageKey.PhoneDDI,
		})
		if err != nil || !resp.Valid || resp.JID == "" {
			return validationError(err, resp)
		}
		target = resp.JID
		if data.UserID != "" {
			_ = w.kafka.SendJSON(ctx, topicUserPhoneJIDUpdate, data.UserID, map[string]any{
				"user_id":   data.UserID,
				"phone_jid": target,
			})
		}
	}
	notificationMessage := ChatMessage{
		MessageID: "notification_" + data.NotificationID,
		MessageKey: &MessageKey{
			RemoteJID: target,
		},
		Content: map[string]any{
			"type":    MessageTypeText,
			"message": data.MessageWhatsApp,
		},
	}
	startedAt := time.Now()
	_, err := w.whatsapp.SendChatMessage(ctx, notificationMessage)
	if err != nil {
		log.Printf(
			"whatsmeow notification send failed worker_id=%s topic=%s partition=%d offset=%d notification_id=%s message_id=%s elapsed_ms=%d timeout=%s error=%v",
			w.cfg.WorkerID,
			msg.Topic,
			msg.Partition,
			msg.Offset,
			data.NotificationID,
			notificationMessage.MessageID,
			time.Since(startedAt).Milliseconds(),
			w.cfg.SendTimeout,
			err,
		)
	}
	return err
}

func (w *Worker) handleWebhookIntegration(ctx context.Context, msg kafka.Message) error {
	var data map[string]any
	if err := json.Unmarshal(msg.Value, &data); err != nil {
		return nil
	}
	accountID := stringValue(data["account_id"])
	workerID := stringValue(data["worker_id"])
	if workerID != "" && workerID != w.cfg.WorkerID {
		return nil
	}
	mapped := asMap(data["mapped_data"])
	messageText := stringValue(mapped["message"])
	if stringValue(mapped["message_type"]) == "chatbot" {
		if mappingMessage := stringValue(asMap(data["mapping"])["message"]); mappingMessage != "" {
			if value := nestedString(asMap(data["body"]), mappingMessage); value != "" {
				messageText = value
			}
		}
	}
	if messageText == "" {
		return nil
	}

	resp, err := w.whatsapp.ValidatePhone(ctx, PhoneValidationRequest{
		AccountID: firstNonEmpty(accountID, w.cfg.AccountID),
		WorkerID:  w.cfg.WorkerID,
		Phone:     stringValue(data["phone"]),
		PhoneDDI:  stringValue(data["phone_ddi"]),
	})
	if err != nil || !resp.Valid || resp.JID == "" {
		return validationError(err, resp)
	}

	upsert := UpsertMessage{
		AccountID:      firstNonEmpty(accountID, w.cfg.AccountID),
		WorkerID:       w.cfg.WorkerID,
		SourceProvider: "webhook",
		Type:           MessageTypeText,
		Message: map[string]any{
			"key": map[string]any{
				"remoteJid": resp.JID,
				"fromMe":    false,
				"id":        "webhook_" + randomHex(12),
			},
			"messageTimestamp": time.Now().Unix(),
			"message":          map[string]any{"conversation": messageText},
		},
		HasQuoted: false,
	}
	if value := stringValue(mapped["message_type"]); value == "message" || value == "chatbot" {
		upsert.WebhookMessageType = value
	}
	upsert.WebhookChatbotID = stringValue(mapped["chatbot_id"])
	upsert.TransferSectorID = stringValue(mapped["transfer_sector_id"])
	upsert.TransferSectorUserID = stringValue(mapped["transfer_sector_user_id"])
	upsert.TransferUserID = stringValue(mapped["transfer_user_id"])
	kafkaKey := incomingUpsertKafkaKey(w.cfg, &upsert)
	err = w.kafka.SendJSON(ctx, topicUpsertMessage, kafkaKey, upsert)
	if err != nil {
		return err
	}
	return nil
}

func (w *Worker) handleMarkRead(ctx context.Context, msg kafka.Message) error {
	var data MarkReadRequest
	if err := json.Unmarshal(msg.Value, &data); err != nil {
		return nil
	}
	if data.WorkerID != w.cfg.WorkerID {
		return nil
	}
	enabled, err := w.redis.Get(ctx, "worker:"+w.cfg.WorkerID+":mark_as_read").Result()
	if err != nil || enabled != "true" {
		return nil
	}
	client := w.whatsapp.getClient()
	if client == nil {
		return nil
	}
	for _, key := range data.Keys {
		chat, err := parseJID(key.Remote())
		if err != nil || key.ID == "" {
			continue
		}
		sender := senderJIDFromKey(chat, &key)
		readAt := time.Now()
		if err := client.MarkRead(ctx, []types.MessageID{key.ID}, readAt, chat, sender); err != nil {
			log.Printf("mark read failed id=%s: %v", key.ID, err)
			continue
		}
		w.whatsapp.markChatAsReadAppState(ctx, client, key, chat, readAt)
		_ = w.kafka.SendJSON(ctx, topicUpdateMessageStatus, data.AccountID+":"+key.ID, MessageStatusUpdate{
			AccountID: data.AccountID,
			MessageID: key.ID,
			Patch:     map[string]any{"is_seen": true},
			Key:       waKeyMap(key),
		})
	}
	return nil
}

func (w *Worker) handleWorkerConfigUpdate(ctx context.Context, msg kafka.Message) error {
	var data WorkerConfigUpdateEvent
	if err := json.Unmarshal(msg.Value, &data); err != nil {
		return nil
	}
	if data.WorkerID != w.cfg.WorkerID || data.RejectCall == nil {
		return nil
	}
	w.whatsapp.mu.Lock()
	w.whatsapp.rejectCalls = *data.RejectCall
	w.whatsapp.mu.Unlock()
	return nil
}

func (w *Worker) claimMessage(ctx context.Context, messageID string) bool {
	messageID = strings.TrimSpace(messageID)
	if messageID == "" || w.redis == nil {
		return true
	}
	key := "message-send:idempotency:v1:whatsmeow:" + messageID
	acquired, err := w.redis.SetNX(ctx, key, "1", 24*time.Hour).Result()
	if err != nil {
		log.Printf("idempotency claim failed: %v", err)
		return true
	}
	return acquired
}

const (
	sendIdempotencyStateInProgress = "in_progress"
	sendIdempotencyStateSucceeded  = "succeeded"
	sendIdempotencyStateFailed     = "failed"
	sendIdempotencyStateAmbiguous  = "ambiguous"
)

type outboundSendClaim struct {
	ID       string
	Key      string
	Acquired bool
	State    string
	Attempts int
	Result   map[string]any
}

type outboundSendClaimRecord struct {
	State     string         `json:"state"`
	Attempts  int            `json:"attempts"`
	Result    map[string]any `json:"result,omitempty"`
	Error     string         `json:"error,omitempty"`
	UpdatedAt string         `json:"updated_at"`
}

func (w *Worker) claimOutboundMessage(ctx context.Context, claimID string, data ChatMessage, msg kafka.Message) (outboundSendClaim, error) {
	claimID = strings.TrimSpace(claimID)
	if claimID == "" || w.redis == nil {
		return outboundSendClaim{ID: claimID, Acquired: true, State: sendIdempotencyStateInProgress, Attempts: 1}, nil
	}
	key := "message-send:idempotency:v2:whatsmeow:" + claimID
	record := outboundSendClaimRecord{
		State:     sendIdempotencyStateInProgress,
		Attempts:  1,
		UpdatedAt: time.Now().UTC().Format(time.RFC3339Nano),
	}
	payload, _ := json.Marshal(record)
	acquired, err := w.redis.SetNX(ctx, key, payload, w.cfg.SendIdempotencyInProgressTTL).Result()
	if err != nil {
		log.Printf("idempotency claim failed: %v", err)
		return outboundSendClaim{ID: claimID, Key: key, Acquired: true, State: sendIdempotencyStateInProgress, Attempts: 1}, nil
	}
	if acquired {
		return outboundSendClaim{ID: claimID, Key: key, Acquired: true, State: sendIdempotencyStateInProgress, Attempts: 1}, nil
	}

	raw, err := w.redis.Get(ctx, key).Result()
	if errors.Is(err, redis.Nil) {
		_ = w.redis.Set(ctx, key, payload, w.cfg.SendIdempotencyInProgressTTL).Err()
		return outboundSendClaim{ID: claimID, Key: key, Acquired: true, State: sendIdempotencyStateInProgress, Attempts: 1}, nil
	}
	if err != nil {
		log.Printf("idempotency claim read failed: %v", err)
		return outboundSendClaim{ID: claimID, Key: key, Acquired: true, State: sendIdempotencyStateInProgress, Attempts: 1}, nil
	}

	existing := parseOutboundSendClaimRecord(raw)
	if stale, _ := shouldReacquireOutboundClaim(existing, time.Now(), w.cfg.SendIdempotencyStaleAfter); stale {
		existing.State = sendIdempotencyStateInProgress
		existing.Attempts++
		existing.Result = nil
		existing.Error = ""
		existing.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
		nextPayload, _ := json.Marshal(existing)
		if err := w.redis.Set(ctx, key, nextPayload, w.cfg.SendIdempotencyInProgressTTL).Err(); err != nil {
			return outboundSendClaim{}, err
		}
		return outboundSendClaim{ID: claimID, Key: key, Acquired: true, State: sendIdempotencyStateInProgress, Attempts: existing.Attempts}, nil
	}
	if existing.State == sendIdempotencyStateFailed {
		existing.State = sendIdempotencyStateInProgress
		existing.Attempts++
		existing.Result = nil
		existing.Error = ""
		existing.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
		nextPayload, _ := json.Marshal(existing)
		if err := w.redis.Set(ctx, key, nextPayload, w.cfg.SendIdempotencyInProgressTTL).Err(); err != nil {
			return outboundSendClaim{}, err
		}
		return outboundSendClaim{ID: claimID, Key: key, Acquired: true, State: sendIdempotencyStateInProgress, Attempts: existing.Attempts}, nil
	}

	claim := outboundSendClaim{
		ID:       claimID,
		Key:      key,
		Acquired: false,
		State:    existing.State,
		Attempts: existing.Attempts,
		Result:   existing.Result,
	}
	if existing.State == sendIdempotencyStateSucceeded {
		return claim, nil
	}
	return claim, fmt.Errorf("message send claim is still %s for %s", existing.State, claimID)
}

func shouldReacquireOutboundClaim(record outboundSendClaimRecord, now time.Time, staleAfter time.Duration) (bool, time.Duration) {
	if record.State != sendIdempotencyStateInProgress || staleAfter <= 0 {
		return false, 0
	}
	updatedAt, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(record.UpdatedAt))
	if err != nil {
		return false, 0
	}
	age := now.Sub(updatedAt)
	return age >= staleAfter, age
}

func parseOutboundSendClaimRecord(raw string) outboundSendClaimRecord {
	var record outboundSendClaimRecord
	if err := json.Unmarshal([]byte(raw), &record); err == nil && record.State != "" {
		return record
	}
	return outboundSendClaimRecord{
		State:     strings.TrimSpace(raw),
		Attempts:  1,
		UpdatedAt: time.Now().UTC().Format(time.RFC3339Nano),
	}
}

func (w *Worker) completeOutboundClaim(ctx context.Context, claim outboundSendClaim, state string, result map[string]any, cause error) {
	if claim.Key == "" || w.redis == nil {
		return
	}
	record := outboundSendClaimRecord{
		State:     state,
		Attempts:  claim.Attempts,
		Result:    result,
		UpdatedAt: time.Now().UTC().Format(time.RFC3339Nano),
	}
	if record.Attempts <= 0 {
		record.Attempts = 1
	}
	if cause != nil {
		record.Error = cause.Error()
	}
	ttl := w.cfg.SendIdempotencyFinalTTL
	if state == sendIdempotencyStateInProgress || state == sendIdempotencyStateAmbiguous {
		ttl = w.cfg.SendIdempotencyInProgressTTL
	}
	payload, _ := json.Marshal(record)
	if err := w.redis.Set(ctx, claim.Key, payload, ttl).Err(); err != nil {
		return
	}
}

func (w *Worker) releaseOutboundClaim(ctx context.Context, claim outboundSendClaim, reason string, cause error) {
	if claim.Key == "" || w.redis == nil {
		return
	}
	if err := w.redis.Del(ctx, claim.Key).Err(); err != nil {
		return
	}
	payload := map[string]any{
		"stage":       "whatsmeow.outgoing.claim.release.success",
		"decision":    "release_claim",
		"outcome":     "retrying",
		"claim_id":    claim.ID,
		"claim_state": claim.State,
		"reason":      reason,
	}
	if cause != nil {
		payload["error"] = cause.Error()
	}
}

func (w *Worker) publishRecoveredOutboundUpdate(ctx context.Context, data ChatMessage, claim outboundSendClaim, msg kafka.Message) error {
	if err := w.kafka.SendJSON(ctx, topicUpdateMessage, data.MessageID, UpdateMessage{Message: claim.Result, Data: data}); err != nil {
		return err
	}
	return nil
}

func chatMessageClaimID(data ChatMessage) string {
	if hash := strings.TrimSpace(data.Hash); hash != "" {
		return "hash:" + hash
	}
	if messageID := strings.TrimSpace(data.MessageID); messageID != "" {
		return "message:" + messageID
	}
	return ""
}

type sendFailureLogContext struct {
	Topic        string
	Partition    int
	Offset       int64
	MessageType  string
	Elapsed      time.Duration
	SendTimeout  time.Duration
	HandlerScope string
}

func (w *Worker) markSendAsNotSent(ctx context.Context, messageID, chatID, accountID string, sendErr error, details ...sendFailureLogContext) error {
	messageID = strings.TrimSpace(messageID)
	accountID = firstNonEmpty(accountID, w.cfg.AccountID)
	if len(details) > 0 {
		detail := details[0]
		log.Printf(
			"whatsmeow send terminal failure worker_id=%s scope=%s topic=%s partition=%d offset=%d message_id=%s chat_id=%s account_id=%s message_type=%s elapsed_ms=%d timeout=%s error=%v",
			w.cfg.WorkerID,
			detail.HandlerScope,
			detail.Topic,
			detail.Partition,
			detail.Offset,
			messageID,
			chatID,
			accountID,
			detail.MessageType,
			detail.Elapsed.Milliseconds(),
			detail.SendTimeout,
			sendErr,
		)
	} else {
		log.Printf("whatsmeow send terminal failure worker_id=%s message_id=%s chat_id=%s account_id=%s error=%v", w.cfg.WorkerID, messageID, chatID, accountID, sendErr)
	}
	if messageID == "" {
		return nil
	}
	update := MessageStatusUpdate{
		AccountID: accountID,
		MessageID: messageID,
		Patch: map[string]any{
			"is_sent":      false,
			"is_delivered": false,
			"is_seen":      false,
		},
		Key: map[string]any{
			"id":     messageID,
			"fromMe": true,
		},
	}
	if strings.TrimSpace(chatID) != "" {
		update.Key["remoteJid"] = chatID
	}
	if err := w.kafka.SendJSON(ctx, topicUpdateMessageStatus, accountID+":"+messageID, update); err != nil {
		log.Printf("whatsmeow send status publish failed worker_id=%s message_id=%s chat_id=%s account_id=%s topic=%s error=%v", w.cfg.WorkerID, messageID, chatID, accountID, topicUpdateMessageStatus, err)
		return err
	}
	return nil
}

func logKafkaPayloadDecodeError(workerID string, msg kafka.Message, err error) {
	log.Printf("whatsmeow kafka payload decode failed worker_id=%s topic=%s partition=%d offset=%d error=%v", workerID, msg.Topic, msg.Partition, msg.Offset, err)
}

func (w *Worker) logOutgoingKafkaRawDebug(stage string, msg kafka.Message) {
	if !messageDebugEnabledForAccount(w.cfg, "") {
		return
	}
	rawPayload, rawTruncated := truncateDebugLogValue(string(msg.Value), messageDebugRawLimit)
	log.Printf(
		"message_debug direction=out stage=%s event_type=kafka_message worker_id=%s account_id=%s topic=%s partition=%d offset=%d kafka_key=%q raw_payload=%q raw_truncated=%t",
		stage,
		w.cfg.WorkerID,
		w.cfg.AccountID,
		msg.Topic,
		msg.Partition,
		msg.Offset,
		string(msg.Key),
		rawPayload,
		rawTruncated,
	)
}

func (w *Worker) logOutgoingKafkaDecodeErrorDebug(msg kafka.Message, err error) {
	if !messageDebugEnabledForAccount(w.cfg, "") {
		return
	}
	rawPayload, rawTruncated := truncateDebugLogValue(string(msg.Value), messageDebugRawLimit)
	log.Printf(
		"message_debug direction=out stage=whatsmeow.outgoing.kafka.decode.error event_type=kafka_message worker_id=%s account_id=%s topic=%s partition=%d offset=%d kafka_key=%q raw_payload=%q raw_truncated=%t error=%q",
		w.cfg.WorkerID,
		w.cfg.AccountID,
		msg.Topic,
		msg.Partition,
		msg.Offset,
		string(msg.Key),
		rawPayload,
		rawTruncated,
		err.Error(),
	)
}

func (w *Worker) logOutgoingKafkaDecodedDebug(msg kafka.Message, payloadType, messageID, chatID, messageType, accountID string) {
	if !messageDebugEnabledForAccount(w.cfg, accountID) {
		return
	}
	log.Printf(
		"message_debug direction=out stage=whatsmeow.outgoing.kafka.decoded event_type=kafka_message worker_id=%s account_id=%s payload_type=%s topic=%s partition=%d offset=%d kafka_key=%q message_id=%s chat_id=%s message_type=%s",
		w.cfg.WorkerID,
		firstNonEmpty(accountID, w.cfg.AccountID),
		payloadType,
		msg.Topic,
		msg.Partition,
		msg.Offset,
		string(msg.Key),
		messageID,
		chatID,
		messageType,
	)
}

func (w *Worker) logOutgoingMessageStepDebug(stage string, msg kafka.Message, data ChatMessage, detail map[string]any, err error) {
	accountID := firstNonEmpty(stringValue(data.Account["id"]), w.cfg.AccountID)
	if !messageDebugEnabledForAccount(w.cfg, accountID) {
		return
	}
	if detail == nil {
		detail = map[string]any{}
	}
	detailPayload, detailTruncated, detailErr := debugJSONPayload(detail, messageDebugRawLimit)
	errorText := ""
	if err != nil {
		errorText = err.Error()
	}
	log.Printf(
		"message_debug direction=out stage=%s worker_id=%s account_id=%s topic=%s partition=%d offset=%d kafka_key=%q message_id=%s chat_id=%s message_type=%s phone=%s message_text=%q detail_payload=%q detail_truncated=%t detail_error=%q error=%q",
		stage,
		w.cfg.WorkerID,
		accountID,
		msg.Topic,
		msg.Partition,
		msg.Offset,
		string(msg.Key),
		data.MessageID,
		data.ChatID,
		chatMessageType(data),
		data.Phone,
		truncateLogValue(outgoingMessageTextPreview(data), messageDebugBodyLimit),
		detailPayload,
		detailTruncated,
		detailErr,
		errorText,
	)
}

func chatMessageType(data ChatMessage) string {
	messageType := strings.TrimSpace(stringValue(data.Content["type"]))
	if messageType == "" {
		return MessageTypeText
	}
	return messageType
}

func (w *Worker) publishScheduleStatus(ctx context.Context, data ScheduleMessage, status string) error {
	return w.kafka.SendJSON(ctx, topicScheduleStatusUpdate, data.ScheduleID+":"+data.ContactID, ScheduleStatusUpdate{
		ScheduleID:  data.ScheduleID,
		ContactID:   data.ContactID,
		MessageID:   data.Message.MessageID,
		ProcessedAt: nowISO(),
		Status:      status,
	})
}

func nestedString(root map[string]any, dottedPath string) string {
	var current any = root
	for _, part := range strings.Split(dottedPath, ".") {
		if current == nil {
			return ""
		}
		mapped := asMap(current)
		if mapped == nil {
			return ""
		}
		current = mapped[part]
	}
	return stringValue(current)
}

func validationError(err error, resp PhoneValidationResponse) error {
	if err != nil {
		return err
	}
	if resp.Error != "" {
		return fmt.Errorf("phone validation failed: %s", resp.Error)
	}
	return fmt.Errorf("phone validation failed")
}

func hashRaw(raw map[string]any) string {
	if len(raw) == 0 {
		return randomHex(8)
	}
	payload, err := json.Marshal(raw)
	if err != nil {
		return randomHex(8)
	}
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:8])
}
