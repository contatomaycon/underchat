import { injectable, inject } from 'tsyringe';
import Redis from 'ioredis';
import { TFunction } from 'i18next';
import { ChatService } from './chat.service';
import { ChatMessageService } from './chatMessage.service';
import { WorkerConfigService } from './workerConfig.service';
import { WorkerService } from './worker.service';
import { CentrifugoService } from './centrifugo.service';
import { ChatbotFlowRunnerService } from './chatbotFlowRunner.service';
import { IChat } from '@core/common/interfaces/IChat';
import { IAttendanceInactivityData } from '@core/common/interfaces/IAttendanceInactivityData';
import { IAttendanceInactivityAlertConfig } from '@core/common/interfaces/IAttendanceInactivityAlert';
import { IChatMessage } from '@core/common/interfaces/IChatMessage';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { EMessageType } from '@core/common/enums/EMessageType';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import { replaceMessageTags } from '@core/common/functions/replaceMessageTags';
import { hasProtocolTag } from '@core/common/functions/hasProtocolTag';
import {
  chatAccountCentrifugo,
  chatQueueAccountCentrifugo,
} from '@core/common/functions/centrifugoQueue';
import { createAttendanceInactivityCacheKey } from '@core/common/functions/createCacheKey';
import { IUpsertMessageEnvelope } from '@core/common/interfaces/IUpsertMessage';

@injectable()
export class AttendanceInactivityService {
  private readonly INACTIVITY_CACHE_TTL_SECONDS = 86400;

  constructor(
    @inject('Redis') private readonly redis: Redis,
    @inject(ChatService)
    private readonly chatService: ChatService,
    @inject(ChatMessageService)
    private readonly chatMessageService: ChatMessageService,
    @inject(WorkerConfigService)
    private readonly workerConfigService: WorkerConfigService,
    @inject(WorkerService)
    private readonly workerService: WorkerService,
    @inject(CentrifugoService)
    private readonly centrifugoService: CentrifugoService,
    @inject(ChatbotFlowRunnerService)
    private readonly chatbotFlowRunnerService: ChatbotFlowRunnerService
  ) {}

  private getInactivityScheduleKey(): string {
    return 'underchat:attendance-inactivity-schedule';
  }

  private getInactivityCacheKey(
    accountId: string,
    workerId: string,
    chatId: string
  ): string {
    return createAttendanceInactivityCacheKey(accountId, workerId, chatId);
  }

  private async resolveConfig(
    workerId: string,
    configOverride?: IAttendanceInactivityAlertConfig | null
  ): Promise<{
    enabled: boolean;
    quantity: number;
    time: number;
    action: 'finish';
    inactivity_message_enabled: boolean;
    inactivity_message: string | null;
  }> {
    if (configOverride !== undefined) {
      if (!configOverride) {
        return {
          enabled: false,
          quantity: 1,
          time: 180,
          action: 'finish',
          inactivity_message_enabled: true,
          inactivity_message: null,
        };
      }

      return {
        enabled: true,
        quantity: configOverride.quantity,
        time: configOverride.time,
        action: configOverride.action,
        inactivity_message_enabled: configOverride.inactivity_message_enabled,
        inactivity_message: configOverride.inactivity_message,
      };
    }

    return this.workerConfigService.viewAttendanceInactivityAlert(workerId);
  }

  private async upsertInactivitySchedule(
    cacheKey: string,
    data: IAttendanceInactivityData,
    nextCheckTime: number
  ): Promise<void> {
    const scheduleKey = this.getInactivityScheduleKey();

    await Promise.all([
      this.redis.set(
        cacheKey,
        JSON.stringify(data),
        'EX',
        this.INACTIVITY_CACHE_TTL_SECONDS
      ),
      this.redis.zadd(scheduleKey, nextCheckTime, cacheKey),
    ]);
  }

  async startTrackingOnInChatEntry(
    chat: IChat,
    configOverride?: IAttendanceInactivityAlertConfig | null
  ): Promise<void> {
    if (chat.status !== EChatStatus.in_chat) {
      await this.cancelInactivityTracking(chat);
      return;
    }

    const config = await this.resolveConfig(chat.worker.id, configOverride);

    if (!config.enabled) {
      await this.cancelInactivityTracking(chat);
      return;
    }

    const now = Date.now();
    const nextCheckTime = now + config.time * 60 * 1000;
    const cacheKey = this.getInactivityCacheKey(
      chat.account.id,
      chat.worker.id,
      chat.chat_id
    );

    const data: IAttendanceInactivityData = {
      lastInteraction: now,
      alertCount: 0,
      lastAlertTime: null,
      accountId: chat.account.id,
      workerId: chat.worker.id,
      chatId: chat.chat_id,
    };

    await this.upsertInactivitySchedule(cacheKey, data, nextCheckTime);
  }

