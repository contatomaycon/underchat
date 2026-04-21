import 'reflect-metadata';
import { v7 as uuidv7 } from 'uuid';
import { CrossSellAccountCreatorRepository } from '@core/repositories/planCrossSell/CrossSellAccountCreator.repository';
import { createInsertDbMock } from '@core/tests/helpers/drizzleMock';

jest.mock('uuid', () => ({
  v7: jest.fn(),
}));

describe('CrossSellAccountCreatorRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (uuidv7 as unknown as jest.Mock).mockReturnValue('cross-sell-account-id');
  });

  it('creates cross sell account and returns id', async () => {
    const { db, values } = createInsertDbMock({ rowCount: 1 });
    const repository = new CrossSellAccountCreatorRepository(db as never);

    await expect(
      repository.createCrossSellAccount({
        plan_cross_sell_id: 'cs-1',
        account_id: 'acc-1',
      } as never)
    ).resolves.toBe('cross-sell-account-id');

    expect(values).toHaveBeenCalledWith({
      plan_cross_sell_account_id: 'cross-sell-account-id',
      plan_cross_sell_id: 'cs-1',
      account_id: 'acc-1',
    });
  });

  it('returns null when insert result is null', async () => {
    const { db } = createInsertDbMock(null);
    const repository = new CrossSellAccountCreatorRepository(db as never);

    await expect(
      repository.createCrossSellAccount({
        plan_cross_sell_id: 'cs-1',
        account_id: 'acc-1',
      } as never)
    ).resolves.toBeNull();
  });
});
