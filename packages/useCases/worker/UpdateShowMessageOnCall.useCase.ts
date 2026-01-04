import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerConfigService } from '@core/services/workerConfig.service';
import { WorkerService } from '@core/services/worker.service';
import { UpdateShowMessageOnCallRequest } from '@core/schema/worker/updateShowMessageOnCall/request.schema';

@injectable()
export class UpdateShowMessageOnCallUseCase {
  constructor(
    private readonly workerConfigService: WorkerConfigService,
    private readonly workerService: WorkerService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    workerId: string,
    body: UpdateShowMessageOnCallRequest
  ): Promise<{
    show_message_on_call: string | null;
    enabled: boolean;
  }> {
    const existsWorkerById = await this.workerService.existsWorkerById(
      accountId,
      workerId
    );

    if (!existsWorkerById) {
      throw new Error(t('worker_not_found'));
    }

    const text = body.text?.trim() || null;

    const result = await this.workerConfigService.updateShowMessageOnCall(
      workerId,
      text,
      body.enabled
    );

    return result;
  }
}
