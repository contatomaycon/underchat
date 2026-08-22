import { inject, singleton } from 'tsyringe';
import type Redis from 'ioredis';
import { runCriticalRedisOperation } from '@core/common/functions/criticalRedisOperation';
import { createHash } from 'node:crypto';
import type {
  WorkerCommandEnvelopeV1,
  WorkerCommandType,
} from '@core/common/interfaces/IWorkerCommandEnvelope';

const DEADLINE_INDEX_KEY = '{worker-command-deadline:v1}:due';
const ADMISSION_IDENTITY_INDEX_KEY = '{worker-command-admission:v1}:expires';

const RESERVE_ADMISSION_IDENTITY_SCRIPT = `
local expires_key = KEYS[1]
local record_key = KEYS[2]
local operation_digest = ARGV[1]
local identity = ARGV[2]
local proposed_record = ARGV[3]
local proposed_issued_at_ms = tonumber(ARGV[4])
local retention_ms = tonumber(ARGV[5])
local max_records = tonumber(ARGV[6])
local cleanup_limit = tonumber(ARGV[7])
local redis_time = redis.call('TIME')
local now_ms = tonumber(redis_time[1]) * 1000 + math.floor(tonumber(redis_time[2]) / 1000)
local expired = redis.call('ZRANGEBYSCORE', expires_key, '-inf', now_ms, 'LIMIT', 0, cleanup_limit)
for _, digest in ipairs(expired) do
  redis.call('ZREM', expires_key, digest)
end
local existing_identity = redis.call('HGET', record_key, 'identity')
if existing_identity then
  if existing_identity ~= identity then return {'conflict'} end
  local existing_record = redis.call('HGET', record_key, 'record')
  if not existing_record then return {'corrupt'} end
  return {'existing', existing_record, tostring(now_ms)}
end
local expires_at_ms = proposed_issued_at_ms + retention_ms
if expires_at_ms <= now_ms then return {'expired'} end
if redis.call('ZCARD', expires_key) >= max_records then return {'full'} end
redis.call('HSET', record_key, 'identity', identity, 'record', proposed_record)
redis.call('PEXPIREAT', record_key, expires_at_ms)
redis.call('ZADD', expires_key, expires_at_ms, operation_digest)
return {'created', proposed_record, tostring(now_ms)}
`;

const ADMISSION_IDENTITY_CARDINALITY_SCRIPT = `
local expires_key = KEYS[1]
local cleanup_limit = tonumber(ARGV[1])
local redis_time = redis.call('TIME')
local now_ms = tonumber(redis_time[1]) * 1000 + math.floor(tonumber(redis_time[2]) / 1000)
local expired = redis.call('ZRANGEBYSCORE', expires_key, '-inf', now_ms, 'LIMIT', 0, cleanup_limit)
for _, digest in ipairs(expired) do
  redis.call('ZREM', expires_key, digest)
end
return redis.call('ZCARD', expires_key)
`;

const REGISTER_SCRIPT = `
local due_key = KEYS[1]
local record_key = KEYS[2]
local command_id = ARGV[1]
local record = ARGV[2]
local deadline_at_ms = tonumber(ARGV[3])
local expires_at_ms = tonumber(ARGV[4])
local max_records = tonumber(ARGV[5])
local redis_time = redis.call('TIME')
local now_ms = tonumber(redis_time[1]) * 1000 + math.floor(tonumber(redis_time[2]) / 1000)
if expires_at_ms <= now_ms then return 'expired' end
local existing = redis.call('HGET', record_key, 'record')
if existing then
  if existing ~= record then return 'conflict' end
  if redis.call('ZSCORE', due_key, command_id) == false then
    redis.call('ZADD', due_key, deadline_at_ms, command_id)
  end
  redis.call('PEXPIREAT', record_key, expires_at_ms)
  return 'existing'
end
if redis.call('ZCARD', due_key) >= max_records then return 'full' end
redis.call('HSET', record_key, 'record', record)
redis.call('PEXPIREAT', record_key, expires_at_ms)
redis.call('ZADD', due_key, deadline_at_ms, command_id)
return 'created'
`;

