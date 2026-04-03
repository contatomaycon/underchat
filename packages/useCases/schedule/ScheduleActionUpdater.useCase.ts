import { EScheduleAction } from '@core/common/enums/EScheduleAction';
import { EScheduleStatus } from '@core/common/enums/EScheduleStatus';
import { ScheduleService } from '@core/services/schedule.service';
import { ScheduleSendService } from '@core/services/scheduleSend.service';
import { TFunction } from 'i18next';
import { inject, injectable } from 'tsyringe';

const START_ALLOWED_STATUSES: EScheduleStatus[] = [
  EScheduleStatus.pending,
  EScheduleStatus.paused,
  EScheduleStatus.processing,
  EScheduleStatus.canceled,
];

const PAUSE_ALLOWED_STATUSES: EScheduleStatus[] = [
  EScheduleStatus.pending,
  EScheduleStatus.processing,
  EScheduleStatus.paused,
];

const CANCEL_ALLOWED_STATUSES: EScheduleStatus[] = [
  EScheduleStatus.pending,
  EScheduleStatus.processing,
  EScheduleStatus.paused,
  EScheduleStatus.canceled,
];

@injectable()
export class ScheduleActionUpdaterUseCase {
  constructor(
    @inject(ScheduleService)
    private readonly scheduleService: ScheduleService,
    @inject(ScheduleSendService)
    private readonly scheduleSendService: ScheduleSendService
  ) {}

  private triggerImmediateProcessing(scheduleId: string): void {
    this.scheduleSendService
      .processScheduleById(scheduleId)
      .catch((error: unknown) => {
        console.error(
          `[ScheduleActionUpdaterUseCase] Error processing schedule ${scheduleId} after start:`,
          error
        );
      });
  }

  private ensureActionAllowed(
    t: TFunction<'translation', undefined>,
    status: EScheduleStatus,
    action: EScheduleAction
  ): void {
    if (action === EScheduleAction.start) {
      if (START_ALLOWED_STATUSES.includes(status)) {
        return;
      }
      throw new Error(t('schedule_action_invalid_transition'));
    }

    if (action === EScheduleAction.pause) {
      if (PAUSE_ALLOWED_STATUSES.includes(status)) {
        return;
      }
      throw new Error(t('schedule_action_invalid_transition'));
    }

    if (action === EScheduleAction.cancel) {
      if (CANCEL_ALLOWED_STATUSES.includes(status)) {
        return;
      }
      throw new Error(t('schedule_action_invalid_transition'));
    }

    throw new Error(t('schedule_action_invalid'));
  }

  private async handleStartAction(scheduleId: string): Promise<boolean> {
    const updated = await this.scheduleService.startScheduleNow(scheduleId);

    if (!updated) {
      return false;
    }

    this.triggerImmediateProcessing(scheduleId);

    return true;
  }

  private async handlePauseAction(scheduleId: string): Promise<boolean> {
    return this.scheduleService.pauseSchedule(scheduleId);
  }

  private async handleCancelAction(scheduleId: string): Promise<boolean> {
    return this.scheduleService.cancelSchedule(scheduleId);
  }

  async execute(
    t: TFunction<'translation', undefined>,
    scheduleId: string,
    action: EScheduleAction,
    accountId: string
  ): Promise<boolean> {
    const schedule = await this.scheduleService.findScheduleControlById(
      scheduleId,
      accountId
    );

    if (!schedule) {
      throw new Error(t('schedule_not_found'));
    }

    this.ensureActionAllowed(t, schedule.status, action);

    if (
      action === EScheduleAction.start &&
      schedule.status === EScheduleStatus.processing
    ) {
      const updated = await this.scheduleService.startScheduleNow(scheduleId);
      if (!updated) {
        return false;
      }

      this.triggerImmediateProcessing(scheduleId);
      return true;
    }

    if (
      action === EScheduleAction.pause &&
      schedule.status === EScheduleStatus.paused
    ) {
      return true;
    }

    if (
      action === EScheduleAction.cancel &&
      schedule.status === EScheduleStatus.canceled
    ) {
      return true;
    }

    if (action === EScheduleAction.start) {
      return this.handleStartAction(scheduleId);
    }

    if (action === EScheduleAction.pause) {
      return this.handlePauseAction(scheduleId);
    }

    return this.handleCancelAction(scheduleId);
  }
}