  async resetOnContactMessage(
    chat: IChat,
    configOverride?: IAttendanceInactivityAlertConfig | null
  ): Promise<void> {
    if (chat.status !== EChatStatus.in_chat) {
      await this.cancelInactivityTracking(chat);
      return;
    }

    const config = await this.resolveConfig(chat.worker.id, configOverride);

    if (!config.enabled) {
      await this.cancelInactivityTracking(chat);
      return;
    }

    const cacheKey = this.getInactivityCacheKey(
      chat.account.id,
      chat.worker.id,
      chat.chat_id
    );
    const inactivityData = await this.redis.get(cacheKey);
    const now = Date.now();
    const nextCheckTime = now + config.time * 60 * 1000;

    const data: IAttendanceInactivityData = inactivityData
      ? (JSON.parse(inactivityData) as IAttendanceInactivityData)
      : {
          lastInteraction: now,
          alertCount: 0,
          lastAlertTime: null,
          accountId: chat.account.id,
          workerId: chat.worker.id,
          chatId: chat.chat_id,
        };

    data.lastInteraction = now;
    data.alertCount = 0;
    data.accountId = chat.account.id;
    data.workerId = chat.worker.id;
    data.chatId = chat.chat_id;

    await this.upsertInactivitySchedule(cacheKey, data, nextCheckTime);
  }

  async resetOnOperatorMessage(
    chat: IChat,
    configOverride?: IAttendanceInactivityAlertConfig | null
  ): Promise<void> {
    if (chat.status !== EChatStatus.in_chat) {
      await this.cancelInactivityTracking(chat);
      return;
    }

    const config = await this.resolveConfig(chat.worker.id, configOverride);

    if (!config.enabled) {
      await this.cancelInactivityTracking(chat);
      return;
    }

    const cacheKey = this.getInactivityCacheKey(
      chat.account.id,
      chat.worker.id,
      chat.chat_id
    );
    const inactivityData = await this.redis.get(cacheKey);
    const now = Date.now();
    const nextCheckTime = now + config.time * 60 * 1000;

    const data: IAttendanceInactivityData = inactivityData
      ? (JSON.parse(inactivityData) as IAttendanceInactivityData)
      : {
          lastInteraction: now,
          alertCount: 0,
          lastAlertTime: null,
          accountId: chat.account.id,
          workerId: chat.worker.id,
          chatId: chat.chat_id,
        };

    data.lastInteraction = now;
    data.alertCount = 0;
    data.accountId = chat.account.id;
    data.workerId = chat.worker.id;
    data.chatId = chat.chat_id;

    await this.upsertInactivitySchedule(cacheKey, data, nextCheckTime);
  }

  async cancelInactivityTracking(chat: IChat): Promise<void> {
    await this.cancelInactivityTrackingByIds(
      chat.account.id,
      chat.worker.id,
      chat.chat_id
    );
  }

  async cancelInactivityTrackingByIds(
    accountId: string,
    workerId: string,
    chatId: string
  ): Promise<void> {
    const cacheKey = this.getInactivityCacheKey(accountId, workerId, chatId);
    const scheduleKey = this.getInactivityScheduleKey();

    await Promise.all([
      this.redis.del(cacheKey),
      this.redis.zrem(scheduleKey, cacheKey),
    ]);
  }

  private async sendInactivityMessage(
    t: TFunction<'translation', undefined>,
    chat: IChat,
    message: string
  ): Promise<void> {
    const resolvedMessage = replaceMessageTags({
      message,
      chat,
      t,
    });

    await this.chatMessageService.sendMessage(t, {
      chat,
      accountId: chat.account.id,
      type: EMessageType.system,
      message: resolvedMessage,
      typeUser: ETypeUserChat.system,
    });
  }

