package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
)

const (
	scheduleMessageAttemptKeyPrefix   = "{schedule-status}:message-attempt:v3"
	scheduleReconciliationDeadlineKey = "{schedule-status}:reconciliation:v2:deadlines"
	scheduleReconciliationVersionKey  = "{schedule-status}:reconciliation:v2:versions"
	scheduleMessageAttemptTTL         = workerCommandScheduleOperationalTTL
	scheduleMessageAttemptLeaseTTL    = 5 * time.Minute
	scheduleMessageAttemptHeartbeat   = 30 * time.Second
	scheduleMessageAttemptGrace       = time.Minute
)

const claimScheduleMessageAttemptScript = `
local time = redis.call('TIME')
local now = (tonumber(time[1]) * 1000) + math.floor(tonumber(time[2]) / 1000)
local key = KEYS[1]
local attempt_id = ARGV[1]
local owner = ARGV[2]
local lease_ms = tonumber(ARGV[3])
local ttl_seconds = tonumber(ARGV[4])
local account_id = ARGV[5]
local worker_id = ARGV[6]
local message_id = ARGV[7]

if redis.call('EXISTS', key) == 1 then
  local current_attempt = redis.call('HGET', key, 'attempt_id') or ''
  if current_attempt ~= '' and current_attempt ~= attempt_id then
    return 'stale'
  end
  local current_account = redis.call('HGET', key, 'account_id') or ''
  local current_worker = redis.call('HGET', key, 'worker_id') or ''
  local current_message = redis.call('HGET', key, 'message_id') or ''
  if current_account ~= '' and current_account ~= account_id then
    return 'stale'
  end
  if current_worker ~= '' and current_worker ~= worker_id then
    return 'stale'
  end
  if current_message ~= '' and current_message ~= message_id then
    return 'stale'
  end

  local state = redis.call('HGET', key, 'state') or ''
  if state == 'completed' then
    return 'completed'
  end

  local lease_until = tonumber(redis.call('HGET', key, 'lease_until_ms') or '0')
  if lease_until > now and (
    state == 'in_flight' or
    state == 'grace' or
    state == 'reconciling'
  ) then
    return 'busy'
  end
end

redis.call('HSET', key,
  'state', 'in_flight',
  'attempt_id', attempt_id,
  'account_id', account_id,
  'worker_id', worker_id,
  'message_id', message_id,
  'owner', owner,
  'lease_until_ms', tostring(now + lease_ms),
  'updated_at_ms', tostring(now))
if redis.call('HEXISTS', key, 'operational_state') == 0 then
  redis.call('HSET', key,
    'operational_state', 'pending',
    'operational_updated_at_ms', tostring(now))
end
redis.call('EXPIRE', key, ttl_seconds)
return 'acquired'
`

const assertScheduleMessageAttemptScript = `
local time = redis.call('TIME')
local now = (tonumber(time[1]) * 1000) + math.floor(tonumber(time[2]) / 1000)
if redis.call('HGET', KEYS[1], 'state') ~= 'in_flight' or
   redis.call('HGET', KEYS[1], 'attempt_id') ~= ARGV[1] or
   redis.call('HGET', KEYS[1], 'owner') ~= ARGV[2] then
  return 0
end
redis.call('HSET', KEYS[1],
  'lease_until_ms', tostring(now + tonumber(ARGV[3])),
  'updated_at_ms', tostring(now))
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[4]))
return 1
`

const releaseScheduleMessageAttemptScript = `
local time = redis.call('TIME')
local now = (tonumber(time[1]) * 1000) + math.floor(tonumber(time[2]) / 1000)
if redis.call('HGET', KEYS[1], 'state') ~= 'in_flight' or
   redis.call('HGET', KEYS[1], 'attempt_id') ~= ARGV[1] or
   redis.call('HGET', KEYS[1], 'owner') ~= ARGV[2] then
  return 0
end
redis.call('HSET', KEYS[1],
  'state', 'grace',
  'owner', '',
  'lease_until_ms', tostring(now + tonumber(ARGV[3])),
  'updated_at_ms', tostring(now))
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[4]))
return 1
`

const completeScheduleMessageAttemptScript = `
local time = redis.call('TIME')
local now = (tonumber(time[1]) * 1000) + math.floor(tonumber(time[2]) / 1000)
if redis.call('HGET', KEYS[1], 'state') ~= 'in_flight' or
   redis.call('HGET', KEYS[1], 'attempt_id') ~= ARGV[1] or
   redis.call('HGET', KEYS[1], 'owner') ~= ARGV[2] then
  return 0
end
redis.call('HSET', KEYS[1],
  'state', 'completed',
  'owner', '',
  'lease_until_ms', '0',
  'updated_at_ms', tostring(now))
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[3]))
return 1
`

