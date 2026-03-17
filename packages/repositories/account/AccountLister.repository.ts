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
  gt,
  sql,
  desc,
} from 'drizzle-orm';
import { ListAccountRequest } from '@core/schema/account/listAccount/request.schema';
import { ListAccountResponse } from '@core/schema/account/listAccount/response.schema';
import { EAccountStatus } from '@core/common/enums/EAccountStatus';

@injectable()
export class AccountListerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  private readonly setFiltersAccount = (
    query: ListAccountRequest
  ): SQLWrapper[] => {
    const filters: SQLWrapper[] = [];

    if (query.account_id) {
      filters.push(eq(account.account_id, query.account_id));
    }

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
    query: ListAccountRequest
  ): Promise<ListAccountResponse[]> => {
    const filtersAccount = this.setFiltersAccount(query);

    const result = await this.dbRo.query.account.findMany({
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
      orderBy: [
        sql`CASE WHEN ${account.account_status_id} = ${EAccountStatus.active} THEN 0 ELSE 1 END`,
        desc(account.created_at),
      ],
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

  listAccountsTotal = async (query: ListAccountRequest): Promise<number> => {
    const filtersAccount = this.setFiltersAccount(query);

    const result = await this.dbRo
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
          ...filtersAccount,
          isNull(account.deleted_at),
          gt(planAccount.next_payment_date, sql`NOW()`)
        )
      )
      .execute();

    return result[0]?.count ?? 0;
  };
}
