import { createHash, randomUUID } from 'node:crypto';
import { inject, injectable } from 'tsyringe';
import Redis from 'ioredis';
import { runCriticalRedisOperation } from '@core/common/functions/criticalRedisOperation';
import {
  currentWorkerCommandExecutionIdentity,
  recordWorkerCommandExecutionOutcome,
} from '@core/common/functions/workerCommandExecutionOutcome';
import {
  buildMessageSendRecoveryPlan,
  parseMessageSendRecoveryPlan,
  type MessageSendRecoveryPlanV1,
} from '@core/common/functions/messageSendRecoveryPlan';
import { WorkerCommandLaneService } from '@core/services/workerCommandLane.service';

export type MessageSendOperationType =
  'direct' | 'schedule' | 'notification' | 'notification_email';
export type MessageSendIdempotencyState =
  | 'reserved'
  | 'provider_invoked'
  | 'succeeded'
  | 'failed'
  | 'expired'
  | 'ambiguous';
export type MessageSendTerminalState = Extract<
  MessageSendIdempotencyState,
  'succeeded' | 'failed' | 'expired' | 'ambiguous'
>;
export type MessageSendClaimStatus = 'acquired' | 'duplicate' | 'error';
export type MessageSendClaimErrorReason =
  'identity_conflict' | 'invalid_input' | 'invalid_reply' | 'redis_unavailable';
export type MessageSendLookupStatus = 'claimed' | 'not_found' | 'error';
export type MessageSendTransitionStatus =
  'transitioned' | 'invalid_state' | 'owner_mismatch' | 'not_found' | 'error';
export type MessageSendLegacyAmbiguousRecoveryStatus =
  | 'transitioned'
  | 'identity_conflict'
  | 'invalid_state'
  | 'not_found'
  | 'error';

/**
 * This policy is deliberately hardcoded and mirrored by worker_whatsmeow.
 * Changing it is a wire/storage contract change and requires the Node<->Go
 * golden tests to be updated in the same release.
 */
export const MESSAGE_SEND_LEDGER_V4_POLICY = Object.freeze({
  schemaVersion: 4,
  reservedTtlSeconds: 30 * 60,
  providerInvokedTtlSeconds: 60 * 60,
  succeededTtlSeconds: 12 * 60 * 60,
  failedTtlSeconds: 2 * 60 * 60,
  expiredTtlSeconds: 2 * 60 * 60,
  ambiguousTtlSeconds: 24 * 60 * 60,
  recoveryTtlSeconds: 24 * 60 * 60,
  providerInvocationWatchdogMaxAgeMs: 5 * 60 * 1000,
  providerInvocationWatchdogPollIntervalMs: 1000,
  providerInvocationWatchdogBatchSize: 100,
  providerInvocationWatchdogMaxBatchesPerPoll: 10,
  recoveryClaimLeaseMs: 60 * 1000,
  recoveryRetryDelayMs: 15 * 1000,
  recoveryPollIntervalMs: 1000,
  recoveryBatchSize: 50,
  recoveryMaxConcurrent: 8,
  maxMetaBytes: 16 * 1024,
  maxRecoveryBytes: 256 * 1024,
  maxErrorBytes: 1024,
});

export interface IMessageSendProviderWatchdogBatchResult {
  examined: number;
  terminalized: number;
  cleaned: number;
}

export interface IMessageSendRecoveryClaim {
  ledgerKey: string;
  recoveryRecordKey: string;
  accountId: string;
  workerId: string;
  operationType: MessageSendOperationType;
  operationId: string;
  state: MessageSendTerminalState;
  recovery: unknown;
  plan: MessageSendRecoveryPlanV1;
  owner: string;
  completedStepIds: string[];
}

export interface IMessageSendClaimInput {
  accountId: string;
  operationType: MessageSendOperationType;
  operationId: string;
  meta?: Record<string, unknown>;
  /**
   * Optional pre-provider reservation window. Expiry never authorizes a
   * provider call by itself: a replacement must first atomically acquire a
   * new owner, and the old owner then fails the provider-boundary CAS.
   */
  reservationLeaseMs?: number;
  /**
   * Current worker runtime fence used only for an immediate `reserved`
   * takeover. Without it, recovery waits for an ordinary terminal record.
   */
  runtimeFenceKey?: string;
}

export interface IMessageSendInspectionInput extends Omit<
  IMessageSendClaimInput,
  'runtimeFenceKey' | 'reservationLeaseMs'
> {
  /**
   * Metadata fields that existed in an older ledger schema but are not part
   * of the immutable provider-operation identity anymore.
   */
  compatibleLegacyMetaKeys?: string[];
}

export interface IMessageSendAcquiredClaim {
  status: 'acquired';
  state: 'reserved';
  accountId: string;
  operationType: MessageSendOperationType;
  operationId: string;
  key: string;
  owner: string;
  result: unknown | null;
}

export interface IMessageSendDuplicateClaim {
  status: 'duplicate';
  state: MessageSendIdempotencyState;
  accountId: string;
  operationType: MessageSendOperationType;
  operationId: string;
  key: string;
  owner: null;
  result: unknown | null;
  /** All durable global projections were broker-acknowledged and compacted. */
  compacted?: boolean;
}

export interface IMessageSendErrorClaim {
  status: 'error';
  reason: MessageSendClaimErrorReason;
  state: null;
  accountId: string;
  operationType: MessageSendOperationType;
  operationId: string;
  key: string | null;
  owner: null;
  result: null;
}

export type MessageSendClaimResult =
  | IMessageSendAcquiredClaim
  | IMessageSendDuplicateClaim
  | IMessageSendErrorClaim;

export interface IMessageSendNotFoundInspection {
  status: 'not_found';
  state: null;
  accountId: string;
  operationType: MessageSendOperationType;
  operationId: string;
  key: string;
  owner: null;
  result: null;
}

export type MessageSendInspectionResult =
  | IMessageSendDuplicateClaim
  | IMessageSendErrorClaim
  | IMessageSendNotFoundInspection;

const STATE_TTL_LUA = `
local function ttl_seconds_for_state(state)
  if state == 'reserved' then return ${MESSAGE_SEND_LEDGER_V4_POLICY.reservedTtlSeconds} end
  if state == 'provider_invoked' then return ${MESSAGE_SEND_LEDGER_V4_POLICY.providerInvokedTtlSeconds} end
  if state == 'succeeded' then return ${MESSAGE_SEND_LEDGER_V4_POLICY.succeededTtlSeconds} end
  if state == 'failed' then return ${MESSAGE_SEND_LEDGER_V4_POLICY.failedTtlSeconds} end
  if state == 'expired' then return ${MESSAGE_SEND_LEDGER_V4_POLICY.expiredTtlSeconds} end
  return ${MESSAGE_SEND_LEDGER_V4_POLICY.ambiguousTtlSeconds}
end

local function apply_absolute_expiry(key, state, now_ms, terminal_at_ms)
  local base_ms = now_ms
  if state == 'reserved' then
    local created_at_ms = tonumber(redis.call('HGET', key, 'created_at_ms') or '')
    if created_at_ms then base_ms = created_at_ms end
  elseif state == 'succeeded' or state == 'failed' or state == 'expired'
      or state == 'ambiguous' then
    local stored_terminal_at_ms = tonumber(terminal_at_ms or '')
    if stored_terminal_at_ms then base_ms = stored_terminal_at_ms end
  end
  local expires_at_ms = base_ms + (ttl_seconds_for_state(state) * 1000)
  redis.call('HSET', key, 'expires_at_ms', tostring(expires_at_ms))
  redis.call('PEXPIREAT', key, expires_at_ms)
  return expires_at_ms
end
`;

const CLAIM_SCRIPT = `
${STATE_TTL_LUA}
local key = KEYS[1]
local recovery_key = KEYS[3]
local watchdog_key = KEYS[4]
local owner = ARGV[1]
local lease_ms = tonumber(ARGV[2])
local operation_type = ARGV[3]
local operation_id = ARGV[4]
local meta_json = ARGV[5]
local meta_digest = ARGV[6]
local identity_digest = ARGV[7]
local redis_time = redis.call('TIME')
local now_ms =
  (tonumber(redis_time[1]) * 1000) + math.floor(tonumber(redis_time[2]) / 1000)
local lease_until_ms = tostring(now_ms + lease_ms)

local function stored_recovery_json()
  local value = redis.call('GET', recovery_key) or ''
  if value == '' then value = redis.call('HGET', key, 'result_json') or '' end
  if value == '' then value = redis.call('HGET', key, 'recovery_json') or '' end
  return value
end

local exists = redis.call('EXISTS', key)
if exists == 0 then
  redis.call('DEL', recovery_key)
  redis.call('HSET', key,
    'schema_version', '4',
    'state', 'reserved',
    'owner', owner,
    'lease_until_ms', lease_until_ms,
    'operation_type', operation_type,
    'operation_id', operation_id,
    'meta_json', meta_json,
    'meta_digest', meta_digest,
    'identity_digest', identity_digest,
    'result_json', '',
    'recovery_digest', '',
    'outcome_digest', '',
    'error', '',
    'created_at_ms', tostring(now_ms),
    'terminal_at_ms', '',
    'compacted_at_ms', '',
    'updated_at_ms', tostring(now_ms))
  redis.call('ZREM', watchdog_key, key)
  apply_absolute_expiry(key, 'reserved', now_ms, nil)
  return {'acquired', 'reserved', ''}
end

local state = redis.call('HGET', key, 'state')
if not state or state == '' then
  state = 'ambiguous'
  redis.call('HSET', key,
    'schema_version', '4',
    'state', state,
    'owner', '',
    'lease_until_ms', '0',
    'error', 'invalid idempotency record',
    'terminal_at_ms', tostring(now_ms),
    'updated_at_ms', tostring(now_ms))
  redis.call('ZREM', watchdog_key, key)
  apply_absolute_expiry(key, state, now_ms, tostring(now_ms))
  return {'duplicate', state, stored_recovery_json()}
end

local stored_operation_type = redis.call('HGET', key, 'operation_type') or ''
local stored_operation_id = redis.call('HGET', key, 'operation_id') or ''
local current_meta_json = redis.call('HGET', key, 'meta_json') or ''
local incoming_meta = nil
local current_meta = nil
if meta_json ~= '' then
  local decoded, value = pcall(cjson.decode, meta_json)
  if decoded and type(value) == 'table' then
    incoming_meta = value
  end
end
if current_meta_json ~= '' then
  local decoded, value = pcall(cjson.decode, current_meta_json)
  if decoded and type(value) == 'table' then
    current_meta = value
  end
end

local immutable_fields = {
  'provider',
  'account_id',
  'chat_id',
  'message_id',
  'worker_id',
  'schedule_id',
  'contact_id',
  'notification_id',
  'destination'
}
local immutable_matches = stored_operation_type == operation_type
  and stored_operation_id == operation_id
local compacted_at_ms = redis.call('HGET', key, 'compacted_at_ms') or ''
local stored_identity_digest = redis.call('HGET', key, 'identity_digest') or ''
if immutable_matches and compacted_at_ms ~= '' and stored_identity_digest ~= '' then
  immutable_matches =
    stored_identity_digest == identity_digest
elseif immutable_matches then
  for _, field in ipairs(immutable_fields) do
    local incoming_value = incoming_meta and incoming_meta[field] or nil
    local current_value = current_meta and current_meta[field] or nil
    if tostring(incoming_value or '') ~= tostring(current_value or '') then
      immutable_matches = false
      break
    end
  end
end
if not immutable_matches then
  return {'error', 'identity_conflict', ''}
end

local function incoming_runtime_is_active()
  if not incoming_meta then
    return false
  end
  local current_fence_raw = redis.call('GET', KEYS[2])
  if not current_fence_raw then
    return false
  end
  local decoded, current_fence = pcall(cjson.decode, current_fence_raw)
  if not decoded or type(current_fence) ~= 'table' then
    return false
  end
  return tostring(current_fence.state or '') == 'active'
    and tostring(current_fence.worker_id or '')
      == tostring(incoming_meta.worker_id or '')
    and tostring(current_fence.source_provider or '')
      == tostring(incoming_meta.provider or '')
    and tonumber(current_fence.runtime_generation)
      == tonumber(incoming_meta.runtime_generation)
    and tostring(current_fence.connection_epoch or '')
      == tostring(incoming_meta.connection_epoch or '')
    and (tonumber(current_fence.connection_sequence) or 0) > 0
    and (tonumber(current_fence.activation_order) or 0) > 0
end

local source_changed = current_meta
  and incoming_meta
  and (
    tonumber(current_meta.runtime_generation)
      ~= tonumber(incoming_meta.runtime_generation)
    or tostring(current_meta.connection_epoch or '')
      ~= tostring(incoming_meta.connection_epoch or '')
    or tonumber(current_meta.consumer_assignment_epoch)
      ~= tonumber(incoming_meta.consumer_assignment_epoch)
  )

if state == 'reserved' then
  local current_lease = tonumber(redis.call('HGET', key, 'lease_until_ms') or '0')
  if current_lease <= now_ms
    or (source_changed and incoming_runtime_is_active()) then
    redis.call('HSET', key,
      'schema_version', '4',
      'state', 'reserved',
      'owner', owner,
      'lease_until_ms', lease_until_ms,
      'operation_type', operation_type,
      'operation_id', operation_id,
      'meta_json', meta_json,
      'meta_digest', meta_digest,
      'identity_digest', identity_digest,
      'result_json', '',
      'recovery_json', '',
      'recovery_digest', '',
      'outcome_digest', '',
      'error', '',
      'created_at_ms', tostring(now_ms),
      'terminal_at_ms', '',
      'compacted_at_ms', '',
      'updated_at_ms', tostring(now_ms))
    redis.call('DEL', recovery_key)
    redis.call('HDEL', key, 'provider_invoked_at_ms', 'watchdog_due_at_ms')
    redis.call('ZREM', watchdog_key, key)
    apply_absolute_expiry(key, 'reserved', now_ms, nil)
    return {'acquired', 'reserved', ''}
  end
end

if state == 'provider_invoked' then
  local current_lease = tonumber(redis.call('HGET', key, 'lease_until_ms') or '0')
  if current_lease <= now_ms then
    state = 'ambiguous'
    redis.call('HSET', key,
      'state', state,
      'lease_until_ms', '0',
      'error', 'provider_invocation_lease_expired',
      'terminal_at_ms', tostring(now_ms),
      'updated_at_ms', tostring(now_ms))
    redis.call('HDEL', key, 'watchdog_due_at_ms')
    redis.call('ZREM', watchdog_key, key)
    apply_absolute_expiry(key, state, now_ms, tostring(now_ms))
  else
    local watchdog_due_at_ms = tonumber(
      redis.call('HGET', key, 'watchdog_due_at_ms') or ''
    )
    if not watchdog_due_at_ms then
      watchdog_due_at_ms = math.min(
        current_lease,
        now_ms + ${MESSAGE_SEND_LEDGER_V4_POLICY.providerInvocationWatchdogMaxAgeMs}
      )
      redis.call('HSET', key, 'watchdog_due_at_ms', tostring(watchdog_due_at_ms))
    end
    redis.call('ZADD', watchdog_key, watchdog_due_at_ms, key)
  end
else
  redis.call('ZREM', watchdog_key, key)
end

local compacted = (redis.call('HGET', key, 'compacted_at_ms') or '') ~= ''
return {
  'duplicate', state, stored_recovery_json(),
  compacted and '1' or '0'
}
`;

