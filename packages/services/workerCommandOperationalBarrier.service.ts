import { createHash, randomBytes } from 'node:crypto';
import { inject, singleton } from 'tsyringe';
import type Redis from 'ioredis';
import { runCriticalRedisOperation } from '@core/common/functions/criticalRedisOperation';

export type WorkerCommandOperationalBarrierState = 'active' | 'paused';

export interface WorkerCommandOperationalBarrierStatus {
  schema_version: 1;
  state: WorkerCommandOperationalBarrierState;
  generation: number;
  changed_at: string;
  changed_by: string;
  reason: string | null;
  active_permits: number;
  oldest_permit_expires_at: string | null;
}

export interface WorkerCommandOperationalBarrierPauseResult {
  status: WorkerCommandOperationalBarrierStatus;
  /** Returned once. Redis stores only its SHA-256 digest. */
  resume_token: string;
}

export interface WorkerCommandOperationalBarrierPermit {
  readonly member: string;
  readonly generation: number;
  readonly scope: string;
  readonly expiresAtMs: number;
}

export class WorkerCommandOperationalBarrierError extends Error {
  public readonly retryable: boolean;
  public operationId?: string;

  constructor(
    public readonly code: 'paused' | 'conflict' | 'corrupt',
    message: string,
    public readonly status?: WorkerCommandOperationalBarrierStatus
  ) {
    super(message);
    this.name = 'WorkerCommandOperationalBarrierError';
    this.retryable = code === 'paused' || code === 'conflict';
  }
}

export function isWorkerCommandOperationalBarrierPausedError(
  error: unknown
): error is WorkerCommandOperationalBarrierError {
  return (
    error instanceof WorkerCommandOperationalBarrierError &&
    error.code === 'paused'
  );
}

export const WORKER_COMMAND_OPERATIONAL_BARRIER_POLICY = Object.freeze({
  permitLeaseMs: 30_000,
  permitRefreshMs: 10_000,
  maxScopeBytes: 64,
  maxActorBytes: 128,
  maxReasonBytes: 512,
});

export const WORKER_COMMAND_OPERATIONAL_BARRIER_STATE_KEY =
  '{worker-command-operational-barrier:v1}:state';
export const WORKER_COMMAND_OPERATIONAL_BARRIER_PERMITS_KEY =
  '{worker-command-operational-barrier:v1}:permits';

const STATUS_SCRIPT = `
local state_key = KEYS[1]
local permits_key = KEYS[2]
local default_actor = ARGV[1]
local redis_time = redis.call('TIME')
local now_ms = tonumber(redis_time[1]) * 1000 + math.floor(tonumber(redis_time[2]) / 1000)
redis.call('ZREMRANGEBYSCORE', permits_key, '-inf', now_ms)
if redis.call('EXISTS', state_key) == 0 then
  redis.call('HSET', state_key,
    'schema_version', '1',
    'state', 'active',
    'generation', '1',
    'changed_at_ms', tostring(now_ms),
    'changed_by', default_actor,
    'reason', '')
end
local values = redis.call('HMGET', state_key,
  'schema_version', 'state', 'generation', 'changed_at_ms', 'changed_by', 'reason')
local first = redis.call('ZRANGE', permits_key, 0, 0, 'WITHSCORES')
return {values[1] or '', values[2] or '', values[3] or '', values[4] or '',
  values[5] or '', values[6] or '', tostring(redis.call('ZCARD', permits_key)),
  first[2] or ''}
`;

