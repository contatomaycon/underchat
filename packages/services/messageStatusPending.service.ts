import { injectable, inject } from 'tsyringe';
import Redis from 'ioredis';
import { IMessageStatusUpdate } from '@core/common/interfaces/IMessageStatusUpdate';
import type { MessageSummaryPatch } from './messageStatus.service';
import { logger } from '@core/plugins/telemetry/logger';
import { incrementCounter } from '@core/plugins/telemetry/observability';

interface AppliedStatusLedgerEntry {
  account_id: string;
  message_id: string;
  internal_message_id: string;
  patch: MessageSummaryPatch;
  applied_at: number;
}

@injectable()
export class MessageStatusPendingService {
  private readonly pendingSetKey = 'message-status:update:pending:retry';
  private readonly pendingPayloadHashKey =
    'message-status:update:pending:payloads';
  private readonly pendingParkingSetKey =
    'message-status:update:pending:parking';
  private readonly pendingProcessingSetKey =
    'message-status:update:pending:processing';
  private readonly aliasPrefix = 'message-status:update:alias:';
  private readonly appliedPrefix = 'message-status:update:applied:';
  private readonly aliasTtlSeconds = 60 * 60 * 24 * 30;
  private readonly appliedTtlSeconds = 60 * 60 * 24 * 30;
  private readonly processingTimeoutMs = 5 * 60_000;
  private readonly pendingRetryBatchSize = 100;
  private readonly pendingRetryDelaysMs = [
    2_000, 5_000, 10_000, 20_000, 30_000, 60_000, 120_000, 300_000,
  ];

  constructor(@inject('Redis') private readonly redis: Redis) {}

  static statusKey(accountId: string, messageId: string): string {
    return `${accountId}:${messageId}`;
  }

  getStatusKafkaKey(
    data: Pick<IMessageStatusUpdate, 'account_id' | 'message_id'>
  ): string {
    return MessageStatusPendingService.statusKey(
      data.account_id,
      data.message_id
    );
  }

  private aliasKey(accountId: string, whatsAppMessageId: string): string {
    return `${this.aliasPrefix}${MessageStatusPendingService.statusKey(
      accountId,
      whatsAppMessageId
    )}`;
  }

  private appliedKey(accountId: string, whatsAppMessageId: string): string {
    return `${this.appliedPrefix}${MessageStatusPendingService.statusKey(
      accountId,
      whatsAppMessageId
    )}`;
  }

  async getInternalMessageIdAlias(
    accountId: string,
    whatsAppMessageId: string
  ): Promise<string | null> {
    if (!accountId || !whatsAppMessageId) {
      return null;
    }

    const value = await this.redis.get(
      this.aliasKey(accountId, whatsAppMessageId)
    );
    return value?.trim() || null;
  }

