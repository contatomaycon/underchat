import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerConfigService } from '@core/services/workerConfig.service';
import { WorkerService } from '@core/services/worker.service';
import { UpdateSecurityKeyRequest } from '@core/schema/worker/updateSecurityKey/request.schema';
import { ISecurityKeyConfig } from '@core/common/interfaces/ISecurityKeyConfig';

@injectable()
export class UpdateSecurityKeyUseCase {
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
    body: UpdateSecurityKeyRequest
  ): Promise<ISecurityKeyConfig> {
    const existsWorkerById = await this.workerService.existsWorkerById(
      accountId,
      workerId
    );

    if (!existsWorkerById) {
      throw new Error(t('worker_not_found'));
    }

    try {
      return await this.workerConfigService.updateSecurityKey(workerId, body);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'security_key_requires_active_option'
      ) {
        throw new Error(t('security_key_requires_active_option'));
      }

      throw error;
    }
  }
}
