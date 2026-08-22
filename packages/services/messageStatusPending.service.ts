import { injectable, inject } from 'tsyringe';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { IMessageStatusUpdate } from '@core/common/interfaces/IMessageStatusUpdate';
import type { MessageSummaryPatch } from './messageStatus.service';
import { canonicalMessageStatusMessageId } from '@core/common/functions/messageStatusIdentity';
import {
  messageDeliveryFactFromOutcome,
  messageDeliveryOutcomeRank,
  resolveMessageDeliveryOutcome,
  selectStrongestMessageDeliveryOutcome,
} from '@core/common/functions/messageDeliveryOutcome';

interface AppliedStatusLedgerEntry {
  account_id: string;
  worker_id?: string;
  message_id: string;
  internal_message_id: string;
  patch: MessageSummaryPatch;
  failed?: boolean;
  failure_kind?: 'failed' | 'ambiguous' | null;
  applied_at: number;
}

type PendingStatusClaimDecision = 'claim' | 'discard' | 'ignore';

interface StorePendingStatusOptions {
  incrementRetry?: boolean;
  resetRetryState?: boolean;
  forceParking?: boolean;
}

interface PendingStatusClaimIdentity {
  ownerId: string;
  token: string;
}

export class MessageStatusPendingClaimLeaseLostError extends Error {
  constructor() {
    super('message_status_pending_claim_lease_lost');
    this.name = 'MessageStatusPendingClaimLeaseLostError';
  }
}

const STORE_PENDING_CAS_SCRIPT = `
local current = redis.call('HGET', KEYS[1], ARGV[1]) or ''
if current ~= ARGV[2] then
  return 0
end

redis.call('HSET', KEYS[1], ARGV[1], ARGV[3])
redis.call('ZREM', KEYS[2], ARGV[1])
redis.call('ZREM', KEYS[3], ARGV[1])
redis.call('ZREM', KEYS[4], ARGV[1])
redis.call('HDEL', KEYS[5], ARGV[1])

local redis_time = redis.call('TIME')
local now = tonumber(redis_time[1]) * 1000 +
  math.floor(tonumber(redis_time[2]) / 1000)
local delay = math.max(0, tonumber(ARGV[4]) or 0)
local due_at = now + delay
if ARGV[5] == '1' then
  redis.call('ZADD', KEYS[3], due_at, ARGV[1])
else
  redis.call('ZADD', KEYS[2], due_at, ARGV[1])
end
return 1
`;

const CLAIM_PENDING_CAS_SCRIPT = `
local current = redis.call('HGET', KEYS[1], ARGV[1]) or ''
if current ~= ARGV[2] then
  return 0
end

local redis_time = redis.call('TIME')
local now = tonumber(redis_time[1]) * 1000 +
  math.floor(tonumber(redis_time[2]) / 1000)
local processing_timeout = tonumber(ARGV[4])
if not processing_timeout or processing_timeout <= 0 then
  return 0
end

local due_score = tonumber(redis.call('ZSCORE', KEYS[2], ARGV[1]) or '')
if not due_score or due_score > now then
  return 0
end
if redis.call('ZREM', KEYS[2], ARGV[1]) ~= 1 then
  return 0
end

redis.call('ZREM', KEYS[3], ARGV[1])
redis.call('HSET', KEYS[5], ARGV[1], ARGV[3])
redis.call('ZADD', KEYS[4], now + processing_timeout, ARGV[1])
return 1
`;

const EXTEND_PENDING_CLAIM_LEASE_SCRIPT = `
local payload_raw = redis.call('HGET', KEYS[1], ARGV[1])
if not payload_raw then
  return 0
end
local payload_ok, payload = pcall(cjson.decode, payload_raw)
if not payload_ok or type(payload) ~= 'table' then
  return 0
end
if tostring(payload.pending_retry_version or '') ~= ARGV[2] then
  return 0
end

local claim_raw = redis.call('HGET', KEYS[2], ARGV[1])
if not claim_raw then
  return 0
end
local claim_ok, claim = pcall(cjson.decode, claim_raw)
if not claim_ok or type(claim) ~= 'table' then
  return 0
end
if tostring(claim.owner_id or '') ~= ARGV[3] then
  return 0
end
if tostring(claim.token or '') ~= ARGV[4] then
  return 0
end

local redis_time = redis.call('TIME')
local now = tonumber(redis_time[1]) * 1000 +
  math.floor(tonumber(redis_time[2]) / 1000)
local processing_timeout = tonumber(ARGV[5])
if not processing_timeout or processing_timeout <= 0 then
  return 0
end

local score = tonumber(redis.call('ZSCORE', KEYS[3], ARGV[1]) or '')
if not score or score <= now then
  return 0
end

redis.call('ZADD', KEYS[3], now + processing_timeout, ARGV[1])
return 1
`;

const TRANSITION_CLAIMED_PENDING_CAS_SCRIPT = `
local current = redis.call('HGET', KEYS[1], ARGV[1]) or ''
if current ~= ARGV[2] then
  return 0
end
if redis.call('HGET', KEYS[5], ARGV[1]) ~= ARGV[3] then
  return 0
end

local redis_time = redis.call('TIME')
local now = tonumber(redis_time[1]) * 1000 +
  math.floor(tonumber(redis_time[2]) / 1000)
local processing_score = tonumber(redis.call('ZSCORE', KEYS[4], ARGV[1]) or '')
if not processing_score or processing_score <= now then
  return 0
end

redis.call('HSET', KEYS[1], ARGV[1], ARGV[4])
redis.call('HDEL', KEYS[5], ARGV[1])
redis.call('ZREM', KEYS[2], ARGV[1])
redis.call('ZREM', KEYS[3], ARGV[1])
redis.call('ZREM', KEYS[4], ARGV[1])
local delay = math.max(0, tonumber(ARGV[5]) or 0)
local due_at = now + delay
if ARGV[6] == '1' then
  redis.call('ZADD', KEYS[3], due_at, ARGV[1])
else
  redis.call('ZADD', KEYS[2], due_at, ARGV[1])
end
return 1
`;

