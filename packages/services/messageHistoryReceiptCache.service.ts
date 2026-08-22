import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { IUpsertMessage } from '@core/common/interfaces/IUpsertMessage';
import { ensureInboundEventId } from '@core/common/functions/inboundEventIdentity';

interface IMessageHistoryCacheOptions {
  knownTtlSeconds?: number;
  inflightTtlSeconds?: number;
}

export type MessageHistoryReceiptState =
  'reserved' | 'publishing' | 'known' | 'published' | 'ambiguous';

export interface IMessageHistoryReceiptClaim {
  key: string;
  owner: string;
  eventId: string;
  state: 'reserved';
}

export type MessageHistoryReceiptReservation =
  | {
      status: 'acquired';
      claim: IMessageHistoryReceiptClaim;
    }
  | {
      status: 'duplicate';
      state: MessageHistoryReceiptState;
      eventId: string;
    };

export type MessageHistoryReceiptTransitionStatus =
  | 'transitioned'
  | 'already_completed'
  | 'owner_mismatch'
  | 'lease_expired'
  | 'invalid_state'
  | 'not_found';

const RESERVE_RECEIPT_SCRIPT = `
-- message_history_receipt_reserve_v3
local key = KEYS[1]
local owner = ARGV[1]
local event_id = ARGV[2]
local lease_ms = tonumber(ARGV[3])
local retention_seconds = tonumber(ARGV[4])

local redis_time = redis.call('TIME')
local now_ms =
  (tonumber(redis_time[1]) * 1000) + math.floor(tonumber(redis_time[2]) / 1000)
local lease_until_ms = now_ms + lease_ms
local state = redis.call('HGET', key, 'state')

if not state and redis.call('EXISTS', key) == 1 then
  state = 'ambiguous'
  redis.call('HSET', key,
    'schema_version', '3',
    'state', state,
    'owner', '',
    'lease_until_ms', '0',
    'updated_at_ms', tostring(now_ms),
    'error', 'receipt state missing')
  redis.call('EXPIRE', key, retention_seconds)
  return { 'duplicate', state }
end

if state then
  if state == 'reserved' then
    local current_lease_ms =
      tonumber(redis.call('HGET', key, 'lease_until_ms') or '0')
    if current_lease_ms <= now_ms then
      redis.call('HSET', key,
        'schema_version', '3',
        'state', 'reserved',
        'owner', owner,
        'event_id', event_id,
        'lease_until_ms', tostring(lease_until_ms),
        'updated_at_ms', tostring(now_ms),
        'error', '')
      redis.call('EXPIRE', key, retention_seconds)
      return { 'acquired', 'reserved' }
    end
  elseif state ~= 'publishing'
    and state ~= 'known'
    and state ~= 'published'
    and state ~= 'ambiguous' then
    state = 'ambiguous'
    redis.call('HSET', key,
      'schema_version', '3',
      'state', state,
      'owner', '',
      'lease_until_ms', '0',
      'updated_at_ms', tostring(now_ms),
      'error', 'invalid receipt state')
  end

  redis.call('EXPIRE', key, retention_seconds)
  return { 'duplicate', state }
end

redis.call('HSET', key,
  'schema_version', '3',
  'state', 'reserved',
  'owner', owner,
  'event_id', event_id,
  'lease_until_ms', tostring(lease_until_ms),
  'updated_at_ms', tostring(now_ms),
  'error', '')
redis.call('EXPIRE', key, retention_seconds)
return { 'acquired', 'reserved' }
`;

const MARK_KNOWN_SCRIPT = `
-- message_history_receipt_mark_known_v3
local key = KEYS[1]
local event_id = ARGV[1]
local retention_seconds = tonumber(ARGV[2])
local redis_time = redis.call('TIME')
local now_ms =
  (tonumber(redis_time[1]) * 1000) + math.floor(tonumber(redis_time[2]) / 1000)

redis.call('HSET', key,
  'schema_version', '3',
  'state', 'known',
  'owner', '',
  'event_id', event_id,
  'lease_until_ms', '0',
  'updated_at_ms', tostring(now_ms),
  'error', '')
redis.call('EXPIRE', key, retention_seconds)
return 1
`;

