import 'reflect-metadata';
import { PlanProductWithPriceListerRepository } from '@core/repositories/plan/PlanProductWithPriceLister.repository';

function createSelectStep(result: unknown[]) {
  const execute = jest.fn(async () => result);
  const where = jest.fn(() => ({ execute }));
  const innerJoin = jest.fn(() => ({ where, execute }));
  const from = jest.fn(() => ({ innerJoin, where, execute }));
  const select = jest.fn(() => ({ from }));
  return { select };
}

describe('PlanProductWithPriceListerRepository', () => {
  it('returns empty list when there are no products', async () => {
    const productsStep = createSelectStep([]);
    const repository = new PlanProductWithPriceListerRepository({
      select: productsStep.select,
    } as never);

    await expect(repository.listPlanProductWithPrice()).resolves.toEqual([]);
  });

  it('combines products with first available cross-sell price', async () => {
    const productsStep = createSelectStep([
      {
        plan_product_id: 'prod-1',
        name: 'Users',
        description: 'Extra users',
      },
      {
        plan_product_id: 'prod-2',
        name: null,
        description: null,
      },
    ]);

    const crossSellStep = createSelectStep([
      {
        plan_product_id: 'prod-1',
        price: '19.9',
      },
      {
        plan_product_id: 'prod-1',
        price: '29.9',
      },
    ]);

    const select = jest
      .fn()
      .mockImplementationOnce(productsStep.select)
      .mockImplementationOnce(crossSellStep.select);

    const repository = new PlanProductWithPriceListerRepository({
      select,
    } as never);

    await expect(repository.listPlanProductWithPrice()).resolves.toEqual([
      {
        plan_product_id: 'prod-1',
        name: 'Users',
        description: 'Extra users',
        price: 19.9,
      },
      {
        plan_product_id: 'prod-2',
        name: null,
        description: null,
        price: null,
      },
    ]);
  });
});