const DELETE_PENDING_CAS_SCRIPT = `
local current = redis.call('HGET', KEYS[1], ARGV[1]) or ''
if current ~= ARGV[2] then
  return 0
end
if ARGV[3] ~= '' and redis.call('HGET', KEYS[5], ARGV[1]) ~= ARGV[3] then
  return 0
end
if ARGV[3] ~= '' then
  local redis_time = redis.call('TIME')
  local now = tonumber(redis_time[1]) * 1000 +
    math.floor(tonumber(redis_time[2]) / 1000)
  local processing_score = tonumber(redis.call('ZSCORE', KEYS[4], ARGV[1]) or '')
  if not processing_score or processing_score <= now then
    return 0
  end
end

redis.call('HDEL', KEYS[1], ARGV[1])
redis.call('ZREM', KEYS[2], ARGV[1])
redis.call('ZREM', KEYS[3], ARGV[1])
redis.call('ZREM', KEYS[4], ARGV[1])
redis.call('HDEL', KEYS[5], ARGV[1])
return 1
`;

const RECOVER_EXPIRED_PENDING_CAS_SCRIPT = `
local current = redis.call('HGET', KEYS[5], ARGV[1]) or ''
if current ~= ARGV[2] then
  return 0
end

local redis_time = redis.call('TIME')
local now = tonumber(redis_time[1]) * 1000 +
  math.floor(tonumber(redis_time[2]) / 1000)
local score = tonumber(redis.call('ZSCORE', KEYS[1], ARGV[1]) or '')
if not score or score > now then
  return 0
end
if redis.call('ZREM', KEYS[1], ARGV[1]) ~= 1 then
  return 0
end
redis.call('ZREM', KEYS[3], ARGV[1])
redis.call('HDEL', KEYS[4], ARGV[1])
redis.call('ZADD', KEYS[2], now, ARGV[1])
return 1
`;

const MARK_APPLIED_SCRIPT = `
local redis_time = redis.call('TIME')
local now = tonumber(redis_time[1]) * 1000 +
  math.floor(tonumber(redis_time[2]) / 1000)
local pending_raw = redis.call('HGET', KEYS[3], ARGV[3])

local has_claim = ARGV[12] ~= '' or ARGV[13] ~= ''
if has_claim then
  if ARGV[12] == '' or ARGV[13] == '' then
    return 0
  end
  if redis.call('HGET', KEYS[7], ARGV[3]) ~= ARGV[12] then
    return 0
  end
  local processing_score = tonumber(redis.call('ZSCORE', KEYS[6], ARGV[3]) or '')
  if not processing_score or processing_score <= now then
    return 0
  end
  if not pending_raw then
    return 0
  end
  local pending_ok, pending = pcall(cjson.decode, pending_raw)
  if not pending_ok or type(pending) ~= 'table' then
    return 0
  end
  if tostring(pending.pending_retry_version or '') ~= ARGV[13] then
    return 0
  end
end

local existing = {}
local existing_raw = redis.call('GET', KEYS[1])
if existing_raw then
  local ok, decoded = pcall(cjson.decode, existing_raw)
  if ok and type(decoded) == 'table' then
    existing = decoded
  end
end

local function normalize_patch(value)
  local patch = {
    is_sent = false,
    is_delivered = false,
    is_seen = false
  }
  if type(value) == 'table' then
    patch.is_sent = value.is_sent == true
    patch.is_delivered = value.is_delivered == true
    patch.is_seen = value.is_seen == true
  end
  if patch.is_seen == true then
    patch.is_delivered = true
    patch.is_sent = true
  elseif patch.is_delivered == true then
    patch.is_sent = true
  end
  return patch
end

local function outcome_rank(patch, failed, ambiguous)
  if patch.is_seen == true then return 5 end
  if patch.is_delivered == true then return 4 end
  if failed == true and ambiguous ~= true then return 3 end
  if patch.is_sent == true then return 2 end
  if failed == true and ambiguous == true then return 1 end
  return 0
end

local existing_patch = normalize_patch(existing.patch)
local existing_failed = existing.failed == true
local existing_ambiguous =
  existing.failure_kind == 'ambiguous' or existing.ambiguous == true

local incoming_patch = normalize_patch({
  is_sent = ARGV[8] == '1',
  is_delivered = ARGV[9] == '1',
  is_seen = ARGV[10] == '1'
})
local incoming_failed = ARGV[11] == '1'
local incoming_ambiguous = ARGV[14] == '1'

local existing_rank = outcome_rank(
  existing_patch,
  existing_failed,
  existing_ambiguous
)
local incoming_rank = outcome_rank(
  incoming_patch,
  incoming_failed,
  incoming_ambiguous
)
local selected_rank = math.max(existing_rank, incoming_rank)

local patch = {
  is_sent = selected_rank == 2 or selected_rank == 4 or selected_rank == 5,
  is_delivered = selected_rank == 4 or selected_rank == 5,
  is_seen = selected_rank == 5
}
local failed = selected_rank == 1 or selected_rank == 3
local failure_kind = cjson.null
if selected_rank == 1 then
  failure_kind = 'ambiguous'
elseif selected_rank == 3 then
  failure_kind = 'failed'
end

local internal_message_id = ARGV[7]
if type(existing.internal_message_id) == 'string' and existing.internal_message_id ~= '' then
  internal_message_id = existing.internal_message_id
end

local entry = {
  account_id = ARGV[4],
  worker_id = ARGV[5],
  message_id = ARGV[6],
  internal_message_id = internal_message_id,
  patch = patch,
  failed = failed,
  failure_kind = failure_kind,
  applied_at = now
}
redis.call('SETEX', KEYS[1], tonumber(ARGV[1]), cjson.encode(entry))
redis.call('SETEX', KEYS[2], tonumber(ARGV[2]), internal_message_id)

if not pending_raw then
  redis.call('ZREM', KEYS[4], ARGV[3])
  redis.call('ZREM', KEYS[5], ARGV[3])
  redis.call('ZREM', KEYS[6], ARGV[3])
  redis.call('HDEL', KEYS[7], ARGV[3])
  return 1
end

local pending_ok, pending = pcall(cjson.decode, pending_raw)
if not pending_ok or type(pending) ~= 'table' then
  return 1
end

local should_clear = false
if has_claim then
  should_clear = true
else
  local pending_patch = normalize_patch(pending.patch)
  local pending_rank = outcome_rank(
    pending_patch,
    pending.failed == true,
    pending.ambiguous == true
  )
  should_clear = selected_rank >= pending_rank
end

if should_clear then
  redis.call('HDEL', KEYS[3], ARGV[3])
  redis.call('ZREM', KEYS[4], ARGV[3])
  redis.call('ZREM', KEYS[5], ARGV[3])
  redis.call('ZREM', KEYS[6], ARGV[3])
  redis.call('HDEL', KEYS[7], ARGV[3])
end
return 1
`;