const EXTEND_RESERVATION_SCRIPT = `
-- message_history_receipt_extend_v3
local key = KEYS[1]
local owner = ARGV[1]
local lease_ms = tonumber(ARGV[2])
local retention_seconds = tonumber(ARGV[3])

local state = redis.call('HGET', key, 'state')
if state ~= 'reserved' and state ~= 'publishing' then
  return 0
end
if redis.call('HGET', key, 'owner') ~= owner then
  return 0
end

local redis_time = redis.call('TIME')
local now_ms =
  (tonumber(redis_time[1]) * 1000) + math.floor(tonumber(redis_time[2]) / 1000)
local current_lease_ms =
  tonumber(redis.call('HGET', key, 'lease_until_ms') or '0')
if state == 'reserved' and current_lease_ms <= now_ms then
  return 0
end

local lease_until_ms = now_ms + lease_ms
redis.call('HSET', key,
  'lease_until_ms', tostring(lease_until_ms),
  'updated_at_ms', tostring(now_ms))
redis.call('EXPIRE', key, retention_seconds)
return tostring(lease_until_ms)
`;

const TRANSITION_RECEIPT_SCRIPT = `
-- message_history_receipt_transition_v3
local key = KEYS[1]
local owner = ARGV[1]
local expected_state = ARGV[2]
local target_state = ARGV[3]
local retention_seconds = tonumber(ARGV[4])
local error_value = ARGV[5]
local state = redis.call('HGET', key, 'state')

if not state then
  return 'not_found'
end
if state == 'known' or state == 'published' or state == 'ambiguous' then
  redis.call('EXPIRE', key, retention_seconds)
  return 'already_completed'
end
if redis.call('HGET', key, 'owner') ~= owner then
  return 'owner_mismatch'
end
if state == target_state then
  redis.call('EXPIRE', key, retention_seconds)
  return 'already_completed'
end
if state ~= expected_state then
  return 'invalid_state'
end

local redis_time = redis.call('TIME')
local now_ms =
  (tonumber(redis_time[1]) * 1000) + math.floor(tonumber(redis_time[2]) / 1000)
if expected_state == 'reserved' and target_state == 'publishing' then
  local current_lease_ms =
    tonumber(redis.call('HGET', key, 'lease_until_ms') or '0')
  if current_lease_ms <= now_ms then
    return 'lease_expired'
  end
end
local next_owner = ''
local next_lease_until_ms = '0'
if target_state == 'publishing' then
  next_owner = owner
  next_lease_until_ms =
    redis.call('HGET', key, 'lease_until_ms') or tostring(now_ms)
end
redis.call('HSET', key,
  'schema_version', '3',
  'state', target_state,
  'owner', next_owner,
  'lease_until_ms', next_lease_until_ms,
  'updated_at_ms', tostring(now_ms),
  'error', error_value)
redis.call('EXPIRE', key, retention_seconds)
return 'transitioned'
`;

export class MessageHistoryInflightLeaseLostError extends Error {
  constructor() {
    super('message_history_inflight_lease_lost');
    this.name = 'MessageHistoryInflightLeaseLostError';
  }
}

export class MessageHistoryReceiptReservationBusyError extends Error {
  constructor() {
    super('message_history_receipt_reservation_busy');
    this.name = 'MessageHistoryReceiptReservationBusyError';
  }
}

export class MessageHistoryReceiptIdentityError extends Error {
  constructor() {
    super('message_history_receipt_identity_missing');
    this.name = 'MessageHistoryReceiptIdentityError';
  }
}

export class MessageHistoryReceiptCacheService {
  private readonly legacyKnownPrefix = 'wa:received-msg:v2';
  private readonly receiptPrefix = 'wa:received-msg:v2:event';
  private readonly knownTtlSeconds: number;
  private readonly inflightTtlSeconds: number;

  constructor(
    private readonly redis: Redis,
    options: IMessageHistoryCacheOptions = {}
  ) {
    this.knownTtlSeconds =
      options.knownTtlSeconds ??
      MessageHistoryReceiptCacheService.readPositiveIntEnv(
        'HISTORY_RECONCILIATION_CACHE_TTL_SECONDS',
        2_592_000
      );
    this.inflightTtlSeconds =
      options.inflightTtlSeconds ??
      MessageHistoryReceiptCacheService.readPositiveIntEnv(
        'HISTORY_RECONCILIATION_INFLIGHT_TTL_SECONDS',
        120
      );
  }

  public async isKnown(data: IUpsertMessage): Promise<boolean> {
    const eventId = this.requireEventId(data);
    const receiptKey = this.buildReceiptKey(data, eventId);
    if ((await this.readReceiptState(receiptKey)) !== null) {
      return true;
    }

    if (await this.isKnownInLegacyBuckets(data, eventId)) {
      await this.markKnown(data);
      return true;
    }

    return false;
  }

