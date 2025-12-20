import { injectable } from 'tsyringe';
import { setPaginationData } from '@core/common/functions/createPaginationData';
import { ScheduleService } from '@core/services/schedule.service';
import { ListScheduleContactsRequest } from '@core/schema/schedule/listScheduleContacts/request.schema';
import { ListScheduleContactsFinalResponse } from '@core/schema/schedule/listScheduleContacts/response.schema';

@injectable()
export class ScheduleContactsListerUseCase {
  constructor(private readonly scheduleService: ScheduleService) {}

  async execute(
    query: ListScheduleContactsRequest,
    accountId: string
  ): Promise<ListScheduleContactsFinalResponse> {
    const perPage = query.per_page ?? 10;
    const currentPage = query.current_page ?? 1;

    const [results, total] = await this.scheduleService.listScheduleContacts(
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
