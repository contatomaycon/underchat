import * as schema from '@core/models';
import { account } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull } from 'drizzle-orm';
import { ListAccountSubscriptionsResponse } from '@core/schema/account/listAccountSubscriptions/response.schema';

@injectable()
export class AccountSubscriptionsListerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  listAccountSubscriptions = async (
    accountId: string
  ): Promise<ListAccountSubscriptionsResponse | null> => {
    const accountResult = await this.findAccountWithSubscriptions(accountId);

    if (!accountResult) {
      return null;
    }

    const activePlan = this.findActivePlan(accountResult);

    return {
      plan: this.buildPlanResponse(activePlan),
      plan_items: this.buildPlanItemsResponse(activePlan),
      cross_sells: this.buildCrossSellsResponse(accountResult?.pca),
    };
  };

  private readonly findAccountWithSubscriptions = async (accountId: string) => {
    return this.db.query.account.findFirst({
      where: and(eq(account.account_id, accountId), isNull(account.deleted_at)),
      with: {
        apc: {
          columns: {
            plan_account_id: true,
            next_payment_date: true,
          },
          with: {
            ppl: {
              columns: {
                plan_id: true,
                name: true,
                price: true,
              },
              with: {
                ppi: {
                  columns: {
                    plan_item_id: true,
                    quantity: true,
                    plan_product_id: true,
                    deleted_at: true,
                  },
                  with: {
                    ppr: {
                      columns: {
                        plan_product_id: true,
                      },
                      with: {
                        ppd: {
                          columns: {
                            name: true,
                            description: true,
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        pca: {
          columns: {
            plan_cross_sell_account_id: true,
            deleted_at: true,
          },
          with: {
            pca: {
              columns: {
                plan_cross_sell_id: true,
                quantity: true,
                price: true,
                plan_product_id: true,
                deleted_at: true,
              },
              with: {
                ppt: {
                  columns: {
                    plan_product_id: true,
                  },
                  with: {
                    ppd: {
                      columns: {
                        name: true,
                        description: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      columns: {
        account_id: true,
      },
    });
  };

  private readonly findActivePlan = (
    accountResult: Awaited<ReturnType<typeof this.findAccountWithSubscriptions>>
  ) => {
    if (!accountResult) {
      return undefined;
    }

    const now = new Date();
    const activePlanAccount = accountResult.apc?.find((pa) => {
      if (!pa.next_payment_date) {
        return false;
      }
      const nextPaymentDate = new Date(pa.next_payment_date);
      return nextPaymentDate > now;
    });

    return activePlanAccount?.ppl;
  };

  private readonly buildPlanResponse = (
    activePlan: ReturnType<typeof this.findActivePlan>
  ) => {
    if (!activePlan) {
      return null;
    }

    return {
      plan_id: activePlan.plan_id,
      name: activePlan.name,
      price: activePlan.price,
    };
  };

  private readonly buildPlanItemsResponse = (
    activePlan: ReturnType<typeof this.findActivePlan>
  ) => {
    if (!activePlan?.ppi) {
      return [];
    }

    const filteredItems = activePlan.ppi.filter(
      (item: (typeof activePlan.ppi)[number]) =>
        item.plan_item_id && !item.deleted_at && item.ppr?.plan_product_id
    );

    const mappedItems = filteredItems
      .map((item: (typeof filteredItems)[number]) => {
        if (!item.ppr?.plan_product_id) {
          return null;
        }

        if (!item.ppr.ppd) {
          return null;
        }

        return {
          plan_item_id: item.plan_item_id,
          plan_product: {
            plan_product_id: item.ppr.plan_product_id,
            name: item.ppr.ppd.name ?? null,
            description: item.ppr.ppd.description ?? null,
          },
          quantity: item.quantity,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    return mappedItems;
  };

  private readonly buildCrossSellsResponse = (
    crossSellAccounts:
      | NonNullable<
          Awaited<ReturnType<typeof this.findAccountWithSubscriptions>>
        >['pca']
      | undefined
  ) => {
    if (!crossSellAccounts) {
      return [];
    }

    const filteredCrossSells = crossSellAccounts.filter(
      (item: (typeof crossSellAccounts)[number]) =>
        !item.deleted_at &&
        item.pca &&
        !item.pca.deleted_at &&
        item.pca.plan_cross_sell_id &&
        item.pca.quantity !== null &&
        item.pca.price !== null &&
        item.pca.ppt?.plan_product_id
    );

    const mappedCrossSells = filteredCrossSells
      .map((item: (typeof filteredCrossSells)[number]) => {
        if (
          !item.pca?.plan_cross_sell_id ||
          item.pca.quantity === null ||
          item.pca.price === null ||
          !item.pca.ppt?.plan_product_id ||
          !item.pca.ppt.ppd
        ) {
          return null;
        }

        return {
          plan_cross_sell_id: item.pca.plan_cross_sell_id,
          plan_product: {
            plan_product_id: item.pca.ppt.plan_product_id,
            name: item.pca.ppt.ppd.name ?? null,
            description: item.pca.ppt.ppd.description ?? null,
          },
          quantity: item.pca.quantity,
          price: item.pca.price,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    return mappedCrossSells;
  };
}
