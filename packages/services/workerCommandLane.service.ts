import { createHash } from 'node:crypto';
import { inject, injectable } from 'tsyringe';
import Redis from 'ioredis';
import { runCriticalRedisOperation } from '@core/common/functions/criticalRedisOperation';

export const WORKER_COMMAND_LANE_POLICY = Object.freeze({
  cursorTtlSeconds: 15 * 60,
  commandDeadlineMs: 5 * 60 * 1000,
  identityRetentionMs: 5 * 60 * 1000,
  maxEntityKeyBytes: 1024,
});

export type WorkerCommandLaneTerminalState =
  'succeeded' | 'failed' | 'expired' | 'ambiguous';
export type WorkerCommandLaneClaimDisposition =
  | 'acquired'
  | 'busy'
  | 'duplicate'
  | `duplicate:${WorkerCommandLaneTerminalState}:${string}`;

export interface WorkerCommandLaneAllocation {
  existing: boolean;
  commandId: string;
  entitySequence: number;
  predecessorOperationId: string | null;
  issuedAt: Date;
  originEpoch: string;
}

const ALLOCATE_LANE_SCRIPT = `
local key = KEYS[1]
local operation_index = KEYS[2]
local operation_id = ARGV[1]
local operation_digest = ARGV[2]
local issued_at_ms = ARGV[3]
local command_id = ARGV[4]
local ttl_seconds = tonumber(ARGV[5])
local origin_epoch = ARGV[6]
local payload_digest = ARGV[7]
local command_type = ARGV[8]
local identity_retention_ms = tonumber(ARGV[9])
local function dependencies_terminal(operation_digest)
  local cursor = operation_digest
  for _ = 1, 256 do
    if (redis.call('HGET', key, 'op:' .. cursor .. ':predecessor_satisfied') or '') == '1' then
      return true
    end
    local dependency_id = redis.call('HGET', key, 'op:' .. cursor .. ':predecessor') or ''
    if dependency_id == '' then return true end
    local dependency_digest = redis.call('HGET', key, 'op:' .. cursor .. ':predecessor_digest') or ''
    if dependency_digest == '' or
       (redis.call('HGET', key, 'op:' .. dependency_digest .. ':operation_id') or '') ~= dependency_id or
       (redis.call('HGET', key, 'op:' .. dependency_digest .. ':terminal') or '') == '' then
      return false
    end
    cursor = dependency_digest
  end
  return false
end
local seq_field = 'op:' .. operation_digest .. ':sequence'
local existing_sequence = redis.call('HGET', key, seq_field)
if existing_sequence then
  local predecessor = redis.call('HGET', key, 'op:' .. operation_digest .. ':predecessor') or ''
  local existing_issued_at_ms = redis.call('HGET', key, 'op:' .. operation_digest .. ':issued_at_ms') or ''
  local existing_command_id = redis.call('HGET', key, 'op:' .. operation_digest .. ':command_id') or ''
  local existing_origin_epoch = redis.call('HGET', key, 'op:' .. operation_digest .. ':origin_epoch') or ''
  local existing_payload_digest = redis.call('HGET', key, 'op:' .. operation_digest .. ':payload_digest') or ''
  local existing_command_type = redis.call('HGET', key, 'op:' .. operation_digest .. ':command_type') or ''
  return { 'existing', existing_sequence, predecessor, existing_issued_at_ms, existing_command_id, existing_origin_epoch, existing_payload_digest, existing_command_type }
end
local redis_time = redis.call('TIME')
local now_ms = tonumber(redis_time[1]) * 1000 + math.floor(tonumber(redis_time[2]) / 1000)
local cleanup = redis.call('ZRANGEBYSCORE', operation_index, '-inf', now_ms - identity_retention_ms, 'LIMIT', 0, 100)
local last_digest = redis.call('HGET', key, 'last_operation_digest') or ''
for _, digest in ipairs(cleanup) do
  local terminal = redis.call('HGET', key, 'op:' .. digest .. ':terminal') or ''
  local active_until_ms = tonumber(redis.call('HGET', key, 'op:' .. digest .. ':active_until_ms') or '0')
  if digest ~= last_digest and terminal ~= '' and active_until_ms <= now_ms and
     dependencies_terminal(digest) then
    local operation_id = redis.call('HGET', key, 'op:' .. digest .. ':operation_id') or ''
    local successor_digest = redis.call('HGET', key, 'op:' .. digest .. ':successor_digest') or ''
    if successor_digest ~= '' and
       (redis.call('HGET', key, 'op:' .. successor_digest .. ':predecessor') or '') == operation_id and
       (redis.call('HGET', key, 'op:' .. successor_digest .. ':predecessor_digest') or '') == digest then
      redis.call('HSET', key, 'op:' .. successor_digest .. ':predecessor_satisfied', '1')
    end
    redis.call('HDEL', key,
      'op:' .. digest .. ':sequence',
      'op:' .. digest .. ':operation_id',
      'op:' .. digest .. ':predecessor',
      'op:' .. digest .. ':predecessor_digest',
      'op:' .. digest .. ':issued_at_ms',
      'op:' .. digest .. ':command_id',
      'op:' .. digest .. ':origin_epoch',
      'op:' .. digest .. ':payload_digest',
      'op:' .. digest .. ':command_type',
      'op:' .. digest .. ':predecessor_satisfied',
      'op:' .. digest .. ':active_command_id',
      'op:' .. digest .. ':active_until_ms',
      'op:' .. digest .. ':ever_active',
      'op:' .. digest .. ':technical_retry_count',
      'op:' .. digest .. ':terminal',
      'op:' .. digest .. ':terminal_at_ms',
      'op:' .. digest .. ':terminal_failure_code',
      'op:' .. digest .. ':successor_digest')
    redis.call('ZREM', operation_index, digest)
  end
end
local sequence = redis.call('HINCRBY', key, 'sequence', 1)
local predecessor = redis.call('HGET', key, 'last_operation_id') or ''
local predecessor_digest = redis.call('HGET', key, 'last_operation_digest') or ''
redis.call('HSET', key,
  seq_field, tostring(sequence),
  'op:' .. operation_digest .. ':operation_id', operation_id,
  'op:' .. operation_digest .. ':predecessor', predecessor,
  'op:' .. operation_digest .. ':predecessor_digest', predecessor_digest,
  'op:' .. operation_digest .. ':issued_at_ms', issued_at_ms,
  'op:' .. operation_digest .. ':command_id', command_id,
  'op:' .. operation_digest .. ':origin_epoch', origin_epoch,
  'op:' .. operation_digest .. ':payload_digest', payload_digest,
  'op:' .. operation_digest .. ':command_type', command_type,
  'last_operation_id', operation_id,
  'last_operation_digest', operation_digest,
  'updated_at_ms', issued_at_ms)
if predecessor_digest ~= '' then
  redis.call('HSET', key, 'op:' .. predecessor_digest .. ':successor_digest', operation_digest)
end
if predecessor_digest ~= '' and
   (redis.call('HGET', key, 'op:' .. predecessor_digest .. ':terminal') or '') ~= '' and
   dependencies_terminal(predecessor_digest) then
  redis.call('HSET', key, 'op:' .. operation_digest .. ':predecessor_satisfied', '1')
end
redis.call('ZADD', operation_index, issued_at_ms, operation_digest)
redis.call('EXPIRE', key, ttl_seconds)
redis.call('EXPIRE', operation_index, ttl_seconds)
return { 'created', tostring(sequence), predecessor, issued_at_ms, command_id, origin_epoch, payload_digest, command_type }
`;

