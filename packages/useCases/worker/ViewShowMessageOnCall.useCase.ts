import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerConfigService } from '@core/services/workerConfig.service';
import { WorkerService } from '@core/services/worker.service';

@injectable()
export class ViewShowMessageOnCallUseCase {
  constructor(
    private readonly workerConfigService: WorkerConfigService,
    private readonly workerService: WorkerService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    isAdministrator: boolean,
    workerId: string
  ): Promise<{ show_message_on_call: string | null }> {
    const existsWorkerById = await this.workerService.existsWorkerById(
      isAdministrator,
      accountId,
      workerId
    );

    if (!existsWorkerById) {
      throw new Error(t('worker_not_found'));
    }

    const result =
      await this.workerConfigService.viewShowMessageOnCall(workerId);

    return {
      show_message_on_call: result,
    };
  }
}
