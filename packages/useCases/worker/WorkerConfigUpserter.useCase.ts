import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerConfigService } from '@core/services/workerConfig.service';
import { WorkerService } from '@core/services/worker.service';
import { IUpdateWorkerConfig } from '@core/common/interfaces/IUpdateWorkerConfig';
import { WorkerConfig } from '@core/schema/worker/updateWorkerConfig/response.schema';
import { UpdateWorkerConfigRequest } from '@core/schema/worker/updateWorkerConfig/request.schema';
import {
  hasOfficialCoexistenceUnsupportedConfigFields,
  isOfficialWhatsappWorker,
} from '@core/common/functions/workerOfficialCapabilities';

@injectable()
export class WorkerConfigUpserterUseCase {
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
    body: UpdateWorkerConfigRequest
  ): Promise<WorkerConfig> {
    const worker = await this.workerService.viewWorker(accountId, workerId);

    if (!worker) {
      throw new Error(t('worker_not_found'));
    }

    if (
      isOfficialWhatsappWorker(worker.type?.id) &&
      hasOfficialCoexistenceUnsupportedConfigFields(
        body as Record<string, unknown>
      )
    ) {
      throw new Error(t('whatsapp_official_runtime_action_not_supported'));
    }

    return this.workerConfigService.upsertWorkerConfig(
      t,
      accountId,
      workerId,
      body as IUpdateWorkerConfig
    );
  }
}
