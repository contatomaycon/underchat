import 'reflect-metadata';

jest.mock('@core/services/account.service', () => ({
  AccountService: class {},
}));

import { ExclusivePlansListerUseCase } from '@core/useCases/planAccountExclusive/ExclusivePlansLister.useCase';

describe('ExclusivePlansListerUseCase', () => {
  it('throws when account does not exist', async () => {
    const service = {
      existsAccountById: jest.fn(async () => false),
      listExclusivePlans: jest.fn(),
    };
    const useCase = new ExclusivePlansListerUseCase(service as never);
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, 'acc-1')).rejects.toThrow(
      'account_not_found'
    );
    expect(service.listExclusivePlans).not.toHaveBeenCalled();
  });

  it('returns exclusive plans when account exists', async () => {
    const plans = [{ plan_id: 'plan-1' }];
    const service = {
      existsAccountById: jest.fn(async () => true),
      listExclusivePlans: jest.fn(async () => plans),
    };
    const useCase = new ExclusivePlansListerUseCase(service as never);

    await expect(useCase.execute(jest.fn() as never, 'acc-1')).resolves.toEqual(
      plans
    );
    expect(service.listExclusivePlans).toHaveBeenCalledWith('acc-1');
  });
});
