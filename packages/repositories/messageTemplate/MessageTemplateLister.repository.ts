import * as schema from '@core/models';
import { messageTemplate, messageStatus, account } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import {
  and,
  asc,
  count,
  desc,
  eq,
  isNull,
  SQL,
  SQLWrapper,
  or,
  ilike,
} from 'drizzle-orm';
import { ESortOrder } from '@core/common/enums/ESortOrder';
import { ListSectorRequest } from '@core/schema/sector/listSector/request.schema';
import { ESortBySector } from '@core/common/enums/ESortBySector';
import { ListMessageTemplateResponse } from '@core/schema/messageTemplate/listMessageTemplate/response.schema';
import { ListMessageTemplateRequest } from '@core/schema/messageTemplate/listMessageTemplate/request.schema';

@injectable()
export class MessageTemplateListerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  private readonly setOrders = (query: ListSectorRequest): SQL[] => {
    const orders: SQL[] = [];
    const sort = query.sort_by;

    if (!sort?.length) {
      orders.push(
        asc(messageTemplate.created_at),
        desc(messageTemplate.message_template_id)
      );

      return orders;
    }

    for (const { key, order } of sort) {
      if (key !== ESortBySector.name) continue;
      orders.push(
        order === ESortOrder.asc
          ? asc(messageTemplate.command)
          : desc(messageTemplate.command)
      );
    }

    return orders;
  };

  private readonly setFilters = (
    query: ListMessageTemplateRequest
  ): SQLWrapper[] => {
    const filters: SQLWrapper[] = [];

    if (query.command) {
      const conditions: (SQLWrapper | undefined)[] = [
        query.command
          ? ilike(messageTemplate.command, `%${query.command}%`)
          : undefined,
      ];

      const combined = or(...conditions);

      if (combined) filters.push(combined);
    }

    if (query.message_status) {
      filters.push(eq(messageStatus.message_status_id, query.message_status));
    }

    return filters;
  };

  listMessageTemplates = async (
    perPage: number,
    currentPage: number,
    query: ListMessageTemplateRequest,
    isAdministrator: boolean,
    accountId: string
  ): Promise<ListMessageTemplateResponse[]> => {
    const filters = this.setFilters(query);
    const orders = this.setOrders(query);
    const accountCondition = isAdministrator
      ? undefined
      : eq(messageTemplate.account_id, accountId);

    const queryBuilder = this.db
      .select({
        message_template_id: messageTemplate.message_template_id,
        message: messageTemplate.message,
        command: messageTemplate.command,
        account: {
          account_id: account.account_id,
          name: account.name,
        },
        message_status: {
          message_status_id: messageStatus.message_status_id,
          name: messageStatus.name,
        },
        created_at: messageTemplate.created_at,
      })
      .from(messageTemplate)
      .leftJoin(account, eq(messageTemplate.account_id, account.account_id))
      .leftJoin(
        messageStatus,
        eq(messageTemplate.message_status_id, messageStatus.message_status_id)
      )
      .where(
        and(accountCondition, isNull(messageTemplate.deleted_at), ...filters)
      );

    if (orders.length) {
      queryBuilder.orderBy(...orders);
    }

    const result = await queryBuilder
      .limit(perPage)
      .offset((currentPage - 1) * perPage)
      .execute();

    if (!result?.length) {
      return [] as ListMessageTemplateResponse[];
    }

    return result.map((message) => ({
      message_template_id: message.message_template_id,
      account: {
        account_id: message.account?.account_id,
        name: message.account?.name,
      },
      message_status: message.message_status
        ? {
            message_status_id: message.message_status.message_status_id,
            name: message.message_status.name,
          }
        : null,
      command: message.command,
      message: message.message,
      created_at: message.created_at ? message.created_at : null,
    })) as ListMessageTemplateResponse[];
  };

  listMessageTemplateTotal = async (
    query: ListMessageTemplateRequest,
    isAdministrator: boolean,
    accountId: string
  ): Promise<number> => {
    const filters = this.setFilters(query);
    const accountCondition = isAdministrator
      ? undefined
      : eq(messageTemplate.account_id, accountId);

    const result = await this.db
      .select({
        count: count(),
      })
      .from(messageTemplate)
      .leftJoin(account, eq(messageTemplate.account_id, account.account_id))
      .leftJoin(
        messageStatus,
        eq(messageTemplate.message_status_id, messageStatus.message_status_id)
      )
      .where(
        and(accountCondition, isNull(messageTemplate.deleted_at), ...filters)
      )
      .execute();

    return result[0]?.count ?? 0;
  };
}
