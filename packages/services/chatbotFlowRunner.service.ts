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
import { IChatMessage } from '@core/common/interfaces/IChatMessage';
import { extractMessageTextFromContent } from '@core/common/functions/extractMessageTextFromContent';
import { StreamProducerService } from './streamProducer.service';
import { KafkaServiceQueueService } from './kafkaServiceQueue.service';
import { IChatHistoryEmbeddingRequest } from '@core/common/interfaces/IChatHistoryEmbeddingRequest';
import { EContactIgnore } from '@core/common/enums/EContactIgnore';

@injectable()
export class ChatbotFlowRunnerService {
  private readonly MENU_DEBOUNCE_SECONDS = 3;

  constructor(
    @inject('Redis') private readonly redis: Redis,
    private readonly chatbotService: ChatbotService,
    private readonly chatService: ChatService,
    private readonly chatMessageService: ChatMessageService,
    private readonly contactService: ContactService,
    private readonly labelTemplateViewerRepository: LabelTemplateViewerRepository,
    private readonly centrifugoService: CentrifugoService,
    private readonly userService: UserService,
    private readonly sectorService: SectorService,
    private readonly ragService: RagService,
    private readonly aiAgentService: AiAgentService,
    private readonly elasticDatabaseService: ElasticDatabaseService,
    private readonly streamProducerService: StreamProducerService,
    private readonly kafkaServiceQueueService: KafkaServiceQueueService
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

        await this.chatMessageService.sendMessage(t, {
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
    return this.chatMessageService.sendMessage(t, {
      chat: createChat,
      accountId: createChat.account.id,
      type: EMessageType.text,
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
    return this.chatMessageService.sendMessage(t, {
      chat: createChat,
      accountId: createChat.account.id,
      type: EMessageType.text,
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
    return this.chatMessageService.sendMessage(t, {
      chat: createChat,
      accountId: createChat.account.id,
      type: EMessageType.text,
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
    return this.chatMessageService.sendMessage(t, {
      chat: createChat,
      accountId: createChat.account.id,
      type: EMessageType.text,
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

  private async getContactName(createChat: IChat): Promise<string | null> {
    if (!createChat.phone) {
      return null;
    }

    const phoneAndDdi = extractPhoneAndDdi(createChat.phone);
    if (!phoneAndDdi) {
      return null;
    }

    const contact = await this.contactService.getContactByPhone(
      createChat.account.id,
      phoneAndDdi.phone,
      phoneAndDdi.phone_ddi
    );

    if (!contact) {
      return null;
    }

    const fullName = [contact.name, contact.last_name]
      .filter(Boolean)
      .join(' ')
      .trim();

    return fullName || null;
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
      return this.chatMessageService.sendMessage(t, {
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
      return this.chatMessageService.sendMessage(t, {
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
      return this.chatMessageService.sendMessage(t, {
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

    return this.chatMessageService.sendMessage(t, {
      chat: createChat,
      accountId: createChat.account.id,
      type: EMessageType.text,
      message: text,
      typeUser: ETypeUserChat.bot,
    });
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

    return this.chatMessageService.sendMessage(t, {
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
    const closedAt = new Date().toISOString();
    const cacheKey = this.getChatbotFlowCacheKey(
      createChat.account.id,
      createChat.worker.id,
      createChat.chat_id
    );

    const promises: Promise<unknown>[] = [
      this.chatService.updateChatStatus(
        createChat.chat_id,
        EChatStatus.closed,
        null,
        null,
        closedAt
      ),
      this.redis.del(cacheKey),
      this.cancelInactivityCheck(createChat),
      this.chatService.invalidateChatCache(createChat),
    ];

    if (enabled !== false) {
      const rawMessage = customMessage || t('chatbot_service_finished');
      const message = await this.replaceVariables(
        t,
        rawMessage,
        createChat,
        createChat.user,
        createChat.sector
      );

      promises.push(
        this.chatMessageService.sendMessage(t, {
          chat: createChat,
          accountId: createChat.account.id,
          type: EMessageType.text,
          message,
          typeUser: ETypeUserChat.bot,
        })
      );
    }

    await Promise.all(promises);

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

    await this.redis.set(cacheKey, startNode.id, 'EX', 1800);

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
    await this.redis.set(cacheKey, nextFlowId, 'EX', 1800);
  }

  async clearFlowCacheForChat(
    accountId: string,
    workerId: string,
    chatId: string
  ): Promise<void> {
    const cacheKey = this.getChatbotFlowCacheKey(accountId, workerId, chatId);
    await this.redis.del(cacheKey);
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
      await this.chatMessageService.sendMessage(t, {
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
    customMessages?: {
      service_finished_message?: string;
      invalid_menu_option_message?: string;
      invalid_satisfaction_option_message?: string;
      invalid_cpf_message?: string;
      invalid_cnpj_message?: string;
      invalid_email_message?: string;
      transfer_message_user?: string;
      transfer_message_sector?: string;
      transfer_message_sector_user?: string;
      service_finished_message_enabled?: boolean;
      invalid_menu_option_message_enabled?: boolean;
      invalid_satisfaction_option_message_enabled?: boolean;
      invalid_cpf_message_enabled?: boolean;
      invalid_cnpj_message_enabled?: boolean;
      invalid_email_message_enabled?: boolean;
      transfer_message_user_enabled?: boolean;
      transfer_message_sector_enabled?: boolean;
      transfer_message_sector_user_enabled?: boolean;
    },
    data?: IUpsertMessage
  ): Promise<boolean> {
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

      if (!isReturningToAiAgent) {
        const nodeDefaultQuestion = nextFlowNode.data?.defaultQuestion;
        const defaultQuestion =
          nodeDefaultQuestion && nodeDefaultQuestion.trim().length > 0
            ? nodeDefaultQuestion
            : t('ai_agent_default_question');
        const questionMessage = await this.replaceVariables(
          t,
          defaultQuestion,
          createChat,
          createChat.user,
          createChat.sector
        );

        await this.chatMessageService.sendMessage(t, {
          chat: createChat,
          accountId: createChat.account.id,
          type: EMessageType.text,
          message: questionMessage,
          typeUser: ETypeUserChat.bot,
        });

        const selectedAiAgentId = nextFlowNode.data?.selectedAiAgent;
        if (selectedAiAgentId) {
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
        customMessages
      );
    }

    if (nextFlowNode.type === 'message') {
      return this.processMessageNode(
        t,
        createChat,
        nextFlowNode,
        chatbotFlow,
        customMessages
      );
    }

    if (nextFlowNode.type === 'tag') {
      return this.processTagNode(
        t,
        createChat,
        chatbotFlow,
        nextFlowId,
        customMessages
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
        customMessages
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
    customMessages?: {
      service_finished_message?: string;
      invalid_menu_option_message?: string;
      invalid_satisfaction_option_message?: string;
      invalid_cpf_message?: string;
      invalid_cnpj_message?: string;
      invalid_email_message?: string;
      transfer_message_user?: string;
      transfer_message_sector?: string;
      transfer_message_sector_user?: string;
      service_finished_message_enabled?: boolean;
      invalid_menu_option_message_enabled?: boolean;
      invalid_satisfaction_option_message_enabled?: boolean;
      invalid_cpf_message_enabled?: boolean;
      invalid_cnpj_message_enabled?: boolean;
      invalid_email_message_enabled?: boolean;
      transfer_message_user_enabled?: boolean;
      transfer_message_sector_enabled?: boolean;
      transfer_message_sector_user_enabled?: boolean;
    }
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
          customMessages
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
    customMessages?: {
      service_finished_message?: string;
      invalid_menu_option_message?: string;
      invalid_satisfaction_option_message?: string;
      invalid_cpf_message?: string;
      invalid_cnpj_message?: string;
      invalid_email_message?: string;
      transfer_message_user?: string;
      transfer_message_sector?: string;
      transfer_message_sector_user?: string;
      service_finished_message_enabled?: boolean;
      invalid_menu_option_message_enabled?: boolean;
      invalid_satisfaction_option_message_enabled?: boolean;
      invalid_cpf_message_enabled?: boolean;
      invalid_cnpj_message_enabled?: boolean;
      invalid_email_message_enabled?: boolean;
      transfer_message_user_enabled?: boolean;
      transfer_message_sector_enabled?: boolean;
      transfer_message_sector_user_enabled?: boolean;
    }
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
    customMessages?: {
      service_finished_message?: string;
      invalid_menu_option_message?: string;
      invalid_satisfaction_option_message?: string;
      invalid_cpf_message?: string;
      invalid_cnpj_message?: string;
      invalid_email_message?: string;
      transfer_message_user?: string;
      transfer_message_sector?: string;
      transfer_message_sector_user?: string;
      service_finished_message_enabled?: boolean;
      invalid_menu_option_message_enabled?: boolean;
      invalid_satisfaction_option_message_enabled?: boolean;
      invalid_cpf_message_enabled?: boolean;
      invalid_cnpj_message_enabled?: boolean;
      invalid_email_message_enabled?: boolean;
      transfer_message_user_enabled?: boolean;
      transfer_message_sector_enabled?: boolean;
      transfer_message_sector_user_enabled?: boolean;
    }
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
      await this.updateContactTag(t, createChat, selectedTag);
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
      customMessages
    );
  }

  private async processAnnotationNode(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    chatbotFlow: ListChatbotFlowResponse,
    currentFlowId: string,
    customMessages?: {
      service_finished_message?: string;
      invalid_menu_option_message?: string;
      invalid_satisfaction_option_message?: string;
      invalid_cpf_message?: string;
      invalid_cnpj_message?: string;
      invalid_email_message?: string;
      transfer_message_user?: string;
      transfer_message_sector?: string;
      transfer_message_sector_user?: string;
      service_finished_message_enabled?: boolean;
      invalid_menu_option_message_enabled?: boolean;
      invalid_satisfaction_option_message_enabled?: boolean;
      invalid_cpf_message_enabled?: boolean;
      invalid_cnpj_message_enabled?: boolean;
      invalid_email_message_enabled?: boolean;
      transfer_message_user_enabled?: boolean;
      transfer_message_sector_enabled?: boolean;
      transfer_message_sector_user_enabled?: boolean;
    }
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
        customMessages
      );
    }

    const message = await this.replaceVariables(
      t,
      annotation.trim(),
      createChat,
      createChat.user,
      createChat.sector
    );

    await this.chatMessageService.sendMessage(t, {
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
      customMessages
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

  private async updateAndPublishChat(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    user: IChat['user'] | null | undefined,
    sector: IChat['sector'] | null | undefined
  ): Promise<IChat> {
    const updatedChat: IChat = {
      ...createChat,
      user,
      sector,
      status: EChatStatus.queue,
    };

    const saved = await this.chatService.saveChat(updatedChat);
    if (!saved) {
      throw new Error(t('chat_update_failed'));
    }

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
    customMessages?: {
      service_finished_message?: string;
      transfer_message_user?: string;
      transfer_message_sector?: string;
      transfer_message_sector_user?: string;
      service_finished_message_enabled?: boolean;
      transfer_message_user_enabled?: boolean;
      transfer_message_sector_enabled?: boolean;
      transfer_message_sector_user_enabled?: boolean;
    }
  ): Promise<boolean> {
    const currentNode = this.getFlowNodeById(chatbotFlow, currentFlowId);

    if (!currentNode) {
      throw new Error(t('chatbot_flow_node_not_found'));
    }

    const responsibleAttendant = createChat.contact?.responsible_attendant;

    if (responsibleAttendant) {
      const user: IChat['user'] = {
        id: responsibleAttendant.id,
        name: responsibleAttendant.name,
        photo: responsibleAttendant.photo ?? null,
      };

      const updatedChat = await this.updateAndPublishChat(
        t,
        createChat,
        user,
        undefined
      );

      await this.cancelInactivityCheck(updatedChat);

      const rawTransferMessage =
        customMessages?.transfer_message_user ||
        t('chatbot_transfer_message_user_default');

      if (rawTransferMessage) {
        const transferMessage = await this.replaceVariables(
          t,
          rawTransferMessage,
          updatedChat,
          user,
          undefined
        );
        await this.chatMessageService.sendMessage(t, {
          chat: updatedChat,
          accountId: updatedChat.account.id,
          type: EMessageType.text,
          message: transferMessage,
          typeUser: ETypeUserChat.bot,
        });
      }

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

    const updatedChat = await this.updateAndPublishChat(
      t,
      createChat,
      user,
      sector
    );

    await this.cancelInactivityCheck(updatedChat);

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
        updatedChat,
        user,
        sector
      );
      await this.chatMessageService.sendMessage(t, {
        chat: updatedChat,
        accountId: updatedChat.account.id,
        type: EMessageType.text,
        message: transferMessage,
        typeUser: ETypeUserChat.bot,
      });
    }

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
    customMessages?: {
      service_finished_message?: string;
      invalid_menu_option_message?: string;
      invalid_satisfaction_option_message?: string;
      invalid_cpf_message?: string;
      invalid_cnpj_message?: string;
      invalid_email_message?: string;
      transfer_message_user?: string;
      transfer_message_sector?: string;
      transfer_message_sector_user?: string;
      service_finished_message_enabled?: boolean;
      invalid_menu_option_message_enabled?: boolean;
      invalid_satisfaction_option_message_enabled?: boolean;
      invalid_cpf_message_enabled?: boolean;
      invalid_cnpj_message_enabled?: boolean;
      invalid_email_message_enabled?: boolean;
      transfer_message_user_enabled?: boolean;
      transfer_message_sector_enabled?: boolean;
      transfer_message_sector_user_enabled?: boolean;
    }
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

  private truncateContactName(name: string, maxLength: number = 100): string {
    if (name.length <= maxLength) {
      return name;
    }
    return name.substring(0, maxLength);
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
    customMessages?: {
      service_finished_message?: string;
      invalid_menu_option_message?: string;
      invalid_satisfaction_option_message?: string;
      invalid_cpf_message?: string;
      invalid_cnpj_message?: string;
      invalid_email_message?: string;
      transfer_message_user?: string;
      transfer_message_sector?: string;
      transfer_message_sector_user?: string;
      service_finished_message_enabled?: boolean;
      invalid_menu_option_message_enabled?: boolean;
      invalid_satisfaction_option_message_enabled?: boolean;
      invalid_cpf_message_enabled?: boolean;
      invalid_cnpj_message_enabled?: boolean;
      invalid_email_message_enabled?: boolean;
      transfer_message_user_enabled?: boolean;
      transfer_message_sector_enabled?: boolean;
      transfer_message_sector_user_enabled?: boolean;
    }
  ): Promise<boolean> {
    const userText = this.getTextFromUpsertMessage(data)?.trim();

    if (userText && createChat.contact?.id) {
      const truncatedName = this.truncateContactName(userText);
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
    customMessages?: {
      service_finished_message?: string;
      invalid_menu_option_message?: string;
      invalid_satisfaction_option_message?: string;
      invalid_cpf_message?: string;
      invalid_cnpj_message?: string;
      invalid_email_message?: string;
      transfer_message_user?: string;
      transfer_message_sector?: string;
      transfer_message_sector_user?: string;
      service_finished_message_enabled?: boolean;
      invalid_menu_option_message_enabled?: boolean;
      invalid_satisfaction_option_message_enabled?: boolean;
      invalid_cpf_message_enabled?: boolean;
      invalid_cnpj_message_enabled?: boolean;
      invalid_email_message_enabled?: boolean;
      transfer_message_user_enabled?: boolean;
      transfer_message_sector_enabled?: boolean;
      transfer_message_sector_user_enabled?: boolean;
    }
  ): Promise<boolean> {
    const userText = this.getTextFromUpsertMessage(data)?.trim();

    if (userText && createChat.contact?.id) {
      const truncatedLastName = this.truncateContactName(userText);
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
    customMessages?: {
      service_finished_message?: string;
      invalid_menu_option_message?: string;
      invalid_satisfaction_option_message?: string;
      invalid_cpf_message?: string;
      invalid_cnpj_message?: string;
      invalid_email_message?: string;
      transfer_message_user?: string;
      transfer_message_sector?: string;
      transfer_message_sector_user?: string;
      service_finished_message_enabled?: boolean;
      invalid_menu_option_message_enabled?: boolean;
      invalid_satisfaction_option_message_enabled?: boolean;
      invalid_cpf_message_enabled?: boolean;
      invalid_cnpj_message_enabled?: boolean;
      invalid_email_message_enabled?: boolean;
      transfer_message_user_enabled?: boolean;
      transfer_message_sector_enabled?: boolean;
      transfer_message_sector_user_enabled?: boolean;
    }
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
    customMessages?: {
      service_finished_message?: string;
      invalid_menu_option_message?: string;
      invalid_satisfaction_option_message?: string;
      invalid_cpf_message?: string;
      invalid_cnpj_message?: string;
      invalid_email_message?: string;
      transfer_message_user?: string;
      transfer_message_sector?: string;
      transfer_message_sector_user?: string;
      service_finished_message_enabled?: boolean;
      invalid_menu_option_message_enabled?: boolean;
      invalid_satisfaction_option_message_enabled?: boolean;
      invalid_cpf_message_enabled?: boolean;
      invalid_cnpj_message_enabled?: boolean;
      invalid_email_message_enabled?: boolean;
      transfer_message_user_enabled?: boolean;
      transfer_message_sector_enabled?: boolean;
      transfer_message_sector_user_enabled?: boolean;
    }
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
    customMessages?: {
      service_finished_message?: string;
      invalid_menu_option_message?: string;
      invalid_satisfaction_option_message?: string;
      invalid_cpf_message?: string;
      invalid_cnpj_message?: string;
      invalid_email_message?: string;
      transfer_message_user?: string;
      transfer_message_sector?: string;
      transfer_message_sector_user?: string;
      service_finished_message_enabled?: boolean;
      invalid_menu_option_message_enabled?: boolean;
      invalid_satisfaction_option_message_enabled?: boolean;
      invalid_cpf_message_enabled?: boolean;
      invalid_cnpj_message_enabled?: boolean;
      invalid_email_message_enabled?: boolean;
      transfer_message_user_enabled?: boolean;
      transfer_message_sector_enabled?: boolean;
      transfer_message_sector_user_enabled?: boolean;
    }
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
    customMessages?: {
      service_finished_message?: string;
      invalid_menu_option_message?: string;
      invalid_satisfaction_option_message?: string;
      invalid_cpf_message?: string;
      invalid_cnpj_message?: string;
      invalid_email_message?: string;
      transfer_message_user?: string;
      transfer_message_sector?: string;
      transfer_message_sector_user?: string;
      service_finished_message_enabled?: boolean;
      invalid_menu_option_message_enabled?: boolean;
      invalid_satisfaction_option_message_enabled?: boolean;
      invalid_cpf_message_enabled?: boolean;
      invalid_cnpj_message_enabled?: boolean;
      invalid_email_message_enabled?: boolean;
      transfer_message_user_enabled?: boolean;
      transfer_message_sector_enabled?: boolean;
      transfer_message_sector_user_enabled?: boolean;
    }
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
      customMessages?: {
        service_finished_message?: string;
        transfer_message_user?: string;
        transfer_message_sector?: string;
        transfer_message_sector_user?: string;
      };
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

      await this.chatMessageService.sendMessage(t, {
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
    const selectedNumber = Number.parseInt(text, 10);

    if (
      Number.isNaN(selectedNumber) ||
      selectedNumber < 1 ||
      selectedNumber > menuOptions.length
    ) {
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
      const satisfactionData = {
        question,
        options: menuOptions.map((o) => ({ id: o.id, text: o.text })),
        response: { id: selectedOption.id, text: selectedOption.text },
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

  private async processContactNode(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    chatbotFlow: ListChatbotFlowResponse,
    currentFlowId: string,
    customMessages?: {
      service_finished_message?: string;
      invalid_menu_option_message?: string;
      invalid_satisfaction_option_message?: string;
      invalid_cpf_message?: string;
      invalid_cnpj_message?: string;
      invalid_email_message?: string;
      transfer_message_user?: string;
      transfer_message_sector?: string;
      transfer_message_sector_user?: string;
      service_finished_message_enabled?: boolean;
      invalid_menu_option_message_enabled?: boolean;
      invalid_satisfaction_option_message_enabled?: boolean;
      invalid_cpf_message_enabled?: boolean;
      invalid_cnpj_message_enabled?: boolean;
      invalid_email_message_enabled?: boolean;
      transfer_message_user_enabled?: boolean;
      transfer_message_sector_enabled?: boolean;
      transfer_message_sector_user_enabled?: boolean;
    }
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
        customMessages
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
        customMessages
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
        customMessages
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
      customMessages
    );
  }

  private async scheduleInactivityCheck(
    createChat: IChat,
    timeMinutes: number,
    chatbotId: string
  ): Promise<void> {
    if (
      createChat.status !== EChatStatus.ura &&
      createChat.status !== EChatStatus.ura_schedule
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
      this.redis.set(inactivityCacheKey, JSON.stringify(data)),
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
      createChat.status !== EChatStatus.ura_schedule
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
        this.redis.set(inactivityCacheKey, JSON.stringify(updatedData)),
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
    await this.chatMessageService.sendMessage(t, {
      chat: createChat,
      accountId: createChat.account.id,
      type: EMessageType.text,
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
      this.redis.set(inactivityCacheKey, JSON.stringify(updatedData)),
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
    customMessages?: {
      transfer_message_user?: string;
      transfer_message_sector?: string;
      transfer_message_sector_user?: string;
    },
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
    customMessages?: {
      transfer_message_user?: string;
      transfer_message_sector?: string;
      transfer_message_sector_user?: string;
    },
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

    const updatedChat = await this.updateAndPublishChat(
      t,
      createChat,
      user,
      undefined
    );

    await this.sendTransferMessageIfNeeded(
      t,
      updatedChat,
      'user',
      user,
      undefined,
      customMessages,
      enabledFlags
    );

    return true;
  }

  private async processInactivitySectorRedirect(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    selectedSector?: string,
    selectedSectorUser?: string,
    customMessages?: {
      transfer_message_user?: string;
      transfer_message_sector?: string;
      transfer_message_sector_user?: string;
    },
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

    const updatedChat = await this.updateAndPublishChat(
      t,
      createChat,
      user,
      sector
    );

    await this.sendTransferMessageIfNeeded(
      t,
      updatedChat,
      'sector',
      user,
      sector,
      customMessages,
      enabledFlags
    );

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
    customMessages?: {
      transfer_message_user?: string;
      transfer_message_sector?: string;
      transfer_message_sector_user?: string;
    },
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
    customMessages?: {
      transfer_message_user?: string;
      transfer_message_sector?: string;
      transfer_message_sector_user?: string;
    },
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
    customMessages?: {
      service_finished_message?: string;
      invalid_menu_option_message?: string;
      invalid_satisfaction_option_message?: string;
      invalid_cpf_message?: string;
      invalid_cnpj_message?: string;
      invalid_email_message?: string;
      transfer_message_user?: string;
      transfer_message_sector?: string;
      transfer_message_sector_user?: string;
      service_finished_message_enabled?: boolean;
      invalid_menu_option_message_enabled?: boolean;
      invalid_satisfaction_option_message_enabled?: boolean;
      invalid_cpf_message_enabled?: boolean;
      invalid_cnpj_message_enabled?: boolean;
      invalid_email_message_enabled?: boolean;
      transfer_message_user_enabled?: boolean;
      transfer_message_sector_enabled?: boolean;
      transfer_message_sector_user_enabled?: boolean;
    }
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

    const updatedChat = await this.updateAndPublishChat(
      t,
      createChat,
      user,
      sector
    );

    await this.cancelInactivityCheck(updatedChat);

    await this.sendTransferMessageIfNeeded(
      t,
      updatedChat,
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
        createChat?.status === EChatStatus.ura_schedule)
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
    updatedChat: IChat,
    redirectType?: string,
    user?: IChat['user'] | null | undefined,
    sector?: IChat['sector'] | null | undefined,
    customMessages?: {
      transfer_message_user?: string;
      transfer_message_sector?: string;
      transfer_message_sector_user?: string;
    },
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
      updatedChat,
      user,
      sector
    );

    await this.chatMessageService.sendMessage(t, {
      chat: updatedChat,
      accountId: updatedChat.account.id,
      type: EMessageType.text,
      message: transferMessage,
      typeUser: ETypeUserChat.bot,
    });
  }

  private getTransferMessage(
    t: TFunction<'translation', undefined>,
    redirectType?: string,
    user?: IChat['user'] | null | undefined,
    sector?: IChat['sector'] | null | undefined,
    customMessages?: {
      transfer_message_user?: string;
      transfer_message_sector?: string;
      transfer_message_sector_user?: string;
    },
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

  private async incrementFailedAttempts(createChat: IChat): Promise<number> {
    const key = this.getFailedAttemptsCacheKey(
      createChat.account.id,
      createChat.worker.id,
      createChat.chat_id
    );

    const newValue = await this.redis.incr(key);

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
        createChat.status !== EChatStatus.ura_schedule
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
  ): Promise<string> {
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
    };

    const responseText =
      data.candidates?.[0]?.content?.parts?.[0]?.text ||
      'Desculpe, não consegui processar sua solicitação.';

    return responseText;
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
  ): Promise<string> {
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
    };

    const text =
      data.choices?.[0]?.message?.content ||
      'Desculpe, não consegui processar sua solicitação.';

    return text;
  }

  private async sendDefaultQuestionMessage(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    currentNode: any,
    clearCache = false
  ): Promise<void> {
    if (clearCache) {
      const cacheKey = this.getChatbotFlowCacheKey(
        createChat.account.id,
        createChat.worker.id,
        createChat.chat_id
      );
      await this.redis.del(cacheKey);
      const continueMessageSentKey = `${cacheKey}:continue-message-sent`;
      await this.redis.del(continueMessageSentKey);
    }

    const nodeDefaultQuestion = currentNode.data?.defaultQuestion;
    const defaultQuestion =
      nodeDefaultQuestion && nodeDefaultQuestion.trim().length > 0
        ? nodeDefaultQuestion
        : t('ai_agent_default_question');

    const questionMessage = await this.replaceVariables(
      t,
      defaultQuestion,
      createChat,
      createChat.user,
      createChat.sector
    );

    await this.chatMessageService.sendMessage(t, {
      chat: createChat,
      accountId: createChat.account.id,
      type: EMessageType.text,
      message: questionMessage,
      typeUser: ETypeUserChat.bot,
    });
  }

  private async processTextResponseAnalysis(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    chatbotFlow: ListChatbotFlowResponse,
    currentFlowId: string,
    currentNode: any,
    options: any[],
    analysis: 'positive' | 'negative' | 'question' | 'human_support',
    customMessages?: {
      service_finished_message?: string;
      invalid_menu_option_message?: string;
      invalid_satisfaction_option_message?: string;
      invalid_cpf_message?: string;
      invalid_email_message?: string;
      invalid_phone_message?: string;
      transfer_message_user?: string;
      transfer_message_sector?: string;
      transfer_message_sector_user?: string;
    }
  ): Promise<boolean> {
    if (analysis === 'question') {
      return false;
    }

    if (analysis === 'human_support') {
      const nextFlowId = this.getNextFlowIdByHumanSupportHandle(
        chatbotFlow,
        currentFlowId
      );

      if (!nextFlowId) {
        return false;
      }

      await this.resetFailedAttempts(createChat);

      return this.processNextNode(
        t,
        createChat,
        chatbotFlow,
        nextFlowId,
        customMessages
      );
    }

    const targetOptionId = this.findTargetOptionId(t, options, analysis);

    if (!targetOptionId) {
      return false;
    }

    const nextFlowId = this.getNextFlowIdByOption(
      chatbotFlow,
      currentFlowId,
      targetOptionId
    );

    if (!nextFlowId) {
      return false;
    }

    if (analysis === 'positive') {
      const nodeDefaultQuestion = currentNode.data?.defaultQuestion;
      const defaultQuestion =
        nodeDefaultQuestion && nodeDefaultQuestion.trim().length > 0
          ? nodeDefaultQuestion
          : t('ai_agent_default_question');
      const questionMessage = await this.replaceVariables(
        t,
        defaultQuestion,
        createChat,
        createChat.user,
        createChat.sector
      );

      await this.chatMessageService.sendMessage(t, {
        chat: createChat,
        accountId: createChat.account.id,
        type: EMessageType.text,
        message: questionMessage,
        typeUser: ETypeUserChat.bot,
      });
    }

    await this.resetFailedAttempts(createChat);

    return this.processNextNode(
      t,
      createChat,
      chatbotFlow,
      nextFlowId,
      customMessages
    );
  }

  private findTargetOptionId(
    t: TFunction<'translation', undefined>,
    options: any[],
    analysis: 'positive' | 'negative' | 'question'
  ): string | null {
    if (analysis === 'positive') {
      const positiveOptionText = t('chatbot_ai_agent_positive_option');
      const positiveOption = options.find(
        (opt) => opt.text === positiveOptionText || opt.id === 'positive-option'
      );

      return (positiveOption?.id ?? null) as string | null;
    }

    if (analysis === 'negative') {
      const negativeOptionText = t('chatbot_ai_agent_negative_option');
      const negativeOption = options.find(
        (opt) => opt.text === negativeOptionText || opt.id === 'negative-option'
      );

      return (negativeOption?.id ?? null) as string | null;
    }

    return null;
  }

  private async generateBootstrapSummaryForChat(
    createChat: IChat,
    aiAgentId: string,
    bootstrapSummaryKey: string
  ): Promise<void> {
    const aiAgent = await this.aiAgentService.viewAiAgent(
      aiAgentId,
      createChat.account.id
    );

    if (!aiAgent || !aiAgent.base_url || !aiAgent.api_key || !aiAgent.model) {
      return;
    }

    const bootstrapSummary = await this.ragService.generateBootstrapSummary(
      createChat.account.id,
      aiAgentId,
      aiAgent.base_url,
      aiAgent.api_key,
      aiAgent.model,
      aiAgent.ai_agent_type_id
    );

    if (bootstrapSummary && bootstrapSummary.trim().length > 0) {
      await this.redis.set(bootstrapSummaryKey, bootstrapSummary, 'EX', 86400);
    }
  }

  private async updateConversationSummaryAfterResponse(
    createChat: IChat,
    selectedAiAgentId: string,
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
    try {
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
    } catch (error) {
      throw error;
    }
  }

  private async getRecentChatMessages(
    accountId: string,
    chatId: string,
    limit: number = 20
  ): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
    const queryElastic = {
      size: limit,
      sort: [{ date: { order: 'desc' } }],
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
            {
              terms: {
                'content.type': [
                  EMessageType.text,
                  EMessageType.system,
                  EMessageType.annotation,
                ],
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

    if (!result || !result.hits.hits) {
      return [];
    }

    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

    for (const hit of result.hits.hits.reverse()) {
      const message = hit._source as IChatMessage;
      if (!message.content) {
        continue;
      }

      const text = extractMessageTextFromContent(message.content);
      if (!text || text.trim().length === 0) {
        continue;
      }

      const role: 'user' | 'assistant' =
        message.type_user === ETypeUserChat.bot ? 'assistant' : 'user';
      messages.push({ role, content: text });
    }

    return messages;
  }

  private async analyzeUserResponse(
    baseUrl: string,
    apiKey: string,
    model: string,
    aiAgentTypeId: string,
    continueMessage: string,
    userResponse: string,
    humanSupportEnabled: boolean = false
  ): Promise<'positive' | 'negative' | 'question' | 'human_support'> {
    const analysisPrompt = this.buildAnalysisPrompt(
      continueMessage,
      userResponse,
      humanSupportEnabled
    );

    try {
      const analysis = await this.callAiAgentChatApi(
        baseUrl,
        apiKey,
        model,
        aiAgentTypeId,
        analysisPrompt,
        userResponse
      );

      const result = this.parseAnalysisResponse(analysis, humanSupportEnabled);

      return result;
    } catch {
      const fallbackResult = this.fallbackAnalysis(
        userResponse,
        humanSupportEnabled
      );

      return fallbackResult;
    }
  }

  private buildAnalysisPrompt(
    continueMessage: string,
    userResponse: string,
    humanSupportEnabled: boolean = false
  ): string {
    const humanSupportSection = humanSupportEnabled
      ? `- "human_support": se o usuário QUER falar com um atendente humano, operador, suporte humano ou pessoa real. Exemplos: "quero falar com humano", "falar com atendente", "falar com operador", "falar com suporte", "quero falar com pessoa", "preciso de atendimento humano", "quero atendimento humano", "me transfere para humano", "quero falar com alguém", "falar com uma pessoa"
`
      : '';

    const validOptions = humanSupportEnabled
      ? 'positive, negative, question ou human_support'
      : 'positive, negative ou question';

    return `Você é um classificador de intenção. Analise a resposta do usuário considerando o contexto da mensagem de continuidade e escolha EXATAMENTE UMA etiqueta:

- "positive": o usuário quer continuar no MESMO tópico, pede mais detalhes, confirmação, passos ou esclarecimento sobre o assunto já discutido. Pode ser pergunta de continuação do mesmo tema. Exemplos: "pode explicar melhor?", "como faço isso exatamente?", "sim, quero continuar", "me dá mais detalhes", "tenho outra dúvida sobre isso"
- "negative": o usuário está satisfeito, quer encerrar, agradece ou diz que não precisa mais. Exemplos: "não, obrigado", "tudo certo", "já resolvi", "ok, valeu", "está tudo bem", "não preciso mais"
- "question": o usuário traz NOVO tópico/problema/situação, muda de assunto ou algo que NÃO é continuação do tema anterior. Exemplos: "tenho outro problema...", "mudando de assunto...", "e sobre X?", "no meu caso acontece Y", "agora preciso de ajuda com outra coisa"
${humanSupportSection}
Regras de decisão (ordem de prioridade):
1) Se houver pedido explícito para falar com humano/pessoa real/atendente/operador, classifique como "human_support" (quando disponível), mesmo que haja outras intenções.
2) Se a resposta indica encerramento/agradecimento/solução e NÃO há novo pedido, classifique como "negative".
3) Se a resposta pede continuidade/mais ajuda no MESMO assunto da mensagem de continuidade, classifique como "positive" (mesmo se for uma pergunta de continuação).
4) Se a resposta introduz NOVO assunto/problema/situação, classifique como "question".
5) Se houver dúvida real entre "positive" e "question", prefira "question".

Pergunta/Contexto da mensagem de continuidade: "${continueMessage}"
Resposta do usuário: "${userResponse}"

Retorne APENAS uma das palavras: ${validOptions}.`;
  }

  private parseAnalysisResponse(
    analysis: string,
    humanSupportEnabled: boolean = false
  ): 'positive' | 'negative' | 'question' | 'human_support' {
    const normalized = analysis.trim().toLowerCase();
    if (humanSupportEnabled && normalized.includes('human_support')) {
      return 'human_support';
    }

    if (normalized.includes('positive')) {
      return 'positive';
    }
    if (normalized.includes('negative')) {
      return 'negative';
    }

    return 'question';
  }

  private fallbackAnalysis(
    userResponse: string,
    humanSupportEnabled: boolean = false
  ): 'positive' | 'negative' | 'question' | 'human_support' {
    const lowerResponse = userResponse.toLowerCase().trim();

    if (humanSupportEnabled) {
      const humanSupportIndicators = [
        'falar com humano',
        'falar com atendente',
        'falar com operador',
        'falar com suporte',
        'quero falar com humano',
        'quero falar com atendente',
        'quero falar com operador',
        'quero falar com suporte',
        'quero falar com pessoa',
        'falar com uma pessoa',
        'atendimento humano',
        'atendente humano',
        'suporte humano',
        'atendimento humano, por favor',
        'me transfere para humano',
        'me transfere para atendente',
        'quero humano',
        'preciso de humano',
        'atendente real',
        'pessoa real',
        'atendente de verdade',
        'pessoa de verdade',
        'quero falar com alguém',
        'falar com alguém',
        'quero alguém',
        'preciso de alguém',
      ];

      for (const indicator of humanSupportIndicators) {
        if (lowerResponse.includes(indicator)) {
          return 'human_support';
        }
      }
    }

    const negativeIndicators = [
      'não',
      'nao',
      'no',
      'não preciso',
      'nao preciso',
      'não preciso mais',
      'nao preciso mais',
      'tudo certo',
      'obrigado',
      'obrigada',
      'valeu',
      'já resolvi',
      'já entendi',
      'está tudo bem',
      'está tudo certo',
      'não preciso de ajuda',
      'nao preciso de ajuda',
      'já está resolvido',
      'já está certo',
      'tudo certo, obrigado',
      'tudo certo, obrigada',
      'não preciso mais de ajuda',
      'nao preciso mais de ajuda',
    ];

    const positiveIndicators = [
      'sim, preciso',
      'sim preciso',
      'yes',
      'quero',
      'preciso',
      'ajuda',
      'tenho dúvida',
      'tenho duvida',
      'quero saber',
      'me ajuda',
      'preciso de ajuda',
      'tenho outra',
      'outra dúvida',
      'outra duvida',
    ];

    for (const indicator of negativeIndicators) {
      if (lowerResponse.includes(indicator)) {
        return 'negative';
      }
    }

    if (
      lowerResponse === 'ok' ||
      lowerResponse === 'sim' ||
      lowerResponse === 'yes'
    ) {
      return 'positive';
    }

    for (const indicator of positiveIndicators) {
      if (lowerResponse.includes(indicator)) {
        return 'positive';
      }
    }

    if (this.isQuestionPattern(lowerResponse)) {
      return 'question';
    }

    if (
      lowerResponse.includes('obrigado') ||
      lowerResponse.includes('obrigada') ||
      lowerResponse.includes('tudo certo')
    ) {
      return 'negative';
    }

    return 'negative';
  }

  private isQuestionPattern(text: string): boolean {
    return (
      text.includes('?') ||
      text.startsWith('como') ||
      text.startsWith('qual') ||
      text.startsWith('quando') ||
      text.startsWith('onde') ||
      text.startsWith('quem') ||
      text.startsWith('por que')
    );
  }

  private async callAiAgentChatApi(
    baseUrl: string,
    apiKey: string,
    model: string,
    aiAgentTypeId: string,
    prompt: string,
    userQuery: string,
    history?: Array<{ role: 'user' | 'assistant'; content: string }>
  ): Promise<string> {
    if (!baseUrl || !apiKey || !model) {
      throw new InvalidConfigurationError(
        'AI Agent base_url, api_key ou model não está configurado.'
      );
    }

    if (aiAgentTypeId === EAiAgentType.gemini) {
      const response = await this.callGeminiChatApi(
        baseUrl,
        apiKey,
        model,
        prompt,
        userQuery,
        history
      );
      return response;
    }

    const response = await this.callOpenAiChatApi(
      baseUrl,
      apiKey,
      model,
      prompt,
      userQuery,
      history
    );
    return response;
  }

  private async processAiAgentNode(
    t: TFunction<'translation', undefined>,
    data: IUpsertMessage,
    createChat: IChat,
    chatbotFlow: ListChatbotFlowResponse,
    currentFlowId: string,
    customMessages?: {
      service_finished_message?: string;
      invalid_menu_option_message?: string;
      invalid_satisfaction_option_message?: string;
      invalid_cpf_message?: string;
      invalid_cnpj_message?: string;
      invalid_email_message?: string;
      transfer_message_user?: string;
      transfer_message_sector?: string;
      transfer_message_sector_user?: string;
      service_finished_message_enabled?: boolean;
      invalid_menu_option_message_enabled?: boolean;
      invalid_satisfaction_option_message_enabled?: boolean;
      invalid_cpf_message_enabled?: boolean;
      invalid_cnpj_message_enabled?: boolean;
      invalid_email_message_enabled?: boolean;
      transfer_message_user_enabled?: boolean;
      transfer_message_sector_enabled?: boolean;
      transfer_message_sector_user_enabled?: boolean;
    }
  ): Promise<boolean> {
    const currentNode = this.getFlowNodeById(chatbotFlow, currentFlowId);

    if (!currentNode) {
      throw new Error(t('chatbot_flow_node_not_found'));
    }

    const selectedAiAgentId = currentNode.data?.selectedAiAgent;

    if (!selectedAiAgentId) {
      throw new Error(t('chatbot_flow_validation_ai_agent_required'));
    }

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
        currentNode,
        selectedAiAgentId,
        currentFlowId,
        bootstrapSummaryKey
      );
    }

    const userText = this.getTextFromUpsertMessage(data)?.trim();

    if (!userText) {
      return false;
    }

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

      if (currentInteractionsCount >= interactionsQuantity) {
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

    const menuResult = await this.handleMenuOptionIfExists(
      t,
      createChat,
      chatbotFlow,
      currentFlowId,
      currentNode,
      userText,
      customMessages
    );

    if (menuResult !== null) {
      return menuResult;
    }

    return this.processAiAgentResponse(
      t,
      createChat,
      currentNode,
      selectedAiAgentId,
      currentFlowId,
      userText,
      bootstrapSummaryKey,
      conversationSummaryKey,
      chatbotFlow,
      customMessages
    );
  }

  private async handleBootstrapEntry(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    currentNode: ListChatbotFlowResponse['nodes'][number],
    selectedAiAgentId: string,
    currentFlowId: string,
    bootstrapSummaryKey: string
  ): Promise<boolean> {
    await this.generateBootstrapSummaryForChat(
      createChat,
      selectedAiAgentId,
      bootstrapSummaryKey
    );

    await this.sendDefaultQuestionMessage(t, createChat, currentNode, false);
    await this.resetAiAgentInteractionsCount(
      createChat.account.id,
      createChat.worker.id,
      createChat.chat_id,
      currentFlowId
    );
    await this.updateCache(createChat, currentFlowId);
    await this.scheduleChatHistoryEmbedding(createChat, selectedAiAgentId);

    return true;
  }

  private async handleMenuOptionIfExists(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    chatbotFlow: ListChatbotFlowResponse,
    currentFlowId: string,
    currentNode: ListChatbotFlowResponse['nodes'][number],
    userText: string,
    customMessages?: {
      service_finished_message?: string;
      invalid_menu_option_message?: string;
      invalid_satisfaction_option_message?: string;
      invalid_cpf_message?: string;
      invalid_cnpj_message?: string;
      invalid_email_message?: string;
      transfer_message_user?: string;
      transfer_message_sector?: string;
      transfer_message_sector_user?: string;
      service_finished_message_enabled?: boolean;
      invalid_menu_option_message_enabled?: boolean;
      invalid_satisfaction_option_message_enabled?: boolean;
      invalid_cpf_message_enabled?: boolean;
      invalid_cnpj_message_enabled?: boolean;
      invalid_email_message_enabled?: boolean;
      transfer_message_user_enabled?: boolean;
      transfer_message_sector_enabled?: boolean;
      transfer_message_sector_user_enabled?: boolean;
    }
  ): Promise<boolean | null> {
    const options = currentNode.data?.options;
    const continueMessage = currentNode.data?.continueMessage;

    if (!options || !Array.isArray(options) || options.length < 2) {
      return null;
    }

    const numericResult = await this.handleNumericMenuOption(
      t,
      createChat,
      chatbotFlow,
      currentFlowId,
      options,
      userText,
      customMessages
    );

    if (numericResult !== null) {
      return numericResult;
    }

    if (!continueMessage) {
      return false;
    }

    return this.handleContinueMessageAnalysis(
      t,
      createChat,
      chatbotFlow,
      currentFlowId,
      currentNode,
      options,
      continueMessage,
      userText,
      customMessages
    );
  }

  private async handleNumericMenuOption(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    chatbotFlow: ListChatbotFlowResponse,
    currentFlowId: string,
    options: any[],
    userText: string,
    customMessages?: {
      service_finished_message?: string;
      invalid_menu_option_message?: string;
      invalid_satisfaction_option_message?: string;
      invalid_cpf_message?: string;
      invalid_cnpj_message?: string;
      invalid_email_message?: string;
      transfer_message_user?: string;
      transfer_message_sector?: string;
      transfer_message_sector_user?: string;
      service_finished_message_enabled?: boolean;
      invalid_menu_option_message_enabled?: boolean;
      invalid_satisfaction_option_message_enabled?: boolean;
      invalid_cpf_message_enabled?: boolean;
      invalid_cnpj_message_enabled?: boolean;
      invalid_email_message_enabled?: boolean;
      transfer_message_user_enabled?: boolean;
      transfer_message_sector_enabled?: boolean;
      transfer_message_sector_user_enabled?: boolean;
    }
  ): Promise<boolean | null> {
    const selectedNumber = Number.parseInt(userText, 10);

    if (
      Number.isNaN(selectedNumber) ||
      selectedNumber < 1 ||
      selectedNumber > options.length
    ) {
      return null;
    }

    const selectedOption = options[selectedNumber - 1];

    if (!selectedOption) {
      return false;
    }

    const continueMessageSentKey = `${this.getChatbotFlowCacheKey(
      createChat.account.id,
      createChat.worker.id,
      createChat.chat_id
    )}:continue-message-sent`;
    await this.redis.del(continueMessageSentKey);

    const nextFlowId = this.getNextFlowIdByOption(
      chatbotFlow,
      currentFlowId,
      selectedOption.id
    );

    if (!nextFlowId) {
      return false;
    }

    await this.resetFailedAttempts(createChat);
    return this.processNextNode(
      t,
      createChat,
      chatbotFlow,
      nextFlowId,
      customMessages
    );
  }

  private async handleContinueMessageAnalysis(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    chatbotFlow: ListChatbotFlowResponse,
    currentFlowId: string,
    currentNode: ListChatbotFlowResponse['nodes'][number],
    options: any[],
    continueMessage: string,
    userText: string,
    customMessages?: {
      service_finished_message?: string;
      invalid_menu_option_message?: string;
      invalid_satisfaction_option_message?: string;
      invalid_cpf_message?: string;
      invalid_cnpj_message?: string;
      invalid_email_message?: string;
      transfer_message_user?: string;
      transfer_message_sector?: string;
      transfer_message_sector_user?: string;
      service_finished_message_enabled?: boolean;
      invalid_menu_option_message_enabled?: boolean;
      invalid_satisfaction_option_message_enabled?: boolean;
      invalid_cpf_message_enabled?: boolean;
      invalid_cnpj_message_enabled?: boolean;
      invalid_email_message_enabled?: boolean;
      transfer_message_user_enabled?: boolean;
      transfer_message_sector_enabled?: boolean;
      transfer_message_sector_user_enabled?: boolean;
    }
  ): Promise<boolean | null> {
    const continueMessageSentKey = `${this.getChatbotFlowCacheKey(
      createChat.account.id,
      createChat.worker.id,
      createChat.chat_id
    )}:continue-message-sent`;
    const continueMessageSent = await this.redis.get(continueMessageSentKey);

    if (continueMessageSent !== 'true') {
      return null;
    }

    const selectedAiAgentId = currentNode.data?.selectedAiAgent;

    if (!selectedAiAgentId) {
      return false;
    }

    const aiAgentForAnalysis = await this.aiAgentService.viewAiAgent(
      selectedAiAgentId,
      createChat.account.id
    );

    if (
      !aiAgentForAnalysis ||
      !aiAgentForAnalysis.base_url ||
      !aiAgentForAnalysis.api_key ||
      !aiAgentForAnalysis.model
    ) {
      return false;
    }

    const humanSupportEnabled = currentNode.data?.humanSupportEnabled === true;

    const analysis = await this.analyzeUserResponse(
      aiAgentForAnalysis.base_url,
      aiAgentForAnalysis.api_key,
      aiAgentForAnalysis.model,
      aiAgentForAnalysis.ai_agent_type_id,
      continueMessage,
      userText,
      humanSupportEnabled
    );

    await this.redis.del(continueMessageSentKey);

    const analysisResult = await this.processTextResponseAnalysis(
      t,
      createChat,
      chatbotFlow,
      currentFlowId,
      currentNode,
      options,
      analysis,
      customMessages
    );

    if (analysisResult) {
      return true;
    }

    return null;
  }

  private async processAiAgentResponse(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    currentNode: ListChatbotFlowResponse['nodes'][number],
    selectedAiAgentId: string,
    currentFlowId: string,
    userText: string,
    bootstrapSummaryKey: string,
    conversationSummaryKey: string,
    chatbotFlow: ListChatbotFlowResponse,
    customMessages?: {
      service_finished_message?: string;
      invalid_menu_option_message?: string;
      invalid_satisfaction_option_message?: string;
      invalid_cpf_message?: string;
      invalid_cnpj_message?: string;
      invalid_email_message?: string;
      transfer_message_user?: string;
      transfer_message_sector?: string;
      transfer_message_sector_user?: string;
      service_finished_message_enabled?: boolean;
      invalid_menu_option_message_enabled?: boolean;
      invalid_satisfaction_option_message_enabled?: boolean;
      invalid_cpf_message_enabled?: boolean;
      invalid_cnpj_message_enabled?: boolean;
      invalid_email_message_enabled?: boolean;
      transfer_message_user_enabled?: boolean;
      transfer_message_sector_enabled?: boolean;
      transfer_message_sector_user_enabled?: boolean;
    }
  ): Promise<boolean> {
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

    const recentMessages = await this.getRecentChatMessages(
      createChat.account.id,
      createChat.chat_id,
      50
    );

    const { enhancedPrompt, contextAllowed, contextHints } =
      await this.buildEnhancedPromptForAiAgent(
        createChat,
        selectedAiAgentId,
        userText,
        bootstrapSummaryKey,
        conversationSummaryKey,
        recentMessages
      );

    let aiResponse: string;
    if (!contextAllowed) {
      aiResponse = this.buildOutOfContextResponse(userText, contextHints);
    } else {
      try {
        aiResponse = await this.callAiAgentChatApi(
          aiAgent.base_url,
          aiAgent.api_key,
          aiAgent.model,
          aiAgent.ai_agent_type_id,
          enhancedPrompt,
          userText
        );

        let isDuplicate =
          this.isRepeatedResponse(aiResponse, recentMessages) ||
          (await this.isResponseRepeatedInHistory(
            createChat.account.id,
            createChat.chat_id,
            selectedAiAgentId,
            userText,
            aiResponse
          ));

        if (isDuplicate) {
          const retryPrompt =
            this.buildDiversificationRetryPrompt(enhancedPrompt);
          const retryResponse = await this.callAiAgentChatApi(
            aiAgent.base_url,
            aiAgent.api_key,
            aiAgent.model,
            aiAgent.ai_agent_type_id,
            retryPrompt,
            userText
          );

          const retryIsDuplicate =
            this.isRepeatedResponse(retryResponse, recentMessages) ||
            (await this.isResponseRepeatedInHistory(
              createChat.account.id,
              createChat.chat_id,
              selectedAiAgentId,
              userText,
              retryResponse
            ));

          if (!retryIsDuplicate) {
            aiResponse = retryResponse;
          } else {
            aiResponse = this.appendVariationAddendum(
              retryResponse,
              Date.now()
            );
          }
        }
      } catch (error) {
        const nextFlowId = this.getNextFlowIdByFallbackHandle(
          chatbotFlow,
          currentFlowId
        );

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

        throw error;
      }
    }

    try {
      await this.storeResponseInHistory(
        createChat.account.id,
        createChat.chat_id,
        selectedAiAgentId,
        userText,
        aiResponse
      );
    } catch (storeError) {
      console.error(
        '[AI Agent] Erro ao registrar histórico de respostas:',
        storeError
      );
    }

    await this.sendAiAgentResponse(
      t,
      createChat,
      aiResponse,
      currentNode,
      selectedAiAgentId,
      conversationSummaryKey,
      userText,
      {
        base_url: aiAgent.base_url,
        api_key: aiAgent.api_key,
        model: aiAgent.model,
        ai_agent_type_id: aiAgent.ai_agent_type_id,
      }
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

      if (newCount > interactionsQuantity) {
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
    selectedAiAgentId: string,
    userText: string,
    bootstrapSummaryKey: string,
    conversationSummaryKey: string,
    recentMessages: Array<{ role: 'user' | 'assistant'; content: string }>
  ): Promise<{
    enhancedPrompt: string;
    contextAllowed: boolean;
    contextHints: string[];
  }> {
    const systemPrompt =
      'Você é um assistente virtual prestativo e educado. Sempre entregue a melhor resposta possível com base no contexto e nas regras.';

    const bootstrapSummary = await this.redis.get(bootstrapSummaryKey);
    const conversationSummary = await this.redis.get(conversationSummaryKey);

    const { enhancedPrompt, contextAllowed, contextHints } =
      await this.ragService.enhancePromptWithRag(
        createChat.account.id,
        selectedAiAgentId,
        systemPrompt,
        userText,
        {
          topK: 12,
          minScore: 0.0,
          chatId: createChat.chat_id,
          includeChatHistory: true,
          isBootstrap: false,
          bootstrapSummary: bootstrapSummary,
          conversationSummary: conversationSummary,
          recentMessages: recentMessages,
          phone: createChat.phone,
        }
      );

    const additionalInstructions = this.buildAdditionalAiResponseInstructions(
      userText,
      recentMessages
    );

    if (!additionalInstructions) {
      return { enhancedPrompt, contextAllowed, contextHints };
    }

    return {
      enhancedPrompt: `${enhancedPrompt}\n\n### Diretrizes Adicionais:\n${additionalInstructions}`,
      contextAllowed,
      contextHints,
    };
  }

  private buildAdditionalAiResponseInstructions(
    userText: string,
    recentMessages: Array<{ role: 'user' | 'assistant'; content: string }>
  ): string {
    const instructions: string[] = [
      '- Entregue a melhor resposta possível, escolhendo a alternativa mais adequada ao contexto e às regras. Quando houver opções, recomende a melhor e explique rapidamente o porquê.',
      '- Responda somente com base no contexto fornecido. Se não houver contexto suficiente, informe que não pode responder.',
    ];

    const repeatedQuestionCount = this.getRepeatedQuestionCount(
      userText,
      recentMessages
    );

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

  private buildOutOfContextResponse(
    userText: string,
    contextHints: string[]
  ): string {
    const introVariants = [
      'Desculpe, esse assunto está fora do contexto que posso atender.',
      'Não posso responder sobre esse tema, pois está fora do contexto disponível.',
      'Esse pedido não está dentro do contexto da empresa/agente.',
      'No momento, só posso ajudar com assuntos do contexto da empresa/agente.',
    ];

    const guidanceVariants = [
      'Posso responder perguntas relacionadas ao contexto da empresa/agente. Se puder, reformule sua dúvida nesse sentido.',
      'Se quiser, reformule a pergunta para algo dentro do contexto da empresa/agente.',
      'Para eu ajudar melhor, traga uma pergunta relacionada ao contexto da empresa/agente.',
      'Fico à disposição para ajudar com temas ligados ao contexto da empresa/agente.',
    ];

    const seed = `${Date.now()}:${userText}`;
    const intro = this.pickVariant(seed, introVariants);
    const guidance = this.pickVariant(`${seed}:g`, guidanceVariants);
    const hintsText = this.formatContextHints(contextHints);

    return [intro, guidance, hintsText].filter(Boolean).join(' ');
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

    return `Posso ajudar com temas como: ${uniqueHints.join(', ')}.`;
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

  private buildDiversificationRetryPrompt(prompt: string): string {
    const retryInstructions = [
      '- Sua resposta ficou igual a uma resposta já enviada nesta conversa.',
      '- Reescreva com outra estrutura e palavras, adicionando detalhes ou exemplos diferentes.',
      '- Não repita frases, listas nem a ordem dos tópicos.',
      '- Não mencione que está variando ou que houve repetição.',
    ].join('\n');

    return `${prompt}\n\n### Diretrizes de Diversificação (Repetição Detectada):\n${retryInstructions}`;
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

    await this.redis.sadd(key, responseHash);
    await this.redis.expire(key, 60 * 60 * 24 * 7);
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
    }
  ): Promise<void> {
    await this.chatMessageService.sendMessage(t, {
      chat: createChat,
      accountId: createChat.account.id,
      type: EMessageType.text,
      message: aiResponse,
      typeUser: ETypeUserChat.bot,
    });

    const conversationSummary = await this.redis.get(conversationSummaryKey);
    const recentMessages = await this.getRecentChatMessages(
      createChat.account.id,
      createChat.chat_id,
      20
    );

    await this.updateConversationSummaryAfterResponse(
      createChat,
      selectedAiAgentId,
      conversationSummaryKey,
      conversationSummary,
      recentMessages,
      userText,
      aiResponse,
      aiAgent
    );

    await this.sendContinueMessageIfNeeded(t, createChat, currentNode);
  }

  private async sendContinueMessageIfNeeded(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    currentNode: ListChatbotFlowResponse['nodes'][number]
  ): Promise<void> {
    const continueMessage = currentNode.data?.continueMessage;

    if (!continueMessage || continueMessage.trim().length === 0) {
      return;
    }

    const continueMessageText = await this.replaceVariables(
      t,
      continueMessage,
      createChat,
      createChat.user,
      createChat.sector
    );

    await this.chatMessageService.sendMessage(t, {
      chat: createChat,
      accountId: createChat.account.id,
      type: EMessageType.text,
      message: continueMessageText,
      typeUser: ETypeUserChat.bot,
    });

    const continueMessageSentKey = `${this.getChatbotFlowCacheKey(
      createChat.account.id,
      createChat.worker.id,
      createChat.chat_id
    )}:continue-message-sent`;
    await this.redis.set(continueMessageSentKey, 'true', 'EX', 3600);
  }

  private async processStartNode(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    chatbotFlow: ListChatbotFlowResponse,
    currentFlowId: string,
    customMessages?: {
      service_finished_message?: string;
      invalid_menu_option_message?: string;
      invalid_satisfaction_option_message?: string;
      invalid_cpf_message?: string;
      invalid_cnpj_message?: string;
      invalid_email_message?: string;
      transfer_message_user?: string;
      transfer_message_sector?: string;
      transfer_message_sector_user?: string;
      service_finished_message_enabled?: boolean;
      invalid_menu_option_message_enabled?: boolean;
      invalid_satisfaction_option_message_enabled?: boolean;
      invalid_cpf_message_enabled?: boolean;
      invalid_cnpj_message_enabled?: boolean;
      invalid_email_message_enabled?: boolean;
      transfer_message_user_enabled?: boolean;
      transfer_message_sector_enabled?: boolean;
      transfer_message_sector_user_enabled?: boolean;
    },
    data?: IUpsertMessage
  ): Promise<boolean> {
    const nextFlowId = this.getNextFlowId(chatbotFlow, currentFlowId);

    if (!nextFlowId) {
      throw new Error(t('chatbot_flow_not_found'));
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

  private async processFlowNode(
    t: TFunction<'translation', undefined>,
    data: IUpsertMessage,
    createChat: IChat,
    chatbotFlow: ListChatbotFlowResponse,
    currentFlowId: string,
    chatbotId: string,
    options?: IProcessFlowNodeOptions
  ): Promise<boolean> {
    const inactivityAlert = options?.inactivityAlert;
    const redirectFailedAttempts = options?.redirectFailedAttempts;
    const customMessages = options?.customMessages;

    if (
      inactivityAlert?.status === 'active' &&
      (createChat.status === EChatStatus.ura ||
        createChat.status === EChatStatus.ura_schedule)
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
    customMessages?: {
      service_finished_message?: string;
      invalid_menu_option_message?: string;
      invalid_satisfaction_option_message?: string;
      invalid_cpf_message?: string;
      invalid_cnpj_message?: string;
      invalid_email_message?: string;
      transfer_message_user?: string;
      transfer_message_sector?: string;
      transfer_message_sector_user?: string;
      service_finished_message_enabled?: boolean;
      invalid_menu_option_message_enabled?: boolean;
      invalid_satisfaction_option_message_enabled?: boolean;
      invalid_cpf_message_enabled?: boolean;
      invalid_cnpj_message_enabled?: boolean;
      invalid_email_message_enabled?: boolean;
      transfer_message_user_enabled?: boolean;
      transfer_message_sector_enabled?: boolean;
      transfer_message_sector_user_enabled?: boolean;
    }
  ): Promise<boolean> {
    const currentNode = this.getFlowNodeById(chatbotFlow, currentFlowId);

    if (!currentNode) {
      throw new Error(t('chatbot_flow_node_not_found'));
    }

    const conditions = currentNode.data?.conditions;

    if (!Array.isArray(conditions) || conditions.length === 0) {
      return false;
    }

    const userText = this.getTextFromUpsertMessage(data)?.trim().toLowerCase();

    if (!userText) {
      return false;
    }

    for (const condition of conditions) {
      const conditionType = condition.conditionType;
      const conditionTerm = condition.conditionTerm;

      if (!conditionType || !conditionTerm) {
        continue;
      }

      const term = conditionTerm.trim().toLowerCase();
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

    return false;
  }

  private getDistributionCacheKey(accountId: string, workerId: string): string {
    return `underchat:chatbot-distribution-sequential:${accountId}:${workerId}`;
  }

  private async getEligibleUsers(
    accountId: string,
    sectorId?: string | null
  ): Promise<IChat['user'][]> {
    if (sectorId) {
      const sectorUsers = await this.sectorService.listSectorUsersForTransfer(
        accountId,
        sectorId
      );
      return sectorUsers.map((user) => ({
        id: user.id,
        name: user.name,
        photo: user.photo ?? null,
      }));
    }

    const users = await this.userService.listUsersForTransfer(accountId);
    return users.map((user) => ({
      id: user.id,
      name: user.name,
      photo: user.photo ?? null,
    }));
  }

  private async getSequentialUser(
    accountId: string,
    workerId: string,
    sectorId?: string | null
  ): Promise<IChat['user'] | null> {
    const eligibleUsers = await this.getEligibleUsers(accountId, sectorId);

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
    sectorId?: string | null
  ): Promise<IChat['user'] | null> {
    if (sectorId) {
      const eligibleUsers = await this.getEligibleUsers(accountId, sectorId);

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
    sectorId?: string | null
  ): Promise<IChat['user'] | null> {
    const eligibleUsers = await this.getEligibleUsers(accountId, sectorId);

    if (eligibleUsers.length === 0) {
      return null;
    }

    const randomIndex = Math.floor(Math.random() * eligibleUsers.length);
    return eligibleUsers[randomIndex];
  }

  private async processDistributionNode(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    chatbotFlow: ListChatbotFlowResponse,
    currentFlowId: string,
    customMessages?: {
      service_finished_message?: string;
      transfer_message_user?: string;
      transfer_message_sector?: string;
      transfer_message_sector_user?: string;
      service_finished_message_enabled?: boolean;
      transfer_message_user_enabled?: boolean;
      transfer_message_sector_enabled?: boolean;
      transfer_message_sector_user_enabled?: boolean;
    }
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

    const responsibleAttendant = createChat.contact?.responsible_attendant;

    if (responsibleAttendant) {
      const user: IChat['user'] = {
        id: responsibleAttendant.id,
        name: responsibleAttendant.name,
        photo: responsibleAttendant.photo ?? null,
      };

      const updatedChat = await this.updateAndPublishChat(
        t,
        createChat,
        user,
        undefined
      );

      await this.cancelInactivityCheck(updatedChat);

      const rawTransferMessage =
        flowTransferMessages?.transfer_message_user ||
        t('chatbot_transfer_message_user_default');
      const enabled =
        flowTransferMessages?.transfer_message_user_enabled !== false;

      if (rawTransferMessage && enabled !== false) {
        const transferMessage = await this.replaceVariables(
          t,
          rawTransferMessage,
          updatedChat,
          user,
          undefined
        );
        await this.chatMessageService.sendMessage(t, {
          chat: updatedChat,
          accountId: updatedChat.account.id,
          type: EMessageType.text,
          message: transferMessage,
          typeUser: ETypeUserChat.bot,
        });
      }

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
        sectorId
      );
    } else if (distributionType === 'load') {
      selectedUser = await this.getLoadBasedUser(
        createChat.account.id,
        sectorId
      );
    } else if (distributionType === 'random') {
      selectedUser = await this.getRandomUser(createChat.account.id, sectorId);
    }

    if (!selectedUser && !selectedSector) {
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

    const updatedChat = await this.updateAndPublishChat(
      t,
      createChat,
      selectedUser,
      selectedSector
    );

    await this.cancelInactivityCheck(updatedChat);

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
        updatedChat,
        selectedUser,
        selectedSector
      );
      await this.chatMessageService.sendMessage(t, {
        chat: updatedChat,
        accountId: updatedChat.account.id,
        type: EMessageType.text,
        message: transferMessage,
        typeUser: ETypeUserChat.bot,
      });
    }

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

  execute = async (
    t: TFunction<'translation', undefined>,
    data: IUpsertMessage,
    createChat: IChat,
    chatbotId: string
  ): Promise<string | null> => {
    if (createChat.contact?.ignore === EContactIgnore.ignore_automation) {
      return null;
    }

    const configurations =
      await this.chatbotService.findChatbotFlowConfigurationsByChatbotId(
        createChat.account.id,
        chatbotId
      );

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
          createChat,
          customServiceFinishedMessage,
          serviceFinishedMessageEnabled
        );

        return null;
      }
    }

    const chatbotFlow = await this.chatbotService.findChatbotFlowByChatbotId(
      createChat.account.id,
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
      createChat
    );

    if (!currentFlowId) {
      throw new Error(t('chatbot_flow_not_found'));
    }

    await this.processFlowNode(
      t,
      data,
      createChat,
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
  };
}