const ASSERT_PREDECESSOR_SCRIPT = `
local key = KEYS[1]
local operation_index = KEYS[2]
local predecessor_id = ARGV[1]
local predecessor_digest = ARGV[2]
local deadline_ms = tonumber(ARGV[3])
local current_digest = ARGV[4]
local ttl_seconds = tonumber(ARGV[5])
local function dependencies_terminal(operation_digest)
  local cursor = operation_digest
  for _ = 1, 256 do
    if (redis.call('HGET', key, 'op:' .. cursor .. ':predecessor_satisfied') or '') == '1' then
      return true
    end
    local dependency_id = redis.call('HGET', key, 'op:' .. cursor .. ':predecessor') or ''
    if dependency_id == '' then return true end
    local dependency_digest = redis.call('HGET', key, 'op:' .. cursor .. ':predecessor_digest') or ''
    if dependency_digest == '' or
       (redis.call('HGET', key, 'op:' .. dependency_digest .. ':operation_id') or '') ~= dependency_id or
       (redis.call('HGET', key, 'op:' .. dependency_digest .. ':terminal') or '') == '' then
      return false
    end
    cursor = dependency_digest
  end
  return false
end
if predecessor_id == '' then return {'ready', ''} end
if (redis.call('HGET', key, 'op:' .. current_digest .. ':predecessor_satisfied') or '') == '1' then
  return {'ready', 'already_satisfied'}
end
local operation_id = redis.call('HGET', key, 'op:' .. predecessor_digest .. ':operation_id') or ''
if operation_id ~= predecessor_id then
  return {'waiting', 'predecessor_identity_missing'}
end
local terminal = redis.call('HGET', key, 'op:' .. predecessor_digest .. ':terminal') or ''
if terminal ~= '' then
  if not dependencies_terminal(predecessor_digest) then
    return {'waiting', 'predecessor_dependency_pending'}
  end
  redis.call('HSET', key, 'op:' .. current_digest .. ':predecessor_satisfied', '1')
  redis.call('EXPIRE', key, ttl_seconds)
  redis.call('EXPIRE', operation_index, ttl_seconds)
  return {'ready', terminal}
end
-- Admission allocates the lane identity before the broker PubAck. If a
-- process dies before publish, this predecessor can never be delivered. It is
-- safe to expire only an operation which has never acquired the execution
-- lane; an ever-active operation is resolved by the provider ledger/watchdog.
local ever_active = redis.call('HGET', key, 'op:' .. predecessor_digest .. ':ever_active') or ''
local issued_at_ms = tonumber(redis.call('HGET', key, 'op:' .. predecessor_digest .. ':issued_at_ms') or '0')
local redis_time = redis.call('TIME')
local now_ms = tonumber(redis_time[1]) * 1000 + math.floor(tonumber(redis_time[2]) / 1000)
if ever_active == '' and issued_at_ms > 0 and now_ms >= issued_at_ms + deadline_ms and
   dependencies_terminal(predecessor_digest) then
  redis.call('HSET', key,
    'op:' .. predecessor_digest .. ':terminal', 'expired',
    'op:' .. predecessor_digest .. ':terminal_at_ms', tostring(now_ms),
    'op:' .. predecessor_digest .. ':predecessor_satisfied', '1')
  redis.call('ZADD', operation_index, now_ms, predecessor_digest)
  redis.call('HSET', key, 'op:' .. current_digest .. ':predecessor_satisfied', '1')
  redis.call('EXPIRE', key, ttl_seconds)
  redis.call('EXPIRE', operation_index, ttl_seconds)
  return {'ready', 'expired'}
end
if not dependencies_terminal(predecessor_digest) then
  return {'waiting', 'predecessor_dependency_pending'}
end
if ever_active ~= '' then
  return {'waiting', 'predecessor_ever_active'}
end
return {'waiting', 'predecessor_never_active'}
`;

