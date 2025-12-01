import { injectable, inject } from 'tsyringe';
import Redis from 'ioredis';
import { ChatbotService } from './chatbot.service';
import { ChatService } from './chat.service';
import { ChatMessageService } from './chatMessage.service';
import { WorkerConfigService } from './workerConfig.service';
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

@injectable()
export class ChatbotFlowRunnerService {
  constructor(
    @inject('Redis') private readonly redis: Redis,
    private readonly chatbotService: ChatbotService,
    private readonly chatService: ChatService,
    private readonly chatMessageService: ChatMessageService,
    private readonly workerConfigService: WorkerConfigService,
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

  private getFirstLogicalNodeId(
    chatbotFlow: ListChatbotFlowResponse
  ): string | null {
    const { nodes, edges } = chatbotFlow;

    if (!nodes || !Array.isArray(nodes) || nodes.length === 0) {
      return null;
    }

    const startNode = nodes.find((node) => node.type === 'start');

    if (startNode && Array.isArray(edges) && edges.length > 0) {
      const firstEdgeFromStart = edges.find(
        (edge) => edge.source === startNode.id
      );

      if (firstEdgeFromStart) {
        return firstEdgeFromStart.target;
      }
    }

    const firstNonStartNode = nodes.find((node) => node.type !== 'start');

    return firstNonStartNode ? firstNonStartNode.id : null;
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
    const messageContent: any = data.message?.message;

    if (!messageContent) {
      return null;
    }

    if (messageContent.conversation) {
      return messageContent.conversation as string;
    }

    if (messageContent.extendedTextMessage?.text) {
      return messageContent.extendedTextMessage.text as string;
    }

    if (messageContent.imageMessage?.caption) {
      return messageContent.imageMessage.caption as string;
    }

    return null;
  }

  private async sendTextOptionInvalidMessage(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    customMessage?: string
  ): Promise<boolean> {
    const message = customMessage || t('chatbot_option_invalid');
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
    const message = customMessage || t('email_invalid');
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
    const message = customMessage || t('cpf_invalid');
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
    const message = customMessage || t('cnpj_invalid');
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
    const text = node.data?.text || node.data?.message || '';
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
    const baseMessage = node.data?.message;
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

    const message = customMessage || t('chatbot_service_finished');

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
      const dataType = nextFlowNode.data?.dataType;
      let questionText = '';

      if (dataType === 'name') {
        questionText = nextFlowNode.data?.firstName || '';
      }

      if (dataType === 'email') {
        questionText = nextFlowNode.data?.email || '';
      }

      if (dataType === 'cpf') {
        questionText = nextFlowNode.data?.cpf || '';
      }

      if (dataType === 'cnpj') {
        questionText = nextFlowNode.data?.cnpj || '';
      }

      if (questionText) {
        await this.chatMessageService.sendMessage(t, {
          chat: createChat,
          accountId: createChat.account.id,
          type: EMessageType.text,
          message: questionText,
          typeUser: ETypeUserChat.bot,
        });
      }

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

  private async processRedirectNode(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    chatbotFlow: ListChatbotFlowResponse,
    currentFlowId: string
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
      if (!selectedUser) {
        throw new Error(t('user_not_selected'));
      }

      const userData = await this.userService.viewUserNamePhoto(selectedUser);

      if (!userData) {
        throw new Error(t('user_not_found'));
      }

      user = {
        id: userData.id,
        name: userData.name,
        photo: userData.photo ?? null,
      };
    }

    if (redirectType === 'sector') {
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

      sector = {
        id: sectorData.sector_id,
        name: sectorData.name,
      };

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
    }

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

    const nextFlowId = this.getNextFlowId(chatbotFlow, currentFlowId);

    if (!nextFlowId) {
      return true;
    }

    return this.processNextNode(t, updatedChat, chatbotFlow, nextFlowId);
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
      const nextFlowId = this.getNextFlowId(chatbotFlow, currentFlowId);
      if (nextFlowId) {
        await this.updateCache(createChat, nextFlowId);
        return this.processNextNode(t, createChat, chatbotFlow, nextFlowId);
      }
      return true;
    }

    if (dataType === 'email') {
      if (!this.isValidEmail(userText)) {
        await this.sendInvalidEmailMessage(
          t,
          createChat,
          customMessages?.invalid_email_message
        );
        return false;
      }

      const nextFlowId = this.getNextFlowId(chatbotFlow, currentFlowId);
      if (nextFlowId) {
        await this.updateCache(createChat, nextFlowId);
        return this.processNextNode(t, createChat, chatbotFlow, nextFlowId);
      }
      return true;
    }

    if (dataType === 'cpf') {
      if (!this.isValidCPF(userText)) {
        await this.sendInvalidCpfMessage(
          t,
          createChat,
          customMessages?.invalid_cpf_message
        );
        return false;
      }

      const nextFlowId = this.getNextFlowId(chatbotFlow, currentFlowId);
      if (nextFlowId) {
        await this.updateCache(createChat, nextFlowId);
        return this.processNextNode(t, createChat, chatbotFlow, nextFlowId);
      }
      return true;
    }

    if (dataType === 'cnpj') {
      if (!this.isValidCNPJ(userText)) {
        await this.sendInvalidCnpjMessage(
          t,
          createChat,
          customMessages?.invalid_cnpj_message
        );
        return false;
      }

      const nextFlowId = this.getNextFlowId(chatbotFlow, currentFlowId);
      if (nextFlowId) {
        await this.updateCache(createChat, nextFlowId);
        return this.processNextNode(t, createChat, chatbotFlow, nextFlowId);
      }
      return true;
    }

    return false;
  }

