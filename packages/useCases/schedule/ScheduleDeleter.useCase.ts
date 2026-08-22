import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { ScheduleService } from '@core/services/schedule.service';
import {
  assertUserChannelAccess,
  UserChannelScope,
} from '@core/common/functions/assertUserChannelAccess';

@injectable()
export class ScheduleDeleterUseCase {
  constructor(
    @inject(ScheduleService)
    private readonly scheduleService: ScheduleService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    scheduleId: string,
    accountId: string,
    userChannels: UserChannelScope = []
  ): Promise<boolean> {
    const schedule = await this.scheduleService.viewScheduleById(scheduleId);

    if (!schedule || schedule.account.account_id !== accountId) {
      throw new Error(t('schedule_not_found'));
    }

    assertUserChannelAccess(t, schedule.worker.worker_id, userChannels);

    return this.scheduleService.deleteScheduleById(scheduleId);
  }
}