const INSPECT_SCRIPT = `
${STATE_TTL_LUA}
local key = KEYS[1]
local recovery_key = KEYS[2]
local watchdog_key = KEYS[3]
local operation_type = ARGV[1]
local operation_id = ARGV[2]
local expected_meta_json = ARGV[3]
local expected_meta_digest = ARGV[4]
local compatible_legacy_meta_keys_json = ARGV[5]
local identity_digest = ARGV[6]

local function stored_recovery_json()
  local value = redis.call('GET', recovery_key) or ''
  if value == '' then value = redis.call('HGET', key, 'result_json') or '' end
  if value == '' then value = redis.call('HGET', key, 'recovery_json') or '' end
  return value
end

if redis.call('EXISTS', key) == 0 then
  redis.call('ZREM', watchdog_key, key)
  return {'not_found', '', ''}
end

local stored_operation_type =
  redis.call('HGET', key, 'operation_type') or ''
local stored_operation_id =
  redis.call('HGET', key, 'operation_id') or ''
if (stored_operation_type ~= '' and stored_operation_type ~= operation_type)
  or (stored_operation_id ~= '' and stored_operation_id ~= operation_id) then
  return {'error', 'identity_conflict', ''}
end

local stored_meta_json = redis.call('HGET', key, 'meta_json') or ''
local stored_meta_digest = redis.call('HGET', key, 'meta_digest') or ''
local metadata_matches = stored_meta_digest == expected_meta_digest
if stored_meta_json == ''
    and (redis.call('HGET', key, 'compacted_at_ms') or '') ~= '' then
  -- Compacted v4 tombstones retain the digest but intentionally drop JSON.
  metadata_matches =
    (redis.call('HGET', key, 'identity_digest') or '') == identity_digest
end
if not metadata_matches and expected_meta_json ~= '' then
  local expected_ok, expected_meta = pcall(cjson.decode, expected_meta_json)
  local stored_ok, stored_meta = pcall(cjson.decode, stored_meta_json)
  local ignored_ok, ignored_keys =
    pcall(cjson.decode, compatible_legacy_meta_keys_json)
  if expected_ok and stored_ok and ignored_ok
    and type(expected_meta) == 'table'
    and type(stored_meta) == 'table'
    and type(ignored_keys) == 'table' then
    local ignored = {}
    for _, field in ipairs(ignored_keys) do
      ignored[tostring(field)] = true
    end
    metadata_matches = true
    for field, value in pairs(expected_meta) do
      if not ignored[field]
        and cjson.encode(stored_meta[field]) ~= cjson.encode(value) then
        metadata_matches = false
        break
      end
    end
    if metadata_matches then
      for field, _ in pairs(stored_meta) do
        if not ignored[field] and expected_meta[field] == nil then
          metadata_matches = false
          break
        end
      end
    end
  end
end
if not metadata_matches then
  return {'error', 'identity_conflict', ''}
end

local state = redis.call('HGET', key, 'state')
if not state then
  local redis_time = redis.call('TIME')
  local now_ms =
    (tonumber(redis_time[1]) * 1000)
      + math.floor(tonumber(redis_time[2]) / 1000)
  state = 'ambiguous'
  redis.call('HSET', key,
    'schema_version', '4',
    'state', state,
    'lease_until_ms', '0',
    'error', 'invalid idempotency record',
    'terminal_at_ms', tostring(now_ms),
    'updated_at_ms', tostring(now_ms))
  redis.call('ZREM', watchdog_key, key)
  apply_absolute_expiry(key, state, now_ms, tostring(now_ms))
elseif state == 'provider_invoked' then
  local redis_time = redis.call('TIME')
  local now_ms =
    (tonumber(redis_time[1]) * 1000)
      + math.floor(tonumber(redis_time[2]) / 1000)
  local current_lease =
    tonumber(redis.call('HGET', key, 'lease_until_ms') or '0')
  if current_lease <= now_ms then
    state = 'ambiguous'
    redis.call('HSET', key,
      'state', state,
      'lease_until_ms', '0',
      'error', 'provider_invocation_lease_expired',
      'terminal_at_ms', tostring(now_ms),
      'updated_at_ms', tostring(now_ms))
    redis.call('HDEL', key, 'watchdog_due_at_ms')
    redis.call('ZREM', watchdog_key, key)
    apply_absolute_expiry(key, state, now_ms, tostring(now_ms))
  else
    local watchdog_due_at_ms = tonumber(
      redis.call('HGET', key, 'watchdog_due_at_ms') or ''
    )
    if not watchdog_due_at_ms then
      watchdog_due_at_ms = math.min(
        current_lease,
        now_ms + ${MESSAGE_SEND_LEDGER_V4_POLICY.providerInvocationWatchdogMaxAgeMs}
      )
      redis.call('HSET', key, 'watchdog_due_at_ms', tostring(watchdog_due_at_ms))
    end
    redis.call('ZADD', watchdog_key, watchdog_due_at_ms, key)
  end
else
  redis.call('ZREM', watchdog_key, key)
end

local compacted = (redis.call('HGET', key, 'compacted_at_ms') or '') ~= ''
return {
  'duplicate', state, stored_recovery_json(),
  compacted and '1' or '0'
}
`;