  private async sendFinishAttendanceMessageIfNeeded(
    t: TFunction<'translation', undefined>,
    chat: IChat
  ): Promise<string | null> {
    const workerConfigFields =
      await this.workerService.viewWorkerConfigFieldsByWorkerId(chat.worker.id);

    const templateMessage = workerConfigFields?.send_message_on_finish_attendance;

    if (!templateMessage) {
      return null;
    }

    let protocol: string | null = null;

    if (hasProtocolTag(templateMessage)) {
      protocol =
        (await this.chatService.getOrCreateChatProtocol(
          chat.account.id,
          chat.chat_id,
          'protocol_start'
        )) || this.chatService.getLatestProtocolByType(chat, 'protocol_start');
    }

    const resolvedMessage = replaceMessageTags({
      message: templateMessage,
      chat,
      t,
      protocol,
    });

    await this.chatMessageService.sendMessage(t, {
      chat,
      accountId: chat.account.id,
      type: EMessageType.text,
      message: resolvedMessage,
      typeUser: ETypeUserChat.system,
    });

    return protocol;
  }

  private async findLastHumanRelevantMessage(
    chat: IChat
  ): Promise<IChatMessage | null> {
    const lastMessageId = chat.summary?.last_message_id?.trim() || null;

    if (lastMessageId) {
      const foundById = await this.chatService.findMessageByMessageId(
        chat.account.id,
        lastMessageId
      );

      if (
        foundById &&
        foundById.type_user !== ETypeUserChat.system &&
        foundById.type_user !== ETypeUserChat.bot
      ) {
        return foundById;
      }
    }

    return this.chatService.findLastHumanMessageByChatId(
      chat.account.id,
      chat.chat_id
    );
  }

  private async isLastHumanMessageFromOperator(chat: IChat): Promise<boolean> {
    const lastMessage = await this.findLastHumanRelevantMessage(chat);

    if (!lastMessage) {
      return false;
    }

    return lastMessage.type_user === ETypeUserChat.operator;
  }

  private async resolveFinalStatusForFinish(chat: IChat): Promise<EChatStatus> {
    if (chat.forward_to_output_chatbot === false) {
      return EChatStatus.closed;
    }

    const chatbotConfig = await this.workerConfigService.viewChatbots(chat.worker.id);

    if (chatbotConfig.enabled && chatbotConfig.output_chatbot_id) {
      return EChatStatus.ura_output;
    }

    return EChatStatus.closed;
  }

  private async bootstrapOutputChatbotIfNeeded(
    t: TFunction<'translation', undefined>,
    chat: IChat
  ): Promise<void> {
    const chatbotConfig = await this.workerConfigService.viewChatbots(chat.worker.id);

    if (!chatbotConfig.enabled || !chatbotConfig.output_chatbot_id) {
      return;
    }

    const bootstrapEnvelope: IUpsertMessageEnvelope = {
      key: {
        id: `inactivity_bootstrap_${chat.chat_id}_${Date.now()}`,
        remoteJid: chat.message_key?.remote_jid ?? undefined,
        remoteJidAlt: chat.message_key?.remote_jid_alt ?? undefined,
        fromMe: true,
      },
      message: {
        conversation: '',
      },
      messageTimestamp: Math.floor(Date.now() / 1000),
    };

    await this.chatbotFlowRunnerService.clearFlowCacheForChat(
      chat.account.id,
      chat.worker.id,
      chat.chat_id
    );

    await this.chatbotFlowRunnerService.execute(
      t,
      {
        account_id: chat.account.id,
        worker_id: chat.worker.id,
        type: EMessageType.text,
        message: bootstrapEnvelope,
        has_quoted: false,
        is_call_event: false,
      },
      chat,
      chatbotConfig.output_chatbot_id
    );
  }

  private async finishAttendanceByInactivity(
    t: TFunction<'translation', undefined>,
    chat: IChat
  ): Promise<void> {
    const currentChat = await this.chatService.findChatByChatId(
      chat.account.id,
      chat.chat_id
    );

    if (!currentChat || currentChat.status !== EChatStatus.in_chat) {
      return;
    }

    const targetStatus = await this.resolveFinalStatusForFinish(currentChat);
    const closedAt =
      targetStatus === EChatStatus.closed ? new Date().toISOString() : undefined;

    const statusUpdated = await this.chatService.updateChatStatus(
      currentChat.chat_id,
      targetStatus,
      undefined,
      undefined,
      closedAt
    );

    if (!statusUpdated) {
      return;
    }

    if (targetStatus === EChatStatus.ura_output) {
      await this.chatService.updateForwardToOutputChatbot(currentChat.chat_id, false);
    }

    await this.chatService.clearChatSummary(currentChat.chat_id, currentChat.account.id);

    const refreshedChat = await this.chatService.findChatByChatId(
      currentChat.account.id,
      currentChat.chat_id
    );

    const finalChat: IChat = refreshedChat
      ? refreshedChat
      : {
          ...currentChat,
          status: targetStatus,
          closed_at: closedAt ?? currentChat.closed_at,
          forward_to_output_chatbot:
            targetStatus === EChatStatus.ura_output
              ? false
              : currentChat.forward_to_output_chatbot,
        };

    if (targetStatus === EChatStatus.closed) {
      await this.sendFinishAttendanceMessageIfNeeded(t, finalChat);

      await this.chatMessageService.sendMessage(t, {
        chat: finalChat,
        accountId: finalChat.account.id,
        type: EMessageType.annotation,
        message: t('chat_closed_by_inactivity_audit'),
        typeUser: ETypeUserChat.system,
        annotationSubtype: 'closure_audit',
      });
    }

    await Promise.all([
      this.centrifugoService.publishSubImmediate(
        chatAccountCentrifugo(finalChat.account.id),
        finalChat
      ),
      this.centrifugoService.publishSubImmediate(
        chatQueueAccountCentrifugo(finalChat.account.id),
        finalChat
      ),
      this.chatService.invalidateChatCache(finalChat),
    ]);

    if (targetStatus === EChatStatus.ura_output) {
      await this.bootstrapOutputChatbotIfNeeded(t, finalChat);
    }
  }

