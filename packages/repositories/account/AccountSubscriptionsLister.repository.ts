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
    const accountResult = await this.db.query.account.findFirst({
      where: and(eq(account.account_id, accountId), isNull(account.deleted_at)),
      with: {
        apl: {
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
                    name: true,
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
                    name: true,
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

    if (!accountResult) {
      return null;
    }

    return {
      plan: accountResult.apl
        ? {
            plan_id: accountResult.apl.plan_id,
            name: accountResult.apl.name,
            price: accountResult.apl.price,
          }
        : null,
      plan_items:
        accountResult.apl?.ppi
          ?.filter(
            (item) =>
              item.plan_item_id && !item.deleted_at && item.ppr?.plan_product_id
          )
          .map((item) => {
            if (!item.ppr?.plan_product_id) {
              return null;
            }
            return {
              plan_item_id: item.plan_item_id,
              plan_product: {
                plan_product_id: item.ppr.plan_product_id,
                name: item.ppr.name ?? null,
              },
              quantity: item.quantity,
            };
          })
          .filter((item): item is NonNullable<typeof item> => item !== null) ??
        [],
      cross_sells:
        accountResult.pca
          ?.filter(
            (item) =>
              !item.deleted_at &&
              item.pca &&
              !item.pca.deleted_at &&
              item.pca.plan_cross_sell_id &&
              item.pca.quantity !== null &&
              item.pca.price !== null &&
              item.pca.ppt?.plan_product_id
          )
          .map((item) => {
            if (
              !item.pca ||
              !item.pca.plan_cross_sell_id ||
              item.pca.quantity === null ||
              item.pca.price === null ||
              !item.pca.ppt?.plan_product_id
            ) {
              return null;
            }
            return {
              plan_cross_sell_id: item.pca.plan_cross_sell_id,
              plan_product: {
                plan_product_id: item.pca.ppt.plan_product_id,
                name: item.pca.ppt.name ?? null,
              },
              quantity: item.pca.quantity,
              price: item.pca.price,
            };
          })
          .filter((item): item is NonNullable<typeof item> => item !== null) ??
        [],
    };
  };
}
