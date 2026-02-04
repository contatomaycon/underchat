import * as schema from '@core/models';
import {
  account,
  plan,
  planAccount,
  user,
  userDocument,
  userInfo,
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
  sql,
  desc,
  isNotNull,
} from 'drizzle-orm';
import { ListAccountRequest } from '@core/schema/account/listAccount/request.schema';
import { ListAccountResponse } from '@core/schema/account/listAccount/response.schema';
import { EAccountStatus } from '@core/common/enums/EAccountStatus';
import { EAccountFilterStatus } from '@core/common/enums/EAccountFilterStatus';
import { EPlanStatus } from '@core/common/enums/EPlanStatus';

@injectable()
export class AccountAllListerWithDetailsRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  private readonly setFiltersAccount = (
    query: ListAccountRequest
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
        query.name
          ? sql`EXISTS (
              SELECT 1
              FROM ${user} u
              WHERE u.account_id = ${account.account_id}
                AND u.email_partial ILIKE ${`%${query.name}%`}
                AND u.deleted_at IS NULL
            )`
          : undefined,
        query.name
          ? sql`EXISTS (
              SELECT 1
              FROM ${user} u
              INNER JOIN ${userDocument} ud ON ud.user_id = u.user_id
              WHERE u.account_id = ${account.account_id}
                AND ud.document_partial ILIKE ${`%${query.name}%`}
                AND u.deleted_at IS NULL
            )`
          : undefined,
        query.name
          ? sql`EXISTS (
              SELECT 1
              FROM ${user} u
              INNER JOIN ${userInfo} ui ON ui.user_id = u.user_id
              WHERE u.account_id = ${account.account_id}
                AND ui.phone_partial ILIKE ${`%${query.name}%`}
                AND u.deleted_at IS NULL
            )`
          : undefined,
      ];

      const combined = or(...conditions);

      if (combined) filters.push(combined);
    }

    if (query.account_status) {
      filters.push(eq(account.account_status_id, query.account_status));
    }

    if (query.filter_status) {
      const now = new Date().toISOString();

      if (query.filter_status === EAccountFilterStatus.subscribers) {
        filters.push(
          sql`EXISTS (
            SELECT 1
            FROM ${planAccount} pa
            INNER JOIN ${plan} p ON p.plan_id = pa.plan_id
            WHERE pa.account_id = ${account.account_id}
              AND pa.cancellation_date IS NULL
              AND pa.next_payment_date IS NOT NULL
              AND pa.next_payment_date > ${now}
              AND ${account.account_status_id} = ${EAccountStatus.active}
              AND p.is_test = false
              AND p.deleted_at IS NULL
          )`
        );
      }

      if (query.filter_status === EAccountFilterStatus.cancelling) {
        filters.push(
          sql`EXISTS (
            SELECT 1
            FROM ${planAccount} pa
            INNER JOIN ${plan} p ON p.plan_id = pa.plan_id
            WHERE pa.account_id = ${account.account_id}
              AND pa.cancellation_date IS NOT NULL
              AND pa.next_payment_date IS NOT NULL
              AND pa.next_payment_date > ${now}
              AND p.deleted_at IS NULL
          )`
        );
      }

      if (query.filter_status === EAccountFilterStatus.cancelled) {
        filters.push(
          sql`EXISTS (
            SELECT 1
            FROM ${planAccount} pa
            INNER JOIN ${plan} p ON p.plan_id = pa.plan_id
            WHERE pa.account_id = ${account.account_id}
              AND pa.cancellation_date IS NOT NULL
              AND (pa.next_payment_date IS NULL OR pa.next_payment_date <= ${now})
              AND p.deleted_at IS NULL
          )`
        );
      }

      if (query.filter_status === EAccountFilterStatus.blocked) {
        filters.push(eq(account.account_status_id, EAccountStatus.blocked));
      }

      if (query.filter_status === EAccountFilterStatus.expired) {
        filters.push(
          sql`EXISTS (
            SELECT 1
            FROM ${planAccount} pa
            INNER JOIN ${plan} p ON p.plan_id = pa.plan_id
            WHERE pa.account_id = ${account.account_id}
              AND pa.cancellation_date IS NULL
              AND pa.next_payment_date IS NOT NULL
              AND pa.next_payment_date <= ${now}
              AND ${account.account_status_id} = ${EAccountStatus.active}
              AND p.deleted_at IS NULL
          )`
        );
      }

      if (query.filter_status === EAccountFilterStatus.tests) {
        filters.push(
          sql`EXISTS (
            SELECT 1
            FROM ${planAccount} pa
            INNER JOIN ${plan} p ON p.plan_id = pa.plan_id
            WHERE pa.account_id = ${account.account_id}
              AND p.is_test = true
              AND p.status = ${EPlanStatus.active}
              AND p.deleted_at IS NULL
              AND pa.next_payment_date IS NOT NULL
              AND pa.next_payment_date > ${now}
          )`
        );
      }

      if (query.filter_status === EAccountFilterStatus.deleted) {
        filters.push(isNotNull(account.deleted_at));
      }
    }

    return filters;
  };

  listAccounts = async (
    perPage: number,
    currentPage: number,
    query: ListAccountRequest
  ): Promise<ListAccountResponse[]> => {
    const filtersAccount = this.setFiltersAccount(query);

    const whereCondition =
      query.filter_status === EAccountFilterStatus.deleted
        ? and(...filtersAccount)
        : and(isNull(account.deleted_at), ...filtersAccount);

    const result = await this.dbRo.query.account.findMany({
      where: whereCondition,
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

    const whereCondition =
      query.filter_status === EAccountFilterStatus.deleted
        ? and(...filtersAccount)
        : and(...filtersAccount, isNull(account.deleted_at));

    const result = await this.dbRo
      .select({
        count: count(),
      })
      .from(account)
      .where(whereCondition)
      .execute();

    return result[0]?.count ?? 0;
  };
}
