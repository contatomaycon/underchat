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
import { ListMessageTemplateResponse } from '@core/schema/messageTemplate/listMessageTemplate/response.schema';
import { ListMessageTemplateRequest } from '@core/schema/messageTemplate/listMessageTemplate/request.schema';
import { ESortByMessage } from '@core/common/enums/ESortByMessage';

@injectable()
export class MessageTemplateListerRepository {
  constructor(
    @inject('DatabaseRw') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  private readonly setOrders = (query: ListMessageTemplateRequest): SQL[] => {
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
      if (key !== ESortByMessage.command) continue;
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
    accountId: string
  ): Promise<ListMessageTemplateResponse[]> => {
    const filters = this.setFilters(query);
    const orders = this.setOrders(query);

    const queryBuilder = this.db
      .select({
        message_template_id: messageTemplate.message_template_id,
        message: messageTemplate.message,
        command: messageTemplate.command,
        type: messageTemplate.type,
        account: {
          account_id: account.account_id,
          name: account.name,
        },
        message_status: {
          message_status_id: messageStatus.message_status_id,
          name: messageStatus.name,
        },
        attachment_url: messageTemplate.attachment_url,
        created_at: messageTemplate.created_at,
      })
      .from(messageTemplate)
      .leftJoin(account, eq(messageTemplate.account_id, account.account_id))
      .leftJoin(
        messageStatus,
        eq(messageTemplate.message_status_id, messageStatus.message_status_id)
      )
      .where(
        and(
          eq(messageTemplate.account_id, accountId),
          isNull(messageTemplate.deleted_at),
          ...filters
        )
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
      attachment_url: message.attachment_url ?? null,
      type: message.type,
      created_at: message.created_at ? message.created_at : null,
    })) as ListMessageTemplateResponse[];
  };

  listMessageTemplateTotal = async (
    query: ListMessageTemplateRequest,
    accountId: string
  ): Promise<number> => {
    const filters = this.setFilters(query);

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
        and(
          eq(messageTemplate.account_id, accountId),
          isNull(messageTemplate.deleted_at),
          ...filters
        )
      )
      .execute();

    return result[0]?.count ?? 0;
  };
}