const CLAIM_SCRIPT = `
local due_key = KEYS[1]
local record_key = KEYS[2]
local command_id = ARGV[1]
local now_ms = tonumber(ARGV[2])
local lease_until_ms = tonumber(ARGV[3])
local owner = ARGV[4]
local score = redis.call('ZSCORE', due_key, command_id)
if not score or tonumber(score) > now_ms then return {} end
local record = redis.call('HGET', record_key, 'record')
if not record then
  redis.call('ZREM', due_key, command_id)
  return {}
end
redis.call('HSET', record_key, 'owner', owner)
redis.call('ZADD', due_key, lease_until_ms, command_id)
return { command_id, record }
`;

const COMPLETE_SCRIPT = `
local due_key = KEYS[1]
local record_key = KEYS[2]
local command_id = ARGV[1]
local owner = ARGV[2]
if (redis.call('HGET', record_key, 'owner') or '') ~= owner then return 0 end
redis.call('DEL', record_key)
redis.call('ZREM', due_key, command_id)
return 1
`;

const RESCHEDULE_SCRIPT = `
local due_key = KEYS[1]
local record_key = KEYS[2]
local command_id = ARGV[1]
local owner = ARGV[2]
local due_at_ms = tonumber(ARGV[3])
if (redis.call('HGET', record_key, 'owner') or '') ~= owner then
  if redis.call('EXISTS', record_key) == 0 then redis.call('ZREM', due_key, command_id) end
  return 0
end
if redis.call('HEXISTS', record_key, 'record') == 0 then
  redis.call('DEL', record_key)
  redis.call('ZREM', due_key, command_id)
  return 0
end
redis.call('HDEL', record_key, 'owner')
redis.call('ZADD', due_key, due_at_ms, command_id)
return 1
`;

export const WORKER_COMMAND_DEADLINE_POLICY = Object.freeze({
  intervalMs: 5_000,
  batchSize: 100,
  concurrency: 8,
  leaseMs: 30_000,
  activeRescheduleMs: 30_000,
  operationalCapMs: 24 * 60 * 60 * 1000,
  finalizationMarginMs: 5 * 60 * 1000,
  maxRecordBytes: 8 * 1024,
  // Hard admission budget: at the maximum serialized size this caps identity
  // data at 2 GiB plus Redis/ZSET overhead. Admission fails closed when full.
  maxRecords: 250_000,
});

export const WORKER_COMMAND_ADMISSION_IDENTITY_RETENTION_MS =
  24 * 60 * 60 * 1000;
export const WORKER_COMMAND_ADMISSION_IDENTITY_MAX_RECORDS = 250_000;
export const WORKER_COMMAND_ADMISSION_IDENTITY_MAX_BYTES = 4 * 1024;
const WORKER_COMMAND_ADMISSION_IDENTITY_CLEANUP_LIMIT = 1_000;

export interface WorkerCommandAdmissionIdentityInput {
  accountId: string;
  workerId: string;
  entityKey: string;
  operationId: string;
  payloadDigest: string;
  commandType: WorkerCommandType;
  originEpoch: string;
  retryOf?: string | null;
  proposedIssuedAt: Date;
  proposedCommandId: string;
}

export interface WorkerCommandAdmissionIdentity {
  existing: boolean;
  issuedAt: Date;
  commandId: string;
  originEpoch: string;
  observedAtMs: number;
}

export interface WorkerCommandDeadlineRecordV1 {
  schema_version: 1;
  command_id: string;
  operation_id: string;
  account_id: string;
  worker_id: string;
  command_type: WorkerCommandType;
  entity_key: string;
  entity_sequence: number;
  origin_epoch: string;
  issued_at: string;
  deadline_at: string;
  payload_digest: string;
  schedule_projection?: {
    schedule_id: string;
    message_id: string;
    attempt_id: string;
  };
}

export interface WorkerCommandDeadlineClaim {
  owner: string;
  record: WorkerCommandDeadlineRecordV1;
}

export interface WorkerCommandScheduleProjectionIdentity {
  schedule_id: string;
  message_id: string;
  attempt_id: string;
}

/**
 * Global, payload-free deadline index. Keys share one Redis Cluster hash slot,
 * so per-record registration, leasing and removal are atomic without scans.
 * Each compact HASH has an absolute PEXPIREAT at issued_at + 24h, so outages
 * cannot retain record data past the operational cap. Bounded due claims
 * remove any compact orphan ZSET identities after Redis returns.
 */