const TRANSITION_SCRIPT = `
${STATE_TTL_LUA}
local key = KEYS[1]
local recovery_key = KEYS[2]
local watchdog_key = KEYS[3]
local recovery_record_key = KEYS[4]
local owner = ARGV[1]
local expected_state = ARGV[2]
local target_state = ARGV[3]
local lease_ms = tonumber(ARGV[4])
local result_json = ARGV[5]
local error_value = ARGV[6]
local outcome_digest = ARGV[7]
local recovery_digest = ARGV[8]
local recovery_plan_json = ARGV[9]
local recovery_plan_digest = ARGV[10]
local recovery_queue_prefix = ARGV[11]
local recovery_workers_key = ARGV[12]
local redis_time = redis.call('TIME')
local now_ms =
  (tonumber(redis_time[1]) * 1000) + math.floor(tonumber(redis_time[2]) / 1000)
local lease_until_ms = '0'
if lease_ms > 0 then
  lease_until_ms = tostring(now_ms + lease_ms)
end

local function sync_watchdog_index()
  if target_state == 'provider_invoked' then
    local watchdog_due_at_ms = tonumber(
      redis.call('HGET', key, 'watchdog_due_at_ms') or ''
    )
    if not watchdog_due_at_ms then
      watchdog_due_at_ms = math.min(
        tonumber(lease_until_ms),
        now_ms + ${MESSAGE_SEND_LEDGER_V4_POLICY.providerInvocationWatchdogMaxAgeMs}
      )
      redis.call('HSET', key,
        'provider_invoked_at_ms', tostring(now_ms),
        'watchdog_due_at_ms', tostring(watchdog_due_at_ms))
    end
    redis.call('ZADD', watchdog_key, watchdog_due_at_ms, key)
    return
  end
  redis.call('HDEL', key, 'watchdog_due_at_ms')
  if target_state == 'reserved' then
    redis.call('HDEL', key, 'provider_invoked_at_ms')
  end
  redis.call('ZREM', watchdog_key, key)
end

local function worker_from_plan(value)
  if not value or value == '' then return nil end
  local decoded, plan = pcall(cjson.decode, value)
  if not decoded or type(plan) ~= 'table' then return nil end
  local worker_id = tostring(plan.worker_id or '')
  if worker_id == '' then return nil end
  return worker_id
end

local function clear_recovery_index()
  local stored_plan = redis.call('HGET', key, 'node_recovery_plan_json') or ''
  local worker_id = worker_from_plan(stored_plan)
  if worker_id then
    local queue_key = recovery_queue_prefix .. worker_id
    redis.call('ZREM', queue_key, key)
    if redis.call('ZCARD', queue_key) == 0 then
      redis.call('ZREM', recovery_workers_key, worker_id)
    end
  end
  redis.call('HDEL', key,
    'node_recovery_plan_json', 'node_recovery_plan_digest',
    'node_recovery_completed_json',
    'recovery_claim_owner', 'recovery_claim_until_ms')
  redis.call('DEL', recovery_record_key)
end

local function sync_recovery_index()
  if target_state == 'reserved' or recovery_plan_json == '' then
    clear_recovery_index()
    return
  end
  local previous_plan = redis.call('HGET', key, 'node_recovery_plan_json') or ''
  local previous_worker = worker_from_plan(previous_plan)
  local worker_id = worker_from_plan(recovery_plan_json)
  if not worker_id then return end
  if previous_worker and previous_worker ~= worker_id then
    local previous_queue = recovery_queue_prefix .. previous_worker
    redis.call('ZREM', previous_queue, key)
    if redis.call('ZCARD', previous_queue) == 0 then
      redis.call('ZREM', recovery_workers_key, previous_worker)
    end
  end
  local due_at_ms = now_ms
  if target_state == 'provider_invoked' then
    due_at_ms = tonumber(redis.call('HGET', key, 'watchdog_due_at_ms') or now_ms)
  end
  local queue_key = recovery_queue_prefix .. worker_id
  redis.call('HSET', key,
    'node_recovery_plan_json', recovery_plan_json,
    'node_recovery_plan_digest', recovery_plan_digest,
    'node_recovery_record_key', recovery_record_key)
  redis.call('HDEL', key, 'recovery_claim_owner', 'recovery_claim_until_ms')
  local decoded, plan = pcall(cjson.decode, recovery_plan_json)
  local recovery_state = target_state
  if target_state == 'provider_invoked' and decoded and type(plan) == 'table' then
    recovery_state = tostring(plan.terminal_state or 'ambiguous')
  end
  redis.call('HSET', recovery_record_key,
    'schema_version', '4',
    'ledger_key', key,
    'state', recovery_state,
    'account_id', decoded and tostring(plan.account_id or '') or '',
    'worker_id', worker_id,
    'operation_type', redis.call('HGET', key, 'operation_type') or '',
    'operation_id', redis.call('HGET', key, 'operation_id') or '',
    'recovery_json', result_json,
    'recovery_digest', recovery_digest,
    'node_recovery_plan_json', recovery_plan_json,
    'node_recovery_plan_digest', recovery_plan_digest,
    'node_recovery_completed_json', '[]',
    'created_at_ms', tostring(now_ms),
    'updated_at_ms', tostring(now_ms))
  redis.call('HDEL', recovery_record_key,
    'recovery_claim_owner', 'recovery_claim_until_ms')
  redis.call('EXPIRE', recovery_record_key, ${MESSAGE_SEND_LEDGER_V4_POLICY.recoveryTtlSeconds})
  redis.call('ZADD', queue_key, due_at_ms, key)
  redis.call('EXPIRE', queue_key, ${MESSAGE_SEND_LEDGER_V4_POLICY.recoveryTtlSeconds})
  local indexed_worker_due = tonumber(
    redis.call('ZSCORE', recovery_workers_key, worker_id) or ''
  )
  if not indexed_worker_due or due_at_ms < indexed_worker_due then
    redis.call('ZADD', recovery_workers_key, due_at_ms, worker_id)
  end
end

local state = redis.call('HGET', key, 'state')
if not state then
  redis.call('ZREM', watchdog_key, key)
  return 'not_found'
end
if redis.call('HGET', key, 'owner') ~= owner then
  return 'owner_mismatch'
end
if state == target_state then
  if (redis.call('HGET', key, 'outcome_digest') or '') ~= outcome_digest then
    return 'invalid_state'
  end
  -- Idempotent observation must not refresh the bounded recovery TTL or
  -- resurrect a payload already removed after its broker acknowledgement.
  sync_watchdog_index()
  local stored_plan = redis.call('HGET', key, 'node_recovery_plan_json') or ''
  if stored_plan ~= '' then
    local worker_id = worker_from_plan(stored_plan)
    if worker_id then
      local queue_key = recovery_queue_prefix .. worker_id
      local due_at_ms = tonumber(redis.call('ZSCORE', queue_key, key) or now_ms)
      redis.call('ZADD', queue_key, due_at_ms, key)
      redis.call('EXPIRE', queue_key, ${MESSAGE_SEND_LEDGER_V4_POLICY.recoveryTtlSeconds})
      local indexed_worker_due = tonumber(
        redis.call('ZSCORE', recovery_workers_key, worker_id) or ''
      )
      if not indexed_worker_due or due_at_ms < indexed_worker_due then
        redis.call('ZADD', recovery_workers_key, due_at_ms, worker_id)
      end
    end
  end
  return 'transitioned'
end
if state ~= expected_state then
  return 'invalid_state'
end

if result_json ~= '' then
  redis.call('SET', recovery_key, result_json, 'EX', ${MESSAGE_SEND_LEDGER_V4_POLICY.recoveryTtlSeconds})
else
  redis.call('DEL', recovery_key)
end
local terminal_at_ms = ''
if target_state == 'succeeded' or target_state == 'failed'
    or target_state == 'expired' or target_state == 'ambiguous' then
  terminal_at_ms = tostring(now_ms)
end
redis.call('HSET', key,
  'schema_version', '4',
  'state', target_state,
  'lease_until_ms', lease_until_ms,
  'result_json', '',
  'recovery_digest', recovery_digest,
  'outcome_digest', outcome_digest,
  'error', error_value,
  'terminal_at_ms', terminal_at_ms,
  'updated_at_ms', now_ms)
sync_watchdog_index()
sync_recovery_index()
apply_absolute_expiry(key, target_state, now_ms, terminal_at_ms)
return 'transitioned'
`;

const RELEASE_SCRIPT = `
local key = KEYS[1]
local recovery_key = KEYS[2]
local watchdog_key = KEYS[3]
local owner = ARGV[1]
local state = redis.call('HGET', key, 'state')
if not state then
  redis.call('ZREM', watchdog_key, key)
  return 'not_found'
end
if redis.call('HGET', key, 'owner') ~= owner then
  return 'owner_mismatch'
end
if state ~= 'reserved' then
  return 'invalid_state'
end
redis.call('DEL', key, recovery_key)
redis.call('ZREM', watchdog_key, key)
return 'transitioned'
`;

const RECOVER_LEGACY_AMBIGUOUS_SCRIPT = `
${STATE_TTL_LUA}
local key = KEYS[1]
local recovery_key = KEYS[2]
local watchdog_key = KEYS[3]
local recovery_record_key = KEYS[4]
local operation_type = ARGV[1]
local operation_id = ARGV[2]
local expected_meta_json = ARGV[3]
local expected_meta_digest = ARGV[4]
local result_json = ARGV[5]
local outcome_digest = ARGV[6]
local identity_digest = ARGV[7]
local compatible_legacy_meta_keys_json = ARGV[8]
local recovery_digest = ARGV[9]
local recovery_plan_json = ARGV[10]
local recovery_plan_digest = ARGV[11]
local recovery_queue_prefix = ARGV[12]
local recovery_workers_key = ARGV[13]

if redis.call('EXISTS', key) == 0 then
  redis.call('ZREM', watchdog_key, key)
  return 'not_found'
end
local state = redis.call('HGET', key, 'state')
if state ~= 'provider_invoked' and state ~= 'ambiguous' then
  return 'invalid_state'
end

local stored_operation_type =
  redis.call('HGET', key, 'operation_type') or ''
local stored_operation_id =
  redis.call('HGET', key, 'operation_id') or ''
if (stored_operation_type ~= '' and stored_operation_type ~= operation_type)
  or (stored_operation_id ~= '' and stored_operation_id ~= operation_id) then
  return 'identity_conflict'
end

local stored_meta_json = redis.call('HGET', key, 'meta_json') or ''
local stored_meta_digest = redis.call('HGET', key, 'meta_digest') or ''
local metadata_matches = stored_meta_digest == expected_meta_digest
if not metadata_matches and stored_meta_json == '' then
  metadata_matches = true
end
if not metadata_matches and expected_meta_json ~= '' then
  local expected_ok, expected_meta = pcall(cjson.decode, expected_meta_json)
  local stored_ok, stored_meta = pcall(cjson.decode, stored_meta_json)
  local ignored_ok, ignored_keys =
    pcall(cjson.decode, compatible_legacy_meta_keys_json)
  if expected_ok and stored_ok and ignored_ok
    and type(expected_meta) == 'table'
    and type(stored_meta) == 'table'
    and type(ignored_keys) == 'table' then
    local ignored = {}
    for _, field in ipairs(ignored_keys) do
      ignored[tostring(field)] = true
    end
    metadata_matches = true
    for field, value in pairs(expected_meta) do
      if not ignored[field]
        and cjson.encode(stored_meta[field]) ~= cjson.encode(value) then
        metadata_matches = false
        break
      end
    end
    if metadata_matches then
      for field, _ in pairs(stored_meta) do
        if not ignored[field] and expected_meta[field] == nil then
          metadata_matches = false
          break
        end
      end
    end
  end
end
if not metadata_matches then
  return 'identity_conflict'
end

local redis_time = redis.call('TIME')
local now_ms =
  (tonumber(redis_time[1]) * 1000) + math.floor(tonumber(redis_time[2]) / 1000)
redis.call('HSET', key,
  'schema_version', '4',
  'state', 'ambiguous',
  'owner', '',
  'lease_until_ms', '0',
  'operation_type', operation_type,
  'operation_id', operation_id,
  'meta_json', expected_meta_json,
  'meta_digest', expected_meta_digest,
  'identity_digest', identity_digest,
  'result_json', '',
  'recovery_digest', recovery_digest,
  'outcome_digest', outcome_digest,
  'error', 'legacy_or_corrupt_provider_outcome_recovered',
  'terminal_at_ms', tostring(now_ms),
  'updated_at_ms', tostring(now_ms))
redis.call('SET', recovery_key, result_json, 'EX', ${MESSAGE_SEND_LEDGER_V4_POLICY.recoveryTtlSeconds})
redis.call('HDEL', key, 'watchdog_due_at_ms')
redis.call('ZREM', watchdog_key, key)
if recovery_plan_json ~= '' then
  local decoded, plan = pcall(cjson.decode, recovery_plan_json)
  local worker_id = decoded and type(plan) == 'table'
    and tostring(plan.worker_id or '') or ''
  if worker_id ~= '' then
    local queue_key = recovery_queue_prefix .. worker_id
    redis.call('HSET', key,
      'node_recovery_plan_json', recovery_plan_json,
      'node_recovery_plan_digest', recovery_plan_digest,
      'node_recovery_record_key', recovery_record_key)
    redis.call('HSET', recovery_record_key,
      'schema_version', '4',
      'ledger_key', key,
      'state', 'ambiguous',
      'account_id', tostring(plan.account_id or ''),
      'worker_id', worker_id,
      'operation_type', operation_type,
      'operation_id', operation_id,
      'recovery_json', result_json,
      'recovery_digest', recovery_digest,
      'node_recovery_plan_json', recovery_plan_json,
      'node_recovery_plan_digest', recovery_plan_digest,
      'node_recovery_completed_json', '[]',
      'created_at_ms', tostring(now_ms),
      'updated_at_ms', tostring(now_ms))
    redis.call('EXPIRE', recovery_record_key, ${MESSAGE_SEND_LEDGER_V4_POLICY.recoveryTtlSeconds})
    redis.call('ZADD', queue_key, now_ms, key)
    redis.call('EXPIRE', queue_key, ${MESSAGE_SEND_LEDGER_V4_POLICY.recoveryTtlSeconds})
    local indexed_worker_due = tonumber(
      redis.call('ZSCORE', recovery_workers_key, worker_id) or ''
    )
    if not indexed_worker_due or now_ms < indexed_worker_due then
      redis.call('ZADD', recovery_workers_key, now_ms, worker_id)
    end
  end
end
apply_absolute_expiry(key, 'ambiguous', now_ms, tostring(now_ms))
return 'transitioned'
`;

