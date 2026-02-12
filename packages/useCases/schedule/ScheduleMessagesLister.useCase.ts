import { injectable, inject } from 'tsyringe';
import { ScheduleMessagesListerRepository } from '@core/repositories/schedule/ScheduleMessagesLister.repository';
import { ListScheduleMessagesRequest } from '@core/schema/schedule/listScheduleMessages/request.schema';
import { ListScheduleMessagesResponse } from '@core/schema/schedule/listScheduleMessages/response.schema';
import { setPaginationData } from '@core/common/functions/createPaginationData';

@injectable()
export class ScheduleMessagesListerUseCase {
  constructor(
    @inject(ScheduleMessagesListerRepository)
    private readonly scheduleMessagesListerRepository: ScheduleMessagesListerRepository
  ) {}

  async execute(
    query: ListScheduleMessagesRequest,
    accountId: string
  ): Promise<ListScheduleMessagesResponse | null> {
    const currentPage = query.current_page ?? 1;
    const perPage = query.per_page ?? 50;

    const [messages, total] =
      await this.scheduleMessagesListerRepository.listScheduleMessages(
        query.schedule_id,
        accountId,
        currentPage,
        perPage
      );

    const pagings = setPaginationData(
      messages.length,
      total,
      perPage,
      currentPage
    );

    return {
      results: messages,
      pagings,
    };
  }
}
