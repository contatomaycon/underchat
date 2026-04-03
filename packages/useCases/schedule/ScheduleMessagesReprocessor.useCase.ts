import { inject, injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { ScheduleService } from '@core/services/schedule.service';
import { ScheduleSendService } from '@core/services/scheduleSend.service';
import { EScheduleStatus } from '@core/common/enums/EScheduleStatus';

@injectable()
export class ScheduleMessagesReprocessorUseCase {
  constructor(
    @inject(ScheduleService)
    private readonly scheduleService: ScheduleService,
    @inject(ScheduleSendService)
    private readonly scheduleSendService: ScheduleSendService
  ) {}

  private async validateScheduleForReprocess(
    t: TFunction<'translation', undefined>,
    scheduleId: string,
    accountId: string
  ): Promise<void> {
    const schedule = await this.scheduleService.findScheduleControlById(
      scheduleId,
      accountId
    );

    if (!schedule) {
      throw new Error(t('schedule_not_found'));
    }

    if (schedule.status === EScheduleStatus.processing) {
      throw new Error(t('schedule_reprocess_schedule_processing'));
    }
  }

  async reprocessFailedMessages(
    t: TFunction<'translation', undefined>,
    scheduleId: string,
    accountId: string
  ): Promise<{
    total: number;
    reprocessed: number;
  }> {
    await this.validateScheduleForReprocess(t, scheduleId, accountId);

    const result = await this.scheduleSendService.reprocessFailedMessages(
      scheduleId,
      accountId
    );

    if (result.total === 0) {
      throw new Error(t('schedule_reprocess_no_failed_messages'));
    }

    return result;
  }

  async reprocessMessage(
    t: TFunction<'translation', undefined>,
    scheduleId: string,
    messageId: string,
    accountId: string
  ): Promise<boolean> {
    await this.validateScheduleForReprocess(t, scheduleId, accountId);

    const result = await this.scheduleSendService.reprocessScheduleMessage(
      scheduleId,
      messageId,
      accountId
    );

    if (!result) {
      throw new Error(t('schedule_reprocess_message_not_allowed'));
    }

    return true;
  }
}
