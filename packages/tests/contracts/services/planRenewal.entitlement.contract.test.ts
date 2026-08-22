import 'reflect-metadata';

jest.mock('@core/common/functions/withLock', () => ({
  withLock: jest.fn(
    async (
      _redis: unknown,
      _key: string,
      callback: () => Promise<unknown>
    ): Promise<unknown> => callback()
  ),
}));
jest.mock('@core/common/functions/createI18nInstance', () => ({
  createI18nInstance: jest.fn(async () => (key: string) => key),
}));
jest.mock(
  '@core/repositories/planAccount/PlanAccountRenewalLister.repository',
  () => ({ PlanAccountRenewalListerRepository: class {} })
);
jest.mock('@core/services/planEntitlement.service', () => ({
  PlanEntitlementService: class {},
}));

import { EAccountStatus } from '@core/common/enums/EAccountStatus';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';
import { PlanRenewalService } from '@core/services/planRenewal.service';

describe('PlanRenewalService Integration entitlement hooks', () => {
  it('keeps Integration active when renewal failure only marks the account inactive', async () => {
    const planAccount = {
      plan_account_id: 'plan-account-1',
      account_id: 'acc-1',
      plan_id: 'plan-1',
      last_payment_date: '2026-06-11T12:00:00.000Z',
    };
    const planAccountRenewalListerRepository = {
      findPlanAccountsForRenewal: jest.fn(async () => [planAccount]),
      findPendingSuccessfulRenewalPayment: jest.fn(async () => null),
    };
    const accountUpdaterRepository = {
      updateAccountStatusById: jest.fn(async () => true),
    };
    const notificationMessageService = {
      sendPlanNotification: jest.fn(async () => undefined),
    };
    const planEntitlementService = {
      installDenyFence: jest.fn(async () => undefined),
      refreshAfterMutation: jest.fn(async () => ({ allowed: false })),
    };
    const service = new PlanRenewalService(
      planAccountRenewalListerRepository as never,
      { findMasterUserByAccountId: jest.fn(async () => null) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      accountUpdaterRepository as never,
      {} as never,
      notificationMessageService as never,
      {} as never,
      planEntitlementService as never
    );

    await expect(service.processRenewals()).resolves.toBeUndefined();

    expect(planEntitlementService.installDenyFence).not.toHaveBeenCalled();
    expect(
      accountUpdaterRepository.updateAccountStatusById
    ).toHaveBeenCalledWith('acc-1', EAccountStatus.inactive);
    expect(planEntitlementService.refreshAfterMutation).toHaveBeenCalledWith(
      'acc-1',
      EPlanProduct.integration
    );
    expect(
      planEntitlementService.refreshAfterMutation.mock.invocationCallOrder[0]
    ).toBeLessThan(
      accountUpdaterRepository.updateAccountStatusById.mock
        .invocationCallOrder[0]
    );
    expect(planEntitlementService.refreshAfterMutation).toHaveBeenCalledTimes(
      2
    );
  });
});
