package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/segmentio/kafka-go"
)

const (
	sendIdempotencySchemaVersion  = "4"
	sendIdempotencyStateReserved  = "reserved"
	sendIdempotencyStateInvoked   = "provider_invoked"
	sendIdempotencyStateSucceeded = "succeeded"
	sendIdempotencyStateFailed    = "failed"
	sendIdempotencyStateExpired   = "expired"
	sendIdempotencyStateAmbiguous = "ambiguous"

	messageSendTerminalFailureRecoverySchema = "message_send_terminal_failure_recovery_v1"
	messageSendAmbiguousTerminalSchema       = "message_send_ambiguous_terminal_v1"

	sendIdempotencyLease            = 20 * time.Second
	sendIdempotencyProviderLease    = 75 * time.Second
	sendIdempotencyProviderLeasePad = 30 * time.Second
	sendIdempotencyProviderLeaseMax = 150 * time.Second

	outboundPostProviderMaxAttempts   = 8
	outboundPostProviderBaseDelay     = 100 * time.Millisecond
	outboundPostProviderMaxDelay      = 2 * time.Second
	outboundAuthorizationFenceTimeout = 5 * time.Second
	outboundRedisOperationTimeout     = 5 * time.Second

	outboundRecoverySchemaVersion  = 4
	outboundRecoveryBatchSize      = 50
	outboundRecoveryLease          = time.Minute
	outboundRecoveryRetryDelay     = 15 * time.Second
	outboundRecoveryPollInterval   = time.Second
	outboundRecoveryAttemptTimeout = 45 * time.Second
	outboundProviderWatchdogBatch  = 50

	outboundRecoveryTargetNotification      = "notification"
	outboundRecoveryTargetWorkerCommandLane = "worker_command_lane"
)

func sendIdempotencyTTL(state string) (time.Duration, error) {
	switch state {
	case sendIdempotencyStateReserved:
		return workerCommandReservedTTL, nil
	case sendIdempotencyStateInvoked:
		return workerCommandProviderInvokedTTL, nil
	case sendIdempotencyStateSucceeded:
		return workerCommandSucceededTTL, nil
	case sendIdempotencyStateFailed:
		return workerCommandFailedTTL, nil
	case sendIdempotencyStateExpired:
		return workerCommandExpiredTTL, nil
	case sendIdempotencyStateAmbiguous:
		return workerCommandAmbiguousTTL, nil
	default:
		return 0, fmt.Errorf("unsupported outbound idempotency state %q", state)
	}
}

type outboundSendOperation struct {
	AccountID string
	Type      string
	ID        string
}

type outboundSendClaim struct {
	Operation    outboundSendOperation
	Key          string
	Owner        string
	Acquired     bool
	State        string
	MetaJSON     string
	Result       map[string]any
	Recovery     *outboundRecoveryRecord
	CreatedAtMS  int64
	TerminalAtMS int64
	ExpiresAtMS  int64
}

type providerCommandDurableSuccess struct {
	result func() map[string]any
	after  func(outboundSendClaim) error
}

type outboundRecoveryPublication struct {
	Topic   string          `json:"topic"`
	Key     string          `json:"key"`
	Payload json.RawMessage `json:"payload"`
}

type workerCommandLaneRecoveryReference struct {
	AccountID   string `json:"account_id"`
	WorkerID    string `json:"worker_id"`
	EntityKey   string `json:"entity_key"`
	OperationID string `json:"operation_id"`
	CommandID   string `json:"command_id"`
}

// outboundRecoveryRecord contains only Kafka follow-up publications. Provider
// calls are deliberately not representable here, so durable recovery can never
// resend a WhatsApp message.
type outboundRecoveryRecord struct {
	SchemaVersion           int                                 `json:"schema_version"`
	WorkerID                string                              `json:"worker_id"`
	AccountID               string                              `json:"account_id,omitempty"`
	ConsumerAssignmentEpoch uint64                              `json:"consumer_assignment_epoch"`
	OriginRuntimeGeneration int                                 `json:"origin_runtime_generation,omitempty"`
	OriginConnectionEpoch   string                              `json:"origin_connection_epoch,omitempty"`
	ScheduleAttempt         *scheduleMessageAttemptReference    `json:"schedule_attempt,omitempty"`
	TargetKind              string                              `json:"target_kind,omitempty"`
	WorkerCommandLane       *workerCommandLaneRecoveryReference `json:"worker_command_lane,omitempty"`
	Publications            []outboundRecoveryPublication       `json:"publications"`
}

type outboundRecoveryClaim struct {
	Key   string
	Owner string
}

var errOutboundRecoveryObsolete = errors.New("outbound recovery belongs to an obsolete Kafka assignment")
var errOutboundRecoveryFutureRuntime = errors.New("outbound recovery belongs to a future runtime generation")
var errOutboundIdempotencyIdentityConflict = errors.New("outbound idempotency immutable identity conflict")

func outboundProviderInvocationLease(providerTimeout time.Duration) time.Duration {
	if providerTimeout <= 0 {
		return sendIdempotencyProviderLease
	}
	lease := providerTimeout + sendIdempotencyProviderLeasePad
	if lease > sendIdempotencyProviderLeaseMax {
		return sendIdempotencyProviderLeaseMax
	}
	if lease < sendIdempotencyProviderLease {
		return sendIdempotencyProviderLease
	}
	return lease
}

const claimOutboundSendScript = `
local key = KEYS[1]
local owner = ARGV[1]
local lease_ms = tonumber(ARGV[2])
local operation_type = ARGV[3]
local operation_id = ARGV[4]
local meta_json = ARGV[5]
local reserved_ttl_ms = tonumber(ARGV[6])
local ambiguous_ttl_ms = tonumber(ARGV[7])
local redis_time = redis.call('TIME')
local now = (tonumber(redis_time[1]) * 1000) + math.floor(tonumber(redis_time[2]) / 1000)
local lease_until = tostring(now + lease_ms)

if redis.call('EXISTS', key) == 0 then
  local expires_at = now + reserved_ttl_ms
  redis.call('HSET', key,
    'schema_version', '4',
    'state', 'reserved',
    'owner', owner,
    'lease_until_ms', lease_until,
    'operation_type', operation_type,
    'operation_id', operation_id,
    'meta_json', meta_json,
    'result_json', '',
    'error', '',
    'created_at_ms', tostring(now),
    'terminal_at_ms', '',
    'expires_at_ms', tostring(expires_at),
    'updated_at_ms', tostring(now))
  redis.call('PEXPIREAT', key, expires_at)
	redis.call('ZREM', KEYS[2], key)
  return {1, 'reserved', '', '', meta_json}
end

local state = redis.call('HGET', key, 'state')
local result_json = redis.call('HGET', key, 'result_json') or ''
local recovery_json = redis.call('HGET', key, 'recovery_json') or ''
local stored_meta_json = redis.call('HGET', key, 'meta_json') or ''
local current_lease = tonumber(redis.call('HGET', key, 'lease_until_ms') or '0')
local stored_operation_type = redis.call('HGET', key, 'operation_type') or ''
local stored_operation_id = redis.call('HGET', key, 'operation_id') or ''
local incoming_meta = nil
local stored_meta = nil
if meta_json ~= '' then
  local decoded, value = pcall(cjson.decode, meta_json)
  if decoded and type(value) == 'table' then
    incoming_meta = value
  end
end
if stored_meta_json ~= '' then
  local decoded, value = pcall(cjson.decode, stored_meta_json)
  if decoded and type(value) == 'table' then
    stored_meta = value
  end
end

local identity_matches =
  stored_operation_type == operation_type and stored_operation_id == operation_id
local core_identity_fields = {'worker_id', 'message_id', 'chat_id'}
if identity_matches then
  for _, field in ipairs(core_identity_fields) do
    local incoming_value = incoming_meta and incoming_meta[field] or nil
    local stored_value = stored_meta and stored_meta[field] or nil
    if tostring(incoming_value or '') ~= tostring(stored_value or '') then
      identity_matches = false
      break
    end
  end
end

if identity_matches then
  local incoming_provider = tostring(incoming_meta and incoming_meta.provider or '')
  local incoming_account = tostring(incoming_meta and incoming_meta.account_id or '')
  local stored_provider = tostring(stored_meta and stored_meta.provider or '')
  local stored_account = tostring(stored_meta and stored_meta.account_id or '')
  local legacy_go_meta =
    stored_provider == ''
    and stored_account == ''
    and tostring(stored_meta and stored_meta.topic or '') ~= ''
    and tostring(stored_meta and stored_meta.worker_id or '') ~= ''
    and (
      tostring(stored_meta and stored_meta.message_id or '') ~= ''
      or tostring(stored_meta and stored_meta.chat_id or '') ~= ''
    )
  if stored_provider ~= incoming_provider or stored_account ~= incoming_account then
    if not (
      legacy_go_meta
      and incoming_provider == 'whatsmeow'
      and incoming_account ~= ''
    ) then
      identity_matches = false
    end
  end
end

if not identity_matches then
  return {0, 'identity_conflict', '', '', stored_meta_json}
end

if state == 'reserved' and current_lease <= now then
  local expires_at = now + reserved_ttl_ms
  redis.call('HSET', key,
    'schema_version', '4',
    'state', 'reserved',
    'owner', owner,
    'lease_until_ms', lease_until,
    'operation_type', operation_type,
    'operation_id', operation_id,
    'meta_json', meta_json,
    'result_json', '',
    'error', '',
    'terminal_at_ms', '',
    'expires_at_ms', tostring(expires_at),
    'updated_at_ms', tostring(now))
  redis.call('PEXPIREAT', key, expires_at)
  return {1, 'reserved', '', '', meta_json}
end

-- A live provider_invoked lease belongs to the original SDK call. Replays
-- must remain uncommitted and must never publish ambiguity while that call can
-- still produce a definitive owner-CAS outcome.
if state == 'provider_invoked' and current_lease <= now then
  state = 'ambiguous'
  local expires_at = now + ambiguous_ttl_ms
  redis.call('HSET', key,
    'state', state,
    'lease_until_ms', '0',
    'error', 'provider_invocation_lease_expired',
    'terminal_at_ms', tostring(now),
    'expires_at_ms', tostring(expires_at),
    'updated_at_ms', tostring(now))
  redis.call('PEXPIREAT', key, expires_at)
	redis.call('ZREM', KEYS[2], key)
end

if not state or state == '' then
  state = 'ambiguous'
  local expires_at = now + ambiguous_ttl_ms
  redis.call('HSET', key,
    'schema_version', '4',
    'state', state,
    'owner', '',
    'lease_until_ms', '0',
    'error', 'invalid idempotency record',
    'terminal_at_ms', tostring(now),
    'expires_at_ms', tostring(expires_at),
    'updated_at_ms', tostring(now))
  redis.call('PEXPIREAT', key, expires_at)
	redis.call('ZREM', KEYS[2], key)
end

if state ~= 'provider_invoked' then
  redis.call('ZREM', KEYS[2], key)
end

return {0, state, result_json, recovery_json, stored_meta_json}
`

// Reconcile a claim which was left in-flight by an older Kafka assignment.
// A reserved claim provably never crossed the provider boundary and can be
// released for a retry. A provider_invoked claim can never be retried safely;
// persist the ambiguity before Kafka is allowed to acknowledge the source.
const reconcileObsoleteOutboundClaimScript = `
local state = redis.call('HGET', KEYS[1], 'state') or ''
local stored_meta = redis.call('HGET', KEYS[1], 'meta_json') or ''
if stored_meta ~= ARGV[1] then
  return {0, state}
end
local decoded, meta = pcall(cjson.decode, stored_meta)
local recorded_epoch = 0
if decoded then
  recorded_epoch = tonumber(meta.consumer_assignment_epoch) or 0
end
local current_epoch = tonumber(ARGV[2]) or 0
if recorded_epoch <= 0 or current_epoch <= 0 or recorded_epoch == current_epoch then
  return {0, state}
end
if state == 'reserved' then
  redis.call('DEL', KEYS[1])
  redis.call('ZREM', KEYS[2], KEYS[1])
	redis.call('ZREM', KEYS[3], KEYS[1])
  return {1, 'released'}
end
if state == 'provider_invoked' then
  local redis_time = redis.call('TIME')
  local now = (tonumber(redis_time[1]) * 1000) + math.floor(tonumber(redis_time[2]) / 1000)
  local current_lease =
    tonumber(redis.call('HGET', KEYS[1], 'lease_until_ms') or '0')
  if current_lease > now then
    return {0, state}
  end
  redis.call('HSET', KEYS[1],
    'state', 'ambiguous',
    'lease_until_ms', '0',
    'error', 'provider_invoked_assignment_replaced',
    'terminal_at_ms', tostring(now),
    'expires_at_ms', tostring(now + tonumber(ARGV[3])),
    'updated_at_ms', tostring(now))
  redis.call('PEXPIREAT', KEYS[1], now + tonumber(ARGV[3]))
	redis.call('ZREM', KEYS[3], KEYS[1])
  return {1, 'ambiguous'}
end
return {0, state}
`