const ACQUIRE_SCRIPT = `
local state_key = KEYS[1]
local permits_key = KEYS[2]
local member = ARGV[1]
local lease_ms = tonumber(ARGV[2])
local default_actor = ARGV[3]
local redis_time = redis.call('TIME')
local now_ms = tonumber(redis_time[1]) * 1000 + math.floor(tonumber(redis_time[2]) / 1000)
redis.call('ZREMRANGEBYSCORE', permits_key, '-inf', now_ms)
if redis.call('EXISTS', state_key) == 0 then
  redis.call('HSET', state_key,
    'schema_version', '1',
    'state', 'active',
    'generation', '1',
    'changed_at_ms', tostring(now_ms),
    'changed_by', default_actor,
    'reason', '')
end
local values = redis.call('HMGET', state_key,
  'schema_version', 'state', 'generation', 'changed_at_ms', 'changed_by', 'reason')
if values[1] ~= '1' then return {'corrupt'} end
if values[2] ~= 'active' and values[2] ~= 'paused' then return {'corrupt'} end
local generation = tonumber(values[3])
if not generation or generation < 1 then return {'corrupt'} end
if values[2] ~= 'active' then
  local first = redis.call('ZRANGE', permits_key, 0, 0, 'WITHSCORES')
  return {'paused', values[1], values[2], values[3], values[4] or '',
    values[5] or '', values[6] or '', tostring(redis.call('ZCARD', permits_key)),
    first[2] or ''}
end
local expires_at_ms = now_ms + lease_ms
redis.call('ZADD', permits_key, expires_at_ms, member)
return {'acquired', tostring(generation), tostring(expires_at_ms)}
`;

const RELEASE_SCRIPT = `
return redis.call('ZREM', KEYS[1], ARGV[1])
`;

const RENEW_SCRIPT = `
local permits_key = KEYS[1]
local member = ARGV[1]
local lease_ms = tonumber(ARGV[2])
local redis_time = redis.call('TIME')
local now_ms = tonumber(redis_time[1]) * 1000 + math.floor(tonumber(redis_time[2]) / 1000)
redis.call('ZREMRANGEBYSCORE', permits_key, '-inf', now_ms)
local existed = redis.call('ZSCORE', permits_key, member) ~= false
-- Reassert the unique in-process permit even when a status read pruned an
-- expired lease. Returning 0 still fails the owner closed, while the atomic
-- ZADD restores drain evidence before another Redis caller can observe it.
redis.call('ZADD', permits_key, now_ms + lease_ms, member)
if existed then return 1 end
return 0
`;

const PAUSE_SCRIPT = `
local state_key = KEYS[1]
local permits_key = KEYS[2]
local expected_generation = tonumber(ARGV[1])
local token_digest = ARGV[2]
local actor = ARGV[3]
local reason = ARGV[4]
local default_actor = ARGV[5]
local redis_time = redis.call('TIME')
local now_ms = tonumber(redis_time[1]) * 1000 + math.floor(tonumber(redis_time[2]) / 1000)
redis.call('ZREMRANGEBYSCORE', permits_key, '-inf', now_ms)
if redis.call('EXISTS', state_key) == 0 then
  redis.call('HSET', state_key,
    'schema_version', '1',
    'state', 'active',
    'generation', '1',
    'changed_at_ms', tostring(now_ms),
    'changed_by', default_actor,
    'reason', '')
end
local schema = redis.call('HGET', state_key, 'schema_version') or ''
local state = redis.call('HGET', state_key, 'state') or ''
local generation = tonumber(redis.call('HGET', state_key, 'generation') or '')
if schema ~= '1' or (state ~= 'active' and state ~= 'paused') or not generation then
  return {'corrupt'}
end
if generation ~= expected_generation then return {'generation_conflict', tostring(generation), state} end
if state ~= 'active' then return {'state_conflict', tostring(generation), state} end
local next_generation = generation + 1
redis.call('HSET', state_key,
  'state', 'paused',
  'generation', tostring(next_generation),
  'changed_at_ms', tostring(now_ms),
  'changed_by', actor,
  'reason', reason,
  'resume_token_digest', token_digest)
local first = redis.call('ZRANGE', permits_key, 0, 0, 'WITHSCORES')
return {'paused', '1', 'paused', tostring(next_generation), tostring(now_ms), actor,
  reason, tostring(redis.call('ZCARD', permits_key)), first[2] or ''}
`;

