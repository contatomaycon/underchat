import * as schema from '@core/models';
import { schedule, account, worker } from '@core/models';
import { EScheduleStatus } from '@core/common/enums/EScheduleStatus';
import { and, desc, eq, lte } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { ISchedulePendingData } from '@core/interfaces/repositories/schedule/ISchedulePendingData';

@injectable()
export class SchedulePendingListerRepository {
  constructor(
    @inject('DatabaseRw') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  listPendingSchedules = async (): Promise<ISchedulePendingData[]> => {
    const now = new Date().toISOString();

    const result = await this.db
      .select({
        schedule_id: schedule.schedule_id,
        account_id: schedule.account_id,
        account_name: account.name,
        worker_id: schedule.worker_id,
        worker_name: worker.name,
        type: schedule.type,
        send_to: schedule.send_to,
        message: schedule.message,
        url: schedule.url,
        mimetype: schedule.mimetype,
        duration: schedule.duration,
        width: schedule.width,
        height: schedule.height,
        send_date: schedule.send_date,
      })
      .from(schedule)
      .leftJoin(account, eq(schedule.account_id, account.account_id))
      .leftJoin(worker, eq(schedule.worker_id, worker.worker_id))
      .where(
        and(
          eq(schedule.status, EScheduleStatus.pending),
          lte(schedule.send_date, now)
        )
      )
      .orderBy(desc(schedule.created_at))
      .execute();

    return result.map((item) => ({
      schedule_id: item.schedule_id,
      account_id: item.account_id,
      account_name: item.account_name ?? '',
      worker_id: item.worker_id,
      worker_name: item.worker_name ?? '',
      type: item.type,
      send_to: item.send_to,
      message: item.message,
      url: item.url,
      mimetype: item.mimetype,
      duration: item.duration,
      width: item.width,
      height: item.height,
      send_date: item.send_date,
    }));
  };
}
