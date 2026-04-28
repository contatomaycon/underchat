import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerConfigService } from '@core/services/workerConfig.service';
import { WorkerService } from '@core/services/worker.service';
import { UpdateTypingSimulationRequest } from '@core/schema/worker/updateTypingSimulation/request.schema';
import { ITypingSimulationConfig } from '@core/common/interfaces/ITypingSimulationConfig';

@injectable()
export class UpdateTypingSimulationUseCase {
  constructor(
    @inject(WorkerConfigService)
    private readonly workerConfigService: WorkerConfigService,
    @inject(WorkerService)
    private readonly workerService: WorkerService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    workerId: string,
    body: UpdateTypingSimulationRequest
  ): Promise<ITypingSimulationConfig> {
    const existsWorkerById = await this.workerService.existsWorkerById(
      accountId,
      workerId
    );

    if (!existsWorkerById) {
      throw new Error(t('worker_not_found'));
    }

    return this.workerConfigService.updateTypingSimulation(
      workerId,
      body.speed,
      body.enabled
    );
  }
}
