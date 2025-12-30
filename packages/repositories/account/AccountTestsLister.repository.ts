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
  sql,
  desc,
} from 'drizzle-orm';
import { ListAccountTestsRequest } from '@core/schema/account/listAccountTests/request.schema';
import { ListAccountTestsResponse } from '@core/schema/account/listAccountTests/response.schema';
import { EAccountStatus } from '@core/common/enums/EAccountStatus';

@injectable()
export class AccountTestsListerRepository {
  constructor(
    @inject('DatabaseRw') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  private readonly setFiltersAccount = (
    query: ListAccountTestsRequest
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

    return filters;
  };

  listAccounts = async (
    perPage: number,
    currentPage: number,
    query: ListAccountTestsRequest
  ): Promise<ListAccountTestsResponse[]> => {
    const filtersAccount = this.setFiltersAccount(query);

    const result = await this.db.query.account.findMany({
      where: and(
        isNull(account.deleted_at),
        sql`${account.account_status_id} != ${EAccountStatus.blocked}`,
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

    const filteredResults: ListAccountTestsResponse[] = [];

    for (const item of result) {
      const testPlanAccount = item.apc?.find((pa) => {
        return pa.ppl?.is_test === true;
      });

      if (!testPlanAccount) continue;

      filteredResults.push({
        account_id: item.account_id,
        name: item.name,
        account_status: item.aac
          ? {
              account_status_id: item.aac.account_status_id,
              name: item.aac.name,
            }
          : null,
        plan: testPlanAccount.ppl
          ? {
              plan_id: testPlanAccount.ppl.plan_id,
              name: testPlanAccount.ppl.name,
              recurring_payment: testPlanAccount.recurring_payment,
              billing_period:
                testPlanAccount.bpl?.name === 'monthly' ||
                testPlanAccount.bpl?.name === 'annual'
                  ? testPlanAccount.bpl.name
                  : null,
            }
          : null,
        created_at: item.created_at ?? null,
      });
    }

    return filteredResults;
  };

  listAccountsTotal = async (
    query: ListAccountTestsRequest
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
          eq(plan.is_test, true)
        )
      )
      .execute();

    return result[0]?.count ?? 0;
  };
}
