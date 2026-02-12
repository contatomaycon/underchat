import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerConfigService } from '@core/services/workerConfig.service';
import { WorkerService } from '@core/services/worker.service';
import { UpdateStartProtocolTextRequest } from '@core/schema/worker/updateStartProtocolText/request.schema';

@injectable()
export class UpdateStartProtocolTextUseCase {
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
    body: UpdateStartProtocolTextRequest
  ): Promise<{
    generate_protocol_at_start: string | null;
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

    const result = await this.workerConfigService.updateStartProtocolText(
      workerId,
      text,
      body.enabled
    );

    return result;
  }
}
