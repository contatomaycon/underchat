import 'reflect-metadata';

jest.mock('@core/services/account.service', () => ({
  AccountService: class {},
}));

import { PlanAccountExclusiveListerUseCase } from '@core/useCases/planAccountExclusive/PlanAccountExclusiveLister.useCase';

describe('PlanAccountExclusiveListerUseCase', () => {
  it('throws when account does not exist', async () => {
    const service = {
      existsAccountById: jest.fn(async () => false),
      listPlanAccountExclusives: jest.fn(),
    };
    const useCase = new PlanAccountExclusiveListerUseCase(service as never);
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, 'acc-1')).rejects.toThrow(
      'account_not_found'
    );
    expect(service.listPlanAccountExclusives).not.toHaveBeenCalled();
  });

  it('returns exclusives when account exists', async () => {
    const exclusives = { results: [] };
    const service = {
      existsAccountById: jest.fn(async () => true),
      listPlanAccountExclusives: jest.fn(async () => exclusives),
    };
    const useCase = new PlanAccountExclusiveListerUseCase(service as never);

    await expect(useCase.execute(jest.fn() as never, 'acc-1')).resolves.toEqual(
      exclusives
    );
    expect(service.listPlanAccountExclusives).toHaveBeenCalledWith('acc-1');
  });
});