const transitionOutboundSendScript = `
local key = KEYS[1]
local owner = ARGV[1]
local expected_state = ARGV[2]
local next_state = ARGV[3]
local lease_ms = tonumber(ARGV[4])
local result_json = ARGV[5]
local error_text = ARGV[6]
local ttl_ms = tonumber(ARGV[7])
local recovery_json = ARGV[8]
local outcome_digest = ARGV[9]
local watchdog_ms = tonumber(ARGV[10])
local watchdog_ttl_seconds = tonumber(ARGV[11])
local redis_time = redis.call('TIME')
local now = (tonumber(redis_time[1]) * 1000) + math.floor(tonumber(redis_time[2]) / 1000)
local lease_until = '0'
if lease_ms > 0 then
  lease_until = tostring(now + lease_ms)
end

if redis.call('EXISTS', key) == 0 then
  return {0, 'missing'}
end
local state = redis.call('HGET', key, 'state') or ''
local current_owner = redis.call('HGET', key, 'owner') or ''
if current_owner ~= owner then
  return {0, state}
end
if state == next_state then
  if (next_state == 'provider_invoked' or next_state == 'succeeded' or next_state == 'failed' or next_state == 'ambiguous') and recovery_json ~= '' then
    redis.call('HSET', key, 'recovery_json', recovery_json)
  elseif next_state == 'succeeded' and recovery_json == '' then
    redis.call('HDEL', key, 'recovery_json')
  end
  if outcome_digest ~= '' then
    redis.call('HSET', key, 'outcome_digest', outcome_digest)
  end
	if next_state == 'provider_invoked' then
	  redis.call('ZADD', KEYS[2], 'NX', now + watchdog_ms, key)
	  redis.call('EXPIRE', KEYS[2], watchdog_ttl_seconds)
	else
	  redis.call('ZREM', KEYS[2], key)
	end
  return {1, next_state}
end
if state ~= expected_state then
  return {0, state}
end

redis.call('HSET', key,
  'schema_version', '4',
  'state', next_state,
  'lease_until_ms', lease_until,
  'result_json', result_json,
  'error', error_text,
  'expires_at_ms', tostring(now + ttl_ms),
  'updated_at_ms', tostring(now))
if next_state == 'provider_invoked' then
  redis.call('HSET', key, 'provider_invoked_at_ms', tostring(now))
  redis.call('ZADD', KEYS[2], now + watchdog_ms, key)
  redis.call('EXPIRE', KEYS[2], watchdog_ttl_seconds)
else
  redis.call('ZREM', KEYS[2], key)
end
if next_state == 'succeeded' or next_state == 'failed' or next_state == 'expired' or next_state == 'ambiguous' then
  redis.call('HSET', key, 'terminal_at_ms', tostring(now))
else
  redis.call('HDEL', key, 'terminal_at_ms')
end
if outcome_digest ~= '' then
  redis.call('HSET', key, 'outcome_digest', outcome_digest)
end
if (next_state == 'provider_invoked' or next_state == 'succeeded' or next_state == 'failed' or next_state == 'ambiguous') and recovery_json ~= '' then
  redis.call('HSET', key, 'recovery_json', recovery_json)
elseif next_state == 'succeeded' and recovery_json == '' then
  redis.call('HDEL', key, 'recovery_json')
end
redis.call('PEXPIREAT', key, now + ttl_ms)
return {1, next_state}
`

const claimOutboundRecoveryScript = `
local key = KEYS[1]
local lease_ms = tonumber(ARGV[1])
local count = tonumber(ARGV[2])
local owner = ARGV[3]
local redis_time = redis.call('TIME')
local now = (tonumber(redis_time[1]) * 1000) + math.floor(tonumber(redis_time[2]) / 1000)
local lease_until = now + lease_ms
local entries = redis.call('ZRANGEBYSCORE', key, '-inf', now, 'LIMIT', 0, count)
local claimed = {}
for _, entry in ipairs(entries) do
  if redis.call('EXISTS', entry) == 1 then
    redis.call('HSET', entry,
      'recovery_claim_owner', owner,
      'recovery_claim_until_ms', tostring(lease_until))
    redis.call('ZADD', key, 'XX', lease_until, entry)
    table.insert(claimed, entry)
  else
    redis.call('ZREM', key, entry)
  end
end
return claimed
`

const prepareOutboundRecoveryScript = `
local redis_time = redis.call('TIME')
local now = (tonumber(redis_time[1]) * 1000) + math.floor(tonumber(redis_time[2]) / 1000)
redis.call('ZADD', KEYS[1], now, ARGV[1])
redis.call('HDEL', KEYS[2], 'recovery_claim_owner', 'recovery_claim_until_ms')
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]))
return now
`

const rescheduleOutboundRecoveryScript = `
local redis_time = redis.call('TIME')
local now = (tonumber(redis_time[1]) * 1000) + math.floor(tonumber(redis_time[2]) / 1000)
if redis.call('HGET', KEYS[2], 'recovery_claim_owner') ~= ARGV[3] then
  return 0
end
if ARGV[4] ~= '*' and (redis.call('HGET', KEYS[2], 'state') or '') ~= ARGV[4] then
  return 0
end
if ARGV[5] ~= '*' and (redis.call('HGET', KEYS[2], 'recovery_json') or '') ~= ARGV[5] then
  return 0
end
redis.call('ZADD', KEYS[1], now + tonumber(ARGV[2]), ARGV[1])
redis.call('HDEL', KEYS[2], 'recovery_claim_owner', 'recovery_claim_until_ms')
return 1
`

// A recovery queue acknowledgement is a compare-and-swap over the exact
// terminal ledger body and the queue lease owner. An immediate publisher has
// no queue owner; it may acknowledge only while no background lease is live.
// This prevents an old process from deleting work that a replacement process
// has already claimed.
const acknowledgeOutboundRecoveryScript = `
local queue_key = KEYS[1]
local claim_key = KEYS[2]
local queue_member = ARGV[1]
local owner = ARGV[2]
local expected_state = ARGV[3]
local expected_recovery = ARGV[4]
local redis_time = redis.call('TIME')
local now = (tonumber(redis_time[1]) * 1000) + math.floor(tonumber(redis_time[2]) / 1000)

if redis.call('EXISTS', claim_key) == 0 then
  redis.call('ZREM', queue_key, queue_member)
  return 1
end

local state = redis.call('HGET', claim_key, 'state') or ''
if expected_state ~= '' then
  if state ~= expected_state then
    return 0
  end
elseif state ~= 'succeeded' and state ~= 'failed' and state ~= 'expired' and state ~= 'ambiguous' then
  return 0
end
if (redis.call('HGET', claim_key, 'recovery_json') or '') ~= expected_recovery then
  return 0
end

local current_owner = redis.call('HGET', claim_key, 'recovery_claim_owner') or ''
local owner_until = tonumber(redis.call('HGET', claim_key, 'recovery_claim_until_ms') or '0')
if owner ~= '' then
  if current_owner ~= owner then
    return 0
  end
elseif current_owner ~= '' and owner_until > now then
  return 0
end

redis.call('ZREM', queue_key, queue_member)
redis.call('HSET', claim_key, 'compacted_at_ms', tostring(now))
redis.call('HDEL', claim_key,
	'meta_json',
	'owner',
	'lease_until_ms',
	'error',
	'provider_invoked_at_ms',
  'recovery_claim_owner',
  'recovery_claim_until_ms',
  'recovery_json',
  'result_json')
return 1
`

const reconcileOutboundProviderWatchdogScript = `
local queue_key = KEYS[1]
local count = tonumber(ARGV[1])
local ambiguous_ttl_ms = tonumber(ARGV[2])
local redis_time = redis.call('TIME')
local now = (tonumber(redis_time[1]) * 1000) + math.floor(tonumber(redis_time[2]) / 1000)
local entries = redis.call('ZRANGEBYSCORE', queue_key, '-inf', now, 'LIMIT', 0, count)
local transitioned = 0
for _, ledger_key in ipairs(entries) do
  local state = redis.call('HGET', ledger_key, 'state') or ''
  if state == 'provider_invoked' then
    local expires_at = now + ambiguous_ttl_ms
    redis.call('HSET', ledger_key,
      'state', 'ambiguous',
      'lease_until_ms', '0',
      'error', 'provider_invoked_watchdog_expired',
      'terminal_at_ms', tostring(now),
      'expires_at_ms', tostring(expires_at),
      'updated_at_ms', tostring(now))
    redis.call('PEXPIREAT', ledger_key, expires_at)
    transitioned = transitioned + 1
  end
  redis.call('ZREM', queue_key, ledger_key)
end
return transitioned
`

const releaseOutboundSendScript = `
local key = KEYS[1]
local owner = ARGV[1]
if redis.call('HGET', key, 'state') == 'reserved' and redis.call('HGET', key, 'owner') == owner then
  redis.call('DEL', key)
  if ARGV[2] == '1' then
    redis.call('ZREM', KEYS[2], ARGV[3])
  end
  return 1
end
return 0
`

func outboundSendIdempotencyKey(operation outboundSendOperation) (string, error) {
	accountID := strings.TrimSpace(operation.AccountID)
	operationType := strings.TrimSpace(operation.Type)
	operationID := strings.TrimSpace(operation.ID)
	if accountID == "" || operationID == "" {
		return "", errors.New("outbound idempotency account_id and operation_id are required")
	}
	switch operationType {
	case "direct", "schedule", "notification":
	default:
		return "", fmt.Errorf("unsupported outbound idempotency operation type %q", operationType)
	}
	digest := sha256.Sum256([]byte(operationType + "\x00" + operationID))
	return "message-send:idempotency:v4:" + accountID + ":" + hex.EncodeToString(digest[:]), nil
}

func chatMessageOperationID(data ChatMessage) string {
	messageID := strings.TrimSpace(data.MessageID)
	hash := strings.TrimSpace(data.Hash)
	if hash != "" {
		accountID := strings.TrimSpace(stringValue(data.Account["id"]))
		chatID := strings.TrimSpace(data.ChatID)
		if accountID != "" && chatID != "" && messageID != "" {
			transportDigest := sha256.Sum256([]byte("v1|" + accountID + "|" + chatID + "|" + messageID))
			if hash == hex.EncodeToString(transportDigest[:]) {
				return messageID
			}
		}
		return hash
	}
	return messageID
}

// workerCommandOperationID is shared byte-for-byte with the TypeScript
// workers. Kafka coordinates, rather than provider-specific payload fields,
// identify a status/profile command delivered on the direct-send topic.
func workerCommandOperationID(msg kafka.Message) string {
	for _, header := range msg.Headers {
		if header.Key != workerCommandHeaderOperationID {
			continue
		}
		if operationID := strings.TrimSpace(string(header.Value)); operationID != "" {
			return operationID
		}
	}
	return strings.Join([]string{
		"worker-command",
		msg.Topic,
		strconv.Itoa(msg.Partition),
		strconv.FormatInt(msg.Offset, 10),
	}, "\x00")
}

func outboundOperationIDFromMessage(msg kafka.Message, fallback string) string {
	for _, header := range msg.Headers {
		if header.Key == workerCommandHeaderOperationID {
			if operationID := strings.TrimSpace(string(header.Value)); operationID != "" {
				return operationID
			}
		}
	}
	return strings.TrimSpace(fallback)
}

