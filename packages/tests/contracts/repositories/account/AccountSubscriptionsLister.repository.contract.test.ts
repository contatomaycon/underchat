import 'reflect-metadata';
import { AccountSubscriptionsListerRepository } from '@core/repositories/account/AccountSubscriptionsLister.repository';

describe('AccountSubscriptionsListerRepository', () => {
  it('returns null when account is not found', async () => {
    const repository = new AccountSubscriptionsListerRepository({
      query: {
        account: {
          findFirst: jest.fn(async () => null),
        },
      },
    } as never);

    await expect(
      repository.listAccountSubscriptions('acc-1')
    ).resolves.toBeNull();
  });

  it('maps active plan, filtered plan items and filtered cross sells', async () => {
    const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const findFirst = jest.fn(async () => ({
      account_id: 'acc-1',
      apc: [
        {
          plan_account_id: 'plan-account-1',
          next_payment_date: futureDate,
          ppl: {
            plan_id: 'plan-1',
            name: 'Starter',
            price: '99.00',
            ppi: [
              {
                plan_item_id: 'item-1',
                quantity: 3,
                deleted_at: null,
                ppr: {
                  plan_product_id: 'product-1',
                  ppd: {
                    name: 'Users',
                    description: 'Seats',
                  },
                },
              },
              {
                plan_item_id: 'item-2',
                quantity: 1,
                deleted_at: '2026-04-20',
                ppr: {
                  plan_product_id: 'product-2',
                  ppd: {
                    name: 'Invalid',
                    description: 'Deleted',
                  },
                },
              },
              {
                plan_item_id: 'item-3',
                quantity: 1,
                deleted_at: null,
                ppr: null,
              },
            ],
          },
        },
      ],
      pca: [
        {
          plan_cross_sell_account_id: 'cross-account-1',
          deleted_at: null,
          pca: {
            plan_cross_sell_id: 'cross-1',
            quantity: 2,
            price: '10.00',
            deleted_at: null,
            ppt: {
              plan_product_id: 'product-3',
              ppd: {
                name: 'Addon',
                description: 'Extra',
              },
            },
          },
        },
        {
          plan_cross_sell_account_id: 'cross-account-2',
          deleted_at: null,
          pca: {
            plan_cross_sell_id: 'cross-2',
            quantity: null,
            price: '10.00',
            deleted_at: null,
            ppt: {
              plan_product_id: 'product-4',
              ppd: {
                name: 'Invalid',
                description: 'Quantity null',
              },
            },
          },
        },
      ],
    }));
    const repository = new AccountSubscriptionsListerRepository({
      query: {
        account: {
          findFirst,
        },
      },
    } as never);

    await expect(repository.listAccountSubscriptions('acc-1')).resolves.toEqual(
      {
        plan: {
          plan_id: 'plan-1',
          name: 'Starter',
          price: '99.00',
        },
        plan_items: [
          {
            plan_item_id: 'item-1',
            plan_product: {
              plan_product_id: 'product-1',
              name: 'Users',
              description: 'Seats',
            },
            quantity: 3,
          },
        ],
        cross_sells: [
          {
            plan_cross_sell_id: 'cross-1',
            plan_product: {
              plan_product_id: 'product-3',
              name: 'Addon',
              description: 'Extra',
            },
            quantity: 2,
            price: '10.00',
          },
        ],
      }
    );
  });

  it('returns null plan and empty arrays when active plan/cross sells are missing', async () => {
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const repository = new AccountSubscriptionsListerRepository({
      query: {
        account: {
          findFirst: jest.fn(async () => ({
            account_id: 'acc-1',
            apc: [
              {
                plan_account_id: 'plan-account-1',
                next_payment_date: pastDate,
                ppl: {
                  plan_id: 'plan-1',
                  name: 'Starter',
                  price: '99.00',
                  ppi: [],
                },
              },
            ],
            pca: undefined,
          })),
        },
      },
    } as never);

    await expect(repository.listAccountSubscriptions('acc-1')).resolves.toEqual(
      {
        plan: null,
        plan_items: [],
        cross_sells: [],
      }
    );
  });
});