  async processScheduledInactivityChecks(
    t: TFunction<'translation', undefined>
  ): Promise<void> {
    const scheduleKey = this.getInactivityScheduleKey();
    const now = Date.now();

    const keysToCheck = await this.redis.zrangebyscore(
      scheduleKey,
      0,
      now,
      'LIMIT',
      0,
      100
    );

    if (keysToCheck.length === 0) {
      return;
    }

    for (const inactivityCacheKey of keysToCheck) {
      await this.redis.zrem(scheduleKey, inactivityCacheKey);

      const inactivityDataStr = await this.redis.get(inactivityCacheKey);

      if (!inactivityDataStr) {
        continue;
      }

      const inactivityData = JSON.parse(
        inactivityDataStr
      ) as IAttendanceInactivityData;

      const chat = await this.chatService.findChatByChatId(
        inactivityData.accountId,
        inactivityData.chatId
      );

      if (!chat || chat.status !== EChatStatus.in_chat) {
        await this.cancelInactivityTrackingByIds(
          inactivityData.accountId,
          inactivityData.workerId,
          inactivityData.chatId
        );
        continue;
      }

      const config = await this.workerConfigService.viewAttendanceInactivityAlert(
        inactivityData.workerId
      );

      if (!config.enabled) {
        await this.cancelInactivityTracking(chat);
        continue;
      }

      const alertCount = inactivityData.alertCount || 0;
      const inactivityWindowMs = config.time * 60 * 1000;

      // Closing stage: once all alerts are consumed, wait one extra inactivity window
      // after the last alert before finishing attendance.
      if (alertCount >= config.quantity) {
        const closeBaseTime = inactivityData.lastAlertTime ?? inactivityData.lastInteraction;
        const nextCloseCheckTime = closeBaseTime + inactivityWindowMs;

        if (now < nextCloseCheckTime) {
          await this.upsertInactivitySchedule(
            inactivityCacheKey,
            inactivityData,
            nextCloseCheckTime
          );
          continue;
        }

        await this.finishAttendanceByInactivity(t, chat);
        await this.cancelInactivityTracking(chat);
        continue;
      }

      const nextAlertCheckTime = inactivityData.lastInteraction + inactivityWindowMs;
      if (now < nextAlertCheckTime) {
        await this.upsertInactivitySchedule(
          inactivityCacheKey,
          inactivityData,
          nextAlertCheckTime
        );
        continue;
      }

      const isFirstAlert = alertCount === 0;
      if (isFirstAlert) {
        const canNotifyByLastMessage =
          await this.isLastHumanMessageFromOperator(chat);
        if (!canNotifyByLastMessage) {
          await this.upsertInactivitySchedule(
            inactivityCacheKey,
            inactivityData,
            now + inactivityWindowMs
          );
          continue;
        }
      }

      const newAlertCount = alertCount + 1;

      if (config.inactivity_message_enabled) {
        const message =
          config.inactivity_message || t('attendance_inactivity_message_default');

        await this.sendInactivityMessage(t, chat, message);
      }

      const updatedData: IAttendanceInactivityData = {
        ...inactivityData,
        alertCount: newAlertCount,
        lastAlertTime: now,
      };

      await this.upsertInactivitySchedule(
        inactivityCacheKey,
        updatedData,
        now + inactivityWindowMs
      );
    }
  }
}