// processProviderCommandWithIdempotency protects provider-side JetStream
// commands that share the outbound idempotency ledger with normal messages.
// The action must invoke boundary immediately before its first external provider call. A
// boundary failure always fails closed: the provider call is not made, and the
// owner-CAS release can only remove a reservation that provably never crossed
// into provider_invoked. onPreProviderFailure is invoked only in that proven
// pre-provider branch. Once provider_invoked is durable, errors are persisted
// as terminal ambiguity and consumed without a Kafka/provider retry.
func (w *Worker) processProviderCommandWithIdempotency(
	ctx context.Context,
	msg kafka.Message,
	accountID string,
	workerID string,
	action func(providerInvocationBoundary) error,
	onPreProviderFailure func(error) error,
	durableSuccess ...providerCommandDurableSuccess,
) error {
	if action == nil {
		return errors.New("provider command action is required")
	}
	releaseProviderAdmission, err := w.acquireOutboundProviderAdmission(ctx)
	if err != nil {
		return restartKafkaGenerationWithoutCommit(fmt.Errorf(
			"acquire provider-command admission: %w",
			err,
		))
	}
	defer releaseProviderAdmission()
	assignmentEpoch, err := w.kafkaDispatchAssignmentEpoch(ctx)
	if err != nil {
		return err
	}
	operation := outboundSendOperation{
		AccountID: strings.TrimSpace(accountID),
		Type:      "direct",
		ID:        workerCommandOperationID(msg),
	}
	claim, err := w.claimOutboundOperation(ctx, operation, map[string]any{
		"provider":                  "whatsmeow",
		"account_id":                operation.AccountID,
		"worker_id":                 workerID,
		"source_topic":              msg.Topic,
		"source_partition":          msg.Partition,
		"source_offset":             msg.Offset,
		"consumer_assignment_epoch": assignmentEpoch,
	})
	if err != nil {
		if errors.Is(err, errOutboundIdempotencyIdentityConflict) {
			log.Printf(
				"whatsmeow provider command immutable identity conflict discarded worker_id=%s account_id=%s topic=%s partition=%d offset=%d error_code=%s",
				workerID,
				operation.AccountID,
				msg.Topic,
				msg.Partition,
				msg.Offset,
				safeOperationalErrorCode(err),
			)
			return nil
		}
		return err
	}
	if !claim.Acquired {
		if claim.State == sendIdempotencyStateSucceeded {
			for _, success := range durableSuccess {
				if success.after != nil {
					if err := success.after(claim); err != nil {
						return err
					}
				}
			}
			return nil
		}
		return w.resolveUnacquiredOutboundClaim(ctx, claim)
	}
	recoveryPrepared := false
	if workerCommandLaneRecoveryReferenceFromContext(ctx) != nil {
		if err := w.prepareOutboundRecovery(ctx, claim); err != nil {
			w.releaseOutboundReservationBestEffort(ctx, claim, true)
			return err
		}
		recoveryPrepared = true
	}

	providerInvoked := false
	assertProviderAuthorized := w.assertKafkaDispatchAuthorized
	if connectionScope, ok := inboundConnectionScopeFromContext(ctx); ok {
		assertProviderAuthorized = w.kafkaAndConnectionAuthorization(connectionScope)
	}
	boundary := func(boundaryCtx context.Context) error {
		return runRepeatableOutboundProviderInvocationBoundary(
			boundaryCtx,
			&providerInvoked,
			assertProviderAuthorized,
			func(markCtx context.Context) error {
				return w.markOutboundProviderInvokedWithDispatchFence(
					markCtx,
					claim,
					&providerInvoked,
					assertProviderAuthorized,
				)
			},
		)
	}

	actionErr := action(boundary)
	releaseProviderAdmission()
	if actionErr != nil {
		if !providerInvoked {
			w.releaseOutboundReservationBestEffort(ctx, claim, recoveryPrepared)
			if onPreProviderFailure != nil {
				if failureErr := onPreProviderFailure(actionErr); failureErr != nil {
					return errors.Join(actionErr, failureErr)
				}
				return nil
			}
			return actionErr
		}
		transitionErr := persistOutboundProviderOutcome(
			ctx,
			func(attemptCtx context.Context) error {
				return w.completeOutboundAmbiguous(
					attemptCtx,
					claim,
					actionErr,
				)
			},
		)
		if transitionErr != nil {
			return transitionErr
		}
		// provider_invoked is terminal for this operation ID. The original
		// provider error is intentionally consumed after the durable ambiguous
		// transition so Kafka cannot retry the external call.
		return nil
	}
	if !providerInvoked {
		w.releaseOutboundReservationBestEffort(ctx, claim, recoveryPrepared)
		return nil
	}
	result := map[string]any{}
	for _, success := range durableSuccess {
		if success.result == nil {
			continue
		}
		for key, value := range success.result() {
			result[key] = value
		}
	}
	if err := persistOutboundProviderOutcome(ctx, func(attemptCtx context.Context) error {
		return w.completeOutboundSuccess(attemptCtx, claim, result)
	}); err != nil {
		return err
	}
	claim.State = sendIdempotencyStateSucceeded
	claim.Result = result
	for _, success := range durableSuccess {
		if success.after != nil {
			if err := success.after(claim); err != nil {
				return err
			}
		}
	}
	return nil
}

func notificationOperationID(data NotificationMessage) string {
	if operationID := strings.TrimSpace(data.OperationID); operationID != "" {
		return operationID
	}

	// Compatibility for records produced before operation_id existed. Keep the
	// previous notification_id + destination byte contract so an in-flight
	// legacy record resolves to the same v3 Redis key across a rolling deploy.
	// Message content is deliberately excluded so equal user messages remain
	// valid operations.
	notificationID := strings.TrimSpace(data.NotificationID)
	if notificationID == "" {
		return ""
	}
	destination := ""
	if jid := strings.TrimSpace(data.MessageKey.RemoteJID); jid != "" {
		destination = "jid:" + jid
	} else {
		phoneDDI := strings.TrimSpace(data.MessageKey.PhoneDDI)
		phoneNumber := strings.TrimSpace(data.MessageKey.PhoneNumber)
		if phoneDDI != "" && phoneNumber != "" {
			destination = "phone:" + phoneDDI + ":" + phoneNumber
		}
	}
	if destination == "" {
		return ""
	}
	return notificationID + "\x00" + destination
}

func userPhoneJIDUpdateEventID(
	accountID string,
	workerID string,
	userID string,
	phoneJID string,
	operationID string,
) string {
	accountID = strings.TrimSpace(accountID)
	workerID = strings.TrimSpace(workerID)
	userID = strings.TrimSpace(userID)
	phoneJID = canonicalInboundJID(phoneJID)
	operationID = strings.TrimSpace(operationID)
	if accountID == "" ||
		workerID == "" ||
		userID == "" ||
		phoneJID == "" ||
		operationID == "" {
		return ""
	}

	digest := sha256.Sum256([]byte(strings.Join([]string{
		"v1",
		accountID,
		workerID,
		userID,
		phoneJID,
		operationID,
	}, "\x00")))
	return "user_phone_jid_v1_" + hex.EncodeToString(digest[:])
}

func buildUserPhoneJIDUpdate(
	data NotificationMessage,
	accountID string,
	phoneJID string,
	scope whatsAppRuntimeFence,
) UserPhoneJIDUpdate {
	operationID := notificationOperationID(data)
	update := UserPhoneJIDUpdate{
		OperationID:       operationID,
		AccountID:         strings.TrimSpace(accountID),
		WorkerID:          strings.TrimSpace(scope.WorkerID),
		SourceProvider:    "whatsmeow",
		RuntimeGeneration: scope.RuntimeGeneration,
		ConnectionEpoch:   strings.TrimSpace(scope.ConnectionEpoch),
		UserID:            strings.TrimSpace(data.UserID),
		PhoneJID:          strings.TrimSpace(phoneJID),
	}
	update.EventID = userPhoneJIDUpdateEventID(
		update.AccountID,
		update.WorkerID,
		update.UserID,
		update.PhoneJID,
		update.OperationID,
	)
	return update
}

func userPhoneJIDUpdateKafkaKey(update UserPhoneJIDUpdate) string {
	return strings.TrimSpace(update.UserID)
}

func outboundOperationMeta(msg kafka.Message, accountID, workerID, messageID, chatID string) map[string]any {
	return map[string]any{
		"provider":   "whatsmeow",
		"account_id": accountID,
		"worker_id":  workerID,
		"message_id": messageID,
		"chat_id":    chatID,
		"topic":      msg.Topic,
		"partition":  msg.Partition,
		"offset":     msg.Offset,
	}
}

func (w *Worker) claimOutboundOperation(ctx context.Context, operation outboundSendOperation, meta map[string]any) (outboundSendClaim, error) {
	return claimOutboundOperationWithRedis(ctx, w.redis, operation, meta)
}

func withOutboundRedisOperationDeadline(ctx context.Context) (context.Context, context.CancelFunc) {
	if ctx == nil {
		ctx = context.Background()
	}
	return context.WithTimeout(ctx, outboundRedisOperationTimeout)
}

func (w *Worker) resolveUnacquiredOutboundClaim(ctx context.Context, claim outboundSendClaim) error {
	switch claim.State {
	case sendIdempotencyStateSucceeded, sendIdempotencyStateFailed, sendIdempotencyStateExpired, sendIdempotencyStateAmbiguous:
		return nil
	case sendIdempotencyStateReserved, sendIdempotencyStateInvoked:
	default:
		return restartKafkaGenerationWithoutCommit(fmt.Errorf(
			"outbound idempotency claim has unresolved state key_hash=%s state=%s",
			hashConnectionFlowIdentifier(claim.Key),
			claim.State,
		))
	}

	currentEpoch, err := w.kafkaDispatchAssignmentEpoch(ctx)
	if err != nil {
		return err
	}
	recordedEpoch := outboundRecoveryMetaAssignmentEpoch(claim.MetaJSON)
	if recordedEpoch == 0 || recordedEpoch == currentEpoch {
		return restartKafkaGenerationWithoutCommit(fmt.Errorf(
			"outbound idempotency claim remains in-flight key_hash=%s state=%s assignment_epoch=%d",
			hashConnectionFlowIdentifier(claim.Key),
			claim.State,
			recordedEpoch,
		))
	}
	if w.redis == nil {
		return errors.New("redis is required to reconcile an obsolete outbound idempotency claim")
	}

	redisCtx, cancel := withOutboundRedisOperationDeadline(ctx)
	defer cancel()
	value, err := w.redis.Eval(
		redisCtx,
		reconcileObsoleteOutboundClaimScript,
		[]string{claim.Key, outboundRecoveryQueueKey(w.cfg.WorkerID), outboundProviderWatchdogQueueKey()},
		claim.MetaJSON,
		strconv.FormatUint(currentEpoch, 10),
		strconv.FormatInt(workerCommandAmbiguousTTL.Milliseconds(), 10),
	).Result()
	if err != nil {
		return fmt.Errorf("reconcile obsolete outbound idempotency claim: %w", err)
	}
	values, err := outboundLuaValues(value, 2)
	if err != nil {
		return err
	}
	switch values[1] {
	case "released":
		// The obsolete assignment never crossed the provider boundary. A local
		// retry can acquire a fresh reservation in the current assignment.
		return errors.New("obsolete outbound reservation released for retry")
	case sendIdempotencyStateSucceeded, sendIdempotencyStateFailed, sendIdempotencyStateAmbiguous:
		return nil
	case sendIdempotencyStateReserved, sendIdempotencyStateInvoked:
		return restartKafkaGenerationWithoutCommit(fmt.Errorf(
			"outbound idempotency claim reconciliation remained unresolved key_hash=%s state=%s",
			hashConnectionFlowIdentifier(claim.Key),
			values[1],
		))
	default:
		return restartKafkaGenerationWithoutCommit(fmt.Errorf(
			"outbound idempotency claim reconciliation returned invalid state key_hash=%s state=%s",
			hashConnectionFlowIdentifier(claim.Key),
			values[1],
		))
	}
}

