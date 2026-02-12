import { injectable, inject } from 'tsyringe';
import { ScheduleService } from '@core/services/schedule.service';
import { ListScheduleContactGroupsFinalResponse } from '@core/schema/schedule/listScheduleContactGroups/response.schema';

@injectable()
export class ScheduleContactGroupsListerUseCase {
  constructor(
    @inject(ScheduleService)
    private readonly scheduleService: ScheduleService
  ) {}

  async execute(
    accountId: string
  ): Promise<ListScheduleContactGroupsFinalResponse> {
    return this.scheduleService.listScheduleContactGroups(accountId);
  }
}
