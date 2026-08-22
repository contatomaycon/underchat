import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { inject, injectable } from 'tsyringe';
import { runCriticalRedisOperation } from '@core/common/functions/criticalRedisOperation';

export type WhatsappRuntimeFenceProvider = 'baileys' | 'wwebjs' | 'whatsmeow';

export interface IWhatsappRuntimeFence {
  worker_id: string;
  runtime_generation: number;
  connection_epoch: string;
  connection_sequence: number;
  source_provider: WhatsappRuntimeFenceProvider;
  activated_at: number;
  state?: 'active';
  activation_order?: number;
}

interface IWhatsappRuntimeDeletionFence {
  worker_id: string;
  account_id: string;
  lifecycle_operation_id: string;
  state: 'deleting';
  revoked_at: number;
}

export interface IWhatsappRuntimeFencedEvent {
  worker_id?: string | null;
  runtime_generation?: number | string | null;
  connection_epoch?: string | null;
  source_provider?: string | null;
}

export type WhatsappRuntimeFenceAdmissionView =
  | {
      state: 'active';
      fence: IWhatsappRuntimeFence;
    }
  | {
      state: 'activating' | 'missing' | 'invalid';
    }
  | {
      state: 'revoked' | 'deleting';
      worker_id: string;
    };

export interface IWhatsappRuntimeFenceActivationInput {
  worker_id: string;
  runtime_generation: number;
  connection_epoch: string;
  source_provider: WhatsappRuntimeFenceProvider;
}

export type WhatsappRuntimeFenceBeginStatus =
  'acquired' | 'waiting' | 'draining' | 'superseded' | 'active';

export interface IWhatsappRuntimeFenceBeginResult {
  status: WhatsappRuntimeFenceBeginStatus;
  activation_order: number;
  activated_at: number;
  connection_sequence: number;
  active_effect_leases: number;
}

export interface IWhatsappRuntimeEffectLease {
  readonly fence: IWhatsappRuntimeFence | null;
  assertOwned(): void;
  assertOwnedRemote(): Promise<void>;
  release(): Promise<boolean>;
}

const BEGIN_RUNTIME_FENCE_ACTIVATION_SCRIPT = `
local incoming_generation = tonumber(ARGV[1]) or 0
local incoming_epoch = ARGV[2]
local incoming_provider = ARGV[3]
local incoming_worker = ARGV[4]
local lock_ttl_ms = tonumber(ARGV[5]) or 0
local lock_owner = ARGV[1] .. string.char(31) .. incoming_epoch
local order_field = ARGV[1] .. string.char(31) .. incoming_provider
  .. string.char(31) .. incoming_epoch

local current_raw = redis.call('GET', KEYS[1])
local current = nil
if current_raw then
  local decoded, value = pcall(cjson.decode, current_raw)
  if decoded then
    current = value
    if tostring(current.state or '') == 'deleting'
      or tostring(current.state or '') == 'revoked' then
      local blocked_order = tonumber(current.activation_order) or 1
      return {3, blocked_order, 0, 0, 0}
    end
    local current_generation = tonumber(current.runtime_generation) or 0
    local current_sequence = tonumber(current.connection_sequence) or 0
    local current_order = tonumber(current.activation_order) or 0
    local current_activated_at = tonumber(current.activated_at) or 0
    if current_generation == incoming_generation and current_order > 0 then
      local order_counter = tonumber(redis.call('HGET', KEYS[3], '__counter')) or 0
      if order_counter < current_order then
        redis.call('HSET', KEYS[3], '__counter', current_order)
      end
    end
    if current_generation == incoming_generation
      and tostring(current.connection_epoch or '') == incoming_epoch
      and tostring(current.source_provider or '') == incoming_provider
      and tostring(current.state or '') == 'active'
      and current_sequence > 0
      and current_order > 0
      and current_activated_at > 0 then
      if redis.call('GET', KEYS[2]) == lock_owner then
        redis.call('DEL', KEYS[2])
      end
      redis.call('HSET', KEYS[3], order_field, current_order)
      redis.call('EXPIRE', KEYS[3], tonumber(ARGV[6]))
      return {4, current_order, current_activated_at, current_sequence, 0}
    end
  end
end

local activation_order = tonumber(redis.call('HGET', KEYS[3], order_field))
if not activation_order then
  activation_order = redis.call('HINCRBY', KEYS[3], '__counter', 1)
  redis.call('HSET', KEYS[3], order_field, activation_order)
end
redis.call('EXPIRE', KEYS[3], tonumber(ARGV[6]))

if current then
  local current_generation = tonumber(current.runtime_generation) or 0
  local current_order = tonumber(current.activation_order) or 0
  if current_generation > incoming_generation
    or (current_generation == incoming_generation and current_order > activation_order)
    or (current_generation == incoming_generation
      and current_order == activation_order
      and (tostring(current.connection_epoch or '') ~= incoming_epoch
        or tostring(current.source_provider or '') ~= incoming_provider)) then
    if redis.call('GET', KEYS[2]) == lock_owner then
      redis.call('DEL', KEYS[2])
    end
    return {3, activation_order, 0, 0, 0}
  end
end

local activated_at = 0
if current
  and tonumber(current.runtime_generation) == incoming_generation
  and tonumber(current.activation_order) == activation_order
  and tostring(current.connection_epoch or '') == incoming_epoch
  and tostring(current.source_provider or '') == incoming_provider
  and tostring(current.state or '') == 'activating' then
  activated_at = tonumber(current.activated_at) or 0
end
if activated_at <= 0 then
  local redis_time = redis.call('TIME')
  activated_at = (tonumber(redis_time[1]) * 1000)
    + math.floor(tonumber(redis_time[2]) / 1000)
end

redis.call('SET', KEYS[1], cjson.encode({
  state = 'activating',
  worker_id = incoming_worker,
  runtime_generation = incoming_generation,
  connection_epoch = incoming_epoch,
  connection_sequence = 0,
  source_provider = incoming_provider,
  activated_at = activated_at,
  activation_order = activation_order
}))

local redis_time = redis.call('TIME')
local now_ms = (tonumber(redis_time[1]) * 1000)
  + math.floor(tonumber(redis_time[2]) / 1000)
local expired = redis.call('ZRANGEBYSCORE', KEYS[4], '-inf', now_ms)
for _, lease_id in ipairs(expired) do
  redis.call('HDEL', KEYS[5], lease_id)
end
if #expired > 0 then
  redis.call('ZREM', KEYS[4], unpack(expired))
end
local active_effect_leases = redis.call('ZCARD', KEYS[4])
if active_effect_leases > 0 then
  if redis.call('GET', KEYS[2]) == lock_owner then
    redis.call('DEL', KEYS[2])
  end
  return {5, activation_order, activated_at, 0, active_effect_leases}
end
redis.call('DEL', KEYS[4], KEYS[5])

local current_lock_owner = redis.call('GET', KEYS[2])
if not current_lock_owner then
  local acquired = redis.call('SET', KEYS[2], lock_owner, 'PX', lock_ttl_ms, 'NX')
  if acquired then
    return {1, activation_order, activated_at, 0, 0}
  end
  current_lock_owner = redis.call('GET', KEYS[2])
end
if current_lock_owner == lock_owner then
  redis.call('PEXPIRE', KEYS[2], lock_ttl_ms)
  return {1, activation_order, activated_at, 0, 0}
end
return {2, activation_order, activated_at, 0, 0}
`;