  public async markKnown(data: IUpsertMessage): Promise<void> {
    const eventId = this.requireEventId(data);
    await this.redis.eval(
      MARK_KNOWN_SCRIPT,
      1,
      this.buildReceiptKey(data, eventId),
      eventId,
      String(this.knownTtlSeconds)
    );
  }

  public async reserveForHistory(
    data: IUpsertMessage
  ): Promise<MessageHistoryReceiptReservation> {
    const eventId = this.requireEventId(data);
    const key = this.buildReceiptKey(data, eventId);
    const existingState = await this.readReceiptHashState(key);
    if (existingState && existingState !== 'reserved') {
      return {
        status: 'duplicate',
        state: existingState,
        eventId,
      };
    }
    if (
      existingState === null &&
      (await this.isKnownInLegacyBuckets(data, eventId))
    ) {
      await this.markKnown(data);
      return {
        status: 'duplicate',
        state: 'known',
        eventId,
      };
    }

    const owner = randomUUID();
    const raw = await this.redis.eval(
      RESERVE_RECEIPT_SCRIPT,
      1,
      key,
      owner,
      eventId,
      String(this.inflightTtlSeconds * 1000),
      String(this.knownTtlSeconds)
    );
    const [status, stateRaw] = Array.isArray(raw) ? raw.map(String) : [];
    const state = this.parseState(stateRaw);
    if (status === 'acquired' && state === 'reserved') {
      return {
        status,
        claim: {
          key,
          owner,
          eventId,
          state,
        },
      };
    }
    if (status === 'duplicate') {
      return {
        status,
        state: state ?? 'known',
        eventId,
      };
    }

    throw new Error('message_history_receipt_reservation_invalid_response');
  }

  public async withReservation<T>(
    claim: IMessageHistoryReceiptClaim,
    callback: (assertOwned: () => Promise<void>) => Promise<T>
  ): Promise<T> {
    let leaseError: unknown = null;
    let heartbeatRunning = false;
    const assertOwned = async (): Promise<void> => {
      if (leaseError) {
        throw leaseError;
      }
      const extended = await this.redis.eval(
        EXTEND_RESERVATION_SCRIPT,
        1,
        claim.key,
        claim.owner,
        String(this.inflightTtlSeconds * 1000),
        String(this.knownTtlSeconds)
      );
      if (!Number.isFinite(Number(extended)) || Number(extended) <= 0) {
        leaseError = new MessageHistoryInflightLeaseLostError();
        throw leaseError;
      }
    };
    const heartbeatIntervalMs = Math.max(
      1_000,
      Math.floor((this.inflightTtlSeconds * 1_000) / 3)
    );
    const heartbeat = setInterval(() => {
      if (heartbeatRunning || leaseError) {
        return;
      }
      heartbeatRunning = true;
      void assertOwned()
        .catch((error) => {
          leaseError = error;
        })
        .finally(() => {
          heartbeatRunning = false;
        });
    }, heartbeatIntervalMs);
    heartbeat.unref?.();

    try {
      await assertOwned();
      return await callback(assertOwned);
    } finally {
      clearInterval(heartbeat);
    }
  }

  public async markPublished(
    claim: IMessageHistoryReceiptClaim
  ): Promise<MessageHistoryReceiptTransitionStatus> {
    return this.transition(claim, 'publishing', 'published', '');
  }

  public async markPublishing(
    claim: IMessageHistoryReceiptClaim
  ): Promise<MessageHistoryReceiptTransitionStatus> {
    return this.transition(claim, 'reserved', 'publishing', '');
  }

  public async markKnownFromReservation(
    claim: IMessageHistoryReceiptClaim
  ): Promise<MessageHistoryReceiptTransitionStatus> {
    return this.transition(claim, 'reserved', 'known', '');
  }

  public async markAmbiguous(
    claim: IMessageHistoryReceiptClaim,
    error: unknown
  ): Promise<MessageHistoryReceiptTransitionStatus> {
    return this.transition(
      claim,
      'publishing',
      'ambiguous',
      this.errorMessage(error)
    );
  }