func claimOutboundOperationWithRedis(ctx context.Context, redisClient *redis.Client, operation outboundSendOperation, meta map[string]any) (outboundSendClaim, error) {
	if redisClient == nil {
		return outboundSendClaim{}, errors.New("redis is required for outbound idempotency")
	}
	operation.AccountID = strings.TrimSpace(operation.AccountID)
	operation.Type = strings.TrimSpace(operation.Type)
	operation.ID = strings.TrimSpace(operation.ID)
	key, err := outboundSendIdempotencyKey(operation)
	if err != nil {
		return outboundSendClaim{}, err
	}
	owner := uuid.NewString()
	metaJSON, err := json.Marshal(meta)
	if err != nil {
		return outboundSendClaim{}, err
	}
	redisCtx, cancel := withOutboundRedisOperationDeadline(ctx)
	defer cancel()
	value, err := redisClient.Eval(redisCtx, claimOutboundSendScript, []string{key, outboundProviderWatchdogQueueKey()},
		owner,
		strconv.FormatInt(sendIdempotencyLease.Milliseconds(), 10),
		operation.Type,
		operation.ID,
		string(metaJSON),
		strconv.FormatInt(workerCommandReservedTTL.Milliseconds(), 10),
		strconv.FormatInt(workerCommandAmbiguousTTL.Milliseconds(), 10),
	).Result()
	if err != nil {
		return outboundSendClaim{}, fmt.Errorf("claim outbound idempotency: %w", err)
	}
	values, err := outboundLuaValues(value, 5)
	if err != nil {
		return outboundSendClaim{}, err
	}
	claim := outboundSendClaim{
		Operation: operation,
		Key:       key,
		Owner:     owner,
		Acquired:  values[0] == "1",
		State:     values[1],
		MetaJSON:  values[4],
	}
	if claim.State == "identity_conflict" {
		return claim, fmt.Errorf(
			"%w: key_hash=%s operation_type=%s operation_id_hash=%s",
			errOutboundIdempotencyIdentityConflict,
			hashConnectionFlowIdentifier(claim.Key),
			claim.Operation.Type,
			hashConnectionFlowIdentifier(claim.Operation.ID),
		)
	}
	if values[2] != "" {
		if err := json.Unmarshal([]byte(values[2]), &claim.Result); err != nil {
			return outboundSendClaim{}, fmt.Errorf("decode outbound idempotency result: %w", err)
		}
	}
	if values[3] != "" {
		var recovery outboundRecoveryRecord
		if err := json.Unmarshal([]byte(values[3]), &recovery); err != nil {
			return outboundSendClaim{}, fmt.Errorf("decode outbound recovery record: %w", err)
		}
		if err := validateOutboundRecoveryRecord(recovery); err != nil {
			return outboundSendClaim{}, err
		}
		claim.Recovery = &recovery
	}
	if !claim.Acquired {
		recordWorkerCommandLedgerState(ctx, claim.State)
	}
	return claim, nil
}

// inspectOutboundOperationWithRedis is deliberately read-only. In particular,
// observing a duplicate must never turn the bounded tombstone TTL into a
// sliding retention window.
func inspectOutboundOperationWithRedis(
	ctx context.Context,
	redisClient *redis.Client,
	operation outboundSendOperation,
) (outboundSendClaim, bool, error) {
	if redisClient == nil {
		return outboundSendClaim{}, false, errors.New("redis is required for outbound idempotency inspection")
	}
	key, err := outboundSendIdempotencyKey(operation)
	if err != nil {
		return outboundSendClaim{}, false, err
	}
	redisCtx, cancel := withOutboundRedisOperationDeadline(ctx)
	defer cancel()
	values, err := redisClient.HGetAll(redisCtx, key).Result()
	if err != nil {
		return outboundSendClaim{}, false, fmt.Errorf("inspect outbound idempotency: %w", err)
	}
	if len(values) == 0 {
		return outboundSendClaim{}, false, nil
	}
	claim := outboundSendClaim{
		Operation:    operation,
		Key:          key,
		State:        values["state"],
		MetaJSON:     values["meta_json"],
		CreatedAtMS:  parseOutboundLedgerTimestamp(values["created_at_ms"]),
		TerminalAtMS: parseOutboundLedgerTimestamp(values["terminal_at_ms"]),
		ExpiresAtMS:  parseOutboundLedgerTimestamp(values["expires_at_ms"]),
	}
	if raw := values["result_json"]; raw != "" {
		if err := json.Unmarshal([]byte(raw), &claim.Result); err != nil {
			return outboundSendClaim{}, false, fmt.Errorf("decode inspected outbound result: %w", err)
		}
	}
	if raw := values["recovery_json"]; raw != "" {
		var recovery outboundRecoveryRecord
		if err := json.Unmarshal([]byte(raw), &recovery); err != nil {
			return outboundSendClaim{}, false, fmt.Errorf("decode inspected outbound recovery: %w", err)
		}
		claim.Recovery = &recovery
	}
	return claim, true, nil
}

func parseOutboundLedgerTimestamp(value string) int64 {
	parsed, _ := strconv.ParseInt(strings.TrimSpace(value), 10, 64)
	return parsed
}

func (w *Worker) markOutboundProviderInvoked(ctx context.Context, claim outboundSendClaim) error {
	return w.transitionOutboundClaim(
		ctx,
		claim,
		sendIdempotencyStateReserved,
		sendIdempotencyStateInvoked,
		outboundProviderInvocationLease(w.cfg.SendTimeout).Milliseconds(),
		nil,
		nil,
		nil,
	)
}

func markOutboundProviderInvokedWithRedis(ctx context.Context, redisClient *redis.Client, claim outboundSendClaim) error {
	return transitionOutboundClaimWithRedis(
		ctx,
		redisClient,
		claim,
		sendIdempotencyStateReserved,
		sendIdempotencyStateInvoked,
		sendIdempotencyProviderLease.Milliseconds(),
		nil,
		nil,
		nil,
	)
}

func (w *Worker) revertOutboundProviderInvocationBeforeStart(ctx context.Context, claim outboundSendClaim) error {
	return revertOutboundProviderInvocationBeforeStartWithRedis(ctx, w.redis, claim)
}

func revertOutboundProviderInvocationBeforeStartWithRedis(
	ctx context.Context,
	redisClient *redis.Client,
	claim outboundSendClaim,
) error {
	baseCtx := context.Background()
	if ctx != nil {
		baseCtx = context.WithoutCancel(ctx)
	}
	revertCtx, cancel := context.WithTimeout(baseCtx, outboundAuthorizationFenceTimeout)
	defer cancel()

	return transitionOutboundClaimWithRedis(
		revertCtx,
		redisClient,
		claim,
		sendIdempotencyStateInvoked,
		sendIdempotencyStateReserved,
		sendIdempotencyLease.Milliseconds(),
		nil,
		errors.New("provider start fence rejected"),
		nil,
	)
}

func (w *Worker) markOutboundProviderInvokedWithRecovery(
	ctx context.Context,
	claim outboundSendClaim,
	recovery outboundRecoveryRecord,
) error {
	if err := validateOutboundRecoveryRecord(recovery); err != nil {
		return err
	}
	return w.transitionOutboundClaim(
		ctx,
		claim,
		sendIdempotencyStateReserved,
		sendIdempotencyStateInvoked,
		outboundProviderInvocationLease(w.cfg.SendTimeout).Milliseconds(),
		nil,
		nil,
		&recovery,
	)
}

func runRepeatableOutboundProviderInvocationBoundary(
	ctx context.Context,
	providerInvoked *bool,
	assertAuthorized func(context.Context) error,
	markFirstProviderInvocation func(context.Context) error,
) error {
	if providerInvoked == nil || assertAuthorized == nil || markFirstProviderInvocation == nil {
		return errors.New("repeatable outbound provider boundary callbacks are required")
	}
	if *providerInvoked {
		// Once the CAS has crossed the point of no return, no later assignment
		// guard may prevent a provider call covered by the same operation.
		return nil
	}
	if err := assertAuthorized(ctx); err != nil {
		return err
	}
	if err := markFirstProviderInvocation(ctx); err != nil {
		return err
	}
	*providerInvoked = true
	return nil
}

func runOutboundProviderInvocationFence(
	ctx context.Context,
	providerInvoked *bool,
	assertAuthorized func(context.Context) error,
	markProviderInvoked func(context.Context) error,
	revertProviderInvocationBeforeStart func(context.Context, error) error,
) error {
	if providerInvoked == nil ||
		assertAuthorized == nil ||
		markProviderInvoked == nil ||
		revertProviderInvocationBeforeStart == nil {
		return errors.New("outbound provider invocation fence callbacks are required")
	}
	if err := assertAuthorized(ctx); err != nil {
		return err
	}

	if err := markProviderInvoked(ctx); err != nil {
		return err
	}
	*providerInvoked = true
	// The Redis CAS can finish after the authorization that preceded it has
	// already been revoked. Recheck at the final boundary before scheduling the
	// SDK call. Only a confirmed, owner-fenced reversal proves that this
	// operation is safe to reopen as reserved; an uncertain reversal remains
	// provider_invoked/fail-closed.
	if err := assertAuthorized(ctx); err != nil {
		revertErr := revertProviderInvocationBeforeStart(ctx, err)
		if revertErr != nil {
			return errors.Join(
				err,
				fmt.Errorf("revert provider invocation before start: %w", revertErr),
			)
		}
		*providerInvoked = false
		return err
	}
	return nil
}

func (w *Worker) markOutboundProviderInvokedWithDispatchFence(
	ctx context.Context,
	claim outboundSendClaim,
	providerInvoked *bool,
	assertAuthorized func(context.Context) error,
) error {
	return runOutboundProviderInvocationFence(
		ctx,
		providerInvoked,
		assertAuthorized,
		func(markCtx context.Context) error {
			return w.markOutboundProviderInvoked(markCtx, claim)
		},
		func(revertCtx context.Context, _ error) error {
			return w.revertOutboundProviderInvocationBeforeStart(revertCtx, claim)
		},
	)
}

func (w *Worker) markOutboundProviderInvokedWithRecoveryAndDispatchFence(
	ctx context.Context,
	claim outboundSendClaim,
	providerInvoked *bool,
	recovery outboundRecoveryRecord,
	assertAuthorized func(context.Context) error,
) error {
	if err := validateOutboundRecoveryRecord(recovery); err != nil {
		return err
	}
	return runOutboundProviderInvocationFence(
		ctx,
		providerInvoked,
		assertAuthorized,
		func(markCtx context.Context) error {
			return w.markOutboundProviderInvokedWithRecovery(markCtx, claim, recovery)
		},
		func(revertCtx context.Context, _ error) error {
			return w.revertOutboundProviderInvocationBeforeStart(revertCtx, claim)
		},
	)
}

func (w *Worker) completeOutboundSuccess(ctx context.Context, claim outboundSendClaim, result map[string]any) error {
	return w.transitionOutboundClaim(ctx, claim, sendIdempotencyStateInvoked, sendIdempotencyStateSucceeded, 0, result, nil, nil)
}

func (w *Worker) completeOutboundSuccessWithRecovery(ctx context.Context, claim outboundSendClaim, result map[string]any, recovery outboundRecoveryRecord) error {
	if err := validateOutboundRecoveryRecord(recovery); err != nil {
		return err
	}
	return w.transitionOutboundClaim(ctx, claim, sendIdempotencyStateInvoked, sendIdempotencyStateSucceeded, 0, result, nil, &recovery)
}

func (w *Worker) completeOutboundAmbiguous(ctx context.Context, claim outboundSendClaim, cause error) error {
	return w.transitionOutboundClaim(ctx, claim, sendIdempotencyStateInvoked, sendIdempotencyStateAmbiguous, 0, nil, cause, nil)
}

func (w *Worker) completeOutboundAmbiguousWithRecovery(
	ctx context.Context,
	claim outboundSendClaim,
	cause error,
	recovery outboundRecoveryRecord,
) error {
	if err := validateOutboundRecoveryRecord(recovery); err != nil {
		return err
	}
	return w.transitionOutboundClaim(
		ctx,
		claim,
		sendIdempotencyStateInvoked,
		sendIdempotencyStateAmbiguous,
		0,
		nil,
		cause,
		&recovery,
	)
}

func (w *Worker) completeOutboundPreProviderFailure(ctx context.Context, claim outboundSendClaim, cause error) error {
	return w.transitionOutboundClaim(ctx, claim, sendIdempotencyStateReserved, sendIdempotencyStateFailed, 0, nil, cause, nil)
}

