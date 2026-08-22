import { injectable, inject } from 'tsyringe';
import { ScheduleService } from '@core/services/schedule.service';
import { ListScheduleWorkersFinalResponse } from '@core/schema/schedule/listScheduleWorkers/response.schema';

@injectable()
export class ScheduleWorkersListerUseCase {
  constructor(
    @inject(ScheduleService)
    private readonly scheduleService: ScheduleService
  ) {}

  async execute(
    accountId: string,
    userChannels: { id: string; name: string }[] = []
  ): Promise<ListScheduleWorkersFinalResponse> {
    const workers = await this.scheduleService.listScheduleWorkers(accountId);

    if (userChannels.length === 0) {
      return workers;
    }

    const allowedWorkerIds = new Set(userChannels.map((channel) => channel.id));

    return workers.filter((worker) => allowedWorkerIds.has(worker.worker_id));
  }
}
