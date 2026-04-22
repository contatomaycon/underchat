import 'reflect-metadata';

jest.mock('@core/services/crossSell.service', () => ({
  CrossSellService: class {},
}));

import { CrossSellAccountListerUseCase } from '@core/useCases/planCrossSell/CrossSellAccountLister.useCase';

describe('CrossSellAccountListerUseCase', () => {
  it('throws when cross sell id is missing', async () => {
    const service = { listCrossSellAccounts: jest.fn() };
    const useCase = new CrossSellAccountListerUseCase(service as never);
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, '')).rejects.toThrow(
      'cross_sell_id_required'
    );
    expect(service.listCrossSellAccounts).not.toHaveBeenCalled();
  });

  it('returns accounts from service', async () => {
    const accounts = [{ account_id: 'acc-1' }];
    const service = {
      listCrossSellAccounts: jest.fn(async () => accounts),
    };
    const useCase = new CrossSellAccountListerUseCase(service as never);

    await expect(useCase.execute(jest.fn() as never, 'pcs-1')).resolves.toEqual(
      accounts
    );
    expect(service.listCrossSellAccounts).toHaveBeenCalledWith('pcs-1');
  });
});