// A schedule attempt lease is deliberately longer than a Kafka generation so
// an ordinary duplicate cannot overlap the original provider call. The durable
// outbound ledger, however, can prove that a previous assignment/runtime
// crossed the provider boundary and can therefore never call WhatsApp again.
// In that case a replacement may take over only the publication lease. This
// script validates the exact recovery body and both fences atomically, moves a
// stranded provider_invoked ledger to terminal ambiguity, and transfers the
// schedule lease without waiting for its five-minute expiry.
const takeoverScheduleMessageAttemptRecoveryScript = `
local time = redis.call('TIME')
local now = (tonumber(time[1]) * 1000) + math.floor(tonumber(time[2]) / 1000)
local attempt_key = KEYS[1]
local ledger_key = KEYS[2]
local attempt_id = ARGV[1]
local account_id = ARGV[2]
local worker_id = ARGV[3]
local message_id = ARGV[4]
local schedule_id = ARGV[5]
local expected_recovery = ARGV[6]
local owner = ARGV[7]
local lease_ms = tonumber(ARGV[8])
local ttl_seconds = tonumber(ARGV[9])
local current_assignment = tonumber(ARGV[10]) or 0
local current_generation = tonumber(ARGV[11]) or 0
local current_epoch = ARGV[12]

if redis.call('EXISTS', attempt_key) == 0 or
   redis.call('EXISTS', ledger_key) == 0 then
  return {'missing', ''}
end
if (redis.call('HGET', attempt_key, 'attempt_id') or '') ~= attempt_id or
   (redis.call('HGET', attempt_key, 'account_id') or '') ~= account_id or
   (redis.call('HGET', attempt_key, 'worker_id') or '') ~= worker_id or
   (redis.call('HGET', attempt_key, 'message_id') or '') ~= message_id then
  return {'stale', ''}
end

local attempt_state = redis.call('HGET', attempt_key, 'state') or ''
if attempt_state == 'completed' then
  return {'completed', ''}
end
if attempt_state ~= 'in_flight' and
   attempt_state ~= 'grace' and
   attempt_state ~= 'reconciling' then
  return {'unavailable', ''}
end

local ledger_state = redis.call('HGET', ledger_key, 'state') or ''
local recovery_json = redis.call('HGET', ledger_key, 'recovery_json') or ''
if recovery_json == '' or recovery_json ~= expected_recovery then
  return {'changed', ledger_state}
end
if ledger_state ~= 'provider_invoked' and ledger_state ~= 'ambiguous' then
  return {'unavailable', ledger_state}
end

local decoded, recovery = pcall(cjson.decode, recovery_json)
if not decoded or type(recovery) ~= 'table' or
   type(recovery.schedule_attempt) ~= 'table' then
  return {'invalid', ledger_state}
end
local schedule_attempt = recovery.schedule_attempt
if tostring(schedule_attempt.schedule_id or '') ~= schedule_id or
   tostring(schedule_attempt.attempt_id or '') ~= attempt_id or
   tostring(schedule_attempt.account_id or '') ~= account_id or
   tostring(schedule_attempt.worker_id or '') ~= worker_id or
   tostring(schedule_attempt.message_id or '') ~= message_id then
  return {'invalid', ledger_state}
end

local recovery_assignment = tonumber(recovery.consumer_assignment_epoch) or 0
local recovery_generation = tonumber(recovery.origin_runtime_generation) or 0
local recovery_epoch = tostring(recovery.origin_connection_epoch or '')
local obsolete = false
if recovery_assignment > 0 and current_assignment > 0 and
   recovery_assignment ~= current_assignment then
  obsolete = true
end
if recovery_generation > 0 and current_generation > 0 and
   recovery_epoch ~= '' and current_epoch ~= '' and
   (recovery_generation ~= current_generation or recovery_epoch ~= current_epoch) then
  obsolete = true
end
if not obsolete then
  return {'current', ledger_state}
end

if ledger_state == 'provider_invoked' then
  ledger_state = 'ambiguous'
  redis.call('HSET', ledger_key,
    'state', ledger_state,
    'lease_until_ms', '0',
    'error', 'provider_invoked_schedule_fence_replaced',
    'terminal_at_ms', tostring(now),
    'expires_at_ms', tostring(now + (ttl_seconds * 1000)),
    'updated_at_ms', tostring(now))
  redis.call('EXPIRE', ledger_key, ttl_seconds)
end

redis.call('HSET', attempt_key,
  'state', 'in_flight',
  'owner', owner,
  'lease_until_ms', tostring(now + lease_ms),
  'consumer_assignment_epoch', tostring(current_assignment),
  'runtime_generation', tostring(current_generation),
  'connection_epoch', current_epoch,
  'updated_at_ms', tostring(now))
redis.call('EXPIRE', attempt_key, ttl_seconds)
redis.call('ZADD', KEYS[3], 'NX', now, ledger_key)
redis.call('EXPIRE', KEYS[3], ttl_seconds)
return {'acquired', ledger_state}
`

