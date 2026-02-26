import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerConfigService } from '@core/services/workerConfig.service';
import { WorkerService } from '@core/services/worker.service';

@injectable()
export class ViewChatbotUseCase {
  constructor(
    @inject(WorkerConfigService)
    private readonly workerConfigService: WorkerConfigService,
    @inject(WorkerService)
    private readonly workerService: WorkerService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    workerId: string
  ): Promise<{
    chatbot_id: string | null;
    output_chatbot_id: string | null;
    chatbot_working_hours_enabled: boolean;
    chatbot_working_hours_timezone: string;
    chatbot_working_hours_rules: Array<{
      weekday:
        | 'monday'
        | 'tuesday'
        | 'wednesday'
        | 'thursday'
        | 'friday'
        | 'saturday'
        | 'sunday';
      start_time: string;
      end_time: string;
      chatbot_id: string;
    }>;
    enabled: boolean;
  }> {
    const existsWorkerById = await this.workerService.existsWorkerById(
      accountId,
      workerId
    );

    if (!existsWorkerById) {
      throw new Error(t('worker_not_found'));
    }

    const result = await this.workerConfigService.viewChatbots(workerId);

    return {
      chatbot_id: result.chatbot_id,
      output_chatbot_id: result.output_chatbot_id,
      chatbot_working_hours_enabled: result.chatbot_working_hours_enabled,
      chatbot_working_hours_timezone: result.chatbot_working_hours_timezone,
      chatbot_working_hours_rules: result.chatbot_working_hours_rules,
      enabled: result.enabled,
    };
  }
}
