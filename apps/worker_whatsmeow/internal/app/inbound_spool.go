package app

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	whatsmeowInboundSpoolBatchSize    = int64(50)
	whatsmeowInboundSpoolLoopInterval = time.Second
	whatsmeowInboundSpoolMaxAttempts  = 12
	whatsmeowInboundSpoolBaseDelay    = 500 * time.Millisecond
	whatsmeowInboundSpoolMaxDelay     = 30 * time.Second
)

type InboundMessageSpoolPayload struct {
	Provider      string         `json:"provider"`
	AccountID     string         `json:"account_id"`
	WorkerID      string         `json:"worker_id"`
	EventSource   string         `json:"event_source"`
	DedupeKey     string         `json:"dedupe_key"`
	KafkaTopic    string         `json:"kafka_topic"`
	KafkaKey      string         `json:"kafka_key"`
	Upsert        *UpsertMessage `json:"upsert"`
	RawMeta       map[string]any `json:"raw_meta,omitempty"`
	ReceivedAt    string         `json:"received_at"`
	Attempts      int            `json:"attempts"`
	NextAttemptAt int64          `json:"next_attempt_at,omitempty"`
	LastError     string         `json:"last_error,omitempty"`
}

type inboundMessageParkingPayload struct {
	Provider    string         `json:"provider"`
	AccountID   string         `json:"account_id,omitempty"`
	WorkerID    string         `json:"worker_id,omitempty"`
	EventSource string         `json:"event_source"`
	Reason      string         `json:"reason"`
	Stage       string         `json:"stage"`
	ParkedAt    string         `json:"parked_at"`
	KafkaTopic  string         `json:"kafka_topic,omitempty"`
	KafkaKey    string         `json:"kafka_key,omitempty"`
	RetryCount  int            `json:"retry_count,omitempty"`
	Error       string         `json:"error,omitempty"`
	Upsert      *UpsertMessage `json:"upsert,omitempty"`
	RawMeta     map[string]any `json:"raw_meta,omitempty"`
}

func (m *WhatsAppManager) inboundSpoolStreamKey() string {
	return fmt.Sprintf("inbound:message:whatsmeow:%s:stream", m.cfg.WorkerID)
}

func (m *WhatsAppManager) inboundSpoolParkingSetKey() string {
	return fmt.Sprintf("inbound:message:whatsmeow:%s:parking", m.cfg.WorkerID)
}

func (m *WhatsAppManager) inboundSpoolPayloadHashKey() string {
	return fmt.Sprintf("inbound:message:whatsmeow:%s:payloads", m.cfg.WorkerID)
}

func (m *WhatsAppManager) startInboundSpoolPublisher(ctx context.Context) {
	if m.redis == nil {
		return
	}

	go func() {
		ticker := time.NewTicker(whatsmeowInboundSpoolLoopInterval)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				m.processInboundSpoolBatch(ctx)
			}
		}
	}()
}