const FINALIZE_RUNTIME_FENCE_ACTIVATION_SCRIPT = `
local incoming_generation = tonumber(ARGV[1]) or 0
local incoming_epoch = ARGV[2]
local incoming_provider = ARGV[3]
local incoming_order = tonumber(ARGV[4]) or 0
local incoming_sequence = tonumber(ARGV[5]) or 0
local lock_owner = ARGV[1] .. string.char(31) .. incoming_epoch

local current_raw = redis.call('GET', KEYS[1])
if current_raw then
  local decoded, current = pcall(cjson.decode, current_raw)
  if decoded
    and tonumber(current.runtime_generation) == incoming_generation
    and tostring(current.connection_epoch or '') == incoming_epoch
    and tostring(current.source_provider or '') == incoming_provider
    and tonumber(current.activation_order) == incoming_order then
    if tostring(current.state or '') == 'active'
      and tonumber(current.connection_sequence) == incoming_sequence then
      if redis.call('GET', KEYS[2]) == lock_owner then
        redis.call('DEL', KEYS[2])
      end
      return 1
    end
    if tostring(current.state or '') == 'activating'
      and redis.call('GET', KEYS[2]) == lock_owner
      and incoming_sequence > 0 then
      local redis_time = redis.call('TIME')
      local now_ms = (tonumber(redis_time[1]) * 1000)
        + math.floor(tonumber(redis_time[2]) / 1000)
      local expired = redis.call('ZRANGEBYSCORE', KEYS[3], '-inf', now_ms)
      for _, lease_id in ipairs(expired) do
        redis.call('HDEL', KEYS[4], lease_id)
      end
      if #expired > 0 then
        redis.call('ZREM', KEYS[3], unpack(expired))
      end
      if redis.call('ZCARD', KEYS[3]) > 0 then
        return 0
      end
      redis.call('DEL', KEYS[3], KEYS[4])
      current.state = 'active'
      current.connection_sequence = incoming_sequence
      redis.call('SET', KEYS[1], cjson.encode(current))
      redis.call('DEL', KEYS[2])
      return 1
    end
  end
end

if redis.call('GET', KEYS[2]) == lock_owner then
  redis.call('DEL', KEYS[2])
end
return 0
`;

const ACQUIRE_RUNTIME_EFFECT_LEASE_SCRIPT = `
local expected_worker = ARGV[1]
local expected_generation = tonumber(ARGV[2]) or 0
local expected_epoch = ARGV[3]
local expected_provider = ARGV[4]
local lease_id = ARGV[5]
local owner_token = ARGV[6]
local lease_ttl_ms = tonumber(ARGV[7]) or 0
local registry_ttl_ms = tonumber(ARGV[8]) or 0

local redis_time = redis.call('TIME')
local now_ms = (tonumber(redis_time[1]) * 1000)
  + math.floor(tonumber(redis_time[2]) / 1000)
local expired = redis.call('ZRANGEBYSCORE', KEYS[2], '-inf', now_ms)
for _, expired_id in ipairs(expired) do
  redis.call('HDEL', KEYS[3], expired_id)
end
if #expired > 0 then
  redis.call('ZREM', KEYS[2], unpack(expired))
end

local current_raw = redis.call('GET', KEYS[1])
if not current_raw then
  return {0}
end
local decoded, current = pcall(cjson.decode, current_raw)
if not decoded
  or tostring(current.state or '') ~= 'active'
  or tostring(current.worker_id or '') ~= expected_worker
  or tostring(current.source_provider or '') ~= expected_provider
  or (tonumber(current.connection_sequence) or 0) <= 0
  or (tonumber(current.activation_order) or 0) <= 0 then
  return {0}
end
if (tonumber(current.runtime_generation) or 0) ~= expected_generation
  or tostring(current.connection_epoch or '') ~= expected_epoch then
  return {0}
end

local expires_at = now_ms + lease_ttl_ms
redis.call('HSET', KEYS[3], lease_id, owner_token)
redis.call('ZADD', KEYS[2], expires_at, lease_id)
redis.call('PEXPIRE', KEYS[2], registry_ttl_ms)
redis.call('PEXPIRE', KEYS[3], registry_ttl_ms)
return {1, current_raw, expires_at}
`;