const MARK_LANE_ACTIVE_SCRIPT = `
local key = KEYS[1]
local operation_index = KEYS[2]
local operation_digest = ARGV[1]
local operation_id = ARGV[2]
local command_id = ARGV[3]
local active_lease_ms = tonumber(ARGV[4])
local ttl_seconds = tonumber(ARGV[5])
local redis_time = redis.call('TIME')
local now_ms = tonumber(redis_time[1]) * 1000 + math.floor(tonumber(redis_time[2]) / 1000)
if redis.call('HEXISTS', key, 'op:' .. operation_digest .. ':sequence') == 0 then
  return 'busy'
end
if (redis.call('HGET', key, 'op:' .. operation_digest .. ':operation_id') or '') ~= operation_id or
   (redis.call('HGET', key, 'op:' .. operation_digest .. ':command_id') or '') ~= command_id then
  return 'busy'
end
local terminal = redis.call('HGET', key, 'op:' .. operation_digest .. ':terminal') or ''
if terminal ~= '' then
  local failure_code = redis.call('HGET', key, 'op:' .. operation_digest .. ':terminal_failure_code') or ''
  return 'duplicate:' .. terminal .. ':' .. failure_code
end
local active_until_ms = tonumber(redis.call('HGET', key, 'op:' .. operation_digest .. ':active_until_ms') or '0')
if active_until_ms > now_ms then return 'busy' end
redis.call('HSET', key,
  'updated_at_ms', tostring(now_ms),
  'op:' .. operation_digest .. ':ever_active', '1',
  'op:' .. operation_digest .. ':active_command_id', command_id,
  'op:' .. operation_digest .. ':active_until_ms', tostring(now_ms + active_lease_ms))
redis.call('EXPIRE', key, ttl_seconds)
redis.call('EXPIRE', operation_index, ttl_seconds)
return 'acquired'
`;

const RENEW_LANE_ACTIVE_SCRIPT = `
local key = KEYS[1]
local operation_index = KEYS[2]
local operation_digest = ARGV[1]
local command_id = ARGV[2]
local active_lease_ms = tonumber(ARGV[3])
local ttl_seconds = tonumber(ARGV[4])
local redis_time = redis.call('TIME')
local now_ms = tonumber(redis_time[1]) * 1000 + math.floor(tonumber(redis_time[2]) / 1000)
if (redis.call('HGET', key, 'op:' .. operation_digest .. ':active_command_id') or '') ~= command_id or
   (redis.call('HGET', key, 'op:' .. operation_digest .. ':terminal') or '') ~= '' then
  return 0
end
redis.call('HSET', key,
  'updated_at_ms', tostring(now_ms),
  'op:' .. operation_digest .. ':active_until_ms', tostring(now_ms + active_lease_ms))
redis.call('EXPIRE', key, ttl_seconds)
redis.call('EXPIRE', operation_index, ttl_seconds)
return 1
`;

