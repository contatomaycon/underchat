import 'reflect-metadata';
import { currentTime } from '@core/common/functions/currentTime';
import { CrossSellAccountDeleterRepository } from '@core/repositories/planCrossSell/CrossSellAccountDeleter.repository';

jest.mock('@core/common/functions/currentTime', () => ({
  currentTime: jest.fn(() => '2026-04-21T12:00:00.000Z'),
}));

function createTx(rowCount?: number) {
  const execute = jest.fn(async () => ({ rowCount }));
  const where = jest.fn(() => ({ execute }));
  const set = jest.fn(() => ({ where }));
  const update = jest.fn(() => ({ set }));

  return {
    tx: { update },
    set,
  };
}

describe('CrossSellAccountDeleterRepository', () => {
  it('sets deleted_at using current time', async () => {
    const { tx, set } = createTx(1);
    const repository = new CrossSellAccountDeleterRepository({} as never);

    await expect(
      repository.deleteCrossSellAccountsByCrossSellId(tx as never, 'cs-1')
    ).resolves.toBe(true);
    expect(currentTime).toHaveBeenCalled();
    expect(set).toHaveBeenCalledWith({
      deleted_at: '2026-04-21T12:00:00.000Z',
    });
  });

  it('returns true even when rowCount is zero (current implementation)', async () => {
    const { tx } = createTx(0);
    const repository = new CrossSellAccountDeleterRepository({} as never);

    await expect(
      repository.deleteCrossSellAccountsByCrossSellId(tx as never, 'cs-1')
    ).resolves.toBe(true);
  });
});
