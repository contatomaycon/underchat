import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerConfigService } from '@core/services/workerConfig.service';
import { WorkerService } from '@core/services/worker.service';
import { UpdateShowMessageOnCallRequest } from '@core/schema/worker/updateShowMessageOnCall/request.schema';
import { assertNonOfficialRuntimeFeature } from '@core/common/functions/workerOfficialCapabilities';

@injectable()
export class UpdateShowMessageOnCallUseCase {
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
    body: UpdateShowMessageOnCallRequest
  ): Promise<{
    show_message_on_call: string | null;
    enabled: boolean;
  }> {
    const worker = await this.workerService.viewWorker(accountId, workerId);

    if (!worker) {
      throw new Error(t('worker_not_found'));
    }

    assertNonOfficialRuntimeFeature(
      worker.type?.id,
      t('whatsapp_official_runtime_action_not_supported')
    );

    const text = body.text?.trim() || null;

    const result = await this.workerConfigService.updateShowMessageOnCall(
      workerId,
      text,
      body.enabled
    );

    return result;
  }
}