const RENEW_RUNTIME_EFFECT_LEASE_SCRIPT = `
local lease_id = ARGV[1]
local owner_token = ARGV[2]
local lease_ttl_ms = tonumber(ARGV[3]) or 0
local registry_ttl_ms = tonumber(ARGV[4]) or 0
if redis.call('HGET', KEYS[2], lease_id) ~= owner_token then
  return {0, 0}
end
local redis_time = redis.call('TIME')
local now_ms = (tonumber(redis_time[1]) * 1000)
  + math.floor(tonumber(redis_time[2]) / 1000)
local current_expiry = tonumber(redis.call('ZSCORE', KEYS[1], lease_id)) or 0
if current_expiry <= now_ms then
  redis.call('HDEL', KEYS[2], lease_id)
  redis.call('ZREM', KEYS[1], lease_id)
  return {0, current_expiry}
end
local expires_at = now_ms + lease_ttl_ms
redis.call('ZADD', KEYS[1], expires_at, lease_id)
redis.call('PEXPIRE', KEYS[1], registry_ttl_ms)
redis.call('PEXPIRE', KEYS[2], registry_ttl_ms)
return {1, expires_at}
`;

const RELEASE_RUNTIME_EFFECT_LEASE_SCRIPT = `
local lease_id = ARGV[1]
local owner_token = ARGV[2]
if redis.call('HGET', KEYS[2], lease_id) ~= owner_token then
  return 0
end
redis.call('HDEL', KEYS[2], lease_id)
redis.call('ZREM', KEYS[1], lease_id)
if redis.call('ZCARD', KEYS[1]) == 0 then
  redis.call('DEL', KEYS[1], KEYS[2])
end
return 1
`;

const DEACTIVATE_RUNTIME_FENCE_SCRIPT = `
local lock_owner = ARGV[1] .. string.char(31) .. ARGV[2]
local changed = 0
local current_raw = redis.call('GET', KEYS[1])
if current_raw then
  local decoded, current = pcall(cjson.decode, current_raw)
  if not decoded then
    redis.call('DEL', KEYS[1])
    changed = 1
  elseif tostring(current.runtime_generation or '') == ARGV[1]
    and tostring(current.connection_epoch or '') == ARGV[2] then
    redis.call('DEL', KEYS[1])
    changed = 1
  end
end
if redis.call('GET', KEYS[2]) == lock_owner then
  redis.call('DEL', KEYS[2])
  changed = 1
end
return changed
`;

const REVOKE_RUNTIME_FENCE_SCRIPT = `
local incoming_worker = ARGV[1]
local incoming_state = ARGV[2]
local incoming_account = ARGV[3]
local incoming_operation = ARGV[4]
local current_raw = redis.call('GET', KEYS[1])
if current_raw then
  local decoded, current = pcall(cjson.decode, current_raw)
  if decoded and (tostring(current.state or '') == 'deleting'
    or tostring(current.state or '') == 'revoked') then
    if tostring(current.worker_id or '') ~= incoming_worker then
      return -1
    end
    if tostring(current.state or '') == 'deleting' then
      if incoming_state ~= 'deleting'
        or tostring(current.account_id or '') ~= incoming_account
        or tostring(current.lifecycle_operation_id or '') ~= incoming_operation then
        return -1
      end
    elseif incoming_state == 'deleting' then
      return -1
    end
    redis.call('DEL', KEYS[2], KEYS[3], KEYS[4])
    return 0
  end
end
local redis_time = redis.call('TIME')
local revoked_at = (tonumber(redis_time[1]) * 1000)
  + math.floor(tonumber(redis_time[2]) / 1000)
redis.call('SET', KEYS[1], cjson.encode({
  state = incoming_state,
  worker_id = incoming_worker,
  account_id = incoming_account,
  lifecycle_operation_id = incoming_operation,
  revoked_at = revoked_at
}))
redis.call('DEL', KEYS[2], KEYS[3], KEYS[4])
return 1
`;

const SET_IF_CURRENT_RUNTIME_FENCE_SCRIPT = `
local current_raw = redis.call('GET', KEYS[1])
if not current_raw then
  return 0
end
local decoded, current = pcall(cjson.decode, current_raw)
if not decoded then
  return 0
end
if tostring(current.runtime_generation or '') ~= ARGV[1] then
  return 0
end
if tostring(current.connection_epoch or '') ~= ARGV[2] then
  return 0
end
if tostring(current.source_provider or '') ~= ARGV[3] then
  return 0
end
if tostring(current.state or '') ~= 'active' then
  return 0
end
if (tonumber(current.connection_sequence) or 0) <= 0 then
  return 0
end
redis.call('SET', KEYS[2], ARGV[4], 'EX', ARGV[5])
return 1
`;

export class WhatsappRuntimeEffectLeaseLostError extends Error {
  constructor() {
    super('WhatsApp runtime effect lease is no longer owned');
    this.name = 'WhatsappRuntimeEffectLeaseLostError';
  }
}

