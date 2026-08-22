import { injectable, inject } from 'tsyringe';
import Redis from 'ioredis';
import { TFunction } from 'i18next';
import { ChatService } from './chat.service';
import { ChatMessageService } from './chatMessage.service';
import { WorkerConfigService } from './workerConfig.service';
import { WorkerService } from './worker.service';
import { ChatbotFlowRunnerService } from './chatbotFlowRunner.service';
import { ChatLifecycleService } from './chatLifecycle.service';
import { IChat } from '@core/common/interfaces/IChat';
import {
  IAttendanceInactivityData,
  TAttendanceInactivityStage,
} from '@core/common/interfaces/IAttendanceInactivityData';
import { IAttendanceInactivityAlertConfig } from '@core/common/interfaces/IAttendanceInactivityAlert';
import { IChatMessage } from '@core/common/interfaces/IChatMessage';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { EMessageType } from '@core/common/enums/EMessageType';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import { replaceMessageTags } from '@core/common/functions/replaceMessageTags';
import { hasProtocolTag } from '@core/common/functions/hasProtocolTag';
import {
  createAttendanceInactivityCacheKey,
  createAttendanceInactivityDisabledCacheKey,
} from '@core/common/functions/createCacheKey';
import { withLock } from '@core/common/functions/withLock';
import { releaseLock } from '@core/common/functions/releaseLock';
import { IUpsertMessageEnvelope } from '@core/common/interfaces/IUpsertMessage';
import { v5 as uuidv5, v7 as uuidv7 } from 'uuid';

type TTrackedAttendanceInactivityData = IAttendanceInactivityData & {
  tracking_id: string;
  retry_count: number;
  stage: TAttendanceInactivityStage;
};

@injectable()
export class AttendanceInactivityService {
  private readonly INACTIVITY_DISABLED_OVERRIDE_TTL_SECONDS = 2592000;
  private readonly RETRY_BASE_DELAY_MS = 30000;
  private readonly RETRY_MAX_DELAY_MS = 300000;
  private scheduleReconciled = false;
  private scheduleReconciliationPromise: Promise<void> | null = null;

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
    @inject(ChatbotFlowRunnerService)
    private readonly chatbotFlowRunnerService: ChatbotFlowRunnerService,
    @inject(ChatLifecycleService)
    private readonly chatLifecycleService: ChatLifecycleService
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

  private getInactivityDisabledCacheKey(
    accountId: string,
    workerId: string,
    chatId: string
  ): string {
    return createAttendanceInactivityDisabledCacheKey(
      accountId,
      workerId,
      chatId
    );
  }

  private getOutputBootstrapKey(
    accountId: string,
    workerId: string,
    chatId: string,
    statusEventId: string
  ): string {
    return `underchat:attendance-inactivity-bootstrap:${accountId}:${workerId}:${chatId}:${statusEventId}`;
  }

  private getInactivityLockKey(
    accountId: string,
    workerId: string,
    chatId: string
  ): string {
    return `attendance-inactivity:${accountId}:${workerId}:${chatId}`;
  }

  private async withInactivityChatLock<T>(
    accountId: string,
    workerId: string,
    chatId: string,
    fn: () => Promise<T>
  ): Promise<T> {
    return withLock(
      this.redis,
      this.getInactivityLockKey(accountId, workerId, chatId),
      fn,
      {
        ttlMs: 30000,
        maxWaitMs: 60000,
        retryMs: 120,
      }
    );
  }

  private parseInactivityData(
    inactivityDataStr: string | null
  ): IAttendanceInactivityData | null {
    if (!inactivityDataStr) {
      return null;
    }

    try {
      const parsed = JSON.parse(
        inactivityDataStr
      ) as Partial<IAttendanceInactivityData>;
      const lastInteraction = parsed.lastInteraction;
      const lastAlertTime = parsed.lastAlertTime;

      if (
        typeof lastInteraction !== 'number' ||
        !Number.isFinite(lastInteraction) ||
        typeof parsed.accountId !== 'string' ||
        parsed.accountId.length === 0 ||
        typeof parsed.workerId !== 'string' ||
        parsed.workerId.length === 0 ||
        typeof parsed.chatId !== 'string' ||
        parsed.chatId.length === 0
      ) {
        return null;
      }

      return {
        ...parsed,
        lastInteraction,
        alertCount: Number.isFinite(parsed.alertCount)
          ? Math.max(0, Math.floor(parsed.alertCount ?? 0))
          : 0,
        lastAlertTime:
          typeof lastAlertTime === 'number' && Number.isFinite(lastAlertTime)
            ? lastAlertTime
            : null,
        accountId: parsed.accountId,
        workerId: parsed.workerId,
        chatId: parsed.chatId,
      };
    } catch {
      return null;
    }
  }

  private normalizeInactivityData(
    data: IAttendanceInactivityData,
    defaultStage: TAttendanceInactivityStage = 'waiting_alert'
  ): TTrackedAttendanceInactivityData {
    const validStages: TAttendanceInactivityStage[] = [
      'waiting_alert',
      'waiting_close',
      'finishing',
      'bootstrapping_output',
    ];
    const stage = validStages.includes(data.stage as TAttendanceInactivityStage)
      ? (data.stage as TAttendanceInactivityStage)
      : defaultStage;

    return {
      ...data,
      tracking_id:
        typeof data.tracking_id === 'string' && data.tracking_id.trim()
          ? data.tracking_id.trim()
          : uuidv7(),
      retry_count: Number.isFinite(data.retry_count)
        ? Math.max(0, Math.floor(data.retry_count ?? 0))
        : 0,
      stage,
    };
  }

  private createTrackingData(params: {
    accountId: string;
    workerId: string;
    chatId: string;
    lastInteraction: number;
    lastHumanInteractor: 'operator' | 'client' | null;
    chat?: IChat;
  }): TTrackedAttendanceInactivityData {
    const chat = params.chat;
    return {
      accountId: params.accountId,
      workerId: params.workerId,
      chatId: params.chatId,
      lastInteraction: params.lastInteraction,
      lastHumanInteractor: params.lastHumanInteractor,
      alertCount: 0,
      lastAlertTime: null,
      tracking_id: uuidv7(),
      retry_count: 0,
      stage: 'waiting_alert',
      expected_status_event_id: chat?.meta?.status_event_id ?? null,
      expected_status_epoch: chat?.meta?.status_epoch ?? null,
      expected_started_at: chat?.started_at ?? null,
      last_human_message_id: chat?.summary?.last_message_id ?? null,
    };
  }

