import * as schema from '@core/models';
import {
  account,
  accountStatus,
  plan,
  planAccount,
  planAccountStatus,
} from '@core/models';
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
              planAccount.plan_id,
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
        apc: {
          columns: {
            plan_account_id: true,
          },
          with: {
            pas: {
              columns: {
                plan_account_status_id: true,
                name: true,
              },
            },
            ppl: {
              columns: {
                plan_id: true,
                name: true,
                price: true,
                price_old: true,
              },
            },
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
      ? result.map((item) => {
          const activePlanAccount = item.apc?.find(
            (pa) => pa.pas?.name === 'active'
          );
          return {
            account_id: item.account_id,
            name: item.name,
            account_status: item.aac
              ? {
                  account_status_id: item.aac.account_status_id,
                  name: item.aac.name,
                }
              : null,
            plan: activePlanAccount?.ppl
              ? {
                  plan_id: activePlanAccount.ppl.plan_id,
                  name: activePlanAccount.ppl.name,
                  price: Number(activePlanAccount.ppl.price),
                  price_old: Number(activePlanAccount.ppl.price_old),
                }
              : null,
            created_at: item.created_at,
          };
        })
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
      .leftJoin(planAccount, eq(planAccount.account_id, account.account_id))
      .leftJoin(plan, eq(plan.plan_id, planAccount.plan_id))
      .leftJoin(
        planAccountStatus,
        eq(
          planAccount.plan_account_status_id,
          planAccountStatus.plan_account_status_id
        )
      )
      .where(
        and(
          ...filtersAccount,
          isNull(account.deleted_at),
          eq(planAccountStatus.name, 'active')
        )
      )
      .execute();

    return isAdministrator ? (result[0]?.count ?? 0) : 0;
  };
}
