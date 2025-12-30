import * as schema from '@core/models';
import { schedule } from '@core/models';
import { EScheduleStatus } from '@core/common/enums/EScheduleStatus';
import { eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { currentTime } from '@core/common/functions/currentTime';

@injectable()
export class ScheduleStatusUpdaterRepository {
  constructor(
    @inject('DatabaseRw') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  updateScheduleStatus = async (
    scheduleId: string,
    status: EScheduleStatus
  ): Promise<boolean> => {
    const result = await this.db
      .update(schedule)
      .set({
        status,
        updated_at: currentTime(),
      })
      .where(eq(schedule.schedule_id, scheduleId))
      .execute();

    return result.rowCount === 1;
  };
}
