import { inject, injectable } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';
import { ElasticDatabaseService } from './elasticDatabase.service';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { IChatMessage } from '@core/common/interfaces/IChatMessage';
import { mensageMappings } from '@core/mappings/mensage.mappings';
import { IChat } from '@core/common/interfaces/IChat';
import { chatMappings } from '@core/mappings/chat.mappings';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { buildCandidates } from '@core/common/functions/buildCandidatesBR';
import { WorkerConfigForChatViewerRepository } from '@core/repositories/chat/WorkerConfigForChatViewer.repository';
import { ViewWorkerConfigForChatResponse } from '@core/schema/chat/viewWorkerConfigForChat/response.schema';
import { ChatQuickMessageTemplatesListerRepository } from '@core/repositories/chat/ChatQuickMessageTemplatesLister.repository';
import { ListQuickMessageTemplatesResponse } from '@core/schema/chat/listQuickMessageTemplates/response.schema';
import { ListQuickMessageTemplatesRequest } from '@core/schema/chat/listQuickMessageTemplates/request.schema';
import {
  IChatSummary,
  ChatSummaryBaseline,
  ChatSummaryAtomicUpdateParams,
} from '@core/common/interfaces/IChatSummaryUpdate';
import {
  ChatPatch,
  ChatPatchOptions,
} from '@core/common/interfaces/IChatPatch';
import { metricsCount } from '@core/plugins/telemetry/sentry';
import {
  createChatCacheKey,
  createChatCacheKeyChatId,
} from '@core/common/functions/createCacheKey';
import Redis from 'ioredis';
import { safeRedisGet } from '@core/plugins/redis';
import { generateProtocol } from '@core/common/functions/generateProtocol';

type ElasticHit<T> = {
  _source?: T;
};

type ChatProtocolType = 'protocol_ura' | 'protocol_start' | 'protocol_transfer';

@injectable()
export class ChatService {
  constructor(
    @inject('Redis') private readonly redis: Redis,
    @inject(ElasticDatabaseService)
    private readonly elasticDatabaseService: ElasticDatabaseService,
    @inject(WorkerConfigForChatViewerRepository)
    private readonly workerConfigForChatViewerRepository: WorkerConfigForChatViewerRepository,
    @inject(ChatQuickMessageTemplatesListerRepository)
    private readonly chatQuickMessageTemplatesListerRepository: ChatQuickMessageTemplatesListerRepository
  ) {}

  saveMessageChat = async (messageChat: IChatMessage): Promise<boolean> => {
    const mappings = mensageMappings();

    const result = await this.elasticDatabaseService.indices(
      EElasticIndex.message,
      mappings
    );

    if (!result || !messageChat) {
      return false;
    }

    const updateResult = await this.elasticDatabaseService.updateWithOCC(
      EElasticIndex.message,
      messageChat.message_id,
      messageChat as unknown as Record<string, unknown>,
      {
        upsert: true,
        maxRetries: 5,
      }
    );

    return (
      updateResult === 'updated' ||
      updateResult === 'created' ||
      updateResult === 'noop'
    );
  };

  updateMessageChat = async (messageChat: IChatMessage): Promise<boolean> => {
    const mappings = mensageMappings();

    const result = await this.elasticDatabaseService.indices(
      EElasticIndex.message,
      mappings
    );

    if (!result || !messageChat || !messageChat.message_id) {
      return false;
    }

    const updateResult = await this.elasticDatabaseService.updateWithOCC(
      EElasticIndex.message,
      messageChat.message_id,
      messageChat as unknown as Record<string, unknown>,
      {
        upsert: false,
        maxRetries: 5,
      }
    );

    return updateResult === 'updated' || updateResult === 'noop';
  };