func (w *Worker) completeOutboundPreProviderFailureWithRecovery(
	ctx context.Context,
	claim outboundSendClaim,
	cause error,
	recovery outboundRecoveryRecord,
) error {
	if err := validateOutboundRecoveryRecord(recovery); err != nil {
		return err
	}
	return w.transitionOutboundClaim(
		ctx,
		claim,
		sendIdempotencyStateReserved,
		sendIdempotencyStateFailed,
		0,
		nil,
		cause,
		&recovery,
	)
}

func (w *Worker) transitionOutboundClaim(ctx context.Context, claim outboundSendClaim, expectedState, nextState string, leaseDurationMs int64, result map[string]any, cause error, recovery *outboundRecoveryRecord) error {
	boundRecovery, err := w.bindWorkerCommandLaneRecovery(ctx, recovery, nextState)
	if err != nil {
		return err
	}
	return transitionOutboundClaimWithRedis(ctx, w.redis, claim, expectedState, nextState, leaseDurationMs, result, cause, boundRecovery)
}

func (w *Worker) bindWorkerCommandLaneRecovery(
	ctx context.Context,
	recovery *outboundRecoveryRecord,
	nextState string,
) (*outboundRecoveryRecord, error) {
	reference := workerCommandLaneRecoveryReferenceFromContext(ctx)
	if reference == nil || nextState == sendIdempotencyStateReserved {
		return recovery, nil
	}
	if recovery != nil {
		copy := *recovery
		if copy.WorkerCommandLane == nil {
			copy.WorkerCommandLane = reference
		}
		if err := validateOutboundRecoveryRecord(copy); err != nil {
			return nil, err
		}
		return &copy, nil
	}
	assignmentEpoch, err := w.kafkaDispatchAssignmentEpoch(ctx)
	if err != nil {
		return nil, err
	}
	synthetic := outboundRecoveryRecord{
		SchemaVersion:           outboundRecoverySchemaVersion,
		WorkerID:                reference.WorkerID,
		AccountID:               reference.AccountID,
		ConsumerAssignmentEpoch: assignmentEpoch,
		TargetKind:              outboundRecoveryTargetWorkerCommandLane,
		WorkerCommandLane:       reference,
		Publications:            []outboundRecoveryPublication{},
	}
	if err := validateOutboundRecoveryRecord(synthetic); err != nil {
		return nil, err
	}
	return &synthetic, nil
}

func transitionOutboundClaimWithRedis(ctx context.Context, redisClient *redis.Client, claim outboundSendClaim, expectedState, nextState string, leaseDurationMs int64, result map[string]any, cause error, recovery *outboundRecoveryRecord) error {
	if redisClient == nil || claim.Key == "" || claim.Owner == "" {
		return errors.New("valid redis idempotency claim is required")
	}
	resultJSON := ""
	if result != nil {
		payload, err := json.Marshal(result)
		if err != nil {
			return err
		}
		resultJSON = string(payload)
	}
	errorText := ""
	if cause != nil {
		errorText = cause.Error()
	}
	recoveryJSON := ""
	if recovery != nil {
		payload, err := json.Marshal(recovery)
		if err != nil {
			return err
		}
		recoveryJSON = string(payload)
	}
	ttl, err := sendIdempotencyTTL(nextState)
	if err != nil {
		return err
	}
	outcome := sha256.Sum256([]byte(strings.Join([]string{nextState, resultJSON, errorText, recoveryJSON}, "\x00")))
	redisCtx, cancel := withOutboundRedisOperationDeadline(ctx)
	defer cancel()
	value, err := redisClient.Eval(redisCtx, transitionOutboundSendScript, []string{claim.Key, outboundProviderWatchdogQueueKey()},
		claim.Owner,
		expectedState,
		nextState,
		strconv.FormatInt(leaseDurationMs, 10),
		resultJSON,
		errorText,
		strconv.FormatInt(ttl.Milliseconds(), 10),
		recoveryJSON,
		hex.EncodeToString(outcome[:]),
		workerCommandProviderWatchdog.Milliseconds(),
		int64(workerCommandRecoveryTTL/time.Second),
	).Result()
	if err != nil {
		return fmt.Errorf("transition outbound idempotency to %s: %w", nextState, err)
	}
	values, err := outboundLuaValues(value, 2)
	if err != nil {
		return err
	}
	if values[0] != "1" {
		return fmt.Errorf("outbound idempotency transition rejected expected=%s actual=%s", expectedState, values[1])
	}
	recordWorkerCommandLedgerState(ctx, nextState)
	return nil
}

func (w *Worker) releaseOutboundReservation(
	ctx context.Context,
	claim outboundSendClaim,
	recoveryPrepared ...bool,
) error {
	removeRecovery := len(recoveryPrepared) > 0 && recoveryPrepared[0]
	return releaseOutboundReservationWithRedis(
		ctx,
		w.redis,
		claim,
		outboundRecoveryQueueKey(w.cfg.WorkerID),
		removeRecovery,
	)
}

func releaseOutboundReservationWithRedis(
	ctx context.Context,
	redisClient *redis.Client,
	claim outboundSendClaim,
	recoveryQueueKey string,
	recoveryPrepared bool,
) error {
	if redisClient == nil || claim.Key == "" || claim.Owner == "" {
		return errors.New("valid redis idempotency claim is required")
	}
	if strings.TrimSpace(recoveryQueueKey) == "" {
		return errors.New("outbound recovery queue key is required")
	}
	removeRecovery := "0"
	if recoveryPrepared {
		removeRecovery = "1"
	}
	redisCtx, cancel := withOutboundRedisOperationDeadline(ctx)
	defer cancel()
	released, err := redisClient.Eval(
		redisCtx,
		releaseOutboundSendScript,
		[]string{claim.Key, recoveryQueueKey},
		claim.Owner,
		removeRecovery,
		claim.Key,
	).Int64()
	if err != nil {
		return fmt.Errorf("release outbound idempotency reservation: %w", err)
	}
	if released != 1 {
		return errors.New("outbound idempotency reservation was not owned")
	}
	return nil
}

func outboundLuaValues(value any, minimum int) ([]string, error) {
	rawValues, ok := value.([]any)
	if !ok || len(rawValues) < minimum {
		return nil, fmt.Errorf("invalid outbound idempotency lua result %T", value)
	}
	values := make([]string, len(rawValues))
	for index, raw := range rawValues {
		switch typed := raw.(type) {
		case string:
			values[index] = typed
		case []byte:
			values[index] = string(typed)
		case int64:
			values[index] = strconv.FormatInt(typed, 10)
		case nil:
			values[index] = ""
		default:
			values[index] = fmt.Sprint(typed)
		}
	}
	return values, nil
}

func recoveredUpdateMessage(claim outboundSendClaim) (any, bool) {
	if claim.Result == nil {
		return nil, false
	}
	update, ok := claim.Result["update_message"]
	if !ok || update == nil {
		return nil, false
	}
	return update, true
}

func outboundRecoveryQueueKey(workerID string) string {
	return "message-send:recovery:v4:" + strings.TrimSpace(workerID)
}

func outboundProviderWatchdogQueueKey() string {
	return "message-send:provider-watchdog:v4"
}

func newOutboundRecoveryPublication(topic, key string, payload any) (outboundRecoveryPublication, error) {
	encoded, err := json.Marshal(payload)
	if err != nil {
		return outboundRecoveryPublication{}, fmt.Errorf("encode outbound recovery publication: %w", err)
	}
	publication := outboundRecoveryPublication{
		Topic:   strings.TrimSpace(topic),
		Key:     key,
		Payload: encoded,
	}
	if err := validateOutboundRecoveryPublication(publication); err != nil {
		return outboundRecoveryPublication{}, err
	}
	return publication, nil
}

func validateOutboundRecoveryPublication(publication outboundRecoveryPublication) error {
	switch publication.Topic {
	case topicUpdateMessage, topicUpdateMessageStatus, topicScheduleStatusUpdate:
	default:
		return fmt.Errorf("unsupported outbound recovery topic %q", publication.Topic)
	}
	if strings.TrimSpace(publication.Key) == "" {
		return errors.New("outbound recovery publication key is required")
	}
	if len(publication.Payload) == 0 || !json.Valid(publication.Payload) {
		return errors.New("outbound recovery publication payload must be valid JSON")
	}
	return nil
}

func validateOutboundRecoveryRecord(recovery outboundRecoveryRecord) error {
	if recovery.SchemaVersion != outboundRecoverySchemaVersion {
		return fmt.Errorf("%w: unsupported schema version %d", errOutboundRecoveryObsolete, recovery.SchemaVersion)
	}
	if strings.TrimSpace(recovery.WorkerID) == "" {
		return fmt.Errorf("%w: worker_id is required", errOutboundRecoveryObsolete)
	}
	if recovery.OriginRuntimeGeneration < 0 {
		return fmt.Errorf("%w: origin_runtime_generation is invalid", errOutboundRecoveryObsolete)
	}
	if recovery.ConsumerAssignmentEpoch == 0 {
		return fmt.Errorf("%w: consumer_assignment_epoch is required", errOutboundRecoveryObsolete)
	}
	if recovery.ScheduleAttempt != nil {
		if _, err := scheduleMessageAttemptKey(*recovery.ScheduleAttempt); err != nil {
			return fmt.Errorf("%w: invalid schedule attempt: %v", errOutboundRecoveryObsolete, err)
		}
	}
	if reference := recovery.WorkerCommandLane; reference != nil {
		if strings.TrimSpace(reference.AccountID) == "" ||
			strings.TrimSpace(reference.WorkerID) == "" ||
			strings.TrimSpace(reference.EntityKey) == "" ||
			strings.TrimSpace(reference.OperationID) == "" ||
			strings.TrimSpace(reference.CommandID) == "" ||
			reference.AccountID != recovery.AccountID ||
			reference.WorkerID != recovery.WorkerID {
			return fmt.Errorf("%w: invalid worker command lane recovery reference", errOutboundRecoveryObsolete)
		}
	}
	targetKind := strings.TrimSpace(recovery.TargetKind)
	switch targetKind {
	case "":
		if len(recovery.Publications) == 0 {
			return fmt.Errorf("%w: record has no publications", errOutboundRecoveryObsolete)
		}
	case outboundRecoveryTargetNotification:
		if len(recovery.Publications) != 0 || recovery.ScheduleAttempt != nil {
			return fmt.Errorf(
				"%w: notification terminal recovery cannot contain publications or a schedule attempt",
				errOutboundRecoveryObsolete,
			)
		}
		if strings.TrimSpace(recovery.AccountID) == "" ||
			recovery.OriginRuntimeGeneration <= 0 ||
			strings.TrimSpace(recovery.OriginConnectionEpoch) == "" {
			return fmt.Errorf(
				"%w: notification terminal recovery requires account and runtime identity",
				errOutboundRecoveryObsolete,
			)
		}
	case outboundRecoveryTargetWorkerCommandLane:
		if recovery.WorkerCommandLane == nil || len(recovery.Publications) != 0 || recovery.ScheduleAttempt != nil {
			return fmt.Errorf(
				"%w: worker command lane recovery must contain only its lane reference",
				errOutboundRecoveryObsolete,
			)
		}
	default:
		return fmt.Errorf(
			"%w: unsupported target kind %q",
			errOutboundRecoveryObsolete,
			targetKind,
		)
	}
	for _, publication := range recovery.Publications {
		if err := validateOutboundRecoveryPublication(publication); err != nil {
			return fmt.Errorf("%w: %v", errOutboundRecoveryObsolete, err)
		}
	}
	return nil
}

func outboundRecoveryMetaAssignmentEpoch(raw string) uint64 {
	if strings.TrimSpace(raw) == "" {
		return 0
	}
	var meta struct {
		ConsumerAssignmentEpoch uint64 `json:"consumer_assignment_epoch"`
	}
	if err := json.Unmarshal([]byte(raw), &meta); err != nil {
		return 0
	}
	return meta.ConsumerAssignmentEpoch
}

type outboundRecoveryPublicationIdentity struct {
	AccountID         string
	WorkerID          string
	SourceProvider    string
	RuntimeGeneration int
	ConnectionEpoch   string
	EventID           string
}

