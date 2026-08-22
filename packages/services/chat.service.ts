import { inject, injectable } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';
import { ElasticDatabaseService } from './elasticDatabase.service';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { IChatMessage } from '@core/common/interfaces/IChatMessage';
import { mensageMappings } from '@core/mappings/mensage.mappings';
import { IChat } from '@core/common/interfaces/IChat';
import { chatMappings } from '@core/mappings/chat.mappings';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { EMessageType } from '@core/common/enums/EMessageType';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import { WorkerConfigForChatViewerRepository } from '@core/repositories/chat/WorkerConfigForChatViewer.repository';
import { ViewWorkerConfigForChatResponse } from '@core/schema/chat/viewWorkerConfigForChat/response.schema';
import { ChatQuickMessageTemplatesListerRepository } from '@core/repositories/chat/ChatQuickMessageTemplatesLister.repository';
import { ListQuickMessageTemplatesResponse } from '@core/schema/chat/listQuickMessageTemplates/response.schema';
import { ListQuickMessageTemplatesRequest } from '@core/schema/chat/listQuickMessageTemplates/request.schema';
import {
  ChatSummaryBaseline,
  ChatSummaryAtomicUpdateParams,
} from '@core/common/interfaces/IChatSummaryUpdate';
import {
  ChatPatch,
  ChatPatchOptions,
} from '@core/common/interfaces/IChatPatch';
import {
  createChatCacheKey,
  createChatCacheKeyChatId,
} from '@core/common/functions/createCacheKey';
import Redis from 'ioredis';
import { safeRedisGet } from '@core/plugins/redis';
import { generateProtocol } from '@core/common/functions/generateProtocol';
import { isChatParticipant } from '@core/common/functions/chatParticipants';
import { normalizeExternalAdReplyMediaType } from '@core/common/functions/normalizeExternalAdReplyMediaType';
import {
  buildMissingChatMessageKeyPatch,
  normalizeChatIdentity,
  type ChatIdentityInput,
} from '@core/common/functions/chatIdentity';
import {
  CHATBOT_STATUSES,
  HUMAN_ATTENDANCE_STATUSES,
  isChatbotStatus,
  isHumanAttendanceStatus,
} from '@core/common/functions/chatStatus';
import type { OutboundWebhookEventType } from '@core/common/constants/outboundWebhookEvents';
import {
  buildOutboundWebhookEnvelope,
  normalizeOutboundWebhookChannelIds,
  sanitizeOutboundWebhookValue,
  serializePublicChat,
  serializePublicMessage,
  type OutboundWebhookActor,
  type OutboundWebhookJsonValue,
} from '@core/common/functions/outboundWebhookPayload';
import {
  OutboundWebhookEventService,
  type PreparedOutboundWebhookEvent,
} from '@core/services/outboundWebhookEvent.service';
import { getKafkaDispatchGuard } from '@core/common/functions/kafkaDispatchFenceContext';
import { getPhoneFromJid } from '@core/common/functions/getPhoneFromJid';
import { hasProtocolTag } from '@core/common/functions/hasProtocolTag';
import { replaceMessageTags } from '@core/common/functions/replaceMessageTags';
import { workerErrorDiagnostics } from '@core/common/functions/workerErrorDiagnostics';
import type { WorkerCommandPublishReceiptV1 } from '@core/common/interfaces/IWorkerCommandEnvelope';

type ElasticHit<T> = {
  _id?: string;
  _source?: T;
};

type ChatProtocolType = 'protocol_ura' | 'protocol_start' | 'protocol_transfer';

interface TransferAutomationChatToQueueInput {
  accountId: string;
  chat: IChat;
  worker?: IChat['worker'] | null;
  user?: IChat['user'] | null;
  sector?: IChat['sector'] | null;
  secondaryUsers?: IChat['secondary_users'] | null;
  outboundWebhook?: ChatOutboundWebhookMutation;
  eventEpochMillis?: number;
  eventId?: string;
}

export interface ChatOutboundWebhookMutation {
  eventTypes: readonly OutboundWebhookEventType[];
  idempotencyKey: string;
  source: string;
  previousChat?: IChat | null;
  actor?: OutboundWebhookActor | null;
  changes?: Record<string, unknown>;
  assertActive?: () => void | Promise<void>;
}

export interface MessageOutboundWebhookMutation {
  eventTypes: readonly OutboundWebhookEventType[];
  idempotencyKey: string;
  idempotencyKeyByEventType?: Partial<Record<OutboundWebhookEventType, string>>;
  source: string;
  previousMessage?: IChatMessage | null;
  actor?: OutboundWebhookActor | null;
  changes?: Record<string, unknown>;
  /** Guards a physical inbound mutation and is never derived from content. */
  inboundEventId?: string | null;
  assertActive?: () => void | Promise<void>;
}

export interface MessageMutationPersistenceResult {
  persisted: boolean;
  applied: boolean;
}

interface PreparedChatWebhookEvent {
  eventType: OutboundWebhookEventType;
  prepared: PreparedOutboundWebhookEvent;
}

interface PreparedMessageWebhookEvent {
  eventType: OutboundWebhookEventType;
  prepared: PreparedOutboundWebhookEvent;
}

type ChatPatchPersistenceResult = Awaited<
  ReturnType<ElasticDatabaseService['updateWithScriptOCC']>
>;

interface ChatPatchApplicationResult {
  applied: boolean;
  persistenceResult: ChatPatchPersistenceResult;
}

export interface TransferAutomationChatToQueueResult {
  chat: IChat | null;
  previousChat: IChat | null;
  applied: boolean;
  alreadyHuman: boolean;
}

export interface MutateChatSecondaryUserInput {
  accountId: string;
  chat: IChat;
  operation: 'join' | 'leave';
  user: NonNullable<IChat['user']>;
  outboundWebhook: ChatOutboundWebhookMutation;
}

export interface ReassignPendingOperatorReplyInput {
  accountId: string;
  chat: IChat;
  nextUser: NonNullable<IChat['user']>;
  eventId: string;
  eventEpochMillis: number;
  expectedPrimaryUserId: string;
  expectedAssignmentEventId: string | null;
  expectedAssignmentEpoch: number | null;
  expectedStatusEventId: string | null;
  expectedStatusEpoch: number | null;
  expectedLastMessageId: string | null;
  expectedSummaryRevision: number;
  expectedPendingSince: string;
}

export interface ReassignPendingOperatorReplyResult {
  applied: boolean;
  chat: IChat | null;
}

export interface RenderIncomingCallTemplateInput {
  accountId: string;
  accountName: string;
  callJid?: string | null;
  callPhone?: string | null;
  template: string;
  workerId: string;
  workerName: string;
}

const OPEN_CHAT_STATUSES = [
  EChatStatus.in_chat,
  EChatStatus.queue,
  EChatStatus.ura,
  EChatStatus.ura_output,
  EChatStatus.ura_schedule,
  EChatStatus.ura_webhook,
];

const OUTBOUND_MESSAGE_TYPE_USERS = [
  ETypeUserChat.operator,
  ETypeUserChat.bot,
  ETypeUserChat.system,
] as const;
const OUTBOUND_MESSAGE_TYPE_USER_SET = new Set<ETypeUserChat>(
  OUTBOUND_MESSAGE_TYPE_USERS
);

@injectable()
export class ChatService {
  constructor(
    @inject('Redis') private readonly redis: Redis,
    @inject(ElasticDatabaseService)
    private readonly elasticDatabaseService: ElasticDatabaseService,
    @inject(WorkerConfigForChatViewerRepository)
    private readonly workerConfigForChatViewerRepository: WorkerConfigForChatViewerRepository,
    @inject(ChatQuickMessageTemplatesListerRepository)
    private readonly chatQuickMessageTemplatesListerRepository: ChatQuickMessageTemplatesListerRepository,
    @inject(OutboundWebhookEventService)
    private readonly outboundWebhookEventService: OutboundWebhookEventService | null = null
  ) {}

  /**
   * Resolves an incoming-call template against the canonical open chat.
   * Protocol creation deliberately goes through the same Elasticsearch OCC,
   * Redis cache and outbound-webhook outbox flow used by the service runtime.
   */
  renderIncomingCallTemplate = async (
    input: RenderIncomingCallTemplateInput
  ): Promise<string> => {
    const normalizedPhone =
      input.callPhone?.replaceAll(/\D/gu, '') ||
      getPhoneFromJid(input.callJid, null) ||
      '';

    const chat = normalizedPhone
      ? await this.findOpenChatByIdentityInternal(
          input.accountId,
          input.workerId,
          {
            phone: normalizedPhone,
            remoteJid: input.callJid,
            remoteJidAlt: null,
          },
          true
        )
      : null;

    let protocol: string | null = null;
    if (chat && hasProtocolTag(input.template)) {
      protocol =
        (await this.getOrCreateChatProtocol(
          input.accountId,
          chat.chat_id,
          'protocol_start'
        )) || this.getLatestProtocolByType(chat, 'protocol_start');
    }

    const replacementChat: IChat =
      chat ??
      ({
        chat_id: `incoming_call:${input.workerId}:${normalizedPhone || 'unknown'}`,
        account: {
          id: input.accountId,
          name: input.accountName,
        },
        worker: {
          id: input.workerId,
          name: input.workerName,
        },
        name: null,
        phone: normalizedPhone,
        status: EChatStatus.queue,
        date: new Date().toISOString(),
        user: null,
        sector: null,
        contact: null,
      } satisfies IChat);

    return replaceMessageTags({
      message: input.template,
      chat: replacementChat,
      protocol,
    });
  };

  private buildChatWebhookData(
    chat: IChat,
    changes?: Record<string, unknown>
  ): Record<string, OutboundWebhookJsonValue> {
    const sanitizedChanges = sanitizeOutboundWebhookValue(changes ?? {});
    return {
      chat: serializePublicChat(chat),
      changes:
        sanitizedChanges &&
        !Array.isArray(sanitizedChanges) &&
        typeof sanitizedChanges === 'object'
          ? sanitizedChanges
          : {},
    };
  }

  private resolveChatWebhookChannelIds(
    chat: IChat,
    previousChat?: IChat | null
  ): string[] {
    return normalizeOutboundWebhookChannelIds(
      [previousChat?.worker?.id, chat.worker?.id].filter(
        (channelId): channelId is string => Boolean(channelId)
      )
    );
  }

  private resolveMessageWebhookChannelIds(message: IChatMessage): string[] {
    return normalizeOutboundWebhookChannelIds([message.worker.id]);
  }

  private prepareChatWebhookEvents = async (
    chat: IChat,
    mutation?: ChatOutboundWebhookMutation
  ): Promise<PreparedChatWebhookEvent[]> => {
    const assertActive = mutation?.assertActive ?? getKafkaDispatchGuard();
    await assertActive?.();
    if (
      !this.outboundWebhookEventService ||
      !mutation ||
      mutation.eventTypes.length === 0
    ) {
      return [];
    }

    const preparedEvents: PreparedChatWebhookEvent[] = [];
    try {
      const channelIds = this.resolveChatWebhookChannelIds(
        chat,
        mutation.previousChat
      );
      for (const eventType of [...new Set(mutation.eventTypes)]) {
        await assertActive?.();
        const prepared =
          await this.outboundWebhookEventService.prepareBestEffort({
            accountId: chat.account.id,
            eventType,
            aggregate: { type: 'chat', id: chat.chat_id },
            data: this.buildChatWebhookData(chat, mutation.changes),
            previous: mutation.previousChat
              ? { chat: serializePublicChat(mutation.previousChat) }
              : null,
            source: mutation.source,
            channelIds,
            actor: mutation.actor,
            idempotencyKey: `${mutation.idempotencyKey}:${eventType}`,
          });
        await assertActive?.();
        if (prepared) {
          preparedEvents.push({ eventType, prepared });
        }
      }
      return preparedEvents;
    } catch (error) {
      await assertActive?.();
      console.error('[OutboundWebhook] Chat event preparation failed', {
        account_id: chat.account.id,
        chat_id: chat.chat_id,
        ...workerErrorDiagnostics(error),
      });
      return [];
    }
  };

  private completeChatWebhookEvents = async (
    chat: IChat,
    mutation: ChatOutboundWebhookMutation | undefined,
    preparedEvents: PreparedChatWebhookEvent[]
  ): Promise<void> => {
    if (
      !this.outboundWebhookEventService ||
      !mutation ||
      preparedEvents.length === 0
    ) {
      return;
    }

    const assertActive = mutation.assertActive ?? getKafkaDispatchGuard();
    const appliedEventIds = new Set(
      chat.meta?.outbound_webhook_event_ids ?? []
    );
    const channelIds = this.resolveChatWebhookChannelIds(
      chat,
      mutation.previousChat
    );
    for (const { eventType, prepared } of preparedEvents) {
      if (!appliedEventIds.has(prepared.eventId)) continue;
      try {
        await assertActive?.();
        const envelope = buildOutboundWebhookEnvelope({
          id: prepared.eventId,
          type: eventType,
          occurredAt: prepared.envelope.occurred_at,
          accountId: chat.account.id,
          aggregate: { type: 'chat', id: chat.chat_id },
          data: this.buildChatWebhookData(chat, mutation.changes),
          previous: mutation.previousChat
            ? { chat: serializePublicChat(mutation.previousChat) }
            : null,
          source: mutation.source,
          channelIds,
          actor: mutation.actor,
        });

        await this.outboundWebhookEventService.completeBestEffort({
          eventId: prepared.eventId,
          accountId: chat.account.id,
          envelope,
        });
        await assertActive?.();
      } catch (error: unknown) {
        await assertActive?.();
        console.error('[OutboundWebhook] Chat event finalization failed', {
          account_id: chat.account.id,
          chat_id: chat.chat_id,
          event_id: prepared.eventId,
          ...workerErrorDiagnostics(error),
        });
      }
    }
  };

  private buildMessageWebhookData(
    message: IChatMessage,
    eventType: OutboundWebhookEventType,
    changes?: Record<string, unknown>
  ): Record<string, OutboundWebhookJsonValue> {
    if (eventType.startsWith('message.delivery.')) {
      return {
        message: serializePublicMessage(message),
        delivery_status: eventType.slice('message.delivery.'.length),
      };
    }

    const sanitizedChanges = sanitizeOutboundWebhookValue(changes ?? {});
    return {
      message: serializePublicMessage(message),
      changes:
        sanitizedChanges &&
        !Array.isArray(sanitizedChanges) &&
        typeof sanitizedChanges === 'object'
          ? sanitizedChanges
          : {},
    };
  }

