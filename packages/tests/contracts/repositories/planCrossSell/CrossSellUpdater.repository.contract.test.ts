import 'reflect-metadata';
import { CrossSellUpdaterRepository } from '@core/repositories/planCrossSell/CrossSellUpdater.repository';
import { createUpdateDbMock } from '@core/tests/helpers/drizzleMock';

describe('CrossSellUpdaterRepository', () => {
  it('returns true and converts price to string', async () => {
    const { db, set } = createUpdateDbMock({ rowCount: 1 });
    const repository = new CrossSellUpdaterRepository(db as never);

    await expect(
      repository.updateCrossSell('cs-1', {
        plan_product_id: 'prod-1',
        quantity: 3,
        price: 49.9,
      } as never)
    ).resolves.toBe(true);

    expect(set).toHaveBeenCalledWith({
      plan_product_id: 'prod-1',
      quantity: 3,
      price: '49.9',
    });
  });

  it('returns false when update does not affect one row', async () => {
    const { db } = createUpdateDbMock({ rowCount: 0 });
    const repository = new CrossSellUpdaterRepository(db as never);

    await expect(
      repository.updateCrossSell('cs-1', {
        plan_product_id: 'prod-1',
      } as never)
    ).resolves.toBe(false);
  });
});