const COMPACT_TERMINAL_SCRIPT = `
local key = KEYS[1]
local recovery_key = KEYS[2]
local watchdog_key = KEYS[3]
local recovery_record_key = KEYS[4]
local operation_type = ARGV[1]
local operation_id = ARGV[2]
local expected_state = ARGV[3]
local expected_recovery = ARGV[4]
local expected_recovery_digest = ARGV[5]
local expected_recovery_claim_owner = ARGV[6]
local recovery_queue_prefix = ARGV[7]
local recovery_workers_key = ARGV[8]
local redis_time = redis.call('TIME')
local now_ms =
  (tonumber(redis_time[1]) * 1000) + math.floor(tonumber(redis_time[2]) / 1000)
local function worker_from_json(plan_json)
  if not plan_json or plan_json == '' then return '' end
  local decoded, plan = pcall(cjson.decode, plan_json)
  if decoded and type(plan) == 'table' then
    return tostring(plan.worker_id or '')
  end
  return ''
end
local function remove_recovery_queue(worker_id)
  if worker_id == '' then return end
  local queue_key = recovery_queue_prefix .. worker_id
  redis.call('ZREM', queue_key, key)
  if redis.call('ZCARD', queue_key) == 0 then
    redis.call('ZREM', recovery_workers_key, worker_id)
  end
end
if redis.call('EXISTS', key) == 0 then
  redis.call('ZREM', watchdog_key, key)
  if redis.call('EXISTS', recovery_record_key) == 0 then
    return 'not_found'
  end
  if (redis.call('HGET', recovery_record_key, 'operation_type') or '')
      ~= operation_type or
      (redis.call('HGET', recovery_record_key, 'operation_id') or '')
        ~= operation_id or
      (redis.call('HGET', recovery_record_key, 'state') or '')
        ~= expected_state then
    return 'invalid_state'
  end
  if expected_recovery_claim_owner ~= '' and
      (redis.call('HGET', recovery_record_key, 'recovery_claim_owner') or '')
        ~= expected_recovery_claim_owner then
    return 'owner_mismatch'
  end
  if (redis.call('HGET', recovery_record_key, 'recovery_json') or '')
      ~= expected_recovery or
      (redis.call('HGET', recovery_record_key, 'recovery_digest') or '')
        ~= expected_recovery_digest then
    return 'invalid_state'
  end
  local worker_id = worker_from_json(
    redis.call('HGET', recovery_record_key, 'node_recovery_plan_json') or ''
  )
  redis.call('DEL', recovery_key, recovery_record_key)
  remove_recovery_queue(worker_id)
  return 'transitioned'
end
if (redis.call('HGET', key, 'operation_type') or '') ~= operation_type
    or (redis.call('HGET', key, 'operation_id') or '') ~= operation_id then
  return 'invalid_state'
end
local state = redis.call('HGET', key, 'state') or ''
if state ~= expected_state then
  return 'invalid_state'
end
if (redis.call('HGET', key, 'compacted_at_ms') or '') ~= '' then
  if (redis.call('HGET', key, 'recovery_digest') or '')
      == expected_recovery_digest then
    redis.call('ZREM', watchdog_key, key)
    return 'transitioned'
  end
  return 'invalid_state'
end
if expected_recovery_claim_owner ~= '' and
    ((redis.call('HGET', recovery_record_key, 'recovery_claim_owner') or
      redis.call('HGET', key, 'recovery_claim_owner')) or '')
      ~= expected_recovery_claim_owner then
  return 'owner_mismatch'
end
local stored_recovery = redis.call('GET', recovery_key) or ''
if stored_recovery == '' then
  stored_recovery = redis.call('HGET', key, 'result_json') or ''
end
if stored_recovery == '' then
  stored_recovery = redis.call('HGET', key, 'recovery_json') or ''
end
if stored_recovery ~= expected_recovery then
  return 'invalid_state'
end
local stored_recovery_digest = redis.call('HGET', key, 'recovery_digest') or ''
if stored_recovery_digest ~= ''
    and stored_recovery_digest ~= expected_recovery_digest then
  return 'invalid_state'
end
local worker_id = worker_from_json(
  redis.call('HGET', recovery_record_key, 'node_recovery_plan_json') or ''
)
local plan_json = redis.call('HGET', key, 'node_recovery_plan_json') or ''
if worker_id == '' then
  worker_id = worker_from_json(plan_json)
end
if worker_id == '' then
  local meta_json = redis.call('HGET', key, 'meta_json') or ''
  local decoded, meta = pcall(cjson.decode, meta_json)
  if decoded and type(meta) == 'table' then
    worker_id = tostring(meta.worker_id or '')
  end
end
redis.call('HDEL', key,
  'owner', 'lease_until_ms', 'meta_json', 'result_json', 'recovery_json', 'error',
  'provider_invoked_at_ms', 'watchdog_due_at_ms',
  'node_recovery_plan_json', 'node_recovery_plan_digest',
  'node_recovery_completed_json',
  'recovery_claim_owner', 'recovery_claim_until_ms')
redis.call('HSET', key, 'compacted_at_ms', now_ms)
redis.call('HSET', key, 'recovery_digest', expected_recovery_digest)
redis.call('DEL', recovery_key, recovery_record_key)
redis.call('ZREM', watchdog_key, key)
remove_recovery_queue(worker_id)
return 'transitioned'
`;

const PROVIDER_WATCHDOG_BATCH_SCRIPT = `
${STATE_TTL_LUA}
local watchdog_key = KEYS[1]
local max_count = tonumber(ARGV[1])
local recovery_queue_prefix = ARGV[2]
local recovery_workers_key = ARGV[3]
local redis_time = redis.call('TIME')
local now_ms =
  (tonumber(redis_time[1]) * 1000) + math.floor(tonumber(redis_time[2]) / 1000)
local entries = redis.call(
  'ZRANGEBYSCORE', watchdog_key, '-inf', now_ms, 'LIMIT', 0, max_count
)
local terminalized = 0
local cleaned = 0

for _, key in ipairs(entries) do
  local state = redis.call('HGET', key, 'state') or ''
  local indexed_due_at_ms = tonumber(redis.call('ZSCORE', watchdog_key, key) or '0')
  local stored_due_at_ms = tonumber(
    redis.call('HGET', key, 'watchdog_due_at_ms') or '0'
  )
  if state == 'provider_invoked'
      and indexed_due_at_ms > 0
      and stored_due_at_ms == indexed_due_at_ms
      and stored_due_at_ms <= now_ms then
    redis.call('HSET', key,
      'state', 'ambiguous',
      'lease_until_ms', '0',
      'error', 'provider_invocation_watchdog_expired',
      'terminal_at_ms', tostring(now_ms),
      'updated_at_ms', tostring(now_ms))
    redis.call('HDEL', key, 'watchdog_due_at_ms')
    apply_absolute_expiry(key, 'ambiguous', now_ms, tostring(now_ms))
    redis.call('ZREM', watchdog_key, key)
    local plan_json = redis.call('HGET', key, 'node_recovery_plan_json') or ''
    if plan_json ~= '' then
      local decoded, plan = pcall(cjson.decode, plan_json)
      local worker_id = decoded and type(plan) == 'table'
        and tostring(plan.worker_id or '') or ''
      if worker_id ~= '' then
        local queue_key = recovery_queue_prefix .. worker_id
        redis.call('ZADD', queue_key, now_ms, key)
        redis.call('EXPIRE', queue_key, ${MESSAGE_SEND_LEDGER_V4_POLICY.recoveryTtlSeconds})
        local indexed_worker_due = tonumber(
          redis.call('ZSCORE', recovery_workers_key, worker_id) or ''
        )
        if not indexed_worker_due or now_ms < indexed_worker_due then
          redis.call('ZADD', recovery_workers_key, now_ms, worker_id)
        end
      end
    end
    terminalized = terminalized + 1
  elseif state ~= 'provider_invoked' or redis.call('EXISTS', key) == 0 then
    redis.call('ZREM', watchdog_key, key)
    cleaned = cleaned + 1
  elseif stored_due_at_ms <= 0 then
    local lease_until_ms = tonumber(
      redis.call('HGET', key, 'lease_until_ms') or '0'
    )
    local provider_invoked_at_ms = tonumber(
      redis.call('HGET', key, 'provider_invoked_at_ms')
        or redis.call('HGET', key, 'updated_at_ms')
        or now_ms
    )
    local repaired_due_at_ms = now_ms
    if lease_until_ms > 0 then
      repaired_due_at_ms = math.min(
        lease_until_ms,
        provider_invoked_at_ms
          + ${MESSAGE_SEND_LEDGER_V4_POLICY.providerInvocationWatchdogMaxAgeMs}
      )
    end
    redis.call('HSET', key, 'watchdog_due_at_ms', tostring(repaired_due_at_ms))
    redis.call('ZADD', watchdog_key, repaired_due_at_ms, key)
  elseif stored_due_at_ms ~= indexed_due_at_ms then
    redis.call('ZADD', watchdog_key, stored_due_at_ms, key)
  end
end

return {#entries, terminalized, cleaned}
`;