@injectable()
export class MessageStatusPendingService {
  private readonly pendingSetKey = 'message-status:update:pending:v2:retry';
  private readonly pendingPayloadHashKey =
    'message-status:update:pending:v2:payloads';
  private readonly pendingParkingSetKey =
    'message-status:update:pending:v2:parking';
  private readonly pendingProcessingSetKey =
    'message-status:update:pending:v2:processing';
  private readonly pendingClaimHashKey =
    'message-status:update:pending:v2:claims';
  private readonly legacyPendingKeys = [
    'message-status:update:pending:retry',
    'message-status:update:pending:payloads',
    'message-status:update:pending:parking',
    'message-status:update:pending:processing',
    'message-status:update:pending:claims:v2',
  ] as const;
  private readonly aliasPrefix = 'message-status:update:alias:';
  private readonly appliedPrefix = 'message-status:update:applied:';
  private readonly aliasTtlSeconds = 60 * 60 * 24 * 30;
  private readonly appliedTtlSeconds = 60 * 60 * 24 * 30;
  private readonly processingTimeoutMs = 5 * 60_000;
  private readonly processingHeartbeatIntervalMs = Math.max(
    1_000,
    Math.floor(this.processingTimeoutMs / 3)
  );
  private readonly pendingRetryBatchSize = 100;
  private readonly pendingSweepCandidateLimit = this.pendingRetryBatchSize * 4;
  private readonly pendingSweepPagesPerRun = 1;
  private readonly pendingSweepCursors = new Map<string, string>();
  private readonly pendingRetryDelaysMs = [
    2_000, 5_000, 10_000, 20_000, 30_000, 60_000, 120_000, 300_000,
  ];

  constructor(@inject('Redis') private readonly redis: Redis) {}

  static statusKey(
    accountId: string,
    messageId: string,
    workerId?: string
  ): string {
    const normalizedWorkerId = workerId?.trim();
    const normalizedMessageId =
      canonicalMessageStatusMessageId(messageId) ?? messageId.trim();
    return normalizedWorkerId
      ? `${accountId}:${normalizedWorkerId}:${normalizedMessageId}`
      : `${accountId}:${normalizedMessageId}`;
  }

  getStatusKafkaKey(
    data: Pick<IMessageStatusUpdate, 'account_id' | 'worker_id' | 'message_id'>
  ): string {
    return MessageStatusPendingService.statusKey(
      data.account_id,
      data.message_id,
      data.worker_id
    );
  }

  private aliasKey(
    accountId: string,
    whatsAppMessageId: string,
    workerId?: string
  ): string {
    return `${this.aliasPrefix}${MessageStatusPendingService.statusKey(
      accountId,
      whatsAppMessageId,
      workerId
    )}`;
  }

  private appliedKey(
    accountId: string,
    whatsAppMessageId: string,
    workerId?: string
  ): string {
    return `${this.appliedPrefix}${MessageStatusPendingService.statusKey(
      accountId,
      whatsAppMessageId,
      workerId
    )}`;
  }

  async getInternalMessageIdAlias(
    accountId: string,
    whatsAppMessageId: string,
    workerId?: string
  ): Promise<string | null> {
    if (!accountId || !whatsAppMessageId) {
      return null;
    }

    const value = await this.redis.get(
      this.aliasKey(accountId, whatsAppMessageId, workerId)
    );
    return value?.trim() || null;
  }

