import 'reflect-metadata';
import { PlanReleaseRepository } from '@core/repositories/plan/PlanRelease.repository';
import { EAccountPaymentReleaseStatus } from '@core/common/enums/EAccountPaymentReleaseStatus';

describe('PlanReleaseRepository', () => {
  function buildRepository(dbRw?: any, dbRo?: any) {
    return new PlanReleaseRepository(
      (dbRw ?? {}) as never,
      (dbRo ?? {}) as never
    );
  }

  it('findAccountPaymentByBilling and findAccountPaymentById return rows or null', async () => {
    const repository = buildRepository({
      query: {
        accountPayment: {
          findFirst: jest
            .fn()
            .mockResolvedValueOnce({ account_payment_id: 'ap-1' })
            .mockResolvedValueOnce(null),
        },
      },
    });

    await expect(
      repository.findAccountPaymentByBilling('billing-1')
    ).resolves.toEqual({ account_payment_id: 'ap-1' });
    await expect(repository.findAccountPaymentById('ap-1')).resolves.toBeNull();
  });

  it('upsertPlanAccount updates existing plan account or creates a new one', async () => {
    const repository = buildRepository();
    (repository as any).findPlanAccountByAccountIdTx = jest
      .fn()
      .mockResolvedValueOnce({ plan_account_id: 'existing-1' })
      .mockResolvedValueOnce(null);
    (repository as any).updatePlanAccount = jest.fn(async () => undefined);
    (repository as any).createPlanAccount = jest.fn(async () => undefined);

    await expect(
      repository.upsertPlanAccount({} as never, {
        accountId: 'a-1',
        planId: 'p-1',
        accountPaymentId: 'ap-1',
        recurringPayment: true,
        billingPeriodId: null,
        lastPaymentDate: '2026-04-20',
        nextPaymentDate: '2026-05-20',
        value: '100',
      })
    ).resolves.toBeUndefined();
    await expect(
      repository.upsertPlanAccount({} as never, {
        accountId: 'a-1',
        planId: 'p-1',
        accountPaymentId: 'ap-1',
        recurringPayment: true,
        billingPeriodId: null,
        lastPaymentDate: '2026-04-20',
        nextPaymentDate: '2026-05-20',
        value: '100',
      })
    ).resolves.toBeUndefined();

    expect((repository as any).updatePlanAccount).toHaveBeenCalledTimes(1);
    expect((repository as any).createPlanAccount).toHaveBeenCalledTimes(1);
  });

  it('processPaymentAndReleasePlan releases plan and appends addons when requested', async () => {
    const tx = {
      query: {
        accountPayment: {
          findFirst: jest.fn(async () => ({ release_status: 'pending' })),
        },
      },
    };
    const repository = buildRepository({
      transaction: jest.fn(async (callback) => callback(tx)),
    });
    jest.spyOn(repository, 'updateAccountPaymentStatus').mockResolvedValue();
    jest.spyOn(repository, 'upsertPlanAccount').mockResolvedValue();
    (repository as any).updateAccountStatusToActive = jest.fn(
      async () => undefined
    );
    (repository as any).appendPlanCrossSellAccount = jest.fn(
      async () => undefined
    );
    (repository as any).replacePlanCrossSellAccount = jest.fn(
      async () => undefined
    );

    await expect(
      repository.processPaymentAndReleasePlan({
        accountPaymentId: 'ap-1',
        paymentStatusId: 'paid',
        paymentDate: '2026-04-21',
        pixTransaction: null,
        accountId: 'a-1',
        planId: 'p-1',
        accountPaymentIdForPlan: 'ap-1',
        recurringPayment: true,
        billingPeriodId: null,
        lastPaymentDate: '2026-04-21',
        nextPaymentDate: '2026-05-21',
        value: '100',
        shouldReleasePlan: true,
        replaceExistingAddons: false,
      })
    ).resolves.toBeUndefined();

    expect(repository.upsertPlanAccount).toHaveBeenCalledTimes(1);
    expect(
      (repository as any).appendPlanCrossSellAccount
    ).toHaveBeenCalledTimes(1);
    expect(
      (repository as any).replacePlanCrossSellAccount
    ).not.toHaveBeenCalled();
  });

  it('processPaymentAndReleasePlan skips release when already processed and handles addon-only', async () => {
    const tx = {
      query: {
        accountPayment: {
          findFirst: jest.fn(async () => ({
            release_status: EAccountPaymentReleaseStatus.processed,
          })),
        },
      },
    };
    const repository = buildRepository({
      transaction: jest.fn(async (callback) => callback(tx)),
    });
    jest.spyOn(repository, 'updateAccountPaymentStatus').mockResolvedValue();
    jest.spyOn(repository, 'upsertPlanAccount').mockResolvedValue();
    (repository as any).appendPlanCrossSellAccount = jest.fn(
      async () => undefined
    );

    await expect(
      repository.processPaymentAndReleasePlan({
        accountPaymentId: 'ap-1',
        paymentStatusId: 'paid',
        paymentDate: '2026-04-21',
        pixTransaction: null,
        accountId: 'a-1',
        planId: 'p-1',
        accountPaymentIdForPlan: 'ap-1',
        recurringPayment: true,
        billingPeriodId: null,
        lastPaymentDate: '2026-04-21',
        nextPaymentDate: '2026-05-21',
        value: '100',
        shouldReleasePlan: true,
        isAddonOnly: true,
      })
    ).resolves.toBeUndefined();

    expect(repository.upsertPlanAccount).not.toHaveBeenCalled();
    expect(
      (repository as any).appendPlanCrossSellAccount
    ).not.toHaveBeenCalled();
  });

  it('mark release status methods execute update chain', async () => {
    const dbRw = {
      update: jest.fn(() => ({
        set: jest.fn(() => ({
          where: jest.fn(),
        })),
      })),
    };
    const repository = buildRepository(dbRw);

    await expect(
      repository.markAccountPaymentReleaseFailed('ap-1', 'error')
    ).resolves.toBeUndefined();
    await expect(
      repository.markAccountPaymentReleaseProcessed('ap-1', '2026-04-21')
    ).resolves.toBeUndefined();
    expect(dbRw.update).toHaveBeenCalledTimes(2);
  });

  it('findPlan helpers and account invoice flag return expected values', async () => {
    const findAccount = jest
      .fn()
      .mockResolvedValueOnce({ generate_invoice: true })
      .mockResolvedValueOnce({ generate_invoice: null })
      .mockResolvedValueOnce(null);

    const repository = buildRepository(
      {
        query: {
          account: {
            findFirst: findAccount,
          },
        },
      },
      {
        query: {
          plan: {
            findFirst: jest
              .fn()
              .mockResolvedValueOnce({ name: 'Pro', description: 'desc' })
              .mockResolvedValueOnce({ is_test: true }),
          },
        },
      }
    );

    await expect(repository.findPlanById('p-1')).resolves.toEqual({
      name: 'Pro',
      description: 'desc',
    });
    await expect(repository.findPlanIsTestById('p-1')).resolves.toBe(true);
    await expect(
      repository.findAccountGenerateInvoiceById('a-1')
    ).resolves.toBe(true);
    await expect(
      repository.findAccountGenerateInvoiceById('a-2')
    ).resolves.toBe(true);
    await expect(
      repository.findAccountGenerateInvoiceById('missing-account')
    ).resolves.toBeNull();
  });
});