const scheduleMessageAttemptReconciliationScript = `
local time = redis.call('TIME')
local now = (tonumber(time[1]) * 1000) + math.floor(tonumber(time[2]) / 1000)
local incoming = now + tonumber(ARGV[2])
local current = redis.call('ZSCORE', KEYS[1], ARGV[1])
redis.call('HINCRBY', KEYS[2], ARGV[1], 1)
if not current or tonumber(current) > incoming then
  redis.call('ZADD', KEYS[1], incoming, ARGV[1])
end
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[3]))
redis.call('EXPIRE', KEYS[2], tonumber(ARGV[3]))
return tostring(incoming)
`

const setScheduleMessageOperationalStateScript = `
local function schedule_reconciliation()
  local time = redis.call('TIME')
  local now = (tonumber(time[1]) * 1000) + math.floor(tonumber(time[2]) / 1000)
  local current_deadline = redis.call('ZSCORE', KEYS[2], ARGV[7])
  redis.call('HINCRBY', KEYS[3], ARGV[7], 1)
  if not current_deadline or tonumber(current_deadline) > now then
    redis.call('ZADD', KEYS[2], now, ARGV[7])
  end
  redis.call('EXPIRE', KEYS[2], tonumber(ARGV[8]))
  redis.call('EXPIRE', KEYS[3], tonumber(ARGV[8]))
  return now
end

local current_attempt = redis.call('HGET', KEYS[1], 'attempt_id') or ''
local current_account = redis.call('HGET', KEYS[1], 'account_id') or ''
local current_worker = redis.call('HGET', KEYS[1], 'worker_id') or ''
local current_message = redis.call('HGET', KEYS[1], 'message_id') or ''

if current_attempt ~= '' and current_attempt ~= ARGV[1] then
  return 'stale'
end
if current_account ~= '' and current_account ~= ARGV[2] then
  return 'stale'
end
if current_worker ~= '' and current_worker ~= ARGV[3] then
  return 'stale'
end
if current_message ~= '' and current_message ~= ARGV[4] then
  return 'stale'
end

local current = redis.call('HGET', KEYS[1], 'operational_state') or 'pending'
local target = ARGV[5]
if current == target then
  redis.call('EXPIRE', KEYS[1], ARGV[6])
  schedule_reconciliation()
  return 'unchanged'
end

local allowed = false
if current == 'pending' then
  allowed = target == 'pre_provider_failed'
    or target == 'ambiguous'
    or target == 'succeeded'
elseif current == 'pre_provider_failed' then
  allowed = target == 'ambiguous' or target == 'succeeded'
elseif current == 'ambiguous' then
  allowed = target == 'succeeded'
end

if not allowed then
  return 'invalid'
end

local now = schedule_reconciliation()
redis.call('HSET', KEYS[1],
  'attempt_id', ARGV[1],
  'account_id', ARGV[2],
  'worker_id', ARGV[3],
  'message_id', ARGV[4],
  'operational_state', target,
  'operational_updated_at_ms', tostring(now)
)
redis.call('EXPIRE', KEYS[1], ARGV[6])
return 'transitioned'
`

type scheduleMessageAttemptReference struct {
	ScheduleID string `json:"schedule_id"`
	AccountID  string `json:"account_id,omitempty"`
	WorkerID   string `json:"worker_id,omitempty"`
	MessageID  string `json:"message_id"`
	AttemptID  string `json:"attempt_id"`
}

type scheduleMessageOperationalState string

const (
	scheduleMessageOperationalPreProviderFailed scheduleMessageOperationalState = "pre_provider_failed"
	scheduleMessageOperationalAmbiguous         scheduleMessageOperationalState = "ambiguous"
	scheduleMessageOperationalSucceeded         scheduleMessageOperationalState = "succeeded"
)

type scheduleMessageAttemptClaimState string

const (
	scheduleMessageAttemptAcquired  scheduleMessageAttemptClaimState = "acquired"
	scheduleMessageAttemptStale     scheduleMessageAttemptClaimState = "stale"
	scheduleMessageAttemptBusy      scheduleMessageAttemptClaimState = "busy"
	scheduleMessageAttemptCompleted scheduleMessageAttemptClaimState = "completed"
)