const RELEASE_LANE_ACTIVE_SCRIPT = `
local key = KEYS[1]
local operation_index = KEYS[2]
local operation_digest = ARGV[1]
local command_id = ARGV[2]
local ttl_seconds = tonumber(ARGV[3])
if (redis.call('HGET', key, 'op:' .. operation_digest .. ':active_command_id') or '') ~= command_id or
   (redis.call('HGET', key, 'op:' .. operation_digest .. ':terminal') or '') ~= '' then
  return 0
end
redis.call('HDEL', key,
  'op:' .. operation_digest .. ':active_command_id',
  'op:' .. operation_digest .. ':active_until_ms')
redis.call('EXPIRE', key, ttl_seconds)
redis.call('EXPIRE', operation_index, ttl_seconds)
return 1
`;

const RECORD_TECHNICAL_RETRY_SCRIPT = `
local key = KEYS[1]
local operation_index = KEYS[2]
local operation_digest = ARGV[1]
local operation_id = ARGV[2]
local command_id = ARGV[3]
local ttl_seconds = tonumber(ARGV[4])
if (redis.call('HGET', key, 'op:' .. operation_digest .. ':operation_id') or '') ~= operation_id or
   (redis.call('HGET', key, 'op:' .. operation_digest .. ':command_id') or '') ~= command_id or
   (redis.call('HGET', key, 'op:' .. operation_digest .. ':terminal') or '') ~= '' then
  return -1
end
local count = redis.call('HINCRBY', key, 'op:' .. operation_digest .. ':technical_retry_count', 1)
local redis_time = redis.call('TIME')
local now_ms = tostring(tonumber(redis_time[1]) * 1000 + math.floor(tonumber(redis_time[2]) / 1000))
redis.call('HSET', key, 'updated_at_ms', now_ms)
redis.call('EXPIRE', key, ttl_seconds)
redis.call('EXPIRE', operation_index, ttl_seconds)
return count
`;

const MARK_LANE_TERMINAL_SCRIPT = `
local key = KEYS[1]
local operation_index = KEYS[2]
local operation_id = ARGV[1]
local operation_digest = ARGV[2]
local terminal_state = ARGV[3]
local ttl_seconds = tonumber(ARGV[4])
local command_id = ARGV[5]
local failure_code = ARGV[6]
local redis_time = redis.call('TIME')
local now_ms_number = tonumber(redis_time[1]) * 1000 + math.floor(tonumber(redis_time[2]) / 1000)
local now_ms = tostring(now_ms_number)
local stored_operation_id = redis.call('HGET', key, 'op:' .. operation_digest .. ':operation_id') or ''
if stored_operation_id ~= operation_id then return 0 end
if (redis.call('HGET', key, 'op:' .. operation_digest .. ':command_id') or '') ~= command_id then return 0 end
local existing_terminal = redis.call('HGET', key, 'op:' .. operation_digest .. ':terminal') or ''
if existing_terminal ~= '' then
  if existing_terminal == terminal_state then return 2 end
  return -1
end
local active_command_id = redis.call('HGET', key, 'op:' .. operation_digest .. ':active_command_id') or ''
if active_command_id ~= '' and active_command_id ~= command_id then return 0 end
if active_command_id == '' and terminal_state ~= 'failed' and terminal_state ~= 'expired' then return 0 end
redis.call('HSET', key,
  'op:' .. operation_digest .. ':terminal', terminal_state,
  'op:' .. operation_digest .. ':terminal_at_ms', now_ms,
  'updated_at_ms', now_ms)
if failure_code ~= '' then
  redis.call('HSET', key, 'op:' .. operation_digest .. ':terminal_failure_code', failure_code)
else
  redis.call('HDEL', key, 'op:' .. operation_digest .. ':terminal_failure_code')
end
redis.call('HDEL', key,
  'op:' .. operation_digest .. ':active_command_id',
  'op:' .. operation_digest .. ':active_until_ms')
redis.call('ZADD', operation_index, now_ms_number, operation_digest)
redis.call('EXPIRE', key, ttl_seconds)
redis.call('EXPIRE', operation_index, ttl_seconds)
return 1
`;

