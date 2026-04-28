import { injectable, inject } from 'tsyringe';
import Redis from 'ioredis';
import { KafkaServiceQueueService } from './kafkaServiceQueue.service';
import { StreamProducerService } from './streamProducer.service';
import { IMessageStatusUpdate } from '@core/common/interfaces/IMessageStatusUpdate';
import type { MessageSummaryPatch } from './messageStatus.service';
import { logger } from '@core/plugins/telemetry/logger';
import { incrementCounter } from '@core/plugins/telemetry/observability';

@injectable()
export class MessageStatusPendingService {
  private readonly pendingSetKey = 'message-status:update:pending:retry';
  private readonly pendingPayloadHashKey =
    'message-status:update:pending:payloads';
  private readonly aliasPrefix = 'message-status:update:alias:';
  private readonly aliasTtlSeconds = 60 * 60 * 24 * 30;
  private readonly pendingRetryBatchSize = 100;
  private readonly pendingRetryDelaysMs = [
    2_000, 5_000, 10_000, 20_000, 30_000, 60_000, 120_000, 300_000,
  ];

  constructor(
    @inject('Redis') private readonly redis: Redis,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    @inject(StreamProducerService)
    private readonly streamProducerService: StreamProducerService
  ) {}

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

  private retryDelayMs(retryCount: number): number {
    return (
      this.pendingRetryDelaysMs[
        Math.min(retryCount, this.pendingRetryDelaysMs.length - 1)
      ] ?? 300_000
    );
  }

  async deferMissingStatusUpdate(
    data: IMessageStatusUpdate,
    patch: MessageSummaryPatch,
    context: { batchSize: number; duration: number }
  ): Promise<void> {
    const member = this.getStatusKafkaKey(data);
    const existingPayload = this.parsePayload(
      await this.redis.hget(this.pendingPayloadHashKey, member)
    );

    const retryCount = Math.max(
      this.getRetryCount(data),
      existingPayload ? this.getRetryCount(existingPayload) : 0
    );
    const retryPayload: IMessageStatusUpdate = {
      ...(existingPayload ?? data),
      ...data,
      patch: this.mergePatches([existingPayload?.patch ?? {}, patch]),
      retry_count: retryCount + 1,
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

    const existingScore = await this.redis.zscore(this.pendingSetKey, member);
    if (existingScore === null) {
      await this.redis.zadd(
        this.pendingSetKey,
        Date.now() + this.retryDelayMs(retryCount),
        member
      );
    }

    const logPayload = {
      account_id: data.account_id,
      message_id: data.message_id,
      retry_count: retryPayload.retry_count,
      batch_size: context.batchSize,
      duration: context.duration,
    };

    if ((retryPayload.retry_count ?? 0) > this.pendingRetryDelaysMs.length) {
      logger.error(
        {
          ...logPayload,
          type: 'message_status_pending_parking_lot',
        },
        'Message status update remains pending after all normal retry delays'
      );
      incrementCounter('message_status_update_pending_parking_lot', 1, {
        account_id: data.account_id,
      });
    } else {
      logger.warn(
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

  async publishDuePendingStatuses(): Promise<void> {
    const dueMembers = await this.redis.zrangebyscore(
      this.pendingSetKey,
      '-inf',
      Date.now(),
      'LIMIT',
      0,
      this.pendingRetryBatchSize
    );

    await Promise.all(
      dueMembers.map((member) => this.publishPendingMember(member))
    );
  }

  async publishPendingStatus(
    accountId: string,
    whatsAppMessageId: string
  ): Promise<void> {
    const member = MessageStatusPendingService.statusKey(
      accountId,
      whatsAppMessageId
    );
    await this.publishPendingMember(member);
  }

  private async publishPendingMember(member: string): Promise<void> {
    const removed = await this.redis.zrem(this.pendingSetKey, member);
    if (removed !== 1) {
      return;
    }

    const rawPayload = await this.redis.hget(
      this.pendingPayloadHashKey,
      member
    );
    const payload = this.parsePayload(rawPayload);
    if (!payload || !rawPayload) {
      await this.redis.hdel(this.pendingPayloadHashKey, member);
      return;
    }

    try {
      await this.streamProducerService.send(
        this.kafkaServiceQueueService.updateMessageStatus(),
        payload,
        this.getStatusKafkaKey(payload)
      );
      await this.redis.hdel(this.pendingPayloadHashKey, member);

      logger.info(
        {
          account_id: payload.account_id,
          message_id: payload.message_id,
          retry_count: payload.retry_count ?? 0,
          type: 'message_status_pending_requeued',
        },
        'Pending message status update requeued'
      );

      incrementCounter('message_status_pending_requeued', 1, {
        account_id: payload.account_id,
      });
    } catch (error) {
      await this.redis.hset(this.pendingPayloadHashKey, member, rawPayload);
      await this.redis.zadd(
        this.pendingSetKey,
        Date.now() + this.retryDelayMs(this.getRetryCount(payload)),
        member
      );

      logger.error(
        {
          err: error,
          account_id: payload.account_id,
          message_id: payload.message_id,
          retry_count: payload.retry_count ?? 0,
          type: 'message_status_pending_publish_error',
        },
        'Failed to requeue pending message status update'
      );
    }
  }
}
