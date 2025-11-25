import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerConfigService } from '@core/services/workerConfig.service';
import { WorkerService } from '@core/services/worker.service';
import { UpdateUraProtocolTextRequest } from '@core/schema/worker/updateUraProtocolText/request.schema';

@injectable()
export class UpdateUraProtocolTextUseCase {
  constructor(
    private readonly workerConfigService: WorkerConfigService,
    private readonly workerService: WorkerService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    isAdministrator: boolean,
    workerId: string,
    body: UpdateUraProtocolTextRequest
  ): Promise<{ generate_protocol_at_ura: string | null }> {
    const existsWorkerById = await this.workerService.existsWorkerById(
      isAdministrator,
      accountId,
      workerId
    );

    if (!existsWorkerById) {
      throw new Error(t('worker_not_found'));
    }

    const text = body.text?.trim() || null;
    const result = await this.workerConfigService.updateUraProtocolText(
      workerId,
      text
    );

    return {
      generate_protocol_at_ura: result,
    };
  }
}
