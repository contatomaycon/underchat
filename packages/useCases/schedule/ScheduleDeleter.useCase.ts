import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { ScheduleService } from '@core/services/schedule.service';

@injectable()
export class ScheduleDeleterUseCase {
  constructor(private readonly scheduleService: ScheduleService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    scheduleId: string
  ): Promise<boolean> {
    const scheduleExists =
      await this.scheduleService.existsScheduleById(scheduleId);

    if (!scheduleExists) {
      throw new Error(t('schedule_not_found'));
    }

    return this.scheduleService.deleteScheduleById(scheduleId);
  }
}