  private prepareMessageWebhookEvents = async (
    message: IChatMessage,
    mutation?: MessageOutboundWebhookMutation
  ): Promise<PreparedMessageWebhookEvent[]> => {
    const assertActive = mutation?.assertActive ?? getKafkaDispatchGuard();
    await assertActive?.();
    if (
      !this.outboundWebhookEventService ||
      !mutation ||
      mutation.eventTypes.length === 0
    ) {
      return [];
    }

    const preparedEvents: PreparedMessageWebhookEvent[] = [];
    try {
      const channelIds = this.resolveMessageWebhookChannelIds(message);
      for (const eventType of [...new Set(mutation.eventTypes)]) {
        await assertActive?.();
        const prepared =
          await this.outboundWebhookEventService.prepareBestEffort({
            accountId: message.account.id,
            eventType,
            aggregate: { type: 'message', id: message.message_id },
            data: this.buildMessageWebhookData(
              message,
              eventType,
              mutation.changes
            ),
            previous:
              !eventType.startsWith('message.delivery.') &&
              mutation.previousMessage
                ? { message: serializePublicMessage(mutation.previousMessage) }
                : null,
            source: mutation.source,
            channelIds,
            actor: mutation.actor,
            idempotencyKey:
              mutation.idempotencyKeyByEventType?.[eventType] ??
              `${mutation.idempotencyKey}:${eventType}`,
          });
        await assertActive?.();
        if (prepared) {
          preparedEvents.push({ eventType, prepared });
        }
      }
      return preparedEvents;
    } catch (error) {
      await assertActive?.();
      console.error('[OutboundWebhook] Message event preparation failed', {
        account_id: message.account.id,
        message_id: message.message_id,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  };

  private completeMessageWebhookEvents = async (
    message: IChatMessage,
    mutation: MessageOutboundWebhookMutation | undefined,
    preparedEvents: PreparedMessageWebhookEvent[]
  ): Promise<void> => {
    if (
      !this.outboundWebhookEventService ||
      !mutation ||
      preparedEvents.length === 0
    ) {
      return;
    }

    const assertActive = mutation.assertActive ?? getKafkaDispatchGuard();
    const appliedEventIds = new Set(message.outbound_webhook_event_ids ?? []);
    const channelIds = this.resolveMessageWebhookChannelIds(message);
    for (const { eventType, prepared } of preparedEvents) {
      if (!appliedEventIds.has(prepared.eventId)) continue;
      try {
        await assertActive?.();
        const envelope = buildOutboundWebhookEnvelope({
          id: prepared.eventId,
          type: eventType,
          occurredAt: prepared.envelope.occurred_at,
          accountId: message.account.id,
          aggregate: { type: 'message', id: message.message_id },
          data: this.buildMessageWebhookData(
            message,
            eventType,
            mutation.changes
          ),
          previous:
            !eventType.startsWith('message.delivery.') &&
            mutation.previousMessage
              ? { message: serializePublicMessage(mutation.previousMessage) }
              : null,
          source: mutation.source,
          channelIds,
          actor: mutation.actor,
        });
        await this.outboundWebhookEventService.completeBestEffort({
          eventId: prepared.eventId,
          accountId: message.account.id,
          envelope,
        });
        await assertActive?.();
      } catch (error: unknown) {
        await assertActive?.();
        console.error('[OutboundWebhook] Message event finalization failed', {
          account_id: message.account.id,
          message_id: message.message_id,
          event_id: prepared.eventId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  };

  private findMessageForWebhookConfirmation = async (
    accountId: string,
    messageId: string
  ): Promise<IChatMessage | null> => {
    try {
      return await this.findMessageByMessageId(accountId, messageId);
    } catch (error: unknown) {
      console.warn('[OutboundWebhook] Message confirmation read failed', {
        account_id: accountId,
        message_id: messageId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  };

  private findChatForWebhookConfirmation = async (
    accountId: string,
    chatId: string
  ): Promise<IChat | null> => {
    try {
      return await this.findChatByChatId(accountId, chatId);
    } catch (error: unknown) {
      console.warn('[OutboundWebhook] Chat confirmation read failed', {
        account_id: accountId,
        chat_id: chatId,
        ...workerErrorDiagnostics(error),
      });
      return null;
    }
  };

  private withMessageWebhookMarkers(
    message: IChatMessage,
    preparedEvents: PreparedMessageWebhookEvent[]
  ): IChatMessage {
    if (preparedEvents.length === 0) return message;
    const eventIds = [
      ...new Set([
        ...(message.outbound_webhook_event_ids ?? []),
        ...preparedEvents.map(({ prepared }) => prepared.eventId),
      ]),
    ].slice(-256);
    return {
      ...message,
      outbound_webhook_event_ids: eventIds,
    };
  }

  private appendMessageWebhookMarkers = async (
    messageId: string,
    preparedEvents: PreparedMessageWebhookEvent[]
  ): Promise<void> => {
    const eventIds = preparedEvents.map(({ prepared }) => prepared.eventId);
    if (eventIds.length === 0) return;

    const assertActive = getKafkaDispatchGuard();
    await assertActive?.();
    await this.elasticDatabaseService.updateWithScriptOCC(
      EElasticIndex.message,
      messageId,
      {
        source: `
          if (ctx._source == null) {
            ctx.op = 'noop';
            return;
          }
          if (ctx._source.outbound_webhook_event_ids == null) {
            ctx._source.outbound_webhook_event_ids = [];
          }
          def changed = false;
          for (def eventId : params.event_ids) {
            if (!ctx._source.outbound_webhook_event_ids.contains(eventId)) {
              ctx._source.outbound_webhook_event_ids.add(eventId);
              changed = true;
            }
          }
          while (ctx._source.outbound_webhook_event_ids.size() > 256) {
            ctx._source.outbound_webhook_event_ids.remove(0);
          }
          if (!changed) ctx.op = 'noop';
        `,
        params: { event_ids: eventIds },
      },
      { upsert: false, maxRetries: 5, assertActive }
    );
    await assertActive?.();
  };

  /**
   * Replaces the public message snapshot while atomically preserving webhook
   * journal markers written by concurrent mutations of the same message.
   */
  private persistMessageWithWebhookMarkers = async (
    message: IChatMessage,
    preparedEvents: PreparedMessageWebhookEvent[],
    upsert: boolean,
    inboundEventId?: string | null
  ): Promise<'updated' | 'created' | 'noop' | 'conflict' | 'not_found'> => {
    const assertActive = getKafkaDispatchGuard();
    await assertActive?.();
    const eventIds = preparedEvents.map(({ prepared }) => prepared.eventId);
    const messageWithWebhookMarkers = this.withMessageWebhookMarkers(
      message,
      preparedEvents
    );
    // Inbound mutation identities are the durable replay fence. They must not
    // use the bounded webhook-journal window: evicting an old identity would
    // allow that provider event to mutate the message again on redelivery.
    const inboundEventIds = [
      ...new Set([
        ...(messageWithWebhookMarkers.inbound_event_ids ?? []),
        ...(inboundEventId ? [inboundEventId] : []),
      ]),
    ];
    const upsertDocument: IChatMessage = {
      ...messageWithWebhookMarkers,
      ...(inboundEventIds.length > 0
        ? { inbound_event_ids: inboundEventIds }
        : {}),
    };

    const result = await this.elasticDatabaseService.updateWithScriptOCC(
      EElasticIndex.message,
      message.message_id,
      {
        source: `
          def inboundEventIds = [];
          if (ctx._source != null && ctx._source.inbound_event_ids != null) {
            for (def eventId : ctx._source.inbound_event_ids) {
              if (!inboundEventIds.contains(eventId)) inboundEventIds.add(eventId);
            }
          }
          if (params.inbound_event_id != null && inboundEventIds.contains(params.inbound_event_id)) {
            ctx.op = 'noop';
            return;
          }
          for (def eventId : params.inbound_event_ids) {
            if (!inboundEventIds.contains(eventId)) inboundEventIds.add(eventId);
          }

          def webhookEventIds = [];
          if (ctx._source != null && ctx._source.outbound_webhook_event_ids != null) {
            for (def eventId : ctx._source.outbound_webhook_event_ids) {
              if (!webhookEventIds.contains(eventId)) webhookEventIds.add(eventId);
            }
          }
          for (def eventId : params.event_ids) {
            if (!webhookEventIds.contains(eventId)) webhookEventIds.add(eventId);
          }
          while (webhookEventIds.size() > 256) webhookEventIds.remove(0);

          ctx._source = params.message;
          ctx._source.outbound_webhook_event_ids = webhookEventIds;
          if (!inboundEventIds.isEmpty()) {
            ctx._source.inbound_event_ids = inboundEventIds;
          }
        `,
        params: {
          message: upsertDocument as unknown as Record<string, unknown>,
          event_ids: eventIds,
          inbound_event_id: inboundEventId ?? null,
          inbound_event_ids: inboundEventIds,
        },
        ...(upsert
          ? {
              upsert: upsertDocument as unknown as Record<string, unknown>,
              scriptedUpsert: true,
            }
          : {}),
      },
      { upsert, maxRetries: 5, assertActive }
    );
    await assertActive?.();
    return result;
  };

  private normalizeChatData(chat: IChat | null): IChat | null {
    if (!chat) {
      return null;
    }

    const normalizedChat = chat;

    if (Array.isArray(normalizedChat.summary)) {
      normalizedChat.summary = normalizedChat.summary[0] as IChat['summary'];
    }

    if (!Array.isArray(normalizedChat.secondary_users)) {
      normalizedChat.secondary_users = [];
    }

    return normalizedChat;
  }

  private hasAnyProtocol(chat: IChat): boolean {
    const hasProtocolValues = (protocols: string[] | null | undefined) => {
      if (!Array.isArray(protocols) || protocols.length === 0) {
        return false;
      }

      return protocols.some(
        (protocol) => typeof protocol === 'string' && protocol.trim().length > 0
      );
    };

    return (
      hasProtocolValues(chat.protocol_start) ||
      hasProtocolValues(chat.protocol_transfer) ||
      hasProtocolValues(chat.protocol_ura)
    );
  }

  ensureProtocolForNewChat = async (chat: IChat): Promise<IChat> => {
    if (!chat.worker?.id) {
      return chat;
    }

    if (this.hasAnyProtocol(chat)) {
      return chat;
    }

    const workerConfig = await this.viewWorkerConfigForChat(chat.worker.id);
    if (workerConfig?.show_protocol_in_chat !== true) {
      return chat;
    }

    return {
      ...chat,
      protocol_start: [generateProtocol()],
    };
  };

  private buildParticipantFilter(userId: string): Record<string, unknown> {
    return {
      bool: {
        should: [
          {
            nested: {
              path: 'user',
              query: {
                term: {
                  'user.id': userId,
                },
              },
            },
          },
          {
            nested: {
              path: 'secondary_users',
              query: {
                term: {
                  'secondary_users.id': userId,
                },
              },
            },
          },
        ],
        minimum_should_match: 1,
      },
    };
  }

  private normalizeMessageForElastic(messageChat: IChatMessage): IChatMessage {
    const content = messageChat.content;
    if (!content) {
      return messageChat;
    }

    let normalizedContent = content;
    const official = content.official;

    if (official?.raw && Object.hasOwn(official.raw, 'raw_data')) {
      // WWebJS raw payloads are provider internals whose field types may vary
      // between versions. They are not consumed by Underchat, and legacy
      // Elasticsearch mappings may have indexed them with incompatible types.
      const normalizedRaw = { ...official.raw };
      delete normalizedRaw.raw_data;
      normalizedContent = {
        ...normalizedContent,
        official: {
          ...official,
          raw: normalizedRaw,
        },
      };
    }

    const contextInfo = normalizedContent.context_info;
    const externalAdReply = contextInfo?.external_ad_reply as
      Record<string, unknown> | null | undefined;

    if (!contextInfo || !externalAdReply) {
      return normalizedContent === content
        ? messageChat
        : { ...messageChat, content: normalizedContent };
    }

    const rawMediaType =
      externalAdReply.media_type ?? externalAdReply.mediaType;

    if (rawMediaType === undefined) {
      return normalizedContent === content
        ? messageChat
        : { ...messageChat, content: normalizedContent };
    }

    const normalizedMediaType = normalizeExternalAdReplyMediaType(rawMediaType);
    const normalizedExternalAdReply: Record<string, unknown> = {
      ...externalAdReply,
    };

    delete normalizedExternalAdReply.mediaType;

    if (normalizedMediaType === null) {
      delete normalizedExternalAdReply.media_type;
    } else {
      normalizedExternalAdReply.media_type = normalizedMediaType;
    }

    return {
      ...messageChat,
      content: {
        ...normalizedContent,
        context_info: {
          ...contextInfo,
          external_ad_reply: normalizedExternalAdReply,
        },
      },
    };
  }

  saveMessageChat = async (
    messageChat: IChatMessage,
    outboundWebhook?: MessageOutboundWebhookMutation
  ): Promise<boolean> => {
    const assertActive =
      outboundWebhook?.assertActive ?? getKafkaDispatchGuard();
    await assertActive?.();
    const normalizedMessage = this.normalizeMessageForElastic(messageChat);
    const mappings = mensageMappings();

    const result = await this.elasticDatabaseService.indices(
      EElasticIndex.message,
      mappings
    );
    await assertActive?.();

    if (!result || !messageChat) {
      return false;
    }

    const preparedWebhookEvents = await this.prepareMessageWebhookEvents(
      normalizedMessage,
      outboundWebhook
    );
    const updateResult = await this.persistMessageWithWebhookMarkers(
      normalizedMessage,
      preparedWebhookEvents,
      true
    );
    await assertActive?.();

    const persisted =
      updateResult === 'updated' ||
      updateResult === 'created' ||
      updateResult === 'noop';
    if (!persisted) {
      return false;
    }

    if (preparedWebhookEvents.length > 0) {
      const confirmedMessage = await this.findMessageForWebhookConfirmation(
        normalizedMessage.account.id,
        normalizedMessage.message_id
      );
      if (!confirmedMessage) {
        console.warn('[OutboundWebhook] Message confirmation deferred', {
          account_id: normalizedMessage.account.id,
          message_id: normalizedMessage.message_id,
        });
        return true;
      }
      await this.completeMessageWebhookEvents(
        confirmedMessage,
        outboundWebhook,
        preparedWebhookEvents
      );
    }

    return true;
  };

  updateMessageChat = async (
    messageChat: IChatMessage,
    outboundWebhook?: MessageOutboundWebhookMutation
  ): Promise<boolean> => {
    const result = await this.updateMessageChatIdempotent(
      messageChat,
      outboundWebhook
    );
    return result.persisted;
  };

  updateMessageChatIdempotent = async (
    messageChat: IChatMessage,
    outboundWebhook?: MessageOutboundWebhookMutation
  ): Promise<MessageMutationPersistenceResult> => {
    const assertActive =
      outboundWebhook?.assertActive ?? getKafkaDispatchGuard();
    await assertActive?.();
    const normalizedMessage = this.normalizeMessageForElastic(messageChat);
    const mappings = mensageMappings();

    const result = await this.elasticDatabaseService.indices(
      EElasticIndex.message,
      mappings
    );
    await assertActive?.();

    if (!result || !normalizedMessage || !normalizedMessage.message_id) {
      return { persisted: false, applied: false };
    }

    const preparedWebhookEvents = await this.prepareMessageWebhookEvents(
      normalizedMessage,
      outboundWebhook
    );
    const updateResult = await this.persistMessageWithWebhookMarkers(
      normalizedMessage,
      preparedWebhookEvents,
      false,
      outboundWebhook?.inboundEventId
    );
    await assertActive?.();

    if (updateResult !== 'updated' && updateResult !== 'noop') {
      return { persisted: false, applied: false };
    }

    if (preparedWebhookEvents.length > 0) {
      const confirmedMessage = await this.findMessageForWebhookConfirmation(
        normalizedMessage.account.id,
        normalizedMessage.message_id
      );
      if (!confirmedMessage) {
        console.warn('[OutboundWebhook] Message confirmation deferred', {
          account_id: normalizedMessage.account.id,
          message_id: normalizedMessage.message_id,
        });
        return {
          persisted: true,
          applied: updateResult === 'updated',
        };
      }
      await this.completeMessageWebhookEvents(
        confirmedMessage,
        outboundWebhook,
        preparedWebhookEvents
      );
    }

    return {
      persisted: true,
      applied: updateResult === 'updated',
    };
  };

  createMessageIdempotent = async (
    messageChat: IChatMessage,
    outboundWebhook?: MessageOutboundWebhookMutation
  ): Promise<{
    created: boolean;
    conflict: boolean;
    id: string;
    attempted: boolean;
  }> => {
    const assertActive =
      outboundWebhook?.assertActive ?? getKafkaDispatchGuard();
    await assertActive?.();
    const normalizedMessage = this.normalizeMessageForElastic(messageChat);
    const mappings = mensageMappings();

    const indicesResult = await this.elasticDatabaseService.indices(
      EElasticIndex.message,
      mappings
    );
    await assertActive?.();

    if (!indicesResult || !normalizedMessage || !normalizedMessage.message_id) {
      return { created: false, conflict: false, id: '', attempted: false };
    }

    const documentId = normalizedMessage.message_id;
    const preparedWebhookEvents = await this.prepareMessageWebhookEvents(
      normalizedMessage,
      outboundWebhook
    );
    const persistedMessage = this.withMessageWebhookMarkers(
      normalizedMessage,
      preparedWebhookEvents
    );
    await assertActive?.();
    const createResult = await this.elasticDatabaseService.createDocument(
      EElasticIndex.message,
      documentId,
      persistedMessage
    );
    await assertActive?.();

    if (
      (createResult === 'created' || createResult === 'conflict') &&
      preparedWebhookEvents.length > 0
    ) {
      if (createResult === 'conflict') {
        try {
          await this.appendMessageWebhookMarkers(
            documentId,
            preparedWebhookEvents
          );
        } catch (error: unknown) {
          await assertActive?.();
          console.error('[OutboundWebhook] Message marker append failed', {
            account_id: normalizedMessage.account.id,
            message_id: documentId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      await assertActive?.();
      const confirmedMessage = await this.findMessageForWebhookConfirmation(
        normalizedMessage.account.id,
        documentId
      );
      await assertActive?.();
      if (!confirmedMessage) {
        console.warn('[OutboundWebhook] Message confirmation deferred', {
          account_id: normalizedMessage.account.id,
          message_id: documentId,
        });
      } else {
        await this.completeMessageWebhookEvents(
          confirmedMessage,
          outboundWebhook,
          preparedWebhookEvents
        );
      }
    }

    return {
      created: createResult === 'created',
      conflict: createResult === 'conflict',
      id: documentId,
      attempted: true,
    };
  };

  patchExistingMessageMissingFields = async (
    documentId: string,
    messageChat: IChatMessage,
    outboundWebhook?: MessageOutboundWebhookMutation
  ): Promise<boolean> => {
    const assertActive =
      outboundWebhook?.assertActive ?? getKafkaDispatchGuard();
    await assertActive?.();
    if (outboundWebhook) {
      const currentMessage = await this.findMessageForWebhookConfirmation(
        messageChat.account.id,
        documentId
      );
      await assertActive?.();
      if (
        currentMessage &&
        !this.hasMissingMessageKeyFields(currentMessage, messageChat)
      ) {
        return true;
      }
    }

    // This operation is a compare-and-set: only one concurrent attempt can
    // fill a missing field. Give each candidate its own intent so a losing
    // noop can be cancelled without cancelling the winner's journal row.
    const scopedOutboundWebhook = outboundWebhook
      ? {
          ...outboundWebhook,
          idempotencyKey: `${outboundWebhook.idempotencyKey}:${uuidv7()}`,
        }
      : undefined;
    await assertActive?.();
    const preparedWebhookEvents = await this.prepareMessageWebhookEvents(
      messageChat,
      scopedOutboundWebhook
    );
    await assertActive?.();
    const scriptSource = this.buildPatchMessageMissingFieldsScript();
    const scriptParams = {
      ...this.buildPatchMessageMissingFieldsParams(messageChat),
      outbound_webhook_event_ids: preparedWebhookEvents.map(
        ({ prepared }) => prepared.eventId
      ),
    };

    const result = await this.elasticDatabaseService.updateWithScriptOCC(
      EElasticIndex.message,
      documentId,
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

    if (result !== 'updated') {
      if (this.outboundWebhookEventService) {
        await Promise.allSettled(
          preparedWebhookEvents.map(({ prepared }) =>
            this.outboundWebhookEventService?.cancel(prepared.eventId)
          )
        );
      }
      return result === 'noop';
    }

    if (preparedWebhookEvents.length > 0) {
      const confirmedMessage = await this.findMessageForWebhookConfirmation(
        messageChat.account.id,
        documentId
      );
      if (!confirmedMessage) {
        console.warn('[OutboundWebhook] Message confirmation deferred', {
          account_id: messageChat.account.id,
          message_id: documentId,
        });
      } else {
        await this.completeMessageWebhookEvents(
          confirmedMessage,
          scopedOutboundWebhook,
          preparedWebhookEvents
        );
      }
    }

    return true;
  };

  private hasMissingMessageKeyFields(
    current: IChatMessage,
    intended: IChatMessage
  ): boolean {
    const currentKey = current.message_key;
    const intendedKey = intended.message_key;
    if (!intendedKey) return false;

    const keys: Array<keyof NonNullable<IChatMessage['message_key']>> = [
      'remote_jid',
      'remote_jid_alt',
      'id',
      'from_me',
      'participant',
      'participant_alt',
      'addressing_mode',
      'is_view_once',
    ];
    return keys.some(
      (key) =>
        intendedKey[key] !== null &&
        intendedKey[key] !== undefined &&
        (currentKey?.[key] === null || currentKey?.[key] === undefined)
    );
  }

  private buildPatchMessageMissingFieldsScript(): string {
    return `
      if (ctx._source == null) {
        ctx.op = 'noop';
        return;
      }
      
      def changed = false;
      def patch = params.patch;
      
      if (ctx._source.message_key == null) {
        ctx._source.message_key = [:];
      }
      
      if (patch.containsKey('message_key') && patch.message_key != null) {
        def messageKey = patch.message_key;
        
        if (messageKey.containsKey('remote_jid') && messageKey.remote_jid != null) {
          if (ctx._source.message_key.remote_jid == null) {
            ctx._source.message_key.remote_jid = messageKey.remote_jid;
            changed = true;
          }
        }
        
        if (messageKey.containsKey('remote_jid_alt') && messageKey.remote_jid_alt != null) {
          if (ctx._source.message_key.remote_jid_alt == null) {
            ctx._source.message_key.remote_jid_alt = messageKey.remote_jid_alt;
            changed = true;
          }
        }
        
        if (messageKey.containsKey('id') && messageKey.id != null) {
          if (ctx._source.message_key.id == null) {
            ctx._source.message_key.id = messageKey.id;
            changed = true;
          }
        }
        
        if (messageKey.containsKey('from_me') && messageKey.from_me != null) {
          if (ctx._source.message_key.from_me == null) {
            ctx._source.message_key.from_me = messageKey.from_me;
            changed = true;
          }
        }
        
        if (messageKey.containsKey('participant') && messageKey.participant != null) {
          if (ctx._source.message_key.participant == null) {
            ctx._source.message_key.participant = messageKey.participant;
            changed = true;
          }
        }
        
        if (messageKey.containsKey('participant_alt') && messageKey.participant_alt != null) {
          if (ctx._source.message_key.participant_alt == null) {
            ctx._source.message_key.participant_alt = messageKey.participant_alt;
            changed = true;
          }
        }
        
        if (messageKey.containsKey('addressing_mode') && messageKey.addressing_mode != null) {
          if (ctx._source.message_key.addressing_mode == null) {
            ctx._source.message_key.addressing_mode = messageKey.addressing_mode;
            changed = true;
          }
        }
        
        if (messageKey.containsKey('is_view_once') && messageKey.is_view_once != null) {
          if (ctx._source.message_key.is_view_once == null) {
            ctx._source.message_key.is_view_once = messageKey.is_view_once;
            changed = true;
          }
        }
      }
      
      if (changed && params.outbound_webhook_event_ids != null) {
        if (ctx._source.outbound_webhook_event_ids == null) {
          ctx._source.outbound_webhook_event_ids = [];
        }
        for (def eventId : params.outbound_webhook_event_ids) {
          if (!ctx._source.outbound_webhook_event_ids.contains(eventId)) {
            ctx._source.outbound_webhook_event_ids.add(eventId);
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

  private buildPatchMessageMissingFieldsParams(
    messageChat: IChatMessage
  ): Record<string, unknown> {
    const patch: Record<string, unknown> = {};

    if (messageChat.message_key) {
      patch.message_key = {
        remote_jid: messageChat.message_key.remote_jid ?? null,
        remote_jid_alt: messageChat.message_key.remote_jid_alt ?? null,
        id: messageChat.message_key.id ?? null,
        from_me: messageChat.message_key.from_me ?? null,
        participant: messageChat.message_key.participant ?? null,
        participant_alt: messageChat.message_key.participant_alt ?? null,
        addressing_mode: messageChat.message_key.addressing_mode ?? null,
        is_view_once: messageChat.message_key.is_view_once ?? null,
      };
    }

    return { patch };
  }

  private applyChatPatchWithResult = async (
    chatId: string,
    patch: ChatPatch,
    options?: ChatPatchOptions & {
      outboundWebhook?: ChatOutboundWebhookMutation;
    }
  ): Promise<ChatPatchApplicationResult> => {
    const assertActive =
      options?.outboundWebhook?.assertActive ?? getKafkaDispatchGuard();
    await assertActive?.();
    const mappings = chatMappings();

    const indicesResult = await this.elasticDatabaseService.indices(
      EElasticIndex.chat,
      mappings
    );
    await assertActive?.();

    if (!indicesResult) {
      return { applied: false, persistenceResult: 'not_found' };
    }

    const intendedChat = options?.outboundWebhook?.previousChat
      ? ({ ...options.outboundWebhook.previousChat, ...patch } as IChat)
      : null;
    const preparedWebhookEvents = intendedChat
      ? await this.prepareChatWebhookEvents(
          intendedChat,
          options?.outboundWebhook
        )
      : [];
    await assertActive?.();
    const outboundWebhookEventIds = [
      ...(options?.outboundWebhookEventIds ?? []),
      ...preparedWebhookEvents.map(({ prepared }) => prepared.eventId),
    ];
    const scriptSource = this.buildChatPatchScript();
    const scriptParams = this.buildChatPatchParams(patch, {
      ...options,
      outboundWebhookEventIds,
    });
    const upsert = this.buildChatPatchUpsert(chatId, patch, scriptParams);

    const result = await this.elasticDatabaseService.updateWithScriptOCC(
      EElasticIndex.chat,
      chatId,
      {
        source: scriptSource,
        params: scriptParams,
        upsert: options?.allowCreate !== false ? upsert : undefined,
        scriptedUpsert: false,
      },
      {
        upsert: options?.allowCreate !== false,
        maxRetries: 5,
        refresh: options?.refresh,
        assertActive,
      }
    );
    await assertActive?.();

    const applied =
      result === 'updated' || result === 'created' || result === 'noop';
    if (!applied) {
      return { applied: false, persistenceResult: result };
    }

    if (preparedWebhookEvents.length > 0 && intendedChat) {
      await assertActive?.();
      const confirmedChat = await this.findChatForWebhookConfirmation(
        intendedChat.account.id,
        chatId
      );
      await assertActive?.();
      if (!confirmedChat) {
        console.warn('[OutboundWebhook] Chat confirmation deferred', {
          account_id: intendedChat.account.id,
          chat_id: chatId,
        });
        return {
          // A guarded script can report `noop` both when the desired state was
          // already present and when a revision/precondition rejected it. If
          // the realtime read is unavailable, treating that ambiguous result
          // as success would make callers acknowledge a mutation that may not
          // have happened. An actual update/create is safe to acknowledge;
          // its journal marker remains available for asynchronous recovery.
          applied: result === 'updated' || result === 'created',
          persistenceResult: result,
        };
      }
      if (!this.chatMatchesPatch(confirmedChat, patch)) {
        return { applied: false, persistenceResult: result };
      }
      await this.completeChatWebhookEvents(
        confirmedChat,
        options?.outboundWebhook,
        preparedWebhookEvents
      );
    }

    return { applied: true, persistenceResult: result };
  };

  applyChatPatch = async (
    chatId: string,
    patch: ChatPatch,
    options?: ChatPatchOptions & {
      outboundWebhook?: ChatOutboundWebhookMutation;
    }
  ): Promise<boolean> => {
    const application = await this.applyChatPatchWithResult(
      chatId,
      patch,
      options
    );
    return application.applied;
  };

  private chatMatchesPatch(chat: IChat, patch: ChatPatch): boolean {
    return Object.entries(patch).every(([key, expected]) => {
      if (expected === undefined) return true;
      const current = chat[key as keyof IChat];
      return (
        this.stringifyCanonicalJson(current ?? null) ===
        this.stringifyCanonicalJson(expected ?? null)
      );
    });
  }

  private stringifyCanonicalJson(value: unknown): string {
    return JSON.stringify(value ?? null, (_key, nestedValue: unknown) => {
      if (
        nestedValue === null ||
        Array.isArray(nestedValue) ||
        typeof nestedValue !== 'object'
      ) {
        return nestedValue;
      }

      return Object.fromEntries(
        Object.entries(nestedValue as Record<string, unknown>)
          .filter(([, nestedEntry]) => nestedEntry !== undefined)
          .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      );
    });
  }

  async invalidateChatCache(chat: IChat): Promise<void> {
    const cacheKey = createChatCacheKey(
      chat.account.id,
      chat.worker.id,
      chat.phone
    );
    const cacheKeyChat = createChatCacheKeyChatId(
      chat.account.id,
      chat.chat_id
    );

    await Promise.all([this.redis.del(cacheKey), this.redis.del(cacheKeyChat)]);
  }

  private async cacheChat(chat: IChat): Promise<void> {
    const key = createChatCacheKey(chat.account.id, chat.worker.id, chat.phone);
    await this.redis.set(key, JSON.stringify(chat), 'PX', 60_000);
  }

  private async cacheChatById(chat: IChat): Promise<void> {
    const key = createChatCacheKeyChatId(chat.account.id, chat.chat_id);
    await this.redis.set(key, JSON.stringify(chat), 'PX', 60_000);
  }

  private async cacheCanonicalChatBestEffort(chat: IChat): Promise<void> {
    try {
      await Promise.all([this.cacheChat(chat), this.cacheChatById(chat)]);
    } catch (error: unknown) {
      console.warn('[ChatService] Failed to refresh canonical chat cache', {
        account_id: chat.account.id,
        worker_id: chat.worker.id,
        chat_id: chat.chat_id,
        ...workerErrorDiagnostics(error),
      });
    }
  }

  private async ensureNoOpenChatIdentityConflict(
    chat: IChat
  ): Promise<boolean> {
    if (!this.isOpenChatStatus(chat.status)) {
      return true;
    }

    if (!chat.account?.id || !chat.worker?.id || !chat.chat_id) {
      return true;
    }

    const input: ChatIdentityInput = {
      phone: chat.phone,
      remoteJid: chat.message_key?.remote_jid,
      remoteJidAlt: chat.message_key?.remote_jid_alt,
    };
    const identity = normalizeChatIdentity(input);
    if (!identity.phoneCandidates.length && !identity.jidCandidates.length) {
      return true;
    }

    const existingSameChat = await this.findChatByChatId(
      chat.account.id,
      chat.chat_id
    );
    if (existingSameChat) {
      return true;
    }

    const existingChat = await this.findOpenChatByIdentity(
      chat.account.id,
      chat.worker.id,
      input
    );

    if (existingChat && existingChat.chat_id !== chat.chat_id) {
      console.warn('[ChatService] Open chat identity conflict prevented', {
        account_id: chat.account.id,
        worker_id: chat.worker.id,
        incoming_chat_id: chat.chat_id,
        existing_chat_id: existingChat.chat_id,
        phone: chat.phone,
        remote_jid: chat.message_key?.remote_jid ?? null,
        remote_jid_alt: chat.message_key?.remote_jid_alt ?? null,
      });
      return false;
    }

    return true;
  }

  saveChat = async (
    chat: IChat,
    options?: Pick<
      ChatPatchOptions,
      | 'refresh'
      | 'expectedCurrentStatuses'
      | 'enforceExpectedLastMessageId'
      | 'expectedLastMessageId'
      | 'enforceExpectedSummaryRevision'
      | 'expectedSummaryRevision'
      | 'allowHumanToAutomation'
    > & { outboundWebhook?: ChatOutboundWebhookMutation }
  ): Promise<boolean> => {
    if (!chat) return false;
    const assertActive =
      options?.outboundWebhook?.assertActive ?? getKafkaDispatchGuard();
    await assertActive?.();

    const hasNoIdentityConflict =
      await this.ensureNoOpenChatIdentityConflict(chat);
    await assertActive?.();
    if (!hasNoIdentityConflict) {
      return false;
    }

    const requestedStatus = chat.status;
    const expectedStatusEventId = chat.meta?.status_event_id ?? null;
    const expectedStatusEpoch = chat.meta?.status_epoch ?? null;

    const patch: ChatPatch = {
      message_key: chat.message_key,
      account: chat.account,
      worker: chat.worker,
      sector: chat.sector,
      user: chat.user,
      secondary_users: Array.isArray(chat.secondary_users)
        ? chat.secondary_users
        : [],
      contact: chat.contact,
      photo: chat.photo,
      name: chat.name,
      phone: chat.phone,
      status: chat.status,
      date: chat.date,
      started_at: chat.started_at,
      closed_at: chat.closed_at,
      protocol_ura: chat.protocol_ura,
      protocol_start: chat.protocol_start,
      protocol_transfer: chat.protocol_transfer,
      label: chat.label,
      embedded_for_ai_agents: chat.embedded_for_ai_agents,
      forward_to_output_chatbot: chat.forward_to_output_chatbot,
      chatbot_schedule_id: chat.chatbot_schedule_id,
      chatbot_webhook_id: chat.chatbot_webhook_id,
      chatbot_transfer_id: chat.chatbot_transfer_id,
      official_window: chat.official_window,
    };

    const preparedWebhookEvents = await this.prepareChatWebhookEvents(
      chat,
      options?.outboundWebhook
    );

    const application = await this.applyChatPatchWithResult(
      chat.chat_id,
      patch,
      {
        allowCreate: true,
        refresh: options?.refresh,
        expectedCurrentStatuses: options?.expectedCurrentStatuses,
        enforceExpectedLastMessageId: options?.enforceExpectedLastMessageId,
        expectedLastMessageId: options?.expectedLastMessageId,
        enforceExpectedSummaryRevision: options?.enforceExpectedSummaryRevision,
        expectedSummaryRevision: options?.expectedSummaryRevision,
        allowHumanToAutomation: options?.allowHumanToAutomation,
        enforceExpectedStatusRevision: true,
        expectedStatusEventId,
        expectedStatusEpoch,
        outboundWebhookEventIds: preparedWebhookEvents.map(
          ({ prepared }) => prepared.eventId
        ),
      }
    );
    await assertActive?.();
    if (!application.applied) {
      return false;
    }

    const confirmedChat =
      preparedWebhookEvents.length > 0
        ? await this.findChatForWebhookConfirmation(
            chat.account.id,
            chat.chat_id
          )
        : await this.findChatByChatId(chat.account.id, chat.chat_id);
    await assertActive?.();
    if (!confirmedChat) {
      if (preparedWebhookEvents.length > 0) {
        // The Elasticsearch mutation may have succeeded. Keep the journal in
        // `preparing` so the reconciler can confirm it after a transient read
        // failure instead of silently losing the customer event.
        console.warn('[OutboundWebhook] Chat confirmation deferred', {
          account_id: chat.account.id,
          chat_id: chat.chat_id,
        });
        return application.persistenceResult !== 'noop';
      }

      return false;
    }

    Object.assign(chat, confirmedChat);
    await assertActive?.();
    await Promise.all([
      this.cacheChat(confirmedChat),
      this.cacheChatById(confirmedChat),
    ]);
    await assertActive?.();
    if (
      confirmedChat.status !== requestedStatus ||
      !this.chatMatchesPatch(confirmedChat, patch)
    ) {
      return false;
    }

    await this.completeChatWebhookEvents(
      confirmedChat,
      options?.outboundWebhook,
      preparedWebhookEvents
    );
    return true;
  };

  private buildChatPatchScript(): string {
    return `
      if (ctx._source == null) {
        if (params.upsert != null) {
          ctx._source = params.upsert;
          return;
        }
        ctx.op = 'noop';
        return;
      }
      
      def changed = false;
      def patch = params.patch;
      def eventEpochMillis = params.event_epoch_millis;
      def eventId = params.event_id;
      
      if (ctx._source.meta == null) {
        ctx._source.meta = [:];
      }
      
      def hasStatusUpdate = patch.containsKey('status') && patch.status != null;
      def statusChanged = hasStatusUpdate && ctx._source.status != patch.status;
      def hasUserUpdate = patch.containsKey('user');
      def hasSectorUpdate = patch.containsKey('sector');
      def hasStatusAndUserUpdate = hasStatusUpdate && hasUserUpdate;
      
      def shouldApplyPatch = true;

      def expectedCurrentStatuses = params.expected_current_statuses;
      if (expectedCurrentStatuses != null && expectedCurrentStatuses.size() > 0) {
        def currentStatus = ctx._source.status;
        if (!expectedCurrentStatuses.contains(currentStatus)) {
          ctx.op = 'noop';
          return;
        }
      }

      if (params.enforce_expected_summary_revision == true) {
        def expectedSummaryRevision = params.expected_summary_revision;
        if (expectedSummaryRevision == null) {
          ctx.op = 'noop';
          return;
        }

        def currentSummaryRevision = 0L;
        if (ctx._source.summary != null) {
          def revisionSummary = null;
          if (ctx._source.summary instanceof List) {
            if (ctx._source.summary.size() > 0) {
              revisionSummary = ctx._source.summary[0];
            }
          } else {
            revisionSummary = ctx._source.summary;
          }
          if (revisionSummary != null && revisionSummary.revision != null) {
            currentSummaryRevision = revisionSummary.revision.longValue();
          }
        }

        if (expectedSummaryRevision.longValue() != currentSummaryRevision) {
          ctx.op = 'noop';
          return;
        }
      }

      if (params.enforce_expected_status_revision == true) {
        def expectedStatusEventId = params.expected_status_event_id;
        def currentStatusEventId = ctx._source.meta.status_event_id;
        if (
          (expectedStatusEventId == null && currentStatusEventId != null) ||
          (expectedStatusEventId != null && !expectedStatusEventId.equals(currentStatusEventId))
        ) {
          ctx.op = 'noop';
          return;
        }

        def expectedStatusEpoch = params.expected_status_epoch;
        def currentStatusEpoch = ctx._source.meta.status_epoch;
        if (
          (expectedStatusEpoch == null && currentStatusEpoch != null) ||
          (expectedStatusEpoch != null && (
            currentStatusEpoch == null ||
            expectedStatusEpoch.longValue() != currentStatusEpoch.longValue()
          ))
        ) {
          ctx.op = 'noop';
          return;
        }

        if (params.enforce_expected_started_at == true) {
          def expectedStartedAt = params.expected_started_at;
          def currentStartedAt = ctx._source.started_at;
          if (
            (expectedStartedAt == null && currentStartedAt != null) ||
            (expectedStartedAt != null && !expectedStartedAt.equals(currentStartedAt))
          ) {
            ctx.op = 'noop';
            return;
          }
        }


        if (params.enforce_expected_last_message_id == true) {
          def expectedLastMessageId = params.expected_last_message_id;
          def currentLastMessageId = null;
          if (ctx._source.summary != null) {
            if (ctx._source.summary instanceof List) {
              if (ctx._source.summary.size() > 0 && ctx._source.summary[0] != null) {
                currentLastMessageId = ctx._source.summary[0].last_message_id;
              }
            } else {
              currentLastMessageId = ctx._source.summary.last_message_id;
            }
          }
          if (
            (expectedLastMessageId == null && currentLastMessageId != null) ||
            (expectedLastMessageId != null && !expectedLastMessageId.equals(currentLastMessageId))
          ) {
            ctx.op = 'noop';
            return;
          }
        }
      }

      if (hasStatusUpdate) {
        def currentStatus = ctx._source.status;
        def newStatus = patch.status;
        def chatbotStatuses = params.chatbot_statuses;
        def humanAttendanceStatuses = params.human_attendance_statuses;
        def allowHumanToAutomation = params.allow_human_to_automation == true;

        if (
          !allowHumanToAutomation &&
          chatbotStatuses != null &&
          humanAttendanceStatuses != null &&
          chatbotStatuses.contains(newStatus) &&
          humanAttendanceStatuses.contains(currentStatus)
        ) {
          ctx.op = 'noop';
          return;
        }
      }
      
      if (eventEpochMillis != null) {
        def domain = params.domain;
        def currentEpoch = 0;
        def currentEventId = null;
        
        if (domain == 'status') {
          if (ctx._source.meta.status_epoch != null) {
            currentEpoch = ctx._source.meta.status_epoch;
          }
          if (ctx._source.meta.status_event_id != null) {
            currentEventId = ctx._source.meta.status_event_id;
          }
        } else if (domain == 'assignment') {
          if (ctx._source.meta.assignment_epoch != null) {
            currentEpoch = ctx._source.meta.assignment_epoch;
          }
          if (ctx._source.meta.assignment_event_id != null) {
            currentEventId = ctx._source.meta.assignment_event_id;
          }
        } else if (domain == 'labels') {
          if (ctx._source.meta.labels_epoch != null) {
            currentEpoch = ctx._source.meta.labels_epoch;
          }
          if (ctx._source.meta.labels_event_id != null) {
            currentEventId = ctx._source.meta.labels_event_id;
          }
        }
        
        if (eventEpochMillis < currentEpoch) {
          shouldApplyPatch = false;
        } else if (eventEpochMillis == currentEpoch && eventId != null && currentEventId != null) {
          if (eventId.compareTo(currentEventId) <= 0) {
            shouldApplyPatch = false;
          }
        }
      }

      // A chatbot handoff changes both status and assignment in one patch.
      // Its status-domain ordering guard alone cannot see a concurrent manual
      // assignment, so compare the assignment revision in the same atomic
      // script before either part of the patch is written.
      if (params.enforce_assignment_revision == true && eventEpochMillis != null) {
        def currentAssignmentEpoch = 0;
        def currentAssignmentEventId = null;
        if (ctx._source.meta.assignment_epoch != null) {
          currentAssignmentEpoch = ctx._source.meta.assignment_epoch;
        }
        if (ctx._source.meta.assignment_event_id != null) {
          currentAssignmentEventId = ctx._source.meta.assignment_event_id;
        }
        if (eventEpochMillis < currentAssignmentEpoch) {
          shouldApplyPatch = false;
        } else if (
          eventEpochMillis == currentAssignmentEpoch &&
          eventId != null &&
          currentAssignmentEventId != null &&
          eventId.compareTo(currentAssignmentEventId) <= 0
        ) {
          shouldApplyPatch = false;
        }
      }
      
      if (!shouldApplyPatch) {
        ctx.op = 'noop';
        return;
      }
      
      if (hasStatusAndUserUpdate && eventEpochMillis == null) {
        def currentStatus = ctx._source.status;
        def currentUser = ctx._source.user;
        def newStatus = patch.status;
        def newUser = patch.user;
        
        if (currentStatus != null && currentStatus == newStatus) {
          if (currentUser != null && newUser != null) {
            def currentUserId = currentUser.id != null ? currentUser.id : '';
            def newUserId = newUser.id != null ? newUser.id : '';
            
            if (currentUserId != '' && currentUserId != newUserId && (newStatus == 'in_chat' || newStatus == 'queue')) {
              ctx.op = 'noop';
              return;
            }
          } else if (currentUser != null && newUser == null && (newStatus == 'in_chat' || newStatus == 'queue')) {
            ctx.op = 'noop';
            return;
          } else if (currentUser == null && newUser != null && currentStatus == 'in_chat') {
            def currentStatusEpoch = ctx._source.meta.status_epoch != null ? ctx._source.meta.status_epoch : 0;
            if (currentStatusEpoch > 0) {
              def nowEpoch = params.event_epoch_millis != null ? params.event_epoch_millis : 0;
              if (nowEpoch < currentStatusEpoch) {
                ctx.op = 'noop';
                return;
              }
            }
          }
        }
      }
      
      if (patch.containsKey('message_key') && patch.message_key != null) {
        if (ctx._source.message_key == null) {
          ctx._source.message_key = [:];
        }
        def messageKey = patch.message_key;
        if (messageKey.containsKey('remote_jid')) {
          ctx._source.message_key.remote_jid = messageKey.remote_jid;
          changed = true;
        }
        if (messageKey.containsKey('remote_jid_alt')) {
          ctx._source.message_key.remote_jid_alt = messageKey.remote_jid_alt;
          changed = true;
        }
      }
      
      if (patch.containsKey('account') && patch.account != null) {
        ctx._source.account = patch.account;
        changed = true;
      }
      
      if (patch.containsKey('worker') && patch.worker != null) {
        ctx._source.worker = patch.worker;
        changed = true;
      }
      
      if (patch.containsKey('sector')) {
        ctx._source.sector = patch.sector;
        changed = true;
      }
      
      if (patch.containsKey('user')) {
        ctx._source.user = patch.user;
        changed = true;
      }

      if (patch.containsKey('secondary_users')) {
        ctx._source.secondary_users = patch.secondary_users;
        changed = true;
      }
      
      if (patch.containsKey('contact')) {
        ctx._source.contact = patch.contact;
        changed = true;
      }
      
      if (patch.containsKey('photo')) {
        ctx._source.photo = patch.photo;
        changed = true;
      }
      
      if (patch.containsKey('name')) {
        ctx._source.name = patch.name;
        changed = true;
      }
      
      if (patch.containsKey('phone') && patch.phone != null) {
        ctx._source.phone = patch.phone;
        changed = true;
      }
      
      if (statusChanged) {
        ctx._source.status = patch.status;
        changed = true;
        if (eventEpochMillis != null) {
          ctx._source.meta.status_epoch = eventEpochMillis;
          if (eventId != null) {
            ctx._source.meta.status_event_id = eventId;
          }
        }
        if (params.status_source != null) {
          ctx._source.meta.status_source = params.status_source;
        }
      }

      if (
        params.clear_unread_count == true &&
        ctx._source.summary != null &&
        ctx._source.summary.size() > 0
      ) {
        def isSummaryList = ctx._source.summary instanceof List;
        def clearSummary = null;
        if (isSummaryList) {
          if (ctx._source.summary[0] != null) {
            clearSummary = ctx._source.summary[0];
          }
        } else {
          clearSummary = ctx._source.summary;
        }
        if (
          clearSummary != null &&
          clearSummary.unread_count != null &&
          clearSummary.unread_count != 0
        ) {
          clearSummary.unread_count = 0;
          def currentSummaryRevision =
            clearSummary.revision != null
              ? clearSummary.revision.longValue()
              : 0L;
          clearSummary.revision = currentSummaryRevision + 1L;
          changed = true;
        }
      }
      
      if (patch.containsKey('date') && patch.date != null) {
        ctx._source.date = patch.date;
        changed = true;
      }
      
      if (patch.containsKey('started_at')) {
        ctx._source.started_at = patch.started_at;
        changed = true;
      }
      
      if (patch.containsKey('closed_at')) {
        ctx._source.closed_at = patch.closed_at;
        changed = true;
      }
      
      if (patch.containsKey('protocol_ura')) {
        ctx._source.protocol_ura = patch.protocol_ura;
        changed = true;
      }
      
      if (patch.containsKey('protocol_start')) {
        ctx._source.protocol_start = patch.protocol_start;
        changed = true;
      }
      
      if (patch.containsKey('protocol_transfer')) {
        ctx._source.protocol_transfer = patch.protocol_transfer;
        changed = true;
      }
      
      if (patch.containsKey('label')) {
        def domain = params.domain;
        if (domain == 'labels' && eventEpochMillis != null) {
          def currentEpoch = 0;
          if (ctx._source.meta.labels_epoch != null) {
            currentEpoch = ctx._source.meta.labels_epoch;
          }
          if (eventEpochMillis >= currentEpoch) {
            ctx._source.label = patch.label;
            ctx._source.meta.labels_epoch = eventEpochMillis;
            if (eventId != null) {
              ctx._source.meta.labels_event_id = eventId;
            }
            changed = true;
          }
        } else {
          ctx._source.label = patch.label;
          changed = true;
        }
      }
      
      if (patch.containsKey('embedded_for_ai_agents')) {
        ctx._source.embedded_for_ai_agents = patch.embedded_for_ai_agents;
        changed = true;
      }

      if (patch.containsKey('forward_to_output_chatbot')) {
        ctx._source.forward_to_output_chatbot = patch.forward_to_output_chatbot;
        changed = true;
      }

      if (patch.containsKey('chatbot_schedule_id')) {
        ctx._source.chatbot_schedule_id = patch.chatbot_schedule_id;
        changed = true;
      }

      if (patch.containsKey('chatbot_webhook_id')) {
        ctx._source.chatbot_webhook_id = patch.chatbot_webhook_id;
        changed = true;
      }

      if (patch.containsKey('chatbot_transfer_id')) {
        ctx._source.chatbot_transfer_id = patch.chatbot_transfer_id;
        changed = true;
      }

      if (patch.containsKey('official_window')) {
        ctx._source.official_window = patch.official_window;
        changed = true;
      }

      def outboundWebhookEventIds = params.outbound_webhook_event_ids;
      if (outboundWebhookEventIds != null && outboundWebhookEventIds.size() > 0) {
        if (ctx._source.meta.outbound_webhook_event_ids == null) {
          ctx._source.meta.outbound_webhook_event_ids = [];
        }
        for (def outboundWebhookEventId : outboundWebhookEventIds) {
          if (!ctx._source.meta.outbound_webhook_event_ids.contains(outboundWebhookEventId)) {
            ctx._source.meta.outbound_webhook_event_ids.add(outboundWebhookEventId);
            changed = true;
          }
        }
        while (ctx._source.meta.outbound_webhook_event_ids.size() > 256) {
          ctx._source.meta.outbound_webhook_event_ids.remove(0);
        }
      }
      
      if (patch.containsKey('user') && !hasStatusAndUserUpdate) {
        if (eventEpochMillis != null) {
          ctx._source.meta.assignment_epoch = eventEpochMillis;
          if (eventId != null) {
            ctx._source.meta.assignment_event_id = eventId;
          }
        }
      }
      
      if (patch.containsKey('sector')) {
        if (eventEpochMillis != null) {
          ctx._source.meta.assignment_epoch = eventEpochMillis;
          if (eventId != null) {
            ctx._source.meta.assignment_event_id = eventId;
          }
        }
      }
      
      if (!changed) {
        ctx.op = 'noop';
      }
    `;
  }

  private buildChatPatchParams(
    patch: ChatPatch,
    options?: ChatPatchOptions
  ): Record<string, unknown> {
    const params: Record<string, unknown> = {
      patch,
      chatbot_statuses: CHATBOT_STATUSES,
      human_attendance_statuses: HUMAN_ATTENDANCE_STATUSES,
      allow_human_to_automation: options?.allowHumanToAutomation === true,
      clear_unread_count: options?.clearUnreadCount === true,
      enforce_expected_status_revision:
        options?.enforceExpectedStatusRevision === true,
      enforce_expected_started_at: options?.enforceExpectedStartedAt === true,
      enforce_expected_last_message_id:
        options?.enforceExpectedLastMessageId === true,
      enforce_expected_summary_revision:
        options?.enforceExpectedSummaryRevision === true,
      enforce_assignment_revision: options?.enforceAssignmentRevision === true,
      expected_status_event_id: options?.expectedStatusEventId ?? null,
      expected_status_epoch: options?.expectedStatusEpoch ?? null,
      expected_started_at: options?.expectedStartedAt ?? null,
      expected_last_message_id: options?.expectedLastMessageId ?? null,
      expected_summary_revision: options?.expectedSummaryRevision ?? null,
      outbound_webhook_event_ids: [
        ...new Set(options?.outboundWebhookEventIds ?? []),
      ],
    };

    if (
      options?.expectedCurrentStatuses !== null &&
      options?.expectedCurrentStatuses !== undefined
    ) {
      params.expected_current_statuses = options.expectedCurrentStatuses;
    }

    const hasStatusUpdate = patch.status !== null && patch.status !== undefined;
    const hasUserUpdate = Object.prototype.hasOwnProperty.call(patch, 'user');
    const hasSectorUpdate = Object.prototype.hasOwnProperty.call(
      patch,
      'sector'
    );
    const hasSecondaryUsersUpdate = Object.prototype.hasOwnProperty.call(
      patch,
      'secondary_users'
    );
    const hasLabelsUpdate = Object.prototype.hasOwnProperty.call(
      patch,
      'label'
    );

    if (
      options?.eventEpochMillis !== null &&
      options?.eventEpochMillis !== undefined
    ) {
      params.event_epoch_millis = options.eventEpochMillis;
    } else if (hasStatusUpdate) {
      params.event_epoch_millis = Date.now();
      params.event_id = uuidv7();
    }

    if (options?.eventId !== null && options?.eventId !== undefined) {
      params.event_id = options.eventId;
    }

    let domain: string | null = null;
    if (hasStatusUpdate) {
      domain = 'status';
    } else if (hasUserUpdate || hasSecondaryUsersUpdate || hasSectorUpdate) {
      domain = 'assignment';
    } else if (hasLabelsUpdate) {
      domain = 'labels';
    }

    if (domain !== null) {
      params.domain = domain;
    }

    if (hasStatusUpdate) {
      params.status_source = options?.statusSource ?? 'chat_service';
    }

    return params;
  }

  private buildChatPatchUpsert(
    chatId: string,
    patch: ChatPatch,
    params: Record<string, unknown>
  ): Record<string, unknown> {
    const upsert: Record<string, unknown> = {
      chat_id: chatId,
    };

    if (patch.message_key !== null && patch.message_key !== undefined) {
      upsert.message_key = patch.message_key;
    }

    if (patch.account !== null && patch.account !== undefined) {
      upsert.account = patch.account;
    }

    if (patch.worker !== null && patch.worker !== undefined) {
      upsert.worker = patch.worker;
    }

    if (patch.sector !== null && patch.sector !== undefined) {
      upsert.sector = patch.sector;
    }

    if (patch.user !== null && patch.user !== undefined) {
      upsert.user = patch.user;
    }

    if (patch.secondary_users !== null && patch.secondary_users !== undefined) {
      upsert.secondary_users = patch.secondary_users;
    } else {
      upsert.secondary_users = [];
    }

    if (patch.contact !== null && patch.contact !== undefined) {
      upsert.contact = patch.contact;
    }

    if (patch.photo !== null && patch.photo !== undefined) {
      upsert.photo = patch.photo;
    }

    if (patch.name !== undefined) {
      upsert.name = patch.name;
    }

    if (patch.phone !== null && patch.phone !== undefined) {
      upsert.phone = patch.phone;
    }

    if (patch.status !== null && patch.status !== undefined) {
      upsert.status = patch.status;
    }

    if (patch.date !== null && patch.date !== undefined) {
      upsert.date = patch.date;
    }

    if (patch.started_at !== null && patch.started_at !== undefined) {
      upsert.started_at = patch.started_at;
    }

    if (patch.closed_at !== null && patch.closed_at !== undefined) {
      upsert.closed_at = patch.closed_at;
    }

    if (patch.protocol_ura !== null && patch.protocol_ura !== undefined) {
      upsert.protocol_ura = patch.protocol_ura;
    }

    if (patch.protocol_start !== null && patch.protocol_start !== undefined) {
      upsert.protocol_start = patch.protocol_start;
    }

    if (
      patch.protocol_transfer !== null &&
      patch.protocol_transfer !== undefined
    ) {
      upsert.protocol_transfer = patch.protocol_transfer;
    }

    if (patch.label !== null && patch.label !== undefined) {
      upsert.label = patch.label;
    }

    if (
      patch.embedded_for_ai_agents !== null &&
      patch.embedded_for_ai_agents !== undefined
    ) {
      upsert.embedded_for_ai_agents = patch.embedded_for_ai_agents;
    }

    if (
      patch.forward_to_output_chatbot !== null &&
      patch.forward_to_output_chatbot !== undefined
    ) {
      upsert.forward_to_output_chatbot = patch.forward_to_output_chatbot;
    }

    if (
      patch.chatbot_schedule_id !== null &&
      patch.chatbot_schedule_id !== undefined
    ) {
      upsert.chatbot_schedule_id = patch.chatbot_schedule_id;
    }

    if (
      patch.chatbot_webhook_id !== null &&
      patch.chatbot_webhook_id !== undefined
    ) {
      upsert.chatbot_webhook_id = patch.chatbot_webhook_id;
    }

    if (
      patch.chatbot_transfer_id !== null &&
      patch.chatbot_transfer_id !== undefined
    ) {
      upsert.chatbot_transfer_id = patch.chatbot_transfer_id;
    }

    if (patch.official_window !== null && patch.official_window !== undefined) {
      upsert.official_window = patch.official_window;
    }

    const outboundWebhookEventIds = Array.isArray(
      params.outbound_webhook_event_ids
    )
      ? params.outbound_webhook_event_ids
      : [];
    upsert.meta = patch.status
      ? {
          status_epoch: params.event_epoch_millis,
          status_event_id: params.event_id,
          status_source: params.status_source,
          outbound_webhook_event_ids: outboundWebhookEventIds,
        }
      : { outbound_webhook_event_ids: outboundWebhookEventIds };

    return upsert;
  }

  findChatByChatId = async (
    accountId: string,
    chatId: string
  ): Promise<IChat | null> => {
    const directChat = await this.elasticDatabaseService.getById<IChat>(
      EElasticIndex.chat,
      chatId
    );

    if (directChat) {
      if (directChat.account?.id !== accountId) {
        return null;
      }

      return this.normalizeChatData(directChat);
    }

    const queryElastic = {
      size: 1,
      _source: true,
      query: {
        bool: {
          must: [
            {
              nested: {
                path: 'account',
                query: {
                  term: {
                    'account.id': accountId,
                  },
                },
              },
            },
          ],
          filter: [
            {
              term: {
                chat_id: chatId,
              },
            },
          ],
        },
      },
    };

    const result = await this.elasticDatabaseService.select<IChat>(
      EElasticIndex.chat,
      queryElastic
    );

    const hit = result?.hits?.hits?.[0] as ElasticHit<IChat> | undefined;
    const chat = hit?._source ?? null;

    return this.normalizeChatData(chat);
  };

  updateChatStatus = async (
    chatId: string,
    status: IChat['status'],
    user?: IChat['user'] | null,
    startedAt?: string | null,
    closedAt?: string | null,
    eventEpochMillis?: number,
    eventId?: string,
    outboundWebhook?: ChatOutboundWebhookMutation
  ): Promise<boolean> => {
    const patch: ChatPatch = {
      status,
    };

    if (user !== undefined) {
      patch.user = user;
    }

    if (startedAt !== undefined) {
      patch.started_at = startedAt;
    }

    if (closedAt !== undefined) {
      patch.closed_at = closedAt;
    }

    const intendedChat = outboundWebhook?.previousChat
      ? ({ ...outboundWebhook.previousChat, ...patch } as IChat)
      : null;
    const preparedWebhookEvents = intendedChat
      ? await this.prepareChatWebhookEvents(intendedChat, outboundWebhook)
      : [];

    const application = await this.applyChatPatchWithResult(chatId, patch, {
      eventEpochMillis,
      eventId,
      allowCreate: false,
      outboundWebhookEventIds: preparedWebhookEvents.map(
        ({ prepared }) => prepared.eventId
      ),
    });

    if (!application.applied) {
      return false;
    }

    if (preparedWebhookEvents.length > 0 && intendedChat) {
      const confirmedChat = await this.findChatForWebhookConfirmation(
        intendedChat.account.id,
        chatId
      );
      if (!confirmedChat) {
        console.warn('[OutboundWebhook] Chat confirmation deferred', {
          account_id: intendedChat.account.id,
          chat_id: chatId,
        });
        return application.persistenceResult !== 'noop';
      }
      if (!this.chatMatchesPatch(confirmedChat, patch)) {
        return false;
      }
      await this.completeChatWebhookEvents(
        confirmedChat,
        outboundWebhook,
        preparedWebhookEvents
      );
    }

    return true;
  };

  updateChatUserAndSector = async (
    chatId: string,
    user?: IChat['user'] | null,
    sector?: IChat['sector'] | null,
    eventEpochMillis?: number,
    eventId?: string,
    outboundWebhook?: ChatOutboundWebhookMutation
  ): Promise<boolean> => {
    const patch: ChatPatch = {};

    if (user !== undefined) {
      patch.user = user;
    }

    if (sector !== undefined) {
      patch.sector = sector;
    }

    const intendedChat = outboundWebhook?.previousChat
      ? ({ ...outboundWebhook.previousChat, ...patch } as IChat)
      : null;
    const preparedWebhookEvents = intendedChat
      ? await this.prepareChatWebhookEvents(intendedChat, outboundWebhook)
      : [];

    const application = await this.applyChatPatchWithResult(chatId, patch, {
      eventEpochMillis,
      eventId,
      allowCreate: false,
      outboundWebhookEventIds: preparedWebhookEvents.map(
        ({ prepared }) => prepared.eventId
      ),
    });

    if (!application.applied) {
      return false;
    }

    if (preparedWebhookEvents.length > 0 && intendedChat) {
      const confirmedChat = await this.findChatForWebhookConfirmation(
        intendedChat.account.id,
        chatId
      );
      if (!confirmedChat) {
        console.warn('[OutboundWebhook] Chat confirmation deferred', {
          account_id: intendedChat.account.id,
          chat_id: chatId,
        });
        return application.persistenceResult !== 'noop';
      }
      if (!this.chatMatchesPatch(confirmedChat, patch)) {
        return false;
      }
      await this.completeChatWebhookEvents(
        confirmedChat,
        outboundWebhook,
        preparedWebhookEvents
      );
    }

    return true;
  };

  updateChatLabel = async (
    chatId: string,
    label?: IChat['label'] | null,
    eventEpochMillis?: number,
    eventId?: string,
    outboundWebhook?: ChatOutboundWebhookMutation
  ): Promise<boolean> => {
    const patch: ChatPatch = {};

    if (label !== undefined) {
      patch.label = label;
    }

    return this.applyChatPatch(chatId, patch, {
      eventEpochMillis,
      eventId,
      allowCreate: false,
      outboundWebhook,
    });
  };

  mutateSecondaryUserAtomically = async (
    input: MutateChatSecondaryUserInput
  ): Promise<IChat | null> => {
    const existingSecondaryUsers = Array.isArray(input.chat.secondary_users)
      ? input.chat.secondary_users
      : [];
    const intendedSecondaryUsers =
      input.operation === 'join'
        ? [
            ...existingSecondaryUsers.filter(
              (user) =>
                user.id !== input.user.id && user.id !== input.chat.user?.id
            ),
            input.user,
          ]
        : existingSecondaryUsers.filter(
            (user) =>
              user.id !== input.user.id && user.id !== input.chat.user?.id
          );
    const intendedChat: IChat = {
      ...input.chat,
      secondary_users: intendedSecondaryUsers,
    };
    const preparedWebhookEvents = await this.prepareChatWebhookEvents(
      intendedChat,
      input.outboundWebhook
    );
    const eventIds = preparedWebhookEvents.map(
      ({ prepared }) => prepared.eventId
    );
    const assignmentEventId = uuidv7();
    const assignmentEpoch = Date.now();

    const result = await this.elasticDatabaseService.updateWithScriptOCC(
      EElasticIndex.chat,
      input.chat.chat_id,
      {
        source: `
            if (ctx._source == null || ctx._source.status != params.expected_status) {
              ctx.op = 'noop';
              return;
            }
            if (ctx._source.secondary_users == null) {
              ctx._source.secondary_users = [];
            }
            def primaryUserId = ctx._source.user != null ? ctx._source.user.id : null;
            if (primaryUserId != null && primaryUserId == params.user.id) {
              ctx.op = 'noop';
              return;
            }

            def matchingIndexes = [];
            for (int index = 0; index < ctx._source.secondary_users.size(); index++) {
              def participant = ctx._source.secondary_users[index];
              if (participant != null && participant.id == params.user.id) {
                matchingIndexes.add(index);
              }
            }

            def desiredStateReached = false;
            def changed = false;
            if (params.operation == 'join') {
              if (matchingIndexes.size() > 0) {
                ctx.op = 'noop';
                return;
              }
              ctx._source.secondary_users.add(params.user);
              changed = true;
              desiredStateReached = true;
            } else {
              if (matchingIndexes.size() == 0) {
                ctx.op = 'noop';
                return;
              }
              for (int index = matchingIndexes.size() - 1; index >= 0; index--) {
                ctx._source.secondary_users.remove((int) matchingIndexes[index]);
                changed = true;
              }
              desiredStateReached = true;
            }

            if (desiredStateReached && params.event_ids != null) {
              if (ctx._source.meta == null) ctx._source.meta = [:];
              ctx._source.meta.assignment_event_id = params.assignment_event_id;
              ctx._source.meta.assignment_epoch = params.assignment_epoch;
              if (ctx._source.meta.outbound_webhook_event_ids == null) {
                ctx._source.meta.outbound_webhook_event_ids = [];
              }
              for (def eventId : params.event_ids) {
                if (!ctx._source.meta.outbound_webhook_event_ids.contains(eventId)) {
                  ctx._source.meta.outbound_webhook_event_ids.add(eventId);
                  changed = true;
                }
              }
              while (ctx._source.meta.outbound_webhook_event_ids.size() > 256) {
                ctx._source.meta.outbound_webhook_event_ids.remove(0);
              }
            }
            if (!changed) ctx.op = 'noop';
          `,
        params: {
          operation: input.operation,
          user: input.user,
          expected_status: EChatStatus.in_chat,
          event_ids: eventIds,
          assignment_event_id: assignmentEventId,
          assignment_epoch: assignmentEpoch,
        },
      },
      { upsert: false, maxRetries: 5, refresh: true }
    );

    if (result !== 'updated' && result !== 'noop') {
      return null;
    }

    const confirmedChat = await this.findChatForWebhookConfirmation(
      input.accountId,
      input.chat.chat_id
    );
    if (!confirmedChat) {
      console.warn('[OutboundWebhook] Chat confirmation deferred', {
        account_id: input.accountId,
        chat_id: input.chat.chat_id,
      });
      if (result !== 'updated') {
        return null;
      }
      return {
        ...intendedChat,
        meta: {
          ...(intendedChat.meta ?? {}),
          assignment_event_id: assignmentEventId,
          assignment_epoch: assignmentEpoch,
          outbound_webhook_event_ids: [
            ...new Set([
              ...(intendedChat.meta?.outbound_webhook_event_ids ?? []),
              ...eventIds,
            ]),
          ].slice(-256),
        },
      };
    }
    const isDesired =
      input.operation === 'join'
        ? Boolean(
            confirmedChat.secondary_users?.some(
              (user) => user.id === input.user.id
            )
          )
        : !confirmedChat.secondary_users?.some(
            (user) => user.id === input.user.id
          );
    if (!isDesired) {
      return null;
    }

    const mutationApplied = eventIds.every((eventId) =>
      confirmedChat.meta?.outbound_webhook_event_ids?.includes(eventId)
    );
    if (!mutationApplied) {
      return confirmedChat;
    }

    await this.completeChatWebhookEvents(
      confirmedChat,
      input.outboundWebhook,
      preparedWebhookEvents
    );
    return confirmedChat;
  };

  updateForwardToOutputChatbot = async (
    chatId: string,
    forwardToOutputChatbot: boolean,
    outboundWebhook?: ChatOutboundWebhookMutation
  ): Promise<boolean> => {
    const patch: ChatPatch = {
      forward_to_output_chatbot: forwardToOutputChatbot,
    };
    return this.applyChatPatch(chatId, patch, {
      allowCreate: false,
      outboundWebhook,
    });
  };

  updateChatNameIfMissing = async (
    chat: IChat,
    name: string,
    outboundWebhook?: ChatOutboundWebhookMutation
  ): Promise<IChat | null> => {
    const assertActive =
      outboundWebhook?.assertActive ?? getKafkaDispatchGuard();
    await assertActive?.();
    const intendedChat: IChat = { ...chat, name };
    const preparedWebhookEvents = await this.prepareChatWebhookEvents(
      intendedChat,
      outboundWebhook
    );
    const result = await this.elasticDatabaseService.updateWithScriptOCC(
      EElasticIndex.chat,
      chat.chat_id,
      {
        source: `
            if (ctx._source == null) {
              ctx.op = 'noop';
              return;
            }
            def changed = false;
            if (ctx._source.name == null || ctx._source.name == '') {
              ctx._source.name = params.name;
              changed = true;
            } else if (ctx._source.name != params.name) {
              ctx.op = 'noop';
              return;
            }
            if (params.outbound_webhook_event_ids != null) {
              if (ctx._source.meta == null) ctx._source.meta = [:];
              if (ctx._source.meta.outbound_webhook_event_ids == null) {
                ctx._source.meta.outbound_webhook_event_ids = [];
              }
              for (def eventId : params.outbound_webhook_event_ids) {
                if (!ctx._source.meta.outbound_webhook_event_ids.contains(eventId)) {
                  ctx._source.meta.outbound_webhook_event_ids.add(eventId);
                  changed = true;
                }
              }
              while (ctx._source.meta.outbound_webhook_event_ids.size() > 256) {
                ctx._source.meta.outbound_webhook_event_ids.remove(0);
              }
            }
            if (!changed) ctx.op = 'noop';
          `,
        params: {
          name,
          outbound_webhook_event_ids: preparedWebhookEvents.map(
            ({ prepared }) => prepared.eventId
          ),
        },
      },
      { maxRetries: 5, refresh: true, assertActive }
    );
    await assertActive?.();

    const confirmedChat = await this.findChatForWebhookConfirmation(
      chat.account.id,
      chat.chat_id
    );
    await assertActive?.();
    if (!confirmedChat && result === 'updated') {
      // The guarded script only reports `updated` after reaching the requested
      // name and persisting any journal markers. Preserve the primary mutation
      // when the immediate realtime read is transiently unavailable.
      const confirmedByWrite: IChat = {
        ...intendedChat,
        meta: {
          ...(intendedChat.meta ?? {}),
          outbound_webhook_event_ids: [
            ...new Set([
              ...(intendedChat.meta?.outbound_webhook_event_ids ?? []),
              ...preparedWebhookEvents.map(({ prepared }) => prepared.eventId),
            ]),
          ].slice(-256),
        },
      };
      await this.completeChatWebhookEvents(
        confirmedByWrite,
        outboundWebhook,
        preparedWebhookEvents
      );
      return confirmedByWrite;
    }
    const applied =
      (result === 'updated' || result === 'created' || result === 'noop') &&
      confirmedChat?.name === name;

    if (!applied || !confirmedChat) {
      return confirmedChat;
    }

    await this.completeChatWebhookEvents(
      confirmedChat,
      outboundWebhook,
      preparedWebhookEvents
    );
    return confirmedChat;
  };

  transferAutomationChatToQueue = async (
    input: TransferAutomationChatToQueueInput
  ): Promise<TransferAutomationChatToQueueResult> => {
    const currentChat = await this.findChatByChatId(
      input.accountId,
      input.chat.chat_id
    );

    if (!currentChat) {
      return {
        chat: null,
        previousChat: null,
        applied: false,
        alreadyHuman: false,
      };
    }

    if (!isChatbotStatus(currentChat.status)) {
      return {
        chat: currentChat,
        previousChat: currentChat,
        applied: false,
        alreadyHuman: isHumanAttendanceStatus(currentChat.status),
      };
    }

    const patch: ChatPatch = {
      worker: input.worker ?? currentChat.worker,
      user: input.user ?? null,
      sector: input.sector ?? null,
      secondary_users: input.secondaryUsers ?? [],
      status: EChatStatus.queue,
      forward_to_output_chatbot: true,
      chatbot_transfer_id: null,
      chatbot_schedule_id: null,
      chatbot_webhook_id: null,
    };
    const eventEpochMillis = input.eventEpochMillis ?? Date.now();
    const eventId = input.eventId ?? uuidv7();

    const intendedChat: IChat = {
      ...currentChat,
      ...patch,
      status: EChatStatus.queue,
    };
    const preparedWebhookEvents = await this.prepareChatWebhookEvents(
      intendedChat,
      input.outboundWebhook
    );

    const webhookEventIds = preparedWebhookEvents.map(
      ({ prepared }) => prepared.eventId
    );
    const application = await this.applyChatPatchWithResult(
      currentChat.chat_id,
      patch,
      {
        allowCreate: false,
        expectedCurrentStatuses: [...CHATBOT_STATUSES],
        refresh: true,
        enforceExpectedStatusRevision: true,
        enforceAssignmentRevision: true,
        enforceExpectedStartedAt: true,
        enforceExpectedLastMessageId: true,
        expectedStatusEventId: currentChat.meta?.status_event_id ?? null,
        expectedStatusEpoch: currentChat.meta?.status_epoch ?? null,
        expectedStartedAt: currentChat.started_at ?? null,
        expectedLastMessageId: currentChat.summary?.last_message_id ?? null,
        eventEpochMillis,
        eventId,
        statusSource: 'chat_service',
        outboundWebhookEventIds: webhookEventIds,
      }
    );

    const freshChat = await this.findChatForWebhookConfirmation(
      input.accountId,
      currentChat.chat_id
    );

    if (!freshChat && application.persistenceResult === 'updated') {
      // `updated` proves the guarded transition and its journal markers were
      // applied. A transient confirmation read must not turn that successful
      // handoff into a user-visible transfer failure. `noop` remains
      // deliberately excluded because it can also mean a precondition lost.
      const confirmedByWrite: IChat = {
        ...intendedChat,
        meta: {
          ...(intendedChat.meta ?? {}),
          status_epoch: eventEpochMillis,
          status_event_id: eventId,
          status_source: 'chat_service',
          outbound_webhook_event_ids: [
            ...new Set([
              ...(intendedChat.meta?.outbound_webhook_event_ids ?? []),
              ...webhookEventIds,
            ]),
          ].slice(-256),
        },
      };
      await this.completeChatWebhookEvents(
        confirmedByWrite,
        input.outboundWebhook,
        preparedWebhookEvents
      );
      return {
        chat: confirmedByWrite,
        previousChat: currentChat,
        applied: true,
        alreadyHuman: isHumanAttendanceStatus(confirmedByWrite.status),
      };
    }

    const wasApplied =
      application.applied &&
      freshChat?.status === EChatStatus.queue &&
      freshChat.meta?.status_event_id === eventId;

    if (wasApplied && freshChat) {
      await this.completeChatWebhookEvents(
        freshChat,
        input.outboundWebhook,
        preparedWebhookEvents
      );
    }

    return {
      chat: freshChat,
      previousChat: currentChat,
      applied: wasApplied,
      alreadyHuman: isHumanAttendanceStatus(freshChat?.status),
    };
  };

  reassignPendingOperatorReply = async (
    input: ReassignPendingOperatorReplyInput
  ): Promise<ReassignPendingOperatorReplyResult> => {
    const previousUser = input.chat.user;
    if (!previousUser) {
      return { applied: false, chat: input.chat };
    }

    const enteredAt = new Date(input.eventEpochMillis).toISOString();
    const nextUser = { ...input.nextUser, entered_at: enteredAt };
    const intendedChat: IChat = {
      ...input.chat,
      status: EChatStatus.in_chat,
      user: nextUser,
      secondary_users: [],
      meta: {
        ...(input.chat.meta ?? {}),
        assignment_event_id: input.eventId,
        assignment_epoch: input.eventEpochMillis,
      },
    };
    const mutation: ChatOutboundWebhookMutation = {
      eventTypes: ['chat.transferred'],
      idempotencyKey: `operator-reply-pending-redistribution:${input.eventId}`,
      source: 'operator_reply_pending_redistribution',
      previousChat: input.chat,
      actor: { type: 'system' },
      changes: {
        reason: 'operator_reply_pending',
        previous_user_id: previousUser.id,
        target_user_id: nextUser.id,
        status: EChatStatus.in_chat,
      },
    };
    const preparedEvents = await this.prepareChatWebhookEvents(
      intendedChat,
      mutation
    );
    const webhookEventIds = preparedEvents.map(
      ({ prepared }) => prepared.eventId
    );

    const result = await this.elasticDatabaseService.updateWithScriptOCC(
      EElasticIndex.chat,
      input.chat.chat_id,
      {
        source: `
          if (ctx._source == null ||
              ctx._source.status != params.expected_status ||
              ctx._source.user == null ||
              ctx._source.user.id != params.expected_primary_user_id) {
            ctx.op = 'noop';
            return;
          }
          if (ctx._source.meta == null) ctx._source.meta = [:];
          if (ctx._source.meta.assignment_event_id == params.event_id) {
            ctx.op = 'noop';
            return;
          }
          if (ctx._source.meta.assignment_event_id != params.expected_assignment_event_id ||
              ctx._source.meta.assignment_epoch != params.expected_assignment_epoch ||
              ctx._source.meta.status_event_id != params.expected_status_event_id ||
              ctx._source.meta.status_epoch != params.expected_status_epoch) {
            ctx.op = 'noop';
            return;
          }
          if (ctx._source.summary == null || ctx._source.summary.size() == 0) {
            ctx.op = 'noop';
            return;
          }
          def summary = ctx._source.summary instanceof List
            ? ctx._source.summary[0]
            : ctx._source.summary;
          if (summary.last_message_id != params.expected_last_message_id ||
              (summary.revision == null ? 0 : summary.revision) != params.expected_summary_revision ||
              summary.operator_reply_pending_since != params.expected_pending_since) {
            ctx.op = 'noop';
            return;
          }

          ctx._source.user = params.next_user;
          ctx._source.secondary_users = [];
          ctx._source.meta.assignment_event_id = params.event_id;
          ctx._source.meta.assignment_epoch = params.event_epoch;
          if (ctx._source.meta.outbound_webhook_event_ids == null) {
            ctx._source.meta.outbound_webhook_event_ids = [];
          }
          for (def webhookEventId : params.webhook_event_ids) {
            if (!ctx._source.meta.outbound_webhook_event_ids.contains(webhookEventId)) {
              ctx._source.meta.outbound_webhook_event_ids.add(webhookEventId);
            }
          }
          while (ctx._source.meta.outbound_webhook_event_ids.size() > 256) {
            ctx._source.meta.outbound_webhook_event_ids.remove(0);
          }
        `,
        params: {
          expected_status: EChatStatus.in_chat,
          expected_primary_user_id: input.expectedPrimaryUserId,
          expected_assignment_event_id: input.expectedAssignmentEventId,
          expected_assignment_epoch: input.expectedAssignmentEpoch,
          expected_status_event_id: input.expectedStatusEventId,
          expected_status_epoch: input.expectedStatusEpoch,
          expected_last_message_id: input.expectedLastMessageId,
          expected_summary_revision: input.expectedSummaryRevision,
          expected_pending_since: input.expectedPendingSince,
          event_id: input.eventId,
          event_epoch: input.eventEpochMillis,
          next_user: nextUser,
          webhook_event_ids: webhookEventIds,
        },
      },
      { upsert: false, maxRetries: 5, refresh: true }
    );

    const confirmed = await this.findChatForWebhookConfirmation(
      input.accountId,
      input.chat.chat_id
    );
    const applied =
      !!confirmed &&
      confirmed.meta?.assignment_event_id === input.eventId &&
      confirmed.user?.id === input.nextUser.id;

    if (applied && confirmed) {
      await this.completeChatWebhookEvents(confirmed, mutation, preparedEvents);
      await this.invalidateChatCache(confirmed);
      return { applied: true, chat: confirmed };
    }

    if (
      result !== 'updated' &&
      this.outboundWebhookEventService &&
      preparedEvents.length > 0
    ) {
      await Promise.allSettled(
        preparedEvents.map(({ prepared }) =>
          this.outboundWebhookEventService?.cancel(prepared.eventId)
        )
      );
    }

    return { applied: false, chat: confirmed };
  };

  getOrCreateChatProtocol = async (
    accountId: string,
    chatId: string,
    protocolType: ChatProtocolType
  ): Promise<string | null> => {
    const chat = await this.findChatByChatId(accountId, chatId);
    if (!chat) {
      return null;
    }

    const existingProtocol = this.getLatestProtocolByType(chat, protocolType);
    if (existingProtocol) {
      await this.cacheCanonicalChatBestEffort(chat);
      return existingProtocol;
    }

    const protocol = generateProtocol();
    const intendedChat: IChat = {
      ...chat,
      [protocolType]: [...(chat[protocolType] ?? []), protocol],
    };
    const mutation: ChatOutboundWebhookMutation = {
      eventTypes: ['chat.protocol.updated'],
      idempotencyKey: `chat-protocol:${chatId}:${protocolType}:${protocol}`,
      source: 'chat_service',
      previousChat: chat,
      actor: { type: 'system' },
      changes: {
        protocol_type: protocolType,
        protocol,
      },
    };
    const preparedWebhookEvents = await this.prepareChatWebhookEvents(
      intendedChat,
      mutation
    );
    const webhookEventIds = preparedWebhookEvents.map(
      ({ prepared }) => prepared.eventId
    );
    const persistenceResult =
      await this.elasticDatabaseService.updateWithScriptOCC(
        EElasticIndex.chat,
        chatId,
        {
          source: `
            def protocols = ctx._source[params.protocol_type];
            if (protocols != null) {
              for (def existingProtocol : protocols) {
                if (existingProtocol != null && existingProtocol instanceof String && existingProtocol.trim().length() > 0) {
                  ctx.op = 'noop';
                  return;
                }
              }
            }

            ctx._source[params.protocol_type] = [params.protocol];
            if (params.outbound_webhook_event_ids != null && !params.outbound_webhook_event_ids.isEmpty()) {
              if (ctx._source.meta == null) ctx._source.meta = [:];
              if (ctx._source.meta.outbound_webhook_event_ids == null) {
                ctx._source.meta.outbound_webhook_event_ids = [];
              }
              for (def eventId : params.outbound_webhook_event_ids) {
                if (!ctx._source.meta.outbound_webhook_event_ids.contains(eventId)) {
                  ctx._source.meta.outbound_webhook_event_ids.add(eventId);
                }
              }
              while (ctx._source.meta.outbound_webhook_event_ids.size() > 256) {
                ctx._source.meta.outbound_webhook_event_ids.remove(0);
              }
            }
          `,
          params: {
            protocol_type: protocolType,
            protocol,
            outbound_webhook_event_ids: webhookEventIds,
          },
        },
        { upsert: false, maxRetries: 5, refresh: true }
      );

    if (persistenceResult !== 'updated') {
      // This candidate has a unique idempotency key. If another caller won the
      // compare-and-set, its canonical protocol is returned and only this
      // losing intent is cancelled.
      if (this.outboundWebhookEventService) {
        await Promise.allSettled(
          preparedWebhookEvents.map(({ prepared }) =>
            this.outboundWebhookEventService?.cancel(prepared.eventId)
          )
        );
      }

      if (persistenceResult !== 'noop') return null;
      const winner = await this.findChatForWebhookConfirmation(
        accountId,
        chatId
      );
      if (!winner) return null;
      await this.cacheCanonicalChatBestEffort(winner);
      return this.getLatestProtocolByType(winner, protocolType);
    }

    const confirmedChat = await this.findChatForWebhookConfirmation(
      accountId,
      chatId
    );
    if (!confirmedChat) {
      console.warn('[OutboundWebhook] Chat confirmation deferred', {
        account_id: accountId,
        chat_id: chatId,
      });
      const confirmedByWrite: IChat = {
        ...intendedChat,
        meta: {
          ...(intendedChat.meta ?? {}),
          outbound_webhook_event_ids: [
            ...new Set([
              ...(intendedChat.meta?.outbound_webhook_event_ids ?? []),
              ...webhookEventIds,
            ]),
          ].slice(-256),
        },
      };
      await this.completeChatWebhookEvents(
        confirmedByWrite,
        mutation,
        preparedWebhookEvents
      );
      await this.cacheCanonicalChatBestEffort(confirmedByWrite);
      return protocol;
    }
    await this.completeChatWebhookEvents(
      confirmedChat,
      mutation,
      preparedWebhookEvents
    );
    await this.cacheCanonicalChatBestEffort(confirmedChat);

    return this.getLatestProtocolByType(confirmedChat, protocolType);
  };

  getLatestProtocolByType = (
    chat: IChat,
    protocolType: ChatProtocolType
  ): string | null => {
    const protocols = chat[protocolType] ?? [];
    if (protocols.length === 0) {
      return null;
    }

    return protocols[protocols.length - 1] ?? null;
  };

  updateChatSatisfactionResponse = async (
    chatId: string,
    data: {
      question: string;
      options: { id: string; text: string }[];
      response: { id: string; text: string };
      analyst?: { id: string; name: string | null } | null;
    },
    outboundWebhook?: ChatOutboundWebhookMutation
  ): Promise<boolean> => {
    const mappings = chatMappings();
    const indicesResult = await this.elasticDatabaseService.indices(
      EElasticIndex.chat,
      mappings
    );

    if (!indicesResult) {
      return false;
    }

    const intendedChat = outboundWebhook?.previousChat
      ? ({
          ...outboundWebhook.previousChat,
          satisfaction_response: data,
        } as IChat)
      : null;
    const preparedWebhookEvents = intendedChat
      ? await this.prepareChatWebhookEvents(intendedChat, outboundWebhook)
      : [];

    const result = await this.elasticDatabaseService.updateWithScriptOCC(
      EElasticIndex.chat,
      chatId,
      {
        source: `
            if (ctx._source == null) {
              ctx.op = 'noop';
              return;
            }
            ctx._source.satisfaction_response = params.satisfaction_response;
            if (ctx._source.meta == null) ctx._source.meta = [:];
            if (ctx._source.meta.outbound_webhook_event_ids == null) {
              ctx._source.meta.outbound_webhook_event_ids = [];
            }
            for (def eventId : params.outbound_webhook_event_ids) {
              if (!ctx._source.meta.outbound_webhook_event_ids.contains(eventId)) {
                ctx._source.meta.outbound_webhook_event_ids.add(eventId);
              }
            }
            while (ctx._source.meta.outbound_webhook_event_ids.size() > 256) {
              ctx._source.meta.outbound_webhook_event_ids.remove(0);
            }
          `,
        params: {
          satisfaction_response: data,
          outbound_webhook_event_ids: preparedWebhookEvents.map(
            ({ prepared }) => prepared.eventId
          ),
        },
      },
      { upsert: false, maxRetries: 5 }
    );

    if (result !== 'updated' && result !== 'noop') {
      return false;
    }

    if (preparedWebhookEvents.length > 0 && outboundWebhook?.previousChat) {
      const confirmedChat = await this.findChatForWebhookConfirmation(
        outboundWebhook.previousChat.account.id,
        chatId
      );
      if (!confirmedChat) {
        console.warn('[OutboundWebhook] Chat confirmation deferred', {
          account_id: outboundWebhook.previousChat.account.id,
          chat_id: chatId,
        });
        return result !== 'noop';
      }
      await this.completeChatWebhookEvents(
        confirmedChat,
        outboundWebhook,
        preparedWebhookEvents
      );
    }

    return true;
  };

  countInChatChatsByUserId = async (
    accountId: string,
    workerId: string,
    userId: string
  ): Promise<number> => {
    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);
    const startOfTodayIso = startOfToday.toISOString();

    const queryElastic = {
      size: 0,
      query: {
        bool: {
          must: [
            {
              nested: {
                path: 'account',
                query: {
                  term: {
                    'account.id': accountId,
                  },
                },
              },
            },
            {
              nested: {
                path: 'worker',
                query: {
                  term: {
                    'worker.id': workerId,
                  },
                },
              },
            },
            {
              ...this.buildParticipantFilter(userId),
            },
            {
              term: {
                status: EChatStatus.in_chat,
              },
            },
            {
              range: {
                started_at: {
                  gte: startOfTodayIso,
                },
              },
            },
          ],
        },
      },
    };

    const result = await this.elasticDatabaseService.select<IChat>(
      EElasticIndex.chat,
      queryElastic
    );

    const total = result?.hits?.total;
    if (typeof total === 'number') {
      return total;
    }

    return total?.value ?? 0;
  };

  countQueueChatsByUserId = async (
    accountId: string,
    workerId: string,
    userId: string
  ): Promise<number> => {
    const queryElastic = {
      size: 0,
      query: {
        bool: {
          must: [
            {
              nested: {
                path: 'account',
                query: {
                  term: {
                    'account.id': accountId,
                  },
                },
              },
            },
            {
              nested: {
                path: 'worker',
                query: {
                  term: {
                    'worker.id': workerId,
                  },
                },
              },
            },
            {
              ...this.buildParticipantFilter(userId),
            },
            {
              term: {
                status: EChatStatus.queue,
              },
            },
          ],
        },
      },
    };

    const result = await this.elasticDatabaseService.select<IChat>(
      EElasticIndex.chat,
      queryElastic
    );

    const total = result?.hits?.total;
    if (typeof total === 'number') {
      return total;
    }

    return total?.value ?? 0;
  };

  countTotalChatsByUserId = async (
    accountId: string,
    workerId: string,
    userId: string
  ): Promise<{ inChat: number; queue: number; total: number }> => {
    const [inChat, queue] = await Promise.all([
      this.countInChatChatsByUserId(accountId, workerId, userId),
      this.countQueueChatsByUserId(accountId, workerId, userId),
    ]);

    return {
      inChat,
      queue,
      total: inChat + queue,
    };
  };

  countOpenChatsByWorkerId = async (
    accountId: string,
    workerId: string
  ): Promise<number> => {
    const queryElastic = {
      size: 0,
      query: {
        bool: {
          must: [
            {
              nested: {
                path: 'account',
                query: {
                  term: {
                    'account.id': accountId,
                  },
                },
              },
            },
            {
              nested: {
                path: 'worker',
                query: {
                  term: {
                    'worker.id': workerId,
                  },
                },
              },
            },
          ],
          must_not: [
            {
              term: {
                status: EChatStatus.closed,
              },
            },
          ],
        },
      },
    };

    const result = await this.elasticDatabaseService.select<IChat>(
      EElasticIndex.chat,
      queryElastic
    );

    const total = result?.hits?.total;
    if (typeof total === 'number') {
      return total;
    }

    return total?.value ?? 0;
  };

  updateChatSummaryAtomically = async (
    chatId: string,
    lastMessage: string | null,
    lastDate: string,
    lastDateEpochMillis: number,
    lastMessageId: string | null,
    processedMessageId: string | null,
    incrementUnreadCount: boolean,
    messageAuthorTypeUser: ETypeUserChat | null,
    updateOperatorReplyPending: boolean,
    clearUnreadCount = false
  ): Promise<boolean> => {
    const assertActive = getKafkaDispatchGuard();
    await assertActive?.();
    const operatorReplyPendingSince =
      updateOperatorReplyPending &&
      messageAuthorTypeUser === ETypeUserChat.client
        ? lastDate
        : null;

    const baseline = this.createChatSummaryBaseline(
      lastMessage,
      lastDate,
      lastDateEpochMillis,
      lastMessageId,
      processedMessageId,
      operatorReplyPendingSince,
      incrementUnreadCount
    );
    const scriptParams = this.buildChatSummaryAtomicScriptParams(
      baseline,
      lastMessage,
      lastDate,
      lastDateEpochMillis,
      lastMessageId,
      processedMessageId,
      incrementUnreadCount,
      messageAuthorTypeUser,
      updateOperatorReplyPending,
      clearUnreadCount
    );
    const scriptSource = this.buildChatSummaryAtomicUpdateScript();

    const result =
      await this.elasticDatabaseService.updateWithScriptOCC<ChatSummaryAtomicUpdateParams>(
        EElasticIndex.chat,
        chatId,
        { source: scriptSource, params: scriptParams },
        {
          upsert: false,
          maxRetries: 5,
          refresh: true,
          assertActive,
        }
      );
    await assertActive?.();

    if (result === 'conflict') {
    }

    return result === 'updated' || result === 'noop';
  };

  private buildChatSummaryAtomicUpdateScript(): string {
    return `
      if (ctx._source.summary == null || ctx._source.summary.size() == 0) {
        ctx._source.summary = [params.baseline];
        return;
      }

      def isList = ctx._source.summary instanceof List;
      def summaryIndex = isList ? 0 : null;
      def summary = isList ? ctx._source.summary[summaryIndex] : ctx._source.summary;

      if (summary.unread_count == null) {
        summary.unread_count = 0;
      }

      if (summary.revision == null) {
        summary.revision = 0L;
      }

      if (summary.last_date_epoch_millis == null) {
        summary.last_date_epoch_millis = 0;
      }

      if (summary.last_processed_message_id == null) {
        summary.last_processed_message_id = null;
      }

      if (summary.operator_reply_pending_since == null) {
        summary.operator_reply_pending_since = null;
      }

      def changed = false;
      def messageUpdated = false;

      def currentEpoch = summary.last_date_epoch_millis;
      def newEpoch = params.last_date_epoch_millis;
      def shouldUpdateMessage = false;

      if (newEpoch > currentEpoch) {
        shouldUpdateMessage = true;
      } else if (newEpoch == currentEpoch && params.last_message_id != null) {
        def currentMessageId = summary.last_message_id != null ? summary.last_message_id : '';
        def newMessageId = params.last_message_id;
        if (currentMessageId == '' || newMessageId.compareTo(currentMessageId) > 0) {
          shouldUpdateMessage = true;
        }
      }

      if (shouldUpdateMessage) {
        summary.last_message = params.last_message;
        summary.last_date = params.last_date;
        summary.last_date_epoch_millis = params.last_date_epoch_millis;
        if (params.last_message_id != null) {
          summary.last_message_id = params.last_message_id;
        }
        changed = true;
        messageUpdated = true;
      }

      if (params.update_operator_reply_pending == true) {
        if (messageUpdated && params.message_author_type_user == 'client') {
          if (summary.operator_reply_pending_since == null) {
            summary.operator_reply_pending_since = params.last_date;
            changed = true;
          }
        } else if (params.message_author_type_user == 'operator') {
          if (
            summary.operator_reply_pending_since != null &&
            params.last_date != null &&
            params.last_date.compareTo(summary.operator_reply_pending_since) >= 0
          ) {
            summary.operator_reply_pending_since = null;
            changed = true;
          }
        }
      }

      if (params.processed_message_id != null && params.increment_unread_count) {
        def lastProcessed = summary.last_processed_message_id;
        if (lastProcessed == null || lastProcessed != params.processed_message_id) {
          summary.unread_count = summary.unread_count + 1;
          summary.last_processed_message_id = params.processed_message_id;
          changed = true;
        }
      }

      if (
        params.clear_unread_count == true &&
        summary.unread_count != null &&
        summary.unread_count != 0
      ) {
        summary.unread_count = 0;
        changed = true;
      }

      if (!changed) {
        ctx.op = 'noop';
      } else {
        summary.revision = summary.revision.longValue() + 1L;
      }
    `;
  }

  private createChatSummaryBaseline(
    lastMessage: string | null,
    lastDate: string,
    lastDateEpochMillis: number,
    lastMessageId: string | null,
    processedMessageId: string | null,
    operatorReplyPendingSince: string | null,
    incrementUnreadCount: boolean
  ): ChatSummaryBaseline {
    return {
      revision: 1,
      last_message: lastMessage,
      last_date: lastDate,
      last_date_epoch_millis: lastDateEpochMillis,
      last_message_id: lastMessageId,
      last_processed_message_id: processedMessageId,
      operator_reply_pending_since: operatorReplyPendingSince,
      unread_count: incrementUnreadCount ? 1 : 0,
    };
  }

  private buildChatSummaryAtomicScriptParams(
    baseline: ChatSummaryBaseline,
    lastMessage: string | null,
    lastDate: string,
    lastDateEpochMillis: number,
    lastMessageId: string | null,
    processedMessageId: string | null,
    incrementUnreadCount: boolean,
    messageAuthorTypeUser: ETypeUserChat | null,
    updateOperatorReplyPending: boolean,
    clearUnreadCount: boolean
  ): ChatSummaryAtomicUpdateParams {
    return {
      baseline,
      last_message: lastMessage,
      last_date: lastDate,
      last_date_epoch_millis: lastDateEpochMillis,
      last_message_id: lastMessageId,
      processed_message_id: processedMessageId,
      increment_unread_count: incrementUnreadCount,
      clear_unread_count: clearUnreadCount,
      message_author_type_user: messageAuthorTypeUser,
      update_operator_reply_pending: updateOperatorReplyPending,
    };
  }

  clearChatSummary = async (
    chatId: string,
    accountId: string,
    options?: {
      operationId?: string;
      enforceExpectedLastMessageId?: boolean;
      expectedLastMessageId?: string | null;
      enforceExpectedSummaryRevision?: boolean;
      expectedSummaryRevision?: number | null;
      assertActive?: () => void | Promise<void>;
    }
  ): Promise<boolean> => {
    try {
      await options?.assertActive?.();
      const rawOperationId = options?.operationId?.trim() || null;
      const operationId =
        rawOperationId && rawOperationId.length <= 128 ? rawOperationId : null;
      const enforceExpectedSummaryRevision =
        options?.enforceExpectedSummaryRevision === true;
      const enforceExpectedLastMessageId =
        options?.enforceExpectedLastMessageId === true;
      const expectedSummaryRevision =
        typeof options?.expectedSummaryRevision === 'number' &&
        Number.isSafeInteger(options.expectedSummaryRevision) &&
        options.expectedSummaryRevision >= 0
          ? options.expectedSummaryRevision
          : null;
      const rawExpectedLastMessageId = options?.expectedLastMessageId;
      const expectedLastMessageId =
        typeof rawExpectedLastMessageId === 'string'
          ? rawExpectedLastMessageId.trim()
          : rawExpectedLastMessageId;
      const validExpectedLastMessageId =
        expectedLastMessageId === null ||
        (typeof expectedLastMessageId === 'string' &&
          expectedLastMessageId.length > 0 &&
          expectedLastMessageId.length <= 1_000);

      if (
        operationId === null ||
        !enforceExpectedSummaryRevision ||
        !enforceExpectedLastMessageId ||
        expectedSummaryRevision === null ||
        !validExpectedLastMessageId
      ) {
        return false;
      }

      const chat = await this.findChatByChatId(accountId, chatId);
      if (!chat) return false;

      const scriptSource = `
        if (ctx._source.summary == null || ctx._source.summary.size() == 0) {
          ctx.op = 'noop';
          return;
        }

        def isList = ctx._source.summary instanceof List;
        def summary = isList ? ctx._source.summary[0] : ctx._source.summary;
        def currentLastMessageId = summary.last_message_id;
        def currentSummaryRevision =
          summary.revision != null ? summary.revision.longValue() : 0L;

        if (params.enforce_expected_summary_revision == true) {
          def expectedSummaryRevision = params.expected_summary_revision;
          if (
            expectedSummaryRevision == null ||
            expectedSummaryRevision.longValue() != currentSummaryRevision
          ) {
            ctx.op = 'noop';
            return;
          }
        }

        if (params.enforce_expected_last_message_id == true) {
          def expectedLastMessageId = params.expected_last_message_id;
          if (
            (expectedLastMessageId == null && currentLastMessageId != null) ||
            (expectedLastMessageId != null && !expectedLastMessageId.equals(currentLastMessageId))
          ) {
            ctx.op = 'noop';
            return;
          }
        }

        if (ctx._source.meta == null) {
          ctx._source.meta = [:];
        }
        if (ctx._source.meta.clear_summary_operation_ids == null) {
          ctx._source.meta.clear_summary_operation_ids = [];
        }
        if (ctx._source.meta.clear_summary_operation_ids.contains(params.operation_id)) {
          ctx.op = 'noop';
          return;
        }
        ctx._source.meta.clear_summary_operation_ids.add(params.operation_id);
        while (ctx._source.meta.clear_summary_operation_ids.size() > 256) {
          ctx._source.meta.clear_summary_operation_ids.remove(0);
        }

        if (summary.unread_count == null || summary.unread_count != 0) {
          summary.unread_count = 0;
        }
        // Recording a new operation is itself a summary mutation. Advancing
        // the revision prevents an evicted journal entry from matching the
        // original OCC snapshot and being applied again.
        summary.revision = currentSummaryRevision + 1L;
      `;

      await options?.assertActive?.();
      const result = await this.elasticDatabaseService.updateWithScriptOCC(
        EElasticIndex.chat,
        chatId,
        {
          source: scriptSource,
          params: {
            operation_id: operationId,
            enforce_expected_last_message_id: enforceExpectedLastMessageId,
            expected_last_message_id: expectedLastMessageId,
            enforce_expected_summary_revision: enforceExpectedSummaryRevision,
            expected_summary_revision: expectedSummaryRevision,
          },
        },
        {
          upsert: false,
          maxRetries: 5,
          refresh: true,
          assertActive: options?.assertActive,
        }
      );
      await options?.assertActive?.();

      if (result === 'updated' || result === 'created') {
        return true;
      }
      if (result !== 'noop') {
        return false;
      }

      // Elasticsearch may have committed the script while its response was
      // lost. On retry the operation marker makes the script a noop; recover
      // that successful outcome so the caller can finish the realtime publish.
      await options?.assertActive?.();
      const currentChat = await this.findChatByChatId(accountId, chatId);
      await options?.assertActive?.();
      const operationAlreadyApplied =
        currentChat?.meta?.clear_summary_operation_ids?.includes(
          operationId
        ) === true && (currentChat.summary?.unread_count ?? 0) === 0;

      return operationAlreadyApplied;
    } catch (error) {
      await options?.assertActive?.();
      console.error('Error clearing chat summary:', error);
      return false;
    }
  };

  private isOpenChatStatus(
    status: IChat['status'] | null | undefined
  ): boolean {
    return OPEN_CHAT_STATUSES.includes(status as EChatStatus);
  }

  private buildChatIdentityShouldClauses(
    identity: ReturnType<typeof normalizeChatIdentity>
  ): Record<string, unknown>[] {
    const shouldClauses: Record<string, unknown>[] = [];

    if (identity.phoneCandidates.length > 0) {
      shouldClauses.push({ terms: { phone: identity.phoneCandidates } });
    }

    if (identity.jidCandidates.length > 0) {
      shouldClauses.push({
        nested: {
          path: 'message_key',
          query: {
            terms: {
              'message_key.remote_jid': identity.jidCandidates,
            },
          },
        },
      });
      shouldClauses.push({
        nested: {
          path: 'message_key',
          query: {
            terms: {
              'message_key.remote_jid_alt': identity.jidCandidates,
            },
          },
        },
      });
    }

    return shouldClauses;
  }

  private async patchChatMissingMessageKeyFields(
    chatId: string,
    messageKey: NonNullable<IChat['message_key']>
  ): Promise<boolean> {
    const result = await this.elasticDatabaseService.updateWithScriptOCC(
      EElasticIndex.chat,
      chatId,
      {
        source: `
          if (ctx._source == null) {
            ctx.op = 'noop';
            return;
          }
          if (ctx._source.message_key == null) {
            ctx._source.message_key = [:];
          }
          def changed = false;
          if (params.remote_jid != null && ctx._source.message_key.remote_jid == null) {
            ctx._source.message_key.remote_jid = params.remote_jid;
            changed = true;
          }
          if (params.remote_jid_alt != null && ctx._source.message_key.remote_jid_alt == null) {
            ctx._source.message_key.remote_jid_alt = params.remote_jid_alt;
            changed = true;
          }
          if (!changed) {
            ctx.op = 'noop';
          }
        `,
        params: {
          remote_jid: messageKey.remote_jid ?? null,
          remote_jid_alt: messageKey.remote_jid_alt ?? null,
        },
      },
      { maxRetries: 5 }
    );

    return result === 'updated' || result === 'noop';
  }

  private async ensureChatIdentityMessageKey(
    chat: IChat,
    input: ChatIdentityInput
  ): Promise<IChat> {
    const patch = buildMissingChatMessageKeyPatch(chat.message_key, input);
    if (!patch) {
      return chat;
    }

    let patched = false;
    try {
      patched = await this.patchChatMissingMessageKeyFields(
        chat.chat_id,
        patch
      );
    } catch (error) {
      console.error(
        '[ChatService] Failed to patch missing message_key fields',
        {
          account_id: chat.account.id,
          worker_id: chat.worker.id,
          chat_id: chat.chat_id,
          ...workerErrorDiagnostics(error),
        }
      );
    }

    if (!patched) {
      return chat;
    }

    const patchedChat: IChat = {
      ...chat,
      message_key: {
        ...(chat.message_key ?? {}),
        ...patch,
      },
    };

    await Promise.all([
      this.cacheChat(patchedChat),
      this.cacheChatById(patchedChat),
    ]);

    return patchedChat;
  }

  private async findCachedOpenChatByIdentity(
    accountId: string,
    workerId: string,
    input: ChatIdentityInput
  ): Promise<IChat | null> {
    const identity = normalizeChatIdentity(input);

    for (const phone of identity.phoneCandidates) {
      const cacheKey = createChatCacheKey(accountId, workerId, phone);
      const cache = await safeRedisGet(this.redis, cacheKey);
      if (!cache) {
        continue;
      }

      const cachedChat = this.normalizeChatData(JSON.parse(cache) as IChat);
      const belongsToRequestedScope =
        cachedChat?.account?.id === accountId &&
        cachedChat?.worker?.id === workerId;
      if (
        cachedChat &&
        belongsToRequestedScope &&
        this.isOpenChatStatus(cachedChat.status)
      ) {
        return this.ensureChatIdentityMessageKey(cachedChat, input);
      }

      await this.redis.del(cacheKey);
    }

    return null;
  }

  private findOpenChatByIdentityInternal = async (
    accountId: string,
    workerId: string,
    input: ChatIdentityInput,
    throwOnElasticError: boolean
  ): Promise<IChat | null> => {
    const cachedChat = await this.findCachedOpenChatByIdentity(
      accountId,
      workerId,
      input
    );
    if (cachedChat) {
      return cachedChat;
    }

    const identity = normalizeChatIdentity(input);
    const shouldClauses = this.buildChatIdentityShouldClauses(identity);
    if (!shouldClauses.length) {
      return null;
    }

    const queryElastic = {
      size: 1,
      _source: true,
      sort: [{ date: { order: 'asc' } }],
      query: {
        bool: {
          filter: [
            {
              nested: {
                path: 'account',
                query: { term: { 'account.id': accountId } },
              },
            },
            {
              nested: {
                path: 'worker',
                query: { term: { 'worker.id': workerId } },
              },
            },
            {
              terms: {
                status: OPEN_CHAT_STATUSES,
              },
            },
            { bool: { should: shouldClauses, minimum_should_match: 1 } },
          ],
        },
      },
    };

    const result = throwOnElasticError
      ? await this.elasticDatabaseService.selectOrThrow<IChat>(
          EElasticIndex.chat,
          queryElastic
        )
      : await this.elasticDatabaseService.select<IChat>(
          EElasticIndex.chat,
          queryElastic
        );

    const hit = result?.hits?.hits?.[0] as ElasticHit<IChat> | undefined;
    const chat = this.normalizeChatData(hit?._source ?? null);

    if (!chat) {
      return null;
    }

    const patchedChat = await this.ensureChatIdentityMessageKey(chat, input);
    await this.cacheChat(patchedChat);

    return patchedChat;
  };

  findOpenChatByIdentity = async (
    accountId: string,
    workerId: string,
    input: ChatIdentityInput
  ): Promise<IChat | null> => {
    return this.findOpenChatByIdentityInternal(
      accountId,
      workerId,
      input,
      false
    );
  };

  findChatByPhone = async (
    accountId: string,
    workerId: string,
    phone: string,
    remoteJid?: string | null,
    remoteJidAlt?: string | null
  ): Promise<IChat | null> => {
    return this.findOpenChatByIdentity(accountId, workerId, {
      phone,
      remoteJid,
      remoteJidAlt,
    });
  };

  findChatByMessageKeyJid = async (
    accountId: string,
    workerId: string,
    remoteJid?: string | null,
    remoteJidAlt?: string | null
  ): Promise<IChat | null> => {
    return this.findOpenChatByIdentity(accountId, workerId, {
      remoteJid,
      remoteJidAlt,
    });
  };

  findQueueChatsByWorkerId = async (
    accountId: string,
    workerId: string,
    userId?: string,
    excludeChatId?: string
  ): Promise<IChat[]> => {
    const filterClauses: any[] = [
      {
        nested: {
          path: 'account',
          query: {
            term: {
              'account.id': accountId,
            },
          },
        },
      },
      {
        nested: {
          path: 'worker',
          query: {
            term: {
              'worker.id': workerId,
            },
          },
        },
      },
      {
        term: {
          status: EChatStatus.queue,
        },
      },
    ];

    if (excludeChatId) {
      filterClauses.push({
        bool: {
          must_not: {
            term: {
              chat_id: excludeChatId,
            },
          },
        },
      });
    }

    const queryElastic: any = {
      size: 100,
      _source: true,
      query: {
        bool: {
          filter: filterClauses,
        },
      },
      sort: [
        {
          date: {
            order: 'asc',
          },
        },
      ],
    };

    const result = await this.elasticDatabaseService.select<IChat>(
      EElasticIndex.chat,
      queryElastic
    );

    if (!result) {
      return [];
    }

    const hits = result?.hits?.hits ?? [];

    const chats = hits
      .map((hit: ElasticHit<IChat>) => {
        const chat = hit._source ?? null;
        return this.normalizeChatData(chat);
      })
      .filter((chat): chat is IChat => chat !== null && chat !== undefined);

    if (userId && chats.length > 0) {
      const userChats = chats.filter((chat) => isChatParticipant(chat, userId));
      const otherChats = chats.filter(
        (chat) => !isChatParticipant(chat, userId)
      );

      return [...userChats, ...otherChats];
    }

    return chats;
  };

  findChatsByContactId = async (
    accountId: string,
    contactId: string
  ): Promise<IChat[]> => {
    const queryElastic = {
      size: 1000,
      _source: true,
      query: {
        bool: {
          must: [
            {
              nested: {
                path: 'account',
                query: {
                  term: {
                    'account.id': accountId,
                  },
                },
              },
            },
            {
              nested: {
                path: 'contact',
                query: {
                  term: {
                    'contact.id': contactId,
                  },
                },
              },
            },
          ],
        },
      },
    };

    const result = await this.elasticDatabaseService.select<IChat>(
      EElasticIndex.chat,
      queryElastic
    );

    const chats =
      result?.hits?.hits?.map((hit) => {
        const chat = (hit as ElasticHit<IChat>)._source ?? null;
        return this.normalizeChatData(chat);
      }) ?? [];

    return chats.filter(
      (chat): chat is IChat => chat !== null && chat !== undefined
    );
  };

  findMessageByMessageId = async (
    accountId: string,
    messageId: string
  ): Promise<IChatMessage | null> => {
    const directMessage =
      await this.elasticDatabaseService.getById<IChatMessage>(
        EElasticIndex.message,
        messageId
      );

    if (directMessage) {
      return directMessage.account?.id === accountId ? directMessage : null;
    }

    const queryElastic = {
      size: 1,
      _source: true,
      query: {
        bool: {
          must: [
            {
              nested: {
                path: 'account',
                query: {
                  term: {
                    'account.id': accountId,
                  },
                },
              },
            },
            {
              term: {
                message_id: messageId,
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

    const hit = result?.hits?.hits?.[0] as ElasticHit<IChatMessage> | undefined;
    let message = hit?._source ?? null;

    // Search is used only to resolve legacy documents whose Elasticsearch
    // `_id` differs from `message_id`. Read the resolved physical document via
    // realtime GET so a mutation never consumes the search engine's
    // near-realtime (potentially stale) snapshot.
    if (hit?._id) {
      message = await this.elasticDatabaseService.getById<IChatMessage>(
        EElasticIndex.message,
        hit._id
      );
    }

    if (message?.message_id !== messageId) {
      return null;
    }
    return message?.account?.id === accountId ? message : null;
  };

  /**
   * Records the JetStream acceptance receipt without replacing the message
   * snapshot. This is deliberately idempotent so a lost HTTP response or a
   * duplicate PubAck cannot move the broker identity of an operation.
   */
  markWorkerCommandAccepted = async (
    accountId: string,
    messageId: string,
    receipt: WorkerCommandPublishReceiptV1
  ): Promise<void> => {
    await this.elasticDatabaseService.updateWithScriptOCC(
      EElasticIndex.message,
      messageId,
      {
        source: `
          if (ctx._source == null || ctx._source.message_id != params.message_id ||
              ctx._source.account == null || ctx._source.account.id != params.account_id) {
            ctx.op = 'noop';
            return;
          }
          if (ctx._source.broker_command_id != null &&
              ctx._source.broker_command_id != params.command_id) {
            ctx.op = 'noop';
            return;
          }
          ctx._source.broker_command_id = params.command_id;
          ctx._source.broker_operation_id = params.operation_id;
          ctx._source.broker_stream = params.stream;
          ctx._source.broker_stream_sequence = params.stream_sequence;
          ctx._source.broker_accepted_at = params.accepted_at;
          ctx._source.broker_expires_at = params.expires_at;
          ctx._source.broker_duplicate = params.duplicate;
        `,
        params: {
          account_id: accountId,
          message_id: messageId,
          command_id: receipt.command_id,
          operation_id: receipt.operation_id,
          stream: receipt.stream,
          stream_sequence: receipt.stream_sequence,
          accepted_at: receipt.accepted_at,
          expires_at: receipt.expires_at,
          duplicate: receipt.duplicate,
        },
      },
      { upsert: false, maxRetries: 5 }
    );
  };

  /** Marks a never-executed realtime command terminal after its immutable 5m deadline. */
  markWorkerCommandExpired = async (
    accountId: string,
    messageId: string,
    deadlineAt: string,
    expiredAt = new Date().toISOString()
  ): Promise<void> => {
    await this.elasticDatabaseService.updateWithScriptOCC(
      EElasticIndex.message,
      messageId,
      {
        source: `
          if (ctx._source == null || ctx._source.message_id != params.message_id ||
              ctx._source.account == null || ctx._source.account.id != params.account_id ||
              ctx._source.worker_command_transport != 'jetstream' ||
              ctx._source.worker_command_deadline_at != params.deadline_at ||
              ctx._source.delivery_status != 'queued') {
            ctx.op = 'noop';
            return;
          }
          ctx._source.delivery_status = 'expired';
          ctx._source.worker_command_expired_at = params.expired_at;
        `,
        params: {
          account_id: accountId,
          message_id: messageId,
          deadline_at: deadlineAt,
          expired_at: expiredAt,
        },
      },
      { upsert: false, maxRetries: 5 }
    );
  };

  /** Quarantines malformed queued commands; they can never be republished. */
  markInvalidWorkerCommandExpired = async (
    accountId: string,
    messageId: string,
    expiredAt = new Date().toISOString()
  ): Promise<void> => {
    await this.elasticDatabaseService.updateWithScriptOCC(
      EElasticIndex.message,
      messageId,
      {
        source: `
          if (ctx._source == null || ctx._source.message_id != params.message_id ||
              ctx._source.account == null || ctx._source.account.id != params.account_id ||
              ctx._source.worker_command_transport != 'jetstream' ||
              ctx._source.broker_accepted_at != null ||
              ctx._source.delivery_status != 'queued' ||
              (ctx._source.worker_command_issued_at != null &&
               ctx._source.worker_command_deadline_at != null)) {
            ctx.op = 'noop';
            return;
          }
          ctx._source.delivery_status = 'expired';
          ctx._source.worker_command_expired_at = params.expired_at;
          ctx._source.worker_command_expiry_reason = 'invalid_command_clock';
        `,
        params: {
          account_id: accountId,
          message_id: messageId,
          expired_at: expiredAt,
        },
      },
      { upsert: false, maxRetries: 5 }
    );
  };

  findLastMessageByChatId = async (
    accountId: string,
    chatId: string
  ): Promise<IChatMessage | null> => {
    const queryElastic = {
      size: 1,
      _source: true,
      query: {
        bool: {
          must: [
            {
              nested: {
                path: 'account',
                query: {
                  term: {
                    'account.id': accountId,
                  },
                },
              },
            },
            {
              term: {
                chat_id: chatId,
              },
            },
          ],
        },
      },
      sort: [{ date: { order: 'desc' } }],
    };

    const result =
      await this.elasticDatabaseService.selectOrThrow<IChatMessage>(
        EElasticIndex.message,
        queryElastic
      );

    const hit = result?.hits?.hits?.[0] as ElasticHit<IChatMessage> | undefined;
    return hit?._source ?? null;
  };

  findInboundMessagesByChatIdAfter = async (
    accountId: string,
    chatId: string,
    after: string
  ): Promise<IChatMessage[]> => {
    const afterDate = new Date(after);
    if (!Number.isFinite(afterDate.getTime())) {
      return [];
    }

    const queryElastic = {
      size: 50,
      _source: true,
      query: {
        bool: {
          must: [
            {
              nested: {
                path: 'account',
                query: {
                  term: {
                    'account.id': accountId,
                  },
                },
              },
            },
            {
              term: {
                chat_id: chatId,
              },
            },
            {
              term: {
                type_user: ETypeUserChat.client,
              },
            },
            {
              range: {
                date: {
                  gt: afterDate.toISOString(),
                },
              },
            },
          ],
          must_not: [
            {
              nested: {
                path: 'message_key',
                query: {
                  term: {
                    'message_key.from_me': true,
                  },
                },
              },
            },
            {
              nested: {
                path: 'content',
                query: {
                  nested: {
                    path: 'content.official',
                    query: {
                      term: {
                        'content.official.echo': true,
                      },
                    },
                  },
                },
              },
            },
          ],
        },
      },
      sort: [{ date: { order: 'desc' } }],
    };

    const result = await this.elasticDatabaseService.select<IChatMessage>(
      EElasticIndex.message,
      queryElastic
    );

    return ((result?.hits?.hits ?? []) as ElasticHit<IChatMessage>[])
      .map((hit) => hit._source)
      .filter((message): message is IChatMessage => Boolean(message));
  };

  findOfficialInboundMessageByProviderId = async (
    accountId: string,
    workerId: string,
    providerMessageId: string
  ): Promise<IChatMessage | null> => {
    const normalizedProviderMessageId = providerMessageId.trim();
    if (!accountId || !workerId || !normalizedProviderMessageId) {
      return null;
    }

    const queryElastic = {
      size: 1,
      _source: true,
      query: {
        bool: {
          must: [
            {
              nested: {
                path: 'account',
                query: { term: { 'account.id': accountId } },
              },
            },
            {
              bool: {
                should: [
                  { term: { 'worker.id': workerId } },
                  { term: { 'worker.id.keyword': workerId } },
                ],
                minimum_should_match: 1,
              },
            },
            { term: { type_user: ETypeUserChat.client } },
            {
              nested: {
                path: 'message_key',
                query: {
                  term: { 'message_key.id': normalizedProviderMessageId },
                },
              },
            },
          ],
          must_not: [
            {
              nested: {
                path: 'message_key',
                query: { term: { 'message_key.from_me': true } },
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
    const hit = result?.hits?.hits?.[0] as ElasticHit<IChatMessage> | undefined;
    const message = hit?._source ?? null;
    if (message?.content?.official?.echo === true) {
      return null;
    }

    return message;
  };

  findOfficialOutboundMessageByProviderId = async (
    accountId: string,
    workerId: string,
    providerMessageId: string
  ): Promise<IChatMessage | null> => {
    const normalizedAccountId = accountId.trim();
    const normalizedWorkerId = workerId.trim();
    const normalizedProviderMessageId = providerMessageId.trim();
    if (
      !normalizedAccountId ||
      !normalizedWorkerId ||
      !normalizedProviderMessageId
    ) {
      return null;
    }

    const result = await this.elasticDatabaseService.select<IChatMessage>(
      EElasticIndex.message,
      {
        size: 1,
        _source: false,
        query: {
          bool: {
            filter: [
              {
                nested: {
                  path: 'account',
                  query: {
                    term: { 'account.id': normalizedAccountId },
                  },
                },
              },
              {
                bool: {
                  should: [
                    { term: { 'worker.id': normalizedWorkerId } },
                    { term: { 'worker.id.keyword': normalizedWorkerId } },
                  ],
                  minimum_should_match: 1,
                },
              },
              {
                nested: {
                  path: 'message_key',
                  query: {
                    bool: {
                      filter: [
                        {
                          term: {
                            'message_key.id': normalizedProviderMessageId,
                          },
                        },
                        { term: { 'message_key.from_me': true } },
                      ],
                    },
                  },
                },
              },
              {
                nested: {
                  path: 'content',
                  query: {
                    term: {
                      'content.type': EMessageType.official_template,
                    },
                  },
                },
              },
              { terms: { type_user: [...OUTBOUND_MESSAGE_TYPE_USERS] } },
            ],
          },
        },
      }
    );

    const hit = result?.hits?.hits?.[0] as ElasticHit<IChatMessage> | undefined;
    if (!hit?._id) {
      return null;
    }

    const message = await this.elasticDatabaseService.getById<IChatMessage>(
      EElasticIndex.message,
      hit._id
    );
    if (
      message?.account?.id !== normalizedAccountId ||
      message.worker?.id !== normalizedWorkerId ||
      message.message_key?.id?.trim() !== normalizedProviderMessageId ||
      message.message_key?.from_me !== true ||
      !OUTBOUND_MESSAGE_TYPE_USER_SET.has(message.type_user) ||
      message.content?.type !== EMessageType.official_template
    ) {
      return null;
    }

    return message;
  };

  repairOfficialInboundMessageTimestamp = async (input: {
    accountId: string;
    workerId: string;
    internalMessageId: string;
    providerMessageId: string;
    correctedAt: string;
  }): Promise<boolean> => {
    if (
      !input.accountId ||
      !input.workerId ||
      !input.internalMessageId ||
      !input.providerMessageId ||
      !Number.isFinite(new Date(input.correctedAt).getTime())
    ) {
      return false;
    }

    const result = await this.elasticDatabaseService.updateWithScriptOCC(
      EElasticIndex.message,
      input.internalMessageId,
      {
        source: `
          if (
            ctx._source == null ||
            ctx._source.account == null ||
            ctx._source.account.id != params.account_id ||
            ctx._source.worker == null ||
            ctx._source.worker.id != params.worker_id ||
            ctx._source.message_key == null ||
            ctx._source.message_key.id != params.provider_message_id ||
            ctx._source.message_key.from_me == true ||
            ctx._source.type_user != params.client_type
          ) {
            ctx.op = 'noop';
            return;
          }

          if (ctx._source.date == params.corrected_at) {
            ctx.op = 'noop';
            return;
          }

          ctx._source.date = params.corrected_at;
        `,
        params: {
          account_id: input.accountId,
          worker_id: input.workerId,
          provider_message_id: input.providerMessageId,
          client_type: ETypeUserChat.client,
          corrected_at: input.correctedAt,
        },
      },
      { maxRetries: 5 }
    );

    return result === 'updated' || result === 'created' || result === 'noop';
  };

  findLastInboundMessageByChatIdAfter = async (
    accountId: string,
    chatId: string,
    after: string
  ): Promise<IChatMessage | null> => {
    const [message] = await this.findInboundMessagesByChatIdAfter(
      accountId,
      chatId,
      after
    );
    return message ?? null;
  };

  findLastHumanMessageByChatId = async (
    accountId: string,
    chatId: string
  ): Promise<IChatMessage | null> => {
    const queryElastic = {
      size: 1,
      _source: true,
      query: {
        bool: {
          must: [
            {
              nested: {
                path: 'account',
                query: {
                  term: {
                    'account.id': accountId,
                  },
                },
              },
            },
            {
              term: {
                chat_id: chatId,
              },
            },
          ],
          must_not: [
            {
              terms: {
                type_user: ['system', 'bot'],
              },
            },
            {
              nested: {
                path: 'content',
                query: {
                  term: {
                    'content.type': EMessageType.annotation,
                  },
                },
              },
            },
          ],
        },
      },
      sort: [{ date: { order: 'desc' } }],
    };

    const result = await this.elasticDatabaseService.select<IChatMessage>(
      EElasticIndex.message,
      queryElastic
    );

    const hit = result?.hits?.hits?.[0] as ElasticHit<IChatMessage> | undefined;
    return hit?._source ?? null;
  };

  findLastAttendanceActivityByChatId = async (
    accountId: string,
    chatId: string
  ): Promise<IChatMessage | null> => {
    const queryElastic = {
      size: 1,
      _source: true,
      query: {
        bool: {
          must: [
            {
              nested: {
                path: 'account',
                query: {
                  term: {
                    'account.id': accountId,
                  },
                },
              },
            },
            { term: { chat_id: chatId } },
          ],
          must_not: [{ terms: { type_user: ['system', 'bot'] } }],
        },
      },
      sort: [{ date: { order: 'desc' } }],
    };

    const result = await this.elasticDatabaseService.select<IChatMessage>(
      EElasticIndex.message,
      queryElastic
    );
    const hit = result?.hits?.hits?.[0] as ElasticHit<IChatMessage> | undefined;
    return hit?._source ?? null;
  };

  viewWorkerConfigForChat = async (
    workerId: string
  ): Promise<ViewWorkerConfigForChatResponse> => {
    return this.workerConfigForChatViewerRepository.viewWorkerConfigForChatByWorkerId(
      workerId
    );
  };

  listQuickMessageTemplates = async (
    query: ListQuickMessageTemplatesRequest,
    accountId: string
  ): Promise<ListQuickMessageTemplatesResponse[]> => {
    return this.chatQuickMessageTemplatesListerRepository.listQuickMessageTemplates(
      query,
      accountId
    );
  };
}
