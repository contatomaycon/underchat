import * as schema from '@core/models';
import { schedule, account, worker, chatbot } from '@core/models';
import { EScheduleStatus } from '@core/common/enums/EScheduleStatus';
import { and, desc, eq, lte, or } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { ISchedulePendingData } from '@core/interfaces/repositories/schedule/ISchedulePendingData';

@injectable()
export class SchedulePendingListerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  listPendingSchedules = async (): Promise<ISchedulePendingData[]> => {
    const now = new Date().toISOString();

    const result = await this.dbRo
      .select({
        schedule_id: schedule.schedule_id,
        account_id: schedule.account_id,
        account_name: account.name,
        worker_id: schedule.worker_id,
        worker_name: worker.name,
        type: schedule.type,
        send_to: schedule.send_to,
        send_speed: schedule.send_speed,
        chatbot_id: schedule.chatbot_id,
        chatbot_name: chatbot.name,
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
      .leftJoin(chatbot, eq(schedule.chatbot_id, chatbot.chatbot_id))
      .where(
        and(
          or(
            eq(schedule.status, EScheduleStatus.pending),
            eq(schedule.status, EScheduleStatus.processing)
          ),
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
      send_speed: item.send_speed ?? 'low',
      chatbot_id: item.chatbot_id ?? null,
      chatbot_name: item.chatbot_name ?? null,
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
