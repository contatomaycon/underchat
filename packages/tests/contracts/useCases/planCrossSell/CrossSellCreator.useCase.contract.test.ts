import 'reflect-metadata';

jest.mock('@core/services/crossSell.service', () => ({
  CrossSellService: class {},
}));

import { CrossSellCreatorUseCase } from '@core/useCases/planCrossSell/CrossSellCreator.useCase';

describe('CrossSellCreatorUseCase', () => {
  it('throws when plan_product_id is missing', async () => {
    const service = { createCrossSell: jest.fn() };
    const useCase = new CrossSellCreatorUseCase(service as never);
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, {} as never)).rejects.toThrow(
      'plan_product_id_required'
    );
    expect(service.createCrossSell).not.toHaveBeenCalled();
  });

  it('throws when quantity is invalid', async () => {
    const service = { createCrossSell: jest.fn() };
    const useCase = new CrossSellCreatorUseCase(service as never);
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(
        t as never,
        { plan_product_id: 'pp-1', quantity: 0, price: 10 } as never
      )
    ).rejects.toThrow('cross_sell_quantity_invalid');
  });

  it('throws when price is invalid', async () => {
    const service = { createCrossSell: jest.fn() };
    const useCase = new CrossSellCreatorUseCase(service as never);
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(
        t as never,
        { plan_product_id: 'pp-1', quantity: 1, price: -1 } as never
      )
    ).rejects.toThrow('cross_sell_price_invalid');
  });

  it('throws when creation fails', async () => {
    const service = { createCrossSell: jest.fn(async () => '') };
    const useCase = new CrossSellCreatorUseCase(service as never);
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(
        t as never,
        { plan_product_id: 'pp-1', quantity: 1, price: 0 } as never
      )
    ).rejects.toThrow('cross_sell_creation_failed');
  });

  it('returns cross sell id when creation succeeds', async () => {
    const input = { plan_product_id: 'pp-1', quantity: 1, price: 0 } as never;
    const service = { createCrossSell: jest.fn(async () => 'pcs-1') };
    const useCase = new CrossSellCreatorUseCase(service as never);

    await expect(useCase.execute(jest.fn() as never, input)).resolves.toBe(
      'pcs-1'
    );
    expect(service.createCrossSell).toHaveBeenCalledWith(input);
  });
});
