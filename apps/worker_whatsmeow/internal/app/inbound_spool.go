package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strconv"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	whatsmeowInboundSpoolBatchSize    = int64(50)
	whatsmeowInboundSpoolLoopInterval = time.Second
	whatsmeowInboundSpoolRetryWarning = 12
	whatsmeowInboundSpoolBaseDelay    = 500 * time.Millisecond
	whatsmeowInboundSpoolMaxDelay     = 30 * time.Second
	whatsmeowInboundSpoolCleanupBatch = int64(100)
	whatsmeowInboundSpoolCleanupLimit = 400
	whatsmeowInboundSpoolCleanupTTL   = 30 * time.Second
)

const discardObsoleteInboundSpoolIfFenceCurrentScript = `
local current_raw = redis.call('GET', KEYS[1])
if not current_raw then
  return -1
end
local decoded, current = pcall(cjson.decode, current_raw)
if not decoded
  or tostring(current.state or '') ~= 'active'
  or tostring(current.worker_id or '') ~= ARGV[1]
  or (tonumber(current.runtime_generation) or 0) ~= tonumber(ARGV[2])
  or tostring(current.connection_epoch or '') ~= ARGV[3]
  or tostring(current.source_provider or '') ~= ARGV[4] then
  return -1
end
local key_type_reply = redis.call('TYPE', KEYS[2])
local key_type = key_type_reply
if type(key_type_reply) == 'table' then
  key_type = key_type_reply['ok']
end
if key_type == 'stream' and redis.call('XLEN', KEYS[2]) > 0 then
  return 2
end
if key_type == 'zset' and redis.call('ZCARD', KEYS[2]) > 0 then
  return 2
end
if key_type == 'hash' and redis.call('HLEN', KEYS[2]) > 0 then
  return 2
end
local deleted = redis.call('UNLINK', KEYS[2])
redis.call('SREM', KEYS[3], KEYS[2])
if redis.call('SCARD', KEYS[3]) == 0 then
  redis.call('DEL', KEYS[3])
end
return deleted
`

// Move one legacy retry member into the active stream while the active runtime
// fence is still authoritative. The hash value is compared byte-for-byte so a
// concurrently refreshed retry cannot be acknowledged by an older cleanup.
const rehomeInboundRetryIfFenceCurrentScript = `
local current_raw = redis.call('GET', KEYS[1])
if not current_raw then
  return -1
end
local decoded, current = pcall(cjson.decode, current_raw)
if not decoded
  or tostring(current.state or '') ~= 'active'
  or tostring(current.worker_id or '') ~= ARGV[1]
  or (tonumber(current.runtime_generation) or 0) ~= tonumber(ARGV[2])
  or tostring(current.connection_epoch or '') ~= ARGV[3]
  or tostring(current.source_provider or '') ~= ARGV[4] then
  return -1
end

local member = ARGV[5]
local expected_raw = ARGV[6]
local stored_raw = redis.call('HGET', KEYS[3], member)
if not stored_raw then
  redis.call('ZREM', KEYS[2], member)
  if redis.call('ZCARD', KEYS[2]) == 0 then
    redis.call('UNLINK', KEYS[2])
    redis.call('SREM', KEYS[9], KEYS[2])
  end
  if redis.call('HLEN', KEYS[3]) == 0 then
    redis.call('UNLINK', KEYS[3])
    redis.call('SREM', KEYS[9], KEYS[3])
  end
  return 0
end
if stored_raw ~= expected_raw then
  return 3
end

if ARGV[7] ~= '' then
  redis.call('XADD', KEYS[4], '*', 'payload', ARGV[7])
  redis.call('SADD', KEYS[9], KEYS[4], KEYS[5], KEYS[6], KEYS[7], KEYS[8])
elseif ARGV[8] ~= '' then
  local redis_time = redis.call('TIME')
  local now = (tonumber(redis_time[1]) * 1000) + math.floor(tonumber(redis_time[2]) / 1000)
  redis.call('HSET', KEYS[8], ARGV[8], ARGV[9])
  redis.call('ZADD', KEYS[7], now, ARGV[8])
  redis.call('SADD', KEYS[9], KEYS[7], KEYS[8])
end
redis.call('ZREM', KEYS[2], member)
redis.call('HDEL', KEYS[3], member)
if redis.call('ZCARD', KEYS[2]) == 0 then
  redis.call('UNLINK', KEYS[2])
  redis.call('SREM', KEYS[9], KEYS[2])
end
if redis.call('HLEN', KEYS[3]) == 0 then
  redis.call('UNLINK', KEYS[3])
  redis.call('SREM', KEYS[9], KEYS[3])
end
return 1
`

// Remove a malformed stream entry only while the exact active runtime remains
// authoritative. This closes the check/delete race where a replacement epoch
// could otherwise inherit an entry after the old runtime had decided to
// discard it.
const discardInboundStreamEntryIfFenceCurrentScript = `
local current_raw = redis.call('GET', KEYS[1])
if not current_raw then
  return -1
end
local decoded, current = pcall(cjson.decode, current_raw)
if not decoded
  or tostring(current.state or '') ~= 'active'
  or tostring(current.worker_id or '') ~= ARGV[1]
  or (tonumber(current.runtime_generation) or 0) ~= tonumber(ARGV[2])
  or tostring(current.connection_epoch or '') ~= ARGV[3]
  or tostring(current.source_provider or '') ~= ARGV[4] then
  return -1
end
return redis.call('XDEL', KEYS[2], ARGV[5])
`

// Copy an obsolete stream entry into the active stream and delete the source
// only if the destination runtime fence is still current at the exact Redis
// write. This prevents a late cleanup from creating a newly stranded stream
// after a replacement runtime already finished its reconciliation pass.
const rehomeInboundStreamEntryIfFenceCurrentScript = `
local current_raw = redis.call('GET', KEYS[1])
if not current_raw then
  return -1
end
local decoded, current = pcall(cjson.decode, current_raw)
if not decoded
  or tostring(current.state or '') ~= 'active'
  or tostring(current.worker_id or '') ~= ARGV[1]
  or (tonumber(current.runtime_generation) or 0) ~= tonumber(ARGV[2])
  or tostring(current.connection_epoch or '') ~= ARGV[3]
  or tostring(current.source_provider or '') ~= ARGV[4] then
  return -1
end

local entries = redis.call('XRANGE', KEYS[2], ARGV[5], ARGV[5], 'COUNT', 1)
if #entries == 0 then
  return 0
end
local fields = entries[1][2]
local stored_payload = nil
for index = 1, #fields, 2 do
  if fields[index] == 'payload' then
    stored_payload = fields[index + 1]
    break
  end
end
if stored_payload ~= ARGV[6] then
  return 3
end

redis.call('XADD', KEYS[3], '*', 'payload', ARGV[7])
redis.call('SADD', KEYS[4], KEYS[3])
redis.call('XDEL', KEYS[2], ARGV[5])
return 1
`

// Atomically rescue one legacy provider-parking member into the active stream.
// Invalid records pass an empty destination payload and are removed instead of
// being copied into another terminal store.
const rehomeInboundParkingIfFenceCurrentScript = `
local current_raw = redis.call('GET', KEYS[1])
if not current_raw then
  return -1
end
local decoded, current = pcall(cjson.decode, current_raw)
if not decoded
  or tostring(current.state or '') ~= 'active'
  or tostring(current.worker_id or '') ~= ARGV[1]
  or (tonumber(current.runtime_generation) or 0) ~= tonumber(ARGV[2])
  or tostring(current.connection_epoch or '') ~= ARGV[3]
  or tostring(current.source_provider or '') ~= ARGV[4] then
  return -1
end

local member = ARGV[5]
local expected_raw = ARGV[6]
local stored_raw = redis.call('HGET', KEYS[3], member)
if not stored_raw then
  redis.call('ZREM', KEYS[2], member)
  if redis.call('ZCARD', KEYS[2]) == 0 then
    redis.call('UNLINK', KEYS[2])
    redis.call('SREM', KEYS[5], KEYS[2])
  end
  if redis.call('HLEN', KEYS[3]) == 0 then
    redis.call('UNLINK', KEYS[3])
    redis.call('SREM', KEYS[5], KEYS[3])
  end
  return 0
end
if stored_raw ~= expected_raw then
  return 3
end

local migrated = 2
if ARGV[7] ~= '' then
  redis.call('XADD', KEYS[4], '*', 'payload', ARGV[7])
  redis.call('SADD', KEYS[5], KEYS[4])
  migrated = 1
end
redis.call('ZREM', KEYS[2], member)
redis.call('HDEL', KEYS[3], member)
if redis.call('ZCARD', KEYS[2]) == 0 then
  redis.call('UNLINK', KEYS[2])
  redis.call('SREM', KEYS[5], KEYS[2])
end
if redis.call('HLEN', KEYS[3]) == 0 then
  redis.call('UNLINK', KEYS[3])
  redis.call('SREM', KEYS[5], KEYS[3])
end
return migrated
`

