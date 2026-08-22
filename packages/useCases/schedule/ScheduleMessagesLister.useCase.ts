import { injectable, inject } from 'tsyringe';
import { ScheduleMessagesListerRepository } from '@core/repositories/schedule/ScheduleMessagesLister.repository';
import { ListScheduleMessagesRequest } from '@core/schema/schedule/listScheduleMessages/request.schema';
import { ListScheduleMessagesResponse } from '@core/schema/schedule/listScheduleMessages/response.schema';
import { setPaginationData } from '@core/common/functions/createPaginationData';
import { ScheduleService } from '@core/services/schedule.service';
import { TFunction } from 'i18next';
import {
  assertUserChannelAccess,
  UserChannelScope,
} from '@core/common/functions/assertUserChannelAccess';

@injectable()
export class ScheduleMessagesListerUseCase {
  constructor(
    @inject(ScheduleMessagesListerRepository)
    private readonly scheduleMessagesListerRepository: ScheduleMessagesListerRepository,
    @inject(ScheduleService)
    private readonly scheduleService: ScheduleService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    query: ListScheduleMessagesRequest,
    accountId: string,
    userChannels: UserChannelScope = []
  ): Promise<ListScheduleMessagesResponse | null> {
    const schedule = await this.scheduleService.findScheduleControlById(
      query.schedule_id,
      accountId
    );
    if (!schedule) {
      throw new Error(t('schedule_not_found'));
    }

    assertUserChannelAccess(t, schedule.worker_id, userChannels);

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
