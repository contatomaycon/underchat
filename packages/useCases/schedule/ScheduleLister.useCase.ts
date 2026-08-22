import { injectable, inject } from 'tsyringe';
import { setPaginationData } from '@core/common/functions/createPaginationData';
import { ListScheduleFinalResponse } from '@core/schema/schedule/listSchedule/response.schema';
import { ScheduleService } from '@core/services/schedule.service';
import { ListScheduleRequest } from '@core/schema/schedule/listSchedule/request.schema';
import { UserChannelScope } from '@core/common/functions/assertUserChannelAccess';

@injectable()
export class ScheduleListerUseCase {
  constructor(
    @inject(ScheduleService)
    private readonly scheduleService: ScheduleService
  ) {}

  async execute(
    query: ListScheduleRequest,
    accountId: string,
    userChannels: UserChannelScope = []
  ): Promise<ListScheduleFinalResponse> {
    const perPage = query.per_page ?? 10;
    const currentPage = query.current_page ?? 1;

    const [results, total] = await this.scheduleService.listSchedules(
      perPage,
      currentPage,
      query,
      accountId,
      userChannels.length > 0
        ? userChannels.map((channel) => channel.id)
        : undefined
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