  private async processMenuNode(
    t: TFunction<'translation', undefined>,
    data: IUpsertMessage,
    createChat: IChat,
    chatbotFlow: ListChatbotFlowResponse,
    currentFlowId: string,
    customMessage?: string
  ): Promise<boolean> {
    const currentNode = this.getFlowNodeById(chatbotFlow, currentFlowId);
    if (!currentNode) {
      throw new Error(t('chatbot_flow_node_not_found'));
    }

    const text = this.getTextFromUpsertMessage(data)?.trim();
    if (!text) {
      return this.sendTextOptionInvalidMessage(t, createChat, customMessage);
    }

    const options = currentNode.data?.options ?? [];
    const selectedNumber = parseInt(text, 10);

    if (
      isNaN(selectedNumber) ||
      selectedNumber < 1 ||
      selectedNumber > options.length
    ) {
      return this.sendTextOptionInvalidMessage(t, createChat, customMessage);
    }

    const selectedOption = options[selectedNumber - 1];

    if (!selectedOption) {
      return this.sendTextOptionInvalidMessage(t, createChat, customMessage);
    }

    const nextFlowId = this.getNextFlowIdByOption(
      chatbotFlow,
      currentFlowId,
      selectedOption.id
    );

    if (!nextFlowId) {
      throw new Error(t('chatbot_flow_not_found'));
    }

    return this.processNextNode(t, createChat, chatbotFlow, nextFlowId);
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
    customMessages?: {
      inactivity_message?: string;
      invalid_menu_option_message?: string;
      invalid_satisfaction_option_message?: string;
      invalid_cpf_message?: string;
      invalid_cnpj_message?: string;
      invalid_email_message?: string;
      service_finished_message?: string;
    }
  ): Promise<boolean> {
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
        message
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
        currentFlowId
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
    const chatbotFlow = await this.chatbotService.findChatbotFlowByChatbotId(
      createChat.account.id,
      chatbotId
    );

    if (!chatbotFlow) {
      throw new Error(t('chatbot_flow_not_found'));
    }

    const configurations =
      await this.chatbotService.findChatbotFlowConfigurationsByChatbotId(
        createChat.account.id,
        chatbotId
      );

    const customMessages = configurations?.configurations?.messages;

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
      customMessages
    );

    return currentFlowId;
  };
}
