import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerConfigService } from '@core/services/workerConfig.service';
import { WorkerService } from '@core/services/worker.service';
import { UpdateStartProtocolTextRequest } from '@core/schema/worker/updateStartProtocolText/request.schema';

@injectable()
export class UpdateStartProtocolTextUseCase {
  constructor(
    private readonly workerConfigService: WorkerConfigService,
    private readonly workerService: WorkerService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    workerId: string,
    body: UpdateStartProtocolTextRequest
  ): Promise<{ generate_protocol_at_start: string | null }> {
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
      text
    );

    return {
      generate_protocol_at_start: result,
    };
  }
}
