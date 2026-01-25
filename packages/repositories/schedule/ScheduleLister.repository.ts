import * as schema from '@core/models';
import { schedule, account, worker, chatbot } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import {
  and,
  asc,
  count,
  desc,
  eq,
  SQL,
  SQLWrapper,
  or,
  ilike,
} from 'drizzle-orm';
import { ESortOrder } from '@core/common/enums/ESortOrder';
import { EScheduleType } from '@core/common/enums/EScheduleType';
import { EScheduleSendTo } from '@core/common/enums/EScheduleSendTo';
import { ListScheduleResponse } from '@core/schema/schedule/listSchedule/response.schema';
import { ListScheduleRequest } from '@core/schema/schedule/listSchedule/request.schema';

@injectable()
export class ScheduleListerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  private readonly setOrders = (query: ListScheduleRequest): SQL[] => {
    const orders: SQL[] = [];
    const sort = query.sort_by;

    if (!sort?.length) {
      orders.push(desc(schedule.created_at));

      return orders;
    }

    for (const { key, order } of sort) {
      if (key === 'send_date') {
        orders.push(
          order === ESortOrder.asc
            ? asc(schedule.send_date)
            : desc(schedule.send_date)
        );
      }
      if (key === 'created_at') {
        orders.push(
          order === ESortOrder.asc
            ? asc(schedule.created_at)
            : desc(schedule.created_at)
        );
      }
    }

    return orders;
  };

  private readonly setFilters = (query: ListScheduleRequest): SQLWrapper[] => {
    const filters: SQLWrapper[] = [];

    if (query.search) {
      const conditions: (SQLWrapper | undefined)[] = [
        query.search ? ilike(schedule.message, `%${query.search}%`) : undefined,
      ];

      const combined = or(...conditions);

      if (combined) filters.push(combined);
    }

    if (query.type) {
      filters.push(eq(schedule.type, query.type as EScheduleType));
    }

    if (query.send_to) {
      filters.push(eq(schedule.send_to, query.send_to as EScheduleSendTo));
    }

    return filters;
  };

  private readonly mapToResponse = (item: {
    schedule_id: string;
    account: { account_id: string; name: string } | null;
    worker: { worker_id: string; name: string } | null;
    type: string;
    send_to: string;
    send_speed: string;
    chatbot_id: string | null;
    chatbot_name: string | null;
    message: string | null;
    url: string | null;
    mimetype: string | null;
    duration: number | null;
    width: number | null;
    height: number | null;
    send_date: string;
    status: string;
    created_at: string | null;
  }): ListScheduleResponse => {
    return {
      schedule_id: item.schedule_id,
      account: {
        account_id: item.account?.account_id ?? '',
        name: item.account?.name ?? '',
      },
      worker: {
        worker_id: item.worker?.worker_id ?? '',
        name: item.worker?.name ?? '',
      },
      type: item.type,
      send_to: item.send_to,
      send_speed: item.send_speed,
      chatbot_id: item.chatbot_id ?? null,
      chatbot_name: item.chatbot_name ?? null,
      message: item.message ?? null,
      url: item.url ?? null,
      mimetype: item.mimetype ?? null,
      duration: item.duration ?? null,
      width: item.width ?? null,
      height: item.height ?? null,
      send_date: item.send_date,
      status: item.status,
      created_at: item.created_at ? item.created_at : null,
    };
  };

  listSchedules = async (
    perPage: number,
    currentPage: number,
    query: ListScheduleRequest,
    accountId: string
  ): Promise<ListScheduleResponse[]> => {
    const filters = this.setFilters(query);
    const orders = this.setOrders(query);

    const queryBuilder = this.dbRo
      .select({
        schedule_id: schedule.schedule_id,
        account: {
          account_id: account.account_id,
          name: account.name,
        },
        worker: {
          worker_id: worker.worker_id,
          name: worker.name,
        },
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
        status: schedule.status,
        created_at: schedule.created_at,
      })
      .from(schedule)
      .leftJoin(account, eq(schedule.account_id, account.account_id))
      .leftJoin(worker, eq(schedule.worker_id, worker.worker_id))
      .leftJoin(chatbot, eq(schedule.chatbot_id, chatbot.chatbot_id))
      .where(and(eq(schedule.account_id, accountId), ...filters));

    if (orders.length) {
      queryBuilder.orderBy(...orders);
    }

    const result = await queryBuilder
      .limit(perPage)
      .offset((currentPage - 1) * perPage)
      .execute();

    if (!result?.length) {
      return [] as ListScheduleResponse[];
    }

    return result.map((item) => this.mapToResponse(item));
  };

  listScheduleTotal = async (
    query: ListScheduleRequest,
    accountId: string
  ): Promise<number> => {
    const filters = this.setFilters(query);

    const result = await this.dbRo
      .select({
        count: count(),
      })
      .from(schedule)
      .leftJoin(account, eq(schedule.account_id, account.account_id))
      .leftJoin(worker, eq(schedule.worker_id, worker.worker_id))
      .where(and(eq(schedule.account_id, accountId), ...filters))
      .execute();

    return result[0]?.count ?? 0;
  };
}
