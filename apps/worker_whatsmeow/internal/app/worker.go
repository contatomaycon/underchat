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
	httpServer     *http.Server
	cancel         context.CancelFunc
	shutdown       sync.Once
	runtimeMu      sync.RWMutex
	runCtx         context.Context
	runtimeStarted bool
}

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
	centrifugo := NewCentrifugoClient(cfg)
	balance := NewBalanceGRPCClient(cfg)
	storage, err := NewStorageClient(cfg, balance)
	if err != nil {
		return nil, err
	}
	whatsApp, err := NewWhatsAppManager(ctx, cfg, kafkaClient, centrifugo, balance, storage, redisClient)
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
	}
	grpcServer, err := NewWorkerConnectionGRPCServer(cfg.GRPCAddr, worker, cfg)
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
		health := map[string]any{"ready": false, "provider": "whatsmeow", "error": "runtime_not_initialized"}
		if manager != nil {
			health = manager.ConnectionHealth()
		}
		health["kafka_consumers"] = w.kafka.ConsumerHealthSnapshot()
		if ready, _ := health["ready"].(bool); ready {
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
	if err := w.startConsumers(ctx); err != nil {
		return err
	}
	w.runtimeStarted = true
	return nil
}

func (w *Worker) RequestConnection(ctx context.Context, req StatusConnectionRequest) (ConnectionState, error) {
	manager := w.currentWhatsApp()
	if manager == nil {
		return ConnectionState{}, fmt.Errorf("whatsmeow runtime is not initialized")
	}
	return manager.RequestConnection(ctx, req)
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
	balance := NewBalanceGRPCClient(nextCfg)
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
	whatsApp, err := NewWhatsAppManager(runtimeCtx, nextCfg, w.kafka, w.centrifugo, balance, storage, w.redis)
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
	ready := w.whatsapp != nil && (standby || w.runtimeStarted)
	hasSession := false
	hasQR := false
	if w.whatsapp != nil {
		health := w.whatsapp.ConnectionHealth()
		if value, ok := health["has_store_id"].(bool); ok {
			hasSession = value
		}
		w.whatsapp.mu.RLock()
		hasQR = w.whatsapp.currentQRCode != ""
		w.whatsapp.mu.RUnlock()
	}
	return WorkerRuntimeHealthResponse{
		Ready:      ready,
		Standby:    standby,
		Activated:  w.runtimeStarted,
		WorkerID:   w.cfg.WorkerID,
		AccountID:  w.cfg.AccountID,
		WarmPoolID: firstNonEmpty(req.WarmPoolID, w.cfg.WarmPoolID),
		HasSession: hasSession,
		HasQR:      hasQR,
	}, nil
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
		{topicWorkerSendMessageDLQ(workerID), workerTopicConfig},
		{topicWorkerScheduleSend(workerID), workerTopicConfig},
		{topicWorkerValidatePhone(workerID), workerTopicConfig},
		{topicWorkerNotification(workerID), workerTopicConfig},
		{topicWorkerWebhook(workerID), workerTopicConfig},
		{topicWorkerConnectionQRCode(workerID), workerTopicConfig},
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
		{topicWorkerConnectionQRCode(workerID), "group-underchat-whatsmeow-connection-qrcode-" + workerID, workerTopicConfig, w.handleConnectionQRCode},
		{topicMarkMessageRead, "group-underchat-mark-read-whatsmeow-" + workerID, globalTopicConfig, w.handleMarkRead},
		{topicWorkerConfigUpdate, "group-underchat-worker-config-update-whatsmeow-" + workerID, globalTopicConfig, w.handleWorkerConfigUpdate},
	}
	for _, consumer := range consumers {
		if err := w.kafka.StartConsumer(ctx, consumer.topic, consumer.group, consumer.config, consumer.fn); err != nil {
			return err
		}
		log.Printf("kafka consumer started topic=%s group=%s partitions=%d replication_factor=%d", consumer.topic, consumer.group, consumer.config.Partitions, consumer.config.ReplicationFactor)
		if consumer.topic == topicWorkerConnectionQRCode(workerID) {
			w.startConnectionQRCodeReadinessHeartbeat(ctx, consumer.topic, consumer.group)
		}
		time.Sleep(500 * time.Millisecond)
	}
	return nil
}

