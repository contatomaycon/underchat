import { injectable, inject } from 'tsyringe';
import { ElasticDatabaseService } from './elasticDatabase.service';
import { CentrifugoService } from './centrifugo.service';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { IChatMessage } from '@core/common/interfaces/IChatMessage';
import { chatAccountCentrifugo } from '@core/common/functions/centrifugoQueue';
import {
  MessageSummaryBaseline,
  MessageSummaryScriptParams,
} from '@core/common/interfaces/IMessageSummaryUpdate';
import Redis from 'ioredis';
import { createHash } from 'node:crypto';
import { logger } from '@core/plugins/telemetry/logger';
import { captureException } from '@core/plugins/telemetry/sentry';

export type MessageSummaryPatch = Partial<
  Pick<IChatMessage['summary'], 'is_sent' | 'is_delivered' | 'is_seen'>
>;

type ElasticHit<T> = {
  _source?: T;
};

@injectable()
export class MessageStatusService {
  private readonly cacheTtlSeconds = 3600;
  private readonly lockTtlSeconds = 10;
  private readonly messageCachePrefix = 'msg:';
  private readonly lockPrefix = 'lock:update-status:';
  private readonly circuitBreakerThreshold = 20;
  private readonly circuitBreakerResetMs = 25_000;

  private circuitBreakerFailures = 0;
  private circuitBreakerOpenUntil = 0;

  constructor(
    @inject(ElasticDatabaseService)
    private readonly elasticDatabaseService: ElasticDatabaseService,
    @inject(CentrifugoService)
    private readonly centrifugoService: CentrifugoService,
    @inject('Redis') private readonly redis: Redis
  ) {}

  async updateSummaryByWhatsAppId(
    accountId: string,
    messageId: string,
    patch: MessageSummaryPatch
  ): Promise<IChatMessage | null> {
    if (!messageId || !accountId || !this.hasPatch(patch)) {
      return null;
    }

    const message = await this.findMessageByWhatsAppIdCached(
      accountId,
      messageId
    );
    if (!message?.message_id) {
      return null;
    }

    const updatedMessage: IChatMessage = {
      ...message,
      summary: this.mergeSummary(message.summary, patch) ?? message.summary,
    };

    const channelAccountId = updatedMessage.account?.id ?? accountId;

    const updated = await this.updateSummaryAtomicallyWithLock(
      message.message_id,
      message.summary,
      patch
    );

    if (updated) {
      await this.invalidateMessageCache(accountId, messageId);
    }

    await this.publishCentrifugoImmediate(
      chatAccountCentrifugo(channelAccountId),
      updatedMessage
    );

    return updatedMessage;
  }

  /**
   * Publishes message status update immediately without debounce or deduplication.
   * Uses the immediate publish method for critical real-time updates.
   */
  private async publishCentrifugoImmediate(
    channel: string,
    message: IChatMessage
  ): Promise<void> {
    try {
      await this.centrifugoService.publishSubImmediate(channel, message);
    } catch (error) {
      logger.error(
        {
          err: error,
          type: 'message_status_centrifugo_publish_error',
          message_id: message.message_id,
          channel,
        },
        'Failed to publish message status update to Centrifugo'
      );
      captureException(error, {
        level: 'error',
        messageStatus: {
          type: 'centrifugo_publish_error',
          message_id: message.message_id,
          channel,
        },
      });
    }
  }

  private hasPatch(patch: MessageSummaryPatch): boolean {
    return Boolean(
      patch &&
      (patch.is_sent !== undefined ||
        patch.is_delivered !== undefined ||
        patch.is_seen !== undefined)
    );
  }

  private mergeSummary(
    current: IChatMessage['summary'],
    patch: MessageSummaryPatch
  ): IChatMessage['summary'] | null {
    const baseline: IChatMessage['summary'] = {
      is_sent: current?.is_sent ?? false,
      is_delivered: current?.is_delivered ?? false,
      is_seen: current?.is_seen ?? false,
      is_sent_to_internal: current?.is_sent_to_internal ?? false,
    };

    let changed = false;
    const next = { ...baseline };

    if (patch.is_sent && !next.is_sent) {
      next.is_sent = true;
      changed = true;
    }

    if (patch.is_delivered && !next.is_delivered) {
      next.is_delivered = true;
      changed = true;
    }

    if (patch.is_seen && !next.is_seen) {
      next.is_seen = true;
      changed = true;
    }

    return changed ? next : null;
  }

  private isCircuitOpen(): boolean {
    const now = Date.now();

    if (this.circuitBreakerOpenUntil && now < this.circuitBreakerOpenUntil) {
      return true;
    }

    if (this.circuitBreakerOpenUntil && now >= this.circuitBreakerOpenUntil) {
      this.circuitBreakerFailures = 0;
      this.circuitBreakerOpenUntil = 0;
    }

    return false;
  }