type scheduleMessageAttemptLease struct {
	scheduleMessageAttemptReference
	Key   string
	Owner string
}

type scheduleMessageAttemptClaim struct {
	State scheduleMessageAttemptClaimState
	Lease scheduleMessageAttemptLease
}

type scheduleMessageAttemptRecoveryTakeover struct {
	Acquired bool
	Lease    scheduleMessageAttemptLease
	Claim    outboundSendClaim
	Recovery outboundRecoveryRecord
}

type scheduleMessageAttemptContextKey struct{}

var errScheduleMessageAttemptLeaseLost = errors.New("schedule message attempt lease lost")

func scheduleMessageAttemptID(data ScheduleMessage) string {
	attemptID := strings.TrimSpace(data.AttemptID)
	if attemptID != "" {
		return attemptID
	}
	return "legacy:" + strings.TrimSpace(data.Message.MessageID)
}

func scheduleMessageOutboundOperationID(data ScheduleMessage) string {
	if operationID := strings.TrimSpace(data.OperationID); operationID != "" {
		return operationID
	}
	return strings.TrimSpace(data.Message.MessageID)
}

func scheduleMessageAttemptReferenceFor(data ScheduleMessage) scheduleMessageAttemptReference {
	return scheduleMessageAttemptReference{
		ScheduleID: strings.TrimSpace(data.ScheduleID),
		AccountID:  strings.TrimSpace(firstNonEmpty(stringValue(data.Message.Account["id"]), data.AccountID)),
		WorkerID:   strings.TrimSpace(stringValue(data.Message.Worker["id"])),
		MessageID:  strings.TrimSpace(data.Message.MessageID),
		AttemptID:  strings.TrimSpace(scheduleMessageAttemptID(data)),
	}
}

func ptrScheduleMessageAttemptReference(
	reference scheduleMessageAttemptReference,
) *scheduleMessageAttemptReference {
	return &reference
}

func scheduleMessageAttemptKey(reference scheduleMessageAttemptReference) (string, error) {
	scheduleID := strings.TrimSpace(reference.ScheduleID)
	messageID := strings.TrimSpace(reference.MessageID)
	attemptID := strings.TrimSpace(reference.AttemptID)
	if scheduleID == "" || messageID == "" || attemptID == "" {
		return "", errors.New("schedule_id, message_id and attempt_id are required")
	}
	return scheduleMessageAttemptKeyPrefix + ":" + scheduleID + ":" + messageID, nil
}

func (w *Worker) claimScheduleMessageAttempt(
	ctx context.Context,
	reference scheduleMessageAttemptReference,
) (scheduleMessageAttemptClaim, error) {
	if w.redis == nil {
		return scheduleMessageAttemptClaim{}, errors.New("redis is required for schedule message attempt coordination")
	}
	key, err := scheduleMessageAttemptKey(reference)
	if err != nil {
		return scheduleMessageAttemptClaim{}, err
	}
	reference.ScheduleID = strings.TrimSpace(reference.ScheduleID)
	reference.AccountID = strings.TrimSpace(reference.AccountID)
	reference.WorkerID = strings.TrimSpace(reference.WorkerID)
	reference.MessageID = strings.TrimSpace(reference.MessageID)
	reference.AttemptID = strings.TrimSpace(reference.AttemptID)
	reference.AccountID = firstNonEmpty(reference.AccountID, w.cfg.AccountID)
	reference.WorkerID = firstNonEmpty(reference.WorkerID, w.cfg.WorkerID)
	if reference.AccountID == "" || reference.WorkerID == "" {
		return scheduleMessageAttemptClaim{}, errors.New("account_id and worker_id are required for schedule message attempt coordination")
	}
	owner := uuid.NewString()
	value, err := w.redis.Eval(
		ctx,
		claimScheduleMessageAttemptScript,
		[]string{key},
		reference.AttemptID,
		owner,
		strconv.FormatInt(scheduleMessageAttemptLeaseTTL.Milliseconds(), 10),
		strconv.FormatInt(int64(scheduleMessageAttemptTTL/time.Second), 10),
		reference.AccountID,
		reference.WorkerID,
		reference.MessageID,
	).Text()
	if err != nil {
		return scheduleMessageAttemptClaim{}, fmt.Errorf("claim schedule message attempt: %w", err)
	}
	state := scheduleMessageAttemptClaimState(value)
	switch state {
	case scheduleMessageAttemptAcquired, scheduleMessageAttemptStale, scheduleMessageAttemptBusy, scheduleMessageAttemptCompleted:
	default:
		return scheduleMessageAttemptClaim{}, fmt.Errorf("invalid schedule message attempt claim state %q", value)
	}
	return scheduleMessageAttemptClaim{
		State: state,
		Lease: scheduleMessageAttemptLease{
			scheduleMessageAttemptReference: reference,
			Key:                             key,
			Owner:                           owner,
		},
	}, nil
}