  private assertTransactionSucceeded(
    results: Array<[Error | null, unknown]> | null
  ): void {
    if (!results) {
      throw new Error('attendance inactivity Redis transaction was aborted');
    }

    const failedCommand = results.find(([error]) => error !== null);
    if (failedCommand?.[0]) {
      throw failedCommand[0];
    }
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
    const normalizedData = this.normalizeInactivityData(data);
    const results = await this.redis
      .multi()
      .set(cacheKey, JSON.stringify(normalizedData))
      .zadd(scheduleKey, nextCheckTime, cacheKey)
      .exec();

    this.assertTransactionSucceeded(results);
  }

  private async clearInactivityTrackingByCacheKeyNoLock(
    cacheKey: string
  ): Promise<void> {
    const results = await this.redis
      .multi()
      .del(cacheKey)
      .zrem(this.getInactivityScheduleKey(), cacheKey)
      .exec();

    this.assertTransactionSucceeded(results);
  }

  private async clearInactivityTrackingByIdsNoLock(
    accountId: string,
    workerId: string,
    chatId: string
  ): Promise<void> {
    const cacheKey = this.getInactivityCacheKey(accountId, workerId, chatId);
    await this.clearInactivityTrackingByCacheKeyNoLock(cacheKey);
  }

  private async clearInactivityDisabledOverrideByIdsNoLock(
    accountId: string,
    workerId: string,
    chatId: string
  ): Promise<void> {
    const disabledKey = this.getInactivityDisabledCacheKey(
      accountId,
      workerId,
      chatId
    );

    await this.redis.del(disabledKey);
  }

  private async isInactivityDisabledByIdsNoLock(
    accountId: string,
    workerId: string,
    chatId: string
  ): Promise<boolean> {
    const disabledKey = this.getInactivityDisabledCacheKey(
      accountId,
      workerId,
      chatId
    );
    const value = await this.redis.get(disabledKey);
    return value === '1';
  }

  private async setInactivityDisabledByIdsNoLock(
    accountId: string,
    workerId: string,
    chatId: string
  ): Promise<void> {
    const disabledKey = this.getInactivityDisabledCacheKey(
      accountId,
      workerId,
      chatId
    );
    await this.redis.set(
      disabledKey,
      '1',
      'EX',
      this.INACTIVITY_DISABLED_OVERRIDE_TTL_SECONDS
    );
  }

  private async findCurrentInChatOrClearTrackingNoLock(
    chat: IChat
  ): Promise<IChat | null> {
    const currentChat = await this.chatService.findChatByChatId(
      chat.account.id,
      chat.chat_id
    );

    if (!currentChat || currentChat.status !== EChatStatus.in_chat) {
      await this.clearInactivityTrackingByIdsNoLock(
        chat.account.id,
        chat.worker.id,
        chat.chat_id
      );
      return null;
    }

    return currentChat;
  }

  private async resetTrackingOnMessageNoLock(
    chat: IChat,
    lastHumanInteractor: 'operator' | 'client',
    configOverride?: IAttendanceInactivityAlertConfig | null
  ): Promise<void> {
    const currentChat = await this.findCurrentInChatOrClearTrackingNoLock(chat);
    if (!currentChat) {
      return;
    }

    const config = await this.resolveConfig(
      currentChat.worker.id,
      configOverride
    );

    if (!config.enabled) {
      await this.clearInactivityTrackingByIdsNoLock(
        currentChat.account.id,
        currentChat.worker.id,
        currentChat.chat_id
      );
      return;
    }

    if (
      await this.isInactivityDisabledByIdsNoLock(
        currentChat.account.id,
        currentChat.worker.id,
        currentChat.chat_id
      )
    ) {
      await this.clearInactivityTrackingByIdsNoLock(
        currentChat.account.id,
        currentChat.worker.id,
        currentChat.chat_id
      );
      return;
    }

    const cacheKey = this.getInactivityCacheKey(
      currentChat.account.id,
      currentChat.worker.id,
      currentChat.chat_id
    );
    const now = Date.now();
    const nextCheckTime = now + config.time * 60 * 1000;

    const data = this.createTrackingData({
      accountId: currentChat.account.id,
      workerId: currentChat.worker.id,
      chatId: currentChat.chat_id,
      lastInteraction: now,
      lastHumanInteractor,
      chat: currentChat,
    });

    await this.upsertInactivitySchedule(cacheKey, data, nextCheckTime);
  }

  private async resetTrackingOnOperatorAnnotationNoLock(
    chat: IChat,
    configOverride?: IAttendanceInactivityAlertConfig | null
  ): Promise<void> {
    const currentChat = await this.findCurrentInChatOrClearTrackingNoLock(chat);
    if (!currentChat) {
      return;
    }

    const config = await this.resolveConfig(
      currentChat.worker.id,
      configOverride
    );
    if (!config.enabled) {
      await this.clearInactivityTrackingByIdsNoLock(
        currentChat.account.id,
        currentChat.worker.id,
        currentChat.chat_id
      );
      return;
    }

    if (
      await this.isInactivityDisabledByIdsNoLock(
        currentChat.account.id,
        currentChat.worker.id,
        currentChat.chat_id
      )
    ) {
      await this.clearInactivityTrackingByIdsNoLock(
        currentChat.account.id,
        currentChat.worker.id,
        currentChat.chat_id
      );
      return;
    }

    const now = Date.now();
    const nextCheckTime = now + config.time * 60 * 1000;
    const cacheKey = this.getInactivityCacheKey(
      currentChat.account.id,
      currentChat.worker.id,
      currentChat.chat_id
    );

    const data = this.createTrackingData({
      accountId: currentChat.account.id,
      workerId: currentChat.worker.id,
      chatId: currentChat.chat_id,
      lastInteraction: now,
      lastHumanInteractor: 'client',
      chat: currentChat,
    });

    await this.upsertInactivitySchedule(cacheKey, data, nextCheckTime);
  }