const EXPIRE_NEVER_ACTIVE_SCRIPT = `
local key = KEYS[1]
local operation_index = KEYS[2]
local operation_digest = ARGV[1]
local operation_id = ARGV[2]
local ttl_seconds = tonumber(ARGV[3])
local function dependencies_terminal(current_digest)
  local cursor = current_digest
  for _ = 1, 256 do
    if (redis.call('HGET', key, 'op:' .. cursor .. ':predecessor_satisfied') or '') == '1' then
      return true
    end
    local predecessor_id = redis.call('HGET', key, 'op:' .. cursor .. ':predecessor') or ''
    if predecessor_id == '' then return true end
    local predecessor_digest = redis.call('HGET', key, 'op:' .. cursor .. ':predecessor_digest') or ''
    if predecessor_digest == '' or
       (redis.call('HGET', key, 'op:' .. predecessor_digest .. ':operation_id') or '') ~= predecessor_id or
       (redis.call('HGET', key, 'op:' .. predecessor_digest .. ':terminal') or '') == '' then
      return false
    end
    cursor = predecessor_digest
  end
  return false
end
if (redis.call('HGET', key, 'op:' .. operation_digest .. ':operation_id') or '') ~= operation_id then
  return 'missing'
end
local terminal = redis.call('HGET', key, 'op:' .. operation_digest .. ':terminal') or ''
if terminal ~= '' then return 'terminal:' .. terminal end
if (redis.call('HGET', key, 'op:' .. operation_digest .. ':ever_active') or '') ~= '' then
  return 'ever_active'
end
if not dependencies_terminal(operation_digest) then
  return 'predecessor_pending'
end
local redis_time = redis.call('TIME')
local now_ms = tonumber(redis_time[1]) * 1000 + math.floor(tonumber(redis_time[2]) / 1000)
redis.call('HSET', key,
  'op:' .. operation_digest .. ':terminal', 'expired',
  'op:' .. operation_digest .. ':terminal_at_ms', tostring(now_ms),
  'op:' .. operation_digest .. ':predecessor_satisfied', '1',
  'updated_at_ms', tostring(now_ms))
redis.call('ZADD', operation_index, now_ms, operation_digest)
redis.call('EXPIRE', key, ttl_seconds)
redis.call('EXPIRE', operation_index, ttl_seconds)
return 'expired'
`;

const FINALIZE_EVER_ACTIVE_AMBIGUOUS_SCRIPT = `
local key = KEYS[1]
local operation_index = KEYS[2]
local operation_digest = ARGV[1]
local operation_id = ARGV[2]
local command_id = ARGV[3]
local ttl_seconds = tonumber(ARGV[4])
if (redis.call('HGET', key, 'op:' .. operation_digest .. ':operation_id') or '') ~= operation_id or
   (redis.call('HGET', key, 'op:' .. operation_digest .. ':command_id') or '') ~= command_id then
  return 'missing'
end
local terminal = redis.call('HGET', key, 'op:' .. operation_digest .. ':terminal') or ''
if terminal ~= '' then return 'terminal:' .. terminal end
if (redis.call('HGET', key, 'op:' .. operation_digest .. ':ever_active') or '') == '' then
  return 'never_active'
end
local redis_time = redis.call('TIME')
local now_ms = tonumber(redis_time[1]) * 1000 + math.floor(tonumber(redis_time[2]) / 1000)
redis.call('HSET', key,
  'op:' .. operation_digest .. ':terminal', 'ambiguous',
  'op:' .. operation_digest .. ':terminal_at_ms', tostring(now_ms),
  'op:' .. operation_digest .. ':terminal_failure_code', 'ambiguous',
  'updated_at_ms', tostring(now_ms))
redis.call('HDEL', key,
  'op:' .. operation_digest .. ':active_command_id',
  'op:' .. operation_digest .. ':active_until_ms')
redis.call('ZADD', operation_index, now_ms, operation_digest)
redis.call('EXPIRE', key, ttl_seconds)
redis.call('EXPIRE', operation_index, ttl_seconds)
return 'terminal:ambiguous'
`;

const CLEAR_TERMINAL_TAIL_SCRIPT = `
local key = KEYS[1]
local operation_index = KEYS[2]
local operation_digest = ARGV[1]
local ttl_seconds = tonumber(ARGV[2])
if (redis.call('HGET', key, 'last_operation_digest') or '') ~= operation_digest then
  return 0
end
if (redis.call('HGET', key, 'op:' .. operation_digest .. ':terminal') or '') == '' then
  return 0
end
redis.call('EXPIRE', key, ttl_seconds)
redis.call('EXPIRE', operation_index, ttl_seconds)
return 1
`;

@injectable()
export class WorkerCommandLaneService {
  private readonly keyPrefix = 'message-send:lane:v1';
  private static readonly ACTIVE_LEASE_MS = 30 * 1000;

  constructor(@inject('Redis') private readonly redis: Redis) {}

