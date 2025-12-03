import { injectable, inject } from 'tsyringe';
import Redis from 'ioredis';
import { ChatbotService } from './chatbot.service';
import { ChatService } from './chat.service';
import { ChatMessageService } from './chatMessage.service';
import { ContactService } from './contact.service';
import { LabelTemplateViewerRepository } from '@core/repositories/labelTemplate/LabelTemplateViewer.repository';
import { CentrifugoService } from './centrifugo.service';
import { UserService } from './user.service';
import { SectorService } from './sector.service';
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
import { proto } from '@whiskeysockets/baileys';

@injectable()
export class ChatbotFlowRunnerService {
  constructor(
    @inject('Redis') private readonly redis: Redis,
    private readonly chatbotService: ChatbotService,
    private readonly chatService: ChatService,
    private readonly chatMessageService: ChatMessageService,
    private readonly contactService: ContactService,
    private readonly labelTemplateViewerRepository: LabelTemplateViewerRepository,
    private readonly centrifugoService: CentrifugoService,
    private readonly userService: UserService,
    private readonly sectorService: SectorService
  ) {}

  private getChatbotFlowCacheKey(
    accountId: string,
    workerId: string,
    chatId: string
  ): string {
    return `underchat:chatbot-flow:${accountId}:${workerId}:${chatId}`;
  }

  private getInactivityCacheKey(
    accountId: string,
    workerId: string,
    chatId: string
  ): string {
    return `underchat:chatbot-inactivity:${accountId}:${workerId}:${chatId}`;
  }

  private getInactivityScheduleKey(): string {
    return 'underchat:chatbot-inactivity-schedule';
  }

  private getFailedAttemptsCacheKey(
    accountId: string,
    workerId: string,
    chatId: string
  ): string {
    return `underchat:chatbot-failed-attempts:${accountId}:${workerId}:${chatId}`;
  }

  private getBaileysChatCacheKey(
    accountId: string,
    workerId: string,
    phone: string
  ): string {
    return `underchat:chat:${accountId}:${workerId}:${phone}`;
  }