@singleton()
export class WorkerCommandDeadlineRegistryService {
  constructor(@inject('Redis') private readonly redis: Redis) {}

  public async reserveAdmissionIdentity(
    input: WorkerCommandAdmissionIdentityInput
  ): Promise<WorkerCommandAdmissionIdentity> {
    const proposedIssuedAtMs = input.proposedIssuedAt.getTime();
    if (!Number.isSafeInteger(proposedIssuedAtMs)) {
      throw new Error('worker_command_admission_clock_invalid');
    }
    const digest = createHash('sha256')
      .update(
        `worker-command-admission:v1\0${input.accountId}\0${input.workerId}\0${input.operationId}`
      )
      .digest('hex');
    const identity = JSON.stringify({
      operation_id: input.operationId,
      account_id: input.accountId,
      worker_id: input.workerId,
      entity_key: input.entityKey,
      payload_digest: input.payloadDigest,
      command_type: input.commandType,
      origin_epoch: input.originEpoch,
      retry_of: input.retryOf?.trim() ?? null,
    });
    const proposedRecord = JSON.stringify({
      issued_at_ms: proposedIssuedAtMs,
      command_id: input.proposedCommandId,
      origin_epoch: input.originEpoch,
    });
    if (
      Buffer.byteLength(identity, 'utf8') +
        Buffer.byteLength(proposedRecord, 'utf8') >
      WORKER_COMMAND_ADMISSION_IDENTITY_MAX_BYTES
    ) {
      throw new Error('worker_command_admission_identity_too_large');
    }
    const raw = await runCriticalRedisOperation(
      'worker_command_admission_identity_reserve',
      () =>
        this.redis.eval(
          RESERVE_ADMISSION_IDENTITY_SCRIPT,
          2,
          ADMISSION_IDENTITY_INDEX_KEY,
          this.admissionIdentityRecordKey(digest),
          digest,
          identity,
          proposedRecord,
          String(proposedIssuedAtMs),
          String(WORKER_COMMAND_ADMISSION_IDENTITY_RETENTION_MS),
          String(WORKER_COMMAND_ADMISSION_IDENTITY_MAX_RECORDS),
          String(WORKER_COMMAND_ADMISSION_IDENTITY_CLEANUP_LIMIT)
        )
    );
    if (!Array.isArray(raw) || raw.length < 1) {
      throw new Error('worker_command_admission_identity_invalid_reply');
    }
    const disposition = String(raw[0] ?? '');
    if (disposition === 'conflict') {
      throw new Error('worker_command_operation_identity_conflict');
    }
    if (disposition === 'expired') {
      throw new Error('worker_command_admission_identity_retention_elapsed');
    }
    if (disposition === 'full') {
      throw new Error('worker_command_admission_identity_capacity_exhausted');
    }
    if (disposition === 'corrupt') {
      throw new Error('worker_command_admission_identity_corrupt');
    }
    if (disposition !== 'created' && disposition !== 'existing') {
      throw new Error('worker_command_admission_identity_invalid_reply');
    }
    let record: {
      issued_at_ms?: unknown;
      command_id?: unknown;
      origin_epoch?: unknown;
    };
    try {
      record = JSON.parse(String(raw[1] ?? '')) as typeof record;
    } catch {
      throw new Error('worker_command_admission_identity_invalid_reply');
    }
    const issuedAtMs = Number(record.issued_at_ms);
    const commandId = String(record.command_id ?? '').trim();
    const originEpoch = String(record.origin_epoch ?? '').trim();
    const observedAtMs = Number(raw[2]);
    if (
      !Number.isSafeInteger(issuedAtMs) ||
      !Number.isSafeInteger(observedAtMs) ||
      !commandId ||
      !originEpoch
    ) {
      throw new Error('worker_command_admission_identity_invalid_reply');
    }
    return {
      existing: disposition === 'existing',
      issuedAt: new Date(issuedAtMs),
      commandId,
      originEpoch,
      observedAtMs,
    };
  }

  public async admissionIdentityCount(): Promise<number> {
    const result = Number(
      await runCriticalRedisOperation(
        'worker_command_admission_identity_count',
        () =>
          this.redis.eval(
            ADMISSION_IDENTITY_CARDINALITY_SCRIPT,
            1,
            ADMISSION_IDENTITY_INDEX_KEY,
            String(WORKER_COMMAND_ADMISSION_IDENTITY_CLEANUP_LIMIT)
          )
      )
    );
    if (!Number.isSafeInteger(result) || result < 0) {
      throw new Error('worker_command_admission_identity_count_invalid_reply');
    }
    return result;
  }