func (w *Worker) connectionQRCodeReadinessKey() string {
	return "worker:" + w.cfg.WorkerID + ":connection:qrcode:consumer:ready"
}

func (w *Worker) markConnectionQRCodeConsumerReady(ctx context.Context, topic, groupID string) {
	if w.redis == nil {
		return
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	payload := map[string]any{
		"worker_id":      w.cfg.WorkerID,
		"account_id":     w.cfg.AccountID,
		"worker_type_id": WorkerTypeWhatsmeow,
		"topic":          topic,
		"group_id":       groupID,
		"ready_at":       now,
		"last_seen_at":   now,
	}
	if raw, err := w.redis.Get(ctx, w.connectionQRCodeReadinessKey()).Result(); err == nil && raw != "" {
		var existing map[string]any
		if json.Unmarshal([]byte(raw), &existing) == nil {
			if readyAt, ok := existing["ready_at"].(string); ok && strings.TrimSpace(readyAt) != "" {
				payload["ready_at"] = readyAt
			}
		}
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return
	}
	if err := w.redis.Set(ctx, w.connectionQRCodeReadinessKey(), string(encoded), 30*time.Second).Err(); err != nil {
		recordConnectionLifecycle(ctx, w.cfg, map[string]any{
			"stage":      "connection.whatsmeow.qrcode_consumer.readiness_error",
			"decision":   "mark_qrcode_consumer_ready",
			"outcome":    "error",
			"reason":     "redis_set_failed",
			"level":      "warn",
			"topic":      topic,
			"group_id":   groupID,
			"worker_id":  w.cfg.WorkerID,
			"account_id": w.cfg.AccountID,
			"error":      err.Error(),
		})
		return
	}
	recordConnectionLifecycle(ctx, w.cfg, map[string]any{
		"stage":      "connection.whatsmeow.qrcode_consumer.readiness_heartbeat",
		"decision":   "mark_qrcode_consumer_ready",
		"outcome":    "ready",
		"topic":      topic,
		"group_id":   groupID,
		"worker_id":  w.cfg.WorkerID,
		"account_id": w.cfg.AccountID,
	})
}

func (w *Worker) startConnectionQRCodeReadinessHeartbeat(ctx context.Context, topic, groupID string) {
	w.markConnectionQRCodeConsumerReady(ctx, topic, groupID)
	go func() {
		ticker := time.NewTicker(10 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				w.markConnectionQRCodeConsumerReady(ctx, topic, groupID)
			}
		}
	}()
}

