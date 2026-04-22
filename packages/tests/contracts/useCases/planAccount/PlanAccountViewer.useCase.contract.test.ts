import 'reflect-metadata';

jest.mock('@core/services/planAccount.service', () => ({
  PlanAccountService: class {},
}));
jest.mock('@core/services/account.service', () => ({
  AccountService: class {},
}));

import { PlanAccountViewerUseCase } from '@core/useCases/planAccount/PlanAccountViewer.useCase';

describe('PlanAccountViewerUseCase', () => {
  it('throws when account does not exist', async () => {
    const planAccountService = {
      findPlanAccountByAccountId: jest.fn(),
    };
    const accountService = {
      existsAccountById: jest.fn(async () => false),
    };
    const useCase = new PlanAccountViewerUseCase(
      planAccountService as never,
      accountService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, 'acc-1')).rejects.toThrow(
      'account_not_found'
    );
    expect(
      planAccountService.findPlanAccountByAccountId
    ).not.toHaveBeenCalled();
  });

  it('returns null when plan account is not found', async () => {
    const planAccountService = {
      findPlanAccountByAccountId: jest.fn(async () => null),
    };
    const accountService = {
      existsAccountById: jest.fn(async () => true),
    };
    const useCase = new PlanAccountViewerUseCase(
      planAccountService as never,
      accountService as never
    );

    await expect(
      useCase.execute(jest.fn() as never, 'acc-1')
    ).resolves.toBeNull();
  });

  it('returns mapped plan account response', async () => {
    const planAccount = {
      plan_account_id: 'pa-1',
      plan_id: 'plan-1',
      recurring_payment: true,
      billing_period_id: 'month',
      last_payment_date: '2026-01-01',
      next_payment_date: '2026-02-01',
      cancellation_date: null,
      value: 99.9,
    };
    const planAccountService = {
      findPlanAccountByAccountId: jest.fn(async () => planAccount),
    };
    const accountService = {
      existsAccountById: jest.fn(async () => true),
    };
    const useCase = new PlanAccountViewerUseCase(
      planAccountService as never,
      accountService as never
    );

    await expect(useCase.execute(jest.fn() as never, 'acc-1')).resolves.toEqual(
      planAccount
    );
  });
});
