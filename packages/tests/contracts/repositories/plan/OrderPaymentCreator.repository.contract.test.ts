import 'reflect-metadata';
import { OrderPaymentCreatorRepository } from '@core/repositories/plan/OrderPaymentCreator.repository';
import { EPlanStatus } from '@core/common/enums/EPlanStatus';

jest.mock('node:crypto', () => ({
  randomUUID: jest.fn(() => 'uuid-1'),
}));

describe('OrderPaymentCreatorRepository', () => {
  function buildRepository(dbRw?: any, dbRo?: any, upgradeDiscount?: any) {
    return new OrderPaymentCreatorRepository(
      (dbRw ?? {}) as never,
      (dbRo ?? {}) as never,
      (upgradeDiscount ?? {
        calculateUpgradeDiscount: jest.fn(async () => ({
          is_upgrade: false,
          discount: 0,
        })),
      }) as never
    );
  }

  it('getBillingPeriodId maps monthly and annual', () => {
    const repository = buildRepository();

    expect(repository.getBillingPeriodId('monthly')).not.toBeNull();
    expect(repository.getBillingPeriodId('annual')).not.toBeNull();
  });

  it('calculateOrderPayment throws when plan is not found', async () => {
    const repository = buildRepository();
    jest.spyOn(repository, 'getPlan').mockResolvedValueOnce(undefined);

    await expect(
      repository.calculateOrderPayment('a-1', {
        plan_id: 'p-1',
        billing_period: 'monthly',
      } as never)
    ).rejects.toThrow('Plano não encontrado');
  });

  it('calculateOrderPayment validates active/exclusive plan and computes totals', async () => {
    const repository = buildRepository(
      {},
      {},
      {
        calculateUpgradeDiscount: jest.fn(async () => ({
          is_upgrade: true,
          discount: 5,
        })),
      }
    );
    jest.spyOn(repository, 'getPlan').mockResolvedValue({
      plan_id: 'p-1',
      price: '100',
      annual_discount: '10',
      is_test: false,
      days_trial: 0,
      status: EPlanStatus.active,
      is_exclusive: false,
    } as never);
    (repository as any).calculateAddonsTotal = jest.fn(async () => 20);

    await expect(
      repository.calculateOrderPayment('a-1', {
        plan_id: 'p-1',
        billing_period: 'annual',
      } as never)
    ).resolves.toEqual({
      planPrice: 1080,
      addonsTotal: 20,
      discountAmount: 5,
      totalAmount: 1095,
    });
  });

  it('createAccountPayment returns inserted id or existing billing conflict id', async () => {
    const dbRwInserted = {
      insert: jest.fn(() => ({
        values: jest.fn(() => ({
          onConflictDoNothing: jest.fn(() => ({
            returning: jest.fn(async () => [{ account_payment_id: 'ap-1' }]),
          })),
        })),
      })),
      query: { accountPayment: { findFirst: jest.fn() } },
    };
    const repositoryInserted = buildRepository(dbRwInserted);

    await expect(
      repositoryInserted.createAccountPayment({
        accountId: 'a-1',
        userCustomerId: 'uc-1',
        planId: 'p-1',
        billing: 'billing-1',
        paymentBillingTypeId: 'pix',
        value: '100',
        netValue: '100',
        pixTransaction: null,
        paymentStatusId: 'paid',
        billingPeriodId: null,
        invoiceUrl: null,
        recurringPayment: true,
        isAddonOnly: false,
      })
    ).resolves.toBe('ap-1');

    const dbRwConflict = {
      insert: jest.fn(() => ({
        values: jest.fn(() => ({
          onConflictDoNothing: jest.fn(() => ({
            returning: jest.fn(async () => []),
          })),
        })),
      })),
      query: {
        accountPayment: {
          findFirst: jest.fn(async () => ({ account_payment_id: 'ap-2' })),
        },
      },
    };
    const repositoryConflict = buildRepository(dbRwConflict);

    await expect(
      repositoryConflict.createAccountPayment({
        accountId: 'a-1',
        userCustomerId: 'uc-1',
        planId: 'p-1',
        billing: 'billing-1',
        paymentBillingTypeId: 'pix',
        value: '100',
        netValue: '100',
        pixTransaction: null,
        paymentStatusId: 'paid',
        billingPeriodId: null,
        invoiceUrl: null,
        recurringPayment: true,
        isAddonOnly: false,
      })
    ).resolves.toBe('ap-2');
  });

  it('createAccountPayment throws when conflict record is not found', async () => {
    const repository = buildRepository({
      insert: jest.fn(() => ({
        values: jest.fn(() => ({
          onConflictDoNothing: jest.fn(() => ({
            returning: jest.fn(async () => []),
          })),
        })),
      })),
      query: {
        accountPayment: {
          findFirst: jest.fn(async () => null),
        },
      },
    });

    await expect(
      repository.createAccountPayment({
        accountId: 'a-1',
        userCustomerId: 'uc-1',
        planId: 'p-1',
        billing: 'billing-1',
        paymentBillingTypeId: 'pix',
        value: '100',
        netValue: '100',
        pixTransaction: null,
        paymentStatusId: 'paid',
        billingPeriodId: null,
        invoiceUrl: null,
        recurringPayment: true,
        isAddonOnly: false,
      })
    ).rejects.toThrow('Account payment not found after billing conflict');
  });

  it('createAccountPaymentCrossSells skips when addons are empty or existing records found', async () => {
    const dbRw = {
      query: {
        accountPaymentCrossSell: {
          findFirst: jest.fn(async () => ({
            account_payment_cross_sell_id: 'x',
          })),
        },
      },
      select: jest.fn(),
      insert: jest.fn(),
    };
    const repository = buildRepository(dbRw);

    await expect(
      repository.createAccountPaymentCrossSells({
        accountPaymentId: 'ap-1',
        addons: [],
        billingPeriod: 'monthly',
      })
    ).resolves.toBeUndefined();

    await expect(
      repository.createAccountPaymentCrossSells({
        accountPaymentId: 'ap-1',
        addons: [{ plan_cross_sell_id: 'pcs-1' }],
        billingPeriod: 'monthly',
      })
    ).resolves.toBeUndefined();
    expect(dbRw.insert).not.toHaveBeenCalled();
  });

  it('commits the payment and its add-on selection through the same transaction', async () => {
    const tx = {};
    const dbRw = {
      transaction: jest.fn(async (callback: (database: unknown) => unknown) =>
        callback(tx)
      ),
    };
    const repository = buildRepository(dbRw);
    const createPayment = jest
      .spyOn(repository as never, 'createAccountPaymentUsing' as never)
      .mockResolvedValue('ap-atomic' as never);
    const createCrossSells = jest
      .spyOn(
        repository as never,
        'createAccountPaymentCrossSellsUsing' as never
      )
      .mockResolvedValue(undefined as never);

    await expect(
      repository.createAccountPaymentWithCrossSells({
        payment: { billing: 'billing-1' } as never,
        addons: [{ plan_cross_sell_id: 'pcs-1' }],
        billingPeriod: 'monthly',
      })
    ).resolves.toBe('ap-atomic');

    expect(createPayment).toHaveBeenCalledWith(tx, {
      billing: 'billing-1',
    });
    expect(createCrossSells).toHaveBeenCalledWith(tx, {
      accountPaymentId: 'ap-atomic',
      addons: [{ plan_cross_sell_id: 'pcs-1' }],
      billingPeriod: 'monthly',
    });
    expect(dbRw.transaction).toHaveBeenCalledTimes(1);
  });

  it('getCurrentActivePlanAccount maps billing period name from row', async () => {
    const repository = buildRepository({
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          leftJoin: jest.fn(() => ({
            where: jest.fn(() => ({
              orderBy: jest.fn(() => ({
                limit: jest.fn(() => ({
                  execute: jest.fn(async () => [
                    {
                      plan_id: 'p-1',
                      billing_period_id: 'monthly-id',
                      billing_period_name: 'monthly',
                      recurring_payment: true,
                      last_payment_date: '2026-04-20',
                      next_payment_date: '2026-05-20',
                    },
                  ]),
                })),
              })),
            })),
          })),
        })),
      })),
    });

    await expect(
      repository.getCurrentActivePlanAccount('a-1')
    ).resolves.toEqual(
      expect.objectContaining({
        plan_id: 'p-1',
        billing_period: 'monthly',
      })
    );
  });
});
