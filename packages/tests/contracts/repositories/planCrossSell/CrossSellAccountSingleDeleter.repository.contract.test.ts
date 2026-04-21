import 'reflect-metadata';
import { currentTime } from '@core/common/functions/currentTime';
import { CrossSellAccountSingleDeleterRepository } from '@core/repositories/planCrossSell/CrossSellAccountSingleDeleter.repository';
import { createUpdateDbMock } from '@core/tests/helpers/drizzleMock';

jest.mock('@core/common/functions/currentTime', () => ({
  currentTime: jest.fn(() => '2026-04-21T12:00:00.000Z'),
}));

describe('CrossSellAccountSingleDeleterRepository', () => {
  it('returns true when exactly one row is updated', async () => {
    const { db, set } = createUpdateDbMock({ rowCount: 1 });
    const repository = new CrossSellAccountSingleDeleterRepository(db as never);

    await expect(repository.deleteCrossSellAccountById('csa-1')).resolves.toBe(
      true
    );
    expect(currentTime).toHaveBeenCalled();
    expect(set).toHaveBeenCalledWith({
      deleted_at: '2026-04-21T12:00:00.000Z',
    });
  });

  it('returns false when update rowCount is not one', async () => {
    const { db } = createUpdateDbMock({ rowCount: 0 });
    const repository = new CrossSellAccountSingleDeleterRepository(db as never);

    await expect(repository.deleteCrossSellAccountById('csa-1')).resolves.toBe(
      false
    );
  });
});
