import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerConfigService } from '@core/services/workerConfig.service';
import { WorkerService } from '@core/services/worker.service';
import { UpdateTransferProtocolTextRequest } from '@core/schema/worker/updateTransferProtocolText/request.schema';

@injectable()
export class UpdateTransferProtocolTextUseCase {
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
    body: UpdateTransferProtocolTextRequest
  ): Promise<{
    generate_protocol_at_transfer: string | null;
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

    const result = await this.workerConfigService.updateTransferProtocolText(
      workerId,
      text,
      body.enabled
    );

    return result;
  }
}