const RESUME_SCRIPT = `
local state_key = KEYS[1]
local permits_key = KEYS[2]
local expected_generation = tonumber(ARGV[1])
local token_digest = ARGV[2]
local actor = ARGV[3]
local redis_time = redis.call('TIME')
local now_ms = tonumber(redis_time[1]) * 1000 + math.floor(tonumber(redis_time[2]) / 1000)
redis.call('ZREMRANGEBYSCORE', permits_key, '-inf', now_ms)
if redis.call('EXISTS', state_key) == 0 then return {'missing'} end
local schema = redis.call('HGET', state_key, 'schema_version') or ''
local state = redis.call('HGET', state_key, 'state') or ''
local generation = tonumber(redis.call('HGET', state_key, 'generation') or '')
if schema ~= '1' or (state ~= 'active' and state ~= 'paused') or not generation then
  return {'corrupt'}
end
if generation ~= expected_generation then return {'generation_conflict', tostring(generation), state} end
if state ~= 'paused' then return {'state_conflict', tostring(generation), state} end
if (redis.call('HGET', state_key, 'resume_token_digest') or '') ~= token_digest then
  return {'token_conflict', tostring(generation), state}
end
local next_generation = generation + 1
redis.call('HSET', state_key,
  'state', 'active',
  'generation', tostring(next_generation),
  'changed_at_ms', tostring(now_ms),
  'changed_by', actor,
  'reason', '')
redis.call('HDEL', state_key, 'resume_token_digest')
local first = redis.call('ZRANGE', permits_key, 0, 0, 'WITHSCORES')
return {'active', '1', 'active', tostring(next_generation), tostring(now_ms), actor,
  '', tostring(redis.call('ZCARD', permits_key)), first[2] or ''}
`;

const AUTOMATIC_BOOTSTRAP_ACTOR = 'worker-command-barrier-bootstrap';

/**
 * Global admission/job gate for the JetStream command plane.
 *
 * Every operation gets a short, payload-free permit before it starts. Pause is
 * a Redis CAS: after it commits no later caller can acquire a permit. Permits
 * already returned remain visible until release/lease expiry so the operator
 * can wait for a clean drain. Redis errors always reject acquisition.
 */
@singleton()
export class WorkerCommandOperationalBarrierService {
  constructor(@inject('Redis') private readonly redis: Redis) {}

  public async getStatus(): Promise<WorkerCommandOperationalBarrierStatus> {
    const raw = await runCriticalRedisOperation(
      'worker_command_operational_barrier_status',
      () =>
        this.redis.eval(
          STATUS_SCRIPT,
          2,
          WORKER_COMMAND_OPERATIONAL_BARRIER_STATE_KEY,
          WORKER_COMMAND_OPERATIONAL_BARRIER_PERMITS_KEY,
          AUTOMATIC_BOOTSTRAP_ACTOR
        )
    );
    return this.parseStatus(raw);
  }

  public async acquirePermit(
    scope: string
  ): Promise<WorkerCommandOperationalBarrierPermit> {
    const normalizedScope = this.text(
      scope,
      'scope',
      WORKER_COMMAND_OPERATIONAL_BARRIER_POLICY.maxScopeBytes
    );
    const member = `${normalizedScope}:${randomBytes(24).toString('base64url')}`;
    const raw = await runCriticalRedisOperation(
      'worker_command_operational_barrier_acquire',
      () =>
        this.redis.eval(
          ACQUIRE_SCRIPT,
          2,
          WORKER_COMMAND_OPERATIONAL_BARRIER_STATE_KEY,
          WORKER_COMMAND_OPERATIONAL_BARRIER_PERMITS_KEY,
          member,
          String(WORKER_COMMAND_OPERATIONAL_BARRIER_POLICY.permitLeaseMs),
          AUTOMATIC_BOOTSTRAP_ACTOR
        )
    );
    if (!Array.isArray(raw) || raw.length < 1) {
      throw this.corrupt('worker_command_operational_barrier_invalid_reply');
    }
    const disposition = String(raw[0] ?? '');
    if (disposition === 'paused') {
      const status = this.parseStatus(raw.slice(1));
      throw new WorkerCommandOperationalBarrierError(
        'paused',
        'worker_command_operational_barrier_paused',
        status
      );
    }
    if (disposition === 'corrupt') {
      throw this.corrupt('worker_command_operational_barrier_corrupt');
    }
    const generation = Number(raw[1]);
    const expiresAtMs = Number(raw[2]);
    if (
      disposition !== 'acquired' ||
      !Number.isSafeInteger(generation) ||
      generation < 1 ||
      !Number.isSafeInteger(expiresAtMs)
    ) {
      throw this.corrupt('worker_command_operational_barrier_invalid_reply');
    }
    return { member, generation, scope: normalizedScope, expiresAtMs };
  }