const UNFENCED_RUNTIME_EFFECT_LEASE: IWhatsappRuntimeEffectLease = {
  fence: null,
  assertOwned: () => undefined,
  assertOwnedRemote: async () => undefined,
  release: async () => false,
};

class WhatsappRuntimeEffectLease implements IWhatsappRuntimeEffectLease {
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private renewing: Promise<void> | null = null;
  private released = false;
  private lost = false;

  constructor(
    private readonly redis: Redis,
    public readonly fence: IWhatsappRuntimeFence,
    private readonly leasesKey: string,
    private readonly ownersKey: string,
    private readonly leaseId: string,
    private readonly ownerToken: string,
    private readonly leaseTtlMs: number,
    private readonly heartbeatMs: number,
    private readonly registryTtlMs: number,
    private expiresAt: number
  ) {
    this.scheduleHeartbeat();
  }

  assertOwned(): void {
    if (this.released || this.lost || Date.now() >= this.expiresAt) {
      this.lost = true;
      throw new WhatsappRuntimeEffectLeaseLostError();
    }
  }

  async assertOwnedRemote(): Promise<void> {
    this.assertOwned();
    await this.renew();
    this.assertOwned();
  }

  async release(): Promise<boolean> {
    if (this.released) {
      return false;
    }
    this.released = true;
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    await this.renewing?.catch(() => undefined);
    const result = await runCriticalRedisOperation(
      'runtime_effect_lease_release',
      () =>
        this.redis.eval(
          RELEASE_RUNTIME_EFFECT_LEASE_SCRIPT,
          2,
          this.leasesKey,
          this.ownersKey,
          this.leaseId,
          this.ownerToken
        )
    );
    return Number(result) === 1;
  }

  private scheduleHeartbeat(): void {
    if (this.released || this.lost) {
      return;
    }
    this.heartbeatTimer = setTimeout(() => {
      this.heartbeatTimer = null;
      this.renewing = this.renew()
        .catch(() => {
          if (Date.now() >= this.expiresAt) {
            this.lost = true;
          }
        })
        .finally(() => {
          this.renewing = null;
          this.scheduleHeartbeat();
        });
    }, this.heartbeatMs);
    this.heartbeatTimer.unref?.();
  }

  private async renew(): Promise<void> {
    if (this.released || this.lost) {
      return;
    }
    const result = await runCriticalRedisOperation(
      'runtime_effect_lease_renew',
      () =>
        this.redis.eval(
          RENEW_RUNTIME_EFFECT_LEASE_SCRIPT,
          2,
          this.leasesKey,
          this.ownersKey,
          this.leaseId,
          this.ownerToken,
          String(this.leaseTtlMs),
          String(this.registryTtlMs)
        )
    );
    if (!Array.isArray(result) || Number(result[0]) !== 1) {
      this.lost = true;
      throw new WhatsappRuntimeEffectLeaseLostError();
    }
    const expiresAt = Number(result[1]);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      this.lost = true;
      throw new WhatsappRuntimeEffectLeaseLostError();
    }
    this.expiresAt = Math.floor(expiresAt);
  }
}

@injectable()
export class WhatsappRuntimeFenceService {
  private static readonly keyPrefix = 'whatsapp:runtime-fence:v1';
  private static readonly activationLockTtlMs = 60000;
  private static readonly activationOrdersTtlSeconds = 30 * 24 * 60 * 60;
  private static readonly defaultEffectLeaseTtlMs = 45 * 1000;
  private static readonly defaultEffectLeaseHeartbeatMs = 5 * 1000;
  private static readonly maxEffectLeaseHeartbeatMs = 15 * 1000;
  private static readonly managedProviders = new Set<string>([
    'baileys',
    'wwebjs',
    'whatsmeow',
  ]);
  private static readonly unfencedProviders = new Set<string>([
    'official_whatsapp',
    'webhook',
  ]);
  private readonly strictEvents =
    process.env.NODE_ENV?.trim().toLowerCase() === 'production' ||
    this.readBooleanEnv('WHATSAPP_RUNTIME_FENCE_STRICT_EVENTS', false);
  private readonly effectLeaseTtlMs = Math.max(
    6,
    this.readPositiveIntegerEnv(
      'WHATSAPP_RUNTIME_EFFECT_LEASE_TTL_MS',
      WhatsappRuntimeFenceService.defaultEffectLeaseTtlMs
    )
  );
  private readonly effectLeaseHeartbeatMs = Math.min(
    this.readPositiveIntegerEnv(
      'WHATSAPP_RUNTIME_EFFECT_LEASE_HEARTBEAT_MS',
      WhatsappRuntimeFenceService.defaultEffectLeaseHeartbeatMs
    ),
    WhatsappRuntimeFenceService.maxEffectLeaseHeartbeatMs,
    Math.max(1, Math.floor(this.effectLeaseTtlMs / 6))
  );
  private readonly effectLeaseRegistryTtlMs = Math.max(
    60 * 60 * 1000,
    this.effectLeaseTtlMs * 3
  );

  constructor(@inject('Redis') private readonly redis: Redis) {}

  static key(workerId: string): string {
    return `${WhatsappRuntimeFenceService.keyPrefix}:${workerId}`;
  }

  static activationLockKey(workerId: string): string {
    return `${WhatsappRuntimeFenceService.keyPrefix}:${workerId}:activation-lock`;
  }

  static activationOrdersKey(
    workerId: string,
    runtimeGeneration: number
  ): string {
    return `${WhatsappRuntimeFenceService.keyPrefix}:${workerId}:activation-orders:${runtimeGeneration}`;
  }

