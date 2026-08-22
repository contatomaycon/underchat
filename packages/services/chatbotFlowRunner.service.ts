import { injectable, inject } from 'tsyringe';
import { createHash } from 'crypto';
import { v5 as uuidv5, v7 as uuidv7 } from 'uuid';
import Redis from 'ioredis';
import { ChatbotService } from './chatbot.service';
import { ChatService } from './chat.service';
import { ChatLifecycleService } from './chatLifecycle.service';
import { ChatMessageService } from './chatMessage.service';
import { ContactService } from './contact.service';
import { LabelTemplateViewerRepository } from '@core/repositories/labelTemplate/LabelTemplateViewer.repository';
import { CentrifugoService } from './centrifugo.service';
import { UserService } from './user.service';
import { SectorService } from './sector.service';
import { RagService } from './rag.service';
import { AiAgentService } from './aiAgent.service';
import { OpenAIAssistantService } from './openaiAssistant.service';
import { ElasticDatabaseService } from './elasticDatabase.service';
import { EAiAgentType } from '@core/common/enums/EAiAgentType';
import { IChat } from '@core/common/interfaces/IChat';
import {
  IChatMessage,
  IContactMessage,
} from '@core/common/interfaces/IChatMessage';
import { TFunction } from 'i18next';
import { ListChatbotFlowResponse } from '@core/schema/chatbot/listChatbotFlow/response.schema';
import { EMessageType } from '@core/common/enums/EMessageType';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import { IUpsertMessage } from '@core/common/interfaces/IUpsertMessage';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import {
  chatAccountCentrifugo,
  chatQueueAccountCentrifugo,
} from '@core/common/functions/centrifugoQueue';
import { IInactivityData } from '@core/common/interfaces/IInactivityData';
import { IProcessFlowNodeOptions } from '@core/common/interfaces/IProcessFlowNodeOptions';
import { generateProtocol } from '@core/common/functions/generateProtocol';
import { extractPhoneAndDdi } from '@core/common/functions/extractPhoneAndDdi';
import {
  createChatbotFlowCacheKey,
  createChatbotFlowContextCacheKey,
  createChatbotOfficialResponsePendingCacheKey,
  createChatbotInactivityCacheKey,
  createChatbotFailedAttemptsCacheKey,
  createAiResponseHistoryCacheKey,
} from '@core/common/functions/createCacheKey';
import { proto } from '@whiskeysockets/baileys';
import { EContactDocumentType } from '@core/common/enums/EContactDocumentType';
import { UpdateContactRequest } from '@core/schema/contact/editContact/request.schema';
import InvalidConfigurationError from '@core/common/exceptions/InvalidConfigurationError';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { normalizeTextForConditionalComparison } from '@core/common/functions/normalizeTextForConditionalComparison';
import { truncateContactName } from '@core/common/functions/truncateContactName';
import { StreamProducerService } from './streamProducer.service';
import { KafkaServiceQueueService } from './kafkaServiceQueue.service';
import { IChatHistoryEmbeddingRequest } from '@core/common/interfaces/IChatHistoryEmbeddingRequest';
import { EContactIgnore } from '@core/common/enums/EContactIgnore';
import { IAiAgentUsageCreateInput } from '@core/common/interfaces/IAiAgentUsageCreateInput';
import { AiAgentUsageCreatorRepository } from '@core/repositories/aiAgent/AiAgentUsageCreator.repository';
import { VoiceIaIntegrationService } from './voiceIaIntegration.service';
import { VoiceIaService } from './voiceIa.service';
import { EVoiceIaStatus } from '@core/common/enums/EVoiceIaStatus';
import { EAiAgentVoiceInputMode } from '@core/common/enums/EAiAgentVoiceInputMode';
import { EAiAgentVoiceOutputMode } from '@core/common/enums/EAiAgentVoiceOutputMode';
import { stripTextForTts } from '@core/common/functions/stripTextForTts';
import { ViewAiAgentResponse } from '@core/schema/aiAgent/viewAiAgent/response.schema';
import { IChatbotCustomMessages } from '@core/common/interfaces/IChatbotCustomMessages';
import { getContextTokensForModel } from '@core/common/functions/getContextTokensForModel';
import { EChatUserStatus } from '@core/common/enums/EChatUserStatus';
import { WorkerConfigViewerRepository } from '@core/repositories/worker/WorkerConfigViewer.repository';
import { WorkerService } from './worker.service';
import { SendMessageOptions } from '@core/common/interfaces/ISendMessageOptions';
import { IOfficialWhatsappTemplateMessage } from '@core/common/interfaces/IOfficialWhatsappTemplate';
import { IOfficialWhatsappOutboundInteractiveMessage } from '@core/common/interfaces/IOfficialWhatsappOutboundMessage';
import { TSecurityKeyScope } from '@core/common/interfaces/ISecurityKeyConfig';
import {
  classifyChatbotTriggerEvent,
  isChatbotTriggerEventEnabled,
} from '@core/common/functions/chatbotTriggerEvents';
import {
  HumanTransferMode,
  IPromptTransferDecision,
  ITransferSectorOption,
  ITransferUserOption,
} from '@core/common/interfaces/IChatbotHumanTransfer';
import { RandomMessageService } from './randomMessage.service';
import { ERandomMessageStatus } from '@core/common/enums/ERandomMessageStatus';
import { PromptDocumentExtractorService } from './promptDocumentExtractor.service';
import { EAiAgentStatus } from '@core/common/enums/EAiAgentStatus';
import {
  CHATBOT_WORKING_HOURS_DEFAULT_TIMEZONE,
  normalizeChatbotWorkingHoursTimezone,
  toChatbotWorkingHoursMinutes,
} from '@core/common/functions/chatbotWorkingHours';
import { HolidayService } from './holiday.service';
import {
  isOfficialChatbotNodeType,
  isOfficialWaitForResponseNodeType,
} from '@core/common/functions/chatbotOfficialNodes';
import { buildOfficialWhatsappDisplayFromTemplate } from '@core/common/functions/officialWhatsappDisplay';
import { withLock } from '@core/common/functions/withLock';
import { CHATBOT_STATUSES } from '@core/common/functions/chatStatus';
import { hasProtocolTag } from '@core/common/functions/hasProtocolTag';
import { replaceMessageTags } from '@core/common/functions/replaceMessageTags';
import {
  ChatbotFlowRuntimeContextService,
  type ChatbotApiResponseMetadata,
  type ChatbotNodeRuntimeCapture,
  type ChatbotFlowRuntimeContext,
} from './chatbotFlowRuntimeContext.service';
import {
  normalizeCnpj,
  validateCnpj,
} from '@core/common/functions/validateCnpj';
import { resolveChatbotTemplate } from '@core/common/functions/chatbotApiVariables';
import { normalizeOfficialTemplateVariableValue } from '@core/common/functions/normalizeOfficialTemplateVariableValue';
import { OfficialWhatsappTemplateService } from './officialWhatsappTemplate.service';
import { ChatbotApiRequestExecutorService } from './chatbotApiRequestExecutor.service';
import { PasswordEncryptorService } from './passwordEncryptor.service';
import type {
  ApiRequestConfig,
  UnderchatLookupConfig,
} from '@core/schema/chatbot/chatbotFlow.schema';
import { ChatbotMediaMaterializerService } from './chatbotMediaMaterializer.service';
import { ChatbotUnderchatUserLookupService } from './chatbotUnderchatUserLookup.service';
import { decryptApiRequestSecrets } from '@core/common/functions/chatbotApiRequestSecurity';
import { executeSafeOutboundHttp } from '@core/common/functions/safeOutboundHttp';
import { getChatbotApiOutboundHttpPolicy } from '@core/common/functions/chatbotApiOutboundHttpPolicy';
import {
  getKafkaDispatchGuard,
  runWithoutKafkaDispatchGuard,
  runWithKafkaDispatchGuard,
  type KafkaDispatchGuard,
} from '@core/common/functions/kafkaDispatchFenceContext';
import { assertOfficialWhatsappInteractivePayload } from '@core/common/functions/officialWhatsappInteractiveValidation';
import { isOfficialWhatsappWorker } from '@core/common/functions/workerOfficialCapabilities';
import { AiProviderError, aiProviderClient } from './aiProviderClient.service';
import { ChatbotTransferService } from './chatbotTransfer.service';
import { OfficialWhatsappConversationWindowService } from './officialWhatsappConversationWindow.service';

interface IChatbotPendingFinishEffect {
  accountId: string;
  workerId: string;
  chatId: string;
  source: 'chatbot' | 'outside_hours';
  phase: 'transition_pending' | 'effects_pending';
  statusEventId?: string;
  expectedStatus?: EChatStatus;
  expectedStatusEventId?: string;
  expectedStatusEpoch?: number;
  expectedStartedAt?: string | null;
  expectedLastMessageId?: string | null;
  customMessage?: string;
  messageEnabled: boolean;
  retryCount: number;
}

interface IChatbotInactivityRedirectEffect {
  accountId: string;
  chatId: string;
  sourceWorkerId: string;
  sourceChatbotId: string;
  targetWorkerId: string;
  targetChatbotId: string;
  operationId: string;
  eventEpochMillis: number;
  phase: 'transition_pending' | 'bootstrap_pending';
  expectedStatus: EChatStatus;
  expectedStatusEventId?: string | null;
  expectedStatusEpoch?: number | null;
  expectedAssignmentEventId?: string | null;
  expectedAssignmentEpoch?: number | null;
  expectedLastMessageId?: string | null;
  expectedSummaryRevision?: number | null;
  postTransitionLastMessageId?: string | null;
  retryCount: number;
}

interface IChatbotOfficialResponsePending {
  templateNodeId: string;
  nextFlowId: string;
}

interface IAiAgentDebouncePayload {
  expiresAt: number;
  messages: string[];
  flowId: string;
  chatbotId: string;
  selectedAiAgentId: string;
  lastMessageType?: EMessageType;
  customMessages?: IChatbotCustomMessages;
  trackingId: string;
  retryCount: number;
}

type TOutsideHoursFinishOutcome = 'completed' | 'queued' | 'not_owned';

interface IChatbotFlowExecutionOptions {
  requireHandled?: boolean;
  executionId?: string;
  assertActive?: KafkaDispatchGuard;
  expectedAssignmentEventId?: string;
  expectedLastMessageId?: string | null;
}

@injectable()
export class ChatbotFlowRunnerService {
  private readonly MENU_DEBOUNCE_SECONDS = 3;
  private readonly AI_AGENT_DEBOUNCE_SECONDS = 3;
  private readonly CHATBOT_FLOW_NODE_CACHE_TTL_SECONDS = 259200;
  private readonly RAG_CACHE_TTL_SECONDS = 600;
  private readonly RUNTIME_PROMPT_CACHE_TTL_SECONDS = 300;
  private readonly RUNTIME_PROMPT_MAX_CHARS = 120000;
  private readonly CONVERSATION_SUMMARY_UPDATE_INTERVAL = 5;
  private readonly AI_AGENT_API_RETRY_ATTEMPTS = 3;
  private readonly AI_AGENT_API_RETRY_BASE_DELAY_MS = 500;
  private readonly AI_AGENT_DEBOUNCE_PAYLOAD_TTL_SECONDS = 604800;
  private readonly AI_AGENT_DEBOUNCE_MAX_RETRIES = 5;
  private readonly AI_AGENT_DEBOUNCE_RETRY_BASE_DELAY_MS = 5000;
  private readonly AI_AGENT_DEBOUNCE_RETRY_MAX_DELAY_MS = 300000;
  private readonly RANDOM_MESSAGE_CYCLE_TTL_SECONDS = 28800;
  private readonly INACTIVITY_RETRY_BASE_DELAY_MS = 30000;
  private readonly INACTIVITY_RETRY_MAX_DELAY_MS = 300000;
  private hasReconciledInactivitySchedule = false;
  private readonly WEEKDAY_OPTION_IDS = new Set([
    'sunday',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
  ]);
  private readonly HOURS_OUTSIDE_OPTION_ID = 'outside-hours';
  private readonly HOLIDAY_IS_OPTION_ID = 'is-holiday';
  private readonly HOLIDAY_NOT_OPTION_ID = 'not-holiday';
  private readonly HUMAN_TEMPLATE_FIELDS = new Set([
    'message',
    'text',
    'firstName',
    'lastName',
    'email',
    'cpf',
    'cnpj',
    'holidayMessage',
    'annotation',
    'attachmentFileName',
    'attachmentMimetype',
  ]);
  private readonly AUTOMATION_CHAT_STATUSES: ReadonlySet<EChatStatus> =
    new Set<EChatStatus>(CHATBOT_STATUSES);
  private readonly securityKeyScopesByChatId = new Map<
    string,
    TSecurityKeyScope[]
  >();
  private readonly synchronousEffectsByChatId = new Set<string>();
  private readonly executionMessageContextByChatId = new Map<
    string,
    { executionId: string; nextMessageIndex: number }
  >();
  private readonly automaticExecutionBudgetByChatId = new Map<
    string,
    { transitions: number; apiNodes: number; httpAttempts: number }
  >();
  private readonly apiRequestSecretEncryptor = new PasswordEncryptorService();
  private readonly apiRequestExecutor = new ChatbotApiRequestExecutorService({
    secretDecryptor: this.apiRequestSecretEncryptor,
  });
  private readonly officialWhatsappTemplateService =
    new OfficialWhatsappTemplateService();

  constructor(
    @inject('Redis') private readonly redis: Redis,
    @inject(ChatbotService)
    private readonly chatbotService: ChatbotService,
    @inject(ChatService)
    private readonly chatService: ChatService,
    @inject(ChatLifecycleService)
    private readonly chatLifecycleService: ChatLifecycleService,
    @inject(ChatMessageService)
    private readonly chatMessageService: ChatMessageService,
    @inject(ContactService)
    private readonly contactService: ContactService,
    @inject(LabelTemplateViewerRepository)
    private readonly labelTemplateViewerRepository: LabelTemplateViewerRepository,
    @inject(CentrifugoService)
    private readonly centrifugoService: CentrifugoService,
    @inject(UserService)
    private readonly userService: UserService,
    @inject(SectorService)
    private readonly sectorService: SectorService,
    @inject(RagService)
    private readonly ragService: RagService,
    @inject(AiAgentService)
    private readonly aiAgentService: AiAgentService,
    @inject(RandomMessageService)
    private readonly randomMessageService: RandomMessageService,
    @inject(OpenAIAssistantService)
    private readonly openAIAssistantService: OpenAIAssistantService,
    @inject(ElasticDatabaseService)
    private readonly elasticDatabaseService: ElasticDatabaseService,
    @inject(StreamProducerService)
    private readonly streamProducerService: StreamProducerService,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    @inject(AiAgentUsageCreatorRepository)
    private readonly aiAgentUsageCreatorRepository: AiAgentUsageCreatorRepository,
    @inject(VoiceIaIntegrationService)
    private readonly voiceIaIntegrationService: VoiceIaIntegrationService,
    @inject(VoiceIaService)
    private readonly voiceIaService: VoiceIaService,
    @inject(WorkerConfigViewerRepository)
    private readonly workerConfigViewerRepository: WorkerConfigViewerRepository,
    @inject(WorkerService)
    private readonly workerService: WorkerService,
    @inject(PromptDocumentExtractorService)
    private readonly promptDocumentExtractorService: PromptDocumentExtractorService,
    @inject(HolidayService)
    private readonly holidayService: HolidayService,
    @inject(ChatbotFlowRuntimeContextService)
    private readonly flowRuntimeContextService?: ChatbotFlowRuntimeContextService,
    @inject(ChatbotMediaMaterializerService)
    private readonly chatbotMediaMaterializerService?: ChatbotMediaMaterializerService,
    @inject(ChatbotUnderchatUserLookupService)
    private readonly underchatUserLookupService?: ChatbotUnderchatUserLookupService,
    @inject(ChatbotTransferService)
    private readonly chatbotTransferService?: ChatbotTransferService,
    @inject(OfficialWhatsappConversationWindowService)
    private readonly officialWhatsappConversationWindowService?: OfficialWhatsappConversationWindowService
  ) {}

  private getChatbotFlowCacheKey(
    accountId: string,
    workerId: string,
    chatId: string
  ): string {
    return createChatbotFlowCacheKey(accountId, workerId, chatId);
  }

  private getOfficialResponsePendingCacheKey(
    accountId: string,
    workerId: string,
    chatId: string
  ): string {
    return createChatbotOfficialResponsePendingCacheKey(
      accountId,
      workerId,
      chatId
    );
  }

  private getInactivityCacheKey(
    accountId: string,
    workerId: string,
    chatId: string
  ): string {
    return createChatbotInactivityCacheKey(accountId, workerId, chatId);
  }

  private getInactivityScheduleKey(): string {
    return 'underchat:chatbot-inactivity-schedule';
  }

  private isOfficialWhatsappChat(chat: IChat): boolean {
    return (
      chat.official_window?.is_official === true ||
      chat.worker?.is_official === true ||
      isOfficialWhatsappWorker(chat.worker?.type_id)
    );
  }

  private async shouldSuspendInactivityForOfficialChat(
    chat: IChat,
    options?: { ignoreFlowResponsePending?: boolean }
  ): Promise<boolean> {
    if (!this.isOfficialWhatsappChat(chat)) {
      return false;
    }

    if (options?.ignoreFlowResponsePending !== true) {
      const pendingCacheKey = this.getOfficialResponsePendingCacheKey(
        chat.account.id,
        chat.worker.id,
        chat.chat_id
      );
      if (await this.redis.get(pendingCacheKey)) {
        return true;
      }
    }

    if (!this.officialWhatsappConversationWindowService) {
      throw new Error('official WhatsApp conversation window is unavailable');
    }

    const officialWindow =
      await this.officialWhatsappConversationWindowService.resolveAuthoritativeForChat(
        chat
      );

    return officialWindow.can_send_freeform !== true;
  }

  private getPendingFinishEffectKey(
    accountId: string,
    workerId: string,
    chatId: string
  ): string {
    return `underchat:chatbot-finish:${accountId}:${workerId}:${chatId}`;
  }

  private getPendingFinishScheduleKey(): string {
    return 'underchat:chatbot-finish-schedule';
  }

  private getInactivityRedirectEffectKey(
    accountId: string,
    chatId: string
  ): string {
    return `underchat:chatbot-inactivity-redirect:${accountId}:${chatId}`;
  }

  private getInactivityRedirectScheduleKey(): string {
    return 'underchat:chatbot-inactivity-redirect-schedule';
  }

  private parseInactivityRedirectEffectKey(cacheKey: string): {
    accountId: string;
    chatId: string;
  } | null {
    const [namespace, kind, accountId, chatId, ...extra] = cacheKey.split(':');
    if (
      namespace !== 'underchat' ||
      kind !== 'chatbot-inactivity-redirect' ||
      !accountId ||
      !chatId ||
      extra.length > 0
    ) {
      return null;
    }
    return { accountId, chatId };
  }

  private parsePendingFinishEffectKey(cacheKey: string): {
    accountId: string;
    workerId: string;
    chatId: string;
  } | null {
    const [namespace, kind, accountId, workerId, chatId, ...extra] =
      cacheKey.split(':');
    if (
      namespace !== 'underchat' ||
      kind !== 'chatbot-finish' ||
      !accountId ||
      !workerId ||
      !chatId ||
      extra.length > 0
    ) {
      return null;
    }

    return { accountId, workerId, chatId };
  }

  private assertRedisTransaction(
    results: Array<[Error | null, unknown]> | null,
    operation: string
  ): void {
    if (!results) {
      throw new Error(`${operation} transaction was aborted`);
    }

    const failedResult = results.find(([error]) => error !== null);
    if (failedResult?.[0]) {
      throw failedResult[0];
    }
  }

  private async persistInactivitySchedule(
    inactivityCacheKey: string,
    inactivityData: IInactivityData,
    nextCheckTime: number
  ): Promise<void> {
    const results = await this.redis
      .multi()
      .set(inactivityCacheKey, JSON.stringify(inactivityData))
      .zadd(this.getInactivityScheduleKey(), nextCheckTime, inactivityCacheKey)
      .exec();

    this.assertRedisTransaction(results, 'persist chatbot inactivity');
  }

  private async removeInactivitySchedule(
    inactivityCacheKey: string
  ): Promise<void> {
    const results = await this.redis
      .multi()
      .del(inactivityCacheKey)
      .zrem(this.getInactivityScheduleKey(), inactivityCacheKey)
      .exec();

    this.assertRedisTransaction(results, 'remove chatbot inactivity');
  }

  private async persistPendingFinishEffect(
    effect: IChatbotPendingFinishEffect,
    nextAttemptAt = Date.now()
  ): Promise<void> {
    const cacheKey = this.getPendingFinishEffectKey(
      effect.accountId,
      effect.workerId,
      effect.chatId
    );
    const results = await this.redis
      .multi()
      .set(cacheKey, JSON.stringify(effect))
      .zadd(this.getPendingFinishScheduleKey(), nextAttemptAt, cacheKey)
      .exec();

    this.assertRedisTransaction(results, 'persist chatbot finish effect');
  }

  private async persistInactivityRedirectEffect(
    effect: IChatbotInactivityRedirectEffect,
    nextAttemptAt = Date.now()
  ): Promise<void> {
    const cacheKey = this.getInactivityRedirectEffectKey(
      effect.accountId,
      effect.chatId
    );
    const results = await this.redis
      .multi()
      .set(cacheKey, JSON.stringify(effect))
      .zadd(this.getInactivityRedirectScheduleKey(), nextAttemptAt, cacheKey)
      .exec();
    this.assertRedisTransaction(results, 'persist chatbot redirect effect');
  }

  private async removeInactivityRedirectEffectByCacheKey(
    cacheKey: string
  ): Promise<void> {
    const results = await this.redis
      .multi()
      .del(cacheKey)
      .zrem(this.getInactivityRedirectScheduleKey(), cacheKey)
      .exec();
    this.assertRedisTransaction(results, 'remove chatbot redirect effect');
  }

  private async removePendingFinishEffect(
    accountId: string,
    workerId: string,
    chatId: string
  ): Promise<void> {
    const cacheKey = this.getPendingFinishEffectKey(
      accountId,
      workerId,
      chatId
    );

    await this.removePendingFinishEffectByCacheKey(cacheKey);
  }

  private async removePendingFinishEffectByCacheKey(
    cacheKey: string
  ): Promise<void> {
    const results = await this.redis
      .multi()
      .del(cacheKey)
      .zrem(this.getPendingFinishScheduleKey(), cacheKey)
      .exec();

    this.assertRedisTransaction(results, 'remove chatbot finish effect');
  }

  private getInactivityRetryDelayMs(retryCount: number): number {
    return Math.min(
      this.INACTIVITY_RETRY_BASE_DELAY_MS * 2 ** Math.max(0, retryCount - 1),
      this.INACTIVITY_RETRY_MAX_DELAY_MS
    );
  }

  private async requeueInactivityAfterFailure(
    inactivityCacheKey: string,
    failedData: IInactivityData
  ): Promise<IInactivityData | null> {
    const ids = this.parseInactivityCacheKey(inactivityCacheKey);
    if (!ids) {
      return null;
    }

    return withLock(
      this.redis,
      this.getAutomationLockKey(ids.accountId, ids.chatId),
      async () => {
        const [currentPayload, currentScore] = await Promise.all([
          this.redis.get(inactivityCacheKey),
          this.redis.zscore(
            this.getInactivityScheduleKey(),
            inactivityCacheKey
          ),
        ]);
        if (!currentPayload || currentScore === null) {
          return null;
        }

        const currentData = JSON.parse(currentPayload) as IInactivityData;
        if (!this.isSameInactivityAttempt(currentData, failedData)) {
          return null;
        }

        const retryCount = (currentData.retryCount ?? 0) + 1;
        const updatedData: IInactivityData = {
          ...currentData,
          retryCount,
        };

        await this.persistInactivitySchedule(
          inactivityCacheKey,
          updatedData,
          Date.now() + this.getInactivityRetryDelayMs(retryCount)
        );

        return updatedData;
      },
      {
        ttlMs: 30000,
        retryMs: 100,
        maxWaitMs: 45000,
      }
    );
  }

  private isSameInactivityAttempt(
    current: IInactivityData,
    expected: IInactivityData
  ): boolean {
    return (
      current.trackingId === expected.trackingId &&
      (current.retryCount ?? 0) === (expected.retryCount ?? 0) &&
      current.stage === expected.stage &&
      current.alertCount === expected.alertCount &&
      current.lastInteraction === expected.lastInteraction &&
      current.lastAlertTime === expected.lastAlertTime
    );
  }

  private async removeInactivityScheduleIfUnchanged(
    inactivityCacheKey: string,
    expectedData: IInactivityData | null
  ): Promise<void> {
    const ids = this.parseInactivityCacheKey(inactivityCacheKey);
    if (!ids) {
      await this.removeInactivitySchedule(inactivityCacheKey);
      return;
    }

    await withLock(
      this.redis,
      this.getAutomationLockKey(ids.accountId, ids.chatId),
      async () => {
        const [currentPayload, currentScore] = await Promise.all([
          this.redis.get(inactivityCacheKey),
          this.redis.zscore(
            this.getInactivityScheduleKey(),
            inactivityCacheKey
          ),
        ]);
        if (currentScore === null) {
          return;
        }

        if (!currentPayload) {
          await this.removeInactivitySchedule(inactivityCacheKey);
          return;
        }

        let currentData: IInactivityData;
        try {
          currentData = JSON.parse(currentPayload) as IInactivityData;
        } catch {
          if (!expectedData) {
            await this.removeInactivitySchedule(inactivityCacheKey);
          }
          return;
        }

        if (
          expectedData &&
          this.isSameInactivityAttempt(currentData, expectedData)
        ) {
          await this.removeInactivitySchedule(inactivityCacheKey);
        }
      },
      {
        ttlMs: 30000,
        retryMs: 100,
        maxWaitMs: 45000,
      }
    );
  }

  private parseInactivityCacheKey(cacheKey: string): {
    accountId: string;
    workerId: string;
    chatId: string;
  } | null {
    const [namespace, kind, accountId, workerId, chatId, ...extra] =
      cacheKey.split(':');

    if (
      namespace !== 'underchat' ||
      kind !== 'chatbot-inactivity' ||
      !accountId ||
      !workerId ||
      !chatId ||
      extra.length > 0
    ) {
      return null;
    }

    return { accountId, workerId, chatId };
  }

  private async recoverMissingInactivityPayload(
    inactivityCacheKey: string
  ): Promise<boolean> {
    const ids = this.parseInactivityCacheKey(inactivityCacheKey);
    if (!ids) {
      await this.removeInactivitySchedule(inactivityCacheKey);
      return false;
    }

    return withLock(
      this.redis,
      this.getAutomationLockKey(ids.accountId, ids.chatId),
      async () => {
        const recovered = await this.recoverMissingInactivityPayloadWithLock(
          inactivityCacheKey,
          ids
        );
        if (!recovered) {
          await this.removeInactivitySchedule(inactivityCacheKey);
        }
        return recovered;
      },
      {
        ttlMs: 30000,
        retryMs: 100,
        maxWaitMs: 45000,
      }
    );
  }

  private async recoverMissingInactivityPayloadWithLock(
    inactivityCacheKey: string,
    ids: { accountId: string; workerId: string; chatId: string }
  ): Promise<boolean> {
    if (await this.redis.get(inactivityCacheKey)) {
      return true;
    }

    const chat = await this.chatService.findChatByChatId(
      ids.accountId,
      ids.chatId
    );
    if (!chat || !this.isAutomationChatStatus(chat.status)) {
      return false;
    }

    if (await this.shouldSuspendInactivityForOfficialChat(chat)) {
      return false;
    }

    const chatbotConfig =
      await this.workerConfigViewerRepository.fetchChatbotsValue(ids.workerId);
    const chatbotId =
      chat.status === EChatStatus.ura_output
        ? chatbotConfig.outputChatbotId
        : chat.status === EChatStatus.ura_schedule
          ? chat.chatbot_schedule_id
          : chat.status === EChatStatus.ura_webhook
            ? chat.chatbot_webhook_id
            : chat.chatbot_transfer_id || chatbotConfig.inputChatbotId;
    if (!chatbotId) {
      return false;
    }

    const configurations =
      await this.chatbotService.findChatbotFlowConfigurationsByChatbotId(
        ids.accountId,
        chatbotId
      );
    const inactivityAlert = configurations?.configurations?.inactivity_alert;
    if (inactivityAlert?.status !== 'active') {
      return false;
    }

    const timeMinutes = Math.max(1, Math.floor(inactivityAlert.time ?? 5));
    const now = Date.now();
    await this.persistInactivitySchedule(
      inactivityCacheKey,
      {
        lastInteraction: now,
        alertCount: 0,
        lastAlertTime: null,
        chatbotId,
        accountId: ids.accountId,
        workerId: ids.workerId,
        chatId: ids.chatId,
        trackingId: uuidv7(),
        retryCount: 0,
        stage: 'waiting',
      },
      now + timeMinutes * 60 * 1000
    );

    console.info('[ChatbotFlow] recovered orphaned inactivity schedule', {
      account_id: ids.accountId,
      worker_id: ids.workerId,
      chat_id: ids.chatId,
      chatbot_id: chatbotId,
    });
    return true;
  }

  private async reconcileInactivitySchedule(): Promise<void> {
    if (this.hasReconciledInactivitySchedule) {
      return;
    }

    const scheduleKey = this.getInactivityScheduleKey();
    let cursor = '0';

    do {
      const [nextCursor, entries] = await this.redis.zscan(
        scheduleKey,
        cursor,
        'COUNT',
        200
      );
      cursor = nextCursor;
      const cacheKeys = entries.filter((_, index) => index % 2 === 0);

      if (cacheKeys.length === 0) {
        continue;
      }

      const pipeline = this.redis.pipeline();
      for (const cacheKey of cacheKeys) {
        pipeline.exists(cacheKey);
        pipeline.persist(cacheKey);
      }
      const results = await pipeline.exec();
      const orphanedKeys: string[] = [];

      for (let index = 0; index < cacheKeys.length; index += 1) {
        const existsResult = results?.[index * 2];
        if (existsResult?.[0]) {
          throw existsResult[0];
        }
        if (Number(existsResult?.[1] ?? 0) === 0) {
          orphanedKeys.push(cacheKeys[index]);
        }
      }

      if (orphanedKeys.length > 0) {
        const unrecoverableKeys: string[] = [];
        for (const orphanedKey of orphanedKeys) {
          if (!(await this.recoverMissingInactivityPayload(orphanedKey))) {
            unrecoverableKeys.push(orphanedKey);
          }
        }

        if (unrecoverableKeys.length > 0) {
          console.warn('[ChatbotFlow] removed orphaned inactivity schedules', {
            count: unrecoverableKeys.length,
          });
        }
      }
    } while (cursor !== '0');

    await this.reconcileUnscheduledInactivityPayloads();

    this.hasReconciledInactivitySchedule = true;
  }

  private async reconcileUnscheduledInactivityPayload(
    cacheKey: string
  ): Promise<void> {
    const ids = this.parseInactivityCacheKey(cacheKey);
    if (!ids) {
      await this.removeInactivitySchedule(cacheKey);
      return;
    }

    await withLock(
      this.redis,
      this.getAutomationLockKey(ids.accountId, ids.chatId),
      async () => {
        const existingScore = await this.redis.zscore(
          this.getInactivityScheduleKey(),
          cacheKey
        );
        if (existingScore !== null) {
          await this.redis.persist(cacheKey);
          return;
        }

        const payload = await this.redis.get(cacheKey);
        if (!payload) {
          return;
        }

        let data: IInactivityData;
        try {
          data = JSON.parse(payload) as IInactivityData;
        } catch (error) {
          await this.removeInactivitySchedule(cacheKey);
          console.error('[ChatbotFlow] invalid inactivity payload removed', {
            inactivity_cache_key: cacheKey,
            error: error instanceof Error ? error.message : String(error),
          });
          return;
        }

        if (
          data.accountId !== ids.accountId ||
          data.workerId !== ids.workerId ||
          data.chatId !== ids.chatId ||
          !data.chatbotId
        ) {
          await this.removeInactivitySchedule(cacheKey);
          return;
        }

        const [chat, configurations] = await Promise.all([
          this.chatService.findChatByChatId(data.accountId, data.chatId),
          this.chatbotService.findChatbotFlowConfigurationsByChatbotId(
            data.accountId,
            data.chatbotId
          ),
        ]);
        const inactivityAlert =
          configurations?.configurations?.inactivity_alert;
        if (
          !chat ||
          !this.isAutomationChatStatus(chat.status) ||
          inactivityAlert?.status !== 'active'
        ) {
          await this.removeInactivitySchedule(cacheKey);
          return;
        }

        if (await this.shouldSuspendInactivityForOfficialChat(chat)) {
          await this.removeInactivitySchedule(cacheKey);
          return;
        }

        const now = Date.now();
        const timeMinutes = Math.max(1, Math.floor(inactivityAlert.time ?? 5));
        await this.persistInactivitySchedule(
          cacheKey,
          {
            ...data,
            lastInteraction: now,
            alertCount: 0,
            lastAlertTime: null,
            trackingId: uuidv7(),
            retryCount: 0,
            stage: 'waiting',
          },
          now + timeMinutes * 60 * 1000
        );
      },
      {
        ttlMs: 30000,
        retryMs: 100,
        maxWaitMs: 45000,
      }
    );
  }

  private async reconcileUnscheduledInactivityPayloads(): Promise<void> {
    let cursor = '0';
    let failures = 0;

    do {
      const [nextCursor, cacheKeys] = await this.redis.scan(
        cursor,
        'MATCH',
        'underchat:chatbot-inactivity:*',
        'COUNT',
        200
      );
      cursor = nextCursor;

      for (const cacheKey of cacheKeys) {
        try {
          await this.reconcileUnscheduledInactivityPayload(cacheKey);
        } catch (error) {
          failures += 1;
          console.error(
            '[ChatbotFlow] inactivity payload reconciliation failed',
            {
              inactivity_cache_key: cacheKey,
              error: error instanceof Error ? error.message : String(error),
            }
          );
        }
      }
    } while (cursor !== '0');

    if (failures > 0) {
      throw new Error(
        `chatbot inactivity reconciliation failed for ${failures} item(s)`
      );
    }
  }

  private getFailedAttemptsCacheKey(
    accountId: string,
    workerId: string,
    chatId: string
  ): string {
    return createChatbotFailedAttemptsCacheKey(accountId, workerId, chatId);
  }

  private getMenuDebounceCacheKey(
    accountId: string,
    workerId: string,
    chatId: string
  ): string {
    return `underchat:menu-debounce:${accountId}:${workerId}:${chatId}`;
  }

  private getAiAgentDebounceCacheKey(
    accountId: string,
    workerId: string,
    chatId: string
  ): string {
    return `chatbot:ai-agent:debounce:${accountId}:${workerId}:${chatId}`;
  }

  private getAiAgentDebounceScheduleKey(): string {
    return 'underchat:chatbot-ai-agent-debounce-schedule';
  }

  private getAiAgentDebounceDeadLetterKey(): string {
    return 'underchat:chatbot-ai-agent-debounce-dead-letter';
  }

  private parseAiAgentDebounceCacheKey(cacheKey: string): {
    accountId: string;
    workerId: string;
    chatId: string;
  } | null {
    const [namespace, kind, subtype, accountId, workerId, chatId, ...extra] =
      cacheKey.split(':');

    if (
      namespace !== 'chatbot' ||
      kind !== 'ai-agent' ||
      subtype !== 'debounce' ||
      !accountId ||
      !workerId ||
      !chatId ||
      extra.length > 0
    ) {
      return null;
    }

    return { accountId, workerId, chatId };
  }

  private getSectorSelectionCacheKey(
    accountId: string,
    workerId: string,
    chatId: string
  ): string {
    return `chatbot:ai-agent:sector-selection:${accountId}:${workerId}:${chatId}`;
  }

  private getUserSelectionCacheKey(
    accountId: string,
    workerId: string,
    chatId: string
  ): string {
    return `chatbot:ai-agent:user-selection:${accountId}:${workerId}:${chatId}`;
  }

  private getAutomationLockKey(accountId: string, chatId: string): string {
    return `chatbot-flow:${accountId}:${chatId}`;
  }

  private async withAutomationLock<T>(
    createChat: IChat,
    fn: () => Promise<T>
  ): Promise<T> {
    return withLock(
      this.redis,
      this.getAutomationLockKey(createChat.account.id, createChat.chat_id),
      fn,
      {
        ttlMs: 30000,
        retryMs: 100,
        maxWaitMs: 45000,
      }
    );
  }

  private isAutomationChatStatus(
    status: IChat['status'] | null | undefined
  ): boolean {
    if (!status) {
      return false;
    }

    return this.AUTOMATION_CHAT_STATUSES.has(status);
  }

  private async loadCurrentChatState(createChat: IChat): Promise<IChat | null> {
    return this.chatService.findChatByChatId(
      createChat.account.id,
      createChat.chat_id
    );
  }

  private async clearChatbotRuntimeStateByIds(
    accountId: string,
    workerId: string,
    chatId: string
  ): Promise<void> {
    const flowCacheKey = this.getChatbotFlowCacheKey(
      accountId,
      workerId,
      chatId
    );
    const flowContextCacheKey = createChatbotFlowContextCacheKey(
      accountId,
      workerId,
      chatId
    );
    const officialResponsePendingCacheKey =
      this.getOfficialResponsePendingCacheKey(accountId, workerId, chatId);
    const inactivityCacheKey = this.getInactivityCacheKey(
      accountId,
      workerId,
      chatId
    );
    const failedAttemptsCacheKey = this.getFailedAttemptsCacheKey(
      accountId,
      workerId,
      chatId
    );
    const menuDebounceCacheKey = this.getMenuDebounceCacheKey(
      accountId,
      workerId,
      chatId
    );
    const aiAgentDebounceCacheKey = this.getAiAgentDebounceCacheKey(
      accountId,
      workerId,
      chatId
    );
    const sectorSelectionCacheKey = this.getSectorSelectionCacheKey(
      accountId,
      workerId,
      chatId
    );
    const userSelectionCacheKey = this.getUserSelectionCacheKey(
      accountId,
      workerId,
      chatId
    );
    const scheduleKey = this.getInactivityScheduleKey();
    const results = await this.redis
      .multi()
      .del(
        flowCacheKey,
        flowContextCacheKey,
        officialResponsePendingCacheKey,
        inactivityCacheKey,
        failedAttemptsCacheKey,
        menuDebounceCacheKey,
        aiAgentDebounceCacheKey,
        sectorSelectionCacheKey,
        userSelectionCacheKey
      )
      .zrem(scheduleKey, inactivityCacheKey)
      .zrem(this.getAiAgentDebounceScheduleKey(), aiAgentDebounceCacheKey)
      .zrem(this.getAiAgentDebounceDeadLetterKey(), aiAgentDebounceCacheKey)
      .exec();

    this.assertRedisTransaction(results, 'clear chatbot runtime');
  }

  private async getAutomationChatIfAllowed(
    createChat: IChat,
    options?: { allowClosedStatus?: boolean }
  ): Promise<IChat | null> {
    const currentChat = await this.loadCurrentChatState(createChat);

    if (!currentChat) {
      await this.clearChatbotRuntimeStateByIds(
        createChat.account.id,
        createChat.worker.id,
        createChat.chat_id
      );
      return null;
    }

    if (this.isAutomationChatStatus(currentChat.status)) {
      return currentChat;
    }

    if (
      options?.allowClosedStatus &&
      currentChat.status === EChatStatus.closed
    ) {
      return currentChat;
    }

    await this.clearChatbotRuntimeStateByIds(
      currentChat.account.id,
      currentChat.worker.id,
      currentChat.chat_id
    );
    return null;
  }

  private async canRunAutomation(createChat: IChat): Promise<boolean> {
    const currentChat = await this.getAutomationChatIfAllowed(createChat);
    return currentChat !== null;
  }

  private async sendMessageWithStatusGuard(
    t: TFunction<'translation', undefined>,
    options: SendMessageOptions,
    guardOptions?: {
      allowClosedStatus?: boolean;
      expectedStatusEventId?: string;
    }
  ): Promise<boolean> {
    const assertActive = options.assertActive ?? getKafkaDispatchGuard();
    await assertActive?.();
    const executionMessageId = this.consumeNextExecutionMessageId(
      options.chat.chat_id
    );
    const guardedChat = await this.getAutomationChatIfAllowed(options.chat, {
      allowClosedStatus: guardOptions?.allowClosedStatus,
    });
    await assertActive?.();

    if (!guardedChat) {
      return false;
    }

    if (
      guardOptions?.expectedStatusEventId &&
      guardedChat.meta?.status_event_id !== guardOptions.expectedStatusEventId
    ) {
      return false;
    }

    const messageSent = await this.chatMessageService.sendMessage(t, {
      ...options,
      chat: guardedChat,
      accountId: guardedChat.account.id,
      messageId: options.messageId ?? executionMessageId,
      securityKeyScopes:
        options.securityKeyScopes ??
        this.getSecurityKeyScopesForChat(guardedChat.chat_id),
      ...(assertActive ? { assertActive } : {}),
    });
    if (
      !messageSent &&
      this.synchronousEffectsByChatId.has(guardedChat.chat_id)
    ) {
      throw new Error('chatbot bootstrap message was not confirmed');
    }

    return messageSent;
  }

  private async publishPreparedMessageWithAssignmentGuard(
    message: IChatMessage
  ): Promise<boolean> {
    const assertActive = getKafkaDispatchGuard();
    await assertActive?.();

    if (!assertActive) {
      return this.chatMessageService.publishPreparedMessage(message);
    }

    return this.chatMessageService.publishPreparedMessage(
      message,
      undefined,
      assertActive
    );
  }

  private async publishSubWithAssignmentGuard(
    channel: string,
    data: unknown
  ): Promise<unknown> {
    const assertActive = getKafkaDispatchGuard();
    await assertActive?.();

    if (!assertActive) {
      return this.centrifugoService.publishSub(channel, data);
    }

    return this.centrifugoService.publishSub(channel, data, assertActive);
  }

  private consumeNextExecutionMessageId(chatId: string): string | undefined {
    const executionContext = this.executionMessageContextByChatId.get(chatId);
    if (!executionContext) {
      return undefined;
    }

    const messageIndex = executionContext.nextMessageIndex++;
    return uuidv5(
      `chatbot-execution:${executionContext.executionId}:message:${messageIndex}`,
      uuidv5.URL
    );
  }

  private getOutboundWebhookMutationOccurrenceId(
    chatId: string,
    data?: IUpsertMessage
  ): string | null {
    const executionId =
      this.executionMessageContextByChatId.get(chatId)?.executionId;
    if (executionId) {
      return `execution:${executionId}`;
    }

    const providerMessageId = data?.message?.key?.id?.trim();
    if (providerMessageId) {
      return `message:${providerMessageId}`;
    }

    const providerTimestamp = Number(data?.message?.messageTimestamp);
    const remoteAddress =
      data?.message?.key?.remoteJid?.trim() ??
      data?.message?.key?.remoteJidAlt?.trim();
    if (!Number.isFinite(providerTimestamp) || !remoteAddress) {
      return null;
    }

    const legacyOccurrence = createHash('sha256')
      .update(
        [
          data?.source_provider ?? 'unknown',
          remoteAddress,
          String(providerTimestamp),
        ].join('\u001f')
      )
      .digest('hex');
    return `legacy:${legacyOccurrence}`;
  }

  private scopeOutboundWebhookMutationKey(
    baseKey: string,
    chatId: string,
    data?: IUpsertMessage
  ): string {
    const occurrenceId = this.getOutboundWebhookMutationOccurrenceId(
      chatId,
      data
    );
    return occurrenceId ? `${baseKey}:${occurrenceId}` : baseKey;
  }

  private buildSatisfactionWebhookIdempotencyKey(
    chatId: string,
    currentFlowId: string,
    selectedOptionId: string,
    data: IUpsertMessage
  ): string {
    return this.scopeOutboundWebhookMutationKey(
      `chat-satisfaction:${chatId}:${currentFlowId}:${selectedOptionId}`,
      chatId,
      data
    );
  }

  private getSecurityKeyScopesForChat(chatId: string): TSecurityKeyScope[] {
    return this.securityKeyScopesByChatId.get(chatId) ?? ['chatbot'];
  }

  private normalizeSecurityKeyScopes(
    scopes?: TSecurityKeyScope[]
  ): TSecurityKeyScope[] {
    return Array.from(
      new Set<TSecurityKeyScope>([...(scopes ?? []), 'chatbot'])
    );
  }

  private getRagCacheKey(
    accountId: string,
    chatId: string,
    aiAgentId: string,
    normalizedQuestion: string,
    promptsHash: string
  ): string {
    const questionHash = this.hashText(normalizedQuestion);
    return `chatbot:ai-agent:rag:${accountId}:${chatId}:${aiAgentId}:${questionHash}:${promptsHash}`;
  }

  private getRandomMessageCycleCacheKey(
    accountId: string,
    randomMessageId: string
  ): string {
    return `underchat:chatbot-random-message-cycle:${accountId}:${randomMessageId}`;
  }

  private shuffleArray<T>(items: T[]): T[] {
    const shuffled = [...items];

    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    return shuffled;
  }

  private async pickNonRepeatedRandomMessageItemId(
    accountId: string,
    randomMessageId: string,
    itemIds: string[]
  ): Promise<string | null> {
    if (!itemIds.length) {
      return null;
    }

    const cacheKey = this.getRandomMessageCycleCacheKey(
      accountId,
      randomMessageId
    );
    const shuffledItemIds = this.shuffleArray(itemIds);

    const selectionLuaScript = `
      local key = KEYS[1]
      local ttl = tonumber(ARGV[1])

      for i = 2, #ARGV do
        local candidate = ARGV[i]
        if redis.call('SISMEMBER', key, candidate) == 0 then
          redis.call('SADD', key, candidate)
          redis.call('EXPIRE', key, ttl)
          return candidate
        end
      end

      redis.call('DEL', key)

      if #ARGV >= 2 then
        local candidate = ARGV[2]
        redis.call('SADD', key, candidate)
        redis.call('EXPIRE', key, ttl)
        return candidate
      end

      return ''
    `;

    const selectedItemId = await this.redis.eval(
      selectionLuaScript,
      1,
      cacheKey,
      this.RANDOM_MESSAGE_CYCLE_TTL_SECONDS.toString(),
      ...shuffledItemIds
    );

    if (typeof selectedItemId !== 'string' || !selectedItemId) {
      return null;
    }

    return selectedItemId;
  }

  private resolveHumanTransferMode(
    aiAgent: ViewAiAgentResponse
  ): HumanTransferMode {
    if (aiAgent.enable_human_transfer_by_prompt === true) {
      return 'prompt';
    }
    if (aiAgent.enable_human_transfer === true) {
      return 'standard';
    }
    return 'disabled';
  }

  private buildUserSelectionMessage(
    users: Array<{
      id: string;
      name: string;
      last_name?: string | null;
      nickname?: string | null;
    }>
  ): string {
    const lines = users.map((user, index) => {
      const number = index + 1;
      const fullName = [user.name, user.last_name].filter(Boolean).join(' ');
      return `*${number}.* ${fullName || user.name}`;
    });
    return [
      'Para qual atendente você gostaria de ser direcionado?',
      '',
      ...lines,
    ].join('\n');
  }

  private async setMenuDebounce(
    createChat: IChat,
    nodeData: { message: string; options: { id: string; text: string }[] }
  ): Promise<void> {
    const key = this.getMenuDebounceCacheKey(
      createChat.account.id,
      createChat.worker.id,
      createChat.chat_id
    );

    const expiresAt = Date.now() + this.MENU_DEBOUNCE_SECONDS * 1000;

    await this.redis.set(
      key,
      JSON.stringify({ expiresAt, nodeData }),
      'EX',
      this.MENU_DEBOUNCE_SECONDS + 2 // TTL um pouco maior que o debounce
    );
  }

  private async getMenuDebounce(createChat: IChat): Promise<{
    expiresAt: number;
    nodeData: { message: string; options: { id: string; text: string }[] };
  } | null> {
    const key = this.getMenuDebounceCacheKey(
      createChat.account.id,
      createChat.worker.id,
      createChat.chat_id
    );

    const data = await this.redis.get(key);
    if (!data) return null;

    return JSON.parse(data);
  }

  private async deleteMenuDebounce(createChat: IChat): Promise<void> {
    const key = this.getMenuDebounceCacheKey(
      createChat.account.id,
      createChat.worker.id,
      createChat.chat_id
    );

    await this.redis.del(key);
  }

  private async setAiAgentDebounce(
    createChat: IChat,
    payload: IAiAgentDebouncePayload
  ): Promise<void> {
    const key = this.getAiAgentDebounceCacheKey(
      createChat.account.id,
      createChat.worker.id,
      createChat.chat_id
    );

    const results = await this.redis
      .multi()
      .set(
        key,
        JSON.stringify(payload),
        'EX',
        this.AI_AGENT_DEBOUNCE_PAYLOAD_TTL_SECONDS
      )
      .zadd(this.getAiAgentDebounceScheduleKey(), payload.expiresAt, key)
      .zrem(this.getAiAgentDebounceDeadLetterKey(), key)
      .exec();

    this.assertRedisTransaction(results, 'persist AI Agent debounce');
  }

  private async getAiAgentDebounce(
    createChat: IChat
  ): Promise<IAiAgentDebouncePayload | null> {
    const key = this.getAiAgentDebounceCacheKey(
      createChat.account.id,
      createChat.worker.id,
      createChat.chat_id
    );

    const data = await this.redis.get(key);
    if (!data) return null;

    return JSON.parse(data) as IAiAgentDebouncePayload;
  }

  private async deleteAiAgentDebounceByCacheKey(
    cacheKey: string
  ): Promise<void> {
    const results = await this.redis
      .multi()
      .del(cacheKey)
      .zrem(this.getAiAgentDebounceScheduleKey(), cacheKey)
      .zrem(this.getAiAgentDebounceDeadLetterKey(), cacheKey)
      .exec();

    this.assertRedisTransaction(results, 'remove AI Agent debounce');
  }

  private getAiAgentDebounceRetryDelayMs(retryCount: number): number {
    return Math.min(
      this.AI_AGENT_DEBOUNCE_RETRY_BASE_DELAY_MS *
        2 ** Math.max(0, retryCount - 1),
      this.AI_AGENT_DEBOUNCE_RETRY_MAX_DELAY_MS
    );
  }

  private async requeueAiAgentDebounceAfterFailure(
    cacheKey: string,
    failedPayload: IAiAgentDebouncePayload,
    error: unknown
  ): Promise<void> {
    const currentRaw = await this.redis.get(cacheKey);
    if (!currentRaw) {
      await this.redis.zrem(this.getAiAgentDebounceScheduleKey(), cacheKey);
      return;
    }

    let currentPayload: IAiAgentDebouncePayload;
    try {
      currentPayload = JSON.parse(currentRaw) as IAiAgentDebouncePayload;
    } catch {
      await this.deleteAiAgentDebounceByCacheKey(cacheKey);
      return;
    }

    if (currentPayload.trackingId !== failedPayload.trackingId) {
      return;
    }

    const retryCount = (currentPayload.retryCount ?? 0) + 1;
    const updatedPayload: IAiAgentDebouncePayload = {
      ...currentPayload,
      retryCount,
    };

    const transaction = this.redis
      .multi()
      .set(
        cacheKey,
        JSON.stringify(updatedPayload),
        'EX',
        this.AI_AGENT_DEBOUNCE_PAYLOAD_TTL_SECONDS
      );

    if (retryCount <= this.AI_AGENT_DEBOUNCE_MAX_RETRIES) {
      transaction.zadd(
        this.getAiAgentDebounceScheduleKey(),
        Date.now() + this.getAiAgentDebounceRetryDelayMs(retryCount),
        cacheKey
      );
    } else {
      transaction
        .zrem(this.getAiAgentDebounceScheduleKey(), cacheKey)
        .zadd(this.getAiAgentDebounceDeadLetterKey(), Date.now(), cacheKey);
    }

    const results = await transaction.exec();
    this.assertRedisTransaction(results, 'requeue AI Agent debounce');

    console.error('[ChatbotFlow] AI Agent debounce processing failed', {
      account_id: this.parseAiAgentDebounceCacheKey(cacheKey)?.accountId,
      chat_id: this.parseAiAgentDebounceCacheKey(cacheKey)?.chatId,
      ai_agent_id: currentPayload.selectedAiAgentId,
      retry_count: retryCount,
      dead_letter: retryCount > this.AI_AGENT_DEBOUNCE_MAX_RETRIES,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  private combineAiAgentDebouncedMessages(messages: string[]): string {
    const lines: string[] = [];
    for (const message of messages) {
      const trimmed = message.trim();
      if (trimmed) {
        lines.push(trimmed);
      }
    }

    return lines.join('\n');
  }

  private buildMenuMessage(
    baseMessage: string,
    options: Array<{ text: string }>
  ): string {
    const lines = options.map((option, index) => {
      const number = index + 1;
      return `*${number}.* ${option.text}`;
    });

    return [baseMessage, '', ...lines].join('\n');
  }

  private scheduleAiAgentDebouncedResponse(
    t: TFunction<'translation', undefined>,
    createChat: IChat
  ): void {
    runWithoutKafkaDispatchGuard(() => {
      setTimeout(
        async () => {
          try {
            const cacheKey = this.getAiAgentDebounceCacheKey(
              createChat.account.id,
              createChat.worker.id,
              createChat.chat_id
            );
            await this.processAiAgentDebounceByCacheKey(t, cacheKey);
          } catch (error) {
            console.error(
              '[ChatbotFlow] local AI Agent debounce trigger failed',
              error instanceof Error ? error.message : String(error)
            );
          }
        },
        (this.AI_AGENT_DEBOUNCE_SECONDS + 0.5) * 1000
      );
    });
  }

  private async processAiAgentDebounceByCacheKey(
    t: TFunction<'translation', undefined>,
    cacheKey: string
  ): Promise<void> {
    const ids = this.parseAiAgentDebounceCacheKey(cacheKey);
    if (!ids) {
      await this.redis.zrem(this.getAiAgentDebounceScheduleKey(), cacheKey);
      return;
    }

    await withLock(
      this.redis,
      this.getAutomationLockKey(ids.accountId, ids.chatId),
      async () => {
        let debounceData: IAiAgentDebouncePayload | null = null;

        try {
          const [rawPayload, scheduledScore] = await Promise.all([
            this.redis.get(cacheKey),
            this.redis.zscore(this.getAiAgentDebounceScheduleKey(), cacheKey),
          ]);

          if (scheduledScore === null) {
            return;
          }
          if (!rawPayload) {
            await this.redis.zrem(
              this.getAiAgentDebounceScheduleKey(),
              cacheKey
            );
            return;
          }
          if (Number(scheduledScore) > Date.now()) {
            return;
          }

          debounceData = JSON.parse(rawPayload) as IAiAgentDebouncePayload;
          if (
            !debounceData.trackingId ||
            !debounceData.chatbotId ||
            !debounceData.flowId ||
            !debounceData.selectedAiAgentId ||
            !Array.isArray(debounceData.messages)
          ) {
            throw new InvalidConfigurationError(
              'Payload pendente do Agente de IA está inválido.'
            );
          }

          const createChat = await this.chatService.findChatByChatId(
            ids.accountId,
            ids.chatId
          );
          if (!createChat) {
            await this.deleteAiAgentDebounceByCacheKey(cacheKey);
            return;
          }

          const activeChat = await this.getAutomationChatIfAllowed(createChat);
          if (!activeChat) {
            await this.deleteAiAgentDebounceByCacheKey(cacheKey);
            return;
          }

          const [chatbotFlow, aiAgent] = await Promise.all([
            this.chatbotService.findChatbotFlowByChatbotId(
              ids.accountId,
              debounceData.chatbotId
            ),
            this.aiAgentService.viewAiAgent(
              debounceData.selectedAiAgentId,
              ids.accountId
            ),
          ]);

          if (!chatbotFlow) {
            throw new InvalidConfigurationError(
              'Fluxo do Agente de IA não foi encontrado.'
            );
          }
          if (!aiAgent || aiAgent.status !== EAiAgentStatus.active) {
            throw new InvalidConfigurationError(
              'Agente de IA pendente não está ativo.'
            );
          }

          const currentNode = this.getFlowNodeById(
            chatbotFlow,
            debounceData.flowId
          );
          if (
            !currentNode ||
            currentNode.data?.selectedAiAgent !== debounceData.selectedAiAgentId
          ) {
            throw new InvalidConfigurationError(
              'Nó pendente do Agente de IA não corresponde ao fluxo atual.'
            );
          }

          const combinedText = this.combineAiAgentDebouncedMessages(
            debounceData.messages
          );
          if (!combinedText) {
            await this.deleteAiAgentDebounceByCacheKey(cacheKey);
            return;
          }

          const flowCacheKey = this.getChatbotFlowCacheKey(
            activeChat.account.id,
            activeChat.worker.id,
            activeChat.chat_id
          );
          const processed = await this.processAiAgentUserText(
            t,
            activeChat,
            currentNode,
            aiAgent,
            debounceData.flowId,
            combinedText,
            `${flowCacheKey}:bootstrap-summary`,
            `${flowCacheKey}:conversation-summary`,
            chatbotFlow,
            debounceData.customMessages,
            debounceData.lastMessageType,
            debounceData.trackingId
          );

          if (!processed) {
            throw new Error(
              'Processamento pendente do Agente de IA não foi concluído.'
            );
          }

          const latestRawPayload = await this.redis.get(cacheKey);
          if (!latestRawPayload) {
            await this.redis.zrem(
              this.getAiAgentDebounceScheduleKey(),
              cacheKey
            );
            return;
          }
          const latestPayload = JSON.parse(
            latestRawPayload
          ) as IAiAgentDebouncePayload;
          if (latestPayload.trackingId === debounceData.trackingId) {
            await this.deleteAiAgentDebounceByCacheKey(cacheKey);
          }
        } catch (error) {
          if (!debounceData) {
            await this.deleteAiAgentDebounceByCacheKey(cacheKey);
            console.error(
              '[ChatbotFlow] invalid AI Agent debounce payload removed',
              {
                account_id: ids.accountId,
                chat_id: ids.chatId,
                error: error instanceof Error ? error.message : String(error),
              }
            );
            return;
          }

          await this.requeueAiAgentDebounceAfterFailure(
            cacheKey,
            debounceData,
            error
          );
        }
      },
      {
        ttlMs: 120000,
        retryMs: 100,
        maxWaitMs: 135000,
      }
    );
  }

  private async processScheduledAiAgentDebounces(
    t: TFunction<'translation', undefined>
  ): Promise<void> {
    const scheduleKey = this.getAiAgentDebounceScheduleKey();
    const dueKeys = await this.redis.zrangebyscore(
      scheduleKey,
      0,
      Date.now(),
      'LIMIT',
      0,
      100
    );

    for (const cacheKey of dueKeys) {
      try {
        await this.processAiAgentDebounceByCacheKey(t, cacheKey);
      } catch (error) {
        console.error('[ChatbotFlow] scheduled AI Agent debounce failed', {
          debounce_cache_key: cacheKey,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private scheduleMenuSend(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    nodeData: { message: string; options: { id: string; text: string }[] }
  ): void {
    runWithoutKafkaDispatchGuard(() => {
      setTimeout(
        async () => {
          try {
            await this.withAutomationLock(createChat, async () => {
              const debounceData = await this.getMenuDebounce(createChat);

              if (!debounceData) {
                return;
              }

              const now = Date.now();
              if (now < debounceData.expiresAt) {
                return;
              }

              if (!(await this.canRunAutomation(createChat))) {
                return;
              }

              await this.deleteMenuDebounce(createChat);

              const rawBaseMessage = nodeData.message;
              const baseMessage = await this.replaceVariables(
                t,
                rawBaseMessage,
                createChat,
                createChat.user,
                createChat.sector
              );

              const menuMessage = this.buildMenuMessage(
                baseMessage,
                nodeData.options
              );

              await this.sendMessageWithStatusGuard(t, {
                chat: createChat,
                accountId: createChat.account.id,
                type: EMessageType.text,
                message: menuMessage,
                typeUser: ETypeUserChat.bot,
              });
            });
          } catch (error) {
            console.error('[ChatbotFlow] scheduleMenuSend failed', error);
          }
        },
        (this.MENU_DEBOUNCE_SECONDS + 0.5) * 1000
      );
    });
  }

  private getFlowNodeById(
    chatbotFlow: ListChatbotFlowResponse,
    currentFlowId: string
  ): ListChatbotFlowResponse['nodes'][number] | undefined {
    return chatbotFlow.nodes.find((node) => node.id === currentFlowId);
  }

  private getNextFlowId(
    chatbotFlow: ListChatbotFlowResponse,
    currentFlowId: string
  ): string | null {
    const edge = chatbotFlow.edges.find(
      (currentEdge) => currentEdge.source === currentFlowId
    );

    return edge?.target ?? null;
  }

  private getNextFlowIdByApiOutcome(
    chatbotFlow: ListChatbotFlowResponse,
    currentFlowId: string,
    outcome: 'success' | 'failure'
  ): string | null {
    const edge = chatbotFlow.edges.find(
      (currentEdge) =>
        currentEdge.source === currentFlowId &&
        currentEdge.sourceHandle === outcome
    );
    return edge?.target ?? null;
  }

  private getNextFlowIdByUnderchatOutcome(
    chatbotFlow: ListChatbotFlowResponse,
    currentFlowId: string,
    outcome: 'found' | 'not_found'
  ): string | null {
    const edge = chatbotFlow.edges.find(
      (currentEdge) =>
        currentEdge.source === currentFlowId &&
        currentEdge.sourceHandle === outcome
    );
    return edge?.target ?? null;
  }

  private getNextFlowIdByOption(
    chatbotFlow: ListChatbotFlowResponse,
    currentFlowId: string,
    optionId: string,
    optionText?: string | null
  ): string | null {
    const normalizedOptionId = this.normalizeOptionHandleValue(optionId);
    const normalizedOptionText = this.normalizeOptionHandleValue(optionText);

    const edge = chatbotFlow.edges.find((currentEdge) => {
      if (currentEdge.source !== currentFlowId) {
        return false;
      }

      const normalizedSourceHandle = this.normalizeOptionHandleValue(
        currentEdge.sourceHandle
      );

      return (
        normalizedSourceHandle === normalizedOptionId ||
        (normalizedOptionText &&
          normalizedSourceHandle === normalizedOptionText)
      );
    });

    return edge?.target ?? null;
  }

  private getNextFlowIdByCondition(
    chatbotFlow: ListChatbotFlowResponse,
    currentFlowId: string,
    conditionId: string
  ): string | null {
    const expectedSourceHandle = `condition-${conditionId}-source`;

    const edge = chatbotFlow.edges.find(
      (currentEdge) =>
        currentEdge.source === currentFlowId &&
        currentEdge.sourceHandle === expectedSourceHandle
    );

    return edge?.target ?? null;
  }

  private getNextFlowIdByInteractionsHandle(
    chatbotFlow: ListChatbotFlowResponse,
    currentFlowId: string
  ): string | null {
    const edge = chatbotFlow.edges.find(
      (currentEdge) =>
        currentEdge.source === currentFlowId &&
        (currentEdge.sourceHandle === 'interactions-quantity-source' ||
          currentEdge.sourceHandle === 'interactions-quantity')
    );

    return edge?.target ?? null;
  }

  private getNextFlowIdByHumanSupportHandle(
    chatbotFlow: ListChatbotFlowResponse,
    currentFlowId: string
  ): string | null {
    const edge = chatbotFlow.edges.find(
      (currentEdge) =>
        currentEdge.source === currentFlowId &&
        (currentEdge.sourceHandle === 'human-support-source' ||
          currentEdge.sourceHandle === 'human-support')
    );

    return edge?.target ?? null;
  }

  private getNextFlowIdByFallbackHandle(
    chatbotFlow: ListChatbotFlowResponse,
    currentFlowId: string
  ): string | null {
    const edge = chatbotFlow.edges.find(
      (currentEdge) =>
        currentEdge.source === currentFlowId &&
        (currentEdge.sourceHandle === 'fallback-source' ||
          currentEdge.sourceHandle === 'fallback')
    );

    return edge?.target ?? null;
  }

  private getNextFlowIdByDefaultHandle(
    chatbotFlow: ListChatbotFlowResponse,
    currentFlowId: string
  ): string | null {
    const edge = chatbotFlow.edges.find(
      (currentEdge) =>
        currentEdge.source === currentFlowId &&
        currentEdge.sourceHandle === 'default-source'
    );

    return edge?.target ?? null;
  }

  private getCurrentWeekdayOptionId(
    node: ListChatbotFlowResponse['nodes'][number]
  ): string {
    const rawTimezone = node.data?.timezone;
    const timezone = normalizeChatbotWorkingHoursTimezone(
      typeof rawTimezone === 'string' && rawTimezone.trim().length > 0
        ? rawTimezone
        : CHATBOT_WORKING_HOURS_DEFAULT_TIMEZONE
    );

    const weekdayName = new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      timeZone: timezone,
    })
      .format(new Date())
      .toLowerCase();

    if (this.WEEKDAY_OPTION_IDS.has(weekdayName)) {
      return weekdayName;
    }

    return 'sunday';
  }

  private getCurrentTimeInTimezoneMinutes(timezone: string): number {
    const parts = new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: timezone,
    }).formatToParts(new Date());

    const hourPart = parts.find((part) => part.type === 'hour');
    const minutePart = parts.find((part) => part.type === 'minute');

    const hours = Number.parseInt(hourPart?.value || '', 10);
    const minutes = Number.parseInt(minutePart?.value || '', 10);

    if (Number.isNaN(hours) || Number.isNaN(minutes)) {
      return 0;
    }

    return hours * 60 + minutes;
  }

  private getCurrentHoursOptionId(
    node: ListChatbotFlowResponse['nodes'][number]
  ): string {
    const rawTimezone = node.data?.timezone;
    const timezone = normalizeChatbotWorkingHoursTimezone(
      typeof rawTimezone === 'string' && rawTimezone.trim().length > 0
        ? rawTimezone
        : CHATBOT_WORKING_HOURS_DEFAULT_TIMEZONE
    );
    const currentMinutes = this.getCurrentTimeInTimezoneMinutes(timezone);

    const options = Array.isArray(node.data?.options) ? node.data.options : [];

    const intervalOptions = options.filter((option) => {
      const optionId =
        option?.id !== null && option?.id !== undefined
          ? String(option.id).trim().toLowerCase()
          : '';
      return optionId !== this.HOURS_OUTSIDE_OPTION_ID;
    });

    for (const option of intervalOptions) {
      const optionId =
        option?.id !== null && option?.id !== undefined
          ? String(option.id).trim()
          : '';
      const startMinutes = toChatbotWorkingHoursMinutes(
        typeof option?.start_time === 'string' ? option.start_time : null
      );
      const endMinutes = toChatbotWorkingHoursMinutes(
        typeof option?.end_time === 'string' ? option.end_time : null
      );

      if (
        !optionId ||
        startMinutes === null ||
        endMinutes === null ||
        startMinutes === endMinutes
      ) {
        continue;
      }

      const isOvernightRange = startMinutes > endMinutes;
      const isInRange = isOvernightRange
        ? currentMinutes >= startMinutes || currentMinutes <= endMinutes
        : currentMinutes >= startMinutes && currentMinutes <= endMinutes;

      if (isInRange) {
        return optionId;
      }
    }

    return this.HOURS_OUTSIDE_OPTION_ID;
  }

  private getAiAgentInteractionsCountKey(
    accountId: string,
    workerId: string,
    chatId: string,
    nodeId: string
  ): string {
    return `chatbot:ai-agent:interactions:${accountId}:${workerId}:${chatId}:${nodeId}`;
  }

  private getLastAgentResponseKey(
    accountId: string,
    workerId: string,
    chatId: string,
    aiAgentId: string
  ): string {
    return `chatbot:ai-agent:last-response:${accountId}:${workerId}:${chatId}:${aiAgentId}`;
  }

  private getConversationHistoryCacheKey(
    accountId: string,
    workerId: string,
    chatId: string,
    aiAgentId: string
  ): string {
    return `chatbot:ai-agent:conversation:${accountId}:${workerId}:${chatId}:${aiAgentId}`;
  }

  private readonly CONVERSATION_HISTORY_MAX_ITEMS = 20;
  private readonly CONVERSATION_HISTORY_TTL_SECONDS = 86400;

  private async pushToConversationHistory(
    accountId: string,
    workerId: string,
    chatId: string,
    aiAgentId: string,
    role: 'user' | 'assistant',
    content: string
  ): Promise<void> {
    if (!content || content.trim().length === 0) {
      return;
    }
    const key = this.getConversationHistoryCacheKey(
      accountId,
      workerId,
      chatId,
      aiAgentId
    );
    const item = JSON.stringify({ role, content: content.trim() });
    await this.redis
      .multi()
      .rpush(key, item)
      .ltrim(key, -this.CONVERSATION_HISTORY_MAX_ITEMS, -1)
      .expire(key, this.CONVERSATION_HISTORY_TTL_SECONDS)
      .exec();
  }

  private async getConversationHistory(
    accountId: string,
    workerId: string,
    chatId: string,
    aiAgentId: string,
    limit: number = 20
  ): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
    const key = this.getConversationHistoryCacheKey(
      accountId,
      workerId,
      chatId,
      aiAgentId
    );
    const raw = await this.redis.lrange(key, -limit, -1);
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    for (const s of raw) {
      try {
        const parsed = JSON.parse(s) as { role?: string; content?: string };
        if (
          parsed &&
          (parsed.role === 'user' || parsed.role === 'assistant') &&
          typeof parsed.content === 'string' &&
          parsed.content.trim().length > 0
        ) {
          messages.push({
            role: parsed.role as 'user' | 'assistant',
            content: parsed.content.trim(),
          });
        }
      } catch {
        continue;
      }
    }
    return messages;
  }

  private async storeLastAgentResponse(
    accountId: string,
    workerId: string,
    chatId: string,
    aiAgentId: string,
    response: string
  ): Promise<void> {
    if (!response || response.trim().length === 0) {
      return;
    }
    const key = this.getLastAgentResponseKey(
      accountId,
      workerId,
      chatId,
      aiAgentId
    );
    await this.redis.set(key, response.trim(), 'EX', 86400);
  }

  private async getLastAgentResponse(
    accountId: string,
    workerId: string,
    chatId: string,
    aiAgentId: string
  ): Promise<string | null> {
    const key = this.getLastAgentResponseKey(
      accountId,
      workerId,
      chatId,
      aiAgentId
    );
    const value = await this.redis.get(key);
    if (!value || value.trim().length === 0) {
      return null;
    }
    return value.trim();
  }

  private async delay(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async retryOperation<T>(
    operation: () => Promise<T>,
    attempts: number = this.AI_AGENT_API_RETRY_ATTEMPTS,
    baseDelayMs: number = this.AI_AGENT_API_RETRY_BASE_DELAY_MS
  ): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (attempt < attempts) {
          await this.delay(baseDelayMs * attempt);
        }
      }
    }

    throw lastError;
  }

  private getErrorMessage(error: unknown): string {
    if (typeof error === 'string') {
      return error;
    }

    if (error instanceof Error) {
      return error.message ?? '';
    }

    try {
      return JSON.stringify(error);
    } catch {
      return String(error ?? '');
    }
  }

  private isAiInteractionError(error: unknown): boolean {
    if (!error) {
      return false;
    }

    if (error instanceof InvalidConfigurationError) {
      return false;
    }

    if (error instanceof AiProviderError) {
      return true;
    }

    const normalizedMessage = this.getErrorMessage(error).trim().toLowerCase();
    if (!normalizedMessage) {
      return false;
    }

    if (
      normalizedMessage.includes('ai agent api error:') ||
      normalizedMessage.includes('gemini api error:')
    ) {
      return true;
    }

    const interactionMarkers = [
      'resource_exhausted',
      'quota exceeded',
      'too many requests',
      'rate limit',
      'timeout',
      'timed out',
      'etimedout',
      'aborterror',
      'fetch failed',
      'network error',
      'service unavailable',
      'temporarily unavailable',
      'gateway timeout',
      'connection reset',
      'econnreset',
      'socket hang up',
      'token expired',
      'invalid api key',
      'unauthorized',
      'forbidden',
    ];

    return interactionMarkers.some((marker) =>
      normalizedMessage.includes(marker)
    );
  }

  private async tryProcessAiInteractionFallback(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    chatbotFlow: ListChatbotFlowResponse,
    currentFlowId: string,
    customMessages?: IChatbotCustomMessages
  ): Promise<boolean> {
    const nextFlowId = this.getNextFlowIdByFallbackHandle(
      chatbotFlow,
      currentFlowId
    );
    if (!nextFlowId) {
      return false;
    }

    await this.updateCache(createChat, nextFlowId);
    return this.processNextNode(
      t,
      createChat,
      chatbotFlow,
      nextFlowId,
      customMessages
    );
  }

  private async ensureBootstrapSummary(
    bootstrapSummaryKey: string,
    promptsText: string,
    aiAgent: {
      base_url: string;
      api_key: string;
      model: string;
      ai_agent_type_id: string;
    }
  ): Promise<string | null> {
    const hashKey = `${bootstrapSummaryKey}:hash`;
    const cachedSummary = await this.redis.get(bootstrapSummaryKey);

    if (!promptsText || promptsText.trim().length === 0) {
      await this.redis.del(bootstrapSummaryKey, hashKey);
      return null;
    }

    const promptsHash = this.hashText(promptsText);
    const cachedHash = await this.redis.get(hashKey);

    if (cachedSummary && cachedHash === promptsHash) {
      return cachedSummary;
    }

    let summary: string | null = null;

    try {
      summary = await this.retryOperation(() =>
        this.ragService.generateBootstrapSummaryFromPrompts(
          promptsText,
          aiAgent.base_url,
          aiAgent.api_key,
          aiAgent.model,
          aiAgent.ai_agent_type_id
        )
      );
    } catch (error) {
      console.error(
        '[ChatbotFlow] generateBootstrapSummary failed, skipping summary',
        error
      );
      return cachedSummary ?? null;
    }

    if (summary && summary.trim().length > 0) {
      await this.redis.set(bootstrapSummaryKey, summary, 'EX', 86400);
      await this.redis.set(hashKey, promptsHash, 'EX', 86400);
      return summary;
    }

    return cachedSummary;
  }

  private getConversationSummaryCountKey(
    accountId: string,
    workerId: string,
    chatId: string,
    nodeId: string
  ): string {
    return `chatbot:ai-agent:summary:${accountId}:${workerId}:${chatId}:${nodeId}`;
  }

  private async shouldUpdateConversationSummary(
    accountId: string,
    workerId: string,
    chatId: string,
    nodeId: string
  ): Promise<boolean> {
    const key = this.getConversationSummaryCountKey(
      accountId,
      workerId,
      chatId,
      nodeId
    );
    const count = await this.redis.incr(key);
    await this.redis.expire(key, 86400);
    if (count === 1) {
      return true;
    }
    return count % this.CONVERSATION_SUMMARY_UPDATE_INTERVAL === 0;
  }

  private async incrementAiAgentInteractionsCount(
    accountId: string,
    workerId: string,
    chatId: string,
    nodeId: string
  ): Promise<number> {
    const key = this.getAiAgentInteractionsCountKey(
      accountId,
      workerId,
      chatId,
      nodeId
    );
    const count = await this.redis.incr(key);
    await this.redis.expire(key, 86400);
    return count;
  }

  private hasReachedInteractionLimit(count: number, limit: number): boolean {
    return count >= limit;
  }

  private hasExceededInteractionLimitAfterIncrement(
    newCount: number,
    limit: number
  ): boolean {
    return newCount > limit;
  }

  private async getAiAgentInteractionsCount(
    accountId: string,
    workerId: string,
    chatId: string,
    nodeId: string
  ): Promise<number> {
    const key = this.getAiAgentInteractionsCountKey(
      accountId,
      workerId,
      chatId,
      nodeId
    );
    const count = await this.redis.get(key);
    const countValue = count ? parseInt(count, 10) : 0;
    return countValue;
  }

  private async resetAiAgentInteractionsCount(
    accountId: string,
    workerId: string,
    chatId: string,
    nodeId: string
  ): Promise<void> {
    const key = this.getAiAgentInteractionsCountKey(
      accountId,
      workerId,
      chatId,
      nodeId
    );
    await this.redis.del(key);
  }

  private getTextFromUpsertMessage(data: IUpsertMessage): string | null {
    const messageContent: proto.IMessage | null | undefined =
      data.message?.message;

    if (!messageContent) {
      return null;
    }

    if (messageContent.conversation) {
      return messageContent.conversation;
    }

    if (messageContent.extendedTextMessage?.text) {
      return messageContent.extendedTextMessage.text;
    }

    if (messageContent.imageMessage?.caption) {
      return messageContent.imageMessage.caption;
    }

    if (messageContent.videoMessage?.caption) {
      return messageContent.videoMessage.caption;
    }

    return null;
  }

  private getMessageResponseCapture(
    data: IUpsertMessage
  ): ChatbotNodeRuntimeCapture | null {
    const type = data.type;
    if (
      type !== EMessageType.text &&
      type !== EMessageType.image &&
      type !== EMessageType.video &&
      type !== EMessageType.audio &&
      type !== EMessageType.document
    ) {
      return null;
    }

    const sourceMedia =
      type === EMessageType.image
        ? data.content?.image
        : type === EMessageType.video
          ? data.content?.video
          : type === EMessageType.audio
            ? data.content?.audio
            : type === EMessageType.document
              ? data.content?.document
              : null;
    const media = sourceMedia as Record<string, unknown> | null | undefined;
    const nullableString = (value: unknown): string | null =>
      typeof value === 'string' ? value : null;
    const nullableNumber = (value: unknown): number | null =>
      typeof value === 'number' && Number.isFinite(value) ? value : null;

    return {
      text: this.getTextFromUpsertMessage(data) ?? '',
      type,
      media:
        type === EMessageType.text
          ? null
          : {
              url: nullableString(media?.url),
              name: nullableString(media?.name),
              mimetype: nullableString(media?.mimetype),
              extension: nullableString(media?.extension),
              size: nullableNumber(media?.size),
              duration: nullableNumber(media?.duration),
              width: nullableNumber(media?.width),
              height: nullableNumber(media?.height),
            },
    };
  }

  private parseStructuredSelection(
    rawText: string,
    maxOption: number
  ): number | null {
    if (maxOption < 1) {
      return null;
    }

    const normalizedText = rawText.replace(/\r\n?/g, '\n').trim();
    if (!normalizedText) {
      return null;
    }

    const nonEmptyLines = normalizedText
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const candidates: string[] = [];
    const addCandidate = (value: string): void => {
      const trimmed = value.trim();
      if (!trimmed || candidates.includes(trimmed)) {
        return;
      }
      candidates.push(trimmed);
    };

    if (nonEmptyLines.length > 0) {
      addCandidate(nonEmptyLines[nonEmptyLines.length - 1]);
    }
    addCandidate(normalizedText);

    for (const candidate of candidates) {
      const sanitized = candidate.replace(/[*_`~]/g, '').trim();
      if (!sanitized) {
        continue;
      }

      const matched =
        sanitized.match(
          /^(\d{1,3})(?:\s*$|\s*[.)]\s*.*$|\s*-\s*.*$|\s*:\s*.*$)/
        ) ||
        sanitized.match(
          /^[^:\n]+:\s*(\d{1,3})(?:\s*$|\s*[.)]\s*.*$|\s*-\s*.*$|\s*:\s*.*$)/
        );

      if (!matched) {
        continue;
      }

      const parsed = Number.parseInt(matched[1], 10);
      if (Number.isNaN(parsed) || parsed < 1 || parsed > maxOption) {
        return null;
      }

      return parsed;
    }

    return null;
  }

  private async getTextOrTranscribedForAiAgent(
    data: IUpsertMessage,
    createChat: IChat,
    aiAgent: ViewAiAgentResponse | null
  ): Promise<string | null> {
    const inputMode =
      aiAgent?.voice_ia_input_mode ?? EAiAgentVoiceInputMode.audio_and_text;
    const text = this.getTextFromUpsertMessage(data)?.trim();
    const isAudioMessage = data.type === EMessageType.audio;

    if (inputMode === EAiAgentVoiceInputMode.text) {
      return text || null;
    }

    if (inputMode === EAiAgentVoiceInputMode.audio) {
      if (!isAudioMessage) {
        return null;
      }
      return this.transcribeAudioMessage(data, createChat, aiAgent);
    }

    if (text) {
      return text;
    }

    if (!isAudioMessage) {
      return null;
    }

    return this.transcribeAudioMessage(data, createChat, aiAgent);
  }

  private async transcribeAudioMessage(
    data: IUpsertMessage,
    createChat: IChat,
    aiAgent: ViewAiAgentResponse | null
  ): Promise<string | null> {
    const audioUrl = data.content?.audio?.url;
    if (!audioUrl) {
      return null;
    }

    if (!aiAgent?.voice_ia_id) {
      return null;
    }

    const voiceIaConfig = await this.voiceIaService.viewVoiceIa(
      aiAgent.voice_ia_id,
      createChat.account.id
    );

    if (
      !voiceIaConfig ||
      voiceIaConfig.status !== EVoiceIaStatus.active ||
      !voiceIaConfig.api_key?.trim()
    ) {
      return null;
    }

    try {
      const response = await executeSafeOutboundHttp({
        url: audioUrl,
        method: 'GET',
        ...getChatbotApiOutboundHttpPolicy(),
      });
      if (
        response.kind !== 'response' ||
        response.statusCode < 200 ||
        response.statusCode >= 300
      ) {
        console.error('[ChatbotFlow] AI audio download failed', {
          account_id: createChat.account.id,
          chat_id: createChat.chat_id,
          failure:
            response.kind === 'failure'
              ? response.code
              : `HTTP_${response.statusCode}`,
        });
        return null;
      }

      const mimetype = data.content?.audio?.mimetype?.trim() || 'audio/mpeg';
      const result = await this.voiceIaIntegrationService.transcribe(
        response.body,
        voiceIaConfig,
        mimetype
      );
      return result?.text?.trim() ?? null;
    } catch (error) {
      console.error('[ChatbotFlow] AI audio transcription failed', {
        account_id: createChat.account.id,
        chat_id: createChat.chat_id,
        error: error instanceof Error ? error.name : 'UnknownError',
      });
      return null;
    }
  }

  private shouldRespondWithAudio(
    aiAgent: ViewAiAgentResponse,
    inputMessageType: EMessageType
  ): boolean {
    const outputMode =
      aiAgent.voice_ia_output_mode ?? EAiAgentVoiceOutputMode.audio;

    if (outputMode === EAiAgentVoiceOutputMode.text) {
      return false;
    }

    if (outputMode === EAiAgentVoiceOutputMode.audio) {
      return true;
    }

    return inputMessageType === EMessageType.audio;
  }

  private async sendTextOptionInvalidMessage(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    customMessage?: string,
    nodeType?: 'menu' | 'satisfaction',
    enabled?: boolean
  ): Promise<boolean> {
    if (enabled === false) {
      return false;
    }

    let defaultMessage = t('chatbot_option_invalid');
    if (!customMessage && nodeType === 'satisfaction') {
      defaultMessage = t('chatbot_satisfaction_option_invalid');
    }

    const rawMessage = customMessage || defaultMessage;
    const message = await this.replaceVariables(
      t,
      rawMessage,
      createChat,
      createChat.user,
      createChat.sector
    );
    return this.sendMessageWithStatusGuard(t, {
      chat: createChat,
      accountId: createChat.account.id,
      type: EMessageType.system,
      message,
      typeUser: ETypeUserChat.bot,
    });
  }

  private async sendInvalidEmailMessage(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    customMessage?: string,
    enabled?: boolean
  ): Promise<boolean> {
    if (enabled === false) {
      return false;
    }

    const rawMessage = customMessage || t('email_invalid');
    const message = await this.replaceVariables(
      t,
      rawMessage,
      createChat,
      createChat.user,
      createChat.sector
    );
    return this.sendMessageWithStatusGuard(t, {
      chat: createChat,
      accountId: createChat.account.id,
      type: EMessageType.system,
      message,
      typeUser: ETypeUserChat.bot,
    });
  }

  private async sendInvalidCpfMessage(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    customMessage?: string,
    enabled?: boolean
  ): Promise<boolean> {
    if (enabled === false) {
      return false;
    }

    const rawMessage = customMessage || t('cpf_invalid');
    const message = await this.replaceVariables(
      t,
      rawMessage,
      createChat,
      createChat.user,
      createChat.sector
    );
    return this.sendMessageWithStatusGuard(t, {
      chat: createChat,
      accountId: createChat.account.id,
      type: EMessageType.system,
      message,
      typeUser: ETypeUserChat.bot,
    });
  }

  private async sendInvalidCnpjMessage(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    customMessage?: string,
    enabled?: boolean
  ): Promise<boolean> {
    if (enabled === false) {
      return false;
    }

    const rawMessage = customMessage || t('cnpj_invalid');
    const message = await this.replaceVariables(
      t,
      rawMessage,
      createChat,
      createChat.user,
      createChat.sector
    );
    return this.sendMessageWithStatusGuard(t, {
      chat: createChat,
      accountId: createChat.account.id,
      type: EMessageType.system,
      message,
      typeUser: ETypeUserChat.bot,
    });
  }

  private onlyDigits(s: string): string {
    return s.replaceAll(/\D+/g, '');
  }

  private getGreeting(t: TFunction<'translation', undefined>): string {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) {
      return t('good_morning');
    }
    if (hour >= 12 && hour < 18) {
      return t('good_afternoon');
    }
    return t('good_evening');
  }

  private async getContactByChatPhone(
    createChat: IChat
  ): Promise<Awaited<ReturnType<ContactService['getContactByPhone']>>> {
    if (!createChat.phone) {
      return null;
    }

    const phoneAndDdi = extractPhoneAndDdi(createChat.phone);
    if (!phoneAndDdi) {
      return null;
    }

    return this.contactService.getContactByPhone(
      createChat.account.id,
      phoneAndDdi.phone,
      phoneAndDdi.phone_ddi
    );
  }

  private buildSavedContactFullName(
    contact: {
      name: string;
      last_name?: string | null;
    } | null
  ): string | null {
    if (!contact) {
      return null;
    }

    const fullName = [contact.name, contact.last_name]
      .filter(Boolean)
      .join(' ')
      .trim();

    return fullName || null;
  }

  private async getContactName(createChat: IChat): Promise<string | null> {
    const contact = await this.getContactByChatPhone(createChat);
    return this.buildSavedContactFullName(contact);
  }

  private async getRandomMessageNicknameValue(
    createChat: IChat
  ): Promise<string> {
    const contact = await this.getContactByChatPhone(createChat);
    const savedNickname = contact?.nickname?.trim() || null;

    if (savedNickname) {
      return savedNickname;
    }

    const savedName = this.buildSavedContactFullName(contact);
    if (savedName) {
      return savedName;
    }

    return createChat.name?.trim() || '';
  }

  private replaceRandomMessageNicknameTags(
    message: string,
    nickname: string
  ): string {
    let replaced = message;
    replaced = replaced.replaceAll(/\{\{\s*nickname\s*\}\}/gi, nickname);
    replaced = replaced.replaceAll(/\{\{\s*apelido\s*\}\}/gi, nickname);
    return replaced;
  }

  private async replaceVariables(
    t: TFunction<'translation', undefined>,
    message: string | null | undefined,
    createChat: IChat,
    user?: IChat['user'] | null,
    sector?: IChat['sector'] | null
  ): Promise<string> {
    if (!message) {
      return '';
    }

    let replacedMessage = message;

    const greeting = this.getGreeting(t);
    replacedMessage = replacedMessage.replaceAll(
      /\{\{\s*greeting\s*\}\}/gi,
      greeting
    );

    const contactName = await this.getContactName(createChat);
    const whatsappName = createChat.name || null;

    const name = contactName || whatsappName || '';
    replacedMessage = replacedMessage.replaceAll(/\{\{\s*name\s*\}\}/gi, name);

    replacedMessage = replacedMessage.replaceAll(
      /\{\{\s*contact_name\s*\}\}/gi,
      name
    );

    const protocol = generateProtocol();
    replacedMessage = replacedMessage.replaceAll(
      /\{\{\s*protocol\s*\}\}/gi,
      protocol
    );

    if (sector?.name) {
      replacedMessage = replacedMessage.replaceAll(
        /\{\{\s*sector\s*\}\}/gi,
        sector.name
      );
    } else {
      replacedMessage = replacedMessage.replaceAll(
        /\{\{\s*sector\s*\}\}/gi,
        ''
      );
    }

    if (user?.name) {
      replacedMessage = replacedMessage.replaceAll(
        /\{\{\s*user\s*\}\}/gi,
        user.name
      );
    } else {
      replacedMessage = replacedMessage.replaceAll(/\{\{\s*user\s*\}\}/gi, '');
    }

    const date = new Date().toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
    replacedMessage = replacedMessage.replaceAll(/\{\{\s*date\s*\}\}/gi, date);

    const time = new Date().toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    });
    replacedMessage = replacedMessage.replaceAll(/\{\{\s*time\s*\}\}/gi, time);

    if (createChat.account?.name) {
      replacedMessage = replacedMessage.replaceAll(
        /\{\{\s*account_name\s*\}\}/gi,
        createChat.account.name
      );
    } else {
      replacedMessage = replacedMessage.replaceAll(
        /\{\{\s*account_name\s*\}\}/gi,
        ''
      );
    }

    if (createChat.phone) {
      replacedMessage = replacedMessage.replaceAll(
        /\{\{\s*phone\s*\}\}/gi,
        createChat.phone
      );
    } else {
      replacedMessage = replacedMessage.replaceAll(/\{\{\s*phone\s*\}\}/gi, '');
    }

    if (createChat.worker?.name) {
      replacedMessage = replacedMessage.replaceAll(
        /\{\{\s*channel_name\s*\}\}/gi,
        createChat.worker.name
      );
    } else {
      replacedMessage = replacedMessage.replaceAll(
        /\{\{\s*channel_name\s*\}\}/gi,
        ''
      );
    }

    if (/\{\{\s*api_[1-9]\d*(?:[.\s}])/u.test(replacedMessage)) {
      const context = await this.flowRuntimeContextService?.load({
        accountId: createChat.account.id,
        workerId: createChat.worker.id,
        chatId: createChat.chat_id,
      });
      if (context && this.flowRuntimeContextService) {
        const scope = this.flowRuntimeContextService.toVariableScope(context);
        const resolved = resolveChatbotTemplate(replacedMessage, scope, {
          missingValue: 'error',
          arrayFormat: 'human',
        });
        replacedMessage = this.formatResolvedHumanValue(resolved);
      }
    }

    return replacedMessage;
  }

  private isValidEmail(email: string): boolean {
    const trimmed = email.trim();
    if (!trimmed) return false;

    const atIndex = trimmed.indexOf('@');
    if (atIndex <= 0 || atIndex === trimmed.length - 1) return false;
    if (trimmed.substring(atIndex + 1).includes('@')) return false;

    const localPart = trimmed.substring(0, atIndex);
    const domainPart = trimmed.substring(atIndex + 1);

    if (localPart.length === 0 || localPart.includes(' ')) return false;

    const dotIndex = domainPart.indexOf('.');
    if (dotIndex <= 0 || dotIndex === domainPart.length - 1) return false;
    if (domainPart.includes(' ')) return false;

    return true;
  }

  private isValidCPF(cpf: string): boolean {
    const digits = this.onlyDigits(cpf);

    if (digits.length !== 11) return false;

    if (/^(\d)\1{10}$/.test(digits)) return false;

    let sum = 0;
    for (let i = 0; i < 9; i++) {
      sum += Number.parseInt(digits.charAt(i)) * (10 - i);
    }
    let remainder = (sum * 10) % 11;
    if (remainder === 10 || remainder === 11) remainder = 0;
    if (remainder !== Number.parseInt(digits.charAt(9))) return false;

    sum = 0;
    for (let i = 0; i < 10; i++) {
      sum += Number.parseInt(digits.charAt(i)) * (11 - i);
    }
    remainder = (sum * 10) % 11;
    if (remainder === 10 || remainder === 11) remainder = 0;
    if (remainder !== Number.parseInt(digits.charAt(10))) return false;

    return true;
  }

  private getNodeDataValue<T = unknown>(
    node: ListChatbotFlowResponse['nodes'][number],
    key: string
  ): T | null {
    const data = node.data as Record<string, unknown>;
    const directValue = data?.[key];
    if (
      directValue !== null &&
      directValue !== undefined &&
      !(typeof directValue === 'string' && directValue.trim().length === 0)
    ) {
      return directValue as T;
    }

    const official = data?.official as Record<string, unknown> | undefined;
    const officialValue = official?.[key];
    if (
      officialValue !== null &&
      officialValue !== undefined &&
      !(typeof officialValue === 'string' && officialValue.trim().length === 0)
    ) {
      return officialValue as T;
    }

    return null;
  }

  private getNodeTextValue(
    node: ListChatbotFlowResponse['nodes'][number],
    key: string,
    fallback = ''
  ): string {
    const value = this.getNodeDataValue(node, key);
    if (typeof value === 'string') {
      return value;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }

    return fallback;
  }

  private getTextFromUnknown(value: unknown): string {
    if (typeof value === 'string') {
      return value.trim();
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }

    return '';
  }

  private normalizeOptionHandleValue(value: unknown): string | null {
    const text = this.getTextFromUnknown(value);
    if (!text) {
      return null;
    }

    const normalized = text
      .replace(/^option-/i, '')
      .replace(/-source$/i, '')
      .trim();

    return normalized || null;
  }

  private getProductRetailerId(product: unknown): string {
    if (typeof product === 'string') return product.trim();
    if (!product || typeof product !== 'object') return '';

    const productRecord = product as Record<string, unknown>;
    const value =
      productRecord.product_retailer_id ?? productRecord.productRetailerId;
    return typeof value === 'string' ? value.trim() : '';
  }

  private normalizeProductItems(
    products: unknown[]
  ): Array<{ product_retailer_id: string }> {
    return products
      .map((product) => this.getProductRetailerId(product))
      .filter((productRetailerId) => productRetailerId.length > 0)
      .map((productRetailerId) => ({
        product_retailer_id: productRetailerId,
      }));
  }

  private normalizeProductSections(
    sections: unknown[],
    fallbackProducts: unknown[],
    fallbackTitle: string
  ): Array<{
    title: string;
    product_items: Array<{ product_retailer_id: string }>;
  }> {
    const normalizedSections = sections
      .map((section, index) => {
        if (!section || typeof section !== 'object') return null;

        const sectionRecord = section as Record<string, unknown>;
        const title =
          typeof sectionRecord.title === 'string' &&
          sectionRecord.title.trim().length > 0
            ? sectionRecord.title.trim()
            : `${fallbackTitle} ${index + 1}`.trim();
        const rawItems = Array.isArray(sectionRecord.product_items)
          ? sectionRecord.product_items
          : Array.isArray(sectionRecord.products)
            ? sectionRecord.products
            : [];
        const productItems = this.normalizeProductItems(rawItems);

        if (productItems.length === 0) return null;
        return {
          title,
          product_items: productItems,
        };
      })
      .filter(
        (
          section
        ): section is {
          title: string;
          product_items: Array<{ product_retailer_id: string }>;
        } => section !== null
      );

    if (normalizedSections.length > 0) {
      return normalizedSections;
    }

    const productItems = this.normalizeProductItems(fallbackProducts);
    return productItems.length > 0
      ? [
          {
            title: fallbackTitle,
            product_items: productItems,
          },
        ]
      : [];
  }

  private normalizeCarouselCards(cards: unknown[]): unknown[] {
    return cards
      .map((card, index) => {
        if (!card || typeof card !== 'object') return null;

        const cardRecord = card as Record<string, unknown>;
        if (Array.isArray(cardRecord.components)) {
          return cardRecord;
        }

        const body =
          typeof cardRecord.body === 'string'
            ? cardRecord.body.trim()
            : typeof cardRecord.text === 'string'
              ? cardRecord.text.trim()
              : '';
        const mediaType = cardRecord.mediaType === 'video' ? 'video' : 'image';
        const mediaUrl =
          typeof cardRecord.mediaUrl === 'string'
            ? cardRecord.mediaUrl.trim()
            : typeof cardRecord.media_url === 'string'
              ? cardRecord.media_url.trim()
              : '';
        const mediaId =
          typeof cardRecord.mediaId === 'string'
            ? cardRecord.mediaId.trim()
            : typeof cardRecord.media_id === 'string'
              ? cardRecord.media_id.trim()
              : '';
        const buttonUrl =
          typeof cardRecord.buttonUrl === 'string'
            ? cardRecord.buttonUrl.trim()
            : typeof cardRecord.url === 'string'
              ? cardRecord.url.trim()
              : '';

        const components: Array<Record<string, unknown>> = [];
        if (mediaId || mediaUrl) {
          components.push({
            type: 'header',
            parameters: [
              {
                type: mediaType,
                [mediaType]: mediaId ? { id: mediaId } : { link: mediaUrl },
              },
            ],
          });
        }

        if (body) {
          components.push({
            type: 'body',
            parameters: [{ type: 'text', text: body }],
          });
        }

        if (buttonUrl) {
          components.push({
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [{ type: 'text', text: buttonUrl }],
          });
        }

        if (components.length === 0) return null;
        return {
          card_index: index,
          components,
        };
      })
      .filter((card): card is Record<string, unknown> => card !== null);
  }

  private buildAddressAction(
    node: ListChatbotFlowResponse['nodes'][number]
  ): Record<string, unknown> {
    const action =
      this.getNodeDataValue<Record<string, unknown>>(node, 'action') ?? {};
    const parameters =
      action.parameters &&
      typeof action.parameters === 'object' &&
      !Array.isArray(action.parameters)
        ? (action.parameters as Record<string, unknown>)
        : {};
    const country =
      this.getNodeTextValue(node, 'addressCountry') ||
      (typeof parameters.country === 'string' ? parameters.country : '') ||
      'BR';

    return {
      name: 'address_message',
      ...action,
      parameters: {
        ...parameters,
        country,
      },
    };
  }

  private isNativeOfficialAddressCountrySupported(country: string): boolean {
    return ['IN', 'SG'].includes(country.trim().toUpperCase());
  }

  private getOfficialAddressCountry(
    node: ListChatbotFlowResponse['nodes'][number]
  ): string {
    const action =
      this.getNodeDataValue<Record<string, unknown>>(node, 'action') ?? {};
    const parameters =
      action.parameters &&
      typeof action.parameters === 'object' &&
      !Array.isArray(action.parameters)
        ? (action.parameters as Record<string, unknown>)
        : {};

    return (
      this.getNodeTextValue(node, 'addressCountry') ||
      this.getTextFromUnknown(parameters.country) ||
      'BR'
    );
  }

  private withOfficialHeaderFooter(
    node: ListChatbotFlowResponse['nodes'][number],
    interactive: Record<string, unknown>
  ): Record<string, unknown> {
    const headerText = this.getNodeTextValue(node, 'header', '').trim();

    if (headerText) {
      interactive.header = {
        type: 'text',
        text: headerText,
      };
    }

    return this.withOfficialFooter(node, interactive);
  }

  private withOfficialFooter(
    node: ListChatbotFlowResponse['nodes'][number],
    interactive: Record<string, unknown>
  ): Record<string, unknown> {
    const footerText = this.getNodeTextValue(node, 'footer', '').trim();

    if (footerText) {
      interactive.footer = {
        text: footerText,
      };
    }

    return interactive;
  }

  private resolveOfficialOptions(
    node: ListChatbotFlowResponse['nodes'][number]
  ): Array<{ id: string; text: string; description?: string | null }> {
    const rawOptions = this.getNodeDataValue<unknown[]>(node, 'options');
    const options = Array.isArray(rawOptions) ? rawOptions : [];
    return options
      .map((rawOption, index) => {
        const option =
          rawOption &&
          typeof rawOption === 'object' &&
          !Array.isArray(rawOption)
            ? (rawOption as Record<string, unknown>)
            : {};
        return {
          id: String(option.id ?? `option-${index + 1}`).trim(),
          text: String(option.text ?? `Opção ${index + 1}`).trim(),
          description:
            typeof option.description === 'string'
              ? String(option.description)
              : null,
        };
      })
      .filter((option) => option.id && option.text);
  }

  private normalizeOfficialListSections(
    sections: unknown,
    fallbackRows: Array<{
      id: string;
      title: string;
      description?: string;
    }>,
    fallbackTitle: string
  ): Array<Record<string, unknown>> {
    const normalizedSections = Array.isArray(sections)
      ? sections
          .map((section, sectionIndex): Record<string, unknown> | null => {
            if (
              !section ||
              typeof section !== 'object' ||
              Array.isArray(section)
            ) {
              return null;
            }

            const sectionRecord = section as Record<string, unknown>;
            const rawRows = Array.isArray(sectionRecord.rows)
              ? sectionRecord.rows
              : Array.isArray(sectionRecord.items)
                ? sectionRecord.items
                : [];
            const rows = rawRows
              .map((row, rowIndex): Record<string, unknown> | null => {
                if (!row || typeof row !== 'object' || Array.isArray(row)) {
                  return null;
                }

                const rowRecord = row as Record<string, unknown>;
                const id = this.getTextFromUnknown(
                  rowRecord.id ??
                    rowRecord.value ??
                    rowRecord.product_retailer_id ??
                    rowRecord.title ??
                    `row-${sectionIndex + 1}-${rowIndex + 1}`
                );
                const title = this.getTextFromUnknown(
                  rowRecord.title ??
                    rowRecord.text ??
                    rowRecord.name ??
                    rowRecord.id ??
                    `Opção ${rowIndex + 1}`
                );
                const description = this.getTextFromUnknown(
                  rowRecord.description
                );

                if (!id || !title) {
                  return null;
                }

                return {
                  id,
                  title,
                  ...(description ? { description } : {}),
                };
              })
              .filter((row): row is Record<string, unknown> => row !== null);

            if (rows.length === 0) {
              return null;
            }

            const title = this.getTextFromUnknown(sectionRecord.title);
            return {
              title: title || fallbackTitle,
              rows,
            };
          })
          .filter(
            (section): section is Record<string, unknown> => section !== null
          )
      : [];

    const fallbackSections: Array<Record<string, unknown>> =
      fallbackRows.length > 0
        ? [
            {
              title: fallbackTitle,
              rows: fallbackRows,
            },
          ]
        : [];
    const sourceSections: Array<Record<string, unknown>> =
      normalizedSections.length > 0 ? normalizedSections : fallbackSections;

    return sourceSections.filter(
      (section) => Array.isArray(section.rows) && section.rows.length > 0
    );
  }

  private async buildOfficialInteractivePayload(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    node: ListChatbotFlowResponse['nodes'][number]
  ): Promise<Record<string, unknown> | null> {
    const rawMessage =
      this.getNodeTextValue(node, 'message') ||
      this.getNodeTextValue(node, 'text');
    const message = await this.replaceVariables(
      t,
      rawMessage,
      createChat,
      createChat.user,
      createChat.sector
    );

    if (node.type === 'officialReplyButtons') {
      const buttons = this.resolveOfficialOptions(node).map((option) => ({
        type: 'reply',
        reply: {
          id: option.id,
          title: option.text,
        },
      }));

      return this.withOfficialHeaderFooter(node, {
        type: 'button',
        body: { text: message },
        action: { buttons },
      });
    }

    if (node.type === 'officialList') {
      const configuredSections = this.getNodeDataValue<unknown[]>(
        node,
        'sections'
      );
      const explicitSections =
        Array.isArray(configuredSections) && configuredSections.length > 0
          ? configuredSections
          : this.getNodeDataValue<unknown[]>(node, 'listSections');
      const rows = this.resolveOfficialOptions(node).map((option) => ({
        id: option.id,
        title: option.text,
        ...(option.description ? { description: option.description } : {}),
      }));
      const sections = this.normalizeOfficialListSections(
        explicitSections,
        rows,
        this.getNodeTextValue(node, 'sectionTitle', 'Opções')
      );

      if (sections.length === 0) {
        return null;
      }

      return this.withOfficialHeaderFooter(node, {
        type: 'list',
        body: { text: message },
        action: {
          button: this.getNodeTextValue(node, 'buttonText', 'Selecionar'),
          sections,
        },
      });
    }

    if (node.type === 'officialCtaUrl') {
      const displayText = await this.replaceVariables(
        t,
        this.getNodeTextValue(node, 'buttonText', 'Abrir'),
        createChat,
        createChat.user,
        createChat.sector
      );
      const url = await this.replaceVariables(
        t,
        this.getNodeTextValue(node, 'url'),
        createChat,
        createChat.user,
        createChat.sector
      );

      return this.withOfficialHeaderFooter(node, {
        type: 'cta_url',
        body: { text: message },
        action: {
          name: 'cta_url',
          parameters: {
            display_text: displayText.trim(),
            url: url.trim(),
          },
        },
      });
    }

    if (node.type === 'officialLocationRequest') {
      return {
        type: 'location_request_message',
        body: { text: message },
        action: {
          name: 'send_location',
        },
      };
    }

    if (node.type === 'officialFlow') {
      const parameters: Record<string, unknown> = {
        flow_message_version: '3',
        flow_token: this.getNodeTextValue(node, 'flowToken', uuidv7()),
        flow_cta: this.getNodeTextValue(node, 'buttonText', 'Abrir'),
        flow_action: this.getNodeTextValue(node, 'flowAction', 'navigate'),
      };
      const flowId = this.getNodeTextValue(node, 'flowId');
      const flowName = this.getNodeTextValue(node, 'flowName');
      if (flowId) parameters.flow_id = flowId;
      if (!flowId && flowName) parameters.flow_name = flowName;

      const actionPayload =
        this.getNodeDataValue<Record<string, unknown>>(
          node,
          'flowActionPayload'
        ) ?? this.getNodeDataValue<Record<string, unknown>>(node, 'payload');
      if (actionPayload) {
        parameters.flow_action_payload = actionPayload;
      }

      return this.withOfficialHeaderFooter(node, {
        type: 'flow',
        body: { text: message },
        action: {
          name: 'flow',
          parameters,
        },
      });
    }

    if (node.type === 'officialSingleProduct') {
      return this.withOfficialFooter(node, {
        type: 'product',
        body: message ? { text: message } : undefined,
        action: {
          catalog_id: this.getNodeTextValue(node, 'catalogId'),
          product_retailer_id: this.getNodeTextValue(node, 'productRetailerId'),
        },
      });
    }

    if (node.type === 'officialMultiProduct') {
      const explicitSections =
        this.getNodeDataValue<unknown[]>(node, 'sections') ?? [];
      const products = this.getNodeDataValue<unknown[]>(node, 'products') ?? [];
      const sections = this.normalizeProductSections(
        explicitSections,
        products,
        this.getNodeTextValue(node, 'sectionTitle', 'Produtos')
      );

      return this.withOfficialHeaderFooter(node, {
        type: 'product_list',
        body: { text: message },
        action: {
          catalog_id: this.getNodeTextValue(node, 'catalogId'),
          sections,
        },
      });
    }

    if (node.type === 'officialCatalog') {
      const parameters =
        this.getNodeDataValue<Record<string, unknown>>(node, 'parameters') ??
        {};
      return this.withOfficialHeaderFooter(node, {
        type: 'catalog_message',
        body: { text: message },
        action: {
          name: 'catalog_message',
          parameters,
        },
      });
    }

    if (node.type === 'officialMediaCarousel') {
      const cards = this.normalizeCarouselCards(
        this.getNodeDataValue<unknown[]>(node, 'cards') ?? []
      );

      return this.withOfficialHeaderFooter(node, {
        type: 'carousel',
        body: message ? { text: message } : undefined,
        action: {
          cards,
        },
      });
    }

    if (node.type === 'officialAddress') {
      return this.withOfficialHeaderFooter(node, {
        type: 'address_message',
        body: { text: message },
        action: this.buildAddressAction(node),
      });
    }

    return null;
  }

  private async sendOfficialInteractiveNode(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    node: ListChatbotFlowResponse['nodes'][number]
  ): Promise<boolean> {
    const interactive = await this.buildOfficialInteractivePayload(
      t,
      createChat,
      node
    );

    if (!interactive) {
      return false;
    }

    // Variables are resolved while the payload is built. Validate the final
    // value so dynamic content cannot exceed Meta's limits at send time.
    assertOfficialWhatsappInteractivePayload(interactive);

    const summary =
      this.getNodeTextValue(node, 'message') ||
      this.getNodeTextValue(node, 'text') ||
      node.data?.title ||
      node.label ||
      node.id;

    return this.sendMessageWithStatusGuard(t, {
      chat: createChat,
      accountId: createChat.account.id,
      type: EMessageType.official_interactive,
      message: summary,
      typeUser: ETypeUserChat.bot,
      officialInteractive: {
        type: String(interactive.type),
        interactive,
        summary,
      } as IOfficialWhatsappOutboundInteractiveMessage,
    });
  }

  private async sendOfficialAddressNode(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    node: ListChatbotFlowResponse['nodes'][number]
  ): Promise<boolean> {
    const country = this.getOfficialAddressCountry(node);
    if (this.isNativeOfficialAddressCountrySupported(country)) {
      return this.sendOfficialInteractiveNode(t, createChat, node);
    }

    const rawMessage =
      this.getNodeTextValue(node, 'message') ||
      this.getNodeTextValue(node, 'text') ||
      'Informe seu endereço';
    const message = await this.replaceVariables(
      t,
      rawMessage,
      createChat,
      createChat.user,
      createChat.sector
    );

    return this.sendMessageWithStatusGuard(t, {
      chat: createChat,
      accountId: createChat.account.id,
      type: EMessageType.text,
      message,
      typeUser: ETypeUserChat.bot,
    });
  }

  private buildPreparedOfficialMessage(
    createChat: IChat,
    type: EMessageType,
    message: string | null,
    content: Partial<NonNullable<IChatMessage['content']>>
  ): IChatMessage {
    const reactionTargetMessageId =
      type === EMessageType.react
        ? this.resolveLastMetaMessageId(createChat)
        : null;
    const executionMessageId = this.consumeNextExecutionMessageId(
      createChat.chat_id
    );
    const messageId = executionMessageId ?? uuidv7();
    const messageHash = executionMessageId
      ? uuidv5(`chatbot-execution-message-hash:${messageId}`, uuidv5.URL)
      : uuidv7();

    return {
      message_id: messageId,
      chat_id: createChat.chat_id,
      message_key: {
        remote_jid: createChat.message_key?.remote_jid ?? null,
        remote_jid_alt: createChat.message_key?.remote_jid_alt ?? null,
        id: reactionTargetMessageId,
        is_view_once: false,
      },
      type_user: ETypeUserChat.bot,
      account: createChat.account,
      worker: createChat.worker,
      user: createChat.user ?? null,
      phone: createChat.phone,
      summary: {
        is_sent: false,
        is_delivered: false,
        is_seen: false,
        is_sent_to_internal: true,
      },
      deleted: false,
      has_quoted: false,
      content: {
        type,
        message,
        ...content,
      },
      date: new Date().toISOString(),
      hash: messageHash,
    };
  }

  private resolveLastMetaMessageId(createChat: IChat): string | null {
    const candidates = [
      createChat.summary?.last_processed_message_id,
      createChat.summary?.last_message_id,
    ];

    return (
      candidates.find(
        (candidate): candidate is string =>
          typeof candidate === 'string' && candidate.startsWith('wamid.')
      ) ?? null
    );
  }

  private async sendOfficialPreparedNode(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    node: ListChatbotFlowResponse['nodes'][number]
  ): Promise<boolean> {
    const guardedChat = await this.getAutomationChatIfAllowed(createChat);
    if (!guardedChat) {
      return false;
    }

    if (node.type === 'officialTemplate') {
      const rawVariables =
        this.getNodeDataValue<IOfficialWhatsappTemplateMessage['variables']>(
          node,
          'templateVariables'
        ) ?? [];
      const variableScope = await this.buildOfficialTemplateVariableScope(
        t,
        guardedChat
      );
      const resolvedVariables = rawVariables.map((variable) => {
        const resolvedValue =
          typeof variable.value === 'string'
            ? resolveChatbotTemplate(variable.value, variableScope, {
                missingValue: 'error',
                arrayFormat: 'human',
              })
            : variable.value;
        return {
          ...variable,
          value: normalizeOfficialTemplateVariableValue(resolvedValue),
        };
      });
      const template: IOfficialWhatsappTemplateMessage = {
        name: this.getNodeTextValue(node, 'templateName').trim(),
        language: this.getNodeTextValue(
          node,
          'templateLanguage',
          'pt_BR'
        ).trim(),
        variables: resolvedVariables,
      };
      const templateCategory = this.getNodeTextValue(node, 'templateCategory');
      const templateParameterFormat = this.getNodeTextValue(
        node,
        'templateParameterFormat'
      ).toUpperCase();
      const templateComponents = this.getNodeDataValue<
        IOfficialWhatsappTemplateMessage['components']
      >(node, 'templateComponents');
      const templatePreview = this.getNodeDataValue<
        IOfficialWhatsappTemplateMessage['preview']
      >(node, 'templatePreview');

      if (templateCategory) {
        template.category = templateCategory;
      }
      if (
        templateParameterFormat === 'POSITIONAL' ||
        templateParameterFormat === 'NAMED'
      ) {
        template.parameter_format = templateParameterFormat;
      }
      if (Array.isArray(templateComponents) && templateComponents.length > 0) {
        template.components = templateComponents;
      }
      if (templatePreview && typeof templatePreview === 'object') {
        template.preview = templatePreview;
      }

      const previewText = this.officialWhatsappTemplateService.buildPreviewText(
        {
          id: null,
          name: template.name,
          language: template.language,
          status: 'APPROVED',
          parameter_format: template.parameter_format,
          category: template.category ?? null,
          components: template.components ?? [],
          variables:
            template.components?.flatMap((component) => [
              ...(component.variables ?? []),
              ...(component.buttons?.flatMap(
                (button) => button.variables ?? []
              ) ?? []),
            ]) ?? [],
          preview: template.preview ?? {},
        },
        resolvedVariables
      );

      return this.publishPreparedMessageWithAssignmentGuard(
        this.buildPreparedOfficialMessage(
          guardedChat,
          EMessageType.official_template,
          previewText,
          {
            official_template: template,
            official: {
              provider: 'meta_whatsapp',
              type: 'template',
              display: buildOfficialWhatsappDisplayFromTemplate(
                template,
                previewText
              ),
            },
          }
        )
      );
    }

    if (node.type === 'officialContacts') {
      const contacts =
        this.getNodeDataValue<IContactMessage[]>(node, 'contacts') ?? [];

      return this.publishPreparedMessageWithAssignmentGuard(
        this.buildPreparedOfficialMessage(
          guardedChat,
          contacts.length > 1
            ? EMessageType.contacts
            : EMessageType.contact_card,
          '[Contato]',
          {
            contact: contacts.length === 1 ? contacts[0] : null,
            contacts: contacts.length > 1 ? contacts : null,
          }
        )
      );
    }

    if (node.type === 'officialSticker') {
      const attachmentUrl = this.getNodeTextValue(node, 'attachmentUrl');
      const mimetype = this.getNodeTextValue(
        node,
        'attachmentMimetype',
        'image/webp'
      );

      return this.publishPreparedMessageWithAssignmentGuard(
        this.buildPreparedOfficialMessage(
          guardedChat,
          EMessageType.sticker,
          '[Figurinha]',
          {
            sticker: {
              url: attachmentUrl,
              mimetype,
              extension: mimetype.split('/')[1] || 'webp',
              size: 0,
            },
          }
        )
      );
    }

    if (node.type === 'officialReaction') {
      const emoji = this.getNodeTextValue(node, 'emoji', '👍');

      return this.publishPreparedMessageWithAssignmentGuard(
        this.buildPreparedOfficialMessage(
          guardedChat,
          EMessageType.react,
          emoji,
          {}
        )
      );
    }

    return false;
  }

  private async sendOfficialNode(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    node: ListChatbotFlowResponse['nodes'][number]
  ): Promise<boolean> {
    if (node.type === 'officialAddress') {
      return this.sendOfficialAddressNode(t, createChat, node);
    }

    if (
      node.type === 'officialReplyButtons' ||
      node.type === 'officialList' ||
      node.type === 'officialCtaUrl' ||
      node.type === 'officialLocationRequest' ||
      node.type === 'officialFlow' ||
      node.type === 'officialSingleProduct' ||
      node.type === 'officialMultiProduct' ||
      node.type === 'officialCatalog' ||
      node.type === 'officialMediaCarousel'
    ) {
      return this.sendOfficialInteractiveNode(t, createChat, node);
    }

    if (node.type === 'officialLocation') {
      const latitude = Number(this.getNodeDataValue(node, 'latitude'));
      const longitude = Number(this.getNodeDataValue(node, 'longitude'));
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return false;
      }

      return this.sendMessageWithStatusGuard(t, {
        chat: createChat,
        accountId: createChat.account.id,
        type: EMessageType.location,
        message: this.getNodeTextValue(node, 'message') || undefined,
        typeUser: ETypeUserChat.bot,
        latitude,
        longitude,
        name: this.getNodeTextValue(node, 'name') || null,
        address: this.getNodeTextValue(node, 'address') || null,
      });
    }

    return this.sendOfficialPreparedNode(t, createChat, node);
  }

  private isOfficialOptionNode(nodeType: string): boolean {
    return (
      isOfficialWaitForResponseNodeType(nodeType) &&
      (nodeType === 'officialReplyButtons' || nodeType === 'officialList')
    );
  }

  private isOfficialContinuationNode(nodeType: string): boolean {
    return (
      nodeType === 'officialCtaUrl' ||
      nodeType === 'officialSingleProduct' ||
      nodeType === 'officialMultiProduct' ||
      nodeType === 'officialCatalog' ||
      nodeType === 'officialMediaCarousel' ||
      nodeType === 'officialLocation' ||
      nodeType === 'officialContacts' ||
      nodeType === 'officialSticker' ||
      nodeType === 'officialReaction'
    );
  }

  private isOfficialAfterResponseNode(nodeType: string): boolean {
    return (
      nodeType === 'officialLocationRequest' ||
      nodeType === 'officialFlow' ||
      nodeType === 'officialAddress'
    );
  }

  private getOfficialInteractiveReplyId(data: IUpsertMessage): string | null {
    const official = data.content?.official;
    const interactive = official?.interactive;
    const id = interactive?.id?.trim();

    if (id) {
      return id;
    }

    const buttonPayload = official?.button?.payload?.trim();
    if (buttonPayload) {
      return buttonPayload;
    }

    return null;
  }

  private getOfficialInteractiveReplyTitle(
    data: IUpsertMessage
  ): string | null {
    const official = data.content?.official;
    const title =
      official?.interactive?.title?.trim() || official?.button?.text?.trim();

    if (title) {
      return title;
    }

    return this.getTextFromUpsertMessage(data)?.trim() || null;
  }

  private matchOfficialOption(
    data: IUpsertMessage,
    options: Array<{ id: string; text: string; description?: string | null }>
  ): { id: string; text: string; description?: string | null } | null {
    const replyId = this.getOfficialInteractiveReplyId(data);
    if (replyId) {
      const optionById = options.find((option) => option.id === replyId);
      if (optionById) {
        return optionById;
      }
    }

    const title = this.getOfficialInteractiveReplyTitle(data);
    if (!title) {
      return null;
    }

    const normalizedTitle = normalizeTextForConditionalComparison(title);
    return (
      options.find(
        (option) =>
          normalizeTextForConditionalComparison(option.text) ===
            normalizedTitle ||
          normalizeTextForConditionalComparison(option.id) === normalizedTitle
      ) ?? null
    );
  }

  private async processOfficialOptionNodeResponse(
    t: TFunction<'translation', undefined>,
    data: IUpsertMessage,
    createChat: IChat,
    chatbotFlow: ListChatbotFlowResponse,
    currentFlowId: string,
    options?: {
      customMessage?: string;
      redirectFailedAttempts?: {
        status?: string;
        quantity?: number;
        redirect_type?: string;
        selected_user?: string;
        selected_sector?: string;
        selected_sector_user?: string;
      };
      customMessages?: IChatbotCustomMessages;
    }
  ): Promise<boolean> {
    const currentNode = this.getFlowNodeById(chatbotFlow, currentFlowId);
    if (!currentNode) {
      throw new Error(t('chatbot_flow_node_not_found'));
    }

    const officialOptions = this.resolveOfficialOptions(currentNode);
    const selectedOption = this.matchOfficialOption(data, officialOptions);

    if (!selectedOption) {
      await this.sendTextOptionInvalidMessage(
        t,
        createChat,
        options?.customMessage,
        'menu',
        options?.customMessages?.invalid_menu_option_message_enabled
      );

      await this.sendOfficialNode(t, createChat, currentNode);

      if (
        !this.shouldRedirectOnFailedAttempt(
          options?.redirectFailedAttempts,
          createChat
        )
      ) {
        return false;
      }

      if (!options?.redirectFailedAttempts) {
        return false;
      }

      const quantity = options.redirectFailedAttempts.quantity ?? 1;
      const failedAttemptsCount =
        await this.incrementFailedAttempts(createChat);

      if (failedAttemptsCount < quantity) {
        return false;
      }

      await this.resetFailedAttempts(createChat);

      const { user, sector } = await this.getRedirectTargets(
        options.redirectFailedAttempts,
        createChat
      );

      await this.sendTransferMessageIfNeeded(
        t,
        createChat,
        options.redirectFailedAttempts.redirect_type,
        user,
        sector,
        options.customMessages,
        {
          transfer_message_user_enabled:
            options.customMessages?.transfer_message_user_enabled,
          transfer_message_sector_enabled:
            options.customMessages?.transfer_message_sector_enabled,
          transfer_message_sector_user_enabled:
            options.customMessages?.transfer_message_sector_user_enabled,
        }
      );

      await this.updateAndPublishChat(t, createChat, user, sector);
      return true;
    }

    const nextFlowId = this.getNextFlowIdByOption(
      chatbotFlow,
      currentFlowId,
      selectedOption.id,
      selectedOption.text
    );

    if (!nextFlowId) {
      throw new Error(t('chatbot_flow_not_found'));
    }

    await this.resetFailedAttempts(createChat);

    return this.processNextNode(
      t,
      createChat,
      chatbotFlow,
      nextFlowId,
      options?.customMessages,
      data
    );
  }

  private async processOfficialNodeType(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    chatbotFlow: ListChatbotFlowResponse,
    currentNode: ListChatbotFlowResponse['nodes'][number],
    currentFlowId: string,
    customMessages?: IChatbotCustomMessages,
    data?: IUpsertMessage
  ): Promise<boolean> {
    const messageSent = await this.sendOfficialNode(t, createChat, currentNode);
    if (!messageSent) {
      return false;
    }

    if (currentNode.type === 'officialTemplate') {
      await this.cancelInactivityCheck(createChat);
    }

    if (this.isOfficialOptionNode(currentNode.type)) {
      return true;
    }

    if (isOfficialWaitForResponseNodeType(currentNode.type)) {
      if (currentNode.type === 'officialTemplate') {
        const nextFlowId = this.getNextFlowId(chatbotFlow, currentFlowId);
        if (nextFlowId) {
          await this.persistOfficialTemplateResponsePending(
            createChat,
            currentNode.id,
            nextFlowId
          );
        }
      }

      return true;
    }

    const continueType = currentNode.data?.continueType;
    const shouldContinueAutomatically =
      // CTA URL buttons open a browser and do not produce a WhatsApp reply
      // webhook. Older saved flows may carry `after_response`; honoring it
      // leaves the execution parked forever after the CTA is sent.
      currentNode.type === 'officialCtaUrl' ||
      continueType === 'automatic' ||
      (!continueType && this.isOfficialContinuationNode(currentNode.type));
    const shouldContinueAfterResponse =
      currentNode.type !== 'officialCtaUrl' &&
      (continueType === 'after_response' ||
        (!continueType && this.isOfficialAfterResponseNode(currentNode.type)));

    const nextFlowId = this.getNextFlowId(chatbotFlow, currentFlowId);

    if (shouldContinueAutomatically) {
      if (nextFlowId) {
        await this.updateCache(createChat, nextFlowId);
        return this.processNextNode(
          t,
          createChat,
          chatbotFlow,
          nextFlowId,
          customMessages,
          data
        );
      }

      return true;
    }

    if (shouldContinueAfterResponse) {
      if (nextFlowId) {
        await this.updateCache(createChat, nextFlowId);
      }

      return true;
    }

    return true;
  }

  private async sendMessage(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    node: ListChatbotFlowResponse['nodes'][number]
  ): Promise<boolean> {
    const messageType = node.data?.messageType || 'text';
    const rawText = node.data?.text || node.data?.message || '';
    const text = await this.replaceVariables(
      t,
      rawText,
      createChat,
      createChat.user,
      createChat.sector
    );
    let attachmentUrl = node.data?.attachmentUrl;
    let attachmentMimetype = node.data?.attachmentMimetype;
    const attachmentDuration = node.data?.attachmentDuration;
    const attachmentWidth = node.data?.attachmentWidth;
    const attachmentHeight = node.data?.attachmentHeight;

    if (
      node.data?.attachmentSource === 'variable' &&
      node.data.attachmentVariable &&
      ['image', 'video', 'audio', 'document'].includes(messageType)
    ) {
      const context = await this.flowRuntimeContextService?.load({
        accountId: createChat.account.id,
        workerId: createChat.worker.id,
        chatId: createChat.chat_id,
      });
      if (!context || !this.flowRuntimeContextService) {
        throw new Error('chatbot API attachment context is unavailable');
      }
      if (!this.chatbotMediaMaterializerService) {
        throw new Error('chatbot API media materializer is unavailable');
      }
      const expression = node.data.attachmentVariable.includes('{{')
        ? node.data.attachmentVariable
        : `{{ ${node.data.attachmentVariable} }}`;
      const value = resolveChatbotTemplate(
        expression,
        this.flowRuntimeContextService.toVariableScope(context),
        { missingValue: 'error' }
      );
      const materialized =
        await this.chatbotMediaMaterializerService.materialize(value, {
          accountId: createChat.account.id,
          kind: messageType as 'image' | 'video' | 'audio' | 'document',
          fileName: node.data.attachmentFileName,
          mimetype: attachmentMimetype,
          isProduction: getChatbotApiOutboundHttpPolicy().isProduction,
          allowLocalhostHttp: false,
        });
      attachmentUrl = materialized.url;
      attachmentMimetype = materialized.mimetype;
    }

    if (messageType === 'image' && attachmentUrl) {
      return this.sendMessageWithStatusGuard(t, {
        chat: createChat,
        accountId: createChat.account.id,
        type: EMessageType.image,
        message: text || undefined,
        typeUser: ETypeUserChat.bot,
        imageUrl: attachmentUrl,
        imageMimetype: attachmentMimetype || undefined,
        imageWidth: attachmentWidth || undefined,
        imageHeight: attachmentHeight || undefined,
      });
    }

    if (messageType === 'video' && attachmentUrl) {
      return this.sendMessageWithStatusGuard(t, {
        chat: createChat,
        accountId: createChat.account.id,
        type: EMessageType.video,
        message: text || undefined,
        typeUser: ETypeUserChat.bot,
        videoUrl: attachmentUrl,
        videoMimetype: attachmentMimetype || undefined,
        videoDuration: attachmentDuration || undefined,
        videoWidth: attachmentWidth || undefined,
        videoHeight: attachmentHeight || undefined,
      });
    }

    if (messageType === 'audio' && attachmentUrl) {
      return this.sendMessageWithStatusGuard(t, {
        chat: createChat,
        accountId: createChat.account.id,
        type: EMessageType.audio,
        message: text || undefined,
        typeUser: ETypeUserChat.bot,
        audioUrl: attachmentUrl,
        audioMimetype: attachmentMimetype || undefined,
        audioDuration: attachmentDuration || undefined,
      });
    }

    if (messageType === 'document' && attachmentUrl) {
      return this.sendMessageWithStatusGuard(t, {
        chat: createChat,
        accountId: createChat.account.id,
        type: EMessageType.document,
        message: text || undefined,
        typeUser: ETypeUserChat.bot,
        documentUrl: attachmentUrl,
        documentMimetype: attachmentMimetype || undefined,
      });
    }

    return this.sendMessageWithStatusGuard(t, {
      chat: createChat,
      accountId: createChat.account.id,
      type: EMessageType.text,
      message: text,
      typeUser: ETypeUserChat.bot,
    });
  }

  private async resolveRandomMessageItemForNode(
    currentNode: ListChatbotFlowResponse['nodes'][number],
    accountId: string
  ): Promise<{
    message: string;
    type: string;
    attachment_url: string | null;
    mimetype: string | null;
    duration: number | null;
    width: number | null;
    height: number | null;
  } | null> {
    const randomMessageId = currentNode.data?.selectedRandomMessage as
      string | null | undefined;

    if (!randomMessageId || randomMessageId.trim().length === 0) {
      return null;
    }

    const randomMessage = await this.randomMessageService.viewRandomMessageById(
      randomMessageId,
      accountId
    );

    if (
      !randomMessage ||
      randomMessage.status !== ERandomMessageStatus.active
    ) {
      return null;
    }

    const randomMessageItems =
      await this.randomMessageService.listActiveRandomMessageItemsForRunner(
        randomMessageId,
        accountId
      );

    if (!randomMessageItems.length) {
      return null;
    }

    const selectedItemId = await this.pickNonRepeatedRandomMessageItemId(
      accountId,
      randomMessageId,
      randomMessageItems.map((item) => item.random_message_item_id)
    );

    if (!selectedItemId) {
      return null;
    }

    const selectedItem = randomMessageItems.find(
      (item) => item.random_message_item_id === selectedItemId
    );

    return selectedItem ?? null;
  }

  private async sendRandomMessageItem(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    item: {
      message: string;
      type: string;
      attachment_url: string | null;
      mimetype: string | null;
      duration: number | null;
      width: number | null;
      height: number | null;
    }
  ): Promise<boolean> {
    const messageTextRaw =
      item.type === EMessageType.audio ? '' : (item.message ?? '');
    const nickname = await this.getRandomMessageNicknameValue(createChat);
    const messageText = this.replaceRandomMessageNicknameTags(
      messageTextRaw,
      nickname
    );

    const nodeLike = {
      data: {
        messageType: item.type,
        text: messageText,
        attachmentUrl: item.attachment_url,
        attachmentMimetype: item.mimetype,
        attachmentDuration: item.duration,
        attachmentWidth: item.width,
        attachmentHeight: item.height,
      },
    } as ListChatbotFlowResponse['nodes'][number];

    return this.sendMessage(t, createChat, nodeLike);
  }

  private async processRandomMessageNodeType(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    chatbotFlow: ListChatbotFlowResponse,
    currentNode: ListChatbotFlowResponse['nodes'][number],
    currentFlowId: string,
    customMessages?: IChatbotCustomMessages,
    data?: IUpsertMessage
  ): Promise<boolean> {
    const continueType = currentNode.data?.continueType as
      'automatic' | 'after_response' | null | undefined;

    const randomMessageItem = await this.resolveRandomMessageItemForNode(
      currentNode,
      createChat.account.id
    );

    const nextFlowId = this.getNextFlowId(chatbotFlow, currentFlowId);

    if (!randomMessageItem) {
      if (!nextFlowId) {
        return true;
      }

      await this.updateCache(createChat, nextFlowId);
      return this.processNextNode(
        t,
        createChat,
        chatbotFlow,
        nextFlowId,
        customMessages,
        data
      );
    }

    const messageSent = await this.sendRandomMessageItem(
      t,
      createChat,
      randomMessageItem
    );
    if (!messageSent) {
      return false;
    }

    if (continueType === 'after_response') {
      if (nextFlowId) {
        await this.updateCache(createChat, nextFlowId);
      }

      return true;
    }

    if (!nextFlowId) {
      return true;
    }

    await this.updateCache(createChat, nextFlowId);
    return this.processNextNode(
      t,
      createChat,
      chatbotFlow,
      nextFlowId,
      customMessages,
      data
    );
  }

  private async sendBuildMenuMessage(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    node: ListChatbotFlowResponse['nodes'][number],
    useDebounce = false
  ): Promise<boolean> {
    if (useDebounce) {
      const nodeData = {
        message: node.data?.message || '',
        options: node.data?.options ?? [],
      };

      await this.setMenuDebounce(createChat, nodeData);

      this.scheduleMenuSend(t, createChat, nodeData);

      return true;
    }

    const rawBaseMessage = node.data?.message || '';
    const baseMessage = await this.replaceVariables(
      t,
      rawBaseMessage,
      createChat,
      createChat.user,
      createChat.sector
    );
    const options = node.data?.options ?? [];

    const menuMessage = this.buildMenuMessage(baseMessage, options);

    return this.sendMessageWithStatusGuard(t, {
      chat: createChat,
      accountId: createChat.account.id,
      type: EMessageType.text,
      message: menuMessage,
      typeUser: ETypeUserChat.bot,
    });
  }

  public async finishOutsideHoursChat(
    t: TFunction<'translation', undefined>,
    chat: IChat,
    message: string
  ): Promise<boolean> {
    const currentChat = await this.chatService.findChatByChatId(
      chat.account.id,
      chat.chat_id
    );
    if (!currentChat) {
      return false;
    }

    const outcome = await this.sendOutsideHoursFinishMessage(
      t,
      currentChat,
      message
    );

    const messageAllowed =
      currentChat.contact?.ignore !== EContactIgnore.ignore_automation &&
      currentChat.contact?.ignore !== EContactIgnore.ignore_totally;

    return outcome === 'not_owned' || messageAllowed;
  }

  private async sendOutsideHoursFinishMessage(
    t: TFunction<'translation', undefined>,
    activeChat: IChat,
    message: string
  ): Promise<TOutsideHoursFinishOutcome> {
    const pendingEffectKey = this.getPendingFinishEffectKey(
      activeChat.account.id,
      activeChat.worker.id,
      activeChat.chat_id
    );
    let existingTransition: IChatbotPendingFinishEffect | null = null;
    try {
      const existingPayload = await this.redis.get(pendingEffectKey);
      if (existingPayload) {
        existingTransition = JSON.parse(
          existingPayload
        ) as IChatbotPendingFinishEffect;
      }
    } catch {
      existingTransition = null;
    }

    const canReuseExistingTransition = Boolean(
      existingTransition?.source === 'outside_hours' &&
      existingTransition.phase === 'transition_pending' &&
      (this.isPendingTransitionOwnedByChat(existingTransition, activeChat) ||
        (activeChat.status === EChatStatus.closed &&
          existingTransition.statusEventId ===
            activeChat.meta?.status_event_id))
    );
    const statusEventId =
      (activeChat.status === EChatStatus.closed &&
      activeChat.meta?.status_source === 'outside_hours'
        ? activeChat.meta.status_event_id
        : undefined) ||
      (canReuseExistingTransition
        ? existingTransition?.statusEventId
        : undefined) ||
      uuidv7();
    const transitionEffect: IChatbotPendingFinishEffect = {
      accountId: activeChat.account.id,
      workerId: activeChat.worker.id,
      chatId: activeChat.chat_id,
      source: 'outside_hours',
      phase: 'transition_pending',
      statusEventId,
      expectedStatus: activeChat.status,
      expectedStatusEventId: activeChat.meta?.status_event_id ?? undefined,
      expectedStatusEpoch: activeChat.meta?.status_epoch ?? undefined,
      expectedStartedAt: activeChat.started_at ?? null,
      expectedLastMessageId: activeChat.summary?.last_message_id ?? null,
      customMessage: message,
      messageEnabled:
        activeChat.contact?.ignore !== EContactIgnore.ignore_automation &&
        activeChat.contact?.ignore !== EContactIgnore.ignore_totally,
      retryCount: canReuseExistingTransition
        ? (existingTransition?.retryCount ?? 0)
        : 0,
    };
    await this.persistPendingFinishEffect(transitionEffect);

    const lifecycleResult = await this.chatLifecycleService.finishChat({
      chat: activeChat,
      source: 'outside_hours',
      expectedStatuses: [activeChat.status],
      respectOutputChatbot: false,
      statusEventId,
    });
    if (lifecycleResult.outcome === 'retryable_failure') {
      return 'queued';
    }

    if (
      lifecycleResult.outcome === 'status_mismatch' ||
      lifecycleResult.targetStatus !== EChatStatus.closed
    ) {
      await this.removePendingFinishEffectByCacheKey(pendingEffectKey);
      return 'not_owned';
    }

    const ownsStatusEvent =
      lifecycleResult.outcome === 'applied' || lifecycleResult.ownedBySource;
    if (!ownsStatusEvent || !lifecycleResult.statusEventId) {
      await this.removePendingFinishEffectByCacheKey(pendingEffectKey);
      return 'not_owned';
    }

    const closedChat = lifecycleResult.chat;
    const effect: IChatbotPendingFinishEffect = {
      accountId: closedChat.account.id,
      workerId: closedChat.worker.id,
      chatId: closedChat.chat_id,
      source: 'outside_hours',
      phase: 'effects_pending',
      statusEventId: lifecycleResult.statusEventId,
      customMessage: transitionEffect.customMessage,
      messageEnabled: transitionEffect.messageEnabled,
      retryCount: 0,
    };
    await this.persistPendingFinishEffect(effect);
    await this.acknowledgeMigratedFinishEffect(pendingEffectKey, closedChat);

    try {
      await this.executePendingFinishEffect(t, effect, {
        accountId: effect.accountId,
        workerId: effect.workerId,
        chatId: effect.chatId,
      });
    } catch (error) {
      console.warn('[ChatbotFlow] outside-hours message queued for retry', {
        account_id: effect.accountId,
        chat_id: effect.chatId,
        status_event_id: effect.statusEventId,
        error: error instanceof Error ? error.message : String(error),
      });

      return 'queued';
    }

    return 'completed';
  }

  private async sendFinishMessage(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    customMessage?: string,
    enabled?: boolean,
    validatedRetrySnapshot?: IChat
  ): Promise<boolean> {
    const activeChat =
      validatedRetrySnapshot ??
      (await this.getAutomationChatIfAllowed(createChat, {
        allowClosedStatus: true,
      }));
    if (!activeChat) {
      return false;
    }

    if (
      validatedRetrySnapshot &&
      activeChat.status !== EChatStatus.closed &&
      !this.isAutomationChatStatus(activeChat.status)
    ) {
      return false;
    }

    const pendingEffectKey = this.getPendingFinishEffectKey(
      activeChat.account.id,
      activeChat.worker.id,
      activeChat.chat_id
    );
    let existingTransition: IChatbotPendingFinishEffect | null = null;
    try {
      const existingPayload = await this.redis.get(pendingEffectKey);
      if (existingPayload) {
        existingTransition = JSON.parse(
          existingPayload
        ) as IChatbotPendingFinishEffect;
      }
    } catch {
      existingTransition = null;
    }

    const canReuseExistingTransition = Boolean(
      existingTransition?.source === 'chatbot' &&
      existingTransition.phase === 'transition_pending' &&
      (this.isPendingTransitionOwnedByChat(existingTransition, activeChat) ||
        (activeChat.status === EChatStatus.closed &&
          existingTransition.statusEventId ===
            activeChat.meta?.status_event_id))
    );
    const statusEventId =
      (activeChat.status === EChatStatus.closed &&
      activeChat.meta?.status_source === 'chatbot'
        ? activeChat.meta.status_event_id
        : undefined) ||
      (canReuseExistingTransition
        ? existingTransition?.statusEventId
        : undefined) ||
      uuidv7();

    const transitionEffect: IChatbotPendingFinishEffect = {
      accountId: activeChat.account.id,
      workerId: activeChat.worker.id,
      chatId: activeChat.chat_id,
      source: 'chatbot',
      phase: 'transition_pending',
      statusEventId,
      expectedStatus: activeChat.status,
      expectedStatusEventId: activeChat.meta?.status_event_id ?? undefined,
      expectedStatusEpoch: activeChat.meta?.status_epoch ?? undefined,
      expectedStartedAt: activeChat.started_at ?? null,
      expectedLastMessageId: activeChat.summary?.last_message_id ?? null,
      customMessage,
      messageEnabled: enabled !== false,
      retryCount: canReuseExistingTransition
        ? (existingTransition?.retryCount ?? 0)
        : 0,
    };
    await this.persistPendingFinishEffect(transitionEffect);

    const lifecycleResult = await this.chatLifecycleService.finishChat({
      chat: activeChat,
      source: 'chatbot',
      expectedStatuses: Array.from(this.AUTOMATION_CHAT_STATUSES),
      respectOutputChatbot: false,
      statusEventId,
    });

    console.info('[ChatbotFlow] automatic finish transition', {
      account_id: activeChat.account.id,
      chat_id: activeChat.chat_id,
      source: 'chatbot',
      current_status: activeChat.status,
      target_status: lifecycleResult.targetStatus,
      outcome: lifecycleResult.outcome,
      status_event_id: lifecycleResult.statusEventId,
    });

    if (lifecycleResult.outcome === 'retryable_failure') {
      return false;
    }

    if (
      lifecycleResult.outcome === 'status_mismatch' ||
      lifecycleResult.targetStatus !== EChatStatus.closed
    ) {
      await this.removePendingFinishEffectByCacheKey(pendingEffectKey);
      return false;
    }

    const closedChat = lifecycleResult.chat;
    const shouldRunOwnedEffects =
      lifecycleResult.outcome === 'applied' || lifecycleResult.ownedBySource;
    if (!shouldRunOwnedEffects) {
      await this.removePendingFinishEffectByCacheKey(pendingEffectKey);
      await this.clearChatbotRuntimeStateByIds(
        closedChat.account.id,
        closedChat.worker.id,
        closedChat.chat_id
      );
      return true;
    }
    if (!lifecycleResult.statusEventId) {
      return false;
    }

    let messageSent = enabled === false;
    const pendingEffect: IChatbotPendingFinishEffect = {
      accountId: closedChat.account.id,
      workerId: closedChat.worker.id,
      chatId: closedChat.chat_id,
      source: 'chatbot',
      phase: 'effects_pending',
      statusEventId: lifecycleResult.statusEventId,
      customMessage,
      messageEnabled: enabled !== false,
      retryCount: 0,
    };
    await this.persistPendingFinishEffect(pendingEffect);
    await this.acknowledgeMigratedFinishEffect(pendingEffectKey, closedChat);

    if (enabled !== false) {
      try {
        const rawMessage = customMessage || t('chatbot_service_finished');
        const message = await this.replaceVariables(
          t,
          rawMessage,
          closedChat,
          closedChat.user,
          closedChat.sector
        );

        messageSent = await this.sendMessageWithStatusGuard(
          t,
          {
            chat: closedChat,
            accountId: closedChat.account.id,
            messageId: lifecycleResult.statusEventId,
            type: EMessageType.system,
            message,
            typeUser: ETypeUserChat.bot,
          },
          {
            allowClosedStatus: true,
            expectedStatusEventId: lifecycleResult.statusEventId,
          }
        );
      } catch (error) {
        console.error('[ChatbotFlow] immediate finish message failed', {
          account_id: closedChat.account.id,
          chat_id: closedChat.chat_id,
          status_event_id: lifecycleResult.statusEventId,
          error: error instanceof Error ? error.message : String(error),
        });
        messageSent = false;
      }
    }

    try {
      await this.clearChatbotRuntimeStateByIds(
        closedChat.account.id,
        closedChat.worker.id,
        closedChat.chat_id
      );
    } catch (error) {
      console.error('[ChatbotFlow] finish runtime cleanup failed', {
        account_id: closedChat.account.id,
        chat_id: closedChat.chat_id,
        status_event_id: lifecycleResult.statusEventId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (messageSent) {
      try {
        await this.removePendingFinishEffect(
          closedChat.account.id,
          closedChat.worker.id,
          closedChat.chat_id
        );
      } catch (error) {
        console.error('[ChatbotFlow] finish effect acknowledgement failed', {
          account_id: closedChat.account.id,
          chat_id: closedChat.chat_id,
          status_event_id: lifecycleResult.statusEventId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (enabled !== false && !messageSent) {
      console.warn('[ChatbotFlow] finish message queued for retry', {
        account_id: closedChat.account.id,
        chat_id: closedChat.chat_id,
        status_event_id: lifecycleResult.statusEventId,
      });
    }

    return true;
  }

  private async finishFlowOrThrow(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    customMessage?: string,
    enabled?: boolean
  ): Promise<true> {
    const finished = await this.sendFinishMessage(
      t,
      createChat,
      customMessage,
      enabled
    );
    if (!finished) {
      throw new Error('chatbot automatic finish was not confirmed');
    }

    return true;
  }

  private async cacheFirstChatbotFlowNodeIfNeeded(
    chatbotFlow: ListChatbotFlowResponse,
    createChat: IChat,
    runtimeContext?: ChatbotFlowRuntimeContext
  ): Promise<string | null> {
    const cacheKey = this.getChatbotFlowCacheKey(
      createChat.account.id,
      createChat.worker.id,
      createChat.chat_id
    );

    const alreadyCached = await this.redis.get(cacheKey);
    if (alreadyCached) {
      if (runtimeContext && this.flowRuntimeContextService) {
        await this.flowRuntimeContextService.persistTransition({
          accountId: createChat.account.id,
          workerId: createChat.worker.id,
          chatId: createChat.chat_id,
          nextNodeId: alreadyCached,
          context: runtimeContext,
        });
      }
      return alreadyCached;
    }

    const startNode = chatbotFlow.nodes.find((node) => node.type === 'start');
    if (!startNode) {
      return null;
    }

    if (runtimeContext && this.flowRuntimeContextService) {
      await this.flowRuntimeContextService.persistTransition({
        accountId: createChat.account.id,
        workerId: createChat.worker.id,
        chatId: createChat.chat_id,
        nextNodeId: startNode.id,
        context: runtimeContext,
      });
    } else {
      await this.redis.set(
        cacheKey,
        startNode.id,
        'EX',
        this.CHATBOT_FLOW_NODE_CACHE_TTL_SECONDS
      );
    }

    return startNode.id;
  }

  private async loadPinnedChatbotFlow(
    createChat: IChat,
    chatbotId: string
  ): Promise<{
    chatbotFlow: ListChatbotFlowResponse | null;
    runtimeContext?: ChatbotFlowRuntimeContext;
  }> {
    if (!this.flowRuntimeContextService) {
      return {
        chatbotFlow: await this.chatbotService.findChatbotFlowByChatbotId(
          createChat.account.id,
          chatbotId
        ),
      };
    }

    const persistedContext = await this.flowRuntimeContextService.load({
      accountId: createChat.account.id,
      workerId: createChat.worker.id,
      chatId: createChat.chat_id,
    });

    if (persistedContext?.chatbotId === chatbotId) {
      const pinnedFlow = await this.chatbotService.findChatbotFlowById(
        createChat.account.id,
        chatbotId,
        persistedContext.flowId
      );
      if (pinnedFlow) {
        return { chatbotFlow: pinnedFlow, runtimeContext: persistedContext };
      }

      await this.clearChatbotRuntimeStateByIds(
        createChat.account.id,
        createChat.worker.id,
        createChat.chat_id
      );
    }

    const latestFlow = await this.chatbotService.findChatbotFlowByChatbotId(
      createChat.account.id,
      chatbotId
    );
    if (!latestFlow) {
      return { chatbotFlow: null };
    }

    return {
      chatbotFlow: latestFlow,
      runtimeContext: this.flowRuntimeContextService.create(
        chatbotId,
        latestFlow.chatbot_flow_id
      ),
    };
  }

  private async updateCache(
    createChat: IChat,
    nextFlowId: string
  ): Promise<void> {
    const cacheKey = this.getChatbotFlowCacheKey(
      createChat.account.id,
      createChat.worker.id,
      createChat.chat_id
    );
    await this.redis.set(
      cacheKey,
      nextFlowId,
      'EX',
      this.CHATBOT_FLOW_NODE_CACHE_TTL_SECONDS
    );
  }

  private getNodeCaptureOutputKey(
    chatbotFlow: ListChatbotFlowResponse,
    node: ListChatbotFlowResponse['nodes'][number]
  ): string | null {
    const captureType =
      node.type === 'data'
        ? 'data'
        : node.type === 'message' &&
            node.data?.continueType === 'after_response'
          ? 'message'
          : null;
    if (!captureType) return null;

    const configuredKey = node.data?.outputKey;
    if (
      typeof configuredKey === 'string' &&
      new RegExp(`^${captureType}_[1-9]\\d*$`, 'u').test(configuredKey)
    ) {
      return configuredKey;
    }

    const legacyIndex = chatbotFlow.nodes
      .filter((candidate) => candidate.type === captureType)
      .findIndex((candidate) => candidate.id === node.id);
    return legacyIndex >= 0 ? `${captureType}_${legacyIndex + 1}` : null;
  }

  private async persistRuntimeTransition(
    createChat: IChat,
    chatbotFlow: ListChatbotFlowResponse,
    nextNodeId: string,
    capturedOutput?: {
      outputKey: string;
      value: ChatbotNodeRuntimeCapture;
    }
  ): Promise<void> {
    const contextService = this.flowRuntimeContextService;
    if (!contextService) {
      await this.updateCache(createChat, nextNodeId);
      return;
    }

    let context =
      (await contextService.load({
        accountId: createChat.account.id,
        workerId: createChat.worker.id,
        chatId: createChat.chat_id,
      })) ??
      contextService.create(
        chatbotFlow.chatbot_id,
        chatbotFlow.chatbot_flow_id
      );
    if (capturedOutput) {
      context = contextService.withCapture(
        context,
        capturedOutput.outputKey,
        capturedOutput.value
      );
    }
    await contextService.persistTransition({
      accountId: createChat.account.id,
      workerId: createChat.worker.id,
      chatId: createChat.chat_id,
      nextNodeId,
      context,
    });
  }

  private consumeAutomaticExecutionBudget(
    chatId: string,
    kind: 'transition' | 'api',
    amount = 1
  ): void {
    const budget = this.automaticExecutionBudgetByChatId.get(chatId) ?? {
      transitions: 0,
      apiNodes: 0,
      httpAttempts: 0,
    };
    if (kind === 'transition') budget.transitions += amount;
    if (kind === 'api') budget.apiNodes += amount;
    if (budget.transitions > 50) {
      throw new Error('chatbot automatic transition limit exceeded');
    }
    if (budget.apiNodes > 10) {
      throw new Error('chatbot API node limit exceeded');
    }
    this.automaticExecutionBudgetByChatId.set(chatId, budget);
  }

  private consumeHttpAttemptBudget(chatId: string, attempts: number): void {
    const budget = this.automaticExecutionBudgetByChatId.get(chatId) ?? {
      transitions: 0,
      apiNodes: 0,
      httpAttempts: 0,
    };
    budget.httpAttempts += Math.max(0, attempts);
    if (budget.httpAttempts > 30) {
      throw new Error('chatbot HTTP attempt limit exceeded');
    }
    this.automaticExecutionBudgetByChatId.set(chatId, budget);
  }

  private remainingHttpAttemptBudget(chatId: string): number {
    const used =
      this.automaticExecutionBudgetByChatId.get(chatId)?.httpAttempts ?? 0;
    return Math.max(0, 30 - used);
  }

  private async buildApiRuntimeVariableScope(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    context: ChatbotFlowRuntimeContext,
    data?: IUpsertMessage
  ): Promise<Record<string, unknown>> {
    const builtIns = await this.buildChatbotBuiltInVariableScope(
      t,
      createChat,
      data
    );
    return (
      this.flowRuntimeContextService?.toVariableScope(context, builtIns) ??
      builtIns
    );
  }

  private async buildOfficialTemplateVariableScope(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    data?: IUpsertMessage
  ): Promise<Record<string, unknown>> {
    const builtIns = await this.buildChatbotBuiltInVariableScope(
      t,
      createChat,
      data
    );
    if (
      !this.flowRuntimeContextService ||
      typeof this.flowRuntimeContextService.load !== 'function' ||
      typeof this.flowRuntimeContextService.toVariableScope !== 'function'
    ) {
      return builtIns;
    }

    const context = await this.flowRuntimeContextService.load({
      accountId: createChat.account.id,
      workerId: createChat.worker.id,
      chatId: createChat.chat_id,
    });
    return context
      ? this.flowRuntimeContextService.toVariableScope(context, builtIns)
      : builtIns;
  }

  private async buildChatbotBuiltInVariableScope(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    data?: IUpsertMessage
  ): Promise<Record<string, unknown>> {
    const contactName = await this.getContactName(createChat);
    const name = contactName || createChat.name || '';
    const builtIns: Record<string, unknown> = {
      greeting: this.getGreeting(t),
      name,
      contact_name: name,
      protocol: generateProtocol(),
      sector: createChat.sector?.name ?? '',
      user: createChat.user?.name ?? '',
      account_name: createChat.account?.name ?? '',
      phone: createChat.phone ?? '',
      channel_name: createChat.worker?.name ?? '',
      date: new Date().toLocaleDateString('pt-BR'),
      time: new Date().toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
      }),
      message: data ? (this.getTextFromUpsertMessage(data) ?? '') : '',
    };
    return builtIns;
  }

  private protectHolidayRuntimePlaceholders(template: string): {
    template: string;
    restore: (value: unknown) => unknown;
  } {
    let tokenPrefix = '\uE000underchat-holiday-placeholder-';
    while (template.includes(tokenPrefix)) {
      tokenPrefix += '_';
    }

    const placeholders: Array<{ token: string; value: string }> = [];
    const protectedTemplate = template.replace(
      /\{\{\s*holiday_(?:names|tags)\s*\}\}/giu,
      (value) => {
        const token = `${tokenPrefix}${placeholders.length}\uE001`;
        placeholders.push({ token, value });
        return token;
      }
    );

    return {
      template: protectedTemplate,
      restore: (value: unknown): unknown => {
        if (typeof value !== 'string') return value;
        return placeholders.reduce(
          (restored, placeholder) =>
            restored.replaceAll(placeholder.token, placeholder.value),
          value
        );
      },
    };
  }

  private async resolveCompatibleNodeVariables(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    node: ListChatbotFlowResponse['nodes'][number],
    data?: IUpsertMessage
  ): Promise<void> {
    if (!this.flowRuntimeContextService) return;
    const context = await this.flowRuntimeContextService.load({
      accountId: createChat.account.id,
      workerId: createChat.worker.id,
      chatId: createChat.chat_id,
    });
    if (
      !context ||
      (Object.keys(context.outputs).length === 0 &&
        Object.keys(context.captures ?? {}).length === 0 &&
        Object.keys(context.lookups ?? {}).length === 0)
    ) {
      return;
    }
    const scope = await this.buildApiRuntimeVariableScope(
      t,
      createChat,
      context,
      data
    );
    const resolveValue = (value: unknown, key?: string): unknown => {
      if (
        key === 'apiRequest' ||
        key === 'underchatLookup' ||
        key === 'attachmentVariable' ||
        key === 'conditionalVariable' ||
        key === 'id' ||
        key === 'ciphertext' ||
        key === 'proof'
      ) {
        return value;
      }
      if (typeof value === 'string' && value.includes('{{')) {
        const protectedHolidayTemplate =
          node.type === 'holiday' && key === 'holidayMessage'
            ? this.protectHolidayRuntimePlaceholders(value)
            : null;
        const resolved = resolveChatbotTemplate(
          protectedHolidayTemplate?.template ?? value,
          scope,
          {
            missingValue: 'error',
            arrayFormat:
              key && this.HUMAN_TEMPLATE_FIELDS.has(key) ? 'human' : 'json',
          }
        );
        const formatted =
          key && this.HUMAN_TEMPLATE_FIELDS.has(key)
            ? this.formatResolvedHumanValue(resolved)
            : resolved;
        return protectedHolidayTemplate?.restore(formatted) ?? formatted;
      }
      if (Array.isArray(value)) {
        return value.map((entry) => resolveValue(entry));
      }
      if (value && typeof value === 'object') {
        return Object.fromEntries(
          Object.entries(value).map(([entryKey, entry]) => [
            entryKey,
            resolveValue(entry, entryKey),
          ])
        );
      }
      return value;
    };
    node.data = resolveValue(node.data) as typeof node.data;
  }

  private formatResolvedHumanValue(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
      return value
        .map((entry) =>
          entry && typeof entry === 'object'
            ? JSON.stringify(entry)
            : String(entry ?? '')
        )
        .join(', ');
    }
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  private safeApiRequestOrigin(url: string): string {
    try {
      const parsed = new URL(url.replaceAll(/\{\{[^{}]+\}\}/gu, 'value'));
      return `${parsed.protocol}//${parsed.host}`;
    } catch {
      return 'invalid-origin';
    }
  }

  private async materializeApiBinaryOutput(
    createChat: IChat,
    body: unknown,
    response: {
      contentType: string | null;
      headers: Readonly<Record<string, string | readonly string[]>>;
    }
  ): Promise<unknown> {
    if (!Buffer.isBuffer(body) && !(body instanceof Uint8Array)) return body;
    if (!this.chatbotMediaMaterializerService) {
      throw new Error('chatbot API media materializer is unavailable');
    }
    const disposition = response.headers['content-disposition'];
    const dispositionValue =
      typeof disposition === 'string' ? disposition : disposition?.[0];
    const fileName = /filename\s*=\s*"([^"]+)"/iu.exec(
      dispositionValue ?? ''
    )?.[1];
    return this.chatbotMediaMaterializerService.materialize(body, {
      accountId: createChat.account.id,
      kind: 'document',
      fileName,
      mimetype: response.contentType ?? undefined,
      ...getChatbotApiOutboundHttpPolicy(),
    });
  }

  private async hydrateMultipartFileUrls(
    config: ApiRequestConfig,
    variables: Readonly<Record<string, unknown>>,
    createChat: IChat
  ): Promise<ApiRequestConfig> {
    if (config.body.type !== 'multipart') return config;
    const next = decryptApiRequestSecrets(
      config,
      this.apiRequestSecretEncryptor
    );
    for (const part of next.body.multipart) {
      if (!part.enabled || part.type !== 'file') continue;
      const resolved = resolveChatbotTemplate(part.value ?? '', variables, {
        missingValue: 'error',
      });
      const url =
        typeof resolved === 'string' && /^https?:\/\//iu.test(resolved.trim())
          ? resolved.trim()
          : resolved &&
              typeof resolved === 'object' &&
              typeof (resolved as Record<string, unknown>).url === 'string'
            ? String((resolved as Record<string, unknown>).url)
            : null;
      if (!url) continue;
      if (this.remainingHttpAttemptBudget(createChat.chat_id) < 1) {
        part.value = '{{ __multipart_file_attempt_budget_exhausted__ }}';
        continue;
      }
      const response = await executeSafeOutboundHttp({
        url,
        method: 'GET',
        ...getChatbotApiOutboundHttpPolicy(),
      });
      this.consumeHttpAttemptBudget(createChat.chat_id, 1);
      if (
        response.kind !== 'response' ||
        response.statusCode < 200 ||
        response.statusCode >= 300
      ) {
        part.value = '{{ __multipart_file_download_failed__ }}';
        continue;
      }
      const contentType = response.headers['content-type'];
      const mimetype = (
        typeof contentType === 'string' ? contentType : contentType?.[0]
      )?.split(';')[0];
      part.value = `data:${mimetype || 'application/octet-stream'};base64,${response.body.toString('base64')}`;
      part.hasValue = true;
      part.sensitive = false;
      if (!part.contentType && mimetype) part.contentType = mimetype;
      const disposition = response.headers['content-disposition'];
      const dispositionValue =
        typeof disposition === 'string' ? disposition : disposition?.[0];
      const responseFileName = /filename\s*=\s*"([^"]+)"/iu.exec(
        dispositionValue ?? ''
      )?.[1];
      if (!part.fileName && responseFileName) part.fileName = responseFileName;
    }
    return next;
  }

  private async processApiRequestNode(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    chatbotFlow: ListChatbotFlowResponse,
    node: ListChatbotFlowResponse['nodes'][number],
    customMessages?: IChatbotCustomMessages,
    data?: IUpsertMessage
  ): Promise<boolean> {
    const config = node.data.apiRequest;
    const contextService = this.flowRuntimeContextService;
    if (!config || !contextService) return false;

    this.consumeAutomaticExecutionBudget(createChat.chat_id, 'api');
    let context =
      (await contextService.load({
        accountId: createChat.account.id,
        workerId: createChat.worker.id,
        chatId: createChat.chat_id,
      })) ??
      contextService.create(
        chatbotFlow.chatbot_id,
        chatbotFlow.chatbot_flow_id
      );

    const previousInvocation = context.invocations[node.id];
    if (previousInvocation?.status === 'started') {
      context = contextService.withInvocation(context, node.id, {
        ...previousInvocation,
        status: 'indeterminate',
        completedAt: new Date().toISOString(),
      });
      const failureNodeId = this.getNextFlowIdByApiOutcome(
        chatbotFlow,
        node.id,
        'failure'
      );
      if (!failureNodeId) return false;
      await contextService.persistTransition({
        accountId: createChat.account.id,
        workerId: createChat.worker.id,
        chatId: createChat.chat_id,
        nextNodeId: failureNodeId,
        context,
      });
      return this.processNextNode(
        t,
        createChat,
        chatbotFlow,
        failureNodeId,
        customMessages,
        data
      );
    }

    const invocationId = uuidv7();
    const startedAt = new Date().toISOString();
    context = contextService.withInvocation(context, node.id, {
      invocationId,
      status: 'started',
      startedAt,
    });
    await contextService.persistTransition({
      accountId: createChat.account.id,
      workerId: createChat.worker.id,
      chatId: createChat.chat_id,
      nextNodeId: node.id,
      context,
    });

    const variables = await this.buildApiRuntimeVariableScope(
      t,
      createChat,
      context,
      data
    );
    const idempotentConfig: ApiRequestConfig =
      (config.method === 'POST' || config.method === 'PATCH') &&
      config.execution.retry.maxAttempts > 1 &&
      !config.execution.idempotencyKey
        ? {
            ...config,
            execution: {
              ...config.execution,
              idempotencyKey: invocationId,
            },
          }
        : config;
    const executionConfig = await this.hydrateMultipartFileUrls(
      idempotentConfig,
      variables,
      createChat
    );
    const result = await this.apiRequestExecutor.execute({
      config: executionConfig,
      variables,
      ...getChatbotApiOutboundHttpPolicy(),
      maxHttpAttempts: this.remainingHttpAttemptBudget(createChat.chat_id),
    });
    const attempts = result.items.reduce(
      (total, item) => total + item.response.attempts,
      0
    );
    this.consumeHttpAttemptBudget(createChat.chat_id, attempts);

    const runtimeBody =
      result.mode === 'once'
        ? await this.materializeApiBinaryOutput(
            createChat,
            result.body,
            result.response
          )
        : await Promise.all(
            result.items.map((item) =>
              this.materializeApiBinaryOutput(
                createChat,
                item.body,
                item.response
              )
            )
          );

    context = contextService.withInvocation(context, node.id, {
      invocationId,
      status: 'completed',
      startedAt,
      completedAt: new Date().toISOString(),
    });
    let runtimeOk = result.ok;
    let runtimeResponse:
      ChatbotApiResponseMetadata | readonly ChatbotApiResponseMetadata[] =
      result.response;
    let completedContext = contextService.withOutput(
      context,
      result.outputKey,
      {
        body: runtimeBody,
        response: runtimeResponse,
      }
    );
    try {
      contextService.serialize(completedContext);
    } catch {
      runtimeOk = false;
      const compactFailure = (
        metadata: ChatbotApiResponseMetadata
      ): ChatbotApiResponseMetadata => ({
        ...metadata,
        ok: false,
        error: {
          code: 'context_too_large',
          message: 'API response exceeds the chatbot context limit',
          retryable: false,
        },
      });
      runtimeResponse =
        result.mode === 'forEach'
          ? result.response.map(compactFailure)
          : compactFailure(result.response);
      completedContext = contextService.withOutput(context, result.outputKey, {
        body: null,
        response: runtimeResponse,
      });
    }
    context = completedContext;
    const outcome = runtimeOk ? 'success' : 'failure';
    const nextNodeId = this.getNextFlowIdByApiOutcome(
      chatbotFlow,
      node.id,
      outcome
    );
    if (!nextNodeId) return false;

    const metadata = Array.isArray(result.response)
      ? result.response[result.response.length - 1]
      : result.response;
    console.info('[ChatbotApiRequest]', {
      account_id: createChat.account.id,
      chatbot_id: chatbotFlow.chatbot_id,
      node_id: node.id,
      origin: this.safeApiRequestOrigin(config.url),
      status: metadata?.status ?? null,
      duration_ms: result.durationMs,
      attempts,
      bytes: result.items.reduce(
        (total, item) => total + item.response.sizeBytes,
        0
      ),
      code: metadata?.error?.code ?? null,
    });
    await contextService.persistTransition({
      accountId: createChat.account.id,
      workerId: createChat.worker.id,
      chatId: createChat.chat_id,
      nextNodeId,
      context,
    });
    return this.processNextNode(
      t,
      createChat,
      chatbotFlow,
      nextNodeId,
      customMessages,
      data
    );
  }

  private async processUnderchatNode(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    chatbotFlow: ListChatbotFlowResponse,
    node: ListChatbotFlowResponse['nodes'][number],
    customMessages?: IChatbotCustomMessages,
    data?: IUpsertMessage
  ): Promise<boolean> {
    const config = node.data.underchatLookup as
      UnderchatLookupConfig | undefined;
    const outputKey = node.data.outputKey;
    const contextService = this.flowRuntimeContextService;
    const lookupService = this.underchatUserLookupService;
    if (
      config?.version !== 1 ||
      (config.lookupType !== 'email' && config.lookupType !== 'document') ||
      typeof config.lookupExpression !== 'string' ||
      typeof outputKey !== 'string' ||
      !/^underchat_[1-9]\d*$/u.test(outputKey)
    ) {
      throw new Error('Underchat lookup node configuration is invalid');
    }
    if (!contextService || !lookupService) {
      throw new Error('Underchat lookup runtime is unavailable');
    }

    let context =
      (await contextService.load({
        accountId: createChat.account.id,
        workerId: createChat.worker.id,
        chatId: createChat.chat_id,
      })) ??
      contextService.create(
        chatbotFlow.chatbot_id,
        chatbotFlow.chatbot_flow_id
      );
    const variables = await this.buildApiRuntimeVariableScope(
      t,
      createChat,
      context,
      data
    );
    const resolvedValue = resolveChatbotTemplate(
      config.lookupExpression,
      variables,
      { missingValue: 'error' }
    );
    if (
      resolvedValue !== null &&
      resolvedValue !== undefined &&
      typeof resolvedValue !== 'string'
    ) {
      throw new Error('Underchat lookup expression must resolve to text');
    }

    const output = await lookupService.lookup({
      lookupType: config.lookupType,
      value: resolvedValue?.trim() ?? '',
    });
    context = contextService.withLookup(context, outputKey, output);

    const outcome = output.found ? 'found' : 'not_found';
    const nextNodeId = this.getNextFlowIdByUnderchatOutcome(
      chatbotFlow,
      node.id,
      outcome
    );
    if (!nextNodeId) {
      throw new Error(`Underchat lookup branch "${outcome}" is not connected`);
    }

    await contextService.persistTransition({
      accountId: createChat.account.id,
      workerId: createChat.worker.id,
      chatId: createChat.chat_id,
      nextNodeId,
      context,
    });
    return this.processNextNode(
      t,
      createChat,
      chatbotFlow,
      nextNodeId,
      customMessages,
      data
    );
  }

  private async persistOfficialTemplateResponsePending(
    createChat: IChat,
    templateNodeId: string,
    nextFlowId: string
  ): Promise<void> {
    const flowCacheKey = this.getChatbotFlowCacheKey(
      createChat.account.id,
      createChat.worker.id,
      createChat.chat_id
    );
    const pendingCacheKey = this.getOfficialResponsePendingCacheKey(
      createChat.account.id,
      createChat.worker.id,
      createChat.chat_id
    );
    const pending: IChatbotOfficialResponsePending = {
      templateNodeId,
      nextFlowId,
    };
    const results = await this.redis
      .multi()
      .set(
        flowCacheKey,
        nextFlowId,
        'EX',
        this.CHATBOT_FLOW_NODE_CACHE_TTL_SECONDS
      )
      .set(
        pendingCacheKey,
        JSON.stringify(pending),
        'EX',
        this.CHATBOT_FLOW_NODE_CACHE_TTL_SECONDS
      )
      .exec();

    this.assertRedisTransaction(
      results,
      'persist official template response pending'
    );
  }

  private parseOfficialTemplateResponsePending(
    value: string | null
  ): IChatbotOfficialResponsePending | null {
    if (!value) {
      return null;
    }

    try {
      const parsed: unknown = JSON.parse(value);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return null;
      }

      const { templateNodeId, nextFlowId } = parsed as Record<string, unknown>;
      if (
        typeof templateNodeId !== 'string' ||
        templateNodeId.trim().length === 0 ||
        typeof nextFlowId !== 'string' ||
        nextFlowId.trim().length === 0
      ) {
        return null;
      }

      return { templateNodeId, nextFlowId };
    } catch {
      return null;
    }
  }

  private isOfficialTemplateResponsePendingValid(
    chatbotFlow: ListChatbotFlowResponse,
    currentFlowId: string,
    pending: IChatbotOfficialResponsePending
  ): boolean {
    if (currentFlowId !== pending.nextFlowId) {
      return false;
    }

    const templateNode = this.getFlowNodeById(
      chatbotFlow,
      pending.templateNodeId
    );
    if (templateNode?.type !== 'officialTemplate') {
      return false;
    }

    if (!this.getFlowNodeById(chatbotFlow, pending.nextFlowId)) {
      return false;
    }

    return (
      this.getNextFlowId(chatbotFlow, pending.templateNodeId) ===
      pending.nextFlowId
    );
  }

  private async resumeOfficialTemplateResponsePendingIfNeeded(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    chatbotFlow: ListChatbotFlowResponse,
    currentFlowId: string,
    customMessages?: IChatbotCustomMessages
  ): Promise<boolean | null> {
    const pendingCacheKey = this.getOfficialResponsePendingCacheKey(
      createChat.account.id,
      createChat.worker.id,
      createChat.chat_id
    );
    const cachedPending = await this.redis.get(pendingCacheKey);
    const pending = this.parseOfficialTemplateResponsePending(cachedPending);

    if (
      !pending ||
      !this.isOfficialTemplateResponsePendingValid(
        chatbotFlow,
        currentFlowId,
        pending
      )
    ) {
      if (cachedPending) {
        await this.redis.del(pendingCacheKey);
      }

      return null;
    }

    const processed = await this.processNextNode(
      t,
      createChat,
      chatbotFlow,
      pending.nextFlowId,
      customMessages
    );
    if (
      processed &&
      (await this.redis.get(pendingCacheKey)) === cachedPending
    ) {
      await this.redis.del(pendingCacheKey);
    }

    return processed;
  }

  async clearFlowCacheForChat(
    accountId: string,
    workerId: string,
    chatId: string
  ): Promise<void> {
    await this.clearChatbotRuntimeStateByIds(accountId, workerId, chatId);
  }

  async bootstrapTransferredChatbot(
    t: TFunction<'translation', undefined>,
    chat: IChat,
    chatbotId: string,
    operationId: string,
    sourceWorkerIds: string[] = [],
    runtimeAlreadyCleared = false,
    executionGuard?: {
      expectedAssignmentEventId: string;
      expectedLastMessageId: string | null;
    }
  ): Promise<void> {
    const bootstrapKey = [
      'underchat',
      'chatbot-transfer-bootstrap',
      chat.account.id,
      chat.chat_id,
      operationId,
    ].join(':');
    const bootstrapState = await this.redis.get(bootstrapKey);
    if (bootstrapState === 'completed') {
      return;
    }

    if (!bootstrapState) {
      if (runtimeAlreadyCleared) {
        const currentFlowId = await this.redis.get(
          this.getChatbotFlowCacheKey(
            chat.account.id,
            chat.worker.id,
            chat.chat_id
          )
        );
        if (currentFlowId) {
          await this.redis.set(bootstrapKey, 'completed', 'EX', 604_800);
          return;
        }
      } else {
        const workerIds = new Set([...sourceWorkerIds, chat.worker.id]);
        await Promise.all(
          Array.from(workerIds).map((workerId) =>
            this.clearChatbotRuntimeStateByIds(
              chat.account.id,
              workerId,
              chat.chat_id
            )
          )
        );
      }
      await this.redis.set(bootstrapKey, 'started', 'EX', 604_800);
    }

    const now = Date.now();
    const result = await this.execute(
      t,
      {
        account_id: chat.account.id,
        worker_id: chat.worker.id,
        type: EMessageType.text,
        message: {
          key: {
            id: `chatbot_transfer_bootstrap_${operationId}`,
            remoteJid: chat.message_key?.remote_jid ?? undefined,
            remoteJidAlt: chat.message_key?.remote_jid_alt ?? undefined,
            fromMe: true,
          },
          message: { conversation: '' },
          messageTimestamp: Math.floor(now / 1000),
        },
        has_quoted: false,
        is_call_event: false,
      },
      chat,
      chatbotId,
      undefined,
      {
        requireHandled: true,
        executionId: operationId,
        ...executionGuard,
      }
    );
    if (!result) {
      throw new Error('chatbot bootstrap effect was not confirmed');
    }

    await this.redis.set(bootstrapKey, 'completed', 'EX', 604_800);
  }

  private getQuestionTextForDataType(
    node: ListChatbotFlowResponse['nodes'][number]
  ): string {
    const dataType = node.data?.dataType;

    if (dataType === 'name') {
      return node.data?.firstName || '';
    }

    if (dataType === 'lastname') {
      return node.data?.lastName || '';
    }

    if (dataType === 'email') {
      return node.data?.email || '';
    }

    if (dataType === 'cpf') {
      return node.data?.cpf || '';
    }

    if (dataType === 'cnpj') {
      return node.data?.cnpj || '';
    }

    return '';
  }

  private async processDataNodeQuestion(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    node: ListChatbotFlowResponse['nodes'][number]
  ): Promise<boolean> {
    const questionText = this.getQuestionTextForDataType(node);

    if (questionText) {
      return this.sendMessageWithStatusGuard(t, {
        chat: createChat,
        accountId: createChat.account.id,
        type: EMessageType.text,
        message: questionText,
        typeUser: ETypeUserChat.bot,
      });
    }

    return true;
  }

  private async processNextNode(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    chatbotFlow: ListChatbotFlowResponse,
    nextFlowId: string,
    customMessages?: IChatbotCustomMessages,
    data?: IUpsertMessage
  ): Promise<boolean> {
    if (!(await this.canRunAutomation(createChat))) {
      return false;
    }
    this.consumeAutomaticExecutionBudget(createChat.chat_id, 'transition');

    const nextFlowNode = this.getFlowNodeById(chatbotFlow, nextFlowId);

    if (!nextFlowNode) {
      return false;
    }

    await this.resolveCompatibleNodeVariables(
      t,
      createChat,
      nextFlowNode,
      data
    );

    if (nextFlowNode.type === 'aiAgent') {
      const cacheKey = this.getChatbotFlowCacheKey(
        createChat.account.id,
        createChat.worker.id,
        createChat.chat_id
      );
      const previousFlowId = await this.redis.get(cacheKey);

      const isReturningToAiAgent =
        previousFlowId && previousFlowId === nextFlowId;

      const userText = data
        ? this.getTextFromUpsertMessage(data)?.trim()
        : null;
      const hasUserMessage = userText && userText.length > 0;

      if (!isReturningToAiAgent) {
        const selectedAiAgentId = nextFlowNode.data?.selectedAiAgent;
        if (selectedAiAgentId) {
          const aiAgent = await this.aiAgentService.viewAiAgent(
            selectedAiAgentId,
            createChat.account.id
          );

          if (!aiAgent || aiAgent.status !== EAiAgentStatus.active) {
            throw new Error(t('ai_agent_not_found'));
          }

          if (hasUserMessage && data) {
            const bootstrapSummaryKey = `${cacheKey}:bootstrap-summary`;
            await this.generateBootstrapSummaryForChat(
              createChat,
              aiAgent,
              bootstrapSummaryKey
            );
            await this.resetAiAgentInteractionsCount(
              createChat.account.id,
              createChat.worker.id,
              createChat.chat_id,
              nextFlowId
            );
            await this.updateCache(createChat, nextFlowId);
            await this.scheduleChatHistoryEmbedding(
              createChat,
              selectedAiAgentId
            );
            return this.processAiAgentNode(
              t,
              data,
              createChat,
              chatbotFlow,
              nextFlowId,
              customMessages
            );
          }

          const welcomeSent = await this.generateAndSendAiWelcomeMessage(
            t,
            createChat,
            aiAgent
          );
          if (!welcomeSent) {
            return false;
          }
          await this.scheduleChatHistoryEmbedding(
            createChat,
            selectedAiAgentId
          );
        }
      }

      await this.updateCache(createChat, nextFlowId);
    }

    await this.updateCache(createChat, nextFlowId);

    if (nextFlowNode.type === 'apiRequest') {
      return this.processApiRequestNode(
        t,
        createChat,
        chatbotFlow,
        nextFlowNode,
        customMessages,
        data
      );
    }

    if (nextFlowNode.type === 'underchat') {
      return this.processUnderchatNode(
        t,
        createChat,
        chatbotFlow,
        nextFlowNode,
        customMessages,
        data
      );
    }

    if (nextFlowNode.type === 'menu' || nextFlowNode.type === 'satisfaction') {
      return this.sendBuildMenuMessage(
        t,
        createChat,
        nextFlowNode,
        !this.synchronousEffectsByChatId.has(createChat.chat_id)
      );
    }

    if (isOfficialChatbotNodeType(nextFlowNode.type)) {
      return this.processOfficialNodeType(
        t,
        createChat,
        chatbotFlow,
        nextFlowNode,
        nextFlowId,
        customMessages,
        data
      );
    }

    if (nextFlowNode.type === 'weekday') {
      return this.processWeekdayNode(
        t,
        createChat,
        chatbotFlow,
        nextFlowId,
        customMessages,
        data
      );
    }

    if (nextFlowNode.type === 'hours') {
      return this.processHoursNode(
        t,
        createChat,
        chatbotFlow,
        nextFlowId,
        customMessages,
        data
      );
    }

    if (nextFlowNode.type === 'holiday') {
      return this.processHolidayNode(
        t,
        createChat,
        chatbotFlow,
        nextFlowId,
        customMessages,
        data
      );
    }

    if (nextFlowNode.type === 'contact') {
      return this.processContactNode(
        t,
        createChat,
        chatbotFlow,
        nextFlowId,
        customMessages,
        data
      );
    }

    if (nextFlowNode.type === 'message') {
      return this.processMessageNode(
        t,
        createChat,
        nextFlowNode,
        chatbotFlow,
        customMessages,
        data
      );
    }

    if (nextFlowNode.type === 'randomMessage') {
      return this.processRandomMessageNodeType(
        t,
        createChat,
        chatbotFlow,
        nextFlowNode,
        nextFlowId,
        customMessages,
        data
      );
    }

    if (nextFlowNode.type === 'tag') {
      return this.processTagNode(
        t,
        createChat,
        chatbotFlow,
        nextFlowId,
        customMessages,
        data
      );
    }

    if (nextFlowNode.type === 'redirect') {
      return this.processRedirectNode(
        t,
        createChat,
        chatbotFlow,
        nextFlowId,
        customMessages
      );
    }

    if (nextFlowNode.type === 'distribution') {
      return this.processDistributionNode(
        t,
        createChat,
        chatbotFlow,
        nextFlowId,
        customMessages
      );
    }

    if (nextFlowNode.type === 'data') {
      return this.processDataNodeQuestion(t, createChat, nextFlowNode);
    }

    if (nextFlowNode.type === 'annotation') {
      return this.processAnnotationNode(
        t,
        createChat,
        chatbotFlow,
        nextFlowId,
        customMessages,
        data
      );
    }

    if (nextFlowNode.type === 'conditional') {
      await this.updateCache(createChat, nextFlowId);
      return this.processConditionalNode(
        t,
        data,
        createChat,
        chatbotFlow,
        nextFlowId,
        customMessages
      );
    }

    if (nextFlowNode.type === 'finish') {
      return this.finishFlowOrThrow(
        t,
        createChat,
        customMessages?.service_finished_message,
        customMessages?.service_finished_message_enabled
      );
    }

    return true;
  }

  private async processMessageNode(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    node: ListChatbotFlowResponse['nodes'][number],
    chatbotFlow: ListChatbotFlowResponse,
    customMessages?: IChatbotCustomMessages,
    data?: IUpsertMessage
  ): Promise<boolean> {
    const continueType = node.data?.continueType;

    if (continueType === 'automatic') {
      const messageSent = await this.sendMessage(t, createChat, node);
      if (!messageSent) {
        return false;
      }

      const nextFlowId = this.getNextFlowId(chatbotFlow, node.id);
      if (nextFlowId) {
        await this.updateCache(createChat, nextFlowId);
        return this.processNextNode(
          t,
          createChat,
          chatbotFlow,
          nextFlowId,
          customMessages,
          data
        );
      }

      return true;
    }

    if (continueType === 'after_response') {
      const messageSent = await this.sendMessage(t, createChat, node);
      if (!messageSent) {
        return false;
      }

      await this.persistRuntimeTransition(createChat, chatbotFlow, node.id);

      return true;
    }

    return this.sendMessage(t, createChat, node);
  }

  private async processMessageNodeType(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    chatbotFlow: ListChatbotFlowResponse,
    currentNode: ListChatbotFlowResponse['nodes'][number],
    currentFlowId: string,
    customMessages?: IChatbotCustomMessages,
    data?: IUpsertMessage
  ): Promise<boolean> {
    const continueType = currentNode.data?.continueType;

    if (continueType === 'automatic') {
      const messageSent = await this.sendMessage(t, createChat, currentNode);
      if (!messageSent) {
        return false;
      }

      const nextFlowId = this.getNextFlowId(chatbotFlow, currentFlowId);
      if (nextFlowId) {
        await this.updateCache(createChat, nextFlowId);
        return this.processNextNode(
          t,
          createChat,
          chatbotFlow,
          nextFlowId,
          customMessages
        );
      }

      return true;
    }

    if (continueType === 'after_response') {
      if (!data || data.message?.key?.fromMe === true) {
        return true;
      }
      const responseCapture = this.getMessageResponseCapture(data);
      if (!responseCapture) {
        return false;
      }

      const nextFlowId = this.getNextFlowId(chatbotFlow, currentFlowId);
      const outputKey = this.getNodeCaptureOutputKey(chatbotFlow, currentNode);
      if (!outputKey) {
        return false;
      }
      await this.persistRuntimeTransition(
        createChat,
        chatbotFlow,
        nextFlowId ?? currentFlowId,
        {
          outputKey,
          value: responseCapture,
        }
      );

      if (nextFlowId) {
        return this.processNextNode(
          t,
          createChat,
          chatbotFlow,
          nextFlowId,
          customMessages,
          data
        );
      }

      return true;
    }

    if (!continueType) {
      return this.sendMessage(t, createChat, currentNode);
    }

    return false;
  }

  private async updateChatTag(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    labelTemplateIds: string[]
  ): Promise<void> {
    if (labelTemplateIds.length === 0) {
      return;
    }

    const labelTemplates =
      await this.labelTemplateViewerRepository.viewLabelTemplatesByIds(
        labelTemplateIds,
        createChat.account.id
      );

    if (labelTemplates.length !== labelTemplateIds.length) {
      throw new Error(t('label_template_not_found'));
    }

    const label = labelTemplates.map((labelTemplate) => ({
      label_template_id: labelTemplate.label_template_id,
      label: labelTemplate.label,
      color: labelTemplate.color,
    }));

    if (JSON.stringify(createChat.label ?? null) === JSON.stringify(label)) {
      return;
    }

    const labelsEpoch = createChat.meta?.labels_epoch ?? 0;
    const labelsRevision =
      createChat.meta?.labels_event_id ??
      createChat.meta?.outbound_webhook_event_ids?.at(-1) ??
      createChat.started_at ??
      createChat.date;
    const canonicalLabels = JSON.stringify(
      [...label].sort((left, right) =>
        left.label_template_id.localeCompare(right.label_template_id)
      )
    );
    const labelsEventId = uuidv5(
      `chatbot-labels:${createChat.chat_id}:${labelsEpoch}:${labelsRevision}:${canonicalLabels}`,
      uuidv5.URL
    );

    const updated = await this.chatService.updateChatLabel(
      createChat.chat_id,
      label,
      labelsEpoch + 1,
      labelsEventId,
      {
        eventTypes: ['chat.labels.changed'],
        idempotencyKey: `chatbot-labels:${createChat.chat_id}:${labelsEventId}`,
        source: 'chatbot_flow',
        previousChat: createChat,
        actor: { type: 'automation' },
        changes: { labels: label },
      }
    );

    if (!updated) {
      throw new Error(t('chat_label_update_failed'));
    }

    const updatedChat = await this.chatService.findChatByChatId(
      createChat.account.id,
      createChat.chat_id
    );
    if (!updatedChat) {
      throw new Error(t('chat_label_update_failed'));
    }

    Object.assign(createChat, updatedChat);

    const channelAccountId = updatedChat.account?.id ?? createChat.account.id;

    await Promise.all([
      this.publishSubWithAssignmentGuard(
        chatAccountCentrifugo(channelAccountId),
        updatedChat
      ),
      this.publishSubWithAssignmentGuard(
        chatQueueAccountCentrifugo(channelAccountId),
        updatedChat
      ),
    ]);
  }

  private async updateContactTag(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    labelTemplateIds: string[],
    currentFlowId: string,
    data?: IUpsertMessage
  ): Promise<void> {
    if (!createChat.contact?.id) {
      throw new Error(t('contact_not_found'));
    }

    const contactExists = await this.contactService.existsContactById(
      createChat.contact.id
    );

    if (!contactExists) {
      throw new Error(t('contact_not_found'));
    }

    for (const labelTemplateId of labelTemplateIds) {
      const added =
        await this.contactService.addContactLabelTemplateIfNotExists(
          createChat.contact.id,
          labelTemplateId,
          createChat.account.id,
          {
            source: 'chatbot_flow',
            idempotencyKey: this.scopeOutboundWebhookMutationKey(
              `contact-chatbot-label:${createChat.contact.id}:${currentFlowId}:${labelTemplateId}`,
              createChat.chat_id,
              data
            ),
            actor: { type: 'automation' },
            changes: { added_label_template_id: labelTemplateId },
          }
        );

      if (!added) {
        throw new Error(t('contact_update_error'));
      }
    }

    await this.chatService.invalidateChatCache(createChat);
  }

  private async processTagNode(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    chatbotFlow: ListChatbotFlowResponse,
    currentFlowId: string,
    customMessages?: IChatbotCustomMessages,
    data?: IUpsertMessage
  ): Promise<boolean> {
    const currentNode = this.getFlowNodeById(chatbotFlow, currentFlowId);

    if (!currentNode) {
      throw new Error(t('chatbot_flow_node_not_found'));
    }

    const tagType = currentNode.data?.tagType;
    const selectedTag = Array.isArray(currentNode.data?.selectedTag)
      ? currentNode.data.selectedTag
      : [];

    if (selectedTag.length === 0) {
      throw new Error(t('tag_not_selected'));
    }

    if (tagType === 'chat') {
      await this.updateChatTag(t, createChat, selectedTag);
    }

    if (tagType === 'contact') {
      try {
        await this.updateContactTag(
          t,
          createChat,
          selectedTag,
          currentFlowId,
          data
        );
      } catch (error) {
        console.error('[ChatbotFlow] updateContactTag failed', error);
        if (this.synchronousEffectsByChatId.has(createChat.chat_id)) {
          throw error;
        }
      }
    }

    const nextFlowId = this.getNextFlowId(chatbotFlow, currentFlowId);
    if (!nextFlowId) {
      return true;
    }

    return this.processNextNode(
      t,
      createChat,
      chatbotFlow,
      nextFlowId,
      customMessages,
      data
    );
  }

  private async processAnnotationNode(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    chatbotFlow: ListChatbotFlowResponse,
    currentFlowId: string,
    customMessages?: IChatbotCustomMessages,
    data?: IUpsertMessage
  ): Promise<boolean> {
    const currentNode = this.getFlowNodeById(chatbotFlow, currentFlowId);

    if (!currentNode) {
      throw new Error(t('chatbot_flow_node_not_found'));
    }

    const annotation = currentNode.data?.annotation;

    if (!annotation || annotation.trim().length === 0) {
      const nextFlowId = this.getNextFlowId(chatbotFlow, currentFlowId);
      if (!nextFlowId) {
        return true;
      }

      await this.updateCache(createChat, nextFlowId);

      return this.processNextNode(
        t,
        createChat,
        chatbotFlow,
        nextFlowId,
        customMessages,
        data
      );
    }

    const message = await this.replaceVariables(
      t,
      annotation.trim(),
      createChat,
      createChat.user,
      createChat.sector
    );

    const annotationSent = await this.sendMessageWithStatusGuard(t, {
      chat: createChat,
      accountId: createChat.account.id,
      type: EMessageType.annotation,
      message,
      typeUser: ETypeUserChat.system,
    });
    if (!annotationSent) {
      return false;
    }

    const nextFlowId = this.getNextFlowId(chatbotFlow, currentFlowId);
    if (!nextFlowId) {
      return true;
    }

    await this.updateCache(createChat, nextFlowId);

    return this.processNextNode(
      t,
      createChat,
      chatbotFlow,
      nextFlowId,
      customMessages,
      data
    );
  }

  private async processUserRedirect(
    t: TFunction<'translation', undefined>,
    selectedUser: string | null | undefined
  ): Promise<IChat['user']> {
    if (!selectedUser) {
      throw new Error(t('user_not_selected'));
    }

    const userData = await this.userService.viewUserNamePhoto(selectedUser);

    if (!userData) {
      throw new Error(t('user_not_found'));
    }

    return {
      id: userData.id,
      name: userData.name,
      photo: userData.photo ?? null,
    };
  }

  private async processSectorRedirect(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    selectedSector: string | null | undefined,
    selectedSectorUser: string | null | undefined
  ): Promise<{
    sector: IChat['sector'];
    user?: IChat['user'];
  }> {
    if (!selectedSector) {
      throw new Error(t('sector_not_selected'));
    }

    const sectorData = await this.sectorService.viewSectorById(
      selectedSector,
      createChat.account.id
    );

    if (!sectorData) {
      throw new Error(t('sector_not_found'));
    }

    const sector: IChat['sector'] = {
      id: sectorData.sector_id,
      name: sectorData.name,
      color: sectorData.color,
    };

    let user: IChat['user'] | undefined = undefined;

    if (selectedSectorUser) {
      const sectorUserData =
        await this.userService.viewUserNamePhoto(selectedSectorUser);

      if (!sectorUserData) {
        throw new Error(t('user_not_found'));
      }

      user = {
        id: sectorUserData.id,
        name: sectorUserData.name,
        photo: sectorUserData.photo ?? null,
      };
    }

    return { sector, user };
  }

  private async resolveRedirectWorker(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    selectedChannel: string | null | undefined
  ): Promise<IChat['worker']> {
    if (!selectedChannel) {
      return createChat.worker;
    }

    const worker = await this.workerService.viewWorkerNameAndId(
      createChat.account.id,
      selectedChannel
    );

    if (!worker) {
      throw new Error(t('worker_not_found'));
    }

    return {
      id: worker.id,
      name: worker.name,
    };
  }

  private async updateAndPublishChat(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    user: IChat['user'] | null | undefined,
    sector: IChat['sector'] | null | undefined,
    worker?: IChat['worker'] | null
  ): Promise<IChat> {
    const activeChat = await this.getAutomationChatIfAllowed(createChat);
    if (!activeChat) {
      const currentChat = await this.loadCurrentChatState(createChat);
      if (currentChat) {
        return currentChat;
      }

      throw new Error(t('chat_update_failed'));
    }

    const targetWorker = worker ?? activeChat.worker;

    const handoff = await this.chatService.transferAutomationChatToQueue({
      accountId: activeChat.account.id,
      chat: activeChat,
      worker: targetWorker,
      user: user ?? null,
      sector: sector ?? null,
      secondaryUsers: [],
      outboundWebhook: {
        eventTypes: [
          'chat.automation.finished',
          'chat.queued',
          ...(targetWorker.id !== activeChat.worker.id || user || sector
            ? (['chat.transferred'] as const)
            : []),
        ],
        idempotencyKey: `chatbot-handoff:${activeChat.chat_id}:${activeChat.meta?.status_event_id ?? activeChat.date}`,
        source: 'chatbot_flow',
        previousChat: activeChat,
        actor: { type: 'automation' },
        changes: {
          target_worker_id: targetWorker.id,
          target_user_id: user?.id ?? null,
          target_sector_id: sector?.id ?? null,
          status: EChatStatus.queue,
        },
      },
    });

    if (!handoff.chat) {
      throw new Error(t('chat_update_failed'));
    }

    const updatedChat = handoff.chat;
    const previousChat = handoff.previousChat ?? activeChat;
    const workerIdsToClear = new Set<string>([
      activeChat.worker.id,
      previousChat.worker.id,
      targetWorker.id,
      updatedChat.worker.id,
    ]);

    if (!handoff.applied) {
      if (!handoff.alreadyHuman) {
        throw new Error(t('chat_update_failed'));
      }

      await Promise.all([
        ...Array.from(workerIdsToClear).map((workerId) =>
          this.clearChatbotRuntimeStateByIds(
            updatedChat.account.id,
            workerId,
            updatedChat.chat_id
          )
        ),
        this.chatService.invalidateChatCache(activeChat),
      ]);
      return updatedChat;
    }

    const shouldInvalidateTargetWorkerCache =
      activeChat.worker.id !== updatedChat.worker.id;

    const cacheInvalidations: Promise<void>[] = [
      this.chatService.invalidateChatCache(activeChat),
    ];

    if (shouldInvalidateTargetWorkerCache) {
      cacheInvalidations.push(
        this.chatService.invalidateChatCache(updatedChat)
      );
    }

    await Promise.all([
      ...Array.from(workerIdsToClear).map((workerId) =>
        this.clearChatbotRuntimeStateByIds(
          updatedChat.account.id,
          workerId,
          updatedChat.chat_id
        )
      ),
      ...cacheInvalidations,
    ]);

    const channelAccountId = updatedChat.account?.id ?? createChat.account.id;

    await Promise.all([
      this.publishSubWithAssignmentGuard(
        chatAccountCentrifugo(channelAccountId),
        updatedChat
      ),
      this.publishSubWithAssignmentGuard(
        chatQueueAccountCentrifugo(channelAccountId),
        updatedChat
      ),
    ]);

    return updatedChat;
  }

  private async processRedirectNode(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    chatbotFlow: ListChatbotFlowResponse,
    currentFlowId: string,
    customMessages?: IChatbotCustomMessages
  ): Promise<boolean> {
    const currentNode = this.getFlowNodeById(chatbotFlow, currentFlowId);

    if (!currentNode) {
      throw new Error(t('chatbot_flow_node_not_found'));
    }

    const selectedChannel = currentNode.data?.selectedChannel;
    let targetWorker: IChat['worker'] = createChat.worker;

    try {
      targetWorker = await this.resolveRedirectWorker(
        t,
        createChat,
        selectedChannel
      );
    } catch (error) {
      console.error('Erro ao redirecionar para canal no chatbot flow:', {
        error: error instanceof Error ? error.message : String(error),
        accountId: createChat.account.id,
        chatId: createChat.chat_id,
        selectedChannel,
        stack: error instanceof Error ? error.stack : undefined,
      });

      return false;
    }

    const responsibleAttendant = createChat.contact?.responsible_attendant;

    if (responsibleAttendant) {
      const user: IChat['user'] = {
        id: responsibleAttendant.id,
        name: responsibleAttendant.name,
        photo: responsibleAttendant.photo ?? null,
      };

      const rawTransferMessage =
        customMessages?.transfer_message_user ||
        t('chatbot_transfer_message_user_default');

      if (rawTransferMessage) {
        const transferMessage = await this.replaceVariables(
          t,
          rawTransferMessage,
          createChat,
          user,
          undefined
        );
        const messageSent = await this.sendMessageWithStatusGuard(t, {
          chat: createChat,
          accountId: createChat.account.id,
          type: EMessageType.system,
          message: transferMessage,
          typeUser: ETypeUserChat.bot,
        });
        if (!messageSent) {
          return false;
        }
      }

      await this.updateAndPublishChat(
        t,
        createChat,
        user,
        undefined,
        targetWorker
      );

      return true;
    }

    const redirectType = currentNode.data?.redirectType;
    const selectedUser = currentNode.data?.selectedUser;
    const selectedSector = currentNode.data?.selectedSector;
    const selectedSectorUser = currentNode.data?.selectedSectorUser;

    let user: IChat['user'] | null | undefined = undefined;
    let sector: IChat['sector'] | null | undefined = undefined;

    if (redirectType === 'user') {
      user = await this.processUserRedirect(t, selectedUser);
    }

    if (redirectType === 'sector') {
      try {
        const result = await this.processSectorRedirect(
          t,
          createChat,
          selectedSector,
          selectedSectorUser
        );
        sector = result.sector;
        if (result.user) {
          user = result.user;
        }
      } catch (error) {
        console.error('Erro ao redirecionar para setor no chatbot flow:', {
          error: error instanceof Error ? error.message : String(error),
          accountId: createChat.account.id,
          chatId: createChat.chat_id,
          selectedSector,
          selectedSectorUser,
          stack: error instanceof Error ? error.stack : undefined,
        });

        sector = null;
      }
    }

    let rawTransferMessage: string | undefined;
    let enabled: boolean | undefined = undefined;
    if (redirectType === 'user' && user) {
      rawTransferMessage =
        customMessages?.transfer_message_user ||
        t('chatbot_transfer_message_user_default');
      enabled = customMessages?.transfer_message_user_enabled;
    } else if (redirectType === 'sector' && sector) {
      if (user) {
        rawTransferMessage =
          customMessages?.transfer_message_sector_user ||
          t('chatbot_transfer_message_sector_user_default');
        enabled = customMessages?.transfer_message_sector_user_enabled;
      } else {
        rawTransferMessage =
          customMessages?.transfer_message_sector ||
          t('chatbot_transfer_message_sector_default');
        enabled = customMessages?.transfer_message_sector_enabled;
      }
    }

    if (rawTransferMessage && (user || sector) && enabled !== false) {
      const transferMessage = await this.replaceVariables(
        t,
        rawTransferMessage,
        createChat,
        user,
        sector
      );
      const messageSent = await this.sendMessageWithStatusGuard(t, {
        chat: createChat,
        accountId: createChat.account.id,
        type: EMessageType.system,
        message: transferMessage,
        typeUser: ETypeUserChat.bot,
      });
      if (!messageSent) {
        return false;
      }
    }

    await this.updateAndPublishChat(t, createChat, user, sector, targetWorker);

    return true;
  }

  private async processNextNodeAfterValidation(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    chatbotFlow: ListChatbotFlowResponse,
    currentFlowId: string,
    customMessages?: IChatbotCustomMessages,
    data?: IUpsertMessage,
    capturedValue?: ChatbotNodeRuntimeCapture
  ): Promise<boolean> {
    const nextFlowId = this.getNextFlowId(chatbotFlow, currentFlowId);
    const currentNode = this.getFlowNodeById(chatbotFlow, currentFlowId);
    const outputKey = currentNode
      ? this.getNodeCaptureOutputKey(chatbotFlow, currentNode)
      : null;
    if (capturedValue && outputKey) {
      await this.persistRuntimeTransition(
        createChat,
        chatbotFlow,
        nextFlowId ?? currentFlowId,
        { outputKey, value: capturedValue }
      );
    } else if (nextFlowId) {
      await this.updateCache(createChat, nextFlowId);
    }
    if (nextFlowId) {
      return this.processNextNode(
        t,
        createChat,
        chatbotFlow,
        nextFlowId,
        customMessages,
        data
      );
    }
    return true;
  }

  private async updateContactData(
    createChat: IChat,
    updateData: UpdateContactRequest,
    currentFlowId: string,
    data?: IUpsertMessage
  ): Promise<void> {
    if (!createChat.contact?.id) {
      return;
    }

    await this.contactService.updateContactById(
      updateData,
      createChat.contact.id,
      createChat.account.id,
      {
        source: 'chatbot_flow',
        idempotencyKey: this.scopeOutboundWebhookMutationKey(
          `contact-chatbot-data:${createChat.contact.id}:${currentFlowId}:${createHash(
            'sha256'
          )
            .update(JSON.stringify(updateData))
            .digest('hex')}`,
          createChat.chat_id,
          data
        ),
        actor: { type: 'customer' },
        changes: updateData as Record<string, unknown>,
      }
    );
  }

  private async processNameDataNode(
    t: TFunction<'translation', undefined>,
    data: IUpsertMessage,
    createChat: IChat,
    chatbotFlow: ListChatbotFlowResponse,
    currentFlowId: string,
    customMessages?: IChatbotCustomMessages
  ): Promise<boolean> {
    const userText = this.getTextFromUpsertMessage(data)?.trim();
    const normalizedName = userText
      ? (truncateContactName(userText) ?? userText)
      : null;

    if (normalizedName && createChat.contact?.id) {
      await this.updateContactData(
        createChat,
        { name: normalizedName },
        currentFlowId,
        data
      );
    }

    return this.processNextNodeAfterValidation(
      t,
      createChat,
      chatbotFlow,
      currentFlowId,
      customMessages,
      data,
      normalizedName
        ? { value: normalizedName, name: normalizedName }
        : undefined
    );
  }

  private async processLastNameDataNode(
    t: TFunction<'translation', undefined>,
    data: IUpsertMessage,
    createChat: IChat,
    chatbotFlow: ListChatbotFlowResponse,
    currentFlowId: string,
    customMessages?: IChatbotCustomMessages
  ): Promise<boolean> {
    const userText = this.getTextFromUpsertMessage(data)?.trim();
    const normalizedLastName = userText
      ? (truncateContactName(userText) ?? userText)
      : null;

    if (normalizedLastName && createChat.contact?.id) {
      await this.updateContactData(
        createChat,
        { last_name: normalizedLastName },
        currentFlowId,
        data
      );
    }

    return this.processNextNodeAfterValidation(
      t,
      createChat,
      chatbotFlow,
      currentFlowId,
      customMessages,
      data,
      normalizedLastName
        ? { value: normalizedLastName, lastname: normalizedLastName }
        : undefined
    );
  }

  private async processEmailDataNode(
    t: TFunction<'translation', undefined>,
    data: IUpsertMessage,
    createChat: IChat,
    chatbotFlow: ListChatbotFlowResponse,
    currentFlowId: string,
    currentNode: ListChatbotFlowResponse['nodes'][number],
    userText: string,
    customMessage?: string,
    customMessages?: IChatbotCustomMessages
  ): Promise<boolean> {
    if (!this.isValidEmail(userText)) {
      await this.sendInvalidEmailMessage(
        t,
        createChat,
        customMessage,
        customMessages?.invalid_email_message_enabled
      );
      await this.processDataNodeQuestion(t, createChat, currentNode);
      return false;
    }

    if (createChat.contact?.id) {
      await this.updateContactData(
        createChat,
        { email: userText },
        currentFlowId,
        data
      );
    }

    return this.processNextNodeAfterValidation(
      t,
      createChat,
      chatbotFlow,
      currentFlowId,
      customMessages,
      data,
      { value: userText, email: userText }
    );
  }

  private async processCpfDataNode(
    t: TFunction<'translation', undefined>,
    data: IUpsertMessage,
    createChat: IChat,
    chatbotFlow: ListChatbotFlowResponse,
    currentFlowId: string,
    currentNode: ListChatbotFlowResponse['nodes'][number],
    userText: string,
    customMessage?: string,
    customMessages?: IChatbotCustomMessages
  ): Promise<boolean> {
    if (!this.isValidCPF(userText)) {
      await this.sendInvalidCpfMessage(
        t,
        createChat,
        customMessage,
        customMessages?.invalid_cpf_message_enabled
      );
      await this.processDataNodeQuestion(t, createChat, currentNode);
      return false;
    }

    const cpfDigits = userText.replaceAll(/\D/g, '');

    if (createChat.contact?.id) {
      await this.updateContactData(
        createChat,
        {
          contact_document_type_id: EContactDocumentType.cpf,
          document: cpfDigits,
        },
        currentFlowId,
        data
      );
    }

    return this.processNextNodeAfterValidation(
      t,
      createChat,
      chatbotFlow,
      currentFlowId,
      customMessages,
      data,
      { value: cpfDigits, cpf: cpfDigits }
    );
  }

  private async processCnpjDataNode(
    t: TFunction<'translation', undefined>,
    data: IUpsertMessage,
    createChat: IChat,
    chatbotFlow: ListChatbotFlowResponse,
    currentFlowId: string,
    currentNode: ListChatbotFlowResponse['nodes'][number],
    userText: string,
    customMessage?: string,
    customMessages?: IChatbotCustomMessages
  ): Promise<boolean> {
    if (!validateCnpj(userText)) {
      await this.sendInvalidCnpjMessage(
        t,
        createChat,
        customMessage,
        customMessages?.invalid_cnpj_message_enabled
      );
      await this.processDataNodeQuestion(t, createChat, currentNode);
      return false;
    }

    const cnpj = normalizeCnpj(userText);

    if (createChat.contact?.id) {
      await this.updateContactData(
        createChat,
        {
          contact_document_type_id: EContactDocumentType.cnpj,
          document: cnpj,
        },
        currentFlowId,
        data
      );
    }

    return this.processNextNodeAfterValidation(
      t,
      createChat,
      chatbotFlow,
      currentFlowId,
      customMessages,
      data,
      { value: cnpj, cnpj }
    );
  }

  private async processDataNode(
    t: TFunction<'translation', undefined>,
    data: IUpsertMessage,
    createChat: IChat,
    chatbotFlow: ListChatbotFlowResponse,
    currentFlowId: string,
    customMessages?: IChatbotCustomMessages
  ): Promise<boolean> {
    const currentNode = this.getFlowNodeById(chatbotFlow, currentFlowId);

    if (!currentNode) {
      throw new Error(t('chatbot_flow_node_not_found'));
    }

    const dataType = currentNode.data?.dataType;
    const userText = this.getTextFromUpsertMessage(data)?.trim();

    if (!userText) {
      return false;
    }

    if (dataType === 'name') {
      return this.processNameDataNode(
        t,
        data,
        createChat,
        chatbotFlow,
        currentFlowId,
        customMessages
      );
    }

    if (dataType === 'lastname') {
      return this.processLastNameDataNode(
        t,
        data,
        createChat,
        chatbotFlow,
        currentFlowId,
        customMessages
      );
    }

    if (dataType === 'email') {
      return this.processEmailDataNode(
        t,
        data,
        createChat,
        chatbotFlow,
        currentFlowId,
        currentNode,
        userText,
        customMessages?.invalid_email_message,
        customMessages
      );
    }

    if (dataType === 'cpf') {
      return this.processCpfDataNode(
        t,
        data,
        createChat,
        chatbotFlow,
        currentFlowId,
        currentNode,
        userText,
        customMessages?.invalid_cpf_message,
        customMessages
      );
    }

    if (dataType === 'cnpj') {
      return this.processCnpjDataNode(
        t,
        data,
        createChat,
        chatbotFlow,
        currentFlowId,
        currentNode,
        userText,
        customMessages?.invalid_cnpj_message,
        customMessages
      );
    }

    return false;
  }

  private async processMenuNode(
    t: TFunction<'translation', undefined>,
    data: IUpsertMessage,
    createChat: IChat,
    chatbotFlow: ListChatbotFlowResponse,
    currentFlowId: string,
    options?: {
      customMessage?: string;
      redirectFailedAttempts?: {
        status?: string;
        quantity?: number;
        redirect_type?: string;
        selected_user?: string;
        selected_sector?: string;
        selected_sector_user?: string;
      };
      customMessages?: IChatbotCustomMessages;
    }
  ): Promise<boolean> {
    const currentNode = this.getFlowNodeById(chatbotFlow, currentFlowId);
    if (!currentNode) {
      throw new Error(t('chatbot_flow_node_not_found'));
    }

    const debounceData = await this.getMenuDebounce(createChat);

    if (debounceData) {
      const now = Date.now();
      const { expiresAt, nodeData } = debounceData;

      if (now < expiresAt) {
        await this.setMenuDebounce(createChat, nodeData);

        this.scheduleMenuSend(t, createChat, nodeData);

        return true;
      }

      await this.deleteMenuDebounce(createChat);

      const rawBaseMessage = nodeData.message;
      const baseMessage = await this.replaceVariables(
        t,
        rawBaseMessage,
        createChat,
        createChat.user,
        createChat.sector
      );

      const menuMessage = this.buildMenuMessage(baseMessage, nodeData.options);

      await this.sendMessageWithStatusGuard(t, {
        chat: createChat,
        accountId: createChat.account.id,
        type: EMessageType.text,
        message: menuMessage,
        typeUser: ETypeUserChat.bot,
      });
    }

    const text = this.getTextFromUpsertMessage(data)?.trim();
    if (!text) {
      return this.handleInvalidMenuAttempt(
        t,
        createChat,
        currentNode,
        options?.customMessage,
        options?.redirectFailedAttempts,
        options?.customMessages
      );
    }

    const menuOptions = currentNode.data?.options ?? [];
    const selectedNumber = this.parseStructuredSelection(
      text,
      menuOptions.length
    );

    if (selectedNumber === null) {
      return this.handleInvalidMenuAttempt(
        t,
        createChat,
        currentNode,
        options?.customMessage,
        options?.redirectFailedAttempts,
        options?.customMessages
      );
    }

    const selectedOption = menuOptions[selectedNumber - 1];

    if (!selectedOption) {
      return this.handleInvalidMenuAttempt(
        t,
        createChat,
        currentNode,
        options?.customMessage,
        options?.redirectFailedAttempts,
        options?.customMessages
      );
    }

    const nextFlowId = this.getNextFlowIdByOption(
      chatbotFlow,
      currentFlowId,
      selectedOption.id
    );

    if (!nextFlowId) {
      throw new Error(t('chatbot_flow_not_found'));
    }

    if (currentNode.type === 'satisfaction') {
      const question = await this.replaceVariables(
        t,
        currentNode.data?.message || '',
        createChat,
        createChat.user,
        createChat.sector
      );
      const analyst = this.resolveSatisfactionAnalyst(createChat);
      const satisfactionData = {
        question,
        options: menuOptions.map((o) => ({ id: o.id, text: o.text })),
        response: { id: selectedOption.id, text: selectedOption.text },
        analyst,
      };
      await this.chatService.updateChatSatisfactionResponse(
        createChat.chat_id,
        satisfactionData,
        {
          eventTypes: ['chat.satisfaction.updated'],
          idempotencyKey: this.buildSatisfactionWebhookIdempotencyKey(
            createChat.chat_id,
            currentFlowId,
            selectedOption.id,
            data
          ),
          source: 'chatbot_flow',
          previousChat: createChat,
          actor: { type: 'customer' },
          changes: { satisfaction: satisfactionData },
        }
      );
    }

    await this.resetFailedAttempts(createChat);

    return this.processNextNode(
      t,
      createChat,
      chatbotFlow,
      nextFlowId,
      options?.customMessages,
      data
    );
  }

  private resolveSatisfactionAnalyst(
    chat: IChat
  ): { id: string; name: string | null } | null {
    const directUserId = chat.user?.id?.trim();
    if (directUserId) {
      return {
        id: directUserId,
        name: chat.user?.name?.trim() || null,
      };
    }

    const responsibleAttendantId =
      chat.contact?.responsible_attendant?.id?.trim();
    if (responsibleAttendantId) {
      return {
        id: responsibleAttendantId,
        name: chat.contact?.responsible_attendant?.name?.trim() || null,
      };
    }

    const latestSecondaryUser = (chat.secondary_users ?? [])
      .filter((secondaryUser) => !!secondaryUser?.id)
      .sort((a, b) => {
        const aTs = a.entered_at ? new Date(a.entered_at).getTime() : 0;
        const bTs = b.entered_at ? new Date(b.entered_at).getTime() : 0;
        return bTs - aTs;
      })[0];

    if (!latestSecondaryUser?.id) {
      return null;
    }

    return {
      id: latestSecondaryUser.id,
      name: latestSecondaryUser.name?.trim() || null,
    };
  }

  private async processContactNode(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    chatbotFlow: ListChatbotFlowResponse,
    currentFlowId: string,
    customMessages?: IChatbotCustomMessages,
    data?: IUpsertMessage
  ): Promise<boolean> {
    const currentNode = this.getFlowNodeById(chatbotFlow, currentFlowId);
    if (!currentNode) {
      throw new Error(t('chatbot_flow_node_not_found'));
    }

    const menuOptions = currentNode.data?.options ?? [];
    if (menuOptions.length < 2) {
      throw new Error(
        t('chatbot_flow_validation_options_required', {
          nodeLabel: currentNode.data?.title || currentNode.id,
        })
      );
    }

    const contactOption = menuOptions.find((option) => {
      const textLower = option.text.toLowerCase().trim();
      return (
        textLower === 'contato' ||
        (textLower.includes('contato') && !textLower.includes('não'))
      );
    });
    const notContactOption = menuOptions.find((option) => {
      const textLower = option.text.toLowerCase().trim();
      return (
        textLower === 'não é contato' ||
        (textLower.includes('não') && textLower.includes('contato'))
      );
    });

    if (!contactOption || !notContactOption) {
      throw new Error(
        'Contact node must have "Contato" and "Não é contato" options'
      );
    }

    if (!createChat.phone) {
      const nextFlowId = this.getNextFlowIdByOption(
        chatbotFlow,
        currentFlowId,
        notContactOption.id
      );
      if (!nextFlowId) {
        throw new Error(t('chatbot_flow_not_found'));
      }
      await this.updateCache(createChat, nextFlowId);
      return this.processNextNode(
        t,
        createChat,
        chatbotFlow,
        nextFlowId,
        customMessages,
        data
      );
    }

    const phoneAndDdi = extractPhoneAndDdi(createChat.phone);
    if (!phoneAndDdi) {
      const nextFlowId = this.getNextFlowIdByOption(
        chatbotFlow,
        currentFlowId,
        notContactOption.id
      );
      if (!nextFlowId) {
        throw new Error(t('chatbot_flow_not_found'));
      }
      await this.updateCache(createChat, nextFlowId);
      return this.processNextNode(
        t,
        createChat,
        chatbotFlow,
        nextFlowId,
        customMessages,
        data
      );
    }

    const contact = await this.contactService.getContactByPhone(
      createChat.account.id,
      phoneAndDdi.phone,
      phoneAndDdi.phone_ddi
    );

    let selectedOption = notContactOption;

    if (!contact) {
      const nextFlowId = this.getNextFlowIdByOption(
        chatbotFlow,
        currentFlowId,
        selectedOption.id
      );
      if (!nextFlowId) {
        throw new Error(t('chatbot_flow_not_found'));
      }
      await this.resetFailedAttempts(createChat);
      await this.updateCache(createChat, nextFlowId);
      return this.processNextNode(
        t,
        createChat,
        chatbotFlow,
        nextFlowId,
        customMessages,
        data
      );
    }

    const chatDate = createChat.started_at || createChat.date;
    const contactCreatedAt = contact.created_at;

    if (!chatDate || !contactCreatedAt) {
      selectedOption = contactOption;
    }

    if (chatDate && contactCreatedAt) {
      const chatTimestamp = new Date(chatDate).getTime();
      const contactTimestamp = new Date(contactCreatedAt).getTime();

      if (contactTimestamp < chatTimestamp) {
        selectedOption = contactOption;
      }
    }
    const nextFlowId = this.getNextFlowIdByOption(
      chatbotFlow,
      currentFlowId,
      selectedOption.id
    );

    if (!nextFlowId) {
      throw new Error(t('chatbot_flow_not_found'));
    }

    await this.resetFailedAttempts(createChat);
    await this.updateCache(createChat, nextFlowId);

    return this.processNextNode(
      t,
      createChat,
      chatbotFlow,
      nextFlowId,
      customMessages,
      data
    );
  }

  private async scheduleInactivityCheck(
    createChat: IChat,
    timeMinutes: number,
    chatbotId: string
  ): Promise<void> {
    if (
      createChat.status !== EChatStatus.ura &&
      createChat.status !== EChatStatus.ura_output &&
      createChat.status !== EChatStatus.ura_schedule &&
      createChat.status !== EChatStatus.ura_webhook
    ) {
      await this.cancelInactivityCheck(createChat);

      return;
    }

    const inactivityCacheKey = this.getInactivityCacheKey(
      createChat.account.id,
      createChat.worker.id,
      createChat.chat_id
    );
    const now = Date.now();
    const checkTime = now + timeMinutes * 60 * 1000;

    const inactivityData = await this.redis.get(inactivityCacheKey);
    const data: IInactivityData = inactivityData
      ? (JSON.parse(inactivityData) as IInactivityData)
      : {
          lastInteraction: now,
          alertCount: 0,
          lastAlertTime: null,
          chatbotId: chatbotId,
          accountId: createChat.account.id,
          workerId: createChat.worker.id,
          chatId: createChat.chat_id,
        };

    data.lastInteraction = now;
    data.alertCount = 0;
    data.lastAlertTime = null;
    data.chatbotId = chatbotId;
    data.accountId = createChat.account.id;
    data.workerId = createChat.worker.id;
    data.chatId = createChat.chat_id;
    data.trackingId = uuidv7();
    data.retryCount = 0;
    data.stage = 'waiting';

    await this.persistInactivitySchedule(inactivityCacheKey, data, checkTime);
  }

  private async cancelInactivityCheck(createChat: IChat): Promise<void> {
    const inactivityCacheKey = this.getInactivityCacheKey(
      createChat.account.id,
      createChat.worker.id,
      createChat.chat_id
    );
    await this.removeInactivitySchedule(inactivityCacheKey);
  }

  private async sendInactivityAlertMessage(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    inactivityCacheKey: string,
    inactivityData: IInactivityData,
    newAlertCount: number,
    timeMinutes: number,
    customInactivityMessage?: string,
    enabled?: boolean
  ): Promise<void> {
    if (
      createChat.status !== EChatStatus.ura &&
      createChat.status !== EChatStatus.ura_output &&
      createChat.status !== EChatStatus.ura_schedule &&
      createChat.status !== EChatStatus.ura_webhook
    ) {
      await this.cancelInactivityCheck(createChat);

      return;
    }

    if (enabled === false) {
      const now = Date.now();
      const updatedData = {
        ...inactivityData,
        alertCount: newAlertCount,
        lastAlertTime: now,
        trackingId: inactivityData.trackingId ?? uuidv7(),
        retryCount: 0,
        stage: 'waiting' as const,
      };

      const nextCheckTime = now + timeMinutes * 60 * 1000;

      await this.persistInactivitySchedule(
        inactivityCacheKey,
        updatedData,
        nextCheckTime
      );

      return;
    }

    const rawInactivityMessage =
      customInactivityMessage || t('chatbot_inactivity_message_default');
    const inactivityMessage = await this.replaceVariables(
      t,
      rawInactivityMessage,
      createChat,
      createChat.user,
      createChat.sector
    );
    const trackingId = inactivityData.trackingId ?? uuidv7();
    const alertMessageId = uuidv5(
      `chatbot-inactivity:${trackingId}:alert:${newAlertCount}`,
      uuidv5.URL
    );
    const messageSent = await this.sendMessageWithStatusGuard(t, {
      chat: createChat,
      accountId: createChat.account.id,
      messageId: alertMessageId,
      type: EMessageType.system,
      message: inactivityMessage,
      typeUser: ETypeUserChat.bot,
    });

    if (!messageSent) {
      throw new Error('chatbot inactivity alert was not sent');
    }

    const now = Date.now();
    const updatedData = {
      ...inactivityData,
      alertCount: newAlertCount,
      lastAlertTime: now,
      trackingId,
      retryCount: 0,
      stage: 'waiting' as const,
    };

    const nextCheckTime = now + timeMinutes * 60 * 1000;

    await this.persistInactivitySchedule(
      inactivityCacheKey,
      updatedData,
      nextCheckTime
    );
  }

  private async processInactivityRedirect(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    inactivityData: IInactivityData,
    inactivityAlert: {
      redirect_type?: string;
      selected_user?: string;
      selected_sector?: string;
      selected_sector_user?: string;
      selected_channel?: string;
      selected_chatbot?: string;
    },
    customMessages?: IChatbotCustomMessages,
    enabledFlags?: {
      transfer_message_user_enabled?: boolean;
      transfer_message_sector_enabled?: boolean;
      transfer_message_sector_user_enabled?: boolean;
    }
  ): Promise<boolean> {
    const redirectType = inactivityAlert.redirect_type;

    if (redirectType === 'user') {
      return this.processInactivityUserRedirect(
        t,
        createChat,
        inactivityAlert.selected_user,
        customMessages,
        enabledFlags
      );
    }

    if (redirectType === 'sector') {
      return this.processInactivitySectorRedirect(
        t,
        createChat,
        inactivityAlert.selected_sector,
        inactivityAlert.selected_sector_user,
        customMessages,
        enabledFlags
      );
    }

    if (redirectType === 'chatbot') {
      return this.queueInactivityChatbotRedirect(
        t,
        createChat,
        inactivityData,
        inactivityAlert.selected_channel,
        inactivityAlert.selected_chatbot
      );
    }

    return false;
  }

  private async queueInactivityChatbotRedirect(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    inactivityData: IInactivityData,
    selectedChannel?: string,
    selectedChatbot?: string
  ): Promise<boolean> {
    if (!selectedChannel || !selectedChatbot || !this.chatbotTransferService) {
      return false;
    }

    await this.chatbotTransferService.resolveTarget(
      t,
      createChat.account.id,
      selectedChannel,
      selectedChatbot
    );

    const cacheKey = this.getInactivityRedirectEffectKey(
      createChat.account.id,
      createChat.chat_id
    );
    if (await this.redis.get(cacheKey)) {
      return true;
    }

    const trackingId = inactivityData.trackingId ?? uuidv7();
    const operationId = uuidv5(
      `chatbot-inactivity-redirect:${trackingId}`,
      uuidv5.URL
    );
    await this.persistInactivityRedirectEffect({
      accountId: createChat.account.id,
      chatId: createChat.chat_id,
      sourceWorkerId: createChat.worker.id,
      sourceChatbotId: inactivityData.chatbotId,
      targetWorkerId: selectedChannel,
      targetChatbotId: selectedChatbot,
      operationId,
      eventEpochMillis: Date.now(),
      phase: 'transition_pending',
      expectedStatus: createChat.status,
      expectedStatusEventId: createChat.meta?.status_event_id ?? null,
      expectedStatusEpoch: createChat.meta?.status_epoch ?? null,
      expectedAssignmentEventId: createChat.meta?.assignment_event_id ?? null,
      expectedAssignmentEpoch: createChat.meta?.assignment_epoch ?? null,
      expectedLastMessageId: createChat.summary?.last_message_id ?? null,
      expectedSummaryRevision: createChat.summary?.revision ?? 0,
      retryCount: 0,
    });
    return true;
  }

  private async processInactivityUserRedirect(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    selectedUser?: string,
    customMessages?: IChatbotCustomMessages,
    enabledFlags?: {
      transfer_message_user_enabled?: boolean;
      transfer_message_sector_enabled?: boolean;
      transfer_message_sector_user_enabled?: boolean;
    }
  ): Promise<boolean> {
    if (!selectedUser) {
      return false;
    }

    const user = await this.getUserForRedirect(selectedUser);
    if (!user) {
      return false;
    }

    await this.sendTransferMessageIfNeeded(
      t,
      createChat,
      'user',
      user,
      undefined,
      customMessages,
      enabledFlags
    );

    await this.updateAndPublishChat(t, createChat, user, undefined);

    return true;
  }

  private async processInactivitySectorRedirect(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    selectedSector?: string,
    selectedSectorUser?: string,
    customMessages?: IChatbotCustomMessages,
    enabledFlags?: {
      transfer_message_user_enabled?: boolean;
      transfer_message_sector_enabled?: boolean;
      transfer_message_sector_user_enabled?: boolean;
    }
  ): Promise<boolean> {
    if (!selectedSector) {
      return false;
    }

    const sector = await this.getSectorForRedirect(
      selectedSector,
      createChat.account.id
    );
    if (!sector) {
      return false;
    }

    const user = selectedSectorUser
      ? await this.getUserForRedirect(selectedSectorUser)
      : undefined;

    await this.sendTransferMessageIfNeeded(
      t,
      createChat,
      'sector',
      user,
      sector,
      customMessages,
      enabledFlags
    );

    await this.updateAndPublishChat(t, createChat, user, sector);

    return true;
  }

  private async processInactivityAlert(
    t: TFunction<'translation', undefined>,
    inactivityCacheKey: string,
    inactivityData: IInactivityData,
    inactivityAlert: {
      status?: string;
      quantity?: number;
      time?: number;
      action?: string;
      redirect_type?: string;
      selected_user?: string;
      selected_sector?: string;
      selected_sector_user?: string;
      selected_channel?: string;
      selected_chatbot?: string;
    },
    createChat: IChat,
    customInactivityMessage?: string,
    customServiceFinishedMessage?: string,
    customMessages?: IChatbotCustomMessages,
    enabledFlags?: {
      inactivity_message_enabled?: boolean;
      service_finished_message_enabled?: boolean;
      transfer_message_user_enabled?: boolean;
      transfer_message_sector_enabled?: boolean;
      transfer_message_sector_user_enabled?: boolean;
    }
  ): Promise<boolean> {
    const action = inactivityAlert.action;
    if (!action) {
      return false;
    }

    const shouldSendAlert = await this.shouldSendInactivityAlert(
      t,
      inactivityCacheKey,
      inactivityData,
      inactivityAlert,
      createChat,
      customInactivityMessage,
      enabledFlags?.inactivity_message_enabled
    );

    if (shouldSendAlert) {
      return true;
    }

    if (action === 'finish') {
      const finishingData: IInactivityData = {
        ...inactivityData,
        trackingId: inactivityData.trackingId ?? uuidv7(),
        retryCount: 0,
        stage: 'finishing',
        expectedLastMessageId:
          inactivityData.stage === 'finishing' &&
          inactivityData.expectedLastMessageId !== undefined
            ? inactivityData.expectedLastMessageId
            : (createChat.summary?.last_message_id ?? null),
      };
      Object.assign(inactivityData, finishingData);
      await this.persistInactivitySchedule(
        inactivityCacheKey,
        finishingData,
        Date.now()
      );
    }

    const actionCompleted = await this.executeInactivityAction(
      t,
      createChat,
      action,
      inactivityAlert,
      inactivityData,
      customServiceFinishedMessage,
      customMessages,
      enabledFlags
    );
    const finishTransitionQueued =
      !actionCompleted &&
      action === 'finish' &&
      (await this.hasPendingFinishTransition(createChat));
    const actionHandled = actionCompleted || finishTransitionQueued;

    if (actionHandled) {
      await this.cancelInactivityCheck(createChat);
    }

    return actionHandled;
  }

  private async hasPendingFinishTransition(chat: IChat): Promise<boolean> {
    const cacheKey = this.getPendingFinishEffectKey(
      chat.account.id,
      chat.worker.id,
      chat.chat_id
    );
    const payload = await this.redis.get(cacheKey);
    if (!payload) {
      return false;
    }

    try {
      const effect = JSON.parse(payload) as IChatbotPendingFinishEffect;
      return (
        effect.phase === 'transition_pending' &&
        effect.accountId === chat.account.id &&
        effect.workerId === chat.worker.id &&
        effect.chatId === chat.chat_id
      );
    } catch {
      return false;
    }
  }

  private async restartFinishingInactivityAfterNewActivity(
    inactivityCacheKey: string,
    inactivityData: IInactivityData,
    chat: IChat,
    timeMinutes: number
  ): Promise<boolean> {
    if (
      inactivityData.stage !== 'finishing' ||
      chat.status === EChatStatus.closed ||
      inactivityData.expectedLastMessageId === undefined ||
      inactivityData.expectedLastMessageId ===
        (chat.summary?.last_message_id ?? null)
    ) {
      return false;
    }

    const now = Date.now();
    const resetData: IInactivityData = {
      ...inactivityData,
      lastInteraction: now,
      alertCount: 0,
      lastAlertTime: null,
      trackingId: uuidv7(),
      retryCount: 0,
      stage: 'waiting',
      expectedLastMessageId: undefined,
    };
    Object.assign(inactivityData, resetData);
    await this.persistInactivitySchedule(
      inactivityCacheKey,
      resetData,
      now + Math.max(1, Math.floor(timeMinutes)) * 60 * 1000
    );
    return true;
  }

  private async shouldSendInactivityAlert(
    t: TFunction<'translation', undefined>,
    inactivityCacheKey: string,
    inactivityData: IInactivityData,
    inactivityAlert: {
      quantity?: number;
      time?: number;
    },
    createChat: IChat,
    customInactivityMessage?: string,
    enabled?: boolean
  ): Promise<boolean> {
    const quantity = inactivityAlert.quantity ?? 1;
    const timeMinutes = inactivityAlert.time ?? 5;
    const currentAlertCount = inactivityData.alertCount || 0;
    const newAlertCount = currentAlertCount + 1;

    if (newAlertCount > quantity) {
      return false;
    }

    await this.sendInactivityAlertMessage(
      t,
      createChat,
      inactivityCacheKey,
      inactivityData,
      newAlertCount,
      timeMinutes,
      customInactivityMessage,
      enabled
    );
    return true;
  }

  private async executeInactivityAction(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    action: string,
    inactivityAlert: {
      redirect_type?: string;
      selected_user?: string;
      selected_sector?: string;
      selected_sector_user?: string;
      selected_channel?: string;
      selected_chatbot?: string;
    },
    inactivityData: IInactivityData,
    customServiceFinishedMessage?: string,
    customMessages?: IChatbotCustomMessages,
    enabledFlags?: {
      service_finished_message_enabled?: boolean;
      transfer_message_user_enabled?: boolean;
      transfer_message_sector_enabled?: boolean;
      transfer_message_sector_user_enabled?: boolean;
    }
  ): Promise<boolean> {
    if (action === 'finish') {
      return this.sendFinishMessage(
        t,
        createChat,
        customServiceFinishedMessage,
        enabledFlags?.service_finished_message_enabled
      );
    }

    if (action === 'redirect') {
      return this.processInactivityRedirect(
        t,
        createChat,
        inactivityData,
        inactivityAlert,
        customMessages,
        enabledFlags
      );
    }

    return false;
  }

  private async handleInvalidMenuAttempt(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    currentNode: ListChatbotFlowResponse['nodes'][number],
    customMessage?: string,
    redirectFailedAttempts?: {
      status?: string;
      quantity?: number;
      redirect_type?: string;
      selected_user?: string;
      selected_sector?: string;
      selected_sector_user?: string;
    },
    customMessages?: IChatbotCustomMessages
  ): Promise<boolean> {
    const nodeType =
      currentNode.type === 'satisfaction' ? 'satisfaction' : 'menu';
    const enabled =
      nodeType === 'satisfaction'
        ? customMessages?.invalid_satisfaction_option_message_enabled
        : customMessages?.invalid_menu_option_message_enabled;

    await this.sendTextOptionInvalidMessage(
      t,
      createChat,
      customMessage,
      nodeType,
      enabled
    );

    await this.sendBuildMenuMessage(t, createChat, currentNode);

    if (
      !this.shouldRedirectOnFailedAttempt(redirectFailedAttempts, createChat)
    ) {
      return false;
    }

    if (!redirectFailedAttempts) {
      return false;
    }

    const quantity = redirectFailedAttempts.quantity ?? 1;
    const failedAttemptsCount = await this.incrementFailedAttempts(createChat);

    if (failedAttemptsCount < quantity) {
      return false;
    }

    await this.resetFailedAttempts(createChat);

    const { user, sector } = await this.getRedirectTargets(
      redirectFailedAttempts,
      createChat
    );

    await this.sendTransferMessageIfNeeded(
      t,
      createChat,
      redirectFailedAttempts.redirect_type,
      user,
      sector,
      customMessages,
      {
        transfer_message_user_enabled:
          customMessages?.transfer_message_user_enabled,
        transfer_message_sector_enabled:
          customMessages?.transfer_message_sector_enabled,
        transfer_message_sector_user_enabled:
          customMessages?.transfer_message_sector_user_enabled,
      }
    );

    await this.updateAndPublishChat(t, createChat, user, sector);

    return true;
  }

  private shouldRedirectOnFailedAttempt(
    redirectFailedAttempts?: {
      status?: string;
      quantity?: number;
      redirect_type?: string;
      selected_user?: string;
      selected_sector?: string;
      selected_sector_user?: string;
    },
    createChat?: IChat
  ): boolean {
    return (
      !!redirectFailedAttempts &&
      redirectFailedAttempts.status === 'active' &&
      (createChat?.status === EChatStatus.ura ||
        createChat?.status === EChatStatus.ura_output ||
        createChat?.status === EChatStatus.ura_schedule ||
        createChat?.status === EChatStatus.ura_webhook)
    );
  }

  private async getRedirectTargets(
    redirectFailedAttempts: {
      status?: string;
      quantity?: number;
      redirect_type?: string;
      selected_user?: string;
      selected_sector?: string;
      selected_sector_user?: string;
    },
    createChat: IChat
  ): Promise<{
    user: IChat['user'] | null | undefined;
    sector: IChat['sector'] | null | undefined;
  }> {
    const redirectType = redirectFailedAttempts.redirect_type;
    let user: IChat['user'] | null | undefined = undefined;
    let sector: IChat['sector'] | null | undefined = undefined;

    if (redirectType === 'user') {
      user = await this.getUserForRedirect(
        redirectFailedAttempts.selected_user
      );
    }

    if (redirectType === 'sector') {
      sector = await this.getSectorForRedirect(
        redirectFailedAttempts.selected_sector,
        createChat.account.id
      );
      user = await this.getUserForRedirect(
        redirectFailedAttempts.selected_sector_user
      );
    }

    return { user, sector };
  }

  private async getUserForRedirect(
    userId?: string
  ): Promise<IChat['user'] | null | undefined> {
    if (!userId) {
      return undefined;
    }

    const userData = await this.userService.viewUserNamePhoto(userId);
    if (!userData) {
      return undefined;
    }

    return {
      id: userData.id,
      name: userData.name,
      photo: userData.photo ?? null,
    };
  }

  private async getSectorForRedirect(
    sectorId?: string,
    accountId?: string
  ): Promise<IChat['sector'] | null | undefined> {
    if (!sectorId || !accountId) {
      return undefined;
    }

    const sectorData = await this.sectorService.viewSectorById(
      sectorId,
      accountId
    );

    if (!sectorData) {
      return undefined;
    }

    return {
      id: sectorData.sector_id,
      name: sectorData.name,
      color: sectorData.color,
    };
  }

  private async sendTransferMessageIfNeeded(
    t: TFunction<'translation', undefined>,
    chatContext: IChat,
    redirectType?: string,
    user?: IChat['user'] | null | undefined,
    sector?: IChat['sector'] | null | undefined,
    customMessages?: IChatbotCustomMessages,
    enabledFlags?: {
      transfer_message_user_enabled?: boolean;
      transfer_message_sector_enabled?: boolean;
      transfer_message_sector_user_enabled?: boolean;
    }
  ): Promise<void> {
    const { rawTransferMessage, enabled } = this.getTransferMessage(
      t,
      redirectType,
      user,
      sector,
      customMessages,
      enabledFlags
    );

    if (!rawTransferMessage || (!user && !sector) || enabled === false) {
      return;
    }

    const transferMessage = await this.replaceVariables(
      t,
      rawTransferMessage,
      chatContext,
      user,
      sector
    );

    await this.sendMessageWithStatusGuard(t, {
      chat: chatContext,
      accountId: chatContext.account.id,
      type: EMessageType.system,
      message: transferMessage,
      typeUser: ETypeUserChat.bot,
    });
  }

  private getTransferMessage(
    t: TFunction<'translation', undefined>,
    redirectType?: string,
    user?: IChat['user'] | null | undefined,
    sector?: IChat['sector'] | null | undefined,
    customMessages?: IChatbotCustomMessages,
    enabledFlags?: {
      transfer_message_user_enabled?: boolean;
      transfer_message_sector_enabled?: boolean;
      transfer_message_sector_user_enabled?: boolean;
    }
  ): { rawTransferMessage: string | undefined; enabled: boolean | undefined } {
    if (redirectType === 'user' && user) {
      return {
        rawTransferMessage:
          customMessages?.transfer_message_user ||
          t('chatbot_transfer_message_user_default'),
        enabled: enabledFlags?.transfer_message_user_enabled,
      };
    }

    if (redirectType === 'sector' && sector) {
      if (user) {
        return {
          rawTransferMessage:
            customMessages?.transfer_message_sector_user ||
            t('chatbot_transfer_message_sector_user_default'),
          enabled: enabledFlags?.transfer_message_sector_user_enabled,
        };
      }
      return {
        rawTransferMessage:
          customMessages?.transfer_message_sector ||
          t('chatbot_transfer_message_sector_default'),
        enabled: enabledFlags?.transfer_message_sector_enabled,
      };
    }

    return { rawTransferMessage: undefined, enabled: undefined };
  }

  private readonly FAILED_ATTEMPTS_CACHE_TTL_SECONDS = 86400;

  private async incrementFailedAttempts(createChat: IChat): Promise<number> {
    const key = this.getFailedAttemptsCacheKey(
      createChat.account.id,
      createChat.worker.id,
      createChat.chat_id
    );

    const newValue = await this.redis.incr(key);
    await this.redis.expire(key, this.FAILED_ATTEMPTS_CACHE_TTL_SECONDS);

    return newValue;
  }

  private async resetFailedAttempts(createChat: IChat): Promise<void> {
    const key = this.getFailedAttemptsCacheKey(
      createChat.account.id,
      createChat.worker.id,
      createChat.chat_id
    );

    await this.redis.del(key);
  }

  private async executePendingFinishEffect(
    t: TFunction<'translation', undefined>,
    effect: IChatbotPendingFinishEffect,
    ids: { accountId: string; workerId: string; chatId: string },
    sourceCacheKey = this.getPendingFinishEffectKey(
      ids.accountId,
      ids.workerId,
      ids.chatId
    )
  ): Promise<void> {
    if (
      effect.accountId !== ids.accountId ||
      effect.workerId !== ids.workerId ||
      effect.chatId !== ids.chatId ||
      (effect.source !== 'chatbot' && effect.source !== 'outside_hours') ||
      (effect.phase !== 'transition_pending' &&
        effect.phase !== 'effects_pending')
    ) {
      await this.removePendingFinishEffect(
        ids.accountId,
        ids.workerId,
        ids.chatId
      );
      return;
    }

    const chat = await this.chatService.findChatByChatId(
      effect.accountId,
      effect.chatId
    );
    if (
      effect.source === 'chatbot' &&
      effect.phase === 'transition_pending' &&
      chat &&
      (await this.shouldSuspendInactivityForOfficialChat(chat))
    ) {
      await this.removePendingFinishEffect(
        effect.accountId,
        effect.workerId,
        effect.chatId
      );
      return;
    }

    if (effect.phase === 'transition_pending') {
      const ownsCurrentState =
        chat?.status === EChatStatus.closed
          ? Boolean(
              effect.statusEventId &&
              chat.meta?.status_event_id === effect.statusEventId &&
              chat.meta.status_source === effect.source
            )
          : Boolean(
              chat &&
              (effect.source === 'outside_hours' ||
                this.isAutomationChatStatus(chat.status)) &&
              this.isPendingTransitionOwnedByChat(effect, chat)
            );
      if (!chat || !ownsCurrentState) {
        await this.removePendingFinishEffect(
          effect.accountId,
          effect.workerId,
          effect.chatId
        );
        return;
      }

      if (effect.source === 'outside_hours') {
        const outcome = await this.sendOutsideHoursFinishMessage(
          t,
          chat,
          effect.customMessage ?? ''
        );
        const migrated = await this.acknowledgeMigratedFinishEffect(
          sourceCacheKey,
          chat
        );
        if (outcome === 'queued') {
          if (migrated) {
            return;
          }
          throw new Error('outside-hours finish transition remains queued');
        }
        return;
      }

      const transitioned = await this.sendFinishMessage(
        t,
        chat,
        effect.customMessage,
        effect.messageEnabled,
        chat
      );
      const migrated = await this.acknowledgeMigratedFinishEffect(
        sourceCacheKey,
        chat
      );
      if (!transitioned) {
        if (migrated) {
          return;
        }
        throw new Error('chatbot finish transition was not confirmed');
      }
      return;
    }

    if (
      !effect.statusEventId ||
      !chat ||
      chat.status !== EChatStatus.closed ||
      chat.meta?.status_source !== effect.source ||
      chat.meta.status_event_id !== effect.statusEventId
    ) {
      await this.removePendingFinishEffect(
        effect.accountId,
        effect.workerId,
        effect.chatId
      );
      return;
    }

    if (!effect.messageEnabled) {
      await this.removePendingFinishEffect(
        effect.accountId,
        effect.workerId,
        effect.chatId
      );
      return;
    }

    const message = await this.resolvePendingFinishMessage(t, effect, chat);
    const messageSent = await this.sendMessageWithStatusGuard(
      t,
      {
        chat,
        accountId: chat.account.id,
        messageId: effect.statusEventId,
        type:
          effect.source === 'outside_hours'
            ? EMessageType.text
            : EMessageType.system,
        message,
        typeUser:
          effect.source === 'outside_hours'
            ? ETypeUserChat.system
            : ETypeUserChat.bot,
        securityKeyScopes: effect.source === 'outside_hours' ? [] : undefined,
      },
      {
        allowClosedStatus: true,
        expectedStatusEventId: effect.statusEventId,
      }
    );
    if (!messageSent) {
      throw new Error('chatbot finish message was not persisted');
    }

    await this.removePendingFinishEffect(
      effect.accountId,
      effect.workerId,
      effect.chatId
    );
  }

  private async resolvePendingFinishMessage(
    t: TFunction<'translation', undefined>,
    effect: IChatbotPendingFinishEffect,
    chat: IChat
  ): Promise<string> {
    if (effect.source === 'chatbot') {
      return this.replaceVariables(
        t,
        effect.customMessage || t('chatbot_service_finished'),
        chat,
        chat.user,
        chat.sector
      );
    }

    let protocol: string | null = null;
    const rawMessage = effect.customMessage ?? '';
    if (hasProtocolTag(rawMessage)) {
      protocol =
        (await this.chatService.getOrCreateChatProtocol(
          chat.account.id,
          chat.chat_id,
          'protocol_start'
        )) || this.chatService.getLatestProtocolByType(chat, 'protocol_start');
    }

    return replaceMessageTags({
      message: rawMessage,
      chat,
      t,
      protocol,
    }).trim();
  }

  private isPendingTransitionOwnedByChat(
    effect: IChatbotPendingFinishEffect,
    chat: IChat
  ): boolean {
    if (effect.expectedStatus !== chat.status) {
      return false;
    }

    if (
      effect.expectedLastMessageId !== undefined &&
      effect.expectedLastMessageId !== (chat.summary?.last_message_id ?? null)
    ) {
      return false;
    }

    if (effect.expectedStatusEventId) {
      return chat.meta?.status_event_id === effect.expectedStatusEventId;
    }

    if (chat.meta?.status_event_id) {
      return false;
    }

    if (effect.expectedStatusEpoch !== undefined) {
      return chat.meta?.status_epoch === effect.expectedStatusEpoch;
    }

    return (chat.started_at ?? null) === (effect.expectedStartedAt ?? null);
  }

  private async acknowledgeMigratedFinishEffect(
    sourceCacheKey: string,
    chat: IChat
  ): Promise<boolean> {
    const currentCacheKey = this.getPendingFinishEffectKey(
      chat.account.id,
      chat.worker.id,
      chat.chat_id
    );
    if (currentCacheKey === sourceCacheKey) {
      return false;
    }

    await this.removePendingFinishEffectByCacheKey(sourceCacheKey);
    return true;
  }

  private async requeuePendingFinishEffectAfterFailure(
    cacheKey: string,
    failedEffect: IChatbotPendingFinishEffect
  ): Promise<void> {
    const latestPayload = await this.redis.get(cacheKey);
    if (!latestPayload) {
      return;
    }

    const latest = JSON.parse(latestPayload) as IChatbotPendingFinishEffect;
    if (
      latest.phase !== failedEffect.phase ||
      latest.statusEventId !== failedEffect.statusEventId ||
      latest.retryCount !== failedEffect.retryCount
    ) {
      return;
    }

    const retryCount = failedEffect.retryCount + 1;
    await this.persistPendingFinishEffect(
      { ...failedEffect, retryCount },
      Date.now() + this.getInactivityRetryDelayMs(retryCount)
    );
  }

  private async processPendingFinishEffectWithLock(
    t: TFunction<'translation', undefined>,
    cacheKey: string,
    ids: { accountId: string; workerId: string; chatId: string }
  ): Promise<void> {
    const scheduledScore = await this.redis.zscore(
      this.getPendingFinishScheduleKey(),
      cacheKey
    );
    if (scheduledScore === null || Number(scheduledScore) > Date.now()) {
      return;
    }

    const payload = await this.redis.get(cacheKey);
    if (!payload) {
      await this.removePendingFinishEffectByCacheKey(cacheKey);
      return;
    }

    let effect: IChatbotPendingFinishEffect;
    try {
      effect = JSON.parse(payload) as IChatbotPendingFinishEffect;
    } catch (error) {
      await this.removePendingFinishEffect(
        ids.accountId,
        ids.workerId,
        ids.chatId
      );
      console.error('[ChatbotFlow] invalid finish effect removed', {
        account_id: ids.accountId,
        chat_id: ids.chatId,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    try {
      await this.executePendingFinishEffect(t, effect, ids, cacheKey);
    } catch (error) {
      try {
        await this.requeuePendingFinishEffectAfterFailure(cacheKey, effect);
      } catch (requeueError) {
        console.error('[ChatbotFlow] finish effect requeue failed', {
          account_id: effect.accountId,
          chat_id: effect.chatId,
          status_event_id: effect.statusEventId,
          error:
            requeueError instanceof Error
              ? requeueError.message
              : String(requeueError),
        });
      }

      console.error('[ChatbotFlow] finish effect failed', {
        account_id: effect.accountId,
        chat_id: effect.chatId,
        status_event_id: effect.statusEventId ?? null,
        retry_count: effect.retryCount,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async processScheduledFinishEffects(
    t: TFunction<'translation', undefined>
  ): Promise<void> {
    const scheduleKey = this.getPendingFinishScheduleKey();
    const dueKeys = await this.redis.zrangebyscore(
      scheduleKey,
      0,
      Date.now(),
      'LIMIT',
      0,
      100
    );

    for (const cacheKey of dueKeys) {
      const ids = this.parsePendingFinishEffectKey(cacheKey);
      if (!ids) {
        await this.removePendingFinishEffectByCacheKey(cacheKey);
        continue;
      }

      try {
        await withLock(
          this.redis,
          this.getAutomationLockKey(ids.accountId, ids.chatId),
          () => this.processPendingFinishEffectWithLock(t, cacheKey, ids),
          {
            ttlMs: 30000,
            retryMs: 100,
            maxWaitMs: 45000,
          }
        );
      } catch (error) {
        console.error('[ChatbotFlow] finish effect lock failed', {
          account_id: ids.accountId,
          chat_id: ids.chatId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private isInactivityRedirectSourceOwned(
    effect: IChatbotInactivityRedirectEffect,
    chat: IChat
  ): boolean {
    return (
      this.isAutomationChatStatus(chat.status) &&
      chat.worker.id === effect.sourceWorkerId &&
      chat.status === effect.expectedStatus &&
      (chat.meta?.status_event_id ?? null) ===
        (effect.expectedStatusEventId ?? null) &&
      (chat.meta?.status_epoch ?? null) ===
        (effect.expectedStatusEpoch ?? null) &&
      (chat.meta?.assignment_event_id ?? null) ===
        (effect.expectedAssignmentEventId ?? null) &&
      (chat.meta?.assignment_epoch ?? null) ===
        (effect.expectedAssignmentEpoch ?? null) &&
      (chat.summary?.last_message_id ?? null) ===
        (effect.expectedLastMessageId ?? null) &&
      (chat.summary?.revision ?? 0) === (effect.expectedSummaryRevision ?? 0)
    );
  }

  private async executeInactivityRedirectEffect(
    t: TFunction<'translation', undefined>,
    cacheKey: string,
    effect: IChatbotInactivityRedirectEffect,
    ids: { accountId: string; chatId: string }
  ): Promise<void> {
    if (
      effect.accountId !== ids.accountId ||
      effect.chatId !== ids.chatId ||
      !effect.sourceWorkerId ||
      !effect.sourceChatbotId ||
      !effect.targetWorkerId ||
      !effect.targetChatbotId ||
      !effect.operationId ||
      (effect.phase !== 'transition_pending' &&
        effect.phase !== 'bootstrap_pending')
    ) {
      await this.removeInactivityRedirectEffectByCacheKey(cacheKey);
      return;
    }
    const chat = await this.chatService.findChatByChatId(
      effect.accountId,
      effect.chatId
    );
    if (!chat) {
      await this.removeInactivityRedirectEffectByCacheKey(cacheKey);
      return;
    }

    if (effect.phase === 'transition_pending') {
      if (await this.shouldSuspendInactivityForOfficialChat(chat)) {
        await this.removeInactivityRedirectEffectByCacheKey(cacheKey);
        return;
      }

      if (!this.chatbotTransferService) {
        throw new Error('chatbot transfer service is unavailable');
      }

      const transitionAlreadyApplied =
        chat.meta?.assignment_event_id === effect.operationId;
      if (!transitionAlreadyApplied) {
        if (!this.isInactivityRedirectSourceOwned(effect, chat)) {
          await this.removeInactivityRedirectEffectByCacheKey(cacheKey);
          return;
        }
      } else {
        const currentLastMessageId = chat.summary?.last_message_id ?? null;
        const hasConcurrentActivity =
          currentLastMessageId !== null &&
          currentLastMessageId !== (effect.expectedLastMessageId ?? null);
        if (hasConcurrentActivity) {
          await this.removeInactivityRedirectEffectByCacheKey(cacheKey);
          return;
        }
      }

      const result = await this.chatbotTransferService.transfer({
        t,
        accountId: effect.accountId,
        chat,
        targetWorkerId: effect.targetWorkerId,
        targetChatbotId: effect.targetChatbotId,
        operationId: effect.operationId,
        eventEpochMillis: effect.eventEpochMillis,
        source: 'chatbot_inactivity',
        actor: { type: 'automation', id: effect.sourceChatbotId },
        expectedLastMessageId: effect.expectedLastMessageId ?? null,
        expectedSummaryRevision: effect.expectedSummaryRevision ?? 0,
      });

      if (result.concurrentActivity) {
        await this.removeInactivityRedirectEffectByCacheKey(cacheKey);
        return;
      }

      await Promise.all(
        Array.from(new Set([effect.sourceWorkerId, effect.targetWorkerId])).map(
          (workerId) =>
            this.clearChatbotRuntimeStateByIds(
              effect.accountId,
              workerId,
              effect.chatId
            )
        )
      );

      await this.persistInactivityRedirectEffect({
        ...effect,
        phase: 'bootstrap_pending',
        expectedStatus: result.chat.status,
        expectedStatusEventId: result.chat.meta?.status_event_id ?? null,
        expectedStatusEpoch: result.chat.meta?.status_epoch ?? null,
        expectedAssignmentEventId: effect.operationId,
        expectedAssignmentEpoch:
          result.chat.meta?.assignment_epoch ?? effect.eventEpochMillis,
        postTransitionLastMessageId:
          result.chat.summary?.last_message_id ?? null,
        retryCount: 0,
      });
      return;
    }

    if (!this.chatbotTransferService) {
      throw new Error('chatbot transfer service is unavailable');
    }

    await this.chatbotTransferService.resolveTarget(
      t,
      effect.accountId,
      effect.targetWorkerId,
      effect.targetChatbotId
    );
    if (
      chat.worker.id !== effect.targetWorkerId ||
      chat.status !== effect.expectedStatus ||
      chat.meta?.assignment_event_id !== effect.operationId ||
      (chat.summary?.last_message_id ?? null) !==
        (effect.postTransitionLastMessageId ?? null)
    ) {
      await this.removeInactivityRedirectEffectByCacheKey(cacheKey);
      return;
    }

    await this.bootstrapTransferredChatbot(
      t,
      chat,
      effect.targetChatbotId,
      effect.operationId,
      [effect.sourceWorkerId],
      true,
      {
        expectedAssignmentEventId: effect.operationId,
        expectedLastMessageId: effect.postTransitionLastMessageId ?? null,
      }
    );
    await this.removeInactivityRedirectEffectByCacheKey(cacheKey);
  }

  private async requeueInactivityRedirectEffectAfterFailure(
    cacheKey: string,
    failedEffect: IChatbotInactivityRedirectEffect
  ): Promise<void> {
    const latestPayload = await this.redis.get(cacheKey);
    if (!latestPayload) return;

    const latest = JSON.parse(
      latestPayload
    ) as IChatbotInactivityRedirectEffect;
    if (
      latest.operationId !== failedEffect.operationId ||
      latest.phase !== failedEffect.phase ||
      latest.retryCount !== failedEffect.retryCount
    ) {
      return;
    }

    const retryCount = failedEffect.retryCount + 1;
    await this.persistInactivityRedirectEffect(
      { ...failedEffect, retryCount },
      Date.now() + this.getInactivityRetryDelayMs(retryCount)
    );
  }

  private async processInactivityRedirectEffectByKey(
    t: TFunction<'translation', undefined>,
    cacheKey: string
  ): Promise<void> {
    const ids = this.parseInactivityRedirectEffectKey(cacheKey);
    if (!ids) {
      await this.removeInactivityRedirectEffectByCacheKey(cacheKey);
      return;
    }
    const score = await this.redis.zscore(
      this.getInactivityRedirectScheduleKey(),
      cacheKey
    );
    if (score === null || Number(score) > Date.now()) return;

    const payload = await this.redis.get(cacheKey);
    if (!payload) {
      await this.removeInactivityRedirectEffectByCacheKey(cacheKey);
      return;
    }

    let effect: IChatbotInactivityRedirectEffect;
    try {
      effect = JSON.parse(payload) as IChatbotInactivityRedirectEffect;
    } catch {
      await this.removeInactivityRedirectEffectByCacheKey(cacheKey);
      return;
    }

    try {
      if (effect.phase === 'transition_pending') {
        await withLock(
          this.redis,
          this.getAutomationLockKey(ids.accountId, ids.chatId),
          () => this.executeInactivityRedirectEffect(t, cacheKey, effect, ids),
          { ttlMs: 60_000, retryMs: 100, maxWaitMs: 90_000 }
        );
      } else {
        await this.executeInactivityRedirectEffect(t, cacheKey, effect, ids);
      }
    } catch (error) {
      await this.requeueInactivityRedirectEffectAfterFailure(
        cacheKey,
        effect
      ).catch(() => undefined);
      console.error('[ChatbotFlow] inactivity redirect effect failed', {
        account_id: effect.accountId,
        chat_id: effect.chatId,
        operation_id: effect.operationId,
        phase: effect.phase,
        retry_count: effect.retryCount,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async processScheduledInactivityRedirectEffects(
    t: TFunction<'translation', undefined>
  ): Promise<void> {
    const dueKeys = await this.redis.zrangebyscore(
      this.getInactivityRedirectScheduleKey(),
      0,
      Date.now(),
      'LIMIT',
      0,
      100
    );
    for (const cacheKey of dueKeys) {
      await this.processInactivityRedirectEffectByKey(t, cacheKey);
    }
  }

  async processScheduledInactivityChecks(
    t: TFunction<'translation', undefined>
  ): Promise<void> {
    try {
      await this.processScheduledAiAgentDebounces(t);
    } catch (error) {
      console.error('[ChatbotFlow] AI Agent debounce scheduler failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      await this.processScheduledFinishEffects(t);
    } catch (error) {
      console.error('[ChatbotFlow] pending finish scheduler failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      await this.processScheduledInactivityRedirectEffects(t);
    } catch (error) {
      console.error('[ChatbotFlow] pending redirect scheduler failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const scheduleKey = this.getInactivityScheduleKey();

    try {
      await this.reconcileInactivitySchedule();
    } catch (error) {
      console.error('[ChatbotFlow] inactivity reconciliation failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const keysToCheck = await this.redis.zrangebyscore(
      scheduleKey,
      0,
      Date.now(),
      'LIMIT',
      0,
      100
    );

    if (keysToCheck.length === 0) {
      return;
    }

    for (const inactivityCacheKey of keysToCheck) {
      let inactivityData: IInactivityData | null = null;

      try {
        const inactivityDataStr = await this.redis.get(inactivityCacheKey);
        if (!inactivityDataStr) {
          await this.recoverMissingInactivityPayload(inactivityCacheKey);
          continue;
        }

        try {
          inactivityData = JSON.parse(inactivityDataStr) as IInactivityData;
        } catch {
          await this.removeInactivityScheduleIfUnchanged(
            inactivityCacheKey,
            null
          );
          console.error('[ChatbotFlow] invalid inactivity payload removed', {
            inactivity_cache_key: inactivityCacheKey,
          });
          continue;
        }

        if (Date.now() < inactivityData.lastInteraction) {
          throw new Error('chatbot inactivity timestamp is in the future');
        }

        const chatbotFlow =
          await this.chatbotService.findChatbotFlowByChatbotId(
            inactivityData.accountId,
            inactivityData.chatbotId
          );

        if (!chatbotFlow) {
          await this.removeInactivityScheduleIfUnchanged(
            inactivityCacheKey,
            inactivityData
          );
          continue;
        }

        const configurations =
          await this.chatbotService.findChatbotFlowConfigurationsByChatbotId(
            inactivityData.accountId,
            inactivityData.chatbotId
          );

        const inactivityAlert =
          configurations?.configurations?.inactivity_alert;

        if (inactivityAlert?.status !== 'active') {
          await this.removeInactivityScheduleIfUnchanged(
            inactivityCacheKey,
            inactivityData
          );
          continue;
        }

        const createChat = await this.chatService.findChatByChatId(
          inactivityData.accountId,
          inactivityData.chatId
        );

        if (!createChat) {
          await this.removeInactivityScheduleIfUnchanged(
            inactivityCacheKey,
            inactivityData
          );
          continue;
        }

        const messages = configurations?.configurations?.messages;
        const customMessages = messages
          ? {
              transfer_message_user: messages.transfer_message_user,
              transfer_message_sector: messages.transfer_message_sector,
              transfer_message_sector_user:
                messages.transfer_message_sector_user,
            }
          : undefined;

        await this.withAutomationLock(createChat, async () => {
          const scheduledScore = await this.redis.zscore(
            scheduleKey,
            inactivityCacheKey
          );
          if (scheduledScore === null || Number(scheduledScore) > Date.now()) {
            return;
          }

          const lockedPayload = await this.redis.get(inactivityCacheKey);
          if (!lockedPayload) {
            throw new Error('chatbot inactivity payload disappeared');
          }
          inactivityData = JSON.parse(lockedPayload) as IInactivityData;

          const isFinishingRetry =
            inactivityData.stage === 'finishing' &&
            inactivityAlert.action === 'finish';
          const activeChat = await this.getAutomationChatIfAllowed(createChat, {
            allowClosedStatus: isFinishingRetry,
          });
          if (!activeChat) {
            await this.removeInactivitySchedule(inactivityCacheKey);
            return;
          }

          if (await this.shouldSuspendInactivityForOfficialChat(activeChat)) {
            await this.removeInactivitySchedule(inactivityCacheKey);
            return;
          }

          if (
            await this.restartFinishingInactivityAfterNewActivity(
              inactivityCacheKey,
              inactivityData,
              activeChat,
              inactivityAlert.time ?? 5
            )
          ) {
            return;
          }

          const processed = await this.processInactivityAlert(
            t,
            inactivityCacheKey,
            inactivityData,
            inactivityAlert,
            activeChat,
            messages?.inactivity_message,
            messages?.service_finished_message,
            customMessages,
            {
              inactivity_message_enabled:
                messages?.inactivity_message_enabled !== false,
              service_finished_message_enabled:
                messages?.service_finished_message_enabled !== false,
              transfer_message_user_enabled:
                messages?.transfer_message_user_enabled !== false,
              transfer_message_sector_enabled:
                messages?.transfer_message_sector_enabled !== false,
              transfer_message_sector_user_enabled:
                messages?.transfer_message_sector_user_enabled !== false,
            }
          );

          if (!processed) {
            throw new Error('chatbot inactivity action was not completed');
          }
        });
      } catch (error) {
        if (inactivityData) {
          try {
            inactivityData = await this.requeueInactivityAfterFailure(
              inactivityCacheKey,
              inactivityData
            );
          } catch (requeueError) {
            console.error('[ChatbotFlow] inactivity requeue failed', {
              error:
                requeueError instanceof Error
                  ? requeueError.message
                  : String(requeueError),
              inactivity_cache_key: inactivityCacheKey,
            });
          }
        }

        console.error('[ChatbotFlow] processScheduledInactivityChecks failed', {
          error: error instanceof Error ? error.message : String(error),
          accountId: inactivityData?.accountId,
          workerId: inactivityData?.workerId,
          chatId: inactivityData?.chatId,
          retryCount: inactivityData?.retryCount,
        });
      }
    }
  }

  private async generateAndSendAiWelcomeMessage(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    aiAgent: ViewAiAgentResponse
  ): Promise<boolean> {
    if (!aiAgent.base_url || !aiAgent.api_key || !aiAgent.model) {
      const fallback = t('ai_agent_default_question');
      return this.sendMessageWithStatusGuard(t, {
        chat: createChat,
        accountId: createChat.account.id,
        type: EMessageType.text,
        message: fallback,
        typeUser: ETypeUserChat.bot,
      });
    }

    const contactName = await this.getContactName(createChat);
    const greeting = this.getGreeting(t);
    const name = contactName || createChat.name || '';

    const systemPrompt = `Você é um assistente de atendimento ao cliente amigável e profissional. Gere uma mensagem de boas-vindas curta e natural para iniciar uma conversa de atendimento.

Diretrizes:
- Seja caloroso, gentil e profissional
- ${name ? `Use o nome do cliente: ${name}` : 'O nome do cliente não está disponível, não use nome'}
- Pergunte como pode ajudar
- Mantenha a mensagem breve (máximo 2-3 frases)
- Varie a mensagem - não use sempre a mesma saudação
- Não mencione que é uma IA ou robô
- Use a saudação apropriada para o horário: ${greeting}
${aiAgent.system_prompt ? `\nContexto do agente:\n${aiAgent.system_prompt.substring(0, 300)}` : ''}`;

    let finalMessage: string;

    try {
      const welcomeMessage = await this.callAiAgentChatApiWithRetry(
        aiAgent.base_url,
        aiAgent.api_key,
        aiAgent.model,
        aiAgent.ai_agent_type_id,
        systemPrompt,
        'Gere uma mensagem de boas-vindas para o início do atendimento.'
      );
      finalMessage =
        welcomeMessage && welcomeMessage.trim().length > 0
          ? welcomeMessage.trim()
          : this.buildFallbackWelcomeMessage(name, greeting);
    } catch (error) {
      console.error(
        '[ChatbotFlow] generateAndSendAiWelcomeMessage failed, using fallback',
        error
      );
      finalMessage = this.buildFallbackWelcomeMessage(name, greeting);
    }

    const voiceSent = await this.trySendAsVoiceMessage(
      t,
      createChat,
      aiAgent,
      finalMessage
    );

    const messageSent = voiceSent
      ? true
      : await this.sendMessageWithStatusGuard(t, {
          chat: createChat,
          accountId: createChat.account.id,
          type: EMessageType.text,
          message: finalMessage,
          typeUser: ETypeUserChat.bot,
        });
    if (!messageSent) {
      return false;
    }

    await this.pushToConversationHistory(
      createChat.account.id,
      createChat.worker.id,
      createChat.chat_id,
      aiAgent.ai_agent_id,
      'assistant',
      finalMessage
    );
    return true;
  }

  private buildFallbackWelcomeMessage(name: string, greeting: string): string {
    return name
      ? `${greeting}, ${name}! Como posso ajudar você hoje?`
      : `${greeting}! Como posso ajudar você hoje?`;
  }

  private async trySendAsVoiceMessage(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    aiAgent: ViewAiAgentResponse,
    text: string
  ): Promise<boolean> {
    if (!aiAgent.voice_ia_id) {
      return false;
    }

    try {
      const voiceIaConfig = await this.voiceIaService.viewVoiceIa(
        aiAgent.voice_ia_id,
        createChat.account.id
      );

      if (!voiceIaConfig?.api_key) {
        return false;
      }

      const cleanedText = stripTextForTts(text);
      if (cleanedText.trim().length === 0) {
        return false;
      }

      const uploadResult =
        await this.voiceIaIntegrationService.generateSpeechAndUpload(
          cleanedText,
          voiceIaConfig,
          createChat.account.id
        );

      if (!uploadResult) {
        return false;
      }

      return this.sendMessageWithStatusGuard(t, {
        chat: createChat,
        accountId: createChat.account.id,
        type: EMessageType.audio,
        audioUrl: uploadResult.url,
        audioMimetype: uploadResult.mimetype,
        audioPtt: true,
        typeUser: ETypeUserChat.bot,
      });
    } catch (error) {
      console.error('[ChatbotFlow] trySendAsVoiceMessage failed', error);
      return false;
    }
  }

  private async analyzeUserIntentWithContext(
    aiAgent: ViewAiAgentResponse,
    userText: string,
    recentMessages: Array<{ role: 'user' | 'assistant'; content: string }>,
    humanSupportEnabled: boolean
  ): Promise<'needs_help' | 'resolved' | 'human_support'> {
    if (!aiAgent.base_url || !aiAgent.api_key || !aiAgent.model) {
      return 'needs_help';
    }

    try {
      const controlAction = await this.classifyConversationControlAction(
        aiAgent,
        userText,
        recentMessages,
        humanSupportEnabled
      );

      if (!controlAction) {
        const resolvedByFallback = await this.confirmResolvedIntentWithAgent(
          aiAgent,
          userText,
          recentMessages,
          0
        );
        return resolvedByFallback ? 'resolved' : 'needs_help';
      }

      if (controlAction.action === 'human_support') {
        return humanSupportEnabled ? 'human_support' : 'needs_help';
      }

      const resolvedConfirmed = await this.confirmResolvedIntentWithAgent(
        aiAgent,
        userText,
        recentMessages,
        controlAction.confidence
      );
      if (resolvedConfirmed) {
        return 'resolved';
      }

      return 'needs_help';
    } catch (error) {
      if (this.isAiInteractionError(error)) {
        throw error;
      }
      console.error('[ChatbotFlow] analyzeUserIntentWithContext failed', error);
      return 'needs_help';
    }
  }

  private async classifyConversationControlAction(
    aiAgent: ViewAiAgentResponse,
    userText: string,
    recentMessages: Array<{ role: 'user' | 'assistant'; content: string }>,
    humanSupportEnabled: boolean
  ): Promise<{
    action: 'continue' | 'finish' | 'human_support';
    confidence: number;
  } | null> {
    if (!aiAgent.base_url || !aiAgent.api_key || !aiAgent.model) {
      return null;
    }

    const basePrompt = this.buildConversationControlActionPrompt(
      userText,
      recentMessages,
      humanSupportEnabled
    );
    const prompts = [
      basePrompt,
      `${basePrompt}\n\nATENÇÃO: Sua resposta anterior foi inválida. Retorne somente JSON válido exatamente no formato solicitado.`,
    ];

    for (const prompt of prompts) {
      const analysis = await this.callAiAgentChatApiWithRetry(
        aiAgent.base_url,
        aiAgent.api_key,
        aiAgent.model,
        aiAgent.ai_agent_type_id,
        prompt,
        userText,
        recentMessages.slice(-20)
      );

      const parsed = this.parseConversationControlActionResult(analysis);
      if (parsed) {
        if (parsed.action === 'human_support' && !humanSupportEnabled) {
          return { action: 'continue', confidence: 1 };
        }
        return parsed;
      }
    }

    return null;
  }

  private buildConversationControlActionPrompt(
    userText: string,
    recentMessages: Array<{ role: 'user' | 'assistant'; content: string }>,
    humanSupportEnabled: boolean
  ): string {
    const conversationContext = recentMessages
      .slice(-20)
      .map(
        (msg) =>
          `${msg.role === 'user' ? 'Usuário' : 'Assistente'}: ${msg.content}`
      )
      .join('\n');

    const humanSupportRule = humanSupportEnabled
      ? '- Se o usuário pedir explicitamente atendimento humano (atendente, operador, pessoa real, suporte humano), marque action = "human_support".'
      : '- Transferência humana está desabilitada. Neste caso, NUNCA use action = "human_support". Use "continue".';

    return `Você é um classificador semântico de controle de atendimento.

Objetivo:
Classificar a ÚLTIMA mensagem do usuário para decidir a ação do fluxo.

Ações possíveis:
- "continue": continuar atendimento normal.
- "finish": usuário quer encerrar/finalizar o atendimento e não deseja mais ajuda.
- "human_support": usuário quer falar com humano.

Regras:
1. Se a última mensagem trouxer nova pergunta, novo pedido, nova dúvida ou continuação de tema, use "continue".
2. Se a última mensagem indicar claramente intenção de finalizar o atendimento, use "finish".
3. ${humanSupportRule}
4. Em ambiguidade, use "continue".
5. Seja conservador: jamais finalize quando houver dúvida sobre a intenção.

Exemplos que normalmente indicam "finish":
- "obrigado, era isso"
- "quero finalizar o atendimento"
- "pode encerrar"
- "não preciso de mais ajuda"

Histórico recente:
${conversationContext || '(sem histórico anterior)'}

Última mensagem do usuário:
"${userText}"

Retorne APENAS JSON válido (sem markdown):
{"action":"continue|finish|human_support","confidence":0.0}`;
  }

  private parseConversationControlActionResult(analysis: string): {
    action: 'continue' | 'finish' | 'human_support';
    confidence: number;
  } | null {
    if (!analysis || typeof analysis !== 'string') {
      return null;
    }

    const jsonMatch = analysis.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) {
      return null;
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      const rawAction = String(parsed.action ?? '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '_');

      if (
        rawAction !== 'continue' &&
        rawAction !== 'finish' &&
        rawAction !== 'human_support'
      ) {
        return null;
      }

      const rawConfidence =
        typeof parsed.confidence === 'number'
          ? parsed.confidence
          : typeof parsed.score === 'number'
            ? parsed.score
            : 0.5;
      const confidence =
        typeof rawConfidence === 'number' && Number.isFinite(rawConfidence)
          ? Math.min(1, Math.max(0, rawConfidence))
          : 0.5;

      return {
        action: rawAction as 'continue' | 'finish' | 'human_support',
        confidence,
      };
    } catch (error) {
      console.error(
        '[ChatbotFlow] parseConversationControlActionResult failed',
        error
      );
      return null;
    }
  }

  private async confirmResolvedIntentWithAgent(
    aiAgent: ViewAiAgentResponse,
    userText: string,
    recentMessages: Array<{ role: 'user' | 'assistant'; content: string }>,
    firstPassConfidence: number
  ): Promise<boolean> {
    if (!aiAgent.base_url || !aiAgent.api_key || !aiAgent.model) {
      return false;
    }

    const basePrompt = this.buildResolvedIntentReviewPrompt(
      userText,
      recentMessages,
      firstPassConfidence
    );
    const prompts = [
      basePrompt,
      `${basePrompt}\n\nATENÇÃO: Sua resposta anterior foi inválida. Retorne somente JSON válido no formato solicitado.`,
    ];

    try {
      for (const prompt of prompts) {
        const review = await this.callAiAgentChatApiWithRetry(
          aiAgent.base_url,
          aiAgent.api_key,
          aiAgent.model,
          aiAgent.ai_agent_type_id,
          prompt,
          userText,
          recentMessages.slice(-20)
        );

        const parsed = this.parseResolvedIntentReviewResult(review);
        if (!parsed) {
          continue;
        }

        const minimumConfidence = 0.75;
        return parsed.shouldClose && parsed.confidence >= minimumConfidence;
      }
      return false;
    } catch (error) {
      if (this.isAiInteractionError(error)) {
        throw error;
      }
      console.error(
        '[ChatbotFlow] confirmResolvedIntentWithAgent failed',
        error
      );
      return false;
    }
  }

  private buildResolvedIntentReviewPrompt(
    userText: string,
    recentMessages: Array<{ role: 'user' | 'assistant'; content: string }>,
    firstPassConfidence: number
  ): string {
    const conversationContext = recentMessages
      .slice(-20)
      .map(
        (msg) =>
          `${msg.role === 'user' ? 'Usuário' : 'Assistente'}: ${msg.content}`
      )
      .join('\n');

    return `Você é um revisor semântico de encerramento de atendimento.

Seu papel é validar se a mensagem MAIS RECENTE do usuário realmente indica, de forma explícita, que ele não precisa de mais ajuda e deseja encerrar.

Contexto recente:
${conversationContext || '(sem histórico anterior)'}

Mensagem mais recente:
"${userText}"

Sinal da primeira análise (apenas referência): confidence=${firstPassConfidence.toFixed(
      3
    )}

Regras:
1. Se houver qualquer nova pergunta, dúvida, pedido de informação ou continuação de assunto, o atendimento NÃO deve encerrar.
2. Só marque encerramento quando estiver claramente explícito que a pessoa quer finalizar e não deseja mais suporte.
3. Se houver qualquer ambiguidade, retorne should_close = false.
4. Seja conservador: falso positivo de encerramento é pior que falso negativo.

Retorne APENAS JSON válido (sem markdown):
{"should_close":true|false,"confidence":0.0}`;
  }

  private parseResolvedIntentReviewResult(review: string): {
    shouldClose: boolean;
    confidence: number;
  } | null {
    if (!review || typeof review !== 'string') {
      return null;
    }

    const jsonMatch = review.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) {
      return null;
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      const rawShouldClose = parsed.should_close ?? parsed.shouldClose;
      const shouldClose =
        typeof rawShouldClose === 'boolean'
          ? rawShouldClose
          : String(rawShouldClose ?? '')
              .trim()
              .toLowerCase() === 'true';

      const rawConfidence =
        typeof parsed.confidence === 'number'
          ? parsed.confidence
          : typeof parsed.score === 'number'
            ? parsed.score
            : 0.5;
      const confidence = Number.isFinite(rawConfidence)
        ? Math.min(1, Math.max(0, rawConfidence))
        : 0.5;

      return { shouldClose, confidence };
    } catch (error) {
      console.error(
        '[ChatbotFlow] parseResolvedIntentReviewResult failed',
        error
      );
      return null;
    }
  }

  private async tryBuildConversationalNoEvidenceReply(
    createChat: IChat,
    aiAgent: ViewAiAgentResponse,
    userText: string,
    recentMessages: Array<{ role: 'user' | 'assistant'; content: string }>,
    options?: { throwOnAiInteractionError?: boolean }
  ): Promise<string | null> {
    if (!aiAgent.base_url || !aiAgent.api_key || !aiAgent.model) {
      return null;
    }

    const prompt = this.buildConversationalIntentPrompt(
      userText,
      recentMessages,
      aiAgent.system_prompt
    );

    try {
      const analysis = await this.callAiAgentChatApiWithRetry(
        aiAgent.base_url,
        aiAgent.api_key,
        aiAgent.model,
        aiAgent.ai_agent_type_id,
        prompt,
        userText,
        recentMessages.slice(-12),
        undefined,
        undefined,
        {
          accountId: createChat.account.id,
          chatId: createChat.chat_id,
          aiAgentId: aiAgent.ai_agent_id,
        }
      );

      const parsed = this.parseConversationalIntentResponse(analysis);
      if (!parsed) {
        return null;
      }

      return parsed.response;
    } catch (error) {
      if (
        options?.throwOnAiInteractionError &&
        this.isAiInteractionError(error)
      ) {
        throw error;
      }
      console.error(
        '[ChatbotFlow] tryBuildConversationalNoEvidenceReply failed',
        error
      );
      return null;
    }
  }

  private buildConversationalIntentPrompt(
    userText: string,
    recentMessages: Array<{ role: 'user' | 'assistant'; content: string }>,
    systemPrompt?: string | null
  ): string {
    const conversationContext = recentMessages
      .slice(-12)
      .map(
        (msg) =>
          `${msg.role === 'user' ? 'Usuário' : 'Assistente'}: ${msg.content}`
      )
      .join('\n');

    const styleGuide =
      (systemPrompt ?? '').trim().slice(0, 1400) ||
      'Tom acolhedor, objetivo e profissional.';

    return `Você é um analisador semântico de mensagens para atendimento.

TAREFA:
1) Analise semanticamente a mensagem mais recente do usuário (não use apenas comparação literal de palavras).
2) Classifique a intenção em uma das opções:
- "greeting": saudação/início de conversa.
- "gratitude": agradecimento.
- "farewell": despedida/encerramento cordial.
- "acknowledgement": confirmação curta sem nova pergunta (ex: "ok", "entendi", "certo").
- "smalltalk": conversa social breve que não exige dados da base.
- "needs_context": qualquer pedido de informação factual, processo, regra, prazo, valor, documentação, inscrição, curso, produto, vaga, suporte técnico, etc.

REGRAS:
- Se for "needs_context", NÃO gere resposta conversacional. Use response vazio.
- Se for intenção conversacional (greeting/gratitude/farewell/acknowledgement/smalltalk), gere uma resposta natural em pt-BR (1 a 2 frases), humana e útil.
- Não invente fatos.
- Não mencione termos técnicos como "RAG", "contexto", "prompt", "base vetorial" ou "evidência".
- Siga este estilo do agente (tom/persona):
${styleGuide}

Histórico recente:
${conversationContext || '(sem histórico anterior)'}

Mensagem mais recente do usuário:
"${userText}"

Retorne APENAS JSON válido, sem markdown, no formato:
{"intent":"greeting|gratitude|farewell|acknowledgement|smalltalk|needs_context","response":"texto"}

Regras de saída:
- Se intent = "needs_context", response deve ser "".
- Se intent for conversacional, response deve estar preenchido e ser natural.`;
  }

  private parseConversationalIntentResponse(response: string): {
    intent:
      'greeting' | 'gratitude' | 'farewell' | 'acknowledgement' | 'smalltalk';
    response: string;
  } | null {
    if (!response) {
      return null;
    }

    const match = response.match(/\{[\s\S]*?\}/);
    if (!match) {
      return null;
    }

    try {
      const parsed = JSON.parse(match[0]) as Record<string, unknown>;
      const rawIntent = String(parsed.intent ?? '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '_');
      const rawReply =
        typeof parsed.response === 'string' ? parsed.response : '';
      if (
        rawIntent !== 'greeting' &&
        rawIntent !== 'gratitude' &&
        rawIntent !== 'farewell' &&
        rawIntent !== 'acknowledgement' &&
        rawIntent !== 'smalltalk'
      ) {
        return null;
      }

      const normalizedReply = rawReply.replace(/\s+/g, ' ').trim();
      if (!normalizedReply) {
        return null;
      }

      const maxReplyChars = 420;
      const safeReply =
        normalizedReply.length > maxReplyChars
          ? `${normalizedReply.slice(0, maxReplyChars - 3).trimEnd()}...`
          : normalizedReply;

      return {
        intent: rawIntent,
        response: safeReply,
      };
    } catch (error) {
      console.error(
        '[ChatbotFlow] parseConversationalIntentResponse failed',
        error
      );
      return null;
    }
  }

  private buildHumanTransferDecisionPrompt(
    systemPrompt: string,
    conversationContext: string,
    userText: string,
    sectors: ITransferSectorOption[],
    users: ITransferUserOption[]
  ): string {
    const sectorPayload = sectors.map((sector) => ({
      id: sector.id,
      name: sector.name,
    }));
    const userPayload = users.map((user) => ({
      id: user.id,
      name: user.name,
      last_name: user.last_name ?? null,
      nickname: user.nickname ?? null,
      status: user.status ?? null,
    }));

    const parts: string[] = [];
    const trimmedSystemPrompt = systemPrompt?.trim();
    if (trimmedSystemPrompt) {
      parts.push(trimmedSystemPrompt, '');
    }

    parts.push(
      '### TAREFA: TRANSFERÊNCIA HUMANA',
      'Siga estritamente as regras acima. Analise o contexto da conversa e decida se deve transferir para atendimento humano.',
      'Use SOMENTE os IDs das listas fornecidas.',
      '',
      'Contexto recente da conversa:',
      conversationContext || '(sem histórico anterior)',
      '',
      `Mensagem mais recente do usuário: "${userText}"`,
      '',
      'Setores disponíveis (JSON):',
      JSON.stringify(sectorPayload, null, 2) || '[]',
      '',
      'Atendentes disponíveis (JSON):',
      JSON.stringify(userPayload, null, 2) || '[]',
      '',
      'REGRAS:',
      '1. Se o usuário pedir explicitamente para falar com humano/operador/atendente/suporte/pessoa real, retorne "human_support" (prioridade máxima).',
      '2. Só retorne "human_support" se o prompt acima indicar claramente que deve transferir.',
      '3. Se o prompt não mencionar transferência para este caso, retorne "no_transfer".',
      '4. Se o prompt exigir alguma confirmação/comando antes da transferência e isso ainda não ocorreu, retorne "no_transfer" e gere a mensagem de instrução conforme o prompt.',
      '5. Se o prompt pedir um setor/usuário que não existe na lista, retorne "no_transfer".',
      '6. Você pode escolher apenas sector_id, apenas user_id, ou ambos.',
      '7. Se "human_support", gere uma mensagem natural para o usuário confirmando o encaminhamento, sem mencionar prompts, listas ou IDs.',
      '8. Se "no_transfer", use message como string vazia.',
      '',
      'Responda APENAS com JSON válido, sem texto extra, no formato:',
      '{"intent":"human_support|no_transfer","sector_id":null|string,"user_id":null|string,"message":string}'
    );

    return parts.join('\n');
  }

  private parseHumanTransferDecision(
    response: string
  ): IPromptTransferDecision | null {
    if (!response) {
      return null;
    }

    const match = response.match(/\{[\s\S]*?\}/);
    if (!match) {
      return null;
    }

    try {
      const parsed = JSON.parse(match[0]) as Record<string, unknown>;
      const rawIntent = String(parsed.intent ?? parsed.action ?? '')
        .trim()
        .toLowerCase();

      let intent: 'human_support' | 'no_transfer' | null = null;
      if (
        rawIntent === 'human_support' ||
        rawIntent === 'transfer' ||
        rawIntent === 'human'
      ) {
        intent = 'human_support';
      } else if (
        rawIntent === 'no_transfer' ||
        rawIntent === 'none' ||
        rawIntent === 'needs_help'
      ) {
        intent = 'no_transfer';
      }

      if (!intent) {
        return null;
      }

      const rawSectorId =
        typeof parsed.sector_id === 'string'
          ? parsed.sector_id
          : typeof parsed.sectorId === 'string'
            ? parsed.sectorId
            : null;
      const rawUserId =
        typeof parsed.user_id === 'string'
          ? parsed.user_id
          : typeof parsed.userId === 'string'
            ? parsed.userId
            : null;
      const rawMessage =
        typeof parsed.message === 'string' ? parsed.message : '';

      const sectorId = rawSectorId?.trim() || null;
      const userId = rawUserId?.trim() || null;
      const message = rawMessage.trim();

      return {
        intent,
        sector_id: sectorId,
        user_id: userId,
        message,
      };
    } catch (error) {
      console.error('[ChatbotFlow] parseHumanTransferDecision failed', error);
      return null;
    }
  }

  private async listTransferTargetsForPrompt(accountId: string): Promise<{
    sectors: ITransferSectorOption[];
    users: ITransferUserOption[];
  }> {
    const [sectors, users] = await Promise.all([
      this.sectorService.listSectorsForTransfer(accountId),
      this.userService.listUsersForTransfer(accountId),
    ]);

    return { sectors, users };
  }

  private async resolveHumanTransferByPrompt(
    aiAgent: ViewAiAgentResponse,
    createChat: IChat,
    userText: string,
    recentMessages: Array<{ role: 'user' | 'assistant'; content: string }>
  ): Promise<{
    shouldTransfer: boolean;
    sector: ITransferSectorOption | null;
    user: IChat['user'] | null;
    message: string;
  }> {
    if (!aiAgent.base_url || !aiAgent.api_key || !aiAgent.model) {
      return {
        shouldTransfer: false,
        sector: null,
        user: null,
        message: '',
      };
    }

    const { sectors, users } = await this.listTransferTargetsForPrompt(
      createChat.account.id
    );

    const conversationContext = recentMessages
      .slice(-20)
      .map(
        (msg) =>
          `${msg.role === 'user' ? 'Usuário' : 'Assistente'}: ${msg.content}`
      )
      .join('\n');

    const useFileSearchResponsesApi =
      aiAgent.ai_agent_type_id === EAiAgentType.gpt &&
      !!aiAgent.openai_vector_store_id;
    const skipFilePrompts = useFileSearchResponsesApi;

    const allPrompts = await this.ragService.getAllAgentPromptsDetailed(
      createChat.account.id,
      aiAgent.ai_agent_id
    );

    const systemPrompt = this.buildComprehensiveSystemPrompt(
      aiAgent.system_prompt,
      allPrompts,
      skipFilePrompts
    );

    const decisionPrompt = this.buildHumanTransferDecisionPrompt(
      systemPrompt,
      conversationContext || '(sem histórico anterior)',
      userText,
      sectors,
      users
    );

    const responsesApiFileSearchOptions =
      useFileSearchResponsesApi && aiAgent.openai_vector_store_id
        ? { vectorStoreId: aiAgent.openai_vector_store_id }
        : undefined;

    try {
      const response = await this.callAiAgentChatApiWithRetry(
        aiAgent.base_url,
        aiAgent.api_key,
        aiAgent.model,
        aiAgent.ai_agent_type_id,
        decisionPrompt,
        userText,
        undefined,
        undefined,
        responsesApiFileSearchOptions,
        {
          accountId: createChat.account.id,
          chatId: createChat.chat_id,
          aiAgentId: aiAgent.ai_agent_id,
        }
      );

      const decision = this.parseHumanTransferDecision(response);
      if (!decision || decision.intent !== 'human_support') {
        return {
          shouldTransfer: false,
          sector: null,
          user: null,
          message: '',
        };
      }

      const sector = decision.sector_id
        ? (sectors.find((item) => item.id === decision.sector_id) ?? null)
        : null;
      const user = decision.user_id
        ? (users.find((item) => item.id === decision.user_id) ?? null)
        : null;

      if ((decision.sector_id && !sector) || (decision.user_id && !user)) {
        return {
          shouldTransfer: false,
          sector: null,
          user: null,
          message: '',
        };
      }

      const chatUser: IChat['user'] | null = user
        ? {
            id: user.id,
            name: user.name,
            photo: user.photo ?? null,
          }
        : null;

      return {
        shouldTransfer: true,
        sector,
        user: chatUser,
        message: decision.message ?? '',
      };
    } catch (error) {
      if (this.isAiInteractionError(error)) {
        throw error;
      }
      console.error('[ChatbotFlow] resolveHumanTransferByPrompt failed', error);
      return {
        shouldTransfer: false,
        sector: null,
        user: null,
        message: '',
      };
    }
  }

  private async processTextResponseAnalysis(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    chatbotFlow: ListChatbotFlowResponse,
    currentFlowId: string,
    currentNode: ListChatbotFlowResponse['nodes'][number],
    customMessages: IChatbotCustomMessages | undefined
  ): Promise<boolean> {
    await this.resetFailedAttempts(createChat);

    const selectedAiAgentId = currentNode.data?.selectedAiAgent || '';
    const config = await this.aiAgentService.viewAiAgentHumanTransfer(
      selectedAiAgentId,
      createChat.account.id
    );

    const goToHumanSupportNextNode = (): Promise<boolean> => {
      const nextFlowId = this.getNextFlowIdByHumanSupportHandle(
        chatbotFlow,
        currentFlowId
      );
      if (!nextFlowId) {
        return Promise.resolve(false);
      }
      return this.processNextNode(
        t,
        createChat,
        chatbotFlow,
        nextFlowId,
        customMessages
      );
    };

    if (!config?.enable_human_transfer || !config.sector_targets?.length) {
      return goToHumanSupportNextNode();
    }

    const sectorIdsSet = new Set(
      config.sector_targets.map((target) => target.sector_id)
    );
    const allSectors = await this.sectorService.listSectorsForTransfer(
      createChat.account.id
    );
    const sectors = allSectors.filter((s) => sectorIdsSet.has(s.id));

    if (sectors.length === 0) {
      return goToHumanSupportNextNode();
    }

    const allUsers = await this.userService.listUsersForTransfer(
      createChat.account.id
    );

    const getUsersForSector = (
      sectorId: string
    ): Array<{ id: string; name: string; photo?: string | null }> => {
      const userIds =
        config.sector_targets?.find((t) => t.sector_id === sectorId)
          ?.user_ids ?? [];
      return allUsers.filter((u) => userIds.includes(u.id));
    };

    if (sectors.length === 1) {
      const sector = sectors[0];
      const usersForSector = getUsersForSector(sector.id);

      if (usersForSector.length === 0) {
        return this.executeHumanSupportTransfer(
          t,
          createChat,
          chatbotFlow,
          currentFlowId,
          sector,
          customMessages,
          null
        );
      }

      if (usersForSector.length === 1) {
        const user = usersForSector[0];
        return this.executeHumanSupportTransfer(
          t,
          createChat,
          chatbotFlow,
          currentFlowId,
          sector,
          customMessages,
          user
        );
      }

      const userSelectionKey = this.getUserSelectionCacheKey(
        createChat.account.id,
        createChat.worker.id,
        createChat.chat_id
      );
      await this.redis.set(
        userSelectionKey,
        JSON.stringify({
          users: usersForSector,
          flowId: currentFlowId,
          selectedAiAgentId,
          sectorId: sector.id,
          sector,
        }),
        'EX',
        1800
      );
      const userMessage = this.buildUserSelectionMessage(usersForSector);
      await this.sendMessageWithStatusGuard(t, {
        chat: createChat,
        accountId: createChat.account.id,
        type: EMessageType.text,
        message: userMessage,
        typeUser: ETypeUserChat.bot,
      });
      return true;
    }

    const sectorSelectionKey = this.getSectorSelectionCacheKey(
      createChat.account.id,
      createChat.worker.id,
      createChat.chat_id
    );
    await this.redis.set(
      sectorSelectionKey,
      JSON.stringify({
        sectors,
        flowId: currentFlowId,
        selectedAiAgentId,
        sector_targets: config.sector_targets,
      }),
      'EX',
      1800
    );
    const sectorMessage = this.buildSectorSelectionMessage(sectors);
    await this.sendMessageWithStatusGuard(t, {
      chat: createChat,
      accountId: createChat.account.id,
      type: EMessageType.text,
      message: sectorMessage,
      typeUser: ETypeUserChat.bot,
    });
    return true;
  }

  private buildSectorSelectionMessage(
    sectors: Array<{ id: string; name: string }>
  ): string {
    const lines = sectors.map((sector, index) => {
      const number = index + 1;
      return `*${number}.* ${sector.name}`;
    });

    return [
      'Para direcionarmos seu atendimento, em qual setor você gostaria de ser atendido?',
      '',
      ...lines,
    ].join('\n');
  }

  private async matchSectorFromUserResponse(
    baseUrl: string,
    apiKey: string,
    model: string,
    aiAgentTypeId: string,
    userText: string,
    sectors: Array<{ id: string; name: string }>
  ): Promise<string | null> {
    const sectorList = sectors.map((s, i) => `${i + 1}. ${s.name}`).join('\n');

    const prompt = `Você é um classificador de intenção. O usuário está escolhendo um setor de atendimento.

Setores disponíveis:
${sectorList}

Analise a resposta do usuário e retorne APENAS o número do setor que mais combina com a resposta. Se nenhum setor combinar claramente, retorne "0".

Resposta do usuário: "${userText}"

Retorne APENAS o número (ex: 1, 2, 3...) ou 0.`;

    try {
      const response = await this.callAiAgentChatApi(
        baseUrl,
        apiKey,
        model,
        aiAgentTypeId,
        prompt,
        userText
      );

      const normalizedResponse = response.trim();
      const match = normalizedResponse.match(/\d+/);
      const parsed = match ? Number.parseInt(match[0], 10) : Number.NaN;
      if (!Number.isNaN(parsed) && parsed >= 1 && parsed <= sectors.length) {
        return sectors[parsed - 1].id;
      }

      return null;
    } catch (error) {
      console.error('[ChatbotFlow] matchSectorFromUserResponse failed', error);
      return null;
    }
  }

  private async executeHumanSupportTransfer(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    chatbotFlow: ListChatbotFlowResponse,
    currentFlowId: string,
    sector: { id: string; name: string; color?: string | null } | null,
    customMessages?: IChatbotCustomMessages,
    user?: IChat['user'] | null,
    transferMessageOverride?: string | null
  ): Promise<boolean> {
    const chatSector: IChat['sector'] | null = sector
      ? { id: sector.id, name: sector.name, color: sector.color ?? undefined }
      : null;
    const chatUser = user ?? null;

    const hasOverride = typeof transferMessageOverride === 'string';
    if (hasOverride) {
      const transferMessage = transferMessageOverride.trim();
      if (transferMessage.length > 0) {
        await this.sendMessageWithStatusGuard(t, {
          chat: createChat,
          accountId: createChat.account.id,
          type: EMessageType.system,
          message: transferMessage,
          typeUser: ETypeUserChat.bot,
        });
      }
    } else {
      let rawTransferMessage: string | undefined;
      let enabled: boolean | undefined;
      if (chatUser && chatSector) {
        rawTransferMessage =
          customMessages?.transfer_message_sector_user ||
          t('chatbot_transfer_message_sector_user_default');
        enabled = customMessages?.transfer_message_sector_user_enabled;
      } else if (chatSector) {
        rawTransferMessage =
          customMessages?.transfer_message_sector ||
          t('chatbot_transfer_message_sector_default');
        enabled = customMessages?.transfer_message_sector_enabled;
      } else {
        rawTransferMessage =
          customMessages?.transfer_message_user ||
          t('chatbot_transfer_message_user_default');
        enabled = customMessages?.transfer_message_user_enabled;
      }

      if (rawTransferMessage && enabled !== false) {
        const transferMessage = await this.replaceVariables(
          t,
          rawTransferMessage,
          createChat,
          chatUser,
          chatSector
        );
        await this.sendMessageWithStatusGuard(t, {
          chat: createChat,
          accountId: createChat.account.id,
          type: EMessageType.system,
          message: transferMessage,
          typeUser: ETypeUserChat.bot,
        });
      }
    }

    await this.updateAndPublishChat(t, createChat, chatUser, chatSector);

    return true;
  }

  private async getAndDeleteCacheValue(key: string): Promise<string | null> {
    try {
      const result = await this.redis.multi().get(key).del(key).exec();
      const value = Array.isArray(result) ? result[0]?.[1] : null;
      return typeof value === 'string' ? value : null;
    } catch (error) {
      console.error('[AI Agent] Erro ao consumir cache do Redis:', error);
      return null;
    }
  }

  private parseSectorSelectionCache(cachedData: string): {
    sectors: Array<{ id: string; name: string; color?: string | null }>;
    flowId: string;
    selectedAiAgentId: string;
    sector_targets?: Array<{ sector_id: string; user_ids: string[] }>;
  } | null {
    let parsed: {
      sectors?: Array<{ id?: string; name?: string; color?: string | null }>;
      flowId?: string;
      selectedAiAgentId?: string;
      sector_targets?: Array<{ sector_id?: string; user_ids?: string[] }>;
    };
    try {
      parsed = JSON.parse(cachedData);
    } catch (error) {
      console.error(
        '[ChatbotFlow] parseSectorSelectionCache JSON parse failed',
        error
      );
      return null;
    }

    if (!parsed || typeof parsed.flowId !== 'string') {
      return null;
    }

    if (typeof parsed.selectedAiAgentId !== 'string') {
      return null;
    }

    if (!Array.isArray(parsed.sectors) || parsed.sectors.length === 0) {
      return null;
    }

    const sectors = parsed.sectors.filter(
      (sector): sector is { id: string; name: string; color?: string | null } =>
        !!sector &&
        typeof sector.id === 'string' &&
        typeof sector.name === 'string'
    );

    if (sectors.length !== parsed.sectors.length) {
      return null;
    }

    const sector_targets = Array.isArray(parsed.sector_targets)
      ? parsed.sector_targets
          .filter(
            (t): t is { sector_id: string; user_ids: string[] } =>
              !!t &&
              typeof t.sector_id === 'string' &&
              Array.isArray(t.user_ids)
          )
          .map((t) => ({
            sector_id: t.sector_id,
            user_ids: t.user_ids.filter(
              (id): id is string => typeof id === 'string'
            ),
          }))
      : undefined;

    return {
      sectors,
      flowId: parsed.flowId,
      selectedAiAgentId: parsed.selectedAiAgentId,
      sector_targets,
    };
  }

  private parseUserSelectionCache(cachedData: string): {
    users: Array<{ id: string; name: string; photo?: string | null }>;
    flowId: string;
    selectedAiAgentId: string;
    sectorId: string | null;
    sector: { id: string; name: string; color?: string | null } | null;
  } | null {
    let parsed: {
      users?: Array<{
        id?: string;
        name?: string;
        photo?: string | null;
      }>;
      flowId?: string;
      selectedAiAgentId?: string;
      sectorId?: string | null;
      sector?: { id: string; name: string; color?: string | null } | null;
    };
    try {
      parsed = JSON.parse(cachedData);
    } catch (error) {
      console.error(
        '[ChatbotFlow] parseUserSelectionCache JSON parse failed',
        error
      );
      return null;
    }

    if (!parsed || typeof parsed.flowId !== 'string') {
      return null;
    }

    if (typeof parsed.selectedAiAgentId !== 'string') {
      return null;
    }

    if (!Array.isArray(parsed.users) || parsed.users.length === 0) {
      return null;
    }

    const users = parsed.users.filter(
      (u): u is { id: string; name: string; photo?: string | null } =>
        !!u && typeof u.id === 'string' && typeof u.name === 'string'
    );

    if (users.length !== parsed.users.length) {
      return null;
    }

    return {
      users,
      flowId: parsed.flowId,
      selectedAiAgentId: parsed.selectedAiAgentId,
      sectorId: parsed.sectorId ?? null,
      sector: parsed.sector ?? null,
    };
  }

  private async matchUserFromUserResponse(
    baseUrl: string,
    apiKey: string,
    model: string,
    aiAgentTypeId: string,
    userText: string,
    users: Array<{
      id: string;
      name: string;
      last_name?: string | null;
      nickname?: string | null;
    }>
  ): Promise<string | null> {
    const userList = users
      .map((u, i) => {
        const fullName = [u.name, u.last_name].filter(Boolean).join(' ');
        const nickname = u.nickname ? ` (${u.nickname})` : '';
        return `${i + 1}. ${fullName || u.name}${nickname}`;
      })
      .join('\n');

    const prompt = `Você é um classificador de intenção. O usuário está escolhendo um atendente.

Atendentes disponíveis:
${userList}

Analise a resposta do usuário e retorne APENAS o número do atendente que mais combina com a resposta. Se nenhum combinar claramente, retorne "0".

Resposta do usuário: "${userText}"

Retorne APENAS o número (ex: 1, 2, 3...) ou 0.`;

    try {
      const response = await this.callAiAgentChatApi(
        baseUrl,
        apiKey,
        model,
        aiAgentTypeId,
        prompt,
        userText
      );

      const normalizedResponse = response.trim();
      const match = normalizedResponse.match(/\d+/);
      const parsed = match ? Number.parseInt(match[0], 10) : Number.NaN;
      if (!Number.isNaN(parsed) && parsed >= 1 && parsed <= users.length) {
        return users[parsed - 1].id;
      }

      return null;
    } catch (error) {
      console.error('[ChatbotFlow] matchUserFromUserResponse failed', error);
      return null;
    }
  }

  private async handlePendingUserSelection(
    t: TFunction<'translation', undefined>,
    data: IUpsertMessage,
    createChat: IChat,
    chatbotFlow: ListChatbotFlowResponse,
    currentFlowId: string,
    customMessages: IChatbotCustomMessages | undefined,
    aiAgent: ViewAiAgentResponse
  ): Promise<boolean | null> {
    const userSelectionKey = this.getUserSelectionCacheKey(
      createChat.account.id,
      createChat.worker.id,
      createChat.chat_id
    );

    const userText = this.getTextFromUpsertMessage(data)?.trim();
    if (!userText) {
      return null;
    }

    const cachedData = await this.getAndDeleteCacheValue(userSelectionKey);
    if (!cachedData) {
      return null;
    }

    const parsed = this.parseUserSelectionCache(cachedData);
    if (!parsed) {
      return null;
    }

    const { users, flowId, sector } = parsed;

    const selectedNumber = this.parseStructuredSelection(
      userText,
      users.length
    );
    let matchedUser: {
      id: string;
      name: string;
      photo?: string | null;
    } | null = null;

    if (selectedNumber !== null) {
      matchedUser = users[selectedNumber - 1];
    }

    if (
      !matchedUser &&
      aiAgent?.base_url &&
      aiAgent?.api_key &&
      aiAgent?.model
    ) {
      const matchedUserId = await this.matchUserFromUserResponse(
        aiAgent.base_url,
        aiAgent.api_key,
        aiAgent.model,
        aiAgent.ai_agent_type_id,
        userText,
        users
      );
      matchedUser = matchedUserId
        ? (users.find((u) => u.id === matchedUserId) ?? null)
        : null;
    }

    const chatUser: IChat['user'] | null = matchedUser
      ? {
          id: matchedUser.id,
          name: matchedUser.name,
          photo: matchedUser.photo ?? null,
        }
      : null;

    return this.executeHumanSupportTransfer(
      t,
      createChat,
      chatbotFlow,
      flowId,
      sector,
      customMessages,
      chatUser
    );
  }

  private async handlePendingSectorSelection(
    t: TFunction<'translation', undefined>,
    data: IUpsertMessage,
    createChat: IChat,
    chatbotFlow: ListChatbotFlowResponse,
    currentFlowId: string,
    customMessages: IChatbotCustomMessages | undefined,
    aiAgent: ViewAiAgentResponse
  ): Promise<boolean | null> {
    const sectorSelectionKey = this.getSectorSelectionCacheKey(
      createChat.account.id,
      createChat.worker.id,
      createChat.chat_id
    );

    const userText = this.getTextFromUpsertMessage(data)?.trim();
    if (!userText) {
      return null;
    }

    const cachedData = await this.getAndDeleteCacheValue(sectorSelectionKey);
    if (!cachedData) {
      return null;
    }

    const parsed = this.parseSectorSelectionCache(cachedData);
    if (!parsed) {
      return null;
    }

    const { sectors, flowId, selectedAiAgentId, sector_targets } = parsed;

    const currentSectors = await this.sectorService.listSectorsForTransfer(
      createChat.account.id
    );
    const currentSectorIds = new Set(currentSectors.map((sector) => sector.id));
    if (!sectors.every((sector) => currentSectorIds.has(sector.id))) {
      if (currentSectors.length === 0) {
        return this.executeHumanSupportTransfer(
          t,
          createChat,
          chatbotFlow,
          flowId,
          null,
          customMessages
        );
      }
      if (sector_targets?.length && currentSectors.length >= 1) {
        const sectorIdsFromTargets = new Set(
          sector_targets.map((t) => t.sector_id)
        );
        const listSectors = currentSectors.filter((s) =>
          sectorIdsFromTargets.has(s.id)
        );
        if (listSectors.length === 0) {
          return this.executeHumanSupportTransfer(
            t,
            createChat,
            chatbotFlow,
            flowId,
            null,
            customMessages
          );
        }
        await this.redis.set(
          sectorSelectionKey,
          JSON.stringify({
            sectors: listSectors,
            flowId,
            selectedAiAgentId,
            sector_targets,
          }),
          'EX',
          1800
        );
        const sectorMessage = this.buildSectorSelectionMessage(listSectors);
        await this.sendMessageWithStatusGuard(t, {
          chat: createChat,
          accountId: createChat.account.id,
          type: EMessageType.text,
          message: sectorMessage,
          typeUser: ETypeUserChat.bot,
        });
        return true;
      }
      if (currentSectors.length === 1) {
        return this.executeHumanSupportTransfer(
          t,
          createChat,
          chatbotFlow,
          flowId,
          currentSectors[0],
          customMessages
        );
      }
    }

    if (!sectors || sectors.length === 0) {
      return this.executeHumanSupportTransfer(
        t,
        createChat,
        chatbotFlow,
        flowId,
        null,
        customMessages
      );
    }

    const selectedNumber = this.parseStructuredSelection(
      userText,
      sectors.length
    );
    let matchedSector: {
      id: string;
      name: string;
      color?: string | null;
    } | null = null;

    if (selectedNumber !== null) {
      matchedSector = sectors[selectedNumber - 1];
    }

    if (
      !matchedSector &&
      aiAgent?.base_url &&
      aiAgent?.api_key &&
      aiAgent?.model
    ) {
      const matchedSectorId = await this.matchSectorFromUserResponse(
        aiAgent.base_url,
        aiAgent.api_key,
        aiAgent.model,
        aiAgent.ai_agent_type_id,
        userText,
        sectors
      );
      matchedSector = matchedSectorId
        ? (sectors.find((s) => s.id === matchedSectorId) ?? null)
        : null;
    }

    if (!matchedSector) {
      return this.executeHumanSupportTransfer(
        t,
        createChat,
        chatbotFlow,
        flowId,
        null,
        customMessages
      );
    }

    const userIdsForSector =
      sector_targets?.find((t) => t.sector_id === matchedSector.id)?.user_ids ??
      [];
    const allUsersForTransfer = await this.userService.listUsersForTransfer(
      createChat.account.id
    );
    const eligibleUsers =
      userIdsForSector.length > 0
        ? allUsersForTransfer.filter((u) => userIdsForSector.includes(u.id))
        : [];

    if (eligibleUsers.length === 0) {
      return this.executeHumanSupportTransfer(
        t,
        createChat,
        chatbotFlow,
        flowId,
        matchedSector,
        customMessages
      );
    }

    if (eligibleUsers.length === 1) {
      return this.executeHumanSupportTransfer(
        t,
        createChat,
        chatbotFlow,
        flowId,
        matchedSector,
        customMessages,
        eligibleUsers[0]
      );
    }

    const userSelectionKey = this.getUserSelectionCacheKey(
      createChat.account.id,
      createChat.worker.id,
      createChat.chat_id
    );
    await this.redis.set(
      userSelectionKey,
      JSON.stringify({
        users: eligibleUsers,
        flowId,
        selectedAiAgentId,
        sectorId: matchedSector.id,
        sector: matchedSector,
      }),
      'EX',
      1800
    );
    const userMessage = this.buildUserSelectionMessage(eligibleUsers);
    await this.sendMessageWithStatusGuard(t, {
      chat: createChat,
      accountId: createChat.account.id,
      type: EMessageType.text,
      message: userMessage,
      typeUser: ETypeUserChat.bot,
    });

    return true;
  }

  private async generateBootstrapSummaryForChat(
    createChat: IChat,
    aiAgent: ViewAiAgentResponse,
    bootstrapSummaryKey: string
  ): Promise<void> {
    if (!aiAgent.base_url || !aiAgent.api_key || !aiAgent.model) {
      return;
    }

    const promptsDetailed = await this.ragService.getAllAgentPromptsDetailed(
      createChat.account.id,
      aiAgent.ai_agent_id
    );
    const promptsText =
      this.ragService.buildPromptsTextFromDetailed(promptsDetailed);
    await this.ensureBootstrapSummary(bootstrapSummaryKey, promptsText, {
      base_url: aiAgent.base_url,
      api_key: aiAgent.api_key,
      model: aiAgent.model,
      ai_agent_type_id: aiAgent.ai_agent_type_id,
    });
  }

  private async updateConversationSummaryAfterResponse(
    conversationSummaryKey: string,
    previousSummary: string | null,
    recentMessages: Array<{ role: 'user' | 'assistant'; content: string }>,
    userText: string,
    aiResponse: string,
    aiAgent: {
      base_url: string;
      api_key: string;
      model: string;
      ai_agent_type_id: string;
    }
  ): Promise<void> {
    const updatedRecentMessages = this.buildUpdatedRecentMessages(
      recentMessages,
      userText,
      aiResponse
    );

    const updatedConversationSummary =
      await this.ragService.generateOrUpdateConversationSummary(
        previousSummary,
        updatedRecentMessages,
        aiAgent.base_url,
        aiAgent.api_key,
        aiAgent.model,
        aiAgent.ai_agent_type_id
      );

    if (
      updatedConversationSummary &&
      updatedConversationSummary.trim().length > 0
    ) {
      await this.redis.set(
        conversationSummaryKey,
        updatedConversationSummary,
        'EX',
        86400
      );
    }
  }

  private buildUpdatedRecentMessages(
    recentMessages: Array<{ role: 'user' | 'assistant'; content: string }>,
    userText: string,
    aiResponse: string
  ): Array<{ role: 'user' | 'assistant'; content: string }> {
    return [
      ...recentMessages.slice(-18),
      { role: 'user' as const, content: userText },
      { role: 'assistant' as const, content: aiResponse },
    ];
  }

  private async scheduleChatHistoryEmbedding(
    createChat: IChat,
    aiAgentId: string
  ): Promise<void> {
    if (!createChat.phone) {
      return;
    }

    const payload: IChatHistoryEmbeddingRequest = {
      account_id: createChat.account.id,
      ai_agent_id: aiAgentId,
      phone: createChat.phone,
      exclude_chat_id: createChat.chat_id,
    };

    const topic = this.kafkaServiceQueueService.chatHistoryEmbedding();
    await this.streamProducerService.send(
      topic,
      payload,
      `${createChat.account.id}:${createChat.phone}:${aiAgentId}`
    );
  }

  private async saveAiAgentUsage(
    input: IAiAgentUsageCreateInput
  ): Promise<void> {
    try {
      await this.aiAgentUsageCreatorRepository.create(input);
    } catch (error) {
      console.error('[ChatbotFlow] saveAiAgentUsage failed', error);
    }
  }

  private async callAiAgentChatApiWithRetry(
    baseUrl: string,
    apiKey: string,
    model: string,
    aiAgentTypeId: string,
    prompt: string,
    userQuery: string,
    history?: Array<{ role: 'user' | 'assistant'; content: string }>,
    _assistantsOptions?: {
      accountId: string;
      chatId: string;
      aiAgentId: string;
      openaiAssistantId: string;
    },
    responsesApiFileSearchOptions?: {
      vectorStoreId: string;
      idempotencyKey?: string;
    },
    usageContext?: { accountId: string; chatId: string; aiAgentId: string }
  ): Promise<string> {
    return this.callAiAgentChatApi(
      baseUrl,
      apiKey,
      model,
      aiAgentTypeId,
      prompt,
      userQuery,
      history,
      _assistantsOptions,
      responsesApiFileSearchOptions,
      usageContext
    );
  }

  private async callAiAgentChatApi(
    baseUrl: string,
    apiKey: string,
    model: string,
    aiAgentTypeId: string,
    prompt: string,
    userQuery: string,
    history?: Array<{ role: 'user' | 'assistant'; content: string }>,
    _assistantsOptions?: {
      accountId: string;
      chatId: string;
      aiAgentId: string;
      openaiAssistantId: string;
    },
    responsesApiFileSearchOptions?: {
      vectorStoreId: string;
      idempotencyKey?: string;
    },
    usageContext?: { accountId: string; chatId: string; aiAgentId: string }
  ): Promise<string> {
    if (!baseUrl || !apiKey || !model) {
      throw new InvalidConfigurationError(
        'AI Agent base_url, api_key ou model não está configurado.'
      );
    }

    const saveContext = usageContext;

    if (
      aiAgentTypeId === EAiAgentType.gpt &&
      responsesApiFileSearchOptions?.vectorStoreId
    ) {
      try {
        const result =
          await this.openAIAssistantService.createResponseWithFileSearch(
            apiKey,
            baseUrl,
            model,
            prompt,
            userQuery,
            responsesApiFileSearchOptions.vectorStoreId,
            history,
            responsesApiFileSearchOptions.idempotencyKey,
            saveContext
              ? {
                  accountId: saveContext.accountId,
                  aiAgentId: saveContext.aiAgentId,
                }
              : undefined
          );
        if (saveContext) {
          await this.saveAiAgentUsage({
            ai_agent_id: saveContext.aiAgentId,
            account_id: saveContext.accountId,
            chat_id: saveContext.chatId,
            prompt_tokens: result.usage?.prompt_tokens ?? null,
            completion_tokens: result.usage?.completion_tokens ?? null,
            total_tokens: result.usage?.total_tokens ?? null,
            model: model ?? null,
            latency_ms: result.latency_ms ?? null,
            success: true,
            request_type: 'responses_file_search',
          });
        }
        return result.text;
      } catch (error) {
        if (saveContext) {
          await this.saveAiAgentUsage({
            ai_agent_id: saveContext.aiAgentId,
            account_id: saveContext.accountId,
            chat_id: saveContext.chatId,
            prompt_tokens: null,
            completion_tokens: null,
            total_tokens: null,
            model: model ?? null,
            latency_ms: null,
            success: false,
            request_type: 'responses_file_search',
          });
        }
        throw error;
      }
    }

    const startedAt = Date.now();
    try {
      const result = await aiProviderClient.generateChat({
        configuration: {
          provider: aiAgentTypeId,
          baseUrl,
          apiKey,
          model,
        },
        systemPrompt: prompt,
        question: userQuery,
        history,
      });
      if (saveContext) {
        await this.saveAiAgentUsage({
          ai_agent_id: saveContext.aiAgentId,
          account_id: saveContext.accountId,
          chat_id: saveContext.chatId,
          prompt_tokens: result.usage.inputTokens,
          completion_tokens: result.usage.outputTokens,
          total_tokens: result.usage.totalTokens,
          model: model ?? null,
          latency_ms: Date.now() - startedAt,
          success: true,
          request_type: 'chat',
        });
      }
      return result.content;
    } catch (error) {
      if (saveContext) {
        await this.saveAiAgentUsage({
          ai_agent_id: saveContext.aiAgentId,
          account_id: saveContext.accountId,
          chat_id: saveContext.chatId,
          prompt_tokens: null,
          completion_tokens: null,
          total_tokens: null,
          model: model ?? null,
          latency_ms: Date.now() - startedAt,
          success: false,
          request_type: 'chat',
        });
      }
      throw error;
    }
  }

  private async processAiAgentNode(
    t: TFunction<'translation', undefined>,
    data: IUpsertMessage,
    createChat: IChat,
    chatbotFlow: ListChatbotFlowResponse,
    currentFlowId: string,
    customMessages?: IChatbotCustomMessages
  ): Promise<boolean> {
    const currentNode = this.getFlowNodeById(chatbotFlow, currentFlowId);

    if (!currentNode) {
      throw new Error(t('chatbot_flow_node_not_found'));
    }

    const selectedAiAgentId = currentNode.data?.selectedAiAgent;

    if (!selectedAiAgentId) {
      throw new Error(t('chatbot_flow_validation_ai_agent_required'));
    }

    const aiAgent = await this.aiAgentService.viewAiAgent(
      selectedAiAgentId,
      createChat.account.id
    );

    if (!aiAgent || aiAgent.status !== EAiAgentStatus.active) {
      throw new Error(t('ai_agent_not_found'));
    }

    if (!aiAgent.base_url || !aiAgent.api_key || !aiAgent.model) {
      throw new InvalidConfigurationError(
        'AI Agent base_url, api_key ou model não está configurado.'
      );
    }

    const transferMode = this.resolveHumanTransferMode(aiAgent);

    const cacheKey = this.getChatbotFlowCacheKey(
      createChat.account.id,
      createChat.worker.id,
      createChat.chat_id
    );
    const cachedFlowId = await this.redis.get(cacheKey);
    const isFirstEntry = cachedFlowId !== currentFlowId;

    const bootstrapSummaryKey = `${cacheKey}:bootstrap-summary`;

    if (isFirstEntry) {
      return this.handleBootstrapEntry(
        t,
        createChat,
        aiAgent,
        currentFlowId,
        bootstrapSummaryKey
      );
    }

    if (transferMode === 'standard') {
      const userSelectionResult = await this.handlePendingUserSelection(
        t,
        data,
        createChat,
        chatbotFlow,
        currentFlowId,
        customMessages,
        aiAgent
      );
      if (userSelectionResult !== null) {
        return userSelectionResult;
      }

      const sectorSelectionResult = await this.handlePendingSectorSelection(
        t,
        data,
        createChat,
        chatbotFlow,
        currentFlowId,
        customMessages,
        aiAgent
      );
      if (sectorSelectionResult !== null) {
        return sectorSelectionResult;
      }
    }

    const userText = (
      await this.getTextOrTranscribedForAiAgent(data, createChat, aiAgent)
    )?.trim();

    if (!userText) {
      return false;
    }

    const existingDebounce = await this.getAiAgentDebounce(createChat);
    const shouldResetDebounce =
      existingDebounce &&
      (existingDebounce.flowId !== currentFlowId ||
        existingDebounce.selectedAiAgentId !== selectedAiAgentId);
    const mergedMessages = shouldResetDebounce
      ? []
      : (existingDebounce?.messages ?? []);
    mergedMessages.push(userText);

    const expiresAt = Date.now() + this.AI_AGENT_DEBOUNCE_SECONDS * 1000;

    await this.setAiAgentDebounce(createChat, {
      expiresAt,
      messages: mergedMessages,
      flowId: currentFlowId,
      chatbotId: chatbotFlow.chatbot_id,
      selectedAiAgentId,
      lastMessageType: data.type,
      customMessages,
      trackingId: uuidv7(),
      retryCount: 0,
    });

    this.scheduleAiAgentDebouncedResponse(t, createChat);

    return true;
  }

  private async handleBootstrapEntry(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    aiAgent: ViewAiAgentResponse,
    currentFlowId: string,
    bootstrapSummaryKey: string
  ): Promise<boolean> {
    await this.generateBootstrapSummaryForChat(
      createChat,
      aiAgent,
      bootstrapSummaryKey
    );

    const welcomeSent = await this.generateAndSendAiWelcomeMessage(
      t,
      createChat,
      aiAgent
    );
    if (!welcomeSent) {
      return false;
    }
    await this.resetAiAgentInteractionsCount(
      createChat.account.id,
      createChat.worker.id,
      createChat.chat_id,
      currentFlowId
    );
    await this.updateCache(createChat, currentFlowId);
    await this.scheduleChatHistoryEmbedding(createChat, aiAgent.ai_agent_id);

    return true;
  }

  private async processAiAgentUserText(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    currentNode: ListChatbotFlowResponse['nodes'][number],
    aiAgent: ViewAiAgentResponse,
    currentFlowId: string,
    userText: string,
    bootstrapSummaryKey: string,
    conversationSummaryKey: string,
    chatbotFlow: ListChatbotFlowResponse,
    customMessages?: IChatbotCustomMessages,
    inputMessageType?: EMessageType,
    deliveryMessageId?: string
  ): Promise<boolean> {
    const actionAfterInteractions =
      currentNode.data?.actionAfterInteractions === true;
    const interactionsQuantity = currentNode.data?.interactionsQuantity ?? 0;

    if (actionAfterInteractions && interactionsQuantity > 0) {
      const currentInteractionsCount = await this.getAiAgentInteractionsCount(
        createChat.account.id,
        createChat.worker.id,
        createChat.chat_id,
        currentFlowId
      );

      if (
        this.hasReachedInteractionLimit(
          currentInteractionsCount,
          interactionsQuantity
        )
      ) {
        const nextFlowId = this.getNextFlowIdByInteractionsHandle(
          chatbotFlow,
          currentFlowId
        );

        if (nextFlowId) {
          await this.resetAiAgentInteractionsCount(
            createChat.account.id,
            createChat.worker.id,
            createChat.chat_id,
            currentFlowId
          );
          await this.updateCache(createChat, nextFlowId);
          return this.processNextNode(
            t,
            createChat,
            chatbotFlow,
            nextFlowId,
            customMessages
          );
        }
      }
    }

    const recentMessages = await this.getConversationHistory(
      createChat.account.id,
      createChat.worker.id,
      createChat.chat_id,
      aiAgent.ai_agent_id,
      20
    );

    const transferMode = this.resolveHumanTransferMode(aiAgent);
    let suppressTransferMention = false;

    if (transferMode === 'prompt') {
      let promptTransferDecision: {
        shouldTransfer: boolean;
        sector: ITransferSectorOption | null;
        user: IChat['user'] | null;
        message: string;
      } | null = null;

      try {
        promptTransferDecision = await this.resolveHumanTransferByPrompt(
          aiAgent,
          createChat,
          userText,
          recentMessages
        );
      } catch (error) {
        if (this.isAiInteractionError(error)) {
          console.error(
            '[ChatbotFlow] AI interaction failed on transfer resolution, routing fallback',
            error
          );
          const fallbackHandled = await this.tryProcessAiInteractionFallback(
            t,
            createChat,
            chatbotFlow,
            currentFlowId,
            customMessages
          );
          if (fallbackHandled) {
            return true;
          }
        } else {
          throw error;
        }
      }

      if (promptTransferDecision?.shouldTransfer) {
        return this.executeHumanSupportTransfer(
          t,
          createChat,
          chatbotFlow,
          currentFlowId,
          promptTransferDecision.sector,
          customMessages,
          promptTransferDecision.user,
          promptTransferDecision.message ?? ''
        );
      }
    }

    const humanSupportEnabled = transferMode === 'standard';

    let intent: 'needs_help' | 'resolved' | 'human_support' = 'needs_help';

    try {
      intent = await this.analyzeUserIntentWithContext(
        aiAgent,
        userText,
        recentMessages,
        humanSupportEnabled
      );
    } catch (error) {
      if (this.isAiInteractionError(error)) {
        console.error(
          '[ChatbotFlow] AI interaction failed on intent analysis, routing fallback',
          error
        );
        const fallbackHandled = await this.tryProcessAiInteractionFallback(
          t,
          createChat,
          chatbotFlow,
          currentFlowId,
          customMessages
        );
        if (fallbackHandled) {
          return true;
        }
      } else {
        throw error;
      }
    }

    if (intent === 'resolved') {
      const resolvedNextFlowId = this.getNextFlowIdByOption(
        chatbotFlow,
        currentFlowId,
        'negative-option'
      );
      if (resolvedNextFlowId) {
        await this.resetFailedAttempts(createChat);
        return this.processNextNode(
          t,
          createChat,
          chatbotFlow,
          resolvedNextFlowId,
          customMessages
        );
      }
    }

    if (intent === 'human_support') {
      const humanSupportResult = await this.processTextResponseAnalysis(
        t,
        createChat,
        chatbotFlow,
        currentFlowId,
        currentNode,
        customMessages
      );

      if (humanSupportResult) {
        return true;
      }
    }

    return this.processAiAgentResponse(
      t,
      createChat,
      currentNode,
      aiAgent,
      currentFlowId,
      userText,
      bootstrapSummaryKey,
      conversationSummaryKey,
      chatbotFlow,
      customMessages,
      { suppressTransferMention, transferMode },
      inputMessageType,
      deliveryMessageId
    );
  }

  private async tryAdvanceAiAgentAfterInteractionLimit(input: {
    t: TFunction<'translation', undefined>;
    createChat: IChat;
    currentNode: ListChatbotFlowResponse['nodes'][number];
    currentFlowId: string;
    chatbotFlow: ListChatbotFlowResponse;
    customMessages?: IChatbotCustomMessages;
  }): Promise<boolean> {
    const actionAfterInteractions =
      input.currentNode.data?.actionAfterInteractions === true;
    const interactionsQuantity =
      input.currentNode.data?.interactionsQuantity ?? 0;

    if (!actionAfterInteractions || interactionsQuantity <= 0) {
      return false;
    }

    const newCount = await this.incrementAiAgentInteractionsCount(
      input.createChat.account.id,
      input.createChat.worker.id,
      input.createChat.chat_id,
      input.currentFlowId
    );

    if (
      !this.hasExceededInteractionLimitAfterIncrement(
        newCount,
        interactionsQuantity
      )
    ) {
      return false;
    }

    const nextFlowId = this.getNextFlowIdByInteractionsHandle(
      input.chatbotFlow,
      input.currentFlowId
    );

    if (!nextFlowId) {
      return false;
    }

    await this.resetAiAgentInteractionsCount(
      input.createChat.account.id,
      input.createChat.worker.id,
      input.createChat.chat_id,
      input.currentFlowId
    );
    await this.updateCache(input.createChat, nextFlowId);
    const nextNodeProcessed = await this.processNextNode(
      input.t,
      input.createChat,
      input.chatbotFlow,
      nextFlowId,
      input.customMessages
    );

    if (!nextNodeProcessed) {
      throw new Error(
        'Nó posterior à resposta do Agente de IA não foi concluído.'
      );
    }

    return true;
  }

  private async processAiAgentResponse(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    currentNode: ListChatbotFlowResponse['nodes'][number],
    aiAgent: ViewAiAgentResponse,
    currentFlowId: string,
    userText: string,
    bootstrapSummaryKey: string,
    conversationSummaryKey: string,
    chatbotFlow: ListChatbotFlowResponse,
    customMessages?: IChatbotCustomMessages,
    transferOptions?: {
      suppressTransferMention?: boolean;
      transferMode?: HumanTransferMode;
    },
    inputMessageType?: EMessageType,
    deliveryMessageId?: string
  ): Promise<boolean> {
    if (!aiAgent.base_url || !aiAgent.api_key || !aiAgent.model) {
      throw new InvalidConfigurationError(
        'AI Agent base_url, api_key ou model não está configurado.'
      );
    }

    const baseUrl = aiAgent.base_url;
    const apiKey = aiAgent.api_key;
    const model = aiAgent.model;

    const recentMessages = await this.getConversationHistory(
      createChat.account.id,
      createChat.worker.id,
      createChat.chat_id,
      aiAgent.ai_agent_id,
      20
    );

    const useFileSearchResponsesApi =
      aiAgent.ai_agent_type_id === EAiAgentType.gpt &&
      !!aiAgent.openai_vector_store_id;
    const transferMode =
      transferOptions?.transferMode ?? this.resolveHumanTransferMode(aiAgent);
    let enhancedPrompt =
      aiAgent.system_prompt?.trim() || 'Você é um assistente prestativo.';
    let contextAllowed = true;
    let contextHints: string[] = [];

    try {
      const promptData = await this.buildEnhancedPromptForAiAgent(
        createChat,
        aiAgent,
        userText,
        bootstrapSummaryKey,
        conversationSummaryKey,
        recentMessages,
        transferMode,
        {
          suppressTransferMention: transferOptions?.suppressTransferMention,
        }
      );
      enhancedPrompt = promptData.enhancedPrompt;
      contextAllowed = promptData.contextAllowed;
      contextHints = promptData.contextHints;
    } catch (error) {
      if (this.isAiInteractionError(error)) {
        console.error(
          '[ChatbotFlow] AI interaction failed while building enhanced prompt, routing fallback',
          error
        );
        const fallbackHandled = await this.tryProcessAiInteractionFallback(
          t,
          createChat,
          chatbotFlow,
          currentFlowId,
          customMessages
        );
        if (fallbackHandled) {
          return true;
        }
      }
      console.error(
        '[ChatbotFlow] buildEnhancedPromptForAiAgent failed, using fallback prompt',
        error
      );
    }

    const assistantsOptions: undefined = undefined;
    const responsesApiFileSearchOptions =
      useFileSearchResponsesApi && aiAgent.openai_vector_store_id
        ? {
            vectorStoreId: aiAgent.openai_vector_store_id,
            idempotencyKey: deliveryMessageId,
          }
        : undefined;

    let aiResponse: string;
    let shouldStoreLastAgentResponse = false;
    if (!contextAllowed) {
      let conversationalReply: string | null = null;
      try {
        conversationalReply = await this.tryBuildConversationalNoEvidenceReply(
          createChat,
          aiAgent,
          userText,
          recentMessages,
          { throwOnAiInteractionError: true }
        );
      } catch (error) {
        if (this.isAiInteractionError(error)) {
          console.error(
            '[ChatbotFlow] AI interaction failed on no-evidence conversational reply, routing fallback',
            error
          );
          const fallbackHandled = await this.tryProcessAiInteractionFallback(
            t,
            createChat,
            chatbotFlow,
            currentFlowId,
            customMessages
          );
          if (fallbackHandled) {
            return true;
          }
        }
        throw error;
      }

      if (conversationalReply) {
        aiResponse = conversationalReply;
        shouldStoreLastAgentResponse = true;
      } else {
        aiResponse = this.buildOutOfContextResponse(userText, contextHints);
      }
    } else {
      try {
        aiResponse = await this.callAiAgentChatApiWithRetry(
          baseUrl,
          apiKey,
          model,
          aiAgent.ai_agent_type_id,
          enhancedPrompt,
          userText,
          recentMessages,
          assistantsOptions,
          responsesApiFileSearchOptions,
          {
            accountId: createChat.account.id,
            chatId: createChat.chat_id,
            aiAgentId: aiAgent.ai_agent_id,
          }
        );
        shouldStoreLastAgentResponse = true;

        let isDuplicate =
          this.isRepeatedResponse(aiResponse, recentMessages) ||
          (await this.isResponseRepeatedInHistory(
            createChat.account.id,
            createChat.chat_id,
            aiAgent.ai_agent_id,
            userText,
            aiResponse
          ));

        if (isDuplicate) {
          aiResponse = await this.resolveDuplicateResponse(
            aiResponse,
            enhancedPrompt,
            userText,
            recentMessages,
            createChat.account.id,
            createChat.chat_id,
            aiAgent.ai_agent_id,
            baseUrl,
            apiKey,
            model,
            aiAgent.ai_agent_type_id,
            assistantsOptions,
            responsesApiFileSearchOptions
          );
        }
      } catch (error) {
        const fallbackHandled = await this.tryProcessAiInteractionFallback(
          t,
          createChat,
          chatbotFlow,
          currentFlowId,
          customMessages
        );

        if (fallbackHandled) {
          return true;
        }

        throw error;
      }
    }

    const recentMessagesForSummary = [
      ...recentMessages,
      { role: 'user' as const, content: userText },
      { role: 'assistant' as const, content: aiResponse },
    ];

    const messageSent = await this.sendAiAgentResponse(
      t,
      createChat,
      aiResponse,
      currentNode,
      aiAgent.ai_agent_id,
      conversationSummaryKey,
      userText,
      {
        base_url: baseUrl,
        api_key: apiKey,
        model,
        ai_agent_type_id: aiAgent.ai_agent_type_id,
        voice_ia_id: aiAgent.voice_ia_id,
        voice_ia_output_mode: aiAgent.voice_ia_output_mode,
      },
      shouldStoreLastAgentResponse,
      recentMessagesForSummary,
      inputMessageType,
      deliveryMessageId
    );
    if (!messageSent) {
      throw new Error('Resposta do Agente de IA não teve entrega confirmada.');
    }

    try {
      await this.storeResponseInHistory(
        createChat.account.id,
        createChat.chat_id,
        aiAgent.ai_agent_id,
        userText,
        aiResponse
      );
      await this.pushToConversationHistory(
        createChat.account.id,
        createChat.worker.id,
        createChat.chat_id,
        aiAgent.ai_agent_id,
        'user',
        userText
      );
      await this.pushToConversationHistory(
        createChat.account.id,
        createChat.worker.id,
        createChat.chat_id,
        aiAgent.ai_agent_id,
        'assistant',
        aiResponse
      );
    } catch (storeError) {
      console.error('[AI Agent] post-delivery history write failed', {
        account_id: createChat.account.id,
        chat_id: createChat.chat_id,
        ai_agent_id: aiAgent.ai_agent_id,
        error:
          storeError instanceof Error ? storeError.message : String(storeError),
      });
    }

    try {
      const flowAdvanced = await this.tryAdvanceAiAgentAfterInteractionLimit({
        t,
        createChat,
        currentNode,
        currentFlowId,
        chatbotFlow,
        customMessages,
      });
      if (flowAdvanced) {
        return true;
      }

      await this.updateCache(createChat, currentFlowId);
    } catch (postDeliveryError) {
      // The outbound message is already durably accepted. Re-throwing here
      // would requeue the same AI turn and could send it twice.
      console.error('[AI Agent] post-delivery flow update failed', {
        account_id: createChat.account.id,
        chat_id: createChat.chat_id,
        ai_agent_id: aiAgent.ai_agent_id,
        delivery_message_id: deliveryMessageId ?? null,
        error:
          postDeliveryError instanceof Error
            ? postDeliveryError.message
            : String(postDeliveryError),
      });
    }

    return true;
  }

  private async buildEnhancedPromptForAiAgent(
    createChat: IChat,
    aiAgent: ViewAiAgentResponse,
    userText: string,
    bootstrapSummaryKey: string,
    conversationSummaryKey: string,
    recentMessages: Array<{ role: 'user' | 'assistant'; content: string }>,
    humanTransferMode: HumanTransferMode,
    options?: { suppressTransferMention?: boolean }
  ): Promise<{
    enhancedPrompt: string;
    contextAllowed: boolean;
    contextHints: string[];
  }> {
    const useFileSearchResponsesApi =
      aiAgent.ai_agent_type_id === EAiAgentType.gpt &&
      !!aiAgent.openai_vector_store_id;
    const skipFilePrompts = useFileSearchResponsesApi;

    const allPrompts = await this.ragService.getAllAgentPromptsDetailed(
      createChat.account.id,
      aiAgent.ai_agent_id
    );
    const textualPrompts = allPrompts.filter(
      (prompt) => !this.looksLikeUrl(prompt.value)
    );
    const allowExternalContext = skipFilePrompts;

    const systemPrompt = this.buildComprehensiveSystemPrompt(
      aiAgent.system_prompt,
      allPrompts,
      skipFilePrompts
    );

    let promptsText =
      this.ragService.buildPromptsTextFromDetailed(textualPrompts);
    if (aiAgent.system_prompt) {
      promptsText = aiAgent.system_prompt + '\n\n' + promptsText;
    }
    const normalizedQuestion = this.normalizeTextForComparison(userText);
    const promptsSignature = this.buildPromptContextSignature(
      allPrompts,
      aiAgent.system_prompt,
      skipFilePrompts
    );
    const ragCacheKey =
      normalizedQuestion && promptsSignature
        ? this.getRagCacheKey(
            createChat.account.id,
            createChat.chat_id,
            aiAgent.ai_agent_id,
            normalizedQuestion,
            promptsSignature
          )
        : null;

    if (ragCacheKey) {
      const cachedRag = await this.redis.get(ragCacheKey);
      if (cachedRag) {
        try {
          const parsed = JSON.parse(cachedRag) as {
            contextParts: string[];
            contextAllowed: boolean;
            contextHints: string[];
            decisionPath?: string;
          };

          const { enhancedPrompt } =
            this.ragService.buildEnhancedPromptFromCachedParts(
              systemPrompt,
              parsed.contextParts,
              parsed.contextAllowed,
              parsed.contextHints ?? []
            );

          const additionalInstructions =
            this.buildAdditionalAiResponseInstructions(
              userText,
              recentMessages,
              humanTransferMode,
              options
            );
          let combinedAllowed = parsed.contextAllowed || allowExternalContext;
          let effectivePrompt = enhancedPrompt;
          let effectiveContextHints = parsed.contextHints ?? [];
          let decisionPath =
            parsed.decisionPath ??
            (allowExternalContext
              ? 'provider_file_search'
              : combinedAllowed
                ? 'hybrid_retrieval'
                : 'out_of_context');

          const cachedFallbackResult =
            await this.applyRuntimeFallbackToCachedContext({
              accountId: createChat.account.id,
              allPrompts,
              userText,
              aiAgent: {
                base_url: aiAgent.base_url,
                api_key: aiAgent.api_key,
                model: aiAgent.model,
                ai_agent_type_id: aiAgent.ai_agent_type_id,
              },
              allowExternalContext,
              combinedAllowed,
              effectivePrompt,
              effectiveContextHints,
              decisionPath,
              parsedContextParts: parsed.contextParts ?? [],
              systemPrompt,
              ragCacheKey,
            });

          combinedAllowed = cachedFallbackResult.combinedAllowed;
          effectivePrompt = cachedFallbackResult.effectivePrompt;
          effectiveContextHints = cachedFallbackResult.effectiveContextHints;
          decisionPath = cachedFallbackResult.decisionPath;

          this.recordContextDecisionPath(decisionPath, {
            accountId: createChat.account.id,
            aiAgentId: aiAgent.ai_agent_id,
            aiAgentTypeId: aiAgent.ai_agent_type_id,
          });

          if (!additionalInstructions) {
            return {
              enhancedPrompt: effectivePrompt,
              contextAllowed: combinedAllowed,
              contextHints: effectiveContextHints,
            };
          }

          return {
            enhancedPrompt: `${effectivePrompt}\n\n### Diretrizes Adicionais:\n${additionalInstructions}`,
            contextAllowed: combinedAllowed,
            contextHints: effectiveContextHints,
          };
        } catch (error) {
          console.error('[AI Agent] RAG cache parse error:', error);
        }
      }
    }
    const bootstrapSummary = await this.ensureBootstrapSummary(
      bootstrapSummaryKey,
      promptsText,
      {
        base_url: aiAgent.base_url ?? '',
        api_key: aiAgent.api_key ?? '',
        model: aiAgent.model ?? '',
        ai_agent_type_id: aiAgent.ai_agent_type_id,
      }
    );
    const conversationSummary = await this.redis.get(conversationSummaryKey);
    const maxPromptChars = this.estimateMaxPromptChars(
      aiAgent.model ?? '',
      undefined
    );

    const ragResult = await this.ragService.enhancePromptWithRag(
      createChat.account.id,
      aiAgent.ai_agent_id,
      systemPrompt,
      userText,
      {
        topK: 10,
        historyTopK: 8,
        minScore: 0.18,
        chatId: createChat.chat_id,
        includeChatHistory: true,
        isBootstrap: false,
        bootstrapSummary: bootstrapSummary,
        includeBootstrapSummaryInPrompt: false,
        conversationSummary: conversationSummary,
        recentMessages: recentMessages,
        phone: createChat.phone,
        maxPromptChars,
      }
    );

    let combinedAllowed = ragResult.contextAllowed || allowExternalContext;
    let effectivePrompt = ragResult.enhancedPrompt;
    let effectiveContextParts = ragResult.contextParts;
    let effectiveContextHints = ragResult.contextHints;
    let decisionPath = allowExternalContext
      ? 'provider_file_search'
      : ragResult.evidence.decisionPath;

    if (!combinedAllowed && !allowExternalContext) {
      const runtimeFallback = await this.tryRuntimePromptFallback(
        createChat.account.id,
        allPrompts,
        userText,
        {
          base_url: aiAgent.base_url,
          api_key: aiAgent.api_key,
          model: aiAgent.model,
          ai_agent_type_id: aiAgent.ai_agent_type_id,
        }
      );

      if (runtimeFallback) {
        const fallbackContextParts = [
          ...effectiveContextParts,
          `### Contexto Relevante da Base de Conhecimento (Fallback Runtime):\n${runtimeFallback.contextText}`,
        ];

        const rebuilt = this.ragService.buildEnhancedPromptFromCachedParts(
          systemPrompt,
          fallbackContextParts,
          true,
          runtimeFallback.contextHints
        );

        combinedAllowed = true;
        effectivePrompt = rebuilt.enhancedPrompt;
        effectiveContextParts = fallbackContextParts;
        effectiveContextHints = runtimeFallback.contextHints;
        decisionPath = 'runtime_fallback';
      } else {
        decisionPath = 'out_of_context';
      }
    }

    this.recordContextDecisionPath(decisionPath, {
      accountId: createChat.account.id,
      aiAgentId: aiAgent.ai_agent_id,
      aiAgentTypeId: aiAgent.ai_agent_type_id,
      knowledgeScore: ragResult.evidence.knowledgeScore,
      historyScore: ragResult.evidence.historyScore,
      lexicalCoverage: ragResult.evidence.lexicalCoverage,
      exactMatchScore: ragResult.evidence.exactMatchScore,
      contextAllowed: combinedAllowed,
    });

    if (ragCacheKey) {
      try {
        await this.redis.set(
          ragCacheKey,
          JSON.stringify({
            contextParts: effectiveContextParts,
            contextAllowed: combinedAllowed,
            contextHints: effectiveContextHints,
            decisionPath,
          }),
          'EX',
          this.RAG_CACHE_TTL_SECONDS
        );
      } catch (error) {
        console.error('[AI Agent] RAG cache write error:', error);
      }
    }

    const additionalInstructions = this.buildAdditionalAiResponseInstructions(
      userText,
      recentMessages,
      humanTransferMode,
      options
    );

    if (!additionalInstructions) {
      return {
        enhancedPrompt: effectivePrompt,
        contextAllowed: combinedAllowed,
        contextHints: effectiveContextHints,
      };
    }

    return {
      enhancedPrompt: `${effectivePrompt}\n\n### Diretrizes Adicionais:\n${additionalInstructions}`,
      contextAllowed: combinedAllowed,
      contextHints: effectiveContextHints,
    };
  }

  private buildPromptContextSignature(
    prompts: Array<{
      ai_agent_prompt_id: string;
      status: string;
      updated_at: string | null;
    }>,
    systemPrompt: string | null | undefined,
    skipFilePrompts: boolean
  ): string {
    const promptSignature = prompts
      .map(
        (prompt) =>
          `${prompt.ai_agent_prompt_id}:${prompt.status}:${prompt.updated_at ?? ''}`
      )
      .sort();

    const payload = JSON.stringify({
      prompts: promptSignature,
      system_prompt_hash: this.hashText((systemPrompt ?? '').trim()),
      skip_file_prompts: skipFilePrompts,
    });

    return this.hashText(payload);
  }

  private async applyRuntimeFallbackToCachedContext(input: {
    accountId: string;
    allPrompts: Array<{
      ai_agent_prompt_id: string;
      value: string;
      status: string;
      updated_at: string | null;
    }>;
    userText: string;
    aiAgent: {
      base_url: string | null;
      api_key: string | null;
      model: string | null;
      ai_agent_type_id: string;
    };
    allowExternalContext: boolean;
    combinedAllowed: boolean;
    effectivePrompt: string;
    effectiveContextHints: string[];
    decisionPath: string;
    parsedContextParts: string[];
    systemPrompt: string;
    ragCacheKey: string | null;
  }): Promise<{
    combinedAllowed: boolean;
    effectivePrompt: string;
    effectiveContextHints: string[];
    decisionPath: string;
  }> {
    if (input.combinedAllowed || input.allowExternalContext) {
      return {
        combinedAllowed: input.combinedAllowed,
        effectivePrompt: input.effectivePrompt,
        effectiveContextHints: input.effectiveContextHints,
        decisionPath: input.decisionPath,
      };
    }

    const runtimeFallback = await this.tryRuntimePromptFallback(
      input.accountId,
      input.allPrompts,
      input.userText,
      input.aiAgent
    );

    if (!runtimeFallback) {
      return {
        combinedAllowed: input.combinedAllowed,
        effectivePrompt: input.effectivePrompt,
        effectiveContextHints: input.effectiveContextHints,
        decisionPath: input.decisionPath,
      };
    }

    const fallbackContextParts = [
      ...input.parsedContextParts,
      `### Contexto Relevante da Base de Conhecimento (Fallback Runtime):\n${runtimeFallback.contextText}`,
    ];

    const rebuilt = this.ragService.buildEnhancedPromptFromCachedParts(
      input.systemPrompt,
      fallbackContextParts,
      true,
      runtimeFallback.contextHints
    );

    if (input.ragCacheKey) {
      await this.redis.set(
        input.ragCacheKey,
        JSON.stringify({
          contextParts: fallbackContextParts,
          contextAllowed: true,
          contextHints: runtimeFallback.contextHints,
          decisionPath: 'runtime_fallback',
        }),
        'EX',
        this.RAG_CACHE_TTL_SECONDS
      );
    }

    return {
      combinedAllowed: true,
      effectivePrompt: rebuilt.enhancedPrompt,
      effectiveContextHints: runtimeFallback.contextHints,
      decisionPath: 'runtime_fallback',
    };
  }

  private looksLikeUrl(value: string): boolean {
    if (!value) {
      return false;
    }
    return /^https?:\/\//i.test(value.trim());
  }

  private recordContextDecisionPath(
    decisionPath: string,
    metadata: {
      accountId: string;
      aiAgentId: string;
      aiAgentTypeId: string;
      knowledgeScore?: number;
      historyScore?: number;
      lexicalCoverage?: number;
      exactMatchScore?: number;
      contextAllowed?: boolean;
    }
  ): void {
    if (decisionPath === 'runtime_fallback') {
    }

    if (decisionPath === 'out_of_context') {
    }

    console.log('[AI Agent] contexto decisão', {
      decision_path: decisionPath,
      account_id: metadata.accountId,
      ai_agent_id: metadata.aiAgentId,
      ai_agent_type_id: metadata.aiAgentTypeId,
      knowledge_score: metadata.knowledgeScore ?? 0,
      history_score: metadata.historyScore ?? 0,
      lexical_coverage: metadata.lexicalCoverage ?? 0,
      exact_match_score: metadata.exactMatchScore ?? 0,
      context_allowed: metadata.contextAllowed ?? null,
    });
  }

  private getRuntimePromptCacheKey(
    accountId: string,
    promptId: string,
    updatedAt: string | null
  ): string {
    const version = updatedAt ?? 'unknown';
    return `chatbot:ai-agent:prompt-runtime:${accountId}:${promptId}:${version}`;
  }

  private async tryRuntimePromptFallback(
    accountId: string,
    prompts: Array<{
      ai_agent_prompt_id: string;
      value: string;
      status: string;
      updated_at: string | null;
    }>,
    userText: string,
    aiAgent: {
      base_url: string | null;
      api_key: string | null;
      model: string | null;
      ai_agent_type_id: string;
    }
  ): Promise<{ contextText: string; contextHints: string[] } | null> {
    if (!aiAgent.base_url || !aiAgent.api_key || !aiAgent.model) {
      return null;
    }

    const activeFilePrompts = prompts.filter(
      (prompt) =>
        prompt.status === EAiAgentStatus.active &&
        this.looksLikeUrl(prompt.value)
    );

    if (activeFilePrompts.length === 0) {
      return null;
    }

    let bestMatch: {
      score: number;
      contextText: string;
      hints: string[];
    } | null = null;

    for (const prompt of activeFilePrompts) {
      const promptText = await this.loadRuntimePromptText(accountId, prompt);
      if (!promptText) {
        continue;
      }

      const candidates = this.buildRuntimeFallbackCandidates(promptText);
      if (candidates.length === 0) {
        continue;
      }

      const match = await this.selectRuntimeFallbackCandidateWithAgent(
        {
          base_url: aiAgent.base_url,
          api_key: aiAgent.api_key,
          model: aiAgent.model,
          ai_agent_type_id: aiAgent.ai_agent_type_id,
        },
        userText,
        candidates
      );
      if (!match) {
        continue;
      }

      if (!bestMatch || match.score > bestMatch.score) {
        bestMatch = {
          score: match.score,
          contextText: match.contextText,
          hints: match.contextHints,
        };
      }
    }

    if (!bestMatch) {
      return null;
    }

    return {
      contextText: bestMatch.contextText,
      contextHints: bestMatch.hints,
    };
  }

  private async loadRuntimePromptText(
    accountId: string,
    prompt: {
      ai_agent_prompt_id: string;
      value: string;
      updated_at: string | null;
    }
  ): Promise<string | null> {
    const cacheKey = this.getRuntimePromptCacheKey(
      accountId,
      prompt.ai_agent_prompt_id,
      prompt.updated_at
    );
    const cached = await this.redis.get(cacheKey);
    if (cached && cached.trim().length > 0) {
      return cached;
    }

    try {
      const extraction = await this.retryOperation(
        () =>
          this.promptDocumentExtractorService.extractTextFromUrl(prompt.value, {
            allowLegacyOfficeFormats: true,
          }),
        2,
        350
      );
      const text = extraction.text.trim();
      if (!text) {
        return null;
      }

      const truncated = text.slice(0, this.RUNTIME_PROMPT_MAX_CHARS);
      await this.redis.set(
        cacheKey,
        truncated,
        'EX',
        this.RUNTIME_PROMPT_CACHE_TTL_SECONDS
      );
      return truncated;
    } catch (error) {
      console.error('[AI Agent] runtime fallback extract error', {
        error,
        account_id: accountId,
        ai_agent_prompt_id: prompt.ai_agent_prompt_id,
      });
      return null;
    }
  }

  private buildRuntimeFallbackCandidates(promptText: string): Array<{
    selectionText: string;
    contextText: string;
    contextHints: string[];
  }> {
    const candidates: Array<{
      selectionText: string;
      contextText: string;
      contextHints: string[];
    }> = [];

    const faqEntries = this.splitPromptTextIntoFaqEntries(promptText);
    for (const entry of faqEntries) {
      const question = entry.question.replace(/\s+/g, ' ').trim();
      const answer = entry.answer.replace(/\s+/g, ' ').trim();
      if (!question || !answer) {
        continue;
      }

      candidates.push({
        selectionText:
          question.length > 220
            ? `${question.slice(0, 217).trimEnd()}...`
            : question,
        contextText: [
          `Pergunta encontrada na base: ${question}`,
          `Resposta oficial: ${answer}`,
        ].join('\n'),
        contextHints: [question],
      });
    }

    if (candidates.length > 0) {
      return candidates.slice(0, 250);
    }

    const paragraphs = promptText
      .split(/\n\s*\n/g)
      .map((part) => part.replace(/\s+/g, ' ').trim())
      .filter(Boolean);

    for (const paragraph of paragraphs) {
      if (paragraph.length < 40) {
        continue;
      }

      const selectionText =
        paragraph.length > 220
          ? `${paragraph.slice(0, 217).trimEnd()}...`
          : paragraph;

      candidates.push({
        selectionText,
        contextText: `Trecho relevante da base:\n${paragraph}`,
        contextHints: [selectionText],
      });
    }

    return candidates.slice(0, 250);
  }

  private async selectRuntimeFallbackCandidateWithAgent(
    aiAgent: {
      base_url: string;
      api_key: string;
      model: string;
      ai_agent_type_id: string;
    },
    userText: string,
    candidates: Array<{
      selectionText: string;
      contextText: string;
      contextHints: string[];
    }>
  ): Promise<{
    score: number;
    contextText: string;
    contextHints: string[];
  } | null> {
    if (candidates.length === 0) {
      return null;
    }

    const maxBatches = 6;
    const batchSize = 40;
    const minimumConfidence = 0.35;
    let best: {
      score: number;
      contextText: string;
      contextHints: string[];
    } | null = null;

    for (
      let offset = 0, batch = 0;
      offset < candidates.length && batch < maxBatches;
      offset += batchSize, batch += 1
    ) {
      const candidateBatch = candidates.slice(offset, offset + batchSize);
      if (candidateBatch.length === 0) {
        continue;
      }

      const selection = await this.classifyRuntimeFallbackBatch(
        aiAgent,
        userText,
        candidateBatch
      );
      if (!selection || selection.selectedIndex <= 0) {
        continue;
      }

      const selectedCandidate = candidateBatch[selection.selectedIndex - 1];
      if (!selectedCandidate) {
        continue;
      }

      if (!best || selection.confidence > best.score) {
        best = {
          score: selection.confidence,
          contextText: selectedCandidate.contextText,
          contextHints: selectedCandidate.contextHints,
        };
      }
    }

    if (!best || best.score < minimumConfidence) {
      return null;
    }

    return best;
  }

  private async classifyRuntimeFallbackBatch(
    aiAgent: {
      base_url: string;
      api_key: string;
      model: string;
      ai_agent_type_id: string;
    },
    userText: string,
    candidates: Array<{ selectionText: string }>
  ): Promise<{ selectedIndex: number; confidence: number } | null> {
    if (candidates.length === 0) {
      return null;
    }

    const candidatesText = candidates
      .map((candidate, index) => `${index + 1}. ${candidate.selectionText}`)
      .join('\n');

    const basePrompt =
      `Você é um classificador semântico de relevância para base de conhecimento.

Objetivo:
- Analisar a pergunta do usuário e selecionar o candidato que melhor responde a pergunta.
- Faça avaliação semântica (intenção e significado), não comparação literal.

Regras:
1. Se houver candidato semanticamente relacionado e útil para responder, selecione o melhor candidato.
2. Retorne selected_index = 0 APENAS quando nenhum candidato tiver relação semântica suficiente.
3. Considere paráfrases, variações de redação e perguntas que pedem um detalhe específico da resposta (ex.: pergunta sobre e-mail dentro de um candidato sobre canais de contato).
4. Retorne confidence entre 0 e 1.
5. Não invente candidato. Use apenas índices da lista.
6. Em empate, prefira o candidato mais específico para a pergunta.
7. Não use ` +
      '`selected_index = 0`' +
      ` por excesso de conservadorismo quando houver candidato plausível.

Pergunta do usuário:
"${userText}"

Candidatos:
${candidatesText}

Retorne APENAS JSON válido (sem markdown):
{"selected_index":0|1..${candidates.length},"confidence":0.0}`;
    const prompts = [
      basePrompt,
      `${basePrompt}\n\nATENÇÃO: Sua resposta anterior foi inválida. Retorne somente JSON válido no formato solicitado.`,
    ];

    for (const prompt of prompts) {
      const rawResponse = await this.callAiAgentChatApiWithRetry(
        aiAgent.base_url,
        aiAgent.api_key,
        aiAgent.model,
        aiAgent.ai_agent_type_id,
        prompt,
        userText
      );

      const parsed = this.parseRuntimeFallbackSelection(
        rawResponse,
        candidates.length
      );
      if (parsed) {
        return parsed;
      }
    }

    return null;
  }

  private parseRuntimeFallbackSelection(
    analysis: string,
    maxIndex: number
  ): { selectedIndex: number; confidence: number } | null {
    if (!analysis || typeof analysis !== 'string') {
      return null;
    }

    const jsonMatch = analysis.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) {
      return null;
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      const rawSelectedIndex =
        typeof parsed.selected_index === 'number'
          ? parsed.selected_index
          : typeof parsed.selectedIndex === 'number'
            ? parsed.selectedIndex
            : typeof parsed.index === 'number'
              ? parsed.index
              : Number(parsed.selected_index ?? parsed.selectedIndex ?? 0);
      if (!Number.isFinite(rawSelectedIndex)) {
        return null;
      }

      const selectedIndex = Math.max(0, Math.floor(rawSelectedIndex));
      if (selectedIndex > maxIndex) {
        return null;
      }

      const rawConfidence =
        typeof parsed.confidence === 'number'
          ? parsed.confidence
          : typeof parsed.score === 'number'
            ? parsed.score
            : Number(parsed.confidence ?? parsed.score ?? 0);
      const confidence =
        Number.isFinite(rawConfidence) && rawConfidence >= 0
          ? Math.min(1, rawConfidence)
          : 0;

      return {
        selectedIndex,
        confidence,
      };
    } catch (error) {
      console.error(
        '[ChatbotFlow] parseRuntimeFallbackSelection failed',
        error
      );
      return null;
    }
  }

  private splitPromptTextIntoFaqEntries(
    promptText: string
  ): Array<{ question: string; answer: string }> {
    const lines = promptText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    const entries: Array<{ question: string; answer: string }> = [];
    let currentQuestion = '';
    let currentAnswer: string[] = [];

    const flush = (): void => {
      if (!currentQuestion || currentAnswer.length === 0) {
        return;
      }
      entries.push({
        question: currentQuestion,
        answer: currentAnswer.join('\n').trim(),
      });
    };

    for (const line of lines) {
      if (this.isLikelyFaqQuestionLine(line)) {
        flush();
        currentQuestion = line;
        currentAnswer = [];
        continue;
      }

      if (!currentQuestion) {
        continue;
      }

      currentAnswer.push(line);
    }

    flush();

    return entries;
  }

  private isLikelyFaqQuestionLine(line: string): boolean {
    if (!line) {
      return false;
    }

    const trimmed = line.trim();
    if (trimmed.length < 10 || trimmed.length > 260) {
      return false;
    }

    if (trimmed.endsWith('?')) {
      return true;
    }

    return /^(pergunta|q)[:\-]/i.test(trimmed);
  }

  private buildComprehensiveSystemPrompt(
    agentSystemPrompt: string | null,
    filePrompts: Array<{ value: string }>,
    skipFilePrompts = false
  ): string {
    const hasFilePrompts = filePrompts.length > 0;
    const shouldUseFileSearchInstructions = skipFilePrompts && hasFilePrompts;
    const inlineTextPrompts = (
      shouldUseFileSearchInstructions
        ? []
        : filePrompts.filter((prompt) => !this.looksLikeUrl(prompt.value))
    ).filter((prompt) => prompt.value.trim().length > 0);
    const hasOnlyUrlPrompts = hasFilePrompts && inlineTextPrompts.length === 0;

    const baseInstruction = (agentSystemPrompt ?? '').trim();
    const parts: string[] = [];

    if (baseInstruction.length > 0) {
      parts.push(baseInstruction);
    } else if (!hasFilePrompts) {
      parts.push('Você é um assistente prestativo.');
    }

    if (hasFilePrompts || baseInstruction.length > 0) {
      parts.push('');
      parts.push('### INSTRUÇÕES DE CONTEXTO:');
      parts.push(
        '- Use apenas o contexto disponível para responder. Não invente informações que não estejam no contexto.'
      );
      if (shouldUseFileSearchInstructions) {
        parts.push(
          '- Documentos e arquivos estão disponíveis via File Search. Consulte a ferramenta quando necessário.'
        );
        parts.push(
          '- Combine prompts de texto, resultados do File Search, contexto RAG e histórico de conversa.'
        );
      } else {
        parts.push(
          '- Conteúdos dos arquivos do agente são recuperados via RAG/fallback em runtime. Não use URLs brutas como evidência.'
        );
        parts.push(
          '- Combine prompts de texto, conteúdo de links/arquivos, contexto RAG e histórico de conversa.'
        );
      }
      parts.push(
        '- Responda de forma natural e humana, sem mencionar termos técnicos como "contexto", "prompt" ou "RAG".'
      );
    }

    if (inlineTextPrompts.length > 0) {
      parts.push('');
      parts.push('### BASE DE CONHECIMENTO — PROMPTS DE TEXTO:');
      for (const prompt of inlineTextPrompts) {
        parts.push('');
        parts.push(prompt.value);
      }
    }

    if (shouldUseFileSearchInstructions || hasOnlyUrlPrompts) {
      parts.push('');
      parts.push('### BASE DE CONHECIMENTO — ARQUIVOS');
      if (shouldUseFileSearchInstructions) {
        parts.push(
          'Os arquivos estão disponíveis via File Search. Consulte a ferramenta quando precisar de detalhes ou trechos específicos.'
        );
      } else {
        parts.push(
          'Os conteúdos dos arquivos anexados são recuperados via RAG e fallback runtime. Responda apenas com evidências recuperadas.'
        );
      }
    }

    if (agentSystemPrompt || filePrompts.length > 0) {
      parts.push('');
      parts.push('### REGRA FUNDAMENTAL:');
      parts.push(
        shouldUseFileSearchInstructions
          ? 'Você DEVE responder considerando a TOTALIDADE do contexto: todos os prompts de texto acima, os resultados do File Search, o contexto RAG e o histórico de conversa. Sua resposta deve ser a melhor possível com base em TODO esse conhecimento combinado.'
          : 'Você DEVE responder considerando a TOTALIDADE do contexto: todos os prompts de texto acima, todos os conteúdos dos arquivos, o contexto RAG e o histórico de conversa. Sua resposta deve ser a melhor possível com base em TODO esse conhecimento combinado.'
      );
    }

    return parts.join('\n');
  }

  private buildAdditionalAiResponseInstructions(
    userText: string,
    recentMessages: Array<{ role: 'user' | 'assistant'; content: string }>,
    humanTransferMode: HumanTransferMode,
    options?: { suppressTransferMention?: boolean }
  ): string {
    const instructions: string[] = [
      '- Entregue a melhor resposta possível, escolhendo a alternativa mais adequada ao contexto e às regras. Quando houver opções, recomende a melhor e explique rapidamente o porquê.',
      '- Combine todo o conhecimento dos prompts, RAG e histórico para formular a resposta mais completa. Evite respostas vagas ou incompletas.',
    ];

    const repeatedQuestionCount = this.getRepeatedQuestionCount(
      userText,
      recentMessages
    );

    if (humanTransferMode === 'disabled') {
      instructions.push(
        '- Transferência humana está desativada. Não prometa transferência nem diga que vai transferir.',
        '- Se o usuário pedir atendimento humano, informe que você está apto para ajudar e vai tentar da melhor forma possível, e então responda normalmente ao que foi solicitado.'
      );
    }

    if (options?.suppressTransferMention) {
      instructions.push(
        '- Não ofereça ou prometa transferência humana nesta resposta. Responda normalmente ao que foi solicitado.'
      );
    }

    if (repeatedQuestionCount > 0) {
      instructions.push(
        '- Pergunta repetida detectada. Evite repetir frases, listas e a mesma estrutura de resposta.',
        '- Traga novos detalhes, exemplos ou passos mantendo a precisão e as regras.',
        `- Estratégia de variação: ${this.pickVariationStrategy(
          repeatedQuestionCount
        )}`
      );
    }

    return instructions.join('\n');
  }

  private estimateMaxPromptChars(
    model: string,
    overrideContextTokens?: number | null
  ): number {
    const maxTokens = getContextTokensForModel(model, overrideContextTokens);
    const promptTokens = Math.max(Math.floor(maxTokens * 0.7), 2000);
    return Math.max(promptTokens * 4, 8000);
  }

  private buildOutOfContextResponse(
    userText: string,
    contextHints: string[]
  ): string {
    const seed = `${Date.now()}:${userText}`;
    const hintsText = this.formatContextHints(contextHints);
    const hintsSentence = hintsText
      ? `Posso te ajudar com assuntos da empresa como ${hintsText}.`
      : 'Posso te ajudar com informações sobre nossos serviços e atendimento.';

    const responseVariants = [
      `Entendo sua dúvida! Ainda não encontrei essa informação por aqui. ${hintsSentence} Quer que eu detalhe algum desses pontos?`,
      `Boa pergunta! Não tenho esse detalhe no momento. ${hintsSentence} Se quiser, posso explicar algum desses temas agora.`,
      `Agradeço pela pergunta! No momento não tenho uma resposta exata sobre isso. ${hintsSentence} O que você gostaria de saber?`,
      `Que bom que me procurou! Essa informação não está disponível para mim agora. ${hintsSentence} Posso ajudar com outra dúvida?`,
    ];

    return this.pickVariant(seed, responseVariants);
  }

  private pickVariant(seed: string, variants: string[]): string {
    if (variants.length === 0) {
      return '';
    }
    const hash = this.hashText(seed);
    const index = parseInt(hash.slice(0, 8), 16) % variants.length;
    return variants[index];
  }

  private formatContextHints(hints: string[]): string {
    if (!hints || hints.length === 0) {
      return '';
    }

    const uniqueHints: string[] = [];
    const seen = new Set<string>();

    for (const hint of hints) {
      if (!hint || seen.has(hint)) {
        continue;
      }
      seen.add(hint);
      uniqueHints.push(hint);
      if (uniqueHints.length >= 3) {
        break;
      }
    }

    if (uniqueHints.length === 0) {
      return '';
    }

    return uniqueHints.join(', ');
  }

  private getRepeatedQuestionCount(
    userText: string,
    recentMessages: Array<{ role: 'user' | 'assistant'; content: string }>
  ): number {
    const normalizedUserText = this.normalizeTextForComparison(userText);
    if (!normalizedUserText) {
      return 0;
    }

    const userMessages = recentMessages.filter((msg) => msg.role === 'user');
    if (userMessages.length === 0) {
      return 0;
    }

    const matchingMessages = userMessages.filter(
      (msg) =>
        this.normalizeTextForComparison(msg.content) === normalizedUserText
    );

    if (matchingMessages.length === 0) {
      return 0;
    }

    const lastUserMessage = userMessages[userMessages.length - 1];
    const includesCurrent =
      this.normalizeTextForComparison(lastUserMessage.content) ===
      normalizedUserText;

    const repeatCount = matchingMessages.length - (includesCurrent ? 1 : 0);
    return Math.max(0, repeatCount);
  }

  private pickVariationStrategy(repeatCount: number): string {
    const strategies = [
      'Responda com um passo a passo numerado.',
      'Responda com um resumo curto seguido de detalhes.',
      'Responda em formato de checklist.',
      'Responda destacando erros comuns e como evitar.',
      'Responda com um exemplo prático e depois generalize.',
      'Responda comparando alternativas e recomendando a melhor.',
      'Responda com foco em boas práticas e alertas importantes.',
      'Responda com uma explicação direta e depois uma dica avançada.',
    ];

    const safeCount = Math.max(1, repeatCount);
    const index = (safeCount - 1) % strategies.length;
    return strategies[index];
  }

  private buildDiversificationRetryPrompt(): string {
    return 'A resposta anterior foi considerada repetitiva em relação ao histórico. Forneça uma resposta substantivamente diferente: use outra abordagem, exemplos ou formato, sem adicionar observações genéricas ao final.';
  }

  private supportsDiversificationRetry(
    assistantsOptions:
      | {
          accountId: string;
          chatId: string;
          aiAgentId: string;
          openaiAssistantId: string;
        }
      | undefined
  ): boolean {
    return assistantsOptions === undefined;
  }

  private async resolveDuplicateResponse(
    duplicateResponse: string,
    enhancedPrompt: string,
    userText: string,
    recentMessages: Array<{ role: 'user' | 'assistant'; content: string }>,
    accountId: string,
    chatId: string,
    aiAgentId: string,
    baseUrl: string,
    apiKey: string,
    model: string,
    aiAgentTypeId: string,
    assistantsOptions:
      | {
          accountId: string;
          chatId: string;
          aiAgentId: string;
          openaiAssistantId: string;
        }
      | undefined,
    responsesApiFileSearchOptions:
      { vectorStoreId: string; idempotencyKey?: string } | undefined
  ): Promise<string> {
    if (!this.supportsDiversificationRetry(assistantsOptions)) {
      return this.appendVariationAddendum(duplicateResponse, Date.now());
    }

    try {
      const diversificationInstruction = this.buildDiversificationRetryPrompt();
      const diversificationPrompt = `${enhancedPrompt}\n\n### Diretrizes Adicionais:\n${diversificationInstruction}`;
      const retryHistory = [
        ...recentMessages,
        { role: 'user' as const, content: userText },
        { role: 'assistant' as const, content: duplicateResponse },
      ];
      const retryUserQuery =
        'Reformule a resposta anterior de forma substantivamente diferente.';
      const retryResponse = await this.callAiAgentChatApi(
        baseUrl,
        apiKey,
        model,
        aiAgentTypeId,
        diversificationPrompt,
        retryUserQuery,
        retryHistory,
        assistantsOptions,
        responsesApiFileSearchOptions
          ? {
              ...responsesApiFileSearchOptions,
              idempotencyKey: responsesApiFileSearchOptions.idempotencyKey
                ? `${responsesApiFileSearchOptions.idempotencyKey}:diversification`
                : undefined,
            }
          : undefined,
        { accountId, chatId, aiAgentId }
      );
      const isRetryDuplicate =
        this.isRepeatedResponse(retryResponse, retryHistory) ||
        (await this.isResponseRepeatedInHistory(
          accountId,
          chatId,
          aiAgentId,
          userText,
          retryResponse
        ));
      if (!isRetryDuplicate) {
        return retryResponse;
      }
      return this.appendVariationAddendum(duplicateResponse, Date.now());
    } catch (error) {
      console.error(
        '[ChatbotFlow] resolveDuplicateResponse retry failed',
        error
      );
      return this.appendVariationAddendum(duplicateResponse, Date.now());
    }
  }

  private isRepeatedResponse(
    response: string,
    recentMessages: Array<{ role: 'user' | 'assistant'; content: string }>
  ): boolean {
    const normalizedResponse = this.normalizeTextForComparison(response);
    if (!normalizedResponse) {
      return false;
    }

    const assistantMessages = recentMessages.filter(
      (msg) => msg.role === 'assistant'
    );
    return assistantMessages.some(
      (msg) =>
        this.normalizeTextForComparison(msg.content) === normalizedResponse
    );
  }

  private appendVariationAddendum(response: string, seed: number): string {
    const addendums = [
      'Observação adicional: posso detalhar em um passo a passo se você quiser.',
      'Observação adicional: posso trazer um exemplo prático para o seu caso.',
      'Observação adicional: posso resumir a resposta em formato de checklist.',
      'Observação adicional: posso comparar alternativas e indicar a mais adequada.',
    ];

    const baseIndex = Math.abs(seed) % addendums.length;
    const normalizedResponse = this.normalizeTextForComparison(response);

    for (let offset = 0; offset < addendums.length; offset++) {
      const candidate = addendums[(baseIndex + offset) % addendums.length];
      const normalizedCandidate = this.normalizeTextForComparison(candidate);
      if (!normalizedResponse.includes(normalizedCandidate)) {
        return `${response}\n\n${candidate}`;
      }
    }

    return response;
  }

  private normalizeTextForComparison(text: string): string {
    if (!text) {
      return '';
    }

    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  private hashText(text: string): string {
    return createHash('sha256').update(text).digest('hex');
  }

  private buildResponseHistoryKey(
    accountId: string,
    chatId: string,
    aiAgentId: string,
    normalizedQuestion: string
  ): string {
    const questionHash = this.hashText(normalizedQuestion);
    return createAiResponseHistoryCacheKey(
      accountId,
      chatId,
      aiAgentId,
      questionHash
    );
  }

  private async isResponseRepeatedInHistory(
    accountId: string,
    chatId: string,
    aiAgentId: string,
    userText: string,
    response: string
  ): Promise<boolean> {
    const normalizedQuestion = this.normalizeTextForComparison(userText);
    const normalizedResponse = this.normalizeTextForComparison(response);
    if (!normalizedQuestion || !normalizedResponse) {
      return false;
    }

    const key = this.buildResponseHistoryKey(
      accountId,
      chatId,
      aiAgentId,
      normalizedQuestion
    );
    const responseHash = this.hashText(normalizedResponse);
    const exists = await this.redis.sismember(key, responseHash);

    return exists === 1;
  }

  private async storeResponseInHistory(
    accountId: string,
    chatId: string,
    aiAgentId: string,
    userText: string,
    response: string
  ): Promise<void> {
    const normalizedQuestion = this.normalizeTextForComparison(userText);
    const normalizedResponse = this.normalizeTextForComparison(response);
    if (!normalizedQuestion || !normalizedResponse) {
      return;
    }

    const key = this.buildResponseHistoryKey(
      accountId,
      chatId,
      aiAgentId,
      normalizedQuestion
    );
    const responseHash = this.hashText(normalizedResponse);
    const ttlSeconds = 60 * 60 * 24 * 7;

    await this.redis
      .multi()
      .sadd(key, responseHash)
      .expire(key, ttlSeconds)
      .exec();
  }

  private async sendAiAgentResponse(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    aiResponse: string,
    currentNode: ListChatbotFlowResponse['nodes'][number],
    selectedAiAgentId: string,
    conversationSummaryKey: string,
    userText: string,
    aiAgent: {
      base_url: string;
      api_key: string;
      model: string;
      ai_agent_type_id: string;
      voice_ia_id: string | null;
      voice_ia_output_mode?: string | null;
    },
    shouldStoreLastAgentResponse: boolean,
    recentMessagesForSummary?: Array<{
      role: 'user' | 'assistant';
      content: string;
    }>,
    inputMessageType?: EMessageType,
    deliveryMessageId?: string
  ): Promise<boolean> {
    let messageSent = false;

    const outputMode =
      (aiAgent.voice_ia_output_mode as EAiAgentVoiceOutputMode) ??
      EAiAgentVoiceOutputMode.audio;

    const shouldSendAudio =
      aiAgent.voice_ia_id &&
      aiResponse.trim().length > 0 &&
      (outputMode === EAiAgentVoiceOutputMode.audio ||
        (outputMode === EAiAgentVoiceOutputMode.match_input &&
          inputMessageType === EMessageType.audio));

    if (shouldSendAudio && aiAgent.voice_ia_id) {
      try {
        const voiceIaConfig = await this.voiceIaService.viewVoiceIa(
          aiAgent.voice_ia_id,
          createChat.account.id
        );

        if (voiceIaConfig?.api_key) {
          const cleanedTextForAudio = stripTextForTts(aiResponse);

          const uploadResult =
            cleanedTextForAudio.trim().length > 0
              ? await this.voiceIaIntegrationService.generateSpeechAndUpload(
                  cleanedTextForAudio,
                  voiceIaConfig,
                  createChat.account.id
                )
              : null;

          if (uploadResult) {
            messageSent = await this.sendMessageWithStatusGuard(t, {
              chat: createChat,
              accountId: createChat.account.id,
              messageId: deliveryMessageId,
              type: EMessageType.audio,
              audioUrl: uploadResult.url,
              audioMimetype: uploadResult.mimetype,
              audioPtt: true,
              typeUser: ETypeUserChat.bot,
            });
          }
        }
      } catch (error) {
        console.error(
          '[ChatbotFlow] sendAiAgentResponse voice fallback failed',
          error
        );
        messageSent = false;
      }
    }
    if (!messageSent) {
      messageSent = await this.sendMessageWithStatusGuard(t, {
        chat: createChat,
        accountId: createChat.account.id,
        messageId: deliveryMessageId,
        type: EMessageType.text,
        message: aiResponse,
        typeUser: ETypeUserChat.bot,
      });
    }

    if (!messageSent) {
      return false;
    }

    try {
      if (shouldStoreLastAgentResponse) {
        await this.storeLastAgentResponse(
          createChat.account.id,
          createChat.worker.id,
          createChat.chat_id,
          selectedAiAgentId,
          aiResponse
        );
      }

      const nodeId = currentNode?.id ?? selectedAiAgentId;
      const shouldUpdate = await this.shouldUpdateConversationSummary(
        createChat.account.id,
        createChat.worker.id,
        createChat.chat_id,
        nodeId
      );

      if (shouldUpdate) {
        const conversationSummary = await this.redis.get(
          conversationSummaryKey
        );
        let recentMessages: Array<{
          role: 'user' | 'assistant';
          content: string;
        }>;
        if (recentMessagesForSummary !== undefined) {
          recentMessages = recentMessagesForSummary.slice(-20);
        } else {
          recentMessages = await this.getConversationHistory(
            createChat.account.id,
            createChat.worker.id,
            createChat.chat_id,
            selectedAiAgentId,
            20
          );
        }

        await this.updateConversationSummaryAfterResponse(
          conversationSummaryKey,
          conversationSummary,
          recentMessages,
          userText,
          aiResponse,
          aiAgent
        );
      }
    } catch (error) {
      console.error('[ChatbotFlow] AI Agent post-delivery metadata failed', {
        account_id: createChat.account.id,
        chat_id: createChat.chat_id,
        ai_agent_id: selectedAiAgentId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return true;
  }

  private async processStartNode(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    chatbotFlow: ListChatbotFlowResponse,
    currentFlowId: string,
    customMessages?: IChatbotCustomMessages,
    data?: IUpsertMessage
  ): Promise<boolean> {
    const nextFlowId = this.getNextFlowId(chatbotFlow, currentFlowId);

    if (!nextFlowId) {
      throw new Error(t('chatbot_flow_not_found'));
    }

    const result = await this.processNextNode(
      t,
      createChat,
      chatbotFlow,
      nextFlowId,
      customMessages,
      data
    );

    return result;
  }

  private async processWeekdayNode(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    chatbotFlow: ListChatbotFlowResponse,
    currentFlowId: string,
    customMessages?: IChatbotCustomMessages,
    data?: IUpsertMessage
  ): Promise<boolean> {
    const currentNode = this.getFlowNodeById(chatbotFlow, currentFlowId);
    if (!currentNode) {
      throw new Error(t('chatbot_flow_node_not_found'));
    }

    const weekdayOptionId = this.getCurrentWeekdayOptionId(currentNode);
    const nextFlowId = this.getNextFlowIdByOption(
      chatbotFlow,
      currentFlowId,
      weekdayOptionId
    );

    if (!nextFlowId) {
      throw new Error(t('chatbot_flow_not_found'));
    }

    await this.updateCache(createChat, nextFlowId);

    return this.processNextNode(
      t,
      createChat,
      chatbotFlow,
      nextFlowId,
      customMessages,
      data
    );
  }

  private async processHoursNode(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    chatbotFlow: ListChatbotFlowResponse,
    currentFlowId: string,
    customMessages?: IChatbotCustomMessages,
    data?: IUpsertMessage
  ): Promise<boolean> {
    const currentNode = this.getFlowNodeById(chatbotFlow, currentFlowId);
    if (!currentNode) {
      throw new Error(t('chatbot_flow_node_not_found'));
    }

    const hoursOptionId = this.getCurrentHoursOptionId(currentNode);
    const nextFlowId = this.getNextFlowIdByOption(
      chatbotFlow,
      currentFlowId,
      hoursOptionId
    );

    if (!nextFlowId) {
      throw new Error(t('chatbot_flow_not_found'));
    }

    await this.updateCache(createChat, nextFlowId);

    return this.processNextNode(
      t,
      createChat,
      chatbotFlow,
      nextFlowId,
      customMessages,
      data
    );
  }

  private replaceHolidayPlaceholders(
    message: string,
    holidayNames: string[],
    holidayTags: string[]
  ): string {
    const holidayNamesText = holidayNames.join(', ');
    const holidayTagsText = holidayTags.join(' ');

    return message
      .replaceAll(/\{\{\s*holiday_names\s*\}\}/gi, holidayNamesText)
      .replaceAll(/\{\{\s*holiday_tags\s*\}\}/gi, holidayTagsText);
  }

  private getHolidayTypeLabel(
    t: TFunction<'translation', undefined>,
    holidayType: 'national' | 'state' | 'municipal'
  ): string {
    const labelByType: Record<'national' | 'state' | 'municipal', string> = {
      national: t('chatbot_holiday_type_national'),
      state: t('chatbot_holiday_type_state'),
      municipal: t('chatbot_holiday_type_municipal'),
    };

    return labelByType[holidayType];
  }

  private formatHolidayNamesWithType(
    t: TFunction<'translation', undefined>,
    holidayResolution: {
      holidayNames: string[];
      holidayDetails?: Array<{
        name: string;
        type: 'national' | 'state' | 'municipal';
      }>;
    }
  ): string[] {
    if (
      Array.isArray(holidayResolution.holidayDetails) &&
      holidayResolution.holidayDetails.length > 0
    ) {
      return holidayResolution.holidayDetails.map((holiday) => {
        const holidayTypeLabel = this.getHolidayTypeLabel(t, holiday.type);
        return `${holiday.name} (${holidayTypeLabel})`;
      });
    }

    return holidayResolution.holidayNames;
  }

  private buildHolidayTagFromName(name: string): string {
    const normalized = name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');

    return normalized ? `#${normalized}` : '#feriado_local';
  }

  private formatHolidayTagsWithType(
    t: TFunction<'translation', undefined>,
    holidayResolution: {
      holidayTags: string[];
      holidayDetails?: Array<{
        name: string;
        type: 'national' | 'state' | 'municipal';
      }>;
    }
  ): string[] {
    if (
      Array.isArray(holidayResolution.holidayDetails) &&
      holidayResolution.holidayDetails.length > 0
    ) {
      const tagsWithType = holidayResolution.holidayDetails.map((holiday) => {
        const holidayTypeLabel = this.getHolidayTypeLabel(t, holiday.type);
        const holidayTag = this.buildHolidayTagFromName(holiday.name);
        return `${holidayTag} (${holidayTypeLabel})`;
      });

      return ['#feriado', ...Array.from(new Set(tagsWithType))];
    }

    return holidayResolution.holidayTags;
  }

  private async processHolidayNode(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    chatbotFlow: ListChatbotFlowResponse,
    currentFlowId: string,
    customMessages?: IChatbotCustomMessages,
    data?: IUpsertMessage
  ): Promise<boolean> {
    const currentNode = this.getFlowNodeById(chatbotFlow, currentFlowId);
    if (!currentNode) {
      throw new Error(t('chatbot_flow_node_not_found'));
    }

    const holidayResolution = await this.holidayService.resolveHolidaysForDate(
      createChat.account.id,
      new Date()
    );

    if (holidayResolution.isHoliday) {
      const rawHolidayMessage =
        typeof currentNode.data?.holidayMessage === 'string'
          ? currentNode.data.holidayMessage
          : '';

      const holidayMessageTemplate =
        rawHolidayMessage.trim().length > 0
          ? rawHolidayMessage
          : t('chatbot_holiday_default_message');

      const holidayNamesWithType = this.formatHolidayNamesWithType(
        t,
        holidayResolution
      );
      const holidayTagsWithType = this.formatHolidayTagsWithType(
        t,
        holidayResolution
      );

      const holidayMessageWithPlaceholders = this.replaceHolidayPlaceholders(
        holidayMessageTemplate,
        holidayNamesWithType,
        holidayTagsWithType
      );

      const finalHolidayMessage = await this.replaceVariables(
        t,
        holidayMessageWithPlaceholders,
        createChat,
        createChat.user,
        createChat.sector
      );

      if (finalHolidayMessage.trim().length > 0) {
        await this.sendMessageWithStatusGuard(t, {
          chat: createChat,
          accountId: createChat.account.id,
          type: EMessageType.text,
          message: finalHolidayMessage,
          typeUser: ETypeUserChat.bot,
        });
      }
    }

    const nextFlowId = this.getNextFlowIdByOption(
      chatbotFlow,
      currentFlowId,
      holidayResolution.isHoliday
        ? this.HOLIDAY_IS_OPTION_ID
        : this.HOLIDAY_NOT_OPTION_ID
    );

    if (!nextFlowId) {
      throw new Error(t('chatbot_flow_not_found'));
    }

    await this.updateCache(createChat, nextFlowId);

    return this.processNextNode(
      t,
      createChat,
      chatbotFlow,
      nextFlowId,
      customMessages,
      data
    );
  }

  private async processFlowNode(
    t: TFunction<'translation', undefined>,
    data: IUpsertMessage,
    createChat: IChat,
    chatbotFlow: ListChatbotFlowResponse,
    currentFlowId: string,
    chatbotId: string,
    options?: IProcessFlowNodeOptions
  ): Promise<boolean> {
    if (!(await this.canRunAutomation(createChat))) {
      return false;
    }

    const inactivityAlert = options?.inactivityAlert;
    const redirectFailedAttempts = options?.redirectFailedAttempts;
    const customMessages = options?.customMessages;
    const isFromMe = data.message?.key?.fromMe === true;
    const flowResponsePending =
      isFromMe &&
      Boolean(
        await this.redis.get(
          this.getOfficialResponsePendingCacheKey(
            createChat.account.id,
            createChat.worker.id,
            createChat.chat_id
          )
        )
      );
    const shouldSuspendInactivity =
      flowResponsePending ||
      (await this.shouldSuspendInactivityForOfficialChat(createChat, {
        ignoreFlowResponsePending: true,
      }));

    if (
      !shouldSuspendInactivity &&
      inactivityAlert?.status === 'active' &&
      (createChat.status === EChatStatus.ura ||
        createChat.status === EChatStatus.ura_output ||
        createChat.status === EChatStatus.ura_schedule ||
        createChat.status === EChatStatus.ura_webhook)
    ) {
      const timeMinutes = inactivityAlert.time ?? 5;
      await this.scheduleInactivityCheck(createChat, timeMinutes, chatbotId);
    } else {
      await this.cancelInactivityCheck(createChat);
    }

    if (flowResponsePending) {
      return true;
    }

    const currentNode = this.getFlowNodeById(chatbotFlow, currentFlowId);
    if (!currentNode) {
      throw new Error(t('chatbot_flow_node_not_found'));
    }

    await this.resolveCompatibleNodeVariables(t, createChat, currentNode, data);

    if (isFromMe && this.isOfficialOptionNode(currentNode.type)) {
      return true;
    }

    if (!isFromMe) {
      const resumedOfficialTemplate =
        await this.resumeOfficialTemplateResponsePendingIfNeeded(
          t,
          createChat,
          chatbotFlow,
          currentFlowId,
          customMessages
        );
      if (resumedOfficialTemplate !== null) {
        return resumedOfficialTemplate;
      }
    }

    if (currentNode.type === 'start') {
      return this.processStartNode(
        t,
        createChat,
        chatbotFlow,
        currentFlowId,
        customMessages,
        data
      );
    }

    if (currentNode.type === 'apiRequest') {
      return this.processApiRequestNode(
        t,
        createChat,
        chatbotFlow,
        currentNode,
        customMessages,
        data
      );
    }

    if (currentNode.type === 'underchat') {
      return this.processUnderchatNode(
        t,
        createChat,
        chatbotFlow,
        currentNode,
        customMessages,
        data
      );
    }

    if (currentNode.type === 'menu' || currentNode.type === 'satisfaction') {
      const message =
        currentNode.type === 'menu'
          ? customMessages?.invalid_menu_option_message
          : customMessages?.invalid_satisfaction_option_message;

      return this.processMenuNode(
        t,
        data,
        createChat,
        chatbotFlow,
        currentFlowId,
        {
          customMessage: message,
          redirectFailedAttempts,
          customMessages,
        }
      );
    }

    if (isOfficialChatbotNodeType(currentNode.type)) {
      if (this.isOfficialOptionNode(currentNode.type)) {
        return this.processOfficialOptionNodeResponse(
          t,
          data,
          createChat,
          chatbotFlow,
          currentFlowId,
          {
            customMessage: customMessages?.invalid_menu_option_message,
            redirectFailedAttempts,
            customMessages,
          }
        );
      }

      return this.processOfficialNodeType(
        t,
        createChat,
        chatbotFlow,
        currentNode,
        currentFlowId,
        customMessages,
        data
      );
    }

    if (currentNode.type === 'weekday') {
      return this.processWeekdayNode(
        t,
        createChat,
        chatbotFlow,
        currentFlowId,
        customMessages,
        data
      );
    }

    if (currentNode.type === 'hours') {
      return this.processHoursNode(
        t,
        createChat,
        chatbotFlow,
        currentFlowId,
        customMessages,
        data
      );
    }

    if (currentNode.type === 'holiday') {
      return this.processHolidayNode(
        t,
        createChat,
        chatbotFlow,
        currentFlowId,
        customMessages,
        data
      );
    }

    if (currentNode.type === 'contact') {
      return this.processContactNode(
        t,
        createChat,
        chatbotFlow,
        currentFlowId,
        customMessages
      );
    }

    if (currentNode.type === 'message') {
      return this.processMessageNodeType(
        t,
        createChat,
        chatbotFlow,
        currentNode,
        currentFlowId,
        customMessages,
        data
      );
    }

    if (currentNode.type === 'randomMessage') {
      return this.processRandomMessageNodeType(
        t,
        createChat,
        chatbotFlow,
        currentNode,
        currentFlowId,
        customMessages
      );
    }

    if (currentNode.type === 'tag') {
      return this.processTagNode(
        t,
        createChat,
        chatbotFlow,
        currentFlowId,
        customMessages,
        data
      );
    }

    if (currentNode.type === 'annotation') {
      return this.processAnnotationNode(
        t,
        createChat,
        chatbotFlow,
        currentFlowId,
        customMessages
      );
    }

    if (currentNode.type === 'redirect') {
      return this.processRedirectNode(
        t,
        createChat,
        chatbotFlow,
        currentFlowId,
        customMessages
      );
    }

    if (currentNode.type === 'data') {
      return this.processDataNode(
        t,
        data,
        createChat,
        chatbotFlow,
        currentFlowId,
        customMessages
      );
    }

    if (currentNode.type === 'aiAgent') {
      return this.processAiAgentNode(
        t,
        data,
        createChat,
        chatbotFlow,
        currentFlowId,
        customMessages
      );
    }

    if (currentNode.type === 'distribution') {
      return this.processDistributionNode(
        t,
        createChat,
        chatbotFlow,
        currentFlowId,
        customMessages
      );
    }

    if (currentNode.type === 'conditional') {
      return this.processConditionalNode(
        t,
        data,
        createChat,
        chatbotFlow,
        currentFlowId,
        customMessages
      );
    }

    if (currentNode.type === 'finish') {
      return this.finishFlowOrThrow(
        t,
        createChat,
        customMessages?.service_finished_message,
        customMessages?.service_finished_message_enabled
      );
    }

    return false;
  }

  private async processConditionalNode(
    t: TFunction<'translation', undefined>,
    data: IUpsertMessage | undefined,
    createChat: IChat,
    chatbotFlow: ListChatbotFlowResponse,
    currentFlowId: string,
    customMessages?: IChatbotCustomMessages
  ): Promise<boolean> {
    const currentNode = this.getFlowNodeById(chatbotFlow, currentFlowId);

    if (!currentNode) {
      throw new Error(t('chatbot_flow_node_not_found'));
    }

    const conditions = currentNode.data?.conditions;

    if (!Array.isArray(conditions) || conditions.length === 0) {
      const defaultFlowId = this.getNextFlowIdByDefaultHandle(
        chatbotFlow,
        currentFlowId
      );

      if (defaultFlowId) {
        return this.processNextNode(
          t,
          createChat,
          chatbotFlow,
          defaultFlowId,
          customMessages
        );
      }

      const nextFlowId = this.getNextFlowId(chatbotFlow, currentFlowId);
      if (nextFlowId) {
        return this.processNextNode(
          t,
          createChat,
          chatbotFlow,
          nextFlowId,
          customMessages
        );
      }

      return false;
    }

    let operand: unknown = data
      ? (this.getTextFromUpsertMessage(data) ?? '')
      : '';
    let variableScope: Record<string, unknown> | null = null;
    if (
      currentNode.data.conditionalOperand === 'variable' &&
      currentNode.data.conditionalVariable
    ) {
      const context = await this.flowRuntimeContextService?.load({
        accountId: createChat.account.id,
        workerId: createChat.worker.id,
        chatId: createChat.chat_id,
      });
      if (context && this.flowRuntimeContextService) {
        variableScope = this.flowRuntimeContextService.toVariableScope(context);
        const expression = currentNode.data.conditionalVariable.includes('{{')
          ? currentNode.data.conditionalVariable
          : `{{ ${currentNode.data.conditionalVariable} }}`;
        operand = resolveChatbotTemplate(expression, variableScope, {
          missingValue: 'error',
        });
      }
    }

    const operandExists =
      operand !== null && operand !== undefined && operand !== '';
    if (!operandExists && currentNode.data.conditionalOperand !== 'variable') {
      const defaultFlowId = this.getNextFlowIdByDefaultHandle(
        chatbotFlow,
        currentFlowId
      );

      if (defaultFlowId) {
        return this.processNextNode(
          t,
          createChat,
          chatbotFlow,
          defaultFlowId,
          customMessages
        );
      }

      const nextFlowId = this.getNextFlowId(chatbotFlow, currentFlowId);
      if (nextFlowId) {
        return this.processNextNode(
          t,
          createChat,
          chatbotFlow,
          nextFlowId,
          customMessages
        );
      }

      return false;
    }

    for (const condition of conditions) {
      const conditionType = condition.conditionType;
      const conditionTerm = condition.conditionTerm;

      if (!conditionType) {
        continue;
      }

      let expected: unknown = conditionTerm ?? '';
      if (
        typeof conditionTerm === 'string' &&
        conditionTerm.includes('{{') &&
        variableScope
      ) {
        expected = resolveChatbotTemplate(conditionTerm, variableScope, {
          missingValue: 'error',
        });
      } else if (condition.valueType === 'number') {
        expected = Number(conditionTerm);
      } else if (condition.valueType === 'boolean') {
        expected = String(conditionTerm).toLowerCase() === 'true';
      }

      let conditionMet = false;
      const actualText = normalizeTextForConditionalComparison(
        this.formatResolvedHumanValue(operand)
      );
      const expectedText = normalizeTextForConditionalComparison(
        this.formatResolvedHumanValue(expected)
      );
      const actualNumber = Number(operand);
      const expectedNumber = Number(expected);

      switch (conditionType) {
        case 'contains':
          conditionMet = Array.isArray(operand)
            ? operand.some((entry) =>
                normalizeTextForConditionalComparison(
                  this.formatResolvedHumanValue(entry)
                ).includes(expectedText)
              )
            : actualText.includes(expectedText);
          break;
        case 'equals':
          conditionMet =
            condition.valueType === 'number'
              ? Number.isFinite(actualNumber) && actualNumber === expectedNumber
              : condition.valueType === 'boolean'
                ? Boolean(operand) === expected
                : actualText === expectedText;
          break;
        case 'not_equals':
          conditionMet = actualText !== expectedText;
          break;
        case 'not_contains':
          conditionMet = !actualText.includes(expectedText);
          break;
        case 'starts_with':
          conditionMet = actualText.startsWith(expectedText);
          break;
        case 'ends_with':
          conditionMet = actualText.endsWith(expectedText);
          break;
        case 'exists':
          conditionMet = operandExists;
          break;
        case 'not_exists':
          conditionMet = !operandExists;
          break;
        case 'greater_than':
          conditionMet = actualNumber > expectedNumber;
          break;
        case 'greater_or_equal':
          conditionMet = actualNumber >= expectedNumber;
          break;
        case 'less_than':
          conditionMet = actualNumber < expectedNumber;
          break;
        case 'less_or_equal':
          conditionMet = actualNumber <= expectedNumber;
          break;
      }

      if (conditionMet) {
        const nextFlowId = this.getNextFlowIdByCondition(
          chatbotFlow,
          currentFlowId,
          condition.id
        );

        if (nextFlowId) {
          return this.processNextNode(
            t,
            createChat,
            chatbotFlow,
            nextFlowId,
            customMessages
          );
        }
      }
    }

    const defaultFlowId = this.getNextFlowIdByDefaultHandle(
      chatbotFlow,
      currentFlowId
    );

    if (defaultFlowId) {
      return this.processNextNode(
        t,
        createChat,
        chatbotFlow,
        defaultFlowId,
        customMessages
      );
    }

    const nextFlowId = this.getNextFlowId(chatbotFlow, currentFlowId);
    if (nextFlowId) {
      return this.processNextNode(
        t,
        createChat,
        chatbotFlow,
        nextFlowId,
        customMessages
      );
    }

    return false;
  }

  private getDistributionCacheKey(accountId: string, workerId: string): string {
    return `underchat:chatbot-distribution-sequential:${accountId}:${workerId}`;
  }

  private async getEligibleUsers(
    accountId: string,
    sectorId?: string | null,
    onlineOnly = false
  ): Promise<IChat['user'][]> {
    if (sectorId) {
      const sectorUsers = await this.sectorService.listSectorUsersForTransfer(
        accountId,
        sectorId
      );
      const filteredUsers = onlineOnly
        ? (
            await Promise.all(
              sectorUsers.map(async (user) => ({
                user,
                isOnline: await this.isUserOnline(user.id),
              }))
            )
          )
            .filter((entry) => entry.isOnline)
            .map((entry) => entry.user)
        : sectorUsers;

      return filteredUsers.map((user) => ({
        id: user.id,
        name: user.name,
        photo: user.photo ?? null,
      }));
    }

    const users = await this.userService.listUsersForTransfer(accountId);
    const filteredUsers = onlineOnly
      ? (
          await Promise.all(
            users.map(async (user) => ({
              user,
              isOnline: await this.isUserOnline(user.id),
            }))
          )
        )
          .filter((entry) => entry.isOnline)
          .map((entry) => entry.user)
      : users;

    return filteredUsers.map((user) => ({
      id: user.id,
      name: user.name,
      photo: user.photo ?? null,
    }));
  }

  private async getSequentialUser(
    accountId: string,
    workerId: string,
    sectorId?: string | null,
    onlineOnly = false
  ): Promise<IChat['user'] | null> {
    const eligibleUsers = await this.getEligibleUsers(
      accountId,
      sectorId,
      onlineOnly
    );

    if (eligibleUsers.length === 0) {
      return null;
    }

    const cacheKey = this.getDistributionCacheKey(accountId, workerId);
    const currentIndexStr = await this.redis.get(cacheKey);
    let currentIndex = currentIndexStr
      ? Number.parseInt(currentIndexStr, 10)
      : 0;

    if (currentIndex >= eligibleUsers.length || currentIndex < 0) {
      currentIndex = 0;
    }

    const selectedUser = eligibleUsers[currentIndex];
    const nextIndex = (currentIndex + 1) % eligibleUsers.length;

    await this.redis.set(cacheKey, nextIndex.toString());

    return selectedUser;
  }

  private async getLoadBasedUser(
    accountId: string,
    sectorId?: string | null,
    onlineOnly = false
  ): Promise<IChat['user'] | null> {
    if (sectorId || onlineOnly) {
      const eligibleUsers = await this.getEligibleUsers(
        accountId,
        sectorId,
        onlineOnly
      );

      if (eligibleUsers.length === 0) {
        return null;
      }

      const userChatCounts = await Promise.all(
        eligibleUsers.map(async (user) => {
          const workloadQuery: any = {
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
                      path: 'user',
                      query: {
                        term: {
                          'user.id': user?.id ?? '',
                        },
                      },
                    },
                  },
                ],
                filter: [
                  {
                    terms: {
                      status: [EChatStatus.in_chat, EChatStatus.queue],
                    },
                  },
                ],
              },
            },
          };

          const workloadResult =
            await this.elasticDatabaseService.select<IChat>(
              EElasticIndex.chat,
              workloadQuery
            );
          const workloadCount =
            (workloadResult?.hits?.total as { value: number })?.value ?? 0;

          return { user, workloadCount };
        })
      );

      userChatCounts.sort((a, b) => a.workloadCount - b.workloadCount);

      return userChatCounts[0]?.user ?? null;
    }

    const userData =
      await this.userService.getAvailableUserWithLeastChats(accountId);

    if (!userData) {
      return null;
    }

    return {
      id: userData.id,
      name: userData.name,
      photo: userData.photo ?? null,
    };
  }

  private async getRandomUser(
    accountId: string,
    sectorId?: string | null,
    onlineOnly = false
  ): Promise<IChat['user'] | null> {
    const eligibleUsers = await this.getEligibleUsers(
      accountId,
      sectorId,
      onlineOnly
    );

    if (eligibleUsers.length === 0) {
      return null;
    }

    const randomIndex = Math.floor(Math.random() * eligibleUsers.length);
    return eligibleUsers[randomIndex];
  }

  private async isUserOnline(userId: string): Promise<boolean> {
    const status = await this.redis.get(`presence:user:${userId}`);

    return status === EChatUserStatus.online;
  }

  private async shouldRestrictDistributionToOnlineUsers(
    createChat: IChat
  ): Promise<boolean> {
    const workerConfig =
      await this.workerConfigViewerRepository.viewWorkerConfigByWorkerId(
        createChat.worker.id
      );

    return workerConfig?.allow_attendance_only_online === true;
  }

  private async processDistributionNode(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    chatbotFlow: ListChatbotFlowResponse,
    currentFlowId: string,
    customMessages?: IChatbotCustomMessages
  ): Promise<boolean> {
    const currentNode = this.getFlowNodeById(chatbotFlow, currentFlowId);

    if (!currentNode) {
      throw new Error(t('chatbot_flow_node_not_found'));
    }

    const configurations =
      await this.chatbotService.findChatbotFlowConfigurationsByChatbotId(
        createChat.account.id,
        chatbotFlow.chatbot_id
      );

    const flowTransferMessages = configurations?.configurations?.messages;

    const onlineOnly =
      await this.shouldRestrictDistributionToOnlineUsers(createChat);
    const responsibleAttendant = createChat.contact?.responsible_attendant;

    if (responsibleAttendant) {
      const canAssignResponsibleAttendant =
        !onlineOnly || (await this.isUserOnline(responsibleAttendant.id));

      if (canAssignResponsibleAttendant) {
        const user: IChat['user'] = {
          id: responsibleAttendant.id,
          name: responsibleAttendant.name,
          photo: responsibleAttendant.photo ?? null,
        };

        const rawTransferMessage =
          flowTransferMessages?.transfer_message_user ||
          t('chatbot_transfer_message_user_default');
        const enabled =
          flowTransferMessages?.transfer_message_user_enabled !== false;

        if (rawTransferMessage && enabled !== false) {
          const transferMessage = await this.replaceVariables(
            t,
            rawTransferMessage,
            createChat,
            user,
            undefined
          );
          await this.sendMessageWithStatusGuard(t, {
            chat: createChat,
            accountId: createChat.account.id,
            type: EMessageType.system,
            message: transferMessage,
            typeUser: ETypeUserChat.bot,
          });
        }

        await this.updateAndPublishChat(t, createChat, user, undefined);

        return true;
      }
    }

    const distributionType = currentNode.data?.distributionType as
      'sequential' | 'random' | 'load' | null | undefined;

    if (!distributionType) {
      const nextFlowId = this.getNextFlowId(chatbotFlow, currentFlowId);
      if (!nextFlowId) {
        return true;
      }

      await this.updateCache(createChat, nextFlowId);
      return this.processNextNode(
        t,
        createChat,
        chatbotFlow,
        nextFlowId,
        customMessages
      );
    }

    let selectedUser: IChat['user'] | null = null;
    let selectedSector: IChat['sector'] | undefined = undefined;

    const distributionHasSector = currentNode.data?.distributionHasSector as
      boolean | null | undefined;
    const distributionSelectedSector = currentNode.data
      ?.distributionSelectedSector as string | null | undefined;

    const sectorId =
      distributionHasSector === true && distributionSelectedSector
        ? distributionSelectedSector
        : null;
    if (sectorId) {
      const sectorData = await this.sectorService.viewSectorById(
        sectorId,
        createChat.account.id
      );

      if (sectorData) {
        selectedSector = {
          id: sectorData.sector_id,
          name: sectorData.name,
          color: sectorData.color,
        };
      }
    }

    if (distributionType === 'sequential') {
      selectedUser = await this.getSequentialUser(
        createChat.account.id,
        createChat.worker.id,
        sectorId,
        onlineOnly
      );
    } else if (distributionType === 'load') {
      selectedUser = await this.getLoadBasedUser(
        createChat.account.id,
        sectorId,
        onlineOnly
      );
    } else if (distributionType === 'random') {
      selectedUser = await this.getRandomUser(
        createChat.account.id,
        sectorId,
        onlineOnly
      );
    }

    if (!selectedUser && !selectedSector) {
      const updatedChat = await this.updateAndPublishChat(
        t,
        createChat,
        null,
        null
      );

      await this.cancelInactivityCheck(updatedChat);

      return true;
    }

    let rawTransferMessage: string | undefined = undefined;
    let enabled: boolean | undefined = undefined;

    if (selectedUser && selectedSector) {
      rawTransferMessage =
        flowTransferMessages?.transfer_message_sector_user ||
        t('chatbot_transfer_message_sector_user_default');
      enabled =
        flowTransferMessages?.transfer_message_sector_user_enabled !== false;
    } else if (selectedUser) {
      rawTransferMessage =
        flowTransferMessages?.transfer_message_user ||
        t('chatbot_transfer_message_user_default');
      enabled = flowTransferMessages?.transfer_message_user_enabled !== false;
    } else if (selectedSector) {
      rawTransferMessage =
        flowTransferMessages?.transfer_message_sector ||
        t('chatbot_transfer_message_sector_default');
      enabled = flowTransferMessages?.transfer_message_sector_enabled !== false;
    }

    if (rawTransferMessage && enabled !== false) {
      const transferMessage = await this.replaceVariables(
        t,
        rawTransferMessage,
        createChat,
        selectedUser,
        selectedSector
      );
      await this.sendMessageWithStatusGuard(t, {
        chat: createChat,
        accountId: createChat.account.id,
        type: EMessageType.system,
        message: transferMessage,
        typeUser: ETypeUserChat.bot,
      });
    }

    await this.updateAndPublishChat(
      t,
      createChat,
      selectedUser,
      selectedSector
    );

    return true;
  }

  private isNonTriggerableSystemEvent(data: IUpsertMessage): boolean {
    if (data.type === EMessageType.set_disappearing_messages) {
      return true;
    }

    if (data.type === EMessageType.system) {
      const pinMessage = (
        data?.message?.message as proto.IMessage & {
          pinInChatMessage?: unknown;
        }
      )?.pinInChatMessage;

      return Boolean(pinMessage);
    }

    return false;
  }

  public async canTriggerChatbotEvent(
    data: IUpsertMessage,
    accountId: string,
    chatbotId: string,
    configurations?: Awaited<
      ReturnType<ChatbotService['findChatbotFlowConfigurationsByChatbotId']>
    >
  ): Promise<boolean> {
    if (this.isNonTriggerableSystemEvent(data)) {
      return false;
    }

    const isFromMe = data.message?.key?.fromMe === true;
    if (isFromMe) {
      return true;
    }

    const triggerEvent = classifyChatbotTriggerEvent(data);
    if (!triggerEvent) {
      return false;
    }

    const effectiveConfigurations =
      configurations ??
      (await this.chatbotService.findChatbotFlowConfigurationsByChatbotId(
        accountId,
        chatbotId
      ));

    return isChatbotTriggerEventEnabled(
      triggerEvent,
      effectiveConfigurations?.configurations?.trigger_events
    );
  }

  execute = async (
    t: TFunction<'translation', undefined>,
    data: IUpsertMessage,
    createChat: IChat,
    chatbotId: string,
    securityKeyScopes?: TSecurityKeyScope[],
    executionOptions?: IChatbotFlowExecutionOptions
  ): Promise<string | null> => {
    const assertActive =
      executionOptions?.assertActive ?? getKafkaDispatchGuard();
    const executeFlow = () =>
      this.withAutomationLock(createChat, async () => {
        await assertActive?.();
        const activeChat = await this.getAutomationChatIfAllowed(createChat);
        await assertActive?.();
        if (!activeChat) {
          return null;
        }

        if (
          executionOptions?.expectedAssignmentEventId !== undefined &&
          activeChat.meta?.assignment_event_id !==
            executionOptions.expectedAssignmentEventId
        ) {
          return null;
        }
        if (
          executionOptions?.expectedLastMessageId !== undefined &&
          (activeChat.summary?.last_message_id ?? null) !==
            executionOptions.expectedLastMessageId
        ) {
          return null;
        }

        if (activeChat.contact?.ignore === EContactIgnore.ignore_automation) {
          return null;
        }

        this.securityKeyScopesByChatId.set(
          activeChat.chat_id,
          this.normalizeSecurityKeyScopes(securityKeyScopes)
        );
        if (executionOptions?.requireHandled) {
          this.synchronousEffectsByChatId.add(activeChat.chat_id);
        }
        if (executionOptions?.executionId) {
          this.executionMessageContextByChatId.set(activeChat.chat_id, {
            executionId: executionOptions.executionId,
            nextMessageIndex: 0,
          });
        }
        this.automaticExecutionBudgetByChatId.set(activeChat.chat_id, {
          transitions: 0,
          apiNodes: 0,
          httpAttempts: 0,
        });

        try {
          const configurations =
            await this.chatbotService.findChatbotFlowConfigurationsByChatbotId(
              activeChat.account.id,
              chatbotId
            );

          const canTrigger = await this.canTriggerChatbotEvent(
            data,
            activeChat.account.id,
            chatbotId,
            configurations
          );
          if (!canTrigger) {
            return null;
          }

          const userText = this.getTextFromUpsertMessage(data)?.trim();

          if (userText) {
            const finishTriggers =
              configurations?.configurations?.finish_triggers || [];
            const userTextLower = userText.toLowerCase();
            const userWords = userTextLower.split(/\s+/);

            const hasFinishTrigger = finishTriggers.some((trigger) => {
              const triggerLower = trigger.toLowerCase();
              return userWords.includes(triggerLower);
            });

            if (hasFinishTrigger) {
              const customServiceFinishedMessage =
                configurations?.configurations?.messages
                  ?.service_finished_message;
              const serviceFinishedMessageEnabled =
                configurations?.configurations?.messages
                  ?.service_finished_message_enabled !== false;

              const finished = await this.sendFinishMessage(
                t,
                activeChat,
                customServiceFinishedMessage,
                serviceFinishedMessageEnabled
              );

              if (!finished) {
                throw new Error('chatbot automatic finish was not confirmed');
              }

              return null;
            }
          }

          const { chatbotFlow, runtimeContext } =
            await this.loadPinnedChatbotFlow(activeChat, chatbotId);

          if (!chatbotFlow) {
            throw new Error(t('chatbot_flow_not_found'));
          }

          const messagesConfig = configurations?.configurations?.messages;
          const customMessages = messagesConfig
            ? {
                ...messagesConfig,
                invalid_menu_option_message_enabled:
                  messagesConfig.invalid_menu_option_message_enabled !== false,
                invalid_satisfaction_option_message_enabled:
                  messagesConfig.invalid_satisfaction_option_message_enabled !==
                  false,
                invalid_email_message_enabled:
                  messagesConfig.invalid_email_message_enabled !== false,
                invalid_cpf_message_enabled:
                  messagesConfig.invalid_cpf_message_enabled !== false,
                invalid_cnpj_message_enabled:
                  messagesConfig.invalid_cnpj_message_enabled !== false,
                service_finished_message_enabled:
                  messagesConfig.service_finished_message_enabled !== false,
                transfer_message_user_enabled:
                  messagesConfig.transfer_message_user_enabled !== false,
                transfer_message_sector_enabled:
                  messagesConfig.transfer_message_sector_enabled !== false,
                transfer_message_sector_user_enabled:
                  messagesConfig.transfer_message_sector_user_enabled !== false,
              }
            : undefined;
          const inactivityAlert =
            configurations?.configurations?.inactivity_alert;
          const redirectFailedAttempts =
            configurations?.configurations?.redirect_failed_attempts;

          const currentFlowId = await this.cacheFirstChatbotFlowNodeIfNeeded(
            chatbotFlow,
            activeChat,
            runtimeContext
          );

          if (!currentFlowId) {
            throw new Error(t('chatbot_flow_not_found'));
          }

          const processed = await this.processFlowNode(
            t,
            data,
            activeChat,
            chatbotFlow,
            currentFlowId,
            chatbotId,
            {
              inactivityAlert,
              redirectFailedAttempts,
              customMessages,
            }
          );
          if (executionOptions?.requireHandled && !processed) {
            throw new Error('chatbot bootstrap effect was not confirmed');
          }

          return currentFlowId;
        } finally {
          this.securityKeyScopesByChatId.delete(activeChat.chat_id);
          this.synchronousEffectsByChatId.delete(activeChat.chat_id);
          this.executionMessageContextByChatId.delete(activeChat.chat_id);
          this.automaticExecutionBudgetByChatId.delete(activeChat.chat_id);
        }
      });

    if (!assertActive) {
      return executeFlow();
    }

    return runWithKafkaDispatchGuard(assertActive, executeFlow);
  };
}