func (w *Worker) takeoverScheduleMessageAttemptRecovery(
	ctx context.Context,
	reference scheduleMessageAttemptReference,
	operation outboundSendOperation,
	currentAssignment uint64,
	currentScope whatsAppRuntimeFence,
) (scheduleMessageAttemptRecoveryTakeover, error) {
	if w.redis == nil {
		return scheduleMessageAttemptRecoveryTakeover{}, errors.New(
			"redis is required for schedule recovery takeover",
		)
	}
	reference.ScheduleID = strings.TrimSpace(reference.ScheduleID)
	reference.AccountID = strings.TrimSpace(firstNonEmpty(reference.AccountID, w.cfg.AccountID))
	reference.WorkerID = strings.TrimSpace(firstNonEmpty(reference.WorkerID, w.cfg.WorkerID))
	reference.MessageID = strings.TrimSpace(reference.MessageID)
	reference.AttemptID = strings.TrimSpace(reference.AttemptID)
	if reference.AccountID == "" ||
		reference.WorkerID == "" ||
		currentAssignment == 0 ||
		!currentScope.isValid() ||
		currentScope.WorkerID != reference.WorkerID {
		return scheduleMessageAttemptRecoveryTakeover{}, errors.New(
			"current assignment and runtime fence are required for schedule recovery takeover",
		)
	}

	attemptKey, err := scheduleMessageAttemptKey(reference)
	if err != nil {
		return scheduleMessageAttemptRecoveryTakeover{}, err
	}
	operation.AccountID = strings.TrimSpace(operation.AccountID)
	operation.Type = strings.TrimSpace(operation.Type)
	operation.ID = strings.TrimSpace(operation.ID)
	ledgerKey, err := outboundSendIdempotencyKey(operation)
	if err != nil {
		return scheduleMessageAttemptRecoveryTakeover{}, err
	}

	values, err := w.redis.HMGet(ctx, ledgerKey, "state", "recovery_json").Result()
	if err != nil {
		return scheduleMessageAttemptRecoveryTakeover{}, fmt.Errorf(
			"read schedule outbound recovery ledger: %w",
			err,
		)
	}
	if len(values) < 2 || values[1] == nil {
		return scheduleMessageAttemptRecoveryTakeover{}, nil
	}
	state := ""
	if values[0] != nil {
		state = fmt.Sprint(values[0])
	}
	if state != sendIdempotencyStateInvoked &&
		state != sendIdempotencyStateAmbiguous {
		return scheduleMessageAttemptRecoveryTakeover{}, nil
	}
	recoveryJSON := fmt.Sprint(values[1])
	if strings.TrimSpace(recoveryJSON) == "" {
		return scheduleMessageAttemptRecoveryTakeover{}, nil
	}
	var recovery outboundRecoveryRecord
	if err := json.Unmarshal([]byte(recoveryJSON), &recovery); err != nil {
		return scheduleMessageAttemptRecoveryTakeover{}, fmt.Errorf(
			"decode schedule outbound recovery ledger: %w",
			err,
		)
	}
	if err := validateOutboundRecoveryRecord(recovery); err != nil {
		return scheduleMessageAttemptRecoveryTakeover{}, err
	}
	if recovery.ScheduleAttempt == nil ||
		*recovery.ScheduleAttempt != reference {
		return scheduleMessageAttemptRecoveryTakeover{}, fmt.Errorf(
			"%w: schedule recovery reference does not match the busy attempt",
			errOutboundRecoveryObsolete,
		)
	}
	assignmentReplaced := recovery.ConsumerAssignmentEpoch != currentAssignment
	runtimeReplaced := recovery.OriginRuntimeGeneration != currentScope.RuntimeGeneration ||
		recovery.OriginConnectionEpoch != currentScope.ConnectionEpoch
	if !assignmentReplaced && !runtimeReplaced {
		return scheduleMessageAttemptRecoveryTakeover{}, nil
	}

	owner := uuid.NewString()
	result, err := w.redis.Eval(
		ctx,
		takeoverScheduleMessageAttemptRecoveryScript,
		[]string{
			attemptKey,
			ledgerKey,
			outboundRecoveryQueueKey(reference.WorkerID),
		},
		reference.AttemptID,
		reference.AccountID,
		reference.WorkerID,
		reference.MessageID,
		reference.ScheduleID,
		recoveryJSON,
		owner,
		strconv.FormatInt(scheduleMessageAttemptLeaseTTL.Milliseconds(), 10),
		strconv.FormatInt(int64(scheduleMessageAttemptTTL/time.Second), 10),
		strconv.FormatUint(currentAssignment, 10),
		strconv.Itoa(currentScope.RuntimeGeneration),
		currentScope.ConnectionEpoch,
	).Result()
	if err != nil {
		return scheduleMessageAttemptRecoveryTakeover{}, fmt.Errorf(
			"take over schedule outbound recovery: %w",
			err,
		)
	}
	luaValues, err := outboundLuaValues(result, 2)
	if err != nil {
		return scheduleMessageAttemptRecoveryTakeover{}, err
	}
	switch luaValues[0] {
	case "acquired":
		if luaValues[1] != sendIdempotencyStateAmbiguous {
			return scheduleMessageAttemptRecoveryTakeover{}, fmt.Errorf(
				"schedule recovery takeover returned nonterminal ledger state %q",
				luaValues[1],
			)
		}
		return scheduleMessageAttemptRecoveryTakeover{
			Acquired: true,
			Lease: scheduleMessageAttemptLease{
				scheduleMessageAttemptReference: reference,
				Key:                             attemptKey,
				Owner:                           owner,
			},
			Claim: outboundSendClaim{
				Operation: operation,
				Key:       ledgerKey,
				State:     sendIdempotencyStateAmbiguous,
				Recovery:  &recovery,
			},
			Recovery: recovery,
		}, nil
	case "missing", "stale", "completed", "unavailable", "changed", "current":
		return scheduleMessageAttemptRecoveryTakeover{}, nil
	case "invalid":
		return scheduleMessageAttemptRecoveryTakeover{}, fmt.Errorf(
			"%w: invalid schedule recovery takeover ledger",
			errOutboundRecoveryObsolete,
		)
	default:
		return scheduleMessageAttemptRecoveryTakeover{}, fmt.Errorf(
			"invalid schedule recovery takeover result %q",
			luaValues[0],
		)
	}
}