func (w *Worker) handleConnectionQRCode(ctx context.Context, msg kafka.Message) (err error) {
	var data WorkerConnectionQRCodeQueueMessage
	if err := json.Unmarshal(msg.Value, &data); err != nil {
		recordConnectionLifecycle(ctx, w.cfg, map[string]any{
			"stage":     "connection.whatsmeow.qrcode_queue.decode_error",
			"decision":  "consume_connection_qrcode_request",
			"outcome":   "ignored",
			"reason":    "invalid_payload",
			"level":     "warn",
			"topic":     msg.Topic,
			"partition": msg.Partition,
			"offset":    msg.Offset,
			"error":     err.Error(),
		})
		return nil
	}

	req := StatusConnectionRequest{
		WorkerID:              data.WorkerID,
		Status:                WorkerStatusOnline,
		Type:                  "qrcode",
		ConnectionAttemptID:   data.ConnectionAttemptID,
		ConnectionLifecycleID: data.ConnectionLifecycleID,
	}
	lifecycle := connectionLifecycleFromRequest(w.cfg, req, "consume_qrcode_request")
	if data.ConnectionLifecycleID != "" {
		lifecycle.ConnectionLifecycleID = data.ConnectionLifecycleID
	}
	lifecycle.AccountID = data.AccountID
	lifecycle.WorkerID = data.WorkerID
	lifecycle.ChannelID = data.WorkerID
	ctx, finishLifecycleSpan := startConnectionLifecycleSpan(ctx, w.cfg, lifecycle)
	defer func() {
		finishLifecycleSpan(err)
	}()

	recordConnectionLifecycle(ctx, w.cfg, map[string]any{
		"stage":                   "connection.whatsmeow.qrcode_queue.received",
		"decision":                "consume_connection_qrcode_request",
		"outcome":                 "received",
		"topic":                   msg.Topic,
		"partition":               msg.Partition,
		"offset":                  msg.Offset,
		"request_id":              data.RequestID,
		"connection_attempt_id":   data.ConnectionAttemptID,
		"connection_lifecycle_id": data.ConnectionLifecycleID,
		"source":                  data.Source,
	})

	if data.WorkerID != w.cfg.WorkerID || data.AccountID != w.cfg.AccountID {
		recordConnectionLifecycle(ctx, w.cfg, map[string]any{
			"stage":              "connection.whatsmeow.qrcode_queue.ignored_foreign",
			"decision":           "validate_connection_qrcode_request_scope",
			"outcome":            "ignored",
			"reason":             "worker_or_account_mismatch",
			"level":              "warn",
			"topic":              msg.Topic,
			"partition":          msg.Partition,
			"offset":             msg.Offset,
			"request_worker_id":  data.WorkerID,
			"request_account_id": data.AccountID,
			"worker_id":          w.cfg.WorkerID,
			"account_id":         w.cfg.AccountID,
		})
		return nil
	}

	active, activeErr := w.isActiveConnectionQRCodeAttempt(ctx, data)
	if activeErr != nil {
		err = activeErr
		recordConnectionLifecycle(ctx, w.cfg, map[string]any{
			"stage":                 "connection.whatsmeow.qrcode_queue.active_attempt_error",
			"decision":              "validate_active_connection_attempt",
			"outcome":               "error",
			"reason":                "redis_read_failed",
			"level":                 "error",
			"topic":                 msg.Topic,
			"partition":             msg.Partition,
			"offset":                msg.Offset,
			"connection_attempt_id": data.ConnectionAttemptID,
			"error":                 activeErr.Error(),
		})
		return activeErr
	}
	if !active {
		recordConnectionLifecycle(ctx, w.cfg, map[string]any{
			"stage":                 "connection.whatsmeow.qrcode_queue.ignored_stale",
			"decision":              "validate_active_connection_attempt",
			"outcome":               "ignored",
			"reason":                "stale_or_duplicate_connection_attempt",
			"level":                 "warn",
			"topic":                 msg.Topic,
			"partition":             msg.Partition,
			"offset":                msg.Offset,
			"connection_attempt_id": data.ConnectionAttemptID,
		})
		return nil
	}

	if _, err = w.RequestConnection(ctx, req); err != nil {
		recordConnectionLifecycle(ctx, w.cfg, map[string]any{
			"stage":                 "connection.whatsmeow.qrcode_queue.process_error",
			"decision":              "request_local_connection_qrcode",
			"outcome":               "error",
			"reason":                "local_connection_request_failed",
			"level":                 "error",
			"topic":                 msg.Topic,
			"partition":             msg.Partition,
			"offset":                msg.Offset,
			"connection_attempt_id": data.ConnectionAttemptID,
			"error":                 err.Error(),
		})
		return err
	}
	if err = w.markConnectionQRCodeAttemptProcessed(ctx, data); err != nil {
		return err
	}
	recordConnectionLifecycle(ctx, w.cfg, map[string]any{
		"stage":                 "connection.whatsmeow.qrcode_queue.processed",
		"decision":              "request_local_connection_qrcode",
		"outcome":               "processed",
		"topic":                 msg.Topic,
		"partition":             msg.Partition,
		"offset":                msg.Offset,
		"connection_attempt_id": data.ConnectionAttemptID,
	})
	return nil
}

type activeConnectionQRCodeAttemptEnvelope struct {
	Ack struct {
		ConnectionAttemptID string `json:"connection_attempt_id"`
	} `json:"ack"`
}