  private async transition(
    claim: IMessageHistoryReceiptClaim,
    expectedState: 'reserved' | 'publishing',
    targetState: 'publishing' | 'known' | 'published' | 'ambiguous',
    error: string
  ): Promise<MessageHistoryReceiptTransitionStatus> {
    const raw = await this.redis.eval(
      TRANSITION_RECEIPT_SCRIPT,
      1,
      claim.key,
      claim.owner,
      expectedState,
      targetState,
      String(this.knownTtlSeconds),
      error
    );
    const status = String(raw ?? '');
    if (
      status === 'transitioned' ||
      status === 'already_completed' ||
      status === 'owner_mismatch' ||
      status === 'lease_expired' ||
      status === 'invalid_state' ||
      status === 'not_found'
    ) {
      return status;
    }
    throw new Error('message_history_receipt_transition_invalid_response');
  }

  private buildLookupBucketKeys(data: IUpsertMessage): string[] {
    const bucketDay = this.getBucketDay(data);
    const keys = new Set<string>([
      this.buildLegacyKnownBucketKeyForDay(data, bucketDay),
    ]);
    const timestampMs = this.getMessageTimestampMs(data);

    if (!timestampMs) {
      keys.add(
        this.buildLegacyKnownBucketKeyForDay(
          data,
          this.formatBucketDay(Date.now() - 86_400_000)
        )
      );
      return Array.from(keys);
    }

    keys.add(
      this.buildLegacyKnownBucketKeyForDay(
        data,
        this.formatBucketDay(timestampMs - 86_400_000)
      )
    );
    keys.add(
      this.buildLegacyKnownBucketKeyForDay(
        data,
        this.formatBucketDay(timestampMs + 86_400_000)
      )
    );

    return Array.from(keys);
  }

  private buildLegacyKnownBucketKeyForDay(
    data: IUpsertMessage,
    bucketDay: string
  ): string {
    return `${this.legacyKnownPrefix}:${data.account_id}:${data.worker_id}:${bucketDay}`;
  }

  private buildReceiptKey(data: IUpsertMessage, eventId: string): string {
    return `${this.receiptPrefix}:${data.account_id.trim()}:${data.worker_id.trim()}:${eventId}`;
  }

  private requireEventId(data: IUpsertMessage): string {
    const eventId = ensureInboundEventId(data);
    if (!eventId) {
      throw new MessageHistoryReceiptIdentityError();
    }
    return eventId;
  }

  private async readReceiptState(
    key: string
  ): Promise<MessageHistoryReceiptState | null> {
    const state = await this.readReceiptHashState(key);
    if (state !== null) {
      return state;
    }

    return (await this.redis.exists(key)) === 1 ? 'known' : null;
  }

  private async readReceiptHashState(
    key: string
  ): Promise<MessageHistoryReceiptState | null> {
    const rawState = await this.redis.hget(key, 'state');
    return rawState === null ? null : (this.parseState(rawState) ?? 'known');
  }

  private async isKnownInLegacyBuckets(
    data: IUpsertMessage,
    eventId: string
  ): Promise<boolean> {
    const checks = await Promise.all(
      this.buildLookupBucketKeys(data).map((key) =>
        this.redis.sismember(key, eventId)
      )
    );
    return checks.some((exists) => exists === 1);
  }

  private parseState(value: unknown): MessageHistoryReceiptState | null {
    const normalized = String(value ?? '');
    if (
      normalized === 'reserved' ||
      normalized === 'publishing' ||
      normalized === 'known' ||
      normalized === 'published' ||
      normalized === 'ambiguous'
    ) {
      return normalized;
    }
    return null;
  }

  private getBucketDay(data: IUpsertMessage): string {
    return this.formatBucketDay(this.getMessageTimestampMs(data) ?? Date.now());
  }

  private formatBucketDay(timestampMs: number): string {
    return new Date(timestampMs).toISOString().slice(0, 10).replace(/-/g, '');
  }

  private getMessageTimestampMs(data: IUpsertMessage): number | null {
    const raw: unknown = data.message?.messageTimestamp;
    if (raw === null || raw === undefined) {
      return null;
    }

    const value =
      typeof raw === 'object' && raw && 'toNumber' in raw
        ? (raw as { toNumber: () => number }).toNumber()
        : Number(raw);

    if (!Number.isFinite(value) || value <= 0) {
      return null;
    }

    return value > 1_000_000_000_000 ? value : value * 1000;
  }

  private errorMessage(error: unknown): string {
    return (error instanceof Error ? error.message : String(error)).slice(
      0,
      1000
    );
  }

  private static readPositiveIntEnv(key: string, fallback: number): number {
    const raw = process.env[key];
    if (!raw) {
      return fallback;
    }

    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return fallback;
    }

    return Math.floor(parsed);
  }
}
