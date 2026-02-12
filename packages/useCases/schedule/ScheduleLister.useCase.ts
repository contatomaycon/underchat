import { injectable, inject } from 'tsyringe';
import { setPaginationData } from '@core/common/functions/createPaginationData';
import { ListScheduleFinalResponse } from '@core/schema/schedule/listSchedule/response.schema';
import { ScheduleService } from '@core/services/schedule.service';
import { ListScheduleRequest } from '@core/schema/schedule/listSchedule/request.schema';

@injectable()
export class ScheduleListerUseCase {
  constructor(
    @inject(ScheduleService)
    private readonly scheduleService: ScheduleService
  ) {}

  async execute(
    query: ListScheduleRequest,
    accountId: string
  ): Promise<ListScheduleFinalResponse> {
    const perPage = query.per_page ?? 10;
    const currentPage = query.current_page ?? 1;

    const [results, total] = await this.scheduleService.listSchedules(
      perPage,
      currentPage,
      query,
      accountId
    );

    const pagings = setPaginationData(
      results.length,
      total,
      perPage,
      currentPage
    );

    return {
      pagings,
      results,
    };
  }
}
