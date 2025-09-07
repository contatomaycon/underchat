import * as schema from '@core/models';
import { account, accountStatus, plan } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import {
  and,
  count,
  eq,
  isNull,
  SQLWrapper,
  or,
  ilike,
  inArray,
} from 'drizzle-orm';
import { ListAccountRequest } from '@core/schema/account/listAccount/request.schema';
import { ListAccountResponse } from '@core/schema/account/listAccount/response.schema';

@injectable()
export class AccountListerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  private readonly setFiltersAccount = (
    query: ListAccountRequest
  ): SQLWrapper[] => {
    const filters: SQLWrapper[] = [];

    if (query.name || query.plan) {
      const conditions: (SQLWrapper | undefined)[] = [
        query.name ? ilike(account.name, `%${query.name}%`) : undefined,
        query.plan
          ? inArray(
              account.plan_id,
              this.db
                .select({ plan_id: plan.plan_id })
                .from(plan)
                .where(ilike(plan.name, `%${query.plan}%`))
            )
          : undefined,
      ];

      const combined = or(...conditions);

      if (combined) filters.push(combined);
    }

    if (query.account_status) {
      filters.push(eq(account.account_status_id, query.account_status));
    }

    return filters;
  };

  listAccounts = async (
    perPage: number,
    currentPage: number,
    query: ListAccountRequest,
    isAdministrator: boolean
  ): Promise<ListAccountResponse[]> => {
    const filtersAccount = this.setFiltersAccount(query);

    const result = await this.db.query.account.findMany({
      where: and(isNull(account.deleted_at), ...filtersAccount),
      with: {
        aac: {
          columns: {
            account_status_id: true,
            name: true,
          },
        },
        apl: {
          columns: {
            plan_id: true,
            name: true,
            price: true,
            price_old: true,
          },
        },
      },
      columns: {
        account_id: true,
        name: true,
        created_at: true,
      },
      limit: perPage,
      offset: (currentPage - 1) * perPage,
    });

    if (!result) {
      return [];
    }

    return isAdministrator
      ? result.map((item) => ({
          account_id: item.account_id,
          name: item.name,
          account_status: item.aac
            ? {
                account_status_id: item.aac.account_status_id,
                name: item.aac.name,
              }
            : null,
          plan: item.apl
            ? {
                plan_id: item.apl.plan_id,
                name: item.apl.name,
                price: Number(item.apl.price),
                price_old: Number(item.apl.price_old),
              }
            : null,
          created_at: item.created_at,
        }))
      : [];
  };

  listAccountsTotal = async (
    query: ListAccountRequest,
    isAdministrator: boolean
  ): Promise<number> => {
    const filtersAccount = this.setFiltersAccount(query);

    const result = await this.db
      .select({
        count: count(),
      })
      .from(account)
      .leftJoin(
        accountStatus,
        eq(accountStatus.account_status_id, account.account_status_id)
      )
      .leftJoin(plan, eq(plan.plan_id, account.plan_id))
      .where(and(...filtersAccount, isNull(account.deleted_at)))
      .execute();

    return isAdministrator ? (result[0]?.count ?? 0) : 0;
  };
}