func validateOutboundRecoveryIdentity(
	publication outboundRecoveryPublication,
	identity outboundRecoveryPublicationIdentity,
	expectedAccountID string,
	expectedWorkerID string,
) error {
	if identity.AccountID != expectedAccountID {
		return fmt.Errorf(
			"%w: publication account_id mismatch topic=%s expected=%s actual=%s",
			errOutboundRecoveryObsolete,
			publication.Topic,
			expectedAccountID,
			identity.AccountID,
		)
	}
	if identity.WorkerID != expectedWorkerID ||
		identity.SourceProvider != "whatsmeow" ||
		identity.RuntimeGeneration <= 0 ||
		strings.TrimSpace(identity.ConnectionEpoch) == "" ||
		strings.TrimSpace(identity.EventID) == "" {
		return fmt.Errorf(
			"%w: invalid publication identity topic=%s worker_id=%s provider=%s runtime_generation=%d event_id=%s",
			errOutboundRecoveryObsolete,
			publication.Topic,
			identity.WorkerID,
			identity.SourceProvider,
			identity.RuntimeGeneration,
			identity.EventID,
		)
	}
	return nil
}

func preserveOutboundRecoveryPublication(
	publication outboundRecoveryPublication,
	expectedAccountID string,
	expectedWorkerID string,
) (outboundRecoveryPublication, outboundRecoveryPublicationIdentity, error) {
	var identity outboundRecoveryPublicationIdentity

	switch publication.Topic {
	case topicUpdateMessage:
		var update UpdateMessage
		if err := json.Unmarshal(publication.Payload, &update); err != nil {
			return outboundRecoveryPublication{}, identity, fmt.Errorf(
				"%w: decode message update recovery: %v",
				errOutboundRecoveryObsolete,
				err,
			)
		}
		identity = outboundRecoveryPublicationIdentity{
			AccountID:         strings.TrimSpace(stringValue(update.Data.Account["id"])),
			WorkerID:          strings.TrimSpace(update.WorkerID),
			SourceProvider:    strings.TrimSpace(update.SourceProvider),
			RuntimeGeneration: update.RuntimeGeneration,
			ConnectionEpoch:   strings.TrimSpace(update.ConnectionEpoch),
			EventID:           strings.TrimSpace(update.EventID),
		}
		if identity.WorkerID == "" {
			identity.WorkerID = strings.TrimSpace(stringValue(update.Data.Worker["id"]))
		}
		if err := validateOutboundRecoveryIdentity(
			publication,
			identity,
			expectedAccountID,
			expectedWorkerID,
		); err != nil {
			return outboundRecoveryPublication{}, identity, err
		}
		expectedKey := outboundUpdateKafkaKey(
			identity.AccountID,
			identity.WorkerID,
			update.Data.MessageID,
		)
		if strings.TrimSpace(publication.Key) != expectedKey {
			return outboundRecoveryPublication{}, identity, fmt.Errorf(
				"%w: message update recovery key mismatch",
				errOutboundRecoveryObsolete,
			)
		}

	case topicUpdateMessageStatus:
		var update MessageStatusUpdate
		if err := json.Unmarshal(publication.Payload, &update); err != nil {
			return outboundRecoveryPublication{}, identity, fmt.Errorf(
				"%w: decode message status recovery: %v",
				errOutboundRecoveryObsolete,
				err,
			)
		}
		identity = outboundRecoveryPublicationIdentity{
			AccountID:         strings.TrimSpace(update.AccountID),
			WorkerID:          strings.TrimSpace(update.WorkerID),
			SourceProvider:    strings.TrimSpace(update.SourceProvider),
			RuntimeGeneration: update.RuntimeGeneration,
			ConnectionEpoch:   strings.TrimSpace(update.ConnectionEpoch),
			EventID:           strings.TrimSpace(update.EventID),
		}
		if err := validateOutboundRecoveryIdentity(
			publication,
			identity,
			expectedAccountID,
			expectedWorkerID,
		); err != nil {
			return outboundRecoveryPublication{}, identity, err
		}
		expectedKey := messageStatusKafkaKey(
			identity.AccountID,
			identity.WorkerID,
			update.MessageID,
		)
		if strings.TrimSpace(publication.Key) != expectedKey {
			return outboundRecoveryPublication{}, identity, fmt.Errorf(
				"%w: message status recovery key mismatch",
				errOutboundRecoveryObsolete,
			)
		}

	case topicScheduleStatusUpdate:
		var update ScheduleStatusUpdate
		if err := json.Unmarshal(publication.Payload, &update); err != nil {
			return outboundRecoveryPublication{}, identity, fmt.Errorf(
				"%w: decode schedule status recovery: %v",
				errOutboundRecoveryObsolete,
				err,
			)
		}
		identity = outboundRecoveryPublicationIdentity{
			AccountID:         strings.TrimSpace(update.AccountID),
			WorkerID:          strings.TrimSpace(update.WorkerID),
			SourceProvider:    strings.TrimSpace(update.SourceProvider),
			RuntimeGeneration: update.RuntimeGeneration,
			ConnectionEpoch:   strings.TrimSpace(update.ConnectionEpoch),
			EventID:           strings.TrimSpace(update.EventID),
		}
		if err := validateOutboundRecoveryIdentity(
			publication,
			identity,
			expectedAccountID,
			expectedWorkerID,
		); err != nil {
			return outboundRecoveryPublication{}, identity, err
		}
		expectedKey := scheduleStatusKafkaKey(
			update.ScheduleID,
			update.ContactID,
			update.MessageID,
		)
		if strings.TrimSpace(publication.Key) != expectedKey {
			return outboundRecoveryPublication{}, identity, fmt.Errorf(
				"%w: schedule status recovery key mismatch",
				errOutboundRecoveryObsolete,
			)
		}

	default:
		return outboundRecoveryPublication{}, identity, fmt.Errorf(
			"%w: unsupported publication topic %s",
			errOutboundRecoveryObsolete,
			publication.Topic,
		)
	}
	// The provider outcome belongs to the runtime which produced it. Only the
	// Kafka assignment fence may be rebound; rewriting runtime identity would
	// make a disconnected/replacement runtime appear to have produced it.
	preserved := publication
	preserved.Payload = append(json.RawMessage(nil), publication.Payload...)
	return preserved, identity, nil
}

// rebindOutboundRecoveryRecord preserves the provider result and stable event
// IDs while moving only the Kafka acceptance fence to the current assignment.
// Provider operations are not representable in the recovery publication
// allowlist, so this can never resend a WhatsApp message.
func rebindOutboundRecoveryRecord(
	recovery outboundRecoveryRecord,
	expectedAccountID string,
	expectedWorkerID string,
	currentAssignmentEpoch uint64,
	currentRuntimeGeneration int,
) (outboundRecoveryRecord, error) {
	if err := validateOutboundRecoveryRecord(recovery); err != nil {
		return outboundRecoveryRecord{}, err
	}
	expectedAccountID = strings.TrimSpace(expectedAccountID)
	expectedWorkerID = strings.TrimSpace(expectedWorkerID)
	if expectedAccountID == "" || expectedWorkerID == "" ||
		recovery.WorkerID != expectedWorkerID ||
		currentAssignmentEpoch == 0 {
		return outboundRecoveryRecord{}, fmt.Errorf(
			"%w: current recovery identity is invalid",
			errOutboundRecoveryObsolete,
		)
	}
	if accountID := strings.TrimSpace(recovery.AccountID); accountID != "" &&
		accountID != expectedAccountID {
		return outboundRecoveryRecord{}, fmt.Errorf(
			"%w: recovery account_id mismatch",
			errOutboundRecoveryObsolete,
		)
	}
	if recovery.ScheduleAttempt != nil {
		if accountID := strings.TrimSpace(recovery.ScheduleAttempt.AccountID); accountID != "" &&
			accountID != expectedAccountID {
			return outboundRecoveryRecord{}, fmt.Errorf(
				"%w: schedule recovery account_id mismatch",
				errOutboundRecoveryObsolete,
			)
		}
		if workerID := strings.TrimSpace(recovery.ScheduleAttempt.WorkerID); workerID != "" &&
			workerID != expectedWorkerID {
			return outboundRecoveryRecord{}, fmt.Errorf(
				"%w: schedule recovery worker_id mismatch",
				errOutboundRecoveryObsolete,
			)
		}
	}

	rebound := recovery
	rebound.AccountID = expectedAccountID
	rebound.ConsumerAssignmentEpoch = currentAssignmentEpoch
	rebound.Publications = make([]outboundRecoveryPublication, 0, len(recovery.Publications))
	originGeneration := 0
	originEpoch := ""
	if recovery.TargetKind == outboundRecoveryTargetNotification {
		originGeneration = recovery.OriginRuntimeGeneration
		originEpoch = strings.TrimSpace(recovery.OriginConnectionEpoch)
	}
	for _, publication := range recovery.Publications {
		reboundPublication, identity, err := preserveOutboundRecoveryPublication(
			publication,
			expectedAccountID,
			expectedWorkerID,
		)
		if err != nil {
			return outboundRecoveryRecord{}, err
		}
		if originGeneration == 0 {
			originGeneration = identity.RuntimeGeneration
			originEpoch = identity.ConnectionEpoch
		} else if originGeneration != identity.RuntimeGeneration ||
			originEpoch != identity.ConnectionEpoch {
			return outboundRecoveryRecord{}, fmt.Errorf(
				"%w: recovery publications span different runtime fences",
				errOutboundRecoveryObsolete,
			)
		}
		rebound.Publications = append(rebound.Publications, reboundPublication)
	}
	if recovery.OriginRuntimeGeneration > 0 &&
		recovery.OriginRuntimeGeneration != originGeneration {
		return outboundRecoveryRecord{}, fmt.Errorf(
			"%w: origin runtime generation mismatch",
			errOutboundRecoveryObsolete,
		)
	}
	if strings.TrimSpace(recovery.OriginConnectionEpoch) != "" &&
		recovery.OriginConnectionEpoch != originEpoch {
		return outboundRecoveryRecord{}, fmt.Errorf(
			"%w: origin connection epoch mismatch",
			errOutboundRecoveryObsolete,
		)
	}
	if currentRuntimeGeneration > 0 && originGeneration > currentRuntimeGeneration {
		return outboundRecoveryRecord{}, fmt.Errorf(
			"%w: origin=%d current=%d",
			errOutboundRecoveryFutureRuntime,
			originGeneration,
			currentRuntimeGeneration,
		)
	}
	rebound.OriginRuntimeGeneration = originGeneration
	rebound.OriginConnectionEpoch = originEpoch
	return rebound, nil
}

func (w *Worker) assertOutboundRecoveryPublicationScope(
	ctx context.Context,
	publication outboundRecoveryPublication,
) error {
	if w.whatsapp == nil {
		return errWhatsAppRuntimeFenceRevoked
	}
	var envelope struct {
		WorkerID          string `json:"worker_id"`
		SourceProvider    string `json:"source_provider"`
		RuntimeGeneration int    `json:"runtime_generation"`
		ConnectionEpoch   string `json:"connection_epoch"`
	}
	if err := json.Unmarshal(publication.Payload, &envelope); err != nil {
		return errWhatsAppRuntimeFenceRevoked
	}
	if strings.TrimSpace(envelope.WorkerID) == "" ||
		envelope.WorkerID != w.cfg.WorkerID ||
		envelope.SourceProvider != "whatsmeow" ||
		envelope.RuntimeGeneration <= 0 ||
		strings.TrimSpace(envelope.ConnectionEpoch) == "" {
		return errWhatsAppRuntimeFenceRevoked
	}

	active, err := w.whatsapp.captureActiveConnectionScope(ctx)
	if err != nil ||
		active.WorkerID != envelope.WorkerID ||
		active.SourceProvider != envelope.SourceProvider ||
		active.RuntimeGeneration != envelope.RuntimeGeneration ||
		active.ConnectionEpoch != envelope.ConnectionEpoch {
		return errWhatsAppRuntimeFenceRevoked
	}
	return w.whatsapp.assertCapturedConnectionScope(ctx, active)
}

