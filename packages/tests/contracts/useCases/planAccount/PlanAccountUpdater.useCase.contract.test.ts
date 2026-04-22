import 'reflect-metadata';

jest.mock('@core/services/planAccount.service', () => ({
  PlanAccountService: class {},
}));
jest.mock('@core/services/account.service', () => ({
  AccountService: class {},
}));

import { PlanAccountUpdaterUseCase } from '@core/useCases/planAccount/PlanAccountUpdater.useCase';

describe('PlanAccountUpdaterUseCase', () => {
  it('throws when account does not exist', async () => {
    const planAccountService = {
      updatePlanAccountByAccountId: jest.fn(),
    };
    const accountService = {
      existsAccountById: jest.fn(async () => false),
    };
    const useCase = new PlanAccountUpdaterUseCase(
      planAccountService as never,
      accountService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'acc-1', { plan_id: 'plan-1' } as never)
    ).rejects.toThrow('account_not_found');
    expect(
      planAccountService.updatePlanAccountByAccountId
    ).not.toHaveBeenCalled();
  });

  it('throws when plan account update fails', async () => {
    const planAccountService = {
      updatePlanAccountByAccountId: jest.fn(async () => false),
    };
    const accountService = {
      existsAccountById: jest.fn(async () => true),
    };
    const useCase = new PlanAccountUpdaterUseCase(
      planAccountService as never,
      accountService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'acc-1', { plan_id: 'plan-1' } as never)
    ).rejects.toThrow('plan_account_update_error');
  });

  it('returns true when plan account update succeeds', async () => {
    const input = { plan_id: 'plan-1' } as never;
    const planAccountService = {
      updatePlanAccountByAccountId: jest.fn(async () => true),
    };
    const accountService = {
      existsAccountById: jest.fn(async () => true),
    };
    const useCase = new PlanAccountUpdaterUseCase(
      planAccountService as never,
      accountService as never
    );

    await expect(
      useCase.execute(jest.fn() as never, 'acc-1', input)
    ).resolves.toBe(true);
    expect(
      planAccountService.updatePlanAccountByAccountId
    ).toHaveBeenCalledWith('acc-1', input);
  });
});