func (w *Worker) activeConnectionQRCodeAttemptKey(workerID string) string {
	return "connection:qrcode:" + workerID + ":active_attempt"
}

func (w *Worker) processedConnectionQRCodeAttemptKey(data WorkerConnectionQRCodeQueueMessage) string {
	return "connection:qrcode:" + data.WorkerID + ":processed:" + data.ConnectionAttemptID
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
	return envelope.Ack.ConnectionAttemptID == data.ConnectionAttemptID, nil
}

func (w *Worker) markConnectionQRCodeAttemptProcessed(ctx context.Context, data WorkerConnectionQRCodeQueueMessage) error {
	if w.redis == nil {
		return nil
	}
	return w.redis.Set(ctx, w.processedConnectionQRCodeAttemptKey(data), "1", 5*time.Minute).Err()
}

func (w *Worker) handleSendMessage(ctx context.Context, msg kafka.Message) (err error) {
	if statusDelete, ok, err := mapToProfileStatusDeleteMessage(msg.Value); err != nil {
		logKafkaPayloadDecodeError(w.cfg.WorkerID, msg, err)
		return nil
	} else if ok {
		return w.handleProfileStatusDelete(ctx, msg, statusDelete)
	}

	if status, ok, err := mapToProfileStatusMessage(msg.Value); err != nil {
		logKafkaPayloadDecodeError(w.cfg.WorkerID, msg, err)
		return nil
	} else if ok {
		return w.handleProfileStatus(ctx, msg, status)
	}

	if profileInfo, ok, err := mapToProfileInfoMessage(msg.Value); err != nil {
		logKafkaPayloadDecodeError(w.cfg.WorkerID, msg, err)
		return nil
	} else if ok {
		return w.handleProfileInfo(ctx, msg, profileInfo)
	}

	data, err := mapToChatMessage(msg.Value)
	if err != nil {
		logKafkaPayloadDecodeError(w.cfg.WorkerID, msg, err)
		return nil
	}

	lifecycle := messageLifecycleFromChatMessage(w.cfg, data)
	ctx, finishLifecycleSpan := startMessageLifecycleSpan(ctx, w.cfg, lifecycle)
	defer func() {
		finishLifecycleSpan(err)
	}()

	recordMessageLifecycle(ctx, w.cfg, map[string]any{
		"stage":        "whatsmeow.outgoing.kafka.received",
		"decision":     "consume_send_message",
		"outcome":      "received",
		"topic":        msg.Topic,
		"partition":    msg.Partition,
		"offset":       msg.Offset,
		"message_id":   data.MessageID,
		"chat_id":      data.ChatID,
		"message_type": chatMessageType(data),
		"kafka_key":    string(msg.Key),
	})

	if err := w.waitOutboundReady(ctx, data, msg); err != nil {
		return err
	}

	claim, err := w.claimOutboundMessage(ctx, chatMessageClaimID(data), data, msg)
	if err != nil {
		return err
	}
	if !claim.Acquired {
		if claim.State == sendIdempotencyStateSucceeded && len(claim.Result) > 0 {
			return w.publishRecoveredOutboundUpdate(ctx, data, claim, msg)
		}
		recordMessageLifecycle(ctx, w.cfg, map[string]any{
			"stage":        "whatsmeow.outgoing.claim.duplicate",
			"decision":     "claim_message",
			"outcome":      "skipped",
			"reason":       "duplicate_message",
			"claim_id":     claim.ID,
			"claim_state":  claim.State,
			"message_id":   data.MessageID,
			"chat_id":      data.ChatID,
			"message_type": chatMessageType(data),
		})
		return nil
	}
	startedAt := time.Now()
	result, err := w.whatsapp.SendChatMessage(ctx, data)
	if err != nil {
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
			_ = w.publishSendDLQ(ctx, msg, data, "status_publish_failed", statusErr)
			return statusErr
		}
		w.completeOutboundClaim(ctx, claim, sendIdempotencyStateFailed, nil, err)
		return nil
	}
	w.completeOutboundClaim(ctx, claim, sendIdempotencyStateSucceeded, result, nil)
	recordMessageLifecycle(ctx, w.cfg, map[string]any{
		"stage":        "whatsmeow.outgoing.update.publish.start",
		"decision":     "publish_update_message",
		"outcome":      "started",
		"topic":        topicUpdateMessage,
		"message_id":   data.MessageID,
		"chat_id":      data.ChatID,
		"message_type": chatMessageType(data),
	})
	if err := w.kafka.SendJSON(ctx, topicUpdateMessage, data.MessageID, UpdateMessage{Message: result, Data: data}); err != nil {
		log.Printf(
			"whatsmeow send update publish failed worker_id=%s source_topic=%s partition=%d offset=%d message_id=%s chat_id=%s message_type=%s topic=%s error=%v",
			w.cfg.WorkerID,
			msg.Topic,
			msg.Partition,
			msg.Offset,
			data.MessageID,
			data.ChatID,
			chatMessageType(data),
			topicUpdateMessage,
			err,
		)
		recordMessageLifecycle(ctx, w.cfg, map[string]any{
			"stage":        "whatsmeow.outgoing.update.publish.error",
			"decision":     "publish_update_message",
			"outcome":      "error",
			"reason":       "producer_send_failed",
			"level":        "error",
			"topic":        topicUpdateMessage,
			"message_id":   data.MessageID,
			"chat_id":      data.ChatID,
			"message_type": chatMessageType(data),
			"error":        err.Error(),
		})
		_ = w.publishSendDLQ(ctx, msg, data, "update_publish_failed_after_send_ack", err)
		return err
	}
	recordMessageLifecycle(ctx, w.cfg, map[string]any{
		"stage":        "whatsmeow.outgoing.update.publish.success",
		"decision":     "publish_update_message",
		"outcome":      "success",
		"topic":        topicUpdateMessage,
		"message_id":   data.MessageID,
		"chat_id":      data.ChatID,
		"message_type": chatMessageType(data),
	})
	recordMessageLifecycle(ctx, w.cfg, map[string]any{
		"stage":        "whatsmeow.outgoing.kafka.commit.ready",
		"decision":     "commit_send_message",
		"outcome":      "success",
		"topic":        msg.Topic,
		"partition":    msg.Partition,
		"offset":       msg.Offset,
		"message_id":   data.MessageID,
		"chat_id":      data.ChatID,
		"message_type": chatMessageType(data),
	})
	return nil
}

