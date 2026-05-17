import { injectable, inject } from 'tsyringe';
import { createHash } from 'crypto';
import Redis from 'ioredis';
import { ChatbotService } from './chatbot.service';
import { ChatService } from './chat.service';
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
import { incrementCounter } from '@core/plugins/telemetry/observability';

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
  private readonly RANDOM_MESSAGE_CYCLE_TTL_SECONDS = 28800;
  private readonly AUTOMATION_CHAT_STATUSES: ReadonlySet<EChatStatus> =
    new Set<EChatStatus>([
      EChatStatus.ura,
      EChatStatus.ura_output,
      EChatStatus.ura_schedule,
      EChatStatus.ura_webhook,
    ]);
  private readonly securityKeyScopesByChatId = new Map<
    string,
    TSecurityKeyScope[]
  >();

  constructor(
    @inject('Redis') private readonly redis: Redis,
    @inject(ChatbotService)
    private readonly chatbotService: ChatbotService,
    @inject(ChatService)
    private readonly chatService: ChatService,
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
    private readonly promptDocumentExtractorService: PromptDocumentExtractorService
  ) {}

  private getChatbotFlowCacheKey(
    accountId: string,
    workerId: string,
    chatId: string
  ): string {
    return createChatbotFlowCacheKey(accountId, workerId, chatId);
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

    await this.redis
      .multi()
      .del(
        flowCacheKey,
        inactivityCacheKey,
        failedAttemptsCacheKey,
        menuDebounceCacheKey,
        aiAgentDebounceCacheKey,
        sectorSelectionCacheKey,
        userSelectionCacheKey
      )
      .zrem(scheduleKey, inactivityCacheKey)
      .exec();
  }

  private async getAutomationChatIfAllowed(
    createChat: IChat,
    options?: { allowClosedStatus?: boolean }
  ): Promise<IChat | null> {
    const currentChat = await this.loadCurrentChatState(createChat);

    if (!currentChat) {
      if (this.isAutomationChatStatus(createChat.status)) {
        return createChat;
      }

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
    guardOptions?: { allowClosedStatus?: boolean }
  ): Promise<boolean> {
    const guardedChat = await this.getAutomationChatIfAllowed(options.chat, {
      allowClosedStatus: guardOptions?.allowClosedStatus,
    });

    if (!guardedChat) {
      return false;
    }

    return this.chatMessageService.sendMessage(t, {
      ...options,
      chat: guardedChat,
      accountId: guardedChat.account.id,
      securityKeyScopes:
        options.securityKeyScopes ??
        this.getSecurityKeyScopesForChat(guardedChat.chat_id),
    });
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
    payload: {
      expiresAt: number;
      messages: string[];
      flowId: string;
      selectedAiAgentId: string;
      lastMessageType?: EMessageType;
    }
  ): Promise<void> {
    const key = this.getAiAgentDebounceCacheKey(
      createChat.account.id,
      createChat.worker.id,
      createChat.chat_id
    );

    await this.redis.set(
      key,
      JSON.stringify(payload),
      'EX',
      this.AI_AGENT_DEBOUNCE_SECONDS + 2
    );
  }

  private async getAiAgentDebounce(createChat: IChat): Promise<{
    expiresAt: number;
    messages: string[];
    flowId: string;
    selectedAiAgentId: string;
    lastMessageType?: EMessageType;
  } | null> {
    const key = this.getAiAgentDebounceCacheKey(
      createChat.account.id,
      createChat.worker.id,
      createChat.chat_id
    );

    const data = await this.redis.get(key);
    if (!data) return null;

    return JSON.parse(data);
  }

  private async deleteAiAgentDebounce(createChat: IChat): Promise<void> {
    const key = this.getAiAgentDebounceCacheKey(
      createChat.account.id,
      createChat.worker.id,
      createChat.chat_id
    );

    await this.redis.del(key);
  }

  private scheduleAiAgentDebouncedResponse(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    currentNode: ListChatbotFlowResponse['nodes'][number],
    aiAgent: ViewAiAgentResponse,
    currentFlowId: string,
    bootstrapSummaryKey: string,
    conversationSummaryKey: string,
    chatbotFlow: ListChatbotFlowResponse,
    customMessages?: IChatbotCustomMessages
  ): void {
    setTimeout(
      async () => {
        const debounceData = await this.getAiAgentDebounce(createChat);

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

        await this.deleteAiAgentDebounce(createChat);

        const combinedText = debounceData.messages
          .map((msg) => msg.trim())
          .filter(Boolean)
          .join('\n');

        if (!combinedText) {
          return;
        }

        try {
          await this.processAiAgentUserText(
            t,
            createChat,
            currentNode,
            aiAgent,
            debounceData.flowId || currentFlowId,
            combinedText,
            bootstrapSummaryKey,
            conversationSummaryKey,
            chatbotFlow,
            customMessages,
            debounceData.lastMessageType
          );
        } catch (error) {
          console.error(
            '[ChatbotFlow] processAiAgentUserText debounce failed',
            error
          );
        }
      },
      (this.AI_AGENT_DEBOUNCE_SECONDS + 0.5) * 1000
    );
  }

  private scheduleMenuSend(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    nodeData: { message: string; options: { id: string; text: string }[] }
  ): void {
    setTimeout(
      async () => {
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

        const lines = nodeData.options.map(
          (option: { text: string }, index: number) => {
            const number = index + 1;
            return `*${number}.* ${option.text}`;
          }
        );

        const menuMessage = [baseMessage, '', ...lines].join('\n');

        await this.sendMessageWithStatusGuard(t, {
          chat: createChat,
          accountId: createChat.account.id,
          type: EMessageType.text,
          message: menuMessage,
          typeUser: ETypeUserChat.bot,
        });
      },
      (this.MENU_DEBOUNCE_SECONDS + 0.5) * 1000
    );
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

  private getNextFlowIdByOption(
    chatbotFlow: ListChatbotFlowResponse,
    currentFlowId: string,
    optionId: string
  ): string | null {
    const expectedSourceHandle = `option-${optionId}-source`;

    const edge = chatbotFlow.edges.find(
      (currentEdge) =>
        currentEdge.source === currentFlowId &&
        currentEdge.sourceHandle === expectedSourceHandle
    );

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

    return null;
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
      const response = await fetch(audioUrl);
      if (!response.ok) {
        return null;
      }
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const mimetype = data.content?.audio?.mimetype?.trim() || 'audio/mpeg';
      const result = await this.voiceIaIntegrationService.transcribe(
        buffer,
        voiceIaConfig,
        mimetype
      );
      return result?.text?.trim() ?? null;
    } catch (error) {
      console.error(
        '[ChatbotFlow] transcribeAudioMessage transcription failed',
        error
      );
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

  private isValidCNPJ(cnpj: string): boolean {
    const digits = this.onlyDigits(cnpj);

    if (digits.length !== 14) return false;

    if (/^(\d)\1{13}$/.test(digits)) return false;

    let length = digits.length - 2;
    let numbers = digits.substring(0, length);
    const multipliers = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;

    for (let i = 0; i < length; i++) {
      sum += Number.parseInt(numbers.charAt(i)) * multipliers[i];
    }

    let remainder = sum % 11;
    let digit = remainder < 2 ? 0 : 11 - remainder;

    if (digit !== Number.parseInt(digits.charAt(length))) return false;

    length = length + 1;
    numbers = digits.substring(0, length);
    const multipliers2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    sum = 0;

    for (let i = 0; i < length; i++) {
      sum += Number.parseInt(numbers.charAt(i)) * multipliers2[i];
    }

    remainder = sum % 11;
    digit = remainder < 2 ? 0 : 11 - remainder;

    if (digit !== Number.parseInt(digits.charAt(length))) return false;

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
    const attachmentUrl = node.data?.attachmentUrl;
    const attachmentMimetype = node.data?.attachmentMimetype;
    const attachmentDuration = node.data?.attachmentDuration;
    const attachmentWidth = node.data?.attachmentWidth;
    const attachmentHeight = node.data?.attachmentHeight;

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
      | string
      | null
      | undefined;

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
      | 'automatic'
      | 'after_response'
      | null
      | undefined;

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

    await this.sendRandomMessageItem(t, createChat, randomMessageItem);

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

    const lines = options.map((option, index) => {
      const number = index + 1;
      return `*${number}.* ${option.text}`;
    });

    const menuMessage = [baseMessage, '', ...lines].join('\n');

    return this.sendMessageWithStatusGuard(t, {
      chat: createChat,
      accountId: createChat.account.id,
      type: EMessageType.text,
      message: menuMessage,
      typeUser: ETypeUserChat.bot,
    });
  }

  private async sendFinishMessage(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    customMessage?: string,
    enabled?: boolean
  ): Promise<boolean> {
    const activeChat = await this.getAutomationChatIfAllowed(createChat);
    if (!activeChat) {
      return false;
    }

    const closedAt = new Date().toISOString();

    if (enabled !== false) {
      const rawMessage = customMessage || t('chatbot_service_finished');
      const message = await this.replaceVariables(
        t,
        rawMessage,
        activeChat,
        activeChat.user,
        activeChat.sector
      );

      await this.sendMessageWithStatusGuard(
        t,
        {
          chat: activeChat,
          accountId: activeChat.account.id,
          type: EMessageType.system,
          message,
          typeUser: ETypeUserChat.bot,
        },
        { allowClosedStatus: true }
      );
    }

    const statusUpdated = await this.chatService.updateChatStatus(
      activeChat.chat_id,
      EChatStatus.closed,
      null,
      null,
      closedAt
    );

    if (!statusUpdated) {
      return false;
    }

    const persistedChatSnapshot = await this.loadCurrentChatState(activeChat);
    const closedChat: IChat = {
      ...(persistedChatSnapshot ?? activeChat),
      status: EChatStatus.closed,
      closed_at: closedAt,
    };

    const channelAccountId = closedChat.account?.id ?? activeChat.account.id;

    const publishResults = await Promise.allSettled([
      this.centrifugoService.publishSubImmediate(
        chatAccountCentrifugo(channelAccountId),
        closedChat
      ),
      this.centrifugoService.publishSubImmediate(
        chatQueueAccountCentrifugo(channelAccountId),
        closedChat
      ),
    ]);

    if (publishResults.some((result) => result.status === 'rejected')) {
      console.error('[ChatbotFlow] failed to publish closed chat update', {
        chat_id: closedChat.chat_id,
        account_id: channelAccountId,
      });
    }

    await Promise.all([
      this.clearChatbotRuntimeStateByIds(
        activeChat.account.id,
        activeChat.worker.id,
        activeChat.chat_id
      ),
      this.chatService.invalidateChatCache(activeChat),
    ]);

    return true;
  }

  private async cacheFirstChatbotFlowNodeIfNeeded(
    chatbotFlow: ListChatbotFlowResponse,
    createChat: IChat
  ): Promise<string | null> {
    const cacheKey = this.getChatbotFlowCacheKey(
      createChat.account.id,
      createChat.worker.id,
      createChat.chat_id
    );

    const alreadyCached = await this.redis.get(cacheKey);
    if (alreadyCached) {
      return alreadyCached;
    }

    const startNode = chatbotFlow.nodes.find((node) => node.type === 'start');
    if (!startNode) {
      return null;
    }

    await this.redis.set(
      cacheKey,
      startNode.id,
      'EX',
      this.CHATBOT_FLOW_NODE_CACHE_TTL_SECONDS
    );

    return startNode.id;
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

  async clearFlowCacheForChat(
    accountId: string,
    workerId: string,
    chatId: string
  ): Promise<void> {
    await this.clearChatbotRuntimeStateByIds(accountId, workerId, chatId);
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
  ): Promise<void> {
    const questionText = this.getQuestionTextForDataType(node);

    if (questionText) {
      await this.sendMessageWithStatusGuard(t, {
        chat: createChat,
        accountId: createChat.account.id,
        type: EMessageType.text,
        message: questionText,
        typeUser: ETypeUserChat.bot,
      });
    }
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

    const nextFlowNode = this.getFlowNodeById(chatbotFlow, nextFlowId);

    if (!nextFlowNode) {
      return false;
    }

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

          if (hasUserMessage && aiAgent && data) {
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

          if (aiAgent) {
            await this.generateAndSendAiWelcomeMessage(t, createChat, aiAgent);
          } else {
            await this.sendMessageWithStatusGuard(t, {
              chat: createChat,
              accountId: createChat.account.id,
              type: EMessageType.text,
              message: t('ai_agent_default_question'),
              typeUser: ETypeUserChat.bot,
            });
          }
          await this.scheduleChatHistoryEmbedding(
            createChat,
            selectedAiAgentId
          );
        }
      }

      await this.updateCache(createChat, nextFlowId);
      return true;
    }

    await this.updateCache(createChat, nextFlowId);

    if (nextFlowNode.type === 'menu' || nextFlowNode.type === 'satisfaction') {
      return this.sendBuildMenuMessage(t, createChat, nextFlowNode, true);
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
      await this.processDataNodeQuestion(t, createChat, nextFlowNode);
      return true;
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

      if (data) {
        return this.processConditionalNode(
          t,
          data,
          createChat,
          chatbotFlow,
          nextFlowId,
          customMessages
        );
      }

      return true;
    }

    if (nextFlowNode.type === 'finish') {
      await this.sendFinishMessage(
        t,
        createChat,
        customMessages?.service_finished_message,
        customMessages?.service_finished_message_enabled
      );
      return true;
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
      await this.sendMessage(t, createChat, node);

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
      await this.sendMessage(t, createChat, node);

      const nextFlowId = this.getNextFlowId(chatbotFlow, node.id);
      if (nextFlowId) {
        await this.updateCache(createChat, nextFlowId);
      }

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
    customMessages?: IChatbotCustomMessages
  ): Promise<boolean> {
    const continueType = currentNode.data?.continueType;

    if (continueType === 'automatic') {
      await this.sendMessage(t, createChat, currentNode);

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
      await this.sendMessage(t, createChat, currentNode);

      const nextFlowId = this.getNextFlowId(chatbotFlow, currentFlowId);
      if (nextFlowId) {
        await this.updateCache(createChat, nextFlowId);
      }

      return true;
    }

    if (!continueType) {
      await this.sendMessage(t, createChat, currentNode);
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

    const updated = await this.chatService.updateChatLabel(
      createChat.chat_id,
      label
    );

    if (!updated) {
      throw new Error(t('chat_label_update_failed'));
    }

    const updatedChat: IChat = {
      ...createChat,
      label,
    };

    await this.chatService.saveChat(updatedChat);

    const channelAccountId = updatedChat.account?.id ?? createChat.account.id;

    await Promise.all([
      this.centrifugoService.publishSub(
        chatAccountCentrifugo(channelAccountId),
        updatedChat
      ),
      this.centrifugoService.publishSub(
        chatQueueAccountCentrifugo(channelAccountId),
        updatedChat
      ),
    ]);
  }

  private async updateContactTag(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    labelTemplateIds: string[]
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
          labelTemplateId
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
        await this.updateContactTag(t, createChat, selectedTag);
      } catch (error) {
        console.error('[ChatbotFlow] updateContactTag failed', error);
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

    await this.sendMessageWithStatusGuard(t, {
      chat: createChat,
      accountId: createChat.account.id,
      type: EMessageType.annotation,
      message,
      typeUser: ETypeUserChat.system,
    });

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

      return createChat;
    }

    const targetWorker = worker ?? activeChat.worker;

    const updatedChat: IChat = {
      ...activeChat,
      worker: targetWorker,
      user,
      sector,
      status: EChatStatus.queue,
    };

    const saved = await this.chatService.saveChat(updatedChat);
    if (!saved) {
      throw new Error(t('chat_update_failed'));
    }

    const workerIdsToClear = new Set<string>([
      activeChat.worker.id,
      updatedChat.worker.id,
    ]);
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
      this.centrifugoService.publishSub(
        chatAccountCentrifugo(channelAccountId),
        updatedChat
      ),
      this.centrifugoService.publishSub(
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
        await this.sendMessageWithStatusGuard(t, {
          chat: createChat,
          accountId: createChat.account.id,
          type: EMessageType.system,
          message: transferMessage,
          typeUser: ETypeUserChat.bot,
        });
      }

      const updatedChat = await this.updateAndPublishChat(
        t,
        createChat,
        user,
        undefined,
        targetWorker
      );

      const nextFlowId = this.getNextFlowId(chatbotFlow, currentFlowId);

      if (!nextFlowId) {
        return true;
      }

      return this.processNextNode(
        t,
        updatedChat,
        chatbotFlow,
        nextFlowId,
        customMessages
      );
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
      await this.sendMessageWithStatusGuard(t, {
        chat: createChat,
        accountId: createChat.account.id,
        type: EMessageType.system,
        message: transferMessage,
        typeUser: ETypeUserChat.bot,
      });
    }

    const updatedChat = await this.updateAndPublishChat(
      t,
      createChat,
      user,
      sector,
      targetWorker
    );

    const nextFlowId = this.getNextFlowId(chatbotFlow, currentFlowId);

    if (!nextFlowId) {
      return true;
    }

    return this.processNextNode(
      t,
      updatedChat,
      chatbotFlow,
      nextFlowId,
      customMessages
    );
  }

  private async processNextNodeAfterValidation(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    chatbotFlow: ListChatbotFlowResponse,
    currentFlowId: string,
    customMessages?: IChatbotCustomMessages
  ): Promise<boolean> {
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

  private async updateContactData(
    createChat: IChat,
    updateData: UpdateContactRequest
  ): Promise<void> {
    if (!createChat.contact?.id) {
      return;
    }

    await this.contactService.updateContactById(
      updateData,
      createChat.contact.id,
      createChat.account.id
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

    if (userText && createChat.contact?.id) {
      const truncatedName = truncateContactName(userText) ?? userText;
      await this.updateContactData(createChat, {
        name: truncatedName,
      });
    }

    return this.processNextNodeAfterValidation(
      t,
      createChat,
      chatbotFlow,
      currentFlowId,
      customMessages
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

    if (userText && createChat.contact?.id) {
      const truncatedLastName = truncateContactName(userText) ?? userText;
      await this.updateContactData(createChat, {
        last_name: truncatedLastName,
      });
    }

    return this.processNextNodeAfterValidation(
      t,
      createChat,
      chatbotFlow,
      currentFlowId,
      customMessages
    );
  }

  private async processEmailDataNode(
    t: TFunction<'translation', undefined>,
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
      await this.updateContactData(createChat, {
        email: userText,
      });
    }

    return this.processNextNodeAfterValidation(
      t,
      createChat,
      chatbotFlow,
      currentFlowId,
      customMessages
    );
  }

  private async processCpfDataNode(
    t: TFunction<'translation', undefined>,
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
      await this.updateContactData(createChat, {
        contact_document_type_id: EContactDocumentType.cpf,
        document: cpfDigits,
      });
    }

    return this.processNextNodeAfterValidation(
      t,
      createChat,
      chatbotFlow,
      currentFlowId,
      customMessages
    );
  }

  private async processCnpjDataNode(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    chatbotFlow: ListChatbotFlowResponse,
    currentFlowId: string,
    currentNode: ListChatbotFlowResponse['nodes'][number],
    userText: string,
    customMessage?: string,
    customMessages?: IChatbotCustomMessages
  ): Promise<boolean> {
    if (!this.isValidCNPJ(userText)) {
      await this.sendInvalidCnpjMessage(
        t,
        createChat,
        customMessage,
        customMessages?.invalid_cnpj_message_enabled
      );
      await this.processDataNodeQuestion(t, createChat, currentNode);
      return false;
    }

    const cnpjDigits = userText.replaceAll(/\D/g, '');

    if (createChat.contact?.id) {
      await this.updateContactData(createChat, {
        contact_document_type_id: EContactDocumentType.cnpj,
        document: cnpjDigits,
      });
    }

    return this.processNextNodeAfterValidation(
      t,
      createChat,
      chatbotFlow,
      currentFlowId,
      customMessages
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

      const lines = nodeData.options.map(
        (option: { text: string }, index: number) => {
          const number = index + 1;
          return `*${number}.* ${option.text}`;
        }
      );

      const menuMessage = [baseMessage, '', ...lines].join('\n');

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
        satisfactionData
      );
    }

    await this.resetFailedAttempts(createChat);

    return this.processNextNode(
      t,
      createChat,
      chatbotFlow,
      nextFlowId,
      options?.customMessages
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
    const scheduleKey = this.getInactivityScheduleKey();
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
    data.chatbotId = chatbotId;
    data.accountId = createChat.account.id;
    data.workerId = createChat.worker.id;
    data.chatId = createChat.chat_id;

    await Promise.all([
      this.redis.set(
        inactivityCacheKey,
        JSON.stringify(data),
        'EX',
        this.INACTIVITY_CACHE_TTL_SECONDS
      ),
      this.redis.zadd(scheduleKey, checkTime, inactivityCacheKey),
    ]);
  }

  private async cancelInactivityCheck(createChat: IChat): Promise<void> {
    const inactivityCacheKey = this.getInactivityCacheKey(
      createChat.account.id,
      createChat.worker.id,
      createChat.chat_id
    );
    const scheduleKey = this.getInactivityScheduleKey();

    await Promise.all([
      this.redis.del(inactivityCacheKey),
      this.redis.zrem(scheduleKey, inactivityCacheKey),
    ]);
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
      const scheduleKey = this.getInactivityScheduleKey();
      const now = Date.now();
      const updatedData = {
        ...inactivityData,
        alertCount: newAlertCount,
        lastAlertTime: now,
      };

      const nextCheckTime = now + timeMinutes * 60 * 1000;

      await Promise.all([
        this.redis.set(
          inactivityCacheKey,
          JSON.stringify(updatedData),
          'EX',
          this.INACTIVITY_CACHE_TTL_SECONDS
        ),
        this.redis.zadd(scheduleKey, nextCheckTime, inactivityCacheKey),
      ]);

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
    await this.sendMessageWithStatusGuard(t, {
      chat: createChat,
      accountId: createChat.account.id,
      type: EMessageType.system,
      message: inactivityMessage,
      typeUser: ETypeUserChat.bot,
    });

    const scheduleKey = this.getInactivityScheduleKey();
    const now = Date.now();
    const updatedData = {
      ...inactivityData,
      alertCount: newAlertCount,
      lastAlertTime: now,
    };

    const nextCheckTime = now + timeMinutes * 60 * 1000;

    await Promise.all([
      this.redis.set(
        inactivityCacheKey,
        JSON.stringify(updatedData),
        'EX',
        this.INACTIVITY_CACHE_TTL_SECONDS
      ),
      this.redis.zadd(scheduleKey, nextCheckTime, inactivityCacheKey),
    ]);
  }

  private async processInactivityRedirect(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    inactivityAlert: {
      redirect_type?: string;
      selected_user?: string;
      selected_sector?: string;
      selected_sector_user?: string;
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

    return false;
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
      return false;
    }

    await this.cancelInactivityCheck(createChat);
    return this.executeInactivityAction(
      t,
      createChat,
      action,
      inactivityAlert,
      customServiceFinishedMessage,
      customMessages,
      enabledFlags
    );
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
    },
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
      await this.sendFinishMessage(
        t,
        createChat,
        customServiceFinishedMessage,
        enabledFlags?.service_finished_message_enabled
      );
      return true;
    }

    if (action === 'redirect') {
      return this.processInactivityRedirect(
        t,
        createChat,
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
  private readonly INACTIVITY_CACHE_TTL_SECONDS = 86400;

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

      const inactivityData = JSON.parse(inactivityDataStr) as IInactivityData;
      const timeSinceLastInteraction =
        (now - inactivityData.lastInteraction) / 1000 / 60;

      if (timeSinceLastInteraction < 0) {
        continue;
      }

      const chatbotFlow = await this.chatbotService.findChatbotFlowByChatbotId(
        inactivityData.accountId,
        inactivityData.chatbotId
      );

      if (!chatbotFlow) {
        await this.cancelInactivityCheck({
          account: { id: inactivityData.accountId },
          worker: { id: inactivityData.workerId },
          chat_id: inactivityData.chatId,
        } as IChat);
        continue;
      }

      const configurations =
        await this.chatbotService.findChatbotFlowConfigurationsByChatbotId(
          inactivityData.accountId,
          inactivityData.chatbotId
        );

      const inactivityAlert = configurations?.configurations?.inactivity_alert;

      if (inactivityAlert?.status !== 'active') {
        await this.cancelInactivityCheck({
          account: { id: inactivityData.accountId },
          worker: { id: inactivityData.workerId },
          chat_id: inactivityData.chatId,
        } as IChat);
        continue;
      }

      const createChat = await this.chatService.findChatByChatId(
        inactivityData.accountId,
        inactivityData.chatId
      );

      if (!createChat) {
        await this.cancelInactivityCheck({
          account: { id: inactivityData.accountId },
          worker: { id: inactivityData.workerId },
          chat_id: inactivityData.chatId,
        } as IChat);
        continue;
      }

      if (
        createChat.status !== EChatStatus.ura &&
        createChat.status !== EChatStatus.ura_output &&
        createChat.status !== EChatStatus.ura_schedule &&
        createChat.status !== EChatStatus.ura_webhook
      ) {
        await this.cancelInactivityCheck(createChat);

        continue;
      }

      const customInactivityMessage =
        configurations?.configurations?.messages?.inactivity_message;
      const customServiceFinishedMessage =
        configurations?.configurations?.messages?.service_finished_message;
      const customMessages = configurations?.configurations?.messages
        ? {
            transfer_message_user:
              configurations.configurations.messages.transfer_message_user,
            transfer_message_sector:
              configurations.configurations.messages.transfer_message_sector,
            transfer_message_sector_user:
              configurations.configurations.messages
                .transfer_message_sector_user,
          }
        : undefined;

      const inactivityMessageEnabled =
        configurations?.configurations?.messages?.inactivity_message_enabled !==
        false;
      const serviceFinishedMessageEnabled =
        configurations?.configurations?.messages
          ?.service_finished_message_enabled !== false;
      const transferMessageUserEnabled =
        configurations?.configurations?.messages
          ?.transfer_message_user_enabled !== false;
      const transferMessageSectorEnabled =
        configurations?.configurations?.messages
          ?.transfer_message_sector_enabled !== false;
      const transferMessageSectorUserEnabled =
        configurations?.configurations?.messages
          ?.transfer_message_sector_user_enabled !== false;

      await this.processInactivityAlert(
        t,
        inactivityCacheKey,
        inactivityData,
        inactivityAlert,
        createChat,
        customInactivityMessage,
        customServiceFinishedMessage,
        customMessages,
        {
          inactivity_message_enabled: inactivityMessageEnabled,
          service_finished_message_enabled: serviceFinishedMessageEnabled,
          transfer_message_user_enabled: transferMessageUserEnabled,
          transfer_message_sector_enabled: transferMessageSectorEnabled,
          transfer_message_sector_user_enabled:
            transferMessageSectorUserEnabled,
        }
      );
    }
  }

  private async callGeminiChatApi(
    baseUrl: string,
    apiKey: string,
    model: string,
    prompt: string,
    userQuery: string,
    history?: Array<{ role: 'user' | 'assistant'; content: string }>
  ): Promise<{
    text: string;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
    latency_ms?: number;
  }> {
    const startMs = Date.now();
    const url = `${baseUrl.replace('/v1', '/v1beta')}/models/${encodeURIComponent(
      model
    )}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const contents = this.buildGeminiContents(history, userQuery);
    const requestBody = this.buildGeminiRequestBody(contents, prompt);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    const latency_ms = Date.now() - startMs;

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`AI Agent API error: ${response.status} - ${errorText}`);
    }

    const data = (await response.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{
            text?: string;
          }>;
        };
      }>;
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        totalTokenCount?: number;
      };
    };

    const text =
      data.candidates?.[0]?.content?.parts?.[0]?.text ||
      'Desculpe, não consegui processar sua solicitação.';

    const usage = data.usageMetadata
      ? {
          prompt_tokens: data.usageMetadata.promptTokenCount,
          completion_tokens: data.usageMetadata.candidatesTokenCount,
          total_tokens: data.usageMetadata.totalTokenCount,
        }
      : undefined;

    return { text, usage, latency_ms };
  }

  private buildGeminiContents(
    history: Array<{ role: 'user' | 'assistant'; content: string }> | undefined,
    userQuery: string
  ): Array<{
    role: 'user' | 'model';
    parts: Array<{ text: string }>;
  }> {
    const contents: Array<{
      role: 'user' | 'model';
      parts: Array<{ text: string }>;
    }> = [];

    if (history && history.length > 0) {
      for (const msg of history) {
        contents.push({
          role: msg.role === 'user' ? 'user' : 'model',
          parts: [{ text: msg.content }],
        });
      }
    }

    contents.push({
      role: 'user',
      parts: [{ text: userQuery }],
    });

    return contents;
  }

  private buildGeminiRequestBody(
    contents: Array<{
      role: 'user' | 'model';
      parts: Array<{ text: string }>;
    }>,
    prompt: string
  ): {
    contents: Array<{
      role: 'user' | 'model';
      parts: Array<{ text: string }>;
    }>;
    system_instruction?: {
      parts: Array<{
        text: string;
      }>;
    };
  } {
    return {
      contents,
      system_instruction: prompt
        ? {
            parts: [
              {
                text: prompt,
              },
            ],
          }
        : undefined,
    };
  }

  private async callOpenAiChatApi(
    baseUrl: string,
    apiKey: string,
    model: string,
    prompt: string,
    userQuery: string,
    history?: Array<{ role: 'user' | 'assistant'; content: string }>
  ): Promise<{
    text: string;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
    latency_ms?: number;
  }> {
    const startMs = Date.now();
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: prompt,
          },
          ...(history || []).map((msg) => ({
            role: msg.role,
            content: msg.content,
          })),
          {
            role: 'user',
            content: userQuery,
          },
        ],
      }),
    });

    const latency_ms = Date.now() - startMs;

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`AI Agent API error: ${response.status} - ${errorText}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string;
        };
      }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
    };

    const text =
      data.choices?.[0]?.message?.content ||
      'Desculpe, não consegui processar sua solicitação.';

    const usage = data.usage
      ? {
          prompt_tokens: data.usage.prompt_tokens,
          completion_tokens: data.usage.completion_tokens,
          total_tokens: data.usage.total_tokens,
        }
      : undefined;

    return { text, usage, latency_ms };
  }

  private async generateAndSendAiWelcomeMessage(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    aiAgent: ViewAiAgentResponse
  ): Promise<void> {
    if (!aiAgent.base_url || !aiAgent.api_key || !aiAgent.model) {
      const fallback = t('ai_agent_default_question');
      await this.sendMessageWithStatusGuard(t, {
        chat: createChat,
        accountId: createChat.account.id,
        type: EMessageType.text,
        message: fallback,
        typeUser: ETypeUserChat.bot,
      });
      return;
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

    if (!voiceSent) {
      await this.sendMessageWithStatusGuard(t, {
        chat: createChat,
        accountId: createChat.account.id,
        type: EMessageType.text,
        message: finalMessage,
        typeUser: ETypeUserChat.bot,
      });
    }

    await this.pushToConversationHistory(
      createChat.account.id,
      createChat.worker.id,
      createChat.chat_id,
      aiAgent.ai_agent_id,
      'assistant',
      finalMessage
    );
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

      await this.sendMessageWithStatusGuard(t, {
        chat: createChat,
        accountId: createChat.account.id,
        type: EMessageType.audio,
        audioUrl: uploadResult.url,
        audioMimetype: uploadResult.mimetype,
        audioPtt: true,
        typeUser: ETypeUserChat.bot,
      });

      return true;
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

      incrementCounter('ai_agent_context_conversational_reply', 1, {
        ai_agent_type_id: aiAgent.ai_agent_type_id,
        intent: parsed.intent,
      });

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
      | 'greeting'
      | 'gratitude'
      | 'farewell'
      | 'acknowledgement'
      | 'smalltalk';
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

    const useAssistantsApi =
      aiAgent.ai_agent_type_id === EAiAgentType.gpt &&
      !!aiAgent.openai_assistant_id;
    const useFileSearchResponsesApi =
      aiAgent.ai_agent_type_id === EAiAgentType.gpt &&
      !aiAgent.openai_assistant_id &&
      !!aiAgent.openai_vector_store_id;
    const skipFilePrompts = useAssistantsApi || useFileSearchResponsesApi;

    const allPrompts = await this.ragService.getAllAgentPromptsDetailed(
      createChat.account.id,
      aiAgent.ai_agent_id
    );

    const systemPrompt = this.buildComprehensiveSystemPrompt(
      useAssistantsApi ? null : aiAgent.system_prompt,
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

    const assistantsOptions =
      useAssistantsApi && aiAgent.openai_assistant_id
        ? {
            accountId: createChat.account.id,
            chatId: createChat.chat_id,
            aiAgentId: aiAgent.ai_agent_id,
            openaiAssistantId: aiAgent.openai_assistant_id,
          }
        : undefined;
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
        assistantsOptions,
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

    const updatedChat = await this.updateAndPublishChat(
      t,
      createChat,
      chatUser,
      chatSector
    );

    const nextFlowId = this.getNextFlowIdByHumanSupportHandle(
      chatbotFlow,
      currentFlowId
    );

    if (nextFlowId) {
      const nextNode = this.getFlowNodeById(chatbotFlow, nextFlowId);
      if (nextNode && nextNode.type !== 'redirect') {
        return this.processNextNode(
          t,
          updatedChat,
          chatbotFlow,
          nextFlowId,
          customMessages
        );
      }
    }

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
    assistantsOptions?: {
      accountId: string;
      chatId: string;
      aiAgentId: string;
      openaiAssistantId: string;
    },
    responsesApiFileSearchOptions?: { vectorStoreId: string },
    usageContext?: { accountId: string; chatId: string; aiAgentId: string }
  ): Promise<string> {
    return this.retryOperation(() =>
      this.callAiAgentChatApi(
        baseUrl,
        apiKey,
        model,
        aiAgentTypeId,
        prompt,
        userQuery,
        history,
        assistantsOptions,
        responsesApiFileSearchOptions,
        usageContext
      )
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
    assistantsOptions?: {
      accountId: string;
      chatId: string;
      aiAgentId: string;
      openaiAssistantId: string;
    },
    responsesApiFileSearchOptions?: { vectorStoreId: string },
    usageContext?: { accountId: string; chatId: string; aiAgentId: string }
  ): Promise<string> {
    if (!baseUrl || !apiKey || !model) {
      throw new InvalidConfigurationError(
        'AI Agent base_url, api_key ou model não está configurado.'
      );
    }

    const saveContext = assistantsOptions ?? usageContext;

    if (
      aiAgentTypeId === EAiAgentType.gpt &&
      assistantsOptions?.openaiAssistantId
    ) {
      const result = await this.callOpenAiAssistantsApi(
        baseUrl,
        apiKey,
        assistantsOptions.accountId,
        assistantsOptions.chatId,
        assistantsOptions.aiAgentId,
        assistantsOptions.openaiAssistantId,
        prompt,
        userQuery
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
          request_type: 'assistant_run',
        });
      }
      return result.text;
    }

    if (
      aiAgentTypeId === EAiAgentType.gpt &&
      responsesApiFileSearchOptions?.vectorStoreId
    ) {
      const result =
        await this.openAIAssistantService.createResponseWithFileSearch(
          apiKey,
          baseUrl,
          model,
          prompt,
          userQuery,
          responsesApiFileSearchOptions.vectorStoreId,
          history
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
    }

    if (aiAgentTypeId === EAiAgentType.gemini) {
      const result = await this.callGeminiChatApi(
        baseUrl,
        apiKey,
        model,
        prompt,
        userQuery,
        history
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
          request_type: 'chat',
        });
      }
      return result.text;
    }

    const result = await this.callOpenAiChatApi(
      baseUrl,
      apiKey,
      model,
      prompt,
      userQuery,
      history
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
        request_type: 'chat',
      });
    }
    return result.text;
  }

  private async callOpenAiAssistantsApi(
    baseUrl: string,
    apiKey: string,
    accountId: string,
    chatId: string,
    aiAgentId: string,
    assistantId: string,
    additionalInstructions: string,
    userQuery: string
  ): Promise<{
    text: string;
    usage?: {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
    };
    latency_ms?: number;
  }> {
    const threadId = await this.openAIAssistantService.getOrCreateThread(
      accountId,
      chatId,
      aiAgentId,
      apiKey,
      baseUrl
    );

    await this.openAIAssistantService.addMessageToThread(
      apiKey,
      baseUrl,
      threadId,
      userQuery,
      'user'
    );

    return this.openAIAssistantService.createRunAndWait(
      apiKey,
      baseUrl,
      threadId,
      assistantId,
      additionalInstructions
    );
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

    if (!aiAgent) {
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
    const conversationSummaryKey = `${cacheKey}:conversation-summary`;

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
      selectedAiAgentId,
      lastMessageType: data.type,
    });

    this.scheduleAiAgentDebouncedResponse(
      t,
      createChat,
      currentNode,
      aiAgent,
      currentFlowId,
      bootstrapSummaryKey,
      conversationSummaryKey,
      chatbotFlow,
      customMessages
    );

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

    await this.generateAndSendAiWelcomeMessage(t, createChat, aiAgent);
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
    inputMessageType?: EMessageType
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
      inputMessageType
    );
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
    inputMessageType?: EMessageType
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

    const useAssistantsApi =
      aiAgent.ai_agent_type_id === EAiAgentType.gpt &&
      !!aiAgent.openai_assistant_id;
    const useFileSearchResponsesApi =
      aiAgent.ai_agent_type_id === EAiAgentType.gpt &&
      !aiAgent.openai_assistant_id &&
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

    const assistantsOptions =
      useAssistantsApi && aiAgent.openai_assistant_id
        ? {
            accountId: createChat.account.id,
            chatId: createChat.chat_id,
            aiAgentId: aiAgent.ai_agent_id,
            openaiAssistantId: aiAgent.openai_assistant_id,
          }
        : undefined;
    const responsesApiFileSearchOptions =
      useFileSearchResponsesApi && aiAgent.openai_vector_store_id
        ? { vectorStoreId: aiAgent.openai_vector_store_id }
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

    try {
      await this.storeResponseInHistory(
        createChat.account.id,
        createChat.chat_id,
        aiAgent.ai_agent_id,
        userText,
        aiResponse
      );
    } catch (storeError) {
      console.error(
        '[AI Agent] Erro ao registrar histórico de respostas:',
        storeError
      );
    }

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

    const recentMessagesForSummary = [
      ...recentMessages,
      { role: 'user' as const, content: userText },
      { role: 'assistant' as const, content: aiResponse },
    ];

    await this.sendAiAgentResponse(
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
      inputMessageType
    );

    const actionAfterInteractions =
      currentNode.data?.actionAfterInteractions === true;
    const interactionsQuantity = currentNode.data?.interactionsQuantity ?? 0;

    if (actionAfterInteractions && interactionsQuantity > 0) {
      const newCount = await this.incrementAiAgentInteractionsCount(
        createChat.account.id,
        createChat.worker.id,
        createChat.chat_id,
        currentFlowId
      );

      if (
        this.hasExceededInteractionLimitAfterIncrement(
          newCount,
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

    await this.updateCache(createChat, currentFlowId);
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
    const useAssistantsApi =
      aiAgent.ai_agent_type_id === EAiAgentType.gpt &&
      !!aiAgent.openai_assistant_id;
    const useFileSearchResponsesApi =
      aiAgent.ai_agent_type_id === EAiAgentType.gpt &&
      !aiAgent.openai_assistant_id &&
      !!aiAgent.openai_vector_store_id;
    const skipFilePrompts = useAssistantsApi || useFileSearchResponsesApi;

    const allPrompts = await this.ragService.getAllAgentPromptsDetailed(
      createChat.account.id,
      aiAgent.ai_agent_id
    );
    const textualPrompts = allPrompts.filter(
      (prompt) => !this.looksLikeUrl(prompt.value)
    );
    const allowExternalContext = skipFilePrompts;

    const systemPrompt = this.buildComprehensiveSystemPrompt(
      useAssistantsApi ? null : aiAgent.system_prompt,
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
    incrementCounter('ai_agent_context_decision', 1, {
      path: decisionPath,
      ai_agent_type_id: metadata.aiAgentTypeId,
    });

    if (decisionPath === 'runtime_fallback') {
      incrementCounter('ai_agent_context_runtime_fallback', 1, {
        ai_agent_type_id: metadata.aiAgentTypeId,
      });
    }

    if (decisionPath === 'out_of_context') {
      incrementCounter('ai_agent_context_no_evidence', 1, {
        ai_agent_type_id: metadata.aiAgentTypeId,
      });
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
    responsesApiFileSearchOptions: { vectorStoreId: string } | undefined
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
        responsesApiFileSearchOptions,
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
    inputMessageType?: EMessageType
  ): Promise<void> {
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
            await this.sendMessageWithStatusGuard(t, {
              chat: createChat,
              accountId: createChat.account.id,
              type: EMessageType.audio,
              audioUrl: uploadResult.url,
              audioMimetype: uploadResult.mimetype,
              audioPtt: true,
              typeUser: ETypeUserChat.bot,
            });
            messageSent = true;
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
      await this.sendMessageWithStatusGuard(t, {
        chat: createChat,
        accountId: createChat.account.id,
        type: EMessageType.text,
        message: aiResponse,
        typeUser: ETypeUserChat.bot,
      });
    }

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
      const conversationSummary = await this.redis.get(conversationSummaryKey);
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

    if (
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

    const currentNode = this.getFlowNodeById(chatbotFlow, currentFlowId);
    if (!currentNode) {
      throw new Error(t('chatbot_flow_node_not_found'));
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
        customMessages
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
        customMessages
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
      await this.sendFinishMessage(
        t,
        createChat,
        customMessages?.service_finished_message,
        customMessages?.service_finished_message_enabled
      );
      return true;
    }

    return false;
  }

  private async processConditionalNode(
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

    const userText = normalizeTextForConditionalComparison(
      this.getTextFromUpsertMessage(data) ?? ''
    );

    if (!userText) {
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

      if (!conditionType || !conditionTerm) {
        continue;
      }

      const term = normalizeTextForConditionalComparison(conditionTerm);
      if (!term) {
        continue;
      }

      let conditionMet = false;

      switch (conditionType) {
        case 'contains':
          conditionMet = userText.includes(term);
          break;
        case 'equals':
          conditionMet = userText === term;
          break;
        case 'not_contains':
          conditionMet = !userText.includes(term);
          break;
        case 'starts_with':
          conditionMet = userText.startsWith(term);
          break;
        case 'ends_with':
          conditionMet = userText.endsWith(term);
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

        const updatedChat = await this.updateAndPublishChat(
          t,
          createChat,
          user,
          undefined
        );

        const nextFlowId = this.getNextFlowId(chatbotFlow, currentFlowId);

        if (!nextFlowId) {
          return true;
        }

        return this.processNextNode(
          t,
          updatedChat,
          chatbotFlow,
          nextFlowId,
          customMessages
        );
      }
    }

    const distributionType = currentNode.data?.distributionType as
      | 'sequential'
      | 'random'
      | 'load'
      | null
      | undefined;

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
      | boolean
      | null
      | undefined;
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

      const nextFlowId = this.getNextFlowId(chatbotFlow, currentFlowId);
      if (!nextFlowId) {
        return true;
      }

      await this.updateCache(updatedChat, nextFlowId);
      return this.processNextNode(
        t,
        updatedChat,
        chatbotFlow,
        nextFlowId,
        customMessages
      );
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

    const updatedChat = await this.updateAndPublishChat(
      t,
      createChat,
      selectedUser,
      selectedSector
    );

    const nextFlowId = this.getNextFlowId(chatbotFlow, currentFlowId);

    if (!nextFlowId) {
      return true;
    }

    return this.processNextNode(
      t,
      updatedChat,
      chatbotFlow,
      nextFlowId,
      customMessages
    );
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
    securityKeyScopes?: TSecurityKeyScope[]
  ): Promise<string | null> => {
    const activeChat = await this.getAutomationChatIfAllowed(createChat);
    if (!activeChat) {
      return null;
    }

    if (activeChat.contact?.ignore === EContactIgnore.ignore_automation) {
      return null;
    }

    this.securityKeyScopesByChatId.set(
      activeChat.chat_id,
      this.normalizeSecurityKeyScopes(securityKeyScopes)
    );

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
            configurations?.configurations?.messages?.service_finished_message;
          const serviceFinishedMessageEnabled =
            configurations?.configurations?.messages
              ?.service_finished_message_enabled !== false;

          await this.sendFinishMessage(
            t,
            activeChat,
            customServiceFinishedMessage,
            serviceFinishedMessageEnabled
          );

          return null;
        }
      }

      const chatbotFlow = await this.chatbotService.findChatbotFlowByChatbotId(
        activeChat.account.id,
        chatbotId
      );

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
      const inactivityAlert = configurations?.configurations?.inactivity_alert;
      const redirectFailedAttempts =
        configurations?.configurations?.redirect_failed_attempts;

      const currentFlowId = await this.cacheFirstChatbotFlowNodeIfNeeded(
        chatbotFlow,
        activeChat
      );

      if (!currentFlowId) {
        throw new Error(t('chatbot_flow_not_found'));
      }

      await this.processFlowNode(
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

      return currentFlowId;
    } finally {
      this.securityKeyScopesByChatId.delete(activeChat.chat_id);
    }
  };
}
