import * as schema from '@core/models';
import { labelTemplate, labelStatus, account } from '@core/models';
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
import { ListLabelTemplateRequest } from '@core/schema/labelTemplate/listLabelTemplate/request.schema';
import { ListLabelTemplateResponse } from '@core/schema/labelTemplate/listLabelTemplate/response.schema';
import { ESortByLabel } from '@core/common/enums/ESortByLabel';

@injectable()
export class LabelTemplateListerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  private readonly setOrders = (query: ListLabelTemplateRequest): SQL[] => {
    const orders: SQL[] = [];
    const sort = query.sort_by;

    if (!sort?.length) {
      orders.push(
        asc(labelTemplate.created_at),
        desc(labelTemplate.label_template_id)
      );

      return orders;
    }

    for (const { key, order } of sort) {
      if (key !== ESortByLabel.label) continue;
      orders.push(
        order === ESortOrder.asc
          ? asc(labelTemplate.label)
          : desc(labelTemplate.label)
      );
    }

    return orders;
  };

  private readonly setFilters = (
    query: ListLabelTemplateRequest
  ): SQLWrapper[] => {
    const filters: SQLWrapper[] = [];

    if (query.label) {
      const conditions: (SQLWrapper | undefined)[] = [
        query.label
          ? ilike(labelTemplate.label, `%${query.label}%`)
          : undefined,
      ];

      const combined = or(...conditions);

      if (combined) filters.push(combined);
    }

    if (query.label_status) {
      filters.push(eq(labelStatus.label_status_id, query.label_status));
    }

    return filters;
  };

  listLabelTemplates = async (
    perPage: number,
    currentPage: number,
    query: ListLabelTemplateRequest,
    isAdministrator: boolean,
    accountId: string
  ): Promise<ListLabelTemplateResponse[]> => {
    const filters = this.setFilters(query);
    const orders = this.setOrders(query);
    const accountCondition = isAdministrator
      ? undefined
      : eq(labelTemplate.account_id, accountId);

    const queryBuilder = this.db
      .select({
        label_template_id: labelTemplate.label_template_id,
        label: labelTemplate.label,
        color: labelTemplate.color,
        account: {
          account_id: account.account_id,
          name: account.name,
        },
        label_status: {
          label_status_id: labelStatus.label_status_id,
          name: labelStatus.name,
        },
        created_at: labelTemplate.created_at,
      })
      .from(labelTemplate)
      .leftJoin(account, eq(labelTemplate.account_id, account.account_id))
      .leftJoin(
        labelStatus,
        eq(labelTemplate.label_status_id, labelStatus.label_status_id)
      )
      .where(
        and(accountCondition, isNull(labelTemplate.deleted_at), ...filters)
      );

    if (orders.length) {
      queryBuilder.orderBy(...orders);
    }

    const result = await queryBuilder
      .limit(perPage)
      .offset((currentPage - 1) * perPage)
      .execute();

    if (!result?.length) {
      return [] as ListLabelTemplateResponse[];
    }

    return result.map((label) => ({
      label_template_id: label.label_template_id,
      account: {
        account_id: label.account?.account_id,
        name: label.account?.name,
      },
      label_status: label.label_status
        ? {
            label_status_id: label.label_status.label_status_id,
            name: label.label_status.name,
          }
        : null,
      label: label.label,
      color: label.color,
      created_at: label.created_at ? label.created_at : null,
    })) as ListLabelTemplateResponse[];
  };

  listLabelTemplateTotal = async (
    query: ListLabelTemplateRequest,
    isAdministrator: boolean,
    accountId: string
  ): Promise<number> => {
    const filters = this.setFilters(query);
    const accountCondition = isAdministrator
      ? undefined
      : eq(labelTemplate.account_id, accountId);

    const result = await this.db
      .select({
        count: count(),
      })
      .from(labelTemplate)
      .leftJoin(account, eq(labelTemplate.account_id, account.account_id))
      .leftJoin(
        labelStatus,
        eq(labelTemplate.label_status_id, labelStatus.label_status_id)
      )
      .where(
        and(accountCondition, isNull(labelTemplate.deleted_at), ...filters)
      )
      .execute();

    return result[0]?.count ?? 0;
  };
}
