import { injectable } from 'tsyringe';
import { ScheduleService } from '@core/services/schedule.service';
import { ListScheduleContactGroupsFinalResponse } from '@core/schema/schedule/listScheduleContactGroups/response.schema';

@injectable()
export class ScheduleContactGroupsListerUseCase {
  constructor(private readonly scheduleService: ScheduleService) {}

  async execute(
    accountId: string
  ): Promise<ListScheduleContactGroupsFinalResponse> {
    return this.scheduleService.listScheduleContactGroups(accountId);
  }
}