  private recordCircuitFailure(): void {
    this.circuitBreakerFailures++;

    if (this.circuitBreakerFailures >= this.circuitBreakerThreshold) {
      this.circuitBreakerOpenUntil = Date.now() + this.circuitBreakerResetMs;

      logger.error(
        {
          type: 'elasticsearch_circuit_breaker_open',
          failures: this.circuitBreakerFailures,
          resetMs: this.circuitBreakerResetMs,
        },
        'Elasticsearch circuit breaker opened'
      );

      captureException(new Error('Elasticsearch circuit breaker opened'), {
        level: 'error',
        elasticsearch: {
          type: 'circuit_breaker_open',
          failures: this.circuitBreakerFailures,
        },
      });
    }
  }

  private recordCircuitSuccess(): void {
    if (this.circuitBreakerFailures > 0) {
      this.circuitBreakerFailures = Math.max(
        0,
        this.circuitBreakerFailures - 1
      );
    }
  }

  private async findMessageByWhatsAppId(
    accountId: string,
    messageId: string
  ): Promise<IChatMessage | null> {
    if (this.isCircuitOpen()) {
      throw new Error('Elasticsearch circuit breaker is open');
    }

    try {
      const queryElastic = {
        size: 1,
        query: {
          bool: {
            must: [
              {
                nested: {
                  path: 'account',
                  query: {
                    term: { 'account.id': accountId },
                  },
                },
              },
              {
                nested: {
                  path: 'message_key',
                  query: {
                    term: { 'message_key.id': messageId },
                  },
                },
              },
            ],
          },
        },
      };

      const result = await this.elasticDatabaseService.select<IChatMessage>(
        EElasticIndex.message,
        queryElastic
      );

      const hit = result?.hits?.hits?.[0] as
        | ElasticHit<IChatMessage>
        | undefined;
      this.recordCircuitSuccess();
      return hit?._source ?? null;
    } catch (error) {
      this.recordCircuitFailure();
      throw error;
    }
  }