// Move a failed stream entry into the delayed-retry ledger before deleting it.
// Keeping delayed retries outside the live stream prevents a batch of future
// retries from head-of-line blocking newly received realtime messages.
const deferInboundSpoolIfFenceCurrentScript = `
local current_raw = redis.call('GET', KEYS[1])
if not current_raw then
  return -1
end
local decoded, current = pcall(cjson.decode, current_raw)
if not decoded
  or tostring(current.state or '') ~= 'active'
  or tostring(current.worker_id or '') ~= ARGV[1]
  or (tonumber(current.runtime_generation) or 0) ~= tonumber(ARGV[2])
  or tostring(current.connection_epoch or '') ~= ARGV[3]
  or tostring(current.source_provider or '') ~= ARGV[4] then
  return -1
end

local entries = redis.call('XRANGE', KEYS[2], ARGV[5], ARGV[5], 'COUNT', 1)
if #entries == 0 then
  return 0
end
local fields = entries[1][2]
local stored_payload = nil
for index = 1, #fields, 2 do
  if fields[index] == 'payload' then
    stored_payload = fields[index + 1]
    break
  end
end
if stored_payload ~= ARGV[6] then
  return 3
end

local redis_time = redis.call('TIME')
local now = (tonumber(redis_time[1]) * 1000) + math.floor(tonumber(redis_time[2]) / 1000)
redis.call('HSET', KEYS[4], ARGV[7], ARGV[8])
redis.call('ZADD', KEYS[3], now + tonumber(ARGV[9]), ARGV[7])
redis.call('SADD', KEYS[5], KEYS[2], KEYS[3], KEYS[4])
redis.call('XDEL', KEYS[2], ARGV[5])
return 1
`

// Promote only retries that are due according to Redis' shared clock. The
// promotion and source removal are one transaction, so a crash cannot lose an
// event between the delayed ledger and the live stream.
const promoteDueInboundSpoolIfFenceCurrentScript = `
local current_raw = redis.call('GET', KEYS[1])
if not current_raw then
  return {-1}
end
local decoded, current = pcall(cjson.decode, current_raw)
if not decoded
  or tostring(current.state or '') ~= 'active'
  or tostring(current.worker_id or '') ~= ARGV[1]
  or (tonumber(current.runtime_generation) or 0) ~= tonumber(ARGV[2])
  or tostring(current.connection_epoch or '') ~= ARGV[3]
  or tostring(current.source_provider or '') ~= ARGV[4] then
  return {-1}
end

local redis_time = redis.call('TIME')
local now = (tonumber(redis_time[1]) * 1000) + math.floor(tonumber(redis_time[2]) / 1000)
local limit = tonumber(ARGV[5])
local orphan_cursor_field = '\0underchat:orphan-scan-cursor:v1'
local due_limit = limit
if limit > 1 then
  -- Reserve one slot for an orphaned hash payload so a permanently saturated
  -- due zset cannot starve ledger repair forever.
  due_limit = limit - 1
end
local members = redis.call('ZRANGEBYSCORE', KEYS[2], '-inf', now, 'LIMIT', 0, due_limit)
local promoted = 0
for _, member in ipairs(members) do
  local payload = redis.call('HGET', KEYS[3], member)
  if payload then
    local payload_decoded, retry_payload = pcall(cjson.decode, payload)
    if payload_decoded and type(retry_payload) == 'table' then
      retry_payload.next_attempt_at = nil
      payload = cjson.encode(retry_payload)
    end
    redis.call('XADD', KEYS[4], '*', 'payload', payload)
    promoted = promoted + 1
  end
  redis.call('ZREM', KEYS[2], member)
  redis.call('HDEL', KEYS[3], member)
end
if promoted < limit then
  -- Persist the opaque HSCAN cursor in the same hash. Restarting every tick at
  -- cursor zero can strand an orphan indefinitely when the first buckets are
  -- occupied by valid future retries.
  local orphan_cursor = redis.call('HGET', KEYS[3], orphan_cursor_field) or '0'
  local orphan_scan = redis.call('HSCAN', KEYS[3], orphan_cursor, 'MATCH', '*', 'COUNT', limit)
  local next_orphan_cursor = tostring(orphan_scan[1])
  local orphan_fields = orphan_scan[2]
  for index = 1, #orphan_fields, 2 do
    if promoted >= limit then
      break
    end
    local member = orphan_fields[index]
    local payload = orphan_fields[index + 1]
    if member ~= orphan_cursor_field and not redis.call('ZSCORE', KEYS[2], member) then
      local payload_decoded, retry_payload = pcall(cjson.decode, payload)
      if payload_decoded and type(retry_payload) == 'table' then
        retry_payload.next_attempt_at = nil
        payload = cjson.encode(retry_payload)
      end
      redis.call('XADD', KEYS[4], '*', 'payload', payload)
      redis.call('HDEL', KEYS[3], member)
      promoted = promoted + 1
    end
  end
  if next_orphan_cursor == '0' then
    redis.call('HDEL', KEYS[3], orphan_cursor_field)
  else
    redis.call('HSET', KEYS[3], orphan_cursor_field, next_orphan_cursor)
  end
end
if promoted > 0 then
  redis.call('SADD', KEYS[5], KEYS[4])
end
return {promoted}
`

