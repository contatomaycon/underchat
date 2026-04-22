import 'reflect-metadata';

jest.mock('@core/services/account.service', () => ({
  AccountService: class {},
}));

import { PlanAccountExclusiveCreatorUseCase } from '@core/useCases/planAccountExclusive/PlanAccountExclusiveCreator.useCase';

describe('PlanAccountExclusiveCreatorUseCase', () => {
  it('throws when account does not exist', async () => {
    const service = {
      existsAccountById: jest.fn(async () => false),
      createPlanAccountExclusive: jest.fn(),
    };
    const useCase = new PlanAccountExclusiveCreatorUseCase(service as never);
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, { account_id: 'acc-1' } as never)
    ).rejects.toThrow('account_not_found');
    expect(service.createPlanAccountExclusive).not.toHaveBeenCalled();
  });

  it('throws when creation fails', async () => {
    const service = {
      existsAccountById: jest.fn(async () => true),
      createPlanAccountExclusive: jest.fn(async () => ''),
    };
    const useCase = new PlanAccountExclusiveCreatorUseCase(service as never);
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, { account_id: 'acc-1' } as never)
    ).rejects.toThrow('plan_account_exclusive_creation_failed');
  });

  it('returns id when creation succeeds', async () => {
    const input = { account_id: 'acc-1' } as never;
    const service = {
      existsAccountById: jest.fn(async () => true),
      createPlanAccountExclusive: jest.fn(async () => 'pae-1'),
    };
    const useCase = new PlanAccountExclusiveCreatorUseCase(service as never);

    await expect(useCase.execute(jest.fn() as never, input)).resolves.toBe(
      'pae-1'
    );
    expect(service.createPlanAccountExclusive).toHaveBeenCalledWith(input);
  });
});