  static effectLeasesKey(workerId: string): string {
    return `${WhatsappRuntimeFenceService.keyPrefix}:${workerId}:effect-leases`;
  }

  static effectLeaseOwnersKey(workerId: string): string {
    return `${WhatsappRuntimeFenceService.keyPrefix}:${workerId}:effect-lease-owners`;
  }

  static requiresFence(sourceProvider?: string | null): boolean {
    return WhatsappRuntimeFenceService.managedProviders.has(
      sourceProvider?.trim().toLowerCase() ?? ''
    );
  }

  async beginActivation(
    input: IWhatsappRuntimeFenceActivationInput
  ): Promise<IWhatsappRuntimeFenceBeginResult> {
    const normalized = this.normalizeActivationInput(input);
    if (!normalized) {
      throw new TypeError('Invalid WhatsApp runtime fence activation');
    }

    const result = await this.redis.eval(
      BEGIN_RUNTIME_FENCE_ACTIVATION_SCRIPT,
      5,
      WhatsappRuntimeFenceService.key(normalized.worker_id),
      WhatsappRuntimeFenceService.activationLockKey(normalized.worker_id),
      WhatsappRuntimeFenceService.activationOrdersKey(
        normalized.worker_id,
        normalized.runtime_generation
      ),
      WhatsappRuntimeFenceService.effectLeasesKey(normalized.worker_id),
      WhatsappRuntimeFenceService.effectLeaseOwnersKey(normalized.worker_id),
      String(normalized.runtime_generation),
      normalized.connection_epoch,
      normalized.source_provider,
      normalized.worker_id,
      String(WhatsappRuntimeFenceService.activationLockTtlMs),
      String(WhatsappRuntimeFenceService.activationOrdersTtlSeconds)
    );

    if (!Array.isArray(result) || result.length < 5) {
      throw new Error('Redis returned an invalid runtime-fence begin result');
    }

    const code = Number(result[0]);
    const activationOrder = Number(result[1]);
    const activatedAt = Number(result[2]);
    const connectionSequence = Number(result[3]);
    const activeEffectLeases = Number(result[4]);
    const status: WhatsappRuntimeFenceBeginStatus | undefined = {
      1: 'acquired',
      2: 'waiting',
      3: 'superseded',
      4: 'active',
      5: 'draining',
    }[code] as WhatsappRuntimeFenceBeginStatus | undefined;

    if (
      !status ||
      !Number.isSafeInteger(activationOrder) ||
      activationOrder <= 0 ||
      (status !== 'superseded' &&
        (!Number.isFinite(activatedAt) || activatedAt <= 0)) ||
      (status === 'active' &&
        (!Number.isSafeInteger(connectionSequence) ||
          connectionSequence <= 0)) ||
      !Number.isSafeInteger(activeEffectLeases) ||
      activeEffectLeases < 0 ||
      (status === 'draining' && activeEffectLeases <= 0)
    ) {
      throw new Error('Redis returned an invalid runtime-fence begin result');
    }

    return {
      status,
      activation_order: activationOrder,
      activated_at: Math.floor(activatedAt),
      connection_sequence:
        Number.isSafeInteger(connectionSequence) && connectionSequence > 0
          ? connectionSequence
          : 0,
      active_effect_leases: activeEffectLeases,
    };
  }

  async finalizeActivation(
    input: IWhatsappRuntimeFenceActivationInput & {
      activation_order: number;
      connection_sequence: number;
    }
  ): Promise<boolean> {
    const normalized = this.normalizeActivationInput(input);
    const activationOrder = Number(input.activation_order);
    const connectionSequence = Number(input.connection_sequence);
    if (
      !normalized ||
      !Number.isSafeInteger(activationOrder) ||
      activationOrder <= 0 ||
      !Number.isSafeInteger(connectionSequence) ||
      connectionSequence <= 0
    ) {
      throw new TypeError('Invalid WhatsApp runtime fence finalization');
    }

    const result = await this.redis.eval(
      FINALIZE_RUNTIME_FENCE_ACTIVATION_SCRIPT,
      4,
      WhatsappRuntimeFenceService.key(normalized.worker_id),
      WhatsappRuntimeFenceService.activationLockKey(normalized.worker_id),
      WhatsappRuntimeFenceService.effectLeasesKey(normalized.worker_id),
      WhatsappRuntimeFenceService.effectLeaseOwnersKey(normalized.worker_id),
      String(normalized.runtime_generation),
      normalized.connection_epoch,
      normalized.source_provider,
      String(activationOrder),
      String(connectionSequence)
    );

    return Number(result) === 1;
  }

  /**
   * Compatibility helper for callers that already hold the canonical
   * PostgreSQL sequence. New connection paths use begin -> database ->
   * finalize explicitly so the Redis fence is fail-closed during cutover.
   */
  async activate(input: IWhatsappRuntimeFence): Promise<boolean> {
    const begin = await this.beginActivation(input);
    if (begin.status === 'active') {
      return begin.connection_sequence === Number(input.connection_sequence);
    }
    if (begin.status !== 'acquired') {
      return false;
    }
    return this.finalizeActivation({
      ...input,
      activation_order: begin.activation_order,
    });
  }

