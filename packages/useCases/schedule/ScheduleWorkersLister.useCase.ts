import { injectable, inject } from 'tsyringe';
import { ScheduleService } from '@core/services/schedule.service';
import { ListScheduleWorkersFinalResponse } from '@core/schema/schedule/listScheduleWorkers/response.schema';

@injectable()
export class ScheduleWorkersListerUseCase {
  constructor(
    @inject(ScheduleService)
    private readonly scheduleService: ScheduleService
  ) {}

  async execute(accountId: string): Promise<ListScheduleWorkersFinalResponse> {
    return this.scheduleService.listScheduleWorkers(accountId);
  }
}
