import 'reflect-metadata';
import { v7 as uuidv7 } from 'uuid';
import { CrossSellCreatorRepository } from '@core/repositories/planCrossSell/CrossSellCreator.repository';
import { createInsertDbMock } from '@core/tests/helpers/drizzleMock';

jest.mock('uuid', () => ({
  v7: jest.fn(),
}));

describe('CrossSellCreatorRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (uuidv7 as unknown as jest.Mock).mockReturnValue('cross-sell-id');
  });

  it('creates cross sell and converts price to string', async () => {
    const { db, values } = createInsertDbMock({ rowCount: 1 });
    const repository = new CrossSellCreatorRepository(db as never);

    await expect(
      repository.createCrossSell({
        plan_product_id: 'prod-1',
        quantity: 2,
        price: 19.9,
      } as never)
    ).resolves.toBe('cross-sell-id');

    expect(values).toHaveBeenCalledWith({
      plan_cross_sell_id: 'cross-sell-id',
      plan_product_id: 'prod-1',
      quantity: 2,
      price: '19.9',
    });
  });

  it('returns null when insert result is null', async () => {
    const { db } = createInsertDbMock(null);
    const repository = new CrossSellCreatorRepository(db as never);

    await expect(
      repository.createCrossSell({
        plan_product_id: 'prod-1',
        quantity: 2,
        price: 19.9,
      } as never)
    ).resolves.toBeNull();
  });
});