  async deactivate(
    workerId: string,
    runtimeGeneration: number,
    connectionEpoch: string
  ): Promise<boolean> {
    const normalizedWorkerId = this.nonEmpty(workerId);
    const normalizedEpoch = this.nonEmpty(connectionEpoch);
    if (
      !normalizedWorkerId ||
      !normalizedEpoch ||
      !Number.isSafeInteger(runtimeGeneration) ||
      runtimeGeneration <= 0
    ) {
      return false;
    }

    const result = await this.redis.eval(
      DEACTIVATE_RUNTIME_FENCE_SCRIPT,
      2,
      WhatsappRuntimeFenceService.key(normalizedWorkerId),
      WhatsappRuntimeFenceService.activationLockKey(normalizedWorkerId),
      String(runtimeGeneration),
      normalizedEpoch
    );

    return Number(result) === 1;
  }

  /**
   * Permanently deleting a worker must invalidate its runtime without relying
   * on the worker container to acknowledge a best-effort shutdown request.
   * Removing the effect registries also makes already-running consumers lose
   * their lease at the next ownership checkpoint.
   */
  async revoke(workerId: string): Promise<boolean> {
    const normalizedWorkerId = this.nonEmpty(workerId);
    if (!normalizedWorkerId) {
      return false;
    }

    const result = await this.redis.eval(
      REVOKE_RUNTIME_FENCE_SCRIPT,
      4,
      WhatsappRuntimeFenceService.key(normalizedWorkerId),
      WhatsappRuntimeFenceService.activationLockKey(normalizedWorkerId),
      WhatsappRuntimeFenceService.effectLeasesKey(normalizedWorkerId),
      WhatsappRuntimeFenceService.effectLeaseOwnersKey(normalizedWorkerId),
      normalizedWorkerId,
      'revoked',
      '',
      ''
    );

    if (Number(result) < 0) {
      throw new Error('WhatsApp runtime revocation conflicts with deletion');
    }
    return Number(result) === 0 || Number(result) === 1;
  }

  async revokeForDeletion(
    workerId: string,
    accountId: string,
    lifecycleOperationId: string
  ): Promise<boolean> {
    const normalizedWorkerId = this.nonEmpty(workerId);
    const normalizedAccountId = this.nonEmpty(accountId);
    const normalizedOperationId = this.nonEmpty(lifecycleOperationId);
    if (!normalizedWorkerId || !normalizedAccountId || !normalizedOperationId) {
      throw new TypeError('Invalid WhatsApp runtime deletion revocation');
    }

    const result = Number(
      await this.redis.eval(
        REVOKE_RUNTIME_FENCE_SCRIPT,
        4,
        WhatsappRuntimeFenceService.key(normalizedWorkerId),
        WhatsappRuntimeFenceService.activationLockKey(normalizedWorkerId),
        WhatsappRuntimeFenceService.effectLeasesKey(normalizedWorkerId),
        WhatsappRuntimeFenceService.effectLeaseOwnersKey(normalizedWorkerId),
        normalizedWorkerId,
        'deleting',
        normalizedAccountId,
        normalizedOperationId
      )
    );
    if (result < 0) {
      throw new Error('WhatsApp runtime deletion revocation conflict');
    }
    return result === 0 || result === 1;
  }

  async assertDeletionRevoked(
    workerId: string,
    accountId: string,
    lifecycleOperationId: string
  ): Promise<void> {
    const raw = await this.redis.get(WhatsappRuntimeFenceService.key(workerId));
    let fence: IWhatsappRuntimeDeletionFence | null = null;
    try {
      fence = raw ? (JSON.parse(raw) as IWhatsappRuntimeDeletionFence) : null;
    } catch {
      fence = null;
    }
    if (
      fence?.state !== 'deleting' ||
      fence.worker_id !== workerId ||
      fence.account_id !== accountId ||
      fence.lifecycle_operation_id !== lifecycleOperationId ||
      !Number.isFinite(Number(fence.revoked_at)) ||
      Number(fence.revoked_at) <= 0
    ) {
      throw new Error('WhatsApp runtime deletion revocation was not confirmed');
    }
  }

  async assertRevoked(workerId: string): Promise<void> {
    const raw = await this.redis.get(WhatsappRuntimeFenceService.key(workerId));
    let state: { worker_id?: string; state?: string } | null = null;
    try {
      state = raw
        ? (JSON.parse(raw) as { worker_id?: string; state?: string })
        : null;
    } catch {
      state = null;
    }
    if (
      state?.worker_id !== workerId ||
      (state.state !== 'revoked' && state.state !== 'deleting')
    ) {
      throw new Error('WhatsApp runtime revocation was not confirmed');
    }
  }

  async acquireEffectLease(
    input: IWhatsappRuntimeFencedEvent
  ): Promise<IWhatsappRuntimeEffectLease | null> {
    const sourceProvider = input.source_provider?.trim().toLowerCase() ?? null;
    if (!WhatsappRuntimeFenceService.requiresFence(sourceProvider)) {
      return !this.strictEvents ||
        WhatsappRuntimeFenceService.unfencedProviders.has(sourceProvider ?? '')
        ? UNFENCED_RUNTIME_EFFECT_LEASE
        : null;
    }
    const normalized = this.normalizeActivationInput({
      worker_id: input.worker_id ?? '',
      runtime_generation: Number(input.runtime_generation),
      connection_epoch: input.connection_epoch ?? '',
      source_provider: sourceProvider as WhatsappRuntimeFenceProvider,
    });
    if (!normalized) {
      return null;
    }
    return this.acquireEffectLeaseInternal(normalized);
  }