const CLAIM_RECOVERY_BATCH_SCRIPT = `
local queue_key = KEYS[1]
local workers_key = KEYS[2]
local worker_id = ARGV[1]
local owner = ARGV[2]
local max_count = tonumber(ARGV[3])
local lease_ms = tonumber(ARGV[4])
local retry_ms = tonumber(ARGV[5])
local ledger_prefix = ARGV[6]
local recovery_record_prefix = ARGV[7]
local redis_time = redis.call('TIME')
local now_ms =
  (tonumber(redis_time[1]) * 1000) + math.floor(tonumber(redis_time[2]) / 1000)
local entries = redis.call(
  'ZRANGEBYSCORE', queue_key, '-inf', now_ms, 'LIMIT', 0, max_count
)
local output = {}
for _, ledger_key in ipairs(entries) do
  local recovery_record_key = ''
  if string.sub(ledger_key, 1, string.len(ledger_prefix)) == ledger_prefix then
    recovery_record_key = recovery_record_prefix
      .. string.sub(ledger_key, string.len(ledger_prefix) + 1)
  end
  local ledger_exists = redis.call('EXISTS', ledger_key) == 1
  local record_exists = recovery_record_key ~= ''
    and redis.call('EXISTS', recovery_record_key) == 1
  local state = ledger_exists
    and (redis.call('HGET', ledger_key, 'state') or '')
    or (record_exists and (redis.call('HGET', recovery_record_key, 'state') or '') or '')
  local compacted = ledger_exists
    and (redis.call('HGET', ledger_key, 'compacted_at_ms') or '') or ''
  local plan_json = record_exists
    and (redis.call('HGET', recovery_record_key, 'node_recovery_plan_json') or '')
    or (ledger_exists and (redis.call('HGET', ledger_key, 'node_recovery_plan_json') or '') or '')
  local decoded, plan = pcall(cjson.decode, plan_json)
  local valid_plan = decoded and type(plan) == 'table'
    and tostring(plan.worker_id or '') == worker_id
  local claim_key = record_exists and recovery_record_key or ledger_key
  if (not ledger_exists and not record_exists) or compacted ~= ''
      or plan_json == '' or not valid_plan then
    redis.call('ZREM', queue_key, ledger_key)
  elseif ledger_exists and (state == 'provider_invoked' or state == 'reserved') then
    local due_at_ms = tonumber(
      redis.call('HGET', ledger_key, 'watchdog_due_at_ms') or ''
    ) or (now_ms + retry_ms)
    if due_at_ms <= now_ms then due_at_ms = now_ms + retry_ms end
    redis.call('ZADD', queue_key, due_at_ms, ledger_key)
  elseif state ~= 'succeeded' and state ~= 'failed'
      and state ~= 'expired' and state ~= 'ambiguous' then
    redis.call('ZREM', queue_key, ledger_key)
  elseif tostring(plan.terminal_state or '') ~= state then
    redis.call('ZREM', queue_key, ledger_key)
  else
    local claim_until_ms = tonumber(
      redis.call('HGET', claim_key, 'recovery_claim_until_ms') or '0'
    )
    if claim_until_ms <= now_ms then
      local until_ms = now_ms + lease_ms
      redis.call('HSET', claim_key,
        'recovery_claim_owner', owner,
        'recovery_claim_until_ms', tostring(until_ms))
      redis.call('ZADD', queue_key, until_ms, ledger_key)
      table.insert(output, ledger_key)
      table.insert(output, state)
      table.insert(output, redis.call('HGET', claim_key, 'operation_type') or '')
      table.insert(output, redis.call('HGET', claim_key, 'operation_id') or '')
      table.insert(output, tostring(plan.account_id or ''))
      table.insert(output, plan_json)
      table.insert(output,
        redis.call('HGET', claim_key, 'node_recovery_completed_json') or '[]')
      table.insert(output, claim_key)
      table.insert(output,
        redis.call('HGET', claim_key, 'recovery_json') or '')
    end
  end
end
local earliest = redis.call('ZRANGE', queue_key, 0, 0, 'WITHSCORES')
if #earliest == 0 then
  redis.call('ZREM', workers_key, worker_id)
else
  redis.call('ZADD', workers_key, tonumber(earliest[2]), worker_id)
end
return output
`;

const DUE_RECOVERY_WORKERS_SCRIPT = `
local redis_time = redis.call('TIME')
local now_ms =
  (tonumber(redis_time[1]) * 1000) + math.floor(tonumber(redis_time[2]) / 1000)
return redis.call(
  'ZRANGEBYSCORE', KEYS[1], '-inf', now_ms,
  'LIMIT', 0, tonumber(ARGV[1])
)
`;

const COMPLETE_RECOVERY_STEP_SCRIPT = `
local recovery_record_key = KEYS[1]
local owner = ARGV[1]
local expected_plan_digest = ARGV[2]
local step_id = ARGV[3]
local redis_time = redis.call('TIME')
local now_ms =
  (tonumber(redis_time[1]) * 1000) + math.floor(tonumber(redis_time[2]) / 1000)
if (redis.call('HGET', recovery_record_key, 'recovery_claim_owner') or '') ~= owner then
  return 'owner_mismatch'
end
if tonumber(redis.call('HGET', recovery_record_key, 'recovery_claim_until_ms') or '0')
    <= now_ms then
  return 'owner_mismatch'
end
if (redis.call('HGET', recovery_record_key, 'node_recovery_plan_digest') or '')
    ~= expected_plan_digest then
  return 'invalid_state'
end
local raw = redis.call('HGET', recovery_record_key, 'node_recovery_completed_json') or '[]'
local decoded, completed = pcall(cjson.decode, raw)
if not decoded or type(completed) ~= 'table' then completed = {} end
for _, current in ipairs(completed) do
  if tostring(current) == step_id then return 'transitioned' end
end
if #completed >= 8 then return 'invalid_state' end
table.insert(completed, step_id)
redis.call('HSET', recovery_record_key,
  'node_recovery_completed_json', cjson.encode(completed),
  'updated_at_ms', tostring(now_ms))
return 'transitioned'
`;

const EXTEND_RECOVERY_CLAIM_SCRIPT = `
local recovery_record_key = KEYS[1]
local queue_key = KEYS[2]
local workers_key = KEYS[3]
local owner = ARGV[1]
local worker_id = ARGV[2]
local lease_ms = tonumber(ARGV[3])
local ledger_key = ARGV[4]
local redis_time = redis.call('TIME')
local now_ms =
  (tonumber(redis_time[1]) * 1000) + math.floor(tonumber(redis_time[2]) / 1000)
if (redis.call('HGET', recovery_record_key, 'recovery_claim_owner') or '') ~= owner then
  return 'owner_mismatch'
end
if tonumber(redis.call('HGET', recovery_record_key, 'recovery_claim_until_ms') or '0')
    <= now_ms then
  return 'owner_mismatch'
end
local until_ms = now_ms + lease_ms
redis.call('HSET', recovery_record_key, 'recovery_claim_until_ms', tostring(until_ms))
redis.call('ZADD', queue_key, until_ms, ledger_key)
redis.call('EXPIRE', queue_key, ${MESSAGE_SEND_LEDGER_V4_POLICY.recoveryTtlSeconds})
local earliest = redis.call('ZRANGE', queue_key, 0, 0, 'WITHSCORES')
if #earliest > 0 then
  redis.call('ZADD', workers_key, tonumber(earliest[2]), worker_id)
end
return 'transitioned'
`;

const RELEASE_RECOVERY_CLAIM_SCRIPT = `
local recovery_record_key = KEYS[1]
local queue_key = KEYS[2]
local workers_key = KEYS[3]
local owner = ARGV[1]
local worker_id = ARGV[2]
local retry_ms = tonumber(ARGV[3])
local ledger_key = ARGV[4]
local redis_time = redis.call('TIME')
local now_ms =
  (tonumber(redis_time[1]) * 1000) + math.floor(tonumber(redis_time[2]) / 1000)
if (redis.call('HGET', recovery_record_key, 'recovery_claim_owner') or '') ~= owner then
  return 'owner_mismatch'
end
redis.call('HDEL', recovery_record_key,
  'recovery_claim_owner', 'recovery_claim_until_ms')
local due_at_ms = now_ms + retry_ms
redis.call('ZADD', queue_key, due_at_ms, ledger_key)
redis.call('EXPIRE', queue_key, ${MESSAGE_SEND_LEDGER_V4_POLICY.recoveryTtlSeconds})
local earliest = redis.call('ZRANGE', queue_key, 0, 0, 'WITHSCORES')
if #earliest > 0 then
  redis.call('ZADD', workers_key, tonumber(earliest[2]), worker_id)
end
return 'transitioned'
`;

@injectable()
export class MessageSendIdempotencyService {
  public static readonly POLICY = MESSAGE_SEND_LEDGER_V4_POLICY;
  public static readonly LEASE_MS = 10 * 60 * 1000;
  public static readonly FAST_RECOVERY_RESERVATION_LEASE_MS = 30 * 1000;
  public static readonly DEFAULT_PROVIDER_INVOCATION_LEASE_MS = 75 * 1000;
  public static readonly MAX_PROVIDER_INVOCATION_LEASE_MS = 150 * 1000;
  private static readonly PROVIDER_INVOCATION_LEASE_PADDING_MS = 30 * 1000;
  private readonly keyPrefix = 'message-send:idempotency:v4';
  // `message-send:recovery:v4:<worker_id>` is the cross-runtime ZSET
  // namespace. Payload keys must never share that prefix/type.
  private readonly recoveryKeyPrefix = 'message-send:recovery-payload:v4';
  private readonly recoveryRecordKeyPrefix = 'message-send:recovery-record:v4';
  private readonly providerWatchdogKey = 'message-send:provider-watchdog:v4';
  private readonly recoveryQueuePrefix = 'message-send:recovery:v4:';
  private readonly recoveryWorkersKey = 'message-send:recovery-workers:v4';
  private readonly acquiredClaimMeta = new WeakMap<
    IMessageSendAcquiredClaim,
    Record<string, unknown>
  >();

  constructor(@inject('Redis') private readonly redis: Redis) {}

  public buildOperationKey(
    accountId: string,
    operationType: MessageSendOperationType,
    operationId: string
  ): string | null {
    const normalizedAccountId = this.normalizeSegment(accountId);
    const normalizedOperationId = this.normalizeSegment(operationId);
    if (!normalizedAccountId || !normalizedOperationId) {
      return null;
    }

    const digest = createHash('sha256')
      .update(`${operationType}\0${normalizedOperationId}`)
      .digest('hex');
    return `${this.keyPrefix}:${normalizedAccountId}:${digest}`;
  }

  public buildRecoveryKey(
    accountId: string,
    operationType: MessageSendOperationType,
    operationId: string
  ): string | null {
    const operationKey = this.buildOperationKey(
      accountId,
      operationType,
      operationId
    );
    return (
      operationKey?.replace(this.keyPrefix, this.recoveryKeyPrefix) ?? null
    );
  }

  public buildRecoveryRecordKey(
    accountId: string,
    operationType: MessageSendOperationType,
    operationId: string
  ): string | null {
    const operationKey = this.buildOperationKey(
      accountId,
      operationType,
      operationId
    );
    return (
      operationKey?.replace(this.keyPrefix, this.recoveryRecordKeyPrefix) ??
      null
    );
  }

  /**
   * Atomically consumes only due provider invocations from the v4 ZSET. A
   * member is terminalized only while both its state and indexed deadline are
   * still current, so a late success/failure CAS always wins safely.
   */
  public async processProviderInvocationWatchdogBatch(): Promise<IMessageSendProviderWatchdogBatchResult> {
    const raw = await runCriticalRedisOperation(
      'message_send_provider_watchdog',
      () =>
        this.redis.eval(
          PROVIDER_WATCHDOG_BATCH_SCRIPT,
          1,
          this.providerWatchdogKey,
          String(
            MESSAGE_SEND_LEDGER_V4_POLICY.providerInvocationWatchdogBatchSize
          ),
          this.recoveryQueuePrefix,
          this.recoveryWorkersKey
        )
    );
    if (!Array.isArray(raw) || raw.length < 3) {
      throw new Error('message_send_provider_watchdog_invalid_reply');
    }
    const [examined, terminalized, cleaned] = raw.map((value) => Number(value));
    if (
      !Number.isSafeInteger(examined) ||
      examined < 0 ||
      !Number.isSafeInteger(terminalized) ||
      terminalized < 0 ||
      !Number.isSafeInteger(cleaned) ||
      cleaned < 0
    ) {
      throw new Error('message_send_provider_watchdog_invalid_reply');
    }
    return { examined, terminalized, cleaned };
  }

