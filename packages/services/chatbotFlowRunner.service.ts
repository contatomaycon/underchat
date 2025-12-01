import { injectable, inject } from 'tsyringe';
import Redis from 'ioredis';
import { ChatbotService } from './chatbot.service';
import { ChatService } from './chat.service';
import { ChatMessageService } from './chatMessage.service';
import { WorkerConfigService } from './workerConfig.service';
import { IChat } from '@core/common/interfaces/IChat';
import { TFunction } from 'i18next';
import { ListChatbotFlowResponse } from '@core/schema/chatbot/listChatbotFlow/response.schema';
import { EMessageType } from '@core/common/enums/EMessageType';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import { IUpsertMessage } from '@core/common/interfaces/IUpsertMessage';
import { EChatStatus } from '@core/common/enums/EChatStatus';

@injectable()
export class ChatbotFlowRunnerService {
  constructor(
    @inject('Redis') private readonly redis: Redis,
    private readonly chatbotService: ChatbotService,
    private readonly chatService: ChatService,
    private readonly chatMessageService: ChatMessageService,
    private readonly workerConfigService: WorkerConfigService
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

  private async sendTextOptionInvalidMessage(
    t: TFunction<'translation', undefined>,
    createChat: IChat
  ): Promise<boolean> {
    return this.chatMessageService.sendMessage(t, {
      chat: createChat,
      accountId: createChat.account.id,
      type: EMessageType.text,
      message: 'Opção inválida',
      typeUser: ETypeUserChat.bot,
    });
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
    createChat: IChat
  ): Promise<boolean> {
    await this.chatMessageService.sendMessage(t, {
      chat: createChat,
      accountId: createChat.account.id,
      type: EMessageType.text,
      message: 'Atendimento finalizado',
      typeUser: ETypeUserChat.bot,
    });

    const closedAt = new Date().toISOString();
    await this.chatService.updateChatStatus(
      createChat.chat_id,
      EChatStatus.closed,
      null,
      null,
      closedAt
    );

    const cacheKey = this.getChatbotFlowCacheKey(
      createChat.account.id,
      createChat.worker.id,
      createChat.chat_id
    );

    await this.redis.del(cacheKey);

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

  private async currentNodeTypeIsMenu(
    t: TFunction<'translation', undefined>,
    data: IUpsertMessage,
    createChat: IChat,
    chatbotFlow: ListChatbotFlowResponse,
    currentFlowId: string
  ): Promise<boolean> {
    const currentNode = this.getFlowNodeById(chatbotFlow, currentFlowId);
    if (!currentNode) {
      throw new Error(t('chatbot_flow_node_not_found'));
    }

    const cacheKey = this.getChatbotFlowCacheKey(
      createChat.account.id,
      createChat.worker.id,
      createChat.chat_id
    );

    const text = this.getTextFromUpsertMessage(data)?.trim();

    if (!text) {
      return this.sendTextOptionInvalidMessage(t, createChat);
    }

    const options = currentNode.data?.options ?? [];
    const selectedNumber = parseInt(text, 10);

    if (
      isNaN(selectedNumber) ||
      selectedNumber < 1 ||
      selectedNumber > options.length
    ) {
      return this.sendTextOptionInvalidMessage(t, createChat);
    }

    const selectedOption = options[selectedNumber - 1];

    if (!selectedOption) {
      return this.sendTextOptionInvalidMessage(t, createChat);
    }

    const nextFlowId = this.getNextFlowIdByOption(
      chatbotFlow,
      currentFlowId,
      selectedOption.id
    );

    if (!nextFlowId) {
      throw new Error(t('chatbot_flow_not_found'));
    }

    const nextFlowNode = this.getFlowNodeById(chatbotFlow, nextFlowId);

    if (!nextFlowNode) {
      throw new Error(t('chatbot_flow_node_not_found'));
    }

    await this.redis.set(cacheKey, nextFlowId, 'EX', 1800);

    if (nextFlowNode.type === 'menu') {
      return this.sendBuildMenuMessage(t, createChat, nextFlowNode);
    }

    if (nextFlowNode.type === 'message') {
      return this.sendMessage(t, createChat, nextFlowNode);
    }

    if (nextFlowNode.type === 'finish') {
      await this.sendFinishMessage(t, createChat);
      return true;
    }

    return false;
  }

  private async currentNodeTypeIsStart(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    chatbotFlow: ListChatbotFlowResponse,
    currentFlowId: string
  ): Promise<boolean> {
    const nextFlowId = this.getNextFlowId(chatbotFlow, currentFlowId);
    if (!nextFlowId) {
      throw new Error(t('chatbot_flow_not_found'));
    }

    const nextFlowNode = this.getFlowNodeById(chatbotFlow, nextFlowId);
    if (!nextFlowNode) {
      throw new Error(t('chatbot_flow_node_not_found'));
    }

    const cacheKey = this.getChatbotFlowCacheKey(
      createChat.account.id,
      createChat.worker.id,
      createChat.chat_id
    );

    await this.redis.set(cacheKey, nextFlowId, 'EX', 1800);

    if (nextFlowNode.type === 'menu') {
      return this.sendBuildMenuMessage(t, createChat, nextFlowNode);
    }

    if (nextFlowNode.type === 'message') {
      return this.sendMessage(t, createChat, nextFlowNode);
    }

    if (nextFlowNode.type === 'finish') {
      await this.sendFinishMessage(t, createChat);
      return true;
    }

    return false;
  }

  private async processFlowNode(
    t: TFunction<'translation', undefined>,
    data: IUpsertMessage,
    createChat: IChat,
    chatbotFlow: ListChatbotFlowResponse,
    currentFlowId: string
  ): Promise<boolean> {
    const currentNode = this.getFlowNodeById(chatbotFlow, currentFlowId);
    if (!currentNode) {
      throw new Error(t('chatbot_flow_node_not_found'));
    }

    const cacheKey = this.getChatbotFlowCacheKey(
      createChat.account.id,
      createChat.worker.id,
      createChat.chat_id
    );

    if (currentNode.type === 'start') {
      return this.currentNodeTypeIsStart(
        t,
        createChat,
        chatbotFlow,
        currentFlowId
      );
    }

    if (currentNode.type === 'menu') {
      return this.currentNodeTypeIsMenu(
        t,
        data,
        createChat,
        chatbotFlow,
        currentFlowId
      );
    }

    if (currentNode.type === 'message') {
      const continueType = currentNode.data?.continueType;

      if (continueType === 'automatic') {
        const nextFlowId = this.getNextFlowId(chatbotFlow, currentFlowId);

        if (nextFlowId) {
          const nextFlowNode = this.getFlowNodeById(chatbotFlow, nextFlowId);

          if (nextFlowNode) {
            await this.redis.set(cacheKey, nextFlowId, 'EX', 1800);

            if (nextFlowNode.type === 'menu') {
              return this.sendBuildMenuMessage(t, createChat, nextFlowNode);
            }

            if (nextFlowNode.type === 'message') {
              return this.sendMessage(t, createChat, nextFlowNode);
            }

            if (nextFlowNode.type === 'finish') {
              await this.sendFinishMessage(t, createChat);
              return true;
            }
          }
        }
      }

      return false;
    }

    if (currentNode.type === 'finish') {
      await this.sendFinishMessage(t, createChat);
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

    const currentFlowId = await this.cacheFirstChatbotFlowNodeIfNeeded(
      chatbotFlow,
      createChat
    );

    if (!currentFlowId) {
      throw new Error(t('chatbot_flow_not_found'));
    }

    await this.processFlowNode(t, data, createChat, chatbotFlow, currentFlowId);

    return currentFlowId;
  };
}
