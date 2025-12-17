import * as schema from '@core/models';
import { account, plan, planAccount } from '@core/models';
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
  lt,
  sql,
  desc,
  isNotNull,
} from 'drizzle-orm';
import { ListAccountCancelledRequest } from '@core/schema/account/listAccountCancelled/request.schema';
import { ListAccountCancelledResponse } from '@core/schema/account/listAccountCancelled/response.schema';
import { EAccountStatus } from '@core/common/enums/EAccountStatus';

@injectable()
export class AccountCancelledListerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  private readonly setFiltersAccount = (
    query: ListAccountCancelledRequest
  ): SQLWrapper[] => {
    const filters: SQLWrapper[] = [];

    if (query.name || query.plan) {
      const conditions: (SQLWrapper | undefined)[] = [
        query.name ? ilike(account.name, `%${query.name}%`) : undefined,
        query.plan
          ? sql`EXISTS (
              SELECT 1 
              FROM ${planAccount} pa
              INNER JOIN ${plan} p ON p.plan_id = pa.plan_id
              WHERE pa.account_id = ${account.account_id}
                AND p.name ILIKE ${`%${query.plan}%`}
                AND p.deleted_at IS NULL
            )`
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
    query: ListAccountCancelledRequest
  ): Promise<ListAccountCancelledResponse[]> => {
    const filtersAccount = this.setFiltersAccount(query);
    const now = new Date().toISOString();

    const result = await this.db.query.account.findMany({
      where: and(
        isNull(account.deleted_at),
        or(
          eq(account.account_status_id, EAccountStatus.inactive),
          eq(account.account_status_id, EAccountStatus.blocked)
        ),
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
            cancellation_date: true,
          },
          with: {
            ppl: {
              columns: {
                plan_id: true,
                name: true,
                is_test: true,
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
      orderBy: [desc(account.created_at)],
      limit: perPage,
      offset: (currentPage - 1) * perPage,
    });

    if (!result) {
      return [];
    }

    const filteredResults: ListAccountCancelledResponse[] = [];

    for (const item of result) {
      const activePlanAccount = item.apc?.find((pa) => {
        if (!pa.cancellation_date) return false;
        if (!pa.next_payment_date) return false;
        if (pa.ppl?.is_test) return false;
        const nextPaymentDate = new Date(pa.next_payment_date);
        const nowDate = new Date(now);
        if (nextPaymentDate >= nowDate) return false;
        return (
          item.aac?.account_status_id === EAccountStatus.inactive ||
          item.aac?.account_status_id === EAccountStatus.blocked
        );
      });

      if (!activePlanAccount) continue;

      filteredResults.push({
        account_id: item.account_id,
        name: item.name,
        account_status: item.aac
          ? {
              account_status_id: item.aac.account_status_id,
              name: item.aac.name,
            }
          : null,
        plan: activePlanAccount.ppl
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
        created_at: item.created_at ?? null,
      });
    }

    return filteredResults;
  };

  listAccountsTotal = async (
    query: ListAccountCancelledRequest
  ): Promise<number> => {
    const filtersAccount = this.setFiltersAccount(query);

    const result = await this.db
      .select({
        count: count(),
      })
      .from(account)
      .innerJoin(planAccount, eq(planAccount.account_id, account.account_id))
      .innerJoin(plan, eq(plan.plan_id, planAccount.plan_id))
      .where(
        and(
          ...filtersAccount,
          isNull(account.deleted_at),
          isNotNull(planAccount.cancellation_date),
          lt(planAccount.next_payment_date, sql`NOW()`),
          or(
            eq(account.account_status_id, EAccountStatus.inactive),
            eq(account.account_status_id, EAccountStatus.blocked)
          ),
          eq(plan.is_test, false)
        )
      )
      .execute();

    return result[0]?.count ?? 0;
  };
}
