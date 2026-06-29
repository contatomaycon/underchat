import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerConfigService } from '@core/services/workerConfig.service';
import { WorkerService } from '@core/services/worker.service';
import { ITypingSimulationConfig } from '@core/common/interfaces/ITypingSimulationConfig';
import { assertNonOfficialRuntimeFeature } from '@core/common/functions/workerOfficialCapabilities';

@injectable()
export class ViewTypingSimulationUseCase {
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
  ): Promise<ITypingSimulationConfig> {
    const worker = await this.workerService.viewWorker(accountId, workerId);

    if (!worker) {
      throw new Error(t('worker_not_found'));
    }

    assertNonOfficialRuntimeFeature(
      worker.type?.id,
      t('whatsapp_official_runtime_action_not_supported')
    );

    return this.workerConfigService.viewTypingSimulation(workerId);
  }
}