  async setInternalMessageIdAlias(
    accountId: string,
    whatsAppMessageId: string,
    internalMessageId: string,
    workerId?: string
  ): Promise<void> {
    if (!accountId || !whatsAppMessageId || !internalMessageId) {
      return;
    }

    await this.redis.setex(
      this.aliasKey(accountId, whatsAppMessageId, workerId),
      this.aliasTtlSeconds,
      internalMessageId
    );
  }

  normalizePatch(patch: MessageSummaryPatch): MessageSummaryPatch {
    const hasSeen = patch.is_seen === true;
    const hasDelivered = patch.is_delivered === true || hasSeen;
    const hasSent = patch.is_sent === true || hasDelivered;

    const normalized: MessageSummaryPatch = {};
    if (hasSent) normalized.is_sent = true;
    if (hasDelivered) normalized.is_delivered = true;
    if (hasSeen) normalized.is_seen = true;

    return normalized;
  }

  mergePatches(patches: MessageSummaryPatch[]): MessageSummaryPatch {
    const merged: MessageSummaryPatch = {};

    for (const patch of patches) {
      const normalized = this.normalizePatch(patch);
      if (normalized.is_seen) {
        merged.is_seen = true;
        merged.is_delivered = true;
        merged.is_sent = true;
        continue;
      }

      if (normalized.is_delivered) {
        merged.is_delivered = true;
        merged.is_sent = true;
      }

      if (normalized.is_sent) {
        merged.is_sent = true;
      }
    }

    return this.normalizePatch(merged);
  }

  private getRetryCount(data: IMessageStatusUpdate): number {
    const retryCount = data.retry_count ?? 0;
    if (!Number.isFinite(retryCount)) {
      return 0;
    }

    return Math.max(0, Math.floor(retryCount));
  }

  private getFirstSeenAt(data: IMessageStatusUpdate): number {
    const firstSeenAt = data.first_seen_at ?? Date.now();
    if (!Number.isFinite(firstSeenAt)) {
      return Date.now();
    }

    return firstSeenAt;
  }