func (w *Worker) setScheduleMessageOperationalState(
	ctx context.Context,
	reference scheduleMessageAttemptReference,
	state scheduleMessageOperationalState,
) error {
	if w.redis == nil {
		return errors.New("redis is required for schedule message operational coordination")
	}
	key, err := scheduleMessageAttemptKey(reference)
	if err != nil {
		return err
	}
	reference.AccountID = strings.TrimSpace(firstNonEmpty(reference.AccountID, w.cfg.AccountID))
	reference.WorkerID = strings.TrimSpace(firstNonEmpty(reference.WorkerID, w.cfg.WorkerID))
	reference.ScheduleID = strings.TrimSpace(reference.ScheduleID)
	reference.MessageID = strings.TrimSpace(reference.MessageID)
	reference.AttemptID = strings.TrimSpace(reference.AttemptID)
	if reference.ScheduleID == "" || reference.AccountID == "" || reference.WorkerID == "" {
		return errors.New("schedule_id, account_id and worker_id are required for schedule message operational coordination")
	}
	result, err := w.redis.Eval(
		ctx,
		setScheduleMessageOperationalStateScript,
		[]string{
			key,
			scheduleReconciliationDeadlineKey,
			scheduleReconciliationVersionKey,
		},
		reference.AttemptID,
		reference.AccountID,
		reference.WorkerID,
		reference.MessageID,
		string(state),
		strconv.FormatInt(int64(scheduleMessageAttemptTTL/time.Second), 10),
		reference.ScheduleID,
		strconv.FormatInt(int64(workerCommandScheduleOperationalTTL/time.Second), 10),
	).Text()
	if err != nil {
		return fmt.Errorf("set schedule message operational state: %w", err)
	}
	switch result {
	case "transitioned", "unchanged":
		return nil
	case "stale", "invalid":
		return fmt.Errorf("schedule message operational state %s rejected: %s", state, result)
	default:
		return fmt.Errorf("invalid schedule message operational transition result %q", result)
	}
}

func (w *Worker) assertScheduleMessageAttempt(
	ctx context.Context,
	lease scheduleMessageAttemptLease,
) error {
	if w.redis == nil || lease.Key == "" || lease.Owner == "" {
		return errScheduleMessageAttemptLeaseLost
	}
	owned, err := w.redis.Eval(
		ctx,
		assertScheduleMessageAttemptScript,
		[]string{lease.Key},
		lease.AttemptID,
		lease.Owner,
		strconv.FormatInt(scheduleMessageAttemptLeaseTTL.Milliseconds(), 10),
		strconv.FormatInt(int64(scheduleMessageAttemptTTL/time.Second), 10),
	).Int64()
	if err != nil {
		return fmt.Errorf("assert schedule message attempt lease: %w", err)
	}
	if owned != 1 {
		return errScheduleMessageAttemptLeaseLost
	}
	return nil
}

