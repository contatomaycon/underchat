import { inject, injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { ChatService } from '@core/services/chat.service';
import { WorkerService } from '@core/services/worker.service';
import { IJwtGroupHierarchy } from '@core/common/interfaces/IJwtGroupHierarchy';
import { canUseChannelForTransferAndForwarding } from '@core/common/functions/transferAndForwardChannelAccess';
import { ListChannelChatbotsResponse } from '@core/schema/chatbot/listChannelChatbots/response.schema';

@injectable()
export class ChatbotChannelChatbotsListerUseCase {
  constructor(
    @inject(ChatService) private readonly chatService: ChatService,
    @inject(WorkerService) private readonly workerService: WorkerService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    workerId: string,
    userChannels: { id: string; name: string }[] = [],
    actions: IJwtGroupHierarchy[] = []
  ): Promise<ListChannelChatbotsResponse> {
    if (
      !canUseChannelForTransferAndForwarding(workerId, userChannels, actions)
    ) {
      throw new Error(t('chat_access_denied'));
    }

    const worker = await this.workerService.viewWorkerNameAndId(
      accountId,
      workerId
    );
    if (!worker) {
      throw new Error(t('worker_not_found'));
    }

    const config = await this.chatService.viewWorkerConfigForChat(workerId);
    return [config?.input_chatbot, config?.output_chatbot].filter(
      (chatbot): chatbot is ListChannelChatbotsResponse[number] =>
        chatbot !== null && chatbot !== undefined
    );
  }
}