  public async deadlineRecordCount(): Promise<number> {
    const result = Number(
      await runCriticalRedisOperation('worker_command_deadline_count', () =>
        this.redis.zcard(DEADLINE_INDEX_KEY)
      )
    );
    if (!Number.isSafeInteger(result) || result < 0) {
      throw new Error('worker_command_deadline_count_invalid_reply');
    }
    return result;
  }

  public admissionIdentityRecordKey(operationDigest: string): string {
    if (!/^[a-f0-9]{64}$/u.test(operationDigest)) {
      throw new Error('worker_command_admission_identity_digest_invalid');
    }
    return `{worker-command-admission:v1}:record:${operationDigest}`;
  }

  public async register(
    envelope: WorkerCommandEnvelopeV1,
    scheduleProjection?: WorkerCommandScheduleProjectionIdentity
  ): Promise<void> {
    if (
      scheduleProjection &&
      (envelope.command_type !== 'schedule_send' ||
        scheduleProjection.attempt_id !== envelope.operation_id ||
        [scheduleProjection.schedule_id, scheduleProjection.message_id].some(
          (entry) => typeof entry !== 'string' || entry.length === 0
        ))
    ) {
      throw new Error('worker_command_deadline_schedule_projection_invalid');
    }
    const record: WorkerCommandDeadlineRecordV1 = {
      schema_version: 1,
      command_id: envelope.command_id,
      operation_id: envelope.operation_id,
      account_id: envelope.account_id,
      worker_id: envelope.worker_id,
      command_type: envelope.command_type,
      entity_key: envelope.entity_key,
      entity_sequence: envelope.entity_sequence,
      origin_epoch: envelope.origin_epoch,
      issued_at: envelope.issued_at,
      deadline_at: envelope.deadline_at,
      payload_digest: envelope.payload_digest,
      ...(scheduleProjection
        ? { schedule_projection: scheduleProjection }
        : {}),
    };
    const serialized = JSON.stringify(record);
    if (
      Buffer.byteLength(serialized, 'utf8') >
      WORKER_COMMAND_DEADLINE_POLICY.maxRecordBytes
    ) {
      throw new Error('worker_command_deadline_record_too_large');
    }
    const deadlineAtMs = Date.parse(record.deadline_at);
    const issuedAtMs = Date.parse(record.issued_at);
    const expiresAtMs =
      issuedAtMs + WORKER_COMMAND_DEADLINE_POLICY.operationalCapMs;
    if (
      !Number.isSafeInteger(deadlineAtMs) ||
      !Number.isSafeInteger(issuedAtMs) ||
      deadlineAtMs <= issuedAtMs
    ) {
      throw new Error('worker_command_deadline_clock_invalid');
    }

    const result = String(
      await runCriticalRedisOperation('worker_command_deadline_register', () =>
        this.redis.eval(
          REGISTER_SCRIPT,
          2,
          DEADLINE_INDEX_KEY,
          this.recordKey(record.command_id),
          record.command_id,
          serialized,
          String(deadlineAtMs),
          String(expiresAtMs),
          String(WORKER_COMMAND_DEADLINE_POLICY.maxRecords)
        )
      )
    );
    if (result === 'conflict') {
      throw new Error('worker_command_deadline_identity_conflict');
    }
    if (result === 'full') {
      throw new Error('worker_command_deadline_capacity_exhausted');
    }
    if (result === 'expired') {
      throw new Error('worker_command_deadline_operational_cap_elapsed');
    }
    if (result !== 'created' && result !== 'existing') {
      throw new Error('worker_command_deadline_register_invalid_reply');
    }
  }