  private parsePayload(raw: string | null): IMessageStatusUpdate | null {
    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw) as IMessageStatusUpdate;
    } catch {
      return null;
    }
  }

  private parseAppliedLedger(
    raw: string | null
  ): AppliedStatusLedgerEntry | null {
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as AppliedStatusLedgerEntry;
      if (!parsed?.account_id || !parsed.message_id || !parsed.patch) {
        return null;
      }

      return parsed;
    } catch {
      return null;
    }
  }

  private retryDelayMs(retryCount: number): number {
    return (
      this.pendingRetryDelaysMs[
        Math.min(retryCount, this.pendingRetryDelaysMs.length - 1)
      ] ?? 300_000
    );
  }

  private mergeStatusOutcome(
    existing: IMessageStatusUpdate | null,
    incoming: IMessageStatusUpdate,
    incomingPatch: MessageSummaryPatch
  ): Pick<
    IMessageStatusUpdate,
    | 'patch'
    | 'failed'
    | 'ambiguous'
    | 'provider_error_code'
    | 'provider_status_at'
  > {
    const normalizedIncoming: IMessageStatusUpdate = {
      ...incoming,
      patch: this.normalizePatch(incomingPatch),
    };
    const outcome = selectStrongestMessageDeliveryOutcome(
      existing ?? { patch: {} },
      normalizedIncoming
    );
    const fact = messageDeliveryFactFromOutcome(outcome);
    const existingRank = existing
      ? messageDeliveryOutcomeRank(resolveMessageDeliveryOutcome(existing))
      : -1;
    const incomingRank = messageDeliveryOutcomeRank(
      resolveMessageDeliveryOutcome(normalizedIncoming)
    );
    const metadataSource =
      incomingRank >= existingRank ? normalizedIncoming : existing;

    return {
      patch: fact.patch,
      failed: fact.failed,
      ambiguous: fact.ambiguous,
      provider_error_code:
        outcome === 'failed' ? metadataSource?.provider_error_code : undefined,
      provider_status_at: metadataSource?.provider_status_at,
    };
  }

  private async storePendingStatusUpdate(
    data: IMessageStatusUpdate,
    patch: MessageSummaryPatch,
    context: { batchSize: number; duration: number },
    options: StorePendingStatusOptions = {}
  ): Promise<void> {
    void context;
    if (await this.isApplied({ ...data, patch })) {
      await this.clearPendingStatusIfCovered(data);
      return;
    }

    const member = this.getStatusKafkaKey(data);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const existingRaw =
        (await this.redis.hget(this.pendingPayloadHashKey, member)) ?? '';
      const existingPayload = this.parsePayload(existingRaw);
      const resetRetryState = options.resetRetryState === true;
      const mergeableExisting =
        existingPayload && this.sameRetryOwnership(existingPayload, data)
          ? existingPayload
          : null;
      const retryCount = resetRetryState
        ? options.forceParking === true
          ? this.getRetryCount(data)
          : 0
        : Math.max(
            this.getRetryCount(data),
            mergeableExisting ? this.getRetryCount(mergeableExisting) : 0
          );
      const nextRetryCount =
        options.incrementRetry === false ? retryCount : retryCount + 1;
      const mergedOutcome = this.mergeStatusOutcome(
        mergeableExisting,
        data,
        patch
      );
      const retryPayload = this.withFreshPendingVersion({
        ...(mergeableExisting ?? data),
        ...this.withoutPendingClaim(data),
        ...mergedOutcome,
        retry_count: nextRetryCount,
        first_seen_at: resetRetryState
          ? this.getFirstSeenAt(data)
          : Math.min(
              this.getFirstSeenAt(mergeableExisting ?? data),
              this.getFirstSeenAt(data)
            ),
      });
      const parked =
        options.forceParking === true ||
        (retryPayload.retry_count ?? 0) > this.pendingRetryDelaysMs.length;
      if (parked) {
        retryPayload.parked_at = resetRetryState
          ? (data.parked_at ?? Date.now())
          : (mergeableExisting?.parked_at ?? data.parked_at ?? Date.now());
      } else {
        delete retryPayload.parked_at;
      }
      const retryDelayMs = parked ? 0 : this.retryDelayMs(retryCount);
      const stored = await this.redis.eval(
        STORE_PENDING_CAS_SCRIPT,
        5,
        this.pendingPayloadHashKey,
        this.pendingSetKey,
        this.pendingParkingSetKey,
        this.pendingProcessingSetKey,
        this.pendingClaimHashKey,
        member,
        existingRaw,
        JSON.stringify(retryPayload),
        String(retryDelayMs),
        parked ? '1' : '0'
      );
      if (Number(stored) === 1) {
        return;
      }
    }

    throw new Error('message_status_pending_cas_contention');
  }

  async deferMissingStatusUpdate(
    data: IMessageStatusUpdate,
    patch: MessageSummaryPatch,
    context: { batchSize: number; duration: number }
  ): Promise<void> {
    await this.storePendingStatusUpdate(data, patch, context, {
      incrementRetry: true,
      resetRetryState: true,
    });
  }

  async reschedulePendingStatus(
    data: IMessageStatusUpdate,
    context: { batchSize: number; duration: number },
    options?: { incrementRetry?: boolean }
  ): Promise<void> {
    if (data.pending_claim_token && data.pending_retry_version) {
      const transitioned = await this.transitionClaimedPendingStatus(
        data,
        false,
        options?.incrementRetry !== false
      );
      if (!transitioned) {
        throw new MessageStatusPendingClaimLeaseLostError();
      }
      return;
    }

    await this.storePendingStatusUpdate(data, data.patch, context, {
      incrementRetry: options?.incrementRetry !== false,
      resetRetryState: true,
    });
  }

  async parkPendingStatus(data: IMessageStatusUpdate): Promise<void> {
    if (data.pending_claim_token && data.pending_retry_version) {
      const transitioned = await this.transitionClaimedPendingStatus(
        data,
        true
      );
      if (!transitioned) {
        throw new MessageStatusPendingClaimLeaseLostError();
      }
      return;
    }

    await this.storePendingStatusUpdate(
      { ...data, retry_count: this.pendingRetryDelaysMs.length + 1 },
      data.patch,
      { batchSize: 1, duration: 0 },
      {
        incrementRetry: false,
        resetRetryState: true,
        forceParking: true,
      }
    );
  }

  async claimDuePendingStatuses(options?: {
    ownerId?: string;
    decideClaim?: (data: IMessageStatusUpdate) => PendingStatusClaimDecision;
  }): Promise<IMessageStatusUpdate[]> {
    const now = await this.redisTimeMilliseconds();
    const expiredProcessingMembers = await this.scanPendingSortedSet(
      this.pendingProcessingSetKey,
      (score) => score <= now
    );
    const recoveredMembers = await this.sweepExpiredProcessingStatuses(
      expiredProcessingMembers,
      options?.decideClaim
    );
    const parkedMembers = await this.scanPendingSortedSet(
      this.pendingParkingSetKey
    );
    await this.sweepParkedStatuses(parkedMembers, options?.decideClaim);
    const dueMembers = new Set([
      ...(await this.scanPendingSortedSet(
        this.pendingSetKey,
        (score) => score <= now
      )),
      ...recoveredMembers,
    ]);
    const duePayloads = await this.loadPendingPayloads(Array.from(dueMembers));

    const claimed: IMessageStatusUpdate[] = [];
    const ownerId = options?.ownerId?.trim() || randomUUID();

    for (const member of dueMembers) {
      if (claimed.length >= this.pendingRetryBatchSize) {
        break;
      }
      const { rawPayload, payload } = duePayloads.get(member) ?? {
        rawPayload: null,
        payload: null,
      };
      if (!payload || !rawPayload || !payload.pending_retry_version) {
        await this.deletePendingMemberCas(member, rawPayload ?? '');
        continue;
      }

      const decision = options?.decideClaim?.(payload) ?? 'claim';
      if (decision === 'ignore') {
        continue;
      }
      if (decision === 'discard') {
        await this.deletePendingMemberCas(member, rawPayload);
        continue;
      }

      const claimToken = randomUUID();
      const claimValue = JSON.stringify({
        owner_id: ownerId,
        token: claimToken,
      });
      const didClaim = await this.redis.eval(
        CLAIM_PENDING_CAS_SCRIPT,
        5,
        this.pendingPayloadHashKey,
        this.pendingSetKey,
        this.pendingParkingSetKey,
        this.pendingProcessingSetKey,
        this.pendingClaimHashKey,
        member,
        rawPayload,
        claimValue,
        String(this.processingTimeoutMs)
      );
      if (Number(didClaim) !== 1) {
        continue;
      }

      claimed.push({
        ...payload,
        pending_claim_token: claimValue,
        pending_claim_owner: ownerId,
      });
    }

    return claimed;
  }

  async discardLegacyPendingStatuses(): Promise<number> {
    return Number(await this.redis.del(...this.legacyPendingKeys));
  }

  async withClaimHeartbeat<T>(
    data: IMessageStatusUpdate,
    callback: (assertClaimActive: () => Promise<void>) => Promise<T>
  ): Promise<T> {
    let leaseError: MessageStatusPendingClaimLeaseLostError | null = null;
    let heartbeatRunning = false;

    const assertClaimActive = async (): Promise<void> => {
      if (leaseError) {
        throw leaseError;
      }

      const extended = await this.extendClaimedPendingStatusLease(data);
      if (!extended) {
        leaseError = new MessageStatusPendingClaimLeaseLostError();
        throw leaseError;
      }
    };

    await assertClaimActive();
    const heartbeat = setInterval(() => {
      if (heartbeatRunning || leaseError) {
        return;
      }

      heartbeatRunning = true;
      void assertClaimActive()
        .catch((error) => {
          leaseError =
            error instanceof MessageStatusPendingClaimLeaseLostError
              ? error
              : new MessageStatusPendingClaimLeaseLostError();
        })
        .finally(() => {
          heartbeatRunning = false;
        });
    }, this.processingHeartbeatIntervalMs);
    heartbeat.unref?.();

    try {
      return await callback(assertClaimActive);
    } finally {
      clearInterval(heartbeat);
    }
  }

  private async scanPendingSortedSet(
    key: string,
    isEligible: (score: number) => boolean = () => true
  ): Promise<string[]> {
    let cursor = this.pendingSweepCursors.get(key) ?? '0';
    const members = new Set<string>();

    for (let page = 0; page < this.pendingSweepPagesPerRun; page += 1) {
      const [nextCursor, entries] = await this.redis.zscan(
        key,
        cursor,
        'COUNT',
        this.pendingSweepCandidateLimit
      );
      cursor = nextCursor;

      for (let index = 0; index < entries.length; index += 2) {
        const member = entries[index];
        const score = Number(entries[index + 1]);
        if (member && Number.isFinite(score) && isEligible(score)) {
          members.add(member);
        }
      }

      if (cursor === '0') {
        break;
      }
    }

    this.pendingSweepCursors.set(key, cursor);
    return Array.from(members);
  }

  private async loadPendingPayloads(members: string[]): Promise<
    Map<
      string,
      {
        rawPayload: string | null;
        payload: IMessageStatusUpdate | null;
      }
    >
  > {
    const payloads = new Map<
      string,
      {
        rawPayload: string | null;
        payload: IMessageStatusUpdate | null;
      }
    >();
    if (members.length === 0) {
      return payloads;
    }

    const rawPayloads = await this.redis.hmget(
      this.pendingPayloadHashKey,
      ...members
    );
    members.forEach((member, index) => {
      const rawPayload = rawPayloads[index] ?? null;
      payloads.set(member, {
        rawPayload,
        payload: this.parsePayload(rawPayload),
      });
    });

    return payloads;
  }

  private async sweepExpiredProcessingStatuses(
    members: string[],
    decideClaim?: (data: IMessageStatusUpdate) => PendingStatusClaimDecision
  ): Promise<string[]> {
    const recovered: string[] = [];
    const payloads = await this.loadPendingPayloads(members);

    for (const member of members) {
      const { rawPayload, payload } = payloads.get(member) ?? {
        rawPayload: null,
        payload: null,
      };
      if (!rawPayload || !payload || !payload.pending_retry_version) {
        await this.deletePendingMemberCas(member, rawPayload ?? '');
        continue;
      }

      const decision = decideClaim?.(payload) ?? 'claim';
      if (decision === 'ignore') {
        continue;
      }
      if (decision === 'discard') {
        await this.deletePendingMemberCas(member, rawPayload);
        continue;
      }

      const didRecover = await this.redis.eval(
        RECOVER_EXPIRED_PENDING_CAS_SCRIPT,
        5,
        this.pendingProcessingSetKey,
        this.pendingSetKey,
        this.pendingParkingSetKey,
        this.pendingClaimHashKey,
        this.pendingPayloadHashKey,
        member,
        rawPayload
      );
      if (Number(didRecover) === 1) {
        recovered.push(member);
      }
    }

    return recovered;
  }

  private async sweepParkedStatuses(
    members: string[],
    decideClaim?: (data: IMessageStatusUpdate) => PendingStatusClaimDecision
  ): Promise<void> {
    const payloads = await this.loadPendingPayloads(members);

    for (const member of members) {
      const { rawPayload, payload } = payloads.get(member) ?? {
        rawPayload: null,
        payload: null,
      };
      if (!rawPayload || !payload || !payload.pending_retry_version) {
        await this.deletePendingMemberCas(member, rawPayload ?? '');
        continue;
      }

      if ((decideClaim?.(payload) ?? 'claim') === 'discard') {
        await this.deletePendingMemberCas(member, rawPayload);
      }
    }
  }

  async wakePendingStatus(
    accountId: string,
    whatsAppMessageId: string,
    workerId?: string
  ): Promise<boolean> {
    const member = MessageStatusPendingService.statusKey(
      accountId,
      whatsAppMessageId,
      workerId
    );
    const rawPayload = await this.redis.hget(
      this.pendingPayloadHashKey,
      member
    );
    const payload = this.parsePayload(rawPayload);
    if (!payload) {
      await this.clearPendingMember(member);
      return false;
    }
    const isParked =
      payload.parked_at !== undefined ||
      (await this.redis.zscore(this.pendingParkingSetKey, member)) !== null;
    const wakePayload = this.withFreshPendingVersion({
      ...this.withoutPendingClaim(payload),
      ...(isParked ? { retry_count: 0 } : {}),
    });
    delete wakePayload.parked_at;
    const awakened = await this.redis.eval(
      STORE_PENDING_CAS_SCRIPT,
      5,
      this.pendingPayloadHashKey,
      this.pendingSetKey,
      this.pendingParkingSetKey,
      this.pendingProcessingSetKey,
      this.pendingClaimHashKey,
      member,
      rawPayload ?? '',
      JSON.stringify(wakePayload),
      '0',
      '0'
    );

    return Number(awakened) === 1;
  }

  async publishPendingStatus(
    accountId: string,
    whatsAppMessageId: string,
    workerId?: string
  ): Promise<void> {
    await this.wakePendingStatus(accountId, whatsAppMessageId, workerId);
  }

  async clearPendingStatus(
    accountId: string,
    whatsAppMessageId: string,
    workerId?: string
  ): Promise<void> {
    const member = MessageStatusPendingService.statusKey(
      accountId,
      whatsAppMessageId,
      workerId
    );
    const raw =
      (await this.redis.hget(this.pendingPayloadHashKey, member)) ?? '';
    await this.deletePendingMemberCas(member, raw);
  }

  private async clearPendingMember(member: string): Promise<void> {
    const raw =
      (await this.redis.hget(this.pendingPayloadHashKey, member)) ?? '';
    await this.deletePendingMemberCas(member, raw);
  }

  async clearPendingStatusIfCovered(
    data: IMessageStatusUpdate
  ): Promise<boolean> {
    const member = this.getStatusKafkaKey(data);
    const raw = await this.redis.hget(this.pendingPayloadHashKey, member);
    if (!raw) {
      await this.deletePendingMemberCas(member, '');
      return true;
    }

    const pending = this.parsePayload(raw);
    if (!pending || !(await this.isApplied(pending))) {
      return false;
    }

    return this.deletePendingMemberCas(member, raw);
  }

  async discardClaimedPendingStatus(
    data: IMessageStatusUpdate
  ): Promise<boolean> {
    const member = this.getStatusKafkaKey(data);
    const raw = await this.redis.hget(this.pendingPayloadHashKey, member);
    if (!raw || !data.pending_claim_token || !data.pending_retry_version) {
      return false;
    }
    const current = this.parsePayload(raw);
    if (current?.pending_retry_version !== data.pending_retry_version) {
      return false;
    }

    return this.deletePendingMemberCas(member, raw, data.pending_claim_token);
  }

  async discardPendingStatusForEvent(
    data: IMessageStatusUpdate
  ): Promise<boolean> {
    if (data.pending_claim_token) {
      return this.discardClaimedPendingStatus(data);
    }

    const member = this.getStatusKafkaKey(data);
    const raw = await this.redis.hget(this.pendingPayloadHashKey, member);
    const current = this.parsePayload(raw);
    if (!raw || !current || !this.sameRetryOwnership(current, data)) {
      return false;
    }

    return this.deletePendingMemberCas(member, raw);
  }

  private async transitionClaimedPendingStatus(
    data: IMessageStatusUpdate,
    forceParking: boolean,
    incrementRetry = true
  ): Promise<boolean> {
    const member = this.getStatusKafkaKey(data);
    const raw = await this.redis.hget(this.pendingPayloadHashKey, member);
    const current = this.parsePayload(raw);
    if (
      !raw ||
      !current ||
      !data.pending_claim_token ||
      !data.pending_retry_version ||
      current.pending_retry_version !== data.pending_retry_version
    ) {
      return false;
    }

    const retryCount = Math.max(
      this.getRetryCount(current),
      this.getRetryCount(data)
    );
    const nextRetryCount = incrementRetry ? retryCount + 1 : retryCount;
    const mergedOutcome = this.mergeStatusOutcome(current, data, data.patch);
    const next = this.withFreshPendingVersion({
      ...current,
      ...this.withoutPendingClaim(data),
      ...mergedOutcome,
      retry_count: nextRetryCount,
      first_seen_at: Math.min(
        this.getFirstSeenAt(current),
        this.getFirstSeenAt(data)
      ),
    });
    const parked =
      forceParking || nextRetryCount > this.pendingRetryDelaysMs.length;
    if (parked) {
      next.parked_at = current.parked_at ?? data.parked_at ?? Date.now();
    } else {
      delete next.parked_at;
    }

    const transitioned = await this.redis.eval(
      TRANSITION_CLAIMED_PENDING_CAS_SCRIPT,
      5,
      this.pendingPayloadHashKey,
      this.pendingSetKey,
      this.pendingParkingSetKey,
      this.pendingProcessingSetKey,
      this.pendingClaimHashKey,
      member,
      raw,
      data.pending_claim_token,
      JSON.stringify(next),
      String(parked ? 0 : this.retryDelayMs(retryCount)),
      parked ? '1' : '0'
    );
    return Number(transitioned) === 1;
  }

  private async extendClaimedPendingStatusLease(
    data: IMessageStatusUpdate
  ): Promise<boolean> {
    const claim = this.parsePendingClaimIdentity(data);
    const pendingRetryVersion = data.pending_retry_version?.trim();
    if (!claim || !pendingRetryVersion) {
      return false;
    }

    const member = this.getStatusKafkaKey(data);
    const extended = await this.redis.eval(
      EXTEND_PENDING_CLAIM_LEASE_SCRIPT,
      3,
      this.pendingPayloadHashKey,
      this.pendingClaimHashKey,
      this.pendingProcessingSetKey,
      member,
      pendingRetryVersion,
      claim.ownerId,
      claim.token,
      String(this.processingTimeoutMs)
    );

    return Number(extended) === 1;
  }

  private async redisTimeMilliseconds(): Promise<number> {
    const [secondsRaw, microsecondsRaw] = await this.redis.time();
    const seconds = Number(secondsRaw);
    const microseconds = Number(microsecondsRaw);
    if (
      !Number.isSafeInteger(seconds) ||
      seconds <= 0 ||
      !Number.isSafeInteger(microseconds) ||
      microseconds < 0
    ) {
      throw new Error('redis_time_unavailable');
    }

    return seconds * 1000 + Math.floor(microseconds / 1000);
  }

  private parsePendingClaimIdentity(
    data: IMessageStatusUpdate
  ): PendingStatusClaimIdentity | null {
    const rawClaim = data.pending_claim_token?.trim();
    const expectedOwner = data.pending_claim_owner?.trim();
    if (!rawClaim || !expectedOwner) {
      return null;
    }

    try {
      const parsed = JSON.parse(rawClaim) as {
        owner_id?: unknown;
        token?: unknown;
      };
      const ownerId =
        typeof parsed.owner_id === 'string' ? parsed.owner_id.trim() : '';
      const token = typeof parsed.token === 'string' ? parsed.token.trim() : '';
      if (!ownerId || ownerId !== expectedOwner || !token) {
        return null;
      }

      return { ownerId, token };
    } catch {
      return null;
    }
  }

  private async deletePendingMemberCas(
    member: string,
    expectedRaw: string,
    claimToken = ''
  ): Promise<boolean> {
    const deleted = await this.redis.eval(
      DELETE_PENDING_CAS_SCRIPT,
      5,
      this.pendingPayloadHashKey,
      this.pendingSetKey,
      this.pendingParkingSetKey,
      this.pendingProcessingSetKey,
      this.pendingClaimHashKey,
      member,
      expectedRaw,
      claimToken
    );
    return Number(deleted) === 1;
  }

  private withFreshPendingVersion(
    data: IMessageStatusUpdate
  ): IMessageStatusUpdate {
    return {
      ...this.withoutPendingClaim(data),
      pending_retry_version: randomUUID(),
    };
  }

  private withoutPendingClaim(
    data: IMessageStatusUpdate
  ): IMessageStatusUpdate {
    const payload = { ...data };
    delete payload.pending_claim_token;
    delete payload.pending_claim_owner;
    return payload;
  }

  private sameRetryOwnership(
    current: IMessageStatusUpdate,
    expected: IMessageStatusUpdate
  ): boolean {
    return (
      current.consumer_assignment_owner ===
        expected.consumer_assignment_owner &&
      current.consumer_assignment_epoch ===
        expected.consumer_assignment_epoch &&
      current.consumer_partition === expected.consumer_partition &&
      (current.worker_id?.trim() ?? '') ===
        (expected.worker_id?.trim() ?? '') &&
      String(current.runtime_generation ?? '') ===
        String(expected.runtime_generation ?? '') &&
      (current.connection_epoch?.trim() ?? '') ===
        (expected.connection_epoch?.trim() ?? '') &&
      (current.source_provider?.trim() ?? '') ===
        (expected.source_provider?.trim() ?? '')
    );
  }

  async markApplied(
    data: IMessageStatusUpdate,
    internalMessageId: string
  ): Promise<boolean> {
    if (!data.account_id || !data.message_id || !internalMessageId) {
      return false;
    }

    const normalizedPatch = this.normalizePatch(data.patch);
    const member = this.getStatusKafkaKey(data);
    const marked = await this.redis.eval(
      MARK_APPLIED_SCRIPT,
      7,
      this.appliedKey(data.account_id, data.message_id, data.worker_id),
      this.aliasKey(data.account_id, data.message_id, data.worker_id),
      this.pendingPayloadHashKey,
      this.pendingSetKey,
      this.pendingParkingSetKey,
      this.pendingProcessingSetKey,
      this.pendingClaimHashKey,
      String(this.appliedTtlSeconds),
      String(this.aliasTtlSeconds),
      member,
      data.account_id,
      data.worker_id?.trim() ?? '',
      data.message_id,
      internalMessageId,
      normalizedPatch.is_sent === true ? '1' : '0',
      normalizedPatch.is_delivered === true ? '1' : '0',
      normalizedPatch.is_seen === true ? '1' : '0',
      data.failed === true ? '1' : '0',
      data.pending_claim_token ?? '',
      data.pending_retry_version ?? '',
      data.ambiguous === true ? '1' : '0'
    );
    const didMark = Number(marked) === 1;
    if (!didMark && data.pending_claim_token) {
      throw new MessageStatusPendingClaimLeaseLostError();
    }
    return didMark;
  }

  async isApplied(data: IMessageStatusUpdate): Promise<boolean> {
    if (!data.account_id || !data.message_id) {
      return false;
    }

    const entry = this.parseAppliedLedger(
      await this.redis.get(
        this.appliedKey(data.account_id, data.message_id, data.worker_id)
      )
    );

    if (!entry) {
      return false;
    }

    const appliedOutcome = resolveMessageDeliveryOutcome({
      patch: entry.patch,
      failed: entry.failed,
      ambiguous: entry.failure_kind === 'ambiguous',
    });
    const requestedOutcome = resolveMessageDeliveryOutcome(data);
    return (
      messageDeliveryOutcomeRank(appliedOutcome) >=
      messageDeliveryOutcomeRank(requestedOutcome)
    );
  }
}
