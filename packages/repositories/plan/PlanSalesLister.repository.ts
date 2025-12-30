import * as schema from '@core/models';
import {
  accountPayment,
  accountPaymentCrossSell,
  plan,
  planCrossSell,
  planProduct,
  planProductDescription,
  paymentBillingType,
  account,
} from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import {
  and,
  eq,
  isNull,
  gte,
  lte,
  SQLWrapper,
  desc,
  inArray,
} from 'drizzle-orm';
import { ListPlanSalesRequest } from '@core/schema/plan/listPlanSales/request.schema';
import { ListPlanSalesResponse } from '@core/schema/plan/listPlanSales/response.schema';
import { EPaymentStatus } from '@core/common/enums/EPaymentStatus';

@injectable()
export class PlanSalesListerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  private readonly setFilters = (query: ListPlanSalesRequest): SQLWrapper[] => {
    const filters: SQLWrapper[] = [];

    filters.push(
      inArray(accountPayment.payment_status_id, [
        EPaymentStatus.received,
        EPaymentStatus.received_in_cash,
      ])
    );

    if (query.plan_id) {
      filters.push(eq(accountPayment.plan_id, query.plan_id));
    }

    if (query.start_date) {
      filters.push(gte(accountPayment.created_at, query.start_date));
    }

    if (query.end_date) {
      filters.push(lte(accountPayment.created_at, query.end_date));
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
        created_at: accountPayment.created_at,
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
      .orderBy(desc(accountPayment.created_at))
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
      created_at: string | null;
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
      created_at: payment.created_at ?? null,
      payment_billing_type_name: payment.payment_billing_type_name ?? null,
    };
  };
}
