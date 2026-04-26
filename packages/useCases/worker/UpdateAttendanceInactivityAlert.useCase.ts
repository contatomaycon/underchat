import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerConfigService } from '@core/services/workerConfig.service';
import { WorkerService } from '@core/services/worker.service';
import { UpdateAttendanceInactivityAlertRequest } from '@core/schema/worker/updateAttendanceInactivityAlert/request.schema';
import { IAttendanceInactivityAlertConfig } from '@core/common/interfaces/IAttendanceInactivityAlert';

@injectable()
export class UpdateAttendanceInactivityAlertUseCase {
  constructor(
    @inject(WorkerConfigService)
    private readonly workerConfigService: WorkerConfigService,
    @inject(WorkerService)
    private readonly workerService: WorkerService
  ) {}

  private buildConfig(
    body: UpdateAttendanceInactivityAlertRequest
  ): IAttendanceInactivityAlertConfig {
    return {
      quantity: body.quantity,
      time: body.time,
      action: body.action,
      inactivity_message_enabled: body.inactivity_message_enabled,
      inactivity_message:
        typeof body.inactivity_message === 'string'
          ? body.inactivity_message.trim() || null
          : null,
    };
  }

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    workerId: string,
    body: UpdateAttendanceInactivityAlertRequest
  ): Promise<{
    quantity: number;
    time: number;
    action: 'finish';
    inactivity_message_enabled: boolean;
    inactivity_message: string | null;
    enabled: boolean;
  }> {
    const existsWorkerById = await this.workerService.existsWorkerById(
      accountId,
      workerId
    );

    if (!existsWorkerById) {
      throw new Error(t('worker_not_found'));
    }

    if (!Number.isInteger(body.quantity) || body.quantity < 1) {
      throw new Error(t('attendance_inactivity_alert_invalid_quantity'));
    }

    if (!Number.isInteger(body.time) || body.time < 1) {
      throw new Error(t('attendance_inactivity_alert_invalid_time'));
    }

    if (body.action !== 'finish') {
      throw new Error(t('attendance_inactivity_alert_invalid_action'));
    }

    return this.workerConfigService.updateAttendanceInactivityAlert(
      workerId,
      this.buildConfig(body),
      body.enabled
    );
  }
}