  /**
   * Claims a globally bounded set of durable projection plans. Discovery uses
   * the workers ZSET and the Go-compatible per-worker recovery ZSETs only;
   * it never scans Redis keyspace and it never invokes a provider.
   */
  public async claimGlobalRecoveryBatch(): Promise<
    IMessageSendRecoveryClaim[]
  > {
    const owner = randomUUID();
    const workerLimit = Math.min(
      MESSAGE_SEND_LEDGER_V4_POLICY.recoveryMaxConcurrent,
      MESSAGE_SEND_LEDGER_V4_POLICY.recoveryBatchSize
    );
    const rawWorkers = await runCriticalRedisOperation(
      'message_send_recovery_due_workers',
      () =>
        this.redis.eval(
          DUE_RECOVERY_WORKERS_SCRIPT,
          1,
          this.recoveryWorkersKey,
          String(workerLimit)
        )
    );
    if (!Array.isArray(rawWorkers)) {
      throw new Error('message_send_recovery_workers_invalid_reply');
    }

    const claims: IMessageSendRecoveryClaim[] = [];
    for (const rawWorker of rawWorkers) {
      if (claims.length >= MESSAGE_SEND_LEDGER_V4_POLICY.recoveryBatchSize) {
        break;
      }
      const workerId = this.normalizeRecoveryWorkerId(String(rawWorker ?? ''));
      if (!workerId) {
        await runCriticalRedisOperation(
          'message_send_recovery_invalid_worker_cleanup',
          () =>
            this.redis.zrem(this.recoveryWorkersKey, String(rawWorker ?? ''))
        );
        continue;
      }
      const remaining =
        MESSAGE_SEND_LEDGER_V4_POLICY.recoveryBatchSize - claims.length;
      const raw = await runCriticalRedisOperation(
        'message_send_recovery_claim_batch',
        () =>
          this.redis.eval(
            CLAIM_RECOVERY_BATCH_SCRIPT,
            2,
            this.recoveryQueueKey(workerId),
            this.recoveryWorkersKey,
            workerId,
            owner,
            String(remaining),
            String(MESSAGE_SEND_LEDGER_V4_POLICY.recoveryClaimLeaseMs),
            String(MESSAGE_SEND_LEDGER_V4_POLICY.recoveryRetryDelayMs),
            this.keyPrefix,
            this.recoveryRecordKeyPrefix
          )
      );
      if (!Array.isArray(raw) || raw.length % 9 !== 0) {
        throw new Error('message_send_recovery_claim_invalid_reply');
      }
      for (let index = 0; index < raw.length; index += 9) {
        const ledgerKey = String(raw[index] ?? '');
        const state = String(raw[index + 1] ?? '');
        const operationType = String(raw[index + 2] ?? '');
        const operationId = String(raw[index + 3] ?? '');
        const accountId = String(raw[index + 4] ?? '');
        const planJson = String(raw[index + 5] ?? '');
        const completedJson = String(raw[index + 6] ?? '[]');
        const recoveryRecordKey = String(raw[index + 7] ?? '');
        const storedRecoveryJson = String(raw[index + 8] ?? '');
        const plan = this.parseRecoveryPlanJson(planJson);
        const completedStepIds =
          this.parseCompletedRecoverySteps(completedJson);
        if (
          !this.isTerminalState(state) ||
          !this.isOperationType(operationType) ||
          !plan ||
          plan.worker_id !== workerId ||
          plan.account_id !== accountId ||
          plan.operation_type !== operationType ||
          plan.operation_id !== operationId ||
          plan.terminal_state !== state ||
          this.buildOperationKey(accountId, operationType, operationId) !==
            ledgerKey ||
          !completedStepIds
        ) {
          await this.releaseRawRecoveryClaim(
            ledgerKey,
            recoveryRecordKey,
            workerId,
            owner,
            MESSAGE_SEND_LEDGER_V4_POLICY.recoveryRetryDelayMs
          ).catch(() => undefined);
          continue;
        }
        const recoveryKey = this.buildRecoveryKey(
          accountId,
          operationType,
          operationId
        );
        const recoveryJson =
          storedRecoveryJson ||
          (recoveryKey
            ? await runCriticalRedisOperation(
                'message_send_recovery_payload_read',
                () => this.redis.get(recoveryKey)
              )
            : null);
        let recovery: unknown = null;
        if (recoveryJson) {
          try {
            recovery = JSON.parse(recoveryJson);
          } catch {
            await this.releaseRawRecoveryClaim(
              ledgerKey,
              recoveryRecordKey,
              workerId,
              owner,
              MESSAGE_SEND_LEDGER_V4_POLICY.recoveryRetryDelayMs
            ).catch(() => undefined);
            continue;
          }
        }
        claims.push({
          ledgerKey,
          recoveryRecordKey,
          accountId,
          workerId,
          operationType,
          operationId,
          state,
          recovery,
          plan,
          owner,
          completedStepIds,
        });
      }
    }
    return claims;
  }

  public async markRecoveryStepCompleted(
    claim: IMessageSendRecoveryClaim,
    stepId: string
  ): Promise<MessageSendTransitionStatus> {
    const normalizedStepId = this.normalizeSegment(stepId);
    if (!normalizedStepId || normalizedStepId.length > 128) {
      return 'error';
    }
    const planJson = JSON.stringify(claim.plan);
    const planDigest = createHash('sha256').update(planJson).digest('hex');
    try {
      const raw = await runCriticalRedisOperation(
        'message_send_recovery_step_complete',
        () =>
          this.redis.eval(
            COMPLETE_RECOVERY_STEP_SCRIPT,
            1,
            claim.recoveryRecordKey,
            claim.owner,
            planDigest,
            normalizedStepId
          )
      );
      const status = this.parseTransitionStatus(raw);
      if (status === 'transitioned') {
        claim.completedStepIds = Array.from(
          new Set([...claim.completedStepIds, normalizedStepId])
        );
      }
      return status;
    } catch {
      return 'error';
    }
  }

  public async extendRecoveryClaim(
    claim: IMessageSendRecoveryClaim
  ): Promise<MessageSendTransitionStatus> {
    try {
      const raw = await runCriticalRedisOperation(
        'message_send_recovery_claim_extend',
        () =>
          this.redis.eval(
            EXTEND_RECOVERY_CLAIM_SCRIPT,
            3,
            claim.recoveryRecordKey,
            this.recoveryQueueKey(claim.workerId),
            this.recoveryWorkersKey,
            claim.owner,
            claim.workerId,
            String(MESSAGE_SEND_LEDGER_V4_POLICY.recoveryClaimLeaseMs),
            claim.ledgerKey
          )
      );
      return this.parseTransitionStatus(raw);
    } catch {
      return 'error';
    }
  }

  public async releaseRecoveryClaim(
    claim: IMessageSendRecoveryClaim,
    retryDelayMs = MESSAGE_SEND_LEDGER_V4_POLICY.recoveryRetryDelayMs
  ): Promise<MessageSendTransitionStatus> {
    try {
      const raw = await this.releaseRawRecoveryClaim(
        claim.ledgerKey,
        claim.recoveryRecordKey,
        claim.workerId,
        claim.owner,
        retryDelayMs
      );
      return this.parseTransitionStatus(raw);
    } catch {
      return 'error';
    }
  }

  public async compactRecoveryClaimAfterPubAck(
    claim: IMessageSendRecoveryClaim
  ): Promise<MessageSendTransitionStatus> {
    return this.compactTerminalAfterRecoveryPubAck(
      {
        status: 'duplicate',
        state: claim.state,
        accountId: claim.accountId,
        operationType: claim.operationType,
        operationId: claim.operationId,
        key: claim.ledgerKey,
        owner: null,
        result: claim.recovery,
      },
      claim.state,
      claim.recovery,
      claim.owner
    );
  }

  public async claimOperation(
    input: IMessageSendClaimInput
  ): Promise<MessageSendClaimResult> {
    const accountId = this.normalizeSegment(input.accountId) ?? '';
    const operationId = this.normalizeSegment(input.operationId) ?? '';
    const key = this.buildOperationKey(
      accountId,
      input.operationType,
      operationId
    );
    if (!key) {
      return this.errorClaim(
        accountId,
        input.operationType,
        operationId,
        null,
        'invalid_input'
      );
    }

    const recoveryKey = this.buildRecoveryKey(
      accountId,
      input.operationType,
      operationId
    );
    if (!recoveryKey) {
      return this.errorClaim(
        accountId,
        input.operationType,
        operationId,
        key,
        'invalid_input'
      );
    }

    const owner = randomUUID();
    let metaJson: string;
    try {
      metaJson = input.meta ? JSON.stringify(input.meta) : '';
    } catch {
      return this.errorClaim(
        accountId,
        input.operationType,
        operationId,
        key,
        'invalid_input'
      );
    }
    if (
      Buffer.byteLength(metaJson, 'utf8') >
      MESSAGE_SEND_LEDGER_V4_POLICY.maxMetaBytes
    ) {
      return this.errorClaim(
        accountId,
        input.operationType,
        operationId,
        key,
        'invalid_input'
      );
    }
    const metaDigest = createHash('sha256').update(metaJson).digest('hex');
    const identityDigest = this.immutableIdentityDigest(input.meta);
    const runtimeFenceKey =
      this.normalizeSegment(input.runtimeFenceKey) ??
      `${key}:runtime-fence-unavailable`;
    const reservationLeaseMs = this.normalizeReservationLeaseMs(
      input.reservationLeaseMs
    );

    try {
      const raw = await runCriticalRedisOperation('message_send_claim', () =>
        this.redis.eval(
          CLAIM_SCRIPT,
          4,
          key,
          runtimeFenceKey,
          recoveryKey,
          this.providerWatchdogKey,
          owner,
          String(reservationLeaseMs),
          input.operationType,
          operationId,
          metaJson,
          metaDigest,
          identityDigest
        )
      );
      const [status, rawState, resultJson, compacted] =
        this.parseClaimReply(raw);
      if (status === 'acquired' && rawState === 'reserved') {
        const acquired: IMessageSendAcquiredClaim = {
          status,
          state: rawState,
          accountId,
          operationType: input.operationType,
          operationId,
          key,
          owner,
          result: null,
        };
        if (input.meta) {
          this.acquiredClaimMeta.set(acquired, input.meta);
        }
        return acquired;
      }

      if (status === 'duplicate' && this.isState(rawState)) {
        this.recordTerminalExecutionOutcome(rawState);
        return {
          status,
          state: rawState,
          accountId,
          operationType: input.operationType,
          operationId,
          key,
          owner: null,
          result: this.parseStoredResult(resultJson),
          compacted,
        };
      }
      if (status === 'error' && rawState === 'identity_conflict') {
        return this.errorClaim(
          accountId,
          input.operationType,
          operationId,
          key,
          'identity_conflict'
        );
      }
      return this.errorClaim(
        accountId,
        input.operationType,
        operationId,
        key,
        'invalid_reply'
      );
    } catch {
      return this.errorClaim(
        accountId,
        input.operationType,
        operationId,
        key,
        'redis_unavailable'
      );
    }
  }

