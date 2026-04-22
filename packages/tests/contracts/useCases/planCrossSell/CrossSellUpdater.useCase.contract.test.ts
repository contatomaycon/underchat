import 'reflect-metadata';

jest.mock('@core/services/crossSell.service', () => ({
  CrossSellService: class {},
}));

import { CrossSellUpdaterUseCase } from '@core/useCases/planCrossSell/CrossSellUpdater.useCase';

describe('CrossSellUpdaterUseCase', () => {
  it('throws when quantity is invalid', async () => {
    const service = { updateCrossSell: jest.fn() };
    const useCase = new CrossSellUpdaterUseCase(service as never);
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'pcs-1', { quantity: 0 } as never)
    ).rejects.toThrow('cross_sell_quantity_invalid');
    expect(service.updateCrossSell).not.toHaveBeenCalled();
  });

  it('throws when price is invalid', async () => {
    const service = { updateCrossSell: jest.fn() };
    const useCase = new CrossSellUpdaterUseCase(service as never);
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'pcs-1', { price: -1 } as never)
    ).rejects.toThrow('cross_sell_price_invalid');
    expect(service.updateCrossSell).not.toHaveBeenCalled();
  });

  it('throws when update operation fails', async () => {
    const service = { updateCrossSell: jest.fn(async () => false) };
    const useCase = new CrossSellUpdaterUseCase(service as never);
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'pcs-1', { quantity: 1, price: 0 } as never)
    ).rejects.toThrow('cross_sell_update_failed');
  });

  it('returns true when update succeeds', async () => {
    const input = { quantity: 2, price: 10 } as never;
    const service = { updateCrossSell: jest.fn(async () => true) };
    const useCase = new CrossSellUpdaterUseCase(service as never);

    await expect(
      useCase.execute(jest.fn() as never, 'pcs-1', input)
    ).resolves.toBe(true);
    expect(service.updateCrossSell).toHaveBeenCalledWith('pcs-1', input);
  });
});
