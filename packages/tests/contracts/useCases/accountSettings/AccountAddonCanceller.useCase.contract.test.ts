import 'reflect-metadata';

jest.mock(
  '@core/repositories/accountSettings/AccountAddonCanceller.repository',
  () => ({
    AccountAddonCancellerRepository: class {},
  })
);

import { AccountAddonCancellerUseCase } from '@core/useCases/accountSettings/AccountAddonCanceller.useCase';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';

const integrationAddon = (cancellationDate: string | null = null) => ({
  cancellation_date: cancellationDate,
  plan_product_id: EPlanProduct.integration,
});

function createPlanEntitlementServiceMock(
  ownerToken: string | null = 'fence-1'
) {
  return {
    installDenyFenceForCrossSellAccount: jest.fn(async () => ownerToken),
    refreshCrossSellAccount: jest.fn(async () => null),
  };
}

describe('AccountAddonCancellerUseCase', () => {
  it('throws when addon does not exist', async () => {
    const repository = {
      findAddonById: jest.fn(async () => null),
      hasActivePlanCycle: jest.fn(),
      scheduleAddonCancellation: jest.fn(),
    };
    const planEntitlementService = createPlanEntitlementServiceMock();
    const useCase = new AccountAddonCancellerUseCase(
      repository as never,
      planEntitlementService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'acc-1', 'addon-1')
    ).rejects.toThrow('addon_not_found_or_already_cancelled');
    expect(repository.hasActivePlanCycle).not.toHaveBeenCalled();
    expect(repository.scheduleAddonCancellation).not.toHaveBeenCalled();
    expect(
      planEntitlementService.installDenyFenceForCrossSellAccount
    ).not.toHaveBeenCalled();
  });

  it('throws when addon is already cancelled', async () => {
    const repository = {
      findAddonById: jest.fn(async () => integrationAddon('2026-01-01')),
      hasActivePlanCycle: jest.fn(),
      scheduleAddonCancellation: jest.fn(),
    };
    const useCase = new AccountAddonCancellerUseCase(
      repository as never,
      createPlanEntitlementServiceMock() as never
    );
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'acc-1', 'addon-1')
    ).rejects.toThrow('addon_not_found_or_already_cancelled');
    expect(repository.hasActivePlanCycle).not.toHaveBeenCalled();
  });

  it('throws when account has no active cycle', async () => {
    const repository = {
      findAddonById: jest.fn(async () => integrationAddon()),
      hasActivePlanCycle: jest.fn(async () => false),
      scheduleAddonCancellation: jest.fn(),
    };
    const useCase = new AccountAddonCancellerUseCase(
      repository as never,
      createPlanEntitlementServiceMock() as never
    );
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'acc-1', 'addon-1')
    ).rejects.toThrow('addon_cancel_requires_active_cycle');
    expect(repository.scheduleAddonCancellation).not.toHaveBeenCalled();
  });

  it('throws when scheduling cancellation fails', async () => {
    const repository = {
      findAddonById: jest.fn(async () => integrationAddon()),
      hasActivePlanCycle: jest.fn(async () => true),
      scheduleAddonCancellation: jest.fn(async () => false),
    };
    const planEntitlementService = createPlanEntitlementServiceMock();
    const useCase = new AccountAddonCancellerUseCase(
      repository as never,
      planEntitlementService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'acc-1', 'addon-1')
    ).rejects.toThrow('addon_cancel_failed');
    expect(
      planEntitlementService.installDenyFenceForCrossSellAccount
    ).toHaveBeenCalledWith('addon-1');
    expect(planEntitlementService.refreshCrossSellAccount).toHaveBeenCalledWith(
      'addon-1',
      'fence-1'
    );
  });

  it('returns success when addon cancellation is scheduled', async () => {
    const repository = {
      findAddonById: jest.fn(async () => integrationAddon()),
      hasActivePlanCycle: jest.fn(async () => true),
      scheduleAddonCancellation: jest.fn(async () => true),
    };
    const planEntitlementService = createPlanEntitlementServiceMock();
    const useCase = new AccountAddonCancellerUseCase(
      repository as never,
      planEntitlementService as never
    );
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
    expect(
      planEntitlementService.installDenyFenceForCrossSellAccount
    ).toHaveBeenCalledWith('addon-1');
    expect(planEntitlementService.refreshCrossSellAccount).toHaveBeenCalledWith(
      'addon-1',
      'fence-1'
    );
  });

  it('does not require a cache refresh when Integration was already denied', async () => {
    const repository = {
      findAddonById: jest.fn(async () => integrationAddon()),
      hasActivePlanCycle: jest.fn(async () => true),
      scheduleAddonCancellation: jest.fn(async () => true),
    };
    const planEntitlementService = createPlanEntitlementServiceMock(null);
    const useCase = new AccountAddonCancellerUseCase(
      repository as never,
      planEntitlementService as never
    );

    await expect(
      useCase.execute(
        jest.fn((key: string) => key) as never,
        'acc-1',
        'addon-1'
      )
    ).resolves.toEqual({
      success: true,
      message: 'addon_cancelled_successfully',
    });
    expect(
      planEntitlementService.refreshCrossSellAccount
    ).not.toHaveBeenCalled();
  });

  it('does not write when the deny fence cannot be installed', async () => {
    const repository = {
      findAddonById: jest.fn(async () => integrationAddon()),
      hasActivePlanCycle: jest.fn(async () => true),
      scheduleAddonCancellation: jest.fn(),
    };
    const planEntitlementService = createPlanEntitlementServiceMock();
    planEntitlementService.installDenyFenceForCrossSellAccount.mockRejectedValue(
      new Error('plan_entitlement_unavailable')
    );
    const useCase = new AccountAddonCancellerUseCase(
      repository as never,
      planEntitlementService as never
    );

    await expect(
      useCase.execute(
        jest.fn((key: string) => key) as never,
        'acc-1',
        'addon-1'
      )
    ).rejects.toThrow('plan_entitlement_unavailable');
    expect(repository.scheduleAddonCancellation).not.toHaveBeenCalled();
  });

  it('does not depend on entitlement infrastructure for another add-on product', async () => {
    const repository = {
      findAddonById: jest.fn(async () => ({
        cancellation_date: null,
        plan_product_id: 'another-plan-product',
      })),
      hasActivePlanCycle: jest.fn(async () => true),
      scheduleAddonCancellation: jest.fn(async () => true),
    };
    const planEntitlementService = createPlanEntitlementServiceMock();
    planEntitlementService.installDenyFenceForCrossSellAccount.mockRejectedValue(
      new Error('redis_unavailable')
    );
    planEntitlementService.refreshCrossSellAccount.mockRejectedValue(
      new Error('redis_unavailable')
    );
    const useCase = new AccountAddonCancellerUseCase(
      repository as never,
      planEntitlementService as never
    );

    await expect(
      useCase.execute(
        jest.fn((key: string) => key) as never,
        'acc-1',
        'addon-1'
      )
    ).resolves.toEqual({
      success: true,
      message: 'addon_cancelled_successfully',
    });
    expect(
      planEntitlementService.installDenyFenceForCrossSellAccount
    ).not.toHaveBeenCalled();
    expect(
      planEntitlementService.refreshCrossSellAccount
    ).not.toHaveBeenCalled();
  });
});
