import { inject, singleton } from 'tsyringe';
import Redis from 'ioredis';
import {
  IInboundMessageParkingPayload,
  IInboundMessageSpoolPayload,
  InboundMessageParkingRedrivePublisher,
  InboundMessageSpoolProvider,
} from '@core/common/interfaces/IInboundMessageSpoolPayload';
import { createHash, randomUUID } from 'node:crypto';

type RedisStreamValue = string | number;
type RedisStreamClient = Redis & {
  xadd(...args: RedisStreamValue[]): Promise<string | null>;
  xgroup(...args: RedisStreamValue[]): Promise<unknown>;
  xreadgroup(...args: RedisStreamValue[]): Promise<unknown>;
  xack(...args: RedisStreamValue[]): Promise<number>;
  xdel(...args: RedisStreamValue[]): Promise<number>;
  xautoclaim(...args: RedisStreamValue[]): Promise<unknown>;
};

type InboundPublisher = (payload: IInboundMessageSpoolPayload) => Promise<void>;
type ActiveScopeGuard = () => Promise<boolean>;

export class ObsoleteInboundMessageSpoolPayloadError extends Error {
  constructor(public readonly reason: string) {
    super(`inbound_message_spool_payload_obsolete:${reason}`);
    this.name = 'ObsoleteInboundMessageSpoolPayloadError';
  }
}

export function isObsoleteInboundMessageSpoolPayloadError(
  error: unknown
): error is ObsoleteInboundMessageSpoolPayloadError {
  return error instanceof ObsoleteInboundMessageSpoolPayloadError;
}

interface PublisherState {
  ownerKey: string;
  running: boolean;
  timer?: ReturnType<typeof setTimeout>;
  loop?: () => Promise<void>;
}

export interface IInboundMessageSpoolScope {
  runtimeGeneration: number;
  connectionEpoch: string;
}

interface StreamEntry {
  id: string;
  payload: IInboundMessageSpoolPayload | null;
  rawPayload: string | null;
}

interface ConsumerRedriveState {
  running: boolean;
  stopped: boolean;
  inFlight?: Promise<void>;
  indexScanCursor: string;
  pendingParkingKeys: string[];
  leaderOwner: string;
  leaderOwned: boolean;
  leaderLeaseValidUntil: number;
  publisher: InboundMessageParkingRedrivePublisher;
  timer?: ReturnType<typeof setTimeout>;
  leaderHeartbeatTimer?: ReturnType<typeof setTimeout>;
  loop?: () => Promise<void>;
}

interface ConsumerParkingLegacyMigrationState {
  cursor: string;
  pass: number;
  newKeysInPass: number;
  resumeAt: number;
  complete: boolean;
}

const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_LOOP_IDLE_MS = 1000;
const DEFAULT_LOOP_ACTIVE_MS = 100;
const DEFAULT_MAX_ATTEMPTS = 12;
const DEFAULT_CLAIM_IDLE_MS = 30_000;
const DEFAULT_BASE_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 30_000;
const DEFAULT_CLEANUP_MAX_INDEXED_KEYS = 500;
const DEFAULT_CLEANUP_DEADLINE_MS = 5000;
const WHATSAPP_RUNTIME_FENCE_KEY_PREFIX = 'whatsapp:runtime-fence:v1';
const SCOPE_INDEX_SCAN_COUNT = 100;
const SPOOL_KEY_SUFFIXES = [
  'stream',
  'retry',
  'retry-payloads',
  'parking',
  'payloads',
] as const;
const SPOOL_PROVIDERS: InboundMessageSpoolProvider[] = [
  'wwebjs',
  'baileys',
  'whatsmeow',
];
const MESSAGE_UPSERT_CONSUMER_PROVIDER = 'message_upsert_consumer';
const MESSAGE_UPSERT_PARKING_INDEX_KEY =
  'inbound:message:message_upsert_consumer:parking-index:v1';
const MESSAGE_UPSERT_PARKING_SCAN_PATTERN =
  'inbound:message:message_upsert_consumer:*:parking';
const MESSAGE_UPSERT_REDRIVE_LEADER_KEY =
  'inbound:message:message_upsert_consumer:redrive-leader:v1';
const MESSAGE_UPSERT_LEGACY_MIGRATION_STATE_KEY =
  'inbound:message:message_upsert_consumer:legacy-migration:v2';
const CONSUMER_REDRIVE_INDEX_SCAN_COUNT = 100;
const CONSUMER_REDRIVE_MAX_KEYS_PER_TICK = 10;
const CONSUMER_REDRIVE_MAX_MEMBERS_PER_TICK = 10;
const CONSUMER_REDRIVE_IDLE_MS = 1000;
const CONSUMER_REDRIVE_ACTIVE_MS = 100;
const CONSUMER_REDRIVE_CLAIM_MS = 5 * 60 * 1000;
const CONSUMER_REDRIVE_BASE_DELAY_MS = 1000;
const CONSUMER_REDRIVE_MAX_DELAY_MS = 60_000;
const CONSUMER_REDRIVE_LEADER_TTL_MS = 30_000;
const CONSUMER_REDRIVE_LEADER_RENEW_MS = 5_000;
const CONSUMER_LEGACY_MIGRATION_SCAN_COUNT = 5_000;
const CONSUMER_LEGACY_MIGRATION_SCAN_THROTTLE_MS = 1_000;
const CONSUMER_LEGACY_MIGRATION_QUIET_MS = 5 * 60 * 1000;
const CONSUMER_LEGACY_MIGRATION_AUDIT_INTERVAL_MS = 15 * 60 * 1000;
const CONSUMER_REDRIVE_SHUTDOWN_DRAIN_MS = 5_000;
const CONSUMER_EMPTY_PAYLOAD_HASH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CONSUMER_REDRIVE_MAX_ATTEMPTS = 12;
// Retries are only useful for a short transient outage. This is an absolute
// window anchored only by Redis TIME on first storage, never by message dates
// or a sliding TTL renewed by another attempt.
const INBOUND_MESSAGE_RETRY_WINDOW_MS = 5 * 60 * 1000;
const CONSUMER_TERMINAL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const CONSUMER_TERMINAL_MAX_ERROR_BYTES = 4 * 1024;
const CONSUMER_TERMINAL_MAX_RAW_PAYLOAD_BYTES = 64 * 1024;
const MESSAGE_UPSERT_TERMINAL_INDEX_KEY =
  'inbound:message:message_upsert_consumer:terminal-index:v1';
const MESSAGE_UPSERT_TERMINAL_RECORD_PREFIX =
  'inbound:message:message_upsert_consumer:terminal:v1:';
const MESSAGE_UPSERT_REDRIVE_LINEAGE_PREFIX =
  'inbound:message:message_upsert_consumer:redrive-lineage:v1:';
const PROVIDER_FIRST_STORED_AT_META_KEY = 'inbound_spool_first_stored_at_ms';

const PRUNE_EMPTY_HISTORICAL_SCOPE_SCRIPT = `
-- inbound-provider-empty-scope-prune-v1
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

local target_generation = tonumber(ARGV[6]) or 0
local active_generation = tonumber(ARGV[2]) or 0
local target_is_current = target_generation == active_generation
  and ARGV[5] == ARGV[4]
  and ARGV[7] == ARGV[3]
if target_is_current or target_generation > active_generation then
  return -2
end

local expected_types = { 'stream', 'zset', 'hash', 'zset', 'hash' }
local has_data = false
local has_hash_data = false
for index = 3, 7 do
  local actual_type = redis.call('TYPE', KEYS[index]).ok
  if actual_type ~= 'none' then
    local expected_type = expected_types[index - 2]
    if actual_type ~= expected_type then
      return -3
    end

    local size = 0
    if expected_type == 'stream' then
      size = redis.call('XLEN', KEYS[index])
    elseif expected_type == 'zset' then
      size = redis.call('ZCARD', KEYS[index])
    else
      size = redis.call('HLEN', KEYS[index])
    end
    if size > 0 then
      has_data = true
      if expected_type == 'hash' then
        has_hash_data = true
      end
    end
  end
end

if has_hash_data then
  return 2
end
if has_data then
  return 0
end

redis.call('UNLINK', KEYS[3], KEYS[4], KEYS[5], KEYS[6], KEYS[7])
redis.call('SREM', KEYS[2], KEYS[3], KEYS[4], KEYS[5], KEYS[6], KEYS[7])
return 1
`;

const REPAIR_HISTORICAL_SCOPE_DISCOVERY_SCRIPT = `
-- inbound-provider-scope-discovery-repair-v1
local current_raw = redis.call('GET', KEYS[1])
if not current_raw then
  return { -1, ARGV[8], 0, 0 }
end

local decoded, current = pcall(cjson.decode, current_raw)
if not decoded
  or tostring(current.state or '') ~= 'active'
  or tostring(current.worker_id or '') ~= ARGV[1]
  or (tonumber(current.runtime_generation) or 0) ~= tonumber(ARGV[2])
  or tostring(current.connection_epoch or '') ~= ARGV[3]
  or tostring(current.source_provider or '') ~= ARGV[4] then
  return { -1, ARGV[8], 0, 0 }
end

local target_generation = tonumber(ARGV[6]) or 0
local active_generation = tonumber(ARGV[2]) or 0
local target_is_current = target_generation == active_generation
  and ARGV[5] == ARGV[4]
  and ARGV[7] == ARGV[3]
if target_is_current or target_generation > active_generation then
  return { -2, ARGV[8], 0, 0 }
end

local retry_type = redis.call('TYPE', KEYS[2]).ok
local retry_payload_type = redis.call('TYPE', KEYS[3]).ok
if (retry_type ~= 'none' and retry_type ~= 'zset')
  or (retry_payload_type ~= 'none' and retry_payload_type ~= 'hash') then
  return { -3, ARGV[8], 0, 0 }
end

if retry_payload_type == 'none' then
  return { 1, '0', 0, 0 }
end

local page = redis.call('HSCAN', KEYS[3], ARGV[8], 'COUNT', ARGV[9])
local values = page[2]
local repaired = 0
for index = 1, #values, 2 do
  local member = values[index]
  if not redis.call('ZSCORE', KEYS[2], member) then
    local score = tonumber(ARGV[10])
    local payload_decoded, payload = pcall(cjson.decode, values[index + 1])
    if payload_decoded and type(payload) == 'table' then
      score = tonumber(payload.next_attempt_at) or score
    end
    repaired = repaired + redis.call('ZADD', KEYS[2], 'NX', score, member)
  end
end
return { 1, page[1], repaired, #values / 2 }
`;

const STORE_PROVIDER_STREAM_SCRIPT = `
-- inbound-provider-stream-store-v2
local now = redis.call('TIME')
local now_ms = (tonumber(now[1]) * 1000) + math.floor(tonumber(now[2]) / 1000)
local incoming = cjson.decode(ARGV[1])
if type(incoming.raw_meta) ~= 'table' then
  incoming.raw_meta = {}
end
incoming.raw_meta.inbound_spool_first_stored_at_ms = now_ms
return redis.call('XADD', KEYS[1], '*', 'payload', cjson.encode(incoming))
`;

const STORE_SCORED_PAYLOAD_SCRIPT = `
-- inbound-provider-scored-payload-store-v2
local incoming = cjson.decode(ARGV[2])
local first_stored_at_ms = nil
local supplied_first_stored_at_ms = nil
if ARGV[4] ~= '' then
  supplied_first_stored_at_ms = tonumber(ARGV[4])
  if not supplied_first_stored_at_ms then
    supplied_first_stored_at_ms = 0
  end
end
local previous_raw = redis.call('HGET', KEYS[1], ARGV[1])
if previous_raw then
  local decoded, previous = pcall(cjson.decode, previous_raw)
  if decoded and type(previous.raw_meta) == 'table' then
    first_stored_at_ms = tonumber(previous.raw_meta.inbound_spool_first_stored_at_ms)
  end
  if not first_stored_at_ms then
    first_stored_at_ms = 0
  end
end
if first_stored_at_ms and supplied_first_stored_at_ms then
  first_stored_at_ms = math.min(
    first_stored_at_ms,
    supplied_first_stored_at_ms
  )
elseif supplied_first_stored_at_ms then
  first_stored_at_ms = supplied_first_stored_at_ms
end
if not first_stored_at_ms then
  local now = redis.call('TIME')
  first_stored_at_ms = (tonumber(now[1]) * 1000)
    + math.floor(tonumber(now[2]) / 1000)
end
if type(incoming.raw_meta) ~= 'table' then
  incoming.raw_meta = {}
end
incoming.raw_meta.inbound_spool_first_stored_at_ms = first_stored_at_ms
redis.call('HSET', KEYS[1], ARGV[1], cjson.encode(incoming))
redis.call('ZADD', KEYS[2], ARGV[3], ARGV[1])
return 1
`;