  public async claimDue(
    now: Date,
    owner: string,
    limit = WORKER_COMMAND_DEADLINE_POLICY.batchSize
  ): Promise<WorkerCommandDeadlineClaim[]> {
    const nowMs = now.getTime();
    if (!Number.isSafeInteger(nowMs) || !owner || limit < 1) {
      throw new Error('worker_command_deadline_claim_invalid');
    }
    const boundedLimit = Math.min(
      Math.floor(limit),
      WORKER_COMMAND_DEADLINE_POLICY.batchSize
    );
    const commandIds = await runCriticalRedisOperation(
      'worker_command_deadline_due',
      () =>
        this.redis.zrangebyscore(
          DEADLINE_INDEX_KEY,
          '-inf',
          nowMs,
          'LIMIT',
          0,
          boundedLimit
        )
    );
    const claims: WorkerCommandDeadlineClaim[] = [];
    const replies = await Promise.all(
      commandIds.map((commandId) =>
        runCriticalRedisOperation('worker_command_deadline_claim', () =>
          this.redis.eval(
            CLAIM_SCRIPT,
            2,
            DEADLINE_INDEX_KEY,
            this.recordKey(commandId),
            commandId,
            String(nowMs),
            String(nowMs + WORKER_COMMAND_DEADLINE_POLICY.leaseMs),
            owner
          )
        )
      )
    );
    for (const raw of replies) {
      if (!Array.isArray(raw)) {
        throw new Error('worker_command_deadline_claim_invalid_reply');
      }
      if (raw.length === 0) continue;
      if (raw.length !== 2) {
        throw new Error('worker_command_deadline_claim_invalid_reply');
      }
      const commandId = String(raw[0] ?? '');
      const record = this.parseRecord(String(raw[1] ?? ''));
      if (record.command_id !== commandId) {
        throw new Error('worker_command_deadline_claim_identity_mismatch');
      }
      claims.push({ owner, record });
    }
    return claims;
  }

  public async complete(claim: WorkerCommandDeadlineClaim): Promise<boolean> {
    const result = await runCriticalRedisOperation(
      'worker_command_deadline_complete',
      () =>
        this.redis.eval(
          COMPLETE_SCRIPT,
          2,
          DEADLINE_INDEX_KEY,
          this.recordKey(claim.record.command_id),
          claim.record.command_id,
          claim.owner
        )
    );
    return Number(result) === 1;
  }

  public async reschedule(
    claim: WorkerCommandDeadlineClaim,
    dueAt: Date
  ): Promise<boolean> {
    const dueAtMs = dueAt.getTime();
    if (!Number.isSafeInteger(dueAtMs)) {
      throw new Error('worker_command_deadline_reschedule_invalid');
    }
    const result = await runCriticalRedisOperation(
      'worker_command_deadline_reschedule',
      () =>
        this.redis.eval(
          RESCHEDULE_SCRIPT,
          2,
          DEADLINE_INDEX_KEY,
          this.recordKey(claim.record.command_id),
          claim.record.command_id,
          claim.owner,
          String(dueAtMs)
        )
    );
    return Number(result) === 1;
  }

  private parseRecord(serialized: string): WorkerCommandDeadlineRecordV1 {
    let value: unknown;
    try {
      value = JSON.parse(serialized);
    } catch {
      throw new Error('worker_command_deadline_record_invalid');
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('worker_command_deadline_record_invalid');
    }
    const record = value as Partial<WorkerCommandDeadlineRecordV1>;
    const requiredStrings = [
      record.command_id,
      record.operation_id,
      record.account_id,
      record.worker_id,
      record.command_type,
      record.entity_key,
      record.origin_epoch,
      record.issued_at,
      record.deadline_at,
      record.payload_digest,
    ];
    if (
      record.schema_version !== 1 ||
      requiredStrings.some(
        (entry) => typeof entry !== 'string' || entry.length === 0
      ) ||
      !Number.isSafeInteger(record.entity_sequence) ||
      Number(record.entity_sequence) < 1
    ) {
      throw new Error('worker_command_deadline_record_invalid');
    }
    if (record.schedule_projection) {
      const projection = record.schedule_projection;
      if (
        record.command_type !== 'schedule_send' ||
        projection.attempt_id !== record.operation_id ||
        [
          projection.schedule_id,
          projection.message_id,
          projection.attempt_id,
        ].some((entry) => typeof entry !== 'string' || entry.length === 0)
      ) {
        throw new Error('worker_command_deadline_record_invalid');
      }
    }
    return record as WorkerCommandDeadlineRecordV1;
  }

  public recordKey(commandId: string): string {
    if (!commandId)
      throw new Error('worker_command_deadline_command_id_invalid');
    return `{worker-command-deadline:v1}:record:${commandId}`;
  }
}
