import * as schema from '@core/models';
import { account, accountStatus, plan, planAccount } from '@core/models';
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
  gt,
  sql,
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
    accountId: string
  ): Promise<ListAccountResponse[]> => {
    const filtersAccount = this.setFiltersAccount(query);

    const result = await this.db.query.account.findMany({
      where: and(
        eq(account.account_id, accountId),
        isNull(account.deleted_at),
        ...filtersAccount
      ),
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
            next_payment_date: true,
            recurring_payment: true,
          },
          with: {
            ppl: {
              columns: {
                plan_id: true,
                name: true,
              },
            },
            bpl: {
              columns: {
                billing_period_id: true,
                name: true,
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

    const now = new Date();
    return result.map((item) => {
      const activePlanAccount = item.apc?.find((pa) => {
        if (!pa.next_payment_date) return false;
        const nextPaymentDate = new Date(pa.next_payment_date);
        return nextPaymentDate > now;
      });
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
              recurring_payment: activePlanAccount.recurring_payment,
              billing_period:
                activePlanAccount.bpl?.name === 'monthly' ||
                activePlanAccount.bpl?.name === 'annual'
                  ? activePlanAccount.bpl.name
                  : null,
            }
          : null,
        created_at: item.created_at,
      };
    });
  };

  listAccountsTotal = async (
    query: ListAccountRequest,
    accountId: string
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
      .where(
        and(
          eq(account.account_id, accountId),
          ...filtersAccount,
          isNull(account.deleted_at),
          gt(planAccount.next_payment_date, sql`NOW()`)
        )
      )
      .execute();

    return result[0]?.count ?? 0;
  };
}