  public async allocate(
    accountId: string,
    workerId: string,
    entityKey: string,
    operationId: string,
    issuedAt: Date,
    commandId: string,
    originEpoch: string,
    payloadDigest: string,
    commandType: string
  ): Promise<WorkerCommandLaneAllocation> {
    const key = this.buildLaneKey(accountId, workerId, entityKey);
    const normalizedOperationId = this.requireSegment(
      operationId,
      'operation_id'
    );
    const issuedAtMs = issuedAt.getTime();
    if (!Number.isFinite(issuedAtMs)) {
      throw new Error('worker_command_lane_issued_at_invalid');
    }
    const operationDigest = this.operationDigest(normalizedOperationId);
    const raw = await runCriticalRedisOperation(
      'worker_command_lane_allocate',
      () =>
        this.redis.eval(
          ALLOCATE_LANE_SCRIPT,
          2,
          key,
          this.buildOperationIndexKey(key),
          normalizedOperationId,
          operationDigest,
          String(issuedAtMs),
          this.requireSegment(commandId, 'command_id'),
          String(WORKER_COMMAND_LANE_POLICY.cursorTtlSeconds),
          this.requireSegment(originEpoch, 'origin_epoch'),
          this.requireSegment(payloadDigest, 'payload_digest'),
          this.requireSegment(commandType, 'command_type'),
          String(WORKER_COMMAND_LANE_POLICY.identityRetentionMs)
        )
    );
    if (!Array.isArray(raw)) {
      throw new Error('worker_command_lane_allocate_invalid_reply');
    }
    const allocationKind = String(raw[0] ?? '');
    if (allocationKind !== 'created' && allocationKind !== 'existing') {
      throw new Error('worker_command_lane_allocation_kind_invalid');
    }
    const sequence = Number(raw[1]);
    if (!Number.isSafeInteger(sequence) || sequence < 1) {
      throw new Error('worker_command_lane_sequence_invalid');
    }
    const predecessor = String(raw[2] ?? '').trim();
    const storedIssuedAtMs = Number(raw[3]);
    if (!Number.isSafeInteger(storedIssuedAtMs) || storedIssuedAtMs <= 0) {
      throw new Error('worker_command_lane_stored_issued_at_invalid');
    }
    const storedCommandId = String(raw[4] ?? '').trim();
    if (!storedCommandId) {
      throw new Error('worker_command_lane_stored_command_id_invalid');
    }
    const storedOriginEpoch = String(raw[5] ?? '').trim();
    if (!storedOriginEpoch) {
      throw new Error('worker_command_lane_stored_origin_epoch_invalid');
    }
    const storedPayloadDigest = String(raw[6] ?? '').trim();
    const storedCommandType = String(raw[7] ?? '').trim();
    if (
      storedPayloadDigest !== payloadDigest ||
      storedCommandType !== commandType
    ) {
      throw new Error('worker_command_lane_identity_conflict');
    }
    return {
      existing: allocationKind === 'existing',
      commandId: storedCommandId,
      entitySequence: sequence,
      predecessorOperationId: predecessor || null,
      issuedAt: new Date(storedIssuedAtMs),
      originEpoch: storedOriginEpoch,
    };
  }

  public async assertPredecessorTerminal(
    accountId: string,
    workerId: string,
    entityKey: string,
    operationId: string,
    predecessorOperationId: string | null
  ): Promise<void> {
    if (!predecessorOperationId) return;
    const key = this.buildLaneKey(accountId, workerId, entityKey);
    const raw = await runCriticalRedisOperation(
      'worker_command_lane_predecessor',
      () =>
        this.redis.eval(
          ASSERT_PREDECESSOR_SCRIPT,
          2,
          key,
          this.buildOperationIndexKey(key),
          predecessorOperationId,
          this.operationDigest(predecessorOperationId),
          String(WORKER_COMMAND_LANE_POLICY.commandDeadlineMs),
          this.operationDigest(operationId),
          String(WORKER_COMMAND_LANE_POLICY.cursorTtlSeconds)
        )
    );
    const status = Array.isArray(raw) ? String(raw[0] ?? '') : '';
    if (status !== 'ready') {
      throw new WorkerCommandPredecessorPendingError(
        Array.isArray(raw) ? String(raw[1] ?? '') : 'invalid_reply'
      );
    }
  }

