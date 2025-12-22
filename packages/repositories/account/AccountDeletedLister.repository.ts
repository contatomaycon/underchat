import * as schema from '@core/models';
import { account, plan, planAccount } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import {
  and,
  count,
  eq,
  isNotNull,
  SQLWrapper,
  or,
  ilike,
  sql,
  desc,
} from 'drizzle-orm';
import { ListAccountDeletedRequest } from '@core/schema/account/listAccountDeleted/request.schema';
import { ListAccountDeletedResponse } from '@core/schema/account/listAccountDeleted/response.schema';

@injectable()
export class AccountDeletedListerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  private readonly setFiltersAccount = (
    query: ListAccountDeletedRequest
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
    query: ListAccountDeletedRequest
  ): Promise<ListAccountDeletedResponse[]> => {
    const filtersAccount = this.setFiltersAccount(query);

    const result = await this.db.query.account.findMany({
      where: and(isNotNull(account.deleted_at), ...filtersAccount),
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
        deleted_at: true,
      },
      orderBy: [desc(account.deleted_at)],
      limit: perPage,
      offset: (currentPage - 1) * perPage,
    });

    if (!result) {
      return [];
    }

    const filteredResults: ListAccountDeletedResponse[] = [];

    for (const item of result) {
      filteredResults.push({
        account_id: item.account_id,
        name: item.name,
        account_status: item.aac
          ? {
              account_status_id: item.aac.account_status_id,
              name: item.aac.name,
            }
          : null,
        plan: item.apc?.[0]?.ppl
          ? {
              plan_id: item.apc[0].ppl.plan_id,
              name: item.apc[0].ppl.name,
              recurring_payment: item.apc[0].recurring_payment,
              billing_period:
                item.apc[0].bpl?.name === 'monthly' ||
                item.apc[0].bpl?.name === 'annual'
                  ? item.apc[0].bpl.name
                  : null,
            }
          : null,
        created_at: item.created_at ?? null,
        deleted_at: item.deleted_at ?? null,
      });
    }

    return filteredResults;
  };

  listAccountsTotal = async (
    query: ListAccountDeletedRequest
  ): Promise<number> => {
    const filtersAccount = this.setFiltersAccount(query);

    const result = await this.db
      .select({
        count: count(),
      })
      .from(account)
      .where(and(...filtersAccount, isNotNull(account.deleted_at)))
      .execute();

    return result[0]?.count ?? 0;
  };
}
