import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerConfigService } from '@core/services/workerConfig.service';
import { WorkerService } from '@core/services/worker.service';
import { SectorService } from '@core/services/sector.service';
import { UpdateAttendanceHoursRequest } from '@core/schema/worker/updateAttendanceHours/request.schema';
import {
  ATTENDANCE_HOURS_DEFAULT_TIMEZONE,
  isAttendanceDayWindowValid,
  hasAtLeastOneEnabledAttendanceDay,
} from '@core/common/functions/attendanceHoursConfig';
import { IAttendanceHoursConfig } from '@core/common/interfaces/IAttendanceHours';

@injectable()
export class UpdateAttendanceHoursUseCase {
  constructor(
    @inject(WorkerConfigService)
    private readonly workerConfigService: WorkerConfigService,
    @inject(WorkerService)
    private readonly workerService: WorkerService,
    @inject(SectorService)
    private readonly sectorService: SectorService
  ) {}

  private buildAttendanceHoursConfig(
    body: UpdateAttendanceHoursRequest
  ): IAttendanceHoursConfig {
    const outsideHoursAction = body.outside_hours_action;
    const destinationStatus = body.message_only_destination_status;

    const shouldUseQueueSector =
      outsideHoursAction === 'message_only' && destinationStatus === 'queue';

    const queueSectorId = shouldUseQueueSector
      ? body.message_only_queue_sector_id?.trim() || null
      : null;

    return {
      timezone: ATTENDANCE_HOURS_DEFAULT_TIMEZONE,
      outside_hours_action: outsideHoursAction,
      message_only_destination_status: destinationStatus,
      message_only_queue_sector_id: queueSectorId,
      days: {
        monday: body.days.monday,
        tuesday: body.days.tuesday,
        wednesday: body.days.wednesday,
        thursday: body.days.thursday,
        friday: body.days.friday,
        saturday: body.days.saturday,
        sunday: body.days.sunday,
      },
    };
  }

  private validateEnabledConfig(
    t: TFunction<'translation', undefined>,
    config: IAttendanceHoursConfig
  ): void {
    if (!hasAtLeastOneEnabledAttendanceDay(config)) {
      throw new Error(t('attendance_hours_at_least_one_day_required'));
    }

    const weekdays = Object.keys(config.days) as Array<
      keyof typeof config.days
    >;

    for (const weekday of weekdays) {
      const dayConfig = config.days[weekday];
      if (!isAttendanceDayWindowValid(dayConfig)) {
        throw new Error(
          t('attendance_hours_invalid_day_window', {
            day: t(weekday),
          })
        );
      }
    }
  }

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    workerId: string,
    body: UpdateAttendanceHoursRequest
  ): Promise<{
    attendance_hours: IAttendanceHoursConfig;
    outside_hours_message: string | null;
    enabled: boolean;
  }> {
    const existsWorkerById = await this.workerService.existsWorkerById(
      accountId,
      workerId
    );

    if (!existsWorkerById) {
      throw new Error(t('worker_not_found'));
    }

    const attendanceConfig = this.buildAttendanceHoursConfig(body);

    if (
      attendanceConfig.outside_hours_action === 'message_only' &&
      attendanceConfig.message_only_destination_status === 'queue' &&
      !attendanceConfig.message_only_queue_sector_id
    ) {
      throw new Error(t('attendance_hours_queue_sector_required'));
    }

    if (attendanceConfig.message_only_queue_sector_id) {
      const sector = await this.sectorService.viewSectorById(
        attendanceConfig.message_only_queue_sector_id,
        accountId
      );

      if (!sector) {
        throw new Error(t('sector_not_found'));
      }
    }

    if (body.enabled) {
      this.validateEnabledConfig(t, attendanceConfig);
    }

    const text = body.text === undefined ? null : body.text.trim();

    return this.workerConfigService.updateAttendanceHours(
      workerId,
      attendanceConfig,
      text,
      body.enabled
    );
  }
}