func (w *Worker) waitOutboundReady(ctx context.Context, data ChatMessage, msg kafka.Message) error {
	if err := w.whatsapp.WaitUntilReady(ctx, w.cfg.OutboundReadyTimeout); err != nil {
		recordMessageLifecycle(ctx, w.cfg, map[string]any{
			"stage":        "whatsmeow.outgoing.connection.wait",
			"decision":     "wait_connection_ready",
			"outcome":      "retrying",
			"reason":       "connection_not_ready",
			"level":        "warn",
			"topic":        msg.Topic,
			"partition":    msg.Partition,
			"offset":       msg.Offset,
			"message_id":   data.MessageID,
			"chat_id":      data.ChatID,
			"message_type": chatMessageType(data),
			"timeout_ms":   w.cfg.OutboundReadyTimeout.Milliseconds(),
			"error":        err.Error(),
		})
		return err
	}
	recordMessageLifecycle(ctx, w.cfg, map[string]any{
		"stage":        "whatsmeow.outgoing.connection.ready",
		"decision":     "wait_connection_ready",
		"outcome":      "success",
		"topic":        msg.Topic,
		"partition":    msg.Partition,
		"offset":       msg.Offset,
		"message_id":   data.MessageID,
		"chat_id":      data.ChatID,
		"message_type": chatMessageType(data),
	})
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
	var data ScheduleMessage
	if err := json.Unmarshal(msg.Value, &data); err != nil {
		logKafkaPayloadDecodeError(w.cfg.WorkerID, msg, err)
		return nil
	}
	if !data.IsValidated {
		return w.publishScheduleStatus(ctx, data, "ignored")
	}
	startedAt := time.Now()
	result, err := w.whatsapp.SendChatMessage(ctx, data.Message)
	if err != nil {
		log.Printf(
			"whatsmeow schedule send failed worker_id=%s topic=%s partition=%d offset=%d schedule_id=%s contact_id=%s message_id=%s chat_id=%s message_type=%s elapsed_ms=%d timeout=%s error=%v",
			w.cfg.WorkerID,
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
		_ = w.publishScheduleStatus(ctx, data, "failed")
		return err
	}
	if err := w.kafka.SendJSON(ctx, topicUpdateMessage, data.Message.MessageID, UpdateMessage{Message: result, Data: data.Message}); err != nil {
		log.Printf("whatsmeow schedule update publish failed worker_id=%s source_topic=%s partition=%d offset=%d schedule_id=%s message_id=%s topic=%s error=%v", w.cfg.WorkerID, msg.Topic, msg.Partition, msg.Offset, data.ScheduleID, data.Message.MessageID, topicUpdateMessage, err)
		return err
	}
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
	lifecycleCtx, finishLifecycleSpan := startMessageLifecycleSpan(ctx, w.cfg, messageLifecycleFromUpsert(w.cfg, &upsert))
	defer func() {
		finishLifecycleSpan(err)
	}()
	recordMessageLifecycle(lifecycleCtx, w.cfg, map[string]any{
		"stage":     "whatsmeow.webhook.kafka.publish.start",
		"decision":  "publish_webhook_upsert",
		"outcome":   "started",
		"topic":     topicUpsertMessage,
		"kafka_key": valueString(upsert.Message["key"], "id"),
	})
	err = w.kafka.SendJSON(lifecycleCtx, topicUpsertMessage, valueString(upsert.Message["key"], "id"), upsert)
	if err != nil {
		recordMessageLifecycle(lifecycleCtx, w.cfg, map[string]any{
			"stage":     "whatsmeow.webhook.kafka.publish.error",
			"decision":  "publish_webhook_upsert",
			"outcome":   "error",
			"reason":    "producer_send_failed",
			"level":     "error",
			"topic":     topicUpsertMessage,
			"kafka_key": valueString(upsert.Message["key"], "id"),
			"error":     err.Error(),
		})
		return err
	}
	recordMessageLifecycle(lifecycleCtx, w.cfg, map[string]any{
		"stage":     "whatsmeow.webhook.kafka.publish.success",
		"decision":  "publish_webhook_upsert",
		"outcome":   "published",
		"topic":     topicUpsertMessage,
		"kafka_key": valueString(upsert.Message["key"], "id"),
	})
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
		recordMessageLifecycle(ctx, w.cfg, map[string]any{
			"stage":      "whatsmeow.outgoing.claim.error",
			"decision":   "claim_message",
			"outcome":    "error",
			"level":      "warn",
			"reason":     "redis_setnx_failed",
			"claim_id":   claimID,
			"message_id": data.MessageID,
			"chat_id":    data.ChatID,
			"error":      err.Error(),
		})
		return outboundSendClaim{ID: claimID, Key: key, Acquired: true, State: sendIdempotencyStateInProgress, Attempts: 1}, nil
	}
	if acquired {
		recordMessageLifecycle(ctx, w.cfg, map[string]any{
			"stage":        "whatsmeow.outgoing.claim.acquired",
			"decision":     "claim_message",
			"outcome":      "success",
			"claim_id":     claimID,
			"claim_state":  sendIdempotencyStateInProgress,
			"message_id":   data.MessageID,
			"chat_id":      data.ChatID,
			"message_type": chatMessageType(data),
			"topic":        msg.Topic,
			"partition":    msg.Partition,
			"offset":       msg.Offset,
		})
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
		recordMessageLifecycle(ctx, w.cfg, map[string]any{
			"stage":        "whatsmeow.outgoing.claim.reacquired",
			"decision":     "claim_message",
			"outcome":      "retrying",
			"claim_id":     claimID,
			"claim_state":  existing.State,
			"attempts":     existing.Attempts,
			"message_id":   data.MessageID,
			"chat_id":      data.ChatID,
			"message_type": chatMessageType(data),
		})
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
	recordMessageLifecycle(ctx, w.cfg, map[string]any{
		"stage":        "whatsmeow.outgoing.claim.duplicate",
		"decision":     "claim_message",
		"outcome":      "skipped",
		"reason":       "claim_exists",
		"claim_id":     claimID,
		"claim_state":  existing.State,
		"attempts":     existing.Attempts,
		"message_id":   data.MessageID,
		"chat_id":      data.ChatID,
		"message_type": chatMessageType(data),
	})
	if existing.State == sendIdempotencyStateSucceeded {
		return claim, nil
	}
	return claim, fmt.Errorf("message send claim is still %s for %s", existing.State, claimID)
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
		recordMessageLifecycle(ctx, w.cfg, map[string]any{
			"stage":       "whatsmeow.outgoing.claim.update.error",
			"decision":    "complete_claim",
			"outcome":     "error",
			"level":       "warn",
			"claim_id":    claim.ID,
			"claim_state": state,
			"error":       err.Error(),
		})
		return
	}
	recordMessageLifecycle(ctx, w.cfg, map[string]any{
		"stage":       "whatsmeow.outgoing.claim.update.success",
		"decision":    "complete_claim",
		"outcome":     "success",
		"claim_id":    claim.ID,
		"claim_state": state,
		"ttl_ms":      ttl.Milliseconds(),
	})
}