  private async findMessageByWhatsAppIdCached(
    accountId: string,
    messageId: string
  ): Promise<IChatMessage | null> {
    const cacheKey = `${this.messageCachePrefix}${accountId}:${messageId}`;

    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached) as IChatMessage;
      }
    } catch {}

    const message = await this.findMessageByWhatsAppIdWithRetry(
      accountId,
      messageId
    );

    if (message) {
      try {
        await this.redis.setex(
          cacheKey,
          this.cacheTtlSeconds,
          JSON.stringify(message)
        );
      } catch {}
    }

    return message;
  }

  private async invalidateMessageCache(
    accountId: string,
    messageId: string
  ): Promise<void> {
    const cacheKey = `${this.messageCachePrefix}${accountId}:${messageId}`;
    try {
      await this.redis.del(cacheKey);
    } catch {}
  }

  private async updateSummaryAtomicallyWithLock(
    messageId: string,
    currentSummary: IChatMessage['summary'],
    patch: MessageSummaryPatch,
    maxRetries = 5
  ): Promise<boolean> {
    const lockKey = `${this.lockPrefix}${messageId}`;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const lockAcquired = await this.redis.set(
          lockKey,
          '1',
          'EX',
          this.lockTtlSeconds,
          'NX'
        );

        if (!lockAcquired) {
          if (attempt < maxRetries - 1) {
            const backoffMs = Math.min(100 * Math.pow(2, attempt), 1000);
            await new Promise((resolve) => setTimeout(resolve, backoffMs));
            continue;
          }
          return false;
        }

        const refreshInterval = setInterval(
          async () => {
            try {
              await this.redis.expire(lockKey, this.lockTtlSeconds);
            } catch {}
          },
          (this.lockTtlSeconds * 1000) / 3
        );

        try {
          const result = await this.updateSummaryAtomicallyWithRetry(
            messageId,
            currentSummary,
            patch,
            3
          );
          return result;
        } finally {
          clearInterval(refreshInterval);
          await this.redis.del(lockKey);
        }
      } catch {
        try {
          await this.redis.del(lockKey);
        } catch {}

        if (attempt < maxRetries - 1) {
          const backoffMs = Math.min(100 * Math.pow(2, attempt), 1000);
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
        }
      }
    }

    return false;
  }

  private async findMessageByWhatsAppIdWithRetry(
    accountId: string,
    messageId: string,
    maxRetries = 5
  ): Promise<IChatMessage | null> {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const message = await this.findMessageByWhatsAppId(accountId, messageId);
      if (message?.message_id) {
        return message;
      }

      if (attempt < maxRetries - 1) {
        const backoffMs = Math.min(100 * Math.pow(2, attempt), 1000);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }

    return null;
  }

  private async updateSummaryAtomicallyWithRetry(
    messageId: string,
    currentSummary: IChatMessage['summary'],
    patch: MessageSummaryPatch,
    maxRetries = 5
  ): Promise<boolean> {
    return this.attemptUpdateWithRetry(
      messageId,
      currentSummary,
      patch,
      0,
      maxRetries
    );
  }

  private async attemptUpdateWithRetry(
    messageId: string,
    summary: IChatMessage['summary'],
    patch: MessageSummaryPatch,
    attempt: number,
    maxRetries: number
  ): Promise<boolean> {
    if (attempt >= maxRetries) {
      return false;
    }

    const updated = await this.updateSummaryAtomically(
      messageId,
      summary,
      patch
    );
    if (updated) {
      return true;
    }

    if (attempt >= maxRetries - 1) {
      return false;
    }

    const backoffMs = Math.min(100 * Math.pow(2, attempt), 1000);
    await new Promise((resolve) => setTimeout(resolve, backoffMs));

    const refreshedMessage = await this.findMessageByMessageId(messageId);
    const nextSummary = refreshedMessage?.summary ?? summary;

    return this.attemptUpdateWithRetry(
      messageId,
      nextSummary,
      patch,
      attempt + 1,
      maxRetries
    );
  }

  private async findMessageByMessageId(
    messageId: string
  ): Promise<IChatMessage | null> {
    if (this.isCircuitOpen()) {
      throw new Error('Elasticsearch circuit breaker is open');
    }

    try {
      const queryElastic = {
        size: 1,
        query: {
          term: { message_id: messageId },
        },
      };

      const result = await this.elasticDatabaseService.select<IChatMessage>(
        EElasticIndex.message,
        queryElastic
      );

      const hit = result?.hits?.hits?.[0] as
        | ElasticHit<IChatMessage>
        | undefined;
      this.recordCircuitSuccess();
      return hit?._source ?? null;
    } catch (error) {
      this.recordCircuitFailure();
      throw error;
    }
  }

  private buildMessageSummaryBaseline(
    currentSummary: IChatMessage['summary'] | null | undefined
  ): MessageSummaryBaseline {
    return {
      is_sent: currentSummary?.is_sent ?? false,
      is_delivered: currentSummary?.is_delivered ?? false,
      is_seen: currentSummary?.is_seen ?? false,
      is_sent_to_internal: currentSummary?.is_sent_to_internal ?? false,
    };
  }

  private buildMessageSummaryScriptParams(
    baseline: MessageSummaryBaseline,
    patch: MessageSummaryPatch
  ): MessageSummaryScriptParams {
    return {
      baseline,
      patch_is_sent: patch.is_sent ?? null,
      patch_is_delivered: patch.is_delivered ?? null,
      patch_is_seen: patch.is_seen ?? null,
    };
  }

  private buildMessageSummaryScriptSource(): string {
    return `
      if (ctx._source.summary == null) {
        ctx._source.summary = params.baseline;
      }
      
      def summary = ctx._source.summary;
      def shouldUpdate = false;
      def changed = false;
      
      if (params.patch_is_sent != null && params.patch_is_sent) {
        if (!summary.containsKey('is_sent') || !summary.is_sent) {
          summary.is_sent = true;
          changed = true;
          shouldUpdate = true;
        }
      }
      
      if (params.patch_is_delivered != null && params.patch_is_delivered) {
        if (!summary.containsKey('is_delivered') || !summary.is_delivered) {
          summary.is_delivered = true;
          changed = true;
          shouldUpdate = true;
        }
      }
      
      if (params.patch_is_seen != null && params.patch_is_seen) {
        if (!summary.containsKey('is_seen') || !summary.is_seen) {
          summary.is_seen = true;
          changed = true;
          shouldUpdate = true;
        }
      }
      
      if (!summary.containsKey('is_sent_to_internal')) {
        summary.is_sent_to_internal = params.baseline.is_sent_to_internal;
        shouldUpdate = true;
      }
      
      if (!shouldUpdate) {
        ctx.op = 'noop';
      }
    `;
  }

  private async updateSummaryAtomically(
    messageId: string,
    currentSummary: IChatMessage['summary'],
    patch: MessageSummaryPatch
  ): Promise<boolean> {
    if (this.isCircuitOpen()) {
      throw new Error('Elasticsearch circuit breaker is open');
    }

    const baseline = this.buildMessageSummaryBaseline(currentSummary);
    const scriptParams = this.buildMessageSummaryScriptParams(baseline, patch);
    const scriptSource = this.buildMessageSummaryScriptSource();

    try {
      const result = await this.elasticDatabaseService.updateWithScriptOCC(
        EElasticIndex.message,
        messageId,
        {
          source: scriptSource,
          params: scriptParams,
          upsert: {
            summary: baseline,
          },
        },
        {
          upsert: true,
          maxRetries: 5,
        }
      );

      this.recordCircuitSuccess();
      return result === 'updated' || result === 'created' || result === 'noop';
    } catch {
      this.recordCircuitFailure();
      return false;
    }
  }

  static hashPatch(patch: MessageSummaryPatch): string {
    const sorted = JSON.stringify(patch, Object.keys(patch).sort());
    return createHash('sha256').update(sorted).digest('hex').substring(0, 16);
  }
}