func (w *Worker) releaseScheduleMessageAttempt(
	ctx context.Context,
	lease scheduleMessageAttemptLease,
) error {
	if w.redis == nil || lease.Key == "" || lease.Owner == "" {
		return errScheduleMessageAttemptLeaseLost
	}
	released, err := w.redis.Eval(
		ctx,
		releaseScheduleMessageAttemptScript,
		[]string{lease.Key},
		lease.AttemptID,
		lease.Owner,
		strconv.FormatInt(scheduleMessageAttemptGrace.Milliseconds(), 10),
		strconv.FormatInt(int64(scheduleMessageAttemptTTL/time.Second), 10),
	).Int64()
	if err != nil {
		return fmt.Errorf("release schedule message attempt lease: %w", err)
	}
	if released != 1 {
		return errScheduleMessageAttemptLeaseLost
	}
	return nil
}

func (w *Worker) completeScheduleMessageAttempt(
	ctx context.Context,
	lease scheduleMessageAttemptLease,
) error {
	if w.redis == nil || lease.Key == "" || lease.Owner == "" {
		return errScheduleMessageAttemptLeaseLost
	}
	completed, err := w.redis.Eval(
		ctx,
		completeScheduleMessageAttemptScript,
		[]string{lease.Key},
		lease.AttemptID,
		lease.Owner,
		strconv.FormatInt(int64(scheduleMessageAttemptTTL/time.Second), 10),
	).Int64()
	if err != nil {
		return fmt.Errorf("complete schedule message attempt lease: %w", err)
	}
	if completed != 1 {
		return errScheduleMessageAttemptLeaseLost
	}
	return nil
}

func withScheduleMessageAttemptLease(
	ctx context.Context,
	lease scheduleMessageAttemptLease,
) context.Context {
	return context.WithValue(ctx, scheduleMessageAttemptContextKey{}, lease)
}

func scheduleMessageAttemptLeaseFromContext(
	ctx context.Context,
) (scheduleMessageAttemptLease, bool) {
	lease, ok := ctx.Value(scheduleMessageAttemptContextKey{}).(scheduleMessageAttemptLease)
	return lease, ok
}

func (w *Worker) assertScheduleMessageAttemptFromContext(ctx context.Context) error {
	lease, ok := scheduleMessageAttemptLeaseFromContext(ctx)
	if !ok {
		return nil
	}
	return w.assertScheduleMessageAttempt(ctx, lease)
}

func (w *Worker) startScheduleMessageAttemptHeartbeat(
	ctx context.Context,
	lease scheduleMessageAttemptLease,
) (stop func(), leaseLost *atomic.Bool) {
	heartbeatCtx, cancel := context.WithCancel(ctx)
	lost := &atomic.Bool{}
	go func() {
		ticker := time.NewTicker(scheduleMessageAttemptHeartbeat)
		defer ticker.Stop()
		for {
			select {
			case <-heartbeatCtx.Done():
				return
			case <-ticker.C:
				if err := w.assertScheduleMessageAttempt(heartbeatCtx, lease); err != nil {
					lost.Store(true)
					return
				}
			}
		}
	}()
	return cancel, lost
}

func (w *Worker) scheduleMessageAttemptReconciliation(
	ctx context.Context,
	scheduleID string,
	delay time.Duration,
) error {
	if w.redis == nil {
		return errors.New("redis is required for schedule reconciliation")
	}
	scheduleID = strings.TrimSpace(scheduleID)
	if scheduleID == "" {
		return errors.New("schedule_id is required for schedule reconciliation")
	}
	if delay < 0 {
		delay = 0
	}
	if _, err := w.redis.Eval(
		ctx,
		scheduleMessageAttemptReconciliationScript,
		[]string{scheduleReconciliationDeadlineKey, scheduleReconciliationVersionKey},
		scheduleID,
		strconv.FormatInt(delay.Milliseconds(), 10),
		strconv.FormatInt(int64(workerCommandScheduleOperationalTTL/time.Second), 10),
	).Result(); err != nil {
		return fmt.Errorf("schedule message attempt reconciliation: %w", err)
	}
	return nil
}