func (w *Worker) releaseOutboundClaim(ctx context.Context, claim outboundSendClaim, reason string, cause error) {
	if claim.Key == "" || w.redis == nil {
		return
	}
	if err := w.redis.Del(ctx, claim.Key).Err(); err != nil {
		recordMessageLifecycle(ctx, w.cfg, map[string]any{
			"stage":       "whatsmeow.outgoing.claim.release.error",
			"decision":    "release_claim",
			"outcome":     "error",
			"level":       "warn",
			"claim_id":    claim.ID,
			"claim_state": claim.State,
			"reason":      reason,
			"error":       err.Error(),
		})
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
	recordMessageLifecycle(ctx, w.cfg, payload)
}

func (w *Worker) publishRecoveredOutboundUpdate(ctx context.Context, data ChatMessage, claim outboundSendClaim, msg kafka.Message) error {
	recordMessageLifecycle(ctx, w.cfg, map[string]any{
		"stage":        "whatsmeow.outgoing.update.recover.start",
		"decision":     "publish_update_message",
		"outcome":      "started",
		"reason":       "idempotent_success_replay",
		"claim_id":     claim.ID,
		"message_id":   data.MessageID,
		"chat_id":      data.ChatID,
		"message_type": chatMessageType(data),
	})
	if err := w.kafka.SendJSON(ctx, topicUpdateMessage, data.MessageID, UpdateMessage{Message: claim.Result, Data: data}); err != nil {
		recordMessageLifecycle(ctx, w.cfg, map[string]any{
			"stage":        "whatsmeow.outgoing.update.recover.error",
			"decision":     "publish_update_message",
			"outcome":      "error",
			"reason":       "producer_send_failed",
			"level":        "error",
			"claim_id":     claim.ID,
			"message_id":   data.MessageID,
			"chat_id":      data.ChatID,
			"message_type": chatMessageType(data),
			"error":        err.Error(),
		})
		return err
	}
	recordMessageLifecycle(ctx, w.cfg, map[string]any{
		"stage":        "whatsmeow.outgoing.update.recover.success",
		"decision":     "publish_update_message",
		"outcome":      "success",
		"claim_id":     claim.ID,
		"message_id":   data.MessageID,
		"chat_id":      data.ChatID,
		"message_type": chatMessageType(data),
	})
	recordMessageLifecycle(ctx, w.cfg, map[string]any{
		"stage":        "whatsmeow.outgoing.kafka.commit.ready",
		"decision":     "commit_send_message",
		"outcome":      "success",
		"topic":        msg.Topic,
		"partition":    msg.Partition,
		"offset":       msg.Offset,
		"message_id":   data.MessageID,
		"chat_id":      data.ChatID,
		"message_type": chatMessageType(data),
	})
	return nil
}

func (w *Worker) publishSendDLQ(ctx context.Context, msg kafka.Message, data ChatMessage, reason string, cause error) error {
	topic := topicWorkerSendMessageDLQ(w.cfg.WorkerID)
	payload := map[string]any{
		"worker_id":        w.cfg.WorkerID,
		"account_id":       firstNonEmpty(stringValue(data.Account["id"]), w.cfg.AccountID),
		"message_id":       data.MessageID,
		"chat_id":          data.ChatID,
		"message_type":     chatMessageType(data),
		"reason":           reason,
		"error":            cause.Error(),
		"source_topic":     msg.Topic,
		"source_partition": msg.Partition,
		"source_offset":    msg.Offset,
		"kafka_key":        string(msg.Key),
		"failed_at":        time.Now().UTC().Format(time.RFC3339Nano),
		"payload":          json.RawMessage(msg.Value),
	}
	recordMessageLifecycle(ctx, w.cfg, map[string]any{
		"stage":        "whatsmeow.outgoing.dlq.publish.start",
		"decision":     "publish_dlq",
		"outcome":      "started",
		"topic":        topic,
		"reason":       reason,
		"message_id":   data.MessageID,
		"chat_id":      data.ChatID,
		"message_type": chatMessageType(data),
	})
	if err := w.kafka.SendJSON(ctx, topic, data.MessageID, payload); err != nil {
		recordMessageLifecycle(ctx, w.cfg, map[string]any{
			"stage":        "whatsmeow.outgoing.dlq.publish.error",
			"decision":     "publish_dlq",
			"outcome":      "error",
			"reason":       "producer_send_failed",
			"level":        "error",
			"topic":        topic,
			"message_id":   data.MessageID,
			"chat_id":      data.ChatID,
			"message_type": chatMessageType(data),
			"error":        err.Error(),
		})
		return err
	}
	recordMessageLifecycle(ctx, w.cfg, map[string]any{
		"stage":        "whatsmeow.outgoing.dlq.publish.success",
		"decision":     "publish_dlq",
		"outcome":      "success",
		"topic":        topic,
		"reason":       reason,
		"message_id":   data.MessageID,
		"chat_id":      data.ChatID,
		"message_type": chatMessageType(data),
	})
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
	recordMessageLifecycle(ctx, w.cfg, map[string]any{
		"stage":      "whatsmeow.outgoing.status_failed.publish.start",
		"decision":   "publish_failed_status",
		"outcome":    "started",
		"topic":      topicUpdateMessageStatus,
		"message_id": messageID,
		"chat_id":    chatID,
		"account_id": accountID,
	})
	if err := w.kafka.SendJSON(ctx, topicUpdateMessageStatus, accountID+":"+messageID, update); err != nil {
		log.Printf("whatsmeow send status publish failed worker_id=%s message_id=%s chat_id=%s account_id=%s topic=%s error=%v", w.cfg.WorkerID, messageID, chatID, accountID, topicUpdateMessageStatus, err)
		recordMessageLifecycle(ctx, w.cfg, map[string]any{
			"stage":      "whatsmeow.outgoing.status_failed.publish.error",
			"decision":   "publish_failed_status",
			"outcome":    "error",
			"reason":     "producer_send_failed",
			"level":      "error",
			"topic":      topicUpdateMessageStatus,
			"message_id": messageID,
			"chat_id":    chatID,
			"account_id": accountID,
			"error":      err.Error(),
		})
		return err
	}
	recordMessageLifecycle(ctx, w.cfg, map[string]any{
		"stage":      "whatsmeow.outgoing.status_failed.publish.success",
		"decision":   "publish_failed_status",
		"outcome":    "success",
		"topic":      topicUpdateMessageStatus,
		"message_id": messageID,
		"chat_id":    chatID,
		"account_id": accountID,
	})
	return nil
}

func logKafkaPayloadDecodeError(workerID string, msg kafka.Message, err error) {
	log.Printf("whatsmeow kafka payload decode failed worker_id=%s topic=%s partition=%d offset=%d error=%v", workerID, msg.Topic, msg.Partition, msg.Offset, err)
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