  public async markActive(
    accountId: string,
    workerId: string,
    entityKey: string,
    operationId: string,
    commandId: string
  ): Promise<WorkerCommandLaneClaimDisposition> {
    const result = await runCriticalRedisOperation(
      'worker_command_lane_active',
      () =>
        this.redis.eval(
          MARK_LANE_ACTIVE_SCRIPT,
          2,
          this.buildLaneKey(accountId, workerId, entityKey),
          this.buildOperationIndexKey(
            this.buildLaneKey(accountId, workerId, entityKey)
          ),
          this.operationDigest(operationId),
          operationId,
          commandId,
          String(WorkerCommandLaneService.ACTIVE_LEASE_MS),
          String(WORKER_COMMAND_LANE_POLICY.cursorTtlSeconds)
        )
    );
    const disposition = String(result);
    if (
      disposition !== 'acquired' &&
      disposition !== 'busy' &&
      disposition !== 'duplicate' &&
      !disposition.startsWith('duplicate:')
    ) {
      throw new Error('worker_command_lane_active_invalid_reply');
    }
    return disposition as WorkerCommandLaneClaimDisposition;
  }

  public async renewActive(
    accountId: string,
    workerId: string,
    entityKey: string,
    operationId: string,
    commandId: string
  ): Promise<void> {
    const result = await runCriticalRedisOperation(
      'worker_command_lane_renew',
      () =>
        this.redis.eval(
          RENEW_LANE_ACTIVE_SCRIPT,
          2,
          this.buildLaneKey(accountId, workerId, entityKey),
          this.buildOperationIndexKey(
            this.buildLaneKey(accountId, workerId, entityKey)
          ),
          this.operationDigest(operationId),
          commandId,
          String(WorkerCommandLaneService.ACTIVE_LEASE_MS),
          String(WORKER_COMMAND_LANE_POLICY.cursorTtlSeconds)
        )
    );
    if (Number(result) !== 1) {
      throw new Error('worker_command_lane_active_lease_lost');
    }
  }

  public async releaseActive(
    accountId: string,
    workerId: string,
    entityKey: string,
    operationId: string,
    commandId: string
  ): Promise<void> {
    await runCriticalRedisOperation('worker_command_lane_release', () =>
      this.redis.eval(
        RELEASE_LANE_ACTIVE_SCRIPT,
        2,
        this.buildLaneKey(accountId, workerId, entityKey),
        this.buildOperationIndexKey(
          this.buildLaneKey(accountId, workerId, entityKey)
        ),
        this.operationDigest(operationId),
        commandId,
        String(WORKER_COMMAND_LANE_POLICY.cursorTtlSeconds)
      )
    );
  }

  /**
   * Counts only real pre-provider failures. Waiting for a predecessor or for
   * another delivery of the same operation never consumes this budget.
   */
  public async recordTechnicalRetry(
    accountId: string,
    workerId: string,
    entityKey: string,
    operationId: string,
    commandId: string
  ): Promise<number> {
    const laneKey = this.buildLaneKey(accountId, workerId, entityKey);
    const result = await runCriticalRedisOperation(
      'worker_command_lane_technical_retry',
      () =>
        this.redis.eval(
          RECORD_TECHNICAL_RETRY_SCRIPT,
          2,
          laneKey,
          this.buildOperationIndexKey(laneKey),
          this.operationDigest(operationId),
          operationId,
          commandId,
          String(WORKER_COMMAND_LANE_POLICY.cursorTtlSeconds)
        )
    );
    const count = Number(result);
    if (!Number.isSafeInteger(count) || count < 1) {
      throw new Error('worker_command_lane_technical_retry_invalid_reply');
    }
    return count;
  }

  public async markTerminal(
    accountId: string,
    workerId: string,
    entityKey: string,
    operationId: string,
    commandId: string,
    state: WorkerCommandLaneTerminalState,
    failureCode = ''
  ): Promise<void> {
    const result = await runCriticalRedisOperation(
      'worker_command_lane_terminal',
      () =>
        this.redis.eval(
          MARK_LANE_TERMINAL_SCRIPT,
          2,
          this.buildLaneKey(accountId, workerId, entityKey),
          this.buildOperationIndexKey(
            this.buildLaneKey(accountId, workerId, entityKey)
          ),
          operationId,
          this.operationDigest(operationId),
          state,
          String(WORKER_COMMAND_LANE_POLICY.cursorTtlSeconds),
          commandId,
          failureCode
        )
    );
    if (Number(result) === -1) {
      throw new Error('worker_command_lane_terminal_immutable_conflict');
    }
    if (Number(result) !== 1 && Number(result) !== 2) {
      throw new Error('worker_command_lane_terminal_operation_missing');
    }
  }