type InboundMessageSpoolPayload struct {
	Provider          string         `json:"provider"`
	SourceProvider    string         `json:"source_provider"`
	AccountID         string         `json:"account_id"`
	WorkerID          string         `json:"worker_id"`
	RuntimeGeneration int            `json:"runtime_generation"`
	ConnectionEpoch   string         `json:"connection_epoch"`
	EventSource       string         `json:"event_source"`
	DedupeKey         string         `json:"dedupe_key"`
	KafkaTopic        string         `json:"kafka_topic"`
	KafkaKey          string         `json:"kafka_key"`
	Upsert            *UpsertMessage `json:"upsert"`
	RawMeta           map[string]any `json:"raw_meta,omitempty"`
	ReceivedAt        string         `json:"received_at"`
	Attempts          int            `json:"attempts"`
	NextAttemptAt     int64          `json:"next_attempt_at,omitempty"`
	LastError         string         `json:"last_error,omitempty"`
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

func saturatingInboundSpoolAttempt(value int) int {
	if value < 0 {
		return 1
	}
	maxInt := int(^uint(0) >> 1)
	if value >= maxInt {
		return maxInt
	}
	return value + 1
}

func inboundSpoolRetryDelay(attempts int) time.Duration {
	if attempts <= 0 {
		return whatsmeowInboundSpoolBaseDelay
	}
	delay := whatsmeowInboundSpoolBaseDelay
	for step := 0; step < attempts && delay < whatsmeowInboundSpoolMaxDelay; step++ {
		if delay >= whatsmeowInboundSpoolMaxDelay/2 {
			return whatsmeowInboundSpoolMaxDelay
		}
		delay *= 2
	}
	if delay > whatsmeowInboundSpoolMaxDelay {
		return whatsmeowInboundSpoolMaxDelay
	}
	return delay
}

func (m *WhatsAppManager) inboundSpoolStreamKey(scope whatsAppRuntimeFence) string {
	return fmt.Sprintf(
		"inbound:message:whatsmeow:%s:generation:%d:epoch:%s:stream",
		m.cfg.WorkerID,
		scope.RuntimeGeneration,
		scope.ConnectionEpoch,
	)
}

func (m *WhatsAppManager) inboundSpoolRetrySetKey(scope whatsAppRuntimeFence) string {
	return fmt.Sprintf(
		"inbound:message:whatsmeow:%s:generation:%d:epoch:%s:retry",
		m.cfg.WorkerID,
		scope.RuntimeGeneration,
		scope.ConnectionEpoch,
	)
}

func (m *WhatsAppManager) inboundSpoolRetryPayloadHashKey(scope whatsAppRuntimeFence) string {
	return fmt.Sprintf(
		"inbound:message:whatsmeow:%s:generation:%d:epoch:%s:retry-payloads",
		m.cfg.WorkerID,
		scope.RuntimeGeneration,
		scope.ConnectionEpoch,
	)
}

func (m *WhatsAppManager) inboundSpoolParkingSetKey(scope whatsAppRuntimeFence) string {
	return fmt.Sprintf(
		"inbound:message:whatsmeow:%s:generation:%d:epoch:%s:parking",
		m.cfg.WorkerID,
		scope.RuntimeGeneration,
		scope.ConnectionEpoch,
	)
}

func (m *WhatsAppManager) inboundSpoolPayloadHashKey(scope whatsAppRuntimeFence) string {
	return fmt.Sprintf(
		"inbound:message:whatsmeow:%s:generation:%d:epoch:%s:payloads",
		m.cfg.WorkerID,
		scope.RuntimeGeneration,
		scope.ConnectionEpoch,
	)
}

func (m *WhatsAppManager) inboundSpoolIndexKey() string {
	return fmt.Sprintf("inbound:message:spool-index:v1:%s", m.cfg.WorkerID)
}

func (m *WhatsAppManager) inboundSpoolScopeKeys(scope whatsAppRuntimeFence) []string {
	return []string{
		m.inboundSpoolStreamKey(scope),
		m.inboundSpoolRetrySetKey(scope),
		m.inboundSpoolRetryPayloadHashKey(scope),
		m.inboundSpoolParkingSetKey(scope),
		m.inboundSpoolPayloadHashKey(scope),
	}
}

func (m *WhatsAppManager) inboundSpoolLegacyKeys() []string {
	suffixes := []string{
		"stream",
		"retry",
		"retry-payloads",
		"parking",
		"payloads",
	}
	keys := make([]string, 0, 3*len(suffixes))
	for _, provider := range []string{"wwebjs", "baileys", "whatsmeow"} {
		for _, suffix := range suffixes {
			keys = append(
				keys,
				fmt.Sprintf(
					"inbound:message:%s:%s:%s",
					provider,
					m.cfg.WorkerID,
					suffix,
				),
			)
		}
	}
	return keys
}

func (m *WhatsAppManager) isIndexedInboundSpoolKey(key string) bool {
	for _, provider := range []string{"wwebjs", "baileys", "whatsmeow"} {
		prefix := fmt.Sprintf("inbound:message:%s:%s:", provider, m.cfg.WorkerID)
		if !strings.HasPrefix(key, prefix) {
			continue
		}
		remainder := strings.TrimPrefix(key, prefix)
		if isInboundSpoolKeySuffix(remainder) {
			return true
		}
		if !strings.HasPrefix(remainder, "generation:") {
			return false
		}
		generationAndEpoch := strings.TrimPrefix(remainder, "generation:")
		epochSeparator := strings.Index(generationAndEpoch, ":epoch:")
		if epochSeparator <= 0 {
			return false
		}
		generation, err := strconv.Atoi(generationAndEpoch[:epochSeparator])
		if err != nil || generation <= 0 {
			return false
		}
		epochAndSuffix := generationAndEpoch[epochSeparator+len(":epoch:"):]
		suffixSeparator := strings.LastIndex(epochAndSuffix, ":")
		return suffixSeparator > 0 &&
			strings.TrimSpace(epochAndSuffix[:suffixSeparator]) != "" &&
			isInboundSpoolKeySuffix(epochAndSuffix[suffixSeparator+1:])
	}
	return false
}

func isInboundSpoolKeySuffix(suffix string) bool {
	switch suffix {
	case "stream", "retry", "retry-payloads", "parking", "payloads":
		return true
	default:
		return false
	}
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
				scope, ok := m.currentInboundConnectionScope()
				if !ok {
					continue
				}
				m.processInboundSpoolBatch(withInboundConnectionScope(ctx, scope))
			}
		}
	}()
}

func (m *WhatsAppManager) scheduleInboundSpoolCleanup(
	active whatsAppRuntimeFence,
	previous *whatsAppRuntimeFence,
) {
	if m.redis == nil || !active.isValid() {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), whatsmeowInboundSpoolCleanupTTL)
		defer cancel()
		if previous != nil &&
			previous.isValid() &&
			!sameWhatsAppRuntimeFenceIdentity(active, *previous) {
			m.rehomeInboundSpoolScope(ctx, active, m.inboundSpoolScopePrefix(*previous))
		}
		if ctx.Err() == nil {
			m.discardObsoleteInboundSpools(ctx, active)
		}
	}()
}