  async startTrackingOnInChatEntry(
    chat: IChat,
    configOverride?: IAttendanceInactivityAlertConfig | null
  ): Promise<void> {
    await this.withInactivityChatLock(
      chat.account.id,
      chat.worker.id,
      chat.chat_id,
      async () => {
        const currentChat =
          await this.findCurrentInChatOrClearTrackingNoLock(chat);
        if (!currentChat) {
          return;
        }

        await this.clearInactivityDisabledOverrideByIdsNoLock(
          currentChat.account.id,
          currentChat.worker.id,
          currentChat.chat_id
        );

        const config = await this.resolveConfig(
          currentChat.worker.id,
          configOverride
        );

        if (!config.enabled) {
          await this.clearInactivityTrackingByIdsNoLock(
            currentChat.account.id,
            currentChat.worker.id,
            currentChat.chat_id
          );
          return;
        }

        const now = Date.now();
        const nextCheckTime = now + config.time * 60 * 1000;
        const cacheKey = this.getInactivityCacheKey(
          currentChat.account.id,
          currentChat.worker.id,
          currentChat.chat_id
        );

        const data = this.createTrackingData({
          accountId: currentChat.account.id,
          workerId: currentChat.worker.id,
          chatId: currentChat.chat_id,
          lastInteraction: now,
          lastHumanInteractor: null,
          chat: currentChat,
        });

        await this.upsertInactivitySchedule(cacheKey, data, nextCheckTime);
      }
    );
  }

  async resetOnContactMessage(
    chat: IChat,
    configOverride?: IAttendanceInactivityAlertConfig | null
  ): Promise<void> {
    await this.withInactivityChatLock(
      chat.account.id,
      chat.worker.id,
      chat.chat_id,
      async () =>
        this.resetTrackingOnMessageNoLock(chat, 'client', configOverride)
    );
  }

  async resetOnOperatorMessage(
    chat: IChat,
    configOverride?: IAttendanceInactivityAlertConfig | null
  ): Promise<void> {
    await this.withInactivityChatLock(
      chat.account.id,
      chat.worker.id,
      chat.chat_id,
      async () =>
        this.resetTrackingOnMessageNoLock(chat, 'operator', configOverride)
    );
  }

  async resetOnOperatorAnnotationMessage(
    chat: IChat,
    configOverride?: IAttendanceInactivityAlertConfig | null
  ): Promise<void> {
    await this.withInactivityChatLock(
      chat.account.id,
      chat.worker.id,
      chat.chat_id,
      async () =>
        this.resetTrackingOnOperatorAnnotationNoLock(chat, configOverride)
    );
  }

  async cancelInactivityTracking(chat: IChat): Promise<void> {
    await this.withInactivityChatLock(
      chat.account.id,
      chat.worker.id,
      chat.chat_id,
      async () =>
        this.clearInactivityTrackingByIdsNoLock(
          chat.account.id,
          chat.worker.id,
          chat.chat_id
        )
    );
  }

  async cancelInactivityTrackingForEndedAttendance(chat: IChat): Promise<void> {
    await this.withInactivityChatLock(
      chat.account.id,
      chat.worker.id,
      chat.chat_id,
      async () => {
        await this.clearInactivityTrackingByIdsNoLock(
          chat.account.id,
          chat.worker.id,
          chat.chat_id
        );
        await this.clearInactivityDisabledOverrideByIdsNoLock(
          chat.account.id,
          chat.worker.id,
          chat.chat_id
        );
      }
    );
  }

  async cancelInactivityTrackingByIds(
    accountId: string,
    workerId: string,
    chatId: string
  ): Promise<void> {
    await this.withInactivityChatLock(accountId, workerId, chatId, async () =>
      this.clearInactivityTrackingByIdsNoLock(accountId, workerId, chatId)
    );
  }

  async viewAttendanceInactivityDisabledForChat(chat: IChat): Promise<boolean> {
    return this.withInactivityChatLock(
      chat.account.id,
      chat.worker.id,
      chat.chat_id,
      async () =>
        this.isInactivityDisabledByIdsNoLock(
          chat.account.id,
          chat.worker.id,
          chat.chat_id
        )
    );
  }

  async updateAttendanceInactivityDisabledForChat(
    chat: IChat,
    disabled: boolean
  ): Promise<void> {
    await this.withInactivityChatLock(
      chat.account.id,
      chat.worker.id,
      chat.chat_id,
      async () => {
        if (disabled) {
          await this.setInactivityDisabledByIdsNoLock(
            chat.account.id,
            chat.worker.id,
            chat.chat_id
          );
          await this.clearInactivityTrackingByIdsNoLock(
            chat.account.id,
            chat.worker.id,
            chat.chat_id
          );
          return;
        }

        await this.clearInactivityDisabledOverrideByIdsNoLock(
          chat.account.id,
          chat.worker.id,
          chat.chat_id
        );

        if (chat.status === EChatStatus.in_chat) {
          await this.resetTrackingOnMessageNoLock(chat, 'client');
        } else {
          await this.clearInactivityTrackingByIdsNoLock(
            chat.account.id,
            chat.worker.id,
            chat.chat_id
          );
        }
      }
    );
  }

  private async sendInactivityMessage(
    t: TFunction<'translation', undefined>,
    chat: IChat,
    message: string,
    messageId: string
  ): Promise<void> {
    const resolvedMessage = replaceMessageTags({
      message,
      chat,
      t,
    });

    const sent = await this.chatMessageService.sendMessage(t, {
      chat,
      accountId: chat.account.id,
      messageId,
      type: EMessageType.system,
      message: resolvedMessage,
      hash: messageId,
      typeUser: ETypeUserChat.system,
    });

    if (!sent) {
      throw new Error('failed to persist attendance inactivity alert');
    }
  }

