import { injectable, inject } from 'tsyringe';
import { ChatbotService } from '@core/services/chatbot.service';
import { ListChatbotFlowResponse } from '@core/schema/chatbot/listChatbotFlow/response.schema';
import { maskApiRequestSecrets } from '@core/common/functions/chatbotApiRequestSecurity';
import { hasFullAccess } from '@core/common/functions/hasFullAccess';
import type { IJwtGroupHierarchy } from '@core/common/interfaces/IJwtGroupHierarchy';

@injectable()
export class ChatbotFlowListerUseCase {
  constructor(
    @inject(ChatbotService)
    private readonly chatbotService: ChatbotService
  ) {}

  async execute(
    accountId: string,
    chatbotId: string,
    actions: IJwtGroupHierarchy[] = []
  ): Promise<ListChatbotFlowResponse | null> {
    const flow = await this.chatbotService.findChatbotFlowByChatbotId(
      accountId,
      chatbotId
    );
    if (!flow) return null;
    const nodes = flow.nodes.map((node) =>
      node.type === 'apiRequest' && node.data.apiRequest
        ? {
            ...node,
            data: {
              ...node.data,
              apiRequest: maskApiRequestSecrets(node.data.apiRequest),
            },
          }
        : node
    );
    const containsUnderchat = nodes.some((node) => node.type === 'underchat');
    if (!containsUnderchat || hasFullAccess(actions)) {
      return { ...flow, nodes };
    }

    return {
      ...flow,
      read_only: true,
      restricted: true,
      nodes: nodes.map((node) => {
        if (node.type !== 'underchat') return node;
        const visibleData = { ...node.data };
        delete visibleData.underchatLookup;
        delete visibleData.outputKey;
        return {
          ...node,
          data: {
            ...visibleData,
            restricted: true,
          },
        };
      }),
    };
  }
}
