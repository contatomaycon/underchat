import * as schema from '@core/models';
import { accountPayment } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq, count } from 'drizzle-orm';
import { ListAccountPaymentsResponse } from '@core/schema/accountSettings/listAccountPayments/response.schema';

@injectable()
export class AccountPaymentsListerRepository {
  constructor(
    @inject('DatabaseRw') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  listAccountPayments = async (
    accountId: string,
    perPage: number,
    currentPage: number
  ): Promise<ListAccountPaymentsResponse[]> => {
    const payments = await this.db.query.accountPayment.findMany({
      where: eq(accountPayment.account_id, accountId),
      columns: {
        account_payment_id: true,
        payment_billing_type_id: true,
        plan_id: true,
        value: true,
        payment_status_id: true,
        payment_date: true,
        created_at: true,
        invoice_url: true,
      },
      with: {
        apb: {
          columns: {
            payment_billing_type_id: true,
            name: true,
          },
        },
        apl: {
          columns: {
            plan_id: true,
            name: true,
            icon: true,
          },
        },
        aps: {
          columns: {
            payment_status_id: true,
            name: true,
          },
        },
        apc: {
          columns: {
            account_payment_cross_sell_id: true,
            plan_cross_sell_id: true,
            quantity: true,
            value: true,
          },
          with: {
            apc: {
              columns: {
                plan_cross_sell_id: true,
              },
              with: {
                ppt: {
                  columns: {
                    plan_product_id: true,
                  },
                  with: {
                    ppd: {
                      columns: {
                        plan_product_description_id: true,
                        name: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
        apn: {
          columns: {
            account_payment_nfse_id: true,
          },
        },
      },
      orderBy: (accountPayment, { desc: descFn }) => [
        descFn(accountPayment.created_at),
      ],
      limit: perPage,
      offset: (currentPage - 1) * perPage,
    });

    if (!payments) {
      return [];
    }

    return payments.map((payment) => ({
      account_payment_id: payment.account_payment_id,
      payment_billing_type_id: payment.payment_billing_type_id,
      payment_billing_type_name: payment.apb?.name || '',
      payment_billing_type_icon: null,
      plan_id: payment.plan_id,
      plan_name: payment.apl?.name || '',
      plan_icon: payment.apl?.icon || null,
      value: payment.value,
      payment_status_id: payment.payment_status_id,
      payment_status_name: payment.aps?.name || '',
      payment_date: payment.payment_date,
      created_at: payment.created_at || '',
      invoice_url: payment.invoice_url,
      has_nfse: payment.apn && payment.apn.length > 0,
      cross_sells:
        payment.apc?.map((crossSell) => ({
          account_payment_cross_sell_id:
            crossSell.account_payment_cross_sell_id,
          name: crossSell.apc?.ppt?.ppd?.name || '',
          quantity: crossSell.quantity,
          value: crossSell.value,
        })) || [],
    }));
  };

  listAccountPaymentsTotal = async (accountId: string): Promise<number> => {
    const result = await this.db
      .select({
        count: count(),
      })
      .from(accountPayment)
      .where(eq(accountPayment.account_id, accountId))
      .execute();

    return result[0]?.count ?? 0;
  };
}