  createMessageIdempotent = async (
    messageChat: IChatMessage
  ): Promise<{ created: boolean; conflict: boolean; id: string }> => {
    const mappings = mensageMappings();

    const indicesResult = await this.elasticDatabaseService.indices(
      EElasticIndex.message,
      mappings
    );

    if (!indicesResult || !messageChat || !messageChat.message_id) {
      return { created: false, conflict: false, id: '' };
    }

    const documentId = messageChat.message_id;
    const createResult = await this.elasticDatabaseService.createDocument(
      EElasticIndex.message,
      documentId,
      messageChat
    );

    return {
      created: createResult === 'created',
      conflict: createResult === 'conflict',
      id: documentId,
    };
  };

  patchExistingMessageMissingFields = async (
    documentId: string,
    messageChat: IChatMessage
  ): Promise<boolean> => {
    const scriptSource = this.buildPatchMessageMissingFieldsScript();
    const scriptParams = this.buildPatchMessageMissingFieldsParams(messageChat);

    const result = await this.elasticDatabaseService.updateWithScriptOCC(
      EElasticIndex.message,
      documentId,
      {
        source: scriptSource,
        params: scriptParams,
      },
      {
        maxRetries: 5,
      }
    );

    return result === 'updated' || result === 'noop';
  };

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

  applyChatPatch = async (
    chatId: string,
    patch: ChatPatch,
    options?: ChatPatchOptions
  ): Promise<boolean> => {
    const mappings = chatMappings();

    const indicesResult = await this.elasticDatabaseService.indices(
      EElasticIndex.chat,
      mappings
    );

    if (!indicesResult) {
      return false;
    }

    const scriptSource = this.buildChatPatchScript();
    const scriptParams = this.buildChatPatchParams(patch, options);
    const upsert = this.buildChatPatchUpsert(chatId, patch);

    const result = await this.elasticDatabaseService.updateWithScriptOCC(
      EElasticIndex.chat,
      chatId,
      {
        source: scriptSource,
        params: scriptParams,
        upsert: options?.allowCreate !== false ? upsert : undefined,
        scriptedUpsert: options?.allowCreate !== false,
      },
      {
        upsert: options?.allowCreate !== false,
        maxRetries: 5,
        refresh: options?.refresh,
      }
    );

    return result === 'updated' || result === 'created' || result === 'noop';
  };

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