func (m *WhatsAppManager) publishInboundKafkaJSONWithSpool(ctx context.Context, topic string, key string, upsert *UpsertMessage, event string, chat string, messageID string) error {
	if m.redis == nil {
		return m.sendInboundKafkaJSONWithRetry(ctx, topic, key, upsert, event, chat, messageID)
	}

	payload := InboundMessageSpoolPayload{
		Provider:    "whatsmeow",
		AccountID:   m.cfg.AccountID,
		WorkerID:    m.cfg.WorkerID,
		EventSource: event,
		DedupeKey:   key,
		KafkaTopic:  topic,
		KafkaKey:    key,
		Upsert:      upsert,
		RawMeta: map[string]any{
			"chat":       chat,
			"message_id": messageID,
			"type":       upsert.Type,
		},
		ReceivedAt: time.Now().UTC().Format(time.RFC3339Nano),
		Attempts:   0,
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	streamID, err := m.redis.XAdd(ctx, &redis.XAddArgs{
		Stream: m.inboundSpoolStreamKey(),
		Values: map[string]any{"payload": string(raw)},
	}).Result()
	if err != nil {
		log.Printf("whatsmeow inbound spool persist failed worker_id=%s event=%s key=%s error=%v", m.cfg.WorkerID, event, key, err)
		return m.sendInboundKafkaJSONWithRetry(ctx, topic, key, upsert, event, chat, messageID)
	}

	if err := m.sendInboundKafkaJSONWithRetry(ctx, topic, key, upsert, event, chat, messageID); err != nil {
		log.Printf("whatsmeow inbound kafka publish deferred worker_id=%s event=%s key=%s stream_id=%s error=%v", m.cfg.WorkerID, event, key, streamID, err)
		return err
	}

	_ = m.redis.XDel(ctx, m.inboundSpoolStreamKey(), streamID).Err()
	return nil
}

func (m *WhatsAppManager) processInboundSpoolBatch(ctx context.Context) {
	entries, err := m.redis.XRangeN(ctx, m.inboundSpoolStreamKey(), "-", "+", whatsmeowInboundSpoolBatchSize).Result()
	if err != nil {
		log.Printf("whatsmeow inbound spool read failed worker_id=%s error=%v", m.cfg.WorkerID, err)
		return
	}

	now := time.Now()
	for _, entry := range entries {
		raw, _ := entry.Values["payload"].(string)
		var payload InboundMessageSpoolPayload
		if err := json.Unmarshal([]byte(raw), &payload); err != nil || payload.Upsert == nil {
			m.parkInboundSpoolPayload(ctx, entry.ID, inboundMessageParkingPayload{
				Provider:    "whatsmeow",
				WorkerID:    m.cfg.WorkerID,
				EventSource: "invalid_stream_payload",
				Reason:      "invalid_stream_payload",
				Stage:       "whatsmeow.inbound_spool.stream",
				ParkedAt:    now.UTC().Format(time.RFC3339Nano),
				RawMeta:     map[string]any{"raw_payload": raw},
			})
			continue
		}

		if payload.NextAttemptAt > 0 && payload.NextAttemptAt > now.UnixMilli() {
			continue
		}

		chat := fmt.Sprint(payload.RawMeta["chat"])
		messageID := fmt.Sprint(payload.RawMeta["message_id"])
		if err := m.sendInboundKafkaJSONWithRetry(ctx, payload.KafkaTopic, payload.KafkaKey, payload.Upsert, payload.EventSource, chat, messageID); err != nil {
			m.deferOrParkInboundSpoolPayload(ctx, entry.ID, payload, err)
			continue
		}

		_ = m.redis.XDel(ctx, m.inboundSpoolStreamKey(), entry.ID).Err()
	}
}

func (m *WhatsAppManager) deferOrParkInboundSpoolPayload(ctx context.Context, streamID string, payload InboundMessageSpoolPayload, publishErr error) {
	attempts := payload.Attempts + 1
	if attempts >= whatsmeowInboundSpoolMaxAttempts {
		m.parkInboundSpoolPayload(ctx, streamID, inboundMessageParkingPayload{
			Provider:    "whatsmeow",
			AccountID:   payload.AccountID,
			WorkerID:    payload.WorkerID,
			EventSource: payload.EventSource,
			Reason:      "retry_exhausted",
			Stage:       "whatsmeow.inbound_spool.publish",
			ParkedAt:    time.Now().UTC().Format(time.RFC3339Nano),
			KafkaTopic:  payload.KafkaTopic,
			KafkaKey:    payload.KafkaKey,
			RetryCount:  attempts,
			Error:       publishErr.Error(),
			Upsert:      payload.Upsert,
			RawMeta:     payload.RawMeta,
		})
		return
	}

	delay := whatsmeowInboundSpoolBaseDelay * time.Duration(1<<attempts)
	if delay > whatsmeowInboundSpoolMaxDelay {
		delay = whatsmeowInboundSpoolMaxDelay
	}
	payload.Attempts = attempts
	payload.LastError = publishErr.Error()
	payload.NextAttemptAt = time.Now().Add(delay).UnixMilli()
	raw, err := json.Marshal(payload)
	if err != nil {
		log.Printf("whatsmeow inbound spool requeue marshal failed worker_id=%s stream_id=%s error=%v", m.cfg.WorkerID, streamID, err)
		return
	}
	newID, err := m.redis.XAdd(ctx, &redis.XAddArgs{
		Stream: m.inboundSpoolStreamKey(),
		Values: map[string]any{"payload": string(raw)},
	}).Result()
	if err != nil {
		log.Printf("whatsmeow inbound spool requeue failed worker_id=%s stream_id=%s error=%v", m.cfg.WorkerID, streamID, err)
		return
	}
	_ = m.redis.XDel(ctx, m.inboundSpoolStreamKey(), streamID).Err()
	log.Printf("whatsmeow inbound spool requeued worker_id=%s old_stream_id=%s new_stream_id=%s attempts=%d next_retry_ms=%d", m.cfg.WorkerID, streamID, newID, attempts, delay.Milliseconds())
}

func (m *WhatsAppManager) parkInboundSpoolPayload(ctx context.Context, streamID string, payload inboundMessageParkingPayload) {
	raw, err := json.Marshal(payload)
	if err != nil {
		log.Printf("whatsmeow inbound spool parking marshal failed worker_id=%s stream_id=%s error=%v", m.cfg.WorkerID, streamID, err)
		return
	}
	member := streamID
	if payload.KafkaKey != "" {
		member = fmt.Sprintf("whatsmeow:%s:%s", m.cfg.WorkerID, payload.KafkaKey)
	}
	if err := m.redis.HSet(ctx, m.inboundSpoolPayloadHashKey(), member, string(raw)).Err(); err != nil {
		log.Printf("whatsmeow inbound spool parking hset failed worker_id=%s stream_id=%s error=%v", m.cfg.WorkerID, streamID, err)
		return
	}
	if err := m.redis.ZAdd(ctx, m.inboundSpoolParkingSetKey(), redis.Z{Score: float64(time.Now().UnixMilli()), Member: member}).Err(); err != nil {
		log.Printf("whatsmeow inbound spool parking zadd failed worker_id=%s stream_id=%s error=%v", m.cfg.WorkerID, streamID, err)
		return
	}
	_ = m.redis.XDel(ctx, m.inboundSpoolStreamKey(), streamID).Err()
	log.Printf("whatsmeow inbound spool parked worker_id=%s stream_id=%s member=%s reason=%s", m.cfg.WorkerID, streamID, member, payload.Reason)
}
