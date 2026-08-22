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
jest.mock('@core/repositories/plan/PlanRelease.repository', () => ({
  PlanReleaseRepository: class {},
}));
jest.mock('@core/services/planEntitlement.service', () => ({
  PlanEntitlementService: class {},
}));

import { EPaymentStatus } from '@core/common/enums/EPaymentStatus';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';
import { EBillingPeriod } from '@core/common/enums/EBillingPeriod';
import { PlanReleaseService } from '@core/services/planRelease.service';

describe('PlanReleaseService Integration entitlement hooks', () => {
  const makeService = (isAddonOnly = false) => {
    const accountPayment: {
      account_payment_id: string;
      account_id: string;
      plan_id: string;
      release_status: string | null;
      is_addon_only: boolean;
      payment_date: string | null;
      payment_status_id: string;
      payment_status_observed_at: string | null;
      payment_status_event_id: string | null;
      recurring_payment: boolean;
      billing_period_id: string | null;
      value: string;
      billing: string;
    } = {
      account_payment_id: 'payment-1',
      account_id: 'acc-1',
      plan_id: 'plan-1',
      release_status: null,
      is_addon_only: isAddonOnly,
      payment_date: null,
      payment_status_id: EPaymentStatus.pending,
      payment_status_observed_at: null,
      payment_status_event_id: null,
      recurring_payment: false,
      billing_period_id: null,
      value: '100',
      billing: 'asaas-payment-1',
    };
    const planReleaseRepository = {
      findAccountPaymentById: jest.fn(async () => accountPayment),
      findAccountPaymentByBilling: jest.fn(async () => accountPayment),
      findPlanAccountByAccountPaymentId: jest.fn<Promise<any | null>, [string]>(
        async () => null
      ),
      findPlanAccountByAccountId: jest.fn<Promise<any | null>, []>(
        async () => null
      ),
      processPaymentAndReleasePlan: jest.fn(async () => true),
      processPaymentRevocation: jest.fn(async () => ({
        applied: true,
        requiresDenyFence: false,
        ignoredAsStale: false,
      })),
      willGrantIntegrationAfterPaymentRevocation: jest.fn(async () => false),
      findPlanIsTestById: jest.fn(async () => false),
      markAccountPaymentReleaseFailed: jest.fn(async () => undefined),
    };
    const notificationMessageService = {
      sendPlanNotification: jest.fn(async () => undefined),
    };
    const centrifugoService = {
      publishSub: jest.fn(async () => undefined),
    };
    const planEntitlementService = {
      installDenyFence: jest.fn<Promise<string | null>, [string, string]>(
        async () => null
      ),
      installOrAdoptDenyFenceForRevocationRetry: jest.fn<
        Promise<{ ownerToken: string; adopted: boolean } | null>,
        [string, string]
      >(async () => null),
      refreshAfterMutation: jest.fn(async () => ({ allowed: true })),
      willGrantAfterPlanAssignment: jest.fn<Promise<boolean>, [any]>(
        async () => false
      ),
    };

    const service = new PlanReleaseService(
      planReleaseRepository as never,
      centrifugoService as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      notificationMessageService as never,
      {} as never,
      planEntitlementService as never
    );
    jest.spyOn(service, 'createInvoiceForPayment').mockResolvedValue(undefined);

    return {
      service,
      planReleaseRepository,
      planEntitlementService,
      centrifugoService,
      accountPayment,
    };
  };

  const webhook = (
    status: string,
    dateCreated = '2026-07-11T13:00:00.000Z',
    id = `evt-${status.toLowerCase()}`
  ) =>
    ({
      id,
      event: `PAYMENT_${status}`,
      dateCreated,
      payment: {
        id: 'asaas-payment-1',
        status,
        paymentDate: '2026-07-11T12:00:00.000Z',
        confirmedDate: null,
        pixTransaction: null,
      },
    }) as never;

  const releaseInput = {
    accountPaymentId: 'payment-1',
    accountId: 'acc-1',
    planId: 'plan-1',
    billingPeriodId: null,
    recurringPayment: false,
    value: '100',
    paymentDate: '2026-07-11T12:00:00.000Z',
    paymentStatusId: EPaymentStatus.confirmed,
  };

  it('fences before replacing the plan and reconciles after commit', async () => {
    const { service, planReleaseRepository, planEntitlementService } =
      makeService(false);

    await expect(
      service.releasePlanForCreditCard({
        ...releaseInput,
        paymentDate: '2099-07-11T12:00:00.000Z',
      })
    ).resolves.toBeUndefined();

    expect(planEntitlementService.installDenyFence).toHaveBeenCalledWith(
      'acc-1',
      EPlanProduct.integration
    );
    expect(
      planEntitlementService.installOrAdoptDenyFenceForRevocationRetry
    ).not.toHaveBeenCalled();
    expect(planEntitlementService.refreshAfterMutation).toHaveBeenCalledWith(
      'acc-1',
      EPlanProduct.integration
    );
    expect(
      planEntitlementService.installDenyFence.mock.invocationCallOrder[0]
    ).toBeLessThan(
      planReleaseRepository.processPaymentAndReleasePlan.mock
        .invocationCallOrder[0]
    );
  });

  it('reconciles an add-on-only release without a revocation fence', async () => {
    const { service, planReleaseRepository, planEntitlementService } =
      makeService(true);

    await expect(
      service.releasePlanForCreditCard({
        ...releaseInput,
        paymentDate: '2099-07-11T12:00:00.000Z',
      })
    ).resolves.toBeUndefined();

    expect(
      planEntitlementService.installOrAdoptDenyFenceForRevocationRetry
    ).not.toHaveBeenCalled();
    expect(planEntitlementService.installDenyFence).not.toHaveBeenCalled();
    expect(planEntitlementService.refreshAfterMutation).toHaveBeenCalledWith(
      'acc-1',
      EPlanProduct.integration
    );
    expect(planEntitlementService.refreshAfterMutation).toHaveBeenCalledTimes(
      2
    );
    expect(
      planEntitlementService.refreshAfterMutation.mock.invocationCallOrder[0]
    ).toBeLessThan(
      planReleaseRepository.processPaymentAndReleasePlan.mock
        .invocationCallOrder[0]
    );
    expect(
      planReleaseRepository.processPaymentAndReleasePlan.mock
        .invocationCallOrder[0]
    ).toBeLessThan(
      planEntitlementService.refreshAfterMutation.mock.invocationCallOrder[1]
    );
  });

  it('does not fence a release whose destination plan still grants Integration', async () => {
    const { service, planEntitlementService } = makeService(false);
    planEntitlementService.willGrantAfterPlanAssignment.mockResolvedValue(true);

    await expect(
      service.releasePlanForCreditCard({
        ...releaseInput,
        paymentDate: '2099-07-11T12:00:00.000Z',
      })
    ).resolves.toBeUndefined();

    expect(
      planEntitlementService.willGrantAfterPlanAssignment
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acc-1',
        planId: 'plan-1',
        prospectiveAccountPaymentId: 'payment-1',
      })
    );
    expect(
      planEntitlementService.installOrAdoptDenyFenceForRevocationRetry
    ).not.toHaveBeenCalled();
    expect(planEntitlementService.installDenyFence).not.toHaveBeenCalled();
    expect(planEntitlementService.refreshAfterMutation).toHaveBeenCalledTimes(
      2
    );
  });

  it('fences a same-plan release when only an old add-on granted Integration', async () => {
    const { service, planReleaseRepository, planEntitlementService } =
      makeService(false);
    planReleaseRepository.findPlanAccountByAccountId.mockResolvedValue({
      plan_id: 'plan-1',
      next_payment_date: '2099-08-11T12:00:00.000Z',
      value: '100',
      last_payment_date: '2099-06-11T12:00:00.000Z',
    });
    planEntitlementService.willGrantAfterPlanAssignment.mockImplementation(
      async (input: { includeExistingAddons: boolean }) =>
        input.includeExistingAddons
    );

    await service.releasePlanForCreditCard({
      ...releaseInput,
      paymentDate: '2099-07-11T12:00:00.000Z',
    });

    expect(
      planEntitlementService.willGrantAfterPlanAssignment
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        includeExistingAddons: false,
        prospectiveAccountPaymentId: 'payment-1',
      })
    );
    expect(planEntitlementService.installDenyFence).toHaveBeenCalledWith(
      'acc-1',
      EPlanProduct.integration
    );
    expect(
      planEntitlementService.installOrAdoptDenyFenceForRevocationRetry
    ).not.toHaveBeenCalled();
  });

  it.each([
    'REFUNDED',
    'REFUND_REQUESTED',
    'REFUND_IN_PROGRESS',
    'CHARGEBACK_REQUESTED',
    'CHARGEBACK_DISPUTE',
    'AWAITING_CHARGEBACK_REVERSAL',
  ])('fences and revokes payment artifacts for %s', async (status) => {
    const {
      service,
      accountPayment,
      planReleaseRepository,
      planEntitlementService,
    } = makeService();
    accountPayment.payment_status_id = EPaymentStatus.confirmed;
    accountPayment.release_status = 'processed';
    planEntitlementService.installOrAdoptDenyFenceForRevocationRetry.mockResolvedValueOnce(
      { ownerToken: 'owner-1', adopted: false }
    );

    await expect(
      service.processPaymentWebhook(webhook(status))
    ).resolves.toBeUndefined();

    expect(planReleaseRepository.processPaymentRevocation).toHaveBeenCalledWith(
      expect.objectContaining({
        accountPaymentId: 'payment-1',
        accountId: 'acc-1',
        planProductId: EPlanProduct.integration,
        denyFenceOwnerToken: 'owner-1',
        statusObservedAt: '2026-07-11T13:00:00.000Z',
      })
    );
    expect(
      planEntitlementService.installOrAdoptDenyFenceForRevocationRetry.mock
        .invocationCallOrder[0]
    ).toBeLessThan(
      planReleaseRepository.processPaymentRevocation.mock.invocationCallOrder[0]
    );
    expect(planEntitlementService.refreshAfterMutation).toHaveBeenCalledWith(
      'acc-1',
      EPlanProduct.integration,
      'owner-1'
    );
  });

  it('adopts and reconciles an existing owner even when another payment keeps Integration allowed', async () => {
    const {
      service,
      accountPayment,
      planReleaseRepository,
      planEntitlementService,
    } = makeService(true);
    accountPayment.payment_status_id = EPaymentStatus.confirmed;
    planReleaseRepository.willGrantIntegrationAfterPaymentRevocation.mockResolvedValueOnce(
      true
    );
    planEntitlementService.installOrAdoptDenyFenceForRevocationRetry.mockResolvedValueOnce(
      { ownerToken: 'orphan-owner', adopted: true }
    );

    await service.processPaymentWebhook(webhook('REFUNDED'));

    expect(
      planEntitlementService.installOrAdoptDenyFenceForRevocationRetry
    ).toHaveBeenCalledWith(
      'acc-1',
      EPlanProduct.integration,
      'payment-refund:payment-1'
    );
    expect(
      planReleaseRepository.willGrantIntegrationAfterPaymentRevocation
    ).not.toHaveBeenCalled();
    expect(planReleaseRepository.processPaymentRevocation).toHaveBeenCalledWith(
      expect.objectContaining({ denyFenceOwnerToken: 'orphan-owner' })
    );
    expect(planEntitlementService.refreshAfterMutation).toHaveBeenCalledWith(
      'acc-1',
      EPlanProduct.integration,
      'orphan-owner'
    );
  });

  it('does not mutate when Redis cannot confirm a required deny fence', async () => {
    const {
      service,
      accountPayment,
      planReleaseRepository,
      planEntitlementService,
    } = makeService();
    accountPayment.payment_status_id = EPaymentStatus.confirmed;
    planEntitlementService.installOrAdoptDenyFenceForRevocationRetry.mockRejectedValueOnce(
      new Error('redis unavailable')
    );

    await expect(
      service.processPaymentWebhook(webhook('REFUNDED'))
    ).rejects.toThrow('redis unavailable');
    expect(
      planReleaseRepository.processPaymentRevocation
    ).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'keeps the revocation fence after a local retry failure (adopted=%s)',
    async (adopted) => {
      const {
        service,
        accountPayment,
        planReleaseRepository,
        planEntitlementService,
      } = makeService();
      accountPayment.payment_status_id = EPaymentStatus.confirmed;
      accountPayment.release_status = 'processed';
      planEntitlementService.installOrAdoptDenyFenceForRevocationRetry.mockResolvedValueOnce(
        { ownerToken: 'protected-owner', adopted }
      );
      planReleaseRepository.processPaymentRevocation.mockRejectedValueOnce(
        new Error('local transaction failed')
      );

      await expect(
        service.processPaymentWebhook(webhook('REFUNDED'))
      ).rejects.toThrow('local transaction failed');
      expect(
        planEntitlementService.refreshAfterMutation
      ).not.toHaveBeenCalled();
    }
  );

  it('treats a stale revocation event as a terminal no-op', async () => {
    const {
      service,
      accountPayment,
      planReleaseRepository,
      centrifugoService,
    } = makeService();
    accountPayment.payment_status_id = EPaymentStatus.confirmed;
    planReleaseRepository.processPaymentRevocation.mockResolvedValueOnce({
      applied: false,
      requiresDenyFence: false,
      ignoredAsStale: true,
    });

    await expect(
      service.processPaymentWebhook(webhook('REFUNDED'))
    ).resolves.toBeUndefined();
    expect(centrifugoService.publishSub).not.toHaveBeenCalled();
  });

  it('releases an adopted owner when the matching revocation is already superseded', async () => {
    const {
      service,
      accountPayment,
      planReleaseRepository,
      planEntitlementService,
    } = makeService();
    accountPayment.payment_status_id = EPaymentStatus.confirmed;
    accountPayment.release_status = 'processed';
    planEntitlementService.installOrAdoptDenyFenceForRevocationRetry.mockResolvedValueOnce(
      { ownerToken: 'protected-owner', adopted: true }
    );
    planReleaseRepository.processPaymentRevocation.mockResolvedValueOnce({
      applied: false,
      requiresDenyFence: false,
      ignoredAsStale: true,
    });

    await expect(
      service.processPaymentWebhook(webhook('REFUNDED'))
    ).resolves.toBeUndefined();
    expect(planEntitlementService.refreshAfterMutation).toHaveBeenCalledWith(
      'acc-1',
      EPlanProduct.integration,
      'protected-owner'
    );
  });

  it.each([false, true])(
    'rematerializes a newer confirmed reversal for %s payment',
    async (isAddonOnly) => {
      const { service, accountPayment, planReleaseRepository } =
        makeService(isAddonOnly);
      accountPayment.payment_status_id = EPaymentStatus.refunded;
      accountPayment.release_status = 'pending';
      accountPayment.payment_status_observed_at = '2026-07-11T13:00:00.000Z';
      accountPayment.payment_status_event_id = 'evt-refund';
      if (!isAddonOnly) {
        accountPayment.billing_period_id = EBillingPeriod.monthly;
      }
      planReleaseRepository.findPlanAccountByAccountPaymentId.mockResolvedValue(
        isAddonOnly
          ? null
          : {
              plan_account_id: 'plan-account-1',
              plan_id: 'plan-1',
              next_payment_date: '2026-07-11T13:00:00.000Z',
            }
      );

      await service.processPaymentWebhook(
        webhook('CONFIRMED', '2026-07-12T13:00:00.000Z', 'evt-reversal')
      );

      expect(
        planReleaseRepository.processPaymentAndReleasePlan
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          allowFinancialReversal: true,
          shouldReleasePlan: !isAddonOnly,
          statusObservedAt: '2026-07-12T13:00:00.000Z',
          statusEventId: 'evt-reversal',
          ...(isAddonOnly ? { isAddonOnly: true } : {}),
        })
      );
    }
  );

  it('releases an expired plan after revocation moved through a newer pending state', async () => {
    const { service, accountPayment, planReleaseRepository } = makeService();
    accountPayment.payment_status_id = EPaymentStatus.pending;
    accountPayment.release_status = 'pending';
    accountPayment.payment_status_observed_at = '2026-07-12T12:00:00.000Z';
    accountPayment.payment_status_event_id = 'evt-pending';
    planReleaseRepository.findPlanAccountByAccountPaymentId.mockResolvedValue({
      plan_account_id: 'plan-account-1',
      plan_id: 'plan-1',
      next_payment_date: '2026-07-11T12:00:00.000Z',
    });

    await service.processPaymentWebhook(
      webhook('CONFIRMED', '2026-07-13T12:00:00.000Z', 'evt-confirmed')
    );

    expect(
      planReleaseRepository.processPaymentAndReleasePlan
    ).toHaveBeenCalledWith(
      expect.objectContaining({ shouldReleasePlan: true })
    );
  });

  it('does not replace a newer plan when an old payment is reversed', async () => {
    const { service, accountPayment, planReleaseRepository } = makeService();
    accountPayment.payment_status_id = EPaymentStatus.refunded;
    accountPayment.release_status = 'pending';
    accountPayment.payment_status_observed_at = '2026-07-11T13:00:00.000Z';
    accountPayment.payment_status_event_id = 'evt-refund';
    planReleaseRepository.findPlanAccountByAccountPaymentId.mockResolvedValue(
      null
    );

    await service.processPaymentWebhook(
      webhook('CONFIRMED', '2026-07-12T13:00:00.000Z', 'evt-reversal')
    );

    expect(
      planReleaseRepository.processPaymentAndReleasePlan
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        shouldReleasePlan: false,
        allowFinancialReversal: true,
      })
    );
    expect(
      planReleaseRepository.processPaymentAndReleasePlan
    ).not.toHaveBeenCalledWith(
      expect.objectContaining({ shouldReleasePlan: true })
    );
  });

  it('rejects webhook statuses without a valid authoritative event order', async () => {
    const { service, planReleaseRepository } = makeService();

    await expect(
      service.processPaymentWebhook(webhook('CONFIRMED', 'not-a-date'))
    ).rejects.toThrow('payment_status_event_order_invalid');
    expect(
      planReleaseRepository.findAccountPaymentByBilling
    ).not.toHaveBeenCalled();
  });
});
