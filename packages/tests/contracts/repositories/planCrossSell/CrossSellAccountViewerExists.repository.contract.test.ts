import 'reflect-metadata';
import { CrossSellAccountViewerExistsRepository } from '@core/repositories/planCrossSell/CrossSellAccountViewerExists.repository';

function createTx(result: unknown[]) {
  const execute = jest.fn(async () => result);
  const limit = jest.fn(() => ({ execute }));
  const where = jest.fn(() => ({ limit }));
  const from = jest.fn(() => ({ where }));
  const select = jest.fn(() => ({ from }));

  return {
    tx: { select },
  };
}

describe('CrossSellAccountViewerExistsRepository', () => {
  it('returns false when tx query has no rows', async () => {
    const { tx } = createTx([]);
    const repository = new CrossSellAccountViewerExistsRepository({} as never);

    await expect(
      repository.existsCrossSellAccountsByCrossSellId(tx as never, 'cs-1')
    ).resolves.toBe(false);
  });

  it('returns true when tx query has at least one row', async () => {
    const { tx } = createTx([{ id: 1 }]);
    const repository = new CrossSellAccountViewerExistsRepository({} as never);

    await expect(
      repository.existsCrossSellAccountsByCrossSellId(tx as never, 'cs-1')
    ).resolves.toBe(true);
  });
});