  private async invalidateChatFromCache(chat: IChat): Promise<void> {
    const accountId = chat.account?.id;
    const workerId = chat.worker?.id;
    const phone = chat.phone;

    if (!accountId || !workerId || !phone) {
      return;
    }

    const key = this.getBaileysChatCacheKey(accountId, workerId, phone);
    await this.redis.del(key);
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
    const edge = chatbotFlow.edges.find(
      (currentEdge) =>
        currentEdge.source === currentFlowId &&
        currentEdge.sourceHandle === `option-${optionId}-source`
    );

    return edge?.target ?? null;
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
    customMessage?: string
  ): Promise<boolean> {
    const rawMessage = customMessage || t('chatbot_option_invalid');
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
    customMessage?: string
  ): Promise<boolean> {
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
    customMessage?: string
  ): Promise<boolean> {
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
    customMessage?: string
  ): Promise<boolean> {
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
    node: ListChatbotFlowResponse['nodes'][number]
  ): Promise<boolean> {
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
    customMessage?: string
  ): Promise<boolean> {
    const closedAt = new Date().toISOString();
    const cacheKey = this.getChatbotFlowCacheKey(
      createChat.account.id,
      createChat.worker.id,
      createChat.chat_id
    );

    const rawMessage = customMessage || t('chatbot_service_finished');
    const message = await this.replaceVariables(
      t,
      rawMessage,
      createChat,
      createChat.user,
      createChat.sector
    );

    await Promise.all([
      this.chatMessageService.sendMessage(t, {
        chat: createChat,
        accountId: createChat.account.id,
        type: EMessageType.text,
        message,
        typeUser: ETypeUserChat.bot,
      }),
      this.chatService.updateChatStatus(
        createChat.chat_id,
        EChatStatus.closed,
        null,
        null,
        closedAt
      ),
      this.redis.del(cacheKey),
      this.cancelInactivityCheck(createChat),
      this.invalidateChatFromCache(createChat),
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

  private getQuestionTextForDataType(
    node: ListChatbotFlowResponse['nodes'][number]
  ): string {
    const dataType = node.data?.dataType;

    if (dataType === 'name') {
      return node.data?.firstName || '';
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
    nextFlowId: string
  ): Promise<boolean> {
    const nextFlowNode = this.getFlowNodeById(chatbotFlow, nextFlowId);

    if (!nextFlowNode) {
      return false;
    }

    await this.updateCache(createChat, nextFlowId);

    if (nextFlowNode.type === 'menu' || nextFlowNode.type === 'satisfaction') {
      return this.sendBuildMenuMessage(t, createChat, nextFlowNode);
    }

    if (nextFlowNode.type === 'message') {
      return this.processMessageNode(t, createChat, nextFlowNode, chatbotFlow);
    }

    if (nextFlowNode.type === 'tag') {
      return this.processTagNode(t, createChat, chatbotFlow, nextFlowId);
    }

    if (nextFlowNode.type === 'redirect') {
      return this.processRedirectNode(t, createChat, chatbotFlow, nextFlowId);
    }

    if (nextFlowNode.type === 'data') {
      await this.processDataNodeQuestion(t, createChat, nextFlowNode);
      return true;
    }

    if (nextFlowNode.type === 'finish') {
      await this.sendFinishMessage(t, createChat);
      return true;
    }

    return true;
  }

  private async processMessageNode(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    node: ListChatbotFlowResponse['nodes'][number],
    chatbotFlow: ListChatbotFlowResponse
  ): Promise<boolean> {
    const continueType = node.data?.continueType;

    if (continueType === 'automatic') {
      await this.sendMessage(t, createChat, node);

      const nextFlowId = this.getNextFlowId(chatbotFlow, node.id);
      if (nextFlowId) {
        await this.updateCache(createChat, nextFlowId);
        return this.processNextNode(t, createChat, chatbotFlow, nextFlowId);
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
    currentFlowId: string
  ): Promise<boolean> {
    const continueType = currentNode.data?.continueType;

    if (continueType === 'automatic') {
      await this.sendMessage(t, createChat, currentNode);

      const nextFlowId = this.getNextFlowId(chatbotFlow, currentFlowId);
      if (nextFlowId) {
        await this.updateCache(createChat, nextFlowId);
        return this.processNextNode(t, createChat, chatbotFlow, nextFlowId);
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
    labelTemplateId: string
  ): Promise<void> {
    const labelTemplate =
      await this.labelTemplateViewerRepository.viewLabelTemplateById(
        labelTemplateId,
        createChat.account.id
      );

    if (!labelTemplate) {
      throw new Error(t('label_template_not_found'));
    }

    const label = {
      label_template_id: labelTemplate.label_template_id,
      label: labelTemplate.label,
      color: labelTemplate.color,
    };

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

    await Promise.all([
      this.chatService.saveChat(updatedChat),
      this.invalidateChatFromCache(updatedChat),
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
  }

  private async updateContactTag(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    labelTemplateId: string
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

    const updated = await this.contactService.updateContactById(
      {
        label_template_id: labelTemplateId,
      },
      createChat.contact.id,
      createChat.account.id
    );

    if (!updated) {
      throw new Error(t('contact_update_error'));
    }

    await this.invalidateChatFromCache(createChat);
  }

  private async processTagNode(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    chatbotFlow: ListChatbotFlowResponse,
    currentFlowId: string
  ): Promise<boolean> {
    const currentNode = this.getFlowNodeById(chatbotFlow, currentFlowId);

    if (!currentNode) {
      throw new Error(t('chatbot_flow_node_not_found'));
    }

    const tagType = currentNode.data?.tagType;
    const selectedTag = currentNode.data?.selectedTag;

    if (!selectedTag) {
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

    return this.processNextNode(t, createChat, chatbotFlow, nextFlowId);
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
      createChat.account.id,
      false
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
    const updated = await this.chatService.updateChatUserAndSector(
      createChat.chat_id,
      user,
      sector
    );

    if (!updated) {
      throw new Error(t('chat_update_failed'));
    }

    await this.chatService.updateChatStatus(
      createChat.chat_id,
      EChatStatus.queue
    );

    const updatedChat: IChat = {
      ...createChat,
      user,
      sector,
      status: EChatStatus.queue,
    };

    await Promise.all([
      this.chatService.saveChat(updatedChat),
      this.invalidateChatFromCache(updatedChat),
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
    customMessages?: {
      transfer_message_user?: string;
      transfer_message_sector?: string;
      transfer_message_sector_user?: string;
    }
  ): Promise<boolean> {
    const currentNode = this.getFlowNodeById(chatbotFlow, currentFlowId);

    if (!currentNode) {
      throw new Error(t('chatbot_flow_node_not_found'));
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
    }

    const updatedChat = await this.updateAndPublishChat(
      t,
      createChat,
      user,
      sector
    );

    await this.cancelInactivityCheck(updatedChat);

    let rawTransferMessage: string | undefined;
    if (redirectType === 'user' && user) {
      rawTransferMessage =
        customMessages?.transfer_message_user ||
        t('chatbot_transfer_message_user_default');
    } else if (redirectType === 'sector' && sector) {
      if (user) {
        rawTransferMessage =
          customMessages?.transfer_message_sector_user ||
          t('chatbot_transfer_message_sector_user_default');
      } else {
        rawTransferMessage =
          customMessages?.transfer_message_sector ||
          t('chatbot_transfer_message_sector_default');
      }
    }

    if (rawTransferMessage && (user || sector)) {
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

    return this.processNextNode(t, updatedChat, chatbotFlow, nextFlowId);
  }

  private async processNextNodeAfterValidation(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    chatbotFlow: ListChatbotFlowResponse,
    currentFlowId: string
  ): Promise<boolean> {
    const nextFlowId = this.getNextFlowId(chatbotFlow, currentFlowId);
    if (nextFlowId) {
      await this.updateCache(createChat, nextFlowId);
      return this.processNextNode(t, createChat, chatbotFlow, nextFlowId);
    }
    return true;
  }

  private async processNameDataNode(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    chatbotFlow: ListChatbotFlowResponse,
    currentFlowId: string
  ): Promise<boolean> {
    return this.processNextNodeAfterValidation(
      t,
      createChat,
      chatbotFlow,
      currentFlowId
    );
  }

  private async processEmailDataNode(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    chatbotFlow: ListChatbotFlowResponse,
    currentFlowId: string,
    userText: string,
    customMessage?: string
  ): Promise<boolean> {
    if (!this.isValidEmail(userText)) {
      await this.sendInvalidEmailMessage(t, createChat, customMessage);
      return false;
    }

    return this.processNextNodeAfterValidation(
      t,
      createChat,
      chatbotFlow,
      currentFlowId
    );
  }

  private async processCpfDataNode(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    chatbotFlow: ListChatbotFlowResponse,
    currentFlowId: string,
    userText: string,
    customMessage?: string
  ): Promise<boolean> {
    if (!this.isValidCPF(userText)) {
      await this.sendInvalidCpfMessage(t, createChat, customMessage);
      return false;
    }

    return this.processNextNodeAfterValidation(
      t,
      createChat,
      chatbotFlow,
      currentFlowId
    );
  }

  private async processCnpjDataNode(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    chatbotFlow: ListChatbotFlowResponse,
    currentFlowId: string,
    userText: string,
    customMessage?: string
  ): Promise<boolean> {
    if (!this.isValidCNPJ(userText)) {
      await this.sendInvalidCnpjMessage(t, createChat, customMessage);
      return false;
    }

    return this.processNextNodeAfterValidation(
      t,
      createChat,
      chatbotFlow,
      currentFlowId
    );
  }

  private async processDataNode(
    t: TFunction<'translation', undefined>,
    data: IUpsertMessage,
    createChat: IChat,
    chatbotFlow: ListChatbotFlowResponse,
    currentFlowId: string,
    customMessages?: {
      invalid_cpf_message?: string;
      invalid_cnpj_message?: string;
      invalid_email_message?: string;
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
        createChat,
        chatbotFlow,
        currentFlowId
      );
    }

    if (dataType === 'email') {
      return this.processEmailDataNode(
        t,
        createChat,
        chatbotFlow,
        currentFlowId,
        userText,
        customMessages?.invalid_email_message
      );
    }

    if (dataType === 'cpf') {
      return this.processCpfDataNode(
        t,
        createChat,
        chatbotFlow,
        currentFlowId,
        userText,
        customMessages?.invalid_cpf_message
      );
    }

    if (dataType === 'cnpj') {
      return this.processCnpjDataNode(
        t,
        createChat,
        chatbotFlow,
        currentFlowId,
        userText,
        customMessages?.invalid_cnpj_message
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

    const text = this.getTextFromUpsertMessage(data)?.trim();
    if (!text) {
      return this.handleInvalidMenuAttempt(
        t,
        createChat,
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

    await this.resetFailedAttempts(createChat);

    return this.processNextNode(t, createChat, chatbotFlow, nextFlowId);
  }

  private async scheduleInactivityCheck(
    createChat: IChat,
    timeMinutes: number,
    chatbotId: string
  ): Promise<void> {
    if (createChat.status !== EChatStatus.ura) {
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
    customInactivityMessage?: string
  ): Promise<void> {
    if (createChat.status !== EChatStatus.ura) {
      await this.cancelInactivityCheck(createChat);

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
    }
  ): Promise<boolean> {
    const redirectType = inactivityAlert.redirect_type;

    if (redirectType === 'user') {
      return this.processInactivityUserRedirect(
        t,
        createChat,
        inactivityAlert.selected_user
      );
    }

    if (redirectType === 'sector') {
      return this.processInactivitySectorRedirect(
        t,
        createChat,
        inactivityAlert.selected_sector,
        inactivityAlert.selected_sector_user
      );
    }

    return false;
  }

  private async processInactivityUserRedirect(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    selectedUser?: string
  ): Promise<boolean> {
    if (!selectedUser) {
      return false;
    }

    const user = await this.getUserForRedirect(selectedUser);
    if (!user) {
      return false;
    }

    await this.updateAndPublishChat(t, createChat, user, undefined);
    return true;
  }

  private async processInactivitySectorRedirect(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    selectedSector?: string,
    selectedSectorUser?: string
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
    customServiceFinishedMessage?: string
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
      customInactivityMessage
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
      customServiceFinishedMessage
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
    customInactivityMessage?: string
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
      customInactivityMessage
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
    customServiceFinishedMessage?: string
  ): Promise<boolean> {
    if (action === 'finish') {
      await this.sendFinishMessage(t, createChat, customServiceFinishedMessage);
      return true;
    }

    if (action === 'redirect') {
      return this.processInactivityRedirect(t, createChat, inactivityAlert);
    }

    return false;
  }

  private async handleInvalidMenuAttempt(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
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
      transfer_message_user?: string;
      transfer_message_sector?: string;
      transfer_message_sector_user?: string;
    }
  ): Promise<boolean> {
    await this.sendTextOptionInvalidMessage(t, createChat, customMessage);

    if (
      !this.shouldRedirectOnFailedAttempt(redirectFailedAttempts, createChat)
    ) {
      return true;
    }

    const quantity = redirectFailedAttempts!.quantity ?? 1;
    const failedAttemptsCount = await this.incrementFailedAttempts(createChat);

    if (failedAttemptsCount < quantity) {
      return true;
    }

    await this.resetFailedAttempts(createChat);

    const { user, sector } = await this.getRedirectTargets(
      redirectFailedAttempts!,
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
      redirectFailedAttempts!.redirect_type,
      user,
      sector,
      customMessages
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
      createChat?.status === EChatStatus.ura
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
      accountId,
      false
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
    }
  ): Promise<void> {
    const rawTransferMessage = this.getTransferMessage(
      t,
      redirectType,
      user,
      sector,
      customMessages
    );

    if (!rawTransferMessage || (!user && !sector)) {
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
    }
  ): string | undefined {
    if (redirectType === 'user' && user) {
      return (
        customMessages?.transfer_message_user ||
        t('chatbot_transfer_message_user_default')
      );
    }

    if (redirectType === 'sector' && sector) {
      if (user) {
        return (
          customMessages?.transfer_message_sector_user ||
          t('chatbot_transfer_message_sector_user_default')
        );
      }
      return (
        customMessages?.transfer_message_sector ||
        t('chatbot_transfer_message_sector_default')
      );
    }

    return undefined;
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

      if (!inactivityAlert || inactivityAlert.status !== 'active') {
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

      if (createChat.status !== EChatStatus.ura) {
        await this.cancelInactivityCheck(createChat);

        continue;
      }

      const customInactivityMessage =
        configurations?.configurations?.messages?.inactivity_message;
      const customServiceFinishedMessage =
        configurations?.configurations?.messages?.service_finished_message;

      await this.processInactivityAlert(
        t,
        inactivityCacheKey,
        inactivityData,
        inactivityAlert,
        createChat,
        customInactivityMessage,
        customServiceFinishedMessage
      );
    }
  }

  private async processStartNode(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    chatbotFlow: ListChatbotFlowResponse,
    currentFlowId: string
  ): Promise<boolean> {
    const nextFlowId = this.getNextFlowId(chatbotFlow, currentFlowId);

    if (!nextFlowId) {
      throw new Error(t('chatbot_flow_not_found'));
    }

    return this.processNextNode(t, createChat, chatbotFlow, nextFlowId);
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
      inactivityAlert &&
      inactivityAlert.status === 'active' &&
      createChat.status === EChatStatus.ura
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
      return this.processStartNode(t, createChat, chatbotFlow, currentFlowId);
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

    if (currentNode.type === 'message') {
      return this.processMessageNodeType(
        t,
        createChat,
        chatbotFlow,
        currentNode,
        currentFlowId
      );
    }

    if (currentNode.type === 'tag') {
      return this.processTagNode(t, createChat, chatbotFlow, currentFlowId);
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

    if (currentNode.type === 'finish') {
      await this.sendFinishMessage(
        t,
        createChat,
        customMessages?.service_finished_message
      );
      return true;
    }

    return false;
  }

  execute = async (
    t: TFunction<'translation', undefined>,
    data: IUpsertMessage,
    createChat: IChat,
    chatbotId: string
  ): Promise<string | null> => {
    const userText = this.getTextFromUpsertMessage(data)?.trim();

    if (!userText) {
      return null;
    }

    const configurations =
      await this.chatbotService.findChatbotFlowConfigurationsByChatbotId(
        createChat.account.id,
        chatbotId
      );

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

      await this.sendFinishMessage(t, createChat, customServiceFinishedMessage);

      return null;
    }

    const chatbotFlow = await this.chatbotService.findChatbotFlowByChatbotId(
      createChat.account.id,
      chatbotId
    );

    if (!chatbotFlow) {
      throw new Error(t('chatbot_flow_not_found'));
    }

    const customMessages = configurations?.configurations?.messages;
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
