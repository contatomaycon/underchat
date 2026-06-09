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
import {
  recordException,
  incrementCounter,
} from '@core/plugins/telemetry/observability';
import type { WAMessageKey } from '@whiskeysockets/baileys';
import { parseSerializedMessageId } from '@core/common/functions/parseSerializedMessageId';
import { normalizeJid } from '@core/common/functions/normalizeJid';
import { MessageStatusPendingService } from './messageStatusPending.service';

export type MessageSummaryPatch = Partial<
  Pick<IChatMessage['summary'], 'is_sent' | 'is_delivered' | 'is_seen'>
>;

type ElasticHit<T> = {
  _source?: T;
};

interface WhatsAppMessageLookupResult {
  message: IChatMessage | null;
  candidateCount: number;
}

type MessageKeyLike = WAMessageKey & {
  remoteJidAlt?: string | null;
  participantAlt?: string | null;
};

@injectable()
export class MessageStatusService {
  private readonly cacheTtlSeconds = 3600;
  private readonly lockTtlSeconds = 30;
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
    @inject(MessageStatusPendingService)
    private readonly messageStatusPendingService: MessageStatusPendingService,
    @inject('Redis') private readonly redis: Redis
  ) {}

  static statusKafkaKey(accountId: string, messageId: string): string {
    return MessageStatusPendingService.statusKey(accountId, messageId);
  }

  async updateSummaryByWhatsAppId(
    accountId: string,
    messageId: string,
    patch: MessageSummaryPatch,
    key?: MessageKeyLike
  ): Promise<IChatMessage | null> {
    const normalizedPatch = this.normalizePatch(patch);
    if (!messageId || !accountId || !this.hasPatch(normalizedPatch)) {
      return null;
    }

    const aliasedMessageId =
      await this.messageStatusPendingService.getInternalMessageIdAlias(
        accountId,
        messageId
      );

    let message = aliasedMessageId
      ? await this.findMessageByMessageIdWithRetry(aliasedMessageId, 2)
      : null;

    if (!message?.message_id) {
      message = await this.findMessageByWhatsAppIdCached(
        accountId,
        messageId,
        key
      );
    }

    if (!message?.message_id) {
      return null;
    }

    await this.messageStatusPendingService.setInternalMessageIdAlias(
      accountId,
      messageId,
      message.message_id
    );

    return this.applySummaryPatchToMessage(
      accountId,
      messageId,
      message,
      normalizedPatch
    );
  }

  private async applySummaryPatchToMessage(
    accountId: string,
    whatsappMessageId: string,
    message: IChatMessage,
    normalizedPatch: MessageSummaryPatch
  ): Promise<IChatMessage | null> {
    if (!message.message_id) {
      return null;
    }

    const fallbackMessage: IChatMessage = {
      ...message,
      summary:
        this.mergeSummary(message.summary, normalizedPatch) ??
        this.normalizeSummaryState(message.summary),
    };

    const channelAccountId = message.account?.id ?? accountId;

    const updated = await this.updateSummaryAtomicallyWithLock(
      message.message_id,
      message.summary,
      normalizedPatch
    );
    if (!updated) {
      return null;
    }

    await this.invalidateMessageCache(accountId, whatsappMessageId);

    const canonicalMessage = await this.findMessageByMessageIdWithRetry(
      message.message_id
    );
    if (!canonicalMessage) {
      return fallbackMessage;
    }

    const publishedMessage: IChatMessage = {
      ...canonicalMessage,
      summary:
        this.mergeSummary(canonicalMessage.summary, normalizedPatch) ??
        this.normalizeSummaryState(canonicalMessage.summary),
    };

    await this.publishCentrifugoImmediate(
      chatAccountCentrifugo(channelAccountId),
      publishedMessage
    );

    return publishedMessage;
  }

  async markMessageAsNotSent(
    accountId: string,
    messageId: string
  ): Promise<IChatMessage | null> {
    if (!accountId || !messageId) {
      return null;
    }

    const existingMessage =
      await this.findMessageByMessageIdWithRetry(messageId);
    if (!existingMessage?.message_id) {
      return null;
    }

    await this.markSummaryAsFailedAtomically(existingMessage.message_id);

    const canonicalMessage = await this.findMessageByMessageIdWithRetry(
      existingMessage.message_id
    );

    const channelAccountId =
      canonicalMessage?.account?.id ?? existingMessage.account?.id ?? accountId;

    const fallbackSummary = this.forceFailedSummary(existingMessage.summary);
    const fallbackMessage: IChatMessage = {
      ...existingMessage,
      summary: fallbackSummary,
    };

    const publishedMessage = canonicalMessage
      ? ({
          ...canonicalMessage,
          summary: this.forceFailedSummary(canonicalMessage.summary),
        } as IChatMessage)
      : fallbackMessage;

    await this.publishCentrifugoImmediate(
      chatAccountCentrifugo(channelAccountId),
      publishedMessage
    );

    return publishedMessage;
  }

  async isMessageAlreadySentByMessageId(messageId: string): Promise<boolean> {
    const normalizedMessageId = messageId?.trim();
    if (!normalizedMessageId) {
      return false;
    }

    const existingMessage = await this.findMessageByMessageIdWithRetry(
      normalizedMessageId,
      3
    );
    if (!existingMessage?.message_id) {
      return false;
    }

    const summary = this.normalizeSummaryState(existingMessage.summary);
    return summary.is_sent || summary.is_delivered || summary.is_seen;
  }

  /**
   * Publishes message status update immediately without debounce or deduplication.
   * Uses the immediate publish method for critical real-time updates.
   * Best-effort: failures are logged and enqueued for retry, but do NOT propagate
   * to the caller since the Elasticsearch update already succeeded.
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
        'Failed to publish message status update to Centrifugo (best-effort, enqueuing retry)'
      );
      recordException(error, {
        level: 'error',
        messageStatus: {
          type: 'centrifugo_publish_error',
          message_id: message.message_id,
          channel,
        },
      });
      incrementCounter('message_status_centrifugo_publish_failed', 1, {
        channel,
      });
      this.enqueueCentrifugoRetry(channel, message);
    }
  }

  private readonly centrifugoRetryKey = 'centrifugo:status:retry';
  private readonly centrifugoRetryMaxSize = 5_000;

  private enqueueCentrifugoRetry(channel: string, message: IChatMessage): void {
    const payload = JSON.stringify({
      channel,
      message_id: message.message_id,
      data: message,
      enqueued_at: Date.now(),
    });

    this.redis
      .lpush(this.centrifugoRetryKey, payload)
      .then(() =>
        this.redis.ltrim(
          this.centrifugoRetryKey,
          0,
          this.centrifugoRetryMaxSize - 1
        )
      )
      .catch(() => {});
  }

  private hasPatch(patch: MessageSummaryPatch): boolean {
    return Boolean(
      patch &&
      (patch.is_sent === true ||
        patch.is_delivered === true ||
        patch.is_seen === true)
    );
  }

  private normalizePatch(patch: MessageSummaryPatch): MessageSummaryPatch {
    const hasSeen = patch.is_seen === true;
    const hasDelivered = patch.is_delivered === true || hasSeen;
    const hasSent = patch.is_sent === true || hasDelivered;

    const normalized: MessageSummaryPatch = {};
    if (hasSent) {
      normalized.is_sent = true;
    }
    if (hasDelivered) {
      normalized.is_delivered = true;
    }
    if (hasSeen) {
      normalized.is_seen = true;
    }

    return normalized;
  }

  private normalizeSummaryState(
    summary: IChatMessage['summary'] | null | undefined
  ): IChatMessage['summary'] {
    const normalized: IChatMessage['summary'] = {
      is_sent: summary?.is_sent === true,
      is_delivered: summary?.is_delivered === true,
      is_seen: summary?.is_seen === true,
      is_sent_to_internal: summary?.is_sent_to_internal ?? false,
    };

    if (normalized.is_seen) {
      normalized.is_delivered = true;
      normalized.is_sent = true;
    } else if (normalized.is_delivered) {
      normalized.is_sent = true;
    }

    return normalized;
  }

  private forceFailedSummary(
    summary: IChatMessage['summary'] | null | undefined
  ): IChatMessage['summary'] {
    const normalized = this.normalizeSummaryState(summary);
    return {
      ...normalized,
      is_sent: false,
      is_delivered: false,
      is_seen: false,
      is_sent_to_internal: false,
    };
  }

  private toNonEmptyString(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private collectRemoteCandidatesFromKey(key?: MessageKeyLike): string[] {
    if (!key) return [];

    const rawCandidates = [
      key.remoteJid,
      key.remoteJidAlt,
      key.participant,
      key.participantAlt,
    ];

    const candidates = new Set<string>();
    for (const candidate of rawCandidates) {
      const raw = this.toNonEmptyString(candidate);
      if (!raw) continue;

      candidates.add(raw);

      const normalized = normalizeJid(raw) ?? raw;
      candidates.add(normalized);

      if (normalized.endsWith('@s.whatsapp.net')) {
        candidates.add(normalized.replace(/@s\.whatsapp\.net$/, '@c.us'));
      }

      if (normalized.endsWith('@c.us')) {
        candidates.add(normalized.replace(/@c\.us$/, '@s.whatsapp.net'));
      }
    }

    return Array.from(candidates);
  }

  private buildMessageIdCandidates(
    messageId: string,
    key?: MessageKeyLike
  ): string[] {
    const normalizedMessageId = this.toNonEmptyString(messageId);
    if (!normalizedMessageId) return [];

    const candidates = new Set<string>([normalizedMessageId]);
    const parsed = parseSerializedMessageId(normalizedMessageId);
    const stanzaId = parsed?.stanzaId ?? normalizedMessageId;
    candidates.add(stanzaId);

    const remoteCandidates = new Set<string>([
      ...this.collectRemoteCandidatesFromKey(key),
      ...(parsed?.remoteJid ? [parsed.remoteJid] : []),
    ]);

    const keyFromMe = typeof key?.fromMe === 'boolean' ? key.fromMe : undefined;
    const fromMeCandidates = new Set<boolean>([false, true]);

    if (keyFromMe !== undefined) {
      fromMeCandidates.add(keyFromMe);
      fromMeCandidates.add(!keyFromMe);
    }

    if (parsed) {
      fromMeCandidates.add(parsed.fromMe);
      fromMeCandidates.add(!parsed.fromMe);
    }

    for (const remoteCandidate of remoteCandidates) {
      for (const fromMeCandidate of fromMeCandidates) {
        candidates.add(`${fromMeCandidate}_${remoteCandidate}_${stanzaId}`);
      }
    }

    return Array.from(candidates);
  }

  private mergeSummary(
    current: IChatMessage['summary'],
    patch: MessageSummaryPatch
  ): IChatMessage['summary'] | null {
    const normalizedPatch = this.normalizePatch(patch);
    const baseline = this.normalizeSummaryState(current);

    let changed = false;
    const next = { ...baseline };

    if (normalizedPatch.is_sent && !next.is_sent) {
      next.is_sent = true;
      changed = true;
    }

    if (normalizedPatch.is_delivered && !next.is_delivered) {
      next.is_delivered = true;
      changed = true;
    }

    if (normalizedPatch.is_seen && !next.is_seen) {
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

      recordException(new Error('Elasticsearch circuit breaker opened'), {
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
    messageId: string,
    key?: MessageKeyLike
  ): Promise<WhatsAppMessageLookupResult> {
    if (this.isCircuitOpen()) {
      throw new Error('Elasticsearch circuit breaker is open');
    }

    try {
      const idCandidates = this.buildMessageIdCandidates(messageId, key);
      if (!idCandidates.length) {
        return {
          candidateCount: 0,
          message: null,
        };
      }

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
                    bool: {
                      should: idCandidates.map((candidate) => ({
                        term: { 'message_key.id': candidate },
                      })),
                      minimum_should_match: 1,
                    },
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
      const message = hit?._source ?? null;
      this.recordCircuitSuccess();
      return {
        candidateCount: idCandidates.length,
        message,
      };
    } catch (error) {
      this.recordCircuitFailure();
      throw error;
    }
  }

  private async findMessageByWhatsAppIdCached(
    accountId: string,
    messageId: string,
    key?: MessageKeyLike
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
      messageId,
      key
    );

    if (message) {
      try {
        if (message.message_id) {
          await this.messageStatusPendingService.setInternalMessageIdAlias(
            accountId,
            messageId,
            message.message_id
          );
        }
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
    key?: MessageKeyLike,
    maxRetries = 5
  ): Promise<IChatMessage | null> {
    let lastCandidateCount = 0;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const result = await this.findMessageByWhatsAppId(
        accountId,
        messageId,
        key
      );
      lastCandidateCount = result.candidateCount;
      if (result.message?.message_id) {
        return result.message;
      }

      if (attempt < maxRetries - 1) {
        const backoffMs = Math.min(100 * Math.pow(2, attempt), 1000);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }

    logger.info(
      {
        type: 'ack_match_miss',
        account_id: accountId,
        message_id: messageId,
        candidate_count: lastCandidateCount,
        attempts: maxRetries,
      },
      'No message found for WhatsApp status update after immediate lookup retries'
    );

    return null;
  }

  private async findMessageByMessageIdWithRetry(
    messageId: string,
    maxRetries = 5
  ): Promise<IChatMessage | null> {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const message = await this.findMessageByMessageId(messageId);
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
      const message = (await this.elasticDatabaseService.view(
        EElasticIndex.message,
        messageId
      )) as IChatMessage | null;
      this.recordCircuitSuccess();
      return message;
    } catch (error) {
      this.recordCircuitFailure();
      throw error;
    }
  }

  private buildMessageSummaryBaseline(
    currentSummary: IChatMessage['summary'] | null | undefined
  ): MessageSummaryBaseline {
    return this.normalizeSummaryState(currentSummary);
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
      if (summary.containsKey('is_sent_to_internal') && summary.is_sent_to_internal == false) {
        ctx.op = 'noop';
        return;
      }

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

      if ((summary.containsKey('is_seen') && summary.is_seen) || params.patch_is_seen == true) {
        if (!summary.containsKey('is_delivered') || !summary.is_delivered) {
          summary.is_delivered = true;
          changed = true;
          shouldUpdate = true;
        }
        if (!summary.containsKey('is_sent') || !summary.is_sent) {
          summary.is_sent = true;
          changed = true;
          shouldUpdate = true;
        }
      } else if ((summary.containsKey('is_delivered') && summary.is_delivered) || params.patch_is_delivered == true) {
        if (!summary.containsKey('is_sent') || !summary.is_sent) {
          summary.is_sent = true;
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

  private buildMarkSummaryAsFailedScriptSource(): string {
    return `
      if (ctx._source == null) {
        ctx.op = 'noop';
        return;
      }

      if (ctx._source.summary == null) {
        ctx._source.summary = [:];
      }

      def summary = ctx._source.summary;
      def changed = false;

      if (!summary.containsKey('is_sent') || summary.is_sent != false) {
        summary.is_sent = false;
        changed = true;
      }

      if (!summary.containsKey('is_delivered') || summary.is_delivered != false) {
        summary.is_delivered = false;
        changed = true;
      }

      if (!summary.containsKey('is_seen') || summary.is_seen != false) {
        summary.is_seen = false;
        changed = true;
      }

      if (!summary.containsKey('is_sent_to_internal') || summary.is_sent_to_internal != false) {
        summary.is_sent_to_internal = false;
        changed = true;
      }

      if (!changed) {
        ctx.op = 'noop';
      }
    `;
  }

  private async markSummaryAsFailedAtomically(
    messageId: string
  ): Promise<void> {
    if (this.isCircuitOpen()) {
      throw new Error('Elasticsearch circuit breaker is open');
    }

    const scriptSource = this.buildMarkSummaryAsFailedScriptSource();
    try {
      await this.elasticDatabaseService.updateWithScriptOCC(
        EElasticIndex.message,
        messageId,
        {
          source: scriptSource,
          params: {},
        },
        {
          maxRetries: 5,
        }
      );
      this.recordCircuitSuccess();
    } catch (error) {
      this.recordCircuitFailure();
      throw error;
    }
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
    const normalizedPatch = this.normalizePatch(patch);
    const scriptParams = this.buildMessageSummaryScriptParams(
      baseline,
      normalizedPatch
    );
    const scriptSource = this.buildMessageSummaryScriptSource();

    try {
      const result = await this.elasticDatabaseService.updateWithScriptOCC(
        EElasticIndex.message,
        messageId,
        {
          source: scriptSource,
          params: scriptParams,
        },
        {
          maxRetries: 5,
        }
      );

      this.recordCircuitSuccess();
      return result === 'updated' || result === 'noop';
    } catch {
      this.recordCircuitFailure();
      return false;
    }
  }

  static hashPatch(patch: MessageSummaryPatch): string {
    const hasSeen = patch.is_seen === true;
    const hasDelivered = patch.is_delivered === true || hasSeen;
    const hasSent = patch.is_sent === true || hasDelivered;

    const normalized: MessageSummaryPatch = {};
    if (hasSent) {
      normalized.is_sent = true;
    }
    if (hasDelivered) {
      normalized.is_delivered = true;
    }
    if (hasSeen) {
      normalized.is_seen = true;
    }

    const sorted = JSON.stringify(normalized, Object.keys(normalized).sort());
    return createHash('sha256').update(sorted).digest('hex').substring(0, 16);
  }
}
