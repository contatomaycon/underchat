import 'reflect-metadata';
import { AccountPlanProductIdsListerRepository } from '@core/repositories/account/AccountPlanProductIdsLister.repository';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';

function createSelectDistinctQueue(results: unknown[][]) {
  const chains = results.map((result) => {
    const chain: Record<string, jest.Mock> = {};
    chain.from = jest.fn(() => chain);
    chain.innerJoin = jest.fn(() => chain);
    chain.where = jest.fn(() => chain);
    chain.execute = jest.fn(async () => result);
    return chain;
  });

  return {
    db: {
      selectDistinct: jest.fn(() => chains.shift()),
    },
  };
}

describe('AccountPlanProductIdsListerRepository', () => {
  it('lists unique active plan products from plan items and cross sells', async () => {
    const { db } = createSelectDistinctQueue([
      [
        { plan_product_id: 'product-plan' },
        { plan_product_id: 'product-shared' },
      ],
      [
        { plan_product_id: 'product-addon' },
        { plan_product_id: 'product-shared' },
      ],
    ]);
    const getIntegrationEntitlement = jest.fn(async () => ({ allowed: true }));
    const repository = new AccountPlanProductIdsListerRepository(
      db as never,
      {
        getIntegrationEntitlement,
      } as never
    );

    await expect(
      repository.listActivePlanProductIds('account-1')
    ).resolves.toEqual([
      'product-plan',
      'product-shared',
      'product-addon',
      EPlanProduct.integration,
    ]);

    expect(db.selectDistinct).toHaveBeenCalledTimes(2);
    expect(getIntegrationEntitlement).toHaveBeenCalledWith('account-1', {
      bypassCache: false,
    });
  });

  it('removes stale Integration rows when the authoritative entitlement denies access', async () => {
    const { db } = createSelectDistinctQueue([
      [{ plan_product_id: EPlanProduct.integration }],
      [{ plan_product_id: EPlanProduct.integration }],
    ]);
    const getIntegrationEntitlement = jest.fn(async () => ({ allowed: false }));
    const repository = new AccountPlanProductIdsListerRepository(
      db as never,
      {
        getIntegrationEntitlement,
      } as never
    );

    await expect(
      repository.listActivePlanProductIds('account-1', {
        bypassIntegrationCache: true,
      })
    ).resolves.toEqual([]);
    expect(getIntegrationEntitlement).toHaveBeenCalledWith('account-1', {
      bypassCache: true,
    });
  });
});