const DISCARD_RETRY_PAYLOAD_SCRIPT = `
-- inbound-provider-retry-discard-v1
if redis.call('HGET', KEYS[1], ARGV[1]) ~= ARGV[2] then
  return 0
end
redis.call('HDEL', KEYS[1], ARGV[1])
redis.call('ZREM', KEYS[2], ARGV[1])
if redis.call('HLEN', KEYS[1]) == 0 then
  redis.call('DEL', KEYS[1])
end
if redis.call('ZCARD', KEYS[2]) == 0 then
  redis.call('DEL', KEYS[2])
end
return 1
`;

const REQUEUE_LEGACY_PROVIDER_PARKING_SCRIPT = `
-- inbound-provider-parking-requeue-v1
local current = redis.call('HGET', KEYS[2], ARGV[1])
if not current then
  redis.call('ZREM', KEYS[1], ARGV[1])
  return 0
end
if current ~= ARGV[2] then
  return -1
end
if ARGV[3] ~= '' then
  redis.call('HSET', KEYS[4], ARGV[1], ARGV[3])
  redis.call('ZADD', KEYS[3], ARGV[4], ARGV[1])
end
redis.call('ZREM', KEYS[1], ARGV[1])
redis.call('HDEL', KEYS[2], ARGV[1])
if redis.call('ZCARD', KEYS[1]) == 0 then
  redis.call('DEL', KEYS[1])
end
if redis.call('HLEN', KEYS[2]) == 0 then
  redis.call('DEL', KEYS[2])
end
return 1
`;

const STORE_CONSUMER_PARKING_SCRIPT = `
-- inbound-message-consumer-parking-store-v1
if redis.call('EXISTS', KEYS[5]) == 1 then
  return 0
end
local now = redis.call('TIME')
local now_ms = (tonumber(now[1]) * 1000) + math.floor(tonumber(now[2]) / 1000)
local incoming = cjson.decode(ARGV[2])
local previous_raw = redis.call('HGET', KEYS[1], ARGV[1])
local previous_count = 0
local previous_first_parked_at = nil
if previous_raw then
  local decoded, previous = pcall(cjson.decode, previous_raw)
  if decoded then
    previous_count = tonumber(previous.retry_count) or 0
    previous_first_parked_at = tonumber(previous.first_parked_at)
  end
  if not previous_first_parked_at then
    previous_first_parked_at = 0
  end
end
local lineage_raw = redis.call('GET', KEYS[4])
local lineage_first_parked_at = tonumber(lineage_raw)
if lineage_raw and not lineage_first_parked_at then
  lineage_first_parked_at = 0
end
local first_parked_at = now_ms
if previous_first_parked_at and lineage_first_parked_at then
  first_parked_at = math.min(
    previous_first_parked_at,
    lineage_first_parked_at
  )
elseif previous_first_parked_at then
  first_parked_at = previous_first_parked_at
elseif lineage_first_parked_at then
  first_parked_at = lineage_first_parked_at
end
local incoming_count = tonumber(incoming.retry_count) or 1
local retry_count = math.max(incoming_count, previous_count + 1)
local exponent = math.max(0, retry_count - 1)
local delay_ms = math.min(
  tonumber(ARGV[3]) * (2 ^ exponent),
  tonumber(ARGV[4])
)
incoming.retry_count = retry_count
incoming.next_attempt_at = now_ms + delay_ms
incoming.first_parked_at = tostring(first_parked_at)
incoming.parked_at = tostring(now_ms)
local serialized = cjson.encode(incoming)
redis.call('HSET', KEYS[1], ARGV[1], serialized)
redis.call('PERSIST', KEYS[1])
redis.call('SET', KEYS[4], tostring(first_parked_at), 'PX', ARGV[5], 'NX')
if not redis.call('HGET', KEYS[3], ARGV[1]) then
  redis.call('ZADD', KEYS[2], incoming.next_attempt_at, ARGV[1])
end
return 1
`;

const CLAIM_CONSUMER_PARKING_SCRIPT = `
-- inbound-message-consumer-redrive-claim-v1
if ARGV[5] ~= '' and redis.call('GET', KEYS[5]) ~= ARGV[5] then
  return nil
end
local score = redis.call('ZSCORE', KEYS[1], ARGV[1])
if not score or tonumber(score) > tonumber(ARGV[2]) then
  return nil
end
local payload = redis.call('HGET', KEYS[2], ARGV[1])
if not payload then
  redis.call('ZREM', KEYS[1], ARGV[1])
  redis.call('HDEL', KEYS[3], ARGV[1])
  if redis.call('ZCARD', KEYS[1]) == 0 then
    redis.call('SREM', KEYS[4], KEYS[1])
  end
  return nil
end
redis.call('HSET', KEYS[3], ARGV[1], ARGV[4])
redis.call('ZADD', KEYS[1], ARGV[3], ARGV[1])
return payload
`;

const COMPLETE_CONSUMER_PARKING_SCRIPT = `
-- inbound-message-consumer-redrive-complete-v1
if ARGV[8] ~= '' and redis.call('GET', KEYS[6]) ~= ARGV[8] then
  return -2
end
if redis.call('HGET', KEYS[3], ARGV[1]) ~= ARGV[2] then
  return 0
end
if redis.call('HGET', KEYS[2], ARGV[1]) ~= ARGV[3] then
  redis.call('HDEL', KEYS[3], ARGV[1])
  local current_raw = redis.call('HGET', KEYS[2], ARGV[1])
  local retry_at = tonumber(ARGV[4])
  if current_raw then
    local decoded, current = pcall(cjson.decode, current_raw)
    if decoded then
      retry_at = tonumber(current.next_attempt_at) or retry_at
    end
  end
  redis.call('ZADD', KEYS[1], retry_at, ARGV[1])
  return -1
end
redis.call('SET', KEYS[5], ARGV[6], 'PX', ARGV[7], 'NX')
redis.call('ZREM', KEYS[1], ARGV[1])
redis.call('HDEL', KEYS[2], ARGV[1])
redis.call('HDEL', KEYS[3], ARGV[1])
if redis.call('ZCARD', KEYS[1]) == 0 then
  redis.call('SREM', KEYS[4], KEYS[1])
  redis.call('PEXPIRE', KEYS[2], ARGV[5])
end
return 1
`;

const TERMINALIZE_CONSUMER_PARKING_SCRIPT = `
-- inbound-message-consumer-redrive-terminalize-v1
if ARGV[8] ~= '' and redis.call('GET', KEYS[8]) ~= ARGV[8] then
  return -2
end
if redis.call('HGET', KEYS[3], ARGV[1]) ~= ARGV[2] then
  return 0
end
if redis.call('HGET', KEYS[2], ARGV[1]) ~= ARGV[3] then
  redis.call('HDEL', KEYS[3], ARGV[1])
  local current_raw = redis.call('HGET', KEYS[2], ARGV[1])
  local retry_at = tonumber(ARGV[5])
  if current_raw then
    local decoded, current = pcall(cjson.decode, current_raw)
    if decoded then
      retry_at = tonumber(current.next_attempt_at) or retry_at
    end
  end
  redis.call('ZADD', KEYS[1], retry_at, ARGV[1])
  return -1
end
redis.call('SET', KEYS[5], ARGV[4], 'PX', ARGV[7])
redis.call('ZREMRANGEBYSCORE', KEYS[6], '-inf', ARGV[5])
redis.call('ZADD', KEYS[6], ARGV[6], KEYS[5])
redis.call('PEXPIRE', KEYS[6], ARGV[7])
redis.call('ZREM', KEYS[1], ARGV[1])
redis.call('HDEL', KEYS[2], ARGV[1])
redis.call('HDEL', KEYS[3], ARGV[1])
redis.call('PEXPIRE', KEYS[7], ARGV[7])
if redis.call('ZCARD', KEYS[1]) == 0 then
  redis.call('SREM', KEYS[4], KEYS[1])
end
return 1
`;

const RESCHEDULE_CONSUMER_PARKING_SCRIPT = `
-- inbound-message-consumer-redrive-reschedule-v1
if ARGV[7] ~= '' and redis.call('GET', KEYS[4]) ~= ARGV[7] then
  return -2
end
if redis.call('HGET', KEYS[3], ARGV[1]) ~= ARGV[2] then
  return 0
end
if redis.call('HGET', KEYS[2], ARGV[1]) ~= ARGV[3] then
  redis.call('HDEL', KEYS[3], ARGV[1])
  local current_raw = redis.call('HGET', KEYS[2], ARGV[1])
  local retry_at = tonumber(ARGV[6])
  if current_raw then
    local decoded, current = pcall(cjson.decode, current_raw)
    if decoded then
      retry_at = tonumber(current.next_attempt_at) or retry_at
    end
  end
  redis.call('ZADD', KEYS[1], retry_at, ARGV[1])
  return -1
end
redis.call('HSET', KEYS[2], ARGV[1], ARGV[4])
redis.call('ZADD', KEYS[1], ARGV[5], ARGV[1])
redis.call('HDEL', KEYS[3], ARGV[1])
return 1
`;

const RENEW_CONSUMER_REDRIVE_LEADER_SCRIPT = `
-- inbound-message-consumer-redrive-leader-renew-v1
if redis.call('GET', KEYS[1]) ~= ARGV[1] then
  return 0
end
redis.call('PEXPIRE', KEYS[1], ARGV[2])
return 1
`;

const RELEASE_CONSUMER_REDRIVE_LEADER_SCRIPT = `
-- inbound-message-consumer-redrive-leader-release-v1
if redis.call('GET', KEYS[1]) ~= ARGV[1] then
  return 0
end
redis.call('DEL', KEYS[1])
return 1
`;

const SAVE_CONSUMER_LEGACY_MIGRATION_STATE_SCRIPT = `
-- inbound-message-consumer-legacy-migration-state-v1
if redis.call('GET', KEYS[1]) ~= ARGV[1] then
  return 0
end
redis.call('SET', KEYS[2], ARGV[2])
return 1
`;

function readPositiveIntEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;

  return Math.floor(parsed);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function safeJsonParse<T>(value: string | null): T | null {
  if (!value) return null;

  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

@singleton()
export class InboundMessageSpoolService {
  private readonly groupName = 'inbound-message-publisher';
  private readonly batchSize = readPositiveIntEnv(
    'INBOUND_MESSAGE_SPOOL_BATCH_SIZE',
    DEFAULT_BATCH_SIZE
  );
  private readonly maxAttempts = readPositiveIntEnv(
    'INBOUND_MESSAGE_SPOOL_MAX_ATTEMPTS',
    DEFAULT_MAX_ATTEMPTS
  );
  private readonly claimIdleMs = readPositiveIntEnv(
    'INBOUND_MESSAGE_SPOOL_CLAIM_IDLE_MS',
    DEFAULT_CLAIM_IDLE_MS
  );
  private readonly baseDelayMs = readPositiveIntEnv(
    'INBOUND_MESSAGE_SPOOL_BASE_DELAY_MS',
    DEFAULT_BASE_DELAY_MS
  );
  private readonly maxDelayMs = readPositiveIntEnv(
    'INBOUND_MESSAGE_SPOOL_MAX_DELAY_MS',
    DEFAULT_MAX_DELAY_MS
  );
  private readonly cleanupMaxIndexedKeys = readPositiveIntEnv(
    'INBOUND_MESSAGE_SPOOL_CLEANUP_MAX_INDEXED_KEYS',
    DEFAULT_CLEANUP_MAX_INDEXED_KEYS
  );
  private readonly cleanupDeadlineMs = readPositiveIntEnv(
    'INBOUND_MESSAGE_SPOOL_CLEANUP_DEADLINE_MS',
    DEFAULT_CLEANUP_DEADLINE_MS
  );
  private readonly states = new Map<string, PublisherState>();
  private readonly groupsReady = new Set<string>();
  private readonly registeredScopes = new Set<string>();
  private readonly publishedStreamEntries = new Set<string>();
  private readonly publishedRetryMembers = new Set<string>();
  private consumerRedriveState: ConsumerRedriveState | null = null;

  constructor(@inject('Redis') private readonly redis: Redis) {}

  streamKey(
    provider: InboundMessageSpoolProvider,
    workerId: string,
    scope: IInboundMessageSpoolScope
  ): string {
    return `${this.scopePrefix(provider, workerId, scope)}:stream`;
  }

  retrySetKey(
    provider: InboundMessageSpoolProvider,
    workerId: string,
    scope: IInboundMessageSpoolScope
  ): string {
    return `${this.scopePrefix(provider, workerId, scope)}:retry`;
  }

  retryPayloadHashKey(
    provider: InboundMessageSpoolProvider,
    workerId: string,
    scope: IInboundMessageSpoolScope
  ): string {
    return `${this.scopePrefix(provider, workerId, scope)}:retry-payloads`;
  }

  parkingSetKey(
    provider: InboundMessageSpoolProvider | 'message_upsert_consumer',
    workerId: string,
    scope?: IInboundMessageSpoolScope
  ): string {
    if (scope && provider !== 'message_upsert_consumer') {
      return `${this.scopePrefix(provider, workerId, scope)}:parking`;
    }
    return `inbound:message:${provider}:${workerId}:parking`;
  }

  payloadHashKey(
    provider: InboundMessageSpoolProvider | 'message_upsert_consumer',
    workerId: string,
    scope?: IInboundMessageSpoolScope
  ): string {
    if (scope && provider !== 'message_upsert_consumer') {
      return `${this.scopePrefix(provider, workerId, scope)}:payloads`;
    }
    return `inbound:message:${provider}:${workerId}:payloads`;
  }

  startPublisher(
    provider: InboundMessageSpoolProvider,
    workerId: string,
    scope: IInboundMessageSpoolScope,
    publisher: InboundPublisher,
    activeScopeGuard?: ActiveScopeGuard,
    resumeIndexedScopes = true
  ): void {
    this.startOwnedPublisher(
      provider,
      workerId,
      scope,
      publisher,
      this.streamKey(provider, workerId, scope),
      activeScopeGuard,
      resumeIndexedScopes
    );
  }

  private startOwnedPublisher(
    provider: InboundMessageSpoolProvider,
    workerId: string,
    scope: IInboundMessageSpoolScope,
    publisher: InboundPublisher,
    ownerKey: string,
    activeScopeGuard?: ActiveScopeGuard,
    resumeIndexedScopes = true
  ): void {
    const key = this.streamKey(provider, workerId, scope);
    const existing = this.states.get(key);
    if (existing?.ownerKey === ownerKey) {
      return;
    }
    if (existing?.timer) {
      clearTimeout(existing.timer);
    }

    // Replacing the map entry transfers a persisted stream atomically at the
    // process level. An older loop may still finish an in-flight Redis/Kafka
    // call, but the identity checks below prevent it from scheduling, moving,
    // or acknowledging more entries after ownership changes.
    const state: PublisherState = { ownerKey, running: false };
    this.states.set(key, state);
    void (async () => {
      await this.registerScopeKeys(provider, workerId, scope);
      await this.requeueLegacyProviderParking(provider, workerId, scope);
      if (activeScopeGuard && resumeIndexedScopes) {
        await this.resumeIndexedSpools(
          provider,
          workerId,
          scope,
          publisher,
          activeScopeGuard
        );
      }
    })().catch((error) => {
      console.error(
        '[InboundMessageSpool] scope registration or cleanup failed:',
        {
          provider,
          worker_id: workerId,
          runtime_generation: scope.runtimeGeneration,
          connection_epoch: scope.connectionEpoch,
          error: errorMessage(error),
        }
      );
    });

    const loop = async () => {
      const current = this.states.get(key);
      if (current !== state) {
        return;
      }
      if (current.running) {
        this.scheduleLoop(key, loop, DEFAULT_LOOP_IDLE_MS);
        return;
      }

      current.running = true;
      let processed = 0;
      try {
        await this.registerScopeKeys(provider, workerId, scope);
        processed += await this.processRetryBatch(
          provider,
          workerId,
          scope,
          publisher,
          state
        );
        processed += await this.processStreamBatch(
          provider,
          workerId,
          scope,
          publisher,
          state
        );
      } catch (error) {
        console.error('[InboundMessageSpool] publisher loop failed:', {
          provider,
          worker_id: workerId,
          error: errorMessage(error),
        });
      } finally {
        if (this.states.get(key) !== state) {
          return;
        }
        current.running = false;
        this.scheduleLoop(
          key,
          loop,
          processed > 0 ? DEFAULT_LOOP_ACTIVE_MS : DEFAULT_LOOP_IDLE_MS
        );
      }
    };

    state.loop = loop;
    this.scheduleLoop(key, loop, DEFAULT_LOOP_ACTIVE_MS);
  }

  stopPublisher(
    provider: InboundMessageSpoolProvider,
    workerId: string,
    scope: IInboundMessageSpoolScope
  ): Promise<void> {
    // A disconnect is a pause, not proof that persisted inbound events are
    // obsolete. Stop only loops still owned by this runtime; a newer runtime
    // may already have taken over old streams. Redis state remains durable.
    const ownerKey = this.streamKey(provider, workerId, scope);
    for (const [key, state] of [...this.states.entries()]) {
      if (
        !key.endsWith(':stream') ||
        !this.isIndexedSpoolKeyForWorker(workerId, key) ||
        state.ownerKey !== ownerKey
      ) {
        continue;
      }

      if (state.timer) {
        clearTimeout(state.timer);
      }
      this.states.delete(key);
      this.groupsReady.delete(key);
      this.registeredScopes.delete(key);
      this.deletePublishedMarkersForStream(key);
    }

    return Promise.resolve();
  }

  async publish(
    payload: IInboundMessageSpoolPayload,
    publisher: InboundPublisher
  ): Promise<boolean> {
    void publisher;
    const scope = this.payloadScope(payload);
    const stream = this.streamKey(payload.provider, payload.worker_id, scope);
    try {
      await this.registerScopeKeys(
        payload.provider,
        payload.worker_id,
        scope,
        true
      );
      await this.redis.eval(
        STORE_PROVIDER_STREAM_SCRIPT,
        1,
        stream,
        JSON.stringify(payload)
      );
    } catch (error) {
      console.error('[InboundMessageSpool] failed to persist before publish:', {
        provider: payload.provider,
        worker_id: payload.worker_id,
        dedupe_key: payload.dedupe_key,
        error: errorMessage(error),
      });
      // Fail closed. The caller may drop this event, which is preferable to an
      // ambiguous direct publish that can be replayed after reconnect.
      return false;
    }

    // The consumer-group loop is the only publisher for persisted entries.
    // Publishing inline here would race XREADGROUP and could emit the same
    // physical WhatsApp event twice before either path removes the stream item.
    const state = this.states.get(stream);
    if (state?.loop && !state.running) {
      this.scheduleLoop(stream, state.loop, 0);
    }
    return true;
  }

  async parkConsumerMessage(
    payload: IInboundMessageParkingPayload
  ): Promise<void> {
    const workerId = payload.worker_id || 'message-upsert';
    const parkingKey = this.parkingSetKey(payload.provider, workerId);
    const member = this.parkingMember(payload);
    if (payload.provider === MESSAGE_UPSERT_CONSUMER_PROVIDER) {
      const stored = await this.storeConsumerParking(workerId, member, payload);
      if (!stored) {
        return;
      }
      /*
       * Indexing after the atomic payload write is intentionally fail-closed.
       * If this SADD fails the Kafka hook also fails, so its source offset is
       * not acknowledged. The already durable member is idempotently indexed
       * on redelivery or discovered by the legacy SCAN.
       */
      await this.redis.sadd(MESSAGE_UPSERT_PARKING_INDEX_KEY, parkingKey);
      return;
    }

    await this.storeParking(payload.provider, workerId, member, payload);
  }

  startMessageUpsertConsumerRedrive(
    publisher: InboundMessageParkingRedrivePublisher
  ): void {
    const existing = this.consumerRedriveState;
    if (existing && !existing.stopped) {
      existing.publisher = publisher;
      return;
    }

    const state: ConsumerRedriveState = {
      running: false,
      stopped: false,
      indexScanCursor: '0',
      pendingParkingKeys: [],
      leaderOwner: `${process.pid}:${randomUUID()}`,
      leaderOwned: false,
      leaderLeaseValidUntil: 0,
      publisher,
    };
    this.consumerRedriveState = state;

    const loop = async () => {
      if (this.consumerRedriveState !== state || state.stopped) {
        return;
      }
      if (state.running) {
        this.scheduleConsumerRedrive(state, CONSUMER_REDRIVE_IDLE_MS);
        return;
      }

      let processed = 0;
      state.running = true;
      const inFlight = (async () => {
        try {
          processed = await this.runMessageUpsertConsumerRedriveOnce(state);
        } catch (error) {
          console.error('[InboundMessageSpool] consumer redrive loop failed:', {
            error: errorMessage(error),
          });
        }
      })();
      state.inFlight = inFlight;

      try {
        await inFlight;
      } finally {
        if (state.inFlight === inFlight) {
          state.inFlight = undefined;
        }
        state.running = false;
        if (this.consumerRedriveState === state && !state.stopped) {
          this.scheduleConsumerRedrive(
            state,
            processed > 0
              ? CONSUMER_REDRIVE_ACTIVE_MS
              : CONSUMER_REDRIVE_IDLE_MS
          );
        }
      }
    };

    state.loop = loop;
    this.scheduleConsumerRedrive(state, 0);
  }

  async stopMessageUpsertConsumerRedrive(): Promise<void> {
    const state = this.consumerRedriveState;
    if (!state) {
      return;
    }

    state.stopped = true;
    if (state.timer) {
      clearTimeout(state.timer);
    }
    if (state.leaderHeartbeatTimer) {
      clearTimeout(state.leaderHeartbeatTimer);
    }
    await this.waitForConsumerRedriveDrain(state);
    if (this.consumerRedriveState === state) {
      this.consumerRedriveState = null;
    }
    await this.releaseConsumerRedriveLeadership(state);
  }

  private async waitForConsumerRedriveDrain(
    state: ConsumerRedriveState
  ): Promise<void> {
    const inFlight = state.inFlight;
    if (!inFlight) {
      return;
    }

    let timeout: ReturnType<typeof setTimeout> | undefined;
    const drained = await Promise.race([
      inFlight.then(
        () => true,
        () => true
      ),
      new Promise<boolean>((resolve) => {
        timeout = setTimeout(
          () => resolve(false),
          CONSUMER_REDRIVE_SHUTDOWN_DRAIN_MS
        );
      }),
    ]);
    if (timeout) {
      clearTimeout(timeout);
    }
    if (!drained) {
      console.warn('[InboundMessageSpool] consumer redrive drain timed out:', {
        timeout_ms: CONSUMER_REDRIVE_SHUTDOWN_DRAIN_MS,
      });
    }
  }

  private scheduleConsumerRedrive(
    state: ConsumerRedriveState,
    delayMs: number
  ): void {
    if (state.stopped || this.consumerRedriveState !== state || !state.loop) {
      return;
    }
    if (state.timer) {
      clearTimeout(state.timer);
    }
    state.timer = setTimeout(() => {
      state.timer = undefined;
      void state.loop?.();
    }, delayMs);
    state.timer.unref?.();
  }

  private async ensureConsumerRedriveLeadership(
    state: ConsumerRedriveState
  ): Promise<boolean> {
    if (
      state.stopped ||
      this.consumerRedriveState !== state ||
      (state.leaderOwned && Date.now() < state.leaderLeaseValidUntil)
    ) {
      return this.isConsumerRedriveLeaderActive(state);
    }

    if (
      state.leaderOwned &&
      (await this.renewConsumerRedriveLeadership(state))
    ) {
      return true;
    }

    this.markConsumerRedriveLeadershipLost(state);
    const acquired = await this.redis.set(
      MESSAGE_UPSERT_REDRIVE_LEADER_KEY,
      state.leaderOwner,
      'PX',
      CONSUMER_REDRIVE_LEADER_TTL_MS,
      'NX'
    );
    if (acquired !== 'OK') {
      return false;
    }

    state.leaderOwned = true;
    state.leaderLeaseValidUntil = Date.now() + CONSUMER_REDRIVE_LEADER_TTL_MS;
    this.scheduleConsumerRedriveLeaderHeartbeat(state);
    return true;
  }

  private isConsumerRedriveLeaderActive(state: ConsumerRedriveState): boolean {
    return (
      this.consumerRedriveState === state &&
      !state.stopped &&
      state.leaderOwned &&
      Date.now() < state.leaderLeaseValidUntil
    );
  }

  private scheduleConsumerRedriveLeaderHeartbeat(
    state: ConsumerRedriveState
  ): void {
    if (!this.isConsumerRedriveLeaderActive(state)) {
      return;
    }
    if (state.leaderHeartbeatTimer) {
      clearTimeout(state.leaderHeartbeatTimer);
    }
    state.leaderHeartbeatTimer = setTimeout(() => {
      state.leaderHeartbeatTimer = undefined;
      void this.heartbeatConsumerRedriveLeadership(state);
    }, CONSUMER_REDRIVE_LEADER_RENEW_MS);
    state.leaderHeartbeatTimer.unref?.();
  }

  private async heartbeatConsumerRedriveLeadership(
    state: ConsumerRedriveState
  ): Promise<void> {
    try {
      if (!(await this.renewConsumerRedriveLeadership(state))) {
        this.markConsumerRedriveLeadershipLost(state);
        return;
      }
      this.scheduleConsumerRedriveLeaderHeartbeat(state);
    } catch (error) {
      this.markConsumerRedriveLeadershipLost(state);
      console.error('[InboundMessageSpool] consumer redrive lease failed:', {
        error: errorMessage(error),
      });
    }
  }

  private async renewConsumerRedriveLeadership(
    state: ConsumerRedriveState
  ): Promise<boolean> {
    if (
      state.stopped ||
      this.consumerRedriveState !== state ||
      !state.leaderOwned
    ) {
      return false;
    }
    const renewed = await this.redis.eval(
      RENEW_CONSUMER_REDRIVE_LEADER_SCRIPT,
      1,
      MESSAGE_UPSERT_REDRIVE_LEADER_KEY,
      state.leaderOwner,
      String(CONSUMER_REDRIVE_LEADER_TTL_MS)
    );
    if (Number(renewed) !== 1) {
      return false;
    }
    state.leaderLeaseValidUntil = Date.now() + CONSUMER_REDRIVE_LEADER_TTL_MS;
    return true;
  }

  private markConsumerRedriveLeadershipLost(state: ConsumerRedriveState): void {
    state.leaderOwned = false;
    state.leaderLeaseValidUntil = 0;
    if (state.leaderHeartbeatTimer) {
      clearTimeout(state.leaderHeartbeatTimer);
      state.leaderHeartbeatTimer = undefined;
    }
  }

  private async releaseConsumerRedriveLeadership(
    state: ConsumerRedriveState
  ): Promise<void> {
    this.markConsumerRedriveLeadershipLost(state);
    try {
      await this.redis.eval(
        RELEASE_CONSUMER_REDRIVE_LEADER_SCRIPT,
        1,
        MESSAGE_UPSERT_REDRIVE_LEADER_KEY,
        state.leaderOwner
      );
    } catch (error) {
      console.error('[InboundMessageSpool] consumer redrive release failed:', {
        error: errorMessage(error),
      });
    }
  }

  private async readConsumerLegacyMigrationState(): Promise<ConsumerParkingLegacyMigrationState> {
    const parsed = safeJsonParse<Partial<ConsumerParkingLegacyMigrationState>>(
      await this.redis.get(MESSAGE_UPSERT_LEGACY_MIGRATION_STATE_KEY)
    );
    if (!parsed) {
      return this.initialConsumerLegacyMigrationState();
    }

    const cursor =
      typeof parsed.cursor === 'string' && /^\d+$/.test(parsed.cursor)
        ? parsed.cursor
        : '0';
    const pass =
      Number.isSafeInteger(parsed.pass) && Number(parsed.pass) >= 1
        ? Number(parsed.pass)
        : 1;
    const newKeysInPass =
      Number.isSafeInteger(parsed.newKeysInPass) &&
      Number(parsed.newKeysInPass) >= 0
        ? Number(parsed.newKeysInPass)
        : 0;
    const resumeAt =
      Number.isFinite(parsed.resumeAt) && Number(parsed.resumeAt) >= 0
        ? Number(parsed.resumeAt)
        : 0;
    return {
      cursor,
      pass,
      newKeysInPass,
      resumeAt,
      complete: parsed.complete === true,
    };
  }

  private initialConsumerLegacyMigrationState(): ConsumerParkingLegacyMigrationState {
    return {
      cursor: '0',
      pass: 1,
      newKeysInPass: 0,
      resumeAt: 0,
      complete: false,
    };
  }

  private nextConsumerLegacyMigrationState(
    state: ConsumerParkingLegacyMigrationState,
    cursor: string,
    indexedKeys: number,
    now: number
  ): ConsumerParkingLegacyMigrationState {
    const newKeysInPass = state.newKeysInPass + indexedKeys;
    if (cursor !== '0') {
      return {
        ...state,
        cursor,
        newKeysInPass,
        resumeAt: now + CONSUMER_LEGACY_MIGRATION_SCAN_THROTTLE_MS,
      };
    }
    if (state.pass >= 2 && newKeysInPass === 0) {
      return {
        cursor: '0',
        pass: state.pass,
        newKeysInPass,
        resumeAt: now + CONSUMER_LEGACY_MIGRATION_AUDIT_INTERVAL_MS,
        complete: true,
      };
    }
    return {
      cursor: '0',
      pass: state.pass + 1,
      newKeysInPass: 0,
      resumeAt: now + CONSUMER_LEGACY_MIGRATION_QUIET_MS,
      complete: false,
    };
  }

  private async runMessageUpsertConsumerRedriveOnce(
    state: ConsumerRedriveState
  ): Promise<number> {
    if (!(await this.ensureConsumerRedriveLeadership(state))) {
      return 0;
    }

    await this.pruneConsumerTerminalIndex(Date.now());
    const migrationWork = await this.discoverLegacyConsumerParkingKeys(state);
    if (!this.isConsumerRedriveLeaderActive(state)) {
      return migrationWork;
    }

    await this.fillConsumerParkingKeyBuffer(state);
    let remainingMembers = CONSUMER_REDRIVE_MAX_MEMBERS_PER_TICK;
    let processed = migrationWork;
    const parkingKeys = state.pendingParkingKeys.splice(
      0,
      CONSUMER_REDRIVE_MAX_KEYS_PER_TICK
    );
    for (let keyIndex = 0; keyIndex < parkingKeys.length; keyIndex += 1) {
      const parkingKey = parkingKeys[keyIndex] as string;
      if (remainingMembers <= 0 || !this.isConsumerRedriveLeaderActive(state)) {
        state.pendingParkingKeys.unshift(...parkingKeys.slice(keyIndex));
        break;
      }
      const keyMemberBudget = remainingMembers;
      const keyProcessed = await this.processConsumerParkingKey(
        parkingKey,
        state.publisher,
        keyMemberBudget,
        state
      );
      processed += keyProcessed;
      remainingMembers -= keyProcessed;
      if (keyProcessed >= keyMemberBudget) {
        state.pendingParkingKeys.push(parkingKey);
      }
    }
    return processed;
  }

  private async discoverLegacyConsumerParkingKeys(
    state: ConsumerRedriveState
  ): Promise<number> {
    const now = Date.now();
    const storedState = await this.readConsumerLegacyMigrationState();
    if (storedState.resumeAt > now) {
      return 0;
    }
    const migrationState = storedState.complete
      ? this.initialConsumerLegacyMigrationState()
      : storedState;

    const [nextCursor, keys] = await this.redis.scan(
      migrationState.cursor,
      'MATCH',
      MESSAGE_UPSERT_PARKING_SCAN_PATTERN,
      'COUNT',
      CONSUMER_LEGACY_MIGRATION_SCAN_COUNT
    );
    let indexedKeys = 0;
    if (keys.length > 0) {
      indexedKeys = await this.redis.sadd(
        MESSAGE_UPSERT_PARKING_INDEX_KEY,
        ...keys
      );
    }
    const nextState = this.nextConsumerLegacyMigrationState(
      migrationState,
      nextCursor,
      indexedKeys,
      now
    );
    const saved = await this.redis.eval(
      SAVE_CONSUMER_LEGACY_MIGRATION_STATE_SCRIPT,
      2,
      MESSAGE_UPSERT_REDRIVE_LEADER_KEY,
      MESSAGE_UPSERT_LEGACY_MIGRATION_STATE_KEY,
      state.leaderOwner,
      JSON.stringify(nextState)
    );
    if (Number(saved) !== 1) {
      this.markConsumerRedriveLeadershipLost(state);
      return 0;
    }
    return 1;
  }

  private async fillConsumerParkingKeyBuffer(
    state: ConsumerRedriveState
  ): Promise<void> {
    if (state.pendingParkingKeys.length > 0) {
      return;
    }

    const [nextCursor, parkingKeys] = await this.redis.sscan(
      MESSAGE_UPSERT_PARKING_INDEX_KEY,
      state.indexScanCursor,
      'COUNT',
      CONSUMER_REDRIVE_INDEX_SCAN_COUNT
    );
    state.indexScanCursor = nextCursor;
    state.pendingParkingKeys.push(...new Set(parkingKeys));
  }

  private async processConsumerParkingKey(
    parkingKey: string,
    publisher: InboundMessageParkingRedrivePublisher,
    maxMembers = CONSUMER_REDRIVE_MAX_MEMBERS_PER_TICK,
    state?: ConsumerRedriveState
  ): Promise<number> {
    if (!this.isMessageUpsertConsumerParkingKey(parkingKey)) {
      await this.redis.srem(MESSAGE_UPSERT_PARKING_INDEX_KEY, parkingKey);
      return 0;
    }

    const dueAt = await this.redisTimeMs();
    const members = await this.redis.zrangebyscore(
      parkingKey,
      '-inf',
      dueAt,
      'LIMIT',
      0,
      Math.max(1, Math.min(maxMembers, CONSUMER_REDRIVE_MAX_MEMBERS_PER_TICK))
    );
    for (const member of members) {
      await this.processClaimedConsumerParking(
        parkingKey,
        member,
        await this.redisTimeMs(),
        publisher,
        state
      );
    }
    return members.length;
  }

  private async processClaimedConsumerParking(
    parkingKey: string,
    member: string,
    now: number,
    publisher: InboundMessageParkingRedrivePublisher,
    state?: ConsumerRedriveState
  ): Promise<void> {
    const payloadKey = this.consumerParkingPayloadKey(parkingKey);
    const claimsKey = this.consumerParkingClaimsKey(parkingKey);
    const owner = `${process.pid}:${randomUUID()}`;
    const rawPayload = await this.redis.eval(
      CLAIM_CONSUMER_PARKING_SCRIPT,
      5,
      parkingKey,
      payloadKey,
      claimsKey,
      MESSAGE_UPSERT_PARKING_INDEX_KEY,
      MESSAGE_UPSERT_REDRIVE_LEADER_KEY,
      member,
      String(now),
      String(now + CONSUMER_REDRIVE_CLAIM_MS),
      owner,
      state?.leaderOwner ?? ''
    );
    if (typeof rawPayload !== 'string') {
      return;
    }

    if (state) {
      let leaderRenewed = false;
      try {
        leaderRenewed = await this.renewConsumerRedriveLeadership(state);
      } catch (error) {
        console.error(
          '[InboundMessageSpool] consumer redrive pre-publish fence failed:',
          { error: errorMessage(error) }
        );
      }
      if (!leaderRenewed) {
        this.markConsumerRedriveLeadershipLost(state);
        await this.rescheduleConsumerParking(
          parkingKey,
          payloadKey,
          claimsKey,
          member,
          owner,
          rawPayload,
          rawPayload,
          now,
          now,
          ''
        );
        return;
      }
    }

    const payload =
      safeJsonParse<IInboundMessageParkingPayload>(rawPayload) ?? null;
    if (!payload) {
      console.error(
        '[InboundMessageSpool] invalid consumer parking retained in DLT:',
        {
          parking_key: parkingKey,
          member,
          reason: 'invalid_consumer_parking_payload',
        }
      );
      await this.terminalizeConsumerParking(
        parkingKey,
        payloadKey,
        claimsKey,
        member,
        owner,
        rawPayload,
        this.buildInvalidConsumerTerminalPayload(rawPayload, now),
        now,
        state?.leaderOwner ?? ''
      );
      return;
    }

    const decisionNow = await this.redisTimeMs();
    const terminalReason = this.resolveConsumerTerminalReason(
      payload,
      decisionNow
    );
    if (terminalReason) {
      await this.terminalizeConsumerParking(
        parkingKey,
        payloadKey,
        claimsKey,
        member,
        owner,
        rawPayload,
        this.buildConsumerTerminalPayload(payload, terminalReason, decisionNow),
        decisionNow,
        state?.leaderOwner ?? ''
      );
      return;
    }

    try {
      const disposition = await publisher(payload);
      if (disposition !== 'published') {
        console.warn(
          '[InboundMessageSpool] terminal consumer parking retained:',
          {
            provider: payload.provider,
            worker_id: payload.worker_id,
            member,
            disposition,
            reason: payload.reason,
            stage: payload.stage,
          }
        );
        await this.terminalizeConsumerParking(
          parkingKey,
          payloadKey,
          claimsKey,
          member,
          owner,
          rawPayload,
          this.buildConsumerTerminalPayload(payload, 'permanent', decisionNow, {
            redrive_disposition: disposition,
          }),
          decisionNow,
          state?.leaderOwner ?? ''
        );
        return;
      }

      await this.completeConsumerParking(
        parkingKey,
        payloadKey,
        claimsKey,
        member,
        owner,
        rawPayload,
        decisionNow,
        this.resolveConsumerFirstParkedAt(payload, decisionNow),
        state?.leaderOwner ?? ''
      );
    } catch (error) {
      const failureNow = await this.redisTimeMs();
      const retryCount = (payload.retry_count ?? 0) + 1;
      const publisherError = this.limitUtf8Bytes(
        errorMessage(error),
        CONSUMER_TERMINAL_MAX_ERROR_BYTES
      );
      const retryPayload: IInboundMessageParkingPayload = {
        ...payload,
        retry_count: retryCount,
        next_attempt_at:
          failureNow + this.computeConsumerRedriveDelayMs(retryCount),
        error: publisherError,
      };
      const terminalLimit = this.resolveConsumerTerminalReason(
        retryPayload,
        failureNow
      );
      if (terminalLimit) {
        await this.terminalizeConsumerParking(
          parkingKey,
          payloadKey,
          claimsKey,
          member,
          owner,
          rawPayload,
          this.buildConsumerTerminalPayload(
            retryPayload,
            terminalLimit,
            failureNow,
            {
              publisher_error: publisherError,
            }
          ),
          failureNow,
          state?.leaderOwner ?? ''
        );
        return;
      }
      await this.rescheduleConsumerParking(
        parkingKey,
        payloadKey,
        claimsKey,
        member,
        owner,
        rawPayload,
        JSON.stringify(retryPayload),
        retryPayload.next_attempt_at as number,
        failureNow,
        state?.leaderOwner ?? ''
      );
    }
  }

  private async completeConsumerParking(
    parkingKey: string,
    payloadKey: string,
    claimsKey: string,
    member: string,
    owner: string,
    expectedPayload: string,
    retryAtOnRewrite: number,
    firstParkedAt: string,
    expectedLeaderOwner: string
  ): Promise<void> {
    await this.redis.eval(
      COMPLETE_CONSUMER_PARKING_SCRIPT,
      6,
      parkingKey,
      payloadKey,
      claimsKey,
      MESSAGE_UPSERT_PARKING_INDEX_KEY,
      this.consumerParkingLineageKey(parkingKey, member),
      MESSAGE_UPSERT_REDRIVE_LEADER_KEY,
      member,
      owner,
      expectedPayload,
      String(retryAtOnRewrite),
      String(CONSUMER_EMPTY_PAYLOAD_HASH_TTL_MS),
      firstParkedAt,
      String(CONSUMER_TERMINAL_RETENTION_MS),
      expectedLeaderOwner
    );
  }

  private async terminalizeConsumerParking(
    parkingKey: string,
    payloadKey: string,
    claimsKey: string,
    member: string,
    owner: string,
    expectedPayload: string,
    terminalPayload: IInboundMessageParkingPayload,
    now: number,
    expectedLeaderOwner: string
  ): Promise<void> {
    const terminalRecordKey = this.consumerTerminalRecordKey(
      parkingKey,
      member
    );
    await this.redis.eval(
      TERMINALIZE_CONSUMER_PARKING_SCRIPT,
      8,
      parkingKey,
      payloadKey,
      claimsKey,
      MESSAGE_UPSERT_PARKING_INDEX_KEY,
      terminalRecordKey,
      MESSAGE_UPSERT_TERMINAL_INDEX_KEY,
      this.consumerParkingLineageKey(parkingKey, member),
      MESSAGE_UPSERT_REDRIVE_LEADER_KEY,
      member,
      owner,
      expectedPayload,
      JSON.stringify(terminalPayload),
      String(now),
      String(now + CONSUMER_TERMINAL_RETENTION_MS),
      String(CONSUMER_TERMINAL_RETENTION_MS),
      expectedLeaderOwner
    );
  }

  private async rescheduleConsumerParking(
    parkingKey: string,
    payloadKey: string,
    claimsKey: string,
    member: string,
    owner: string,
    expectedPayload: string,
    serializedPayload: string,
    nextAttemptAt: number,
    retryAtOnRewrite: number,
    expectedLeaderOwner: string
  ): Promise<void> {
    await this.redis.eval(
      RESCHEDULE_CONSUMER_PARKING_SCRIPT,
      4,
      parkingKey,
      payloadKey,
      claimsKey,
      MESSAGE_UPSERT_REDRIVE_LEADER_KEY,
      member,
      owner,
      expectedPayload,
      serializedPayload,
      String(nextAttemptAt),
      String(retryAtOnRewrite),
      expectedLeaderOwner
    );
  }

  private async pruneConsumerTerminalIndex(now: number): Promise<void> {
    await this.redis.zremrangebyscore(
      MESSAGE_UPSERT_TERMINAL_INDEX_KEY,
      '-inf',
      now
    );
  }

  private resolveConsumerTerminalReason(
    payload: IInboundMessageParkingPayload,
    now: number
  ): IInboundMessageParkingPayload['terminal_reason'] | null {
    const firstParkedAt = Number(payload.first_parked_at);
    if (
      !Number.isFinite(firstParkedAt) ||
      firstParkedAt > now ||
      now - firstParkedAt >= INBOUND_MESSAGE_RETRY_WINDOW_MS
    ) {
      return 'max_age';
    }

    if (this.isPermanentConsumerParking(payload)) {
      return 'permanent';
    }

    if ((payload.retry_count ?? 0) >= CONSUMER_REDRIVE_MAX_ATTEMPTS) {
      return 'max_attempts';
    }

    return null;
  }

  private isPermanentConsumerParking(
    payload: IInboundMessageParkingPayload
  ): boolean {
    return (
      payload.reason === 'invalid_payload' ||
      payload.stage === 'message_upsert.discard.terminal'
    );
  }

  private resolveConsumerFirstParkedAt(
    payload: IInboundMessageParkingPayload,
    now: number
  ): string {
    for (const candidate of [payload.first_parked_at, payload.parked_at]) {
      const parsed = Number(candidate);
      if (Number.isSafeInteger(parsed) && parsed >= 0) {
        return String(parsed);
      }
    }
    return String(now);
  }

  private buildConsumerTerminalPayload(
    payload: IInboundMessageParkingPayload,
    terminalReason: NonNullable<
      IInboundMessageParkingPayload['terminal_reason']
    >,
    now: number,
    terminalMeta: Record<string, unknown> = {}
  ): IInboundMessageParkingPayload {
    const firstParkedAt = this.resolveConsumerFirstParkedAt(payload, now);
    if (terminalReason === 'max_age') {
      return {
        provider: payload.provider,
        account_id: payload.account_id,
        worker_id: payload.worker_id,
        event_source: payload.event_source,
        reason: payload.reason,
        stage: payload.stage,
        parked_at: firstParkedAt,
        first_parked_at: firstParkedAt,
        kafka_topic: payload.kafka_topic,
        partition: payload.partition,
        offset: payload.offset,
        retry_count: payload.retry_count,
        upsert: null,
        raw_payload: null,
        terminal_reason: terminalReason,
        terminalized_at: new Date(now).toISOString(),
      };
    }

    return {
      ...payload,
      first_parked_at: firstParkedAt,
      terminal_reason: terminalReason,
      terminalized_at: new Date(now).toISOString(),
      raw_meta: {
        ...(payload.raw_meta ?? {}),
        ...terminalMeta,
      },
    };
  }

  private buildInvalidConsumerTerminalPayload(
    rawPayload: string,
    now: number
  ): IInboundMessageParkingPayload {
    const terminalizedAt = new Date(now).toISOString();
    return {
      provider: MESSAGE_UPSERT_CONSUMER_PROVIDER,
      event_source: 'invalid_consumer_parking_payload',
      reason: 'invalid_payload',
      stage: 'message_upsert.consume.invalid_parking_payload',
      parked_at: String(now),
      first_parked_at: String(now),
      raw_payload: this.limitUtf8Bytes(
        rawPayload,
        CONSUMER_TERMINAL_MAX_RAW_PAYLOAD_BYTES
      ),
      terminal_reason: 'permanent',
      terminalized_at: terminalizedAt,
    };
  }

  private limitUtf8Bytes(value: string, maxBytes: number): string {
    if (Buffer.byteLength(value, 'utf8') <= maxBytes) {
      return value;
    }

    let low = 0;
    let high = value.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (Buffer.byteLength(value.slice(0, middle), 'utf8') <= maxBytes) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }
    return value.slice(0, low);
  }

  private isMessageUpsertConsumerParkingKey(key: string): boolean {
    return (
      key.startsWith('inbound:message:message_upsert_consumer:') &&
      key.endsWith(':parking')
    );
  }

  private consumerParkingPayloadKey(parkingKey: string): string {
    return `${parkingKey.slice(0, -':parking'.length)}:payloads`;
  }

  private consumerParkingClaimsKey(parkingKey: string): string {
    return `${parkingKey}:claims`;
  }

  private consumerTerminalRecordKey(
    parkingKey: string,
    member: string
  ): string {
    return `${MESSAGE_UPSERT_TERMINAL_RECORD_PREFIX}${this.consumerParkingRecordDigest(
      parkingKey,
      member
    )}`;
  }

  private consumerParkingLineageKey(
    parkingKey: string,
    member: string
  ): string {
    return `${MESSAGE_UPSERT_REDRIVE_LINEAGE_PREFIX}${this.consumerParkingRecordDigest(
      parkingKey,
      member
    )}`;
  }

  private consumerParkingRecordDigest(
    parkingKey: string,
    member: string
  ): string {
    return createHash('sha256')
      .update(parkingKey)
      .update('\0')
      .update(member)
      .digest('hex');
  }

  private computeConsumerRedriveDelayMs(attempt: number): number {
    return Math.min(
      CONSUMER_REDRIVE_BASE_DELAY_MS * Math.pow(2, Math.max(0, attempt - 1)),
      CONSUMER_REDRIVE_MAX_DELAY_MS
    );
  }

  private scheduleLoop(
    key: string,
    loop: () => Promise<void>,
    delayMs: number
  ): void {
    const state = this.states.get(key);
    if (!state) return;

    if (state.timer) {
      clearTimeout(state.timer);
    }

    state.timer = setTimeout(() => {
      state.timer = undefined;
      void loop();
    }, delayMs);
    state.timer.unref?.();
  }

  private isPublisherActive(
    stream: string,
    expectedState?: PublisherState
  ): boolean {
    const current = this.states.get(stream);
    return (
      current !== undefined &&
      (expectedState === undefined || current === expectedState)
    );
  }

  private async processStreamBatch(
    provider: InboundMessageSpoolProvider,
    workerId: string,
    scope: IInboundMessageSpoolScope,
    publisher: InboundPublisher,
    expectedState?: PublisherState
  ): Promise<number> {
    const stream = this.streamKey(provider, workerId, scope);
    if (!this.isPublisherActive(stream, expectedState)) {
      return 0;
    }
    await this.ensureGroup(stream);

    const entries = [
      ...(await this.readClaimedEntries(stream, workerId)),
      ...(await this.readNewEntries(stream, workerId)),
    ];

    let processed = 0;
    for (const entry of entries) {
      if (!this.isPublisherActive(stream, expectedState)) {
        break;
      }
      processed += 1;
      await this.processStreamEntry(
        provider,
        workerId,
        scope,
        entry,
        publisher,
        expectedState
      );
    }

    return processed;
  }

  private async processRetryBatch(
    provider: InboundMessageSpoolProvider,
    workerId: string,
    scope: IInboundMessageSpoolScope,
    publisher: InboundPublisher,
    expectedState?: PublisherState
  ): Promise<number> {
    const stream = this.streamKey(provider, workerId, scope);
    if (!this.isPublisherActive(stream, expectedState)) {
      return 0;
    }
    const retryKey = this.retrySetKey(provider, workerId, scope);
    const hashKey = this.retryPayloadHashKey(provider, workerId, scope);
    const now = await this.redisTimeMs();
    const members = await this.redis.zrangebyscore(
      retryKey,
      '-inf',
      now,
      'LIMIT',
      0,
      this.batchSize
    );

    let processed = 0;
    for (const member of members) {
      if (!this.isPublisherActive(stream, expectedState)) {
        break;
      }
      const rawPayload = await this.redis.hget(hashKey, member);
      if (typeof rawPayload !== 'string') {
        await this.redis.zrem(retryKey, member);
        continue;
      }
      const payload = safeJsonParse<IInboundMessageSpoolPayload>(rawPayload);
      if (!payload) {
        await this.discardRetryPayload(retryKey, hashKey, member, rawPayload);
        continue;
      }

      processed += 1;
      const publishedKey = `${retryKey}\0${member}`;
      const firstStoredAtMs = this.providerFirstStoredAtMs(payload);
      const clockRejection = this.providerPayloadClockRejection(
        firstStoredAtMs,
        await this.redisTimeMs()
      );
      if (clockRejection) {
        const discarded = await this.discardRetryPayload(
          retryKey,
          hashKey,
          member,
          rawPayload
        );
        this.publishedRetryMembers.delete(publishedKey);
        if (discarded) {
          this.logProviderPayloadClockDiscard(
            provider,
            workerId,
            scope,
            payload,
            clockRejection,
            'retry'
          );
        }
        continue;
      }
      try {
        if (!this.publishedRetryMembers.has(publishedKey)) {
          await publisher(payload);
          this.publishedRetryMembers.add(publishedKey);
        }
      } catch (error) {
        if (!this.isPublisherActive(stream, expectedState)) {
          return processed;
        }
        if (isObsoleteInboundMessageSpoolPayloadError(error)) {
          const discarded = await this.discardRetryPayload(
            retryKey,
            hashKey,
            member,
            rawPayload as string
          );
          this.publishedRetryMembers.delete(publishedKey);
          if (discarded) {
            this.logObsoletePayloadDiscarded(
              provider,
              workerId,
              scope,
              payload,
              error,
              'retry'
            );
          }
          continue;
        }
        await this.deferOrPark(
          provider,
          workerId,
          scope,
          payload,
          error,
          firstStoredAtMs
        );
        continue;
      }

      if (!this.isPublisherActive(stream, expectedState)) {
        return processed;
      }

      try {
        await this.redis.zrem(retryKey, member);
        this.publishedRetryMembers.delete(publishedKey);
        await this.redis.hdel(hashKey, member).catch((error) => {
          console.error(
            '[InboundMessageSpool] published retry payload hash cleanup failed:',
            {
              provider,
              worker_id: workerId,
              member,
              error: errorMessage(error),
            }
          );
        });
      } catch (error) {
        console.error(
          '[InboundMessageSpool] published retry acknowledgement failed:',
          {
            provider,
            worker_id: workerId,
            member,
            error: errorMessage(error),
          }
        );
      }
    }

    return processed;
  }

  private async processStreamEntry(
    provider: InboundMessageSpoolProvider,
    workerId: string,
    scope: IInboundMessageSpoolScope,
    entry: StreamEntry,
    publisher: InboundPublisher,
    expectedState?: PublisherState
  ): Promise<void> {
    const stream = this.streamKey(provider, workerId, scope);

    if (!entry.payload) {
      console.error('[InboundMessageSpool] invalid stream payload discarded:', {
        provider,
        worker_id: workerId,
        stream_id: entry.id,
        reason: 'invalid_stream_payload',
      });
      await this.ackDelete(stream, entry.id);
      return;
    }

    const publishedKey = `${stream}\0${entry.id}`;
    const firstStoredAtMs = this.providerFirstStoredAtMs(entry.payload);
    const clockRejection = this.providerPayloadClockRejection(
      firstStoredAtMs,
      await this.redisTimeMs()
    );
    if (clockRejection) {
      await this.ackDelete(stream, entry.id);
      this.publishedStreamEntries.delete(publishedKey);
      this.logProviderPayloadClockDiscard(
        provider,
        workerId,
        scope,
        entry.payload,
        clockRejection,
        'stream'
      );
      return;
    }
    try {
      if (!this.isPublisherActive(stream, expectedState)) {
        return;
      }
      if (!this.publishedStreamEntries.has(publishedKey)) {
        await publisher(entry.payload);
        this.publishedStreamEntries.add(publishedKey);
      }
    } catch (error) {
      if (!this.isPublisherActive(stream, expectedState)) {
        // Leave the pending stream entry intact. A replacement runtime will
        // claim it after claimIdleMs instead of losing it during teardown.
        return;
      }
      if (isObsoleteInboundMessageSpoolPayloadError(error)) {
        await this.ackDelete(stream, entry.id);
        this.publishedStreamEntries.delete(publishedKey);
        this.logObsoletePayloadDiscarded(
          provider,
          workerId,
          scope,
          entry.payload,
          error,
          'stream'
        );
        return;
      }
      await this.deferOrPark(
        provider,
        workerId,
        scope,
        entry.payload,
        error,
        firstStoredAtMs
      );
      await this.ackDelete(stream, entry.id);
      return;
    }

    if (!this.isPublisherActive(stream, expectedState)) {
      return;
    }

    try {
      await this.ackDelete(stream, entry.id);
      this.publishedStreamEntries.delete(publishedKey);
    } catch (error) {
      console.error(
        '[InboundMessageSpool] published stream acknowledgement failed:',
        {
          provider,
          worker_id: workerId,
          stream_id: entry.id,
          error: errorMessage(error),
        }
      );
    }
  }

  private async deferOrPark(
    provider: InboundMessageSpoolProvider,
    workerId: string,
    scope: IInboundMessageSpoolScope,
    payload: IInboundMessageSpoolPayload,
    error: unknown,
    firstStoredAtMs: number | null
  ): Promise<void> {
    const attempts = this.saturatingAttemptIncrement(payload.attempts);
    const lastError = errorMessage(error);

    if (
      attempts === this.maxAttempts ||
      (attempts > this.maxAttempts && attempts % this.maxAttempts === 0)
    ) {
      console.warn(
        '[InboundMessageSpool] Kafka remains unavailable; durable retry continues:',
        {
          provider,
          worker_id: workerId,
          dedupe_key: payload.dedupe_key,
          attempts,
          next_delay_ms: this.computeDelayMs(attempts),
          error: lastError,
        }
      );
    }

    const retryPayload: IInboundMessageSpoolPayload = {
      ...payload,
      attempts,
      last_error: lastError,
      next_attempt_at:
        (await this.redisTimeMs()) + this.computeDelayMs(attempts),
    };
    await this.storeRetry(
      provider,
      workerId,
      scope,
      retryPayload,
      firstStoredAtMs
    );
  }

  private async discardRetryPayload(
    retryKey: string,
    hashKey: string,
    member: string,
    expectedPayload: string
  ): Promise<boolean> {
    const result = await this.redis.eval(
      DISCARD_RETRY_PAYLOAD_SCRIPT,
      2,
      hashKey,
      retryKey,
      member,
      expectedPayload
    );
    return Number(result) === 1;
  }

  private logObsoletePayloadDiscarded(
    provider: InboundMessageSpoolProvider,
    workerId: string,
    scope: IInboundMessageSpoolScope,
    payload: IInboundMessageSpoolPayload,
    error: ObsoleteInboundMessageSpoolPayloadError,
    source: 'stream' | 'retry'
  ): void {
    console.info('[InboundMessageSpool] obsolete payload acknowledged:', {
      provider,
      worker_id: workerId,
      runtime_generation: scope.runtimeGeneration,
      connection_epoch: scope.connectionEpoch,
      dedupe_key: payload.dedupe_key,
      source,
      reason: error.reason,
    });
  }

  private providerPayloadClockRejection(
    firstStoredAtMs: number | null,
    now: number
  ):
    | 'missing_or_invalid_first_stored_at'
    | 'future_first_stored_at'
    | 'max_age'
    | null {
    if (firstStoredAtMs === null) {
      return 'missing_or_invalid_first_stored_at';
    }
    if (firstStoredAtMs > now) {
      return 'future_first_stored_at';
    }
    if (now - firstStoredAtMs >= INBOUND_MESSAGE_RETRY_WINDOW_MS) {
      return 'max_age';
    }
    return null;
  }

  private providerFirstStoredAtMs(
    payload: IInboundMessageSpoolPayload
  ): number | null {
    const value = payload.raw_meta?.[PROVIDER_FIRST_STORED_AT_META_KEY];
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
  }

  private async redisTimeMs(): Promise<number> {
    const [seconds, microseconds] = await this.redis.time();
    const timestamp =
      Number(seconds) * 1000 + Math.floor(Number(microseconds) / 1000);
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
      throw new Error('invalid_redis_time');
    }
    return timestamp;
  }

  private logProviderPayloadClockDiscard(
    provider: InboundMessageSpoolProvider,
    workerId: string,
    scope: IInboundMessageSpoolScope,
    payload: IInboundMessageSpoolPayload,
    reason:
      | 'missing_or_invalid_first_stored_at'
      | 'future_first_stored_at'
      | 'max_age',
    source: 'stream' | 'retry'
  ): void {
    console.info('[InboundMessageSpool] stale provider payload acknowledged:', {
      provider,
      worker_id: workerId,
      runtime_generation: scope.runtimeGeneration,
      connection_epoch: scope.connectionEpoch,
      dedupe_key: payload.dedupe_key,
      source,
      reason,
    });
  }

  private async requeueLegacyProviderParking(
    provider: InboundMessageSpoolProvider,
    workerId: string,
    scope: IInboundMessageSpoolScope
  ): Promise<void> {
    const parkingKey = this.parkingSetKey(provider, workerId, scope);
    const payloadKey = this.payloadHashKey(provider, workerId, scope);
    const retryKey = this.retrySetKey(provider, workerId, scope);
    const retryPayloadKey = this.retryPayloadHashKey(provider, workerId, scope);
    let requeued = 0;
    let discarded = 0;

    for (;;) {
      const members = await this.redis.zrangebyscore(
        parkingKey,
        '-inf',
        '+inf',
        'LIMIT',
        0,
        this.batchSize
      );
      if (members.length === 0) {
        break;
      }

      let madeProgress = false;
      for (const member of members) {
        const raw = await this.redis.hget(payloadKey, member);
        if (typeof raw !== 'string') {
          await this.redis.zrem(parkingKey, member);
          madeProgress = true;
          continue;
        }

        const parked =
          safeJsonParse<IInboundMessageParkingPayload>(raw) ?? null;
        const retryPayload = parked
          ? this.legacyProviderParkingRetryPayload(
              provider,
              workerId,
              scope,
              parked
            )
          : null;
        if (!retryPayload) {
          console.error(
            '[InboundMessageSpool] invalid legacy provider parking discarded:',
            {
              provider,
              worker_id: workerId,
              member,
              reason: 'invalid_legacy_provider_parking',
            }
          );
        }

        const moved = Number(
          await this.redis.eval(
            REQUEUE_LEGACY_PROVIDER_PARKING_SCRIPT,
            4,
            parkingKey,
            payloadKey,
            retryKey,
            retryPayloadKey,
            member,
            raw,
            retryPayload ? JSON.stringify(retryPayload) : '',
            String(retryPayload?.next_attempt_at ?? Date.now())
          )
        );
        if (moved !== 1 && moved !== 0) {
          continue;
        }
        madeProgress = true;
        if (moved !== 1) {
          continue;
        }
        if (retryPayload) {
          requeued += 1;
        } else {
          discarded += 1;
        }
      }
      if (!madeProgress) {
        break;
      }
    }

    if (requeued > 0 || discarded > 0) {
      console.info('[InboundMessageSpool] legacy provider parking migrated:', {
        provider,
        worker_id: workerId,
        runtime_generation: scope.runtimeGeneration,
        connection_epoch: scope.connectionEpoch,
        requeued,
        invalid_discarded: discarded,
      });
    }
  }

  private legacyProviderParkingRetryPayload(
    provider: InboundMessageSpoolProvider,
    workerId: string,
    scope: IInboundMessageSpoolScope,
    parked: IInboundMessageParkingPayload
  ): IInboundMessageSpoolPayload | null {
    const upsert = parked.upsert;
    const accountId = parked.account_id?.trim() || upsert?.account_id?.trim();
    const kafkaTopic = parked.kafka_topic?.trim();
    const kafkaKey =
      typeof parked.kafka_key === 'string' ? parked.kafka_key.trim() : '';
    const rawEventId =
      typeof parked.raw_meta?.event_id === 'string'
        ? parked.raw_meta.event_id.trim()
        : '';
    const dedupeKey =
      parked.dedupe_key?.trim() ||
      upsert?.event_id?.trim() ||
      rawEventId ||
      kafkaKey ||
      upsert?.message?.key?.id?.trim();
    if (!upsert || !accountId || !kafkaTopic || !kafkaKey || !dedupeKey) {
      return null;
    }

    const retryCount =
      typeof parked.retry_count === 'number' &&
      Number.isSafeInteger(parked.retry_count) &&
      parked.retry_count > 0
        ? Math.min(Number.MAX_SAFE_INTEGER, parked.retry_count)
        : 0;
    const nextAttemptAt = Date.now();
    const retryPayload: IInboundMessageSpoolPayload = {
      provider,
      source_provider: provider,
      account_id: accountId,
      worker_id: workerId,
      runtime_generation: String(scope.runtimeGeneration),
      connection_epoch: scope.connectionEpoch,
      event_source:
        parked.event_source?.trim() || 'legacy_provider_parking_recovery',
      dedupe_key: dedupeKey,
      kafka_topic: kafkaTopic,
      kafka_key: kafkaKey,
      upsert: {
        ...upsert,
        account_id: accountId,
        worker_id: workerId,
        source_provider: provider,
        runtime_generation: String(scope.runtimeGeneration),
        connection_epoch: scope.connectionEpoch,
      },
      raw_meta: parked.raw_meta,
      received_at: typeof parked.parked_at === 'string' ? parked.parked_at : '',
      attempts: retryCount,
      next_attempt_at: nextAttemptAt,
      ...(parked.error ? { last_error: parked.error } : {}),
    };
    return retryPayload;
  }

  private async storeRetry(
    provider: InboundMessageSpoolProvider,
    workerId: string,
    scope: IInboundMessageSpoolScope,
    payload: IInboundMessageSpoolPayload,
    firstStoredAtMs?: number | null
  ): Promise<void> {
    const member = this.payloadMember(payload);
    const dueAt = payload.next_attempt_at ?? Date.now();
    await this.storeScoredPayloadAtomically({
      hashKey: this.retryPayloadHashKey(provider, workerId, scope),
      sortedSetKey: this.retrySetKey(provider, workerId, scope),
      member,
      serializedPayload: JSON.stringify(payload),
      score: dueAt,
      firstStoredAtMs,
    });
  }

  private async storeParking(
    provider: InboundMessageSpoolProvider | 'message_upsert_consumer',
    workerId: string,
    member: string,
    payload: IInboundMessageParkingPayload,
    scope?: IInboundMessageSpoolScope
  ): Promise<void> {
    await this.storeScoredPayloadAtomically({
      hashKey: this.payloadHashKey(provider, workerId, scope),
      sortedSetKey: this.parkingSetKey(provider, workerId, scope),
      member,
      serializedPayload: JSON.stringify(payload),
      score: payload.next_attempt_at ?? Date.now(),
    });
  }

  private async storeConsumerParking(
    workerId: string,
    member: string,
    payload: IInboundMessageParkingPayload
  ): Promise<boolean> {
    const parkingKey = this.parkingSetKey(
      MESSAGE_UPSERT_CONSUMER_PROVIDER,
      workerId
    );
    const stored = await this.redis.eval(
      STORE_CONSUMER_PARKING_SCRIPT,
      5,
      this.payloadHashKey(MESSAGE_UPSERT_CONSUMER_PROVIDER, workerId),
      parkingKey,
      this.consumerParkingClaimsKey(parkingKey),
      this.consumerParkingLineageKey(parkingKey, member),
      this.consumerTerminalRecordKey(parkingKey, member),
      member,
      JSON.stringify(payload),
      String(CONSUMER_REDRIVE_BASE_DELAY_MS),
      String(CONSUMER_REDRIVE_MAX_DELAY_MS),
      String(CONSUMER_TERMINAL_RETENTION_MS)
    );
    return Number(stored) === 1;
  }

  private async storeScoredPayloadAtomically(input: {
    hashKey: string;
    sortedSetKey: string;
    member: string;
    serializedPayload: string;
    score: number;
    firstStoredAtMs?: number | null;
  }): Promise<void> {
    /*
     * A retry is discoverable only through the sorted set and recoverable only
     * through the payload hash. Writing them independently can leave either a
     * permanently orphaned payload or a due member that is deleted as invalid
     * after a partial Redis failure. Keep both sides in one Redis transaction.
     */
    await this.redis.eval(
      STORE_SCORED_PAYLOAD_SCRIPT,
      2,
      input.hashKey,
      input.sortedSetKey,
      input.member,
      input.serializedPayload,
      String(input.score),
      input.firstStoredAtMs === undefined || input.firstStoredAtMs === null
        ? ''
        : String(input.firstStoredAtMs)
    );
  }

  private async ensureGroup(stream: string): Promise<void> {
    if (this.groupsReady.has(stream)) {
      return;
    }

    try {
      await this.streamRedis().xgroup(
        'CREATE',
        stream,
        this.groupName,
        '0',
        'MKSTREAM'
      );
    } catch (error) {
      if (!errorMessage(error).includes('BUSYGROUP')) {
        throw error;
      }
    }

    this.groupsReady.add(stream);
  }

  private async readNewEntries(
    stream: string,
    workerId: string
  ): Promise<StreamEntry[]> {
    const response = await this.streamRedis().xreadgroup(
      'GROUP',
      this.groupName,
      this.consumerName(workerId),
      'COUNT',
      this.batchSize,
      'STREAMS',
      stream,
      '>'
    );
    return this.parseReadGroupResponse(response);
  }

  private async readClaimedEntries(
    stream: string,
    workerId: string
  ): Promise<StreamEntry[]> {
    const response = await this.streamRedis().xautoclaim(
      stream,
      this.groupName,
      this.consumerName(workerId),
      this.claimIdleMs,
      '0-0',
      'COUNT',
      this.batchSize
    );
    return this.parseAutoClaimResponse(response);
  }

  private parseReadGroupResponse(response: unknown): StreamEntry[] {
    if (!Array.isArray(response)) return [];

    const entries: StreamEntry[] = [];
    for (const streamEntry of response) {
      if (!Array.isArray(streamEntry) || !Array.isArray(streamEntry[1])) {
        continue;
      }
      entries.push(...this.parseMessages(streamEntry[1]));
    }
    return entries;
  }

  private parseAutoClaimResponse(response: unknown): StreamEntry[] {
    if (!Array.isArray(response) || !Array.isArray(response[1])) {
      return [];
    }

    return this.parseMessages(response[1]);
  }

  private parseMessages(messages: unknown[]): StreamEntry[] {
    const entries: StreamEntry[] = [];
    for (const message of messages) {
      if (!Array.isArray(message) || typeof message[0] !== 'string') {
        continue;
      }

      const values = Array.isArray(message[1]) ? message[1] : [];
      const rawPayload = this.getField(values, 'payload');
      entries.push({
        id: message[0],
        payload: safeJsonParse<IInboundMessageSpoolPayload>(rawPayload),
        rawPayload,
      });
    }
    return entries;
  }

  private getField(values: unknown[], key: string): string | null {
    for (let index = 0; index < values.length - 1; index += 2) {
      if (values[index] === key && typeof values[index + 1] === 'string') {
        return values[index + 1] as string;
      }
    }
    return null;
  }

  private async ackDelete(stream: string, streamId: string): Promise<void> {
    await Promise.all([
      this.streamRedis().xack(stream, this.groupName, streamId),
      this.streamRedis().xdel(stream, streamId),
    ]);
  }

  private payloadMember(payload: IInboundMessageSpoolPayload): string {
    return `${payload.provider}:${payload.worker_id}:${payload.runtime_generation}:${payload.connection_epoch}:${payload.dedupe_key}`;
  }

  private parkingMember(payload: IInboundMessageParkingPayload): string {
    const dedupeKey = payload.dedupe_key?.trim();
    if (dedupeKey) {
      return `${payload.provider}:dedupe:${dedupeKey}`;
    }

    if (payload.kafka_topic && payload.partition !== undefined) {
      return `${payload.kafka_topic}:${payload.partition}:${payload.offset ?? 'unknown'}`;
    }

    if (payload.kafka_key) {
      return `${payload.provider}:${payload.kafka_key}`;
    }

    return `${payload.provider}:${payload.event_source}:${Date.now()}`;
  }

  private computeDelayMs(attempt: number): number {
    const boundedExponent = Math.min(
      52,
      Math.max(0, Number.isSafeInteger(attempt) ? attempt : 0)
    );
    return Math.min(
      this.baseDelayMs * Math.pow(2, boundedExponent),
      this.maxDelayMs
    );
  }

  private saturatingAttemptIncrement(value: unknown): number {
    const normalized =
      typeof value === 'number' && Number.isSafeInteger(value) && value > 0
        ? value
        : 0;
    return normalized >= Number.MAX_SAFE_INTEGER
      ? Number.MAX_SAFE_INTEGER
      : normalized + 1;
  }

  private consumerName(workerId: string): string {
    return `${workerId}:${process.pid}`;
  }

  private payloadScope(
    payload: IInboundMessageSpoolPayload
  ): IInboundMessageSpoolScope {
    const runtimeGeneration = Number(payload.runtime_generation);
    const connectionEpoch = payload.connection_epoch?.trim();
    if (
      !Number.isSafeInteger(runtimeGeneration) ||
      runtimeGeneration <= 0 ||
      !connectionEpoch
    ) {
      throw new TypeError('Inbound spool payload is missing a valid fence');
    }

    return { runtimeGeneration, connectionEpoch };
  }

  private scopePrefix(
    provider: InboundMessageSpoolProvider,
    workerId: string,
    scope: IInboundMessageSpoolScope
  ): string {
    return `inbound:message:${provider}:${workerId}:generation:${scope.runtimeGeneration}:epoch:${scope.connectionEpoch}`;
  }

  private scopeIndexKey(workerId: string): string {
    return `inbound:message:spool-index:v1:${workerId}`;
  }

  private scopeKeys(
    provider: InboundMessageSpoolProvider,
    workerId: string,
    scope: IInboundMessageSpoolScope
  ): string[] {
    return [
      this.streamKey(provider, workerId, scope),
      this.retrySetKey(provider, workerId, scope),
      this.retryPayloadHashKey(provider, workerId, scope),
      this.parkingSetKey(provider, workerId, scope),
      this.payloadHashKey(provider, workerId, scope),
    ];
  }

  private isIndexedSpoolKeyForWorker(workerId: string, key: string): boolean {
    return SPOOL_PROVIDERS.some((provider) => {
      const prefix = `inbound:message:${provider}:${workerId}:`;
      if (!key.startsWith(prefix)) {
        return false;
      }

      const remainder = key.slice(prefix.length);
      if (
        SPOOL_KEY_SUFFIXES.includes(
          remainder as (typeof SPOOL_KEY_SUFFIXES)[number]
        )
      ) {
        return true;
      }

      return /^generation:[1-9]\d*:epoch:.+:(?:stream|retry|retry-payloads|parking|payloads)$/.test(
        remainder
      );
    });
  }

  private async registerScopeKeys(
    provider: InboundMessageSpoolProvider,
    workerId: string,
    scope: IInboundMessageSpoolScope,
    force = false
  ): Promise<void> {
    const marker = this.streamKey(provider, workerId, scope);
    if (!force && this.registeredScopes.has(marker)) {
      return;
    }

    await this.redis.sadd(
      this.scopeIndexKey(workerId),
      ...this.scopeKeys(provider, workerId, scope)
    );
    this.registeredScopes.add(marker);
  }

  private deletePublishedMarkersForStream(stream: string): void {
    const streamPrefix = `${stream}\0`;
    const retryPrefix = `${stream.slice(0, -':stream'.length)}:retry\0`;
    for (const key of this.publishedStreamEntries) {
      if (key.startsWith(streamPrefix)) {
        this.publishedStreamEntries.delete(key);
      }
    }
    for (const key of this.publishedRetryMembers) {
      if (key.startsWith(retryPrefix)) {
        this.publishedRetryMembers.delete(key);
      }
    }
  }

  private parseIndexedScope(
    workerId: string,
    key: string
  ): {
    provider: InboundMessageSpoolProvider;
    scope: IInboundMessageSpoolScope;
  } | null {
    for (const provider of SPOOL_PROVIDERS) {
      const prefix = `inbound:message:${provider}:${workerId}:generation:`;
      if (!key.startsWith(prefix)) {
        continue;
      }

      const match = key
        .slice(prefix.length)
        .match(
          /^([1-9]\d*):epoch:(.+):(?:stream|retry|retry-payloads|parking|payloads)$/
        );
      if (!match) {
        return null;
      }

      const runtimeGeneration = Number(match[1]);
      const connectionEpoch = match[2]?.trim();
      if (!Number.isSafeInteger(runtimeGeneration) || !connectionEpoch) {
        return null;
      }

      return {
        provider,
        scope: { runtimeGeneration, connectionEpoch },
      };
    }

    return null;
  }

  private async pruneEmptyHistoricalScope(
    activeProvider: InboundMessageSpoolProvider,
    workerId: string,
    activeScope: IInboundMessageSpoolScope,
    targetProvider: InboundMessageSpoolProvider,
    targetScope: IInboundMessageSpoolScope
  ): Promise<number> {
    return Number(
      await this.redis.eval(
        PRUNE_EMPTY_HISTORICAL_SCOPE_SCRIPT,
        7,
        `${WHATSAPP_RUNTIME_FENCE_KEY_PREFIX}:${workerId}`,
        this.scopeIndexKey(workerId),
        ...this.scopeKeys(targetProvider, workerId, targetScope),
        workerId,
        String(activeScope.runtimeGeneration),
        activeScope.connectionEpoch,
        activeProvider,
        targetProvider,
        String(targetScope.runtimeGeneration),
        targetScope.connectionEpoch
      )
    );
  }

  private async repairHistoricalScopeDiscoveryPair(
    activeProvider: InboundMessageSpoolProvider,
    workerId: string,
    activeScope: IInboundMessageSpoolScope,
    targetProvider: InboundMessageSpoolProvider,
    targetScope: IInboundMessageSpoolScope,
    sortedSetKey: string,
    payloadHashKey: string,
    source: 'retry' | 'parking',
    activeScopeGuard: ActiveScopeGuard
  ): Promise<'complete' | 'preserve' | 'stop'> {
    let cursor = '0';
    let page = 1;
    let pageMembersExamined = 0;
    let pageDeadline = Date.now() + this.cleanupDeadlineMs;
    let repairedMembers = 0;

    do {
      const response = await this.redis.eval(
        REPAIR_HISTORICAL_SCOPE_DISCOVERY_SCRIPT,
        3,
        `${WHATSAPP_RUNTIME_FENCE_KEY_PREFIX}:${workerId}`,
        sortedSetKey,
        payloadHashKey,
        workerId,
        String(activeScope.runtimeGeneration),
        activeScope.connectionEpoch,
        activeProvider,
        targetProvider,
        String(targetScope.runtimeGeneration),
        targetScope.connectionEpoch,
        cursor,
        String(Math.min(SCOPE_INDEX_SCAN_COUNT, this.cleanupMaxIndexedKeys)),
        String(Date.now())
      );
      if (!Array.isArray(response) || response.length < 4) {
        throw new Error('Redis returned an invalid spool discovery repair');
      }

      const code = Number(response[0]);
      if (code === -1) {
        return 'stop';
      }
      if (code === -2 || code === -3) {
        return 'preserve';
      }
      if (code !== 1) {
        throw new Error('Redis returned an unknown spool discovery repair');
      }

      cursor = String(response[1]);
      repairedMembers += Number(response[2]) || 0;
      pageMembersExamined += Number(response[3]) || 0;
      if (
        cursor !== '0' &&
        (pageMembersExamined >= this.cleanupMaxIndexedKeys ||
          Date.now() >= pageDeadline)
      ) {
        console.warn(
          '[InboundMessageSpool] indexed payload discovery repair yielded:',
          {
            provider: targetProvider,
            worker_id: workerId,
            runtime_generation: targetScope.runtimeGeneration,
            connection_epoch: targetScope.connectionEpoch,
            source,
            page,
            payloads_examined: pageMembersExamined,
            max_payloads_per_page: this.cleanupMaxIndexedKeys,
            deadline_ms: this.cleanupDeadlineMs,
          }
        );
        if (!(await activeScopeGuard())) {
          return 'stop';
        }
        await new Promise<void>((resolve) => setImmediate(resolve));
        page += 1;
        pageMembersExamined = 0;
        pageDeadline = Date.now() + this.cleanupDeadlineMs;
      }
    } while (cursor !== '0');

    if (repairedMembers > 0) {
      console.info(
        '[InboundMessageSpool] restored indexed payload discovery:',
        {
          provider: targetProvider,
          worker_id: workerId,
          runtime_generation: targetScope.runtimeGeneration,
          connection_epoch: targetScope.connectionEpoch,
          source,
          repaired_members: repairedMembers,
        }
      );
    }
    return 'complete';
  }

  private async repairHistoricalScopeDiscovery(
    activeProvider: InboundMessageSpoolProvider,
    workerId: string,
    activeScope: IInboundMessageSpoolScope,
    targetProvider: InboundMessageSpoolProvider,
    targetScope: IInboundMessageSpoolScope,
    activeScopeGuard: ActiveScopeGuard
  ): Promise<'complete' | 'preserve' | 'stop'> {
    const retry = await this.repairHistoricalScopeDiscoveryPair(
      activeProvider,
      workerId,
      activeScope,
      targetProvider,
      targetScope,
      this.retrySetKey(targetProvider, workerId, targetScope),
      this.retryPayloadHashKey(targetProvider, workerId, targetScope),
      'retry',
      activeScopeGuard
    );
    if (retry !== 'complete') {
      return retry;
    }
    return this.repairHistoricalScopeDiscoveryPair(
      activeProvider,
      workerId,
      activeScope,
      targetProvider,
      targetScope,
      this.parkingSetKey(targetProvider, workerId, targetScope),
      this.payloadHashKey(targetProvider, workerId, targetScope),
      'parking',
      activeScopeGuard
    );
  }

  private clearLocalPublisherStateForScope(
    provider: InboundMessageSpoolProvider,
    workerId: string,
    scope: IInboundMessageSpoolScope
  ): void {
    const stream = this.streamKey(provider, workerId, scope);
    const state = this.states.get(stream);
    if (state?.timer) {
      clearTimeout(state.timer);
    }
    this.states.delete(stream);
    this.groupsReady.delete(stream);
    this.registeredScopes.delete(stream);
    this.deletePublishedMarkersForStream(stream);
  }

  private async resumeIndexedSpools(
    provider: InboundMessageSpoolProvider,
    workerId: string,
    activeScope: IInboundMessageSpoolScope,
    publisher: InboundPublisher,
    activeScopeGuard: ActiveScopeGuard
  ): Promise<void> {
    const ownerKey = this.streamKey(provider, workerId, activeScope);
    const indexKey = this.scopeIndexKey(workerId);
    const indexedScopes = new Map<
      string,
      {
        provider: InboundMessageSpoolProvider;
        scope: IInboundMessageSpoolScope;
      }
    >();
    let cursor = '0';
    let pendingKeys: string[] = [];
    let pendingKeyIndex = 0;
    let hasScanned = false;
    let page = 0;
    let completed = false;

    // Do not mutate the set while SSCAN is in progress. Redis permits members
    // to be skipped when a collection changes during iteration, which is the
    // exact failure mode that allowed dead scope references to accumulate.
    while (!completed) {
      page += 1;
      const pageDeadline = Date.now() + this.cleanupDeadlineMs;
      let pageKeysExamined = 0;

      while (
        pageKeysExamined < this.cleanupMaxIndexedKeys &&
        Date.now() < pageDeadline
      ) {
        if (pendingKeyIndex >= pendingKeys.length) {
          if (hasScanned && cursor === '0') {
            completed = true;
            break;
          }
          const [nextCursor, keys] = await this.redis.sscan(
            indexKey,
            cursor,
            'COUNT',
            Math.min(
              SCOPE_INDEX_SCAN_COUNT,
              this.cleanupMaxIndexedKeys - pageKeysExamined
            )
          );
          hasScanned = true;
          cursor = nextCursor;
          pendingKeys = keys;
          pendingKeyIndex = 0;

          if (pendingKeys.length === 0 && cursor === '0') {
            completed = true;
            break;
          }
          if (pendingKeys.length === 0) {
            continue;
          }
        }

        const key = pendingKeys[pendingKeyIndex++];
        pageKeysExamined += 1;
        const parsed = this.parseIndexedScope(workerId, key);
        if (!parsed) {
          continue;
        }

        const scopeKey = `${parsed.provider}\0${parsed.scope.runtimeGeneration}\0${parsed.scope.connectionEpoch}`;
        indexedScopes.set(scopeKey, parsed);
      }

      if (pendingKeyIndex >= pendingKeys.length && cursor === '0') {
        completed = true;
      }

      if (!completed) {
        console.warn('[InboundMessageSpool] indexed resume page yielded:', {
          provider,
          worker_id: workerId,
          runtime_generation: activeScope.runtimeGeneration,
          connection_epoch: activeScope.connectionEpoch,
          phase: 'scan',
          page,
          indexed_keys_examined: pageKeysExamined,
          max_indexed_keys_per_page: this.cleanupMaxIndexedKeys,
          deadline_ms: this.cleanupDeadlineMs,
        });
        if (!(await activeScopeGuard())) {
          return;
        }
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }

    const scopes = [...indexedScopes.values()];
    let scopeIndex = 0;
    let processingPage = 0;
    let prunedScopes = 0;
    let resumedScopes = 0;
    while (scopeIndex < scopes.length) {
      processingPage += 1;
      const pageDeadline = Date.now() + this.cleanupDeadlineMs;
      let pageScopesExamined = 0;

      while (
        scopeIndex < scopes.length &&
        pageScopesExamined < this.cleanupMaxIndexedKeys &&
        Date.now() < pageDeadline
      ) {
        const parsed = scopes[scopeIndex++];
        pageScopesExamined += 1;
        const isActiveScope =
          parsed.provider === provider &&
          parsed.scope.runtimeGeneration === activeScope.runtimeGeneration &&
          parsed.scope.connectionEpoch === activeScope.connectionEpoch;
        if (isActiveScope) {
          continue;
        }
        if (!(await activeScopeGuard())) {
          return;
        }

        const isHistoricalScope =
          parsed.scope.runtimeGeneration <= activeScope.runtimeGeneration;
        if (!isHistoricalScope) {
          // A lower generation must never rehome work already prepared by a
          // future runtime. Leave both its keys and index references untouched;
          // the winning runtime will consume them after activating its fence.
          console.warn(
            '[InboundMessageSpool] future indexed scope preserved:',
            {
              provider: parsed.provider,
              worker_id: workerId,
              runtime_generation: parsed.scope.runtimeGeneration,
              connection_epoch: parsed.scope.connectionEpoch,
              active_runtime_generation: activeScope.runtimeGeneration,
            }
          );
          continue;
        }

        let pruneResult = await this.pruneEmptyHistoricalScope(
          provider,
          workerId,
          activeScope,
          parsed.provider,
          parsed.scope
        );
        if (pruneResult === 2) {
          const repair = await this.repairHistoricalScopeDiscovery(
            provider,
            workerId,
            activeScope,
            parsed.provider,
            parsed.scope,
            activeScopeGuard
          );
          if (repair === 'stop') {
            return;
          }
          if (repair === 'preserve') {
            continue;
          }
          // Close the race with a publisher draining the hash during repair.
          // The second atomic inspection either prunes a now-empty scope or
          // confirms that its repaired work is still durable and resumable.
          pruneResult = await this.pruneEmptyHistoricalScope(
            provider,
            workerId,
            activeScope,
            parsed.provider,
            parsed.scope
          );
        }
        if (pruneResult === -1) {
          return;
        }
        if (pruneResult === 1) {
          this.clearLocalPublisherStateForScope(
            parsed.provider,
            workerId,
            parsed.scope
          );
          prunedScopes += 1;
          continue;
        }
        if (pruneResult === -2) {
          continue;
        }
        if (pruneResult === -3) {
          console.warn(
            '[InboundMessageSpool] indexed scope has an unexpected Redis type:',
            {
              provider: parsed.provider,
              worker_id: workerId,
              runtime_generation: parsed.scope.runtimeGeneration,
              connection_epoch: parsed.scope.connectionEpoch,
            }
          );
          continue;
        }

        // A zero result means at least one correctly typed durable structure
        // contains data and the historical publisher must recover it.
        this.startOwnedPublisher(
          parsed.provider,
          workerId,
          parsed.scope,
          publisher,
          ownerKey,
          undefined,
          false
        );
        resumedScopes += 1;
      }

      if (scopeIndex < scopes.length) {
        console.warn('[InboundMessageSpool] indexed resume page yielded:', {
          provider,
          worker_id: workerId,
          runtime_generation: activeScope.runtimeGeneration,
          connection_epoch: activeScope.connectionEpoch,
          phase: 'process',
          page: processingPage,
          indexed_scopes_examined: pageScopesExamined,
          max_indexed_scopes_per_page: this.cleanupMaxIndexedKeys,
          deadline_ms: this.cleanupDeadlineMs,
        });
        if (!(await activeScopeGuard())) {
          return;
        }
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }

    if (resumedScopes > 0) {
      console.info('[InboundMessageSpool] resumed persisted scopes:', {
        provider,
        worker_id: workerId,
        runtime_generation: activeScope.runtimeGeneration,
        connection_epoch: activeScope.connectionEpoch,
        resumed_scopes: resumedScopes,
      });
    }
    if (prunedScopes > 0) {
      console.info('[InboundMessageSpool] pruned empty persisted scopes:', {
        provider,
        worker_id: workerId,
        runtime_generation: activeScope.runtimeGeneration,
        connection_epoch: activeScope.connectionEpoch,
        pruned_scopes: prunedScopes,
      });
    }
  }

  private streamRedis(): RedisStreamClient {
    return this.redis as RedisStreamClient;
  }
}
