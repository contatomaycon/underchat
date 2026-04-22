import 'reflect-metadata';

jest.mock('@core/services/account.service', () => ({
  AccountService: class {},
}));

import { AccountSubscriptionsListerUseCase } from '@core/useCases/account/AccountSubscriptionsLister.useCase';

describe('AccountSubscriptionsListerUseCase', () => {
  it('throws when account does not exist', async () => {
    const accountService = {
      existsAccountById: jest.fn(async () => false),
      listAccountSubscriptions: jest.fn(),
    };
    const useCase = new AccountSubscriptionsListerUseCase(
      accountService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, 'acc-1')).rejects.toThrow(
      'account_not_found'
    );
    expect(accountService.listAccountSubscriptions).not.toHaveBeenCalled();
  });

  it('throws when subscriptions are not found', async () => {
    const accountService = {
      existsAccountById: jest.fn(async () => true),
      listAccountSubscriptions: jest.fn(async () => null),
    };
    const useCase = new AccountSubscriptionsListerUseCase(
      accountService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, 'acc-1')).rejects.toThrow(
      'account_subscriptions_not_found'
    );
  });

  it('returns account subscriptions', async () => {
    const subscriptions = [{ plan_id: 'plan-1' }];
    const accountService = {
      existsAccountById: jest.fn(async () => true),
      listAccountSubscriptions: jest.fn(async () => subscriptions),
    };
    const useCase = new AccountSubscriptionsListerUseCase(
      accountService as never
    );

    await expect(useCase.execute(jest.fn() as never, 'acc-1')).resolves.toEqual(
      subscriptions
    );
  });
});
