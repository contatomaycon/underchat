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
  gte,
  sql,
  desc,
  isNotNull,
} from 'drizzle-orm';
import { ListAccountCancellingRequest } from '@core/schema/account/listAccountCancelling/request.schema';
import { ListAccountCancellingResponse } from '@core/schema/account/listAccountCancelling/response.schema';
import { EAccountStatus } from '@core/common/enums/EAccountStatus';

@injectable()
export class AccountCancellingListerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  private readonly setFiltersAccount = (
    query: ListAccountCancellingRequest
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
    query: ListAccountCancellingRequest
  ): Promise<ListAccountCancellingResponse[]> => {
    const filtersAccount = this.setFiltersAccount(query);
    const now = new Date().toISOString();

    const result = await this.db.query.account.findMany({
      where: and(
        isNull(account.deleted_at),
        or(
          isNotNull(
            sql`(
              SELECT cancellation_date 
              FROM ${planAccount} 
              WHERE account_id = ${account.account_id} 
              LIMIT 1
            )`
          ),
          sql`${account.account_status_id} != ${EAccountStatus.active}`
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

    const filteredResults: ListAccountCancellingResponse[] = [];

    for (const item of result) {
      const activePlanAccount = item.apc?.find((pa) => {
        if (!pa.next_payment_date) return false;
        if (pa.ppl?.is_test) return false;
        const nextPaymentDate = new Date(pa.next_payment_date);
        const nowDate = new Date(now);
        if (nextPaymentDate < nowDate) return false;
        return (
          pa.cancellation_date ||
          item.aac?.account_status_id !== EAccountStatus.active
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
    query: ListAccountCancellingRequest
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
          or(
            isNotNull(planAccount.cancellation_date),
            sql`${account.account_status_id} != ${EAccountStatus.active}`
          ),
          gte(planAccount.next_payment_date, sql`NOW()`),
          eq(plan.is_test, false)
        )
      )
      .execute();

    return result[0]?.count ?? 0;
  };
}
