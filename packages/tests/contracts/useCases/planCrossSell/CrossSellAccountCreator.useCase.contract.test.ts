import 'reflect-metadata';

jest.mock('@core/services/crossSell.service', () => ({
  CrossSellService: class {},
}));

import { CrossSellAccountCreatorUseCase } from '@core/useCases/planCrossSell/CrossSellAccountCreator.useCase';

describe('CrossSellAccountCreatorUseCase', () => {
  it('throws when plan_cross_sell_id is missing', async () => {
    const service = { createCrossSellAccount: jest.fn() };
    const useCase = new CrossSellAccountCreatorUseCase(service as never);
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, {} as never)).rejects.toThrow(
      'plan_cross_sell_id_required'
    );
    expect(service.createCrossSellAccount).not.toHaveBeenCalled();
  });

  it('throws when account_id is missing', async () => {
    const service = { createCrossSellAccount: jest.fn() };
    const useCase = new CrossSellAccountCreatorUseCase(service as never);
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, { plan_cross_sell_id: 'pcs-1' } as never)
    ).rejects.toThrow('account_id_required');
    expect(service.createCrossSellAccount).not.toHaveBeenCalled();
  });

  it('throws when creation fails', async () => {
    const service = { createCrossSellAccount: jest.fn(async () => '') };
    const useCase = new CrossSellAccountCreatorUseCase(service as never);
    const t = jest.fn((key: string) => key);
    const input = {
      plan_cross_sell_id: 'pcs-1',
      account_id: 'acc-1',
    } as never;

    await expect(useCase.execute(t as never, input)).rejects.toThrow(
      'cross_sell_account_creation_failed'
    );
  });

  it('returns created cross sell account id on success', async () => {
    const service = { createCrossSellAccount: jest.fn(async () => 'pcsa-1') };
    const useCase = new CrossSellAccountCreatorUseCase(service as never);
    const input = {
      plan_cross_sell_id: 'pcs-1',
      account_id: 'acc-1',
    } as never;

    await expect(useCase.execute(jest.fn() as never, input)).resolves.toBe(
      'pcsa-1'
    );
    expect(service.createCrossSellAccount).toHaveBeenCalledWith(input);
  });
});