  private async sendFinishAttendanceMessageIfNeeded(
    t: TFunction<'translation', undefined>,
    chat: IChat,
    messageId: string
  ): Promise<void> {
    const workerConfigFields =
      await this.workerService.viewWorkerConfigFieldsByWorkerId(chat.worker.id);

    const templateMessage =
      workerConfigFields?.send_message_on_finish_attendance;

    if (!templateMessage) {
      return;
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

    const sent = await this.chatMessageService.sendMessage(t, {
      chat,
      accountId: chat.account.id,
      messageId,
      type: EMessageType.text,
      message: resolvedMessage,
      hash: messageId,
      typeUser: ETypeUserChat.system,
    });

    if (!sent) {
      throw new Error('failed to persist attendance inactivity finish message');
    }
  }

  private async findLastAttendanceActivity(
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

    return this.chatService.findLastAttendanceActivityByChatId(
      chat.account.id,
      chat.chat_id
    );
  }

  private async isLastHumanMessageFromOperator(chat: IChat): Promise<boolean> {
    const lastMessage =
      await this.chatService.findLastAttendanceActivityByChatId(
        chat.account.id,
        chat.chat_id
      );

    if (!lastMessage) {
      return false;
    }

    return lastMessage.type_user === ETypeUserChat.operator;
  }

  private async bootstrapOutputChatbotIfNeeded(
    t: TFunction<'translation', undefined>,
    chat: IChat,
    bootstrapId: string
  ): Promise<void> {
    const chatbotConfig = await this.workerConfigService.viewChatbots(
      chat.worker.id
    );

    if (!chatbotConfig.enabled || !chatbotConfig.output_chatbot_id) {
      throw new Error(
        'output chatbot is unavailable after attendance inactivity transition'
      );
    }

    const bootstrapKey = this.getOutputBootstrapKey(
      chat.account.id,
      chat.worker.id,
      chat.chat_id,
      bootstrapId
    );
    const existingBootstrap = await this.redis.get(bootstrapKey);
    if (existingBootstrap === 'completed') {
      return;
    }

    const claimToken = uuidv7();
    const processingValue = `processing:${claimToken}`;
    const claimed = await this.redis.set(
      bootstrapKey,
      processingValue,
      'EX',
      300,
      'NX'
    );
    if (claimed !== 'OK') {
      const currentState = await this.redis.get(bootstrapKey);
      if (currentState === 'completed') {
        return;
      }
      throw new Error('output chatbot bootstrap is already in progress');
    }

    try {
      const bootstrapEnvelope: IUpsertMessageEnvelope = {
        key: {
          id: `inactivity_bootstrap_${bootstrapId}`,
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

      const startedFlowId = await this.chatbotFlowRunnerService.execute(
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
        chatbotConfig.output_chatbot_id,
        undefined,
        { requireHandled: true, executionId: bootstrapId }
      );

      if (!startedFlowId) {
        throw new Error('output chatbot bootstrap was not confirmed');
      }

      await this.redis.set(bootstrapKey, 'completed', 'EX', 2592000);
    } catch (error) {
      await releaseLock(this.redis, bootstrapKey, processingValue);
      throw error;
    }
  }

  private async findOwnedLifecycleChat(
    chat: IChat,
    status: EChatStatus.closed | EChatStatus.ura_output,
    statusEventId: string
  ): Promise<IChat | null> {
    const currentChat = await this.chatService.findChatByChatId(
      chat.account.id,
      chat.chat_id
    );
    if (
      !currentChat ||
      currentChat.status !== status ||
      currentChat.meta?.status_source !== 'attendance_inactivity' ||
      currentChat.meta.status_event_id !== statusEventId
    ) {
      return null;
    }

    return currentChat;
  }

  private async finishAttendanceByInactivity(
    t: TFunction<'translation', undefined>,
    chat: IChat,
    inactivityCacheKey: string,
    inactivityData: TTrackedAttendanceInactivityData
  ): Promise<'completed' | 'not_owned'> {
    const targetStatusEventId =
      inactivityData.target_status_event_id ||
      inactivityData.status_event_id ||
      uuidv7();
    const transitionData: TTrackedAttendanceInactivityData = {
      ...inactivityData,
      target_status_event_id: targetStatusEventId,
    };
    if (inactivityData.target_status_event_id !== targetStatusEventId) {
      await this.upsertInactivitySchedule(
        inactivityCacheKey,
        transitionData,
        Date.now()
      );
    }

    const lifecycleResult = await this.chatLifecycleService.finishChat({
      chat,
      source: 'attendance_inactivity',
      expectedStatuses: [EChatStatus.in_chat],
      respectOutputChatbot: true,
      statusEventId: targetStatusEventId,
    });

    if (lifecycleResult.outcome === 'retryable_failure') {
      throw new Error('attendance inactivity lifecycle transition failed');
    }

    if (
      lifecycleResult.outcome === 'status_mismatch' ||
      (lifecycleResult.outcome === 'already_at_target' &&
        !lifecycleResult.ownedBySource)
    ) {
      return 'not_owned';
    }

    const finalChat = lifecycleResult.chat;
    const statusEventId =
      lifecycleResult.statusEventId ||
      transitionData.status_event_id ||
      targetStatusEventId;
    if (!statusEventId) {
      throw new Error('attendance inactivity status event was not confirmed');
    }
    const sameStatusEvent = transitionData.status_event_id === statusEventId;

    if (lifecycleResult.targetStatus === EChatStatus.ura_output) {
      const bootstrapData: TTrackedAttendanceInactivityData = {
        ...transitionData,
        retry_count: 0,
        stage: 'bootstrapping_output',
        status_event_id: statusEventId,
      };

      await this.upsertInactivitySchedule(
        inactivityCacheKey,
        bootstrapData,
        Date.now()
      );
      const ownedChat = await this.findOwnedLifecycleChat(
        finalChat,
        EChatStatus.ura_output,
        statusEventId
      );
      if (!ownedChat) {
        return 'not_owned';
      }
      await this.bootstrapOutputChatbotIfNeeded(t, ownedChat, statusEventId);

      return 'completed';
    }

    let effectData: TTrackedAttendanceInactivityData = {
      ...transitionData,
      retry_count: 0,
      stage: 'finishing',
      status_event_id: statusEventId,
      finish_message_sent: sameStatusEvent
        ? transitionData.finish_message_sent
        : false,
      audit_message_sent: sameStatusEvent
        ? transitionData.audit_message_sent
        : false,
    };

    await this.upsertInactivitySchedule(
      inactivityCacheKey,
      effectData,
      Date.now()
    );

    if (!effectData.finish_message_sent) {
      const ownedChat = await this.findOwnedLifecycleChat(
        finalChat,
        EChatStatus.closed,
        statusEventId
      );
      if (!ownedChat) {
        return 'not_owned';
      }
      await this.sendFinishAttendanceMessageIfNeeded(
        t,
        ownedChat,
        statusEventId
      );
      effectData = { ...effectData, finish_message_sent: true };
      await this.upsertInactivitySchedule(
        inactivityCacheKey,
        effectData,
        Date.now()
      );
    }

    if (!effectData.audit_message_sent) {
      const ownedChat = await this.findOwnedLifecycleChat(
        finalChat,
        EChatStatus.closed,
        statusEventId
      );
      if (!ownedChat) {
        return 'not_owned';
      }
      const auditMessageId = uuidv5(
        `attendance-inactivity:${statusEventId}:closure-audit`,
        uuidv5.URL
      );
      const auditSent = await this.chatMessageService.sendMessage(t, {
        chat: ownedChat,
        accountId: ownedChat.account.id,
        messageId: auditMessageId,
        type: EMessageType.annotation,
        message: t('chat_closed_by_inactivity_audit'),
        hash: auditMessageId,
        typeUser: ETypeUserChat.system,
        annotationSubtype: 'closure_audit',
      });

      if (!auditSent) {
        throw new Error('failed to persist attendance inactivity audit');
      }

      effectData = { ...effectData, audit_message_sent: true };
      await this.upsertInactivitySchedule(
        inactivityCacheKey,
        effectData,
        Date.now()
      );
    }

    return 'completed';
  }

  private parseIdsFromInactivityCacheKey(cacheKey: string): {
    accountId: string;
    workerId: string;
    chatId: string;
  } | null {
    const [namespace, type, accountId, workerId, chatId, ...extra] =
      cacheKey.split(':');

    if (
      namespace !== 'underchat' ||
      type !== 'attendance-inactivity' ||
      !accountId ||
      !workerId ||
      !chatId ||
      extra.length > 0
    ) {
      return null;
    }

    return { accountId, workerId, chatId };
  }

  private async recoverMissingScheduledPayload(
    cacheKey: string
  ): Promise<void> {
    const ids = this.parseIdsFromInactivityCacheKey(cacheKey);
    if (!ids) {
      await this.clearInactivityTrackingByCacheKeyNoLock(cacheKey);
      return;
    }

    await this.withInactivityChatLock(
      ids.accountId,
      ids.workerId,
      ids.chatId,
      async () => {
        const currentData = this.parseInactivityData(
          await this.redis.get(cacheKey)
        );
        if (currentData) {
          await this.redis.persist(cacheKey);
          return;
        }

        const chat = await this.chatService.findChatByChatId(
          ids.accountId,
          ids.chatId
        );
        if (!chat || chat.status !== EChatStatus.in_chat) {
          await this.clearInactivityTrackingByCacheKeyNoLock(cacheKey);
          return;
        }

        const config =
          await this.workerConfigService.viewAttendanceInactivityAlert(
            ids.workerId
          );
        if (
          !config.enabled ||
          (await this.isInactivityDisabledByIdsNoLock(
            ids.accountId,
            ids.workerId,
            ids.chatId
          ))
        ) {
          await this.clearInactivityTrackingByCacheKeyNoLock(cacheKey);
          return;
        }

        const now = Date.now();
        const recoveredData = this.createTrackingData({
          ...ids,
          lastInteraction: now,
          lastHumanInteractor: null,
          chat,
        });

        await this.upsertInactivitySchedule(
          cacheKey,
          recoveredData,
          now + config.time * 60 * 1000
        );
      }
    );
  }

  private isFinalizationStage(data: TTrackedAttendanceInactivityData): boolean {
    return data.stage === 'finishing' || data.stage === 'bootstrapping_output';
  }

  private isTrackedSessionCurrent(
    data: TTrackedAttendanceInactivityData,
    chat: IChat
  ): boolean {
    if (
      data.expected_status_event_id !== undefined &&
      data.expected_status_event_id !== (chat.meta?.status_event_id ?? null)
    ) {
      return false;
    }
    if (
      data.expected_status_epoch !== undefined &&
      data.expected_status_epoch !== (chat.meta?.status_epoch ?? null)
    ) {
      return false;
    }
    if (
      data.expected_started_at !== undefined &&
      data.expected_started_at !== (chat.started_at ?? null)
    ) {
      return false;
    }

    return true;
  }

  private async resetIfNewHumanMessageWasPersisted(
    chat: IChat,
    data: TTrackedAttendanceInactivityData,
    cacheKey: string,
    inactivityWindowMs: number
  ): Promise<boolean> {
    const lastMessage = await this.findLastAttendanceActivity(chat);
    if (!lastMessage) {
      return false;
    }

    const trackedMessageId =
      typeof data.last_human_message_id === 'string'
        ? data.last_human_message_id
        : null;
    const messageTimestamp = new Date(lastMessage.date).getTime();
    const hasNewMessage = trackedMessageId
      ? lastMessage.message_id !== trackedMessageId
      : Number.isFinite(messageTimestamp) &&
        messageTimestamp > data.lastInteraction;
    if (!hasNewMessage) {
      return false;
    }

    const now = Date.now();
    const resetData = this.createTrackingData({
      accountId: chat.account.id,
      workerId: chat.worker.id,
      chatId: chat.chat_id,
      lastInteraction: now,
      lastHumanInteractor:
        lastMessage.type_user === ETypeUserChat.operator
          ? 'operator'
          : 'client',
      chat,
    });
    resetData.last_human_message_id = lastMessage.message_id;
    await this.upsertInactivitySchedule(
      cacheKey,
      resetData,
      now + inactivityWindowMs
    );
    return true;
  }

  private isFinalizationStillApplicable(
    data: TTrackedAttendanceInactivityData,
    chat: IChat
  ): boolean {
    if (chat.status === EChatStatus.in_chat) {
      return !data.status_event_id && this.isTrackedSessionCurrent(data, chat);
    }

    const expectedStatusEventId =
      data.status_event_id ?? data.target_status_event_id;

    return (
      (chat.status === EChatStatus.closed ||
        chat.status === EChatStatus.ura_output) &&
      Boolean(expectedStatusEventId) &&
      chat.meta?.status_source === 'attendance_inactivity' &&
      chat.meta.status_event_id === expectedStatusEventId
    );
  }

  private async reconcileUnscheduledPayload(cacheKey: string): Promise<void> {
    const ids = this.parseIdsFromInactivityCacheKey(cacheKey);
    if (!ids) {
      await this.clearInactivityTrackingByCacheKeyNoLock(cacheKey);
      return;
    }

    await this.withInactivityChatLock(
      ids.accountId,
      ids.workerId,
      ids.chatId,
      async () => {
        const parsedData = this.parseInactivityData(
          await this.redis.get(cacheKey)
        );
        if (!parsedData) {
          await this.clearInactivityTrackingByCacheKeyNoLock(cacheKey);
          return;
        }

        await this.redis.persist(cacheKey);

        const scheduledScore = await this.redis.zscore(
          this.getInactivityScheduleKey(),
          cacheKey
        );
        if (scheduledScore !== null) {
          return;
        }

        const defaultStage =
          parsedData.alertCount > 0 ? 'waiting_close' : 'waiting_alert';
        const inactivityData = this.normalizeInactivityData(
          parsedData,
          defaultStage
        );
        const chat = await this.chatService.findChatByChatId(
          ids.accountId,
          ids.chatId
        );
        if (!chat) {
          await this.clearInactivityTrackingByCacheKeyNoLock(cacheKey);
          return;
        }

        const isFinalization = this.isFinalizationStage(inactivityData);
        if (
          (isFinalization &&
            !this.isFinalizationStillApplicable(inactivityData, chat)) ||
          (!isFinalization && chat.status !== EChatStatus.in_chat)
        ) {
          await this.clearInactivityTrackingByCacheKeyNoLock(cacheKey);
          return;
        }

        const config =
          await this.workerConfigService.viewAttendanceInactivityAlert(
            ids.workerId
          );
        if (
          !isFinalization &&
          (!config.enabled ||
            (await this.isInactivityDisabledByIdsNoLock(
              ids.accountId,
              ids.workerId,
              ids.chatId
            )))
        ) {
          await this.clearInactivityTrackingByCacheKeyNoLock(cacheKey);
          return;
        }

        const inactivityWindowMs =
          Math.max(1, Math.floor(config.time)) * 60 * 1000;
        await this.upsertInactivitySchedule(
          cacheKey,
          inactivityData,
          Date.now() + inactivityWindowMs
        );
      }
    );
  }

  private async reconcileUnscheduledPayloads(): Promise<void> {
    let cursor = '0';
    let failures = 0;

    do {
      const [nextCursor, cacheKeys] = await this.redis.scan(
        cursor,
        'MATCH',
        'underchat:attendance-inactivity:*',
        'COUNT',
        100
      );
      cursor = nextCursor;

      for (const cacheKey of cacheKeys) {
        try {
          await this.reconcileUnscheduledPayload(cacheKey);
        } catch (error) {
          failures += 1;
          console.error('attendance_inactivity_payload_reconciliation_failed', {
            cache_key: cacheKey,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } while (cursor !== '0');

    if (failures > 0) {
      throw new Error(
        `attendance inactivity payload reconciliation failed for ${failures} item(s)`
      );
    }
  }

  /**
   * Removes the legacy 24-hour TTL and repairs both halves of the schedule:
   * payloads without a ZSET member and members whose payload expired. It is
   * safe to call more than once and uses cursor scans to bound memory usage.
   */
  async reconcileScheduledInactivityChecks(): Promise<void> {
    await this.reconcileUnscheduledPayloads();

    const scheduleKey = this.getInactivityScheduleKey();
    let cursor = '0';
    let failures = 0;

    do {
      const [nextCursor, entries] = await this.redis.zscan(
        scheduleKey,
        cursor,
        'COUNT',
        100
      );
      cursor = nextCursor;

      for (let index = 0; index < entries.length; index += 2) {
        const cacheKey = entries[index];

        try {
          const payload = await this.redis.get(cacheKey);
          if (this.parseInactivityData(payload)) {
            await this.redis.persist(cacheKey);
            continue;
          }

          await this.recoverMissingScheduledPayload(cacheKey);
        } catch (error) {
          failures += 1;
          console.error('attendance_inactivity_reconciliation_failed', {
            cache_key: cacheKey,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } while (cursor !== '0');

    if (failures > 0) {
      throw new Error(
        `attendance inactivity schedule reconciliation failed for ${failures} item(s)`
      );
    }
  }

  private async ensureScheduleReconciled(): Promise<void> {
    if (this.scheduleReconciled) {
      return;
    }

    if (!this.scheduleReconciliationPromise) {
      this.scheduleReconciliationPromise =
        this.reconcileScheduledInactivityChecks()
          .then(() => {
            this.scheduleReconciled = true;
          })
          .finally(() => {
            this.scheduleReconciliationPromise = null;
          });
    }

    await this.scheduleReconciliationPromise;
  }

  private getRetryDelayMs(retryCount: number): number {
    const exponent = Math.max(0, retryCount - 1);
    return Math.min(
      this.RETRY_BASE_DELAY_MS * 2 ** exponent,
      this.RETRY_MAX_DELAY_MS
    );
  }

  private async rescheduleFailedCheck(
    cacheKey: string,
    fallbackData: IAttendanceInactivityData | null,
    error: unknown
  ): Promise<void> {
    const ids =
      this.parseIdsFromInactivityCacheKey(cacheKey) ??
      (fallbackData
        ? {
            accountId: fallbackData.accountId,
            workerId: fallbackData.workerId,
            chatId: fallbackData.chatId,
          }
        : null);
    if (!ids) {
      await this.clearInactivityTrackingByCacheKeyNoLock(cacheKey);
      return;
    }

    try {
      await this.withInactivityChatLock(
        ids.accountId,
        ids.workerId,
        ids.chatId,
        async () => {
          const scheduledScore = await this.redis.zscore(
            this.getInactivityScheduleKey(),
            cacheKey
          );
          if (scheduledScore === null || Number(scheduledScore) > Date.now()) {
            return;
          }

          const rawPayload = await this.redis.get(cacheKey);
          const currentData = rawPayload
            ? this.parseInactivityData(rawPayload)
            : fallbackData;
          if (!currentData) {
            await this.clearInactivityTrackingByCacheKeyNoLock(cacheKey);
            return;
          }
          if (rawPayload && !this.parseInactivityData(rawPayload)) {
            await this.clearInactivityTrackingByCacheKeyNoLock(cacheKey);
            return;
          }

          const normalizedData = this.normalizeInactivityData(currentData);
          if (!this.isSameFailedAttempt(normalizedData, fallbackData)) {
            return;
          }

          const retryCount = normalizedData.retry_count + 1;
          const retryData: TTrackedAttendanceInactivityData = {
            ...normalizedData,
            retry_count: retryCount,
          };
          const retryDelayMs = this.getRetryDelayMs(retryCount);

          await this.upsertInactivitySchedule(
            cacheKey,
            retryData,
            Date.now() + retryDelayMs
          );

          console.error('attendance_inactivity_check_failed', {
            account_id: retryData.accountId,
            worker_id: retryData.workerId,
            chat_id: retryData.chatId,
            tracking_id: retryData.tracking_id,
            stage: retryData.stage,
            retry_count: retryCount,
            retry_in_ms: retryDelayMs,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      );
    } catch (rescheduleError) {
      console.error('attendance_inactivity_reschedule_failed', {
        cache_key: cacheKey,
        error:
          rescheduleError instanceof Error
            ? rescheduleError.message
            : String(rescheduleError),
      });
    }
  }

  private isSameFailedAttempt(
    current: TTrackedAttendanceInactivityData,
    failed: IAttendanceInactivityData | null
  ): boolean {
    if (!failed) {
      return true;
    }

    const failedTrackingId =
      typeof failed.tracking_id === 'string' ? failed.tracking_id.trim() : '';
    if (failedTrackingId && current.tracking_id !== failedTrackingId) {
      return false;
    }
    if (
      !failedTrackingId &&
      current.lastInteraction !== failed.lastInteraction
    ) {
      return false;
    }
    if (
      current.alertCount !== failed.alertCount ||
      current.lastInteraction !== failed.lastInteraction ||
      current.lastAlertTime !== failed.lastAlertTime
    ) {
      return false;
    }

    const failedRetryCount = Number.isFinite(failed.retry_count)
      ? Math.max(0, Math.floor(failed.retry_count ?? 0))
      : 0;
    return current.retry_count === failedRetryCount;
  }

  private async processScheduledInactivityCheck(
    t: TFunction<'translation', undefined>,
    inactivityCacheKey: string,
    baseData: IAttendanceInactivityData
  ): Promise<void> {
    await this.withInactivityChatLock(
      baseData.accountId,
      baseData.workerId,
      baseData.chatId,
      async () => {
        const scheduledScore = await this.redis.zscore(
          this.getInactivityScheduleKey(),
          inactivityCacheKey
        );
        if (scheduledScore === null || Number(scheduledScore) > Date.now()) {
          return;
        }

        const parsedData = this.parseInactivityData(
          await this.redis.get(inactivityCacheKey)
        );
        if (!parsedData) {
          throw new Error('attendance inactivity scheduled payload is missing');
        }

        const defaultStage =
          parsedData.alertCount > 0 ? 'waiting_close' : 'waiting_alert';
        const inactivityData = this.normalizeInactivityData(
          parsedData,
          defaultStage
        );
        const chat = await this.chatService.findChatByChatId(
          inactivityData.accountId,
          inactivityData.chatId
        );

        if (!chat) {
          await this.clearInactivityTrackingByIdsNoLock(
            inactivityData.accountId,
            inactivityData.workerId,
            inactivityData.chatId
          );
          return;
        }

        if (
          inactivityData.stage === 'finishing' ||
          inactivityData.stage === 'bootstrapping_output'
        ) {
          if (!this.isFinalizationStillApplicable(inactivityData, chat)) {
            await this.clearInactivityTrackingByIdsNoLock(
              inactivityData.accountId,
              inactivityData.workerId,
              inactivityData.chatId
            );
            return;
          }

          if (chat.status === EChatStatus.in_chat) {
            const finalizationConfig =
              await this.workerConfigService.viewAttendanceInactivityAlert(
                inactivityData.workerId
              );
            const finalizationDisabled =
              await this.isInactivityDisabledByIdsNoLock(
                inactivityData.accountId,
                inactivityData.workerId,
                inactivityData.chatId
              );
            if (!finalizationConfig.enabled || finalizationDisabled) {
              await this.clearInactivityTrackingByIdsNoLock(
                inactivityData.accountId,
                inactivityData.workerId,
                inactivityData.chatId
              );
              return;
            }

            const finalizationWindowMs =
              Math.max(1, Math.floor(finalizationConfig.time)) * 60 * 1000;
            if (
              await this.resetIfNewHumanMessageWasPersisted(
                chat,
                inactivityData,
                inactivityCacheKey,
                finalizationWindowMs
              )
            ) {
              return;
            }
          }

          const finishResult = await this.finishAttendanceByInactivity(
            t,
            chat,
            inactivityCacheKey,
            inactivityData
          );

          if (finishResult === 'completed' || finishResult === 'not_owned') {
            await this.clearInactivityTrackingByIdsNoLock(
              inactivityData.accountId,
              inactivityData.workerId,
              inactivityData.chatId
            );
            await this.clearInactivityDisabledOverrideByIdsNoLock(
              inactivityData.accountId,
              inactivityData.workerId,
              inactivityData.chatId
            );
          }
          return;
        }

        if (chat.status !== EChatStatus.in_chat) {
          await this.clearInactivityTrackingByIdsNoLock(
            inactivityData.accountId,
            inactivityData.workerId,
            inactivityData.chatId
          );
          await this.clearInactivityDisabledOverrideByIdsNoLock(
            inactivityData.accountId,
            inactivityData.workerId,
            inactivityData.chatId
          );
          return;
        }

        if (!this.isTrackedSessionCurrent(inactivityData, chat)) {
          await this.clearInactivityTrackingByIdsNoLock(
            inactivityData.accountId,
            inactivityData.workerId,
            inactivityData.chatId
          );
          return;
        }

        if (
          await this.isInactivityDisabledByIdsNoLock(
            inactivityData.accountId,
            inactivityData.workerId,
            inactivityData.chatId
          )
        ) {
          await this.clearInactivityTrackingByIdsNoLock(
            inactivityData.accountId,
            inactivityData.workerId,
            inactivityData.chatId
          );
          return;
        }

        const config =
          await this.workerConfigService.viewAttendanceInactivityAlert(
            inactivityData.workerId
          );

        if (!config.enabled) {
          await this.clearInactivityTrackingByIdsNoLock(
            inactivityData.accountId,
            inactivityData.workerId,
            inactivityData.chatId
          );
          return;
        }

        const now = Date.now();
        const alertCount = inactivityData.alertCount;
        const alertQuantity = Math.max(1, Math.floor(config.quantity));
        const inactivityWindowMs =
          Math.max(1, Math.floor(config.time)) * 60 * 1000;

        if (
          await this.resetIfNewHumanMessageWasPersisted(
            chat,
            inactivityData,
            inactivityCacheKey,
            inactivityWindowMs
          )
        ) {
          return;
        }

        if (alertCount >= alertQuantity) {
          const closeBaseTime =
            inactivityData.lastAlertTime ?? inactivityData.lastInteraction;
          const nextCloseCheckTime = closeBaseTime + inactivityWindowMs;

          if (now < nextCloseCheckTime) {
            await this.upsertInactivitySchedule(
              inactivityCacheKey,
              {
                ...inactivityData,
                retry_count: 0,
                stage: 'waiting_close',
              },
              nextCloseCheckTime
            );
            return;
          }

          const finishingData: TTrackedAttendanceInactivityData = {
            ...inactivityData,
            retry_count: 0,
            stage: 'finishing',
          };
          await this.upsertInactivitySchedule(
            inactivityCacheKey,
            finishingData,
            now
          );

          const finishResult = await this.finishAttendanceByInactivity(
            t,
            chat,
            inactivityCacheKey,
            finishingData
          );

          if (finishResult === 'completed' || finishResult === 'not_owned') {
            await this.clearInactivityTrackingByIdsNoLock(
              inactivityData.accountId,
              inactivityData.workerId,
              inactivityData.chatId
            );
            await this.clearInactivityDisabledOverrideByIdsNoLock(
              inactivityData.accountId,
              inactivityData.workerId,
              inactivityData.chatId
            );
          }
          return;
        }

        const nextAlertCheckTime =
          inactivityData.lastInteraction + inactivityWindowMs;
        if (now < nextAlertCheckTime) {
          await this.upsertInactivitySchedule(
            inactivityCacheKey,
            { ...inactivityData, retry_count: 0, stage: 'waiting_alert' },
            nextAlertCheckTime
          );
          return;
        }

        const isFirstAlert = alertCount === 0;
        if (isFirstAlert) {
          const canNotifyByLastMessage =
            inactivityData.lastHumanInteractor === 'operator'
              ? true
              : inactivityData.lastHumanInteractor === 'client'
                ? false
                : await this.isLastHumanMessageFromOperator(chat);
          if (!canNotifyByLastMessage) {
            await this.upsertInactivitySchedule(
              inactivityCacheKey,
              { ...inactivityData, retry_count: 0, stage: 'waiting_alert' },
              now + inactivityWindowMs
            );
            return;
          }
        }

        const newAlertCount = alertCount + 1;

        if (config.inactivity_message_enabled) {
          const message =
            config.inactivity_message ||
            t('attendance_inactivity_message_default');

          const alertMessageId = uuidv5(
            `attendance-inactivity:${inactivityData.tracking_id}:alert:${newAlertCount}`,
            uuidv5.URL
          );
          await this.sendInactivityMessage(t, chat, message, alertMessageId);
        }

        const alertSentAt = Date.now();

        const updatedData: TTrackedAttendanceInactivityData = {
          ...inactivityData,
          alertCount: newAlertCount,
          lastAlertTime: alertSentAt,
          retry_count: 0,
          stage:
            newAlertCount >= alertQuantity ? 'waiting_close' : 'waiting_alert',
        };

        await this.upsertInactivitySchedule(
          inactivityCacheKey,
          updatedData,
          alertSentAt + inactivityWindowMs
        );
      }
    );
  }

  async processScheduledInactivityChecks(
    t: TFunction<'translation', undefined>
  ): Promise<void> {
    try {
      await this.ensureScheduleReconciled();
    } catch (error) {
      console.error('attendance_inactivity_reconciliation_retry_scheduled', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const keysToCheck = await this.redis.zrangebyscore(
      this.getInactivityScheduleKey(),
      0,
      Date.now(),
      'LIMIT',
      0,
      100
    );

    for (const inactivityCacheKey of keysToCheck) {
      let baseData: IAttendanceInactivityData | null = null;

      try {
        baseData = this.parseInactivityData(
          await this.redis.get(inactivityCacheKey)
        );
        if (!baseData) {
          await this.recoverMissingScheduledPayload(inactivityCacheKey);
          continue;
        }

        await this.processScheduledInactivityCheck(
          t,
          inactivityCacheKey,
          baseData
        );
      } catch (error) {
        await this.rescheduleFailedCheck(inactivityCacheKey, baseData, error);
      }
    }
  }
}