  async view(workerId: string): Promise<IWhatsappRuntimeFence | null> {
    const normalizedWorkerId = this.nonEmpty(workerId);
    if (!normalizedWorkerId) {
      return null;
    }

    const raw = await runCriticalRedisOperation('runtime_fence_view', () =>
      this.redis.get(WhatsappRuntimeFenceService.key(normalizedWorkerId))
    );
    if (!raw) {
      return null;
    }

    try {
      return this.normalizeFence(JSON.parse(raw) as IWhatsappRuntimeFence);
    } catch {
      return null;
    }
  }

  /**
   * Runtime generations must remain monotonic even when an interrupted
   * provider switch has lost or rebuilt the worker_runtime row. Redis is the
   * last durable fence seen by every provider, so a replacement generation
   * must be strictly greater than an active or activating value stored here.
   * Tombstones and malformed values intentionally block provisioning.
   */
  async viewRuntimeGenerationFloor(workerId: string): Promise<number | null> {
    const normalizedWorkerId = this.nonEmpty(workerId);
    if (!normalizedWorkerId) {
      throw new TypeError('Invalid WhatsApp runtime generation floor worker');
    }

    const raw = await runCriticalRedisOperation(
      'runtime_fence_generation_floor_view',
      () => this.redis.get(WhatsappRuntimeFenceService.key(normalizedWorkerId))
    );
    if (!raw) {
      return null;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw new Error('Invalid WhatsApp runtime generation floor');
    }

    const runtimeGeneration = Number(parsed.runtime_generation);
    if (
      parsed.worker_id !== normalizedWorkerId ||
      (parsed.state !== 'active' && parsed.state !== 'activating') ||
      !Number.isSafeInteger(runtimeGeneration) ||
      runtimeGeneration <= 0
    ) {
      throw new Error('WhatsApp runtime generation floor blocks provisioning');
    }

    return runtimeGeneration;
  }

  /**
   * Admission needs to distinguish a temporary cutover window from a durable
   * lifecycle tombstone. `view()` intentionally exposes active fences only;
   * auxiliary consumers use this richer read to avoid both stale mutations
   * and infinite redelivery after permanent worker deletion.
   */
  async viewAdmissionState(
    workerId: string
  ): Promise<WhatsappRuntimeFenceAdmissionView> {
    const normalizedWorkerId = this.nonEmpty(workerId);
    if (!normalizedWorkerId) {
      return { state: 'invalid' };
    }

    const raw = await runCriticalRedisOperation(
      'runtime_fence_admission_view',
      () => this.redis.get(WhatsappRuntimeFenceService.key(normalizedWorkerId))
    );
    if (!raw) {
      return { state: 'missing' };
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return { state: 'invalid' };
    }
    if (parsed.worker_id !== normalizedWorkerId) {
      return { state: 'invalid' };
    }

    const active = this.normalizeFence(
      parsed as unknown as IWhatsappRuntimeFence
    );
    if (active) {
      return { state: 'active', fence: active };
    }

    if (parsed.state === 'revoked' || parsed.state === 'deleting') {
      return {
        state: parsed.state,
        worker_id: normalizedWorkerId,
      };
    }
    if (parsed.state === 'activating') {
      return { state: 'activating' };
    }
    return { state: 'invalid' };
  }

  async isCurrent(input: IWhatsappRuntimeFencedEvent): Promise<boolean> {
    const sourceProvider = input.source_provider?.trim().toLowerCase() ?? null;
    if (!WhatsappRuntimeFenceService.requiresFence(sourceProvider)) {
      return (
        !this.strictEvents ||
        WhatsappRuntimeFenceService.unfencedProviders.has(sourceProvider ?? '')
      );
    }

    const workerId = this.nonEmpty(input.worker_id);
    const connectionEpoch = this.nonEmpty(input.connection_epoch);
    const runtimeGeneration = Number(input.runtime_generation);
    if (
      !workerId ||
      !connectionEpoch ||
      !Number.isSafeInteger(runtimeGeneration) ||
      runtimeGeneration <= 0
    ) {
      return false;
    }

    const active = await this.view(workerId);
    if (!active) {
      return false;
    }

    return (
      active.worker_id === workerId &&
      active.runtime_generation === runtimeGeneration &&
      active.connection_epoch === connectionEpoch &&
      active.source_provider === sourceProvider
    );
  }

  async setValueIfCurrent(
    input: IWhatsappRuntimeFencedEvent,
    key: string,
    value: string,
    ttlSeconds: number
  ): Promise<boolean> {
    const normalizedKey = this.nonEmpty(key);
    if (
      !normalizedKey ||
      !Number.isSafeInteger(ttlSeconds) ||
      ttlSeconds <= 0
    ) {
      throw new TypeError('Invalid fenced Redis write');
    }

    const sourceProvider = input.source_provider?.trim().toLowerCase() ?? null;
    if (!WhatsappRuntimeFenceService.requiresFence(sourceProvider)) {
      if (
        this.strictEvents &&
        !WhatsappRuntimeFenceService.unfencedProviders.has(sourceProvider ?? '')
      ) {
        return false;
      }
      await this.redis.set(normalizedKey, value, 'EX', ttlSeconds);
      return true;
    }

    const workerId = this.nonEmpty(input.worker_id);
    const connectionEpoch = this.nonEmpty(input.connection_epoch);
    const runtimeGeneration = Number(input.runtime_generation);
    if (
      !workerId ||
      !connectionEpoch ||
      !Number.isSafeInteger(runtimeGeneration) ||
      runtimeGeneration <= 0
    ) {
      return false;
    }

    const result = await this.redis.eval(
      SET_IF_CURRENT_RUNTIME_FENCE_SCRIPT,
      2,
      WhatsappRuntimeFenceService.key(workerId),
      normalizedKey,
      String(runtimeGeneration),
      connectionEpoch,
      sourceProvider ?? '',
      value,
      String(ttlSeconds)
    );
    return Number(result) === 1;
  }

