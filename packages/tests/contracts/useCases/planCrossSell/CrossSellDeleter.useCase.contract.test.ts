import 'reflect-metadata';

jest.mock('@core/services/crossSell.service', () => ({
  CrossSellService: class {},
}));

import { CrossSellDeleterUseCase } from '@core/useCases/planCrossSell/CrossSellDeleter.useCase';

describe('CrossSellDeleterUseCase', () => {
  it('throws when deletion fails', async () => {
    const service = { deleteCrossSell: jest.fn(async () => false) };
    const useCase = new CrossSellDeleterUseCase(service as never);
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, 'pcs-1')).rejects.toThrow(
      'cross_sell_delete_failed'
    );
  });

  it('returns true when deletion succeeds', async () => {
    const service = { deleteCrossSell: jest.fn(async () => true) };
    const useCase = new CrossSellDeleterUseCase(service as never);

    await expect(useCase.execute(jest.fn() as never, 'pcs-1')).resolves.toBe(
      true
    );
    expect(service.deleteCrossSell).toHaveBeenCalledWith(
      expect.any(Function),
      'pcs-1'
    );
  });
});