func (w *Worker) withScheduleMessageAttempt(
	ctx context.Context,
	reference scheduleMessageAttemptReference,
	callback func(context.Context) error,
) (scheduleMessageAttemptClaimState, error) {
	if callback == nil {
		return "", errors.New("schedule message attempt callback is required")
	}
	claim, err := w.claimScheduleMessageAttempt(ctx, reference)
	if err != nil {
		return "", err
	}
	if claim.State != scheduleMessageAttemptAcquired {
		return claim.State, nil
	}

	lease := claim.Lease
	leaseCtx := withScheduleMessageAttemptLease(ctx, lease)
	stopHeartbeat, leaseLost := w.startScheduleMessageAttemptHeartbeat(leaseCtx, lease)
	attemptCompleted := false
	defer func() {
		stopHeartbeat()
		if attemptCompleted {
			return
		}
		w.releaseScheduleMessageAttemptBestEffort(ctx, lease)
		reconciliationCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		if err := w.scheduleMessageAttemptReconciliation(
			reconciliationCtx,
			lease.ScheduleID,
			scheduleMessageAttemptGrace,
		); err != nil {
			logScheduleMessageAttemptError("schedule reconciliation", lease, err)
		}
	}()

	if err := w.assertScheduleMessageAttempt(leaseCtx, lease); err != nil {
		return claim.State, err
	}
	callbackErr := callback(leaseCtx)
	if leaseLost.Load() {
		return claim.State, errors.Join(
			nonTerminalKafkaHandlerCause(callbackErr),
			errScheduleMessageAttemptLeaseLost,
		)
	}
	if assertErr := w.assertScheduleMessageAttempt(leaseCtx, lease); assertErr != nil {
		return claim.State, errors.Join(
			nonTerminalKafkaHandlerCause(callbackErr),
			assertErr,
		)
	}
	if shouldCommitTerminalKafkaHandlerError(callbackErr) {
		if completeErr := w.completeScheduleMessageAttempt(leaseCtx, lease); completeErr != nil {
			return claim.State, errors.Join(
				nonTerminalKafkaHandlerCause(callbackErr),
				completeErr,
			)
		}
		attemptCompleted = true
	}
	return claim.State, callbackErr
}

func (w *Worker) withTakenOverScheduleMessageAttempt(
	ctx context.Context,
	lease scheduleMessageAttemptLease,
	callback func(context.Context) error,
) (err error) {
	if callback == nil {
		return errors.New("schedule recovery takeover callback is required")
	}
	leaseCtx := withScheduleMessageAttemptLease(ctx, lease)
	stopHeartbeat, leaseLost := w.startScheduleMessageAttemptHeartbeat(leaseCtx, lease)
	completed := false
	defer func() {
		stopHeartbeat()
		if completed {
			return
		}
		w.releaseScheduleMessageAttemptBestEffort(ctx, lease)
		reconciliationCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		if reconciliationErr := w.scheduleMessageAttemptReconciliation(
			reconciliationCtx,
			lease.ScheduleID,
			0,
		); reconciliationErr != nil {
			logScheduleMessageAttemptError(
				"takeover reconciliation",
				lease,
				reconciliationErr,
			)
		}
	}()

	if err := w.assertScheduleMessageAttempt(leaseCtx, lease); err != nil {
		return err
	}
	if err := callback(leaseCtx); err != nil {
		return err
	}
	if leaseLost.Load() {
		return errScheduleMessageAttemptLeaseLost
	}
	if err := w.assertScheduleMessageAttempt(leaseCtx, lease); err != nil {
		return err
	}
	if err := w.completeScheduleMessageAttempt(leaseCtx, lease); err != nil {
		return err
	}
	completed = true
	return nil
}

func nonTerminalKafkaHandlerCause(err error) error {
	var terminalErr *kafkaTerminalHandlerError
	if errors.As(err, &terminalErr) {
		return terminalErr.cause
	}
	return err
}

func (w *Worker) releaseScheduleMessageAttemptBestEffort(
	ctx context.Context,
	lease scheduleMessageAttemptLease,
) {
	releaseCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	if err := w.releaseScheduleMessageAttempt(releaseCtx, lease); err != nil &&
		!errors.Is(err, errScheduleMessageAttemptLeaseLost) {
		logScheduleMessageAttemptError("release", lease, err)
	}
}

func logScheduleMessageAttemptError(
	action string,
	lease scheduleMessageAttemptLease,
	err error,
) {
	log.Printf(
		"whatsmeow schedule attempt %s failed schedule_id=%s message_id=%s attempt_id=%s error=%v",
		action,
		lease.ScheduleID,
		lease.MessageID,
		lease.AttemptID,
		err,
	)
}