  private normalizeFence(
    input: IWhatsappRuntimeFence
  ): IWhatsappRuntimeFence | null {
    const workerId = this.nonEmpty(input.worker_id);
    const connectionEpoch = this.nonEmpty(input.connection_epoch);
    const sourceProvider = input.source_provider?.trim().toLowerCase();
    const runtimeGeneration = Number(input.runtime_generation);
    const connectionSequence = Number(input.connection_sequence);
    const activatedAt = Number(input.activated_at);
    const activationOrder = Number(input.activation_order);

    if (
      !workerId ||
      !connectionEpoch ||
      !WhatsappRuntimeFenceService.requiresFence(sourceProvider) ||
      !Number.isSafeInteger(runtimeGeneration) ||
      runtimeGeneration <= 0 ||
      !Number.isSafeInteger(connectionSequence) ||
      connectionSequence <= 0 ||
      !Number.isFinite(activatedAt) ||
      activatedAt <= 0 ||
      input.state !== 'active' ||
      !Number.isSafeInteger(activationOrder) ||
      activationOrder <= 0
    ) {
      return null;
    }

    return {
      worker_id: workerId,
      runtime_generation: runtimeGeneration,
      connection_epoch: connectionEpoch,
      connection_sequence: connectionSequence,
      source_provider: sourceProvider as WhatsappRuntimeFenceProvider,
      activated_at: Math.floor(activatedAt),
      state: 'active',
      activation_order: activationOrder,
    };
  }

  private async acquireEffectLeaseInternal(
    input: IWhatsappRuntimeFenceActivationInput
  ): Promise<IWhatsappRuntimeEffectLease | null> {
    const leaseId = randomUUID();
    const ownerToken = randomUUID();
    const leasesKey = WhatsappRuntimeFenceService.effectLeasesKey(
      input.worker_id
    );
    const ownersKey = WhatsappRuntimeFenceService.effectLeaseOwnersKey(
      input.worker_id
    );
    const result = await runCriticalRedisOperation(
      'runtime_effect_lease_acquire',
      () =>
        this.redis.eval(
          ACQUIRE_RUNTIME_EFFECT_LEASE_SCRIPT,
          3,
          WhatsappRuntimeFenceService.key(input.worker_id),
          leasesKey,
          ownersKey,
          input.worker_id,
          String(input.runtime_generation),
          input.connection_epoch,
          input.source_provider,
          leaseId,
          ownerToken,
          String(this.effectLeaseTtlMs),
          String(this.effectLeaseRegistryTtlMs)
        )
    );
    if (!Array.isArray(result) || Number(result[0]) !== 1) {
      return null;
    }
    const rawFence = String(result[1] ?? '');
    const expiresAt = Number(result[2]);
    let activeFence: IWhatsappRuntimeFence | null = null;
    try {
      activeFence = this.normalizeFence(
        JSON.parse(rawFence) as IWhatsappRuntimeFence
      );
    } catch {
      activeFence = null;
    }
    if (
      !activeFence ||
      activeFence.worker_id !== input.worker_id ||
      activeFence.source_provider !== input.source_provider ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= Date.now()
    ) {
      await this.redis
        .eval(
          RELEASE_RUNTIME_EFFECT_LEASE_SCRIPT,
          2,
          leasesKey,
          ownersKey,
          leaseId,
          ownerToken
        )
        .catch(() => undefined);
      return null;
    }

    return new WhatsappRuntimeEffectLease(
      this.redis,
      activeFence,
      leasesKey,
      ownersKey,
      leaseId,
      ownerToken,
      this.effectLeaseTtlMs,
      this.effectLeaseHeartbeatMs,
      this.effectLeaseRegistryTtlMs,
      Math.floor(expiresAt)
    );
  }

  private normalizeActivationInput(
    input: IWhatsappRuntimeFenceActivationInput
  ): IWhatsappRuntimeFenceActivationInput | null {
    const workerId = this.nonEmpty(input.worker_id);
    const connectionEpoch = this.nonEmpty(input.connection_epoch);
    const sourceProvider = input.source_provider?.trim().toLowerCase();
    const runtimeGeneration = Number(input.runtime_generation);
    if (
      !workerId ||
      !connectionEpoch ||
      !WhatsappRuntimeFenceService.requiresFence(sourceProvider) ||
      !Number.isSafeInteger(runtimeGeneration) ||
      runtimeGeneration <= 0
    ) {
      return null;
    }

    return {
      worker_id: workerId,
      runtime_generation: runtimeGeneration,
      connection_epoch: connectionEpoch,
      source_provider: sourceProvider as WhatsappRuntimeFenceProvider,
    };
  }

  private nonEmpty(value?: string | null): string | null {
    const normalized = value?.trim();
    return normalized || null;
  }

  private readBooleanEnv(name: string, fallback: boolean): boolean {
    const raw = process.env[name]?.trim().toLowerCase();
    if (!raw) {
      return fallback;
    }
    if (['1', 'true', 'yes', 'on'].includes(raw)) {
      return true;
    }
    if (['0', 'false', 'no', 'off'].includes(raw)) {
      return false;
    }
    return fallback;
  }

  private readPositiveIntegerEnv(name: string, fallback: number): number {
    const value = Number(process.env[name]);
    return Number.isSafeInteger(value) && value > 0 ? value : fallback;
  }
}
