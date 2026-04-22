import 'reflect-metadata';

jest.mock(
  '@core/repositories/accountSettings/AccountAddonCanceller.repository',
  () => ({
    AccountAddonCancellerRepository: class {},
  })
);

import { AccountAddonCancellerUseCase } from '@core/useCases/accountSettings/AccountAddonCanceller.useCase';

describe('AccountAddonCancellerUseCase', () => {
  it('throws when addon does not exist', async () => {
    const repository = {
      findAddonById: jest.fn(async () => null),
      hasActivePlanCycle: jest.fn(),
      scheduleAddonCancellation: jest.fn(),
    };
    const useCase = new AccountAddonCancellerUseCase(repository as never);
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'acc-1', 'addon-1')
    ).rejects.toThrow('addon_not_found_or_already_cancelled');
    expect(repository.hasActivePlanCycle).not.toHaveBeenCalled();
    expect(repository.scheduleAddonCancellation).not.toHaveBeenCalled();
  });

  it('throws when addon is already cancelled', async () => {
    const repository = {
      findAddonById: jest.fn(async () => ({ cancellation_date: '2026-01-01' })),
      hasActivePlanCycle: jest.fn(),
      scheduleAddonCancellation: jest.fn(),
    };
    const useCase = new AccountAddonCancellerUseCase(repository as never);
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'acc-1', 'addon-1')
    ).rejects.toThrow('addon_not_found_or_already_cancelled');
    expect(repository.hasActivePlanCycle).not.toHaveBeenCalled();
  });

  it('throws when account has no active cycle', async () => {
    const repository = {
      findAddonById: jest.fn(async () => ({ cancellation_date: null })),
      hasActivePlanCycle: jest.fn(async () => false),
      scheduleAddonCancellation: jest.fn(),
    };
    const useCase = new AccountAddonCancellerUseCase(repository as never);
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'acc-1', 'addon-1')
    ).rejects.toThrow('addon_cancel_requires_active_cycle');
    expect(repository.scheduleAddonCancellation).not.toHaveBeenCalled();
  });

  it('throws when scheduling cancellation fails', async () => {
    const repository = {
      findAddonById: jest.fn(async () => ({ cancellation_date: null })),
      hasActivePlanCycle: jest.fn(async () => true),
      scheduleAddonCancellation: jest.fn(async () => false),
    };
    const useCase = new AccountAddonCancellerUseCase(repository as never);
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'acc-1', 'addon-1')
    ).rejects.toThrow('addon_cancel_failed');
  });

  it('returns success when addon cancellation is scheduled', async () => {
    const repository = {
      findAddonById: jest.fn(async () => ({ cancellation_date: null })),
      hasActivePlanCycle: jest.fn(async () => true),
      scheduleAddonCancellation: jest.fn(async () => true),
    };
    const useCase = new AccountAddonCancellerUseCase(repository as never);
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'acc-1', 'addon-1')
    ).resolves.toEqual({
      success: true,
      message: 'addon_cancelled_successfully',
    });

    expect(repository.scheduleAddonCancellation).toHaveBeenCalledWith({
      accountId: 'acc-1',
      planCrossSellAccountId: 'addon-1',
      cancellationDate: expect.any(String),
    });
  });
});