func (w *Worker) assertOutboundRecoveryAssignmentActive(recovery outboundRecoveryRecord) error {
	if strings.TrimSpace(recovery.WorkerID) == "" ||
		recovery.WorkerID != w.cfg.WorkerID ||
		recovery.ConsumerAssignmentEpoch == 0 {
		return errOutboundRecoveryObsolete
	}
	if recovery.ConsumerAssignmentEpoch != w.kafkaConsumerBarrierEpoch.Load() {
		return errKafkaConsumerDispatchRevoked
	}
	// Provider dispatch authorization is intentionally closed while WhatsApp
	// is disconnected. Terminal recovery only needs the Kafka consumer
	// generation to remain owned; stop/replacement clears Started and advances
	// the epoch before cancellation.
	if w.kafkaConsumersStarted.Load() {
		return nil
	}
	if !w.kafkaConsumersAuthorized.Load() || !w.kafkaConsumersReady.Load() {
		return errKafkaConsumerDispatchRevoked
	}
	return nil
}

// prepareOutboundRecovery creates the durable index before the provider can be
// invoked. If this write fails, callers must release the reservation and must
// not call WhatsApp. The succeeded ledger later supplies the publication body.
func (w *Worker) prepareOutboundRecovery(ctx context.Context, claim outboundSendClaim) error {
	if w.redis == nil || strings.TrimSpace(w.cfg.WorkerID) == "" || claim.Key == "" {
		return errors.New("redis, worker_id and idempotency claim are required for outbound recovery")
	}
	queueKey := outboundRecoveryQueueKey(w.cfg.WorkerID)
	redisCtx, cancel := withOutboundRedisOperationDeadline(ctx)
	defer cancel()
	_, err := w.redis.Eval(
		redisCtx,
		prepareOutboundRecoveryScript,
		[]string{queueKey, claim.Key},
		claim.Key,
		strconv.FormatInt(int64(workerCommandRecoveryTTL/time.Second), 10),
	).Result()
	if err != nil {
		return fmt.Errorf("prepare durable outbound recovery: %w", err)
	}
	return nil
}

func (w *Worker) removeOutboundRecoveryIndex(ctx context.Context, claimKey string) error {
	if w.redis == nil || strings.TrimSpace(w.cfg.WorkerID) == "" || claimKey == "" {
		return nil
	}
	redisCtx, cancel := withOutboundRedisOperationDeadline(ctx)
	defer cancel()
	if err := w.redis.ZRem(redisCtx, outboundRecoveryQueueKey(w.cfg.WorkerID), claimKey).Err(); err != nil {
		return fmt.Errorf("remove outbound recovery index: %w", err)
	}
	return nil
}

func (w *Worker) releaseOutboundReservationBestEffort(ctx context.Context, claim outboundSendClaim, recoveryPrepared bool) {
	releaseCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	if err := w.releaseOutboundReservation(releaseCtx, claim, recoveryPrepared); err != nil {
		log.Printf("whatsmeow outbound reservation release failed worker_id=%s key_hash=%s error_code=%s", w.cfg.WorkerID, hashConnectionFlowIdentifier(claim.Key), safeOperationalErrorCode(err))
	}
}

func (w *Worker) outboundRecoveryDispatchAssignment(
	ctx context.Context,
) (uint64, error) {
	if ctx == nil {
		return 0, errKafkaConsumerDispatchRevoked
	}
	if err := ctx.Err(); err != nil {
		return 0, errors.Join(errKafkaConsumerDispatchRevoked, err)
	}
	if !w.kafkaConsumersStarted.Load() &&
		(!w.kafkaConsumersAuthorized.Load() || !w.kafkaConsumersReady.Load()) {
		return 0, errKafkaConsumerDispatchRevoked
	}
	assignmentEpoch := w.kafkaConsumerBarrierEpoch.Load()
	if assignmentEpoch == 0 {
		return 0, errKafkaConsumerDispatchRevoked
	}
	// Immediate recovery may still carry the source handler's authorization.
	// Reject a stale handler instead of silently rebinding it to a replacement
	// Kafka generation. The background recovery loop has no handler context and
	// is authorized by the captured current epoch below.
	if authorization, ok := ctx.Value(kafkaDispatchAuthorizationContextKey{}).(kafkaDispatchAuthorization); ok {
		if authorization.worker != w || authorization.epoch != assignmentEpoch {
			return 0, errKafkaConsumerDispatchRevoked
		}
	}
	probe := outboundRecoveryRecord{
		WorkerID:                w.cfg.WorkerID,
		ConsumerAssignmentEpoch: assignmentEpoch,
	}
	if err := w.assertOutboundRecoveryAssignmentActive(probe); err != nil {
		return 0, err
	}
	return assignmentEpoch, nil
}

func (w *Worker) bindOutboundRecoveryForDispatch(
	ctx context.Context,
	recovery outboundRecoveryRecord,
) (outboundRecoveryRecord, error) {
	if err := validateOutboundRecoveryRecord(recovery); err != nil {
		return outboundRecoveryRecord{}, err
	}
	assignmentEpoch, err := w.outboundRecoveryDispatchAssignment(ctx)
	if err != nil {
		return outboundRecoveryRecord{}, err
	}
	bound, err := rebindOutboundRecoveryRecord(
		recovery,
		w.cfg.AccountID,
		w.cfg.WorkerID,
		assignmentEpoch,
		w.cfg.RuntimeGeneration,
	)
	if err != nil {
		return outboundRecoveryRecord{}, err
	}
	if err := w.assertOutboundRecoveryAssignmentActive(bound); err != nil {
		return outboundRecoveryRecord{}, err
	}
	return bound, nil
}

func (w *Worker) assertOutboundRecoveryPublicationIdentity(
	recovery outboundRecoveryRecord,
	publication outboundRecoveryPublication,
) error {
	_, identity, err := preserveOutboundRecoveryPublication(
		publication,
		w.cfg.AccountID,
		w.cfg.WorkerID,
	)
	if err != nil {
		return err
	}
	if identity.RuntimeGeneration != recovery.OriginRuntimeGeneration ||
		identity.ConnectionEpoch != recovery.OriginConnectionEpoch {
		return fmt.Errorf(
			"%w: publication runtime identity changed after durable binding",
			errOutboundRecoveryObsolete,
		)
	}
	if w.cfg.RuntimeGeneration > 0 &&
		identity.RuntimeGeneration > w.cfg.RuntimeGeneration {
		return fmt.Errorf(
			"%w: origin=%d current=%d",
			errOutboundRecoveryFutureRuntime,
			identity.RuntimeGeneration,
			w.cfg.RuntimeGeneration,
		)
	}
	return nil
}

func (w *Worker) publishOutboundRecoveryRecord(ctx context.Context, recovery outboundRecoveryRecord) error {
	boundRecovery, err := w.bindOutboundRecoveryForDispatch(ctx, recovery)
	if err != nil {
		return err
	}
	if len(boundRecovery.Publications) == 0 {
		return nil
	}
	if w.outboundRecoveryPublisher != nil {
		if err := w.assertOutboundRecoveryAssignmentActive(boundRecovery); err != nil {
			return err
		}
		return w.outboundRecoveryPublisher(ctx, boundRecovery)
	}
	if w.kafka == nil {
		return errors.New("kafka client is required for outbound recovery")
	}
	for _, publication := range boundRecovery.Publications {
		publication := publication
		if err := retryOutboundPostProviderSideEffect(ctx, func(attemptCtx context.Context) error {
			if boundRecovery.ScheduleAttempt != nil {
				if err := w.assertScheduleMessageAttemptFromContext(attemptCtx); err != nil {
					return err
				}
			}
			if err := w.assertOutboundRecoveryPublicationIdentity(boundRecovery, publication); err != nil {
				return err
			}
			// Recheck the captured Kafka epoch immediately before publication.
			if err := w.assertOutboundRecoveryAssignmentActive(boundRecovery); err != nil {
				return err
			}
			if boundRecovery.ScheduleAttempt != nil {
				if err := w.assertScheduleMessageAttemptFromContext(attemptCtx); err != nil {
					return err
				}
			}
			return w.kafka.SendJSON(attemptCtx, publication.Topic, publication.Key, publication.Payload)
		}); err != nil {
			return err
		}
	}
	return nil
}

func (w *Worker) publishAndAcknowledgeOutboundRecovery(ctx context.Context, claim outboundSendClaim, recovery outboundRecoveryRecord) error {
	if err := w.publishOutboundRecoveryRecord(ctx, recovery); err != nil {
		return err
	}
	recoveryJSON, err := json.Marshal(recovery)
	if err != nil {
		return fmt.Errorf("encode outbound recovery acknowledgement: %w", err)
	}
	acknowledged, err := w.acknowledgeOutboundRecovery(
		ctx,
		outboundRecoveryClaim{Key: claim.Key},
		"",
		string(recoveryJSON),
	)
	if err != nil {
		return err
	}
	if !acknowledged {
		// A background process already owns this queue item or the terminal
		// ledger changed. The publication used a stable event ID, so leave the
		// item for its current owner instead of racing a destructive ZREM.
		log.Printf(
			"whatsmeow outbound recovery acknowledgement deferred worker_id=%s key_hash=%s reason=claim_changed_or_owned",
			w.cfg.WorkerID,
			hashConnectionFlowIdentifier(claim.Key),
		)
	}
	return nil
}

func (w *Worker) acknowledgeOutboundRecovery(
	ctx context.Context,
	claim outboundRecoveryClaim,
	expectedState string,
	expectedRecoveryJSON string,
) (bool, error) {
	if w.redis == nil || strings.TrimSpace(w.cfg.WorkerID) == "" || claim.Key == "" {
		return false, errors.New("redis, worker_id and recovery claim are required")
	}
	redisCtx, cancel := withOutboundRedisOperationDeadline(ctx)
	defer cancel()
	acknowledged, err := w.redis.Eval(
		redisCtx,
		acknowledgeOutboundRecoveryScript,
		[]string{outboundRecoveryQueueKey(w.cfg.WorkerID), claim.Key},
		claim.Key,
		claim.Owner,
		expectedState,
		expectedRecoveryJSON,
	).Int64()
	if err != nil {
		return false, fmt.Errorf("acknowledge outbound recovery: %w", err)
	}
	return acknowledged == 1, nil
}

func (w *Worker) claimDueOutboundRecoveries(ctx context.Context) ([]outboundRecoveryClaim, error) {
	if w.redis == nil {
		return nil, errors.New("redis is required for outbound recovery")
	}
	owner := uuid.NewString()
	redisCtx, cancel := withOutboundRedisOperationDeadline(ctx)
	defer cancel()
	value, err := w.redis.Eval(redisCtx, claimOutboundRecoveryScript, []string{outboundRecoveryQueueKey(w.cfg.WorkerID)},
		strconv.FormatInt(outboundRecoveryLease.Milliseconds(), 10),
		strconv.Itoa(outboundRecoveryBatchSize),
		owner,
	).Result()
	if err != nil {
		return nil, fmt.Errorf("claim outbound recoveries: %w", err)
	}
	keys, err := outboundLuaValues(value, 0)
	if err != nil {
		return nil, err
	}
	claims := make([]outboundRecoveryClaim, 0, len(keys))
	for _, key := range keys {
		if strings.TrimSpace(key) != "" {
			claims = append(claims, outboundRecoveryClaim{Key: key, Owner: owner})
		}
	}
	return claims, nil
}

func (w *Worker) rescheduleOutboundRecovery(
	ctx context.Context,
	claim outboundRecoveryClaim,
	expectedState string,
	expectedRecoveryJSON string,
) (bool, error) {
	if w.redis == nil || claim.Key == "" || claim.Owner == "" {
		return false, errors.New("owned outbound recovery claim is required")
	}
	redisCtx, cancel := withOutboundRedisOperationDeadline(ctx)
	defer cancel()
	rescheduled, err := w.redis.Eval(
		redisCtx,
		rescheduleOutboundRecoveryScript,
		[]string{outboundRecoveryQueueKey(w.cfg.WorkerID), claim.Key},
		claim.Key,
		strconv.FormatInt(outboundRecoveryRetryDelay.Milliseconds(), 10),
		claim.Owner,
		expectedState,
		expectedRecoveryJSON,
	).Int64()
	if err != nil {
		return false, fmt.Errorf("reschedule outbound recovery: %w", err)
	}
	return rescheduled == 1, nil
}

