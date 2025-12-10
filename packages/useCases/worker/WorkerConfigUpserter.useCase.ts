import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerConfigService } from '@core/services/workerConfig.service';
import { WorkerService } from '@core/services/worker.service';
import { WorkerConfig } from '@core/schema/worker/updateWorkerConfig/response.schema';
import { UpdateWorkerConfigRequest } from '@core/schema/worker/updateWorkerConfig/request.schema';

@injectable()
export class WorkerConfigUpserterUseCase {
  constructor(
    private readonly workerConfigService: WorkerConfigService,
    private readonly workerService: WorkerService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    workerId: string,
    body: UpdateWorkerConfigRequest
  ): Promise<WorkerConfig> {
    const existsWorkerById = await this.workerService.existsWorkerById(
      accountId,
      workerId
    );

    if (!existsWorkerById) {
      throw new Error(t('worker_not_found'));
    }

    return this.workerConfigService.upsertWorkerConfig(t, workerId, body);
  }
}