func (m *WhatsAppManager) publishInboundKafkaJSONWithSpool(ctx context.Context, topic string, key string, upsert *UpsertMessage, event string, chat string, messageID string) error {
	if upsert == nil {
		return fmt.Errorf("inbound upsert is required")
	}
	scope, ok := inboundConnectionScopeFromContext(ctx)
	if !ok || !m.isInboundConnectionScopeCurrent(ctx) {
		return nil
	}
	upsert.AccountID = firstNonEmpty(upsert.AccountID, m.cfg.AccountID)
	upsert.WorkerID = firstNonEmpty(upsert.WorkerID, m.cfg.WorkerID)
	upsert.SourceProvider = "whatsmeow"
	upsert.RuntimeGeneration = scope.RuntimeGeneration
	upsert.ConnectionEpoch = scope.ConnectionEpoch
	if !m.isUpsertWithinConnectionCutoff(upsert, scope) {
		return nil
	}
	effectLease, err := m.acquireRuntimeEffectLease(ctx, scope)
	if err != nil {
		return fmt.Errorf("acquire inbound runtime effect lease: %w", err)
	}
	if effectLease == nil {
		return nil
	}
	defer func() {
		releaseCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		if _, releaseErr := effectLease.release(releaseCtx); releaseErr != nil {
			log.Printf(
				"whatsmeow inbound runtime effect lease release failed worker_id=%s error_code=%s",
				m.cfg.WorkerID,
				safeOperationalErrorCode(releaseErr),
			)
		}
		cancel()
	}()
	eventID := ensureInboundEventIdentity(upsert, event)
	if m.redis == nil {
		return m.sendInboundKafkaJSONWithRetry(ctx, topic, key, upsert, event, chat, messageID)
	}

	payload := InboundMessageSpoolPayload{
		Provider:          "whatsmeow",
		SourceProvider:    "whatsmeow",
		AccountID:         m.cfg.AccountID,
		WorkerID:          m.cfg.WorkerID,
		RuntimeGeneration: scope.RuntimeGeneration,
		ConnectionEpoch:   scope.ConnectionEpoch,
		EventSource:       event,
		DedupeKey:         eventID,
		KafkaTopic:        topic,
		KafkaKey:          key,
		Upsert:            upsert,
		RawMeta: map[string]any{
			"chat":       chat,
			"message_id": messageID,
			"type":       upsert.Type,
			"event_id":   eventID,
		},
		ReceivedAt: time.Now().UTC().Format(time.RFC3339Nano),
		Attempts:   0,
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	_, err = m.redis.TxPipelined(ctx, func(pipe redis.Pipeliner) error {
		pipe.XAdd(ctx, &redis.XAddArgs{
			Stream: m.inboundSpoolStreamKey(scope),
			Values: map[string]any{"payload": string(raw)},
		})
		pipe.SAdd(ctx, m.inboundSpoolIndexKey(), m.inboundSpoolScopeKeys(scope))
		return nil
	})
	if err != nil {
		log.Printf("whatsmeow inbound spool persist failed worker_id=%s event=%s key_hash=%s error_code=%s", m.cfg.WorkerID, event, hashConnectionFlowIdentifier(key), safeOperationalErrorCode(err))
		// Fail closed. Losing this event is explicitly safer than publishing
		// outside the durable spool and replaying it after reconnect.
		return fmt.Errorf("persist inbound spool before Kafka publish: %w", err)
	}

	// Persisted entries are published exclusively by the spool loop. Sending
	// inline here races the loop's XRANGE and can emit the same physical event
	// twice before either path removes it.
	return nil
}

func (m *WhatsAppManager) processInboundSpoolBatch(ctx context.Context) {
	scope, ok := inboundConnectionScopeFromContext(ctx)
	if !ok || !m.isInboundConnectionScopeCurrent(ctx) {
		return
	}
	effectLease, err := m.acquireRuntimeEffectLease(ctx, scope)
	if err != nil || effectLease == nil {
		if err != nil {
			log.Printf(
				"whatsmeow inbound spool effect lease failed worker_id=%s error_code=%s",
				m.cfg.WorkerID,
				safeOperationalErrorCode(err),
			)
		}
		return
	}
	defer func() {
		releaseCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		if _, releaseErr := effectLease.release(releaseCtx); releaseErr != nil {
			log.Printf(
				"whatsmeow inbound spool effect lease release failed worker_id=%s error_code=%s",
				m.cfg.WorkerID,
				safeOperationalErrorCode(releaseErr),
			)
		}
		cancel()
	}()
	streamKey := m.inboundSpoolStreamKey(scope)
	promoted, err := m.promoteDueInboundSpoolRetries(ctx, scope)
	if err != nil {
		log.Printf(
			"whatsmeow inbound spool retry promotion failed worker_id=%s error_code=%s",
			m.cfg.WorkerID,
			safeOperationalErrorCode(err),
		)
		return
	}
	if promoted < 0 {
		return
	}
	entries, err := m.redis.XRangeN(ctx, streamKey, "-", "+", whatsmeowInboundSpoolBatchSize).Result()
	if err != nil {
		log.Printf("whatsmeow inbound spool read failed worker_id=%s error_code=%s", m.cfg.WorkerID, safeOperationalErrorCode(err))
		return
	}

	now := time.Now()
	for _, entry := range entries {
		raw, _ := inboundSpoolRawPayload(entry.Values["payload"])
		var payload InboundMessageSpoolPayload
		if err := json.Unmarshal([]byte(raw), &payload); err != nil || payload.Upsert == nil {
			log.Printf(
				"whatsmeow inbound spool invalid payload discarded worker_id=%s stream_id_hash=%s reason=invalid_stream_payload",
				m.cfg.WorkerID,
				hashConnectionFlowIdentifier(entry.ID),
			)
			status, discardErr := m.discardInboundStreamEntryIfFenceCurrent(ctx, scope, streamKey, entry.ID)
			if discardErr != nil {
				log.Printf(
					"whatsmeow inbound spool invalid payload cleanup failed worker_id=%s stream_id_hash=%s error_code=%s",
					m.cfg.WorkerID,
					hashConnectionFlowIdentifier(entry.ID),
					safeOperationalErrorCode(discardErr),
				)
			}
			if status < 0 {
				return
			}
			continue
		}
		if payload.RuntimeGeneration != scope.RuntimeGeneration ||
			payload.ConnectionEpoch != scope.ConnectionEpoch ||
			payload.SourceProvider != scope.SourceProvider {
			log.Printf(
				"whatsmeow inbound spool mismatched fence payload discarded worker_id=%s stream_id_hash=%s payload_generation=%d payload_epoch=%s payload_provider=%s",
				m.cfg.WorkerID,
				hashConnectionFlowIdentifier(entry.ID),
				payload.RuntimeGeneration,
				payload.ConnectionEpoch,
				payload.SourceProvider,
			)
			status, discardErr := m.discardInboundStreamEntryIfFenceCurrent(ctx, scope, streamKey, entry.ID)
			if discardErr != nil {
				log.Printf(
					"whatsmeow inbound spool mismatched fence cleanup failed worker_id=%s stream_id_hash=%s error_code=%s",
					m.cfg.WorkerID,
					hashConnectionFlowIdentifier(entry.ID),
					safeOperationalErrorCode(discardErr),
				)
			}
			if status < 0 {
				return
			}
			continue
		}

		if payload.NextAttemptAt > 0 && payload.NextAttemptAt > now.UnixMilli() {
			continue
		}

		chat := fmt.Sprint(payload.RawMeta["chat"])
		messageID := fmt.Sprint(payload.RawMeta["message_id"])
		publishedKey := streamKey + "\x00" + entry.ID
		if !m.inboundSpoolWasPublished(publishedKey) {
			if !m.isInboundConnectionScopeCurrent(ctx) {
				return
			}
			if err := m.sendInboundKafkaJSONWithRetry(ctx, payload.KafkaTopic, payload.KafkaKey, payload.Upsert, payload.EventSource, chat, messageID); err != nil {
				m.deferInboundSpoolPayload(ctx, scope, streamKey, entry.ID, raw, payload, err)
				continue
			}
			// sendInboundKafkaJSONWithRetry intentionally treats a revoked
			// inbound scope as a quiet stop for non-spooled callers. The spool
			// must distinguish that stop from a Kafka ACK or it could delete an
			// event that was never published during runtime cutover.
			if !m.isInboundConnectionScopeCurrent(ctx) {
				return
			}
			m.markInboundSpoolPublished(publishedKey)
		}

		if !m.isInboundConnectionScopeCurrent(ctx) {
			return
		}
		if err := m.redis.XDel(ctx, streamKey, entry.ID).Err(); err != nil {
			log.Printf("whatsmeow inbound spool published cleanup failed worker_id=%s stream_id_hash=%s error_code=%s", m.cfg.WorkerID, hashConnectionFlowIdentifier(entry.ID), safeOperationalErrorCode(err))
			continue
		}
		m.clearInboundSpoolPublished(publishedKey)
	}
}

func (m *WhatsAppManager) deferInboundSpoolPayload(
	ctx context.Context,
	scope whatsAppRuntimeFence,
	streamKey string,
	streamID string,
	expectedRaw string,
	payload InboundMessageSpoolPayload,
	publishErr error,
) {
	attempts := saturatingInboundSpoolAttempt(payload.Attempts)
	delay := inboundSpoolRetryDelay(attempts)
	if attempts == whatsmeowInboundSpoolRetryWarning ||
		(attempts > whatsmeowInboundSpoolRetryWarning &&
			attempts%whatsmeowInboundSpoolRetryWarning == 0) {
		log.Printf(
			"whatsmeow inbound spool Kafka remains unavailable; durable retry continues worker_id=%s stream_id_hash=%s dedupe_key_hash=%s attempts=%d next_retry_ms=%d error_code=%s",
			m.cfg.WorkerID,
			hashConnectionFlowIdentifier(streamID),
			hashConnectionFlowIdentifier(payload.DedupeKey),
			attempts,
			delay.Milliseconds(),
			safeOperationalErrorCode(publishErr),
		)
	}
	payload.Attempts = attempts
	payload.LastError = safeOperationalErrorCode(publishErr)
	payload.NextAttemptAt = time.Now().Add(delay).UnixMilli()
	raw, err := json.Marshal(payload)
	if err != nil {
		log.Printf("whatsmeow inbound spool requeue marshal failed worker_id=%s stream_id_hash=%s error_code=%s", m.cfg.WorkerID, hashConnectionFlowIdentifier(streamID), safeOperationalErrorCode(err))
		return
	}
	upsertEventID := ""
	if payload.Upsert != nil {
		upsertEventID = strings.TrimSpace(payload.Upsert.EventID)
	}
	retryMember := firstNonEmpty(
		strings.TrimSpace(payload.DedupeKey),
		upsertEventID,
		streamID,
	)
	retryMember = fmt.Sprintf(
		"whatsmeow:%s:%d:%s:%s",
		m.cfg.WorkerID,
		scope.RuntimeGeneration,
		scope.ConnectionEpoch,
		retryMember,
	)
	status, err := m.redis.Eval(
		ctx,
		deferInboundSpoolIfFenceCurrentScript,
		[]string{
			whatsAppRuntimeFenceKey(scope.WorkerID),
			streamKey,
			m.inboundSpoolRetrySetKey(scope),
			m.inboundSpoolRetryPayloadHashKey(scope),
			m.inboundSpoolIndexKey(),
		},
		scope.WorkerID,
		scope.RuntimeGeneration,
		scope.ConnectionEpoch,
		scope.SourceProvider,
		streamID,
		expectedRaw,
		retryMember,
		string(raw),
		delay.Milliseconds(),
	).Int()
	if err != nil {
		log.Printf("whatsmeow inbound spool requeue failed worker_id=%s stream_id_hash=%s error_code=%s", m.cfg.WorkerID, hashConnectionFlowIdentifier(streamID), safeOperationalErrorCode(err))
		return
	}
	switch status {
	case -1:
		log.Printf(
			"whatsmeow inbound spool requeue skipped after fence revocation worker_id=%s stream_id_hash=%s",
			m.cfg.WorkerID,
			hashConnectionFlowIdentifier(streamID),
		)
	case 1:
		log.Printf(
			"whatsmeow inbound spool deferred worker_id=%s stream_id_hash=%s retry_member_hash=%s attempts=%d next_retry_ms=%d",
			m.cfg.WorkerID,
			hashConnectionFlowIdentifier(streamID),
			hashConnectionFlowIdentifier(retryMember),
			attempts,
			delay.Milliseconds(),
		)
	case 3:
		log.Printf(
			"whatsmeow inbound spool requeue skipped after concurrent payload change worker_id=%s stream_id_hash=%s",
			m.cfg.WorkerID,
			hashConnectionFlowIdentifier(streamID),
		)
	}
}

func (m *WhatsAppManager) promoteDueInboundSpoolRetries(
	ctx context.Context,
	scope whatsAppRuntimeFence,
) (int, error) {
	if m.redis == nil || !scope.isValid() {
		return -1, nil
	}
	value, err := m.redis.Eval(
		ctx,
		promoteDueInboundSpoolIfFenceCurrentScript,
		[]string{
			whatsAppRuntimeFenceKey(scope.WorkerID),
			m.inboundSpoolRetrySetKey(scope),
			m.inboundSpoolRetryPayloadHashKey(scope),
			m.inboundSpoolStreamKey(scope),
			m.inboundSpoolIndexKey(),
		},
		scope.WorkerID,
		scope.RuntimeGeneration,
		scope.ConnectionEpoch,
		scope.SourceProvider,
		whatsmeowInboundSpoolBatchSize,
	).Result()
	if err != nil {
		return 0, err
	}
	values, ok := value.([]any)
	if !ok || len(values) != 1 {
		return 0, fmt.Errorf("unexpected inbound retry promotion result: %#v", value)
	}
	promoted, err := strconv.Atoi(fmt.Sprint(values[0]))
	if err != nil {
		return 0, fmt.Errorf("decode inbound retry promotion count: %w", err)
	}
	return promoted, nil
}

func inboundSpoolRawPayload(value any) (string, bool) {
	switch typed := value.(type) {
	case string:
		return typed, strings.TrimSpace(typed) != ""
	case []byte:
		return string(typed), len(typed) > 0
	default:
		return "", false
	}
}

func rehomeInboundSpoolPayload(
	raw string,
	active whatsAppRuntimeFence,
	workerID string,
) (InboundMessageSpoolPayload, string, error) {
	var envelope map[string]any
	decoder := json.NewDecoder(strings.NewReader(raw))
	decoder.UseNumber()
	if err := decoder.Decode(&envelope); err != nil {
		return InboundMessageSpoolPayload{}, "", fmt.Errorf("decode payload: %w", err)
	}
	if envelope == nil {
		return InboundMessageSpoolPayload{}, "", errors.New("payload is not a JSON object")
	}
	recordedWorkerID := strings.TrimSpace(stringValue(envelope["worker_id"]))
	if recordedWorkerID == "" || recordedWorkerID != strings.TrimSpace(workerID) {
		return InboundMessageSpoolPayload{}, "", fmt.Errorf("payload worker_id %q does not match %q", recordedWorkerID, workerID)
	}
	recordedProvider := firstNonEmpty(
		strings.TrimSpace(stringValue(envelope["source_provider"])),
		strings.TrimSpace(stringValue(envelope["provider"])),
	)
	if recordedProvider != "whatsmeow" {
		return InboundMessageSpoolPayload{}, "", fmt.Errorf("payload provider %q is not whatsmeow", recordedProvider)
	}
	upsertMap := asMap(envelope["upsert"])
	if len(upsertMap) == 0 {
		return InboundMessageSpoolPayload{}, "", errors.New("payload upsert is missing")
	}

	// Normalize legacy TypeScript string generations into the Go wire shape and
	// transfer ownership to the active connection. Retry timing belongs to the
	// revoked runtime and must not delay recovery in the replacement runtime.
	envelope["provider"] = "whatsmeow"
	envelope["source_provider"] = "whatsmeow"
	envelope["worker_id"] = strings.TrimSpace(workerID)
	envelope["runtime_generation"] = active.RuntimeGeneration
	envelope["connection_epoch"] = active.ConnectionEpoch
	envelope["attempts"] = 0
	delete(envelope, "next_attempt_at")
	delete(envelope, "last_error")
	upsertMap["worker_id"] = strings.TrimSpace(workerID)
	upsertMap["source_provider"] = "whatsmeow"
	upsertMap["runtime_generation"] = active.RuntimeGeneration
	upsertMap["connection_epoch"] = active.ConnectionEpoch
	envelope["upsert"] = upsertMap

	normalized, err := json.Marshal(envelope)
	if err != nil {
		return InboundMessageSpoolPayload{}, "", fmt.Errorf("normalize payload: %w", err)
	}
	var payload InboundMessageSpoolPayload
	if err := json.Unmarshal(normalized, &payload); err != nil {
		return InboundMessageSpoolPayload{}, "", fmt.Errorf("validate normalized payload: %w", err)
	}
	if payload.Upsert == nil || strings.TrimSpace(payload.KafkaTopic) == "" {
		return InboundMessageSpoolPayload{}, "", errors.New("normalized payload is missing upsert or kafka_topic")
	}
	if payload.Upsert.EventID == "" && strings.TrimSpace(payload.DedupeKey) != "" {
		payload.Upsert.EventID = strings.TrimSpace(payload.DedupeKey)
	}
	identity := ensureInboundEventIdentity(payload.Upsert, payload.EventSource)
	if strings.TrimSpace(payload.DedupeKey) == "" {
		payload.DedupeKey = identity
	}
	if strings.TrimSpace(payload.DedupeKey) == "" {
		return InboundMessageSpoolPayload{}, "", errors.New("normalized payload has no stable event identity")
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return InboundMessageSpoolPayload{}, "", fmt.Errorf("encode normalized payload: %w", err)
	}
	return payload, string(encoded), nil
}

func rehomeInboundParkingPayload(
	raw string,
	active whatsAppRuntimeFence,
	workerID string,
) (InboundMessageSpoolPayload, string, error) {
	var parked inboundMessageParkingPayload
	if err := json.Unmarshal([]byte(raw), &parked); err != nil {
		return InboundMessageSpoolPayload{}, "", fmt.Errorf("decode parking payload: %w", err)
	}
	workerID = strings.TrimSpace(workerID)
	if workerID == "" ||
		strings.TrimSpace(parked.WorkerID) == "" ||
		strings.TrimSpace(parked.WorkerID) != workerID {
		return InboundMessageSpoolPayload{}, "", fmt.Errorf(
			"parking payload worker_id %q does not match %q",
			strings.TrimSpace(parked.WorkerID),
			workerID,
		)
	}
	if provider := strings.TrimSpace(parked.Provider); provider != "whatsmeow" {
		return InboundMessageSpoolPayload{}, "", fmt.Errorf(
			"parking payload provider %q is not whatsmeow",
			provider,
		)
	}
	if parked.Upsert == nil {
		return InboundMessageSpoolPayload{}, "", errors.New("parking payload upsert is missing")
	}
	if strings.TrimSpace(parked.KafkaTopic) == "" {
		return InboundMessageSpoolPayload{}, "", errors.New("parking payload kafka_topic is missing")
	}

	accountID := firstNonEmpty(
		strings.TrimSpace(parked.AccountID),
		strings.TrimSpace(parked.Upsert.AccountID),
	)
	if accountID == "" {
		return InboundMessageSpoolPayload{}, "", errors.New("parking payload account_id is missing")
	}
	eventSource := firstNonEmpty(
		strings.TrimSpace(parked.EventSource),
		"incoming_message",
	)
	parked.Upsert.AccountID = accountID
	parked.Upsert.WorkerID = workerID
	parked.Upsert.SourceProvider = "whatsmeow"
	parked.Upsert.RuntimeGeneration = active.RuntimeGeneration
	parked.Upsert.ConnectionEpoch = active.ConnectionEpoch
	identity := firstNonEmpty(
		strings.TrimSpace(parked.Upsert.EventID),
		strings.TrimSpace(stringValue(parked.RawMeta["event_id"])),
	)
	if identity != "" {
		parked.Upsert.EventID = identity
	} else {
		identity = ensureInboundEventIdentity(parked.Upsert, eventSource)
	}
	if identity == "" {
		return InboundMessageSpoolPayload{}, "", errors.New("parking payload has no stable event identity")
	}
	if parked.RawMeta == nil {
		parked.RawMeta = make(map[string]any)
	}
	parked.RawMeta["event_id"] = identity

	payload := InboundMessageSpoolPayload{
		Provider:          "whatsmeow",
		SourceProvider:    "whatsmeow",
		AccountID:         accountID,
		WorkerID:          workerID,
		RuntimeGeneration: active.RuntimeGeneration,
		ConnectionEpoch:   active.ConnectionEpoch,
		EventSource:       eventSource,
		DedupeKey:         identity,
		KafkaTopic:        strings.TrimSpace(parked.KafkaTopic),
		KafkaKey: firstNonEmpty(
			strings.TrimSpace(parked.KafkaKey),
			strings.TrimSpace(stringValue(parked.RawMeta["chat"])),
			identity,
		),
		Upsert:     parked.Upsert,
		RawMeta:    parked.RawMeta,
		ReceivedAt: firstNonEmpty(strings.TrimSpace(parked.ParkedAt), time.Now().UTC().Format(time.RFC3339Nano)),
		Attempts:   0,
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return InboundMessageSpoolPayload{}, "", fmt.Errorf("encode rehomed parking payload: %w", err)
	}
	return payload, string(encoded), nil
}

func (m *WhatsAppManager) inboundSpoolLegacyWhatsmeowPrefix() string {
	return fmt.Sprintf("inbound:message:whatsmeow:%s", m.cfg.WorkerID)
}

func (m *WhatsAppManager) inboundSpoolScopePrefix(scope whatsAppRuntimeFence) string {
	return strings.TrimSuffix(m.inboundSpoolStreamKey(scope), ":stream")
}

func (m *WhatsAppManager) obsoleteWhatsmeowInboundScopePrefix(
	key string,
	active whatsAppRuntimeFence,
) (string, bool) {
	base := m.inboundSpoolLegacyWhatsmeowPrefix()
	activePrefix := m.inboundSpoolScopePrefix(active)
	for _, suffix := range []string{":stream", ":retry", ":retry-payloads", ":parking", ":payloads"} {
		if !strings.HasSuffix(key, suffix) {
			continue
		}
		prefix := strings.TrimSuffix(key, suffix)
		if prefix == activePrefix {
			return "", false
		}
		if prefix == base || strings.HasPrefix(prefix, base+":generation:") {
			return prefix, true
		}
	}
	return "", false
}

func (m *WhatsAppManager) isObsoleteWhatsmeowInboundStreamKey(key string, active whatsAppRuntimeFence) bool {
	_, obsolete := m.obsoleteWhatsmeowInboundScopePrefix(key, active)
	return obsolete && strings.HasSuffix(key, ":stream")
}

func (m *WhatsAppManager) rehomeInboundSpoolScope(
	ctx context.Context,
	active whatsAppRuntimeFence,
	scopePrefix string,
) {
	if strings.TrimSpace(scopePrefix) == "" || scopePrefix == m.inboundSpoolScopePrefix(active) {
		return
	}
	m.rehomeInboundSpoolStream(ctx, active, scopePrefix+":stream")
	if ctx.Err() != nil || !m.isInboundConnectionScopeCurrent(withInboundConnectionScope(ctx, active)) {
		return
	}
	m.rehomeInboundSpoolRetry(
		ctx,
		active,
		scopePrefix+":retry",
		scopePrefix+":retry-payloads",
	)
	if ctx.Err() != nil || !m.isInboundConnectionScopeCurrent(withInboundConnectionScope(ctx, active)) {
		return
	}
	m.rehomeInboundSpoolParking(
		ctx,
		active,
		scopePrefix+":parking",
		scopePrefix+":payloads",
	)
}

func (m *WhatsAppManager) rehomeInboundSpoolRetry(
	ctx context.Context,
	active whatsAppRuntimeFence,
	retryKey string,
	payloadHashKey string,
) {
	if m.redis == nil || !active.isValid() || retryKey == "" || payloadHashKey == "" {
		return
	}
	activeCtx := withInboundConnectionScope(ctx, active)
	activeKeys := m.inboundSpoolScopeKeys(active)
	migrated := 0
	discarded := 0

	for ctx.Err() == nil && m.isInboundConnectionScopeCurrent(activeCtx) {
		members, err := m.inboundSpoolLedgerMembers(ctx, retryKey, payloadHashKey)
		if err != nil {
			log.Printf("whatsmeow inbound retry rehome read failed worker_id=%s source_hash=%s error_code=%s", m.cfg.WorkerID, hashConnectionFlowIdentifier(retryKey), safeOperationalErrorCode(err))
			return
		}
		if len(members) == 0 {
			break
		}

		batchProgress := false
		for _, member := range members {
			if ctx.Err() != nil || !m.isInboundConnectionScopeCurrent(activeCtx) {
				return
			}
			raw, err := m.redis.HGet(ctx, payloadHashKey, member).Result()
			if err != nil && !errors.Is(err, redis.Nil) {
				log.Printf("whatsmeow inbound retry rehome payload read failed worker_id=%s member_hash=%s error_code=%s", m.cfg.WorkerID, hashConnectionFlowIdentifier(member), safeOperationalErrorCode(err))
				return
			}

			destinationPayload := ""
			if errors.Is(err, redis.Nil) {
				raw = ""
			} else {
				_, destinationPayload, err = rehomeInboundSpoolPayload(raw, active, m.cfg.WorkerID)
				if err != nil {
					log.Printf(
						"whatsmeow invalid obsolete inbound retry discarded worker_id=%s member_hash=%s reason=invalid_rehome_retry_payload error_code=%s",
						m.cfg.WorkerID,
						hashConnectionFlowIdentifier(member),
						safeOperationalErrorCode(err),
					)
				}
			}

			status, evalErr := m.redis.Eval(
				ctx,
				rehomeInboundRetryIfFenceCurrentScript,
				[]string{
					whatsAppRuntimeFenceKey(active.WorkerID),
					retryKey,
					payloadHashKey,
					activeKeys[0],
					activeKeys[1],
					activeKeys[2],
					activeKeys[3],
					activeKeys[4],
					m.inboundSpoolIndexKey(),
				},
				active.WorkerID,
				active.RuntimeGeneration,
				active.ConnectionEpoch,
				active.SourceProvider,
				member,
				raw,
				destinationPayload,
				"",
				"",
			).Int()
			if evalErr != nil {
				log.Printf("whatsmeow inbound retry rehome write failed worker_id=%s member_hash=%s error_code=%s", m.cfg.WorkerID, hashConnectionFlowIdentifier(member), safeOperationalErrorCode(evalErr))
				return
			}
			switch status {
			case -1:
				return
			case 0:
				batchProgress = true
			case 1:
				batchProgress = true
				if destinationPayload != "" {
					migrated++
				} else {
					discarded++
				}
			case 3:
				// The member changed after HGET. Read its latest value on the next
				// bounded pass rather than acknowledging stale data.
				continue
			}
		}
		if !batchProgress {
			return
		}
	}
	if migrated > 0 || discarded > 0 {
		log.Printf("whatsmeow inbound retry rehomed worker_id=%s source_hash=%s migrated=%d discarded=%d", m.cfg.WorkerID, hashConnectionFlowIdentifier(retryKey), migrated, discarded)
	}
}

func (m *WhatsAppManager) rehomeInboundSpoolParking(
	ctx context.Context,
	active whatsAppRuntimeFence,
	parkingKey string,
	payloadHashKey string,
) {
	if m.redis == nil || !active.isValid() || parkingKey == "" || payloadHashKey == "" {
		return
	}
	activeCtx := withInboundConnectionScope(ctx, active)
	migrated := 0
	discarded := 0

	for ctx.Err() == nil && m.isInboundConnectionScopeCurrent(activeCtx) {
		members, err := m.inboundSpoolLedgerMembers(ctx, parkingKey, payloadHashKey)
		if err != nil {
			log.Printf("whatsmeow inbound parking rehome read failed worker_id=%s source_hash=%s error_code=%s", m.cfg.WorkerID, hashConnectionFlowIdentifier(parkingKey), safeOperationalErrorCode(err))
			return
		}
		if len(members) == 0 {
			break
		}

		batchProgress := false
		for _, member := range members {
			if ctx.Err() != nil || !m.isInboundConnectionScopeCurrent(activeCtx) {
				return
			}
			raw, err := m.redis.HGet(ctx, payloadHashKey, member).Result()
			if err != nil && !errors.Is(err, redis.Nil) {
				log.Printf("whatsmeow inbound parking rehome payload read failed worker_id=%s member_hash=%s error_code=%s", m.cfg.WorkerID, hashConnectionFlowIdentifier(member), safeOperationalErrorCode(err))
				return
			}

			destinationPayload := ""
			if errors.Is(err, redis.Nil) {
				raw = ""
			} else {
				_, destinationPayload, err = rehomeInboundParkingPayload(raw, active, m.cfg.WorkerID)
				if err != nil {
					log.Printf(
						"whatsmeow invalid provider parking payload discarded worker_id=%s member_hash=%s reason=invalid_legacy_provider_parking error_code=%s",
						m.cfg.WorkerID,
						hashConnectionFlowIdentifier(member),
						safeOperationalErrorCode(err),
					)
				}
			}

			status, evalErr := m.redis.Eval(
				ctx,
				rehomeInboundParkingIfFenceCurrentScript,
				[]string{
					whatsAppRuntimeFenceKey(active.WorkerID),
					parkingKey,
					payloadHashKey,
					m.inboundSpoolStreamKey(active),
					m.inboundSpoolIndexKey(),
				},
				active.WorkerID,
				active.RuntimeGeneration,
				active.ConnectionEpoch,
				active.SourceProvider,
				member,
				raw,
				destinationPayload,
			).Int()
			if evalErr != nil {
				log.Printf("whatsmeow inbound parking rehome write failed worker_id=%s member_hash=%s error_code=%s", m.cfg.WorkerID, hashConnectionFlowIdentifier(member), safeOperationalErrorCode(evalErr))
				return
			}
			switch status {
			case -1:
				return
			case 0:
				batchProgress = true
			case 1:
				batchProgress = true
				migrated++
			case 2:
				batchProgress = true
				discarded++
			case 3:
				continue
			}
		}
		if !batchProgress {
			return
		}
	}
	if migrated > 0 || discarded > 0 {
		log.Printf(
			"whatsmeow inbound provider parking rehomed worker_id=%s source_hash=%s migrated=%d discarded=%d",
			m.cfg.WorkerID,
			hashConnectionFlowIdentifier(parkingKey),
			migrated,
			discarded,
		)
	}
}

func (m *WhatsAppManager) inboundSpoolLedgerMembers(
	ctx context.Context,
	sortedSetKey string,
	payloadHashKey string,
) ([]string, error) {
	members, err := m.redis.ZRange(
		ctx,
		sortedSetKey,
		0,
		whatsmeowInboundSpoolBatchSize-1,
	).Result()
	if err != nil {
		return nil, err
	}
	if int64(len(members)) >= whatsmeowInboundSpoolBatchSize {
		return members, nil
	}
	seen := make(map[string]struct{}, whatsmeowInboundSpoolBatchSize)
	for _, member := range members {
		seen[member] = struct{}{}
	}
	// Historical parking wrote HSET and ZADD separately. HSCAN also discovers
	// valid payloads whose process died between those commands, so rollout
	// migration does not leave them permanently invisible.
	fieldsAndValues, _, err := m.redis.HScan(
		ctx,
		payloadHashKey,
		0,
		"*",
		whatsmeowInboundSpoolBatchSize,
	).Result()
	if err != nil {
		return nil, err
	}
	for index := 0; index+1 < len(fieldsAndValues); index += 2 {
		member := fieldsAndValues[index]
		if _, exists := seen[member]; exists {
			continue
		}
		members = append(members, member)
		seen[member] = struct{}{}
		if int64(len(members)) >= whatsmeowInboundSpoolBatchSize {
			break
		}
	}
	return members, nil
}

// rehomeInboundSpoolStream preserves at-least-once delivery across a reconnect.
// The old connection scope is no longer authorized to publish, but messages it
// already durably captured remain valid input. They are copied to the active
// scope before the obsolete entry is deleted; a crash between those operations
// can duplicate an event, which is safe because DedupeKey/EventID is stable.
func (m *WhatsAppManager) rehomeInboundSpoolStream(
	ctx context.Context,
	active whatsAppRuntimeFence,
	streamKey string,
) {
	if m.redis == nil || !active.isValid() || !m.isObsoleteWhatsmeowInboundStreamKey(streamKey, active) {
		return
	}
	activeCtx := withInboundConnectionScope(ctx, active)
	activeStream := m.inboundSpoolStreamKey(active)
	migrated := 0

	for ctx.Err() == nil && m.isInboundConnectionScopeCurrent(activeCtx) {
		entries, err := m.redis.XRangeN(ctx, streamKey, "-", "+", whatsmeowInboundSpoolBatchSize).Result()
		if err != nil {
			log.Printf("whatsmeow inbound spool rehome read failed worker_id=%s source_hash=%s error_code=%s", m.cfg.WorkerID, hashConnectionFlowIdentifier(streamKey), safeOperationalErrorCode(err))
			return
		}
		if len(entries) == 0 {
			break
		}

		for _, entry := range entries {
			if ctx.Err() != nil || !m.isInboundConnectionScopeCurrent(activeCtx) {
				return
			}
			raw, rawOK := inboundSpoolRawPayload(entry.Values["payload"])
			_, rehomedRaw, rehomeErr := rehomeInboundSpoolPayload(raw, active, m.cfg.WorkerID)
			if !rawOK || rehomeErr != nil {
				errorCode := "invalid_payload"
				if rehomeErr != nil {
					errorCode = safeOperationalErrorCode(rehomeErr)
				}
				log.Printf(
					"whatsmeow invalid obsolete inbound stream payload discarded worker_id=%s stream_id_hash=%s reason=invalid_rehome_payload error_code=%s",
					m.cfg.WorkerID,
					hashConnectionFlowIdentifier(entry.ID),
					errorCode,
				)
				status, discardErr := m.discardInboundStreamEntryIfFenceCurrent(
					ctx,
					active,
					streamKey,
					entry.ID,
				)
				if discardErr != nil {
					log.Printf(
						"whatsmeow invalid obsolete inbound stream cleanup failed worker_id=%s stream_id_hash=%s error_code=%s",
						m.cfg.WorkerID,
						hashConnectionFlowIdentifier(entry.ID),
						safeOperationalErrorCode(discardErr),
					)
					return
				}
				if status < 0 {
					return
				}
				continue
			}
			status, err := m.redis.Eval(
				ctx,
				rehomeInboundStreamEntryIfFenceCurrentScript,
				[]string{
					whatsAppRuntimeFenceKey(active.WorkerID),
					streamKey,
					activeStream,
					m.inboundSpoolIndexKey(),
				},
				active.WorkerID,
				active.RuntimeGeneration,
				active.ConnectionEpoch,
				active.SourceProvider,
				entry.ID,
				raw,
				rehomedRaw,
			).Int()
			if err != nil {
				log.Printf("whatsmeow inbound spool rehome write failed worker_id=%s stream_id_hash=%s error_code=%s", m.cfg.WorkerID, hashConnectionFlowIdentifier(entry.ID), safeOperationalErrorCode(err))
				return
			}
			switch status {
			case -1:
				return
			case 0:
				continue
			case 1:
				migrated++
			case 3:
				// The stream entry is immutable, but retain fail-closed handling
				// if Redis ever returns a different field body for the same ID.
				return
			}
		}
	}
	if migrated > 0 {
		log.Printf("whatsmeow inbound spool rehomed worker_id=%s source_hash=%s destination_hash=%s count=%d", m.cfg.WorkerID, hashConnectionFlowIdentifier(streamKey), hashConnectionFlowIdentifier(activeStream), migrated)
	}
}

func (m *WhatsAppManager) discardInboundSpoolScope(ctx context.Context, scope whatsAppRuntimeFence) {
	if m.redis == nil || !scope.isValid() {
		return
	}
	keys := m.inboundSpoolScopeKeys(scope)
	if _, err := m.redis.TxPipelined(ctx, func(pipe redis.Pipeliner) error {
		pipe.Unlink(ctx, keys...)
		pipe.SRem(ctx, m.inboundSpoolIndexKey(), keys)
		return nil
	}); err != nil {
		log.Printf(
			"whatsmeow inbound spool scope cleanup failed worker_id=%s generation=%d epoch=%s error_code=%s",
			m.cfg.WorkerID,
			scope.RuntimeGeneration,
			scope.ConnectionEpoch,
			safeOperationalErrorCode(err),
		)
	}
	m.clearInboundSpoolPublishedPrefix(m.inboundSpoolStreamKey(scope) + "\x00")
}

func (m *WhatsAppManager) discardObsoleteInboundSpools(ctx context.Context, active whatsAppRuntimeFence) {
	if m.redis == nil || !active.isValid() {
		return
	}
	if !m.isInboundConnectionScopeCurrent(withInboundConnectionScope(ctx, active)) {
		return
	}
	activeScopeKeys := m.inboundSpoolScopeKeys(active)
	activeKeys := make(map[string]struct{}, len(activeScopeKeys))
	for _, key := range activeScopeKeys {
		activeKeys[key] = struct{}{}
	}
	indexKey := m.inboundSpoolIndexKey()
	if err := m.redis.SAdd(ctx, indexKey, activeScopeKeys).Err(); err != nil {
		log.Printf("whatsmeow inbound spool index registration failed worker_id=%s error_code=%s", m.cfg.WorkerID, safeOperationalErrorCode(err))
		return
	}

	// A rolling deploy can retain parking records under the same still-active
	// epoch. Rescue those records as well; waiting only for an obsolete scope
	// would leave them stranded until the next reconnect.
	m.rehomeInboundSpoolParking(
		ctx,
		active,
		m.inboundSpoolParkingSetKey(active),
		m.inboundSpoolPayloadHashKey(active),
	)
	if ctx.Err() != nil || !m.isInboundConnectionScopeCurrent(withInboundConnectionScope(ctx, active)) {
		return
	}

	// Releases predating scoped streams used these worker-level keys. Rehome
	// both their stream and delayed retry ledger before guarded cleanup so an
	// upgrade/recreate cannot strand previously captured messages.
	m.rehomeInboundSpoolScope(ctx, active, m.inboundSpoolLegacyWhatsmeowPrefix())
	if ctx.Err() != nil || !m.isInboundConnectionScopeCurrent(withInboundConnectionScope(ctx, active)) {
		return
	}

	for _, key := range m.inboundSpoolLegacyKeys() {
		deleteStatus, deleteErr := m.discardInboundSpoolKeyIfFenceCurrent(
			ctx,
			active,
			key,
		)
		if deleteErr != nil {
			log.Printf("whatsmeow legacy inbound spool guarded delete failed worker_id=%s key_hash=%s error_code=%s", m.cfg.WorkerID, hashConnectionFlowIdentifier(key), safeOperationalErrorCode(deleteErr))
			return
		}
		if deleteStatus < 0 {
			return
		}
	}

	var cursor uint64
	processed := 0
	for processed < whatsmeowInboundSpoolCleanupLimit {
		keys, nextCursor, err := m.redis.SScan(
			ctx,
			indexKey,
			cursor,
			"*",
			whatsmeowInboundSpoolCleanupBatch,
		).Result()
		if err != nil {
			log.Printf("whatsmeow obsolete inbound spool index scan failed worker_id=%s error_code=%s", m.cfg.WorkerID, safeOperationalErrorCode(err))
			return
		}
		for _, key := range keys {
			processed++
			if _, activeKey := activeKeys[key]; activeKey {
				continue
			}
			if !m.isIndexedInboundSpoolKey(key) {
				_ = m.redis.SRem(ctx, indexKey, key).Err()
				continue
			}
			if obsoletePrefix, obsolete := m.obsoleteWhatsmeowInboundScopePrefix(key, active); obsolete {
				m.rehomeInboundSpoolScope(ctx, active, obsoletePrefix)
				if ctx.Err() != nil || !m.isInboundConnectionScopeCurrent(withInboundConnectionScope(ctx, active)) {
					return
				}
			}
			deleteStatus, deleteErr := m.discardInboundSpoolKeyIfFenceCurrent(ctx, active, key)
			if deleteErr != nil {
				log.Printf("whatsmeow obsolete inbound spool guarded delete failed worker_id=%s key_hash=%s error_code=%s", m.cfg.WorkerID, hashConnectionFlowIdentifier(key), safeOperationalErrorCode(deleteErr))
				return
			}
			if deleteStatus < 0 {
				return
			}
			if deleteStatus == 2 {
				// Non-empty streams and parking stores are durable evidence. Keep
				// them indexed for the next bounded reconciliation pass.
				continue
			}
			if processed >= whatsmeowInboundSpoolCleanupLimit {
				break
			}
		}
		cursor = nextCursor
		if cursor == 0 {
			return
		}
	}

	log.Printf(
		"whatsmeow obsolete inbound spool cleanup yielded worker_id=%s processed=%d",
		m.cfg.WorkerID,
		processed,
	)
}

func (m *WhatsAppManager) discardInboundSpoolKeyIfFenceCurrent(ctx context.Context, active whatsAppRuntimeFence, key string) (int, error) {
	if m.redis == nil || !active.isValid() || key == "" {
		return -1, nil
	}
	deleted, err := m.redis.Eval(
		ctx,
		discardObsoleteInboundSpoolIfFenceCurrentScript,
		[]string{
			whatsAppRuntimeFenceKey(active.WorkerID),
			key,
			m.inboundSpoolIndexKey(),
		},
		active.WorkerID,
		active.RuntimeGeneration,
		active.ConnectionEpoch,
		active.SourceProvider,
	).Int()
	return deleted, err
}

func (m *WhatsAppManager) discardInboundStreamEntryIfFenceCurrent(
	ctx context.Context,
	active whatsAppRuntimeFence,
	streamKey string,
	streamID string,
) (int, error) {
	if m.redis == nil || !active.isValid() || streamKey == "" || streamID == "" {
		return -1, nil
	}
	deleted, err := m.redis.Eval(
		ctx,
		discardInboundStreamEntryIfFenceCurrentScript,
		[]string{
			whatsAppRuntimeFenceKey(active.WorkerID),
			streamKey,
		},
		active.WorkerID,
		active.RuntimeGeneration,
		active.ConnectionEpoch,
		active.SourceProvider,
		streamID,
	).Int()
	return deleted, err
}

func (m *WhatsAppManager) inboundSpoolWasPublished(key string) bool {
	m.inboundSpoolMu.Lock()
	defer m.inboundSpoolMu.Unlock()
	_, ok := m.inboundSpoolPublished[key]
	return ok
}

func (m *WhatsAppManager) markInboundSpoolPublished(key string) {
	m.inboundSpoolMu.Lock()
	defer m.inboundSpoolMu.Unlock()
	m.inboundSpoolPublished[key] = struct{}{}
}

func (m *WhatsAppManager) clearInboundSpoolPublished(key string) {
	m.inboundSpoolMu.Lock()
	defer m.inboundSpoolMu.Unlock()
	delete(m.inboundSpoolPublished, key)
}

func (m *WhatsAppManager) clearInboundSpoolPublishedPrefix(prefix string) {
	m.inboundSpoolMu.Lock()
	defer m.inboundSpoolMu.Unlock()
	for key := range m.inboundSpoolPublished {
		if len(key) >= len(prefix) && key[:len(prefix)] == prefix {
			delete(m.inboundSpoolPublished, key)
		}
	}
}

func (m *WhatsAppManager) isUpsertWithinConnectionCutoff(upsert *UpsertMessage, scope whatsAppRuntimeFence) bool {
	if upsert == nil {
		return false
	}
	rawTimestamp := int64(uint64Value(upsert.Message["messageTimestamp"]))
	if rawTimestamp <= 0 {
		return !upsert.FromHistorySync
	}
	timestampMillis := rawTimestamp
	if timestampMillis < 1_000_000_000_000 {
		timestampMillis *= int64(time.Second / time.Millisecond)
	}
	if upsert.FromHistorySync {
		window := m.cfg.HistoryReconciliationWindow
		if window <= 0 {
			window = defaultHistoryReconciliationWindow
		}

		// History reconciliation intentionally reaches behind the current
		// connection. The active runtime scope and effect lease still fence the
		// publication, while this bounded wall-clock window prevents an old
		// history dump from replaying indefinitely.
		return timestampMillis >= time.Now().Add(-window).UnixMilli()
	}
	// WhatsApp timestamps commonly have second precision. Discard the whole
	// activation second so an older event cannot round into the new scope.
	cutoffMillis := ((scope.ActivatedAt / 1000) + 1) * 1000
	return timestampMillis >= cutoffMillis
}
