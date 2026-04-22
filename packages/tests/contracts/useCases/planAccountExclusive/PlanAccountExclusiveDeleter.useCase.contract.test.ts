import 'reflect-metadata';

jest.mock('@core/services/account.service', () => ({
  AccountService: class {},
}));

import { PlanAccountExclusiveDeleterUseCase } from '@core/useCases/planAccountExclusive/PlanAccountExclusiveDeleter.useCase';

describe('PlanAccountExclusiveDeleterUseCase', () => {
  it('throws when deletion fails', async () => {
    const service = {
      deletePlanAccountExclusive: jest.fn(async () => false),
    };
    const useCase = new PlanAccountExclusiveDeleterUseCase(service as never);
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, 'pae-1')).rejects.toThrow(
      'plan_account_exclusive_delete_failed'
    );
  });

  it('returns true when deletion succeeds', async () => {
    const service = {
      deletePlanAccountExclusive: jest.fn(async () => true),
    };
    const useCase = new PlanAccountExclusiveDeleterUseCase(service as never);

    await expect(useCase.execute(jest.fn() as never, 'pae-1')).resolves.toBe(
      true
    );
  });
});