  async setInternalMessageIdAlias(
    accountId: string,
    whatsAppMessageId: string,
    internalMessageId: string
  ): Promise<void> {
    if (!accountId || !whatsAppMessageId || !internalMessageId) {
      return;
    }

    await this.redis.setex(
      this.aliasKey(accountId, whatsAppMessageId),
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

  private patchCovers(
    appliedPatch: MessageSummaryPatch,
    requestedPatch: MessageSummaryPatch
  ): boolean {
    const applied = this.normalizePatch(appliedPatch);
    const requested = this.normalizePatch(requestedPatch);

    if (requested.is_seen && !applied.is_seen) return false;
    if (requested.is_delivered && !applied.is_delivered) return false;
    if (requested.is_sent && !applied.is_sent) return false;

    return true;
  }

  private async storePendingStatusUpdate(
    data: IMessageStatusUpdate,
    patch: MessageSummaryPatch,
    context: { batchSize: number; duration: number },
    options?: { incrementRetry?: boolean }
  ): Promise<void> {
    if (await this.isApplied({ ...data, patch })) {
      await this.clearPendingStatus(data.account_id, data.message_id);
      return;
    }

    const member = this.getStatusKafkaKey(data);
    const existingPayload = this.parsePayload(
      await this.redis.hget(this.pendingPayloadHashKey, member)
    );

    const retryCount = Math.max(
      this.getRetryCount(data),
      existingPayload ? this.getRetryCount(existingPayload) : 0
    );
    const nextRetryCount =
      options?.incrementRetry === false ? retryCount : retryCount + 1;
    const retryPayload: IMessageStatusUpdate = {
      ...(existingPayload ?? data),
      ...data,
      patch: this.mergePatches([existingPayload?.patch ?? {}, patch]),
      retry_count: nextRetryCount,
      first_seen_at: Math.min(
        this.getFirstSeenAt(existingPayload ?? data),
        this.getFirstSeenAt(data)
      ),
    };

    await this.redis.hset(
      this.pendingPayloadHashKey,
      member,
      JSON.stringify(retryPayload)
    );

    const logPayload = {
      account_id: data.account_id,
      message_id: data.message_id,
      retry_count: retryPayload.retry_count,
      batch_size: context.batchSize,
      duration: context.duration,
    };

    if ((retryPayload.retry_count ?? 0) > this.pendingRetryDelaysMs.length) {
      await this.parkPendingStatus(retryPayload, context);
      return;
    }

    await Promise.all([
      this.redis.zrem(this.pendingParkingSetKey, member),
      this.redis.zrem(this.pendingProcessingSetKey, member),
    ]);
    const existingScore = await this.redis.zscore(this.pendingSetKey, member);
    if (existingScore === null) {
      await this.redis.zadd(
        this.pendingSetKey,
        Date.now() + this.retryDelayMs(retryCount),
        member
      );
    }

    const shouldLogDeferral =
      !retryPayload.parked_at &&
      ((retryPayload.retry_count ?? 0) <= 1 ||
        (retryPayload.retry_count ?? 0) === this.pendingRetryDelaysMs.length);

    if (shouldLogDeferral) {
      logger.info(
        {
          ...logPayload,
          type: 'message_status_update_deferred_missing_message',
        },
        'Message status update deferred because target message was not indexed yet'
      );
    }

    incrementCounter('message_status_update_deferred_missing_message', 1, {
      account_id: data.account_id,
      retry_count: String(retryPayload.retry_count ?? 0),
    });
  }

  async deferMissingStatusUpdate(
    data: IMessageStatusUpdate,
    patch: MessageSummaryPatch,
    context: { batchSize: number; duration: number }
  ): Promise<void> {
    await this.storePendingStatusUpdate(data, patch, context, {
      incrementRetry: true,
    });
  }

  async reschedulePendingStatus(
    data: IMessageStatusUpdate,
    context: { batchSize: number; duration: number },
    options?: { incrementRetry?: boolean }
  ): Promise<void> {
    await this.storePendingStatusUpdate(data, data.patch, context, {
      incrementRetry: options?.incrementRetry !== false,
    });
  }

  async parkPendingStatus(
    data: IMessageStatusUpdate,
    context: { batchSize: number; duration: number }
  ): Promise<void> {
    const member = this.getStatusKafkaKey(data);
    const existingPayload = this.parsePayload(
      await this.redis.hget(this.pendingPayloadHashKey, member)
    );
    const alreadyParked = Boolean(existingPayload?.parked_at);
    const parkingPayload: IMessageStatusUpdate = {
      ...data,
      parked_at: existingPayload?.parked_at ?? data.parked_at ?? Date.now(),
    };

    await this.redis.hset(
      this.pendingPayloadHashKey,
      member,
      JSON.stringify(parkingPayload)
    );
    await Promise.all([
      this.redis.zrem(this.pendingSetKey, member),
      this.redis.zrem(this.pendingProcessingSetKey, member),
      this.redis.zadd(this.pendingParkingSetKey, Date.now(), member),
    ]);

    if (!alreadyParked) {
      logger.error(
        {
          account_id: data.account_id,
          message_id: data.message_id,
          retry_count: data.retry_count ?? 0,
          batch_size: context.batchSize,
          duration: context.duration,
          type: 'message_status_pending_parking_lot',
        },
        'Message status update remains pending after all normal retry delays'
      );
      incrementCounter('message_status_update_pending_parking_lot', 1, {
        account_id: data.account_id,
      });
    }
  }

  async claimDuePendingStatuses(): Promise<IMessageStatusUpdate[]> {
    await this.recoverExpiredProcessingStatuses();

    const dueMembers = await this.redis.zrangebyscore(
      this.pendingSetKey,
      '-inf',
      Date.now(),
      'LIMIT',
      0,
      this.pendingRetryBatchSize
    );

    const claimed: IMessageStatusUpdate[] = [];

    for (const member of dueMembers) {
      const removed = await this.redis.zrem(this.pendingSetKey, member);
      if (removed !== 1) {
        continue;
      }

      await this.redis.zadd(
        this.pendingProcessingSetKey,
        Date.now() + this.processingTimeoutMs,
        member
      );

      const rawPayload = await this.redis.hget(
        this.pendingPayloadHashKey,
        member
      );
      const payload = this.parsePayload(rawPayload);
      if (!payload || !rawPayload) {
        await this.clearPendingMember(member);
        continue;
      }

      claimed.push(payload);
    }

    if (claimed.length) {
      incrementCounter('message_status_pending_claimed', claimed.length);
    }

    return claimed;
  }

  private async recoverExpiredProcessingStatuses(): Promise<void> {
    const expiredMembers = await this.redis.zrangebyscore(
      this.pendingProcessingSetKey,
      '-inf',
      Date.now(),
      'LIMIT',
      0,
      this.pendingRetryBatchSize
    );

    for (const member of expiredMembers) {
      const removed = await this.redis.zrem(
        this.pendingProcessingSetKey,
        member
      );
      if (removed !== 1) {
        continue;
      }

      const rawPayload = await this.redis.hget(
        this.pendingPayloadHashKey,
        member
      );
      const payload = this.parsePayload(rawPayload);
      if (!payload) {
        await this.clearPendingMember(member);
        continue;
      }

      await this.redis.zadd(this.pendingSetKey, Date.now(), member);
    }
  }

  async wakePendingStatus(
    accountId: string,
    whatsAppMessageId: string
  ): Promise<boolean> {
    const member = MessageStatusPendingService.statusKey(
      accountId,
      whatsAppMessageId
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
    const wakePayload: IMessageStatusUpdate = isParked
      ? {
          ...payload,
          retry_count: 0,
        }
      : payload;

    if (wakePayload !== payload) {
      await this.redis.hset(
        this.pendingPayloadHashKey,
        member,
        JSON.stringify(wakePayload)
      );
    }

    await Promise.all([
      this.redis.zrem(this.pendingParkingSetKey, member),
      this.redis.zrem(this.pendingProcessingSetKey, member),
      this.redis.zadd(this.pendingSetKey, Date.now(), member),
    ]);

    logger.info(
      {
        account_id: accountId,
        message_id: whatsAppMessageId,
        retry_count: wakePayload.retry_count ?? 0,
        type: 'message_status_pending_woken',
      },
      'Pending message status update scheduled for immediate reconciliation'
    );
    incrementCounter('message_status_pending_woken', 1, {
      account_id: accountId,
    });

    return true;
  }

  async publishPendingStatus(
    accountId: string,
    whatsAppMessageId: string
  ): Promise<void> {
    await this.wakePendingStatus(accountId, whatsAppMessageId);
  }

  async clearPendingStatus(
    accountId: string,
    whatsAppMessageId: string
  ): Promise<void> {
    const member = MessageStatusPendingService.statusKey(
      accountId,
      whatsAppMessageId
    );
    await this.clearPendingMember(member);
  }

  private async clearPendingMember(member: string): Promise<void> {
    await Promise.all([
      this.redis.hdel(this.pendingPayloadHashKey, member),
      this.redis.zrem(this.pendingSetKey, member),
      this.redis.zrem(this.pendingParkingSetKey, member),
      this.redis.zrem(this.pendingProcessingSetKey, member),
    ]);
  }

  async markApplied(
    data: IMessageStatusUpdate,
    internalMessageId: string
  ): Promise<void> {
    if (!data.account_id || !data.message_id || !internalMessageId) {
      return;
    }

    const entry: AppliedStatusLedgerEntry = {
      account_id: data.account_id,
      message_id: data.message_id,
      internal_message_id: internalMessageId,
      patch: this.normalizePatch(data.patch),
      applied_at: Date.now(),
    };

    await Promise.all([
      this.redis.setex(
        this.appliedKey(data.account_id, data.message_id),
        this.appliedTtlSeconds,
        JSON.stringify(entry)
      ),
      this.setInternalMessageIdAlias(
        data.account_id,
        data.message_id,
        internalMessageId
      ),
      this.clearPendingStatus(data.account_id, data.message_id),
    ]);

    incrementCounter('message_status_update_applied_ledger', 1, {
      account_id: data.account_id,
    });
  }

  async isApplied(data: IMessageStatusUpdate): Promise<boolean> {
    if (!data.account_id || !data.message_id) {
      return false;
    }

    const entry = this.parseAppliedLedger(
      await this.redis.get(this.appliedKey(data.account_id, data.message_id))
    );

    if (!entry) {
      return false;
    }

    return this.patchCovers(entry.patch, data.patch);
  }
}
