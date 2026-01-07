import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerConfigService } from '@core/services/workerConfig.service';
import { WorkerService } from '@core/services/worker.service';
import { UpdateTransferProtocolSectorTextRequest } from '@core/schema/worker/updateTransferProtocolSectorText/request.schema';

@injectable()
export class UpdateTransferProtocolSectorTextUseCase {
  constructor(
    private readonly workerConfigService: WorkerConfigService,
    private readonly workerService: WorkerService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    workerId: string,
    body: UpdateTransferProtocolSectorTextRequest
  ): Promise<{
    generate_protocol_at_transfer_sector: string | null;
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

    const result =
      await this.workerConfigService.updateTransferProtocolSectorText(
        workerId,
        text,
        body.enabled
      );

    return result;
  }
}