  saveChat = async (
    chat: IChat,
    options?: { refresh?: boolean }
  ): Promise<boolean> => {
    if (!chat) return false;

    await Promise.all([this.cacheChat(chat), this.cacheChatById(chat)]);

    const patch: ChatPatch = {
      message_key: chat.message_key,
      account: chat.account,
      worker: chat.worker,
      sector: chat.sector,
      user: chat.user,
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
    };

    return this.applyChatPatch(chat.chat_id, patch, {
      allowCreate: true,
      refresh: options?.refresh,
    });
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
      def hasUserUpdate = patch.containsKey('user');
      def hasSectorUpdate = patch.containsKey('sector');
      def hasStatusAndUserUpdate = hasStatusUpdate && hasUserUpdate;
      
      def shouldApplyPatch = true;
      
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
      
      if (patch.containsKey('status') && patch.status != null) {
        ctx._source.status = patch.status;
        changed = true;
        if (eventEpochMillis != null) {
          ctx._source.meta.status_epoch = eventEpochMillis;
          if (eventId != null) {
            ctx._source.meta.status_event_id = eventId;
          }
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
      
      if (patch.containsKey('user') && patch.user != null && !hasStatusAndUserUpdate) {
        if (eventEpochMillis != null) {
          ctx._source.meta.assignment_epoch = eventEpochMillis;
          if (eventId != null) {
            ctx._source.meta.assignment_event_id = eventId;
          }
        }
      }
      
      if (patch.containsKey('sector') && patch.sector != null) {
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
    };

    const hasStatusUpdate = patch.status !== null && patch.status !== undefined;
    const hasUserUpdate = patch.user !== null && patch.user !== undefined;
    const hasStatusAndUserUpdate = hasStatusUpdate && hasUserUpdate;

    if (
      options?.eventEpochMillis !== null &&
      options?.eventEpochMillis !== undefined
    ) {
      params.event_epoch_millis = options.eventEpochMillis;
    } else if (hasStatusAndUserUpdate) {
      params.event_epoch_millis = Date.now();
      params.event_id = uuidv7();
    }

    if (options?.eventId !== null && options?.eventId !== undefined) {
      params.event_id = options.eventId;
    }

    let domain: string | null = null;
    if (hasStatusUpdate) {
      domain = 'status';
    } else if (
      hasUserUpdate ||
      (patch.sector !== null && patch.sector !== undefined)
    ) {
      domain = 'assignment';
    } else if (patch.label !== null && patch.label !== undefined) {
      domain = 'labels';
    }

    if (domain !== null) {
      params.domain = domain;
    }

    return params;
  }

  private buildChatPatchUpsert(
    chatId: string,
    patch: ChatPatch
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

    if (patch.contact !== null && patch.contact !== undefined) {
      upsert.contact = patch.contact;
    }

    if (patch.photo !== null && patch.photo !== undefined) {
      upsert.photo = patch.photo;
    }

    if (patch.name !== null && patch.name !== undefined) {
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

    upsert.meta = {};

    return upsert;
  }

  findChatByChatId = async (
    accountId: string,
    chatId: string
  ): Promise<IChat | null> => {
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

    if (chat && Array.isArray(chat.summary)) {
      chat.summary = chat.summary[0] as IChat['summary'];
    }

    return chat;
  };

  updateChatStatus = async (
    chatId: string,
    status: IChat['status'],
    user?: IChat['user'] | null,
    startedAt?: string | null,
    closedAt?: string | null,
    eventEpochMillis?: number,
    eventId?: string
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

    return this.applyChatPatch(chatId, patch, {
      eventEpochMillis,
      eventId,
      allowCreate: false,
    });
  };

  updateChatUserAndSector = async (
    chatId: string,
    user?: IChat['user'] | null,
    sector?: IChat['sector'] | null,
    eventEpochMillis?: number,
    eventId?: string
  ): Promise<boolean> => {
    const patch: ChatPatch = {};

    if (user !== undefined) {
      patch.user = user;
    }

    if (sector !== undefined) {
      patch.sector = sector;
    }

    return this.applyChatPatch(chatId, patch, {
      eventEpochMillis,
      eventId,
      allowCreate: false,
    });
  };

  updateChatLabel = async (
    chatId: string,
    label?: IChat['label'] | null,
    eventEpochMillis?: number,
    eventId?: string
  ): Promise<boolean> => {
    const patch: ChatPatch = {};

    if (label !== undefined) {
      patch.label = label;
    }

    return this.applyChatPatch(chatId, patch, {
      eventEpochMillis,
      eventId,
      allowCreate: false,
    });
  };

  updateForwardToOutputChatbot = async (
    chatId: string,
    forwardToOutputChatbot: boolean
  ): Promise<boolean> => {
    const patch: ChatPatch = {
      forward_to_output_chatbot: forwardToOutputChatbot,
    };
    return this.applyChatPatch(chatId, patch, { allowCreate: false });
  };

  updateChatProtocol = async (
    chatId: string,
    protocolType: ChatProtocolType,
    protocol: string
  ): Promise<boolean> => {
    return this.elasticDatabaseService.updateArrayField(
      EElasticIndex.chat,
      chatId,
      protocolType,
      protocol
    );
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
      return existingProtocol;
    }

    const protocol = generateProtocol();
    const persisted = await this.updateChatProtocol(
      chatId,
      protocolType,
      protocol
    );
    if (!persisted) {
      return null;
    }

    return protocol;
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
    }
  ): Promise<boolean> => {
    const mappings = chatMappings();
    const indicesResult = await this.elasticDatabaseService.indices(
      EElasticIndex.chat,
      mappings
    );

    if (!indicesResult) {
      return false;
    }

    const result = await this.elasticDatabaseService.updateWithScriptOCC(
      EElasticIndex.chat,
      chatId,
      {
        source:
          'ctx._source.satisfaction_response = params.satisfaction_response',
        params: { satisfaction_response: data },
      },
      { upsert: false, maxRetries: 5 }
    );

    return result === 'updated' || result === 'noop';
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

  updateChatSummary = async (
    chatId: string,
    summary: IChat['summary']
  ): Promise<boolean> => {
    try {
      const summaryToUpdate = Array.isArray(summary) ? summary[0] : summary;

      if (!summaryToUpdate) {
        return false;
      }

      const scriptSource = this.buildUpdateChatSummaryScript();
      const scriptParams =
        this.buildUpdateChatSummaryScriptParams(summaryToUpdate);
      const upsert = this.buildUpdateChatSummaryUpsert(summaryToUpdate);

      const result = await this.elasticDatabaseService.updateWithScriptOCC(
        EElasticIndex.chat,
        chatId,
        {
          source: scriptSource,
          params: scriptParams,
          upsert,
        },
        {
          upsert: true,
          maxRetries: 5,
          refresh: true,
        }
      );

      return result === 'updated' || result === 'created' || result === 'noop';
    } catch (error) {
      console.error('Error updating chat summary:', error);
      return false;
    }
  };

  private buildUpdateChatSummaryScript(): string {
    return `
      if (ctx._source.summary == null || ctx._source.summary.size() == 0) {
        ctx._source.summary = [params.baseline];
        return;
      }

      def isList = ctx._source.summary instanceof List;
      def summaryIndex = isList ? 0 : null;

      if (params.last_message != null || params.last_date != null) {
        def currentLastDate = isList ? ctx._source.summary[summaryIndex].last_date : ctx._source.summary.last_date;
        def newLastDate = params.last_date;

        def shouldUpdateMessage = false;

        if (currentLastDate == null || newLastDate == null) {
          shouldUpdateMessage = newLastDate != null;
        } else {
          if (currentLastDate instanceof String && newLastDate instanceof String) {
            shouldUpdateMessage = newLastDate.compareTo(currentLastDate) > 0;
          }
        }

        if (shouldUpdateMessage) {
          if (isList) {
            ctx._source.summary[summaryIndex].last_message = params.last_message;
            ctx._source.summary[summaryIndex].last_date = newLastDate;
          } else {
            ctx._source.summary.last_message = params.last_message;
            ctx._source.summary.last_date = newLastDate;
          }
        }
      }

      if (params.unread_count_absolute != null) {
        def newUnreadCount = params.unread_count_absolute;
        if (newUnreadCount < 0) {
          newUnreadCount = 0;
        }
        if (isList) {
          ctx._source.summary[summaryIndex].unread_count = newUnreadCount;
        } else {
          ctx._source.summary.unread_count = newUnreadCount;
        }
      } else if (params.unread_count_delta != null) {
        def currentUnreadCount = isList
          ? (ctx._source.summary[summaryIndex].unread_count != null ? ctx._source.summary[summaryIndex].unread_count : 0)
          : (ctx._source.summary.unread_count != null ? ctx._source.summary.unread_count : 0);
        def newUnreadCount = currentUnreadCount + params.unread_count_delta;
        if (newUnreadCount < 0) {
          newUnreadCount = 0;
        }
        if (isList) {
          ctx._source.summary[summaryIndex].unread_count = newUnreadCount;
        } else {
          ctx._source.summary.unread_count = newUnreadCount;
        }
      }
    `;
  }

  private buildUpdateChatSummaryScriptParams(
    summary: IChatSummary
  ): Record<string, unknown> {
    const baseline: IChatSummary = {
      last_message: summary.last_message,
      last_date: summary.last_date,
      unread_count: summary.unread_count,
    };

    return {
      baseline,
      last_message: summary.last_message,
      last_date: summary.last_date,
      unread_count_absolute: summary.unread_count,
    };
  }

  private buildUpdateChatSummaryUpsert(
    summary: IChatSummary
  ): Record<string, unknown> {
    return {
      summary: [
        {
          last_message: summary.last_message,
          last_date: summary.last_date,
          unread_count: summary.unread_count,
        },
      ],
    };
  }

  updateChatSummaryAtomically = async (
    chatId: string,
    lastMessage: string | null,
    lastDate: string,
    lastDateEpochMillis: number,
    lastMessageId: string | null,
    processedMessageId: string | null,
    incrementUnreadCount: boolean
  ): Promise<boolean> => {
    const baseline = this.createChatSummaryBaseline(
      lastMessage,
      lastDate,
      lastDateEpochMillis,
      lastMessageId,
      processedMessageId
    );
    const scriptParams = this.buildChatSummaryAtomicScriptParams(
      baseline,
      lastMessage,
      lastDate,
      lastDateEpochMillis,
      lastMessageId,
      processedMessageId,
      incrementUnreadCount
    );
    const upsert = this.buildChatSummaryAtomicUpsert(baseline);
    const scriptSource = this.buildChatSummaryAtomicUpdateScript();

    const result =
      await this.elasticDatabaseService.updateWithScriptOCC<ChatSummaryAtomicUpdateParams>(
        EElasticIndex.chat,
        chatId,
        { source: scriptSource, params: scriptParams, upsert },
        {
          upsert: true,
          maxRetries: 5,
          refresh: true,
        }
      );

    if (result === 'conflict') {
      metricsCount('chat.summary.update.conflict', 1, {
        chat_id: chatId,
      });
    }

    return result === 'updated' || result === 'created' || result === 'noop';
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

      if (summary.last_date_epoch_millis == null) {
        summary.last_date_epoch_millis = 0;
      }

      if (summary.last_processed_message_id == null) {
        summary.last_processed_message_id = null;
      }

      def changed = false;

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
      }

      if (params.processed_message_id != null && params.increment_unread_count) {
        def lastProcessed = summary.last_processed_message_id;
        if (lastProcessed == null || lastProcessed != params.processed_message_id) {
          summary.unread_count = summary.unread_count + 1;
          summary.last_processed_message_id = params.processed_message_id;
          changed = true;
        }
      }

      if (!changed) {
        ctx.op = 'noop';
      }
    `;
  }

  private createChatSummaryBaseline(
    lastMessage: string | null,
    lastDate: string,
    lastDateEpochMillis: number,
    lastMessageId: string | null,
    processedMessageId: string | null
  ): ChatSummaryBaseline {
    return {
      last_message: lastMessage,
      last_date: lastDate,
      last_date_epoch_millis: lastDateEpochMillis,
      last_message_id: lastMessageId,
      last_processed_message_id: processedMessageId,
      unread_count: 0,
    };
  }

  private buildChatSummaryAtomicScriptParams(
    baseline: ChatSummaryBaseline,
    lastMessage: string | null,
    lastDate: string,
    lastDateEpochMillis: number,
    lastMessageId: string | null,
    processedMessageId: string | null,
    incrementUnreadCount: boolean
  ): ChatSummaryAtomicUpdateParams {
    return {
      baseline,
      last_message: lastMessage,
      last_date: lastDate,
      last_date_epoch_millis: lastDateEpochMillis,
      last_message_id: lastMessageId,
      processed_message_id: processedMessageId,
      increment_unread_count: incrementUnreadCount,
    };
  }

  private buildChatSummaryAtomicUpsert(
    baseline: ChatSummaryBaseline
  ): Record<string, unknown> {
    return {
      summary: [baseline],
    };
  }

  clearChatSummary = async (
    chatId: string,
    accountId: string
  ): Promise<boolean> => {
    try {
      const chat = await this.findChatByChatId(accountId, chatId);

      if (!chat) return false;

      const lastMessage = chat.summary?.last_message ?? null;
      const lastDate = chat.summary?.last_date ?? new Date().toISOString();

      return await this.updateChatSummary(chatId, {
        last_message: lastMessage,
        last_date: lastDate,
        unread_count: 0,
      });
    } catch (error) {
      console.error('Error clearing chat summary:', error);
      return false;
    }
  };

  findChatByPhone = async (
    accountId: string,
    workerId: string,
    phone: string,
    remoteJid?: string | null,
    remoteJidAlt?: string | null
  ): Promise<IChat | null> => {
    const cacheKey = createChatCacheKey(accountId, workerId, phone);
    const cache = await safeRedisGet(this.redis, cacheKey);

    if (cache) {
      return JSON.parse(cache) as IChat;
    }

    const candidates = buildCandidates(phone);
    const shouldClauses: any[] = [];

    if (Array.isArray(candidates) && candidates.length) {
      shouldClauses.push({ terms: { phone: candidates } });
    }

    if (remoteJid) {
      shouldClauses.push({
        nested: {
          path: 'message_key',
          query: { term: { 'message_key.remote_jid': remoteJid } },
        },
      });
      shouldClauses.push({
        nested: {
          path: 'message_key',
          query: { term: { 'message_key.remote_jid_alt': remoteJid } },
        },
      });
    }

    if (remoteJidAlt) {
      shouldClauses.push({
        nested: {
          path: 'message_key',
          query: { term: { 'message_key.remote_jid_alt': remoteJidAlt } },
        },
      });
      shouldClauses.push({
        nested: {
          path: 'message_key',
          query: { term: { 'message_key.remote_jid': remoteJidAlt } },
        },
      });
    }

    const queryElastic = {
      size: 1,
      _source: true,
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
                status: [
                  EChatStatus.in_chat,
                  EChatStatus.queue,
                  EChatStatus.ura,
                  EChatStatus.ura_output,
                  EChatStatus.ura_schedule,
                  EChatStatus.ura_webhook,
                ],
              },
            },
          ],
          ...(shouldClauses.length
            ? {
                must: [
                  { bool: { should: shouldClauses, minimum_should_match: 1 } },
                ],
              }
            : {}),
        },
      },
    };

    const result = await this.elasticDatabaseService.select<IChat>(
      EElasticIndex.chat,
      queryElastic
    );

    const hit = result?.hits?.hits?.[0] as ElasticHit<IChat> | undefined;
    const chat = hit?._source ?? null;

    if (!chat) {
      return null;
    }

    if (chat && Array.isArray(chat.summary)) {
      chat.summary = chat.summary[0] as IChat['summary'];
    }

    await this.cacheChat(chat);

    return chat;
  };

  updateChatSector = async (
    chatId: string,
    sector: IChat['sector'],
    eventEpochMillis?: number,
    eventId?: string
  ): Promise<boolean> => {
    const patch: ChatPatch = {
      sector,
    };

    return this.applyChatPatch(chatId, patch, {
      eventEpochMillis,
      eventId,
      allowCreate: false,
    });
  };

  updateChatWorker = async (
    chatId: string,
    worker: IChat['worker'],
    eventEpochMillis?: number,
    eventId?: string
  ): Promise<boolean> => {
    const patch: ChatPatch = {
      worker,
    };

    return this.applyChatPatch(chatId, patch, {
      eventEpochMillis,
      eventId,
      allowCreate: false,
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
        const chat = hit._source;
        if (chat && Array.isArray(chat.summary)) {
          chat.summary = chat.summary[0] as IChat['summary'];
        }
        return chat;
      })
      .filter((chat): chat is IChat => chat !== undefined);

    if (userId && chats.length > 0) {
      const userChats = chats.filter((chat) => chat.user?.id === userId);
      const otherChats = chats.filter((chat) => chat.user?.id !== userId);

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
        const chat = (hit as ElasticHit<IChat>)._source;
        if (chat && Array.isArray(chat.summary)) {
          chat.summary = chat.summary[0] as IChat['summary'];
        }
        return chat;
      }) ?? [];

    return chats.filter((chat): chat is IChat => chat !== undefined);
  };

  findMessageByMessageId = async (
    accountId: string,
    messageId: string
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
    return hit?._source ?? null;
  };

  updateMessageContent = async (
    messageId: string,
    content: IChatMessage['content']
  ): Promise<boolean> => {
    const result = await this.elasticDatabaseService.updateWithOCC(
      EElasticIndex.message,
      messageId,
      { content }
    );

    return result === 'updated' || result === 'created' || result === 'noop';
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
