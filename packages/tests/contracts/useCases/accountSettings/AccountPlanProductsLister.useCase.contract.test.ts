import 'reflect-metadata';

jest.mock(
  '@core/repositories/accountSettings/AccountPlanProductsLister.repository',
  () => ({
    AccountPlanProductsListerRepository: class {},
  })
);

import { AccountPlanProductsListerUseCase } from '@core/useCases/accountSettings/AccountPlanProductsLister.useCase';

describe('AccountPlanProductsListerUseCase', () => {
  it('returns account plan products from repository', async () => {
    const response = [{ plan_product_id: 'prod-1' }];
    const repository = {
      listAccountPlanProducts: jest.fn(async () => response),
    };
    const useCase = new AccountPlanProductsListerUseCase(repository as never);

    await expect(useCase.execute('acc-1')).resolves.toEqual(response);
    expect(repository.listAccountPlanProducts).toHaveBeenCalledWith('acc-1');
  });
});
