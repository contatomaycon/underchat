import { injectable, inject } from 'tsyringe';
import Redis from 'ioredis';
import { ChatbotService } from './chatbot.service';
import { ChatService } from './chat.service';
import { ChatMessageCreatorUseCase } from '@core/useCases/chat/ChatMessageCreator.useCase';
import { ChatStatusUpdaterUseCase } from '@core/useCases/chat/ChatStatusUpdater.useCase';
import { WorkerConfigService } from './workerConfig.service';
import { IChat } from '@core/common/interfaces/IChat';
import { TFunction } from 'i18next';
import { ListChatbotFlowResponse } from '@core/schema/chatbot/listChatbotFlow/response.schema';
import {
  CreateMessageChatsBody,
  CreateMessageChatsParams,
} from '@core/schema/chat/createMessageChats/request.schema';
import { EMessageType } from '@core/common/enums/EMessageType';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';

@injectable()
export class ChatbotFlowRunnerService {
  constructor(
    @inject('Redis') private readonly redis: Redis,
    private readonly chatbotService: ChatbotService,
    private readonly chatService: ChatService,
    private readonly chatMessageCreatorUseCase: ChatMessageCreatorUseCase,
    private readonly chatStatusUpdaterUseCase: ChatStatusUpdaterUseCase,
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

  private async buildMenuMessage(
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

    const bodyMessage: CreateMessageChatsBody = {
      type: EMessageType.text,
      message: menuMessage,
    };

    const paramsMessage: CreateMessageChatsParams = {
      chat_id: createChat.chat_id,
    };

    return this.chatMessageCreatorUseCase.execute(
      t,
      createChat.account.id,
      paramsMessage,
      bodyMessage,
      ETypeUserChat.bot
    );
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

  private async processFlowNode(
    t: TFunction<'translation', undefined>,
    createChat: IChat,
    chatbotFlow: ListChatbotFlowResponse,
    currentFlowId: string
  ): Promise<boolean> {
    const currentNode = this.getFlowNodeById(chatbotFlow, currentFlowId);
    if (!currentNode) {
      throw new Error(t('chatbot_flow_node_not_found'));
    }

    const nextFlowId = this.getNextFlowId(chatbotFlow, currentFlowId);
    if (!nextFlowId) {
      throw new Error(t('chatbot_flow_not_found'));
    }

    const nextFlowNode = this.getFlowNodeById(chatbotFlow, nextFlowId);
    if (!nextFlowNode) {
      throw new Error(t('chatbot_flow_node_not_found'));
    }

    console.log('nextFlowNode');
    console.dir(nextFlowNode, { depth: null });

    console.log('currentNode');
    console.dir(currentNode, { depth: null });

    console.log('nextFlowId');
    console.dir(nextFlowId, { depth: null });

    if (currentNode.type === 'menu') {
      return this.buildMenuMessage(t, createChat, currentNode);
    }

    console.log('currentNode');
    console.dir(currentNode, { depth: null });

    return false;
  }

  execute = async (
    t: TFunction<'translation', undefined>,
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

    await this.processFlowNode(t, createChat, chatbotFlow, currentFlowId);

    console.log('chatbotFlow');
    console.dir(chatbotFlow, { depth: null });

    console.log('currentFlowId');
    console.dir(currentFlowId, { depth: null });

    return currentFlowId;
  };
}