  /**
   * Reads an operation without reserving it. This is used before an outer
   * orchestration lease so a durable provider outcome can be recovered even
   * when that lease still names an older delivery attempt.
   */
  public async inspectOperation(
    input: IMessageSendInspectionInput
  ): Promise<MessageSendInspectionResult> {
    const accountId = this.normalizeSegment(input.accountId) ?? '';
    const operationId = this.normalizeSegment(input.operationId) ?? '';
    const key = this.buildOperationKey(
      accountId,
      input.operationType,
      operationId
    );
    if (!key) {
      return this.errorClaim(
        accountId,
        input.operationType,
        operationId,
        null,
        'invalid_input'
      );
    }

    let metaJson: string;
    let compatibleLegacyMetaKeysJson: string;
    try {
      metaJson = input.meta ? JSON.stringify(input.meta) : '';
      compatibleLegacyMetaKeysJson = JSON.stringify(
        this.normalizeCompatibleLegacyMetaKeys(
          input.compatibleLegacyMetaKeys ?? []
        )
      );
    } catch {
      return this.errorClaim(
        accountId,
        input.operationType,
        operationId,
        key,
        'invalid_input'
      );
    }
    const metaDigest = createHash('sha256').update(metaJson).digest('hex');
    const identityDigest = this.immutableIdentityDigest(input.meta);
    const recoveryKey = this.buildRecoveryKey(
      accountId,
      input.operationType,
      operationId
    );
    if (
      !recoveryKey ||
      Buffer.byteLength(metaJson, 'utf8') >
        MESSAGE_SEND_LEDGER_V4_POLICY.maxMetaBytes
    ) {
      return this.errorClaim(
        accountId,
        input.operationType,
        operationId,
        key,
        'invalid_input'
      );
    }

    try {
      const raw = await runCriticalRedisOperation('message_send_inspect', () =>
        this.redis.eval(
          INSPECT_SCRIPT,
          3,
          key,
          recoveryKey,
          this.providerWatchdogKey,
          input.operationType,
          operationId,
          metaJson,
          metaDigest,
          compatibleLegacyMetaKeysJson,
          identityDigest
        )
      );
      const [status, rawState, resultJson, compacted] =
        this.parseClaimReply(raw);
      if (status === 'not_found') {
        return {
          status,
          state: null,
          accountId,
          operationType: input.operationType,
          operationId,
          key,
          owner: null,
          result: null,
        };
      }
      if (status === 'duplicate' && this.isState(rawState)) {
        this.recordTerminalExecutionOutcome(rawState);
        return {
          status,
          state: rawState,
          accountId,
          operationType: input.operationType,
          operationId,
          key,
          owner: null,
          result: this.parseStoredResult(resultJson),
          compacted,
        };
      }
      if (status === 'error' && rawState === 'identity_conflict') {
        return this.errorClaim(
          accountId,
          input.operationType,
          operationId,
          key,
          'identity_conflict'
        );
      }
      return this.errorClaim(
        accountId,
        input.operationType,
        operationId,
        key,
        'invalid_reply'
      );
    } catch {
      return this.errorClaim(
        accountId,
        input.operationType,
        operationId,
        key,
        'redis_unavailable'
      );
    }
  }

  public async markProviderInvoked(
    claim: IMessageSendAcquiredClaim,
    recovery?: unknown,
    providerInvocationLeaseMs = MessageSendIdempotencyService.DEFAULT_PROVIDER_INVOCATION_LEASE_MS
  ): Promise<MessageSendTransitionStatus> {
    return this.transition(
      claim,
      'reserved',
      'provider_invoked',
      recovery,
      '',
      this.normalizeProviderInvocationLeaseMs(providerInvocationLeaseMs)
    );
  }

  /**
   * Reopens the same owner's reservation only when the caller has durably
   * crossed into `provider_invoked` but a final start fence proves that the
   * SDK call has not been scheduled. An uncertain reply must be treated as an
   * uncertain provider outcome by the caller; only `transitioned` proves the
   * operation is safe to handle again as pre-provider work.
   */
  public async revertProviderInvocationBeforeStart(
    claim: IMessageSendAcquiredClaim,
    reservationLeaseMs = MessageSendIdempotencyService.FAST_RECOVERY_RESERVATION_LEASE_MS
  ): Promise<MessageSendTransitionStatus> {
    return this.transition(
      claim,
      'provider_invoked',
      'reserved',
      undefined,
      'provider_start_fence_rejected',
      this.normalizeReservationLeaseMs(reservationLeaseMs)
    );
  }

  public static providerInvocationLeaseMs(providerTimeoutMs: number): number {
    if (!Number.isFinite(providerTimeoutMs) || providerTimeoutMs <= 0) {
      return this.DEFAULT_PROVIDER_INVOCATION_LEASE_MS;
    }
    return Math.min(
      this.MAX_PROVIDER_INVOCATION_LEASE_MS,
      Math.max(
        this.DEFAULT_PROVIDER_INVOCATION_LEASE_MS,
        Math.floor(providerTimeoutMs) +
          this.PROVIDER_INVOCATION_LEASE_PADDING_MS
      )
    );
  }

  public async markSucceeded(
    claim: IMessageSendAcquiredClaim,
    result?: unknown
  ): Promise<MessageSendTransitionStatus> {
    return this.transition(
      claim,
      'provider_invoked',
      'succeeded',
      result,
      '',
      0
    );
  }

  public async markFailed(
    claim: IMessageSendAcquiredClaim,
    error: unknown,
    recovery?: unknown
  ): Promise<MessageSendTransitionStatus> {
    return this.transition(
      claim,
      'reserved',
      'failed',
      recovery,
      this.errorMessage(error),
      0
    );
  }

  public async markExpired(
    claim: IMessageSendAcquiredClaim,
    error: unknown,
    recovery?: unknown
  ): Promise<MessageSendTransitionStatus> {
    return this.transition(
      claim,
      'reserved',
      'expired',
      recovery,
      this.errorMessage(error),
      0
    );
  }

  public async markProviderRejected(
    claim: IMessageSendAcquiredClaim,
    error: unknown,
    recovery?: unknown
  ): Promise<MessageSendTransitionStatus> {
    return this.transition(
      claim,
      'provider_invoked',
      'failed',
      recovery,
      this.errorMessage(error),
      0
    );
  }

  public async markAmbiguous(
    claim: IMessageSendAcquiredClaim,
    error: unknown,
    recovery?: unknown
  ): Promise<MessageSendTransitionStatus> {
    return this.transition(
      claim,
      'provider_invoked',
      'ambiguous',
      recovery,
      this.errorMessage(error),
      0
    );
  }

  public async releaseReservation(
    claim: IMessageSendAcquiredClaim
  ): Promise<MessageSendTransitionStatus> {
    try {
      const result = await runCriticalRedisOperation(
        'message_send_release',
        () =>
          this.redis.eval(
            RELEASE_SCRIPT,
            3,
            claim.key,
            this.recoveryKeyForClaim(claim),
            this.providerWatchdogKey,
            claim.owner
          )
      );
      return this.parseTransitionStatus(result);
    } catch {
      return 'error';
    }
  }

  /**
   * Migrates a v3 provider outcome written before recoverable result payloads
   * existed (or an otherwise unreadable result) into a durable ambiguous
   * terminal record. This CAS never invokes the provider and never relies on
   * the former owner: provider_invoked/ambiguous records cannot be acquired by
   * a new sender. Exact operation and metadata correlation prevents a reused
   * operation id from adopting another message's outcome.
   */
  public async recoverLegacyAmbiguous(
    claim: IMessageSendDuplicateClaim,
    recovery: unknown,
    expectedMeta: Record<string, unknown>,
    compatibleLegacyMetaKeys: string[] = []
  ): Promise<MessageSendLegacyAmbiguousRecoveryStatus> {
    if (claim.state !== 'provider_invoked' && claim.state !== 'ambiguous') {
      return 'invalid_state';
    }
    const expectedKey = this.buildOperationKey(
      claim.accountId,
      claim.operationType,
      claim.operationId
    );
    if (!expectedKey || expectedKey !== claim.key) {
      return 'identity_conflict';
    }

    let resultJson: string | undefined;
    let expectedMetaJson: string | undefined;
    let compatibleLegacyMetaKeysJson: string | undefined;
    try {
      resultJson = JSON.stringify(recovery);
      expectedMetaJson = JSON.stringify(expectedMeta);
      compatibleLegacyMetaKeysJson = JSON.stringify(
        this.normalizeCompatibleLegacyMetaKeys(compatibleLegacyMetaKeys)
      );
    } catch {
      return 'error';
    }
    if (
      !resultJson ||
      !expectedMetaJson ||
      !compatibleLegacyMetaKeysJson ||
      Buffer.byteLength(expectedMetaJson, 'utf8') >
        MESSAGE_SEND_LEDGER_V4_POLICY.maxMetaBytes ||
      Buffer.byteLength(resultJson, 'utf8') >
        MESSAGE_SEND_LEDGER_V4_POLICY.maxRecoveryBytes
    ) {
      return 'error';
    }

    const expectedMetaDigest = createHash('sha256')
      .update(expectedMetaJson)
      .digest('hex');
    const identityDigest = this.immutableIdentityDigest(expectedMeta);
    const outcomeDigest = createHash('sha256')
      .update(
        ['legacy_recovery', 'ambiguous', resultJson].join(
          String.fromCharCode(0)
        )
      )
      .digest('hex');
    const recoveryDigest = createHash('sha256')
      .update(resultJson)
      .digest('hex');
    const recoveryPlan = buildMessageSendRecoveryPlan({
      accountId: claim.accountId,
      operationType: claim.operationType,
      operationId: claim.operationId,
      expectedState: claim.state,
      targetState: 'ambiguous',
      recovery,
      meta: expectedMeta,
      lane: currentWorkerCommandExecutionIdentity(),
    });
    let recoveryPlanJson = '';
    try {
      recoveryPlanJson = recoveryPlan ? JSON.stringify(recoveryPlan) : '';
    } catch {
      return 'error';
    }
    if (
      Buffer.byteLength(recoveryPlanJson, 'utf8') >
      MESSAGE_SEND_LEDGER_V4_POLICY.maxRecoveryBytes
    ) {
      return 'error';
    }
    const recoveryPlanDigest = createHash('sha256')
      .update(recoveryPlanJson)
      .digest('hex');

    try {
      const result = await runCriticalRedisOperation(
        'message_send_recover_legacy_ambiguous',
        () =>
          this.redis.eval(
            RECOVER_LEGACY_AMBIGUOUS_SCRIPT,
            4,
            claim.key,
            this.recoveryKeyForClaim(claim),
            this.providerWatchdogKey,
            this.recoveryRecordKeyForClaim(claim),
            claim.operationType,
            claim.operationId,
            expectedMetaJson,
            expectedMetaDigest,
            resultJson,
            outcomeDigest,
            identityDigest,
            compatibleLegacyMetaKeysJson,
            recoveryDigest,
            recoveryPlanJson,
            recoveryPlanDigest,
            this.recoveryQueuePrefix,
            this.recoveryWorkersKey
          )
      );
      return this.parseLegacyAmbiguousRecoveryStatus(result);
    } catch {
      return 'error';
    }
  }

  public async claimSend(
    accountId: string,
    operationId: string,
    meta?: Record<string, unknown>
  ): Promise<MessageSendClaimStatus> {
    const result = await this.claimOperation({
      accountId,
      operationType: 'direct',
      operationId,
      meta,
    });
    return result.status;
  }

  public async lookupClaim(
    accountId: string,
    operationId: string
  ): Promise<MessageSendLookupStatus> {
    const key = this.buildOperationKey(accountId, 'direct', operationId);
    if (!key) {
      return 'error';
    }

    try {
      return (await runCriticalRedisOperation('message_send_lookup', () =>
        this.redis.exists(key)
      )) === 1
        ? 'claimed'
        : 'not_found';
    } catch {
      return 'error';
    }
  }

  /**
   * Called only after the global projection event received its broker ack.
   * The terminal identity/digests remain until their absolute state TTL, while
   * the potentially large recovery payload is released immediately.
   */
  public async compactTerminalAfterRecoveryPubAck(
    claim: IMessageSendAcquiredClaim | IMessageSendDuplicateClaim,
    expectedState: MessageSendTerminalState,
    expectedRecovery: unknown,
    recoveryClaimOwner = ''
  ): Promise<MessageSendTransitionStatus> {
    let expectedRecoveryJson: string;
    try {
      expectedRecoveryJson =
        expectedRecovery === undefined || expectedRecovery === null
          ? ''
          : JSON.stringify(expectedRecovery);
    } catch {
      return 'error';
    }
    if (
      Buffer.byteLength(expectedRecoveryJson, 'utf8') >
      MESSAGE_SEND_LEDGER_V4_POLICY.maxRecoveryBytes
    ) {
      return 'error';
    }
    const expectedRecoveryDigest = createHash('sha256')
      .update(expectedRecoveryJson)
      .digest('hex');
    try {
      await this.terminalizeCurrentWorkerCommandLane(claim, expectedState);
      const raw = await runCriticalRedisOperation(
        'message_send_compact_terminal',
        () =>
          this.redis.eval(
            COMPACT_TERMINAL_SCRIPT,
            4,
            claim.key,
            this.recoveryKeyForClaim(claim),
            this.providerWatchdogKey,
            this.recoveryRecordKeyForClaim(claim),
            claim.operationType,
            claim.operationId,
            expectedState,
            expectedRecoveryJson,
            expectedRecoveryDigest,
            recoveryClaimOwner,
            this.recoveryQueuePrefix,
            this.recoveryWorkersKey
          )
      );
      return this.parseTransitionStatus(raw);
    } catch {
      return 'error';
    }
  }

