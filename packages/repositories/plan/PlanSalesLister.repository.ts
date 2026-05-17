import * as schema from '@core/models';
import {
  account,
  accountPayment,
  accountPaymentCrossSell,
  plan,
  planAccount,
  planCrossSell,
  planProduct,
  planProductDescription,
  paymentBillingType,
} from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  sql,
  SQL,
  SQLWrapper,
} from 'drizzle-orm';
import moment from 'moment-timezone';
import { EPaymentStatus } from '@core/common/enums/EPaymentStatus';
import { ListPlanSalesRequest } from '@core/schema/plan/listPlanSales/request.schema';
import { ListPlanSalesResponse } from '@core/schema/plan/listPlanSales/response.schema';
import { ListPlanSalesSummaryResponse } from '@core/schema/plan/listPlanSalesSummary/response.schema';

const BRAZIL_TIMEZONE = 'America/Sao_Paulo';

@injectable()
export class PlanSalesListerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  private readonly getEffectivePaymentDateExpression = () =>
    sql`COALESCE(${accountPayment.payment_date}, ${accountPayment.created_at})`;

  private readonly parseDateInBrazilTimezone = (
    dateValue: string
  ): moment.Moment | null => {
    const dateOnlyMatch = dateValue.match(/^(\d{4})-(\d{2})-(\d{2})$/);

    if (dateOnlyMatch) {
      const year = Number.parseInt(dateOnlyMatch[1], 10);
      const month = Number.parseInt(dateOnlyMatch[2], 10);
      const day = Number.parseInt(dateOnlyMatch[3], 10);
      const parsedDate = moment.tz(
        { year, month: month - 1, day },
        BRAZIL_TIMEZONE
      );

      return parsedDate.isValid() ? parsedDate : null;
    }

    const parsedDate = moment.tz(dateValue, BRAZIL_TIMEZONE);
    if (parsedDate.isValid()) {
      return parsedDate;
    }

    const fallbackDate = moment(dateValue);
    if (!fallbackDate.isValid()) {
      return null;
    }

    return fallbackDate.tz(BRAZIL_TIMEZONE);
  };

  private readonly normalizeDateRange = (
    query: ListPlanSalesRequest,
    options?: { defaultToToday?: boolean }
  ): {
    normalizedStartDate: string | null;
    normalizedEndDate: string | null;
  } => {
    const startMoment = query.start_date
      ? this.parseDateInBrazilTimezone(query.start_date)
      : null;
    const endMoment = query.end_date
      ? this.parseDateInBrazilTimezone(query.end_date)
      : null;

    if (!startMoment && !endMoment && options?.defaultToToday) {
      const today = moment.tz(BRAZIL_TIMEZONE);

      return {
        normalizedStartDate: today.clone().startOf('day').utc().toISOString(),
        normalizedEndDate: today.clone().endOf('day').utc().toISOString(),
      };
    }

    if (!startMoment && !endMoment) {
      return {
        normalizedStartDate: null,
        normalizedEndDate: null,
      };
    }

    const normalizedStartDate = startMoment
      ? startMoment.clone().startOf('day').utc().toISOString()
      : null;

    const normalizedEndDate = endMoment
      ? endMoment.clone().endOf('day').utc().toISOString()
      : startMoment
        ? moment.tz(BRAZIL_TIMEZONE).utc().toISOString()
        : null;

    return {
      normalizedStartDate,
      normalizedEndDate,
    };
  };

  private readonly setFilters = (query: ListPlanSalesRequest): SQLWrapper[] => {
    const filters: SQLWrapper[] = [];

    filters.push(
      inArray(accountPayment.payment_status_id, [
        EPaymentStatus.received,
        EPaymentStatus.received_in_cash,
      ])
    );

    filters.push(eq(plan.is_test, false));

    if (query.plan_id) {
      filters.push(eq(accountPayment.plan_id, query.plan_id));
    }

    const { normalizedStartDate, normalizedEndDate } =
      this.normalizeDateRange(query);

    if (normalizedStartDate) {
      filters.push(
        gte(this.getEffectivePaymentDateExpression(), normalizedStartDate)
      );
    }

    if (normalizedEndDate) {
      filters.push(
        lte(this.getEffectivePaymentDateExpression(), normalizedEndDate)
      );
    }

    if (query.payment_billing_type_id) {
      filters.push(
        eq(
          accountPayment.payment_billing_type_id,
          query.payment_billing_type_id
        )
      );
    }

    return filters;
  };

  listPlanSales = async (
    query: ListPlanSalesRequest
  ): Promise<ListPlanSalesResponse[]> => {
    const filters = this.setFilters(query);
    const payments = await this.getPayments(filters);

    if (!payments.length) {
      return [];
    }

    const results: ListPlanSalesResponse[] = [];

    for (const payment of payments) {
      const crossSellsResult = await this.getCrossSellsForPayment(
        payment.account_payment_id
      );

      const planSaleResponse = this.buildPlanSaleResponse(
        payment,
        crossSellsResult
      );
      results.push(planSaleResponse);
    }

    return results;
  };

  listPlanSalesSummary = async (
    query: ListPlanSalesRequest
  ): Promise<ListPlanSalesSummaryResponse> => {
    const { normalizedStartDate, normalizedEndDate } =
      this.normalizeDateRange(query);
    const {
      normalizedStartDate: normalizedStartDateForNewClients,
      normalizedEndDate: normalizedEndDateForNewClients,
    } = this.normalizeDateRange(query, { defaultToToday: true });

    const lastPaidPaymentFilter = query.payment_billing_type_id
      ? [
          sql`EXISTS (
            SELECT 1
            FROM (
              SELECT DISTINCT ON (ap.account_id)
                ap.account_id,
                ap.payment_billing_type_id
              FROM ${accountPayment} ap
              WHERE ap.payment_status_id IN (${EPaymentStatus.received}, ${EPaymentStatus.received_in_cash})
              ORDER BY ap.account_id, COALESCE(ap.payment_date, ap.created_at) DESC, ap.created_at DESC
            ) lp
            WHERE lp.account_id = a.account_id
              AND lp.payment_billing_type_id = ${query.payment_billing_type_id}
          )`,
        ]
      : [];

    const totalClientsFilters: SQL[] = [
      sql`a.deleted_at IS NULL`,
      sql`EXISTS (
        SELECT 1
        FROM ${planAccount} pa_active
        WHERE pa_active.account_id = a.account_id
          AND pa_active.next_payment_date > NOW()
      )`,
      ...lastPaidPaymentFilter,
    ];

    if (query.plan_id) {
      totalClientsFilters.push(sql`EXISTS (
        SELECT 1
        FROM ${planAccount} pa_active_plan
        WHERE pa_active_plan.account_id = a.account_id
          AND pa_active_plan.next_payment_date > NOW()
          AND pa_active_plan.plan_id = ${query.plan_id}
      )`);
    }

    if (normalizedStartDate || normalizedEndDate) {
      const totalClientsDateFilters: SQL[] = [];

      if (normalizedStartDate) {
        totalClientsDateFilters.push(
          sql`first_subscription.first_created_at >= ${normalizedStartDate}`
        );
      }

      if (normalizedEndDate) {
        totalClientsDateFilters.push(
          sql`first_subscription.first_created_at <= ${normalizedEndDate}`
        );
      }

      totalClientsFilters.push(sql`EXISTS (
        SELECT 1
        FROM (
          SELECT pa_first.account_id, MIN(pa_first.created_at) AS first_created_at
          FROM ${planAccount} pa_first
          GROUP BY pa_first.account_id
        ) first_subscription
        WHERE first_subscription.account_id = a.account_id
          AND ${sql.join(totalClientsDateFilters, sql` AND `)}
      )`);
    }

    const newClientsDateFilters: SQL[] = [];

    if (normalizedStartDateForNewClients) {
      newClientsDateFilters.push(
        sql`first_subscription.created_at >= ${normalizedStartDateForNewClients}`
      );
    }

    if (normalizedEndDateForNewClients) {
      newClientsDateFilters.push(
        sql`first_subscription.created_at <= ${normalizedEndDateForNewClients}`
      );
    }

    const newClientsFilters: SQL[] = [
      sql`a.deleted_at IS NULL`,
      ...lastPaidPaymentFilter,
      sql`EXISTS (
        SELECT 1
        FROM (
          SELECT DISTINCT ON (pa_first.account_id)
            pa_first.account_id,
            pa_first.plan_id,
            pa_first.created_at
          FROM ${planAccount} pa_first
          ORDER BY pa_first.account_id, pa_first.created_at ASC, pa_first.plan_account_id ASC
        ) first_subscription
        WHERE first_subscription.account_id = a.account_id
          ${query.plan_id ? sql`AND first_subscription.plan_id = ${query.plan_id}` : sql``}
          ${newClientsDateFilters.length ? sql`AND ${sql.join(newClientsDateFilters, sql` AND `)}` : sql``}
      )`,
    ];

    const summaryQuery = sql<{
      total_clients: number | string | null;
      new_clients: number | string | null;
    }>`
      SELECT
        (
          SELECT COUNT(DISTINCT a.account_id)::int
          FROM ${account} a
          WHERE ${sql.join(totalClientsFilters, sql` AND `)}
        ) AS total_clients,
        (
          SELECT COUNT(DISTINCT a.account_id)::int
          FROM ${account} a
          WHERE ${sql.join(newClientsFilters, sql` AND `)}
        ) AS new_clients
    `;

    const result = await this.dbRo.execute(summaryQuery);
    const row = result.rows[0];

    return {
      total_clients: Number(row?.total_clients ?? 0),
      new_clients: Number(row?.new_clients ?? 0),
    };
  };

  private readonly getPayments = async (filters: SQLWrapper[]) => {
    return this.dbRo
      .select({
        account_payment_id: accountPayment.account_payment_id,
        plan_id: plan.plan_id,
        plan_name: plan.name,
        price: plan.price,
        price_old: plan.price_old,
        payment_billing_type_id: paymentBillingType.payment_billing_type_id,
        payment_billing_type_name: paymentBillingType.name,
        account_id: account.account_id,
        account_name: account.name,
        payment_value: accountPayment.value,
        contracted_at: sql<string | null>`${this.getEffectivePaymentDateExpression()}`,
      })
      .from(accountPayment)
      .innerJoin(plan, eq(accountPayment.plan_id, plan.plan_id))
      .innerJoin(account, eq(accountPayment.account_id, account.account_id))
      .innerJoin(
        paymentBillingType,
        eq(
          accountPayment.payment_billing_type_id,
          paymentBillingType.payment_billing_type_id
        )
      )
      .where(
        and(isNull(plan.deleted_at), isNull(account.deleted_at), ...filters)
      )
      .orderBy(desc(this.getEffectivePaymentDateExpression()))
      .execute();
  };

  private readonly getCrossSellsForPayment = async (paymentId: string) => {
    return this.dbRo
      .select({
        plan_cross_sell_id: planCrossSell.plan_cross_sell_id,
        plan_product_name: planProductDescription.name,
        total_price: accountPaymentCrossSell.value,
        quantity: accountPaymentCrossSell.quantity,
        cross_sell_quantity: planCrossSell.quantity,
      })
      .from(accountPaymentCrossSell)
      .innerJoin(
        planCrossSell,
        eq(
          accountPaymentCrossSell.plan_cross_sell_id,
          planCrossSell.plan_cross_sell_id
        )
      )
      .innerJoin(
        planProduct,
        eq(planCrossSell.plan_product_id, planProduct.plan_product_id)
      )
      .innerJoin(
        planProductDescription,
        eq(planProduct.plan_product_id, planProductDescription.plan_product_id)
      )
      .where(
        and(
          eq(accountPaymentCrossSell.account_payment_id, paymentId),
          isNull(planCrossSell.deleted_at)
        )
      )
      .execute();
  };

  private readonly buildPlanSaleResponse = (
    payment: {
      account_payment_id: string;
      plan_id: string;
      plan_name: string;
      price: string;
      price_old: string;
      payment_billing_type_id: string;
      payment_billing_type_name: string;
      account_id: string;
      account_name: string;
      payment_value: string;
      contracted_at: string | null;
    },
    crossSellsResult: Array<{
      plan_cross_sell_id: string;
      plan_product_name: string | null;
      total_price: string;
      quantity: number;
      cross_sell_quantity: number;
    }>
  ): ListPlanSalesResponse => {
    const crossSellsTotal = crossSellsResult.reduce(
      (sum, cs) => sum + Number(cs.total_price),
      0
    );
    const planValue = (
      Number(payment.payment_value) - crossSellsTotal
    ).toString();

    return {
      account_payment_id: payment.account_payment_id,
      plan_id: payment.plan_id,
      plan_name: payment.plan_name,
      price: planValue,
      price_old: payment.price_old,
      total_revenue: payment.payment_value,
      account_id: payment.account_id,
      account_name: payment.account_name,
      cross_sells: crossSellsResult.map((cs) => ({
        plan_cross_sell_id: cs.plan_cross_sell_id,
        plan_product_name: cs.plan_product_name ?? null,
        total_price: cs.total_price,
        quantity: cs.quantity,
        cross_sell_quantity: cs.cross_sell_quantity,
      })),
      contracted_at: payment.contracted_at ?? null,
      payment_billing_type_name: payment.payment_billing_type_name ?? null,
    };
  };
}
