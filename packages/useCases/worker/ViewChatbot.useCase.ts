import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerConfigService } from '@core/services/workerConfig.service';
import { WorkerService } from '@core/services/worker.service';

@injectable()
export class ViewChatbotUseCase {
  constructor(
    private readonly workerConfigService: WorkerConfigService,
    private readonly workerService: WorkerService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    workerId: string
  ): Promise<{
    chatbot_id: string | null;
    output_chatbot_id: string | null;
    enabled: boolean;
  }> {
    const existsWorkerById = await this.workerService.existsWorkerById(
      accountId,
      workerId
    );

    if (!existsWorkerById) {
      throw new Error(t('worker_not_found'));
    }

    const [oldResult, newResult] = await Promise.all([
      this.workerConfigService.viewChatbot(workerId),
      this.workerConfigService.viewChatbots(workerId),
    ]);

    return {
      chatbot_id: oldResult.chatbot_id,
      output_chatbot_id: newResult.output_chatbot_id,
      enabled: newResult.enabled || oldResult.enabled,
    };
  }
}