  public async expireNeverActive(
    accountId: string,
    workerId: string,
    entityKey: string,
    operationId: string
  ): Promise<
    | 'expired'
    | 'missing'
    | 'ever_active'
    | 'predecessor_pending'
    | `terminal:${WorkerCommandLaneTerminalState}`
  > {
    const laneKey = this.buildLaneKey(accountId, workerId, entityKey);
    const result = String(
      await runCriticalRedisOperation(
        'worker_command_lane_expire_never_active',
        () =>
          this.redis.eval(
            EXPIRE_NEVER_ACTIVE_SCRIPT,
            2,
            laneKey,
            this.buildOperationIndexKey(laneKey),
            this.operationDigest(operationId),
            operationId,
            String(WORKER_COMMAND_LANE_POLICY.cursorTtlSeconds)
          )
      )
    );
    if (
      result !== 'expired' &&
      result !== 'missing' &&
      result !== 'ever_active' &&
      result !== 'predecessor_pending' &&
      !result.startsWith('terminal:')
    ) {
      throw new Error('worker_command_lane_expire_invalid_reply');
    }
    return result as
      | 'expired'
      | 'missing'
      | 'ever_active'
      | 'predecessor_pending'
      | `terminal:${WorkerCommandLaneTerminalState}`;
  }

  /**
   * Atomically closes an operation which was observed ever-active at its
   * operational cap. A concurrent handler terminalization wins and is
   * returned verbatim; it is never overwritten by the reconciler.
   */
  public async finalizeEverActiveAmbiguous(
    accountId: string,
    workerId: string,
    entityKey: string,
    operationId: string,
    commandId: string
  ): Promise<
    'missing' | 'never_active' | `terminal:${WorkerCommandLaneTerminalState}`
  > {
    const laneKey = this.buildLaneKey(accountId, workerId, entityKey);
    const result = String(
      await runCriticalRedisOperation(
        'worker_command_lane_finalize_ever_active_ambiguous',
        () =>
          this.redis.eval(
            FINALIZE_EVER_ACTIVE_AMBIGUOUS_SCRIPT,
            2,
            laneKey,
            this.buildOperationIndexKey(laneKey),
            this.operationDigest(operationId),
            operationId,
            commandId,
            String(WORKER_COMMAND_LANE_POLICY.cursorTtlSeconds)
          )
      )
    );
    if (
      result !== 'missing' &&
      result !== 'never_active' &&
      !result.startsWith('terminal:')
    ) {
      throw new Error('worker_command_lane_finalize_ambiguous_invalid_reply');
    }
    return result as
      | ('missing' | 'never_active')
      | `terminal:${WorkerCommandLaneTerminalState}`;
  }

  /** Called only after the JetStream AckSync was confirmed. */
  public async clearTerminalTail(
    accountId: string,
    workerId: string,
    entityKey: string,
    operationId: string
  ): Promise<void> {
    await runCriticalRedisOperation('worker_command_lane_clear_tail', () =>
      this.redis.eval(
        CLEAR_TERMINAL_TAIL_SCRIPT,
        2,
        this.buildLaneKey(accountId, workerId, entityKey),
        this.buildOperationIndexKey(
          this.buildLaneKey(accountId, workerId, entityKey)
        ),
        this.operationDigest(operationId),
        String(WORKER_COMMAND_LANE_POLICY.cursorTtlSeconds)
      )
    );
  }

  public buildLaneKey(
    accountId: string,
    workerId: string,
    entityKey: string
  ): string {
    const normalizedAccountId = this.requireSegment(accountId, 'account_id');
    const normalizedWorkerId = this.requireSegment(workerId, 'worker_id');
    const normalizedEntityKey = this.requireSegment(entityKey, 'entity_key');
    if (
      Buffer.byteLength(normalizedEntityKey, 'utf8') >
      WORKER_COMMAND_LANE_POLICY.maxEntityKeyBytes
    ) {
      throw new Error('worker_command_lane_entity_key_too_large');
    }
    const digest = createHash('sha256')
      .update(normalizedEntityKey)
      .digest('hex');
    return `${this.keyPrefix}:${normalizedAccountId}:${normalizedWorkerId}:${digest}`;
  }

  private buildOperationIndexKey(laneKey: string): string {
    return `${laneKey}:ops`;
  }

  private operationDigest(operationId: string): string {
    return createHash('sha256')
      .update(this.requireSegment(operationId, 'operation_id'))
      .digest('hex');
  }

  private requireSegment(value: unknown, name: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`worker_command_lane_${name}_invalid`);
    }
    return value.trim();
  }
}

export class WorkerCommandPredecessorPendingError extends Error {
  public readonly retryable = true;
  public readonly predecessorEverActive: boolean;
  public readonly predecessorNeverActive: boolean;

  constructor(public readonly reason: string) {
    super(`worker_command_predecessor_pending:${reason}`);
    this.name = 'WorkerCommandPredecessorPendingError';
    this.predecessorEverActive = reason === 'predecessor_ever_active';
    this.predecessorNeverActive =
      reason === 'predecessor_never_active' ||
      reason === 'predecessor_dependency_pending';
  }
}
