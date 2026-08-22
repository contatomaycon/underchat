import 'reflect-metadata';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';
import { CrossSellListerRepository } from '@core/repositories/planCrossSell/CrossSellLister.repository';

function createDbRoWithExecuteQueue(queue: unknown[]) {
  const execute = jest.fn();
  for (const item of queue) {
    execute.mockResolvedValueOnce(item);
  }

  const chain = {} as {
    from: jest.Mock;
    innerJoin: jest.Mock;
    leftJoin: jest.Mock;
    where: jest.Mock;
    orderBy: jest.Mock;
    limit: jest.Mock;
    offset: jest.Mock;
    execute: jest.Mock;
  };

  chain.from = jest.fn(() => chain);
  chain.innerJoin = jest.fn(() => chain);
  chain.leftJoin = jest.fn(() => chain);
  chain.where = jest.fn(() => chain);
  chain.orderBy = jest.fn(() => chain);
  chain.limit = jest.fn(() => chain);
  chain.offset = jest.fn(() => chain);
  chain.execute = execute;

  return {
    dbRo: {
      select: jest.fn(() => chain),
    },
  };
}

describe('CrossSellListerRepository', () => {
  it('returns empty list when cross sells are not found', async () => {
    const { dbRo } = createDbRoWithExecuteQueue([[]]);
    const repository = new CrossSellListerRepository(dbRo as never);

    await expect(
      repository.listCrossSells(10, 1, {} as never)
    ).resolves.toEqual([]);
  });

  it('returns mapped cross sells with numeric price', async () => {
    const rows = [
      {
        plan_cross_sell_id: 'cs-1',
        plan_product_id: EPlanProduct.integration,
        quantity: 2,
        price: '19.9',
        created_at: '2026-04-21T00:00:00.000Z',
        plan_product: {
          plan_product_id: EPlanProduct.integration,
          name: 'Produto',
          description: 'Desc',
        },
      },
    ];
    const { dbRo } = createDbRoWithExecuteQueue([rows]);
    const repository = new CrossSellListerRepository(dbRo as never);

    await expect(
      repository.listCrossSells(10, 1, {
        product_name: 'Prod',
        price: '19',
      } as never)
    ).resolves.toEqual([
      {
        plan_cross_sell_id: 'cs-1',
        plan_product_id: EPlanProduct.integration,
        quantity: 2,
        price: 19.9,
        created_at: '2026-04-21T00:00:00.000Z',
        plan_product: {
          plan_product_id: EPlanProduct.integration,
          name: 'Produto',
          description: 'Desc',
        },
      },
    ]);
  });

  it('returns cross sell total count and zero fallback', async () => {
    const withCount = createDbRoWithExecuteQueue([[{ count: 3 }]]);
    const repositoryWithCount = new CrossSellListerRepository(
      withCount.dbRo as never
    );

    await expect(
      repositoryWithCount.listCrossSellsTotal({} as never)
    ).resolves.toBe(3);

    const withoutCount = createDbRoWithExecuteQueue([[]]);
    const repositoryWithoutCount = new CrossSellListerRepository(
      withoutCount.dbRo as never
    );

    await expect(
      repositoryWithoutCount.listCrossSellsTotal({} as never)
    ).resolves.toBe(0);
  });

  it('listAvailableCrossSells returns empty when no cross sells exist', async () => {
    const { dbRo } = createDbRoWithExecuteQueue([[]]);
    const repository = new CrossSellListerRepository(dbRo as never);

    await expect(repository.listAvailableCrossSells()).resolves.toEqual([]);
  });

  it('listAvailableCrossSells maps default payload when account is absent', async () => {
    const rows = [
      {
        plan_cross_sell_id: 'cs-1',
        plan_product_id: EPlanProduct.integration,
        quantity: 2,
        price: '19.9',
        created_at: '2026-04-21T00:00:00.000Z',
        plan_product: {
          plan_product_id: EPlanProduct.integration,
          name: 'Produto',
          description: 'Desc',
        },
      },
    ];
    const { dbRo } = createDbRoWithExecuteQueue([rows]);
    const repository = new CrossSellListerRepository(dbRo as never);

    await expect(repository.listAvailableCrossSells()).resolves.toEqual([
      {
        plan_cross_sell_id: 'cs-1',
        plan_product_id: EPlanProduct.integration,
        quantity: 2,
        price: 19.9,
        price_per_cycle: 19.9,
        price_proportional: 19.9,
        billing_period: null,
        days_remaining: 0,
        total_days: 0,
        active_quantity: 0,
        renewable_quantity: 0,
        active_instances: 0,
        renewable_instances: 0,
        is_single_use: true,
        can_purchase: true,
        created_at: '2026-04-21T00:00:00.000Z',
        plan_product: {
          plan_product_id: EPlanProduct.integration,
          name: 'Produto',
          description: 'Desc',
        },
      },
    ]);
  });

  it('listAvailableCrossSells with account computes proportional pricing and single-use purchase restriction', async () => {
    const now = new Date();
    const last = new Date(now);
    last.setDate(last.getDate() - 10);
    const next = new Date(now);
    next.setDate(next.getDate() + 20);

    const crossSells = [
      {
        plan_cross_sell_id: 'cs-1',
        plan_product_id: EPlanProduct.personalization,
        quantity: 1,
        price: '30',
        created_at: '2026-04-21T00:00:00.000Z',
        plan_product: {
          plan_product_id: EPlanProduct.personalization,
          name: 'Personalizacao',
          description: null,
        },
      },
    ];

    const activePlanAccount = [
      {
        plan_id: 'plan-1',
        billing_period_id: 'monthly',
        billing_period_name: 'monthly',
        next_payment_date: next.toISOString(),
        last_payment_date: last.toISOString(),
      },
    ];

    const accountCrossSells = [
      {
        plan_cross_sell_account_id: 'csa-1',
        plan_cross_sell_id: 'cs-1',
        cancellation_date: null,
        deleted_at: null,
      },
    ];

    const activePlanItems: Array<{
      plan_product_id: string;
      quantity: number;
    }> = [];

    const { dbRo } = createDbRoWithExecuteQueue([
      crossSells,
      activePlanAccount,
      accountCrossSells,
      activePlanItems,
    ]);
    const repository = new CrossSellListerRepository(dbRo as never);

    const result = await repository.listAvailableCrossSells({
      accountId: 'acc-1',
      pricingMode: 'proportional',
    });

    expect(result).toHaveLength(1);
    expect(result[0].price_per_cycle).toBe(30);
    expect(result[0].price_proportional).toBeLessThan(30);
    expect(result[0].active_instances).toBe(1);
    expect(result[0].renewable_instances).toBe(1);
    expect(result[0].is_single_use).toBe(true);
    expect(result[0].can_purchase).toBe(false);
  });

  it('listAvailableCrossSells with proportional mode and no active plan disables purchase', async () => {
    const crossSells = [
      {
        plan_cross_sell_id: 'cs-2',
        plan_product_id: 'prod-2',
        quantity: 1,
        price: '10',
        created_at: '2026-04-21T00:00:00.000Z',
        plan_product: {
          plan_product_id: 'prod-2',
          name: 'Produto 2',
          description: null,
        },
      },
    ];

    const { dbRo } = createDbRoWithExecuteQueue([crossSells, [], []]);
    const repository = new CrossSellListerRepository(dbRo as never);

    const result = await repository.listAvailableCrossSells({
      accountId: 'acc-1',
      pricingMode: 'proportional',
    });

    expect(result[0].can_purchase).toBe(false);
    expect(result[0].price_proportional).toBe(10);
  });
});
