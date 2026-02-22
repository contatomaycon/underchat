import * as schema from '@core/models';
import { schedule } from '@core/models';
import { EScheduleStatus } from '@core/common/enums/EScheduleStatus';
import { and, eq, inArray } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { currentTime } from '@core/common/functions/currentTime';

@injectable()
export class ScheduleStatusUpdaterRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  updateScheduleStatus = async (
    scheduleId: string,
    status: EScheduleStatus
  ): Promise<boolean> => {
    const result = await this.dbRw
      .update(schedule)
      .set({
        status,
        updated_at: currentTime(),
      })
      .where(eq(schedule.schedule_id, scheduleId))
      .execute();

    return result.rowCount === 1;
  };

  updateScheduleStatusIfCurrent = async (
    scheduleId: string,
    status: EScheduleStatus,
    currentStatuses: EScheduleStatus[]
  ): Promise<boolean> => {
    if (!currentStatuses.length) {
      return false;
    }

    const result = await this.dbRw
      .update(schedule)
      .set({
        status,
        updated_at: currentTime(),
      })
      .where(
        and(
          eq(schedule.schedule_id, scheduleId),
          inArray(schedule.status, currentStatuses)
        )
      )
      .execute();

    return result.rowCount === 1;
  };
}
