import 'reflect-metadata';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';
import { AccountAddonsListerRepository } from '@core/repositories/accountSettings/AccountAddonsLister.repository';

jest.mock('uuid', () => ({
  v7: jest.fn(() => 'uuid-v7'),
}));

jest.mock('@core/services/aiAgent.service', () => ({
  AiAgentService: class AiAgentService {},
}));

function createSelectChain(results: unknown[]) {
  const execute = jest.fn();
  for (const value of results) {
    execute.mockResolvedValueOnce(value);
  }
  const chain = {} as {
    from: jest.Mock;
    innerJoin: jest.Mock;
    where: jest.Mock;
    execute: jest.Mock;
  };
  chain.from = jest.fn(() => chain);
  chain.innerJoin = jest.fn(() => chain);
  chain.where = jest.fn(() => chain);
  chain.execute = execute;

  return chain;
}

describe('AccountAddonsListerRepository', () => {
  it('returns empty array when there are no cross sells', async () => {
    const repository = new AccountAddonsListerRepository(
      {
        query: {
          planCrossSellAccount: {
            findMany: jest.fn(async () => []),
          },
        },
        select: jest.fn(),
      } as never,
      {
        totalWorkerByAccountId: jest.fn(async () => 0),
      } as never,
      {
        totalUserByAccount: jest.fn(async () => 0),
      } as never,
      {
        totalRoleByAccount: jest.fn(async () => 0),
      } as never,
      {
        totalAiAgentByAccountId: jest.fn(async () => 0),
      } as never
    );

    await expect(repository.listAccountAddons('acc-1')).resolves.toEqual([]);
  });

  it('maps addons and caches quantities by plan product', async () => {
    const chain = createSelectChain([[{ quantity: 10 }], []]);
    const repository = new AccountAddonsListerRepository(
      {
        query: {
          planCrossSellAccount: {
            findMany: jest.fn(async () => [
              {
                plan_cross_sell_account_id: 'addon-1',
                plan_cross_sell_id: 'cross-1',
                cancellation_date: null,
                pca: {
                  quantity: 2,
                  price: '5',
                  ppt: {
                    plan_product_id: EPlanProduct.worker,
                    ppd: { name: 'Workers' },
                  },
                },
              },
              {
                plan_cross_sell_account_id: 'addon-2',
                plan_cross_sell_id: 'cross-2',
                cancellation_date: '2026-05-01',
                pca: {
                  quantity: 1,
                  price: '5',
                  ppt: {
                    plan_product_id: EPlanProduct.worker,
                    ppd: { name: 'Workers' },
                  },
                },
              },
              {
                plan_cross_sell_account_id: 'addon-3',
                plan_cross_sell_id: 'cross-3',
                cancellation_date: null,
                pca: {
                  quantity: 3,
                  price: '7',
                  ppt: {
                    plan_product_id: 'unknown-product',
                    ppd: { name: 'Other' },
                  },
                },
              },
            ]),
          },
        },
        select: jest.fn(() => chain),
      } as never,
      {
        totalWorkerByAccountId: jest.fn(async () => 4),
      } as never,
      {
        totalUserByAccount: jest.fn(async () => 0),
      } as never,
      {
        totalRoleByAccount: jest.fn(async () => 0),
      } as never,
      {
        totalAiAgentByAccountId: jest.fn(async () => 0),
      } as never
    );

    const result = await repository.listAccountAddons('acc-1');

    expect(result).toEqual([
      {
        plan_cross_sell_account_id: 'addon-1',
        plan_cross_sell_id: 'cross-1',
        plan_product_id: EPlanProduct.worker,
        name: 'Workers',
        quantity: 2,
        price: 5,
        price_per_cycle: 5,
        cancellation_date: null,
        renewal_status: 'active',
        quantity_total: 13,
        quantity_used: 4,
        quantity_plan: 10,
        quantity_addon: 2,
        source: 'plan',
      },
      {
        plan_cross_sell_account_id: 'addon-2',
        plan_cross_sell_id: 'cross-2',
        plan_product_id: EPlanProduct.worker,
        name: 'Workers',
        quantity: 1,
        price: 5,
        price_per_cycle: 5,
        cancellation_date: '2026-05-01',
        renewal_status: 'scheduled_cancellation',
        quantity_total: 13,
        quantity_used: 4,
        quantity_plan: 10,
        quantity_addon: 1,
        source: 'plan',
      },
      {
        plan_cross_sell_account_id: 'addon-3',
        plan_cross_sell_id: 'cross-3',
        plan_product_id: 'unknown-product',
        name: 'Other',
        quantity: 3,
        price: 7,
        price_per_cycle: 7,
        cancellation_date: null,
        renewal_status: 'active',
        quantity_total: 3,
        quantity_used: 0,
        quantity_plan: 0,
        quantity_addon: 3,
        source: 'addon',
      },
    ]);
    expect(chain.execute).toHaveBeenCalledTimes(2);
  });
});