  private async transition(
    claim: IMessageSendAcquiredClaim,
    expectedState: MessageSendIdempotencyState,
    targetState: MessageSendIdempotencyState,
    result: unknown,
    error: string,
    leaseDurationMs: number
  ): Promise<MessageSendTransitionStatus> {
    let resultJson = '';
    try {
      if (result !== undefined && result !== null) {
        resultJson = JSON.stringify(result);
      }
    } catch {
      return 'error';
    }

    if (
      Buffer.byteLength(resultJson, 'utf8') >
      MESSAGE_SEND_LEDGER_V4_POLICY.maxRecoveryBytes
    ) {
      return 'error';
    }
    const normalizedError = this.errorMessage(error);
    const recoveryPlan = buildMessageSendRecoveryPlan({
      accountId: claim.accountId,
      operationType: claim.operationType,
      operationId: claim.operationId,
      expectedState,
      targetState,
      recovery: result,
      meta: this.acquiredClaimMeta.get(claim),
      lane: currentWorkerCommandExecutionIdentity(),
    });
    let recoveryPlanJson = '';
    try {
      recoveryPlanJson = recoveryPlan ? JSON.stringify(recoveryPlan) : '';
    } catch {
      return 'error';
    }
    if (
      Buffer.byteLength(recoveryPlanJson, 'utf8') >
      MESSAGE_SEND_LEDGER_V4_POLICY.maxRecoveryBytes
    ) {
      return 'error';
    }
    const recoveryPlanDigest = createHash('sha256')
      .update(recoveryPlanJson)
      .digest('hex');
    const recoveryDigest = createHash('sha256')
      .update(resultJson)
      .digest('hex');
    const outcomeDigest = createHash('sha256')
      .update(
        [expectedState, targetState, resultJson, normalizedError].join(
          String.fromCharCode(0)
        )
      )
      .digest('hex');
    try {
      const raw = await runCriticalRedisOperation(
        `message_send_transition_${targetState}`,
        () =>
          this.redis.eval(
            TRANSITION_SCRIPT,
            4,
            claim.key,
            this.recoveryKeyForClaim(claim),
            this.providerWatchdogKey,
            this.recoveryRecordKeyForClaim(claim),
            claim.owner,
            expectedState,
            targetState,
            String(leaseDurationMs),
            resultJson,
            normalizedError,
            outcomeDigest,
            recoveryDigest,
            recoveryPlanJson,
            recoveryPlanDigest,
            this.recoveryQueuePrefix,
            this.recoveryWorkersKey
          )
      );
      const status = this.parseTransitionStatus(raw);
      if (status === 'transitioned') {
        this.recordTerminalExecutionOutcome(targetState);
      }
      return status;
    } catch {
      return 'error';
    }
  }

  private recordTerminalExecutionOutcome(
    state: MessageSendIdempotencyState
  ): void {
    if (
      state === 'succeeded' ||
      state === 'failed' ||
      state === 'expired' ||
      state === 'ambiguous'
    ) {
      recordWorkerCommandExecutionOutcome(state);
    }
  }

  private normalizeSegment(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  private async terminalizeCurrentWorkerCommandLane(
    claim: Pick<
      IMessageSendAcquiredClaim | IMessageSendDuplicateClaim,
      'accountId' | 'operationId'
    >,
    state: MessageSendTerminalState
  ): Promise<void> {
    const lane = currentWorkerCommandExecutionIdentity();
    if (!lane) return;
    if (
      lane.accountId !== claim.accountId ||
      lane.operationId !== claim.operationId
    ) {
      throw new Error('message_send_recovery_lane_identity_mismatch');
    }
    await new WorkerCommandLaneService(this.redis).markTerminal(
      lane.accountId,
      lane.workerId,
      lane.entityKey,
      lane.operationId,
      lane.commandId,
      state,
      state === 'succeeded' ? '' : state
    );
  }

  private normalizeRecoveryWorkerId(value: unknown): string | null {
    const workerId = this.normalizeSegment(value);
    return workerId && /^[A-Za-z0-9._-]{1,128}$/u.test(workerId)
      ? workerId
      : null;
  }

  private recoveryQueueKey(workerId: string): string {
    const normalized = this.normalizeRecoveryWorkerId(workerId);
    if (!normalized) {
      throw new Error('message_send_recovery_worker_invalid');
    }
    return `${this.recoveryQueuePrefix}${normalized}`;
  }

  private parseRecoveryPlanJson(
    value: string
  ): MessageSendRecoveryPlanV1 | null {
    try {
      return parseMessageSendRecoveryPlan(JSON.parse(value));
    } catch {
      return null;
    }
  }

  private parseCompletedRecoverySteps(value: string): string[] | null {
    try {
      const parsed: unknown = JSON.parse(value);
      if (
        !Array.isArray(parsed) ||
        parsed.length > 8 ||
        parsed.some(
          (entry) =>
            typeof entry !== 'string' ||
            entry.trim().length === 0 ||
            entry.length > 128
        )
      ) {
        return null;
      }
      return Array.from(new Set(parsed));
    } catch {
      return null;
    }
  }

  private async releaseRawRecoveryClaim(
    ledgerKey: string,
    recoveryRecordKey: string,
    workerId: string,
    owner: string,
    retryDelayMs: number
  ): Promise<unknown> {
    const normalizedDelay = Number.isFinite(retryDelayMs)
      ? Math.min(5 * 60 * 1000, Math.max(1000, Math.floor(retryDelayMs)))
      : MESSAGE_SEND_LEDGER_V4_POLICY.recoveryRetryDelayMs;
    return runCriticalRedisOperation('message_send_recovery_release', () =>
      this.redis.eval(
        RELEASE_RECOVERY_CLAIM_SCRIPT,
        3,
        recoveryRecordKey,
        this.recoveryQueueKey(workerId),
        this.recoveryWorkersKey,
        owner,
        workerId,
        String(normalizedDelay),
        ledgerKey
      )
    );
  }

  private recoveryKeyForClaim(
    claim: Pick<
      IMessageSendAcquiredClaim | IMessageSendDuplicateClaim,
      'accountId' | 'operationType' | 'operationId'
    >
  ): string {
    const key = this.buildRecoveryKey(
      claim.accountId,
      claim.operationType,
      claim.operationId
    );
    if (!key) {
      throw new Error('message_send_recovery_key_invalid');
    }
    return key;
  }

  private recoveryRecordKeyForClaim(
    claim: Pick<
      IMessageSendAcquiredClaim | IMessageSendDuplicateClaim,
      'accountId' | 'operationType' | 'operationId'
    >
  ): string {
    const key = this.buildRecoveryRecordKey(
      claim.accountId,
      claim.operationType,
      claim.operationId
    );
    if (!key) {
      throw new Error('message_send_recovery_record_key_invalid');
    }
    return key;
  }

  private normalizeReservationLeaseMs(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      return MessageSendIdempotencyService.FAST_RECOVERY_RESERVATION_LEASE_MS;
    }
    return Math.min(
      MessageSendIdempotencyService.LEASE_MS,
      Math.max(5_000, Math.floor(value))
    );
  }

  private normalizeProviderInvocationLeaseMs(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      return MessageSendIdempotencyService.DEFAULT_PROVIDER_INVOCATION_LEASE_MS;
    }
    return Math.min(
      MessageSendIdempotencyService.MAX_PROVIDER_INVOCATION_LEASE_MS,
      Math.max(
        MessageSendIdempotencyService.DEFAULT_PROVIDER_INVOCATION_LEASE_MS,
        Math.floor(value)
      )
    );
  }

  private errorClaim(
    accountId: string,
    operationType: MessageSendOperationType,
    operationId: string,
    key: string | null,
    reason: MessageSendClaimErrorReason
  ): IMessageSendErrorClaim {
    return {
      status: 'error',
      reason,
      state: null,
      accountId,
      operationType,
      operationId,
      key,
      owner: null,
      result: null,
    };
  }

  private parseClaimReply(raw: unknown): [string, string, string, boolean] {
    if (!Array.isArray(raw)) {
      return ['', '', '', false];
    }
    return [
      String(raw[0] ?? ''),
      String(raw[1] ?? ''),
      String(raw[2] ?? ''),
      String(raw[3] ?? '') === '1',
    ];
  }

  private parseStoredResult(value: string): unknown | null {
    if (!value) {
      return null;
    }
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  private parseTransitionStatus(raw: unknown): MessageSendTransitionStatus {
    const value = String(raw ?? '');
    if (
      value === 'transitioned' ||
      value === 'invalid_state' ||
      value === 'owner_mismatch' ||
      value === 'not_found'
    ) {
      return value;
    }
    return 'error';
  }

  private parseLegacyAmbiguousRecoveryStatus(
    raw: unknown
  ): MessageSendLegacyAmbiguousRecoveryStatus {
    const value = String(raw ?? '');
    if (
      value === 'transitioned' ||
      value === 'identity_conflict' ||
      value === 'invalid_state' ||
      value === 'not_found'
    ) {
      return value;
    }
    return 'error';
  }

  private isState(value: string): value is MessageSendIdempotencyState {
    return (
      value === 'reserved' ||
      value === 'provider_invoked' ||
      value === 'succeeded' ||
      value === 'failed' ||
      value === 'expired' ||
      value === 'ambiguous'
    );
  }

  private isTerminalState(value: string): value is MessageSendTerminalState {
    return (
      value === 'succeeded' ||
      value === 'failed' ||
      value === 'expired' ||
      value === 'ambiguous'
    );
  }

  private isOperationType(value: string): value is MessageSendOperationType {
    return (
      value === 'direct' ||
      value === 'schedule' ||
      value === 'notification' ||
      value === 'notification_email'
    );
  }

  private normalizeCompatibleLegacyMetaKeys(values: string[]): string[] {
    return Array.from(
      new Set(
        values
          .map((value) => value.trim())
          .filter((value) => /^[a-z0-9_]{1,64}$/i.test(value))
      )
    ).sort();
  }

  private immutableIdentityDigest(
    meta: Record<string, unknown> | undefined
  ): string {
    const fields = [
      'provider',
      'account_id',
      'chat_id',
      'message_id',
      'worker_id',
      'schedule_id',
      'contact_id',
      'notification_id',
      'destination',
    ] as const;
    const canonical = fields.map((field) => String(meta?.[field] ?? ''));
    return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
  }

  private errorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    if (
      Buffer.byteLength(message, 'utf8') <=
      MESSAGE_SEND_LEDGER_V4_POLICY.maxErrorBytes
    ) {
      return message;
    }
    let value = message;
    while (
      value.length > 0 &&
      Buffer.byteLength(value, 'utf8') >
        MESSAGE_SEND_LEDGER_V4_POLICY.maxErrorBytes
    ) {
      value = value.slice(0, Math.max(0, value.length - 32));
    }
    return value;
  }
}
