import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { ChatService } from '@core/services/chat.service';
import { WorkerService } from '@core/services/worker.service';
import { ViewWorkerConfigForChatResponse } from '@core/schema/chat/viewWorkerConfigForChat/response.schema';

@injectable()
export class WorkerConfigForChatViewerUseCase {
  constructor(
    private readonly chatService: ChatService,
    private readonly workerService: WorkerService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    workerId: string,
    userChannels: { id: string; name: string }[] = []
  ): Promise<ViewWorkerConfigForChatResponse> {
    const existsWorkerById = await this.workerService.existsWorkerById(
      accountId,
      workerId
    );

    if (!existsWorkerById) {
      throw new Error(t('worker_not_found'));
    }

    if (userChannels.length > 0) {
      const channelIds = userChannels.map((c) => c.id);
      if (!channelIds.includes(workerId)) {
        throw new Error(t('chat_access_denied'));
      }
    }

    return this.chatService.viewWorkerConfigForChat(workerId);
  }
}
