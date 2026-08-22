import { injectable, inject } from 'tsyringe';
import { ElasticDatabaseService } from './elasticDatabase.service';
import { CentrifugoService } from './centrifugo.service';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { IChatMessage } from '@core/common/interfaces/IChatMessage';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import { chatAccountCentrifugo } from '@core/common/functions/centrifugoQueue';
import { messageBelongsToChatAndAccount } from '@core/common/functions/chatMessageOwnership';
import {
  MessageSummaryBaseline,
  MessageSummaryScriptParams,
} from '@core/common/interfaces/IMessageSummaryUpdate';
import Redis from 'ioredis';
import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { WAMessageKey } from '@whiskeysockets/baileys';
import { parseSerializedMessageId } from '@core/common/functions/parseSerializedMessageId';
import { normalizeJid } from '@core/common/functions/normalizeJid';
import { MessageStatusPendingService } from './messageStatusPending.service';
import type { OutboundWebhookEventType } from '@core/common/constants/outboundWebhookEvents';
import {
  buildOutboundWebhookEnvelope,
  normalizeOutboundWebhookChannelIds,
  serializePublicMessage,
} from '@core/common/functions/outboundWebhookPayload';
import {
  OUTBOUND_WEBHOOK_EVENT_SERVICE_TOKEN,
  type OutboundWebhookEventServicePort,
  type PreparedOutboundWebhookEvent,
} from '@core/common/interfaces/IOutboundWebhookEventService';

export type MessageSummaryPatch = Partial<
  Pick<IChatMessage['summary'], 'is_sent' | 'is_delivered' | 'is_seen'>
>;

export interface ProviderMessageStatusMetadata {
  errorCode?: number | null;
  occurredAt?: string | null;
}

type ElasticHit<T> = {
  _source?: T;
};

interface WhatsAppMessageLookupResult {
  message: IChatMessage | null;
  candidateCount: number;
}

interface PreparedDeliveryWebhookEvent {
  eventType: OutboundWebhookEventType;
  prepared: PreparedOutboundWebhookEvent;
}

type StatusMutationGuard = () => void | Promise<void>;

type StatusMutationOutcome = 'updated' | 'noop' | 'not_found' | 'failed';

type PositiveDeliveryStatus = 'sent' | 'delivered' | 'read';

type MessageKeyLike = WAMessageKey & {
  remoteJidAlt?: string | null;
  participantAlt?: string | null;
};

class MessageStatusMutationLeaseLostError extends Error {
  constructor() {
    super('message_status_mutation_lease_lost');
    this.name = 'MessageStatusMutationLeaseLostError';
  }
}

const REFRESH_STATUS_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then
  return 0
