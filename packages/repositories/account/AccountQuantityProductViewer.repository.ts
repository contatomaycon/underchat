import * as schema from '@core/models';
import { planAccount, planCrossSellAccount, planCrossSell } from '@core/models';
import { and, eq, isNull } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';

@injectable()
export class AccountQuantityProductViewerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  viewPlanQuantity = async (
    accountId: string,
    planProductId: string
  ): Promise<number> => {
    const currentPlan = await this.dbRo.query.planAccount.findFirst({
      where: eq(planAccount.account_id, accountId),
      columns: {
        plan_account_id: true,
        next_payment_date: true,
      },
      with: {
        pac: {
          columns: {
            account_id: true,
            deleted_at: true,
          },
        },
        ppl: {
          columns: {
            plan_id: true,
            deleted_at: true,
          },
          with: {
            ppi: {
              columns: {
                plan_product_id: true,
                quantity: true,
                deleted_at: true,
              },
            },
          },
        },
      },
      orderBy: (currentPlan, { desc }) => [
        desc(currentPlan.updated_at),
        desc(currentPlan.created_at),
        desc(currentPlan.plan_account_id),
      ],
    });

    if (
      !currentPlan?.next_payment_date ||
      new Date(currentPlan.next_payment_date) <= new Date() ||
      !currentPlan.pac ||
      currentPlan.pac.deleted_at ||
      !currentPlan.ppl ||
      currentPlan.ppl.deleted_at
    ) {
      return 0;
    }

    return currentPlan.ppl.ppi.reduce((total, item) => {
      if (
        item.plan_product_id !== planProductId ||
        item.deleted_at ||
        item.quantity <= 0
      ) {
        return total;
      }

      return total + item.quantity;
    }, 0);
  };

  viewPlanCrossSellQuantity = async (
    accountId: string,
    planProductId: string
  ): Promise<number> => {
    const planCrossSellResult = await this.dbRo
      .select({
        quantity: planCrossSell.quantity,
      })
      .from(planCrossSellAccount)
      .innerJoin(
        planCrossSell,
        eq(
          planCrossSell.plan_cross_sell_id,
          planCrossSellAccount.plan_cross_sell_id
        )
      )
      .where(
        and(
          eq(planCrossSellAccount.account_id, accountId),
          eq(planCrossSell.plan_product_id, planProductId),
          isNull(planCrossSellAccount.deleted_at)
        )
      )
      .execute();

    if (!planCrossSellResult?.length) {
      return 0;
    }

    return planCrossSellResult.reduce((total, item) => {
      return total + item.quantity;
    }, 0);
  };

  viewAccountQuantityProduct = async (
    accountId: string,
    planProductId: string
  ): Promise<number> => {
    const [planQuantity, planCrossSellQuantity] = await Promise.all([
      this.viewPlanQuantity(accountId, planProductId),
      this.viewPlanCrossSellQuantity(accountId, planProductId),
    ]);

    return planQuantity + planCrossSellQuantity;
  };
}
