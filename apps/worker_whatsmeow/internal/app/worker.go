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
	cfg        Config
	kafka      *KafkaClient
	redis      *redis.Client
	centrifugo *CentrifugoClient
	balance    *BalanceGRPCClient
	storage    *StorageClient
	whatsapp   *WhatsAppManager
	grpcServer *WorkerConnectionGRPCServer
	httpServer *http.Server
	cancel     context.CancelFunc
	shutdown   sync.Once
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
	grpcServer, err := NewWorkerConnectionGRPCServer(cfg.GRPCAddr, whatsApp, cfg)
	if err != nil {
		return nil, err
	}
	return &Worker{
		cfg:        cfg,
		kafka:      kafkaClient,
		redis:      redisClient,
		centrifugo: centrifugo,
		balance:    balance,
		storage:    storage,
		whatsapp:   whatsApp,
		grpcServer: grpcServer,
	}, nil
}

func (w *Worker) Run(ctx context.Context) error {
	runCtx, cancel := context.WithCancel(ctx)
	w.cancel = cancel

	log.Printf("worker run starting worker_id=%s", w.cfg.WorkerID)
	if err := w.startHTTP(); err != nil {
		return err
	}
	if err := w.grpcServer.Start(); err != nil {
		return err
	}
	if err := w.startConsumers(runCtx); err != nil {
		return err
	}
	w.whatsapp.Bootstrap(runCtx)
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
		if w.whatsapp.IsConnected() {
			writeJSON(resp, http.StatusOK, map[string]any{"status": "connected"})
			return
		}
		writeJSON(resp, http.StatusServiceUnavailable, map[string]any{"status": "disconnected"})
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

func writeJSON(resp http.ResponseWriter, status int, payload any) {
	resp.Header().Set("Content-Type", "application/json")
	resp.WriteHeader(status)
	_ = json.NewEncoder(resp).Encode(payload)
}

func (w *Worker) startConsumers(ctx context.Context) error {
	workerID := w.cfg.WorkerID
	topics := []string{
		topicWorkerSendMessage(workerID),
		topicWorkerScheduleSend(workerID),
		topicWorkerValidatePhone(workerID),
		topicWorkerNotification(workerID),
		topicWorkerWebhook(workerID),
		topicMarkMessageRead,
		topicWorkerConfigUpdate,
	}
	for _, topic := range topics {
		if err := w.kafka.EnsureTopic(ctx, topic, 1, 2); err != nil {
			log.Printf("failed to ensure kafka topic %s: %v", topic, err)
		} else {
			log.Printf("kafka topic ready topic=%s", topic)
		}
	}

	consumers := []struct {
		topic string
		group string
		fn    KafkaMessageHandler
	}{
		{topicWorkerSendMessage(workerID), "group-underchat-whatsmeow-send-" + workerID, w.handleSendMessage},
		{topicWorkerScheduleSend(workerID), "group-underchat-schedule-message-whatsmeow-" + workerID, w.handleScheduleSend},
		{topicWorkerValidatePhone(workerID), "group-underchat-whatsmeow-validate-phone-" + workerID, w.handlePhoneValidation},
		{topicWorkerNotification(workerID), "group-underchat-whatsmeow-notification-send-" + workerID, w.handleNotification},
		{topicWorkerWebhook(workerID), "group-underchat-webhook-integration-whatsmeow-" + workerID, w.handleWebhookIntegration},
		{topicMarkMessageRead, "group-underchat-mark-read-whatsmeow-" + workerID, w.handleMarkRead},
		{topicWorkerConfigUpdate, "group-underchat-worker-config-update-whatsmeow-" + workerID, w.handleWorkerConfigUpdate},
	}
	for _, consumer := range consumers {
		if err := w.kafka.StartConsumer(ctx, consumer.topic, consumer.group, consumer.fn); err != nil {
			return err
		}
		log.Printf("kafka consumer started topic=%s group=%s", consumer.topic, consumer.group)
		time.Sleep(500 * time.Millisecond)
	}
	return nil
}

func (w *Worker) handleSendMessage(ctx context.Context, msg kafka.Message) error {
	if statusDelete, ok, err := mapToProfileStatusDeleteMessage(msg.Value); err != nil {
		return nil
	} else if ok {
		return w.handleProfileStatusDelete(ctx, msg, statusDelete)
	}

	if status, ok, err := mapToProfileStatusMessage(msg.Value); err != nil {
		return nil
	} else if ok {
		return w.handleProfileStatus(ctx, msg, status)
	}

	if profileInfo, ok, err := mapToProfileInfoMessage(msg.Value); err != nil {
		return nil
	} else if ok {
		return w.handleProfileInfo(ctx, msg, profileInfo)
	}

	data, err := mapToChatMessage(msg.Value)
	if err != nil {
		return nil
	}
	if ok := w.claimMessage(ctx, chatMessageClaimID(data)); !ok {
		return nil
	}
	result, err := w.whatsapp.SendChatMessage(ctx, data)
	if err != nil {
		return w.markSendAsNotSent(ctx, data.MessageID, data.ChatID, stringValue(data.Account["id"]), err)
	}
	return w.kafka.SendJSON(ctx, topicUpdateMessage, data.MessageID, UpdateMessage{Message: result, Data: data})
}

func (w *Worker) handleProfileStatus(ctx context.Context, msg kafka.Message, data ProfileStatusMessage) error {
	if data.WorkerID != "" && data.WorkerID != w.cfg.WorkerID {
		return nil
	}
	messageID := firstNonEmpty(data.WorkerProfileStatusID, "profile_status_"+randomHex(8))
	if ok := w.claimMessage(ctx, messageID); !ok {
		return nil
	}
	externalID, err := w.whatsapp.SendProfileStatus(ctx, data)
	if err != nil {
		return w.markSendAsNotSent(ctx, messageID, "", data.AccountID, err)
	}
	if externalID == "" {
		return nil
	}
	return w.kafka.SendJSON(ctx, topicUpdateProfileStatusExternalID, data.WorkerProfileStatusID, map[string]any{
		"worker_profile_status_id": data.WorkerProfileStatusID,
		"external_id":              externalID,
	})
}

func (w *Worker) handleProfileStatusDelete(ctx context.Context, msg kafka.Message, data ProfileStatusDeleteMessage) error {
	if data.WorkerID != "" && data.WorkerID != w.cfg.WorkerID {
		return nil
	}
	messageID := firstNonEmpty(data.WorkerProfileStatusID, "profile_status_delete_"+randomHex(8))
	if ok := w.claimMessage(ctx, "delete:"+messageID+":"+data.ExternalID); !ok {
		return nil
	}
	if err := w.whatsapp.DeleteProfileStatus(ctx, data); err != nil {
		return w.markSendAsNotSent(ctx, messageID, "", data.AccountID, err)
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
	if err := w.whatsapp.UpdateProfileInfo(ctx, data); err != nil {
		return w.markSendAsNotSent(ctx, messageID, "", data.AccountID, err)
	}
	return nil
}

func (w *Worker) handleScheduleSend(ctx context.Context, msg kafka.Message) error {
	var data ScheduleMessage
	if err := json.Unmarshal(msg.Value, &data); err != nil {
		return nil
	}
	if !data.IsValidated {
		return w.publishScheduleStatus(ctx, data, "ignored")
	}
	result, err := w.whatsapp.SendChatMessage(ctx, data.Message)
	if err != nil {
		_ = w.publishScheduleStatus(ctx, data, "failed")
		return err
	}
	if err := w.kafka.SendJSON(ctx, topicUpdateMessage, data.Message.MessageID, UpdateMessage{Message: result, Data: data.Message}); err != nil {
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
	_, err := w.whatsapp.SendChatMessage(ctx, ChatMessage{
		MessageID: "notification_" + data.NotificationID,
		MessageKey: &MessageKey{
			RemoteJID: target,
		},
		Content: map[string]any{
			"type":    MessageTypeText,
			"message": data.MessageWhatsApp,
		},
	})
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

func chatMessageClaimID(data ChatMessage) string {
	if hash := strings.TrimSpace(data.Hash); hash != "" {
		return "hash:" + hash
	}
	if messageID := strings.TrimSpace(data.MessageID); messageID != "" {
		return "message:" + messageID
	}
	return ""
}

func (w *Worker) markSendAsNotSent(ctx context.Context, messageID, chatID, accountID string, err error) error {
	messageID = strings.TrimSpace(messageID)
	accountID = firstNonEmpty(accountID, w.cfg.AccountID)
	log.Printf("whatsmeow send terminal failure message_id=%s chat_id=%s error=%v", messageID, chatID, err)
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
	return w.kafka.SendJSON(ctx, topicUpdateMessageStatus, accountID+":"+messageID, update)
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