  public async releasePermit(
    permit: WorkerCommandOperationalBarrierPermit
  ): Promise<boolean> {
    const released = Number(
      await runCriticalRedisOperation(
        'worker_command_operational_barrier_release',
        () =>
          this.redis.eval(
            RELEASE_SCRIPT,
            1,
            WORKER_COMMAND_OPERATIONAL_BARRIER_PERMITS_KEY,
            permit.member
          )
      )
    );
    if (released !== 0 && released !== 1) {
      throw this.corrupt('worker_command_operational_barrier_invalid_reply');
    }
    return released === 1;
  }

  /**
   * Holds a visible permit for the full operation, refreshing its bounded
   * lease while work is active. A pause never grants new permits, but work
   * that already started remains visible until it completes so operators can
   * wait for `active_permits=0` instead of guessing.
   */
  public async runWithPermit<T>(
    scope: string,
    action: (signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    const permit = await this.acquirePermit(scope);
    const abort = new AbortController();
    let renewalError: unknown;
    let refreshInFlight: Promise<void> | null = null;
    const refresh = setInterval(() => {
      if (refreshInFlight) return;
      const current = this.renewPermit(permit)
        .catch((error: unknown) => {
          renewalError ??= error;
          if (!abort.signal.aborted) abort.abort(error);
        })
        .finally(() => {
          if (refreshInFlight === current) refreshInFlight = null;
        });
      refreshInFlight = current;
    }, WORKER_COMMAND_OPERATIONAL_BARRIER_POLICY.permitRefreshMs);
    refresh.unref?.();
    let value: T | undefined;
    let actionError: unknown;
    try {
      value = await action(abort.signal);
    } catch (error) {
      actionError = error;
    } finally {
      clearInterval(refresh);
      await refreshInFlight;
      await this.releasePermit(permit).catch(() => undefined);
    }
    if (renewalError) throw renewalError;
    if (actionError) throw actionError;
    return value as T;
  }

  public async pause(input: {
    expectedGeneration: number;
    actor: string;
    reason: string;
  }): Promise<WorkerCommandOperationalBarrierPauseResult> {
    this.generation(input.expectedGeneration);
    const actor = this.text(
      input.actor,
      'actor',
      WORKER_COMMAND_OPERATIONAL_BARRIER_POLICY.maxActorBytes
    );
    const reason = this.text(
      input.reason,
      'reason',
      WORKER_COMMAND_OPERATIONAL_BARRIER_POLICY.maxReasonBytes
    );
    const resumeToken = randomBytes(32).toString('base64url');
    const raw = await runCriticalRedisOperation(
      'worker_command_operational_barrier_pause',
      () =>
        this.redis.eval(
          PAUSE_SCRIPT,
          2,
          WORKER_COMMAND_OPERATIONAL_BARRIER_STATE_KEY,
          WORKER_COMMAND_OPERATIONAL_BARRIER_PERMITS_KEY,
          String(input.expectedGeneration),
          this.tokenDigest(resumeToken),
          actor,
          reason,
          AUTOMATIC_BOOTSTRAP_ACTOR
        )
    );
    const status = this.parseMutation(raw, 'paused');
    return { status, resume_token: resumeToken };
  }

  public async resume(input: {
    generation: number;
    token: string;
    actor: string;
  }): Promise<WorkerCommandOperationalBarrierStatus> {
    this.generation(input.generation);
    const actor = this.text(
      input.actor,
      'actor',
      WORKER_COMMAND_OPERATIONAL_BARRIER_POLICY.maxActorBytes
    );
    const token = this.text(input.token, 'token', 128);
    const raw = await runCriticalRedisOperation(
      'worker_command_operational_barrier_resume',
      () =>
        this.redis.eval(
          RESUME_SCRIPT,
          2,
          WORKER_COMMAND_OPERATIONAL_BARRIER_STATE_KEY,
          WORKER_COMMAND_OPERATIONAL_BARRIER_PERMITS_KEY,
          String(input.generation),
          this.tokenDigest(token),
          actor
        )
    );
    return this.parseMutation(raw, 'active');
  }

  private parseMutation(
    raw: unknown,
    expectedState: WorkerCommandOperationalBarrierState
  ): WorkerCommandOperationalBarrierStatus {
    if (!Array.isArray(raw) || raw.length < 1) {
      throw this.corrupt('worker_command_operational_barrier_invalid_reply');
    }
    const disposition = String(raw[0] ?? '');
    if (disposition === 'corrupt' || disposition === 'missing') {
      throw this.corrupt(`worker_command_operational_barrier_${disposition}`);
    }
    if (
      disposition === 'generation_conflict' ||
      disposition === 'state_conflict' ||
      disposition === 'token_conflict'
    ) {
      throw new WorkerCommandOperationalBarrierError(
        'conflict',
        `worker_command_operational_barrier_${disposition}`
      );
    }
    if (disposition !== expectedState) {
      throw this.corrupt('worker_command_operational_barrier_invalid_reply');
    }
    return this.parseStatus(raw.slice(1));
  }

  private async renewPermit(
    permit: WorkerCommandOperationalBarrierPermit
  ): Promise<void> {
    const renewed = Number(
      await runCriticalRedisOperation(
        'worker_command_operational_barrier_renew',
        () =>
          this.redis.eval(
            RENEW_SCRIPT,
            1,
            WORKER_COMMAND_OPERATIONAL_BARRIER_PERMITS_KEY,
            permit.member,
            String(WORKER_COMMAND_OPERATIONAL_BARRIER_POLICY.permitLeaseMs)
          )
      )
    );
    if (renewed !== 1) {
      throw this.corrupt('worker_command_operational_barrier_permit_lost');
    }
  }

  private parseStatus(raw: unknown): WorkerCommandOperationalBarrierStatus {
    if (!Array.isArray(raw) || raw.length !== 8) {
      throw this.corrupt('worker_command_operational_barrier_invalid_reply');
    }
    const schemaVersion = Number(raw[0]);
    const state = String(raw[1] ?? '');
    const generation = Number(raw[2]);
    const changedAtMs = Number(raw[3]);
    const changedBy = String(raw[4] ?? '');
    const reason = String(raw[5] ?? '');
    const activePermits = Number(raw[6]);
    const oldestPermitExpiresAtMs = String(raw[7] ?? '')
      ? Number(raw[7])
      : null;
    if (
      schemaVersion !== 1 ||
      (state !== 'active' && state !== 'paused') ||
      !Number.isSafeInteger(generation) ||
      generation < 1 ||
      !Number.isSafeInteger(changedAtMs) ||
      !changedBy ||
      !Number.isSafeInteger(activePermits) ||
      activePermits < 0 ||
      (oldestPermitExpiresAtMs !== null &&
        !Number.isSafeInteger(oldestPermitExpiresAtMs))
    ) {
      throw this.corrupt('worker_command_operational_barrier_corrupt');
    }
    return {
      schema_version: 1,
      state,
      generation,
      changed_at: new Date(changedAtMs).toISOString(),
      changed_by: changedBy,
      reason: reason || null,
      active_permits: activePermits,
      oldest_permit_expires_at:
        oldestPermitExpiresAtMs === null
          ? null
          : new Date(oldestPermitExpiresAtMs).toISOString(),
    };
  }

  private generation(value: number): void {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new WorkerCommandOperationalBarrierError(
        'conflict',
        'worker_command_operational_barrier_generation_invalid'
      );
    }
  }

  private text(value: string, field: string, maxBytes: number): string {
    const normalized = value.trim();
    if (
      !normalized ||
      normalized !== value ||
      Buffer.byteLength(normalized, 'utf8') > maxBytes ||
      /[\r\n\0]/u.test(normalized)
    ) {
      throw new WorkerCommandOperationalBarrierError(
        'conflict',
        `worker_command_operational_barrier_${field}_invalid`
      );
    }
    return normalized;
  }

  private tokenDigest(token: string): string {
    return createHash('sha256')
      .update(`worker-command-operational-barrier:v1\0${token}`)
      .digest('hex');
  }

  private corrupt(message: string): WorkerCommandOperationalBarrierError {
    return new WorkerCommandOperationalBarrierError('corrupt', message);
  }
}
