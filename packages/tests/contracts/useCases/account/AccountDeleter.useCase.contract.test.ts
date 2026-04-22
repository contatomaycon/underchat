import 'reflect-metadata';

jest.mock('@core/services/account.service', () => ({
  AccountService: class {},
}));
jest.mock('@core/services/apiKey.service', () => ({
  ApiKeyService: class {},
}));
jest.mock('@core/services/planAccountCancellation.service', () => ({
  PlanAccountCancellationService: class {},
}));

import { AccountDeleterUseCase } from '@core/useCases/account/AccountDeleter.useCase';

describe('AccountDeleterUseCase', () => {
  it('throws when account does not exist', async () => {
    const accountService = {
      existsAccountById: jest.fn(async () => false),
      deleteAccountById: jest.fn(),
    };
    const apiKeyService = {
      deleteApiKey: jest.fn(),
    };
    const planAccountCancellationService = {
      cancelPlanAccount: jest.fn(),
    };
    const useCase = new AccountDeleterUseCase(
      accountService as never,
      apiKeyService as never,
      planAccountCancellationService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, 'acc-1')).rejects.toThrow(
      'account_not_found'
    );
    expect(
      planAccountCancellationService.cancelPlanAccount
    ).not.toHaveBeenCalled();
  });

  it('ignores plan cancellation when plan is already cancelled', async () => {
    const accountService = {
      existsAccountById: jest.fn(async () => true),
      deleteAccountById: jest.fn(async () => true),
    };
    const apiKeyService = {
      deleteApiKey: jest.fn(async () => true),
    };
    const planAccountCancellationService = {
      cancelPlanAccount: jest.fn(async () => {
        throw new Error('plan_not_found_or_already_cancelled');
      }),
    };
    const useCase = new AccountDeleterUseCase(
      accountService as never,
      apiKeyService as never,
      planAccountCancellationService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, 'acc-1')).resolves.toBe(true);
  });

  it('continues deletion when plan cancellation throws generic error', async () => {
    const accountService = {
      existsAccountById: jest.fn(async () => true),
      deleteAccountById: jest.fn(async () => true),
    };
    const apiKeyService = {
      deleteApiKey: jest.fn(async () => true),
    };
    const planAccountCancellationService = {
      cancelPlanAccount: jest.fn(async () => {
        throw new Error('network-error');
      }),
    };
    const useCase = new AccountDeleterUseCase(
      accountService as never,
      apiKeyService as never,
      planAccountCancellationService as never
    );
    const spyWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(useCase.execute(jest.fn() as never, 'acc-1')).resolves.toBe(
      true
    );
    expect(spyWarn).toHaveBeenCalled();
    spyWarn.mockRestore();
  });

  it('throws when account deletion fails', async () => {
    const accountService = {
      existsAccountById: jest.fn(async () => true),
      deleteAccountById: jest.fn(async () => false),
    };
    const apiKeyService = {
      deleteApiKey: jest.fn(),
    };
    const planAccountCancellationService = {
      cancelPlanAccount: jest.fn(async () => undefined),
    };
    const useCase = new AccountDeleterUseCase(
      accountService as never,
      apiKeyService as never,
      planAccountCancellationService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, 'acc-1')).rejects.toThrow(
      'account_deleter_error'
    );
    expect(apiKeyService.deleteApiKey).not.toHaveBeenCalled();
  });

  it('throws when api key deletion fails', async () => {
    const accountService = {
      existsAccountById: jest.fn(async () => true),
      deleteAccountById: jest.fn(async () => true),
    };
    const apiKeyService = {
      deleteApiKey: jest.fn(async () => false),
    };
    const planAccountCancellationService = {
      cancelPlanAccount: jest.fn(async () => undefined),
    };
    const useCase = new AccountDeleterUseCase(
      accountService as never,
      apiKeyService as never,
      planAccountCancellationService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, 'acc-1')).rejects.toThrow(
      'api_key_deleter_error'
    );
  });

  it('returns true when account and api key are deleted', async () => {
    const accountService = {
      existsAccountById: jest.fn(async () => true),
      deleteAccountById: jest.fn(async () => true),
    };
    const apiKeyService = {
      deleteApiKey: jest.fn(async () => true),
    };
    const planAccountCancellationService = {
      cancelPlanAccount: jest.fn(async () => undefined),
    };
    const useCase = new AccountDeleterUseCase(
      accountService as never,
      apiKeyService as never,
      planAccountCancellationService as never
    );

    await expect(useCase.execute(jest.fn() as never, 'acc-1')).resolves.toBe(
      true
    );
  });
});
