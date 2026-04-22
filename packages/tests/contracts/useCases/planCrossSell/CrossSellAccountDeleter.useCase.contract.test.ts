import 'reflect-metadata';

jest.mock('@core/services/crossSell.service', () => ({
  CrossSellService: class {},
}));

import { CrossSellAccountDeleterUseCase } from '@core/useCases/planCrossSell/CrossSellAccountDeleter.useCase';

describe('CrossSellAccountDeleterUseCase', () => {
  it('throws when deletion fails', async () => {
    const service = { deleteCrossSellAccount: jest.fn(async () => false) };
    const useCase = new CrossSellAccountDeleterUseCase(service as never);
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, 'pcsa-1')).rejects.toThrow(
      'cross_sell_account_delete_failed'
    );
  });

  it('returns true when deletion succeeds', async () => {
    const service = { deleteCrossSellAccount: jest.fn(async () => true) };
    const useCase = new CrossSellAccountDeleterUseCase(service as never);

    await expect(useCase.execute(jest.fn() as never, 'pcsa-1')).resolves.toBe(
      true
    );
  });
});
