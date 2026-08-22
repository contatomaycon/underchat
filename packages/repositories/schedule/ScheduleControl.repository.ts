import * as schema from '@core/models';
import { schedule } from '@core/models';
import { EScheduleStatus } from '@core/common/enums/EScheduleStatus';
import { IScheduleControlData } from '@core/common/interfaces/IScheduleControlData';
import { and, eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { currentTime } from '@core/common/functions/currentTime';

@injectable()
export class ScheduleControlRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>,
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  findByIdAndAccount = async (
    scheduleId: string,
    accountId: string
  ): Promise<IScheduleControlData | null> => {
    const result = await this.dbRo
      .select({
        schedule_id: schedule.schedule_id,
        account_id: schedule.account_id,
        worker_id: schedule.worker_id,
        status: schedule.status,
        send_date: schedule.send_date,
      })
      .from(schedule)
      .where(
        and(
          eq(schedule.schedule_id, scheduleId),
          eq(schedule.account_id, accountId)
        )
      )
      .limit(1)
      .execute();

    if (!result.length) {
      return null;
    }

    return {
      schedule_id: result[0].schedule_id,
      account_id: result[0].account_id,
      worker_id: result[0].worker_id,
      status: result[0].status as EScheduleStatus,
      send_date: result[0].send_date,
    };
  };

  getScheduleStatusById = async (
    scheduleId: string
  ): Promise<EScheduleStatus | null> => {
    const result = await this.dbRo
      .select({
        status: schedule.status,
      })
      .from(schedule)
      .where(eq(schedule.schedule_id, scheduleId))
      .limit(1)
      .execute();

    if (!result.length) {
      return null;
    }

    return result[0].status as EScheduleStatus;
  };

  startScheduleNow = async (scheduleId: string): Promise<boolean> => {
    const result = await this.dbRw
      .update(schedule)
      .set({
        status: EScheduleStatus.processing,
        send_date: new Date().toISOString(),
        updated_at: currentTime(),
      })
      .where(eq(schedule.schedule_id, scheduleId))
      .execute();

    return result.rowCount === 1;
  };

  pauseSchedule = async (scheduleId: string): Promise<boolean> => {
    const result = await this.dbRw
      .update(schedule)
      .set({
        status: EScheduleStatus.paused,
        updated_at: currentTime(),
      })
      .where(eq(schedule.schedule_id, scheduleId))
      .execute();

    return result.rowCount === 1;
  };

  cancelSchedule = async (scheduleId: string): Promise<boolean> => {
    const result = await this.dbRw
      .update(schedule)
      .set({
        status: EScheduleStatus.canceled,
        updated_at: currentTime(),
      })
      .where(eq(schedule.schedule_id, scheduleId))
      .execute();

    return result.rowCount === 1;
  };
}
