import 'reflect-metadata';

jest.mock('@core/services/account.service', () => ({
  AccountService: class {},
}));

import { AccountCreatorUseCase } from '@core/useCases/account/AccountCreator.useCase';

describe('AccountCreatorUseCase', () => {
  it('throws when account name has 10 or more characters', async () => {
    const accountService = {
      createAccountWithPlanAndApiKey: jest.fn(),
    };
    const useCase = new AccountCreatorUseCase(accountService as never);
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, { name: '1234567890' } as never)
    ).rejects.toThrow('account_name_cannot_exceed_10_characters');
    expect(
      accountService.createAccountWithPlanAndApiKey
    ).not.toHaveBeenCalled();
  });

  it('throws when plan exists without billing period', async () => {
    const accountService = {
      createAccountWithPlanAndApiKey: jest.fn(),
    };
    const useCase = new AccountCreatorUseCase(accountService as never);
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, { name: 'Acme', plan: {} } as never)
    ).rejects.toThrow('billing_period_required_when_plan_selected');
    expect(
      accountService.createAccountWithPlanAndApiKey
    ).not.toHaveBeenCalled();
  });

  it('throws when account creation fails', async () => {
    const accountService = {
      createAccountWithPlanAndApiKey: jest.fn(async () => null),
    };
    const useCase = new AccountCreatorUseCase(accountService as never);
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, { name: 'Acme' } as never)
    ).rejects.toThrow('account_creation_failed');
  });

  it('returns true when account is created', async () => {
    const accountService = {
      createAccountWithPlanAndApiKey: jest.fn(async () => 'acc-1'),
    };
    const useCase = new AccountCreatorUseCase(accountService as never);

    await expect(
      useCase.execute(
        jest.fn() as never,
        {
          name: 'Acme',
          plan: { billing_period: 'monthly' },
        } as never
      )
    ).resolves.toBe(true);
  });
});
