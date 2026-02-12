import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { ViewScheduleResponse } from '@core/schema/schedule/viewSchedule/response.schema';
import { ScheduleService } from '@core/services/schedule.service';

@injectable()
export class ScheduleViewerUseCase {
  constructor(
    @inject(ScheduleService)
    private readonly scheduleService: ScheduleService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    scheduleId: string
  ): Promise<ViewScheduleResponse | null> {
    const scheduleExists =
      await this.scheduleService.existsScheduleById(scheduleId);

    if (!scheduleExists) {
      throw new Error(t('schedule_not_found'));
    }

    return this.scheduleService.viewScheduleById(scheduleId);
  }
}