end
return redis.call('PEXPIRE', KEYS[1], ARGV[2])
`;

const RELEASE_STATUS_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then
  return 0
end
return redis.call('DEL', KEYS[1])
`;

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
    @inject('Redis') private readonly redis: Redis,
    @inject(OUTBOUND_WEBHOOK_EVENT_SERVICE_TOKEN, { isOptional: true })
    private readonly outboundWebhookEventService?: OutboundWebhookEventServicePort
  ) {}

  private resolveDeliveryEventTypes(
    patch: MessageSummaryPatch,
    currentSummary: IChatMessage['summary'] | null | undefined
  ): OutboundWebhookEventType[] {
    const baseline = this.normalizeSummaryState(currentSummary);
    const eventTypes: OutboundWebhookEventType[] = [];
    if (patch.is_sent && !baseline.is_sent) {
      eventTypes.push('message.delivery.sent');
    }
    if (patch.is_delivered && !baseline.is_delivered) {
      eventTypes.push('message.delivery.delivered');
    }
    if (patch.is_seen && !baseline.is_seen) {
      eventTypes.push('message.delivery.read');
    }
    return eventTypes;
  }

  private isOutboundMessage(message: IChatMessage): boolean {
    const fromMe = message.message_key?.from_me;
    if (typeof fromMe === 'boolean') return fromMe;
    return message.type_user !== ETypeUserChat.client;
  }

  private prepareDeliveryWebhookEvents = async (
    message: IChatMessage,
    eventTypes: readonly OutboundWebhookEventType[],
    source: string,
    assertActive?: StatusMutationGuard
  ): Promise<PreparedDeliveryWebhookEvent[]> => {
    await assertActive?.();
    if (!this.outboundWebhookEventService || eventTypes.length === 0) {
      return [];
    }

    const preparedEvents: PreparedDeliveryWebhookEvent[] = [];
    try {
      const channelIds = normalizeOutboundWebhookChannelIds([
        message.worker.id,
      ]);
      for (const eventType of [...new Set(eventTypes)]) {
        await assertActive?.();
        const prepared =
          await this.outboundWebhookEventService.prepareBestEffort({
            accountId: message.account.id,
            eventType,
            aggregate: { type: 'message', id: message.message_id },
            data: {
              message: serializePublicMessage(message),
              delivery_status: eventType.replace('message.delivery.', ''),
            },
            previous: null,
            source,
            channelIds,
            actor: { type: 'system' },
            idempotencyKey: `message-delivery:${message.message_id}:${eventType}`,
          });
        await assertActive?.();
        if (prepared) {
          preparedEvents.push({ eventType, prepared });
        }
      }
      return preparedEvents;
    } catch (error) {
      await assertActive?.();
      console.error('[OutboundWebhook] Delivery event preparation failed', {
        account_id: message.account.id,
        message_id: message.message_id,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  };

  private completeDeliveryWebhookEvents = async (
    message: IChatMessage,
    preparedEvents: PreparedDeliveryWebhookEvent[],
    source: string,
    assertActive?: StatusMutationGuard
  ): Promise<void> => {
    if (!this.outboundWebhookEventService) return;

    const channelIds = normalizeOutboundWebhookChannelIds([message.worker.id]);

    for (const { eventType, prepared } of preparedEvents) {
      try {
        await assertActive?.();
        const envelope = buildOutboundWebhookEnvelope({
          id: prepared.eventId,
          type: eventType,
          occurredAt: prepared.envelope.occurred_at,
          accountId: message.account.id,
          aggregate: { type: 'message', id: message.message_id },
          data: {
            message: serializePublicMessage(message),
            delivery_status: eventType.replace('message.delivery.', ''),
          },
          previous: null,
          source,
          channelIds,
          actor: { type: 'system' },
        });
        await this.outboundWebhookEventService.completeBestEffort({
          eventId: prepared.eventId,
          accountId: message.account.id,
          envelope,
        });
        await assertActive?.();
      } catch (error: unknown) {
        await assertActive?.();
        console.error('[OutboundWebhook] Delivery event finalization failed', {
          account_id: message.account.id,
          message_id: message.message_id,
          event_id: prepared.eventId,
          error: error instanceof Error ? error.message : String(error),
        });
        try {
          await assertActive?.();
          await this.outboundWebhookEventService.completeBestEffort({
            eventId: prepared.eventId,
            accountId: prepared.envelope.account_id,
            envelope: prepared.envelope,
          });
          await assertActive?.();
        } catch (fallbackError: unknown) {
          await assertActive?.();
          console.error(
            '[OutboundWebhook] Delivery event fallback finalization failed',
            {
              account_id: prepared.envelope.account_id,
              message_id: message.message_id,
              event_id: prepared.eventId,
              error:
                fallbackError instanceof Error
                  ? fallbackError.message
                  : String(fallbackError),
            }
          );
        }
      }
    }
  };

  static statusKafkaKey(
    accountId: string,
    messageId: string,
    workerId?: string
  ): string {
    return MessageStatusPendingService.statusKey(
      accountId,
      messageId,
      workerId
    );
  }

  async updateSummaryByWhatsAppId(
    accountId: string,
    messageId: string,
    patch: MessageSummaryPatch,
    key?: MessageKeyLike,
    workerId?: string,
    assertActive?: StatusMutationGuard,
    providerStatus?: ProviderMessageStatusMetadata
  ): Promise<IChatMessage | null> {
    const normalizedPatch = this.normalizePatch(patch);
    if (!messageId || !accountId || !this.hasPatch(normalizedPatch)) {
      return null;
    }

    await assertActive?.();
    const aliasedMessageId =
      await this.messageStatusPendingService.getInternalMessageIdAlias(
        accountId,
        messageId,
        workerId
      );
    await assertActive?.();

    let message = aliasedMessageId
      ? await this.findMessageByMessageIdWithRetry(
          aliasedMessageId,
          2,
          assertActive
        )
      : null;

    if (!message?.message_id) {
      message = await this.findMessageByWhatsAppIdCached(
        accountId,
        messageId,
        key,
        workerId,
        assertActive
      );
    }

    if (!message?.message_id) {
      return null;
    }

    await assertActive?.();
    await this.messageStatusPendingService.setInternalMessageIdAlias(
      accountId,
      messageId,
      message.message_id,
      workerId
    );
    await assertActive?.();

    return this.applySummaryPatchToMessage(
      accountId,
      messageId,
      message,
      normalizedPatch,
      workerId,
      assertActive,
      providerStatus
    );
  }

  private async applySummaryPatchToMessage(
    accountId: string,
    whatsappMessageId: string,
    message: IChatMessage,
    normalizedPatch: MessageSummaryPatch,
    workerId?: string,
    assertActive?: StatusMutationGuard,
    providerStatus?: ProviderMessageStatusMetadata
  ): Promise<IChatMessage | null> {
    if (!message.message_id) {
      return null;
    }

    await assertActive?.();
    const fallbackSummary =
      this.mergeSummary(message.summary, normalizedPatch) ??
      this.normalizeSummaryState(message.summary);
    const isOutboundMessage = this.isOutboundMessage(message);
    const positiveDeliveryStatus = isOutboundMessage
      ? this.resolvePositiveDeliveryStatus(fallbackSummary)
      : null;
    const fallbackMessage: IChatMessage = {
      ...message,
      summary: fallbackSummary,
      delivery_status: positiveDeliveryStatus ?? message.delivery_status,
      provider_error_code:
        positiveDeliveryStatus !== null ? null : message.provider_error_code,
      provider_status_at:
        providerStatus?.occurredAt ?? message.provider_status_at,
    };
    const deliveryEventTypes = isOutboundMessage
      ? this.resolveDeliveryEventTypes(normalizedPatch, message.summary)
      : [];
    const preparedWebhookEvents = assertActive
      ? await this.prepareDeliveryWebhookEvents(
          fallbackMessage,
          deliveryEventTypes,
          'message_status',
          assertActive
        )
      : await this.prepareDeliveryWebhookEvents(
          fallbackMessage,
          deliveryEventTypes,
          'message_status'
        );

    const channelAccountId = message.account?.id ?? accountId;

    await assertActive?.();
    const mutationOutcome = await this.updateSummaryAtomicallyWithLock(
      message.message_id,
      message.summary,
      normalizedPatch,
      5,
      preparedWebhookEvents.map(({ prepared }) => prepared.eventId),
      assertActive,
      positiveDeliveryStatus,
      providerStatus
    );
    if (mutationOutcome === 'failed' || mutationOutcome === 'not_found') {
      return null;
    }

    if (mutationOutcome === 'noop') {
      await assertActive?.();
      await this.invalidateMessageCache(
        accountId,
        whatsappMessageId,
        workerId,
        assertActive
      );
      const canonicalMessage =
        await this.findMessageByMessageIdForWebhookConfirmation(
          message.message_id,
          assertActive
        );
      const confirmedWebhookEvents = canonicalMessage
        ? preparedWebhookEvents.filter(({ prepared }) =>
            canonicalMessage.outbound_webhook_event_ids?.includes(
              prepared.eventId
            )
          )
        : [];
      if (canonicalMessage && confirmedWebhookEvents.length > 0) {
        await assertActive?.();
        await this.completeDeliveryWebhookEvents(
          canonicalMessage,
          confirmedWebhookEvents,
          'message_status',
          assertActive
        );
      }

      return canonicalMessage ?? fallbackMessage;
    }

    await assertActive?.();
    await this.invalidateMessageCache(
      accountId,
      whatsappMessageId,
      workerId,
      assertActive
    );

    const canonicalMessage =
      await this.findMessageByMessageIdForWebhookConfirmation(
        message.message_id,
        assertActive
      );
    if (preparedWebhookEvents.length > 0 && !canonicalMessage) {
      console.warn('[OutboundWebhook] Delivery confirmation deferred', {
        account_id: channelAccountId,
        message_id: message.message_id,
      });
    }
    const confirmedWebhookEvents = canonicalMessage
      ? preparedWebhookEvents.filter(({ prepared }) =>
          canonicalMessage.outbound_webhook_event_ids?.includes(
            prepared.eventId
          )
        )
      : [];
    const publishedMessage: IChatMessage = canonicalMessage
      ? {
          ...canonicalMessage,
          summary:
            this.mergeSummary(canonicalMessage.summary, normalizedPatch) ??
            this.normalizeSummaryState(canonicalMessage.summary),
        }
      : fallbackMessage;

    if (canonicalMessage) {
      await assertActive?.();
      if (assertActive) {
        await this.completeDeliveryWebhookEvents(
          publishedMessage,
          confirmedWebhookEvents,
          'message_status',
          assertActive
        );
      } else {
        await this.completeDeliveryWebhookEvents(
          publishedMessage,
          confirmedWebhookEvents,
          'message_status'
        );
      }
    }

    await assertActive?.();
    await this.publishCentrifugoImmediate(
      chatAccountCentrifugo(channelAccountId),
      publishedMessage,
      channelAccountId,
      assertActive
    );

    return publishedMessage;
  }

  async markMessageAsNotSent(
    accountId: string,
    messageId: string,
    assertActive?: StatusMutationGuard,
    deliveryStatus: 'failed' | 'ambiguous' = 'failed',
    providerStatus?: ProviderMessageStatusMetadata
  ): Promise<IChatMessage | null> {
    if (!accountId || !messageId) {
      return null;
    }

    const existingMessage = await this.findMessageByMessageIdWithRetry(
      messageId,
      5,
      assertActive
    );
    if (
      !existingMessage?.message_id ||
      existingMessage.account?.id !== accountId
    ) {
      return null;
    }

    const currentSummary = this.normalizeSummaryState(existingMessage.summary);
    if (
      currentSummary.is_delivered ||
      currentSummary.is_seen ||
      existingMessage.delivery_status === 'delivered' ||
      existingMessage.delivery_status === 'read' ||
      (deliveryStatus === 'ambiguous' && currentSummary.is_sent)
    ) {
      return existingMessage;
    }

    const intendedFailedMessage: IChatMessage = {
      ...existingMessage,
      delivery_status: deliveryStatus,
      summary: this.forceFailedSummary(existingMessage.summary),
      provider_error_code: providerStatus?.errorCode ?? null,
      provider_status_at:
        providerStatus?.occurredAt ?? existingMessage.provider_status_at,
    };
    const deliveryEventTypes =
      this.isOutboundMessage(existingMessage) &&
      existingMessage.summary?.is_sent_to_internal !== false
        ? (['message.delivery.failed'] as const)
        : [];
    const preparedWebhookEvents = assertActive
      ? await this.prepareDeliveryWebhookEvents(
          intendedFailedMessage,
          deliveryEventTypes,
          'message_status',
          assertActive
        )
      : await this.prepareDeliveryWebhookEvents(
          intendedFailedMessage,
          deliveryEventTypes,
          'message_status'
        );

    const mutationOutcome = await this.withStatusMutationLock(
      existingMessage.message_id,
      5,
      (assertLeaseActive) =>
        this.markSummaryAsFailedAtomically(
          existingMessage.message_id,
          preparedWebhookEvents.map(({ prepared }) => prepared.eventId),
          deliveryStatus,
          providerStatus,
          assertLeaseActive
        ),
      assertActive
    );
    if (mutationOutcome === 'failed' || mutationOutcome === 'not_found') {
      return null;
    }

    const canonicalMessage =
      await this.findMessageByMessageIdForWebhookConfirmation(
        existingMessage.message_id,
        assertActive
      );
    if (preparedWebhookEvents.length > 0 && !canonicalMessage) {
      console.warn('[OutboundWebhook] Delivery confirmation deferred', {
        account_id: existingMessage.account?.id ?? accountId,
        message_id: existingMessage.message_id,
      });
    }
    const confirmedWebhookEvents = canonicalMessage
      ? preparedWebhookEvents.filter(({ prepared }) =>
          canonicalMessage.outbound_webhook_event_ids?.includes(
            prepared.eventId
          )
        )
      : [];
    const channelAccountId =
      canonicalMessage?.account?.id ?? existingMessage.account?.id ?? accountId;

    const fallbackSummary = this.forceFailedSummary(existingMessage.summary);
    const fallbackMessage: IChatMessage = {
      ...existingMessage,
      delivery_status: deliveryStatus,
      summary: fallbackSummary,
      provider_error_code: providerStatus?.errorCode ?? null,
      provider_status_at:
        providerStatus?.occurredAt ?? existingMessage.provider_status_at,
    };

    const canonicalSummary = canonicalMessage
      ? this.normalizeSummaryState(canonicalMessage.summary)
      : null;
    const canonicalHasPositiveStatus =
      canonicalSummary?.is_sent === true ||
      canonicalSummary?.is_delivered === true ||
      canonicalSummary?.is_seen === true;
    const publishedMessage = canonicalMessage
      ? canonicalHasPositiveStatus
        ? canonicalMessage
        : ({
            ...canonicalMessage,
            delivery_status: deliveryStatus,
            summary: this.forceFailedSummary(canonicalMessage.summary),
            provider_error_code: providerStatus?.errorCode ?? null,
            provider_status_at:
              providerStatus?.occurredAt ?? canonicalMessage.provider_status_at,
          } as IChatMessage)
      : fallbackMessage;

    if (mutationOutcome === 'noop') {
      if (canonicalMessage && confirmedWebhookEvents.length > 0) {
        await assertActive?.();
        await this.completeDeliveryWebhookEvents(
          publishedMessage,
          confirmedWebhookEvents,
          'message_status',
          assertActive
        );
      }
      return publishedMessage;
    }

    if (canonicalMessage) {
      await assertActive?.();
      if (assertActive) {
        await this.completeDeliveryWebhookEvents(
          publishedMessage,
          confirmedWebhookEvents,
          'message_status',
          assertActive
        );
      } else {
        await this.completeDeliveryWebhookEvents(
          publishedMessage,
          confirmedWebhookEvents,
          'message_status'
        );
      }
    }

    await assertActive?.();
    await this.publishCentrifugoImmediate(
      chatAccountCentrifugo(channelAccountId),
      publishedMessage,
      channelAccountId,
      assertActive
    );

    return publishedMessage;
  }

  async markMessageAsNotSentByWhatsAppId(
    accountId: string,
    whatsappMessageId: string,
    key?: MessageKeyLike,
    workerId?: string,
    assertActive?: StatusMutationGuard,
    deliveryStatus: 'failed' | 'ambiguous' = 'failed',
    providerStatus?: ProviderMessageStatusMetadata
  ): Promise<IChatMessage | null> {
    if (!accountId || !whatsappMessageId) {
      return null;
    }

    await assertActive?.();
    const aliasedMessageId =
      await this.messageStatusPendingService.getInternalMessageIdAlias(
        accountId,
        whatsappMessageId,
        workerId
      );
    await assertActive?.();

    let existingMessage = aliasedMessageId
      ? await this.findMessageByMessageIdWithRetry(
          aliasedMessageId,
          2,
          assertActive
        )
      : null;

    if (!existingMessage?.message_id) {
      existingMessage = await this.findMessageByWhatsAppIdCached(
        accountId,
        whatsappMessageId,
        key,
        workerId,
        assertActive
      );
    }

    if (!existingMessage?.message_id) {
      return null;
    }

    await assertActive?.();
    await this.messageStatusPendingService.setInternalMessageIdAlias(
      accountId,
      whatsappMessageId,
      existingMessage.message_id,
      workerId
    );
    await assertActive?.();

    return this.markMessageAsNotSent(
      accountId,
      existingMessage.message_id,
      assertActive,
      deliveryStatus,
      providerStatus
    );
  }

  async isMessageAlreadySentByMessageId(
    accountId: string,
    messageId: string
  ): Promise<boolean> {
    const normalizedAccountId = accountId?.trim();
    const normalizedMessageId = messageId?.trim();
    if (!normalizedAccountId || !normalizedMessageId) {
      return false;
    }

    const existingMessage = await this.findMessageByMessageIdWithRetry(
      normalizedMessageId,
      3
    );
    if (
      !existingMessage?.message_id ||
      existingMessage.account?.id !== normalizedAccountId
    ) {
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
    message: IChatMessage,
    expectedAccountId: string,
    assertActive?: StatusMutationGuard
  ): Promise<void> {
    if (
      !messageBelongsToChatAndAccount(
        message,
        message.chat_id,
        expectedAccountId
      )
    ) {
      return;
    }

    try {
      await assertActive?.();
      await this.centrifugoService.publishSubImmediate(
        channel,
        message,
        assertActive
      );
    } catch {
      if (assertActive) {
        await assertActive();
        return;
      }
      this.enqueueCentrifugoRetry(channel, message);
    }
  }

  private readonly centrifugoRetryKey = 'centrifugo:status:retry:v2';
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

  private resolvePositiveDeliveryStatus(
    summary: IChatMessage['summary'] | null | undefined
  ): PositiveDeliveryStatus | null {
    const normalized = this.normalizeSummaryState(summary);
    if (normalized.is_seen) return 'read';
    if (normalized.is_delivered) return 'delivered';
    if (normalized.is_sent) return 'sent';
    return null;
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

  private async waitForRetry(
    delayMs: number,
    assertActive?: StatusMutationGuard
  ): Promise<void> {
    await assertActive?.();
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    await assertActive?.();
  }

  private async findMessageByWhatsAppId(
    accountId: string,
    messageId: string,
    key?: MessageKeyLike,
    workerId?: string,
    assertActive?: StatusMutationGuard
  ): Promise<WhatsAppMessageLookupResult> {
    await assertActive?.();
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

      const must: Record<string, unknown>[] = [
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
      ];
      const normalizedWorkerId = workerId?.trim();
      if (normalizedWorkerId) {
        must.push({
          bool: {
            should: [
              { term: { 'worker.id': normalizedWorkerId } },
              { term: { 'worker.id.keyword': normalizedWorkerId } },
            ],
            minimum_should_match: 1,
          },
        });
      }

      const queryElastic = {
        size: 1,
        query: {
          bool: {
            must,
          },
        },
      };

      const result = await this.elasticDatabaseService.select<IChatMessage>(
        EElasticIndex.message,
        queryElastic
      );
      await assertActive?.();

      const hit = result?.hits?.hits?.[0] as
        ElasticHit<IChatMessage> | undefined;
      const message = hit?._source ?? null;
      this.recordCircuitSuccess();
      return {
        candidateCount: idCandidates.length,
        message,
      };
    } catch (error) {
      await assertActive?.();
      this.recordCircuitFailure();
      throw error;
    }
  }

  private async findMessageByWhatsAppIdCached(
    accountId: string,
    messageId: string,
    key?: MessageKeyLike,
    workerId?: string,
    assertActive?: StatusMutationGuard
  ): Promise<IChatMessage | null> {
    const cacheKey = this.messageCacheKey(accountId, messageId, workerId);

    try {
      await assertActive?.();
      const cached = await this.redis.get(cacheKey);
      await assertActive?.();
      if (cached) {
        return JSON.parse(cached) as IChatMessage;
      }
    } catch {
      await assertActive?.();
    }

    const message = await this.findMessageByWhatsAppIdWithRetry(
      accountId,
      messageId,
      key,
      workerId,
      5,
      assertActive
    );

    if (message) {
      try {
        if (message.message_id) {
          await assertActive?.();
          await this.messageStatusPendingService.setInternalMessageIdAlias(
            accountId,
            messageId,
            message.message_id,
            workerId
          );
          await assertActive?.();
        }
        await assertActive?.();
        await this.redis.setex(
          cacheKey,
          this.cacheTtlSeconds,
          JSON.stringify(message)
        );
        await assertActive?.();
      } catch {
        await assertActive?.();
      }
    }

    return message;
  }

  private async invalidateMessageCache(
    accountId: string,
    messageId: string,
    workerId?: string,
    assertActive?: StatusMutationGuard
  ): Promise<void> {
    const cacheKey = this.messageCacheKey(accountId, messageId, workerId);
    try {
      await assertActive?.();
      await this.redis.del(cacheKey);
      await assertActive?.();
    } catch {
      await assertActive?.();
    }
  }

  private messageCacheKey(
    accountId: string,
    messageId: string,
    workerId?: string
  ): string {
    const scope = MessageStatusPendingService.statusKey(
      accountId,
      messageId,
      workerId
    );
    return `${this.messageCachePrefix}${scope}`;
  }

  private async updateSummaryAtomicallyWithLock(
    messageId: string,
    currentSummary: IChatMessage['summary'],
    patch: MessageSummaryPatch,
    maxRetries = 5,
    outboundWebhookEventIds: readonly string[] = [],
    assertActive?: StatusMutationGuard,
    deliveryStatus: PositiveDeliveryStatus | null = null,
    providerStatus?: ProviderMessageStatusMetadata
  ): Promise<StatusMutationOutcome> {
    return this.withStatusMutationLock(
      messageId,
      maxRetries,
      (assertLeaseActive) =>
        this.updateSummaryAtomicallyWithRetry(
          messageId,
          currentSummary,
          patch,
          3,
          outboundWebhookEventIds,
          assertLeaseActive,
          deliveryStatus,
          providerStatus
        ),
      assertActive
    );
  }

  private async withStatusMutationLock(
    messageId: string,
    maxRetries: number,
    operation: (
      assertLeaseActive: StatusMutationGuard
    ) => Promise<StatusMutationOutcome>,
    assertActive?: StatusMutationGuard
  ): Promise<StatusMutationOutcome> {
    const lockKey = `${this.lockPrefix}${messageId}`;
    const lockTtlMs = this.lockTtlSeconds * 1000;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      let lockToken: string | null = null;
      try {
        await assertActive?.();
        const candidateToken = randomUUID();
        const lockAcquired = await this.redis.set(
          lockKey,
          candidateToken,
          'PX',
          lockTtlMs,
          'NX'
        );
        if (lockAcquired === 'OK') {
          lockToken = candidateToken;
        }
        await assertActive?.();

        if (!lockToken) {
          if (attempt < maxRetries - 1) {
            const backoffMs = Math.min(100 * Math.pow(2, attempt), 1000);
            await this.waitForRetry(backoffMs, assertActive);
            continue;
          }
          return 'failed';
        }
        const acquiredToken = lockToken;
        let leaseError: Error | null = null;
        let leaseValidUntil = performance.now() + lockTtlMs;
        let refreshRunning = false;
        const assertLeaseActive = async (): Promise<void> => {
          await assertActive?.();
          if (!leaseError && performance.now() >= leaseValidUntil) {
            leaseError = new MessageStatusMutationLeaseLostError();
          }
          if (leaseError) {
            throw leaseError;
          }
          await assertActive?.();
        };

        const refreshInterval = setInterval(
          () => {
            if (refreshRunning || leaseError) {
              return;
            }

            refreshRunning = true;
            void (async () => {
              try {
                await assertLeaseActive();
                const refreshed = await this.redis.eval(
                  REFRESH_STATUS_LOCK_SCRIPT,
                  1,
                  lockKey,
                  acquiredToken,
                  String(lockTtlMs)
                );
                if (Number(refreshed) !== 1) {
                  throw new MessageStatusMutationLeaseLostError();
                }
                leaseValidUntil = performance.now() + lockTtlMs;
                await assertActive?.();
              } catch (error) {
                leaseError =
                  error instanceof Error
                    ? error
                    : new MessageStatusMutationLeaseLostError();
                clearInterval(refreshInterval);
              } finally {
                refreshRunning = false;
              }
            })();
          },
          (this.lockTtlSeconds * 1000) / 3
        );
        refreshInterval.unref?.();

        try {
          await assertLeaseActive();
          const result = await operation(assertLeaseActive);
          await assertLeaseActive();
          return result;
        } finally {
          clearInterval(refreshInterval);
          await this.releaseStatusLock(lockKey, acquiredToken);
          lockToken = null;
        }
      } catch (error) {
        if (lockToken) {
          await this.releaseStatusLock(lockKey, lockToken);
          lockToken = null;
        }

        await assertActive?.();
        if (error instanceof MessageStatusMutationLeaseLostError) {
          throw error;
        }
        if (attempt < maxRetries - 1) {
          const backoffMs = Math.min(100 * Math.pow(2, attempt), 1000);
          await this.waitForRetry(backoffMs, assertActive);
          continue;
        }
        return 'failed';
      }
    }

    return 'failed';
  }

  private async releaseStatusLock(
    lockKey: string,
    lockToken: string
  ): Promise<void> {
    try {
      await this.redis.eval(RELEASE_STATUS_LOCK_SCRIPT, 1, lockKey, lockToken);
    } catch {}
  }

  private async findMessageByWhatsAppIdWithRetry(
    accountId: string,
    messageId: string,
    key?: MessageKeyLike,
    workerId?: string,
    maxRetries = 5,
    assertActive?: StatusMutationGuard
  ): Promise<IChatMessage | null> {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      await assertActive?.();
      const result = await this.findMessageByWhatsAppId(
        accountId,
        messageId,
        key,
        workerId,
        assertActive
      );
      await assertActive?.();
      if (result.message?.message_id) {
        return result.message;
      }

      if (attempt < maxRetries - 1) {
        const backoffMs = Math.min(100 * Math.pow(2, attempt), 1000);
        await this.waitForRetry(backoffMs, assertActive);
      }
    }

    return null;
  }

  private async findMessageByMessageIdWithRetry(
    messageId: string,
    maxRetries = 5,
    assertActive?: StatusMutationGuard
  ): Promise<IChatMessage | null> {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      await assertActive?.();
      const message = await this.findMessageByMessageId(
        messageId,
        assertActive
      );
      await assertActive?.();
      if (message?.message_id) {
        return message;
      }

      if (attempt < maxRetries - 1) {
        const backoffMs = Math.min(100 * Math.pow(2, attempt), 1000);
        await this.waitForRetry(backoffMs, assertActive);
      }
    }

    return null;
  }

  private async findMessageByMessageIdForWebhookConfirmation(
    messageId: string,
    assertActive?: StatusMutationGuard
  ): Promise<IChatMessage | null> {
    try {
      return await this.findMessageByMessageIdWithRetry(
        messageId,
        5,
        assertActive
      );
    } catch (error: unknown) {
      await assertActive?.();
      console.warn('[OutboundWebhook] Delivery confirmation read failed', {
        message_id: messageId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private async updateSummaryAtomicallyWithRetry(
    messageId: string,
    currentSummary: IChatMessage['summary'],
    patch: MessageSummaryPatch,
    maxRetries = 5,
    outboundWebhookEventIds: readonly string[] = [],
    assertActive?: StatusMutationGuard,
    deliveryStatus: PositiveDeliveryStatus | null = null,
    providerStatus?: ProviderMessageStatusMetadata
  ): Promise<StatusMutationOutcome> {
    return this.attemptUpdateWithRetry(
      messageId,
      currentSummary,
      patch,
      0,
      maxRetries,
      outboundWebhookEventIds,
      assertActive,
      deliveryStatus,
      providerStatus
    );
  }

  private async attemptUpdateWithRetry(
    messageId: string,
    summary: IChatMessage['summary'],
    patch: MessageSummaryPatch,
    attempt: number,
    maxRetries: number,
    outboundWebhookEventIds: readonly string[],
    assertActive?: StatusMutationGuard,
    deliveryStatus: PositiveDeliveryStatus | null = null,
    providerStatus?: ProviderMessageStatusMetadata
  ): Promise<StatusMutationOutcome> {
    await assertActive?.();
    if (attempt >= maxRetries) {
      return 'failed';
    }

    const mutationOutcome = await this.updateSummaryAtomically(
      messageId,
      summary,
      patch,
      outboundWebhookEventIds,
      assertActive,
      deliveryStatus,
      providerStatus
    );
    await assertActive?.();
    if (mutationOutcome !== 'failed') {
      return mutationOutcome;
    }

    if (attempt >= maxRetries - 1) {
      return 'failed';
    }

    const backoffMs = Math.min(100 * Math.pow(2, attempt), 1000);
    await this.waitForRetry(backoffMs, assertActive);

    const refreshedMessage = await this.findMessageByMessageId(
      messageId,
      assertActive
    );
    await assertActive?.();
    const nextSummary = refreshedMessage?.summary ?? summary;

    return this.attemptUpdateWithRetry(
      messageId,
      nextSummary,
      patch,
      attempt + 1,
      maxRetries,
      outboundWebhookEventIds,
      assertActive,
      deliveryStatus,
      providerStatus
    );
  }

  private async findMessageByMessageId(
    messageId: string,
    assertActive?: StatusMutationGuard
  ): Promise<IChatMessage | null> {
    await assertActive?.();
    if (this.isCircuitOpen()) {
      throw new Error('Elasticsearch circuit breaker is open');
    }

    try {
      const message = (await this.elasticDatabaseService.view(
        EElasticIndex.message,
        messageId
      )) as IChatMessage | null;
      await assertActive?.();
      this.recordCircuitSuccess();
      return message;
    } catch (error) {
      await assertActive?.();
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
    patch: MessageSummaryPatch,
    outboundWebhookEventIds: readonly string[] = [],
    deliveryStatus: PositiveDeliveryStatus | null = null,
    providerStatus?: ProviderMessageStatusMetadata
  ): MessageSummaryScriptParams {
    return {
      baseline,
      patch_is_sent: patch.is_sent ?? null,
      patch_is_delivered: patch.is_delivered ?? null,
      patch_is_seen: patch.is_seen ?? null,
      delivery_status: deliveryStatus,
      provider_error_code: providerStatus?.errorCode ?? null,
      provider_status_at: providerStatus?.occurredAt ?? null,
      outbound_webhook_event_ids: [...new Set(outboundWebhookEventIds)],
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

      def deliveryRanks = [
        'queued': 0,
        'ambiguous': 1,
        'sent': 2,
        'failed': 3,
        'delivered': 4,
        'read': 5
      ];
      def currentDeliveryStatus = ctx._source.containsKey('delivery_status')
        ? ctx._source.delivery_status
        : null;
      def currentDeliveryRank = currentDeliveryStatus != null &&
        deliveryRanks.containsKey(currentDeliveryStatus)
          ? deliveryRanks[currentDeliveryStatus]
          : 0;
      if (summary.containsKey('is_seen') && summary.is_seen == true) {
        currentDeliveryRank = Math.max(currentDeliveryRank, 5);
      } else if (
        summary.containsKey('is_delivered') && summary.is_delivered == true
      ) {
        currentDeliveryRank = Math.max(currentDeliveryRank, 4);
      } else if (summary.containsKey('is_sent') && summary.is_sent == true) {
        currentDeliveryRank = Math.max(currentDeliveryRank, 2);
      } else if (
        currentDeliveryStatus == null &&
        summary.containsKey('is_sent_to_internal') &&
        summary.is_sent_to_internal == false
      ) {
        currentDeliveryRank = Math.max(currentDeliveryRank, 3);
      }
      def nextDeliveryRank = params.delivery_status != null &&
        deliveryRanks.containsKey(params.delivery_status)
          ? deliveryRanks[params.delivery_status]
          : 0;
      if (params.delivery_status != null && nextDeliveryRank < currentDeliveryRank) {
        ctx.op = 'noop';
        return;
      }
      
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
      
      if (
        params.patch_is_sent == true ||
        params.patch_is_delivered == true ||
        params.patch_is_seen == true
      ) {
        if (
          !summary.containsKey('is_sent_to_internal') ||
          summary.is_sent_to_internal != true
        ) {
          summary.is_sent_to_internal = true;
          shouldUpdate = true;
        }
      } else if (!summary.containsKey('is_sent_to_internal')) {
        summary.is_sent_to_internal = params.baseline.is_sent_to_internal;
        shouldUpdate = true;
      }

      if (params.delivery_status != null) {
        if (currentDeliveryStatus != params.delivery_status) {
          ctx._source.delivery_status = params.delivery_status;
          shouldUpdate = true;
        }

        if (ctx._source.containsKey('provider_error_code')) {
          ctx._source.remove('provider_error_code');
          shouldUpdate = true;
        }
        if (
          params.provider_status_at != null &&
          (!ctx._source.containsKey('provider_status_at') ||
            ctx._source.provider_status_at != params.provider_status_at)
        ) {
          ctx._source.provider_status_at = params.provider_status_at;
          shouldUpdate = true;
        }
      }

      if (params.outbound_webhook_event_ids != null) {
        if (ctx._source.outbound_webhook_event_ids == null) {
          ctx._source.outbound_webhook_event_ids = [];
        }
        for (def eventId : params.outbound_webhook_event_ids) {
          if (!ctx._source.outbound_webhook_event_ids.contains(eventId)) {
            ctx._source.outbound_webhook_event_ids.add(eventId);
            shouldUpdate = true;
          }
        }
        while (ctx._source.outbound_webhook_event_ids.size() > 256) {
          ctx._source.outbound_webhook_event_ids.remove(0);
        }
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
      def deliveryRanks = [
        'queued': 0,
        'ambiguous': 1,
        'sent': 2,
        'failed': 3,
        'delivered': 4,
        'read': 5
      ];
      def currentDeliveryStatus = ctx._source.containsKey('delivery_status')
        ? ctx._source.delivery_status
        : null;
      def currentDeliveryRank = currentDeliveryStatus != null &&
        deliveryRanks.containsKey(currentDeliveryStatus)
          ? deliveryRanks[currentDeliveryStatus]
          : 0;
      if (summary.containsKey('is_seen') && summary.is_seen == true) {
        currentDeliveryRank = Math.max(currentDeliveryRank, 5);
      } else if (
        summary.containsKey('is_delivered') && summary.is_delivered == true
      ) {
        currentDeliveryRank = Math.max(currentDeliveryRank, 4);
      } else if (summary.containsKey('is_sent') && summary.is_sent == true) {
        currentDeliveryRank = Math.max(currentDeliveryRank, 2);
      } else if (
        currentDeliveryStatus == null &&
        summary.containsKey('is_sent_to_internal') &&
        summary.is_sent_to_internal == false
      ) {
        currentDeliveryRank = Math.max(currentDeliveryRank, 3);
      }
      def nextDeliveryRank = deliveryRanks[params.delivery_status];
      if (nextDeliveryRank == null || currentDeliveryRank > nextDeliveryRank) {
        ctx.op = 'noop';
        return;
      }
      def changed = false;

      if (!summary.containsKey('is_sent') || summary.is_sent != false) {
        summary.is_sent = false;
        changed = true;
      }

      if (params.provider_error_code != null) {
        if (
          !ctx._source.containsKey('provider_error_code') ||
          ctx._source.provider_error_code != params.provider_error_code
        ) {
          ctx._source.provider_error_code = params.provider_error_code;
          changed = true;
        }
      } else if (ctx._source.containsKey('provider_error_code')) {
        ctx._source.remove('provider_error_code');
        changed = true;
      }

      if (
        params.provider_status_at != null &&
        (!ctx._source.containsKey('provider_status_at') ||
          ctx._source.provider_status_at != params.provider_status_at)
      ) {
        ctx._source.provider_status_at = params.provider_status_at;
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

      if (
        !ctx._source.containsKey('delivery_status') ||
        ctx._source.delivery_status != params.delivery_status
      ) {
        ctx._source.delivery_status = params.delivery_status;
        changed = true;
      }

      if (params.outbound_webhook_event_ids != null) {
        if (ctx._source.outbound_webhook_event_ids == null) {
          ctx._source.outbound_webhook_event_ids = [];
        }
        for (def eventId : params.outbound_webhook_event_ids) {
          if (!ctx._source.outbound_webhook_event_ids.contains(eventId)) {
            ctx._source.outbound_webhook_event_ids.add(eventId);
            changed = true;
          }
        }
        while (ctx._source.outbound_webhook_event_ids.size() > 256) {
          ctx._source.outbound_webhook_event_ids.remove(0);
        }
      }

      if (!changed) {
        ctx.op = 'noop';
      }
    `;
  }

  private async markSummaryAsFailedAtomically(
    messageId: string,
    outboundWebhookEventIds: readonly string[] = [],
    deliveryStatus: 'failed' | 'ambiguous' = 'failed',
    providerStatus?: ProviderMessageStatusMetadata,
    assertActive?: StatusMutationGuard
  ): Promise<StatusMutationOutcome> {
    await assertActive?.();
    if (this.isCircuitOpen()) {
      throw new Error('Elasticsearch circuit breaker is open');
    }

    const scriptSource = this.buildMarkSummaryAsFailedScriptSource();
    try {
      await assertActive?.();
      const result = await this.elasticDatabaseService.updateWithScriptOCC(
        EElasticIndex.message,
        messageId,
        {
          source: scriptSource,
          params: {
            outbound_webhook_event_ids: [...new Set(outboundWebhookEventIds)],
            delivery_status: deliveryStatus,
            provider_error_code: providerStatus?.errorCode ?? null,
            provider_status_at: providerStatus?.occurredAt ?? null,
          },
        },
        {
          maxRetries: 5,
          assertActive,
        }
      );
      await assertActive?.();
      this.recordCircuitSuccess();
      if (result === 'updated' || result === 'created') {
        return 'updated';
      }
      if (result === 'noop') {
        return 'noop';
      }
      if (result === 'not_found') {
        return 'not_found';
      }
      return 'failed';
    } catch (error) {
      await assertActive?.();
      this.recordCircuitFailure();
      throw error;
    }
  }

  private async updateSummaryAtomically(
    messageId: string,
    currentSummary: IChatMessage['summary'],
    patch: MessageSummaryPatch,
    outboundWebhookEventIds: readonly string[] = [],
    assertActive?: StatusMutationGuard,
    deliveryStatus: PositiveDeliveryStatus | null = null,
    providerStatus?: ProviderMessageStatusMetadata
  ): Promise<StatusMutationOutcome> {
    await assertActive?.();
    if (this.isCircuitOpen()) {
      throw new Error('Elasticsearch circuit breaker is open');
    }

    const baseline = this.buildMessageSummaryBaseline(currentSummary);
    const normalizedPatch = this.normalizePatch(patch);
    const scriptParams = this.buildMessageSummaryScriptParams(
      baseline,
      normalizedPatch,
      outboundWebhookEventIds,
      deliveryStatus,
      providerStatus
    );
    const scriptSource = this.buildMessageSummaryScriptSource();

    try {
      await assertActive?.();
      const result = await this.elasticDatabaseService.updateWithScriptOCC(
        EElasticIndex.message,
        messageId,
        {
          source: scriptSource,
          params: scriptParams,
        },
        {
          maxRetries: 5,
          assertActive,
        }
      );

      await assertActive?.();
      this.recordCircuitSuccess();
      if (result === 'updated' || result === 'created') {
        return 'updated';
      }
      if (result === 'noop') {
        return 'noop';
      }
      if (result === 'not_found') {
        return 'not_found';
      }
      return 'failed';
    } catch {
      await assertActive?.();
      this.recordCircuitFailure();
      return 'failed';
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
