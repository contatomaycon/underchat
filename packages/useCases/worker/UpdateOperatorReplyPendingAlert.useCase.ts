import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerConfigService } from '@core/services/workerConfig.service';
import { WorkerService } from '@core/services/worker.service';
import { UpdateOperatorReplyPendingAlertRequest } from '@core/schema/worker/updateOperatorReplyPendingAlert/request.schema';
import { IOperatorReplyPendingAlertConfig } from '@core/common/interfaces/IOperatorReplyPendingAlertConfig';

@injectable()
export class UpdateOperatorReplyPendingAlertUseCase {
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
    body: UpdateOperatorReplyPendingAlertRequest
  ): Promise<IOperatorReplyPendingAlertConfig> {
    const existsWorkerById = await this.workerService.existsWorkerById(
      accountId,
      workerId
    );

    if (!existsWorkerById) {
      throw new Error(t('worker_not_found'));
    }

    if (!Number.isInteger(body.time_minutes) || body.time_minutes < 1) {
      throw new Error(t('operator_reply_pending_alert_invalid_time'));
    }

    return this.workerConfigService.updateOperatorReplyPendingAlert(workerId, {
      enabled: body.enabled,
      time_minutes: body.time_minutes,
    });
  }
}
