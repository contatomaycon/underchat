import 'reflect-metadata';
import { AccountQuantityProductViewerRepository } from '@core/repositories/account/AccountQuantityProductViewer.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

describe('AccountQuantityProductViewerRepository', () => {
  it('viewPlanQuantity returns quantity when a row exists', async () => {
    const { db } = createSelectDbMock([{ quantity: 5 }]);
    const repository = new AccountQuantityProductViewerRepository(db as never);

    await expect(
      repository.viewPlanQuantity('acc-1', 'product-1')
    ).resolves.toBe(5);
  });

  it('viewPlanQuantity returns zero when no rows exist', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new AccountQuantityProductViewerRepository(db as never);

    await expect(
      repository.viewPlanQuantity('acc-1', 'product-1')
    ).resolves.toBe(0);
  });

  it('viewPlanCrossSellQuantity sums all quantities', async () => {
    const { db } = createSelectDbMock([{ quantity: 2 }, { quantity: 3 }]);
    const repository = new AccountQuantityProductViewerRepository(db as never);

    await expect(
      repository.viewPlanCrossSellQuantity('acc-1', 'product-1')
    ).resolves.toBe(5);
  });

  it('viewPlanCrossSellQuantity returns zero when no rows exist', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new AccountQuantityProductViewerRepository(db as never);

    await expect(
      repository.viewPlanCrossSellQuantity('acc-1', 'product-1')
    ).resolves.toBe(0);
  });

  it('viewAccountQuantityProduct sums plan and cross sell quantities', async () => {
    const repository = new AccountQuantityProductViewerRepository({} as never);
    const planSpy = jest
      .spyOn(repository, 'viewPlanQuantity')
      .mockResolvedValue(4);
    const crossSellSpy = jest
      .spyOn(repository, 'viewPlanCrossSellQuantity')
      .mockResolvedValue(6);

    await expect(
      repository.viewAccountQuantityProduct('acc-1', 'product-1')
    ).resolves.toBe(10);
    expect(planSpy).toHaveBeenCalledWith('acc-1', 'product-1');
    expect(crossSellSpy).toHaveBeenCalledWith('acc-1', 'product-1');
  });
});
