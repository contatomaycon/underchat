import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerConfigService } from '@core/services/workerConfig.service';
import { WorkerService } from '@core/services/worker.service';
import { UpdateSimultaneousAttendanceRequest } from '@core/schema/worker/updateSimultaneousAttendance/request.schema';

@injectable()
export class UpdateSimultaneousAttendanceUseCase {
  constructor(
    private readonly workerConfigService: WorkerConfigService,
    private readonly workerService: WorkerService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    workerId: string,
    body: UpdateSimultaneousAttendanceRequest
  ): Promise<{ simultaneous_attendance: number | null }> {
    const existsWorkerById = await this.workerService.existsWorkerById(
      accountId,
      workerId
    );

    if (!existsWorkerById) {
      throw new Error(t('worker_not_found'));
    }

    const quantity = body.quantity || null;
    const result = await this.workerConfigService.updateSimultaneousAttendance(
      workerId,
      quantity
    );

    return {
      simultaneous_attendance: result,
    };
  }
}