func (w *Worker) rescheduleOutboundRecoveryBestEffort(
	ctx context.Context,
	claim outboundRecoveryClaim,
	expectedState string,
	expectedRecoveryJSON string,
) {
	rescheduleCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	rescheduled, err := w.rescheduleOutboundRecovery(
		rescheduleCtx,
		claim,
		expectedState,
		expectedRecoveryJSON,
	)
	if err != nil {
		log.Printf(
			"whatsmeow outbound recovery reschedule failed worker_id=%s key_hash=%s error_code=%s",
			w.cfg.WorkerID,
			hashConnectionFlowIdentifier(claim.Key),
			safeOperationalErrorCode(err),
		)
		return
	}
	if !rescheduled {
		log.Printf(
			"whatsmeow outbound recovery reschedule skipped worker_id=%s key_hash=%s reason=claim_changed_or_reassigned",
			w.cfg.WorkerID,
			hashConnectionFlowIdentifier(claim.Key),
		)
	}
}

func (w *Worker) discardClaimedOutboundRecovery(
	ctx context.Context,
	claim outboundRecoveryClaim,
	expectedState string,
	expectedRecoveryJSON string,
) {
	discardCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	acknowledged, err := w.acknowledgeOutboundRecovery(
		discardCtx,
		claim,
		expectedState,
		expectedRecoveryJSON,
	)
	if err != nil {
		log.Printf(
			"whatsmeow outbound recovery discard failed worker_id=%s key_hash=%s error_code=%s",
			w.cfg.WorkerID,
			hashConnectionFlowIdentifier(claim.Key),
			safeOperationalErrorCode(err),
		)
		return
	}
	if !acknowledged {
		log.Printf(
			"whatsmeow outbound recovery discard skipped worker_id=%s key_hash=%s reason=claim_changed_or_reassigned",
			w.cfg.WorkerID,
			hashConnectionFlowIdentifier(claim.Key),
		)
	}
}

func (w *Worker) processOutboundRecovery(ctx context.Context, claim outboundRecoveryClaim) {
	values, err := w.redis.HMGet(ctx, claim.Key, "state", "recovery_json").Result()
	if err != nil {
		log.Printf("whatsmeow outbound recovery ledger read failed worker_id=%s key_hash=%s error_code=%s", w.cfg.WorkerID, hashConnectionFlowIdentifier(claim.Key), safeOperationalErrorCode(err))
		w.rescheduleOutboundRecoveryBestEffort(ctx, claim, "*", "*")
		return
	}
	state := ""
	recoveryJSON := ""
	if len(values) > 0 && values[0] != nil {
		state = fmt.Sprint(values[0])
	}
	if len(values) > 1 && values[1] != nil {
		recoveryJSON = fmt.Sprint(values[1])
	}

	switch state {
	case sendIdempotencyStateSucceeded, sendIdempotencyStateFailed, sendIdempotencyStateAmbiguous:
		if recoveryJSON == "" {
			w.discardClaimedOutboundRecovery(ctx, claim, state, recoveryJSON)
			return
		}
		var recovery outboundRecoveryRecord
		if err := json.Unmarshal([]byte(recoveryJSON), &recovery); err != nil {
			w.discardClaimedOutboundRecovery(ctx, claim, state, recoveryJSON)
			log.Printf("whatsmeow invalid outbound recovery discarded worker_id=%s key_hash=%s error_code=%s", w.cfg.WorkerID, hashConnectionFlowIdentifier(claim.Key), safeOperationalErrorCode(err))
			return
		}
		failureCode := ""
		switch state {
		case sendIdempotencyStateFailed:
			failureCode = "failed"
		case sendIdempotencyStateExpired:
			failureCode = "expired"
		case sendIdempotencyStateAmbiguous:
			failureCode = "ambiguous"
		}
		if laneErr := w.completeRecoveredWorkerCommandLane(
			ctx,
			recovery.WorkerCommandLane,
			state,
			failureCode,
		); laneErr != nil {
			log.Printf("whatsmeow recovered lane terminalization failed worker_id=%s key_hash=%s state=%s error_code=%s", w.cfg.WorkerID, hashConnectionFlowIdentifier(claim.Key), state, safeOperationalErrorCode(laneErr))
			w.rescheduleOutboundRecoveryBestEffort(ctx, claim, state, recoveryJSON)
			return
		}
		publishCtx, cancel := context.WithTimeout(ctx, outboundRecoveryAttemptTimeout)
		if recovery.ScheduleAttempt != nil {
			var claimState scheduleMessageAttemptClaimState
			claimState, err = w.withScheduleMessageAttempt(
				publishCtx,
				*recovery.ScheduleAttempt,
				func(attemptCtx context.Context) error {
					return w.publishOutboundRecoveryRecord(attemptCtx, recovery)
				},
			)
			if err == nil && claimState != scheduleMessageAttemptAcquired {
				switch claimState {
				case scheduleMessageAttemptStale, scheduleMessageAttemptCompleted:
					cancel()
					w.discardClaimedOutboundRecovery(ctx, claim, state, recoveryJSON)
					log.Printf("whatsmeow obsolete schedule recovery discarded worker_id=%s key_hash=%s claim_state=%s", w.cfg.WorkerID, hashConnectionFlowIdentifier(claim.Key), claimState)
					return
				default:
					cancel()
					w.rescheduleOutboundRecoveryBestEffort(ctx, claim, state, recoveryJSON)
					return
				}
			}
		} else {
			err = w.publishOutboundRecoveryRecord(publishCtx, recovery)
		}
		cancel()
		if err != nil {
			if errors.Is(err, errOutboundRecoveryObsolete) {
				w.discardClaimedOutboundRecovery(ctx, claim, state, recoveryJSON)
				log.Printf("whatsmeow invalid outbound recovery discarded worker_id=%s key_hash=%s error_code=%s", w.cfg.WorkerID, hashConnectionFlowIdentifier(claim.Key), safeOperationalErrorCode(err))
				return
			}
			// Assignment/runtime revocation is expected during a reconnect or
			// rebalance. Keep the terminal result durable and let the current
			// runtime rebind it on a later pass.
			log.Printf("whatsmeow outbound recovery publish deferred worker_id=%s key_hash=%s error_code=%s", w.cfg.WorkerID, hashConnectionFlowIdentifier(claim.Key), safeOperationalErrorCode(err))
			w.rescheduleOutboundRecoveryBestEffort(ctx, claim, state, recoveryJSON)
			return
		}
		acknowledged, err := w.acknowledgeOutboundRecovery(
			ctx,
			claim,
			state,
			recoveryJSON,
		)
		if err != nil {
			log.Printf("whatsmeow outbound recovery acknowledge failed worker_id=%s key_hash=%s error_code=%s", w.cfg.WorkerID, hashConnectionFlowIdentifier(claim.Key), safeOperationalErrorCode(err))
			return
		}
		if !acknowledged {
			log.Printf("whatsmeow outbound recovery acknowledgement skipped worker_id=%s key_hash=%s reason=claim_changed_or_reassigned", w.cfg.WorkerID, hashConnectionFlowIdentifier(claim.Key))
			return
		}
		log.Printf("whatsmeow outbound recovery completed worker_id=%s key_hash=%s publications=%d", w.cfg.WorkerID, hashConnectionFlowIdentifier(claim.Key), len(recovery.Publications))
	case "":
		w.discardClaimedOutboundRecovery(ctx, claim, state, recoveryJSON)
	case sendIdempotencyStateReserved, sendIdempotencyStateInvoked:
		// Never turn provider_invoked back into a send. Source redelivery owns
		// the reserved-only fast takeover and durably terminalizes an obsolete
		// provider_invoked claim as ambiguous.
		w.rescheduleOutboundRecoveryBestEffort(ctx, claim, state, recoveryJSON)
	default:
		w.discardClaimedOutboundRecovery(ctx, claim, state, recoveryJSON)
		log.Printf("whatsmeow outbound recovery with invalid state discarded worker_id=%s key_hash=%s state=%s", w.cfg.WorkerID, hashConnectionFlowIdentifier(claim.Key), state)
	}
}

func (w *Worker) processDueOutboundRecoveries(ctx context.Context) error {
	claims, err := w.claimDueOutboundRecoveries(ctx)
	if err != nil {
		return err
	}
	for _, claim := range claims {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		w.processOutboundRecovery(ctx, claim)
	}
	return nil
}

func (w *Worker) processOutboundProviderWatchdog(ctx context.Context) error {
	if w.redis == nil {
		return errors.New("redis is required for outbound provider watchdog")
	}
	redisCtx, cancel := withOutboundRedisOperationDeadline(ctx)
	defer cancel()
	_, err := w.redis.Eval(
		redisCtx,
		reconcileOutboundProviderWatchdogScript,
		[]string{outboundProviderWatchdogQueueKey()},
		outboundProviderWatchdogBatch,
		workerCommandAmbiguousTTL.Milliseconds(),
	).Int()
	if err != nil {
		return fmt.Errorf("reconcile outbound provider watchdog: %w", err)
	}
	return nil
}

func (w *Worker) runOutboundRecovery(ctx context.Context) {
	if w.redis == nil || strings.TrimSpace(w.cfg.WorkerID) == "" {
		return
	}
	ticker := time.NewTicker(outboundRecoveryPollInterval)
	defer ticker.Stop()
	for {
		if err := w.processOutboundProviderWatchdog(ctx); err != nil && ctx.Err() == nil {
			log.Printf("whatsmeow outbound provider watchdog poll failed worker_id=%s error_code=%s", w.cfg.WorkerID, safeOperationalErrorCode(err))
		}
		if err := w.processDueOutboundRecoveries(ctx); err != nil && ctx.Err() == nil {
			log.Printf("whatsmeow outbound recovery poll failed worker_id=%s error_code=%s", w.cfg.WorkerID, safeOperationalErrorCode(err))
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// persistOutboundProviderOutcome gives the known SDK outcome an independent
// owner-CAS budget. Kafka assignment cancellation must not turn an ACK or a
// definitive provider error back into a live provider_invoked record.
func persistOutboundProviderOutcome(
	ctx context.Context,
	action func(context.Context) error,
) error {
	if ctx == nil {
		ctx = context.Background()
	}
	persistenceCtx, cancel := context.WithTimeout(
		context.WithoutCancel(ctx),
		outboundRecoveryAttemptTimeout,
	)
	defer cancel()
	return retryOutboundPostProviderSideEffect(persistenceCtx, action)
}

// retryOutboundPostProviderSideEffect retries only durable ledger/publication
// work. Callers must never include the provider send itself in action.
func retryOutboundPostProviderSideEffect(ctx context.Context, action func(context.Context) error) error {
	return retryOutboundPostProviderSideEffectWithPolicy(
		ctx,
		outboundPostProviderMaxAttempts,
		outboundPostProviderBaseDelay,
		outboundPostProviderMaxDelay,
		action,
	)
}

func retryOutboundPostProviderSideEffectWithPolicy(
	ctx context.Context,
	maxAttempts int,
	baseDelay time.Duration,
	maxDelay time.Duration,
	action func(context.Context) error,
) error {
	if action == nil {
		return errors.New("outbound post-provider action is required")
	}
	if maxAttempts <= 0 {
		return errors.New("outbound post-provider max attempts must be positive")
	}
	if baseDelay < 0 {
		baseDelay = 0
	}
	if maxDelay < baseDelay {
		maxDelay = baseDelay
	}

	delay := baseDelay
	var lastErr error
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := action(ctx); err == nil {
			return nil
		} else if errors.Is(err, errWhatsAppRuntimeFenceRevoked) ||
			errors.Is(err, errKafkaConsumerDispatchRevoked) ||
			errors.Is(err, errOutboundRecoveryObsolete) {
			return err
		} else {
			lastErr = err
		}
		if attempt == maxAttempts {
			break
		}

		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
		}
		if delay < maxDelay {
			delay *= 2
			if delay > maxDelay {
				delay = maxDelay
			}
		}
	}
	return fmt.Errorf("outbound post-provider side effect failed after %d attempts: %w", maxAttempts, lastErr)
}
