import * as schema from '@core/models';
import { schedule, account, worker, chatbot } from '@core/models';
import { EScheduleStatus } from '@core/common/enums/EScheduleStatus';
import { and, desc, eq, inArray, lte } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { ISchedulePendingData } from '@core/interfaces/repositories/schedule/ISchedulePendingData';

@injectable()
export class SchedulePendingListerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>,
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  private buildBaseQuery(
    db: NodePgDatabase<typeof schema>,
    now: string,
    scheduleId?: string
  ) {
    const statusCondition = inArray(schedule.status, [
      EScheduleStatus.pending,
      EScheduleStatus.processing,
    ]);
    const whereCondition = scheduleId
      ? and(
          statusCondition,
          lte(schedule.send_date, now),
          eq(schedule.schedule_id, scheduleId)
        )
      : and(statusCondition, lte(schedule.send_date, now));

    return db
      .select({
        schedule_id: schedule.schedule_id,
        account_id: schedule.account_id,
        account_name: account.name,
        worker_id: schedule.worker_id,
        worker_name: worker.name,
        worker_type_id: worker.worker_type_id,
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
        official_template: schedule.official_template,
        send_date: schedule.send_date,
      })
      .from(schedule)
      .leftJoin(account, eq(schedule.account_id, account.account_id))
      .leftJoin(worker, eq(schedule.worker_id, worker.worker_id))
      .leftJoin(chatbot, eq(schedule.chatbot_id, chatbot.chatbot_id))
      .where(whereCondition)
      .orderBy(desc(schedule.created_at));
  }

  private mapResultToPending(item: {
    schedule_id: string;
    account_id: string;
    account_name: string | null;
    worker_id: string;
    worker_name: string | null;
    worker_type_id: string | null;
    type: string;
    send_to: string;
    send_speed: string | null;
    chatbot_id: string | null;
    chatbot_name: string | null;
    message: string | null;
    url: string | null;
    mimetype: string | null;
    duration: number | null;
    width: number | null;
    height: number | null;
    official_template: ISchedulePendingData['official_template'];
    send_date: string;
  }): ISchedulePendingData {
    return {
      schedule_id: item.schedule_id,
      account_id: item.account_id,
      account_name: item.account_name ?? '',
      worker_id: item.worker_id,
      worker_name: item.worker_name ?? '',
      worker_type_id: item.worker_type_id ?? null,
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
      official_template: item.official_template ?? null,
      send_date: item.send_date,
    };
  }

  listPendingSchedules = async (): Promise<ISchedulePendingData[]> => {
    const now = new Date().toISOString();

    const result = await this.buildBaseQuery(this.dbRo, now).execute();

    return result.map((item) => this.mapResultToPending(item));
  };

  listPendingScheduleById = async (
    scheduleId: string
  ): Promise<ISchedulePendingData | null> => {
    const now = new Date().toISOString();

    const result = await this.buildBaseQuery(this.dbRw, now, scheduleId)
      .limit(1)
      .execute();

    if (!result.length) {
      return null;
    }

    return this.mapResultToPending(result[0]);
  };

  viewScheduleById = async (
    scheduleId: string
  ): Promise<ISchedulePendingData | null> => {
    const result = await this.dbRw
      .select({
        schedule_id: schedule.schedule_id,
        account_id: schedule.account_id,
        account_name: account.name,
        worker_id: schedule.worker_id,
        worker_name: worker.name,
        worker_type_id: worker.worker_type_id,
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
        official_template: schedule.official_template,
        send_date: schedule.send_date,
      })
      .from(schedule)
      .leftJoin(account, eq(schedule.account_id, account.account_id))
      .leftJoin(worker, eq(schedule.worker_id, worker.worker_id))
      .leftJoin(chatbot, eq(schedule.chatbot_id, chatbot.chatbot_id))
      .where(eq(schedule.schedule_id, scheduleId))
      .limit(1)
      .execute();

    if (!result.length) {
      return null;
    }

    return this.mapResultToPending(result[0]);
  };
}
