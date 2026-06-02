import 'reflect-metadata';
import { AccountPlanProductIdsListerRepository } from '@core/repositories/account/AccountPlanProductIdsLister.repository';

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
    const repository = new AccountPlanProductIdsListerRepository(db as never);

    await expect(
      repository.listActivePlanProductIds('account-1')
    ).resolves.toEqual(['product-plan', 'product-shared', 'product-addon']);

    expect(db.selectDistinct).toHaveBeenCalledTimes(2);
  });
});
